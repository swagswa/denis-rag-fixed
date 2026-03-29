import { useEffect, useRef, useState } from 'react'
import { X, Calendar, Clock, ChevronDown, User, Bot, Wrench, FileText, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SourceBadge } from '@/components/SourceBadge'
import type { SourceKey } from '@/lib/sources'
import { supabase } from '@/lib/supabase'

export interface Document {
  id: string
  source: SourceKey
  source_id: string
  title: string
  content: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface ChatMessage {
  role: string
  content: string
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isTool = message.role === 'tool'

  const icon = isUser ? (
    <User className="h-4 w-4" />
  ) : isTool ? (
    <Wrench className="h-4 w-4" />
  ) : (
    <Bot className="h-4 w-4" />
  )

  const label = isUser ? 'Вы' : isSystem ? 'Система' : isTool ? 'Инструмент' : 'ChatGPT'

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? 'bg-blue-500/20 text-blue-400'
            : isSystem
              ? 'bg-amber-500/20 text-amber-400'
              : isTool
                ? 'bg-purple-500/20 text-purple-400'
                : 'bg-emerald-500/20 text-emerald-400'
        }`}
      >
        {icon}
      </div>

      {/* Bubble */}
      <div className={`max-w-[85%] min-w-0 ${isUser ? 'items-end' : ''}`}>
        <p className={`mb-1 text-[11px] font-medium ${
          isUser ? 'text-right text-blue-400' : isSystem ? 'text-amber-400' : isTool ? 'text-purple-400' : 'text-emerald-400'
        }`}>
          {label}
        </p>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'rounded-tr-sm bg-blue-500/15 text-slate-200'
              : isSystem
                ? 'rounded-tl-sm bg-amber-500/10 text-slate-300'
                : isTool
                  ? 'rounded-tl-sm bg-purple-500/10 text-slate-300'
                  : 'rounded-tl-sm bg-slate-800/80 text-slate-300'
          }`}
        >
          <div className="chat-markdown break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChatView({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map((msg, i) => (
        <ChatBubble key={i} message={msg} />
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Telegram message view                                                      */
/* -------------------------------------------------------------------------- */

interface TelegramMessage {
  id: number
  date: string
  from: string
  text: string
}

