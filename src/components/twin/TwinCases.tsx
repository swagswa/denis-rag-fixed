import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { toast } from 'sonner'

type Case = {
  id: string; title: string; problem: string; ai_solution: string
  audience_role: string | null; symptoms: string | null; ai_angle: string | null
  is_active: boolean | null; created_at: string
}

export function TwinCases() {
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Case | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', problem: '', ai_solution: '', audience_role: '', symptoms: '', ai_angle: '' })

  const load = useCallback(async () => {
    const { data } = await supabase.from('cases').select('*').order('created_at', { ascending: false })
    setCases((data as Case[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    try {
      if (editing) {
        await supabase.from('cases').update({ title: form.title, problem: form.problem, ai_solution: form.ai_solution, audience_role: form.audience_role || null, symptoms: form.symptoms || null, ai_angle: form.ai_angle || null }).eq('id', editing.id)
        toast.success('Кейс обновлён')
      } else {
        await supabase.from('cases').insert({ title: form.title, problem: form.problem, ai_solution: form.ai_solution, audience_role: form.audience_role || null, symptoms: form.symptoms || null, ai_angle: form.ai_angle || null, is_active: true })
        toast.success('Кейс создан')
      }
      setEditing(null); setCreating(false); load()
    } catch (e: any) { toast.error(e.message) }
  }

  const handleToggle = async (c: Case) => { await supabase.from('cases').update({ is_active: !c.is_active }).eq('id', c.id); load() }
  const handleDelete = async (id: string) => { if (!confirm('Удалить кейс?')) return; await supabase.from('cases').delete().eq('id', id); toast.success('Удалено'); load() }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-100">Кейсы ({cases.length})</h2>
        <button onClick={() => { setCreating(true); setForm({ title: '', problem: '', ai_solution: '', audience_role: '', symptoms: '', ai_angle: '' }) }} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:opacity-90"><Plus className="h-4 w-4" />Добавить</button>
      </div>

      {(creating || editing) && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <h3 className="font-semibold text-slate-100">{editing ? 'Редактировать кейс' : 'Новый кейс'}</h3>
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Название*" className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-blue-500" />
          <textarea value={form.problem} onChange={e => setForm(p => ({ ...p, problem: e.target.value }))} placeholder="Проблема*" rows={3} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
          <textarea value={form.ai_solution} onChange={e => setForm(p => ({ ...p, ai_solution: e.target.value }))} placeholder="AI-решение*" rows={3} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
          <div className="grid grid-cols-3 gap-4">
            <input value={form.audience_role} onChange={e => setForm(p => ({ ...p, audience_role: e.target.value }))} placeholder="Аудитория" className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 outline-none" />
            <input value={form.symptoms} onChange={e => setForm(p => ({ ...p, symptoms: e.target.value }))} placeholder="Симптомы" className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 outline-none" />
            <input value={form.ai_angle} onChange={e => setForm(p => ({ ...p, ai_angle: e.target.value }))} placeholder="AI-угол" className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 outline-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:opacity-90">Сохранить</button>
            <button onClick={() => { setEditing(null); setCreating(false) }} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300">Отмена</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {cases.map(c => (
          <div key={c.id} className={`rounded-xl border border-slate-800 bg-slate-900 p-4 ${c.is_active === false ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-100">{c.title}</h3>
                  {c.audience_role && <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">{c.audience_role}</span>}
                  {c.is_active === false && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-500">выкл</span>}
                </div>
                <p className="text-sm text-slate-400 mt-1 line-clamp-2">{c.problem}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => handleToggle(c)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500" title={c.is_active ? 'Выключить' : 'Включить'}>
                  {c.is_active !== false ? <Check className="h-4 w-4 text-emerald-400" /> : <X className="h-4 w-4" />}
                </button>
                <button onClick={() => { setEditing(c); setForm({ title: c.title, problem: c.problem, ai_solution: c.ai_solution, audience_role: c.audience_role || '', symptoms: c.symptoms || '', ai_angle: c.ai_angle || '' }) }} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
