import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// A cabinet PIN is 6 digits: wrong guesses are counted per phone, whatever
// address they come from (the per-address rate limit is switched off here,
// as a guesser with many addresses would get past it), and after 10 the
// phone's PIN sign-in waits, even for the right PIN.
describe('Cabinet PIN lockout (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);

  beforeAll(async () => {
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
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it("ten wrong PINs shut the phone's PIN sign-in, the right PIN included", async () => {
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

    // The right PIN works, and a success does not count against the phone.
    await http()
      .post('/api/portal/auth/phone/verify')
      .send({ phone, pin })
      .expect(201);
    for (let i = 0; i < 10; i++)
      await http()
        .post('/api/portal/auth/phone/verify')
        .send({ phone, pin: wrong })
        .expect(401);
    const locked = await http()
      .post('/api/portal/auth/phone/verify')
      .send({ phone, pin })
      .expect(429);
    expect(locked.body.code).toBe('PIN_LOCKED');
  });
});
