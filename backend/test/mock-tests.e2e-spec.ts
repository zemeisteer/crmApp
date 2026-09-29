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

  it('imports a book: finds the tests, extracts sections, matches the audio', async () => {
    const PDFKit = (await import('pdfkit')).default;
    const doc = new PDFKit();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const ended = new Promise((r) => doc.on('end', r));
    const pages = [
      'Contents. Introduction to the book and how to use it with students preparing for the exam',
      'Test 1 LISTENING PART 1 Questions 1-10 Complete the form below. Write ONE WORD AND/OR A NUMBER',
      'Test 1 READING PASSAGE 1 You should spend about 20 minutes on Questions 1-13 The history of tea',
      'Test 1 WRITING TASK 1 You should spend about 20 minutes on this task. The chart below shows',
      'Test 1 SPEAKING PART 1 Let us talk about your home town. PART 2 Describe a teacher you remember',
      'Answer key Test 1 Listening 1 Carter 2 42 Reading 1 TRUE 2 tea leaves and more answers here',
    ];
    pages.forEach((t, i) => { if (i) doc.addPage(); doc.text(t); });
    doc.end();
    await ended;
    const pdf = Buffer.concat(chunks);

    const ai = app.get(AiService);
    Object.defineProperty(ai, 'isConfigured', { get: () => true, configurable: true });
    const prompts: string[] = [];
    ai.completeWithPdf = async (prompt: string) => {
      prompts.push(prompt.slice(0, 40));
      if (prompt.includes('Find every complete practice test')) {
        return JSON.stringify({ book: 'Demo IELTS Book', module: 'ACADEMIC', tests: [{ title: 'Test 1', estimatedLevel: 'B6', listening: '2', reading: '3', writing: '4', speaking: '5', answerKey: '6', audioscript: '' }] });
      }
      if (prompt.includes('LISTENING section')) {
        return 'Here you go: ' + JSON.stringify({ parts: [{ title: 'Part 1', instruction: null, transcript: null, questions: [
          { no: 2, type: 'FILL_BLANK', prompt: 'Address: ______ Hill Road', correctAnswer: '42' },
          { no: 1, type: 'FILL_BLANK', prompt: 'Surname: ______', correctAnswer: 'Carter' },
          { no: 3, type: 'MCQ_MULTI', prompt: 'Which TWO facilities are free?', options: ['pool', 'gym', 'sauna', 'parking'], correctAnswer: 'A and D' },
        ] }] });
      }
      if (prompt.includes('READING section')) {
        return JSON.stringify({ passages: [{ title: 'The history of tea', text: 'A Tea was first...\n\nB Later...', questions: [
          { no: 1, type: 'TRUE_FALSE_NG', prompt: 'Tea came from China.', correctAnswer: 'TRUE' },
          { no: 2, type: 'FILL_BLANK', prompt: 'Traders sold ______.', correctAnswer: '' },
        ] }] });
      }
      if (prompt.includes('WRITING section')) return JSON.stringify({ tasks: [{ title: 'Task 1', prompt: 'The chart below shows...\n[Chart] Bars: A 10, B 20', minWords: 150 }, { title: 'Task 2', prompt: 'Discuss both views.', minWords: 250 }] });
      if (prompt.includes('SPEAKING section')) return JSON.stringify({ parts: [{ title: 'Part 1', questions: ['Where is your home town?'] }, { title: 'Part 2', questions: ['Describe a teacher you remember.'] }, { title: 'Part 3', questions: ['Why do people become teachers?'] }] });
      return '{}';
    };
    try {
      const mp3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
      const started = (await http().post('/api/mock-tests/import').set(auth())
        .attach('files', pdf, { filename: 'demo-book.pdf', contentType: 'application/pdf' })
        .attach('files', mp3, { filename: 'Test 1 Part 1.mp3', contentType: 'audio/mpeg' })
        .attach('files', mp3, { filename: 'bonus track.mp3', contentType: 'audio/mpeg' })
        .expect(201)).body;
      let imp = started;
      for (let i = 0; i < 60 && !['DONE', 'FAILED'].includes(imp.status); i++) {
        await new Promise((r) => setTimeout(r, 200));
        imp = (await http().get(`/api/mock-tests/imports/${started.id}`).set(auth()).expect(200)).body;
      }
      expect(imp.error ?? null).toBeNull();
      expect(imp.status).toBe('DONE');
      expect(imp.result.book).toBe('Demo IELTS Book');
      expect(imp.result.unmatchedAudio).toEqual(['bonus track.mp3']);
      const made = imp.result.tests[0];
      expect(made).toMatchObject({ title: 'Demo IELTS Book — Test 1', level: 'B6', counts: { listening: 3, reading: 2, writing: 2, speaking: 3 } });
      expect(made.warnings.join(' ')).toContain("1 ta savolning javobi topilmadi");

      const test = (await http().get(`/api/mock-tests/${made.id}`).set(auth()).expect(200)).body;
      expect(test).toMatchObject({ status: 'DRAFT', level: 'B6', module: 'ACADEMIC', source: 'Demo IELTS Book' });
      // Questions in paper order, the recording on Part 1.
      expect(test.content.listening.parts[0].questions.map((q: { prompt: string }) => q.prompt)).toEqual(['Surname: ______', 'Address: ______ Hill Road', 'Which TWO facilities are free?']);
      expect(test.content.listening.parts[0].questions[2]).toMatchObject({ type: 'MCQ_MULTI', correctAnswer: 'A,D' });
      expect(test.content.listening.parts[0].audioPath).toMatch(/\.mp3$/);
      // A missing key blocks publishing until the teacher fills it in.
      const res = await http().patch(`/api/mock-tests/${made.id}`).set(auth()).send({ status: 'PUBLISHED' }).expect(400);
      expect(res.body.message).toContain('1 ta savolning');
      test.content.reading.passages[0].questions[1].correctAnswer = 'tea leaves';
      await http().patch(`/api/mock-tests/${made.id}`).set(auth()).send({ content: test.content, status: 'PUBLISHED' }).expect(200);
    } finally {
      delete (ai as unknown as Record<string, unknown>).isConfigured;
      delete (ai as unknown as Record<string, unknown>).completeWithPdf;
    }
  });

  it('refuses an import without AI and without a PDF', async () => {
    await http().post('/api/mock-tests/import').set(auth()).attach('files', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(503);
    await http().post('/api/mock-tests/import').set(auth()).attach('files', Buffer.from([1, 2]), { filename: 'a.mp3', contentType: 'audio/mpeg' }).expect(400);
  });

  it('locks tests far above the student level', async () => {
    const low = (await http().post('/api/groups').set(auth()).send({ name: 'English Starters', subject: 'Ingliz tili', level: 'Pre-Intermediate' }).expect(201)).body.id;
    const { s } = await studentIn(low, 4);
    const hard = (await http().post('/api/mock-tests').set(auth()).send({ sample: true, title: 'Band 8 mock', level: 'B8' }).expect(201)).body.id;
    const next = (await http().post('/api/mock-tests').set(auth()).send({ sample: true, title: 'Band 6 mock', level: 'B6' }).expect(201)).body.id;
    for (const id of [hard, next]) await http().patch(`/api/mock-tests/${id}`).set(auth()).send({ status: 'PUBLISHED' }).expect(200);

    const list = (await http().get('/api/portal/mock-tests').set(s).expect(200)).body;
    expect(list.level).toBe('B5');
    const tests = list.directions.flatMap((d: { tests: unknown[] }) => d.tests) as Array<{ id: string; open: boolean; recommended: boolean }>;
    expect(tests.find((t) => t.id === next)).toMatchObject({ open: true, recommended: true });
    expect(tests.find((t) => t.id === hard)).toMatchObject({ open: false });
    await http().post(`/api/portal/mock-tests/${hard}/start`).set(s).expect(403);
    await http().post(`/api/portal/mock-tests/${next}/start`).set(s).expect(201);
  });
});
