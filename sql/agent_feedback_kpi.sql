-- ═══ ТАБЛИЦА 1: agent_feedback — обратная связь между агентами ═══
CREATE TABLE IF NOT EXISTS public.agent_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory text NOT NULL CHECK (factory IN ('consulting', 'foundry')),
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
  factory text NOT NULL CHECK (factory IN ('consulting', 'foundry')),
  metric text NOT NULL,
  target integer NOT NULL,
  current integer DEFAULT 0,
  period text DEFAULT 'week',
  active boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.agent_kpi ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON public.agent_kpi
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Начальные KPI
INSERT INTO public.agent_kpi (factory, metric, target, current, period) VALUES
  ('consulting', 'leads_per_week', 5, 0, 'week'),
  ('consulting', 'signals_per_day', 10, 0, 'day'),
  ('consulting', 'insights_per_day', 5, 0, 'day'),
  ('foundry', 'opportunities_per_week', 3, 0, 'week'),
  ('foundry', 'signals_per_day', 7, 0, 'day'),
  ('foundry', 'insights_per_day', 3, 0, 'day');

-- Функция автообновления KPI
CREATE OR REPLACE FUNCTION public.update_agent_kpi()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.leads WHERE created_at > now() - interval '7 days' AND status IN ('pending_approval', 'approved')
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'leads_per_week';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.signals WHERE created_at > now() - interval '1 day' AND potential = 'consulting'
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'signals_per_day';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.insights WHERE created_at > now() - interval '1 day' AND opportunity_type = 'consulting'
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'insights_per_day';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.startup_opportunities WHERE created_at > now() - interval '7 days'
  ), updated_at = now() WHERE factory = 'foundry' AND metric = 'opportunities_per_week';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.signals WHERE created_at > now() - interval '1 day' AND potential = 'foundry'
  ), updated_at = now() WHERE factory = 'foundry' AND metric = 'signals_per_day';

  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.insights WHERE created_at > now() - interval '1 day' AND opportunity_type = 'foundry'
  ), updated_at = now() WHERE factory = 'foundry' AND metric = 'insights_per_day';
END;
$$;
