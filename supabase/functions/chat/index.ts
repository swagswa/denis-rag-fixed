import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ChatMessage = { role: "user" | "assistant"; content: string };
type PageContext = { url?: string; title?: string; section?: string };
type DetectedLead = { name: string | null; phone: string | null; email: string | null; telegram: string | null; message: string };

const DEFAULT_SYSTEM_PROMPT = `Ты — AI-ассистент Дениса Матеева.
Отвечай по-русски, кратко, по делу, без воды.

═══ ВАЖНО: КОНТАКТНЫЕ ДАННЫЕ ═══
Если пользователь оставляет контакт (телефон, email, @telegram, WhatsApp, имя) или просит связаться —
НЕ ЗАДАВАЙ ЛИШНИХ ВОПРОСОВ! Ответь ДОСЛОВНО:
"Спасибо! Денис свяжется с вами в ближайшее время. Если срочно — напишите ему в Telegram [@deyuma](https://t.me/deyuma)."
И ВСЁ. Не спрашивай "а что именно вас интересует" — человек уже готов общаться.`;

const QUIZ_TRIGGER = `

═══ КВИЗ-РЕЖИМ ═══
Если пользователь задаёт размытый вопрос или это его ПЕРВОЕ сообщение — запусти мини-квиз из 3 вопросов:

"Давай разберёмся, чем конкретно могу помочь! Ответь на 3 быстрых вопроса:

**1. Чем занимается ваша компания?**
а) E-commerce / маркетплейс  б) B2B-услуги / консалтинг  в) IT / разработка  г) Производство / логистика  д) Другое

**2. Сколько человек в команде?**
а) 1-10  б) 10-50  в) 50-200  г) 200+

**3. Что больше всего болит?**
а) Рутинные задачи отнимают время  б) Клиенты уходят / мало лидов  в) Нет аналитики  г) Хочу запустить AI-продукт"

После ответов — дай персонализированную рекомендацию и предложи написать в Telegram @deyuma.`;

const LEAD_BOOSTER = `

═══ ВОВЛЕЧЕНИЕ ═══
В этом диалоге уже 3+ сообщения от пользователя, но ты ещё не предложил связаться.
В этом ответе мягко предложи продолжить разговор лично и обязательно дай контакт @deyuma.`;

// ═══ HELPERS ═══

function sanitizeMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => typeof m === "object" && m !== null)
    .map((m: any) => ({ role: m.role, content: String(m.content || "").trim() }))
    .filter((m): m is ChatMessage => (m.role === "user" || m.role === "assistant") && m.content.length > 0);
}

function detectProductContext(pc?: PageContext): string {
  const j = `${pc?.url || ""} ${pc?.title || ""} ${pc?.section || ""}`.toLowerCase();
  if (j.includes("foundry") || j.includes("agent-fo")) return "foundry";
  if (j.includes("ai-advisor") || j.includes("aisovetnik") || j.includes("советник")) return "aisovetnik";
  if (j.includes("ai-transformation") || j.includes("aitransformation") || j.includes("трансформац")) return "aitransformation";
  return "general";
}

function getSiteId(pc?: PageContext, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const p = detectProductContext(pc);
  return p === "general" ? "denismateev" : p;
}

function shouldBoostLead(msgs: ChatMessage[]): boolean {
  const uc = msgs.filter((m) => m.role === "user").length;
  if (uc < 3) return false;
  return !msgs.some((m) => m.role === "assistant" && m.content.includes("@deyuma"));
}

function detectContactInfo(msgs: ChatMessage[]): DetectedLead | null {
  const txt = msgs.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  if (!txt.trim()) return null;
  const phoneMatch = txt.match(/(?:\+7|8)[\s\-\(]*\d{3}[\s\-\)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/);
  const emailMatch = txt.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const tgMatch = txt.match(/@([a-zA-Z0-9_]{4,32})/);
  const wantsContact = /свяж|позвон|перезвон|напиш.*мн|call.*me|contact.*me|связат/i.test(txt);
  if (!phoneMatch && !emailMatch && !tgMatch && !wantsContact) return null;
  let name: string | null = null;
  for (const p of [/меня зовут\s+([^\s,.\n]+)/i, /я\s+[-—]\s*([^\s,.\n]+)/i, /имя\s*[:—-]\s*([^\s,.\n]+)/i]) {
    const m = txt.match(p);
    if (m?.[1]) { name = m[1]; break; }
  }
  return { name, phone: phoneMatch?.[0] || null, email: emailMatch?.[0] || null, telegram: tgMatch?.[0] || null, message: txt.slice(0, 1000) };
}

async function notifyOwner(eventType: string, data: Record<string, unknown>) {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !key) { console.warn("[notify] skipped: no SUPABASE_URL/key"); return; }
    const res = await fetch(`${url}/functions/v1/notify-owner`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType, data }),
    });
    if (!res.ok) { const t = await res.text(); console.warn("[notify]", res.status, t); }
  } catch (e) { console.warn("[notify] error:", e); }
}

