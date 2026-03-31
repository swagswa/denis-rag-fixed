import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MessageSquare } from 'lucide-react'
import { classifyAssistantSite, getAssistantSiteLabelByKey, type AssistantSiteKey } from '@/lib/assistant-site'

interface SiteStats {
  site: AssistantSiteKey
  label: string
  sessions: number
  messages: number
}

export function AssistantStats() {
  const [sites, setSites] = useState<SiteStats[]>([])
  const [total, setTotal] = useState(0)
  const [today, setToday] = useState(0)
  const [totalLeads, setTotalLeads] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: chats } = await supabase
        .from('conversations')
        .select('id, page, session_id, created_at, user_message')

      const allChats = chats || []

      // Count unique sessions where client left contact info or asked to connect
      const contactPattern = /(\+7|8[\s\-\(]\d)|@[a-zA-Z0-9_]{4,}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|свяж|позвон|перезвон|напиш.*мн|связат|call.*me|contact/i
      const leadSessions = new Set(
        allChats
          .filter(c => c.user_message && contactPattern.test(c.user_message))
          .map(c => c.session_id)
          .filter(Boolean)
      )
      setTotalLeads(leadSessions.size)

      const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0)
      const todayStr = todayDate.toISOString()

      const allSessions = new Set(allChats.map(c => c.session_id).filter(Boolean))
      setTotal(allSessions.size)

      const todaySessions = new Set(allChats.filter(c => c.created_at >= todayStr).map(c => c.session_id).filter(Boolean))
      setToday(todaySessions.size)

      const trackedSites: AssistantSiteKey[] = ['foundry', 'denismateev', 'aisovetnik', 'aitransformation', 'twin', 'preview']

      const siteStats: SiteStats[] = trackedSites.map(site => {
        const matched = allChats.filter(c => classifyAssistantSite(c.page) === site)
        const sessions = new Set(matched.map(c => c.session_id).filter(Boolean))
        return { site, label: getAssistantSiteLabelByKey(site), sessions: sessions.size, messages: matched.length }
      })

      setSites(siteStats)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>

  const conversionRate = total > 0 ? ((totalLeads / total) * 100).toFixed(1) : '0'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">Ассистент — Статистика</h2>
        <p className="mt-1 text-sm text-muted-foreground">Диалоги считаются по сессиям, лиды — сессии, где клиент оставил контакт или попросил связаться</p>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Всего диалогов" value={total} />
        <StatCard label="Сегодня" value={today} highlight />
        <StatCard label="Лиды из чатов" value={totalLeads} />
        <StatCard label="Конверсия" value={`${conversionRate}%`} highlight />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sites.map(site => (
          <div key={site.site} className="rounded-xl border border-border bg-card p-5 text-card-foreground">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-foreground">{site.label}</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-secondary p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{site.sessions}</p>
                <p className="text-[10px] text-muted-foreground">Сессий</p>
              </div>
              <div className="rounded-lg border border-border bg-secondary p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{site.messages}</p>
                <p className="text-[10px] text-muted-foreground">Сообщений</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-center text-card-foreground">
      <p className={`text-2xl font-bold ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
