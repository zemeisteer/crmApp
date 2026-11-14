// Shared helpers for the project's Claude Code hooks (plain Node, no jq).
const fs = require('fs');
const path = require('path');

// The hook input arrives as JSON on stdin.
function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

// A Git Bash path (/c/Users/...) or a Windows path (C:\Users\...) -> an
// absolute path Node can use, with forward slashes.
function normalizePath(p) {
  if (typeof p !== 'string' || !p) return null;
  let s = p.trim();
  const msys = /^\/([a-zA-Z])\/(.*)$/.exec(s);
  if (process.platform === 'win32' && msys) s = `${msys[1]}:/${msys[2]}`;
  return path.resolve(s).replace(/\\/g, '/');
}

// The repository the file belongs to: the nearest parent holding `.git`
// (a directory in the main checkout, a file in a worktree). Walks up even
// when the file itself does not exist yet (Write of a new file).
function findRepoRoot(absFile) {
  let dir = path.dirname(absFile);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir.replace(/\\/g, '/');
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The file's path inside its repository, with forward slashes ("backend/src/x.ts").
function repoRelative(absFile) {
  const root = findRepoRoot(absFile);
  if (!root) return { root: null, rel: null };
  const rel = path.relative(root, absFile).replace(/\\/g, '/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { root: null, rel: null };
  return { root, rel };
}

module.exports = { readHookInput, normalizePath, findRepoRoot, repoRelative };
