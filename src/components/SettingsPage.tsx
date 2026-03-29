import { useCallback, useEffect, useRef, useState } from 'react'
import { Mail, Globe, Upload, User, X, Check, AlertCircle, FileUp, Loader2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { edgeFetch } from '@/lib/api'
import { useFileUpload } from '@/hooks/useFileUpload'

/* -------------------------------------------------------------------------- */
/*  Shared card wrapper                                                        */
/* -------------------------------------------------------------------------- */

function SettingsCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Mail
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl bg-slate-900/50 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5">
        <Icon className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Gmail section                                                              */
/* -------------------------------------------------------------------------- */

function GmailSection() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Check if gmail credentials exist
    ;(supabase as any)
      .from('credentials')
      .select('id')
      .eq('id', 'gmail')
      .maybeSingle()
      .then(({ data }: any) => setConnected(!!data))
  }, [])

  const handleConnect = async () => {
    setLoading(true)
    try {
      const res = await edgeFetch('auth-gmail')
      const { url } = await res.json()
      if (url) window.location.href = url
    } catch (err) {
      console.error('Gmail auth error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    setLoading(true)
    try {
      await (supabase as any).from('credentials').delete().eq('id', 'gmail')
      setConnected(false)
    } catch (err) {
      console.error('Gmail disconnect error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <SettingsCard icon={Mail} title="Gmail">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {connected === null ? (
            <span className="text-xs text-slate-500">Проверка...</span>
          ) : connected ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
              <Check className="h-3 w-3" />
              Подключено
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-400">
              Не подключено
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              Отключить
            </button>
          )}
          {!connected && connected !== null && (
            <button
              onClick={handleConnect}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              Подключить Gmail
            </button>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}

/* -------------------------------------------------------------------------- */
/*  Sites section                                                              */
/* -------------------------------------------------------------------------- */

function SitesSection() {
  const [urls, setUrls] = useState<string[]>([])
  const [newUrl, setNewUrl] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(supabase as any)
      .from('credentials')
      .select('metadata')
      .eq('id', 'sites')
      .maybeSingle()
      .then(({ data }: any) => {
        if (data?.metadata?.urls) {
          setUrls(data.metadata.urls as string[])
        }
      })
  }, [])

  const saveUrls = useCallback(
    async (nextUrls: string[]) => {
      setSaving(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        await (supabase as any).from('credentials').upsert({
          user_id: user!.id,
          id: 'sites',
          metadata: { urls: nextUrls },
        }, { onConflict: 'user_id,id' })
        setUrls(nextUrls)
      } catch (err) {
        console.error('Save sites error:', err)
      } finally {
        setSaving(false)
      }
    },
    [],
  )

  const addUrl = () => {
    const trimmed = newUrl.trim()
    if (!trimmed || urls.includes(trimmed)) return
    const next = [...urls, trimmed]
    setNewUrl('')
    void saveUrls(next)
  }

  const removeUrl = (url: string) => {
    void saveUrls(urls.filter((u) => u !== url))
  }

  return (
    <SettingsCard icon={Globe} title="Сайты">
      <div className="space-y-3">
        {/* URL list */}
        {urls.length > 0 && (
          <div className="space-y-1.5">
            {urls.map((url) => (
              <div
                key={url}
                className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2"
              >
                <span className="truncate text-sm text-slate-300 mr-3">{url}</span>
                <button
                  onClick={() => removeUrl(url)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-700 hover:text-red-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add URL */}
        <div className="flex items-center gap-2">
          <input
            type="url"
            placeholder="https://example.com"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addUrl()}
            className="h-9 flex-1 rounded-lg border-0 bg-slate-800 px-3 text-sm text-slate-200 placeholder:text-slate-500 outline-none transition-colors focus:ring-1 focus:ring-slate-600"
          />
          <button
            onClick={addUrl}
            disabled={!newUrl.trim() || saving}
            className="flex items-center gap-1.5 rounded-md bg-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Добавить
          </button>
        </div>
      </div>
    </SettingsCard>
  )
}

/* -------------------------------------------------------------------------- */
/*  File Upload section                                                        */
/* -------------------------------------------------------------------------- */

const ACCEPTED_TYPES = '.json,.txt,.md,.csv,.pdf,.docx,.xlsx'
const MAX_FILES = 50

function FileUploadSection() {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { files, uploadFiles } = useFileUpload()

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return
    const selected = Array.from(fileList).slice(0, MAX_FILES)
    uploadFiles(selected)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <SettingsCard icon={Upload} title="Загрузка файлов">
      <div className="space-y-3">
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-200',
            dragOver
              ? 'border-blue-500/40 bg-blue-500/5'
              : 'border-slate-700/20 hover:border-slate-600/30 hover:bg-slate-800/30',
          )}
        >
          <FileUp className="mb-3 h-8 w-8 text-slate-500" />
          <p className="text-sm text-slate-300">
            Перетащите файлы сюда или нажмите для выбора
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            JSON, TXT, MD, CSV, PDF, DOCX, XLSX — до 50 файлов за раз
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES}
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
        </div>

        {/* Upload results */}
        {files.length > 0 && (
          <div className="space-y-1.5">
            {files.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                className="flex items-center gap-2.5 rounded-lg bg-slate-800/50 px-3 py-2"
              >
                {f.status === 'queued' && (
                  <Clock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                )}
                {(f.status === 'parsing' || f.status === 'uploading') && (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-400" />
                )}
                {f.status === 'success' && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                )}
                {f.status === 'error' && (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                )}
                <div className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm',
                      f.status === 'error' ? 'text-red-300' : 'text-slate-300',
                    )}
                  >
                    {f.name}
                  </span>
                  {f.progress && (
                    <span className="text-[10px] text-slate-500">{f.progress}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsCard>
  )
}

/* -------------------------------------------------------------------------- */
/*  Account section                                                            */
/* -------------------------------------------------------------------------- */

function AccountSection({
  userEmail,
  onLogout,
}: {
  userEmail?: string
  onLogout: () => void
}) {
  return (
    <SettingsCard icon={User} title="Аккаунт">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-300">{userEmail ?? 'Нет данных'}</span>
        <button
          onClick={onLogout}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
        >
          Выйти
        </button>
      </div>
    </SettingsCard>
  )
}

/* -------------------------------------------------------------------------- */
/*  Main settings page                                                         */
/* -------------------------------------------------------------------------- */

interface SettingsPageProps {
  userEmail?: string
  onLogout: () => void
}

export function SettingsPage({ userEmail, onLogout }: SettingsPageProps) {
  return (
    <div className="max-w-2xl space-y-6">
      <GmailSection />
      <SitesSection />
      <FileUploadSection />
      <AccountSection userEmail={userEmail} onLogout={onLogout} />
    </div>
  )
}
