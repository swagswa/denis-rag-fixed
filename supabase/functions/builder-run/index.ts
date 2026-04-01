// builder-run v4 — with Telegram notifications
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function compactText(value: unknown, max = 900) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

async function notifyOwner(eventType: string, data: any) {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    await fetch(`${url}/functions/v1/notify-owner`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType, data }),
    });
  } catch (e) { console.warn("[notify] failed:", e); }
}

function resolveIndex(raw: unknown, queueLen: number): number | null {
  const idx = Number(raw);
  if (!Number.isInteger(idx)) return null;
  if (idx >= 1 && idx <= queueLen) return idx - 1;
  if (idx >= 0 && idx < queueLen) return idx;
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    let triggeredBy = "cron";
    try { triggeredBy = (await req.clone().json())?.triggered_by || "cron"; } catch {}

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: flows } = await supabase
      .from("factory_flows")
      .select("target_industry, target_region, target_notes")
      .eq("factory", "foundry")
      .eq("status", "active")
      .limit(5);

    const mandateIndustry = flows?.map((f: any) => f.target_industry).filter(Boolean).join(", ") || "e-com, маркетплейсы, AI-сервисы";
    const mandateRegion = flows?.[0]?.target_region || "РФ/СНГ";

    const { data: kpiGoals } = await supabase
      .from("agent_kpi")
      .select("id, factory, metric, target, current")
      .eq("active", true);

    const myKpi = (kpiGoals || []).find((k: any) => k.factory === "foundry" && k.metric === "ideas_per_week");
    const kpiGap = myKpi ? Math.max(0, (myKpi.target || 0) - (myKpi.current || 0)) : 0;
    const isUrgent = kpiGap > (myKpi?.target || 5) * 0.5;

    let selfOptimizationPrompt = "";
    if (kpiGap > 0) {
      selfOptimizationPrompt = `
═══ 🚨 САМООПТИМИЗАЦИЯ БИЛДЕРА (${isUrgent ? "КРИТИЧНО" : "УМЕРЕННО"}) ═══
Осталось создать ${kpiGap} проектов до KPI (${myKpi?.current || 0}/${myKpi?.target || "?"})
- ${isUrgent ? "Будь менее строгим: принимай идеи с ЧАСТИЧНЫМИ доказательствами спроса" : "Расширь критерии: смежные отрасли тоже OK"}
- МИНИМУМ 50% инсайтов должны стать проектами
`;
    }

    const { data: insights, error: insightsError } = await supabase
      .from("insights")
      .select("id, title, company_name, what_happens, why_important, problem, action_proposal, opportunity_type, signal_id")
      .eq("status", "qualified")
      .in("opportunity_type", ["foundry", "innovation_pilot"])
      .order("created_at", { ascending: true })
      .limit(10);

    if (insightsError) throw insightsError;
    if (!insights || insights.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No new foundry insights to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingOpps } = await supabase
      .from("startup_opportunities")
      .select("insight_id, idea")
      .order("created_at", { ascending: false })
      .limit(100);

    const alreadyProcessed = new Set((existingOpps || []).filter((o: any) => o.insight_id).map((o: any) => o.insight_id));
    const existingIdeas = (existingOpps || []).map((o: any) => (o.idea || "").toLowerCase()).filter(Boolean);

    const BANNED_KEYWORDS = [
      "prompt marketplace", "платформа для промтов", "prompt engineering", "prompt platform",
      "монетизация промтов", "chatgpt обёртка", "chatgpt wrapper", "ai ассистент общего",
      "generic ai assistant", "ai копирайтер", "ai copywriter", "генератор контента",
      "промт маркетплейс", "prompt optimization", "prompt builder",
    ];

    function isBannedIdea(title: string, description: string): boolean {
      const text = `${title} ${description}`.toLowerCase();
      return BANNED_KEYWORDS.some(kw => text.includes(kw));
    }

    function isSimilarToExisting(newIdea: string): boolean {
      const words = newIdea.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (words.length === 0) return false;
      return existingIdeas.some(existing => {
        const matchCount = words.filter(w => existing.includes(w)).length;
        return matchCount / words.length > 0.5;
      });
    }

    const queue = insights.filter((i: any) => !alreadyProcessed.has(i.id));
    if (queue.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "All foundry insights already processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pre-filter banned/duplicate
    let returned = 0;
    let oppsCreated = 0;
    const filteredQueue: typeof queue = [];
    for (const insight of queue) {
      const title = (insight as any).title || "";
      const desc = (insight as any).what_happens || "";

      if (isBannedIdea(title, desc)) {
        console.log(`[builder] BANNED: "${title}"`);
        await supabase.from("insights").update({ status: "returned", notes: "Билдер: запрещённая категория.", updated_at: new Date().toISOString() } as any).eq("id", (insight as any).id);
        try { await supabase.from("agent_feedback").insert({ factory: "foundry", from_agent: "builder", to_agent: "analyst", feedback_type: "banned_category", content: `"${title}" — запрещённая категория.` } as any); } catch {}
        returned++;
        continue;
      }

      if (isSimilarToExisting(title)) {
        console.log(`[builder] DUPLICATE: "${title}"`);
        await supabase.from("insights").update({ status: "returned", notes: "Билдер: дубликат существующего проекта.", updated_at: new Date().toISOString() } as any).eq("id", (insight as any).id);
        returned++;
        continue;
      }

      filteredQueue.push(insight);
    }

    if (filteredQueue.length === 0) {
      return new Response(JSON.stringify({ success: true, insights_processed: queue.length, opportunities_created: 0, returned_to_analyst: returned, message: "All filtered out" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[builder] Processing ${filteredQueue.length} insights: ${filteredQueue.map((i: any) => i.title).join("; ")}`);

    const existingIdeasBrief = existingIdeas.length > 0
      ? `\n\nУЖЕ СУЩЕСТВУЮЩИЕ ПРОЕКТЫ (НЕ ДУБЛИРУЙ!):\n${existingIdeas.slice(0, 20).map((idea, i) => `${i + 1}. ${idea}`).join("\n")}`
      : "";

    const filteredBrief = filteredQueue
      .map((i: any, idx: number) => `#${idx + 1}
title: ${i.title}
what_happens: ${i.what_happens}
why_important: ${i.why_important || "(не указано)"}
problem: ${i.problem || "(не указана)"}
action_proposal: ${i.action_proposal || "(не указано)"}`)
      .join("\n\n");

    const prompt = `Ты — AI-создатель (builder) стартапов для РФ/СНГ. Строишь MVP за 2 недели. В одного.

МАНДАТ:
- Отрасль: ${mandateIndustry}. Идеи ВНЕ — отказ.
- Регион: ${mandateRegion}
- 🚫 ЗАПРЕЩЕНЫ: prompt platforms, generic AI, ChatGPT wrappers
${existingIdeasBrief}

СТЕК: React/Vite + Supabase + AI API (OpenAI/Gemini).
МОЖЕШЬ: веб-приложения, TG-боты, SaaS, AI-инструменты, лендинги с оплатой.
НЕ МОЖЕШЬ: мобильные, интеграции с 1С/SAP, железо, оффлайн.

ЕСЛИ ПРИНИМАЕШЬ:
{
  "source_index": N,
  "accepted": true,
  "idea": "Название",
  "problem": "Боль ЦА",
  "solution": "Что делает продукт",
  "target_audience": "Кто платит в РФ",
  "demand_proof": "Доказательства спроса: Вордстат, Авито, TG, vc.ru",
  "competitors_ru": "Аналоги в РФ и чем мы лучше",
  "pricing": "Цена в ₽",
  "market": "Размер рынка РФ/СНГ",
  "monetization": "Модель",
  "complexity": "low|medium",
  "revenue_estimate": 2400000,
  "mvp_plan": {
    "week1": ["День 1-2: ...", "День 3-4: ...", "День 5: ..."],
    "week2": ["День 6-7: ...", "День 8-9: ...", "День 10: запуск"]
  },
  "tech_stack": "React + Supabase + ...",
  "first_10_customers": "План привлечения в РФ",
  "approval_request": "СТРОЮ: [Название]. ДЛЯ: [ЦА]. БОЛЬ: [X]. СПРОС: [Y]. ЦЕНА: [Z ₽/мес]. MVP 2 нед. Потенциал: [₽/мес]. ОДОБРЯЕШЬ?"
}

ЕСЛИ НЕ ПРИНИМАЕШЬ:
{"source_index": N, "accepted": false, "reason": "причина"}

ПРАВИЛА:
1. source_index — номер инсайта (#1 → source_index:1, #2 → 2...)
2. revenue_estimate — ГОДОВАЯ в ₽
3. МИНИМУМ 50% должны стать проектами
4. Верни JSON-массив. Без markdown. Ответь РОВНО по количеству инсайтов.
${selfOptimizationPrompt}
ИНСАЙТЫ:
${filteredBrief}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: prompt }], temperature: 0.3 }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[builder] AI error:", response.status, errText.slice(0, 200));
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limits" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "Payment required" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    console.log(`[builder] GPT raw (first 800): ${content.slice(0, 800)}`);

    let aiItems: any[] = [];
    try {
      let cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
      if (arrayMatch) cleaned = arrayMatch[0];
      aiItems = JSON.parse(cleaned);
      if (!Array.isArray(aiItems)) aiItems = [aiItems];
    } catch {
      console.error("[builder] Parse error. Raw:", content.slice(0, 500));
      // Fallback: mark as returned so they don't loop
      for (const insight of filteredQueue) {
        await supabase.from("insights").update({ status: "returned", notes: "Билдер: ошибка парсинга GPT.", updated_at: new Date().toISOString() } as any).eq("id", (insight as any).id);
      }
      return new Response(JSON.stringify({ success: true, insights_processed: queue.length, opportunities_created: 0, returned_to_analyst: returned + filteredQueue.length, parse_error: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const processedIds = new Set<string>();

    for (const item of aiItems) {
      const qIdx = resolveIndex(item?.source_index, filteredQueue.length);
      if (qIdx === null) {
        console.log(`[builder] Skipping invalid source_index: ${item?.source_index}`);
        continue;
      }

      const insight = filteredQueue[qIdx] as any;
      if (!insight || processedIds.has(insight.id)) continue;
      processedIds.add(insight.id);

      if (item.accepted) {
        const demandProof = compactText(item.demand_proof, 500);
        if (!demandProof || demandProof.length < 20) {
          console.log(`[builder] No demand proof: "${item.idea}"`);
          await supabase.from("insights").update({ status: "returned", notes: "Билдер: нет доказательств спроса в РФ.", updated_at: new Date().toISOString() } as any).eq("id", insight.id);
          try { await supabase.from("agent_feedback").insert({ factory: "foundry", from_agent: "builder", to_agent: "analyst", feedback_type: "quality_issue", content: `"${item.idea}" — нет доказательств спроса. Нужен Вордстат, TG, vc.ru.`, insight_id: insight.id } as any); } catch {}
          returned++;
          continue;
        }

        const approvalText = compactText(item.approval_request, 400) || `${item.idea}: ${item.monetization}. Revenue: ${item.revenue_estimate} ₽/год.`;
        const mvpPlanText = item.mvp_plan
          ? `\n📅 ПЛАН:\nНед 1: ${(item.mvp_plan.week1 || []).join(", ")}\nНед 2: ${(item.mvp_plan.week2 || []).join(", ")}`
          : "";

        const detailedNotes = [
          `🎯 ЦА: ${item.target_audience}`,
          `📊 СПРОС: ${demandProof}`,
          `🏆 КОНКУРЕНТЫ: ${item.competitors_ru || "не найдены"}`,
          `💰 ЦЕНА: ${item.pricing}`,
          `🔧 СТЕК: ${item.tech_stack || "React + Supabase"}`,
          `📦 MVP: ${item.solution}`,
          mvpPlanText,
          `🚀 ПЕРВЫЕ 10: ${item.first_10_customers}`,
          `📊 РЫНОК: ${item.market}`,
          `💵 REVENUE: ${item.revenue_estimate} ₽/год`,
          ``, `✅ ${approvalText}`,
        ].filter(Boolean).join("\n");

        const { error: oppError } = await supabase.from("startup_opportunities").insert({
          idea: compactText(item.idea, 160),
          problem: compactText(item.problem, 500),
          solution: compactText(item.solution, 500),
          source: `insight:${insight.id}`,
          market: compactText(item.market, 300),
          monetization: compactText(item.monetization, 200),
          complexity: item.complexity === "low" ? "low" : "medium",
          revenue_estimate: Number(item.revenue_estimate) || 0,
          notes: compactText(detailedNotes, 1500),
          stage: "pending_approval",
          insight_id: insight.id,
        } as any);

        if (oppError) { console.error("[builder] Insert error:", oppError); continue; }
        await supabase.from("insights").update({ status: "processed", updated_at: new Date().toISOString() } as any).eq("id", insight.id);
        oppsCreated++;
        console.log(`[builder] ✅ Created: "${item.idea}"`);
      } else {
        const reason = compactText(item.reason, 300);
        await supabase.from("insights").update({ status: "returned", notes: `Билдер: ${reason}`, updated_at: new Date().toISOString() } as any).eq("id", insight.id);
        try { await supabase.from("agent_feedback").insert({ factory: "foundry", from_agent: "builder", to_agent: "analyst", feedback_type: "rejection_reason", content: `"${insight.title}": ${reason}`, insight_id: insight.id, signal_id: insight.signal_id || null } as any); } catch {}
        returned++;
        console.log(`[builder] ❌ Rejected: "${insight.title}" — ${reason}`);
      }
    }

    // Mark unprocessed insights to avoid infinite loop
    for (const insight of filteredQueue) {
      if (!processedIds.has((insight as any).id)) {
        await supabase.from("insights").update({ status: "returned", notes: "Билдер: GPT не вернул результат.", updated_at: new Date().toISOString() } as any).eq("id", (insight as any).id);
        returned++;
        console.log(`[builder] ⚠️ Unprocessed: "${(insight as any).title}"`);
      }
    }

    if (myKpi && oppsCreated > 0) {
      await supabase.from("agent_kpi").update({ current: (myKpi.current || 0) + oppsCreated, updated_at: new Date().toISOString() }).eq("id", myKpi.id);
    }

    if (filteredQueue.length >= 2 && oppsCreated === 0) {
      try { await supabase.from("agent_feedback").insert({ factory: "foundry", from_agent: "builder", to_agent: "analyst", feedback_type: "optimization", content: `Конверсия: 0/${filteredQueue.length}. Нужны нишевые идеи с доказательствами спроса в РФ, реализуемые за 2 нед.` } as any); } catch {}
    }

    if (oppsCreated > 0) {
      try { await supabase.from("agent_feedback").insert({ factory: "foundry", from_agent: "builder", to_agent: "scout", feedback_type: "optimization", content: `Создано ${oppsCreated} проектов. Ищи больше: зарубежные стартапы без аналога в РФ, нишевые решения.` } as any); } catch {}
    }

    console.log(`[builder] DONE: ${oppsCreated} projects, ${returned} returned, ${queue.length} total`);

    return new Response(JSON.stringify({ success: true, insights_processed: queue.length, opportunities_created: oppsCreated, returned_to_analyst: returned, kpi_updated: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("builder-run error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
