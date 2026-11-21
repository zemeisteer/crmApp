#!/usr/bin/env node
// PreToolUse (Edit|Write): refuse edits to files that must not be changed by hand.
//   - .env* files (templates ending in .example are allowed)
//   - any package-lock.json (npm writes it, not an editor)
//   - backend/backups/** (database dumps)
//   - backend/drizzle/*.sql migrations already listed in meta/_journal.json and
//     committed (applied migrations are history; write a new migration instead)
// Exit 2 blocks the tool call and shows the reason (stderr) to Claude.
// Anything unexpected (bad input, unreadable journal) lets the edit through.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readHookInput, normalizePath, repoRelative } = require('./lib.cjs');

function block(reason) {
  process.stderr.write(`Blocked by .claude/hooks/guard-protected-files.cjs: ${reason}\n`);
  process.exit(2);
}

const input = readHookInput();
const abs = normalizePath(input && input.tool_input && input.tool_input.file_path);
if (!abs) process.exit(0);

const base = path.basename(abs);

if (/^\.env/i.test(base) && !/\.example$/i.test(base)) {
  block(`${base} holds local secrets and is not edited by Claude. Change the matching *.example template instead, or ask the user to edit ${base} themselves.`);
}

if (base === 'package-lock.json') {
  block('package-lock.json is written by npm. Change package.json and run npm install (backend: npm install --legacy-peer-deps) instead.');
}

const { root, rel } = repoRelative(abs);
if (!rel) process.exit(0);

if (rel === 'backend/backups' || rel.startsWith('backend/backups/')) {
  block(`${rel} is a database backup. Backups are made by npm run db:backup and are never edited.`);
}

const migration = /^backend\/drizzle\/([^/]+)\.sql$/.exec(rel);
if (migration) {
  const tag = migration[1];
  let entries = [];
  try {
    const journal = JSON.parse(fs.readFileSync(path.join(root, 'backend/drizzle/meta/_journal.json'), 'utf8'));
    entries = Array.isArray(journal.entries) ? journal.entries : [];
  } catch {
    process.exit(0);
  }
  // A migration drizzle-kit just generated is in the journal at once but not
  // committed yet: it may still be reviewed and fixed. Committed = protected.
  const committed = spawnSync('git', ['cat-file', '-e', `HEAD:${rel}`], { cwd: root }).status === 0;
  if (committed && entries.some((e) => e && e.tag === tag)) {
    block(`${rel} is listed in backend/drizzle/meta/_journal.json, so it may already be applied on staging/production. Do not edit applied migrations: change backend/src/db/schema.ts and generate a new one (npm run db:generate), or write a new follow-up migration.`);
  }
}

process.exit(0);
