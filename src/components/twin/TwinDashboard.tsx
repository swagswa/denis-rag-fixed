import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { AlertCircle, Check, X as XIcon, Eye, Search, Lightbulb, MessageSquare, ShoppingCart, Wrench, ArrowDown, TrendingUp, TrendingDown } from 'lucide-react'
import { toast } from 'sonner'

interface Flow {
  id: string
  factory: string
  name: string
  status: string
  last_run_at: string | null
  last_run_result: Record<string, any> | null
}

interface FunnelStage {
  label: string
  icon: any
  count: number
  target: number
  conversion: string
}

interface PendingItem {
  id: string
  type: 'lead' | 'opportunity'
  title: string
  approvalRequest: string
  details: string
  date: string
}

interface ChatStats {
  total: number
  today: number
  chatLeads: number
  conversionRate: string
}

interface RecentRun {
  id: string
  function_name: string
  status: string
  items_found: number
  metadata: any
}

export function TwinDashboard() {
  const [consultingFunnel, setConsultingFunnel] = useState<FunnelStage[]>([])
  const [foundryFunnel, setFoundryFunnel] = useState<FunnelStage[]>([])
  const [flows, setFlows] = useState<Flow[]>([])
  const [pending, setPending] = useState<PendingItem[]>([])
  const [chatStats, setChatStats] = useState<ChatStats>({ total: 0, today: 0, chatLeads: 0, conversionRate: '0' })
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [bottlenecks, setBottlenecks] = useState<{ factory: string; message: string }[]>([])
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([])

  const loadData = async () => {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const monthISO = monthStart.toISOString()

    const dayOfMonth = new Date().getDate()
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
    const progress = dayOfMonth / daysInMonth

    try {
      const [signalsRes, insightsRes, leadsRes, oppsRes, flowsRes, chatsRes, chatLeadsRes, feedbackRes, runsRes] = await Promise.all([
        supabase.from('signals').select('id, status, potential').gte('created_at', monthISO),
        supabase.from('insights').select('id, status, opportunity_type').gte('created_at', monthISO),
        supabase.from('leads').select('id, status, company_name, name, message, lead_summary, role, created_at, session_id, topic_guess'),
        supabase.from('startup_opportunities').select('id, stage, idea, problem, solution, market, monetization, notes, created_at, revenue_estimate, source'),
        supabase.from('factory_flows').select('id, factory, name, status, last_run_at, last_run_result') as any,
        supabase.from('conversations').select('id, page, session_id, created_at'),
        supabase.from('leads').select('id, session_id').not('session_id', 'is', null),
        supabase.from('agent_feedback' as any).select('factory, content, feedback_type').eq('from_agent', 'chain-runner').eq('resolved', false),
        supabase.from('sync_runs' as any).select('id, function_name, status, items_found, metadata').order('id', { ascending: false }).limit(10),
      ])

      const signals = signalsRes.data || []
      const insights = insightsRes.data || []
      const leadsData = leadsRes.data || []
      const opps = oppsRes.data || []
      const feedback = feedbackRes.data || []
      setRecentRuns((runsRes.data || []) as RecentRun[])

      // ═══ CONSULTING FUNNEL ═══
      const cSignals = signals.filter((s: any) => s.potential === 'consulting' || !s.potential)
      const cInsights = insights.filter((i: any) => i.opportunity_type === 'consulting')
      const cQualified = cInsights.filter((i: any) => i.status === 'qualified' || i.status === 'processed')
      const cReturned = cInsights.filter((i: any) => i.status === 'returned')
      const cLeads = leadsData.filter((l: any) => !l.session_id && (l.topic_guess?.startsWith('insight:') || l.status === 'pending_approval' || l.status === 'approved' || l.status === 'sent'))
      const cPending = leadsData.filter((l: any) => l.status === 'pending_approval')
      const cApproved = leadsData.filter((l: any) => l.status === 'approved' || l.status === 'sent')

      const cTargets = { signals: Math.round(900 * progress), insights: Math.round(450 * progress), leads: Math.round(90 * progress), deals: Math.round(2 * progress) }

      setConsultingFunnel([
        { label: 'Сигналы', icon: Search, count: cSignals.length, target: cTargets.signals, conversion: '—' },
        { label: 'Инсайты', icon: Lightbulb, count: cInsights.length, target: cTargets.insights, conversion: cSignals.length > 0 ? `${(cInsights.length / cSignals.length * 100).toFixed(0)}%` : '—' },
        { label: 'Лиды', icon: MessageSquare, count: cLeads.length, target: cTargets.leads, conversion: cInsights.length > 0 ? `${(cLeads.length / cInsights.length * 100).toFixed(0)}%` : '—' },
        { label: 'Сделки', icon: ShoppingCart, count: cApproved.length, target: cTargets.deals, conversion: cLeads.length > 0 ? `${(cApproved.length / cLeads.length * 100).toFixed(0)}%` : '—' },
      ])

      // ═══ FOUNDRY FUNNEL ═══
      const fSignals = signals.filter((s: any) => s.potential === 'foundry')
      const fInsights = insights.filter((i: any) => i.opportunity_type === 'foundry' || i.opportunity_type === 'innovation_pilot')
      const fQualified = fInsights.filter((i: any) => i.status === 'qualified' || i.status === 'processed')
      const fOpps = opps.filter((o: any) => o.stage !== 'killed')
      const fPendingOpps = opps.filter((o: any) => o.stage === 'opportunity')

      const fTargets = { signals: Math.round(450 * progress), insights: Math.round(150 * progress), opps: Math.round(3 * progress) }

      setFoundryFunnel([
        { label: 'Сигналы', icon: Search, count: fSignals.length, target: fTargets.signals, conversion: '—' },
        { label: 'Инсайты', icon: Lightbulb, count: fInsights.length, target: fTargets.insights, conversion: fSignals.length > 0 ? `${(fInsights.length / fSignals.length * 100).toFixed(0)}%` : '—' },
        { label: 'Проекты', icon: Wrench, count: fOpps.length, target: fTargets.opps, conversion: fInsights.length > 0 ? `${(fOpps.length / fInsights.length * 100).toFixed(0)}%` : '—' },
      ])

      // ═══ BOTTLENECKS from chain-runner feedback ═══
      setBottlenecks(feedback.map((f: any) => ({ factory: f.factory, message: f.content })))

      // ═══ FLOWS ═══
      setFlows((flowsRes.data || []) as Flow[])

      // ═══ PENDING ITEMS ═══
      const pendingItems: PendingItem[] = []
      cPending.forEach((l: any) => pendingItems.push({
        id: l.id, type: 'lead',
        title: l.company_name || l.name || 'Лид',
        approvalRequest: l.lead_summary || 'Маркетолог предлагает outreach. Одобрите?',
        details: l.message || '',
        date: new Date(l.created_at).toLocaleDateString('ru'),
      }))
      fPendingOpps.forEach((o: any) => {
        const notesLines = (o.notes || '').split('\n')
        const requestLine = notesLines.find((l: string) => l.startsWith('✅ ЗАПРОС'))
        pendingItems.push({
          id: o.id, type: 'opportunity',
          title: o.idea || 'Проект',
          approvalRequest: requestLine ? requestLine.replace('✅ ЗАПРОС НА ОДОБРЕНИЕ:', '').trim() : `Создатель предлагает "${o.idea}". Запускаем?`,
          details: o.notes || '',
          date: new Date(o.created_at).toLocaleDateString('ru'),
        })
      })
      setPending(pendingItems)

      // ═══ CHAT STATS ═══
      const chats = chatsRes.data || []
      const chatLeadRows = chatLeadsRes.data || []
      const chatSessionIds = new Set(chats.map((c: any) => c.session_id).filter(Boolean))
      const realChatLeads = chatLeadRows.filter((l: any) => l.session_id && chatSessionIds.has(l.session_id))
      const todayD = new Date(); todayD.setHours(0, 0, 0, 0)
      const todaySessions = new Set(chats.filter((c: any) => c.created_at >= todayD.toISOString()).map((c: any) => c.session_id).filter(Boolean))

      setChatStats({
        total: chatSessionIds.size,
        today: todaySessions.size,
        chatLeads: realChatLeads.length,
        conversionRate: chatSessionIds.size > 0 ? ((realChatLeads.length / chatSessionIds.size) * 100).toFixed(1) : '0',
      })
    } catch (err) {
      console.error('[Dashboard] load error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const toggleFlow = async (flow: Flow) => {
    const newStatus = flow.status === 'active' ? 'paused' : 'active'
    await supabase.from('factory_flows').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', flow.id)
    toast.success(newStatus === 'active' ? '▶ Поток запущен' : '⏸ Поток остановлен')
    loadData()
  }

  const approveLead = async (id: string) => {
    const { error } = await supabase.from('leads').update({ status: 'approved' }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('✅ Outreach одобрен')
    setPending(prev => prev.filter(p => p.id !== id)); loadData()
  }
  const rejectLead = async (id: string) => {
    await supabase.from('leads').update({ status: 'rejected' }).eq('id', id)
    toast.success('Отклонено')
    setPending(prev => prev.filter(p => p.id !== id))
  }
  const approveOpportunity = async (id: string) => {
    await supabase.from('startup_opportunities').update({ stage: 'concept', updated_at: new Date().toISOString() }).eq('id', id)
    toast.success('🚀 Проект одобрен')
    setPending(prev => prev.filter(p => p.id !== id)); loadData()
  }
  const rejectOpportunity = async (id: string) => {
    await supabase.from('startup_opportunities').update({ stage: 'killed' }).eq('id', id)
    toast.success('Проект отклонён')
    setPending(prev => prev.filter(p => p.id !== id))
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" /></div>

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-100">Дашборд</h2>
        <p className="mt-1 text-sm text-slate-500">Воронки обновляются автоматически. Система сама оптимизирует агентов под KPI.</p>
      </div>

      {/* Bottlenecks / Auto-optimization alerts */}
      {bottlenecks.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <h3 className="text-sm font-semibold text-amber-400">⚡ Система обнаружила узкие места</h3>
          {bottlenecks.map((b, i) => (
            <div key={i} className="text-xs text-amber-300/80 flex gap-2">
              <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{b.factory}</span>
              <span>{b.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Factory Funnels */}
      <div className="grid gap-6 lg:grid-cols-2">
        <FunnelCard
          title="🤝 Consulting Factory"
          subtitle="Цель: 2 сделки / 10 лидов в мес"
          stages={consultingFunnel}
          flow={flows.find(f => f.factory === 'consulting')}
          onToggleFlow={toggleFlow}
        />
        <FunnelCard
          title="🚀 Foundry Factory"
          subtitle="Цель: 1 проект / 200К ₽ в мес"
          stages={foundryFunnel}
          flow={flows.find(f => f.factory === 'foundry')}
          onToggleFlow={toggleFlow}
        />
      </div>

      {/* Pending Approvals */}
      {pending.length > 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-3 flex items-center gap-2"><AlertCircle className="h-5 w-5 text-blue-400" /><h3 className="font-semibold text-slate-100">Агенты спрашивают ({pending.length})</h3></div>
          <div className="space-y-3">
            {pending.slice(0, 15).map(item => (
              <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-800/40 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="shrink-0 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-300">{item.type === 'lead' ? '📨 Маркетолог' : '🚀 Создатель'}</span>
                      <span className="truncate text-sm font-semibold text-slate-200">{item.title}</span>
                      <span className="shrink-0 text-[10px] text-slate-500">{item.date}</span>
                    </div>
                    <p className="text-sm text-blue-400 font-medium">{item.approvalRequest}</p>
                    {expanded === item.id && <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900 p-3 text-xs text-slate-400 font-mono">{item.details}</pre>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => setExpanded(expanded === item.id ? null : item.id)} className="rounded-md p-1.5 hover:bg-slate-700"><Eye className="h-4 w-4 text-slate-400" /></button>
                    <button onClick={() => item.type === 'lead' ? approveLead(item.id) : approveOpportunity(item.id)} className="rounded-md bg-blue-500/10 p-1.5 hover:bg-blue-500/20"><Check className="h-4 w-4 text-blue-400" /></button>
                    <button onClick={() => item.type === 'lead' ? rejectLead(item.id) : rejectOpportunity(item.id)} className="rounded-md p-1.5 hover:bg-red-500/10"><XIcon className="h-4 w-4 text-red-400" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-center">
          <p className="text-sm text-slate-500">Агенты работают... Пока вопросов нет ✨</p>
        </div>
      )}

      {/* Chat Stats */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="mb-4 flex items-center gap-2"><MessageSquare className="h-5 w-5 text-blue-400" /><h3 className="font-semibold text-slate-100">Ассистент</h3><span className="text-xs text-slate-500">Цель: 10 лидов/мес</span></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox label="Всего диалогов" value={chatStats.total} />
          <StatBox label="Сегодня" value={chatStats.today} highlight />
          <StatBox label="Лиды из чата" value={chatStats.chatLeads} target={10} />
          <StatBox label="Конверсия" value={`${chatStats.conversionRate}%`} highlight />
        </div>
      </div>
    </div>
  )
}

// ═══ FUNNEL CARD ═══
function FunnelCard({ title, subtitle, stages, flow, onToggleFlow }: {
  title: string; subtitle: string; stages: FunnelStage[]; flow?: Flow; onToggleFlow: (f: Flow) => void
}) {
  const isActive = flow?.status === 'active'
  const lastRun = flow?.last_run_at ? new Date(flow.last_run_at).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold text-slate-100">{title}</h3>
        <div className="flex items-center gap-2">
          {lastRun && <span className="text-[10px] text-slate-600">Посл: {lastRun}</span>}
          {flow && (
            <button
              onClick={() => onToggleFlow(flow)}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${isActive ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-red-400'}`} />
              {isActive ? 'Авто' : 'Пауза'}
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-slate-500 mb-4">{subtitle}</p>

      {/* Funnel visualization */}
      <div className="space-y-2">
        {stages.map((stage, i) => {
          const pct = stage.target > 0 ? Math.min(stage.count / stage.target, 1) : 0
          const behind = stage.target > 0 && stage.count < stage.target * 0.5
          const ahead = stage.target > 0 && stage.count >= stage.target

          return (
            <div key={stage.label}>
              {i > 0 && (
                <div className="flex items-center gap-2 py-1 pl-4">
                  <ArrowDown className="h-3 w-3 text-slate-600" />
                  <span className="text-[10px] text-slate-600">конверсия: {stage.conversion}</span>
                </div>
              )}
              <div className="rounded-lg border border-slate-800 bg-slate-800/30 p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <stage.icon className="h-3.5 w-3.5 text-slate-500" />
                    <span className="text-xs text-slate-400">{stage.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-lg font-bold ${behind ? 'text-red-400' : ahead ? 'text-emerald-400' : 'text-slate-100'}`}>
                      {stage.count}
                    </span>
                    <span className="text-[10px] text-slate-600">/ {stage.target}</span>
                    {behind && <TrendingDown className="h-3 w-3 text-red-400" />}
                    {ahead && <TrendingUp className="h-3 w-3 text-emerald-400" />}
                  </div>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${behind ? 'bg-red-500' : ahead ? 'bg-emerald-500' : 'bg-blue-500'}`}
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatBox({ label, value, highlight, target }: { label: string; value: number | string; highlight?: boolean; target?: number }) {
  const behind = target && typeof value === 'number' && value < target * 0.5
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-800/40 p-3 text-center">
      <p className={`text-xl font-bold ${behind ? 'text-red-400' : highlight ? 'text-blue-400' : 'text-slate-100'}`}>{value}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{label}{target ? ` (цель: ${target})` : ''}</p>
    </div>
  )
}
