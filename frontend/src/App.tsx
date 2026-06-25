import { Routes, Route } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import AuthCallback from './pages/AuthCallback'
import Dashboard from './pages/Dashboard'
import VerifyEmailPage from './pages/VerifyEmailPage'
import ChooseRolePage from './pages/ChooseRolePage'
import BoardsPage from './pages/BoardsPage'
import BoardDetailPage from './pages/BoardDetailPage'
import KpiPage from './pages/KpiPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/choose-role" element={<ChooseRolePage />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/boards" element={<BoardsPage />} />
      <Route path="/boards/:boardId" element={<BoardDetailPage />} />
      <Route path="/kpi" element={<KpiPage />} />
    </Routes>
  )
}

export default App
