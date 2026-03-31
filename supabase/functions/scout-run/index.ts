import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══ ИСТОЧНИКИ ДЛЯ СКРЕЙПИНГА ═══
const CONSULTING_SOURCES = [
  // Вакансии — прямой сигнал боли
  { url: "https://hh.ru/search/vacancy?text=автоматизация+бизнес-процессов&area=113&period=1", category: "vacancies", label: "hh.ru: автоматизация" },
  { url: "https://hh.ru/search/vacancy?text=внедрение+AI+искусственный+интеллект&area=113&period=1", category: "vacancies", label: "hh.ru: AI/ML" },
  { url: "https://hh.ru/search/vacancy?text=цифровая+трансформация&area=113&period=1", category: "vacancies", label: "hh.ru: цифровизация" },
  // Бизнес-медиа
  { url: "https://vc.ru/services", category: "business_media", label: "vc.ru: сервисы" },
  { url: "https://vc.ru/ml", category: "business_media", label: "vc.ru: ML/AI" },
  { url: "https://habr.com/ru/flows/admin/", category: "tech_media", label: "habr: админка/автоматизация" },
  // Тендеры
  { url: "https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=искусственный+интеллект+автоматизация", category: "tenders", label: "zakupki.gov.ru: AI" },
];

const FOUNDRY_SOURCES = [
  // Мировые стартапы
  { url: "https://www.producthunt.com/leaderboard/daily", category: "global_startups", label: "ProductHunt: daily" },
  { url: "https://news.ycombinator.com/show", category: "global_startups", label: "HN: Show HN" },
  { url: "https://www.betalist.com/", category: "global_startups", label: "BetaList: новые" },
  { url: "https://theresanaiforthat.com/new/", category: "ai_tools", label: "ThereIsAnAIForThat: новые" },
  // Российский спрос
  { url: "https://vc.ru/services", category: "ru_demand", label: "vc.ru: сервисы" },
  { url: "https://vc.ru/trade", category: "ru_demand", label: "vc.ru: торговля" },
];

function compactText(value: unknown, max = 900) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

