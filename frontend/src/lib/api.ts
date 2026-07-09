import { fetchWithAuth } from './auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

// ---------- shared types (mirror the backend response shapes) ----------

export interface BoardColumn {
  id: string
  board_id: string
  name: string
  slug: string
  position: number
}

export interface Board {
  id: string
  title: string
  source: string
  linked_project: string | null
  linked_project_name: string | null
  visibility: 'private' | 'team' | 'public' | string
  team_id: string | null
  owner_email: string
  created_at: string
  updated_at: string
}

export interface BoardListItem extends Board {
  columns: BoardColumn[]
  taskCount: number
}

export interface Task {
  id: string
  board_id: string
  column_id: string
  title: string
  description: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent' | string
  status_slug: string
  due_date: string | null
  complexity: number | null
  assignee_email: string | null
  assignee_id: string | null
  created_by_email: string
  created_at: string
  updated_at: string
  column_name?: string
  column_slug?: string
  column_position?: number
}

export interface BoardMetrics {
  boardId: string
  title: string
  totalTasks: number
  doneTasks: number
  completionRate: number
  overdueTasks: number
  unassignedTasks: number
  averageComplexity: number
  byColumn: Array<{ id: string; name: string; slug: string; position: number; taskCount: number }>
  generatedAt: string
}

export interface TaskSignal {
  id: string
  board_id: string
  task_id: string
  signal_type: string
  severity: 'critical' | 'high' | 'medium' | 'low' | string
  message: string
  details: string
  created_at: string
}

export interface TaskHistoryEntry {
  id: string
  task_id: string
  board_id: string
  from_column_id: string | null
  to_column_id: string | null
  from_status_slug: string | null
  to_status_slug: string | null
  moved_by_email: string
  note: string | null
  created_at: string
  due_date: string | null
  task_title?: string
}

export interface BoardDetail {
  board: Board
  columns: BoardColumn[]
  tasks: Task[]
  metrics: BoardMetrics | null
  signals: TaskSignal[]
}

export interface BoardMember {
  id: string
  username: string
  email: string
}

export interface TrelloConnectionStatus {
  id: string
  user_email: string
  team_id: string
  access_token: string | null
  token_secret: string | null
  trello_member_id: string | null
  trello_member_name: string | null
  status: string
  last_sync_at: string | null
  last_error: string | null
  retry_count: number
  next_sync_at: string | null
  created_at: string
  updated_at: string
  pendingJobs: number
  failedJobs: number
}

export interface TrelloSyncJob {
  id: string
  connection_id: string
  job_type: string
  payload: string
  status: string
  attempts: number
  max_attempts: number
  next_attempt_at: string
  last_error: string | null
  created_at?: string
  updated_at?: string
}

export interface TrelloIntegrationStatus {
  configured: boolean
  connections: TrelloConnectionStatus[]
  jobs: TrelloSyncJob[]
}

// ---------- KPI types ----------

export interface OperationalKpis {
  adtHours: number
  adtDays: number
  vrr: number
  err: number
  reviewSaturation: number
  totals: {
    totalTasks: number
    completedTasks: number
    activeTasks: number
    inReview: number
    validatedTasks: number
    backwardMoves: number
    totalMoves: number
  }
}

export interface FocusScore {
  email: string
  score: number
  label: 'excellent' | 'good' | 'fair' | 'poor' | string
  indicators: {
    contextSwitches: number
    unfinishedTasks: number
    blockers: number
    reassignments: number
    assignedTasks: number
    movesAnalyzed: number
  }
  penalties: {
    contextSwitchPenalty: number
    unfinishedPenalty: number
    blockerPenalty: number
    reassignmentPenalty: number
  }
}

export interface TeamPulse {
  state: 'healthy' | 'overloaded' | 'unstable' | 'critical' | string
  score: number
  inputs: Record<string, number>
}

// ---------- request helper ----------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(`${API_URL}${path}`, init)
  const raw = await res.text()
  let data: unknown = null
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      data = { message: raw }
    }
  }

  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `Request failed (${res.status})`
    throw new Error(message)
  }

  return data as T
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// ---------- Boards module ----------

export const boardsApi = {
  list: () => request<{ boards: BoardListItem[] }>('/boards'),

  get: (boardId: string) => request<BoardDetail>(`/boards/${boardId}`),

  members: (boardId: string) => request<{ members: BoardMember[] }>(`/boards/${boardId}/members`),

  create: (payload: {
    title: string
    visibility?: string
    source?: string
    linkedProject?: string
    teamId?: string
    columns?: string[]
  }) => request<{ message: string; board: { id: string } }>('/boards', jsonInit('POST', payload)),

  remove: (boardId: string) => request<{ message: string }>(`/boards/${boardId}`, { method: 'DELETE' }),

  addColumn: (boardId: string, name: string) =>
    request<{ message: string }>(`/boards/${boardId}/columns`, jsonInit('POST', { name })),

  deleteColumn: (boardId: string, columnId: string) =>
    request<{ message: string }>(`/boards/${boardId}/columns/${columnId}`, { method: 'DELETE' }),

  createTask: (boardId: string, payload: {
    title: string
    description?: string
    priority?: string
    dueDate?: string
    complexity?: number
    assigneeId?: string
    columnId?: string
  }) => request<{ message: string }>(`/boards/${boardId}/tasks`, jsonInit('POST', payload)),

  updateTask: (boardId: string, taskId: string, payload: {
    title?: string
    description?: string
    priority?: string
    dueDate?: string
    complexity?: number
    assigneeId?: string
  }) => request<{ message: string }>(`/boards/${boardId}/tasks/${taskId}`, jsonInit('PATCH', payload)),

  moveTask: (boardId: string, taskId: string, toColumnId: string, note?: string) =>
    request<{ message: string }>(
      `/boards/${boardId}/tasks/${taskId}/move`,
      jsonInit('POST', { toColumnId, note }),
    ),

  taskHistory: (boardId: string, taskId: string) =>
    request<{ history: TaskHistoryEntry[] }>(`/boards/${boardId}/tasks/${taskId}/history`),
}

// ---------- KPI engine ----------

export const kpiApi = {
  board: (boardId: string) =>
    request<{ boardId: string; kpis: OperationalKpis; generatedAt: string }>(`/kpi/boards/${boardId}`),

  userFocus: (email: string, days = 30) =>
    request<{ windowDays: number; focus: FocusScore; generatedAt: string }>(
      `/kpi/users/${encodeURIComponent(email)}/focus?days=${days}`,
    ),

  teamPulse: (teamId: string, days = 30) =>
    request<{ teamId: string; windowDays: number; pulse: TeamPulse; generatedAt: string }>(
      `/kpi/teams/${teamId}/pulse?days=${days}`,
    ),

  teamDashboard: (teamId: string, days = 30) =>
    request<{
      teamId: string
      windowDays: number
      pulse: TeamPulse
      focusScores: FocusScore[]
      generatedAt: string
    }>(`/kpi/teams/${teamId}/dashboard?days=${days}`),
}

// ---------- Trello integration ----------

export const trelloApi = {
  status: () => request<TrelloIntegrationStatus>('/integrations/trello/status'),

  connect: (teamId: string) => request<{ authorizationUrl: string }>('/integrations/trello/connect', jsonInit('POST', { teamId })),

  sync: (connectionId: string) => request<{ message: string; jobId: string }>('/integrations/trello/sync', jsonInit('POST', { connectionId })),

  disconnect: (connectionId: string) => request<{ message: string }>('/integrations/trello/disconnect', jsonInit('POST', { connectionId })),
}
