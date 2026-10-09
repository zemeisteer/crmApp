import { expect, test } from '@playwright/test';
import { api, centerDay, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, pickDate, pickTime } from './support';

// Make-up lessons: the owner sets credits to expire after 30 days in
// Settings; a student marked absent gets a credit on the "Missed lessons"
// tab, the credit is booked into another group's lesson from the Book
// dialog, the make-up shows in the roster and on the week's timetable and
// is marked attended - the credit is then used. On the group page a lesson is called off, listed
// and restored. A second journey books a credit as a separate session
// (teacher, room, date, time), sees it in the roster, cancels the booking
// (the credit is open again), forfeits it by marking the session missed,
// reinstates it, and voids another credit.
cleanUpStagingCenters();

const EVERY_DAY = 'Dushanba,Seshanba,Chorshanba,Payshanba,Juma,Shanba,Yakshanba';
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Credit = {
  id: string; status: string; note: string | null; expiresAt: string | null; closedAt?: string | null;
  bookings: Array<{ id: string; status: string; mode: string; targetGroupId: string | null; teacherId: string | null; roomId: string | null; date: string; startTime: string; endTime: string }>;
};

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

  // --- The timetable shows this week's make-up on its day ---------------
  await page.goto(centerUrl(a.sub, '/schedule'));
  const onTimetable = page.getByTestId('schedule-makeup').filter({ hasText: 'Makeup Student' });
  await expect(onTimetable).toHaveCount(1);
  await expect(onTimetable).toContainText('15:00–16:00');
  await expect(onTimetable).toContainText('Host Evening');
  await expect(onTimetable).toContainText(today);

  // --- After a fresh load the credit is used -----------------------------
  await page.goto(centerUrl(a.sub, '/makeups'));
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

