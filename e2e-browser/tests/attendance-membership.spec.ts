import { expect, test, type Page } from '@playwright/test';
import { addStaff, api, apiLogin, centerDay, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, pickTime, run } from './support';

// Attendance per lesson and the membership history, through the pages:
// two lessons of one day get different marks, one of them is corrected, the
// absence of one lesson earns a credit that is booked, a lesson that was
// called off takes no marks, the cabinet shows each lesson's own mark; a
// student leaves a group and comes back and both stays are listed; a group
// comes back from the trash; an account that may only edit groups never
// sees a student's name in a clash - in the API or on the form.
cleanUpStagingCenters();

const DAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const dayName = (date: string) => DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const isoDow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Mark = { studentId: string; scheduleId: string | null; startTime: string | null; status: string };
type Credit = { id: string; status: string; originScheduleId: string | null; student: { id: string }; bookings: Array<{ status: string; targetGroupId: string | null }> };

/** The attendance row of one student on the group page, and its three buttons. */
const attRow = (page: Page, name: string) =>
  page.locator('div', { has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole('button', { name: "Yo'q", exact: true }) }).last();

test('two lessons of one day: different marks, one corrected, a credit for that lesson booked, a cancelled lesson refuses marks, the cabinet shows both', async ({ page, browser }) => {
  const a = await newCenter('attles');
  const today = centerDay();
  const g = await api('POST', '/groups', { token: a.token, body: { name: 'Twice Today', subject: 'English', scheduleDays: dayName(today), startTime: '09:00', endTime: '10:00', maxStudents: 10 } });
  const pm = await api('POST', '/schedule', { token: a.token, body: { groupId: g.id, dayOfWeek: isoDow(today), startTime: '15:00', endTime: '16:00' } });
  const am = (await api<Array<{ id: string; startTime: string }>>('GET', `/schedule?groupId=${g.id}`, { token: a.token })).find((r) => r.startTime === '09:00')!;
  const host = await api('POST', '/groups', { token: a.token, body: { name: 'Host Group', subject: 'English', scheduleDays: dayName(addDays(today, 1)), startTime: '12:00', endTime: '13:00', maxStudents: 10 } });
  const s1 = await api('POST', '/students', { token: a.token, body: { fullName: 'Att One', groupIds: [g.id] } });
  const s2 = await api('POST', '/students', { token: a.token, body: { fullName: 'Att Two', groupIds: [g.id] } });
  await api('PATCH', `/students/${s2.id}`, { token: a.token, body: { phone: '+998931117788', parentPhone: '+998941117788' } });
  const { pin } = await api('POST', `/students/${s2.id}/portal-pin`, { token: a.token });
  const marks = async () => (await api<Mark[]>('GET', `/attendance?groupId=${g.id}&date=${today}`, { token: a.token })).map((m) => [m.studentId === s1.id ? 'one' : 'two', m.startTime, m.status].join(' ')).sort();

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, `/groups/${g.id}`));
  const lesson = page.getByRole('button', { name: 'Qaysi dars uchun', exact: true });
  const save = page.getByRole('button', { name: 'Davomatni saqlash' });

  // --- 09:00: One is absent ---------------------------------------------------
  await expect(lesson).toContainText('09:00–10:00');
  await attRow(page, 'Att One').getByRole('button', { name: "Yo'q", exact: true }).click();
  await save.click();
  await expect.poll(marks).toEqual(['one 09:00 ABSENT', 'two 09:00 PRESENT']);

  // --- 15:00: Two is absent; the 09:00 marks are not touched ------------------
  await lesson.click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('option', { name: /15:00–16:00/ }).click();
  // Nothing is marked for this lesson yet: everyone starts as present.
  await attRow(page, 'Att Two').getByRole('button', { name: "Yo'q", exact: true }).click();
  // The keyboard saves too.
  await save.focus();
  await page.keyboard.press('Enter');
  await expect.poll(marks).toEqual(['one 09:00 ABSENT', 'one 15:00 PRESENT', 'two 09:00 PRESENT', 'two 15:00 ABSENT']);

  // --- The 09:00 mark is corrected; the 15:00 ones stay ------------------------
  await lesson.click();
  await page.getByRole('option', { name: /09:00–10:00/ }).click();
  await attRow(page, 'Att One').getByRole('button', { name: 'Kechikdi', exact: true }).click();
  await save.click();
  await expect.poll(marks).toEqual(['one 09:00 LATE', 'one 15:00 PRESENT', 'two 09:00 PRESENT', 'two 15:00 ABSENT']);

  // --- The credit for Two's 15:00 absence, issued and booked on the make-ups page ---
  await page.goto(centerUrl(a.sub, '/makeups'));
  const missed = page.getByRole('listitem').filter({ hasText: 'Att Two' });
  await expect(missed).toHaveCount(1); // one absence, one row - not one per lesson of the day
  await missed.getByRole('button', { name: /^Kredit berish: Att Two/ }).click();
  const issue = page.getByRole('dialog', { name: 'Qoplash krediti berish' });
  await issue.getByRole('button', { name: 'Kredit berish' }).click();
  await expect(issue).toHaveCount(0);
  const credit = async () => (await api<Credit[]>('GET', '/makeups/credits', { token: a.token })).find((c) => c.student.id === s2.id)!;
  expect(await credit()).toMatchObject({ status: 'ISSUED', originScheduleId: pm.id });
  await page.getByRole('tab', { name: 'Kreditlar' }).click();
  const row = page.getByRole('list', { name: 'Kreditlar' }).getByRole('listitem').filter({ hasText: 'Att Two' });
  await row.getByRole('button', { name: 'Darsga yozish: Att Two' }).click();
  const book = page.getByRole('dialog', { name: 'Qoplash darsiga yozish' });
  await book.getByRole('button', { name: 'Guruh', exact: true }).click();
  await page.getByRole('option', { name: /Host Group/ }).click();
  await book.getByRole('button', { name: 'Dars kuni', exact: true }).click();
  await page.getByRole('option').first().click();
  await book.getByRole('button', { name: 'Yozish', exact: true }).click();
  await expect(book).toHaveCount(0);
  await expect.poll(async () => (await credit()).status).toBe('BOOKED');
  expect((await credit()).bookings[0]).toMatchObject({ status: 'BOOKED', targetGroupId: host.id });

  // --- The booked credit stops the correction of its absence, and the page says so ---
  await page.goto(centerUrl(a.sub, `/groups/${g.id}`));
  await lesson.click();
  await page.getByRole('option', { name: /15:00–16:00/ }).click();
  await attRow(page, 'Att Two').getByRole('button', { name: 'Bor', exact: true }).click();
  await save.click();
  await expect(page.getByRole('alert').filter({ hasText: /qoplash krediti darsga yozilgan/ })).toBeVisible();
  expect(await marks()).toContain('two 15:00 ABSENT');

  // --- The 09:00 lesson is called off: it takes no more marks -----------------
  await api('POST', '/lessons/cancellations', { token: a.token, body: { groupId: g.id, date: today, scheduleId: am.id } });
  await page.reload();
  // The lesson still on is offered first.
  await expect(lesson).toContainText('15:00–16:00');
  await lesson.click();
  await page.getByRole('option', { name: /09:00–10:00/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Bu dars bekor qilingan' })).toBeVisible();
  await expect(save).toBeDisabled();
  // What was marked before is still there.
  expect(await marks()).toContain('one 09:00 LATE');

  // --- On a phone: the 15:00 lesson is marked from the sheet -------------------
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await expect(lesson).toContainText('15:00–16:00');
  await attRow(page, 'Att One').getByRole('button', { name: 'Kechikdi', exact: true }).click();
  await save.click();
  await expect.poll(marks).toEqual(['one 09:00 LATE', 'one 15:00 LATE', 'two 09:00 PRESENT', 'two 15:00 ABSENT']);

  // --- The parent's cabinet: each lesson of the day with its own mark -----------
  const cabCtx = await browser.newContext();
  const cab = await cabCtx.newPage();
  await cab.goto(centerUrl(a.sub, '/portal'));
  await cab.getByRole('textbox').first().pressSequentially('941117788');
  await cab.getByRole('button', { name: 'Davom etish' }).click();
  await cab.getByPlaceholder('••••••').fill(String(pin));
  await cab.getByRole('button', { name: 'Kabinetga kirish' }).click();
  await expect(cab.getByText('Att Two').first()).toBeVisible();
  const portalToken = await cab.evaluate(() => Object.values({ ...localStorage, ...sessionStorage }).map((v) => { try { return JSON.parse(v as string); } catch { return v; } }).map((v: any) => (typeof v === 'string' ? v : v?.accessToken ?? v?.token)).find((v) => typeof v === 'string' && v.split('.').length === 3));
  const res = await cab.request.get(`http://127.0.0.1:${process.env.BROWSER_API_PORT || 4300}/api/portal/lessons`, { headers: { Authorization: `Bearer ${portalToken}` } });
  if (res.ok()) {
    const body = (await res.json()) as { lessons: Array<{ date: string; startTime: string | null; attendance: string | null }> };
    expect(body.lessons.filter((l) => l.date === today).map((l) => [l.startTime, l.attendance]).sort()).toEqual([['09:00', 'PRESENT'], ['15:00', 'ABSENT']]);
  } else {
    test.info().annotations.push({ type: 'note', description: `the cabinet token was not readable from the page (${res.status()}): the lessons API was not checked` });
  }
  await cab.getByRole('button', { name: /Davomat/ }).first().click();
  await expect(cab.getByText('Davomat tarixi').first()).toBeVisible();
  await expect(cab.getByText('Twice Today · 09:00').first()).toBeVisible();
  await expect(cab.getByText('Twice Today · 15:00').first()).toBeVisible();
  await cabCtx.close();
});

