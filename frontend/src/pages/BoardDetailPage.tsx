import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import WorkspaceLayout from '../components/WorkspaceLayout'
import {
  GhostButton,
  Modal,
  PrimaryButton,
  PriorityBadge,
  VisibilityBadge,
  inputClass,
  labelClass,
} from '../components/ui'
import { SEVERITY_STYLES, formatDate, isOverdue } from '../lib/format'
import {
  boardsApi,
  type BoardColumn,
  type BoardDetail,
  type Task,
  type TaskHistoryEntry,
} from '../lib/api'

const PRIORITIES = ['low', 'medium', 'high', 'urgent']

// Per-column accent colour (top strip) — mirrors the Nibrasello board design.
const COLUMN_ACCENTS: Record<string, string> = {
  todo: '#94a3b8',
  backlog: '#94a3b8',
  doing: '#3b82f6',
  'in-progress': '#3b82f6',
  ready: '#14b8a6',
  review: '#8b5cf6',
  blocked: '#ef4444',
  done: '#10b981',
}
const ACCENT_FALLBACK = ['#3b82f6', '#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444', '#10b981', '#6366f1']

function columnAccent(slug: string, index: number): string {
  return COLUMN_ACCENTS[slug] ?? ACCENT_FALLBACK[index % ACCENT_FALLBACK.length]
}

// ---------- metric strip ----------

function MetricStat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
      <p className={`text-xl font-bold ${accent ?? 'text-gray-900'}`}>{value}</p>
      <p className="mt-0.5 text-xs text-gray-400">{label}</p>
    </div>
  )
}

// ---------- task card ----------

