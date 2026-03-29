import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Radio, Building2, User, Rocket, Cpu, RefreshCcw } from 'lucide-react'
import { toast } from 'sonner'

const SIGNAL_TYPES = [
  { value: 'company', label: 'Компания', icon: Building2 },
  { value: 'founder', label: 'Фаундер', icon: User },
  { value: 'startup', label: 'Стартап', icon: Rocket },
  { value: 'tech', label: 'Технология', icon: Cpu },
] as const

const POTENTIALS = [
  { value: 'consulting', label: 'Консалтинг' },
  { value: 'foundry', label: 'Foundry' },
  { value: 'innovation_pilot', label: 'Пилот' },
] as const

const STATUSES = ['new', 'analyzed', 'acted', 'archived'] as const

type Signal = { id: string; signal_type: string; company_name: string | null; source: string | null; description: string; industry: string | null; potential: string | null; priority: number | null; status: string; notes: string | null; created_at: string }

function statusLabel(s: string) { return s === 'new' ? 'Новый' : s === 'analyzed' ? 'Проанализирован' : s === 'acted' ? 'В работе' : 'Архив' }
function statusTone(s: string) { return s === 'new' ? 'bg-blue-500/10 text-blue-400' : s === 'analyzed' ? 'bg-slate-700 text-slate-300' : s === 'acted' ? 'bg-slate-700 text-slate-300' : 'bg-slate-800 text-slate-500' }

export function TwinSignals({ factory }: { factory?: 'consulting' | 'foundry' }) {
  const [signals, setSignals] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('signals').select('*').order('created_at', { ascending: false })
    if (factory === 'consulting') q = q.or('potential.eq.consulting,potential.is.null')
    else if (factory === 'foundry') q = q.eq('potential', 'foundry')
    if (filter !== 'all') q = q.eq('status', filter)
    const { data, error } = await q
    if (error) { toast.error(error.message); setSignals([]); setLoading(false); return }
    setSignals((data as Signal[]) || [])
    setLoading(false)
  }, [factory, filter])

  useEffect(() => { load() }, [load])

  const priorityColor = (p: number | null) => !p ? 'bg-slate-800 text-slate-500' : p >= 4 ? 'bg-red-500/20 text-red-400' : p >= 3 ? 'bg-slate-700 text-slate-300' : 'bg-slate-800 text-slate-500'

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" /></div>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Radio className="h-6 w-6 text-blue-400" />
          <h2 className="text-2xl font-bold text-slate-100">Radar — Сигналы</h2>
          <span className="rounded-full bg-blue-500/10 px-3 py-0.5 text-sm font-medium text-blue-400">{signals.length}</span>
          <span className="rounded-full bg-slate-700 px-3 py-0.5 text-xs font-medium text-slate-300">{factory === 'consulting' ? 'Consulting' : factory === 'foundry' ? 'Foundry' : 'Все'}</span>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"><RefreshCcw className="h-4 w-4" /> Обновить</button>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs text-slate-500">
        Скаут работает автоматически: сигналы сами уходят аналитику.
      </div>

      <div className="flex flex-wrap gap-2">
        {['all', ...STATUSES].map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === s ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
            {s === 'all' ? 'Все' : statusLabel(s)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {signals.length === 0 && <p className="py-8 text-center text-slate-500">Нет сигналов.</p>}
        {signals.map(s => {
          const typeInfo = SIGNAL_TYPES.find(t => t.value === s.signal_type)
          const TypeIcon = typeInfo?.icon || Radio
          const sourceIsUrl = Boolean(s.source && /^https?:\/\//i.test(s.source))
          return (
            <div key={s.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-slate-800 p-2"><TypeIcon className="h-4 w-4 text-slate-400" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {s.company_name && <span className="font-semibold text-slate-100">{s.company_name}</span>}
                      <span className="text-xs text-slate-500">{typeInfo?.label}</span>
                      {s.industry && <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">{s.industry}</span>}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityColor(s.priority)}`}>P{s.priority ?? 0}</span>
                      {s.potential && <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-400">{POTENTIALS.find(p => p.value === s.potential)?.label}</span>}
                    </div>
                    <p className="text-sm text-slate-200">{s.description}</p>
                    {s.source && <p className="mt-1 break-all text-xs text-slate-500">Источник: {sourceIsUrl ? <a href={s.source} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">{s.source}</a> : s.source}</p>}
                  </div>
                </div>
                <div className="shrink-0 space-y-1 text-right">
                  <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${statusTone(s.status)}`}>{statusLabel(s.status)}</span>
                  <p className="text-[10px] text-slate-500">{new Date(s.created_at).toLocaleDateString('ru-RU')}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
