import { Sidebar, type PageKey } from './DwhSidebar'
import { TopBar } from './DwhTopBar'

interface AppLayoutProps {
  currentPage: PageKey
  onNavigate: (page: PageKey) => void
  userEmail?: string
  onLogout: () => void
  children: React.ReactNode
}

export function AppLayout({ currentPage, onNavigate, userEmail, onLogout, children }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-slate-950">
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout} />
      <div className="ml-60 flex flex-1 flex-col">
        <TopBar currentPage={currentPage} onNavigate={onNavigate} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
