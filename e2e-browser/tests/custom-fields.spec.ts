import { expect, test, type Page } from '@playwright/test';
import { api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// Custom fields: the owner defines the center's own fields in Settings, a
// new student must answer the required one, the value is shown and edited
// on the student's page, and an archived field leaves the forms.
cleanUpStagingCenters();

type Def = { id: string; key: string; label: string; fieldType: string; required: boolean; archivedAt: string | null; studentFieldId: string | null; optionMap: Record<string, string> | null; options: Array<{ id: string; label: string; archived?: boolean }> };

async function listStudents(token: string): Promise<Array<{ id: string; fullName: string }>> {
  const list = await api<any>('GET', '/students', { token });
  return Array.isArray(list) ? list : list.items ?? list.data;
}

async function openFieldsSettings(page: Page, sub: string) {
  await page.goto(centerUrl(sub, '/settings'));
  await page.getByRole('button', { name: "Qo'shimcha maydonlar", exact: true }).click();
  await expect(page.getByRole('heading', { name: "Qo'shimcha maydonlar" })).toBeVisible();
}

test('owner defines fields in Settings; a student fills, edits and keeps them; archiving hides the field', async ({ page }) => {
  const a = await newCenter('cfields');
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);

  // --- Settings: a required single-choice student field -----------------
  await openFieldsSettings(page, a.sub);
  await expect(page.getByText("Hali maydon qo'shilmagan.")).toBeVisible();
  await page.getByRole('button', { name: "+ Maydon qo'shish" }).click();
  let editor = page.getByRole('dialog', { name: 'Yangi maydon' });
  await editor.getByLabel('Maydon nomi').fill('Daraja');
  await editor.getByLabel('Kalit').fill('daraja');
  await editor.getByRole('button', { name: /^Turi:/ }).click();
  await page.getByRole('option', { name: 'Bitta tanlov' }).click();
  await editor.getByRole('textbox', { name: '1-variant' }).fill("Boshlang'ich");
  await editor.getByRole('textbox', { name: '2-variant' }).fill("O'rta");
  await editor.getByRole('button', { name: "+ Variant qo'shish" }).click();
  await editor.getByRole('textbox', { name: '3-variant' }).fill('Yuqori');
  await editor.getByRole('checkbox', { name: /Majburiy/ }).check();
  await editor.getByRole('button', { name: 'Saqlash' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'Daraja' })).toBeVisible();

  const studentDefs = await api<Def[]>('GET', '/custom-fields?entityType=STUDENT', { token: a.token });
  expect(studentDefs).toHaveLength(1);
  const level = studentDefs[0];
  expect(level).toMatchObject({ key: 'daraja', label: 'Daraja', fieldType: 'SELECT', required: true });
  expect(level.options.map((o) => o.label)).toEqual(["Boshlang'ich", "O'rta", 'Yuqori']);
  const optionId = (label: string) => level.options.find((o) => o.label === label)!.id;

  // --- Settings: a lead field carried to the student field ---------------
  await page.getByRole('button', { name: 'Lidlar', exact: true }).click();
  await page.getByRole('button', { name: "+ Maydon qo'shish" }).click();
  editor = page.getByRole('dialog', { name: 'Yangi maydon' });
  await editor.getByLabel('Maydon nomi').fill('Kutilgan daraja');
  await editor.getByRole('button', { name: /^Turi:/ }).click();
  await page.getByRole('option', { name: 'Bitta tanlov' }).click();
  await editor.getByRole('textbox', { name: '1-variant' }).fill('Past');
  await editor.getByRole('textbox', { name: '2-variant' }).fill('Baland');
  await editor.getByRole('button', { name: /^O'quvchi maydoniga o'tkazish:/ }).click();
  await page.getByRole('option', { name: 'Daraja' }).click();
  await editor.getByRole('button', { name: /^Past →/ }).click();
  await page.getByRole('option', { name: "Boshlang'ich" }).click();
  await editor.getByRole('button', { name: /^Baland →/ }).click();
  await page.getByRole('option', { name: 'Yuqori' }).click();
  await editor.getByRole('button', { name: 'Saqlash' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'Kutilgan daraja' })).toContainText("O'quvchiga: Daraja");

  const leadDefs = await api<Def[]>('GET', '/custom-fields?entityType=LEAD', { token: a.token });
  expect(leadDefs).toHaveLength(1);
  const leadDef = leadDefs[0];
  expect(leadDef.studentFieldId).toBe(level.id);
  const leadOpt = (label: string) => leadDef.options.find((o) => o.label === label)!.id;
  expect(leadDef.optionMap).toEqual({ [leadOpt('Past')]: optionId("Boshlang'ich"), [leadOpt('Baland')]: optionId('Yuqori') });

  // --- A new student must answer the required field ----------------------
  await page.goto(centerUrl(a.sub, '/students'));
  await page.getByRole('button', { name: "+ Yangi o'quvchi" }).click();
  let dialog = page.getByRole('dialog', { name: "Yangi o'quvchi" });
  await dialog.getByRole('group', { name: "To'liq ism" }).getByRole('textbox').fill('Field Student');
  const add = dialog.getByRole('button', { name: "O'quvchini qo'shish" });
  await add.click();
  const levelGroup = dialog.getByRole('group', { name: /^Daraja/ });
  await expect(levelGroup.getByRole('alert')).toHaveText("To'ldirilishi shart.");
  await expect(dialog).toBeVisible();
  expect(await listStudents(a.token)).toHaveLength(0);

  await levelGroup.getByRole('button', { name: /^Daraja:/ }).click();
  await page.getByRole('option', { name: "O'rta" }).click();
  await expect(levelGroup.getByRole('alert')).toHaveCount(0);
  await add.click();
  await expect(dialog).toHaveCount(0);

  const student = (await listStudents(a.token)).find((s) => s.fullName === 'Field Student')!;
  expect(student).toBeTruthy();
  expect((await api('GET', `/students/${student.id}`, { token: a.token })).customFields).toEqual({ [level.id]: optionId("O'rta") });

  // --- The student's page shows the value; editing it persists -----------
  await page.goto(centerUrl(a.sub, `/students/${student.id}`));
  const section = page.getByRole('region', { name: "Qo'shimcha ma'lumotlar" });
  await expect(section).toContainText('Daraja');
  await expect(section).toContainText("O'rta");
  await section.getByRole('button', { name: "Tahrirlash: Qo'shimcha ma'lumotlar" }).click();
  dialog = page.getByRole('dialog', { name: "Qo'shimcha ma'lumotlarni tahrirlash" });
  await dialog.getByRole('button', { name: /^Daraja:/ }).click();
  await page.getByRole('option', { name: 'Yuqori' }).click();
  await dialog.getByRole('button', { name: 'Saqlash' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(section).toContainText('Yuqori');

  await page.reload();
  await expect(page.getByRole('region', { name: "Qo'shimcha ma'lumotlar" })).toContainText('Yuqori');
  expect((await api('GET', `/students/${student.id}`, { token: a.token })).customFields).toEqual({ [level.id]: optionId('Yuqori') });

  // --- Archived in Settings: gone from the form, value kept --------------
  await openFieldsSettings(page, a.sub);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Arxivlash: Daraja' }).click();
  await expect(page.getByRole('heading', { name: 'Arxivlangan maydonlar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Qaytarish: Daraja' })).toBeVisible();
  const after = await api<Def[]>('GET', '/custom-fields?entityType=STUDENT&includeArchived=1', { token: a.token });
  expect(after.find((d) => d.id === level.id)!.archivedAt).toBeTruthy();

  await page.goto(centerUrl(a.sub, '/students'));
  await page.getByRole('button', { name: "+ Yangi o'quvchi" }).click();
  dialog = page.getByRole('dialog', { name: "Yangi o'quvchi" });
  await expect(dialog.getByRole('group', { name: "To'liq ism" })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(dialog.getByText('Daraja')).toHaveCount(0);
  await dialog.getByRole('group', { name: "To'liq ism" }).getByRole('textbox').fill('No Field Student');
  await dialog.getByRole('button', { name: "O'quvchini qo'shish" }).click();
  await expect(dialog).toHaveCount(0);

  // The student who answered it still shows the value, among archived fields.
  await page.goto(centerUrl(a.sub, `/students/${student.id}`));
  const kept = page.getByRole('region', { name: "Qo'shimcha ma'lumotlar" });
  await expect(kept).toContainText('Arxivlangan maydonlar');
  await expect(kept).toContainText('Yuqori');
});

test("a lead's field is edited on the lead and carried into the student when converted", async ({ page }) => {
  const a = await newCenter('cfconvert');
  const level = await api<Def>('POST', '/custom-fields', { token: a.token, body: { entityType: 'STUDENT', label: 'Daraja', fieldType: 'SELECT', required: true, options: [{ label: 'Past' }, { label: 'Yuqori' }] } });
  const school = await api<Def>('POST', '/custom-fields', { token: a.token, body: { entityType: 'STUDENT', label: 'Maktab', fieldType: 'TEXT' } });
  const wish = await api<Def>('POST', '/custom-fields', { token: a.token, body: { entityType: 'LEAD', label: 'Kutilgan daraja', fieldType: 'SELECT', options: [{ label: 'Oddiy' }, { label: 'Kuchli' }], studentFieldId: level.id } });
  const opt = (d: Def, label: string) => d.options.find((o) => o.label === label)!.id;
  await api('PATCH', `/custom-fields/${wish.id}`, { token: a.token, body: { optionMap: { [opt(wish, 'Oddiy')]: opt(level, 'Past'), [opt(wish, 'Kuchli')]: opt(level, 'Yuqori') } } });

  const lead = await api('POST', '/leads', { token: a.token, body: { fullName: 'Carry Lead', phone: '+998901112255', source: 'PHONE' } });
  await api('POST', `/leads/${lead.id}/transition`, { token: a.token, body: { toStatus: 'CONTACTED' } });
  const trial = await api('POST', `/leads/${lead.id}/trials`, { token: a.token, body: { scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString() } });
  await api('POST', `/leads/${lead.id}/trials/${trial.id}/attend`, { token: a.token, body: {} });
  await api('POST', `/leads/${lead.id}/transition`, { token: a.token, body: { toStatus: 'QUALIFIED' } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, `/leads/${lead.id}`));

  // The lead's own field, through the lead's edit form.
  await page.getByRole('button', { name: 'Tahrirlash', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Lidni tahrirlash' });
  await dialog.getByRole('button', { name: /^Kutilgan daraja:/ }).click();
  await page.getByRole('option', { name: 'Kuchli' }).click();
  await dialog.getByRole('button', { name: 'Saqlash' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: "Qo'shimcha ma'lumotlar" })).toContainText('Kuchli');
  expect((await api('GET', `/leads/${lead.id}`, { token: a.token })).customFields).toEqual({ [wish.id]: opt(wish, 'Kuchli') });

  // The wizard shows the carried value and sends only what the user typed.
  await page.getByRole('button', { name: "O'quvchiga aylantirish" }).click();
  dialog = page.getByRole('dialog', { name: "O'quvchiga aylantirish" });
  const next = dialog.getByRole('button', { name: 'Keyingi' });
  await next.click();
  await next.click();
  const levelGroup = dialog.getByRole('group', { name: /^Daraja/ });
  await expect(levelGroup).toContainText('Liddan');
  await expect(levelGroup.getByRole('button', { name: 'Daraja: Yuqori' })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Maktab' }).fill('12-maktab');
  await next.click();
  await next.click();
  await next.click();
  await expect(dialog).toContainText('12-maktab');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/leads/${lead.id}/convert`));
  await dialog.getByRole('button', { name: 'Tasdiqlash va aylantirish' }).click();
  expect((await sent).postDataJSON().customFields).toEqual({ [school.id]: '12-maktab' });
  await expect(page).toHaveURL(/\/students\/[a-z0-9]+$/);
  const studentId = page.url().split('/').pop()!;
  expect((await api('GET', `/students/${studentId}`, { token: a.token })).customFields).toEqual({ [level.id]: opt(level, 'Yuqori'), [school.id]: '12-maktab' });
  await expect(page.getByRole('region', { name: "Qo'shimcha ma'lumotlar" })).toContainText('Yuqori');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the custom-field screens fit a 390 px screen', async ({ page }) => {
    const a = await newCenter('cfmobile');
    const school = await api<Def>('POST', '/custom-fields', { token: a.token, body: { entityType: 'STUDENT', label: 'Maktab nomi va manzili (toʻliq)', fieldType: 'TEXT', required: true, portalVisible: true } });
    await api('POST', '/custom-fields', { token: a.token, body: { entityType: 'STUDENT', label: 'Qiziqishlar', fieldType: 'MULTI_SELECT', options: [{ label: 'Matematika' }, { label: 'Ingliz tili' }, { label: 'Dasturlash' }] } });
    const consent = await api<Def>('POST', '/custom-fields', { token: a.token, body: { entityType: 'STUDENT', label: 'Ota-onasi rozi', fieldType: 'BOOLEAN', required: true } });
    const kid = await api<{ id: string }>('POST', '/students', {
      token: a.token,
      body: { fullName: 'Phone Student', customFields: { [school.id]: '45-maktab, Chilonzor tumani, Toshkent shahri', [consent.id]: false } },
    });

    await loginOnMainSite(page, a.email);
    await expectCenterDashboard(page, a.sub);

    const overflow = () =>
      page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const out: string[] = [];
        if (document.documentElement.scrollWidth > vw) out.push(`page is ${document.documentElement.scrollWidth}px wide`);
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= vw + 1) continue;
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

    await openFieldsSettings(page, a.sub);
    await expect(page.getByRole('listitem').filter({ hasText: 'Qiziqishlar' })).toBeVisible();
    expect(await overflow()).toEqual([]);
    await page.getByRole('button', { name: "+ Maydon qo'shish" }).click();
    const editor = page.getByRole('dialog', { name: 'Yangi maydon' });
    await editor.getByRole('button', { name: /^Turi:/ }).click();
    await page.getByRole('option', { name: 'Bitta tanlov' }).click();
    await expect(editor.getByRole('textbox', { name: '2-variant' })).toBeVisible();
    expect(await overflow()).toEqual([]);
    await editor.getByRole('button', { name: 'Bekor qilish' }).click();

    await page.goto(centerUrl(a.sub, '/students'));
    await page.getByRole('button', { name: "+ Yangi o'quvchi" }).click();
    const dialog = page.getByRole('dialog', { name: "Yangi o'quvchi" });
    await expect(dialog.getByRole('radiogroup', { name: /Ota-onasi rozi/ })).toBeVisible();
    expect(await overflow()).toEqual([]);
    // The dialog scrolls: its last control can be reached.
    await dialog.getByRole('button', { name: "O'quvchini qo'shish" }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: "O'quvchini qo'shish" })).toBeInViewport();
    await page.keyboard.press('Escape');

    await page.goto(centerUrl(a.sub, `/students/${kid.id}`));
    await expect(page.getByRole('region', { name: "Qo'shimcha ma'lumotlar" })).toContainText('45-maktab');
    expect(await overflow()).toEqual([]);
    await page.getByRole('button', { name: "Tahrirlash: Qo'shimcha ma'lumotlar" }).click();
    await expect(page.getByRole('dialog', { name: "Qo'shimcha ma'lumotlarni tahrirlash" })).toBeVisible();
    expect(await overflow()).toEqual([]);
  });
});
