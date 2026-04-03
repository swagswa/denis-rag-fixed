import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Send, Loader2, Mic, MicOff, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase'
import { useVoiceInput } from '@/hooks/useVoiceInput'

const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`

type Message = { role: 'user' | 'assistant'; content: string }

interface Props {
  agentName: string
  mandateKey: string
  currentMandate: string
  open: boolean
  onClose: () => void
  onMandateUpdated: () => void
}

const SYSTEM_PROMPT = `Ты — директор AI-завода. Ты помогаешь корректировать мандаты (промты) агентов.

КОНТЕКСТ: Пользователь редактирует мандат агента — инструкцию, по которой работает AI-агент в конвейере.
Конвейер: Скаут → Аналитик → Маркетолог/Создатель.

ПРАВИЛА:
1. Понимай контекст: пользователь описывает ЧТО изменить в мандате агента
2. Задавай уточняющие вопросы если инструкция неясна
3. Когда готов внести правки — ответь ОБНОВЛЁННЫМ МАНДАТОМ ЦЕЛИКОМ, обернув его в тег:
<updated_mandate>
...полный текст обновлённого мандата...
</updated_mandate>
4. Перед обновлением кратко объясни ЧТО ты меняешь (1-2 предложения)
5. Если пользователь просто спрашивает — отвечай без тега
6. Сохраняй ВСЮ структуру и форматирование оригинала, меняй ТОЛЬКО то, что просят`

export function MandateChatDialog({ agentName, mandateKey, currentMandate, open, onClose, onMandateUpdated }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [mandate, setMandate] = useState(currentMandate)
  const [showMandate, setShowMandate] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const voice = useVoiceInput(useCallback((text: string) => {
    setInput(text)
  }, []))

  useEffect(() => {
    setMandate(currentMandate)
    setMessages([])
  }, [currentMandate, mandateKey])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const saveMandate = async (newText: string) => {
    const dk = `mandate:${mandateKey}`
    const { data: ex } = await supabase.from('documents' as any).select('id').eq('source_ref', dk).limit(1)
    if ((ex as any)?.length) {
      await supabase.from('documents' as any).update({ content: newText, updated_at: new Date().toISOString() } as any).eq('id', (ex as any)[0].id)
    } else {
      await supabase.from('documents' as any).insert({ title: `Мандат: ${agentName}`, content: newText, source_type: 'agent_mandate', source_ref: dk, source_name: mandateKey } as any)
    }
    setMandate(newText)
    onMandateUpdated()
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return

    if (voice.isRecording) voice.toggle()

    const userMsg: Message = { role: 'user', content: text }
    const allMessages = [...messages, userMsg]
    setMessages(allMessages)
    setInput('')
    setLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Сессия истекла')

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(SUPABASE_PUBLISHABLE_KEY ? { apikey: SUPABASE_PUBLISHABLE_KEY } : {}),
        },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: `ТЕКУЩИЙ МАНДАТ АГЕНТА "${agentName}":\n---\n${mandate}\n---\n\nДиалог начинается.` },
            ...allMessages.map(m => ({ role: m.role, content: m.content })),
          ],
          sessionId: `mandate-${mandateKey}-${Date.now()}`,
          pageContext: { url: window.location.href, title: `Мандат: ${agentName}`, section: 'mandate-edit' },
          system_prompt_override: SYSTEM_PROMPT,
          model: 'openai/gpt-5.2',
          model_override: 'openai/gpt-5.2',
          force_model: 'openai/gpt-5.2',
          isTest: true,
        }),
      })

      if (!resp.ok || !resp.body) throw new Error('Ошибка AI')

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
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (jsonStr === '[DONE]') break
          try {
            const parsed = JSON.parse(jsonStr)
            const content = parsed.choices?.[0]?.delta?.content
            if (content) {
              result += content
              setMessages(prev => {
                const last = prev[prev.length - 1]
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { role: 'assistant', content: last.content + content }]
                }
                return [...prev, { role: 'assistant', content }]
              })
            }
          } catch { break }
        }
      }

      // Check if the response contains an updated mandate
      const mandateMatch = result.match(/<updated_mandate>\s*([\s\S]*?)\s*<\/updated_mandate>/)
      if (mandateMatch) {
        await saveMandate(mandateMatch[1].trim())
        // Add a system-like note
        setMessages(prev => [...prev, { role: 'assistant', content: '✅ Мандат обновлён и сохранён.' }])
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ ' + (e.message || 'Ошибка') }])
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl h-[80vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-100">Мандат: {agentName}</h3>
            <p className="text-[10px] text-slate-500">Опиши голосом или текстом, что изменить — AI обновит мандат</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"><X className="h-4 w-4" /></button>
        </div>

        {/* Collapsible current mandate */}
        <div className="border-b border-slate-800">
          <button onClick={() => setShowMandate(!showMandate)} className="flex items-center justify-between w-full px-4 py-2 text-[11px] text-slate-400 hover:bg-slate-800/50">
            <span className="font-medium">Текущий мандат ({mandate.length} символов)</span>
            {showMandate ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showMandate && (
            <div className="px-4 pb-3 max-h-48 overflow-y-auto">
              <pre className="text-[10px] text-slate-500 whitespace-pre-wrap font-mono leading-relaxed">{mandate}</pre>
            </div>
          )}
        </div>

        {/* Chat messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-slate-500 mb-2">💬 Чат с AI-директором</p>
              <p className="text-xs text-slate-600">Примеры:</p>
              <div className="space-y-1 mt-2">
                {[
                  'Добавь в мандат фокус на компании из сферы логистики',
                  'Сделай фильтрацию строже — пропускай только с доказательствами спроса',
                  'Убери ограничение по размеру компании',
                ].map((ex, i) => (
                  <button key={i} onClick={() => setInput(ex)} className="block mx-auto text-[11px] text-purple-400 hover:text-purple-300 hover:underline">
                    «{ex}»
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-purple-600/30 text-purple-100 border border-purple-500/20'
                  : msg.content.startsWith('✅') ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-500/20'
                  : msg.content.startsWith('❌') ? 'bg-red-900/30 text-red-300 border border-red-500/20'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
              }`}>
                <p className="whitespace-pre-wrap">{
                  // Hide the <updated_mandate> tag content from display
                  msg.content.replace(/<updated_mandate>[\s\S]*?<\/updated_mandate>/g, '').trim()
                }</p>
              </div>
            </div>
          ))}
          {loading && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="flex justify-start">
              <div className="rounded-xl px-3 py-2 bg-slate-800 border border-slate-700">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={e => { e.preventDefault(); handleSend() }} className="flex items-center gap-2 px-4 py-3 border-t border-slate-800">
          <button
            type="button"
            onClick={voice.toggle}
            disabled={voice.isTranscribing}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
              voice.isRecording
                ? 'bg-red-600 text-white animate-pulse'
                : voice.isTranscribing
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
            title={voice.isRecording ? 'Остановить' : voice.isTranscribing ? 'Распознаю...' : 'Голосовой ввод'}
          >
            {voice.isRecording ? <MicOff className="h-4 w-4" /> : voice.isTranscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
          </button>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={voice.isRecording ? 'Говорите...' : 'Что изменить в мандате...'}
            disabled={loading}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-600 text-white disabled:opacity-40 hover:bg-purple-500"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  )
}
