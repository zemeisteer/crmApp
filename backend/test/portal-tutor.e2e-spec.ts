import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';

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
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
  });
});
