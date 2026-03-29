import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, SearchX } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { sources, type SourceKey } from '@/lib/sources'
import { SourceBadge } from '@/components/SourceBadge'
import { EmptyState } from '@/components/EmptyState'
import { DocumentSheet } from '@/components/DocumentSheet'
import { cn } from '@/lib/utils'
import { onDataChange } from '@/lib/events'

type TabKey = 'all' | SourceKey

// Slim type for search result rows — content included for snippets, no full metadata
interface SearchResultItem {
  id: string
  source: SourceKey
  source_id: string
  title: string
  content: string | null
  created_at: string
  updated_at: string
  project_name?: string | null
}

const tabs: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'gmail', label: 'Gmail' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'sites', label: 'Сайты' },
  { key: 'documents', label: 'Документы' },
]

function getTabClasses(key: TabKey, active: boolean) {
  if (!active) {
    return 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-slate-300'
  }
  if (key === 'all') {
    return 'bg-blue-500/15 text-blue-400'
  }
  const src = sources[key as SourceKey]
  // Map source bgClass/textClass to active tab style
  return `${src.bgClass} ${src.textClass}`
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'только что'
  if (mins < 60) return `${mins} мин назад`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} дн назад`
  return new Date(iso).toLocaleDateString('ru-RU')
}

function highlightText(text: string, query: string) {
  if (!query.trim()) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(re)
  return parts.map((part, i) =>
    re.test(part) ? (
      <mark key={i} className="bg-yellow-500/20 text-yellow-200 rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-lg bg-slate-900/50 p-4 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-5 w-20 rounded-md bg-slate-800" />
        <div className="h-4 w-16 rounded bg-slate-800" />
      </div>
      <div className="h-5 w-3/4 rounded bg-slate-800 mb-2" />
      <div className="h-4 w-full rounded bg-slate-800" />
      <div className="h-4 w-2/3 rounded bg-slate-800 mt-1" />
    </div>
  )
}

function getInitialParams() {
  const params = new URLSearchParams(window.location.search)
  return {
    q: params.get('q') || '',
    tab: (params.get('tab') || 'all') as TabKey,
  }
}

function syncSearchParams(q: string, tab: TabKey) {
  const params = new URLSearchParams(window.location.search)
  if (q) params.set('q', q)
  else params.delete('q')
  if (tab !== 'all') params.set('tab', tab)
  else params.delete('tab')
  const qs = params.toString()
  const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
  window.history.replaceState({}, '', url)
}

export function SearchPage() {
  const initial = getInitialParams()
  const [searchText, setSearchText] = useState(initial.q)
  const [debouncedText, setDebouncedText] = useState(initial.q)
  const [activeTab, setActiveTab] = useState<TabKey>(initial.tab)
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [projects, setProjects] = useState<string[]>([])
  const [activeProject, setActiveProject] = useState<string>('all')

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedText(searchText), 300)
    return () => clearTimeout(timer)
  }, [searchText])

  // Sync state to URL
  useEffect(() => {
    syncSearchParams(debouncedText, activeTab)
  }, [debouncedText, activeTab])

  // Fetch unique project names when ChatGPT tab is active
  useEffect(() => {
    if (activeTab !== 'chatgpt') {
      setProjects([])
      setActiveProject('all')
      return
    }
    const fetchProjects = async () => {
      const { data } = await supabase
        .from('documents')
        .select('metadata->>project_name')
        .eq('source', 'chatgpt')
      const allNames = (data || []).map((d: any) => d.project_name as string | null)
      const named = allNames.filter((n): n is string => !!n && n !== 'null')
      const hasNoProject = allNames.length > named.length
      const names = [...new Set(named)].sort()
      if (hasNoProject) names.unshift('__no_project__')
      setProjects(names)
    }
    void fetchProjects()
  }, [activeTab])

  // Fetch
  const fetchResults = useCallback(async (text: string, source: TabKey, project: string) => {
    // Cancel previous request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setHasSearched(true)

    let query = supabase
      .from('documents')
      .select('id, source, source_id, title, content, created_at, updated_at, metadata->project_name')
      .order('updated_at', { ascending: false })
      .limit(50)

    if (text) {
      query = query.or(`title.ilike.%${text}%,content.ilike.%${text}%`)
    }
    if (source !== 'all') {
      query = query.eq('source', source)
    }
    if (source === 'chatgpt' && project !== 'all') {
      if (project === '__no_project__') {
        query = query.or('metadata->>project_name.is.null,metadata->>project_name.eq.')
      } else {
        query = query.eq('metadata->>project_name', project)
      }
    }

    const { data, error } = await query

    // If aborted, don't update state
    if (controller.signal.aborted) return

    if (!error && data) {
      setResults((data as any) as SearchResultItem[])
    } else {
      setResults([])
    }
    setLoading(false)
  }, [])

  // Reset state when search is cleared
  const shouldReset = !debouncedText && activeTab === 'all'
  if (shouldReset && hasSearched) {
    setHasSearched(false)
    setResults([])
    setLoading(false)
  }

  // Trigger search on debounced text, tab, or project change
  useEffect(() => {
    if (!debouncedText && activeTab === 'all') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchResults is async data fetching, setState in callback is intentional
    fetchResults(debouncedText, activeTab, activeProject)
  }, [debouncedText, activeTab, activeProject, fetchResults])

  // Refresh results when data changes externally (after sync/upload)
  useEffect(() => {
    return onDataChange(() => {
      if (debouncedText || activeTab !== 'all') {
        void fetchResults(debouncedText, activeTab, activeProject)
      }
    })
  }, [debouncedText, activeTab, activeProject, fetchResults])

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <>
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        {/* Search bar */}
        <div className="mx-auto w-full max-w-2xl">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              ref={inputRef}
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Поиск по документам..."
              className="w-full rounded-xl border-0 bg-slate-900/50 p-4 pl-12 text-lg text-slate-100 placeholder:text-slate-500 outline-none transition-all duration-200 focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

        {/* Source tabs */}
        <div className="mx-auto mt-5 flex w-full max-w-2xl flex-wrap gap-2">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150',
                getTabClasses(key, activeTab === key),
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Project sub-filter (ChatGPT only) */}
        {activeTab === 'chatgpt' && projects.length > 0 && (
          <div className="mx-auto mt-3 flex w-full max-w-2xl flex-wrap gap-1.5">
            <button
              onClick={() => setActiveProject('all')}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeProject === 'all'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-300'
              }`}
            >
              Все
            </button>
            {projects.map((p) => (
              <button
                key={p}
                onClick={() => setActiveProject(p)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeProject === p
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-300'
                }`}
              >
                {p === '__no_project__' ? 'Без проекта' : p}
              </button>
            ))}
          </div>
        )}

        {/* Results area */}
        <div className="mt-8 space-y-3">
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : !hasSearched ? (
            <EmptyState
              icon={Search}
              title="Поиск по документам"
              description="Введите запрос для поиска по всем источникам"
              className="py-24"
            />
          ) : results.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Ничего не найдено"
              description="Попробуйте изменить запрос или выбрать другой источник"
              className="py-24"
            />
          ) : (
            results.map((doc) => {
              const snippet = doc.content
                ? doc.content.length > 150
                  ? doc.content.slice(0, 150) + '...'
                  : doc.content
                : ''

              return (
                <button
                  key={doc.id}
                  onClick={() => setSelectedDocId(doc.id)}
                  className="w-full cursor-pointer rounded-lg bg-slate-900/50 p-4 text-left transition-colors duration-150 hover:bg-slate-800/50"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <SourceBadge source={doc.source} />
                    <span className="text-sm text-slate-500">
                      {relativeTime(doc.updated_at)}
                    </span>
                  </div>
                  <h3 className="text-base font-medium text-slate-100">
                    {debouncedText ? highlightText(doc.title, debouncedText) : doc.title}
                  </h3>
                  {snippet && (
                    <p className="mt-1 text-sm text-slate-400 line-clamp-2">
                      {debouncedText ? highlightText(snippet, debouncedText) : snippet}
                    </p>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Document sheet */}
      <DocumentSheet
        documentId={selectedDocId}
        onClose={() => setSelectedDocId(null)}
        searchQuery={debouncedText}
        onDelete={async (id) => {
          await supabase.from('documents').delete().eq('id', id)
          setSelectedDocId(null)
          setResults((prev) => prev.filter((d) => d.id !== id))
        }}
      />
    </>
  )
}
