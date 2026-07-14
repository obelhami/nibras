import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import nibrasLogo from '../assets/nibras-logo.png'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (res.status === 429) {
        const data = await res.json().catch(() => null)
        toast.error(data?.message ?? 'Trop de tentatives, réessayez plus tard.')
        return
      }

      // We always show a generic success state — the backend intentionally
      // does not reveal whether the email exists (BR: avoid enumeration).
      setSent(true)
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
          <h1 className="text-lg font-bold text-gray-900">Mot de passe oublié</h1>
          <p className="mt-1 text-sm text-gray-500">
            Entrez votre email, nous vous enverrons un lien de réinitialisation.
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg bg-blue-50 px-4 py-3 text-center text-sm text-blue-700">
            Si un compte existe pour cet email, un lien de réinitialisation vient d'être envoyé.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 disabled:opacity-50"
            >
              {loading ? 'Envoi...' : 'Envoyer le lien'}
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
