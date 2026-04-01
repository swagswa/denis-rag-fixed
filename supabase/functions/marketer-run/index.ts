// marketer-run v5 — STRICT: real company + real person + real contact
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
      body: JSON.stringify({ query, limit: 5, lang: "ru", country: "ru" }),
    });
    if (!res.ok) { await res.text(); return ""; }
    const d = await res.json();
    const results = d?.data || d?.results || [];
    return results.slice(0, 5).map((r: any) => `${r.title || ""} | ${r.url || ""} | ${(r.description || "").slice(0, 200)}`).join("\n");
  } catch { return ""; }
}

async function firecrawlScrape(url: string, apiKey: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 2000 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return "";
    const d = await res.json();
    const md = d?.data?.markdown || d?.markdown || "";
    return md.slice(0, 2500);
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

    // Load flow settings for mandate
    const { data: flows } = await supabase
      .from("factory_flows")
      .select("target_company_size, target_region, target_industry, target_notes")
      .eq("factory", "consulting")
      .eq("status", "active")
      .limit(5);

    const mandateSize = flows?.[0]?.target_company_size || "5-500";
    const mandateRegion = flows?.[0]?.target_region || "РФ/СНГ";

    // ═══ SELF-OPTIMIZATION: KPI check ═══
    const { data: kpiGoals } = await supabase
      .from("agent_kpi")
      .select("id, factory, metric, target, current")
      .eq("active", true);

    const myKpi = (kpiGoals || []).find((k: any) => k.factory === "consulting" && k.metric === "leads_per_week");
    const kpiGap = myKpi ? Math.max(0, (myKpi.target || 0) - (myKpi.current || 0)) : 0;
    const isUrgent = kpiGap > (myKpi?.target || 10) * 0.5;

    let selfOptimizationPrompt = "";
    if (kpiGap > 0) {
      selfOptimizationPrompt = `
═══ 🚨 САМООПТИМИЗАЦИЯ МАРКЕТОЛОГА (${isUrgent ? "КРИТИЧНО" : "УМЕРЕННО"}) ═══
Осталось создать ${kpiGap} лидов до выполнения KPI (${myKpi?.current || 0}/${myKpi?.target || "?"})
АДАПТАЦИЯ:
${isUrgent ? "- Расширь критерии поиска: ищи не только ЛПР, но и КОМПАНИИ с болью — контакт можно найти позже" : "- Будь активнее в поиске: пробуй альтернативные каналы (LinkedIn, Telegram-каналы отрасли)"}
- Если не находишь конкретного ЛПР — ВСЁРАВНО квалифицируй компанию, указав "контакт: найти через LinkedIn/hh.ru"
- РЕКОМЕНДАЦИИ АНАЛИТИКУ: "Нужны инсайты с более КОНКРЕТНЫМ профилем ЦА. Указывай ОТРАСЛЬ + РАЗМЕР + КОНКРЕТНЫЕ ПРИЗНАКИ боли, по которым я могу искать компании."
`;
    }

    // Step 1: Get ALL consulting insights with status new/qualified
    const { data: allInsights, error: insErr } = await supabase
      .from("insights")
      .select("id, title, company_name, what_happens, why_important, problem, action_proposal, signal_id")
      .in("status", ["new", "qualified"])
      .eq("opportunity_type", "consulting")
      .order("created_at", { ascending: false })
      .limit(20);

    if (insErr) throw insErr;
    if (!allInsights || allInsights.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No new consulting insights to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 2: Check which already have SUCCESSFUL leads (not returned/rejected)
    const allIds = allInsights.map((i: any) => i.id);
    const { data: existing } = await supabase
      .from("leads")
      .select("topic_guess, status")
      .in("topic_guess", allIds.map((id: string) => `insight:${id}`));
    
    // Only count leads that were approved or pending — NOT rejected ones
    const done = new Set(
      (existing || [])
        .filter((l: any) => l.status !== "rejected")
        .map((l: any) => l.topic_guess)
    );
    const queue = allInsights.filter((i: any) => !done.has(`insight:${i.id}`)).slice(0, 5);
    if (queue.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "All insights already processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ BATCH FIRECRAWL: TWO searches per insight (company + person) ═══
    const searchPromises = queue.flatMap((insight: any) => {
      if (!FIRECRAWL_API_KEY) return [Promise.resolve("(нет Firecrawl)"), Promise.resolve("")];
      const companyQ = `${insight.problem || insight.title} компания ${mandateRegion} ${mandateSize} сотрудников`;
      const contactQ = `${insight.company_name || insight.title} директор CTO CEO руководитель ${mandateRegion} контакт telegram linkedin`;
      return [
        firecrawlSearch(companyQ, FIRECRAWL_API_KEY),
        firecrawlSearch(contactQ, FIRECRAWL_API_KEY),
      ];
    });
    const allSearchResults = await Promise.all(searchPromises);

    // Pair results: [companyResults, contactResults] per insight
    const pairedResults: { companies: string; contacts: string; websiteContent: string }[] = [];
    for (let i = 0; i < queue.length; i++) {
      pairedResults.push({
        companies: allSearchResults[i * 2] || "",
        contacts: allSearchResults[i * 2 + 1] || "",
        websiteContent: "",
      });
    }

    // ═══ PHASE 2.5: Scrape company websites for personalized outreach ═══
    if (FIRECRAWL_API_KEY) {
      const scrapePromises: Promise<void>[] = [];
      for (let i = 0; i < pairedResults.length; i++) {
        const companyLines = pairedResults[i].companies;
        // Extract first URL from search results
        const urlMatch = companyLines.match(/https?:\/\/[^\s|]+/);
        if (urlMatch) {
          const url = urlMatch[0].replace(/[,;)}\]]+$/, "");
          scrapePromises.push(
            firecrawlScrape(url, FIRECRAWL_API_KEY).then((content) => {
              pairedResults[i].websiteContent = content;
            })
          );
        }
      }
      if (scrapePromises.length > 0) {
        await Promise.allSettled(scrapePromises);
        console.log(`[marketer] Scraped ${scrapePromises.length} company websites`);
      }
    }

    // ═══ SINGLE GPT CALL for all insights ═══
    const brief = queue.map((i: any, idx: number) => `#${idx + 1}
title: ${i.title}
what_happens: ${i.what_happens || "—"}
problem: ${i.problem || "—"}
action_proposal: ${i.action_proposal || "—"}

НАЙДЕННЫЕ КОМПАНИИ (поиск):
${pairedResults[idx].companies || "(ничего не найдено)"}

НАЙДЕННЫЕ КОНТАКТЫ (поиск):
${pairedResults[idx].contacts || "(ничего не найдено)"}
${pairedResults[idx].websiteContent ? `
КОНТЕНТ САЙТА КОМПАНИИ (спарсен автоматически):
${pairedResults[idx].websiteContent.slice(0, 1500)}
ИНСАЙТЫ ДЛЯ ПЕРСОНАЛИЗАЦИИ: используй конкретные детали с сайта (продукты, услуги, технологии, проблемы) для ПЕРСОНАЛИЗИРОВАННОГО обращения. Например: "Увидел на вашем сайте, что вы работаете с X — хотим предложить Y".` : ""}`).join("\n\n---\n\n");

    const prompt = `Ты — маркетолог Дениса Матеева. Денис помогает компаниям внедрять AI и автоматизацию.

МАНДАТ (ЖЁСТКИЙ — нарушение = автоматический отказ):
- Размер компании: ${mandateSize} сотрудников. НЕ крупнее! 1С, Яндекс, Сбер — это НЕ наши клиенты.
- Регион: ${mandateRegion}
- Компания должна быть РЕАЛЬНОЙ — из результатов поиска, НЕ выдуманной.

🚨 КРИТИЧЕСКИ ВАЖНО — ЗАПРЕТ НА ВЫДУМЫВАНИЕ:
Ты ОБЯЗАН использовать ТОЛЬКО данные из "НАЙДЕННЫЕ КОМПАНИИ", "НАЙДЕННЫЕ КОНТАКТЫ" и "КОНТЕНТ САЙТА КОМПАНИИ".
❌ ЗАПРЕЩЕНО: выдумывать имена, фамилии, email, telegram, linkedin — ДАЖЕ если они "звучат реалистично"
❌ ЗАПРЕЩЕНО: подставлять типичные имена (Иван Петров, Алексей Смирнов) если их НЕТ в результатах поиска
✅ РАЗРЕШЕНО: использовать ТОЛЬКО имена, контакты и компании, которые БУКВАЛЬНО присутствуют в тексте поиска выше
✅ БОНУС: если есть "КОНТЕНТ САЙТА КОМПАНИИ" — используй КОНКРЕТНЫЕ детали с сайта для персонализации outreach

═══ ДВУХУРОВНЕВАЯ КВАЛИФИКАЦИЯ ═══

УРОВЕНЬ A — ПОЛНЫЙ ЛИД (есть компания + ЛПР + контакт):
{"source_index":N, "qualified":true, "level":"A",
 "company_name":"РЕАЛЬНОЕ название компании ИЗ РЕЗУЛЬТАТОВ ПОИСКА",
 "company_size":"~число сотрудников (оценка)",
 "company_website":"https://...",
 "contact_name":"Имя Фамилия (ТОЛЬКО ИЗ РЕЗУЛЬТАТОВ ПОИСКА)",
 "contact_role":"CEO/CTO/CDO",
 "contact_channel":"telegram: @xxx / email: xxx@xxx.ru / linkedin: url (ТОЛЬКО ИЗ РЕЗУЛЬТАТОВ ПОИСКА)",
 "search_evidence":"ЦИТАТА из результатов поиска, где упоминается этот человек/контакт",
 "their_pain":"Конкретная боль ЭТОЙ компании",
 "our_offer":"Что конкретно предложить",
 "why_now":"Почему именно сейчас",
 "expected_value":"₽ число",
 "outreach_subject":"Тема письма/сообщения",
 "outreach_message":"4-6 предложений. Обращение к человеку ПО ИМЕНИ. Начни с конкретного повода (вакансия, новость, статья). Без смайликов. Подпись: Денис Матеев, @deyuma",
 "approval_request":"Кому (Имя, должность, компания) + Что предложить + Канал связи + Ожидаемый чек"}

УРОВЕНЬ B — КОМПАНИЯ БЕЗ КОНТАКТА (есть компания + сайт, но НЕТ ЛПР):
{"source_index":N, "qualified":true, "level":"B",
 "company_name":"РЕАЛЬНОЕ название компании ИЗ РЕЗУЛЬТАТОВ ПОИСКА",
 "company_size":"~число сотрудников (оценка)",
 "company_website":"https://...",
 "their_pain":"Конкретная боль ЭТОЙ компании (из контента сайта или контекста поиска)",
 "our_offer":"Что конкретно предложить",
 "why_now":"Почему именно сейчас",
 "expected_value":"₽ число",
 "search_hints":"ГДЕ искать ЛПР: 1) LinkedIn: запрос '...'. 2) hh.ru: проверить вакансии компании. 3) Сайт: страница 'Команда'/'О нас'. 4) TG: @...",
 "approval_request":"Компания + Боль + Что предложить + Где искать ЛПР + Ожидаемый чек"}

Если НЕ КВАЛИФИЦИРОВАН:
{"source_index":N, "qualified":false, "reason":"Конкретная причина: не нашёл реальной компании / компания вне мандата"}

ПРАВИЛА:
- Уровень A — ПРИОРИТЕТ. Но если не нашёл контакт — обязательно попробуй Уровень B!
- Раньше ты возвращал инсайт если нет контакта ЛПР. ТЕПЕРЬ: нет контакта → Уровень B (компания + где искать).
- Возвращай "не квалифицирован" ТОЛЬКО если не нашёл даже КОМПАНИЮ.

Верни JSON-массив. Без markdown.
${selfOptimizationPrompt}
ИНСАЙТЫ:
${brief}`;

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
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
        const contactName = compact(item.contact_name, 100);
        const contactChannel = compact(item.contact_channel, 200);
        const msg = compact(item.outreach_message, 800);
        const searchEvidence = compact(item.search_evidence, 300);

        // HARD VALIDATION: must have company, person name, contact, and message
        if (!cn || !contactName || !contactChannel || !msg) {
          await supabase.from("insights").update({ status: "returned", notes: "Маркетолог: не удалось найти конкретного ЛПР с контактом.", updated_at: new Date().toISOString() } as any).eq("id", insight.id);
          try { await supabase.from("agent_feedback").insert({ factory: "consulting", from_agent: "marketer", to_agent: "analyst", feedback_type: "quality_issue", content: `"${insight.title}": нет конкретного ЛПР с контактом. Нужен инсайт с более конкретной компанией/отраслью.` } as any); } catch {}
          returned++;
          continue;
        }

        // ═══ ANTI-HALLUCINATION: verify contact exists in search results ═══
        const searchData = pairedResults[idx - 1];
        const allSearchText = `${searchData?.companies || ""} ${searchData?.contacts || ""}`.toLowerCase();
        const nameParts = contactName.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
        const nameFoundInSearch = nameParts.length > 0 && nameParts.some((part: string) => allSearchText.includes(part));

        if (!nameFoundInSearch && FIRECRAWL_API_KEY) {
          console.log(`[marketer] ❌ HALLUCINATED contact: "${contactName}" not found in search results for "${cn}"`);
          await supabase.from("insights").update({ status: "returned", notes: `Маркетолог: контакт "${contactName}" не найден в результатах поиска — возможна галлюцинация.`, updated_at: new Date().toISOString() } as any).eq("id", insight.id);
          try { await supabase.from("agent_feedback").insert({ factory: "consulting", from_agent: "marketer", to_agent: "analyst", feedback_type: "hallucination", content: `"${insight.title}": GPT выдумал контакт "${contactName}". Этого человека нет в результатах Firecrawl. Нужен инсайт с более конкретной компанией, чтобы поиск дал результаты.` } as any); } catch {}
          returned++;
          continue;
        }

        const detail = [
          `📨 КОМУ: ${contactName}, ${item.contact_role || "ЛПР"} — ${cn}`,
          item.company_size ? `👥 ~${item.company_size} сотрудников` : null,
          item.company_website ? `🌐 ${item.company_website}` : null,
          `📱 КОНТАКТ: ${contactChannel}`,
          `🔥 ${compact(item.their_pain, 200)}`,
          `💡 ${compact(item.our_offer, 200)}`,
          `⏰ ${compact(item.why_now, 150)}`,
          `💰 ${compact(item.expected_value, 100)}`,
          ``, `📧 Тема: ${compact(item.outreach_subject, 100)}`, ``,
          `--- ТЕКСТ ---`, msg, `--- КОНЕЦ ---`,
        ].filter(Boolean).join("\n");

        const { error: le } = await supabase.from("leads").insert({
          company_name: cn,
          name: contactName,
          role: compact(item.contact_role, 80) || null,
          message: compact(detail, 800),
          lead_summary: compact(item.approval_request, 300) || `${contactName} (${item.contact_role}) @ ${cn}: ${compact(item.our_offer, 150)}`,
          topic_guess: `insight:${insight.id}`,
          status: "pending_approval",
        } as any);

        if (le) { console.error("Lead insert:", le); continue; }
        await supabase.from("insights").update({ status: "qualified", updated_at: new Date().toISOString() } as any).eq("id", insight.id);
        leadsCreated++;
        console.log(`[marketer] ✅ ${contactName} @ ${cn}`);
      } else {
        const reason = compact(item.reason, 300);
        await supabase.from("insights").update({ status: "returned", notes: `Маркетолог: ${reason}`, updated_at: new Date().toISOString() } as any).eq("id", insight.id);
        try { await supabase.from("agent_feedback").insert({ factory: "consulting", from_agent: "marketer", to_agent: "analyst", feedback_type: "rejection_reason", content: `"${insight.title}": ${reason}`, signal_id: insight.signal_id || null } as any); } catch {}
        returned++;
      }
    }

    // ═══ SELF-OPTIMIZATION: Update KPI + peer feedback ═══
    if (myKpi && leadsCreated > 0) {
      await supabase.from("agent_kpi").update({ current: (myKpi.current || 0) + leadsCreated, updated_at: new Date().toISOString() }).eq("id", myKpi.id);
    }

    // If conversion is very low, tell analyst what's wrong
    if (queue.length >= 3 && leadsCreated === 0) {
      try {
        await supabase.from("agent_feedback").insert({
          factory: "consulting",
          from_agent: "marketer",
          to_agent: "analyst",
          feedback_type: "optimization",
          content: `Конверсия инсайтов в лиды: 0/${queue.length}. Проблемы: ${returned > 0 ? "не могу найти реальных ЛПР по этим инсайтам" : "инсайты слишком абстрактные"}. Нужно: 1) Конкретная ОТРАСЛЬ (не "разные"), 2) Конкретные ПРИЗНАКИ компаний для поиска, 3) ПОИСКОВЫЕ ЗАПРОСЫ для Firecrawl.`,
        } as any);
      } catch {}
    }

    // Tell scout what industries produce better leads
    if (leadsCreated > 0) {
      try {
        await supabase.from("agent_feedback").insert({
          factory: "consulting",
          from_agent: "marketer",
          to_agent: "scout",
          feedback_type: "optimization",
          content: `Успешно создано ${leadsCreated} лидов. Продолжай искать сигналы в тех же отраслях/типах. Лучше всего конвертируются: вакансии (hh.ru), тендеры (zakupki.gov.ru), конкретные компании с болью.`,
        } as any);
      } catch {}
    }

    return new Response(JSON.stringify({ success: true, insights_processed: queue.length, leads_created: leadsCreated, returned_to_analyst: returned, kpi_updated: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("marketer-run error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
