import * as pdfjsLib from 'pdfjs-dist'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

// Use bundled worker via URL import (CDN doesn't have v4.x builds)
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker

const MAX_FILE_SIZE = 100 * 1024 * 1024

export interface ParseResult {
  text: string
  format: string
  pageCount?: number
}

type ProgressCallback = (current: number, total: number) => void

export async function parseFile(file: File, onProgress?: ProgressCallback): Promise<ParseResult> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`Файл слишком большой (макс. 100MB)`)
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || ''

  switch (ext) {
    case 'pdf': return parsePdf(file, onProgress)
    case 'docx': return parseDocx(file)
    case 'xlsx': return parseXlsx(file)
    case 'json': return parseText(file, 'json')
    case 'txt':
    case 'md':
    case 'csv': return parseText(file, ext)
    default: throw new Error(`Неподдерживаемый формат: .${ext}`)
  }
}

async function parsePdf(file: File, onProgress?: ProgressCallback): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const pages: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ')
    pages.push(text)
    onProgress?.(i, pdf.numPages)
  }

  return { text: pages.join('\n\n'), format: 'pdf', pageCount: pdf.numPages }
}

async function parseDocx(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return { text: result.value, format: 'docx' }
}

async function parseXlsx(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const parts: string[] = []

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    const csv = XLSX.utils.sheet_to_csv(sheet)
    parts.push(`--- ${name} ---\n${csv}`)
  }

  return { text: parts.join('\n\n'), format: 'xlsx' }
}

async function parseText(file: File, format: string): Promise<ParseResult> {
  const text = await file.text()
  return { text, format }
}
