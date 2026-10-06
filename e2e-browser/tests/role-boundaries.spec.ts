import { expect, test } from '@playwright/test';
import { PASSWORD, addStaff, api, apiLogin, centerMonth, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, run } from './support';

// Role boundaries in the browser: what each role's menu offers and what
// the address bar cannot open.
cleanUpStagingCenters();

test('one person, two centers, a different role in each: switching from the menu', async ({ page }) => {
  const a = await newCenter('swa');
  const b = await newCenter('swb');
  const email = `zzbr-staff-sw-${run}@example.test`;
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

test('a teacher sees only their own groups; finance and reports stay closed', async ({ page }) => {
  const a = await newCenter('roles');
  const teacher = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Role Teacher', subject: 'Math' } });
  const email = `zzbr-teacher-roles-${run}@example.test`;
  await api('POST', `/teachers/${teacher.id}/account`, { token: a.token, body: { email, password: PASSWORD } });
  await api('POST', '/groups', { token: a.token, body: { name: 'Own group', subject: 'Math', teacherId: teacher.id, maxStudents: 10 } });
  await api('POST', '/groups', { token: a.token, body: { name: 'Someone else group', subject: 'Math', maxStudents: 10 } });

  await loginOnMainSite(page, email);
  await expectCenterDashboard(page, a.sub);
  const nav = page.locator('.sidebar');
  await expect(nav.getByRole('link', { name: "To'lovlar" })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Hisobotlar' })).toHaveCount(0);

  await nav.getByRole('link', { name: 'Guruhlar' }).click();
  await expect(page.getByText('Own group')).toBeVisible();
  await expect(page.getByText('Someone else group')).toHaveCount(0);

  for (const path of ['/payments', '/reports', '/leads', '/settings']) {
    await page.goto(centerUrl(a.sub, path));
    await expect(page.getByRole('alert').filter({ hasText: "Bu bo'lim sizning rolingiz uchun ochiq emas" })).toBeVisible();
  }
  // The API agrees with the pages.
  const token = await apiLogin(email);
  await expect(api('GET', '/payments', { token })).rejects.toThrow(/403/);
  await expect(api('GET', '/salary-payments/calculate', { token })).rejects.toThrow(/403/);
});

test("the owner sees who can do what, as the server enforces it", async ({ page }) => {
  const a = await newCenter('matrix');
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/settings'));
  await page.getByRole('button', { name: 'Xodimlar va huquqlar' }).click();
  const table = page.getByRole('table', { name: 'Kim nima qila oladi' });
  await expect(table).toBeVisible();
  const row = (label: string) => table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: label }) });
  // Columns: owner, admin, manager, reception, accountant, teacher.
  await expect(row("To'lov qabul qilish").getByRole('cell')).toHaveText(['✓', '✓', '—', '—', '✓', '—']);
  await expect(row("O'qituvchilar stavkasini ko'rish").getByRole('cell')).toHaveText(['✓', '✓', '—', '—', '✓', '—']);
  await page.screenshot({ path: test.info().outputPath('matrix.png'), fullPage: true });
});

test('the owner chooses what a new receptionist may do; the menu, the page and the server follow', async ({ page, browser }) => {
  const a = await newCenter('perm');
  const permGroup = await api('POST', '/groups', { token: a.token, body: { name: 'Perm group', subject: 'English', monthlyPrice: 300000, maxStudents: 10 } });
  const payer = await api('POST', '/students', { token: a.token, body: { fullName: 'Perm Payer', groupIds: [permGroup.id] } });
  await api('POST', '/payments', { token: a.token, body: { studentId: payer.id, amount: 300000, forMonth: centerMonth(), method: 'CASH' } });
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/settings'));
  await page.getByRole('button', { name: 'Xodimlar va huquqlar' }).click();

  const email = `zzbr-reception-perm-${run}@example.test`;
  await page.getByPlaceholder("To'liq ism").fill('Perm Reception');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Vaqtinchalik parol').fill(PASSWORD);
  await page.getByRole('button', { name: 'Xodim roli' }).click();
  await page.getByRole('option', { name: 'Qabulxona' }).click();
  await page.getByText('Nimalar qila oladi').click();
  // The receptionist's default is ticked; change two items.
  await expect(page.getByRole('checkbox', { name: "Lidlarni ko'rish" })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: "To'lov qabul qilish" })).not.toBeChecked();
  await page.getByRole('checkbox', { name: "To'lov qabul qilish" }).check();
  await page.getByRole('checkbox', { name: "Lidlarni ko'rish" }).uncheck();
  await page.getByRole('button', { name: "Xodim qo'shish" }).click();
  const editButton = page.getByRole('button', { name: /Huquqlar · moslashtirilgan/ });
  await expect(editButton).toBeVisible();

  // The receptionist, in their own browser.
  const staff = await (await browser.newContext()).newPage();
  await loginOnMainSite(staff, email);
  await expectCenterDashboard(staff, a.sub);
  const nav = staff.locator('.sidebar');
  await expect(nav.getByRole('link', { name: "To'lovlar" })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Lidlar (Qabul)' })).toHaveCount(0);
  await staff.goto(centerUrl(a.sub, '/payments'));
  await expect(staff.getByRole('button', { name: "+ Yangi to'lov" })).toBeVisible();
  // The page loads for reception (it once failed whole on the expenses it may not see).
  await expect(staff.getByText('Perm Payer').first()).toBeVisible();
  await expect(staff.getByRole('button', { name: 'Xarajatlar' })).toHaveCount(0);
  await staff.goto(centerUrl(a.sub, '/leads'));
  await expect(staff.getByRole('alert').filter({ hasText: "Bu bo'lim sizning rolingiz uchun ochiq emas" })).toBeVisible();
  const token = await apiLogin(email);
  await expect(api('GET', '/leads', { token })).rejects.toThrow(/403/);

  // Back to the role's default: payments are taken by the accountant again.
  await editButton.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Standartga qaytarish/ }).click();
  await expect(dialog.getByText("Rol bo'yicha standart")).toBeVisible();
  await dialog.getByRole('button', { name: 'Saqlash' }).click();
  await expect(page.getByRole('button', { name: /Huquqlar · moslashtirilgan/ })).toHaveCount(0);

  await staff.goto(centerUrl(a.sub, '/payments'));
  await expect(staff.getByRole('link', { name: 'Lidlar (Qabul)' })).toBeVisible();
  await expect(staff.getByRole('button', { name: "+ Yangi to'lov" })).toHaveCount(0);
  await expect(api('POST', '/payments', { token, body: {} })).rejects.toThrow(/403/);
  await staff.context().close();
});
