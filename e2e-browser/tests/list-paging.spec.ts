import { expect, test, type Page } from '@playwright/test';
import { api, centerMonth, centerUrl, cleanUpStagingCenters, expectCenterDashboard, isApiUrl, loginOnMainSite, money, newCenter } from './support';

// The students and payments lists are paged by the server (20 rows a page):
// ranges and totals are those of the whole list, pages do not overlap, the
// search and the filters run on the server and start again on page 1, and
// a change (new student, deleted student) reloads the page the user is on.
cleanUpStagingCenters();

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
const pad = (n: number) => String(n).padStart(2, '0');

/** The next GET of an API list (`/api/students`, `/api/payments`) whose query passes `check`. */
function listRequest(page: Page, path: string, check: (q: URLSearchParams) => boolean) {
  return page.waitForRequest((r) => {
    if (r.method() !== 'GET' || !isApiUrl(r.url())) return false;
    const u = new URL(r.url());
    return u.pathname === path && check(u.searchParams);
  });
}

/**
 * Every GET of the API list `path` from now on, for checking afterwards
 * that no unpaged "load the whole list" request was made.
 */
function recordLists(page: Page, path: string) {
  const seen: URL[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' || !isApiUrl(r.url())) return;
    const u = new URL(r.url());
    if (u.pathname === path) seen.push(u);
  });
  return seen;
}

/** The texts of one column of the table's body rows. */
async function column(page: Page, index: number) {
  return page.locator('table tbody tr').evaluateAll((trs, i) => trs.map((tr) => (tr.children[i] as HTMLElement).innerText.trim()), index);
}

