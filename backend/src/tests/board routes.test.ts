/**
 * Unit tests : logique métier de src/routes/board/boards.routes.ts
 *
 * Approche business-rules.test.ts : extraction fidèle de la logique pure,
 * sans DB, sans HTTP.
 *
 * Usage : bun test src/tests/board-routes.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { slugifyColumnName, normalizeText, VISIBILITIES, DEFAULT_COLUMNS } from '../routes/board/shared';

// ─── POST /boards — visibilité ────────────────────────────────────────────────

describe('POST /boards — validation de la visibilité', () => {
  test('valeurs autorisées : private, team, public', () => {
    expect(VISIBILITIES.has('private')).toBe(true);
    expect(VISIBILITIES.has('team')).toBe(true);
    expect(VISIBILITIES.has('public')).toBe(true);
  });

  test('valeur non reconnue → rejetée', () => {
    expect(VISIBILITIES.has('secret')).toBe(false);
  });

  test('visibilité absente → défaut "private"', () => {
    const resolved = normalizeText(undefined) || 'private';
    expect(resolved).toBe('private');
  });
});

// ─── POST /boards — BR : un board doit appartenir à une équipe ───────────────

describe('POST /boards — BR : team_id obligatoire', () => {
  function isTeamRequired(teamId: string): boolean {
    return normalizeText(teamId).length > 0;
  }
  test('teamId vide → refusé (400)', () => {
    expect(isTeamRequired('')).toBe(false);
    expect(isTeamRequired('   ')).toBe(false);
  });
  test('teamId fourni → accepté', () => {
    expect(isTeamRequired('team-42')).toBe(true);
  });
});

// ─── POST /boards — seul le manager de l'équipe (ou admin) peut créer/lier ──

describe('POST/PATCH /boards — autorisation de rattachement à une équipe', () => {
  function canAttachTeam(teamManagerId: string, userId: string, userRole: string): boolean {
    return teamManagerId === userId || userRole === 'admin';
  }

  test('le manager propriétaire de l\'équipe peut rattacher son board', () => {
    expect(canAttachTeam('mgr-1', 'mgr-1', 'manager')).toBe(true);
  });

  test('un admin peut toujours rattacher n\'importe quelle équipe', () => {
    expect(canAttachTeam('mgr-1', 'admin-9', 'admin')).toBe(true);
  });

  test('un manager D\'UNE AUTRE équipe ne peut pas rattacher', () => {
    expect(canAttachTeam('mgr-1', 'mgr-2', 'manager')).toBe(false);
  });

  test('un developer ne peut jamais rattacher une équipe', () => {
    expect(canAttachTeam('mgr-1', 'dev-3', 'developer')).toBe(false);
  });
});

// ─── POST /boards — normalisation + déduplication des colonnes fournies ─────

describe('POST /boards — colonnes personnalisées (dédoublonnage par slug)', () => {
  function normalizeRequestedColumns(rawColumns: unknown[]): Array<{ name: string; slug: string }> {
    const normalized: Array<{ name: string; slug: string }> = [];
    const seenSlugs = new Set<string>();

    for (const raw of rawColumns) {
      const name = normalizeText(raw);
      if (!name) continue;
      const slug = slugifyColumnName(name);
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      normalized.push({ name, slug });
    }

    if (normalized.length === 0) {
      return DEFAULT_COLUMNS.map((name) => ({ name, slug: slugifyColumnName(name) }));
    }
    return normalized;
  }

  test('aucune colonne fournie ou toutes invalides → fallback DEFAULT_COLUMNS', () => {
    expect(normalizeRequestedColumns([])).toEqual(
      DEFAULT_COLUMNS.map((name) => ({ name, slug: slugifyColumnName(name) })),
    );
    expect(normalizeRequestedColumns(['', '   ', 42 as any])).toEqual(
      DEFAULT_COLUMNS.map((name) => ({ name, slug: slugifyColumnName(name) })),
    );
  });

  test('colonnes personnalisées valides → conservées telles quelles', () => {
    const result = normalizeRequestedColumns(['Backlog', 'In Progress', 'Shipped']);
    expect(result).toEqual([
      { name: 'Backlog', slug: 'backlog' },
      { name: 'In Progress', slug: 'in-progress' },
      { name: 'Shipped', slug: 'shipped' },
    ]);
  });

  test('deux noms différents produisant le même slug → le second est ignoré (pas de doublon DB)', () => {
    const result = normalizeRequestedColumns(['Review', 'review!!!']); // même slug "review"
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Review');
  });
});

// ─── PATCH /boards/:id — construction dynamique des updates ─────────────────

describe('PATCH /boards/:id — updates conditionnels', () => {
  function buildBoardUpdate(body: { title?: string; visibility?: string; teamId?: string }): {
    updates: string[];
    error?: string;
  } {
    const updates: string[] = [];

    if (typeof body.title === 'string') {
      const title = body.title.trim();
      if (!title) return { updates: [], error: 'Board title cannot be empty' };
      updates.push('title = ?');
    }

    if (typeof body.visibility === 'string') {
      if (!VISIBILITIES.has(body.visibility.trim())) {
        return { updates: [], error: 'Visibility must be private, team, or public' };
      }
      updates.push('visibility = ?');
    }

    if (typeof body.teamId === 'string') {
      if (!body.teamId.trim()) return { updates: [], error: 'A board must be assigned to a team' };
      updates.push('team_id = ?');
    }

    if (updates.length === 0) return { updates: [], error: 'No board changes provided' };
    return { updates };
  }

  test('aucun champ → erreur "No board changes provided"', () => {
    expect(buildBoardUpdate({}).error).toBe('No board changes provided');
  });

  test('titre vide → erreur', () => {
    expect(buildBoardUpdate({ title: '   ' }).error).toBe('Board title cannot be empty');
  });

  test('BR : impossible de retirer l\'équipe d\'un board (teamId vide)', () => {
    expect(buildBoardUpdate({ teamId: '' }).error).toBe('A board must be assigned to a team');
  });

  test('visibilité invalide → erreur', () => {
    expect(buildBoardUpdate({ visibility: 'hidden' }).error).toBe(
      'Visibility must be private, team, or public',
    );
  });

  test('plusieurs champs valides en même temps → tous appliqués', () => {
    const result = buildBoardUpdate({ title: 'New title', visibility: 'public' });
    expect(result.updates).toEqual(['title = ?', 'visibility = ?']);
  });
});

// ─── GET /boards/:id/members — cas sans équipe ───────────────────────────────

describe('GET /boards/:id/members — board sans équipe', () => {
  function resolveMembersQuery(teamId: string | null): 'empty' | 'query' {
    return teamId ? 'query' : 'empty';
  }
  test('board sans team_id → retourne une liste vide sans interroger la DB', () => {
    expect(resolveMembersQuery(null)).toBe('empty');
  });
  test('board avec team_id → interroge les membres', () => {
    expect(resolveMembersQuery('team-1')).toBe('query');
  });
});

// ─── GET /boards (liste) — BR-07 + cohérence admin ───────────────────────────
// Reproduit fidèlement la clause WHERE de la requête SQL (owner OR public OR
// team_members.user_id IS NOT NULL OR teams.manager_id = ? OR role = 'admin').

describe('GET /boards (liste) — un board apparaît dans la liste si...', () => {
  function isBoardInList(input: {
    isOwner: boolean;
    isPublic: boolean;
    isTeamMember: boolean;
    isManagerOfTeam: boolean;
    isAdmin: boolean;
  }): boolean {
    return (
      input.isOwner ||
      input.isPublic ||
      input.isTeamMember ||
      input.isManagerOfTeam ||
      input.isAdmin
    );
  }

  test('propriétaire du board → visible', () => {
    expect(
      isBoardInList({ isOwner: true, isPublic: false, isTeamMember: false, isManagerOfTeam: false, isAdmin: false }),
    ).toBe(true);
  });

  test('board public → visible pour tout le monde', () => {
    expect(
      isBoardInList({ isOwner: false, isPublic: true, isTeamMember: false, isManagerOfTeam: false, isAdmin: false }),
    ).toBe(true);
  });

  test('membre de l\'équipe du board → visible', () => {
    expect(
      isBoardInList({ isOwner: false, isPublic: false, isTeamMember: true, isManagerOfTeam: false, isAdmin: false }),
    ).toBe(true);
  });

  test('BR-07 : manager qui DIRIGE l\'équipe du board (sans en être membre) → visible', () => {
    // C'est précisément le gap corrigé : avant, un manager ne voyait dans la
    // liste que les boards où il était `team_member`, jamais ceux qu'il
    // dirige sans en être membre lui-même.
    expect(
      isBoardInList({ isOwner: false, isPublic: false, isTeamMember: false, isManagerOfTeam: true, isAdmin: false }),
    ).toBe(true);
  });

  test('admin → voit TOUS les boards, même hors de son périmètre', () => {
    // Autre gap corrigé : avant, un admin ne voyait que ses boards
    // possédés/publics/dont il était team_member, comme un utilisateur normal.
    expect(
      isBoardInList({ isOwner: false, isPublic: false, isTeamMember: false, isManagerOfTeam: false, isAdmin: true }),
    ).toBe(true);
  });

  test('aucune des conditions → board absent de la liste', () => {
    expect(
      isBoardInList({ isOwner: false, isPublic: false, isTeamMember: false, isManagerOfTeam: false, isAdmin: false }),
    ).toBe(false);
  });
});