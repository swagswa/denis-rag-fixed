export type AssistantSiteKey = 'foundry' | 'denismateev' | 'aisovetnik' | 'aitransformation' | 'twin' | 'preview' | 'unknown'

export function normalizeAssistantPage(page?: string | null) {
  return (page || '').toLowerCase()
}

export function classifyAssistantSite(page?: string | null): AssistantSiteKey {
  const normalized = normalizeAssistantPage(page)

  if (!normalized) return 'unknown'
  if (normalized.includes('foundry') || normalized.includes('agent-fo') || normalized.includes('ai-foundry')) return 'foundry'
  if (normalized.includes('ai-advisor') || normalized.includes('aisovetnik') || normalized.includes('ai-sovetnik')) return 'aisovetnik'
  if (normalized.includes('ai-transformation') || normalized.includes('aitransformation') || normalized.includes('ai-transform')) return 'aitransformation'
  if (normalized.includes('denismateev') || normalized.includes('tilda')) return 'denismateev'
  if (normalized.includes('twin-assistant')) return 'twin'
  if (normalized.includes('/chat-embed') || normalized.includes('lovable.app') || normalized.includes('lovableproject.com')) return 'preview'

  return 'unknown'
}

export function getAssistantSiteLabelByKey(site: AssistantSiteKey) {
  switch (site) {
    case 'foundry':
      return 'Foundry'
    case 'denismateev':
      return 'denismateev.ru'
    case 'aisovetnik':
      return 'AI-Советник'
    case 'aitransformation':
      return 'AI-Трансформация'
    case 'twin':
      return 'DWH Ассистент'
    case 'preview':
      return 'Preview / embed'
    default:
      return 'Не определено'
  }
}

export function getAssistantSiteLabel(page?: string | null) {
  return getAssistantSiteLabelByKey(classifyAssistantSite(page))
}

export function getAssistantSiteOrder(site: AssistantSiteKey) {
  switch (site) {
    case 'foundry':
      return 0
    case 'denismateev':
      return 1
    case 'aisovetnik':
      return 2
    case 'aitransformation':
      return 3
    case 'twin':
      return 4
    case 'preview':
      return 5
    default:
      return 6
  }
}