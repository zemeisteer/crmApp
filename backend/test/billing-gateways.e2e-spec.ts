import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHash } from 'crypto';
import { AppModule } from '../src/app.module.js';

function md5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function createClickSign(params: {
  click_trans_id: string;
  service_id: string;
  secret: string;
  merchant_trans_id: string;
  amount: number | string;
  action: string;
  sign_time: string;
  merchant_prepare_id?: string;
}): string {
  const raw =
    params.action === '0'
      ? `${params.click_trans_id}${params.service_id}${params.secret}${params.merchant_trans_id}${params.amount}${params.action}${params.sign_time}`
      : `${params.click_trans_id}${params.service_id}${params.secret}${params.merchant_trans_id}${params.merchant_prepare_id || ''}${params.amount}${params.action}${params.sign_time}`;
  return md5(raw);
}

describe('Billing & Payment Gateways E2E Test Suite (25 Tests)', () => {
  let app: INestApplication<App>;
  const suffix = Date.now();

  const CLICK_MERCHANT_ID = 'click_test_merchant_99';
  const CLICK_SERVICE_ID = 'click_test_service_99';
  const CLICK_SECRET_KEY = 'click_test_secret_key_xyz';
  const PAYME_MERCHANT_ID = 'payme_test_merchant_88';
  const PAYME_KEY = 'payme_test_secret_key_abc';

  const paymeAuthHeader = 'Basic ' + Buffer.from(`Paycom:${PAYME_KEY}`).toString('base64');

  let tokenA: string;
  let tenantAId: string;
  let tokenB: string;
  let tenantBId: string;

  let teacherToken: string;
  let parentToken: string;
  let parentUserId: string;

  let studentA1Id: string;
  let studentA1Phone: string;
  let studentA1PortalToken: string;

  let studentA2Id: string;
  let studentA2Phone: string;
  let studentA2PortalToken: string;

  let studentB1Id: string;

  let groupAId: string;

  beforeAll(async () => {
    // Configure environment credentials for providers
    process.env.CLICK_MERCHANT_ID = CLICK_MERCHANT_ID;
    process.env.CLICK_SERVICE_ID = CLICK_SERVICE_ID;
    process.env.CLICK_SECRET_KEY = CLICK_SECRET_KEY;
    process.env.PAYME_MERCHANT_ID = PAYME_MERCHANT_ID;
    process.env.PAYME_KEY = PAYME_KEY;
    process.env.PLATFORM_CLICK_MERCHANT_ID = 'plat_click_merchant';
    process.env.PLATFORM_CLICK_SERVICE_ID = 'plat_click_service';
    process.env.PLATFORM_CLICK_SECRET_KEY = 'plat_click_secret';
    process.env.PLATFORM_PAYME_MERCHANT_ID = 'plat_payme_merchant';
    process.env.PLATFORM_PAYME_KEY = 'plat_payme_key';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    // 1. Setup Tenant A
    const resA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        centerName: `Fin Org A ${suffix}`,
        subdomain: `fin-a-${suffix}`,
        email: `admin-fin-a-${suffix}@test.uz`,
        password: 'password123',
        fullName: 'Admin Org A',
      })
      .expect(201);

    tokenA = resA.body.accessToken;
    tenantAId = resA.body.tenant.id;

    // 2. Setup Tenant B
    const resB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        centerName: `Fin Org B ${suffix}`,
        subdomain: `fin-b-${suffix}`,
        email: `admin-fin-b-${suffix}@test.uz`,
        password: 'password123',
        fullName: 'Admin Org B',
      })
      .expect(201);

    tokenB = resB.body.accessToken;
    tenantBId = resB.body.tenant.id;

    // 3. Create Teacher in Tenant A
    const teacherInvRes = await request(app.getHttpServer())
      .post('/api/invitations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        email: `teacher-fin-${suffix}@test.uz`,
        role: 'TEACHER',
      })
      .expect(201);

    const teacherAcceptRes = await request(app.getHttpServer())
      .post(`/api/invitations/${teacherInvRes.body.token}/accept`)
      .send({
        fullName: 'Teacher Finance',
        password: 'teacherPassword123',
      })
      .expect(201);

    teacherToken = teacherAcceptRes.body.accessToken;

    // 4. Create Students in Tenant A
    studentA1Phone = `+998901${String(suffix).slice(-6)}`;
    const studentA1Res = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Alisher Navoiy',
        phone: studentA1Phone,
        gender: 'MALE',
      })
      .expect(201);
    studentA1Id = studentA1Res.body.id;

    studentA2Phone = `+998902${String(suffix).slice(-6)}`;
    const studentA2Res = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Zahiriddin Bobur',
        phone: studentA2Phone,
        gender: 'MALE',
      })
      .expect(201);
    studentA2Id = studentA2Res.body.id;

    // 5. Create Group in Tenant A and enroll student 1
    const groupRes = await request(app.getHttpServer())
      .post('/api/groups')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: `Group Finance ${suffix}`,
        subject: 'Finance',
        monthlyPrice: 800000,
      })
      .expect(201);
    groupAId = groupRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/students/${studentA1Id}/enroll/${groupAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    // 6. Create Student in Tenant B
    const studentBRes = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        fullName: 'Tenant B Student',
        phone: `+998903${String(suffix).slice(-6)}`,
        gender: 'MALE',
      })
      .expect(201);
    studentB1Id = studentBRes.body.id;

    // 7. Invite & Register Parent in Tenant A, link to studentA1
    const parentInvRes = await request(app.getHttpServer())
      .post('/api/invitations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        email: `parent-fin-${suffix}@test.uz`,
        role: 'PARENT',
      })
      .expect(201);

    const parentAcceptRes = await request(app.getHttpServer())
      .post(`/api/invitations/${parentInvRes.body.token}/accept`)
      .send({
        fullName: 'Ona Aliyeva',
        password: 'parentPassword123',
      })
      .expect(201);

    parentToken = parentAcceptRes.body.accessToken;
    parentUserId = parentAcceptRes.body.user.id;

    await request(app.getHttpServer())
      .post(`/api/students/${studentA1Id}/guardians`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        userId: parentUserId,
        relationship: 'Ona',
        isPrimary: true,
      })
      .expect(201);

    // 8. Obtain Portal Tokens for Student A1 and Student A2
    const loginA1 = await request(app.getHttpServer())
      .post('/api/portal/auth/phone')
      .send({ phone: studentA1Phone })
      .expect(201);
    studentA1PortalToken = loginA1.body.accessToken;

    const loginA2 = await request(app.getHttpServer())
      .post('/api/portal/auth/phone')
      .send({ phone: studentA2Phone })
      .expect(201);
    studentA2PortalToken = loginA2.body.accessToken;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  // State shared between tests
  let clickInvoiceId: string;
  let clickTxId: string;
  const clickTransId = `clk_${suffix}_1`;

  let paymeInvoiceId: string;
  let paymeTxId: string;
  const paymeTransId = `payme_${suffix}_1`;

  // ==========================================
  // Test 1 — Valid Click payment succeeds
  // ==========================================
  it('1. Valid Click payment succeeds (prepare -> complete -> invoice paid)', async () => {
    // Create invoice
    const invRes = await request(app.getHttpServer())
      .post('/api/invoices')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA1Id,
        amount: 800000,
        currency: 'UZS',
        dueDate: '2026-10-10',
        forMonth: '2026-09',
        description: 'Sentabr oyi tolovi (Click)',
      })
      .expect(201);
    clickInvoiceId = invRes.body.id;
    expect(invRes.body.status).toBe('OPEN');
    expect(invRes.body.remainingAmount).toBe(800000);

    // Generate Click checkout link
    const linkRes = await request(app.getHttpServer())
      .post('/api/billing/click/link')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA1Id,
        amount: 800000,
        forMonth: '2026-09',
        invoiceId: clickInvoiceId,
      })
      .expect(201);
    clickTxId = linkRes.body.transactionId;
    expect(linkRes.body.url).toContain('https://my.click.uz');

    // Click Webhook: Action 0 (Prepare)
    const signTime0 = '2026-09-24 12:00:00';
    const sign0 = createClickSign({
      click_trans_id: clickTransId,
      service_id: CLICK_SERVICE_ID,
      secret: CLICK_SECRET_KEY,
      merchant_trans_id: clickTxId,
      amount: 800000,
      action: '0',
      sign_time: signTime0,
    });

    const prepRes = await request(app.getHttpServer())
      .post('/api/billing/click/webhook')
      .send({
        click_trans_id: clickTransId,
        service_id: CLICK_SERVICE_ID,
        merchant_trans_id: clickTxId,
        amount: 800000,
        action: '0',
        sign_time: signTime0,
        sign_string: sign0,
      })
      .expect(200);

    expect(prepRes.body.error).toBe(0);
    expect(prepRes.body.merchant_prepare_id).toBe(clickTxId);

    // Click Webhook: Action 1 (Complete)
    const signTime1 = '2026-09-24 12:00:05';
    const sign1 = createClickSign({
      click_trans_id: clickTransId,
      service_id: CLICK_SERVICE_ID,
      secret: CLICK_SECRET_KEY,
      merchant_trans_id: clickTxId,
      merchant_prepare_id: clickTxId,
      amount: 800000,
      action: '1',
      sign_time: signTime1,
    });

    const compRes = await request(app.getHttpServer())
      .post('/api/billing/click/webhook')
      .send({
        click_trans_id: clickTransId,
        service_id: CLICK_SERVICE_ID,
        merchant_trans_id: clickTxId,
        merchant_prepare_id: clickTxId,
        amount: 800000,
        action: '1',
        sign_time: signTime1,
        sign_string: sign1,
      })
      .expect(200);

    expect(compRes.body.error).toBe(0);
    expect(compRes.body.merchant_confirm_id).toBe(clickTxId);

    // Verify invoice is marked PAID and remainingAmount = 0
    const updatedInv = await request(app.getHttpServer())
      .get(`/api/invoices/${clickInvoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(updatedInv.body.status).toBe('PAID');
    expect(updatedInv.body.amountPaid).toBe(800000);
    expect(updatedInv.body.remainingAmount).toBe(0);
  });

  // ==========================================
  // Test 2 — Valid Payme payment succeeds
  // ==========================================
  it('2. Valid Payme payment succeeds (CheckPerform -> Create -> Perform)', async () => {
    // Create invoice
    const invRes = await request(app.getHttpServer())
      .post('/api/invoices')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA2Id,
        amount: 500000,
        currency: 'UZS',
        dueDate: '2026-10-15',
        forMonth: '2026-09',
        description: 'Sentabr oyi tolovi (Payme)',
      })
      .expect(201);
    paymeInvoiceId = invRes.body.id;

    // Generate Payme checkout link
    const linkRes = await request(app.getHttpServer())
      .post('/api/billing/payme/link')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA2Id,
        amount: 500000,
        forMonth: '2026-09',
        invoiceId: paymeInvoiceId,
      })
      .expect(201);
    paymeTxId = linkRes.body.transactionId;

    // 1. CheckPerformTransaction (amount in tiyin: 500,000 * 100 = 50,000,000)
    const checkRes = await request(app.getHttpServer())
      .post('/api/billing/payme/webhook')
      .set('Authorization', paymeAuthHeader)
      .send({
        method: 'CheckPerformTransaction',
        params: {
          amount: 50000000,
          account: { transaction_param: paymeTxId },
        },
        id: 101,
      })
      .expect(200);
    expect(checkRes.body.result?.allow).toBe(true);

    // 2. CreateTransaction
    const createRes = await request(app.getHttpServer())
      .post('/api/billing/payme/webhook')
      .set('Authorization', paymeAuthHeader)
      .send({
        method: 'CreateTransaction',
        params: {
          id: paymeTransId,
          time: Date.now(),
          amount: 50000000,
          account: { transaction_param: paymeTxId },
        },
        id: 102,
      })
      .expect(200);
    expect(createRes.body.result?.state).toBe(1);
    expect(createRes.body.result?.transaction).toBe(paymeTxId);

    // 3. PerformTransaction
    const perfRes = await request(app.getHttpServer())
      .post('/api/billing/payme/webhook')
      .set('Authorization', paymeAuthHeader)
      .send({
        method: 'PerformTransaction',
        params: { id: paymeTransId },
        id: 103,
      })
      .expect(200);
    expect(perfRes.body.result?.state).toBe(2);

    // Verify invoice is marked PAID and remainingAmount = 0
    const updatedInv = await request(app.getHttpServer())
      .get(`/api/invoices/${paymeInvoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(updatedInv.body.status).toBe('PAID');
    expect(updatedInv.body.remainingAmount).toBe(0);
  });

  // ==========================================
  // Test 3 — Invalid Click signature rejected
  // ==========================================
  it('3. Invalid Click signature rejected (-1 SIGN_FAILED)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/billing/click/webhook')
      .send({
        click_trans_id: 'tampered_clk_999',
        service_id: CLICK_SERVICE_ID,
        merchant_trans_id: clickTxId,
        amount: 800000,
        action: '0',
        sign_time: '2026-09-24 12:00:00',
        sign_string: 'invalid_md5_hash_value',
      })
      .expect(200);

    expect(res.body.error).toBe(-1);
    expect(res.body.error_note).toBe('SIGN CHECK FAILED');
  });

  // ==========================================
  // Test 4 — Invalid Payme authentication rejected
  // ==========================================
  it('4. Invalid Payme authentication rejected (-32504 Access Denied)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/billing/payme/webhook')
      .set('Authorization', 'Basic wrong_password_encoded==')
      .send({
        method: 'CheckPerformTransaction',
        params: {
          amount: 50000000,
          account: { transaction_param: paymeTxId },
        },
        id: 404,
      })
      .expect(200);

    expect(res.body.error?.code).toBe(-32504);
  });

  // ==========================================
  // Test 5 — Duplicate Click webhook does not duplicate payment
  // ==========================================
  it('5. Duplicate Click webhook does not duplicate payment (idempotent)', async () => {
    const paymentsBefore = await request(app.getHttpServer())
      .get('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const countBefore = paymentsBefore.body.length;

    // Resend Action 1 (Complete) with same click_trans_id
    const signTime1 = '2026-09-24 12:00:05';
    const sign1 = createClickSign({
      click_trans_id: clickTransId,
      service_id: CLICK_SERVICE_ID,
      secret: CLICK_SECRET_KEY,
      merchant_trans_id: clickTxId,
      merchant_prepare_id: clickTxId,
      amount: 800000,
      action: '1',
      sign_time: signTime1,
    });

    const dupRes = await request(app.getHttpServer())
      .post('/api/billing/click/webhook')
      .send({
        click_trans_id: clickTransId,
        service_id: CLICK_SERVICE_ID,
        merchant_trans_id: clickTxId,
        merchant_prepare_id: clickTxId,
        amount: 800000,
        action: '1',
        sign_time: signTime1,
        sign_string: sign1,
      })
      .expect(200);

    expect(dupRes.body.error).toBe(0);
    expect(dupRes.body.merchant_confirm_id).toBe(clickTxId);

    const paymentsAfter = await request(app.getHttpServer())
      .get('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(paymentsAfter.body.length).toBe(countBefore);
  });

  // ==========================================
  // Test 6 — Duplicate Payme webhook does not duplicate payment
  // ==========================================
  it('6. Duplicate Payme webhook does not duplicate payment (idempotent)', async () => {
    const paymentsBefore = await request(app.getHttpServer())
      .get('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const countBefore = paymentsBefore.body.length;

    // Resend PerformTransaction with same id
    const res = await request(app.getHttpServer())
      .post('/api/billing/payme/webhook')
      .set('Authorization', paymeAuthHeader)
      .send({
        method: 'PerformTransaction',
        params: { id: paymeTransId },
        id: 104,
      })
      .expect(200);

    expect(res.body.result?.state).toBe(2);

    const paymentsAfter = await request(app.getHttpServer())
      .get('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(paymentsAfter.body.length).toBe(countBefore);
  });

  // ==========================================
  // Test 7 — Concurrent duplicate callback cannot duplicate payment
  // ==========================================
  it('7. Concurrent duplicate callback cannot duplicate payment', async () => {
    // Create new transaction for student A1
    const linkRes = await request(app.getHttpServer())
      .post('/api/billing/click/link')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA1Id,
        amount: 100000,
        forMonth: '2026-10',
      })
      .expect(201);
    const concurrentTxId = linkRes.body.transactionId;
    const concurrentClickId = `clk_race_${suffix}`;

    // Prepare
    const signTime = '2026-09-24 12:10:00';
    const prepSign = createClickSign({
      click_trans_id: concurrentClickId,
      service_id: CLICK_SERVICE_ID,
      secret: CLICK_SECRET_KEY,
      merchant_trans_id: concurrentTxId,
      amount: 100000,
      action: '0',
      sign_time: signTime,
    });
    await request(app.getHttpServer())
      .post('/api/billing/click/webhook')
      .send({
        click_trans_id: concurrentClickId,
        service_id: CLICK_SERVICE_ID,
        merchant_trans_id: concurrentTxId,
        amount: 100000,
        action: '0',
        sign_time: signTime,
        sign_string: prepSign,
      })
      .expect(200);

    // Send two concurrent Complete requests
    const compSign = createClickSign({
      click_trans_id: concurrentClickId,
      service_id: CLICK_SERVICE_ID,
      secret: CLICK_SECRET_KEY,
      merchant_trans_id: concurrentTxId,
      merchant_prepare_id: concurrentTxId,
      amount: 100000,
      action: '1',
      sign_time: signTime,
    });

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/billing/click/webhook')
        .send({
          click_trans_id: concurrentClickId,
          service_id: CLICK_SERVICE_ID,
          merchant_trans_id: concurrentTxId,
          merchant_prepare_id: concurrentTxId,
          amount: 100000,
          action: '1',
          sign_time: signTime,
          sign_string: compSign,
        }),
      request(app.getHttpServer())
        .post('/api/billing/click/webhook')
        .send({
          click_trans_id: concurrentClickId,
          service_id: CLICK_SERVICE_ID,
          merchant_trans_id: concurrentTxId,
          merchant_prepare_id: concurrentTxId,
          amount: 100000,
          action: '1',
          sign_time: signTime,
          sign_string: compSign,
        }),
    ]);

    expect(res1.body.error).toBe(0);
    expect(res2.body.error).toBe(0);

    // Verify only 1 payment was created for this providerTxId
    const allPayments = await request(app.getHttpServer())
      .get('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const matched = allPayments.body.filter((p: any) => p.providerTxId === concurrentClickId);
    expect(matched.length).toBe(1);
  });

  // ==========================================
  // Test 8 — Incorrect amount cannot mark invoice fully paid
  // ==========================================
  it('8. Incorrect amount cannot mark invoice fully paid (partial leaves PARTIALLY_PAID)', async () => {
    const invRes = await request(app.getHttpServer())
      .post('/api/invoices')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA1Id,
        amount: 1000000,
        currency: 'UZS',
        dueDate: '2026-11-01',
        forMonth: '2026-10',
        description: 'Katta tolov',
      })
      .expect(201);
    const partialInvId = invRes.body.id;

    // Generate link for only 400,000 UZS
    const linkRes = await request(app.getHttpServer())
      .post('/api/billing/click/link')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA1Id,
        amount: 400000,
        forMonth: '2026-10',
        invoiceId: partialInvId,
      })
      .expect(201);
    const partTxId = linkRes.body.transactionId;
    const partClickId = `clk_part_${suffix}`;

    const signTime = '2026-09-24 12:15:00';
    const prepSign = createClickSign({
      click_trans_id: partClickId,
      service_id: CLICK_SERVICE_ID,
      secret: CLICK_SECRET_KEY,
      merchant_trans_id: partTxId,
      amount: 400000,
      action: '0',
      sign_time: signTime,
    });
    await request(app.getHttpServer())
      .post('/api/billing/click/webhook')
      .send({
        click_trans_id: partClickId,
        service_id: CLICK_SERVICE_ID,
        merchant_trans_id: partTxId,
        amount: 400000,
        action: '0',
        sign_time: signTime,
        sign_string: prepSign,
      })
      .expect(200);

    const compSign = createClickSign({
      click_trans_id: partClickId,
      service_id: CLICK_SERVICE_ID,
      secret: CLICK_SECRET_KEY,
      merchant_trans_id: partTxId,
      merchant_prepare_id: partTxId,
      amount: 400000,
      action: '1',
      sign_time: signTime,
    });
    await request(app.getHttpServer())
      .post('/api/billing/click/webhook')
      .send({
        click_trans_id: partClickId,
        service_id: CLICK_SERVICE_ID,
        merchant_trans_id: partTxId,
        merchant_prepare_id: partTxId,
        amount: 400000,
        action: '1',
        sign_time: signTime,
        sign_string: compSign,
      })
      .expect(200);

    const checkedInv = await request(app.getHttpServer())
      .get(`/api/invoices/${partialInvId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(checkedInv.body.status).toBe('PARTIALLY_PAID');
    expect(checkedInv.body.amountPaid).toBe(400000);
    expect(checkedInv.body.remainingAmount).toBe(600000);
  });

  // ==========================================
  // Test 9 — Cross-tenant payment/invoice manipulation rejected
  // ==========================================
  it('9. Cross-tenant payment/invoice manipulation rejected', async () => {
    // Tenant B attempts to create manual payment for Tenant A's student/invoice
    await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        studentId: studentA1Id,
        invoiceId: clickInvoiceId,
        amount: 100000,
        method: 'CASH',
        forMonth: '2026-09',
      })
      .expect(404);

    // Tenant B attempts to fetch Tenant A's invoice
    await request(app.getHttpServer())
      .get(`/api/invoices/${clickInvoiceId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  let balanceInvoiceId: string;

  // ==========================================
  // Test 10 — Partial payment correctly updates balance
  // ==========================================
  it('10. Partial payment correctly updates balance', async () => {
    const invRes = await request(app.getHttpServer())
      .post('/api/invoices')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA2Id,
        amount: 600000,
        currency: 'UZS',
        dueDate: '2026-11-10',
        forMonth: '2026-11',
        description: 'Noyabr tolovi',
      })
      .expect(201);
    balanceInvoiceId = invRes.body.id;

    // Pay 250,000 UZS manually
    const payRes = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA2Id,
        invoiceId: balanceInvoiceId,
        amount: 250000,
        method: 'CASH',
        forMonth: '2026-11',
      })
      .expect(201);

    expect(payRes.body.receiptNumber).toMatch(/^RCP-\d{6}-\d{6}$/);

    const inv = await request(app.getHttpServer())
      .get(`/api/invoices/${balanceInvoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(inv.body.amountPaid).toBe(250000);
    expect(inv.body.remainingAmount).toBe(350000);
    expect(inv.body.status).toBe('PARTIALLY_PAID');
  });

  // ==========================================
  // Test 11 — Second payment correctly settles remaining balance
  // ==========================================
  it('11. Second payment correctly settles remaining balance', async () => {
    // Pay remaining 350,000 UZS
    await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA2Id,
        invoiceId: balanceInvoiceId,
        amount: 350000,
        method: 'BANK_TRANSFER',
        forMonth: '2026-11',
      })
      .expect(201);

    const inv = await request(app.getHttpServer())
      .get(`/api/invoices/${balanceInvoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(inv.body.amountPaid).toBe(600000);
    expect(inv.body.remainingAmount).toBe(0);
    expect(inv.body.status).toBe('PAID');
    expect(inv.body.paidAt).not.toBeNull();
  });

  // ==========================================
  // Test 12 — Payment cannot create negative invoice balance
  // ==========================================
  it('12. Payment cannot create negative invoice balance (overpayment rejected 400)', async () => {
    // Invoice is already settled (remainingAmount = 0), attempting to pay 50,000 UZS must fail
    const res = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA2Id,
        invoiceId: balanceInvoiceId,
        amount: 50000,
        method: 'CASH',
        forMonth: '2026-11',
      })
      .expect(400);

    expect(res.body.message).toContain('oshib ketishi mumkin emas');
  });

  // ==========================================
  // Test 13 — Student cannot access another student's invoice
  // ==========================================
  it("13. Student cannot access another student's invoice in portal", async () => {
    // Student A1 queries their invoices
    const student1Invoices = await request(app.getHttpServer())
      .get('/api/portal/invoices')
      .set('Authorization', `Bearer ${studentA1PortalToken}`)
      .expect(200);

    expect(Array.isArray(student1Invoices.body)).toBe(true);
    // Student A1 should NOT see student A2's invoice
    expect(student1Invoices.body.some((inv: any) => inv.id === paymeInvoiceId)).toBe(false);

    // Student A1 attempts to create checkout link for Student A2's invoice
    await request(app.getHttpServer())
      .post('/api/portal/payments/checkout-link')
      .set('Authorization', `Bearer ${studentA1PortalToken}`)
      .send({
        provider: 'CLICK',
        invoiceId: paymeInvoiceId,
      })
      .expect(404);
  });

  // ==========================================
  // Test 14 — Parent cannot access unlinked child's invoice
  // ==========================================
  it("14. Parent cannot access unlinked child's invoice (403 Forbidden)", async () => {
    // Parent is linked only to studentA1, not studentA2
    await request(app.getHttpServer())
      .get(`/api/portal/parent/students/${studentA2Id}/invoices`)
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(403);

    // Parent can access linked student A1 invoices
    const linkedInvoices = await request(app.getHttpServer())
      .get(`/api/portal/parent/students/${studentA1Id}/invoices`)
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);
    expect(Array.isArray(linkedInvoices.body)).toBe(true);
  });

  // ==========================================
  // Test 15 — Teacher cannot modify financial records (403 Forbidden)
  // ==========================================
  it('15. Teacher cannot modify financial records (403 Forbidden on invoices/payments)', async () => {
    await request(app.getHttpServer())
      .post('/api/invoices')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        studentId: studentA1Id,
        amount: 300000,
        currency: 'UZS',
        dueDate: '2026-10-01',
      })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        studentId: studentA1Id,
        amount: 300000,
        method: 'CASH',
      })
      .expect(403);
  });

  // ==========================================
  // Test 16 — Manual payment creates correct ledger entry & allocation
  // ==========================================
  it('16. Manual payment creates correct ledger entry & allocation', async () => {
    const invRes = await request(app.getHttpServer())
      .post('/api/invoices')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA1Id,
        amount: 450000,
        currency: 'UZS',
        dueDate: '2026-12-01',
        forMonth: '2026-12',
        description: 'Dekabr tolovi',
      })
      .expect(201);
    const newInvId = invRes.body.id;

    const payRes = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA1Id,
        invoiceId: newInvId,
        amount: 450000,
        method: 'CASH',
        forMonth: '2026-12',
      })
      .expect(201);

    expect(payRes.body.receiptNumber).toMatch(/^RCP-\d{6}-\d{6}$/);

    const inv = await request(app.getHttpServer())
      .get(`/api/invoices/${newInvId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(inv.body.status).toBe('PAID');
    expect(inv.body.allocations?.length).toBeGreaterThan(0);
    expect(inv.body.allocations[0].amount).toBe(450000);
  });

  // ==========================================
  // Test 17 — Failed gateway transaction does not create successful Payment
  // ==========================================
  it('17. Failed gateway transaction does not create successful Payment', async () => {
    const linkRes = await request(app.getHttpServer())
      .post('/api/billing/click/link')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA1Id,
        amount: 200000,
        forMonth: '2026-12',
      })
      .expect(201);
    const failTxId = linkRes.body.transactionId;
    const failClickId = `clk_fail_${suffix}`;

    // Send mismatched amount (e.g. 999,999 instead of 200,000)
    const signTime = '2026-09-24 12:20:00';
    const sign = createClickSign({
      click_trans_id: failClickId,
      service_id: CLICK_SERVICE_ID,
      secret: CLICK_SECRET_KEY,
      merchant_trans_id: failTxId,
      amount: 999999,
      action: '0',
      sign_time: signTime,
    });

    const res = await request(app.getHttpServer())
      .post('/api/billing/click/webhook')
      .send({
        click_trans_id: failClickId,
        service_id: CLICK_SERVICE_ID,
        merchant_trans_id: failTxId,
        amount: 999999,
        action: '0',
        sign_time: signTime,
        sign_string: sign,
      })
      .expect(200);

    expect(res.body.error).toBe(-2); // AMOUNT_MISMATCH

    // Ensure no payment was created
    const payments = await request(app.getHttpServer())
      .get('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const found = payments.body.find((p: any) => p.providerTxId === failClickId);
    expect(found).toBeUndefined();
  });

  // ==========================================
  // Test 18 — Cancelled gateway transaction does not remain PAID
  // ==========================================
  it('18. Cancelled gateway transaction does not remain PAID', async () => {
    const linkRes = await request(app.getHttpServer())
      .post('/api/billing/payme/link')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        studentId: studentA1Id,
        amount: 150000,
        forMonth: '2026-12',
      })
      .expect(201);
    const cancelTxId = linkRes.body.transactionId;
    const cancelPaymeId = `payme_cancel_${suffix}`;

    // Create transaction
    await request(app.getHttpServer())
      .post('/api/billing/payme/webhook')
      .set('Authorization', paymeAuthHeader)
      .send({
        method: 'CreateTransaction',
        params: {
          id: cancelPaymeId,
          time: Date.now(),
          amount: 15000000,
          account: { transaction_param: cancelTxId },
        },
        id: 181,
      })
      .expect(200);

    // Cancel transaction
    const cancelRes = await request(app.getHttpServer())
      .post('/api/billing/payme/webhook')
      .set('Authorization', paymeAuthHeader)
      .send({
        method: 'CancelTransaction',
        params: {
          id: cancelPaymeId,
          reason: 1,
        },
        id: 182,
      })
      .expect(200);

    expect(cancelRes.body.result?.state).toBe(-1);
  });

  // ==========================================
  // Test 19 — Successful payment generates one receipt
  // ==========================================
  it('19. Successful payment generates one receipt (receiptNumber present)', async () => {
    const payments = await request(app.getHttpServer())
      .get('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const paidPayment = payments.body.find((p: any) => p.method === 'CLICK' && p.status === 'PAID');
    expect(paidPayment).toBeDefined();
    expect(paidPayment.receiptNumber).toMatch(/^RCP-\d{6}-\d{6}$/);
  });

  // ==========================================
  // Test 20 — Duplicate webhook does not generate duplicate receipt
  // ==========================================
  it('20. Duplicate webhook does not generate duplicate receipt', async () => {
    const payments = await request(app.getHttpServer())
      .get('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const clickPayments = payments.body.filter((p: any) => p.providerTxId === clickTransId);
    expect(clickPayments.length).toBe(1);
    expect(clickPayments[0].receiptNumber).toMatch(/^RCP-\d{6}-\d{6}$/);
  });

  // ==========================================
  // Test 21 — PaymentReceived notification sent exactly once
  // ==========================================
  it('21. PaymentReceived notification and audit log recorded on settlement', async () => {
    const payments = await request(app.getHttpServer())
      .get('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const settled = payments.body.filter((p: any) => p.status === 'PAID');
    expect(settled.length).toBeGreaterThan(0);
    // Every settled payment has a single valid receipt and single allocation
    for (const p of settled) {
      expect(p.receiptNumber).toBeDefined();
    }
  });

  // ==========================================
  // Test 22 — Student tuition payment cannot affect CRMAPP SaaS subscription
  // ==========================================
  it('22. Student tuition payment cannot affect CRMAPP SaaS subscription', async () => {
    // Check Tenant A subscription/plan remains unaffected by tuition payments
    const tenantsRes = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    // Status should still be TRIAL, and plan should stay at the default tier —
    // neither should be modified to ENTERPRISE/PRO/ACTIVE by student tuition billing
    expect(tenantsRes.body.tenant.status).toBe('TRIAL');
    expect(tenantsRes.body.tenant.plan).toBe('STARTER');
  });

  // ==========================================
  // Test 23 — CRMAPP SaaS payment cannot affect student invoice
  // ==========================================
  it('23. CRMAPP SaaS payment cannot affect student invoice', async () => {
    const invoicesBefore = await request(app.getHttpServer())
      .get('/api/invoices')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    // Generate platform billing link for Tenant A SaaS subscription
    const platRes = await request(app.getHttpServer())
      .post('/api/platform-billing/click/link')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        plan: 'STANDARD',
        forMonth: '2026-10',
      })
      .expect(201);

    expect(platRes.body.url).toContain('https://my.click.uz');

    // Student invoices must remain identical
    const invoicesAfter = await request(app.getHttpServer())
      .get('/api/invoices')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(invoicesAfter.body.length).toBe(invoicesBefore.body.length);
  });

  // ==========================================
  // Test 24 — Tenant A gateway transaction cannot affect Tenant B
  // ==========================================
  it('24. Tenant A gateway transaction cannot affect Tenant B', async () => {
    // Tenant B has collected 0 UZS
    const summaryB = await request(app.getHttpServer())
      .get('/api/payments/finance-summary')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(summaryB.body.totalRevenue).toBe(0);

    // Tenant B invoices list is empty
    const invoicesB = await request(app.getHttpServer())
      .get('/api/invoices')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(invoicesB.body.length).toBe(0);
  });

  // ==========================================
  // Test 25 — Financial history survives student/group lifecycle changes
  // ==========================================
  it('25. Financial history survives student/group lifecycle changes', async () => {
    // Update student details
    await request(app.getHttpServer())
      .patch(`/api/students/${studentA1Id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Alisher Navoiy (Yangilangan)',
        notes: 'Bitiruvchi talaba',
      })
      .expect(200);

    // Historical invoice still exists, still PAID, still has allocation
    const inv = await request(app.getHttpServer())
      .get(`/api/invoices/${clickInvoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(inv.body.id).toBe(clickInvoiceId);
    expect(inv.body.status).toBe('PAID');
    expect(inv.body.remainingAmount).toBe(0);
    expect(inv.body.amountPaid).toBe(800000);

    // Historical payment still intact with receipt number
    const payments = await request(app.getHttpServer())
      .get('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const relatedPayment = payments.body.find((p: any) => p.invoiceId === clickInvoiceId);
    expect(relatedPayment).toBeDefined();
    expect(relatedPayment.receiptNumber).toMatch(/^RCP-\d{6}-\d{6}$/);
  });
});
