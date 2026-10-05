import { expect, test } from '@playwright/test';
import { api, centerDay, centerMonth, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, money, newCenter } from './support';

// Tuition: taking a payment at the desk, safe against double clicks and
// retries after a lost reply; closing the cash desk at the end of the day.
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

test('closing the cash desk: what should be in the drawer, the count, the difference', async ({ page }) => {
  const a = await newCenter('cash');
  const month = centerMonth();
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Cash Student' } });
  await api('POST', '/payments', { token: a.token, body: { studentId: kid.id, amount: 400000, forMonth: month, method: 'CASH' } });
  await api('POST', '/payments', { token: a.token, body: { studentId: kid.id, amount: 250000, forMonth: month, method: 'CLICK' } });
  await api('POST', '/expenses', { token: a.token, body: { title: 'Markers', category: 'OTHER', amount: 50000, paymentMethod: 'CASH', date: centerDay() } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/payments'));
  await page.getByRole('button', { name: 'Kassa (kun)' }).click();
  const expected = page.locator('div:has(> div:text-is("Kassada bo\'lishi kerak"))').first();
  await expect(expected).toContainText(money(350000));

  await page.getByLabel("Sanalgan naqd pul (so'm)").fill('345000');
  await expect(page.getByText(/Farq: -5[\s,.]?000 \(kam\)/)).toBeVisible();
  await page.getByLabel('Izoh (farq sababi va h.k.)').fill('Qaytim berildi');
  await page.getByRole('button', { name: 'Kassani yopish' }).click();
  await expect(page.getByText(/Farq: -5[\s,.]?000 \(kam\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kassani yopish' })).toHaveCount(0);

  const day = await api('GET', '/cash/day', { token: a.token });
  expect(day.closed).toMatchObject({ expectedCash: 350000, countedCash: 345000, difference: -5000, note: 'Qaytim berildi' });
  await expect(api('POST', '/cash/day/close', { token: a.token, body: { date: day.date, countedCash: 1 } })).rejects.toThrow(/409/);
});

test('debtor reminders: previewed first, then sent once a day', async ({ page }) => {
  const a = await newCenter('remind');
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Remind group', subject: 'English', monthlyPrice: 300000, maxStudents: 10 } });
  await api('POST', '/students', { token: a.token, body: { fullName: 'Phone Debtor', groupIds: [group.id], parentPhone: '+998901234500' } });
  await api('POST', '/students', { token: a.token, body: { fullName: 'Silent Debtor', groupIds: [group.id] } });
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/payments'));
  await page.getByRole('button', { name: "Qarzdorlar ro'yxati" }).click();

  await page.getByRole('button', { name: 'Qarzdorlarga eslatma' }).click();
  const dialog = page.getByRole('dialog');
  const list = dialog.getByRole('table', { name: 'Eslatma oladigan qarzdorlar' });
  await expect(list.getByRole('row', { name: /Phone Debtor/ })).toContainText('SMS');
  await expect(list.getByRole('row', { name: /Silent Debtor/ })).toContainText("Telefon / Telegram yo'q");
  await expect(dialog.getByText("1 ta aloqa yo'q")).toBeVisible();

  await dialog.getByRole('button', { name: '1 ta qarzdorga yuborish' }).click();
  await expect(dialog.getByRole('status')).toHaveText("Yuborildi: 1. Bugun allaqachon yuborilgan: 0. Aloqa yo'q: 1.");
  await expect(list.getByRole('row', { name: /Phone Debtor/ })).toContainText('Bugun yuborilgan');
  await expect(dialog.getByText("Hozir yuboriladigan eslatma yo'q.")).toBeVisible();

  // Opened again the same day: nothing left to send.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Qarzdorlarga eslatma' }).click();
  await expect(page.getByRole('dialog').getByText('1 ta bugun yuborilgan')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: /qarzdorga yuborish/ })).toHaveCount(0);
});
