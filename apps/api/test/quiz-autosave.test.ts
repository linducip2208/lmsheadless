import { describe, it, expect } from 'vitest';
import { setup, mkOrg, mkUser, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

async function quizFixture(
  app: ReturnType<(typeof import('../src/app.js'))['createApp']>,
  tokT: string,
  org: string,
  code: string
) {
  const course = (await (
    await app.request('/api/v1/courses', {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ organization_id: org, code, title: code }),
    })
  ).json()) as { data: { id: string } };
  const quiz = (await (
    await app.request('/api/v1/quizzes', {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ course_id: course.data.id, title: 'Q', passing_score: 50 }),
    })
  ).json()) as { data: { id: string } };
  const q = (await (
    await app.request(`/api/v1/quizzes/${quiz.data.id}/questions`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({
        type: 'short_answer',
        prompt: 'Capital?',
        points: 10,
        correct_answer: 'Jakarta',
      }),
    })
  ).json()) as { data: { id: string } };
  return { courseId: course.data.id, quizId: quiz.data.id, questionId: q.data.id };
}

describe('quiz autosave drafts', () => {
  it('saves, recovers, and clears on submit; rejects outsiders', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'save');
    await mkUser(db, 't@save.test', 'teacher', org);
    await mkUser(db, 's@save.test', 'student', org);
    await mkUser(db, 'x@save.test', 'student', org);
    const tokT = (await login(app, 't@save.test')).access_token;
    const tokS = (await login(app, 's@save.test')).access_token;
    const tokX = (await login(app, 'x@save.test')).access_token;
    const { courseId, quizId, questionId } = await quizFixture(app, tokT, org, 'SV1');
    await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: courseId }),
    });
    const att = (await (
      await app.request(`/api/v1/quizzes/${quizId}/attempts`, {
        method: 'POST',
        headers: authHeader(tokS),
      })
    ).json()) as { data: { id: string } };
    // Foreign question ids are skipped, not stored.
    const save = (await (
      await app.request(`/api/v1/quiz-attempts/${att.data.id}/autosave`, {
        method: 'PUT',
        headers: H(tokS),
        body: JSON.stringify({
          answers: [
            { question_id: questionId, payload: JSON.stringify({ text: 'Jakar' }) },
            { question_id: 'nope', payload: 'x' },
          ],
        }),
      })
    ).json()) as { data: { saved: number } };
    expect(save.data.saved).toBe(1);
    const draft = (await (
      await app.request(`/api/v1/quiz-attempts/${att.data.id}/autosave`, {
        headers: authHeader(tokS),
      })
    ).json()) as { data: { question_id: string; payload: string }[] };
    expect(draft.data.length).toBe(1);
    expect(draft.data[0].payload).toContain('Jakar');
    // Another student gets 403, not the draft.
    const peek = await app.request(`/api/v1/quiz-attempts/${att.data.id}/autosave`, {
      headers: authHeader(tokX),
    });
    expect(peek.status).toBe(403);
    // Submit clears drafts and closes the attempt: draft reads stop.
    const submit = await app.request(`/api/v1/quiz-attempts/${att.data.id}/submit`, {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ answers: [{ question_id: questionId, answer_text: 'Jakarta' }] }),
    });
    expect(submit.status).toBe(200);
    const after = await app.request(`/api/v1/quiz-attempts/${att.data.id}/autosave`, {
      headers: authHeader(tokS),
    });
    expect(after.status).toBe(400);
  });

  it('closed attempts reject autosave writes', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'save2');
    await mkUser(db, 't@save2.test', 'teacher', org);
    await mkUser(db, 's@save2.test', 'student', org);
    const tokT = (await login(app, 't@save2.test')).access_token;
    const tokS = (await login(app, 's@save2.test')).access_token;
    const { courseId, quizId, questionId } = await quizFixture(app, tokT, org, 'SV2');
    await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: courseId }),
    });
    const att = (await (
      await app.request(`/api/v1/quizzes/${quizId}/attempts`, {
        method: 'POST',
        headers: authHeader(tokS),
      })
    ).json()) as { data: { id: string } };
    await app.request(`/api/v1/quiz-attempts/${att.data.id}/submit`, {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ answers: [{ question_id: questionId, answer_text: 'Jakarta' }] }),
    });
    const late = await app.request(`/api/v1/quiz-attempts/${att.data.id}/autosave`, {
      method: 'PUT',
      headers: H(tokS),
      body: JSON.stringify({ answers: [{ question_id: questionId, payload: 'x' }] }),
    });
    expect(late.status).toBe(400);
  });
});
