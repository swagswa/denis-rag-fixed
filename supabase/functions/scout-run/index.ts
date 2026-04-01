import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══ ПОИСКОВЫЕ ЗАПРОСЫ (вместо URL-ов — надёжнее!) ═══
const CONSULTING_SEARCHES = [
  // Вакансии — прямой сигнал боли
  { query: "автоматизация бизнес-процессов вакансия 2026 site:hh.ru", category: "vacancies", label: "hh.ru: автоматизация" },
  { query: "внедрение AI искусственный интеллект вакансия Россия", category: "vacancies", label: "hh.ru: AI/ML" },
  { query: "цифровая трансформация средний бизнес вакансия", category: "vacancies", label: "hh.ru: цифровизация" },
  // Бизнес-медиа и боли
  { query: "компания внедрила AI автоматизацию Россия 2026 результаты", category: "business_media", label: "Кейсы внедрения AI" },
  { query: "проблемы автоматизации бизнеса Россия малый средний", category: "business_media", label: "Проблемы автоматизации" },
  { query: "vc.ru чат-бот бизнес внедрение отзыв", category: "business_media", label: "vc.ru: чат-боты" },
  { query: "ищем подрядчика AI автоматизация чат-бот разработка", category: "direct_demand", label: "Прямой спрос на AI" },
  // Тендеры
  { query: "тендер закупка искусственный интеллект автоматизация 2026", category: "tenders", label: "Тендеры: AI" },
  // Уход вендоров / импортозамещение
  { query: "уход зарубежного сервиса замена Россия 2026", category: "vendor_exit", label: "Уход вендоров" },
  { query: "замена CRM ERP уход вендора Россия импортозамещение", category: "vendor_exit", label: "Импортозамещение CRM" },
];

const FOUNDRY_SEARCHES = [
  // Мировые стартапы
  { query: "AI startup launched 2026 ProductHunt top", category: "global_startups", label: "ProductHunt: top AI" },
  { query: "new AI SaaS tool launched this week 2026", category: "global_startups", label: "Новые AI SaaS" },
  { query: "AI startup seed round 2026 B2B", category: "global_startups", label: "AI стартапы seed" },
  // Российский спрос — чего не хватает
  { query: "нет аналога в России сервис AI автоматизация", category: "ru_demand", label: "Нет аналога в РФ" },
  { query: "Вордстат рост запросов AI сервис бот 2026", category: "ru_demand", label: "Рост запросов" },
  { query: "AI для логистики медицины агро образования Россия", category: "niche_ai", label: "Нишевый AI РФ" },
  { query: "Telegram бот бизнес автоматизация Россия популярный", category: "ru_demand", label: "TG-боты бизнес" },
];

function compactText(value: unknown, max = 900) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

