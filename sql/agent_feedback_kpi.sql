-- ═══ ТАБЛИЦА 1: agent_feedback — обратная связь между агентами ═══
CREATE TABLE IF NOT EXISTS public.agent_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory text NOT NULL CHECK (factory IN ('consulting', 'foundry', 'assistant')),
  from_agent text NOT NULL,
  to_agent text NOT NULL,
  feedback_type text NOT NULL,
  content text NOT NULL,
  insight_id uuid,
  signal_id uuid,
  resolved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.agent_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON public.agent_feedback
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ ТАБЛИЦА 2: agent_kpi — цели и метрики ═══
CREATE TABLE IF NOT EXISTS public.agent_kpi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory text NOT NULL CHECK (factory IN ('consulting', 'foundry', 'assistant')),
  metric text NOT NULL,
  target integer NOT NULL,
  current integer DEFAULT 0,
  period text DEFAULT 'month',
  active boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.agent_kpi ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON public.agent_kpi
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Бизнес-KPI (все агентские метрики подчинены этим целям)
INSERT INTO public.agent_kpi (factory, metric, target, current, period) VALUES
  -- CONSULTING: 10 qualified leads/мес, 2 продажи/мес
  ('consulting', 'sales_per_month', 2, 0, 'month'),
  ('consulting', 'qualified_leads_per_month', 10, 0, 'month'),
  ('consulting', 'leads_per_day', 3, 0, 'day'),
  ('consulting', 'insights_per_day', 15, 0, 'day'),
  ('consulting', 'signals_per_day', 30, 0, 'day'),
  -- FOUNDRY: 1 запущенный проект/мес с прибылью 200К₽
  ('foundry', 'launched_projects_per_month', 1, 0, 'month'),
  ('foundry', 'opportunities_per_month', 3, 0, 'month'),
  ('foundry', 'insights_per_day', 5, 0, 'day'),
  ('foundry', 'signals_per_day', 15, 0, 'day'),
  -- АССИСТЕНТ: 10 лидов/мес (согласие на диалог с Денисом)
  ('assistant', 'leads_per_month', 10, 0, 'month');

-- Функция автообновления KPI
CREATE OR REPLACE FUNCTION public.update_agent_kpi()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.leads
    WHERE created_at > date_trunc('month', now()) AND status = 'converted'
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'sales_per_month';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.leads
    WHERE created_at > date_trunc('month', now()) AND status IN ('qualified', 'converted')
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'qualified_leads_per_month';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.leads WHERE created_at > now() - interval '1 day'
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'leads_per_day';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.insights
    WHERE created_at > now() - interval '1 day' AND opportunity_type = 'consulting'
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'insights_per_day';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.signals
    WHERE created_at > now() - interval '1 day' AND potential = 'consulting'
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'signals_per_day';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.startup_opportunities
    WHERE created_at > date_trunc('month', now()) AND status = 'launched'
  ), updated_at = now() WHERE factory = 'foundry' AND metric = 'launched_projects_per_month';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.startup_opportunities
    WHERE created_at > date_trunc('month', now())
  ), updated_at = now() WHERE factory = 'foundry' AND metric = 'opportunities_per_month';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.insights
    WHERE created_at > now() - interval '1 day' AND opportunity_type = 'foundry'
  ), updated_at = now() WHERE factory = 'foundry' AND metric = 'insights_per_day';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.signals
    WHERE created_at > now() - interval '1 day' AND potential = 'foundry'
  ), updated_at = now() WHERE factory = 'foundry' AND metric = 'signals_per_day';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.leads
    WHERE created_at > date_trunc('month', now()) AND source = 'assistant'
  ), updated_at = now() WHERE factory = 'assistant' AND metric = 'leads_per_month';
END;
$$;
