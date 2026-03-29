import { useCallback, useEffect, useRef, useState } from 'react'
import { parseFile } from '@/lib/file-parser'
import { uploadDocument } from '@/lib/api'
import { emitDataChange } from '@/lib/events'

const MAX_CONCURRENT = 2

export interface UploadedFile {
  name: string
  status: 'queued' | 'parsing' | 'uploading' | 'success' | 'error'
  error?: string
  progress?: string
}

export function useFileUpload() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [showResults, setShowResults] = useState(false)
  const queueRef = useRef<File[]>([])
  const activeRef = useRef(0)

  useEffect(() => {
    if (files.length === 0) return
    const allDone = files.every((f) => f.status !== 'queued' && f.status !== 'parsing' && f.status !== 'uploading')
    if (allDone) {
      const timer = setTimeout(() => {
        setShowResults(false)
        setFiles([])
      }, 4000)
      return () => clearTimeout(timer)
    }
  }, [files])

  const updateFile = useCallback((name: string, updates: Partial<UploadedFile>) => {
    setFiles((prev) => prev.map((f) => (f.name === name ? { ...f, ...updates } : f)))
  }, [])

  const processNext = useCallback(async () => {
    if (activeRef.current >= MAX_CONCURRENT || queueRef.current.length === 0) return

    activeRef.current++
    const file = queueRef.current.shift()!

    try {
      updateFile(file.name, { status: 'parsing', progress: 'стр. 0/...' })
      console.log('[DWH] Parsing file:', file.name, file.type, file.size)
      const parsed = await parseFile(file, (current, total) => {
        updateFile(file.name, { progress: `стр. ${current}/${total}` })
      })
      console.log('[DWH] Parsed OK:', file.name, 'length:', parsed.text.length)

      updateFile(file.name, { status: 'uploading', progress: undefined })
      await uploadDocument(parsed, file.name, (chunk, totalChunks) => {
        updateFile(file.name, { progress: `часть ${chunk + 1}/${totalChunks}` })
      })
      console.log('[DWH] Uploaded OK:', file.name)

      updateFile(file.name, { status: 'success', progress: undefined })
      emitDataChange()
    } catch (err) {
      console.error('[DWH] Upload failed:', file.name, err)
      updateFile(file.name, { status: 'error', error: String(err), progress: undefined })
    } finally {
      activeRef.current--
      void processNext()
    }
  }, [updateFile])

  const uploadFiles = useCallback((fileList: File[]) => {
    if (fileList.length === 0) return

    const entries: UploadedFile[] = fileList.map((f) => ({ name: f.name, status: 'queued' as const }))
    setFiles((prev) => [...prev, ...entries])
    setShowResults(true)
    queueRef.current.push(...fileList)

    const toStart = Math.min(MAX_CONCURRENT - activeRef.current, fileList.length)
    for (let i = 0; i < toStart; i++) {
      void processNext()
    }
  }, [processNext])

  return { files, showResults, setShowResults, uploadFiles }
}
