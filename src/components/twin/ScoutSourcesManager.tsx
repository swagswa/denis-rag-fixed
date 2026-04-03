import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Plus, Trash2, Play, Globe, Search } from 'lucide-react'

type Source = {
  id: string
  name: string
  url_template: string
  category: string
  factory: string
  enabled: boolean
  scrape_method: string
  created_at: string
}

const CATEGORIES = [
  'vacancies', 'business_media', 'tenders', 'direct_demand',
  'vendor_exit', 'global_startups', 'ru_demand',
]

export function ScoutSourcesManager({ factory = 'consulting' }: { factory?: string }) {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newCategory, setNewCategory] = useState('business_media')
  const [newMethod, setNewMethod] = useState<'scrape' | 'search'>('scrape')
  const [testing, setTesting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('scout_sources')
      .select('*')
      .eq('factory', factory)
      .order('category')
    if (error) toast.error(error.message)
    setSources((data as Source[]) || [])
    setLoading(false)
  }, [factory])

  useEffect(() => { load() }, [load])

  const toggleEnabled = async (id: string, enabled: boolean) => {
    const { error } = await supabase
      .from('scout_sources')
      .update({ enabled: !enabled })
      .eq('id', id)
    if (error) toast.error(error.message)
    else {
      setSources(prev => prev.map(s => s.id === id ? { ...s, enabled: !enabled } : s))
      toast.success(enabled ? 'Отключён' : 'Включён')
    }
  }

  const addSource = async () => {
    if (!newName.trim() || !newUrl.trim()) return
    const { error } = await supabase.from('scout_sources').insert({
      name: newName.trim(),
      url_template: newUrl.trim(),
      category: newCategory,
      factory,
      scrape_method: newMethod,
      enabled: true,
    })
    if (error) toast.error(error.message)
    else {
      toast.success('Источник добавлен')
      setNewName('')
      setNewUrl('')
      setShowAdd(false)
      load()
    }
  }

  const deleteSource = async (id: string) => {
    const { error } = await supabase.from('scout_sources').delete().eq('id', id)
    if (error) toast.error(error.message)
    else {
      setSources(prev => prev.filter(s => s.id !== id))
      toast.success('Удалён')
    }
  }

  const testSource = async (source: Source) => {
    setTesting(source.id)
    try {
      const FIRECRAWL_API_KEY = prompt('Введи Firecrawl API key для теста:')
      if (!FIRECRAWL_API_KEY) { setTesting(null); return }

      const endpoint = source.scrape_method === 'scrape'
        ? 'https://api.firecrawl.dev/v1/scrape'
        : 'https://api.firecrawl.dev/v1/search'

      const body = source.scrape_method === 'scrape'
        ? { url: source.url_template, formats: ['markdown'], onlyMainContent: true }
        : { query: source.url_template, limit: 5, lang: 'ru', country: 'RU' }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      const preview = source.scrape_method === 'scrape'
        ? (data?.data?.markdown || '').slice(0, 500)
        : JSON.stringify(data?.data?.slice(0, 3) || data?.results?.slice(0, 3), null, 2).slice(0, 500)

      toast.success(`Тест OK: ${preview.slice(0, 100)}...`)
      console.log('[test source]', source.name, preview)
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`)
    }
    setTesting(null)
  }

  if (loading) return <div className="flex h-32 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" /></div>

  const grouped = CATEGORIES.reduce((acc, cat) => {
    const items = sources.filter(s => s.category === cat)
    if (items.length > 0) acc[cat] = items
    return acc
  }, {} as Record<string, Source[]>)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-100">Источники скаута</h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" /> Добавить
        </button>
      </div>

      {showAdd && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-3">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Название (напр. hh.ru: AI)"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <input
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            placeholder="URL или поисковый запрос"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <div className="flex gap-3">
            <select
              value={newCategory}
              onChange={e => setNewCategory(e.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={newMethod}
              onChange={e => setNewMethod(e.target.value as 'scrape' | 'search')}
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              <option value="scrape">Scrape (URL)</option>
              <option value="search">Search (запрос)</option>
            </select>
            <button onClick={addSource} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500">
              Сохранить
            </button>
          </div>
        </div>
      )}

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat}>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">{cat}</h4>
          <div className="space-y-1">
            {items.map(source => (
              <div
                key={source.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                  source.enabled
                    ? 'border-slate-700 bg-slate-800/50 text-slate-200'
                    : 'border-slate-800 bg-slate-900/50 text-slate-500'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {source.scrape_method === 'scrape'
                    ? <Globe className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
                    : <Search className="h-3.5 w-3.5 flex-shrink-0 text-purple-400" />
                  }
                  <span className="truncate font-medium">{source.name}</span>
                  <span className="truncate text-xs text-slate-500 hidden md:inline">{source.url_template.slice(0, 60)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => testSource(source)}
                    disabled={testing === source.id}
                    className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-50"
                    title="Тест"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => toggleEnabled(source.id, source.enabled)}
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      source.enabled ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {source.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => deleteSource(source.id)}
                    className="rounded p-1 text-slate-500 hover:bg-red-500/20 hover:text-red-400"
                    title="Удалить"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {sources.length === 0 && (
        <p className="text-center text-sm text-slate-500 py-8">Нет источников. Добавьте первый.</p>
      )}
    </div>
  )
}
