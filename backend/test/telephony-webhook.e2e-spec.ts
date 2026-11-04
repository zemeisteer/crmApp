import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { callEvents, calls, leadActivities, leads, telephonyAccounts } from '../src/db/schema.js';
import { zadarmaWebhookSignature } from '../src/telephony/providers/zadarma.provider.js';

// The call webhook (telephony/): each center's events reach it under that
// center's own token and must be signed with that center's secret; a
// repeated delivery changes nothing; a number is matched to the center's
// lead, student or parent, and an unknown incoming number opens a lead -
// answered or missed. Another center's token, secret or people never mix in.
describe('Telephony webhook (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  type Center = { token: string; tenantId: string; ownerId: string; hook: string; secret: string };
  const center: Record<'A' | 'B', Center> = {} as never;
  let studentA = '';
  let leadA = '';
  let n = 0;
  const callId = () => `in_${suffix}_${++n}`;
  // Unique numbers per run: the e2e database is shared by every suite.
  const num = (i: number) => `+99893${String(suffix).slice(-5)}${String(i).padStart(2, '0')}`;

  const as = (k: 'A' | 'B') => ({ Authorization: `Bearer ${center[k].token}` });
  const send = (k: 'A' | 'B', body: Record<string, string>, opts: { secret?: string; token?: string } = {}) =>
    http()
      .post(`/api/telephony/webhook/${opts.token ?? center[k].hook}`)
      .type('form')
      .set('Signature', zadarmaWebhookSignature(body, opts.secret ?? center[k].secret) ?? '')
      .send(body);
  const ev = {
    start: (id: string, from: string) => ({ event: 'NOTIFY_START', call_start: '2026-11-04 10:00:00', pbx_call_id: id, caller_id: from, called_did: '+998712000000' }),
    internal: (id: string, from: string, ext: string) => ({ event: 'NOTIFY_INTERNAL', call_start: '2026-11-04 10:00:00', pbx_call_id: id, caller_id: from, called_did: '+998712000000', internal: ext }),
    answer: (id: string, from: string, ext: string) => ({ event: 'NOTIFY_ANSWER', call_start: '2026-11-04 10:00:00', pbx_call_id: id, caller_id: from, destination: ext, internal: ext }),
    end: (id: string, from: string, disposition: string, duration: string, extra: Record<string, string> = {}) => ({
      event: 'NOTIFY_END', call_start: '2026-11-04 10:00:00', pbx_call_id: id, caller_id: from, called_did: '+998712000000',
      duration, disposition, status_code: '16', is_recorded: '0', call_id_with_rec: '', ...extra,
    }),
  };
  const callOf = async (k: 'A' | 'B', id: string) =>
    (await db.select().from(calls).where(and(eq(calls.tenantId, center[k].tenantId), eq(calls.providerCallId, id))))[0];
  const leadsWith = async (k: 'A' | 'B', phone: string) =>
    db.select().from(leads).where(and(eq(leads.tenantId, center[k].tenantId), eq(leads.phoneNormalized, phone)));

  beforeAll(async () => {
    process.env.SETTINGS_KEY = randomBytes(32).toString('base64');
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    for (const k of ['A', 'B'] as const) {
      const reg = (await http().post('/api/auth/register')
        .send({ centerName: `Tel ${k} ${suffix}`, subdomain: `tel-${k.toLowerCase()}-${suffix}`, email: `tel-${k}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${k}` })
        .expect(201)).body;
      center[k] = { token: reg.accessToken, tenantId: reg.tenant?.id ?? reg.user.tenantId, ownerId: reg.user.id, hook: '', secret: `${k}-secret-${suffix}` };
    }
    studentA = (await http().post('/api/students').set(as('A')).send({ fullName: 'Talaba Bir', phone: num(1), parentPhone: num(2) }).expect(201)).body.id;
    leadA = (await http().post('/api/leads').set(as('A')).send({ fullName: 'Lid Bir', phone: num(3) }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('saves the account: the secret is sealed and never shown; the extension must be our own staff', async () => {
    for (const k of ['A', 'B'] as const) {
      await http().put('/api/telephony/settings').set(as(k)).send({ provider: 'MOCK', apiKey: `key${k}` }).expect(400); // a new account needs its secret
      const saved = (await http().put('/api/telephony/settings').set(as(k)).send({ provider: 'MOCK', apiKey: `key${k}1234`, apiSecret: center[k].secret }).expect(200)).body;
      expect(saved).toMatchObject({ connected: true, provider: 'MOCK', apiKeyHint: '…1234', callsVisibility: 'OWN', recordingsAccess: 'ADMINS' });
      expect(JSON.stringify(saved)).not.toContain(center[k].secret);
      center[k].hook = saved.webhookUrl.split('/telephony/webhook/')[1];
      const [row] = await db.select().from(telephonyAccounts).where(eq(telephonyAccounts.tenantId, center[k].tenantId));
      expect(row.apiSecret).not.toContain(center[k].secret);
    }
    expect(center.A.hook).not.toBe(center.B.hook);
    await http().put('/api/telephony/extensions').set(as('A')).send({ items: [{ extension: '100', userId: center.A.ownerId }] }).expect(200);
    // B's owner is not A's staff.
    await http().put('/api/telephony/extensions').set(as('A')).send({ items: [{ extension: '101', userId: center.B.ownerId }] }).expect(400);
    await http().put('/api/telephony/extensions').set(as('A')).send({ items: [{ extension: '1x', userId: center.A.ownerId }] }).expect(400);
    await http().put('/api/telephony/settings').set(as('A')).send({ provider: 'ZOOM', apiKey: 'k', apiSecret: 's' }).expect(400);
  });

  it("answers Zadarma's URL check; an unknown token is 404", async () => {
    const r = await http().get(`/api/telephony/webhook/${center.A.hook}?zd_echo=abc123`).expect(200);
    expect(r.text).toBe('abc123');
    await http().get('/api/telephony/webhook/unknown-token-unknown-token?zd_echo=x').expect(404);
  });

  it('refuses a bad signature, another center\'s secret, and an unknown token; nothing is stored', async () => {
    const id = callId();
    const body = ev.start(id, num(10));
    await send('A', body, { secret: 'wrong' }).expect(403);
    await send('A', body, { secret: center.B.secret }).expect(403);
    await http().post(`/api/telephony/webhook/${center.A.hook}`).type('form').send(body).expect(403); // no Signature header
    await send('A', body, { token: 'no-such-token-no-such-token' }).expect(404);
    expect(await callOf('A', id)).toBeUndefined();
    expect(await db.select().from(callEvents).where(eq(callEvents.tenantId, center.A.tenantId))).toHaveLength(0);
  });

  it('an unknown number: one call, one new lead (source PHONE), however often the provider repeats itself', async () => {
    const id = callId();
    const from = num(11);
    await send('A', ev.start(id, from)).expect(200);
    await send('A', ev.start(id, from)).expect(200); // repeated delivery
    await send('A', ev.internal(id, from, '100')).expect(200);
    await send('A', ev.answer(id, from, '100')).expect(200);
    await send('A', ev.end(id, from, 'answered', '95')).expect(200);
    await send('A', ev.end(id, from, 'answered', '95')).expect(200); // repeated again

    const call = await callOf('A', id);
    expect(call).toMatchObject({
      direction: 'INBOUND', status: 'ANSWERED', durationSec: 95, extension: '100', managerUserId: center.A.ownerId,
      clientNumber: from, contactKind: 'LEAD', createdLead: true, disposition: 'answered',
    });
    expect(call.endedAt).not.toBeNull();
    const made = await leadsWith('A', from);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ source: 'PHONE', fullName: from.replace(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/, '+998 $1 $2 $3 $4') });
    expect(call.leadId).toBe(made[0].id);
    expect(await db.select().from(callEvents).where(and(eq(callEvents.tenantId, center.A.tenantId), eq(callEvents.callId, call.id)))).toHaveLength(4);
    // The finished call is on the lead's timeline once.
    const notes = await db.select().from(leadActivities).where(and(eq(leadActivities.leadId, made[0].id), eq(leadActivities.type, 'CALL')));
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe("Kiruvchi qo'ng'iroq, 1:35");

    // The same person calls again: the same lead, no second one.
    const again = callId();
    await send('A', ev.start(again, from)).expect(200);
    expect((await callOf('A', again)).leadId).toBe(made[0].id);
    expect((await callOf('A', again)).createdLead).toBe(false);
    expect(await leadsWith('A', from)).toHaveLength(1);
  });

  it('a missed call from an unknown number is MISSED and still opens a lead, to call back', async () => {
    const id = callId();
    const from = num(12);
    await send('A', ev.start(id, from)).expect(200);
    await send('A', ev.internal(id, from, '100')).expect(200);
    await send('A', ev.end(id, from, 'no answer', '0')).expect(200);
    const call = await callOf('A', id);
    expect(call).toMatchObject({ status: 'MISSED', durationSec: 0, disposition: 'no answer', contactKind: 'LEAD', createdLead: true });
    expect(await leadsWith('A', from)).toHaveLength(1);
    const notes = await db.select().from(leadActivities).where(and(eq(leadActivities.leadId, call.leadId!), eq(leadActivities.type, 'CALL')));
    expect(notes.map((x) => x.body)).toEqual(["Javobsiz kiruvchi qo'ng'iroq"]);
  });

  it('a known number opens no lead: the student, the parent (on the child\'s card), the existing lead', async () => {
    const cases: Array<[string, string, string | null, string | null]> = [
      [num(1), 'STUDENT', null, studentA],
      // Written the way a provider may send it: without the plus.
      [num(2).slice(1), 'PARENT', null, studentA],
      [num(3), 'LEAD', leadA, null],
    ];
    for (const [from, kind, lead, student] of cases) {
      const id = callId();
      await send('A', ev.start(id, from)).expect(200);
      expect(await callOf('A', id)).toMatchObject({ contactKind: kind, leadId: lead, studentId: student, createdLead: false });
    }
    expect(await leadsWith('A', num(1))).toHaveLength(0);
    expect(await leadsWith('A', num(2))).toHaveLength(0);
    expect(await leadsWith('A', num(3))).toHaveLength(1);
  });

  it("centers never mix: A's student calling B is a stranger to B; the same provider call id is two calls", async () => {
    const id = `shared_${suffix}`;
    await send('A', ev.start(id, num(1))).expect(200);
    await send('B', ev.start(id, num(1))).expect(200);
    const a = await callOf('A', id);
    const b = await callOf('B', id);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ contactKind: 'STUDENT', studentId: studentA });
    expect(b).toMatchObject({ contactKind: 'LEAD', createdLead: true, studentId: null });
    const [bLead] = await leadsWith('B', num(1));
    expect(bLead.tenantId).toBe(center.B.tenantId);
    expect(b.leadId).toBe(bLead.id);
    // A's token with B's (valid) signature: refused.
    await send('A', ev.start(callId(), num(20)), { secret: center.B.secret }).expect(403);
  });

  it('events out of order: an end before the start is one call, and a late leg never undoes the answer', async () => {
    const id = callId();
    const from = num(13);
    await send('A', ev.end(id, from, 'answered', '40')).expect(200);
    await send('A', ev.start(id, from)).expect(200);
    await send('A', ev.end(id, from, 'cancel', '0', { internal: '101' })).expect(200); // another extension's leg
    const call = await callOf('A', id);
    expect(call).toMatchObject({ status: 'ANSWERED', durationSec: 40, direction: 'INBOUND' });
    expect(await leadsWith('A', from)).toHaveLength(1);
  });

  it('the recording, when ready, is kept as the provider id (the link is asked for on play)', async () => {
    const id = callId();
    const from = num(14);
    await send('A', ev.start(id, from)).expect(200);
    await send('A', ev.end(id, from, 'answered', '12', { is_recorded: '1', call_id_with_rec: `rec_${suffix}` })).expect(200);
    await send('A', { event: 'NOTIFY_RECORD', pbx_call_id: id, call_id_with_rec: `rec_${suffix}` }).expect(200);
    expect(await callOf('A', id)).toMatchObject({ hasRecording: true, recordingRef: `rec_${suffix}` });
  });

  it('an outgoing call to an unknown number opens no lead; events it does not use are accepted and ignored', async () => {
    const id = `out_${suffix}`;
    await send('A', { event: 'NOTIFY_OUT_START', call_start: '2026-11-04 11:00:00', pbx_call_id: id, internal: '100', destination: num(15).slice(1) }).expect(200);
    await send('A', {
      event: 'NOTIFY_OUT_END', call_start: '2026-11-04 11:00:00', pbx_call_id: id, internal: '100', destination: num(15).slice(1),
      caller_id: '100', duration: '30', disposition: 'answered', is_recorded: '0', call_id_with_rec: '',
    }).expect(200);
    expect(await callOf('A', id)).toMatchObject({ direction: 'OUTBOUND', status: 'ANSWERED', durationSec: 30, extension: '100', contactKind: 'UNKNOWN', clientNumber: num(15) });
    expect(await leadsWith('A', num(15))).toHaveLength(0);
    // An IVR event: stored once, the call untouched.
    await send('A', { event: 'NOTIFY_IVR', call_start: 'x', pbx_call_id: `ivr_${suffix}`, caller_id: num(16), called_did: '1' }).expect(200);
    expect(await callOf('A', `ivr_${suffix}`)).toBeUndefined();
    // Not a call event at all.
    await send('A', { event: 'SMS', result: '{}' }).expect(200);
  });

  it('a switched-off account ignores events; a new token retires the old address', async () => {
    await http().put('/api/telephony/settings').set(as('B')).send({ provider: 'MOCK', apiKey: 'keyB1234', enabled: false }).expect(200);
    const id = callId();
    await send('B', ev.start(id, num(17))).expect(200);
    expect(await callOf('B', id)).toBeUndefined();
    const old = center.B.hook;
    const rotated = (await http().post('/api/telephony/settings/rotate-token').set(as('B')).expect(200)).body;
    center.B.hook = rotated.webhookUrl.split('/telephony/webhook/')[1];
    expect(center.B.hook).not.toBe(old);
    await send('B', ev.start(callId(), num(18)), { token: old }).expect(404);
  });

  it('settings are for the owner and admins only; a manager can be given an extension', async () => {
    await http().get('/api/telephony/settings').expect(401);
    const inv = await http().post('/api/invitations').set(as('A')).send({ email: `tel-m-${suffix}@test.uz`, role: 'MANAGER' }).expect(201);
    const acc = await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: 'Manager A', password: 'password12345' }).expect(201);
    const manager = { Authorization: `Bearer ${acc.body.accessToken}` };
    await http().get('/api/telephony/settings').set(manager).expect(403);
    await http().put('/api/telephony/settings').set(manager).send({ provider: 'MOCK', apiKey: 'x', apiSecret: 'y' }).expect(403);
    const view = (await http().put('/api/telephony/extensions').set(as('A'))
      .send({ items: [{ extension: '100', userId: center.A.ownerId }, { extension: '101', userId: acc.body.user.id }] }).expect(200)).body;
    expect(view.extensions.map((e: { extension: string; fullName: string }) => `${e.extension}:${e.fullName}`)).toEqual(['100:Owner A', '101:Manager A']);
    // The manager's extension rings: the call is theirs.
    const id = callId();
    await send('A', ev.start(id, num(19))).expect(200);
    await send('A', ev.answer(id, num(19), '101')).expect(200);
    expect((await callOf('A', id)).managerUserId).toBe(acc.body.user.id);
  });

  it('made-up tokens are cut off per address (429), while a real token keeps working', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) {
      codes.push((await http().post(`/api/telephony/webhook/made-up-token-${i}-${suffix}`).type('form').send({ event: 'NOTIFY_START' })).status);
    }
    expect(codes.filter((c) => c === 404).length).toBeGreaterThanOrEqual(20);
    expect(codes.at(-1)).toBe(429);
  });
});
