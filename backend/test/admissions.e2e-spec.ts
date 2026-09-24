import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { LeadsService } from '../src/leads/leads.service.js';
import { AdmissionsEventsService, type AdmissionsEvent } from '../src/leads/admissions-events.service.js';

// Admissions & Sales CRM — the 25 mandatory cases from the sprint spec.
// Every run registers fresh tenants, so phone numbers can be fixed literals:
// duplicate detection is scoped per tenant.
describe('Admissions & Sales CRM Suite (e2e)', () => {
  let app: INestApplication<App>;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());

  let tokenA: string;
  let tenantAId: string;
  let tokenB: string;
  let ownerBUserId: string;
  let tokenC: string;

  let managerToken: string;
  let managerUserId: string;
  let receptionistToken: string;
  let accountantToken: string;
  let accountantUserId: string;

  let subjectAId: string;
  let courseAId: string;
  let teacherAId: string;
  let groupA1Id: string;
  let groupA2Id: string;
  let groupFullId: string;
  let groupBId: string;

  let lead1Id: string; // created in case 1, used through 7/9/11
  let trialLeadId: string; // cases 13, 15, 17, 18
  let trialId: string;

  const events: AdmissionsEvent[] = [];

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function register(tag: string) {
    const res = await http()
      .post('/api/auth/register')
      .send({
        centerName: `Adm ${tag} ${suffix}`,
        subdomain: `adm-${tag}-${suffix}`,
        email: `adm-${tag}-${suffix}@test.uz`,
        password: 'password123',
        fullName: `Owner ${tag.toUpperCase()}`,
      })
      .expect(201);
    return res.body;
  }

  async function invite(ownerToken: string, role: string, tag: string) {
    const inv = await http().post('/api/invitations').set(auth(ownerToken))
      .send({ email: `${tag}-${suffix}@test.uz`, role }).expect(201);
    const acc = await http().post(`/api/invitations/${inv.body.token}/accept`)
      .send({ fullName: `${role} ${tag}`, password: 'password12345' }).expect(201);
    return { token: acc.body.accessToken as string, userId: acc.body.user.id as string };
  }

  function createLead(token: string, body: Record<string, unknown>) {
    return http().post('/api/leads').set(auth(token)).send(body);
  }

  async function move(token: string, id: string, toStatus: string) {
    return http().post(`/api/leads/${id}/transition`).set(auth(token)).send({ toStatus }).expect(201);
  }

  async function qualifiedLead(fullName: string, phone: string) {
    const res = await createLead(tokenA, { fullName, phone, source: 'WALK_IN' }).expect(201);
    await move(tokenA, res.body.id, 'CONTACTED');
    await move(tokenA, res.body.id, 'QUALIFIED');
    return res.body.id as string;
  }

  async function waitForAudit(token: string, action: string, entityId: string) {
    for (let i = 0; i < 20; i++) {
      const res = await http().get('/api/audit-logs?entityType=lead').set(auth(token)).expect(200);
      if (res.body.some((a: { action: string; entityId: string }) => a.action === action && a.entityId === entityId)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  // Next date (>= 7 days ahead) as a Tashkent calendar day, plus its ISO weekday.
  function futureTashkentDay(daysAhead: number) {
    const d = new Date(Date.now() + daysAhead * 24 * 3600_000 + 5 * 3600_000);
    const date = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    return { date, dow };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    app.get(AdmissionsEventsService).on('*', (e) => events.push(e));

    const a = await register('a');
    tokenA = a.accessToken;
    tenantAId = a.tenant.id;
    const b = await register('b');
    tokenB = b.accessToken;
    ownerBUserId = b.user.id;
    const c = await register('c');
    tokenC = c.accessToken;

    ({ token: managerToken, userId: managerUserId } = await invite(tokenA, 'MANAGER', 'mgr'));
    ({ token: receptionistToken } = await invite(tokenA, 'RECEPTIONIST', 'rcp'));
    ({ token: accountantToken, userId: accountantUserId } = await invite(tokenA, 'ACCOUNTANT', 'acc'));

    const subject = await http().post('/api/subjects').set(auth(tokenA)).send({ name: `Ingliz tili ${suffix}` }).expect(201);
    subjectAId = subject.body.id;
    const course = await http().post('/api/subjects/courses').set(auth(tokenA))
      .send({ name: `IELTS ${suffix}`, subjectId: subjectAId, durationMonths: 6, price: '600000' }).expect(201);
    courseAId = course.body.id;
    const teacher = await http().post('/api/teachers').set(auth(tokenA))
      .send({ fullName: 'Teacher Admissions', subject: 'English', phone: '+998905550011' }).expect(201);
    teacherAId = teacher.body.id;

    const mkGroup = async (token: string, name: string, extra: Record<string, unknown> = {}) =>
      (await http().post('/api/groups').set(auth(token)).send({ name, subject: 'English', monthlyPrice: 500000, ...extra }).expect(201)).body.id as string;
    groupA1Id = await mkGroup(tokenA, 'A1 IELTS', { teacherId: teacherAId, courseId: courseAId, maxStudents: 20 });
    groupA2Id = await mkGroup(tokenA, 'A2 Speaking', { teacherId: teacherAId, maxStudents: 20 });
    groupFullId = await mkGroup(tokenA, 'A Full', { maxStudents: 1 });
    groupBId = await mkGroup(tokenB, 'B Group');

    // Fill the one-seat group so it is at capacity.
    await http().post('/api/students').set(auth(tokenA))
      .send({ fullName: 'Seat Holder', phone: '+998905550099', groupIds: [groupFullId] }).expect(201);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // 1
  it('1. creates a lead (NEW, normalized phone, timeline entry, LeadCreated event)', async () => {
    const res = await createLead(tokenA, {
      fullName: 'Aziza Karimova', phone: '+998 90 123 45 67', email: 'Aziza@Example.uz', source: 'INSTAGRAM',
      desiredSubjectId: subjectAId, desiredCourseId: courseAId,
    }).expect(201);
    lead1Id = res.body.id;
    expect(res.body.status).toBe('NEW');
    expect(res.body.phoneNormalized).toBe('+998901234567');
    expect(res.body.emailNormalized).toBe('aziza@example.uz');
    expect(res.body.tenantId).toBe(tenantAId);

    const timeline = await http().get(`/api/leads/${lead1Id}/timeline`).set(auth(tokenA)).expect(200);
    expect(timeline.body.some((a: { type: string; toStatus: string }) => a.type === 'STATUS_CHANGE' && a.toStatus === 'NEW')).toBe(true);
    expect(events.some((e) => e.name === 'LeadCreated' && e.leadId === lead1Id)).toBe(true);
  });

  // 2
  it('2. hides a lead from another tenant (404, absent from their list)', async () => {
    await http().get(`/api/leads/${lead1Id}`).set(auth(tokenB)).expect(404);
    await http().get(`/api/leads/${lead1Id}/timeline`).set(auth(tokenB)).expect(404);
    const list = await http().get('/api/leads?pageSize=100').set(auth(tokenB)).expect(200);
    expect(list.body.items.some((l: { id: string }) => l.id === lead1Id)).toBe(false);
  });

  // 3
  it('3. blocks cross-tenant updates and transitions without changing the lead', async () => {
    await http().patch(`/api/leads/${lead1Id}`).set(auth(tokenB)).send({ fullName: 'Hacked' }).expect(404);
    await http().post(`/api/leads/${lead1Id}/transition`).set(auth(tokenB)).send({ toStatus: 'CONTACTED' }).expect(404);
    await http().post(`/api/leads/${lead1Id}/follow-up`).set(auth(tokenB)).send({ followUpAt: new Date().toISOString() }).expect(404);
    const lead = await http().get(`/api/leads/${lead1Id}`).set(auth(tokenA)).expect(200);
    expect(lead.body.fullName).toBe('Aziza Karimova');
    expect(lead.body.status).toBe('NEW');
  });

  // 4
  it('4. blocks cross-tenant delete/archive; the lead stays active', async () => {
    await http().delete(`/api/leads/${lead1Id}`).set(auth(tokenB)).expect(404);
    await http().post(`/api/leads/${lead1Id}/archive`).set(auth(tokenB)).send({}).expect(404);
    const lead = await http().get(`/api/leads/${lead1Id}`).set(auth(tokenA)).expect(200);
    expect(lead.body.archivedAt).toBeNull();
  });

  // 5
  it('5. rejects a same-tenant duplicate in another phone format; override needs permission and is audited', async () => {
    const dup = await createLead(tokenA, { fullName: 'Aziza K.', phone: '90 123 45 67' }).expect(409);
    expect(dup.body.code).toBe('DUPLICATE_LEAD');
    expect(dup.body.duplicates[0].id).toBe(lead1Id);

    const byEmail = await createLead(tokenA, { fullName: 'Other', phone: '+998911110000', email: ' aziza@example.UZ ' }).expect(409);
    expect(byEmail.body.duplicates[0].matchedOn).toBe('email');

    await createLead(receptionistToken, { fullName: 'Sibling', phone: '998901234567', allowDuplicate: true, duplicateReason: 'sibling' }).expect(403);
    const override = await createLead(tokenA, { fullName: 'Sibling', phone: '998901234567', allowDuplicate: true, duplicateReason: 'Sibling shares parent phone' }).expect(201);
    expect(override.body.duplicateOfLeadId).toBe(lead1Id);
    expect(await waitForAudit(tokenA, 'duplicate_override', override.body.id)).toBe(true);
  });

  // 6
  it('6. allows the same phone in a different tenant', async () => {
    const res = await createLead(tokenB, { fullName: 'Aziza in B', phone: '+998901234567' }).expect(201);
    expect(res.body.tenantId).not.toBe(tenantAId);
    expect(res.body.duplicateOfLeadId).toBeNull();
  });

  // 7
  it('7. moves NEW -> CONTACTED and records the stage change in the timeline', async () => {
    const res = await move(tokenA, lead1Id, 'CONTACTED');
    expect(res.body.status).toBe('CONTACTED');
    const timeline = await http().get(`/api/leads/${lead1Id}/timeline`).set(auth(tokenA)).expect(200);
    const change = timeline.body.find((a: { fromStatus: string; toStatus: string }) => a.fromStatus === 'NEW' && a.toStatus === 'CONTACTED');
    expect(change).toBeDefined();
    expect(change.actor.id).toBeDefined();
  });

  // 8
  it('8. rejects an invalid transition and leaves the lead unchanged', async () => {
    const fresh = await createLead(tokenA, { fullName: 'Invalid Move', phone: '+998901000008' }).expect(201);
    const res = await http().post(`/api/leads/${fresh.body.id}/transition`).set(auth(tokenA)).send({ toStatus: 'QUALIFIED' }).expect(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
    // Status cannot be forced through the profile PATCH either.
    await http().patch(`/api/leads/${fresh.body.id}`).set(auth(tokenA)).send({ status: 'ENROLLED' }).expect(400);
    // Nor can ENROLLED be reached without the conversion flow.
    await http().post(`/api/leads/${fresh.body.id}/transition`).set(auth(tokenA)).send({ toStatus: 'ENROLLED' }).expect(400);
    const lead = await http().get(`/api/leads/${fresh.body.id}`).set(auth(tokenA)).expect(200);
    expect(lead.body.status).toBe('NEW');
  });

  // 9
  it('9. assigns a same-tenant manager (audited, LeadAssigned emitted)', async () => {
    const res = await http().post(`/api/leads/${lead1Id}/assign`).set(auth(tokenA)).send({ managerUserId }).expect(201);
    expect(res.body.assignedManagerUserId).toBe(managerUserId);
    expect(await waitForAudit(tokenA, 'assign', lead1Id)).toBe(true);
    expect(events.some((e) => e.name === 'LeadAssigned' && e.leadId === lead1Id)).toBe(true);
    const mine = await http().get('/api/leads?assignedManagerUserId=me').set(auth(managerToken)).expect(200);
    expect(mine.body.items.some((l: { id: string }) => l.id === lead1Id)).toBe(true);
  });

  // 10
  it('10. rejects assigning a user from another tenant or with a non-sales role', async () => {
    await http().post(`/api/leads/${lead1Id}/assign`).set(auth(tokenA)).send({ managerUserId: ownerBUserId }).expect(400);
    await http().post(`/api/leads/${lead1Id}/assign`).set(auth(tokenA)).send({ managerUserId: accountantUserId }).expect(400);
    await http().post(`/api/leads/${lead1Id}/assign`).set(auth(receptionistToken)).send({ managerUserId }).expect(403);
    const lead = await http().get(`/api/leads/${lead1Id}`).set(auth(tokenA)).expect(200);
    expect(lead.body.assignedManagerUserId).toBe(managerUserId);
  });

  // 11
  it('11. schedules a follow-up that appears in the upcoming queue', async () => {
    const at = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
    await http().post(`/api/leads/${lead1Id}/follow-up`).set(auth(managerToken)).send({ followUpAt: at, note: 'Call back' }).expect(201);
    const upcoming = await http().get('/api/leads?followUp=upcoming').set(auth(tokenA)).expect(200);
    expect(upcoming.body.items.some((l: { id: string }) => l.id === lead1Id)).toBe(true);
    const overdue = await http().get('/api/leads?followUp=overdue').set(auth(tokenA)).expect(200);
    expect(overdue.body.items.some((l: { id: string }) => l.id === lead1Id)).toBe(false);
    const summary = await http().get('/api/leads/follow-ups/summary?mine=true').set(auth(managerToken)).expect(200);
    expect(summary.body.upcoming).toBeGreaterThanOrEqual(1);
  });

  // 12
  it('12. surfaces an overdue follow-up and emits LeadFollowUpDue exactly once', async () => {
    const past = new Date(Date.now() - 2 * 3600_000).toISOString();
    await http().post(`/api/leads/${lead1Id}/follow-up`).set(auth(tokenA)).send({ followUpAt: past }).expect(201);
    const overdue = await http().get('/api/leads?followUp=overdue').set(auth(tokenA)).expect(200);
    expect(overdue.body.items.some((l: { id: string }) => l.id === lead1Id)).toBe(true);

    const leadsService = app.get(LeadsService);
    expect(await leadsService.scanDueFollowUps(new Date(), tenantAId)).toBeGreaterThanOrEqual(1);
    expect(events.filter((e) => e.name === 'LeadFollowUpDue' && e.leadId === lead1Id)).toHaveLength(1);
    await leadsService.scanDueFollowUps(new Date(), tenantAId);
    expect(events.filter((e) => e.name === 'LeadFollowUpDue' && e.leadId === lead1Id)).toHaveLength(1);
  });

  // 13
  it('13. books a trial lesson (CONTACTED -> TRIAL_BOOKED) and allows only one active booking', async () => {
    const lead = await createLead(tokenA, { fullName: 'Trial Student', phone: '+998901000013', desiredSubjectId: subjectAId }).expect(201);
    trialLeadId = lead.body.id;
    // Booking straight from NEW skips a stage and is rejected.
    const { date } = futureTashkentDay(8);
    await http().post(`/api/leads/${trialLeadId}/trials`).set(auth(tokenA)).send({ scheduledAt: `${date}T09:00:00+05:00`, groupId: groupA1Id }).expect(409);

    await move(tokenA, trialLeadId, 'CONTACTED');
    const trial = await http().post(`/api/leads/${trialLeadId}/trials`).set(auth(tokenA))
      .send({ scheduledAt: `${date}T09:00:00+05:00`, groupId: groupA1Id }).expect(201);
    trialId = trial.body.id;
    expect(trial.body.status).toBe('BOOKED');
    expect(trial.body.teacherId).toBe(teacherAId); // defaulted from the group
    expect(trial.body.courseId).toBe(courseAId);

    const l = await http().get(`/api/leads/${trialLeadId}`).set(auth(tokenA)).expect(200);
    expect(l.body.status).toBe('TRIAL_BOOKED');
    const again = await http().post(`/api/leads/${trialLeadId}/trials`).set(auth(tokenA))
      .send({ scheduledAt: `${date}T11:00:00+05:00` }).expect(409);
    expect(again.body.code).toBe('TRIAL_ALREADY_BOOKED');
    expect(events.some((e) => e.name === 'TrialBooked' && e.leadId === trialLeadId)).toBe(true);
  });

  // 14
  it('14. rejects a trial that clashes with the teacher\'s lesson (409) with no partial state', async () => {
    const { date, dow } = futureTashkentDay(9);
    await http().post('/api/schedule').set(auth(tokenA))
      .send({ groupId: groupA2Id, teacherId: teacherAId, dayOfWeek: dow, startTime: '14:00', endTime: '15:30' }).expect(201);

    const lead = await createLead(tokenA, { fullName: 'Conflict Lead', phone: '+998901000014' }).expect(201);
    await move(tokenA, lead.body.id, 'CONTACTED');

    const res = await http().post(`/api/leads/${lead.body.id}/trials`).set(auth(tokenA))
      .send({ scheduledAt: `${date}T14:30:00+05:00`, teacherId: teacherAId }).expect(409);
    expect(res.body.code).toBe('TRIAL_CONFLICT');
    expect(res.body.conflicts[0].type).toBe('TEACHER');
    const after = await http().get(`/api/leads/${lead.body.id}`).set(auth(tokenA)).expect(200);
    expect(after.body.status).toBe('CONTACTED');
    expect(after.body.trials).toHaveLength(0);

    // Sitting in on that same group's own lesson is not a conflict.
    await http().post(`/api/leads/${lead.body.id}/trials`).set(auth(tokenA))
      .send({ scheduledAt: `${date}T14:30:00+05:00`, groupId: groupA2Id }).expect(201);
  });

  // 15
  it('15. records trial attendance (TRIAL_BOOKED -> TRIAL_ATTENDED) without touching student attendance', async () => {
    const res = await http().post(`/api/leads/${trialLeadId}/trials/${trialId}/attend`).set(auth(tokenA)).send({ note: 'Liked it' }).expect(201);
    expect(res.body.status).toBe('ATTENDED');
    const l = await http().get(`/api/leads/${trialLeadId}`).set(auth(tokenA)).expect(200);
    expect(l.body.status).toBe('TRIAL_ATTENDED');
    await http().post(`/api/leads/${trialLeadId}/trials/${trialId}/attend`).set(auth(tokenA)).send({}).expect(409);
    // A cross-tenant caller cannot touch the trial.
    await http().post(`/api/leads/${trialLeadId}/trials/${trialId}/attend`).set(auth(tokenB)).send({}).expect(404);
  });

  // 16
  it('16. marks a lead LOST only with a valid reason; reopen is permissioned and audited', async () => {
    const lead = await createLead(tokenA, { fullName: 'Lost Lead', phone: '+998901000016' }).expect(201);
    const id = lead.body.id;
    await move(tokenA, id, 'CONTACTED');
    await http().post(`/api/leads/${id}/lose`).set(auth(tokenA)).send({}).expect(400);
    await http().post(`/api/leads/${id}/lose`).set(auth(tokenA)).send({ reason: 'OTHER' }).expect(400);
    const lost = await http().post(`/api/leads/${id}/lose`).set(auth(receptionistToken))
      .send({ reason: 'CHOSE_COMPETITOR', note: 'Went to a cheaper center' }).expect(201);
    expect(lost.body.status).toBe('LOST');
    expect(lost.body.lostReason).toBe('CHOSE_COMPETITOR');
    expect(lost.body.lostAt).toBeTruthy();

    const filtered = await http().get('/api/leads?lostReason=CHOSE_COMPETITOR').set(auth(tokenA)).expect(200);
    expect(filtered.body.items.map((l: { id: string }) => l.id)).toContain(id);

    await http().post(`/api/leads/${id}/reopen`).set(auth(receptionistToken)).send({ note: 'Came back' }).expect(403);
    const reopened = await http().post(`/api/leads/${id}/reopen`).set(auth(managerToken)).send({ note: 'Came back' }).expect(201);
    expect(reopened.body.status).toBe('CONTACTED');
    const timeline = await http().get(`/api/leads/${id}/timeline`).set(auth(tokenA)).expect(200);
    const types = timeline.body.map((a: { type: string }) => a.type);
    expect(types).toEqual(expect.arrayContaining(['LOST', 'REOPENED']));
    expect(await waitForAudit(tokenA, 'reopen', id)).toBe(true);
  });

  // 17
  it('17. converts a QUALIFIED lead into a student; the lead is kept as history', async () => {
    await http().post(`/api/leads/${trialLeadId}/convert`).set(auth(tokenA)).send({}).expect(409); // still TRIAL_ATTENDED
    await move(tokenA, trialLeadId, 'QUALIFIED');
    const res = await http().post(`/api/leads/${trialLeadId}/convert`).set(auth(managerToken))
      .send({ gender: 'FEMALE' }).expect(201);
    expect(res.body.alreadyConverted).toBe(false);
    expect(res.body.studentCreated).toBe(true);
    expect(res.body.lead.status).toBe('ENROLLED');
    expect(res.body.lead.convertedStudentId).toBe(res.body.student.id);
    expect(res.body.lead.convertedAt).toBeTruthy();

    const student = await http().get(`/api/students/${res.body.student.id}`).set(auth(tokenA)).expect(200);
    expect(student.body.fullName).toBe('Trial Student');
    expect(student.body.phone).toBe('+998901000013');
    const lead = await http().get(`/api/leads/${trialLeadId}`).set(auth(tokenA)).expect(200);
    expect(lead.body.convertedStudent.id).toBe(res.body.student.id);
    expect(events.some((e) => e.name === 'LeadConverted' && e.leadId === trialLeadId)).toBe(true);
    expect(await waitForAudit(tokenA, 'convert', trialLeadId)).toBe(true);
  });

  // 18
  it('18. a repeated conversion is idempotent (same student, nothing duplicated)', async () => {
    const first = await http().get(`/api/leads/${trialLeadId}`).set(auth(tokenA)).expect(200);
    const res = await http().post(`/api/leads/${trialLeadId}/convert`).set(auth(tokenA)).send({}).expect(201);
    expect(res.body.alreadyConverted).toBe(true);
    expect(res.body.student.id).toBe(first.body.convertedStudentId);
    const students = await http().get('/api/students').set(auth(tokenA)).expect(200);
    expect(students.body.filter((s: { fullName: string }) => s.fullName === 'Trial Student')).toHaveLength(1);
  });

  // 19
  it('19. concurrent conversions create exactly one student', async () => {
    const id = await qualifiedLead('Race Condition', '+998901000019');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => http().post(`/api/leads/${id}/convert`).set(auth(tokenA)).send({ groupIds: [groupA1Id] })),
    );
    for (const r of results) expect(r.status).toBe(201);
    expect(results.filter((r) => r.body.alreadyConverted === false)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.student.id)).size).toBe(1);

    const students = await http().get('/api/students').set(auth(tokenA)).expect(200);
    const created = students.body.filter((s: { fullName: string }) => s.fullName === 'Race Condition');
    expect(created).toHaveLength(1);
    expect(created[0].enrollments.filter((e: { groupId: string; status: string }) => e.groupId === groupA1Id && e.status === 'ACTIVE')).toHaveLength(1);
  });

  // 20
  it('20. links an exactly matching existing student instead of duplicating; ambiguity is refused', async () => {
    const existing = await http().post('/api/students').set(auth(tokenA))
      .send({ fullName: 'Existing Match', phone: '+998977777777', parentPhone: '+998977777700' }).expect(201);

    const id = await qualifiedLead('existing  match', '97 777 77 77');
    const match = await http().get(`/api/leads/${id}/student-match`).set(auth(tokenA)).expect(200);
    expect(match.body.candidates[0]).toMatchObject({ id: existing.body.id, exact: true });
    const res = await http().post(`/api/leads/${id}/convert`).set(auth(tokenA)).send({}).expect(201);
    expect(res.body.studentCreated).toBe(false);
    expect(res.body.student.id).toBe(existing.body.id);

    // A sibling applying with the parent's number: not an exact match -> 409.
    const sibling = await qualifiedLead('Sibling Of Existing', '+998977777700');
    const amb = await http().post(`/api/leads/${sibling}/convert`).set(auth(tokenA)).send({}).expect(409);
    expect(amb.body.code).toBe('STUDENT_MATCH_AMBIGUOUS');
    const created = await http().post(`/api/leads/${sibling}/convert`).set(auth(tokenA)).send({ studentResolution: 'CREATE_NEW' }).expect(201);
    expect(created.body.studentCreated).toBe(true);
    expect(created.body.student.id).not.toBe(existing.body.id);
  });

  // 21
  it('21. converts with enrollment and a first invoice via the billing service (no payment records)', async () => {
    const id = await qualifiedLead('Enroll And Bill', '+998901000021');
    const res = await http().post(`/api/leads/${id}/convert`).set(auth(tokenA))
      .send({ groupIds: [groupA1Id], createInvoice: true, invoiceForMonth: '2026-10', invoiceDueDate: '2026-10-10T00:00:00.000Z' })
      .expect(201);
    expect(res.body.enrollments).toHaveLength(1);
    expect(res.body.enrollments[0]).toMatchObject({ groupId: groupA1Id, status: 'ACTIVE', tenantId: tenantAId });
    expect(res.body.invoice).toMatchObject({ amount: 500000, status: 'OPEN', enrollmentId: res.body.enrollments[0].id });

    const invoices = await http().get(`/api/invoices?studentId=${res.body.student.id}`).set(auth(tokenA)).expect(200);
    expect(invoices.body).toHaveLength(1);
    const payments = await http().get('/api/payments').set(auth(tokenA)).expect(200);
    expect(payments.body.filter((p: { studentId: string }) => p.studentId === res.body.student.id)).toHaveLength(0);
  });

  // 22
  it('22. rejects a cross-tenant group during conversion with no partial state', async () => {
    const id = await qualifiedLead('Cross Tenant Group', '+998901000022');
    await http().post(`/api/leads/${id}/convert`).set(auth(tokenA)).send({ groupIds: [groupBId] }).expect(404);
    const lead = await http().get(`/api/leads/${id}`).set(auth(tokenA)).expect(200);
    expect(lead.body.status).toBe('QUALIFIED');
    expect(lead.body.convertedStudentId).toBeNull();
    const students = await http().get('/api/students').set(auth(tokenA)).expect(200);
    expect(students.body.some((s: { fullName: string }) => s.fullName === 'Cross Tenant Group')).toBe(false);
    const groupB = await http().get(`/api/groups/${groupBId}`).set(auth(tokenB)).expect(200);
    expect(groupB.body.enrollments).toHaveLength(0);
  });

  // 23
  it('23. rolls the whole conversion back when a later step fails (group full)', async () => {
    const before = await http().get(`/api/groups/${groupA1Id}`).set(auth(tokenA)).expect(200);
    const id = await qualifiedLead('Rollback Person', '+998901000023');
    const res = await http().post(`/api/leads/${id}/convert`).set(auth(tokenA))
      .send({ groupIds: [groupA1Id, groupFullId], createInvoice: true, invoiceForMonth: '2026-10', invoiceDueDate: '2026-10-10T00:00:00.000Z' })
      .expect(409);
    expect(res.body.code).toBe('GROUP_FULL');

    const lead = await http().get(`/api/leads/${id}`).set(auth(tokenA)).expect(200);
    expect(lead.body.status).toBe('QUALIFIED');
    const students = await http().get('/api/students').set(auth(tokenA)).expect(200);
    expect(students.body.some((s: { fullName: string }) => s.fullName === 'Rollback Person')).toBe(false);
    const after = await http().get(`/api/groups/${groupA1Id}`).set(auth(tokenA)).expect(200);
    expect(after.body.enrollments.length).toBe(before.body.enrollments.length);
    const timeline = await http().get(`/api/leads/${id}/timeline`).set(auth(tokenA)).expect(200);
    expect(timeline.body.some((a: { type: string }) => a.type === 'CONVERTED')).toBe(false);
  });

  // 24
  it('24. enforces the permission boundary (403) for non-admissions roles', async () => {
    await http().get('/api/leads').set(auth(accountantToken)).expect(403);
    await http().get(`/api/leads/${lead1Id}`).set(auth(accountantToken)).expect(403);
    await createLead(accountantToken, { fullName: 'Nope', phone: '+998901000024' }).expect(403);
    await http().post(`/api/leads/${lead1Id}/transition`).set(auth(accountantToken)).send({ toStatus: 'QUALIFIED' }).expect(403);

    // Receptionist: may create and work leads, but not convert, assign or archive.
    const r = await createLead(receptionistToken, { fullName: 'Front Desk Lead', phone: '+998901000124' }).expect(201);
    await http().post(`/api/leads/${r.body.id}/convert`).set(auth(receptionistToken)).send({}).expect(403);
    await http().post(`/api/leads/${r.body.id}/archive`).set(auth(receptionistToken)).send({}).expect(403);
    await http().get('/api/leads/analytics').set(auth(receptionistToken)).expect(403);
    await http().get('/api/leads/export').set(auth(receptionistToken)).expect(403);

    // Archiving is soft: the lead leaves the default list but stays readable.
    await http().post(`/api/leads/${r.body.id}/archive`).set(auth(managerToken)).send({ reason: 'test' }).expect(201);
    const list = await http().get('/api/leads?pageSize=100').set(auth(tokenA)).expect(200);
    expect(list.body.items.some((l: { id: string }) => l.id === r.body.id)).toBe(false);
    const archived = await http().get(`/api/leads/${r.body.id}`).set(auth(tokenA)).expect(200);
    expect(archived.body.archivedAt).toBeTruthy();
    await http().patch(`/api/leads/${r.body.id}`).set(auth(tokenA)).send({ fullName: 'x y' }).expect(409);
  });

  // 25
  it('25. funnel analytics count only the tenant\'s cohort, with safe zero denominators', async () => {
    // Tenant C: a small, fully known cohort.
    const mk = async (name: string, phone: string) => (await createLead(tokenC, { fullName: name, phone, source: 'TELEGRAM' }).expect(201)).body.id as string;
    await mk('C New', '+998901000251');
    const enrolled = await mk('C Enrolled', '+998901000252');
    await move(tokenC, enrolled, 'CONTACTED');
    await move(tokenC, enrolled, 'QUALIFIED');
    await http().post(`/api/leads/${enrolled}/convert`).set(auth(tokenC)).send({}).expect(201);
    const lost = await mk('C Lost', '+998901000253');
    await move(tokenC, lost, 'CONTACTED');
    await http().post(`/api/leads/${lost}/lose`).set(auth(tokenC)).send({ reason: 'TOO_EXPENSIVE' }).expect(201);
    const trial = await mk('C Trial', '+998901000254');
    await move(tokenC, trial, 'CONTACTED');
    const { date } = futureTashkentDay(10);
    const t = await http().post(`/api/leads/${trial}/trials`).set(auth(tokenC)).send({ scheduledAt: `${date}T10:00:00+05:00` }).expect(201);
    await http().post(`/api/leads/${trial}/trials/${t.body.id}/attend`).set(auth(tokenC)).send({}).expect(201);

    const from = new Date(suffix - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const res = await http().get(`/api/leads/analytics?from=${from}&to=${to}`).set(auth(tokenC)).expect(200);
    const c = res.body.cohort;
    expect(c.total).toBe(4);
    expect(c.reached).toMatchObject({ NEW: 4, CONTACTED: 3, TRIAL_BOOKED: 1, TRIAL_ATTENDED: 1, QUALIFIED: 1, ENROLLED: 1 });
    expect(c.lost).toBe(1);
    expect(c.rates.conversion).toEqual({ numerator: 1, denominator: 4, rate: 25 });
    expect(c.rates.trialAttended).toEqual({ numerator: 1, denominator: 1, rate: 100 });
    expect(c.lostReasons).toEqual([{ reason: 'TOO_EXPENSIVE', count: 1 }]);
    expect(c.bySource).toEqual([{ source: 'TELEGRAM', numerator: 1, denominator: 4, rate: 25 }]);
    expect(res.body.snapshot.byStatus).toMatchObject({ NEW: 1, ENROLLED: 1, LOST: 1, TRIAL_ATTENDED: 1 });
    expect(res.body.snapshot.total).toBe(4);

    // Tenant B's leads never leak into another tenant's numbers and vice versa.
    const b = await http().get(`/api/leads/analytics?from=${from}&to=${to}`).set(auth(tokenB)).expect(200);
    expect(b.body.cohort.total).toBe(1);

    // Empty window: every rate is null rather than a misleading 0%.
    const empty = await http().get('/api/leads/analytics?from=2000-01-01T00:00:00Z&to=2000-02-01T00:00:00Z').set(auth(tokenC)).expect(200);
    expect(empty.body.cohort.total).toBe(0);
    expect(empty.body.cohort.rates.conversion).toEqual({ numerator: 0, denominator: 0, rate: null });
    expect(empty.body.cohort.rates.trialBooked.rate).toBeNull();
  });
});
