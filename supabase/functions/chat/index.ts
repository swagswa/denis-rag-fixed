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

async function resolveSystemPrompt({
  supabase,
  pageContext,
  override,
}: {
  supabase: ReturnType<typeof createClient>;
  pageContext?: PageContext;
  override?: string;
}): Promise<string> {
  if (override?.trim()) return override.trim();

  try {
    const { data } = await supabase
      .from("settings")
      .select("system_prompt, product_prompts")
      .limit(1)
      .single() as any;

    const productKey = detectProductContext(pageContext);
    const productPrompt = data?.product_prompts?.[productKey];

    if (typeof productPrompt === "string" && productPrompt.trim().length > 0) {
      return productPrompt.trim();
    }

    if (typeof data?.system_prompt === "string" && data.system_prompt.trim().length > 0) {
      return data.system_prompt.trim();
    }
  } catch (e) {
    console.warn("Settings prompt fallback:", e);
  }

  return DEFAULT_SYSTEM_PROMPT;
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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return new Response(JSON.stringify({ error: "Supabase env not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const systemPrompt = await resolveSystemPrompt({
      supabase,
      pageContext: body?.pageContext,
      override: typeof body?.system_prompt_override === "string" ? body.system_prompt_override : undefined,
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
