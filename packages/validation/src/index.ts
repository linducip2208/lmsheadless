import { z } from 'zod';

export const email = z.string().email().max(255);
export const password = z.string().min(8).max(128);
export const uuid = z.string().uuid().or(z.string().min(1).max(64));
export const roleEnum = z.enum([
  'super_admin',
  'organization_admin',
  'teacher',
  'student',
  'parent',
  'staff',
]);
export const localeEnum = z.enum(['en', 'id']);
export const courseStatus = z.enum(['draft', 'published', 'archived']);
export const questionType = z.enum([
  'multiple_choice',
  'single_choice',
  'true_false',
  'short_answer',
  'essay',
  'matching',
  'ordering',
]);
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
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
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
  price_minor: z.number().int().min(0).max(10000000000).optional(),
  slug: z
    .string()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  visibility: z.enum(['private', 'public', 'unlisted']).optional(),
  start_at: z.string().max(64).optional(),
  end_at: z.string().max(64).optional(),
  enrollment_mode: z.enum(['open', 'approval', 'closed']).optional(),
  is_compliance: z.boolean().optional(),
});

export const sectionSchema = z.object({
  course_id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  position: z.number().int().min(0).max(10000).optional(),
});

// Stored URLs are rendered into href/src attributes: only http(s) schemes
// are accepted (blocks javascript:/data: payloads at the trust boundary).
export const httpUrl = z
  .string()
  .max(2000)
  .refine((u) => u === '' || /^https?:\/\/\S+$/i.test(u), {
    message: 'URL must start with http(s)://',
  });

export const lessonSchema = z.object({
  section_id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  content_type: z.enum(['text', 'video', 'document', 'image', 'external', 'quiz_ref']),
  body: z.string().max(50000).optional(),
  video_url: httpUrl.optional(),
  resource_url: httpUrl.optional(),
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
  answer_release: z.enum(['after_submit', 'never']).optional(),
  negative_marking: z.boolean().optional(),
  cooldown_minutes: z.number().int().min(0).max(10080).optional(),
});

export const questionSchema = z.object({
  quiz_id: z.string().min(1).max(64),
  type: questionType,
  prompt: z.string().min(1).max(5000),
  points: z.number().min(0).max(1000),
  position: z.number().int().min(0).max(10000).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  explanation: z.string().max(5000).optional(),
  negative_points: z.number().min(0).max(1000).optional(),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(1000),
        match_value: z.string().max(1000).optional(),
        is_correct: z.boolean(),
      })
    )
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
  allow_late: z.boolean().optional(),
  late_penalty_percent: z.number().min(0).max(100).optional(),
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
    .array(
      z.object({
        student_id: z.string().min(1).max(64),
        status: attendanceStatus,
        note: z.string().max(500).optional(),
      })
    )
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

export const tagSchema = z.object({
  organization_id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
});

export const prerequisiteSchema = z.object({
  requires_course_id: z.string().min(1).max(64),
});

export const dripSchema = z.object({
  lesson_id: z.string().min(1).max(64),
  days_after_enrollment: z.number().int().min(0).max(3650).optional().nullable(),
  unlock_at: z.string().max(64).optional().nullable(),
});

export const bankSchema = z.object({
  organization_id: z.string().min(1).max(64),
  course_id: z.string().min(1).max(64).optional().nullable(),
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
});

export const bankQuestionSchema = z.object({
  type: z.enum([
    'multiple_choice',
    'single_choice',
    'true_false',
    'short_answer',
    'essay',
    'matching',
    'ordering',
  ]),
  prompt: z.string().min(1).max(5000),
  points: z.number().min(0).max(1000),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  category: z.string().max(100).optional(),
  tags: z.string().max(500).optional(),
  explanation: z.string().max(5000).optional(),
  correct_answer: z.string().max(5000).optional(),
  negative_points: z.number().min(0).max(1000).optional(),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(1000),
        match_value: z.string().max(1000).optional(),
        is_correct: z.boolean(),
      })
    )
    .max(20)
    .optional(),
});

export const cohortSchema = z.object({
  organization_id: z.string().min(1).max(64),
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  start_date: z.string().max(32).optional(),
  end_date: z.string().max(32).optional(),
  capacity: z.number().int().min(1).max(100000).optional(),
});

export const programSchema = z.object({
  organization_id: z.string().min(1).max(64),
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
});

export const liveSchema = z.object({
  organization_id: z.string().min(1).max(64),
  course_id: z.string().min(1).max(64).optional().nullable(),
  cohort_id: z.string().min(1).max(64).optional().nullable(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  provider: z.enum(['jitsi', 'meet', 'zoom', 'custom']).optional(),
  meeting_url: httpUrl.optional(),
  starts_at: z.string().min(1).max(64),
  ends_at: z.string().min(1).max(64),
  timezone: z.string().max(64).optional(),
  capacity: z.number().int().min(1).max(100000).optional(),
});

export const bundleSchema = z.object({
  organization_id: z.string().min(1).max(64),
  name: z.string().min(1).max(150),
  description: z.string().max(5000).optional(),
  price: z.number().min(0).max(100000000),
  price_minor: z.number().int().min(0).max(10000000000).optional(),
  course_ids: z.array(z.string().min(1).max(64)).min(1).max(50),
});

export const couponSchema = z.object({
  organization_id: z.string().min(1).max(64),
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(['percent', 'fixed']),
  value: z.number().min(0),
  value_minor: z.number().int().min(0).max(10000000000).optional(),
  max_uses: z.number().int().min(1).max(1000000).optional(),
  min_amount: z.number().min(0).optional(),
  min_amount_minor: z.number().int().min(0).optional(),
  starts_at: z.string().max(64).optional(),
  ends_at: z.string().max(64).optional(),
});

export const orderSchema = z.object({
  organization_id: z.string().min(1).max(64),
  kind: z.enum(['course', 'bundle', 'cohort']),
  reference_id: z.string().min(1).max(64),
  coupon_code: z.string().max(40).optional(),
  affiliate_code: z.string().max(40).optional(),
  currency: z.string().max(8).optional(),
});

export const invitationSchema = z.object({
  organization_id: z.string().min(1).max(64),
  email: z.string().email().max(255),
  role: z.enum(['organization_admin', 'teacher', 'student', 'parent', 'staff']),
});

export const aiJobSchema = z.object({
  organization_id: z.string().min(1).max(64),
  kind: z.enum(['outline', 'lesson_draft', 'questions', 'summary']),
  input_ref: z.string().max(2000).optional(),
});

export const exerciseSchema = z.object({
  course_id: z.string().min(1).max(64),
  lesson_id: z.string().min(1).max(64).optional().nullable(),
  title: z.string().min(1).max(200),
  statement: z.string().min(1).max(20000),
  language: z.string().max(32).optional(),
  examples: z.string().max(10000).optional(),
});
