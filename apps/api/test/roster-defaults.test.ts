import { describe, expect, it } from 'vitest';
import { authHeader, login, mkCourse, mkOrg, mkUser, setup } from './helpers.js';

// Round-5 product fixes found via real-browser E2E:
// 1. New quiz questions appended at MAX(position)+1 instead of colliding on 0.
// 2. GET /grades?course_id without student_id returns the roster for
//    teaching/admin actors (students/parents keep self-or-linked).
// 3. GET /certificates without student_id (but with org) returns the org
//    roster for teaching/admin actors (students/parents keep self).
const HJ = (tok: string) => ({ 'content-type': 'application/json', ...authHeader(tok) });

describe('round-5 roster defaults + question append', () => {
  it('questions append at MAX+1 when position omitted; explicit position honored', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rd5');
    const t = await mkUser(db, 't@rd5.com', 'teacher', org);
    const tokT = (await login(app, 't@rd5.com')).access_token;
    const c = await mkCourse(db, org, t, 'RD5');
    const quiz = (await (
      await app.request('/api/v1/quizzes', {
        method: 'POST',
        headers: HJ(tokT),
        body: JSON.stringify({ course_id: c, title: 'Append Quiz', passing_score: 70 }),
      })
    ).json()) as { data: { id: string } };
    const mk = (prompt: string, extra: object = {}) =>
      app.request(`/api/v1/quizzes/${quiz.data.id}/questions`, {
        method: 'POST',
        headers: HJ(tokT),
        body: JSON.stringify({
          type: 'true_false',
          prompt,
          points: 10,
          correct_answer: 'true',
          ...extra,
        }),
      });
    expect((await mk('Q one')).status).toBe(201);
    expect((await mk('Q two')).status).toBe(201);
    const list = (await (
      await app.request(`/api/v1/quizzes/${quiz.data.id}/questions`, { headers: authHeader(tokT) })
    ).json()) as { data: { prompt: string; position: number }[] };
    const pos = (p: string) => list.data.find((q) => q.prompt === p)!.position;
    expect(pos('Q one')).toBe(0);
    expect(pos('Q two')).toBe(1);
    expect((await mk('Q pinned', { position: 9 })).status).toBe(201);
    const list2 = (await (
      await app.request(`/api/v1/quizzes/${quiz.data.id}/questions`, { headers: authHeader(tokT) })
    ).json()) as { data: { prompt: string; position: number }[] };
    expect(list2.data.find((q) => q.prompt === 'Q pinned')!.position).toBe(9);
  });

  it('grades roster: teacher sees course grades unfiltered; student still self-only', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rd5g');
    const t = await mkUser(db, 't@rd5g.com', 'teacher', org);
    await mkUser(db, 's@rd5g.com', 'student', org);
    const tokT = (await login(app, 't@rd5g.com')).access_token;
    const tokS = (await login(app, 's@rd5g.com')).access_token;
    const c = await mkCourse(db, org, t, 'RD5G');
    const stu = await (async () => {
      const r = await app.request(`/api/v1/users?q=s@rd5g.com`, { headers: authHeader(tokT) });
      return ((await r.json()) as { data: { id: string }[] }).data[0].id;
    })();
    const g = await app.request('/api/v1/grades', {
      method: 'POST',
      headers: HJ(tokT),
      body: JSON.stringify({ course_id: c, student_id: stu, score: 77, feedback: 'r5' }),
    });
    expect(g.status).toBe(201);
    const roster = await app.request(`/api/v1/grades?course_id=${c}`, {
      headers: authHeader(tokT),
    });
    expect(roster.status).toBe(200);
    expect(
      ((await roster.json()) as { data: { score: number }[] }).data.map((x) => x.score)
    ).toContain(77);
    // Student without a filter still sees only self (privacy unchanged).
    const self = await app.request(`/api/v1/grades?course_id=${c}`, {
      headers: authHeader(tokS),
    });
    expect(self.status).toBe(200);
    expect(
      ((await self.json()) as { data: { score: number }[] }).data.map((x) => x.score)
    ).toContain(77);
    const other = await mkUser(db, 'o@rd5g.com', 'student', org);
    void other;
    const cross = await app.request(`/api/v1/grades?course_id=${c}&student_id=${stu}`, {
      headers: authHeader((await login(app, 'o@rd5g.com')).access_token),
    });
    expect(cross.status).toBe(403);
  });

  it('certificates roster: admin sees org certs unfiltered; student still self-only', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rd5c');
    const t = await mkUser(db, 't@rd5c.com', 'teacher', org);
    await mkUser(db, 's@rd5c.com', 'student', org);
    const tokT = (await login(app, 't@rd5c.com')).access_token;
    const tokS = (await login(app, 's@rd5c.com')).access_token;
    const c = await mkCourse(db, org, t, 'RD5C');
    const stu = await (async () => {
      const r = await app.request(`/api/v1/users?q=s@rd5c.com`, { headers: authHeader(tokT) });
      return ((await r.json()) as { data: { id: string }[] }).data[0].id;
    })();
    const issue = await app.request('/api/v1/certificates/issue', {
      method: 'POST',
      headers: HJ(tokT),
      body: JSON.stringify({ course_id: c, student_id: stu }),
    });
    expect(issue.status).toBe(201);
    const num = ((await issue.json()) as { data: { certificate_number: string } }).data
      .certificate_number;
    const roster = await app.request(`/api/v1/certificates?organization_id=${org}`, {
      headers: authHeader(tokT),
    });
    expect(roster.status).toBe(200);
    expect(
      ((await roster.json()) as { data: { certificate_number: string }[] }).data.map(
        (x) => x.certificate_number
      )
    ).toContain(num);
    const self = await app.request(`/api/v1/certificates?organization_id=${org}`, {
      headers: authHeader(tokS),
    });
    expect(
      ((await self.json()) as { data: { certificate_number: string }[] }).data.map(
        (x) => x.certificate_number
      )
    ).toContain(num);
  });
});
