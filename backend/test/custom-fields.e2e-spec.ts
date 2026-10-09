import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// Custom fields for students and leads: definitions (owner/admin), values
// through the student and lead routes, lead -> student mapping, exports,
// imports and the cabinet - and that none of it crosses centers.
describe('Custom fields (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  let ownerA: string, managerA: string, teacherA: string, teacher2A: string, ownerB: string;
  let groupA: string, studentB: string;
  let phoneN = 0;
  const phone = () => `+99890${String(7000000 + suffix % 1000000 + phoneN++).slice(-7)}`;

  const register = async (key: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `CF ${key} ${suffix}`, subdomain: `cf-${key}-${suffix}`, email: `cf-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` })
      .expect(201)).body.accessToken as string;
  const invite = async (owner: string, role: string, local: string) => {
    const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `cf-${local}-${suffix}@test.uz`, role }).expect(201)).body;
    const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `${role} ${local}`, password: 'password12345' }).expect(201)).body;
    return { token: acc.accessToken as string, userId: acc.user.id as string };
  };
  const field = (token: string, body: Record<string, unknown>) => http().post('/api/custom-fields').set(bearer(token)).send(body);
  const futureDay = (days: number) => new Date(Date.now() + days * 86_400_000 + 5 * 3_600_000).toISOString().slice(0, 10);
  let trialHour = 8;
  const qualify = async (leadId: string) => {
    await http().post(`/api/leads/${leadId}/transition`).set(bearer(ownerA)).send({ toStatus: 'CONTACTED' }).expect(201);
    const t = await http().post(`/api/leads/${leadId}/trials`).set(bearer(ownerA)).send({ scheduledAt: `${futureDay(25)}T${String(trialHour++ % 24).padStart(2, '0')}:00:00+05:00` }).expect(201);
    await http().post(`/api/leads/${leadId}/trials/${t.body.id}/attend`).set(bearer(ownerA)).send({}).expect(201);
    await http().post(`/api/leads/${leadId}/transition`).set(bearer(ownerA)).send({ toStatus: 'QUALIFIED' }).expect(201);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    ownerA = await register('a');
    managerA = (await invite(ownerA, 'MANAGER', 'mgr')).token;
    const t1 = await invite(ownerA, 'TEACHER', 't1'); teacherA = t1.token;
    teacher2A = (await invite(ownerA, 'TEACHER', 't2')).token;
    const tch = (await http().post('/api/teachers').set(bearer(ownerA)).send({ fullName: 'CF Teacher', userId: t1.userId, subject: 'English' }).expect(201)).body.id;
    groupA = (await http().post('/api/groups').set(bearer(ownerA)).send({ name: 'CF G', subject: 'English', teacherId: tch, scheduleDays: 'Dushanba', startTime: '10:00', endTime: '11:00' }).expect(201)).body.id;
    ownerB = await register('b');
    studentB = (await http().post('/api/students').set(bearer(ownerB)).send({ fullName: 'B Student' }).expect(201)).body.id;
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  let levelS: { id: string; options: { id: string; label: string }[] };
  let levelL: { id: string; options: { id: string; label: string }[] };
  let leadId: string, studentA: string;

  it('only the owner/admin manage definitions; every staff member can read them', async () => {
    await field(managerA, { entityType: 'STUDENT', label: 'X', fieldType: 'TEXT' }).expect(403);
    await field(teacherA, { entityType: 'STUDENT', label: 'X', fieldType: 'TEXT' }).expect(403);
    await field(ownerA, { entityType: 'STUDENT', label: 'X', fieldType: 'COLOR' }).expect(400);
    await field(ownerA, { entityType: 'STUDENT', label: 'X', fieldType: 'SELECT', options: [] }).expect(400);
    levelS = (await field(ownerA, { entityType: 'STUDENT', label: 'Daraja', key: 'level', fieldType: 'SELECT', required: true, options: [{ label: 'A1' }, { label: 'B1' }] }).expect(201)).body;
    expect(levelS.options.map((o) => o.label)).toEqual(['A1', 'B1']);
    expect(levelS.options.every((o) => /^o_[0-9a-f]{12}$/.test(o.id))).toBe(true);
    await field(ownerA, { entityType: 'STUDENT', label: 'Daraja 2', key: 'level', fieldType: 'TEXT' }).expect(409); // key taken
    const list = (await http().get('/api/custom-fields?entityType=STUDENT').set(bearer(teacherA)).expect(200)).body;
    expect(list.map((d: { id: string }) => d.id)).toEqual([levelS.id]);
    await http().get('/api/custom-fields?entityType=OTHER').set(bearer(ownerA)).expect(400);
  });

  it('a lead field maps to a student field only explicitly, same type, options through a map', async () => {
    const textS = (await field(ownerA, { entityType: 'STUDENT', label: 'Izoh', fieldType: 'TEXT' }).expect(201)).body;
    const leadBody = { entityType: 'LEAD', label: 'Kerakli daraja', fieldType: 'SELECT', required: true, options: [{ label: 'Beginner' }, { label: 'Intermediate' }] };
    // Not the same type: refused.
    await field(ownerA, { ...leadBody, studentFieldId: textS.id }).expect(400);
    levelL = (await field(ownerA, leadBody).expect(201)).body;
    const [beg, int] = levelL.options;
    const [a1, b1] = levelS.options;
    await http().patch(`/api/custom-fields/${levelL.id}`).set(bearer(ownerA)).send({ studentFieldId: levelS.id, optionMap: { [beg.id]: a1.id, [int.id]: 'nope' } }).expect(400);
    const mapped = (await http().patch(`/api/custom-fields/${levelL.id}`).set(bearer(ownerA)).send({ studentFieldId: levelS.id, optionMap: { [beg.id]: a1.id } }).expect(200)).body;
    expect(mapped.studentFieldId).toBe(levelS.id);
    expect(mapped.optionMap).toEqual({ [beg.id]: a1.id });
    void b1;
    await http().post(`/api/custom-fields/${textS.id}/archive`).set(bearer(ownerA)).expect(201);
  });

  it('acceptance: required lead field -> lead -> conversion -> mapped student value -> edit -> reload -> archive', async () => {
    const [beg] = levelL.options;
    const [a1, b1] = levelS.options;
    // The required lead field must be answered by the staff form.
    const missing = await http().post('/api/leads').set(bearer(ownerA)).send({ fullName: 'CF Lead', phone: phone() }).expect(400);
    expect(missing.body.errors[0]).toMatchObject({ fieldId: levelL.id, error: 'REQUIRED' });
    await http().post('/api/leads').set(bearer(ownerA)).send({ fullName: 'CF Lead', phone: phone(), customFields: { [levelL.id]: 'not-an-option' } }).expect(400);
    const lead = (await http().post('/api/leads').set(bearer(ownerA)).send({ fullName: 'CF Lead', phone: phone(), customFields: { [levelL.id]: beg.id } }).expect(201)).body;
    leadId = lead.id;
    expect((await http().get(`/api/leads/${leadId}`).set(bearer(ownerA)).expect(200)).body.customFields).toEqual({ [levelL.id]: beg.id });
    // The list carries each lead's values too (the list page shows them as columns).
    const page = (await http().get('/api/leads?pageSize=100').set(bearer(ownerA)).expect(200)).body.items as Array<{ id: string; customFields: Record<string, unknown> }>;
    expect(page.find((l) => l.id === leadId)?.customFields).toEqual({ [levelL.id]: beg.id });
    expect(page.every((l) => l.customFields && typeof l.customFields === 'object')).toBe(true);

    await qualify(leadId);
    const conv = (await http().post(`/api/leads/${leadId}/convert`).set(bearer(ownerA)).send({ studentResolution: 'CREATE_NEW', groupIds: [groupA] }).expect(201)).body;
    studentA = conv.student.id;
    const s1 = (await http().get(`/api/students/${studentA}`).set(bearer(ownerA)).expect(200)).body;
    expect(s1.customFields[levelS.id]).toBe(a1.id); // carried and translated

    await http().patch(`/api/students/${studentA}`).set(bearer(ownerA)).send({ customFields: { [levelS.id]: b1.id } }).expect(200);
    const s2 = (await http().get(`/api/students/${studentA}`).set(bearer(ownerA)).expect(200)).body;
    expect(s2.customFields[levelS.id]).toBe(b1.id);
    // A required field cannot be emptied.
    await http().patch(`/api/students/${studentA}`).set(bearer(ownerA)).send({ customFields: { [levelS.id]: null } }).expect(400);

    // Archive: the value stays, the field leaves the forms and cannot be written.
    await http().post(`/api/custom-fields/${levelS.id}/archive`).set(bearer(ownerA)).expect(201);
    const s3 = (await http().get(`/api/students/${studentA}`).set(bearer(ownerA)).expect(200)).body;
    expect(s3.customFields[levelS.id]).toBe(b1.id);
    const active = (await http().get('/api/custom-fields?entityType=STUDENT').set(bearer(ownerA)).expect(200)).body;
    expect(active.find((d: { id: string }) => d.id === levelS.id)).toBeUndefined();
    const all = (await http().get('/api/custom-fields?entityType=STUDENT&includeArchived=1').set(bearer(ownerA)).expect(200)).body;
    expect(all.find((d: { id: string }) => d.id === levelS.id)?.archivedAt).toBeTruthy();
    const refused = await http().patch(`/api/students/${studentA}`).set(bearer(ownerA)).send({ customFields: { [levelS.id]: a1.id } }).expect(400);
    expect(refused.body.errors[0].error).toBe('FIELD_ARCHIVED');
    // No longer required for new students while archived.
    await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'After archive' }).expect(201);
    await http().post(`/api/custom-fields/${levelS.id}/restore`).set(bearer(ownerA)).expect(201);
  });

  it('another center can neither see nor change the definitions or the values', async () => {
    const listB = (await http().get('/api/custom-fields?entityType=STUDENT&includeArchived=1').set(bearer(ownerB)).expect(200)).body;
    expect(listB).toEqual([]);
    await http().patch(`/api/custom-fields/${levelS.id}`).set(bearer(ownerB)).send({ label: 'hijack' }).expect(404);
    await http().post(`/api/custom-fields/${levelS.id}/archive`).set(bearer(ownerB)).expect(404);
    await http().get(`/api/students/${studentA}`).set(bearer(ownerB)).expect(404);
    await http().patch(`/api/students/${studentA}`).set(bearer(ownerB)).send({ customFields: { [levelS.id]: levelS.options[0].id } }).expect(404);
    await http().get(`/api/leads/${leadId}`).set(bearer(ownerB)).expect(404);
    // A's definition id on B's own student: unknown in B.
    const r = await http().patch(`/api/students/${studentB}`).set(bearer(ownerB)).send({ customFields: { [levelS.id]: levelS.options[0].id } }).expect(400);
    expect(r.body.errors[0].error).toBe('UNKNOWN_FIELD');
  });

  it("the group's teacher reads the values; an unassigned teacher cannot reach the student", async () => {
    const t = (await http().get(`/api/students/${studentA}`).set(bearer(teacherA)).expect(200)).body;
    expect(t.customFields[levelS.id]).toBe(levelS.options[1].id);
    await http().get(`/api/students/${studentA}`).set(bearer(teacher2A)).expect(404);
    await http().patch(`/api/students/${studentA}`).set(bearer(teacherA)).send({ customFields: {} }).expect(403);
  });

  it('a mapped value that cannot be carried stops the conversion (nothing half done)', async () => {
    const [, intermediate] = levelL.options; // not in the option map
    const lead = (await http().post('/api/leads').set(bearer(ownerA)).send({ fullName: 'Unmapped', phone: phone(), customFields: { [levelL.id]: intermediate.id } }).expect(201)).body;
    await qualify(lead.id);
    const r = await http().post(`/api/leads/${lead.id}/convert`).set(bearer(ownerA)).send({ studentResolution: 'CREATE_NEW' }).expect(400);
    expect(r.body.errors[0]).toMatchObject({ fieldId: levelS.id, error: 'OPTION_NOT_MAPPED' });
    expect((await http().get(`/api/leads/${lead.id}`).set(bearer(ownerA)).expect(200)).body.status).toBe('QUALIFIED');
    // The convert form can answer the student field itself.
    const ok = (await http().post(`/api/leads/${lead.id}/convert`).set(bearer(ownerA)).send({ studentResolution: 'CREATE_NEW', customFields: { [levelS.id]: levelS.options[1].id } }).expect(201)).body;
    expect((await http().get(`/api/students/${ok.student.id}`).set(bearer(ownerA)).expect(200)).body.customFields[levelS.id]).toBe(levelS.options[1].id);
  });

  it('empty, false and zero are kept apart from missing; a new required field does not lock old records', async () => {
    const flag = (await field(ownerA, { entityType: 'STUDENT', label: 'Rozilik', fieldType: 'BOOLEAN' }).expect(201)).body;
    const num = (await field(ownerA, { entityType: 'STUDENT', label: 'Ball', fieldType: 'NUMBER' }).expect(201)).body;
    const note = (await field(ownerA, { entityType: 'STUDENT', label: 'Eslatma', fieldType: 'TEXT' }).expect(201)).body;
    const s = (await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'Zero', customFields: { [levelS.id]: levelS.options[0].id, [flag.id]: false, [num.id]: 0, [note.id]: '' } }).expect(201)).body;
    const got = (await http().get(`/api/students/${s.id}`).set(bearer(ownerA)).expect(200)).body.customFields;
    expect(got[flag.id]).toBe(false);
    expect(got[num.id]).toBe(0);
    expect(got[note.id]).toBe('');
    // Now a required field appears; the old student stays editable.
    const must = (await field(ownerA, { entityType: 'STUDENT', label: 'Majburiy', fieldType: 'TEXT', required: true }).expect(201)).body;
    await http().patch(`/api/students/${s.id}`).set(bearer(ownerA)).send({ fullName: 'Zero Edited' }).expect(200);
    await http().patch(`/api/students/${s.id}`).set(bearer(ownerA)).send({ customFields: { [must.id]: '' } }).expect(400);
    await http().patch(`/api/students/${s.id}`).set(bearer(ownerA)).send({ customFields: { [must.id]: 'ok' } }).expect(200);
    // New students must answer it.
    const r = await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'New', customFields: { [levelS.id]: levelS.options[0].id } }).expect(400);
    expect(r.body.errors.map((e: { fieldId: string }) => e.fieldId)).toEqual([must.id]);
    await http().post(`/api/custom-fields/${must.id}/archive`).set(bearer(ownerA)).expect(201);
  });

  it('type changes only while unused; renamed options keep their id; an option in use is archived, not lost', async () => {
    const used = (await field(ownerA, { entityType: 'STUDENT', label: 'Smena', fieldType: 'SELECT', options: [{ label: 'Ertalab' }, { label: 'Kechki' }] }).expect(201)).body;
    const [morning, evening] = used.options;
    await http().patch(`/api/students/${studentA}`).set(bearer(ownerA)).send({ customFields: { [used.id]: evening.id } }).expect(200);
    await http().patch(`/api/custom-fields/${used.id}`).set(bearer(ownerA)).send({ fieldType: 'TEXT' }).expect(409);
    // Rename "Kechki" and drop it from the list while a student has it.
    const after = (await http().patch(`/api/custom-fields/${used.id}`).set(bearer(ownerA)).send({ options: [{ id: morning.id, label: 'Tonggi' }] }).expect(200)).body;
    expect(after.options).toEqual([{ id: morning.id, label: 'Tonggi' }, { id: evening.id, label: 'Kechki', archived: true }]);
    expect((await http().get(`/api/students/${studentA}`).set(bearer(ownerA)).expect(200)).body.customFields[used.id]).toBe(evening.id);
    // Unused field: the type may change.
    const free = (await field(ownerA, { entityType: 'STUDENT', label: 'Bo\'sh', fieldType: 'TEXT' }).expect(201)).body;
    expect((await http().patch(`/api/custom-fields/${free.id}`).set(bearer(ownerA)).send({ fieldType: 'NUMBER' }).expect(200)).body.fieldType).toBe('NUMBER');
  });

  it('two people editing different fields of one student at once both keep their change', async () => {
    const a = (await field(ownerA, { entityType: 'STUDENT', label: 'Maktab', fieldType: 'TEXT' }).expect(201)).body;
    const b = (await field(ownerA, { entityType: 'STUDENT', label: 'Sinf', fieldType: 'NUMBER' }).expect(201)).body;
    await Promise.all([
      http().patch(`/api/students/${studentA}`).set(bearer(ownerA)).send({ customFields: { [a.id]: '21-maktab' } }).expect(200),
      http().patch(`/api/students/${studentA}`).set(bearer(managerA)).send({ customFields: { [b.id]: 9 } }).expect((r) => { if (r.status !== 200 && r.status !== 403) throw new Error(String(r.status)); }),
      http().patch(`/api/students/${studentA}`).set(bearer(ownerA)).send({ customFields: { [b.id]: 9 } }).expect(200),
    ]);
    const got = (await http().get(`/api/students/${studentA}`).set(bearer(ownerA)).expect(200)).body.customFields;
    expect(got[a.id]).toBe('21-maktab');
    expect(got[b.id]).toBe(9);
  });

  it('limits: field count, value size', async () => {
    const big = 'x'.repeat(501);
    const txt = (await field(ownerA, { entityType: 'LEAD', label: 'Qisqa', fieldType: 'TEXT' }).expect(201)).body;
    await http().patch(`/api/leads/${leadId}`).set(bearer(ownerA)).send({ customFields: { [txt.id]: big } }).expect((r) => { if (![400, 409].includes(r.status)) throw new Error(String(r.status)); });
    const active = (await http().get('/api/custom-fields?entityType=LEAD').set(bearer(ownerA)).expect(200)).body.length;
    for (let i = active; i < 30; i++) await field(ownerA, { entityType: 'LEAD', label: `L${i}`, fieldType: 'TEXT' }).expect(201);
    await field(ownerA, { entityType: 'LEAD', label: 'One too many', fieldType: 'TEXT' }).expect(400);
  });

  it('the export has a column per field and neutralises formulas', async () => {
    const evil = (await field(ownerA, { entityType: 'STUDENT', label: 'Havola', fieldType: 'TEXT' }).expect(201)).body;
    await http().post('/api/students').set(bearer(ownerA)).send({ fullName: '=HYPERLINK("http://evil","x")', customFields: { [levelS.id]: levelS.options[0].id, [evil.id]: '=1+1' } }).expect(201);
    const res = await http().get('/api/export/students.xlsx').set(bearer(ownerA)).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ArrayBuffer);
    const ws = wb.worksheets[0];
    const header = (ws.getRow(1).values as unknown[]).map(String);
    expect(header).toEqual(expect.arrayContaining(['Daraja', 'Havola', 'Smena']));
    const col = header.indexOf('Havola');
    let found = false;
    ws.eachRow((row) => {
      const name = String(row.getCell(1).value);
      if (name.includes('HYPERLINK')) {
        found = true;
        expect(name.startsWith("'=")).toBe(true);
        expect(String(row.getCell(col).value)).toBe("'=1+1");
        expect(typeof row.getCell(1).value).toBe('string'); // never a formula object
      }
    });
    expect(found).toBe(true);
  });

  it('student import reads custom columns by label, checks them, and saves them', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Import');
    ws.addRow(['F.I.O', 'Daraja', 'Smena', 'Noma\'lum ustun']);
    ws.addRow(['Import One', 'B1', 'Tonggi', 'x']);
    ws.addRow(['Import Two', 'C2', 'Tonggi', 'x']);
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    const preview = (await http().post('/api/import/students?dryRun=1').set(bearer(ownerA)).attach('file', file, 'students.xlsx').expect(201)).body;
    expect(preview.unknownColumns).toEqual(["Noma'lum ustun"]);
    expect(preview.rows[0].status).toBe('create');
    expect(preview.rows[1].status).toBe('error');
    expect(preview.rows[1].errors.join(' ')).toContain('Daraja: UNKNOWN_OPTION');
    // Fix the bad row, then run.
    ws.getRow(3).getCell(2).value = 'A1';
    const fixed = Buffer.from(await wb.xlsx.writeBuffer());
    // The other required field archived earlier is not asked; the restored "Daraja" is.
    const run = (await http().post('/api/import/students').set(bearer(ownerA)).attach('file', fixed, 'students.xlsx').expect(201)).body;
    expect(run.created).toBe(2);
    const list = (await http().get('/api/students').set(bearer(ownerA)).expect(200)).body;
    const one = (Array.isArray(list) ? list : list.items).find((s: { fullName: string }) => s.fullName === 'Import One');
    const detail = (await http().get(`/api/students/${one.id}`).set(bearer(ownerA)).expect(200)).body;
    expect(detail.customFields[levelS.id]).toBe(levelS.options[1].id);
  });

  it('the cabinet sees only fields marked for it', async () => {
    const shown = (await field(ownerA, { entityType: 'STUDENT', label: 'Kurs boshlanishi', fieldType: 'DATE', portalVisible: true }).expect(201)).body;
    const hidden = (await field(ownerA, { entityType: 'STUDENT', label: 'Ichki izoh', fieldType: 'TEXT' }).expect(201)).body;
    const kidPhone = phone();
    const kid = (await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'Cabinet Kid', phone: kidPhone, customFields: { [levelS.id]: levelS.options[0].id, [shown.id]: '2026-11-01', [hidden.id]: 'teacher-only note' } }).expect(201)).body;
    const { pin } = (await http().post(`/api/students/${kid.id}/portal-pin`).set(bearer(ownerA)).expect(201)).body;
    const cab = (await http().post('/api/portal/auth/phone/verify').send({ phone: kidPhone, pin }).expect(201)).body.accessToken;
    const fields = (await http().get('/api/portal/custom-fields').set(bearer(cab)).expect(200)).body;
    expect(fields).toEqual([{ id: shown.id, label: 'Kurs boshlanishi', value: '2026-11-01' }]);
    await http().get('/api/portal/custom-fields').expect(401);
  });
});
