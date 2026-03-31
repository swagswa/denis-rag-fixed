import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
Отвечай по-русски, кратко, по делу, без воды.`;

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

  // Check if @deyuma was already mentioned in any assistant message
  const alreadyGaveContact = messages.some(
    m => m.role === "assistant" && m.content.includes("@deyuma")
  );
  return !alreadyGaveContact;
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

  try {
    const { data } = await supabase
      .from("settings")
      .select("system_prompt, product_prompts")
      .limit(1)
      .single() as any;

    const productKey = detectProductContext(pageContext);
    const productPrompt = data?.product_prompts?.[productKey];

    if (typeof productPrompt === "string" && productPrompt.trim().length > 0) {
      basePrompt = productPrompt.trim();
    } else if (typeof data?.system_prompt === "string" && data.system_prompt.trim().length > 0) {
      basePrompt = data.system_prompt.trim();
    }
  } catch (e) {
    console.warn("Settings prompt fallback:", e);
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

    // Connect to the ORIGINAL Supabase project for settings/prompts
    const ORIGINAL_SUPABASE_URL = "https://kuodvlyepoojqimutmvu.supabase.co";
    const ORIGINAL_SERVICE_ROLE = Deno.env.get("ORIGINAL_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    let supabase: ReturnType<typeof createClient> | null = null;
    if (ORIGINAL_SERVICE_ROLE) {
      supabase = createClient(ORIGINAL_SUPABASE_URL, ORIGINAL_SERVICE_ROLE);
    }

    const systemPrompt = await resolveSystemPrompt({
      supabase,
      pageContext: body?.pageContext,
      override: typeof body?.system_prompt_override === "string" ? body.system_prompt_override : undefined,
      messages,
    });

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

    return new Response(response.body, {
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
