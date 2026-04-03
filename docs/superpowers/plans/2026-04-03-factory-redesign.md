# Consulting Factory Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Consulting Factory agent chain to produce 3 quality leads/day without junk, duplicates, or self-optimization pressure.

**Architecture:** Keep Scout → Analyst → Marketer chain. Add configurable `scout_sources` table. Remove self-optimization from all agents. Add blacklist from rejected leads. Add company-level dedup in Marketer. Remove Level B leads.

**Tech Stack:** Supabase Edge Functions (Deno), OpenAI gpt-5.2, Firecrawl (search + scrape), React admin UI.

**Spec:** `docs/superpowers/specs/2026-04-03-factory-redesign-design.md`

---

### Task 1: Create `scout_sources` table + seed data

**Files:**
- Create: `supabase/migrations/20260403_scout_sources.sql`

- [ ] **Step 1: Write migration SQL**

Create `supabase/migrations/20260403_scout_sources.sql`:

```sql
-- Configurable sources for Scout agent
CREATE TABLE IF NOT EXISTS public.scout_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url_template text NOT NULL,
  category text NOT NULL,
  factory text NOT NULL DEFAULT 'consulting',
  enabled boolean NOT NULL DEFAULT true,
  scrape_method text NOT NULL DEFAULT 'scrape',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.scout_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_scout_sources" ON public.scout_sources FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_scout_sources" ON public.scout_sources FOR SELECT TO anon USING (true);

-- Seed default consulting sources
INSERT INTO public.scout_sources (name, url_template, category, factory, scrape_method) VALUES
  -- Vacancies
  ('hh.ru: автоматизация', 'https://hh.ru/search/vacancy?text=автоматизация+бизнес-процессов&area=113&period=1', 'vacancies', 'consulting', 'scrape'),
  ('hh.ru: AI/ML', 'https://hh.ru/search/vacancy?text=внедрение+AI+искусственный+интеллект&area=113&period=1', 'vacancies', 'consulting', 'scrape'),
  ('hh.ru: цифровая трансформация', 'https://hh.ru/search/vacancy?text=цифровая+трансформация&area=113&period=1', 'vacancies', 'consulting', 'scrape'),
  ('superjob: автоматизация', 'https://www.superjob.ru/vacancy/search/?keywords=автоматизация+бизнес', 'vacancies', 'consulting', 'scrape'),
  ('habr career: AI', 'https://career.habr.com/vacancies?q=AI+автоматизация&type=all', 'vacancies', 'consulting', 'scrape'),
  -- Business media
  ('vc.ru свежее', 'https://vc.ru/new', 'business_media', 'consulting', 'scrape'),
  ('rb.ru новости', 'https://rb.ru/news/', 'business_media', 'consulting', 'scrape'),
  ('habr: автоматизация', 'https://habr.com/ru/search/?q=автоматизация+бизнес&target_type=posts&order=date', 'business_media', 'consulting', 'scrape'),
  ('kommersant tech', 'https://www.kommersant.ru/rubric/4', 'business_media', 'consulting', 'scrape'),
  ('rbc technology', 'https://www.rbc.ru/technology_and_media/', 'business_media', 'consulting', 'scrape'),
  ('cnews.ru', 'https://www.cnews.ru/news/top', 'business_media', 'consulting', 'scrape'),
  ('tadviser.ru', 'https://www.tadviser.ru/index.php/Статья:Новости', 'business_media', 'consulting', 'scrape'),
  -- Tenders
  ('zakupki AI', 'тендер закупка искусственный интеллект автоматизация 2026', 'tenders', 'consulting', 'search'),
  -- Direct demand
  ('avito: автоматизация', 'https://www.avito.ru/rossiya/predlozheniya_uslug?q=автоматизация+бизнес', 'direct_demand', 'consulting', 'scrape'),
  ('fl.ru: AI проекты', 'ищу подрядчика AI автоматизация чат-бот разработка Россия', 'direct_demand', 'consulting', 'search'),
  ('kwork: автоматизация', 'https://kwork.ru/projects?c=all&query=автоматизация', 'direct_demand', 'consulting', 'scrape'),
  -- Vendor exit
  ('уход вендоров', 'уход зарубежного сервиса замена CRM ERP Россия 2026', 'vendor_exit', 'consulting', 'search'),
  -- Foundry sources
  ('ProductHunt AI', 'AI startup launched this week ProductHunt 2026', 'global_startups', 'foundry', 'search'),
  ('HackerNews Show HN', 'https://news.ycombinator.com/show', 'global_startups', 'foundry', 'scrape'),
  ('нет аналога в РФ', 'нет аналога в России сервис AI автоматизация', 'ru_demand', 'foundry', 'search'),
  ('TG-боты бизнес', 'Telegram бот бизнес автоматизация Россия популярный', 'ru_demand', 'foundry', 'search');
```

