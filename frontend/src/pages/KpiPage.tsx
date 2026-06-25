import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import WorkspaceLayout from '../components/WorkspaceLayout'
import { GhostButton, inputClass } from '../components/ui'
import {
  boardsApi,
  kpiApi,
  type BoardListItem,
  type FocusScore,
  type OperationalKpis,
  type TeamPulse,
} from '../lib/api'

const WINDOWS = [7, 14, 30, 90]

// ---------- colour helpers ----------

const FOCUS_COLORS: Record<string, { ring: string; text: string; bg: string; label: string }> = {
  excellent: { ring: '#10b981', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Excellent' },
  good: { ring: '#3b82f6', text: 'text-blue-600', bg: 'bg-blue-50', label: 'Bon' },
  fair: { ring: '#f59e0b', text: 'text-amber-600', bg: 'bg-amber-50', label: 'Moyen' },
  poor: { ring: '#ef4444', text: 'text-red-600', bg: 'bg-red-50', label: 'Faible' },
}

const PULSE_STYLES: Record<string, { text: string; bg: string; ring: string; label: string }> = {
  healthy: { text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-100', ring: '#10b981', label: 'Saine' },
  overloaded: { text: 'text-amber-700', bg: 'bg-amber-50 border-amber-100', ring: '#f59e0b', label: 'Surchargée' },
  unstable: { text: 'text-orange-700', bg: 'bg-orange-50 border-orange-100', ring: '#f97316', label: 'Instable' },
  critical: { text: 'text-red-700', bg: 'bg-red-50 border-red-100', ring: '#ef4444', label: 'Critique' },
}

function ScoreRing({ score, color, size = 72 }: { score: number; color: string; size?: number }) {
  const stroke = 7
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-[stroke-dashoffset] duration-700"
      />
      <text
        x="50%"
        y="50%"
        dy="0.35em"
        textAnchor="middle"
        className="rotate-90 fill-gray-800 text-base font-bold"
        style={{ transformOrigin: 'center' }}
      >
        {score}
      </text>
    </svg>
  )
}

// ---------- operational KPI metric ----------

function KpiTile({
  label,
  value,
  unit,
  hint,
  tone = 'blue',
}: {
  label: string
  value: number | string
  unit?: string
  hint?: string
  tone?: 'blue' | 'emerald' | 'amber' | 'red'
}) {
  const tones = {
    blue: 'text-blue-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-500',
  }
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <p className="text-xs font-medium text-gray-400">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${tones[tone]}`}>
        {value}
        {unit && <span className="ml-0.5 text-lg">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-xs leading-relaxed text-gray-400">{hint}</p>}
    </div>
  )
}

// ---------- focus card ----------

const PENALTY_LABELS: Record<string, string> = {
  contextSwitchPenalty: 'Changements de contexte',
  unfinishedPenalty: 'Tâches non terminées',
  blockerPenalty: 'Blocages',
  reassignmentPenalty: 'Réassignations',
}

function FocusCard({ focus }: { focus: FocusScore }) {
  const colors = FOCUS_COLORS[focus.label] ?? FOCUS_COLORS.fair
  const maxPenalty = 30
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="flex items-center gap-4">
        <ScoreRing score={focus.score} color={colors.ring} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-gray-800">{focus.email}</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${colors.bg} ${colors.text}`}>
            {colors.label}
          </span>
          <p className="mt-1.5 text-xs text-gray-400">
            {focus.indicators.assignedTasks} tâches · {focus.indicators.movesAnalyzed} mouvements
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        {Object.entries(focus.penalties).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-36 shrink-0 text-[11px] text-gray-500">{PENALTY_LABELS[key] ?? key}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-red-300"
                style={{ width: `${Math.min(100, (value / maxPenalty) * 100)}%` }}
              />
            </div>
            <span className="w-6 shrink-0 text-right text-[11px] font-medium text-gray-500">−{value}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 border-t border-gray-100 pt-3 text-center">
        <Indicator label="Contexte" value={focus.indicators.contextSwitches} />
        <Indicator label="Non fin." value={focus.indicators.unfinishedTasks} />
        <Indicator label="Blocages" value={focus.indicators.blockers} />
        <Indicator label="Réassign." value={focus.indicators.reassignments} />
      </div>
    </div>
  )
}

function Indicator({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-base font-bold text-gray-800">{value}</p>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  )
}

// ---------- section heading ----------

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-bold text-gray-900">{children}</h2>
      {hint && <p className="mt-0.5 text-sm text-gray-400">{hint}</p>}
    </div>
  )
}

