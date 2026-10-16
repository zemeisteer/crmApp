import { expect, test } from '@playwright/test';
import { api, centerMonth, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// The features added in the last round, as used: a debtor's "Accept payment",
// a lead's other directions in the form, the group form's teacher list, the
// landing menu on a phone, and the keyboard in a dialog. Each step is checked
// on the page and through the API (what was saved).
cleanUpStagingCenters();

test('a debtor\'s "Accept payment" opens the form on that student and debt; the payment is saved for that month', async ({ page }) => {
  const a = await newCenter('nfpay');
  const g = await api('POST', '/groups', { token: a.token, body: { name: 'NF Group', subject: 'English', monthlyPrice: 450000, maxStudents: 10 } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'NF Qarzdor', phone: '+998901234777', groupIds: [g.id] } });
  // A part paid already: the form offers what is left.
  await api('POST', '/payments', { token: a.token, body: { studentId: kid.id, amount: 150000, forMonth: centerMonth(), method: 'CASH' } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/payments'));
  await page.getByRole('button', { name: "Qarzdorlar ro'yxati" }).click();
  const row = page.getByRole('row').filter({ hasText: 'NF Qarzdor' });
  await row.getByRole('button', { name: "+ To'lov qabul qilish" }).click();
  const dialog = page.getByRole('dialog', { name: "Yangi to'lov" });
  await expect(dialog.getByRole('group', { name: "O'quvchi" }).locator('input')).toHaveValue('NF Qarzdor');
  await expect(dialog.getByRole('group', { name: "O'quvchi" })).toContainText('NF Group');
  const amount = dialog.getByRole('group', { name: "Summa (so'm, chegirmasiz)" }).locator('input');
  await expect(amount).toHaveValue('300000');
  await dialog.getByRole('button', { name: "To'lovni qo'shish" }).click();
  await expect(dialog).toBeHidden();

  const pays = await api<{ items?: Array<{ studentId: string; amount: number; forMonth: string }> } | Array<{ studentId: string; amount: number; forMonth: string }>>('GET', `/payments?studentId=${kid.id}`, { token: a.token });
  const list = Array.isArray(pays) ? pays : pays.items ?? [];
  expect(list.filter((p) => p.studentId === kid.id).map((p) => [p.amount, p.forMonth]).sort()).toEqual([[150000, centerMonth()], [300000, centerMonth()]].sort());
});

test('a lead\'s other directions: kept when the main one is cleared, saved as shown', async ({ page }) => {
  const a = await newCenter('nflead');
  const math = await api('POST', '/subjects', { token: a.token, body: { name: 'Matematika NF' } });
  const chess = await api('POST', '/subjects', { token: a.token, body: { name: 'Shaxmat NF' } });
  await api('POST', '/subjects', { token: a.token, body: { name: 'Ingliz NF' } });
  const lead = await api('POST', '/leads', { token: a.token, body: { fullName: 'NF Lid', phone: '+998901114455', desiredSubjectId: math.id, extraSubjectIds: [chess.id] } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, `/leads/${lead.id}`));
  await page.getByRole('button', { name: 'Tahrirlash' }).click();
  const form = page.getByRole('dialog', { name: 'Lidni tahrirlash' });
  const others = form.getByRole('group', { name: "Yana qaysi yo'nalishlarga qiziqadi" });
  await expect(others.getByRole('button', { name: /Shaxmat NF/ })).toHaveAttribute('aria-pressed', 'true');

  // The main direction is cleared: the other one is still shown, still chosen.
  await form.getByRole('button', { name: 'Qiziqqan fan' }).click();
  await page.getByRole('option', { name: '— Tanlanmagan —' }).click();
  await expect(others.getByRole('button', { name: /Shaxmat NF/ })).toHaveAttribute('aria-pressed', 'true');
  await form.getByRole('button', { name: 'Saqlash' }).click();
  await expect(form).toBeHidden();
  const saved = await api<{ desiredSubjectId: string | null; extraSubjectIds: string[] }>('GET', `/leads/${lead.id}`, { token: a.token });
  expect(saved).toMatchObject({ desiredSubjectId: null, extraSubjectIds: [chess.id] });
  // And it is found by that direction.
  const page1 = await api<{ items: Array<{ id: string }> }>('GET', `/leads?desiredSubjectId=${chess.id}`, { token: a.token });
  expect(page1.items.map((l) => l.id)).toContain(lead.id);
});

test('the group form keeps a chosen teacher of another direction; a dialog works from the keyboard', async ({ page }) => {
  const a = await newCenter('nfgrp');
  const t1 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'NF Ustoz Ingliz', subject: 'Ingliz tili' } });
  await api('POST', '/teachers', { token: a.token, body: { fullName: 'NF Ustoz Mat', subject: 'Matematika' } });
  const g = await api('POST', '/groups', { token: a.token, body: { name: 'NF Mixed', subject: 'Matematika', teacherId: t1.id } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/groups'));
  await page.getByRole('row').filter({ hasText: 'NF Mixed' }).getByRole('button', { name: /Tahrirlash/ }).first().click();
  const dialog = page.getByRole('dialog');
  // The group's teacher teaches another direction: still the one shown.
  await expect(dialog).toContainText('NF Ustoz Ingliz');
  // Keyboard: focus is inside the dialog, Escape closes it, nothing saved.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const after = await api<{ teacherId: string }>('GET', `/groups/${g.id}`, { token: a.token });
  expect(after.teacherId).toBe(t1.id);
});

test('the landing menu on a phone: opens, closes, and the page does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Menyu' });
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const menu = page.locator('#lp-mobile-menu');
  await expect(menu.getByRole('link').first()).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Kirish' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
