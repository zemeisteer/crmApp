import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, Database } from '../db/db.module';
import { invoices, organizationMemberships, paymentClaims, payments, students, telegramParentChats, tenants, users } from '../db/schema';
import { FilesService } from '../files/files.service';
import { CARD_CLAIM_KEY, PaymentsService } from '../payments/payments.service';
import { LedgerTx } from '../payments/allocation';
import { Notice, NoticeOutboxService } from '../notice-outbox/notice-outbox.service';
import { MAX_MONEY } from '../common/money';
import { isUniqueViolation } from '../common/db-errors';

/** Pending receipts one student may have at a time (a guard against a stuck double-send). */
export const MAX_PENDING_CLAIMS = 5;

const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;

const money = (n: number) => new Intl.NumberFormat('uz-UZ').format(n);
const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** "8600123412341234" -> "8600 1234 1234 1234". */
export const groupCard = (digits: string) => digits.replace(/(\d{4})(?=\d)/g, '$1 ');

/**
 * Paying by card transfer, for centers without Click/Payme (or besides them):
 * the center shows its card in the cabinet, the student (or a parent) sends
 * a picture of the receipt, the owners and admins hear of it in Telegram and
 * confirm it on the site - only then is it a payment, with the invoices and
 * debts updated as for any other - or reject it with a reason.
 */
