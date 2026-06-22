/**
 * Node test for the ECAD↔MCAD bridge + 3D harness router (Task #36).
 *   node --test frontend/src/forge-v4/ecad/__tests__/ecadBridge.test.mjs
 *
 * Coverage:
 *   - IDF 3.0 round-trip fidelity: writeEmn(parseEmn(x)) reproduces the board
 *     (outline loop, drilled holes, route/place keepouts, every component
 *     refdes/package/x/y/z/rotation/side) byte-for-byte.
 *   - MCAD round-trip: ecadImportBoard (.emn → lifted 3D assembly) then
 *     ecadExportBoard (assembly → .emn) preserves component placements within
 *     tolerance (MCAD → ECAD → MCAD).
 *   - Malformed .emn is REJECTED with a clear error.
 *   - Harness arc-length vs ANALYTIC ground truth:
 *       · straight run        L = ‖B−A‖           (Euclidean)
 *       · quarter circle      L = r·(π/2)          (r·θ)
 *       · catenary            L = 2a·sinh(d/2a)     (a = H/w)
 *   - The component lift produces a placed box with correct origin / height /
 *     side semantics.
 *   - The three bridge verbs round-trip (import-board / export-board /
 *     route-harness via the ForgeToolBridge registry).
 *
 * PUBLISHED REFERENCES validated here (not invented):
 *   - IDF 3.0 Specification, Rev. 3.0 (Mentor Graphics, 1998) — the .emn board
 *     exchange grammar (.HEADER / .BOARD_OUTLINE / .ROUTE_KEEPOUT /
 *     .PLACE_KEEPOUT / .DRILLED_HOLES / .PLACEMENT). Round-trip fidelity is the
 *     conformance test.
 *   - Arc length / catenary: straight L=‖B−A‖; circular arc L=r·θ; catenary
 *     y=a·cosh(x/a) ⇒ arc length between ±d/2 anchors = 2a·sinh(d/2a), a=H/w
 *     (Irvine, "Cable Structures", 1981).
 *
 * No new npm packages (Forge rule) — kernel load is optional; every fixture has
 * a kernel-free inline-mesh branch so the suite runs anywhere.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  parseEmn, writeEmn, ecadImportBoard, ecadExportBoard,
  routeHarness, catenaryLength, polylineArcLength, splineArcLength,
  liftComponentToBody, assemblyToBoard, __test,
} from '../ecadBridge.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── try to load the prebuilt kernel (optional) ───────────────────────────────
let forge = null;
try {
  forge = require(path.resolve(
    __dirname, '..', '..', '..', '..', '..',
    'forge-kernel', 'build', 'Release', 'forge-kernel.node'));
} catch (e) {
  // kernel not available in this environment — tests use inline meshes.
}

// ── a known-good IDF 3.0 .emn fixture (a 50×30 mm board, 1.6 mm thick) ────────
// Conforms to IDF 3.0: BOARD_FILE header, an outer outline loop (label 0), a
// route keepout, two mounting holes, two placed components (one TOP, one BOTTOM,
// one rotated).
function sampleBoardSpec() {
  return {
    header: {
      fileType: 'BOARD_FILE', version: '3.0', source: 'ArchDisc-Forge',
      units: 'MM', boardName: 'DEMO_BOARD', thickness: 1.6,
    },
    outline: [
      { label: 0, x: 0, y: 0, angle: 0 },
      { label: 0, x: 50, y: 0, angle: 0 },
      { label: 0, x: 50, y: 30, angle: 0 },
      { label: 0, x: 0, y: 30, angle: 0 },
      { label: 0, x: 0, y: 0, angle: 0 },
    ],
    routeKeepouts: [{
      owner: 'MCAD',
      loop: [
        { label: 0, x: 5, y: 5, angle: 0 },
        { label: 0, x: 10, y: 5, angle: 0 },
        { label: 0, x: 10, y: 10, angle: 0 },
        { label: 0, x: 5, y: 10, angle: 0 },
        { label: 0, x: 5, y: 5, angle: 0 },
      ],
    }],
    placeKeepouts: [],
    holes: [
      { diameter: 3.2, x: 3, y: 3, plating: 'NPTH', assoc: 'BOARD', refdes: 'MTG1', holeType: 'MTG', owner: 'MCAD' },
      { diameter: 3.2, x: 47, y: 27, plating: 'NPTH', assoc: 'BOARD', refdes: 'MTG2', holeType: 'MTG', owner: 'MCAD' },
    ],
    components: [
      { pkg: 'SOIC8', partNumber: 'LM358', refdes: 'U1', x: 20, y: 15, z: 0, rot: 0, side: 'TOP', status: 'PLACED' },
      { pkg: 'RADIAL_CAP', partNumber: 'CAP100UF', refdes: 'C1', x: 35, y: 20, z: 0, rot: 90, side: 'TOP', status: 'PLACED' },
      { pkg: '0805', partNumber: 'R10K', refdes: 'R1', x: 10, y: 25, z: 0, rot: 45, side: 'BOTTOM', status: 'PLACED' },
    ],
  };
}

// ═══════════════════════════════════════════════ IDF 3.0 round-trip fidelity

test('IDF 3.0 — writeEmn emits a spec-conformant .emn (records + units)', () => {
  const emn = writeEmn(sampleBoardSpec());
  // Required records present, correctly terminated.
  assert.match(emn, /^\.HEADER$/m);
  assert.match(emn, /^BOARD_FILE 3\.0 /m);            // file type + IDF version
  assert.match(emn, /^MM$/m);                          // units line
  assert.match(emn, /^\.END_HEADER$/m);
  assert.match(emn, /^\.BOARD_OUTLINE MCAD$/m);
  assert.match(emn, /^\.END_BOARD_OUTLINE$/m);
  assert.match(emn, /^\.ROUTE_KEEPOUT MCAD$/m);
  assert.match(emn, /^\.DRILLED_HOLES$/m);
  assert.match(emn, /^\.PLACEMENT$/m);
  // A placement record is two lines: name line then geometry line.
  assert.match(emn, /"SOIC8" "LM358" "U1"/);
  assert.match(emn, /^20 15 0 0 TOP PLACED$/m);
});

test('IDF 3.0 — parse → write → parse is byte-stable (lossless round-trip)', () => {
  const emn1 = writeEmn(sampleBoardSpec());
  const parsed1 = parseEmn(emn1);
  const emn2 = writeEmn(parsed1);   // re-emit from the parsed model
  // The header carries a wall-clock date stamp; strip it before comparing.
  const strip = (s) => s.replace(/^BOARD_FILE 3\.0 .*$/m, 'BOARD_FILE 3.0 <stamp>');
  assert.equal(strip(emn2), strip(emn1));
  // And a second parse equals the first parse structurally.
  const parsed2 = parseEmn(emn2);
  assert.deepEqual(parsed2.outline, parsed1.outline);
  assert.deepEqual(parsed2.holes, parsed1.holes);
  assert.deepEqual(parsed2.components, parsed1.components);
  assert.deepEqual(parsed2.routeKeepouts, parsed1.routeKeepouts);
});

test('IDF 3.0 — every component field survives the round-trip', () => {
  const spec = sampleBoardSpec();
  const parsed = parseEmn(writeEmn(spec));
  assert.equal(parsed.components.length, 3);
  for (let i = 0; i < spec.components.length; i++) {
    const a = spec.components[i]; const b = parsed.components[i];
    assert.equal(b.refdes, a.refdes, 'refdes');
    assert.equal(b.pkg, a.pkg, 'package');
    assert.equal(b.x, a.x, 'x');
    assert.equal(b.y, a.y, 'y');
    assert.equal(b.z, a.z, 'z');
    assert.equal(b.rot, a.rot, 'rotation');
    assert.equal(b.side, a.side, 'side');
  }
  // Outline + holes + keepout survive too.
  assert.equal(parsed.outline.length, 5);
  assert.equal(parsed.holes.length, 2);
  assert.equal(parsed.holes[0].plating, 'NPTH');
  assert.equal(parsed.holes[0].refdes, 'MTG1');
  assert.equal(parsed.routeKeepouts.length, 1);
  assert.equal(parsed.routeKeepouts[0].loop.length, 5);
  assert.equal(parsed.header.thickness, 1.6);
  assert.equal(parsed.header.units, 'MM');
});

// ═══════════════════════════════════════════════ malformed .emn rejection

test('IDF 3.0 — a malformed .emn is rejected with a clear error', () => {
  // (1) unterminated record
  assert.throws(() => parseEmn('.HEADER\nBOARD_FILE 3.0 "x" d 1\n"B" 0\nMM\n'),
    /unterminated record \.HEADER/);
  // (2) wrong IDF version
  assert.throws(() => parseEmn('.HEADER\nBOARD_FILE 2.0 "x" d 1\n"B" 0\nMM\n.END_HEADER\n'),
    /only IDF version 3\.0/);
  // (3) bad units
  assert.throws(() => parseEmn('.HEADER\nBOARD_FILE 3.0 "x" d 1\n"B" 0\nFURLONGS\n.END_HEADER\n'),
    /units must be MM\|THOU/);
  // (4) non-numeric geometry
  const bad = writeEmn(sampleBoardSpec()).replace('20 15 0 0 TOP PLACED', 'twenty 15 0 0 TOP PLACED');
  assert.throws(() => parseEmn(bad), /placement X is not a number/);
  // (5) bad placement side
  const badSide = writeEmn(sampleBoardSpec()).replace('20 15 0 0 TOP PLACED', '20 15 0 0 SIDEWAYS PLACED');
  assert.throws(() => parseEmn(badSide), /placement side must be TOP\|BOTTOM/);
  // (6) missing required record
  assert.throws(() => parseEmn('.HEADER\nBOARD_FILE 3.0 "x" d 1\n"B" 0\nMM\n.END_HEADER\n'),
    /missing required \.BOARD_OUTLINE/);
  // (7) empty input
  assert.throws(() => parseEmn(''), /empty or non-string/);
});

// ═══════════════════════════════════════════════ component lift (A)

test('lift — a placed component becomes a box at package height with right origin/side', () => {
  // TOP component: base sits on the board top face (z = thickness).
  const top = liftComponentToBody(
    { pkg: 'SOIC8', refdes: 'U1', x: 20, y: 15, z: 0, rot: 0, side: 'TOP' },
    { forge, boardThickness: 1.6 });
  // SOIC8 footprint = 5×4×1.75 (from DEFAULT_PACKAGES).
  assert.equal(top.footprint.dx, 5.0);
  assert.equal(top.footprint.dy, 4.0);
  assert.equal(top.footprint.height, 1.75);
  // box min corner centered in XY on the placement, base on the board top.
  assert.ok(Math.abs(top.position.x - (20 - 2.5)) < 1e-9);
  assert.ok(Math.abs(top.position.y - (15 - 2.0)) < 1e-9);
  assert.ok(Math.abs(top.position.z - 1.6) < 1e-9);
  // visual mesh: 8 verts (24 floats), 12 tris (36 indices).
  assert.equal(top.visual.positions.length, 24);
  assert.equal(top.visual.indices.length, 36);

  // BOTTOM component: box hangs below z=0.
  const bot = liftComponentToBody(
    { pkg: '0805', refdes: 'R1', x: 10, y: 25, z: 0, rot: 45, side: 'BOTTOM' },
    { forge, boardThickness: 1.6 });
  assert.ok(bot.position.z < 0, 'bottom-side body hangs below the board');
  assert.ok(Math.abs(bot.rotation.z - (45 * Math.PI / 180)) < 1e-12, 'rotation about Z');

  if (forge) {
    assert.ok(Number.isInteger(top.handle), 'kernel makeBox handle present when kernel loaded');
  } else {
    assert.equal(top.handle, null, 'no kernel → handle null, inline mesh only');
  }
});

test('import — .emn lifts into an MCAD assembly (board slab + per-component bodies)', () => {
  const emn = writeEmn(sampleBoardSpec());
  const { assembly, board, counts } = ecadImportBoard(emn, { forge });
  // board slab + 3 components = 4 links.
  assert.equal(assembly.links.length, 4);
  assert.equal(assembly.links[0].side, 'BOARD');
  assert.equal(counts.components, 3);
  assert.equal(counts.holes, 2);
  assert.equal(board.header.boardName, 'DEMO_BOARD');
  // every link carries a renderable mesh (feeds io.export-robot / -archival).
  for (const l of assembly.links) {
    assert.ok(l.visual.positions.length > 0);
    assert.ok(l.visual.indices.length > 0);
  }
});

// ═══════════════════════════════════════════════ MCAD → ECAD → MCAD (B)

test('round-trip — MCAD→ECAD→MCAD preserves placements within tolerance', () => {
  const emn0 = writeEmn(sampleBoardSpec());
  const { assembly } = ecadImportBoard(emn0, { forge });       // ECAD → MCAD
  const emn1 = ecadExportBoard(assembly, { units: 'MM' });     // MCAD → ECAD
  const board1 = parseEmn(emn1);                                // re-read
  const orig = sampleBoardSpec().components;
  assert.equal(board1.components.length, orig.length);
  for (let i = 0; i < orig.length; i++) {
    const a = orig[i];
    const b = board1.components.find((c) => c.refdes === a.refdes);
    assert.ok(b, `refdes ${a.refdes} recovered`);
    assert.ok(Math.abs(b.x - a.x) < 1e-6, `${a.refdes} X within tol (${b.x} vs ${a.x})`);
    assert.ok(Math.abs(b.y - a.y) < 1e-6, `${a.refdes} Y within tol`);
    assert.ok(Math.abs(b.z - a.z) < 1e-6, `${a.refdes} Z within tol`);
    assert.ok(Math.abs(b.rot - a.rot) < 1e-6, `${a.refdes} rotation within tol`);
    assert.equal(b.side, a.side, `${a.refdes} side preserved`);
  }
  // The recovered board outline bbox matches the original 50×30.
  const bb = __test.loopBBox(board1.outline);
  assert.ok(Math.abs(bb.maxx - bb.minx - 50) < 1e-6);
  assert.ok(Math.abs(bb.maxy - bb.miny - 30) < 1e-6);
  assert.ok(Math.abs(board1.header.thickness - 1.6) < 1e-9);
});

// ═══════════════════════════════════════════════ harness arc-length vs analytic

test('harness — straight run length == Euclidean distance (exact)', () => {
  const A = [0, 0, 0]; const B = [300, 400, 0]; // 3-4-5 → 500 mm
  const r = routeHarness([A, B], { mode: 'linear' });
  const analytic = Math.hypot(300, 400, 0); // 500
  const err = Math.abs(r.length - analytic);
  assert.ok(err < 1e-9, `straight length err ${err} (got ${r.length}, want ${analytic})`);
  assert.equal(r.segments.length, 1);
  assert.equal(r.mode, 'linear');
});

test('harness — quarter-circle polyline length → r·(π/2) (chord-sum converges)', () => {
  // Sample a quarter circle of radius r=100 mm as a fine polyline; the chord
  // sum of N segments converges to the arc length r·θ = 100·(π/2).
  const r = 100;
  const N = 4096;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * (Math.PI / 2);
    pts.push([r * Math.cos(a), r * Math.sin(a), 0]);
  }
  const route = routeHarness(pts, { mode: 'linear' });
  const analytic = r * (Math.PI / 2); // r·θ
  const relErr = Math.abs(route.length - analytic) / analytic;
  assert.ok(relErr < 1e-6, `quarter-circle rel err ${relErr} (got ${route.length}, want ${analytic})`);
});

test('harness — catenary mode length == 2a·sinh(d/2a), a = H/w', () => {
  // Two anchors 1000 mm = 1.0 m apart horizontally; H = 50 N, w = 1 N/m → a=50 m.
  const from = [0, 0, 1000]; const to = [1000, 0, 1000]; // mm
  const H = 50; const w = 1;       // a = 50 m → 50000 mm
  const route = routeHarness([from, to], { mode: 'catenary', anchorTension: H, weightPerLength: w });
  const a_mm = (H / w) * 1000;     // 50000 mm
  const d = 1000;                  // span (mm)
  const analytic = 2 * a_mm * Math.sinh(d / (2 * a_mm));
  const err = Math.abs(route.length - analytic);
  assert.ok(err < 1e-6, `catenary analytic mismatch err ${err}`);
  // Sag exists: the centerline dips below the chord at midspan.
  const mid = route.centerline[Math.floor(route.centerline.length / 2)];
  assert.ok(mid[2] < 1000, 'catenary sags below the anchor height');
  // The sampled chord-sum of the polyline matches the analytic value closely.
  const sampled = polylineArcLength(route.centerline);
  const relErr = Math.abs(sampled - analytic) / analytic;
  assert.ok(relErr < 1e-4, `catenary sampled vs analytic rel err ${relErr}`);
  // catenaryLength() in SI agrees: a=50 m, d=1 m → L meters; ×1000 == mm value.
  const Lsi = catenaryLength(1.0, H, w); // metres
  assert.ok(Math.abs(Lsi * 1000 - analytic) < 1e-6, 'catenaryLength SI agrees with mm route');
});

test('harness — spline mode arc length ≥ chord and matches the spline sampler', () => {
  const pts = [[0, 0, 0], [100, 50, 0], [200, 0, 0], [300, 50, 0]];
  const route = routeHarness(pts, { mode: 'spline', cableId: 'awg-18', samplesPerSegment: 64 });
  // The spline length must exceed the straight polyline through the waypoints.
  const chord = polylineArcLength(pts);
  assert.ok(route.length > chord * 0.99, 'spline length is a real arc length');
  // Independent recomputation of the spline arc length (mm) agrees.
  const ref = splineArcLength(pts, 64);
  // route.length is the sampled centerline chord-sum at samplesPerSegment=64.
  assert.ok(Math.abs(route.length - ref) / ref < 0.02, 'spline length matches sampler within 2%');
  // bundle radius derived from the cable OD when not given explicitly.
  const r2 = routeHarness(pts, { mode: 'linear', cableId: 'awg-18' });
  assert.ok(r2.bundleRadius > 0, 'bundle radius derived from cable library');
});

test('harness — rejects fewer than 2 waypoints / non-finite points', () => {
  assert.throws(() => routeHarness([[0, 0, 0]], {}), /at least 2 waypoints/);
  assert.throws(() => routeHarness([[0, 0, 0], [NaN, 0, 0]], {}), /finite \[x,y,z\]/);
});

// ═══════════════════════════════════════════════ bridge verbs (registry)

test('bridge verbs — ecad.import-board / export-board / route-harness round-trip', async () => {
  const mod = await import('../../../ai/ForgeToolBridge.js');
  const tools = mod.FORGE_TOOLS || (mod.default && mod.default.FORGE_TOOLS);
  assert.ok(Array.isArray(tools), 'FORGE_TOOLS registry available');
  const byName = new Map(tools.map((t) => [t.name, t]));

  const imp = byName.get('ecad.import-board');
  const exp = byName.get('ecad.export-board');
  const route = byName.get('ecad.route-harness');
  assert.ok(imp && exp && route, 'all three ecad verbs registered');
  assert.equal(imp.discipline, 'part');
  assert.equal(exp.discipline, 'part');
  assert.equal(route.discipline, 'part');

  // import-board: feed the .emn text directly.
  const emn = writeEmn(sampleBoardSpec());
  const impRes = await imp.run({ emnText: emn }, forge);
  assert.equal(impRes.op, 'import-board');
  assert.ok(impRes.ok);
  assert.equal(impRes.counts.components, 3);
  assert.equal(impRes.assembly.links.length, 4);

  // export-board: write the recovered assembly to a temp .emn and re-read.
  const os = await import('node:os');
  const fs = await import('node:fs');
  const tmp = path.join(os.tmpdir(), `forge_ecad_${process.pid}.emn`);
  const expRes = await exp.run({ board: impRes.assembly, units: 'MM', filepath: tmp }, forge);
  assert.equal(expRes.op, 'export-board');
  assert.ok(expRes.ok);
  assert.equal(expRes.filepath, tmp);
  const written = fs.readFileSync(tmp, 'utf8');
  const reparsed = parseEmn(written);
  assert.equal(reparsed.components.length, 3);
  fs.unlinkSync(tmp);

  // route-harness verb: straight run → exact length.
  const rh = route.run({ waypoints: [[0, 0, 0], [300, 400, 0]], mode: 'linear' }, forge);
  assert.equal(rh.op, 'route-harness');
  assert.ok(rh.ok);
  assert.ok(Math.abs(rh.length - 500) < 1e-9, 'route-harness verb returns exact arc length');
  assert.equal(rh.segments.length, 1);
});

test('conformance — IDF 3.0 + successor lineage is self-described', () => {
  assert.equal(__test.IDF_CONFORMANCE.version, '3.0');
  assert.ok(__test.IDF_CONFORMANCE.successors.includes('IPC-2581B (DPMX)'));
  assert.ok(__test.IDF_CONFORMANCE.successors.includes('ProSTEP iViP IDX'));
});
