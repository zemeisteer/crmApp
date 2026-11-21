import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { trialStarted } from './trial-started';

// A trial booked for a later day cannot be marked "came" or "missed" yet:
// that is how a lead ended up offering a new trial before the first one.
describe('A trial is marked only once it has begun (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer() as App);
  const suffix = Date.now();
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('before: refused for came and missed (the trial stays booked); after it begins: marked', async () => {
    const token = (await http().post('/api/auth/register')
      .send({ centerName: `TNS ${suffix}`, subdomain: `tns-${suffix}`, email: `tns-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
    const auth = { Authorization: `Bearer ${token}` };
    const lead = (await http().post('/api/leads').set(auth).send({ fullName: 'Early Trial', phone: '+998901239876' }).expect(201)).body;
    await http().post(`/api/leads/${lead.id}/transition`).set(auth).send({ toStatus: 'CONTACTED' }).expect(201);
    const day = new Date(Date.now() + 2 * 86_400_000 + 5 * 3_600_000).toISOString().slice(0, 10);
    const trial = (await http().post(`/api/leads/${lead.id}/trials`).set(auth).send({ scheduledAt: `${day}T13:00:00+05:00` }).expect(201)).body;

    expect((await http().post(`/api/leads/${lead.id}/trials/${trial.id}/miss`).set(auth).send({}).expect(409)).body.code).toBe('TRIAL_NOT_STARTED');
    expect((await http().post(`/api/leads/${lead.id}/trials/${trial.id}/attend`).set(auth).send({}).expect(409)).body.code).toBe('TRIAL_NOT_STARTED');
    const shown = (await http().get(`/api/leads/${lead.id}`).set(auth).expect(200)).body;
    expect(shown.trials.map((t: { status: string }) => t.status)).toEqual(['BOOKED']);
    // Cancelling ahead stays possible.

    await trialStarted(trial.id);
    await http().post(`/api/leads/${lead.id}/trials/${trial.id}/attend`).set(auth).send({}).expect(201);
  });
});
