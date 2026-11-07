import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// A branch phone is an Uzbek number (+998 and 9 digits) or nothing.
describe('Branch phone (e2e)', () => {
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

  it('accepts +998 numbers and an empty one; refuses anything else', async () => {
    const token = (await http().post('/api/auth/register')
      .send({ centerName: `BrPh ${suffix}`, subdomain: `brph-${suffix}`, email: `brph-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
    const auth = { Authorization: `Bearer ${token}` };
    const ok = (await http().post('/api/branches').set(auth).send({ name: 'Main', phone: '+998 71 123 45 67' }).expect(201)).body;
    await http().post('/api/branches').set(auth).send({ name: 'No phone', phone: '' }).expect(201);
    for (const bad of ['12345', '+1 202 555 0100', '+998 71 123 45', 'phone']) {
      await http().post('/api/branches').set(auth).send({ name: `Bad ${bad}`, phone: bad }).expect(400);
    }
    await http().patch(`/api/branches/${ok.id}`).set(auth).send({ phone: '998901234567' }).expect(200);
    await http().patch(`/api/branches/${ok.id}`).set(auth).send({ phone: 'abc' }).expect(400);
  });
});
