// PUSH-14 — Forge local PDM vault (JSON-backed, no external deps).
//
// On-disk layout under <userData>/forge-vault/:
//   manifest.json                 — single index of every document
//   docs/<docId>/                 — per-document directory
//     meta.json                   — current metadata
//     versions/v<N>/              — immutable version snapshot
//       payload.<ext>             — the actual file bytes
//       meta.json                 — snapshot metadata + sha-256
//     locks/                      — check-out semaphore
//       active.json               — { user, at, machine } if checked out
//     ecn/                        — engineering change notices
//       <ecnId>.json              — { stage, proposed, approver, releasedAt }
//
// All file I/O is synchronous fs + JSON; integrity via require('crypto')
// sha-256. Zero external packages. Browser side talks to this module via
// the `pdm:*` IPC channel surface registered in `electron/main.js`.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VAULT_DIR_NAME = 'forge-vault';
let baseDir = null;

function setBaseDir(dir) {
  baseDir = dir;
  fs.mkdirSync(path.join(baseDir, 'docs'), { recursive: true });
  const manifestPath = path.join(baseDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, JSON.stringify({ docs: {}, createdAt: new Date().toISOString() }, null, 2));
  }
}

function ensureReady() {
  if (!baseDir) throw new Error('pdm: vault not initialised — call pdm:init first');
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function manifest() {
  ensureReady();
  return readJson(path.join(baseDir, 'manifest.json'));
}
function writeManifest(m) {
  writeJson(path.join(baseDir, 'manifest.json'), m);
}

function docDir(docId) { return path.join(baseDir, 'docs', docId); }
function metaPath(docId) { return path.join(docDir(docId), 'meta.json'); }
function locksDir(docId) { return path.join(docDir(docId), 'locks'); }
function lockPath(docId) { return path.join(locksDir(docId), 'active.json'); }
function versionsDir(docId) { return path.join(docDir(docId), 'versions'); }
function ecnDir(docId) { return path.join(docDir(docId), 'ecn'); }

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function init({ userDataPath, userName, machine }) {
  setBaseDir(path.join(userDataPath, VAULT_DIR_NAME));
  return { ok: true, vaultPath: baseDir, user: userName, machine };
}

function list() {
  ensureReady();
  const m = manifest();
  return Object.values(m.docs).map((d) => ({
    docId: d.docId,
    name: d.name,
    currentVersion: d.currentVersion,
    extension: d.extension,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    locked: fs.existsSync(lockPath(d.docId)) ? readJson(lockPath(d.docId)) : null,
  }));
}

function add({ name, extension, payloadBase64, user }) {
  ensureReady();
  if (!name) throw new Error('pdm:add — name required');
  const docId = 'doc-' + crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(docDir(docId), { recursive: true });
  fs.mkdirSync(locksDir(docId), { recursive: true });
  fs.mkdirSync(versionsDir(docId), { recursive: true });
  fs.mkdirSync(ecnDir(docId), { recursive: true });
  const buf = Buffer.from(payloadBase64 || '', 'base64');
  const hash = sha256(buf);
  const v1 = path.join(versionsDir(docId), 'v1');
  fs.mkdirSync(v1, { recursive: true });
  const payloadName = `payload.${extension || 'bin'}`;
  fs.writeFileSync(path.join(v1, payloadName), buf);
  const now = new Date().toISOString();
  writeJson(path.join(v1, 'meta.json'), {
    version: 1, hash, byteLength: buf.length, author: user || 'unknown', committedAt: now, comment: 'Initial check-in',
  });
  const meta = {
    docId, name, extension: extension || 'bin', currentVersion: 1,
    createdAt: now, updatedAt: now, author: user || 'unknown',
    versionCount: 1, totalBytes: buf.length,
  };
  writeJson(metaPath(docId), meta);
  const m = manifest();
  m.docs[docId] = meta;
  writeManifest(m);
  return meta;
}

function checkout({ docId, user }) {
  ensureReady();
  if (!fs.existsSync(metaPath(docId))) throw new Error(`pdm:checkout — doc ${docId} not found`);
  if (fs.existsSync(lockPath(docId))) {
    const existing = readJson(lockPath(docId));
    if (existing.user !== user) {
      throw new Error(`pdm:checkout — doc ${docId} already checked out by ${existing.user} since ${existing.at}`);
    }
    return existing;
  }
  const lock = { docId, user: user || 'unknown', at: new Date().toISOString(), machine: process.platform };
  writeJson(lockPath(docId), lock);
  return lock;
}

function checkin({ docId, user, payloadBase64, comment }) {
  ensureReady();
  if (!fs.existsSync(metaPath(docId))) throw new Error(`pdm:checkin — doc ${docId} not found`);
  if (!fs.existsSync(lockPath(docId))) throw new Error(`pdm:checkin — doc ${docId} not checked out`);
  const lock = readJson(lockPath(docId));
  if (lock.user !== user) {
    throw new Error(`pdm:checkin — doc held by ${lock.user}, refusing check-in as ${user}`);
  }
  const meta = readJson(metaPath(docId));
  const buf = Buffer.from(payloadBase64 || '', 'base64');
  const hash = sha256(buf);
  const nextV = meta.currentVersion + 1;
  const dir = path.join(versionsDir(docId), 'v' + nextV);
  fs.mkdirSync(dir, { recursive: true });
  const payloadName = `payload.${meta.extension || 'bin'}`;
  fs.writeFileSync(path.join(dir, payloadName), buf);
  const now = new Date().toISOString();
  writeJson(path.join(dir, 'meta.json'), {
    version: nextV, hash, byteLength: buf.length, author: user || 'unknown', committedAt: now, comment: comment || '',
  });
  meta.currentVersion = nextV;
  meta.updatedAt = now;
  meta.versionCount = nextV;
  meta.totalBytes += buf.length;
  writeJson(metaPath(docId), meta);
  const m = manifest();
  m.docs[docId] = meta;
  writeManifest(m);
  fs.unlinkSync(lockPath(docId));
  return { docId, version: nextV, hash, comment };
}

function history({ docId }) {
  ensureReady();
  if (!fs.existsSync(metaPath(docId))) throw new Error(`pdm:history — doc ${docId} not found`);
  const meta = readJson(metaPath(docId));
  const versions = [];
  for (let v = 1; v <= meta.versionCount; v += 1) {
    const dir = path.join(versionsDir(docId), 'v' + v);
    if (fs.existsSync(path.join(dir, 'meta.json'))) {
      versions.push(readJson(path.join(dir, 'meta.json')));
    }
  }
  return { docId, name: meta.name, currentVersion: meta.currentVersion, versions };
}

function rollback({ docId, toVersion, user, comment }) {
  ensureReady();
  if (!fs.existsSync(metaPath(docId))) throw new Error(`pdm:rollback — doc ${docId} not found`);
  const meta = readJson(metaPath(docId));
  if (toVersion < 1 || toVersion > meta.currentVersion) {
    throw new Error(`pdm:rollback — version ${toVersion} out of range`);
  }
  const srcDir = path.join(versionsDir(docId), 'v' + toVersion);
  const payloadName = `payload.${meta.extension || 'bin'}`;
  const buf = fs.readFileSync(path.join(srcDir, payloadName));
  const hash = sha256(buf);
  const nextV = meta.currentVersion + 1;
  const dir = path.join(versionsDir(docId), 'v' + nextV);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, payloadName), buf);
  const now = new Date().toISOString();
  writeJson(path.join(dir, 'meta.json'), {
    version: nextV, hash, byteLength: buf.length, author: user || 'unknown', committedAt: now,
    comment: comment || `Rollback from v${meta.currentVersion} to v${toVersion}`,
    rolledBackFrom: toVersion,
  });
  meta.currentVersion = nextV;
  meta.updatedAt = now;
  meta.versionCount = nextV;
  meta.totalBytes += buf.length;
  writeJson(metaPath(docId), meta);
  const m = manifest();
  m.docs[docId] = meta;
  writeManifest(m);
  return { docId, version: nextV, hash };
}

