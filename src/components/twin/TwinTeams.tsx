import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { ChevronDown, ChevronUp, Pencil, Check, X, Plus, Pause, Play, Trash2, Loader2, Settings2, Mic, MicOff } from 'lucide-react'
import { DEFAULT_MANDATES } from '@/lib/agent-mandates'

type Mood = 'great' | 'good' | 'neutral' | 'struggling'

interface AgentData {
  id: string; name: string; role: string; mood: Mood
  metric: number; target: number; metricLabel: string
  recentItems: { label: string; date: string }[]
  statusText: string; mandateSummary?: string; mandateFull?: string; mandateKey?: string
}

interface FlowData {
  id: string; factory: string; name: string; description: string; status: string
  target_company_size?: string; target_region?: string; target_industry?: string; target_notes?: string
}

interface FactoryData {
  id: string; name: string; description: string; agents: AgentData[]; overallMood: Mood; goal: string; flows: FlowData[]
}

type MandateMap = Record<string, { summary: string; full: string }>

function getMood(current: number, target: number): Mood {
  const ratio = target > 0 ? current / target : 0
  if (ratio >= 1) return 'great'; if (ratio >= 0.5) return 'good'; if (ratio >= 0.2) return 'neutral'; return 'struggling'
}
function avgMood(moods: Mood[]): Mood {
  const s: Record<Mood, number> = { great: 3, good: 2, neutral: 1, struggling: 0 }
  const avg = moods.reduce((a, m) => a + s[m], 0) / moods.length
  if (avg >= 2.5) return 'great'; if (avg >= 1.5) return 'good'; if (avg >= 0.5) return 'neutral'; return 'struggling'
}

const MOOD_STYLE: Record<Mood, { emoji: string; border: string; pulse?: boolean }> = {
  great: { emoji: '🔥', border: 'border-emerald-500/30', pulse: true },
  good: { emoji: '😊', border: 'border-blue-500/30' },
  neutral: { emoji: '😐', border: 'border-amber-500/30' },
  struggling: { emoji: '😤', border: 'border-red-500/30' },
}

const MOOD_CONFIG: Record<Mood, { emoji: string; label: string; pulse?: boolean }> = {
  great: { emoji: '🔥', label: 'На подъёме!', pulse: true },
  good: { emoji: '😊', label: 'Всё хорошо' },
  neutral: { emoji: '😐', label: 'Ожидает задач' },
  struggling: { emoji: '😤', label: 'Нужна помощь' },
}

