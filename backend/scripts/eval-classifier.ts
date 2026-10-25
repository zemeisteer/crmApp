// Measures a message classifier on real, labelled messages before anything
// is switched on. Prints accuracy, accuracy of the confident answers only
// (above the threshold) and how many those are, per-option precision and
// recall, and the confusion matrix.
//
//   npx tsx scripts/eval-classifier.ts messages.csv --provider strands
//   npx tsx scripts/eval-classifier.ts messages.csv --provider gemini
//   npx tsx scripts/eval-classifier.ts messages.csv --provider strands --raw   (prints the service's first raw answer)
//
// The CSV has a header row with `text` and `label` columns (other columns
// are ignored); quotes and commas inside quoted text are fine. Labels are
// the option keys: payment, price, schedule, complaint, other.
// Settings come from backend/.env (CLASSIFIER_*), and the Gemini key also
// from the platform admin panel, as the server reads them.
import * as dotenv from 'dotenv';
dotenv.config();
import { readFileSync } from 'fs';
import { MESSAGE_OPTIONS, type MessageClassifier } from '../src/classifier/classifier.types';
import { classifierConfig, makeClassifier } from '../src/classifier/classifier.service';
import { strandsRequest } from '../src/classifier/strands.classifier';
import { loadStoredSettingsAtBoot } from '../src/platform/stored-settings';

/** RFC 4180-ish: quoted fields, doubled quotes, commas and new lines inside quotes. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = input.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('Usage: npx tsx scripts/eval-classifier.ts <messages.csv> --provider strands|gemini [--limit N] [--raw]');
    process.exit(2);
  }
  await loadStoredSettingsAtBoot();
  const provider = arg('provider');
  if (provider) process.env.CLASSIFIER_PROVIDER = provider;
  const get = (k: string) => process.env[k];
  const cfg = classifierConfig(get);
  const classifier: MessageClassifier | null = makeClassifier(get);
  if (!classifier) {
    console.error('No classifier: pass --provider strands or --provider gemini (or set CLASSIFIER_PROVIDER).');
    process.exit(2);
  }

  const [header, ...body] = parseCsv(readFileSync(file, 'utf8'));
  const ti = header.findIndex((h) => h.trim().toLowerCase() === 'text');
  const li = header.findIndex((h) => h.trim().toLowerCase() === 'label');
  if (ti < 0 || li < 0) {
    console.error('The CSV needs a header row with "text" and "label" columns.');
    process.exit(2);
  }
  const limit = Number(arg('limit')) || Infinity;
  const samples = body.map((r) => ({ text: (r[ti] ?? '').trim(), label: (r[li] ?? '').trim().toLowerCase() })).filter((s) => s.text).slice(0, limit);
  const badLabels = [...new Set(samples.map((s) => s.label).filter((l) => !(l in MESSAGE_OPTIONS)))];
  if (badLabels.length) {
    console.error(`Unknown labels in the CSV: ${badLabels.join(', ')}. Use: ${Object.keys(MESSAGE_OPTIONS).join(', ')}`);
    process.exit(2);
  }

  if (process.argv.includes('--raw') && classifier.provider === 'strands' && samples[0]) {
    // The exact reply of the running service, to check the client reads it right.
    const res = await fetch(`${cfg.strandsUrl.replace(/\/+$/, '')}/v1/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(strandsRequest({ text: samples[0].text, options: MESSAGE_OPTIONS })),
    });
    console.log(`Raw answer (HTTP ${res.status}):\n${JSON.stringify(await res.json().catch(() => null), null, 2)}\n`);
  }

  console.log(`Classifier: ${classifier.provider} · ${classifier.modelVersion} · threshold ${cfg.threshold} · ${samples.length} message(s)\n`);
  const keys = Object.keys(MESSAGE_OPTIONS);
  const cols = [...keys, 'none'];
  const matrix = Object.fromEntries(keys.map((k) => [k, Object.fromEntries(cols.map((c) => [c, 0]))])) as Record<string, Record<string, number>>;
  let correct = 0;
  let confident = 0;
  let confidentCorrect = 0;
  let failed = 0;
  let latency = 0;
  for (const s of samples) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    const started = Date.now();
    let guess = 'none';
    try {
      const r = await classifier.classify({ text: s.text, options: MESSAGE_OPTIONS }, ctrl.signal);
      guess = r.choice;
      if (r.choice === s.label) correct++;
      if (r.probability >= cfg.threshold) {
        confident++;
        if (r.choice === s.label) confidentCorrect++;
      }
    } catch (err) {
      failed++;
      if (failed <= 3) console.log(`  ! ${(err as Error).message} — "${s.text.slice(0, 60)}"`);
    } finally {
      clearTimeout(timer);
      latency += Date.now() - started;
    }
    matrix[s.label][guess]++;
  }

  const n = samples.length;
  console.log(`Accuracy:                 ${pct(n ? correct / n : null)}  (${correct}/${n})`);
  console.log(`Confident answers:        ${confident}/${n} (${pct(n ? confident / n : null)}) — accuracy among them: ${pct(confident ? confidentCorrect / confident : null)}`);
  console.log(`Needs a person:           ${n - confident} (below the threshold, failed or timed out)`);
  console.log(`Failed / timed out:       ${failed}`);
  console.log(`Average latency:          ${n ? Math.round(latency / n) : 0} ms\n`);

  console.log('Per option        precision   recall   count');
  for (const k of keys) {
    const tp = matrix[k][k];
    const predicted = keys.reduce((s, t) => s + matrix[t][k], 0);
    const actual = cols.reduce((s, c) => s + matrix[k][c], 0);
    console.log(`  ${k.padEnd(14)}  ${pct(predicted ? tp / predicted : null).padStart(9)}  ${pct(actual ? tp / actual : null).padStart(7)}   ${actual}`);
  }

  console.log('\nConfusion matrix (rows: correct label, columns: model):');
  console.log(['', ...cols].map((c) => c.padStart(10)).join(''));
  for (const k of keys) console.log([k, ...cols.map((c) => String(matrix[k][c]))].map((c) => c.padStart(10)).join(''));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