- [ ] **Step 2: Apply migration**

Run the SQL in Supabase Dashboard → SQL Editor.

- [ ] **Step 3: Verify sources exist**

```sql
SELECT count(*), factory FROM scout_sources GROUP BY factory;
-- Expected: consulting ~17, foundry ~4
```

- [ ] **Step 4: Commit**

```bash
cd /home/swagaswaga/Documents/dwh/proverka/huggable-deploy-buddy
git add supabase/migrations/20260403_scout_sources.sql
git commit -m "feat: add scout_sources table with configurable scraping sources"
```

---

### Task 2: Rewrite `scout-run` — load sources from DB, remove self-optimization

**Files:**
- Modify: `supabase/functions/scout-run/index.ts`

- [ ] **Step 1: Rewrite scout-run**

Replace the entire file `supabase/functions/scout-run/index.ts` with:

```ts
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
```

- [ ] **Step 2: Deploy and test**

```bash
npx supabase functions deploy scout-run --no-verify-jwt
```

Test manually:
```bash
curl -X POST "https://kuodvlyepoojqimutmvu.supabase.co/functions/v1/scout-run" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <service_role_key>" \
  -d '{"factory":"consulting"}'
```

Expected: `{"success":true,"signals_created":N,"sources_scraped":N,"sources_total":N}`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/scout-run/index.ts
git commit -m "feat: rewrite scout-run — configurable sources, blacklist, no self-optimization"
```

---

### Task 3: Update `analyst-run` — add blacklist + dedup, remove self-optimization

**Files:**
- Modify: `supabase/functions/analyst-run/index.ts`

- [ ] **Step 1: Add blacklist loading after mandate loading (after line ~73)**

Find the section after `customMandateText` is set and before `PHASE 0`. Add:

```ts
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
```

- [ ] **Step 2: Remove self-optimization prompt**

Delete the entire `selfOptimizationPrompt` block (lines ~193-208). Replace with:

```ts
    const selfOptimizationPrompt = ""; // Removed — quality over quantity
```

- [ ] **Step 3: Remove KPI pressure from the GPT prompt**

In the GPT prompt string (starts around line 259), find and DELETE these lines:

```
ВАЖНО — КОНВЕРСИЯ:
- Создавай инсайт из КАЖДОГО сигнала, если он хоть МИНИМАЛЬНО релевантен нашему мандату.
- МИНИМУМ 60% сигналов должны стать инсайтами. Если сомневаешься — СОЗДАЙ инсайт. Маркетолог отфильтрует слабые.
- Не будь перфекционистом. Лучше 10 средних инсайтов, чем 2 идеальных.
```

Replace with:

```
КАЧЕСТВО:
- Один сигнал = максимум один инсайт. Не множь инсайты из одного сигнала.
- Каждый инсайт ОБЯЗАН содержать: конкретную компанию ИЛИ конкретную отрасль + боль + почему сейчас.
- Абстрактные инсайты ("тренд на автоматизацию") — НЕ создавай.
- Лучше 0 инсайтов чем 5 мусорных.
```

- [ ] **Step 4: Add blacklist to the GPT prompt**

In the prompt string, after the mandate section and before the signals brief, add:

```
${blacklist.length > 0 ? `\n═══ ЧЁРНЫЙ СПИСОК (эти компании ОТКЛОНЕНЫ — НЕ создавай инсайты по ним!) ═══\n${blacklist.join(", ")}\n═══ КОНЕЦ ЧЁРНОГО СПИСКА ═══\n` : ""}
```

- [ ] **Step 5: Remove feedback/KPI sections from prompt end**

Find and DELETE these template literal sections from the prompt:

```
${feedbackContext ? `\n═══ ОБРАТНАЯ СВЯЗЬ...` : ""}
${kpiContext ? `\n═══ ТЕКУЩИЕ KPI...` : ""}
${selfOptimizationPrompt}
```

- [ ] **Step 6: Remove self-optimization KPI update and peer feedback at the end of the function**

Find the section starting with `// ═══ SELF-OPTIMIZATION: Update KPI + peer feedback ═══` (around line 529) and delete everything from there until the `return new Response(...)`. Keep only the return statement.

