import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { BCRYPT_COST } from '../src/common/password.js';
import { DB, Database } from '../src/db/db.module.js';
import { users } from '../src/db/schema.js';

describe('Passwords and uploads (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  let token: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get(DB);
    token = (await http().post('/api/auth/register')
      .send({ centerName: `Hard ${suffix}`, subdomain: `hard-${suffix}`, email: `hard-${suffix}@test.uz`, password: 'password123', fullName: 'Hard Owner' })
      .expect(201)).body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  const upload = (bytes: Buffer, contentType: string) =>
    http().post('/api/tenants/me/logo').set('Authorization', `Bearer ${token}`).attach('file', bytes, { filename: 'x', contentType });

  it('a file that is not what it says is refused; a real picture passes', async () => {
    const page = Buffer.from('<html><script>alert(1)</script></html>');
    expect((await upload(page, 'image/png')).status).toBe(400);
    expect((await upload(page, 'image/jpeg')).status).toBe(400);
    expect((await upload(png, 'image/jpeg')).status).toBe(400);
    expect((await upload(png, 'image/png')).status).toBeLessThan(300);
  });

  it('an older, cheaper hash is replaced at the next sign-in, and the password still works', async () => {
    const email = `hard-${suffix}@test.uz`;
    await db.update(users).set({ passwordHash: await bcrypt.hash('password123', 4) }).where(eq(users.email, email));
    await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201);
    const [row] = await db.select({ h: users.passwordHash }).from(users).where(eq(users.email, email));
    expect(bcrypt.getRounds(row.h)).toBe(BCRYPT_COST);
    await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201);
  });

  it('a password longer than bcrypt reads is refused, not silently cut', async () => {
    const long = `A1${'x'.repeat(80)}`;
    await http().post('/api/auth/register')
      .send({ centerName: `Long ${suffix}`, subdomain: `long-${suffix}`, email: `long-${suffix}@test.uz`, password: long, fullName: 'Long Owner' })
      .expect(400);
  });
});
