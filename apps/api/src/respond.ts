import type { Context } from 'hono';

export function ok<T>(c: Context, data: T, meta?: Record<string, unknown>, status = 200) {
  return c.json({ success: true, data, ...(meta ? { meta } : {}) }, status as 200);
}

export function created<T>(c: Context, data: T, meta?: Record<string, unknown>) {
  return ok(c, data, meta, 201);
}

export function fail(c: Context, status: number, code: string, message: string, details?: unknown) {
  const requestId = c.get('requestId') as string | undefined;
  return c.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    },
    status as 400
  );
}

export function paginationMeta(total: number, page: number, perPage: number) {
  return { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}
