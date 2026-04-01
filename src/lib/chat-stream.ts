import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase'

const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`

export type Msg = { role: 'user' | 'assistant'; content: string }

export type PageContext = {
  url: string
  title: string
  section: string
}

export type VisitorContext = {
  referrer: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmContent: string
  device: 'mobile' | 'tablet' | 'desktop'
  language: string
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'
  localHour: number
  isReturning: boolean
  visitCount: number
  pagesViewed: string[]
  currentSection: string
  scrollDepthPercent: number
  secondsOnPage: number
}

export async function streamChat({
  messages,
  sessionId,
  pageContext,
  visitorContext,
  onDelta,
  onDone,
}: {
  messages: Msg[]
  sessionId: string
  pageContext?: PageContext
  visitorContext?: VisitorContext
  onDelta: (deltaText: string) => void
  onDone: () => void
}) {
  const resp = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ messages, sessionId, pageContext, visitorContext }),
  })

  if (!resp.ok || !resp.body) {
    if (resp.status === 429) throw new Error('Слишком много запросов, попробуйте позже.')
    if (resp.status === 402) throw new Error('Превышен лимит использования AI.')
    let errMsg = 'Ошибка соединения'
    try {
      const errData = await resp.json()
      if (errData?.error) errMsg = errData.error
    } catch {}
    throw new Error(errMsg)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let textBuffer = ''
  let streamDone = false

  while (!streamDone) {
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
      if (jsonStr === '[DONE]') { streamDone = true; break }

      try {
        const parsed = JSON.parse(jsonStr)
        const content = parsed.choices?.[0]?.delta?.content as string | undefined
        if (content) onDelta(content)
      } catch {
        textBuffer = line + '\n' + textBuffer
        break
      }
    }
  }

  if (textBuffer.trim()) {
    for (let raw of textBuffer.split('\n')) {
      if (!raw) continue
      if (raw.endsWith('\r')) raw = raw.slice(0, -1)
      if (raw.startsWith(':') || raw.trim() === '') continue
      if (!raw.startsWith('data: ')) continue
      const jsonStr = raw.slice(6).trim()
      if (jsonStr === '[DONE]') continue
      try {
        const parsed = JSON.parse(jsonStr)
        const content = parsed.choices?.[0]?.delta?.content as string | undefined
        if (content) onDelta(content)
      } catch { /* ignore */ }
    }
  }

  onDone()
}
