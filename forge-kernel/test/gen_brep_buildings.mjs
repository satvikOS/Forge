#!/usr/bin/env node
/**
 * gen_brep_buildings.mjs — HEADLESS BRep building generator for ArchDisc Studio.
 *
 * Uses Forge's native OCCT kernel (forge-kernel.node) with NO Electron, NO render,
 * NO training — just the real B-rep boolean engine — to build DETAILED parametric
 * building solids and tessellate them to glTF 2.0 .glb for the Studio city.
 *
 * What makes these REAL B-rep (not extruded boxes with painted windows):
 *   • Massing            — extruded/boxed storeys, true setbacks (stepped towers).
 *   • Window recesses    — every window is a BOOLEAN CUT (BRepAlgoAPI_Cut) of a
 *                          small cutter box into the façade, so each opening is a
 *                          genuine recessed reveal in the solid (real shadow-line
 *                          depth), arranged on a parametric mullion GRID per face.
 *                          The cutters are unioned (part.fuse) into one tool and
 *                          cut in one boolean for robustness, leaving the mullion
 *                          lattice (the wall material BETWEEN openings) standing.
 *   • Cornices / ledges  — proud horizontal floor-line bands (fused boxes).
 *   • Parapet            — a hollow ring wall around the roof (box minus inner box).
 *   • Entry canopy       — a cantilever slab + two columns fused at the base.
 * Result is one closed OCCT solid per building, exported as a single-mesh .glb.
 *
 * Headless acquisition mirrors cadscore_harness.makeHeadlessForge(): require the
 * .node directly; the bridge verb surface (part.make-box / cut / fuse / translate
 * / tessellate / gltf.exportGlb) is identical to what electron/preload exposes.
 *
 * Units: the kernel is millimetre-native, but Studio's scaleToTarget normalises
 * each building to a target HEIGHT in metres, so we author directly in METRES
 * (treated as kernel mm) — the absolute scale is irrelevant, only proportions.
 *
 * Usage:
 *   node forge-kernel/test/gen_brep_buildings.mjs            # build all hero buildings
 *   node forge-kernel/test/gen_brep_buildings.mjs --verify   # build + headless-verify glbs
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KERNEL_PATH = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const STUDIO_ASSETS = '/Users/account_clawteam1/archdisc-Studio/frontend/public/assets/models/brep_buildings';

// ── headless forge (identical strategy to cadscore_harness.makeHeadlessForge) ──
function makeHeadlessForge(kernelPath = KERNEL_PATH) {
  const kernel = require(kernelPath);
  return new Proxy(kernel, {
    get(t, p) {
      if (p === 'isReady') return () => true;
      if (p === 'loadError') return () => null;
      const v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

// ── small B-rep helpers over the raw kernel verbs ─────────────────────────────
// A box with its corner at (x,y,z) (kernel makeBox is corner-at-origin).
function boxAt(forge, dx, dy, dz, x, y, z) {
  let h = forge.makeBox(dx, dy, dz);
  if (x || y || z) h = forge.translate(h, x, y, z);
  return h;
}
// Fuse a list of handles into one (reduce by part.fuse). Returns the single handle.
function fuseAll(forge, handles) {
  let acc = handles[0];
  for (let i = 1; i < handles.length; i++) acc = forge.fuse(acc, handles[i]);
  return acc;
}

// ─────────────────────────────────────────────────────────────────────────────
//  WINDOW GRID as REAL boolean cutters.
//  Returns an array of cutter-box handles for one façade face. Each cutter is a
//  small box pushed INTO the wall by `reveal` (so the cut leaves a recessed
//  opening, not a through-hole) over a parametric cols×rows mullion grid. The
//  caller fuses all cutters across all faces into one tool and cuts ONCE.
//
//  face: 'zpos'|'zneg' (normal ±Z, spans X) | 'xpos'|'xneg' (normal ±X, spans Z)
//  W,D,storeyBot,storeyTop define the storey wall box (centred on origin in XЗ).
// ─────────────────────────────────────────────────────────────────────────────
function faceCutters(forge, { W, D, yBot, yTop, face, cols, rows, reveal, margin, sillFrac, mull }) {
  const cutters = [];
  const h = yTop - yBot;
  const spanAxisLen = (face === 'zpos' || face === 'zneg') ? W : D;
  const usableW = spanAxisLen - 2 * margin;
  const usableH = h - 2 * margin;
  if (usableW <= 0.4 || usableH <= 0.4) return cutters;
  const cellW = usableW / cols, cellH = usableH / rows;
  // opening = cell minus the mullion bar on each side; sillFrac trims the bottom.
  const openW = Math.max(0.15, cellW - mull);
  const openH = Math.max(0.15, cellH * (1 - sillFrac) - mull);
  const x0 = -usableW / 2 + cellW / 2;
  const y0 = yBot + margin + cellH / 2 + cellH * sillFrac * 0.5;
  const depth = reveal;               // how far the cutter eats into the wall
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const along = x0 + c * cellW;
      const cy = y0 + r * cellH;
      let cut;
      if (face === 'zpos') {
        cut = boxAt(forge, openW, openH, depth + 0.02, along - openW / 2, cy - openH / 2, D / 2 - depth);
      } else if (face === 'zneg') {
        cut = boxAt(forge, openW, openH, depth + 0.02, along - openW / 2, cy - openH / 2, -D / 2 - 0.02);
      } else if (face === 'xpos') {
        cut = boxAt(forge, depth + 0.02, openH, openW, W / 2 - depth, cy - openH / 2, along - openW / 2);
      } else { // xneg
        cut = boxAt(forge, depth + 0.02, openH, openW, -W / 2 - 0.02, cy - openH / 2, along - openW / 2);
      }
      cutters.push(cut);
    }
  }
  return cutters;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Build ONE detailed parametric BRep building solid. Returns the final handle.
//  spec: { floors, width, depth, storeyH, winCols, winRows, reveal, setbacks,
//          setbackEvery, setbackAmt, cornice, parapet, canopy, style }
// ─────────────────────────────────────────────────────────────────────────────
function buildBuilding(forge, spec) {
  const {
    floors = 10, width = 18, depth = 14, storeyH = 3.4,
    winCols = 5, winRows = 2, reveal = 0.45, mull = 0.55,
    margin = 0.7, sillFrac = 0.25,
    setbackEvery = 4, setbackAmt = 0.14,
    cornice = true, parapet = true, canopy = true,
    perFaceCols = null,
  } = spec;

  let W = width, D = depth, y = 0;
  const tiers = [];          // {handle} per tier (a run of storeys at one footprint)
  const cornices = [];
  let cutters = [];

  let tierBot = 0;
  let tierW = W, tierD = D;
  const closeTier = (top) => {
    // tier mass = solid box from tierBot..top at (tierW × tierD)
    const mass = boxAt(forge, tierW, top - tierBot, tierD, -tierW / 2, tierBot, -tierD / 2);
    tiers.push(mass);
  };

  for (let f = 0; f < floors; f++) {
    const yBot = y, yTop = y + storeyH;
    // window cutters on all four faces of THIS storey (real recessed openings)
    const cols = perFaceCols || winCols;
    for (const face of ['zpos', 'zneg', 'xpos', 'xneg']) {
      const fc = faceCutters(forge, {
        W: tierW, D: tierD, yBot, yTop, face,
        cols, rows: winRows, reveal, margin, sillFrac, mull,
      });
      for (const c of fc) cutters.push(c);
    }
    // cornice ledge at the floor line (proud horizontal band)
    if (cornice) {
      const cw = tierW + 0.36, cd = tierD + 0.36;
      cornices.push(boxAt(forge, cw, 0.18, cd, -cw / 2, yTop - 0.09, -cd / 2));
    }
    y = yTop;
    // setback: close the current tier, shed footprint, add a terrace deck.
    if ((f + 1) % setbackEvery === 0 && f < floors - 1) {
      closeTier(y);
      const td = tierW + 0.5;
      cornices.push(boxAt(forge, td, 0.2, tierD + 0.5, -td / 2, y, -(tierD + 0.5) / 2)); // terrace deck
      tierW = tierW * (1 - setbackAmt);
      tierD = tierD * (1 - setbackAmt);
      tierBot = y;
    }
  }
  closeTier(y);
  const roofY = y;

  // ── fuse the massing tiers + cornices into one solid ────────────────────────
  let solid = fuseAll(forge, tiers.concat(cornices));

  // ── cut ALL window recesses in one boolean (fuse cutters → single tool) ──────
  // (One big boolean is faster + more robust in OCCT than N sequential cuts.)
  const nWindows = cutters.length;
  if (nWindows) {
    const tool = fuseAll(forge, cutters);
    solid = forge.cut(solid, tool);
  }

  // ── parapet: a hollow ring wall around the roof (outer box minus inner box) ──
  if (parapet) {
    const ph = 0.9;
    const outer = boxAt(forge, tierW + 0.2, ph, tierD + 0.2, -(tierW + 0.2) / 2, roofY, -(tierD + 0.2) / 2);
    const inner = boxAt(forge, tierW - 0.4, ph + 0.1, tierD - 0.4, -(tierW - 0.4) / 2, roofY - 0.05, -(tierD - 0.4) / 2);
    const ring = forge.cut(outer, inner);
    solid = forge.fuse(solid, ring);
  }

  // ── entry canopy on the +Z (street) face: cantilever slab + two columns ──────
  if (canopy) {
    const cw = Math.min(W * 0.5, 6), cz = D / 2;
    const slab = boxAt(forge, cw, 0.22, 1.8, -cw / 2, storeyH * 0.95, cz - 0.2);
    const colA = boxAt(forge, 0.3, storeyH * 0.95, 0.3, -cw / 2 + 0.1, 0, cz + 1.0);
    const colB = boxAt(forge, 0.3, storeyH * 0.95, 0.3, cw / 2 - 0.4, 0, cz + 1.0);
    solid = forge.fuse(solid, fuseAll(forge, [slab, colA, colB]));
  }

  return { handle: solid, nWindows, roofY, footprint: [W, D] };
}

// ── style → PBR baseColor/metallic/roughness for the glb material ─────────────
const STYLES = {
  concrete:    { color: [0.74, 0.73, 0.70, 1], metallic: 0.0, roughness: 0.82 },
  brick:       { color: [0.55, 0.34, 0.27, 1], metallic: 0.0, roughness: 0.88 },
  glasssteel:  { color: [0.42, 0.48, 0.55, 1], metallic: 0.55, roughness: 0.35 },
  limestone:   { color: [0.82, 0.80, 0.74, 1], metallic: 0.0, roughness: 0.78 },
};

// ─────────────────────────────────────────────────────────────────────────────
//  HERO BUILDING CATALOGUE — a few DISTINCT parametric buildings.
// ─────────────────────────────────────────────────────────────────────────────
const CATALOGUE = [
  { id: 'brep_tower_setback', label: 'Setback office tower', style: 'limestone',
    spec: { floors: 16, width: 20, depth: 16, storeyH: 3.5, winCols: 6, winRows: 2,
            reveal: 0.5, setbackEvery: 5, setbackAmt: 0.15 } },
  { id: 'brep_office_glass', label: 'Glass-steel office block', style: 'glasssteel',
    spec: { floors: 11, width: 22, depth: 15, storeyH: 3.6, winCols: 7, winRows: 2,
            reveal: 0.35, mull: 0.4, margin: 0.5, sillFrac: 0.1, setbackEvery: 99 } },
  { id: 'brep_residential_brick', label: 'Brick residential mid-rise', style: 'brick',
    spec: { floors: 12, width: 18, depth: 14, storeyH: 3.0, winCols: 7, winRows: 2,
            reveal: 0.55, mull: 0.55, margin: 0.7, sillFrac: 0.3, setbackEvery: 99,
            canopy: true } },
  { id: 'brep_civic_concrete', label: 'Concrete civic block', style: 'concrete',
    spec: { floors: 10, width: 26, depth: 20, storeyH: 3.8, winCols: 8, winRows: 3,
            reveal: 0.6, mull: 0.7, margin: 1.0, sillFrac: 0.18, setbackEvery: 6, setbackAmt: 0.1 } },
];

// ── tessellate + export a building handle to <dir>/<id>/<id>.glb ──────────────
function exportBuilding(forge, handle, style, id) {
  // Flat layout: brep_buildings/<id>.glb (self-contained .glb, no sibling assets).
  fs.mkdirSync(STUDIO_ASSETS, { recursive: true });
  const out = path.join(STUDIO_ASSETS, `${id}.glb`);
  const st = STYLES[style] || STYLES.concrete;
  // fine deflection → crisp recess edges + the 10k-100k tri budget.
  const summary = forge.gltf.exportGlb(
    [{ handle, name: id, baseColor: st.color, metallic: st.metallic, roughness: st.roughness }],
    out,
    { deflection: 0.04, angularDeflection: 0.5 },
  );
  return { out, summary };
}

// ── headless verification: load each glb (parse the binary header + JSON chunk)
//    and confirm it is a real glTF binary with a mesh + the expected tri count.
//    Pure Node — no GLTFLoader, no THREE, no render.
function verifyGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 20) return { ok: false, reason: 'too small' };
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) return { ok: false, reason: 'bad glTF magic' };
  const total = buf.readUInt32LE(8);
  // first chunk = JSON
  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) return { ok: false, reason: 'first chunk not JSON' };
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const meshes = json.meshes || [];
  const materials = json.materials || [];
  // tri count = sum of indices accessor counts / 3
  let tris = 0;
  for (const m of meshes) {
    for (const prim of (m.primitives || [])) {
      if (typeof prim.indices === 'number') {
        const acc = json.accessors[prim.indices];
        tris += (acc.count || 0) / 3;
      }
    }
  }
  return {
    ok: meshes.length > 0 && tris > 0,
    bytes: buf.length, declaredTotal: total,
    meshes: meshes.length, materials: materials.length,
    tris: Math.round(tris),
    hasPBR: materials.some((mt) => mt.pbrMetallicRoughness),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const doVerify = process.argv.includes('--verify');
  const forge = makeHeadlessForge();
  fs.mkdirSync(STUDIO_ASSETS, { recursive: true });

  const manifest = [];
  for (const entry of CATALOGUE) {
    // FRESH handle space is not required here — each building is independent and
    // we never reference handles across buildings (we hold the returned handle).
    const built = buildBuilding(forge, entry.spec);
    // validity check via heal (real OCCT closed/manifold gate)
    let valid = null;
    try {
      const v = forge.heal.checkValidity(built.handle);
      valid = !!(v.isClosed && v.isManifold);
    } catch (_) { valid = null; }
    const mp = forge.massProps(built.handle);
    const { out, summary } = exportBuilding(forge, built.handle, entry.style, entry.id);
    const rec = {
      id: entry.id, label: entry.label, style: entry.style,
      floors: entry.spec.floors, footprint: built.footprint,
      windows: built.nWindows, valid,
      volume: Math.round(mp.volume),
      tris: summary.trianglesTotal, verts: summary.verticesTotal,
      bytes: summary.fileSizeBytes, file: out,
    };
    manifest.push(rec);
    process.stdout.write(
      `${entry.id.padEnd(26)} floors=${String(entry.spec.floors).padStart(2)} ` +
      `windows=${String(built.nWindows).padStart(4)} tris=${String(summary.trianglesTotal).padStart(6)} ` +
      `valid=${valid} ${(summary.fileSizeBytes / 1024).toFixed(0)}KB\n`,
    );
  }

  // write a manifest the Studio side / tests can read
  fs.writeFileSync(path.join(STUDIO_ASSETS, 'manifest.json'), JSON.stringify(manifest, null, 2));

  if (doVerify) {
    process.stdout.write('\n── headless glb verification (no render) ──\n');
    let allOk = true;
    for (const rec of manifest) {
      const v = verifyGlb(rec.file);
      const ok = v.ok && v.tris >= 10000 && v.tris <= 120000 && v.hasPBR;
      allOk = allOk && ok;
      process.stdout.write(
        `${rec.id.padEnd(26)} ${ok ? 'PASS' : 'FAIL'} tris=${v.tris} meshes=${v.meshes} ` +
        `mats=${v.materials} pbr=${v.hasPBR} bytes=${v.bytes}\n`,
      );
    }
    process.stdout.write(allOk ? '\nALL BUILDINGS VERIFIED\n' : '\nVERIFY FAILED\n');
    if (!allOk) process.exit(2);
  }
}

main();
