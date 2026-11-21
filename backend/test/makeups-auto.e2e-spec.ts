import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// A center may give a make-up credit for every absence: the credit is issued
// with the "absent" mark, once per missed lesson, and goes again when the
// mark is corrected to present. Off (the default), marks issue nothing.
describe('Make-up credits issued with the absence (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const suffix = Date.now();
  const local = (offsetDays: number) => new Date(Date.now() + 5 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
  let owner = '', group = '', kid = '', other = '';

  const mark = (date: string, entries: Array<{ studentId: string; status: string }>) =>
    http().post('/api/attendance').set(bearer(owner)).send({ groupId: group, date, entries }).expect(201);
  const live = async () => (await http().get('/api/makeups/credits').set(bearer(owner)).expect(200)).body
    .filter((c: { status: string }) => c.status !== 'CANCELLED') as Array<{ studentId: string; originDate: string; note: string | null; expiresAt: string | null }>;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `MkAuto ${suffix}`, subdomain: `mkauto-${suffix}`, email: `mkauto-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
    group = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'Auto G', subject: 'English', monthlyPrice: 300000, maxStudents: 10, startDate: local(-30) }).expect(201)).body.id;
    kid = (await http().post('/api/students').set(bearer(owner)).send({ fullName: 'Auto Kid', phone: `+99891${String(suffix).slice(-7)}`, groupIds: [group] }).expect(201)).body.id;
    other = (await http().post('/api/students').set(bearer(owner)).send({ fullName: 'Auto Other', phone: `+99892${String(suffix).slice(-7)}`, groupIds: [group] }).expect(201)).body.id;
  });
  afterAll(async () => { await app?.close(); });

  it('off by default: an absence issues nothing', async () => {
    await mark(local(-5), [{ studentId: kid, status: 'ABSENT' }, { studentId: other, status: 'PRESENT' }]);
    expect(await live()).toEqual([]);
  });

  it('on: the absent student gets one credit (with the expiry), marked again nothing more; present again voids it', async () => {
    await http().patch('/api/tenants/me').set(bearer(owner)).send({ makeupAutoIssue: true, makeupCreditDays: 14 }).expect(200);
    await mark(local(-3), [{ studentId: kid, status: 'ABSENT' }, { studentId: other, status: 'PRESENT' }]);
    let credits = await live();
    expect(credits.map((c) => [c.studentId, c.originDate, c.note])).toEqual([[kid, local(-3), 'Avtomatik']]);
    expect(credits[0].expiresAt).not.toBeNull();

    await mark(local(-3), [{ studentId: kid, status: 'ABSENT' }]);
    expect(await live()).toHaveLength(1);

    await mark(local(-3), [{ studentId: kid, status: 'PRESENT' }]);
    expect(await live()).toEqual([]);

    // Absent once more: a fresh credit (the voided one freed the lesson).
    await mark(local(-3), [{ studentId: kid, status: 'ABSENT' }]);
    credits = await live();
    expect(credits).toHaveLength(1);

    // A staff "issue" for the same absence: it is there already.
    await http().post('/api/makeups/credits').set(bearer(owner)).send({ studentId: kid, groupId: group, date: local(-3), reason: 'ABSENT' }).expect(409);
  });
});
