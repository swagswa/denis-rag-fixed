import { LayoutDashboard, Search, FileText, Settings, LogOut, Handshake, Rocket, Bot, UsersRound, Briefcase, MessageSquare, ChevronRight, ChevronDown, Database, Lightbulb, ShoppingCart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'

export type PageKey =
  | 'dashboard' | 'search' | 'documents' | 'settings'
  | 'twin-dashboard' | 'twin-teams'
  | 'consulting-scout' | 'consulting-analyst' | 'consulting-marketer' | 'consulting-closer'
  | 'foundry-scout' | 'foundry-analyst' | 'foundry-builder'
  | 'twin-cases' | 'twin-settings' | 'twin-leads' | 'twin-opportunities'
  | 'twin-assistant'
  | 'assistant-stats' | 'assistant-dialogs' | 'assistant-prompt'

interface NavItem {
  key: PageKey
  label: string
  icon: typeof LayoutDashboard
}

interface NavGroup {
  title: string
  icon?: typeof LayoutDashboard
  collapsible?: boolean
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    title: 'Интерфейсы',
    icon: Bot,
    collapsible: false,
    items: [
      { key: 'twin-dashboard', label: 'Дашборд', icon: LayoutDashboard },
      { key: 'twin-teams', label: 'Команды', icon: UsersRound },
    ],
  },
  {
    title: 'Consulting Factory',
    icon: Handshake,
    collapsible: true,
    items: [
      { key: 'consulting-scout', label: 'Скаут', icon: Search },
      { key: 'consulting-analyst', label: 'Аналитик', icon: Lightbulb },
      { key: 'consulting-marketer', label: 'Маркетолог', icon: MessageSquare },
      { key: 'consulting-closer', label: 'Продавец', icon: ShoppingCart },
    ],
  },
  {
    title: 'Foundry Factory',
    icon: Rocket,
    collapsible: true,
    items: [
      { key: 'foundry-scout', label: 'Скаут', icon: Search },
      { key: 'foundry-analyst', label: 'Аналитик', icon: Lightbulb },
      { key: 'foundry-builder', label: 'Создатель', icon: Rocket },
    ],
  },
  {
    title: 'Ассистент',
    icon: MessageSquare,
    collapsible: true,
    items: [
      { key: 'assistant-stats', label: 'Статистика', icon: LayoutDashboard },
      { key: 'assistant-dialogs', label: 'Диалоги', icon: MessageSquare },
      { key: 'assistant-prompt', label: 'Промпт', icon: Settings },
    ],
  },
  {
    title: 'Система',
    icon: Settings,
    collapsible: true,
    items: [
      { key: 'dashboard', label: 'Обзор', icon: Database },
      { key: 'twin-cases', label: 'Кейсы', icon: Briefcase },
      { key: 'documents', label: 'Документы', icon: FileText },
      { key: 'settings', label: 'Настройки', icon: Settings },
    ],
  },
]

interface SidebarProps {
  currentPage: PageKey
  onNavigate: (page: PageKey) => void
  userEmail?: string
  onLogout: () => void
}

export function Sidebar({ currentPage, onNavigate, userEmail, onLogout }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggleGroup = (title: string) => {
    setCollapsed(prev => ({ ...prev, [title]: !prev[title] }))
  }

  const isGroupActive = (group: NavGroup) =>
    group.items.some(item => item.key === currentPage)

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-slate-950 overflow-y-auto">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 px-5 shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-[11px] font-bold tracking-wider text-white">
          D
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-slate-100">
          DWH
        </span>
        <span className="ml-auto rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
          beta
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {navGroups.map((group, gi) => {
          const groupActive = isGroupActive(group)
          const isCollapsed = group.collapsible && collapsed[group.title] && !groupActive

          return (
            <div key={gi} className={gi > 0 ? 'pt-3' : ''}>
              {group.title && (
                group.collapsible ? (
                  <button
                    onClick={() => toggleGroup(group.title)}
                    className={cn(
                      'flex items-center justify-between w-full px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition-colors',
                      groupActive ? 'text-blue-400' : 'text-slate-500 hover:text-slate-400',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      {group.icon && <group.icon className="h-3 w-3" />}
                      {group.title}
                    </span>
                    {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                ) : (
                  <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {group.title}
                  </p>
                )
              )}
              {!isCollapsed && group.items.map(({ key, label, icon: Icon }) => {
                const active = currentPage === key
                return (
                  <button
                    key={key}
                    onClick={() => onNavigate(key)}
                    className={cn(
                      'group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
                      active
                        ? 'bg-slate-800 text-slate-50'
                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200',
                    )}
                  >
                    {active && (
                      <div className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-blue-500" />
                    )}
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* User section */}
      <div className="px-3 py-3 shrink-0">
        {userEmail && (
          <p className="mb-2 truncate px-3 text-xs text-slate-500" title={userEmail}>
            {userEmail}
          </p>
        )}
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors duration-150 hover:bg-slate-800/50 hover:text-slate-200"
        >
          <LogOut className="h-4 w-4" />
          Выйти
        </button>
      </div>
    </aside>
  )
}
