
-- ═══ SIGNALS (от скаута) ═══
CREATE TABLE IF NOT EXISTS public.signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text,
  description text NOT NULL DEFAULT '',
  signal_type text NOT NULL DEFAULT 'trend',
  industry text,
  source text,
  potential text DEFAULT 'consulting',
  status text NOT NULL DEFAULT 'new',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ═══ INSIGHTS (от аналитика) ═══
CREATE TABLE IF NOT EXISTS public.insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  company_name text,
  what_happens text,
  why_important text,
  problem text,
  action_proposal text,
  opportunity_type text DEFAULT 'consulting',
  status text NOT NULL DEFAULT 'new',
  notes text,
  signal_id uuid REFERENCES public.signals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ═══ LEADS (от маркетолога) ═══
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text,
  name text,
  role text,
  message text,
  lead_summary text,
  topic_guess text,
  status text NOT NULL DEFAULT 'pending_approval',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ═══ STARTUP_OPPORTUNITIES (от билдера) ═══
CREATE TABLE IF NOT EXISTS public.startup_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea text,
  problem text,
  solution text,
  source text,
  market text,
  monetization text,
  complexity text DEFAULT 'medium',
  revenue_estimate numeric DEFAULT 0,
  notes text,
  stage text DEFAULT 'pending_approval',
  insight_id uuid REFERENCES public.insights(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ═══ FACTORY_FLOWS (настройки заводов) ═══
CREATE TABLE IF NOT EXISTS public.factory_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory text NOT NULL DEFAULT 'consulting',
  status text NOT NULL DEFAULT 'active',
  target_company_size text DEFAULT '5-500',
  target_region text DEFAULT 'РФ/СНГ',
  target_industry text,
  target_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ═══ AGENT_FEEDBACK (обратная связь между агентами) ═══
CREATE TABLE IF NOT EXISTS public.agent_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory text,
  from_agent text,
  to_agent text,
  feedback_type text,
  content text,
  signal_id uuid,
  insight_id uuid,
  resolved boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ═══ AGENT_KPI (целевые KPI агентов) ═══
CREATE TABLE IF NOT EXISTS public.agent_kpi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory text,
  metric text,
  target numeric DEFAULT 0,
  current numeric DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ═══ ASSISTANT_PROMPTS (промты для чат-ассистента) ═══
CREATE TABLE IF NOT EXISTS public.assistant_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL,
  system_prompt text,
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ═══ CONVERSATIONS (история чатов) ═══
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text,
  visitor_id text,
  messages jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ═══ НАЧАЛЬНЫЕ ДАННЫЕ ═══
INSERT INTO public.factory_flows (factory, status, target_company_size, target_region, target_industry)
VALUES 
  ('consulting', 'active', '5-500', 'РФ/СНГ', 'IT, маркетинг, e-com, логистика'),
  ('foundry', 'active', '5-500', 'РФ/СНГ', 'e-com, маркетплейсы, AI-сервисы');

INSERT INTO public.agent_kpi (factory, metric, target, current)
VALUES
  ('consulting', 'signals_per_week', 50, 0),
  ('consulting', 'insights_per_week', 20, 0),
  ('consulting', 'leads_per_week', 10, 0),
  ('foundry', 'signals_per_week', 30, 0),
  ('foundry', 'ideas_per_week', 5, 0);

-- RLS
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.startup_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factory_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_kpi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_signals" ON public.signals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_insights" ON public.insights FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_leads" ON public.leads FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_opportunities" ON public.startup_opportunities FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_flows" ON public.factory_flows FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_feedback" ON public.agent_feedback FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_kpi" ON public.agent_kpi FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_prompts" ON public.assistant_prompts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_conversations" ON public.conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_prompts" ON public.assistant_prompts FOR SELECT TO anon USING (true);
CREATE POLICY "anon_all_conversations" ON public.conversations FOR ALL TO anon USING (true) WITH CHECK (true);
