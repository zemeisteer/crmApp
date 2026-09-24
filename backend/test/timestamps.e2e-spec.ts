import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';

// Regression: rows timestamped by the database (defaultNow()) must agree with
// app-written timestamps. With a non-UTC database timezone they used to be
// stored as local wall-clock time and read back hours off.
describe('Timestamp consistency (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const suffix = Date.now();
  const closeToNow = (iso: string) => Math.abs(new Date(iso).getTime() - Date.now()) < 60_000;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        centerName: `TZ ${suffix}`,
        subdomain: `tz-${suffix}`,
        email: `tz-${suffix}@test.uz`,
        password: 'password123',
        fullName: 'TZ Owner',
      })
      .expect(201);
    token = res.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('runs database sessions in UTC', async () => {
    const db = app.get<Database>(DB);
    const result = await db.execute(sql`show timezone`);
    expect(String((result.rows[0] as { TimeZone: string }).TimeZone)).toBe('UTC');
  });

  it('stores defaultNow() timestamps consistently with the current instant', async () => {
    const student = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Timestamp Check', phone: '+998901119999' })
      .expect(201);
    expect(closeToNow(student.body.createdAt)).toBe(true);

    const group = await request(app.getHttpServer())
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'TZ Group', subject: 'Math' })
      .expect(201);
    expect(closeToNow(group.body.createdAt)).toBe(true);
  });
});
