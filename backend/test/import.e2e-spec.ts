import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module.js';

// Excel import: a template, a preview that writes nothing, all-or-nothing
// runs, and the same file uploaded twice creating nothing new.
describe('Excel import (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  let manager: string;
  const auth = (t = owner) => ({ Authorization: `Bearer ${t}` });

  const xlsx = async (rows: Array<Array<string | number | Date>>) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    for (const r of rows) ws.addRow(r);
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const upload = (kind: string, file: Buffer, dryRun = false, token = owner) =>
    http().post(`/api/import/${kind}${dryRun ? '?dryRun=1' : ''}`).set(auth(token)).attach('file', file, 'import.xlsx');

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `Imp ${suffix}`, subdomain: `imp-${suffix}`, email: `imp-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
    const inv = await http().post('/api/invitations').set(auth()).send({ email: `imp-mgr-${suffix}@test.uz`, role: 'MANAGER' }).expect(201);
    manager = (await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: 'Mgr', password: 'password12345' }).expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('gives a template that imports as it is', async () => {
    const res = await http().get('/api/import/teachers/template.xlsx').set(auth()).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const preview = (await upload('teachers', res.body as Buffer, true).expect(201)).body;
    expect(preview.counts).toEqual({ create: 1, exists: 0, error: 0 });
  });

  it('teachers, then groups naming them, then students with groups - and nothing twice', async () => {
    const teachersFile = await xlsx([
      ['F.I.O', 'Telefon', 'Fan', 'Maosh turi', 'Maosh'],
      ['Aziza Karimova', '90 111 22 33', 'Ingliz tili', 'oylik', '4 000 000'],
      ['Bobur Aliyev', '+998 91 222 33 44', 'Matematika', 'darsbay', 80000],
    ]);
    const pre = (await upload('teachers', teachersFile, true).expect(201)).body;
    expect(pre.counts).toEqual({ create: 2, exists: 0, error: 0 });
    expect((await http().get('/api/teachers').set(auth()).expect(200)).body).toHaveLength(0); // the preview wrote nothing
    expect((await upload('teachers', teachersFile).expect(201)).body).toMatchObject({ created: 2, skipped: 0 });
    const teachers = (await http().get('/api/teachers').set(auth()).expect(200)).body;
    expect(teachers.find((t: { fullName: string }) => t.fullName === 'Aziza Karimova')).toMatchObject({ phone: '+998 90 111 22 33', salaryType: 'FIXED', salaryValue: 4_000_000 });
    // Again: everything exists, nothing new.
    expect((await upload('teachers', teachersFile).expect(201)).body).toMatchObject({ created: 0, skipped: 2 });

    const groupsFile = await xlsx([
      ['Guruh nomi', 'Fan', "O'qituvchi", 'Oylik narx', "Sig'im", 'Kunlar', 'Boshlanish vaqti', 'Tugash vaqti'],
      ['IELTS Kechki', 'Ingliz tili', 'aziza karimova', 450000, 2, 'Du, Cho, Ju', '18:00', '19:30'],
      ['Algebra 7', 'Matematika', 'Bobur Aliyev', 300000, 10, 'Se/Pa', '0.6666666667', ''],
    ]);
    expect((await upload('groups', groupsFile).expect(201)).body).toMatchObject({ created: 2 });
    const groups = (await http().get('/api/groups').set(auth()).expect(200)).body;
    const ielts = groups.find((g: { name: string }) => g.name === 'IELTS Kechki');
    expect(ielts).toMatchObject({ monthlyPrice: 450000, maxStudents: 2, scheduleDays: 'Dushanba,Chorshanba,Juma', startTime: '18:00', endTime: '19:30', teacherId: teachers.find((t: { fullName: string }) => t.fullName === 'Aziza Karimova').id });
    expect(groups.find((g: { name: string }) => g.name === 'Algebra 7')).toMatchObject({ startTime: '16:00', endTime: '17:30' });

    const studentsFile = await xlsx([
      ['F.I.O', 'Telefon', 'Ota-ona telefoni', 'Guruh'],
      ['Javohir Toshmatov', '93 111 00 01', '', 'IELTS Kechki; Algebra 7'],
      ['Madina Rahimova', '', '94 222 00 02', 'ielts kechki'],
    ]);
    expect((await upload('students', studentsFile).expect(201)).body).toMatchObject({ created: 2 });
    const detail = (await http().get(`/api/groups/${ielts.id}`).set(auth()).expect(200)).body;
    expect(detail.enrollments.map((e: { student: { fullName: string } }) => e.student.fullName).sort()).toEqual(['Javohir Toshmatov', 'Madina Rahimova']);
    expect((await upload('students', studentsFile).expect(201)).body).toMatchObject({ created: 0, skipped: 2 });
  });

  it('with any error, nothing is saved, and every problem is reported by row', async () => {
    const before = (await http().get('/api/groups').set(auth()).expect(200)).body.length;
    const bad = await xlsx([
      ['Guruh nomi', 'Fan', "O'qituvchi", 'Oylik narx', 'Kunlar', 'Boshlanish vaqti'],
      ['Good One', 'Fizika', '', 200000, '', ''],
      ['No Teacher', 'Fizika', 'Nobody Here', 200000, '', ''],
      ['Bad Price', 'Fizika', '', 'ko\'p', '', ''],
      ['Good One', 'Fizika', '', 200000, '', ''],
      // Aziza teaches IELTS Kechki on Monday 18:00-19:30.
      ['Clash', 'Ingliz tili', 'Aziza Karimova', 100000, 'Dushanba', '19:00'],
    ]);
    const res = await upload('groups', bad).expect(400);
    const rows = res.body.report.rows as Array<{ row: number; status: string; errors: string[] }>;
    expect(rows.map((r) => r.status)).toEqual(['create', 'error', 'error', 'error', 'error']);
    expect(rows[1].errors[0]).toContain("O'qituvchi topilmadi");
    expect(rows[2].errors[0]).toContain('Oylik narx');
    expect(rows[3].errors[0]).toBe('2-qator bilan bir xil');
    expect(rows[4].errors[0]).toContain('IELTS Kechki');
    expect((await http().get('/api/groups').set(auth()).expect(200)).body.length).toBe(before);
  });

  it('refuses seats a full group does not have', async () => {
    const full = await xlsx([
      ['F.I.O', 'Guruh'],
      ['Third Kid', 'IELTS Kechki'], // capacity 2, both taken
    ]);
    const res = await upload('students', full, true).expect(201);
    expect(res.body.rows[0]).toMatchObject({ status: 'error' });
    expect(res.body.rows[0].errors[0]).toContain("joy yo'q");
  });

  it('checks the file and the role', async () => {
    await upload('teachers', Buffer.from('not excel')).expect(400);
    await upload('teachers', await xlsx([['Telefon'], ['901234567']])).expect(400); // no F.I.O column
    await upload('rooms', await xlsx([['x']])).expect(400);
    await upload('teachers', await xlsx([['F.I.O'], ['X Y']]), true, manager).expect(403);
    await http().post('/api/import/teachers').set(auth()).expect(400); // no file
  });
});
