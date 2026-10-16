import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// An event in a room holds it like a lesson does, both ways: an event does
// not land on a lesson, a make-up session or another event in that room, and
// a lesson planned or moved later does not land on the event. Online events
// and events at an outside place hold no room.
describe('Center events and room bookings (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  // Center-local calendar (Asia/Tashkent, UTC+5, no DST).
  const tashkent = (offsetDays: number) => new Date(Date.now() + 5 * 3_600_000 + offsetDays * 86_400_000);
  const dateOf = (d: Date) => d.toISOString().slice(0, 10);
  const dow = (d: Date) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());
  // The next date (from tomorrow) with ISO weekday `w`, plus `weeks` weeks.
  const next = (w: number, weeks = 0) => {
    for (let i = 1; i <= 7; i++) if (dow(tashkent(i)) === w) return dateOf(tashkent(i + weeks * 7));
    throw new Error('unreachable');
  };
  const last = (w: number) => {
    for (let i = 1; i <= 7; i++) if (dow(tashkent(-i)) === w) return dateOf(tashkent(-i));
    throw new Error('unreachable');
  };

  let owner: string, eventsOnly: string;
  let hall: string, studio: string, tch: string, tch2: string, group: string, other: string;

  const event = (over: Record<string, unknown> = {}) => ({
    title: 'Ota-onalar majlisi', kind: 'MEETING', format: 'OFFLINE', date: next(4, 1), startTime: '18:00', endTime: '19:00', audience: 'ALL', ...over,
  });
  const post = (body: Record<string, unknown>, token = owner) => http().post('/api/center-events').set(bearer(token)).send(body);
  const lesson = (body: Record<string, unknown>) => http().post('/api/schedule').set(bearer(owner)).send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `CER ${suffix}`, subdomain: `cer-${suffix}`, email: `cer-${suffix}@test.uz`, password: 'password123', fullName: 'Owner CER' })
      .expect(201)).body.accessToken;
    // A manager allowed to manage events but not to read the timetable.
    const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `cer-ev-${suffix}@test.uz`, role: 'MANAGER' }).expect(201)).body;
    const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: 'CER Events', password: 'password12345' }).expect(201)).body;
    await http().patch(`/api/staff/${acc.user.id}`).set(bearer(owner)).send({ access: ['events.manage'] }).expect(200);
    eventsOnly = acc.accessToken;

    hall = (await http().post('/api/schedule/rooms').set(bearer(owner)).send({ name: 'CER Hall' }).expect(201)).body.id;
    studio = (await http().post('/api/schedule/rooms').set(bearer(owner)).send({ name: 'CER Studio' }).expect(201)).body.id;
    tch = (await http().post('/api/teachers').set(bearer(owner)).send({ fullName: 'CER Teacher', subject: 'Math' }).expect(201)).body.id;
    tch2 = (await http().post('/api/teachers').set(bearer(owner)).send({ fullName: 'CER Teacher Two', subject: 'Math' }).expect(201)).body.id;
    group = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'CER Secret Group', subject: 'Math', teacherId: tch }).expect(201)).body.id;
    other = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'CER Other Group', subject: 'Math', teacherId: tch2 }).expect(201)).body.id;
    // The group's weekly lesson: Thursdays 18:00-19:00 in the hall.
    await lesson({ groupId: group, roomId: hall, dayOfWeek: 4, startTime: '18:00', endTime: '19:00' }).expect(201);
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  it('an event does not land on a lesson in that room; the next hour, another room, online or outside it does', async () => {
    const res = await post(event({ roomId: hall })).expect(409);
    expect(res.body.code).toBe('ROOM_TAKEN');
    expect(res.body.conflicts[0]).toMatchObject({ type: 'ROOM', startTime: '18:00', endTime: '19:00' });
    expect(res.body.conflicts[0].message).toContain('CER Secret Group');

    // 19:00-20:00 right after the 18:00-19:00 lesson: no clash.
    await post(event({ roomId: hall, startTime: '19:00', endTime: '20:00' })).expect(201);
    await post(event({ roomId: hall, startTime: '17:00', endTime: '18:00' })).expect(201);
    await post(event({ roomId: studio })).expect(201);
    // Online: holds no room (the room it was sent with is dropped).
    expect((await post(event({ format: 'ONLINE', meetingUrl: 'https://meet.example.com/x', roomId: hall })).expect(201)).body.roomId).toBeNull();
    // An outside place, no room of the center.
    await post(event({ location: 'Shahar sport zali' })).expect(201);
  });

  it('a lesson called off that day does not hold the room', async () => {
    const day = next(4, 2);
    await post(event({ roomId: hall, date: day })).expect(409);
    await http().post('/api/lessons/cancellations').set(bearer(owner)).send({ groupId: group, date: day, reason: 'Bayram' }).expect(201);
    await post(event({ roomId: hall, date: day })).expect(201);
  });

  it('who may not read the timetable is told the room is taken, not by whom', async () => {
    const res = await post(event({ roomId: hall }), eventsOnly).expect(409);
    expect(res.body.conflicts[0].message).not.toContain('CER Secret Group');
    expect(res.body.conflicts[0].groupName).toBeUndefined();
    expect(res.body.conflicts[0].message).toContain('18:00 - 19:00');
  });

  it('a lesson planned or moved later does not land on the event', async () => {
    const day = next(2, 3); // a Tuesday: the group has no lesson then
    const ev = (await post(event({ roomId: studio, date: day, startTime: '10:00', endTime: '11:00' })).expect(201)).body;

    // A one-off lesson that day, a weekly one on that weekday: refused, naming the event.
    const dated = await lesson({ groupId: other, roomId: studio, date: day, startTime: '10:30', endTime: '11:30' }).expect(409);
    expect(dated.body.conflicts.map((c: { type: string }) => c.type)).toContain('EVENT');
    expect(dated.body.conflicts.find((c: { type: string }) => c.type === 'EVENT').message).toContain('Ota-onalar majlisi');
    await lesson({ groupId: other, roomId: studio, dayOfWeek: 2, startTime: '09:30', endTime: '10:30' }).expect(409);
    // Right after it, or in another room: fine.
    const after = (await lesson({ groupId: other, roomId: studio, date: day, startTime: '11:00', endTime: '12:00' }).expect(201)).body;
    // Moving that lesson onto the event: refused; and the conflict check says so too.
    await http().patch(`/api/schedule/${after.id}`).set(bearer(owner)).send({ startTime: '10:00', endTime: '11:00' }).expect(409);
    const check = (await http().post('/api/schedule/check-conflict').set(bearer(owner))
      .send({ groupId: other, roomId: studio, date: day, startTime: '10:45', endTime: '11:15' }).expect(201)).body;
    expect(check.hasConflict).toBe(true);

    // Once the event is deleted the room is free again.
    await http().delete(`/api/center-events/${ev.id}`).set(bearer(owner)).expect(200);
    await http().patch(`/api/schedule/${after.id}`).set(bearer(owner)).send({ startTime: '10:00', endTime: '11:00' }).expect(200);
  });

  it('events in one room do not overlap; moving or re-timing one is checked, and an event never clashes with itself', async () => {
    const day = next(6, 3);
    const a = (await post(event({ roomId: studio, date: day, startTime: '09:00', endTime: '10:00' })).expect(201)).body;
    const b = (await post(event({ roomId: studio, date: day, startTime: '10:00', endTime: '11:00' })).expect(201)).body;
    expect((await post(event({ roomId: studio, date: day, startTime: '09:30', endTime: '10:30' })).expect(409)).body.conflicts.map((c: { type: string }) => c.type)).toEqual(['EVENT', 'EVENT']);
    // Its own title, then its own time: no clash with itself.
    await http().patch(`/api/center-events/${a.id}`).set(bearer(owner)).send({ title: 'Yangi nom' }).expect(200);
    await http().patch(`/api/center-events/${a.id}`).set(bearer(owner)).send({ startTime: '08:30' }).expect(200);
    // Re-timed onto b, moved into b's room from another, or b's room put back while online: refused.
    await http().patch(`/api/center-events/${a.id}`).set(bearer(owner)).send({ endTime: '10:15' }).expect(409);
    const c = (await post(event({ roomId: hall, date: day, startTime: '10:00', endTime: '11:00' })).expect(201)).body;
    await http().patch(`/api/center-events/${c.id}`).set(bearer(owner)).send({ roomId: studio }).expect(409);
    const online = (await post(event({ format: 'ONLINE', date: day, startTime: '10:00', endTime: '11:00' })).expect(201)).body;
    await http().patch(`/api/center-events/${online.id}`).set(bearer(owner)).send({ format: 'OFFLINE', roomId: studio }).expect(409);
    // Unchanged after the refusals.
    const listed = (await http().get(`/api/center-events?from=${day}&to=${day}`).set(bearer(owner)).expect(200)).body;
    expect(listed.find((e: { id: string }) => e.id === a.id)).toMatchObject({ startTime: '08:30', endTime: '10:00', roomId: studio });
    expect(listed.find((e: { id: string }) => e.id === c.id).roomId).toBe(hall);
    expect(listed.find((e: { id: string }) => e.id === b.id).roomId).toBe(studio);
  });

  it('an event in a room says when it ends; without a room it need not', async () => {
    const res = await post(event({ roomId: studio, date: next(5, 3), endTime: undefined })).expect(400);
    expect(res.body.message).toMatch(/tugash vaqti/i);
    const loose = (await post(event({ date: next(5, 3), endTime: undefined, location: 'Park' })).expect(201)).body;
    // Putting that one into a room without an end: refused too.
    await http().patch(`/api/center-events/${loose.id}`).set(bearer(owner)).send({ roomId: studio }).expect(400);
    await http().patch(`/api/center-events/${loose.id}`).set(bearer(owner)).send({ roomId: studio, endTime: '19:30' }).expect(200);
  });

  it('a make-up session and an event do not share a room, whichever comes first', async () => {
    // A student of the group, absent last Thursday: a credit for a make-up session.
    const kid = (await http().post('/api/students').set(bearer(owner)).send({ fullName: 'CER Kid', groupIds: [group] }).expect(201)).body.id;
    await http().post('/api/attendance').set(bearer(owner)).send({ groupId: group, date: last(4), entries: [{ studentId: kid, status: 'ABSENT' }] }).expect(201);
    const credit = (await http().post('/api/makeups/credits').set(bearer(owner)).send({ studentId: kid, groupId: group, date: last(4), reason: 'ABSENT' }).expect(201)).body.id;
    const day = next(3, 3); // a Wednesday
    const ev = (await post(event({ roomId: studio, date: day, startTime: '14:00', endTime: '15:00' })).expect(201)).body;
    const book = (start: string, end: string) => http().post(`/api/makeups/credits/${credit}/book`).set(bearer(owner))
      .send({ mode: 'SESSION', date: day, startTime: start, endTime: end, teacherId: tch2, roomId: studio });
    expect((await book('14:30', '15:30').expect(409)).body.code).toBe('SLOT_TAKEN');
    await book('15:00', '16:00').expect(201);
    // Now the session holds 15:00-16:00: an event moved there is refused.
    expect((await http().patch(`/api/center-events/${ev.id}`).set(bearer(owner)).send({ startTime: '15:30', endTime: '16:30' }).expect(409)).body.conflicts[0].type).toBe('MAKEUP');
  });

  it('two bookings of one room at one time sent together: one is saved, the other told why', async () => {
    const day = next(1, 4);
    const same = event({ roomId: studio, date: day, startTime: '12:00', endTime: '13:00' });
    const results = await Promise.all([0, 1, 2, 3].map(() => post(same)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.code).toBe('ROOM_TAKEN');

    // An event and a lesson for one slot at once: one of them only.
    const day2 = next(1, 5);
    const [e, l] = await Promise.all([
      post(event({ roomId: hall, date: day2, startTime: '08:00', endTime: '09:00' })),
      lesson({ groupId: other, roomId: hall, date: day2, startTime: '08:30', endTime: '09:30' }),
    ]);
    expect([e.status, l.status].sort()).toEqual([201, 409]);
    const events = (await http().get(`/api/center-events?from=${day2}&to=${day2}`).set(bearer(owner)).expect(200)).body
      .filter((x: { roomId: string | null }) => x.roomId === hall);
    const lessons = (await http().get(`/api/schedule?roomId=${hall}`).set(bearer(owner)).expect(200)).body
      .filter((x: { date: string | null }) => x.date === day2);
    expect(events.length + lessons.length).toBe(1);
  });
});
