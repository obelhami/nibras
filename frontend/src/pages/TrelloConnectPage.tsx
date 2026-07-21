import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import WorkspaceLayout from '../components/WorkspaceLayout'
import { GhostButton, PrimaryButton, VisibilityBadge, inputClass, labelClass } from '../components/ui'
import { formatDate } from '../lib/format'
import {
  boardsApi,
  teamsApi,
  trelloApi,
  type BoardListItem,
  type Team,
  type TrelloConnectionStatus,
  type TrelloIntegrationStatus,
} from '../lib/api'
import { clearAuthTokens, getAccessToken } from '../lib/auth'

const ACTIVE_JOB_STATUSES = ['queued', 'retrying', 'processing']
const POLL_INTERVAL_MS = 4000

// ---------- badges ----------

const JOB_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  synced: 'Synchronisé',
  queued: 'En file',
  retrying: 'Nouvel essai',
  processing: 'En cours',
  completed: 'Terminé',
  failed: 'Échoué',
  disconnected: 'Déconnectée',
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    synced: 'bg-blue-50 text-blue-700 ring-blue-100',
    completed: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    queued: 'bg-amber-50 text-amber-700 ring-amber-100',
    retrying: 'bg-orange-50 text-orange-700 ring-orange-100',
    processing: 'bg-violet-50 text-violet-700 ring-violet-100',
    failed: 'bg-red-50 text-red-700 ring-red-100',
    disconnected: 'bg-gray-100 text-gray-600 ring-gray-200',
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${palette[status] ?? palette.disconnected}`}>
      {status === 'processing' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
      )}
      {JOB_STATUS_LABELS[status] ?? status}
    </span>
  )
}

function TrelloMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M21 3H3a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 3 21h18a1.5 1.5 0 0 0 1.5-1.5v-15A1.5 1.5 0 0 0 21 3zM10.44 16.18a.72.72 0 0 1-.72.72H5.28a.72.72 0 0 1-.72-.72V5.78a.72.72 0 0 1 .72-.72h4.44a.72.72 0 0 1 .72.72zm9-5.4a.72.72 0 0 1-.72.72h-4.44a.72.72 0 0 1-.72-.72v-5a.72.72 0 0 1 .72-.72h4.44a.72.72 0 0 1 .72.72z" />
    </svg>
  )
}

// ---------- connection card ----------

function ConnectionCard({
  connection,
  teamName,
  onSync,
  onDisconnect,
  syncing,
  disconnecting,
}: {
  connection: TrelloConnectionStatus
  teamName: string | null
  onSync: (connectionId: string) => void
  onDisconnect: (connectionId: string) => void
  syncing: boolean
  disconnecting: boolean
}) {
  const busy = connection.pendingJobs > 0

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <TrelloMark className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-gray-900">{teamName ?? `Équipe ${connection.team_id}`}</h3>
              <StatusPill status={connection.status} />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Compte Trello : <span className="font-medium text-gray-700">{connection.trello_member_name ?? 'inconnu'}</span>
            </p>
            <p className="text-xs text-gray-400">
              Dernière synchro : {connection.last_sync_at ? formatDate(connection.last_sync_at) : 'jamais'}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-gray-400">
          {busy ? (
            <p className="font-medium text-amber-600">{connection.pendingJobs} job{connection.pendingJobs > 1 ? 's' : ''} en cours</p>
          ) : (
            <p>Aucun job en attente</p>
          )}
          {connection.failedJobs > 0 && (
            <p className="mt-0.5 font-medium text-red-500">{connection.failedJobs} job{connection.failedJobs > 1 ? 's' : ''} échoué{connection.failedJobs > 1 ? 's' : ''}</p>
          )}
        </div>
      </div>

      {connection.last_error && (
        <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {connection.last_error}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <PrimaryButton onClick={() => onSync(connection.id)} disabled={syncing || busy || connection.status !== 'active'}>
          {syncing || busy ? 'Synchronisation…' : 'Synchroniser maintenant'}
        </PrimaryButton>
        <GhostButton
          onClick={() => onDisconnect(connection.id)}
          disabled={disconnecting}
          className="border-red-200 text-red-600 hover:bg-red-50"
        >
          {disconnecting ? 'Déconnexion…' : 'Déconnecter'}
        </GhostButton>
      </div>
    </div>
  )
}

// ---------- imported board card ----------

function ImportedBoardCard({ board }: { board: BoardListItem }) {
  return (
    <Link
      to={`/boards/${board.id}`}
      className="group rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
            <TrelloMark className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-gray-900 group-hover:text-blue-600">{board.title}</h3>
        </div>
        <VisibilityBadge visibility={board.visibility} />
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
        <span>{board.taskCount} tâche{board.taskCount > 1 ? 's' : ''} · {board.columns.length} colonne{board.columns.length > 1 ? 's' : ''}</span>
        <span>Maj {formatDate(board.updated_at)}</span>
      </div>
    </Link>
  )
}

// ---------- page ----------

export default function TrelloConnectPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])

  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState(searchParams.get('teamId') ?? '')
  const [status, setStatus] = useState<TrelloIntegrationStatus | null>(null)
  const [trelloBoards, setTrelloBoards] = useState<BoardListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)

  const teamNameById = useMemo(
    () => new Map(teams.map((team) => [team.id, team.name] as const)),
    [teams],
  )

  const refresh = useCallback(async (showErrors = true) => {
    try {
      const [statusData, boardsData] = await Promise.all([
        trelloApi.status(),
        boardsApi.list(),
      ])
      setStatus(statusData)
      setTrelloBoards(boardsData.boards.filter((board) => board.source === 'trello'))
    } catch (error) {
      if (showErrors) {
        toast.error(error instanceof Error ? error.message : 'Impossible de charger le statut Trello')
      }
    }
  }, [])

  // initial load
  useEffect(() => {
    if (!getAccessToken()) {
      clearAuthTokens()
      navigate('/', { replace: true })
      return
    }

    const queryStatus = searchParams.get('status')
    if (queryStatus === 'connected') {
      toast.success('Trello connecté — synchronisation initiale en file d’attente')
    }
    if (queryStatus === 'error') {
      toast.error('La connexion Trello a échoué')
    }

    Promise.all([
      refresh(),
      teamsApi
        .list()
        .then((data) => {
          setTeams(data.teams)
          // only one possible destination → pick it, the flow becomes one click
          setTeamId((current) => current || (data.teams.length === 1 ? data.teams[0]?.id ?? '' : ''))
        })
        .catch(() => setTeams([])),
    ]).finally(() => setLoading(false))
  }, [navigate, searchParams, refresh])

  // live polling while jobs are running
  const hasActiveJobs = useMemo(
    () => status?.jobs.some((job) => ACTIVE_JOB_STATUSES.includes(job.status)) ?? false,
    [status],
  )

  useEffect(() => {
    if (!hasActiveJobs) return
    const timer = setInterval(() => void refresh(false), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [hasActiveJobs, refresh])

  const handleConnect = async () => {
    if (!teamId.trim()) {
      toast.error('Sélectionnez une équipe à relier à Trello')
      return
    }

    setConnecting(true)
    try {
      const { authorizationUrl } = await trelloApi.connect(teamId.trim())
      window.location.assign(authorizationUrl)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de démarrer OAuth')
      setConnecting(false)
    }
  }

  const handleSync = async (connectionId: string) => {
    setSyncingId(connectionId)
    try {
      await trelloApi.sync(connectionId)
      toast.success('Synchronisation Trello mise en file')
      await refresh(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de lancer la synchronisation')
    } finally {
      setSyncingId(null)
    }
  }

  const handleDisconnect = async (connectionId: string) => {
    if (!confirm('Déconnecter ce compte Trello ? Les tableaux déjà importés seront conservés.')) {
      return
    }

    setDisconnectingId(connectionId)
    try {
      await trelloApi.disconnect(connectionId)
      toast.success('Compte Trello déconnecté')
      await refresh(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de déconnecter le compte Trello')
    } finally {
      setDisconnectingId(null)
    }
  }

  const connections = status?.connections ?? []
  const jobs = status?.jobs ?? []

  return (
    <WorkspaceLayout>
      {/* hero + connect panel */}
      <div className="mb-8 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-8 text-white shadow-xl">
          <div className="max-w-2xl">
            <span className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-200">
              <TrelloMark className="h-3.5 w-3.5" />
              Trello Connect
            </span>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Vos tableaux Trello, directement dans NIBRAS.</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">
              Connectez un compte Trello par équipe : les boards, listes, cartes, membres et labels sont importés
              en arrière-plan et alimentent les KPIs comme n’importe quel tableau NIBRAS.
            </p>
          </div>

          <div className="mt-8 grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">OAuth</p>
              <p className="mt-2 font-semibold">Autorisation sécurisée, aucun mot de passe stocké</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Mapping</p>
              <p className="mt-2 font-semibold">Cards → tâches, lists → colonnes, labels → priorités</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Sync</p>
              <p className="mt-2 font-semibold">Worker asynchrone avec retries — l’interface ne bloque jamais</p>
            </div>
          </div>
        </section>

        <aside className="rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">Connecter Trello</h2>
          <p className="mt-1 text-sm text-gray-500">
            Vos tableaux Trello seront importés à l’identique dans l’équipe choisie — l’équivalent NIBRAS de
            votre workspace Trello.
          </p>

          <div className="mt-5 space-y-4">
            <div>
              <label className={labelClass}>Équipe</label>
              {teams.length > 0 ? (
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={inputClass}>
                  <option value="">Sélectionner une équipe…</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  placeholder="ID de l’équipe"
                  className={inputClass}
                />
              )}
            </div>

            <PrimaryButton onClick={handleConnect} disabled={connecting} className="w-full">
              {connecting ? 'Redirection vers Trello…' : 'Connecter Trello'}
            </PrimaryButton>

            {status && !status.configured && (
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                Les clés API Trello ne sont pas configurées côté serveur
                (<code>TRELLO_API_KEY</code> / <code>TRELLO_API_SECRET</code>). La connexion sera refusée tant
                qu’elles ne sont pas renseignées.
              </div>
            )}

            <p className="text-xs leading-5 text-gray-400">
              Vous serez redirigé vers Trello pour autoriser NIBRAS, puis la synchronisation initiale
              démarre automatiquement.
            </p>
          </div>
        </aside>
      </div>

      {/* connections */}
      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Connexions</h2>
            <p className="mt-1 text-sm text-gray-500">Une connexion relie un compte Trello à une équipe NIBRAS.</p>
          </div>
          <div className="flex items-center gap-2">
            {hasActiveJobs && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
                Synchronisation en cours
              </span>
            )}
            {status && (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {status.configured ? 'OAuth configuré' : 'OAuth non configuré'}
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />
            <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />
          </div>
        ) : connections.length ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                teamName={teamNameById.get(connection.team_id) ?? null}
                onSync={handleSync}
                onDisconnect={handleDisconnect}
                syncing={syncingId === connection.id}
                disconnecting={disconnectingId === connection.id}
              />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-5 py-10 text-center text-sm text-gray-500">
            Aucune connexion Trello pour le moment — reliez une équipe pour importer vos tableaux.
          </div>
        )}
      </section>

      {/* imported boards */}
      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Tableaux importés</h2>
            <p className="mt-1 text-sm text-gray-500">
              Les tableaux synchronisés depuis Trello s’ouvrent dans la vue Kanban NIBRAS.
            </p>
          </div>
          <Link to="/boards" className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-700">
            Tous les tableaux →
          </Link>
        </div>

        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="h-24 animate-pulse rounded-2xl bg-gray-100" />
            <div className="h-24 animate-pulse rounded-2xl bg-gray-100" />
            <div className="h-24 animate-pulse rounded-2xl bg-gray-100" />
          </div>
        ) : trelloBoards.length ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {trelloBoards.map((board) => (
              <ImportedBoardCard key={board.id} board={board} />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-5 py-10 text-center text-sm text-gray-500">
            {hasActiveJobs
              ? 'Import en cours — les tableaux apparaîtront ici dès la fin de la synchronisation.'
              : 'Aucun tableau importé pour le moment. Lancez une synchronisation pour récupérer vos boards Trello.'}
          </div>
        )}
      </section>

      {/* jobs */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Historique des synchronisations</h2>
            <p className="mt-1 text-sm text-gray-500">
              Le worker traite la file toutes les 60 secondes, avec retries automatiques en cas d’échec.
            </p>
          </div>
          <button
            onClick={() => void refresh()}
            className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Rafraîchir
          </button>
        </div>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-gray-100">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[1.1fr_0.9fr_0.6fr_1.4fr] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <span>Équipe</span>
              <span>Statut</span>
              <span>Essais</span>
              <span>Dernière erreur</span>
            </div>
            {jobs.length ? (
              jobs.map((job) => {
                const connection = connections.find((item) => item.id === job.connection_id)
                const teamLabel = connection
                  ? teamNameById.get(connection.team_id) ?? connection.team_id
                  : '—'
                return (
                  <div key={job.id} className="grid grid-cols-[1.1fr_0.9fr_0.6fr_1.4fr] items-center gap-3 border-b border-gray-100 px-4 py-3 text-sm last:border-b-0">
                    <span className="truncate font-medium text-gray-800">{teamLabel}</span>
                    <span><StatusPill status={job.status} /></span>
                    <span className="text-gray-600">{job.attempts}/{job.max_attempts}</span>
                    <span className="truncate text-gray-500" title={job.last_error ?? undefined}>{job.last_error ?? '—'}</span>
                  </div>
                )
              })
            ) : (
              <div className="px-4 py-8 text-center text-sm text-gray-500">Aucune synchronisation pour le moment.</div>
            )}
          </div>
        </div>
      </section>
    </WorkspaceLayout>
  )
}
