// send-outreach — отправляет outreach через Gmail SMTP или Telegram
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TELEGRAM_GATEWAY = "https://connector-gateway.lovable.dev/telegram";

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

    // Extract outreach text from lead.message
    const message = lead.message || "";

    // Determine channel: "telegram" or "email"
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
  // If message contains telegram handle (@...) or "Telegram", use telegram
  if (/@[a-zA-Z0-9_]{3,}/.test(message) || /telegram/i.test(message)) return "telegram";
  return "email";
}

// ═══ TELEGRAM ═══
async function sendTelegram(message: string, lead: any) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");

  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  if (!TELEGRAM_API_KEY) throw new Error("TELEGRAM_API_KEY not configured");

  // Extract outreach text (between --- ТЕКСТ --- and --- КОНЕЦ ---)
  const textMatch = message.match(/---\s*ТЕКСТ\s*---\s*([\s\S]*?)\s*---\s*КОНЕЦ\s*---/);
  const outreachText = textMatch ? textMatch[1].trim() : message;

  // Find telegram handle in message
  const handleMatch = message.match(/@([a-zA-Z0-9_]{3,})/);

  if (!handleMatch) {
    // No handle found — send to owner's chat for manual forwarding
    // First, get the bot's chat ID (send to self)
    const meRes = await fetch(`${TELEGRAM_GATEWAY}/getMe`, {
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TELEGRAM_API_KEY,
      },
    });
    const meData = await meRes.json();

    return {
      sent: false,
      note: "No Telegram handle found in lead. Message prepared for manual sending.",
      text: outreachText,
    };
  }

  // Try to resolve username to chat_id via getChat (works if they've interacted with bot)
  // For cold outreach, we can't DM directly — prepare the message
  return {
    sent: false,
    channel: "telegram",
    handle: `@${handleMatch[1]}`,
    text: outreachText,
    note: `Telegram: подготовлено сообщение для @${handleMatch[1]}. Telegram Bot API не позволяет писать первым — отправь вручную или через личный аккаунт.`,
  };
}

// ═══ GMAIL SMTP ═══
async function sendEmail(message: string, lead: any) {
  const GMAIL_ADDRESS = Deno.env.get("GMAIL_ADDRESS");
  const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD");

  if (!GMAIL_ADDRESS) throw new Error("GMAIL_ADDRESS not configured");
  if (!GMAIL_APP_PASSWORD) throw new Error("GMAIL_APP_PASSWORD not configured");

  // Extract email address from message or lead
  const emailMatch = message.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
  const recipientEmail = emailMatch ? emailMatch[0] : null;

  // Extract subject line
  const subjectMatch = message.match(/Тема:\s*(.+?)(?:\n|---)/);
  const subject = subjectMatch ? subjectMatch[1].trim() : `Предложение для ${lead.company_name || "вашей компании"}`;

  // Extract outreach text
  const textMatch = message.match(/---\s*ТЕКСТ\s*---\s*([\s\S]*?)\s*---\s*КОНЕЦ\s*---/);
  const bodyText = textMatch ? textMatch[1].trim() : message;

  if (!recipientEmail) {
    // Extract contact name for manual sending
    return {
      sent: false,
      channel: "email",
      subject,
      text: bodyText,
      note: `Email: нет email-адреса в лиде. Подготовлен текст для ручной отправки на ${lead.name || lead.company_name}.`,
    };
  }

  // Send via SMTP using Deno's built-in SMTP
  // Deno doesn't have built-in SMTP, use a simple HTTP-based approach via Gmail API
  // Actually, use raw SMTP via Deno TCP
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
