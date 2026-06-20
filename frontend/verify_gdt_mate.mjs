// Headless verify for task #72 — Archie applies GD&T relative to MATING PARTS
// via CUA. NO build/render. Dispatches the new gdt.* verbs through
// ForgeToolBridge against the REAL forge-kernel.node on a 2-part mating example
// (flange + plate), then reads the AP242 STEP back to confirm the GD&T was
// attached as PMI RELATIVE to the mating part's datum.
//
// Run:  node verify_gdt_mate.mjs   (esbuild bundles the bridge to a tmp CJS first)

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// 1) Bundle ForgeToolBridge to a CJS module so we can require() it in plain Node
//    (it imports ../kernel/forge/index.js which only matters when getForge() is
//    called with no injected forge — we always inject the raw kernel).
const bundlePath = path.join(os.tmpdir(), `forge_bridge_${Date.now()}.cjs`);
execSync(
  `npx esbuild src/ai/ForgeToolBridge.js --bundle --format=cjs --platform=node --outfile=${bundlePath}`,
  { cwd: __dirname, stdio: 'inherit' },
);
const bridge = require(bundlePath);
const { dispatchSequence, dispatchToolCall, FORGE_TOOLS, getToolSpec } = bridge;

// 2) Load the real native kernel and inject it as `forge`.
const forge = require(path.join(__dirname, '..', 'forge-kernel', 'build', 'Release', 'forge-kernel.node'));

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

// ── 0. New verbs registered ──────────────────────────────────────────────
const NEW = ['gdt.datum', 'gdt.feature-control-frame', 'gdt.position-relative-to-mate',
             'gdt.concentric-to-mate', 'gdt.write-step', 'assembly.detect-interference'];
for (const n of NEW) ok(!!getToolSpec(n), `verb registered: ${n}`);

const stepOut = path.join(os.tmpdir(), `forge_gdt_mate_${Date.now()}.step`);

// ── 1. Two-part mating example via CUA verbs ──────────────────────────────
// MATING PART = flange (Ø100, 4×Ø10 bolt circle BCD 75). THIS PART = a plate
// with a bolt hole that must be POSITIONED relative to the flange's datum A.
// We build both with primitive verbs (handles 1 = flange, then the plate),
// then author the GD&T relative to the mate.
const seq = [
  // --- mating part: flange with a centred bore (handle 1) ---
  { name: 'part.make-cylinder', arguments: { radius: 50, height: 15 } },          // h1 flange disc
  { name: 'part.make-cylinder', arguments: { radius: 25, height: 20 } },          // h2 bore cutter
  { name: 'part.translate', arguments: { shape: 2, dx: 0, dy: 0, dz: -2 } },      // h3
  { name: 'part.cut', arguments: { a: 1, b: 3 } },                                // h4 = flange w/ bore
  // --- THIS part: a mounting plate with one bolt hole (handles continue) ---
  { name: 'part.make-box', arguments: { dx: 120, dy: 80, dz: 12 } },              // h5 plate
  { name: 'part.make-cylinder', arguments: { radius: 5.25, height: 16 } },        // h6 bolt-hole cutter (Ø10.5)
  { name: 'part.translate', arguments: { shape: 6, dx: 37.5, dy: 40, dz: -2 } },  // h7 at bolt position
  { name: 'part.cut', arguments: { a: 5, b: 7 } },                                // h8 = plate w/ bolt hole (THIS part)
];

