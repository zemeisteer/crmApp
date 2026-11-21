import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { portalPinFailures } from '../src/db/schema.js';

// A cabinet PIN is 6 digits: wrong guesses are counted per phone, whatever
// address they come from (the per-address rate limit is switched off here,
// as a guesser with many addresses would get past it), and after 10 the
// phone's PIN sign-in waits, even for the right PIN. The count lives in the
// database: a second API instance sees the same one, and the table holds a
// hash of the phone, never the number.
describe('Cabinet PIN lockout (e2e)', () => {
  let app: NestExpressApplication;
  let other: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);

  const boot = async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 1,
          timeToExpire: 0,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();
    const a = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(a);
    await a.init();
    return a;
  };

  beforeAll(async () => {
    app = await boot();
    other = await boot();
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await other?.close();
  });

  it("ten wrong PINs shut the phone's PIN sign-in on every instance, the right PIN included", async () => {
    const owner = (
      await http()
        .post('/api/auth/register')
        .send({
          centerName: `PIN ${suffix}`,
          subdomain: `pin-${suffix}`,
          email: `pin-${suffix}@test.uz`,
          password: 'password123',
          fullName: 'Pin Owner',
        })
        .expect(201)
    ).body.accessToken as string;
    const auth = { Authorization: `Bearer ${owner}` };
    const phone = `+99894${String(suffix).slice(-7)}`;
    const kid = (
      await http()
        .post('/api/students')
        .set(auth)
        .send({ fullName: 'Pin Kid', phone })
        .expect(201)
    ).body.id as string;
    const { pin } = (
      await http().post(`/api/students/${kid}/portal-pin`).set(auth).expect(201)
    ).body as { pin: string };
    const wrong = pin === '000000' ? '111111' : '000000';
    const verify = (a: NestExpressApplication, body: object) =>
      request(a.getHttpServer() as App)
        .post('/api/portal/auth/phone/verify')
        .send({ phone, ...body });

    // The right PIN works, and a success does not count against the phone.
    await verify(app, { pin }).expect(201);
    // Guesses split over two instances add up (5 + 5).
    for (let i = 0; i < 5; i++) await verify(app, { pin: wrong }).expect(401);
    for (let i = 0; i < 5; i++) await verify(other, { pin: wrong }).expect(401);
    for (const a of [app, other]) {
      const locked = await verify(a, { pin }).expect(429);
      expect(locked.body.code).toBe('PIN_LOCKED');
    }

    // The table holds a hash, not the number.
    const rows = await app.get<Database>(DB).select().from(portalPinFailures);
    expect(JSON.stringify(rows)).not.toContain(phone);
  });

  it('a right PIN clears earlier wrong ones, so the count restarts', async () => {
    const owner = (
      await http()
        .post('/api/auth/register')
        .send({
          centerName: `PIN2 ${suffix}`,
          subdomain: `pin2-${suffix}`,
          email: `pin2-${suffix}@test.uz`,
          password: 'password123',
          fullName: 'Pin Owner 2',
        })
        .expect(201)
    ).body.accessToken as string;
    const auth = { Authorization: `Bearer ${owner}` };
    const phone = `+99893${String(suffix).slice(-7)}`;
    const kid = (
      await http()
        .post('/api/students')
        .set(auth)
        .send({ fullName: 'Pin Kid 2', phone })
        .expect(201)
    ).body.id as string;
    const { pin } = (
      await http().post(`/api/students/${kid}/portal-pin`).set(auth).expect(201)
    ).body as { pin: string };
    const wrong = pin === '000000' ? '111111' : '000000';
    const verify = (body: object) =>
      http()
        .post('/api/portal/auth/phone/verify')
        .send({ phone, ...body });

    // 27 wrong PINs in all, never 10 in a row: without the clearing, the
    // second round would already be shut.
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 9; i++) await verify({ pin: wrong }).expect(401);
      await verify({ pin }).expect(201);
    }
  });
});
