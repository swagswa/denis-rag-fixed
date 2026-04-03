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
