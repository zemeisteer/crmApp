import { expect, test } from '@playwright/test';
import { api, centerDay, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, pickTime } from './support';

// Three forms of the last round, driven in the browser and checked against
// what the API then holds: the teacher attendance window (one row per
// lesson), the event form's answer when the room is taken, and the make-up
// form when the lesson begins while it is open.
cleanUpStagingCenters();

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test('teacher attendance: two lessons of one group on one day are marked apart; a lesson called off cannot be marked', async ({ page }) => {
  const a = await newCenter('tatt');
  const today = centerDay();
  const main = await api('POST', '/teachers', { token: a.token, body: { fullName: 'TA Asosiy', subject: 'Math' } });
  const sub = await api('POST', '/teachers', { token: a.token, body: { fullName: 'TA Orinbosar', subject: 'Math' } });
  const twice = await api('POST', '/groups', { token: a.token, body: { name: 'TA Ikki Dars', subject: 'Math', teacherId: main.id } });
  const off = await api('POST', '/groups', { token: a.token, body: { name: 'TA Bekor', subject: 'Math', teacherId: main.id } });
  const am = await api('POST', '/schedule', { token: a.token, body: { groupId: twice.id, date: today, startTime: '09:00', endTime: '10:00' } });
  const pm = await api('POST', '/schedule', { token: a.token, body: { groupId: twice.id, date: today, startTime: '18:00', endTime: '19:00' } });
  // A weekly lesson of today's weekday, called off for today.
  const weekday = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const offRow = await api('POST', '/schedule', { token: a.token, body: { groupId: off.id, dayOfWeek: weekday, startTime: '12:00', endTime: '13:00' } });
  await api('POST', '/lessons/cancellations', { token: a.token, body: { groupId: off.id, date: today, scheduleId: offRow.id, reason: 'Bayram' } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/teachers'));
  await page.getByRole('button', { name: "O'qituvchilar davomati" }).click();
  const dialog = page.getByRole('dialog', { name: /O'qituvchilar davomati/ });
  const morning = dialog.getByRole('group', { name: 'TA Ikki Dars 09:00–10:00' });
  const evening = dialog.getByRole('group', { name: 'TA Ikki Dars 18:00–19:00' });
  const calledOff = dialog.getByRole('group', { name: 'TA Bekor 12:00–13:00' });
  await expect(morning).toBeVisible();
  await expect(evening).toBeVisible();
  await expect(calledOff).toContainText('Dars bekor qilingan');
  await expect(calledOff.getByRole('button', { name: 'Qatnashdi' })).toBeDisabled();

  await morning.getByRole('button', { name: 'Qatnashdi' }).click();
  await evening.getByRole('button', { name: 'Kelmadi' }).click();
  await evening.getByRole('button', { name: "O'rinbosar yo'q (dars o'tmadi)" }).click();
  await page.getByRole('option', { name: 'TA Orinbosar' }).click();
  await dialog.getByRole('button', { name: 'Saqlash' }).click();
  await expect(dialog.getByText('Saqlandi')).toBeVisible();
  await expect(morning.getByRole('button', { name: 'Qatnashdi' })).toHaveAttribute('aria-pressed', 'true');
  await expect(evening.getByRole('button', { name: 'Kelmadi' })).toHaveAttribute('aria-pressed', 'true');

  const saved = await api<Array<{ scheduleId: string; status: string | null; substituteTeacherId: string | null; cancelled: boolean }>>('GET', `/teacher-attendance?date=${today}`, { token: a.token });
  expect(saved.find((l) => l.scheduleId === am.id)).toMatchObject({ status: 'PRESENT', substituteTeacherId: null });
  expect(saved.find((l) => l.scheduleId === pm.id)).toMatchObject({ status: 'ABSENT', substituteTeacherId: sub.id });
  expect(saved.find((l) => l.scheduleId === offRow.id)).toMatchObject({ status: null, cancelled: true });
});

test('event form: moved onto a lesson in its room, it says what is in the way and saves nothing', async ({ page }) => {
  const a = await newCenter('evcf');
  const day = addDays(centerDay(), 2);
  const room = await api('POST', '/schedule/rooms', { token: a.token, body: { name: 'EV Zal' } });
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'EV Kechki Guruh', subject: 'Math' } });
  await api('POST', '/schedule', { token: a.token, body: { groupId: group.id, roomId: room.id, date: day, startTime: '18:00', endTime: '19:00' } });
  const ev = await api('POST', '/center-events', { token: a.token, body: { title: 'EV Majlis', kind: 'MEETING', format: 'OFFLINE', date: day, startTime: '17:00', endTime: '18:00', roomId: room.id } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/schedule'));
  await page.locator('section[aria-labelledby="upcoming-events"]').getByRole('button', { name: /EV Majlis/ }).click();
  const form = page.getByRole('dialog', { name: 'Tadbirni tahrirlash' });
  await pickTime(form.getByRole('group', { name: 'Tugashi' }), '18:00', '18', '30');
  await form.getByRole('button', { name: 'Saqlash' }).click();
  const alert = form.getByRole('alert');
  await expect(alert).toContainText('Xona bu vaqtda band');
  await expect(alert).toContainText('EV Kechki Guruh');
  await expect(alert).toContainText('18:00 - 19:00');
  await expect(form).toBeVisible();
  const list = await api<Array<{ id: string; endTime: string }>>('GET', `/center-events?from=${day}&to=${day}`, { token: a.token });
  expect(list.find((e) => e.id === ev.id)!.endTime).toBe('18:00');
});

test('make-up form: a lesson that begins while the form is open is refused on Save, and nothing is booked', async ({ page }) => {
  const a = await newCenter('mkclk');
  const today = centerDay();
  const everyDay = 'Dushanba,Seshanba,Chorshanba,Payshanba,Juma,Shanba,Yakshanba';
  const origin = await api('POST', '/groups', { token: a.token, body: { name: 'MK Ertalab', subject: 'English', scheduleDays: everyDay, startTime: '07:00', endTime: '07:30', maxStudents: 10 } });
  await api('POST', '/groups', { token: a.token, body: { name: 'MK Kechki', subject: 'English', scheduleDays: everyDay, startTime: '23:00', endTime: '23:50', maxStudents: 10 } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'MK Bola', groupIds: [origin.id] } });
  const missed = addDays(today, -2);
  await api('POST', '/attendance', { token: a.token, body: { groupId: origin.id, date: missed, entries: [{ studentId: kid.id, status: 'ABSENT' }] } });
  const credit = await api('POST', '/makeups/credits', { token: a.token, body: { studentId: kid.id, groupId: origin.id, date: missed, reason: 'ABSENT' } });
  // The first lesson offered: today's 23:00 (tomorrow's in the day's last hour).
  const tashkentNow = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(11, 16);
  const lessonDay = tashkentNow < '23:00' ? today : addDays(today, 1);

  // The page runs on a clock the test can move.
  await page.clock.install({ time: new Date() });
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/makeups'));
  await page.getByRole('tab', { name: 'Kreditlar' }).click();
  const row = page.getByRole('list', { name: 'Kreditlar' }).getByRole('listitem').filter({ hasText: 'MK Bola' });
  await row.getByRole('button', { name: 'Darsga yozish: MK Bola' }).click();
  const book = page.getByRole('dialog', { name: 'Qoplash darsiga yozish' });
  await book.getByRole('button', { name: 'Guruh', exact: true }).click();
  await page.getByRole('option', { name: /MK Kechki/ }).click();
  await book.getByRole('button', { name: 'Dars kuni', exact: true }).click();
  await page.getByRole('option').first().click();
  await expect(book.getByRole('button', { name: 'Dars kuni', exact: true })).toContainText('23:00–23:50');

  // The form stays open; the lesson begins (half a minute past its start).
  await page.clock.setSystemTime(new Date(`${lessonDay}T23:00:30+05:00`));
  await book.getByRole('button', { name: 'Yozish', exact: true }).click();
  await expect(book.getByRole('alert')).toContainText("Bu dars boshlanib bo'lgan");
  await expect(book).toBeVisible();
  const after = await api<Array<{ id: string; status: string; bookings: unknown[] }>>('GET', '/makeups/credits', { token: a.token });
  expect(after.find((c) => c.id === credit.id)).toMatchObject({ status: 'ISSUED' });
});
