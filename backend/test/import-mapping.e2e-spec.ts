import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module.js';

// A center's own Excel, not our template: a title row above the header and
// its own column names. The columns step suggests what it can; the person
// chooses the rest; the preview and the import follow that choice, and a
// column left unchosen is listed as not imported.
describe('Excel import with the center\'s own columns (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer() as App);
  const suffix = Date.now();
  let token = '';
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const file = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ro\'yxat');
    ws.addRow(['Bizning o\'quvchilar ro\'yxati, 2026']);
    ws.addRow([]);
    ws.addRow(['Ism', 'Tel raqami', 'Onasining raqami', 'Izoh']);
    ws.addRow(['Mapped Kid', '90 777 11 22', '91 777 33 44', 'kech keladi']);
    ws.addRow(['Mapped Two', '90 777 55 66', '', '']);
    return Buffer.from(await wb.xlsx.writeBuffer());
  };

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ centerName: `ImpMap ${suffix}`, subdomain: `impmap-${suffix}`, email: `impmap-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
  });
  afterAll(async () => { await app?.close(); });

  it('columns: found under the title row; the suggestion takes what it knows', async () => {
    const res = (await http().post('/api/import/students/columns').set(auth()).attach('file', await file(), 'own.xlsx').expect(201)).body;
    expect(res.headers).toEqual(['Ism', 'Tel raqami', 'Onasining raqami', 'Izoh']);
    expect(res.suggested).toMatchObject({ fullName: 'Ism' });
    expect(res.sample[0]).toMatchObject({ Ism: 'Mapped Kid', 'Tel raqami': '90 777 11 22' });
    expect(res.fields.map((f: { key: string }) => f.key)).toEqual(expect.arrayContaining(['fullName', 'phone', 'parentPhone', 'groups']));
  });

  it('without a choice the unknown phone columns are not read; with it, the preview and the import follow it', async () => {
    const plain = (await http().post('/api/import/students?dryRun=1').set(auth()).attach('file', await file(), 'own.xlsx').expect(201)).body;
    expect(plain.unknownColumns).toEqual(['Tel raqami', 'Onasining raqami', 'Izoh']);

    const mapping = JSON.stringify({ fullName: 'Ism', phone: 'Tel raqami', parentPhone: 'Onasining raqami' });
    const preview = (await http().post('/api/import/students?dryRun=1').set(auth()).field('mapping', mapping).attach('file', await file(), 'own.xlsx').expect(201)).body;
    expect(preview.counts).toEqual({ create: 2, exists: 0, error: 0 });
    expect(preview.unknownColumns).toEqual(['Izoh']);
    expect(preview.rows[0].values).toMatchObject({ fullName: 'Mapped Kid', phone: '90 777 11 22', parentPhone: '91 777 33 44' });

    const run = (await http().post('/api/import/students').set(auth()).field('mapping', mapping).attach('file', await file(), 'own.xlsx').expect(201)).body;
    expect(run.created).toBe(2);
    const list = (await http().get('/api/students?search=Mapped').set(auth()).expect(200)).body;
    const kid = (list.items ?? list).find((s: { fullName: string }) => s.fullName === 'Mapped Kid');
    expect(kid.phone).toContain('777');
  });

  it('a choice that names no column, or one column twice, or no name column: refused with a reason', async () => {
    const f = await file();
    const post = (mapping: unknown) => http().post('/api/import/students?dryRun=1').set(auth()).field('mapping', JSON.stringify(mapping)).attach('file', f, 'own.xlsx');
    expect((await post({ fullName: 'Nope' }).expect(400)).body.message).toContain('Nope');
    expect((await post({ fullName: 'Ism', phone: 'Ism' }).expect(400)).body.message).toContain('ikki');
    expect((await post({ phone: 'Tel raqami' }).expect(400)).body.message).toContain('F.I.O');
    expect((await post({ hacker: 'Ism' }).expect(400)).body.message).toContain("Noma'lum");
  });
});
