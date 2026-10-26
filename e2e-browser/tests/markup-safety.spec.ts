import { expect, test } from '@playwright/test';
import { PASSWORD, api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, run } from './support';

// Markup typed by a user (a custom field's label and value, a student's
// name, a chat message) is shown as text: nothing runs, no element is made
// from it.
cleanUpStagingCenters();

const EVIL_IMG = '<img src=x onerror="window.__xss=1">';
const EVIL_SCRIPT = '<script>window.__xss=2</script>';

test('custom fields, a student name and chat messages show markup as text', async ({ page }) => {
  const a = await newCenter('xss');
  const label = `${EVIL_IMG} Izoh`;
  const f = await api('POST', '/custom-fields', { token: a.token, body: { entityType: 'STUDENT', label, fieldType: 'TEXT' } });
  const name = `Xss Kid ${EVIL_SCRIPT}`;
  const teacherEmail = `zzbr-xss-t-${run}@example.test`;
  const t = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Xss Teacher', subject: 'English' } });
  await api('POST', `/teachers/${t.id}/account`, { token: a.token, body: { email: teacherEmail, password: PASSWORD } });
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Xss Group', subject: 'English', teacherId: t.id, maxStudents: 10 } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: name, groupIds: [group.id], customFields: { [f.id]: `${EVIL_SCRIPT}${EVIL_IMG}` } } });

  page.on('dialog', (d) => {
    throw new Error(`a dialog opened: ${d.message()}`);
  });
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, `/students/${kid.id}`));
  await expect(page.getByText(label).first()).toBeVisible();
  await expect(page.getByText(`${EVIL_SCRIPT}${EVIL_IMG}`).first()).toBeVisible();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  // Chat: the teacher writes markup into the group conversation; it is shown as typed.
  const tTok = (await api<{ accessToken: string }>('POST', '/auth/login', { body: { email: teacherEmail, password: PASSWORD } })).accessToken;
  const conv = await api<{ id: string }>('POST', '/chat/conversations', { token: tTok, body: { kind: 'GROUP', groupId: group.id } });
  await api('POST', `/chat/conversations/${conv.id}/messages`, { token: tTok, body: { body: `Salom ${EVIL_IMG}${EVIL_SCRIPT}`, clientMessageId: `xss${run}`.padEnd(12, '0') } });
  await page.goto(centerUrl(a.sub, '/messages'));
  await page.getByRole('list', { name: 'Suhbatlar' }).getByRole('button', { name: /Xss Group/ }).click();
  await expect(page.getByText(`Salom ${EVIL_IMG}${EVIL_SCRIPT}`).first()).toBeVisible();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});
