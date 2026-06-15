export type Role = 'developer' | 'manager' | 'admin';

export type Action =
  | 'create_project'
  | 'create_board'
  | 'create_task'
  | 'view_project'
  | 'view_team_kpis'
  | 'manage_users';

const permissions: Record<Role, Set<Action>> = {
  developer: new Set([
    'create_task',
  ]),
  manager: new Set([
    'create_project',
    'create_board',
    'create_task',
    'view_project',
    'view_team_kpis',
  ]),
  admin: new Set([
    'create_project',
    'create_board',
    'create_task',
    'view_project',
    'view_team_kpis',
    'manage_users',
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
    view_project: hasPermission(role, 'view_project'),
    view_team_kpis: hasPermission(role, 'view_team_kpis'),
    manage_users: hasPermission(role, 'manage_users'),
  };
}
