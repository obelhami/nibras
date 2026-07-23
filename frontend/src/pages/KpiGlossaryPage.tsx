import { useState } from 'react'
import WorkspaceLayout from '../components/WorkspaceLayout'

type GlossaryEntry = {
  code: string
  name: string
  objective: string
  reading: string
  category: 'operational' | 'emotional'
}

// Content mirrors the CDC (Nibras Requirements Specification V1.1, §16 —
// "Emotional KPIs and LDS KPI Glossary").
const ENTRIES: GlossaryEntry[] = [
  {
    code: 'ADT',
    name: 'Average Delivery Time',
    objective: "Mesure le temps moyen entre la création d'une tâche et sa livraison validée.",
    reading:
      'Bas = livraison rapide ; élevé = friction, dépendance ou surcharge. Un ADT trop bas peut aussi cacher de la dette ou du travail superficiel.',
    category: 'operational',
  },
  {
    code: 'VRR',
    name: 'Validation & Release Rate',
    objective: 'Mesure le pourcentage de livrables approuvés dès la première soumission.',
    reading: 'Élevé = stabilité et maîtrise ; bas = révisions fréquentes ou dette qualité.',
    category: 'operational',
  },
  {
    code: 'ERR',
    name: 'Error Rate Ratio',
    objective: 'Mesure les anomalies détectées après livraison (mouvements en arrière dans le board).',
    reading: 'Bas = environnement stable ; élevé = dette technique ou validation insuffisante.',
    category: 'operational',
  },
  {
    code: 'Review Saturation',
    name: 'Review Saturation',
    objective: 'Mesure la saturation de la file de validation/review.',
    reading: "Part des tâches actives actuellement en review — un ratio élevé annonce un goulot d'étranglement.",
    category: 'operational',
  },
  {
    code: 'CRT',
    name: 'Client Response Time',
    objective: 'Mesure le délai de réponse externe pour les validations et clarifications.',
    reading:
      "Révèle les dépendances externes et la fluidité de la collaboration. V1 : approximé par le temps passé en review (pas encore d'acteur « client » dédié dans le modèle de données).",
    category: 'operational',
  },
  {
    code: 'ADR',
    name: 'Active Documentation Ratio',
    objective: 'Mesure la production de documentation utile par rapport aux livrables.',
    reading:
      'Reflète la maintenabilité et la clarté de transmission. V1 : approximé par la présence d’au moins un commentaire sur les tâches livrées.',
    category: 'operational',
  },
  {
    code: 'PRR',
    name: 'Proactive Recommendation Rate',
    objective: "Mesure les initiatives proposées en dehors du périmètre initial.",
    reading: "Montre l'anticipation et la proactivité opérationnelle d'une équipe ou d'une personne.",
    category: 'operational',
  },
  {
    code: 'SLI',
    name: 'Self Learning Index',
    objective: 'Mesure l’apprentissage autonome utile à l’exécution.',
    reading:
      "Montre l'adaptabilité et l'accélération de l'apprentissage. Calculé en comparant le temps de cycle des premières tâches complétées à celui des plus récentes.",
    category: 'operational',
  },
  {
    code: 'Focus Score',
    name: 'Focus Score',
    objective: 'Mesure la capacité à avancer sans dispersion excessive.',
    reading:
      'Pénalise les changements de contexte fréquents, les tâches non terminées, les blocages et les réassignations.',
    category: 'emotional',
  },
  {
    code: 'Team Pulse',
    name: 'Team Pulse',
    objective: "Lit la santé émotionnelle et opérationnelle de l'équipe.",
    reading: 'États possibles : saine, surchargée, instable, critique.',
    category: 'emotional',
  },
  {
    code: 'Consistency Score',
    name: 'Consistency Score',
    objective: 'Mesure la régularité, la continuité et la fiabilité de la livraison.',
    reading: 'Un temps de cycle stable dans la durée indique une équipe qui livre de façon prévisible.',
    category: 'emotional',
  },
  {
    code: 'Deadline Safety',
    name: 'Deadline Safety',
    objective: 'Mesure la distance entre le rythme actuel et le risque de dépassement de délai.',
    reading: "Part des tâches ni en retard, ni à moins de 24h de leur échéance.",
    category: 'emotional',
  },
  {
    code: 'Bottleneck Score',
    name: 'Bottleneck Score',
    objective: 'Identifie les points de blocage et les dépendances critiques.',
    reading: "Baisse quand des tâches restent immobiles dans la même colonne plus de 7 jours.",
    category: 'emotional',
  },
  {
    code: 'Blocked Time Ratio',
    name: 'Blocked Time Ratio',
    objective: 'Mesure le temps perdu en statut bloqué.',
    reading: "Part des mouvements de l'historique associés à un signalement de blocage.",
    category: 'emotional',
  },
  {
    code: 'Risk Velocity',
    name: 'Risk Velocity',
    objective: "Mesure la vitesse à laquelle le risque augmente.",
    reading:
      "Compare le nombre de tâches en retard entre la première et la seconde moitié de la période observée. Positif = le risque s'accélère.",
    category: 'emotional',
  },
  {
    code: 'Delivery Stability Index',
    name: 'Delivery Stability Index',
    objective: 'Lit la stabilité globale de la livraison.',
    reading: 'Indice composite combinant consistency, deadline safety, bottleneck score et risk velocity.',
    category: 'emotional',
  },
]

const CATEGORY_LABELS: Record<GlossaryEntry['category'], string> = {
  operational: 'KPI Opérationnels (LDS Glossary)',
  emotional: 'Emotional KPIs',
}

function GlossaryCard({ entry }: { entry: GlossaryEntry }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">{entry.code}</h3>
      </div>
      <p className="mt-0.5 text-xs font-medium text-blue-600">{entry.name}</p>
      <p className="mt-3 text-sm text-gray-600">{entry.objective}</p>
      <div className="mt-3 rounded-lg bg-gray-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Lecture métier</p>
        <p className="mt-1 text-sm text-gray-700">{entry.reading}</p>
      </div>
    </div>
  )
}

export default function KpiGlossaryPage() {
  const [filter, setFilter] = useState<'all' | GlossaryEntry['category']>('all')

  const visibleEntries = ENTRIES.filter((entry) => filter === 'all' || entry.category === filter)

  return (
    <WorkspaceLayout>
      <div className="mx-auto max-w-5xl px-5 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Glossaire KPI</h1>
          <p className="mt-1 text-sm text-gray-500">
            Définitions et lecture métier des indicateurs Nibras — un KPI ne se lit jamais seul, il se
            croise avec le contexte, la période et la dynamique du projet.
          </p>
        </div>

        <div className="mb-6 flex gap-2">
          {(['all', 'operational', 'emotional'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                filter === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 ring-1 ring-inset ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {key === 'all' ? 'Tous' : CATEGORY_LABELS[key]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleEntries.map((entry) => (
            <GlossaryCard key={entry.code} entry={entry} />
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-blue-100 bg-blue-50 p-5">
          <p className="text-sm font-semibold text-blue-900">Philosophie KPI</p>
          <p className="mt-1 text-sm text-blue-800">
            Un KPI Nibras n'est jamais une punition, une note ou un outil de pression. Il aide à lire la
            livraison, comprendre les dynamiques humaines, détecter les signaux faibles et soutenir de
            meilleures décisions.
          </p>
        </div>
      </div>
    </WorkspaceLayout>
  )
}
