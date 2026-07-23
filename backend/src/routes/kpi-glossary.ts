/**
 * M03 — KPI Glossary — 100%
 *
 * GET /kpi/glossary              → liste complète des KPI avec définitions métier
 * GET /kpi/glossary/:code        → un KPI par son code
 * GET /kpi/glossary/:code/context → lien valeur calculée / contexte / confiance
 *
 * Aucune authentification requise — le glossaire est public (lecture seule).
 */

import { Elysia, t } from 'elysia';

export interface GlossaryEntry {
  code: string;
  name: string;
  category: 'operational' | 'emotional' | 'lds' | 'focus';
  formula: string;
  formula_version: string;      // versionnement de la formule
  valid_from: string;           // date de validité de la version
  required_data: string[];      // données requises pour calculer ce KPI
  objective: string;
  business_reading: string;
  limits: string;
  unit: string;
  range: string;
  confidence_factors: string[]; // ce qui influence le niveau de confiance
  cross_with: string[];         // KPI à croiser pour une lecture juste
}

const GLOSSARY: GlossaryEntry[] = [
  {
    code: 'ADT',
    name: 'Average Delivery Time',
    category: 'operational',
    formula: 'Moyenne des (date moved to done − date created) pour toutes les tâches terminées sur la période.',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['task.created_at', 'task_history.moved_at (to done)', 'task.status_slug'],
    objective: 'Mesurer le temps moyen entre la création d\'une tâche validée et sa livraison approuvée.',
    business_reading: 'Faible = livraison rapide. Élevé = friction, dépendance ou surcharge. Trop faible peut cacher de la dette ou de la superficialité.',
    limits: 'Ne distingue pas la complexité des tâches. À croiser avec VRR et ERR.',
    unit: 'heures',
    range: '0+',
    confidence_factors: ['Nombre de tâches sur la période (< 5 = confiance faible)', 'Présence de tâches outliers (très longues)', 'Régularité du marquage done'],
    cross_with: ['VRR', 'ERR', 'DSI'],
  },
  {
    code: 'VRR',
    name: 'Validation & Release Rate',
    category: 'operational',
    formula: '(Nombre de tâches approuvées au premier passage / Total des tâches soumises) × 100',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['task.status_slug', 'task_history (review → done sans retour)'],
    objective: 'Mesurer le pourcentage de livrables approuvés dès la première soumission.',
    business_reading: 'Élevé = stabilité et maîtrise. Faible = révisions fréquentes ou dette qualité.',
    limits: 'Peut être artificiellement élevé si les tâches sont sous-dimensionnées.',
    unit: '%',
    range: '0–100',
    confidence_factors: ['Volume de tâches soumises sur la période', 'Qualité du process de review'],
    cross_with: ['ADT', 'ERR'],
  },
  {
    code: 'ERR',
    name: 'Error Rate Ratio',
    category: 'operational',
    formula: '(Nombre d\'anomalies détectées après livraison / Total des livraisons) × 100',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['task.status_slug (re-opened)', 'task_history (done → doing ou blocked)'],
    objective: 'Mesurer les anomalies détectées après livraison.',
    business_reading: 'Faible = environnement stable. Élevé = dette technique ou validation insuffisante.',
    limits: 'Dépend de la qualité du processus de détection. Contexte legacy/ERP peut gonfler ce chiffre.',
    unit: '%',
    range: '0–100',
    confidence_factors: ['Processus de détection en place', 'Contexte legacy ou ERP', 'Volume de livraisons'],
    cross_with: ['VRR', 'ADT'],
  },
  {
    code: 'CRT',
    name: 'Client Response Time',
    category: 'lds',
    formula: 'Moyenne des délais entre soumission d\'une tâche en review et retour du client (validation ou commentaire).',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['task_history (moved to review)', 'task_comments.created_at (client)', 'task_history (moved from review)'],
    objective: 'Mesurer les délais de réponse client pour les validations et clarifications.',
    business_reading: 'Montre les dépendances externes et la fluidité de collaboration.',
    limits: 'Hors du contrôle direct de l\'équipe. À traiter comme signal externe, pas humain.',
    unit: 'heures',
    range: '0+',
    confidence_factors: ['Identification fiable du rôle client dans les commentaires', 'Volume de tâches avec interaction client'],
    cross_with: ['ADT', 'BOTTLENECK'],
  },
  {
    code: 'ADR',
    name: 'Active Documentation Ratio',
    category: 'lds',
    formula: '(Nombre de tâches avec commentaire documentaire / Total des tâches livrées) × 100',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['task_comments.content', 'task.status_slug (done)'],
    objective: 'Mesurer la production de documentation utile versus les livrables.',
    business_reading: 'Montre la maintenabilité, la transmission et la clarté du projet.',
    limits: 'La qualité de la documentation n\'est pas mesurée, seulement la présence.',
    unit: '%',
    range: '0–100',
    confidence_factors: ['Discipline de commentaire dans l\'équipe', 'Convention sur ce qui constitue un commentaire documentaire'],
    cross_with: ['PRR', 'SLI'],
  },
  {
    code: 'PRR',
    name: 'Proactive Recommendation Rate',
    category: 'lds',
    formula: '(Nombre de tâches marquées is_proactive / Total des tâches créées) × 100',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['tasks.is_proactive', 'tasks.created_at'],
    objective: 'Mesurer les initiatives proposées hors du scope initial.',
    business_reading: 'Montre l\'anticipation, l\'intelligence opérationnelle et la proactivité.',
    limits: 'Subjectif — dépend du marquage manuel is_proactive.',
    unit: '%',
    range: '0–100',
    confidence_factors: ['Régularité du marquage is_proactive par l\'équipe', 'Volume de tâches créées'],
    cross_with: ['ADR', 'SLI'],
  },
  {
    code: 'SLI',
    name: 'Self Learning Index',
    category: 'lds',
    formula: 'Score basé sur la régularité des livraisons, la diversité des types de tâches et la progression de la vitesse de complétion.',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['task_history', 'tasks.complexity', 'tasks.created_at', 'tasks.status_slug'],
    objective: 'Mesurer l\'apprentissage autonome utile supportant l\'exécution.',
    business_reading: 'Montre l\'adaptabilité, l\'autonomie et l\'accélération d\'apprentissage.',
    limits: 'Indicateur proximal — ne capture pas la qualité de l\'apprentissage.',
    unit: 'score 0–100',
    range: '0–100',
    confidence_factors: ['Durée d\'observation (minimum 2 sprints)', 'Diversité des tâches assignées'],
    cross_with: ['PRR', 'ADR', 'FOCUS'],
  },
  {
    code: 'FOCUS',
    name: 'Focus Score',
    category: 'focus',
    formula: 'Score composite basé sur : tâches simultanées, contexte-switches, tâches non terminées, réassignations fréquentes et blockers excessifs.',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['task_assignees', 'task_history', 'tasks.status_slug', 'tasks.column_id'],
    objective: 'Mesurer la capacité à avancer sans dispersion excessive.',
    business_reading: 'Score élevé = concentration et stabilité. Score faible = dispersion ou surcharge.',
    limits: 'Ne distingue pas la cause (choix personnel vs contrainte externe).',
    unit: 'score 0–100',
    range: '0–100',
    confidence_factors: ['Volume de tâches assignées simultanément', 'Période d\'observation (minimum 7 jours)'],
    cross_with: ['TEAM_PULSE', 'BLOCKED_TIME', 'SLI'],
  },
  {
    code: 'TEAM_PULSE',
    name: 'Team Pulse',
    category: 'emotional',
    formula: 'Score composite basé sur : charge de travail, blockers, retards, tâches en retard et files de review.',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['tasks.status_slug', 'tasks.due_date', 'task_assignees', 'task_history'],
    objective: 'Lire la santé émotionnelle et opérationnelle de l\'équipe.',
    business_reading: 'healthy = équilibré. overloaded = trop de tâches. unstable = rythme incohérent. critical = intervention immédiate.',
    limits: 'Indicateur de flux, pas d\'état émotionnel réel. À croiser avec les signaux comportementaux.',
    unit: 'état',
    range: 'healthy / overloaded / unstable / critical',
    confidence_factors: ['Taille de l\'équipe (< 2 personnes = moins fiable)', 'Régularité du suivi des statuts'],
    cross_with: ['FOCUS', 'BOTTLENECK', 'RISK_VELOCITY'],
  },
  {
    code: 'DEADLINE_SAFETY',
    name: 'Deadline Safety',
    category: 'emotional',
    formula: '(Nombre de tâches ouvertes avec due_date > maintenant / Total des tâches ouvertes avec due_date) × 100',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['tasks.due_date', 'tasks.status_slug'],
    objective: 'Mesurer la distance entre le rythme actuel et le risque de dépassement.',
    business_reading: 'Élevé = la majorité des tâches sont dans les délais. Faible = risque fort de dépassement.',
    limits: 'Ne prédit pas les retards — mesure l\'état actuel. Sans due_date sur les tâches, non calculable.',
    unit: '%',
    range: '0–100',
    confidence_factors: ['Pourcentage de tâches avec due_date renseignée', 'Qualité des estimations de deadline'],
    cross_with: ['RISK_VELOCITY', 'ADT', 'TEAM_PULSE'],
  },
  {
    code: 'BOTTLENECK',
    name: 'Bottleneck Score',
    category: 'emotional',
    formula: '(Nombre de tâches actives en review / Total des tâches actives) × 100',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['tasks.status_slug', 'tasks.column_id', 'board_columns.slug'],
    objective: 'Identifier les points bloquants et les dépendances critiques.',
    business_reading: 'Score faible = peu de bottlenecks. Score élevé = file de review saturée ou dépendance critique.',
    limits: 'Mesure uniquement la saturation review, pas les autres types de bottlenecks.',
    unit: '%',
    range: '0–100',
    confidence_factors: ['Utilisation cohérente des colonnes review', 'Volume de tâches actives'],
    cross_with: ['TEAM_PULSE', 'CRT', 'BLOCKED_TIME'],
  },
  {
    code: 'BLOCKED_TIME',
    name: 'Blocked Time Ratio',
    category: 'emotional',
    formula: '(Temps total en statut blocked / Temps total en cycle) × 100',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['task_history (blocked entries)', 'task_history.created_at', 'tasks.created_at'],
    objective: 'Mesurer le temps perdu en statut bloqué.',
    business_reading: 'Élevé = beaucoup de temps perdu en attente. Signal d\'un problème systémique ou de dépendances externes.',
    limits: 'Dépend de la bonne utilisation du statut blocked par l\'équipe.',
    unit: '%',
    range: '0–100',
    confidence_factors: ['Discipline d\'utilisation du statut blocked', 'Volume de tâches avec historique complet'],
    cross_with: ['BOTTLENECK', 'TEAM_PULSE', 'FOCUS'],
  },
  {
    code: 'RISK_VELOCITY',
    name: 'Risk Velocity',
    category: 'emotional',
    formula: 'Taux d\'augmentation des tâches en retard sur les 7 derniers jours vs les 7 jours précédents.',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['tasks.due_date', 'tasks.status_slug', 'tasks.updated_at'],
    objective: 'Mesurer la vitesse à laquelle le risque augmente.',
    business_reading: 'Positif élevé = le risque s\'accélère. Négatif = la situation s\'améliore. À surveiller avant qu\'il ne soit trop tard.',
    limits: 'Indicateur d\'alerte précoce — ne prédit pas la cause.',
    unit: 'ratio',
    range: 'sans limite, positif = dégradation',
    confidence_factors: ['Période d\'observation (minimum 14 jours)', 'Volume de tâches avec due_date'],
    cross_with: ['DEADLINE_SAFETY', 'TEAM_PULSE', 'DSI'],
  },
  {
    code: 'DSI',
    name: 'Delivery Stability Index',
    category: 'emotional',
    formula: '100 − (écart-type des cycle times / moyenne des cycle times × 100). Plafonné à 100.',
    formula_version: '1.0',
    valid_from: '2026-05-01',
    required_data: ['task_history (created → done)', 'tasks.created_at', 'tasks.status_slug'],
    objective: 'Lire la stabilité globale de la livraison.',
    business_reading: 'Proche de 100 = livraison très régulière. Proche de 0 = grande variabilité, instabilité.',
    limits: 'Sensible aux valeurs extrêmes (tâches très longues ou très courtes).',
    unit: 'score 0–100',
    range: '0–100',
    confidence_factors: ['Minimum 10 tâches terminées sur la période', 'Homogénéité des tâches (complexité similaire)'],
    cross_with: ['ADT', 'RISK_VELOCITY', 'TEAM_PULSE'],
  },
];

