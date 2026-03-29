import { useCallback, useEffect, useState } from 'react'
import { Upload, Check, AlertCircle, Loader2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFileUpload } from '@/hooks/useFileUpload'

const MAX_FILES = 50
const ACCEPTED_EXT = ['json', 'txt', 'md', 'csv', 'pdf', 'docx', 'xlsx']

export function GlobalDropZone({ children }: { children: React.ReactNode }) {
  const [dragOver, setDragOver] = useState(false)
  const { files, showResults, uploadFiles } = useFileUpload()

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const fileList = e.dataTransfer?.files
    if (!fileList) return
    const valid = Array.from(fileList)
      .filter((f) => { const ext = f.name.split('.').pop()?.toLowerCase(); return ext && ACCEPTED_EXT.includes(ext) })
      .slice(0, MAX_FILES)
    if (valid.length > 0) uploadFiles(valid)
  }, [uploadFiles])

  const handleDragOver = useCallback((e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }, [])
  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    if (e.relatedTarget === null || !(e.relatedTarget instanceof Node)) setDragOver(false)
  }, [])

  useEffect(() => {
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
    }
  }, [handleDragOver, handleDragLeave, handleDrop])

  return (
    <>
      {children}
      {dragOver && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-blue-500/40 bg-blue-500/5 px-16 py-12">
            <Upload className="h-12 w-12 text-blue-400" />
            <p className="text-lg font-medium text-slate-200">Отпустите файлы для загрузки</p>
            <p className="text-sm text-slate-400">JSON, TXT, MD, CSV, PDF, DOCX, XLSX — до 50 файлов</p>
          </div>
        </div>
      )}
      {showResults && files.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[101] w-80 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-800/50 text-xs font-medium text-slate-300">Загрузка файлов</div>
          <div className="max-h-60 overflow-y-auto p-2 space-y-1">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg px-3 py-1.5">
                {f.status === 'queued' && <Clock className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
                {(f.status === 'parsing' || f.status === 'uploading') && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-400" />}
                {f.status === 'success' && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                {f.status === 'error' && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                <div className="min-w-0 flex-1">
                  <span className={cn('block truncate text-xs', f.status === 'error' ? 'text-red-300' : 'text-slate-300')}>{f.name}</span>
                  {f.progress && <span className="text-[10px] text-slate-500">{f.progress}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
