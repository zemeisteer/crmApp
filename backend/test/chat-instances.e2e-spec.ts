import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, request as httpRequest, type Server } from 'http';
import type { AddressInfo } from 'net';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ChatHub } from '../src/chat/chat-hub.service.js';
import { DB, Database } from '../src/db/db.module.js';
import { organizationMemberships } from '../src/db/schema.js';

// Two API instances on one database (as behind a load balancer): a message
// sent through one instance reaches event streams held by the other, through
// PostgreSQL LISTEN/NOTIFY, and every stream hears each message exactly once.
describe('Chat across API instances (e2e)', () => {
  const apps: NestExpressApplication[] = [];
  const bases: string[] = [];
  const suffix = Date.now();
  const prevHeartbeat = process.env.CHAT_HEARTBEAT_MS;
  let n = 0;
  const cid = () => `m${suffix}x${n++}`.padEnd(12, '0');

  const call = async (base: string, method: string, path: string, token?: string, body?: unknown, want = 201) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    expect({ path, status: res.status }).toEqual({ path, status: want });
    return text ? JSON.parse(text) : null;
  };

  const stream = async (base: string, path: string, token: string) => {
    const events: { event: string; data: { conversationId?: string; seq?: number } }[] = [];
    const ctl = new AbortController();
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal });
    void (async () => {
      const reader = res.body!.getReader();
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
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
    })();
    const waitFor = async (pred: () => boolean, ms = 5000) => {
      const end = Date.now() + ms;
      while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      return pred();
    };
    expect(await waitFor(() => events.some((e) => e.event === 'ready'))).toBe(true);
    return { events, waitFor, close: () => ctl.abort(), headers: res.headers, has: (event: string) => events.some((e) => e.event === event) };
  };

  let teacher: string, cabinet: string, group: string;
  let owner: string, studentId: string, groupId: string, teacherRow: string, centerConv: string, tenantId: string;
  const say = (base: string, body: string) => call(base, 'POST', `/api/chat/conversations/${group}/messages`, teacher, { body, clientMessageId: cid() });
  const invite = async (role: string, local: string) => {
    const inv = await call(bases[0], 'POST', '/api/invitations', owner, { email: `multi-${local}-${suffix}@test.uz`, role });
    const acc = await call(bases[0], 'POST', `/api/invitations/${inv.token}/accept`, undefined, { fullName: `Multi ${local}`, password: 'password12345' });
    return { token: acc.accessToken as string, refreshToken: acc.refreshToken as string, userId: acc.user.id as string };
  };
  /** The cabinet writes to the center: announced to the center's inbox staff. */
  const toCenter = async () => (await call(bases[1], 'POST', `/api/portal/chat/conversations/${centerConv}/messages`, cabinet, { body: 'Markazga', clientMessageId: cid() })).message.seq as number;

  beforeAll(async () => {
    process.env.CHAT_HEARTBEAT_MS = '60000';
    for (let i = 0; i < 2; i++) {
      const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = mod.createNestApplication<NestExpressApplication>();
      configureApp(app);
      await app.listen(0, '127.0.0.1');
      apps.push(app);
      bases.push(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`);
    }
    const [a] = bases;
    const reg = await call(a, 'POST', '/api/auth/register', undefined, {
      centerName: `Multi ${suffix}`, subdomain: `multi-${suffix}`, email: `multi-${suffix}@test.uz`, password: 'password123', fullName: 'Owner',
    });
    owner = reg.accessToken as string;
    tenantId = reg.tenant.id as string;
    const inv = await call(a, 'POST', '/api/invitations', owner, { email: `multi-t-${suffix}@test.uz`, role: 'TEACHER' });
    const acc = await call(a, 'POST', `/api/invitations/${inv.token}/accept`, undefined, { fullName: 'Multi Teacher', password: 'password12345' });
    teacher = acc.accessToken;
    const tch = (await call(a, 'POST', '/api/teachers', owner, { fullName: 'Multi Teacher', userId: acc.user.id, subject: 'Math' })).id;
    const g = (await call(a, 'POST', '/api/groups', owner, { name: 'Multi G', subject: 'Math', teacherId: tch, scheduleDays: 'Dushanba', startTime: '10:00', endTime: '11:00' })).id;
    const phone = `+99893${String(suffix).slice(-7)}`;
    const s = (await call(a, 'POST', '/api/students', owner, { fullName: 'Multi Student', phone, groupIds: [g] })).id;
    const { pin } = await call(a, 'POST', `/api/students/${s}/portal-pin`, owner);
    cabinet = (await call(a, 'POST', '/api/portal/auth/phone/verify', undefined, { phone, pin })).accessToken;
    group = (await call(a, 'POST', '/api/chat/conversations', teacher, { kind: 'GROUP', groupId: g })).id;
    studentId = s;
    groupId = g;
    teacherRow = tch;
    centerConv = (await call(a, 'POST', '/api/portal/chat/conversations', cabinet, { kind: 'STUDENT_CENTER' })).id;
  }, 180_000);

  afterAll(async () => {
    for (const app of apps) await app.close();
    if (prevHeartbeat === undefined) delete process.env.CHAT_HEARTBEAT_MS;
    else process.env.CHAT_HEARTBEAT_MS = prevHeartbeat;
  });

  it('a message sent through one instance is announced on streams held by the other, once each', async () => {
    const [a, b] = bases;
    // The cabinet listens on instance B, the teacher on instance A.
    const cabOnB = await stream(b, '/api/portal/chat/stream', cabinet);
    const teacherOnA = await stream(a, '/api/chat/stream', teacher);

    // Teacher writes through A -> the cabinet on B hears it.
    const m1 = (await call(a, 'POST', `/api/chat/conversations/${group}/messages`, teacher, { body: 'A orqali', clientMessageId: cid() })).message;
    expect(await cabOnB.waitFor(() => cabOnB.events.some((e) => e.event === 'message' && e.data.seq === m1.seq))).toBe(true);

    // The student answers through B -> the teacher on A hears it.
    const m2 = (await call(b, 'POST', `/api/portal/chat/conversations/${group}/messages`, cabinet, { body: 'B orqali', clientMessageId: cid() })).message;
    expect(await teacherOnA.waitFor(() => teacherOnA.events.some((e) => e.event === 'message' && e.data.seq === m2.seq))).toBe(true);

    // Both instances read the same history.
    const fromB = await call(b, 'GET', `/api/portal/chat/conversations/${group}/messages`, cabinet, undefined, 200);
    expect(fromB.messages.map((m: { body: string }) => m.body)).toEqual(['A orqali', 'B orqali']);

    // Each stream heard each message exactly once (no echo from the second
    // instance): first all four have arrived, then a moment for a duplicate.
    const heard = (s: { events: { event: string; data: { seq?: number } }[] }, seq: number) => s.events.some((e) => e.event === 'message' && e.data.seq === seq);
    expect(await cabOnB.waitFor(() => heard(cabOnB, m2.seq) && heard(teacherOnA, m1.seq))).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    const count = (s: { events: { event: string; data: { seq?: number } }[] }, seq: number) => s.events.filter((e) => e.event === 'message' && e.data.seq === seq).length;
    expect([count(cabOnB, m1.seq), count(cabOnB, m2.seq), count(teacherOnA, m1.seq), count(teacherOnA, m2.seq)]).toEqual([1, 1, 1, 1]);
    cabOnB.close();
    teacherOnA.close();
  });

  // The heartbeat here is a minute: whatever closes a stream below is the
  // check made when an announcement is about to be delivered.

  it('chat.use taken away: the open stream gets no further announcement and is closed', async () => {
    const [a, b] = bases;
    const m = await invite('MANAGER', 'mgr');
    // The center's inbox is the manager's by the access list.
    await call(a, 'PATCH', `/api/staff/${m.userId}`, owner, { access: ['chat.use', 'chat.center', 'students.view'] }, 200);
    const s = await stream(a, '/api/chat/stream', m.token);
    const first = await toCenter();
    expect(await s.waitFor(() => s.events.some((e) => e.event === 'message' && e.data.seq === first))).toBe(true);

    await call(b, 'PATCH', `/api/staff/${m.userId}`, owner, { access: ['chat.center', 'students.view'] }, 200);
    const second = await toCenter();
    expect(await s.waitFor(() => s.has('revoked'))).toBe(true);
    expect(s.events.some((e) => e.event === 'message' && e.data.seq === second)).toBe(false);
    // And a new stream is not given.
    expect((await fetch(`${a}/api/chat/stream`, { headers: { Authorization: `Bearer ${m.token}` } })).status).toBe(403);
  });

  it('signing out, and the session being ended from another device, close the stream', async () => {
    const [a] = bases;
    for (const how of ['logout', 'revoke'] as const) {
      const m = await invite('ADMIN', `adm-${how}`);
      const s = await stream(a, '/api/chat/stream', m.token);
      if (how === 'logout') await call(a, 'POST', '/api/auth/logout', undefined, { refreshToken: m.refreshToken });
      else {
        const sessions = await call(a, 'GET', '/api/auth/sessions', m.token, undefined, 200);
        await call(a, 'DELETE', `/api/auth/sessions/${sessions[0].id}`, m.token, undefined, 200);
      }
      const seq = await toCenter();
      expect(await s.waitFor(() => s.has('revoked'))).toBe(true);
      expect(s.events.some((e) => e.event === 'message' && e.data.seq === seq)).toBe(false);
    }
  });

  it('switching to another center ends the stream of the center that was left', async () => {
    const [a] = bases;
    const m = await invite('ADMIN', 'two-centers');
    const other = await call(a, 'POST', '/api/auth/register', undefined, {
      centerName: `Multi other ${suffix}`, subdomain: `multi-o-${suffix}`, email: `multi-o-${suffix}@test.uz`, password: 'password123', fullName: 'Other Owner',
    });
    await apps[0].get<Database>(DB).insert(organizationMemberships).values({ userId: m.userId, tenantId: other.tenant.id, role: 'ADMIN', status: 'ACTIVE' });
    const s = await stream(a, '/api/chat/stream', m.token);
    await call(a, 'POST', '/api/auth/select-workspace', m.token, { tenantId: other.tenant.id, refreshToken: m.refreshToken });
    const seq = await toCenter();
    expect(await s.waitFor(() => s.has('revoked'))).toBe(true);
    expect(s.events.some((e) => e.event === 'message' && e.data.seq === seq)).toBe(false);
    expect(tenantId).not.toBe(other.tenant.id);
  });

  it('a parent whose link to the student is removed loses the cabinet stream', async () => {
    const [a, b] = bases;
    const parent = await invite('PARENT', 'parent');
    await call(a, 'POST', `/api/students/${studentId}/guardians`, owner, { userId: parent.userId, relationship: 'Ona' });
    const parentCab = (await call(a, 'POST', '/api/portal/auth/parent-account', parent.token)).sessions[0].accessToken as string;
    const s = await stream(b, '/api/portal/chat/stream', parentCab);
    const heard = (await say(a, 'Ota-onaga ham')).message.seq as number;
    expect(await s.waitFor(() => s.events.some((e) => e.event === 'message' && e.data.seq === heard))).toBe(true);
    await call(a, 'DELETE', `/api/students/${studentId}/guardians/${parent.userId}`, owner, undefined, 200);
    const after = (await say(a, 'Endi emas')).message.seq as number;
    expect(await s.waitFor(() => s.has('revoked'))).toBe(true);
    expect(s.events.some((e) => e.event === 'message' && e.data.seq === after)).toBe(false);
  });

  it('a teacher taken off a group hears nothing more of it; the stream itself stays', async () => {
    const [a, b] = bases;
    const s = await stream(b, '/api/chat/stream', teacher);
    const cab = await stream(a, '/api/portal/chat/stream', cabinet);
    const before = (await call(a, 'POST', `/api/portal/chat/conversations/${group}/messages`, cabinet, { body: 'Ustozga', clientMessageId: cid() })).message.seq as number;
    expect(await s.waitFor(() => s.events.some((e) => e.event === 'message' && e.data.seq === before))).toBe(true);
    const other = (await call(a, 'POST', '/api/teachers', owner, { fullName: 'Multi Other Teacher', subject: 'Math' })).id;
    await call(a, 'PATCH', `/api/groups/${groupId}`, owner, { teacherId: other }, 200);
    const after = (await call(a, 'POST', `/api/portal/chat/conversations/${group}/messages`, cabinet, { body: 'Yangi ustozga', clientMessageId: cid() })).message.seq as number;
    expect(await cab.waitFor(() => cab.events.some((e) => e.event === 'message' && e.data.seq === after))).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(s.events.some((e) => e.event === 'message' && e.data.seq === after)).toBe(false);
    expect(s.has('revoked')).toBe(false);
    // Back, for the tests below.
    await call(a, 'PATCH', `/api/groups/${groupId}`, owner, { teacherId: teacherRow }, 200);
    s.close();
    cab.close();
  });

  it('a lost LISTEN connection: the other instance still hears, and the clients are told to catch up when it is back', async () => {
    const [a, b] = bases;
    const onA = await stream(a, '/api/portal/chat/stream', cabinet);
    const onB = await stream(b, '/api/portal/chat/stream', cabinet);
    const hubA = apps[0].get(ChatHub) as unknown as { listener: { connection: { stream: { destroy: () => void } } } | null };
    // The network drops under instance A's listener.
    hubA.listener!.connection.stream.destroy();
    await onA.waitFor(() => hubA.listener === null, 2000);
    expect(hubA.listener).toBeNull();

    // Sent through A while A cannot hear: B's client hears it through NOTIFY, A's own client directly.
    const viaA = (await say(a, 'A eshitmayapti')).message.seq as number;
    expect(await onB.waitFor(() => onB.events.some((e) => e.event === 'message' && e.data.seq === viaA))).toBe(true);
    expect(await onA.waitFor(() => onA.events.some((e) => e.event === 'message' && e.data.seq === viaA))).toBe(true);
    // Sent through B: A's client cannot hear this one now.
    const viaB = (await say(b, 'B orqali, A kar')).message.seq as number;
    expect(await onB.waitFor(() => onB.events.some((e) => e.event === 'message' && e.data.seq === viaB))).toBe(true);
    expect(onA.events.some((e) => e.event === 'message' && e.data.seq === viaB)).toBe(false);

    // The listener comes back (2 s): A's client is told to catch up, and the history has the message.
    expect(await onA.waitFor(() => onA.has('resync'), 8000)).toBe(true);
    const missed = await call(a, 'GET', `/api/portal/chat/conversations/${group}/messages?after=${viaA}`, cabinet, undefined, 200);
    expect(missed.messages.map((m: { seq: number }) => m.seq)).toEqual([viaB]);
    // And live delivery works again, once per message.
    const again = (await say(b, 'Yana jonli')).message.seq as number;
    expect(await onA.waitFor(() => onA.events.some((e) => e.event === 'message' && e.data.seq === again))).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(onA.events.filter((e) => e.event === 'message' && e.data.seq === again)).toHaveLength(1);
    onA.close();
    onB.close();
  }, 30_000);

  it('through a reverse proxy in front of both instances: the stream is not buffered and each message arrives once', async () => {
    // Round robin, streaming, no buffering: what a load balancer does.
    let turn = 0;
    const proxy: Server = createServer((req, res) => {
      const target = new URL(bases[turn++ % bases.length]);
      const up = httpRequest({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host, 'x-forwarded-for': '203.0.113.9' } }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on('error', () => res.destroy());
      // The client went away (a closed stream): let go of the upstream too.
      res.on('close', () => up.destroy());
      req.pipe(up);
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    const front = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    try {
      const cab = await stream(front, '/api/portal/chat/stream', cabinet);
      const tch = await stream(front, '/api/chat/stream', teacher);
      expect(cab.headers.get('content-type')).toContain('text/event-stream');
      expect(cab.headers.get('x-accel-buffering')).toBe('no');
      expect(cab.headers.get('cache-control')).toContain('no-cache');
      const seqs: number[] = [];
      for (let i = 0; i < 4; i++) seqs.push((await say(front, `Proksi ${i}`)).message.seq as number);
      // The same retried request (same client id) through the proxy lands on the other instance: still one message.
      const id = cid();
      const first = await call(front, 'POST', `/api/chat/conversations/${group}/messages`, teacher, { body: 'Bir marta', clientMessageId: id });
      const retry = await call(front, 'POST', `/api/chat/conversations/${group}/messages`, teacher, { body: 'Bir marta', clientMessageId: id });
      expect(retry.message.id).toBe(first.message.id);
      seqs.push(first.message.seq);
      expect(await cab.waitFor(() => seqs.every((q) => cab.events.some((e) => e.event === 'message' && e.data.seq === q)))).toBe(true);
      await new Promise((r) => setTimeout(r, 300));
      for (const q of seqs) expect(cab.events.filter((e) => e.event === 'message' && e.data.seq === q)).toHaveLength(1);
      // In order, with no gap, and the unread count is the cabinet's five new ones at least.
      const got = cab.events.filter((e) => e.event === 'message' && seqs.includes(e.data.seq!)).map((e) => e.data.seq);
      expect(got).toEqual([...seqs].sort((x, y) => x - y));
      const history = await call(front, 'GET', `/api/portal/chat/conversations/${group}/messages`, cabinet, undefined, 200);
      const tail = history.messages.slice(-5).map((m: { seq: number }) => m.seq);
      expect(tail).toEqual(seqs);
      expect(history.messages.filter((m: { body: string }) => m.body === 'Bir marta')).toHaveLength(1);
      const unread = await call(front, 'GET', '/api/portal/chat/unread', cabinet, undefined, 200);
      expect(unread.unread).toBeGreaterThanOrEqual(5);
      await call(front, 'POST', `/api/portal/chat/conversations/${group}/read`, cabinet, { seq: seqs[seqs.length - 1] });
      const row = (await call(front, 'GET', '/api/portal/chat/conversations', cabinet, undefined, 200)).find((c: { id: string }) => c.id === group);
      expect(row.unread).toBe(0);
      cab.close();
      tch.close();
    } finally {
      await new Promise<void>((r) => proxy.close(() => r()));
    }
  }, 30_000);
});
