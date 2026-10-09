import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// Two-way messages between people: who may start, read and write which
// conversation is decided from live data; sends are idempotent; new
// messages are announced over a server-sent event stream that re-checks
// its client.
describe('Chat (e2e)', () => {
  let app: NestExpressApplication;
  let base: string;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const prevHeartbeat = process.env.CHAT_HEARTBEAT_MS;

  let ownerA: string, recA: string, recAId: string, t1: string, t2: string, ownerB: string;
  let g1: string, s1: string, s2: string;
  let s1Cab: string, s2Cab: string, s2Phone: string, parentCab: string, parentUser: string;
  let n = 0;
  const cid = () => `c${suffix}x${n++}`.padEnd(12, '0');

  const register = async (key: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `Chat ${key} ${suffix}`, subdomain: `chat-${key}-${suffix}`, email: `chat-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` })
      .expect(201)).body.accessToken as string;
  const invite = async (owner: string, role: string, local: string) => {
    const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `chat-${local}-${suffix}@test.uz`, role }).expect(201)).body;
    const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `${role} ${local}`, password: 'password12345' }).expect(201)).body;
    return { token: acc.accessToken as string, userId: acc.user.id as string };
  };
  const cabinetOf = async (studentId: string, phone: string) => {
    const { pin } = (await http().post(`/api/students/${studentId}/portal-pin`).set(bearer(ownerA)).expect(201)).body;
    return (await http().post('/api/portal/auth/phone/verify').send({ phone, pin }).expect(201)).body.accessToken as string;
  };
  const send = (token: string, convId: string, body: string, clientMessageId = cid(), portal = false) =>
    http().post(`/api${portal ? '/portal' : ''}/chat/conversations/${convId}/messages`).set(bearer(token)).send({ body, clientMessageId });
  const msgs = (token: string, convId: string, q = '', portal = false) => http().get(`/api${portal ? '/portal' : ''}/chat/conversations/${convId}/messages${q}`).set(bearer(token));

  /** A live event stream (as the browser opens it: fetch with the bearer header). */
  const stream = async (path: string, token: string) => {
    const events: { event: string; data: { conversationId?: string; seq?: number } }[] = [];
    const ctl = new AbortController();
    const res = await fetch(`${base}${path}`, { headers: bearer(token), signal: ctl.signal });
    let closed = false;
    const done = (async () => {
      const reader = res.body!.getReader();
      let buf = '';
      try {
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          buf += Buffer.from(value).toString();
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(chunk)?.[1];
            const data = /^data: (.*)$/m.exec(chunk)?.[1];
            if (ev) events.push({ event: ev, data: data ? JSON.parse(data) : {} });
          }
        }
      } catch {
        // aborted
      }
      closed = true;
    })();
    const waitFor = async (pred: () => boolean, ms = 3000) => {
      const end = Date.now() + ms;
      while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      return pred();
    };
    await waitFor(() => events.some((e) => e.event === 'ready'));
    return { status: res.status, events, close: () => ctl.abort(), isClosed: () => closed, waitFor, done };
  };

  beforeAll(async () => {
    process.env.CHAT_HEARTBEAT_MS = '300';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    ownerA = await register('a');
    const rec = await invite(ownerA, 'RECEPTIONIST', 'rec'); recA = rec.token; recAId = rec.userId;
    const u1 = await invite(ownerA, 'TEACHER', 't1'); t1 = u1.token;
    const u2 = await invite(ownerA, 'TEACHER', 't2'); t2 = u2.token;
    const p = await invite(ownerA, 'PARENT', 'par'); parentUser = p.userId;
    const tch1 = (await http().post('/api/teachers').set(bearer(ownerA)).send({ fullName: 'Chat T1', userId: u1.userId, subject: 'Math' }).expect(201)).body.id;
    const tch2 = (await http().post('/api/teachers').set(bearer(ownerA)).send({ fullName: 'Chat T2', userId: u2.userId, subject: 'Math' }).expect(201)).body.id;
    g1 = (await http().post('/api/groups').set(bearer(ownerA)).send({ name: 'Chat G1', subject: 'Math', teacherId: tch1, scheduleDays: 'Dushanba', startTime: '10:00', endTime: '11:00' }).expect(201)).body.id;
    await http().post('/api/groups').set(bearer(ownerA)).send({ name: 'Chat G2', subject: 'Math', teacherId: tch2, scheduleDays: 'Seshanba', startTime: '10:00', endTime: '11:00' }).expect(201);
    const s1Phone = `+99896${String(suffix).slice(-7)}`;
    s2Phone = `+99897${String(suffix).slice(-7)}`;
    s1 = (await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'Chat Student One', phone: s1Phone, groupIds: [g1] }).expect(201)).body.id;
    s2 = (await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'Chat Student Two', phone: s2Phone, groupIds: [g1] }).expect(201)).body.id;
    s1Cab = await cabinetOf(s1, s1Phone);
    s2Cab = await cabinetOf(s2, s2Phone);
    await http().post(`/api/students/${s1}/guardians`).set(bearer(ownerA)).send({ userId: parentUser, relationship: 'Ona' }).expect(201);
    parentCab = (await http().post('/api/portal/auth/parent-account').set(bearer(p.token)).expect(201)).body.sessions[0].accessToken;
    ownerB = await register('b');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (prevHeartbeat === undefined) delete process.env.CHAT_HEARTBEAT_MS;
    else process.env.CHAT_HEARTBEAT_MS = prevHeartbeat;
  });

  let center: string;

  it('the cabinet writes to the center; inbox staff answer; history is ordered and paged by cursor', async () => {
    center = (await http().post('/api/portal/chat/conversations').set(bearer(s1Cab)).send({ kind: 'STUDENT_CENTER' }).expect(201)).body.id;
    // Opening again finds the same conversation.
    expect((await http().post('/api/portal/chat/conversations').set(bearer(s1Cab)).send({ kind: 'STUDENT_CENTER', studentId: s2 }).expect(201)).body.id).toBe(center); // its own student only
    await send(s1Cab, center, 'Salom, dars jadvali qachon?', cid(), true).expect(201);
    const inbox = (await http().get('/api/chat/conversations').set(bearer(recA)).expect(200)).body;
    const row = inbox.find((c: { id: string }) => c.id === center);
    expect(row).toMatchObject({ kind: 'STUDENT_CENTER', studentName: 'Chat Student One', unread: 1, canWrite: true });
    for (let i = 1; i <= 4; i++) await send(recA, center, `Javob ${i}`).expect(201);
    const latest = (await msgs(recA, center, '?limit=2')).body;
    expect(latest.messages.map((m: { body: string }) => m.body)).toEqual(['Javob 3', 'Javob 4']);
    expect(latest.hasMore).toBe(true);
    const older = (await msgs(recA, center, `?limit=10&before=${latest.messages[0].seq}`)).body;
    expect(older.messages.map((m: { body: string }) => m.body)).toEqual(['Salom, dars jadvali qachon?', 'Javob 1', 'Javob 2']);
    const seqs = [...older.messages, ...latest.messages].map((m: { seq: number }) => m.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    // Sender identity comes from the session.
    const first = older.messages[0];
    expect(first).toMatchObject({ senderType: 'CABINET', senderViewer: 'student', senderName: 'Chat Student One', mine: false });
    expect(latest.messages[1]).toMatchObject({ senderType: 'USER', mine: true });
    // A teacher is not the center's inbox.
    expect((await http().get('/api/chat/conversations').set(bearer(t1)).expect(200)).body.find((c: { id: string }) => c.id === center)).toBeUndefined();
    await msgs(t1, center).expect(404);
  });

  it('unread counts per participant; reading moves forward only', async () => {
    const cab = (await http().get('/api/portal/chat/conversations').set(bearer(s1Cab)).expect(200)).body.find((c: { id: string }) => c.id === center);
    expect(cab.unread).toBe(4);
    expect((await http().get('/api/portal/chat/unread').set(bearer(s1Cab)).expect(200)).body.unread).toBe(4);
    await http().post(`/api/portal/chat/conversations/${center}/read`).set(bearer(s1Cab)).send({ seq: cab.lastMessage.seq }).expect(201);
    await http().post(`/api/portal/chat/conversations/${center}/read`).set(bearer(s1Cab)).send({ seq: 1 }).expect(201); // never backwards
    expect((await http().get('/api/portal/chat/unread').set(bearer(s1Cab)).expect(200)).body.unread).toBe(0);
    // The staff side counts separately.
    expect((await http().get('/api/chat/unread').set(bearer(recA)).expect(200)).body.unread).toBe(0);
  });

  it('a retried send with the same client id is one message, also when sent at once', async () => {
    const id = cid();
    const r1 = (await send(recA, center, 'Bir marta', id).expect(201)).body;
    const r2 = (await send(recA, center, 'Bir marta', id).expect(201)).body;
    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(true);
    expect(r2.message.id).toBe(r1.message.id);
    const id2 = cid();
    const many = await Promise.all([0, 1, 2, 3].map(() => send(recA, center, 'Parallel', id2)));
    expect(new Set(many.map((r) => r.body.message.id)).size).toBe(1);
    const all = (await msgs(recA, center, '?limit=100')).body.messages;
    expect(all.filter((m: { body: string }) => m.body === 'Parallel')).toHaveLength(1);
  });

  it('bad input is refused: empty, too long, bad client id', async () => {
    await send(recA, center, '   ').expect(400);
    await send(recA, center, 'x'.repeat(2001)).expect(400);
    await send(recA, center, 'ok', 'short').expect(400);
    await msgs(recA, center, '?before=abc').expect(400);
  });

  let teacherConv: string;

  it("a teacher writes to their own student only; owners can read it, not write; nobody else", async () => {
    teacherConv = (await http().post('/api/chat/conversations').set(bearer(t1)).send({ kind: 'STUDENT_TEACHER', studentId: s1 }).expect(201)).body.id;
    await http().post('/api/chat/conversations').set(bearer(t2)).send({ kind: 'STUDENT_TEACHER', studentId: s1 }).expect(404);
    await send(t1, teacherConv, 'Uy vazifasini bajardingmi?').expect(201);
    const cabList = (await http().get('/api/portal/chat/conversations').set(bearer(s1Cab)).expect(200)).body;
    expect(cabList.find((c: { id: string }) => c.id === teacherConv)).toMatchObject({ kind: 'STUDENT_TEACHER', teacherName: 'TEACHER t1', canWrite: true });
    await send(s1Cab, teacherConv, 'Ha, bajardim', cid(), true).expect(201);
    const owner = (await http().get('/api/chat/conversations').set(bearer(ownerA)).expect(200)).body.find((c: { id: string }) => c.id === teacherConv);
    expect(owner).toMatchObject({ canWrite: false, oversight: true });
    await msgs(ownerA, teacherConv).expect(200);
    await send(ownerA, teacherConv, 'Admin').expect(403);
    await msgs(recA, teacherConv).expect(404);
    await msgs(t2, teacherConv).expect(404);
    // The cabinet may start one only with its own current teacher.
    const contacts = (await http().get('/api/portal/chat/contacts').set(bearer(s1Cab)).expect(200)).body;
    expect(contacts.teachers.map((t: { name: string }) => t.name)).toEqual(['Chat T1']);
  });

  it('participant discovery is limited to whom one may write', async () => {
    const t1c = (await http().get('/api/chat/contacts').set(bearer(t1)).expect(200)).body;
    expect(t1c.students.map((s: { name: string }) => s.name).sort()).toEqual(['Chat Student One', 'Chat Student Two']);
    expect((await http().get('/api/chat/contacts').set(bearer(t2)).expect(200)).body.students).toEqual([]);
    expect((await http().get('/api/chat/contacts?q=C').set(bearer(recA)).expect(200)).body.students).toEqual([]); // 2+ letters
    expect((await http().get('/api/chat/contacts?q=Chat Student').set(bearer(recA)).expect(200)).body.students).toHaveLength(2);
    expect((await http().get('/api/chat/contacts?q=Chat Student').set(bearer(ownerB)).expect(200)).body.students).toEqual([]);
  });

  it('another center: ids grant nothing', async () => {
    await msgs(ownerB, center).expect(404);
    await send(ownerB, center, 'hi').expect(404);
    await http().post(`/api/chat/conversations/${center}/read`).set(bearer(ownerB)).send({ seq: 1 }).expect(404);
    await http().post('/api/chat/conversations').set(bearer(ownerB)).send({ kind: 'STUDENT_CENTER', studentId: s1 }).expect(404);
    expect((await http().get('/api/chat/conversations').set(bearer(ownerB)).expect(200)).body).toEqual([]);
  });

  it('a parent account writes as itself; unlinking ends that cabinet', async () => {
    const res = (await send(parentCab, center, 'Ota-onadan salom', cid(), true).expect(201)).body.message;
    expect(res.senderName).toBe('PARENT par (Chat Student One — ota-ona)');
    // The parts the pages put together in the reader's language.
    expect(res).toMatchObject({ senderRole: 'parent', senderPerson: 'PARENT par', senderAbout: 'Chat Student One' });
    const history = (await msgs(recA, center)).body.messages as Array<{ body: string; senderRole: string; senderPerson: string | null; senderAbout: string | null }>;
    expect(history.find((m) => m.body === 'Salom, dars jadvali qachon?')).toMatchObject({ senderRole: 'student', senderPerson: 'Chat Student One', senderAbout: null });
    expect(history.find((m) => m.body === 'Javob 1')).toMatchObject({ senderRole: 'staff', senderPerson: 'RECEPTIONIST rec', senderAbout: null });
    const row = (await http().get('/api/chat/conversations').set(bearer(recA)).expect(200)).body.find((c: { id: string }) => c.id === center);
    expect(row.lastMessage).toMatchObject({ senderRole: 'parent', senderPerson: 'PARENT par', senderAbout: 'Chat Student One' });
    await http().delete(`/api/students/${s1}/guardians/${parentUser}`).set(bearer(ownerA)).expect(200);
    await msgs(parentCab, center, '', true).expect(401);
    await send(parentCab, center, 'still here?', cid(), true).expect(401);
  });

  it('live events reach only those who may see the conversation; reconnect catches up with after=', async () => {
    const group = (await http().post('/api/chat/conversations').set(bearer(t1)).send({ kind: 'GROUP', groupId: g1 }).expect(201)).body.id;
    const s2Stream = await stream('/api/portal/chat/stream', s2Cab);
    const t1Stream = await stream('/api/chat/stream', t1);
    expect(s2Stream.status).toBe(200);
    const g = (await send(t1, group, 'Ertaga dars 10:00 da').expect(201)).body.message;
    expect(await s2Stream.waitFor(() => s2Stream.events.some((e) => e.event === 'message' && e.data.conversationId === group && e.data.seq === g.seq))).toBe(true);
    // A message in S1's center conversation is not announced to S2 or T1.
    const c = (await send(recA, center, 'Faqat bitta oila uchun').expect(201)).body.message;
    await new Promise((r) => setTimeout(r, 300));
    expect(s2Stream.events.some((e) => e.data.conversationId === center)).toBe(false);
    expect(t1Stream.events.some((e) => e.data.conversationId === center)).toBe(false);
    // The student answers in the group; the teacher hears it.
    const a = (await send(s2Cab, group, 'Tushunarli', cid(), true).expect(201)).body.message;
    expect(await t1Stream.waitFor(() => t1Stream.events.some((e) => e.data.seq === a.seq))).toBe(true);
    // Reconnect: fetch what came after the last seen seq.
    s2Stream.close();
    await send(t1, group, 'Yana bir xabar').expect(201);
    const missed = (await msgs(s2Cab, group, `?after=${a.seq}`, true).expect(200)).body.messages;
    expect(missed.map((m: { body: string }) => m.body)).toEqual(['Yana bir xabar']);
    t1Stream.close();
    void c;
  });

  it('revoking access stops reads, sends and live events', async () => {
    const group = (await http().get('/api/chat/conversations').set(bearer(t1)).expect(200)).body.find((c: { kind: string }) => c.kind === 'GROUP').id;
    const t1Stream = await stream('/api/chat/stream', t1);
    // S1 leaves G1: the teacher no longer teaches them.
    await http().delete(`/api/students/${s1}/enroll/${g1}`).set(bearer(ownerA)).expect(200);
    await msgs(t1, teacherConv).expect(404);
    await send(t1, teacherConv, 'x').expect(404);
    // The cabinet keeps its history but cannot write to a teacher who no longer teaches it.
    await msgs(s1Cab, teacherConv, '', true).expect(200);
    await send(s1Cab, teacherConv, 'x', cid(), true).expect(403);
    // ...and is out of the group conversation.
    await msgs(s1Cab, group, '', true).expect(404);
    // A message in the old teacher conversation is not announced to T1.
    await send(ownerA, center, 'admin note').expect(201);
    await new Promise((r) => setTimeout(r, 300));
    expect(t1Stream.events.some((e) => e.data.conversationId === teacherConv)).toBe(false);
    t1Stream.close();

    // A staff member removed from the center: the stream closes.
    const recStream = await stream('/api/chat/stream', recA);
    await http().delete(`/api/staff/${recAId}`).set(bearer(ownerA)).expect(200);
    expect(await recStream.waitFor(() => recStream.isClosed(), 3000)).toBe(true);
    expect(recStream.events.some((e) => e.event === 'revoked')).toBe(true);
    await http().get('/api/chat/conversations').set(bearer(recA)).expect(401);

    // A new PIN signs the cabinet out: its stream closes too.
    const s2Stream = await stream('/api/portal/chat/stream', s2Cab);
    await new Promise((r) => setTimeout(r, 1100)); // the PIN must be newer than the token, to the second
    await http().post(`/api/students/${s2}/portal-pin`).set(bearer(ownerA)).expect(201);
    expect(await s2Stream.waitFor(() => s2Stream.isClosed(), 3000)).toBe(true);
  });

  it('streams need a session; message bodies never reach the audit log', async () => {
    expect((await fetch(`${base}/api/chat/stream`)).status).toBe(401);
    expect((await fetch(`${base}/api/portal/chat/stream`)).status).toBe(401);
    const logs = (await http().get('/api/audit-logs').set(bearer(ownerA)).expect(200)).body;
    const text = JSON.stringify(logs);
    expect(text).toContain('chat.open');
    expect(text).not.toContain('dars jadvali');
    expect(text).not.toContain('Ota-onadan salom');
  });
});
