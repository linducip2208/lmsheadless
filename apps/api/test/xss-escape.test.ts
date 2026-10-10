import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from '@lms/ui';
import { setup, mkOrg, mkUser, mkCourse, login, authHeader } from './helpers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

describe('esc() output-encoding boundary', () => {
  it('neutralizes script/img-onerror payloads', () => {
    const out = esc(`<img src=x onerror=alert(document.domain)>"'&`);
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('"');
    expect(out).toContain('&lt;img');
    expect(out).toContain('&quot;');
    expect(out).toContain('&#39;');
    expect(out).toContain('&amp;');
    expect(esc(null)).toBe('');
    expect(esc(42)).toBe('42');
  });

  it('stored payloads survive the API verbatim (frontend must escape)', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'xss');
    const t = await mkUser(db, 't@xss.test', 'teacher', org);
    await mkUser(db, 's@xss.test', 'student', org);
    const tokT = (await login(app, 't@xss.test')).access_token;
    const c = await mkCourse(db, org, t, 'XSS1');
    const payload = `<img src=x onerror=alert(1)>`;
    const created = await app.request('/api/v1/discussions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(tokT) },
      body: JSON.stringify({ course_id: c, title: payload, body: payload }),
    });
    expect(created.status).toBe(201);
    const list = (await (
      await app.request(`/api/v1/discussions?course_id=${c}`, { headers: authHeader(tokT) })
    ).json()) as { data: { title: string }[] };
    // Server stores verbatim by design; the esc() boundary lives in the portals.
    expect(list.data[0].title).toBe(payload);
  });

  it('portal discussion/announcement/quiz renders pass through esc()', () => {
    const student = src('apps/student/src/main.ts');
    for (const needle of [
      '${esc(x.title)}',
      '${esc(r.body',
      '${esc(q.prompt)}',
      '${esc(n.title)}',
    ]) {
      expect(student).toContain(needle);
    }
    expect(student).not.toContain('javascript:history.back()');
    const teacher = src('apps/teacher/src/main.ts');
    expect(teacher).toContain('${esc(a.prompt');
    const admin = src('apps/admin/src/pages/social.ts');
    expect(admin).toContain('${esc(x.title)}');
    expect(admin).toContain('${esc(a.title)}');
    const web = src('apps/web/src/main.ts');
    expect(web).toContain('${esc(c.title)}');
  });
});
