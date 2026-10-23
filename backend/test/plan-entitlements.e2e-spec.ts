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
import { branches, plans, tenants, users } from '../src/db/schema.js';
import { StudentTutorService } from '../src/ai/student-tutor.service.js';
import { AiService } from '../src/ai/ai.service.js';

// What a plan includes is data (plans.entitlements), set by the platform
// admin: features refused with 403 PLAN_FEATURE, limits with 403 PLAN_LIMIT.
// A plan nobody configured includes everything, as before.
describe('Plan entitlements (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const tail = String(suffix).slice(-5);
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const before = { TRIAL_LIMITS: process.env.TRIAL_LIMITS };
  let n = 0;
  let admin: string;

  const center = async () => {
    const key = `pe${++n}${tail}`;
    const body = (await http().post('/api/auth/register').send({ centerName: `PE ${key}`, subdomain: key, email: `${key}@test.uz`, password: 'password123', fullName: `Owner ${key}` }).expect(201)).body;
    // A paying center: only the plan's limits apply, not the trial's.
    await db.update(tenants).set({ status: 'ACTIVE' }).where(eq(tenants.id, body.tenant.id));
    return { id: body.tenant.id as string, token: body.accessToken as string, key };
  };
  /** A plan with these entitlements, set through the admin's API; the center moves to it. */
  const onPlan = async (c: { id: string }, entitlements: Record<string, unknown>) => {
    const key = `PE_${++n}_${tail}`;
    const created = (await http().post('/api/plans').set(bearer(admin)).send({ key, name: key, price: 1000 }).expect(201)).body;
    await http().patch(`/api/plans/${created.id}`).set(bearer(admin)).send({ entitlements }).expect(200);
    await db.update(tenants).set({ plan: key }).where(eq(tenants.id, c.id));
    return created.id as string;
  };
  const student = (c: { token: string }) =>
    http().post('/api/students').set(bearer(c.token)).send({ fullName: `PE S ${++n}`, phone: `+99898${tail}${String(n).padStart(2, '0')}` });

  beforeAll(async () => {
    process.env.TRIAL_LIMITS = 'off';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    const email = `pe-admin-${suffix}@test.uz`;
    await http().post('/api/auth/register').send({ centerName: `PE admin ${suffix}`, subdomain: `pe-adm-${tail}`, email, password: 'password123', fullName: 'PE Admin' }).expect(201);
    await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.email, email));
    admin = (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken;
  }, 120_000);

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    if (before.TRIAL_LIMITS === undefined) delete process.env.TRIAL_LIMITS;
    else process.env.TRIAL_LIMITS = before.TRIAL_LIMITS;
  });

  it('only known keys and values are accepted', async () => {
    const created = (await http().post('/api/plans').set(bearer(admin)).send({ key: `PE_BAD_${tail}`, name: 'bad', price: 1 }).expect(201)).body;
    await http().patch(`/api/plans/${created.id}`).set(bearer(admin)).send({ entitlements: { SOMETHING: true } }).expect(400);
    await http().patch(`/api/plans/${created.id}`).set(bearer(admin)).send({ entitlements: { MAX_STUDENTS: -1 } }).expect(400);
    await http().patch(`/api/plans/${created.id}`).set(bearer(admin)).send({ entitlements: { AI_TOOLS: 'yes' } }).expect(400);
    const ok = (await http().patch(`/api/plans/${created.id}`).set(bearer(admin)).send({ entitlements: { AI_TOOLS: false, MAX_STUDENTS: null } }).expect(200)).body;
    expect(ok.entitlements).toEqual({ AI_TOOLS: false, MAX_STUDENTS: null });
    // Only the platform admin sets them.
    const c = await center();
    await http().patch(`/api/plans/${created.id}`).set(bearer(c.token)).send({ entitlements: {} }).expect(403);
  });

  it('a feature not in the plan is refused with a code the app reads; the center sees what it has', async () => {
    const c = await center();
    await onPlan(c, { MOCK_EXAMS: false, CERTIFICATES: false, AI_TOOLS: false });
    const mock = await http().get('/api/mock-tests').set(bearer(c.token));
    expect([mock.status, mock.body.code, mock.body.feature]).toEqual([403, 'PLAN_FEATURE', 'MOCK_EXAMS']);
    expect((await http().get('/api/certificates').set(bearer(c.token))).body.code).toBe('PLAN_FEATURE');
    const ai = await http().post('/api/ai/materials').set(bearer(c.token)).send({ subject: 'Matematika', topic: 'Kasrlar', type: 'HOMEWORK' });
    expect([ai.status, ai.body.feature]).toEqual([403, 'AI_TOOLS']);
    const me = (await http().get('/api/auth/me').set(bearer(c.token)).expect(200)).body;
    expect(me.tenant.entitlements).toMatchObject({ MOCK_EXAMS: false, CERTIFICATES: false, AI_TOOLS: false });
  });

  it("the students' AI tutor answers 'off' when the plan leaves it out", async () => {
    const c = await center();
    await onPlan(c, { AI_TUTOR: false });
    const ai = app.get(AiService);
    vi.spyOn(ai, 'isConfigured', 'get').mockReturnValue(true);
    const reply = vi.spyOn(ai, 'tutorReply').mockResolvedValue('javob');
    const st = (await student(c).expect(201)).body;
    const r = await app.get(StudentTutorService).ask({ id: st.id, tenantId: c.id, fullName: 'PE', tenant: { name: 'PE', studentAiDailyLimit: 10, timezone: 'Asia/Tashkent' } }, 'savol');
    expect(r.status).toBe('off');
    expect(reply).not.toHaveBeenCalled();
  });

  it('limits: students, staff and branches stop at the plan number', async () => {
    const c = await center();
    const [{ count }] = await db.select({ count: branches.id }).from(branches).where(eq(branches.tenantId, c.id)).then((r) => [{ count: r.length }]);
    await onPlan(c, { MAX_STUDENTS: 2, MAX_STAFF: 1, MAX_BRANCHES: count + 1 });
    await student(c).expect(201);
    await student(c).expect(201);
    const third = await student(c);
    expect([third.status, third.body.code]).toEqual([403, 'PLAN_LIMIT']);
    await http().post('/api/staff').set(bearer(c.token)).send({ email: `${c.key}-s1@test.uz`, fullName: 'PE Staff 1', role: 'MANAGER', password: 'password12345' }).expect(201);
    const staff2 = await http().post('/api/staff').set(bearer(c.token)).send({ email: `${c.key}-s2@test.uz`, fullName: 'PE Staff 2', role: 'MANAGER', password: 'password12345' });
    expect(staff2.body.code).toBe('PLAN_LIMIT');
    await http().post('/api/branches').set(bearer(c.token)).send({ name: 'PE Filial A' }).expect(201);
    const b2 = await http().post('/api/branches').set(bearer(c.token)).send({ name: 'PE Filial B' });
    expect([b2.status, b2.body.code]).toEqual([403, 'PLAN_LIMIT']);
  });

  it('a plan nobody configured includes everything (as before)', async () => {
    const c = await center();
    const [p] = await db.select({ entitlements: plans.entitlements }).from(plans).innerJoin(tenants, eq(tenants.plan, plans.key)).where(eq(tenants.id, c.id));
    expect(p.entitlements).toEqual({});
    await http().get('/api/mock-tests').set(bearer(c.token)).expect(200);
    await http().get('/api/certificates').set(bearer(c.token)).expect(200);
    for (let i = 0; i < 3; i++) await student(c).expect(201);
  });
});
