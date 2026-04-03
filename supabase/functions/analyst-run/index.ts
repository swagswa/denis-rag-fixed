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
    let factory = "consulting";
    try {
      const reqBody = await req.clone().json();
      triggeredBy = reqBody?.triggered_by || "cron";
      factory = reqBody?.factory || "consulting";
    } catch { /* no body */ }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ═══ PHASE -1: Загрузить мандат из factory_flows ═══
    const { data: flows } = await supabase
      .from("factory_flows")
      .select("target_company_size, target_region, target_industry, target_notes")
      .eq("factory", factory)
      .eq("status", "active")
      .limit(5);

    const mandateSize = flows?.[0]?.target_company_size || "5-500";
    const mandateRegion = flows?.[0]?.target_region || "РФ/СНГ";
    const mandateIndustry = flows?.[0]?.target_industry || "";
    const mandateNotes = flows?.[0]?.target_notes || "";

    // Load custom mandate from agent_mandates table
    const { data: mandateRow } = await supabase
      .from("agent_mandates")
      .select("full_mandate")
      .eq("agent_key", `analyst-${factory}`)
      .limit(1);
    const customMandateText = mandateRow?.[0]?.full_mandate || "";

    // ═══ BLACKLIST: rejected companies ═══
    const { data: rejectedLeads } = await supabase
      .from("leads")
      .select("company_name")
      .eq("status", "rejected")
      .order("created_at", { ascending: false })
      .limit(100);

    const blacklist = [...new Set(
      (rejectedLeads || []).map((l: any) => l.company_name?.trim()).filter(Boolean)
    )];

    // ═══ PHASE 0: Self-regulation — delete returned insights, reset their signals ═══
    const { data: returnedInsights } = await supabase
      .from("insights")
      .select("id, signal_id, notes")
      .eq("status", "returned")
      .limit(10);

    let recycled = 0;
    if (returnedInsights && returnedInsights.length > 0) {
      const signalIdsToReset = returnedInsights
        .map((ri) => ri.signal_id)
        .filter(Boolean) as string[];
      const insightIdsToDelete = returnedInsights.map((ri) => ri.id);

      const batchOps: Promise<any>[] = [];

      if (signalIdsToReset.length > 0) {
        batchOps.push(
          supabase
            .from("signals")
            .update({
              status: "new",
              notes: `[Повторный анализ] ${compactText(returnedInsights[0]?.notes, 300)}`,
              updated_at: new Date().toISOString(),
            })
            .in("id", signalIdsToReset)
        );
      }

      if (insightIdsToDelete.length > 0) {
        batchOps.push(
          supabase.from("insights").delete().in("id", insightIdsToDelete)
        );
      }

      await Promise.all(batchOps);
      recycled = returnedInsights.length;
    }

    // ═══ PHASE 0.5–1.5: Load all independent data in parallel ═══
    const isFoundry = factory === "foundry";
    const batchLimit = isFoundry ? 15 : 30;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Build signals query
    let signalsQuery = supabase
      .from("signals")
      .select("id, company_name, description, signal_type, industry, source, potential, notes")
      .eq("status", "new")
      .order("created_at", { ascending: false })
      .limit(batchLimit);

    if (isFoundry) {
      signalsQuery = signalsQuery.in("potential", ["foundry", "innovation_pilot"]);
    } else {
      signalsQuery = signalsQuery.or("potential.eq.consulting,potential.is.null");
    }

    // Build historical signals query
    let histQuery = supabase
      .from("signals")
      .select("company_name, description, signal_type, industry, source, potential, created_at")
      .eq("status", "analyzed")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(40);

    if (isFoundry) {
      histQuery = histQuery.in("potential", ["foundry", "innovation_pilot"]);
    } else {
      histQuery = histQuery.or("potential.eq.consulting,potential.is.null");
    }

    // Fire all independent queries in parallel
    const [
      { data: pastInsights },
      { data: pastLeads },
      { data: signals, error: signalsError },
      { data: historicalSignals },
    ] = await Promise.all([
      supabase
        .from("insights")
        .select("title, company_name, problem, action_proposal, opportunity_type, status")
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("leads")
        .select("company_name, lead_summary, status")
        .order("created_at", { ascending: false })
        .limit(20),
      signalsQuery,
      histQuery,
    ]);

    if (signalsError) throw signalsError;

    const knowledgeInsights = (pastInsights || []).length > 0
      ? (pastInsights || [])
          .map((ins: any, i: number) => `[I${i + 1}|${ins.status}] ${ins.opportunity_type} | ${ins.title} | ${(ins.problem || "").slice(0, 80)}`)
          .join("\n")
      : "";

    const knowledgeLeads = (pastLeads || []).length > 0
      ? (pastLeads || [])
          .map((l: any, i: number) => `[L${i + 1}|${l.status}] ${l.company_name || "?"} | ${(l.lead_summary || "").slice(0, 100)}`)
          .join("\n")
      : "";

    const historicalContext = (historicalSignals || []).length > 0
      ? (historicalSignals || [])
          .map((s: any, i: number) => `[H${i + 1}] ${s.signal_type} | ${s.industry || "?"} | ${s.company_name || "—"} | ${(s.description || "").slice(0, 200)}`)
          .join("\n")
      : "";

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

