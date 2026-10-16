import { expect, test, type Page, type Route } from '@playwright/test';
import { api, apiLogin, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, TARGET } from './support';

// The tariff form translates the Uzbek feature list into Russian and English.
// The translator's answers are held here and let go one by one, late and in
// the reverse order, as a slow translator gives them: an answer belongs to the
// Uzbek text and the edit window it was asked for, and never replaces what the
// admin typed meanwhile; what is saved is one version of all three lists.
cleanUpStagingCenters();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const env = TARGET === 'local' ? (require('../scripts/env.cjs') as { db: { url: string }; backendRequire: NodeRequire }) : null;
async function promote(email: string) {
  const { Client } = env!.backendRequire('pg') as typeof import('pg');
  const client = new Client({ connectionString: env!.db.url });
  await client.connect();
  try {
    expect((await client.query(`update users set role = 'SUPERADMIN' where email = $1`, [email])).rowCount).toBe(1);
  } finally {
    await client.end();
  }
}

type Held = { text: string; route: Route; origin: string };

/** Holds every translation request until the test answers it. */
async function holdTranslations(page: Page) {
  const held: Held[] = [];
  await page.route('**/api/plans/translate', async (route) => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? '*';
    const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    held.push({ text: (req.postDataJSON() as { features: string }).features, route, origin });
  });
  const answer = async (h: Held) => h.route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': h.origin, 'Access-Control-Allow-Credentials': 'true' },
    body: JSON.stringify({ featuresRu: `RU ${h.text}`, featuresEn: `EN ${h.text}`, provider: 'google' }),
  });
  /** Waits until a request for `text` is held, and returns it. */
  const next = async (text: string) => {
    await expect.poll(() => held.some((h) => h.text === text), { timeout: 10_000 }).toBe(true);
    return held.splice(held.findIndex((h) => h.text === text), 1)[0];
  };
  return { held, answer, next };
}

test('tariff translations: late and reversed answers, typing meanwhile, a closed window, a cleared text, and save', async ({ page }) => {
  test.skip(TARGET !== 'local', 'needs the disposable local database');
  const admin = await newCenter('prtr');
  await promote(admin.email);
  await loginOnMainSite(page, admin.email);
  await expectCenterDashboard(page, admin.sub);
  const t = await holdTranslations(page);
  await page.goto(centerUrl(admin.sub, '/pricing'));

  const dialog = page.getByRole('dialog', { name: 'Yangi tarif' });
  const uz = dialog.getByLabel(/^Imkoniyatlar \(har birini/);
  const ru = dialog.getByLabel(/^Imkoniyatlar ruscha/);
  const en = dialog.getByLabel(/^Imkoniyatlar inglizcha/);
  await page.getByRole('button', { name: "+ Yangi tarif qo'shish" }).click();
  await expect(dialog).toBeVisible();

  // 1. Two versions of the Uzbek text; the answers come back newest first.
  await uz.fill('Cheksiz guruh');
  const first = await t.next('Cheksiz guruh');
  await uz.fill('Cheksiz guruh\nAI tahlil');
  const second = await t.next('Cheksiz guruh\nAI tahlil');
  await t.answer(second);
  await expect(ru).toHaveValue('RU Cheksiz guruh\nAI tahlil');
  await t.answer(first); // late, for an older text: changes nothing
  await page.waitForTimeout(300);
  await expect(ru).toHaveValue('RU Cheksiz guruh\nAI tahlil');
  await expect(en).toHaveValue('EN Cheksiz guruh\nAI tahlil');

  // 2. The admin types the Russian list while an answer is on its way: theirs stays.
  await uz.fill('SMS xabarlar');
  const third = await t.next('SMS xabarlar');
  await ru.fill("Qo'lda: SMS-рассылки");
  await t.answer(third);
  await expect(en).toHaveValue('EN SMS xabarlar');
  await expect(ru).toHaveValue("Qo'lda: SMS-рассылки");

  // 3. The Uzbek text is cleared before the answer: it changes nothing.
  await uz.fill('Telegram bot');
  const fourth = await t.next('Telegram bot');
  await uz.fill('');
  await t.answer(fourth);
  await page.waitForTimeout(300);
  await expect(en).toHaveValue('EN SMS xabarlar');

  // 4. The window is closed with an answer on its way; the next window is not touched by it.
  await uz.fill('Filiallar');
  const fifth = await t.next('Filiallar');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: "+ Yangi tarif qo'shish" }).click();
  await expect(uz).toHaveValue('');
  await t.answer(fifth);
  await page.waitForTimeout(300);
  await expect(ru).toHaveValue('');
  await expect(en).toHaveValue('');

  // 5. Save right after changing the Uzbek text: the lists saved are for this text,
  //    not the translation of the one before it; the hand-typed one is kept.
  const key = `PRTR${Date.now() % 100000}`;
  await dialog.getByPlaceholder('GOLD', { exact: true }).fill(key);
  await dialog.getByPlaceholder('Gold', { exact: true }).fill('Tarjima sinovi');
  await dialog.getByPlaceholder('900000').fill('100000');
  await uz.fill('Hisobotlar');
  await t.answer(await t.next('Hisobotlar'));
  await expect(ru).toHaveValue('RU Hisobotlar');
  await en.fill('Reports (by hand)');
  await uz.fill('Hisobotlar\nEksport'); // and Save at once, before the automatic translation
  await dialog.getByRole('button', { name: 'Saqlash' }).click();
  const forSave = await t.next('Hisobotlar\nEksport');
  await page.waitForTimeout(500); // the save waits for its translation
  await t.answer(forSave);
  // An automatic request for the same text, if one went out too, answers into nothing.
  for (const h of t.held.splice(0)) await t.answer(h);
  await expect(dialog).toBeHidden();

  const token = await apiLogin(admin.email);
  const saved = (await api<Array<{ key: string; features: string; featuresRu: string; featuresEn: string }>>('GET', '/plans', { token })).find((p) => p.key === key);
  expect(saved).toMatchObject({ features: 'Hisobotlar\nEksport', featuresRu: 'RU Hisobotlar\nEksport', featuresEn: 'Reports (by hand)' });
});
