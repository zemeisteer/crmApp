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
import { plans, tenants } from '../src/db/schema.js';
import { CustomDomainsService } from '../src/custom-domains/custom-domains.service.js';

// A center's own domain for its public site: added, proved with a DNS TXT
// record, and only then resolved; one center per verified domain. The DNS
// answer is replaced here (no real lookup).
describe('Custom domains (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  let service: CustomDomainsService;
  const suffix = Date.now();
  const tail = String(suffix).slice(-5);
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const dnsRecords = new Map<string, string[][]>();
  // The platform's own domain, whatever the environment says.
  const ROOT = 'talimcrm.test';
  const before = process.env.ROOT_DOMAIN;
  let n = 0;

  const center = async () => {
    const key = `cd${++n}${tail}`;
    const body = (await http().post('/api/auth/register').send({ centerName: `CD ${key}`, subdomain: key, email: `${key}@test.uz`, password: 'password123', fullName: `Owner ${key}` }).expect(201)).body;
    await db.update(tenants).set({ status: 'ACTIVE' }).where(eq(tenants.id, body.tenant.id));
    return { id: body.tenant.id as string, token: body.accessToken as string, sub: key };
  };
  const add = (c: { token: string }, domain: string) => http().post('/api/custom-domains').set(bearer(c.token)).send({ domain });

  beforeAll(async () => {
    process.env.ROOT_DOMAIN = ROOT;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    service = app.get(CustomDomainsService);
    vi.spyOn(service, 'resolveTxt').mockImplementation(async (name: string) => dnsRecords.get(name) ?? []);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (before === undefined) delete process.env.ROOT_DOMAIN;
    else process.env.ROOT_DOMAIN = before;
  });

  it('only a real domain of the center: not the platform own, not localhost, not an address', async () => {
    const c = await center();
    for (const bad of ['academy', 'localhost', `x.${ROOT}`, ROOT, '10.0.0.1', 'bad_domain.uz', '-a.uz']) {
      const res = await add(c, bad);
      expect([bad, res.status]).toEqual([bad, 400]);
    }
    const ok = (await add(c, `HTTPS://Academy-${tail}.UZ/`).expect(201)).body;
    expect(ok).toMatchObject({ domain: `academy-${tail}.uz`, verified: false, txtName: `_talimcrm.academy-${tail}.uz` });
    expect(ok.txtValue).toMatch(/^talimcrm-[0-9a-f]{24}$/);
  });

  it('resolves only after the TXT record proves it; then the site front door finds the center', async () => {
    const c = await center();
    const domain = `school-${tail}.uz`;
    const d = (await add(c, domain).expect(201)).body;
    await http().get(`/api/custom-domains/resolve/${domain}`).expect(404);
    const no = await http().post(`/api/custom-domains/${d.id}/verify`).set(bearer(c.token));
    expect([no.status, no.body.code]).toEqual([400, 'DOMAIN_NOT_VERIFIED']);
    dnsRecords.set(`_talimcrm.${domain}`, [[d.txtValue]]);
    const yes = (await http().post(`/api/custom-domains/${d.id}/verify`).set(bearer(c.token)).expect(201)).body;
    expect(yes.verified).toBe(true);
    expect((await http().get(`/api/custom-domains/resolve/${domain.toUpperCase()}:443`).expect(200)).body).toEqual({ subdomain: c.sub });
  });

  it('another center may claim a domain but cannot take a verified one; claiming takes nothing from the owner', async () => {
    const [a, b] = [await center(), await center()];
    const domain = `shared-${tail}.uz`;
    const da = (await add(a, domain).expect(201)).body;
    const db_ = (await add(b, domain).expect(201)).body;
    dnsRecords.set(`_talimcrm.${domain}`, [[da.txtValue], [db_.txtValue]]);
    await http().post(`/api/custom-domains/${da.id}/verify`).set(bearer(a.token)).expect(201);
    const taken = await http().post(`/api/custom-domains/${db_.id}/verify`).set(bearer(b.token));
    expect([taken.status, taken.body.code]).toEqual([409, 'DOMAIN_TAKEN']);
    expect((await http().get(`/api/custom-domains/resolve/${domain}`).expect(200)).body.subdomain).toBe(a.sub);
    // One center cannot see or remove the other's.
    await http().delete(`/api/custom-domains/${da.id}`).set(bearer(b.token)).expect(404);
    await http().delete(`/api/custom-domains/${da.id}`).set(bearer(a.token)).expect(200);
    await http().get(`/api/custom-domains/resolve/${domain}`).expect(404);
  });

  it('three domains per center; the plan can leave the feature out', async () => {
    const c = await center();
    for (let i = 0; i < 3; i++) await add(c, `many${i}-${tail}.uz`).expect(201);
    expect((await add(c, `many3-${tail}.uz`)).body.code).toBe('DOMAIN_LIMIT');
    const d = await center();
    const key = `CD_${tail}`;
    await db.insert(plans).values({ key, name: key, price: 1, entitlements: { CUSTOM_DOMAIN: false } });
    await db.update(tenants).set({ plan: key }).where(eq(tenants.id, d.id));
    const res = await add(d, `nope-${tail}.uz`);
    expect([res.status, res.body.code]).toEqual([403, 'PLAN_FEATURE']);
  });
});
