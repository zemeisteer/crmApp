import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, type Database } from '../src/db/db.module.js';
import { auditLogs, customFieldValues, leadActivities, placementAttempts } from '../src/db/schema.js';

// Deleting for good where the site offers it: a custom field and a lead
// only once archived (the archive is the way back until then), a placement
// test with its results. Each leaves an audit entry; another center, or a
// role without the right, cannot.
describe('Delete for good (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: string, manager: string, teacher: string, other: string;
  let n = 0;
  const phone = () => `+99891${String(suffix + ++n).slice(-7)}`;

  const register = async (key: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `Del ${key} ${suffix}`, subdomain: `del-${key}-${suffix}`, email: `del-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` })
      .expect(201)).body.accessToken as string;
  const invite = async (role: string) => {
    const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `del-${role.toLowerCase()}-${suffix}@test.uz`, role }).expect(201)).body;
    return (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: role, password: 'password12345' }).expect(201)).body.accessToken as string;
  };
  const audited = async (entityId: string) => (await db.select().from(auditLogs).where(eq(auditLogs.entityId, entityId))).map((r) => r.action);

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    owner = await register('a');
    other = await register('b');
    manager = await invite('MANAGER');
    teacher = await invite('TEACHER');
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('a custom field: refused while active; once archived, gone with its values', async () => {
    const f = (await http().post('/api/custom-fields').set(bearer(owner)).send({ entityType: 'LEAD', label: 'School', fieldType: 'TEXT' }).expect(201)).body;
    const lead = (await http().post('/api/leads').set(bearer(owner)).send({ fullName: 'Field Lead', phone: phone(), customFields: { [f.id]: 'School 5' } }).expect(201)).body;
    expect(await db.select().from(customFieldValues).where(eq(customFieldValues.definitionId, f.id))).toHaveLength(1);

    expect((await http().delete(`/api/custom-fields/${f.id}`).set(bearer(owner)).expect(409)).body.code).toBe('NOT_ARCHIVED');
    await http().post(`/api/custom-fields/${f.id}/archive`).set(bearer(owner)).expect(201);
    await http().delete(`/api/custom-fields/${f.id}`).set(bearer(manager)).expect(403);
    await http().delete(`/api/custom-fields/${f.id}`).set(bearer(other)).expect(404);
    await http().delete(`/api/custom-fields/${f.id}`).set(bearer(owner)).expect(200);

    const all = (await http().get('/api/custom-fields?entityType=LEAD&includeArchived=1').set(bearer(owner)).expect(200)).body as Array<{ id: string }>;
    expect(all.find((d) => d.id === f.id)).toBeUndefined();
    expect(await db.select().from(customFieldValues).where(eq(customFieldValues.definitionId, f.id))).toHaveLength(0);
    // The lead itself stays.
    await http().get(`/api/leads/${lead.id}`).set(bearer(owner)).expect(200);
    expect(await audited(f.id)).toContain('custom_field.delete');
  });

  it('a lead: refused while active; once archived, gone with its history', async () => {
    const lead = (await http().post('/api/leads').set(bearer(owner)).send({ fullName: 'Gone Lead', phone: phone() }).expect(201)).body;
    expect((await http().delete(`/api/leads/${lead.id}/permanent`).set(bearer(owner)).expect(409)).body.code).toBe('NOT_ARCHIVED');
    await http().post(`/api/leads/${lead.id}/archive`).set(bearer(owner)).send({ reason: 'test' }).expect(201);
    await http().delete(`/api/leads/${lead.id}/permanent`).set(bearer(teacher)).expect(403);
    await http().delete(`/api/leads/${lead.id}/permanent`).set(bearer(other)).expect(404);
    await http().delete(`/api/leads/${lead.id}/permanent`).set(bearer(owner)).expect(200);
    await http().get(`/api/leads/${lead.id}`).set(bearer(owner)).expect(404);
    expect(await db.select().from(leadActivities).where(eq(leadActivities.leadId, lead.id))).toHaveLength(0);
    expect(await audited(lead.id)).toContain('delete');
  });

  it('a placement test: gone with its results; only owners and admins', async () => {
    const t = (await http().post('/api/placement-tests').set(bearer(owner))
      .send({ subject: 'Ingliz tili', title: 'To delete', questions: [{ type: 'MCQ', prompt: 'She ___ a teacher.', options: ['am', 'is'], correctAnswer: 'B', level: 1 }] })
      .expect(201)).body;
    await http().post(`/api/public/placement/${t.token}/submit`).send({ fullName: 'Taker', phone: phone(), answers: ['B'] }).expect(201);
    expect(await db.select().from(placementAttempts).where(eq(placementAttempts.testId, t.id))).toHaveLength(1);

    await http().delete(`/api/placement-tests/${t.id}`).set(bearer(teacher)).expect(403);
    await http().delete(`/api/placement-tests/${t.id}`).set(bearer(other)).expect(404);
    expect((await http().delete(`/api/placement-tests/${t.id}`).set(bearer(owner)).expect(200)).body).toMatchObject({ deleted: true, attempts: 1 });
    await http().get(`/api/placement-tests/${t.id}`).set(bearer(owner)).expect(404);
    expect(await db.select().from(placementAttempts).where(eq(placementAttempts.testId, t.id))).toHaveLength(0);
    await http().get(`/api/public/placement/${t.token}`).expect(404);
    expect(await audited(t.id)).toContain('delete');
  });
});
