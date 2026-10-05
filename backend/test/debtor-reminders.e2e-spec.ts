import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { debtorReminders, students } from '../src/db/schema.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';

// Debtor reminders: a preview that sends nothing, then at most one reminder
// per student, month and center day - however many times (or by however many
// staff at once) the button is pressed.
describe('Debtor reminders (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  const tokens: Record<string, string> = {};
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  let tenantId: string;
  let sent: Array<{ channel: string; studentId?: string; content: string }>;
  let sendSpy: { mockRestore: () => void };
  let tgSpy: { mockRestore: () => void };
  const ids: Record<string, string> = {};

  type Row = { studentId: string; telegram: boolean; sms: boolean; remindedToday: boolean; debt: number };
  const preview = async () => (await http().get('/api/notifications/debtor-reminders/preview').set(as('OWNER')).expect(200)).body;
  const remind = async (role = 'OWNER', body: Record<string, unknown> = {}) =>
    (await http().post('/api/notifications/debtor-reminders').set(as(role)).send(body).expect(201)).body;
  const mine = (rows: Row[]) => rows.filter((r) => Object.values(ids).includes(r.studentId));

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Remind ${suffix}`, subdomain: `remind-${suffix}`, email: `remind-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body;
    tokens.OWNER = reg.accessToken;
    tenantId = reg.tenant.id;
    for (const role of ['ACCOUNTANT', 'MANAGER', 'TEACHER']) {
      const inv = await http().post('/api/invitations').set(as('OWNER')).send({ email: `remind-${role.toLowerCase()}-${suffix}@test.uz`, role }).expect(201);
      tokens[role] = (await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: `${role} user`, password: 'password12345' }).expect(201)).body.accessToken;
    }

    const g = (await http().post('/api/groups').set(as('OWNER')).send({ name: 'Remind G', subject: 'Math', monthlyPrice: 500_000 }).expect(201)).body.id as string;
    const add = async (name: string, extra: Record<string, unknown>) =>
      (await http().post('/api/students').set(as('OWNER')).send({ fullName: name, groupIds: [g], ...extra }).expect(201)).body.id as string;
    ids.phone = await add('Phone Kid', { parentPhone: '+998901112233' });
    ids.tg = await add('Telegram Kid', {});
    ids.none = await add('Silent Kid', {});
    ids.paid = await add('Paid Kid', { phone: '+998901112244' });
    await db.update(students).set({ telegramChatId: '777000' }).where(eq(students.id, ids.tg));
    const p = await preview();
    const due = p.debtors.find((d: Row) => d.studentId === ids.paid).debt as number;
    await http().post('/api/payments').set(as('OWNER')).send({ studentId: ids.paid, amount: due, forMonth: p.forMonth, method: 'CASH' }).expect(201);

    // Nothing leaves the machine: record what would be sent.
    const notifications = app.get(NotificationsService);
    sent = [];
    sendSpy = vi.spyOn(notifications, 'send').mockImplementation(async (_t: string, dto: any) => {
      sent.push(dto);
      return {} as any;
    });
    tgSpy = vi.spyOn(app.get(TelegramService), 'isConfigured', 'get').mockReturnValue(true);
  });

  afterAll(async () => {
    sendSpy?.mockRestore();
    tgSpy?.mockRestore();
    await app?.close();
  });

  it('the preview lists the debtors and how each can be reached, and sends nothing', async () => {
    const p = await preview();
    expect(p.channels).toEqual({ sms: true, telegram: true });
    const rows = mine(p.debtors);
    const by = (id: string) => rows.find((r) => r.studentId === id);
    expect(by(ids.paid)).toBeUndefined();
    expect(by(ids.phone)).toMatchObject({ sms: true, telegram: false, remindedToday: false });
    expect(by(ids.tg)).toMatchObject({ sms: false, telegram: true, remindedToday: false });
    expect(by(ids.none)).toMatchObject({ sms: false, telegram: false });
    expect(p.totals).toMatchObject({ debtors: 3, reachable: 2, remindedToday: 0, unreachable: 1 });
    expect(sent).toHaveLength(0);
    expect(await db.select().from(debtorReminders).where(eq(debtorReminders.tenantId, tenantId))).toHaveLength(0);
  });

  it('a bad month is refused', async () => {
    await http().get('/api/notifications/debtor-reminders/preview?forMonth=2026-13').set(as('OWNER')).expect(400);
  });

  it('only the office roles that handle money may preview or send', async () => {
    for (const role of ['MANAGER', 'TEACHER']) {
      await http().get('/api/notifications/debtor-reminders/preview').set(as(role)).expect(403);
      await http().post('/api/notifications/debtor-reminders').set(as(role)).send({}).expect(403);
    }
    expect(sent).toHaveLength(0);
  });

  it('sending reminds each reachable debtor once, signed with the center name', async () => {
    const res = await remind('ACCOUNTANT', { studentIds: [ids.phone] });
    expect(res).toMatchObject({ sent: 1, alreadyToday: 0, unreachable: 0, processedDebtors: 1 });
    expect(sent).toEqual([expect.objectContaining({ channel: 'SMS', studentId: ids.phone, recipient: '+998901112233' })]);
    expect(sent[0].content).toContain(`Remind ${suffix}`);
    expect(sent[0].content).not.toContain('TalimCRM');

    const all = await remind();
    expect(all).toMatchObject({ sent: 1, alreadyToday: 1, unreachable: 1 });
    expect(sent.map((s) => [s.channel, s.studentId])).toEqual([['SMS', ids.phone], ['TELEGRAM', ids.tg]]);

    const p = await preview();
    expect(p.totals).toMatchObject({ debtors: 3, reachable: 0, remindedToday: 2, unreachable: 1 });
    const [row] = await db.select().from(debtorReminders).where(and(eq(debtorReminders.tenantId, tenantId), eq(debtorReminders.studentId, ids.tg)));
    expect(row).toMatchObject({ forMonth: p.forMonth, day: p.day, channels: 'TELEGRAM' });
  });

  it('pressing again the same day, even twice at once, sends nothing more', async () => {
    const before = sent.length;
    const [a, b] = await Promise.all([remind(), remind('ACCOUNTANT')]);
    expect(a.sent + b.sent).toBe(0);
    expect(a.alreadyToday).toBe(2);
    expect(sent).toHaveLength(before);
  });

  it('two staff at once for a new debtor: one reminder', async () => {
    const g = (await http().post('/api/groups').set(as('OWNER')).send({ name: 'Remind G2', subject: 'Art', monthlyPrice: 300_000 }).expect(201)).body.id as string;
    ids.late = (await http().post('/api/students').set(as('OWNER')).send({ fullName: 'Late Kid', groupIds: [g], phone: '+998901112255' }).expect(201)).body.id as string;
    const before = sent.length;
    const results = await Promise.all([remind('OWNER', { studentIds: [ids.late] }), remind('ACCOUNTANT', { studentIds: [ids.late] }), remind('OWNER', { studentIds: [ids.late] })]);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.alreadyToday, 0)).toBe(2);
    expect(sent.slice(before)).toEqual([expect.objectContaining({ channel: 'SMS', studentId: ids.late })]);
    expect(await db.select().from(debtorReminders).where(eq(debtorReminders.studentId, ids.late))).toHaveLength(1);
  });

  it('without a Telegram bot the Telegram-only debtor is unreachable, not "sent"', async () => {
    tgSpy.mockRestore();
    tgSpy = vi.spyOn(app.get(TelegramService), 'isConfigured', 'get').mockReturnValue(false);
    const p = await preview();
    expect(p.channels.telegram).toBe(false);
    expect(mine(p.debtors).find((r) => r.studentId === ids.tg)).toMatchObject({ telegram: false, sms: false });
  });
});
