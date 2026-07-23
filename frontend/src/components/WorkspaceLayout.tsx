import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { clearAuthTokens, fetchWithAuth, getAccessToken } from '../lib/auth'
import nibrasLogo from '../assets/nibras-logo.png'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

interface MeUser {
  email: string
  username?: string | null
  name?: string | null
  role?: string | null
}

const navItems = [
  {
    to: '/boards',
    label: 'Tableaux',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="18" rx="1" />
        <rect x="14" y="3" width="7" height="11" rx="1" />
      </svg>
    ),
  },
  {
    to: '/kpi',
    label: 'KPIs',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    to: '/kpi/glossary',
    label: 'Glossaire',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    to: '/integrations/trello',
    label: 'Trello',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M7 7h4v10H7z" />
        <path d="M13 7h4v6h-4z" />
      </svg>
    ),
  },
]

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [user, setUser] = useState<MeUser | null>(null)

  useEffect(() => {
    if (!getAccessToken()) {
      navigate('/', { replace: true })
      return
    }
    fetchWithAuth(`${API_URL}/auth/me`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: MeUser | null) => {
        if (data) setUser(data)
      })
      .catch(() => {})
  }, [navigate])

  const handleLogout = () => {
    clearAuthTokens()
    navigate('/', { replace: true })
  }

  const displayName = user?.name ?? user?.username ?? user?.email?.split('@')[0] ?? 'Utilisateur'

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5">
          <Link to="/boards" className="flex items-center gap-2">
            <img src={nibrasLogo} alt="Nibras" className="h-8" />
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
              ATELIER
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const active = item.to === '/kpi'
                ? location.pathname === '/kpi'
                : location.pathname.startsWith(item.to)
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-gray-800">{displayName}</p>
              <p className="text-xs text-gray-400">{user?.role ?? '—'}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-600">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <button
              onClick={handleLogout}
              title="Se déconnecter"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-500"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  )
}
