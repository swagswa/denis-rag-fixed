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

    const { data: insights, error: insErr } = await supabase
      .from("insights")
      .select("id, title, company_name, what_happens, why_important, problem, action_proposal, signal_id")
      .in("status", ["new", "qualified"])
      .eq("opportunity_type", "consulting")
      .order("created_at", { ascending: true })
      .limit(3);

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
    const pairedResults: { companies: string; contacts: string }[] = [];
    for (let i = 0; i < queue.length; i++) {
      pairedResults.push({
        companies: allSearchResults[i * 2] || "",
        contacts: allSearchResults[i * 2 + 1] || "",
      });
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
${pairedResults[idx].contacts || "(ничего не найдено)"}`).join("\n\n---\n\n");

    const prompt = `Ты — маркетолог Дениса Матеева. Денис помогает компаниям внедрять AI и автоматизацию.

МАНДАТ (ЖЁСТКИЙ — нарушение = автоматический отказ):
- Размер компании: ${mandateSize} сотрудников. НЕ крупнее! 1С, Яндекс, Сбер — это НЕ наши клиенты.
- Регион: ${mandateRegion}
- Компания должна быть РЕАЛЬНОЙ — из результатов поиска, НЕ выдуманной.

🚨 КРИТИЧЕСКИ ВАЖНО — ЗАПРЕТ НА ВЫДУМЫВАНИЕ:
Ты ОБЯЗАН использовать ТОЛЬКО данные из "НАЙДЕННЫЕ КОМПАНИИ" и "НАЙДЕННЫЕ КОНТАКТЫ".
❌ ЗАПРЕЩЕНО: выдумывать имена, фамилии, email, telegram, linkedin — ДАЖЕ если они "звучат реалистично"
❌ ЗАПРЕЩЕНО: подставлять типичные имена (Иван Петров, Алексей Смирнов) если их НЕТ в результатах поиска
✅ РАЗРЕШЕНО: использовать ТОЛЬКО имена, контакты и компании, которые БУКВАЛЬНО присутствуют в тексте поиска выше

ПРОВЕРКА ПЕРЕД ОТВЕТОМ:
Для каждого лида спроси себя:
1. Имя ЛПР — я ВИЖУ это имя в результатах поиска? (да/нет)
2. Контакт — я ВИЖУ этот email/TG/LinkedIn в результатах? (да/нет)
3. Компания — она УПОМИНАЕТСЯ в результатах? (да/нет)
Если хотя бы один ответ "нет" — НЕ квалифицируй, верни reason.

Для каждого инсайта ниже:

Если КВАЛИФИЦИРОВАН (РЕАЛЬНАЯ компания + РЕАЛЬНЫЙ человек ИЗ ПОИСКА + РЕАЛЬНЫЙ контакт ИЗ ПОИСКА):
{"source_index":N, "qualified":true,
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

Если НЕ КВАЛИФИЦИРОВАН:
{"source_index":N, "qualified":false, "reason":"Конкретная причина: не нашёл реального ЛПР в результатах поиска / компания вне мандата / нет контакта"}

Верни JSON-массив. Без markdown.

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