function TaskCard({
  task,
  onOpen,
  onDragStart,
}: {
  task: Task
  onOpen: () => void
  onDragStart: (e: React.DragEvent) => void
}) {
  const overdue = isOverdue(task.due_date, task.status_slug)
  return (
    <button
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className="group w-full cursor-grab rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition-all hover:border-blue-200 hover:shadow-md active:cursor-grabbing"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-snug text-gray-800">{task.title}</p>
        <PriorityBadge priority={task.priority} />
      </div>

      {task.description && (
        <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-gray-400">{task.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
        {task.assignee_email ? (
          <span className="flex items-center gap-1">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 text-[8px] font-bold text-blue-600">
              {task.assignee_email.charAt(0).toUpperCase()}
            </span>
            {task.assignee_email.split('@')[0]}
          </span>
        ) : (
          <span className="text-amber-500">Non assigné</span>
        )}
        {task.complexity != null && <span>Cx {task.complexity}</span>}
        {task.due_date && (
          <span className={overdue ? 'font-medium text-red-500' : ''}>
            {overdue ? '⚠ ' : ''}
            {formatDate(task.due_date)}
          </span>
        )}
      </div>
    </button>
  )
}

// ---------- add task modal ----------

function AddTaskModal({
  open,
  onClose,
  boardId,
  columns,
  defaultColumnId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  boardId: string
  columns: BoardColumn[]
  defaultColumnId: string
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [columnId, setColumnId] = useState(defaultColumnId)
  const [assignee, setAssignee] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [complexity, setComplexity] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setColumnId(defaultColumnId)
  }, [open, defaultColumnId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Le titre de la tâche est requis')
      return
    }
    if (!assignee.trim()) {
      toast.error('Assignez la tâche à un membre de l\'équipe')
      return
    }
    setSaving(true)
    try {
      await boardsApi.createTask(boardId, {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        columnId,
        assigneeId: assignee.trim(),
        dueDate: dueDate || undefined,
        complexity: complexity ? Number(complexity) : undefined,
      })
      toast.success('Tâche créée')
      setTitle('')
      setDescription('')
      setAssignee('')
      setDueDate('')
      setComplexity('')
      setPriority('medium')
      onCreated()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la création')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouvelle tâche">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>Titre</label>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={`${inputClass} resize-none`}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Colonne</label>
            <select value={columnId} onChange={(e) => setColumnId(e.target.value)} className={inputClass}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Priorité</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <label className={labelClass}>Complexité (1-5)</label>
            <input
              type="number"
              min={1}
              max={5}
              value={complexity}
              onChange={(e) => setComplexity(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Échéance</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>ID du membre *</label>
          <input
            required
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="ex. 3"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-400">
            Obligatoire — doit être un membre de l'équipe du tableau (futur menu déroulant).
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <GhostButton type="button" onClick={onClose}>
            Annuler
          </GhostButton>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Création...' : 'Créer la tâche'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}

// ---------- task detail / edit / move / history modal ----------

function TaskDetailModal({
  task,
  boardId,
  columns,
  onClose,
  onChanged,
}: {
  task: Task | null
  boardId: string
  columns: BoardColumn[]
  onClose: () => void
  onChanged: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [assignee, setAssignee] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [complexity, setComplexity] = useState('')
  const [saving, setSaving] = useState(false)

  const [moveColumn, setMoveColumn] = useState('')
  const [moveNote, setMoveNote] = useState('')
  const [moving, setMoving] = useState(false)

  const [history, setHistory] = useState<TaskHistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description ?? '')
    setPriority(task.priority)
    setAssignee(task.assignee_id ?? '')
    setDueDate(task.due_date ? task.due_date.slice(0, 10) : '')
    setComplexity(task.complexity != null ? String(task.complexity) : '')
    setMoveColumn(task.column_id)
    setMoveNote('')
    setShowHistory(false)
    setHistory([])
  }, [task])

  if (!task) return null

  const handleSave = async () => {
    if (!assignee.trim()) {
      toast.error('Une tâche doit rester assignée à un membre de l\'équipe')
      return
    }
    setSaving(true)
    try {
      await boardsApi.updateTask(boardId, task.id, {
        title: title.trim() || undefined,
        description: description.trim(),
        priority,
        assigneeId: assignee.trim(),
        dueDate: dueDate || '',
        complexity: complexity ? Number(complexity) : undefined,
      })
      toast.success('Tâche mise à jour')
      onChanged()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la mise à jour')
    } finally {
      setSaving(false)
    }
  }

  const handleMove = async () => {
    if (moveColumn === task.column_id && !moveNote.trim()) {
      toast.error('Choisissez une colonne différente ou ajoutez une note')
      return
    }
    setMoving(true)
    try {
      await boardsApi.moveTask(boardId, task.id, moveColumn, moveNote.trim() || undefined)
      toast.success('Tâche déplacée')
      onChanged()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec du déplacement')
    } finally {
      setMoving(false)
    }
  }

  const loadHistory = async () => {
    setShowHistory((v) => !v)
    if (history.length === 0) {
      try {
        const data = await boardsApi.taskHistory(boardId, task.id)
        setHistory(data.history)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Échec du chargement de l\'historique')
      }
    }
  }

  return (
    <Modal open={!!task} onClose={onClose} title="Détails de la tâche" maxWidth="max-w-xl">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Titre</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={`${inputClass} resize-none`}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Priorité</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Complexité (1-5)</label>
            <input
              type="number"
              min={1}
              max={5}
              value={complexity}
              onChange={(e) => setComplexity(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>ID du membre *</label>
            <input required value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Échéance</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </div>
        </div>

        <div className="flex justify-end">
          <PrimaryButton onClick={handleSave} disabled={saving}>
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </PrimaryButton>
        </div>

        {/* Move with note — drives the KPI history (notes containing "block" flag blockers) */}
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="mb-3 text-[13px] font-semibold text-gray-700">Déplacer la tâche</p>
          <div className="flex gap-2">
            <select value={moveColumn} onChange={(e) => setMoveColumn(e.target.value)} className={`${inputClass} flex-1`}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <GhostButton onClick={handleMove} disabled={moving} className="shrink-0">
              {moving ? '...' : 'Déplacer'}
            </GhostButton>
          </div>
          <input
            value={moveNote}
            onChange={(e) => setMoveNote(e.target.value)}
            placeholder='Note (ex. "blocked by API" → compté comme blocage)'
            className={`${inputClass} mt-2`}
          />
        </div>

        {/* History */}
        <div>
          <button
            onClick={loadHistory}
            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>
            {showHistory ? 'Masquer' : 'Afficher'} l'historique
          </button>
          {showHistory && history[0]?.due_date && (
            <p className="mt-3 text-xs text-gray-500">
              Échéance de la tâche :{' '}
              <span className={isOverdue(history[0].due_date, task.status_slug) ? 'font-medium text-red-500' : 'font-medium text-gray-700'}>
                {formatDate(history[0].due_date)}
              </span>
            </p>
          )}
          {showHistory && (
            <ul className="mt-3 space-y-2">
              {history.length === 0 ? (
                <li className="text-xs text-gray-400">Aucun mouvement enregistré.</li>
              ) : (
                history.map((h) => (
                  <li key={h.id} className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-700">
                        {h.from_status_slug ?? '∅'} → {h.to_status_slug ?? '∅'}
                      </span>
                      <span className="text-gray-400">{formatDate(h.created_at)}</span>
                    </div>
                    <div className="mt-0.5 text-gray-400">
                      par {h.moved_by_email}
                      {h.note && <span className="text-gray-500"> · « {h.note} »</span>}
                    </div>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ---------- column ----------

function Column({
  column,
  index,
  tasks,
  onAddTask,
  onOpenTask,
  onDropTask,
  onDeleteColumn,
}: {
  column: BoardColumn
  index: number
  tasks: Task[]
  onAddTask: (columnId: string) => void
  onOpenTask: (task: Task) => void
  onDropTask: (taskId: string, columnId: string) => void
  onDeleteColumn: (column: BoardColumn) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const accent = columnAccent(column.slug, index)

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const taskId = e.dataTransfer.getData('text/task-id')
        if (taskId) onDropTask(taskId, column.id)
      }}
      style={{ borderTopColor: accent, borderTopWidth: 3 }}
      className={`flex w-72 shrink-0 flex-col rounded-2xl border p-3 transition-colors ${
        dragOver ? 'border-blue-300 bg-blue-50/60' : 'border-gray-200 bg-gray-100/60'
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
          <h3 className="text-sm font-bold text-gray-700">{column.name}</h3>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-500">
            {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onAddTask(column.id)}
            title="Ajouter une tâche"
            className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white hover:text-blue-600"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
          <button
            onClick={() => onDeleteColumn(column)}
            title="Supprimer la colonne"
            className="flex h-6 w-6 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-white hover:text-red-500"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onOpen={() => onOpenTask(task)}
            onDragStart={(e) => e.dataTransfer.setData('text/task-id', task.id)}
          />
        ))}
        {tasks.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 py-6 text-center text-xs text-gray-400">
            Déposez une tâche ici
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- page ----------

export default function BoardDetailPage() {
  const { boardId = '' } = useParams()
  const [detail, setDetail] = useState<BoardDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [addTaskColumn, setAddTaskColumn] = useState<string | null>(null)
  const [openTask, setOpenTask] = useState<Task | null>(null)
  const [newColumn, setNewColumn] = useState('')
  const [addingColumn, setAddingColumn] = useState(false)

  const load = useCallback(() => {
    boardsApi
      .get(boardId)
      .then((data) => {
        setDetail(data)
        setError('')
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Échec du chargement'))
      .finally(() => setLoading(false))
  }, [boardId])

  useEffect(() => {
    load()
  }, [load])

  const handleDropTask = async (taskId: string, columnId: string) => {
    const task = detail?.tasks.find((t) => t.id === taskId)
    if (!task || task.column_id === columnId) return
    try {
      await boardsApi.moveTask(boardId, taskId, columnId)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec du déplacement')
    }
  }

  const handleAddColumn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newColumn.trim()) return
    setAddingColumn(true)
    try {
      await boardsApi.addColumn(boardId, newColumn.trim())
      setNewColumn('')
      toast.success('Colonne ajoutée')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de l\'ajout')
    } finally {
      setAddingColumn(false)
    }
  }

  const handleDeleteColumn = async (column: BoardColumn) => {
    if (!confirm(`Supprimer la colonne « ${column.name} » ?`)) return
    try {
      await boardsApi.deleteColumn(boardId, column.id)
      toast.success('Colonne supprimée')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la suppression')
    }
  }

  if (loading) {
    return (
      <WorkspaceLayout>
        <div className="flex h-64 items-center justify-center text-sm text-gray-400">Chargement...</div>
      </WorkspaceLayout>
    )
  }

  if (error || !detail) {
    return (
      <WorkspaceLayout>
        <Link to="/boards" className="text-sm text-blue-600 hover:text-blue-700">
          ← Retour aux tableaux
        </Link>
        <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">
          {error || 'Tableau introuvable'}
        </div>
      </WorkspaceLayout>
    )
  }

  const { board, columns, tasks, metrics, signals } = detail
  const sortedColumns = [...columns].sort((a, b) => a.position - b.position)

  return (
    <WorkspaceLayout>
      {/* Header */}
      <div className="mb-5">
        <Link to="/boards" className="text-sm text-gray-400 transition-colors hover:text-blue-600">
          ← Tableaux
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{board.title}</h1>
          <VisibilityBadge visibility={board.visibility} />
          {board.linked_project_name && (
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
              {board.linked_project_name}
            </span>
          )}
          <Link
            to={`/kpi?board=${board.id}`}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-blue-200 hover:text-blue-600"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
            Voir les KPIs
          </Link>
        </div>
      </div>

      {/* Metrics */}
      {metrics && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricStat label="Tâches" value={metrics.totalTasks} />
          <MetricStat label="Terminées" value={metrics.doneTasks} accent="text-emerald-600" />
          <MetricStat label="Complétion" value={`${metrics.completionRate}%`} accent="text-blue-600" />
          <MetricStat label="En retard" value={metrics.overdueTasks} accent={metrics.overdueTasks > 0 ? 'text-red-500' : undefined} />
          <MetricStat label="Non assignées" value={metrics.unassignedTasks} accent={metrics.unassignedTasks > 0 ? 'text-amber-500' : undefined} />
          <MetricStat label="Complexité moy." value={metrics.averageComplexity} />
        </div>
      )}

      {/* Signals */}
      {signals.length > 0 && (
        <div className="mb-5 rounded-2xl border border-gray-100 bg-white p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            Signaux ({signals.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {signals.map((signal) => {
              const style = SEVERITY_STYLES[signal.severity] ?? SEVERITY_STYLES.low
              return (
                <span
                  key={signal.id}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${style.bg} ${style.text}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                  {signal.message}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Kanban */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {sortedColumns.map((column, index) => (
          <Column
            key={column.id}
            column={column}
            index={index}
            tasks={tasks.filter((t) => t.column_id === column.id)}
            onAddTask={(columnId) => setAddTaskColumn(columnId)}
            onOpenTask={setOpenTask}
            onDropTask={handleDropTask}
            onDeleteColumn={handleDeleteColumn}
          />
        ))}

        {/* Add column */}
        <form onSubmit={handleAddColumn} className="w-64 shrink-0">
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white/50 p-3">
            <input
              value={newColumn}
              onChange={(e) => setNewColumn(e.target.value)}
              placeholder="Nouvelle colonne"
              className={inputClass}
            />
            <PrimaryButton type="submit" disabled={addingColumn} className="mt-2 w-full">
              {addingColumn ? '...' : 'Ajouter une colonne'}
            </PrimaryButton>
          </div>
        </form>
      </div>

      <AddTaskModal
        open={addTaskColumn !== null}
        onClose={() => setAddTaskColumn(null)}
        boardId={boardId}
        columns={sortedColumns}
        defaultColumnId={addTaskColumn ?? sortedColumns[0]?.id ?? ''}
        onCreated={load}
      />

      <TaskDetailModal
        task={openTask}
        boardId={boardId}
        columns={sortedColumns}
        onClose={() => setOpenTask(null)}
        onChanged={load}
      />
    </WorkspaceLayout>
  )
}
