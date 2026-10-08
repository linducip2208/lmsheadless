import { z } from 'zod';

export const email = z.string().email().max(255);
export const password = z.string().min(8).max(128);
export const uuid = z.string().uuid().or(z.string().min(1).max(64));
export const roleEnum = z.enum(['super_admin', 'organization_admin', 'teacher', 'student', 'parent', 'staff']);
export const localeEnum = z.enum(['en', 'id']);
export const courseStatus = z.enum(['draft', 'published', 'archived']);
export const questionType = z.enum(['multiple_choice', 'true_false', 'short_answer']);
export const attendanceStatus = z.enum(['present', 'absent', 'late', 'excused']);

export const registerSchema = z.object({
  email,
  password,
  name: z.string().min(1).max(120),
  organization_id: z.string().min(1).max(64).optional(),
  locale: localeEnum.optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(10).max(1024),
});

export const organizationSchema = z.object({
  name: z.string().min(2).max(150),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  description: z.string().max(2000).optional(),
  settings: z.record(z.unknown()).optional(),
});

export const userCreateSchema = z.object({
  email,
  password,
  name: z.string().min(1).max(120),
  role: roleEnum,
  organization_id: z.string().min(1).max(64).optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'pending_verification']).optional(),
  locale: localeEnum.optional(),
  timezone: z.string().max(64).optional(),
});

export const courseSchema = z.object({
  organization_id: z.string().min(1).max(64),
  category_id: z.string().min(1).max(64).optional().nullable(),
  code: z.string().min(1).max(40),
  title: z.string().min(2).max(200),
  description: z.string().max(10000).optional(),
  status: courseStatus.optional(),
  thumbnail_url: z.string().max(1000).optional(),
  price: z.number().min(0).max(100000000).optional(),
  slug: z.string().min(2).max(120).regex(/^[a-z0-9-]+$/).optional(),
  visibility: z.enum(['private', 'public', 'unlisted']).optional(),
  start_at: z.string().max(64).optional(),
  end_at: z.string().max(64).optional(),
  enrollment_mode: z.enum(['open', 'approval', 'closed']).optional(),
});

export const sectionSchema = z.object({
  course_id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  position: z.number().int().min(0).max(10000).optional(),
});

export const lessonSchema = z.object({
  section_id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  content_type: z.enum(['text', 'video', 'document', 'image', 'external', 'quiz_ref']),
  body: z.string().max(50000).optional(),
  video_url: z.string().max(2000).optional(),
  resource_url: z.string().max(2000).optional(),
  position: z.number().int().min(0).max(10000).optional(),
  duration_minutes: z.number().int().min(0).max(100000).optional(),
  is_free_preview: z.boolean().optional(),
  status: z.enum(['draft', 'published']).optional(),
});

export const quizSchema = z.object({
  course_id: z.string().min(1).max(64),
  lesson_id: z.string().min(1).max(64).optional().nullable(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  passing_score: z.number().min(0).max(100),
  max_attempts: z.number().int().min(1).max(100).optional(),
  time_limit_minutes: z.number().int().min(0).max(10080).optional(),
  shuffle_questions: z.boolean().optional(),
});

export const questionSchema = z.object({
  quiz_id: z.string().min(1).max(64),
  type: questionType,
  prompt: z.string().min(1).max(5000),
  points: z.number().min(0).max(1000),
  position: z.number().int().min(0).max(10000).optional(),
  options: z
    .array(z.object({ label: z.string().min(1).max(1000), is_correct: z.boolean() }))
    .max(20)
    .optional(),
  correct_answer: z.string().max(5000).optional(),
});

export const assignmentSchema = z.object({
  course_id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
  due_at: z.string().max(64).optional(),
  max_score: z.number().min(0).max(10000),
  allow_resubmit: z.boolean().optional(),
  allowed_types: z.string().max(500).optional(),
  max_size_bytes: z.number().int().min(1024).max(262144000).optional(),
});

export const submissionGradeSchema = z.object({
  score: z.number().min(0).max(10000),
  feedback: z.string().max(10000).optional(),
});

export const gradeSchema = z.object({
  student_id: z.string().min(1).max(64),
  course_id: z.string().min(1).max(64),
  category: z.string().min(1).max(100).optional(),
  score: z.number().min(0).max(10000),
  max_score: z.number().min(0).max(10000).optional(),
  feedback: z.string().max(10000).optional(),
});

export const attendanceRecordSchema = z.object({
  session_id: z.string().min(1).max(64),
  records: z
    .array(z.object({ student_id: z.string().min(1).max(64), status: attendanceStatus, note: z.string().max(500).optional() }))
    .min(1)
    .max(500),
});

export const enrollmentSchema = z.object({
  course_id: z.string().min(1).max(64),
  student_id: z.string().min(1).max(64).optional(),
  status: z.enum(['active', 'completed', 'dropped', 'suspended']).optional(),
});

export const announcementSchema = z.object({
  organization_id: z.string().min(1).max(64),
  course_id: z.string().min(1).max(64).optional().nullable(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
});

export const threadSchema = z.object({
  course_id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
});

export const replySchema = z.object({
  body: z.string().min(1).max(10000),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
});
