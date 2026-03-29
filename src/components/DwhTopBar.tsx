import { Search } from 'lucide-react'
import type { PageKey } from './DwhSidebar'

const pageTitles: Partial<Record<PageKey, string>> = {
  dashboard: 'Обзор',
  search: 'Поиск',
  documents: 'Документы',
  settings: 'Настройки',
  'twin-dashboard': 'Дашборд',
  'twin-teams': 'Команды',
  'twin-assistant': 'Ассистент',
  'consulting-scout': 'Скаут — Consulting',
  'consulting-analyst': 'Аналитик — Consulting',
  'consulting-marketer': 'Маркетолог — Consulting',
  'consulting-closer': 'Продавец — Consulting',
  'foundry-scout': 'Скаут — Foundry',
  'foundry-analyst': 'Аналитик — Foundry',
  'foundry-builder': 'Создатель — Foundry',
  'twin-cases': 'Кейсы',
  'twin-settings': 'Настройки Twin',
  'twin-leads': 'Лиды',
  'twin-opportunities': 'Проекты',
  'assistant-stats': 'Ассистент — Статистика',
  'assistant-dialogs': 'Ассистент — Диалоги',
}

interface TopBarProps {
  currentPage: PageKey
  onNavigate: (page: PageKey) => void
}

export function TopBar({ currentPage, onNavigate }: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-slate-950/80 px-6 backdrop-blur-md">
      <h1 className="text-sm font-semibold text-slate-100">
        {pageTitles[currentPage]}
      </h1>

      <button
        onClick={() => onNavigate('search')}
        className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-slate-500 transition-colors duration-150 hover:bg-slate-800 hover:text-slate-400"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Поиск...</span>
        <kbd className="ml-4 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
          /
        </kbd>
      </button>
    </header>
  )
}
