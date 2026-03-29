import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, Trash2, Rocket, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'

const STAGES = [
  { value: 'opportunity', label: 'Идея' }, { value: 'concept', label: 'Концепция' },
  { value: 'mvp', label: 'MVP' }, { value: 'test', label: 'Тест' },
  { value: 'live', label: 'Live' }, { value: 'killed', label: 'Закрыт' },
] as const

type Opportunity = { id: string; idea: string; source: string | null; problem: string | null; market: string | null; monetization: string | null; complexity: string | null; mvp_timeline: string | null; solution: string | null; stage: string; revenue_estimate: number | null; notes: string | null; created_at: string }

function stageColor(s: string) {
  const map: Record<string, string> = { opportunity: 'bg-blue-500/10 text-blue-400', concept: 'bg-purple-500/10 text-purple-400', mvp: 'bg-amber-500/10 text-amber-400', test: 'bg-emerald-500/10 text-emerald-400', live: 'bg-green-500/10 text-green-400', killed: 'bg-red-500/10 text-red-400' }
  return map[s] || 'bg-slate-800 text-slate-500'
}

export function TwinOpportunities() {
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [form, setForm] = useState({ idea: '', source: '', problem: '', market: '', monetization: '', complexity: 'low', mvp_timeline: '', solution: '', revenue_estimate: '' })

  const load = useCallback(async () => {
    let q = supabase.from('startup_opportunities').select('*').order('created_at', { ascending: false }) as any
    if (stageFilter !== 'all') q = q.eq('stage', stageFilter)
    const { data } = await q
    setOpps((data as Opportunity[]) || [])
    setLoading(false)
  }, [stageFilter])

  useEffect(() => { load() }, [load])

  const handleSubmit = async () => {
    if (!form.idea.trim()) return
    await supabase.from('startup_opportunities').insert({ idea: form.idea, source: form.source || null, problem: form.problem || null, market: form.market || null, monetization: form.monetization || null, complexity: form.complexity, mvp_timeline: form.mvp_timeline || null, solution: form.solution || null, revenue_estimate: form.revenue_estimate ? Number(form.revenue_estimate) : null })
    toast.success('Проект добавлен')
    setShowForm(false); load()
  }

  const handleStageChange = async (id: string, stage: string) => { await (supabase as any).from('startup_opportunities').update({ stage, updated_at: new Date().toISOString() }).eq('id', id); load() }
  const handleDelete = async (id: string) => { if (!confirm('Удалить?')) return; await supabase.from('startup_opportunities').delete().eq('id', id); toast.success('Удалено'); load() }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Rocket className="h-6 w-6 text-emerald-400" />
          <h2 className="text-2xl font-bold text-slate-100">Foundry — Проекты</h2>
          <span className="rounded-full bg-emerald-500/10 px-3 py-0.5 text-sm font-medium text-emerald-400">{opps.length}</span>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white"><Plus className="h-4 w-4" />{showForm ? 'Закрыть' : 'Новый проект'}</button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all', ...STAGES.map(s => s.value)].map(s => (
          <button key={s} onClick={() => setStageFilter(s)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${stageFilter === s ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
            {s === 'all' ? 'Все' : STAGES.find(st => st.value === s)?.label}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <h3 className="font-semibold text-slate-100">Новый проект</h3>
          <input value={form.idea} onChange={e => setForm({ ...form, idea: e.target.value })} placeholder="Идея *" className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
          <div className="grid gap-4 sm:grid-cols-2">
            <textarea value={form.problem} onChange={e => setForm({ ...form, problem: e.target.value })} placeholder="Проблема" rows={2} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 resize-y" />
            <textarea value={form.market} onChange={e => setForm({ ...form, market: e.target.value })} placeholder="Рынок" rows={2} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 resize-y" />
            <input value={form.monetization} onChange={e => setForm({ ...form, monetization: e.target.value })} placeholder="Монетизация" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
            <input type="number" value={form.revenue_estimate} onChange={e => setForm({ ...form, revenue_estimate: e.target.value })} placeholder="Оценка выручки ₽" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
            <select value={form.complexity} onChange={e => setForm({ ...form, complexity: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <input value={form.mvp_timeline} onChange={e => setForm({ ...form, mvp_timeline: e.target.value })} placeholder="MVP timeline (e.g. 2 weeks)" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
            <textarea value={form.solution} onChange={e => setForm({ ...form, solution: e.target.value })} placeholder="Solution description" rows={2} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 resize-y sm:col-span-2" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">Добавить</button>
            <button onClick={() => setShowForm(false)} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300">Отмена</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {opps.length === 0 && <p className="text-center text-slate-500 py-8">Нет проектов.</p>}
        {opps.map(opp => (
          <div key={opp.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-semibold text-slate-100">{opp.idea}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stageColor(opp.stage)}`}>{STAGES.find(s => s.value === opp.stage)?.label}</span>
                </div>
                {opp.problem && <p className="text-sm text-slate-200 mb-1">{opp.problem}</p>}
                <div className="flex gap-4 flex-wrap text-xs text-slate-500 mt-1">
                  {opp.market && <span>Рынок: {opp.market}</span>}
                  {opp.monetization && <span>Монетизация: {opp.monetization}</span>}
                  {opp.revenue_estimate && <span className="font-medium text-emerald-400">~{Number(opp.revenue_estimate).toLocaleString('ru')} ₽</span>}
                </div>
                {opp.solution && <p className="text-xs text-blue-400 mt-1"><ArrowRight className="inline h-3 w-3 mr-1" />{opp.solution}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <select value={opp.stage} onChange={e => handleStageChange(opp.id, e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300">
                  {STAGES.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
                </select>
                <button onClick={() => handleDelete(opp.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
