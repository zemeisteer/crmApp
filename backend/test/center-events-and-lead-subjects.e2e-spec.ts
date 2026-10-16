import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// Events beside the timetable (meetings online or in a room, competitions)
// and leads interested in more than one direction.
describe('Center events and a lead\'s several directions (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  let owner: string, ownerB: string, manager: string, teacher: string, limited: string;
  let roomA: string, roomB: string;
  let math: string, english: string, chess: string, archived: string, foreignSubject: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    const register = async (key: string) => (await http().post('/api/auth/register')
      .send({ centerName: `CEV ${key} ${suffix}`, subdomain: `cev-${key}-${suffix}`, email: `cev-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` }).expect(201)).body.accessToken as string;
    owner = await register('a');
    ownerB = await register('b');
    const staff = async (local: string, role: string, access: string[] | null) => {
      const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `cev-${local}-${suffix}@test.uz`, role }).expect(201)).body;
      const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `CEV ${local}`, password: 'password12345' }).expect(201)).body;
      if (access) await http().patch(`/api/staff/${acc.user.id}`).set(bearer(owner)).send({ access }).expect(200);
      return acc.accessToken as string;
    };
    manager = await staff('manager', 'MANAGER', null);
    teacher = await staff('teacher', 'TEACHER', null);
    // A manager whose own list leaves events out.
    limited = await staff('limited', 'MANAGER', ['schedule.view', 'schedule.edit']);
    roomA = (await http().post('/api/schedule/rooms').set(bearer(owner)).send({ name: 'CEV Hall' }).expect(201)).body.id;
    roomB = (await http().post('/api/schedule/rooms').set(bearer(ownerB)).send({ name: 'Other center room' }).expect(201)).body.id;
    const subject = async (token: string, name: string) => (await http().post('/api/subjects').set(bearer(token)).send({ name }).expect(201)).body.id as string;
    math = await subject(owner, `Matematika ${suffix}`);
    english = await subject(owner, `Ingliz tili ${suffix}`);
    chess = await subject(owner, `Shaxmat ${suffix}`);
    archived = await subject(owner, `Eski fan ${suffix}`);
    await http().put(`/api/subjects/${archived}`).set(bearer(owner)).send({ status: 'ARCHIVED' }).expect(200);
    foreignSubject = await subject(ownerB, `Boshqa markaz fani ${suffix}`);
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  const meeting = {
    title: 'Ota-onalar majlisi',
    kind: 'MEETING',
    format: 'OFFLINE',
    date: '2026-11-05',
    startTime: '18:00',
    endTime: '19:00',
    audience: 'ALL',
  };

  it('an event is saved with its room, listed by date, and its centre alone sees it', async () => {
    const created = (await http().post('/api/center-events').set(bearer(owner)).send({ ...meeting, roomId: roomA, location: 'Ikkinchi qavat' }).expect(201)).body;
    expect(created).toMatchObject({ title: 'Ota-onalar majlisi', roomId: roomA, location: 'Ikkinchi qavat', meetingUrl: null, audience: 'ALL' });

    const listed = (await http().get('/api/center-events?from=2026-11-01&to=2026-11-30').set(bearer(owner)).expect(200)).body;
    expect(listed.map((e: { id: string }) => e.id)).toContain(created.id);
    expect(listed.find((e: { id: string }) => e.id === created.id).room).toEqual({ id: roomA, name: 'CEV Hall' });
    // Outside the dates asked: not there.
    const before = (await http().get('/api/center-events?from=2026-10-01&to=2026-10-31').set(bearer(owner)).expect(200)).body;
    expect(before.map((e: { id: string }) => e.id)).not.toContain(created.id);

    // The other centre neither sees, edits nor deletes it.
    const other = (await http().get('/api/center-events?from=2026-11-01&to=2026-11-30').set(bearer(ownerB)).expect(200)).body;
    expect(other.map((e: { id: string }) => e.id)).not.toContain(created.id);
    await http().patch(`/api/center-events/${created.id}`).set(bearer(ownerB)).send({ title: 'Hijacked' }).expect(404);
    await http().delete(`/api/center-events/${created.id}`).set(bearer(ownerB)).expect(404);
    // Nor may a room of the other centre be used.
    await http().post('/api/center-events').set(bearer(owner)).send({ ...meeting, roomId: roomB }).expect(400);
  });

  it('an online event keeps its link and drops any room; a bad link or time is refused', async () => {
    const online = (await http().post('/api/center-events').set(bearer(owner))
      .send({ ...meeting, title: 'Onlayn o\'qituvchilar yig\'ilishi', format: 'ONLINE', meetingUrl: 'https://meet.google.com/abc-defg-hij', roomId: roomA, location: 'ignored' })
      .expect(201)).body;
    expect(online).toMatchObject({ format: 'ONLINE', meetingUrl: 'https://meet.google.com/abc-defg-hij', roomId: null, location: null });

    await http().post('/api/center-events').set(bearer(owner)).send({ ...meeting, format: 'ONLINE', meetingUrl: 'javascript:alert(1)' }).expect(400);
    await http().post('/api/center-events').set(bearer(owner)).send({ ...meeting, startTime: '19:00', endTime: '18:00' }).expect(400);
    await http().post('/api/center-events').set(bearer(owner)).send({ ...meeting, kind: 'PARTY' }).expect(400);
    await http().post('/api/center-events').set(bearer(owner)).send({ ...meeting, date: '05.11.2026' }).expect(400);
    // A list may cover at most 120 days.
    await http().get('/api/center-events?from=2026-01-01&to=2026-12-31').set(bearer(owner)).expect(400);

    // Switching it to a room (at an hour the room is free): the link goes.
    const moved = (await http().patch(`/api/center-events/${online.id}`).set(bearer(owner)).send({ format: 'OFFLINE', roomId: roomA, startTime: '15:00', endTime: '16:00' }).expect(200)).body;
    expect(moved).toMatchObject({ format: 'OFFLINE', roomId: roomA, meetingUrl: null });
  });

  it('a competition is edited and deleted; a deleted event is gone from the list', async () => {
    const champ = (await http().post('/api/center-events').set(bearer(manager))
      .send({ ...meeting, title: 'Shaxmat chempionati', kind: 'COMPETITION', audience: 'STUDENTS', location: 'Sport zali' }).expect(201)).body;
    const edited = (await http().patch(`/api/center-events/${champ.id}`).set(bearer(manager)).send({ date: '2026-11-07', endTime: null }).expect(200)).body;
    expect(edited).toMatchObject({ kind: 'COMPETITION', date: '2026-11-07', endTime: null, location: 'Sport zali' });
    await http().delete(`/api/center-events/${champ.id}`).set(bearer(manager)).expect(200);
    const listed = (await http().get('/api/center-events?from=2026-11-01&to=2026-11-30').set(bearer(owner)).expect(200)).body;
    expect(listed.map((e: { id: string }) => e.id)).not.toContain(champ.id);
    await http().patch(`/api/center-events/${champ.id}`).set(bearer(manager)).send({ title: 'Back' }).expect(404);
  });

  it('every staff member sees events; only those allowed add, edit or delete them', async () => {
    const ev = (await http().post('/api/center-events').set(bearer(owner)).send(meeting).expect(201)).body;
    for (const token of [teacher, limited, manager]) {
      await http().get('/api/center-events?from=2026-11-01&to=2026-11-30').set(bearer(token)).expect(200);
    }
    for (const token of [teacher, limited]) {
      await http().post('/api/center-events').set(bearer(token)).send(meeting).expect(403);
      await http().patch(`/api/center-events/${ev.id}`).set(bearer(token)).send({ title: 'No' }).expect(403);
      await http().delete(`/api/center-events/${ev.id}`).set(bearer(token)).expect(403);
    }
    await http().get('/api/center-events?from=2026-11-01&to=2026-11-30').expect(401);
  });

  it('a lead keeps several directions: the main one apart, no repeats, only this centre\'s live subjects', async () => {
    const lead = (await http().post('/api/leads').set(bearer(owner))
      .send({ fullName: 'Ko\'p yo\'nalishli Lid', phone: `+99893${String(suffix).slice(-7)}`, desiredSubjectId: math, extraSubjectIds: [english, chess, english, math] })
      .expect(201)).body;
    expect(lead.desiredSubjectId).toBe(math);
    expect(lead.extraSubjectIds).toEqual([english, chess]);

    const one = (await http().get(`/api/leads/${lead.id}`).set(bearer(owner)).expect(200)).body;
    expect(one.extraSubjects).toEqual([
      { id: english, name: `Ingliz tili ${suffix}` },
      { id: chess, name: `Shaxmat ${suffix}` },
    ]);
    const page = (await http().get(`/api/leads?search=${encodeURIComponent('Ko\'p yo\'nalishli')}`).set(bearer(owner)).expect(200)).body;
    expect(page.items.find((l: { id: string }) => l.id === lead.id).extraSubjects).toHaveLength(2);

    // Making an extra one the main one takes it out of the extras.
    const swapped = (await http().patch(`/api/leads/${lead.id}`).set(bearer(owner)).send({ desiredSubjectId: english }).expect(200)).body;
    expect(swapped.desiredSubjectId).toBe(english);
    expect(swapped.extraSubjectIds).toEqual([chess]);

    // Another centre's subject, an archived one, or an unknown id: refused.
    for (const bad of [foreignSubject, archived, 'no-such-subject']) {
      await http().patch(`/api/leads/${lead.id}`).set(bearer(owner)).send({ extraSubjectIds: [chess, bad] }).expect(400);
    }
    // At most five.
    await http().patch(`/api/leads/${lead.id}`).set(bearer(owner)).send({ extraSubjectIds: ['a', 'b', 'c', 'd', 'e', 'f'] }).expect(400);
    const after = (await http().get(`/api/leads/${lead.id}`).set(bearer(owner)).expect(200)).body;
    expect(after.extraSubjectIds).toEqual([chess]);
  });
  it('a lead is found by any of its directions; clearing the main one keeps the others; an archived one stays; the export lists them', async () => {
    const lead = (await http().post('/api/leads').set(bearer(owner))
      .send({ fullName: 'Ikki Yonalish', phone: `+99897${String(suffix).slice(-7)}`, desiredSubjectId: math, extraSubjectIds: [chess] })
      .expect(201)).body;
    const found = async (subject: string) => (await http().get(`/api/leads?desiredSubjectId=${subject}&pageSize=100`).set(bearer(owner)).expect(200)).body.items.map((l: { id: string }) => l.id);
    expect(await found(math)).toContain(lead.id);
    expect(await found(chess)).toContain(lead.id);
    expect(await found(english)).not.toContain(lead.id);

    // No main direction any more: the other stays (sent as it is, as the form does).
    const cleared = (await http().patch(`/api/leads/${lead.id}`).set(bearer(owner)).send({ desiredSubjectId: null, extraSubjectIds: [chess] }).expect(200)).body;
    expect(cleared).toMatchObject({ desiredSubjectId: null, extraSubjectIds: [chess] });
    // An edit that does not mention directions keeps them too.
    expect((await http().patch(`/api/leads/${lead.id}`).set(bearer(owner)).send({ notes: 'qayta' }).expect(200)).body.extraSubjectIds).toEqual([chess]);

    // The direction is archived later: the lead keeps it (and can still be edited with it), but it cannot be newly added.
    await http().put(`/api/subjects/${chess}`).set(bearer(owner)).send({ status: 'ARCHIVED' }).expect(200);
    const kept = (await http().patch(`/api/leads/${lead.id}`).set(bearer(owner)).send({ desiredSubjectId: math, extraSubjectIds: [chess] }).expect(200)).body;
    expect(kept.extraSubjectIds).toEqual([chess]);
    expect((await http().get(`/api/leads/${lead.id}`).set(bearer(owner)).expect(200)).body.extraSubjects).toEqual([{ id: chess, name: `Shaxmat ${suffix}` }]);
    const other = (await http().post('/api/leads').set(bearer(owner)).send({ fullName: 'Yangi Lid', phone: `+99898${String(suffix).slice(-7)}`, desiredSubjectId: math, extraSubjectIds: [chess] }).expect(400));
    expect(other.status).toBe(400);
    await http().put(`/api/subjects/${chess}`).set(bearer(owner)).send({ status: 'ACTIVE' }).expect(200);

    const csv = (await http().get(`/api/leads/export?desiredSubjectId=${chess}`).set(bearer(owner)).expect(200)).text;
    const [header, ...rows] = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(header.split(',')).toContain('otherSubjects');
    const row = rows.find((r) => r.includes('Ikki Yonalish'))!;
    expect(row).toContain(`"Matematika ${suffix}"`);
    expect(row).toContain(`"Shaxmat ${suffix}"`);
  });
});
