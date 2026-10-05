import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// The roles matrix shown to the owner is the guards' own answer: for every
// capability and every role, a real request is refused (403) exactly when
// the matrix says "no".
describe('Access matrix (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  const tokens: Record<string, string> = {};
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    tokens.OWNER = (await http().post('/api/auth/register')
      .send({ centerName: `Acc ${suffix}`, subdomain: `acc-${suffix}`, email: `acc-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST', 'ACCOUNTANT', 'TEACHER']) {
      const inv = await http().post('/api/invitations').set(as('OWNER')).send({ email: `acc-${role.toLowerCase()}-${suffix}@test.uz`, role }).expect(201);
      tokens[role] = (await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: `${role} user`, password: 'password12345' }).expect(201)).body.accessToken;
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('every capability names a route that exists', async () => {
    const m = (await http().get('/api/access/matrix').set(as('OWNER')).expect(200)).body;
    expect(m.missing).toEqual([]);
    expect(m.roles).toEqual(['OWNER', 'ADMIN', 'MANAGER', 'RECEPTIONIST', 'ACCOUNTANT', 'TEACHER']);
    // A few known rules, as a reader would check them.
    const row = (k: string) => m.capabilities.find((c: { key: string }) => c.key === k).allowed;
    expect(row('payments.take')).toMatchObject({ OWNER: true, ACCOUNTANT: true, RECEPTIONIST: false, TEACHER: false });
    expect(row('payroll.rates')).toMatchObject({ OWNER: true, ACCOUNTANT: true, MANAGER: false, TEACHER: false });
    expect(row('payroll.own')).toMatchObject({ TEACHER: true, OWNER: false });
    expect(row('leads.view')).toMatchObject({ MANAGER: true, RECEPTIONIST: true, ACCOUNTANT: false, TEACHER: false });
  });

  it('says "no" exactly where a real request is refused', async () => {
    const m = (await http().get('/api/access/matrix').set(as('OWNER')).expect(200)).body;
    const mismatches: string[] = [];
    for (const c of m.capabilities as Array<{ key: string; route: string | null; allowed: Record<string, boolean> }>) {
      if (!c.route) continue;
      const [method, path] = c.route.split(' ');
      const url = path.replace(':id', 'no-such-id').replace(':kind', 'teachers');
      for (const role of m.roles as string[]) {
        const req = http()[method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](url).set(as(role));
        // An empty body: refused by the guard (403) before validation, or
        // refused by validation / not found when allowed - nothing is made.
        const res = method === 'GET' || method === 'DELETE' ? await req : await req.send({});
        const refused = res.status === 403;
        if (refused === c.allowed[role]) mismatches.push(`${c.key} ${role}: matrix ${c.allowed[role] ? 'yes' : 'no'}, ${method} ${url} -> ${res.status}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('is for the owner and admins only', async () => {
    await http().get('/api/access/matrix').set(as('ADMIN')).expect(200);
    for (const role of ['MANAGER', 'RECEPTIONIST', 'ACCOUNTANT', 'TEACHER']) await http().get('/api/access/matrix').set(as(role)).expect(403);
  });
});
