import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// Large lists page and filter on the server when asked; callers that do not
// ask get the whole list exactly as before.
describe('Server-side list pages (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  let auth: Record<string, string>, teacher: Record<string, string>, other: Record<string, string>;
  let g1: string;
  const month = new Date().toISOString().slice(0, 7);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    const reg = async (k: string) => (await http().post('/api/auth/register')
      .send({ centerName: `Page ${k} ${suffix}`, subdomain: `page-${k}-${suffix}`, email: `page-${k}-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' }).expect(201)).body.accessToken;
    auth = { Authorization: `Bearer ${await reg('a')}` };
    other = { Authorization: `Bearer ${await reg('b')}` };
    const inv = (await http().post('/api/invitations').set(auth).send({ email: `page-t-${suffix}@test.uz`, role: 'TEACHER' }).expect(201)).body;
    const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: 'Page T', password: 'password12345' }).expect(201)).body;
    teacher = { Authorization: `Bearer ${acc.accessToken}` };
    const tch = (await http().post('/api/teachers').set(auth).send({ fullName: 'Page T', userId: acc.user.id, subject: 'Math' }).expect(201)).body.id;
    g1 = (await http().post('/api/groups').set(auth).send({ name: 'Page G', subject: 'Math', teacherId: tch, maxStudents: 30 }).expect(201)).body.id;
    for (let i = 1; i <= 7; i++) {
      const s = (await http().post('/api/students').set(auth).send({ fullName: `Pager ${i === 3 ? 'Zebo' : 'Student'} ${i}`, phone: `+9989077700${i}`, groupIds: i <= 4 ? [g1] : [] }).expect(201)).body.id;
      await http().post('/api/payments').set(auth).send({ studentId: s, amount: 100_000 * i, forMonth: month, method: i % 2 ? 'CASH' : 'BANK_TRANSFER', idempotencyKey: `pg-${suffix}-${i}` }).expect(201);
      if (i <= 4) await http().post('/api/attendance').set(auth).send({ groupId: g1, date: `2026-09-0${i}`, entries: [{ studentId: s, status: 'PRESENT' }] }).expect(201);
    }
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  it('students: pages with a total; search on the server; no page = the old full array', async () => {
    const all = (await http().get('/api/students').set(auth).expect(200)).body;
    expect(Array.isArray(all)).toBe(true);
    expect(all).toHaveLength(7);
    const p1 = (await http().get('/api/students?page=1&pageSize=3').set(auth).expect(200)).body;
    expect(p1).toMatchObject({ total: 7, page: 1, pageSize: 3 });
    expect(p1.items).toHaveLength(3);
    const p3 = (await http().get('/api/students?page=3&pageSize=3').set(auth).expect(200)).body;
    expect(p3.items).toHaveLength(1);
    const ids = new Set([...p1.items, ...(await http().get('/api/students?page=2&pageSize=3').set(auth)).body.items, ...p3.items].map((s: { id: string }) => s.id));
    expect(ids.size).toBe(7); // no row twice, none missing
    expect((await http().get('/api/students?search=zebo').set(auth).expect(200)).body.map((s: { fullName: string }) => s.fullName)).toEqual(['Pager Zebo 3']);
    expect((await http().get('/api/students?search=%25&page=1').set(auth).expect(200)).body.total).toBe(0); // % is literal
    expect((await http().get('/api/students?search=77007&page=1').set(auth).expect(200)).body.total).toBe(1);
    // A teacher's pages stay inside their own groups; another center sees none.
    expect((await http().get('/api/students?page=1&pageSize=50').set(teacher).expect(200)).body.total).toBe(4);
    expect((await http().get('/api/students?page=1').set(other).expect(200)).body.total).toBe(0);
  });

  it('payments: pages and server filters; no page = the old full array', async () => {
    expect((await http().get('/api/payments').set(auth).expect(200)).body).toHaveLength(7);
    const p = (await http().get('/api/payments?page=2&pageSize=5').set(auth).expect(200)).body;
    expect(p).toMatchObject({ total: 7, page: 2 });
    expect(p.items).toHaveLength(2);
    expect((await http().get('/api/payments?page=1&method=CASH').set(auth).expect(200)).body.total).toBe(4);
    expect((await http().get(`/api/payments?page=1&forMonth=1999-01`).set(auth).expect(200)).body.total).toBe(0);
    await http().get('/api/payments?page=1&method=CARD').set(auth).expect(400);
    await http().get('/api/payments?status=NOPE').set(auth).expect(400);
    expect((await http().get('/api/payments?page=1').set(other).expect(200)).body.total).toBe(0);
  });

  it('attendance: date range and pages', async () => {
    expect((await http().get('/api/attendance').set(auth).expect(200)).body).toHaveLength(4);
    const r = (await http().get('/api/attendance?from=2026-09-02&to=2026-09-03').set(auth).expect(200)).body;
    expect(r.map((a: { date: string }) => a.date).sort()).toEqual(['2026-09-02', '2026-09-03']);
    const p = (await http().get('/api/attendance?page=1&pageSize=3').set(auth).expect(200)).body;
    expect(p).toMatchObject({ total: 4, pageSize: 3 });
    expect(p.items[0].date).toBe('2026-09-04');
    await http().get('/api/attendance?page=0').set(auth).expect(400);
    await http().get('/api/attendance?page=1&pageSize=501').set(auth).expect(400);
  });
});