async function searchWeb(query: string, firecrawlKey: string, limit = 10): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit,
        lang: "ru",
        country: "RU",
        tbs: "qdr:w", // за неделю — шире охват чем qdr:d
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`Firecrawl search error for "${query}": ${response.status}`);
      return null;
    }

    const data = await response.json();
    const results = data?.data || data?.results || [];
    if (!Array.isArray(results) || results.length === 0) return null;

    return results
      .map((r: any) => `[${r.title}](${r.url})\n${r.description || ""}`)
      .join("\n\n")
      .slice(0, 3000);
  } catch (e) {
    console.error(`Search failed for "${query}":`, e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

    let triggeredBy = "cron";
    try {
      const reqBody = await req.clone().json();
      triggeredBy = reqBody?.triggered_by || "cron";
    } catch { /* no body */ }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ═══ PHASE 0: Загрузить feedback от предыдущих циклов ═══
    const { data: recentFeedback } = await supabase
      .from("agent_feedback")
      .select("factory, feedback_type, content")
      .order("created_at", { ascending: false })
      .limit(10);

    const feedbackContext = (recentFeedback || [])
      .map((f: any) => `[${f.factory}/${f.feedback_type}]: ${f.content}`)
      .join("\n");

    // ═══ PHASE 0.5: Загрузить KPI-цели + САМООПТИМИЗАЦИЯ ═══
    const { data: kpiGoals } = await supabase
      .from("agent_kpi")
      .select("id, factory, metric, target, current")
      .eq("active", true);

    const kpiContext = (kpiGoals || [])
      .map((k: any) => `[${k.factory}] ${k.metric}: ${k.current}/${k.target}`)
      .join("\n");

    const myKpiConsulting = (kpiGoals || []).find((k: any) => k.factory === "consulting" && k.metric === "signals_per_week");
    const myKpiFoundry = (kpiGoals || []).find((k: any) => k.factory === "foundry" && k.metric === "signals_per_week");
    const consultingGap = myKpiConsulting ? Math.max(0, (myKpiConsulting.target || 0) - (myKpiConsulting.current || 0)) : 0;
    const foundryGap = myKpiFoundry ? Math.max(0, (myKpiFoundry.target || 0) - (myKpiFoundry.current || 0)) : 0;
    const totalGap = consultingGap + foundryGap;
    const isUrgent = totalGap > 20;

    let selfOptimizationPrompt = "";
    if (totalGap > 0) {
      selfOptimizationPrompt = `
═══ 🚨 РЕЖИМ САМООПТИМИЗАЦИИ (${isUrgent ? "КРИТИЧНО" : "УМЕРЕННО"}) ═══
Consulting сигналы: осталось найти ${consultingGap} из ${myKpiConsulting?.target || "?"}
Foundry сигналы: осталось найти ${foundryGap} из ${myKpiFoundry?.target || "?"}
АДАПТАЦИЯ СТРАТЕГИИ:
${isUrgent ? "- Увеличь количество сигналов до МАКСИМУМА (15)" : "- Старайся найти больше сигналов (10-12)"}
- Расширь интерпретацию: включай СМЕЖНЫЕ отрасли и КОСВЕННЫЕ сигналы
- Каждая вакансия, каждая новость — потенциальный сигнал. Не пропускай!
`;
    }

    // ═══ PHASE 0.7: БАЗА ЗНАНИЙ — загрузить существующие инсайты для контекста ═══
    const { data: existingInsights } = await supabase
      .from("insights")
      .select("title, company_name, what_happens, problem, action_proposal, opportunity_type")
      .order("created_at", { ascending: false })
      .limit(30);

    const knowledgeBase = (existingInsights || []).length > 0
      ? (existingInsights || [])
          .map((ins: any, i: number) => `[KB${i + 1}] ${ins.opportunity_type} | ${ins.title} | боль: ${(ins.problem || "").slice(0, 100)} | решение: ${(ins.action_proposal || "").slice(0, 100)}`)
          .join("\n")
      : "";

    // ═══ PHASE 1: Поиск через Firecrawl Search (надёжнее scrape!) ═══
    const scrapedData: { label: string; category: string; content: string }[] = [];

    if (FIRECRAWL_API_KEY) {
      console.log("Firecrawl key found — searching sources...");

      const allSearches = [...CONSULTING_SEARCHES, ...FOUNDRY_SEARCHES];

      // Batch по 4 параллельных запроса
      for (let i = 0; i < allSearches.length; i += 4) {
        const batch = allSearches.slice(i, i + 4);
        const results = await Promise.allSettled(
          batch.map((src) => searchWeb(src.query, FIRECRAWL_API_KEY, 10))
        );

        for (let j = 0; j < batch.length; j++) {
          const result = results[j];
          if (result.status === "fulfilled" && result.value) {
            scrapedData.push({
              label: batch[j].label,
              category: batch[j].category,
              content: result.value,
            });
          }
        }
      }

      console.log(`Searched ${scrapedData.length} queries successfully`);
    } else {
      console.warn("FIRECRAWL_API_KEY not set — falling back to AI-only mode");
    }

    // ═══ PHASE 2: GPT анализирует РЕАЛЬНЫЕ данные и генерирует сигналы ═══
    const scrapedBrief = scrapedData.length > 0
      ? scrapedData
          .map((d, i) => `[ИСТОЧНИК ${i + 1}: ${d.label} (${d.category})]\n${d.content.slice(0, 2000)}`)
          .join("\n\n---\n\n")
      : "(Firecrawl не подключен — используй свои знания о текущих трендах РФ/СНГ, но ПОМЕЧАЙ сигналы как 'ai_generated')";

    const prompt = `Ты — скаут, ищущий сигналы для двух направлений:
1) CONSULTING — компании РФ/СНГ (5-500 сотрудников, НЕ крупные корпорации!) с конкретными болями (нужна автоматизация/AI)
2) FOUNDRY — идеи AI-продуктов для рынка РФ/СНГ (мировые тренды + российский спрос)

МАНДАТ: целевые компании 5-500 человек. Крупные корпорации (1С, Яндекс, Сбер, МТС, Mail.ru, Ростелеком) — ПРОПУСКАЙ.

${knowledgeBase ? `═══ БАЗА ЗНАНИЙ — НАШИ СУЩЕСТВУЮЩИЕ ИНСАЙТЫ (используй для контекста!) ═══
Эти инсайты уже созданы аналитиком. НЕ дублируй их!
Но ИСПОЛЬЗУЙ как контекст: ищи НОВЫЕ сигналы, которые УСИЛИВАЮТ или ДОПОЛНЯЮТ эти темы.
Например: если есть инсайт "логистика: оптимизация маршрутов" — ищи НОВЫЕ компании/события в логистике.

${knowledgeBase}
═══ КОНЕЦ БАЗЫ ЗНАНИЙ ═══\n\n` : ""}

РЕАЛЬНЫЕ ДАННЫЕ ИЗ ПОИСКА:
${scrapedBrief}

${feedbackContext ? `\n═══ ОБРАТНАЯ СВЯЗЬ ОТ СИСТЕМЫ (учти!):\n${feedbackContext}\n` : ""}
${kpiContext ? `\n═══ ТЕКУЩИЕ KPI:\n${kpiContext}\n` : ""}
${selfOptimizationPrompt}

ЗАДАЧА: Из РЕАЛЬНЫХ данных выше извлеки КОНКРЕТНЫЕ сигналы.

ДЛЯ CONSULTING СИГНАЛОВ:
- company_name: если в источнике есть конкретная компания — укажи. Если нет — null (это ОК, компании найдёт Аналитик)
- description: ЧТО КОНКРЕТНО ты увидел (тренд, вакансия, новость, жалоба, тендер) — с деталями!
- signal_type: vacancy | tender | news | complaint | law_change | vendor_exit | bankruptcy | search_spike | seasonal | publication | hiring_without_automation
- industry: отрасль
- source: URL или название источника ОТКУДА ты это взял
- potential: "consulting"

ДЛЯ FOUNDRY СИГНАЛОВ:
- company_name: название зарубежного стартапа-образца (если есть) или null
- description: ЧТО за продукт/идея + ПОЧЕМУ актуально для РФ
- signal_type: global_startup | search_spike | vendor_exit | viral_trend | regulation | market_gap
- industry: отрасль
- source: URL или название источника
- potential: "foundry"

ПРАВИЛА:
- Извлекай ТОЛЬКО из предоставленных данных, НЕ выдумывай
- Каждый сигнал должен иметь source — откуда ты его взял
- Если Firecrawl не подключен — используй свои знания, но помечай source как "ai_generated"
- Максимум 15 сигналов (8 consulting + 7 foundry)
- Geography: ТОЛЬКО РФ/СНГ (для consulting) или адаптация в РФ (для foundry)
- CONSULTING: company_name — бонус, но НЕ обязателен. Главное — конкретный тренд/событие с деталями
- НЕ ДУБЛИРУЙ темы из БАЗЫ ЗНАНИЙ! Ищи НОВЫЕ сигналы.
- 🚫 FOUNDRY: НЕ генерируй похожие идеи! Каждый foundry-сигнал должен быть про РАЗНУЮ отрасль/нишу
- 🚫 ЗАПРЕЩЕНЫ для foundry: prompt platforms, prompt marketplace, generic AI assistants, AI copywriters, ChatGPT wrappers, AI-обёртки, генераторы контента общего назначения
- ✅ ХОРОШО для foundry: AI для конкретной ОТРАСЛИ (медицина, логистика, юристы, агро), автоматизация конкретного ПРОЦЕССА

ФОРМАТ: строго JSON-массив:
[{
  "company_name": "...",
  "description": "...",
  "signal_type": "...",
  "industry": "...",
  "source": "...",
  "potential": "consulting" | "foundry",
  "notes": null
}]

Без markdown, только JSON.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      if (response.status === 429 || response.status === 402) {
        return new Response(JSON.stringify({ error: response.status === 429 ? "Rate limits exceeded" : "Payment required" }), {
          status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      console.error("Failed to parse scout JSON:", content.slice(0, 500));
      aiItems = [];
    }

    // ═══ PHASE 3: Дедупликация и вставка ═══
    const { data: recentSignals } = await supabase
      .from("signals")
      .select("description, company_name")
      .order("created_at", { ascending: false })
      .limit(100);

    const existingDescriptions = new Set(
      (recentSignals || []).map((s: any) => compactText(s.description, 200).toLowerCase())
    );

    const toInsert: any[] = [];

    for (const item of aiItems) {
      if (!item?.description || !item?.signal_type) continue;

      const desc = compactText(item.description, 900);
      const descKey = desc.toLowerCase().slice(0, 200);

      if (existingDescriptions.has(descKey)) continue;
      existingDescriptions.add(descKey);

      const potential = item.potential === "foundry" ? "foundry" : "consulting";
      const companyName = compactText(item.company_name, 120) || null;

      toInsert.push({
        company_name: companyName,
        description: desc,
        signal_type: compactText(item.signal_type, 50),
        industry: compactText(item.industry, 80) || null,
        source: compactText(item.source, 200) || (FIRECRAWL_API_KEY ? "firecrawl_search" : "ai_generated"),
        potential,
        status: "new",
        notes: compactText(item.notes, 300) || null,
      });
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from("signals").insert(toInsert);
      if (insertError) throw insertError;
    }

    // ═══ PHASE 4: Логируем результат ═══
    console.log(`Scout completed: ${toInsert.length} signals (${toInsert.filter((s: any) => s.potential === "consulting").length} consulting, ${toInsert.filter((s: any) => s.potential === "foundry").length} foundry)`);

    // ═══ SELF-OPTIMIZATION: Update KPI ═══
    const consultingCreated = toInsert.filter((s: any) => s.potential === "consulting").length;
    const foundryCreated = toInsert.filter((s: any) => s.potential === "foundry").length;

    if (myKpiConsulting && consultingCreated > 0) {
      await supabase.from("agent_kpi").update({ current: (myKpiConsulting.current || 0) + consultingCreated, updated_at: new Date().toISOString() }).eq("id", myKpiConsulting.id);
    }
    if (myKpiFoundry && foundryCreated > 0) {
      await supabase.from("agent_kpi").update({ current: (myKpiFoundry.current || 0) + foundryCreated, updated_at: new Date().toISOString() }).eq("id", myKpiFoundry.id);
    }

    if (toInsert.length > 5) {
      try {
        const { data: recentConversion } = await supabase
          .from("insights")
          .select("id")
          .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
        
        const insightCount = (recentConversion || []).length;
        if (insightCount < toInsert.length * 0.3) {
          await supabase.from("agent_feedback").insert({
            factory: "consulting",
            from_agent: "scout",
            to_agent: "analyst",
            feedback_type: "optimization",
            content: `Скаут создал ${toInsert.length} сигналов, но конверсия в инсайты низкая (${insightCount} инсайтов за неделю). Бери больше сигналов в работу — лучше больше средних инсайтов, чем мало идеальных.`,
          } as any);
        }
      } catch {}
    }

    return new Response(JSON.stringify({
      success: true,
      signals_created: toInsert.length,
      sources_searched: scrapedData.length,
      firecrawl_enabled: !!FIRECRAWL_API_KEY,
      kpi_updated: true,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scout-run error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
