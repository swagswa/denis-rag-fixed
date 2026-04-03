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

    if (isLastStep) {
      console.log(`[${factory}] Chain completed: all ${totalSteps} steps done.`);
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
