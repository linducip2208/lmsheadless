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
    ['/auth/login', 'post', 'Login (supports ?cookie=1 for httpOnly refresh)', ['auth']],
    ['/auth/refresh', 'post', 'Refresh session (body token or httpOnly cookie)', ['auth']],
    ['/auth/logout', 'post', 'Logout', ['auth']],
    ['/auth/me', 'get', 'Current user', ['auth']],
    ['/auth/sessions', 'get', 'List active sessions', ['auth']],
    ['/auth/password/change', 'post', 'Change password', ['auth']],
    ['/users', 'get', 'List users', ['users']],
    ['/users', 'post', 'Create user', ['users']],
    ['/users/me/permissions', 'get', 'My permissions for an organization', ['users']],
    ['/organizations', 'get', 'List organizations', ['organizations']],
    ['/organizations', 'post', 'Create organization', ['organizations']],
    ['/organizations/{id}/branding', 'get', 'Public branding subset (white-label)', ['organizations']],
    ['/permissions', 'get', 'Permission catalog', ['rbac']],
    ['/roles', 'get', 'Roles with permissions', ['rbac']],
    ['/courses', 'get', 'List courses', ['courses']],
    ['/courses', 'post', 'Create course', ['courses']],
    ['/courses/{id}/sections', 'get', 'List sections', ['courses']],
    ['/courses/sections/{sectionId}/lessons', 'get', 'List lessons', ['courses']],
    ['/enrollments', 'post', 'Enroll in course', ['courses']],
    ['/quizzes', 'post', 'Create quiz', ['assessment']],
    ['/quizzes', 'get', 'List quizzes for a course', ['assessment']],
    ['/quizzes/{id}/questions', 'get', 'List questions (correctness hidden for students)', ['assessment']],
    ['/quiz-attempts/{attemptId}/submit', 'post', 'Submit answers (idempotent)', ['assessment']],
    ['/quiz-attempts/{attemptId}/grade', 'post', 'Manual grading', ['assessment']],
    ['/assignments', 'post', 'Create assignment', ['assessment']],
    ['/assignments/{id}/submissions', 'post', 'Submit assignment (idempotent)', ['assessment']],
    ['/grades', 'post', 'Record grade', ['assessment']],
    ['/attendance/sessions', 'post', 'Create attendance session', ['attendance']],
    ['/attendance/records', 'post', 'Record attendance', ['attendance']],
    ['/certificates/verify/{number}', 'get', 'Verify certificate (public)', ['certificates']],
    ['/certificates/issue', 'post', 'Issue certificate', ['certificates']],
    ['/announcements', 'get', 'List announcements', ['social']],
    ['/discussions', 'get', 'List threads', ['social']],
    ['/files', 'get', 'List files', ['storage']],
    ['/uploads', 'post', 'Upload file', ['storage']],
    ['/search', 'get', 'Org-scoped search', ['search']],
    ['/reports/organization-summary', 'get', 'Organization summary', ['reports']],
    ['/reports/completion', 'get', 'Completion per course', ['reports']],
    ['/reports/quiz-performance', 'get', 'Quiz performance', ['reports']],
    ['/reports/attendance', 'get', 'Attendance summary', ['reports']],
    ['/reports/student-progress', 'get', 'Student progress detail', ['reports']],
    ['/notifications', 'get', 'My notifications', ['notifications']],
    ['/push/subscriptions', 'post', 'Register push subscription (needs VAPID keys)', ['notifications']],
    ['/settings', 'get', 'Global settings (super_admin)', ['settings']],
    ['/setup', 'post', 'First-run setup (locked afterwards)', ['settings']],
    ['/audit-logs', 'get', 'Audit logs', ['settings']],
  ];
  for (const [p, method, summary, tags] of routes) {
    const isPublic =
      p.includes('verify') ||
      p.includes('branding') ||
      ['/auth/register', '/auth/login', '/auth/refresh', '/setup'].some((pub) => p === pub || p.startsWith(`${pub}/`));
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
