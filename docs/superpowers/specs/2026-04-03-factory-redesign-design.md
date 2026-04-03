# Consulting Factory Redesign — Design Spec

## 1. Overview

Redesign the Consulting Factory agent chain (Scout → Analyst → Marketer) to eliminate junk data, duplicates, and self-optimization pressure. Goal: 3 quality leads/day with ready-to-send outreach. Budget: $50-60/month.

**Current problems:**
- Firecrawl search returns random Google snippets → junk signals
- No dedup across pipeline → same company appears 4x as different leads
- "Self-optimization" pressures agents to lower quality thresholds
- No feedback loop from rejected leads
- Level B leads (company without contact) clutter the queue

**Stack:** Supabase Edge Functions, OpenAI API (gpt-5.2), Firecrawl (search + scrape).

## 2. Configurable Sources (new table: `scout_sources`)

### Schema

```sql
create table scout_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url_template text not null,        -- URL to scrape OR search query
  category text not null,            -- vacancies, business_media, tenders, direct_demand, global_startups, vendor_exit
  factory text not null default 'consulting',  -- consulting or foundry
  enabled boolean not null default true,
  scrape_method text not null default 'scrape', -- 'scrape' (Firecrawl scrape URL) or 'search' (Firecrawl search query)
  created_at timestamptz default now()
);
```

### Default sources (seeded on migration)

**Vacancies (company needs automation help):**
| name | url_template | scrape_method |
|------|-------------|--------------|
| hh.ru: автоматизация | `https://hh.ru/search/vacancy?text=автоматизация+бизнес-процессов&area=113&period=1` | scrape |
| hh.ru: AI/ML | `https://hh.ru/search/vacancy?text=внедрение+AI+искусственный+интеллект&area=113&period=1` | scrape |
| hh.ru: цифровая трансформация | `https://hh.ru/search/vacancy?text=цифровая+трансформация&area=113&period=1` | scrape |
| superjob: автоматизация | `https://www.superjob.ru/vacancy/search/?keywords=автоматизация+бизнес` | scrape |
| habr career: AI | `https://career.habr.com/vacancies?q=AI+автоматизация&type=all` | scrape |

**Business media (news, cases, pain points):**
| name | url_template | scrape_method |
|------|-------------|--------------|
| vc.ru свежее | `https://vc.ru/new` | scrape |
| rb.ru стартапы | `https://rb.ru/news/` | scrape |
| habr: автоматизация | `https://habr.com/ru/search/?q=автоматизация+бизнес&target_type=posts&order=date` | scrape |
| kommersant tech | `https://www.kommersant.ru/rubric/4` | scrape |
| rbc technology | `https://www.rbc.ru/technology_and_media/` | scrape |
| cnews.ru | `https://www.cnews.ru/news/top` | scrape |
| tadviser.ru | `https://www.tadviser.ru/index.php/Статья:Новости` | scrape |

**Tenders:**
| name | url_template | scrape_method |
|------|-------------|--------------|
| zakupki AI | `тендер закупка искусственный интеллект автоматизация 2026` | search |

**Direct demand:**
| name | url_template | scrape_method |
|------|-------------|--------------|
| avito: автоматизация | `https://www.avito.ru/rossiya/predlozheniya_uslug?q=автоматизация+бизнес` | scrape |
| fl.ru: AI проекты | `ищу подрядчика AI автоматизация чат-бот разработка Россия` | search |
| kwork: автоматизация | `https://kwork.ru/projects?c=all&attr=211&query=автоматизация` | scrape |

**Vendor exit / import substitution:**
| name | url_template | scrape_method |
|------|-------------|--------------|
| уход вендоров | `уход зарубежного сервиса замена CRM ERP Россия 2026` | search |

**Global startups (for Foundry):**
| name | url_template | scrape_method |
|------|-------------|--------------|
| ProductHunt AI | `AI startup launched this week ProductHunt 2026` | search |
| HackerNews Show HN | `https://news.ycombinator.com/show` | scrape |

### Admin UI

- Table view of all sources with enabled/disabled toggle
- "Add source" button: name + URL or query + category + scrape_method
- "Test" button per source: runs single scrape, shows raw result
- No code deploy needed to add/remove sources

## 3. Scout — Targeted Scraping

### What changes

**Input:** loads all `enabled` sources from `scout_sources` table.

**Scraping:** for each source:
- `scrape_method = 'scrape'`: Firecrawl scrape of the exact URL → markdown content
- `scrape_method = 'search'`: Firecrawl search with query → search results

**Processing:** all scraped content passed to GPT in one call with instruction:
- Extract concrete signals from REAL data only
- Each signal MUST have a source URL
- If no real data → return empty array (DO NOT generate from AI knowledge)
- Max 8 signals per run
- Blacklist: skip companies from rejected leads list