- [ ] **Step 7: Deploy and test**

```bash
npx supabase functions deploy analyst-run --no-verify-jwt
```

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/analyst-run/index.ts
git commit -m "feat: analyst-run — add blacklist, dedup, remove self-optimization and KPI pressure"
```

---

### Task 4: Update `marketer-run` — company dedup, Level A only, remove self-optimization

**Files:**
- Modify: `supabase/functions/marketer-run/index.ts`

- [ ] **Step 1: Add company-level dedup after insight-level dedup (after line ~159)**

After the `queue` is built, add:

```ts
    // ═══ DEDUP: Load recent leads by company_name ═══
    const { data: recentLeads } = await supabase
      .from("leads")
      .select("company_name, name, status")
      .not("status", "eq", "rejected")
      .order("created_at", { ascending: false })
      .limit(200);

    const existingCompanies = new Set(
      (recentLeads || []).map((l: any) => (l.company_name || "").toLowerCase().trim()).filter(Boolean)
    );
```

- [ ] **Step 2: Remove self-optimization prompt**

Delete the entire `selfOptimizationPrompt` block (lines ~119-129). Replace with:

```ts
    const selfOptimizationPrompt = ""; // Removed — quality over quantity
```

- [ ] **Step 3: Remove KPI pressure from GPT prompt**

In the prompt string, find and DELETE:

```
═══ КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА ═══
...
2. МИНИМУМ 60% инсайтов ДОЛЖНЫ стать лидами (Level A или Level B)
...
```

Replace rule 2 with: `2. Создавай ТОЛЬКО Level A лиды — с реальным контактом.`

- [ ] **Step 4: Remove Level B from GPT prompt**

In the prompt, find the entire `УРОВЕНЬ B` section and DELETE it. Keep only Level A and "НЕ КВАЛИФИЦИРОВАН".

- [ ] **Step 5: Add company dedup check in the processing loop**

In the `for (const item of aiItems)` loop, right after `const cn = compact(item.company_name, 120);`, add:

```ts
        // ═══ DEDUP: skip if company already has a lead ═══
        if (cn && existingCompanies.has(cn.toLowerCase().trim())) {
          console.log(`[marketer] ⏭️ DEDUP: "${cn}" already has a lead — skipping`);
          await supabase.from("insights").update({
            status: "qualified",
            notes: "Маркетолог: дубликат — лид на эту компанию уже существует.",
            updated_at: new Date().toISOString(),
          } as any).eq("id", insight.id);
          continue;
        }
        if (cn) existingCompanies.add(cn.toLowerCase().trim());
```

- [ ] **Step 6: Remove all Level B code blocks**

Find every `if (level === "B")` or Level B insert block and replace with returning the insight to analyst:

```ts
        } else {
          // Level B removed — return to analyst
          await supabase.from("insights").update({
            status: "returned",
            notes: "Маркетолог: не найден контакт ЛПР. Нужен более конкретный инсайт.",
            updated_at: new Date().toISOString(),
          } as any).eq("id", insight.id);
          returned++;
          console.log(`[marketer] ❌ No contact for "${cn}" — returned to analyst`);
        }
```

- [ ] **Step 7: Remove KPI update and peer feedback sections at end of function**

Find and delete the KPI update block and feedback-to-analyst/scout blocks at the end. Keep only the notify-owner call and the final return.

- [ ] **Step 8: Deploy and test**

```bash
npx supabase functions deploy marketer-run --no-verify-jwt
```

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/marketer-run/index.ts
git commit -m "feat: marketer-run — company dedup, Level A only, remove self-optimization"
```

---

### Task 5: Simplify `chain-runner` — remove adaptive feedback

**Files:**
- Modify: `supabase/functions/chain-runner/index.ts`

- [ ] **Step 1: Remove the entire self-regulation engine**

Find the section `// ═══ SELF-REGULATION ENGINE (runs on last step only) ═══` (line ~162) and delete EVERYTHING from there until the `// ═══ RESPONSE ═══` comment. Replace with:

