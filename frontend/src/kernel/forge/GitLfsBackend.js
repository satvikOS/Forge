/**
 * GitLfsBackend + S3Backend (Forge-34) — pluggable blob storage adapters
 * for FilesystemPartStore.
 *
 * Why an adapter:
 *   FilesystemPartStore writes blobs into <rootDir>/.forge/blobs as
 *   content-addressed `.brep` files. That's fine for solo work; for a
 *   team you want the blobs in Git LFS (preserves auditability) or
 *   pushed to S3 (avoids paying for LFS bandwidth at scale).
 *
 * Both backends expose the same two-method interface that
 * FilesystemPartStore drives:
 *
 *   afterCommit({ partId, version, rootDir })
 *     Called after a new v<n>.json + blob have been written. The
 *     backend may stage + commit them, push, etc. Errors should be
 *     thrown (FilesystemPartStore lets them propagate so the caller
 *     can decide whether to retry).
 *
 *   pull({ blobHash, blobPath, rootDir })
 *     Called when loadBody() can't find a blob locally. The backend
 *     should fetch it from remote storage into blobPath. Throws if
 *     it can't be recovered.
 *
 * Both classes are constructor-shaped with a `dryRun` knob so unit
 * tests can drive them without actually shelling out to git or aws.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// =====================================================================
//                              Git LFS
// =====================================================================

export class GitLfsBackend {
  constructor({ remoteUrl = null, rootDir, dryRun = false } = {}) {
    if (!rootDir) throw new Error('[forge.gitLfs] rootDir required');
    this.rootDir = path.resolve(rootDir);
    this.remoteUrl = remoteUrl;
    this.dryRun = dryRun;
    this._inited = false;
    // Capture a brief log so smokes can introspect what we attempted.
    this.log = [];
  }

  /** Idempotent: `git init`, install LFS hooks, track *.brep. */
  ensureRepo() {
    if (this._inited) return;
    this._inited = true;
    if (this.dryRun) {
      this.log.push('dry: git init && lfs install && lfs track *.brep');
      return;
    }
    if (!fs.existsSync(path.join(this.rootDir, '.git'))) {
      this._run(['init', '-q']);
    }
    // `git lfs install` and `git lfs track` are idempotent — they only
    // edit .gitattributes / hooks if not already present.
    this._lfs(['install', '--local']);
    this._lfs(['track', '*.brep']);
    // Stage the .gitattributes so future commits include it.
    this._run(['add', '.gitattributes']);
    if (this.remoteUrl) {
      // Best-effort: add origin if not already set. We never push
      // implicitly — the caller can call .push() once they're ready.
      const cur = this._run(['remote'], { tolerate: true });
      if (!(cur.stdout || '').split('\n').includes('origin')) {
        this._run(['remote', 'add', 'origin', this.remoteUrl], { tolerate: true });
      }
    }
  }

  /**
   * Called by FilesystemPartStore after each commitPart(). Stages the
   * just-written v<n>.json + the blob, then `git commit` with a
   * conventional message. We don't push; that's left to the caller.
   */
  afterCommit({ partId, version, rootDir }) {
    if (path.resolve(rootDir) !== this.rootDir) {
      throw new Error('[forge.gitLfs] rootDir mismatch between store and backend');
    }
    this.ensureRepo();
    if (this.dryRun) {
      this.log.push(`dry: stage+commit ${partId} v${version.versionNumber}`);
      return;
    }
    this._run(['add', '.forge']);
    // Only commit if there's a staged delta — otherwise Git errors.
    const status = this._run(['status', '--porcelain'], { tolerate: true });
    if (!(status.stdout || '').trim()) return;
    const author = version.author || 'forge';
    const msg = `forge.pdm: ${partId} v${version.versionNumber} — ${version.message || 'commit'}`;
    this._run([
      '-c', `user.name=${author}`,
      '-c', `user.email=${author}@forge.local`,
      'commit', '-q', '-m', msg,
    ]);
  }

  /**
   * Called by FilesystemPartStore.loadBody() when the blob isn't on
   * disk. Runs `git lfs pull --include=<blob>` so a sparse checkout
   * still works.
   */
  pull({ blobHash, blobPath, rootDir }) {
    if (path.resolve(rootDir) !== this.rootDir) {
      throw new Error('[forge.gitLfs] rootDir mismatch on pull');
    }
    this.ensureRepo();
    if (this.dryRun) {
      this.log.push(`dry: lfs pull ${blobHash}`);
      return;
    }
    const rel = path.relative(this.rootDir, blobPath);
    this._lfs(['pull', '--include', rel], { tolerate: true });
  }

  /** Manual push helper — caller decides when to ship to remote. */
  push() {
    this.ensureRepo();
    if (this.dryRun) { this.log.push('dry: push'); return; }
    this._run(['push', '-u', 'origin', 'HEAD'], { tolerate: true });
  }

  // ---- internals ----
  _run(args, { tolerate = false } = {}) {
    const res = spawnSync('git', args, { cwd: this.rootDir, encoding: 'utf8' });
    if (res.status !== 0 && !tolerate) {
      throw new Error(
        `[forge.gitLfs] git ${args.join(' ')} failed (${res.status}): ${(res.stderr || '').trim()}`,
      );
    }
    return res;
  }
  _lfs(args, opts = {}) { return this._run(['lfs', ...args], opts); }
}

