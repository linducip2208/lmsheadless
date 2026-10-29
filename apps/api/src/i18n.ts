export type Lang = 'en' | 'id' | 'ar';

const dict: Record<string, Record<'en' | 'id', string>> = {
  unauthorized: { en: 'Unauthorized', id: 'Tidak terotorisasi' },
  forbidden: { en: 'Forbidden', id: 'Akses ditolak' },
  not_found: { en: 'Resource not found', id: 'Data tidak ditemukan' },
  validation_failed: { en: 'Validation failed', id: 'Validasi gagal' },
  invalid_credentials: { en: 'Invalid email or password', id: 'Email atau kata sandi salah' },
  account_locked: {
    en: 'Too many failed attempts, try again later',
    id: 'Terlalu banyak percobaan gagal, coba lagi nanti',
  },
  inactive_account: { en: 'Account is not active', id: 'Akun tidak aktif' },
  too_many_requests: {
    en: 'Too many requests, slow down',
    id: 'Terlalu banyak permintaan, coba lagi nanti',
  },
  tenant_denied: { en: 'Organization access denied', id: 'Akses organisasi ditolak' },
  conflict: { en: 'Resource already exists', id: 'Data sudah ada' },
  attempt_limit: { en: 'Maximum attempts reached', id: 'Batas percobaan tercapai' },
  enrolled: { en: 'Already enrolled', id: 'Sudah terdaftar' },
};

export function t(key: string, lang: Lang): string {
  const entry = dict[key];
  if (!entry) return key;
  // Arabic falls back to English server-side; portals render RTL from their
  // own ar dicts (see apps/*/src/i18n.ts applyLocaleDir).
  if (lang === 'ar') return entry.en;
  return entry[lang] ?? entry.en;
}

export function resolveLang(header: string | null, query: string | null): Lang {
  const q = (query ?? '').toLowerCase();
  if (q === 'id' || q === 'en' || q === 'ar') return q;
  const h = (header ?? '').toLowerCase();
  if (h.startsWith('id')) return 'id';
  if (h.startsWith('ar')) return 'ar';
  return 'en';
}