(async () => {
  const ctx = { current: null };
  const built = await dispatchSequence(seq, forge, ctx);
  ok(built.errors.length === 0, `geometry built clean (${built.errors.length} errors): ${JSON.stringify(built.errors)}`);
  const flange = 4;   // mating part handle
  const plate = 8;    // THIS part handle (carries the bolt hole)
  ok(forge.massProps(flange).volume > 0, `mating flange (h${flange}) is a real solid`);
  ok(forge.massProps(plate).volume > 0, `THIS plate (h${plate}) is a real solid`);

  // ── 2. Author GD&T RELATIVE TO THE MATE via CUA, sharing one ctx ────────
  const gdtCtx = { current: null };
  const dispatch = (name, args) => dispatchToolCall({ name, arguments: args }, { forge, ctx: gdtCtx });

  // 2a. Declare datum A on the MATING flange's seating face.
  const rDatum = await dispatch('gdt.datum', {
    shape: flange, letter: 'A', anchorId: 0, feature: 'flange seating face',
  });
  ok(rDatum.ok && rDatum.result.datum === 'A', `gdt.datum → datum A on mating flange (fcf="${rDatum.result?.fcf}")`);

  // 2b. THE HEADLINE: position the plate's bolt hole RELATIVE TO datum A on the
  //     mating flange — Ø0.1 at MMC.
  const rPos = await dispatch('gdt.position-relative-to-mate', {
    shape: plate, feature: 'bolt hole', tolerance: 0.1,
    relativeTo: 'flange (handle=4)', datums: ['A'], modifier: 'mmc', anchorId: 1,
  });
  ok(rPos.ok, `gdt.position-relative-to-mate dispatched ok`);
  const posFcf = rPos.result?.fcf || '';
  ok(/⌖/.test(posFcf), `position FCF carries true-position symbol ⌖ (fcf="${posFcf}")`);
  ok(/Ø0\.1/.test(posFcf), `position FCF is a diametral Ø0.1 zone`);
  ok(/Ⓜ/.test(posFcf), `position FCF carries the MMC modifier Ⓜ`);
  ok(/\|A\|/.test(posFcf), `position FCF references the MATING datum A`);
  ok(rPos.result.relativeTo.includes('flange'), `position is relative to the mating part: ${rPos.result.relativeTo}`);

  // 2c. A second mate-relative control: concentricity of a hypothetical pilot
  //     bore on the plate to the flange axis datum A.
  const rConc = await dispatch('gdt.concentric-to-mate', {
    shape: plate, feature: 'pilot bore', control: 'concentricity', tolerance: 0.05,
    relativeTo: 'flange (handle=4)', datums: ['A'], anchorId: 2,
  });
  ok(rConc.ok && /◎/.test(rConc.result.fcf) && /\|A\|/.test(rConc.result.fcf),
     `gdt.concentric-to-mate → ◎ relative to mating axis A (fcf="${rConc.result?.fcf}")`);

  // ── 3. Flush to AP242 STEP through the bound kernel op + query it back ───
  const rWrite = await dispatch('gdt.write-step', { shape: plate, filepath: stepOut });
  ok(rWrite.ok && rWrite.result.ok, `gdt.write-step wrote AP242 STEP (annotations=${rWrite.result?.annotations})`);
  ok(rWrite.result.annotations === 3, `all 3 GD&T notes flushed (datum + position + concentricity)`);

  // QUERY BACK: read the STEP file and confirm the PMI/FCF is attached.
  ok(fs.existsSync(stepOut), `STEP file exists on disk: ${stepOut}`);
  const stepText = fs.readFileSync(stepOut, 'utf8');
  ok(stepText.includes('ISO-10303-21'), `written file is a real ISO-10303-21 STEP`);
  ok(stepText.includes('PMI_BLOCK_BEGIN'), `PMI block attached to the STEP`);
  ok(/PMI_FCF: DATUM A/.test(stepText), `datum A attached as PMI`);
  // The kernel writes the position FCF text into the file; confirm it carries
  // the mating datum reference — i.e. the GD&T IS attached relative to the mate.
  ok(/PMI_FCF: \|⌖\|Ø0\.1Ⓜ\|A\|/.test(stepText),
     `position FCF (⌖ Ø0.1 MMC | A) attached relative to the mating datum`);
  ok(/PMI_FCF: \|◎\|Ø0\.05\|A\|/.test(stepText),
     `concentricity FCF (◎ Ø0.05 | A) attached relative to the mating axis datum`);

  // ── 4. assembly.detect-interference (bridged bound-not-bridged op) ──────
  // Place both parts as instances and confirm the boolean interference check
  // runs through the bridge. Identity transforms → they overlap at the origin.
  const I = Float64Array.from([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const instFlange = forge.addInstance(flange, I);
  const instPlate = forge.addInstance(plate, I);
  const rIntf = await dispatchToolCall(
    { name: 'assembly.detect-interference', arguments: { instances: [instFlange, instPlate], tolerance: 0 } },
    { forge },
  );
  ok(rIntf.ok, `assembly.detect-interference dispatched ok`);
  ok(typeof rIntf.result.interferingPairs === 'number',
     `detect-interference returned a pair count (${rIntf.result?.interferingPairs} pair(s), volume=${rIntf.result?.pairs?.[0]?.volume?.toFixed?.(1)})`);

  // ── 5. CORPUS REPLAY — dispatch a real generated row end-to-end ─────────
  // Proves the gdt_assembly corpus rows replay against the real kernel: build
  // + datum + mate-relative FCF + write-step, and the AP242 carries the FCF
  // referencing the mating datum. Uses the actual ladder-style ctx threading.
  const corpus = path.join(__dirname, '..', '..', 'archdisc-Models', 'data', 'forge', 'gdt_assembly', 'train.jsonl');
  if (fs.existsSync(corpus)) {
    const lines = fs.readFileSync(corpus, 'utf8').split('\n').filter(Boolean);
    // Pick the first boltpattern-position row (the headline mate-relative case).
    let picked = null;
    for (const ln of lines) {
      const o = JSON.parse(ln);
      if (o.meta && o.meta.family === 'boltpattern-position-to-pilot') { picked = o; break; }
    }
    ok(!!picked, `found a boltpattern-position corpus row to replay`);
    if (picked) {
      const asst = picked.messages[2].content;
      const calls = [...asst.matchAll(/<tool_call>(.*?)<\/tool_call>/gs)].map((m) => JSON.parse(m[1]));
      // Redirect the write to a fresh tmp path so the test is hermetic.
      const replayStep = path.join(os.tmpdir(), `forge_gdt_replay_${Date.now()}.step`);
      const sequence = calls.map((c) => {
        if (c.name === 'gdt.write-step') return { name: c.name, arguments: { ...c.arguments, filepath: replayStep } };
        return { name: c.name, arguments: c.arguments };
      });
      const ctx2 = { current: null };
      const replay = await dispatchSequence(sequence, forge, ctx2);
      ok(replay.errors.length === 0, `corpus row replays clean (${replay.errors.length} errors): ${JSON.stringify(replay.errors)}`);
      ok(fs.existsSync(replayStep), `corpus row wrote its AP242 STEP`);
      if (fs.existsSync(replayStep)) {
        const t = fs.readFileSync(replayStep, 'utf8');
        ok(/PMI_FCF: \|⌖\|Ø[0-9.]+Ⓜ\|A\|B\|/.test(t),
           `corpus row attached ⌖ position MMC relative to the mating |A|B| frame`);
        ok(/PMI_FCF: DATUM A/.test(t) && /PMI_FCF: DATUM B/.test(t),
           `corpus row attached both datums (A=seat, B=pilot) from the mate`);
        try { fs.unlinkSync(replayStep); } catch {}
      }
    }
  } else {
    console.log(`SKIP  corpus replay — ${corpus} not found`);
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}  — ${NEW.length} new verbs, STEP=${stepOut}`);
  try { fs.unlinkSync(bundlePath); } catch {}
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
