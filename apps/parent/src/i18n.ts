export const en = {
  title: 'LMS Parent',
  tagline: "Monitor your children's learning. Demo: parent@example.com / Password123!",
  email: 'Email',
  password: 'Password',
  signIn: 'Sign in',
  logout: 'Logout',
  children: 'My children',
  noChildren:
    'No linked students yet. Ask your school administrator to link your children to this account.',
  noOrg: 'No organization membership.',
  back: 'All children',
  progress: 'Course progress',
  grades: 'Grades',
  attendance: 'Attendance',
  announcements: 'Announcements',
  cohorts: 'Cohorts & batches',
  noEnroll: 'No enrollments.',
  noGrades: 'No grades yet.',
  noRecords: 'No records.',
  none: 'None.',
  notInCohort: 'Not in any cohort.',
  myNotifs: 'My notifications',
  loading: 'Loading…',
  failed: 'Failed',
  skip: 'Skip to content',
  session: 'Session',
  date: 'Date',
  status: 'Status',
  installApp: 'Install app',
};

export type ParentDict = typeof en;

export const id: Record<keyof ParentDict, string> = {
  title: 'LMS Orang Tua',
  tagline: 'Pantau pembelajaran anak Anda. Demo: parent@example.com / Password123!',
  email: 'Surel',
  password: 'Kata sandi',
  signIn: 'Masuk',
  logout: 'Keluar',
  children: 'Anak saya',
  noChildren:
    'Belum ada siswa tertaut. Minta administrator sekolah menautkan anak Anda ke akun ini.',
  noOrg: 'Tidak ada keanggotaan organisasi.',
  back: 'Semua anak',
  progress: 'Progres kursus',
  grades: 'Nilai',
  attendance: 'Kehadiran',
  announcements: 'Pengumuman',
  cohorts: 'Kohor & batch',
  noEnroll: 'Tidak ada pendaftaran.',
  noGrades: 'Belum ada nilai.',
  noRecords: 'Tidak ada catatan.',
  none: 'Tidak ada.',
  notInCohort: 'Tidak di kohor mana pun.',
  myNotifs: 'Notifikasi saya',
  loading: 'Memuat…',
  failed: 'Gagal',
  skip: 'Lewati ke konten',
  session: 'Sesi',
  date: 'Tanggal',
  status: 'Status',
  installApp: 'Pasang aplikasi',
};

export const ar: Record<keyof typeof en, string> = {
  ...en,
  loading: 'جارٍ التحميل…',
  failed: 'فشل',
};
export function isRtl(locale: string): boolean {
  return locale === 'ar';
}
export function applyLocaleDir(locale: string): void {
  try {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  } catch {
    /* non-DOM (tests) */
  }
}
export function getDict(l: string): ParentDict {
  if (l === 'ar') return ar as unknown as typeof en;
  return l === 'id' ? id : en;
}
