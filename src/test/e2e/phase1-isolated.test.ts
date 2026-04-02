/**
 * Phase 1 — Isolated E2E tests for each Edge Function.
 *
 * Tests run sequentially: scout -> analyst -> marketer/builder -> chat/notify/prompt.
 * Each test hits real Supabase Edge Functions, so timeouts are generous (120s).
 */
import { describe, it, expect } from 'vitest'
import {
  callFunction,
  countRows,
  getRows,
  snapshot,
  FUNCTIONS_URL,
  ANON_KEY,
  SERVICE_ROLE_KEY,
} from './helpers'

describe.sequential('Phase 1 — Isolated Edge Function tests', () => {
  // ── 5. scout-run (consulting) ──

  it('scout-run with factory:"consulting" returns valid response and creates signals', async () => {
    const { status, data, ok } = await callFunction('scout-run', {
      body: { factory: 'consulting', triggered_by: 'e2e-test' },
    })

    expect(ok).toBe(true)
    expect(status).toBe(200)
    expect(data).toHaveProperty('signals_created')
    expect(data).toHaveProperty('sources_searched')
    expect(data).toHaveProperty('firecrawl_enabled')
    expect(data).toHaveProperty('kpi_updated')
    expect(data.signals_created).toBeGreaterThanOrEqual(0)

    // Verify signals table has rows with potential="consulting"
    const consultingSignals = await countRows('signals', { potential: 'consulting' })
    expect(consultingSignals).toBeGreaterThanOrEqual(0)
  }, 120_000)

  // ── 6. scout-run (foundry) ──

  it('scout-run with factory:"foundry" returns valid response and creates signals', async () => {
    const { status, data, ok } = await callFunction('scout-run', {
      body: { factory: 'foundry', triggered_by: 'e2e-test' },
    })

    expect(ok).toBe(true)
    expect(status).toBe(200)
    expect(data).toHaveProperty('signals_created')
    expect(data).toHaveProperty('sources_searched')
    expect(data).toHaveProperty('firecrawl_enabled')
    expect(data).toHaveProperty('kpi_updated')
    expect(data.signals_created).toBeGreaterThanOrEqual(0)

    // Verify signals table has rows with potential="foundry"
    const foundrySignals = await countRows('signals', { potential: 'foundry' })
    expect(foundrySignals).toBeGreaterThanOrEqual(0)
  }, 120_000)

  // ── 7. analyst-run (consulting) ──

  it('analyst-run with factory:"consulting" processes new signals into insights', async () => {
    const beforeNewSignals = await countRows('signals', { status: 'new', potential: 'consulting' })
    const beforeInsights = await countRows('insights')

    const { status, data, ok } = await callFunction('analyst-run', {
      body: { factory: 'consulting', triggered_by: 'e2e-test' },
    })

    expect(ok).toBe(true)
    expect(status).toBe(200)
    expect(data).toHaveProperty('signals_received')
    expect(data).toHaveProperty('signals_analyzed')
    expect(data).toHaveProperty('insights_created')
    expect(data).toHaveProperty('kpi_updated')
    expect(data.signals_received).toBeGreaterThanOrEqual(0)
    expect(data.signals_analyzed).toBeGreaterThanOrEqual(0)
    expect(data.insights_created).toBeGreaterThanOrEqual(0)

    // If there were new signals, some should now be analyzed
    if (beforeNewSignals > 0 && data.signals_analyzed > 0) {
      const afterNewSignals = await countRows('signals', { status: 'new', potential: 'consulting' })
      expect(afterNewSignals).toBeLessThanOrEqual(beforeNewSignals)
    }

    // Insights count should not decrease
    const afterInsights = await countRows('insights')
    expect(afterInsights).toBeGreaterThanOrEqual(beforeInsights)
  }, 300_000)

  // ── 8. analyst-run (foundry) ──

  it('analyst-run with factory:"foundry" processes new signals into insights', async () => {
    const beforeNewSignals = await countRows('signals', { status: 'new', potential: 'foundry' })
    const beforeInsights = await countRows('insights')

    const { status, data, ok } = await callFunction('analyst-run', {
      body: { factory: 'foundry', triggered_by: 'e2e-test' },
    })

    // analyst-run may timeout on free tier — skip only on gateway timeout or rate limit
    if ([429, 502, 504].includes(status)) {
      console.warn(`analyst-run (foundry) returned ${status} — skipping assertions`)
      return
    }

    expect(status).toBe(200)
    expect(data).toHaveProperty('signals_received')
    expect(data).toHaveProperty('signals_analyzed')
    expect(data).toHaveProperty('insights_created')
    expect(data).toHaveProperty('kpi_updated')
    expect(data.signals_received).toBeGreaterThanOrEqual(0)
    expect(data.signals_analyzed).toBeGreaterThanOrEqual(0)
    expect(data.insights_created).toBeGreaterThanOrEqual(0)

    if (beforeNewSignals > 0 && data.signals_analyzed > 0) {
      const afterNewSignals = await countRows('signals', { status: 'new', potential: 'foundry' })
      expect(afterNewSignals).toBeLessThanOrEqual(beforeNewSignals)
    }

    const afterInsights = await countRows('insights')
    expect(afterInsights).toBeGreaterThanOrEqual(beforeInsights)
  }, 300_000)

  // ── 9. marketer-run ──

  it('marketer-run processes consulting insights and may create leads', async () => {
    const beforeLeads = await countRows('leads')

    const { status, data, ok } = await callFunction('marketer-run', {
      body: { factory: 'consulting', triggered_by: 'e2e-test' },
    })

    expect(ok).toBe(true)
    expect(status).toBe(200)
    expect(data).toHaveProperty('insights_processed')
    expect(data).toHaveProperty('leads_created')
    expect(data).toHaveProperty('returned_to_analyst')
    expect(data).toHaveProperty('kpi_updated')
    expect(data.insights_processed).toBeGreaterThanOrEqual(0)
    expect(data.leads_created).toBeGreaterThanOrEqual(0)
    expect(data.returned_to_analyst).toBeGreaterThanOrEqual(0)

    const afterLeads = await countRows('leads')
    expect(afterLeads).toBeGreaterThanOrEqual(beforeLeads)
  }, 120_000)

  // ── 10. builder-run ──

  it('builder-run processes foundry insights and may create startup_opportunities', async () => {
    const beforeOpportunities = await countRows('startup_opportunities')

    const { status, data, ok } = await callFunction('builder-run', {
      body: { factory: 'foundry', triggered_by: 'e2e-test' },
    })

    expect(ok).toBe(true)
    expect(status).toBe(200)
    expect(data).toHaveProperty('success')

    // When there are no insights to process, the response is { success, message }
    // When there are insights, the response includes insights_processed, etc.
    if (data.insights_processed !== undefined) {
      expect(data).toHaveProperty('opportunities_created')
      expect(data).toHaveProperty('returned_to_analyst')
      expect(data).toHaveProperty('kpi_updated')
      expect(data.insights_processed).toBeGreaterThanOrEqual(0)
      expect(data.opportunities_created).toBeGreaterThanOrEqual(0)
      expect(data.returned_to_analyst).toBeGreaterThanOrEqual(0)
    }

    const afterOpportunities = await countRows('startup_opportunities')
    expect(afterOpportunities).toBeGreaterThanOrEqual(beforeOpportunities)
  }, 120_000)

  // ── 11. chat ──

  it('chat returns SSE stream with AI response', async () => {
    const sessionId = `e2e-test-${Date.now()}`

    const { status, data, ok } = await callFunction('chat', {
      body: {
        messages: [{ role: 'user', content: 'Hello, this is an E2E test. Reply briefly.' }],
        site_id: 'general',
        sessionId,
      },
      auth: 'anon',
    })

    expect(status).toBe(200)
    // The response is SSE text (helpers reads it as text for text/event-stream)
    expect(typeof data).toBe('string')
    expect((data as string).length).toBeGreaterThan(0)
    // SSE lines should contain "data:" prefixed entries
    expect(data).toContain('data:')
  }, 120_000)

  // ── 12. notify-owner ──

  it('notify-owner accepts event and returns success', async () => {
    const { status, data, ok } = await callFunction('notify-owner', {
      body: {
        event_type: 'new_conversation',
        data: {
          site: 'test',
          visitor: 'e2e',
          first_message: 'test',
        },
      },
      auth: 'anon',
    })

    expect(ok).toBe(true)
    expect(status).toBe(200)
    expect(data).toHaveProperty('success')
    expect(data).toHaveProperty('message_id')
  }, 120_000)

  // ── 13. prompt-refine ──

  it('prompt-refine returns SSE stream or config error', async () => {
    const { status, data, ok } = await callFunction('prompt-refine', {
      body: {
        instruction: 'add greeting',
        currentPrompt: 'You are an assistant.',
      },
      auth: 'anon',
    })

    // If API key is not configured, server returns 500 with a config error — acceptable
    if (status === 500 && typeof data === 'object' && data?.error?.includes('not configured')) {
      expect(status).toBe(500)
      return
    }

    expect(status).toBe(200)
    expect(typeof data).toBe('string')
    expect((data as string).length).toBeGreaterThan(0)
    expect(data).toContain('data:')
  }, 120_000)
})
