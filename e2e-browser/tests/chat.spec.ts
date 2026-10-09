import { expect, test, type Browser, type Page } from '@playwright/test';
import { PASSWORD, api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, run } from './support';

// Two-way messages: a teacher (staff, context A) and their student's cabinet
// (context B) - two separate browser sessions - write to each other and see
// the other's messages arrive without a reload (the server-sent event
// stream). The menu's unread badge goes up and clears once the
// conversation is opened. A double click on Send, two clicks in the same
// instant, and a retry after a lost answer each store one message. Another
// teacher of the center and another center's owner cannot open the
// conversation by its id (the page says not found; the API answers 404).
// A group conversation: the teacher opens it for their group, two
// students' cabinets (two more browser sessions) receive it live, one
// student's reply reaches the teacher and the other student, and a student
// of another group never sees it (404 by id).
cleanUpStagingCenters();

/** The session token a signed-in page holds (staff). */
const staffToken = (page: Page) => page.evaluate(() => localStorage.getItem('talimcrm_token')) as Promise<string>;

type Msg = { body: string; seq: number; clientMessageId: string };

/** A student's cabinet in its own browser context, on the Messages tab with the live stream open. */
async function cabinetOnMessages(browser: Browser, sub: string, local: string, pin: string, name: string) {
  const ctx = await browser.newContext();
  const cab = await ctx.newPage();
  await cab.goto(centerUrl(sub, '/portal'));
  await cab.getByRole('textbox').first().pressSequentially(local);
  await cab.getByRole('button', { name: 'Davom etish' }).click();
  await cab.getByPlaceholder('••••••').fill(String(pin));
  await cab.getByRole('button', { name: 'Kabinetga kirish' }).click();
  await expect(cab.getByText(name).first()).toBeVisible();
  await cab.locator('.ptl-side').getByRole('button', { name: /^Yozishmalar/ }).click();
  await expect(cab.getByRole('heading', { name: 'Yozishmalar' })).toBeVisible();
  await expect(cab.locator('[data-chat-live="open"]')).toHaveCount(1);
  return { ctx, cab };
}
const bodies = async (token: string, convId: string) =>
  (await api<{ messages: Msg[] }>('GET', `/chat/conversations/${convId}/messages?limit=100`, { token })).messages.map((m) => m.body);