export function TwinTeams() {
  const [factories, setFactories] = useState<FactoryData[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: mandateDocs } = await supabase.from('documents').select('source_name, content').eq('source_type', 'agent_mandate')
    const customMandates: MandateMap = {}
    for (const doc of mandateDocs || []) {
      if (doc.source_name) { const c = doc.content || ''; const lines = c.split('\n').filter((l: string) => l.trim()); customMandates[doc.source_name] = { summary: lines.slice(0, 3).join('\n').slice(0, 200), full: c } }
    }
    const gm = (key: string) => customMandates[key] || DEFAULT_MANDATES[key] || { summary: '', full: '' }

    const [sR, iR, lR, oR, fR] = await Promise.all([
      supabase.from('signals').select('id, company_name, description, created_at, status, potential').order('created_at', { ascending: false }).limit(50),
      supabase.from('insights').select('id, title, created_at, status, opportunity_type').order('created_at', { ascending: false }).limit(50),
      supabase.from('leads').select('id, name, company_name, created_at, status').order('created_at', { ascending: false }).limit(20),
      supabase.from('startup_opportunities').select('id, idea, created_at, stage').order('created_at', { ascending: false }).limit(20),
      supabase.from('factory_flows').select('*').order('created_at', { ascending: false }),
    ])

    const signals = sR.data || []; const insights = iR.data || []; const leadsD = lR.data || []; const opps = oR.data || []; const allFlows = fR.data || []
    const rs = signals.filter(s => s.created_at >= weekAgo)
    const cI = insights.filter((i: any) => i.opportunity_type === 'consulting')
    const fI = insights.filter((i: any) => i.opportunity_type === 'foundry' || i.opportunity_type === 'innovation_pilot')

    const mk = (id: string, name: string, role: string, mood: Mood, metric: number, target: number, ml: string, st: string, ri: { label: string; date: string }[], mk2: string): AgentData => {
      const m = gm(mk2); return { id, name, role, mood, metric, target, metricLabel: ml, statusText: st, recentItems: ri, mandateSummary: m.summary, mandateFull: m.full, mandateKey: mk2 }
    }

    const sm = rs.filter((s: any) => s.potential === 'consulting' || !s.potential).length
    const am = cI.filter(i => i.created_at >= weekAgo).length
    const cm = leadsD.length
    const clm = leadsD.filter((l: any) => l.status === 'qualified' || l.status === 'converted').length

    const cAgents: AgentData[] = [
      mk('sc', 'Скаут', 'Ищет сигналы', getMood(sm, 15), sm, 15, 'сигн./нед.', sm >= 15 ? 'Радар на полную!' : sm > 0 ? 'Работаю.' : 'Жду потока.', signals.filter((s: any) => s.potential === 'consulting').slice(0, 3).map(s => ({ label: s.company_name || 'Сигнал', date: new Date(s.created_at).toLocaleDateString('ru') })), 'scout-consulting'),
      mk('ac', 'Аналитик', 'Инсайты', getMood(am, 5), am, 5, 'инс./нед.', am >= 5 ? 'Готовы!' : am > 0 ? 'Анализирую.' : 'Жду сигналы.', cI.slice(0, 3).map((i: any) => ({ label: i.title?.slice(0, 40) || 'Инсайт', date: new Date(i.created_at).toLocaleDateString('ru') })), 'analyst-consulting'),
      mk('mk', 'Маркетолог', 'Лиды', getMood(cm, 5), cm, 5, 'лидов', cm >= 5 ? 'Воронка!' : cm > 0 ? 'Outreach.' : 'Жду.', leadsD.slice(0, 3).map((l: any) => ({ label: l.company_name || l.name || 'Лид', date: new Date(l.created_at).toLocaleDateString('ru') })), 'marketer-consulting'),
      mk('sl', 'Продавец', 'Сделки', getMood(clm, 2), clm, 2, 'сделок', clm > 0 ? 'Есть клиенты!' : 'Жду лидов.', [], 'seller-consulting'),
    ]

    const fsm = rs.filter((s: any) => s.potential === 'foundry').length
    const fam = fI.filter(i => i.created_at >= weekAgo).length
    const bm = opps.filter(o => o.stage !== 'killed').length

    const fAgents: AgentData[] = [
      mk('sf', 'Скаут', 'Тренды', getMood(fsm, 15), fsm, 15, 'сигн./нед.', fsm > 0 ? 'Сканирую.' : 'Жду.', signals.filter((s: any) => s.potential === 'foundry').slice(0, 3).map(s => ({ label: s.company_name || 'Сигнал', date: new Date(s.created_at).toLocaleDateString('ru') })), 'scout-foundry'),
      mk('af', 'Аналитик', 'Идеи', getMood(fam, 5), fam, 5, 'инс./нед.', fam > 0 ? 'Оцениваю.' : 'Жду.', fI.slice(0, 3).map((i: any) => ({ label: i.title?.slice(0, 40) || 'Инсайт', date: new Date(i.created_at).toLocaleDateString('ru') })), 'analyst-foundry'),
      mk('bl', 'Создатель', 'MVP', getMood(bm, 1), bm, 1, 'проектов', bm > 0 ? 'В работе!' : 'Жду идею.', opps.slice(0, 3).map(o => ({ label: o.idea?.slice(0, 40) || 'Проект', date: new Date(o.created_at).toLocaleDateString('ru') })), 'builder-foundry'),
    ]

    setFactories([
      { id: 'consulting', name: 'Consulting Factory', description: 'Сигналы → Инсайты → Outreach → Сделки', agents: cAgents, overallMood: avgMood(cAgents.map(a => a.mood)), goal: 'Цель: 2 клиента в марте', flows: allFlows.filter((f: any) => f.factory === 'consulting') },
      { id: 'foundry', name: 'Foundry Factory', description: 'Идеи → Концепция → MVP → Profit', agents: fAgents, overallMood: avgMood(fAgents.map(a => a.mood)), goal: 'Цель: 1 продукт ≥200K', flows: allFlows.filter((f: any) => f.factory === 'foundry') },
    ])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div className="space-y-8">
      <div><h2 className="text-xl font-bold text-slate-100">Команды заводов</h2><p className="text-sm text-slate-500 mt-1">Агенты работают автоматически при наличии активных потоков</p></div>
      <div className="space-y-10">{factories.map(f => <FactorySection key={f.id} factory={f} onFlowChange={loadData} />)}</div>
    </div>
  )
}

