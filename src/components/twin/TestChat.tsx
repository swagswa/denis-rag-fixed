import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Send, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

// Chat runs on Lovable Cloud (has LOVABLE_API_KEY)
const CLOUD_URL = import.meta.env.VITE_SUPABASE_URL || 'https://kuodvlyepoojqimutmvu.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_n-B1HcuRd0kDc0spwr-oHg_KI-i0itS'
const CHAT_URL = `${CLOUD_URL}/functions/v1/chat`

type Msg = { role: 'user' | 'assistant'; content: string }

interface Props {
  promptText: string
  sectionKey: string
}

export function TestChat({ promptText, sectionKey }: Props) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Reset on product change
  useEffect(() => { setMessages([]) }, [sectionKey])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const sendTestMessage = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || chatLoading) return

    const userMsg: Msg = { role: 'user', content: text }
    setChatInput('')
    setMessages(prev => [...prev, userMsg])
    setChatLoading(true)

    let assistantSoFar = ''
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant') {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m))
        }
        return [...prev, { role: 'assistant', content: assistantSoFar }]
      })
    }

    const apiMessages = [...messages, userMsg]

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          messages: apiMessages.map(m => ({ role: m.role, content: m.content })),
          sessionId: `test-${Date.now()}`,
          pageContext: { url: sectionKey, title: 'Prompt Test', section: sectionKey },
          system_prompt_override: promptText || undefined,
          isTest: true,
        }),
      })

      if (!resp.ok || !resp.body) throw new Error('Ошибка соединения')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let textBuffer = ''

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
            if (content) upsertAssistant(content)
          } catch { break }
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: e.message || 'Ошибка' }])
    } finally {
      setChatLoading(false)
    }
  }, [chatInput, chatLoading, messages, promptText, sectionKey])

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
        <span className="text-xs font-medium text-slate-300">💬 Тестовый чат</span>
        <button
          onClick={() => setMessages([])}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-300"
        >
          <RotateCcw className="h-3 w-3" />
          Очистить
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {messages.length === 0 && (
          <p className="text-center text-xs text-slate-600 py-4">Проверь как бот отвечает с текущим промптом</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
              m.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-slate-800 text-slate-200 rounded-bl-sm'
            }`}>
              {m.role === 'assistant' ? (
                <div className="prose prose-xs max-w-none prose-invert [&>p]:m-0 [&>ul]:m-0">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : m.content}
            </div>
          </div>
        ))}
        {chatLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-xl rounded-bl-sm px-3 py-2">
              <div className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={e => { e.preventDefault(); sendTestMessage() }} className="flex items-center gap-2 px-3 py-2 border-t border-slate-800">
        <input
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          placeholder="Тестовое сообщение..."
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={!chatInput.trim() || chatLoading}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-500"
        >
          <Send className="h-3 w-3" />
        </button>
      </form>
    </div>
  )
}
