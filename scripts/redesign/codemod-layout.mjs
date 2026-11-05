#!/usr/bin/env node
// Fourth pass: the staff pages' frame. Page header strips (padding 22px 32px and
// a bottom border) become var(--page-head-pad) with no border; page bodies
// (20-26px 32px) become var(--page-pad); a page's 20-22px/800 h1 becomes the
// .page-title class (globals.css). Both paddings are variables, so phones get
// their own values in one place. Idempotent.
//   node scripts/redesign/codemod-layout.mjs [--dry]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dry = process.argv.includes('--dry');
const APP = path.join(ROOT, 'frontend', 'app');
// Public pages keep their own layout.
const SKIP = [/[\\/]site[\\/]/, /[\\/]verify[\\/]/, /[\\/]portal[\\/]/, /[\\/]t[\\/]/, /[\\/]invite[\\/]/, /[\\/](login|register|forgot-password|reset-password|verify-email|privacy|terms)[\\/]/, /[\\/]app[\\/]page\.tsx$/];
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name) && !SKIP.some((r) => r.test(p))) files.push(p);
  }
};
walk(APP);
const counts = { head: 0, body: 0, title: 0 };
let touched = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let out = src
    .replace(/padding: "22px 32px", borderBottom: "1px solid var\(--border\)"/g, () => (counts.head++, 'padding: "var(--page-head-pad)"'))
    .replace(/padding: "(?:20|22|24|26)px 32px"/g, () => (counts.body++, 'padding: "var(--page-pad)"'))
    .replace(/<h1 style=\{\{ fontSize: (?:20|22), fontWeight: 800(, )?/g, (m, comma) => (counts.title++, comma ? '<h1 className="page-title" style={{ ' : '<h1 className="page-title" style={{ '))
    .replace(/<h1 className="page-title" style=\{\{ \}\}/g, '<h1 className="page-title"');
  if (out !== src) {
    touched++;
    if (!dry) fs.writeFileSync(f, out);
  }
}
console.log(`${dry ? 'dry-run' : 'write'}: ${touched} files; header strips ${counts.head}, page bodies ${counts.body}, titles ${counts.title}`);