function FactorySection({ factory, onFlowChange }: { factory: FactoryData; onFlowChange: () => void }) {
  const mc = MOOD_CONFIG[factory.overallMood]
  const hasActive = factory.flows.some(f => f.status === 'active')
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="flex items-center gap-3"><h3 className="text-lg font-bold text-slate-100">{factory.name}</h3><span className="text-2xl">{mc.emoji}</span>{hasActive && <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />}</div>
          <p className="text-sm text-slate-500 mt-0.5">{factory.description}</p>
        </div>
        <div className="text-right"><p className="text-xs text-slate-500">{factory.goal}</p><p className="text-sm font-medium text-slate-300 mt-0.5">{hasActive ? '🟢 Работают' : '⏸️ Нет потоков'}</p></div>
      </div>
      <FlowManager factoryId={factory.id} flows={factory.flows} onChanged={onFlowChange} />
      <div className={`grid gap-4 mt-4 ${factory.agents.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {factory.agents.map(a => <AgentCard key={a.id} agent={a} onMandateUpdate={onFlowChange} />)}
      </div>
    </div>
  )
}

function AgentCard({ agent, onMandateUpdate }: { agent: AgentData; onMandateUpdate?: () => void }) {
  const cfg = MOOD_STYLE[agent.mood]
  const prog = agent.target > 0 ? Math.min(100, Math.round((agent.metric / agent.target) * 100)) : 0
  const [exp, setExp] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [saving, setSaving] = useState(false)
  const [recording, setRecording] = useState(false)
  const recognitionRef = useRef<any>(null)
  const voiceBaseRef = useRef('')

  const toggleVoice = () => {
    if (recording) {
      recognitionRef.current?.stop()
      setRecording(false)
      return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Браузер не поддерживает голосовой ввод. Используйте Chrome.'); return }
    const recognition = new SR()
    recognition.lang = 'ru-RU'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (e: any) => {
      let transcript = ''
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript
      }
      setEditText(prev => {
        // Replace only the voice portion at the end
        const base = prev.endsWith('\n') ? prev : prev ? prev + '\n' : ''
        return base + transcript
      })
    }
    recognition.onerror = () => setRecording(false)
    recognition.onend = () => setRecording(false)
    recognition.start()
    recognitionRef[0] = recognition
    setRecording(true)
  }

  const saveMandate = async () => {
    if (!agent.mandateKey) return; setSaving(true)
    const dk = `mandate:${agent.mandateKey}`
    const { data: ex } = await supabase.from('documents').select('id').eq('source_ref', dk).limit(1)
    if (ex?.length) await supabase.from('documents').update({ content: editText, updated_at: new Date().toISOString() }).eq('id', ex[0].id)
    else await supabase.from('documents').insert({ title: `Мандат: ${agent.name}`, content: editText, source_type: 'agent_mandate', source_ref: dk, source_name: agent.mandateKey })
    setEditing(false); setSaving(false); onMandateUpdate?.()
  }

  return (
    <div className={`rounded-xl border ${cfg.border} bg-slate-900/60 p-4 hover:bg-slate-900 group`}>
      <div className="flex items-center gap-3 mb-3">
        <div className="relative shrink-0"><div className="h-10 w-10 rounded-xl bg-slate-800 flex items-center justify-center text-lg">{cfg.emoji}</div>{cfg.pulse && <div className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />}</div>
        <div><h4 className="font-bold text-slate-100 text-sm">{agent.name}</h4><p className="text-[11px] text-slate-500 truncate">{agent.role}</p></div>
      </div>
      <div className="mb-2">
        <div className="flex items-center justify-between text-xs mb-1"><span className="text-slate-200 font-semibold">{agent.metric}/{agent.target}</span><span className="text-slate-500 text-[10px]">{agent.metricLabel}</span></div>
        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${prog >= 100 ? 'bg-emerald-500' : prog >= 50 ? 'bg-blue-500' : prog >= 20 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${prog}%` }} /></div>
      </div>
      <p className="text-[11px] text-slate-400 italic mb-2">"{agent.statusText}"</p>

      {(agent.mandateSummary || agent.mandateFull) && !editing && (
        <div className="pt-2 border-t border-slate-800/30">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Мандат</span>
            <div className="flex gap-1">
              {agent.mandateKey && <button onClick={() => { setEditText(agent.mandateFull || agent.mandateSummary || ''); setEditing(true) }} className="p-0.5 rounded hover:bg-slate-800 text-slate-500"><Pencil className="h-3 w-3" /></button>}
              {agent.mandateFull && <button onClick={() => setExp(!exp)} className="p-0.5 rounded hover:bg-slate-800 text-slate-500">{exp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</button>}
            </div>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed whitespace-pre-line">{exp ? agent.mandateFull : agent.mandateSummary}</p>
        </div>
      )}
      {editing && (
        <div className="pt-2 border-t border-slate-800/30">
          <textarea value={editText} onChange={e => setEditText(e.target.value)} className="w-full text-[11px] p-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 resize-y min-h-[120px]" rows={8} />
          <div className="flex gap-1 mt-1 justify-end">
            <button onClick={saveMandate} disabled={saving} className="p-0.5 text-emerald-400"><Check className="h-3.5 w-3.5" /></button>
            <button onClick={() => setEditing(false)} className="p-0.5 text-red-400"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}
      {agent.recentItems.length > 0 && (
        <div className="pt-2 border-t border-slate-800/30 space-y-1 mt-2">
          {agent.recentItems.map((item, i) => <div key={i} className="flex items-center justify-between text-[10px]"><span className="text-slate-400 truncate mr-2">{item.label}</span><span className="text-slate-600 shrink-0">{item.date}</span></div>)}
        </div>
      )}
    </div>
  )
}

