import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHAINS: Record<string, string[]> = {
  consulting: ["scout-run", "analyst-run", "marketer-run"],
  foundry: ["scout-run", "analyst-run", "foundry-qualify", "builder-run"],
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { factory = "consulting", step = 0, triggered_by = "manual" } = await req.json().catch(() => ({
      factory: "consulting",
      step: 0,
      triggered_by: "manual",
    }));

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(`Missing env: SUPABASE_URL=${!!SUPABASE_URL}, SUPABASE_SERVICE_ROLE_KEY=${!!SERVICE_KEY}`);
    }

    const authKey = Deno.env.get("CHAIN_AUTH_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_KEY;
    console.log(`[chain-runner] Using auth key starting with: ${authKey?.slice(0, 10)}...`);

    const chain = CHAINS[factory] || CHAINS.consulting;
    const totalSteps = chain.length;

    // Step already beyond chain — nothing to do
    if (step >= totalSteps) {
      return new Response(JSON.stringify({
        success: true,
        factory,
        step,
        step_name: null,
        done: true,
        next_step: null,
        total_steps: totalSteps,
        data: null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stepName = chain[step];
    const isLastStep = step === totalSteps - 1;
    let stepResult: { status: number; data: any } = { status: 200, data: {} };

    console.log(`[${factory}] Running step ${step}/${totalSteps - 1}: ${stepName}...`);

    // ═══ EXECUTE CURRENT STEP ═══

    if (stepName === "foundry-qualify") {
      // Special internal step: qualify new foundry insights for builder
      try {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const sb = createClient(SUPABASE_URL, SERVICE_KEY);

        // Retry logic — insights may not be committed yet
        let count = 0;
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise((r) => setTimeout(r, 3000));
          const { data: newFoundry, error: qErr } = await sb
            .from("insights")
            .update({ status: "qualified", updated_at: new Date().toISOString() })
            .eq("status", "new")
            .in("opportunity_type", ["foundry", "innovation_pilot"])
            .select("id");
          count = newFoundry?.length || 0;
          if (qErr) console.error(`[foundry] qualify attempt ${attempt + 1} error:`, qErr.message);
          if (count > 0) break;
          console.log(`[foundry] qualify attempt ${attempt + 1}: found ${count}, retrying...`);
        }

        console.log(`[foundry] Qualified ${count} insights for builder`);
        stepResult = { status: 200, data: { qualified: count } };
      } catch (e: any) {
        console.error(`[foundry] qualify error:`, e.message);
        stepResult = { status: 500, data: { error: e.message } };
      }
    } else {
      // Standard step: call the Edge Function via fetch with retry
      try {
        let res: Response | null = null;
        let rawText = "";
        let data: any = {};
        const MAX_RETRIES = 2;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          res = await fetch(`${SUPABASE_URL}/functions/v1/${stepName}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authKey}`,
              apikey: authKey,
            },
            body: JSON.stringify({ triggered_by, factory }),
          });

          rawText = await res.text();
          try {
            data = rawText ? JSON.parse(rawText) : {};
          } catch {
            data = { raw: rawText.slice(0, 1000) };
          }

          if (res.ok || (res.status !== 401 && res.status !== 429)) {
            break;
          }

          if (attempt < MAX_RETRIES) {
            console.warn(`[${factory}] ${stepName} returned ${res.status}, retrying (${attempt + 1}/${MAX_RETRIES})...`);
            await new Promise((r) => setTimeout(r, 3000));
          }
        }

        stepResult = { status: res!.status, data };
        console.log(`[${factory}] ${stepName}: ${res!.status}`, JSON.stringify(data).slice(0, 300));

        if (!res!.ok) {
          console.error(`[${factory}] ${stepName} failed with ${res!.status}`);
          return new Response(JSON.stringify({
            success: false,
            factory,
            step,
            step_name: stepName,
            done: false,
            next_step: step, // retry same step
            total_steps: totalSteps,
            error: `${stepName} failed with status ${res!.status}`,
            data: stepResult.data,
          }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e: any) {
        console.error(`[${factory}] ${stepName} error:`, e.message);
        return new Response(JSON.stringify({
          success: false,
          factory,
          step,
          step_name: stepName,
          done: false,
          next_step: step,
          total_steps: totalSteps,
          error: e.message,
        }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ═══ SELF-REGULATION ENGINE (runs on last step only) ═══
    if (isLastStep) {
      try {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

        // Update KPI — skip if rpc doesn't exist
        try { await supabase.rpc("update_agent_kpi"); } catch {}

        // Load current month stats for funnel analysis
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const monthISO = monthStart.toISOString();

        const [signalsRes, insightsRes, leadsRes, oppsRes, feedbackRes, kpiRes] = await Promise.all([
          supabase.from("signals").select("id, potential, status").gte("created_at", monthISO),
          supabase.from("insights").select("id, opportunity_type, status").gte("created_at", monthISO),
          supabase.from("leads").select("id, status").gte("created_at", monthISO),
          supabase.from("startup_opportunities").select("id, stage").gte("created_at", monthISO),
          supabase.from("agent_feedback").select("id, resolved").eq("resolved", false),
          supabase.from("agent_kpi").select("factory, metric, target, current").eq("active", true),
        ]);

        const signals = signalsRes.data || [];
        const insights = insightsRes.data || [];
        const leads = leadsRes.data || [];
        const opps = oppsRes.data || [];
        const unresolvedFeedback = (feedbackRes.data || []).length;
        const kpis = kpiRes.data || [];

        // Calculate funnel for current factory
        const isConsulting = factory !== "foundry";
        const fSignals = signals.filter((s: any) => isConsulting ? (s.potential === "consulting" || !s.potential) : s.potential === "foundry");
        const fInsights = insights.filter((i: any) => isConsulting ? i.opportunity_type === "consulting" : (i.opportunity_type === "foundry" || i.opportunity_type === "innovation_pilot"));
        const fQualified = fInsights.filter((i: any) => i.status === "qualified" || i.status === "processed");
        const fReturned = fInsights.filter((i: any) => i.status === "returned");
        const fOutput = isConsulting
          ? leads.filter((l: any) => l.status === "pending_approval" || l.status === "approved" || l.status === "sent")
          : opps.filter((o: any) => o.stage !== "killed");

        // Target KPIs per month
        const monthTarget = isConsulting
          ? { signals: 900, insights: 450, output: 10 }
          : { signals: 450, insights: 150, output: 3 };

        const dayOfMonth = new Date().getDate();
        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        const progressRatio = dayOfMonth / daysInMonth;

        const expected = {
          signals: Math.round(monthTarget.signals * progressRatio),
          insights: Math.round(monthTarget.insights * progressRatio),
          output: Math.round(monthTarget.output * progressRatio),
        };

        const actual = {
          signals: fSignals.length,
          insights: fQualified.length,
          output: fOutput.length,
          returned: fReturned.length,
        };

        const signalToInsight = fSignals.length > 0 ? (fInsights.length / fSignals.length * 100).toFixed(1) : "0";
        const insightToOutput = fInsights.length > 0 ? (fOutput.length / fInsights.length * 100).toFixed(1) : "0";
        const returnRate = fInsights.length > 0 ? (fReturned.length / fInsights.length * 100).toFixed(1) : "0";

        console.log(`[${factory}] FUNNEL: signals=${actual.signals}/${expected.signals}, insights=${actual.insights}/${expected.insights}, output=${actual.output}/${expected.output}, returnRate=${returnRate}%`);

        // ═══ BOTTLENECK DETECTION & ADAPTIVE FEEDBACK ═══
        const feedbackMessages: { to_agent: string; content: string; feedback_type: string }[] = [];

        if (actual.signals < expected.signals * 0.7) {
          feedbackMessages.push({
            to_agent: "scout",
            feedback_type: "kpi_behind",
            content: `⚠️ ОТСТАВАНИЕ ПО СИГНАЛАМ: ${actual.signals}/${expected.signals} (${(actual.signals / Math.max(expected.signals, 1) * 100).toFixed(0)}%). Нужно РАСШИРИТЬ охват источников. Добавь больше поисковых запросов, скрейпь больше страниц. Снизь порог — сейчас количество важнее качества для воронки.`,
          });
        }

        if (fSignals.length >= 10 && Number(signalToInsight) < 30) {
          feedbackMessages.push({
            to_agent: "analyst",
            feedback_type: "low_conversion",
            content: `⚠️ НИЗКАЯ КОНВЕРСИЯ СИГНАЛОВ В ИНСАЙТЫ: ${signalToInsight}%. Цель: >40%. Будь МЕНЕЕ строгим — пропускай больше сигналов как инсайты. Лучше больше инсайтов среднего качества, чем мало идеальных. Маркетолог/Билдер отсеет слабые.`,
          });
        }

        if (Number(returnRate) > 40 && fInsights.length >= 5) {
          feedbackMessages.push({
            to_agent: "analyst",
            feedback_type: "high_return_rate",
            content: `⚠️ ВЫСОКИЙ ПРОЦЕНТ ВОЗВРАТОВ: ${returnRate}%. Маркетолог/Билдер возвращают инсайты. Проблема: инсайты слишком абстрактные. ДОБАВЬ КОНКРЕТИКУ: отрасль, размер компании, конкретные признаки боли, конкретные каналы поиска.`,
          });
        }

        if (fQualified.length >= 5 && actual.output < expected.output * 0.5) {
          const agent = isConsulting ? "marketer" : "builder";
          feedbackMessages.push({
            to_agent: agent,
            feedback_type: "kpi_behind",
            content: `⚠️ МАЛО РЕЗУЛЬТАТОВ: ${actual.output}/${expected.output}. Инсайтов достаточно (${fQualified.length}), но мало конвертируется. СНИЗЬ ПОРОГ квалификации — лучше отправить 10 средних лидов, чем 2 идеальных. Объём важнее.`,
          });
        }

        if (actual.output < expected.output * 0.5 && dayOfMonth > 10) {
          feedbackMessages.push({
            to_agent: "scout",
            feedback_type: "urgency",
            content: `🚨 КРИТИЧЕСКОЕ ОТСТАВАНИЕ ОТ KPI: ${actual.output} из ${monthTarget.output} за месяц (прошло ${dayOfMonth} дней). МАКСИМАЛЬНЫЙ РЕЖИМ: удвой количество сигналов, расширь географию поиска, добавь новые источники.`,
          });
        }

        if (feedbackMessages.length > 0) {
          const toInsert = feedbackMessages.map(f => ({
            factory,
            from_agent: "chain-runner",
            ...f,
            resolved: false,
          }));

          await supabase
            .from("agent_feedback")
            .update({ resolved: true })
            .eq("factory", factory)
            .eq("from_agent", "chain-runner")
            .eq("resolved", false);

          await supabase.from("agent_feedback").insert(toInsert as any);
          console.log(`[${factory}] Generated ${feedbackMessages.length} optimization feedbacks`);
        }

        // ═══ SAVE FUNNEL SNAPSHOT ═══
        try {
          await supabase.from("sync_runs").insert({
            source: `chain-runner:${factory}`,
            status: "ok",
            items_synced: totalSteps,
            items_skipped: 0,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
          } as any);
        } catch (e) {
          console.error("sync_runs log error:", e);
        }

      } catch (e) {
        console.error("Self-regulation error (non-fatal):", e);
      }
    }

    // ═══ RESPONSE ═══
    return new Response(JSON.stringify({
      success: true,
      factory,
      step,
      step_name: stepName,
      done: isLastStep,
      next_step: isLastStep ? null : step + 1,
      total_steps: totalSteps,
      data: stepResult.data,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chain-runner error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
