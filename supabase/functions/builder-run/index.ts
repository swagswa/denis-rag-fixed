// builder-run v2 — fixed stage column
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    let triggeredBy = "cron";
    try {
      const reqBody = await req.clone().json();
      triggeredBy = reqBody?.triggered_by || "cron";
    } catch { /* no body */ }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load flow settings for mandate
    const { data: flows } = await supabase
      .from("factory_flows")
      .select("target_industry, target_region, target_notes")
      .eq("factory", "foundry")
      .eq("status", "active")
      .limit(5);

    const mandateIndustry = flows?.map((f: any) => f.target_industry).filter(Boolean).join(", ") || "e-com, маркетплейсы, AI-сервисы";
    const mandateRegion = flows?.[0]?.target_region || "РФ/СНГ";

    // Builder получает ТОЛЬКО квалифицированные инсайты от Аналитика
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

    const insightIds = insights.map((i: any) => i.id);
    const { data: existingOpps } = await supabase
      .from("startup_opportunities")
      .select("insight_id, idea")
      .order("created_at", { ascending: false })
      .limit(50);

    const alreadyProcessed = new Set((existingOpps || []).filter((o: any) => o.insight_id).map((o: any) => o.insight_id));
    const existingIdeas = (existingOpps || []).map((o: any) => (o.idea || "").toLowerCase()).filter(Boolean);
    const queue = insights.filter((i: any) => !alreadyProcessed.has(i.id));

    if (queue.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "All foundry insights already processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build dedup context for GPT
    const existingIdeasBrief = existingIdeas.length > 0
      ? `\n\nУЖЕ СУЩЕСТВУЮЩИЕ ПРОЕКТЫ (НЕ ДУБЛИРУЙ!):\n${existingIdeas.slice(0, 20).map((idea, i) => `${i + 1}. ${idea}`).join("\n")}`
      : "";

    const brief = queue
      .map((i: any, idx: number) => `#${idx + 1}
title: ${i.title}
what_happens: ${i.what_happens}
why_important: ${i.why_important || "(не указано)"}
problem: ${i.problem || "(не указана)"}
action_proposal: ${i.action_proposal || "(не указано)"}`)
      .join("\n\n");

    const prompt = `Ты — AI-создатель (builder) стартапов для рынка России и СНГ. Ты СТРОИШЬ MVP AI-сервисов за 2 недели. В ОДНОГО. Без команды.

МАНДАТ (ЖЁСТКИЙ — нарушение = автоматический отказ):
- Отрасль: ${mandateIndustry}. Идеи ВНЕ этих отраслей — автоматический ОТКАЗ.
- Регион: ${mandateRegion}
- Если идея дублирует уже существующий проект — автоматический ОТКАЗ.
${existingIdeasBrief}

ТЫ ПОЛУЧАЕШЬ КВАЛИФИЦИРОВАННЫЕ ИНСАЙТЫ от Аналитика. Каждый уже прошёл фильтр.
Твоя задача — оценить: МОЖЕШЬ ЛИ ТЫ РЕАЛЬНО ЭТО ПОСТРОИТЬ за 2 недели и начать продавать?

ТЕХНИЧЕСКИЙ СТЕК: React/Vite + Supabase (Edge Functions, Postgres, Auth, Storage) + AI API (OpenAI/Gemini). 
ТЫ НЕ МОЖЕШЬ: мобильные приложения, сложные интеграции с 1С/SAP, железо, оффлайн.
ТЫ МОЖЕШЬ: веб-приложения, Telegram-боты, SaaS-панели, AI-инструменты, лендинги с оплатой, чат-боты.

КРИТИЧЕСКИ ВАЖНО — ВАЛИДАЦИЯ СПРОСА В РФ:
Аналитик уже указал доказательства спроса. Ты ПРОВЕРЯЕШЬ их и ДОПОЛНЯЕШЬ:
✅ Есть ли РЕАЛЬНЫЕ люди/компании в РФ, которые СЕЙЧАС ищут это решение?
✅ Какие запросы они делают? (Вордстат, Авито, TG)
✅ Есть ли уже аналоги в РФ? Если да — чем мы лучше?
✅ Готовы ли они ПЛАТИТЬ? (не просто "интересно", а реально потратят деньги)

КРИТЕРИИ ПРИНЯТИЯ (ВСЕ должны быть выполнены):
1. ✅ ТЫ понимаешь КАК это построить технически (конкретные компоненты, API, таблицы БД)
2. ✅ ТЫ можешь сделать рабочий MVP за 2 недели (не прототип — рабочий продукт)
3. ✅ Есть понятный канал для первых 10 клиентов В РОССИИ
4. ✅ Цена адекватна рынку РФ/СНГ (не американские $99/mo для российского малого бизнеса)
5. ✅ ПОДТВЕРЖДЁННЫЙ спрос в РФ (конкретные доказательства, не "наверное нужно")

ЕСЛИ ПРИНИМАЕШЬ — готовь КОНКРЕТНЫЙ ПЛАН ДЕЙСТВИЙ:
{
  "source_index": 1,
  "accepted": true,
  "idea": "Название продукта",
  "problem": "Боль ЦА одним предложением",
  "solution": "Что делает продукт",
  "target_audience": "Кто платит (в РФ/СНГ)",
  "demand_proof": "КОНКРЕТНЫЕ доказательства спроса в РФ: Вордстат X запросов/мес, на Авито Y объявлений, в TG-канале Z обсуждения, на vc.ru N статей про эту боль",
  "competitors_ru": "Аналоги в РФ (если есть) и чем мы лучше",
  "pricing": "Цена в ₽ (адекватная рынку РФ)",
  "market": "Размер рынка РФ/СНГ",
  "monetization": "Модель монетизации",
  "complexity": "low|medium",
  "revenue_estimate": 2400000,
  "mvp_timeline": "2 недели",
  "mvp_plan": {
    "week1": ["День 1-2: ...", "День 3-4: ...", "День 5: ..."],
    "week2": ["День 6-7: ...", "День 8-9: ...", "День 10: запуск + первые клиенты"]
  },
  "tech_stack": "React + Supabase + Telegram Bot API + OpenAI",
  "first_10_customers": "Конкретный план В РОССИИ: 1) Пост в TG-канал X. 2) Объявление на Авито. 3) ...",
  "approval_request": "СТРОЮ: [Название]. ДЛЯ: [ЦА в РФ]. БОЛЬ: [проблема]. СПРОС: [доказательства]. ЦЕНА: [X ₽/мес]. MVP за 2 недели. Первые клиенты через [каналы]. Потенциал: [X ₽/мес через 6 мес]. ОДОБРЯЕШЬ?"
}

ЕСЛИ НЕ ПРИНИМАЕШЬ:
{
  "source_index": 1,
  "accepted": false,
  "reason": "Конкретная причина: нет подтверждённого спроса в РФ / не могу построить за 2 недели / цена неадекватна рынку / ..."
}

ПРАВИЛА:
1) Будь ЖЁСТКИМ критиком. Принимай ТОЛЬКО то, что РЕАЛЬНО можешь построить и продать В РОССИИ.
2) revenue_estimate — ГОДОВАЯ оценка в ₽.
3) demand_proof — ОБЯЗАТЕЛЬНОЕ поле. Без конкретных доказательств спроса — НЕ ПРИНИМАЙ.
4) mvp_plan — КОНКРЕТНЫЙ по дням.
5) Верни строго JSON-массив без markdown.

ИНСАЙТЫ:
${brief}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limits exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    let aiItems: any[] = [];
    try {
      let cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
      if (arrayMatch) cleaned = arrayMatch[0];
      aiItems = JSON.parse(cleaned);
      if (!Array.isArray(aiItems)) aiItems = [aiItems];
    } catch {
      console.error("Failed to parse builder JSON:", content.slice(0, 500));
      return new Response(JSON.stringify({
        success: true, insights_processed: queue.length,
        opportunities_created: 0, returned_to_analyst: 0,
        parse_warning: "AI returned non-JSON response",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let oppsCreated = 0;
    let returned = 0;

    for (const item of aiItems) {
      const sourceIndex = Number(item?.source_index);
      if (!Number.isInteger(sourceIndex) || sourceIndex < 1 || sourceIndex > queue.length) continue;

      const insight = queue[sourceIndex - 1] as any;
      if (!insight) continue;

      if (item.accepted) {
        // ═══ VALIDATION: Reject without demand proof ═══
        const demandProof = compactText(item.demand_proof, 500);
        if (!demandProof || demandProof.length < 20) {
          console.log(`Skipping opportunity: no demand proof for "${item.idea}"`);
          await supabase
            .from("insights")
            .update({
              status: "returned",
              notes: "Билдер: принял идею, но нет конкретных доказательств спроса в РФ. Нужны данные: Вордстат, Авито, TG.",
              updated_at: new Date().toISOString(),
            } as any)
            .eq("id", insight.id);

          try {
            await supabase.from("agent_feedback").insert({
              factory: "foundry",
              from_agent: "builder",
              to_agent: "analyst",
              feedback_type: "quality_issue",
              content: `Идея "${item.idea}" — нет доказательств спроса в РФ. Аналитик должен приводить конкретные данные: Вордстат цифры, обсуждения в TG, посты на vc.ru.`,
              insight_id: insight.id,
            } as any);
          } catch (e: any) { console.error("Feedback insert error:", e); }

          returned++;
          continue;
        }

        const approvalText = compactText(item.approval_request, 400) ||
          `${item.idea}: ${item.monetization} для ${item.target_audience}. Revenue: ${item.revenue_estimate} ₽/год. Запускаем?`;

        const mvpPlanText = item.mvp_plan
          ? `\n📅 ПЛАН MVP:\nНеделя 1: ${(item.mvp_plan.week1 || []).join(", ")}\nНеделя 2: ${(item.mvp_plan.week2 || []).join(", ")}`
          : "";

        const detailedNotes = [
          `🎯 ЦА: ${item.target_audience}`,
          `📊 СПРОС В РФ: ${demandProof}`,
          `🏆 КОНКУРЕНТЫ РФ: ${item.competitors_ru || "не найдены"}`,
          `💰 ЦЕНА: ${item.pricing}`,
          `🔧 СТЕК: ${item.tech_stack || "React + Supabase"}`,
          `📦 MVP (2 нед): ${item.solution}`,
          mvpPlanText,
          `🚀 ПЕРВЫЕ 10 КЛИЕНТОВ: ${item.first_10_customers}`,
          `📊 РЫНОК: ${item.market}`,
          `💵 REVENUE: ${item.revenue_estimate} ₽/год`,
          ``,
          `✅ ЗАПРОС НА ОДОБРЕНИЕ: ${approvalText}`,
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
          stage: "opportunity",
        } as any);

        if (oppError) {
          console.error("Opportunity insert error:", oppError);
          continue;
        }

        await supabase
          .from("insights")
          .update({ status: "processed", updated_at: new Date().toISOString() } as any)
          .eq("id", insight.id);

        oppsCreated++;
      } else {
        const reason = compactText(item.reason, 300);
        await supabase
          .from("insights")
          .update({
            status: "returned",
            notes: `Билдер: ${reason}`,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", insight.id);

        // ═══ Feedback loop: сообщаем аналитику и скауту ═══
        try {
          await supabase.from("agent_feedback").insert({
            factory: "foundry",
            from_agent: "builder",
            to_agent: "analyst",
            feedback_type: "rejection_reason",
            content: `Отклонил идею "${insight.title}": ${reason}. Нужны идеи с подтверждённым спросом в РФ, реализуемые за 2 недели.`,
            insight_id: insight.id,
            signal_id: insight.signal_id || null,
          } as any);
        } catch (e: any) { console.error("Feedback insert error:", e); }

        returned++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      insights_processed: queue.length,
      opportunities_created: oppsCreated,
      returned_to_analyst: returned,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("builder-run error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
