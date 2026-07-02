// Batch builder: read a JSONL of {idx, calls} from argv[2], build EACH in a single
// reused headless forge (fresh ctx per row), measure betti+valid, write JSONL of
// {idx, ok, valid, betti} to argv[3]. One node process → no per-row child spawn.
import fs from 'fs';
import { makeHeadlessForge, tess, bboxOf, bettiNumbers, checkValid } from './cadscore_harness.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const BRIDGE_PATH = path.resolve(REPO, 'frontend', 'src', 'ai', 'ForgeToolBridge.js');

const inPath = process.argv[2];
const outPath = process.argv[3];
const forge = makeHeadlessForge();
const { dispatchSequence } = await import(BRIDGE_PATH);

const lines = fs.readFileSync(inPath, 'utf8').split('\n').filter(Boolean);
const outFd = fs.openSync(outPath, 'w');
let n = 0;
for (const line of lines) {
  const row = JSON.parse(line);
  let rec;
  try {
    const ctx = { current: null };
    // Strip io.export-step for calibration speed (betti/validity come from the
    // built body, not the STEP file). The full corpus rows DO carry export-step;
    // we only skip it while MEASURING. Pass --keep-export to retain it.
    const calls = process.argv.includes('--keep-export')
      ? row.calls
      : row.calls.filter((c) => c.name !== 'io.export-step');
    const { lastHandle, errors } = await dispatchSequence(calls, forge, ctx);
    if (!lastHandle) {
      rec = { idx: row.idx, ok: false, error: 'no body' };
    } else {
      const t = tess(forge, lastHandle);
      const betti = bettiNumbers(t);
      const valid = checkValid(forge, lastHandle).valid;
      rec = { idx: row.idx, ok: true, valid, betti };
    }
  } catch (e) {
    rec = { idx: row.idx, ok: false, error: (e.message || String(e)).slice(0, 120) };
  }
  fs.writeSync(outFd, JSON.stringify(rec) + '\n');  // flush per row → visible progress
  n++;
  if (n % 10 === 0) process.stderr.write(`...built ${n}\n`);
}
fs.closeSync(outFd);
process.stderr.write(`batch built ${n} rows\n`);
