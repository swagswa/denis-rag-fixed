// marketer-run v3 — Firecrawl-powered real company search
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function compact(value: unknown, max = 900) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

// ═══ FIRECRAWL: поиск реальных компаний ═══
async function searchCompanies(query: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit: 5,
        lang: "ru",
        country: "ru",
        scrapeOptions: { formats: ["markdown"] },
      }),
    });

    if (!res.ok) {
      console.error("Firecrawl search error:", res.status);
      return "(поиск недоступен)";
    }

    const data = await res.json();
    const results = data?.data || data?.results || [];
    if (!Array.isArray(results) || results.length === 0) return "(ничего не найдено)";

    return results
      .slice(0, 3)
      .map((r: any, i: number) => {
        const title = r.title || "";
        const url = r.url || "";
        const snippet = (r.description || r.markdown || "").slice(0, 300);
        return `[${i + 1}] ${title}\nURL: ${url}\n${snippet}`;
      })
      .join("\n\n");
  } catch (e: any) {
    console.error("Firecrawl error:", e.message);
    return "(поиск недоступен)";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") || "";

    let triggeredBy = "cron";
    try { triggeredBy = (await req.clone().json())?.triggered_by || "cron"; } catch {}

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ═══ 1. Загрузить инсайты ═══
    const { data: insights, error: insErr } = await supabase
      .from("insights")
      .select("id, title, company_name, what_happens, why_important, problem, action_proposal, signal_id")
      .in("status", ["new", "qualified"])
      .eq("opportunity_type", "consulting")
      .order("created_at", { ascending: true })
      .limit(5); // меньше за раз, но качественнее

    if (insErr) throw insErr;
    if (!insights || insights.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No new consulting insights to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Отфильтровать уже обработанные
    const ids = insights.map((i: any) => i.id);
    const { data: existing } = await supabase
      .from("leads")
      .select("topic_guess")
      .in("topic_guess", ids.map((id: string) => `insight:${id}`));

    const done = new Set((existing || []).map((l: any) => l.topic_guess));
    const queue = insights.filter((i: any) => !done.has(`insight:${i.id}`));

    if (queue.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "All insights already processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let leadsCreated = 0;
    let returned = 0;

    // ═══ 2. Обрабатываем каждый инсайт ОТДЕЛЬНО с поиском ═══
    for (const insight of queue as any[]) {
      // Шаг A: Формируем поисковый запрос для Firecrawl
      const searchQuery = `${insight.problem || insight.title} компания Россия сайт контакты`;
      
      let searchResults = "(поиск отключён)";
      if (FIRECRAWL_API_KEY) {
        console.log(`[marketer] Searching companies for: "${insight.title}"`);
        searchResults = await searchCompanies(searchQuery, FIRECRAWL_API_KEY);
      }

      // Шаг B: GPT приземляет инсайт на найденные компании
      const prompt = `Ты — маркетолог Дениса Матеева. Денис помогает компаниям внедрять AI и автоматизацию.

ИНСАЙТ ОТ АНАЛИТИКА:
Тема: ${insight.title}
Что происходит: ${insight.what_happens || "—"}
Почему важно: ${insight.why_important || "—"}
Боль: ${insight.problem || "—"}
Предложение: ${insight.action_proposal || "—"}

РЕЗУЛЬТАТЫ ПОИСКА РЕАЛЬНЫХ КОМПАНИЙ:
${searchResults}

ТВОЯ ЗАДАЧА:
Выбери из результатов поиска ОДНУ РЕАЛЬНУЮ компанию из России/СНГ (50-500 сотрудников), которой этот инсайт максимально актуален. Используй ТОЛЬКО реальные данные из поиска — НЕ ВЫДУМЫВАЙ компании.

Если подходящая компания найдена — КВАЛИФИЦИРУЙ:
{
  "qualified": true,
  "company_name": "РЕАЛЬНОЕ название из поиска",
  "company_website": "URL из поиска",
  "company_size": "оценка",
  "contact_name": "Имя ЛПР если найдено, иначе null",
  "contact_role": "Должность ЛПР (CEO/CTO/CDO/COO)",
  "contact_email": "Email если найден, иначе null",
  "where_to_find": "Где найти ЛПР: LinkedIn / сайт / hh.ru — конкретно",
  "their_pain": "Боль ЭТОЙ компании (из контекста поиска)",
  "our_offer": "Что конкретно предлагаем",
  "why_now": "Почему сейчас — конкретный триггер",
  "outreach_channel": "Email / LinkedIn / Telegram",
  "expected_value": "Сумма в ₽",
  "outreach_subject": "Тема письма",
  "outreach_message": "ПОЛНЫЙ текст письма 4-6 предложений. Начни с конкретного повода. Без 'Здравствуйте!', без буллетов. Подпись: Денис Матеев",
  "approval_request": "Краткое описание: кому, что, зачем"
}

Если НЕ нашёл подходящую компанию:
{
  "qualified": false,
  "reason": "Конкретная причина — что не так с результатами поиска"
}

Верни ТОЛЬКО один JSON-объект, без markdown.`;

      const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
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

      if (!aiRes.ok) {
        console.error("AI error:", aiRes.status);
        if (aiRes.status === 429) {
          await aiRes.text();
          break; // rate limit — остановить цикл
        }
        await aiRes.text();
        continue;
      }

      const aiData = await aiRes.json();
      const raw = aiData.choices?.[0]?.message?.content || "";

      let item: any;
      try {
        let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const objMatch = cleaned.match(/\{[\s\S]*\}/);
        if (objMatch) cleaned = objMatch[0];
        item = JSON.parse(cleaned);
      } catch {
        console.error("Parse error for insight", insight.id, raw.slice(0, 200));
        continue;
      }

      if (item.qualified) {
        const companyName = compact(item.company_name, 120);
        const contactRole = compact(item.contact_role, 80);
        const whereToFind = compact(item.where_to_find, 200);
        const outreachMessage = compact(item.outreach_message, 800);

        if (!companyName || !outreachMessage) {
          // Не хватает данных — возврат аналитику
          await supabase.from("insights").update({
            status: "returned",
            notes: "Маркетолог: не удалось найти подходящую компанию даже через поиск.",
            updated_at: new Date().toISOString(),
          } as any).eq("id", insight.id);

          await supabase.from("agent_feedback").insert({
            factory: "consulting",
            from_agent: "marketer",
            to_agent: "analyst",
            feedback_type: "quality_issue",
            content: `Инсайт "${insight.title}": поиск не дал релевантных компаний. Нужен более конкретный профиль ЦА.`,
          } as any).catch(() => {});

          returned++;
          continue;
        }

        const detail = [
          `📨 КОМУ: ${item.contact_name || contactRole} — ${companyName}`,
          item.company_website ? `🌐 ${item.company_website}` : null,
          item.contact_email ? `📧 ${item.contact_email}` : null,
          `🔍 ГДЕ НАЙТИ: ${whereToFind}`,
          `🔥 БОЛЬ: ${compact(item.their_pain, 200)}`,
          `💡 ПРЕДЛОЖЕНИЕ: ${compact(item.our_offer, 200)}`,
          `⏰ ПОВОД: ${compact(item.why_now, 200)}`,
          `💰 ЧЕК: ${compact(item.expected_value, 100)}`,
          ``,
          `📧 ТЕМА: ${compact(item.outreach_subject, 100)}`,
          ``,
          `--- ТЕКСТ ПИСЬМА ---`,
          outreachMessage,
          `--- КОНЕЦ ---`,
        ].filter(Boolean).join("\n");

        const { error: leadErr } = await supabase.from("leads").insert({
          company_name: companyName,
          role: contactRole || null,
          message: compact(detail, 800),
          lead_summary: compact(item.approval_request, 300) || `${companyName}: ${compact(item.our_offer, 200)}`,
          topic_guess: `insight:${insight.id}`,
          status: "pending_approval",
        } as any);

        if (leadErr) {
          console.error("Lead insert error:", leadErr);
          continue;
        }

        await supabase.from("insights").update({
          status: "qualified",
          updated_at: new Date().toISOString(),
        } as any).eq("id", insight.id);

        leadsCreated++;
        console.log(`[marketer] ✅ Lead created: ${companyName}`);
      } else {
        const reason = compact(item.reason, 300);
        await supabase.from("insights").update({
          status: "returned",
          notes: `Маркетолог: ${reason}`,
          updated_at: new Date().toISOString(),
        } as any).eq("id", insight.id);

        await supabase.from("agent_feedback").insert({
          factory: "consulting",
          from_agent: "marketer",
          to_agent: "analyst",
          feedback_type: "rejection_reason",
          content: `Отклонил "${insight.title}": ${reason}`,
          signal_id: insight.signal_id || null,
        } as any).catch(() => {});

        returned++;
      }

      // Пауза между запросами
      await new Promise(r => setTimeout(r, 2000));
    }

    return new Response(JSON.stringify({
      success: true,
      insights_processed: queue.length,
      leads_created: leadsCreated,
      returned_to_analyst: returned,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("marketer-run error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
