import { expect, test } from '@playwright/test';
import { api, centerMonth, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// Phones: every main page fits a 390 px screen - no sideways scrolling of
// the page. Wide tables may scroll inside their own card; nothing may stick
// out of the screen outside such a box.
cleanUpStagingCenters();
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('the main pages fit a phone screen', async ({ page }) => {
  const a = await newCenter('mobile');
  const teacher = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Mobile Teacher With A Long Name', subject: 'English', salaryType: 'FIXED', salaryValue: 1000000 } });
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Mobile Group Intermediate B1 Evening', subject: 'English', monthlyPrice: 450000, maxStudents: 12, teacherId: teacher.id, scheduleDays: 'Dushanba,Chorshanba,Juma', startTime: '18:00', endTime: '19:30' } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Mobile Student Abdurakhmonov', phone: '+998901234567', groupIds: [group.id] } });
  await api('POST', '/payments', { token: a.token, body: { studentId: kid.id, amount: 450000, forMonth: centerMonth(), method: 'CASH' } });
  const lead = await api('POST', '/leads', { token: a.token, body: { fullName: 'Mobile Lead', phone: '+998901112244', source: 'PHONE' } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  const paths = [
    '/dashboard', '/students', `/students/${kid.id}`, '/groups', `/groups/${group.id}`, '/teachers', `/teachers/${teacher.id}`,
    '/schedule', '/payments', '/reports', '/reports?tab=payroll', '/leads', `/leads/${lead.id}`, '/homework', '/exams',
    '/ai-materials', '/settings', '/announcements',
  ];
  const problems: string[] = [];
  for (const path of paths) {
    await page.goto(centerUrl(a.sub, path));
    // The pages poll nothing: once the network is quiet, the page is drawn.
    await page.waitForLoadState('networkidle');
    const found = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out: string[] = [];
      if (document.documentElement.scrollWidth > vw) out.push(`page is ${document.documentElement.scrollWidth}px wide`);
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= vw + 1) continue;
        // Inside a card-sized box that scrolls (or clips) on its own - a
        // table's wrapper, a row of tabs - and that box fits: fine. The
        // page's own full-width scroll area does not count.
        let box = el.parentElement;
        let inside = false;
        while (box && box !== document.body) {
          const ox = getComputedStyle(box).overflowX;
          const b = box.getBoundingClientRect();
          if (ox !== 'visible' && b.right <= vw + 1 && b.width < vw - 1) { inside = true; break; }
          box = box.parentElement;
        }
        if (!inside) out.push(`<${el.tagName.toLowerCase()}> "${(el.innerText || '').slice(0, 30).replace(/\s+/g, ' ')}" ends at ${Math.round(r.right)}px`);
      }
      return out.slice(0, 3);
    });
    for (const f of found) problems.push(`${path}: ${f}`);
  }
  expect(problems).toEqual([]);
});