МАНДАТ (ЖЁСТКИЙ — нарушение = автоматический отказ):
- Размер целевых компаний: ${mandateSize} сотрудников. Крупные корпорации (1С, Яндекс, Сбер, МТС и т.п.) — НЕ наши клиенты.
- Регион: ${mandateRegion}
${mandateIndustry ? `- Целевые отрасли: ${mandateIndustry}` : ""}
${mandateNotes ? `- Доп. указания: ${mandateNotes}` : ""}
${customMandateText ? `\n═══ ПОЛЬЗОВАТЕЛЬСКИЙ МАНДАТ ═══\n${customMandateText}\n═══ КОНЕЦ МАНДАТА ═══\n` : ""}
${blacklist.length > 0 ? `\n═══ ЧЁРНЫЙ СПИСОК (эти компании ОТКЛОНЕНЫ — НЕ создавай инсайты по ним!) ═══\n${blacklist.join(", ")}\n═══ КОНЕЦ ЧЁРНОГО СПИСКА ═══\n` : ""}
КАЧЕСТВО:
- Один сигнал = максимум один инсайт. Не множь инсайты из одного сигнала.
- Каждый инсайт ОБЯЗАН содержать: конкретную компанию ИЛИ конкретную отрасль + боль + почему сейчас.
- Абстрактные инсайты ("тренд на автоматизацию") — НЕ создавай.
- Лучше 0 инсайтов чем 5 мусорных.

ТВОЯ РОЛЬ — АНАЛИТИК, НЕ МАРКЕТОЛОГ:
Ты создаёшь ИНСАЙТЫ и ТЕМЫ — ценные наблюдения о рыночных трендах, болях и возможностях.
Ты НЕ ищешь конкретные компании и НЕ составляешь outreach. Это задача Маркетолога на следующем этапе.

