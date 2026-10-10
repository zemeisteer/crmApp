import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// Custom fields at the edges: what happens to a lead-to-student mapping
// when the student field changes under it, to values when something fails
// half way, and to two people saving at once.
describe('Custom fields: edges (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: string, other: string;
  let phoneN = 0;
  const phone = () => `+99891${String(6000000 + (suffix % 1000000) + phoneN++).slice(-7)}`;

  type Def = { id: string; label: string; fieldType: string; studentFieldId: string | null; archivedAt: string | null; options: { id: string; label: string; archived?: boolean }[] };
  const register = async (key: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `CFE ${key} ${suffix}`, subdomain: `cfe-${key}-${suffix}`, email: `cfe-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` })
      .expect(201)).body.accessToken as string;
  const field = async (body: Record<string, unknown>, token = owner) => (await http().post('/api/custom-fields').set(bearer(token)).send(body).expect(201)).body as Def;
  const patchField = (id: string, body: Record<string, unknown>) => http().patch(`/api/custom-fields/${id}`).set(bearer(owner)).send(body);
  const defs = async (entityType: string) => (await http().get(`/api/custom-fields?entityType=${entityType}&includeArchived=true`).set(bearer(owner)).expect(200)).body as Def[];
  const def = async (entityType: string, id: string) => (await defs(entityType)).find((d) => d.id === id)!;
  const futureDay = (days: number) => new Date(Date.now() + days * 86_400_000 + 5 * 3_600_000).toISOString().slice(0, 10);
  let trialHour = 8;
  const qualifiedLead = async (customFields: Record<string, unknown>) => {
    const lead = (await http().post('/api/leads').set(bearer(owner)).send({ fullName: `Lead ${phoneN}`, phone: phone(), customFields }).expect(201)).body;
    await http().post(`/api/leads/${lead.id}/transition`).set(bearer(owner)).send({ toStatus: 'CONTACTED' }).expect(201);
    const t = await http().post(`/api/leads/${lead.id}/trials`).set(bearer(owner)).send({ scheduledAt: `${futureDay(25)}T${String(trialHour++ % 24).padStart(2, '0')}:00:00+05:00` }).expect(201);
    await http().post(`/api/leads/${lead.id}/trials/${t.body.id}/attend`).set(bearer(owner)).send({}).expect(201);
    await http().post(`/api/leads/${lead.id}/transition`).set(bearer(owner)).send({ toStatus: 'QUALIFIED' }).expect(201);
    return lead.id as string;
  };
  const convert = (leadId: string, body: Record<string, unknown> = {}) => http().post(`/api/leads/${leadId}/convert`).set(bearer(owner)).send({ studentResolution: 'CREATE_NEW', ...body });
  const student = async (id: string) => (await http().get(`/api/students/${id}`).set(bearer(owner)).expect(200)).body as { customFields: Record<string, unknown> };
  const studentCount = async () => (await http().get('/api/students?page=1&pageSize=1').set(bearer(owner)).expect(200)).body.total as number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    owner = await register('a');
    other = await register('b');
  }, 120_000);

  afterAll(async () => { await app?.close(); });

  it('a student field that changes type lets go of the lead fields mapped to it', async () => {
    const target = await field({ entityType: 'STUDENT', label: 'Maktab', fieldType: 'TEXT' });
    const source = await field({ entityType: 'LEAD', label: 'Maktab (lid)', fieldType: 'TEXT', studentFieldId: target.id });
    expect(source.studentFieldId).toBe(target.id);
    // No student has a value yet, so the type may change - and the mapping no longer fits.
    const changed = (await patchField(target.id, { fieldType: 'NUMBER' }).expect(200)).body;
    expect(changed.fieldType).toBe('NUMBER');
    expect(changed.unlinkedLeadFields).toEqual([{ id: source.id, label: 'Maktab (lid)' }]);
    expect((await def('LEAD', source.id)).studentFieldId).toBeNull();
    // A lead that has the text converts; the text is not pushed into a number field.
    const leadId = await qualifiedLead({ [source.id]: '21-maktab' });
    const res = (await convert(leadId).expect(201)).body;
    expect((await student(res.student.id)).customFields[target.id]).toBeUndefined();
    // Mapping the two again is refused until the types agree.
    await patchField(source.id, { studentFieldId: target.id }).expect(400);
  });

  it('an archived student field is skipped by the conversion, and carried again once restored', async () => {
    const target = await field({ entityType: 'STUDENT', label: 'Sinf', fieldType: 'NUMBER' });
    const source = await field({ entityType: 'LEAD', label: 'Sinf (lid)', fieldType: 'NUMBER', studentFieldId: target.id });
    await http().post(`/api/custom-fields/${target.id}/archive`).set(bearer(owner)).expect(201);
    // The mapping is kept (the field may come back) and says so.
    const mapped = await def('LEAD', source.id);
    expect(mapped.studentFieldId).toBe(target.id);
    const first = (await convert(await qualifiedLead({ [source.id]: 7 })).expect(201)).body;
    expect((await student(first.student.id)).customFields[target.id]).toBeUndefined();
    await http().post(`/api/custom-fields/${target.id}/restore`).set(bearer(owner)).expect(201);
    const second = (await convert(await qualifiedLead({ [source.id]: 9 })).expect(201)).body;
    expect((await student(second.student.id)).customFields[target.id]).toBe(9);
  });

  it('a mapped option that was archived on the student side stops the conversion whole; the form can answer it', async () => {
    const target = await field({ entityType: 'STUDENT', label: 'Daraja', fieldType: 'SELECT', options: [{ label: 'A1' }, { label: 'B1' }] });
    const source = await field({ entityType: 'LEAD', label: 'Daraja (lid)', fieldType: 'SELECT', options: [{ label: 'Boshlang\'ich' }, { label: 'O\'rta' }] });
    const [sa, sb] = target.options;
    const [la, lb] = source.options;
    await patchField(source.id, { studentFieldId: target.id, optionMap: { [la.id]: sa.id, [lb.id]: sb.id } }).expect(200);
    // B1 leaves the student field's list (no student has it, so it is simply gone or archived).
    await patchField(target.id, { options: [{ id: sa.id, label: 'A1' }] }).expect(200);
    const leadId = await qualifiedLead({ [source.id]: lb.id });
    const before = await studentCount();
    const refused = await convert(leadId).expect(400);
    expect(refused.body.errors[0].fieldId).toBe(target.id);
    expect(['OPTION_ARCHIVED', 'UNKNOWN_OPTION', 'OPTION_NOT_MAPPED']).toContain(refused.body.errors[0].error);
    // Nothing was created and the lead is where it was.
    expect(await studentCount()).toBe(before);
    expect((await http().get(`/api/leads/${leadId}`).set(bearer(owner)).expect(200)).body.status).toBe('QUALIFIED');
    const ok = (await convert(leadId, { customFields: { [target.id]: sa.id } }).expect(201)).body;
    expect((await student(ok.student.id)).customFields[target.id]).toBe(sa.id);
  });

  it('a save with one bad value saves nothing: no student, no other field', async () => {
    const must = await field({ entityType: 'STUDENT', label: 'Shartnoma raqami', fieldType: 'TEXT', required: true });
    const num = await field({ entityType: 'STUDENT', label: 'Yosh', fieldType: 'NUMBER' });
    const before = await studentCount();
    // Missing the required one; and a required one with a bad neighbour.
    const missing = await http().post('/api/students').set(bearer(owner)).send({ fullName: 'Half Saved', phone: phone() }).expect(400);
    expect(missing.body.errors[0]).toMatchObject({ fieldId: must.id, error: 'REQUIRED' });
    const bad = await http().post('/api/students').set(bearer(owner)).send({ fullName: 'Half Saved', phone: phone(), customFields: { [must.id]: 'SH-1', [num.id]: 'o\'n ikki' } }).expect(400);
    expect(bad.body.errors[0]).toMatchObject({ fieldId: num.id, error: 'NUMBER_EXPECTED' });
    expect(await studentCount()).toBe(before);
    // An update with a good and a bad value changes neither.
    const s = (await http().post('/api/students').set(bearer(owner)).send({ fullName: 'Whole', phone: phone(), customFields: { [must.id]: 'SH-2', [num.id]: 12 } }).expect(201)).body;
    await http().patch(`/api/students/${s.id}`).set(bearer(owner)).send({ fullName: 'Renamed', customFields: { [must.id]: 'SH-3', [num.id]: 'xato' } }).expect(400);
    const now = (await http().get(`/api/students/${s.id}`).set(bearer(owner)).expect(200)).body;
    expect(now.fullName).toBe('Whole');
    expect(now.customFields).toMatchObject({ [must.id]: 'SH-2', [num.id]: 12 });
    // A required field cannot be emptied, but another field can be edited without resending it.
    expect((await http().patch(`/api/students/${s.id}`).set(bearer(owner)).send({ customFields: { [must.id]: null } }).expect(400)).body.errors[0].error).toBe('REQUIRED');
    await http().patch(`/api/students/${s.id}`).set(bearer(owner)).send({ customFields: { [num.id]: 13 } }).expect(200);
    await http().post(`/api/custom-fields/${must.id}/archive`).set(bearer(owner)).expect(201);
  });

  it('a field made required later does not lock the leads that were there before', async () => {
    const lead = (await http().post('/api/leads').set(bearer(owner)).send({ fullName: 'Old Lead', phone: phone() }).expect(201)).body;
    const must = await field({ entityType: 'LEAD', label: 'Qayerdan eshitdi', fieldType: 'TEXT', required: true });
    // The old lead is edited without the new field; a new lead must answer it.
    await http().patch(`/api/leads/${lead.id}`).set(bearer(owner)).send({ fullName: 'Old Lead Renamed' }).expect(200);
    await http().post('/api/leads').set(bearer(owner)).send({ fullName: 'New Lead', phone: phone() }).expect(400);
    await http().post(`/api/custom-fields/${must.id}/archive`).set(bearer(owner)).expect(201);
    await http().post('/api/leads').set(bearer(owner)).send({ fullName: 'New Lead', phone: phone() }).expect(201);
  });

  it('two saves of the same field at once: one of the two values, nothing broken; two fields with one key: one', async () => {
    const a = await field({ entityType: 'STUDENT', label: 'Izoh', fieldType: 'TEXT' });
    const b = await field({ entityType: 'STUDENT', label: 'Ball', fieldType: 'NUMBER' });
    const s = (await http().post('/api/students').set(bearer(owner)).send({ fullName: 'Racer', phone: phone(), customFields: { [b.id]: 5 } }).expect(201)).body;
    const saves = await Promise.all(['birinchi', 'ikkinchi', 'uchinchi'].map((v) => http().patch(`/api/students/${s.id}`).set(bearer(owner)).send({ customFields: { [a.id]: v } })));
    expect(saves.map((r) => r.status)).toEqual([200, 200, 200]);
    const now = (await student(s.id)).customFields;
    expect(['birinchi', 'ikkinchi', 'uchinchi']).toContain(now[a.id]);
    expect(now[b.id]).toBe(5);
    const twins = await Promise.all([0, 1, 2].map(() => http().post('/api/custom-fields').set(bearer(owner)).send({ entityType: 'STUDENT', label: 'Egizak', key: 'egizak', fieldType: 'TEXT' })));
    expect(twins.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  });

  it('what the cabinet shows follows the switch, the archive and the restore', async () => {
    const shown = await field({ entityType: 'STUDENT', label: 'Kitob', fieldType: 'TEXT', portalVisible: true });
    const kidPhone = phone();
    const kid = (await http().post('/api/students').set(bearer(owner)).send({ fullName: 'Portal Kid', phone: kidPhone, customFields: { [shown.id]: 'English File' } }).expect(201)).body;
    const { pin } = (await http().post(`/api/students/${kid.id}/portal-pin`).set(bearer(owner)).expect(201)).body;
    const cab = (await http().post('/api/portal/auth/phone/verify').send({ phone: kidPhone, pin }).expect(201)).body.accessToken;
    const seen = async () => ((await http().get('/api/portal/custom-fields').set(bearer(cab)).expect(200)).body as Array<{ id: string }>).some((f) => f.id === shown.id);
    expect(await seen()).toBe(true);
    await patchField(shown.id, { portalVisible: false }).expect(200);
    expect(await seen()).toBe(false);
    await patchField(shown.id, { portalVisible: true }).expect(200);
    await http().post(`/api/custom-fields/${shown.id}/archive`).set(bearer(owner)).expect(201);
    expect(await seen()).toBe(false);
    await http().post(`/api/custom-fields/${shown.id}/restore`).set(bearer(owner)).expect(201);
    expect(await seen()).toBe(true);
    // The value survived the archive.
    expect((await student(kid.id)).customFields[shown.id]).toBe('English File');
  });

  it("another center's field id is not a field: refused, and nothing is written under it", async () => {
    const theirs = await field({ entityType: 'STUDENT', label: 'Begona', fieldType: 'TEXT' }, other);
    const s = (await http().post('/api/students').set(bearer(owner)).send({ fullName: 'Mine', phone: phone() }).expect(201)).body;
    const res = await http().patch(`/api/students/${s.id}`).set(bearer(owner)).send({ customFields: { [theirs.id]: 'leak' } }).expect(400);
    expect(JSON.stringify(res.body)).not.toContain('Begona');
    expect((await student(s.id)).customFields[theirs.id]).toBeUndefined();
    await patchField(theirs.id, { label: 'Hacked' }).expect(404);
    // Nor can a lead field of this center be mapped to that field.
    await http().post('/api/custom-fields').set(bearer(owner)).send({ entityType: 'LEAD', label: 'Map away', fieldType: 'TEXT', studentFieldId: theirs.id }).expect(400);
  });
});
