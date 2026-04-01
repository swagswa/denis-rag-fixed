import { useState, useRef, useEffect, useCallback } from 'react'
import { Wand2, Mic, MicOff, Send, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useVoiceInput } from '@/hooks/useVoiceInput'

// Prompt refine runs on Lovable Cloud (has LOVABLE_API_KEY)
const CLOUD_URL = import.meta.env.VITE_SUPABASE_URL || 'https://kuodvlyepoojqimutmvu.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const CHAT_URL = `${CLOUD_URL}/functions/v1/chat`

const PROMPT_REFINER_SYSTEM_PROMPT = `You are a PROMPT EDITING MACHINE. Not a chatbot. Not an assistant.

INPUT: You receive TWO things:
1. A "ТЕКУЩИЙ ПРОМПТ" (current prompt text)
2. An "ИНСТРУКЦИЯ" (edit instruction)

YOUR ONLY JOB: Apply the edit instruction to the current prompt and return the COMPLETE UPDATED PROMPT.

ABSOLUTE RULES — VIOLATION = FAILURE:
- Your ENTIRE output must be the full updated prompt text. Every single line of it.
- NEVER omit parts of the original prompt. Return it ALL with only the requested changes applied.
- NEVER add commentary, explanations, or confirmations.
- NEVER start with "Вот", "Готово", "Here is", "Добавил", "Обновил", "Я добавил" or ANY preamble.
- NEVER use markdown code fences (\`\`\`).
- The FIRST character of your output = the first character of the updated prompt.
- The LAST character of your output = the last character of the updated prompt.
- If the original prompt is 50 lines, your output must also be ~50 lines (plus/minus changes).

EXAMPLE:
Input prompt: "Ты помощник. Отвечай кратко."
Instruction: "Добавь что отвечаешь на русском"
Correct output: "Ты помощник. Отвечай кратко, на русском языке."
WRONG output: "Добавил. Вот обновлённый промпт: ..." ← THIS IS A FAILURE`

type HistoryItem = { instruction: string; timestamp: Date }

interface Props {
  currentPrompt: string
  onApplyPrompt: (newPrompt: string) => void | Promise<void>
}

async function extractErrorMessage(resp: Response): Promise<string> {
  if (resp.status === 429) return 'Слишком много запросов, попробуйте позже'
  if (resp.status === 402) return 'Закончились кредиты AI'

  try {
    const payload = await resp.json()
    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error
  } catch {
    // ignore JSON parsing errors
  }

  return 'Ошибка соединения'
}

