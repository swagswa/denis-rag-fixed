import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ChevronDown, MessageSquare } from 'lucide-react'
import { classifyAssistantSite, getAssistantSiteLabel, getAssistantSiteLabelByKey, getAssistantSiteOrder, type AssistantSiteKey } from '@/lib/assistant-site'

interface Chat {
  id: string
  user_message: string
  ai_message: string
  page: string | null
  session_id: string | null
  created_at: string
}

interface ChatGroup {
  id: string
  sessionId: string
  items: Chat[]
  primarySite: AssistantSiteKey
  siteKeys: AssistantSiteKey[]
  startedAt: string
  updatedAt: string
}

const FILTER_TO_SITE: Record<string, AssistantSiteKey | 'all'> = {
  all: 'all',
  foundry: 'foundry',
  dm: 'denismateev',
  sovetnik: 'aisovetnik',
  transform: 'aitransformation',
}

export function AssistantDialogs() {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('conversations')
        .select('id, user_message, ai_message, page, session_id, created_at')
        .order('created_at', { ascending: false })
        .limit(500)
      setChats(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const groups = useMemo<ChatGroup[]>(() => {
    const grouped = new Map<string, Chat[]>()

    chats.forEach(chat => {
      const key = chat.session_id || `single-${chat.id}`
      grouped.set(key, [...(grouped.get(key) || []), chat])
    })

    return Array.from(grouped.entries())
      .map(([sessionId, items]) => {
        const sortedItems = [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        const siteKeys = Array.from(new Set(sortedItems.map(item => classifyAssistantSite(item.page)).filter(site => site !== 'unknown')))
          .sort((a, b) => getAssistantSiteOrder(a) - getAssistantSiteOrder(b))

        return {
          id: sessionId,
          sessionId,
          items: sortedItems,
          primarySite: siteKeys[0] || classifyAssistantSite(sortedItems[sortedItems.length - 1]?.page),
          siteKeys,
          startedAt: sortedItems[0]?.created_at || '',
          updatedAt: sortedItems[sortedItems.length - 1]?.created_at || '',
        }
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [chats])

  const filteredGroups = useMemo(() => {
    const target = FILTER_TO_SITE[filter]
    if (target === 'all') return groups
    return groups.filter(group => group.primarySite === target || group.siteKeys.includes(target))
  }, [filter, groups])

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Диалоги ассистента</h2>
          <p className="mt-1 text-sm text-muted-foreground">{filteredGroups.length} диалогов-сессий, 1 сессия = 1 блок</p>
        </div>
        <div className="flex gap-2">
          {[
            { key: 'all', label: 'Все' },
            { key: 'foundry', label: 'Foundry' },
            { key: 'dm', label: 'DM' },
            { key: 'sovetnik', label: 'Советник' },
            { key: 'transform', label: 'Трансформация' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {filteredGroups.map(group => {
          const isOpen = openId === group.id
          const firstUserMessage = group.items.find(item => item.user_message)?.user_message || 'Без сообщения'
          const visibleSites = group.siteKeys.length > 0 ? group.siteKeys : [group.primarySite]

          return (
            <div key={group.id} className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
              <button
                type="button"
                onClick={() => setOpenId(prev => prev === group.id ? null : group.id)}
                className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-accent/40"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {visibleSites.map(site => (
                      <span key={site} className="rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground">
                        {getAssistantSiteLabelByKey(site)}
                      </span>
                    ))}
                    <span className="text-[11px] text-muted-foreground">{group.items.length} сообщений</span>
                  </div>
                  <p className="truncate text-sm font-medium text-foreground">{firstUserMessage}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(group.startedAt).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {' · '}
                    сессия {group.sessionId.slice(0, 8)}
                  </p>
                </div>
                <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>

              {isOpen && (
                <div className="space-y-3 border-t border-border px-4 py-4">
                  {group.items.map(item => (
                    <div key={item.id} className="space-y-2">
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                          {item.user_message}
                        </div>
                      </div>
                      <div className="flex justify-start">
                        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">
                          {item.ai_message}
                        </div>
                      </div>
                      <div className="text-right text-[11px] text-muted-foreground">
                        {getAssistantSiteLabel(item.page)} · {new Date(item.created_at).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {filteredGroups.length === 0 && (
          <div className="py-12 text-center">
            <MessageSquare className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Нет диалогов</p>
          </div>
        )}
      </div>
    </div>
  )
}
