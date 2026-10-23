import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { vi } from 'vitest';
// vi.mock below is hoisted above these, so the app loads the replaced check.
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// The "signups" switch turned off. Turning it off in the shared database
// would stop other suites' sign-ups running at the same time, so here the
// switch's answer is replaced in this test's process only.
const off = new Set<string>();
vi.mock('../src/feature-flags/flags.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/feature-flags/flags.js')>();
  return { ...real, flagOn: vi.fn(async (db: unknown, key: string, tenantId?: string | null) => (off.has(key) ? false : real.flagOn(db as never, key as never, tenantId))) };
});


describe('Sign-ups paused (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const tail = String(suffix).slice(-5);
  const http = () => request(app.getHttpServer() as App);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('off: no code and no sign-up, a clear 503; back on, signing up works', async () => {
    off.add('signups');
    const code = await http().post('/api/auth/register/phone').send({ phone: `+99899${tail}77` });
    expect([code.status, code.body.code]).toEqual([503, 'SIGNUPS_PAUSED']);
    const reg = await http().post('/api/auth/register').send({ centerName: `SP off ${suffix}`, subdomain: `sp-off-${tail}`, email: `sp-off-${suffix}@test.uz`, password: 'password123', fullName: 'SP Off' });
    expect([reg.status, reg.body.code]).toEqual([503, 'SIGNUPS_PAUSED']);
    off.delete('signups');
    await http().post('/api/auth/register').send({ centerName: `SP on ${suffix}`, subdomain: `sp-on-${tail}`, email: `sp-on-${suffix}@test.uz`, password: 'password123', fullName: 'SP On' }).expect(201);
  });
});
