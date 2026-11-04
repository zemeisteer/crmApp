import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, type Database } from '../src/db/db.module.js';
import { calls, leads } from '../src/db/schema.js';
import { zadarmaWebhookSignature } from '../src/telephony/providers/zadarma.provider.js';

// What staff do with calls (telephony step 3): the live popup reaches only
// the one whose extension rings and closes when the call is taken; the log
// shows a manager only their own calls unless the owner chose "all";
// recordings play for owner and admins unless the owner opened them up;
// click-to-call rings the manager's own extension; a lead a call opened goes
// to whoever answered; the statistics count per manager. Another center's
// calls are never reachable.
describe('Telephony calls (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  let base = '';
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  type Who = { token: string; userId: string };
  let owner: Who, m1: Who, m2: Who, ownerB: Who;
  let tenantA = '', tenantB = '', hookA = '', hookB = '';
  const SECRET_A = `a-${suffix}`;
  const SECRET_B = `b-${suffix}`;
  let studentA = '';
  let n = 0;
  const callId = () => `c_${suffix}_${++n}`;
  const num = (i: number) => `+99894${String(suffix).slice(-5)}${String(i).padStart(2, '0')}`;

  const hook = (h: string, secret: string, body: Record<string, string>) =>
    http().post(`/api/telephony/webhook/${h}`).type('form').set('Signature', zadarmaWebhookSignature(body, secret)!).send(body).expect(200);
  const at = '2026-11-04 12:00:00';
  const startEv = (id: string, from: string) => ({ event: 'NOTIFY_START', call_start: at, pbx_call_id: id, caller_id: from, called_did: '+998712000000' });
  const ringEv = (id: string, from: string, ext: string) => ({ ...startEv(id, from), event: 'NOTIFY_INTERNAL', internal: ext });
  const answerEv = (id: string, from: string, ext: string) => ({ event: 'NOTIFY_ANSWER', call_start: at, pbx_call_id: id, caller_id: from, destination: ext, internal: ext });
  const endEv = (id: string, from: string, ext: string, disposition: string, duration: string, rec = '') => ({
    ...startEv(id, from), event: 'NOTIFY_END', internal: ext, duration, disposition, status_code: '16', is_recorded: rec ? '1' : '0', call_id_with_rec: rec,
  });
  /** A whole incoming call to `ext`, answered (talk seconds) or missed. */
  const wholeCall = async (from: string, ext: string, talk: number | null, rec = '') => {
    const id = callId();
    await hook(hookA, SECRET_A, startEv(id, from));
    await hook(hookA, SECRET_A, ringEv(id, from, ext));
    if (talk !== null) await hook(hookA, SECRET_A, answerEv(id, from, ext));
    await hook(hookA, SECRET_A, endEv(id, from, ext, talk !== null ? 'answered' : 'no answer', String(talk ?? 0), rec));
    const [c] = await db.select().from(calls).where(and(eq(calls.tenantId, tenantA), eq(calls.providerCallId, id)));
    return c;
  };

  const stream = async (token: string) => {
    const events: { event: string; data: { callId?: string; phase?: string } }[] = [];
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/calls/stream`, { headers: bearer(token), signal: ctl.signal });
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
    const waitFor = async (pred: () => boolean, ms = 3000) => {
      const end = Date.now() + ms;
      while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      return pred();
    };
    await waitFor(() => events.some((e) => e.event === 'ready'));
    return { status: res.status, events, close: () => ctl.abort(), waitFor };
  };

  const register = async (tag: string): Promise<Who & { tenantId: string }> => {
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Calls ${tag} ${suffix}`, subdomain: `calls-${tag}-${suffix}`, email: `calls-${tag}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${tag}` })
      .expect(201)).body;
    return { token: reg.accessToken, userId: reg.user.id, tenantId: reg.tenant?.id ?? reg.user.tenantId };
  };
  const invite = async (ownerToken: string, role: string, tag: string): Promise<Who> => {
    const inv = await http().post('/api/invitations').set(bearer(ownerToken)).send({ email: `calls-${tag}-${suffix}@test.uz`, role }).expect(201);
    const acc = await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: `${role} ${tag}`, password: 'password12345' }).expect(201);
    return { token: acc.body.accessToken, userId: acc.body.user.id };
  };

  beforeAll(async () => {
    process.env.SETTINGS_KEY = randomBytes(32).toString('base64');
    process.env.CALLS_HEARTBEAT_MS = '300';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      // One address sends every request here; the limits have their own suites.
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    db = app.get<Database>(DB);

    const a = await register('a');
    owner = a; tenantA = a.tenantId;
    m1 = await invite(owner.token, 'MANAGER', 'm1');
    m2 = await invite(owner.token, 'MANAGER', 'm2');
    const b = await register('b');
    ownerB = b; tenantB = b.tenantId;

    hookA = (await http().put('/api/telephony/settings').set(bearer(owner.token)).send({ provider: 'MOCK', apiKey: 'keyA', apiSecret: SECRET_A }).expect(200)).body.webhookUrl.split('/webhook/')[1];
    hookB = (await http().put('/api/telephony/settings').set(bearer(ownerB.token)).send({ provider: 'MOCK', apiKey: 'keyB', apiSecret: SECRET_B }).expect(200)).body.webhookUrl.split('/webhook/')[1];
    await http().put('/api/telephony/extensions').set(bearer(owner.token))
      .send({ items: [{ extension: '100', userId: owner.userId }, { extension: '101', userId: m1.userId }, { extension: '102', userId: m2.userId }] }).expect(200);
    studentA = (await http().post('/api/students').set(bearer(owner.token)).send({ fullName: 'Card Student', phone: num(1), notes: "Kechki guruhga qiziqadi" }).expect(201)).body.id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('the popup rings only the manager whose extension rings, and closes for them when the call is taken', async () => {
    const s1 = await stream(m1.token);
    const s2 = await stream(m2.token);
    expect(s1.status).toBe(200);
    const id = callId();
    const from = num(2);
    await hook(hookA, SECRET_A, startEv(id, from));
    await hook(hookA, SECRET_A, ringEv(id, from, '101'));
    expect(await s1.waitFor(() => s1.events.some((e) => e.event === 'call' && e.data.phase === 'ringing'))).toBe(true);
    const ringing = s1.events.find((e) => e.event === 'call')!;
    await hook(hookA, SECRET_A, answerEv(id, from, '101'));
    await hook(hookA, SECRET_A, endEv(id, from, '101', 'answered', '20'));
    expect(await s1.waitFor(() => s1.events.some((e) => e.data.phase === 'ended' && e.data.callId === ringing.data.callId))).toBe(true);
    expect(s1.events.some((e) => e.data.phase === 'answered')).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(s2.events.some((e) => e.event === 'call')).toBe(false);

    // The card behind the popup: who it is (a lead this call opened, assigned to m1 who answered).
    const card = (await http().get(`/api/calls/${ringing.data.callId}/card`).set(bearer(m1.token)).expect(200)).body;
    expect(card.contact).toMatchObject({ kind: 'LEAD', status: 'NEW', source: 'PHONE' });
    const [lead] = await db.select().from(leads).where(and(eq(leads.tenantId, tenantA), eq(leads.phoneNormalized, from)));
    expect(lead.assignedManagerUserId).toBe(m1.userId);
    s1.close();
    s2.close();
  });

  it("a missed call's lead stays unassigned; a known student's card shows their notes", async () => {
    const missed = await wholeCall(num(3), '101', null);
    const [lead] = await db.select().from(leads).where(and(eq(leads.tenantId, tenantA), eq(leads.id, missed.leadId!)));
    expect(lead.assignedManagerUserId).toBeNull();
    const known = await wholeCall(num(1), '100', 30);
    const card = (await http().get(`/api/calls/${known.id}/card`).set(bearer(owner.token)).expect(200)).body;
    expect(card.contact).toMatchObject({ kind: 'STUDENT', id: studentA, name: 'Card Student', notes: 'Kechki guruhga qiziqadi', href: `/students/${studentA}` });
  });

  it('a manager sees only their own calls unless the owner chooses "all"; the owner always sees all', async () => {
    await wholeCall(num(4), '101', 10);
    const m2call = await wholeCall(num(5), '102', 15);
    const mine = (await http().get('/api/calls').set(bearer(m1.token)).expect(200)).body.items;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c: { managerUserId: string }) => c.managerUserId === m1.userId)).toBe(true);
    await http().get(`/api/calls/${m2call.id}/card`).set(bearer(m1.token)).expect(404);
    const all = (await http().get('/api/calls?limit=200').set(bearer(owner.token)).expect(200)).body.items;
    expect(all.some((c: { id: string }) => c.id === m2call.id)).toBe(true);

    await http().patch('/api/telephony/settings').set(bearer(owner.token)).send({ callsVisibility: 'ALL' }).expect(200);
    await http().get(`/api/calls/${m2call.id}/card`).set(bearer(m1.token)).expect(200);
    await http().patch('/api/telephony/settings').set(bearer(owner.token)).send({ callsVisibility: 'OWN' }).expect(200);

    // A contact's history (the card's "Calls" tab).
    const forStudent = (await http().get(`/api/calls?studentId=${studentA}`).set(bearer(owner.token)).expect(200)).body.items;
    expect(forStudent.length).toBeGreaterThan(0);
    expect(forStudent.every((c: { studentId: string }) => c.studentId === studentA)).toBe(true);
  });

  it("another center's calls are out of reach, however they are asked for", async () => {
    const id = callId();
    await hook(hookB, SECRET_B, startEv(id, num(6)));
    const [bCall] = await db.select().from(calls).where(and(eq(calls.tenantId, tenantB), eq(calls.providerCallId, id)));
    await http().get(`/api/calls/${bCall.id}/card`).set(bearer(owner.token)).expect(404);
    await http().get(`/api/calls/${bCall.id}/recording`).set(bearer(owner.token)).expect(404);
    const listed = (await http().get(`/api/calls?leadId=${bCall.leadId}`).set(bearer(owner.token)).expect(200)).body.items;
    expect(listed).toEqual([]);
    const bList = (await http().get('/api/calls').set(bearer(ownerB.token)).expect(200)).body.items;
    expect(bList.every((c: { id: string }) => c.id === bCall.id)).toBe(true);
  });

  it('recordings play for owner and admins only, unless the owner opens them to whoever sees the call', async () => {
    const c = await wholeCall(num(7), '101', 25, `rec_${suffix}`);
    await http().get(`/api/calls/${c.id}/recording`).set(bearer(m1.token)).expect(403);
    const link = (await http().get(`/api/calls/${c.id}/recording`).set(bearer(owner.token)).expect(200)).body;
    expect(link.url).toContain(`rec_${suffix}`);
    const listed = (await http().get('/api/calls').set(bearer(m1.token)).expect(200)).body.items.find((x: { id: string }) => x.id === c.id);
    expect(listed).toMatchObject({ hasRecording: true, canPlay: false });
    await http().patch('/api/telephony/settings').set(bearer(owner.token)).send({ recordingsAccess: 'CALL_VIEWERS' }).expect(200);
    await http().get(`/api/calls/${c.id}/recording`).set(bearer(m1.token)).expect(200);
    // Still only calls they can see.
    await http().get(`/api/calls/${c.id}/recording`).set(bearer(m2.token)).expect(404);
    const noRec = await wholeCall(num(8), '101', 5);
    await http().get(`/api/calls/${noRec.id}/recording`).set(bearer(m1.token)).expect(404);
  });

  it("click-to-call rings the manager's own extension; the call then appears as theirs", async () => {
    await http().post('/api/calls/click-to-call').set(bearer(m1.token)).send({ phone: '123' }).expect(400);
    const res = (await http().post('/api/calls/click-to-call').set(bearer(m1.token)).send({ phone: `${num(9).slice(4)}` }).expect(200)).body;
    expect(res).toMatchObject({ ok: true, extension: '101' });
    // The mock plays the provider's part: out start, answer, end.
    const deadline = Date.now() + 8000;
    let out: typeof calls.$inferSelect | undefined;
    while (Date.now() < deadline) {
      [out] = await db.select().from(calls).where(and(eq(calls.tenantId, tenantA), eq(calls.clientNumber, num(9))));
      if (out?.endedAt) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(out).toMatchObject({ direction: 'OUTBOUND', status: 'ANSWERED', extension: '101', managerUserId: m1.userId });
    // Without an extension there is nothing to ring.
    const m3 = await invite(owner.token, 'MANAGER', 'm3');
    const r = await http().post('/api/calls/click-to-call').set(bearer(m3.token)).send({ phone: num(9) }).expect(400);
    expect(r.body.message).toContain('ichki raqam');
  });

  it('statistics: per manager, missed calls and average talk time, per day; center-wide for the owner only', async () => {
    const s = (await http().get('/api/calls/stats?period=day').set(bearer(owner.token)).expect(200)).body;
    expect(s.timezone).toBe('Asia/Tashkent');
    expect(s.totals.total).toBeGreaterThanOrEqual(8);
    expect(s.totals.missed).toBeGreaterThanOrEqual(1);
    const m1row = s.byManager.find((r: { userId: string }) => r.userId === m1.userId);
    expect(m1row.answered).toBeGreaterThanOrEqual(3);
    expect(m1row.missed).toBeGreaterThanOrEqual(1);
    expect(m1row.avgTalkSec).toBe(Math.round(m1row.talkSec / m1row.answered));
    expect(s.series).toHaveLength(1);
    expect(s.series[0].total).toBe(s.totals.total);
    await http().get('/api/calls/stats').set(bearer(m1.token)).expect(403);
    await http().get('/api/calls/stats?from=2020-01-01&to=2026-12-31').set(bearer(owner.token)).expect(400);
    // B's calls are not in A's numbers.
    const sb = (await http().get('/api/calls/stats').set(bearer(ownerB.token)).expect(200)).body;
    expect(sb.totals.total).toBe(1);
  });

  it("a staff member removed from the center: the popup stream closes and tells them so", async () => {
    const s = await stream(m2.token);
    await http().delete(`/api/staff/${m2.userId}`).set(bearer(owner.token)).expect(200);
    expect(await s.waitFor(() => s.events.some((e) => e.event === 'revoked'), 3000)).toBe(true);
    s.close();
    await http().get('/api/calls').set(bearer(m2.token)).expect(401);
  });
});
