import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { clearAuthTokens, fetchWithAuth, getAccessToken } from '../lib/auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

interface User {
  id: string
  email: string
  name: string | null
  picture: string | null
  is_verified: boolean
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
      const data = await res.json()
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

  useEffect(() => {
    const storedToken = localStorage.getItem('token')
    if (!storedToken) {
    const token = getAccessToken()
    if (!token) {
      navigate('/', { replace: true })
      return
    }

    setToken(storedToken)

    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
    fetchWithAuth(`${API_URL}/auth/me`)
      .then((res) => {
        if (!res.ok) throw new Error('Unauthorized')
        return res.json()
      })
      .then(setUser)
      .catch(() => {
        clearAuthTokens()
        navigate('/', { replace: true })
      })
  }, [navigate])

  const handleLogout = () => {
    clearAuthTokens()
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      {!user.is_verified && token && (
        <VerificationOverlay email={user.email} token={token} />
      )}

      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-lg">
        {user.picture ? (
          <img
            src={user.picture}
            alt={displayName}
            className="mx-auto mb-4 h-20 w-20 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-blue-100 text-2xl font-bold text-blue-600">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 className="mb-1 text-xl font-bold text-gray-900">{displayName}</h1>
        <p className="mb-6 text-sm text-gray-500">{user.email}</p>
        <button
          onClick={handleLogout}
          className="rounded-lg bg-red-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
        >
          Se d&eacute;connecter
        </button>
      </div>
    </div>
  )
}