test('a teacher and a student write to each other live; unread clears; one message per send; others cannot open it', async ({ page, browser }) => {
  const a = await newCenter('chat');
  const teacherEmail = `zzbr-chat-t1-${run}@example.test`;
  const otherEmail = `zzbr-chat-t2-${run}@example.test`;
  const t1 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Chat Teacher One', subject: 'English' } });
  await api('POST', `/teachers/${t1.id}/account`, { token: a.token, body: { email: teacherEmail, password: PASSWORD } });
  const t2 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Chat Teacher Two', subject: 'English' } });
  await api('POST', `/teachers/${t2.id}/account`, { token: a.token, body: { email: otherEmail, password: PASSWORD } });
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Chat Group', subject: 'English', teacherId: t1.id, maxStudents: 10 } });
  await api('POST', '/groups', { token: a.token, body: { name: 'Other Teacher Group', subject: 'English', teacherId: t2.id, maxStudents: 10 } });
  const local = `93${String(Date.now()).slice(-7)}`;
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Chat Kid Student', phone: `+998${local}`, groupIds: [group.id] } });
  const { pin } = await api('POST', `/students/${kid.id}/portal-pin`, { token: a.token });

  // --- A: the teacher opens Messages ---------------------------------------
  await loginOnMainSite(page, teacherEmail);
  await expectCenterDashboard(page, a.sub);
  const nav = page.locator('.sidebar');
  await nav.getByRole('link', { name: 'Xabarlar' }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/messages'));
  await expect(page.getByRole('heading', { name: 'Xabarlar', level: 1 })).toBeVisible();
  await expect(page.getByText("Hali suhbatlar yo'q.", { exact: false })).toBeVisible();
  // Connected: from here on nothing can slip between the list and the stream.
  await expect(page.locator('[data-chat-live="open"]')).toHaveCount(1);
  const badge = nav.getByTestId('chat-unread-badge');
  await expect(badge).toHaveCount(0);
  const teacherToken = await staffToken(page);

  // --- B: the student's cabinet, in its own browser context ------------------
  const ctxB = await browser.newContext();
  const cab = await ctxB.newPage();
  await cab.goto(centerUrl(a.sub, '/portal'));
  await cab.getByRole('textbox').first().pressSequentially(local);
  await cab.getByRole('button', { name: 'Davom etish' }).click();
  await cab.getByPlaceholder('••••••').fill(String(pin));
  await cab.getByRole('button', { name: 'Kabinetga kirish' }).click();
  await expect(cab.getByText('Chat Kid Student').first()).toBeVisible();
  await cab.locator('.ptl-side').getByRole('button', { name: /^Yozishmalar/ }).click();
  await expect(cab.getByRole('heading', { name: 'Yozishmalar' })).toBeVisible();
  await expect(cab.locator('[data-chat-live="open"]')).toHaveCount(1);
  // The cabinet may write to the center and to its own teacher only.
  await cab.getByRole('button', { name: '+ Yangi suhbat' }).click();
  const picker = cab.getByRole('region', { name: 'Kimga yozasiz?' });
  await expect(picker.getByRole('button', { name: "Yozish: Markaz ma'muriyati" })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Yozish: Chat Teacher Two' })).toHaveCount(0);
  await picker.getByRole('button', { name: 'Yozish: Chat Teacher One' }).click();
  const cabLog = cab.getByRole('log', { name: 'Xabarlar' });
  await expect(cab.getByRole('heading', { name: 'Chat Teacher One', level: 2 })).toBeVisible();
  const cabText = cab.getByRole('textbox', { name: 'Xabar matni' });
  await cabText.fill('Salom ustoz, uy vazifasi qaysi?');
  await cabText.press('Enter');
  await expect(cabLog.getByRole('listitem').filter({ hasText: 'Salom ustoz, uy vazifasi qaysi?' })).toContainText('Siz');

  // --- A sees it arrive live: in the list and on the menu badge --------------
  const row = page.getByRole('list', { name: 'Suhbatlar' }).getByRole('button', { name: /Chat Kid Student/ });
  await expect(row).toContainText('Salom ustoz, uy vazifasi qaysi?');
  await expect(row).toContainText("1 ta o'qilmagan");
  await expect(badge).toContainText('1');
  expect((await api('GET', '/chat/unread', { token: teacherToken })).unread).toBe(1);

  // Opening the conversation reads it: the badge clears, also on the server.
  await row.click();
  await expect(page).toHaveURL(/\/messages\?c=/);
  const convId = new URL(page.url()).searchParams.get('c')!;
  const log = page.getByRole('log', { name: 'Xabarlar' });
  await expect(log).toContainText('Salom ustoz, uy vazifasi qaysi?');
  await expect(badge).toHaveCount(0);
  await expect(row).not.toContainText("o'qilmagan");
  await expect.poll(async () => (await api('GET', '/chat/unread', { token: teacherToken })).unread).toBe(0);

  // --- A replies (Shift+Enter is a new line); B sees it live -----------------
  const text = page.getByRole('textbox', { name: 'Xabar matni' });
  await text.fill('Va alaykum assalom!');
  await text.press('Shift+Enter');
  await text.pressSequentially('12-mashq.');
  await expect(page.getByText('29/2000')).toBeVisible();
  await text.press('Enter');
  await expect(cabLog).toContainText('12-mashq.');
  await expect(cabLog.getByRole('listitem').filter({ hasText: 'Va alaykum assalom!' })).toContainText('Chat Teacher One');
  expect(await bodies(teacherToken, convId)).toContain('Va alaykum assalom!\n12-mashq.');

  // --- One message per send ---------------------------------------------------
  const send = page.getByRole('button', { name: 'Yuborish', exact: true });
  await text.fill('Bir marta');
  await send.dblclick();
  await expect(log.getByRole('listitem').filter({ hasText: 'Bir marta' })).toHaveCount(1);
  // Two clicks in the same instant, before the page can re-render.
  await text.fill('Bir zumda');
  await send.evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  await expect(log.getByRole('listitem').filter({ hasText: 'Bir zumda' })).toHaveCount(1);
  await expect(cabLog.getByRole('listitem').filter({ hasText: 'Bir zumda' })).toHaveCount(1);
  // The server stored each once (a new client id per message, never per click).
  await expect.poll(async () => (await bodies(teacherToken, convId)).filter((b) => b === 'Bir marta' || b === 'Bir zumda').sort()).toEqual(['Bir marta', 'Bir zumda']);

  // The answer to a send is lost (stored, but the page never hears back):
  // the page offers a retry, and the retry with the same client id is not a
  // second message. (Catching up from the stream would find the stored copy
  // by itself, so that is held back until the retry.)
  let lost = 0;
  let holdCatchUp = true;
  await page.route('**/api/chat/conversations/*/messages*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && lost === 0) {
      lost++;
      await route.fetch();
      return route.abort('connectionreset');
    }
    if (req.method() === 'GET' && holdCatchUp && new URL(req.url()).searchParams.has('after')) return route.abort('connectionreset');
    return route.fallback();
  });
  await text.fill('Javob yo‘qolsa ham bitta');
  await text.press('Enter');
  const failed = log.getByRole('listitem').filter({ hasText: 'Javob yo‘qolsa ham bitta' });
  await expect(failed.getByRole('alert')).toContainText('Yuborilmadi.');
  expect((await bodies(teacherToken, convId)).filter((b) => b === 'Javob yo‘qolsa ham bitta')).toHaveLength(1);
  holdCatchUp = false;
  await failed.getByRole('button', { name: 'Qayta yuborish' }).click();
  await expect(failed.getByRole('alert')).toHaveCount(0);
  await expect(failed).toHaveCount(1);
  await expect(failed).not.toContainText('Yuborilmoqda');
  await page.unroute('**/api/chat/conversations/*/messages*');
  expect(lost).toBe(1);
  expect((await bodies(teacherToken, convId)).filter((b) => b === 'Javob yo‘qolsa ham bitta')).toHaveLength(1);
  // The cabinet shows the same history, each message once.
  await expect(cabLog.getByRole('listitem').filter({ hasText: 'Javob yo‘qolsa ham bitta' })).toHaveCount(1);
  await ctxB.close();

  // --- Nobody else opens it by its id -----------------------------------------
  const ctxC = await browser.newContext();
  const other = await ctxC.newPage();
  await loginOnMainSite(other, otherEmail);
  await expectCenterDashboard(other, a.sub);
  await other.goto(centerUrl(a.sub, `/messages?c=${convId}`));
  await expect(other.getByRole('alert').filter({ hasText: 'Suhbat topilmadi' })).toBeVisible();
  await expect(other.getByText('Salom ustoz, uy vazifasi qaysi?')).toHaveCount(0);
  await expect(other.getByRole('textbox', { name: 'Xabar matni' })).toHaveCount(0);
  const otherToken = await staffToken(other);
  await expect(api('GET', `/chat/conversations/${convId}/messages`, { token: otherToken })).rejects.toThrow(/-> 404/);
  await expect(api('POST', `/chat/conversations/${convId}/messages`, { token: otherToken, body: { body: 'x', clientMessageId: `zz-${run}-x1` } })).rejects.toThrow(/-> 404/);
  await ctxC.close();
  // Another center's owner: the same 404 (an id alone tells nothing).
  const b = await newCenter('chat-other');
  await expect(api('GET', `/chat/conversations/${convId}/messages`, { token: b.token })).rejects.toThrow(/-> 404/);
  expect((await api<Array<{ id: string }>>('GET', '/chat/conversations', { token: b.token })).map((c) => c.id)).not.toContain(convId);
});

