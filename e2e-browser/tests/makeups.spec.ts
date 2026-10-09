import { expect, test } from '@playwright/test';
import { api, centerDay, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// Make-up lessons: the owner sets credits to expire after 30 days in
// Settings; a student marked absent gets a credit on the "Missed lessons"
// tab, the credit is booked into another group's lesson from the Book
// dialog, the make-up shows in the roster and is marked attended - the
// credit is then used. On the group page a lesson is called off, listed
// and restored.
cleanUpStagingCenters();

const EVERY_DAY = 'Dushanba,Seshanba,Chorshanba,Payshanba,Juma,Shanba,Yakshanba';
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Credit = { id: string; status: string; note: string | null; expiresAt: string | null; bookings: Array<{ status: string; targetGroupId: string | null; date: string; startTime: string }> };

test('a missed lesson becomes a credit, is booked into another group, attended and used; a lesson is called off', async ({ page }) => {
  const a = await newCenter('makeups');
  const t1 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Origin Teacher', subject: 'English' } });
  const t2 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Host Teacher', subject: 'English' } });
  // Lessons every day, so the test does not depend on the weekday it runs on.
  const origin = await api('POST', '/groups', { token: a.token, body: { name: 'Origin Morning', subject: 'English', teacherId: t1.id, scheduleDays: EVERY_DAY, startTime: '09:00', endTime: '10:00', maxStudents: 10 } });
  const host = await api('POST', '/groups', { token: a.token, body: { name: 'Host Evening', subject: 'English', teacherId: t2.id, scheduleDays: EVERY_DAY, startTime: '15:00', endTime: '16:00', maxStudents: 10 } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Makeup Student', groupIds: [origin.id] } });
  const today = centerDay();
  const missed = addDays(today, -2);
  await api('POST', '/attendance', { token: a.token, body: { groupId: origin.id, date: missed, entries: [{ studentId: kid.id, status: 'ABSENT' }] } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);

  // --- Settings: credits expire 30 days after issue ----------------------
  await page.goto(centerUrl(a.sub, '/settings'));
  const policy = page.getByRole('region', { name: 'Qoplash kreditining muddati' });
  await expect(policy.getByRole('radio', { name: 'Muddatsiz' })).toBeChecked();
  await policy.getByRole('radio', { name: 'Berilgandan keyin' }).check();
  await policy.getByRole('spinbutton', { name: 'Kunlar soni' }).fill('30');
  await policy.getByRole('button', { name: 'Saqlash' }).click();
  await expect(policy.getByRole('status')).toHaveText('Saqlandi.');
  await page.reload();
  await expect(policy.getByRole('radio', { name: 'Berilgandan keyin' })).toBeChecked();
  await expect(policy.getByRole('spinbutton', { name: 'Kunlar soni' })).toHaveValue('30');

  await page.locator('.sidebar').getByRole('link', { name: 'Qoplash darslari' }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/makeups'));
  await expect(page.getByRole('heading', { name: 'Qoplash darslari' })).toBeVisible();

  // --- Missed lessons: issue a credit with a note --------------------------
  const missedRow = page.getByRole('list', { name: 'Qoldirilgan darslar' }).getByRole('listitem').filter({ hasText: 'Makeup Student' });
  await expect(missedRow).toContainText('Origin Morning');
  await expect(missedRow).toContainText('Kelmagan');
  await missedRow.getByRole('button', { name: /^Kredit berish: Makeup Student/ }).click();
  const issue = page.getByRole('dialog', { name: 'Qoplash krediti berish' });
  await issue.getByLabel('Izoh (ixtiyoriy)').fill('Kasal edi');
  await issue.getByRole('button', { name: 'Kredit berish' }).click();
  await expect(issue).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Makeup Student uchun kredit berildi.' })).toBeVisible();
  await expect(missedRow).toContainText('Foydalanilmagan');
  let credits = await api<Credit[]>('GET', '/makeups/credits', { token: a.token });
  expect(credits).toHaveLength(1);
  expect(credits[0]).toMatchObject({ status: 'ISSUED', note: 'Kasal edi' });
  const days = (Date.parse(credits[0].expiresAt!) - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(29);
  expect(days).toBeLessThan(31);

  // --- Credits: book a seat in the other group's lesson --------------------
  await page.getByRole('tab', { name: 'Kreditlar' }).click();
  const creditRow = page.getByRole('list', { name: 'Kreditlar' }).getByRole('listitem').filter({ hasText: 'Makeup Student' });
  await expect(creditRow).toContainText('Foydalanilmagan');
  await expect(creditRow).toContainText('Kasal edi');
  await expect(creditRow).toContainText('Amal qiladi');
  await creditRow.getByRole('button', { name: 'Darsga yozish: Makeup Student' }).click();
  const book = page.getByRole('dialog', { name: 'Qoplash darsiga yozish' });
  await book.getByRole('button', { name: 'Guruh', exact: true }).click();
  // The student's own group is not offered.
  await expect(page.getByRole('option', { name: /Origin Morning/ })).toHaveCount(0);
  await page.getByRole('option', { name: /Host Evening/ }).click();
  // Only dates on which the group has a lesson; the first is today.
  await book.getByRole('button', { name: 'Dars kuni', exact: true }).click();
  await page.getByRole('option').first().click();
  await expect(book.getByRole('button', { name: 'Dars kuni', exact: true })).toContainText('15:00–16:00');
  await book.getByRole('button', { name: 'Yozish', exact: true }).click();
  await expect(book).toHaveCount(0);
  await expect(creditRow).toContainText('Yozilgan');
  await expect(creditRow).toContainText('Host Evening');
  credits = await api<Credit[]>('GET', '/makeups/credits', { token: a.token });
  expect(credits[0].status).toBe('BOOKED');
  expect(credits[0].bookings[0]).toMatchObject({ status: 'BOOKED', targetGroupId: host.id, date: today, startTime: '15:00' });

  // --- Roster: mark attended -----------------------------------------------
  await page.getByRole('tab', { name: 'Qoplash jadvali' }).click();
  const rosterItem = page.getByRole('listitem', { name: /^Makeup Student/ });
  await expect(rosterItem).toContainText('Host Evening');
  await expect(rosterItem).toContainText('Rejada');
  await rosterItem.getByRole('button', { name: 'Keldi: Makeup Student' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Makeup Student: keldi. Kredit ishlatildi.' })).toBeVisible();
  await expect(rosterItem).toContainText('Keldi');
  await expect(rosterItem.getByRole('button')).toHaveCount(0);

  // --- After a reload the credit is used ---------------------------------
  await page.reload();
  await page.getByRole('tab', { name: 'Kreditlar' }).click();
  await expect(page.getByRole('list', { name: 'Kreditlar' }).getByRole('listitem').filter({ hasText: 'Makeup Student' })).toContainText('Ishlatilgan');
  credits = await api<Credit[]>('GET', '/makeups/credits', { token: a.token });
  expect(credits[0].status).toBe('USED');
  expect(credits[0].bookings[0].status).toBe('ATTENDED');

  // --- Group page: call off a lesson, see it listed, restore it ------------
  await page.goto(centerUrl(a.sub, `/groups/${origin.id}`));
  const cancelled = page.getByRole('region', { name: 'Bekor qilingan darslar' });
  await expect(cancelled).toContainText("Bekor qilingan dars yo'q.");
  await cancelled.getByRole('button', { name: 'Darsni bekor qilish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Bitta darsni bekor qilish' });
  await dialog.getByRole('button', { name: 'Qaysi dars', exact: true }).click();
  // Today, then the next days: the fourth option is three days ahead.
  await page.getByRole('option').nth(3).click();
  await dialog.getByLabel('Sababi (ixtiyoriy)').fill('Bayram');
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'Darsni bekor qilish' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(cancelled.getByRole('listitem')).toHaveCount(1);
  await expect(cancelled.getByRole('listitem')).toContainText('Bayram');
  const target = addDays(today, 3);
  const list = await api<Array<{ id: string; groupId: string; date: string; reason: string | null }>>('GET', `/lessons/cancellations?from=${today}&to=${addDays(today, 10)}`, { token: a.token });
  expect(list).toEqual([expect.objectContaining({ groupId: origin.id, date: target, reason: 'Bayram' })]);
  const lessons = await api<Array<{ date: string; cancelled: boolean }>>('GET', `/lessons?from=${target}&to=${target}&groupId=${origin.id}`, { token: a.token });
  expect(lessons).toEqual([expect.objectContaining({ date: target, cancelled: true })]);

  page.once('dialog', (d) => d.accept());
  await cancelled.getByRole('button', { name: /^Tiklash:/ }).click();
  await expect(cancelled).toContainText("Bekor qilingan dars yo'q.");
  expect(await api('GET', `/lessons/cancellations?from=${today}&to=${addDays(today, 10)}`, { token: a.token })).toEqual([]);
});
