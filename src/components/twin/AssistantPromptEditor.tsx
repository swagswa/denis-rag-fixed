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

// Maps UI product keys → site_id in assistant_prompts table
const SITE_ID_MAP: Record<ProductContext, string> = {
  general: 'denismateev',
  foundry: 'foundry',
  aisovetnik: 'aisovetnik',
  aitransformation: 'aitransformation',
}

const SECTION_MAP: Record<ProductContext, string> = {
  general: 'denismateev.ru',
  foundry: 'agent-fo.lovableproject.com',
  aisovetnik: 'ai-advisor',
  aitransformation: 'ai-transformation',
}

export function AssistantPromptEditor() {
  const [selectedProduct, setSelectedProduct] = useState<ProductContext>('general')
  const [promptText, setPromptText] = useState('')
  const [promptsMap, setPromptsMap] = useState<Record<string, { id: string; text: string }>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showDefault, setShowDefault] = useState(false)

  // Load all prompts from assistant_prompts table
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('assistant_prompts')
        .select('id, site_id, system_prompt, active')
        .eq('active', true)

      if (error) console.error('Prompts load error:', error)

      const map: Record<string, { id: string; text: string }> = {}
      if (data) {
        data.forEach((row: any) => {
          map[row.site_id] = { id: row.id, text: row.system_prompt || '' }
        })
      }
      setPromptsMap(map)
      setLoading(false)
    }

    load()
  }, [])

  // When product selection changes, show the correct prompt
  useEffect(() => {
    const siteId = SITE_ID_MAP[selectedProduct]
    setPromptText(promptsMap[siteId]?.text || '')
    setShowDefault(false)
  }, [selectedProduct, promptsMap])

  const persistPrompt = async (product: ProductContext, value: string) => {
    const siteId = SITE_ID_MAP[product]
    const existing = promptsMap[siteId]

    if (existing) {
      // Update existing row
      const { error } = await supabase
        .from('assistant_prompts')
        .update({ system_prompt: value, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) throw error
      setPromptsMap(prev => ({ ...prev, [siteId]: { ...existing, text: value } }))
    } else {
      // Insert new row
      const { data, error } = await supabase
        .from('assistant_prompts')
        .insert({ site_id: siteId, system_prompt: value, active: true })
        .select('id')
        .single()
      if (error) throw error
      setPromptsMap(prev => ({ ...prev, [siteId]: { id: data.id, text: value } }))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await persistPrompt(selectedProduct, promptText)
      toast.success('Промпт сохранён')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleApplyRefinedPrompt = async (newPrompt: string) => {
    setPromptText(newPrompt)
    setSaving(true)
    try {
      await persistPrompt(selectedProduct, newPrompt)
      toast.success('Промпт обновлён и сохранён')
    } catch (e: any) {
      toast.error('Промпт обновлён, но не сохранился: ' + (e.message || 'ошибка'))
    } finally {
      setSaving(false)
    }
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
              {`Промпт для "${PRODUCT_OPTIONS.find(o => o.value === selectedProduct)?.label}".
Сохраняется в таблицу assistant_prompts (site_id = "${SITE_ID_MAP[selectedProduct]}").
Чат-ассистент на сайте читает этот промпт автоматически.`}
            </div>
          )}

          <textarea
            value={promptText}
            onChange={e => setPromptText(e.target.value)}
            placeholder={`Промпт для ${PRODUCT_OPTIONS.find(o => o.value === selectedProduct)?.label}...`}
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
          </div>
        </div>

        <div className="flex flex-col min-h-0 gap-3">
          <div className="flex-1 min-h-0 rounded-xl border border-purple-800/40 bg-slate-900/60">
            <PromptRefinementChat
              currentPrompt={promptText}
              onApplyPrompt={handleApplyRefinedPrompt}
            />
          </div>

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
