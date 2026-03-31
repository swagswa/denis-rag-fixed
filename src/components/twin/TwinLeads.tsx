import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { MessageSquare, Check, X as XIcon, Send, Loader2, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { edgeFetch } from '@/lib/api'

type Lead = { id: string; message: string; role: string | null; company_size: string | null; name: string | null; company_name: string | null; topic_guess: string | null; lead_summary: string | null; status: string | null; telegram_sent: boolean | null; page: string | null; created_at: string }

const STATUSES = ['pending_approval', 'approved', 'rejected', 'new', 'qualified', 'sent', 'converted', 'archived'] as const
const SELLER_STATUSES = ['approved', 'sent', 'converted'] as const

function statusLabel(s: string) { return s === 'pending_approval' ? 'Ожидает решения' : s === 'approved' ? 'Одобрен' : s === 'rejected' ? 'Отклонён' : s === 'new' ? 'Новый' : s === 'sent' ? '✉️ Отправлен' : s === 'converted' ? 'Конвертирован' : 'Архив' }
function statusColor(s: string) { return s === 'pending_approval' ? 'bg-blue-500/10 text-blue-400' : s === 'approved' ? 'bg-slate-700 text-slate-300' : s === 'rejected' ? 'bg-red-500/10 text-red-400' : s === 'sent' ? 'bg-emerald-500/10 text-emerald-400' : s === 'converted' ? 'bg-green-500/10 text-green-400' : 'bg-slate-700 text-slate-300' }

export function TwinLeads({ sellerMode }: { sellerMode?: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [sendingId, setSendingId] = useState<string | null>(null)

  const statusList = sellerMode ? SELLER_STATUSES : STATUSES

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(200)
    
    if (sellerMode) {
      // Seller only sees leads that passed through marketer (approved/sent/converted)
      if (filter !== 'all') {
        q = q.eq('status', filter)
      } else {
        q = q.in('status', ['approved', 'sent', 'converted'])
      }
    } else {
      if (filter !== 'all') q = q.eq('status', filter)
    }
    
    const { data } = await q
    setLeads((data as Lead[]) || [])
    setLoading(false)
  }, [filter, sellerMode])

  useEffect(() => { load() }, [load])

  const handleApprove = async (id: string) => { await supabase.from('leads').update({ status: 'approved' }).eq('id', id); toast.success('Одобрен'); load() }
  const handleReject = async (id: string) => { await supabase.from('leads').update({ status: 'rejected' }).eq('id', id); toast.success('Отклонён'); load() }

  const handleSendOutreach = async (id: string) => {
    setSendingId(id)
    try {
      const res = await edgeFetch('send-outreach', { method: 'POST', body: JSON.stringify({ lead_id: id }) })
      const data = await res.json()
      if (data?.success) toast.success(`Отправлено на ${data.recipient}`)
      else toast.error(data?.error || 'Ошибка')
    } catch (err: any) { toast.error(err.message) } finally { setSendingId(null); load() }
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" /></div>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <MessageSquare className="h-6 w-6 text-blue-400" />
        <h2 className="text-2xl font-bold text-slate-100">{sellerMode ? 'Продавец — Сделки' : 'Лиды'}</h2>
        <span className="rounded-full bg-blue-500/10 px-3 py-0.5 text-sm font-medium text-blue-400">{leads.length}</span>
      </div>

      {sellerMode && (
        <p className="text-sm text-slate-500">Здесь только лиды, прошедшие через маркетолога и одобренные вами.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {['all', ...statusList].map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === s ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
            {s === 'all' ? 'Все' : statusLabel(s)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {leads.length === 0 && <p className="py-8 text-center text-slate-500">{sellerMode ? 'Нет одобренных лидов. Сначала маркетолог должен найти контакт, потом вы одобряете.' : 'Нет лидов'}</p>}
        {leads.map(l => (
          <div key={l.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-100">{l.company_name || l.name || 'Лид'}</span>
                  {l.role && <span className="text-xs text-slate-500">• {l.role}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(l.status || 'new')}`}>{statusLabel(l.status || 'new')}</span>
                  <span className="text-[10px] text-slate-500">{new Date(l.created_at).toLocaleDateString('ru')}</span>
                </div>
                {l.lead_summary && <p className="mb-1 text-sm text-slate-200 whitespace-pre-line">{l.lead_summary}</p>}
                <p className="text-xs text-slate-400 whitespace-pre-line">{l.message}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {l.status === 'pending_approval' && !sellerMode && (
                  <>
                    <button onClick={() => handleApprove(l.id)} className="rounded-md p-1.5 hover:bg-slate-700"><Check className="h-4 w-4 text-blue-400" /></button>
                    <button onClick={() => handleReject(l.id)} className="rounded-md p-1.5 hover:bg-red-500/10"><XIcon className="h-4 w-4 text-red-400" /></button>
                  </>
                )}
                {(l.status === 'approved') && (
                  <button onClick={() => handleSendOutreach(l.id)} disabled={sendingId === l.id} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                    {sendingId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Отправить
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
