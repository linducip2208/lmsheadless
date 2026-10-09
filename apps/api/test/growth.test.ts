import { describe, it, expect } from 'vitest';
import { execute, queryFirst } from '../src/db.js';
import { newId, nowIso } from '@lms/shared';
import { setup, mkOrg, mkUser, login, mkCourse, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

const MANIFEST_12 = `<?xml version="1.0"?>
<manifest identifier="M1" version="1.2" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
<metadata><schemaversion>1.2</schemaversion></metadata>
<organizations default="O1"><organization identifier="O1"><title>Demo SCO</title>
<item identifier="I1" identifierref="R1"><title>Lesson 1</title></item>
</organization></organizations>
<resources><resource identifier="R1" type="webcontent" adlcp:scormtype="sco" href="index.html">
<file href="index.html"/></resource></resources></manifest>`;

const MANIFEST_2004 = MANIFEST_12.replace('<schemaversion>1.2</schemaversion>', '<schemaversion>2004 4th Edition</schemaversion>');

async function makeZip(files: Record<string, string>): Promise<ArrayBuffer> {
  const { default: JSZip } = (await import('jszip')) as unknown as { default: new () => { file(n: string, d: string): unknown; generateAsync(o: { type: 'arraybuffer' }): Promise<ArrayBuffer> } };
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('SCORM 1.2', () => {
  it('validates packages, launches, tracks, resumes, isolates tenants', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'sc');
    const orgB = await mkOrg(db, 'scB');
    const t = await mkUser(db, 't@sc.com', 'teacher', org);
    await mkUser(db, 's@sc.com', 'student', org);
    await mkUser(db, 'x@sc.com', 'student', orgB);
    const tokT = (await login(app, 't@sc.com')).access_token;
    const tokS = (await login(app, 's@sc.com')).access_token;
    const tokX = (await login(app, 'x@sc.com')).access_token;
    const c = await mkCourse(db, org, t, 'SC1');
    const sec = (await (await app.request(`/api/v1/courses/${c}/sections`, { method: 'POST', headers: H(tokT), body: JSON.stringify({ title: 'S' }) })).json()) as { data: { id: string } };
    const les = (await (await app.request(`/api/v1/courses/sections/${sec.data.id}/lessons`, { method: 'POST', headers: H(tokT), body: JSON.stringify({ title: 'SCORM lesson', content_type: 'external' }) })).json()) as { data: { id: string } };
    const upload = async (zip: ArrayBuffer, name: string, extra: Record<string, string> = {}) => {
      const form = new FormData();
      form.append('file', new File([zip], name, { type: 'application/zip' }));
      form.append('organization_id', org);
      form.append('course_id', c);
      form.append('lesson_id', les.data.id);
      for (const [k, v] of Object.entries(extra)) form.append(k, v);
      return app.request('/api/v1/scorm/upload', { method: 'POST', headers: authHeader(tokT), body: form });
    };
    // non-zip rejected
    const f1 = new FormData();
    f1.append('file', new File(['x'], 'a.txt', { type: 'text/plain' }));
    f1.append('organization_id', org);
    expect((await app.request('/api/v1/scorm/upload', { method: 'POST', headers: authHeader(tokT), body: f1 })).status).toBe(400);
    // zip without manifest rejected
    const noManifest = await upload(await makeZip({ 'index.html': '<h1>hi</h1>' }), 'a.zip');
    expect(noManifest.status).toBe(400);
    // SCORM 2004 honestly rejected with documented gap
    const v2004 = await upload(await makeZip({ 'imsmanifest.xml': MANIFEST_2004, 'index.html': '<h1>hi</h1>' }), 'b.zip');
    expect(v2004.status).toBe(400);
    expect(((await v2004.json()) as { error: { code: string } }).error.code).toBe('UNSUPPORTED_VERSION');
    // valid 1.2 package
    const good = await upload(await makeZip({ 'imsmanifest.xml': MANIFEST_12, 'index.html': '<h1>lesson</h1>' }), 'c.zip');
    expect(good.status).toBe(201);
    const pkg = (await good.json()) as { data: { id: string; entry: string } };
    expect(pkg.data.entry).toBe('index.html');
    // student cannot upload
    const fS = new FormData();
    fS.append('file', new File([await makeZip({ 'imsmanifest.xml': MANIFEST_12 })], 'd.zip', { type: 'application/zip' }));
    fS.append('organization_id', org);
    expect((await app.request('/api/v1/scorm/upload', { method: 'POST', headers: authHeader(tokS), body: fS })).status).toBe(403);
    // launch + resume
    const att = (await (await app.request('/api/v1/scorm/attempts', { method: 'POST', headers: H(tokS), body: JSON.stringify({ package_id: pkg.data.id }) })).json()) as { data: { id: string } };
    const resume = (await (await app.request('/api/v1/scorm/attempts', { method: 'POST', headers: H(tokS), body: JSON.stringify({ package_id: pkg.data.id }) })).json()) as { data: { id: string; resumed: boolean } };
    expect(resume.data.id).toBe(att.data.id);
    expect(resume.data.resumed).toBe(true);
    // invalid commit values rejected
    const badCommit = await app.request(`/api/v1/scorm/attempts/${att.data.id}/commit`, { method: 'POST', headers: H(tokS), body: JSON.stringify({ completion: 'maybe', score: 500 }) });
    expect(badCommit.status).toBe(400);
    const commit = await app.request(`/api/v1/scorm/attempts/${att.data.id}/commit`, { method: 'POST', headers: H(tokS), body: JSON.stringify({ completion: 'completed', success: 'passed', score: 85, location: 'p3', suspend_data: '{}' }) });
    expect(commit.status).toBe(200);
    // completion mapped to lesson progress
    const prog = await queryFirst(db, 'SELECT id FROM lesson_progress WHERE lesson_id = ? AND is_completed = 1', les.data.id);
    expect(prog).toBeTruthy();
    // content serving + tenant isolation + traversal guard
    const content = await app.request(`/api/v1/scorm/content/${pkg.data.id}/index.html`, { headers: authHeader(tokS) });
    expect(content.status).toBe(200);
    const cross = await app.request(`/api/v1/scorm/content/${pkg.data.id}/index.html`, { headers: authHeader(tokX) });
    expect(cross.status).toBe(403);
    const trav = await app.request(`/api/v1/scorm/content/${pkg.data.id}/..%2Fsecret`, { headers: authHeader(tokS) });
    expect([400, 404].includes(trav.status)).toBe(true);
    // teacher attempt list
    const list = await app.request(`/api/v1/scorm/packages/${pkg.data.id}/attempts`, { headers: authHeader(tokT) });
    expect(list.status).toBe(200);
    void t;
  });
});

