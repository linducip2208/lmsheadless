import { describe, it, expect } from 'vitest';
import { execute, queryFirst } from '../src/db.js';
import { setup, mkOrg, mkUser, login, mkCourse, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

describe('advanced authoring', () => {
  it('tags, prerequisites, drip, waitlist, duplicate, versions, export, notes, approvals', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'adv');
    const t = await mkUser(db, 't@adv.com', 'teacher', org);
    await mkUser(db, 'adm@adv.com', 'organization_admin', org);
    const s = await mkUser(db, 's@adv.com', 'student', org);
    const tokT = (await login(app, 't@adv.com')).access_token;
    const tokA = (await login(app, 'adm@adv.com')).access_token;
    const tokS = (await login(app, 's@adv.com')).access_token;
    // tags
    const tag = (await (
      await app.request('/api/v1/course-tags', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ organization_id: org, name: 'Programming' }),
      })
    ).json()) as { data: { id: string } };
    const c1 = await mkCourse(db, org, t, 'ADV1');
    const c2 = await mkCourse(db, org, t, 'ADV2');
    const linkTags = await app.request(`/api/v1/courses/${c1}/tags`, {
      method: 'PUT',
      headers: H(tokT),
      body: JSON.stringify({ tag_ids: [tag.data.id] }),
    });
    expect(linkTags.status).toBe(200);
    // prerequisites: enroll blocked until c1 completed
    await app.request(`/api/v1/courses/${c2}/prerequisites`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ requires_course_id: c1 }),
    });
    expect(
      (await app.request(`/api/v1/courses/${c2}/prerequisites`, { headers: authHeader(tokS) }))
        .status
    ).toBe(200);
    const blocked = await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: c2 }),
    });
    expect(blocked.status).toBe(400);
    // self-prerequisite rejected
    const selfPre = await app.request(`/api/v1/courses/${c1}/prerequisites`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ requires_course_id: c1 }),
    });
    expect(selfPre.status).toBe(400);
    // complete c1 via enrollment + lesson
    await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: c1 }),
    });
    await execute(
      db,
      "UPDATE enrollments SET status = 'completed' WHERE course_id = ? AND student_id = (SELECT id FROM users WHERE email = ?)",
      c1,
      's@adv.com'
    );
    const nowOk = await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: c2 }),
    });
    expect(nowOk.status).toBe(201);
    // drip: lesson locked until 30 days after enrollment
    const sec = (await (
      await app.request(`/api/v1/courses/${c2}/sections`, {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ title: 'S' }),
      })
    ).json()) as { data: { id: string } };
    const les = (await (
      await app.request(`/api/v1/courses/sections/${sec.data.id}/lessons`, {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ title: 'L', content_type: 'text', body: 'x' }),
      })
    ).json()) as { data: { id: string } };
    await app.request(`/api/v1/courses/${c2}/drip`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ lesson_id: les.data.id, days_after_enrollment: 30 }),
    });
    const locked = await app.request(`/api/v1/lessons/${les.data.id}/complete`, {
      method: 'POST',
      headers: authHeader(tokS),
    });
    expect(locked.status).toBe(400);
    // waitlist join + promote
    const join = await app.request(`/api/v1/courses/${c2}/waitlist`, {
      method: 'POST',
      headers: authHeader(tokT),
    });
    expect(join.status).toBe(201);
    const wl = (await (
      await app.request(`/api/v1/courses/${c2}/waitlist`, { headers: authHeader(tokT) })
    ).json()) as { data: { id: string; student_id: string }[] };
    const promo = await app.request(`/api/v1/courses/${c2}/waitlist/${wl.data[0].id}/promote`, {
      method: 'POST',
      headers: authHeader(tokT),
    });
    expect(promo.status).toBe(200);
    // duplicate + versions
    const dup = (await (
      await app.request(`/api/v1/courses/${c1}/duplicate`, {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ code: 'ADV1X', title: 'Copy' }),
      })
    ).json()) as { data: { id: string } };
    expect(dup.data.id).toBeDefined();
    const vers = await app.request(`/api/v1/courses/${c1}/versions`, {
      method: 'POST',
      headers: authHeader(tokT),
    });
    expect(vers.status).toBe(201);
    const vlist = (await (
      await app.request(`/api/v1/courses/${c1}/versions`, { headers: authHeader(tokT) })
    ).json()) as { data: unknown[] };
    expect(vlist.data.length).toBeGreaterThan(0);
    // export CSV
    const exp = await app.request(`/api/v1/courses/export?organization_id=${org}`, {
      headers: authHeader(tokA),
    });
    expect(exp.status).toBe(200);
    expect(exp.headers.get('content-type')).toContain('text/csv');
    // instructor notes private
    const note = await app.request(`/api/v1/lessons/${les.data.id}/notes`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ body: 'Teach slowly' }),
    });
    expect(note.status).toBe(201);
    const noteDeny = await app.request(`/api/v1/lessons/${les.data.id}/notes`, {
      headers: authHeader(tokS),
    });
    expect(noteDeny.status).toBe(403);
    // approval workflow
    await app.request(`/api/v1/organizations/${org}`, {
      method: 'PUT',
      headers: H(tokA),
      body: JSON.stringify({ settings: { require_approval: 'true' } }),
    });
    const c3 = await mkCourse(db, org, t, 'ADV3');
    const pubReq = (await (
      await app.request(`/api/v1/courses/${c3}`, {
        method: 'PATCH',
        headers: H(tokT),
        body: JSON.stringify({ status: 'published' }),
      })
    ).json()) as { data: { pending_approval: boolean } };
    expect(pubReq.data.pending_approval).toBe(true);
    const queue = (await (
      await app.request(`/api/v1/publish-approvals?organization_id=${org}`, {
        headers: authHeader(tokA),
      })
    ).json()) as { data: { id: string }[] };
    expect(queue.data.length).toBeGreaterThan(0);
    const appr = await app.request(`/api/v1/publish-approvals/${queue.data[0].id}/approve`, {
      method: 'POST',
      headers: authHeader(tokA),
    });
    expect(appr.status).toBe(200);
    const c3row = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM courses WHERE id = ?',
      c3
    );
    expect(c3row?.status).toBe('published');
    // publish-due
    await execute(
      db,
      "UPDATE courses SET status = 'draft', publish_at = ? WHERE id = ?",
      new Date(Date.now() - 1000).toISOString(),
      c1
    );
    const due = (await (
      await app.request(`/api/v1/courses/publish-due?organization_id=${org}`, {
        method: 'POST',
        headers: authHeader(tokA),
      })
    ).json()) as { data: { published: number } };
    expect(due.data.published).toBeGreaterThan(0);
    void s;
  });

  it('capacity enforcement suggests waitlist', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'cap');
    const t = await mkUser(db, 't@cap.com', 'teacher', org);
    await mkUser(db, 's1@cap.com', 'student', org);
    await mkUser(db, 's2@cap.com', 'student', org);
    const tokT = (await login(app, 't@cap.com')).access_token;
    const c = await mkCourse(db, org, t, 'CAP1');
    await execute(db, 'UPDATE courses SET capacity = 1 WHERE id = ?', c);
    const e1 = await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeader((await login(app, 's1@cap.com')).access_token),
      },
      body: JSON.stringify({ course_id: c }),
    });
    expect(e1.status).toBe(201);
    const e2 = (await (
      await app.request('/api/v1/enrollments', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...authHeader((await login(app, 's2@cap.com')).access_token),
        },
        body: JSON.stringify({ course_id: c }),
      })
    ).json()) as { success: boolean; error: { code: string } };
    expect(e2.success).toBe(false);
    expect(e2.error.code).toBe('COURSE_FULL');
    void tokT;
  });
});

