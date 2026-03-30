-- Обновление KPI под бизнес-цели
-- Consulting: 10 qualified leads/мес, 2 продажи/мес
-- Foundry: 1 запущенный проект/мес с прибылью 200К₽
-- Ассистент: 10 лидов/мес (согласие на диалог с Денисом)

DELETE FROM public.agent_kpi;

INSERT INTO public.agent_kpi (factory, metric, target, current, period) VALUES
  -- ═══ CONSULTING FACTORY ═══
  -- Бизнес-цели:
  ('consulting', 'sales_per_month', 2, 0, 'month'),
  ('consulting', 'qualified_leads_per_month', 10, 0, 'month'),
  -- Операционные (подчинены бизнес-целям):
  ('consulting', 'leads_per_day', 3, 0, 'day'),
  ('consulting', 'insights_per_day', 15, 0, 'day'),
  ('consulting', 'signals_per_day', 30, 0, 'day'),

  -- ═══ FOUNDRY FACTORY ═══
  -- Бизнес-цель:
  ('foundry', 'launched_projects_per_month', 1, 0, 'month'),
  -- Операционные:
  ('foundry', 'opportunities_per_month', 3, 0, 'month'),
  ('foundry', 'insights_per_day', 5, 0, 'day'),
  ('foundry', 'signals_per_day', 15, 0, 'day'),

  -- ═══ АССИСТЕНТ ═══
  ('assistant', 'leads_per_month', 10, 0, 'month');

-- Обновить функцию подсчёта KPI
CREATE OR REPLACE FUNCTION public.update_agent_kpi()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Consulting: продажи/мес
  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.leads
    WHERE created_at > date_trunc('month', now()) AND status = 'converted'
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'sales_per_month';

  -- Consulting: qualified leads/мес (ответили, ведут диалог)
  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.leads
    WHERE created_at > date_trunc('month', now()) AND status IN ('qualified', 'converted')
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'qualified_leads_per_month';

  -- Consulting: лиды/день
  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.leads
    WHERE created_at > now() - interval '1 day'
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'leads_per_day';

  -- Consulting: инсайты/день
  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.insights
    WHERE created_at > now() - interval '1 day' AND opportunity_type = 'consulting'
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'insights_per_day';

  -- Consulting: сигналы/день
  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.signals
    WHERE created_at > now() - interval '1 day' AND potential = 'consulting'
  ), updated_at = now() WHERE factory = 'consulting' AND metric = 'signals_per_day';

  -- Foundry: запущенные проекты/мес
  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.startup_opportunities
    WHERE created_at > date_trunc('month', now()) AND status = 'launched'
  ), updated_at = now() WHERE factory = 'foundry' AND metric = 'launched_projects_per_month';

  -- Foundry: opportunities/мес
  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.startup_opportunities
    WHERE created_at > date_trunc('month', now())
  ), updated_at = now() WHERE factory = 'foundry' AND metric = 'opportunities_per_month';

  -- Foundry: инсайты/день
  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.insights
    WHERE created_at > now() - interval '1 day' AND opportunity_type = 'foundry'
  ), updated_at = now() WHERE factory = 'foundry' AND metric = 'insights_per_day';

  -- Foundry: сигналы/день
  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.signals
    WHERE created_at > now() - interval '1 day' AND potential = 'foundry'
  ), updated_at = now() WHERE factory = 'foundry' AND metric = 'signals_per_day';

  -- Ассистент: лиды/мес
  UPDATE public.agent_kpi SET current = (
    SELECT count(*) FROM public.leads
    WHERE created_at > date_trunc('month', now()) AND source = 'assistant'
  ), updated_at = now() WHERE factory = 'assistant' AND metric = 'leads_per_month';
END;
$$;
