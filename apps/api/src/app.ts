import { Hono } from 'hono';
import auth from './routes/auth.js';
import users from './routes/users.js';
import orgs from './routes/orgs.js';
import courses from './routes/courses.js';
import assess from './routes/assessment.js';
import ops from './routes/ops.js';
import platform from './routes/platform.js';
import authoring from './routes/authoring.js';
import banks from './routes/banks.js';
import cohorts from './routes/cohorts.js';
import live from './routes/live.js';
import commerce from './routes/commerce.js';
import scorm from './routes/scorm.js';
import growth from './routes/growth.js';
import xapi from './routes/xapi.js';
import { authOptional, language, rateLimit, requestId } from './middleware/common.js';
import { cors } from './middleware/cors.js';
import { idempotency } from './middleware/idempotency.js';
import { maintenance } from './middleware/maintenance.js';
import { securityHeaders } from './middleware/headers.js';
import type { AppEnv, AppVars } from './types.js';
import type { D1Like } from './db.js';
import { openApiDocument } from './openapi.js';

export function createApp(env: AppEnv, db: D1Like) {
  const app = new Hono<{ Variables: AppVars }>();

  app.use('*', requestId());
  app.use('*', language());
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('env', env);
    await next();
  });
  app.use('*', cors());
  app.use('*', securityHeaders());
  app.use('/api/*', rateLimit());
  app.use('/api/*', authOptional());
  // Stricter bucket for credential-abuse targets (brute force, enumeration).
  app.use('/api/v1/auth/login', rateLimit({ prefix: 'auth' }));
  app.use('/api/v1/auth/register', rateLimit({ prefix: 'auth' }));
  app.use('/api/v1/auth/refresh', rateLimit({ prefix: 'auth' }));
  app.use('/api/*', maintenance());
  app.use('/api/*', idempotency());

  app.get('/health', (c) =>
    c.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } })
  );
  app.get('/api/v1/openapi.json', (c) => c.json(openApiDocument()));
  app.get('/api/v1/docs', (c) =>
    c.html(
      `<!doctype html><html><head><meta charset="utf-8"><title>LMS API Docs</title><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;line-height:1.6}</style></head><body><h1>LMS Headless API v1</h1><p>OpenAPI JSON: <a href="/api/v1/openapi.json">/api/v1/openapi.json</a></p><p>Auth: Bearer access token from <code>POST /api/v1/auth/login</code>. Base path: <code>/api/v1</code>.</p><ul><li>auth: register/login/refresh/logout/me/password</li><li>users, organizations, academic years/terms/classes/subjects</li><li>courses, sections, lessons, enrollments, progress</li><li>quizzes, questions, attempts, assignments, submissions, grades</li><li>attendance, certificates (+public verify), announcements, notifications, discussions, reports, uploads</li></ul></body></html>`
    )
  );

  app.route('/api/v1/auth', auth);
  app.route('/api/v1/users', users);
  app.route('/api/v1/organizations', orgs);
  // Static-first routers before param-heavy ones: Hono matches in
  // registration order, so /courses/export must precede /courses/:id.
  app.route('/api/v1', authoring);
  app.route('/api/v1', courses);
  app.route('/api/v1', assess);
  app.route('/api/v1', banks);
  app.route('/api/v1', cohorts);
  app.route('/api/v1', live);
  app.route('/api/v1', commerce);
  app.route('/api/v1', scorm);
  app.route('/api/v1', growth);
  app.route('/api/v1', xapi);
  app.route('/', ops);
  app.route('/', platform);

  app.notFound((c) =>
    c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404)
  );
  app.onError((err, c) => {
    const requestId = c.get('requestId') as string | undefined;
    // Never leak stack traces; log server-side only.
    console.error(`[${requestId ?? '-'}]`, err instanceof Error ? err.message : err);
    return c.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          ...(requestId ? { requestId } : {}),
        },
      },
      500
    );
  });

  return app;
}
