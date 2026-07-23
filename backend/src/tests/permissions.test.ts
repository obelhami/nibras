/**
 * Unit tests : Permission Engine (src/lib/permissions.ts)
 *
 * Import direct des vraies fonctions — logique pure basée sur des Set,
 * aucune DB, aucun HTTP.
 * Usage : bun test src/tests/permissions.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { hasPermission, getPermissions, type Action } from '../lib/permissions';

const ALL_ACTIONS: Action[] = [
  'create_project',
  'create_board',
  'create_task',
  'view_project',
  'view_team_kpis',
  'manage_users',
];

// ─── Developer ─────────────────────────────────────────────────────────────────

describe('hasPermission — role Developer', () => {
  test('peut créer une tâche', () => {
    expect(hasPermission('developer', 'create_task')).toBe(true);
  });

  test('ne peut PAS créer de projet', () => {
    expect(hasPermission('developer', 'create_project')).toBe(false);
  });

  test('ne peut PAS créer de board', () => {
    expect(hasPermission('developer', 'create_board')).toBe(false);
  });

  test('ne peut PAS voir les KPIs d\'équipe', () => {
    expect(hasPermission('developer', 'view_team_kpis')).toBe(false);
  });

  test('ne peut PAS gérer les utilisateurs', () => {
    expect(hasPermission('developer', 'manage_users')).toBe(false);
  });
});

// ─── Manager ────────────────────────────────────────────────────────────────────

describe('hasPermission — role Manager', () => {
  test('peut créer projet, board et tâche', () => {
    expect(hasPermission('manager', 'create_project')).toBe(true);
    expect(hasPermission('manager', 'create_board')).toBe(true);
    expect(hasPermission('manager', 'create_task')).toBe(true);
  });

  test('peut voir les KPIs d\'équipe (dans son scope)', () => {
    expect(hasPermission('manager', 'view_team_kpis')).toBe(true);
  });

  test('ne peut PAS gérer les utilisateurs (réservé à Admin)', () => {
    expect(hasPermission('manager', 'manage_users')).toBe(false);
  });
});

// ─── Admin ──────────────────────────────────────────────────────────────────────

describe('hasPermission — role Admin', () => {
  test('a accès à TOUTES les actions', () => {
    for (const action of ALL_ACTIONS) {
      expect(hasPermission('admin', action)).toBe(true);
    }
  });
});

// ─── Cas limites / rôles invalides ────────────────────────────────────────────

describe('hasPermission — rôles invalides ou absents', () => {
  test('role null → toujours refusé', () => {
    expect(hasPermission(null, 'create_task')).toBe(false);
  });

  test('role undefined → toujours refusé', () => {
    expect(hasPermission(undefined, 'create_task')).toBe(false);
  });

  test('role inconnu (typo, injection) → toujours refusé, jamais d\'exception', () => {
    expect(hasPermission('superadmin', 'create_task')).toBe(false);
    expect(hasPermission('ADMIN', 'create_task')).toBe(false); // sensible à la casse
    expect(hasPermission('', 'create_task')).toBe(false);
  });
});

// ─── getPermissions — vue agrégée (utilisée par le frontend) ─────────────────

describe('getPermissions — objet complet de permissions par rôle', () => {
  test('developer → seul create_task est true', () => {
    const perms = getPermissions('developer');
    expect(perms).toEqual({
        create_project: false,
        create_board: false,
        create_task: true,
        assign_task: false,
        move_task: true,
        view_project: false,
        view_team_kpis: false,
        view_behavioral_signals: true,
        manage_users: false,
        manage_kpi_rules: false,
        configure_integrations: true,
        validate_ai_actions: true,
      });
  });

  test('manager → tout sauf manage_users', () => {
    const perms = getPermissions('manager');
    expect(perms.manage_users).toBe(false);
    expect(perms.create_project).toBe(true);
    expect(perms.create_board).toBe(true);
    expect(perms.create_task).toBe(true);
    expect(perms.view_project).toBe(true);
    expect(perms.view_team_kpis).toBe(true);
  });

  test('admin → tout est true', () => {
    const perms = getPermissions('admin');
    expect(Object.values(perms).every(Boolean)).toBe(true);
  });

  test('rôle invalide → objet complet avec tout à false (jamais undefined)', () => {
    const perms = getPermissions('ghost');
    expect(Object.values(perms).every((v) => v === false)).toBe(true);
    expect(Object.keys(perms)).toHaveLength(12);
  });
});