#!/usr/bin/env node
// Second pass of the token codemod: corner radii and the display font.
//   borderRadius: 6..8 -> var(--radius-xs), 9..11 -> --radius-sm, 12 -> --radius-md,
//   14..24 -> --radius-lg, 99/100/999 -> --radius-pill; 0..5 and "50%" stay.
//   fontFamily: "'Manrope', sans-serif" -> var(--font-display)
// Only numeric literals in style objects are changed (computed values stay).
// Idempotent; prints counts.  node scripts/redesign/codemod-shape.mjs [--dry]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dry = process.argv.includes('--dry');
const radiusToken = (n) => {
  if (n >= 6 && n <= 8) return '--radius-xs';
  if (n >= 9 && n <= 11) return '--radius-sm';
  if (n === 12 || n === 13) return '--radius-md';
  if (n >= 14 && n <= 24) return '--radius-lg';
  if (n === 99 || n === 100 || n === 999 || n === 9999) return '--radius-pill';
  return null;
};
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
  }
};
['app', 'components', 'lib'].forEach((d) => walk(path.join(ROOT, 'frontend', d)));
const counts = {};
let filesTouched = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let n = 0;
  const out = src
    .replace(/borderRadius: (\d+)(?=[,\s}])/g, (m, v) => {
      const t = radiusToken(Number(v));
      if (!t) return m;
      counts[t] = (counts[t] ?? 0) + 1;
      n++;
      return `borderRadius: "var(${t})"`;
    })
    .replace(/fontFamily: "'Manrope', ?(?:system-ui, ?)?sans-serif"/g, () => {
      counts['--font-display'] = (counts['--font-display'] ?? 0) + 1;
      n++;
      return 'fontFamily: "var(--font-display)"';
    });
  if (n) {
    filesTouched++;
    if (!dry) fs.writeFileSync(f, out);
  }
}
console.log(`${dry ? 'dry-run' : 'write'}: ${Object.values(counts).reduce((a, b) => a + b, 0)} values in ${filesTouched} files`);
for (const [t, c] of Object.entries(counts)) console.log(`  ${t.padEnd(16)} ${c}`);
