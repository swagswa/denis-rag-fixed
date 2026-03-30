import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Wand2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://kuodvlyepoojqimutmvu.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_n-B1HcuRd0kDc0spwr-oHg_KI-i0itS'

type Msg = { role: 'user' | 'assistant'; content: string }

interface Props {
  currentPrompt: string
  onApplyPrompt: (newPrompt: string) => void
}

export function PromptRefinementChat({ currentPrompt, onApplyPrompt }: Props) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Msg = { role: 'user', content: text }
    setInput('')
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          messages: [
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: text },
          ],
          sessionId: `prompt-refine-${Date.now()}`,
          pageContext: { url: 'prompt-refinement', title: 'Prompt Refinement', section: 'admin' },
          system_prompt_override: `Ты — эксперт по написанию системных промтов для ИИ-ассистентов. Пользователь дорабатывает промт для чат-бота на сайте Дениса Матеева.

ТЕКУЩИЙ ПРОМТ:
---
${currentPrompt}
---

Твоя задача:
1. Понять, что пользователь хочет изменить
2. Предложить конкретные правки в промте
3. Если пользователь согласен — выдать ПОЛНЫЙ обновлённый промт, обёрнутый в тройные обратные кавычки (\`\`\`)

Отвечай коротко и по делу. Если пользователь просит что-то добавить/изменить — сразу показывай результат.`,
          isTest: true,
        }),
      })

      if (!resp.ok || !resp.body) throw new Error('Ошибка соединения')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let textBuffer = ''
      let assistantSoFar = ''

      const upsert = (chunk: string) => {
        assistantSoFar += chunk
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m))
          }
          return [...prev, { role: 'assistant', content: assistantSoFar }]
        })
      }

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
            if (content) upsert(content)
          } catch { break }
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: e.message || 'Ошибка' }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, currentPrompt])

  // Extract code block from last assistant message and apply
  const applyFromLastMessage = () => {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    if (!lastAssistant) return
    const match = lastAssistant.content.match(/```[\s\S]*?\n([\s\S]*?)```/)
    if (match) {
      onApplyPrompt(match[1].trim())
    }
  }

  const hasCodeBlock = messages.some(m => m.role === 'assistant' && /```[\s\S]*?\n[\s\S]*?```/.test(m.content))

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Wand2 className="h-3.5 w-3.5 text-purple-400" />
          <span className="text-xs font-medium text-slate-300">Доработка промпта</span>
        </div>
        {hasCodeBlock && (
          <button
            onClick={applyFromLastMessage}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-500"
          >
            Применить изменения
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {messages.length === 0 && (
          <p className="text-center text-xs text-slate-600 py-4">
            Напиши что изменить в промте — ИИ предложит правки
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
              m.role === 'user' ? 'bg-purple-600/80 text-white rounded-br-sm' : 'bg-slate-800 text-slate-200 rounded-bl-sm'
            }`}>
              {m.role === 'assistant' ? (
                <div className="prose prose-xs max-w-none prose-invert [&>p]:m-0 [&>ul]:m-0 [&>pre]:text-[10px]">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : m.content}
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.role !== 'assistant' && (
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

      <form onSubmit={e => { e.preventDefault(); sendMessage() }} className="flex items-center gap-2 px-3 py-2 border-t border-slate-800">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Что изменить в промте..."
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-purple-500"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-600 text-white disabled:opacity-50 hover:bg-purple-500"
        >
          <Send className="h-3 w-3" />
        </button>
      </form>
    </div>
  )
}
