import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// The filters of the students and payments pages run on the server, so a
// page never has to load the whole list to filter it: group, direction and
// gender for students (and search by group name), group and text search for
// payments; and the yearly revenue chart is summed in SQL on the center's
// calendar.
describe('Server-side list filters and yearly revenue (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: Record<string, string>, other: Record<string, string>, teacher: Record<string, string>;
  let yearOwner: Record<string, string>;
  const staff: Record<string, Record<string, string>> = {};
  let g1: string, g2: string, g3: string, otherGroup: string;
  // name -> id
  const sid: Record<string, string> = {};

  type Row = { id: string; fullName: string };
  const names = (rows: Row[]) => rows.map((r) => r.fullName).sort();
  const page = async (url: string, who = owner) => (await http().get(url).set(who).expect(200)).body as { items: Row[]; total: number; page: number; pageSize: number };

  const register = async (k: string) => (await http().post('/api/auth/register')
    .send({ centerName: `Filt ${k} ${suffix}`, subdomain: `filt-${k}-${suffix}`, email: `filt-${k}-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
    .expect(201)).body as { accessToken: string; tenant: { id: string } };
  const invite = async (who: Record<string, string>, role: string, k: string) => {
    const inv = (await http().post('/api/invitations').set(who).send({ email: `filt-${k}-${suffix}@test.uz`, role }).expect(201)).body;
    return (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `Filt ${k}`, password: 'password12345' }).expect(201)).body as { accessToken: string; user: { id: string } };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    owner = bearer((await register('a')).accessToken);
    other = bearer((await register('b')).accessToken);

    const tAcc = await invite(owner, 'TEACHER', 't');
    teacher = bearer(tAcc.accessToken);
    for (const role of ['RECEPTIONIST', 'ACCOUNTANT', 'MANAGER']) staff[role] = bearer((await invite(owner, role, role.toLowerCase())).accessToken);
    const tch = (await http().post('/api/teachers').set(owner).send({ fullName: 'Filt T', userId: tAcc.user.id, subject: 'Matematika' }).expect(201)).body.id;
    const group = async (who: Record<string, string>, name: string, subject: string, teacherId?: string) =>
      (await http().post('/api/groups').set(who).send({ name, subject, maxStudents: 30, ...(teacherId ? { teacherId } : {}) }).expect(201)).body.id as string;
    g1 = await group(owner, 'Alpha Math', 'Matematika (Milliy sertifikat)', tch);
    g2 = await group(owner, 'Beta English', 'Ingliz tili, IELTS');
    g3 = await group(owner, 'Gamma Kids', 'Matematika');
    otherGroup = await group(other, 'Alpha Other', 'Matematika');
    // Another center's student in its own "Alpha" group: never in A's lists.
    await http().post('/api/students').set(other).send({ fullName: 'Other Alpha', gender: 'FEMALE', groupIds: [otherGroup] }).expect(201);

    // name, gender, groups
    const plan: Array<[string, 'MALE' | 'FEMALE' | null, string[]]> = [
      ['Filt S01', 'MALE', [g1]],
      ['Filt S02', 'FEMALE', [g1]],
      ['Zebo S03', 'MALE', [g1]],
      ['Filt S04', 'FEMALE', [g1]],
      ['Filt S05', 'MALE', [g1]],
      ['Filt S06', 'FEMALE', [g1]],
      ['Filt S07', 'MALE', [g2]],
      ['Filt S08', 'FEMALE', [g2]],
      ['Filt S09', null, [g2]],
      ['Filt S10', 'FEMALE', [g1, g2]],
      ['Filt S11', 'MALE', [g3]],
      ['Alpha Solo', 'MALE', []],
    ];
    for (const [fullName, gender, groupIds] of plan) {
      sid[fullName] = (await http().post('/api/students').set(owner)
        .send({ fullName, ...(gender ? { gender } : {}), ...(groupIds.length ? { groupIds } : {}) }).expect(201)).body.id;
    }
    // Payments (all paid now): the month they are for, and the amount.
    const pays: Array<[string, string, number]> = [
      ['Filt S01', '2026-01', 100_000],
      ['Filt S02', '2026-02', 200_000],
      ['Zebo S03', '2026-03', 150_000],
      ['Filt S07', '2026-01', 300_000],
      ['Filt S10', '2026-02', 400_000],
      ['Filt S10', '2026-03', 450_000],
      ['Filt S11', '2026-02', 600_000],
      ['Alpha Solo', '2026-01', 500_000],
    ];
    for (const [name, forMonth, amount] of pays) {
      await http().post('/api/payments').set(owner).send({ studentId: sid[name], amount, forMonth, method: 'CASH' }).expect(201);
    }
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  it('students: group filter pages on the server with the right total', async () => {
    const want = ['Filt S01', 'Filt S02', 'Zebo S03', 'Filt S04', 'Filt S05', 'Filt S06', 'Filt S10'].sort();
    const p1 = await page(`/api/students?groupId=${g1}&page=1&pageSize=3`);
    const p2 = await page(`/api/students?groupId=${g1}&page=2&pageSize=3`);
    const p3 = await page(`/api/students?groupId=${g1}&page=3&pageSize=3`);
    expect([p1.total, p2.total, p3.total]).toEqual([7, 7, 7]);
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([3, 3, 1]);
    expect(names([...p1.items, ...p2.items, ...p3.items])).toEqual(want); // each once, none missing
    // Without paging: the same rows as a plain array (callers that do not page).
    expect(names((await http().get(`/api/students?groupId=${g1}`).set(owner).expect(200)).body)).toEqual(want);
    // A student in two groups is listed once in each.
    expect(names((await page(`/api/students?groupId=${g2}&page=1`)).items)).toEqual(['Filt S07', 'Filt S08', 'Filt S09', 'Filt S10']);
  });

  it('students: direction follows the page rule (subject contains it, or it contains a part of the subject)', async () => {
    const math = await page('/api/students?direction=Matematika&page=1');
    expect(math.total).toBe(8); // "Matematika (Milliy sertifikat)" and "Matematika"
    expect(names(math.items)).toEqual(['Filt S01', 'Filt S02', 'Zebo S03', 'Filt S04', 'Filt S05', 'Filt S06', 'Filt S10', 'Filt S11'].sort());
    // A part of "Ingliz tili, IELTS"; case does not matter.
    expect(names((await page('/api/students?direction=ielts&page=1')).items)).toEqual(['Filt S07', 'Filt S08', 'Filt S09', 'Filt S10']);
    expect((await page('/api/students?direction=Ingliz%20tili&page=1')).total).toBe(4);
    expect((await page('/api/students?direction=Kimyo&page=1')).total).toBe(0);
    // The direction contains the whole subject "Matematika" (Gamma) too.
    expect((await page('/api/students?direction=Matematika%20(Milliy%20sertifikat)&page=1')).total).toBe(8);
  });

  it('students: gender, and filters combined with paging', async () => {
    expect((await page('/api/students?gender=FEMALE&page=1')).total).toBe(5);
    expect((await page('/api/students?gender=MALE&page=1')).total).toBe(6);
    const a = await page(`/api/students?groupId=${g1}&gender=FEMALE&page=1&pageSize=3`);
    const b = await page(`/api/students?groupId=${g1}&gender=FEMALE&page=2&pageSize=3`);
    expect([a.total, b.total, a.items.length, b.items.length]).toEqual([4, 4, 3, 1]);
    expect(names([...a.items, ...b.items])).toEqual(['Filt S02', 'Filt S04', 'Filt S06', 'Filt S10']);
    expect(names((await page('/api/students?direction=Matematika&gender=MALE&page=1')).items)).toEqual(['Filt S01', 'Filt S05', 'Filt S11', 'Zebo S03'].sort());
    // Every filter at once, with the search.
    const all = await page(`/api/students?search=s10&groupId=${g2}&direction=ielts&gender=FEMALE&page=1&pageSize=1`);
    expect(all.total).toBe(1);
    expect(all.items[0].fullName).toBe('Filt S10');
  });

  it('students: search matches group names (and subjects), each student once', async () => {
    const alpha = await page('/api/students?search=alpha&page=1&pageSize=50');
    // The 7 of "Alpha Math" and "Alpha Solo" by name; S10 (two groups) once;
    // not the other center's "Alpha Other" group or student.
    expect(alpha.total).toBe(8);
    expect(alpha.items).toHaveLength(8);
    expect(names(alpha.items)).toEqual(['Alpha Solo', 'Filt S01', 'Filt S02', 'Zebo S03', 'Filt S04', 'Filt S05', 'Filt S06', 'Filt S10'].sort());
    expect(names((await page('/api/students?search=beta%20eng&page=1')).items)).toEqual(['Filt S07', 'Filt S08', 'Filt S09', 'Filt S10']);
    expect((await page('/api/students?search=ielts&page=1')).total).toBe(4); // the subject, as the page used to search it
    expect(names((await page('/api/students?search=zebo&page=1')).items)).toEqual(['Zebo S03']); // names as before
    expect((await page('/api/students?search=%25&page=1')).total).toBe(0); // % is literal
  });

  it("students: a teacher's filters stay inside their own groups", async () => {
    // The teacher has Alpha Math only (7 students).
    expect((await page('/api/students?page=1', teacher)).total).toBe(7);
    expect(names((await page('/api/students?gender=MALE&page=1', teacher)).items)).toEqual(['Filt S01', 'Filt S05', 'Zebo S03'].sort());
    // S10 is also in Beta English; the other Beta students are not theirs.
    expect(names((await page(`/api/students?groupId=${g2}&page=1`, teacher)).items)).toEqual(['Filt S10']);
    expect(names((await page('/api/students?direction=ielts&page=1', teacher)).items)).toEqual(['Filt S10']);
    expect(names((await page('/api/students?search=beta&page=1', teacher)).items)).toEqual(['Filt S10']);
    expect((await page(`/api/students?groupId=${g3}&page=1`, teacher)).total).toBe(0);
    expect((await page('/api/students?search=alpha%20solo&page=1', teacher)).total).toBe(0);
  });

  it("students: another center's group gives an empty list, not its data", async () => {
    expect(await page(`/api/students?groupId=${otherGroup}&page=1`)).toMatchObject({ total: 0, items: [] });
    expect((await http().get(`/api/students?groupId=${otherGroup}`).set(owner).expect(200)).body).toEqual([]);
    expect((await page(`/api/students?groupId=${g1}&page=1`, other)).total).toBe(0);
    expect((await page('/api/students?groupId=no-such-group&page=1')).total).toBe(0);
    // The other center's own filter sees its own student only.
    expect(names((await page('/api/students?search=alpha&page=1', other)).items)).toEqual(['Other Alpha']);
  });

  it('students: bad filter values are a 400, not a 500', async () => {
    await http().get('/api/students?gender=OTHER&page=1').set(owner).expect(400);
    await http().get('/api/students?gender=male').set(owner).expect(400);
    await http().get('/api/students?gender=MALE&gender=FEMALE&page=1').set(owner).expect(400);
    await http().get(`/api/students?groupId=${'x'.repeat(65)}&page=1`).set(owner).expect(400);
    await http().get(`/api/students?groupId=${g1}&groupId=${g2}&page=1`).set(owner).expect(400);
    await http().get(`/api/students?direction=${'m'.repeat(101)}&page=1`).set(owner).expect(400);
    await http().get('/api/students?search=a&search=b&page=1').set(owner).expect(400);
    // Blank values are no filter.
    expect((await page('/api/students?gender=&groupId=&direction=%20&page=1')).total).toBe(12);
  });

  it('payments: group filter (payments of students enrolled in it) and search on name or month, paged on the server', async () => {
    type Pay = { amount: number; forMonth: string; student: { fullName: string } };
    const pays = async (url: string, who = owner) => (await http().get(url).set(who).expect(200)).body as { items: Pay[]; total: number };
    // Alpha Math: S01, S02, S03 and S10's two payments.
    const a = await pays(`/api/payments?groupId=${g1}&page=1&pageSize=2`);
    const b = await pays(`/api/payments?groupId=${g1}&page=2&pageSize=2`);
    const c = await pays(`/api/payments?groupId=${g1}&page=3&pageSize=2`);
    expect([a.total, b.total, c.total]).toEqual([5, 5, 5]);
    expect([...a.items, ...b.items, ...c.items].map((p) => p.amount).sort((x, y) => x - y)).toEqual([100_000, 150_000, 200_000, 400_000, 450_000]);
    expect((await http().get(`/api/payments?groupId=${g1}`).set(owner).expect(200)).body).toHaveLength(5);
    expect((await pays(`/api/payments?groupId=${g2}&page=1`)).total).toBe(3);
    // With the server filters already there.
    expect((await pays(`/api/payments?groupId=${g1}&forMonth=2026-02&page=1`)).items.map((p) => p.amount).sort()).toEqual([200_000, 400_000]);
    // Search: the student's name, or the month paid for.
    expect((await pays('/api/payments?search=zebo&page=1')).items.map((p) => p.student.fullName)).toEqual(['Zebo S03']);
    expect((await pays('/api/payments?search=ALPHA&page=1')).items.map((p) => p.student.fullName)).toEqual(['Alpha Solo']); // not the group name
    expect((await pays('/api/payments?search=2026-03&page=1')).items.map((p) => p.amount).sort()).toEqual([150_000, 450_000]);
    const both = await pays(`/api/payments?search=2026-0&groupId=${g2}&page=1&pageSize=2`);
    expect([both.total, both.items.length]).toEqual([3, 2]);
    expect((await pays(`/api/payments?search=alpha&groupId=${g1}&page=1`)).total).toBe(0);
    expect((await pays('/api/payments?search=%25&page=1')).total).toBe(0); // % is literal
  });

  it("payments: another center's group is empty; bad values are a 400; teachers stay out", async () => {
    expect((await http().get(`/api/payments?groupId=${otherGroup}&page=1`).set(owner).expect(200)).body).toMatchObject({ total: 0, items: [] });
    expect((await http().get(`/api/payments?groupId=${g1}&page=1`).set(other).expect(200)).body.total).toBe(0);
    expect((await http().get('/api/payments?search=filt&page=1').set(other).expect(200)).body.total).toBe(0);
    await http().get(`/api/payments?groupId=${g1}&groupId=${g2}&page=1`).set(owner).expect(400);
    await http().get(`/api/payments?groupId=${'x'.repeat(65)}`).set(owner).expect(400);
    await http().get('/api/payments?search=a&search=b&page=1').set(owner).expect(400);
    await http().get(`/api/payments?groupId=${g1}&page=1`).set(teacher).expect(403);
    // Front desk reads payments (and so these filters).
    expect((await http().get(`/api/payments?groupId=${g1}&page=1`).set(staff.RECEPTIONIST).expect(200)).body.total).toBe(5);
  });

  describe('revenue by year', () => {
    // Years follow the month a payment is for (forMonth), as the monthly
    // chart does, whatever day the money came in: the year is the sum of
    // its months. Fixtures pay late or early on purpose.
    let currentYear: number;
    beforeAll(async () => {
      const reg = await register('y');
      yearOwner = bearer(reg.accessToken);
      const st = (await http().post('/api/students').set(yearOwner).send({ fullName: 'Year Payer' }).expect(201)).body.id;
      const pay = (forMonth: string, paidAt: string, amount: number, status = 'PAID') =>
        http().post('/api/payments').set(yearOwner).send({ studentId: st, amount, forMonth, paidAt, status }).expect(201);
      await pay('2019-05', '2019-05-01T12:00:00Z', 600); // old: only in a long window
      await pay('2024-06', '2024-06-15T12:00:00Z', 1_000);
      await pay('2024-12', '2025-01-20T12:00:00Z', 20_000); // December's fee, paid in January: 2024
      await pay('2025-01', '2024-12-28T12:00:00Z', 300_000); // January's fee, paid early: 2025
      await pay('2025-12', '2025-12-31T23:30:00Z', 4_000_000);
      await pay('2025-11', '2026-01-03T10:00:00Z', 50_000_000); // still 2025
      await pay('2025-06', '2025-06-01T12:00:00Z', 7, 'PENDING'); // not paid: left out
      await pay('2024-06', '2024-06-01T12:00:00Z', 9, 'FAILED');
      currentYear = (await http().get('/api/reports/revenue-by-year').set(yearOwner).expect(200)).body.currentYear;
    }, 60_000);

    it('sums paid payments per year of the month they are for', async () => {
      const def = (await http().get('/api/reports/revenue-by-year').set(yearOwner).expect(200)).body;
      // Default: four years up to the current one, oldest first.
      expect(def.years.map((y: { year: number }) => y.year)).toEqual([currentYear - 3, currentYear - 2, currentYear - 1, currentYear]);
      const n = currentYear - 2023 + 1;
      const body = (await http().get(`/api/reports/revenue-by-year?years=${n}`).set(yearOwner).expect(200)).body;
      const of = (y: number) => body.years.find((r: { year: number }) => r.year === y)?.amount;
      expect(of(2023)).toBe(0);
      expect(of(2024)).toBe(21_000);
      expect(of(2025)).toBe(54_300_000);
      if (currentYear > 2026) expect(of(2026)).toBe(0);
      expect(body.years.reduce((s: number, r: { amount: number }) => s + r.amount, 0)).toBe(54_321_000); // 2019 is outside
      const long = (await http().get('/api/reports/revenue-by-year?years=20').set(yearOwner).expect(200)).body;
      expect(long.years).toHaveLength(20);
      expect(long.years.find((r: { year: number }) => r.year === 2019).amount).toBe(600);
      // Another center's money is not in it, and this center's is not in theirs.
      expect((await http().get('/api/reports/revenue-by-year?years=20').set(other).expect(200)).body.years.every((r: { amount: number }) => r.amount === 0)).toBe(true);
      const a = (await http().get('/api/reports/revenue-by-year').set(owner).expect(200)).body;
      expect(a.years.find((r: { year: number }) => r.year === a.currentYear).amount).toBe(2_700_000);
    });

    it('bad years are a 400', async () => {
      for (const v of ['0', '21', '-1', '2.5', 'abc', '']) await http().get(`/api/reports/revenue-by-year?years=${v}`).set(yearOwner).expect(400);
      await http().get('/api/reports/revenue-by-year?years=2&years=3').set(yearOwner).expect(400);
    });

    it('whoever reads the payments list sees it (payments.view); teachers 403', async () => {
      await http().get('/api/reports/revenue-by-year').set(staff.ACCOUNTANT).expect(200);
      await http().get('/api/reports/revenue-by-year').set(staff.MANAGER).expect(200);
      await http().get('/api/reports/revenue-by-year').set(staff.RECEPTIONIST).expect(200);
      await http().get('/api/reports/revenue-by-year').set(teacher).expect(403);
      await http().get('/api/reports/revenue-by-year').expect(401);
    });
  });
});
