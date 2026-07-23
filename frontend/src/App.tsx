import { Routes, Route } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import AuthCallback from './pages/AuthCallback'
import Dashboard from './pages/Dashboard'
import VerifyEmailPage from './pages/VerifyEmailPage'
import ChooseRolePage from './pages/ChooseRolePage'
import BoardsPage from './pages/BoardsPage'
import BoardDetailPage from './pages/BoardDetailPage'
import KpiPage from './pages/KpiPage'
import TrelloConnectPage from './pages/TrelloConnectPage'
import KpiGlossaryPage from './pages/KpiGlossaryPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/choose-role" element={<ChooseRolePage />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/boards" element={<BoardsPage />} />
      <Route path="/boards/:boardId" element={<BoardDetailPage />} />
      <Route path="/kpi" element={<KpiPage />} />
      <Route path="/integrations/trello" element={<TrelloConnectPage />} />
      <Route path="/kpi/glossary" element={<KpiGlossaryPage />} />
    </Routes>
  )
}

export default App
