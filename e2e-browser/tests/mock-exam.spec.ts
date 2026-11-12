import { expect, test } from '@playwright/test';
import { authSlot, api, centerUrl, cleanUpStagingCenters, newCenter } from './support';

// The IELTS mock in the cabinet: sections in the exam's order, the reading
// text highlighted and noted, and after the section
// the explanation of each answer and the score per question type.
cleanUpStagingCenters();

test('IELTS mock: order lock, highlight and note on the passage, explanations and question types after', async ({ page }) => {
  const a = await newCenter('mockexam');
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'IELTS Mock', subject: 'Ingliz tili (IELTS)', maxStudents: 10 } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Mock Student', groupIds: [group.id] } });
  await api('PATCH', `/students/${kid.id}`, { token: a.token, body: { phone: '+998935556677', parentPhone: '+998945556677' } });
  const { pin } = await api('POST', `/students/${kid.id}/portal-pin`, { token: a.token });
  const mock = await api('POST', '/mock-tests', { token: a.token, body: { sample: true, title: 'Order Mock' } });
  mock.content.reading.passages[0].questions[0].explanation = 'Paragraph A says so in its first line.';
  await api('PATCH', `/mock-tests/${mock.id}`, { token: a.token, body: { content: mock.content, status: 'PUBLISHED' } });

  await page.goto(centerUrl(a.sub, '/portal'));
  await page.getByRole('textbox').first().pressSequentially('935556677');
  await authSlot('cabinet');
  await page.getByRole('button', { name: 'Davom etish' }).click();
  await page.getByPlaceholder('••••••').fill(String(pin));
  await page.getByRole('button', { name: 'Kabinetga kirish' }).click();
  await expect(page.getByText('Mock Student').first()).toBeVisible();

  await page.getByRole('button', { name: /Mashq/ }).first().click();
  await page.getByRole('button', { name: /Boshlash/ }).first().click();
  // Reading and Writing wait for the sections before them.
  await expect(page.getByTestId('order-reading')).toContainText('Listening');
  await expect(page.getByTestId('order-writing')).toBeVisible();

  // Listening first (handed in empty).
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Boshlash/ }).first().click(); // Listening
  await page.getByRole('button', { name: /Testni boshlash/ }).click();
  await page.getByRole('button', { name: /Topshirish|Submit/ }).last().click();
  await expect(page.getByTestId('order-reading')).toHaveCount(0);

  // Reading: highlight a few words, then add a note to others.
  await page.getByRole('button', { name: /Boshlash/ }).first().click();
  await page.getByRole('button', { name: /Testni boshlash/ }).click();
  const select = (para: number, from: number, to: number) => page.evaluate(([n, s, e]) => {
    const p = document.querySelector(`[data-para="${n}"]`)!;
    const node = p.firstChild!.firstChild!;
    const r = document.createRange();
    r.setStart(node, s);
    r.setEnd(node, e);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    p.closest('section')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, [para, from, to]);
  await expect(page.locator('[data-para="1"]')).toBeVisible();
  await select(0, 0, 12);
  await page.getByRole('button', { name: /Belgilash/ }).click();
  await expect(page.locator('mark[data-hl]')).toHaveCount(1);
  await select(1, 0, 10);
  await page.getByRole('button', { name: /^📝 Izoh$/ }).click();
  await page.getByPlaceholder('Izohingiz…').fill('key idea');
  await page.getByRole('button', { name: 'Saqlash' }).click();
  await expect(page.locator('mark[data-hl]')).toHaveCount(2);
  await page.getByRole('button', { name: /Izohlar \(1\)/ }).click();
  await expect(page.getByTestId('exam-notes')).toContainText('key idea');

  await page.getByRole('button', { name: /Topshirish|Submit/ }).last().click();
  await page.getByRole('button', { name: /Natija va tahlil/ }).nth(1).click();
  await expect(page.getByTestId('explanation').first()).toContainText('Paragraph A says so');
  await expect(page.getByTestId('kind-table')).toContainText('True / False / Not Given');
});
