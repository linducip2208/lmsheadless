import { crud, currentOrgId, myOrgs, setCurrentOrgId, getMe } from '../lib.js';

export async function renderUsers(el: HTMLElement): Promise<void> {
  const me = getMe();
  const orgs = await myOrgs().catch(() => []);
  const fallback = currentOrgId() ?? me?.memberships[0]?.organization_id ?? orgs[0]?.id ?? '';
  if (fallback && !currentOrgId()) setCurrentOrgId(fallback);
  await crud(el, {
    endpoint: '/api/v1/users',
    query: fallback ? { organization_id: fallback } : {},
    cols: [
      { key: 'email', label: 'Email' },
      { key: 'name', label: 'Name' },
      { key: 'status', label: 'Status', render: (v) => `<span class="badge ${v === 'active' ? 'bg-green' : 'bg-yellow'}">${String(v)}</span>` },
      { key: 'locale', label: 'Locale' },
    ],
    createTitle: 'Create user',
    createFields: [
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'password', label: 'Password (min 8 chars)', type: 'password', required: true },
      { name: 'name', label: 'Full name', required: true },
      { name: 'role', label: 'Role', type: 'text', value: 'student', required: true },
      { name: 'organization_id', label: 'Organization ID', value: fallback },
    ],
    editFields: (row) => [
      { name: 'name', label: 'Full name', value: String(row.name ?? '') },
      { name: 'locale', label: 'Locale (en/id)', value: String(row.locale ?? 'en') },
      { name: 'timezone', label: 'Timezone', value: String(row.timezone ?? 'Asia/Jakarta') },
    ],
    deletable: () => me?.isSuperAdmin ?? false,
  });
}
