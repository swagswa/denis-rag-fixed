/**
 * E2E test helpers for Denis-RAG Edge Functions
 *
 * Required env vars:
 *   SUPABASE_SERVICE_ROLE_KEY — service role key for authenticated calls
 *   SUPABASE_URL             — (optional) defaults to project URL
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? 'https://kuodvlyepoojqimutmvu.supabase.co'
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1b2R2bHllcG9vanFpbXV0bXZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjIxNjcsImV4cCI6MjA4OTMzODE2N30.vev0KKWj7TUmm5syUL05xgcjKY-BrpyYIrTlojuFMDQ'
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1b2R2bHllcG9vanFpbXV0bXZ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc2MjE2NywiZXhwIjoyMDg5MzM4MTY3fQ.uYntlEUSRS2IT3ilWeHC6f8yOg3EbmWq6Tf8usL91j4'

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`

if (!SERVICE_ROLE_KEY) {
  console.warn(
    'SUPABASE_SERVICE_ROLE_KEY env var not set — falling back to anon key.\n' +
    'Some DB operations may fail due to RLS.',
  )
}

/** Supabase admin client (service_role) — bypasses RLS. Falls back to anon key if service_role is not a valid JWT. */
const adminKey = SERVICE_ROLE_KEY?.startsWith('eyJ') ? SERVICE_ROLE_KEY : ANON_KEY
export const adminClient: SupabaseClient = createClient(SUPABASE_URL, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Supabase anon client — subject to RLS */
export const anonClient: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── Retry helper for transient network errors ──

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 3000): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const isTransient = err?.code === 'ECONNRESET' || err?.message?.includes('fetch failed')
      if (!isTransient || attempt === retries) throw err
      console.warn(`Transient error (attempt ${attempt + 1}/${retries + 1}): ${err.message} — retrying in ${delayMs}ms`)
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  throw new Error('unreachable')
}

// ── HTTP helpers ──

type FetchOptions = {
  method?: string
  body?: unknown
  auth?: 'service_role' | 'anon' | 'none'
  headers?: Record<string, string>
  timeout?: number
}

/**
 * Call an Edge Function and return parsed JSON + status.
 * Default auth: service_role.
 */
export async function callFunction<T = any>(
  fn: string,
  opts: FetchOptions = {},
): Promise<{ status: number; data: T; ok: boolean }> {
  const {
    method = 'POST',
    body,
    auth = 'service_role',
    headers = {},
    timeout = 120_000,
  } = opts

  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  }

  if (auth === 'service_role') {
    // Use the service_role key if it looks like a JWT, otherwise fall back to anon key
    const key = SERVICE_ROLE_KEY.startsWith('eyJ') ? SERVICE_ROLE_KEY : ANON_KEY
    reqHeaders['Authorization'] = `Bearer ${key}`
    reqHeaders['apikey'] = key
  } else if (auth === 'anon') {
    reqHeaders['Authorization'] = `Bearer ${ANON_KEY}`
    reqHeaders['apikey'] = ANON_KEY
  }

  return withRetry(async () => {
    const res = await fetch(`${FUNCTIONS_URL}/${fn}`, {
      method,
      headers: reqHeaders,
      body: body != null ? JSON.stringify(body) : undefined,
    })

    const contentType = res.headers.get('content-type') ?? ''
    let data: any

    if (contentType.includes('text/event-stream')) {
      data = await res.text()
    } else if (contentType.includes('application/json')) {
      data = await res.json()
    } else {
      data = await res.text()
    }

    return { status: res.status, data, ok: res.ok }
  })
}

// ── DB query helpers ──

export async function countRows(
  table: string,
  filters?: Record<string, unknown>,
): Promise<number> {
  return withRetry(async () => {
    let query = adminClient.from(table).select('*', { count: 'exact', head: true })
    if (filters) {
      for (const [col, val] of Object.entries(filters)) {
        query = query.eq(col, val)
      }
    }
    const { count, error } = await query
    if (error) throw new Error(`countRows(${table}): ${error.message}`)
    return count ?? 0
  })
}

export async function getRows<T = any>(
  table: string,
  filters?: Record<string, unknown>,
  opts?: { limit?: number; order?: string },
): Promise<T[]> {
  let query = adminClient.from(table).select('*')
  if (filters) {
    for (const [col, val] of Object.entries(filters)) {
      query = query.eq(col, val)
    }
  }
  if (opts?.order) query = query.order(opts.order, { ascending: false })
  if (opts?.limit) query = query.limit(opts.limit)
  const { data, error } = await query
  if (error) throw new Error(`getRows(${table}): ${error.message}`)
  return (data ?? []) as T[]
}

export async function deleteTestData(table: string, filters: Record<string, unknown>) {
  let query = adminClient.from(table).delete()
  for (const [col, val] of Object.entries(filters)) {
    query = query.eq(col, val)
  }
  await query
}

// ── Snapshot helpers ──

/** Take a "before" snapshot of row counts for comparison */
export async function snapshot(
  tables: string[],
  filters?: Record<string, unknown>,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const t of tables) {
    result[t] = await countRows(t, filters)
  }
  return result
}

// ── Constants ──

/** Tables that actually exist in the production DB */
export const TABLES = [
  'signals',
  'insights',
  'leads',
  'startup_opportunities',
  'factory_flows',
  'agent_feedback',
  'agent_kpi',
  'conversations',
] as const

export const EDGE_FUNCTIONS = [
  'scout-run',
  'analyst-run',
  'marketer-run',
  'builder-run',
  'chain-runner',
  'chat',
  'notify-owner',
  'prompt-refine',
  'speech-to-text',
  'send-outreach',
  'widget-loader',
] as const
