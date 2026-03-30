-- ═══ CRON РАСПИСАНИЕ ДЛЯ АВТОЗАПУСКА АГЕНТОВ ═══
-- Выполни этот SQL в Supabase SQL Editor
-- Требует расширение pg_cron (включено по умолчанию в Supabase)

-- Включить расширение если не включено
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ═══ Consulting Factory: каждые 30 минут ═══
-- scout → analyst → marketer (последовательно через chain-runner)
SELECT cron.schedule(
  'consulting-chain',
  '*/30 * * * *',  -- каждые 30 минут
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/chain-runner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"factory": "consulting", "triggered_by": "cron"}'::jsonb
  );
  $$
);

-- ═══ Foundry Factory: каждый час ═══
SELECT cron.schedule(
  'foundry-chain',
  '0 * * * *',  -- каждый час
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/chain-runner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"factory": "foundry", "triggered_by": "cron"}'::jsonb
  );
  $$
);

-- ═══ KPI обновление: каждые 15 минут ═══
SELECT cron.schedule(
  'update-kpi',
  '*/15 * * * *',
  $$ SELECT public.update_agent_kpi(); $$
);

-- ═══ Для просмотра cron задач: ═══
-- SELECT * FROM cron.job;

-- ═══ Для удаления задачи: ═══
-- SELECT cron.unschedule('consulting-chain');

-- ═══ АЛЬТЕРНАТИВНЫЙ ВАРИАНТ (если pg_net не настроен): ═══
-- Используй внешний cron (например, cron-job.org или GitHub Actions)
-- который вызывает:
-- POST https://YOUR_PROJECT.supabase.co/functions/v1/chain-runner
-- Headers: Authorization: Bearer YOUR_ANON_KEY, apikey: YOUR_ANON_KEY
-- Body: {"factory": "consulting", "triggered_by": "cron"}
