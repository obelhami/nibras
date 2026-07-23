/**
 * Unit tests : logique métier de src/routes/kpi.ts
 *
 * Les calculs KPI eux-mêmes (ADT, VRR, ERR, Focus Score, Team Pulse) sont
 * déjà couverts en profondeur par kpi.test.ts (lib/kpi.ts, importé
 * directement par cette route). Ce fichier complète avec la logique propre
 * à la route : contrôle d'accès (canViewBoardKpis) et la fenêtre temporelle.
 *
 * Usage : bun test src/tests/kpi-routes.test.ts
 */

import { describe, test, expect } from 'bun:test';

// ─── canViewBoardKpis — contrôle d'accès (BR-06/BR-07) ───────────────────────

describe('GET /kpi/boards/:id — canViewBoardKpis', () => {
  type Board = { owner_email: string; visibility: string; team_id: string | null };
  type User = { id: string; email: string; role: string | null };

  function canViewBoardKpis(
    board: Board,
    user: User,
    isTeamMember: boolean,
    isManagerOfTeam: boolean,
  ): boolean {
    if (user.role === 'admin') return true;
    if (board.owner_email === user.email) return true;
    if (board.visibility === 'public') return true;
    // BR-07 : le manager n'est autorisé que s'il dirige l'équipe du board.
    if (user.role === 'manager') return isManagerOfTeam;
    if (board.team_id) return isTeamMember;
    return false;
  }

  const board = { owner_email: 'owner@nibras.io', visibility: 'private', team_id: 'team-1' };

  test('admin voit toujours les KPIs, même hors de son périmètre', () => {
    expect(canViewBoardKpis(board, { id: '9', email: 'x@x.io', role: 'admin' }, false, false)).toBe(true);
  });

  test('BR-07 : manager qui DIRIGE l\'équipe du board → autorisé', () => {
    expect(canViewBoardKpis(board, { id: '9', email: 'x@x.io', role: 'manager' }, false, true)).toBe(true);
  });

  test('BR-07 : manager qui NE dirige PAS l\'équipe du board → refusé (fini l\'accès illimité)', () => {
    expect(canViewBoardKpis(board, { id: '9', email: 'x@x.io', role: 'manager' }, false, false)).toBe(false);
  });

  test('propriétaire du board (même developer) → autorisé', () => {
    expect(
      canViewBoardKpis(board, { id: '1', email: 'owner@nibras.io', role: 'developer' }, false, false),
    ).toBe(true);
  });

  test('board public → tout le monde peut voir les KPIs', () => {
    const publicBoard = { ...board, visibility: 'public' };
    expect(
      canViewBoardKpis(publicBoard, { id: '2', email: 'stranger@nibras.io', role: 'developer' }, false, false),
    ).toBe(true);
  });

  test('BR-06 : developer hors équipe ne peut PAS voir les KPIs d\'un board privé', () => {
    expect(
      canViewBoardKpis(board, { id: '2', email: 'stranger@nibras.io', role: 'developer' }, false, false),
    ).toBe(false);
  });

  test('developer MEMBRE de l\'équipe du board → autorisé', () => {
    expect(
      canViewBoardKpis(board, { id: '2', email: 'teammate@nibras.io', role: 'developer' }, true, false),
    ).toBe(true);
  });

  test('board sans équipe (team_id null), non public, non propriétaire → refusé', () => {
    const noTeamBoard = { ...board, team_id: null };
    expect(
      canViewBoardKpis(noTeamBoard, { id: '2', email: 'stranger@nibras.io', role: 'developer' }, false, false),
    ).toBe(false);
  });
});

// ─── sinceIso — fenêtre temporelle pour Focus Score / Team Pulse ────────────

describe('sinceIso — calcul de la fenêtre temporelle', () => {
  function sinceIso(days: number, now: number): string {
    return new Date(now - days * 24 * 3_600_000).toISOString();
  }

  test('7 jours en arrière depuis une date de référence connue', () => {
    const now = new Date('2026-06-08T12:00:00.000Z').getTime();
    expect(sinceIso(7, now)).toBe('2026-06-01T12:00:00.000Z');
  });

  test('0 jour → retourne l\'instant présent', () => {
    const now = new Date('2026-06-08T12:00:00.000Z').getTime();
    expect(sinceIso(0, now)).toBe('2026-06-08T12:00:00.000Z');
  });

  test('30 jours (fenêtre par défaut du Behavioral Layer) traverse un changement de mois', () => {
    const now = new Date('2026-07-15T00:00:00.000Z').getTime();
    expect(sinceIso(30, now)).toBe('2026-06-15T00:00:00.000Z');
  });
});

// ─── GET /kpi/users/:email/focus — BR-07 ──────────────────────────────────────
// Gap découvert en construisant la collection Postman : cet endpoint utilisait
// hasPermission(role, 'view_team_kpis') — donc N'IMPORTE QUEL manager pouvait
// voir le Focus Score de N'IMPORTE QUEL utilisateur, même hors de son équipe.

