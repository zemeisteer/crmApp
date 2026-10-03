import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// The same "create" form arriving twice makes one record, not two.
describe('Double submission of create forms (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    token = (await http().post('/api/auth/register')
      .send({ centerName: `Twice ${suffix}`, subdomain: `twice-${suffix}`, email: `twice-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('two identical teacher requests at once give one teacher', async () => {
    const body = { fullName: 'Twice Teacher', subject: 'English' };
    const [a, b] = await Promise.all([
      http().post('/api/teachers').set(auth()).send(body).expect(201),
      http().post('/api/teachers').set(auth()).send(body).expect(201),
    ]);
    expect(a.body.id).toBe(b.body.id);
    const again = await http().post('/api/teachers').set(auth()).send(body).expect(201);
    expect(again.body.id).toBe(a.body.id);
    const list = (await http().get('/api/teachers').set(auth()).expect(200)).body as { fullName: string }[];
    expect(list.filter((t) => t.fullName === 'Twice Teacher')).toHaveLength(1);
    // A different person is still a different teacher.
    const other = await http().post('/api/teachers').set(auth()).send({ fullName: 'Twice Teacher', phone: '+998 90 000 00 01' }).expect(201);
    expect(other.body.id).not.toBe(a.body.id);
  });

  it('two identical student requests at once give one student', async () => {
    const body = { fullName: 'Twice Student', phone: '+998 90 000 00 02' };
    const [a, b] = await Promise.all([
      http().post('/api/students').set(auth()).send(body).expect(201),
      http().post('/api/students').set(auth()).send(body).expect(201),
    ]);
    expect(a.body.id).toBe(b.body.id);
    const namesake = await http().post('/api/students').set(auth()).send({ fullName: 'Twice Student', phone: '+998 90 000 00 03' }).expect(201);
    expect(namesake.body.id).not.toBe(a.body.id);
  });
});
