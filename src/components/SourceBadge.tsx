import { sources, type SourceKey } from '@/lib/sources'
import { cn } from '@/lib/utils'

export function SourceBadge({ source }: { source: SourceKey }) {
  const config = sources[source]
  if (!config) return null
  const Icon = config.icon

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium', config.bgClass, config.textClass)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  )
}