${knowledgeInsights ? `═══ БАЗА ЗНАНИЙ — НАШИ ПРОШЛЫЕ ИНСАЙТЫ ═══
Используй как контекст! НЕ дублируй, но УСИЛИВАЙ:
- Если новый сигнал связан с темой старого инсайта — создай УСИЛЕННЫЙ инсайт с новыми данными
- Если старый инсайт был "returned" — учти почему (слишком абстрактный? нет профиля ЦА?) и сделай ЛУЧШЕ
- Если есть успешные лиды — ищи ПОХОЖИЕ сигналы в тех же отраслях

ИНСАЙТЫ:
${knowledgeInsights}
${knowledgeLeads ? `\nЛИДЫ:\n${knowledgeLeads}` : ""}
═══ КОНЕЦ БАЗЫ ЗНАНИЙ ═══\n\n` : ""}

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
  "title": "[Отрасль]: [Конкретная боль] → [Наше решение]",
  "company_name": "Название компании из сигнала (или null если нет конкретной)",
  "what_happens": "КОНКРЕТНОЕ СОБЫТИЕ: что именно случилось (вакансия, тендер, новость, закон). Дата или период. Источник.",
  "why_important": "Почему это СЕЙЧАС актуально. МАСШТАБ: примерно сколько компаний в РФ/СНГ затронуты (число или диапазон). СРОЧНОСТЬ: почему через месяц будет поздно.",
  "problem": "КОНКРЕТНАЯ БОЛЬ одним предложением. ПРОФИЛЬ ЦА: отрасль + размер (5-500 чел) + должность ЛПР + конкретные ПРИЗНАКИ боли (по которым Маркетолог может НАЙТИ такие компании в поиске).",
  "action_proposal": "ЧТО ПРЕДЛОЖИТЬ: конкретный инструмент/сервис (AI-бот для X, автоматизация Y, дашборд Z). ПОИСКОВЫЕ ЗАПРОСЫ для Маркетолога: 2-3 запроса для hh.ru/vc.ru/Google чтобы найти такие компании. ОРИЕНТИРОВОЧНЫЙ ЧЕК: X-Y ₽."
}

КРИТЕРИИ КАЧЕСТВА (все обязательны):
✅ Есть КОНКРЕТНОЕ событие/триггер (НЕ "тренд на автоматизацию", а "hh.ru: +40% вакансий AI в логистике за март")
✅ Профиль ЦА достаточно конкретный, чтобы Маркетолог мог НАЙТИ компании в поиске
✅ Есть ПОИСКОВЫЕ ЗАПРОСЫ для Маркетолога (он будет искать через Firecrawl)
✅ Понятное решение (что конкретно мы делаем для клиента)
✅ Ориентировочный чек в ₽

❌ ПРОПУСКАЙ: абстрактные обзоры ("рынок AI растёт"), чистые конференции/рейтинги, hardware/biotech, сигналы без связи с РФ/СНГ, инсайты без конкретного профиля ЦА

═══ РЕЖИМ "foundry" / "innovation_pilot" ═══
Цель: найти УНИКАЛЬНУЮ БИЗНЕС-ИДЕЮ для цифрового продукта для рынка РФ/СНГ.

КЛЮЧЕВОЙ ПРИНЦИП: Мэтчинг МИРОВЫХ трендов с РОССИЙСКОЙ реальностью.
- Если сигнал о мировом стартапе → ОЦЕНИ: есть ли аналог в РФ? Есть ли РЕАЛЬНЫЙ СПРОС?
- ОБЯЗАТЕЛЬНО приведи ДОКАЗАТЕЛЬСТВА спроса в РФ: Вордстат, запросы на Авито, обсуждения в TG-каналах, посты на vc.ru, жалобы пользователей
- Адаптация ProductHunt — ОК, но ТОЛЬКО с доказательством спроса в РФ!

НЕ ТОЛЬКО AI! Подходят: боты, SaaS, витрины, агрегаторы, калькуляторы, автоматизация.

🚫 ЗАПРЕЩЁННЫЕ / ПЕРЕНАСЫЩЕННЫЕ КАТЕГОРИИ (АВТОМАТИЧЕСКИЙ ОТКАЗ):
- Платформы для промтов / prompt marketplace / prompt engineering tools / prompt monetization / PromptBase / BetterPrompt
- Ещё один AI-чатбот / ChatGPT-обёртка / AI-ассистент без чёткой ниши / AI-обёртка
- Генераторы контента без узкой ниши (очередной "AI пишет тексты")
- Абстрактные "AI для бизнеса" без конкретной боли
- Идеи, которые уже есть в десятках вариантов (AI-резюме, AI-копирайтер общего назначения)
- ЛЮБАЯ идея со словом "промт/prompt" в названии — АВТОМАТИЧЕСКИЙ ОТКАЗ