async function resolveSystemPrompt(supabase: ReturnType<typeof createClient>, siteId: string, msgs: ChatMessage[], override?: string): Promise<string> {
  if (override?.trim()) return override.trim();
  let base = DEFAULT_SYSTEM_PROMPT;
  try {
    // Read from settings table (same place the web editor saves to)
    const { data } = await supabase.from("settings").select("system_prompt, product_prompts").limit(1).single();
    if (data) {
      if (siteId === "denismateev" || siteId === "general") {
        // General prompt
        if (data.system_prompt?.trim()) base = data.system_prompt.trim();
      } else {
        // Product-specific prompt (foundry, aisovetnik, aitransformation)
        const pp = data.product_prompts as Record<string, string> | null;
        if (pp?.[siteId]?.trim()) {
          base = pp[siteId].trim();
        } else if (data.system_prompt?.trim()) {
          // Fallback to general prompt if no product-specific one
          base = data.system_prompt.trim();
        }
      }
    }
  } catch (e) { console.warn("Prompt fallback:", e); }
  const userMsgs = msgs.filter((m) => m.role === "user");
  if (userMsgs.length <= 1 && !detectContactInfo(msgs)) base += QUIZ_TRIGGER;
  if (shouldBoostLead(msgs)) base += LEAD_BOOSTER;
  return base;
}

async function saveConversation(supabase: ReturnType<typeof createClient>, visitorId: string, siteId: string, msgs: Array<{ role: string; content: string }>) {
  try {
    const { data: rows } = await supabase.from("conversations").select("id,messages").eq("visitor_id", visitorId).eq("site_id", siteId).order("updated_at", { ascending: false }).limit(1);
    if (rows?.[0]?.id) {
      await supabase.from("conversations").update({ messages: msgs, updated_at: new Date().toISOString() }).eq("id", rows[0].id);
      console.log("Conversation updated:", visitorId.slice(0, 8));
    } else {
      await supabase.from("conversations").insert({ messages: msgs, site_id: siteId, visitor_id: visitorId });
      console.log("Conversation created:", visitorId.slice(0, 8));
    }
  } catch (e) { console.warn("Conversation save error:", e); }
}

// ═══ MAIN ═══

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const messages = sanitizeMessages(body?.messages);

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══ AI PROVIDER: use OPENAI_API_KEY (your Supabase secret) ═══
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══ SUPABASE: use env vars (auto-provided) ═══
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: "SUPABASE_URL or key not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const pageContext: PageContext | undefined = typeof body?.pageContext === "object" ? body.pageContext : undefined;
    const visitorId = String(body?.sessionId || body?.visitorId || crypto.randomUUID());
    const siteId = getSiteId(pageContext, typeof body?.site_id === "string" ? body.site_id : undefined);

    // ═══ NOTIFY on first message ═══
    const userMessages = messages.filter((m) => m.role === "user");
    if (userMessages.length === 1) {
      await notifyOwner("new_conversation", {
        site_id: siteId,
        visitor_id: visitorId.slice(0, 8),
        first_message: userMessages[0].content.slice(0, 200),
      });
    }

    // ═══ LEAD DETECTION ═══
    const lead = detectContactInfo(messages);
    if (lead) {
      try {
        const { data: existing } = await supabase.from("leads").select("id").eq("message", lead.message).limit(1);
        if (!existing || existing.length === 0) {
          const summary = [lead.phone ? `📞 ${lead.phone}` : null, lead.email ? `📧 ${lead.email}` : null, lead.telegram ? `💬 ${lead.telegram}` : null].filter(Boolean).join(" | ");
          const { error: err } = await supabase.from("leads").insert({
            name: lead.name, message: lead.message,
            lead_summary: summary || "Запрос на связь из чата",
            topic_guess: siteId === "foundry" ? "AI-продукт" : "Консалтинг/автоматизация",
            status: "pending_approval",
          });
          if (!err) await notifyOwner("new_lead", { company_name: "—", name: lead.name || "—", role: "—", topic_guess: siteId === "foundry" ? "AI-продукт" : "Консалтинг", lead_summary: summary });
        }
      } catch (e) { console.warn("Lead save error:", e); }
    }

    // ═══ SYSTEM PROMPT ═══
    const systemPrompt = await resolveSystemPrompt(supabase, siteId, messages, typeof body?.system_prompt_override === "string" ? body.system_prompt_override : undefined);

    // ═══ CALL OPENAI DIRECTLY ═══
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true,
      }),
    });

    if (!aiResponse.ok || !aiResponse.body) {
      const t = await aiResponse.text().catch(() => "");
      console.error("OpenAI error:", aiResponse.status, t);
      return new Response(JSON.stringify({ error: t || `OpenAI error ${aiResponse.status}` }), {
        status: aiResponse.status >= 400 ? aiResponse.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ STREAM + SAVE ═══
    let aiText = "";
    const decoder = new TextDecoder();
    let sseBuffer = "";

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        ctrl.enqueue(chunk);
        sseBuffer += decoder.decode(chunk, { stream: true });
        let idx: number;
        while ((idx = sseBuffer.indexOf("\n")) !== -1) {
          let line = sseBuffer.slice(0, idx);
          sseBuffer = sseBuffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const j = line.slice(6).trim();
          if (!j || j === "[DONE]") continue;
          try { const p = JSON.parse(j); const c = p?.choices?.[0]?.delta?.content; if (typeof c === "string") aiText += c; } catch { sseBuffer = line + "\n" + sseBuffer; break; }
        }
      },
      async flush() {
        try {
          sseBuffer += decoder.decode();
          for (let line of sseBuffer.split("\n")) {
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const j = line.slice(6).trim();
            if (!j || j === "[DONE]") continue;
            try { const p = JSON.parse(j); const c = p?.choices?.[0]?.delta?.content; if (typeof c === "string") aiText += c; } catch {}
          }
          if (aiText.trim()) {
            await saveConversation(supabase, visitorId, siteId, [...messages, { role: "assistant", content: aiText.trim() }]);
          }
        } catch (e) { console.warn("flush error:", e); }
      },
    });

    return new Response(aiResponse.body.pipeThrough(transform), {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