describe('AI framework + exercises + email', () => {
  it('AI is disabled by default, mock works with limits and review gates', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'ai');
    await mkUser(db, 'adm@ai.com', 'organization_admin', org);
    await mkUser(db, 't@ai.com', 'teacher', org);
    const tokA = (await login(app, 'adm@ai.com')).access_token;
    const tokT = (await login(app, 't@ai.com')).access_token;
    const off = await app.request('/api/v1/ai/jobs', { method: 'POST', headers: H(tokT), body: JSON.stringify({ organization_id: org, kind: 'outline', input_ref: 'Algebra' }) });
    expect(off.status).toBe(400);
    const cfgDeny = await app.request(`/api/v1/ai/config?organization_id=${org}`, { headers: authHeader(tokT) });
    expect(cfgDeny.status).toBe(403);
    // openai-compatible without key rejected (validation, no fake calls)
    const noKey = await app.request('/api/v1/ai/config', { method: 'PUT', headers: H(tokA), body: JSON.stringify({ organization_id: org, provider: 'openai-compatible', model: 'x', base_url: 'https://x.example' }) });
    expect(noKey.status).toBe(400);
    await app.request('/api/v1/ai/config', { method: 'PUT', headers: H(tokA), body: JSON.stringify({ organization_id: org, provider: 'mock', monthly_limit: 1 }) });
    const job = (await (await app.request('/api/v1/ai/jobs', { method: 'POST', headers: H(tokT), body: JSON.stringify({ organization_id: org, kind: 'questions', input_ref: 'Fractions' }) })).json()) as { data: { status: string; output: string } };
    expect(job.data.status).toBe('completed');
    expect(job.data.output).toContain('instructor review');
    const over = await app.request('/api/v1/ai/jobs', { method: 'POST', headers: H(tokT), body: JSON.stringify({ organization_id: org, kind: 'summary', input_ref: 'x' }) });
    expect(over.status).toBe(400);
    const jobs = (await (await app.request(`/api/v1/ai/jobs?organization_id=${org}`, { headers: authHeader(tokT) })).json()) as { data: { id: string }[] };
    const review = await app.request(`/api/v1/ai/jobs/${jobs.data[0].id}/review`, { method: 'POST', headers: H(tokT), body: JSON.stringify({ approve: true }) });
    expect(review.status).toBe(200);
    void db;
  });

  it('exercises submit statically, refuse live execution honestly', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'ex');
    const t = await mkUser(db, 't@ex.com', 'teacher', org);
    await mkUser(db, 's@ex.com', 'student', org);
    const tokT = (await login(app, 't@ex.com')).access_token;
    const tokS = (await login(app, 's@ex.com')).access_token;
    const c = await mkCourse(db, org, t, 'EX1');
    const ex = (await (await app.request('/api/v1/exercises', { method: 'POST', headers: H(tokT), body: JSON.stringify({ course_id: c, title: 'FizzBuzz', statement: 'Print 1-100', language: 'javascript' }) })).json()) as { data: { id: string } };
    const list = (await (await app.request(`/api/v1/exercises?course_id=${c}`, { headers: authHeader(tokS) })).json()) as { data: Record<string, unknown>[] };
    expect(list.data[0]).not.toHaveProperty('statement');
    const sub = await app.request(`/api/v1/exercises/${ex.data.id}/submissions`, { method: 'POST', headers: H(tokS), body: JSON.stringify({ code: 'for(;;){}' }) });
    expect(sub.status).toBe(201);
    const exec = await app.request(`/api/v1/exercises/${ex.data.id}/submissions`, { method: 'POST', headers: H(tokS), body: JSON.stringify({ code: 'x', execute: true }) });
    expect(exec.status).toBe(400);
    expect(((await exec.json()) as { error: { code: string } }).error.code).toBe('EXECUTION_UNAVAILABLE');
    const subRow = await queryFirst<{ id: string }>(db, 'SELECT id FROM exercise_submissions WHERE exercise_id = ?', ex.data.id);
    const fb = await app.request(`/api/v1/exercise-submissions/${subRow?.id}/feedback`, { method: 'POST', headers: H(tokT), body: JSON.stringify({ feedback: 'Good start', status: 'reviewed' }) });
    expect(fb.status).toBe(200);
    const fbDeny = await app.request(`/api/v1/exercise-submissions/${subRow?.id}/feedback`, { method: 'POST', headers: H(tokS), body: JSON.stringify({ feedback: 'x', status: 'reviewed' }) });
    expect(fbDeny.status).toBe(403);
    void t;
  });

  it('email queue with log driver and privilege gates', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'em');
    await mkUser(db, 'adm@em.com', 'organization_admin', org);
    await mkUser(db, 't@em.com', 'teacher', org);
    const tokA = (await login(app, 'adm@em.com')).access_token;
    const tokT = (await login(app, 't@em.com')).access_token;
    const bad = await app.request('/api/v1/email/queue', { method: 'POST', headers: H(tokT), body: JSON.stringify({ organization_id: org, to: 'not-an-email', subject: 'Hi', body: 'x' }) });
    expect(bad.status).toBe(400);
    const q = (await (await app.request('/api/v1/email/queue', { method: 'POST', headers: H(tokT), body: JSON.stringify({ organization_id: org, to: 's@example.com', subject: 'Hi', body: '<p>Hello</p>' }) })).json()) as { data: { id: string } };
    const listDeny = await app.request(`/api/v1/email/queue?organization_id=${org}`, { headers: authHeader(tokT) });
    expect(listDeny.status).toBe(403);
    const send = (await (await app.request(`/api/v1/email/queue/${q.data.id}/send`, { method: 'POST', headers: authHeader(tokA) })).json()) as { data: { sent: boolean; driver: string } };
    expect(send.data.sent).toBe(true);
    expect(send.data.driver).toBe('log');
    void db;
  });
});

