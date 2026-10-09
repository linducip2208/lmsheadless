// Development seed: demo org + all roles + academic + course + quiz + assignment + progress.
import { createNodeSqliteDb, execute, queryFirst } from './db.js';
import { runMigrations } from './migrate.js';
import { hashPassword } from './crypto.js';
import { newId, nowIso } from '@lms/shared';

const PASS = process.env.SEED_DEMO_PASSWORD ?? 'Password123!';

async function main() {
  const dbPath = process.env.DATABASE_PATH ?? './.data/lms.db';
  const { mkdirSync } = await import('node:fs');
  mkdirSync('./.data', { recursive: true });
  const db = await createNodeSqliteDb(dbPath);
  await runMigrations(db);
  const now = nowIso();
  const pw = await hashPassword(PASS);

  const has = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM users');
  if ((has?.n ?? 0) > 0) {
    // eslint-disable-next-line no-console
    console.log('Seed skipped: users already exist.');
    return;
  }

  const orgId = newId();
  await execute(
    db,
    'INSERT INTO organizations (id, name, slug, description, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    orgId,
    'Demo Academy',
    'demo-academy',
    'Seed organization for development',
    '{}',
    now,
    now
  );

  const mkUser = async (email: string, name: string, role: string) => {
    const id = newId();
    await execute(
      db,
      'INSERT INTO users (id, email, password_hash, name, status, locale, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      email,
      pw,
      name,
      'active',
      'en',
      'Asia/Jakarta',
      now,
      now
    );
    await execute(
      db,
      'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      orgId,
      id,
      role,
      now,
      now
    );
    return id;
  };

  const superId = await mkUser('superadmin@example.com', 'Super Admin', 'super_admin');
  void superId;
  const adminId = await mkUser('admin@example.com', 'Org Admin', 'organization_admin');
  void adminId;
  const teacherId = await mkUser('teacher@example.com', 'Dewi Guru', 'teacher');
  const studentId = await mkUser('student@example.com', 'Budi Siswa', 'student');
  const parentId = await mkUser('parent@example.com', 'Sari Orang Tua', 'parent');
  const staffId = await mkUser('staff@example.com', 'Andi Staff', 'staff');
  void staffId;

  await execute(
    db,
    'INSERT INTO parent_links (id, parent_id, student_id, organization_id, created_at) VALUES (?, ?, ?, ?, ?)',
    newId(),
    parentId,
    studentId,
    orgId,
    now
  );

  const perms = [
    'users.read',
    'users.write',
    'courses.read',
    'courses.write',
    'grades.write',
    'attendance.write',
    'reports.read',
  ];
  void perms;
  const { PERMISSIONS, ROLE_PERMISSIONS } = await import('./permissions.js');
  for (const p of PERMISSIONS) {
    await execute(
      db,
      'INSERT OR IGNORE INTO permissions (id, key, description, created_at) VALUES (?, ?, ?, ?)',
      p.key,
      p.key,
      p.description,
      now
    );
  }
  // Legacy keys kept for backward compatibility with older installs.
  for (const p of [
    'users.read',
    'users.write',
    'courses.read',
    'courses.write',
    'grades.write',
    'attendance.write',
    'reports.read',
  ]) {
    await execute(
      db,
      'INSERT OR IGNORE INTO permissions (id, key, created_at) VALUES (?, ?, ?)',
      p,
      p,
      now
    );
  }
  for (const [role, list] of Object.entries(ROLE_PERMISSIONS)) {
    for (const p of list)
      await execute(
        db,
        'INSERT OR IGNORE INTO role_permissions (role, permission_id) VALUES (?, ?)',
        role,
        p
      );
  }
  const defaultSettings: [string, string][] = [
    ['setup_completed', 'true'],
    ['app_name', 'LMS Headless'],
    ['default_locale', 'en'],
    ['default_timezone', 'Asia/Jakarta'],
    ['registration_enabled', 'true'],
  ];
  for (const [k, v] of defaultSettings) {
    await execute(
      db,
      'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      k,
      v,
      now
    );
  }

  const ayId = newId();
  await execute(
    db,
    'INSERT INTO academic_years (id, organization_id, name, start_date, end_date, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ayId,
    orgId,
    '2026/2027',
    '2026-07-01',
    '2027-06-30',
    1,
    now,
    now
  );
  const termId = newId();
  await execute(
    db,
    'INSERT INTO terms (id, academic_year_id, organization_id, name, start_date, end_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    termId,
    ayId,
    orgId,
    'Semester Ganjil',
    '2026-07-01',
    '2026-12-31',
    now,
    now
  );
  const classId = newId();
  await execute(
    db,
    'INSERT INTO classes (id, organization_id, academic_year_id, term_id, name, grade_level, homeroom_teacher_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    classId,
    orgId,
    ayId,
    termId,
    'Kelas 10-A',
    '10',
    teacherId,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO class_members (id, class_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
    newId(),
    classId,
    studentId,
    'student',
    now
  );
  const subjId = newId();
  await execute(
    db,
    'INSERT INTO subjects (id, organization_id, code, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    subjId,
    orgId,
    'MAT-10',
    'Matematika Kelas 10',
    now,
    now
  );
  const catId = newId();
  await execute(
    db,
    'INSERT INTO course_categories (id, organization_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    catId,
    orgId,
    'Science',
    'science',
    now,
    now
  );
  const courseId = newId();
  await execute(
    db,
    'INSERT INTO courses (id, organization_id, category_id, subject_id, code, title, description, status, price, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    courseId,
    orgId,
    catId,
    subjId,
    'MAT101',
    'Matematika Dasar',
    'Kursus contoh dengan section, lesson, kuis, dan tugas.',
    'published',
    0,
    teacherId,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO course_instructors (id, course_id, user_id, created_at) VALUES (?, ?, ?, ?)',
    newId(),
    courseId,
    teacherId,
    now
  );
  const secId = newId();
  await execute(
    db,
    'INSERT INTO course_sections (id, course_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    secId,
    courseId,
    'Bab 1: Aljabar',
    0,
    now,
    now
  );
  const les1 = newId();
  const les2 = newId();
  await execute(
    db,
    'INSERT INTO lessons (id, section_id, course_id, title, content_type, body, position, duration_minutes, is_free_preview, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    les1,
    secId,
    courseId,
    'Pengenalan Aljabar',
    'text',
    'Materi pengenalan aljabar...',
    0,
    15,
    1,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO lessons (id, section_id, course_id, title, content_type, body, video_url, position, duration_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    les2,
    secId,
    courseId,
    'Video Pembahasan',
    'video',
    'Tonton video berikut.',
    'https://example.com/video/aljabar.mp4',
    1,
    20,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO enrollments (id, course_id, student_id, status, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(),
    courseId,
    studentId,
    'active',
    now,
    now,
    now
  );
  const quizId = newId();
  await execute(
    db,
    'INSERT INTO quizzes (id, course_id, organization_id, title, description, passing_score, max_attempts, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    quizId,
    courseId,
    orgId,
    'Kuis Bab 1',
    'Kuis pemahaman aljabar',
    70,
    3,
    teacherId,
    now,
    now
  );
  const q1 = newId();
  await execute(
    db,
    'INSERT INTO questions (id, quiz_id, type, prompt, points, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    q1,
    quizId,
    'multiple_choice',
    'Hasil dari 2x + 3 = 11, x = ?',
    50,
    0,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO question_options (id, question_id, label, is_correct, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(),
    q1,
    'x = 3',
    0,
    0,
    now
  );
  await execute(
    db,
    'INSERT INTO question_options (id, question_id, label, is_correct, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(),
    q1,
    'x = 4',
    1,
    1,
    now
  );
  const q2 = newId();
  await execute(
    db,
    'INSERT INTO questions (id, quiz_id, type, prompt, points, position, correct_answer, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    q2,
    quizId,
    'true_false',
    'Aljabar berasal dari kata al-jabr. Benar atau salah?',
    50,
    1,
    'true',
    now,
    now
  );
  const asgId = newId();
  await execute(
    db,
    'INSERT INTO assignments (id, course_id, organization_id, title, description, max_score, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    asgId,
    courseId,
    orgId,
    'Tugas 1: Persamaan Linear',
    'Kerjakan soal halaman 10.',
    100,
    teacherId,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO lesson_progress (id, lesson_id, student_id, course_id, is_completed, completed_at, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)',
    newId(),
    les1,
    studentId,
    courseId,
    now,
    now,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO course_progress (id, course_id, student_id, percent, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(),
    courseId,
    studentId,
    50,
    now,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO grades (id, course_id, student_id, category, score, max_score, feedback, graded_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId(),
    courseId,
    studentId,
    'assignment',
    85,
    100,
    'Bagus, lanjutkan!',
    teacherId,
    now,
    now
  );
  const sessId = newId();
  await execute(
    db,
    'INSERT INTO attendance_sessions (id, organization_id, class_id, course_id, title, session_date, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    sessId,
    orgId,
    classId,
    courseId,
    'Pertemuan 1',
    '2026-10-01',
    teacherId,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO attendance_records (id, session_id, student_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(),
    sessId,
    studentId,
    'present',
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO certificate_templates (id, organization_id, name, body_html, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(),
    orgId,
    'Default',
    '<h1>Certificate of Completion</h1><p>{{student}} - {{course}}</p>',
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO announcements (id, organization_id, title, body, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(),
    orgId,
    'Selamat datang di Demo Academy',
    'Semester baru dimulai 1 Juli 2026.',
    adminId,
    now,
    now
  );
  // Enterprise demo slice: bundle, coupon, cohort + program, live session, bank.
  const bundleId = newId();
  await execute(
    db,
    'INSERT INTO bundles (id, organization_id, name, description, price, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    bundleId,
    orgId,
    'Paket Matematika',
    'Bundel contoh untuk etalase.',
    0,
    'published',
    teacherId,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO bundle_courses (bundle_id, course_id) VALUES (?, ?)',
    bundleId,
    courseId
  );
  await execute(
    db,
    'INSERT INTO coupons (id, organization_id, code, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(),
    orgId,
    'HEMAT10',
    'percent',
    10,
    now
  );
  const cohortId = newId();
  await execute(
    db,
    'INSERT INTO cohorts (id, organization_id, name, description, capacity, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    cohortId,
    orgId,
    'Angkatan 2026-A',
    'Batch contoh.',
    100,
    teacherId,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO cohort_members (id, cohort_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
    newId(),
    cohortId,
    studentId,
    'student',
    now
  );
  await execute(
    db,
    'INSERT INTO cohort_courses (cohort_id, course_id) VALUES (?, ?)',
    cohortId,
    courseId
  );
  const programId = newId();
  await execute(
    db,
    'INSERT INTO programs (id, organization_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    programId,
    orgId,
    'Jalur Matematika',
    'Program contoh satu kursus.',
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO program_courses (id, program_id, course_id, position, created_at) VALUES (?, ?, ?, ?, ?)',
    newId(),
    programId,
    courseId,
    0,
    now
  );
  await execute(
    db,
    'INSERT INTO live_sessions (id, organization_id, course_id, title, provider, meeting_url, starts_at, ends_at, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId(),
    orgId,
    courseId,
    'Sesi perkenalan',
    'jitsi',
    'https://meet.jit.si/lms-demo-intro',
    '2026-11-01T10:00:00Z',
    '2026-11-01T11:00:00Z',
    'scheduled',
    teacherId,
    now,
    now
  );
  const bankId = newId();
  await execute(
    db,
    'INSERT INTO question_banks (id, organization_id, course_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    bankId,
    orgId,
    courseId,
    'Bank Aljabar',
    teacherId,
    now,
    now
  );
  // eslint-disable-next-line no-console
  console.log(
    `Seed done. org=${orgId} course=${courseId}. Demo logins: superadmin/admin/teacher/student/parent/staff@example.com / ${PASS}`
  );
}

if (process.argv[1]?.endsWith('seed.ts')) {
  await main();
}

export default main;
