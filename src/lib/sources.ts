import { MessageSquare, Mail, Send, Globe, FileText } from 'lucide-react'

export const sources = {
  chatgpt: { label: 'ChatGPT', icon: MessageSquare, color: 'emerald', bgClass: 'bg-emerald-500/10', textClass: 'text-emerald-500', borderClass: 'border-emerald-500/30' },
  gmail: { label: 'Gmail', icon: Mail, color: 'red', bgClass: 'bg-red-500/10', textClass: 'text-red-500', borderClass: 'border-red-500/30' },
  telegram: { label: 'Telegram', icon: Send, color: 'sky', bgClass: 'bg-sky-500/10', textClass: 'text-sky-500', borderClass: 'border-sky-500/30' },
  sites: { label: 'Сайты', icon: Globe, color: 'amber', bgClass: 'bg-amber-500/10', textClass: 'text-amber-500', borderClass: 'border-amber-500/30' },
  documents: { label: 'Документы', icon: FileText, color: 'violet', bgClass: 'bg-violet-500/10', textClass: 'text-violet-500', borderClass: 'border-violet-500/30' },
} as const

export type SourceKey = keyof typeof sources
