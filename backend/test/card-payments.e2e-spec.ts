import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { and, eq, like, sql } from 'drizzle-orm';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { NoticeOutboxService } from '../src/notice-outbox/notice-outbox.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { DB, Database } from '../src/db/db.module.js';
import { auditLogs, noticeOutbox, paymentAllocations, paymentClaims, payments } from '../src/db/schema.js';

// Paying by card transfer: the center shows its card in the cabinet, the
// student sends a receipt, the staff hear of it in Telegram and confirm it -
// only then is it a payment, once - or reject it with a reason. The
// payment, its allocations, the receipt's state, the audit rows and the
// messages (outbox) are one transaction: never a payment beside a receipt
// still waiting, never PAID beside REJECTED.
describe('Card transfer payments (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let outbox: NoticeOutboxService;
  const suffix = Date.now();
  const tail = String(suffix).slice(-7);
  const http = () => request(app.getHttpServer());
  let owner: Record<string, string>;
  let admin2: Record<string, string>;
  let portal: Record<string, string>;
  let studentId: string;
  // What Telegram was asked to deliver (the outbox worker's only way out).
  const delivered: Array<{ chat: string; text: string }> = [];
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const studentChat = `5${tail}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get(DB);
    outbox = app.get(NoticeOutboxService);
    const tg = app.get(TelegramService);
    tg.deliverMessage = (async (chat: string, text: string) => {
      delivered.push({ chat, text });
      return { ok: true, messageId: String(delivered.length) };
    }) as typeof tg.deliverMessage;

    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Card ${suffix}`, subdomain: `card-${suffix}`, email: `card-${suffix}@test.uz`, password: 'password123', fullName: 'Card Owner' })
      .expect(201)).body;
    owner = { Authorization: `Bearer ${reg.accessToken}` };
    const { users, students } = await import('../src/db/schema.js');
    await db.update(users).set({ telegramChatId: `3${tail}` }).where(eq(users.id, reg.user.id));

    await http().post('/api/staff').set(owner).send({ email: `card-a2-${suffix}@test.uz`, fullName: 'Second Admin', role: 'ADMIN', password: 'password12345' }).expect(201);
    admin2 = { Authorization: `Bearer ${(await http().post('/api/auth/login').send({ email: `card-a2-${suffix}@test.uz`, password: 'password12345' }).expect(201)).body.accessToken}` };

    const phone = `+99894${tail}`;
    const g = (await http().post('/api/groups').set(owner).send({ name: 'Card Group', subject: 'Math', monthlyPrice: 400_000 }).expect(201)).body.id as string;
    studentId = (await http().post('/api/students').set(owner).send({ fullName: 'Card Payer', phone, groupIds: [g] }).expect(201)).body.id;
    await db.update(students).set({ telegramChatId: studentChat }).where(eq(students.id, studentId));
    // One big invoice for the month the receipts are for: every payment lands on it.
    await http().post('/api/invoices').set(owner).send({ studentId, amount: 9_000_000, dueDate: '2026-11-10', forMonth: '2026-11' }).expect(201);
    const { pin } = (await http().post(`/api/students/${studentId}/portal-pin`).set(owner).expect(201)).body;
    portal = { Authorization: `Bearer ${(await http().post('/api/portal/auth/phone/verify').send({ phone, pin }).expect(201)).body.accessToken}` };
  });

  afterAll(async () => {
    await app?.close();
  });

  const send = (amount: string, file = true) => {
    const r = http().post('/api/portal/card-payment').set(portal).field('amount', amount).field('forMonth', '2026-11');
    return file ? r.attach('file', png, { filename: 'chek.png', contentType: 'image/png' }) : r;
  };
  /** A receipt as the cabinet makes it (the cabinet's own limit, 10 a minute, is not what these tests are about). */
  const newClaim = async (amount: number) => {
    const [{ tenantId }] = await db.select({ tenantId: paymentClaims.tenantId }).from(paymentClaims).where(eq(paymentClaims.studentId, studentId)).limit(1);
    const [row] = await db.insert(paymentClaims).values({ tenantId, studentId, amount, forMonth: '2026-11', receiptFile: `seed-${amount}.png` }).returning();
    return row;
  };
  const confirm = (id: string, body: object = {}, who = owner) => http().post(`/api/card-payments/claims/${id}/confirm`).set(who).send(body);
  const reject = (id: string, reason = 'Pul kelmadi', who = owner) => http().post(`/api/card-payments/claims/${id}/reject`).set(who).send({ reason });
  const claimRow = async (id: string) => (await db.select().from(paymentClaims).where(eq(paymentClaims.id, id)))[0];
  const paymentsOf = (claimId: string) => db.select().from(payments).where(eq(payments.idempotencyKey, `card-claim:${claimId}`));
  const allocationsOf = (paymentId: string) => db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));
  const auditOf = (claimId: string) => db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'payment_claim'), eq(auditLogs.entityId, claimId)));
  const outboxOf = (claimId: string) => db.select().from(noticeOutbox).where(like(noticeOutbox.dedupeKey, `%:${claimId}:%`));

  /** A trigger that fails one statement for one receipt; dropped after `body`. */
  async function failing<T>(name: string, table: string, when: 'insert' | 'update', cond: string, body: () => Promise<T>) {
    const fn = `${name}_${suffix}`;
    await db.execute(sql.raw(`create or replace function ${fn}() returns trigger language plpgsql as $$ begin if ${cond} then raise exception 'injected failure'; end if; return new; end $$`));
    await db.execute(sql.raw(`create trigger ${fn} before ${when} on ${table} for each row execute function ${fn}()`));
    try {
      return await body();
    } finally {
      await db.execute(sql.raw(`drop trigger if exists ${fn} on ${table}`));
      await db.execute(sql.raw(`drop function if exists ${fn}()`));
    }
  }

  /** Every receipt of this student: never a payment beside a receipt that is not CONFIRMED with it. */
  async function assertConsistent() {
    const claims = await db.select().from(paymentClaims).where(eq(paymentClaims.studentId, studentId));
    for (const c of claims) {
      const made = await paymentsOf(c.id);
      expect(made.length).toBeLessThanOrEqual(1);
      if (c.status === 'CONFIRMED') {
        expect(made).toHaveLength(1);
        expect(c.paymentId).toBe(made[0].id);
        expect(c.amount).toBe(made[0].amount);
        expect(await allocationsOf(made[0].id)).toHaveLength(1);
      } else {
        expect(made).toHaveLength(0);
      }
    }
  }

  it('no card, no transfers; the admin sets a card and the cabinet shows it', async () => {
    expect((await http().get('/api/portal/card-payment').set(portal).expect(200)).body.card).toBeNull();
    await send('300000').expect(400);
    await http().put('/api/card-payments/card').set(owner).send({ cardNumber: '8600 1234', cardHolder: 'Ali Valiyev' }).expect(400);
    await http().put('/api/card-payments/card').set(owner).send({ cardNumber: '8600 1234 5678 9012', cardHolder: 'Ali Valiyev' }).expect(200);
    expect((await http().get('/api/portal/card-payment').set(portal).expect(200)).body.card).toEqual({ number: '8600 1234 5678 9012', holder: 'Ali Valiyev' });
  });

  it('the student sends a receipt; the staff hear of it and confirm it into one payment', async () => {
    await send('300000', false).expect(400); // the picture is required
    await send('5').expect(400);
    const claim = (await send('300000').expect(201)).body;
    expect(claim.status).toBe('PENDING');
    await outbox.drain();
    expect(delivered.at(-1)).toMatchObject({ chat: `3${tail}` });
    expect(delivered.at(-1)!.text).toContain('Card Payer');

    const list = (await http().get('/api/card-payments/claims?status=PENDING').set(owner).expect(200)).body;
    expect(list.pending).toBe(1);
    // The receipt opens for staff through a signed link, and for the student who sent it.
    const staffLinks = (await http().post('/api/files/sign').set(owner).send({ names: [list.items[0].receiptFile] }).expect(201)).body;
    expect(Object.keys(staffLinks)).toHaveLength(1);

    // The amount seen on the receipt is what counts.
    const done = (await confirm(claim.id, { amount: 250000 }).expect(201)).body;
    expect(done).toMatchObject({ status: 'CONFIRMED', amount: 250000 });
    await confirm(claim.id).expect(409);
    const rows = (await http().get(`/api/payments?studentId=${studentId}`).set(owner).expect(200)).body as Array<{ id: string; amount: number; method: string }>;
    expect(rows.filter((p) => p.id === done.paymentId)).toEqual([expect.objectContaining({ amount: 250000, method: 'BANK_TRANSFER' })]);
    expect(await allocationsOf(done.paymentId)).toEqual([expect.objectContaining({ amount: 250000 })]);
    await outbox.drain();
    expect(delivered.filter((d) => d.chat === studentChat).at(-1)!.text).toContain('tasdiqlandi');
    const mine = (await http().get('/api/portal/card-payment').set(portal).expect(200)).body.claims;
    expect(mine[0]).toMatchObject({ status: 'CONFIRMED', amount: 250000 });
    // Both audit rows: the receipt's decision and the payment, one commit.
    expect(await auditOf(claim.id)).toHaveLength(1);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'payment'), eq(auditLogs.entityId, done.paymentId)))).toHaveLength(1);
  });

  it('a rejected receipt says why; it never becomes a payment', async () => {
    const claim = (await send('100000').expect(201)).body;
    await reject(claim.id, '').expect(400);
    await reject(claim.id, "Chekda summa ko'rinmaydi").expect(201);
    await confirm(claim.id).expect(409);
    await outbox.drain();
    expect(delivered.filter((d) => d.chat === studentChat).at(-1)!.text).toContain("summa ko'rinmaydi");
    const mine = (await http().get('/api/portal/card-payment').set(portal).expect(200)).body.claims;
    expect(mine[0]).toMatchObject({ status: 'REJECTED', rejectReason: "Chekda summa ko'rinmaydi" });
    expect(await paymentsOf(claim.id)).toHaveLength(0);
  });

  it('two admins confirm at once, or a confirm races a reject: one decision, at most one payment', async () => {
    const a = (await send('120000').expect(201)).body;
    const [x, y] = await Promise.all([confirm(a.id, {}, owner), confirm(a.id, {}, admin2)]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect(await paymentsOf(a.id)).toHaveLength(1);

    const b = (await send('130000').expect(201)).body;
    const [ok, no] = await Promise.all([confirm(b.id, {}, admin2), reject(b.id)]);
    expect([ok.status, no.status].sort()).toEqual([201, 409]);
    expect((await claimRow(b.id)).status).toBe(ok.status === 201 ? 'CONFIRMED' : 'REJECTED');
    expect(await paymentsOf(b.id)).toHaveLength(ok.status === 201 ? 1 : 0);
    await assertConsistent();
  });

  it('the same confirm sent five times at once: one payment, one allocation', async () => {
    const c = await newClaim(110000);
    const res = await Promise.all(Array.from({ length: 5 }, () => confirm(c.id)));
    expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    const made = await paymentsOf(c.id);
    expect(made).toHaveLength(1);
    expect(await allocationsOf(made[0].id)).toHaveLength(1);
    expect(await auditOf(c.id)).toHaveLength(1);
  });

  it('a failure after the payment rolls everything back: no payment, no message; a reject after it stands; a retry with another amount is one payment', async () => {
    const c = await newClaim(140000);
    await outbox.drain();
    const sentBefore = delivered.length;
    // Fault injection: marking this receipt fails (after its payment and allocation were written).
    await failing('cp_fail', 'payment_claims', 'update', `new.id = '${c.id}' and new.status = 'CONFIRMED'`, () => confirm(c.id, { amount: 140000 }).expect(500));
    expect((await claimRow(c.id)).status).toBe('PENDING');
    expect(await paymentsOf(c.id)).toHaveLength(0);
    expect(await auditOf(c.id)).toHaveLength(0);
    expect((await outboxOf(c.id)).filter((o) => o.kind !== 'card_claim.new')).toHaveLength(0);
    await outbox.drain();
    expect(delivered.length).toBe(sentBefore);

    // The retry, with the amount the admin now reads differently.
    const done = (await confirm(c.id, { amount: 135000 }).expect(201)).body;
    const made = await paymentsOf(c.id);
    expect(made).toEqual([expect.objectContaining({ id: done.paymentId, amount: 135000, status: 'PAID' })]);
    expect((await claimRow(c.id)).amount).toBe(135000);

    // A reject after an interruption: nothing was paid, so it is a plain reject.
    const r = await newClaim(145000);
    await failing('cp_fail_b', 'payment_claims', 'update', `new.id = '${r.id}' and new.status = 'CONFIRMED'`, () => confirm(r.id).expect(500));
    await reject(r.id).expect(201);
    expect((await claimRow(r.id)).status).toBe('REJECTED');
    expect(await paymentsOf(r.id)).toHaveLength(0);
    await assertConsistent();
  });

  it('an audit write failure leaves nothing: no payment, no allocation, receipt still waiting', async () => {
    const c = await newClaim(150000);
    await failing('cp_audit', 'audit_logs', 'insert', `new.entity_type = 'payment_claim' and new.entity_id = '${c.id}'`, () => confirm(c.id).expect(500));
    expect((await claimRow(c.id)).status).toBe('PENDING');
    expect(await paymentsOf(c.id)).toHaveLength(0);
    // And the payment's own audit row failing does the same.
    await failing('cp_audit_p', 'audit_logs', 'insert', `new.entity_type = 'payment'`, () => confirm(c.id).expect(500));
    expect((await claimRow(c.id)).status).toBe('PENDING');
    expect(await paymentsOf(c.id)).toHaveLength(0);
    await confirm(c.id).expect(201);
    await assertConsistent();
  });

  it('messages leave only after the commit, and survive a stop right after it', async () => {
    const c = await newClaim(160000);
    await outbox.drain();
    // "The process stopped after the commit": no after-commit kick.
    outbox.paused = true;
    try {
      await confirm(c.id).expect(201);
    } finally {
      outbox.paused = false;
    }
    const queued = (await outboxOf(c.id)).filter((o) => o.kind === 'card_claim.confirmed');
    expect(queued).toEqual([expect.objectContaining({ status: 'PENDING', recipient: studentChat })]);
    const before = delivered.length;
    // The next worker pass (a restart, the timer) sends it.
    await outbox.runOnce();
    expect(delivered.length).toBe(before + 1);
    expect((await outboxOf(c.id)).find((o) => o.kind === 'card_claim.confirmed')!.status).toBe('SENT');
  });

  it('a receipt left by the earlier code (payment saved, receipt PENDING): reject is refused, confirm takes that payment over', async () => {
    const c = await newClaim(170000);
    // What the earlier code could leave behind: the payment committed on its own.
    const pay = app.get(PaymentsService);
    const tenantId = (await claimRow(c.id)).tenantId;
    await db.transaction((tx) => pay.createInTx(tx, tenantId, { studentId, amount: 170000, method: 'BANK_TRANSFER', forMonth: '2026-11' }, undefined, `card-claim:${c.id}`));
    const rej = await reject(c.id).expect(409);
    expect(rej.body.code).toBe('PAYMENT_EXISTS');
    expect((await claimRow(c.id)).status).toBe('PENDING');
    // Reject and confirm racing on it: the confirm wins either way.
    const [x, y] = await Promise.all([confirm(c.id, { amount: 99000 }), reject(c.id)]);
    expect(x.status).toBe(201);
    expect(y.status).toBe(409);
    expect(x.body).toMatchObject({ adopted: true, amount: 170000 });
    expect(await paymentsOf(c.id)).toHaveLength(1);
    await assertConsistent();
  });

  it('the read-only check reports receipt/payment disagreements and changes nothing', async () => {
    const { CHECKS } = await import('../scripts/check-platform-billing.js');
    const tenantId = (await db.select({ t: paymentClaims.tenantId }).from(paymentClaims).where(eq(paymentClaims.studentId, studentId)).limit(1))[0].t;
    const run = async () => {
      const out: Record<string, unknown[]> = {};
      for (const c of CHECKS.filter((x) => x.name.startsWith('student_') || x.name === 'payment_allocated_beyond_amount')) {
        out[c.name] = ((await db.execute(sql.raw(c.sql))).rows as Array<{ tenant_id?: string }>).filter((r) => !('tenant_id' in r) || r.tenant_id === tenantId);
      }
      return out;
    };
    // Everything the tests above did is consistent (the taken-over receipt included).
    expect(Object.values(await run()).flat()).toEqual([]);
    // Plant the state the fix makes impossible: PAID payment, REJECTED receipt.
    const bad = await newClaim(180000);
    const pay = app.get(PaymentsService);
    await db.transaction((tx) => pay.createInTx(tx, tenantId, { studentId, amount: 180000, method: 'BANK_TRANSFER', forMonth: '2026-11' }, undefined, `card-claim:${bad.id}`));
    await db.update(paymentClaims).set({ status: 'REJECTED', rejectReason: 'x', reviewedAt: new Date() }).where(eq(paymentClaims.id, bad.id));
    const found = await run();
    expect(found.student_receipt_rejected_with_payment).toEqual([expect.objectContaining({ claim_id: bad.id, payment_status: 'PAID' })]);
    // Reported, not repaired.
    expect((await claimRow(bad.id)).status).toBe('REJECTED');
    expect(await paymentsOf(bad.id)).toHaveLength(1);
  });

  it('the keys of card receipts cannot be used for a payment by hand', async () => {
    await http().post('/api/payments').set(owner).set('Idempotency-Key', 'card-claim:abcdefgh')
      .send({ studentId, amount: 1000, method: 'CASH', forMonth: '2026-11' }).expect(400);
  });

  it('teachers do not see the receipts', async () => {
    await http().post('/api/staff').set(owner).send({ email: `card-t-${suffix}@test.uz`, fullName: 'Card Teacher', role: 'TEACHER', password: 'password12345' }).expect(201);
    const t = (await http().post('/api/auth/login').send({ email: `card-t-${suffix}@test.uz`, password: 'password12345' }).expect(201)).body.accessToken;
    await http().get('/api/card-payments/claims').set({ Authorization: `Bearer ${t}` }).expect(403);
  });
});