// ---------- page ----------

export default function KpiPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [boards, setBoards] = useState<BoardListItem[]>([])
  const [boardId, setBoardId] = useState(searchParams.get('board') ?? '')
  const [days, setDays] = useState(30)

  const [operational, setOperational] = useState<OperationalKpis | null>(null)
  const [loadingOps, setLoadingOps] = useState(false)

  const [assignees, setAssignees] = useState<string[]>([])
  const [focusScores, setFocusScores] = useState<FocusScore[]>([])
  const [loadingFocus, setLoadingFocus] = useState(false)
  const [manualEmail, setManualEmail] = useState('')

  const [teamId, setTeamId] = useState('')
  const [pulse, setPulse] = useState<TeamPulse | null>(null)
  const [pulseMembers, setPulseMembers] = useState<FocusScore[]>([])
  const [loadingPulse, setLoadingPulse] = useState(false)

  // boards for the selector
  useEffect(() => {
    boardsApi
      .list()
      .then((data) => {
        setBoards(data.boards)
        if (!boardId && data.boards[0]) setBoardId(data.boards[0].id)
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Échec du chargement des tableaux'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedBoard = useMemo(() => boards.find((b) => b.id === boardId), [boards, boardId])

  // Load board operational KPIs + derive assignees + team focus scores whenever board/days change.
  const loadBoardKpis = useCallback(async () => {
    if (!boardId) return
    setLoadingOps(true)
    setLoadingFocus(true)
    try {
      const [opsRes, detail] = await Promise.all([kpiApi.board(boardId), boardsApi.get(boardId)])
      setOperational(opsRes.kpis)

      const uniqueAssignees = Array.from(
        new Set(detail.tasks.map((t) => t.assignee_email).filter((e): e is string => !!e)),
      )
      setAssignees(uniqueAssignees)

      if (detail.board.team_id) setTeamId(detail.board.team_id)

      const scores = await Promise.all(
        uniqueAssignees.map((email) =>
          kpiApi.userFocus(email, days).then((r) => r.focus).catch(() => null)),
      )
      setFocusScores(scores.filter((s): s is FocusScore => !!s))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec du chargement des KPIs')
      setOperational(null)
    } finally {
      setLoadingOps(false)
      setLoadingFocus(false)
    }
  }, [boardId, days])

  useEffect(() => {
    loadBoardKpis()
  }, [loadBoardKpis])

  const handleBoardChange = (id: string) => {
    setBoardId(id)
    setSearchParams(id ? { board: id } : {}, { replace: true })
  }

  const handleManualFocus = async (e: React.FormEvent) => {
    e.preventDefault()
    const email = manualEmail.trim()
    if (!email) return
    try {
      const res = await kpiApi.userFocus(email, days)
      setFocusScores((prev) => [res.focus, ...prev.filter((f) => f.email !== email)])
      if (!assignees.includes(email)) setAssignees((prev) => [email, ...prev])
      setManualEmail('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Utilisateur introuvable')
    }
  }

  const loadPulse = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!teamId.trim()) {
      toast.error('Saisissez un ID d\'équipe')
      return
    }
    setLoadingPulse(true)
    try {
      const res = await kpiApi.teamDashboard(teamId.trim(), days)
      setPulse(res.pulse)
      setPulseMembers(res.focusScores)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec du chargement du pouls d\'équipe')
      setPulse(null)
      setPulseMembers([])
    } finally {
      setLoadingPulse(false)
    }
  }

  const pulseStyle = pulse ? PULSE_STYLES[pulse.state] ?? PULSE_STYLES.unstable : null

  return (
    <WorkspaceLayout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Moteur KPI</h1>
          <p className="mt-1 text-sm text-gray-500">
            Analyse opérationnelle, focus par utilisateur et santé d'équipe.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Tableau</label>
            <select
              value={boardId}
              onChange={(e) => handleBoardChange(e.target.value)}
              className={`${inputClass} min-w-52`}
            >
              {boards.length === 0 && <option value="">Aucun tableau</option>}
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Fenêtre</label>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputClass}>
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w} jours
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!boardId ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center text-sm text-gray-500">
          Créez un tableau pour visualiser les KPIs.
        </div>
      ) : (
        <div className="space-y-10">
          {/* ---------- Operational KPIs ---------- */}
          <section>
            <SectionTitle hint={selectedBoard ? `Tableau « ${selectedBoard.title} »` : undefined}>
              KPIs opérationnels
            </SectionTitle>
            {loadingOps ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-28 animate-pulse rounded-2xl border border-gray-100 bg-white" />
                ))}
              </div>
            ) : operational ? (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <KpiTile
                    label="Délai de livraison (ADT)"
                    value={operational.adtDays}
                    unit="j"
                    hint="Temps moyen création → terminé"
                  />
                  <KpiTile
                    label="Taux de validation (VRR)"
                    value={operational.vrr}
                    unit="%"
                    tone="emerald"
                    hint="Revues effectivement livrées"
                  />
                  <KpiTile
                    label="Taux de reprise (ERR)"
                    value={operational.err}
                    unit="%"
                    tone={operational.err > 15 ? 'red' : 'amber'}
                    hint="Mouvements en arrière (rework)"
                  />
                  <KpiTile
                    label="Saturation des revues"
                    value={operational.reviewSaturation}
                    unit="%"
                    tone={operational.reviewSaturation > 50 ? 'red' : 'blue'}
                    hint="Tâches actives bloquées en revue"
                  />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-7">
                  {[
                    ['Total', operational.totals.totalTasks],
                    ['Terminées', operational.totals.completedTasks],
                    ['Actives', operational.totals.activeTasks],
                    ['En revue', operational.totals.inReview],
                    ['Validées', operational.totals.validatedTasks],
                    ['Retours', operational.totals.backwardMoves],
                    ['Mouvements', operational.totals.totalMoves],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-center">
                      <p className="text-lg font-bold text-gray-800">{value}</p>
                      <p className="text-[10px] text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-400">Aucune donnée KPI.</p>
            )}
          </section>

          {/* ---------- Focus per user ---------- */}
          <section>
            <SectionTitle hint="Score de concentration (0-100) pour chaque membre actif sur le tableau">
              Focus par utilisateur
            </SectionTitle>

            <form onSubmit={handleManualFocus} className="mb-4 flex gap-2">
              <input
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="Chercher un utilisateur par email…"
                className={`${inputClass} max-w-sm`}
              />
              <GhostButton type="submit">Analyser</GhostButton>
            </form>

            {loadingFocus ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-56 animate-pulse rounded-2xl border border-gray-100 bg-white" />
                ))}
              </div>
            ) : focusScores.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-8 text-center text-sm text-gray-400">
                {assignees.length === 0
                  ? 'Aucune tâche assignée sur ce tableau. Assignez des tâches ou cherchez un utilisateur ci-dessus.'
                  : 'Chargement des scores…'}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {focusScores.map((focus) => (
                  <FocusCard key={focus.email} focus={focus} />
                ))}
              </div>
            )}
          </section>

          {/* ---------- Team pulse ---------- */}
          <section>
            <SectionTitle hint="Santé globale de l'équipe propriétaire du tableau (ou saisissez un ID d'équipe)">
              Pouls d'équipe
            </SectionTitle>

            <form onSubmit={loadPulse} className="mb-4 flex gap-2">
              <input
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                placeholder="ID d'équipe"
                className={`${inputClass} max-w-sm`}
              />
              <GhostButton type="submit" disabled={loadingPulse}>
                {loadingPulse ? '...' : 'Charger le pouls'}
              </GhostButton>
            </form>

            {pulse && pulseStyle && (
              <div className="space-y-4">
                <div className={`flex items-center gap-5 rounded-2xl border p-5 ${pulseStyle.bg}`}>
                  <ScoreRing score={pulse.score} color={pulseStyle.ring} size={84} />
                  <div>
                    <p className={`text-xl font-bold ${pulseStyle.text}`}>{pulseStyle.label}</p>
                    <p className="mt-1 text-sm text-gray-500">
                      Score de santé {pulse.score}/100 · {pulse.inputs.members} membres ·{' '}
                      {pulse.inputs.activeTasks} tâches actives
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ['Charge / membre', pulse.inputs.workloadPerMember],
                    ['En retard', pulse.inputs.overdueTasks],
                    ['Retard %', `${pulse.inputs.overdueRatio}%`],
                    ['Saturation revue', `${pulse.inputs.reviewSaturation}%`],
                    ['Taux de retard', `${pulse.inputs.delayRate}%`],
                    ['Blocages', pulse.inputs.blockers],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-center">
                      <p className="text-base font-bold text-gray-800">{value}</p>
                      <p className="text-[10px] text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>

                {pulseMembers.length > 0 && (
                  <div>
                    <p className="mb-3 text-sm font-semibold text-gray-600">Focus des membres</p>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {pulseMembers.map((focus) => (
                        <FocusCard key={focus.email} focus={focus} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </WorkspaceLayout>
  )
}