@Injectable()
export class CardPaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly outbox: NoticeOutboxService,
  ) {}

  // ---- the center's card ----

  async card(tenantId: string) {
    const [t] = await this.db.select({ number: tenants.cardNumber, holder: tenants.cardHolder }).from(tenants).where(eq(tenants.id, tenantId));
    return t?.number && t.holder ? { number: groupCard(t.number), holder: t.holder } : null;
  }

  async setCard(tenantId: string, userId: string, dto: { cardNumber?: string; cardHolder?: string }) {
    const digits = (dto.cardNumber ?? '').replace(/\D/g, '');
    const holder = (dto.cardHolder ?? '').trim().replace(/\s+/g, ' ');
    // Both empty: the card is taken off the cabinet.
    if (!digits && !holder) {
      await this.db.update(tenants).set({ cardNumber: null, cardHolder: null, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
    } else {
      if (digits.length !== 16) throw new BadRequestException("Karta raqami 16 ta raqamdan iborat bo'lishi kerak");
      if (!holder) throw new BadRequestException('Karta egasining ismini yozing');
      await this.db.update(tenants).set({ cardNumber: digits, cardHolder: holder, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
    }
    this.audit.log({ tenantId, userId, action: 'update', entityType: 'tenant_card', entityId: tenantId });
    return { card: await this.card(tenantId) };
  }

  // ---- the cabinet ----

  async cabinetView(tenantId: string, studentId: string) {
    const claims = await this.db
      .select({
        id: paymentClaims.id,
        amount: paymentClaims.amount,
        forMonth: paymentClaims.forMonth,
        status: paymentClaims.status,
        rejectReason: paymentClaims.rejectReason,
        createdAt: paymentClaims.createdAt,
        reviewedAt: paymentClaims.reviewedAt,
      })
      .from(paymentClaims)
      .where(and(eq(paymentClaims.tenantId, tenantId), eq(paymentClaims.studentId, studentId)))
      .orderBy(desc(paymentClaims.createdAt))
      .limit(20);
    return { card: await this.card(tenantId), claims };
  }

  /**
   * The key names one send and its content (amount, month, invoice, note, the
   * receipt file's own sha256):
   *  - same key, same content: the same receipt back (`replay`), the caller
   *    removes the duplicate upload, and the staff hear of it once;
   *  - same key, other content: 409 KEY_REUSED.
   */
  async submit(
    tenantId: string,
    studentId: string,
    sentBy: 'student' | 'parent',
    dto: { amount: number; forMonth?: string; invoiceId?: string; note?: string; receiptFile: string; receiptSha256: string; idempotencyKey?: string },
  ): Promise<{ claim: typeof paymentClaims.$inferSelect; replay: boolean }> {
    if (!(await this.card(tenantId))) throw new BadRequestException("Markaz karta orqali to'lovni yoqmagan");
    const amount = Math.round(Number(dto.amount));
    if (!Number.isFinite(amount) || amount < 1000 || amount > MAX_MONEY) throw new BadRequestException("To'lov summasini to'g'ri yozing (kamida 1 000 so'm)");
    const key = dto.idempotencyKey?.trim() || null;
    if (key && !KEY_RE.test(key)) throw new BadRequestException("Idempotency-Key noto'g'ri");
    const note = dto.note?.trim().slice(0, 500) || null;
    const requestHash = createHash('sha256').update(JSON.stringify([amount, dto.forMonth ?? null, dto.invoiceId ?? null, note, dto.receiptSha256])).digest('hex');
    // Before the limit below: a retry of a receipt already made adds nothing.
    if (key) {
      const prior = await this.byKey(tenantId, studentId, key);
      if (prior) return { claim: this.sameSend(prior, requestHash), replay: true };
    }
    const [student] = await this.db
      .select({ id: students.id, fullName: students.fullName })
      .from(students)
      .where(and(eq(students.id, studentId), eq(students.tenantId, tenantId)));
    if (!student) throw new NotFoundException("O'quvchi topilmadi");

    let forMonth = dto.forMonth && /^\d{4}-\d{2}$/.test(dto.forMonth) ? dto.forMonth : new Date().toISOString().slice(0, 7);
    let invoiceId: string | null = null;
    if (dto.invoiceId) {
      const [inv] = await this.db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, dto.invoiceId), eq(invoices.tenantId, tenantId), eq(invoices.studentId, studentId)));
      if (!inv || inv.status === 'CANCELLED') throw new NotFoundException('Hisob-faktura topilmadi');
      invoiceId = inv.id;
      forMonth = inv.forMonth;
    }
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(paymentClaims)
      .where(and(eq(paymentClaims.tenantId, tenantId), eq(paymentClaims.studentId, studentId), eq(paymentClaims.status, 'PENDING')));
    if (n >= MAX_PENDING_CLAIMS) throw new ConflictException("Avvalgi cheklaringiz hali tekshirilmagan. Markaz tasdiqlashini kuting.");

    // The receipt, its file reference and the staff's messages: one commit.
    let claim: typeof paymentClaims.$inferSelect;
    try {
      claim = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(paymentClaims)
          .values({ tenantId, studentId, invoiceId, amount, forMonth, receiptFile: dto.receiptFile, note, sentBy, idempotencyKey: key, requestHash })
          .returning();
        await this.files.register(tenantId, dto.receiptFile, 'PAYMENT_RECEIPT', row.id, studentId, tx);
        await this.outbox.enqueue(tx, await this.staffNotices(tx, tenantId, row.id, student.fullName, amount, forMonth, sentBy));
        return row;
      });
    } catch (err) {
      // The same key that raced us: its receipt is committed by now.
      if (key && isUniqueViolation(err, 'payment_claims_idem_idx')) {
        const prior = await this.byKey(tenantId, studentId, key);
        if (prior) return { claim: this.sameSend(prior, requestHash), replay: true };
      }
      throw err;
    }
    void this.outbox.kick();
    return { claim, replay: false };
  }

  /** The receipt a key already made, if this send carries the same content. */
  private sameSend(prior: typeof paymentClaims.$inferSelect, requestHash: string) {
    if (prior.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'KEY_REUSED',
        message: "Bu yuborish kaliti boshqa chek bilan ishlatilgan. Yangi chek alohida yuboriladi: sahifani yangilab qayta yuboring.",
      });
    }
    return prior;
  }

  private async byKey(tenantId: string, studentId: string, key: string) {
    const [row] = await this.db
      .select()
      .from(paymentClaims)
      .where(and(eq(paymentClaims.tenantId, tenantId), eq(paymentClaims.studentId, studentId), eq(paymentClaims.idempotencyKey, key)));
    return row;
  }

  /** Owners, admins and accountants linked to the bot hear of a new receipt (one message each). */
  private async staffNotices(tx: LedgerTx, tenantId: string, claimId: string, studentName: string, amount: number, forMonth: string, sentBy: string): Promise<Notice[]> {
    const staff = await tx
      .select({ chat: users.telegramChatId })
      .from(users)
      .innerJoin(organizationMemberships, and(eq(organizationMemberships.userId, users.id), eq(organizationMemberships.tenantId, tenantId)))
      .where(and(eq(organizationMemberships.status, 'ACTIVE'), inArray(organizationMemberships.role, ['OWNER', 'ADMIN', 'ACCOUNTANT'])));
    const text = [
      `💳 <b>Karta orqali to'lov keldi</b>`,
      `${escape(studentName)}${sentBy === 'parent' ? ' (ota-onasi yubordi)' : ''}`,
      `Summa: <b>${money(amount)} so'm</b> · ${forMonth}`,
      '',
      `Chekni tekshirib tasdiqlang: TalimCRM → To'lovlar → "Karta to'lovlari".`,
    ].join('\n');
    const chats = new Set(staff.map((s) => s.chat).filter((c): c is string => Boolean(c)));
    return [...chats].map((chat) => ({ tenantId, kind: 'card_claim.new', channel: 'TELEGRAM' as const, recipient: chat, body: text, dedupeKey: `card_claim.new:${claimId}:tg:${chat}` }));
  }

  /** The student's own chat and every linked parent's (as TelegramService.notifyStudent reaches them). */
  private async studentNotices(tx: LedgerTx, tenantId: string, studentId: string, kind: string, claimId: string, text: string): Promise<Notice[]> {
    const [st] = await tx.select({ chat: students.telegramChatId }).from(students).where(eq(students.id, studentId));
    const parents = await tx.select({ chat: telegramParentChats.chatId }).from(telegramParentChats).where(eq(telegramParentChats.studentId, studentId));
    const chats = new Set([st?.chat, ...parents.map((p) => p.chat)].filter((c): c is string => Boolean(c)));
    return [...chats].map((chat) => ({ tenantId, kind, channel: 'TELEGRAM' as const, recipient: chat, body: text, dedupeKey: `${kind}:${claimId}:tg:${chat}` }));
  }

  // ---- staff ----

  async list(tenantId: string, status?: string) {
    const where = [eq(paymentClaims.tenantId, tenantId)];
    if (status && ['PENDING', 'CONFIRMED', 'REJECTED'].includes(status)) where.push(eq(paymentClaims.status, status));
    const [rows, [pending]] = await Promise.all([
      this.db
        .select({
          claim: paymentClaims,
          studentName: students.fullName,
          studentPhone: students.phone,
          reviewedBy: users.fullName,
        })
        .from(paymentClaims)
        .innerJoin(students, eq(students.id, paymentClaims.studentId))
        .leftJoin(users, eq(users.id, paymentClaims.reviewedByUserId))
        .where(and(...where))
        .orderBy(desc(paymentClaims.createdAt))
        .limit(200),
      this.db.select({ n: count() }).from(paymentClaims).where(and(eq(paymentClaims.tenantId, tenantId), eq(paymentClaims.status, 'PENDING'))),
    ]);
    return {
      pending: pending.n,
      items: rows.map((r) => ({ ...r.claim, idempotencyKey: undefined, requestHash: undefined, studentName: r.studentName, studentPhone: r.studentPhone, reviewedBy: r.reviewedBy })),
    };
  }

  /**
   * Confirms the receipt: it becomes a payment (by transfer) for the month or
   * invoice it was sent for, at the amount the staff member saw on the
   * receipt. ONE transaction holds the receipt's row lock, the payment, its
   * invoice allocations, the receipt's new state, both audit rows and the
   * student's message (outbox): a failure anywhere leaves none of them, so
   * a receipt is never PENDING beside a payment made for it, and a reject
   * that comes next finds nothing paid. A second confirm or a reject waits
   * for the lock, then sees the decision.
   *
   * Receipts left PENDING with a payment by the earlier code (which saved
   * the payment in a transaction of its own) are taken over: confirm links
   * that payment (its amount stands), reject is refused.
   */
  async confirm(tenantId: string, userId: string, id: string, amountSeen?: number) {
    const out = await this.db.transaction(async (tx) => {
      const c = await this.lockPending(tx, tenantId, id);
      const amount = amountSeen && amountSeen > 0 ? Math.round(amountSeen) : c.amount;
      if (amount > MAX_MONEY) throw new BadRequestException("To'lov summasi juda katta");
      const orphan = await this.paymentOf(tx, tenantId, id);
      let paymentId: string;
      let made: typeof payments.$inferSelect | null = null;
      let finalAmount = amount;
      if (orphan) {
        paymentId = orphan.id;
        finalAmount = orphan.amount;
      } else {
        const created = await this.payments.createInTx(
          tx,
          tenantId,
          { studentId: c.studentId, amount, method: 'BANK_TRANSFER', forMonth: c.forMonth, ...(c.invoiceId ? { invoiceId: c.invoiceId } : {}) },
          userId,
          `${CARD_CLAIM_KEY}${c.id}`,
        );
        // The key is checked under the ledger lock above: no payment of this receipt exists.
        if ('replayOf' in created) throw new ConflictException("Bu chek bo'yicha to'lov allaqachon yozilgan");
        made = created.payment;
        paymentId = made.id;
      }
      await tx
        .update(paymentClaims)
        .set({ status: 'CONFIRMED', reviewedByUserId: userId, reviewedAt: new Date(), amount: finalAmount, paymentId })
        .where(eq(paymentClaims.id, id));
      await this.audit.record(tx, {
        tenantId,
        userId,
        action: 'update',
        entityType: 'payment_claim',
        entityId: id,
        meta: { confirmed: paymentId, amount: finalAmount, ...(orphan ? { adoptedPayment: true, amountSeen: amount } : {}) },
      });
      const text = `✅ Karta orqali ${money(finalAmount)} so'm to'lovingiz tasdiqlandi (${c.forMonth}). Rahmat!`;
      await this.outbox.enqueue(tx, await this.studentNotices(tx, tenantId, c.studentId, 'card_claim.confirmed', id, text));
      return { paymentId, made, amount: finalAmount, adopted: !!orphan };
    });
    // Only now, after the commit.
    if (out.made) this.payments.afterCommit(tenantId, out.made);
    void this.outbox.kick();
    return { id, status: 'CONFIRMED', paymentId: out.paymentId, amount: out.amount, ...(out.adopted ? { adopted: true } : {}) };
  }

  async reject(tenantId: string, userId: string, id: string, reason: string) {
    const why = reason.trim().slice(0, 300);
    if (!why) throw new BadRequestException('Rad etish sababini yozing');
    await this.db.transaction(async (tx) => {
      const row = await this.lockPending(tx, tenantId, id);
      // A payment made for it (by the earlier code, before a stop): money was
      // recorded, so the receipt can only be confirmed - never PAID beside REJECTED.
      if (await this.paymentOf(tx, tenantId, id)) {
        throw new ConflictException({ code: 'PAYMENT_EXISTS', message: "Bu chek bo'yicha to'lov allaqachon yozilgan: uni rad etib bo'lmaydi, tasdiqlang" });
      }
      await tx
        .update(paymentClaims)
        .set({ status: 'REJECTED', rejectReason: why, reviewedByUserId: userId, reviewedAt: new Date() })
        .where(eq(paymentClaims.id, id));
      await this.audit.record(tx, { tenantId, userId, action: 'update', entityType: 'payment_claim', entityId: id, meta: { rejected: why } });
      const text = `❌ Karta orqali ${money(row.amount)} so'm to'lov tasdiqlanmadi: ${escape(why)}. Savol bo'lsa, markazga murojaat qiling.`;
      await this.outbox.enqueue(tx, await this.studentNotices(tx, tenantId, row.studentId, 'card_claim.rejected', id, text));
    });
    void this.outbox.kick();
    return { id, status: 'REJECTED' };
  }

  /** The receipt, row-locked for the decision; only a PENDING one may be decided. */
  private async lockPending(tx: LedgerTx, tenantId: string, id: string) {
    const [c] = await tx.select().from(paymentClaims).where(and(eq(paymentClaims.id, id), eq(paymentClaims.tenantId, tenantId))).for('update');
    if (!c) throw new NotFoundException("To'lov topilmadi");
    if (c.status !== 'PENDING') throw new ConflictException(c.status === 'CONFIRMED' ? "Bu to'lov allaqachon tasdiqlangan" : "Bu to'lov rad etilgan");
    return c;
  }

  /** The payment made for this receipt, if any (by its key). */
  private async paymentOf(tx: LedgerTx, tenantId: string, claimId: string) {
    const [p] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.idempotencyKey, `${CARD_CLAIM_KEY}${claimId}`)));
    return p;
  }
}
