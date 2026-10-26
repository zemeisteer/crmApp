import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, Database } from '../db/db.module';
import { invoices, organizationMemberships, paymentClaims, students, tenants, users } from '../db/schema';
import { FilesService } from '../files/files.service';
import { PaymentsService } from '../payments/payments.service';
import { TelegramService } from '../telegram/telegram.service';
import { MAX_MONEY } from '../common/money';

/** Pending receipts one student may have at a time (a guard against a stuck double-send). */
export const MAX_PENDING_CLAIMS = 5;

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
  private readonly logger = new Logger(CardPaymentsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentsService,
    private readonly files: FilesService,
    private readonly telegram: TelegramService,
    private readonly audit: AuditService,
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

  async submit(
    tenantId: string,
    studentId: string,
    sentBy: 'student' | 'parent',
    dto: { amount: number; forMonth?: string; invoiceId?: string; note?: string; receiptFile: string },
  ) {
    if (!(await this.card(tenantId))) throw new BadRequestException("Markaz karta orqali to'lovni yoqmagan");
    const amount = Math.round(Number(dto.amount));
    if (!Number.isFinite(amount) || amount < 1000 || amount > MAX_MONEY) throw new BadRequestException("To'lov summasini to'g'ri yozing (kamida 1 000 so'm)");
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

    const [claim] = await this.db
      .insert(paymentClaims)
      .values({ tenantId, studentId, invoiceId, amount, forMonth, receiptFile: dto.receiptFile, note: dto.note?.trim().slice(0, 500) || null, sentBy })
      .returning();
    await this.files.register(tenantId, dto.receiptFile, 'PAYMENT_RECEIPT', claim.id, studentId);
    // Told in the background: a Telegram hiccup never loses the receipt.
    void this.tellStaff(tenantId, student.fullName, amount, forMonth, sentBy).catch((err) => this.logger.warn(`card claim notice: ${(err as Error).message}`));
    return claim;
  }

  /** Owners, admins and accountants linked to the bot hear of a new receipt at once. */
  private async tellStaff(tenantId: string, studentName: string, amount: number, forMonth: string, sentBy: string) {
    const staff = await this.db
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
    for (const chat of new Set(staff.map((s) => s.chat).filter((c): c is string => Boolean(c)))) {
      await this.telegram.sendMessage(chat, text);
    }
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
      items: rows.map((r) => ({ ...r.claim, studentName: r.studentName, studentPhone: r.studentPhone, reviewedBy: r.reviewedBy })),
    };
  }

  /**
   * Confirms the receipt: it becomes a payment (by transfer) for the month or
   * invoice it was sent for, at the amount the staff member saw on the
   * receipt. The receipt row is locked for the whole decision (a second
   * confirm or a reject waits, then sees it decided). The payment is made
   * first, keyed by the receipt: if the process stops before the receipt
   * is marked, a retry finds that same payment (the key) and finishes -
   * never a receipt "confirmed" with no payment, never two payments.
   */
  async confirm(tenantId: string, userId: string, id: string, amountSeen?: number) {
    const out = await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(paymentClaims).where(and(eq(paymentClaims.id, id), eq(paymentClaims.tenantId, tenantId))).for('update');
      if (!c) throw new NotFoundException("To'lov topilmadi");
      if (c.status !== 'PENDING') throw new ConflictException(c.status === 'CONFIRMED' ? "Bu to'lov allaqachon tasdiqlangan" : "Bu to'lov rad etilgan");
      const amount = amountSeen && amountSeen > 0 ? Math.round(amountSeen) : c.amount;
      const payment = (await this.payments.create(
        tenantId,
        { studentId: c.studentId, amount, method: 'BANK_TRANSFER', forMonth: c.forMonth, ...(c.invoiceId ? { invoiceId: c.invoiceId } : {}) },
        userId,
        `card-claim:${c.id}`,
      )) as { id: string };
      await tx
        .update(paymentClaims)
        .set({ status: 'CONFIRMED', reviewedByUserId: userId, reviewedAt: new Date(), amount, paymentId: payment.id })
        .where(eq(paymentClaims.id, id));
      await this.audit.record(tx, { tenantId, userId, action: 'update', entityType: 'payment_claim', entityId: id, meta: { confirmed: payment.id, amount } });
      return { c, amount, paymentId: payment.id };
    });
    void this.telegram
      .notifyStudent(out.c.studentId, `✅ Karta orqali ${money(out.amount)} so'm to'lovingiz tasdiqlandi (${out.c.forMonth}). Rahmat!`)
      .catch(() => undefined);
    return { id, status: 'CONFIRMED', paymentId: out.paymentId };
  }

  async reject(tenantId: string, userId: string, id: string, reason: string) {
    const why = reason.trim().slice(0, 300);
    if (!why) throw new BadRequestException('Rad etish sababini yozing');
    const c = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(paymentClaims).where(and(eq(paymentClaims.id, id), eq(paymentClaims.tenantId, tenantId))).for('update');
      if (!row) throw new NotFoundException("To'lov topilmadi");
      if (row.status !== 'PENDING') throw new ConflictException(row.status === 'CONFIRMED' ? "Bu to'lov allaqachon tasdiqlangan" : "Bu to'lov rad etilgan");
      await tx
        .update(paymentClaims)
        .set({ status: 'REJECTED', rejectReason: why, reviewedByUserId: userId, reviewedAt: new Date() })
        .where(eq(paymentClaims.id, id));
      await this.audit.record(tx, { tenantId, userId, action: 'update', entityType: 'payment_claim', entityId: id, meta: { rejected: why } });
      return row;
    });
    void this.telegram
      .notifyStudent(c.studentId, `❌ Karta orqali ${money(c.amount)} so'm to'lov tasdiqlanmadi: ${escape(why)}. Savol bo'lsa, markazga murojaat qiling.`)
      .catch(() => undefined);
    return { id, status: 'REJECTED' };
  }
}
