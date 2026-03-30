import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

import { classifyAssistantSite } from '@/lib/assistant-site'
import { AlertCircle, Check, X as XIcon, Eye, Search, Lightbulb, MessageSquare, ShoppingCart, Wrench } from 'lucide-react'
import { toast } from 'sonner'

interface Flow {
  id: string
  factory: string
  name: string
  status: string
  last_run_at: string | null
  last_run_result: Record<string, any> | null
}

interface FactoryStats {
  signals: number
  insights: number
  qualifiedInsights: number
  returnedInsights: number
  leads: number
  pendingLeads: number
  opportunities: number
  pendingOpps: number
  signals12h: number
  insights12h: number
  leads12h: number
  opps12h: number
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

const EMPTY_STATS: FactoryStats = { signals: 0, insights: 0, qualifiedInsights: 0, returnedInsights: 0, leads: 0, pendingLeads: 0, opportunities: 0, pendingOpps: 0, signals12h: 0, insights12h: 0, leads12h: 0, opps12h: 0 }

export function TwinDashboard() {
  const [consulting, setConsulting] = useState<FactoryStats>(EMPTY_STATS)
  const [foundry, setFoundry] = useState<FactoryStats>(EMPTY_STATS)
  const [flows, setFlows] = useState<Flow[]>([])
  const [pending, setPending] = useState<PendingItem[]>([])
  const [chatStats, setChatStats] = useState<ChatStats>({ total: 0, today: 0, chatLeads: 0, conversionRate: '0' })
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [runningFlow, setRunningFlow] = useState<string | null>(null)
  const [runStep, setRunStep] = useState<string>('')
  const [runResult, setRunResult] = useState<Record<string, string>>({})


  const loadData = async () => {
    const cutoff12h = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()

    try {
      const [signalsRes, insightsRes, leadsRes, oppsRes, flowsRes,
             rSignalsRes, rInsightsRes, rLeadsRes, rOppsRes,
             chatsRes, chatLeadsRes] = await Promise.all([
        supabase.from('signals').select('id, status, potential'),
        supabase.from('insights').select('id, status, opportunity_type'),
        supabase.from('leads').select('id, status, company_name, name, message, lead_summary, role, created_at, session_id, topic_guess'),
        supabase.from('startup_opportunities').select('id, stage, idea, problem, solution, market, monetization, notes, created_at, revenue_estimate, source'),
        supabase.from('factory_flows').select('id, factory, name, status, last_run_at, last_run_result'),
        // 12h counts
        supabase.from('signals').select('id, potential').gte('created_at', cutoff12h),
        supabase.from('insights').select('id, opportunity_type').gte('created_at', cutoff12h),
        supabase.from('leads').select('id').gte('created_at', cutoff12h),
        supabase.from('startup_opportunities').select('id').gte('created_at', cutoff12h),
        // Chat stats
        supabase.from('conversations').select('id, page, session_id, created_at'),
        supabase.from('leads').select('id, session_id').not('session_id', 'is', null),
      ])

      const signals = signalsRes.data || []
      const insights = insightsRes.data || []
      const leadsData = leadsRes.data || []
      const opps = oppsRes.data || []
      const rSignals = rSignalsRes.data || []
      const rInsights = rInsightsRes.data || []
      const rLeads = rLeadsRes.data || []
      const rOpps = rOppsRes.data || []

      // Consulting stats
      const cSignals = signals.filter((s: any) => s.potential === 'consulting' || !s.potential)
      const cInsights = insights.filter((i: any) => i.opportunity_type === 'consulting')
      const cLeads = leadsData.filter((l: any) => !l.session_id && l.topic_guess?.startsWith('insight:') || l.status === 'pending_approval' || l.status === 'approved' || l.status === 'sent')
      const pLeads = leadsData.filter((l: any) => l.status === 'pending_approval')

      setConsulting({
        signals: cSignals.length,
        insights: cInsights.length,
        qualifiedInsights: cInsights.filter((i: any) => i.status === 'qualified').length,
        returnedInsights: cInsights.filter((i: any) => i.status === 'returned').length,
        leads: cLeads.length,
        pendingLeads: pLeads.length,
        opportunities: 0,
        pendingOpps: 0,
        signals12h: rSignals.filter((s: any) => s.potential === 'consulting' || !s.potential).length,
        insights12h: rInsights.filter((i: any) => i.opportunity_type === 'consulting').length,
        leads12h: rLeads.length,
        opps12h: 0,
      })

      // Foundry stats
      const fSignals = signals.filter((s: any) => s.potential === 'foundry')
      const fInsights = insights.filter((i: any) => i.opportunity_type === 'foundry' || i.opportunity_type === 'innovation_pilot')
      const activeOpps = opps.filter((o: any) => o.stage !== 'killed')
      const pOpps = opps.filter((o: any) => o.stage === 'opportunity' && o.source === 'builder_agent')

      setFoundry({
        signals: fSignals.length,
        insights: fInsights.length,
        qualifiedInsights: fInsights.filter((i: any) => i.status === 'qualified').length,
        returnedInsights: fInsights.filter((i: any) => i.status === 'returned').length,
        leads: 0,
        pendingLeads: 0,
        opportunities: activeOpps.length,
        pendingOpps: pOpps.length,
        signals12h: rSignals.filter((s: any) => s.potential === 'foundry').length,
        insights12h: rInsights.filter((i: any) => i.opportunity_type === 'foundry' || i.opportunity_type === 'innovation_pilot').length,
        leads12h: 0,
        opps12h: rOpps.length,
      })

      const loadedFlows = ((flowsRes.data || []) as any) as Flow[]
      setFlows(loadedFlows)

      // Restore last run results from DB
      const savedResults: Record<string, string> = {}
      loadedFlows.forEach(f => {
        if (f.last_run_result && typeof f.last_run_result === 'object') {
          const r = f.last_run_result as Record<string, any>
          if (r.summary) savedResults[f.factory] = r.summary
        }
      })
      if (Object.keys(savedResults).length > 0) setRunResult(prev => ({ ...savedResults, ...prev }))

      // Pending items
      const pendingItems: PendingItem[] = []
      pLeads.forEach((l: any) => pendingItems.push({
        id: l.id, type: 'lead',
        title: l.company_name || l.name || 'Лид',
        approvalRequest: l.lead_summary || 'Маркетолог предлагает outreach. Одобрите?',
        details: l.message || '',
        date: new Date(l.created_at).toLocaleDateString('ru'),
      }))
      pOpps.forEach((o: any) => {
        const notesLines = (o.notes || '').split('\n')
        const requestLine = notesLines.find((l: string) => l.startsWith('ЗАПРОС:'))
        pendingItems.push({
          id: o.id, type: 'opportunity',
          title: o.idea || 'Проект',
          approvalRequest: requestLine ? requestLine.replace('ЗАПРОС:', '').trim() : `Создатель предлагает "${o.idea}". Запускаем?`,
          details: o.notes || '',
          date: new Date(o.created_at).toLocaleDateString('ru'),
        })
      })
      setPending(pendingItems)

      // Chat stats — лиды ТОЛЬКО из чата (session_id есть в conversations)
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

  const runNow = async (factory: 'consulting' | 'foundry') => {
    setRunningFlow(factory)
    setRunStep('Скаут ищет...')
    setRunResult(prev => ({ ...prev, [factory]: '' }))

    const stepLabels: Record<string, string> = {
      'scout-run': 'Скаут',
      'analyst-run': 'Аналитик',
      'marketer-run': 'Маркетолог',
      'builder-run': 'Создатель',
    }
    const summaryParts: string[] = []

    const results = await runAgentChain(factory, (step, result) => {
      const label = stepLabels[step] || step
      if (!result.data) {
        setRunStep(`${label} работает...`)
      } else {
        const d = result.data
        const detail = d.inserted != null ? `+${d.inserted}` :
          d.insights_created != null ? `+${d.insights_created} инсайтов` :
          d.leads_created != null ? `+${d.leads_created} лидов` :
          d.opportunities_created != null ? `+${d.opportunities_created} проектов` : 'готово'
        summaryParts.push(`${label}: ${detail}`)
        setRunStep(`${label}: ${detail}`)
      }
    })

    const failed = results.find(r => !r.success)
    const summary = failed
      ? `❌ Ошибка: ${failed.error || failed.fn}`
      : summaryParts.join(' → ') || '✅ Готово'

    setRunResult(prev => ({ ...prev, [factory]: summary }))

    // Save result to DB so it persists after reload
    const flow = flows.find(f => f.factory === factory)
    if (flow) {
      await (supabase as any).from('factory_flows').update({
        last_run_at: new Date().toISOString(),
        last_run_result: { summary, timestamp: new Date().toISOString() },
      }).eq('id', flow.id)
    }

    setRunningFlow(null)
    setRunStep('')
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
        <p className="mt-1 text-sm text-slate-500">Агенты работают автоматически. Вы решаете только финальные вопросы.</p>
      </div>

      {/* Factory Cards with built-in controls */}
      <div className="grid gap-6 lg:grid-cols-2">
        <FactoryCard
          title="🤝 Consulting Factory"
          factory="consulting"
          flows={flows.filter(f => f.factory === 'consulting')}
          runningFlow={runningFlow}
          runStep={runStep}
          runResult={runResult['consulting'] || ''}
          onRunNow={runNow}
          onToggleFlow={toggleFlow}
          metrics={[
            { icon: Search, label: 'Сигналы', value: consulting.signals, delta: consulting.signals12h, sub: 'найдено скаутом' },
            { icon: Lightbulb, label: 'Инсайты', value: consulting.insights, delta: consulting.insights12h, sub: `${consulting.qualifiedInsights} квалифиц.` },
            { icon: MessageSquare, label: 'Outreach', value: consulting.leads, delta: consulting.leads12h, sub: `${consulting.pendingLeads} ждут решения` },
            { icon: ShoppingCart, label: 'Сделки', value: 0, delta: 0, sub: 'в очереди' },
          ]}
        />
        <FactoryCard
          title="🚀 Foundry Factory"
          factory="foundry"
          flows={flows.filter(f => f.factory === 'foundry')}
          runningFlow={runningFlow}
          runStep={runStep}
          runResult={runResult['foundry'] || ''}
          onRunNow={runNow}
          onToggleFlow={toggleFlow}
          metrics={[
            { icon: Search, label: 'Сигналы', value: foundry.signals, delta: foundry.signals12h, sub: 'найдено скаутом' },
            { icon: Lightbulb, label: 'Инсайты', value: foundry.insights, delta: foundry.insights12h, sub: `${foundry.qualifiedInsights} квалифиц.` },
            { icon: Wrench, label: 'Проекты', value: foundry.opportunities, delta: foundry.opps12h, sub: `${foundry.pendingOpps} ждут решения` },
          ]}
        />
      </div>

      {/* Block 3: Pending Approvals */}
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

      {/* Block 4: Chat Stats (compact) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="mb-4 flex items-center gap-2"><MessageSquare className="h-5 w-5 text-blue-400" /><h3 className="font-semibold text-slate-100">Ассистент</h3></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox label="Всего диалогов" value={chatStats.total} />
          <StatBox label="Сегодня" value={chatStats.today} highlight />
          <StatBox label="Лиды из чата" value={chatStats.chatLeads} />
          <StatBox label="Конверсия" value={`${chatStats.conversionRate}%`} highlight />
        </div>
      </div>
    </div>
  )
}

// --- Sub-components ---

interface MetricItem {
  icon: any
  label: string
  value: number
  delta: number
  sub: string
}

function FactoryCard({ title, factory, flows, runningFlow, runStep, runResult, onRunNow, onToggleFlow, metrics }: {
  title: string; factory: string; flows: Flow[]; runningFlow: string | null; runStep: string; runResult: string;
  onRunNow: (f: 'consulting' | 'foundry') => void; onToggleFlow: (f: Flow) => void; metrics: MetricItem[]
}) {
  const flow = flows[0]
  const isActive = flow?.status === 'active'
  const isRunning = runningFlow === factory
  const lastRun = flow?.last_run_at ? new Date(flow.last_run_at).toLocaleString('ru', { hour: '2-digit', minute: '2-digit' }) : null

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      {/* Header with status */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-100">{title}</h3>
        {flow && (
          <button
            onClick={() => onToggleFlow(flow)}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${isActive ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {isActive ? 'Работает' : 'Остановлен'}
          </button>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3">
        {metrics.map(m => (
          <MiniStat key={m.label} icon={m.icon} label={m.label} value={m.value} delta={m.delta} sub={m.sub} />
        ))}
      </div>

      {/* Run controls + progress + result */}
      {flow && (
        <div className="mt-4 pt-3 border-t border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => onRunNow(factory as 'consulting' | 'foundry')}
              disabled={isRunning}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
              {isRunning ? 'Работает...' : 'Запустить цепочку'}
            </button>
            {lastRun && <span className="text-[10px] text-slate-600">Последний: {lastRun}</span>}
          </div>
          {isRunning && runStep && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-500/5 border border-blue-500/10 px-3 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-blue-400 shrink-0" />
              <span className="text-xs text-blue-300">{runStep}</span>
            </div>
          )}
          {!isRunning && runResult && (
            <div className={`rounded-lg px-3 py-2 text-xs ${runResult.startsWith('❌') ? 'bg-red-500/5 border border-red-500/10 text-red-300' : 'bg-emerald-500/5 border border-emerald-500/10 text-emerald-300'}`}>
              {runResult}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MiniStat({ icon: Icon, label, value, delta, sub }: { icon: any; label: string; value: number; delta: number; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-800/30 p-3">
      <div className="mb-1 flex items-center justify-between"><span className="text-xs text-slate-500">{label}</span><Icon className="h-3.5 w-3.5 text-slate-500" /></div>
      <div className="flex items-baseline gap-2">
        <p className="text-xl font-bold text-slate-100">{value}</p>
        {delta > 0 && <span className="text-sm font-medium text-emerald-400">+{delta}</span>}
      </div>
      <div className="flex items-center justify-between">
        {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
        {delta > 0 && <p className="text-[10px] text-slate-600">за 12ч</p>}
      </div>
    </div>
  )
}

function StatBox({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-800/40 p-3 text-center">
      <p className={`text-xl font-bold ${highlight ? 'text-blue-400' : 'text-slate-100'}`}>{value}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}
