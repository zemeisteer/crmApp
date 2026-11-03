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

  describe('the cabinet (students and parents)', () => {
    const cabCookie = (res: request.Response, id: string) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`talimcrm_cab_${id}=`));
    // One sign-in for the whole block: sign-ins are rate limited.
    let ownerAuth: Record<string, string> | null = null;
    const owner = async () => (ownerAuth ??= { Authorization: `Bearer ${(await login({})).body.accessToken}` });
    let n = 0;
    async function kid() {
      const auth = await owner();
      const phone = `+99894${String(suffix + ++n).slice(-7)}`;
      const id = (await http().post('/api/students').set(auth).send({ fullName: `Cookie Kid ${n}`, phone }).expect(201)).body.id as string;
      const { pin } = (await http().post(`/api/students/${id}/portal-pin`).set(auth).expect(201)).body;
      return { id, phone, pin: String(pin), auth };
    }
    const signIn = (k: { phone: string; pin: string }, headers: Record<string, string> = COOKIE_MODE) =>
      http().post('/api/portal/auth/phone/verify').set(headers).send({ phone: k.phone, pin: k.pin }).expect(201);
    const as = (id: string) => ({ ...COOKIE_MODE, 'X-Portal-Student': id });

    it('the token is a locked cookie for that child only; other clients keep the body form', async () => {
      const k = await kid();
      const res = await signIn(k);
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.student.id).toBe(k.id);
      const set = cabCookie(res, k.id)!;
      expect(set).toMatch(/HttpOnly/i);
      expect(set).toMatch(/SameSite=Lax/i);
      expect(set).toMatch(/Path=\/api\/portal/i);
      const plain = await signIn(k, {});
      expect(plain.body.accessToken).toEqual(expect.any(String));
      expect(cabCookie(plain, k.id)).toBeUndefined();
    });

    it('two children, two cookies: the header picks which; without the transport header nothing opens', async () => {
      const a = await kid();
      const b = await kid();
      const jar = [pair(cabCookie(await signIn(a), a.id)!), pair(cabCookie(await signIn(b), b.id)!)].join('; ');
      expect((await http().get('/api/portal/me').set(as(a.id)).set('Cookie', jar).expect(200)).body.fullName).toBe('Cookie Kid ' + (n - 1));
      expect((await http().get('/api/portal/me').set(as(b.id)).set('Cookie', jar).expect(200)).body.fullName).toBe('Cookie Kid ' + n);
      await http().get('/api/portal/me').set('X-Portal-Student', a.id).set('Cookie', jar).expect(401);
      await http().get('/api/portal/me').set(as('someone-else')).set('Cookie', jar).expect(401);
      // A new PIN still ends a session opened before it (tokens carry whole seconds).
      await new Promise((r) => setTimeout(r, 1100));
      await http().post(`/api/students/${a.id}/portal-pin`).set(a.auth).expect(201);
      await http().get('/api/portal/me').set(as(a.id)).set('Cookie', jar).expect(401);
    });

    it('a token kept by an older page becomes its cookie; logout removes every child\'s cookie', async () => {
      const k = await kid();
      const token = (await signIn(k, {})).body.accessToken as string;
      const adopted = await http().post('/api/portal/auth/adopt').set(COOKIE_MODE).set('Authorization', `Bearer ${token}`).expect(201);
      expect(adopted.body.accessToken).toBeUndefined();
      const cookie = pair(cabCookie(adopted, k.id)!);
      await http().get('/api/portal/me').set(as(k.id)).set('Cookie', cookie).expect(200);
      const out = await http().post('/api/portal/auth/logout').set(COOKIE_MODE).set('Cookie', cookie).expect(201);
      expect(cabCookie(out, k.id)).toMatch(/Expires=Thu, 01 Jan 1970/i);
    });
  });
});