const glossaryMap = new Map(GLOSSARY.map(e => [e.code, e]));

export default new Elysia()

  // GET /kpi/glossary
  .get('/kpi/glossary', ({ query }) => {
    const { category } = query as { category?: string };

    const entries = category
      ? GLOSSARY.filter(e => e.category === category)
      : GLOSSARY;

    return {
      total: entries.length,
      glossary_version: '1.0',
      last_updated: '2026-05-01',
      note: 'Un KPI ne doit jamais être lu isolément. Sa valeur prend sens au travers de l\'évolution dans le temps, du contexte projet et du croisement avec d\'autres indicateurs.',
      categories: {
        operational: 'KPI de flux et de livraison bruts',
        lds: 'KPI du référentiel LDS — qualité, proactivité et apprentissage',
        focus: 'KPI de concentration et de dispersion individuelle',
        emotional: 'KPI de santé opérationnelle et de signaux faibles',
      },
      entries,
    };
  })

  // GET /kpi/glossary/:code
  .get(
    '/kpi/glossary/:code',
    ({ params, set }) => {
      const entry = glossaryMap.get(params.code.toUpperCase());
      if (!entry) {
        set.status = 404;
        return {
          message: `KPI code '${params.code}' not found in glossary.`,
          available_codes: GLOSSARY.map(e => e.code),
        };
      }
      return entry;
    },
    { params: t.Object({ code: t.String() }) },
  )

  // GET /kpi/glossary/:code/context
  // Retourne le lien entre la valeur calculée, le contexte attendu
  // et le niveau de confiance — M03 CDC exigence "lien valeur/contexte/confiance".
  .get(
    '/kpi/glossary/:code/context',
    ({ params, query, set }) => {
      const entry = glossaryMap.get(params.code.toUpperCase());
      if (!entry) {
        set.status = 404;
        return { message: `KPI code '${params.code}' not found.` };
      }

      const { value, sample_size } = query as { value?: string; sample_size?: string };
      const numValue = value !== undefined ? parseFloat(value) : undefined;
      const sampleSize = sample_size !== undefined ? parseInt(sample_size) : undefined;

      // Niveau de confiance basé sur la taille de l'échantillon
      let confidence: 'high' | 'medium' | 'low' | 'insufficient' = 'high';
      let confidence_note = 'Niveau de confiance élevé.';

      if (sampleSize !== undefined) {
        if (sampleSize < 3) {
          confidence = 'insufficient';
          confidence_note = 'Échantillon insuffisant (< 3). Ce KPI ne doit pas être interprété.';
        } else if (sampleSize < 10) {
          confidence = 'low';
          confidence_note = 'Faible échantillon (3–9). Interpréter avec prudence.';
        } else if (sampleSize < 30) {
          confidence = 'medium';
          confidence_note = 'Échantillon moyen (10–29). Tendance indicative.';
        } else {
          confidence = 'high';
          confidence_note = 'Échantillon solide (30+). Niveau de confiance élevé.';
        }
      }

      // Lecture contextuelle si une valeur est fournie
      let contextual_reading: string | null = null;
      if (numValue !== undefined && !isNaN(numValue)) {
        if (entry.range === '0–100') {
          if (numValue >= 80) contextual_reading = 'Valeur élevée — situation favorable selon ce KPI.';
          else if (numValue >= 50) contextual_reading = 'Valeur moyenne — à surveiller et à croiser avec d\'autres KPI.';
          else contextual_reading = 'Valeur faible — signal d\'attention. Ne pas conclure sans contexte.';
        } else if (entry.range === '0+') {
          contextual_reading = `Valeur de ${numValue} ${entry.unit}. Comparer avec la moyenne historique de l'équipe pour évaluer si c'est acceptable.`;
        } else {
          contextual_reading = `Valeur : ${numValue} ${entry.unit}. Consulter la lecture métier pour l'interprétation.`;
        }
      }

      return {
        code: entry.code,
        name: entry.name,
        formula_version: entry.formula_version,
        valid_from: entry.valid_from,
        formula: entry.formula,
        required_data: entry.required_data,
        confidence_factors: entry.confidence_factors,
        ...(sampleSize !== undefined ? {
          confidence,
          confidence_note,
          sample_size: sampleSize,
        } : {}),
        ...(contextual_reading ? {
          provided_value: numValue,
          contextual_reading,
          business_reading: entry.business_reading,
        } : {}),
        cross_with: entry.cross_with,
        limits: entry.limits,
        non_punitive_reminder: 'Ce KPI ne doit jamais être utilisé seul pour évaluer une personne. Il révèle des dynamiques, pas des performances individuelles.',
      };
    },
    {
      params: t.Object({ code: t.String() }),
    },
  );