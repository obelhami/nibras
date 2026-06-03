import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { fetchWithAuth, getAccessToken, setAuthTokens } from '../lib/auth'
import nibrasLogo from '../assets/nibras-logo.png'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

const roles = [
  {
    id: 'admin',
    label: 'Administrateur',
    description: 'Accès complet : gestion des utilisateurs, des projets et des paramètres.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
  },
  {
    id: 'manager',
    label: 'Manager',
    description: 'Supervision des équipes, suivi des livrables et allocation des ressources.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: 'developer',
    label: 'Développeur',
    description: 'Gestion des tâches, commits et contribution aux projets techniques.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
] as const

export default function ChooseRolePage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const token = getAccessToken()
    if (!token) {
      navigate('/', { replace: true })
      return
    }

    fetchWithAuth(`${API_URL}/auth/me`)
      .then(async (res) => {
        if (!res.ok) {
          navigate('/', { replace: true })
          return
        }
        const data = (await res.json()) as { role?: string | null; is_verified?: boolean }
        if (data.role) {
          navigate('/dashboard', { replace: true })
          return
        }
        if (!data.is_verified) {
          navigate('/verify-email', { replace: true })
          return
        }
        setChecking(false)
      })
      .catch(() => {
        navigate('/', { replace: true })
      })
  }, [navigate])

  const handleConfirm = async () => {
    if (!selected) return
    setLoading(true)

    try {
      const res = await fetchWithAuth(`${API_URL}/user/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selected }),
      })

      const data = (await res.json()) as {
        message?: string
        accessToken?: string
        refreshToken?: string
      }

      if (!res.ok) {
        throw new Error(data.message ?? 'Échec de la sélection du rôle')
      }

      if (data.accessToken) {
        setAuthTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
      }

      toast.success('Rôle attribué avec succès !')
      navigate('/dashboard', { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Une erreur est survenue')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50">
        <p className="text-gray-500">Chargement...</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4">
      <div className="mb-8 flex items-center gap-2">
        <img src={nibrasLogo} alt="Nibras" className="h-12" />
      </div>

      <div className="w-full max-w-lg rounded-2xl border border-gray-100 bg-white px-8 py-10 shadow-[0_4px_32px_rgba(0,0,0,0.06)]">
        <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
          Choisissez votre rôle
        </h1>
        <p className="mb-8 text-center text-sm text-gray-500">
          Sélectionnez le rôle qui correspond le mieux à vos responsabilités.
        </p>

        <div className="space-y-3">
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => setSelected(role.id)}
              className={`flex w-full items-start gap-4 rounded-xl border-2 px-5 py-4 text-left transition-all ${
                selected === role.id
                  ? 'border-blue-600 bg-blue-50/60 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div
                className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                  selected === role.id ? 'bg-blue-100' : 'bg-gray-100'
                }`}
              >
                {role.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-gray-900">{role.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                  {role.description}
                </p>
              </div>
              <div className="ml-auto mt-1 shrink-0">
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
                    selected === role.id
                      ? 'border-blue-600 bg-blue-600'
                      : 'border-gray-300 bg-white'
                  }`}
                >
                  {selected === role.id && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={handleConfirm}
          disabled={!selected || loading}
          className="mt-8 w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Confirmation...' : 'Confirmer et continuer'}
        </button>
      </div>

      <p className="mt-6 text-[11px] text-gray-400">
        &copy; 2026 Nibras. Tous droits réservés.
      </p>
    </div>
  )
}
