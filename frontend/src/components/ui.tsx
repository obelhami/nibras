import { useEffect } from 'react'

// ---------- Priority badge ----------

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-50 text-red-600 ring-red-100',
  high: 'bg-orange-50 text-orange-600 ring-orange-100',
  medium: 'bg-blue-50 text-blue-600 ring-blue-100',
  low: 'bg-gray-100 text-gray-500 ring-gray-200',
}

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgente',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
        PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.low
      }`}
    >
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  )
}

// ---------- Visibility badge ----------

const VISIBILITY_LABELS: Record<string, string> = {
  private: 'Privé',
  team: 'Équipe',
  public: 'Public',
}

export function VisibilityBadge({ visibility }: { visibility: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
      {visibility === 'public' ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" /></svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
      )}
      {VISIBILITY_LABELS[visibility] ?? visibility}
    </span>
  )
}

// ---------- Modal ----------

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  maxWidth?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/40 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className={`my-8 w-full ${maxWidth} rounded-2xl border border-gray-100 bg-white shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

// ---------- Form primitives ----------

export const inputClass =
  'w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

export const labelClass = 'mb-1.5 block text-[13px] font-medium text-gray-700'

export function PrimaryButton({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}
