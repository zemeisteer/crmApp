import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { auditLogs, enrollments, students, teachers } from '../src/db/schema.js';
import { WebhooksService } from '../src/webhooks/webhooks.service.js';

// Create forms carry an Idempotency-Key: a retry returns the first result
// and does nothing twice; the same key with other content is a conflict;
// a new key is a new record. Checked on the stored rows and side effects.
describe('Idempotent student and teacher creation (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let dispatch: ReturnType<typeof vi.spyOn>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let tokenA: string;
  let tenantA: string;
  let tokenB: string;
  let groupX: string;
  let groupY: string;
  let branchId: string;
  let n = 0;
  const key = (tag: string) => `idem-${tag}-${suffix}-${++n}`;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const register = async (tag: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `Idem ${tag} ${suffix}`, subdomain: `idem-${tag}-${suffix}`, email: `idem-${tag}-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body;
  const createStudent = (token: string, body: object, k?: string) => {
    const r = http().post('/api/students').set(auth(token));
    if (k) r.set('Idempotency-Key', k);
    return r.send(body);
  };
  const createTeacher = (token: string, body: object, k?: string) => {
    const r = http().post('/api/teachers').set(auth(token));
    if (k) r.set('Idempotency-Key', k);
    return r.send(body);
  };
  const studentsWithKey = (k: string) => db.select().from(students).where(and(eq(students.tenantId, tenantA), eq(students.idempotencyKey, k)));
  const teachersWithKey = (k: string) => db.select().from(teachers).where(and(eq(teachers.tenantId, tenantA), eq(teachers.idempotencyKey, k)));
  // Audit entries are written without being awaited by the request.
  const auditCount = async (entityId: string) => {
    let rows: unknown[] = [];
    for (let i = 0; i < 20; i++) {
      rows = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, entityId), eq(auditLogs.action, 'create')));
      if (rows.length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 300));
    return (await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, entityId), eq(auditLogs.action, 'create')))).length;
  };
  const webhookCalls = (id: string) => dispatch.mock.calls.filter((c) => c[1] === 'student.created' && (c[2] as { id: string }).id === id).length;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    dispatch = vi.spyOn(app.get(WebhooksService), 'dispatch');
    const a = await register('a');
    tokenA = a.accessToken;
    tenantA = a.tenant.id;
    tokenB = (await register('b')).accessToken;
    groupX = (await http().post('/api/groups').set(auth(tokenA)).send({ name: 'Idem X', subject: 'English', monthlyPrice: 100000, maxStudents: 30 }).expect(201)).body.id;
    groupY = (await http().post('/api/groups').set(auth(tokenA)).send({ name: 'Idem Y', subject: 'Math', monthlyPrice: 100000, maxStudents: 30 }).expect(201)).body.id;
    branchId = (await http().post('/api/branches').set(auth(tokenA)).send({ name: `Idem branch ${suffix}` }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('concurrent identical student creates with one key: one student, one enrollment, one audit entry, one webhook', async () => {
    const k = key('st');
    const body = { fullName: 'Idem Student', phone: '+998 90 111 00 01', groupIds: [groupX, groupY] };
    const results = await Promise.all([1, 2, 3].map(() => createStudent(tokenA, body, k)));
    for (const r of results) expect(r.status).toBe(201);
    const ids = new Set(results.map((r) => r.body.id));
    expect(ids.size).toBe(1);
    const [id] = [...ids];
    expect(results[0].body.idempotencyKey).toBeUndefined();
    expect(await studentsWithKey(k)).toHaveLength(1);
    const enr = await db.select().from(enrollments).where(eq(enrollments.studentId, id));
    expect(enr.map((e) => e.groupId).sort()).toEqual([groupX, groupY].sort());
    expect(await auditCount(id)).toBe(1);
    expect(webhookCalls(id)).toBe(1);
  });

  it('concurrent identical teacher creates with one key: one teacher, one audit entry', async () => {
    const k = key('te');
    const body = { fullName: 'Idem Teacher', subject: 'English', email: `idem-t-${suffix}@test.uz` };
    const results = await Promise.all([1, 2, 3].map(() => createTeacher(tokenA, body, k)));
    for (const r of results) expect(r.status).toBe(201);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    const rows = await teachersWithKey(k);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(body.email);
    expect(await auditCount(rows[0].id)).toBe(1);
  });

  it('the same key with a changed material field is a conflict, and nothing is stored', async () => {
    const k = key('st-c');
    const base = { fullName: 'Idem Changed', phone: '+998 90 111 00 02', groupIds: [groupX] };
    const first = await createStudent(tokenA, base, k).expect(201);
    for (const changed of [
      { ...base, groupIds: [groupY] },
      { ...base, branchId },
      { ...base, birthDate: '2010-05-01' },
      { ...base, parentPhone: '+998 90 111 00 09' },
      { ...base, notes: 'something else' },
    ]) {
      await createStudent(tokenA, changed, k).expect(409);
    }
    const rows = await studentsWithKey(k);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.body.id);
    expect(rows[0].branchId).toBeNull();
    const enr = await db.select().from(enrollments).where(eq(enrollments.studentId, first.body.id));
    expect(enr.map((e) => e.groupId)).toEqual([groupX]);

    const tk = key('te-c');
    const tbase = { fullName: 'Idem T Changed', subject: 'English', email: `idem-tc-${suffix}@test.uz` };
    await createTeacher(tokenA, tbase, tk).expect(201);
    await createTeacher(tokenA, { ...tbase, email: `other-${suffix}@test.uz` }, tk).expect(409);
    await createTeacher(tokenA, { ...tbase, subject: 'Math' }, tk).expect(409);
    await createTeacher(tokenA, { ...tbase, salaryValue: 1000000, salaryType: 'FIXED' }, tk).expect(409);
    expect(await teachersWithKey(tk)).toHaveLength(1);
  });

  it('group order, blank strings and omitted fields are normalized; stored phones are null, not empty', async () => {
    const k = key('st-n');
    const first = await createStudent(tokenA, { fullName: 'Idem Norm', phone: '', parentPhone: '  ', groupIds: [groupY, groupX, groupX] }, k).expect(201);
    const again = await createStudent(tokenA, { fullName: 'Idem Norm ', groupIds: [groupX, groupY] }, k).expect(201);
    expect(again.body.id).toBe(first.body.id);
    const [row] = await studentsWithKey(k);
    expect([row.phone, row.parentPhone]).toEqual([null, null]);
  });

  it('a new key is a new record - two people with the same name and no phone are not merged', async () => {
    const body = { fullName: 'Idem Twin' };
    const one = await createStudent(tokenA, body, key('tw')).expect(201);
    const two = await createStudent(tokenA, body, key('tw')).expect(201);
    expect(one.body.id).not.toBe(two.body.id);
    // Without a key (older clients): an ordinary create every time.
    const three = await createStudent(tokenA, body).expect(201);
    const four = await createStudent(tokenA, body).expect(201);
    expect(new Set([one.body.id, two.body.id, three.body.id, four.body.id]).size).toBe(4);
    const t1 = await createTeacher(tokenA, { fullName: 'Idem Twin T' }, key('twt')).expect(201);
    const t2 = await createTeacher(tokenA, { fullName: 'Idem Twin T' }, key('twt')).expect(201);
    expect(t1.body.id).not.toBe(t2.body.id);
  });

  it('a key is scoped to its center and to its operation', async () => {
    const k = key('scope');
    const a = await createStudent(tokenA, { fullName: 'Idem Scope' }, k).expect(201);
    const b = await createStudent(tokenB, { fullName: 'Idem Scope' }, k).expect(201);
    expect(a.body.id).not.toBe(b.body.id);
    expect(a.body.tenantId).not.toBe(b.body.tenantId);
    // A different payload in the other center is not a conflict either.
    await createStudent(tokenB, { fullName: 'Idem Scope other' }, key('scope-b')).expect(201);
    const t = await createTeacher(tokenA, { fullName: 'Idem Scope' }, k).expect(201);
    expect((await teachersWithKey(k))[0].id).toBe(t.body.id);
  });

  it('a retry after the reply was lost returns the first student and does nothing again', async () => {
    const k = key('lost');
    const body = { fullName: 'Idem Lost', groupIds: [groupX] };
    // The first reply never reaches the browser - only the server saw it.
    await createStudent(tokenA, body, k);
    const [stored] = await studentsWithKey(k);
    const retry = await createStudent(tokenA, body, k).expect(201);
    expect(retry.body.id).toBe(stored.id);
    expect(await studentsWithKey(k)).toHaveLength(1);
    expect(await db.select().from(enrollments).where(eq(enrollments.studentId, stored.id))).toHaveLength(1);
    expect(await auditCount(stored.id)).toBe(1);
    expect(webhookCalls(stored.id)).toBe(1);
  });

  it('a failed create stores no key; the retry after the cause is fixed succeeds once', async () => {
    const small = (await http().post('/api/groups').set(auth(tokenA)).send({ name: 'Idem Small', subject: 'Art', monthlyPrice: 100000, maxStudents: 1 }).expect(201)).body.id;
    await createStudent(tokenA, { fullName: 'Idem Seat', groupIds: [small] }, key('seat')).expect(201);
    const k = key('fail');
    const body = { fullName: 'Idem Full', groupIds: [small] };
    const failed = await createStudent(tokenA, body, k);
    expect(failed.status).toBe(409);
    expect(await studentsWithKey(k)).toHaveLength(0);
    await http().patch(`/api/groups/${small}`).set(auth(tokenA)).send({ maxStudents: 5 }).expect(200);
    const ok = await createStudent(tokenA, body, k).expect(201);
    const again = await createStudent(tokenA, body, k).expect(201);
    expect(again.body.id).toBe(ok.body.id);
    expect(await studentsWithKey(k)).toHaveLength(1);
    expect(await db.select().from(enrollments).where(eq(enrollments.studentId, ok.body.id))).toHaveLength(1);
    expect(await auditCount(ok.body.id)).toBe(1);
    expect(webhookCalls(ok.body.id)).toBe(1);
  });

  it('rejects a malformed key', async () => {
    await createStudent(tokenA, { fullName: 'Idem Bad Key' }, 'short').expect(400);
  });
});
