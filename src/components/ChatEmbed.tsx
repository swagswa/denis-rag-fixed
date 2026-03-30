import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, ArrowRight, Mic, MicOff } from 'lucide-react'
import { streamChat, type Msg, type PageContext } from '@/lib/chat-stream'
import { collectVisitorContext } from '@/lib/visitor-context'
import { supabase } from '@/lib/supabase'
import ReactMarkdown from 'react-markdown'

const SESSION_KEY = 'dm-chat-session'

function getSessionId() {
  let id = sessionStorage.getItem(SESSION_KEY)
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(SESSION_KEY, id) }
  return id
}

function getPageContext(): PageContext {
  const params = new URLSearchParams(window.location.search)
  if (params.get('embed') === 'true') {
    return {
      url: decodeURIComponent(params.get('pageUrl') || window.location.href),
      title: decodeURIComponent(params.get('pageTitle') || document.title),
      section: decodeURIComponent(params.get('pageSection') || 'главная'),
    }
  }
  return {
    url: window.location.href,
    title: document.title,
    section: window.location.hash.replace('#', '') || 'главная',
  }
}

type SiteProduct = { site: 'foundry' | 'denismateev' | 'unknown'; product: 'aisovetnik' | 'aitransformation' | 'general' }

function getSiteProduct(ctx: PageContext): SiteProduct {
  const url = (ctx.url + ' ' + ctx.section + ' ' + ctx.title).toLowerCase()
  if (url.includes('foundry') || url.includes('agent-fo') || url.includes('ai-foundry')) {
    if (url.includes('ai-advisor') || url.includes('aisovetnik') || url.includes('советник')) return { site: 'denismateev', product: 'aisovetnik' }
    if (url.includes('ai-transformation') || url.includes('aitransformation') || url.includes('трансформаци')) return { site: 'denismateev', product: 'aitransformation' }
    if (url.includes('denismateev')) return { site: 'denismateev', product: 'general' }
    return { site: 'foundry', product: 'general' }
  }
  if (url.includes('ai-advisor') || url.includes('aisovetnik') || url.includes('советник')) return { site: 'denismateev', product: 'aisovetnik' }
  if (url.includes('ai-transformation') || url.includes('aitransformation') || url.includes('трансформаци')) return { site: 'denismateev', product: 'aitransformation' }
  if (url.includes('denismateev') || url.includes('tilda')) return { site: 'denismateev', product: 'general' }
  return { site: 'unknown', product: 'general' }
}

function getHeaderInfo(ctx: PageContext) {
  const { site, product } = getSiteProduct(ctx)
  if (site === 'foundry') return { name: 'Foundry', subtitle: 'AI-студия' }
  if (product === 'aisovetnik') return { name: 'Денис Матеев', subtitle: 'персональное ИИ-сопровождение управленцев' }
  if (product === 'aitransformation') return { name: 'Денис Матеев', subtitle: 'ИИ-трансформация • твой бизнес 2.0' }
  return { name: 'Денис Матеев', subtitle: 'портфель проектов и бизнес-экспертиза' }
}

function getQuickButtons(ctx: PageContext): string[] {
  const { site, product } = getSiteProduct(ctx)
  if (site === 'foundry') return ['У меня есть идея продукта', 'Я инвестор — ищу проекты', 'Хочу создать бизнес на AI', 'Расскажите, как вы работаете']
  if (product === 'aisovetnik') return ['Что именно делает ИИ-Советник?', 'Какая роль поможет в моей ситуации?', 'Как это внедряется в работу?']
  if (product === 'aitransformation') return ['Что у вас входит в трансформацию?', 'С чего начинается работа?', 'У нас буксует команда и рост']
  return ['Нужен ИИ-Советник', 'Хочу трансформацию бизнеса', 'Нужен разбор ситуации', 'Хочу запустить бизнес']
}

function getGreeting(ctx: PageContext): string {
  const { site, product } = getSiteProduct(ctx)
  if (site === 'foundry') return 'Привет! Мы — Foundry, AI-фабрика продуктов. Расскажите, кто вы — предприниматель, инвестор или у вас есть идея?'
  if (product === 'aisovetnik') return 'Привет. Я Денис Матеев. Здесь говорим только про ИИ-Советник. Что сейчас важнее: решения, фокус или разгрузка от рутины?'
  if (product === 'aitransformation') return 'Привет. Я Денис Матеев. Здесь говорим про ИИ-трансформацию бизнеса. Что сейчас буксует сильнее: рост, команда, продажи или управляемость?'
  return 'Привет. Я Денис Матеев. С чем пришли: ИИ-Советник, трансформация бизнеса или запуск AI-продукта?'
}

