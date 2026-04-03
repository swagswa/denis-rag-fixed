import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Ты — эксперт по редактированию системных промтов для AI-ассистентов. Общаешься с пользователем в режиме диалога.

КОНТЕКСТ: Пользователь дал тебе текущий промт ассистента. Помоги его улучшить.

ФОРМАТ ОТВЕТА — ВСЕГДА ДВЕ ЧАСТИ:

ЧАСТЬ 1 — Объяснение (обычный текст):
- Кратко опиши ЧТО и ПОЧЕМУ меняешь
- Покажи конкретные изменения в формате:
  **Было:** "старый текст"
  **Стало:** "новый текст"
- Если изменений несколько — пронумеруй

ЧАСТЬ 2 — Полный обновлённый промт в теге:
<PROMPT_RESULT>полный текст обновлённого промта целиком</PROMPT_RESULT>

ПРАВИЛА:
- КАЖДЫЙ ответ где ты предлагаешь изменения ОБЯЗАТЕЛЬНО содержит тег <PROMPT_RESULT> с ПОЛНЫМ промтом
- Внутри тега — весь промт целиком (не фрагмент, не diff)
- Без маркдаун-обёрток внутри тега
- Если пользователь просто спрашивает или обсуждает без запроса на изменение — отвечай без тега
- Если пользователь говорит "нет", "иначе", "не так" — предложи другой вариант (снова с тегом)
- Отвечай по-русски, кратко и по делу`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { currentPrompt, messages } = body;

    let chatMessages: Array<{ role: string; content: string }>;

    if (messages && Array.isArray(messages)) {
      chatMessages = [
        { role: "system", content: SYSTEM_PROMPT + "\n\nТЕКУЩИЙ ПРОМТ АССИСТЕНТА:\n---\n" + currentPrompt + "\n---" },
        ...messages,
      ];
    } else if (body.instruction) {
      chatMessages = [
        { role: "system", content: SYSTEM_PROMPT + "\n\nТЕКУЩИЙ ПРОМТ АССИСТЕНТА:\n---\n" + currentPrompt + "\n---" },
        { role: "user", content: body.instruction },
      ];
    } else {
      return new Response(JSON.stringify({ error: "messages or instruction required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: chatMessages,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Слишком много запросов, попробуйте позже" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("OpenAI error:", response.status, t);
      return new Response(JSON.stringify({ error: "Ошибка AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "";

    const promptMatch = reply.match(/<PROMPT_RESULT>([\s\S]*?)<\/PROMPT_RESULT>/);
    const extractedPrompt = promptMatch ? promptMatch[1].trim() : null;

    return new Response(JSON.stringify({
      reply,
      prompt: extractedPrompt,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("prompt-refine error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
