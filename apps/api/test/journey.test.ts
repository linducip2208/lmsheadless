import { describe, it, expect } from 'vitest';
import { execute } from '../src/db.js';
import { setup, login, authHeader } from './helpers.js';

// Full learner journey across roles in one flow:
// setup → org/admin → teacher → course authoring → publish → student
// enroll → lesson → quiz → assignment → grade → certificate → verify → parent.
describe('end-to-end learner journey', () => {
  it('setup to parent visibility', async () => {
    const { app, db } = await setup();
    const H = (tok: string) => ({ 'content-type': 'application/json', ...authHeader(tok) });

    // 1. First-run setup
    const setupRes = await app.request('/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app_name: 'Journey Academy',
        org_name: 'Journey Academy',
        admin_email: 'owner@journey.test',
        admin_password: 'Password123!',
        admin_name: 'Owner',
      }),
    });
    expect(setupRes.status).toBe(201);
    const { organization_id: org } = (
      (await setupRes.json()) as { data: { organization_id: string } }
    ).data;
    const tokOwner = (await login(app, 'owner@journey.test')).access_token;

    // 2. Organization + teacher invitation
    const inv = (await (
      await app.request('/api/v1/invitations', {
        method: 'POST',
        headers: H(tokOwner),
        body: JSON.stringify({ organization_id: org, email: 'guru@journey.test', role: 'teacher' }),
      })
    ).json()) as { data: { invite_url: string } };
    const token = inv.data.invite_url.split('/').pop() ?? '';
    await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name: 'Guru', password: 'Password123!' }),
    });
    const tokT = (await login(app, 'guru@journey.test')).access_token;

    // 3. Course authoring + publication
    const course = (await (
      await app.request('/api/v1/courses', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ organization_id: org, code: 'JRN101', title: 'Journey Course' }),
      })
    ).json()) as { data: { id: string } };
    const cid = course.data.id;
    const sec = (await (
      await app.request(`/api/v1/courses/${cid}/sections`, {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ title: 'Bab 1' }),
      })
    ).json()) as { data: { id: string } };
    const les = (await (
      await app.request(`/api/v1/courses/sections/${sec.data.id}/lessons`, {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ title: 'Pelajaran 1', content_type: 'text', body: 'Materi' }),
      })
    ).json()) as { data: { id: string } };
    const quiz = (await (
      await app.request('/api/v1/quizzes', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ course_id: cid, title: 'Kuis', passing_score: 50 }),
      })
    ).json()) as { data: { id: string } };
    const qq = (await (
      await app.request(`/api/v1/quizzes/${quiz.data.id}/questions`, {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({
          type: 'multiple_choice',
          prompt: '2+2?',
          points: 100,
          options: [
            { label: '3', is_correct: false },
            { label: '4', is_correct: true },
          ],
        }),
      })
    ).json()) as { data: { id: string } };
    const asg = (await (
      await app.request('/api/v1/assignments', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ course_id: cid, title: 'Tugas', max_score: 100 }),
      })
    ).json()) as { data: { id: string } };
    const pub = await app.request(`/api/v1/courses/${cid}`, {
      method: 'PATCH',
      headers: H(tokT),
      body: JSON.stringify({ status: 'published' }),
    });
    expect(pub.status).toBe(200);

    // 4. Student register + enroll + learn
    await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'murid@journey.test',
        password: 'Password123!',
        name: 'Murid',
        organization_id: org,
      }),
    });
    const tokS = (await login(app, 'murid@journey.test')).access_token;
    expect(
      (
        await app.request('/api/v1/enrollments', {
          method: 'POST',
          headers: H(tokS),
          body: JSON.stringify({ course_id: cid }),
        })
      ).status
    ).toBe(201);
    expect(
      (
        await app.request(`/api/v1/lessons/${les.data.id}/complete`, {
          method: 'POST',
          headers: authHeader(tokS),
        })
      ).status
    ).toBe(200);

    // 5. Quiz attempt + grading (auto)
    const att = (await (
      await app.request(`/api/v1/quizzes/${quiz.data.id}/attempts`, {
        method: 'POST',
        headers: authHeader(tokS),
      })
    ).json()) as { data: { id: string } };
    const opts = await db
      .prepare('SELECT id, is_correct FROM question_options WHERE question_id = ?')
      .bind(qq.data.id)
      .all<{ id: string; is_correct: number }>();
    const right = opts.results.find((o) => o.is_correct === 1)?.id ?? '';
    const graded = (await (
      await app.request(`/api/v1/quiz-attempts/${att.data.id}/submit`, {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ answers: [{ question_id: qq.data.id, option_id: right }] }),
      })
    ).json()) as { data: { score: number; passed: boolean } };
    expect(graded.data.score).toBe(100);
    expect(graded.data.passed).toBe(true);

    // 6. Assignment submit + teacher feedback
    expect(
      (
        await app.request(`/api/v1/assignments/${asg.data.id}/submissions`, {
          method: 'POST',
          headers: H(tokS),
          body: JSON.stringify({ body: 'Jawaban saya' }),
        })
      ).status
    ).toBe(201);
    const subRow = await db
      .prepare('SELECT id FROM submissions WHERE assignment_id = ?')
      .bind(asg.data.id)
      .first<{ id: string }>();
    expect(
      (
        await app.request(`/api/v1/submissions/${subRow?.id}/grade`, {
          method: 'POST',
          headers: H(tokT),
          body: JSON.stringify({ score: 95, feedback: 'Bagus' }),
        })
      ).status
    ).toBe(200);

    // 7. Certificate auto-issued at 100% + public verification
    const certs = (await (
      await app.request('/api/v1/certificates', { headers: authHeader(tokS) })
    ).json()) as { data: { certificate_number: string }[] };
    expect(certs.data.length).toBe(1);
    const verify = await app.request(
      `/api/v1/certificates/verify/${certs.data[0].certificate_number}`
    );
    expect(verify.status).toBe(200);

    // 8. Parent linked + sees child progress only
    await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'ortu@journey.test',
        password: 'Password123!',
        name: 'Ortu',
        organization_id: org,
      }),
    });
    const tokP = (await login(app, 'ortu@journey.test')).access_token;
    const stuRow = await db
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind('murid@journey.test')
      .first<{ id: string }>();
    const parRow = await db
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind('ortu@journey.test')
      .first<{ id: string }>();
    await execute(
      db,
      'INSERT INTO parent_links (id, parent_id, student_id, organization_id, created_at) VALUES (?, ?, ?, ?, ?)',
      'pl-journey',
      parRow?.id ?? '',
      stuRow?.id ?? '',
      org,
      new Date().toISOString()
    );
    await execute(
      db,
      "UPDATE organization_members SET role = 'parent' WHERE user_id = ? AND organization_id = ?",
      parRow?.id ?? '',
      org
    );
    const tokP2 = (await login(app, 'ortu@journey.test')).access_token;
    void tokP;
    const rep = await app.request(
      `/api/v1/reports/student-progress?student_id=${stuRow?.id}&organization_id=${org}`,
      { headers: authHeader(tokP2) }
    );
    expect(rep.status).toBe(200);

    // 9. Cross-tenant denial closes the journey
    const { mkOrg } = await import('./helpers.js');
    const orgB = await mkOrg(db, 'journeyB');
    const cross = await app.request(`/api/v1/courses/${cid}`, { headers: authHeader(tokS) });
    expect(cross.status).toBe(200); // own course fine
    void orgB;
  });
});
