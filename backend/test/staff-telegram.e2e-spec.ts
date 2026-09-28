import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, desc, eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { telegramLinkTokens, users } from '../src/db/schema.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { TelegramController } from '../src/telegram/telegram.controller.js';

// Staff member links their own Telegram for CRM reminders through a
// one-time bot deep link. Telegram itself is simulated by posting updates
// to the webhook (no bot token in tests, so replies are not sent).
describe('Staff Telegram linking (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  let owner: string;
  let ownerId: string;
  let student: string;
  const chatId = String(900_000_000 + (suffix % 100_000_000));

  const latestToken = async () =>
    (await db.select({ token: telegramLinkTokens.token }).from(telegramLinkTokens)
      .where(and(eq(telegramLinkTokens.userId, ownerId))).orderBy(desc(telegramLinkTokens.createdAt)).limit(1))[0].token;
  // The webhook answers at once and handles the update after; wait for it.
  const settle = () => app.get(TelegramController).idle();
  const botStart = async (payload: string) => {
    await http().post('/api/telegram/webhook').send({ update_id: 1, message: { text: `/start ${payload}`, chat: { id: Number(chatId) } } }).expect(201);
    await settle();
  };
  const chatOf = async (id: string) => (await db.select({ c: users.telegramChatId }).from(users).where(eq(users.id, id)))[0].c;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const reg = await http().post('/api/auth/register')
      .send({ centerName: `Tg ${suffix}`, subdomain: `tg-${suffix}`, email: `tg-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201);
    owner = reg.body.accessToken;
    ownerId = reg.body.user.id;
    const inv = await http().post('/api/invitations').set('Authorization', `Bearer ${owner}`).send({ email: `tgs-${suffix}@test.uz`, role: 'STUDENT' }).expect(201);
    student = (await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: 'S', password: 'password12345' }).expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('links a staff chat through a one-time token, then unlinks', async () => {
    const me = await http().get('/api/telegram/me').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(me.body.linked).toBe(false);

    await http().post('/api/telegram/me/link').set('Authorization', `Bearer ${owner}`).expect(201);
    const token = await latestToken();
    await botStart(`staff_${token}`);
    expect(await chatOf(ownerId)).toBe(chatId);
    expect((await http().get('/api/telegram/me').set('Authorization', `Bearer ${owner}`).expect(200)).body.linked).toBe(true);

    // The token is single-use.
    await http().delete('/api/telegram/me').set('Authorization', `Bearer ${owner}`).expect(200);
    await botStart(`staff_${token}`);
    expect(await chatOf(ownerId)).toBeNull();
  });

  it('answers a linked owner with center numbers and staff buttons', async () => {
    await http().post('/api/telegram/me/link').set('Authorization', `Bearer ${owner}`).expect(201);
    await botStart(`staff_${await latestToken()}`);
    const tg = app.get(TelegramService);
    const sent: Array<{ text: string; kb?: { keyboard: Array<Array<{ text: string }>> } }> = [];
    const original = tg.sendMessage.bind(tg);
    tg.sendMessage = (async (_c: string, text: string, kb?: any) => { sent.push({ text, kb }); }) as typeof tg.sendMessage;
    try {
      for (const text of ['/start', '📊 Bugungi holat', '🆕 Yangi arizalar', '📞 Qayta aloqa', '🎓 Sinov darslari']) {
        await http().post('/api/telegram/webhook').send({ update_id: 2, message: { text, chat: { id: Number(chatId) } } }).expect(201);
        await settle();
      }
    } finally {
      tg.sendMessage = original;
    }
    expect(sent).toHaveLength(5);
    for (const m of sent) expect(m.kb?.keyboard.flat().map((b) => b.text)).toContain('📊 Bugungi holat');
    expect(sent[1].text).toContain('Yangi arizalar');
    await http().delete('/api/telegram/me').set('Authorization', `Bearer ${owner}`).expect(200);
  });

  it('ignores unknown or forged tokens', async () => {
    await botStart('staff_0123456789abcdef0123456789abcdef');
    expect(await chatOf(ownerId)).toBeNull();
  });

  it('keeps the endpoints staff-only', async () => {
    await http().get('/api/telegram/me').set('Authorization', `Bearer ${student}`).expect(403);
    await http().post('/api/telegram/me/link').set('Authorization', `Bearer ${student}`).expect(403);
  });

  it('checks the webhook secret when one is configured', () => {
    const tg = app.get(TelegramService) as unknown as { config: { get: (k: string) => string | undefined } };
    const original = tg.config.get.bind(tg.config);
    tg.config.get = (k: string) => (k === 'TELEGRAM_WEBHOOK_SECRET' ? 's3cret-value' : original(k));
    const svc = app.get(TelegramService);
    expect(svc.isValidWebhookSecret('s3cret-value')).toBe(true);
    expect(svc.isValidWebhookSecret('wrong')).toBe(false);
    expect(svc.isValidWebhookSecret(undefined)).toBe(false);
    tg.config.get = original;
    expect(svc.isValidWebhookSecret(undefined)).toBe(true);
  });
});