function FlowManager({ factoryId, flows, onChanged }: { factoryId: string; flows: FlowData[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false); const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [companySize, setCompanySize] = useState('50-500'); const [region, setRegion] = useState('Без ограничений'); const [industry, setIndustry] = useState(''); const [notes, setNotes] = useState(''); const [saving, setSaving] = useState(false)
  const isF = factoryId === 'foundry'
  const reset = () => { setAdding(false); setEditingId(null); setName(''); setDesc(''); setCompanySize('50-500'); setRegion('Без ограничений'); setIndustry(''); setNotes('') }

  const handleAdd = async () => { if (!name.trim()) return; setSaving(true); await supabase.from('factory_flows').insert({ factory: factoryId, name: name.trim(), description: desc, target_company_size: isF ? null : companySize, target_region: region, target_industry: industry || name, target_notes: notes }); reset(); setSaving(false); onChanged() }
  const handleUpdate = async (id: string) => { setSaving(true); await supabase.from('factory_flows').update({ target_company_size: isF ? null : companySize, target_region: region, target_industry: industry, target_notes: notes, description: desc }).eq('id', id); setEditingId(null); setSaving(false); onChanged() }
  const startEdit = (f: FlowData) => { setEditingId(f.id); setDesc(f.description || ''); setCompanySize(f.target_company_size || '50-500'); setRegion(f.target_region || 'Без ограничений'); setIndustry(f.target_industry || ''); setNotes(f.target_notes || '') }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2"><p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{isF ? 'Потоки поиска идей' : 'Потоки исследований'}</p><button onClick={() => { reset(); setAdding(true) }} className="text-blue-400"><Plus className="h-3.5 w-3.5" /></button></div>
      <div className="flex flex-wrap gap-2 mb-3">
        {flows.map(f => (
          <div key={f.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${f.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'}`}>
            <span>{f.name}</span>
            <button onClick={() => startEdit(f)}><Settings2 className="h-3 w-3" /></button>
            <button onClick={async () => { await supabase.from('factory_flows').update({ status: f.status === 'active' ? 'paused' : 'active' }).eq('id', f.id); onChanged() }}>{f.status === 'active' ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}</button>
            <button onClick={async () => { await supabase.from('factory_flows').delete().eq('id', f.id); onChanged() }} className="hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
          </div>
        ))}
        {flows.length === 0 && !adding && <p className="text-xs text-slate-500">Нет потоков. Нажми +</p>}
      </div>
      {(adding || editingId) && (
        <div className="p-4 rounded-lg bg-slate-800/40 border border-slate-700 space-y-3 mb-3">
          <p className="text-sm font-semibold text-slate-200">{adding ? 'Новый поток' : 'Настройки'}</p>
          {adding && <input value={name} onChange={e => setName(e.target.value)} placeholder="Название" className="w-full px-3 py-2 text-sm rounded-md border border-slate-700 bg-slate-900 text-slate-200" />}
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Описание" className="w-full px-3 py-2 text-sm rounded-md border border-slate-700 bg-slate-900 text-slate-200" />
          <div className="grid grid-cols-2 gap-3">
            {!isF && <div><label className="text-[11px] text-slate-500">Размер</label><input value={companySize} onChange={e => setCompanySize(e.target.value)} className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-slate-700 bg-slate-900 text-slate-200" /></div>}
            <div><label className="text-[11px] text-slate-500">{isF ? 'Ниша' : 'Индустрия'}</label><input value={industry} onChange={e => setIndustry(e.target.value)} className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-slate-700 bg-slate-900 text-slate-200" /></div>
            <div><label className="text-[11px] text-slate-500">Регион</label><input value={region} onChange={e => setRegion(e.target.value)} className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-slate-700 bg-slate-900 text-slate-200" /></div>
          </div>
          <div><label className="text-[11px] text-slate-500">Доп.</label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-slate-700 bg-slate-900 text-slate-200 resize-none" /></div>
          <div className="flex gap-2">
            <button onClick={adding ? handleAdd : () => handleUpdate(editingId!)} disabled={saving || (adding && !name.trim())} className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : adding ? 'Создать' : 'Сохранить'}</button>
            <button onClick={reset} className="px-4 py-2 text-sm rounded-md border border-slate-700 text-slate-300">Отмена</button>
          </div>
        </div>
      )}
    </div>
  )
}
