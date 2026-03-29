import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Lock, Mail } from 'lucide-react'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'Неверный email или пароль'
          : error.message,
      )
    }
    setLoading(false)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/[0.07] blur-[120px]" />
        <div className="absolute left-1/2 top-[40%] h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/[0.05] blur-[100px]" />
      </div>
      <div className="relative w-full max-w-[400px] rounded-xl bg-slate-900/60 p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold tracking-wider text-white">
            D
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">DWH</h1>
          <p className="mt-1 text-sm text-slate-400">Войти в систему</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-medium text-slate-300">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input id="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" className="h-10 w-full rounded-lg border-0 bg-slate-800 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-medium text-slate-300">Пароль</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input id="password" type="password" placeholder="--------" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" className="h-10 w-full rounded-lg border-0 bg-slate-800 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">{error}</div>
          )}
          <button type="submit" disabled={loading} className="flex h-10 w-full items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}