test("the cabinet writes to the center; the center's inbox answers on a phone (list and thread are two screens)", async ({ browser }) => {
  const a = await newCenter('chat-inbox');
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Inbox Group', subject: 'English', maxStudents: 10 } });
  const local = `94${String(Date.now()).slice(-7)}`;
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Inbox Kid Student', phone: `+998${local}`, groupIds: [group.id] } });
  const { pin } = await api('POST', `/students/${kid.id}/portal-pin`, { token: a.token });

  // A: the owner (the center's inbox) on a phone.
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctxA.newPage();
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/messages'));
  await expect(page.locator('[data-chat-live="open"]')).toHaveCount(1);

  // B: the cabinet writes to the center.
  const ctxB = await browser.newContext();
  const cab = await ctxB.newPage();
  await cab.goto(centerUrl(a.sub, '/portal'));
  await cab.getByRole('textbox').first().pressSequentially(local);
  await cab.getByRole('button', { name: 'Davom etish' }).click();
  await cab.getByPlaceholder('••••••').fill(String(pin));
  await cab.getByRole('button', { name: 'Kabinetga kirish' }).click();
  await cab.locator('.ptl-side').getByRole('button', { name: /^Yozishmalar/ }).click();
  await expect(cab.locator('[data-chat-live="open"]')).toHaveCount(1);
  await cab.getByRole('button', { name: '+ Yangi suhbat' }).click();
  await cab.getByRole('button', { name: "Yozish: Markaz ma'muriyati" }).click();
  const cabText = cab.getByRole('textbox', { name: 'Xabar matni' });
  await cabText.fill("To'lov qachongacha?");
  await cab.getByRole('button', { name: 'Yuborish', exact: true }).click();

  // A: the list screen shows it live; opening it shows only the thread.
  const row = page.getByRole('list', { name: 'Suhbatlar' }).getByRole('button', { name: /Inbox Kid Student/ });
  await expect(row).toContainText("To'lov qachongacha?");
  await expect(row).toContainText('Markaz nomidan');
  await row.click();
  const log = page.getByRole('log', { name: 'Xabarlar' });
  await expect(log).toContainText("To'lov qachongacha?");
  await expect(page.getByRole('list', { name: 'Suhbatlar' })).toBeHidden();
  const text = page.getByRole('textbox', { name: 'Xabar matni' });
  await text.fill('Oyning 10-sanasigacha.');
  await page.getByRole('button', { name: 'Yuborish', exact: true }).click();
  await expect(cab.getByRole('log', { name: 'Xabarlar' })).toContainText('Oyning 10-sanasigacha.');
  // Back to the list screen; nothing on the page is wider than the phone.
  await page.getByRole('button', { name: "Suhbatlar ro'yxatiga qaytish" }).click();
  await expect(page.getByRole('list', { name: 'Suhbatlar' })).toBeVisible();
  await expect(log).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await ctxA.close();
  await ctxB.close();
});

