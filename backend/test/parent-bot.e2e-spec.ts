import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { students, telegramParentChats } from '../src/db/schema.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { TelegramController } from '../src/telegram/telegram.controller.js';

// Parents in the Telegram bot: their own link per child (the child keeps
// theirs), switching between children, and notices reaching them.
describe('Parents in the Telegram bot (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  const parentChat = String(600_000_000 + (suffix % 100_000_000));
  const sent: Array<{ chat: string; text: string; kb?: { keyboard: Array<Array<{ text: string }>> } }> = [];

  const say = async (text: string, chat = parentChat) => {
    await http().post('/api/telegram/webhook').send({ update_id: 1, message: { text, chat: { id: Number(chat) } } }).expect(201);
    await app.get(TelegramController).idle();
    return sent.at(-1)!;
  };
  const token = async (studentId: string, purpose: 'PARENT' | 'STUDENT') =>
    (await http().post('/api/telegram/link-token').set(auth()).send({ studentId, purpose }).expect(201)).body.token as string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const tg = app.get(TelegramService);
    tg.sendMessage = (async (chat: string, text: string, kb?: any) => {
      sent.push({ chat, text, kb });
    }) as typeof tg.sendMessage;
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `PBot ${suffix}`, subdomain: `pbot-${suffix}`, email: `pbot-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('links a parent to two children, switches between them, keeps the child link', async () => {
    const g = (await http().post('/api/groups').set(auth()).send({ name: 'Bot G', subject: 'Math', scheduleDays: 'Dushanba', startTime: '15:00' }).expect(201)).body.id as string;
    const anvar = (await http().post('/api/students').set(auth()).send({ fullName: 'Anvar Botov', groupIds: [g] }).expect(201)).body.id as string;
    const laylo = (await http().post('/api/students').set(auth()).send({ fullName: 'Laylo Botova' }).expect(201)).body.id as string;
    const childChat = String(700_000_000 + (suffix % 100_000_000));
    await db.update(students).set({ telegramChatId: childChat }).where(eq(students.id, anvar));

    // A student token cannot make a parent link, and a parent token cannot
    // take over the student's own link.
    await say(`/start parent_${await token(anvar, 'STUDENT')}`);
    expect(sent.at(-1)!.text).toContain("noto'g'ri");
    await say(`/start link_${await token(anvar, 'PARENT')}`);
    expect((await db.select().from(students).where(eq(students.id, anvar)))[0].telegramChatId).toBe(childChat);

    let r = await say(`/start parent_${await token(anvar, 'PARENT')}`);
    expect(r.text).toContain('Anvar Botov');
    expect(r.kb?.keyboard.flat().map((b) => b.text)).toContain('👨‍👩‍👧 Farzandlarim');
    await say(`/start parent_${await token(laylo, 'PARENT')}`);
    const links = await db.select().from(telegramParentChats).where(eq(telegramParentChats.chatId, parentChat));
    expect(links).toHaveLength(2);
    // The child's own chat is untouched.
    expect((await db.select().from(students).where(eq(students.id, anvar)))[0].telegramChatId).toBe(childChat);

    r = await say('👨‍👩‍👧 Farzandlarim');
    expect(r.kb?.keyboard.flat().map((b) => b.text)).toEqual(expect.arrayContaining(['👤 Anvar Botov', '👤 Laylo Botova']));
    r = await say('👤 Anvar Botov');
    expect(r.text).toContain('Anvar Botov');
    r = await say('📅 Dars jadvali');
    expect(r.text).toContain('Anvar Botov');
    expect(r.text).toContain('Bot G');
    expect(r.kb?.keyboard.flat().map((b) => b.text)).not.toContain('🤖 AI ustoz'); // parents: no AI tutor

    // Notices to the child reach the parent too.
    sent.length = 0;
    await app.get(TelegramService).notifyStudent(anvar, 'Test xabar');
    expect(sent.map((m) => m.chat).sort()).toEqual([childChat, parentChat].sort());
  });
});
