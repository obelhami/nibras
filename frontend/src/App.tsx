import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

function App() {
    const [path, setPath] = useState(window.location.pathname)
    const [mode, setMode] = useState<'login' | 'register'>('login')
    const [form, setForm] = useState({
        username: '',
        email: '',
        password: '',
        confirmPassword: ''
    })
    const [message, setMessage] = useState('Sign in to generate a JWT.')
    const [token, setToken] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [profile, setProfile] = useState<{
        username: string
        email: string
    } | null>(null)
    const [profileLoading, setProfileLoading] = useState(false)

    useEffect(() => {
        const syncPath = () => setPath(window.location.pathname)

        window.addEventListener('popstate', syncPath)

        return () => window.removeEventListener('popstate', syncPath)
    }, [])

    useEffect(() => {
        if (path !== '/profile') {
            return
        }

        const storedToken = window.localStorage.getItem('jwt')

        if (!storedToken) {
            setProfile(null)
            setError('No token found. Log in first.')
            return
        }

        const loadProfile = async () => {
            setProfileLoading(true)
            setError('')

            try {
                const response = await fetch('http://localhost:3000/profile', {
                    headers: {
                        Authorization: `Bearer ${storedToken}`
                    }
                })

                const data = (await response.json()) as {
                    message?: string
                    user?: {
                        username: string
                        email: string
                    }
                }

                if (!response.ok) {
                    throw new Error(data.message ?? 'Token verification failed')
                }

                setMessage(data.message ?? 'JWT verified successfully.')
                setProfile(data.user ?? null)
                setToken(storedToken)
            } catch (profileError) {
                setProfile(null)
                setError(
                    profileError instanceof Error
                        ? profileError.message
                        : 'Something went wrong'
                )
            } finally {
                setProfileLoading(false)
            }
        }

        void loadProfile()
    }, [path])

    const goTo = (nextPath: string) => {
        window.history.pushState({}, '', nextPath)
        setPath(nextPath)
    }

    const handleChange = (field: keyof typeof form, value: string) => {
        setForm(previous => ({
            ...previous,
            [field]: value
        }))
    }

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setLoading(true)
        setError('')
        setToken('')

        try {
            const response = await fetch(`http://localhost:3000/${mode}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(
                    mode === 'register'
                        ? form
                        : {
                              email: form.email,
                              password: form.password
                          }
                )
            })

            const data = (await response.json()) as {
                message?: string
                token?: string
            }

            if (!response.ok) {
                throw new Error(data.message ?? 'Request failed')
            }

            setMessage(data.message ?? 'Request completed.')
            setToken(data.token ?? '')

            if (data.token) {
                window.localStorage.setItem('jwt', data.token)
            }
        } catch (submitError) {
            setMessage('')
            setError(
                submitError instanceof Error
                    ? submitError.message
                    : 'Something went wrong'
            )
        } finally {
            setLoading(false)
        }
    }

    if (path === '/profile') {
        return (
            <main className="page-shell">
                <section className="auth-card profile-card">
                    <div className="hero-copy">
                        <p className="eyebrow">Protected route</p>
                        <h1>/profile</h1>
                        <p className="subcopy">
                            This page calls the backend with the stored JWT. If
                            verification works, you’ll see the decoded user info.
                        </p>
                    </div>

                    <div className="profile-actions">
                        <button type="button" className="secondary-action" onClick={() => goTo('/')}>
                            Back to auth
                        </button>
                    </div>

                    <section className="result-panel" aria-live="polite">
                        <p className="status">
                            {profileLoading ? 'Verifying token...' : message || error}
                        </p>
                        {error && <p className="error">{error}</p>}
                        {profile && (
                            <div className="profile-grid">
                                <div>
                                    <span>Username</span>
                                    <strong>{profile.username}</strong>
                                </div>
                                <div>
                                    <span>Email</span>
                                    <strong>{profile.email}</strong>
                                </div>
                            </div>
                        )}
                        {token && (
                            <textarea readOnly value={token} spellCheck={false} rows={6} />
                        )}
                    </section>
                </section>
            </main>
        )
    }

    return (
        <main className="page-shell">
            <section className="auth-card">
                <div className="hero-copy">
                    <p className="eyebrow">JWT demo</p>
                    <h1>Generate a token from the backend.</h1>
                    <p className="subcopy">
                        Register a user or log in with an existing account. The
                        backend responds with a signed JWT that you can inspect
                        right here.
                    </p>
                </div>

                <div className="profile-actions">
                    <button type="button" className="secondary-action" onClick={() => goTo('/profile')}>
                        Open /profile
                    </button>
                </div>

                <div className="mode-switch" role="tablist" aria-label="Auth mode">
                    <button
                        type="button"
                        className={mode === 'login' ? 'active' : ''}
                        onClick={() => setMode('login')}
                    >
                        Login
                    </button>
                    <button
                        type="button"
                        className={mode === 'register' ? 'active' : ''}
                        onClick={() => setMode('register')}
                    >
                        Register
                    </button>
                </div>

                <form className="auth-form" onSubmit={handleSubmit}>
                    {mode === 'register' && (
                        <label>
                            Username
                            <input
                                type="text"
                                value={form.username}
                                onChange={event =>
                                    handleChange('username', event.target.value)
                                }
                                placeholder="Jane Doe"
                                autoComplete="username"
                            />
                        </label>
                    )}

                    <label>
                        Email
                        <input
                            type="email"
                            value={form.email}
                            onChange={event =>
                                handleChange('email', event.target.value)
                            }
                            placeholder="jane@example.com"
                            autoComplete="email"
                        />
                    </label>

                    <label>
                        Password
                        <input
                            type="password"
                            value={form.password}
                            onChange={event =>
                                handleChange('password', event.target.value)
                            }
                            placeholder="••••••••"
                            autoComplete={
                                mode === 'register' ? 'new-password' : 'current-password'
                            }
                        />
                    </label>

                    {mode === 'register' && (
                        <label>
                            Confirm password
                            <input
                                type="password"
                                value={form.confirmPassword}
                                onChange={event =>
                                    handleChange('confirmPassword', event.target.value)
                                }
                                placeholder="••••••••"
                                autoComplete="new-password"
                            />
                        </label>
                    )}

                    <button className="primary-action" type="submit" disabled={loading}>
                        {loading ? 'Working...' : mode === 'login' ? 'Generate JWT' : 'Create account'}
                    </button>
                </form>

                <section className="result-panel" aria-live="polite">
                    <p className="status">{message || error}</p>
                    {error && <p className="error">{error}</p>}
                    {token && (
                        <textarea readOnly value={token} spellCheck={false} rows={6} />
                    )}
                </section>
            </section>
        </main>
    )
}

export default App