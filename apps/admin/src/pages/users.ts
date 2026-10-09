import { crud, currentOrgId, myOrgs, setCurrentOrgId, getMe, t } from '../lib.js';

export async function renderUsers(el: HTMLElement): Promise<void> {
  const me = getMe();
  const d = t();
  const orgs = await myOrgs().catch(() => []);
  const fallback = currentOrgId() ?? me?.memberships[0]?.organization_id ?? orgs[0]?.id ?? '';
  if (fallback && !currentOrgId()) setCurrentOrgId(fallback);
  await crud(el, {
    endpoint: '/api/v1/users',
    query: fallback ? { organization_id: fallback } : {},
    cols: [
      { key: 'email', label: d.email },
      { key: 'name', label: d.name },
      { key: 'status', label: d.status, render: (v) => `<span class="badge ${v === 'active' ? 'bg-green' : 'bg-yellow'}">${String(v)}</span>` },
      { key: 'locale', label: d.locale },
    ],
    createTitle: `${d.create} ${d.users}`,
    createFields: [
      { name: 'email', label: d.email, type: 'email', required: true },
      { name: 'password', label: d.password, type: 'password', required: true },
      { name: 'name', label: d.name, required: true },
      { name: 'role', label: d.role, type: 'text', value: 'student', required: true },
      { name: 'organization_id', label: `${d.organizations} ID`, value: fallback },
    ],
    editFields: (row) => [
      { name: 'name', label: d.name, value: String(row.name ?? '') },
      { name: 'locale', label: d.locale, value: String(row.locale ?? 'en') },
      { name: 'timezone', label: 'Timezone', value: String(row.timezone ?? 'Asia/Jakarta') },
    ],
    deletable: () => me?.isSuperAdmin ?? false,
  });
}
