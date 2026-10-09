import { expect, test } from '@playwright/test';
import { PASSWORD, api, authSlot, centerDay, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, run } from './support';

// Calendar sync: a staff member makes a subscription link (ICS) on the
// Calendar page, copies it, a calendar app can read it; a new link turns the
// old one off, and turning it off stops the new one. Google Calendar is not
// set up on the test server, so the page says so instead of offering it.
// A cabinet opened from a parent's own account points to that parent's
// calendar (all their children); a cabinet opened with a phone and PIN
// does not.
cleanUpStagingCenters();

test('a staff member makes, copies, replaces and turns off a calendar link; Google is not configured', async ({ page, context }) => {
  const a = await newCenter('calendar');
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.locator('.sidebar').getByRole('link', { name: 'Kalendar', exact: true }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/calendar'));
  await expect(page.getByRole('heading', { name: 'Kalendar bilan ulash' })).toBeVisible();

  const feed = page.getByRole('region', { name: 'Kalendar havolasi (ICS)' });
  await expect(feed).toContainText('Markazning barcha darslari');
  await expect(feed).toContainText("Hali havola yo'q.");
  await feed.getByRole('button', { name: 'Havola yaratish' }).click();
  const input = feed.getByLabel('Kalendar havolangiz');
  await expect(input).toHaveValue(/\/api\/calendar\/feed\/[A-Za-z0-9_-]+\.ics$/);
  await expect(input).toHaveAttribute('readonly', '');
  const first = await input.inputValue();

  // Copy puts the link on the clipboard.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: centerUrl(a.sub) });
  await feed.getByRole('button', { name: 'Nusxalash' }).click();
  await expect(feed.getByText('Nusxalandi.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);

  // Quick links for calendar apps.
  const webcal = first.replace(/^https?:\/\//, 'webcal://');
  await expect(feed.getByRole('link', { name: /Google Calendar'ga qo'shish/ })).toHaveAttribute('href', `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`);
  await expect(feed.getByRole('link', { name: 'Apple Calendar / Outlook' })).toHaveAttribute('href', webcal);

  // A calendar app reads it without signing in.
  const ics = await page.request.get(first);
  expect(ics.status()).toBe(200);
  expect(ics.headers()['content-type']).toContain('text/calendar');
  expect(await ics.text()).toContain('BEGIN:VCALENDAR');

  // A new link: the old one stops working at once.
  page.once('dialog', (d) => d.accept());
  await feed.getByRole('button', { name: 'Yangi havola yaratish' }).click();
  await expect(input).not.toHaveValue(first);
  await expect(input).toHaveValue(/\.ics$/);
  const second = await input.inputValue();
  expect((await page.request.get(first)).status()).toBe(404);
  expect((await page.request.get(second)).status()).toBe(200);

  // After a reload the link itself is not shown again, only its start.
  await page.reload();
  const hint = second.split('/feed/')[1].slice(0, 4);
  await expect(feed).toContainText('Havola yoqilgan');
  await expect(feed).toContainText(`${hint}… bilan boshlanadi`);
  await expect(feed.getByLabel('Kalendar havolangiz')).toHaveCount(0);

  // Turned off: the link answers 404.
  page.once('dialog', (d) => d.accept());
  await feed.getByRole('button', { name: "Havolani o'chirish" }).click();
  await expect(feed).toContainText("Havola o'chirildi.");
  await expect(feed).toContainText("Hali havola yo'q.");
  expect((await page.request.get(second)).status()).toBe(404);

  // Google Calendar: the test server has no Google credentials.
  const google = page.getByRole('region', { name: 'Google Calendar' });
  await expect(google).toContainText('Google Calendar bu serverda sozlanmagan.');
  await expect(google).toContainText("Google'ga boradi");
  await expect(google.getByRole('button')).toHaveCount(0);
});

test("the cabinet shows the child's make-ups and makes the child's own calendar link", async ({ page }) => {
  const a = await newCenter('calcab');
  const everyDay = 'Dushanba,Seshanba,Chorshanba,Payshanba,Juma,Shanba,Yakshanba';
  const t1 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Cabinet Teacher', subject: 'English' } });
  const t2 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Visiting Teacher', subject: 'English' } });
  const own = await api('POST', '/groups', { token: a.token, body: { name: 'Cabinet Group', subject: 'English', teacherId: t1.id, scheduleDays: everyDay, startTime: '09:00', endTime: '10:00', maxStudents: 10 } });
  const host = await api('POST', '/groups', { token: a.token, body: { name: 'Visiting Group', subject: 'English', teacherId: t2.id, scheduleDays: everyDay, startTime: '15:00', endTime: '16:00', maxStudents: 10 } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Cabinet Child', groupIds: [own.id] } });
  await api('PATCH', `/students/${kid.id}`, { token: a.token, body: { phone: '+998931112244', parentPhone: '+998941112244' } });
  const { pin } = await api('POST', `/students/${kid.id}/portal-pin`, { token: a.token });
  const day = (n: number) => {
    const d = new Date(`${centerDay()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // Two missed lessons: one credit booked into today's lesson of another group, one still open.
  for (const n of [-2, -3]) await api('POST', '/attendance', { token: a.token, body: { groupId: own.id, date: day(n), entries: [{ studentId: kid.id, status: 'ABSENT' }] } });
  const booked = await api('POST', '/makeups/credits', { token: a.token, body: { studentId: kid.id, groupId: own.id, date: day(-2), reason: 'ABSENT' } });
  await api('POST', '/makeups/credits', { token: a.token, body: { studentId: kid.id, groupId: own.id, date: day(-3), reason: 'ABSENT' } });
  await api('POST', `/makeups/credits/${booked.id}/book`, { token: a.token, body: { mode: 'GROUP_LESSON', targetGroupId: host.id, date: day(0) } });

  await page.goto(centerUrl(a.sub, '/portal'));
  await page.getByRole('textbox').first().pressSequentially('941112244');
  await page.getByRole('button', { name: 'Davom etish' }).click();
  await page.getByPlaceholder('••••••').fill(String(pin));
  await page.getByRole('button', { name: 'Kabinetga kirish' }).click();
  await expect(page.getByText('Cabinet Child').first()).toBeVisible();
  await page.getByRole('button', { name: 'Jadval', exact: true }).first().click();

  const makeups = page.getByRole('region', { name: 'Qoplash darslari' });
  await expect(makeups).toContainText('Kelgusi qoplash darslari');
  await expect(makeups).toContainText('Visiting Group');
  await expect(makeups).toContainText('15:00–16:00');
  await expect(makeups).toContainText('Yozilishni kutmoqda');
  await expect(makeups).toContainText('Muddatsiz');
  await expect(makeups.getByRole('button')).toHaveCount(0);

  const feed = page.getByRole('region', { name: 'Kalendar havolasi (ICS)' });
  await expect(feed).toContainText("O'quvchining darslari va qoplash darslari");
  // Signed in with a phone and PIN: no parent account, so no parent calendar.
  await expect(page.getByRole('region', { name: 'Barcha farzandlaringiz kalendari' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Mening kalendarimni ochish' })).toHaveCount(0);
  await feed.getByRole('button', { name: 'Havola yaratish' }).click();
  const url = await feed.getByLabel('Kalendar havolangiz').inputValue();
  const ics = await page.request.get(url);
  expect(ics.headers()['content-type']).toContain('text/calendar');
  const body = await ics.text();
  expect(body).toContain('BEGIN:VCALENDAR');
  expect(body).toContain('Visiting Group');
  page.once('dialog', (d) => d.accept());
  await feed.getByRole('button', { name: "Havolani o'chirish" }).click();
  await expect(feed).toContainText("Havola o'chirildi.");
  expect((await page.request.get(url)).status()).toBe(404);
});

test("a parent account's cabinet links to the parent's own calendar of all their children; the student's cabinet does not", async ({ page, browser }) => {
  const a = await newCenter('calparent');
  const everyDay = 'Dushanba,Seshanba,Chorshanba,Payshanba,Juma,Shanba,Yakshanba';
  const teacher = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Family Teacher', subject: 'English' } });
  const morning = await api('POST', '/groups', { token: a.token, body: { name: 'Family Morning', subject: 'English', teacherId: teacher.id, scheduleDays: everyDay, startTime: '09:00', endTime: '10:00', maxStudents: 10 } });
  const evening = await api('POST', '/groups', { token: a.token, body: { name: 'Family Evening', subject: 'English', teacherId: teacher.id, scheduleDays: everyDay, startTime: '17:00', endTime: '18:00', maxStudents: 10 } });
  const local = `95${String(Date.now()).slice(-7)}`;
  const older = await api('POST', '/students', { token: a.token, body: { fullName: 'Older Child', phone: `+998${local}`, groupIds: [morning.id] } });
  const younger = await api('POST', '/students', { token: a.token, body: { fullName: 'Younger Child', groupIds: [evening.id] } });
  const { pin } = await api('POST', `/students/${older.id}/portal-pin`, { token: a.token });

  // The parent's own account (role PARENT), linked as guardian of both.
  const parentEmail = `zzbr-parent-${run}@example.test`;
  const inv = await api('POST', '/invitations', { token: a.token, body: { email: parentEmail, role: 'PARENT' } });
  await authSlot('register');
  const parent = await api('POST', `/invitations/${inv.token}/accept`, { body: { fullName: 'Family Parent', password: PASSWORD } });
  for (const kid of [older, younger]) await api('POST', `/students/${kid.id}/guardians`, { token: a.token, body: { userId: parent.user.id, relationship: 'Ona' } });

  // Signed in with the account: the cabinet opens with the children.
  await loginOnMainSite(page, parentEmail);
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByText('Ota-ona').first()).toBeVisible();
  await page.getByRole('button', { name: 'Jadval', exact: true }).first().click();
  const own = page.getByRole('region', { name: 'Barcha farzandlaringiz kalendari' });
  await expect(own).toContainText('ota-ona hisobingiz bilan');
  const link = own.getByRole('link', { name: 'Mening kalendarimni ochish' });
  await expect(link).toHaveAttribute('href', '/calendar');
  // The child's own link is still offered next to it.
  await expect(page.getByRole('region', { name: 'Kalendar havolasi (ICS)' })).toContainText("O'quvchining darslari va qoplash darslari");
  // Fits a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeInViewport();
  const box = (await own.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

  // The parent's calendar page: one link with both children's lessons.
  await link.click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByRole('heading', { name: 'Kalendar bilan ulash' })).toBeVisible();
  const feed = page.getByRole('region', { name: 'Kalendar havolasi (ICS)' });
  await expect(feed).toContainText('Farzandlaringizning darslari');
  await feed.getByRole('button', { name: 'Havola yaratish' }).click();
  const url = await feed.getByLabel('Kalendar havolangiz').inputValue();
  const ics = await (await page.request.get(url)).text();
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('Family Morning');
  expect(ics).toContain('Family Evening');
  expect((await api('GET', '/calendar/feed', { token: (await page.evaluate(() => localStorage.getItem('talimcrm_token')))! })).scope).toBe('PARENT');

  // The older child's own cabinet (phone and PIN, another browser): no parent calendar.
  const ctx = await browser.newContext();
  const cab = await ctx.newPage();
  await cab.goto(centerUrl(a.sub, '/portal'));
  await cab.getByRole('textbox').first().pressSequentially(local);
  await cab.getByRole('button', { name: 'Davom etish' }).click();
  await cab.getByPlaceholder('••••••').fill(String(pin));
  await cab.getByRole('button', { name: 'Kabinetga kirish' }).click();
  await expect(cab.getByText('Older Child').first()).toBeVisible();
  await cab.getByRole('button', { name: 'Jadval', exact: true }).first().click();
  await expect(cab.getByRole('region', { name: 'Kalendar havolasi (ICS)' })).toContainText("O'quvchining darslari va qoplash darslari");
  await expect(cab.getByRole('region', { name: 'Barcha farzandlaringiz kalendari' })).toHaveCount(0);
  await expect(cab.getByRole('link', { name: 'Mening kalendarimni ochish' })).toHaveCount(0);
  await ctx.close();
});