```ts
    // Log completion
    if (isLastStep) {
      console.log(`[${factory}] Chain completed: all ${totalSteps} steps done.`);
    }
```

- [ ] **Step 2: Add blacklist to step calls**

In the step execution section where `body: JSON.stringify(...)` is called (line ~104), change:

```ts
body: JSON.stringify({ triggered_by, factory }),
```

To:

```ts
body: JSON.stringify({ triggered_by, factory }),
```

(No change needed — blacklist is loaded by each agent individually from the `leads` table.)

- [ ] **Step 3: Deploy and test**

```bash
npx supabase functions deploy chain-runner --no-verify-jwt
```

Test full chain:
```bash
curl -X POST "https://kuodvlyepoojqimutmvu.supabase.co/functions/v1/chain-runner" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <service_role_key>" \
  -d '{"factory":"consulting","step":0}'
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/chain-runner/index.ts
git commit -m "feat: chain-runner — remove self-regulation engine and adaptive feedback"
```

---

### Task 6: Admin UI — Scout Sources Manager

**Files:**
- Create: `src/components/twin/ScoutSourcesManager.tsx`
- Modify: `src/App.tsx` (add route/tab)

- [ ] **Step 1: Create ScoutSourcesManager component**

Create `src/components/twin/ScoutSourcesManager.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Plus, Trash2, Play, Globe, Search } from 'lucide-react'

type Source = {
  id: string
  name: string
  url_template: string
  category: string
  factory: string
  enabled: boolean
  scrape_method: string
  created_at: string
}

const CATEGORIES = [
  'vacancies', 'business_media', 'tenders', 'direct_demand',
  'vendor_exit', 'global_startups', 'ru_demand',
]

export function ScoutSourcesManager({ factory = 'consulting' }: { factory?: string }) {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newCategory, setNewCategory] = useState('business_media')
  const [newMethod, setNewMethod] = useState<'scrape' | 'search'>('scrape')
  const [testing, setTesting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('scout_sources')
      .select('*')
      .eq('factory', factory)
      .order('category')
    if (error) toast.error(error.message)
    setSources((data as Source[]) || [])
    setLoading(false)
  }, [factory])

  useEffect(() => { load() }, [load])

  const toggleEnabled = async (id: string, enabled: boolean) => {
    const { error } = await supabase
      .from('scout_sources')
      .update({ enabled: !enabled })
      .eq('id', id)
    if (error) toast.error(error.message)
    else {
      setSources(prev => prev.map(s => s.id === id ? { ...s, enabled: !enabled } : s))
      toast.success(enabled ? 'Отключён' : 'Включён')
    }
  }

  const addSource = async () => {
    if (!newName.trim() || !newUrl.trim()) return
    const { error } = await supabase.from('scout_sources').insert({
      name: newName.trim(),
      url_template: newUrl.trim(),
      category: newCategory,
      factory,
      scrape_method: newMethod,
      enabled: true,
    })
    if (error) toast.error(error.message)
    else {
      toast.success('Источник добавлен')
      setNewName('')
      setNewUrl('')
      setShowAdd(false)
      load()
    }
  }

  const deleteSource = async (id: string) => {
    const { error } = await supabase.from('scout_sources').delete().eq('id', id)
    if (error) toast.error(error.message)
    else {
      setSources(prev => prev.filter(s => s.id !== id))
      toast.success('Удалён')
    }
  }

  const testSource = async (source: Source) => {
    setTesting(source.id)
    try {
      const FIRECRAWL_API_KEY = prompt('Введи Firecrawl API key для теста:')
      if (!FIRECRAWL_API_KEY) { setTesting(null); return }

      const endpoint = source.scrape_method === 'scrape'
        ? 'https://api.firecrawl.dev/v1/scrape'
        : 'https://api.firecrawl.dev/v1/search'

      const body = source.scrape_method === 'scrape'
        ? { url: source.url_template, formats: ['markdown'], onlyMainContent: true }
        : { query: source.url_template, limit: 5, lang: 'ru', country: 'RU' }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      const preview = source.scrape_method === 'scrape'
        ? (data?.data?.markdown || '').slice(0, 500)
        : JSON.stringify(data?.data?.slice(0, 3) || data?.results?.slice(0, 3), null, 2).slice(0, 500)

      toast.success(`Тест OK: ${preview.slice(0, 100)}...`)
      console.log('[test source]', source.name, preview)
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`)
    }
    setTesting(null)
  }

  if (loading) return <div className="flex h-32 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" /></div>

  const grouped = CATEGORIES.reduce((acc, cat) => {
    const items = sources.filter(s => s.category === cat)
    if (items.length > 0) acc[cat] = items
    return acc
  }, {} as Record<string, Source[]>)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-100">Источники скаута</h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" /> Добавить
        </button>
      </div>

      {showAdd && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-3">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Название (напр. hh.ru: AI)"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <input
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            placeholder="URL или поисковый запрос"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <div className="flex gap-3">
            <select
              value={newCategory}
              onChange={e => setNewCategory(e.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={newMethod}
              onChange={e => setNewMethod(e.target.value as 'scrape' | 'search')}
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              <option value="scrape">Scrape (URL)</option>
              <option value="search">Search (запрос)</option>
            </select>
            <button onClick={addSource} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500">
              Сохранить
            </button>
          </div>
        </div>
      )}

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat}>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">{cat}</h4>
          <div className="space-y-1">
            {items.map(source => (
              <div
                key={source.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                  source.enabled
                    ? 'border-slate-700 bg-slate-800/50 text-slate-200'
                    : 'border-slate-800 bg-slate-900/50 text-slate-500'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {source.scrape_method === 'scrape'
                    ? <Globe className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
                    : <Search className="h-3.5 w-3.5 flex-shrink-0 text-purple-400" />
                  }
                  <span className="truncate font-medium">{source.name}</span>
                  <span className="truncate text-xs text-slate-500 hidden md:inline">{source.url_template.slice(0, 60)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => testSource(source)}
                    disabled={testing === source.id}
                    className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-50"
                    title="Тест"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => toggleEnabled(source.id, source.enabled)}
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      source.enabled ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {source.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => deleteSource(source.id)}
                    className="rounded p-1 text-slate-500 hover:bg-red-500/20 hover:text-red-400"
                    title="Удалить"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {sources.length === 0 && (
        <p className="text-center text-sm text-slate-500 py-8">Нет источников. Добавьте первый.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add ScoutSourcesManager to the app**

Find where TwinSignals or similar factory components are rendered in `src/App.tsx` or `src/components/twin/TwinDashboard.tsx` and add a new tab/section for ScoutSourcesManager. Import and render:

```tsx
import { ScoutSourcesManager } from './ScoutSourcesManager'

// In the consulting or foundry section, add:
<ScoutSourcesManager factory="consulting" />
```

The exact location depends on the existing routing — check `TwinDashboard.tsx` for the tab structure and add "Источники" tab.

- [ ] **Step 3: Verify UI renders**

```bash
npm run dev
```

Navigate to the admin panel → should see "Источники скаута" with all seeded sources, toggle on/off, add/delete.

- [ ] **Step 4: Commit**

```bash
git add src/components/twin/ScoutSourcesManager.tsx
git add -u  # any modified files (App.tsx or TwinDashboard.tsx)
git commit -m "feat: add ScoutSourcesManager admin UI for configurable sources"
```

---

### Task 7: Deploy all functions + push to GitHub

**Files:** none new

- [ ] **Step 1: Deploy all modified Edge Functions**

```bash
cd /home/swagaswaga/Documents/dwh/proverka/huggable-deploy-buddy
npx supabase functions deploy scout-run --no-verify-jwt
npx supabase functions deploy analyst-run --no-verify-jwt
npx supabase functions deploy marketer-run --no-verify-jwt
npx supabase functions deploy chain-runner --no-verify-jwt
```

- [ ] **Step 2: Test full chain manually**

```bash
curl -X POST "https://kuodvlyepoojqimutmvu.supabase.co/functions/v1/chain-runner" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <service_role_key>" \
  -d '{"factory":"consulting","step":0}'
```

Then check step 1 (analyst), step 2 (marketer) by incrementing step.

Verify:
- No self-optimization messages in logs
- Signals have real source URLs
- No duplicate company leads
- No Level B leads created

- [ ] **Step 3: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 4: Verify on Supabase Dashboard**

Check Functions logs for each function — no errors, clean execution.