describe('invitations + org units + imports + engagement', () => {
  it('invite lifecycle with expiry and role guard', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'inv');
    await mkUser(db, 'adm@inv.com', 'organization_admin', org);
    await mkUser(db, 't@inv.com', 'teacher', org);
    const tokA = (await login(app, 'adm@inv.com')).access_token;
    const tokT = (await login(app, 't@inv.com')).access_token;
    const deny = await app.request('/api/v1/invitations', { method: 'POST', headers: H(tokT), body: JSON.stringify({ organization_id: org, email: 'n@x.com', role: 'student' }) });
    expect(deny.status).toBe(403);
    const inv = (await (await app.request('/api/v1/invitations', { method: 'POST', headers: H(tokA), body: JSON.stringify({ organization_id: org, email: 'new@x.com', role: 'teacher' }) })).json()) as { data: { invite_url: string } };
    const token = inv.data.invite_url.split('/').pop() ?? '';
    const accept = await app.request('/api/v1/invitations/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, name: 'Newbie', password: 'Password123!' }) });
    expect(accept.status).toBe(201);
    const reuse = await app.request('/api/v1/invitations/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, name: 'X', password: 'Password123!' }) });
    expect(reuse.status).toBe(400);
    const canLogin = await app.request('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'new@x.com', password: 'Password123!' }) });
    expect(canLogin.status).toBe(200);
    void db;
  });

  it('org units and member assignment', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'ou');
    const u = await mkUser(db, 'u@ou.com', 'student', org);
    await mkUser(db, 'adm@ou.com', 'organization_admin', org);
    await mkUser(db, 't@ou.com', 'teacher', org);
    const tokA = (await login(app, 'adm@ou.com')).access_token;
    const tokT = (await login(app, 't@ou.com')).access_token;
    const deny = await app.request('/api/v1/org-units', { method: 'POST', headers: H(tokT), body: JSON.stringify({ organization_id: org, name: 'Dept' }) });
    expect(deny.status).toBe(403);
    const unit = (await (await app.request('/api/v1/org-units', { method: 'POST', headers: H(tokA), body: JSON.stringify({ organization_id: org, name: 'Science Dept' }) })).json()) as { data: { id: string } };
    const add = await app.request(`/api/v1/org-units/${unit.data.id}/members`, { method: 'POST', headers: H(tokA), body: JSON.stringify({ user_id: u }) });
    expect(add.status).toBe(201);
    const list = await app.request(`/api/v1/org-units?organization_id=${org}`, { headers: authHeader(tokT) });
    expect(list.status).toBe(200);
  });

  it('CSV imports: dry-run, row errors, duplicates, formula guard, processing', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'imp');
    await mkUser(db, 'adm@imp.com', 'organization_admin', org);
    await mkUser(db, 't@imp.com', 'teacher', org);
    const tokA = (await login(app, 'adm@imp.com')).access_token;
    const tokT = (await login(app, 't@imp.com')).access_token;
    const deny = await app.request('/api/v1/imports', { method: 'POST', headers: H(tokT), body: JSON.stringify({ kind: 'users', organization_id: org, dry_run: true, rows: [] }) });
    expect(deny.status).toBe(403);
    const missing = await app.request('/api/v1/imports', { method: 'POST', headers: H(tokA), body: JSON.stringify({ kind: 'users', organization_id: org, dry_run: true, rows: [{ name: 'No Email' }] }) });
    expect(missing.status).toBe(400);
    const rows = [
      { email: 'a@imp.com', name: 'A' },
      { email: 'bad-email', name: 'Bad' },
      { email: 'b@imp.com', name: '=cmd|calc' },
      { email: 'c@imp.com', name: '' },
    ];
    const dry = (await (await app.request('/api/v1/imports', { method: 'POST', headers: H(tokA), body: JSON.stringify({ kind: 'users', organization_id: org, dry_run: true, rows }) })).json()) as { data: { valid: number; errors: { row: number }[] } };
    expect(dry.data.valid).toBe(1);
    expect(dry.data.errors.length).toBe(3);
    const run = (await (await app.request('/api/v1/imports', { method: 'POST', headers: H(tokA), body: JSON.stringify({ kind: 'users', organization_id: org, dry_run: false, rows }) })).json()) as { data: { processed: number; job_id: string } };
    expect(run.data.processed).toBe(1);
    const rerun = (await (await app.request('/api/v1/imports', { method: 'POST', headers: H(tokA), body: JSON.stringify({ kind: 'users', organization_id: org, dry_run: false, rows: [{ email: 'a@imp.com', name: 'A' }] }) })).json()) as { data: { processed: number; errors: { errors: string[] }[] } };
    expect(rerun.data.processed).toBe(0);
    expect(rerun.data.errors[0].errors[0]).toContain('duplicate');
    const job = await app.request(`/api/v1/imports/${run.data.job_id}`, { headers: authHeader(tokA) });
    expect(job.status).toBe(200);
    // multipart CSV path
    const form = new FormData();
    form.append('kind', 'users');
    form.append('organization_id', org);
    form.append('dry_run', 'true');
    form.append('file', new File(['email,name\nd@imp.com,D'], 'users.csv', { type: 'text/csv' }));
    const multi = await app.request('/api/v1/imports', { method: 'POST', headers: authHeader(tokA), body: form });
    expect(multi.status).toBe(200);
    void db;
  });

  it('engagement report and CSV export', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'eng');
    const t = await mkUser(db, 't@eng.com', 'teacher', org);
    await mkUser(db, 'adm@eng.com', 'organization_admin', org);
    const tokT = (await login(app, 't@eng.com')).access_token;
    const tokA = (await login(app, 'adm@eng.com')).access_token;
    const c = await mkCourse(db, org, t, 'ENG1');
    await execute(db, 'INSERT INTO activity_log (id, organization_id, user_id, kind, created_at) VALUES (?, ?, ?, ?, ?)', newId(), org, t, 'lesson.complete', nowIso());
    const eng = (await (await app.request(`/api/v1/reports/engagement?organization_id=${org}&days=7`, { headers: authHeader(tokA) })).json()) as { data: { by_day: unknown[]; by_kind: unknown[] } };
    expect(eng.data.by_day.length).toBeGreaterThan(0);
    const deny = await app.request(`/api/v1/reports/engagement?organization_id=${org}`, { headers: authHeader((await login(app, 't@eng.com')).access_token) });
    expect(deny.status).toBe(200); // teachers may view engagement
    const csv = await app.request(`/api/v1/reports/export?kind=enrollments&course_id=${c}&organization_id=${org}`, { headers: authHeader(tokT) });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const badKind = await app.request(`/api/v1/reports/export?kind=nope&organization_id=${org}`, { headers: authHeader(tokT) });
    expect(badKind.status).toBe(400);
    void t;
  });
});

describe('refresh reuse detection', () => {
  it('reusing a rotated refresh token revokes the whole family', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'reuse');
    await mkUser(db, 'u@reuse.com', 'student', org);
    const first = await login(app, 'u@reuse.com');
    const second = (await (await app.request('/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: first.refresh_token }) })).json()) as { data: { refresh_token: string; access_token: string } };
    // Attacker replays the old (rotated) token.
    const replay = (await (await app.request('/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: first.refresh_token }) })).json()) as { success: boolean; error: { code: string } };
    expect(replay.success).toBe(false);
    expect(replay.error.code).toBe('REUSE_DETECTED');
    // The legitimate new token is now dead too (family revoked).
    const after = await app.request('/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: second.data.refresh_token }) });
    expect(after.status).toBe(401);
    void db;
  });
});
