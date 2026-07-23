export type Role = 'developer' | 'manager' | 'admin';

/**
 * Actions map 1:1 to the "Feature / right" rows of the CDC's access-rights
 * table (Requirements Specification V1.1, §9). Some rights are scoped
 * ("own tasks only", "aggregated and contextualized", "limited") rather than
 * strictly boolean — those nuances are enforced at the route level (task
 * ownership checks, team-scope checks) on top of this coarse-grained
 * permission flag. See callers of hasPermission() for the scoped checks.
 */
export type Action =
  | 'create_project'
  | 'create_board'
  | 'create_task'
  | 'assign_task'
  | 'move_task'
  | 'view_project'
  | 'view_team_kpis'
  | 'view_behavioral_signals'
  | 'manage_users'
  | 'manage_kpi_rules'
  | 'configure_integrations'
  | 'validate_ai_actions';

const permissions: Record<Role, Set<Action>> = {
  developer: new Set([
    'create_task',
    // "move_task": own tasks only — enforced via ownership check, not here.
    'move_task',
    // "view_behavioral_signals": own explanatory signals only — scope
    // enforced at the route level (see routes/behavior.ts).
    'view_behavioral_signals',
    // "configure_integrations": Limited in the CDC (e.g. own personal
    // connections) — full scoping left to the integrations module.
    'configure_integrations',
    // "validate_ai_actions": on own tasks only — scope enforced once the
    // AI module exists.
    'validate_ai_actions',
  ]),
  manager: new Set([
    'create_project',
    'create_board',
    'create_task',
    'assign_task',
    'move_task',
    'view_project',
    'view_team_kpis',
    // "view_behavioral_signals": aggregated and contextualized, within scope.
    'view_behavioral_signals',
    // "manage_kpi_rules": Limited in the CDC — full editing reserved to admin,
    // enforced at the route level once KPI-rule management exists.
    'manage_kpi_rules',
    'configure_integrations',
    'validate_ai_actions',
  ]),
  admin: new Set([
    'create_project',
    'create_board',
    'create_task',
    'assign_task',
    'move_task',
    'view_project',
    'view_team_kpis',
    'view_behavioral_signals',
    'manage_users',
    'manage_kpi_rules',
    'configure_integrations',
    'validate_ai_actions',
  ]),
};

export function hasPermission(role: string | null | undefined, action: Action): boolean {
  if (!role) return false;
  const allowed = permissions[role as Role];
  if (!allowed) return false;
  return allowed.has(action);
}

export function getPermissions(role: string | null | undefined): Record<Action, boolean> {
  return {
    create_project: hasPermission(role, 'create_project'),
    create_board: hasPermission(role, 'create_board'),
    create_task: hasPermission(role, 'create_task'),
    assign_task: hasPermission(role, 'assign_task'),
    move_task: hasPermission(role, 'move_task'),
    view_project: hasPermission(role, 'view_project'),
    view_team_kpis: hasPermission(role, 'view_team_kpis'),
    view_behavioral_signals: hasPermission(role, 'view_behavioral_signals'),
    manage_users: hasPermission(role, 'manage_users'),
    manage_kpi_rules: hasPermission(role, 'manage_kpi_rules'),
    configure_integrations: hasPermission(role, 'configure_integrations'),
    validate_ai_actions: hasPermission(role, 'validate_ai_actions'),
  };
}