/** Nothing sticks out sideways on a 390 px screen. */
async function fitsPhone(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForLoadState('networkidle');
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test('students: server pages, server search and filters, ranges and the last partial page', async ({ page }) => {
  const a = await newCenter('pgstu');
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Paging Group', subject: 'English', monthlyPrice: 300000, maxStudents: 40 } });
  const second = await api('POST', '/groups', { token: a.token, body: { name: 'Second Group', subject: 'Matematika', monthlyPrice: 300000, maxStudents: 40 } });
  // 45 students, oldest first (the list is newest first); 25 in the group,
  // 6 (40-45) in the second one, 3 named Zebo; odd ones male, even ones female.
  for (let i = 1; i <= 45; i++) {
    const name = [7, 18, 33].includes(i) ? `Pager Zebo ${pad(i)}` : `Pager Student ${pad(i)}`;
    const groupIds = i <= 25 ? [group.id] : i >= 40 ? [second.id] : [];
    await api('POST', '/students', { token: a.token, body: { fullName: name, phone: `+9989055500${pad(i)}`, gender: i % 2 ? 'MALE' : 'FEMALE', groupIds } });
  }
  // The page never loads the whole list: every request is one page.
  const lists = recordLists(page, '/api/students');

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  const first = listRequest(page, '/api/students', (q) => q.get('page') === '1' && q.get('pageSize') === '20' && !q.has('search'));
  await page.goto(centerUrl(a.sub, '/students'));
  await first;

  const pager = page.getByRole('navigation', { name: "O'quvchilar ro'yxati sahifalari" });
  const status = pager.getByRole('status');
  const next = pager.getByRole('button', { name: 'Keyingi sahifa' });
  const prev = pager.getByRole('button', { name: 'Oldingi sahifa' });

  await expect(status).toContainText('1–20, jami 45');
  await expect(status).toContainText('Sahifa 1 / 3');
  await expect(prev).toBeDisabled();
  const seen: string[] = [];
  const p1 = await column(page, 0);
  expect(p1).toHaveLength(20);
  expect(p1[0]).toBe('Pager Student 45'); // newest first
  seen.push(...p1);

  let req = listRequest(page, '/api/students', (q) => q.get('page') === '2');
  await next.click();
  await req;
  await expect(status).toContainText('21–40, jami 45');
  await expect(pager.locator('[aria-current="page"]')).toHaveText('Sahifa 2 / 3');
  const p2 = await column(page, 0);
  expect(p2).toHaveLength(20);
  seen.push(...p2);
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);

  req = listRequest(page, '/api/students', (q) => q.get('page') === '3');
  await next.click();
  await req;
  await expect(status).toContainText('41–45, jami 45');
  await expect(next).toBeDisabled();
  const p3 = await column(page, 0);
  expect(p3).toHaveLength(5); // the last page is partial
  expect(p3[4]).toBe('Pager Student 01');
  seen.push(...p3);
  // Every student exactly once across the pages.
  expect(new Set(seen).size).toBe(45);
  expect(seen).toHaveLength(45);

  // Reloading keeps the page (it is in the address).
  await page.reload();
  await expect(status).toContainText('41–45, jami 45');

  // The search runs on the server and starts again on page 1.
  const search = page.getByRole('searchbox', { name: "O'quvchini qidirish" });
  req = listRequest(page, '/api/students', (q) => q.get('search') === 'zebo' && q.get('page') === '1');
  await search.fill('zebo');
  await req;
  await expect(status).toContainText('1–3, jami 3');
  expect(await column(page, 0)).toEqual(['Pager Zebo 33', 'Pager Zebo 18', 'Pager Zebo 07']);
  await expect(page).toHaveURL(/[?&]q=zebo(&|$)/);
  await expect(pager.getByRole('button')).toHaveCount(0); // one page: no buttons

  // By phone too (the server matches phone numbers).
  req = listRequest(page, '/api/students', (q) => q.get('search') === '5550012' && q.get('page') === '1');
  await search.fill('5550012');
  await req;
  await expect(status).toContainText('1–1, jami 1');
  expect(await column(page, 0)).toEqual(['Pager Student 12']);

  // And by the name of a group the student is in.
  req = listRequest(page, '/api/students', (q) => q.get('search') === 'second group' && q.get('page') === '1');
  await search.fill('second group');
  await req;
  await expect(status).toContainText('1–6, jami 6');
  expect(await column(page, 0)).toEqual(['Pager Student 45', 'Pager Student 44', 'Pager Student 43', 'Pager Student 42', 'Pager Student 41', 'Pager Student 40']);

  req = listRequest(page, '/api/students', (q) => !q.has('search') && q.get('page') === '1');
  await search.fill('');
  await req;
  await expect(status).toContainText('1–20, jami 45');

  // The group filter runs on the server too: 25 students in the group over
  // two pages, the totals the filtered list's, not "of this page".
  req = listRequest(page, '/api/students', (q) => q.get('groupId') === group.id && q.get('page') === '1' && q.get('pageSize') === '20');
  await page.getByRole('button', { name: 'Barcha guruhlar' }).click();
  await page.getByRole('option', { name: 'Paging Group' }).click();
  await req;
  await expect(status).toContainText('1–20, jami 25');
  req = listRequest(page, '/api/students', (q) => q.get('groupId') === group.id && q.get('page') === '2');
  await next.click();
  await req;
  await expect(status).toContainText('21–25, jami 25');
  expect(await column(page, 0)).toEqual(['Pager Student 05', 'Pager Student 04', 'Pager Student 03', 'Pager Student 02', 'Pager Student 01']);

  // On a phone, the list and its page controls fit the screen.
  expect(await fitsPhone(page)).toBe(true);
  await prev.scrollIntoViewIfNeeded();
  await expect(prev).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 1280, height: 720 });

  // Gender, with the group: back to page 1, the 12 girls of the group.
  req = listRequest(page, '/api/students', (q) => q.get('groupId') === group.id && q.get('gender') === 'FEMALE' && q.get('page') === '1');
  await page.getByRole('button', { name: 'Erkak/Ayol' }).click();
  await page.getByRole('option', { name: 'Ayol', exact: true }).click();
  await req;
  await expect(status).toContainText('1–12, jami 12');
  const girls = await column(page, 0);
  expect(girls).toHaveLength(12);
  expect(girls[0]).toBe('Pager Student 24');
  expect(girls[11]).toBe('Pager Student 02');

  // A direction (a group subject) clears the group and keeps the gender.
  req = listRequest(page, '/api/students', (q) => q.get('direction') === 'Matematika' && !q.has('groupId') && q.get('gender') === 'FEMALE' && q.get('page') === '1');
  await page.getByRole('button', { name: "Barcha yo'nalishlar" }).click();
  await page.getByRole('option', { name: 'Matematika' }).click();
  await req;
  await expect(status).toContainText('1–3, jami 3');
  expect(await column(page, 0)).toEqual(['Pager Student 44', 'Pager Student 42', 'Pager Student 40']);

  // No request ever asked for the whole list.
  expect(lists.length).toBeGreaterThan(5);
  expect(lists.filter((u) => u.searchParams.get('page') === null).map((u) => u.search)).toEqual([]);
});

