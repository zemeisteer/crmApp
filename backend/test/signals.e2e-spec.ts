import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { attendance, invoices, leadActivities, leads, leadTrials, payments, students, tenants, users } from '../src/db/schema.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { SignalsService } from '../src/signals/signals.service.js';

// Rule signals: each fires once per occasion, keeps its reason and values,
// tells people or plans a follow-up - and never changes a student, a lead's
// stage or any money.
describe('Rule signals (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const suffix = Date.now();
  const tail = String(suffix).slice(-7);
  const http = () => request(app.getHttpServer());
  let owner: Record<string, string>;
  let tenantId: string;
  const told: Array<{ chat: string; text: string }> = [];
  // Monday 2026-10-19, 11:00 in Tashkent.
  const NOW = new Date('2026-10-19T06:00:00Z');

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const tg = app.get(TelegramService);
    tg.sendMessage = (async (chat: string, text: string) => {
      told.push({ chat, text });
      return 1;
    }) as typeof tg.sendMessage;
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Sig ${suffix}`, subdomain: `sig-${suffix}`, email: `sig-${suffix}@test.uz`, password: 'password123', fullName: 'Sig Owner' })
      .expect(201)).body;
    owner = { Authorization: `Bearer ${reg.accessToken}` };
    tenantId = reg.tenant?.id ?? reg.user.tenantId;
    await db.update(users).set({ telegramChatId: `2${tail}` }).where(eq(users.id, reg.user.id));
  });

  afterAll(async () => {
    await app?.close();
  });

  const tenant = async () => (await db.select().from(tenants).where(eq(tenants.id, tenantId)))[0];

  it('three absences in a row tell the managers once, with the reason; a lesson attended resets it', async () => {
    const g = (await http().post('/api/groups').set(owner).send({ name: 'Sig Group', subject: 'Math' }).expect(201)).body.id as string;
    const kid = (await http().post('/api/students').set(owner).send({ fullName: 'Often Away', phone: `+99897${tail}`, groupIds: [g] }).expect(201)).body.id as string;
    const mark = (date: string, status: 'PRESENT' | 'ABSENT') => db.insert(attendance).values({ tenantId, groupId: g, studentId: kid, date, status });
    await mark('2026-10-05', 'PRESENT');
    await mark('2026-10-07', 'ABSENT');
    await mark('2026-10-09', 'ABSENT');

    const s = app.get(SignalsService);
    expect(await s.absenceStreaks(await tenant(), NOW)).toBe(0); // two: under the threshold of 3
    await mark('2026-10-12', 'ABSENT');
    told.length = 0;
    expect(await s.absenceStreaks(await tenant(), NOW)).toBe(1);
    expect(told).toHaveLength(1);
    expect(told[0].text).toContain('Often Away');
    // A fourth absence is the same run: no second message.
    await mark('2026-10-14', 'ABSENT');
    expect(await s.absenceStreaks(await tenant(), NOW)).toBe(0);

    const list = (await http().get('/api/signals?rule=ABSENCE_STREAK').set(owner).expect(200)).body;
    expect(list.items[0]).toMatchObject({
      subjectName: 'Often Away',
      status: 'OPEN',
      action: 'NOTIFIED_MANAGERS',
      facts: { threshold: 3, absences: 3, since: '2026-10-07', last: '2026-10-12', groups: ['Sig Group'] },
    });
    expect(list.items[0].reason).toContain('3 ta dars');
    // The student is untouched: still active and enrolled.
    expect((await db.select().from(students).where(eq(students.id, kid)))[0].status).toBe('ACTIVE');

    // A manager marks it handled; nothing else changes.
    await http().patch(`/api/signals/${list.items[0].id}`).set(owner).send({ status: 'DONE' }).expect(200);
    await http().patch(`/api/signals/${list.items[0].id}`).set(owner).send({ status: 'DELETE' }).expect(400);

    // Came to class, then away three times again: a new run, a new signal.
    await mark('2026-10-15', 'PRESENT');
    for (const d of ['2026-10-16', '2026-10-17', '2026-10-18']) await mark(d, 'ABSENT');
    expect(await s.absenceStreaks(await tenant(), NOW)).toBe(1);

    // The center turns the rule off.
    await http().patch('/api/notifications/settings').set(owner).send({ absenceStreakAlert: 0 }).expect(200);
    await db.delete(attendance).where(and(eq(attendance.studentId, kid), eq(attendance.date, '2026-10-15')));
    expect(await s.absenceStreaks(await tenant(), NOW)).toBe(0);
    await http().patch('/api/notifications/settings').set(owner).send({ absenceStreakAlert: 25 }).expect(400);
  });

  it('a trial with no contact after it becomes a follow-up task for the manager, once; the lead stage is untouched', async () => {
    const [lead] = await db.insert(leads).values({ tenantId, fullName: 'Trial Silent', phone: `+99896${tail}`, phoneNormalized: `+99896${tail}`, status: 'TRIAL_ATTENDED' }).returning();
    const [trial] = await db.insert(leadTrials).values({ tenantId, leadId: lead.id, scheduledAt: new Date('2026-10-15T10:00:00Z'), status: 'ATTENDED' }).returning();
    const [called] = await db.insert(leads).values({ tenantId, fullName: 'Trial Called', phone: `+99895${tail}`, phoneNormalized: `+99895${tail}`, status: 'TRIAL_ATTENDED' }).returning();
    await db.insert(leadTrials).values({ tenantId, leadId: called.id, scheduledAt: new Date('2026-10-15T10:00:00Z'), status: 'ATTENDED' });
    const [me] = await db.select().from(users).where(eq(users.email, `sig-${suffix}@test.uz`));
    await db.insert(leadActivities).values({ tenantId, leadId: called.id, actorUserId: me.id, type: 'CALL', body: 'Gaplashdik', occurredAt: new Date('2026-10-16T09:00:00Z') });

    const s = app.get(SignalsService);
    expect(await s.trialFollowUps(await tenant(), NOW)).toBe(1); // only the one nobody called
    expect(await s.trialFollowUps(await tenant(), NOW)).toBe(0); // once per trial

    const [after] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(after.status).toBe('TRIAL_ATTENDED');
    expect(after.followUpAt?.getTime()).toBe(NOW.getTime());
    expect(after.followUpNotifiedAt).toBeNull();
    const timeline = await db.select().from(leadActivities).where(eq(leadActivities.leadId, lead.id));
    expect(timeline.find((a) => a.type === 'FOLLOW_UP_SCHEDULED')?.body).toContain('Avtomatik');

    const list = (await http().get('/api/signals?rule=TRIAL_FOLLOW_UP').set(owner).expect(200)).body;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ subjectName: 'Trial Silent', key: trial.id, action: 'FOLLOW_UP_TASK', facts: { days: 2, trialDate: '2026-10-15' } });
  });

  it('runs only in office hours, and never touches money', async () => {
    const s = app.get(SignalsService);
    const night = new Date('2026-10-19T19:00:00Z'); // 00:00 in Tashkent
    expect(await s.run(await tenant(), night)).toEqual({ absences: 0, trials: 0 });
    const [pay] = await db.select().from(payments).where(eq(payments.tenantId, tenantId)).limit(1);
    const [inv] = await db.select().from(invoices).where(eq(invoices.tenantId, tenantId)).limit(1);
    expect(pay).toBeUndefined();
    expect(inv).toBeUndefined();
  });

  it('teachers do not see the signals', async () => {
    await http().post('/api/staff').set(owner).send({ email: `sig-t-${suffix}@test.uz`, fullName: 'Sig Teacher', role: 'TEACHER', password: 'password12345' }).expect(201);
    const t = (await http().post('/api/auth/login').send({ email: `sig-t-${suffix}@test.uz`, password: 'password12345' }).expect(201)).body.accessToken;
    await http().get('/api/signals').set({ Authorization: `Bearer ${t}` }).expect(403);
  });
});
