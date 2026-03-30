// marketer-run v2 — fixed insert chain
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

    const { data: insights, error: insightsError } = await supabase
      .from("insights")
      .select("id, title, company_name, what_happens, why_important, problem, action_proposal, signal_id")
      .in("status", ["new", "qualified"])
      .eq("opportunity_type", "consulting")
      .order("created_at", { ascending: true })
      .limit(10);

    if (insightsError) throw insightsError;

    if (!insights || insights.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No new consulting insights to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const insightIds = insights.map((i: any) => i.id);
    const { data: existingLeads } = await supabase
      .from("leads")
      .select("topic_guess")
      .in("topic_guess", insightIds.map((id: string) => `insight:${id}`));

    const alreadyProcessed = new Set((existingLeads || []).map((l: any) => l.topic_guess).filter(Boolean));
    const queue = insights.filter((i: any) => !alreadyProcessed.has(`insight:${i.id}`));

    if (queue.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "All consulting insights already processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brief = queue
      .map((i: any, idx: number) => `#${idx + 1}
title: ${i.title}
company: ${i.company_name || "(не указана — ТЕБЕ НУЖНО НАЙТИ)"}
what_happens: ${i.what_happens}
why_important: ${i.why_important || "(не указано)"}
problem: ${i.problem || "(не указана)"}
action_proposal: ${i.action_proposal || "(не указано)"}`)
      .join("\n\n");

    const prompt = `Ты — маркетолог Дениса Матеева. Денис помогает компаниям внедрять AI и автоматизацию.

ТВОЯ ГЛАВНАЯ ЗАДАЧА — ПРИЗЕМЛИТЬ ИНСАЙТ НА КОНКРЕТНУЮ КОМПАНИЮ:
Аналитик дал тебе ТЕМУ/ТРЕНД/БОЛЬ. Твоя работа — НАЙТИ конкретную компанию в РФ/СНГ, которой это актуально, найти конкретного ЛПР и составить обращение.

ГЕОГРАФИЯ: ТОЛЬКО Россия и СНГ. Иностранные компании — сразу не квалифицируй.
РАЗМЕР КОМПАНИИ: 50–500 сотрудников. Если явно больше 500 (корпорации типа М.Видео, Сбер, Яндекс) — не квалифицируй.
ЯЗЫК: Все на русском.

ПРОЦЕСС ПРИЗЕМЛЕНИЯ:
1. Прочитай инсайт от Аналитика — пойми ТЕМУ, БОЛЬ, ПРОФИЛЬ ЦА
2. Подумай: КАКАЯ КОНКРЕТНАЯ КОМПАНИЯ из РФ/СНГ прямо сейчас страдает от этой боли?
3. Если в инсайте уже есть название компании — проверь, подходит ли она (РФ/СНГ, 50-500 чел)
4. Если компании нет — НАЙДИ подходящую по профилю ЦА из инсайта
5. Определи ЛПР: КТО в этой компании принимает решение по данной проблеме
6. Составь персонализированное обращение

КРИТИЧЕСКИ ВАЖНО — БЕЗ ЭТОГО НЕ КВАЛИФИЦИРУЙ:
✅ РЕАЛЬНАЯ компания (которую можно найти в интернете, с сайтом)
✅ КОНКРЕТНЫЙ ЛПР (должность + где найти контакт)
✅ ПЕРСОНАЛИЗИРОВАННЫЙ outreach (с конкретным поводом, который ЛПР УЗНАЕТ)
✅ Понятная боль компании
✅ Конкретное предложение (не "автоматизация", а "AI-бот для обработки 500+ заявок/день")
✅ Триггер ПОЧЕМУ СЕЙЧАС

❌ НЕ ОТПРАВЛЯЙ НА СОГЛАСОВАНИЕ:
- Без конкретной компании (абстрактный "средний бизнес в e-commerce")
- Без конкретного ЛПР (абстрактный "CEO/CTO")
- С выдуманными компаниями (если не уверен, что компания реальна — не квалифицируй)
- Без контакта (хотя бы "найти через LinkedIn по запросу [X]")

ЕСЛИ КВАЛИФИЦИРУЕШЬ — верни:
{
  "source_index": 1,
  "qualified": true,
  "company_name": "РЕАЛЬНОЕ название компании",
  "company_website": "URL сайта компании (для верификации)",
  "company_size": "Примерный размер (если известен)",
  "contact_name": "Имя ЛПР (если известно, иначе null)",
  "contact_role": "Должность ЛПР",
  "contact_email": "Email (если известен, иначе null)",
  "where_to_find": "КОНКРЕТНО: LinkedIn-профиль / hh.ru вакансия / сайт раздел Контакты / Telegram — с деталями поиска",
  "their_pain": "Боль ЭТОЙ КОНКРЕТНОЙ компании (не абстрактная, а привязанная к их ситуации)",
  "our_offer": "Что предлагаем ЭТОЙ компании — КОНКРЕТНО",
  "why_now": "КОНКРЕТНЫЙ триггер для ЭТОЙ компании: их вакансия, их публикация, новый закон, который их затрагивает",
  "outreach_channel": "Email / Telegram / LinkedIn — и ПОЧЕМУ именно этот канал для ЭТОГО ЛПР",
  "expected_value": "Сумма в ₽ — обоснование",
  "outreach_subject": "Тема письма (короткая, с триггером, без кликбейта)",
  "outreach_message": "ПОЛНЫЙ ТЕКСТ ПИСЬМА",
  "approval_request": "[КОМУ: имя+должность] в [КОМПАНИЯ] пишем про [БОЛЬ] → предлагаем [ЧТО] за [СКОЛЬКО ₽]. Триггер: [ПОЧЕМУ СЕЙЧАС]. Канал: [ГДЕ]."
}

ПРАВИЛА НАПИСАНИЯ OUTREACH-ПИСЬМА (outreach_message):
- Пиши как живой человек, НЕ как маркетинговый робот
- Без смайликов, без восклицательных знаков, без буллетов
- Начинай с КОНКРЕТНОГО повода: "Увидел вашу вакансию...", "Прочитал ваш кейс на Хабре...", "В связи с новым ФЗ..."
- Без фраз: "Здравствуйте!", "Мы — компания...", "Мы специализируемся на..."
- Тон: для CEO — короче, ROI и деньги; для CTO — техничнее
- Длина: 4-6 предложений. Коротко и по делу.
- Заканчивай конкретным предложением: "Могу показать на созвоне за 15 минут"
- Подпись: "Денис Матеев"

ЕСЛИ НЕ МОЖЕШЬ ПРИЗЕМЛИТЬ (не нашёл подходящую компанию):
{
  "source_index": 1,
  "qualified": false,
  "reason": "КОНКРЕТНАЯ причина — чего не хватает. Например: 'Тема актуальная, но не смог найти конкретную компанию 50-500 чел в РФ, которой это прямо сейчас нужно. Нужен более конкретный профиль ЦА от Аналитика.'"
}

Верни строго JSON-массив без markdown.

ИНСАЙТЫ ОТ АНАЛИТИКА:
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
        temperature: 0.3,
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
      // Try to extract JSON array even if GPT added text around it
      const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
      if (arrayMatch) cleaned = arrayMatch[0];
      aiItems = JSON.parse(cleaned);
      if (!Array.isArray(aiItems)) aiItems = [aiItems];
    } catch {
      console.error("Failed to parse marketer JSON:", content.slice(0, 500));
      // Return gracefully instead of throwing
      return new Response(JSON.stringify({
        success: true,
        insights_processed: queue.length,
        leads_created: 0,
        returned_to_analyst: 0,
        parse_warning: "AI returned non-JSON response, retrying on next run",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let leadsCreated = 0;
    let returned = 0;

    for (const item of aiItems) {
      const sourceIndex = Number(item?.source_index);
      if (!Number.isInteger(sourceIndex) || sourceIndex < 1 || sourceIndex > queue.length) continue;

      const insight = queue[sourceIndex - 1] as any;
      if (!insight) continue;

      if (item.qualified) {
        // ═══ VALIDATION: Reject if no real company or contact ═══
        const companyName = compactText(item.company_name, 120);
        const contactRole = compactText(item.contact_role, 80);
        const whereToFind = compactText(item.where_to_find, 200);
        const outreachMessage = compactText(item.outreach_message, 800);

        if (!companyName || !contactRole || !whereToFind || !outreachMessage) {
          console.log(`Skipping insight ${insight.id}: missing company/contact/outreach`);
          await supabase
            .from("insights")
            .update({
              status: "returned",
              notes: "Маркетолог: не удалось найти конкретную компанию или ЛПР для этого инсайта.",
              updated_at: new Date().toISOString(),
            } as any)
            .eq("id", insight.id);

        try {
          await supabase.from("agent_feedback").insert({
            factory: "consulting",
            from_agent: "marketer",
            to_agent: "analyst",
            feedback_type: "quality_issue",
            content: `Инсайт "${insight.title}" не удалось приземлить: GPT не смог найти компанию/ЛПР. Нужен более конкретный профиль ЦА с указанием отрасли, размера, конкретных признаков боли.`,
            insight_id: insight.id,
          } as any);
        } catch (e: any) { console.error("Feedback insert error:", e); }

          returned++;
          continue;
        }

        const approvalText = compactText(item.approval_request, 300) ||
          `${companyName}: предлагаем ${item.our_offer}. Канал: ${item.outreach_channel}. Чек: ${item.expected_value}`;

        const detailedMessage = [
          `📨 КОМУ: ${item.contact_name || contactRole} — ${companyName}`,
          item.company_website ? `🌐 САЙТ: ${item.company_website}` : null,
          item.contact_email ? `📧 EMAIL: ${item.contact_email}` : null,
          `🔍 ГДЕ НАЙТИ: ${whereToFind}`,
          `🔥 БОЛЬ: ${item.their_pain}`,
          `💡 ПРЕДЛОЖЕНИЕ: ${item.our_offer}`,
          `⏰ ПОВОД: ${item.why_now}`,
          `💰 ЧЕК: ${item.expected_value}`,
          ``,
          `📧 ТЕМА: ${item.outreach_subject || ""}`,
          ``,
          `--- ТЕКСТ ПИСЬМА ---`,
          outreachMessage,
          `--- КОНЕЦ ---`,
        ].filter(Boolean).join("\n");

        const { error: leadError } = await supabase.from("leads").insert({
          company_name: companyName || insight.company_name,
          role: contactRole || null,
          message: compactText(detailedMessage, 800),
          lead_summary: compactText(approvalText, 300),
          topic_guess: `insight:${insight.id}`,
          status: "pending_approval",
        } as any);

        if (leadError) {
          console.error("Lead insert error:", leadError);
          continue;
        }

        await supabase
          .from("insights")
          .update({ status: "qualified", updated_at: new Date().toISOString() } as any)
          .eq("id", insight.id);

        leadsCreated++;
      } else {
        const reason = compactText(item.reason, 300);
        await supabase
          .from("insights")
          .update({
            status: "returned",
            notes: `Маркетолог: ${reason}`,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", insight.id);

        // ═══ Feedback loop: сообщаем аналитику и скауту ═══
        try {
          await supabase.from("agent_feedback").insert({
            factory: "consulting",
            from_agent: "marketer",
            to_agent: "analyst",
            feedback_type: "rejection_reason",
            content: `Отклонил инсайт "${insight.title}": ${reason}. Нужны более конкретные инсайты с привязкой к реальным компаниям РФ/СНГ.`,
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
      leads_created: leadsCreated,
      returned_to_analyst: returned,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("marketer-run error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
