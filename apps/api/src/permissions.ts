// Granular permission catalog. Roles map to permission sets; checks run
// server-side via organization membership. The catalog is seeded into
// permissions/role_permissions so it is inspectable at runtime.

export const PERMISSIONS: { key: string; description: string }[] = [
  { key: 'users.view', description: 'View users in organization' },
  { key: 'users.create', description: 'Create users' },
  { key: 'users.update', description: 'Update users' },
  { key: 'users.delete', description: 'Delete users' },
  { key: 'roles.manage', description: 'Assign roles and manage permissions' },
  { key: 'courses.view', description: 'View courses' },
  { key: 'courses.create', description: 'Create courses' },
  { key: 'courses.update', description: 'Update courses' },
  { key: 'courses.delete', description: 'Delete courses' },
  { key: 'courses.publish', description: 'Publish/archive courses' },
  { key: 'lessons.view', description: 'View lessons' },
  { key: 'lessons.create', description: 'Create lessons' },
  { key: 'lessons.update', description: 'Update lessons' },
  { key: 'lessons.delete', description: 'Delete lessons' },
  { key: 'quiz.create', description: 'Create quizzes and questions' },
  { key: 'quiz.update', description: 'Update quizzes and questions' },
  { key: 'quiz.publish', description: 'Publish quizzes' },
  { key: 'quiz.grade', description: 'Grade quiz attempts' },
  { key: 'assignment.create', description: 'Create assignments' },
  { key: 'assignment.grade', description: 'Grade submissions' },
  { key: 'attendance.manage', description: 'Record attendance' },
  { key: 'grades.manage', description: 'Record and manage grades' },
  { key: 'certificates.issue', description: 'Issue certificates' },
  { key: 'announcements.manage', description: 'Publish announcements' },
  { key: 'discussions.moderate', description: 'Moderate discussions' },
  { key: 'reports.view', description: 'View reports' },
  { key: 'files.manage', description: 'Manage organization files' },
  { key: 'settings.manage', description: 'Manage organization settings and branding' },
  { key: 'audit.view', description: 'View audit logs' },
];

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: PERMISSIONS.map((p) => p.key),
  organization_admin: PERMISSIONS.map((p) => p.key),
  teacher: [
    'users.view',
    'courses.view',
    'courses.create',
    'courses.update',
    'courses.publish',
    'lessons.view',
    'lessons.create',
    'lessons.update',
    'lessons.delete',
    'quiz.create',
    'quiz.update',
    'quiz.publish',
    'quiz.grade',
    'assignment.create',
    'assignment.grade',
    'attendance.manage',
    'grades.manage',
    'certificates.issue',
    'announcements.manage',
    'discussions.moderate',
    'reports.view',
    'files.manage',
  ],
  staff: [
    'users.view',
    'courses.view',
    'lessons.view',
    'attendance.manage',
    'announcements.manage',
    'reports.view',
  ],
  student: ['courses.view', 'lessons.view'],
  parent: ['courses.view', 'lessons.view', 'reports.view'],
};

export function roleHasPermission(role: string, permission: string): boolean {
  if (role === 'super_admin') return true;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
