// Same-origin API proxy: forwards /api/* and /health to the Workers API
// so the SPA keeps working with relative paths + host-only cookies.
const API_ORIGIN = 'https://lms-headless-api.twillioalternative.workers.dev';

interface PagesContext {
  request: Request;
  next: () => Promise<Response>;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const incoming = new URL(context.request.url);
  const isApi = incoming.pathname === '/health' || incoming.pathname.startsWith('/api/');
  if (!isApi) return context.next();

  const target = new URL(incoming.pathname, API_ORIGIN);
  target.search = incoming.search;
  const headers = new Headers(context.request.headers);
  headers.set('host', new URL(API_ORIGIN).host);
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', 'https');

  const method = context.request.method.toUpperCase();
  return fetch(
    new Request(target.toString(), {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : context.request.body,
      redirect: 'manual',
      duplex: 'half',
    } as RequestInit)
  );
}
