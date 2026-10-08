export type Role = 'super_admin' | 'organization_admin' | 'teacher' | 'student' | 'parent' | 'staff';
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending_verification';
export type CourseStatus = 'draft' | 'published' | 'archived';
export type EnrollmentStatus = 'active' | 'completed' | 'dropped' | 'suspended';
export type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer';
export type AttemptStatus = 'in_progress' | 'submitted' | 'graded';
export type SubmissionStatus = 'submitted' | 'graded' | 'returned' | 'late';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type Locale = 'en' | 'id';

export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export interface PaginationParams {
  page: number;
  perPage: number;
  sort?: string;
  order?: 'asc' | 'desc';
  q?: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}
