import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

interface User {
  id: string
  email: string
  name: string
  picture: string | null
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      navigate('/', { replace: true })
      return
    }

    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Unauthorized')
        return res.json()
      })
      .then(setUser)
      .catch(() => {
        localStorage.removeItem('token')
        navigate('/', { replace: true })
      })
  }, [navigate])

  const handleLogout = () => {
    localStorage.removeItem('token')
    navigate('/', { replace: true })
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Chargement...</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-lg">
        {user.picture ? (
          <img
            src={user.picture}
            alt={user.name}
            className="mx-auto mb-4 h-20 w-20 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-blue-100 text-2xl font-bold text-blue-600">
            {user.name.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 className="mb-1 text-xl font-bold text-gray-900">{user.name}</h1>
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
