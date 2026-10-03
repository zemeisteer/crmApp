import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// An access token is only as alive as the session it was issued for.
describe('Session-bound access tokens (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  const mail = `sess-${suffix}@test.uz`;
  const password = 'password123';
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let registered: { accessToken: string; refreshToken: string };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    registered = (await http().post('/api/auth/register')
      .send({ centerName: `Sess ${suffix}`, subdomain: `sess-${suffix}`, email: mail, password, fullName: 'Owner' })
      .expect(201)).body;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('ends the access token with its session: logout, a revoked session, and a token without a session', async () => {
    const signIn = async () => (await http().post('/api/auth/login').send({ email: mail, password }).expect(201)).body;

    // Logout: the access token is refused at once, not at its expiry.
    const one = registered;
    await http().get('/api/auth/me').set(bearer(one.accessToken)).expect(200);
    await http().post('/api/auth/logout').send({ refreshToken: one.refreshToken }).expect(201);
    await http().get('/api/auth/me').set(bearer(one.accessToken)).expect(401);
    await http().get('/api/students').set(bearer(one.accessToken)).expect(401);

    // Revoking another session ends that session's token and leaves this one.
    const mine = await signIn();
    const other = await signIn();
    const list = (await http().get('/api/auth/sessions').set(bearer(mine.accessToken)).expect(200)).body as { id: string }[];
    const otherSid = JSON.parse(Buffer.from(other.accessToken.split('.')[1], 'base64url').toString()).sid as string;
    expect(list.map((x) => x.id)).toContain(otherSid);
    await http().delete(`/api/auth/sessions/${otherSid}`).set(bearer(mine.accessToken)).expect(200);
    await http().get('/api/auth/me').set(bearer(other.accessToken)).expect(401);
    await http().get('/api/auth/me').set(bearer(mine.accessToken)).expect(200);

    // A refreshed token belongs to the same session and ends with it.
    const refreshed = (await http().post('/api/auth/refresh').send({ refreshToken: mine.refreshToken }).expect(201)).body;
    await http().get('/api/auth/me').set(bearer(refreshed.accessToken)).expect(200);
    await http().post('/api/auth/logout').send({ refreshToken: refreshed.refreshToken }).expect(201);
    await http().get('/api/auth/me').set(bearer(refreshed.accessToken)).expect(401);
    await http().get('/api/auth/me').set(bearer(mine.accessToken)).expect(401);
  });
});
