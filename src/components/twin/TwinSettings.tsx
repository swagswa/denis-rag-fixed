import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

type SettingsData = { id: string; openai_model: string | null; temperature: number | null; top_k: number | null; telegram_bot_token: string | null; telegram_chat_id: string | null; calendly_url: string | null; system_prompt: string | null; first_message: string | null }

export function TwinSettings() {
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('settings').select('*').limit(1).single().then(({ data }) => { setSettings(data as SettingsData | null); setLoading(false) })
  }, [])

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const { error } = await supabase.from('settings').update({ openai_model: settings.openai_model, temperature: settings.temperature, top_k: settings.top_k, telegram_bot_token: settings.telegram_bot_token, telegram_chat_id: settings.telegram_chat_id, calendly_url: settings.calendly_url, system_prompt: settings.system_prompt, first_message: settings.first_message }).eq('id', settings.id)
      if (error) throw error
      toast.success('Настройки сохранены')
    } catch (e: any) { toast.error(e.message) } finally { setSaving(false) }
  }

  const update = (field: string, value: any) => setSettings(prev => prev ? { ...prev, [field]: value } : prev)

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
  if (!settings) return <p className="text-slate-500">Настройки не найдены. Запустите SQL-миграцию.</p>

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-bold text-slate-100">Настройки Двойника</h2>
      <div className="space-y-4">
        <Section title="AI модель"><input value={settings.openai_model || ''} onChange={e => update('openai_model', e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100" /></Section>
        <div className="grid grid-cols-2 gap-4">
          <Section title="Temperature"><input type="number" step="0.1" min="0" max="2" value={settings.temperature ?? 0.7} onChange={e => update('temperature', parseFloat(e.target.value))} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100" /></Section>
          <Section title="Top-K чанков"><input type="number" min="1" max="20" value={settings.top_k ?? 5} onChange={e => update('top_k', parseInt(e.target.value))} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100" /></Section>
        </div>
        <Section title="Telegram Bot Token"><input value={settings.telegram_bot_token || ''} onChange={e => update('telegram_bot_token', e.target.value)} placeholder="123456:ABC-..." className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100" /></Section>
        <Section title="Telegram Chat ID"><input value={settings.telegram_chat_id || ''} onChange={e => update('telegram_chat_id', e.target.value)} placeholder="-100..." className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100" /></Section>
        <Section title="Системный промпт"><textarea value={settings.system_prompt || ''} onChange={e => update('system_prompt', e.target.value)} rows={12} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 resize-y font-mono" /></Section>
        <Section title="Первое сообщение бота"><textarea value={settings.first_message || ''} onChange={e => update('first_message', e.target.value)} rows={5} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 resize-y" /></Section>
      </div>
      <button onClick={handleSave} disabled={saving} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{saving ? 'Сохранение...' : 'Сохранить'}</button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><label className="block text-sm font-medium text-slate-200 mb-1">{title}</label>{children}</div>
}
