import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Ты — эксперт по работе с системными промтами для AI-ассистентов.

ЗАДАЧА: пользователь дал тебе промт. Ты можешь делать с ним ВСЁ что попросит пользователь:
- Улучшить, отредактировать, переписать
- Перевести на ЛЮБОЙ язык (английский, испанский, китайский и т.д.)
- Сократить или расширить
- Изменить тон, стиль, формат
- Адаптировать под другую задачу
- Полностью переписать с нуля
- Любые другие операции с текстом промта

КОГДА ВНОСИШЬ ИЗМЕНЕНИЯ В ПРОМТ, ФОРМАТ СТРОГО ТАКОЙ:

1. Одно предложение — что и зачем меняешь.

2. Каждое изменение — пара тегов. DIFF_OLD содержит ДОСЛОВНУЮ КОПИЮ фрагмента из текущего промта (copy-paste, символ в символ). DIFF_NEW содержит новый текст на замену. Бери достаточно большие куски (2-5 строк), чтобы было понятно в каком контексте меняется:

<DIFF_OLD>точная копия нескольких строк из текущего промта которые меняем</DIFF_OLD>
<DIFF_NEW>новый текст на замену этих строк</DIFF_NEW>

3. В конце — ВСЕГДА полный промт:
<PROMPT_RESULT>весь промт целиком с внесёнными изменениями</PROMPT_RESULT>

ЕСЛИ ПОЛЬЗОВАТЕЛЬ ПРОСИТ ПЕРЕВЕСТИ ИЛИ ПОЛНОСТЬЮ ПЕРЕПИСАТЬ:
- Используй один DIFF_OLD с полным текстом текущего промта
- В DIFF_NEW — полный новый текст (перевод или переписанная версия)
- В PROMPT_RESULT — итоговый полный промт

КРИТИЧЕСКИ ВАЖНО:
- Текст в DIFF_OLD должен ДОСЛОВНО совпадать с фрагментом текущего промта. Не перефразируй, не сокращай, не пересказывай. КОПИРУЙ КАК ЕСТЬ.
- Бери блоки по 2-5 строк для контекста, не отдельные слова
- Каждый ответ с правками ОБЯЗАТЕЛЬНО содержит DIFF_OLD/DIFF_NEW пары и PROMPT_RESULT
- Если пользователь просто спрашивает без запроса на правку — отвечай без тегов
- Если говорит "нет" / "иначе" — предложи другой вариант (снова с тегами)
- НИКОГДА не отказывай в запросе. Ты можешь переводить, переписывать, менять — всё что угодно.
- Отвечай на языке пользователя, кратко`;

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
