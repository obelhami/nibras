export type Role = 'developer' | 'manager' | 'admin'

export type Action =
  | 'create_project'
  | 'create_task'
  | 'view_team_kpis'
  | 'manage_users'

export interface Permissions {
  create_project: boolean
  create_task: boolean
  view_team_kpis: boolean
  manage_users: boolean
}

const permissionMap: Record<Role, Permissions> = {
  developer: {
    create_project: false,
    create_task: true,
    view_team_kpis: false,
    manage_users: false,
  },
  manager: {
    create_project: true,
    create_task: true,
    view_team_kpis: true,
    manage_users: false,
  },
  admin: {
    create_project: true,
    create_task: true,
    view_team_kpis: true,
    manage_users: true,
  },
}

export function getPermissions(role: string | null | undefined): Permissions {
  if (!role) {
    return { create_project: false, create_task: false, view_team_kpis: false, manage_users: false }
  }
  return permissionMap[role as Role] ?? { create_project: false, create_task: false, view_team_kpis: false, manage_users: false }
}

export function hasPermission(role: string | null | undefined, action: Action): boolean {
  return getPermissions(role)[action]
}
