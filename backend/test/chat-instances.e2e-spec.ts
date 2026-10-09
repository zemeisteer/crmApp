import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'net';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

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
    return { events, waitFor, close: () => ctl.abort() };
  };

  let teacher: string, cabinet: string, group: string;

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
    const owner = (await call(a, 'POST', '/api/auth/register', undefined, {
      centerName: `Multi ${suffix}`, subdomain: `multi-${suffix}`, email: `multi-${suffix}@test.uz`, password: 'password123', fullName: 'Owner',
    })).accessToken as string;
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

    // Each stream heard each message exactly once (no echo from the second instance).
    await new Promise((r) => setTimeout(r, 300));
    const count = (s: { events: { event: string; data: { seq?: number } }[] }, seq: number) => s.events.filter((e) => e.event === 'message' && e.data.seq === seq).length;
    expect([count(cabOnB, m1.seq), count(cabOnB, m2.seq), count(teacherOnA, m1.seq), count(teacherOnA, m2.seq)]).toEqual([1, 1, 1, 1]);
    cabOnB.close();
    teacherOnA.close();
  });
});
