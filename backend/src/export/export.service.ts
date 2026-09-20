import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { DB, Database } from '../db/db.module';
import { students, payments, tenants } from '../db/schema';

@Injectable()
export class ExportService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async studentsWorkbook(tenantId: string): Promise<ExcelJS.Buffer> {
    const rows = await this.db.query.students.findMany({
      where: and(eq(students.tenantId, tenantId), isNull(students.deletedAt)),
      with: { enrollments: { with: { group: true } } },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("O'quvchilar");
    ws.columns = [
      { header: "To'liq ism", key: 'fullName', width: 28 },
      { header: 'Telefon', key: 'phone', width: 18 },
      { header: "Ota-ona telefoni", key: 'parentPhone', width: 18 },
      { header: 'Manzil', key: 'address', width: 24 },
      { header: 'Guruhlar', key: 'groups', width: 30 },
      { header: "Ro'yxatdan o'tgan", key: 'startDate', width: 16 },
    ];
    for (const s of rows) {
      ws.addRow({
        fullName: s.fullName,
        phone: s.phone || '',
        parentPhone: s.parentPhone || '',
        address: s.address || '',
        groups: (s.enrollments || []).map((e) => e.group.name).join(', '),
        startDate: s.startDate ? new Date(s.startDate).toISOString().slice(0, 10) : '',
      });
    }
    ws.getRow(1).font = { bold: true };
    return wb.xlsx.writeBuffer();
  }

  async paymentsWorkbook(tenantId: string): Promise<ExcelJS.Buffer> {
    const rows = await this.db.query.payments.findMany({
      where: eq(payments.tenantId, tenantId),
      with: { student: true },
      orderBy: (p, { desc }) => desc(p.paidAt),
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("To'lovlar");
    ws.columns = [
      { header: "O'quvchi", key: 'student', width: 28 },
      { header: 'Oy', key: 'forMonth', width: 12 },
      { header: 'Summa', key: 'amount', width: 14 },
      { header: 'Usul', key: 'method', width: 14 },
      { header: 'Holat', key: 'status', width: 12 },
      { header: 'Sana', key: 'paidAt', width: 16 },
    ];
    for (const p of rows) {
      ws.addRow({
        student: p.student?.fullName || '',
        forMonth: p.forMonth,
        amount: p.amount,
        method: p.method,
        status: p.status,
        paidAt: p.paidAt ? new Date(p.paidAt).toISOString().slice(0, 10) : '',
      });
    }
    ws.getRow(1).font = { bold: true };
    return wb.xlsx.writeBuffer();
  }

  async importStudents(tenantId: string, buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException("Fayl bo'sh yoki noto'g'ri formatda");

    // Expected columns (by header, case-insensitive): fullName/ism, phone/telefon, parentPhone, address
    const header = (ws.getRow(1).values as any[]).map((v) => String(v ?? '').trim().toLowerCase());
    const col = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i > 0);

    const nameCol = col(['fullname', 'ism', "to'liq ism", 'full_name']);
    if (!nameCol) {
      throw new BadRequestException("Birinchi ustunda \"fullName\" yoki \"Ism\" sarlavhasi bo'lishi kerak");
    }
    const phoneCol = col(['phone', 'telefon']);
    const parentPhoneCol = col(['parentphone', "ota-ona telefoni", 'parent_phone']);
    const addressCol = col(['address', 'manzil']);

    const errors: string[] = [];
    const inserts: Promise<unknown>[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const fullName = String(row.getCell(nameCol).value ?? '').trim();
      if (!fullName) return;
      const values: any = {
        tenantId,
        fullName,
        phone: phoneCol ? String(row.getCell(phoneCol).value ?? '').trim() || undefined : undefined,
        parentPhone: parentPhoneCol ? String(row.getCell(parentPhoneCol).value ?? '').trim() || undefined : undefined,
        address: addressCol ? String(row.getCell(addressCol).value ?? '').trim() || undefined : undefined,
      };
      inserts.push(
        this.db
          .insert(students)
          .values(values)
          .catch(() => errors.push(`Qator ${rowNumber}: saqlab bo'lmadi`)),
      );
    });

    await Promise.all(inserts);
    return { imported: inserts.length - errors.length, errors };
  }

  async paymentReceiptPdf(tenantId: string, paymentId: string): Promise<Buffer> {
    const payment = await this.db.query.payments.findFirst({
      where: and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId)),
      with: { student: true },
    });
    if (!payment) throw new NotFoundException("To'lov topilmadi");
    const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A5', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text(tenant?.name || 'TalimCRM', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(13).text("To'lov kvitansiyasi", { align: 'center' });
      doc.moveDown(1.5);

      doc.fontSize(11);
      doc.text(`Kvitansiya #: ${payment.id}`);
      doc.text(`O'quvchi: ${payment.student?.fullName ?? '-'}`);
      doc.text(`Oy: ${payment.forMonth}`);
      doc.text(`Summa: ${new Intl.NumberFormat('uz-UZ').format(payment.amount)} so'm`);
      doc.text(`Usul: ${payment.method}`);
      doc.text(`Holat: ${payment.status}`);
      doc.text(`Sana: ${new Date(payment.paidAt).toLocaleDateString('uz-UZ')}`);
      doc.moveDown(2);
      doc.fontSize(9).fillColor('#888888').text('TalimCRM orqali yaratilgan', { align: 'center' });

      doc.end();
    });
  }
}
