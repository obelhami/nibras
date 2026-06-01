import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { clearAuthTokens, getAccessToken } from '../lib/auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export default function VerifyEmailPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sending, setSending] = useState(false)

  const verified = searchParams.get('verified') === 'true'
  const error = searchParams.get('error')

  useEffect(() => {
    if (verified) {
      sessionStorage.removeItem('pending-verification')
      toast.success('Email verified. You can now log in.')
      setSearchParams({}, { replace: true })
      return
    }

    if (error === 'invalid_token') {
      toast.error('Invalid verification link. Please request a new one.')
      setSearchParams({}, { replace: true })
      return
    }

    if (error === 'token_expired') {
      toast.error('Verification link has expired. Please request a new one.')
      setSearchParams({}, { replace: true })
    }
  }, [verified, error, setSearchParams])

  const handleResend = async () => {
    const token = getAccessToken()
    if (!token) {
      navigate('/', { replace: true })
      return
    }

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
      toast.success('Verification link sent. Check your inbox.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send verification email')
    } finally {
      setSending(false)
    }
  }

  const handleBackToLogin = () => {
    clearAuthTokens()
    sessionStorage.removeItem('pending-verification')
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-4">
      <div className="w-full max-w-lg rounded-3xl border border-blue-100 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-2xl">
          ✉
        </div>

        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-blue-600">
          Email Verification
        </p>

        <h1 className="mb-3 text-2xl font-bold text-gray-900">
          {verified ? 'Email verified successfully' : 'Check your inbox to continue'}
        </h1>

        <p className="mx-auto mb-6 max-w-md text-sm leading-6 text-gray-600">
          {verified
            ? 'Your email is now confirmed. You can return to the login page and sign in.'
            : 'A verification email has been sent. Open the link in your inbox before you use the account.'}
        </p>

        {!verified && (
          <div className="space-y-3">
            <button
              onClick={handleResend}
              disabled={sending}
              className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Resend verification email'}
            </button>

            <button
              onClick={handleBackToLogin}
              className="w-full rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Back to login
            </button>
          </div>
        )}

        {verified && (
          <button
            onClick={handleBackToLogin}
            className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Continue to login
          </button>
        )}
      </div>
    </div>
  )
}