describe('question banks', () => {
  it('banks, pool snapshots, autosave, cooldown, negative marking, essay review, release policy', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'bank');
    const t = await mkUser(db, 't@bank.com', 'teacher', org);
    await mkUser(db, 's@bank.com', 'student', org);
    const tokT = (await login(app, 't@bank.com')).access_token;
    const tokS = (await login(app, 's@bank.com')).access_token;
    const H = { 'content-type': 'application/json', ...authHeader(tokT) };
    const c = await mkCourse(db, org, t, 'B1');
    const bank = (await (
      await app.request('/api/v1/question-banks', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ organization_id: org, name: 'Math bank' }),
      })
    ).json()) as { data: { id: string } };
    const bq = (await (
      await app.request(`/api/v1/question-banks/${bank.data.id}/questions`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
          type: 'matching',
          prompt: 'Match',
          points: 100,
          options: [
            { label: '2+2', match_value: '4', is_correct: false },
            { label: '3+3', match_value: '6', is_correct: false },
          ],
        }),
      })
    ).json()) as { data: { id: string } };
    // invalid matching (missing match_value) rejected
    const badMatch = await app.request(`/api/v1/question-banks/${bank.data.id}/questions`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        type: 'matching',
        prompt: 'Bad',
        points: 10,
        options: [{ label: 'a', is_correct: false }],
      }),
    });
    expect(badMatch.status).toBe(400);
    const q = (await (
      await app.request('/api/v1/quizzes', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
          course_id: c,
          title: 'Banked',
          passing_score: 50,
          cooldown_minutes: 60,
          answer_release: 'never',
          negative_marking: true,
        }),
      })
    ).json()) as { data: { id: string } };
    const cp = await app.request(
      `/api/v1/question-banks/${bank.data.id}/questions/${bq.data.id}/copy-to/${q.data.id}`,
      { method: 'POST', headers: authHeader(tokT) }
    );
    expect(cp.status).toBe(201);
    const pool = await app.request(`/api/v1/quizzes/${q.data.id}/pools`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ bank_id: bank.data.id, pick_count: 2 }),
    });
    expect(pool.status).toBe(201);
    // essay question with negative marking sibling
    const essay = (await (
      await app.request(`/api/v1/quizzes/${q.data.id}/questions`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ type: 'essay', prompt: 'Explain', points: 50 }),
      })
    ).json()) as { data: { id: string } };
    const neg = (await (
      await app.request(`/api/v1/quizzes/${q.data.id}/questions`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
          type: 'true_false',
          prompt: '1==1?',
          points: 50,
          correct_answer: 'true',
          negative_points: 10,
        }),
      })
    ).json()) as { data: { id: string } };
    // attempt start snapshots pool (adds 1 more matching question)
    const att = (await (
      await app.request(`/api/v1/quizzes/${q.data.id}/attempts`, {
        method: 'POST',
        headers: authHeader(tokS),
      })
    ).json()) as { data: { id: string } };
    const qs = (await (
      await app.request(`/api/v1/quizzes/${q.data.id}/questions`, { headers: authHeader(tokS) })
    ).json()) as { data: { id: string; type: string }[] };
    expect(qs.data.length).toBeGreaterThanOrEqual(4);
    // autosave + recovery
    const save = await app.request(`/api/v1/quiz-attempts/${att.data.id}/autosave`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeader(tokS) },
      body: JSON.stringify({ question_id: essay.data.id, payload: { draft: 'partial' } }),
    });
    expect(save.status).toBe(200);
    const rec = await app.request(`/api/v1/quiz-attempts/${att.data.id}/autosave`, {
      headers: authHeader(tokS),
    });
    expect(rec.status).toBe(200);
    // submit: wrong true_false (negative marking applies server-side), essay pending
    const sub = (await (
      await app.request(`/api/v1/quiz-attempts/${att.data.id}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(tokS) },
        body: JSON.stringify({
          answers: [
            { question_id: neg.data.id, answer_text: 'false' },
            { question_id: essay.data.id, answer_text: 'My essay' },
          ],
        }),
      })
    ).json()) as { data: { needs_review: boolean } };
    expect(sub.data.needs_review).toBe(true);
    // answer_release=never hides the score
    expect((sub as unknown as { data: { score?: number } }).data.score).toBeUndefined();
    // manual grade releases via queue
    const queue = (await (
      await app.request(`/api/v1/grading/queue?organization_id=${org}`, {
        headers: authHeader(tokT),
      })
    ).json()) as { data: { attempts: { id: string }[] } };
    expect(queue.data.attempts.some((a) => a.id === att.data.id)).toBe(true);
    const g = await app.request(`/api/v1/quiz-attempts/${att.data.id}/grade`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ question_id: essay.data.id, points_awarded: 40 }),
    });
    expect(g.status).toBe(200);
    // cooldown blocks immediate new attempt (max attempts high enough)
    await execute(db, 'UPDATE quizzes SET max_attempts = 10 WHERE id = ?', q.data.id);
    const cool = (await (
      await app.request(`/api/v1/quizzes/${q.data.id}/attempts`, {
        method: 'POST',
        headers: authHeader(tokS),
      })
    ).json()) as { success: boolean; error: { code: string } };
    expect(cool.success).toBe(false);
    expect(cool.error.code).toBe('COOLDOWN');
  });
});

describe('cohorts + programs + competencies', () => {
  it('cohort capacity, courses, progress; program locks; competency evidence', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'coh');
    const t = await mkUser(db, 't@coh.com', 'teacher', org);
    const s = await mkUser(db, 's@coh.com', 'student', org);
    const tokT = (await login(app, 't@coh.com')).access_token;
    const tokS = (await login(app, 's@coh.com')).access_token;
    const H = { 'content-type': 'application/json', ...authHeader(tokT) };
    const c1 = await mkCourse(db, org, t, 'COH1');
    const c2 = await mkCourse(db, org, t, 'COH2');
    const cohort = (await (
      await app.request('/api/v1/cohorts', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ organization_id: org, name: 'Batch A', capacity: 1 }),
      })
    ).json()) as { data: { id: string } };
    const stu = await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM users WHERE email = ?',
      's@coh.com'
    );
    const m1 = await app.request(`/api/v1/cohorts/${cohort.data.id}/members`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ user_id: stu?.id, role: 'student' }),
    });
    expect(m1.status).toBe(201);
    const s2 = await mkUser(db, 's2@coh.com', 'student', org);
    const m2 = await app.request(`/api/v1/cohorts/${cohort.data.id}/members`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ user_id: s2 }),
    });
    expect(m2.status).toBe(400); // capacity
    await app.request(`/api/v1/cohorts/${cohort.data.id}/courses`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ course_id: c1 }),
    });
    // student sees own cohort, progress endpoint works for teacher
    const mine = (await (
      await app.request(`/api/v1/cohorts?organization_id=${org}`, { headers: authHeader(tokS) })
    ).json()) as { data: unknown[] };
    expect(mine.data.length).toBe(1);
    const prog = await app.request(`/api/v1/cohorts/${cohort.data.id}/progress`, {
      headers: authHeader(tokT),
    });
    expect(prog.status).toBe(200);
    const progDeny = await app.request(`/api/v1/cohorts/${cohort.data.id}/progress`, {
      headers: authHeader(tokS),
    });
    expect(progDeny.status).toBe(403);
    // program with prerequisite chain
    const prog2 = (await (
      await app.request('/api/v1/programs', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ organization_id: org, name: 'Path 1' }),
      })
    ).json()) as { data: { id: string } };
    await app.request(`/api/v1/programs/${prog2.data.id}/courses`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ course_id: c1, position: 0 }),
    });
    const pc1 = await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM program_courses WHERE program_id = ? AND course_id = ?',
      prog2.data.id,
      c1
    );
    await app.request(`/api/v1/programs/${prog2.data.id}/courses`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ course_id: c2, position: 1, prerequisite_program_course_id: pc1?.id }),
    });
    const view = (await (
      await app.request(`/api/v1/programs/${prog2.data.id}`, { headers: authHeader(tokS) })
    ).json()) as { data: { courses: { course_id: string; locked: boolean }[] } };
    const second = view.data.courses.find((x) => x.course_id === c2);
    expect(second?.locked).toBe(true); // c1 not completed
    // competencies
    const comp = (await (
      await app.request('/api/v1/competencies', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ organization_id: org, name: 'Algebra' }),
      })
    ).json()) as { data: { id: string } };
    const assess = await app.request(`/api/v1/competencies/${comp.data.id}/assess`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ student_id: stu?.id, status: 'achieved' }),
    });
    expect(assess.status).toBe(201);
    const ev = await app.request(
      `/api/v1/competencies/student?organization_id=${org}&student_id=${stu?.id}`,
      { headers: authHeader(tokT) }
    );
    expect(ev.status).toBe(200);
    void s;
  });
});

describe('live classes', () => {
  it('schedules with provider rules, registers with capacity, cancels with notice, ICS export', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'live');
    const t = await mkUser(db, 't@live.com', 'teacher', org);
    await mkUser(db, 's@live.com', 'student', org);
    const tokT = (await login(app, 't@live.com')).access_token;
    const tokS = (await login(app, 's@live.com')).access_token;
    const H = { 'content-type': 'application/json', ...authHeader(tokT) };
    const c = await mkCourse(db, org, t, 'LIVE1');
    // meet without URL rejected (never invent meeting links)
    const noUrl = await app.request('/api/v1/live-sessions', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        organization_id: org,
        course_id: c,
        title: 'M',
        starts_at: '2026-11-01T10:00:00Z',
        ends_at: '2026-11-01T11:00:00Z',
        provider: 'meet',
      }),
    });
    expect(noUrl.status).toBe(400);
    // bad time range rejected
    const badTime = await app.request('/api/v1/live-sessions', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        organization_id: org,
        title: 'B',
        starts_at: '2026-11-01T12:00:00Z',
        ends_at: '2026-11-01T11:00:00Z',
      }),
    });
    expect(badTime.status).toBe(400);
    const sess = (await (
      await app.request('/api/v1/live-sessions', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
          organization_id: org,
          course_id: c,
          title: 'Intro Live',
          starts_at: '2026-11-01T10:00:00Z',
          ends_at: '2026-11-01T11:00:00Z',
          provider: 'jitsi',
          capacity: 1,
        }),
      })
    ).json()) as { data: { id: string; meeting_url: string } };
    expect(sess.data.meeting_url).toContain('meet.jit.si');
    // student outside course cannot see (not enrolled); enroll then visible
    const before = (await (
      await app.request(`/api/v1/live-sessions?organization_id=${org}`, {
        headers: authHeader(tokS),
      })
    ).json()) as { data: unknown[] };
    expect(before.data.length).toBe(0);
    await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(tokS) },
      body: JSON.stringify({ course_id: c }),
    });
    const after = (await (
      await app.request(`/api/v1/live-sessions?organization_id=${org}`, {
        headers: authHeader(tokS),
      })
    ).json()) as { data: unknown[] };
    expect(after.data.length).toBe(1);
    const reg = await app.request(`/api/v1/live-sessions/${sess.data.id}/register`, {
      method: 'POST',
      headers: authHeader(tokS),
    });
    expect(reg.status).toBe(201);
    // capacity: second student blocked
    await mkUser(db, 's2@live.com', 'student', org);
    const tokS2 = (await login(app, 's2@live.com')).access_token;
    const full = await app.request(`/api/v1/live-sessions/${sess.data.id}/register`, {
      method: 'POST',
      headers: authHeader(tokS2),
    });
    expect(full.status).toBe(400);
    // attendance + ICS
    const stuLive = await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM users WHERE email = ?',
      's@live.com'
    );
    const atBad = await app.request(`/api/v1/live-sessions/${sess.data.id}/attendance`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ user_ids: ['no-such-user'] }),
    });
    expect(atBad.status).toBe(400);
    const at = await app.request(`/api/v1/live-sessions/${sess.data.id}/attendance`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ user_ids: [stuLive?.id] }),
    });
    expect(at.status).toBe(201);
    const ics = await app.request(`/api/v1/live-sessions.ics?organization_id=${org}`, {
      headers: authHeader(tokS),
    });
    expect(ics.status).toBe(200);
    expect((await ics.text()).includes('BEGIN:VCALENDAR')).toBe(true);
    // cancel notifies
    const cancel = await app.request(`/api/v1/live-sessions/${sess.data.id}/cancel`, {
      method: 'POST',
      headers: authHeader(tokT),
    });
    expect(cancel.status).toBe(200);
    const notifs = (await (
      await app.request('/api/v1/notifications', { headers: authHeader(tokS) })
    ).json()) as { data: { title: string }[] };
    expect(notifs.data.some((n) => n.title === 'Live session cancelled')).toBe(true);
    void t;
  });
});
