import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const token = searchParams.get('token')
    if (token) {
      localStorage.setItem('token', token)
      navigate('/dashboard', { replace: true })
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