**Removed:**
- Self-optimization ("find MAXIMUM", "expand interpretation")
- AI-generated signals when Firecrawl returns nothing
- Foundry queries mixed into consulting scout (separate factory)
- KPI pressure prompts

### Output: `signals` table (unchanged schema)

Each signal has: company_name (nullable), description, signal_type, industry, source (URL), potential, status='new'.

## 4. Analyst — Dedup + Blacklist

### What changes

**Blacklist loading:**
- Loads last 100 rejected leads (`status = 'rejected'`) from `leads` table
- Extracts company names → passes to GPT: "These companies were rejected by Denis — DO NOT create insights for them"

**Dedup before creation:**
- Loads last 200 insights
- GPT receives list of existing insight titles + companies
- Instruction: "DO NOT duplicate these topics. One signal = max one insight."

**Quality gate:**
- Each insight MUST contain: specific company OR specific industry + concrete pain + why now
- Abstract insights ("trend towards automation") → automatic reject

**Removed:**
- Self-optimization ("lower threshold", "take more signals")
- Multiple insights from one signal
- KPI pressure prompts

### Output: `insights` table (unchanged schema)

## 5. Marketer — Dedup + Level A Only

### What changes

**Lead dedup (new):**
- Before creating any lead, loads last 200 leads (any status except rejected)
- Checks `company_name` — if company already has a lead → skip
- Also deduplicates within same batch (prevents 4x BLACKHUB GAMES)

**Level A only:**
- Only creates leads with: company + contact name + contact channel + outreach message
- Level B (company without contact) → REMOVED. If no contact found → returns insight to analyst with reason
- No lead created without a verified contact from search results

**Mandatory website scrape:**
- Before generating outreach, Firecrawl scrapes the company website
- Outreach personalized from real website content (products, team, news)
- No scrape → no outreach → no lead

**Anti-hallucination (existing, kept):**
- Contact name must appear in search results
- Contact channel must appear in search results

**Removed:**
- Self-optimization ("MINIMUM 60% must become leads")
- Level B leads (needs_contact status)
- KPI pressure prompts

### Output: `leads` table

Only status `pending_approval` with full outreach ready to send.

## 6. Chain Runner — Simple Orchestration

### What changes

**Schedule:** 3 runs per day (morning, lunch, evening) via Supabase cron.

**Each run:**
1. Load blacklist (rejected company names from `leads` where `status = 'rejected'`)
2. Call Scout → wait for completion
3. Call Analyst → wait for completion
4. Call Marketer → wait for completion
5. Log result: signals created → insights created → leads created

**Removed:**
- Adaptive feedback to agents
- KPI gap calculation
- Self-optimization prompts
- Feedback insertion to `agent_feedback` table

### Blacklist passed to each agent

```json
{
  "blacklist_companies": ["BLACKHUB GAMES", "Company X", ...],
  "triggered_by": "cron",
  "factory": "consulting"
}
```

## 7. Cost Estimate

Per run (3x/day = 9 runs/day... no, chain runs 3x, each chain = 1 scout + 1 analyst + 1 marketer):

| Component | Per chain run | 3x/day | Monthly |
|-----------|-------------|--------|---------|
| Firecrawl scrape (~15 sources) | $0.15 | $0.45 | ~$14 |
| Firecrawl search (~3 queries) | $0.03 | $0.09 | ~$3 |
| Firecrawl scrape (marketer, ~5 company sites) | $0.05 | $0.15 | ~$5 |
| OpenAI gpt-5.2 (scout) | $0.05 | $0.15 | ~$5 |
| OpenAI gpt-5.2 (analyst) | $0.03 | $0.09 | ~$3 |
| OpenAI gpt-5.2 (marketer) | $0.05 | $0.15 | ~$5 |
| **Total** | **~$0.36** | **~$1.08** | **~$35** |

Well within $50-60 budget.

## 8. Migration Plan

1. Create `scout_sources` table + seed default sources
2. Update `scout-run` — load sources from DB, remove self-optimization
3. Update `analyst-run` — add blacklist + dedup
4. Update `marketer-run` — add company dedup, remove Level B, mandatory scrape
5. Update `chain-runner` — simplify to sequential calls with blacklist
6. Add admin UI for managing sources (table + toggle + add + test)
7. Deploy all Edge Functions

## 9. Out of Scope

- Foundry Factory redesign (separate project)
- Email sending automation (manual approve + send stays)
- Hunter.io or other email verification APIs
- Telegram channel scraping
- hh.ru official API integration (Firecrawl scrape is sufficient for now)
