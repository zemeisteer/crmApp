import { expect, test } from '@playwright/test';
import { api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// Deleting for good through the pages: an archived custom field and an
// archived lead, each after a confirmation; a placement test with its results.
cleanUpStagingCenters();

test('an archived field and an archived lead are deleted for good; a placement test is deleted', async ({ page }) => {
  const a = await newCenter('delgood');
  const field = await api<{ id: string }>('POST', '/custom-fields', { token: a.token, body: { entityType: 'STUDENT', label: 'Old school', fieldType: 'TEXT' } });
  await api('POST', `/custom-fields/${field.id}/archive`, { token: a.token });
  const lead = await api<{ id: string }>('POST', '/leads', { token: a.token, body: { fullName: 'Old Lead', phone: `+99893${String(Date.now()).slice(-7)}` } });
  await api('POST', `/leads/${lead.id}/archive`, { token: a.token, body: { reason: 'test' } });
  await api('POST', '/placement-tests', { token: a.token, body: { subject: 'Ingliz tili', title: 'Old test', questions: [{ type: 'MCQ', prompt: 'She ___ a teacher.', options: ['am', 'is'], correctAnswer: 'B', level: 1 }] } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  page.on('dialog', (d) => void d.accept());

  // --- The archived field ------------------------------------------------------
  await page.goto(centerUrl(a.sub, '/settings'));
  await page.getByRole('button', { name: "Qo'shimcha maydonlar", exact: true }).click();
  const archived = page.getByRole('listitem').filter({ hasText: 'Old school' });
  await archived.getByRole('button', { name: "Butunlay o'chirish: Old school" }).click();
  await expect(page.getByText('Old school')).toHaveCount(0);

  // --- The archived lead -------------------------------------------------------
  await page.goto(centerUrl(a.sub, `/leads/${lead.id}`));
  await page.getByRole('button', { name: "Butunlay o'chirish" }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/leads'));
  await expect(api('GET', `/leads/${lead.id}`, { token: a.token })).rejects.toThrow(/-> 404/);

  // --- The placement test ------------------------------------------------------
  await page.goto(centerUrl(a.sub, '/students'));
  await page.getByRole('button', { name: /Daraja testi/ }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Testlar va natijalar' }).click();
  await expect(dlg.getByText('Old test')).toBeVisible();
  await dlg.getByRole('button', { name: "O'chirish: Old test" }).click();
  await expect(dlg.getByText('Old test')).toHaveCount(0);
  expect((await api<Array<{ title: string }>>('GET', '/placement-tests', { token: a.token })).map((t) => t.title)).not.toContain('Old test');
});
