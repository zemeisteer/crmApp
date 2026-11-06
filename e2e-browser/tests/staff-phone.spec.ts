import { expect, test } from '@playwright/test';
import { api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// Every main staff page on a phone: nothing wider than the screen (no
// sideways scrolling), and the menu opens and leads to another page.
cleanUpStagingCenters();

const PAGES = ['/dashboard', '/students', '/groups', '/teachers', '/schedule', '/payments', '/leads', '/makeups', '/homework', '/exams', '/announcements', '/reports', '/calendar', '/messages', '/settings'];

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the main staff pages fit a 390 px screen', async ({ page }) => {
    test.setTimeout(240_000);
    const a = await newCenter('staffphone');
    const g = await api<{ id: string }>('POST', '/groups', { token: a.token, body: { name: 'Phone Group With A Long Name', subject: 'English', monthlyPrice: 400_000, scheduleDays: 'Dushanba,Chorshanba,Juma', startTime: '09:00', endTime: '10:30' } });
    await api('POST', '/students', { token: a.token, body: { fullName: 'Abdurahmonova Mohinur Bahodirovna', phone: '+998901234567', groupIds: [g.id] } });
    await api('POST', '/leads', { token: a.token, body: { fullName: 'Phone Lead', phone: `+99893${String(Date.now()).slice(-7)}` } });

    await loginOnMainSite(page, a.email);
    await expectCenterDashboard(page, a.sub);
    const wide: string[] = [];
    for (const path of PAGES) {
      await page.goto(centerUrl(a.sub, path));
      await page.waitForLoadState('load');
      // Live pages (chat) never go network-idle: give the lists a moment to fill.
      await page.waitForTimeout(1500);
      const over = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        const sx = document.documentElement.scrollWidth;
        // The element that sticks out the most, to name in the report.
        let worst = '';
        let right = w;
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.right > right + 1 && getComputedStyle(el).position !== 'fixed') {
            right = r.right;
            worst = `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ').slice(0, 2).join('.')}`;
          }
        }
        return sx > w + 1 ? `${sx}px > ${w}px (${worst})` : '';
      });
      if (over) wide.push(`${path}: ${over}`);
    }
    expect(wide).toEqual([]);

    // The menu opens on a phone and takes you to another page.
    await page.goto(centerUrl(a.sub, '/dashboard'));
    const menu = page.getByRole('button', { name: /menyu|menu/i }).first();
    await menu.click();
    await page.getByRole('link', { name: "O'quvchilar", exact: true }).first().click();
    await expect(page).toHaveURL(centerUrl(a.sub, '/students'));
  });
});
