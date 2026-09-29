import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { AppModule } from '../src/app.module.js';
import { UPLOAD_DIR } from '../src/common/upload.util.js';

// The cabinet's past lessons (attendance, homework, results per lesson day)
// and signing in on a center's own subdomain.
describe('Portal past lessons and subdomain sign-in (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  const phone = `+99897${String(suffix).slice(-7)}`;
  const localDay = (offsetDays: number) => new Date(Date.now() + 5 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `Lessons ${suffix}`, subdomain: `lessons-${suffix}`, email: `lessons-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('shows past lessons with attendance and homework, and scopes sign-in to the subdomain', async () => {
    const kid = (await http().post('/api/students').set(auth()).send({ fullName: 'Lesson Kid', phone }).expect(201)).body.id as string;
    const group = (await http().post('/api/groups').set(auth())
      .send({ name: 'Every Day', subject: 'Ingliz tili', scheduleDays: 'Dushanba,Seshanba,Chorshanba,Payshanba,Juma,Shanba,Yakshanba', startTime: '09:00' })
      .expect(201)).body.id as string;
    await http().post(`/api/students/${kid}/enroll/${group}`).set(auth()).expect(201);
    const yesterday = localDay(-1);
    await http().post('/api/attendance').set(auth()).send({ groupId: group, date: yesterday, entries: [{ studentId: kid, status: 'LATE' }] }).expect(201);
    await http().post('/api/homework').set(auth()).send({ groupIds: [group], title: 'Workbook p.12', description: 'Ex. 1-3' }).expect(201);
    const { pin } = (await http().post(`/api/students/${kid}/portal-pin`).set(auth()).expect(201)).body;

    // Another center's subdomain does not know this phone; the own one does.
    await http().post('/api/portal/auth/phone/verify').send({ phone, pin, subdomain: `nope-${suffix}` }).expect(401);
    const session = (await http().post('/api/portal/auth/phone/verify').send({ phone, pin, subdomain: `lessons-${suffix}` }).expect(201)).body;
    const s = { Authorization: `Bearer ${session.accessToken}` };

    const res = (await http().get('/api/portal/lessons?days=7').set(s).expect(200)).body;
    const past = res.lessons.find((l: { date: string }) => l.date === yesterday);
    expect(past).toMatchObject({ groupName: 'Every Day', attendance: 'LATE' });
    const todays = res.lessons.find((l: { date: string }) => l.date === res.today);
    expect(todays.homework).toEqual([expect.objectContaining({ title: 'Workbook p.12', description: 'Ex. 1-3' })]);
  });

  it('lets the student hand in homework with a notebook photo and text', async () => {
    const p2 = `+99898${String(suffix).slice(-7)}`;
    const kid = (await http().post('/api/students').set(auth()).send({ fullName: 'Photo Kid', phone: p2 }).expect(201)).body.id as string;
    const group = (await http().post('/api/groups').set(auth()).send({ name: 'Photo G', subject: 'Math' }).expect(201)).body.id as string;
    const other = (await http().post('/api/groups').set(auth()).send({ name: 'Other G', subject: 'Math' }).expect(201)).body.id as string;
    await http().post(`/api/students/${kid}/enroll/${group}`).set(auth()).expect(201);
    await http().post('/api/homework').set(auth()).send({ groupIds: [group, other], title: 'Page 40', description: 'Solve 1-10' }).expect(201);
    const { pin } = (await http().post(`/api/students/${kid}/portal-pin`).set(auth()).expect(201)).body;
    const s = { Authorization: `Bearer ${(await http().post('/api/portal/auth/phone/verify').send({ phone: p2, pin }).expect(201)).body.accessToken}` };

    const list = (await http().get('/api/portal/homework').set(s).expect(200)).body;
    expect(list).toHaveLength(1);
    const hwId = list[0].id as string;
    expect(list[0].submission).toBeNull();

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
    await http().post(`/api/portal/homework/${hwId}/submit`).set(s)
      .field('text', 'Hammasi daftarda').attach('file', jpeg, { filename: 'daftar.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const after = (await http().get('/api/portal/homework').set(s).expect(200)).body[0];
    expect(after.completed).toBe(true);
    expect(after.submission).toMatchObject({ status: 'SUBMITTED', text: 'Hammasi daftarda', file: expect.stringMatching(/\.jpg$/) });
    expect(existsSync(join(UPLOAD_DIR, after.submission.file))).toBe(true);
    await unlink(join(UPLOAD_DIR, after.submission.file));

    // Text again keeps the photo; the other group's copy of the homework is not theirs.
    await http().post(`/api/portal/homework/${hwId}/submit`).set(s).send({ text: 'Tuzatdim' }).expect(201);
    const again = (await http().get('/api/portal/homework').set(s).expect(200)).body[0];
    expect(again.submission).toMatchObject({ text: 'Tuzatdim', file: after.submission.file });
    const staff = (await http().get(`/api/homework?groupId=${other}`).set(auth()).expect(200)).body;
    const otherHw = (Array.isArray(staff) ? staff : staff.items).find((h: { groupId: string }) => h.groupId === other);
    await http().post(`/api/portal/homework/${otherHw.id}/submit`).set(s).send({ text: 'x' }).expect(404);
  });

  it('keeps announcements read per student and hides teacher-only ones', async () => {
    const p3 = `+99899${String(suffix).slice(-7)}`;
    const kid = (await http().post('/api/students').set(auth()).send({ fullName: 'News Kid', phone: p3 }).expect(201)).body.id as string;
    const { pin } = (await http().post(`/api/students/${kid}/portal-pin`).set(auth()).expect(201)).body;
    const s = { Authorization: `Bearer ${(await http().post('/api/portal/auth/phone/verify').send({ phone: p3, pin }).expect(201)).body.accessToken}` };
    const a1 = (await http().post('/api/announcements').set(auth()).send({ title: 'Bayram', content: 'Dam olish kuni', targetAudience: 'ALL' }).expect(201)).body;
    await http().post('/api/announcements').set(auth()).send({ title: 'Imtihon', content: 'Juma kuni', targetAudience: 'STUDENTS' }).expect(201);
    await http().post('/api/announcements').set(auth()).send({ title: 'Ustozlar yig\'ilishi', content: 'Faqat ustozlar', targetAudience: 'TEACHERS' }).expect(201);

    let list = (await http().get('/api/portal/announcements').set(s).expect(200)).body as Array<{ id: string; title: string; read: boolean }>;
    expect(list.map((a) => a.title).sort()).toEqual(['Bayram', 'Imtihon']);
    expect(list.every((a) => !a.read)).toBe(true);

    await http().post(`/api/portal/announcements/${a1.id}/read`).set(s).expect(201);
    list = (await http().get('/api/portal/announcements').set(s).expect(200)).body;
    expect(list.filter((a) => !a.read).map((a) => a.title)).toEqual(['Imtihon']);

    const all = (await http().post('/api/portal/announcements/read-all').set(s).expect(201)).body;
    expect(all.marked).toBe(2);
    list = (await http().get('/api/portal/announcements').set(s).expect(200)).body;
    expect(list.every((a) => a.read)).toBe(true);
    await http().post('/api/portal/announcements/unknown/read').set(s).expect(404);
  });
});
