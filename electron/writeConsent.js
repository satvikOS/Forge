// T-131 — the consent ledger behind io:writeBlob. Extracted from main.js so it
// can be exercised by electron/test/write_consent_gate.mjs without booting
// Electron: a guard nothing can run is a guard nobody has checked.
const path = require('path');
const os = require('os');

// ── THE TRUSTED STAGING CLASS, and why the consent rule alone was wrong ──────
//
// Requiring a save panel for EVERY writeBlob broke three shipping workflows that
// stage a generated temp file and immediately re-import it, with no panel by
// design: projectFile.js writeTmpStep (/tmp/forge-project-*.step, on the project
// OPEN path), projectFile.js:218, and brepCacheMath.js (/tmp/forge-brepcache-*
// .brep). The failure was SILENT in the worst way -- loadProject catches the
// throw, pushes to restoreErrors and continues, so every native body vanished
// while loadProject still returned ok:true. A guard that introduces the exact
// defect class it was written to prevent is worse than no guard.
//
// So consent has two sources, not one: a path the USER chose in a panel, or a
// path in the Forge staging class -- a `forge-` prefixed file sitting DIRECTLY
// in the OS temp directory (or /tmp, which is not the same place on macOS:
// os.tmpdir() here is /var/folders/.../T). Nothing nested, nothing outside those
// two directories, nothing without the prefix. A tool call can still put a file
// in temp; it cannot reach a dotfile, a LaunchAgent, or a document.
const STAGING_DIRS = Array.from(new Set(
  [os.tmpdir(), '/tmp'].map((d) => path.resolve(d))));

function isForgeStaging(abs) {
  if (!STAGING_DIRS.includes(path.dirname(abs))) return false;
  return path.basename(abs).startsWith('forge-');
}

const consentedWritePaths = new Set();
const consentedWriteDirs = new Set();

function rememberConsent(fp) {
  if (!fp || typeof fp !== 'string') return;
  const abs = path.resolve(fp);
  consentedWritePaths.add(abs);
  // A robot/URDF export writes sidecar meshes NEXT TO the document the user
  // named (ForgeToolBridge io.export-robot: `writeText(dir + name, ...)`), and
  // those filenames were never in the panel. A plain filename inside a directory
  // the user has already chosen is allowed; anything that has to climb out of it
  // is not, which is why this compares RESOLVED dirnames rather than prefixes.
  consentedWriteDirs.add(path.dirname(abs));
}

function consentedFor(fp) {
  if (!fp || typeof fp !== 'string' || fp.includes('\0')) return false;
  if (!path.isAbsolute(fp)) return false;
  const abs = path.resolve(fp);
  if (consentedWritePaths.has(abs)) return true;
  if (consentedWriteDirs.has(path.dirname(abs))) return true;
  return isForgeStaging(abs);
}


function resetConsentForTests() {
  consentedWritePaths.clear();
  consentedWriteDirs.clear();
}

module.exports = { rememberConsent, consentedFor, resetConsentForTests, isForgeStaging, STAGING_DIRS };
