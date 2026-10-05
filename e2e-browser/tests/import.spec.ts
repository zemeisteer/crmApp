import { expect, test } from '@playwright/test';
import { createRequire } from 'module';
import { join } from 'path';
import { api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// Onboarding a center from Excel: teachers, then their groups, then the
// students in them - each checked first, then imported; the same file
// again adds nothing.
cleanUpStagingCenters();

// ExcelJS from the backend's dependencies (the same library the server reads with).
const ExcelJS = createRequire(join(__dirname, '..', '..', 'backend', 'package.json'))('exceljs');
async function sheet(rows: Array<Array<string | number>>) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  for (const r of rows) ws.addRow(r);
  return { name: 'import.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}

test('a new center is filled from Excel: teachers, groups, students', async ({ page }) => {
  const a = await newCenter('import');
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);

  const importFile = async (path: string, file: Awaited<ReturnType<typeof sheet>>, expectNew: number) => {
    await page.goto(centerUrl(a.sub, path));
    await page.getByRole('button', { name: "Excel'dan import" }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Faylni tanlash (.xlsx)').setInputFiles(file);
    await expect(dialog.getByText(`${expectNew} yangi`)).toBeVisible();
    await dialog.getByRole('button', { name: `Import qilish (${expectNew})` }).click();
    await expect(dialog.getByRole('status')).toContainText(`${expectNew} ta qo'shildi`);
    await page.keyboard.press('Escape');
  };

  await importFile('/teachers', await sheet([
    ['F.I.O', 'Telefon', 'Fan'],
    ['Aziza Karimova', '901112233', 'Ingliz tili'],
  ]), 1);
  await importFile('/groups', await sheet([
    ['Guruh nomi', 'Fan', "O'qituvchi", 'Oylik narx', 'Kunlar', 'Boshlanish vaqti'],
    ['IELTS Kechki', 'Ingliz tili', 'Aziza Karimova', 450000, 'Du, Cho, Ju', '18:00'],
  ]), 1);
  const students = await sheet([
    ['F.I.O', 'Ota-ona telefoni', 'Guruh'],
    ['Javohir Toshmatov', '931110001', 'IELTS Kechki'],
    ['Madina Rahimova', '942220002', 'IELTS Kechki'],
  ]);
  await importFile('/students', students, 2);

  // The same students file again: nothing new to import.
  await page.getByRole('button', { name: "Excel'dan import" }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Faylni tanlash (.xlsx)').setInputFiles(students);
  await expect(dialog.getByText("Yangi qator yo'q: hammasi tizimda bor.")).toBeVisible();

  // A row with an error: shown, and nothing can be imported.
  await dialog.getByLabel('Faylni tanlash (.xlsx)').setInputFiles(await sheet([['F.I.O', 'Guruh'], ['New Kid', 'No Such Group']]));
  await expect(dialog.getByText('Guruh topilmadi: No Such Group')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Import qilish/ })).toHaveCount(0);

  const groups = await api<Array<{ id: string; name: string; teacherId: string | null }>>('GET', '/groups', { token: a.token });
  expect(groups.map((g) => g.name)).toEqual(['IELTS Kechki']);
  expect(groups[0].teacherId).toBeTruthy();
  const detail = await api('GET', `/groups/${groups[0].id}`, { token: a.token });
  expect(detail.enrollments.map((e: { student: { fullName: string } }) => e.student.fullName).sort()).toEqual(['Javohir Toshmatov', 'Madina Rahimova']);
});
