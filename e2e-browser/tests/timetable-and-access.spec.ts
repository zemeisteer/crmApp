import { expect, test } from '@playwright/test';
import { addStaff, api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, PASSWORD, pickTime, run } from './support';

// The timetable page moves a lesson by its button, by dragging and back
// again with Undo, and says what is in the way when the day is taken; the
// group form changes a lesson's time under the same rule; a chat tab left
// open stops when the right to chat is taken away.
cleanUpStagingCenters();

type Row = { id: string; groupId: string; dayOfWeek: number | null; startTime: string; endTime: string };
const rowsOf = async (token: string, groupId: string) => (await api<Row[]>('GET', `/schedule?groupId=${groupId}`, { token })).sort((a, b) => (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0));

test('timetable: a lesson is moved by its button, undone, refused on a taken day with the reason, and moved by dragging', async ({ page }) => {
  const a = await newCenter('ttmove');
  const t1 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Move Teacher', subject: 'English' } });
  const moving = await api('POST', '/groups', { token: a.token, body: { name: 'Moving Group', subject: 'English', teacherId: t1.id, scheduleDays: 'Dushanba', startTime: '10:00', endTime: '11:00', maxStudents: 10 } });
  await api('POST', '/groups', { token: a.token, body: { name: 'Blocking Group', subject: 'English', teacherId: t1.id, scheduleDays: 'Chorshanba', startTime: '10:30', endTime: '11:30', maxStudents: 10 } });
  const [row] = await rowsOf(a.token, moving.id);
  const dayNow = async () => (await rowsOf(a.token, moving.id))[0].dayOfWeek;

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/schedule'));
  const card = page.getByTestId('schedule-lesson').filter({ hasText: 'Moving Group' });
  const inDay = (day: number) => page.getByTestId(`schedule-day-${day}`).getByTestId('schedule-lesson').filter({ hasText: 'Moving Group' });
  await expect(inDay(1)).toHaveCount(1);

  // --- The button, with the keyboard: the dialog says which days are free ---
  const moveButton = card.getByTestId('schedule-move');
  await moveButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: "Darsni ko'chirish" });
  await expect(dialog).toContainText('Moving Group');
  await expect(dialog.getByRole('button', { name: /Dushanba/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /Seshanba/ })).toContainText("Bo'sh");
  await expect(dialog.getByRole('button', { name: /Chorshanba/ })).toContainText('Band');
  await dialog.getByRole('button', { name: /Seshanba/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(inDay(2)).toHaveCount(1);
  await expect(inDay(1)).toHaveCount(0);
  expect(await dayNow()).toBe(2);
  expect((await rowsOf(a.token, moving.id))[0].id).toBe(row.id); // the same lesson, moved

  // --- Undo puts it back ---------------------------------------------------
  const notice = page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Qaytarish' }) });
  await notice.getByRole('button', { name: 'Qaytarish' }).click();
  await expect(inDay(1)).toHaveCount(1);
  expect(await dayNow()).toBe(1);

  // --- A taken day: not moved, and the page says by what --------------------
  await card.getByTestId('schedule-move').click();
  await dialog.getByRole('button', { name: /Chorshanba/ }).click();
  const blocked = page.getByRole('heading', { name: "Darsni ko'chirib bo'lmadi" });
  await expect(blocked).toBeVisible();
  await expect(page.getByText(/Move Teacher.*Blocking Group/).first()).toBeVisible();
  expect(await dayNow()).toBe(1);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(inDay(1)).toHaveCount(1);

  // --- Dragging the card onto another day -----------------------------------
  await inDay(1).dragTo(page.getByTestId('schedule-day-4'));
  await expect(inDay(4)).toHaveCount(1);
  expect(await dayNow()).toBe(4);

  // --- On a phone the button is there and works -----------------------------
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  const phoneCard = page.getByTestId('schedule-lesson').filter({ hasText: 'Moving Group' });
  await phoneCard.getByTestId('schedule-move').click();
  await page.getByRole('dialog', { name: "Darsni ko'chirish" }).getByRole('button', { name: /Juma/ }).click();
  await expect(inDay(5)).toHaveCount(1);
  expect(await dayNow()).toBe(5);
});

