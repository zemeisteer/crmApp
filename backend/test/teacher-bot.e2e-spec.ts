import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { attendance, homeworkCompletions, users } from '../src/db/schema.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { TelegramController } from '../src/telegram/telegram.controller.js';

// A teacher takes attendance in the Telegram bot: today's lesson -> sheet
// with everyone present -> tap to change -> Save (only then it is stored).
describe('Attendance from the Telegram bot (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  const teacherChat = String(500_000_000 + (suffix % 100_000_000));
  const otherChat = String(400_000_000 + (suffix % 100_000_000));
  type Kb = { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>; keyboard?: unknown };
  const sent: Array<{ chat: string; text: string; kb?: Kb }> = [];
  const edits: Array<{ chat: string; text: string; kb?: Kb }> = [];
  const answers: string[] = [];

  const hook = async (update: object) => {
    await http().post('/api/telegram/webhook').send({ update_id: 1, ...update }).expect(201);
    await app.get(TelegramController).idle();
  };
  const tap = (data: string, chat = teacherChat) => hook({ callback_query: { id: `cb${Math.random()}`, data, message: { message_id: 42, chat: { id: Number(chat) } } } });
  // Today's weekday in the center's time zone, as the groups page writes it.
  const today = () => {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tashkent', weekday: 'short' }).format(new Date());
    return { Mon: 'Dushanba', Tue: 'Seshanba', Wed: 'Chorshanba', Thu: 'Payshanba', Fri: 'Juma', Sat: 'Shanba', Sun: 'Yakshanba' }[wd]!;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const tg = app.get(TelegramService);
    tg.sendMessage = (async (chat: string, text: string, kb?: Kb) => { sent.push({ chat, text, kb }); }) as typeof tg.sendMessage;
    tg.editMessage = (async (chat: string, _m: number, text: string, kb?: Kb) => { edits.push({ chat, text, kb }); return true; }) as typeof tg.editMessage;
    tg.answerCallback = (async (_id: string, text?: string) => { answers.push(text ?? ''); }) as typeof tg.answerCallback;
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `TBot ${suffix}`, subdomain: `tbot-${suffix}`, email: `tbot-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('opens today\'s lesson, marks, and stores only on save', async () => {
    const tid = (await http().post('/api/teachers').set(auth()).send({ fullName: 'Bot Teacher', subject: 'Math' }).expect(201)).body.id as string;
    const acc = (await http().post(`/api/teachers/${tid}/account`).set(auth()).send({ email: `tb-${suffix}@test.uz`, password: 'secret123' }).expect(201)).body;
    await db.update(users).set({ telegramChatId: teacherChat }).where(eq(users.id, acc.user.id));
    const g = (await http().post('/api/groups').set(auth()).send({ name: 'Bot Lesson', subject: 'Math', teacherId: tid, scheduleDays: today(), startTime: '23:50', endTime: '23:59' }).expect(201)).body.id as string;
    const other = (await http().post('/api/groups').set(auth()).send({ name: 'Not Mine', subject: 'Math', scheduleDays: today(), startTime: '10:00' }).expect(201)).body.id as string;
    for (const name of ['Ali Botiy', 'Vali Botiy']) await http().post('/api/students').set(auth()).send({ fullName: name, groupIds: [g] }).expect(201);

    await hook({ message: { text: '📅 Bugungi darslarim', chat: { id: Number(teacherChat) } } });
    const lessons = sent.at(-1)!;
    expect(lessons.kb?.inline_keyboard?.flat().map((b) => b.callback_data)).toEqual([`ag:${g}`]);

    await tap(`ag:${g}`);
    const sheet = sent.at(-1)!;
    expect(sheet.text).toContain('✅ 2');
    expect(sheet.kb?.inline_keyboard?.map((r) => r[0].text).slice(0, 2)).toEqual(['✅ Ali Botiy', '✅ Vali Botiy']);

    await tap(`am:${g}:1`); // Vali -> absent
    expect(edits.at(-1)!.kb?.inline_keyboard?.[1][0].text).toBe('❌ Vali Botiy');
    const count = async () => (await db.select().from(attendance).where(eq(attendance.groupId, g))).length;
    expect(await count()).toBe(0); // nothing stored before Save

    await tap(`as:${g}`);
    expect(edits.at(-1)!.text).toContain('saqlandi');
    const rows = await db.select({ status: attendance.status }).from(attendance).where(and(eq(attendance.groupId, g)));
    expect(rows.map((r) => r.status).sort()).toEqual(['ABSENT', 'PRESENT']);

    // The sheet is closed; another group is refused; strangers get nothing.
    await tap(`am:${g}:0`);
    expect(answers.at(-1)).toContain('eskirdi');
    await tap(`ag:${other}`);
    expect(answers.at(-1)).toContain('biriktirilmagan');
    await tap(`ag:${g}`, otherChat);
    expect(answers.at(-1)).toContain("Ruxsat yo'q");
  });

  it('reviews submitted homework with quick grades, and shows salary', async () => {
    const tid = (await http().post('/api/teachers').set(auth()).send({ fullName: 'HW Teacher', subject: 'English' }).expect(201)).body.id as string;
    const acc = (await http().post(`/api/teachers/${tid}/account`).set(auth()).send({ email: `hwt-${suffix}@test.uz`, password: 'secret123' }).expect(201)).body;
    const hwChat = String(300_000_000 + (suffix % 100_000_000));
    await db.update(users).set({ telegramChatId: hwChat }).where(eq(users.id, acc.user.id));
    const g = (await http().post('/api/groups').set(auth()).send({ name: 'HW Group', subject: 'English', teacherId: tid }).expect(201)).body.id as string;
    const foreign = (await http().post('/api/groups').set(auth()).send({ name: 'Foreign', subject: 'English' }).expect(201)).body.id as string;
    const kid = (await http().post('/api/students').set(auth()).send({ fullName: 'Hw Kid', groupIds: [g] }).expect(201)).body.id as string;
    const kid2 = (await http().post('/api/students').set(auth()).send({ fullName: 'Hw Kid Two', groupIds: [g] }).expect(201)).body.id as string;
    const hw = (await http().post('/api/homework').set(auth()).send({ groupIds: [g], title: 'Essay 1', maxScore: 10 }).expect(201)).body;
    const hwId = (Array.isArray(hw) ? hw[0] : hw).id as string;
    await http().post(`/api/homework/${hwId}/submit`).set(auth()).send({ studentId: kid, submissionText: 'My city is Tashkent.' }).expect(201);
    await http().post(`/api/homework/${hwId}/submit`).set(auth()).send({ studentId: kid2, submissionText: 'Second essay' }).expect(201);

    await hook({ message: { text: '📝 Vazifalar', chat: { id: Number(hwChat) } } });
    expect(sent.at(-1)!.text).toContain('Essay 1');
    expect(sent.at(-1)!.kb?.inline_keyboard?.flat().map((b) => b.callback_data)).toEqual([`hw:${hwId}`]);

    await tap(`hw:${hwId}`, hwChat);
    const card = sent.at(-1)!;
    expect(card.text).toContain('Hw Kid');
    expect(card.text).toContain('My city is Tashkent.');
    expect(card.kb?.inline_keyboard?.[0].map((b) => b.text)).toEqual(['10', '8', '6', '4', '0']);

    await tap(`hg:${hwId}:${kid}:8`, hwChat);
    const [row] = await db.select().from(homeworkCompletions).where(and(eq(homeworkCompletions.homeworkId, hwId), eq(homeworkCompletions.studentId, kid)));
    expect(row).toMatchObject({ status: 'GRADED', score: 8 });
    expect(edits.at(-1)!.text).toContain('Hw Kid Two'); // next one
    await tap(`hk:${hwId}:${kid2}`, hwChat); // skip it
    expect(edits.at(-1)!.text).toContain("o'tkazib yuborilgan");

    // A grade above the maximum, and another teacher's homework, are refused.
    const teacherToken = (await http().post('/api/auth/login').send({ email: `hwt-${suffix}@test.uz`, password: 'secret123' }).expect(201)).body.accessToken;
    await http().post(`/api/homework/${hwId}/grade`).set({ Authorization: `Bearer ${teacherToken}` }).send({ studentId: kid2, score: 11 }).expect(400);
    const fhw = (await http().post('/api/homework').set(auth()).send({ groupIds: [foreign], title: 'Not yours' }).expect(201)).body;
    const fId = (Array.isArray(fhw) ? fhw[0] : fhw).id as string;
    await http().post(`/api/homework/${fId}/grade`).set({ Authorization: `Bearer ${teacherToken}` }).send({ studentId: kid, score: 5 }).expect(403);
    await tap(`hw:${fId}`, hwChat);
    expect(answers.at(-1)).toContain('biriktirilmagan');

    await hook({ message: { text: '💰 Maoshim', chat: { id: Number(hwChat) } } });
    expect(sent.at(-1)!.text).toMatch(/Maoshingiz|Maosh/);
  });
});
