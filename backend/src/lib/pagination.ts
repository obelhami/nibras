// Project list pagination

export interface PaginationQuery {
    page?: string;
    limit?: string;
  }
  
  export interface PaginationResult {
    page: number;
    limit: number;
    offset: number;
  }
  
  // Project list pagination - lit ?page= et ?limit=
  export function parsePagination(
    query: PaginationQuery,
    opts?: { defaultLimit?: number; maxLimit?: number },
  ): PaginationResult {
    const defaultLimit = opts?.defaultLimit ?? 20;
    const maxLimit = opts?.maxLimit ?? 100;
  
    let page = Number.parseInt(query.page ?? '1', 10);
    let limit = Number.parseInt(query.limit ?? String(defaultLimit), 10);
  
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
    if (limit > maxLimit) limit = maxLimit;
  
    return { page, limit, offset: (page - 1) * limit };
  }
  
  // Project list pagination - métadonnées renvoyées au frontend
  export function buildPaginationMeta(page: number, limit: number, total: number) {
    return {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }