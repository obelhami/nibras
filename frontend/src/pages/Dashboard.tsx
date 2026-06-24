import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { clearAuthTokens, fetchWithAuth, getAccessToken } from '../lib/auth'
import { getPermissions, type Permissions } from '../lib/permissions'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

interface User {
  id: string
  email: string
  name: string | null
  picture: string | null
  is_verified: boolean
  role: string | null
}

function VerificationOverlay({ email, token }: { email: string; token: string }) {
  const [sending, setSending] = useState(false)

  const handleResend = async () => {
    setSending(true)
    try {
      const res = await fetch(`${API_URL}/auth/send-verification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })

      const raw = await res.text()
      let data: { message?: string } = {}
      if (raw) {
        try {
          data = JSON.parse(raw) as { message?: string }
        } catch {
          data = { message: raw }
        }
      }

      if (!res.ok) throw new Error(data.message ?? 'Failed to resend')
      toast.success('Verification link sent! Check your inbox.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send verification email')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-2xl border border-gray-700/50 bg-[#1a1a24] p-10 text-center shadow-2xl">
        {/* Mail icon */}
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-600/15">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
        </div>

        <h2 className="mb-2 text-xl font-bold text-white">
          Verify your email identity
        </h2>
        <p className="mb-2 text-sm leading-relaxed text-gray-400">
          We sent a verification link to your email inbox.
          Please confirm your email ownership to initialize your workspace.
        </p>
        <p className="mb-8 text-xs text-gray-500">
          Sent to <span className="text-gray-300">{email}</span>
        </p>

        <button
          onClick={handleResend}
          disabled={sending}
          className="w-full rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#1a1a24] disabled:opacity-50"
        >
          {sending ? 'Sending...' : 'Resend Link'}
        </button>

        <p className="mt-6 text-xs text-gray-600">
          The link expires in 24 hours
        </p>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const needsVerification = sessionStorage.getItem('pending-verification') === 'true'
  const searchParams = new URLSearchParams(window.location.search)
  const verified = searchParams.get('verified') === 'true'

  useEffect(() => {
    if (verified) {
      sessionStorage.removeItem('pending-verification')
      toast.success('Email verified. You can now use your dashboard.')
      navigate('/dashboard', { replace: true })
      return
    }

    const token = getAccessToken()
    if (!token) {
      navigate('/', { replace: true })
      return
    }

    setToken(token)

    fetchWithAuth(`${API_URL}/auth/me`)
      .then((res) => {
        if (!res.ok) throw new Error('Unauthorized')
        return res.json()
      })
      .then((data: User) => {
        if (!data.role) {
          navigate('/choose-role', { replace: true })
          return
        }
        setUser(data)
      })
      .catch(() => {
        clearAuthTokens()
        navigate('/', { replace: true })
      })
  }, [navigate])

  const handleLogout = () => {
    clearAuthTokens()
    sessionStorage.removeItem('pending-verification')
    navigate('/', { replace: true })
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Chargement...</p>
      </div>
    )
  }

  const displayName = user.name ?? user.email.split('@')[0]
  const perms: Permissions = getPermissions(user.role)

  const roleLabels: Record<string, string> = {
    admin: 'Administrateur',
    manager: 'Manager',
    developer: 'Développeur',
  }

  const actions: { key: keyof Permissions; label: string; icon: React.ReactNode }[] = [
    {
      key: 'create_project',
      label: 'Créer un projet',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
      ),
    },
    {
      key: 'create_task',
      label: 'Créer une tâche',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      ),
    },
    {
      key: 'view_team_kpis',
      label: 'Voir les KPIs',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      ),
    },
    {
      key: 'manage_users',
      label: 'Gérer les utilisateurs',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
  ]

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      {needsVerification && !user.is_verified && token && (
        <VerificationOverlay email={user.email} token={token} />
      )}

      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-4">
          {user.picture ? (
            <img
              src={user.picture}
              alt={displayName}
              className="h-14 w-14 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-xl font-bold text-blue-600">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-lg font-bold text-gray-900">{displayName}</h1>
            <p className="text-sm text-gray-500">{user.email}</p>
            <span className="mt-1 inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              {roleLabels[user.role!] ?? user.role}
            </span>
          </div>
        </div>

        <div className="mb-6 border-t border-gray-100 pt-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Actions disponibles</h2>
          <div className="grid grid-cols-2 gap-2">
            {actions.map((action) => (
              <button
                key={action.key}
                disabled={!perms[action.key]}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  perms[action.key]
                    ? 'border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                    : 'cursor-not-allowed border-gray-100 text-gray-300'
                }`}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6 border-t border-gray-100 pt-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Espace de travail</h2>
          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/boards"
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="18" rx="1" />
                <rect x="14" y="3" width="7" height="11" rx="1" />
              </svg>
              Tableaux
            </Link>
            <Link
              to="/kpi"
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              KPIs
            </Link>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full rounded-lg bg-red-500 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-600"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  )
}
