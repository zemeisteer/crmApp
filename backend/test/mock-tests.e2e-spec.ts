import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';
import { MockTestsService } from '../src/mock-tests/mock-tests.service.js';

// IELTS mock tests: the center builds and publishes a test, a student of an
// English group sits it in the cabinet section by section, Listening and
// Reading are scored at once, Writing/Speaking by the AI examiner or the
// teacher, and the overall band follows.
describe('IELTS mock tests (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  let testId: string;
  let english: string;
  let math: string;

  async function studentIn(groupId: string, n: number) {
    const phone = `+99891${String(suffix + n).slice(-7)}`;
    const kid = (await http().post('/api/students').set(auth()).send({ fullName: `Mock Kid ${n}`, phone, parentPhone: `+99892${String(suffix + n).slice(-7)}` }).expect(201)).body.id as string;
    await http().post(`/api/students/${kid}/enroll/${groupId}`).set(auth()).expect(201);
    const { pin } = (await http().post(`/api/students/${kid}/portal-pin`).set(auth()).expect(201)).body;
    const token = (await http().post('/api/portal/auth/phone/verify').send({ phone, pin }).expect(201)).body.accessToken as string;
    const parent = (await http().post('/api/portal/auth/phone/verify').send({ phone: `+99892${String(suffix + n).slice(-7)}`, pin }).expect(201)).body.accessToken as string;
    return { kid, s: { Authorization: `Bearer ${token}` }, p: { Authorization: `Bearer ${parent}` } };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `Mock ${suffix}`, subdomain: `mock-${suffix}`, email: `mock-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
    english = (await http().post('/api/groups').set(auth()).send({ name: 'IELTS 7', subject: 'Ingliz tili (IELTS)' }).expect(201)).body.id;
    math = (await http().post('/api/groups').set(auth()).send({ name: 'Math 1', subject: 'Matematika' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('builds a test from the sample and publishes it', async () => {
    const created = (await http().post('/api/mock-tests').set(auth()).send({ sample: true }).expect(201)).body;
    testId = created.id;
    expect(created.status).toBe('DRAFT');
    expect(created.content.listening.parts[0].questions[0].correctAnswer).toBe('Carter');
    const list = (await http().get('/api/mock-tests').set(auth()).expect(200)).body;
    expect(list.find((t: { id: string }) => t.id === testId).summary).toEqual({ listening: 12, reading: 8, writing: 2, speaking: 8 });
    await http().patch(`/api/mock-tests/${testId}`).set(auth()).send({ status: 'PUBLISHED' }).expect(200);
    // An empty test cannot be published.
    const empty = (await http().post('/api/mock-tests').set(auth()).send({ title: 'Empty' }).expect(201)).body.id;
    await http().patch(`/api/mock-tests/${empty}`).set(auth()).send({ status: 'PUBLISHED' }).expect(400);
  });

  it('lets a student sit all four sections; the teacher marks Writing and Speaking', async () => {
    const { s, p } = await studentIn(english, 1);
    const other = await studentIn(math, 2);

    // Only the English student sees the IELTS test.
    const mine = (await http().get('/api/portal/mock-tests').set(s).expect(200)).body;
    expect(mine.aiFeedback).toBe(false);
    expect(mine.directions[0].tests.map((t: { id: string }) => t.id)).toContain(testId);
    const theirs = (await http().get('/api/portal/mock-tests').set(other.s).expect(200)).body;
    expect(theirs.directions.flatMap((d: { tests: unknown[] }) => d.tests)).toHaveLength(0);

    await http().post(`/api/portal/mock-tests/${testId}/start`).set(p).expect(403);
    const att = (await http().post(`/api/portal/mock-tests/${testId}/start`).set(s).expect(201)).body;
    expect(JSON.stringify(att.test)).not.toContain('correctAnswer');
    // Starting again resumes the same sitting.
    expect((await http().post(`/api/portal/mock-tests/${testId}/start`).set(s).expect(201)).body.id).toBe(att.id);
    const base = `/api/portal/mock-tests/attempts/${att.id}`;

    const started = (await http().post(`${base}/sections/listening/start`).set(s).expect(201)).body;
    expect(started.sectionStarted.listening).toBeTruthy();
    await http().post(`${base}/sections/listening/answers`).set(s).send({ answers: { 0: 'carter', 1: '42' } }).expect(201);
    let res = (await http().post(`${base}/sections/listening/submit`).set(s).send({ answers: { 0: 'carter', 1: '42', 2: 'standard', 5: 'B' } }).expect(201)).body;
    expect(res.results.listening).toMatchObject({ status: 'DONE', raw: 4, max: 12 });
    expect(res.keys.listening[0]).toBe('Carter');
    await http().post(`${base}/sections/listening/answers`).set(s).send({ answers: { 0: 'x' } }).expect(409);

    res = (await http().post(`${base}/sections/reading/submit`).set(s).send({ answers: { 0: 'true', 1: 'false', 2: 'false', 3: 'true', 4: 'ng', 5: 'return', 6: 'wild', 7: 'B' } }).expect(201)).body;
    expect(res.results.reading).toMatchObject({ raw: 8, band: 9 });

    const essay = 'Some people argue that university should be free for everyone. '.repeat(30);
    res = (await http().post(`${base}/sections/writing/submit`).set(s).send({ answers: { 0: 'The table shows internet access. '.repeat(30), 1: essay } }).expect(201)).body;
    expect(res.results.writing).toMatchObject({ status: 'REVIEW', band: null });
    expect(res.results.writing.tasks[1].words).toBeGreaterThan(250);

    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
    await http().post(`${base}/speaking/0.0`).set(s).field('transcript', 'I am a student at a language centre').field('seconds', '12')
      .attach('audio', webm, { filename: 'a.webm', contentType: 'audio/webm' }).expect(201);
    await http().post(`${base}/speaking/bad`).set(s).field('transcript', 'x').expect(400);
    res = (await http().post(`${base}/sections/speaking/submit`).set(s).send({}).expect(201)).body;
    expect(res.status).toBe('COMPLETED');
    expect(res.results.overall).toBeNull();

    // The teacher sees the sitting and marks the rest.
    const attempts = (await http().get(`/api/mock-tests/${testId}/attempts`).set(auth()).expect(200)).body;
    expect(attempts[0]).toMatchObject({ id: att.id, status: 'COMPLETED', studentName: 'Mock Kid 1' });
    const detail = (await http().get(`/api/mock-tests/attempts/${att.id}`).set(auth()).expect(200)).body;
    expect(detail.answers.speaking['0.0']).toMatchObject({ transcript: 'I am a student at a language centre', seconds: 12, audio: expect.stringMatching(/\.webm$/) });
    await http().post(`/api/mock-tests/attempts/${att.id}/review`).set(auth()).send({ section: 'writing', band: 6, task1: 6, task2: 6, comment: 'Good structure' }).expect(201);
    const final = (await http().post(`/api/mock-tests/attempts/${att.id}/review`).set(auth()).send({ section: 'speaking', band: 6.5 }).expect(201)).body;
    // (listening + 9 + 6 + 6.5) / 4, rounded to a half band.
    const lb = final.results.listening.band as number;
    expect(final.results.overall).toBe(Math.round(((lb + 9 + 6 + 6.5) / 4) * 2) / 2);
    const seen = (await http().get(base).set(s).expect(200)).body;
    expect(seen.results.writing).toMatchObject({ band: 6, gradedBy: 'TEACHER', teacherComment: 'Good structure' });
  });

  it('marks Writing with the AI examiner when AI is on', async () => {
    const ai = app.get(AiService);
    Object.defineProperty(ai, 'isConfigured', { get: () => true, configurable: true });
    const reply = '{"criteria":{"TR":7,"CC":6.5,"LR":6.5,"GRA":6},"strengths":["Aniq tuzilma"],"improvements":["Ko\'proq misol"],"summary":"Yaxshi"}';
    ai.completeText = async () => reply;
    try {
      const { s } = await studentIn(english, 3);
      const att = (await http().post(`/api/portal/mock-tests/${testId}/start`).set(s).expect(201)).body;
      const base = `/api/portal/mock-tests/attempts/${att.id}`;
      const res = (await http().post(`${base}/sections/writing/submit`).set(s).send({ answers: { 0: 'The chart shows growth. '.repeat(40), 1: 'Education matters a lot. '.repeat(60) } }).expect(201)).body;
      expect(res.aiFeedback).toBe(true);
      expect(res.results.writing.status).toBe('PENDING');
      // The examiner runs in the background; run it here to wait for it.
      await app.get(MockTestsService).gradeWithAi(att.id, 'writing');
      const after = (await http().get(base).set(s).expect(200)).body;
      expect(after.results.writing).toMatchObject({ status: 'DONE', band: 6.5, gradedBy: 'AI' });
      expect(after.results.writing.tasks[1].feedback).toMatchObject({ criteria: { TR: 7 }, strengths: ['Aniq tuzilma'] });
    } finally {
      delete (ai as unknown as Record<string, unknown>).isConfigured;
      delete (ai as unknown as Record<string, unknown>).completeText;
    }
  });
});