export function PromptRefinementChat({ currentPrompt, onApplyPrompt }: Props) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])

  const voice = useVoiceInput(useCallback((text: string) => {
    setInput(prev => prev ? prev + ' ' + text : text)
  }, []))

  const handleRefine = useCallback(async () => {
    const instruction = input.trim()
    if (!instruction || loading || !currentPrompt) return

    if (voice.isRecording) voice.toggle()

    setInput('')
    setLoading(true)
    setStatus('Дорабатываю промпт...')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const accessToken = session?.access_token
      if (!accessToken) {
        throw new Error('Сессия истекла. Обновите страницу и войдите снова.')
      }

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(SUPABASE_PUBLISHABLE_KEY ? { apikey: SUPABASE_PUBLISHABLE_KEY } : {}),
        },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `ТЕКУЩИЙ ПРОМПТ:\n---\n${currentPrompt}\n---\n\nИНСТРУКЦИЯ:\n${instruction}`,
          }],
          sessionId: `prompt-refine-${Date.now()}`,
          pageContext: { url: window.location.href, title: 'Prompt Refine', section: 'assistant-prompt-refine' },
          system_prompt_override: PROMPT_REFINER_SYSTEM_PROMPT,
          model: 'openai/gpt-5.2',
          model_override: 'openai/gpt-5.2',
          force_model: 'openai/gpt-5.2',
          isTest: true,
        }),
      })

      if (!resp.ok) {
        throw new Error(await extractErrorMessage(resp))
      }

      if (!resp.body) {
        throw new Error('Пустой ответ от сервера')
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let textBuffer = ''
      let result = ''
      let streamDone = false

      while (!streamDone) {
        const { done, value } = await reader.read()
        if (done) break

        textBuffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, idx)
          textBuffer = textBuffer.slice(idx + 1)

          if (line.endsWith('\r')) line = line.slice(0, -1)
          if (line.startsWith(':') || line.trim() === '' || !line.startsWith('data: ')) continue

          const jsonStr = line.slice(6).trim()
          if (jsonStr === '[DONE]') {
            streamDone = true
            break
          }

          try {
            const parsed = JSON.parse(jsonStr)
            const content = parsed.choices?.[0]?.delta?.content as string | undefined
            if (content) result += content
          } catch {
            textBuffer = `${line}\n${textBuffer}`
            break
          }
        }
      }

      if (textBuffer.trim()) {
        for (let raw of textBuffer.split('\n')) {
          if (!raw) continue
          if (raw.endsWith('\r')) raw = raw.slice(0, -1)
          if (raw.startsWith(':') || raw.trim() === '' || !raw.startsWith('data: ')) continue

          const jsonStr = raw.slice(6).trim()
          if (jsonStr === '[DONE]') continue

          try {
            const parsed = JSON.parse(jsonStr)
            const content = parsed.choices?.[0]?.delta?.content as string | undefined
            if (content) result += content
          } catch {
            // ignore tail garbage
          }
        }
      }

      if (result.trim()) {
        let cleaned = result.trim()
        // Strip common AI preambles
        cleaned = cleaned.replace(/^(Вот|Готово|Добавил[аи]?|Обновил[аи]?|Я добавил[аи]?|Here is)[^\n]*\n+/i, '').trim()
        cleaned = cleaned.replace(/^Вот\s+обновл[её]нный\s+промпт:?\s*/i, '').trim()
        cleaned = cleaned.replace(/^Here is(?: the)? updated prompt:?\s*/i, '').trim()
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```[^\n]*\n/, '').replace(/\n```\s*$/, '')
        }

        // Validation: must be substantial (at least 50% of original or 200 chars)
        const tooShort = cleaned.length < Math.max(200, Math.floor(currentPrompt.length * 0.5))
        const looksLikeDialog = /^(понял|конечно|хорошо|сделаю|готово|ок|добавил|обновил|я добавил)\b/i.test(cleaned)
        if (tooShort || looksLikeDialog) {
          throw new Error('ИИ вернул не полный промпт. Попробуй сформулировать задачу иначе.')
        }

        await Promise.resolve(onApplyPrompt(cleaned))
        setHistory(prev => [{ instruction, timestamp: new Date() }, ...prev])
        setStatus('✅ Промпт обновлён и сохранён.')
      } else {
        setStatus('⚠️ Пустой ответ от ИИ')
      }
    } catch (e: any) {
      setStatus('❌ ' + (e.message || 'Ошибка'))
    } finally {
      setLoading(false)
    }
  }, [input, loading, currentPrompt, voice, onApplyPrompt])

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        <Wand2 className="h-3.5 w-3.5 text-purple-400" />
        <span className="text-xs font-medium text-slate-300">Доработка промпта</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
        {history.length === 0 && !status && (
          <p className="text-center text-xs text-slate-600 py-4">
            Опиши текстом или голосом что изменить в промте — ИИ внесёт правки автоматически
          </p>
        )}
        {status && (
          <div className={`rounded-lg px-3 py-2 text-xs mb-2 ${
            status.startsWith('✅') ? 'bg-green-900/30 text-green-300' :
            status.startsWith('❌') ? 'bg-red-900/30 text-red-300' :
            status.startsWith('⚠') ? 'bg-yellow-900/30 text-yellow-300' :
            'bg-purple-900/30 text-purple-300'
          }`}>
            {loading && <Loader2 className="inline h-3 w-3 mr-1.5 animate-spin" />}
            {status}
          </div>
        )}
        {history.map((h, i) => (
          <div key={i} className="rounded-lg bg-slate-800/50 px-3 py-2 text-xs text-slate-400 mb-1.5">
            <span className="text-slate-500 mr-2">{h.timestamp.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span>
            {h.instruction}
          </div>
        ))}
      </div>

      <form onSubmit={e => { e.preventDefault(); handleRefine() }} className="flex items-center gap-2 px-3 py-2 border-t border-slate-800">
        <button
          type="button"
          onClick={voice.toggle}
          disabled={voice.isTranscribing}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
            voice.isRecording
              ? 'bg-red-600 text-white animate-pulse'
              : voice.isTranscribing
                ? 'bg-amber-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
          }`}
          title={voice.isRecording ? 'Остановить' : voice.isTranscribing ? 'Распознаю...' : 'Голосовой ввод'}
        >
          {voice.isRecording ? <MicOff className="h-3.5 w-3.5" /> : voice.isTranscribing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
        </button>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={voice.isRecording ? 'Говорите...' : 'Что изменить в промте...'}
          disabled={loading}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-purple-600 text-white disabled:opacity-50 hover:bg-purple-500"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
        </button>
      </form>
    </div>
  )
}
