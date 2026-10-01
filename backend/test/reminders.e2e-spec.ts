import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq, inArray } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { enrollments, groupPriceHistory, students, tenants, users } from '../src/db/schema.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { RemindersService } from '../src/reminders/reminders.service.js';

// Automatic reminders at a fixed moment: Monday 28 Sep 2026, 10:00 in
// Tashkent (05:00 UTC). A group meets on Mondays at 11:30.
describe('Automatic reminders (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  let tenantId: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  const MON_10 = new Date('2026-09-28T05:00:00Z');
  const sent: Array<{ channel: string; event?: string; recipient: string; content: string }> = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const n = app.get(NotificationsService);
    n.send = (async (_t: string, dto: { channel: string; event?: string; recipient: string; content: string }) => {
      sent.push(dto);
      return {} as never;
    }) as typeof n.send;
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Remind ${suffix}`, subdomain: `remind-${suffix}`, email: `remind-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.tenant?.id ?? reg.user.tenantId;
  });

  afterAll(async () => {
    await app?.close();
  });

  const tenantRow = async () => (await db.select().from(tenants).where(eq(tenants.id, tenantId)))[0];

  it('reminds students and the teacher before a lesson, once', async () => {
    const tid = (await http().post('/api/teachers').set(auth()).send({ fullName: 'Rem Teacher', subject: 'Math' }).expect(201)).body.id as string;
    const acc = (await http().post(`/api/teachers/${tid}/account`).set(auth()).send({ email: `rt-${suffix}@test.uz`, password: 'secret123' }).expect(201)).body;
    await db.update(users).set({ telegramChatId: `7${String(suffix).slice(-8)}` }).where(eq(users.id, acc.user.id));
    const g = (await http().post('/api/groups').set(auth()).send({ name: 'Monday Math', subject: 'Math', teacherId: tid, scheduleDays: 'Dushanba', startTime: '11:30', endTime: '13:00' }).expect(201)).body.id as string;
    const late = (await http().post('/api/groups').set(auth()).send({ name: 'Evening', subject: 'Math', scheduleDays: 'Dushanba', startTime: '18:00', endTime: '19:00' }).expect(201)).body.id as string;
    const kid = (await http().post('/api/students').set(auth()).send({ fullName: 'Remind Kid', groupIds: [g, late] }).expect(201)).body.id as string;
    await db.update(students).set({ telegramChatId: `8${String(suffix).slice(-8)}` }).where(eq(students.id, kid));

    const r = app.get(RemindersService);
    sent.length = 0;
    expect(await r.lessonReminders(await tenantRow(), MON_10)).toBe(2); // student + teacher; 18:00 is too far
    expect(sent.map((s) => s.content).join('\n')).toContain('11:30');
    expect(sent.some((s) => s.content.includes('Evening'))).toBe(false);
    expect(await r.lessonReminders(await tenantRow(), MON_10)).toBe(0); // once

    // Night: nothing. Turned off: nothing.
    expect(await r.lessonReminders(await tenantRow(), new Date('2026-09-28T01:00:00Z'))).toBe(0);
    await http().patch('/api/notifications/settings').set(auth()).send({ remindLessons: false }).expect(200);
    expect(await r.lessonReminders(await tenantRow(), new Date('2026-09-28T12:00:00Z'))).toBe(0);
  });

  it('reminds debtors from the reminder day, once a month, never leavers', async () => {
    const g = (await http().post('/api/groups').set(auth()).send({ name: 'Paid Group', subject: 'Math', monthlyPrice: 300_000 }).expect(201)).body.id as string;
    const debtor = (await http().post('/api/students').set(auth()).send({ fullName: 'Owes Money', groupIds: [g] }).expect(201)).body.id as string;
    const gone = (await http().post('/api/students').set(auth()).send({ fullName: 'Already Left', groupIds: [g] }).expect(201)).body.id as string;
    await http().patch(`/api/students/${gone}`).set(auth()).send({ status: 'LEFT', leftReason: 'MOVED' }).expect(200);
    await db.update(students).set({ telegramChatId: `9${String(suffix).slice(-8)}` }).where(eq(students.id, debtor));
    // The clock below is set to September 2026: they were already studying then.
    await db.update(enrollments).set({ joinedAt: new Date('2026-08-01T05:00:00Z') }).where(inArray(enrollments.studentId, [debtor, gone]));
    // ...and the group already cost this much then (a price on record).
    await db.update(groupPriceHistory).set({ effectiveFrom: new Date('2026-08-01T05:00:00Z') }).where(eq(groupPriceHistory.groupId, g));

    const r = app.get(RemindersService);
    await http().patch('/api/notifications/settings').set(auth()).send({ remindPaymentDay: 5 }).expect(200);
    sent.length = 0;
    expect(await r.paymentReminders(await tenantRow(), new Date('2026-09-03T05:00:00Z'))).toBe(0); // before the 5th
    const n = await r.paymentReminders(await tenantRow(), MON_10);
    const payment = sent.filter((s) => s.event === 'PAYMENT_DUE');
    expect(payment.map((s) => s.content).join('\n')).toContain('Owes Money');
    expect(payment.some((s) => s.content.includes('Already Left'))).toBe(false);
    expect(payment.every((s) => s.channel === 'TELEGRAM')).toBe(true); // no SMS token in tests
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await r.paymentReminders(await tenantRow(), MON_10)).toBe(0); // once a month

    await http().patch('/api/notifications/settings').set(auth()).send({ remindPaymentDay: 40 }).expect(400);
  });

  it("sends owners the evening summary once at 20:00, and on demand", async () => {
    const tg = app.get(TelegramService);
    const tgSent: Array<{ chat: string; text: string }> = [];
    tg.sendMessage = (async (chat: string, text: string) => { tgSent.push({ chat, text }); }) as typeof tg.sendMessage;
    const ownerChat = `6${String(suffix).slice(-8)}`;
    const me = (await http().get('/api/auth/me').set(auth()).expect(200)).body;
    await db.update(users).set({ telegramChatId: ownerChat }).where(eq(users.id, me.id ?? me.user?.id));

    const r = app.get(RemindersService);
    expect(await r.dailyDigests(await tenantRow(), MON_10)).toBe(0); // not 20:00 yet
    const MON_20 = new Date('2026-09-28T15:10:00Z'); // 20:10 Tashkent
    expect(await r.dailyDigests(await tenantRow(), MON_20)).toBe(1);
    const digest = tgSent.at(-1)!;
    expect(digest.chat).toBe(ownerChat);
    expect(digest.text).toContain('Kun yakuni');
    expect(digest.text).toContain('Qarzdorlar');
    expect(digest.text).toContain('Monday Math'); // today's lesson without attendance
    expect(await r.dailyDigests(await tenantRow(), MON_20)).toBe(0); // once a day

    // The staff menu button shows it any time.
    await http().post('/api/telegram/webhook').send({ update_id: 3, message: { text: '📈 Kun yakuni', chat: { id: Number(ownerChat) } } }).expect(201);
    const { TelegramController } = await import('../src/telegram/telegram.controller.js');
    await app.get(TelegramController).idle();
    expect(tgSent.at(-1)!.text).toContain('Kun yakuni');

    await http().patch('/api/notifications/settings').set(auth()).send({ dailyDigest: false }).expect(200);
    expect(await r.dailyDigests(await tenantRow(), new Date('2026-09-29T15:10:00Z'))).toBe(0);
  });
});
