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
import { auditLogs, tenants, users } from '../src/db/schema.js';
import { AiService } from '../src/ai/ai.service.js';
import { StudentTutorService } from '../src/ai/student-tutor.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { EskizProvider } from '../src/notifications/sms/eskiz.provider.js';
import { clearFlagCache } from '../src/feature-flags/flags.js';

// The platform's switches (feature-flags/flags.ts): on unless the platform
// admin turns them off, for everyone or for one center (its own setting
// wins). Suites share this database and run in parallel, so here only
// centers' own settings are turned off (a global "off" would reach other
// suites); the global/override rule is unit-tested (flags.spec.ts) and the
// sign-up switch has its own file with the check replaced. No provider is
// called: AI and SMS are replaced.
describe('Platform switches (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const tail = String(suffix).slice(-5);
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let admin: string;
  let n = 0;

  const center = async () => {
    const key = `ff${++n}${tail}`;
    const body = (await http().post('/api/auth/register').send({ centerName: `FF ${key}`, subdomain: key, email: `${key}@test.uz`, password: 'password123', fullName: `Owner ${key}` }).expect(201)).body;
    await db.update(tenants).set({ status: 'ACTIVE', smsEnabled: true }).where(eq(tenants.id, body.tenant.id));
    return { id: body.tenant.id as string, token: body.accessToken as string };
  };
  const setGlobal = (key: string, enabled: boolean) => http().post('/api/feature-flags/global').set(bearer(admin)).send({ key, enabled });
  const setFor = (key: string, tenantId: string, enabled: boolean) => http().put(`/api/feature-flags/${key}/tenants/${tenantId}`).set(bearer(admin)).send({ enabled });
  const materials = (c: { token: string }) => http().post('/api/ai/materials').set(bearer(c.token)).send({ subject: 'Matematika', topic: 'Kasrlar', type: 'HOMEWORK' });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    const email = `ff-admin-${suffix}@test.uz`;
    await http().post('/api/auth/register').send({ centerName: `FF admin ${suffix}`, subdomain: `ff-adm-${tail}`, email, password: 'password123', fullName: 'FF Admin' }).expect(201);
    await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.email, email));
    admin = (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken;
  }, 120_000);

  afterEach(() => {
    vi.restoreAllMocks();
    clearFlagCache();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('every switch is on until turned off; only the platform admin turns them, and it is logged', async () => {
    const c = await center();
    const view = (await http().get('/api/feature-flags').set(bearer(c.token)).expect(200)).body;
    expect(view).toEqual([{ key: 'ai', enabled: true }, { key: 'sms', enabled: true }, { key: 'telegram', enabled: true }, { key: 'signups', enabled: true }]);
    await http().post('/api/feature-flags/global').set(bearer(c.token)).send({ key: 'ai', enabled: false }).expect(403);
    await setGlobal('nonsense', false).expect(400);
    // "On" is the default: setting it changes nothing for the other suites.
    await setGlobal('telegram', true).expect(201);
    await expect.poll(async () => (await db.select().from(auditLogs).where(eq(auditLogs.entityType, 'feature_flag'))).length).toBeGreaterThan(0);
  });

  it('ai off for a center: staff AI answers 503 FEATURE_DISABLED, the tutor is unavailable; others go on; cleared, it is back', async () => {
    const c = await center();
    const other = await center();
    const ai = app.get(AiService);
    vi.spyOn(ai, 'generateMaterial').mockResolvedValue({ content: 'ok' } as never);
    await setFor('ai', c.id, false).expect(200);
    const res = await materials(c);
    expect([res.status, res.body.code]).toEqual([503, 'FEATURE_DISABLED']);
    vi.spyOn(ai, 'isConfigured', 'get').mockReturnValue(true);
    const st = (await http().post('/api/students').set(bearer(c.token)).send({ fullName: 'FF S', phone: `+99899${tail}01` }).expect(201)).body;
    expect((await app.get(StudentTutorService).ask({ id: st.id, tenantId: c.id, fullName: 'FF', tenant: { name: 'FF', studentAiDailyLimit: 10, timezone: 'Asia/Tashkent' } }, 'savol')).status).toBe('unavailable');
    await materials(other).expect(201);
    const view = (await http().get('/api/feature-flags/overview').set(bearer(admin)).expect(200)).body;
    expect(view.find((f: { key: string }) => f.key === 'ai').overrides).toContainEqual(expect.objectContaining({ tenantId: c.id, enabled: false }));
    await http().delete(`/api/feature-flags/ai/tenants/${c.id}`).set(bearer(admin)).expect(200);
    await materials(c).expect(201);
  });

  it('sms off: nothing is sent; telegram off: no message goes', async () => {
    const c = await center();
    const sms = vi.spyOn(EskizProvider.prototype, 'sendSms').mockResolvedValue({ success: true, messageId: 'm' });
    await setFor('sms', c.id, false).expect(200);
    await setFor('telegram', c.id, false).expect(200);
    const notifications = app.get(NotificationsService);
    const r = await notifications.send(c.id, { channel: 'SMS', recipient: '+998901234567', content: 'x' });
    expect([r.status, r.errorMessage]).toEqual(['FAILED', "SMS yuborish vaqtincha o'chirilgan"]);
    expect(sms).not.toHaveBeenCalled();
    const t = await notifications.send(c.id, { channel: 'TELEGRAM', recipient: '12345', content: 'x' });
    expect(t.status).toBe('FAILED');
  });
});
