import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// Regression for a data-exposure defect: staff endpoints without @Roles were
// open to every signed-in user, so a STUDENT (or a TEACHER) could read the
// center's payments, debtors, expenses and every teacher's salary.
describe('Role boundaries on back-office endpoints (e2e)', () => {
  let app: INestApplication<App>;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    const reg = await http().post('/api/auth/register')
      .send({ centerName: `Roles ${suffix}`, subdomain: `roles-${suffix}`, email: `roles-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201);
    tokens.OWNER = reg.body.accessToken;
    for (const role of ['TEACHER', 'STUDENT', 'PARENT', 'ACCOUNTANT', 'MANAGER', 'RECEPTIONIST']) {
      const inv = await http().post('/api/invitations').set('Authorization', `Bearer ${tokens.OWNER}`)
        .send({ email: `${role.toLowerCase()}-${suffix}@test.uz`, role }).expect(201);
      const acc = await http().post(`/api/invitations/${inv.body.token}/accept`)
        .send({ fullName: `${role} user`, password: 'password12345' }).expect(201);
      tokens[role] = acc.body.accessToken;
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  const status = async (path: string, role: string) =>
    (await http().get(`/api${path}`).set('Authorization', `Bearer ${tokens[role]}`)).status;

  it('keeps finance data away from teachers, students and parents', async () => {
    for (const path of ['/payments', '/payments/summary', '/payments/debtors', '/payments/finance-summary', '/expenses', '/expenses/summary', '/salary-payments']) {
      for (const role of ['TEACHER', 'STUDENT', 'PARENT']) {
        expect(await status(path, role), `${role} ${path}`).toBe(403);
      }
      expect(await status(path, 'ACCOUNTANT'), `ACCOUNTANT ${path}`).toBe(200);
      expect(await status(path, 'OWNER'), `OWNER ${path}`).toBe(200);
    }
  });

  it('lets the front desk and management read payments, but not expenses or salaries', async () => {
    for (const role of ['MANAGER', 'RECEPTIONIST']) {
      expect(await status('/payments', role)).toBe(200);
      expect(await status('/expenses', role)).toBe(403);
      expect(await status('/salary-payments', role)).toBe(403);
    }
  });

  it('denies students and parents every staff endpoint that has no explicit role list', async () => {
    for (const path of ['/students', '/teachers', '/groups', '/attendance', '/branches', '/announcements']) {
      for (const role of ['STUDENT', 'PARENT']) {
        expect(await status(path, role), `${role} ${path}`).toBe(403);
      }
      expect(await status(path, 'TEACHER'), `TEACHER ${path}`).toBe(200);
    }
  });

  it('still lets parents use the endpoints meant for them', async () => {
    expect(await status('/portal/parent/students', 'PARENT')).toBe(200);
  });
});
