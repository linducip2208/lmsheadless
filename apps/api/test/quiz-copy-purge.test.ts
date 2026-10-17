import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../src/db.js';
import { setup, mkOrg, mkUser, mkCourse, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

interface Fixture {
  org: string;
  quiz: string;
  templateQ: string;
  oldAttempt: string;
  oldCopy: string;
  freshAttempt: string;
  freshCopy: string;
  activeAttempt: string;
  activeCopy: string;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

async function seedPurgedQuiz(
  db: Awaited<ReturnType<typeof setup>>['db'],
  org: string,
  owner: string
): Promise<Fixture> {
  const course = await mkCourse(db, org, owner, `CQ${Math.random().toString(36).slice(2, 8)}`);
  const quiz = newId();
  await execute(
    db,
    'INSERT INTO quizzes (id, course_id, organization_id, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    quiz,
    course,
    org,
    'copy-purge quiz',
    owner,
    nowIso(),
    nowIso()
  );
  const templateQ = newId();
  await execute(
    db,
    'INSERT INTO questions (id, quiz_id, type, prompt, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    templateQ,
    quiz,
    'true_false',
    'template question (pool template must survive)',
    0,
    nowIso(),
    nowIso()
  );
  const mk = async (
    attemptId: string,
    ageDays: number | null,
    status: 'in_progress' | 'submitted',
    stalenessDays: number
  ) => {
    const started = daysAgo(stalenessDays + 1);
    const submitted = ageDays === null ? null : daysAgo(ageDays);
    await execute(
      db,
      'INSERT INTO quiz_attempts (id, quiz_id, student_id, status, started_at, submitted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      attemptId,
      quiz,
      owner,
      status,
      started,
      submitted,
      started,
      started
    );
    const copy = newId();
    await execute(
      db,
      'INSERT INTO questions (id, quiz_id, attempt_id, type, prompt, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      copy,
      quiz,
      attemptId,
      'true_false',
      `copy for ${attemptId}`,
      0,
      started,
      started
    );
    await execute(
      db,
      'INSERT INTO quiz_answers (id, attempt_id, question_id, answer_text, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      attemptId,
      copy,
      'a',
      started
    );
    return copy;
  };
  const oldAttempt = newId(); // finished long ago → purge target
  const oldCopy = await mk(oldAttempt, 30, 'submitted', 35);
  const freshAttempt = newId(); // finished recently → keep
  const freshCopy = await mk(freshAttempt, 1, 'submitted', 1);
  const activeAttempt = newId(); // still in progress → keep
  const activeCopy = await mk(activeAttempt, null, 'in_progress', 30);
  return {
    org,
    quiz,
    templateQ,
    oldAttempt,
    oldCopy,
    freshAttempt,
    freshCopy,
    activeAttempt,
    activeCopy,
  };
}

const state = async (db: Awaited<ReturnType<typeof setup>>['db'], f: Fixture) => ({
  template: await queryFirst(db, 'SELECT id FROM questions WHERE id = ?', f.templateQ),
  fresh: await queryFirst(db, 'SELECT id FROM questions WHERE id = ?', f.freshCopy),
  active: await queryFirst(db, 'SELECT id FROM questions WHERE id = ?', f.activeCopy),
  oldOrphans: await queryAll(db, 'SELECT id FROM quiz_answers WHERE attempt_id = ?', f.oldAttempt),
});

describe('attempt question copy purge (opt-in, finished attempts only)', () => {
  it('cron purges only opted-in orgs, only finished attempts past the window', async () => {
    const { db } = await setup();
    const opted = await mkOrg(db, 'cq-optin');
    const org2 = await mkOrg(db, 'cq-noopt');
    const t1 = await mkUser(db, 't1@cq.test', 'teacher', opted);
    const t2 = await mkUser(db, 't2@cq.test', 'teacher', org2);
    await execute(
      db,
      'UPDATE organizations SET settings = ? WHERE id = ?',
      JSON.stringify({ quiz_copy_retention_days: 7 }),
      opted
    );
    const f1 = await seedPurgedQuiz(db, opted, t1);
    const f2 = await seedPurgedQuiz(db, org2, t2); // no policy → untouched

    await worker.scheduled({ cron: '0 17 * * *' }, { DB: db });

    const a = await state(db, f1);
    expect(a.template).not.toBeNull(); // pool template survives
    expect(a.fresh).not.toBeNull(); // inside the 7-day window
    expect(a.active).not.toBeNull(); // in_progress attempt is never touched
    expect(a.oldOrphans).toEqual([]); // answer rows removed with the copy
    const oldCopy = await queryFirst(db, 'SELECT id FROM questions WHERE id = ?', f1.oldCopy);
    expect(oldCopy).toBeNull();

    const b = await state(db, f2);
    const kept2 = await queryFirst(db, 'SELECT id FROM questions WHERE id = ?', f2.oldCopy);
    expect(kept2).not.toBeNull(); // no opt-in policy → no purge, ever
    void b;

    const audits = await queryAll<{ organization_id: string }>(
      db,
      "SELECT organization_id FROM audit_logs WHERE action = 'sys.cron.quiz_copy_purge'"
    );
    expect(audits.map((r) => r.organization_id).sort()).toEqual([opted]);
  });

  it('HTTP endpoint honors explicit days, rejects ungated access, validates bounds', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'cq-http');
    const t = await mkUser(db, 't@cq.test', 'teacher', org);
    await mkUser(db, 's@cq.test', 'student', org); // row needed by FK; denials tested below
    await mkUser(db, 'a@cq.test', 'organization_admin', org); // row needed by FK for login
    const tokT = (await login(app, 't@cq.test')).access_token;
    const tokS = (await login(app, 's@cq.test')).access_token;
    const tokA = (await login(app, 'a@cq.test')).access_token;
    const f = await seedPurgedQuiz(db, org, t);

    // Students never purge.
    const deny = await app.request('/api/v1/quizzes/copies/purge', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ organization_id: org, days: 1 }),
    });
    expect(deny.status).toBe(403);

    // Teachers can teach but not run org-wide purges.
    const denyT = await app.request('/api/v1/quizzes/copies/purge', {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ organization_id: org, days: 1 }),
    });
    expect(denyT.status).toBe(403);

    // Missing policy and no explicit days → validation error.
    const bad = await app.request('/api/v1/quizzes/copies/purge', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ organization_id: org }),
    });
    expect(bad.status).toBe(400);

    // Out-of-bounds window rejected.
    const invalid = await app.request('/api/v1/quizzes/copies/purge', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ organization_id: org, days: 3651 }),
    });
    expect(invalid.status).toBe(400);

    const purge = (await (
      await app.request('/api/v1/quizzes/copies/purge', {
        method: 'POST',
        headers: H(tokA),
        body: JSON.stringify({ organization_id: org, days: 7 }),
      })
    ).json()) as { data: { copies: number; answers: number; days: number } };
    expect(purge.data.days).toBe(7);
    expect(purge.data.copies).toBeGreaterThan(0);

    const a = await state(db, f);
    expect(a.template).not.toBeNull();
    expect(a.fresh).not.toBeNull();
    expect(a.active).not.toBeNull();
    expect(a.oldOrphans).toEqual([]);

    // Audited with the real counts.
    const audits = await queryAll<{ metadata: string }>(
      db,
      "SELECT metadata FROM audit_logs WHERE action = 'quiz.copy_purge'"
    );
    expect(audits.length).toBe(1);
    expect(JSON.parse(audits[0].metadata)).toMatchObject({ days: 7 });
    expect(Number(JSON.parse(audits[0].metadata).copies)).toBe(purge.data.copies);
  });

  it('org setting seeds the default window for the endpoint fallback', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'cq-fallback');
    await mkUser(db, 'a@cqfb.test', 'organization_admin', org); // row needed by login
    const t = await mkUser(db, 't@cqfb.test', 'teacher', org);
    const tokA = (await login(app, 'a@cqfb.test')).access_token;
    const f = await seedPurgedQuiz(db, org, t);
    await execute(
      db,
      'UPDATE organizations SET settings = ? WHERE id = ?',
      JSON.stringify({ quiz_copy_retention_days: 7 }),
      org
    );
    const purge = (await (
      await app.request('/api/v1/quizzes/copies/purge', {
        method: 'POST',
        headers: H(tokA),
        body: JSON.stringify({ organization_id: org }),
      })
    ).json()) as { data: { days: number; copies: number } };
    expect(purge.data.days).toBe(7);
    const oldCopy = await queryFirst(db, 'SELECT id FROM questions WHERE id = ?', f.oldCopy);
    expect(oldCopy).toBeNull();
  });
});
