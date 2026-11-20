import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { eq } from 'drizzle-orm';
import { DB, Database } from '../src/db/db.module.js';
import { leadTrials } from '../src/db/schema.js';

// A teacher sees the trial lessons coming to them: in one of their groups,
// or booked with them by name. Who and when only, not the lead's phone.
// Another teacher, and another center, see none of it.
describe("A teacher's trial lessons (e2e)", () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const tail = String(suffix).slice(-7);
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: string;

  const teacherWithAccount = async (name: string) => {
    const id = (await http().post('/api/teachers').set(bearer(owner)).send({ fullName: name, subject: 'English' }).expect(201)).body.id as string;
    const email = `tm-${name.toLowerCase().replace(/\s+/g, '-')}-${suffix}@test.uz`;
    await http().post(`/api/teachers/${id}/account`).set(bearer(owner)).send({ email, password: 'secret123' }).expect(201);
    const token = (await http().post('/api/auth/login').send({ email, password: 'secret123' }).expect(201)).body.accessToken as string;
    return { id, token };
  };
  const trial = async (body: Record<string, unknown>, name: string, n: number) => {
    const lead = (await http().post('/api/leads').set(bearer(owner)).send({ fullName: name, phone: `+99895${tail.slice(0, 5)}${n}${n}` }).expect(201)).body.id as string;
    await http().post(`/api/leads/${lead}/transition`).set(bearer(owner)).send({ toStatus: 'CONTACTED' }).expect(201);
    const when = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const booked = (await http().post(`/api/leads/${lead}/trials`).set(bearer(owner)).send({ scheduledAt: `${when}T${10 + n}:00:00+05:00`, ...body }).expect(201)).body as { id: string };
    return { lead, trialId: booked.id };
  };

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `TM ${suffix}`, subdomain: `tm-${tail}`, email: `tm-${suffix}@test.uz`, password: 'password123', fullName: 'TM Owner' })
      .expect(201)).body.accessToken;
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('their group\'s trial and one booked with them show; another teacher sees neither; no phone', async () => {
    const a = await teacherWithAccount('Trial Teacher');
    const b = await teacherWithAccount('Other Teacher');
    const group = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'TM Group', subject: 'English', teacherId: a.id, maxStudents: 10 }).expect(201)).body.id as string;
    await trial({ groupId: group }, 'Group Visitor', 1);
    await trial({ teacherId: a.id }, 'Named Visitor', 2);

    const mine = (await http().get('/api/trials/mine').set(bearer(a.token)).expect(200)).body as Array<Record<string, unknown>>;
    expect(mine.map((t) => t.name)).toEqual(['Group Visitor', 'Named Visitor']);
    expect(mine[0]).toMatchObject({ group: { id: group, name: 'TM Group' }, durationMinutes: 60 });
    expect(JSON.stringify(mine)).not.toMatch(/\+99895/);

    expect((await http().get('/api/trials/mine').set(bearer(b.token)).expect(200)).body).toEqual([]);
    // Someone with no teacher record: nothing (not the whole center's).
    expect((await http().get('/api/trials/mine').set(bearer(owner)).expect(200)).body).toEqual([]);
    await http().get('/api/trials/mine').expect(401);
  });

  it("the trial's teacher writes how it went: the lead is marked attended and the manager reads it", async () => {
    const a = await teacherWithAccount('Feedback Teacher');
    const b = await teacherWithAccount('Stranger Teacher');
    const { lead, trialId } = await trial({ teacherId: a.id }, 'Feedback Visitor', 3);
    const send = (token: string, body: object) => http().post(`/api/trials/mine/${trialId}/feedback`).set(bearer(token)).send(body);

    // Not begun yet: nothing to say about it.
    await send(a.token, { level: 'A2' }).expect(409);
    await app.get<Database>(DB).update(leadTrials).set({ scheduledAt: new Date(Date.now() - 3_600_000) }).where(eq(leadTrials.id, trialId));

    await send(b.token, { level: 'A2' }).expect(404);
    await send(owner, { level: 'A2' }).expect(404);
    await send(a.token, {}).expect(400);
    await send(a.token, { engagement: 'BORED' }).expect(400);

    const saved = (await send(a.token, { level: 'A2', engagement: 'ACTIVE', recommendation: 'General English A2', note: 'Speaks well, weak grammar' }).expect(201)).body;
    expect(saved).toMatchObject({ status: 'ATTENDED' });
    expect(saved.outcomeNote).toBe(['Bilim darajasi: A2', 'Darsdagi faolligi: faol', 'Tavsiya: General English A2', 'Izoh: Speaks well, weak grammar'].join('\n'));
    const leadNow = (await http().get(`/api/leads/${lead}`).set(bearer(owner)).expect(200)).body;
    expect(leadNow.status).toBe('TRIAL_ATTENDED');
    expect(JSON.stringify(leadNow)).toContain('weak grammar');

    // Corrected afterwards: the note is replaced, the trial stays attended.
    const again = (await send(a.token, { level: 'B1' }).expect(201)).body;
    expect(again).toMatchObject({ status: 'ATTENDED', outcomeNote: 'Bilim darajasi: B1' });
    const mine = (await http().get('/api/trials/mine').set(bearer(a.token)).expect(200)).body as Array<{ id: string; status: string; outcomeNote: string }>;
    expect(mine.find((x) => x.id === trialId)).toMatchObject({ status: 'ATTENDED', outcomeNote: 'Bilim darajasi: B1' });
  });
});
