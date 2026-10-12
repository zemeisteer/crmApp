import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { attendance, users } from '../src/db/schema.js';
import { TelegramService } from '../src/telegram/telegram.service.js';

// Attendance from the Telegram bot, per lesson. Telegram itself is not
// called: updates are handed to the service as the webhook would, and what
// the bot would send is read at its own send/edit/answer methods.
describe('Telegram attendance, per lesson (e2e, no Telegram API)', () => {
  let app: NestExpressApplication;
  let db: Database;
  let bot: TelegramService;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tashkent = (offsetDays: number) => new Date(Date.now() + 5 * 3_600_000 + offsetDays * 86_400_000);
  const today = () => tashkent(0).toISOString().slice(0, 10);
  const dowToday = () => (tashkent(0).getUTCDay() === 0 ? 7 : tashkent(0).getUTCDay());
  const DAYS = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

  type Sent = { chatId: string; text: string; markup?: { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } };
  const sent: Sent[] = [];
  const edited: Sent[] = [];
  const answers: Array<{ id: string; text?: string }> = [];
  let cq = 0;
  const say = async (chat: string, text: string) => { await bot.handleUpdate({ message: { text, chat: { id: Number(chat) } } }); };
  const press = async (chat: string, data: string) => {
    const id = `cq-${++cq}`;
    await bot.handleUpdate({ callback_query: { id, data, message: { chat: { id: Number(chat) }, message_id: 100 + cq } } });
    return answers.find((a) => a.id === id)?.text;
  };
  const buttons = (m: Sent | undefined) => (m?.markup?.inline_keyboard ?? []).flat();
  const lastSent = (chat: string) => [...sent].reverse().find((m) => m.chatId === chat);

  let owner: string, ownerB: string;
  let g: string, am: string, pm: string, s1: string, s2: string;
  const chat = { teacher: `7${String(suffix).slice(-8)}1`, owner: `7${String(suffix).slice(-8)}2`, other: `7${String(suffix).slice(-8)}3`, outsider: `7${String(suffix).slice(-8)}4`, nobody: `7${String(suffix).slice(-8)}5` };
  let tch1: string, tch2: string, teacher2Token: string;
  let seq = 0;
  const marks = async (scheduleId: string) => (await db.select().from(attendance).where(and(eq(attendance.groupId, g), eq(attendance.date, today()), eq(attendance.scheduleId, scheduleId))))
    .map((m) => `${m.studentId === s1 ? 'one' : 'two'} ${m.status}`).sort();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    bot = app.get(TelegramService);
    vi.spyOn(bot, 'sendMessage').mockImplementation(async (chatId: string, text: string, markup?: unknown) => { sent.push({ chatId, text, markup: markup as Sent['markup'] }); return 1; });
    vi.spyOn(bot as unknown as { editMessage: (c: string, m: number, t: string, k?: unknown) => Promise<void> }, 'editMessage')
      .mockImplementation(async (chatId: string, _m: number, text: string, markup?: unknown) => { edited.push({ chatId, text, markup: markup as Sent['markup'] }); });
    vi.spyOn(bot, 'answerCallback').mockImplementation(async (id: string, text?: string) => { answers.push({ id, text }); });

    const register = async (key: string) => (await http().post('/api/auth/register')
      .send({ centerName: `TGA ${key} ${suffix}`, subdomain: `tga-${key}-${suffix}`, email: `tga-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` }).expect(201)).body;
    const a = await register('a');
    owner = a.accessToken;
    const b = await register('b');
    ownerB = b.accessToken;
    const teacherUser = async (local: string) => {
      const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `tga-${local}-${suffix}@test.uz`, role: 'TEACHER' }).expect(201)).body;
      const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `TGA ${local}`, password: 'password12345' }).expect(201)).body;
      const id = (await http().post('/api/teachers').set(bearer(owner)).send({ fullName: `TGA ${local}`, userId: acc.user.id, subject: 'English', salaryType: 'FIXED', salaryValue: 1_000_000 }).expect(201)).body.id as string;
      return { token: acc.accessToken as string, id, userId: acc.user.id as string };
    };
    const t1 = await teacherUser('t1');
    const t2 = await teacherUser('t2');
    tch1 = t1.id; tch2 = t2.id; teacher2Token = t2.token;
    // Chats: the group's teacher, the owner, another teacher of the center, the other center's owner.
    await db.update(users).set({ telegramChatId: chat.teacher }).where(eq(users.id, t1.userId));
    await db.update(users).set({ telegramChatId: chat.owner }).where(eq(users.id, a.user.id));
    await db.update(users).set({ telegramChatId: chat.other }).where(eq(users.id, t2.userId));
    await db.update(users).set({ telegramChatId: chat.outsider }).where(eq(users.id, b.user.id));
    // Two lessons today.
    g = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'TGA Twice', subject: 'English', teacherId: tch1, scheduleDays: DAYS[dowToday()], startTime: '08:00', endTime: '09:00', maxStudents: 30 }).expect(201)).body.id;
    await http().post('/api/schedule').set(bearer(owner)).send({ groupId: g, dayOfWeek: dowToday(), startTime: '18:00', endTime: '19:00' }).expect(201);
    const rows = (await http().get(`/api/schedule?groupId=${g}`).set(bearer(owner)).expect(200)).body as Array<{ id: string; startTime: string }>;
    am = rows.find((r) => r.startTime === '08:00')!.id;
    pm = rows.find((r) => r.startTime === '18:00')!.id;
    const student = async (name: string) => (await http().post('/api/students').set(bearer(owner)).send({ fullName: `TGA ${name}`, phone: `+9983${String(suffix).slice(-6)}${String(++seq).padStart(2, '0')}`, groupIds: [g] }).expect(201)).body.id as string;
    s1 = await student('A One');
    s2 = await student('B Two');
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  it('today\'s lessons are offered one by one, and each sheet saves its own lesson', async () => {
    await say(chat.teacher, 'Bugungi darslarim');
    const list = buttons(lastSent(chat.teacher));
    expect(list.map((b) => b.callback_data).sort()).toEqual([`ag:${g}:${am}`, `ag:${g}:${pm}`].sort());
    expect(list.map((b) => b.text).sort()).toEqual(['📋 Davomat: TGA Twice (08:00)', '📋 Davomat: TGA Twice (18:00)']);
    // Every callback fits Telegram's 64 bytes.
    expect(Math.max(...list.map((b) => Buffer.byteLength(b.callback_data)))).toBeLessThanOrEqual(64);

    // The morning lesson: One is absent.
    await press(chat.teacher, `ag:${g}:${am}`);
    const sheet = lastSent(chat.teacher)!;
    expect(sheet.text).toContain('08:00');
    expect(buttons(sheet).map((b) => b.callback_data)).toEqual([`am:${g}:${am}:0`, `am:${g}:${am}:1`, `as:${g}:${am}`, `ac:${g}:${am}`]);
    expect(Math.max(...buttons(sheet).map((b) => Buffer.byteLength(b.callback_data)))).toBeLessThanOrEqual(64);
    await press(chat.teacher, `am:${g}:${am}:0`);
    expect(await press(chat.teacher, `as:${g}:${am}`)).toBe('Saqlandi ✅');
    expect(await marks(am)).toEqual(['one ABSENT', 'two PRESENT']);
    expect(await marks(pm)).toEqual([]);

    // The evening lesson: Two is late. The morning marks stay as they are.
    await press(chat.teacher, `ag:${g}:${pm}`);
    await press(chat.teacher, `am:${g}:${pm}:1`);
    await press(chat.teacher, `am:${g}:${pm}:1`);
    expect(await press(chat.teacher, `as:${g}:${pm}`)).toBe('Saqlandi ✅');
    expect(await marks(pm)).toEqual(['one PRESENT', 'two LATE']);
    expect(await marks(am)).toEqual(['one ABSENT', 'two PRESENT']);

    // Opened again: the sheet starts from that lesson's saved marks.
    await press(chat.teacher, `ag:${g}:${am}`);
    expect(buttons(lastSent(chat.teacher)).slice(0, 2).map((b) => b.text)).toEqual(['❌ TGA A One', '✅ TGA B Two']);
    await press(chat.teacher, `ac:${g}:${am}`);
  });

  it('a second press, an old button and two people at once do not double or mix anything', async () => {
    await press(chat.teacher, `ag:${g}:${am}`);
    expect(await press(chat.teacher, `as:${g}:${am}`)).toBe('Saqlandi ✅');
    // Pressed again: the sheet is gone.
    expect(await press(chat.teacher, `as:${g}:${am}`)).toContain("Ro'yxat eskirdi");
    expect(await press(chat.teacher, `am:${g}:${am}:0`)).toContain("Ro'yxat eskirdi");
    // Buttons from before lessons were told apart: no lesson named.
    expect(await press(chat.teacher, `ag:${g}`)).toContain('bir nechta dars');
    expect(await press(chat.teacher, `as:${g}`)).toContain("Ro'yxat eskirdi");
    expect(await press(chat.teacher, `ag:${g}:not-a-lesson`)).toContain("jadvalda yo'q");

    // The owner and the teacher open the same lesson and both save: still one row per student.
    await press(chat.teacher, `ag:${g}:${pm}`);
    await press(chat.owner, `ag:${g}:${pm}`);
    await press(chat.owner, `am:${g}:${pm}:0`);
    const both = await Promise.all([press(chat.teacher, `as:${g}:${pm}`), press(chat.owner, `as:${g}:${pm}`)]);
    expect(both).toEqual(['Saqlandi ✅', 'Saqlandi ✅']);
    expect((await marks(pm)).length).toBe(2);
    expect((await db.select().from(attendance).where(and(eq(attendance.groupId, g), eq(attendance.date, today())))).length).toBe(4);
  });

  it('who may mark is checked again at the save; other centers and unknown chats get nothing', async () => {
    // Another teacher of the center, the other center's owner, and a chat nobody linked.
    expect(await press(chat.other, `ag:${g}:${am}`)).toBe('Bu guruh sizga biriktirilmagan');
    expect(await press(chat.outsider, `ag:${g}:${am}`)).toBe('Bu guruh sizga biriktirilmagan');
    expect(await press(chat.nobody, `ag:${g}:${am}`)).toBe("Ruxsat yo'q");

    // The sheet is open; then the group is given to another teacher.
    await press(chat.teacher, `ag:${g}:${am}`);
    await press(chat.teacher, `am:${g}:${am}:1`);
    const before = await marks(am);
    await http().patch(`/api/groups/${g}`).set(bearer(owner)).send({ teacherId: tch2 }).expect(200);
    expect(await press(chat.teacher, `as:${g}:${am}`)).toBe("Saqlab bo'lmadi");
    expect(lastSent(chat.teacher)!.text).toContain('⚠️');
    expect(await marks(am)).toEqual(before);
    // The new teacher has it now - in the bot and on the web alike.
    expect(await press(chat.other, `ag:${g}:${am}`)).toBeUndefined();
    await press(chat.other, `ac:${g}:${am}`);
    await http().post('/api/attendance').set(bearer(teacher2Token)).send({ groupId: g, date: today(), scheduleId: am, entries: [{ studentId: s1, status: 'ABSENT' }] }).expect(201);
    await say(chat.teacher, 'Bugungi darslarim');
    expect(lastSent(chat.teacher)!.text).toContain("Bugun sizda dars yo'q");
    // A single lesson given back to the first teacher: that lesson is theirs again, the other is not.
    await http().patch(`/api/schedule/${pm}`).set(bearer(owner)).send({ teacherId: tch1, allowCollision: true }).expect(200);
    await say(chat.teacher, 'Bugungi darslarim');
    expect(buttons(lastSent(chat.teacher)).map((b) => b.callback_data)).toEqual([`ag:${g}:${pm}`]);
    expect(await press(chat.teacher, `ag:${g}:${am}`)).toBe('Bu guruh sizga biriktirilmagan');
    expect(await press(chat.teacher, `ag:${g}:${pm}`)).toBeUndefined();
    await press(chat.teacher, `ac:${g}:${pm}`);
  });

  it('a lesson called off takes no sheet, and a sheet opened before that saves nothing', async () => {
    await press(chat.owner, `ag:${g}:${pm}`);
    await press(chat.owner, `am:${g}:${pm}:1`);
    const before = await marks(pm);
    await http().post('/api/lessons/cancellations').set(bearer(owner)).send({ groupId: g, date: today(), scheduleId: pm }).expect(201);
    expect(await press(chat.owner, `as:${g}:${pm}`)).toBe("Saqlab bo'lmadi");
    expect(lastSent(chat.owner)!.text).toContain('bekor qilingan');
    expect(await marks(pm)).toEqual(before);
    expect(await press(chat.owner, `ag:${g}:${pm}`)).toContain('bekor qilingan');
    // It is not in today's list either.
    await say(chat.other, 'Bugungi darslarim');
    expect(buttons(lastSent(chat.other)).map((b) => b.callback_data)).toEqual([`ag:${g}:${am}`]);
    void ownerB;
  });
});
