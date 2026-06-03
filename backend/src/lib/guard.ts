import { db } from '../../db';
import { verifyAuthToken } from './jwt';
import { hasPermission, type Action } from './permissions';

interface AuthenticatedUser {
  id: number;
  username: string;
  email: string;
  role: string;
}

export async function requirePermission(
  authorizationHeader: string | undefined,
  action: Action,
  set: { status: number },
): Promise<AuthenticatedUser | null> {
  const payload = verifyAuthToken(authorizationHeader);
  if (!payload) {
    set.status = 401;
    return null;
  }

  const result = await db.execute({
    sql: 'SELECT id, username, email, role FROM users WHERE email = ?',
    args: [payload.email],
  });

  const user = result.rows[0] as {
    id: number;
    username: string;
    email: string;
    role: string | null;
  } | undefined;

  if (!user || !user.role) {
    set.status = 403;
    return null;
  }

  if (!hasPermission(user.role, action)) {
    set.status = 403;
    return null;
  }

  return user as AuthenticatedUser;
}
