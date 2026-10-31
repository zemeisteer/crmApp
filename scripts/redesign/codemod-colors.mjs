#!/usr/bin/env node
// Replaces the frontend's recurring raw hex colors with design tokens
// (var(--token), defined in frontend/app/globals.css). Which token depends on
// the color and, for a few colors, on where it is used (text, background,
// border): see color-map.mjs.
//
//   node scripts/redesign/codemod-colors.mjs           rewrite files, print a report
//   node scripts/redesign/codemod-colors.mjs --dry     report only
//   node scripts/redesign/codemod-colors.mjs --json    report as JSON
//
// Idempotent: a second run finds nothing to change. Colors not in the map are
// left as they are and listed for review. Never touched: values that are data
// (a center's chosen brand color), stand-alone HTML for print windows, tests.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { COLOR_MAP } from './color-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = path.join(ROOT, 'frontend');
const DIRS = ['app', 'components', 'lib'];
const SKIP_FILES = [/\.test\.tsx?$/, /lib[\\/]print-test\.ts$/];
// Lines whose colors are data, not styling (saved to the server, chosen by a center).
const SKIP_LINES = [/accentColor/, /BRAND_COLORS/];
const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F\w])/g;

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');

function kindOf(prefix) {
  if (/\b(?:fill|stroke|stopColor|color|floodColor|bg)=["'{]*$/.test(prefix)) return 'any';
  const keys = [...prefix.matchAll(/([A-Za-z][A-Za-z0-9-]*)\s*:(?!:)/g)];
  if (!keys.length) return 'any';
  const k = keys[keys.length - 1][1].toLowerCase();
  if (k === 'color' || k === 'fg' || k === 'text' || k === 'caretcolor' || k === 'textdecorationcolor') return 'text';
  if (k.startsWith('background') || k === 'bg') return 'bg';
  if (k.startsWith('border') || k.startsWith('outline') || k === 'boxshadow' || k === 'box-shadow') return 'border';
  return 'any';
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?)$/.test(e.name) && !SKIP_FILES.some((r) => r.test(p))) out.push(p);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(FRONTEND, d), []));
const perToken = {};
const touched = {};
const unknown = {};
const alphaWarnings = [];
let replaced = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  let changed = 0;
  const outLines = lines.map((line, i) => {
    // A color concatenated with an alpha suffix (`${c}33`) cannot be a var(): flag it.
    if (/\$\{[^}]+\}[0-9A-Fa-f]{2}["'`]/.test(line)) alphaWarnings.push(`${rel}:${i + 1}`);
    if (SKIP_LINES.some((r) => r.test(line))) return line;
    return line.replace(HEX, (hex, offset) => {
      const key = hex.toUpperCase();
      const entry = COLOR_MAP[key];
      if (!entry) {
        (unknown[key] ??= new Set()).add(rel);
        return hex;
      }
      const token = entry[kindOf(line.slice(0, offset))] ?? entry.token;
      perToken[token] = (perToken[token] ?? 0) + 1;
      changed++;
      return `var(${token})`;
    });
  });
  if (changed) {
    touched[rel] = changed;
    replaced += changed;
    if (!dry) fs.writeFileSync(file, outLines.join('\n'));
  }
}

const report = {
  mode: dry ? 'dry-run' : 'write',
  filesScanned: files.length,
  filesTouched: Object.keys(touched).length,
  colorsReplaced: replaced,
  perToken: Object.fromEntries(Object.entries(perToken).sort((a, b) => b[1] - a[1])),
  unknownColors: Object.fromEntries(Object.entries(unknown).map(([k, v]) => [k, [...v]])),
  alphaSuffixToReview: alphaWarnings,
  touched,
};
if (args.has('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`${report.mode}: ${replaced} colors replaced in ${report.filesTouched} of ${files.length} files`);
  console.log('\nPer token:');
  for (const [t, n] of Object.entries(report.perToken)) console.log(`  ${t.padEnd(18)} ${n}`);
  console.log(`\nLeft as they are (not in the map), ${Object.keys(unknown).length} colors:`);
  for (const [c, fs_] of Object.entries(report.unknownColors)) console.log(`  ${c}  ${fs_.join(', ')}`);
  if (alphaWarnings.length) console.log(`\nColor + alpha suffix (needs color-mix by hand):\n  ${alphaWarnings.join('\n  ')}`);
}