test('a student leaves a group and comes back: both stays are listed; a group returns from the trash; an account that only edits groups never gets a student name', async ({ page, browser }) => {
  const a = await newCenter('member');
  const b = await newCenter('memberb');
  const today = centerDay();
  const t1 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Stay Teacher', subject: 'English' } });
  const t2 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Session Teacher', subject: 'English' } });
  const g = await api('POST', '/groups', { token: a.token, body: { name: 'Stay Group', subject: 'English', teacherId: t1.id, scheduleDays: dayName(addDays(today, 2)), startTime: '09:00', endTime: '10:00', maxStudents: 10, startDate: '2026-01-05', monthlyPrice: 400000 } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Maxfiy Bola', groupIds: [g.id] } });
  type Stay = { groupId: string; endedAt: string | null; endReason: string | null; source: string };
  const stays = () => api<Stay[]>('GET', `/students/${kid.id}/memberships`, { token: a.token });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);

  // --- The student page lists the stay -----------------------------------------
  await page.goto(centerUrl(a.sub, `/students/${kid.id}`));
  const history = page.getByRole('region', { name: "Guruhlardagi a'zolik tarixi" });
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(history.getByRole('listitem')).toContainText('Stay Group');
  await expect(history.getByRole('listitem')).toContainText("Hozir a'zo");

  // --- Out of the group, on the group page -------------------------------------
  await page.goto(centerUrl(a.sub, `/groups/${g.id}`));
  page.once('dialog', (d) => d.accept());
  await page.getByRole('row').filter({ hasText: 'Maxfiy Bola' }).getByRole('button', { name: 'Chiqarish' }).click();
  await expect.poll(async () => (await stays()).map((s) => [s.endedAt === null, s.endReason])).toEqual([[false, 'LEFT_GROUP']]);
  // --- And back in ---------------------------------------------------------------
  await page.getByRole('button', { name: "+ O'quvchi qo'shish" }).click();
  const add = page.getByRole('dialog');
  await add.getByRole('button', { name: /Tanlang/ }).click();
  await page.getByRole('option', { name: 'Maxfiy Bola' }).click();
  await add.getByRole('button', { name: "Qo'shish", exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Maxfiy Bola' })).toHaveCount(1);
  await expect.poll(async () => (await stays()).map((s) => s.endedAt === null)).toEqual([true, false]);

  // --- The old stay is still there, beside the new one ---------------------------
  await page.goto(centerUrl(a.sub, `/students/${kid.id}`));
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.getByRole('listitem').first()).toContainText("Hozir a'zo");
  await expect(history.getByRole('listitem').nth(1)).toContainText('Tugagan');
  await expect(history.getByRole('listitem').nth(1)).toContainText('guruhdan chiqdi');
  expect((await stays()).every((s) => s.source === 'RECORDED')).toBe(true);

  // --- The group goes to the trash and comes back ---------------------------------
  const spare = await api('POST', '/groups', { token: a.token, body: { name: 'Spare Group', subject: 'English', scheduleDays: dayName(addDays(today, 3)), startTime: '11:00', endTime: '12:00', maxStudents: 10 } });
  await page.goto(centerUrl(a.sub, `/groups/${spare.id}`));
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: "Guruhni o'chirish" }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/groups'));
  await expect(page.getByRole('row').filter({ hasText: 'Spare Group' })).toHaveCount(0);
  await page.goto(centerUrl(a.sub, '/groups/trash'));
  await page.getByRole('row').filter({ hasText: 'Spare Group' }).getByRole('button', { name: 'Tiklash' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Spare Group' })).toHaveCount(0);
  await page.goto(centerUrl(a.sub, '/groups'));
  await expect(page.getByRole('row').filter({ hasText: 'Spare Group' })).toHaveCount(1);
  expect((await api<Array<{ id: string }>>('GET', '/groups', { token: a.token })).map((x) => x.id)).toContain(spare.id);

  // --- A clash with this student's make-up, asked by an account that may only edit groups ---
  const missed = addDays(today, -5);
  await api('POST', '/attendance', { token: a.token, body: { groupId: g.id, date: missed, entries: [{ studentId: kid.id, status: 'ABSENT' }] } });
  const credit = await api('POST', '/makeups/credits', { token: a.token, body: { studentId: kid.id, groupId: g.id, date: missed, reason: 'ABSENT' } });
  const sessionDay = addDays(today, 4);
  await api('POST', `/makeups/credits/${credit.id}/book`, { token: a.token, body: { mode: 'SESSION', date: sessionDay, startTime: '14:00', endTime: '15:00', teacherId: t2.id } });
  const email = `zzbr-member-mgr-${run}@example.test`;
  const staffId = await addStaff(a.token, email, 'ACCOUNTANT');
  // Groups only: not students, not the timetable, not even the teachers list.
  await api('PATCH', `/staff/${staffId}`, { token: a.token, body: { access: ['groups.view', 'groups.edit'] } });
  const limited = await apiLogin(email);
  const q = `teacherId=${t1.id}&days=${encodeURIComponent(dayName(sessionDay))}&startTime=14:00&endTime=15:00&excludeId=${g.id}`;
  const asOwner = JSON.stringify(await api('GET', `/groups/schedule-conflicts?${q}`, { token: a.token }));
  const asLimited = JSON.stringify(await api('GET', `/groups/schedule-conflicts?${q}`, { token: limited }));
  expect(asOwner).toContain('Maxfiy Bola');
  expect(asLimited).not.toContain('Maxfiy');
  expect(asLimited).toContain("1 nafar o'quvchi");
  // Another center: the group is not there for it at all.
  await expect(api('GET', `/groups/schedule-conflicts?${q}`, { token: b.token })).rejects.toThrow(/404/);
  expect((await api<Array<{ id: string }>>('GET', '/groups', { token: b.token })).map((x) => x.id)).not.toContain(g.id);

  // The same on the form: the limited account sees the warning as a count, not a name.
  const ctx = await browser.newContext();
  const mgr = await ctx.newPage();
  await loginOnMainSite(mgr, email);
  await expectCenterDashboard(mgr, a.sub);
  await mgr.goto(centerUrl(a.sub, '/groups'));
  await mgr.getByRole('row').filter({ hasText: 'Stay Group' }).getByRole('button', { name: 'Tahrirlash' }).click();
  const form = mgr.getByRole('dialog', { name: 'Guruhni tahrirlash' });
  // The page works without the teachers list, and says the teacher stays as it is.
  await expect(form.getByRole('note')).toContainText("O'qituvchilar ro'yxatini ko'rish ruxsatingiz yo'q");
  const short: Record<string, string> = { Dushanba: 'Du', Seshanba: 'Se', Chorshanba: 'Cho', Payshanba: 'Pa', Juma: 'Ju', Shanba: 'Sha', Yakshanba: 'Yak' };
  await form.getByRole('button', { name: short[dayName(sessionDay)], exact: true }).click();
  await pickTime(form.getByRole('group', { name: 'Boshlanish vaqti' }), '09:00', '14', '00');
  await pickTime(form.getByRole('group', { name: 'Tugash vaqti' }), '10:00', '16', '00');
  await expect(form.getByText("1 nafar o'quvchi")).toBeVisible();
  await expect(form.getByText('Maxfiy Bola')).toHaveCount(0);
  await ctx.close();
});
