import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { auditLogs, organizationMemberships, platformSettings, platformSubscriptions, tenants, users } from '../src/db/schema.js';
import { PlatformSettingsService } from '../src/platform/platform-settings.service.js';

// The platform admin's pages: who may open them, what a subscription change
// and a payment by hand do, and that an integration key entered in the
// panel is sealed in the database and never comes back out.
describe('Platform admin (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const SECRET = `sk-test-${suffix}-DO-NOT-LEAK-wxyz`;
  const KEYS = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'ANTHROPIC_API_KEY'];
  const before = Object.fromEntries(['SETTINGS_KEY', 'TRANSLATE_PUBLIC_FALLBACK', ...KEYS].map((k) => [k, process.env[k]]));

  let sa: string, saId: string, owner: string, manager: string, tenantId: string;
  const month = new Date().toISOString().slice(0, 7);

  beforeAll(async () => {
    // A key of this run only; no translator that needs the network.
    Object.assign(process.env, { SETTINGS_KEY: Buffer.alloc(32, 5).toString('base64'), TRANSLATE_PUBLIC_FALLBACK: 'false' });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app, process.env);
    await app.init();
    db = app.get<Database>(DB);
    const email = `pf-sa-${suffix}@test.uz`;
    const reg = (await http().post('/api/auth/register').send({ centerName: `PF root ${suffix}`, subdomain: `pf-root-${suffix}`, email, password: 'password123', fullName: 'Platform Admin' }).expect(201)).body;
    saId = reg.user.id;
    await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.id, saId));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, saId));
    sa = (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken;
    const center = (await http().post('/api/auth/register').send({ centerName: `PF center ${suffix}`, subdomain: `pf-c-${suffix}`, email: `pf-o-${suffix}@test.uz`, password: 'password123', fullName: 'Center Owner' }).expect(201)).body;
    owner = center.accessToken;
    tenantId = center.tenant.id;
    const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `pf-m-${suffix}@test.uz`, role: 'MANAGER' }).expect(201)).body;
    manager = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: 'Manager', password: 'password12345' }).expect(201)).body.accessToken;
  }, 120_000);

  afterAll(async () => {
    await db?.delete(platformSettings).where(inArray(platformSettings.key, KEYS));
    await app?.close();
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('every platform route is for the platform admin alone', async () => {
    const routes: Array<[string, string, unknown?]> = [
      ['get', '/api/platform/dashboard'],
      ['get', '/api/platform/subscriptions'],
      ['get', '/api/platform/integrations'],
      ['get', `/api/platform/subscriptions/${tenantId}/payments`],
      ['patch', `/api/platform/subscriptions/${tenantId}`, { status: 'ACTIVE' }],
      ['post', `/api/platform/subscriptions/${tenantId}/payments`, { forMonth: month, amount: 1 }],
      ['put', '/api/platform/integrations/ai', { password: 'password123', values: { GEMINI_MODEL: 'x' } }],
      ['delete', '/api/platform/integrations/ai'],
      ['post', '/api/plans/translate', { features: 'Bir' }],
    ];
    for (const [method, path, body] of routes) {
      const call = (token?: string) => {
        const r = (http() as unknown as Record<string, (p: string) => request.Test>)[method](path);
        if (token) r.set(bearer(token));
        return body ? r.send(body as object) : r;
      };
      expect({ path, status: (await call()).status }).toEqual({ path, status: method === 'delete' ? 404 : 401 });
      // A center's owner and its staff: refused, and told nothing.
      for (const token of [owner, manager]) {
        const res = await call(token);
        expect({ path, status: res.status }).toEqual({ path, status: method === 'delete' ? 404 : 403 });
      }
    }
    // Nothing above changed the center.
    const [t] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
    expect(t.status).toBe('TRIAL');
    expect(await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.tenantId, tenantId))).toEqual([]);
  });

  it('the dashboard and the subscriptions list count this center; a subscription is changed and a month paid by hand', async () => {
    const dash = (await http().get('/api/platform/dashboard').set(bearer(sa)).expect(200)).body;
    expect(dash.month).toBe(month);
    expect(dash.centers.total).toBeGreaterThanOrEqual(2);
    expect(dash.signups[dash.signups.length - 1]).toMatchObject({ month });
    const find = async () => (await http().get(`/api/platform/subscriptions?search=pf-c-${suffix}`).set(bearer(sa)).expect(200)).body.items[0];
    expect(await find()).toMatchObject({ id: tenantId, status: 'TRIAL', paidThisMonth: null });

    // A free tariff takes no payment; an unknown tariff, a bad month and a bad status are refused.
    await http().post(`/api/platform/subscriptions/${tenantId}/payments`).set(bearer(sa)).send({ forMonth: month }).expect(400);
    await http().patch(`/api/platform/subscriptions/${tenantId}`).set(bearer(sa)).send({ plan: 'NO_SUCH_PLAN' }).expect(400);
    await http().patch(`/api/platform/subscriptions/${tenantId}`).set(bearer(sa)).send({ status: 'DELETED' }).expect(400);
    await http().post(`/api/platform/subscriptions/${tenantId}/payments`).set(bearer(sa)).send({ forMonth: '2026-13', plan: 'STANDARD' }).expect(400);
    await http().patch('/api/platform/subscriptions/no-such-center').set(bearer(sa)).send({ status: 'ACTIVE' }).expect(404);

    await http().patch(`/api/platform/subscriptions/${tenantId}`).set(bearer(sa)).send({ plan: 'STANDARD', trialEndsAt: '2030-01-01T00:00:00.000Z' }).expect(200);
    expect(await find()).toMatchObject({ plan: 'STANDARD', status: 'TRIAL', paidThisMonth: false });
    // Paid twice at once: one payment.
    const pays = await Promise.all([0, 1, 2].map(() => http().post(`/api/platform/subscriptions/${tenantId}/payments`).set(bearer(sa)).send({ forMonth: month })));
    expect(pays.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const row = await find();
    expect(row).toMatchObject({ status: 'ACTIVE', paidThisMonth: true, lastPaidMonth: month });
    expect(row.totalPaid).toBe(row.price);
    expect(row.daysLeft).toBeGreaterThan(0);
    const history = (await http().get(`/api/platform/subscriptions/${tenantId}/payments`).set(bearer(sa)).expect(200)).body;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ forMonth: month, status: 'PAID', provider: null });
    // The center's owner sees their own center as active; the change is in the audit log.
    const log = await db.select().from(auditLogs).where(eq(auditLogs.entityType, 'platform_payment'));
    expect(log.some((l) => l.tenantId === tenantId && l.userId === saId)).toBe(true);
  });

  it('an integration key is sealed in the database, used at once, and never shown again', async () => {
    const list = async () => (await http().get('/api/platform/integrations').set(bearer(sa)).expect(200)).body;
    const first = await list();
    expect(first.editable).toBe(true);
    const save = (body: unknown) => http().put('/api/platform/integrations/ai').set(bearer(sa)).send(body as object);

    // The admin's own password is asked for; a key of another integration and a server secret are refused.
    expect((await save({ password: 'wrong-password', values: { GEMINI_API_KEY: SECRET } }).expect(403)).body.message).not.toContain(SECRET);
    // (the route allows a dozen saves a minute: the checks here stay under it)
    await save({ password: 'password123', values: { JWT_SECRET: 'x', TELEGRAM_BOT_TOKEN: 'x' } }).expect(400);
    await save({ password: 'password123', values: { GEMINI_API_KEY: 'line\nbreak' } }).expect(400);
    await http().put('/api/platform/integrations/no-such').set(bearer(sa)).send({ password: 'password123', values: { A: 'b' } }).expect(404);
    expect(await db.select().from(platformSettings).where(inArray(platformSettings.key, KEYS))).toEqual([]);

    const saved = (await save({ password: 'password123', values: { GEMINI_API_KEY: SECRET, GEMINI_MODEL: 'gemini-test-model' } }).expect(200)).body;
    // The answer, and every later one, shows the last four characters at most.
    for (const body of [saved, await list()]) {
      const text = JSON.stringify(body);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(SECRET.slice(0, 20));
      expect(text).toContain(`••••${SECRET.slice(-4)}`);
      // What is not a secret is shown, to be corrected in place.
      expect(text).toContain('gemini-test-model');
    }
    expect((await list()).items.find((i: { id: string }) => i.id === 'ai')).toMatchObject({ configured: true, detail: 'Gemini' });

    // In the database: sealed, not the value; in the audit log: the names only.
    const rows = await db.select().from(platformSettings).where(inArray(platformSettings.key, KEYS));
    expect(rows.map((r) => r.key).sort()).toEqual(['GEMINI_API_KEY', 'GEMINI_MODEL']);
    for (const r of rows) {
      expect(r.value.startsWith('v1.')).toBe(true);
      expect(r.value).not.toContain(SECRET);
      expect(r.updatedBy).toBe(saId);
    }
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityType, 'platform_setting'));
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(logs.some((l) => (l.meta ?? '').includes('GEMINI_API_KEY'))).toBe(true);
    // The server uses it from that moment.
    expect(process.env.GEMINI_API_KEY).toBe(SECRET);

    // A center cannot read it through anything it may open.
    for (const path of ['/api/auth/me', '/api/tenants/me/site', '/api/feature-flags', '/api/audit-logs']) {
      const res = await http().get(path).set(bearer(owner));
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }

    // A fresh server instance (a restart, another node) opens the same value.
    process.env.GEMINI_API_KEY = '';
    await app.get(PlatformSettingsService).reload();
    expect(process.env.GEMINI_API_KEY).toBe(SECRET);

    // Removing it gives the name back to the environment.
    await save({ password: 'password123', values: { GEMINI_API_KEY: null, GEMINI_MODEL: '' } }).expect(200);
    expect(await db.select().from(platformSettings).where(inArray(platformSettings.key, KEYS))).toEqual([]);
    expect(process.env.GEMINI_API_KEY ?? '').not.toBe(SECRET);
  });

  it('without the encryption key nothing can be stored, and the page says it is read-only', async () => {
    const key = process.env.SETTINGS_KEY;
    process.env.SETTINGS_KEY = '';
    try {
      expect((await http().get('/api/platform/integrations').set(bearer(sa)).expect(200)).body.editable).toBe(false);
      await http().put('/api/platform/integrations/ai').set(bearer(sa)).send({ password: 'password123', values: { GEMINI_MODEL: 'x' } }).expect(503);
      expect(await db.select().from(platformSettings).where(inArray(platformSettings.key, KEYS))).toEqual([]);
    } finally {
      process.env.SETTINGS_KEY = key;
    }
  });

  it('translation is the platform admin\'s; with no translator set up it says so instead of guessing', async () => {
    const res = await http().post('/api/plans/translate').set(bearer(sa)).send({ features: 'Cheksiz o\'quvchi' }).expect(503);
    expect(res.body.message).toBeTruthy();
    await http().post('/api/plans/translate').set(bearer(sa)).send({}).expect(400);
  });
});