test("a teacher opens their group's conversation; both students get it live, a reply reaches everyone in it, an outsider never sees it", async ({ page, browser }) => {
  const a = await newCenter('chatgroup');
  const teacherEmail = `zzbr-chat-gt-${run}@example.test`;
  const t1 = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Group Chat Teacher', subject: 'English' } });
  await api('POST', `/teachers/${t1.id}/account`, { token: a.token, body: { email: teacherEmail, password: PASSWORD } });
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Team Group', subject: 'English', teacherId: t1.id, maxStudents: 10 } });
  // The same teacher's other group: its student is the teacher's, but not in this group.
  const otherGroup = await api('POST', '/groups', { token: a.token, body: { name: 'Side Group', subject: 'English', teacherId: t1.id, maxStudents: 10 } });
  const base = String(Date.now()).slice(-6);
  const kids = [
    { name: 'Group Kid One', local: `931${base}`, groupId: group.id },
    { name: 'Group Kid Two', local: `932${base}`, groupId: group.id },
    { name: 'Outside Kid', local: `933${base}`, groupId: otherGroup.id },
  ];
  const pins: string[] = [];
  for (const k of kids) {
    const s = await api('POST', '/students', { token: a.token, body: { fullName: k.name, phone: `+998${k.local}`, groupIds: [k.groupId] } });
    pins.push(String((await api('POST', `/students/${s.id}/portal-pin`, { token: a.token })).pin));
  }

  // --- The two students of the group wait in their cabinets -----------------
  const one = await cabinetOnMessages(browser, a.sub, kids[0].local, pins[0], kids[0].name);
  const two = await cabinetOnMessages(browser, a.sub, kids[1].local, pins[1], kids[1].name);

  // --- The teacher opens the group's conversation and writes -----------------
  await loginOnMainSite(page, teacherEmail);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/messages'));
  await expect(page.locator('[data-chat-live="open"]')).toHaveCount(1);
  await page.getByRole('button', { name: '+ Yangi suhbat' }).click();
  const picker = page.getByRole('region', { name: 'Kimga yozasiz?' });
  await expect(picker.getByRole('button', { name: 'Yozish: Side Group' })).toBeVisible();
  await picker.getByRole('button', { name: 'Yozish: Team Group' }).click();
  await expect(page.getByRole('heading', { name: 'Team Group', level: 2 })).toBeVisible();
  await expect(page).toHaveURL(/\/messages\?c=/);
  const convId = new URL(page.url()).searchParams.get('c')!;
  const text = page.getByRole('textbox', { name: 'Xabar matni' });
  await text.fill('Ertaga dars 15:00 da boshlanadi.');
  await text.press('Enter');
  const log = page.getByRole('log', { name: 'Xabarlar' });
  await expect(log.getByRole('listitem').filter({ hasText: 'Ertaga dars 15:00 da boshlanadi.' })).toHaveCount(1);
  const teacherToken = await staffToken(page);
  expect(await bodies(teacherToken, convId)).toEqual(['Ertaga dars 15:00 da boshlanadi.']);

  // --- Both cabinets receive it live (no reload) -------------------------------
  for (const { cab } of [one, two]) {
    const row = cab.getByRole('list', { name: 'Suhbatlar' }).getByRole('button', { name: /Team Group/ });
    await expect(row).toContainText('Ertaga dars 15:00 da boshlanadi.');
    await expect(row).toContainText('Guruh suhbati');
    await row.click();
    await expect(cab.getByRole('heading', { name: 'Team Group', level: 2 })).toBeVisible();
    await expect(cab.getByRole('log', { name: 'Xabarlar' }).getByRole('listitem').filter({ hasText: 'Ertaga dars 15:00 da boshlanadi.' })).toContainText('Group Chat Teacher');
  }

  // --- One student replies; the teacher and the other student see it live ---------
  const oneText = one.cab.getByRole('textbox', { name: 'Xabar matni' });
  await oneText.fill('Tushunarli, rahmat!');
  await oneText.press('Enter');
  await expect(one.cab.getByRole('log', { name: 'Xabarlar' }).getByRole('listitem').filter({ hasText: 'Tushunarli, rahmat!' })).toContainText('Siz');
  await expect(log.getByRole('listitem').filter({ hasText: 'Tushunarli, rahmat!' })).toContainText('Group Kid One');
  await expect(two.cab.getByRole('log', { name: 'Xabarlar' }).getByRole('listitem').filter({ hasText: 'Tushunarli, rahmat!' })).toContainText('Group Kid One');
  expect(await bodies(teacherToken, convId)).toEqual(['Ertaga dars 15:00 da boshlanadi.', 'Tushunarli, rahmat!']);
  await one.ctx.close();
  await two.ctx.close();

  // --- A student of another group: not listed, 404 by id ---------------------------
  const outsider = await api<{ accessToken: string }>('POST', '/portal/auth/phone/verify', { body: { phone: `+998${kids[2].local}`, pin: pins[2], subdomain: a.sub } });
  const list = await api<Array<{ id: string }>>('GET', '/portal/chat/conversations', { token: outsider.accessToken });
  expect(list.map((c) => c.id)).not.toContain(convId);
  await expect(api('GET', `/portal/chat/conversations/${convId}/messages`, { token: outsider.accessToken })).rejects.toThrow(/-> 404/);
  await expect(api('POST', `/portal/chat/conversations/${convId}/messages`, { token: outsider.accessToken, body: { body: 'x', clientMessageId: `zz-${run}-g1` } })).rejects.toThrow(/-> 404/);
  // Nor can it open the group's conversation itself.
  await expect(api('POST', '/portal/chat/conversations', { token: outsider.accessToken, body: { kind: 'GROUP', groupId: group.id } })).rejects.toThrow(/-> 404/);
  expect(await bodies(teacherToken, convId)).toEqual(['Ertaga dars 15:00 da boshlanadi.', 'Tushunarli, rahmat!']);
});
