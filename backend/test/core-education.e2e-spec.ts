import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

describe('Core Education Operations Suite (e2e)', () => {
  let app: INestApplication<App>;
  const suffix = Date.now();

  let tokenA: string;
  let _tenantAId: string;
  let tenantASubdomain: string;

  let tokenB: string;
  let _tenantBId: string;
  let tenantBSubdomain: string;

  let teacherAId: string;
  let teacherBId: string;
  let courseAId: string;
  let groupAId: string;
  let groupA2Id: string;
  let groupBId: string;
  let studentAId: string;
  let studentA2Id: string;
  let studentBId: string;

  let parentToken: string;
  let parentUserId: string;

  let teacherAToken: string;
  let teacherAUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    // 1. Setup Tenant A
    tenantASubdomain = `edu-a-${suffix}`;
    const resA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        centerName: `Edu Org A ${suffix}`,
        subdomain: tenantASubdomain,
        email: `admin-a-${suffix}@test.uz`,
        password: 'password123',
        fullName: 'Admin Org A',
      })
      .expect(201);

    tokenA = resA.body.accessToken;
    _tenantAId = resA.body.tenant.id;

    // 2. Setup Tenant B
    tenantBSubdomain = `edu-b-${suffix}`;
    const resB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        centerName: `Edu Org B ${suffix}`,
        subdomain: tenantBSubdomain,
        email: `admin-b-${suffix}@test.uz`,
        password: 'password123',
        fullName: 'Admin Org B',
      })
      .expect(201);

    tokenB = resB.body.accessToken;
    _tenantBId = resB.body.tenant.id;

    // 3. Create Teacher in Tenant A via invitation so teacher has a User account
    const teacherInvRes = await request(app.getHttpServer())
      .post('/api/invitations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        email: `teacher-a-${suffix}@test.uz`,
        role: 'TEACHER',
      })
      .expect(201);

    const teacherAcceptRes = await request(app.getHttpServer())
      .post(`/api/invitations/${teacherInvRes.body.token}/accept`)
      .send({
        fullName: 'Teacher Anvar',
        password: 'teacherPassword123',
      })
      .expect(201);

    teacherAToken = teacherAcceptRes.body.accessToken;
    teacherAUserId = teacherAcceptRes.body.user.id;

    // Create Teacher record in Tenant A linked to teacher user
    const teacherARec = await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Teacher Anvar',
        userId: teacherAUserId,
        subject: 'Mathematics',
        phone: '+998901112233',
      })
      .expect(201);
    teacherAId = teacherARec.body.id;

    // 4. Create Teacher in Tenant B
    const teacherBRec = await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        fullName: 'Teacher Bobur',
        subject: 'English',
        phone: '+998902223344',
      })
      .expect(201);
    teacherBId = teacherBRec.body.id;

    // 5. Create Subject & Course in Tenant A
    const subjectARes = await request(app.getHttpServer())
      .post('/api/subjects')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: `Matematika ${suffix}`,
        color: '#4F46E5',
      })
      .expect(201);

    const courseARes = await request(app.getHttpServer())
      .post('/api/subjects/courses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: `SAT Math ${suffix}`,
        subjectId: subjectARes.body.id,
        durationMonths: 6,
        price: '800000',
      })
      .expect(201);
    courseAId = courseARes.body.id;

    // 6. Create Groups in Tenant A
    const groupARes = await request(app.getHttpServer())
      .post('/api/groups')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: `Group Alpha ${suffix}`,
        subject: 'Mathematics',
        courseId: courseAId,
        teacherId: teacherAId,
        monthlyPrice: 800000,
      })
      .expect(201);
    groupAId = groupARes.body.id;

    const groupA2Res = await request(app.getHttpServer())
      .post('/api/groups')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: `Group Beta ${suffix}`,
        subject: 'Mathematics',
        courseId: courseAId,
        monthlyPrice: 800000,
      })
      .expect(201);
    groupA2Id = groupA2Res.body.id;

    // 7. Create Group in Tenant B
    const groupBRes = await request(app.getHttpServer())
      .post('/api/groups')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        name: `Group Gamma ${suffix}`,
        subject: 'English',
        teacherId: teacherBId,
        monthlyPrice: 600000,
      })
      .expect(201);
    groupBId = groupBRes.body.id;

    // 8. Create Students in Tenant A
    const studentARes = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Rustam Aliyev',
        phone: '+998903334455',
        gender: 'MALE',
      })
      .expect(201);
    studentAId = studentARes.body.id;

    const studentA2Res = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Malika Karimova',
        phone: '+998904445566',
        gender: 'FEMALE',
      })
      .expect(201);
    studentA2Id = studentA2Res.body.id;

    // 9. Create Student in Tenant B
    const studentBRes = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        fullName: 'Jasur Saidov',
        phone: '+998905556677',
        gender: 'MALE',
      })
      .expect(201);
    studentBId = studentBRes.body.id;

    // 10. Invite & Register Parent in Tenant A
    const parentInvRes = await request(app.getHttpServer())
      .post('/api/invitations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        email: `parent-edu-${suffix}@test.uz`,
        role: 'PARENT',
      })
      .expect(201);

    const parentAcceptRes = await request(app.getHttpServer())
      .post(`/api/invitations/${parentInvRes.body.token}/accept`)
      .send({
        fullName: 'Ziyoda Aliyeva (Ona)',
        password: 'parentPassword123',
      })
      .expect(201);

    parentToken = parentAcceptRes.body.accessToken;
    parentUserId = parentAcceptRes.body.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ==========================================
  // Test 1 — Tenant A cannot access Tenant B student
  // ==========================================
  it('1. Tenant A cannot access Tenant B student', async () => {
    await request(app.getHttpServer())
      .get(`/api/students/${studentBId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  // ==========================================
  // Test 2 — Tenant A cannot access Tenant B teacher
  // ==========================================
  it('2. Tenant A cannot access Tenant B teacher', async () => {
    await request(app.getHttpServer())
      .get(`/api/teachers/${teacherBId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  // ==========================================
  // Test 3 — Tenant A cannot access Tenant B group
  // ==========================================
  it('3. Tenant A cannot access Tenant B group', async () => {
    await request(app.getHttpServer())
      .get(`/api/groups/${groupBId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  // ==========================================
  // Test 4 — Parent can only access linked child
  // ==========================================
  it('4. Parent can only access linked child', async () => {
    // Link parent to studentA
    await request(app.getHttpServer())
      .post(`/api/students/${studentAId}/guardians`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        userId: parentUserId,
        relationship: 'Ona',
        isPrimary: true,
      })
      .expect(201);

    // Parent queries their children
    const myStudentsRes = await request(app.getHttpServer())
      .get('/api/portal/parent/students')
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);

    expect(Array.isArray(myStudentsRes.body)).toBe(true);
    expect(myStudentsRes.body.some((s: any) => s.id === studentAId)).toBe(true);
    expect(myStudentsRes.body.some((s: any) => s.id === studentA2Id)).toBe(false);

    // Parent can view linked student A overview
    await request(app.getHttpServer())
      .get(`/api/portal/parent/students/${studentAId}/overview`)
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);

    // Parent CANNOT access unlinked student A2 (403 Forbidden)
    await request(app.getHttpServer())
      .get(`/api/portal/parent/students/${studentA2Id}/overview`)
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(403);

    // Parent CANNOT access cross-tenant student B (403 Forbidden)
    await request(app.getHttpServer())
      .get(`/api/portal/parent/students/${studentBId}/overview`)
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(403);
  });

  // ==========================================
  // Test 5 — Teacher can access assigned group according to RBAC
  // ==========================================
  it('5. Teacher can access assigned group according to RBAC', async () => {
    // Teacher A is assigned to groupAId -> 200 OK
    const assignedRes = await request(app.getHttpServer())
      .get(`/api/groups/${groupAId}`)
      .set('Authorization', `Bearer ${teacherAToken}`)
      .expect(200);
    expect(assignedRes.body.id).toBe(groupAId);

    // Teacher A is NOT assigned to groupA2Id -> 403 Forbidden
    await request(app.getHttpServer())
      .get(`/api/groups/${groupA2Id}`)
      .set('Authorization', `Bearer ${teacherAToken}`)
      .expect(403);
  });

  // ==========================================
  // Test 6 — Student can enroll in a group
  // ==========================================
  it('6. Student can enroll in a group', async () => {
    const enrollRes = await request(app.getHttpServer())
      .post(`/api/students/${studentAId}/enroll/${groupAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    expect(enrollRes.body.success).toBe(true);

    const studentRes = await request(app.getHttpServer())
      .get(`/api/students/${studentAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const activeEnrolls = studentRes.body.enrollments.filter(
      (e: any) => e.groupId === groupAId && e.status === 'ACTIVE',
    );
    expect(activeEnrolls.length).toBe(1);
  });

  // ==========================================
  // Test 7 — Duplicate active enrollment is rejected
  // ==========================================
  it('7. Duplicate active enrollment is rejected', async () => {
    await request(app.getHttpServer())
      .post(`/api/students/${studentAId}/enroll/${groupAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(400);
  });

  // ==========================================
  // Test 8 — Leaving a group preserves history
  // ==========================================
  it('8. Leaving a group preserves history', async () => {
    const unenrollRes = await request(app.getHttpServer())
      .delete(`/api/students/${studentAId}/enroll/${groupAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(unenrollRes.body.success).toBe(true);
    expect(unenrollRes.body.enrollment.status).toBe('CANCELLED');
    expect(unenrollRes.body.enrollment.leftAt).toBeDefined();

    // Verify record is preserved in database
    const studentRes = await request(app.getHttpServer())
      .get(`/api/students/${studentAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const cancelledEnroll = studentRes.body.enrollments.find(
      (e: any) => e.groupId === groupAId && e.status === 'CANCELLED',
    );
    expect(cancelledEnroll).toBeDefined();
  });

  // ==========================================
  // Test 9 — Attendance can be created
  // ==========================================
  it('9. Attendance can be created', async () => {
    // Re-enroll studentA into groupA
    await request(app.getHttpServer())
      .post(`/api/students/${studentAId}/enroll/${groupAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    const markRes = await request(app.getHttpServer())
      .post('/api/attendance')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        groupId: groupAId,
        date: '2026-09-24',
        entries: [{ studentId: studentAId, status: 'PRESENT' }],
      })
      .expect(201);

    expect(markRes.body.length).toBe(1);
    expect(markRes.body[0].status).toBe('PRESENT');
  });

  // ==========================================
  // Test 10 — Duplicate attendance for same lesson/student is safely updated
  // ==========================================
  it('10. Duplicate attendance for same lesson/student is safely updated', async () => {
    const updateRes = await request(app.getHttpServer())
      .post('/api/attendance')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        groupId: groupAId,
        date: '2026-09-24',
        entries: [{ studentId: studentAId, status: 'LATE' }],
      })
      .expect(201);

    expect(updateRes.body.length).toBe(1);
    expect(updateRes.body[0].status).toBe('LATE');

    const listRes = await request(app.getHttpServer())
      .get(`/api/attendance?groupId=${groupAId}&date=2026-09-24`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].status).toBe('LATE');
  });

  // ==========================================
  // Test 11 — Cross-tenant attendance manipulation is rejected
  // ==========================================
  it('11. Cross-tenant attendance manipulation is rejected', async () => {
    // 1. Try marking attendance for cross-tenant student B in tenant A group
    await request(app.getHttpServer())
      .post('/api/attendance')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        groupId: groupAId,
        date: '2026-09-24',
        entries: [{ studentId: studentBId, status: 'PRESENT' }],
      })
      .expect(400);

    // 2. Try marking attendance in Tenant A for cross-tenant group B
    await request(app.getHttpServer())
      .post('/api/attendance')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        groupId: groupBId,
        date: '2026-09-24',
        entries: [{ studentId: studentAId, status: 'PRESENT' }],
      })
      .expect(404);
  });

  // ==========================================
  // Test 12 — Schedule belongs to correct tenant/group
  // ==========================================
  it('12. Schedule belongs to correct tenant/group', async () => {
    // Tenant A tries to schedule for cross-tenant group B -> 404
    await request(app.getHttpServer())
      .post('/api/schedule')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        groupId: groupBId,
        startTime: '10:00',
        endTime: '11:30',
        dayOfWeek: 1,
      })
      .expect(404);

    // Tenant A schedules for group A -> 201
    const scheduleRes = await request(app.getHttpServer())
      .post('/api/schedule')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        groupId: groupAId,
        teacherId: teacherAId,
        startTime: '14:00',
        endTime: '15:30',
        dayOfWeek: 1,
      })
      .expect(201);

    expect(scheduleRes.body.groupId).toBe(groupAId);
  });

  // ==========================================
  // Test 13 — Teacher scheduling conflict is handled
  // ==========================================
  it('13. Teacher scheduling conflict is handled if conflict detection exists', async () => {
    // Try scheduling Teacher A at an overlapping time on the same day (Monday 14:30 - 16:00 vs 14:00 - 15:30)
    const conflictRes = await request(app.getHttpServer())
      .post('/api/schedule')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        groupId: groupA2Id,
        teacherId: teacherAId,
        startTime: '14:30',
        endTime: '16:00',
        dayOfWeek: 1,
      })
      .expect(409);

    expect(conflictRes.body.conflicts).toBeDefined();
    expect(conflictRes.body.conflicts.some((c: any) => c.type === 'TEACHER')).toBe(true);
  });

  // ==========================================
  // Test 14 — Removing a group/student does not unexpectedly destroy historical records
  // ==========================================
  it('14. Removing a group/student does not unexpectedly destroy historical records', async () => {
    // 1. Soft-delete student A
    await request(app.getHttpServer())
      .delete(`/api/students/${studentAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    // Attendance records for student A must still exist in database
    const attRes = await request(app.getHttpServer())
      .get(`/api/attendance?studentId=${studentAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(attRes.body.length).toBeGreaterThan(0);

    // 2. Soft-delete group A
    await request(app.getHttpServer())
      .delete(`/api/groups/${groupAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    // Attendance records for group A must still exist in database
    const attGroupRes = await request(app.getHttpServer())
      .get(`/api/attendance?groupId=${groupAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(attGroupRes.body.length).toBeGreaterThan(0);
  });
});
