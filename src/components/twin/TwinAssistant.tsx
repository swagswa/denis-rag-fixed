import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, Send, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import ReactMarkdown from 'react-markdown'

type Msg = { role: 'user' | 'assistant'; content: string }

// Chat runs on Lovable Cloud (has LOVABLE_API_KEY)
const CLOUD_URL = import.meta.env.VITE_SUPABASE_URL || 'https://kuodvlyepoojqimutmvu.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_n-B1HcuRd0kDc0spwr-oHg_KI-i0itS'
const CHAT_URL = `${CLOUD_URL}/functions/v1/chat`

const SESSION_KEY = 'dwh-twin-session'
function getSessionId() {
  let id = sessionStorage.getItem(SESSION_KEY)
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(SESSION_KEY, id) }
  return id
}

const QUICK_BUTTONS = [
  'Нужен ИИ-Советник',
  'Хочу трансформацию бизнеса',
  'Есть идея AI-продукта',
]

const GREETING = 'Привет. Я Денис Матеев. С чем пришли: ИИ-Советник, трансформация бизнеса или запуск AI-продукта?'

export function TwinAssistant() {
  const [messages, setMessages] = useState<Msg[]>([{ role: 'assistant', content: GREETING }])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sessionId = useRef(getSessionId())

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = useCallback(async (overrideText?: string) => {
    const text = (overrideText || input).trim()
    if (!text || isLoading) return

    const userMsg: Msg = { role: 'user', content: text }
    if (!overrideText) setInput('')
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)

    let assistantSoFar = ''
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant' && prev.length > 1) return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m))
        return [...prev, { role: 'assistant', content: assistantSoFar }]
      })
    }

    const apiMessages = [...messages.filter((_, i) => i > 0), userMsg]

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
          messages: apiMessages.length > 0 ? apiMessages : [userMsg],
          sessionId: sessionId.current,
          pageContext: { url: window.location.href, title: 'DWH Twin Assistant', section: 'twin-assistant' },
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

        let newlineIndex: number
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex)
          textBuffer = textBuffer.slice(newlineIndex + 1)
          if (line.endsWith('\r')) line = line.slice(0, -1)
          if (line.startsWith(':') || line.trim() === '') continue
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (jsonStr === '[DONE]') break
          try {
            const parsed = JSON.parse(jsonStr)
            const content = parsed.choices?.[0]?.delta?.content as string | undefined
            if (content) upsertAssistant(content)
          } catch { break }
        }
      }

      setIsLoading(false)
      supabase.from('conversations').insert({ user_message: text, ai_message: assistantSoFar, session_id: sessionId.current, page: 'twin-assistant' }).then()
    } catch (e: any) {
      setIsLoading(false)
      setMessages(prev => [...prev, { role: 'assistant', content: e.message || 'Ошибка. Попробуйте позже.' }])
    }
  }, [input, isLoading, messages])

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-slate-100">AI-Ассистент</h2>
        <p className="text-sm text-slate-400">Цифровой двойник Дениса Матеева с доступом к базе знаний и кейсам</p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              m.role === 'user' ? 'bg-blue-600 text-white rounded-br-md' : 'bg-slate-800 text-slate-200 rounded-bl-md'
            }`}>
              {m.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none prose-invert [&>p]:m-0 [&>ul]:m-0 [&>ol]:m-0">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : m.content}
            </div>
          </div>
        ))}

        {messages.length === 1 && !isLoading && (
          <div className="flex flex-col gap-2">
            {QUICK_BUTTONS.map(q => (
              <button key={q} onClick={() => send(q)} className="flex items-center justify-between text-left text-sm px-4 py-2.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
                {q}
                <ArrowRight className="h-4 w-4 opacity-50 shrink-0" />
              </button>
            ))}
          </div>
        )}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-slate-500 animate-bounce [animation-delay:0ms]" />
                <span className="h-2 w-2 rounded-full bg-slate-500 animate-bounce [animation-delay:150ms]" />
                <span className="h-2 w-2 rounded-full bg-slate-500 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={e => { e.preventDefault(); send() }} className="mt-3 flex items-center gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Напишите сообщение..."
          className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-500 transition-colors"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
