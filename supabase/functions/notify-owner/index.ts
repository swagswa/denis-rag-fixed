// notify-owner — отправляет уведомления владельцу в Telegram
// Типы событий:
//   1. outreach_ready  — маркетолог подготовил outreach
//   2. project_ready   — создатель подготовил проект на рассмотрение
//   3. new_conversation — начался диалог с пользователем через ассистента
//   4. new_lead         — пришёл новый лид

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TELEGRAM_API = "https://api.telegram.org";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const BOT_TOKEN = Deno.env.get("TELEGRAM_API_KEY");
    const CHAT_ID = Deno.env.get("TELEGRAM_OWNER_CHAT_ID");

    if (!BOT_TOKEN) throw new Error("TELEGRAM_API_KEY not configured");
    if (!CHAT_ID) throw new Error("TELEGRAM_OWNER_CHAT_ID not configured");

    const { event_type, data } = await req.json();

    if (!event_type) throw new Error("event_type required");

    const message = formatMessage(event_type, data || {});

    // Отправить в Telegram
    const res = await fetch(`${TELEGRAM_API}/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const result = await res.json();

    if (!result.ok) {
      console.error("Telegram error:", result);
      throw new Error(result.description || "Telegram send failed");
    }

    return new Response(JSON.stringify({ success: true, message_id: result.result?.message_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("notify-owner error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function formatMessage(eventType: string, data: any): string {
  switch (eventType) {
    case "outreach_ready":
      return [
        `📨 <b>Outreach готов к отправке</b>`,
        ``,
        `🏢 ${data.company_name || "—"}`,
        `👤 ${data.contact_name || "—"}`,
        `📧 Канал: ${data.channel || "email"}`,
        data.subject ? `📋 Тема: ${data.subject}` : "",
        ``,
        `💬 <i>${truncate(data.preview || data.text || "", 300)}</i>`,
        ``,
        `👉 Зайди в Twin → Leads для одобрения`,
      ].filter(Boolean).join("\n");

    case "project_ready":
      return [
        `🚀 <b>Новый проект на рассмотрение</b>`,
        ``,
        `💡 ${data.idea || data.title || "—"}`,
        `🎯 Рынок: ${data.market || "—"}`,
        `💰 Оценка: ${data.revenue_estimate ? `₽${data.revenue_estimate}` : "—"}`,
        `⚙️ Сложность: ${data.complexity || "—"}`,
        ``,
        data.problem ? `📌 Проблема: ${truncate(data.problem, 200)}` : "",
        data.solution ? `✅ Решение: ${truncate(data.solution, 200)}` : "",
        ``,
        `👉 Зайди в Twin → Opportunities`,
      ].filter(Boolean).join("\n");

    case "new_conversation":
      return [
        `💬 <b>Новый диалог с ассистентом</b>`,
        ``,
        `🌐 Сайт: ${data.site_id || "—"}`,
        `👤 Посетитель: ${data.visitor_id || "аноним"}`,
        data.first_message ? `💬 "${truncate(data.first_message, 200)}"` : "",
        ``,
        `👉 Зайди в Twin → Assistant`,
      ].filter(Boolean).join("\n");

    case "new_lead":
      return [
        `🔥 <b>Новый лид</b>`,
        ``,
        `🏢 ${data.company_name || "—"}`,
        `👤 ${data.name || "—"}`,
        `💼 ${data.role || "—"}`,
        data.topic_guess ? `🎯 Тема: ${data.topic_guess}` : "",
        data.lead_summary ? `📝 ${truncate(data.lead_summary, 250)}` : "",
        ``,
        `👉 Зайди в Twin → Leads`,
      ].filter(Boolean).join("\n");

    default:
      return `🔔 <b>Событие: ${eventType}</b>\n\n${JSON.stringify(data, null, 2).slice(0, 500)}`;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}
