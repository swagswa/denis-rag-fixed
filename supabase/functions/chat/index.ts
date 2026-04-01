import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function notifyOwner(eventType: string, data: any) {
  try {
    const url = "https://kuodvlyepoojqimutmvu.supabase.co";
    const key = "sb_publishable_n-B1HcuRd0kDc0spwr-oHg_KI-i0itS";
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

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type PageContext = {
  url?: string;
  title?: string;
  section?: string;
};

const DEFAULT_SYSTEM_PROMPT = `Ты — AI-ассистент Дениса Матеева.
Отвечай по-русски, кратко, по делу, без воды.

═══ ВАЖНО: КОНТАКТНЫЕ ДАННЫЕ ═══
Если пользователь оставляет контакт (телефон, email, @telegram, WhatsApp, имя) или просит связаться — 
НЕ ЗАДАВАЙ ЛИШНИХ ВОПРОСОВ! Ответь ДОСЛОВНО следующий текст (копируй символ в символ, ничего не меняй):
"Спасибо! Денис свяжется с вами в ближайшее время. Если срочно — напишите ему в Telegram [@deyuma](https://t.me/deyuma)."
КОПИРУЙ ТОЧНО! Не сокращай слова, не меняй ник. Ник: @deyuma. Ссылка: https://t.me/deyuma.
И ВСЁ. Не спрашивай "а что именно вас интересует" — человек уже готов общаться.`;

// Quiz trigger — for first message or vague questions
const QUIZ_TRIGGER = `

═══ КВИЗ-РЕЖИМ (для первого сообщения или размытых вопросов) ═══
Если пользователь задаёт размытый вопрос ("Чем вы занимаетесь?", "Как AI может помочь?", "Что вы предлагаете?") или это его ПЕРВОЕ сообщение:

Вместо длинного ответа — ЗАПУСТИ МИНИ-КВИЗ (3 вопроса):

"Давай разберёмся, чем конкретно могу помочь! Ответь на 3 быстрых вопроса:

**1. Чем занимается ваша компания?**
а) E-commerce / маркетплейс
б) B2B-услуги / консалтинг
в) IT / разработка
г) Производство / логистика
д) Другое — напишите

**2. Сколько человек в команде?**
а) 1-10
б) 10-50
в) 50-200
г) 200+

**3. Что больше всего болит?**
а) Рутинные задачи отнимают время
б) Клиенты уходят / мало лидов
в) Нет аналитики — решения наугад
г) Хочу запустить новый AI-продукт"

После ответов — дай ПЕРСОНАЛИЗИРОВАННУЮ рекомендацию и предложи созвониться: "Напиши мне @deyuma — покажу на примере, как это работает для вашей ниши."
`;

// Lead conversion booster — appended after 3+ user messages if @deyuma hasn't been mentioned yet
const LEAD_BOOSTER = `

═══ СРОЧНО: ВОВЛЕЧЕНИЕ ═══
В этом диалоге уже 3+ обмена, но ты ещё НЕ предложил связаться.
СЕЙЧАС мягко, но конкретно предложи продолжить разговор лично:
«Слушай, это интересная задача. Давай обсудим лично — напиши мне в Телеграм @deyuma, созвонимся на 15 минут.»
Не навязывай, но ОБЯЗАТЕЛЬНО дай контакт @deyuma в этом ответе.`;

function detectProductContext(pageContext?: PageContext): "general" | "foundry" | "aisovetnik" | "aitransformation" {
  const joined = `${pageContext?.url || ""} ${pageContext?.title || ""} ${pageContext?.section || ""}`.toLowerCase();
  if (joined.includes("foundry") || joined.includes("agent-fo")) return "foundry";
  if (joined.includes("ai-advisor") || joined.includes("aisovetnik") || joined.includes("советник")) return "aisovetnik";
  if (joined.includes("ai-transformation") || joined.includes("aitransformation") || joined.includes("трансформац")) return "aitransformation";
  return "general";
}

function sanitizeMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => typeof m === "object" && m !== null)
    .map((m: any) => ({ role: m.role, content: String(m.content || "") }))
    .filter((m) => (m.role === "user" || m.role === "assistant" || m.role === "system") && m.content.trim().length > 0);
}

