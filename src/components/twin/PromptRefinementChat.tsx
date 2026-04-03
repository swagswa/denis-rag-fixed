import { useState, useRef, useEffect, useCallback } from 'react'
import { Wand2, Mic, MicOff, Send, Loader2, Check, X } from 'lucide-react'
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase'
import { useVoiceInput } from '@/hooks/useVoiceInput'
import ReactMarkdown from 'react-markdown'

const REFINE_URL = `${SUPABASE_URL}/functions/v1/prompt-refine`

type Msg = { role: 'user' | 'assistant'; content: string; prompt?: string | null }

interface Props {
  currentPrompt: string
  onApplyPrompt: (newPrompt: string) => void | Promise<void>
}

export function PromptRefinementChat({ currentPrompt, onApplyPrompt }: Props) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const voice = useVoiceInput(useCallback((text: string) => {
    setInput(prev => prev ? prev + ' ' + text : text)
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

      const resp = await fetch(REFINE_URL, {
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

  const handleReject = useCallback((idx: number) => {
    setMessages(prev => [...prev, { role: 'user', content: 'Нет, давай по-другому' }])
  }, [])

  // Strip <PROMPT_RESULT> tags from displayed text
  const displayContent = (content: string) => {
    return content.replace(/<PROMPT_RESULT>[\s\S]*?<\/PROMPT_RESULT>/g, '').trim()
  }

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
            <div className={`rounded-lg px-3 py-2 text-xs ${
              m.role === 'user'
                ? 'bg-purple-900/30 text-purple-200 ml-8'
                : 'bg-slate-800/60 text-slate-300 mr-4'
            }`}>
              {m.role === 'assistant' ? (
                <div className="prose prose-sm prose-invert max-w-none [&>p]:m-0 [&>ul]:m-0 [&>ol]:m-0 text-xs">
                  <ReactMarkdown>{displayContent(m.content)}</ReactMarkdown>
                </div>
              ) : (
                m.content
              )}
            </div>

            {/* Apply/Reject buttons when AI proposes a prompt */}
            {m.role === 'assistant' && m.prompt && (
              <div className="flex items-center gap-2 mt-1.5 ml-1">
                <button
                  onClick={() => handleApply(m.prompt!)}
                  disabled={applying}
                  className="flex items-center gap-1 rounded-lg bg-green-700/80 px-3 py-1 text-[11px] font-medium text-white hover:bg-green-600 disabled:opacity-50"
                >
                  {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Применить
                </button>
                <button
                  onClick={() => handleReject(i)}
                  disabled={applying || loading}
                  className="flex items-center gap-1 rounded-lg bg-slate-700/80 px-3 py-1 text-[11px] text-slate-300 hover:bg-slate-600 disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                  Иначе
                </button>
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
