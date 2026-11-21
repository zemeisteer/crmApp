import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { AppModule } from '../src/app.module.js';

// Everything at once: one workbook with a sheet per kind, or a .zip of the
// single templates. Teachers, then groups naming them, then students in
// those groups; a kind with an error stops the rest, and the same file
// again skips what was saved.
describe('Excel import, everything at once (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let n = 0;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const TEACHERS = [['F.I.O', 'Telefon', 'Fan'], ['Bundle Teacher', '90 555 00 01', 'Ingliz tili']];
  const GROUPS = [['Guruh nomi', 'Fan', "O'qituvchi", 'Oylik narx', "Sig'im", 'Kunlar', 'Boshlanish vaqti'], ['Bundle Group', 'Ingliz tili', 'Bundle Teacher', 400000, 10, 'Du, Cho', '10:00']];
  const STUDENTS = [['F.I.O', 'Telefon', 'Guruh'], ['Bundle Student', '93 555 00 02', 'Bundle Group']];

  const center = async () => (await http().post('/api/auth/register')
    .send({ centerName: `Bun ${suffix}-${++n}`, subdomain: `bun-${n}-${suffix}`, email: `bun-${n}-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
    .expect(201)).body.accessToken as string;
  const sheet = (wb: ExcelJS.Workbook, name: string, rows: Array<Array<string | number>>) => {
    const ws = wb.addWorksheet(name);
    for (const r of rows) ws.addRow(r);
  };
  const workbook = async (sheets: Record<string, Array<Array<string | number>>>) => {
    const wb = new ExcelJS.Workbook();
    for (const [name, rows] of Object.entries(sheets)) sheet(wb, name, rows);
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const send = (token: string, file: Buffer, name: string) => http().post('/api/import/bundle').set(auth(token)).attach('file', file, name);
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('one workbook, a sheet per kind: all three imported in order; again, nothing new', async () => {
    const token = await center();
    const file = await workbook({ "O'quvchilar": STUDENTS, Guruhlar: GROUPS, "O'qituvchilar": TEACHERS, Izoh: [['note']] });
    const res = (await send(token, file, 'hammasi.xlsx').expect(201)).body;
    expect(res.ok).toBe(true);
    expect(res.steps.map((s: { kind: string; created: number }) => [s.kind, s.created])).toEqual([['teachers', 1], ['groups', 1], ['students', 1]]);
    const groups = (await http().get('/api/groups').set(auth(token)).expect(200)).body;
    const detail = (await http().get(`/api/groups/${groups[0].id}`).set(auth(token)).expect(200)).body;
    expect(detail.enrollments.map((e: { student: { fullName: string } }) => e.student.fullName)).toEqual(['Bundle Student']);
    const again = (await send(token, file, 'hammasi.xlsx').expect(201)).body;
    expect(again.steps.map((s: { created: number; skipped: number }) => [s.created, s.skipped])).toEqual([[0, 1], [0, 1], [0, 1]]);
  });

  it('a .zip of the single templates works the same', async () => {
    const token = await center();
    const zip = new JSZip();
    zip.file('import-teachers.xlsx', await workbook({ Import: TEACHERS }));
    zip.file('import-groups.xlsx', await workbook({ Import: GROUPS }));
    zip.file("o'quvchilar.xlsx", await workbook({ Import: STUDENTS }));
    zip.file('readme.txt', 'ignored');
    const res = (await send(token, await zip.generateAsync({ type: 'nodebuffer' }), 'import.zip').expect(201)).body;
    expect(res).toMatchObject({ ok: true });
    expect(res.steps.map((s: { kind: string }) => s.kind)).toEqual(['teachers', 'groups', 'students']);
  });

  it('a kind with an error stops the rest; what came before stays and is skipped next time', async () => {
    const token = await center();
    const bad = await workbook({ "O'qituvchilar": TEACHERS, Guruhlar: [GROUPS[0], ['Broken Group', 'Ingliz tili', 'Nobody Here', 'not a price', 10, 'Du', '10:00']], "O'quvchilar": STUDENTS });
    const res = (await send(token, bad, 'bad.xlsx').expect(201)).body;
    expect(res.ok).toBe(false);
    expect(res.steps.map((s: { kind: string }) => s.kind)).toEqual(['teachers']);
    expect(res.failed.kind).toBe('groups');
    expect(res.failed.report.counts.error).toBeGreaterThan(0);
    expect(res.notRun).toEqual(['students']);
    expect((await http().get('/api/teachers').set(auth(token)).expect(200)).body).toHaveLength(1);
    expect((await http().get('/api/groups').set(auth(token)).expect(200)).body).toHaveLength(0);

    const fixed = await workbook({ "O'qituvchilar": TEACHERS, Guruhlar: GROUPS, "O'quvchilar": STUDENTS });
    const res2 = (await send(token, fixed, 'fixed.xlsx').expect(201)).body;
    expect(res2.ok).toBe(true);
    expect(res2.steps[0]).toMatchObject({ kind: 'teachers', created: 0, skipped: 1 });
  });

  it('nothing it knows: says which names it looks for; not a workbook: refused', async () => {
    const token = await center();
    expect((await send(token, await workbook({ Random: TEACHERS }), 'x.xlsx').expect(400)).body.message).toContain("O'qituvchilar");
    await send(token, Buffer.from('plain text'), 'x.txt').expect(400);
  });
});
