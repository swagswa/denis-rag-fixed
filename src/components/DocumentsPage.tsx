import { useCallback, useEffect, useState } from 'react'
import { Search, FileText, ChevronLeft, ChevronRight, Trash2, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { type SourceKey } from '@/lib/sources'
import { SourceBadge } from '@/components/SourceBadge'
import { EmptyState } from '@/components/EmptyState'
import { DocumentSheet } from '@/components/DocumentSheet'
import { onDataChange } from '@/lib/events'

const PAGE_SIZE = 50

// Slim row type — only what's needed for the list view
interface DocListItem {
  id: string
  source: SourceKey
  source_id: string
  title: string
  created_at: string
  updated_at: string
  project_name?: string | null
}

const tabs: { key: 'all' | SourceKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'gmail', label: 'Gmail' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'sites', label: 'Сайты' },
  { key: 'documents', label: 'Документы' },
]

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'только что'
  if (mins < 60) return `${mins} мин. назад`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ч. назад`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} дн. назад`
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}


function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i}>
          <td className="px-4 py-3 w-32">
            <div className="h-5 w-20 animate-pulse rounded-md bg-slate-800" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 animate-pulse rounded bg-slate-800" style={{ width: `${60 + i * 8}%` }} />
          </td>
        </tr>
      ))}
    </>
  )
}

function getDocInitialParams() {
  const params = new URLSearchParams(window.location.search)
  return {
    q: params.get('q') || '',
    tab: (params.get('tab') || 'all') as 'all' | SourceKey,
    page: Math.max(0, parseInt(params.get('page') || '0', 10) || 0),
  }
}

function syncDocParams(q: string, tab: 'all' | SourceKey, pg: number) {
  const params = new URLSearchParams(window.location.search)
  if (q) params.set('q', q)
  else params.delete('q')
  if (tab !== 'all') params.set('tab', tab)
  else params.delete('tab')
  if (pg > 0) params.set('page', String(pg))
  else params.delete('page')
  const qs = params.toString()
  const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
  window.history.replaceState({}, '', url)
}

