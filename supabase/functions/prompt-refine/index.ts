import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Ты — эксперт по редактированию системных промтов для AI-ассистентов. Ты общаешься с пользователем в режиме диалога.

КОНТЕКСТ: Пользователь дал тебе текущий промт ассистента. Твоя задача — помочь его улучшить через обсуждение.

КАК РАБОТАТЬ:
1. Когда пользователь просит что-то изменить — предложи конкретные изменения, объясни что и почему меняешь
2. Покажи ИЗМЕНЁННЫЕ ЧАСТИ промта (не весь целиком, если изменение небольшое)
3. Спроси "Применить эти изменения?" или предложи альтернативы
4. Если пользователь подтвердил (да, ок, применяй, давай) — верни ПОЛНЫЙ обновлённый промт целиком, обёрнутый в тег <PROMPT_RESULT>полный промт тут</PROMPT_RESULT>
5. Если пользователь просит ещё что-то поменять — продолжай обсуждение

ПРАВИЛА:
- Отвечай по-русски, кратко и по делу
- Тег <PROMPT_RESULT> используй ТОЛЬКО когда пользователь подтвердил изменения
- Внутри тега должен быть ПОЛНЫЙ промт (не diff, не фрагмент)
- Без маркдаун-обёрток (\`\`\`) внутри тега`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { currentPrompt, messages } = body;

    // Support both old format (instruction) and new format (messages)
    let chatMessages: Array<{ role: string; content: string }>;

    if (messages && Array.isArray(messages)) {
      chatMessages = [
        { role: "system", content: SYSTEM_PROMPT + `\n\nТЕКУЩИЙ ПРОМТ АССИСТЕНТА:\n---\n${currentPrompt}\n---` },
        ...messages,
      ];
    } else if (body.instruction) {
      // Backwards compat: single instruction → single exchange
      chatMessages = [
        { role: "system", content: SYSTEM_PROMPT + `\n\nТЕКУЩИЙ ПРОМТ АССИСТЕНТА:\n---\n${currentPrompt}\n---` },
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
        Authorization: `Bearer ${OPENAI_API_KEY}`,
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

    // Extract prompt if AI wrapped it in <PROMPT_RESULT> tag
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
