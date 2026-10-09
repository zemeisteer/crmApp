import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { api, centerMonth, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// Automated accessibility check (axe-core, WCAG 2.0/2.1 A and AA rules) of
// the main pages, the pages added for make-ups, calendar and chat, the
// student's cabinet and the public site. Critical and serious findings fail
// the test; every finding is listed in the failure message.
// Not covered by this: screen readers, keyboard-only journeys, other browsers.
cleanUpStagingCenters();

const AXE = readFileSync(createRequire(__filename).resolve('axe-core/axe.min.js'), 'utf8');

async function scan(page: Page, label: string) {
  await page.addScriptTag({ content: AXE });
  const found = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[]; any: Array<{ data?: { fgColor?: string; bgColor?: string; contrastRatio?: number } }> }> }> }> } };
    const r = await w.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return r.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => {
        const d = n.any[0]?.data;
        const colours = d?.fgColor ? ` ${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}:1` : '';
        return `${v.impact} ${v.id}: ${n.target.join(' ')}${colours}`;
      }));
  });
  return found.map((f) => `${label}: ${f}`);
}

async function settle(page: Page) {
  if (await page.locator('[data-chat-live]').count()) {
    // The Messages page holds its live stream open: the network is never quiet.
    await expect(page.locator('[data-chat-live="open"]')).toHaveCount(1);
  } else {
    await page.waitForLoadState('networkidle');
  }
}

test('main, new and cabinet pages have no critical or serious accessibility findings', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const a = await newCenter('a11y');
  const teacher = await api('POST', '/teachers', { token: a.token, body: { fullName: 'A11y Teacher', subject: 'English', salaryType: 'FIXED', salaryValue: 1000000 } });
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'A11y Group', subject: 'English', monthlyPrice: 450000, maxStudents: 12, teacherId: teacher.id, scheduleDays: 'Dushanba,Chorshanba,Juma', startTime: '18:00', endTime: '19:30' } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'A11y Student', phone: '+998901234500', groupIds: [group.id] } });
  await api('PATCH', `/students/${kid.id}`, { token: a.token, body: { parentPhone: '+998941234500' } });
  await api('POST', '/payments', { token: a.token, body: { studentId: kid.id, amount: 450000, forMonth: centerMonth(), method: 'CASH' } });
  await api('POST', '/attendance', { token: a.token, body: { groupId: group.id, date: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10), entries: [{ studentId: kid.id, status: 'LATE' }] } }).catch(() => null);
  const lead = await api('POST', '/leads', { token: a.token, body: { fullName: 'A11y Lead', phone: '+998901112200', source: 'PHONE' } });
  const conv = await api('POST', '/chat/conversations', { token: a.token, body: { kind: 'STUDENT_CENTER', studentId: kid.id } });
  await api('POST', `/chat/conversations/${conv.id}/messages`, { token: a.token, body: { body: 'Salom, dars ertaga 18:00 da.', clientMessageId: `a11y-${Date.now()}` } });
  const { pin } = await api('POST', `/students/${kid.id}/portal-pin`, { token: a.token });

  const findings: string[] = [];

  // Public site, signed out.
  for (const path of ['/', '/login']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    findings.push(...(await scan(page, path)));
  }

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  const paths = [
    '/dashboard', '/students', `/students/${kid.id}`, '/groups', `/groups/${group.id}`, '/teachers',
    '/schedule', '/payments', '/reports', '/leads', `/leads/${lead.id}`, '/settings',
    '/makeups', '/calendar', '/messages', `/messages?c=${conv.id}`,
  ];
  for (const path of paths) {
    await page.goto(centerUrl(a.sub, path));
    await settle(page);
    findings.push(...(await scan(page, path)));
  }

  // The cabinet, in its own context (its own session).
  const cab = await (await browser.newContext()).newPage();
  await cab.goto(centerUrl(a.sub, '/portal'));
  await cab.getByRole('textbox').first().pressSequentially('901234500');
  await cab.getByRole('button', { name: 'Davom etish' }).click();
  await cab.getByPlaceholder('••••••').fill(String(pin));
  await cab.getByRole('button', { name: 'Kabinetga kirish' }).click();
  await expect(cab.getByText('A11y Student').first()).toBeVisible();
  await cab.waitForLoadState('networkidle');
  findings.push(...(await scan(cab, '/portal')));
  await cab.context().close();

  expect(findings, findings.join('\n')).toEqual([]);
});