// =====================================================================
//                                S3
// =====================================================================

/**
 * S3Backend — same interface as GitLfsBackend, but blobs live in an
 * S3 bucket under `<prefix>/<sha>.brep`. We deliberately *don't*
 * require the AWS SDK at module load — many Forge users will never
 * use S3, and `aws-sdk` is multi-MB. We import it dynamically the
 * first time afterCommit / pull is called.
 *
 * Without credentials we throw a friendly "not configured" error so
 * the misconfiguration surfaces clearly rather than as an AWS auth
 * exception six frames deep.
 */
export class S3Backend {
  constructor({ bucket = null, prefix = 'forge-blobs', credentials = null } = {}) {
    this.bucket = bucket;
    this.prefix = prefix.replace(/\/+$/, '');
    this.credentials = credentials;
    this._client = null;
    this.log = [];
  }

  _requireConfigured() {
    if (!this.bucket) {
      throw new Error(
        '[forge.s3] not configured: pass { bucket: "my-forge-bucket", credentials: {…} } ' +
        'to S3Backend. Falling back to local filesystem blobs.',
      );
    }
    if (!this.credentials) {
      throw new Error(
        '[forge.s3] credentials missing — set { credentials: { accessKeyId, secretAccessKey } } ' +
        'or use the default-provider chain (env vars / ~/.aws/credentials).',
      );
    }
  }

  async _ensureClient() {
    this._requireConfigured();
    if (this._client) return this._client;
    // Defer the require: we don't want to put `aws-sdk` in package.json
    // for everyone. If it's not installed, throw a clear message.
    let mod;
    try {
      // eslint-disable-next-line no-await-in-loop, global-require, import/no-unresolved
      mod = await import('aws-sdk');
    } catch (e) {
      throw new Error(
        '[forge.s3] aws-sdk not installed. Run `npm install aws-sdk` in the project root, ' +
        'or use the GitLfsBackend instead (no extra deps).',
      );
    }
    const AWS = mod.default || mod;
    AWS.config.update({ credentials: this.credentials });
    this._client = new AWS.S3();
    return this._client;
  }

  async afterCommit({ version, rootDir }) {
    this._requireConfigured();
    this.log.push(`would put ${this.bucket}/${this.prefix}/${version.blobHash}.brep`);
    const s3 = await this._ensureClient();
    const blobPath = path.join(rootDir, '.forge', 'blobs', `${version.blobHash}.brep`);
    if (!fs.existsSync(blobPath)) return;
    const body = fs.readFileSync(blobPath);
    await s3.putObject({
      Bucket: this.bucket,
      Key:    `${this.prefix}/${version.blobHash}.brep`,
      Body:   body,
    }).promise();
  }

  async pull({ blobHash, blobPath }) {
    this._requireConfigured();
    const s3 = await this._ensureClient();
    const obj = await s3.getObject({
      Bucket: this.bucket,
      Key:    `${this.prefix}/${blobHash}.brep`,
    }).promise();
    fs.writeFileSync(blobPath, obj.Body);
  }
}