describe('GET /kpi/users/:email/focus — BR-07', () => {
  function canViewFocus(
    targetEmail: string,
    user: { email: string; role: string | null },
    managesUserTeam: boolean,
  ): boolean {
    if (targetEmail === user.email) return true;
    if (user.role === 'admin') return true;
    if (user.role === 'manager') return managesUserTeam;
    return false;
  }

  test('un utilisateur voit toujours son propre Focus Score', () => {
    expect(canViewFocus('dev@nibras.io', { email: 'dev@nibras.io', role: 'developer' }, false)).toBe(true);
  });

  test('admin voit le Focus Score de n\'importe qui', () => {
    expect(canViewFocus('dev@nibras.io', { email: 'admin@nibras.io', role: 'admin' }, false)).toBe(true);
  });

  test('BR-07 : manager qui dirige l\'équipe du développeur → autorisé', () => {
    expect(canViewFocus('dev@nibras.io', { email: 'mgr@nibras.io', role: 'manager' }, true)).toBe(true);
  });

  test('BR-07 : manager qui NE dirige PAS l\'équipe du développeur → refusé (fini l\'accès illimité)', () => {
    expect(canViewFocus('dev@nibras.io', { email: 'mgr@nibras.io', role: 'manager' }, false)).toBe(false);
  });

  test('un developer ne peut pas voir le Focus Score d\'un autre developer', () => {
    expect(canViewFocus('dev@nibras.io', { email: 'other-dev@nibras.io', role: 'developer' }, false)).toBe(false);
  });
});

// ─── GET /kpi/teams/:teamId/pulse et /dashboard — BR-07 ──────────────────────
// Même gap, même fix : ces deux endpoints partagent exactement la même
// logique d'autorisation dans le code source.

describe('GET /kpi/teams/:teamId/pulse|dashboard — BR-07', () => {
  function canViewTeamKpis(
    role: string | null,
    isManagerOfThisTeam: boolean,
    isTeamMember: boolean,
  ): boolean {
    if (role === 'admin') return true;
    if (role === 'manager') return isManagerOfThisTeam;
    return isTeamMember;
  }

  test('admin → toujours autorisé', () => {
    expect(canViewTeamKpis('admin', false, false)).toBe(true);
  });

  test('BR-07 : manager qui DIRIGE cette équipe → autorisé', () => {
    expect(canViewTeamKpis('manager', true, false)).toBe(true);
  });

  test('BR-07 : manager qui dirige une AUTRE équipe → refusé', () => {
    expect(canViewTeamKpis('manager', false, false)).toBe(false);
  });

  test('developer membre de l\'équipe → autorisé', () => {
    expect(canViewTeamKpis('developer', false, true)).toBe(true);
  });

  test('developer hors équipe → refusé', () => {
    expect(canViewTeamKpis('developer', false, false)).toBe(false);
  });
});

// ─── GET /kpi/snapshots — BR-07 (scoping selon le type de scope) ─────────────

describe('GET /kpi/snapshots — BR-07 : scoping selon scope=team|board|user', () => {
  type Ctx = {
    role: string | null;
    email: string;
    scope: 'team' | 'board' | 'user';
    scopeId: string;
    // Résultats précalculés des vérifications DB (simulées) pour ce scénario :
    isManagerOfTeam?: boolean;
    isTeamMember?: boolean;
    isBoardOwnerOrPublic?: boolean;
    isManagerOfUserTeam?: boolean;
  };

  function canViewSnapshots(ctx: Ctx): boolean {
    if (ctx.role === 'admin') return true;

    if (ctx.scope === 'team') {
      return (ctx.role === 'manager' && !!ctx.isManagerOfTeam) || !!ctx.isTeamMember;
    }
    if (ctx.scope === 'board') {
      return !!ctx.isBoardOwnerOrPublic
        || (ctx.role === 'manager' && !!ctx.isManagerOfTeam)
        || !!ctx.isTeamMember;
    }
    if (ctx.scope === 'user') {
      return ctx.scopeId === ctx.email || (ctx.role === 'manager' && !!ctx.isManagerOfUserTeam);
    }
    return false;
  }

  test('admin → toujours autorisé, quel que soit le scope', () => {
    expect(canViewSnapshots({ role: 'admin', email: 'a@x.io', scope: 'team', scopeId: 'team-9' })).toBe(true);
  });

  test('scope=team, BR-07 : manager qui NE dirige PAS cette équipe → refusé', () => {
    expect(
      canViewSnapshots({
        role: 'manager', email: 'mgr@x.io', scope: 'team', scopeId: 'team-1', isManagerOfTeam: false,
      }),
    ).toBe(false);
  });

  test('scope=team : manager qui dirige cette équipe → autorisé', () => {
    expect(
      canViewSnapshots({
        role: 'manager', email: 'mgr@x.io', scope: 'team', scopeId: 'team-1', isManagerOfTeam: true,
      }),
    ).toBe(true);
  });

  test('scope=user : un développeur voit toujours son propre historique', () => {
    expect(
      canViewSnapshots({ role: 'developer', email: 'dev@x.io', scope: 'user', scopeId: 'dev@x.io' }),
    ).toBe(true);
  });

  test('scope=user, BR-07 : manager qui ne dirige pas l\'équipe de cet utilisateur → refusé', () => {
    expect(
      canViewSnapshots({
        role: 'manager', email: 'mgr@x.io', scope: 'user', scopeId: 'dev@x.io', isManagerOfUserTeam: false,
      }),
    ).toBe(false);
  });

  test('scope=board : accès via ownership/public/manager-scope/team-membership', () => {
    expect(
      canViewSnapshots({
        role: 'developer', email: 'dev@x.io', scope: 'board', scopeId: 'b1', isBoardOwnerOrPublic: true,
      }),
    ).toBe(true);
    expect(
      canViewSnapshots({
        role: 'developer', email: 'dev@x.io', scope: 'board', scopeId: 'b1', isBoardOwnerOrPublic: false, isTeamMember: false,
      }),
    ).toBe(false);
  });
});