import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('Security Hardening Suite (e2e)', () => {
  let app: INestApplication<App>;
  const suffix = Date.now();

  let tokenA: string;
  let tenantAId: string;
  let tenantASubdomain: string;

  let tokenB: string;
  let tenantBId: string;
  let tenantBSubdomain: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    // Setup Tenant A
    tenantASubdomain = `sec-a-${suffix}`;
    const resA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        centerName: `Security Org A ${suffix}`,
        subdomain: tenantASubdomain,
        email: `admin-a-${suffix}@test.uz`,
        password: 'password123',
        fullName: 'Admin Org A',
      })
      .expect(201);

    tokenA = resA.body.accessToken;
    tenantAId = resA.body.tenant.id;

    // Setup Tenant B
    tenantBSubdomain = `sec-b-${suffix}`;
    const resB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        centerName: `Security Org B ${suffix}`,
        subdomain: tenantBSubdomain,
        email: `admin-b-${suffix}@test.uz`,
        password: 'password123',
        fullName: 'Admin Org B',
      })
      .expect(201);

    tokenB = resB.body.accessToken;
    tenantBId = resB.body.tenant.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ==========================================
  // Test A — Parent invitation
  // ==========================================
  describe('Test A — Parent invitation', () => {
    it('admin creates PARENT invitation, parent accepts, role is PARENT, no new org created', async () => {
      const parentEmail = `parent-${suffix}@test.uz`;
      const invRes = await request(app.getHttpServer())
        .post('/api/invitations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          email: parentEmail,
          role: 'PARENT',
        })
        .expect(201);

      const token = invRes.body.token;
      expect(token).toBeDefined();

      const acceptRes = await request(app.getHttpServer())
        .post(`/api/invitations/${token}/accept`)
        .send({
          fullName: 'Dilnoza Karimova (Parent)',
          password: 'parentPassword123',
        })
        .expect(201);

      expect(acceptRes.body.user.role).toBe('PARENT');
      expect(acceptRes.body.redirectUrl).toBe('/portal');
      expect(acceptRes.body.tenant.subdomain).toBe(tenantASubdomain);
    });
  });

  // ==========================================
  // Test B — Unauthorized Workspace Switching
  // ==========================================
  describe('Test B — Unauthorized Workspace Switching', () => {
    it('rejects workspace switching if user has no active membership in target tenant', async () => {
      // User belongs to Tenant A, attempts selectWorkspace on Tenant B without membership -> 401
      await request(app.getHttpServer())
        .post('/api/auth/select-workspace')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ tenantId: tenantBId })
        .expect(401);
    });
  });

  // ==========================================
  // Test C — Cross-Tenant IDOR
  // ==========================================
  describe('Test C — Cross-Tenant IDOR', () => {
    it('enforces tenant scoping on direct fetch, update, and delete across entities', async () => {
      // Tenant A creates Group A
      const groupA = await request(app.getHttpServer())
        .post('/api/groups')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Group A', subject: 'Math' })
        .expect(201);

      // Tenant A creates Student A
      const studentA = await request(app.getHttpServer())
        .post('/api/students')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Student A', phone: '+998901112233' })
        .expect(201);

      // Tenant A creates Teacher A
      const teacherA = await request(app.getHttpServer())
        .post('/api/teachers')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Teacher A', phone: '+998901112234', specialization: 'Math' })
        .expect(201);

      // Tenant A creates Subject A
      const subjectA = await request(app.getHttpServer())
        .post('/api/subjects')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Subject A', code: 'SA1' })
        .expect(201);

      // Tenant A creates Branch A
      const branchA = await request(app.getHttpServer())
        .post('/api/branches')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Branch A', address: 'Tashkent' })
        .expect(201);

      // Tenant A creates Payment A
      const paymentA = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          studentId: studentA.body.id,
          amount: 150000,
          method: 'CASH',
          type: 'TUITION',
          forMonth: '2026-09',
        })
        .expect(201);

      // Tenant B attacker attempts direct fetch / update / delete on Tenant A entities:

      // Group A
      await request(app.getHttpServer())
        .get(`/api/groups/${groupA.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/groups/${groupA.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      // Student A
      await request(app.getHttpServer())
        .get(`/api/students/${studentA.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/api/students/${studentA.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ fullName: 'Hacked Student' })
        .expect(404);

      // Teacher A
      await request(app.getHttpServer())
        .get(`/api/teachers/${teacherA.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      // Subject A
      await request(app.getHttpServer())
        .get(`/api/subjects/${subjectA.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      // Branch A
      await request(app.getHttpServer())
        .get(`/api/branches/${branchA.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/branches/${branchA.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      // Payment A
      await request(app.getHttpServer())
        .get(`/api/payments/${paymentA.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });
  });

  // ==========================================
  // Test D — Multi-Tenant Staff Removal Regression
  // ==========================================
  describe('Test D — Multi-Tenant Staff Removal Regression', () => {
    it('removing staff from Tenant A does NOT delete global User or Tenant B membership', async () => {
      const anvarEmail = `anvar-${suffix}@test.uz`;

      // 1. Tenant A adds Anvar as TEACHER
      const staffARes = await request(app.getHttpServer())
        .post('/api/staff')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          fullName: 'Anvar Aliyev',
          email: anvarEmail,
          password: 'anvarPassword123',
          role: 'TEACHER',
        })
        .expect(201);

      const anvarUserId = staffARes.body.id;

      // 2. Tenant B adds existing user Anvar as MANAGER
      await request(app.getHttpServer())
        .post('/api/staff')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          fullName: 'Anvar Aliyev',
          email: anvarEmail,
          password: 'anvarPassword123',
          role: 'MANAGER',
        })
        .expect(201);

      // 3. Tenant A removes Anvar from Tenant A
      await request(app.getHttpServer())
        .delete(`/api/staff/${anvarUserId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      // 4. Verify Anvar still exists globally and can log in
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: anvarEmail,
          password: 'anvarPassword123',
        });

      expect([200, 201]).toContain(loginRes.status);
      const anvarSessionToken = loginRes.body.accessToken;
      expect(anvarSessionToken).toBeDefined();

      // 5. Verify Anvar's Tenant B access continues working
      const switchBRes = await request(app.getHttpServer())
        .post('/api/auth/select-workspace')
        .set('Authorization', `Bearer ${anvarSessionToken}`)
        .send({ tenantId: tenantBId })
        .expect(201);

      expect(switchBRes.body.role).toBe('MANAGER');
      expect(switchBRes.body.tenant.id).toBe(tenantBId);

      // 6. Verify Tenant A workspace access is rejected for Anvar
      await request(app.getHttpServer())
        .post('/api/auth/select-workspace')
        .set('Authorization', `Bearer ${anvarSessionToken}`)
        .send({ tenantId: tenantAId })
        .expect(401);
    });
  });

  // ==========================================
  // Test E — Existing User Invitation Security
  // ==========================================
  describe('Test E — Existing User Invitation Security', () => {
    it('requires password or active matching session to accept invitation for existing user', async () => {
      // 1. Existing user Anvar exists from Test D (anvarEmail)
      const existingUserEmail = `anvar-${suffix}@test.uz`;

      // 2. Tenant B issues invitation for User Anvar (or Tenant A issues invitation)
      const invRes = await request(app.getHttpServer())
        .post('/api/invitations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          email: existingUserEmail,
          role: 'TEACHER',
        })
        .expect(201);

      const token = invRes.body.token;

      // 3. Attempt acceptance without password or session -> REJECTED (400)
      await request(app.getHttpServer())
        .post(`/api/invitations/${token}/accept`)
        .send({})
        .expect(400);

      // 4. Attempt acceptance with WRONG password -> REJECTED (401)
      await request(app.getHttpServer())
        .post(`/api/invitations/${token}/accept`)
        .send({ password: 'wrongPassword' })
        .expect(401);

      // 5. Acceptance with CORRECT password -> SUCCEEDS (201)
      const acceptRes = await request(app.getHttpServer())
        .post(`/api/invitations/${token}/accept`)
        .send({ password: 'anvarPassword123' })
        .expect(201);

      expect(acceptRes.body.user.email).toBe(existingUserEmail);
      expect(acceptRes.body.tenant.id).toBe(tenantAId);
      expect(acceptRes.body.user.role).toBe('TEACHER');
    });
  });
});
