import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Signal = {
  id: string;
  company_name: string | null;
  description: string;
  signal_type: string;
  industry: string | null;
  source: string | null;
  potential: "consulting" | "foundry" | "innovation_pilot" | null;
  notes: string | null;
};

function normalizeOpportunityType(value: unknown, fallback: Signal["potential"]) {
  if (value === "consulting" || value === "foundry" || value === "innovation_pilot") return value;
  if (fallback === "foundry" || fallback === "innovation_pilot") return fallback;
  return "consulting";
}

function compactText(value: unknown, max = 900) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    let triggeredBy = "cron";
    try {
      const reqBody = await req.clone().json();
      triggeredBy = reqBody?.triggered_by || "cron";
    } catch { /* no body */ }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ═══ PHASE 0: Self-regulation — delete returned insights, reset their signals ═══
    const { data: returnedInsights } = await supabase
      .from("insights")
      .select("id, signal_id, notes")
      .eq("status", "returned")
      .limit(10);

    let recycled = 0;
    if (returnedInsights && returnedInsights.length > 0) {
      for (const ri of returnedInsights) {
        if (ri.signal_id) {
          await supabase
            .from("signals")
            .update({
              status: "new",
              notes: `[Повторный анализ] ${compactText(ri.notes, 300)}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", ri.signal_id);
        }
        await supabase.from("insights").delete().eq("id", ri.id);
        recycled++;
      }
    }

    // ═══ PHASE 0.5: Load feedback from downstream agents ═══
    const { data: recentFeedback } = await supabase
      .from("agent_feedback")
      .select("factory, feedback_type, content")
      .eq("to_agent", "analyst")
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(10);

    const feedbackContext = (recentFeedback || [])
      .map((f: any) => `[${f.factory}/${f.feedback_type}]: ${f.content}`)
      .join("\n");

    // Load KPI targets
    const { data: kpiGoals } = await supabase
      .from("agent_kpi")
      .select("factory, metric, target, current")
      .eq("active", true);

    const kpiContext = (kpiGoals || [])
      .map((k: any) => `[${k.factory}] ${k.metric}: ${k.current}/${k.target}`)
      .join("\n");

    // ═══ PHASE 1: Process NEW signals (including recycled ones) ═══
    const { data: signals, error: signalsError } = await supabase
      .from("signals")
      .select("id, company_name, description, signal_type, industry, source, potential, notes")
      .eq("status", "new")
      .order("created_at", { ascending: false })
      .limit(20);

    if (signalsError) throw signalsError;

    if (!signals || signals.length === 0) {
      return new Response(JSON.stringify({ success: true, recycled, message: "No new signals to analyze" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const signalIds = signals.map((s) => s.id);
    const { data: existingInsights } = await supabase
      .from("insights")
      .select("signal_id")
      .in("signal_id", signalIds);

    const alreadyProcessed = new Set((existingInsights || []).map((x: any) => x.signal_id).filter(Boolean));
    const queue = (signals as Signal[]).filter((s) => !alreadyProcessed.has(s.id));

    if (queue.length === 0) {
      return new Response(JSON.stringify({ success: true, recycled, message: "All signals already analyzed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brief = queue
      .map((s, i) => {
        const feedback = s.notes?.startsWith("[Повторный анализ]")
          ? `\n⚠️ ОБРАТНАЯ СВЯЗЬ ОТ ПРЕДЫДУЩЕЙ ПОПЫТКИ: ${s.notes}\nУчти эту обратную связь и исправь проблему!`
          : "";
        return `#${i + 1}\ncompany: ${s.company_name || "(не указана)"}\ntype: ${s.signal_type}\nindustry: ${s.industry || "(не указана)"}\nsource: ${s.source || "(нет)"}\npotential: ${s.potential || "consulting"}\ndescription: ${s.description}${feedback}`;
      })
      .join("\n\n");

    const prompt = `Ты — senior бизнес-аналитик и стратег. Рынок: Россия и СНГ. На входе рыночные сигналы.

ТВОЯ РОЛЬ — АНАЛИТИК, НЕ МАРКЕТОЛОГ:
Ты создаёшь ИНСАЙТЫ и ТЕМЫ — ценные наблюдения о рыночных трендах, болях и возможностях.
Ты НЕ ищешь конкретные компании и НЕ составляешь outreach. Это задача Маркетолога на следующем этапе.

КРИТИЧЕСКИ ВАЖНО:
- Каждый инсайт = ТЕМА + БОЛЬ + РЕШЕНИЕ + ПОЧЕМУ СЕЙЧАС
- Ты МЭТЧИШЬ тренды (российские, СНГшные или мировые) с РОССИЙСКОЙ РЕАЛЬНОСТЬЮ
- Если сигнал про мировой тренд — объясни, ПОЧЕМУ это актуально для РФ/СНГ прямо сейчас
- Если сигнал содержит название конкретной компании — сохрани его, но это НЕ обязательный элемент
- НЕ выдумывай компании! Если в сигнале нет конкретной компании — создай инсайт о РЫНОЧНОЙ ВОЗМОЖНОСТИ

═══ РЕЖИМ "consulting" (potential = "consulting") ═══
Цель: создать ИНСАЙТ — тему/боль/возможность, на которую Маркетолог сможет найти конкретные компании.

ЧТО ТЫ ДЕЛАЕШЬ:
1. Анализируешь сигнал и определяешь РЫНОЧНЫЙ ТРЕНД или БОЛЬ
2. Мэтчишь с российской реальностью: где этот тренд/боль проявляется?
3. Определяешь ПРОФИЛЬ целевой компании (отрасль, размер, признаки боли)
4. Формулируешь ЧТО ПРЕДЛОЖИТЬ и ПОЧЕМУ СЕЙЧАС
5. Даёшь Маркетологу чёткие КРИТЕРИИ ПОИСКА компаний

ТРИГГЕРЫ (полный список):
🔹 Вакансия (ищут AI/автоматизацию/цифровизацию — значит боль есть, решения нет)
🔹 Тендер/закупка (прямой запрос на подрядчика)
🔹 Новость отрасли (запуск нового направления, расширение, слияние, смена руководства)
🔹 Жалобы клиентов (негативные отзывы, проблемы с сервисом — публичные)
🔹 Изменение законодательства (новый НДС, маркировка, Честный знак, ФЗ)
🔹 Ограничения/блокировки (VPN, замедление сервисов → нужна миграция/альтернатива)
🔹 Банкротство/кризис крупного игрока (→ волна проблем у партнёров и клиентов)
🔹 Рост поискового спроса (Вордстат: всплеск запросов в нише)
🔹 Сезонность (приближается пиковый сезон)
🔹 Публикация на vc.ru/habr (компания описывает проблемы или ищет решение)
🔹 Рост штата без автоматизации
🔹 Уход с рынка зарубежного вендора (→ импортозамещение)

ОЦЕНКА КАЧЕСТВА ИНСАЙТА:
📊 TIMING — насколько узкое окно возможности
📊 МАСШТАБ БОЛИ — сколько компаний в РФ/СНГ затронуты
📊 COMPLEXITY MATCH — наш стек (AI, автоматизация, боты, SaaS, веб) подходит?
📊 СРЕДНИЙ ЧЕК — реалистичная оценка в ₽

ФОРМАТ ИНСАЙТА:
{
  "source_index": 1,
  "opportunity_type": "consulting",
  "title": "[Тренд/Боль]: [Суть] → [Решение]",
  "company_name": "Название компании из сигнала (или null если нет конкретной)",
  "what_happens": "Что происходит на рынке — КОНКРЕТНЫЙ ТРЕНД или СОБЫТИЕ с фактами",
  "why_important": "Почему это СЕЙЧАС актуально для РФ/СНГ. Масштаб: сколько компаний затронуто",
  "problem": "Конкретная боль/потребность. Профиль ЦА: отрасль, размер, признаки",
  "action_proposal": "ЧТО предложить (конкретный инструмент/сервис). КОМУ искать (профиль компании, должность ЛПР, где искать — hh.ru/vc.ru/LinkedIn/TG). ПОЧЕМУ СЕЙЧАС. Ориентировочный чек в ₽."
}

КРИТЕРИИ КАЧЕСТВА (все обязательны):
✅ Есть конкретный тренд/событие/боль (НЕ абстракция)
✅ Мэтч с российской реальностью (ПОЧЕМУ это актуально для РФ/СНГ)
✅ Понятный профиль ЦА (кому это нужно)
✅ Понятное решение (что предложить)
✅ Понятно ПОЧЕМУ СЕЙЧАС (триггер, окно)
✅ Complexity match — задача решаема нашим стеком

❌ ПРОПУСКАЙ: абстрактные обзоры без конкретики, чистые конференции/рейтинги, hardware/biotech, сигналы без связи с РФ/СНГ

═══ РЕЖИМ "foundry" / "innovation_pilot" ═══
Цель: найти БИЗНЕС-ИДЕЮ для цифрового продукта для рынка РФ/СНГ.

КЛЮЧЕВОЙ ПРИНЦИП: Мэтчинг МИРОВЫХ трендов с РОССИЙСКОЙ реальностью.
- Если сигнал о мировом стартапе → ОЦЕНИ: есть ли аналог в РФ? Есть ли РЕАЛЬНЫЙ СПРОС?
- ОБЯЗАТЕЛЬНО приведи ДОКАЗАТЕЛЬСТВА спроса в РФ: Вордстат, запросы на Авито, обсуждения в TG-каналах, посты на vc.ru, жалобы пользователей
- Адаптация ProductHunt — ОК, но ТОЛЬКО с доказательством спроса в РФ!

НЕ ТОЛЬКО AI! Подходят: боты, SaaS, витрины, агрегаторы, калькуляторы, автоматизация.

ТРИГГЕРЫ СПРОСА (для foundry):
🔹 Успешный зарубежный стартап БЕЗ аналога в РФ + доказательства спроса
🔹 Всплеск поисковых запросов в нише (Вордстат)
🔹 Новый закон/регуляция — массовая потребность
🔹 Уход зарубежного сервиса — дыра на рынке
🔹 Сезонный всплеск — предсказуемый пик
🔹 Вирусный контент/тренд
🔹 Кризис/банкротство — массовая боль
🔹 Изменение потребительского поведения

ФОРМАТ ИНСАЙТА (foundry):
{
  "source_index": 1,
  "opportunity_type": "foundry",
  "title": "[Идея продукта]: [Боль ЦА] → [Решение]",
  "company_name": null,
  "what_happens": "Мировой тренд/стартап + ПОЧЕМУ это актуально для РФ. Доказательства спроса: [Вордстат/Авито/TG/vc.ru — конкретные цифры или ссылки]",
  "why_important": "Размер рынка РФ/СНГ. Есть ли аналоги? Почему сейчас окно?",
  "problem": "Конкретная боль ЦА в РФ. B2B или B2C. Кто платит",
  "action_proposal": "Что строим (MVP за 2 недели). Монетизация в ₽. Канал для первых клиентов. Revenue estimate."
}

ОБЯЗАТЕЛЬНО для foundry:
✅ Доказательства спроса в РФ (не просто "в мире работает → в РФ тоже")
✅ Оценка: есть ли уже аналог в РФ?
✅ Понятная ЦА и монетизация в ₽

Если нет связи с РФ/СНГ или нет доказательств спроса — ПРОПУСКАЙ.

═══ ОБЩИЕ ПРАВИЛА ═══
- Верни СТРОГО JSON-массив без markdown
- Каждый элемент = один инсайт
- source_index = номер сигнала из входных данных (начиная с 1)
- Если сигнал нерелевантен — просто НЕ включай его в ответ

${feedbackContext ? `\n═══ ОБРАТНАЯ СВЯЗЬ ОТ МАРКЕТОЛОГА/БИЛДЕРА (учти при анализе!):\n${feedbackContext}\nАдаптируй свои инсайты с учётом этой обратной связи!\n` : ""}
${kpiContext ? `\n═══ ТЕКУЩИЕ KPI (если отстаём — будь менее строгим фильтром):\n${kpiContext}\n` : ""}
СИГНАЛЫ:
\${brief}\`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      if (response.status === 429 || response.status === 402) {
        return new Response(JSON.stringify({ error: response.status === 429 ? "Rate limits exceeded" : "Payment required" }), {
          status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    let aiItems: any[] = [];
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      aiItems = JSON.parse(cleaned);
      if (!Array.isArray(aiItems)) aiItems = [];
    } catch {
      console.error("Failed to parse analyst JSON:", content);
      throw new Error("Failed to parse AI response");
    }

    const toInsert: any[] = [];
    const analyzedIds = new Set<string>();

    for (const item of aiItems) {
      const sourceIndex = Number(item?.source_index);
      if (!Number.isInteger(sourceIndex) || sourceIndex < 1 || sourceIndex > queue.length) continue;

      const signal = queue[sourceIndex - 1];
      if (!signal) continue;

      const opportunityType = normalizeOpportunityType(item?.opportunity_type, signal.potential);
      const title = compactText(item?.title, 160) || compactText(signal.company_name || signal.description, 120);
      const whatHappens = compactText(item?.what_happens, 1000) || compactText(signal.description, 900);
      const problem = compactText(item?.problem, 700);
      const actionProposal = compactText(item?.action_proposal, 700);

      if (!title || !whatHappens || !actionProposal) continue;

      // Foundry insights that pass ALL criteria go directly to "qualified" for Builder
      const insightStatus = (opportunityType === "foundry" || opportunityType === "innovation_pilot")
        ? "qualified"
        : "new";

      toInsert.push({
        signal_id: signal.id,
        title,
        company_name: compactText(item?.company_name, 120) || signal.company_name,
        what_happens: whatHappens,
        why_important: compactText(item?.why_important, 700) || null,
        problem: problem || null,
        action_proposal: actionProposal,
        opportunity_type: opportunityType,
        status: insightStatus,
      });

      analyzedIds.add(signal.id);
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from("insights").insert(toInsert);
      if (insertError) throw insertError;

      // ═══ Auto-save insights + signals to knowledge base ═══
      const kbDocs = toInsert.map((ins: any) => {
        const signal = queue.find((s) => s.id === ins.signal_id);
        const content = [
          `# ${ins.title}`,
          `Тип: ${ins.opportunity_type}`,
          ins.company_name ? `Компания: ${ins.company_name}` : null,
          `\n## Что происходит\n${ins.what_happens}`,
          ins.why_important ? `\n## Почему важно\n${ins.why_important}` : null,
          ins.problem ? `\n## Проблема/Боль\n${ins.problem}` : null,
          ins.action_proposal ? `\n## Предложение\n${ins.action_proposal}` : null,
          signal ? `\n## Источник сигнала\nТип: ${signal.signal_type}\nИндустрия: ${signal.industry || "н/д"}\nИсточник: ${signal.source || "н/д"}\nОписание: ${signal.description}` : null,
        ].filter(Boolean).join("\n");

        return {
          title: `[Insight] ${ins.title}`,
          content,
          source_type: "agent",
          source_name: "analyst-run",
          topic: ins.opportunity_type,
          metadata_json: {
            insight_signal_id: ins.signal_id,
            opportunity_type: ins.opportunity_type,
            company_name: ins.company_name,
            auto_saved: true,
          },
        };
      });

      const { error: kbError } = await supabase.from("documents").insert(kbDocs);
      if (kbError) console.error("KB save error (non-fatal):", kbError);
    }

    const skippedSignals = queue.filter((signal) => !analyzedIds.has(signal.id));

    if (analyzedIds.size > 0) {
      await supabase
        .from("signals")
        .update({ status: "analyzed", updated_at: new Date().toISOString() })
        .in("id", Array.from(analyzedIds));
    }

    if (skippedSignals.length > 0) {
      await supabase
        .from("signals")
        .update({
          status: "analyzed",
          notes: "Аналитик отклонил сигнал: недостаточно конкретики, нерелевантный рынок или нет связи с РФ/СНГ.",
          updated_at: new Date().toISOString(),
        })
        .in("id", skippedSignals.map((signal) => signal.id));
    }

    return new Response(JSON.stringify({
      success: true,
      recycled,
      signals_received: signals.length,
      signals_analyzed: analyzedIds.size,
      signals_skipped: skippedSignals.length,
      insights_created: toInsert.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyst-run error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
