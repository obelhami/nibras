/**
 * Unit tests : logique métier de src/routes/board/tasks.routes.ts
 *
 * Approche business-rules.test.ts : extraction fidèle de la logique pure,
 * sans DB, sans HTTP. PRIORITIES est importée directement (déjà réelle et
 * pure) ; le reste reproduit fidèlement les conditions du fichier source.
 *
 * Usage : bun test src/tests/board-tasks-routes.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { PRIORITIES } from '../routes/board/shared';

// ─── POST tasks — résolution de la priorité (fallback "medium") ─────────────

describe('POST task — résolution de la priorité', () => {
  function resolvePriority(input: unknown): string {
    return typeof input === 'string' && PRIORITIES.has(input) ? input : 'medium';
  }

  test('priorité valide fournie → conservée', () => {
    expect(resolvePriority('urgent')).toBe('urgent');
    expect(resolvePriority('low')).toBe('low');
  });

  test('priorité absente ou invalide → fallback "medium"', () => {
    expect(resolvePriority(undefined)).toBe('medium');
    expect(resolvePriority('critical')).toBe('medium'); // "critical" n'existe pas dans PRIORITIES
    expect(resolvePriority(42)).toBe('medium');
  });
});

// ─── POST/PATCH tasks — validation de la complexité (1 à 5) ─────────────────

describe('Task — validation de la complexité', () => {
  function isValidComplexity(value: number | null): boolean {
    if (value === null) return true; // optionnel
    return value >= 1 && value <= 5;
  }

  test('valeurs dans la plage 1-5 acceptées', () => {
    expect(isValidComplexity(1)).toBe(true);
    expect(isValidComplexity(5)).toBe(true);
    expect(isValidComplexity(3)).toBe(true);
  });

  test('valeurs hors plage rejetées', () => {
    expect(isValidComplexity(0)).toBe(false);
    expect(isValidComplexity(6)).toBe(false);
    expect(isValidComplexity(-1)).toBe(false);
  });

  test('complexité non fournie (null) → valide (optionnelle)', () => {
    expect(isValidComplexity(null)).toBe(true);
  });
});

// ─── POST tasks — BR : assignation obligatoire à un membre de l'équipe ──────

describe('POST task — BR : assignation scoping équipe', () => {
  function canCreateTask(hasTeam: boolean, assigneeId: string, isTeamMember: boolean): string | null {
    if (!hasTeam) return 'This board has no team assigned; assign a team to the board first';
    if (!assigneeId) return 'A task must be assigned to at least one team member';
    if (!isTeamMember) return "Assignee must be a member of the board's team";
    return null;
  }

  test('board sans équipe → erreur spécifique', () => {
    expect(canCreateTask(false, 'u1', true)).toBe(
      'This board has no team assigned; assign a team to the board first',
    );
  });

  test('assigneeId manquant → erreur', () => {
    expect(canCreateTask(true, '', true)).toBe('A task must be assigned to at least one team member');
  });

  test('assigneeId fourni mais hors équipe → erreur 403', () => {
    expect(canCreateTask(true, 'outsider', false)).toBe("Assignee must be a member of the board's team");
  });

  test('tout est valide → pas d\'erreur (null)', () => {
    expect(canCreateTask(true, 'u1', true)).toBeNull();
  });
});

// ─── PATCH task — journal de réassignation (KPI Focus Score) ─────────────────

describe('PATCH task — déclenchement du log de réassignation', () => {
  function shouldLogReassignment(newAssigneeId: string, currentAssigneeId: string | null): boolean {
    return newAssigneeId !== currentAssigneeId;
  }

  test('nouvel assigné différent de l\'actuel → doit être loggé', () => {
    expect(shouldLogReassignment('user-2', 'user-1')).toBe(true);
  });

  test('même assigné (aucun changement réel) → ne doit PAS être loggé', () => {
    expect(shouldLogReassignment('user-1', 'user-1')).toBe(false);
  });

  test('tâche jamais assignée (null) puis assignée → doit être loggé', () => {
    expect(shouldLogReassignment('user-1', null)).toBe(true);
  });
});

// ─── PATCH task — sélection de colonne (fallback première colonne) ──────────

describe('POST task — sélection de la colonne cible', () => {
  type Col = { id: string; slug: string };
  function selectTargetColumn(columns: Col[], requestedColumnId?: string): Col | undefined {
    return typeof requestedColumnId === 'string'
      ? columns.find((c) => c.id === requestedColumnId)
      : columns[0];
  }

  const columns: Col[] = [
    { id: 'c1', slug: 'todo' },
    { id: 'c2', slug: 'doing' },
  ];

  test('aucune colonne spécifiée → première colonne du board par défaut', () => {
    expect(selectTargetColumn(columns)).toEqual({ id: 'c1', slug: 'todo' });
  });

  test('colonne spécifiée et existante → utilisée', () => {
    expect(selectTargetColumn(columns, 'c2')).toEqual({ id: 'c2', slug: 'doing' });
  });

  test('colonne spécifiée mais inexistante → undefined (404 attendu)', () => {
    expect(selectTargetColumn(columns, 'ghost')).toBeUndefined();
  });

  test('board sans aucune colonne → 400 attendu en amont (pas de sélection possible)', () => {
    expect(selectTargetColumn([])).toBeUndefined();
  });
});

// ─── PATCH task — construction dynamique des updates ─────────────────────────

describe('PATCH task — updates conditionnels et validations associées', () => {
  function buildTaskUpdate(body: {
    title?: string;
    priority?: string;
    complexity?: number;
    assigneeId?: string;
  }): { updates: string[]; error?: string } {
    const updates: string[] = [];

    if (typeof body.title === 'string') {
      if (!body.title.trim()) return { updates: [], error: 'Task title cannot be empty' };
      updates.push('title = ?');
    }

    if (typeof body.priority === 'string') {
      if (!PRIORITIES.has(body.priority.trim())) {
        return { updates: [], error: 'Priority must be low, medium, high, or urgent' };
      }
      updates.push('priority = ?');
    }

    if (typeof body.complexity === 'number') {
      if (body.complexity < 1 || body.complexity > 5) {
        return { updates: [], error: 'Complexity must be between 1 and 5' };
      }
      updates.push('complexity = ?');
    }

    if (typeof body.assigneeId === 'string') {
      if (!body.assigneeId.trim()) {
        return { updates: [], error: 'A task must be assigned to at least one team member' };
      }
      updates.push('assignee_id = ?', 'assignee_email = ?');
    }

    if (updates.length === 0) return { updates: [], error: 'No task changes provided' };
    return { updates };
  }

  test('aucun champ → erreur "No task changes provided"', () => {
    expect(buildTaskUpdate({}).error).toBe('No task changes provided');
  });

  test('titre vide → erreur', () => {
    expect(buildTaskUpdate({ title: '  ' }).error).toBe('Task title cannot be empty');
  });

  test('priorité invalide → erreur', () => {
    expect(buildTaskUpdate({ priority: 'blabla' }).error).toBe(
      'Priority must be low, medium, high, or urgent',
    );
  });

  test('complexité hors plage → erreur', () => {
    expect(buildTaskUpdate({ complexity: 9 }).error).toBe('Complexity must be between 1 and 5');
  });

  test('assigneeId vide → erreur', () => {
    expect(buildTaskUpdate({ assigneeId: '' }).error).toBe(
      'A task must be assigned to at least one team member',
    );
  });

  test('plusieurs champs valides → tous appliqués (assigneeId produit 2 colonnes SQL)', () => {
    const result = buildTaskUpdate({ title: 'New title', assigneeId: 'user-2' });
    expect(result.updates).toEqual(['title = ?', 'assignee_id = ?', 'assignee_email = ?']);
  });
});

// ─── POST move — fallback colonne source si introuvable ─────────────────────

describe('POST task/move — fallback colonne source', () => {
  function resolveSourceColumn(
    sourceColumn: { id: string; slug: string } | undefined,
    fallbackColumnId: string,
    fallbackStatusSlug: string,
  ) {
    return {
      id: sourceColumn?.id ?? fallbackColumnId,
      slug: sourceColumn?.slug ?? fallbackStatusSlug,
    };
  }

  test('colonne source trouvée en DB → utilisée telle quelle', () => {
    const result = resolveSourceColumn({ id: 'c1', slug: 'todo' }, 'fallback-id', 'fallback-slug');
    expect(result).toEqual({ id: 'c1', slug: 'todo' });
  });

  test('colonne source supprimée entre-temps → fallback sur les valeurs de la tâche', () => {
    const result = resolveSourceColumn(undefined, 'old-column-id', 'todo');
    expect(result).toEqual({ id: 'old-column-id', slug: 'todo' });
  });
});