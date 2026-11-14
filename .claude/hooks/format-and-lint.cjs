#!/usr/bin/env node
// PostToolUse (Edit|Write): format and lint the file Claude just changed.
//   backend/**  (.ts .tsx .js .mjs): prettier --write, then oxlint   (run in backend/)
//   frontend/** (.ts .tsx .js .mjs): eslint --fix                     (run in frontend/)
//
// Prettier is applied only to files that are already Prettier-clean at HEAD
// (or are new). Most existing backend files are not, and reformatting a whole
// file because one line changed would bury the real change in the diff.
//
// The edit itself is never undone (PostToolUse runs after it). Lint errors
// are printed to stderr with exit 2, which shows them to Claude as feedback.
// Warnings, a skipped Prettier run, and a tool that cannot run (missing
// node_modules, timeout) are printed to stderr with exit 0.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readHookInput, normalizePath, repoRelative } = require('./lib.cjs');

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const TIMEOUT_MS = 45_000;

const input = readHookInput();
const abs = normalizePath(input && input.tool_input && input.tool_input.file_path);
if (!abs || !EXTENSIONS.has(path.extname(abs).toLowerCase()) || !fs.existsSync(abs)) process.exit(0);

const { root, rel } = repoRelative(abs);
if (!rel) process.exit(0);

const pkg = rel.startsWith('backend/') ? 'backend' : rel.startsWith('frontend/') ? 'frontend' : null;
if (!pkg) process.exit(0);
const pkgDir = path.join(root, pkg);
const inPkg = rel.slice(pkg.length + 1); // path relative to backend/ or frontend/

// npx on Windows is npx.cmd, which Node only starts through a shell.
function npx(args, opts = {}) {
  const win = process.platform === 'win32';
  const quoted = win ? args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
  return spawnSync(win ? 'npx.cmd' : 'npx', ['--no-install', ...quoted], {
    cwd: pkgDir,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    shell: win,
    ...opts,
  });
}

function out(r) {
  return `${r.stdout || ''}${r.stderr || ''}`.trim();
}

const problems = [];
const notes = [];

if (pkg === 'backend') {
  // 1. Prettier (only where the file was already formatted, see above).
  let formatOk = true; // new or untracked file
  const head = spawnSync('git', ['show', `HEAD:${rel}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (head.status === 0) {
    const check = npx(['prettier', '--no-color', '--check', '--stdin-filepath', inPkg], { input: head.stdout });
    formatOk = check.status === 0;
  }
  if (formatOk) {
    const r = npx(['prettier', '--no-color', '--write', inPkg]);
    if (r.error || r.status !== 0) notes.push(`prettier did not run cleanly on ${rel}:\n${r.error ? r.error.message : out(r)}`);
  } else {
    notes.push(`prettier skipped for ${rel}: the file is not Prettier-formatted at HEAD (formatting it would rewrite the whole file).`);
  }

  // 2. oxlint (exit 1 = lint errors; warnings alone exit 0).
  const lint = npx(['oxlint', inPkg]);
  if (lint.error) notes.push(`oxlint could not run: ${lint.error.message}`);
  else if (lint.status !== 0) problems.push(`oxlint reported errors in ${rel}:\n${out(lint)}`);
  else if (/\bwarning\b/.test(out(lint))) notes.push(`oxlint warnings in ${rel}:\n${out(lint)}`);
} else {
  const lint = npx(['eslint', '--fix', inPkg]);
  if (lint.error) notes.push(`eslint could not run: ${lint.error.message}`);
  else if (lint.status === 1) problems.push(`eslint reported errors in ${rel} (after --fix):\n${out(lint)}`);
  else if (lint.status !== 0) notes.push(`eslint exited ${lint.status} on ${rel}:\n${out(lint)}`);
  else if (/\bwarning\b/.test(out(lint))) notes.push(`eslint warnings in ${rel}:\n${out(lint)}`);
}

if (notes.length) process.stderr.write(notes.join('\n') + '\n');
if (problems.length) {
  process.stderr.write(problems.join('\n\n') + '\n');
  process.exit(2);
}
process.exit(0);
