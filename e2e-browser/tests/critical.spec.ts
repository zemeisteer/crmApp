import { expect, test } from '@playwright/test';
import { PASSWORD, addStaff, api, centerUrl, expectCenterDashboard, loginOnMainSite, newCenter, run } from './support';

// Every test gets its own browser context (Playwright's default): no
// session leaks from one flow into the next.

test('sign in on the main site -> the center\'s own address -> reload keeps the session', async ({ page }) => {
  const a = await newCenter('login');
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  // The one-time code is gone from the address bar.
  expect(page.url()).not.toContain('code=');
  await page.reload();
  await expectCenterDashboard(page, a.sub);
  // The main site kept no session of its own.
  const main = await page.context().newPage();
  await main.goto('/login?main=1');
  expect(await main.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('talimcrm_') && k !== 'talimcrm_last_center'))).toEqual([]);
});

test('one person, two centers, a different role in each: switching from the menu', async ({ page }) => {
  const a = await newCenter('swa');
  const b = await newCenter('swb');
  const email = `staff-sw-${run}@example.test`;
  await addStaff(a.token, email, 'ACCOUNTANT');
  await addStaff(b.token, email, 'TEACHER');

  await loginOnMainSite(page, email);
  await page.locator(`#workspace-${a.sub}`).click();
  await expectCenterDashboard(page, a.sub);
  const nav = page.locator('.sidebar');
  await expect(nav.getByRole('link', { name: "To'lovlar" })).toBeVisible();

  await nav.getByRole('group', { name: 'Boshqa markazlarim' }).getByRole('button').click();
  await expectCenterDashboard(page, b.sub);
  // A teacher in B: no payments in the menu, and not through the address either.
  await expect(nav.getByRole('link', { name: "To'lovlar" })).toHaveCount(0);
  await page.goto(centerUrl(b.sub, '/payments'));
  await expect(page.getByRole('alert').filter({ hasText: "Bu bo'lim sizning rolingiz uchun ochiq emas" })).toBeVisible();
});

test('logout: protected pages are refused afterwards', async ({ page }) => {
  const a = await newCenter('logout');
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.locator('.sidebar').getByRole('button', { name: 'Chiqish' }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/login'));
  await page.goto(centerUrl(a.sub, '/payments'));
  await expect(page).toHaveURL(centerUrl(a.sub, '/login'));
  await expect(page.getByRole('button', { name: "+ Yangi to'lov" })).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage.getItem('talimcrm_token'), localStorage.getItem('talimcrm_refresh')])).toEqual([null, null]);
});

test('staff removed while their browser is open: the next request is refused', async ({ page }) => {
  const a = await newCenter('removal');
  const email = `staff-rm-${run}@example.test`;
  const staffId = await addStaff(a.token, email, 'ADMIN');
  await loginOnMainSite(page, email);
  await expectCenterDashboard(page, a.sub);
  await page.locator('.sidebar').getByRole('link', { name: "O'quvchilar" }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/students'));

  await api('DELETE', `/staff/${staffId}`, { token: a.token });

  await page.locator('.sidebar').getByRole('link', { name: 'Guruhlar' }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/login'));
  expect(await page.evaluate(() => localStorage.getItem('talimcrm_token'))).toBeNull();
});

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

test('new student: a retry after a lost reply makes one student, with what was typed', async ({ page }) => {
  const a = await newCenter('student');
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/students'));

  let lost = 0;
  await page.route('**/api/students', async (route) => {
    if (route.request().method() === 'POST' && lost === 0) {
      lost++;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.fallback();
  });

  await page.getByRole('button', { name: "+ Yangi o'quvchi" }).click();
  const dialog = page.getByRole('dialog', { name: "Yangi o'quvchi" });
  await dialog.getByRole('group', { name: "To'liq ism" }).getByRole('textbox').fill('Retry Student');
  await dialog.getByRole('group', { name: 'Telefon', exact: true }).getByRole('textbox').pressSequentially('901234567');
  const save = dialog.getByRole('button', { name: "O'quvchini qo'shish" });
  await save.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(lost).toBe(1);

  const list = await api<any>('GET', '/students', { token: a.token });
  const rows = (Array.isArray(list) ? list : list.items ?? list.data).filter((s: { fullName: string }) => s.fullName === 'Retry Student');
  expect(rows).toHaveLength(1);
  expect(rows[0].phone).toBe('+998 90 123 45 67');
  expect(PASSWORD).toBeTruthy();
});