test('students: a new student and a deletion reload the page the user is on, which stays valid', async ({ page }) => {
  const a = await newCenter('pgdel');
  for (let i = 1; i <= 22; i++) await api('POST', '/students', { token: a.token, body: { fullName: `Del Student ${pad(i)}` } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/students'));
  const pager = page.getByRole('navigation', { name: "O'quvchilar ro'yxati sahifalari" });
  const status = pager.getByRole('status');
  await expect(status).toContainText('1–20, jami 22');
  await pager.getByRole('button', { name: 'Keyingi sahifa' }).click();
  await expect(status).toContainText('21–22, jami 22');
  expect(await column(page, 0)).toEqual(['Del Student 02', 'Del Student 01']);

  // A new student: the list stays on page 2 and shows it again (the newest
  // student is on page 1, so one more row moves onto page 2).
  await page.getByRole('button', { name: "+ Yangi o'quvchi" }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Madina Yusupova').fill('Del Student New');
  const reload = listRequest(page, '/api/students', (q) => q.get('page') === '2');
  await dialog.getByRole('button', { name: "O'quvchini qo'shish" }).click();
  await reload;
  await expect(status).toContainText('21–23, jami 23');
  expect(await column(page, 0)).toEqual(['Del Student 03', 'Del Student 02', 'Del Student 01']);

  // Deleting from the profile returns to the same page of the list...
  const remove = async (name: string) => {
    await page.locator('table tbody tr').filter({ hasText: name }).getByRole('link', { name: "Profilni ko'rish" }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: "O'quvchini o'chirish" }).click();
    await expect(page).toHaveURL(/\/students(\?|$)/);
  };
  await remove('Del Student 01');
  await expect(page).toHaveURL(/\/students\?page=2$/);
  await expect(status).toContainText('21–22, jami 22');
  expect(await column(page, 0)).toEqual(['Del Student 03', 'Del Student 02']);
  await remove('Del Student 02');
  await expect(status).toContainText('21–21, jami 21');
  expect(await column(page, 0)).toEqual(['Del Student 03']);

  // ...and when that was the last row of the last page, it moves to the
  // last page that still has rows instead of showing an empty page 2.
  await remove('Del Student 03');
  await expect(status).toContainText('1–20, jami 20');
  await expect(pager.getByRole('button')).toHaveCount(0);
  await expect(page).toHaveURL(/\/students$/);
  expect(await column(page, 0)).toHaveLength(20);
  expect((await api<{ total: number }>('GET', '/students?page=1', { token: a.token })).total).toBe(20);
});

test('payments: server pages and filters; the totals are the whole center\'s, not one page\'s', async ({ page }) => {
  const a = await newCenter('pgpay');
  const month = centerMonth();
  const [y, m] = month.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  const prevLabel = `${UZ_MONTHS[(m + 10) % 12]} ${m === 1 ? y - 1 : y}`;
  // Alpha and Beta are in "Pay Group"; Gamma is in no group.
  const payGroup = await api('POST', '/groups', { token: a.token, body: { name: 'Pay Group', subject: 'English', monthlyPrice: 300000, maxStudents: 40 } });
  const kids: Array<{ id: string }> = [];
  for (const name of ['Payer Alpha', 'Payer Beta', 'Payer Gamma']) {
    kids.push(await api('POST', '/students', { token: a.token, body: { fullName: name, groupIds: name === 'Payer Gamma' ? [] : [payGroup.id] } }));
  }
  // 45 payments: odd ones in cash, even ones by Click; 1-30 for this month,
  // 31-45 for the month before; every amount different.
  let thisMonthPaid = 0;
  let thisYearPaid = 0; // by the month paid for: in January the month before is last year's
  for (let i = 1; i <= 45; i++) {
    const amount = 100_000 + i * 1_000;
    const forMonth = i <= 30 ? month : prev;
    if (forMonth === month) thisMonthPaid += amount;
    if (forMonth.startsWith(String(y))) thisYearPaid += amount;
    await api('POST', '/payments', { token: a.token, body: { studentId: kids[i % 3].id, amount, forMonth, method: i % 2 ? 'CASH' : 'CLICK' } });
  }

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  // The page never loads the whole payment list: every request is one page.
  const lists = recordLists(page, '/api/payments');
  const first = listRequest(page, '/api/payments', (q) => q.get('page') === '1' && q.get('pageSize') === '20');
  await page.goto(centerUrl(a.sub, '/payments'));
  await first;

  const revenueCard = page.locator('div:has(> div:text-is("Bu oy tushum"))').first();
  await expect(revenueCard).toContainText(money(thisMonthPaid));

  // The revenue chart's current bar is the center's total, not one page's:
  // monthly from the server's monthly totals, daily from the paid payments
  // of the last days (all 45 were paid today), yearly from the server's
  // sums per year (by the month paid for).
  const allPaid = Array.from({ length: 45 }, (_, k) => 100_000 + (k + 1) * 1_000).reduce((s, v) => s + v, 0);
  const chart = page.locator('div:has(> div > div:text-is("Tushumlar dinamikasi"))').first();
  const current = chart.locator('span:has(> strong)').first();
  await expect(current).toContainText(`${UZ_MONTHS[m - 1]}: `);
  await expect(current).toContainText(money(thisMonthPaid));
  let chartReq = listRequest(page, '/api/payments', (q) => q.get('status') === 'PAID' && q.get('page') === '1' && q.get('pageSize') === '200');
  await page.getByRole('button', { name: 'Kunlik', exact: true }).click();
  await chartReq;
  await expect(current).toContainText(money(allPaid));
  chartReq = listRequest(page, '/api/reports/revenue-by-year', (q) => q.get('years') === '4');
  await page.getByRole('button', { name: 'Yillik', exact: true }).click();
  await chartReq;
  await expect(current).toContainText(`${y}: `);
  await expect(current).toContainText(money(thisYearPaid));
  await page.getByRole('button', { name: 'Oylik', exact: true }).click();
  await expect(current).toContainText(money(thisMonthPaid));
  const pager = page.getByRole('navigation', { name: "To'lovlar ro'yxati sahifalari" });
  const status = pager.getByRole('status');
  const next = pager.getByRole('button', { name: 'Keyingi sahifa' });
  await expect(status).toContainText('1–20, jami 45');

  const amounts: string[] = [];
  amounts.push(...(await column(page, 3)));
  await next.click();
  await expect(status).toContainText('21–40, jami 45');
  amounts.push(...(await column(page, 3)));
  await next.click();
  await expect(status).toContainText('41–45, jami 45');
  await expect(next).toBeDisabled();
  const last = await column(page, 3);
  expect(last).toHaveLength(5);
  amounts.push(...last);
  expect(amounts).toHaveLength(45);
  expect(new Set(amounts).size).toBe(45); // no payment on two pages
  // The month's revenue does not change with the page shown.
  await expect(revenueCard).toContainText(money(thisMonthPaid));

  // Method: a server filter, back to page 1; its pages page on the server too.
  let req = listRequest(page, '/api/payments', (q) => q.get('method') === 'CLICK' && q.get('page') === '1');
  await page.getByRole('button', { name: "To'lov usuli" }).click();
  await page.getByRole('option', { name: 'Click', exact: true }).click();
  await req;
  await expect(status).toContainText('1–20, jami 22');
  req = listRequest(page, '/api/payments', (q) => q.get('method') === 'CLICK' && q.get('page') === '2');
  await next.click();
  await req;
  await expect(status).toContainText('21–22, jami 22');
  expect(new Set(await column(page, 4))).toEqual(new Set(['Click']));

  // Month: also on the server, together with the method.
  req = listRequest(page, '/api/payments', (q) => q.get('forMonth') === prev && q.get('method') === 'CLICK' && q.get('page') === '1');
  await page.getByRole('button', { name: "To'lov qaysi oy uchun" }).click();
  await page.getByRole('option', { name: prevLabel, exact: true }).click();
  await req;
  await expect(status).toContainText('1–7, jami 7'); // 32, 34, ... 44
  await expect(revenueCard).toContainText(money(thisMonthPaid));

  // Status: PENDING has none of these.
  req = listRequest(page, '/api/payments', (q) => q.get('status') === 'PENDING' && q.get('page') === '1');
  await page.getByRole('button', { name: "To'lov holati" }).click();
  await page.getByRole('option', { name: 'Kutilmoqda' }).click();
  await req;
  await expect(page.getByText("Hech kim yo'q — filtrga mos to'lov topilmadi.")).toBeVisible();

  // Clearing the filters brings the whole list back.
  await page.getByRole('button', { name: "To'lov holati" }).click();
  await page.getByRole('option', { name: 'Barcha holatlar' }).click();
  await page.getByRole('button', { name: "To'lov qaysi oy uchun" }).click();
  await page.getByRole('option', { name: 'Barcha oylar' }).click();
  req = listRequest(page, '/api/payments', (q) => !q.has('method') && !q.has('forMonth') && !q.has('status') && q.get('page') === '1');
  await page.getByRole('button', { name: "To'lov usuli" }).click();
  await page.getByRole('option', { name: 'Barcha usullar' }).click();
  await req;
  await expect(status).toContainText('1–20, jami 45');

  // The text search (student name or month) runs on the server: the 15
  // payments of Alpha, over one page.
  const searchBox = page.getByRole('searchbox', { name: "To'lovni qidirish" });
  req = listRequest(page, '/api/payments', (q) => q.get('search') === 'alpha' && q.get('page') === '1' && q.get('pageSize') === '20');
  await searchBox.fill('alpha');
  await req;
  await expect(status).toContainText('1–15, jami 15');
  expect(new Set(await column(page, 1))).toEqual(new Set(['Payer Alpha']));
  // The month paid for, too: payments 31-45.
  req = listRequest(page, '/api/payments', (q) => q.get('search') === prev && q.get('page') === '1');
  await searchBox.fill(prev);
  await req;
  await expect(status).toContainText('1–15, jami 15');

  // The group (payments of its students) is a server filter as well, with
  // the search and on its own: Alpha's and Beta's 30 payments, two pages.
  req = listRequest(page, '/api/payments', (q) => q.get('groupId') === payGroup.id && q.get('search') === prev && q.get('page') === '1');
  await page.getByRole('button', { name: 'Guruh', exact: true }).click();
  await page.getByRole('option', { name: 'Pay Group' }).click();
  await req;
  await expect(status).toContainText('1–10, jami 10'); // 31-45 without Gamma's 5
  expect(new Set(await column(page, 1))).toEqual(new Set(['Payer Alpha', 'Payer Beta']));
  req = listRequest(page, '/api/payments', (q) => q.get('groupId') === payGroup.id && !q.has('search') && q.get('page') === '1');
  await searchBox.fill('');
  await req;
  await expect(status).toContainText('1–20, jami 30');
  req = listRequest(page, '/api/payments', (q) => q.get('groupId') === payGroup.id && q.get('page') === '2');
  await next.click();
  await req;
  await expect(status).toContainText('21–30, jami 30');
  expect(new Set(await column(page, 1))).toEqual(new Set(['Payer Alpha', 'Payer Beta']));

  // On a phone, the history and its page controls fit the screen.
  expect(await fitsPhone(page)).toBe(true);

  // No request ever asked for the whole payment list (chart, search or filters).
  expect(lists.length).toBeGreaterThan(10);
  expect(lists.filter((u) => u.searchParams.get('page') === null).map((u) => u.search)).toEqual([]);
});
