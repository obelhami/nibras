import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setAuthTokens } from '../lib/auth'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const token = searchParams.get('token')
    const redirect = searchParams.get('redirect') ?? '/dashboard'
    if (token) {
      setAuthTokens({ accessToken: token })
      navigate(redirect, { replace: true })
    } else {
      navigate('/?error=auth_failed', { replace: true })
    }
  }, [searchParams, navigate])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-gray-500">Connexion en cours...</p>
    </div>
  )
}
