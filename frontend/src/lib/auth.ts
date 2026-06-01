const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

const ACCESS_TOKEN_KEY = 'token'
const REFRESH_TOKEN_KEY = 'refreshToken'

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setAuthTokens(tokens: { accessToken: string; refreshToken?: string }) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken)

  if (tokens.refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken)
  }
}

export function clearAuthTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export async function refreshAccessToken() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    return null
  }

  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })

  if (!res.ok) {
    clearAuthTokens()
    return null
  }

  const data = await res.json()
  if (!data.accessToken) {
    clearAuthTokens()
    return null
  }

  localStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken)
  return data.accessToken as string
}

export async function fetchWithAuth(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  const token = getAccessToken()

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(input, { ...init, headers })

  if (response.status !== 401) {
    return response
  }

  const refreshedToken = await refreshAccessToken()
  if (!refreshedToken) {
    return response
  }

  headers.set('Authorization', `Bearer ${refreshedToken}`)
  return fetch(input, { ...init, headers })
}
