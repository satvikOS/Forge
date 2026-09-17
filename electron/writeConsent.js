// T-131 — the consent ledger behind io:writeBlob. Extracted from main.js so it
// can be exercised by electron/test/write_consent_gate.mjs without booting
// Electron: a guard nothing can run is a guard nobody has checked.
const path = require('path');

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
  return consentedWriteDirs.has(path.dirname(abs));
}


function resetConsentForTests() {
  consentedWritePaths.clear();
  consentedWriteDirs.clear();
}

module.exports = { rememberConsent, consentedFor, resetConsentForTests };
