import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// The site's application form: the applicant may pick several subjects. The
// first is the lead's main interest, the others its further directions.
describe('Public application with several subjects (e2e)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer() as App);
  const suffix = Date.now();
  const tail = String(suffix).slice(-5);
  const sub = `pas${tail}`;
  let token = '';

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    token = (await http().post('/api/auth/register').send({ centerName: `PAS ${suffix}`, subdomain: sub, email: `pas-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' }).expect(201)).body.accessToken;
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('first subject is the main one, the rest are its other directions; one subject works as before', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const id = async (name: string) => (await http().post('/api/subjects').set(auth).send({ name }).expect(201)).body.id as string;
    const english = await id('Ingliz tili');
    const math = await id('Matematika');
    const sat = await id('SAT');
    const apply = (n: number, extra: Record<string, unknown>) =>
      http().post(`/api/tenants/by-subdomain/${sub}/apply`).send({ fullName: `PAS ${n}`, phone: `+9989${tail}${String(n).padStart(3, '0')}`, consent: true, formStartedAt: Date.now() - 10_000, ...extra }).expect(201);
    const lead = async (n: number) => {
      const list = (await http().get('/api/leads').set(auth).expect(200)).body;
      return (list.items ?? list).find((l: { fullName: string }) => l.fullName === `PAS ${n}`);
    };

    await apply(1, { subject: 'Ingliz tili', subjects: ['Ingliz tili', 'Matematika', 'SAT', 'Unknown'] });
    const one = await lead(1);
    expect(one.desiredSubjectId).toBe(english);
    expect([...one.extraSubjectIds].sort()).toEqual([math, sat].sort());

    await apply(2, { subject: 'SAT' });
    const two = await lead(2);
    expect(two.desiredSubjectId).toBe(sat);
    expect(two.extraSubjectIds).toEqual([]);
  });
});
