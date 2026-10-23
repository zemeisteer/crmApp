import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { trialAiUsage } from '../src/db/schema.js';
import { AiService } from '../src/ai/ai.service.js';
import { StudentTutorService } from '../src/ai/student-tutor.service.js';
import { MockTestsService } from '../src/mock-tests/mock-tests.service.js';

// A center on its free trial has TRIAL_AI_PER_DAY AI requests a day. One that
// got no answer (the AI failed) is not charged - for staff pages and for the
// students' tutor alike. No AI provider is called: AiService is replaced.
describe('Trial AI allowance: failed requests are not charged (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  let ai: AiService;
  const suffix = Date.now();
  const tail = String(suffix).slice(-5);
  const http = () => request(app.getHttpServer() as App);
  const FLAGS = ['TRIAL_LIMITS', 'TRIAL_AI_PER_DAY'];
  const before = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
  let n = 0;

  const center = async () => {
    const key = `tr${++n}${tail}`;
    const body = (await http().post('/api/auth/register').send({ centerName: `TR ${key}`, subdomain: key, email: `${key}@test.uz`, password: 'password123', fullName: `Owner ${key}` }).expect(201)).body;
    return { id: body.tenant.id as string, token: body.accessToken as string };
  };
  const used = async (tenantId: string) =>
    (await db.select({ count: trialAiUsage.count }).from(trialAiUsage).where(eq(trialAiUsage.tenantId, tenantId))).reduce((s, r) => s + r.count, 0);

  beforeAll(async () => {
    Object.assign(process.env, { TRIAL_LIMITS: 'on', TRIAL_AI_PER_DAY: '2' });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    ai = app.get(AiService);
  }, 120_000);

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('a staff AI request that fails is not counted; the allowance is still all there', async () => {
    const c = await center();
    const gen = vi.spyOn(ai, 'generateMaterial').mockRejectedValue(new Error('AI provider down'));
    const body = { subject: 'Matematika', topic: 'Kasrlar', type: 'HOMEWORK' };
    for (let i = 0; i < 3; i++) {
      const res = await http().post('/api/ai/materials').set({ Authorization: `Bearer ${c.token}` }).send(body);
      expect(res.status).toBeGreaterThanOrEqual(500);
    }
    expect(await used(c.id)).toBe(0);
    // Answers come back: the day's two are there, the third is refused.
    gen.mockResolvedValue({ content: 'ok' } as never);
    await http().post('/api/ai/materials').set({ Authorization: `Bearer ${c.token}` }).send(body).expect(201);
    await http().post('/api/ai/materials').set({ Authorization: `Bearer ${c.token}` }).send(body).expect(201);
    const third = await http().post('/api/ai/materials').set({ Authorization: `Bearer ${c.token}` }).send(body);
    expect([third.status, third.body.code]).toEqual([429, 'TRIAL_AI_LIMIT']);
    expect(await used(c.id)).toBe(2);
  });

  it("a student's tutor question the AI cannot answer is not counted against the center", async () => {
    const tutor = app.get(StudentTutorService);
    vi.spyOn(ai, 'isConfigured', 'get').mockReturnValue(true);
    const reply = vi.spyOn(ai, 'tutorReply').mockRejectedValue(new Error('AI provider down'));
    const c = await center();
    const st = (await http().post('/api/students').set({ Authorization: `Bearer ${c.token}` }).send({ fullName: 'TR Tutor', phone: `+99895${tail}01` }).expect(201)).body;
    const s = { id: st.id, tenantId: c.id, fullName: 'TR Tutor', tenant: { name: 'TR', studentAiDailyLimit: 50, timezone: 'Asia/Tashkent' } };
    for (let i = 0; i < 3; i++) expect((await tutor.ask(s, `savol ${i}`)).status).toBe('error');
    expect(await used(c.id)).toBe(0);
    reply.mockResolvedValue('javob');
    expect((await tutor.ask(s, 'savol A')).status).toBe('ok');
    expect((await tutor.ask(s, 'savol B')).status).toBe('ok');
    expect((await tutor.ask(s, 'savol C')).status).toBe('limit');
    expect(await used(c.id)).toBe(2);
  });
  it("mock-test marking of a student's work: the request it took comes back when the AI fails", async () => {
    const mock = app.get(MockTestsService) as unknown as { centerAiAllowed(id: string): Promise<string>; refundCenterAi(id: string): Promise<void> };
    const c = await center();
    expect(await mock.centerAiAllowed(c.id)).toBe('CHARGED');
    expect(await used(c.id)).toBe(1);
    await mock.refundCenterAi(c.id);
    expect(await used(c.id)).toBe(0);
    await mock.refundCenterAi(c.id); // never below zero
    expect(await used(c.id)).toBe(0);
  });
});
