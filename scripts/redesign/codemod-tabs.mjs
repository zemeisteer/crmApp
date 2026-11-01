#!/usr/bin/env node
// Fifth pass: segmented tab buttons (the active one white with a small shadow
// on a gray track) become the design system's black pill tabs: the same
// condition paints the active tab ink with --on-ink text, pill corners, no
// shadow. Found by the shared shadow value. Idempotent.
//   node scripts/redesign/codemod-tabs.mjs [--dry]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dry = process.argv.includes('--dry');
const SHADOW = /boxShadow: ([^,\n]+?) \? "0 1px 3px rgba\(18,19,26,0\.08\)" : "none"/;
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
};
['app', 'components'].forEach((d) => walk(path.join(ROOT, 'frontend', d)));
let tabs = 0;
let tracks = 0;
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  const before = s;
  for (;;) {
    const m = SHADOW.exec(s);
    if (!m) break;
    const cond = m[1].trim();
    // The style object around it: from the nearest "style={{" before to the "}}" after.
    const start = s.lastIndexOf('style={{', m.index);
    const end = s.indexOf('}}', m.index);
    let obj = s.slice(start, end);
    const esc = cond.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    obj = obj
      .replace(new RegExp(`background: ${esc} \\? "var\\(--surface\\)"`), `background: ${cond} ? "var(--ink)"`)
      .replace(new RegExp(`color: ${esc} \\? "var\\(--text\\)"`), `color: ${cond} ? "var(--on-ink)"`)
      .replace(SHADOW, 'boxShadow: "none"')
      .replace(/borderRadius: "var\(--radius-(?:xs|sm)\)"/, 'borderRadius: "var(--radius-pill)"');
    s = s.slice(0, start) + obj + s.slice(end);
    tabs++;
  }
  // Their tracks: a muted fill with small corners and 3-4px padding becomes a white pill with a hairline.
  s = s.replace(/background: "var\(--surface-muted\)", borderRadius: "var\(--radius-(?:xs|sm)\)", padding: ([34])/g, (m, pad) => (tracks++, `background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: ${pad}`));
  if (s !== before && !dry) fs.writeFileSync(f, s);
}
console.log(`${dry ? 'dry-run' : 'write'}: ${tabs} tabs, ${tracks} tracks`);
