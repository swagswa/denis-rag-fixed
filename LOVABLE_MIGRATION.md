# Промпт для переноса проекта в Lovable

Скопируй этот текст в Lovable при импорте/настройке проекта:

---

## КРИТИЧЕСКИ ВАЖНО: НЕ МЕНЯТЬ КЛЮЧИ И КОНФИГУРАЦИЮ

При импорте этого проекта из GitHub (https://github.com/swagswa/denis-rag-fixed) соблюдай следующие правила:

### 1. НЕ ТРОГАЙ файл `src/lib/supabase.ts`

Этот файл содержит правильные Supabase ключи через env vars с JWT fallback:
```typescript
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://kuodvlyepoojqimutmvu.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJ...'
```

**НЕ ЗАМЕНЯЙ** эти ключи на `sb_publishable_...` формат. Supabase требует JWT-токены (начинаются с `eyJ`). Замена на `sb_publishable_` ломает:
- Чат-виджет на всех сайтах
- Загрузку system prompt из базы
- Авторизацию к Edge Functions
- Весь функционал ассистентов

### 2. НЕ ТРОГАЙ файл `.env`

Переменные окружения уже настроены:
```
VITE_SUPABASE_URL=https://kuodvlyepoojqimutmvu.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ... (JWT anon key)
SUPABASE_SERVICE_ROLE_KEY=eyJ... (JWT service role key)
```

НЕ перезаписывай эти значения. Если Lovable предлагает "подключить Supabase" — откажись или убедись что ключи остались в JWT-формате.

### 3. НЕ ТРОГАЙ Edge Functions (`supabase/functions/`)

Все Edge Functions уже задеплоены на Supabase и работают. Lovable НЕ должен их модифицировать, переименовывать или передеплоивать. Список функций:
- scout-run, analyst-run, marketer-run, builder-run
- chain-runner, chat, notify-owner, prompt-refine
- send-outreach, speech-to-text, widget-loader

### 4. НЕ ТРОГАЙ SQL миграции (`supabase/migrations/`)

База данных уже настроена с правильными таблицами и индексами. Lovable НЕ должен запускать миграции повторно.

### 5. Что МОЖНО менять

- UI компоненты в `src/components/` и `src/pages/`
- Стили (Tailwind, CSS)
- Роутинг
- Новые страницы и компоненты

### Архитектура проекта

- **Frontend**: Vite + React + TypeScript + Tailwind + shadcn/ui
- **Backend**: Supabase Edge Functions (Deno) — уже задеплоены
- **Database**: Supabase PostgreSQL — уже настроена
- **AI**: OpenAI GPT-5.2 (scout, analyst, marketer, builder), GPT-4o-mini (chat)
- **Поиск**: Firecrawl API

### Ключевые файлы которые НЕЛЬЗЯ менять

| Файл | Причина |
|------|---------|
| `src/lib/supabase.ts` | Правильные JWT ключи |
| `src/lib/api.ts` | edgeFetch с авторизацией |
| `src/lib/chat-stream.ts` | Стриминг чата с правильными хедерами |
| `.env` | Переменные окружения |
| `supabase/functions/**` | Задеплоенные Edge Functions |
| `supabase/migrations/**` | Применённые миграции |

---

Если что-то сломалось после импорта — первым делом проверь что `SUPABASE_PUBLISHABLE_KEY` в `src/lib/supabase.ts` начинается с `eyJ`, а не с `sb_publishable_`.
