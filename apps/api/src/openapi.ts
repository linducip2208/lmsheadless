// Minimal OpenAPI 3.1 document describing the v1 surface.
export function openApiDocument() {
  const paths: Record<string, unknown> = {};
  const def = (summary: string, tags: string[], auth = true, body = false) => ({
    summary,
    tags,
    ...(auth ? { security: [{ bearerAuth: [] }] } : {}),
    ...(body ? { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } : {}),
    responses: {
      '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
      '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      '401': { description: 'Unauthorized' },
      '403': { description: 'Forbidden / tenant denied' },
    },
  });
  const routes: [string, string, string, string[]][] = [
    ['/auth/register', 'post', 'Register', ['auth']],
    ['/auth/login', 'post', 'Login', ['auth']],
    ['/auth/refresh', 'post', 'Refresh session', ['auth']],
    ['/auth/logout', 'post', 'Logout', ['auth']],
    ['/auth/me', 'get', 'Current user', ['auth']],
    ['/users', 'get', 'List users', ['users']],
    ['/users', 'post', 'Create user', ['users']],
    ['/organizations', 'get', 'List organizations', ['organizations']],
    ['/organizations', 'post', 'Create organization', ['organizations']],
    ['/courses', 'get', 'List courses', ['courses']],
    ['/courses', 'post', 'Create course', ['courses']],
    ['/enrollments', 'post', 'Enroll in course', ['courses']],
    ['/quizzes', 'post', 'Create quiz', ['assessment']],
    ['/assignments', 'post', 'Create assignment', ['assessment']],
    ['/grades', 'post', 'Record grade', ['assessment']],
    ['/attendance/sessions', 'post', 'Create attendance session', ['attendance']],
    ['/certificates/verify/{number}', 'get', 'Verify certificate (public)', ['certificates']],
    ['/announcements', 'get', 'List announcements', ['social']],
    ['/discussions', 'get', 'List threads', ['social']],
    ['/reports/organization-summary', 'get', 'Organization summary', ['reports']],
    ['/uploads', 'post', 'Upload file', ['storage']],
  ];
  for (const [p, method, summary, tags] of routes) {
    const isPublic = p.includes('verify') || p === '/auth/register' || p === '/auth/login' || p === '/auth/refresh';
    paths[`/api/v1${p}`] = { [method]: def(summary, tags, !isPublic, method === 'post') };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'LMS Headless API', version: '1.0.0', description: 'Headless LMS REST API (Hono + D1). Base path /api/v1.' },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Success: { type: 'object', properties: { success: { type: 'boolean' }, data: {}, meta: { type: 'object' } }, required: ['success', 'data'] },
        Error: { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } }, required: ['success', 'error'] },
      },
    },
    paths,
  };
}
