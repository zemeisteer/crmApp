import { expect, test } from '@playwright/test';
import { api, centerDay, centerUrl, cleanUpStagingCenters, expectCenterDashboard, isApiUrl, loginOnMainSite, newCenter } from './support';

// A lesson is one lesson: in the make-up form the lessons listed are those
// of the group picked now (not of a group picked a moment earlier whose
// answer came late), a group with two lessons a day has each of them booked
// and called off on its own, and a group that is deleted takes its open
// make-up out of the cabinet and the calendar.
cleanUpStagingCenters();

const DAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const EVERY_DAY = 'Dushanba,Seshanba,Chorshanba,Payshanba,Juma,Shanba,Yakshanba';
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekdayName = (date: string) => DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

type Credit = { id: string; status: string; bookings: Array<{ id: string; status: string; note: string | null; targetGroupId: string | null; targetScheduleId: string | null; date: string; startTime: string }> };
type Lesson = { date: string; startTime: string; cancelled: boolean; scheduleId: string | null };

test('make-up form: a late answer for the group picked first is ignored; one of two lessons of a day is booked, then called off on its own', async ({ page }) => {
  const a = await newCenter('lessonid');
  const today = centerDay();
  const tomorrow = addDays(today, 1);
  const home = await api('POST', '/groups', { token: a.token, body: { name: 'Home Morning', subject: 'English', scheduleDays: EVERY_DAY, startTime: '08:00', endTime: '09:00', maxStudents: 10 } });
  const slow = await api('POST', '/groups', { token: a.token, body: { name: 'Slow Noon', subject: 'English', scheduleDays: EVERY_DAY, startTime: '12:00', endTime: '13:00', maxStudents: 10 } });
  // Two lessons on one day of the week: 15:00 and 17:00.
  const twice = await api('POST', '/groups', { token: a.token, body: { name: 'Twice Daily', subject: 'English', scheduleDays: weekdayName(tomorrow), startTime: '15:00', endTime: '16:00', maxStudents: 10 } });
  const late = await api('POST', '/schedule', { token: a.token, body: { groupId: twice.id, dayOfWeek: new Date(`${tomorrow}T00:00:00Z`).getUTCDay() || 7, startTime: '17:00', endTime: '18:00' } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Identity Student', groupIds: [home.id] } });
  const missed = addDays(today, -2);
  await api('POST', '/attendance', { token: a.token, body: { groupId: home.id, date: missed, entries: [{ studentId: kid.id, status: 'ABSENT' }] } });
  const credit = await api<Credit>('POST', '/makeups/credits', { token: a.token, body: { studentId: kid.id, groupId: home.id, date: missed, reason: 'ABSENT' } });
  const creditNow = async () => (await api<Credit[]>('GET', '/makeups/credits', { token: a.token })).find((c) => c.id === credit.id)!;

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/makeups'));
  await page.getByRole('tab', { name: 'Kreditlar' }).click();
  const row = page.getByRole('list', { name: 'Kreditlar' }).getByRole('listitem').filter({ hasText: 'Identity Student' });
  await row.getByRole('button', { name: 'Darsga yozish: Identity Student' }).click();
  const book = page.getByRole('dialog', { name: 'Qoplash darsiga yozish' });

  // The lessons of the first group answer three seconds late.
  let slowAnswered = false;
  await page.route((url) => isApiUrl(url.toString()) && url.pathname.endsWith('/lessons') && url.searchParams.get('groupId') === slow.id, async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    slowAnswered = true;
    await route.continue();
  });
  await book.getByRole('button', { name: 'Guruh', exact: true }).click();
  await page.getByRole('option', { name: /Slow Noon/ }).click();
  await book.getByRole('button', { name: 'Guruh', exact: true }).click();
  const fast = page.waitForResponse((r) => isApiUrl(r.url()) && new URL(r.url()).searchParams.get('groupId') === twice.id);
  await page.getByRole('option', { name: /Twice Daily/ }).click();
  await fast;
  const lateAnswer = page.waitForResponse((r) => isApiUrl(r.url()) && new URL(r.url()).searchParams.get('groupId') === slow.id);
  await lateAnswer;
  expect(slowAnswered).toBe(true);

  // The list is the group picked now: its two lessons a day, nothing at 12:00.
  await book.getByRole('button', { name: 'Dars kuni', exact: true }).click();
  await expect(page.getByRole('option', { name: /15:00–16:00/ }).first()).toBeVisible();
  await expect(page.getByRole('option', { name: /17:00–18:00/ }).first()).toBeVisible();
  await expect(page.getByRole('option', { name: /12:00–13:00/ })).toHaveCount(0);
  // The second lesson of the first day is chosen - not "the first of that day".
  await page.getByRole('option', { name: /17:00–18:00/ }).first().click();
  await expect(book.getByRole('button', { name: 'Dars kuni', exact: true })).toContainText('17:00–18:00');
  await book.getByRole('button', { name: 'Yozish', exact: true }).click();
  await expect(book).toHaveCount(0);
  await expect(row).toContainText('Yozilgan');
  await expect(row).toContainText('Twice Daily');
  let c = await creditNow();
  expect(c.status).toBe('BOOKED');
  expect(c.bookings[0]).toMatchObject({ status: 'BOOKED', targetGroupId: twice.id, targetScheduleId: late.id, date: tomorrow, startTime: '17:00' });

  // --- The group page: call off the 17:00 lesson only -------------------------
  await page.goto(centerUrl(a.sub, `/groups/${twice.id}`));
  const cancelled = page.getByRole('region', { name: 'Bekor qilingan darslar' });
  await cancelled.getByRole('button', { name: 'Darsni bekor qilish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Bitta darsni bekor qilish' });
  await dialog.getByRole('button', { name: 'Qaysi dars', exact: true }).click();
  // Both lessons of the day are offered, each on its own.
  await expect(page.getByRole('option', { name: /15:00–16:00/ }).first()).toBeVisible();
  await page.getByRole('option', { name: /17:00–18:00/ }).first().click();
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'Darsni bekor qilish' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(cancelled.getByRole('listitem')).toHaveCount(1);
  // The page says the make-up booked into it was released.
  await expect(page.getByRole('status').filter({ hasText: /1 ta qoplash yozuvi bekor bo'ldi/ })).toBeVisible();
  const lessons = await api<Lesson[]>('GET', `/lessons?from=${tomorrow}&to=${tomorrow}&groupId=${twice.id}`, { token: a.token });
  expect(lessons.map((l) => [l.startTime, l.cancelled])).toEqual([['15:00', false], ['17:00', true]]);
  c = await creditNow();
  expect(c.status).toBe('ISSUED');
  expect(c.bookings[0]).toMatchObject({ status: 'CANCELLED', note: 'LESSON_CANCELLED' });
});

test("a group is deleted: its open make-up is released and said so; the parent's cabinet and calendar no longer show it", async ({ page, browser }) => {
  const a = await newCenter('groupgone');
  const today = centerDay();
  const own = await api('POST', '/groups', { token: a.token, body: { name: 'Staying Group', subject: 'English', scheduleDays: EVERY_DAY, startTime: '09:00', endTime: '10:00', maxStudents: 10 } });
  const host = await api('POST', '/groups', { token: a.token, body: { name: 'Leaving Group', subject: 'English', scheduleDays: EVERY_DAY, startTime: '15:00', endTime: '16:00', maxStudents: 10 } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Gone Child', groupIds: [own.id] } });
  await api('PATCH', `/students/${kid.id}`, { token: a.token, body: { phone: '+998931114455', parentPhone: '+998941114455' } });
  const { pin } = await api('POST', `/students/${kid.id}/portal-pin`, { token: a.token });
  const missed = addDays(today, -2);
  await api('POST', '/attendance', { token: a.token, body: { groupId: own.id, date: missed, entries: [{ studentId: kid.id, status: 'ABSENT' }] } });
  const credit = await api<Credit>('POST', '/makeups/credits', { token: a.token, body: { studentId: kid.id, groupId: own.id, date: missed, reason: 'ABSENT' } });
  await api('POST', `/makeups/credits/${credit.id}/book`, { token: a.token, body: { mode: 'GROUP_LESSON', targetGroupId: host.id, date: addDays(today, 1) } });

  // --- The parent's cabinet shows the make-up and gives a calendar link ----
  const cabCtx = await browser.newContext();
  const cab = await cabCtx.newPage();
  await cab.goto(centerUrl(a.sub, '/portal'));
  await cab.getByRole('textbox').first().pressSequentially('941114455');
  await cab.getByRole('button', { name: 'Davom etish' }).click();
  await cab.getByPlaceholder('••••••').fill(String(pin));
  await cab.getByRole('button', { name: 'Kabinetga kirish' }).click();
  await expect(cab.getByText('Gone Child').first()).toBeVisible();
  await cab.getByRole('button', { name: 'Jadval', exact: true }).first().click();
  const makeups = cab.getByRole('region', { name: 'Qoplash darslari' });
  await expect(makeups).toContainText('Kelgusi qoplash darslari');
  await expect(makeups).toContainText('Leaving Group');
  const feed = cab.getByRole('region', { name: 'Kalendar havolasi (ICS)' });
  await feed.getByRole('button', { name: 'Havola yaratish' }).click();
  const url = await feed.getByLabel('Kalendar havolangiz').inputValue();
  const eventsOf = async (name: string) => (await (await cab.request.get(url)).text()).split('BEGIN:VEVENT').filter((b) => b.includes(name));
  expect((await eventsOf('Leaving Group')).some((b) => !b.includes('STATUS:CANCELLED'))).toBe(true);

  // --- The owner deletes the group on its page ------------------------------
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, `/groups/${host.id}`));
  const said: string[] = [];
  page.on('dialog', (d) => {
    said.push(d.message());
    void d.accept();
  });
  await page.getByRole('button', { name: "Guruhni o'chirish" }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/groups'));
  // First the question, then what happened to the make-up.
  expect(said).toHaveLength(2);
  expect(said[1]).toContain('1 ta qoplash broni bekor qilindi');
  const after = (await api<Credit[]>('GET', '/makeups/credits', { token: a.token })).find((c) => c.id === credit.id)!;
  expect(after.status).toBe('ISSUED');
  expect(after.bookings[0]).toMatchObject({ status: 'CANCELLED', note: 'GROUP_REMOVED' });

  // --- The cabinet and the calendar: no live lesson of a group that is gone ---
  await cab.reload();
  await expect(cab.getByText('Gone Child').first()).toBeVisible();
  await cab.getByRole('button', { name: 'Jadval', exact: true }).first().click();
  const again = cab.getByRole('region', { name: 'Qoplash darslari' });
  await expect(again).toContainText('Yozilishni kutmoqda');
  await expect(again).not.toContainText('Leaving Group');
  await expect(again).not.toContainText('Kelgusi qoplash darslari');
  expect((await eventsOf('Leaving Group')).filter((b) => !b.includes('STATUS:CANCELLED'))).toEqual([]);
  // The child's own lessons are still there.
  expect((await eventsOf('Staying Group')).length).toBeGreaterThan(0);
  await cabCtx.close();
});
