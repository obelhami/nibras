// Format d'erreur standard, utilisé par toutes les routes Projects API
// (CRUD, Validate, Filter, Pagination, Manager/admin control)

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

interface FailOptions {
  status: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function fail(set: { status?: number | string }, opts: FailOptions) {
  set.status = opts.status;
  return {
    message: opts.message,
    code: opts.code,
    ...(opts.details ? { details: opts.details } : {}),
  };
}

export const unauthorized = (set: { status?: number | string }, message = 'Unauthorized') =>
  fail(set, { status: 401, code: 'UNAUTHORIZED', message });

// Manager/admin control - respecte le 401/403 déjà fixé par requirePermission
export const permissionDenied = (set: { status?: number | string }) => {
  if (set.status === 403) {
    return fail(set, { status: 403, code: 'FORBIDDEN', message: 'You do not have permission to perform this action' });
  }
  return fail(set, { status: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' });
};

// Manager/admin control
export const forbidden = (set: { status?: number | string }, message = 'Forbidden') =>
  fail(set, { status: 403, code: 'FORBIDDEN', message });

export const notFound = (set: { status?: number | string }, message = 'Not found') =>
  fail(set, { status: 404, code: 'NOT_FOUND', message });

// Validate name/status/dates
export const validationError = (
  set: { status?: number | string },
  message: string,
  details?: Record<string, unknown>,
) => fail(set, { status: 400, code: 'VALIDATION_ERROR', message, details });

export const conflict = (set: { status?: number | string }, message: string) =>
  fail(set, { status: 409, code: 'CONFLICT', message });

export const internalError = (set: { status?: number | string }, message = 'Internal server error') =>
  fail(set, { status: 500, code: 'INTERNAL_ERROR', message });