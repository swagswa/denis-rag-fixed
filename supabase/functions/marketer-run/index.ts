// marketer-run v7 — with Telegram notifications
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

async function notifyOwner(eventType: string, data: any) {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const res = await fetch(`${url}/functions/v1/notify-owner`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType, data }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn("[notify] failed response:", res.status, text);
    }
  } catch (e) { console.warn("[notify] failed:", e); }
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

// Resolve source_index: GPT may use 0-based or 1-based numbering
function resolveIndex(raw: unknown, queueLen: number): number | null {
  const idx = Number(raw);
  if (!Number.isInteger(idx)) return null;
  // Prompt uses #1, #2... so expected is 1-based
  if (idx >= 1 && idx <= queueLen) return idx - 1;
  // GPT sometimes returns 0-based
  if (idx >= 0 && idx < queueLen) return idx;
  return null;
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
- Расширь критерии: ищи не только ЛПР, но и КОМПАНИИ с болью — контакт можно найти позже
- Если не находишь конкретного ЛПР — ОБЯЗАТЕЛЬНО квалифицируй как Уровень B
- МИНИМУМ 60% инсайтов должны стать лидами (Level A или Level B)
`;
    }

    // Step 1: Get consulting insights with status new/qualified
    const { data: allInsights, error: insErr } = await supabase
      .from("insights")
      .select("id, title, company_name, what_happens, why_important, problem, action_proposal, signal_id")
      .in("status", ["new", "qualified"])
      .eq("opportunity_type", "consulting")
      .order("created_at", { ascending: false })
      .limit(20);

    if (insErr) throw insErr;
    if (!allInsights || allInsights.length === 0) {
      return new Response(JSON.stringify({ success: true, insights_processed: 0, leads_created: 0, returned_to_analyst: 0, kpi_updated: false, message: "No new consulting insights to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 2: Check which already have leads (not rejected)
    const allIds = allInsights.map((i: any) => i.id);
    const { data: existing } = await supabase
      .from("leads")
      .select("topic_guess, status")
      .in("topic_guess", allIds.map((id: string) => `insight:${id}`));
    
    const done = new Set(
      (existing || [])
        .filter((l: any) => l.status !== "rejected")
        .map((l: any) => l.topic_guess)
    );
    const queue = allInsights.filter((i: any) => !done.has(`insight:${i.id}`)).slice(0, 5);
    if (queue.length === 0) {
      return new Response(JSON.stringify({ success: true, insights_processed: 0, leads_created: 0, returned_to_analyst: 0, kpi_updated: false, message: "All insights already processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[marketer] Processing ${queue.length} insights: ${queue.map((i: any) => i.title).join("; ")}`);

    // ═══ BATCH FIRECRAWL: TWO searches per insight ═══
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

    const pairedResults: { companies: string; contacts: string; websiteContent: string }[] = [];
    for (let i = 0; i < queue.length; i++) {
      pairedResults.push({
        companies: allSearchResults[i * 2] || "",
        contacts: allSearchResults[i * 2 + 1] || "",
        websiteContent: "",
      });
    }

    // ═══ PHASE 2.5: Scrape company websites ═══
    if (FIRECRAWL_API_KEY) {
      const scrapePromises: Promise<void>[] = [];
      for (let i = 0; i < pairedResults.length; i++) {
        const companyLines = pairedResults[i].companies;
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

    // ═══ SINGLE GPT CALL ═══
    const brief = queue.map((i: any, idx: number) => `#${idx + 1}
title: ${i.title}
company_name: ${i.company_name || "(не указана)"}
what_happens: ${i.what_happens || "—"}
problem: ${i.problem || "—"}
action_proposal: ${i.action_proposal || "—"}

НАЙДЕННЫЕ КОМПАНИИ (поиск):
${pairedResults[idx].companies || "(ничего не найдено)"}

НАЙДЕННЫЕ КОНТАКТЫ (поиск):
${pairedResults[idx].contacts || "(ничего не найдено)"}
${pairedResults[idx].websiteContent ? `
КОНТЕНТ САЙТА КОМПАНИИ:
${pairedResults[idx].websiteContent.slice(0, 1500)}
ПЕРСОНАЛИЗАЦИЯ: используй детали с сайта для обращения.` : ""}`).join("\n\n---\n\n");

    const prompt = `Ты — маркетолог Дениса Матеева. Денис помогает компаниям внедрять AI и автоматизацию.

МАНДАТ:
- Размер компании: ${mandateSize} сотрудников. НЕ крупнее! 1С, Яндекс, Сбер — НЕ наши.
- Регион: ${mandateRegion}

🚨 ЗАПРЕТ НА ВЫДУМЫВАНИЕ:
- Используй ТОЛЬКО данные из "НАЙДЕННЫЕ КОМПАНИИ", "НАЙДЕННЫЕ КОНТАКТЫ" и "КОНТЕНТ САЙТА"
- ❌ ЗАПРЕЩЕНО выдумывать имена, email, telegram, linkedin
- ✅ Если нашёл реального человека в результатах поиска — используй
- ✅ Если НЕ нашёл человека — ОБЯЗАТЕЛЬНО создай Уровень B (компания без контакта)

═══ ДВУХУРОВНЕВАЯ КВАЛИФИКАЦИЯ ═══

УРОВЕНЬ A — ПОЛНЫЙ ЛИД (компания + ЛПР + контакт из результатов поиска):
{"source_index":N, "qualified":true, "level":"A",
 "company_name":"название ИЗ РЕЗУЛЬТАТОВ",
 "company_size":"~число сотрудников",
 "company_website":"https://...",
 "contact_name":"Имя Фамилия ИЗ РЕЗУЛЬТАТОВ ПОИСКА",
 "contact_role":"CEO/CTO/CDO",
 "contact_channel":"telegram/email/linkedin ИЗ РЕЗУЛЬТАТОВ",
 "search_evidence":"ЦИТАТА где упоминается контакт",
 "their_pain":"боль компании",
 "our_offer":"что предложить",
 "why_now":"почему сейчас",
 "expected_value":"₽ число",
 "outreach_subject":"тема письма",
 "outreach_message":"4-6 предложений. Подпись: Денис Матеев, @deyuma",
 "approval_request":"Кому + Что + Канал + Чек"}

УРОВЕНЬ B — КОМПАНИЯ БЕЗ КОНТАКТА (есть компания, но НЕТ ЛПР):
{"source_index":N, "qualified":true, "level":"B",
 "company_name":"название ИЗ РЕЗУЛЬТАТОВ",
 "company_size":"~число",
 "company_website":"https://...",
 "their_pain":"боль компании",
 "our_offer":"что предложить",
 "why_now":"почему сейчас",
 "expected_value":"₽ число",
 "search_hints":"ГДЕ искать ЛПР: 1) LinkedIn: запрос '...'. 2) hh.ru: вакансии. 3) Сайт: /team или /about",
 "approval_request":"Компания + Боль + Что предложить + Где искать ЛПР + Чек"}

НЕ КВАЛИФИЦИРОВАН (ТОЛЬКО если вообще НЕ нашёл компании в результатах поиска):
{"source_index":N, "qualified":false, "reason":"причина"}

═══ КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА ═══
1. source_index — номер инсайта (#1 → source_index:1, #2 → source_index:2...)
2. МИНИМУМ 60% инсайтов ДОЛЖНЫ стать лидами (Level A или Level B)
3. Если нашёл ЛЮБУЮ реальную компанию в результатах поиска — это минимум Level B
4. "Не квалифицирован" ТОЛЬКО если поиск вернул пустоту или все компании вне мандата
5. Верни JSON-массив. Без markdown. Ответь РОВНО по количеству инсайтов.
${selfOptimizationPrompt}
ИНСАЙТЫ:
${brief}`;

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "user", content: prompt }], temperature: 0.3 }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("[marketer] AI error:", aiRes.status, t.slice(0, 200));
      throw new Error(`AI error ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const raw = aiData.choices?.[0]?.message?.content || "";
    console.log(`[marketer] GPT raw response (first 800 chars): ${raw.slice(0, 800)}`);

    let aiItems: any[] = [];
    try {
      let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const m = cleaned.match(/\[[\s\S]*\]/);
      if (m) cleaned = m[0];
      aiItems = JSON.parse(cleaned);
      if (!Array.isArray(aiItems)) aiItems = [aiItems];
    } catch (parseErr) {
      console.error("[marketer] Parse error. Raw:", raw.slice(0, 500));
      // FALLBACK: mark all insights as "returned" so they don't loop forever
      for (const insight of queue) {
        await supabase.from("insights").update({
          status: "returned",
          notes: "Маркетолог: ошибка парсинга ответа GPT. Попробуем снова при следующем запуске.",
          updated_at: new Date().toISOString(),
        } as any).eq("id", (insight as any).id);
      }
      return new Response(JSON.stringify({ success: true, insights_processed: queue.length, leads_created: 0, returned_to_analyst: queue.length, parse_error: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let leadsCreated = 0, returned = 0;
    const processedInsightIds = new Set<string>();

    for (const item of aiItems) {
      const qIdx = resolveIndex(item?.source_index, queue.length);
      if (qIdx === null) {
        console.log(`[marketer] Skipping item with invalid source_index: ${item?.source_index}`);
        continue;
      }

      const insight = queue[qIdx] as any;
      if (!insight || processedInsightIds.has(insight.id)) continue;
      processedInsightIds.add(insight.id);

      if (item.qualified) {
        const level = item.level || "A";
        const cn = compact(item.company_name, 120);

        if (!cn) {
          // No company found — return to analyst
          await supabase.from("insights").update({ status: "returned", notes: "Маркетолог: не найдена реальная компания.", updated_at: new Date().toISOString() } as any).eq("id", insight.id);
          returned++;
          console.log(`[marketer] ❌ No company for insight #${qIdx + 1}: "${insight.title}"`);
          continue;
        }

        if (level === "A") {
          // ═══ LEVEL A: Full lead with contact ═══
          const contactName = compact(item.contact_name, 100);
          const contactChannel = compact(item.contact_channel, 200);
          const msg = compact(item.outreach_message, 800);

          if (!contactName || !contactChannel || !msg) {
            // Downgrade to Level B
            console.log(`[marketer] ⬇️ Downgrade to B (missing contact data): ${cn}`);
            const detail = [
              `📨 КОМПАНИЯ: ${cn}`,
              item.company_size ? `👥 ~${item.company_size} сотрудников` : null,
              item.company_website ? `🌐 ${item.company_website}` : null,
              `🔥 ${compact(item.their_pain, 200)}`,
              `💡 ${compact(item.our_offer, 200)}`,
              `⏰ ${compact(item.why_now, 150)}`,
              `💰 ${compact(item.expected_value, 100)}`,
              ``, `🔍 ГДЕ ИСКАТЬ ЛПР: LinkedIn, hh.ru вакансии, страница "Команда" на сайте`,
            ].filter(Boolean).join("\n");

            const { error: le } = await supabase.from("leads").insert({
              company_name: cn, name: null, role: null,
              message: compact(detail, 800),
              lead_summary: compact(item.approval_request, 300) || `${cn}: ${compact(item.our_offer, 150)}`,
              topic_guess: `insight:${insight.id}`,
              status: "needs_contact",
            } as any);

            if (le) { console.error("[marketer] Lead insert error:", le); continue; }
            await supabase.from("insights").update({ status: "qualified", updated_at: new Date().toISOString() } as any).eq("id", insight.id);
            leadsCreated++;
            continue;
          }

          // ═══ ANTI-HALLUCINATION: verify contact in search results ═══
          const searchData = pairedResults[qIdx];
          const allSearchText = `${searchData?.companies || ""} ${searchData?.contacts || ""} ${searchData?.websiteContent || ""}`.toLowerCase();
          const nameParts = contactName.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
          const nameFoundInSearch = nameParts.length > 0 && nameParts.some((part: string) => allSearchText.includes(part));

          if (!nameFoundInSearch && FIRECRAWL_API_KEY) {
            // Downgrade to Level B
            console.log(`[marketer] ⬇️ Contact "${contactName}" not in search — Level B for "${cn}"`);
            const detail = [
              `📨 КОМПАНИЯ: ${cn}`,
              item.company_size ? `👥 ~${item.company_size} сотрудников` : null,
              item.company_website ? `🌐 ${item.company_website}` : null,
              `🔥 ${compact(item.their_pain, 200)}`,
              `💡 ${compact(item.our_offer, 200)}`,
              `⏰ ${compact(item.why_now, 150)}`,
              `💰 ${compact(item.expected_value, 100)}`,
              ``, `🔍 ГДЕ ИСКАТЬ ЛПР: контакт "${contactName}" не подтверждён. Проверить: LinkedIn, hh.ru, страница "Команда".`,
            ].filter(Boolean).join("\n");

            const { error: le } = await supabase.from("leads").insert({
              company_name: cn, name: null,
              role: compact(item.contact_role, 80) || null,
              message: compact(detail, 800),
              lead_summary: compact(item.approval_request, 300) || `${cn}: ${compact(item.our_offer, 150)}`,
              topic_guess: `insight:${insight.id}`,
              status: "needs_contact",
            } as any);

            if (le) { console.error("[marketer] Lead insert error:", le); continue; }
            await supabase.from("insights").update({ status: "qualified", updated_at: new Date().toISOString() } as any).eq("id", insight.id);
            leadsCreated++;
            continue;
          }

          // ═══ LEVEL A: Verified contact ═══
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
            company_name: cn, name: contactName,
            role: compact(item.contact_role, 80) || null,
            message: compact(detail, 800),
            lead_summary: compact(item.approval_request, 300) || `${contactName} (${item.contact_role}) @ ${cn}: ${compact(item.our_offer, 150)}`,
            topic_guess: `insight:${insight.id}`,
            status: "pending_approval",
          } as any);

          if (le) { console.error("[marketer] Lead insert error:", le); continue; }
          await supabase.from("insights").update({ status: "qualified", updated_at: new Date().toISOString() } as any).eq("id", insight.id);
          leadsCreated++;
          console.log(`[marketer] ✅ LEVEL A: ${contactName} @ ${cn}`);

        } else {
          // ═══ LEVEL B: Company without contact ═══
          const detail = [
            `📨 КОМПАНИЯ: ${cn}`,
            item.company_size ? `👥 ~${item.company_size} сотрудников` : null,
            item.company_website ? `🌐 ${item.company_website}` : null,
            `🔥 ${compact(item.their_pain, 200)}`,
            `💡 ${compact(item.our_offer, 200)}`,
            `⏰ ${compact(item.why_now, 150)}`,
            `💰 ${compact(item.expected_value, 100)}`,
            ``, `🔍 ГДЕ ИСКАТЬ ЛПР:`, compact(item.search_hints, 300),
          ].filter(Boolean).join("\n");

          const { error: le } = await supabase.from("leads").insert({
            company_name: cn, name: null, role: null,
            message: compact(detail, 800),
            lead_summary: compact(item.approval_request, 300) || `${cn}: ${compact(item.our_offer, 150)}`,
            topic_guess: `insight:${insight.id}`,
            status: "needs_contact",
          } as any);

          if (le) { console.error("[marketer] Lead insert error:", le); continue; }
          await supabase.from("insights").update({ status: "qualified", updated_at: new Date().toISOString() } as any).eq("id", insight.id);
          leadsCreated++;
          console.log(`[marketer] ✅ LEVEL B: ${cn}`);
        }

      } else {
        const reason = compact(item.reason, 300);
        await supabase.from("insights").update({ status: "returned", notes: `Маркетолог: ${reason}`, updated_at: new Date().toISOString() } as any).eq("id", insight.id);
        try { await supabase.from("agent_feedback").insert({ factory: "consulting", from_agent: "marketer", to_agent: "analyst", feedback_type: "rejection_reason", content: `"${insight.title}": ${reason}`, signal_id: insight.signal_id || null } as any); } catch {}
        returned++;
        console.log(`[marketer] ❌ Rejected: "${insight.title}" — ${reason}`);
      }
    }

    // Mark unprocessed insights as "returned" to avoid infinite loop
    for (const insight of queue) {
      if (!processedInsightIds.has((insight as any).id)) {
        await supabase.from("insights").update({
          status: "returned",
          notes: "Маркетолог: GPT не вернул результат для этого инсайта.",
          updated_at: new Date().toISOString(),
        } as any).eq("id", (insight as any).id);
        returned++;
        console.log(`[marketer] ⚠️ Unprocessed (GPT skipped): "${(insight as any).title}"`);
      }
    }

    // ═══ SELF-OPTIMIZATION: Update KPI ═══
    if (myKpi && leadsCreated > 0) {
      await supabase.from("agent_kpi").update({ current: (myKpi.current || 0) + leadsCreated, updated_at: new Date().toISOString() }).eq("id", myKpi.id);
    }

    // Feedback to analyst if low conversion
    if (queue.length >= 3 && leadsCreated === 0) {
      try {
        await supabase.from("agent_feedback").insert({
          factory: "consulting", from_agent: "marketer", to_agent: "analyst",
          feedback_type: "optimization",
          content: `Конверсия: 0/${queue.length}. Проблемы: ${returned > 0 ? "не могу найти реальных компаний" : "инсайты слишком абстрактные"}. Нужно: конкретная ОТРАСЛЬ + размер компании + ПОИСКОВЫЕ ЗАПРОСЫ.`,
        } as any);
      } catch {}
    }

    if (leadsCreated > 0) {
      // Notify owner about new leads
      await notifyOwner("outreach_ready", {
        company_name: `${leadsCreated} новых лидов`,
        channel: "batch",
        preview: `Маркетолог обработал ${queue.length} инсайтов → ${leadsCreated} лидов, ${returned} отклонено`,
      });

      try {
        await supabase.from("agent_feedback").insert({
          factory: "consulting", from_agent: "marketer", to_agent: "scout",
          feedback_type: "optimization",
          content: `Создано ${leadsCreated} лидов. Продолжай в тех же отраслях. Лучше конвертируются: вакансии, тендеры, конкретные компании.`,
        } as any);
      } catch {}
    }

    console.log(`[marketer] DONE: ${leadsCreated} leads, ${returned} returned, ${queue.length} processed`);

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