✅ ХОРОШИЕ ИДЕИ — КОНКРЕТНЫЕ И НИШЕВЫЕ:
- AI для конкретной отрасли (стоматологии, автосервисов, фермеров)
- Автоматизация конкретного процесса (обработка тендеров, проверка договоров)
- Инструмент для решения КОНКРЕТНОЙ боли (мониторинг цен конкурентов в нише)

ТРИГГЕРЫ СПРОСА (для foundry):
🔹 Успешный зарубежный стартап БЕЗ аналога в РФ + доказательства спроса
🔹 Всплеск поисковых запросов в нише (Вордстат)
🔹 Новый закон/регуляция — массовая потребность
🔹 Уход зарубежного сервиса — дыра на рынке
🔹 Сезонный всплеск — предсказуемый пик
🔹 Вирусный контент/тренд
🔹 Кризис/банкротство — массовая боль
🔹 Изменение потребительского поведения

ПРОВЕРКА УНИКАЛЬНОСТИ (ОБЯЗАТЕЛЬНО):
Перед созданием инсайта спроси себя: "Эта идея СУЩЕСТВЕННО отличается от других моих инсайтов?"
Если ты уже предложил что-то похожее (например, "платформа для X" и "маркетплейс для X") — это ДУБЛЬ. НЕ включай.

ФОРМАТ ИНСАЙТА (foundry):
{
  "source_index": 1,
  "opportunity_type": "foundry",
  "title": "[Идея продукта]: [Боль ЦА] → [Решение]",
  "company_name": null,
  "what_happens": "Мировой тренд/стартап + ПОЧЕМУ это актуально для РФ. Доказательства спроса: [Вордстат/Авито/TG/vc.ru — конкретные цифры или ссылки]",
  "why_important": "Размер рынка РФ/СНГ. Есть ли аналоги? Почему сейчас окно?",
  "problem": "Конкретная боль ЦА в РФ. B2B или B2C. Кто платит",
  "action_proposal": "Что строим (MVP за 2 недели). Монетизация в ₽. Канал для первых клиентов. Revenue estimate.",
  "category_check": "ПОДТВЕРЖДАЮ: идея НЕ входит в запрещённые категории и НЕ дублирует другие мои инсайты"
}

ОБЯЗАТЕЛЬНО для foundry:
✅ Доказательства спроса в РФ (не просто "в мире работает → в РФ тоже")
✅ Оценка: есть ли уже аналог в РФ?
✅ Понятная ЦА и монетизация в ₽
✅ Идея НИШЕВАЯ и КОНКРЕТНАЯ (не абстрактная "AI для всех")
✅ НЕ дублирует другие инсайты в этом батче

Если нет связи с РФ/СНГ или нет доказательств спроса или категория запрещена — ПРОПУСКАЙ.

═══ ОБЩИЕ ПРАВИЛА ═══
- Верни СТРОГО JSON-массив без markdown
- Каждый элемент = один инсайт
- source_index = номер сигнала из входных данных (начиная с 1)
- Если сигнал нерелевантен — просто НЕ включай его в ответ

${historicalContext ? `\n═══ ИСТОРИЧЕСКИЕ СИГНАЛЫ (за последние 7 дней) ═══
Эти сигналы УЖЕ были обработаны ранее, НО могут снова стать актуальными!
Если новый сигнал создаёт ТРИГГЕР, который делает старый сигнал релевантным — используй их ВМЕСТЕ для создания более сильного инсайта.
Примеры кросс-мэтчинга:
- Новый закон → старый сигнал о компании, которой теперь нужно срочно адаптироваться
- Новый технологический тренд → старый сигнал о компании с болью, которую этот тренд решает
- Уход вендора → старый сигнал о компании, которая использовала этого вендора
НЕ создавай инсайт ТОЛЬКО из исторического сигнала без нового триггера!

${historicalContext}
\n` : ""}
СИГНАЛЫ:
${brief}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
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

      // ALL insights start as "new" — chain-runner or manual review promotes to "qualified"
      // This prevents low-quality foundry ideas from reaching Builder without review
      const insightStatus = "new";

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

      // Log insights created
      console.log(`Analyst created ${toInsert.length} insights from ${analyzedIds.size} signals`);
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
