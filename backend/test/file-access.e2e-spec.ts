import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { FilesService } from '../src/files/files.service.js';

// Uploaded files are readable only by people allowed to see the record they
// belong to: public kinds (logo, site pictures) by name, everything else
// through a short-lived signed link handed out after that check.
describe('Private file access (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PDF = Buffer.from('%PDF-1.4\n% private homework\n');
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const MP3 = Buffer.from('494433030000000000', 'hex');

  let ownerA: string, t1: string, t2: string, recA: string, recAId: string, ownerB: string;
  let s1Cab: string, s2Cab: string, parentS1Cab: string;
  let hwFile: string, examFile: string, logoFile: string, subFile: string, assetFile: string, hwBFile: string;

  const register = async (key: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `Files ${key} ${suffix}`, subdomain: `files-${key}-${suffix}`, email: `files-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` })
      .expect(201)).body;
  const invite = async (owner: string, role: string, local: string) => {
    const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `files-${local}-${suffix}@test.uz`, role }).expect(201)).body;
    const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `${role} ${local}`, password: 'password12345' }).expect(201)).body;
    return { token: acc.accessToken as string, userId: acc.user.id as string };
  };
  const cabinet = async (owner: string, studentId: string, phone: string) => {
    const { pin } = (await http().post(`/api/students/${studentId}/portal-pin`).set(bearer(owner)).expect(201)).body;
    return (await http().post('/api/portal/auth/phone/verify').send({ phone, pin }).expect(201)).body.accessToken as string;
  };
  const sign = async (auth: Record<string, string> | null, names: string[], portal = false) => {
    const req = http().post(portal ? '/api/portal/files/sign' : '/api/files/sign');
    if (auth) req.set(auth);
    return req.send({ names });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();

    ownerA = (await register('a')).accessToken;
    const invT1 = await invite(ownerA, 'TEACHER', 't1'); t1 = invT1.token;
    const invT2 = await invite(ownerA, 'TEACHER', 't2'); t2 = invT2.token;
    const rec = await invite(ownerA, 'RECEPTIONIST', 'rec'); recA = rec.token; recAId = rec.userId;
    const tch1 = (await http().post('/api/teachers').set(bearer(ownerA)).send({ fullName: 'T1', userId: invT1.userId, subject: 'Math' }).expect(201)).body.id;
    const tch2 = (await http().post('/api/teachers').set(bearer(ownerA)).send({ fullName: 'T2', userId: invT2.userId, subject: 'Math' }).expect(201)).body.id;
    const g1 = (await http().post('/api/groups').set(bearer(ownerA)).send({ name: 'G1', subject: 'Math', teacherId: tch1, scheduleDays: 'Dushanba', startTime: '10:00', endTime: '11:00' }).expect(201)).body.id;
    const g2 = (await http().post('/api/groups').set(bearer(ownerA)).send({ name: 'G2', subject: 'Math', teacherId: tch2, scheduleDays: 'Seshanba', startTime: '12:00', endTime: '13:00' }).expect(201)).body.id;
    const s1 = (await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'File One', phone: '+998901230001', parentPhone: '+998901230091', groupIds: [g1] }).expect(201)).body.id;
    const s2 = (await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'File Two', phone: '+998901230002', groupIds: [g2] }).expect(201)).body.id;
    s1Cab = await cabinet(ownerA, s1, '+998901230001');
    parentS1Cab = (await http().post('/api/portal/auth/phone/verify').send({ phone: '+998901230091', pin: (await http().post(`/api/students/${s1}/portal-pin`).set(bearer(ownerA)).expect(201)).body.pin }).expect(201)).body.accessToken;
    s1Cab = await cabinet(ownerA, s1, '+998901230001'); // the new PIN above signed the old cabinet out
    s2Cab = await cabinet(ownerA, s2, '+998901230002');

    const hw1 = (await http().post('/api/homework').set(bearer(ownerA)).send({ groupIds: [g1], title: 'HW1', description: 'x' }).expect(201)).body[0].id;
    hwFile = (await http().post(`/api/homework/${hw1}/attachment`).set(bearer(ownerA)).attach('file', PDF, { filename: 'task.pdf', contentType: 'application/pdf' }).expect(201)).body.attachmentPath;
    const exam1 = (await http().post('/api/exams').set(bearer(ownerA)).send({ groupIds: [g1], title: 'Exam1', maxScore: 100 }).expect(201)).body[0].id;
    examFile = (await http().post(`/api/exams/${exam1}/material`).set(bearer(ownerA)).attach('file', PDF, { filename: 'key.pdf', contentType: 'application/pdf' }).expect(201)).body.materialPath;
    logoFile = (await http().post('/api/tenants/me/logo').set(bearer(ownerA)).attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' }).expect(201)).body.logoUrl;
    await http().post(`/api/portal/homework/${hw1}/submit`).set(bearer(s1Cab)).attach('file', PDF, { filename: 'answer.pdf', contentType: 'application/pdf' }).expect(201);
    subFile = (await http().get('/api/portal/homework').set(bearer(s1Cab)).expect(200)).body.find((h: { id: string }) => h.id === hw1).submission.file;
    const mock = (await http().post('/api/mock-tests').set(bearer(ownerA)).send({ title: 'Draft mock' }).expect(201)).body.id;
    assetFile = (await http().post(`/api/mock-tests/${mock}/asset`).set(bearer(ownerA)).attach('file', MP3, { filename: 'part1.mp3', contentType: 'audio/mpeg' }).expect(201)).body.path;

    ownerB = (await register('b')).accessToken;
    const tchB = (await http().post('/api/teachers').set(bearer(ownerB)).send({ fullName: 'TB', subject: 'Math' }).expect(201)).body.id;
    const gB = (await http().post('/api/groups').set(bearer(ownerB)).send({ name: 'GB', subject: 'Math', teacherId: tchB, scheduleDays: 'Dushanba', startTime: '10:00', endTime: '11:00' }).expect(201)).body.id;
    const hwB = (await http().post('/api/homework').set(bearer(ownerB)).send({ groupIds: [gB], title: 'HWB', description: 'x' }).expect(201)).body[0].id;
    hwBFile = (await http().post(`/api/homework/${hwB}/attachment`).set(bearer(ownerB)).attach('file', PDF, { filename: 'b.pdf', contentType: 'application/pdf' }).expect(201)).body.attachmentPath;
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  it('stored names look like generated names', () => {
    for (const n of [hwFile, examFile, logoFile, subFile, assetFile, hwBFile]) expect(n).toMatch(/^[a-z0-9]{20,}\.(pdf|png|mp3)$/);
  });

  it('the old public route serves only public files', async () => {
    await http().get(`/uploads/${logoFile}`).expect(200);
    for (const n of [hwFile, examFile, subFile, assetFile, hwBFile]) await http().get(`/uploads/${n}`).expect(404);
    await http().get('/uploads/..%2f..%2fpackage.json').expect(404);
  });

  it('anonymous callers cannot sign', async () => {
    expect((await sign(null, [hwFile])).status).toBe(401);
    expect((await sign(null, [hwFile], true)).status).toBe(401);
  });

  it('the owner gets links for every file of the center, and the link returns the bytes', async () => {
    const res = (await sign(bearer(ownerA), [hwFile, examFile, logoFile, subFile, assetFile]).then((r) => r.body)) as Record<string, string>;
    expect(Object.keys(res).sort()).toEqual([hwFile, examFile, logoFile, subFile, assetFile].sort());
    expect(res[logoFile]).toBe(`/uploads/${logoFile}`);
    const got = await http().get(res[hwFile]).expect(200);
    expect(Buffer.from(got.body).toString()).toContain('private homework');
    expect(got.headers['cache-control']).toMatch(/^private/);
    expect(got.headers['x-content-type-options']).toBe('nosniff');
  });

  it("the group's teacher gets homework/exam files; an unassigned teacher gets none", async () => {
    const mine = (await sign(bearer(t1), [hwFile, examFile, subFile])).body;
    expect(Object.keys(mine).sort()).toEqual([hwFile, examFile, subFile].sort());
    const other = (await sign(bearer(t2), [hwFile, examFile, subFile])).body;
    expect(other).toEqual({});
  });

  it("a receptionist gets what their access list lets them see: homework and exams by default, not mock tests", async () => {
    const res = (await sign(bearer(recA), [hwFile, examFile, assetFile, logoFile])).body;
    expect(Object.keys(res).sort()).toEqual([hwFile, examFile, logoFile].sort());
    // The owner takes homework and exams off this receptionist's list: the files go with them.
    await http().patch(`/api/staff/${recAId}`).set(bearer(ownerA)).send({ access: ['students.view'] }).expect(200);
    const after = (await sign(bearer(recA), [hwFile, examFile, assetFile, logoFile])).body;
    expect(Object.keys(after)).toEqual([logoFile]);
    await http().patch(`/api/staff/${recAId}`).set(bearer(ownerA)).send({ access: null }).expect(200);
  });

  it("another center's owner gets nothing, either way round", async () => {
    expect((await sign(bearer(ownerB), [hwFile, examFile, subFile, assetFile])).body).toEqual({});
    expect((await sign(bearer(ownerA), [hwBFile])).body).toEqual({});
  });

  it("a cabinet gets its own group's homework and its own submission, not exam keys or draft tests", async () => {
    const own = (await sign(bearer(s1Cab), [hwFile, subFile, examFile, assetFile], true)).body;
    expect(Object.keys(own).sort()).toEqual([hwFile, subFile].sort());
    // A parent viewing that student sees the same.
    const parent = (await sign(bearer(parentS1Cab), [hwFile, subFile], true)).body;
    expect(Object.keys(parent).sort()).toEqual([hwFile, subFile].sort());
  });

  it("another student's cabinet gets nothing of it", async () => {
    expect((await sign(bearer(s2Cab), [hwFile, subFile, examFile, assetFile], true)).body).toEqual({});
  });

  it('a staff token cannot use the cabinet route and a cabinet token cannot use the staff route', async () => {
    expect((await sign(bearer(ownerA), [hwFile], true)).status).toBe(401);
    expect((await sign(bearer(s1Cab), [hwFile])).status).toBe(403);
  });

  it('a tampered, foreign or expired link is refused', async () => {
    const link: string = (await sign(bearer(ownerA), [hwFile])).body[hwFile];
    await http().get(link.replace(/s=.{4}/, 's=AAAA')).expect(403);
    await http().get(link.replace(hwFile, examFile)).expect(403); // a link is for one file only
    await http().get(`/api/files/${hwFile}`).expect(403);
    const files = app.get(FilesService);
    const old = files.signedPath(hwFile, Date.now() - 40 * 60_000); // signed 40 minutes ago (TTL 30)
    await http().get(old).expect(403);
  });

  it('replacing a homework file takes the old one out of reach', async () => {
    const hw = (await http().get('/api/homework').set(bearer(ownerA)).expect(200)).body.find((h: { attachmentPath?: string }) => h.attachmentPath === hwFile);
    const next = (await http().post(`/api/homework/${hw.id}/attachment`).set(bearer(ownerA)).attach('file', PDF, { filename: 'v2.pdf', contentType: 'application/pdf' }).expect(201)).body.attachmentPath;
    const res = (await sign(bearer(ownerA), [hwFile, next])).body;
    expect(Object.keys(res)).toEqual([next]);
  });
});
