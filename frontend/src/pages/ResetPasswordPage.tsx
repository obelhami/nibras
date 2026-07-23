import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import nibrasLogo from '../assets/nibras-logo.png'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!token) {
      toast.error('Lien invalide ou incomplet.')
      return
    }
    if (newPassword.length < 8) {
      toast.error('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        toast.error(data?.message ?? 'Impossible de réinitialiser le mot de passe.')
        return
      }

      toast.success('Mot de passe réinitialisé avec succès.')
      navigate('/', { replace: true })
    } catch {
      toast.error('Impossible de contacter le serveur. Réessayez plus tard.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-gray-100 bg-white px-8 py-8 shadow-[0_4px_32px_rgba(0,0,0,0.06)]">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={nibrasLogo} alt="Nibras" className="mb-3 h-9" />
          <h1 className="text-lg font-bold text-gray-900">Réinitialiser le mot de passe</h1>
          <p className="mt-1 text-sm text-gray-500">Choisissez un nouveau mot de passe.</p>
        </div>

        {!token ? (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-center text-sm text-red-700">
            Ce lien de réinitialisation est invalide ou incomplet.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Nouveau mot de passe</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Confirmer le mot de passe</label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 disabled:opacity-50"
            >
              {loading ? 'Réinitialisation...' : 'Réinitialiser le mot de passe'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-gray-500">
          <Link to="/" className="font-medium text-blue-600 hover:text-blue-700">
            Retour à la connexion
          </Link>
        </p>
      </div>
    </div>
  )
}
