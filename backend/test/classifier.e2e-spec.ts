import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { createServer, type Server } from 'http';
import { AddressInfo } from 'net';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { messageClassifications, students } from '../src/db/schema.js';
import { ClassifierService } from '../src/classifier/classifier.service.js';
import { StrandsClassifier } from '../src/classifier/strands.classifier.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import type { MessageClassifier } from '../src/classifier/classifier.types.js';

// Suggest-only classification: whatever the model does - answers, hesitates,
// is down, is slow, answers nonsense, or the center's hour is used up - the
// bot answers as before and the message is logged; a person's label is
// compared with the model's suggestion. One center never sees another's.
describe('Message classification, shadow mode (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let svc: ClassifierService;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  const centers: Array<{ token: Record<string, string>; tenantId: string }> = [];
  const fixed = (choice: string, probability: number): MessageClassifier => ({
    provider: 'test',
    modelVersion: 'test-1',
    classify: async () => ({ choice, probability }),
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    svc = app.get(ClassifierService);
    for (const k of ['a', 'b']) {
      const reg = (await http().post('/api/auth/register')
        .send({ centerName: `Cls ${k} ${suffix}`, subdomain: `cls-${k}-${suffix}`, email: `cls-${k}-${suffix}@test.uz`, password: 'password123', fullName: `Cls ${k}` })
        .expect(201)).body;
      centers.push({ token: { Authorization: `Bearer ${reg.accessToken}` }, tenantId: reg.tenant?.id ?? reg.user.tenantId });
    }
  });

  afterAll(async () => {
    svc.use(undefined);
    await app?.close();
  });

  const rows = (tenantId: string) => db.select().from(messageClassifications).where(eq(messageClassifications.tenantId, tenantId));

  it('is off by default: nothing is called or stored', async () => {
    svc.use(undefined);
    expect(await svc.shadow(centers[0].tenantId, "To'lov qancha?", 'test')).toBeNull();
    expect(await rows(centers[0].tenantId)).toHaveLength(0);
  });

  it('a confident answer is a suggestion; a hesitant one needs a person', async () => {
    svc.use(fixed('payment', 0.92));
    expect(await svc.shadow(centers[0].tenantId, "Qarzim qancha qoldi?", 'test')).toMatchObject({ status: 'SUGGESTED', chosen: 'payment', probability: expect.closeTo(0.92, 3), modelVersion: 'test-1' });
    svc.use(fixed('price', 0.4));
    expect(await svc.shadow(centers[0].tenantId, 'Сколько стоит курс?', 'test')).toMatchObject({ status: 'NEEDS_HUMAN', chosen: 'price', error: 'LOW_CONFIDENCE' });
  });

  it('a service that is down, slow or answers nonsense never blocks: it needs a person', async () => {
    // Down: nothing listens there.
    svc.use(new StrandsClassifier('http://127.0.0.1:1', 'pinned-model'));
    expect(await svc.shadow(centers[0].tenantId, 'Dars soat nechida?', 'test')).toMatchObject({ status: 'NEEDS_HUMAN', error: expect.stringContaining('UNAVAILABLE') });

    // A reply in a shape the client does not know (here a yes/no answer).
    const odd: Server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'x', answers: { topic: { type: 'noul', noul: 0.8 } } }));
    });
    await new Promise<void>((r) => odd.listen(0, '127.0.0.1', r));
    svc.use(new StrandsClassifier(`http://127.0.0.1:${(odd.address() as AddressInfo).port}`, 'pinned-model'));
    expect(await svc.shadow(centers[0].tenantId, 'Rahmat', 'test')).toMatchObject({ status: 'NEEDS_HUMAN', error: 'UNREADABLE_ANSWER', modelVersion: 'pinned-model' });
    odd.close();

    // Slower than the timeout.
    process.env.CLASSIFIER_TIMEOUT_MS = '200';
    svc.use({ provider: 'test', modelVersion: 'slow', classify: (_i, signal) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
    const started = Date.now();
    expect(await svc.shadow(centers[0].tenantId, 'Salom', 'test')).toMatchObject({ status: 'NEEDS_HUMAN', error: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(3000);
    delete process.env.CLASSIFIER_TIMEOUT_MS;

    // A classifier that throws is swallowed, never thrown at the caller.
    svc.use({ provider: 'test', modelVersion: 'boom', classify: async () => { throw new Error('boom'); } });
    await expect(svc.shadow(centers[0].tenantId, 'Salom', 'test')).resolves.toMatchObject({ status: 'NEEDS_HUMAN' });
  });

  it("each center has its own hourly allowance; one center's messages never reach another", async () => {
    process.env.CLASSIFIER_TENANT_PER_HOUR = '2';
    let seen: string[] = [];
    svc.use({ provider: 'test', modelVersion: 't', classify: async (i) => { seen.push(i.text); return { choice: 'other', probability: 0.9 }; } });
    await db.delete(messageClassifications).where(eq(messageClassifications.tenantId, centers[1].tenantId));
    await svc.shadow(centers[1].tenantId, 'b1', 'test');
    await svc.shadow(centers[1].tenantId, 'b2', 'test');
    expect(await svc.shadow(centers[1].tenantId, 'b3', 'test')).toMatchObject({ status: 'NEEDS_HUMAN', error: 'RATE_LIMITED' });
    expect(seen).toEqual(['b1', 'b2']); // the third was not sent
    delete process.env.CLASSIFIER_TENANT_PER_HOUR;
    seen = [];

    const listA = (await http().get('/api/classifications').set(centers[0].token).expect(200)).body;
    const listB = (await http().get('/api/classifications').set(centers[1].token).expect(200)).body;
    expect(listA.items.some((r: { inputText: string }) => r.inputText.startsWith('b'))).toBe(false);
    expect(listB.items.every((r: { tenantId: string }) => r.tenantId === centers[1].tenantId)).toBe(true);
    // Another center's row cannot be labelled.
    await http().patch(`/api/classifications/${listB.items[0].id}`).set(centers[0].token).send({ finalLabel: 'other' }).expect(404);
  });

  it("a person's label is compared with the suggestion", async () => {
    const list = (await http().get('/api/classifications?labeled=no').set(centers[0].token).expect(200)).body;
    const pay = list.items.find((r: { inputText: string }) => r.inputText === 'Qarzim qancha qoldi?');
    const price = list.items.find((r: { inputText: string }) => r.inputText === 'Сколько стоит курс?');
    await http().patch(`/api/classifications/${pay.id}`).set(centers[0].token).send({ finalLabel: 'payment', finalAction: "Qarzni aytdik" }).expect(200);
    await http().patch(`/api/classifications/${price.id}`).set(centers[0].token).send({ finalLabel: 'payment' }).expect(200);
    await http().patch(`/api/classifications/${price.id}`).set(centers[0].token).send({ finalLabel: 'refund' }).expect(400);
    const stats = (await http().get('/api/classifications').set(centers[0].token).expect(200)).body.stats;
    expect(stats).toMatchObject({ labelled: 2, answered: 2, accuracy: 0.5, confident: 1, confidentAccuracy: 1 });
    expect(stats.matrix.payment).toMatchObject({ payment: 1, price: 1 });
  });

  it("a student's own Telegram message is logged beside the bot's usual answer", async () => {
    svc.use(fixed('schedule', 0.88));
    const tg = app.get(TelegramService);
    const replies: string[] = [];
    tg.sendMessage = (async (_c: string, text: string) => {
      replies.push(text);
      return 1;
    }) as typeof tg.sendMessage;
    const chat = `7${String(suffix).slice(-8)}`;
    const kid = (await http().post('/api/students').set(centers[0].token).send({ fullName: 'Bot Asker' }).expect(201)).body.id as string;
    await db.update(students).set({ telegramChatId: chat }).where(eq(students.id, kid));
    await tg.handleUpdate({ message: { text: 'Ertaga dars bormi?', chat: { id: Number(chat) } } });
    await new Promise((r) => setTimeout(r, 300));
    expect(replies.length).toBeGreaterThan(0); // the bot answered as it always does
    const logged = (await rows(centers[0].tenantId)).find((r) => r.inputText === 'Ertaga dars bormi?');
    expect(logged).toMatchObject({ source: 'telegram:student', sourceRef: kid, chosen: 'schedule', status: 'SUGGESTED', ruleAction: 'BOT_MENU' });
    // A menu button is not a message of their own.
    await tg.handleUpdate({ message: { text: '/start', chat: { id: Number(chat) } } });
    await new Promise((r) => setTimeout(r, 200));
    expect((await rows(centers[0].tenantId)).some((r) => r.inputText === '/start')).toBe(false);
  });

  it('only owners and admins see the review', async () => {
    await http().post('/api/staff').set(centers[0].token).send({ email: `cls-m-${suffix}@test.uz`, fullName: 'Cls Manager', role: 'MANAGER', password: 'password12345' }).expect(201);
    const m = (await http().post('/api/auth/login').send({ email: `cls-m-${suffix}@test.uz`, password: 'password12345' }).expect(201)).body.accessToken;
    await http().get('/api/classifications').set({ Authorization: `Bearer ${m}` }).expect(403);
  });
});
