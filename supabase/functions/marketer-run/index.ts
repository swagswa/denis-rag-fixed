// marketer-run v4 — optimized: batch Firecrawl + single GPT call
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function compact(v: unknown, max = 900) {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

async function firecrawlSearch(query: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 3, lang: "ru", country: "ru" }),
    });
    if (!res.ok) { await res.text(); return ""; }
    const d = await res.json();
    const results = d?.data || d?.results || [];
    return results.slice(0, 3).map((r: any) => `${r.title || ""} | ${r.url || ""} | ${(r.description || "").slice(0, 150)}`).join("\n");
  } catch { return ""; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") || "";

    let triggeredBy = "cron";
    try { triggeredBy = (await req.clone().json())?.triggered_by || "cron"; } catch {}

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: insights, error: insErr } = await supabase
      .from("insights")
      .select("id, title, company_name, what_happens, why_important, problem, action_proposal, signal_id")
      .in("status", ["new", "qualified"])
      .eq("opportunity_type", "consulting")
      .order("created_at", { ascending: true })
      .limit(3); // small batch to fit resource limits

    if (insErr) throw insErr;
    if (!insights || insights.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No new consulting insights to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = insights.map((i: any) => i.id);
    const { data: existing } = await supabase.from("leads").select("topic_guess").in("topic_guess", ids.map((id: string) => `insight:${id}`));
    const done = new Set((existing || []).map((l: any) => l.topic_guess));
    const queue = insights.filter((i: any) => !done.has(`insight:${i.id}`));
    if (queue.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "All insights already processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ BATCH FIRECRAWL: one search per insight, parallel ═══
    const searchPromises = queue.map(async (insight: any) => {
      if (!FIRECRAWL_API_KEY) return "(нет Firecrawl)";
      const q = `${insight.problem || insight.title} компания Россия`;
      return await firecrawlSearch(q, FIRECRAWL_API_KEY);
    });
    const searchResults = await Promise.all(searchPromises);

    // ═══ SINGLE GPT CALL for all insights ═══
    const brief = queue.map((i: any, idx: number) => `#${idx + 1}
title: ${i.title}
what_happens: ${i.what_happens || "—"}
problem: ${i.problem || "—"}
action_proposal: ${i.action_proposal || "—"}
НАЙДЕННЫЕ КОМПАНИИ:
${searchResults[idx] || "(ничего не найдено)"}`).join("\n\n---\n\n");

    const prompt = `Ты — маркетолог Дениса Матеева. Денис помогает компаниям внедрять AI и автоматизацию.

Для каждого инсайта ниже ВЫБЕРИ РЕАЛЬНУЮ компанию из результатов поиска (РФ/СНГ, 50-500 чел).
НЕ ВЫДУМЫВАЙ компании — используй ТОЛЬКО из результатов поиска.

Для каждого инсайта верни:
Если квалифицирован:
{"source_index":N, "qualified":true, "company_name":"...", "company_website":"...", "contact_role":"CEO/CTO/CDO", "where_to_find":"LinkedIn/сайт — конкретно", "their_pain":"...", "our_offer":"...", "why_now":"...", "expected_value":"₽...", "outreach_subject":"...", "outreach_message":"4-6 предложений, начни с повода, подпись: Денис Матеев", "approval_request":"кому + что + зачем кратко"}

Если нет подходящей компании:
{"source_index":N, "qualified":false, "reason":"почему"}

Верни JSON-массив. Без markdown.

ИНСАЙТЫ:
${brief}`;

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("AI error:", aiRes.status, t.slice(0, 200));
      throw new Error(`AI error ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const raw = aiData.choices?.[0]?.message?.content || "";
    let aiItems: any[] = [];
    try {
      let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const m = cleaned.match(/\[[\s\S]*\]/);
      if (m) cleaned = m[0];
      aiItems = JSON.parse(cleaned);
      if (!Array.isArray(aiItems)) aiItems = [aiItems];
    } catch {
      console.error("Parse error:", raw.slice(0, 300));
      return new Response(JSON.stringify({ success: true, insights_processed: queue.length, leads_created: 0, returned_to_analyst: 0, parse_warning: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let leadsCreated = 0, returned = 0;

    for (const item of aiItems) {
      const idx = Number(item?.source_index);
      if (!Number.isInteger(idx) || idx < 1 || idx > queue.length) continue;
      const insight = queue[idx - 1] as any;
      if (!insight) continue;

      if (item.qualified) {
        const cn = compact(item.company_name, 120);
        const msg = compact(item.outreach_message, 800);
        if (!cn || !msg) {
          await supabase.from("insights").update({ status: "returned", notes: "Маркетолог: нет данных о компании.", updated_at: new Date().toISOString() } as any).eq("id", insight.id);
          await supabase.from("agent_feedback").insert({ factory: "consulting", from_agent: "marketer", to_agent: "analyst", feedback_type: "quality_issue", content: `"${insight.title}": не удалось приземлить.` } as any).catch(() => {});
          returned++;
          continue;
        }

        const detail = [
          `📨 КОМУ: ${item.contact_role || "ЛПР"} — ${cn}`,
          item.company_website ? `🌐 ${item.company_website}` : null,
          `🔍 ${compact(item.where_to_find, 200)}`,
          `🔥 ${compact(item.their_pain, 200)}`,
          `💡 ${compact(item.our_offer, 200)}`,
          `⏰ ${compact(item.why_now, 150)}`,
          `💰 ${compact(item.expected_value, 100)}`,
          ``, `📧 ${compact(item.outreach_subject, 100)}`, ``,
          `--- ТЕКСТ ---`, msg, `--- КОНЕЦ ---`,
        ].filter(Boolean).join("\n");

        const { error: le } = await supabase.from("leads").insert({
          company_name: cn,
          role: compact(item.contact_role, 80) || null,
          message: compact(detail, 800),
          lead_summary: compact(item.approval_request, 300) || `${cn}: ${compact(item.our_offer, 200)}`,
          topic_guess: `insight:${insight.id}`,
          status: "pending_approval",
        } as any);

        if (le) { console.error("Lead insert:", le); continue; }
        await supabase.from("insights").update({ status: "qualified", updated_at: new Date().toISOString() } as any).eq("id", insight.id);
        leadsCreated++;
        console.log(`[marketer] ✅ ${cn}`);
      } else {
        const reason = compact(item.reason, 300);
        await supabase.from("insights").update({ status: "returned", notes: `Маркетолог: ${reason}`, updated_at: new Date().toISOString() } as any).eq("id", insight.id);
        await supabase.from("agent_feedback").insert({ factory: "consulting", from_agent: "marketer", to_agent: "analyst", feedback_type: "rejection_reason", content: `"${insight.title}": ${reason}`, signal_id: insight.signal_id || null } as any).catch(() => {});
        returned++;
      }
    }

    return new Response(JSON.stringify({ success: true, insights_processed: queue.length, leads_created: leadsCreated, returned_to_analyst: returned }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("marketer-run error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
