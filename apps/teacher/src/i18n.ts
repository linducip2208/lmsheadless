export const en = {
  dashboard: 'Dashboard',
  myCourses: 'My courses',
  grading: 'Grading',
  attendance: 'Attendance',
  students: 'Students',
  profile: 'Profile',
  login: 'Sign in',
  logout: 'Logout',
  email: 'Email',
  password: 'Password',
  loading: 'Loading...',
  empty: 'Nothing here yet.',
  pending: 'Pending grading',
  upcoming: 'Upcoming assignments',
  save: 'Save',
};
export const id: Record<keyof typeof en, string> = {
  dashboard: 'Dasbor',
  myCourses: 'Kursus saya',
  grading: 'Penilaian',
  attendance: 'Kehadiran',
  students: 'Siswa',
  profile: 'Profil',
  login: 'Masuk',
  logout: 'Keluar',
  email: 'Email',
  password: 'Kata sandi',
  loading: 'Memuat...',
  empty: 'Belum ada apa-apa.',
  pending: 'Menunggu dinilai',
  upcoming: 'Tugas mendatang',
  save: 'Simpan',
};
export function getDict(l: string) {
  return l === 'id' ? id : en;
}
