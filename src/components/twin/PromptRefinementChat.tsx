import { useState, useRef, useEffect, useCallback } from 'react'
import { Wand2, Mic, MicOff, Send, Loader2, Check, X, Minus, Plus } from 'lucide-react'
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase'
import { useVoiceInput } from '@/hooks/useVoiceInput'

const REFINE_URL = `${SUPABASE_URL}/functions/v1/prompt-refine`

type Diff = { old: string; new: string }
type Msg = {
  role: 'user' | 'assistant'
  content: string
  prompt?: string | null
  diffs?: Diff[]
}

interface Props {
  currentPrompt: string
  onApplyPrompt: (newPrompt: string) => void | Promise<void>
}

// Strip all custom tags from display text
function cleanDisplay(content: string): string {
  return content
    .replace(/<PROMPT_RESULT>[\s\S]*?<\/PROMPT_RESULT>/g, '')
    .replace(/<DIFF_OLD>[\s\S]*?<\/DIFF_OLD>/g, '')
    .replace(/<DIFF_NEW>[\s\S]*?<\/DIFF_NEW>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function DiffBlock({ diff }: { diff: Diff }) {
  return (
    <div className="rounded-lg overflow-hidden border border-slate-700 my-2 text-xs font-mono">
      <div className="flex items-start gap-2 bg-red-950/40 px-3 py-2 border-b border-slate-700/50">
        <Minus className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
        <span className="text-red-300 whitespace-pre-wrap break-words">{diff.old}</span>
      </div>
      <div className="flex items-start gap-2 bg-green-950/40 px-3 py-2">
        <Plus className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" />
        <span className="text-green-300 whitespace-pre-wrap break-words">{diff.new}</span>
      </div>
    </div>
  )
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url, options)
      return resp
    } catch (e) {
      if (i === retries) throw e
      await new Promise(r => setTimeout(r, 1000))
    }
  }
  throw new Error('Ошибка сети')
}

export function PromptRefinementChat({ currentPrompt, onApplyPrompt }: Props) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const voice = useVoiceInput(useCallback((text: string) => {
    setInput(text)
  }, []))

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading || !currentPrompt) return

    if (voice.isRecording) voice.toggle()

    const userMsg: Msg = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const accessToken = session?.access_token
      if (!accessToken) throw new Error('Сессия истекла. Обновите страницу.')

      const apiMessages = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))

      const resp = await fetchWithRetry(REFINE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(SUPABASE_PUBLISHABLE_KEY ? { apikey: SUPABASE_PUBLISHABLE_KEY } : {}),
        },
        body: JSON.stringify({ currentPrompt, messages: apiMessages }),
      })

      if (!resp.ok) {
        let errMsg = 'Ошибка соединения'
        try { const d = await resp.json(); if (d?.error) errMsg = d.error } catch {}
        throw new Error(errMsg)
      }

      const data = await resp.json()
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.reply || 'Пустой ответ',
        prompt: data.prompt || null,
        diffs: data.diffs?.length ? data.diffs : undefined,
      }])
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ ' + (e.message || 'Ошибка'),
      }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, currentPrompt, messages, voice])

  const handleApply = useCallback(async (prompt: string) => {
    setApplying(true)
    try {
      await Promise.resolve(onApplyPrompt(prompt))
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '✅ Промпт применён и сохранён!',
      }])
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ Не удалось сохранить: ' + (e.message || 'ошибка'),
      }])
    } finally {
      setApplying(false)
    }
  }, [onApplyPrompt])

  const handleReject = useCallback(() => {
    setInput('Нет, давай по-другому')
  }, [])

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        <Wand2 className="h-3.5 w-3.5 text-purple-400" />
        <span className="text-xs font-medium text-slate-300">Доработка промпта</span>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="ml-auto text-[10px] text-slate-500 hover:text-slate-300"
          >
            очистить
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 min-h-0 space-y-2">
        {messages.length === 0 && (
          <p className="text-center text-xs text-slate-600 py-4">
            Опиши что хочешь изменить в промте — обсудим и применим вместе
          </p>
        )}

        {messages.map((m, i) => (
          <div key={i}>
            {/* User message */}
            {m.role === 'user' && (
              <div className="rounded-lg px-3 py-2 text-xs bg-purple-900/30 text-purple-200 ml-8">
                {m.content}
              </div>
            )}

            {/* Assistant message */}
            {m.role === 'assistant' && (
              <div className="mr-4 space-y-1">
                {/* Text explanation */}
                {cleanDisplay(m.content) && (
                  <div className="rounded-lg px-3 py-2 text-xs bg-slate-800/60 text-slate-300">
                    {cleanDisplay(m.content)}
                  </div>
                )}

                {/* Visual diffs */}
                {m.diffs && m.diffs.length > 0 && (
                  <div>
                    <div className="text-[10px] text-slate-500 px-1 mt-1 mb-0.5">Изменения:</div>
                    {m.diffs.map((d, j) => <DiffBlock key={j} diff={d} />)}
                  </div>
                )}

                {/* Apply / Reject buttons */}
                {m.prompt && (
                  <div className="flex items-center gap-2 mt-2 ml-1">
                    <button
                      onClick={() => handleApply(m.prompt!)}
                      disabled={applying}
                      className="flex items-center gap-1.5 rounded-lg bg-green-700/80 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
                    >
                      {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Применить
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={applying || loading}
                      className="flex items-center gap-1.5 rounded-lg bg-slate-700/80 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-600 disabled:opacity-50 transition-colors"
                    >
                      <X className="h-3 w-3" />
                      Иначе
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-500 px-3 py-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Думаю...
          </div>
        )}
      </div>

      <form onSubmit={e => { e.preventDefault(); sendMessage() }} className="flex items-center gap-2 px-3 py-2 border-t border-slate-800">
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
