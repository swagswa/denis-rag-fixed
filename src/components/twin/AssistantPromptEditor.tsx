import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Send, RotateCcw, Save, Eye } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

type ProductContext = 'general' | 'foundry' | 'aisovetnik' | 'aitransformation'

const PRODUCT_OPTIONS: { value: ProductContext; label: string }[] = [
  { value: 'general', label: 'Общий (denismateev.ru)' },
  { value: 'foundry', label: 'Foundry' },
  { value: 'aisovetnik', label: 'AI-Советник' },
  { value: 'aitransformation', label: 'AI-Трансформация' },
]

const SECTION_MAP: Record<ProductContext, string> = {
  general: 'denismateev.ru',
  foundry: 'agent-fo.lovableproject.com',
  aisovetnik: 'ai-advisor',
  aitransformation: 'ai-transformation',
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://kuodvlyepoojqimutmvu.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_n-B1HcuRd0kDc0spwr-oHg_KI-i0itS'
const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`

type Msg = { role: 'user' | 'assistant'; content: string }

export function AssistantPromptEditor() {
  const [selectedProduct, setSelectedProduct] = useState<ProductContext>('general')
  const [promptText, setPromptText] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [productPrompts, setProductPrompts] = useState<Record<string, string>>({})
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showDefault, setShowDefault] = useState(false)

  // Test chat state
  const [messages, setMessages] = useState<Msg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load settings
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('settings')
        .select('id, system_prompt, product_prompts')
        .limit(1)
        .single()
      if (data) {
        setSettingsId(data.id)
        setSystemPrompt(data.system_prompt || '')
        setProductPrompts(data.product_prompts || {})
      }
      setLoading(false)
    }
    load()
  }, [])

  // Update prompt text when product selection changes
  useEffect(() => {
    if (selectedProduct === 'general') {
      setPromptText(systemPrompt)
    } else {
      setPromptText(productPrompts[selectedProduct] || '')
    }
    setMessages([])
    setShowDefault(false)
  }, [selectedProduct, systemPrompt, productPrompts])

  // Auto-scroll chat
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleSave = async () => {
    if (!settingsId) return
    setSaving(true)
    try {
      if (selectedProduct === 'general') {
        const { error } = await supabase.from('settings').update({ system_prompt: promptText }).eq('id', settingsId)
        if (error) throw error
        setSystemPrompt(promptText)
      } else {
        const updated = { ...productPrompts, [selectedProduct]: promptText }
        // Remove empty entries so the edge function falls back to default
        if (!promptText.trim()) delete updated[selectedProduct]
        const { error } = await supabase.from('settings').update({ product_prompts: updated }).eq('id', settingsId)
        if (error) throw error
        setProductPrompts(updated)
      }
      toast.success('Промпт сохранён')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

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

    const apiMessages = [...messages.filter(m => m.role !== 'assistant' || messages.indexOf(m) > 0), userMsg]

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
          pageContext: { url: SECTION_MAP[selectedProduct], title: 'Prompt Test', section: SECTION_MAP[selectedProduct] },
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
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: e.message || 'Ошибка' }])
    } finally {
      setChatLoading(false)
    }
  }, [chatInput, chatLoading, messages, promptText, selectedProduct])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-100">Промпт ассистента</h2>
        <p className="mt-1 text-sm text-slate-500">Редактируйте промпт слева, тестируйте справа. Изменения применяются в тестовом чате до сохранения.</p>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
        {/* LEFT — Prompt Editor */}
        <div className="flex flex-col min-h-0 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center gap-3 mb-3">
            <select
              value={selectedProduct}
              onChange={e => setSelectedProduct(e.target.value as ProductContext)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            >
              {PRODUCT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => setShowDefault(!showDefault)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:bg-slate-800"
            >
              <Eye className="h-3.5 w-3.5" />
              {showDefault ? 'Скрыть дефолт' : 'Показать дефолт'}
            </button>
          </div>

          {showDefault && (
            <div className="mb-3 max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-500 font-mono whitespace-pre-wrap">
              {selectedProduct === 'general'
                ? 'Дефолтный промпт для "Общий" берётся из этого же поля. Если поле пустое — используется только базовый стиль из edge function.'
                : `Хардкоженный промпт для "${PRODUCT_OPTIONS.find(o => o.value === selectedProduct)?.label}" находится в edge function chat/index.ts. Если вы заполните поле ниже — он будет заменён на ваш текст.`}
            </div>
          )}

          <textarea
            value={promptText}
            onChange={e => setPromptText(e.target.value)}
            placeholder={selectedProduct === 'general'
              ? 'Системный промпт для основного сайта...'
              : `Промпт для ${PRODUCT_OPTIONS.find(o => o.value === selectedProduct)?.label}. Оставьте пустым чтобы использовать дефолт.`}
            className="flex-1 min-h-0 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 resize-none font-mono leading-relaxed"
          />

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            {selectedProduct !== 'general' && productPrompts[selectedProduct] && (
              <button
                onClick={() => {
                  setPromptText('')
                  const updated = { ...productPrompts }
                  delete updated[selectedProduct]
                  setProductPrompts(updated)
                  supabase.from('settings').update({ product_prompts: updated }).eq('id', settingsId!).then(() => toast.success('Сброшено на дефолт'))
                }}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:bg-slate-800"
              >
                Сбросить на дефолт
              </button>
            )}
          </div>
        </div>

        {/* RIGHT — Test Chat */}
        <div className="flex flex-col min-h-0 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <span className="text-sm font-medium text-slate-300">Тестовый чат</span>
            <button
              onClick={() => setMessages([])}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Очистить
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
            {messages.length === 0 && (
              <p className="text-center text-sm text-slate-600 py-8">Напишите сообщение чтобы проверить как бот отвечает с текущим промптом</p>
            )}
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
            {chatLoading && messages[messages.length - 1]?.role !== 'assistant' && (
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

          <form onSubmit={e => { e.preventDefault(); sendTestMessage() }} className="flex items-center gap-2 px-4 py-3 border-t border-slate-800">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Тестовое сообщение..."
              className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || chatLoading}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-500"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
