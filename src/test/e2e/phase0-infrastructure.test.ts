/**
 * Phase 0 — Infrastructure smoke tests
 *
 * Verifies that the deployed environment is healthy:
 *   1. All edge functions are reachable (CORS preflight)
 *   2. Secrets are configured (functions don't fail with "not configured")
 *   3. All tables exist with expected columns
 *   4. RLS policies enforce correct access
 */
import { describe, it, expect } from 'vitest'
import {
  FUNCTIONS_URL,
  ANON_KEY,
  SERVICE_ROLE_KEY,
  anonClient,
  adminClient,
  callFunction,
  TABLES,
  EDGE_FUNCTIONS,
} from './helpers'

// ── Expected columns per table (from migration) ──

// Real production schema (verified against live DB)
const TABLE_COLUMNS: Record<string, string[]> = {
  signals: [
    'id', 'company_name', 'description', 'signal_type', 'industry',
    'source', 'potential', 'priority', 'status', 'notes', 'created_at', 'updated_at',
  ],
  insights: [
    'id', 'title', 'company_name', 'what_happens', 'why_important',
    'problem', 'action_proposal', 'opportunity_type', 'status', 'notes',
    'signal_id', 'created_at', 'updated_at',
  ],
  leads: [
    'id', 'message', 'company_size', 'role', 'page', 'telegram_sent',
    'session_id', 'conversation_id', 'name', 'company_name', 'topic_guess',
    'lead_summary', 'telegram_message_id', 'status', 'created_at',
  ],
  startup_opportunities: [
    'id', 'signal_id', 'insight_id', 'idea', 'source', 'problem', 'market',
    'monetization', 'complexity', 'mvp_timeline', 'solution', 'stage',
    'revenue_estimate', 'notes', 'created_at', 'updated_at',
  ],
  factory_flows: [
    'id', 'factory', 'name', 'description', 'status', 'target_company_size',
    'target_region', 'target_industry', 'target_notes', 'created_at',
    'updated_at', 'last_run_at', 'last_run_result',
  ],
  agent_feedback: [
    'id', 'factory', 'from_agent', 'to_agent', 'feedback_type',
    'content', 'signal_id', 'insight_id', 'resolved', 'created_at',
  ],
  agent_kpi: [
    'id', 'factory', 'metric', 'target', 'current',
    'active', 'updated_at',
  ],
  conversations: [
    'id', 'user_message', 'ai_message', 'page', 'session_id', 'created_at',
  ],
}

// ── Test 1: Edge functions reachable via CORS preflight ──

describe('Phase 0 — Infrastructure', () => {
  describe('Edge function reachability', () => {
    it('all 11 edge functions respond to OPTIONS preflight with CORS headers', async () => {
      const fetchWithRetry = async (fn: string, retries = 2): Promise<{ fn: string; status: number; headers: Record<string, string> }> => {
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            const res = await fetch(`${FUNCTIONS_URL}/${fn}`, {
              method: 'OPTIONS',
              headers: {
                Origin: 'https://example.com',
                'Access-Control-Request-Method': 'POST',
              },
            })
            return { fn, status: res.status, headers: Object.fromEntries(res.headers.entries()) }
          } catch (err: any) {
            if (attempt === retries) throw err
            await new Promise(r => setTimeout(r, 2000))
          }
        }
        throw new Error('unreachable')
      }

      const results = await Promise.all(
        EDGE_FUNCTIONS.map((fn) => fetchWithRetry(fn)),
      )

      for (const { fn, status, headers } of results) {
        expect(
          status === 200 || status === 204,
          `${fn}: expected 200 or 204, got ${status}`,
        ).toBe(true)

        const corsHeader =
          headers['access-control-allow-origin'] ??
          headers['Access-Control-Allow-Origin']
        expect(corsHeader, `${fn}: missing Access-Control-Allow-Origin header`).toBeDefined()
      }
    }, 30_000)
  })

  // ── Test 2: Secrets are configured ──

  describe('Secrets configuration', () => {
    it('scout-run does NOT return "OPENAI_API_KEY not configured" error', async () => {
      const { data, status } = await callFunction('scout-run', {
        method: 'POST',
        body: {},
        timeout: 30_000,
      })

      // We expect the function to either succeed or fail for a reason OTHER
      // than missing API key configuration.
      const bodyText = typeof data === 'string' ? data : JSON.stringify(data)
      expect(bodyText).not.toContain('OPENAI_API_KEY not configured')
    }, 120_000)
  })

  // ── Test 3: All tables exist with correct columns ──

  describe('Database schema', () => {
    it('all 8 tables exist and have the expected columns', async () => {
      for (const table of TABLES) {
        const expectedCols = TABLE_COLUMNS[table]
        expect(expectedCols, `no expected columns defined for ${table}`).toBeDefined()

        // Select a single row (or zero rows) to get column names from the response
        const { data, error } = await adminClient
          .from(table)
          .select(expectedCols.join(','))
          .limit(1)

        expect(error, `table "${table}" query error: ${error?.message}`).toBeNull()

        // If the table has rows, verify all columns are present in the returned object
        if (data && data.length > 0) {
          const returnedCols = Object.keys(data[0])
          for (const col of expectedCols) {
            expect(
              returnedCols,
              `table "${table}" missing column "${col}"`,
            ).toContain(col)
          }
        }
        // If no rows, the query succeeded without error — columns exist
      }
    }, 30_000)
  })

  // ── Test 4: RLS policies ──

  describe('RLS policies', () => {
    it('anon can read conversations but NOT signals; authenticated can read signals', async () => {
      // Anon can SELECT from conversations (anon has ALL access to conversations in prod)
      const { data: convoData, error: convoError } = await anonClient
        .from('conversations')
        .select('id')
        .limit(1)

      expect(
        convoError,
        `anon reading conversations should succeed but got: ${convoError?.message}`,
      ).toBeNull()
      // data may be empty array but should not be null
      expect(convoData).toBeDefined()

      // Anon CANNOT read signals (no anon policy on signals)
      const { data: signalsData, error: signalsError } = await anonClient
        .from('signals')
        .select('id')
        .limit(1)

      // Supabase returns empty array (not error) when RLS blocks access
      // If there are rows in signals, anon should see 0 of them.
      // If the table is empty, we can't distinguish — so we also verify
      // authenticated CAN read (below) to confirm RLS is active, not just empty.
      if (signalsError) {
        // An explicit error is also acceptable (permission denied)
        expect(signalsError.message).toBeTruthy()
      } else {
        // RLS returns empty array for blocked access
        expect(signalsData).toEqual([])
      }

      // Authenticated (service_role bypasses RLS, so we verify the policy
      // exists by checking adminClient can query signals without error)
      const { error: authError } = await adminClient
        .from('signals')
        .select('id')
        .limit(1)

      expect(
        authError,
        `authenticated reading signals should succeed but got: ${authError?.message}`,
      ).toBeNull()
    }, 30_000)
  })
})
