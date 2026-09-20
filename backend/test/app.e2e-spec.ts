import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

// Exercises the full HTTP stack against a real (test) database: two tenants
// register, and we confirm each can only ever see its own data — this is
// the single most important guarantee in a multi-tenant CRM, so it's worth
// a real end-to-end check rather than a unit test with a mocked DB.
describe('Multi-tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  const suffix = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers two separate tenants and keeps their groups isolated', async () => {
    const tenantA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        centerName: 'E2E Tenant A',
        subdomain: `e2e-a-${suffix}`,
        email: `e2e-a-${suffix}@test.uz`,
        password: 'password123',
        fullName: 'Tenant A Admin',
      })
      .expect(201);

    const tenantB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        centerName: 'E2E Tenant B',
        subdomain: `e2e-b-${suffix}`,
        email: `e2e-b-${suffix}@test.uz`,
        password: 'password123',
        fullName: 'Tenant B Admin',
      })
      .expect(201);

    const tokenA = tenantA.body.accessToken as string;
    const tokenB = tenantB.body.accessToken as string;

    await request(app.getHttpServer())
      .post('/api/groups')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Only in A', subject: 'Test' })
      .expect(201);

    const groupsA = await request(app.getHttpServer())
      .get('/api/groups')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(groupsA.body).toHaveLength(1);
    expect(groupsA.body[0].name).toBe('Only in A');

    const groupsB = await request(app.getHttpServer())
      .get('/api/groups')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(groupsB.body).toHaveLength(0);
  });

  it('rejects requests with no token', async () => {
    await request(app.getHttpServer()).get('/api/groups').expect(401);
  });
});