test('a credit is booked as a separate session, cancelled, forfeited and reinstated; another credit is voided', async ({ page }) => {
  const a = await newCenter('mksession');
  const t1 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Group Teacher', subject: 'English' } });
  const t2 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Session Teacher', subject: 'English' } });
  const room = await api('POST', '/schedule/rooms', { token: a.token, body: { name: 'Room Seven', capacity: 4 } });
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Daily Morning', subject: 'English', teacherId: t1.id, scheduleDays: EVERY_DAY, startTime: '09:00', endTime: '10:00', maxStudents: 10 } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Session Student', groupIds: [group.id] } });
  const other = await api('POST', '/students', { token: a.token, body: { fullName: 'Void Student', groupIds: [group.id] } });
  const today = centerDay();
  const missed = addDays(today, -2);
  await api('POST', '/attendance', { token: a.token, body: { groupId: group.id, date: missed, entries: [{ studentId: kid.id, status: 'ABSENT' }, { studentId: other.id, status: 'ABSENT' }] } });
  const credit = await api<Credit>('POST', '/makeups/credits', { token: a.token, body: { studentId: kid.id, groupId: group.id, date: missed, reason: 'ABSENT' } });
  const voidable = await api<Credit>('POST', '/makeups/credits', { token: a.token, body: { studentId: other.id, groupId: group.id, date: missed, reason: 'ABSENT' } });
  const creditNow = async (id: string) => (await api<Credit[]>('GET', '/makeups/credits', { token: a.token })).find((c) => c.id === id)!;
  const tomorrow = addDays(today, 1);
  const [y, m, d] = tomorrow.split('-').map(Number);

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/makeups'));
  await page.getByRole('tab', { name: 'Kreditlar' }).click();
  const credits = page.getByRole('list', { name: 'Kreditlar' });
  const row = credits.getByRole('listitem').filter({ hasText: 'Session Student' });
  const voidRow = credits.getByRole('listitem').filter({ hasText: 'Void Student' });
  await expect(row).toContainText('Foydalanilmagan');

  // --- Book a separate session: date, time, teacher, room -------------------
  await row.getByRole('button', { name: 'Darsga yozish: Session Student' }).click();
  const book = page.getByRole('dialog', { name: 'Qoplash darsiga yozish' });
  await book.getByRole('button', { name: "Alohida mashg'ulot", exact: true }).click();
  await expect(book.getByRole('button', { name: "Alohida mashg'ulot", exact: true })).toHaveAttribute('aria-pressed', 'true');
  await pickDate(book.getByRole('group', { name: 'Sana', exact: true }), y, m, d);
  await pickTime(book.getByRole('group', { name: 'Boshlanishi', exact: true }), 'Vaqtni tanlang', '11', '00');
  await pickTime(book.getByRole('group', { name: 'Tugashi', exact: true }), 'Vaqtni tanlang', '12', '00');
  await book.getByRole('button', { name: "O'qituvchi", exact: true }).click();
  await page.getByRole('option', { name: 'Session Teacher' }).click();
  await book.getByRole('button', { name: 'Xona (ixtiyoriy)', exact: true }).click();
  await page.getByRole('option', { name: 'Room Seven' }).click();
  await book.getByRole('button', { name: 'Yozish', exact: true }).click();
  await expect(book).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Session Student' })).toBeVisible();
  await expect(row).toContainText('Yozilgan');
  await expect(row).toContainText("Alohida mashg'ulot");
  await expect(row).toContainText('11:00–12:00');
  await expect(row).toContainText('Session Teacher');
  await expect(row).toContainText('Room Seven');
  let c = await creditNow(credit.id);
  expect(c.status).toBe('BOOKED');
  expect(c.bookings).toHaveLength(1);
  expect(c.bookings[0]).toMatchObject({ status: 'BOOKED', mode: 'SESSION', targetGroupId: null, teacherId: t2.id, roomId: room.id, date: tomorrow, startTime: '11:00', endTime: '12:00' });

  // --- The roster lists it --------------------------------------------------
  await page.getByRole('tab', { name: 'Qoplash jadvali' }).click();
  const rosterItem = page.getByRole('listitem', { name: 'Session Student · 11:00' });
  await expect(rosterItem).toContainText("Alohida mashg'ulot");
  await expect(rosterItem).toContainText('12:00');
  await expect(rosterItem).toContainText('Rejada');
  const roster = await api<Array<{ id: string; mode: string; date: string; status: string; teacherId: string; roomId: string }>>('GET', `/makeups/roster?from=${today}&to=${addDays(today, 7)}`, { token: a.token });
  expect(roster).toEqual([expect.objectContaining({ id: c.bookings[0].id, mode: 'SESSION', date: tomorrow, status: 'BOOKED', teacherId: t2.id, roomId: room.id })]);

  // --- Cancel the booking: the credit is open again ---------------------------
  await page.getByRole('tab', { name: 'Kreditlar' }).click();
  page.once('dialog', (dlg) => dlg.accept());
  await row.getByRole('button', { name: 'Yozuvni bekor qilish' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Yozuv bekor qilindi, kredit qaytdi.' })).toBeVisible();
  await expect(row).toContainText('Foydalanilmagan');
  await expect(row.getByRole('button', { name: 'Darsga yozish: Session Student' })).toBeVisible();
  c = await creditNow(credit.id);
  expect(c.status).toBe('ISSUED');
  expect(c.bookings.map((b) => b.status)).toEqual(['CANCELLED']);
  await page.getByRole('tab', { name: 'Qoplash jadvali' }).click();
  await expect(page.getByRole('listitem', { name: /^Session Student/ })).toHaveCount(0);
  expect(await api('GET', `/makeups/roster?from=${today}&to=${addDays(today, 7)}`, { token: a.token })).toEqual([]);

  // --- Booked again, then marked missed in the roster: the credit is forfeited ---
  await api('POST', `/makeups/credits/${credit.id}/book`, { token: a.token, body: { mode: 'SESSION', date: tomorrow, startTime: '11:00', endTime: '12:00', teacherId: t2.id, roomId: room.id } });
  await page.reload();
  await page.getByRole('tab', { name: 'Qoplash jadvali' }).click();
  await expect(rosterItem).toContainText('Rejada');
  page.once('dialog', (dlg) => dlg.accept());
  await rosterItem.getByRole('button', { name: 'Kelmadi: Session Student' }).click();
  await expect(page.getByRole('status').filter({ hasText: "Session Student: kelmadi. Kredit yo'qotildi." })).toBeVisible();
  await expect(rosterItem).toContainText('Kelmadi');
  await expect(rosterItem.getByRole('button')).toHaveCount(0);
  c = await creditNow(credit.id);
  expect(c.status).toBe('FORFEITED');
  expect(c.bookings.map((b) => b.status)).toEqual(['MISSED', 'CANCELLED']);

  // --- Reinstated: usable again ---------------------------------------------
  await page.getByRole('tab', { name: 'Kreditlar' }).click();
  await expect(row).toContainText("Yo'qotilgan");
  await expect(row.getByRole('button', { name: 'Darsga yozish: Session Student' })).toHaveCount(0);
  page.once('dialog', (dlg) => dlg.accept());
  await row.getByRole('button', { name: 'Qayta tiklash' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Kredit qayta tiklandi.' })).toBeVisible();
  await expect(row).toContainText('Foydalanilmagan');
  await expect(row.getByRole('button', { name: 'Darsga yozish: Session Student' })).toBeVisible();
  c = await creditNow(credit.id);
  expect(c).toMatchObject({ status: 'ISSUED', closedAt: null });

  // --- Another credit is voided; its missed lesson can earn a new one -------------
  await expect(voidRow).toContainText('Foydalanilmagan');
  page.once('dialog', (dlg) => dlg.accept());
  await voidRow.getByRole('button', { name: 'Kreditni bekor qilish' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Kredit bekor qilindi.' })).toBeVisible();
  await expect(voidRow).toContainText('Bekor qilingan');
  await expect(voidRow.getByRole('button')).toHaveCount(0);
  expect((await creditNow(voidable.id)).status).toBe('CANCELLED');
  await page.getByRole('tab', { name: 'Qoldirilgan darslar' }).click();
  const missedRows = page.getByRole('list', { name: 'Qoldirilgan darslar' }).getByRole('listitem');
  await expect(missedRows.filter({ hasText: 'Void Student' }).getByRole('button', { name: /^Kredit berish: Void Student/ })).toBeVisible();
  await expect(missedRows.filter({ hasText: 'Session Student' })).toContainText('Foydalanilmagan');
});
