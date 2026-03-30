import { useState, useRef, useEffect, useCallback } from 'react'
import { Wand2, Mic, MicOff, Send, Loader2 } from 'lucide-react'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://kuodvlyepoojqimutmvu.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_n-B1HcuRd0kDc0spwr-oHg_KI-i0itS'

type HistoryItem = { instruction: string; timestamp: Date }

interface Props {
  currentPrompt: string
  onApplyPrompt: (newPrompt: string) => void
}

export function PromptRefinementChat({ currentPrompt, onApplyPrompt }: Props) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    return () => { recognitionRef.current?.stop() }
  }, [])

  const toggleVoice = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setStatus('Голосовой ввод не поддерживается в этом браузере')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'ru-RU'
    recognition.continuous = true
    recognition.interimResults = true
    recognitionRef.current = recognition

    let finalTranscript = ''
    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) finalTranscript += t + ' '
        else interim = t
      }
      setInput(finalTranscript + interim)
    }
    recognition.onerror = () => setIsRecording(false)
    recognition.onend = () => setIsRecording(false)
    recognition.start()
    setIsRecording(true)
  }, [isRecording])

  const handleRefine = useCallback(async () => {
    const instruction = input.trim()
    if (!instruction || loading || !currentPrompt) return

    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
    }

    setInput('')
    setLoading(true)
    setStatus('Дорабатываю промпт...')

    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: instruction }],
          sessionId: `refine-${Date.now()}`,
          pageContext: { url: 'prompt-refinement', title: 'Refine', section: 'admin' },
          system_prompt_override: `Ты — редактор системных промтов. Тебе дан текущий промт и инструкция по его изменению.

ТЕКУЩИЙ ПРОМТ:
---
${currentPrompt}
---

ИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ: "${instruction}"

ПРАВИЛА:
1. Внеси ТОЛЬКО те изменения, которые просит пользователь
2. Сохрани всю остальную структуру, форматирование и содержание промта
3. Верни ПОЛНЫЙ обновлённый промт целиком — без комментариев, без объяснений, без маркдаун-обёрток
4. НЕ добавляй ничего от себя кроме запрошенных изменений
5. Ответ должен быть ТОЛЬКО текстом промта, ничего больше`,
          isTest: true,
        }),
      })

      if (!resp.ok || !resp.body) throw new Error('Ошибка соединения')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let textBuffer = ''
      let result = ''

      while (true) {
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
          if (jsonStr === '[DONE]') break
          try {
            const parsed = JSON.parse(jsonStr)
            const content = parsed.choices?.[0]?.delta?.content as string | undefined
            if (content) result += content
          } catch { break }
        }
      }

      if (result.trim()) {
        // Strip markdown code fences if AI wrapped the response
        let cleaned = result.trim()
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```[^\n]*\n/, '').replace(/\n```\s*$/, '')
        }
        onApplyPrompt(cleaned)
        setHistory(prev => [{ instruction, timestamp: new Date() }, ...prev])
        setStatus('✅ Промпт обновлён. Нажмите «Сохранить» слева.')
      } else {
        setStatus('⚠️ Пустой ответ от ИИ')
      }
    } catch (e: any) {
      setStatus('❌ ' + (e.message || 'Ошибка'))
    } finally {
      setLoading(false)
    }
  }, [input, loading, currentPrompt, isRecording, onApplyPrompt])

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        <Wand2 className="h-3.5 w-3.5 text-purple-400" />
        <span className="text-xs font-medium text-slate-300">Доработка промпта</span>
      </div>

      {/* History of changes */}
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

      {/* Input */}
      <form onSubmit={e => { e.preventDefault(); handleRefine() }} className="flex items-center gap-2 px-3 py-2 border-t border-slate-800">
        <button
          type="button"
          onClick={toggleVoice}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
            isRecording
              ? 'bg-red-600 text-white animate-pulse'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
          }`}
          title={isRecording ? 'Остановить' : 'Голосовой ввод'}
        >
          {isRecording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        </button>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={isRecording ? 'Говорите...' : 'Что изменить в промте...'}
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
