import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearAuthTokens, fetchWithAuth, getAccessToken } from '../lib/auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

interface User {
  id: string
  email: string
  name: string | null
  picture: string | null
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const token = getAccessToken()
    if (!token) {
      navigate('/', { replace: true })
      return
    }

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

  // fallback display name — use name, or the part before @ in email
  const displayName = user.name ?? user.email.split('@')[0]

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
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
            {displayName.charAt(0).toUpperCase()}  {/* ✅ never undefined now */}
          </div>
        )}
        <h1 className="mb-1 text-xl font-bold text-gray-900">{displayName}</h1>
        <p className="mb-6 text-sm text-gray-500">{user.email}</p>
        <button
          onClick={handleLogout}
          className="rounded-lg bg-red-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  )
}