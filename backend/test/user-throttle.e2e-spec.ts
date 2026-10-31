import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('Request limits: a person, not an address (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const signUp = async (n: string) => (await http().post('/api/auth/register')
    .send({ centerName: `Limit ${n} ${suffix}`, subdomain: `lim${n}-${suffix}`, email: `lim${n}-${suffix}@test.uz`, password: 'password123', fullName: 'Limit Owner' })
    .expect(201)).body.accessToken as string;
  const times = async (n: number, fn: () => request.Test) => {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) statuses.push((await fn()).status);
    return statuses;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('two people on one address have an allowance each; the second is not refused for the first', async () => {
    const [a, b] = [await signUp('a'), await signUp('b')];
    const first = await times(101, () => http().get('/api/auth/me').set(bearer(a)));
    expect(first.filter((s) => s === 429)).toHaveLength(1); // the person's own limit still holds
    await http().get('/api/auth/me').set(bearer(b)).expect(200);
  }, 60_000);

  it('a made-up token buys no allowance: it is counted by address', async () => {
    const forged = await times(101, () => http().get('/api/students?page=1').set(bearer(`forged.${Math.random()}.token`)));
    expect(forged.filter((s) => s === 429)).toHaveLength(1);
    expect(forged.filter((s) => s === 401)).toHaveLength(100);
  }, 60_000);

  it('guessing a password stays limited by address, whatever token comes with it', async () => {
    const tokens = [await signUp('c'), await signUp('d')];
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) {
      const r = await http().post('/api/auth/login').set(bearer(tokens[i % 2])).send({ email: `nobody-${suffix}@test.uz`, password: 'wrong-password' });
      statuses.push(r.status);
    }
    expect(statuses.at(-1)).toBe(429);
  }, 60_000);
});