export function DocumentsPage() {
  const initial = getDocInitialParams()
  const [activeTab, setActiveTab] = useState<'all' | SourceKey>(initial.tab)
  const [searchQuery, setSearchQuery] = useState(initial.q)
  const [documents, setDocuments] = useState<DocListItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(initial.page)
  const [loading, setLoading] = useState(true)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [projects, setProjects] = useState<string[]>([])
  const [activeProject, setActiveProject] = useState<string>('all')

  // Sync state to URL
  useEffect(() => {
    syncDocParams(searchQuery, activeTab, page)
  }, [searchQuery, activeTab, page])

  // Fetch unique project names when ChatGPT tab is active
  useEffect(() => {
    if (activeTab !== 'chatgpt') {
      setProjects([])
      setActiveProject('all')
      return
    }
    const fetchProjects = async () => {
      // Use ->> to get text (not JSON) so nulls are real nulls, not "null" strings
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

  // Reset page when active project changes
  useEffect(() => {
    setPage(0)
  }, [activeProject])

  const fetchDocuments = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('documents')
        .select('id, source, source_id, title, created_at, updated_at, metadata->project_name', { count: 'exact' })
        .order('updated_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (activeTab !== 'all') {
        query = query.eq('source', activeTab)
      }
      if (activeTab === 'chatgpt' && activeProject !== 'all') {
        if (activeProject === '__no_project__') {
          query = query.or('metadata->>project_name.is.null,metadata->>project_name.eq.')
        } else {
          query = query.eq('metadata->>project_name', activeProject)
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim()
        query = query.or(`title.ilike.%${q}%,content.ilike.%${q}%`)
      }

      const { data, count, error } = await query
      if (error) throw error
      setDocuments(((data as any) as DocListItem[]) ?? [])
      setTotalCount(count ?? 0)
    } catch (err) {
      console.error('Failed to fetch documents:', err)
      setDocuments([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }, [activeTab, activeProject, searchQuery, page])

  useEffect(() => {
    void fetchDocuments()
  }, [fetchDocuments])

  useEffect(() => {
    return onDataChange(() => {
      void fetchDocuments()
    })
  }, [fetchDocuments])

  // Reset page when filter changes
  useEffect(() => {
    setPage(0)
  }, [activeTab, searchQuery, activeProject])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === documents.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(documents.map((d) => d.id)))
    }
  }

  const deleteSelected = async () => {
    if (selected.size === 0) return
    setDeleting(true)
    try {
      await supabase.from('documents').delete().in('id', Array.from(selected))
      setSelected(new Set())
      void fetchDocuments()
    } catch (err) {
      console.error('Delete failed:', err)
    } finally {
      setDeleting(false)
    }
  }

  const clearSource = async () => {
    if (activeTab === 'all') return
    setDeleting(true)
    try {
      await supabase.from('documents').delete().eq('source', activeTab)
      setSelected(new Set())
      void fetchDocuments()
    } catch (err) {
      console.error('Clear source failed:', err)
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const from = totalCount === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, totalCount)

  const isEmpty = !loading && documents.length === 0

  return (
    <div className="space-y-5">
      {/* Source Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-slate-900/50 p-1 w-fit">
        {tabs.map((tab) => {
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150',
                active
                  ? 'bg-slate-800 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50',
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Project sub-filter (ChatGPT only) */}
      {activeTab === 'chatgpt' && projects.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
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

      {/* Search + actions row */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Поиск по названию..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-lg border-0 bg-slate-800 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 outline-none transition-colors focus:ring-1 focus:ring-slate-600"
          />
        </div>

        <button
          onClick={() => {
            if (editMode) setSelected(new Set())
            setEditMode(!editMode)
          }}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
            editMode
              ? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300',
          )}
        >
          <Pencil className="h-3.5 w-3.5" />
          {editMode ? 'Готово' : 'Изменить'}
        </button>

        {editMode && selected.size > 0 && (
          <button
            onClick={deleteSelected}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Удалить ({selected.size})
          </button>
        )}

        {editMode && activeTab !== 'all' && totalCount > 0 && selected.size === 0 && (
          <button
            onClick={clearSource}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Очистить всё
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl bg-slate-900/50">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-800/50">
              {editMode && (
                <th className="px-4 py-2.5 w-10">
                  <div
                    onClick={selectAll}
                    className={cn(
                      'h-4 w-4 rounded border-2 flex items-center justify-center cursor-pointer transition-all',
                      documents.length > 0 && selected.size === documents.length
                        ? 'border-blue-500 bg-blue-500'
                        : 'border-slate-600 bg-slate-800/50 hover:border-slate-500',
                    )}
                  >
                    {documents.length > 0 && selected.size === documents.length && (
                      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </th>
              )}
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-400 w-32">
                Источник
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                Название
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : isEmpty ? (
              <tr>
                <td colSpan={editMode ? 3 : 2}>
                  <EmptyState
                    icon={FileText}
                    title="Нет документов"
                    description={
                      searchQuery
                        ? 'Попробуйте другой поисковый запрос'
                        : 'Документы появятся здесь после синхронизации'
                    }
                  />
                </td>
              </tr>
            ) : (
              documents.map((doc) => {
                return (
                  <tr
                    key={doc.id}
                    onClick={() => editMode ? toggleSelect(doc.id) : setSelectedDocId(doc.id)}
                    className={cn(
                      'transition-colors duration-150 hover:bg-slate-800/30 cursor-pointer',
                      editMode && selected.has(doc.id) && 'bg-blue-500/5',
                    )}
                  >
                    {editMode && (
                      <td className="px-4 py-3 w-10">
                        <div
                          className={cn(
                            'h-4 w-4 rounded border-2 flex items-center justify-center cursor-pointer transition-all',
                            selected.has(doc.id)
                              ? 'border-blue-500 bg-blue-500'
                              : 'border-slate-600 bg-slate-800/50 hover:border-slate-500',
                          )}
                        >
                          {selected.has(doc.id) && (
                            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-3 w-32">
                      <SourceBadge source={doc.source} />
                      {doc.source === 'chatgpt' && doc.project_name && (
                        <span className="ml-1.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                          {doc.project_name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-baseline gap-3">
                        <div className="min-w-0 flex-1">
                          <span className="truncate text-sm text-slate-200 block">
                            {doc.title}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-slate-500">
                            {relativeTime(doc.updated_at)}
                          </span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">
            Показано {from}–{to} из {totalCount}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className={cn(
                'flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-700',
                page === 0 && 'opacity-50 cursor-not-allowed hover:bg-slate-800',
              )}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Назад
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className={cn(
                'flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-700',
                page >= totalPages - 1 && 'opacity-50 cursor-not-allowed hover:bg-slate-800',
              )}
            >
              Далее
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Document Sheet */}
      <DocumentSheet
        documentId={selectedDocId}
        onClose={() => setSelectedDocId(null)}
        onDelete={async (id) => {
          await supabase.from('documents').delete().eq('id', id)
          setSelectedDocId(null)
          void fetchDocuments()
        }}
      />
    </div>
  )
}
