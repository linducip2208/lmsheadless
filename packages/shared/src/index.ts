export function ok<T>(data: T, meta?: Record<string, unknown>) {
  return { success: true as const, data, ...(meta ? { meta } : {}) };
}

export function fail(code: string, message: string, details?: unknown, requestId?: string) {
  return {
    success: false as const,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };
}

export function paginate<T>(items: T[], total: number, page: number, perPage: number) {
  return {
    items,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export function getPagination(url: URL): {
  page: number;
  perPage: number;
  q: string;
  sort: string;
  order: 'asc' | 'desc';
} {
  const page = Math.min(1000, Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1));
  const perPage = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get('per_page') ?? '20') || 20)
  );
  const q = (url.searchParams.get('q') ?? '').slice(0, 200);
  const sort =
    (url.searchParams.get('sort') ?? 'created_at').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40) ||
    'created_at';
  const order = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  return { page, perPage, q, sort, order };
}

const ALLOWED_SORTS = new Set([
  'created_at',
  'updated_at',
  'name',
  'title',
  'email',
  'score',
  'grade',
  'date',
  'id',
]);

export function safeSort(col: string): string {
  return ALLOWED_SORTS.has(col) ? col : 'created_at';
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
