import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { factory, triggered_by } = await req.json().catch(() => ({
      factory: "consulting",
      triggered_by: "manual",
    }));

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const chain = factory === "foundry"
      ? ["scout-run", "analyst-run", "builder-run"]
      : ["scout-run", "analyst-run", "marketer-run"];

    const results: { fn: string; status: number; data: any }[] = [];

    for (const fn of chain) {
      console.log(`[${factory}] Running ${fn}...`);

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ triggered_by, factory }),
        });

        const data = await res.json().catch(() => ({}));
        results.push({ fn, status: res.status, data });

        console.log(`[${factory}] ${fn}: ${res.status}`, JSON.stringify(data).slice(0, 200));

        if (!res.ok) {
          console.error(`[${factory}] ${fn} failed with ${res.status}, stopping chain`);
          break;
        }

        // Small delay between steps to avoid rate limits
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e: any) {
        console.error(`[${factory}] ${fn} error:`, e.message);
        results.push({ fn, status: 500, data: { error: e.message } });
        break;
      }
    }

    // Update KPI after chain run
    try {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
      await supabase.rpc("update_agent_kpi");
    } catch (e) {
      console.error("KPI update error (non-fatal):", e);
    }

    return new Response(JSON.stringify({
      success: true,
      factory,
      triggered_by,
      steps: results,
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
