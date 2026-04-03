import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function compact(v: unknown, max = 900) {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

async function firecrawlScrape(url: string, apiKey: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 2000 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const d = await res.json();
    return (d?.data?.markdown || "").slice(0, 3000) || null;
  } catch { return null; }
}

async function firecrawlSearch(query: string, apiKey: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 8, lang: "ru", country: "RU", tbs: "qdr:w" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const d = await res.json();
    const results = d?.data || d?.results || [];
    if (!Array.isArray(results) || results.length === 0) return null;
    return results
      .map((r: any) => `[${r.title}](${r.url})\n${r.description || ""}`)
      .join("\n\n")
      .slice(0, 3000);
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
    if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured — scout requires real data");

    let factory = "consulting";
    try { factory = (await req.clone().json())?.factory || "consulting"; } catch {}

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ═══ Load mandate ═══
    const { data: flows } = await supabase
      .from("factory_flows")
      .select("target_company_size, target_region, target_industry, target_notes")
      .eq("factory", factory).eq("status", "active").limit(1);

    const mandateSize = flows?.[0]?.target_company_size || "5-500";
    const mandateRegion = flows?.[0]?.target_region || "РФ/СНГ";
    const mandateIndustry = flows?.[0]?.target_industry || "";

    // ═══ Load blacklist (rejected companies) ═══
    const { data: rejectedLeads } = await supabase
      .from("leads")
      .select("company_name")
      .eq("status", "rejected")
      .order("created_at", { ascending: false })
      .limit(100);

    const blacklist = [...new Set(
      (rejectedLeads || []).map((l: any) => l.company_name?.trim()).filter(Boolean)
    )];

    // ═══ Load sources from DB ═══
    const { data: sources } = await supabase
      .from("scout_sources")
      .select("*")
      .eq("factory", factory)
      .eq("enabled", true);

    if (!sources || sources.length === 0) {
      return new Response(JSON.stringify({ success: true, signals_created: 0, message: "No enabled sources" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ Scrape/search all sources ═══
    const scrapedData: { name: string; category: string; content: string }[] = [];

    // Batch 4 at a time
    for (let i = 0; i < sources.length; i += 4) {
      const batch = sources.slice(i, i + 4);
      const results = await Promise.allSettled(
        batch.map((src: any) =>
          src.scrape_method === "scrape"
            ? firecrawlScrape(src.url_template, FIRECRAWL_API_KEY)
            : firecrawlSearch(src.url_template, FIRECRAWL_API_KEY)
        )
      );
      for (let j = 0; j < batch.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled" && r.value) {
          scrapedData.push({ name: batch[j].name, category: batch[j].category, content: r.value });
        }
      }
    }

    console.log(`[scout] Scraped ${scrapedData.length}/${sources.length} sources`);

    if (scrapedData.length === 0) {
      return new Response(JSON.stringify({ success: true, signals_created: 0, message: "All sources returned empty" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══ Load existing signals for dedup ═══
    const { data: recentSignals } = await supabase
      .from("signals")
      .select("description, company_name")
      .order("created_at", { ascending: false })
      .limit(100);

    const existingDescriptions = new Set(
      (recentSignals || []).map((s: any) => compact(s.description, 200).toLowerCase())
    );

    // ═══ GPT: extract signals from real data ═══
    const scrapedBrief = scrapedData
      .map((d, i) => `[ИСТОЧНИК ${i + 1}: ${d.name} (${d.category})]\n${d.content.slice(0, 2000)}`)
      .join("\n\n---\n\n");

    const prompt = `Ты — скаут. Извлеки КОНКРЕТНЫЕ сигналы из РЕАЛЬНЫХ данных ниже.

МАНДАТ: компании ${mandateRegion}, ${mandateSize} сотрудников. Корпорации (1С, Яндекс, Сбер, МТС) — ПРОПУСКАЙ.
${mandateIndustry ? `Целевые отрасли: ${mandateIndustry}` : ""}
${blacklist.length > 0 ? `\nЧЁРНЫЙ СПИСОК (НЕ включай эти компании):\n${blacklist.join(", ")}\n` : ""}

РЕАЛЬНЫЕ ДАННЫЕ:
${scrapedBrief}

ПРАВИЛА:
- Извлекай ТОЛЬКО из предоставленных данных. НЕ выдумывай.
- Каждый сигнал ОБЯЗАН иметь source (URL или название источника).
- Максимум 8 сигналов.
- Если данные пустые или нерелевантные — верни пустой массив [].

ФОРМАТ: JSON-массив:
[{
  "company_name": "название или null",
  "description": "что конкретно увидел",
  "signal_type": "vacancy|tender|news|complaint|vendor_exit|direct_demand",
  "industry": "отрасль",
  "source": "URL или название источника",
  "potential": "${factory}"
}]

Без markdown, только JSON.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.2", messages: [{ role: "user", content: prompt }], temperature: 0.3 }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("[scout] AI error:", response.status, t);
      throw new Error(`AI error ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    let aiItems: any[] = [];
    try {
      let cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const m = cleaned.match(/\[[\s\S]*\]/);
      if (m) cleaned = m[0];
      aiItems = JSON.parse(cleaned);
      if (!Array.isArray(aiItems)) aiItems = [];
    } catch {
      console.error("[scout] Parse error:", content.slice(0, 500));
      aiItems = [];
    }

    // ═══ Dedup and insert ═══
    const toInsert: any[] = [];
    for (const item of aiItems) {
      if (!item?.description || !item?.source) continue;

      const desc = compact(item.description, 900);
      const descKey = desc.toLowerCase().slice(0, 200);
      if (existingDescriptions.has(descKey)) continue;
      existingDescriptions.add(descKey);

      // Blacklist check
      const cn = compact(item.company_name, 120) || null;
      if (cn && blacklist.some(b => cn.toLowerCase().includes(b.toLowerCase()))) continue;

      toInsert.push({
        company_name: cn,
        description: desc,
        signal_type: compact(item.signal_type, 50),
        industry: compact(item.industry, 80) || null,
        source: compact(item.source, 200),
        potential: factory,
        status: "new",
        notes: null,
      });
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from("signals").insert(toInsert);
      if (error) throw error;
    }

    console.log(`[scout] Created ${toInsert.length} signals from ${scrapedData.length} sources`);

    return new Response(JSON.stringify({
      success: true,
      signals_created: toInsert.length,
      sources_scraped: scrapedData.length,
      sources_total: sources.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[scout] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
