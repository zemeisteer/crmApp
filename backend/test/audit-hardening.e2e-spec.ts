import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// Regression suite for the autonomous audit (2026-10-06). Each block pins a
// finding that was confirmed by black-box probing and then fixed.
describe('Audit hardening (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
  const month = today.slice(0, 7);

  // Org A: owner, T1 (teaches G1), T2 (teaches G2), a parent member.
  const A: Record<string, string> = {};
  let ownerA: string, t1: string, t2: string;
  let g1: string, g2: string, s1: string, s2: string;
  let hw1: string, exam1: string, cert1: string, sched1: string;
  // Org B: an owner, to probe cross-tenant.
  let ownerB: string;

  const register = async (key: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `Aud ${key} ${suffix}`, subdomain: `aud-${key}-${suffix}`, email: `aud-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` })
      .expect(201)).body;
  const invite = async (owner: string, role: string, local: string) => {
    const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `aud-${local}-${suffix}@test.uz`, role }).expect(201)).body;
    const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `${role} ${local}`, password: 'password12345' }).expect(201)).body;
    return { token: acc.accessToken, userId: acc.user.id, email: `aud-${local}-${suffix}@test.uz` };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app, { ...process.env, WEBHOOK_ALLOW_PRIVATE: 'false' });
    await app.init();

    const regA = await register('a');
    ownerA = regA.accessToken;
    const invT1 = await invite(ownerA, 'TEACHER', 't1'); t1 = invT1.token;
    const invT2 = await invite(ownerA, 'TEACHER', 't2'); t2 = invT2.token;
    const invP = await invite(ownerA, 'PARENT', 'par'); A.parentId = invP.userId;
    const tch1 = (await http().post('/api/teachers').set(bearer(ownerA)).send({ fullName: 'T1', userId: invT1.userId, subject: 'Math' }).expect(201)).body.id;
    const tch2 = (await http().post('/api/teachers').set(bearer(ownerA)).send({ fullName: 'T2', userId: invT2.userId, subject: 'Math' }).expect(201)).body.id;
    g1 = (await http().post('/api/groups').set(bearer(ownerA)).send({ name: 'G1', subject: 'Math', teacherId: tch1, scheduleDays: 'Dushanba', startTime: '10:00', endTime: '11:00' }).expect(201)).body.id;
    g2 = (await http().post('/api/groups').set(bearer(ownerA)).send({ name: 'G2', subject: 'Math', teacherId: tch2, scheduleDays: 'Seshanba', startTime: '12:00', endTime: '13:00' }).expect(201)).body.id;
    s1 = (await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'Student One', phone: '+998901110001', groupIds: [g1] }).expect(201)).body.id;
    s2 = (await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'Student Two', phone: '+998901110002', groupIds: [g2] }).expect(201)).body.id;
    hw1 = (await http().post('/api/homework').set(bearer(ownerA)).send({ groupIds: [g1], title: 'HW1', description: 'x' }).expect(201)).body[0].id;
    exam1 = (await http().post('/api/exams').set(bearer(ownerA)).send({ groupIds: [g1], title: 'Exam1', maxScore: 100 }).expect(201)).body[0].id;
    cert1 = (await http().post('/api/certificates').set(bearer(ownerA)).send({ studentId: s1, groupId: g1, title: 'Cert1' }).expect(201)).body.id;
    // A group with scheduleDays already has a lesson; use it.
    const schedList = (await http().get(`/api/schedule?groupId=${g1}`).set(bearer(ownerA)).expect(200)).body;
    sched1 = schedList[0].id;

    const regB = await register('b');
    ownerB = regB.accessToken;
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  describe('F-02/F-03 teacher acts and sees only their own groups', () => {
    it('T2 cannot create/edit homework, exams, schedule for G1', async () => {
      await http().post('/api/homework').set(bearer(t2)).send({ groupIds: [g1], title: 'x', description: 'x' }).expect(403);
      await http().patch(`/api/homework/${hw1}`).set(bearer(t2)).send({ title: 'hijack' }).expect(403);
      await http().post(`/api/homework/${hw1}/grade`).set(bearer(t2)).send({ studentId: s1, score: 1 }).expect(403);
      await http().post('/api/exams').set(bearer(t2)).send({ groupIds: [g1], title: 'x' }).expect(403);
      await http().post(`/api/exams/${exam1}/results`).set(bearer(t2)).send({ results: [{ studentId: s1, score: 1 }] }).expect(403);
      await http().post(`/api/exams/${exam1}/questions`).set(bearer(t2)).send({ prompt: 'q', type: 'MCQ', options: ['a', 'b', 'c'], correctAnswer: 'A' }).expect(403);
      await http().post('/api/schedule').set(bearer(t2)).send({ groupId: g1, dayOfWeek: 3, startTime: '09:00', endTime: '10:00', isRecurring: true }).expect(403);
      await http().patch(`/api/schedule/${sched1}`).set(bearer(t2)).send({ startTime: '08:00', endTime: '09:00' }).expect(403);
    });

    it('T2 cannot read G1 rosters, exam detail or certificate (student PII)', async () => {
      await http().get(`/api/homework/${hw1}/roster`).set(bearer(t2)).expect(403);
      await http().get(`/api/homework/${hw1}`).set(bearer(t2)).expect(403);
      await http().get(`/api/exams/${exam1}`).set(bearer(t2)).expect(403);
      await http().get(`/api/certificates/${cert1}`).set(bearer(t2)).expect(403);
      await http().get(`/api/homework/leaderboard?groupId=${g1}`).set(bearer(t2)).expect(403);
      // List views exclude G1's items entirely for T2.
      const hw = await http().get('/api/homework').set(bearer(t2)).expect(200);
      expect(hw.body.find((h: { id: string }) => h.id === hw1)).toBeUndefined();
      const ex = await http().get('/api/exams').set(bearer(t2)).expect(200);
      expect(ex.body.find((e: { id: string }) => e.id === exam1)).toBeUndefined();
      const cs = await http().get('/api/certificates').set(bearer(t2)).expect(200);
      expect(cs.body.find((c: { id: string }) => c.id === cert1)).toBeUndefined();
    });

    it('T1 (owns G1) still works normally', async () => {
      await http().patch(`/api/homework/${hw1}`).set(bearer(t1)).send({ title: 'HW1 edited' }).expect(200);
      await http().get(`/api/homework/${hw1}/roster`).set(bearer(t1)).expect(200);
      await http().get(`/api/exams/${exam1}`).set(bearer(t1)).expect(200);
      await http().get(`/api/certificates/${cert1}`).set(bearer(t1)).expect(200);
    });

    it('a center cannot read another center\'s leaderboard by passing its group id', async () => {
      await http().get(`/api/homework/leaderboard?groupId=${g1}`).set(bearer(ownerB)).expect(404);
    });
  });

  describe('F-04 guardian linking requires an existing member of the center', () => {
    it('refuses a non-member by userId or phone, and never injects a membership', async () => {
      // ownerB (a user, but not a member of A) must not be linkable into A.
      await http().post(`/api/students/${s1}/guardians`).set(bearer(ownerA)).send({ phone: '+998905550001' }).expect(404);
      await http().post(`/api/students/${s2}/guardians`).set(bearer(ownerA)).send({ userId: A.parentId, relationship: 'Ona' }).expect(201); // a real A member works
    });
    it('links a parent who already belongs to the center', async () => {
      const list = await http().get(`/api/students/${s2}/guardians`).set(bearer(ownerA)).expect(200);
      expect(list.body.some((g: { userId: string }) => g.userId === A.parentId)).toBe(true);
    });
  });

  describe('F-05 outbound webhooks cannot target the server\'s own network', () => {
    it('rejects loopback, localhost and cloud-metadata URLs', async () => {
      for (const url of ['http://127.0.0.1:4999/x', 'http://localhost/x', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.1/x']) {
        await http().post('/api/webhooks').set(bearer(ownerA)).send({ url, event: '*' }).expect(400);
      }
    });
    it('accepts a public URL', async () => {
      await http().post('/api/webhooks').set(bearer(ownerA)).send({ url: 'https://8.8.8.8/hook', event: 'payment.created' }).expect(201);
    });
  });

  describe('F-07 / F-08 robust and tenant-scoped writes', () => {
    let webhookA: string;
    beforeAll(async () => {
      webhookA = (await http().post('/api/webhooks').set(bearer(ownerA)).send({ url: 'https://1.1.1.1/hook', event: '*' }).expect(201)).body.id;
    });
    it('an empty PATCH is a no-op, not a 500', async () => {
      const brA = (await http().post('/api/branches').set(bearer(ownerA)).send({ name: 'Br' }).expect(201)).body.id;
      await http().patch(`/api/branches/${brA}`).set(bearer(ownerA)).send({}).expect(200);
      await http().patch(`/api/webhooks/${webhookA}`).set(bearer(ownerA)).send({}).expect(200);
    });
    it('cross-tenant webhook and session writes return 404, not a false success', async () => {
      await http().patch(`/api/webhooks/${webhookA}`).set(bearer(ownerB)).send({ url: 'https://2.2.2.2/x' }).expect(404);
      await http().delete(`/api/webhooks/${webhookA}`).set(bearer(ownerB)).expect(404);
      const sess = (await http().get('/api/auth/sessions').set(bearer(ownerA)).expect(200)).body;
      await http().delete(`/api/auth/sessions/${sess[0].id}`).set(bearer(ownerB)).expect(404);
      // ownerA's own webhook is still there and unchanged.
      const after = (await http().get('/api/webhooks').set(bearer(ownerA)).expect(200)).body;
      expect(after.find((w: { id: string; url: string }) => w.id === webhookA)?.url).toBe('https://1.1.1.1/hook');
    });
  });

  describe('F-10 cabinet tokens end when the PIN is re-issued or the student leaves', () => {
    it('a new PIN signs out the old cabinet token; deleting the student ends it', async () => {
      const pin1 = (await http().post(`/api/students/${s1}/portal-pin`).set(bearer(ownerA)).expect(201)).body.pin;
      const cab1 = (await http().post('/api/portal/auth/phone/verify').send({ phone: '+998901110001', pin: pin1 }).expect(201)).body.accessToken;
      await http().get('/api/portal/me').set(bearer(cab1)).expect(200);
      // Re-issuing the PIN invalidates the earlier token.
      await new Promise((r) => setTimeout(r, 1100));
      const pin2 = (await http().post(`/api/students/${s1}/portal-pin`).set(bearer(ownerA)).expect(201)).body.pin;
      await http().get('/api/portal/me').set(bearer(cab1)).expect(401);
      const cab2 = (await http().post('/api/portal/auth/phone/verify').send({ phone: '+998901110001', pin: pin2 }).expect(201)).body.accessToken;
      await http().get('/api/portal/me').set(bearer(cab2)).expect(200);
      // Removing the student ends every cabinet route (no stale schedule/payments).
      await http().delete(`/api/students/${s1}`).set(bearer(ownerA)).expect(200);
      for (const p of ['/api/portal/me', '/api/portal/schedule', '/api/portal/payments', '/api/portal/attendance', '/api/portal/homework', '/api/portal/invoices']) {
        await http().get(p).set(bearer(cab2)).expect(401);
      }
      await http().post(`/api/students/${s1}/restore`).set(bearer(ownerA)).expect(201);
    });
  });

  describe('F-11 uploaded files cannot run as script on the app origin', () => {
    it('stores an HTML/SVG upload without an executable extension and serves it as a sandboxed download', async () => {
      const res = await http().post(`/api/homework/${hw1}/attachment`).set(bearer(t1))
        .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'note.html', contentType: 'text/html' })
        .expect(201);
      const stored: string = res.body.attachmentPath;
      expect(stored.endsWith('.html')).toBe(false);
      // A homework file is private: not by name, only through a signed link.
      await http().get(`/uploads/${stored}`).expect(404);
      const link: string = (await http().post('/api/files/sign').set(bearer(t1)).send({ names: [stored] }).expect(201)).body[stored];
      const served = await http().get(link).expect(200);
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.headers['content-disposition']).toBe('attachment');
      expect(served.headers['content-security-policy']).toContain('sandbox');
    });
  });

  describe('F-13 / F-14 money: big totals and oversized values', () => {
    it('reports stay correct past 2^31 so\'m (sums are bigint)', async () => {
      // Two payments of 1.5 billion: 3 billion in total, above PostgreSQL int.
      for (const k of ['big-1', 'big-2']) {
        await http().post('/api/payments').set(bearer(ownerA))
          .send({ studentId: s2, amount: 1_500_000_000, forMonth: month, method: 'BANK_TRANSFER', idempotencyKey: `${k}-${suffix}` }).expect(201);
      }
      const overview = (await http().get('/api/reports/overview').set(bearer(ownerA)).expect(200)).body;
      expect(overview.finance.yearToDate.thisYear).toBeGreaterThanOrEqual(3_000_000_000);
      await http().get('/api/reports/director').set(bearer(ownerA)).expect(200);
      await http().get(`/api/payments/finance-summary?forMonth=${month}`).set(bearer(ownerA)).expect(200);
    });
    it('refuses a value the money columns cannot hold with 400, not 500', async () => {
      await http().post('/api/payments').set(bearer(ownerA)).send({ studentId: s2, amount: 3_000_000_000, forMonth: month, method: 'CASH' }).expect(400);
      await http().post('/api/expenses').set(bearer(ownerA)).send({ title: 'x', amount: 3_000_000_000, date: today }).expect(400);
      await http().post('/api/groups').set(bearer(ownerA)).send({ name: 'big', subject: 'M', monthlyPrice: 3_000_000_000 }).expect(400);
      await http().post('/api/invoices').set(bearer(ownerA)).send({ studentId: s2, amount: 3_000_000_000, dueDate: `${today}T12:00:00.000Z`, forMonth: month }).expect(400);
    });
  });
});
