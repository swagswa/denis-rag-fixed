import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Save, Eye } from 'lucide-react'
import { PromptRefinementChat } from './PromptRefinementChat'
import { TestChat } from './TestChat'

type ProductContext = 'general' | 'foundry' | 'aisovetnik' | 'aitransformation'

const PRODUCT_OPTIONS: { value: ProductContext; label: string }[] = [
  { value: 'general', label: 'Общий (denismateev.ru)' },
  { value: 'foundry', label: 'Foundry' },
  { value: 'aisovetnik', label: 'AI-Советник' },
  { value: 'aitransformation', label: 'AI-Трансформация' },
]

const SECTION_MAP: Record<ProductContext, string> = {
  general: 'denismateev.ru',
  foundry: 'agent-fo.lovableproject.com',
  aisovetnik: 'ai-advisor',
  aitransformation: 'ai-transformation',
}

export function AssistantPromptEditor() {
  const [selectedProduct, setSelectedProduct] = useState<ProductContext>('general')
  const [promptText, setPromptText] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [productPrompts, setProductPrompts] = useState<Record<string, string>>({})
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showDefault, setShowDefault] = useState(false)

  // Load settings
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('id, system_prompt, product_prompts')
        .limit(1)
        .single() as any
      if (error) {
        console.error('Settings load error:', error)
      }
      if (data) {
        console.log('Settings loaded, system_prompt length:', data.system_prompt?.length, 'product_prompts keys:', Object.keys(data.product_prompts || {}))
        setSettingsId(data.id)
        setSystemPrompt(data.system_prompt || '')
        const pp = data.product_prompts || {}
        setProductPrompts(pp)
      } else {
        console.warn('No settings data returned')
      }
      setLoading(false)
    }
    load()
  }, [])

  // Update prompt text when product selection changes
  useEffect(() => {
    if (selectedProduct === 'general') {
      setPromptText(systemPrompt)
    } else {
      setPromptText(productPrompts[selectedProduct] || '')
    }
    setShowDefault(false)
  }, [selectedProduct, systemPrompt, productPrompts])

  const handleSave = async () => {
    if (!settingsId) return
    setSaving(true)
    try {
      if (selectedProduct === 'general') {
        const { error } = await supabase.from('settings').update({ system_prompt: promptText }).eq('id', settingsId)
        if (error) throw error
        setSystemPrompt(promptText)
      } else {
        const updated = { ...productPrompts, [selectedProduct]: promptText }
        if (!promptText.trim()) delete updated[selectedProduct]
        const { error } = await supabase.from('settings').update({ product_prompts: updated }).eq('id', settingsId)
        if (error) throw error
        setProductPrompts(updated)
      }
      toast.success('Промпт сохранён')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleApplyRefinedPrompt = (newPrompt: string) => {
    setPromptText(newPrompt)
    toast.success('Промпт обновлён из доработки. Нажмите «Сохранить» для применения.')
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      <div className="mb-3">
        <h2 className="text-xl font-bold text-slate-100">Промпт ассистента</h2>
        <p className="mt-1 text-xs text-slate-500">Слева — промпт. Справа вверху — доработка с ИИ. Справа внизу — тестовый чат.</p>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-3 min-h-0">
        {/* LEFT — Prompt Editor */}
        <div className="flex flex-col min-h-0 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex items-center gap-2 mb-2">
            <select
              value={selectedProduct}
              onChange={e => setSelectedProduct(e.target.value as ProductContext)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100"
            >
              {PRODUCT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => setShowDefault(!showDefault)}
              className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
            >
              <Eye className="h-3 w-3" />
              {showDefault ? 'Скрыть' : 'Инфо'}
            </button>
          </div>

          {showDefault && (
            <div className="mb-2 max-h-32 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-500 font-mono whitespace-pre-wrap">
              {selectedProduct === 'general'
                ? 'Основной промпт. Если пусто — используется базовый из edge function.'
                : `Промпт для "${PRODUCT_OPTIONS.find(o => o.value === selectedProduct)?.label}". Пусто = дефолт из edge function.`}
            </div>
          )}

          <textarea
            value={promptText}
            onChange={e => setPromptText(e.target.value)}
            placeholder={selectedProduct === 'general'
              ? 'Системный промпт для основного сайта...'
              : `Промпт для ${PRODUCT_OPTIONS.find(o => o.value === selectedProduct)?.label}...`}
            className="flex-1 min-h-0 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100 resize-none font-mono leading-relaxed"
          />

          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            {selectedProduct !== 'general' && productPrompts[selectedProduct] && (
              <button
                onClick={() => {
                  setPromptText('')
                  const updated = { ...productPrompts }
                  delete updated[selectedProduct]
                  setProductPrompts(updated)
                  ;(supabase as any).from('settings').update({ product_prompts: updated }).eq('id', settingsId!).then(() => toast.success('Сброшено на дефолт'))
                }}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
              >
                Сбросить
              </button>
            )}
          </div>
        </div>

        {/* RIGHT — Refinement (top) + Test Chat (bottom) */}
        <div className="flex flex-col min-h-0 gap-3">
          {/* Top: Prompt Refinement */}
          <div className="flex-1 min-h-0 rounded-xl border border-purple-800/40 bg-slate-900/60">
            <PromptRefinementChat
              currentPrompt={promptText}
              onApplyPrompt={handleApplyRefinedPrompt}
            />
          </div>

          {/* Bottom: Test Chat */}
          <div className="flex-1 min-h-0 rounded-xl border border-slate-800 bg-slate-900/60">
            <TestChat
              promptText={promptText}
              sectionKey={SECTION_MAP[selectedProduct]}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
