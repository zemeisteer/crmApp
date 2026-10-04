import { expect, test } from '@playwright/test';
import { api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// Tuition: taking a payment at the desk, safe against double clicks and
// retries after a lost reply.
cleanUpStagingCenters();

test('payment: a double click and a retry after a lost reply each record one payment', async ({ page }) => {
  const a = await newCenter('pay');
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Pay group', subject: 'English', monthlyPrice: 400000, maxStudents: 10 } });
  const student = await api('POST', '/students', { token: a.token, body: { fullName: 'Payment Student', groupIds: [group.id] } });
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/payments'));

  const pay = async (amount: string) => {
    await page.getByRole('button', { name: "+ Yangi to'lov" }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder("Ism bo'yicha qidirish...").fill('Payment');
    await dialog.getByRole('button', { name: /Payment Student/ }).click();
    await dialog.getByRole('group', { name: "Summa (so'm, chegirmasiz)" }).getByRole('spinbutton').fill(amount);
    return dialog;
  };

  // 1. A double click on the save button.
  const d1 = await pay('150000');
  await d1.getByRole('button', { name: "To'lovni qo'shish" }).dblclick();
  await expect(page.getByRole('dialog', { name: "To'lov kvitansiyasi" })).toBeVisible();
  await page.keyboard.press('Escape');

  // 2. The server records the payment but the reply never arrives; the
  //    cashier presses save again.
  let lost = 0;
  await page.route('**/api/payments', async (route) => {
    if (route.request().method() === 'POST' && lost === 0) {
      lost++;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.fallback();
  });
  const d2 = await pay('100000');
  await d2.getByRole('button', { name: "To'lovni qo'shish" }).click();
  await expect(d2.getByRole('alert')).toBeVisible();
  await d2.getByRole('button', { name: "To'lovni qo'shish" }).click();
  await expect(page.getByRole('dialog', { name: "To'lov kvitansiyasi" })).toBeVisible();
  expect(lost).toBe(1);

  const payments = (await api<Array<{ studentId: string; amount: number }>>('GET', '/payments', { token: a.token })).filter((p) => p.studentId === student.id);
  expect(payments.map((p) => p.amount).sort((x, y) => x - y)).toEqual([100000, 150000]);
});
