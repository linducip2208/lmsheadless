export const en = {
  myLearning: 'My learning',
  courses: 'Courses',
  grades: 'Grades',
  announcements: 'Announcements',
  profile: 'Profile',
  login: 'Login',
  logout: 'Logout',
  email: 'Email',
  password: 'Password',
  enrolled: 'Enrolled courses',
  progress: 'Progress',
  upcoming: 'Upcoming work',
  continue: 'Open',
  loading: 'Loading...',
  empty: 'Nothing here yet.',
};
export const id: Record<keyof typeof en, string> = {
  myLearning: 'Pembelajaranku',
  courses: 'Kursus',
  grades: 'Nilai',
  announcements: 'Pengumuman',
  profile: 'Profil',
  login: 'Masuk',
  logout: 'Keluar',
  email: 'Email',
  password: 'Kata sandi',
  enrolled: 'Kursus yang diikuti',
  progress: 'Progres',
  upcoming: 'Tugas mendatang',
  continue: 'Buka',
  loading: 'Memuat...',
  empty: 'Belum ada apa-apa.',
};
export function getDict(l: string) {
  return l === 'id' ? id : en;
}