test('group form: a new time is refused when the teacher is busy, and moves the lessons in place when it fits', async ({ page }) => {
  const a = await newCenter('grpform');
  const t1 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Form Teacher', subject: 'English' } });
  const g = await api('POST', '/groups', { token: a.token, body: { name: 'Form Group', subject: 'English', teacherId: t1.id, scheduleDays: 'Dushanba,Chorshanba', startTime: '09:00', endTime: '10:00', maxStudents: 10, startDate: '2026-01-05', monthlyPrice: 500000 } });
  await api('POST', '/groups', { token: a.token, body: { name: 'Busy Group', subject: 'English', teacherId: t1.id, scheduleDays: 'Dushanba', startTime: '11:00', endTime: '12:00', maxStudents: 10 } });
  const before = await rowsOf(a.token, g.id);
  expect(before.map((r) => r.startTime)).toEqual(['09:00', '09:00']);

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/groups'));
  await page.getByRole('row').filter({ hasText: 'Form Group' }).getByRole('button', { name: 'Tahrirlash' }).click();
  const form = page.getByRole('dialog', { name: 'Guruhni tahrirlash' });
  const start = form.getByRole('group', { name: 'Boshlanish vaqti' });
  const end = form.getByRole('group', { name: 'Tugash vaqti' });

  // 11:30-12:30 on Monday runs into the teacher's other group.
  await pickTime(start, '09:00', '11', '30');
  await pickTime(end, '10:00', '12', '30');
  // The form warns before saving, from the same rule the save applies...
  await expect(form.getByText('ham band: Busy Group')).toBeVisible();
  // ...and the save itself is refused.
  await form.getByRole('button', { name: 'Saqlash', exact: true }).click();
  await expect(form.getByRole('alert').filter({ hasText: /Busy Group/ })).toBeVisible();
  // Refused as a whole: the lessons are where they were.
  expect((await rowsOf(a.token, g.id)).map((r) => [r.id, r.startTime])).toEqual(before.map((r) => [r.id, '09:00']));

  // 14:00-16:00 fits: both lessons move, and stay the same lessons.
  await pickTime(start, '11:30', '14', '00');
  await pickTime(end, '12:30', '16', '00');
  await form.getByRole('button', { name: 'Saqlash', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Form Group' })).toContainText('14:00');
  expect((await rowsOf(a.token, g.id)).map((r) => [r.id, r.startTime, r.endTime])).toEqual(before.map((r) => [r.id, '14:00', '16:00']));
});

test('chat: a tab left open stops when the right to chat is taken away, and the page is gone after a reload', async ({ page }) => {
  const a = await newCenter('chatoff');
  const email = `zzbr-chatoff-${run}@example.test`;
  const staffId = await addStaff(a.token, email, 'ACCOUNTANT');
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Chat Off Group', subject: 'English', maxStudents: 10 } });
  const local = `95${String(Date.now()).slice(-7)}`;
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Chat Off Student', phone: `+998${local}`, groupIds: [group.id] } });
  const { pin } = await api('POST', `/students/${kid.id}/portal-pin`, { token: a.token });
  const cabinet = (await api('POST', '/portal/auth/phone/verify', { body: { phone: `+998${local}`, pin } })).accessToken as string;
  const conv = await api('POST', '/portal/chat/conversations', { token: cabinet, body: { kind: 'STUDENT_CENTER' } });
  const write = (body: string) => api('POST', `/portal/chat/conversations/${conv.id}/messages`, { token: cabinet, body: { body, clientMessageId: `c${Date.now()}${Math.floor(Math.random() * 1e6)}`.padEnd(14, '0') } });

  await loginOnMainSite(page, email);
  await expectCenterDashboard(page, a.sub);
  await page.locator('.sidebar').getByRole('link', { name: 'Xabarlar' }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/messages'));
  await expect(page.locator('[data-chat-live="open"]')).toHaveCount(1);

  // The owner takes chat away from this account while the tab stays open.
  await api('PATCH', `/staff/${staffId}`, { token: a.token, body: { access: ['schedule.view'] } });
  // The next message in the center is not announced to it: the stream is closed instead.
  await write('Ruxsat olingandan keyingi xabar');
  await expect(page.getByRole('status').filter({ hasText: 'Yangi xabarlar endi kelmaydi' })).toBeVisible();
  await expect(page.locator('[data-chat-live="open"]')).toHaveCount(0);
  await expect(page.getByText('Ruxsat olingandan keyingi xabar')).toHaveCount(0);

  // After a reload the page is not offered any more.
  await page.reload();
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Xabarlar' })).toHaveCount(0);
  // And the server refuses the account's own requests (the password is the run's synthetic one).
  const token = (await api('POST', '/auth/login', { body: { email, password: PASSWORD } }).catch(() => null))?.accessToken as string | undefined;
  if (token) {
    const res = await fetch(`http://127.0.0.1:${process.env.BROWSER_API_PORT || 4300}/api/chat/conversations`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
  }
});
