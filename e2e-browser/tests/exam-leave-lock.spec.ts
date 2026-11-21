import { expect, test } from '@playwright/test';
import { authSlot, api, centerUrl, cleanUpStagingCenters, newCenter } from './support';

// The exam locks when the student leaves the window (another tab or app,
// out of full screen) and hands the section in the third time. Its own
// controls must not count: the full-screen button and the confirm dialog
// on Submit (which blurs the window while it is open).
cleanUpStagingCenters();

test("the leave lock: the exam's own full-screen button and a cancelled Submit are not leaving; switching away is", async ({ page }) => {
  const a = await newCenter('lockprobe');
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'IELTS Mock', subject: 'Ingliz tili (IELTS)', maxStudents: 10 } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Mock Student', groupIds: [group.id] } });
  await api('PATCH', `/students/${kid.id}`, { token: a.token, body: { phone: '+998935556688', parentPhone: '+998945556688' } });
  const { pin } = await api('POST', `/students/${kid.id}/portal-pin`, { token: a.token });
  const mock = await api('POST', '/mock-tests', { token: a.token, body: { sample: true, title: 'Order Mock' } });
  mock.content.reading.passages[0].questions[0].explanation = 'Paragraph A says so in its first line.';
  await api('PATCH', `/mock-tests/${mock.id}`, { token: a.token, body: { content: mock.content, status: 'PUBLISHED' } });

  await page.goto(centerUrl(a.sub, '/portal'));
  await page.getByRole('textbox').first().pressSequentially('935556688');
  await authSlot('cabinet');
  await page.getByRole('button', { name: 'Davom etish' }).click();
  await page.getByPlaceholder('••••••').fill(String(pin));
  await page.getByRole('button', { name: 'Kabinetga kirish' }).click();
  await expect(page.getByText('Mock Student').first()).toBeVisible();

  await page.getByRole('button', { name: /Mashq/ }).first().click();
  await page.getByRole('button', { name: /Boshlash/ }).first().click();
  const lock = page.getByTestId('exam-locked');
  await page.getByRole('button', { name: /Boshlash/ }).first().click(); // Listening
  await page.getByRole('button', { name: /Testni boshlash/ }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);

  await page.getByRole('button', { name: "To'liq ekran" }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.waitForTimeout(500);
  await expect(lock).toHaveCount(0);

  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: /Topshirish/ }).last().click();
  await page.waitForTimeout(500);
  await expect(lock).toHaveCount(0);

  // Leaving for real: the lock, counting this as the first time of three.
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(lock).toBeVisible();
  await expect(lock).toContainText('1');
  await page.getByRole('button', { name: 'Testga qaytish' }).click();
  await expect(lock).toHaveCount(0);
});
