import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Ты — эксперт по редактированию системных промтов для AI-ассистентов.

КОНТЕКСТ: Пользователь дал тебе текущий промт. Помоги его улучшить через диалог.

ФОРМАТ ОТВЕТА КОГДА ПРЕДЛАГАЕШЬ ИЗМЕНЕНИЯ:

1. Краткое объяснение что и зачем меняешь (1-2 предложения)

2. Каждое изменение оформляй СТРОГО в таком формате (каждое на отдельных строках):
<DIFF_OLD>старый текст который убираем или меняем</DIFF_OLD>
<DIFF_NEW>новый текст на замену</DIFF_NEW>

3. В конце — полный обновлённый промт:
<PROMPT_RESULT>полный текст обновлённого промта целиком</PROMPT_RESULT>

ПРИМЕР ОТВЕТА:
Упрощаю формулировки для ясности:

<DIFF_OLD>КРИТИЧЕСКИ ВАЖНО: всегда предлагай связаться</DIFF_OLD>
<DIFF_NEW>Всегда мягко предлагай связаться</DIFF_NEW>

<DIFF_OLD>Говоришь на "ты" с первого сообщения</DIFF_OLD>
<DIFF_NEW>Обращайся на "ты" с первого сообщения</DIFF_NEW>

<PROMPT_RESULT>полный промт тут...</PROMPT_RESULT>

ПРАВИЛА:
- КАЖДЫЙ ответ с изменениями содержит пары DIFF_OLD/DIFF_NEW и PROMPT_RESULT
- Внутри тегов — чистый текст без маркдауна
- Если пользователь просто спрашивает без запроса на изменение — отвечай без тегов
- Если говорит "нет", "иначе" — предложи другой вариант (снова с тегами)
- Отвечай по-русски, кратко`;

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

    // Extract full prompt
    const promptMatch = reply.match(/<PROMPT_RESULT>([\s\S]*?)<\/PROMPT_RESULT>/);
    const extractedPrompt = promptMatch ? promptMatch[1].trim() : null;

    // Extract diffs
    const diffs: Array<{ old: string; new: string }> = [];
    const diffRegex = /<DIFF_OLD>([\s\S]*?)<\/DIFF_OLD>\s*<DIFF_NEW>([\s\S]*?)<\/DIFF_NEW>/g;
    let match;
    while ((match = diffRegex.exec(reply)) !== null) {
      diffs.push({ old: match[1].trim(), new: match[2].trim() });
    }

    return new Response(JSON.stringify({
      reply,
      prompt: extractedPrompt,
      diffs,
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
