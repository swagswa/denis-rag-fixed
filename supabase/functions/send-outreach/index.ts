// send-outreach — отправляет outreach через Gmail SMTP или Telegram Bot API
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { lead_id, channel } = await req.json();
    if (!lead_id) throw new Error("lead_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch lead
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .single();

    if (leadErr || !lead) throw new Error("Lead not found: " + (leadErr?.message || lead_id));

    const message = lead.message || "";
    const sendChannel = channel || detectChannel(message);

    let result: any = {};

    if (sendChannel === "telegram") {
      result = await sendTelegram(message, lead);
    } else {
      result = await sendEmail(message, lead);
    }

    // Update lead status
    await supabase
      .from("leads")
      .update({ status: "sent", updated_at: new Date().toISOString() })
      .eq("id", lead_id);

    return new Response(JSON.stringify({ success: true, channel: sendChannel, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("send-outreach error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function detectChannel(message: string): string {
  if (/@[a-zA-Z0-9_]{3,}/.test(message) || /telegram/i.test(message)) return "telegram";
  return "email";
}

// ═══ TELEGRAM (прямой Bot API, без gateway) ═══
async function sendTelegram(message: string, lead: any) {
  const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not configured");

  // Твой личный chat_id для получения outreach-сообщений на согласование
  const OWNER_CHAT_ID = Deno.env.get("TELEGRAM_OWNER_CHAT_ID");

  // Извлечь текст outreach
  const textMatch = message.match(/---\s*ТЕКСТ\s*---\s*([\s\S]*?)\s*---\s*КОНЕЦ\s*---/);
  const outreachText = textMatch ? textMatch[1].trim() : message;

  // Найти telegram handle
  const handleMatch = message.match(/@([a-zA-Z0-9_]{3,})/);
  const handle = handleMatch ? `@${handleMatch[1]}` : null;

  // Telegram Bot API не позволяет писать первым по username.
  // Отправляем сообщение тебе (owner) с готовым текстом для пересылки.
  if (!OWNER_CHAT_ID) {
    return {
      sent: false,
      channel: "telegram",
      handle,
      text: outreachText,
      note: "TELEGRAM_OWNER_CHAT_ID не настроен. Добавь свой chat_id в секреты.",
    };
  }

  const prefix = handle
    ? `📨 Outreach для ${handle} (${lead.company_name || lead.name || "лид"}):\n\n`
    : `📨 Outreach для ${lead.company_name || lead.name || "лид"} (handle не найден):\n\n`;

  const fullText = prefix + outreachText;

  // Отправить тебе в Telegram
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: OWNER_CHAT_ID,
      text: fullText,
      parse_mode: "HTML",
    }),
  });

  const data = await res.json();

  if (!data.ok) {
    console.error("Telegram API error:", data);
    return {
      sent: false,
      channel: "telegram",
      handle,
      text: outreachText,
      note: `Telegram ошибка: ${data.description || "unknown"}`,
    };
  }

  return {
    sent: true,
    channel: "telegram",
    handle,
    message_id: data.result?.message_id,
    note: `Отправлено тебе в Telegram. ${handle ? `Перешли ${handle}.` : "Handle не найден — отправь вручную."}`,
  };
}

// ═══ GMAIL SMTP ═══
async function sendEmail(message: string, lead: any) {
  const GMAIL_ADDRESS = Deno.env.get("GMAIL_ADDRESS");
  const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD");

  if (!GMAIL_ADDRESS) throw new Error("GMAIL_ADDRESS not configured");
  if (!GMAIL_APP_PASSWORD) throw new Error("GMAIL_APP_PASSWORD not configured");

  const emailMatch = message.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
  const recipientEmail = emailMatch ? emailMatch[0] : null;

  const subjectMatch = message.match(/Тема:\s*(.+?)(?:\n|---)/);
  const subject = subjectMatch ? subjectMatch[1].trim() : `Предложение для ${lead.company_name || "вашей компании"}`;

  const textMatch = message.match(/---\s*ТЕКСТ\s*---\s*([\s\S]*?)\s*---\s*КОНЕЦ\s*---/);
  const bodyText = textMatch ? textMatch[1].trim() : message;

  if (!recipientEmail) {
    return {
      sent: false,
      channel: "email",
      subject,
      text: bodyText,
      note: `Email: нет email-адреса в лиде. Подготовлен текст для ручной отправки на ${lead.name || lead.company_name}.`,
    };
  }

  try {
    const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: {
          username: GMAIL_ADDRESS,
          password: GMAIL_APP_PASSWORD,
        },
      },
    });

    await client.send({
      from: GMAIL_ADDRESS,
      to: recipientEmail,
      subject,
      content: bodyText,
      html: bodyText.replace(/\n/g, "<br>"),
    });

    await client.close();

    return {
      sent: true,
      channel: "email",
      to: recipientEmail,
      subject,
    };
  } catch (smtpErr: any) {
    console.error("SMTP error:", smtpErr);
    return {
      sent: false,
      channel: "email",
      to: recipientEmail,
      subject,
      text: bodyText,
      note: `SMTP ошибка: ${smtpErr.message}. Текст готов для ручной отправки.`,
    };
  }
}