function TelegramMessageBubble({ msg }: { msg: TelegramMessage }) {
  const time = msg.date
    ? new Date(msg.date).toLocaleString('ru-RU', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    : ''

  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-400">
        <User className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-medium text-sky-400">{msg.from}</span>
          {time && <span className="text-[10px] text-slate-500">{time}</span>}
        </div>
        <div className="rounded-2xl rounded-tl-sm bg-slate-800/80 px-4 py-2.5 text-sm leading-relaxed text-slate-300">
          <div className="chat-markdown break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}

function TelegramView({ messages }: { messages: TelegramMessage[] }) {
  return (
    <div className="flex flex-col gap-3">
      {messages.map((msg) => (
        <TelegramMessageBubble key={msg.id} msg={msg} />
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Site content view — clean markdown rendering for parsed websites           */
/* -------------------------------------------------------------------------- */

function cleanSiteContent(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')        // remove markdown images
    .replace(/\[([^\]]+)\]\(blob:[^)]+\)/g, '$1') // remove blob links, keep text
    .replace(/^\s*[\-\*]{3,}\s*$/gm, '')          // remove horizontal rules
    .replace(/\n{3,}/g, '\n\n')                   // collapse 3+ newlines to 2
    .trim()
}

function SiteContentView({ content, query }: { content: string; query?: string }) {
  const cleaned = cleanSiteContent(content)

  if (query) {
    return <PlainTextView text={cleaned} query={query} />
  }

  return (
    <div className="site-content text-sm leading-relaxed text-slate-300 space-y-4 [&>h1]:text-xl [&>h1]:font-bold [&>h1]:text-slate-100 [&>h1]:mt-6 [&>h1]:mb-3 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:text-slate-100 [&>h2]:mt-5 [&>h2]:mb-2 [&>h3]:text-base [&>h3]:font-semibold [&>h3]:text-slate-200 [&>h3]:mt-4 [&>h3]:mb-2 [&>h4]:text-sm [&>h4]:font-semibold [&>h4]:text-slate-200 [&>h4]:mt-3 [&>h4]:mb-1 [&>p]:text-slate-300 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:space-y-1.5 [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:space-y-1.5 [&>blockquote]:border-l-2 [&>blockquote]:border-slate-600 [&>blockquote]:pl-4 [&>blockquote]:italic [&>blockquote]:text-slate-400 [&_a]:text-blue-400 [&_a]:underline [&_a]:underline-offset-2 [&>hr]:hidden [&_img]:hidden">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Format-specific content renderers                                         */
/* -------------------------------------------------------------------------- */

function CsvTable({ text }: { text: string }) {
  const sections = text.split(/^--- (.+) ---$/m)
  const tables: { name: string; rows: string[][] }[] = []

  if (sections.length > 1) {
    // XLSX with sheet names: ['', 'Sheet1', 'data...', 'Sheet2', 'data...']
    for (let i = 1; i < sections.length; i += 2) {
      const name = sections[i].trim()
      const csv = (sections[i + 1] || '').trim()
      if (csv) tables.push({ name, rows: parseCsvRows(csv) })
    }
  } else {
    tables.push({ name: '', rows: parseCsvRows(text) })
  }

  return (
    <div className="space-y-6">
      {tables.map((t, idx) => (
        <div key={idx}>
          {t.name && (
            <h3 className="mb-2 text-sm font-semibold text-slate-300">{t.name}</h3>
          )}
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              {t.rows.length > 0 && (
                <thead>
                  <tr className="bg-slate-800/60">
                    {t.rows[0].map((cell, ci) => (
                      <th key={ci} className="px-3 py-2 text-left text-xs font-medium text-slate-400 whitespace-nowrap">
                        {cell || `Col ${ci + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {t.rows.slice(1).map((row, ri) => (
                  <tr key={ri} className="border-t border-slate-800/40 hover:bg-slate-800/20">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-1.5 text-slate-300 whitespace-nowrap">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function parseCsvRows(csv: string): string[][] {
  return csv
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.split(',').map((cell) => cell.trim()))
}

function JsonView({ text }: { text: string }) {
  let formatted: string
  try {
    formatted = JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    formatted = text
  }
  return (
    <pre className="rounded-lg bg-slate-950 p-4 text-sm text-slate-300 overflow-x-auto leading-relaxed">
      <code>{formatted}</code>
    </pre>
  )
}

function PlainTextView({ text, query }: { text: string; query?: string }) {
  const paragraphs = text.split(/\n{2,}/)
  return (
    <div className="space-y-4 text-sm leading-relaxed text-slate-300">
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {query ? <HighlightedText text={p.trim()} query={query} /> : p.trim()}
        </p>
      ))}
    </div>
  )
}

function DocumentContentView({ doc, query }: { doc: Document; query?: string }) {
  if (!doc.content) {
    return <p className="text-sm text-slate-500 italic">Нет содержимого</p>
  }

  const format = (doc.metadata as Record<string, unknown>)?.format as string | undefined

  switch (format) {
    case 'csv':
    case 'xlsx':
      return <CsvTable text={doc.content} />
    case 'json':
      return <JsonView text={doc.content} />
    case 'md':
    case 'pdf':
    case 'txt':
      return <PlainTextView text={doc.content} query={query} />
    default:
      return <PlainTextView text={doc.content} query={query} />
  }
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(re)
  let firstFound = false
  return (
    <>
      {parts.map((part, i) => {
        if (re.test(part)) {
          const isFirst = !firstFound
          firstFound = true
          return (
            <mark
              key={i}
              data-first={isFirst ? '' : undefined}
              className="bg-yellow-500/25 text-yellow-200 rounded-sm px-0.5"
            >
              {part}
            </mark>
          )
        }
        return part
      })}
    </>
  )
}

interface DocumentSheetProps {
  documentId: string | null
  onClose: () => void
  onDelete?: (id: string) => void
  searchQuery?: string
}

export function DocumentSheet({ documentId, onClose, onDelete, searchQuery }: DocumentSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [doc, setDoc] = useState<Document | null>(null)
  const [loading, setLoading] = useState(false)

  // Fetch full document when documentId changes
  useEffect(() => {
    if (!documentId) { setDoc(null); return }
    setLoading(true)
    supabase.from('documents').select('*').eq('id', documentId).single()
      .then(({ data }) => { setDoc(data as Document | null); setLoading(false) })
  }, [documentId])

  // Auto-scroll to first search match
  useEffect(() => {
    if (!doc || !searchQuery || !contentRef.current) return
    const timer = setTimeout(() => {
      const mark = contentRef.current?.querySelector('mark[data-first]')
      if (mark) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [doc, searchQuery])

  // Close on Escape
  useEffect(() => {
    if (!documentId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [documentId, onClose])

  // Lock body scroll when open
  useEffect(() => {
    if (documentId) {
      globalThis.document.body.classList.add('overflow-hidden')
    }
    return () => {
      globalThis.document.body.classList.remove('overflow-hidden')
    }
  }, [documentId])

  if (!documentId) return null

  const hasMetadata = doc?.metadata && Object.keys(doc.metadata).length > 0

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative z-10 flex h-full w-full max-w-2xl flex-col bg-slate-900 shadow-2xl animate-in slide-in-from-right duration-300"
      >
        {loading && (
          <>
            <div className="flex items-center justify-end border-b border-slate-800/40 px-6 py-4">
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-1 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
            </div>
          </>
        )}

        {/* Header + Content — only rendered once doc is loaded */}
        {!loading && doc && (<>
        <div className="flex items-start gap-3 border-b border-slate-800/40 px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <SourceBadge source={doc.source} />
              {doc.source === 'chatgpt' && doc.metadata && (doc.metadata as Record<string, unknown>).project_name ? (
                <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                  {String((doc.metadata as Record<string, unknown>).project_name)}
                </span>
              ) : null}
            </div>
            <h2 className="text-lg font-semibold leading-snug text-slate-100">
              {doc.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {formatDate(doc.created_at)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(doc.updated_at)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {onDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-1.5 mr-2">
                  <button
                    onClick={() => { onDelete(doc.id); setConfirmDelete(false) }}
                    className="rounded-md bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
                  >
                    Удалить
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-700"
                  >
                    Отмена
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-5">
          {/* File info bar for uploaded documents */}
          {doc.source === 'documents' && doc.metadata && (
            <div className="mb-4 flex items-center gap-3 rounded-lg bg-slate-800/50 px-4 py-2.5 text-xs text-slate-400">
              <FileText className="h-4 w-4 text-violet-400" />
              <span className="font-medium text-slate-300">
                {(doc.metadata as Record<string, unknown>).filename as string || doc.title}
              </span>
              {typeof (doc.metadata as Record<string, unknown>).format === 'string' && (
                <span className="rounded bg-violet-500/10 px-2 py-0.5 text-violet-400 uppercase">
                  {(doc.metadata as Record<string, unknown>).format as string}
                </span>
              )}
              {(doc.metadata as Record<string, unknown>).pageCount != null && (
                <span>{String((doc.metadata as Record<string, unknown>).pageCount)} стр.</span>
              )}
            </div>
          )}

          {doc.source === 'chatgpt' && Array.isArray((doc.metadata as Record<string, unknown>)?.messages) ? (
            <ChatView messages={(doc.metadata as Record<string, unknown>).messages as ChatMessage[]} />
          ) : doc.source === 'telegram' && Array.isArray((doc.metadata as Record<string, unknown>)?.messages) ? (
            <TelegramView messages={(doc.metadata as Record<string, unknown>).messages as TelegramMessage[]} />
          ) : doc.source === 'documents' ? (
            <DocumentContentView doc={doc} query={searchQuery} />
          ) : doc.source === 'sites' && doc.content ? (
            <SiteContentView content={doc.content} query={searchQuery} />
          ) : doc.content ? (
            searchQuery ? (
              <PlainTextView text={doc.content} query={searchQuery} />
            ) : (
              <div className="chat-markdown text-sm leading-relaxed text-slate-300">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
              </div>
            )
          ) : (
            <p className="text-sm text-slate-500 italic">Нет содержимого</p>
          )}

          {/* Metadata */}
          {hasMetadata && (
            <details className="mt-6 group">
              <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500 select-none hover:text-slate-400 transition-colors">
                <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
                Метаданные
              </summary>
              <pre className="mt-3 rounded-lg bg-slate-950 p-4 text-xs text-slate-500 overflow-x-auto">
                {JSON.stringify(doc.metadata, null, 2)}
              </pre>
            </details>
          )}
        </div>
        </>)}
      </div>
    </div>
  )
}
