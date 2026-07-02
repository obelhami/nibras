import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import WorkspaceLayout from '../components/WorkspaceLayout'
import {
  GhostButton,
  Modal,
  PrimaryButton,
  VisibilityBadge,
  inputClass,
  labelClass,
} from '../components/ui'
import { formatDate } from '../lib/format'
import { boardsApi, type BoardListItem } from '../lib/api'

const DEFAULT_COLUMNS = 'Todo, Doing, Review, Done'

function CreateBoardModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [visibility, setVisibility] = useState('private')
  const [columns, setColumns] = useState(DEFAULT_COLUMNS)
  const [linkedProject, setLinkedProject] = useState('')
  const [teamId, setTeamId] = useState('')
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setTitle('')
    setVisibility('private')
    setColumns(DEFAULT_COLUMNS)
    setLinkedProject('')
    setTeamId('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Le titre du tableau est requis')
      return
    }
    if (!teamId.trim()) {
      toast.error('Un tableau doit être rattaché à une équipe')
      return
    }
    setSaving(true)
    try {
      const columnNames = columns
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
      await boardsApi.create({
        title: title.trim(),
        visibility,
        columns: columnNames.length > 0 ? columnNames : undefined,
        linkedProject: linkedProject.trim() || undefined,
        teamId: teamId.trim(),
      })
      toast.success('Tableau créé')
      reset()
      onCreated()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la création')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouveau tableau">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>Titre</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. Refonte du site web"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Visibilité</label>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className={inputClass}>
            <option value="private">Privé</option>
            <option value="team">Équipe</option>
            <option value="public">Public</option>
          </select>
        </div>

        <div>
          <label className={labelClass}>Colonnes (séparées par des virgules)</label>
          <input
            value={columns}
            onChange={(e) => setColumns(e.target.value)}
            placeholder={DEFAULT_COLUMNS}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-400">
            Les slugs <code className="text-gray-500">review</code> et{' '}
            <code className="text-gray-500">done</code> alimentent les KPIs.
          </p>
        </div>

        <div>
          <label className={labelClass}>ID équipe *</label>
          <input
            required
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            placeholder="ID de l'équipe propriétaire"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-400">
            Obligatoire — l'assignation des tâches est limitée aux membres de cette équipe.
          </p>
        </div>

        <div>
          <label className={labelClass}>ID projet lié (optionnel)</label>
          <input value={linkedProject} onChange={(e) => setLinkedProject(e.target.value)} className={inputClass} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <GhostButton type="button" onClick={onClose}>
            Annuler
          </GhostButton>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Création...' : 'Créer le tableau'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}

function BoardCard({ board, onDeleted }: { board: BoardListItem; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Supprimer le tableau « ${board.title} » et toutes ses tâches ?`)) return
    setDeleting(true)
    try {
      await boardsApi.remove(board.id)
      toast.success('Tableau supprimé')
      onDeleted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la suppression')
      setDeleting(false)
    }
  }

  return (
    <Link
      to={`/boards/${board.id}`}
      className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-base font-bold text-gray-900 group-hover:text-blue-700">{board.title}</h3>
        <button
          onClick={handleDelete}
          disabled={deleting}
          title="Supprimer"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <VisibilityBadge visibility={board.visibility} />
        {board.linked_project_name && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">
            {board.linked_project_name}
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between text-xs text-gray-400">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <strong className="text-sm font-bold text-gray-700">{board.taskCount}</strong> tâches
          </span>
          <span className="flex items-center gap-1">
            <strong className="text-sm font-bold text-gray-700">{board.columns.length}</strong> colonnes
          </span>
        </span>
        <span>Maj {formatDate(board.updated_at)}</span>
      </div>
    </Link>
  )
}

export default function BoardsPage() {
  const [boards, setBoards] = useState<BoardListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const load = () => {
    setLoading(true)
    boardsApi
      .list()
      .then((data) => {
        setBoards(data.boards)
        setError('')
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Échec du chargement'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <WorkspaceLayout>
      <div className="mb-7 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Tableaux</h1>
          <p className="mt-1 text-sm text-gray-500">
            Gérez vos tableaux Kanban et testez le flux des tâches en temps réel.
          </p>
        </div>
        <PrimaryButton onClick={() => setCreateOpen(true)} className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Nouveau tableau
        </PrimaryButton>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl border border-gray-100 bg-white" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</div>
      ) : boards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center">
          <p className="text-sm text-gray-500">Aucun tableau pour l'instant.</p>
          <button onClick={() => setCreateOpen(true)} className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700">
            Créer votre premier tableau
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <BoardCard key={board.id} board={board} onDeleted={load} />
          ))}
        </div>
      )}

      <CreateBoardModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
    </WorkspaceLayout>
  )
}
