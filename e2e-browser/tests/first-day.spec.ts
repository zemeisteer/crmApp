import { expect, test } from '@playwright/test';
import { authSlot, pickDate, pickTime, run, TARGET } from './support';

// A new center's first day, through the pages only: sign up with the phone
// code, the setup wizard step by step, then the dashboard with its "first
// steps" list, and creating the first group ticks its step.
test('sign up, the setup wizard, the first-steps list, the first group', async ({ page }) => {
  test.skip(TARGET !== 'local', 'makes a center outside the staging clean-up list');
  test.setTimeout(180_000);
  const email = `zzbr-first-${run}@example.test`;

  await page.goto('/register');
  await page.locator('#center-name-input').fill(`ZZ First Day ${run}`);
  await page.locator('#full-name-input').fill('First Owner');
  await page.locator('#email-input').fill(email);
  await page.locator('#phone-input').pressSequentially(`97${String(Date.now()).slice(-7)}`);
  await page.getByRole('button', { name: 'Kod olish' }).click();
  const hint = page.getByText(/Sinov muhiti \(SMS ulanmagan\), kod:/);
  await expect(hint).toBeVisible();
  const code = (await hint.textContent())!.match(/(\d{4,8})\s*$/)![1];
  await page.locator('#phone-code-input').fill(code);
  await page.locator('#password-input').fill('FirstDay2026');
  await page.locator('#terms-checkbox').check();
  await authSlot('register');
  await page.locator('#start-for-free-btn').click();

  // --- The setup wizard --------------------------------------------------------
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });
  await page.getByRole('button', { name: "Keyingi: yo'nalishlar" }).click();
  await page.getByRole('button', { name: 'Keyingi: fanlar' }).click();
  await page.getByPlaceholder('Yangi fan nomi (masalan, Fizika yoki SAT)').fill('Ingliz tili');
  await page.getByRole('button', { name: "+ Fan qo'shish" }).click();
  await page.getByRole('button', { name: 'Keyingi: kurslar' }).click();
  await page.getByRole('button', { name: 'Keyingi: workspace manzili' }).click();
  await page.getByRole('button', { name: 'Keyingi: birinchi filial' }).click();
  await page.getByRole('button', { name: 'Keyinroq' }).first().click();
  await page.getByRole('button', { name: "Hozircha o'tkazib yuborish" }).click();
  await page.getByRole('button', { name: /Keyin panel orqali/ }).click();
  await page.getByRole('button', { name: 'Sozlashni yakunlash 🎉' }).click();
  await page.getByRole('button', { name: "Boshqaruv paneliga o'tish" }).click();

  // --- The dashboard: first steps ---------------------------------------------
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  const steps = page.getByText('Birinchi qadamlar');
  await expect(steps).toBeVisible();
  // A teacher comes first: the group's form asks for one.
  const teacherStep = page.getByRole('link', { name: "O'qituvchi qo'shing" });
  await expect(teacherStep).toBeVisible();
  await teacherStep.click();
  await expect(page).toHaveURL(/\/teachers/);
  await page.getByRole('button', { name: "+ Yangi o'qituvchi" }).click();
  const tdlg = page.getByRole('dialog');
  await tdlg.getByRole('textbox').first().fill('Nodira Karimova');
  await tdlg.getByRole('button', { name: "O'qituvchini qo'shish" }).click();
  await expect(page.getByText('Nodira Karimova').first()).toBeVisible();

  // --- The first group, through the pages -------------------------------------
  await page.goto(page.url().replace(/\/teachers.*$/, '/dashboard'));
  await page.getByRole('link', { name: 'Birinchi guruhni yarating' }).click();
  await expect(page).toHaveURL(/\/groups/);
  await page.getByRole('button', { name: '+ Yangi guruh' }).click();
  const dialog = page.getByRole('dialog', { name: 'Yangi guruh' });
  await dialog.getByRole('group', { name: 'Guruh nomi' }).getByRole('textbox').fill('Birinchi guruh');
  await dialog.getByRole('group', { name: "Fan / Yo'nalish" }).getByRole('button').click();
  await page.getByRole('option', { name: 'Ingliz tili', exact: true }).click();
  await dialog.getByRole('group', { name: "O'qituvchi" }).getByRole('button').click();
  await page.getByRole('option', { name: /Nodira Karimova/ }).click();
  await dialog.getByRole('button', { name: 'Du', exact: true }).click();
  await pickTime(dialog.getByRole('group', { name: 'Boshlanish vaqti' }), 'Vaqtni tanlang', '09', '00');
  await pickTime(dialog.getByRole('group', { name: 'Tugash vaqti' }), 'Vaqtni tanlang', '10', '30');
  const now = new Date();
  await pickDate(dialog.getByRole('group', { name: 'Guruh boshlanish sanasi' }), now.getFullYear(), now.getMonth() + 1, 1);
  await dialog.getByRole('group', { name: "Oylik narx (so'm)" }).getByRole('spinbutton').fill('400000');
  await dialog.getByRole('group', { name: "Max o'rin" }).getByRole('spinbutton').fill('12');
  await dialog.getByRole('button', { name: 'Guruhni yaratish' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Birinchi guruh').first()).toBeVisible();

  // Both steps ticked on the dashboard.
  await page.goto(page.url().replace(/\/groups.*$/, '/dashboard'));
  const list = page.getByTestId('first-steps');
  await expect(list.locator('s', { hasText: "O'qituvchi qo'shing" })).toBeVisible();
  await expect(list.locator('s', { hasText: 'Birinchi guruhni yarating' })).toBeVisible();
});
