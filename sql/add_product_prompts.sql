-- Добавляем столбец product_prompts в таблицу settings
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS product_prompts jsonb DEFAULT '{}'::jsonb;
