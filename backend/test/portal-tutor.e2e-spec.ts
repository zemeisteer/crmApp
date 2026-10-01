import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';
import { and, eq } from 'drizzle-orm';
import { StudentTutorService } from '../src/ai/student-tutor.service.js';
import { DB, type Database } from '../src/db/db.module.js';
import { aiUsage, studentAiMessages, students, tenants } from '../src/db/schema.js';

// The AI tutor in the student's web cabinet: shared conversation, the
// center's daily limit, "new conversation", and per-student isolation.
describe('Portal AI tutor (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  const questions: string[] = [];
  const prompts: string[] = [];

  const portalLogin = async (name: string, digits: string, groupIds?: string[]) => {
    const phone = `+99891${digits}`;
    const id = (await http().post('/api/students').set(auth()).send({ fullName: name, groupIds }).expect(201)).body.id as string;
    await http().patch(`/api/students/${id}`).set(auth()).send({ phone }).expect(200);
    const { pin } = (await http().post(`/api/students/${id}/portal-pin`).set(auth()).expect(201)).body;
    const token = (await http().post('/api/portal/auth/phone/verify').send({ phone, pin }).expect(201)).body.accessToken as string;
    return () => ({ Authorization: `Bearer ${token}` });
  };

  beforeAll(async () => {
    // The per-address request rate limit sits in front of the tutor; these
    // tests are about the daily quota behind it, so it is switched off here.
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    // No real AI in tests: a stub that remembers what it was asked.
    const ai = app.get(AiService);
    Object.defineProperty(ai, 'isConfigured', { get: () => true });
    ai.completeText = async (prompt: string) => {
      prompts.push(prompt);
      return "**Eng ko'p so'ralgan mavzular** — Present Perfect (2)";
    };
    ai.tutorReply = async (ctx) => {
      questions.push(ctx.question);
      return `Javob: ${ctx.question} (${ctx.history.length})`;
    };
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `Tutor ${suffix}`, subdomain: `tutor-${suffix}`, email: `tutor-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers, remembers the conversation, starts over and respects the limit', async () => {
    const p = await portalLogin('Tutor Kid', String(suffix).slice(-7));

    const empty = (await http().get('/api/portal/ai').set(p()).expect(200)).body;
    expect(empty).toMatchObject({ enabled: true, available: true, limit: 20, left: 20, messages: [] });

    await http().post('/api/portal/ai/ask').set(p()).send({ message: '   ' }).expect(400);
    const a1 = (await http().post('/api/portal/ai/ask').set(p()).send({ message: 'Present Perfect nima?' }).expect(201)).body;
    expect(a1).toMatchObject({ status: 'ok', reply: 'Javob: Present Perfect nima? (0)', left: 19 });
    const a2 = (await http().post('/api/portal/ai/ask').set(p()).send({ message: 'Misol bering' }).expect(201)).body;
    expect(a2.reply).toBe('Javob: Misol bering (2)'); // saw the first question and answer

    const state = (await http().get('/api/portal/ai').set(p()).expect(200)).body;
    expect(state.left).toBe(18);
    expect(state.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

    await http().post('/api/portal/ai/reset').set(p()).expect(201);
    expect((await http().get('/api/portal/ai').set(p()).expect(200)).body.messages).toEqual([]);
    const a3 = (await http().post('/api/portal/ai/ask').set(p()).send({ message: 'Yangi savol' }).expect(201)).body;
    expect(a3.reply).toBe('Javob: Yangi savol (0)');

    // The center lowers the limit: today's 3 questions already use it up.
    await http().patch('/api/tenants/me').set(auth()).send({ studentAiDailyLimit: 3 }).expect(200);
    expect((await http().post('/api/portal/ai/ask').set(p()).send({ message: 'Yana' }).expect(201)).body).toEqual({ status: 'limit', limit: 3 });

    await http().patch('/api/tenants/me').set(auth()).send({ studentAiDailyLimit: 0 }).expect(200);
    expect((await http().get('/api/portal/ai').set(p()).expect(200)).body.enabled).toBe(false);
    expect((await http().post('/api/portal/ai/ask').set(p()).send({ message: 'Yana' }).expect(201)).body).toEqual({ status: 'off' });
    expect(questions).toEqual(['Present Perfect nima?', 'Misol bering', 'Yangi savol']);
    await http().patch('/api/tenants/me').set(auth()).send({ studentAiDailyLimit: 20 }).expect(200);
  });

  describe('daily limit under load', () => {
    let db: Database;
    let tutor: StudentTutorService;
    let tenantId: string;
    const studentRow = async (name: string) => {
      const [row] = await db.select().from(students).where(and(eq(students.fullName, name), eq(students.tenantId, tenantId)));
      const [t] = await db.select().from(tenants).where(eq(tenants.id, row.tenantId));
      return { id: row.id, tenantId: row.tenantId, fullName: row.fullName, tenant: t };
    };
    const usage = async (studentId: string) => db.select().from(aiUsage).where(and(eq(aiUsage.studentId, studentId), eq(aiUsage.kind, 'TUTOR')));

    beforeAll(async () => {
      db = app.get<Database>(DB);
      tutor = app.get(StudentTutorService);
      tenantId = (await http().get('/api/auth/me').set(auth()).expect(200)).body.tenant.id;
    });
    afterEach(async () => {
      await db.update(tenants).set({ studentAiDailyLimit: 20, timezone: 'Asia/Tashkent' }).where(eq(tenants.id, tenantId));
    });

    it('questions sent together from the site and the bot share one limit', async () => {
      const p = await portalLogin('Race Kid', String(suffix + 11).slice(-7));
      await db.update(tenants).set({ studentAiDailyLimit: 4 }).where(eq(tenants.id, tenantId));
      const me = await studentRow('Race Kid');
      const ai = app.get(AiService);
      const answered: string[] = [];
      const original = ai.tutorReply;
      ai.tutorReply = async (ctx) => {
        await new Promise((r) => setTimeout(r, 30)); // all of them are in flight together
        answered.push(ctx.question);
        return 'ok';
      };
      try {
        const results = await Promise.all([
          // The web cabinet...
          ...Array.from({ length: 6 }, (_, i) => http().post('/api/portal/ai/ask').set(p()).send({ message: `web ${i}` }).then((r) => r.body as { status: string })),
          // ...and the Telegram bot, which calls the same service.
          ...Array.from({ length: 6 }, (_, i) => tutor.ask(me, `bot ${i}`)),
        ]);
        expect(results.filter((r) => r.status === 'ok')).toHaveLength(4);
        expect(results.filter((r) => r.status === 'limit')).toHaveLength(8);
        expect(answered).toHaveLength(4); // the AI was not asked for the other eight
        expect(await usage(me.id)).toEqual([expect.objectContaining({ used: 4 })]);
        expect(await tutor.quota(me)).toEqual({ limit: 4, used: 4, left: 0 });
        expect((await http().get('/api/portal/ai').set(p()).expect(200)).body.left).toBe(0);
        const stored = await db.select().from(studentAiMessages).where(and(eq(studentAiMessages.studentId, me.id), eq(studentAiMessages.role, 'user')));
        expect(stored).toHaveLength(4);
      } finally {
        ai.tutorReply = original;
      }
    });

    it('a question the AI could not answer is not charged, and the counter never goes below zero', async () => {
      const p = await portalLogin('Refund Kid', String(suffix + 12).slice(-7));
      const me = await studentRow('Refund Kid');
      const ai = app.get(AiService);
      const original = ai.tutorReply;
      try {
        ai.tutorReply = async () => { throw new Error('provider down'); };
        const failed = await Promise.all(Array.from({ length: 7 }, (_, i) => http().post('/api/portal/ai/ask').set(p()).send({ message: `q ${i}` }).expect(201)));
        expect(failed.every((r) => r.body.status === 'error')).toBe(true);
        expect((await usage(me.id))[0].used).toBe(0);
        expect(await tutor.quota(me)).toMatchObject({ used: 0, left: 20 });

        // One answered, then failures again: back to exactly one.
        ai.tutorReply = async () => 'fine';
        expect((await http().post('/api/portal/ai/ask').set(p()).send({ message: 'works' }).expect(201)).body).toMatchObject({ status: 'ok', left: 19 });
        ai.tutorReply = async () => { throw new Error('provider down'); };
        await Promise.all(Array.from({ length: 5 }, () => http().post('/api/portal/ai/ask').set(p()).send({ message: 'again' }).expect(201)));
        expect((await usage(me.id))[0].used).toBe(1);

        // A failure at the limit frees the place it took.
        await db.update(tenants).set({ studentAiDailyLimit: 2 }).where(eq(tenants.id, tenantId));
        expect((await http().post('/api/portal/ai/ask').set(p()).send({ message: 'fails' }).expect(201)).body.status).toBe('error');
        ai.tutorReply = async () => 'fine';
        expect((await http().post('/api/portal/ai/ask').set(p()).send({ message: 'second' }).expect(201)).body).toMatchObject({ status: 'ok', left: 0 });
        expect((await http().post('/api/portal/ai/ask').set(p()).send({ message: 'third' }).expect(201)).body).toEqual({ status: 'limit', limit: 2 });
      } finally {
        ai.tutorReply = original;
      }
    });

    it("the day turns over at the center's midnight, not the server's", async () => {
      await portalLogin('Midnight Kid', String(suffix + 13).slice(-7));
      await db.update(tenants).set({ studentAiDailyLimit: 2 }).where(eq(tenants.id, tenantId));
      const me = await studentRow('Midnight Kid');
      // 18:30 UTC on the 10th is 23:30 on the 10th in Tashkent (UTC+5).
      const late = new Date('2026-03-10T18:30:00Z');
      expect((await tutor.ask(me, 'one', late)).status).toBe('ok');
      expect((await tutor.ask(me, 'two', late)).status).toBe('ok');
      expect(await tutor.ask(me, 'three', late)).toEqual({ status: 'limit', limit: 2 });
      // 19:05 UTC is 00:05 on the 11th there: a new day, though still the 10th in UTC.
      const after = new Date('2026-03-10T19:05:00Z');
      expect(await tutor.quota(me, after)).toEqual({ limit: 2, used: 0, left: 2 });
      expect((await tutor.ask(me, 'new day', after)).status).toBe('ok');
      expect((await usage(me.id)).map((u) => [u.day, u.used]).sort()).toEqual([['2026-03-10', 2], ['2026-03-11', 1]]);

      // Another zone, the same instant: Kiritimati (UTC+14) is already on the 11th at 18:30 UTC.
      await db.update(tenants).set({ timezone: 'Pacific/Kiritimati' }).where(eq(tenants.id, tenantId));
      const there = await studentRow('Midnight Kid');
      expect(await tutor.quota(there, late)).toMatchObject({ used: 1, left: 1 });
    });
  });

  it("keeps each student's conversation to themselves and needs a portal login", async () => {
    const other = await portalLogin('Other Kid', String(suffix + 1).slice(-7));
    expect((await http().get('/api/portal/ai').set(other()).expect(200)).body.messages).toEqual([]);
    await http().get('/api/portal/ai').expect(401);
    await http().get('/api/portal/ai').set(auth()).expect(401); // staff token is not a portal token
  });

  it("shows staff what a group asked; teachers only for their own groups", async () => {
    const tid = (await http().post('/api/teachers').set(auth()).send({ fullName: 'Report Teacher', subject: 'English' }).expect(201)).body.id as string;
    const mine = (await http().post('/api/groups').set(auth()).send({ name: 'Report Group', subject: 'English', teacherId: tid }).expect(201)).body.id as string;
    const other = (await http().post('/api/groups').set(auth()).send({ name: 'Other Group', subject: 'Math' }).expect(201)).body.id as string;
    const kid = await portalLogin('Zarina Report', String(suffix + 2).slice(-7), [mine]);
    await http().post('/api/portal/ai/ask').set(kid()).send({ message: 'Present Perfect va Past Simple farqi?' }).expect(201);
    await http().post('/api/portal/ai/ask').set(kid()).send({ message: 'have been qachon ishlatiladi?' }).expect(201);

    const report = (await http().get(`/api/ai/tutor-report?groupId=${mine}&days=7`).set(auth()).expect(200)).body;
    expect(report).toMatchObject({ days: 7, totalQuestions: 2, activeStudents: 1, studentCount: 1 });
    expect(report.students[0]).toMatchObject({ fullName: 'Zarina Report', questions: 2 });
    expect(report.students[0].recent[0].text).toBe('have been qachon ishlatiladi?');
    await http().get(`/api/ai/tutor-report?groupId=${mine}&days=500`).set(auth()).expect(400);

    const topics = (await http().post('/api/ai/tutor-report/topics').set(auth()).send({ groupId: mine, days: 7 }).expect(201)).body;
    expect(topics).toMatchObject({ questions: 2 });
    expect(topics.summary).toContain('Present Perfect');
    expect(prompts.at(-1)).toContain('have been qachon ishlatiladi?');
    expect(prompts.at(-1)).not.toContain('Zarina'); // no names go to the AI

    const email = `rt-${suffix}@test.uz`;
    await http().post(`/api/teachers/${tid}/account`).set(auth()).send({ email, password: 'secret123' }).expect(201);
    const teacher = (await http().post('/api/auth/login').send({ email, password: 'secret123' }).expect(201)).body.accessToken as string;
    const t = () => ({ Authorization: `Bearer ${teacher}` });
    expect((await http().get(`/api/ai/tutor-report?groupId=${mine}`).set(t()).expect(200)).body.totalQuestions).toBe(2);
    await http().get(`/api/ai/tutor-report?groupId=${other}`).set(t()).expect(403);
    await http().post('/api/ai/tutor-report/topics').set(t()).send({ groupId: other }).expect(403);
    // A portal (student) token is not a staff token.
    await http().get(`/api/ai/tutor-report?groupId=${mine}`).set(kid()).expect(403);
    await http().get('/api/leads').set(kid()).expect(403);
    await http().get('/api/students').set(kid()).expect(403);
  });
});
