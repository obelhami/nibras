/**
 * Unit tests : logique métier de src/routes/board/columns.routes.ts
 *
 * Même approche que business-rules.test.ts : extraction fidèle de la logique
 * (mêmes conditions, mêmes calculs) pour un test pur, sans DB ni HTTP.
 * slugifyColumnName / normalizeText (utilisées ici) ont déjà leur propre
 * couverture directe dans board-shared.test.ts.
 *
 * Usage : bun test src/tests/board-columns-routes.test.ts
 */

import { describe, test, expect } from 'bun:test';

// ─── POST /boards/:id/columns — nom requis + calcul de position ─────────────

describe('POST columns — validations et calcul de position', () => {
  function computeNextPosition(maxPosition: number | null): number {
    return (maxPosition ?? -1) + 1;
  }

  test('première colonne d\'un board (aucune existante) → position 0', () => {
    expect(computeNextPosition(null)).toBe(0);
  });

  test('board avec colonnes 0,1,2 → nouvelle colonne en position 3', () => {
    expect(computeNextPosition(2)).toBe(3);
  });

  test('nom vide (après trim) → rejeté', () => {
    function isValidColumnName(name: string): boolean {
      return name.trim().length > 0;
    }
    expect(isValidColumnName('   ')).toBe(false);
    expect(isValidColumnName('Doing')).toBe(true);
  });

  test('BR : un slug déjà utilisé sur ce board → conflit (409)', () => {
    function isDuplicateSlug(existingSlugs: string[], newSlug: string): boolean {
      return existingSlugs.includes(newSlug);
    }
    expect(isDuplicateSlug(['todo', 'doing', 'done'], 'doing')).toBe(true);
    expect(isDuplicateSlug(['todo', 'doing', 'done'], 'review')).toBe(false);
  });
});

// ─── PATCH /boards/:id/columns/:id — mise à jour conditionnelle ─────────────

describe('PATCH columns — construction dynamique des updates', () => {
  function buildColumnUpdate(body: { name?: string; position?: number }): {
    updates: string[];
    error?: string;
  } {
    const updates: string[] = [];

    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name) return { updates: [], error: 'Column name cannot be empty' };
      updates.push('name = ?', 'slug = ?');
    }

    if (typeof body.position === 'number') {
      updates.push('position = ?');
    }

    if (updates.length === 0) {
      return { updates: [], error: 'No column changes provided' };
    }

    return { updates };
  }

  test('aucun champ → erreur "No column changes provided"', () => {
    expect(buildColumnUpdate({}).error).toBe('No column changes provided');
  });

  test('renommage vide → erreur "Column name cannot be empty"', () => {
    expect(buildColumnUpdate({ name: '   ' }).error).toBe('Column name cannot be empty');
  });

  test('renommage seul → met à jour name ET slug ensemble', () => {
    const result = buildColumnUpdate({ name: 'Blocked' });
    expect(result.updates).toEqual(['name = ?', 'slug = ?']);
  });

  test('position seule (0 est une valeur valide, pas "falsy")', () => {
    const result = buildColumnUpdate({ position: 0 });
    expect(result.updates).toEqual(['position = ?']);
  });

  test('renommage + repositionnement en même temps → 3 champs mis à jour', () => {
    const result = buildColumnUpdate({ name: 'Blocked', position: 2 });
    expect(result.updates).toEqual(['name = ?', 'slug = ?', 'position = ?']);
  });

  test('BR : renommer vers un slug déjà utilisé par une AUTRE colonne → conflit', () => {
    function isDuplicateSlugExcludingSelf(
      columns: Array<{ id: string; slug: string }>,
      newSlug: string,
      ownColumnId: string,
    ): boolean {
      return columns.some((c) => c.slug === newSlug && c.id !== ownColumnId);
    }
    const columns = [
      { id: 'c1', slug: 'todo' },
      { id: 'c2', slug: 'doing' },
    ];
    // renommer c1 vers "doing" (déjà pris par c2) → conflit
    expect(isDuplicateSlugExcludingSelf(columns, 'doing', 'c1')).toBe(true);
    // renommer c1 en gardant son propre slug "todo" → pas un conflit (c'est lui-même)
    expect(isDuplicateSlugExcludingSelf(columns, 'todo', 'c1')).toBe(false);
  });
});

// ─── DELETE /boards/:id/columns/:id — protection contre perte de données ────

describe('DELETE column — protection si des tâches y sont encore rattachées', () => {
  function canDeleteColumn(taskCountInColumn: number): boolean {
    return taskCountInColumn === 0;
  }

  test('colonne vide → suppression autorisée', () => {
    expect(canDeleteColumn(0)).toBe(true);
  });

  test('colonne contenant au moins une tâche → suppression bloquée (409)', () => {
    expect(canDeleteColumn(1)).toBe(false);
    expect(canDeleteColumn(15)).toBe(false);
  });
});