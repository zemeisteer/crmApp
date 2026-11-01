import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('The site\'s session cookie (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const email = `cookie-${suffix}@test.uz`;
  const http = () => request(app.getHttpServer() as App);
  const COOKIE_MODE = { 'X-Session-Transport': 'cookie' };
  const cookieOf = (res: request.Response) => {
    const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('talimcrm_refresh='));
    return set;
  };
  const pair = (set: string) => set.split(';')[0];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    await http().post('/api/auth/register')
      .send({ centerName: `Cookie ${suffix}`, subdomain: `cookie-${suffix}`, email, password: 'password123', fullName: 'Cookie Owner' })
      .expect(201);
  });
  afterAll(async () => { await app.close(); });

  const login = (headers: Record<string, string> = COOKIE_MODE) => http().post('/api/auth/login').set(headers).send({ email, password: 'password123' }).expect(201);

  it('the token is a locked cookie, never in the answer; other clients keep the body form', async () => {
    const res = await login();
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toBeUndefined();
    const set = cookieOf(res)!;
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).toMatch(/Path=\/api\/auth/i);
    const plain = await login({});
    expect(plain.body.refreshToken).toEqual(expect.any(String));
    expect(cookieOf(plain)).toBeUndefined();
  });

  it('refresh by cookie gives a new access token and a new cookie; the old cookie is finished', async () => {
    const first = pair(cookieOf(await login())!);
    const res = await http().post('/api/auth/refresh').set(COOKIE_MODE).set('Cookie', first).send({}).expect(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toBeUndefined();
    const next = pair(cookieOf(res)!);
    expect(next).not.toBe(first);
    await http().get('/api/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    await http().post('/api/auth/refresh').set(COOKIE_MODE).set('Cookie', first).send({}).expect(401);
  });

  it('without the header the cookie opens nothing (another site cannot use it)', async () => {
    const cookie = pair(cookieOf(await login())!);
    await http().post('/api/auth/refresh').set('Cookie', cookie).send({}).expect(401);
  });

  it('logout by cookie ends the session and clears the cookie', async () => {
    const cookie = pair(cookieOf(await login())!);
    const out = await http().post('/api/auth/logout').set(COOKIE_MODE).set('Cookie', cookie).send({}).expect(201);
    expect(cookieOf(out)).toMatch(/talimcrm_refresh=;/);
    await http().post('/api/auth/refresh').set(COOKIE_MODE).set('Cookie', cookie).send({}).expect(401);
  });

  it('logout with no token at all is a plain answer, not a crash', async () => {
    await http().post('/api/auth/logout').send({}).expect(201);
  });
});
