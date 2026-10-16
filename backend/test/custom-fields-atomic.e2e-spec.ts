import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, type Database } from '../src/db/db.module.js';
import { customFieldValues, enrollmentPeriods, leads, students } from '../src/db/schema.js';
import { CustomFieldsService } from '../src/custom-fields/custom-fields.service.js';
import { AuditService } from '../src/audit/audit.service.js';

// A change to a student or a lead and its custom values is one write: when
// writing the custom values fails, nothing of the change is kept - not the
// profile, the status, the stays in groups nor the values - and no "updated"
// audit entry is made.
describe('Custom fields saved with the record, all or nothing (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  let fields: CustomFieldsService;
  let audit: AuditService;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  let n = 0;
  const phone = () => `+99895${String(1000000 + (suffix % 1000000) + n++).slice(-7)}`;
  let studentField: string, leadField: string, group: string;

  // The real write runs inside the transaction, then fails: what it wrote must go too.
  const failNextWrite = () => {
    const real = fields.write.bind(fields);
    return vi.spyOn(fields, 'write').mockImplementationOnce(async (...args: Parameters<CustomFieldsService['write']>) => {
      await real(...args);
      throw new Error('injected: custom values could not be written');
    });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    fields = app.get(CustomFieldsService);
    audit = app.get(AuditService);
    token = (await http().post('/api/auth/register')
      .send({ centerName: `CFA ${suffix}`, subdomain: `cfa-${suffix}`, email: `cfa-${suffix}@test.uz`, password: 'password123', fullName: 'Owner CFA' })
      .expect(201)).body.accessToken;
    studentField = (await http().post('/api/custom-fields').set(auth()).send({ entityType: 'STUDENT', label: 'Maktab', fieldType: 'TEXT' }).expect(201)).body.id;
    leadField = (await http().post('/api/custom-fields').set(auth()).send({ entityType: 'LEAD', label: 'Qayerdan bildi', fieldType: 'TEXT', studentFieldId: studentField }).expect(201)).body.id;
    group = (await http().post('/api/groups').set(auth()).send({ name: 'CFA Group', subject: 'Math' }).expect(201)).body.id;
  }, 120_000);

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  it('a student update: profile, status, stays and values are all kept as they were', async () => {
    const s = (await http().post('/api/students').set(auth()).send({ fullName: 'Eski Ism', phone: phone(), groupIds: [group], customFields: { [studentField]: '12-maktab' } }).expect(201)).body;
    const staysBefore = await db.select().from(enrollmentPeriods).where(eq(enrollmentPeriods.studentId, s.id));
    expect(staysBefore.filter((p) => !p.endedAt)).toHaveLength(1);

    failNextWrite();
    const logged = vi.spyOn(audit, 'log');
    await http().patch(`/api/students/${s.id}`).set(auth()).send({ fullName: 'Yangi Ism', status: 'PAUSED', customFields: { [studentField]: '45-maktab' } }).expect(500);

    const [row] = await db.select().from(students).where(eq(students.id, s.id));
    expect(row).toMatchObject({ fullName: 'Eski Ism', status: 'ACTIVE', pausedAt: null });
    const staysAfter = await db.select().from(enrollmentPeriods).where(eq(enrollmentPeriods.studentId, s.id));
    expect(staysAfter.map((p) => [p.id, p.endedAt])).toEqual(staysBefore.map((p) => [p.id, p.endedAt]));
    const values = await db.select().from(customFieldValues).where(eq(customFieldValues.studentId, s.id));
    expect(values.map((v) => v.value)).toEqual(['12-maktab']);
    expect(logged.mock.calls.filter(([e]) => e.action === 'update' && e.entityId === s.id)).toHaveLength(0);

    // The same change, when the write works: all of it.
    const ok = (await http().patch(`/api/students/${s.id}`).set(auth()).send({ fullName: 'Yangi Ism', status: 'PAUSED', customFields: { [studentField]: '45-maktab' } }).expect(200)).body;
    expect(ok).toMatchObject({ fullName: 'Yangi Ism', status: 'PAUSED', customFields: { [studentField]: '45-maktab' } });
    expect((await db.select().from(enrollmentPeriods).where(eq(enrollmentPeriods.studentId, s.id))).filter((p) => !p.endedAt)).toHaveLength(0);
  });

  it('a lead update, a new lead and a conversion: nothing is half saved', async () => {
    const lead = (await http().post('/api/leads').set(auth()).send({ fullName: 'CFA Lid', phone: phone(), customFields: { [leadField]: 'Instagram' } }).expect(201)).body;

    failNextWrite();
    await http().patch(`/api/leads/${lead.id}`).set(auth()).send({ fullName: 'Boshqa Ism', notes: 'yangi', customFields: { [leadField]: 'Telegram' } }).expect(500);
    const [l] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l).toMatchObject({ fullName: 'CFA Lid', notes: null });
    expect((await db.select().from(customFieldValues).where(eq(customFieldValues.leadId, lead.id))).map((v) => v.value)).toEqual(['Instagram']);

    // A new lead whose values fail: no lead at all.
    const p = phone();
    failNextWrite();
    await http().post('/api/leads').set(auth()).send({ fullName: 'CFA Yo\'q', phone: p, customFields: { [leadField]: 'Sayt' } }).expect(500);
    expect((await db.select().from(leads).where(eq(leads.fullName, 'CFA Yo\'q')))).toHaveLength(0);

    // A conversion whose values fail: no student, the lead not converted.
    await http().post(`/api/leads/${lead.id}/transition`).set(auth()).send({ toStatus: 'CONTACTED' }).expect(201);
    const day = new Date(Date.now() + 20 * 86_400_000 + 5 * 3_600_000).toISOString().slice(0, 10);
    const trial = (await http().post(`/api/leads/${lead.id}/trials`).set(auth()).send({ scheduledAt: `${day}T15:00:00+05:00` }).expect(201)).body;
    await http().post(`/api/leads/${lead.id}/trials/${trial.id}/attend`).set(auth()).send({}).expect(201);
    await http().post(`/api/leads/${lead.id}/transition`).set(auth()).send({ toStatus: 'QUALIFIED' }).expect(201);
    const before = (await db.select().from(students).where(eq(students.tenantId, l.tenantId))).length;
    failNextWrite();
    await http().post(`/api/leads/${lead.id}/convert`).set(auth()).send({ studentResolution: 'CREATE_NEW' }).expect(500);
    expect((await db.select().from(students).where(eq(students.tenantId, l.tenantId))).length).toBe(before);
    expect((await db.select().from(leads).where(eq(leads.id, lead.id)))[0].status).toBe('QUALIFIED');
    // And when it works, the value goes across.
    const done = (await http().post(`/api/leads/${lead.id}/convert`).set(auth()).send({ studentResolution: 'CREATE_NEW' }).expect(201)).body;
    const studentId = done.student?.id ?? done.studentId;
    expect((await db.select().from(customFieldValues).where(eq(customFieldValues.studentId, studentId))).map((v) => v.value)).toEqual(['Instagram']);
  });
});
