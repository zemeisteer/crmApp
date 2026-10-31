#!/usr/bin/env node
// Fails when raw hex colors are added to the frontend outside the allowlist.
// Colors belong in tokens (frontend/app/globals.css, docs/DESIGN_SYSTEM.md).
// The genuine one-offs that remain (other companies' brand colors, print-only
// HTML, a center's chosen color, chart palettes) are counted per file in
// raw-colors-baseline.json; a file may have that many and no more.
//
//   node scripts/redesign/check-no-raw-colors.mjs            check (exit 1 on new colors)
//   node scripts/redesign/check-no-raw-colors.mjs --update   rewrite the baseline (after review)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ALLOWED_RAW } from './color-map.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BASELINE = path.join(HERE, 'raw-colors-baseline.json');
const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F\w])/g;

const counts = {};
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (rel === 'frontend/app/globals.css') continue; // where the tokens are defined
      if (ALLOWED_RAW.some((a) => rel.startsWith(a))) continue;
      // %23 inside data: URLs is not matched; comments count too (keep them token-free).
      const n = (fs.readFileSync(p, 'utf8').match(HEX) ?? []).length;
      if (n) counts[rel] = n;
    }
  }
};
['app', 'components', 'lib'].forEach((d) => walk(path.join(ROOT, 'frontend', d)));

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2) + '\n');
  console.log(`baseline: ${Object.values(counts).reduce((a, b) => a + b, 0)} raw colors in ${Object.keys(counts).length} files`);
  process.exit(0);
}
const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const over = Object.entries(counts).filter(([f, n]) => n > (base[f] ?? 0));
if (over.length) {
  console.error('New raw hex colors (use a token from frontend/app/globals.css instead):');
  for (const [f, n] of over) console.error(`  ${f}: ${n} (allowed ${base[f] ?? 0})`);
  process.exit(1);
}
console.log(`ok: ${Object.values(counts).reduce((a, b) => a + b, 0)} raw colors, none new`);
