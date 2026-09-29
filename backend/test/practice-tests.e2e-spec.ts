import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';
import { MockTestsService } from '../src/mock-tests/mock-tests.service.js';

// Practice tests for any direction (here math): the center builds one from a
// template, a student of that direction sits it section by section, the
// questions are scored at once and writing tasks by the AI or the teacher.
// With AI on, a student can have a practice set made for them.
describe('Practice tests for every direction (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  let math: string;
  let english: string;

  async function studentIn(groupId: string, n: number) {
    const phone = `+99893${String(suffix + n).slice(-7)}`;
    const kid = (await http().post('/api/students').set(auth()).send({ fullName: `Practice Kid ${n}`, phone }).expect(201)).body.id as string;
    await http().post(`/api/students/${kid}/enroll/${groupId}`).set(auth()).expect(201);
    const { pin } = (await http().post(`/api/students/${kid}/portal-pin`).set(auth()).expect(201)).body;
    const token = (await http().post('/api/portal/auth/phone/verify').send({ phone, pin }).expect(201)).body.accessToken as string;
    return { kid, s: { Authorization: `Bearer ${token}` } };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `Practice ${suffix}`, subdomain: `practice-${suffix}`, email: `practice-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
    math = (await http().post('/api/groups').set(auth()).send({ name: 'Math A', subject: 'Matematika', level: 'Boshlang\'ich' }).expect(201)).body.id;
    english = (await http().post('/api/groups').set(auth()).send({ name: 'IELTS 6', subject: 'Ingliz tili' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('builds a math practice test and lets a math student sit it', async () => {
    const created = (await http().post('/api/mock-tests').set(auth()).send({ kind: 'PRACTICE', subject: 'Matematika' }).expect(201)).body;
    expect(created).toMatchObject({ kind: 'PRACTICE', title: 'Math practice' });
    expect(created.content.sections.map((s: { title: string }) => s.title)).toEqual(['Part A — without calculator', 'Part B — problems']);
    // Nothing to answer yet: cannot publish.
    await http().patch(`/api/mock-tests/${created.id}`).set(auth()).send({ status: 'PUBLISHED' }).expect(400);
    const content = {
      sections: [
        { title: 'Arithmetic', durationMin: 10, parts: [{ title: 'Questions', questions: [
          { type: 'SHORT_ANSWER', prompt: '12 x 12 = ?', correctAnswer: '144' },
          { type: 'MCQ', prompt: '√81 = ?', options: ['7', '8', '9'], correctAnswer: 'C' },
        ] }] },
        { title: 'Explain', durationMin: 15, tasks: [{ title: 'Task', prompt: 'Explain how to find 15% of 80.', minWords: 20 }] },
      ],
    };
    await http().patch(`/api/mock-tests/${created.id}`).set(auth()).send({ content, status: 'PUBLISHED' }).expect(200);
    const list = (await http().get('/api/mock-tests').set(auth()).expect(200)).body;
    expect(list.find((t: { id: string }) => t.id === created.id).summary).toEqual({ sections: 2, questions: 2, tasks: 1 });

    const { s } = await studentIn(math, 1);
    const other = await studentIn(english, 2);
    const mine = (await http().get('/api/portal/mock-tests').set(s).expect(200)).body;
    const dir = mine.directions.find((d: { subject: string }) => d.subject === 'Matematika');
    expect(dir.template).toBe('MATH');
    expect(dir.tests[0]).toMatchObject({ id: created.id, kind: 'PRACTICE', open: true, practice: [{ key: 's0', questions: 2, tasks: 0 }, { key: 's1', questions: 0, tasks: 1 }] });
    const theirs = (await http().get('/api/portal/mock-tests').set(other.s).expect(200)).body;
    expect(theirs.directions.flatMap((d: { tests: Array<{ id: string }> }) => d.tests.map((t) => t.id))).not.toContain(created.id);

    const att = (await http().post(`/api/portal/mock-tests/${created.id}/start`).set(s).expect(201)).body;
    expect(JSON.stringify(att.test)).not.toContain('correctAnswer');
    expect(att.test.content.sections[0].parts[0].questions[1]).toMatchObject({ id: '1', no: 2 });
    const base = `/api/portal/mock-tests/attempts/${att.id}`;
    await http().post(`${base}/sections/listening/start`).set(s).expect(400);
    await http().post(`${base}/sections/s0/start`).set(s).expect(201);
    await http().post(`${base}/sections/s0/answers`).set(s).send({ answers: { 0: '144' } }).expect(201);
    let res = (await http().post(`${base}/sections/s0/submit`).set(s).send({ answers: { 0: '144', 1: 'A' } }).expect(201)).body;
    expect(res.results.s0).toMatchObject({ status: 'DONE', raw: 1, max: 2, percent: 50, marks: [true, false] });
    expect(res.keys.s0).toEqual(['144', '9']);
    await http().post(`${base}/sections/s0/answers`).set(s).send({ answers: { 0: 'x' } }).expect(409);

    // No AI in the center: the teacher scores the task.
    res = (await http().post(`${base}/sections/s1/submit`).set(s).send({ answers: { t0: 'Divide 80 by 100 and multiply by 15, which gives 12 as the answer.' } }).expect(201)).body;
    expect(res.status).toBe('COMPLETED');
    expect(res.results.s1).toMatchObject({ status: 'REVIEW', percent: null, tasks: [{ score: null, words: 14 }] });
    expect(res.results.overallPercent).toBeNull();
    await http().post(`/api/mock-tests/attempts/${att.id}/review`).set(auth()).send({ section: 'writing', band: 6 }).expect(400);
    const detail = (await http().post(`/api/mock-tests/attempts/${att.id}/review-practice`).set(auth()).send({ section: 's1', scores: [8], comment: 'Clear' }).expect(201)).body;
    expect(detail.results.s1).toMatchObject({ status: 'DONE', raw: 8, max: 10, percent: 80, gradedBy: 'TEACHER', teacherComment: 'Clear' });
    expect(detail.results.overallPercent).toBe(75); // 9 of 12
  });

  it('marks tasks with the AI and makes practice sets for the student', async () => {
    const { s } = await studentIn(math, 3);
    // AI off: no generated sets.
    await http().post('/api/portal/mock-tests/generate').set(s).send({ subject: 'Matematika' }).expect(409);

    const ai = app.get(AiService);
    Object.defineProperty(ai, 'isConfigured', { get: () => true, configurable: true });
    ai.gradeEssay = async () => ({ score: 6, comment: 'Yaxshi, lekin misol kerak' });
    ai.generateExamQuestions = async () => [
      { type: 'SHORT_ANSWER', prompt: '7 + 8 = ?', correctAnswer: '15', points: 1 },
      { type: 'MCQ', prompt: '10 / 2 = ?', options: [{ id: 'A', text: '5' }, { id: 'B', text: '2' }], correctAnswer: 'A', points: 1 },
    ];
    try {
      const test = (await http().post('/api/mock-tests').set(auth()).send({ kind: 'PRACTICE', subject: 'Matematika', content: { sections: [{ title: 'Write', tasks: [{ prompt: 'Describe a triangle.' }] }] } }).expect(201)).body;
      await http().patch(`/api/mock-tests/${test.id}`).set(auth()).send({ status: 'PUBLISHED' }).expect(200);
      const att = (await http().post(`/api/portal/mock-tests/${test.id}/start`).set(s).expect(201)).body;
      const base = `/api/portal/mock-tests/attempts/${att.id}`;
      const res = (await http().post(`${base}/sections/s0/submit`).set(s).send({ answers: { t0: 'A triangle has three sides and three angles that add up to 180.' } }).expect(201)).body;
      expect(res.results.s0.status).toBe('PENDING');
      await app.get(MockTestsService).gradePracticeWithAi(att.id, 's0');
      const after = (await http().get(base).set(s).expect(200)).body;
      expect(after.results.s0).toMatchObject({ status: 'DONE', percent: 60, gradedBy: 'AI', tasks: [{ score: 6, comment: 'Yaxshi, lekin misol kerak' }] });
      expect(after.results.overallPercent).toBe(60);

      // Not their direction: refused. Their direction: a new set, started.
      await http().post('/api/portal/mock-tests/generate').set(s).send({ subject: 'Kimyo' }).expect(400);
      const made = (await http().post('/api/portal/mock-tests/generate').set(s).send({ subject: 'Matematika', topic: 'Kasrlar' }).expect(201)).body;
      expect(made).toMatchObject({ status: 'IN_PROGRESS', test: { kind: 'PRACTICE', title: 'AI: Kasrlar', subject: 'Matematika' } });
      expect(made.test.content.sections[0].parts[0].questions).toHaveLength(2);
      const list = (await http().get('/api/portal/mock-tests').set(s).expect(200)).body;
      const mineTests = list.directions.find((d: { subject: string }) => d.subject === 'Matematika').tests;
      expect(mineTests.at(-1)).toMatchObject({ id: made.test.id, mine: true });
      expect(list.aiPractice).toMatchObject({ limit: 5, used: 1, left: 4 });
      // Nobody else sees it: not another student, not the staff list.
      const other = await studentIn(math, 4);
      const theirs = (await http().get('/api/portal/mock-tests').set(other.s).expect(200)).body;
      expect(theirs.directions.flatMap((d: { tests: Array<{ id: string }> }) => d.tests.map((t) => t.id))).not.toContain(made.test.id);
      await http().post(`/api/portal/mock-tests/${made.test.id}/start`).set(other.s).expect(404);
      const staff = (await http().get('/api/mock-tests').set(auth()).expect(200)).body;
      expect(staff.map((t: { id: string }) => t.id)).not.toContain(made.test.id);
    } finally {
      delete (ai as unknown as Record<string, unknown>).isConfigured;
      delete (ai as unknown as Record<string, unknown>).gradeEssay;
      delete (ai as unknown as Record<string, unknown>).generateExamQuestions;
    }
  });
});
