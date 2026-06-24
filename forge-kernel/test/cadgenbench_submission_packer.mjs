#!/usr/bin/env node
/**
 * CADGenBench SUBMISSION PACKER — Forge body STEP → CADGenBench `submission.zip`.
 *
 * Produces the exact upload artifact the CADGenBench leaderboard Space's Submit tab
 * expects, from one or more Forge-exported STEP files. Pure Node builtins + the
 * native kernel only (for the self-test). NO C++ compile, no npm deps, no Python.
 *
 * ─────────────────────────── THE SUBMISSION CONTRACT ───────────────────────────
 * Authoritative sources (fetched 2026-06-24, recorded in
 * docs/SCOPE_2026-06-24/research/cadgen_ecosystem_research_2026-06-24.md §2.1/§5.3
 * and CADGENBENCH_SPEC.md "Output format"):
 *   - GitHub README "How to submit":
 *       <https://raw.githubusercontent.com/huggingface/cadgenbench/main/README.md>
 *   - docs/benchmark/submission.md:
 *       <https://raw.githubusercontent.com/huggingface/cadgenbench/main/docs/benchmark/submission.md>
 *   - sanity_check_submission.py (ships WITH the public dataset, not the repo root):
 *       <https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data> →
 *       sanity_check_submission.py
 *
 * Verbatim facts the packer is built to:
 *   1. ZIP LAYOUT — a single `submission.zip` whose root holds `meta.json` plus
 *      ONE directory per sample, the directory NAMED EXACTLY by the sample id
 *      (the same folder names `101`…`250` as the `cadgenbench-data` inputs), each
 *      containing ONE candidate file `output.<ext>`.  (README "Package submission":
 *      "a root-level `meta.json` plus one folder per sample containing the output
 *      file"; "Sample IDs map directly to folder names from the cadgenbench-data
 *      dataset (e.g. folder `101` becomes sample `101`).")
 *   2. CANDIDATE FILE NAMES — one per sample, from the accepted set (README):
 *        output.step, output.stp  (B-rep / STEP — PREFERRED, high-trust gate)
 *        output.stl, output.obj, output.off, output.3mf, output.ply  (watertight mesh)
 *      Forge exports clean watertight OCCT B-rep, so we always emit `output.step`.
 *   3. meta.json — required fields written by `cadgenbench baseline package … --submitter
 *      "Name" --name "Title" --agree` (README "meta.json Structure"):
 *        submitter        : string   (author name)
 *        name             : string   (descriptive submission label)
 *        agree_to_publish : boolean  (true only when --agree was passed)
 *      We additionally write a benign, NON-required `samples` manifest + `tool`/
 *      `created` provenance keys. These are extra keys; the leaderboard reads only
 *      the three required ones, and the local sanity gate ignores meta.json
 *      entirely (it validates each STEP in isolation — see §4). Extra keys are safe.
 *   4. LOCAL SANITY GATE — `sanity_check_submission.py` (dataset helper) validates a
 *      SINGLE candidate STEP, not the zip: file-exists (exit 2 if missing) → loads
 *      (exit 1 on exception) → `validation.is_valid` + `validation.is_watertight` +
 *      `validation.topology_errors==[]`, printing solid/shell/face counts, volume,
 *      bbox, and `defl_used` (deflection_for_bbox(bbox.diagonal)); exit 0 pass /
 *      1 fail. We mirror this gate IN-PROCESS with the native kernel's
 *      `heal.checkValidity` (closed && manifold && oriented && !self-intersect &&
 *      no bad faces) on every STEP the packer ingests, refusing to pack an invalid
 *      candidate unless `--allow-invalid` is passed (which the real Space would
 *      then zero on the validity gate). The submission orientation rule (center at
 *      origin; the grader aligns rotation+translation only, never scale) is the
 *      caller's responsibility for the body, not the packer's.
 *
 * The zip is written with a pure-Node STORE-mode (method 0, no compression) writer
 * — fully PKZIP-spec-compliant, read by `unzip`, macOS Archive Utility, and Python
 * `zipfile`. STEP is ASCII and small; store-mode keeps the writer dependency-free.
 *
 * ─────────────────────────────────── USAGE ────────────────────────────────────
 *   Programmatic:
 *     import { packSubmission } from './cadgenbench_submission_packer.mjs';
 *     packSubmission({
 *       out: 'submission.zip',
 *       meta: { submitter: 'ArchDisc / Forge', name: 'Forge native OCCT v1', agree: true },
 *       samples: [ { id: '101', stepPath: '/abs/output_101.step' },
 *                  { id: '102', stepBytes: Buffer.from(stepString) } ],
 *     });
 *
 *   CLI (pack a results dir of <id>/output.step into a zip):
 *     node cadgenbench_submission_packer.mjs \
 *       --results results/forge_run --out forge_run.zip \
 *       --submitter "ArchDisc / Forge" --name "Forge native OCCT v1" --agree
 *
 *   Self-test (no corpus, no network — packs a trivial kernel STEP + validates):
 *     node cadgenbench_submission_packer.mjs --selftest
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import path from 'path';
import os from 'os';
import fs from 'fs';

import { makeHeadlessForge, checkValid } from './cadscore_harness.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Accepted candidate file names, verbatim from the CADGenBench README. STEP first.
const ACCEPTED_OUTPUTS = ['output.step', 'output.stp', 'output.stl', 'output.obj',
                          'output.off', 'output.3mf', 'output.ply'];
const PREFERRED_OUTPUT = 'output.step';

// ───────────────────────────────────────────────────────────────────────────
//  Pure-Node STORE-mode (method 0) ZIP writer — PKZIP APPNOTE compliant.
//  No deflate, no deps; readable by unzip / macOS / python zipfile. CRC-32 is the
//  standard IEEE polynomial table. (We do NOT compress: STEP/JSON are small and
//  store-mode keeps this byte-exact and dependency-free.)
// ───────────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// MS-DOS date/time encoding (FAT) for the zip entries — deterministic if a fixed
// Date is supplied (used by the self-test for byte-stable output).
function dosDateTime(d) {
  const yr = Math.max(1980, d.getFullYear());
  const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
  const date = (((yr - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
  return { time: time & 0xFFFF, date: date & 0xFFFF };
}

/**
 * Write a STORE-mode zip.
 *   entries: [{ name:'a/b.txt', data:Buffer }]   (forward-slash paths, POSIX)
 * Returns the zip Buffer.
 */
