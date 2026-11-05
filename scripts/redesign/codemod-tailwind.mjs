#!/usr/bin/env node
// Third pass: Tailwind palette classes (slate-700, indigo-600, rose-50...) ->
// the semantic utilities defined on the design tokens in globals.css
// (@theme: text-fg, text-muted, bg-surface, bg-primary, border-line, text-danger...).
// Variants (hover:, md:) and opacity modifiers (/30) are kept. White/black text
// on dark fills is left as it is. Idempotent.  node scripts/redesign/codemod-tailwind.mjs [--dry]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dry = process.argv.includes('--dry');
const STATUS = {
  indigo: 'primary', rose: 'danger', red: 'danger', emerald: 'success', green: 'success',
  amber: 'warning', yellow: 'warning', orange: 'warning', sky: 'info', blue: 'info', violet: 'violet', purple: 'violet',
};
const isText = (u) => u === 'text' || u === 'placeholder' || u === 'decoration';
function semantic(util, hue, shade) {
  const n = Number(shade);
  if (hue === 'slate' || hue === 'gray' || hue === 'zinc' || hue === 'neutral') {
    if (isText(util)) {
      if (n <= 300) return null; // light text on a dark fill: keep
      if (n === 400) return 'faint';
      if (n === 500) return 'muted';
      if (n <= 700) return 'soft';
      return 'fg';
    }
    if (n <= 100) return util === 'bg' || util === 'from' || util === 'via' || util === 'to' ? 'surface-muted' : 'line';
    if (n === 200) return 'line';
    if (n <= 400) return 'line-strong';
    if (n <= 700) return util === 'bg' ? null : 'line-strong';
    return 'ink';
  }
  const base = STATUS[hue];
  if (!base) return null;
  if (isText(util)) return n >= 800 && base === 'primary' ? 'fg' : base;
  if (n <= 100) return `${base}-soft`;
  if (n <= 300) return `${base}-border`;
  return base;
}
const RE = /\b((?:[a-z-]+:)*)(bg|text|border|ring|from|to|via|fill|stroke|divide|placeholder|shadow|outline|accent|decoration)-(slate|gray|zinc|neutral|indigo|rose|red|emerald|green|amber|yellow|orange|sky|blue|violet|purple)-(\d{2,3})(\/\d+)?\b/g;
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
};
['app', 'components', 'lib'].forEach((d) => walk(path.join(ROOT, 'frontend', d)));
let total = 0;
const kept = {};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let n = 0;
  const out = src
    .replace(RE, (m, variants, util, hue, shade, alpha = '') => {
      const s = semantic(util, hue, shade);
      if (!s) {
        kept[m] = (kept[m] ?? 0) + 1;
        return m;
      }
      n++;
      return `${variants}${util}-${s}${alpha}`;
    })
    .replace(/\b((?:[a-z-]+:)*)(bg|from|via|to)-white\b/g, (m, v, u) => (n++, `${v}${u}-surface`));
  if (n) {
    total += n;
    console.log(`  ${path.relative(ROOT, f)}: ${n}`);
    if (!dry) fs.writeFileSync(f, out);
  }
}
console.log(`${dry ? 'dry-run' : 'write'}: ${total} classes`);
if (Object.keys(kept).length) console.log('kept (light text on dark fills, dark fills):', Object.keys(kept).join(' '));
