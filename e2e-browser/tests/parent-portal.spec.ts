import { expect, test } from '@playwright/test';
import { api, centerUrl, cleanUpStagingCenters, newCenter } from './support';

// Parent portal: a parent signs in with their phone and the child's PIN,
// sees their child as a parent - read-only, without the child's AI tutor.
cleanUpStagingCenters();

test("a parent signs in with the child's PIN and only watches", async ({ page }) => {
  const a = await newCenter('parent');
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Parents Group', subject: 'English', monthlyPrice: 350000, maxStudents: 10 } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Portal Child', groupIds: [group.id] } });
  await api('PATCH', `/students/${kid.id}`, { token: a.token, body: { phone: '+998931112233', parentPhone: '+998941112233' } });
  const { pin } = await api('POST', `/students/${kid.id}/portal-pin`, { token: a.token });

  await page.goto(centerUrl(a.sub, '/portal'));
  await page.getByRole('textbox').first().pressSequentially('941112233');
  await page.getByRole('button', { name: 'Davom etish' }).click();
  await page.getByPlaceholder('••••••').fill(String(pin));
  await page.getByRole('button', { name: 'Kabinetga kirish' }).click();

  await expect(page.getByText('Portal Child').first()).toBeVisible();
  await expect(page.getByText('Ota-ona').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /AI/ })).toHaveCount(0);
  // The staff session was never touched: the portal keeps its own.
  expect(await page.evaluate(() => localStorage.getItem('talimcrm_token'))).toBeNull();
});
