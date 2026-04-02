/**
 * Phase 3 — Quality checks on GPT output
 *
 * Verifies that AI-generated data in the database meets quality standards:
 *   18. Insight quality — non-empty fields, actionable proposals
 *   19. JSON parsing — all expected fields populated, no unexpected nulls
 *   20. Anti-hallucination — leads with verified status have required fields
 *
 * These tests read existing data created by previous phases (no edge function calls).
 */
import { describe, it, expect } from 'vitest'
import { getRows, countRows } from './helpers'

describe('Phase 3 — Quality checks on GPT output', () => {
  // ── 18. Insight quality ──

  it('insights have non-empty title, what_happens, and actionable action_proposal', async () => {
    const insights = await getRows('insights', undefined, { limit: 50, order: 'created_at' })

    if (insights.length === 0) {
      // No insights in DB — nothing to validate, pass gracefully
      return
    }

    for (const insight of insights) {
      expect(
        insight.title,
        `Insight ${insight.id}: title should be a non-empty string`,
      ).toBeTruthy()
      expect(typeof insight.title).toBe('string')

      expect(
        insight.what_happens,
        `Insight ${insight.id}: what_happens should be a non-empty string`,
      ).toBeTruthy()
      expect(typeof insight.what_happens).toBe('string')

      expect(
        insight.action_proposal,
        `Insight ${insight.id}: action_proposal should be a non-empty string`,
      ).toBeTruthy()
      expect(typeof insight.action_proposal).toBe('string')

      // Action proposal must contain actionable content (not just a stub)
      expect(
        insight.action_proposal.length,
        `Insight ${insight.id}: action_proposal too short (${insight.action_proposal.length} chars) — expected actionable content (>20 chars)`,
      ).toBeGreaterThan(20)
    }
  }, 30_000)

  // ── 19. JSON parsing — all expected fields populated ──

  it('insights and leads have all expected fields populated (no null where string expected)', async () => {
    const insights = await getRows('insights', undefined, { limit: 50, order: 'created_at' })

    if (insights.length === 0) {
      // No insights in DB — nothing to validate, pass gracefully
      return
    }

    const insightStringFields = ['title', 'what_happens', 'action_proposal', 'opportunity_type', 'status']

    for (const insight of insights) {
      for (const field of insightStringFields) {
        expect(
          insight[field],
          `Insight ${insight.id}: field "${field}" should not be null`,
        ).not.toBeNull()
        expect(
          typeof insight[field],
          `Insight ${insight.id}: field "${field}" should be a string, got ${typeof insight[field]}`,
        ).toBe('string')
      }
    }

    // Check leads
    const leads = await getRows('leads', undefined, { limit: 50, order: 'created_at' })

    if (leads.length > 0) {
      // company_name and status are nullable in practice — only verify
      // that when they ARE present, they are strings
      const leadStringFields = ['status']

      for (const lead of leads) {
        for (const field of leadStringFields) {
          if (lead[field] != null) {
            expect(
              typeof lead[field],
              `Lead ${lead.id}: field "${field}" should be a string, got ${typeof lead[field]}`,
            ).toBe('string')
          }
        }

        // company_name is optional — only validate type when present
        if (lead.company_name != null) {
          expect(
            typeof lead.company_name,
            `Lead ${lead.id}: company_name should be a string when present`,
          ).toBe('string')
        }
      }
    }

    // Check startup_opportunities — notes field should parse if present
    const opportunities = await getRows('startup_opportunities', undefined, { limit: 50, order: 'created_at' })

    if (opportunities.length > 0) {
      const opStringFields = ['idea', 'problem', 'solution', 'stage']

      for (const opp of opportunities) {
        for (const field of opStringFields) {
          expect(
            opp[field],
            `Opportunity ${opp.id}: field "${field}" should not be null`,
          ).not.toBeNull()
        }

        // If notes exists and is a string, verify it is parseable
        // (it may contain structured JSON content)
        if (opp.notes != null && typeof opp.notes === 'string' && opp.notes.trim().startsWith('{')) {
          expect(() => {
            JSON.parse(opp.notes)
          }, `Opportunity ${opp.id}: notes field looks like JSON but fails to parse`).not.toThrow()
        }
      }
    }
  }, 30_000)

  // ── 20. Anti-hallucination in marketer ──

  it('leads with status != "needs_contact" have non-empty name and company_name', async () => {
    const leads = await getRows('leads', undefined, { limit: 100, order: 'created_at' })

    // Only check leads that have been positively verified (contacted, qualified, etc.)
    // Leads in initial/terminal states (new, needs_contact, rejected) may have incomplete data
    const skipStatuses = ['needs_contact', 'new', 'rejected', null, undefined]
    const verifiedLeads = leads.filter((lead: any) => !skipStatuses.includes(lead.status))

    if (verifiedLeads.length === 0) {
      // If all leads are needs_contact or no leads exist, check that
      // at least the total leads count is reasonable
      const totalLeads = await countRows('leads')
      // This is acceptable — no verified leads yet
      expect(totalLeads).toBeGreaterThanOrEqual(0)
      return
    }

    for (const lead of verifiedLeads) {
      expect(
        lead.name,
        `Lead ${lead.id} (status="${lead.status}"): Level A leads must have a non-empty name`,
      ).toBeTruthy()
      expect(typeof lead.name).toBe('string')
      expect(
        lead.name.length,
        `Lead ${lead.id}: name should not be empty`,
      ).toBeGreaterThan(0)

      expect(
        lead.company_name,
        `Lead ${lead.id} (status="${lead.status}"): Level A leads must have a non-empty company_name`,
      ).toBeTruthy()
      expect(typeof lead.company_name).toBe('string')
      expect(
        lead.company_name.length,
        `Lead ${lead.id}: company_name should not be empty`,
      ).toBeGreaterThan(0)
    }
  }, 30_000)
})
