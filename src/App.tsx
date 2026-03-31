import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { edgeFetch } from '@/lib/api'
import { emitDataChange } from '@/lib/events'
import { LoginPage } from '@/components/LoginPage'
import { AppLayout } from '@/components/AppLayout'
import { DashboardPage } from '@/components/DashboardPage'
import type { PageKey } from '@/components/DwhSidebar'
import { SearchPage } from '@/components/SearchPage'
import { DocumentsPage } from '@/components/DocumentsPage'
import { SettingsPage } from '@/components/SettingsPage'
import { GlobalDropZone } from '@/components/GlobalDropZone'
import { TwinDashboard } from '@/components/twin/TwinDashboard'
import { TwinTeams } from '@/components/twin/TwinTeams'
import { TwinCases } from '@/components/twin/TwinCases'
import { TwinSignals } from '@/components/twin/TwinSignals'
import { TwinInsights } from '@/components/twin/TwinInsights'
import { TwinLeads } from '@/components/twin/TwinLeads'
import { TwinOpportunities } from '@/components/twin/TwinOpportunities'
import { AssistantStats } from '@/components/twin/AssistantStats'
import { AssistantDialogs } from '@/components/twin/AssistantDialogs'
import { AssistantPromptEditor } from '@/components/twin/AssistantPromptEditor'

const ALL_PAGES: PageKey[] = [
  'dashboard', 'search', 'documents', 'settings',
  'twin-dashboard', 'twin-teams',
  'consulting-scout', 'consulting-analyst', 'consulting-marketer', 'consulting-closer',
  'foundry-scout', 'foundry-analyst', 'foundry-builder',
  'twin-cases', 'twin-opportunities',
  'assistant-stats', 'assistant-dialogs', 'assistant-prompt',
]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState<PageKey>(() => {
    const hash = window.location.hash.replace('#', '') as PageKey
    return ALL_PAGES.includes(hash) ? hash : 'twin-dashboard'
  })

  useEffect(() => {
    window.location.hash = currentPage
  }, [currentPage])

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace('#', '') as PageKey
      if (ALL_PAGES.includes(hash)) {
        setCurrentPage(hash)
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { session: cached } } = await supabase.auth.getSession()
      setSession(cached)
      setLoading(false)

      supabase.auth.refreshSession().catch(() => {})

      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      if (code && cached) {
        try {
          await edgeFetch('auth-gmail', { method: 'POST', body: JSON.stringify({ code }) })
          emitDataChange()
        } catch (err) {
          console.error('Gmail OAuth exchange failed:', err)
        }
        window.history.replaceState({}, '', window.location.pathname + window.location.hash)
      }
    }
    void init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => { subscription.unsubscribe() }
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-2 text-slate-400">
          <div className="h-5 w-5 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
          <span className="text-sm">Загрузка...</span>
        </div>
      </div>
    )
  }

  if (!session) {
    return <LoginPage />
  }

  const renderPage = () => {
    switch (currentPage) {
      // Система
      case 'dashboard': return <DashboardPage />
      case 'search': return <SearchPage />
      case 'documents': return <DocumentsPage />
      case 'settings': return <SettingsPage userEmail={session.user.email} onLogout={() => supabase.auth.signOut()} />
      // Интерфейсы
      case 'twin-dashboard': return <TwinDashboard />
      case 'twin-teams': return <TwinTeams />
      // Кейсы и данные
      case 'twin-cases': return <TwinCases />
      case 'twin-opportunities': return <TwinOpportunities />
      // Factory agents
      case 'consulting-scout': return <TwinSignals factory="consulting" />
      case 'consulting-analyst': return <TwinInsights factory="consulting" role="analyst" />
      case 'consulting-marketer': return <TwinInsights factory="consulting" role="marketer" />
      case 'consulting-closer': return <TwinLeads />
      case 'foundry-scout': return <TwinSignals factory="foundry" />
      case 'foundry-analyst': return <TwinInsights factory="foundry" role="analyst" />
      case 'foundry-builder': return <TwinOpportunities />
      // Ассистент
      case 'assistant-stats': return <AssistantStats />
      case 'assistant-dialogs': return <AssistantDialogs />
      case 'assistant-prompt': return <AssistantPromptEditor />
      default: return <TwinDashboard />
    }
  }

  return (
    <GlobalDropZone>
      <AppLayout
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        userEmail={session.user.email}
        onLogout={() => supabase.auth.signOut()}
      >
        {renderPage()}
      </AppLayout>
    </GlobalDropZone>
  )
}
