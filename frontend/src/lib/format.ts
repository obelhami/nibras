// Non-component helpers and style maps shared across the workspace UI.
// Kept out of .tsx component files so fast-refresh only sees components.

export const SEVERITY_STYLES: Record<string, { dot: string; text: string; bg: string }> = {
  critical: { dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50 border-red-100' },
  high: { dot: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50 border-orange-100' },
  medium: { dot: 'bg-amber-400', text: 'text-amber-700', bg: 'bg-amber-50 border-amber-100' },
  low: { dot: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-50 border-gray-100' },
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function isOverdue(dueDate: string | null, statusSlug: string): boolean {
  if (!dueDate || statusSlug === 'done') return false
  return new Date(dueDate).getTime() < Date.now()
}
