-- Performance indexes for agent pipeline queries
CREATE INDEX IF NOT EXISTS idx_signals_status ON public.signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_potential ON public.signals(potential);
CREATE INDEX IF NOT EXISTS idx_signals_status_potential ON public.signals(status, potential);
CREATE INDEX IF NOT EXISTS idx_insights_status ON public.insights(status);
CREATE INDEX IF NOT EXISTS idx_insights_signal_id ON public.insights(signal_id);
CREATE INDEX IF NOT EXISTS idx_insights_opportunity_type ON public.insights(opportunity_type);
CREATE INDEX IF NOT EXISTS idx_insights_status_type ON public.insights(status, opportunity_type);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_to_agent_resolved ON public.agent_feedback(to_agent, resolved);
CREATE INDEX IF NOT EXISTS idx_agent_kpi_active ON public.agent_kpi(active);