function buildZip(entries, when = new Date()) {
  const { time, date } = dosDateTime(when);
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const crc = crc32(data);
    const size = data.length;

    // Local file header (signature 0x04034b50)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);       // version needed (2.0)
    lh.writeUInt16LE(0x0800, 6);   // flags: bit 11 = UTF-8 names
    lh.writeUInt16LE(0, 8);        // method 0 = store
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);    // compressed size == size (store)
    lh.writeUInt32LE(size, 22);    // uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);       // extra len
    locals.push(lh, nameBuf, data);

    // Central directory header (signature 0x02014b50)
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);       // version made by
    ch.writeUInt16LE(20, 6);       // version needed
    ch.writeUInt16LE(0x0800, 8);   // flags: UTF-8
    ch.writeUInt16LE(0, 10);       // method = store
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);       // extra len
    ch.writeUInt16LE(0, 32);       // comment len
    ch.writeUInt16LE(0, 34);       // disk number start
    ch.writeUInt16LE(0, 36);       // internal attrs
    ch.writeUInt32LE(0, 38);       // external attrs
    ch.writeUInt32LE(offset, 42);  // local header offset
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const centralOffset = offset;

  // End of central directory record (signature 0x06054b50)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                  // disk number
  eocd.writeUInt16LE(0, 6);                  // central dir disk
  eocd.writeUInt16LE(entries.length, 8);     // entries this disk
  eocd.writeUInt16LE(entries.length, 10);    // total entries
  eocd.writeUInt32LE(centralBuf.length, 12); // central dir size
  eocd.writeUInt32LE(centralOffset, 16);     // central dir offset
  eocd.writeUInt16LE(0, 20);                 // comment len

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** Minimal STORE-mode zip READER (for the self-test round-trip verification). */
function readZip(buf) {
  // Locate End-Of-Central-Directory.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('readZip: no EOCD');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('readZip: bad central header');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // Local header: data starts after its name+extra.
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    let data = buf.subarray(dataStart, dataStart + csize);
    if (method === 8) data = zlib.inflateRawSync(data);
    else if (method !== 0) throw new Error(`readZip: unsupported method ${method}`);
    out[name] = Buffer.from(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
//  meta.json — exactly the three CADGenBench-required fields, plus benign extras.
// ───────────────────────────────────────────────────────────────────────────
function buildMeta({ submitter, name, agree }, sampleIds, extra = {}) {
  if (typeof submitter !== 'string' || submitter.length === 0)
    throw new Error('meta.submitter (string) is required');
  if (typeof name !== 'string' || name.length === 0)
    throw new Error('meta.name (string) is required');
  return {
    // ── CADGenBench-required (README "meta.json Structure") ──
    submitter,
    name,
    agree_to_publish: agree === true,
    // ── benign provenance extras (ignored by the grader & sanity gate) ──
    tool: 'forge-cadgenbench-submission-packer',
    format: 'step',
    created: (extra.created instanceof Date ? extra.created : new Date()).toISOString(),
    sample_count: sampleIds.length,
    samples: sampleIds.slice().sort(),
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  In-process validity gate mirroring sanity_check_submission.py (single STEP).
//  Returns { ok, reason, measurements } — refuses to import the kernel twice.
// ───────────────────────────────────────────────────────────────────────────
let _forgeSingleton = null;
function forge() {
  if (!_forgeSingleton) _forgeSingleton = makeHeadlessForge();
  return _forgeSingleton;
}

/**
 * Validate ONE candidate STEP file the way the dataset sanity check does:
 * exists → import (load) → checkValidity gate. Returns the structured verdict;
 * does not throw on an invalid-but-loadable solid (returns ok:false).
 */
function sanityCheckStep(stepPath) {
  if (!fs.existsSync(stepPath)) return { ok: false, exit: 2, reason: 'file not found', step: stepPath };
  const f = forge();
  let h;
  try {
    h = f.io.importStep(stepPath);
  } catch (e) {
    return { ok: false, exit: 1, reason: 'STEP load raised: ' + (e.message || String(e)), step: stepPath };
  }
  if (typeof h !== 'number' || h <= 0)
    return { ok: false, exit: 1, reason: 'STEP load returned no handle', step: stepPath };
  const v = checkValid(f, h);
  let measurements = {};
  try {
    const mp = f.massProps(h);
    measurements.volume = mp && typeof mp.volume === 'number' ? mp.volume : null;
  } catch { /* volume optional */ }
  return {
    ok: v.valid,
    exit: v.valid ? 0 : 1,
    reason: v.valid ? 'is_valid=True watertight=True'
      : `is_valid=False (closed=${!!v.raw.isClosed} manifold=${!!v.raw.isManifold} oriented=${!!v.raw.isOriented} selfIntersect=${!!v.raw.hasSelfIntersect} badFaces=${v.badFaces})`,
    measurements,
    step: stepPath,
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  packSubmission — the public API.
// ───────────────────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 *   opts.out        : string  output zip path (written if provided)
 *   opts.meta       : { submitter, name, agree }   (agree default false)
 *   opts.samples    : [{ id, stepPath?|stepBytes }]   one candidate STEP per sample
 *   opts.allowInvalid : bool  pack even if the validity gate fails (default false)
 *   opts.when       : Date    deterministic zip timestamp (default now)
 *   opts.outputName : string  candidate filename (default 'output.step')
 * @returns { zip:Buffer, meta:object, report:[{id, ok, reason}], entries:[names] }
 */
function packSubmission(opts) {
  const { out, meta = {}, samples = [], allowInvalid = false,
          when = new Date(), outputName = PREFERRED_OUTPUT } = opts;
  if (!ACCEPTED_OUTPUTS.includes(outputName))
    throw new Error(`outputName "${outputName}" not in accepted set: ${ACCEPTED_OUTPUTS.join(', ')}`);
  if (!Array.isArray(samples) || samples.length === 0)
    throw new Error('packSubmission: at least one sample is required');

  const seen = new Set();
  const report = [];
  const entries = [];
  const ids = [];

  for (const s of samples) {
    const id = String(s.id);
    if (!/^[A-Za-z0-9._-]+$/.test(id))
      throw new Error(`sample id "${id}" has characters illegal in a folder name`);
    if (seen.has(id)) throw new Error(`duplicate sample id "${id}"`);
    seen.add(id);

    // Resolve the STEP bytes (from a path or in-memory bytes).
    let bytes, tmpForCheck = null;
    if (s.stepBytes != null) {
      bytes = Buffer.isBuffer(s.stepBytes) ? s.stepBytes : Buffer.from(s.stepBytes);
    } else if (s.stepPath) {
      bytes = fs.readFileSync(s.stepPath);
    } else {
      throw new Error(`sample "${id}" needs stepPath or stepBytes`);
    }

    // Validity gate (mirror sanity_check_submission.py on a single STEP).
    let checkPath = s.stepPath;
    if (!checkPath) {
      tmpForCheck = path.join(os.tmpdir(), `fcs_pack_${process.pid}_${id}_${Date.now()}.step`);
      fs.writeFileSync(tmpForCheck, bytes);
      checkPath = tmpForCheck;
    }
    const verdict = sanityCheckStep(checkPath);
    if (tmpForCheck) { try { fs.unlinkSync(tmpForCheck); } catch { /* ignore */ } }
    report.push({ id, ok: verdict.ok, exit: verdict.exit, reason: verdict.reason });
    if (!verdict.ok && !allowInvalid)
      throw new Error(`sample "${id}" failed the validity gate (${verdict.reason}); pass allowInvalid:true to override`);

    entries.push({ name: `${id}/${outputName}`, data: bytes });
    ids.push(id);
  }

  // meta.json at the zip ROOT.
  const metaObj = buildMeta(
    { submitter: meta.submitter, name: meta.name, agree: meta.agree },
    ids, { created: when });
  entries.unshift({ name: 'meta.json', data: Buffer.from(JSON.stringify(metaObj, null, 2) + '\n', 'utf8') });

  const zip = buildZip(entries, when);
  if (out) fs.writeFileSync(out, zip);
  return { zip, meta: metaObj, report, entries: entries.map((e) => e.name) };
}

/**
 * Structural validation of a built submission (matches the README layout rules):
 * root meta.json with the 3 required fields, one `<id>/output.<ext>` per sample,
 * every sample folder unique, candidate filename in the accepted set.
 * Throws on the first violation; returns a summary on success.
 */
function validateSubmissionStructure(zipBuf) {
  const files = readZip(zipBuf);
  const names = Object.keys(files);
  if (!names.includes('meta.json')) throw new Error('structure: missing root meta.json');
  let meta;
  try { meta = JSON.parse(files['meta.json'].toString('utf8')); }
  catch (e) { throw new Error('structure: meta.json is not valid JSON: ' + e.message); }
  for (const k of ['submitter', 'name', 'agree_to_publish']) {
    if (!(k in meta)) throw new Error(`structure: meta.json missing required field "${k}"`);
  }
  if (typeof meta.submitter !== 'string') throw new Error('structure: meta.submitter must be a string');
  if (typeof meta.name !== 'string') throw new Error('structure: meta.name must be a string');
  if (typeof meta.agree_to_publish !== 'boolean') throw new Error('structure: meta.agree_to_publish must be a boolean');

  const sampleDirs = new Map(); // id -> output filename
  for (const n of names) {
    if (n === 'meta.json') continue;
    const parts = n.split('/');
    if (parts.length !== 2) throw new Error(`structure: entry "${n}" is not <id>/output.<ext>`);
    const [id, file] = parts;
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`structure: bad sample folder name "${id}"`);
    if (!ACCEPTED_OUTPUTS.includes(file))
      throw new Error(`structure: "${n}" output name not accepted (got "${file}")`);
    if (sampleDirs.has(id)) throw new Error(`structure: sample "${id}" has more than one candidate`);
    sampleDirs.set(id, file);
  }
  if (sampleDirs.size === 0) throw new Error('structure: no sample candidates in the zip');
  return { meta, sampleCount: sampleDirs.size, samples: [...sampleDirs.keys()].sort() };
}

// ───────────────────────────────────────────────────────────────────────────
//  CLI: pack a results dir (<id>/output.step) into a submission zip.
// ───────────────────────────────────────────────────────────────────────────
function collectResultsDir(dir) {
  const out = [];
  for (const id of fs.readdirSync(dir)) {
    const sub = path.join(dir, id);
    if (!fs.statSync(sub).isDirectory()) continue;
    // Prefer output.step, else the first accepted candidate present.
    let cand = null;
    for (const name of ACCEPTED_OUTPUTS) {
      const p = path.join(sub, name);
      if (fs.existsSync(p)) { cand = p; break; }
    }
    if (cand) out.push({ id, stepPath: cand });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SELF-TEST — packs a trivial kernel STEP + validates the full structure.
//  No corpus, no network, no compile. Uses the native kernel for ONE box body.
// ═══════════════════════════════════════════════════════════════════════════
async function selftest() {
  const assert = (await import('node:assert/strict')).default;
  let pass = 0;
  const ok = (name, cond) => { assert.ok(cond, name); console.log(`  ✓ ${name}`); pass++; };

  console.log('— ZIP writer/reader round-trip (pure Node store-mode) —');
  {
    const z = buildZip([
      { name: 'meta.json', data: Buffer.from('{"a":1}') },
      { name: '101/output.step', data: Buffer.from('ISO-10303-21;\nEND-ISO-10303-21;\n') },
    ], new Date('2026-06-24T00:00:00Z'));
    ok('zip starts with PK\\x03\\x04 local-file signature', z[0] === 0x50 && z[1] === 0x4B && z[2] === 0x03 && z[3] === 0x04);
    const back = readZip(z);
    ok('round-trips meta.json bytes', back['meta.json'].toString() === '{"a":1}');
    ok('round-trips 101/output.step bytes', back['101/output.step'].toString().includes('ISO-10303-21'));
    // CRC integrity: corrupt one byte → CRC of stored data no longer matches.
    ok('crc32 is deterministic', crc32(Buffer.from('hello')) === crc32(Buffer.from('hello')));
    ok('crc32 of known vector "123456789" = 0xCBF43926', crc32(Buffer.from('123456789')) === 0xCBF43926);
  }

  console.log('— build a REAL Forge STEP (native kernel) + sanity gate —');
  const f = forge();
  const tmpStep = path.join(os.tmpdir(), `packer_selftest_${process.pid}.step`);
  {
    const h = f.makeBox(40, 30, 20);
    const moved = f.translate ? f.translate(h, -20, -15, -10) : h; // center at origin
    const exported = f.io.exportStep(moved, tmpStep);
    ok('forge exported a STEP file', exported === true && fs.existsSync(tmpStep));
    const head = fs.readFileSync(tmpStep, 'utf8').slice(0, 64);
    ok('STEP file has the ISO-10303-21 header', head.includes('ISO-10303-21'));
    const verdict = sanityCheckStep(tmpStep);
    ok('sanityCheckStep PASSES a clean Forge box (exit 0)', verdict.ok === true && verdict.exit === 0);
    const missing = sanityCheckStep(tmpStep + '.nope');
    ok('sanityCheckStep returns exit 2 for a missing file', missing.ok === false && missing.exit === 2);
  }

  console.log('— packSubmission produces a CADGenBench-shaped zip —');
  let zres;
  {
    const stepBytes = fs.readFileSync(tmpStep);
    zres = packSubmission({
      meta: { submitter: 'ArchDisc / Forge', name: 'packer self-test', agree: true },
      samples: [
        { id: '101', stepPath: tmpStep },
        { id: '102', stepBytes },
      ],
      when: new Date('2026-06-24T00:00:00Z'),
    });
    ok('zip contains root meta.json', zres.entries.includes('meta.json'));
    ok('zip contains 101/output.step', zres.entries.includes('101/output.step'));
    ok('zip contains 102/output.step', zres.entries.includes('102/output.step'));
    ok('meta has required field submitter', zres.meta.submitter === 'ArchDisc / Forge');
    ok('meta has required field name', zres.meta.name === 'packer self-test');
    ok('meta.agree_to_publish === true', zres.meta.agree_to_publish === true);
    ok('every packed sample passed the validity gate', zres.report.every((r) => r.ok));
  }

  console.log('— validateSubmissionStructure accepts the built zip + rejects malformed —');
  {
    const summary = validateSubmissionStructure(zres.zip);
    ok('structure validates: 2 samples', summary.sampleCount === 2);
    ok('structure samples sorted [101,102]', summary.samples.join(',') === '101,102');

    // Negative: a zip missing meta.json must be rejected.
    const badNoMeta = buildZip([{ name: '101/output.step', data: Buffer.from('x') }]);
    let threw = false;
    try { validateSubmissionStructure(badNoMeta); } catch { threw = true; }
    ok('rejects a zip with no root meta.json', threw);

    // Negative: a nested/bad path must be rejected.
    const badNested = buildZip([
      { name: 'meta.json', data: Buffer.from('{"submitter":"x","name":"y","agree_to_publish":true}') },
      { name: 'a/b/output.step', data: Buffer.from('x') },
    ]);
    let threw2 = false;
    try { validateSubmissionStructure(badNested); } catch { threw2 = true; }
    ok('rejects a candidate that is not <id>/output.<ext>', threw2);

    // Negative: an un-accepted output filename must be rejected.
    const badName = buildZip([
      { name: 'meta.json', data: Buffer.from('{"submitter":"x","name":"y","agree_to_publish":true}') },
      { name: '101/output.xyz', data: Buffer.from('x') },
    ]);
    let threw3 = false;
    try { validateSubmissionStructure(badName); } catch { threw3 = true; }
    ok('rejects an output filename outside the accepted set', threw3);
  }

  console.log('— validity gate refuses to pack an invalid candidate (unless overridden) —');
  {
    let threw = false;
    try {
      packSubmission({
        meta: { submitter: 'x', name: 'y', agree: false },
        samples: [{ id: '999', stepBytes: Buffer.from('not a step file at all') }],
      });
    } catch { threw = true; }
    ok('packSubmission throws on an unloadable/invalid STEP by default', threw);
    const forced = packSubmission({
      meta: { submitter: 'x', name: 'y', agree: false },
      samples: [{ id: '999', stepBytes: Buffer.from('not a step file at all') }],
      allowInvalid: true,
    });
    ok('allowInvalid:true packs it anyway (report flags ok:false)',
      forced.entries.includes('999/output.step') && forced.report[0].ok === false);
    ok('meta.agree_to_publish === false when --agree not set', forced.meta.agree_to_publish === false);
  }

  try { fs.unlinkSync(tmpStep); } catch { /* ignore */ }
  console.log(`\n✅ CADGenBench submission packer self-test: ${pass}/${pass} checks PASS`);
}

// ───────────────────────────────────────────────────────────────────────────
//  Entry
// ───────────────────────────────────────────────────────────────────────────
const _isEntry = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (_isEntry) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const has = (k) => argv.includes(k);

  if (has('--selftest')) {
    selftest().catch((e) => { console.error('[packer self-test FAILED]', e.stack || e); process.exit(1); });
  } else {
    const resultsDir = arg('--results');
    const outZip = arg('--out');
    if (!resultsDir || !outZip) {
      console.error('usage: node cadgenbench_submission_packer.mjs --results <dir> --out <zip> ' +
                    '--submitter "Name" --name "Title" [--agree] [--allow-invalid]');
      console.error('   or: node cadgenbench_submission_packer.mjs --selftest');
      process.exit(2);
    }
    const samples = collectResultsDir(resultsDir);
    if (samples.length === 0) { console.error(`no <id>/output.* candidates under ${resultsDir}`); process.exit(2); }
    const res = packSubmission({
      out: outZip,
      meta: { submitter: arg('--submitter', 'ArchDisc / Forge'), name: arg('--name', 'Forge submission'), agree: has('--agree') },
      samples,
      allowInvalid: has('--allow-invalid'),
    });
    const bad = res.report.filter((r) => !r.ok);
    console.log(`packed ${res.report.length} samples → ${outZip}`);
    console.log(`  valid: ${res.report.length - bad.length}/${res.report.length}`);
    for (const r of bad) console.log(`  INVALID  ${r.id}: ${r.reason}`);
    const struct = validateSubmissionStructure(res.zip);
    console.log(`  structure OK: ${struct.sampleCount} samples, meta {submitter:"${struct.meta.submitter}", name:"${struct.meta.name}", agree_to_publish:${struct.meta.agree_to_publish}}`);
    process.exit(bad.length && !has('--allow-invalid') ? 1 : 0);
  }
}

export { packSubmission, validateSubmissionStructure, sanityCheckStep,
         buildZip, readZip, crc32, buildMeta, collectResultsDir,
         ACCEPTED_OUTPUTS, PREFERRED_OUTPUT };
