/**
 * FilesystemPartStore (Forge-34) — disk-backed PartStore.
 *
 * Layout under the project root:
 *   <rootDir>/.forge/parts/<partId>/v<n>.json   one file per PartVersion
 *   <rootDir>/.forge/blobs/<sha256>.brep        content-addressed BREP blob
 *   <rootDir>/.forge/ecos/<id>.json             serialized ECO (carried over)
 *
 * Body commits are content-addressed: identical geometry across parts
 * shares a single blob, so a re-export of the same body costs zero
 * extra disk. The v<n>.json carries the metadata (message / author /
 * lifecycle state / parent / timestamp) and points at the blob hash.
 *
 * Constructors are sync because:
 *  - The Electron renderer (single user) doesn't benefit from async
 *    fs here — the project tree is small (KB-MB of JSON).
 *  - In-process unit tests can drive this from plain Node without an
 *    async hop.
 *
 * The class subclasses PartStore so existing callers keep working —
 * commitPart / promotePart / fileEco all delegate through the in-
 * memory cache and then persist to disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { PartStore, PartHistory, ECO, LifecycleState } from './Pdm.js';

// Forward chain we walk when a cold-loaded version is in a non-WIP state.
// Mirrors LIFECYCLE_FORWARD in Pdm.js (kept private there) — duplicated
// here only so the file can replay multi-step transitions.
const LIFECYCLE_CHAIN = [
  LifecycleState.WIP, LifecycleState.InReview,
  LifecycleState.Released, LifecycleState.Obsolete,
];
import { ForgeIo } from './Io.js';
import { ForgeBody, getForge } from './index.js';

const DIR_PARTS = path.join('.forge', 'parts');
const DIR_BLOBS = path.join('.forge', 'blobs');
const DIR_ECOS  = path.join('.forge', 'ecos');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256OfFile(filepath) {
  const buf = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function listVersionFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^v\d+\.json$/.test(f))
    .map((f) => ({ file: f, n: parseInt(f.slice(1, -5), 10) }))
    .sort((a, b) => a.n - b.n);
}

export class FilesystemPartStore extends PartStore {
  constructor({ rootDir, blobBackend = null } = {}) {
    if (!rootDir) throw new Error('[forge.fsPartStore] rootDir required');
    super();
    this.rootDir = path.resolve(rootDir);
    this.blobBackend = blobBackend;   // optional Git-LFS / S3 adapter
    this._partsDir = path.join(this.rootDir, DIR_PARTS);
    this._blobsDir = path.join(this.rootDir, DIR_BLOBS);
    this._ecosDir  = path.join(this.rootDir, DIR_ECOS);
    ensureDir(this._partsDir);
    ensureDir(this._blobsDir);
    ensureDir(this._ecosDir);
    this._loadFromDisk();
  }

  // ---------------------------------------------------------------- load
  _loadFromDisk() {
    // Walk parts/<partId>/v<n>.json — replays the histories into the
    // in-memory cache so callers get the full lifecycle for free.
    if (fs.existsSync(this._partsDir)) {
      for (const partId of fs.readdirSync(this._partsDir)) {
        const partDir = path.join(this._partsDir, partId);
        if (!fs.statSync(partDir).isDirectory()) continue;
        const versions = listVersionFiles(partDir);
        const history = new PartHistory(partId);
        for (const { file } of versions) {
          const json = JSON.parse(fs.readFileSync(path.join(partDir, file), 'utf8'));
          history.commit({
            blobHash: json.blobHash,
            message:  json.message,
            author:   json.author,
            meta:     json.meta || {},
          });
          // We don't replay lifecycle promotions on cold-load — the
          // initial commit() lands as WIP. If the on-disk v<n>.json
          // shows a non-WIP state, walk the LIFECYCLE_CHAIN one step
          // at a time so multi-hop transitions (WIP → InReview →
          // Released) all replay legally.
          if (json.state && json.state !== 'WIP') {
            const targetIdx = LIFECYCLE_CHAIN.indexOf(json.state);
            if (targetIdx > 0) {
              for (let s = 1; s <= targetIdx; ++s) {
                try {
                  history.promote(json.versionNumber, LIFECYCLE_CHAIN[s],
                                  { author: json.meta?.promotedBy || 'reload' });
                } catch {
                  // Tolerate older histories with skipped steps; the
                  // important invariant is the final state lands right.
                }
              }
            }
          }
        }
        if (history.versions.length) this.histories.set(partId, history);
      }
    }
    if (fs.existsSync(this._ecosDir)) {
      for (const f of fs.readdirSync(this._ecosDir)) {
        if (!f.endsWith('.json')) continue;
        const json = JSON.parse(fs.readFileSync(path.join(this._ecosDir, f), 'utf8'));
        const eco = new ECO({
          title: json.title, description: json.description,
          requestedBy: json.requestedBy, affectedParts: json.affectedParts,
          approvers: json.approvers,
        });
        eco.id = json.id;
        eco.state = json.state;
        eco.timeline = json.timeline || eco.timeline;
        eco.approvals = new Map(Object.entries(json.approvals || {}));
        this.ecos.set(eco.id, eco);
      }
    }
  }

  // ---------------------------------------------------------------- commit
  /**
   * commitPart(partId, { bodyHandle, message, author, meta })
   *   1. exports the body to a temp BREP file
   *   2. SHA-256s the file → blob hash
   *   3. moves the file into blobs/<hash>.brep (skipping if already present)
   *   4. writes parts/<partId>/v<n>.json with the metadata
   *
   * The legacy in-memory shape `commitPart(partId, fields)` (no
   * bodyHandle, just a blobHash) is still supported — we'll just skip
   * the export step and use the supplied hash.
   */
  commitPart(partId, fields = {}) {
    const { bodyHandle, message = '', author = 'unknown', meta = {} } = fields;
    let blobHash = fields.blobHash;

    if (bodyHandle != null && !blobHash) {
      blobHash = this._writeBlobForHandle(bodyHandle);
    }
    if (!blobHash) {
      throw new Error('[forge.fsPartStore] commitPart requires bodyHandle or blobHash');
    }

    const v = super.commitPart(partId, { blobHash, message, author, meta });
    this._writeVersionJson(partId, v);

    if (this.blobBackend && typeof this.blobBackend.afterCommit === 'function') {
      // Best-effort: stage + commit the new blob to Git LFS or push to S3.
      // Backend swallows errors that don't matter (e.g. nothing to commit)
      // and re-throws fatal ones (no git installed, bad credentials).
      this.blobBackend.afterCommit({ partId, version: v, rootDir: this.rootDir });
    }
    return v;
  }

  promotePart(partId, version, toState, opts) {
    const v = super.promotePart(partId, version, toState, opts);
    this._writeVersionJson(partId, v);
    return v;
  }

  fileEco(fields) {
    const eco = super.fileEco(fields);
    this._writeEcoJson(eco);
    return eco;
  }

  // ---------------------------------------------------------------- load body
  /**
   * loadBody(partId, version) → ForgeBody
   *
   * Reads the v<n>.json, locates the BREP blob (pulling from the
   * blob backend if missing), calls forge.io.importBrep, and returns
   * a wrapped ForgeBody.
   */
  loadBody(partId, version) {
    const history = this.histories.get(partId);
    if (!history) throw new Error(`[forge.fsPartStore] unknown partId ${partId}`);
    const target = version != null ? history.byVersion(version) : history.head();
    if (!target) {
      throw new Error(`[forge.fsPartStore] no v${version} for ${partId}`);
    }
    const blobPath = path.join(this._blobsDir, `${target.blobHash}.brep`);
    if (!fs.existsSync(blobPath)) {
      if (this.blobBackend && typeof this.blobBackend.pull === 'function') {
        this.blobBackend.pull({ blobHash: target.blobHash, blobPath, rootDir: this.rootDir });
      }
      if (!fs.existsSync(blobPath)) {
        throw new Error(`[forge.fsPartStore] blob ${target.blobHash}.brep not on disk and no backend recovered it`);
      }
    }
    return ForgeIo.importBrep(blobPath);
  }

  // ---------------------------------------------------------------- helpers
  _writeBlobForHandle(bodyHandle) {
    // Export the BREP to a temp path under .forge/blobs/, hash it,
    // then rename to the content-addressed name. Two commits of the
    // same body produce the same hash and reuse the existing blob.
    ensureDir(this._blobsDir);
    const tmp = path.join(this._blobsDir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.brep`);
    try {
      // ForgeIo.exportBrep wants a ForgeBody but the native call only
      // cares about the handle. Build a thin wrapper without retaining.
      const wrapped = bodyHandle && typeof bodyHandle === 'object' && bodyHandle.handle
        ? bodyHandle
        : { handle: bodyHandle };
      ForgeIo.exportBrep(wrapped, tmp);
      const hash = sha256OfFile(tmp);
      const dst = path.join(this._blobsDir, `${hash}.brep`);
      if (fs.existsSync(dst)) {
        fs.unlinkSync(tmp);
      } else {
        fs.renameSync(tmp, dst);
      }
      return hash;
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw e;
    }
  }

  _writeVersionJson(partId, version) {
    const partDir = path.join(this._partsDir, partId);
    ensureDir(partDir);
    const file = path.join(partDir, `v${version.versionNumber}.json`);
    const payload = {
      partId:        version.partId,
      versionNumber: version.versionNumber,
      parentVersion: version.parentVersion,
      blobHash:      version.blobHash,
      message:       version.message,
      author:        version.author,
      state:         version.state,
      meta:          version.meta || {},
      timestamp:     version.timestamp,
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  }

  _writeEcoJson(eco) {
    ensureDir(this._ecosDir);
    fs.writeFileSync(
      path.join(this._ecosDir, `${eco.id}.json`),
      JSON.stringify(eco.serialize(), null, 2),
    );
  }

  /** Returns the blob directory — useful for backends that want to scan it. */
  blobsDir() { return this._blobsDir; }
  partsDir() { return this._partsDir; }
}

// Convenience re-export so callers don't need a second import to get
// `getForge` / `ForgeBody` when iterating with mass-props.
export { ForgeBody, getForge };
