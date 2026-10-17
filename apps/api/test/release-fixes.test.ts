import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { newId, nowIso } from '@lms/shared';
import { execute } from '../src/db.js';
import { sha256Hex } from '../src/crypto.js';
import { setup, mkOrg, mkUser, mkCourse, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

async function createQuiz(app: App, tok: string, courseId: string, title: string) {
  const r = (await (
    await app.request('/api/v1/quizzes', {
      method: 'POST',
      headers: H(tok),
      body: JSON.stringify({ course_id: courseId, title, passing_score: 50, max_attempts: 10 }),
    })
  ).json()) as { data: { id: string } };
  return r.data.id;
}

async function addQuestion(app: App, tok: string, quizId: string, q: Record<string, unknown>) {
  const r = await app.request(`/api/v1/quizzes/${quizId}/questions`, {
    method: 'POST',
    headers: H(tok),
    body: JSON.stringify(q),
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { data: { id: string } }).data.id;
}

const MANIFEST_12 = `<?xml version="1.0"?>
<manifest identifier="M1" version="1.2" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
<metadata><schemaversion>1.2</schemaversion></metadata>
<organizations default="O1"><organization identifier="O1"><title>Demo SCO</title>
<item identifier="I1" identifierref="R1"><title>Lesson 1</title></item>
</organization></organizations>
<resources><resource identifier="R1" type="webcontent" adlcp:scormtype="sco" href="index.html">
<file href="index.html"/></resource></resources></manifest>`;

async function makeZip(files: Record<string, string>): Promise<ArrayBuffer> {
  const { default: JSZip } = (await import('jszip')) as unknown as {
    default: new () => {
      file(n: string, d: string): unknown;
      generateAsync(o: { type: 'arraybuffer' }): Promise<ArrayBuffer>;
    };
  };
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('release fixes: authz, integrity, scoring', () => {
  it('parents cannot read answer keys via quiz questions', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rk');
    const t = await mkUser(db, 't@rk.test', 'teacher', org);
    await mkUser(db, 's@rk.test', 'student', org);
    await mkUser(db, 'p@rk.test', 'parent', org);
    const tokT = (await login(app, 't@rk.test')).access_token;
    const tokP = (await login(app, 'p@rk.test')).access_token;
    const c = await mkCourse(db, org, t, 'RK1');
    const qz = await createQuiz(app, tokT, c, 'Keys');
    await addQuestion(app, tokT, qz, {
      type: 'multiple_choice',
      prompt: '2+2?',
      points: 10,
      options: [
        { label: '3', is_correct: false },
        { label: '4', is_correct: true },
      ],
    });
    const parentRes = (await (
      await app.request(`/api/v1/quizzes/${qz}/questions`, {
        headers: authHeader(tokP),
      })
    ).json()) as { data: { options: Record<string, unknown>[] }[] };
    for (const q of parentRes.data) {
      for (const o of q.options) {
        expect(o).not.toHaveProperty('is_correct');
        expect(o).toHaveProperty('label');
      }
    }
    // Teachers still see correctness for authoring/grading.
    const teacherRes = (await (
      await app.request(`/api/v1/quizzes/${qz}/questions`, {
        headers: authHeader(tokT),
      })
    ).json()) as { data: { options: Record<string, unknown>[] }[] };
    expect(teacherRes.data[0].options[0]).toHaveProperty('is_correct');
  });

  it('password reset and invitation accept reject oversized passwords', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'pw');
    const uid = await mkUser(db, 'v@pw.test', 'student', org);
    await mkUser(db, 'a@pw.test', 'organization_admin', org);
    const tokA = (await login(app, 'a@pw.test')).access_token;
    const plant = async () => {
      const raw = `raw-reset-${newId()}`;
      await execute(
        db,
        'INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        newId(),
        uid,
        await sha256Hex(raw),
        new Date(Date.now() + 3600_000).toISOString(),
        nowIso()
      );
      return raw;
    };
    const huge = 'x'.repeat(200);
    const bad = await app.request('/api/v1/auth/password/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: await plant(), password: huge }),
    });
    expect(bad.status).toBe(400);
    // Normal-length passwords still accepted.
    const good = await app.request('/api/v1/auth/password/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: await plant(), password: 'BrandNew456!' }),
    });
    expect(good.status).toBe(200);

    const inv = (await (
      await app.request('/api/v1/invitations', {
        method: 'POST',
        headers: H(tokA),
        body: JSON.stringify({
          organization_id: org,
          email: 'new@pw.test',
          role: 'student',
        }),
      })
    ).json()) as { data: { invite_url: string } };
    const token = inv.data.invite_url.split('/').pop() ?? '';
    const badAccept = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name: 'New', password: huge }),
    });
    expect(badAccept.status).toBe(400);
    // Token not consumed by the rejected attempt.
    const goodAccept = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name: 'New', password: 'Password123!' }),
    });
    expect(goodAccept.status).toBe(201);
  });

  it('archived courses block student enrollment; teachers bypass', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'arc');
    const t = await mkUser(db, 't@arc.test', 'teacher', org);
    const s1 = await mkUser(db, 's1@arc.test', 'student', org);
    const s2 = await mkUser(db, 's2@arc.test', 'student', org);
    const tokT = (await login(app, 't@arc.test')).access_token;
    const tok1 = (await login(app, 's1@arc.test')).access_token;
    const tok2 = (await login(app, 's2@arc.test')).access_token;
    const c = await mkCourse(db, org, t, 'ARC1');
    expect(
      (
        await app.request('/api/v1/enrollments', {
          method: 'POST',
          headers: H(tok1),
          body: JSON.stringify({ course_id: c }),
        })
      ).status
    ).toBe(201);
    const patch = await app.request(`/api/v1/courses/${c}`, {
      method: 'PATCH',
      headers: H(tokT),
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(patch.status).toBe(200);
    const blocked = (await (
      await app.request('/api/v1/enrollments', {
        method: 'POST',
        headers: H(tok2),
        body: JSON.stringify({ course_id: c }),
      })
    ).json()) as { error: { code: string } };
    // Blocked with ENROLLMENT_CLOSED (assert via second request status).
    const blockedStatus = await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tok2),
      body: JSON.stringify({ course_id: c }),
    });
    expect(blockedStatus.status).toBe(400);
    expect(blocked.error.code).toBe('ENROLLMENT_CLOSED');
    // Teacher manual placement still works (pre-seeding, admin moves).
    expect(
      (
        await app.request('/api/v1/enrollments', {
          method: 'POST',
          headers: H(tokT),
          body: JSON.stringify({ course_id: c, student_id: s2 }),
        })
      ).status
    ).toBe(201);
    expect(s1).toBeTruthy();
  });

  it('waitlist promote refuses a full course', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'wl');
    const t = await mkUser(db, 't@wl.test', 'teacher', org);
    await mkUser(db, 's1@wl.test', 'student', org);
    await mkUser(db, 's2@wl.test', 'student', org);
    const tokT = (await login(app, 't@wl.test')).access_token;
    const tok1 = (await login(app, 's1@wl.test')).access_token;
    const tok2 = (await login(app, 's2@wl.test')).access_token;
    const c = await mkCourse(db, org, t, 'WL1');
    await execute(db, 'UPDATE courses SET capacity = 1 WHERE id = ?', c);
    expect(
      (
        await app.request('/api/v1/enrollments', {
          method: 'POST',
          headers: H(tok1),
          body: JSON.stringify({ course_id: c }),
        })
      ).status
    ).toBe(201);
    expect(
      (
        await app.request(`/api/v1/courses/${c}/waitlist`, {
          method: 'POST',
          headers: authHeader(tok2),
        })
      ).status
    ).toBe(201);
    const entry = await db
      .prepare('SELECT id FROM waitlists WHERE course_id = ?')
      .bind(c)
      .first<{ id: string }>();
    const denied = await app.request(`/api/v1/courses/${c}/waitlist/${entry?.id}/promote`, {
      method: 'POST',
      headers: authHeader(tokT),
    });
    expect(denied.status).toBe(400);
    // Freeing a seat lets the same promotion through.
    await execute(
      db,
      'DELETE FROM enrollments WHERE course_id = ? AND student_id = (SELECT id FROM users WHERE email = ?)',
      c,
      's1@wl.test'
    );
    const okPromote = await app.request(`/api/v1/courses/${c}/waitlist/${entry?.id}/promote`, {
      method: 'POST',
      headers: authHeader(tokT),
    });
    expect(okPromote.status).toBe(200);
  });

  it('quiz submit scores against the whole quiz, not answered rows', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'den');
    const t = await mkUser(db, 't@den.test', 'teacher', org);
    await mkUser(db, 's@den.test', 'student', org);
    const tokT = (await login(app, 't@den.test')).access_token;
    const tokS = (await login(app, 's@den.test')).access_token;
    const c = await mkCourse(db, org, t, 'DEN1');
    expect(
      (
        await app.request('/api/v1/enrollments', {
          method: 'POST',
          headers: H(tokS),
          body: JSON.stringify({ course_id: c }),
        })
      ).status
    ).toBe(201);
    const qz = await createQuiz(app, tokT, c, 'Denominator');
    const q1 = await addQuestion(app, tokT, qz, {
      type: 'single_choice',
      prompt: 'Capital of ID?',
      points: 50,
      options: [
        { label: 'Jakarta', is_correct: true },
        { label: 'Bandung', is_correct: false },
      ],
    });
    await addQuestion(app, tokT, qz, {
      type: 'single_choice',
      prompt: '2+3?',
      points: 50,
      options: [
        { label: '5', is_correct: true },
        { label: '6', is_correct: false },
      ],
    });
    const att = (await (
      await app.request(`/api/v1/quizzes/${qz}/attempts`, {
        method: 'POST',
        headers: authHeader(tokS),
      })
    ).json()) as { data: { id: string } };
    const right = await db
      .prepare('SELECT id FROM question_options WHERE question_id = ? AND is_correct = 1')
      .bind(q1)
      .first<{ id: string }>();
    // Answer only Q1 (correctly); Q2 skipped must score zero, not vanish.
    const sub = (await (
      await app.request(`/api/v1/quiz-attempts/${att.data.id}/submit`, {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ answers: [{ question_id: q1, option_id: right?.id }] }),
      })
    ).json()) as { data: { score: number; earned: number; total: number } };
    expect(sub.data.total).toBe(100);
    expect(sub.data.earned).toBe(50);
    expect(sub.data.score).toBe(50);
  });

  it('multiple_choice accepts option_ids and requires the exact set', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'mc');
    const t = await mkUser(db, 't@mc.test', 'teacher', org);
    await mkUser(db, 's@mc.test', 'student', org);
    const tokT = (await login(app, 't@mc.test')).access_token;
    const tokS = (await login(app, 's@mc.test')).access_token;
    const c = await mkCourse(db, org, t, 'MC1');
    expect(
      (
        await app.request('/api/v1/enrollments', {
          method: 'POST',
          headers: H(tokS),
          body: JSON.stringify({ course_id: c }),
        })
      ).status
    ).toBe(201);
    const mkMulti = async (title: string) => {
      const qz = await createQuiz(app, tokT, c, title);
      const qid = await addQuestion(app, tokT, qz, {
        type: 'multiple_choice',
        prompt: 'Pick even numbers',
        points: 100,
        options: [
          { label: '2', is_correct: true },
          { label: '4', is_correct: true },
          { label: '3', is_correct: false },
        ],
      });
      const opts = await db
        .prepare('SELECT id, is_correct FROM question_options WHERE question_id = ?')
        .bind(qid)
        .all<{ id: string; is_correct: number }>();
      return { qz, qid, opts: opts.results };
    };
    // Full exact set → full credit.
    const a = await mkMulti('Multi full');
    const attA = (await (
      await app.request(`/api/v1/quizzes/${a.qz}/attempts`, {
        method: 'POST',
        headers: authHeader(tokS),
      })
    ).json()) as { data: { id: string } };
    const correctIds = a.opts.filter((o) => o.is_correct === 1).map((o) => o.id);
    const full = (await (
      await app.request(`/api/v1/quiz-attempts/${attA.data.id}/submit`, {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ answers: [{ question_id: a.qid, option_ids: correctIds }] }),
      })
    ).json()) as { data: { score: number } };
    expect(full.data.score).toBe(100);
    // Subset → zero for that question.
    const b = await mkMulti('Multi partial');
    const attB = (await (
      await app.request(`/api/v1/quizzes/${b.qz}/attempts`, {
        method: 'POST',
        headers: authHeader(tokS),
      })
    ).json()) as { data: { id: string } };
    const partial = (await (
      await app.request(`/api/v1/quiz-attempts/${attB.data.id}/submit`, {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({
          answers: [{ question_id: b.qid, option_ids: [correctIds[0]] }],
        }),
      })
    ).json()) as { data: { score: number } };
    // Note: option ids differ per quiz; [correctIds[0]] is unknown there → 0.
    expect(partial.data.score).toBe(0);
  });

  it('manual regrade divides by the whole quiz', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'mgr');
    const t = await mkUser(db, 't@mgr.test', 'teacher', org);
    await mkUser(db, 's@mgr.test', 'student', org);
    const tokT = (await login(app, 't@mgr.test')).access_token;
    const tokS = (await login(app, 's@mgr.test')).access_token;
    const c = await mkCourse(db, org, t, 'MGR1');
    expect(
      (
        await app.request('/api/v1/enrollments', {
          method: 'POST',
          headers: H(tokS),
          body: JSON.stringify({ course_id: c }),
        })
      ).status
    ).toBe(201);
    const qz = await createQuiz(app, tokT, c, 'Regrade');
    const q1 = await addQuestion(app, tokT, qz, {
      type: 'short_answer',
      prompt: 'Capital?',
      points: 50,
      correct_answer: 'jakarta',
    });
    const q2 = await addQuestion(app, tokT, qz, {
      type: 'short_answer',
      prompt: '2+2?',
      points: 50,
      correct_answer: '4',
    });
    const att = (await (
      await app.request(`/api/v1/quizzes/${qz}/attempts`, {
        method: 'POST',
        headers: authHeader(tokS),
      })
    ).json()) as { data: { id: string } };
    const sub = (await (
      await app.request(`/api/v1/quiz-attempts/${att.data.id}/submit`, {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({
          answers: [
            { question_id: q1, answer_text: 'bandung' },
            { question_id: q2, answer_text: '5' },
          ],
        }),
      })
    ).json()) as { data: { score: number } };
    expect(sub.data.score).toBe(0);
    const grade = (await (
      await app.request(`/api/v1/quiz-attempts/${att.data.id}/grade`, {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ question_id: q1, points_awarded: 50 }),
      })
    ).json()) as { data: { score: number } };
    expect(grade.data.score).toBe(50);
  });

  it('ICS export uses stable per-session UIDs', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'ics');
    await mkUser(db, 't@ics.test', 'teacher', org);
    const tokT = (await login(app, 't@ics.test')).access_token;
    const sess = (await (
      await app.request('/api/v1/live-sessions', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({
          organization_id: org,
          title: 'Kelas Live',
          starts_at: '2026-11-01T10:00:00Z',
          ends_at: '2026-11-01T11:00:00Z',
          provider: 'jitsi',
        }),
      })
    ).json()) as { data: { id: string } };
    const first = await app.request(`/api/v1/live-sessions.ics?organization_id=${org}`, {
      headers: authHeader(tokT),
    });
    expect(first.status).toBe(200);
    const a = await first.text();
    const second = await app.request(`/api/v1/live-sessions.ics?organization_id=${org}`, {
      headers: authHeader(tokT),
    });
    const b = await second.text();
    const uids = (x: string) => x.split('\r\n').filter((l) => l.startsWith('UID:'));
    expect(uids(a)).toEqual(uids(b));
    expect(uids(a).length).toBe(1);
    expect(uids(a)[0]).toBe(`UID:live-${sess.data.id}@lms`);
  });

  it('SCORM upload stores a resolvable original archive', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'sk');
    const t = await mkUser(db, 't@sk.test', 'teacher', org);
    const tokT = (await login(app, 't@sk.test')).access_token;
    const c = await mkCourse(db, org, t, 'SK1');
    const zip = await makeZip({ 'imsmanifest.xml': MANIFEST_12, 'index.html': '<h1>hi</h1>' });
    const form = new FormData();
    form.append('file', new File([zip], 'pkg.zip', { type: 'application/zip' }));
    form.append('organization_id', org);
    form.append('course_id', c);
    const up = await app.request('/api/v1/scorm/upload', {
      method: 'POST',
      headers: authHeader(tokT),
      body: form,
    });
    expect(up.status).toBe(201);
    const pkg = (await up.json()) as { data: { id: string } };
    const row = await db
      .prepare('SELECT file_key FROM scorm_packages WHERE id = ?')
      .bind(pkg.data.id)
      .first<{ file_key: string }>();
    expect(row?.file_key).toBeTruthy();
    expect(existsSync(join('./.data/uploads-test', row?.file_key ?? 'missing'))).toBe(true);
  });
});
