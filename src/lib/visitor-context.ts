import type { VisitorContext } from './chat-stream'

const VISIT_COUNT_KEY = 'dm-visit-count'
const PAGES_KEY = 'dm-pages-viewed'
const PAGE_LOAD_TIME = Date.now()

function getDevice(): 'mobile' | 'tablet' | 'desktop' {
  const w = window.innerWidth
  if (w < 768) return 'mobile'
  if (w < 1024) return 'tablet'
  return 'desktop'
}

function getTimeOfDay(): { slot: VisitorContext['timeOfDay']; hour: number } {
  const hour = new Date().getHours()
  if (hour >= 6 && hour < 12) return { slot: 'morning', hour }
  if (hour >= 12 && hour < 17) return { slot: 'afternoon', hour }
  if (hour >= 17 && hour < 22) return { slot: 'evening', hour }
  return { slot: 'night', hour }
}

function getUtm(key: string): string {
  try {
    return new URLSearchParams(window.location.search).get(key) || ''
  } catch {
    return ''
  }
}

function trackVisit(): { isReturning: boolean; visitCount: number } {
  try {
    const prev = parseInt(localStorage.getItem(VISIT_COUNT_KEY) || '0', 10)
    const next = prev + 1
    localStorage.setItem(VISIT_COUNT_KEY, String(next))
    return { isReturning: prev > 0, visitCount: next }
  } catch {
    return { isReturning: false, visitCount: 1 }
  }
}

function getPagesViewed(): string[] {
  try {
    const raw = sessionStorage.getItem(PAGES_KEY)
    const pages: string[] = raw ? JSON.parse(raw) : []
    const current = window.location.pathname
    if (!pages.includes(current)) {
      pages.push(current)
      sessionStorage.setItem(PAGES_KEY, JSON.stringify(pages))
    }
    return pages
  } catch {
    return [window.location.pathname]
  }
}

function getScrollDepth(): number {
  try {
    const scrollTop = window.scrollY || document.documentElement.scrollTop
    const docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
    const winHeight = window.innerHeight
    if (docHeight <= winHeight) return 100
    return Math.round((scrollTop / (docHeight - winHeight)) * 100)
  } catch {
    return 0
  }
}

function getReferrer(): string {
  try {
    const ref = document.referrer
    if (!ref) return ''
    const url = new URL(ref)
    if (url.hostname === window.location.hostname) return ''
    return ref
  } catch {
    return document.referrer || ''
  }
}

function getCurrentSection(): string {
  const params = new URLSearchParams(window.location.search)
  if (params.get('embed') === 'true') {
    return decodeURIComponent(params.get('pageSection') || 'главная')
  }
  const hash = window.location.hash.replace('#', '')
  if (hash) return hash
  const path = window.location.pathname.replace(/^\//, '').replace(/\/$/, '')
  return path || 'главная'
}

export function collectVisitorContext(): VisitorContext {
  const { slot, hour } = getTimeOfDay()
  const { isReturning, visitCount } = trackVisit()

  return {
    referrer: getReferrer(),
    utmSource: getUtm('utm_source'),
    utmMedium: getUtm('utm_medium'),
    utmCampaign: getUtm('utm_campaign'),
    utmContent: getUtm('utm_content'),
    device: getDevice(),
    language: navigator.language || 'ru',
    timeOfDay: slot,
    localHour: hour,
    isReturning,
    visitCount,
    pagesViewed: getPagesViewed(),
    currentSection: getCurrentSection(),
    scrollDepthPercent: getScrollDepth(),
    secondsOnPage: Math.round((Date.now() - PAGE_LOAD_TIME) / 1000),
  }
}
