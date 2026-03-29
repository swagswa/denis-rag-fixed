import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Trash2, Lightbulb, ArrowRight, RotateCcw, ChevronRight, Undo2 } from 'lucide-react'
import { toast } from 'sonner'

type Insight = { id: string; signal_id: string | null; title: string; what_happens: string; why_important: string | null; problem: string | null; action_proposal: string | null; opportunity_type: string; status: string; company_name: string | null; notes: string | null; created_at: string }
type Role = 'analyst' | 'marketer' | 'builder'

function statusesForRole(role: Role) { return role === 'analyst' ? ['new', 'returned'] : ['qualified', 'sent'] }
function statusLabel(s: string) { return s === 'new' ? 'В обработке' : s === 'qualified' ? 'Ожидает решения' : s === 'returned' ? 'Возвращён' : s === 'sent' ? 'Ожидает подтверждения' : s === 'converted' ? 'Реализован' : 'Архив' }
function statusColor(s: string) { return s === 'new' ? 'bg-blue-500/10 text-blue-400' : s === 'qualified' ? 'bg-slate-700 text-slate-300' : s === 'returned' ? 'bg-red-500/10 text-red-400' : s === 'sent' ? 'bg-slate-700 text-slate-300' : 'bg-slate-800 text-slate-500' }
function nextStatusLabel(s: string, role: Role) { return role === 'analyst' && (s === 'new' || s === 'returned') ? 'Передать →' : (role === 'marketer' || role === 'builder') && s === 'qualified' ? 'Подтвердить ✓' : 'Далее →' }

export function TwinInsights({ factory, role = 'analyst' }: { factory?: 'consulting' | 'foundry'; role?: Role }) {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [returnNotes, setReturnNotes] = useState<Record<string, string>>({})
  const [returningId, setReturningId] = useState<string | null>(null)
  const allowedStatuses = statusesForRole(role)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('insights').select('*').order('created_at', { ascending: false })
    if (factory === 'consulting') q = q.eq('opportunity_type', 'consulting')
    else if (factory === 'foundry') q = q.in('opportunity_type', ['foundry', 'innovation_pilot'])
    if (filter !== 'all') q = q.eq('status', filter)
    else q = q.in('status', allowedStatuses)
    const { data, error } = await q
    if (error) { toast.error(error.message); setInsights([]); setLoading(false); return }
    setInsights((data as Insight[]) || [])
    setLoading(false)
  }, [factory, filter, allowedStatuses.join(',')])

  useEffect(() => { load() }, [load])

  const handleForward = async (ins: Insight) => {
    const next = role === 'analyst' ? 'qualified' : ins.status === 'qualified' ? 'sent' : 'converted'
    await supabase.from('insights').update({ status: next, updated_at: new Date().toISOString() }).eq('id', ins.id)
    toast.success('Статус обновлён')
    load()
  }

  const handleReturn = async (id: string) => {
    const notes = returnNotes[id]?.trim()
    if (!notes) { toast.error('Укажите причину'); return }
    await supabase.from('insights').update({ status: 'returned', notes, updated_at: new Date().toISOString() }).eq('id', id)
    toast.success('Возвращено')
    setReturningId(null); load()
  }

  const handleDelete = async (id: string) => { if (!confirm('Удалить?')) return; await supabase.from('insights').delete().eq('id', id); toast.success('Удалено'); load() }

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" /></div>

  const roleLabel = role === 'analyst' ? 'Аналитик' : role === 'marketer' ? 'Маркетолог' : 'Создатель'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Lightbulb className="h-6 w-6 text-blue-400" />
        <h2 className="text-2xl font-bold text-slate-100">{roleLabel} — Инсайты</h2>
        <span className="rounded-full bg-blue-500/10 px-3 py-0.5 text-sm font-medium text-blue-400">{insights.length}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {['all', ...allowedStatuses].map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === s ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
            {s === 'all' ? 'Все' : statusLabel(s)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {insights.length === 0 && <p className="py-8 text-center text-slate-500">Нет инсайтов.</p>}
        {insights.map(ins => (
          <div key={ins.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-100">{ins.title}</span>
                  {ins.company_name && <span className="text-xs text-slate-500">• {ins.company_name}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(ins.status)}`}>{statusLabel(ins.status)}</span>
                </div>
                <p className="mb-1 text-sm text-slate-200">{ins.what_happens}</p>
                {ins.problem && <p className="text-xs text-slate-400"><ArrowRight className="mr-1 inline h-3 w-3" />Боль: {ins.problem}</p>}
                {ins.action_proposal && <p className="mt-1 text-xs text-blue-400"><ArrowRight className="mr-1 inline h-3 w-3" />Предложение: {ins.action_proposal}</p>}
                {ins.notes && ins.status === 'returned' && <p className="mt-1 rounded bg-red-500/5 px-2 py-1 text-xs text-red-400">Причина: {ins.notes}</p>}
                {returningId === ins.id && (
                  <div className="mt-2 flex gap-2">
                    <input value={returnNotes[ins.id] || ''} onChange={e => setReturnNotes(p => ({ ...p, [ins.id]: e.target.value }))} placeholder="Аргументация..." className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-100" />
                    <button onClick={() => handleReturn(ins.id)} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white">Вернуть</button>
                    <button onClick={() => setReturningId(null)} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300">Отмена</button>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {(role === 'analyst' && (ins.status === 'new' || ins.status === 'returned')) && (
                  <button onClick={() => handleForward(ins)} className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90"><ChevronRight className="h-3.5 w-3.5" />{nextStatusLabel(ins.status, role)}</button>
                )}
                {(role !== 'analyst' && ins.status === 'qualified') && (
                  <>
                    <button onClick={() => handleForward(ins)} className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white"><ChevronRight className="h-3.5 w-3.5" />{nextStatusLabel(ins.status, role)}</button>
                    <button onClick={() => setReturningId(ins.id)} className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400"><Undo2 className="h-4 w-4" /></button>
                  </>
                )}
                <button onClick={() => handleDelete(ins.id)} className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
