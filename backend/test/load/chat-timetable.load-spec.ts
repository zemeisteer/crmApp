import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { writeFileSync } from 'fs';
import { request as httpRequest } from 'http';
import type { AddressInfo } from 'net';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { ChatHub } from '../../src/chat/chat-hub.service.js';
import { DB, Database } from '../../src/db/db.module.js';
import { enrollments, groups, schedules, students, teachers } from '../../src/db/schema.js';

// What chat and the timetable cost under load, measured on the disposable
// e2e database with two API instances on one PostgreSQL (as behind a load
// balancer). Prints numbers; the only assertions are about correctness
// (every stream hears every message once, nobody is refused).
//
// Database work is counted as transactions (pg_stat_database: every
// statement outside an explicit transaction is one), read after the
// statistics have been flushed. No real nginx here - see the sprint report.
describe('load: chat streams and timetable conflict checks', () => {
  const apps: NestExpressApplication[] = [];
  const bases: string[] = [];
  let db: Database;
  const suffix = Date.now();
  const out: string[] = [];
  const say = (line: string) => { out.push(line); console.log(`[load] ${line}`); };
  let n = 0;
  const cid = () => `l${suffix}x${n++}`.padEnd(12, '0');

  const call = async (base: string, method: string, path: string, token?: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (res.status >= 400) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
  const transactions = async () => {
    // Statistics are reported by each backend when it goes idle, at most once a second.
    await new Promise((r) => setTimeout(r, 1300));
    const rows = await db.execute(sql`select (xact_commit + xact_rollback)::int as n from pg_stat_database where datname = current_database()`);
    return Number((rows as unknown as { rows: Array<{ n: number }> }).rows[0].n);
  };
  const stats = (ms: number[]) => {
    const s = [...ms].sort((a, b) => a - b);
    const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return `p50 ${at(0.5).toFixed(0)} ms, p95 ${at(0.95).toFixed(0)} ms, max ${s[s.length - 1].toFixed(0)} ms`;
  };

  type Stream = { seen: Set<number>; events: string[]; close: () => void };
  const open = async (base: string, path: string, token: string): Promise<Stream> => {
    const seen = new Set<number>();
    const events: string[] = [];
    const ctl = new AbortController();
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal });
    if (res.status !== 200) throw new Error(`stream ${res.status}`);
    let ready!: () => void;
    const isReady = new Promise<void>((r) => { ready = r; });
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
            if (!ev) continue;
            events.push(ev);
            if (ev === 'ready') ready();
            const data = /^data: (.*)$/m.exec(chunk)?.[1];
            if (ev === 'message' && data) seen.add(JSON.parse(data).seq);
          }
        }
      } catch {
        // closed
      }
    })();
    await isReady;
    return { seen, events, close: () => ctl.abort() };
  };
  const until = async (pred: () => boolean, ms = 20_000) => {
    const start = performance.now();
    while (!pred()) {
      if (performance.now() - start > ms) return -1;
      await new Promise((r) => setTimeout(r, 5));
    }
    return performance.now() - start;
  };

  let owner: string, cabinet: string, centerConv: string, tenantId: string;
  const staff: string[] = [];
  const toCenter = async (base: string) => {
    const t = performance.now();
    const seq = (await call(base, 'POST', `/api/portal/chat/conversations/${centerConv}/messages`, cabinet, { body: 'yuklama', clientMessageId: cid() })).message.seq as number;
    return { seq, post: performance.now() - t };
  };

  beforeAll(async () => {
    process.env.CHAT_HEARTBEAT_MS = '600000';
    for (let i = 0; i < 2; i++) {
      const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = mod.createNestApplication<NestExpressApplication>();
      configureApp(app);
      await app.listen(0, '127.0.0.1');
      apps.push(app);
      bases.push(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`);
    }
    db = apps[0].get<Database>(DB);
    const [a] = bases;
    const reg = await call(a, 'POST', '/api/auth/register', undefined, { centerName: `Load ${suffix}`, subdomain: `load-${suffix}`, email: `load-${suffix}@test.uz`, password: 'password123', fullName: 'Load Owner' });
    owner = reg.accessToken;
    tenantId = reg.tenant.id;
    staff.push(owner);
    for (let i = 0; i < 7; i++) {
      const inv = await call(a, 'POST', '/api/invitations', owner, { email: `load-s${i}-${suffix}@test.uz`, role: 'MANAGER' });
      staff.push((await call(a, 'POST', `/api/invitations/${inv.token}/accept`, undefined, { fullName: `Load Staff ${i}`, password: 'password12345' })).accessToken);
    }
    const g = (await call(a, 'POST', '/api/groups', owner, { name: 'Load G', subject: 'Math', scheduleDays: 'Dushanba', startTime: '06:00', endTime: '07:00' })).id;
    const phone = `+99893${String(suffix).slice(-7)}`;
    const s = (await call(a, 'POST', '/api/students', owner, { fullName: 'Load Student', phone, groupIds: [g] })).id;
    const { pin } = await call(a, 'POST', `/api/students/${s}/portal-pin`, owner);
    cabinet = (await call(a, 'POST', '/api/portal/auth/phone/verify', undefined, { phone, pin })).accessToken;
    centerConv = (await call(a, 'POST', '/api/portal/chat/conversations', cabinet, { kind: 'STUDENT_CENTER' })).id;
  });

  afterAll(async () => {
    for (const app of apps) await app.close();
    // The reporter may swallow console output of a passing test: the numbers also go to a file.
    writeFileSync(process.env.LOAD_RESULTS || 'load-results.txt', `${new Date().toISOString()}\n${out.join('\n')}\n`);
  });

  it('chat: many open streams on two instances', async () => {
    const streams: Stream[] = [];
    for (const target of [40, 160, 400]) {
      while (streams.length < target) {
        const batch = Array.from({ length: Math.min(40, target - streams.length) }, (_, i) => {
          const k = streams.length + i;
          return open(bases[k % 2], '/api/chat/stream', staff[k % staff.length]);
        });
        streams.push(...await Promise.all(batch));
      }
      const before = await transactions();
      const posts: number[] = [];
      const fanout: number[] = [];
      const rounds = 5;
      for (let r = 0; r < rounds; r++) {
        const { seq, post } = await toCenter(bases[r % 2]);
        posts.push(post);
        const t = await until(() => streams.every((s) => s.seen.has(seq)));
        expect(t).toBeGreaterThanOrEqual(0);
        fanout.push(t);
      }
      const used = (await transactions()) - before - 1;
      say(`chat, ${target} streams (${staff.length} users, 2 instances): send ${stats(posts)}; heard by all ${stats(fanout)}; ~${Math.round(used / rounds)} DB transactions per message`);
      // Exactly once each.
      expect(streams.every((s) => s.events.filter((e) => e === 'message').length === s.seen.size)).toBe(true);
    }

    // A client that stops reading must not hold the others up.
    const slow = await new Promise<{ destroy: () => void }>((resolve, reject) => {
      const u = new URL(`${bases[0]}/api/chat/stream`);
      const req = httpRequest({ host: u.hostname, port: u.port, path: u.pathname, headers: { Authorization: `Bearer ${owner}` } }, (res) => {
        res.pause(); // never read
        resolve({ destroy: () => req.destroy() });
      });
      req.on('error', reject);
      req.end();
    });
    const withSlow: number[] = [];
    for (let r = 0; r < 5; r++) {
      const { seq } = await toCenter(bases[1]);
      withSlow.push(await until(() => streams.every((s) => s.seen.has(seq))));
    }
    say(`chat, 400 streams + 1 client that never reads: heard by all ${stats(withSlow)}`);
    expect(withSlow.every((t) => t >= 0)).toBe(true);
    slow.destroy();

    // Reconnects: 200 streams drop and come back at once.
    const t0 = performance.now();
    for (const s of streams.splice(0, 200)) s.close();
    const back = await Promise.all(Array.from({ length: 200 }, (_, k) => open(bases[k % 2], '/api/chat/stream', staff[k % staff.length])));
    streams.push(...back);
    const reconnect = performance.now() - t0;
    await until(() => apps[0].get(ChatHub).size + apps[1].get(ChatHub).size === 400, 10_000);
    const open2 = apps[0].get(ChatHub).size + apps[1].get(ChatHub).size;
    const { seq } = await toCenter(bases[0]);
    const after = await until(() => streams.every((s) => s.seen.has(seq)));
    say(`chat, 200 of 400 streams reconnect at once: ${reconnect.toFixed(0)} ms to be back; ${open2} streams held; next message heard by all in ${after.toFixed(0)} ms`);
    expect(open2).toBe(400);
    expect(after).toBeGreaterThanOrEqual(0);

    // The LISTEN connection of one instance drops and comes back.
    const hub = apps[1].get(ChatHub) as unknown as { listener?: { connection?: { stream?: { destroy: () => void } } } };
    const onB = streams.filter((_, i) => i % 2 === 1);
    const resyncBefore = onB.map((s) => s.events.filter((e) => e === 'resync').length);
    hub.listener?.connection?.stream?.destroy();
    const t1 = performance.now();
    const recovered = await until(() => onB.every((s, i) => s.events.filter((e) => e === 'resync').length > resyncBefore[i]), 30_000);
    const m = await toCenter(bases[0]);
    const heard = await until(() => streams.every((s) => s.seen.has(m.seq)));
    say(`chat, LISTEN connection of one instance dropped: clients told to resync after ${recovered < 0 ? 'NEVER' : `${recovered.toFixed(0)} ms`}; the next message heard by all in ${heard.toFixed(0)} ms (${(performance.now() - t1).toFixed(0)} ms after the drop)`);
    expect(recovered).toBeGreaterThanOrEqual(0);
    expect(heard).toBeGreaterThanOrEqual(0);
    for (const s of streams) s.close();
  });

  it('timetable: conflict checks in a large center', async () => {
    // 200 groups, 3 lessons a week each, 30 teachers, 1500 students (each in two groups).
    const teacherIds = Array.from({ length: 30 }, () => createId());
    await db.insert(teachers).values(teacherIds.map((id, i) => ({ id, tenantId, fullName: `Load T${i}`, subject: 'Math' })));
    const groupIds = Array.from({ length: 200 }, () => createId());
    await db.insert(groups).values(groupIds.map((id, i) => ({ id, tenantId, name: `Load group ${i}`, subject: 'Math', teacherId: teacherIds[i % 30], maxStudents: 30, timetableManaged: true })));
    const rows = groupIds.flatMap((groupId, i) => [1, 3, 5].map((d, j) => {
      const hour = 7 + ((i + j) % 12);
      return { tenantId, groupId, teacherId: teacherIds[i % 30], dayOfWeek: ((d + i) % 7) + 1, startTime: `${String(hour).padStart(2, '0')}:00`, endTime: `${String(hour + 1).padStart(2, '0')}:00`, isRecurring: true };
    }));
    await db.insert(schedules).values(rows);
    const studentIds = Array.from({ length: 1500 }, () => createId());
    for (let i = 0; i < studentIds.length; i += 500) {
      await db.insert(students).values(studentIds.slice(i, i + 500).map((id, k) => ({ id, tenantId, fullName: `Load S${i + k}`, phone: `+99897${String(1000000 + i + k)}` })));
    }
    const pairs = studentIds.flatMap((studentId, i) => [groupIds[i % 200], groupIds[(i * 7 + 3) % 200]].filter((g, k, all) => all.indexOf(g) === k).map((groupId) => ({ tenantId, studentId, groupId })));
    for (let i = 0; i < pairs.length; i += 1000) await db.insert(enrollments).values(pairs.slice(i, i + 1000));

    const check = async (i: number) => {
      const t = performance.now();
      const r = await call(bases[i % 2], 'POST', '/api/schedule/check-conflict', owner, { groupId: groupIds[i % 200], teacherId: teacherIds[(i * 3) % 30], dayOfWeek: (i % 7) + 1, startTime: '10:30', endTime: '11:30' });
      return { ms: performance.now() - t, conflicts: r.conflicts.length as number };
    };
    await check(0);
    const before = await transactions();
    const one: number[] = [];
    let found = 0;
    for (let i = 0; i < 30; i++) {
      const r = await check(i);
      one.push(r.ms);
      found += r.conflicts;
    }
    const used = (await transactions()) - before - 1;
    say(`timetable, 600 weekly lessons / 200 groups / 1500 students: check-conflict one at a time ${stats(one)}; ~${Math.round(used / 30)} DB transactions per check; ${found} clashes reported in 30 checks`);
    const t = performance.now();
    const many = await Promise.all(Array.from({ length: 40 }, (_, i) => check(i)));
    say(`timetable, 40 checks at once: ${stats(many.map((m) => m.ms))}; all done in ${(performance.now() - t).toFixed(0)} ms`);

    // A real write: a lesson moved with the timetable lock, the check and the make-up reconcile.
    const list = await call(bases[0], 'GET', `/api/schedule?groupId=${groupIds[0]}`, owner);
    const moves: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t2 = performance.now();
      await call(bases[i % 2], 'PATCH', `/api/schedule/${list[0].id}`, owner, { startTime: `${String(20 + (i % 2)).padStart(2, '0')}:00`, endTime: `${String(21 + (i % 2)).padStart(2, '0')}:00`, allowCollision: true });
      moves.push(performance.now() - t2);
    }
    say(`timetable, moving one lesson (lock + check + reconcile): ${stats(moves)}`);
  });
});
