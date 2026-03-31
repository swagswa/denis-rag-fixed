import { supabase } from './supabase'

// Edge functions for factories run on the ORIGINAL Supabase
const SUPABASE_URL = 'https://kuodvlyepoojqimutmvu.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_n-B1HcuRd0kDc0spwr-oHg_KI-i0itS'
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`

export async function edgeFetch(fn: string, options?: RequestInit) {
  let { data: { session } } = await supabase.auth.getSession()

  const expiresAt = session?.expires_at ?? 0
  if (!session?.access_token || expiresAt < Date.now() / 1000 + 60) {
    const { data } = await supabase.auth.refreshSession()
    session = data.session
  }

  if (!session?.access_token) {
    throw new Error('Не авторизован — войдите в систему')
  }
  return fetch(`${FUNCTIONS_URL}/${fn}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
      ...options?.headers,
    },
  })
}

const CHUNK_SIZE = 1_500_000

export async function uploadDocument(
  parsed: { text: string; format: string; pageCount?: number },
  filename: string,
  onChunkProgress?: (chunk: number, totalChunks: number) => void,
): Promise<void> {
  const { text, format, pageCount } = parsed

  if (text.length <= CHUNK_SIZE) {
    onChunkProgress?.(0, 1)
    const res = await edgeFetch('sync-documents', {
      method: 'POST',
      body: JSON.stringify({ text, filename, format, pageCount }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Ошибка: ${res.status}`)
    }
    return
  }

  const totalChunks = Math.ceil(text.length / CHUNK_SIZE)
  for (let i = 0; i < totalChunks; i++) {
    onChunkProgress?.(i, totalChunks)
    const chunk = text.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    const res = await edgeFetch('sync-documents', {
      method: 'POST',
      body: JSON.stringify({ text: chunk, filename, format, pageCount, chunk: i, totalChunks }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Ошибка загрузки части ${i + 1}/${totalChunks}: ${res.status}`)
    }
  }
}

export type AgentRunResult = {
  fn: string
  success: boolean
  data?: any
  error?: string
}

export async function runAgentChain(
  factory: 'consulting' | 'foundry',
  onStep?: (step: string, result: AgentRunResult) => void,
): Promise<AgentRunResult[]> {
  const results: AgentRunResult[] = []

  const chain = factory === 'consulting'
    ? ['scout-run', 'analyst-run', 'marketer-run']
    : ['scout-run', 'analyst-run', 'builder-run']

  for (const fn of chain) {
    onStep?.(fn, { fn, success: true })
    try {
      const res = await edgeFetch(fn, {
        method: 'POST',
        body: JSON.stringify({ triggered_by: 'manual' }),
      })
      const data = await res.json().catch(() => ({}))
      const result: AgentRunResult = { fn, success: res.ok, data }
      results.push(result)
      onStep?.(fn, result)
      if (!res.ok) break
    } catch (e: any) {
      const result: AgentRunResult = { fn, success: false, error: e.message }
      results.push(result)
      onStep?.(fn, result)
      break
    }
  }

  return results
}