function fetch({ docId, version }) {
  ensureReady();
  if (!fs.existsSync(metaPath(docId))) throw new Error(`pdm:fetch — doc ${docId} not found`);
  const meta = readJson(metaPath(docId));
  const v = version || meta.currentVersion;
  const dir = path.join(versionsDir(docId), 'v' + v);
  const payloadName = `payload.${meta.extension || 'bin'}`;
  const buf = fs.readFileSync(path.join(dir, payloadName));
  return { docId, version: v, payloadBase64: buf.toString('base64'), byteLength: buf.length };
}

function ecn({ docId, ecnId, stage, author, description, approver, releasedAt }) {
  ensureReady();
  if (!fs.existsSync(metaPath(docId))) throw new Error(`pdm:ecn — doc ${docId} not found`);
  const id = ecnId || 'ecn-' + crypto.randomBytes(4).toString('hex');
  const ecnFile = path.join(ecnDir(docId), id + '.json');
  let record = fs.existsSync(ecnFile) ? readJson(ecnFile) : {
    ecnId: id, docId, createdAt: new Date().toISOString(),
    stage: 'proposed', author: author || 'unknown', description: description || '',
  };
  if (stage) record.stage = stage;
  if (approver) record.approver = approver;
  if (releasedAt) record.releasedAt = releasedAt;
  if (description) record.description = description;
  writeJson(ecnFile, record);
  return record;
}

function ecnList({ docId }) {
  ensureReady();
  const dir = ecnDir(docId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, f)));
}

function whereUsed({ targetDocId }) {
  ensureReady();
  // Simple linkage: each doc's meta.json can carry "uses": [docId, ...].
  // Walk every meta.json and emit those that mention targetDocId.
  const m = manifest();
  const usage = [];
  for (const docId of Object.keys(m.docs)) {
    const mp = metaPath(docId);
    if (!fs.existsSync(mp)) continue;
    const meta = readJson(mp);
    const uses = Array.isArray(meta.uses) ? meta.uses : [];
    if (uses.includes(targetDocId)) {
      usage.push({ docId, name: meta.name, currentVersion: meta.currentVersion });
    }
  }
  return usage;
}

function setUses({ docId, uses }) {
  ensureReady();
  if (!fs.existsSync(metaPath(docId))) throw new Error(`pdm:setUses — doc ${docId} not found`);
  const meta = readJson(metaPath(docId));
  meta.uses = Array.isArray(uses) ? uses.slice() : [];
  writeJson(metaPath(docId), meta);
  const m = manifest();
  m.docs[docId] = meta;
  writeManifest(m);
  return meta;
}

module.exports = {
  init, list, add, checkout, checkin, history, rollback, fetch,
  ecn, ecnList, whereUsed, setUses,
};
