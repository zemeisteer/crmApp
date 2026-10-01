import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { existsSync } from 'fs';
import { join } from 'path';
import { and, eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { aiUsage, mockImports, mockTests } from '../src/db/schema.js';
import { AiService } from '../src/ai/ai.service.js';
import { MockImportService } from '../src/mock-tests/import/mock-import.service.js';
import { UPLOAD_DIR } from '../src/common/upload.util.js';

// The AI is never called here: every answer is a stub.
describe('AI practice quota and durable imports (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let ai: AiService;
  let imports: MockImportService;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  let tenantId: string;
  let ownerId: string;
  let math: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  const stubbed = ['isConfigured', 'generateExamQuestions', 'completeWithPdf'];
  const unstub = () => stubbed.forEach((k) => delete (ai as unknown as Record<string, unknown>)[k]);
  const aiOn = () => Object.defineProperty(ai, 'isConfigured', { get: () => true, configurable: true });

  async function studentIn(groupId: string, n: number) {
    const phone = `+99893${String(suffix + n).slice(-7)}`;
    const kid = (await http().post('/api/students').set(auth()).send({ fullName: `Quota Kid ${n}`, phone }).expect(201)).body.id as string;
    await http().post(`/api/students/${kid}/enroll/${groupId}`).set(auth()).expect(201);
    const { pin } = (await http().post(`/api/students/${kid}/portal-pin`).set(auth()).expect(201)).body;
    const token = (await http().post('/api/portal/auth/phone/verify').send({ phone, pin }).expect(201)).body.accessToken as string;
    return { kid, s: { Authorization: `Bearer ${token}` } };
  }
  const usedToday = async (kid: string) => (await db.select().from(aiUsage).where(and(eq(aiUsage.studentId, kid), eq(aiUsage.kind, 'PRACTICE'))))[0]?.used ?? 0;
  const ownTests = (kid: string) => db.select({ id: mockTests.id }).from(mockTests).where(eq(mockTests.ownerStudentId, kid));
  const question = { type: 'MCQ', prompt: '2 + 2 = ?', options: ['3', '4', '5', '6'], correctAnswer: 'B', points: 1 };

  beforeAll(async () => {
    // A queue of this suite's own: other suites' app instances leave it alone.
    process.env.IMPORT_QUEUE = `e2e-imports-${suffix}`;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    ai = app.get(AiService);
    imports = app.get(MockImportService);
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Quota ${suffix}`, subdomain: `quota-${suffix}`, email: `quota-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.tenant.id;
    ownerId = reg.user.id;
    math = (await http().post('/api/groups').set(auth()).send({ name: 'Math Q', subject: 'Matematika' }).expect(201)).body.id;
  });

  afterAll(async () => {
    unstub();
    await app?.close();
  });

  // ------------------------------------------------------------- quota

  it('twelve requests at once get exactly the five sets of the day', async () => {
    const { kid, s } = await studentIn(math, 1);
    aiOn();
    let calls = 0;
    ai.generateExamQuestions = (async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 30)); // all twelve are in flight together
      return [question, question, question];
    }) as unknown as typeof ai.generateExamQuestions;
    try {
      const results = await Promise.all(Array.from({ length: 12 }, () => http().post('/api/portal/mock-tests/generate').set(s).send({ subject: 'Matematika' })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      const refused = results.filter((r) => r.status === 409);
      expect(refused).toHaveLength(7);
      expect(refused.every((r) => r.body.code === 'LIMIT')).toBe(true);
      expect(calls).toBe(5); // the AI was not even asked for the other seven
      expect(await ownTests(kid)).toHaveLength(5);
      expect(await usedToday(kid)).toBe(5);
      const list = (await http().get('/api/portal/mock-tests').set(s).expect(200)).body;
      expect(list.aiPractice).toMatchObject({ limit: 5, used: 5, left: 0 });
      await http().post('/api/portal/mock-tests/generate').set(s).send({ subject: 'Matematika' }).expect(409);
    } finally {
      unstub();
    }
  });

  it('a set that was not made is not charged: the reservation is given back', async () => {
    const { kid, s } = await studentIn(math, 2);
    aiOn();
    try {
      ai.generateExamQuestions = (async () => { throw new Error('AI is down'); }) as typeof ai.generateExamQuestions;
      const failed = await Promise.all(Array.from({ length: 6 }, () => http().post('/api/portal/mock-tests/generate').set(s).send({ subject: 'Matematika' })));
      expect(failed.every((r) => r.status >= 400)).toBe(true);
      expect(await usedToday(kid)).toBe(0);

      ai.generateExamQuestions = (async () => []) as typeof ai.generateExamQuestions; // nothing usable
      const empty = await http().post('/api/portal/mock-tests/generate').set(s).send({ subject: 'Matematika' }).expect(409);
      expect(empty.body.code).toBe('AI_EMPTY');
      expect(await usedToday(kid)).toBe(0);
      expect(await ownTests(kid)).toHaveLength(0);

      // A request that is refused before the AI (wrong direction) costs nothing.
      await http().post('/api/portal/mock-tests/generate').set(s).send({ subject: 'Kimyo' }).expect(400);
      expect(await usedToday(kid)).toBe(0);

      ai.generateExamQuestions = (async () => [question]) as unknown as typeof ai.generateExamQuestions;
      await http().post('/api/portal/mock-tests/generate').set(s).send({ subject: 'Matematika' }).expect(201);
      expect(await usedToday(kid)).toBe(1);
      expect((await http().get('/api/portal/mock-tests').set(s).expect(200)).body.aiPractice).toMatchObject({ used: 1, left: 4 });
    } finally {
      unstub();
    }
  });

  // ------------------------------------------------------------ imports

  let pdf: Buffer;
  const twoTests = JSON.stringify({ book: 'Queue Book', module: 'ACADEMIC', tests: [
    { title: 'Test 1', estimatedLevel: 'B6', listening: '', reading: '2', writing: '', speaking: '', answerKey: '', audioscript: '' },
    { title: 'Test 2', estimatedLevel: 'B6', listening: '', reading: '3', writing: '', speaking: '', answerKey: '', audioscript: '' },
  ] });
  const reading = JSON.stringify({ passages: [{ title: 'P', text: 'Text', questions: [{ no: 1, type: 'TRUE_FALSE_NG', prompt: 'It is so.', correctAnswer: 'TRUE' }] }] });
  // An AI that finds two tests and reads them; `onCall` lets a test break it.
  const stubImportAi = (onCall: (prompt: string, n: number) => void | Promise<unknown> = () => undefined) => {
    aiOn();
    const seen: string[] = [];
    ai.completeWithPdf = (async (prompt: string) => {
      seen.push(prompt.includes('Find every complete practice test') ? 'locate' : prompt.includes('READING section') ? 'reading' : 'other');
      await onCall(prompt, seen.length);
      if (prompt.includes('Find every complete practice test')) return twoTests;
      if (prompt.includes('READING section')) return reading;
      return '{}';
    }) as typeof ai.completeWithPdf;
    return seen;
  };
  const upload = async () => (await http().post('/api/mock-tests/import').set(auth())
    .attach('files', pdf, { filename: 'queue-book.pdf', contentType: 'application/pdf' }).expect(201)).body;
  const job = async (id: string) => (await db.select().from(mockImports).where(eq(mockImports.id, id)))[0];
  const testsOf = (id: string) => db.select({ id: mockTests.id, importIndex: mockTests.importIndex, title: mockTests.title }).from(mockTests).where(eq(mockTests.importId, id));
  const pdfPath = async (id: string) => join(UPLOAD_DIR, (JSON.parse((await job(id)).files) as Array<{ path: string }>)[0].path);
  const dueNow = (id: string) => db.update(mockImports).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(mockImports.id, id));

  it('prepares a book', async () => {
    const PDFKit = (await import('pdfkit')).default;
    const doc = new PDFKit();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const ended = new Promise((r) => doc.on('end', r));
    [
      'Contents. Introduction to the book and how to use it with students preparing for the exam',
      'Test 1 READING PASSAGE 1 You should spend about 20 minutes on Questions 1-13 The history of tea',
      'Test 2 READING PASSAGE 1 You should spend about 20 minutes on Questions 1-13 The story of silk',
    ].forEach((t, i) => { if (i) doc.addPage(); doc.text(t); });
    doc.end();
    await ended;
    pdf = Buffer.concat(chunks);
    expect(pdf.length).toBeGreaterThan(100);
  });

  it('runs an import to the end, records who started it and removes the book afterwards', async () => {
    stubImportAi();
    try {
      const started = await upload();
      expect(started.createdBy).toBe(ownerId);
      const file = await pdfPath(started.id);
      await imports.idle();
      const done = (await http().get(`/api/mock-tests/imports/${started.id}`).set(auth()).expect(200)).body;
      expect(done).toMatchObject({ status: 'DONE', error: null, attempts: 1, progress: { step: 'done' } });
      expect(done.result.tests.map((t: { title: string }) => t.title)).toEqual(['Queue Book — Test 1', 'Queue Book — Test 2']);
      expect((await testsOf(started.id)).map((t) => t.importIndex).sort()).toEqual([0, 1]);
      expect(existsSync(file)).toBe(false);
      // Another center cannot see it.
      const other = (await http().post('/api/auth/register')
        .send({ centerName: `QuotaB ${suffix}`, subdomain: `quotab-${suffix}`, email: `quotab-${suffix}@test.uz`, password: 'password123', fullName: 'Other' })
        .expect(201)).body.accessToken;
      await http().get(`/api/mock-tests/imports/${started.id}`).set({ Authorization: `Bearer ${other}` }).expect(404);
    } finally {
      unstub();
    }
  });

  it('retries a failed attempt from where it stopped, without making a test twice', async () => {
    // First attempt: the plan is found and Test 1 saved; in the middle of
    // Test 2 this server loses the job.
    let broken = true;
    const seen = stubImportAi(async (_prompt, n) => {
      // While Test 2 is being read, another server takes the job over.
      if (broken && n === 3) await db.update(mockImports).set({ lockedBy: 'gone' }).where(eq(mockImports.lockedBy, imports.instanceId));
    });
    try {
      const started = await upload();
      const file = await pdfPath(started.id);
      await imports.idle();
      // The lock was lost mid-way: this server stopped without failing the job.
      let row = await job(started.id);
      expect(row.status).toBe('RUNNING');
      expect(row.lockedBy).toBe('gone');
      expect(existsSync(file)).toBe(true); // the book stays for whoever continues
      const afterFirst = await testsOf(started.id);
      expect(afterFirst.map((t) => t.importIndex)).toEqual([0]);

      // A fresh heartbeat belongs to someone: neither a kick nor a restart touches it.
      await db.update(mockImports).set({ lockedAt: new Date() }).where(eq(mockImports.id, started.id));
      await imports.kick();
      imports.onModuleInit();
      await imports.idle();
      row = await job(started.id);
      expect(row).toMatchObject({ status: 'RUNNING', lockedBy: 'gone', attempts: 1 });

      // Its server has been silent for too long: the job is taken over and finished.
      broken = false;
      const callsBefore = seen.length;
      await db.update(mockImports).set({ lockedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(mockImports.id, started.id));
      await imports.kick();
      await imports.idle();
      row = await job(started.id);
      expect(row).toMatchObject({ status: 'DONE', attempts: 2, error: null });
      const tests = await testsOf(started.id);
      expect(tests.map((t) => t.importIndex).sort()).toEqual([0, 1]); // two tests, not three or four
      expect(new Set(afterFirst.map((t) => t.id)).size).toBe(afterFirst.length);
      expect(afterFirst.every((t) => tests.some((x) => x.id === t.id))).toBe(true); // the first attempt's test was kept
      // The stored plan was reused (no second "locate"), and saved tests were not read again.
      expect(seen.slice(callsBefore)).not.toContain('locate');
      expect(seen.slice(callsBefore).filter((x) => x === 'reading').length).toBe(2 - afterFirst.length);
      expect(JSON.parse(row.result).tests).toHaveLength(2);
      expect(existsSync(file)).toBe(false);
    } finally {
      unstub();
    }
  });

  it('puts a failed attempt back with a pause, and gives up after three, cleaning up', async () => {
    aiOn();
    ai.completeWithPdf = (async () => { throw new Error('AI timeout'); }) as typeof ai.completeWithPdf;
    try {
      const started = await upload();
      const file = await pdfPath(started.id);
      await imports.idle();
      let row = await job(started.id);
      expect(row).toMatchObject({ status: 'QUEUED', attempts: 1, lockedBy: null, error: 'AI timeout' });
      expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(existsSync(file)).toBe(true);
      expect((await http().get(`/api/mock-tests/imports/${started.id}`).set(auth()).expect(200)).body.progress.message).toContain('qayta uriniladi');

      // Not due yet: a kick leaves it waiting.
      await imports.kick();
      await imports.idle();
      expect((await job(started.id)).attempts).toBe(1);

      for (const attempt of [2, 3]) {
        await dueNow(started.id);
        await imports.kick();
        await imports.idle();
        expect((await job(started.id)).attempts).toBe(attempt);
      }
      row = await job(started.id);
      expect(row).toMatchObject({ status: 'FAILED', error: 'AI timeout', lockedBy: null });
      expect(await testsOf(started.id)).toHaveLength(0);
      expect(existsSync(file)).toBe(false);
      // Closed for good.
      await dueNow(started.id);
      await imports.kick();
      await imports.idle();
      expect((await job(started.id)).attempts).toBe(3);
    } finally {
      unstub();
    }
  });

  it('gives up at once when retrying cannot help', async () => {
    aiOn();
    ai.completeWithPdf = (async () => JSON.stringify({ book: null, tests: [] })) as typeof ai.completeWithPdf;
    try {
      const started = await upload();
      await imports.idle();
      expect(await job(started.id)).toMatchObject({ status: 'FAILED', attempts: 1 });
    } finally {
      unstub();
    }
  });

  it('works on one import at a time and leaves other queues alone', async () => {
    let running = 0;
    let most = 0;
    aiOn();
    ai.completeWithPdf = (async (prompt: string) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 40));
      running--;
      if (prompt.includes('Find every complete practice test')) return twoTests;
      return reading;
    }) as typeof ai.completeWithPdf;
    try {
      const jobs = await Promise.all([upload(), upload(), upload()]);
      // A job of another environment on the same database.
      const [foreign] = await db.insert(mockImports).values({ tenantId, queue: `someone-else-${suffix}`, files: '[]' }).returning();
      for (let i = 0; i < 100; i++) {
        const busy = (await db.select({ id: mockImports.id }).from(mockImports).where(and(eq(mockImports.lockedBy, imports.instanceId), eq(mockImports.status, 'RUNNING')))).length;
        expect(busy).toBeLessThanOrEqual(1);
        if ((await Promise.all(jobs.map((j) => job(j.id)))).every((r) => r.status === 'DONE')) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      await imports.idle();
      expect(most).toBe(1);
      for (const j of jobs) {
        expect(await job(j.id)).toMatchObject({ status: 'DONE', attempts: 1 });
        expect(await testsOf(j.id)).toHaveLength(2);
      }
      expect(await job(foreign.id)).toMatchObject({ status: 'QUEUED', attempts: 0, lockedBy: null });
    } finally {
      unstub();
    }
  });
});