async function scrapeUrl(url: string, firecrawlKey: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 3000,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`Firecrawl error for ${url}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    // Firecrawl v1 nests content inside data
    const markdown = data?.data?.markdown || data?.markdown || "";
    return markdown.slice(0, 4000); // cap per source
  } catch (e) {
    console.error(`Scrape failed for ${url}:`, e);
    return null;
  }
}

async function searchWeb(query: string, firecrawlKey: string): Promise<string | null> {
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
        limit: 5,
        lang: "ru",
        country: "RU",
        tbs: "qdr:d",
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

    // Self-optimization: check if behind KPI
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
- РЕКОМЕНДАЦИИ АНАЛИТИКУ: "Мне нужна обратная связь — какие отрасли/типы сигналов дают лучшую конверсию в инсайты? Я адаптирую поиск."
`;
    }

    // ═══ PHASE 1: Реальный скрейпинг источников ═══
    const scrapedData: { label: string; category: string; content: string }[] = [];

    if (FIRECRAWL_API_KEY) {
      console.log("Firecrawl key found — scraping real sources...");

      // Скрейпим consulting и foundry источники параллельно
      const allSources = [...CONSULTING_SOURCES, ...FOUNDRY_SOURCES];

      // Batch по 3 параллельных запроса чтобы не перегрузить API
      for (let i = 0; i < allSources.length; i += 3) {
        const batch = allSources.slice(i, i + 3);
        const results = await Promise.allSettled(
          batch.map((src) => scrapeUrl(src.url, FIRECRAWL_API_KEY))
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

      // Дополнительный поиск по актуальным запросам
      const searchQueries = [
        "автоматизация бизнеса AI Россия 2026",
        "проблемы внедрения ИИ средний бизнес РФ",
        "AI стартап запуск Россия",
        "уход зарубежных сервисов замена Россия",
      ];

      const searchResults = await Promise.allSettled(
        searchQueries.map((q) => searchWeb(q, FIRECRAWL_API_KEY))
      );

      for (let i = 0; i < searchQueries.length; i++) {
        const result = searchResults[i];
        if (result.status === "fulfilled" && result.value) {
          scrapedData.push({
            label: `Поиск: ${searchQueries[i]}`,
            category: "web_search",
            content: result.value,
          });
        }
      }

      console.log(`Scraped ${scrapedData.length} sources successfully`);
    } else {
      console.warn("FIRECRAWL_API_KEY not set — falling back to AI-only mode (less reliable)");
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

РЕАЛЬНЫЕ ДАННЫЕ ИЗ ИСТОЧНИКОВ:
${scrapedBrief}

${feedbackContext ? `\n═══ ОБРАТНАЯ СВЯЗЬ ОТ СИСТЕМЫ (учти!):\n${feedbackContext}\n` : ""}
${kpiContext ? `\n═══ ТЕКУЩИЕ KPI:\n${kpiContext}\n` : ""}
${selfOptimizationPrompt}

ЗАДАЧА: Из РЕАЛЬНЫХ данных выше извлеки КОНКРЕТНЫЕ сигналы.

ДЛЯ CONSULTING СИГНАЛОВ:
- company_name: РЕАЛЬНАЯ компания из источника (если есть). Если нет конкретной — укажи null
- description: ЧТО КОНКРЕТНО ты увидел (вакансия, новость, жалоба, тендер)
- signal_type: vacancy | tender | news | complaint | law_change | vendor_exit | bankruptcy | search_spike | seasonal | publication | hiring_without_automation
- industry: отрасль
- source: URL или название источника ОТКУДА ты это взял
- potential: "consulting"

ДЛЯ FOUNDRY СИГНАЛОВ:
- company_name: null (или название зарубежного стартапа-образца)
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
- География: ТОЛЬКО РФ/СНГ (для consulting) или адаптация в РФ (для foundry)
- 🚫 FOUNDRY: НЕ генерируй похожие идеи! Каждый foundry-сигнал должен быть про РАЗНУЮ отрасль/нишу
- 🚫 ЗАПРЕЩЕНЫ для foundry: prompt platforms, prompt marketplace, prompt monetization, generic AI assistants, AI copywriters, ChatGPT wrappers, AI-обёртки, платформы для промтов, генераторы контента общего назначения, BetterPrompt, PromptBase и подобное
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
        temperature: 0.3,
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
    // Загружаем недавние сигналы для дедупликации
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

      // Skip duplicates
      if (existingDescriptions.has(descKey)) continue;
      existingDescriptions.add(descKey);

      const potential = item.potential === "foundry" ? "foundry" : "consulting";

      toInsert.push({
        company_name: compactText(item.company_name, 120) || null,
        description: desc,
        signal_type: compactText(item.signal_type, 50),
        industry: compactText(item.industry, 80) || null,
        source: compactText(item.source, 200) || (FIRECRAWL_API_KEY ? "firecrawl" : "ai_generated"),
        potential,
        status: "new",
        notes: compactText(item.notes, 300) || null,
      });
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from("signals").insert(toInsert);
      if (insertError) throw insertError;

      // ═══ PHASE 3.5: Сохраняем сигналы в базу знаний (documents) ═══
      const kbDocs = toInsert.map((sig: any) => {
        const content = [
          `# [Signal] ${sig.company_name || sig.signal_type}`,
          `Тип сигнала: ${sig.signal_type}`,
          `Потенциал: ${sig.potential}`,
          sig.industry ? `Индустрия: ${sig.industry}` : null,
          sig.company_name ? `Компания: ${sig.company_name}` : null,
          `Источник: ${sig.source || "н/д"}`,
          `\n## Описание\n${sig.description}`,
          sig.notes ? `\n## Заметки\n${sig.notes}` : null,
        ].filter(Boolean).join("\n");

        return {
          title: `[Signal] ${sig.company_name || sig.signal_type}: ${sig.description.slice(0, 80)}`,
          content,
          source_type: "agent",
          source_name: "scout-run",
          topic: sig.potential,
          metadata_json: {
            signal_type: sig.signal_type,
            potential: sig.potential,
            industry: sig.industry,
            company_name: sig.company_name,
            auto_saved: true,
          },
        };
      });

      const { error: kbError } = await supabase.from("documents").insert(kbDocs);
      if (kbError) console.error("KB save error (non-fatal):", kbError);
    }

    // ═══ PHASE 4: Логируем запуск ═══
    try {
      await supabase.from("sync_runs").insert({
        function_name: "scout-run",
        status: "ok",
        items_found: toInsert.length,
        metadata: {
          triggered_by: triggeredBy,
          sources_scraped: scrapedData.length,
          firecrawl_enabled: !!FIRECRAWL_API_KEY,
          signals_consulting: toInsert.filter((s) => s.potential === "consulting").length,
          signals_foundry: toInsert.filter((s) => s.potential === "foundry").length,
        },
      } as any);
    } catch (e: any) { console.error("sync_runs log error:", e); }

    return new Response(JSON.stringify({
      success: true,
      signals_created: toInsert.length,
      sources_scraped: scrapedData.length,
      firecrawl_enabled: !!FIRECRAWL_API_KEY,
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
