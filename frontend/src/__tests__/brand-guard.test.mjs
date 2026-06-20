// Phase-1 B0 — CI brand-guard.
//
// The LIVE Forge brand is MONOCHROME: no chromatic accent anywhere on the
// platform (per the V3/V4 redesign + Studio redesign mandates). This guard
// fails if the dead UI generations or their off-brand tokens reappear in the
// LIVE tree.
//
// Two assertions:
//   (1) No file under  frontend/src/forge-v4/  contains the blue accent hex
//       #4a90d9 (case-insensitive) or the legacy CSS var var(--bg-secondary).
//       forge-v4 IS the live shell (main.jsx -> App.jsx -> ForgeShellV4), so
//       scoping here keeps the guard GREEN today while still firing the
//       instant an off-brand token is re-introduced into live UI. The
//       orphaned files that STILL carry #4a90d9 live OUTSIDE forge-v4
//       (src/components/*, src/styles/*) and are intentionally out of scope
//       until they are deleted.
//   (2) The dead stylesheets  src/styles/index.css  and
//       src/forge-app/styles.css  are NOT imported by any LIVE file under
//       frontend/src. The only remaining importer of forge-app/styles.css is
//       forge-app/ForgeApp.jsx — itself part of the dead forge-app/
//       generation (NOT reachable from main.jsx -> App.jsx). A self-import
//       from inside the dead forge-app/ tree is the orphan referencing
//       itself, not a live-tree regression, so the dead forge-app/ tree is
//       excluded from the import scan (mirroring the scoping in assertion 1).
//       A regression = ANY file outside forge-app/ importing either sheet.
//
// Node built-ins only. No npm dependencies.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_ROOT = join(__dirname, '..');           // frontend/src
const FORGE_V4 = join(SRC_ROOT, 'forge-v4');
const DEAD_FORGE_APP = join(SRC_ROOT, 'forge-app'); // dead generation, excluded from import scan

// ── Banned tokens for assertion (1) ────────────────────────────────────────
const BANNED_TOKENS = [
  { label: 'blue accent hex #4a90d9', re: /#4a90d9/i },
  { label: 'legacy var(--bg-secondary)', re: /var\(--bg-secondary\)/ },
];

// ── Dead stylesheets for assertion (2) ─────────────────────────────────────
// Matched by basename + parent-dir so we catch any relative spelling
// (./styles.css, ../styles/index.css, etc.).
const DEAD_SHEETS = [
  { label: 'styles/index.css', file: 'index.css', parentDir: 'styles' },
  { label: 'forge-app/styles.css', file: 'styles.css', parentDir: 'forge-app' },
];

// import / require of a *.css path, capturing the quoted specifier.
const CSS_IMPORT_RE =
  /(?:import\s+[^'"]*['"]([^'"]+\.css)['"])|(?:require\(\s*['"]([^'"]+\.css)['"]\s*\))/g;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '__tests__']);
const SCANNED_EXT = /\.(jsx?|mjs|cjs|tsx?|css)$/i;

/** Recursively collect scannable files under `dir`. */
function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      collectFiles(full, out);
    } else if (SCANNED_EXT.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Path is inside `root` (or equal to it). */
function isUnder(path, root) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep + '..'));
}

const failures = [];

// ── Assertion (1): no banned tokens under forge-v4/ ────────────────────────
for (const file of collectFiles(FORGE_V4)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const { label, re } of BANNED_TOKENS) {
    lines.forEach((line, i) => {
      if (re.test(line)) {
        failures.push(
          `[off-brand token] ${file}:${i + 1}  -> ${label}\n        ${line.trim()}`,
        );
      }
    });
  }
}

// ── Assertion (2): dead stylesheets not imported by any LIVE file ──────────
for (const file of collectFiles(SRC_ROOT)) {
  // Skip the dead forge-app/ generation — a self-import inside the orphan is
  // not a live-tree regression (it disappears when forge-app/ is deleted).
  if (isUnder(file, DEAD_FORGE_APP)) continue;

  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    let m;
    const lineRe = new RegExp(CSS_IMPORT_RE.source, 'g');
    while ((m = lineRe.exec(line)) !== null) {
      const spec = m[1] || m[2];
      if (!spec) continue;
      const parts = spec.split('/');
      const base = parts[parts.length - 1];
      const parent = parts[parts.length - 2];
      for (const sheet of DEAD_SHEETS) {
        if (base === sheet.file && parent === sheet.parentDir) {
          failures.push(
            `[dead stylesheet import] ${file}:${i + 1}  -> imports ${sheet.label}\n        ${line.trim()}`,
          );
        }
      }
    }
  });
}

// ── Report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error('\n[brand-guard] FAIL — off-brand tokens or dead UI re-entered the live tree:\n');
  for (const f of failures) console.error('  ' + f);
  console.error('');
  assert.fail(`brand-guard found ${failures.length} violation(s) (see above)`);
}

console.log('[brand-guard] PASS — live tree is monochrome; no banned tokens in forge-v4/; no dead stylesheet imports.');
