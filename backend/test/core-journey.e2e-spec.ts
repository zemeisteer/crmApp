import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// The path a pilot center walks on its first day, end to end through the
// public API: set the center up, staff sign in, a lead comes in, has a trial
// lesson, is enrolled, attends, is invoiced, pays - and the student and the
// parent see it all in their cabinets.
describe('Core journey: lead to paid student (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tz = 'Asia/Tashkent';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const month = today.slice(0, 7);
  const phone = `+99894${String(suffix).slice(-7)}`;
  const parentPhone = `+99895${String(suffix).slice(-7)}`;

  let owner: string;
  let receptionist: string;
  let accountant: string;
  let groupId: string;
  let leadId: string;
  let studentId: string;
  let invoiceId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('1. the center is set up: owner, a teacher, a group, front-desk and finance staff', async () => {
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Journey ${suffix}`, subdomain: `journey-${suffix}`, email: `journey-${suffix}@test.uz`, password: 'password123', fullName: 'Journey Owner' })
      .expect(201)).body;
    owner = reg.accessToken;
    expect(reg.tenant.subdomain).toBe(`journey-${suffix}`);

    const teacher = (await http().post('/api/teachers').set(bearer(owner)).send({ fullName: 'Journey Teacher', subject: 'English' }).expect(201)).body.id;
    groupId = (await http().post('/api/groups').set(bearer(owner))
      .send({ name: 'Journey English', subject: 'English', monthlyPrice: 400_000, teacherId: teacher, maxStudents: 10 }).expect(201)).body.id;

    const invite = async (role: string) => {
      const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `${role.toLowerCase()}-j-${suffix}@test.uz`, role }).expect(201)).body;
      await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `${role} J`, password: 'password12345' }).expect(201);
    };
    await invite('RECEPTIONIST');
    await invite('ACCOUNTANT');
  });

  it('2. staff sign in with their own accounts and land in this center', async () => {
    const signIn = async (role: string) => {
      const res = (await http().post('/api/auth/login').send({ email: `${role.toLowerCase()}-j-${suffix}@test.uz`, password: 'password12345' }).expect(201)).body;
      expect(res.user.role).toBe(role);
      expect(res.tenant.subdomain).toBe(`journey-${suffix}`);
      expect(typeof res.refreshToken).toBe('string');
      const me = (await http().get('/api/auth/me').set(bearer(res.accessToken)).expect(200)).body;
      expect(me.user.role).toBe(role);
      return res.accessToken as string;
    };
    receptionist = await signIn('RECEPTIONIST');
    accountant = await signIn('ACCOUNTANT');
  });

  it('3. a lead comes in and is contacted', async () => {
    const lead = (await http().post('/api/leads').set(bearer(receptionist)).send({ fullName: 'Journey Student', phone, source: 'WALK_IN' }).expect(201)).body;
    leadId = lead.id;
    expect(lead.status).toBe('NEW');
    await http().post(`/api/leads/${leadId}/transition`).set(bearer(receptionist)).send({ toStatus: 'CONTACTED' }).expect(201);
  });

  it('4. a trial lesson is booked and attended', async () => {
    const day = new Date(Date.now() + 3 * 86_400_000 + 5 * 3_600_000).toISOString().slice(0, 10);
    const trial = (await http().post(`/api/leads/${leadId}/trials`).set(bearer(receptionist)).send({ scheduledAt: `${day}T07:00:00+05:00` }).expect(201)).body;
    await http().post(`/api/leads/${leadId}/trials/${trial.id}/attend`).set(bearer(receptionist)).send({}).expect(201);
    expect((await http().get(`/api/leads/${leadId}`).set(bearer(owner)).expect(200)).body.status).toBe('TRIAL_ATTENDED');
    await http().post(`/api/leads/${leadId}/transition`).set(bearer(owner)).send({ toStatus: 'QUALIFIED' }).expect(201);
  });

  it('5. the lead is enrolled: a student in the group, with the first invoice', async () => {
    const res = (await http().post(`/api/leads/${leadId}/convert`).set(bearer(owner))
      .send({ groupIds: [groupId], guardianPhone: parentPhone, createInvoice: true, invoiceForMonth: month, invoiceDueDate: `${today}T12:00:00.000Z` })
      .expect(201)).body;
    expect(res.studentCreated).toBe(true);
    expect(res.lead.status).toBe('ENROLLED');
    studentId = res.student.id;
    invoiceId = res.invoice.id;
    expect(res.invoice).toMatchObject({ amount: 400_000, remainingAmount: 400_000, forMonth: month, status: 'OPEN' });

    const student = (await http().get(`/api/students/${studentId}`).set(bearer(owner)).expect(200)).body;
    expect(student.enrollments.map((e: { groupId: string; status: string }) => [e.groupId, e.status])).toEqual([[groupId, 'ACTIVE']]);
    // Doing it twice changes nothing.
    const again = (await http().post(`/api/leads/${leadId}/convert`).set(bearer(owner)).send({}).expect(201)).body;
    expect(again.alreadyConverted).toBe(true);
    expect(again.student.id).toBe(studentId);
  });

  it('6. attendance is marked', async () => {
    const marks = (await http().post('/api/attendance').set(bearer(owner))
      .send({ groupId, date: today, entries: [{ studentId, status: 'PRESENT' }] }).expect(201)).body;
    expect(marks).toHaveLength(1);
    expect(marks[0].status).toBe('PRESENT');
  });

  it('7. the student is shown as owing the invoice; the accountant takes a part payment, then the rest', async () => {
    const before = (await http().get(`/api/payments/debtors?forMonth=${month}`).set(bearer(accountant)).expect(200)).body;
    expect(before.debtors.find((d: { studentId: string }) => d.studentId === studentId)).toMatchObject({ expectedAmount: 400_000, debtAmount: 400_000, status: 'UNPAID', estimated: false });

    // The front desk may look but not take money.
    await http().post('/api/payments').set(bearer(receptionist)).send({ studentId, amount: 150_000, forMonth: month, method: 'CASH' }).expect(403);

    const key = `journey-${suffix}-part`;
    const part = (await http().post('/api/payments').set(bearer(accountant))
      .send({ studentId, amount: 150_000, forMonth: month, method: 'CASH', idempotencyKey: key }).expect(201)).body;
    expect(part.receiptNumber).toMatch(/^RCP-/);
    expect(part.student.fullName).toBe('Journey Student');
    // The button was pressed twice: still one payment.
    const twice = (await http().post('/api/payments').set(bearer(accountant))
      .send({ studentId, amount: 150_000, forMonth: month, method: 'CASH', idempotencyKey: key }).expect(201)).body;
    expect(twice.id).toBe(part.id);

    let inv = (await http().get(`/api/invoices/${invoiceId}`).set(bearer(accountant)).expect(200)).body;
    expect(inv).toMatchObject({ amountPaid: 150_000, remainingAmount: 250_000, status: 'PARTIALLY_PAID' });
    const mid = (await http().get(`/api/payments/debtors?forMonth=${month}`).set(bearer(accountant)).expect(200)).body;
    expect(mid.debtors.find((d: { studentId: string }) => d.studentId === studentId)).toMatchObject({ paidAmount: 150_000, debtAmount: 250_000, status: 'PARTIAL' });

    // The rest, with a 10 000 discount.
    await http().post('/api/payments').set(bearer(accountant))
      .send({ studentId, amount: 240_000, discount: 10_000, forMonth: month, method: 'CLICK' }).expect(201);
    inv = (await http().get(`/api/invoices/${invoiceId}`).set(bearer(accountant)).expect(200)).body;
    expect(inv).toMatchObject({ amountPaid: 390_000, remainingAmount: 0, status: 'PAID' });

    const after = (await http().get(`/api/payments/debtors?forMonth=${month}`).set(bearer(accountant)).expect(200)).body;
    expect(after.debtors.find((d: { studentId: string }) => d.studentId === studentId)).toMatchObject({ paidAmount: 390_000, discountAmount: 10_000, debtAmount: 0, status: 'PAID' });
    const fin = (await http().get(`/api/payments/finance-summary?forMonth=${month}`).set(bearer(accountant)).expect(200)).body;
    expect(fin).toMatchObject({ totalRevenue: 390_000, totalOutstandingDebt: 0, debtorCount: 0, revenueByMethod: { CASH: 150_000, CLICK: 240_000 } });
  });

  it('8. the student and the parent see the lessons, attendance and payments in their cabinets', async () => {
    const { pin } = (await http().post(`/api/students/${studentId}/portal-pin`).set(bearer(owner)).expect(201)).body;
    const s = bearer((await http().post('/api/portal/auth/phone/verify').send({ phone, pin }).expect(201)).body.accessToken);
    const p = bearer((await http().post('/api/portal/auth/phone/verify').send({ phone: parentPhone, pin }).expect(201)).body.accessToken);

    for (const [who, viewer] of [[s, 'student'], [p, 'parent']] as const) {
      const me = (await http().get('/api/portal/me').set(who).expect(200)).body;
      expect(me).toMatchObject({ id: studentId, viewer });
      const attendance = (await http().get('/api/portal/attendance').set(who).expect(200)).body;
      expect(JSON.stringify(attendance)).toContain('PRESENT');
      const pay = (await http().get('/api/portal/payments').set(who).expect(200)).body;
      expect(pay).toMatchObject({ forMonth: month, expectedTuition: 400_000, monthPaid: 390_000, debtAmount: 0, status: 'PAID' });
      expect(pay.history).toHaveLength(2);
      expect(pay.history[0]).not.toHaveProperty('idempotencyKey');
      const invs = (await http().get('/api/portal/invoices').set(who).expect(200)).body;
      expect(invs.find((i: { id: string }) => i.id === invoiceId)).toMatchObject({ status: 'PAID', remainingAmount: 0 });
    }
    // The cabinet is not a way into the back office.
    await http().get('/api/payments').set(s).expect(403);
    await http().get('/api/students').set(p).expect(403);
  });
});