function shouldBoostLead(messages: ChatMessage[]): boolean {
  const userCount = messages.filter(m => m.role === "user").length;
  if (userCount < 3) return false;
  const alreadyGaveContact = messages.some(
    m => m.role === "assistant" && m.content.includes("@deyuma")
  );
  return !alreadyGaveContact;
}

// ═══ LEAD DETECTION ═══
type DetectedLead = {
  name: string | null;
  phone: string | null;
  email: string | null;
  telegram: string | null;
  message: string;
};

function detectContactInfo(messages: ChatMessage[]): DetectedLead | null {
  const allUserText = messages
    .filter(m => m.role === "user")
    .map(m => m.content)
    .join("\n");

  // Phone patterns: +7, 8, various formats
  const phoneMatch = allUserText.match(/(?:\+7|8)[\s\-\(]*\d{3}[\s\-\)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/);
  // Email
  const emailMatch = allUserText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  // Telegram @username
  const tgMatch = allUserText.match(/@([a-zA-Z0-9_]{4,32})/);
  // "Свяжитесь", "позвоните", "перезвоните", "напишите мне"
  const wantsContact = /свяж|позвон|перезвон|напиш.*мн|call.*me|contact.*me|связат/i.test(allUserText);

  const hasContact = phoneMatch || emailMatch || tgMatch;

  if (!hasContact && !wantsContact) return null;

  // Try to extract name from messages
  const namePatterns = [
    /меня зовут\s+(\S+)/i,
    /я\s+[-—]\s*(\S+)/i,
    /имя\s*[:—-]\s*(\S+)/i,
    /^(\S+)\s*[,.]?\s*(?:свяж|позвон|перезвон|напиш)/im,
  ];
  let name: string | null = null;
  for (const p of namePatterns) {
    const m = allUserText.match(p);
    if (m) { name = m[1]; break; }
  }

  return {
    name,
    phone: phoneMatch ? phoneMatch[0] : null,
    email: emailMatch ? emailMatch[0] : null,
    telegram: tgMatch ? tgMatch[0] : null,
    message: allUserText.slice(0, 500),
  };
}

async function resolveSystemPrompt({
  supabase,
  pageContext,
  override,
  messages,
}: {
  supabase: ReturnType<typeof createClient> | null;
  pageContext?: PageContext;
  override?: string;
  messages: ChatMessage[];
}): Promise<string> {
  if (override?.trim()) return override.trim();

  let basePrompt = DEFAULT_SYSTEM_PROMPT;

  if (supabase) {
    try {
      const productKey = detectProductContext(pageContext);

      // Try assistant_prompts table first (site_id based)
      const siteId = productKey === "general" ? "denismateev" : productKey;
      const { data: promptData } = await supabase
        .from("assistant_prompts")
        .select("system_prompt")
        .eq("site_id", siteId)
        .eq("active", true)
        .limit(1)
        .single();

      if (promptData?.system_prompt?.trim()) {
        basePrompt = promptData.system_prompt.trim();
      }
    } catch (e) {
      console.warn("Prompt fallback to default:", e);
    }
  }

  // Quiz for early/vague conversations
  const userMessages = messages.filter(m => m.role === "user");
  if (userMessages.length <= 1) {
    // But NOT if user already gave contact info
    const lead = detectContactInfo(messages);
    if (!lead) {
      basePrompt += QUIZ_TRIGGER;
    }
  }

  // Auto-boost lead generation after 3+ exchanges without @deyuma
  if (shouldBoostLead(messages)) {
    basePrompt += LEAD_BOOSTER;
  }

  return basePrompt;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const messages = sanitizeMessages(body?.messages);

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Connect to ORIGINAL Supabase (NOT Lovable Cloud) for DB operations
    const ORIGINAL_SUPABASE_URL = "https://kuodvlyepoojqimutmvu.supabase.co";
    const ORIGINAL_ANON_KEY = "sb_publishable_n-B1HcuRd0kDc0spwr-oHg_KI-i0itS";

    const supabase = createClient(ORIGINAL_SUPABASE_URL, ORIGINAL_ANON_KEY);

    const systemPrompt = await resolveSystemPrompt({
      supabase,
      pageContext: body?.pageContext,
      override: typeof body?.system_prompt_override === "string" ? body.system_prompt_override : undefined,
      messages,
    });

    // ═══ SAVE CONVERSATION ═══
    const sessionId = body?.sessionId || crypto.randomUUID();
    const pageUrl = body?.pageContext?.url || null;
    const lastUserMessage = [...messages].reverse().find(m => m.role === "user")?.content || "";

    // ═══ NOTIFY: New conversation started (first message only) ═══
    const userMessages = messages.filter(m => m.role === "user");
    if (userMessages.length === 1) {
      await notifyOwner("new_conversation", {
        site_id: pageUrl || "unknown",
        visitor_id: sessionId?.slice(0, 8),
        first_message: userMessages[0].content?.slice(0, 200),
      });
    }

    // ═══ LEAD DETECTION & SAVE ═══
    if (supabase) {
      const lead = detectContactInfo(messages);
      if (lead) {
        try {
          const contactKey = lead.phone || lead.email || lead.telegram || sessionId;
          const { data: existingLead } = await supabase
            .from("leads")
            .select("id")
            .or(`message.ilike.%${contactKey}%`)
            .limit(1);

          if (!existingLead || existingLead.length === 0) {
            const leadSummary = [
              lead.phone ? `📞 ${lead.phone}` : null,
              lead.email ? `📧 ${lead.email}` : null,
              lead.telegram ? `💬 ${lead.telegram}` : null,
            ].filter(Boolean).join(" | ");

            const siteId = pageUrl?.includes("foundry") ? "foundry" : "denismateev";
            const { error: leadErr } = await supabase.from("leads").insert({
              name: lead.name,
              message: lead.message,
              lead_summary: leadSummary || "Запрос на связь из чата",
              topic_guess: siteId === "foundry" ? "AI-продукт" : "Консалтинг/автоматизация",
              status: "new",
            });

            if (leadErr) {
              console.warn("Lead insert error:", leadErr.message);
            } else {
              console.log("Lead captured:", leadSummary);
              await notifyOwner("new_lead", {
                name: lead.name, company_name: lead.company || "",
                role: "", topic_guess: siteId === "foundry" ? "AI-продукт" : "Консалтинг",
                lead_summary: leadSummary,
              });
            }
          }
        } catch (e) {
          console.warn("Lead save error (non-fatal):", e);
        }
      }
    }

    const chosenModel = "openai/gpt-5.2";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: chosenModel,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Слишком много запросов, попробуйте позже" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Закончились кредиты AI" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const text = await response.text();
      console.error("chat gateway error:", response.status, text);
      return new Response(JSON.stringify({ error: "Ошибка AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stream response to client while collecting full AI text for DB save
    let aiTextCollector = "";
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        // Pass chunk through to client
        controller.enqueue(chunk);

        // Also collect text for saving
        const text = decoder.decode(chunk, { stream: true });
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ") && !line.includes("[DONE]")) {
            try {
              const json = JSON.parse(line.slice(6));
              const content = json?.choices?.[0]?.delta?.content;
              if (content) aiTextCollector += content;
            } catch { /* skip */ }
          }
        }
      },
      async flush() {
        // Save conversation to DB after stream completes
        if (supabase && lastUserMessage && aiTextCollector) {
          try {
            const { error: convErr } = await supabase.from("conversations").insert({
              user_message: lastUserMessage,
              ai_message: aiTextCollector,
              page: pageUrl,
              session_id: sessionId,
            });
            if (convErr) {
              console.warn("Conversation insert error:", convErr.message);
            } else {
              console.log("Conversation saved, session:", sessionId.slice(0, 8));
            }
          } catch (e) {
            console.warn("Conversation save error (non-fatal):", e);
          }
        }
      },
    });

    return new Response(response.body!.pipeThrough(transformStream), {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
