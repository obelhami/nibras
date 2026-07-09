import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import WorkspaceLayout from '../components/WorkspaceLayout'
import { GhostButton, PrimaryButton, inputClass, labelClass } from '../components/ui'
import { formatDate } from '../lib/format'
import { trelloApi, type TrelloIntegrationStatus, type TrelloConnectionStatus } from '../lib/api'
import { clearAuthTokens, getAccessToken } from '../lib/auth'

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    synced: 'bg-blue-50 text-blue-700 ring-blue-100',
    queued: 'bg-amber-50 text-amber-700 ring-amber-100',
    retrying: 'bg-orange-50 text-orange-700 ring-orange-100',
    processing: 'bg-violet-50 text-violet-700 ring-violet-100',
    failed: 'bg-red-50 text-red-700 ring-red-100',
    disconnected: 'bg-gray-100 text-gray-600 ring-gray-200',
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${palette[status] ?? palette.disconnected}`}>
      {status}
    </span>
  )
}

function ConnectionCard({
  connection,
  onSync,
  onDisconnect,
  syncing,
  disconnecting,
}: {
  connection: TrelloConnectionStatus
  onSync: (connectionId: string) => void
  onDisconnect: (connectionId: string) => void
  syncing: boolean
  disconnecting: boolean
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-lg font-bold text-gray-900">Team {connection.team_id}</h3>
            <StatusPill status={connection.status} />
          </div>
          <p className="text-sm text-gray-500">
            Compte connecté: <span className="font-medium text-gray-700">{connection.trello_member_name ?? 'unknown'}</span>
          </p>
          <p className="text-xs text-gray-400">Dernière synchro {connection.last_sync_at ? formatDate(connection.last_sync_at) : 'jamais'}</p>
        </div>
        <div className="text-right text-xs text-gray-400">
          <p>{connection.pendingJobs} jobs en attente</p>
          <p>{connection.failedJobs} jobs échoués</p>
        </div>
      </div>

      {connection.last_error && (
        <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {connection.last_error}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <PrimaryButton onClick={() => onSync(connection.id)} disabled={syncing}>
          {syncing ? 'Synchronisation...' : 'Synchroniser maintenant'}
        </PrimaryButton>
        <GhostButton onClick={() => onDisconnect(connection.id)} disabled={disconnecting} className="border-red-200 text-red-600 hover:bg-red-50">
          {disconnecting ? 'Suppression...' : 'Déconnecter'}
        </GhostButton>
      </div>
    </div>
  )
}

export default function TrelloConnectPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const [teamId, setTeamId] = useState(searchParams.get('teamId') ?? '')
  const [status, setStatus] = useState<TrelloIntegrationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)

  useEffect(() => {
    if (!getAccessToken()) {
      clearAuthTokens()
      navigate('/', { replace: true })
      return
    }

    const queryStatus = searchParams.get('status')
    if (queryStatus === 'connected') {
      toast.success('Trello connecté')
    }
    if (queryStatus === 'error') {
      toast.error('La connexion Trello a échoué')
    }

    trelloApi
      .status()
      .then((data) => setStatus(data))
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : 'Impossible de charger le statut Trello')
      })
      .finally(() => setLoading(false))
  }, [navigate, searchParams])

  const handleConnect = async () => {
    if (!teamId.trim()) {
      toast.error("L'ID de l'équipe est requis")
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
      const refreshed = await trelloApi.status()
      setStatus(refreshed)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de lancer la synchronisation')
    } finally {
      setSyncingId(null)
    }
  }

  const handleDisconnect = async (connectionId: string) => {
    if (!confirm('Déconnecter ce compte Trello ?')) {
      return
    }

    setDisconnectingId(connectionId)
    try {
      await trelloApi.disconnect(connectionId)
      toast.success('Compte Trello déconnecté')
      const refreshed = await trelloApi.status()
      setStatus(refreshed)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de déconnecter le compte Trello')
    } finally {
      setDisconnectingId(null)
    }
  }

  return (
    <WorkspaceLayout>
      <div className="mb-8 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-8 text-white shadow-xl">
          <div className="max-w-2xl">
            <span className="mb-4 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-200">
              Module 10 · Trello Connect
            </span>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Synchronisez Trello avec NIBRAS sans bloquer l’interface.</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">
              L’intégration passe par OAuth Trello côté backend, puis un worker asynchrone importe les boards, lists, cards, members et labels vers les entités NIBRAS.
            </p>
          </div>

          <div className="mt-8 grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">OAuth</p>
              <p className="mt-2 font-semibold">Connexion sécurisée par token OAuth</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Mapping</p>
              <p className="mt-2 font-semibold">Cards, lists, members, labels et boards mappés</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Sync</p>
              <p className="mt-2 font-semibold">Files d’attente, retries et erreurs persistées</p>
            </div>
          </div>
        </section>

        <aside className="rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">Connecter un board</h2>
          <p className="mt-1 text-sm text-gray-500">Ajoutez votre Team ID pour démarrer le flux OAuth.</p>

          <div className="mt-5 space-y-4">
            <div>
              <label className={labelClass}>ID équipe</label>
              <input
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                placeholder="team_123"
                className={inputClass}
              />
            </div>

            <PrimaryButton onClick={handleConnect} disabled={connecting} className="w-full">
              {connecting ? 'Ouverture...' : 'Connecter Trello'}
            </PrimaryButton>

            <p className="text-xs leading-5 text-gray-400">
              La connexion est gérée par le backend. Une fois autorisée, la synchronisation initiale est placée dans la file d’attente.
            </p>
          </div>
        </aside>
      </div>

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Connexions actives</h2>
            <p className="mt-1 text-sm text-gray-500">Le worker traite les jobs en arrière-plan avec retries et gestion des erreurs.</p>
          </div>
          {status && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {status.configured ? 'OAuth configuré' : 'OAuth non configuré'}
            </span>
          )}
        </div>

        {loading ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />
            <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />
          </div>
        ) : status?.connections.length ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {status.connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                onSync={handleSync}
                onDisconnect={handleDisconnect}
                syncing={syncingId === connection.id}
                disconnecting={disconnectingId === connection.id}
              />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-5 py-10 text-center text-sm text-gray-500">
            Aucune connexion Trello enregistrée pour le moment.
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Derniers jobs</h2>
            <p className="mt-1 text-sm text-gray-500">Historique des synchronisations et de leurs états.</p>
          </div>
          <button onClick={() => trelloApi.status().then(setStatus).catch(() => {})} className="text-sm font-medium text-blue-600 hover:text-blue-700">
            Rafraîchir
          </button>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-gray-100">
          <div className="grid grid-cols-[1.25fr_0.8fr_0.8fr_1fr] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <span>Job</span>
            <span>Statut</span>
            <span>Tentatives</span>
            <span>Dernière erreur</span>
          </div>
          {status?.jobs.length ? (
            status.jobs.map((job) => (
              <div key={job.id} className="grid grid-cols-[1.25fr_0.8fr_0.8fr_1fr] gap-3 border-b border-gray-100 px-4 py-3 text-sm last:border-b-0">
                <span className="font-medium text-gray-800">{job.job_type}</span>
                <span className="text-gray-600">{job.status}</span>
                <span className="text-gray-600">{job.attempts}/{job.max_attempts}</span>
                <span className="truncate text-gray-500">{job.last_error ?? '—'}</span>
              </div>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-gray-500">Aucun job pour le moment.</div>
          )}
        </div>
      </section>
    </WorkspaceLayout>
  )
}