function getAccentColor(ctx: PageContext): string {
  const params = new URLSearchParams(window.location.search)
  const c = params.get('headerColor')
  if (c) return decodeURIComponent(c)
  const { site, product } = getSiteProduct(ctx)
  if (site === 'foundry') return '#1a1a2e'
  if (product === 'aisovetnik' || product === 'aitransformation') return '#ec7528'
  return '#1a1a2e'
}

// Simple hook for Web Speech API
function useSpeechRecognition(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<any>(null)

  const supported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const toggle = useCallback(() => {
    if (!supported) return

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop()
      setIsListening(false)
      return
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.lang = 'ru-RU'
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      onResult(transcript)
      setIsListening(false)
    }

    recognition.onerror = () => setIsListening(false)
    recognition.onend = () => setIsListening(false)

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [isListening, supported, onResult])

  return { isListening, toggle, supported }
}

export default function ChatEmbed() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sessionId = useRef(getSessionId())
  const [pageCtx] = useState<PageContext>(getPageContext)
  const visitorRef = useRef(collectVisitorContext())

  const headerInfo = getHeaderInfo(pageCtx)
  const quickButtons = getQuickButtons(pageCtx)
  const accentColor = getAccentColor(pageCtx)

  const handleVoiceResult = useCallback((text: string) => {
    setInput(prev => (prev ? prev + ' ' + text : text))
  }, [])

  const { isListening, toggle: toggleMic, supported: micSupported } = useSpeechRecognition(handleVoiceResult)

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{ role: 'assistant', content: getGreeting(pageCtx) }])
    }
  }, [])

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
      visitorRef.current = collectVisitorContext()
      await streamChat({
        messages: apiMessages.length > 0 ? apiMessages : [userMsg],
        sessionId: sessionId.current,
        pageContext: pageCtx,
        visitorContext: visitorRef.current,
        onDelta: upsertAssistant,
        onDone: () => {
          setIsLoading(false)
          const isLead = assistantSoFar.includes('@deyuma')
          supabase.from('conversations').insert({
            user_message: text,
            ai_message: assistantSoFar,
            session_id: sessionId.current,
            page: pageCtx.url,
            ...(isLead ? { is_lead: true } : {}),
          }).then()
        },
      })
    } catch (e: any) {
      setIsLoading(false)
      setMessages(prev => [...prev, { role: 'assistant', content: e.message || 'Ошибка. Попробуйте позже.' }])
    }
  }, [input, isLoading, messages, pageCtx])

  // Derive lighter tint for assistant bubbles
  const assistantBg = '#f3f4f6'

  return (
    <div className="flex w-full h-screen flex-col bg-white overflow-hidden" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100" style={{ backgroundColor: '#fff' }}>
        <div
          className="flex items-center justify-center rounded-full shrink-0"
          style={{ width: 36, height: 36, backgroundColor: accentColor, color: '#fff', fontSize: 14, fontWeight: 600 }}
        >
          {headerInfo.name.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{headerInfo.name}</p>
          <p className="truncate text-xs text-gray-500">{headerInfo.subtitle}</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                m.role === 'user' ? 'text-white rounded-br-md' : 'text-gray-800 rounded-bl-md bg-white'
              }`}
              style={m.role === 'user' ? { backgroundColor: accentColor } : undefined}
            >
              {m.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none [&>p]:m-0 [&>ul]:m-0 [&>ol]:m-0">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : m.content}
            </div>
          </div>
        ))}

        {messages.length === 1 && messages[0].role === 'assistant' && !isLoading && (
          <div className="flex flex-col gap-2 mt-1">
            {quickButtons.map(q => (
              <button
                key={q}
                onClick={() => send(q)}
                className="flex items-center justify-between text-left text-sm px-4 py-2.5 rounded-xl bg-white shadow-sm hover:shadow transition-all border border-gray-100"
                style={{ color: accentColor }}
              >
                <span>{q}</span>
                <ArrowRight className="h-3.5 w-3.5 opacity-40 shrink-0 ml-2" />
              </button>
            ))}
          </div>
        )}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-white shadow-sm">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-gray-300 animate-bounce [animation-delay:0ms]" />
                <span className="h-2 w-2 rounded-full bg-gray-300 animate-bounce [animation-delay:150ms]" />
                <span className="h-2 w-2 rounded-full bg-gray-300 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 bg-white px-4 py-3">
        <form onSubmit={e => { e.preventDefault(); send() }} className="flex items-center gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Напишите сообщение..."
            className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:bg-white transition-colors"
          />
          {micSupported && (
            <button
              type="button"
              onClick={toggleMic}
              className="flex h-10 w-10 items-center justify-center rounded-full transition-colors"
              style={{
                backgroundColor: isListening ? '#ef4444' : accentColor + '12',
                color: isListening ? '#fff' : accentColor,
              }}
              title={isListening ? 'Остановить запись' : 'Голосовой ввод'}
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white disabled:opacity-40 transition-colors"
            style={{ backgroundColor: accentColor }}
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  )
}
