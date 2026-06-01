import { Routes, Route } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import AuthCallback from './pages/AuthCallback'
import Dashboard from './pages/Dashboard'
import VerifyEmailPage from './pages/VerifyEmailPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/dashboard" element={<Dashboard />} />
    </Routes>
  )
}

export default App
