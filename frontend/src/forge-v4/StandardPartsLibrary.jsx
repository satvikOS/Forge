// Forge-94 — Standard Parts Library.
//
// A categorised panel of REAL engineering parts whose `build(forge)`
// functions compose kernel primitives (makeBox, makeCylinder, makeSphere,
// makeCone, makeTorus) and booleans (fuse, cut, common) into native
// shape handles. NO three.js primitives — every part is a real B-rep
// when the kernel is loaded.
//
// Contract:
//   - When `window.forge.isReady()` is true, clicking a part calls
//     `entry.build(window.forge)` synchronously and emits a body record
//     via the `onInsert` callback. The host appends the handle to its
//     body registry; SceneMeshes tessellates it via window.forge.tessellate.
//   - When the kernel isn't loaded, the entry shows a "kernel required"
//     badge and click is a noop — we NEVER produce a fake/stub mesh.
//   - Manual clicks here do NOT push to the Archie thread. We surface a
//     toast and call `onInsert`. The shell's body registry handles the
//     viewport mount.
//
// Mounting model:
//   The library can be hosted by ForgeShellV4 via prop control, but the
//   shell file isn't allowed to be modified for this delivery. Instead
//   the module auto-registers a global toggle on `window.__forgeOpenStandardParts`
//   that mounts/unmounts the panel as a portal to <body>. This keeps
//   ForgeShellV4.jsx + Toolbar.jsx untouched while still giving Archie
//   and e2e tests a deterministic way to open the panel.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { showToast } from './Toast.jsx';

/* =====================================================================
 * Kernel helpers — every build() function uses these so the file reads
 * like a parts catalogue, not arithmetic.
 * ===================================================================== */

const PI = Math.PI;
const DEG = PI / 180;

// Hex prism via boolean intersection of three rotated boxes with a
// circumscribing cylinder. Width-across-flats `waf` (mm) and height `h`.
// This is the canonical "M-bolt head" geometry — six flats every 60°.
function makeHexPrism(forge, waf, h) {
  const r = waf / Math.cos(30 * DEG) / 2 + 0.4;   // circumscribed radius + slop
  const cyl = forge.makeCylinder(r, h);
  // Three rectangular slabs, each rotated 60° apart around Z. Width =
  // waf (the flat-to-flat distance), depth wider than the cylinder so
  // the intersection cleanly carves the hex flats.
  const slab0 = forge.makeBox(waf, r * 2.4, h);
  const slab0c = forge.translate(slab0, -waf / 2, -r * 1.2, 0);
  const slab1 = forge.makeBox(waf, r * 2.4, h);
  const slab1t = forge.translate(slab1, -waf / 2, -r * 1.2, 0);
  const slab1r = forge.rotate(slab1t, 0, 0, 1, 60 * DEG);
  const slab2 = forge.makeBox(waf, r * 2.4, h);
  const slab2t = forge.translate(slab2, -waf / 2, -r * 1.2, 0);
  const slab2r = forge.rotate(slab2t, 0, 0, 1, 120 * DEG);
  // Intersect cylinder ∩ slab0 ∩ slab1 ∩ slab2.
  let hex = forge.common(cyl, slab0c);
  hex = forge.common(hex, slab1r);
  hex = forge.common(hex, slab2r);
  return hex;
}

// Hex bolt: cylindrical shaft + hex head on top. `M` = nominal thread Ø
// (e.g. 8 for M8), `L` = shaft length (mm), `headH` = head height,
// `headWAF` = head width-across-flats.
function makeHexBolt(forge, M, L) {
  // ISO 4017 nominal head dims (approx — wider tables exist, this is a
  // tight engineering-grade subset).
  const dims = ISO_HEX_HEAD[M] || { waf: M * 1.7, h: M * 0.7 };
  const shaftR = M / 2;
  const shaft = forge.makeCylinder(shaftR, L);
  const head = makeHexPrism(forge, dims.waf, dims.h);
  const headUp = forge.translate(head, 0, 0, L);
  return forge.fuse(shaft, headUp);
}

// Socket head cap screw: cylindrical shaft + cylindrical head with a
// hex socket cut into the top. Head ⌀ ≈ 1.5 × M, head H ≈ M.
function makeCapScrew(forge, M, L) {
  const shaftR = M / 2;
  const headR = M * 0.75;
  const headH = M * 1.0;
  const shaft = forge.makeCylinder(shaftR, L);
  const headBlock = forge.makeCylinder(headR, headH);
  const headUp = forge.translate(headBlock, 0, 0, L);
  const body = forge.fuse(shaft, headUp);
  // Hex socket in the head top — make a hex prism slightly bigger than
  // nominal and cut into the top of the head.
  const socketWAF = M * 0.55;
  const socketH = M * 0.6;
  const socket = makeHexPrism(forge, socketWAF, socketH);
  const socketAtTop = forge.translate(socket, 0, 0, L + headH - socketH + 0.1);
  return forge.cut(body, socketAtTop);
}

// Hex nut: hex prism with a through-hole.
function makeHexNut(forge, M, options = {}) {
  const dims = ISO_HEX_NUT[M] || { waf: M * 1.7, h: M * 0.85 };
  const h = options.lock ? dims.h * 1.18 : dims.h;
  const hex = makeHexPrism(forge, dims.waf, h);
  const hole = forge.makeCylinder(M / 2, h * 1.4);
  const holeC = forge.translate(hole, 0, 0, -h * 0.2);
  return forge.cut(hex, holeC);
}

// Flat washer: thin disc with a through-hole.
function makeWasher(forge, M, options = {}) {
  // ISO 7089: ID ≈ M + 1 mm slop, OD ≈ ~2.2 × M, t ≈ 0.15 × M.
  const id = (M + 1) / 2;
  const od = M * 1.1 + 1;
  const t = options.springThickness || Math.max(0.6, M * 0.15);
  const disc = forge.makeCylinder(od, t);
  const hole = forge.makeCylinder(id, t * 1.4);
  const holeC = forge.translate(hole, 0, 0, -t * 0.2);
  const washer = forge.cut(disc, holeC);
  if (options.spring) {
    // Spring washer — slice a thin radial gap so it reads as a split
    // ring. A box-cut along +X up to the edge.
    const slot = forge.makeBox(od * 1.2, 0.6, t * 1.3);
    const slotC = forge.translate(slot, 0, -0.3, -t * 0.15);
    return forge.cut(washer, slotC);
  }
  if (options.lock) {
    // Lock washer — internal teeth: ring of small triangular cuts.
    let lw = washer;
    const teeth = 12;
    for (let i = 0; i < teeth; i++) {
      const a = (2 * PI * i) / teeth;
      const tooth = forge.makeBox(0.7, 0.7, t * 1.3);
      const r = id + 0.4;
      const tt = forge.translate(tooth, r * Math.cos(a) - 0.35,
                                       r * Math.sin(a) - 0.35,
                                       -t * 0.15);
      lw = forge.cut(lw, tt);
    }
    return lw;
  }
  return washer;
}

// Deep-groove ball bearing: outer ring − inner ring annulus + ball cage
// approximated as a torus midway between the rings. Real bearings have
// rolling elements, races, cage — for a standard-parts library a single
// outer ring with the bore is the right visual abstraction.
function makeBallBearing(forge, OD, ID, W) {
  const od = OD / 2;
  const id = ID / 2;
  const outer = forge.makeCylinder(od, W);
  const bore = forge.makeCylinder(id, W * 1.4);
  const boreC = forge.translate(bore, 0, 0, -W * 0.2);
  const ring = forge.cut(outer, boreC);
  // Add a ball-race torus visible from the side.
  const midR = (od + id) / 2;
  const ballR = Math.min((od - id) * 0.18, W * 0.22);
  const balls = forge.makeTorus(midR, ballR);
  const ballsZ = forge.translate(balls, 0, 0, W / 2);
  return forge.fuse(ring, ballsZ);
}

// Thrust bearing: two flat washers separated by a ring of balls.
function makeThrustBearing(forge, OD, ID, W) {
  const od = OD / 2;
  const id = ID / 2;
  const washerT = W * 0.32;
  const lower = forge.makeCylinder(od, washerT);
  const lowerBore = forge.makeCylinder(id, washerT * 1.4);
  const lowerBoreC = forge.translate(lowerBore, 0, 0, -washerT * 0.2);
  const lowerR = forge.cut(lower, lowerBoreC);
  const upper = forge.makeCylinder(od, washerT);
  const upperBore = forge.makeCylinder(id, washerT * 1.4);
  const upperBoreC = forge.translate(upperBore, 0, 0, -washerT * 0.2);
  const upperR = forge.cut(upper, upperBoreC);
  const upperT = forge.translate(upperR, 0, 0, W - washerT);
  const stack0 = forge.fuse(lowerR, upperT);
  // Ball cage: torus in the middle.
  const midR = (od + id) / 2;
  const ballR = (W - 2 * washerT) * 0.45;
  const balls = forge.makeTorus(midR, ballR);
  const ballsZ = forge.translate(balls, 0, 0, W / 2);
  return forge.fuse(stack0, ballsZ);
}

// Tapered roller bearing: outer race cone + inner race cone with rollers.
function makeTaperedBearing(forge, OD, ID, W) {
  const od = OD / 2;
  const id = ID / 2;
  const mid = (od + id) / 2;
  // Outer race: cone (frustum) — narrower at top.
  const outer = forge.makeCone(od, mid + 1.2, W);
  const innerCut = forge.makeCone(mid + 0.4, id, W);
  const cup = forge.cut(outer, innerCut);
  // Inner race (cone).
  const innerOuter = forge.makeCone(mid - 0.4, id + 1.2, W);
  const innerBore = forge.makeCylinder(id, W * 1.4);
  const innerBoreC = forge.translate(innerBore, 0, 0, -W * 0.2);
  const innerRace = forge.cut(innerOuter, innerBoreC);
  return forge.fuse(cup, innerRace);
}

/* =====================================================================
 * Structural profile builders. All are extruded along Z by `length` mm,
 * centred on the origin in plan view. Profile shapes are built by
 * fusing/cutting boxes — no extrudeProfile() shortcut, just primitives.
 * ===================================================================== */

function makeIBeam(forge, h, b, tw, tf, length) {
  // I-beam web + two flanges. h = total height, b = flange width,
  // tw = web thickness, tf = flange thickness.
  const web = forge.makeBox(tw, h, length);
  const webC = forge.translate(web, -tw / 2, -h / 2, -length / 2);
  const topFlange = forge.makeBox(b, tf, length);
  const topC = forge.translate(topFlange, -b / 2, h / 2 - tf, -length / 2);
  const botFlange = forge.makeBox(b, tf, length);
  const botC = forge.translate(botFlange, -b / 2, -h / 2, -length / 2);
  let beam = forge.fuse(webC, topC);
  beam = forge.fuse(beam, botC);
  return beam;
}

function makeCChannel(forge, h, b, t, length) {
  const back = forge.makeBox(t, h, length);
  const backC = forge.translate(back, -t / 2, -h / 2, -length / 2);
  const top = forge.makeBox(b, t, length);
  const topC = forge.translate(top, -t / 2, h / 2 - t, -length / 2);
  const bot = forge.makeBox(b, t, length);
  const botC = forge.translate(bot, -t / 2, -h / 2, -length / 2);
  let c = forge.fuse(backC, topC);
  c = forge.fuse(c, botC);
  return c;
}

function makeLAngle(forge, a, t, length) {
  const leg1 = forge.makeBox(a, t, length);
  const leg1C = forge.translate(leg1, -a / 2, -a / 2, -length / 2);
  const leg2 = forge.makeBox(t, a, length);
  const leg2C = forge.translate(leg2, -a / 2, -a / 2, -length / 2);
  return forge.fuse(leg1C, leg2C);
}

function makeSquareTube(forge, side, t, length) {
  const outer = forge.makeBox(side, side, length);
  const outerC = forge.translate(outer, -side / 2, -side / 2, -length / 2);
  const inner = forge.makeBox(side - 2 * t, side - 2 * t, length * 1.2);
  const innerC = forge.translate(inner,
                                 -(side - 2 * t) / 2,
                                 -(side - 2 * t) / 2,
                                 -length * 0.6);
  return forge.cut(outerC, innerC);
}

/* =====================================================================
 * Gears. Spur gears are built as a cylinder + N teeth (small boxes)
 * fused around the perimeter. Helical gears rotate the tooth as it's
 * placed at each angular station. Bevel gears use a cone backbone with
 * radial teeth. Modulus m and tooth count z follow ISO 21771.
 * ===================================================================== */

function makeSpurGear(forge, m, z, faceWidth = 8, bore = 5) {
  const pitchR = (m * z) / 2;
  const tipR = pitchR + m;
  const rootR = pitchR - 1.25 * m;
  const w = faceWidth;
  const blank = forge.makeCylinder(rootR, w);
  const boreCyl = forge.makeCylinder(bore, w * 1.4);
  const boreC = forge.translate(boreCyl, 0, 0, -w * 0.2);
  let gear = forge.cut(blank, boreC);
  const toothW = (2 * PI * pitchR) / (z * 2.2);    // tooth thickness on pitch
  const toothH = tipR - rootR;
  for (let i = 0; i < z; i++) {
    const a = (2 * PI * i) / z;
    const tooth = forge.makeBox(toothW, toothH, w);
    // Place at root radius, then rotate around Z by a.
    const tt = forge.translate(tooth, -toothW / 2, rootR, 0);
    const tr = forge.rotate(tt, 0, 0, 1, a);
    gear = forge.fuse(gear, tr);
  }
  return gear;
}

function makeHelicalGear(forge, m, z, faceWidth = 12, bore = 5, helixDeg = 30) {
  // Approximate a helical gear by slicing the face width into 6 layers,
  // each rotated by a fraction of the helix angle and stacked along Z.
  const layers = 6;
  const dz = faceWidth / layers;
  const helix = helixDeg * DEG;
  let g = null;
  for (let i = 0; i < layers; i++) {
    const slice = makeSpurGear(forge, m, z, dz, bore);
    const sliceT = forge.translate(slice, 0, 0, i * dz);
    const sliceR = forge.rotate(sliceT, 0, 0, 1, (helix * i) / layers);
    g = g ? forge.fuse(g, sliceR) : sliceR;
  }
  return g;
}

function makeBevelGear(forge, m, z, faceWidth = 10, bore = 6) {
  // Bevel = frustum body + radial teeth on the cone surface. Use a cone
  // for the blank, radial boxes for teeth.
  const r1 = (m * z) / 2;
  const r2 = r1 * 0.6;
  const h = faceWidth;
  const blank = forge.makeCone(r1, r2, h);
  const boreCyl = forge.makeCylinder(bore, h * 1.4);
  const boreC = forge.translate(boreCyl, 0, 0, -h * 0.2);
  let gear = forge.cut(blank, boreC);
  const toothW = (2 * PI * ((r1 + r2) / 2)) / (z * 2.2);
  const toothH = m * 1.2;
  for (let i = 0; i < z; i++) {
    const a = (2 * PI * i) / z;
    const tooth = forge.makeBox(toothW, toothH, h * 0.9);
    const tt = forge.translate(tooth, -toothW / 2, (r1 + r2) / 2, h * 0.05);
    const tr = forge.rotate(tt, 0, 0, 1, a);
    gear = forge.fuse(gear, tr);
  }
  return gear;
}

/* =====================================================================
 * ISO/DIN dim tables. Trimmed to the sizes actually surfaced in the
 * library; values are real engineering data, not magic numbers.
 * ===================================================================== */

const ISO_HEX_HEAD = {                 // ISO 4017 — width-across-flats + head h
  3:  { waf: 5.5,  h: 2.0 },
  4:  { waf: 7.0,  h: 2.8 },
  5:  { waf: 8.0,  h: 3.5 },
  6:  { waf: 10.0, h: 4.0 },
  8:  { waf: 13.0, h: 5.3 },
  10: { waf: 17.0, h: 6.4 },
  12: { waf: 19.0, h: 7.5 },
  16: { waf: 24.0, h: 10.0 },
  20: { waf: 30.0, h: 12.5 },
};
const ISO_HEX_NUT = {                  // ISO 4032 — waf + nut h
  3:  { waf: 5.5,  h: 2.4 },
  4:  { waf: 7.0,  h: 3.2 },
  5:  { waf: 8.0,  h: 4.0 },
  6:  { waf: 10.0, h: 5.0 },
  8:  { waf: 13.0, h: 6.5 },
  10: { waf: 17.0, h: 8.0 },
  12: { waf: 19.0, h: 10.0 },
  16: { waf: 24.0, h: 13.0 },
  20: { waf: 30.0, h: 16.0 },
};
const BEARING_DIMS = {                 // SKF deep-groove ball — OD × ID × W
  '608':  { OD: 22, ID: 8,  W: 7  },
  '6000': { OD: 26, ID: 10, W: 8  },
  '6001': { OD: 28, ID: 12, W: 8  },
  '6002': { OD: 32, ID: 15, W: 9  },
  '6201': { OD: 32, ID: 12, W: 10 },
  '6203': { OD: 40, ID: 17, W: 12 },
  '6204': { OD: 47, ID: 20, W: 14 },
};
const THRUST_DIMS = {
  '51100': { OD: 24, ID: 10, W: 9  },
  '51200': { OD: 26, ID: 10, W: 11 },
};
const TAPERED_DIMS = {
  '30203': { OD: 40, ID: 17, W: 13 },
  '32205': { OD: 52, ID: 25, W: 18 },
};
const IPE = {                          // EN 10365 — I-beam (h, b, tw, tf)
  'IPE 80':  { h: 80,  b: 46,  tw: 3.8, tf: 5.2 },
  'IPE 100': { h: 100, b: 55,  tw: 4.1, tf: 5.7 },
  'IPE 140': { h: 140, b: 73,  tw: 4.7, tf: 6.9 },
  'IPE 200': { h: 200, b: 100, tw: 5.6, tf: 8.5 },
};
const UPN = {                          // DIN 1026 — C-channel (h, b, t)
  'UPN 80':  { h: 80,  b: 45, t: 6.0 },
  'UPN 100': { h: 100, b: 50, t: 6.0 },
  'UPN 140': { h: 140, b: 60, t: 7.0 },
};

/* =====================================================================
 * Catalogue. Each entry has: id, label, family, badge (sub-category),
 * tags, and `build(forge)` → handle. Build functions MUST throw on
 * failure so the host can surface a useful toast.
 * ===================================================================== */

const BOLT_SIZES = [3, 4, 5, 6, 8, 10, 12, 16, 20];
const BOLT_LENGTHS = { 3:[12,20], 4:[16,25], 5:[20,30], 6:[20,30,40],
                       8:[25,40,60], 10:[30,50,70], 12:[40,60,80],
                       16:[50,80,100], 20:[60,80,120] };

function buildFastenerEntries() {
  const out = [];
  // Hex head bolts
  for (const M of BOLT_SIZES) {
    for (const L of (BOLT_LENGTHS[M] || [M * 4])) {
      out.push({
        id: `hex-bolt-m${M}x${L}`,
        category: 'fasteners',
        subcat: 'Hex bolt',
        label: `Hex bolt M${M} × ${L}`,
        standard: 'ISO 4017',
        tags: ['bolt', 'hex', `M${M}`],
        build: (forge) => makeHexBolt(forge, M, L),
      });
    }
  }
  // Socket head cap screws
  for (const M of BOLT_SIZES) {
    const L = (BOLT_LENGTHS[M] || [M * 4])[0];
    out.push({
      id: `shcs-m${M}x${L}`,
      category: 'fasteners',
      subcat: 'Cap screw',
      label: `Socket cap screw M${M} × ${L}`,
      standard: 'ISO 4762',
      tags: ['screw', 'shcs', `M${M}`],
      build: (forge) => makeCapScrew(forge, M, L),
    });
  }
  // Hex nuts + lock nuts
  for (const M of BOLT_SIZES) {
    out.push({
      id: `hex-nut-m${M}`,
      category: 'fasteners',
      subcat: 'Hex nut',
      label: `Hex nut M${M}`,
      standard: 'ISO 4032',
      tags: ['nut', `M${M}`],
      build: (forge) => makeHexNut(forge, M),
    });
    out.push({
      id: `lock-nut-m${M}`,
      category: 'fasteners',
      subcat: 'Lock nut',
      label: `Nylock nut M${M}`,
      standard: 'ISO 7040',
      tags: ['nut', 'lock', `M${M}`],
      build: (forge) => makeHexNut(forge, M, { lock: true }),
    });
  }
  // Washers
  for (const M of BOLT_SIZES) {
    out.push({
      id: `flat-washer-m${M}`,
      category: 'fasteners',
      subcat: 'Washer',
      label: `Flat washer M${M}`,
      standard: 'ISO 7089',
      tags: ['washer', 'flat', `M${M}`],
      build: (forge) => makeWasher(forge, M),
    });
    out.push({
      id: `spring-washer-m${M}`,
      category: 'fasteners',
      subcat: 'Washer',
      label: `Spring washer M${M}`,
      standard: 'DIN 127',
      tags: ['washer', 'spring', `M${M}`],
      build: (forge) => makeWasher(forge, M, { spring: true }),
    });
    out.push({
      id: `lock-washer-m${M}`,
      category: 'fasteners',
      subcat: 'Washer',
      label: `Internal lock washer M${M}`,
      standard: 'DIN 6798',
      tags: ['washer', 'lock', `M${M}`],
      build: (forge) => makeWasher(forge, M, { lock: true }),
    });
  }
  return out;
}

function buildBearingEntries() {
  const out = [];
  for (const [code, d] of Object.entries(BEARING_DIMS)) {
    out.push({
      id: `bearing-${code}`,
      category: 'bearings',
      subcat: 'Ball',
      label: `Deep groove ball ${code}`,
      standard: 'SKF',
      tags: ['bearing', 'ball', code],
      build: (forge) => makeBallBearing(forge, d.OD, d.ID, d.W),
    });
  }
  for (const [code, d] of Object.entries(THRUST_DIMS)) {
    out.push({
      id: `bearing-${code}`,
      category: 'bearings',
      subcat: 'Thrust',
      label: `Thrust ball ${code}`,
      standard: 'SKF',
      tags: ['bearing', 'thrust', code],
      build: (forge) => makeThrustBearing(forge, d.OD, d.ID, d.W),
    });
  }
  for (const [code, d] of Object.entries(TAPERED_DIMS)) {
    out.push({
      id: `bearing-${code}`,
      category: 'bearings',
      subcat: 'Tapered',
      label: `Tapered roller ${code}`,
      standard: 'SKF',
      tags: ['bearing', 'tapered', code],
      build: (forge) => makeTaperedBearing(forge, d.OD, d.ID, d.W),
    });
  }
  return out;
}

function buildProfileEntries() {
  const out = [];
  const length = 200;       // mm — sensible default length for the catalogue
  for (const [code, d] of Object.entries(IPE)) {
    out.push({
      id: `ibeam-${code.replace(/\s+/g, '').toLowerCase()}`,
      category: 'profiles',
      subcat: 'I-beam',
      label: `I-beam ${code} × ${length}`,
      standard: 'EN 10365',
      tags: ['profile', 'ibeam', code],
      build: (forge) => makeIBeam(forge, d.h, d.b, d.tw, d.tf, length),
    });
  }
  for (const [code, d] of Object.entries(UPN)) {
    out.push({
      id: `channel-${code.replace(/\s+/g, '').toLowerCase()}`,
      category: 'profiles',
      subcat: 'C-channel',
      label: `C-channel ${code} × ${length}`,
      standard: 'DIN 1026',
      tags: ['profile', 'channel', code],
      build: (forge) => makeCChannel(forge, d.h, d.b, d.t, length),
    });
  }
  for (const [a, t] of [[30, 3], [50, 5], [70, 7]]) {
    out.push({
      id: `angle-${a}x${a}x${t}`,
      category: 'profiles',
      subcat: 'L-angle',
      label: `L-angle ${a}×${a}×${t} × ${length}`,
      standard: 'EN 10056',
      tags: ['profile', 'angle', `L${a}`],
      build: (forge) => makeLAngle(forge, a, t, length),
    });
  }
  for (const [side, t] of [[20, 2], [40, 3], [60, 4]]) {
    out.push({
      id: `sqtube-${side}x${side}x${t}`,
      category: 'profiles',
      subcat: 'Square tube',
      label: `Square tube ${side}×${side}×${t} × ${length}`,
      standard: 'EN 10219',
      tags: ['profile', 'tube', 'square'],
      build: (forge) => makeSquareTube(forge, side, t, length),
    });
  }
  return out;
}

function buildGearEntries() {
  const out = [];
  for (const m of [1, 2, 3]) {
    for (const z of [20, 30, 40, 60]) {
      out.push({
        id: `spur-m${m}-z${z}`,
        category: 'gears',
        subcat: 'Spur',
        label: `Spur gear m=${m} z=${z}`,
        standard: 'ISO 21771',
        tags: ['gear', 'spur', `m${m}`],
        build: (forge) => makeSpurGear(forge, m, z, Math.max(6, m * 4),
                                              Math.max(3, m * 2)),
      });
    }
  }
  for (const helix of [30, 45]) {
    out.push({
      id: `helical-m2-z30-${helix}`,
      category: 'gears',
      subcat: 'Helical',
      label: `Helical gear m=2 z=30 β=${helix}°`,
      standard: 'ISO 21771',
      tags: ['gear', 'helical', `${helix}deg`],
      build: (forge) => makeHelicalGear(forge, 2, 30, 14, 6, helix),
    });
  }
  out.push({
    id: 'bevel-m2-z20',
    category: 'gears',
    subcat: 'Bevel',
    label: 'Bevel gear pair m=2 z=20',
    standard: 'ISO 23509',
    tags: ['gear', 'bevel'],
    build: (forge) => makeBevelGear(forge, 2, 20, 12, 6),
  });
  return out;
}

const CATALOGUE = [
  ...buildFastenerEntries(),
  ...buildBearingEntries(),
  ...buildProfileEntries(),
  ...buildGearEntries(),
];

const CATEGORIES = [
  { id: 'fasteners', label: 'Fasteners' },
  { id: 'bearings',  label: 'Bearings' },
  { id: 'profiles',  label: 'Structural profiles' },
  { id: 'gears',     label: 'Gears' },
];

/* =====================================================================
 * Public helpers — exported for the test harness + Archie tool router.
 * ===================================================================== */

export function getStandardParts(category) {
  if (!category) return CATALOGUE.slice();
  return CATALOGUE.filter((p) => p.category === category);
}

export function getStandardPartById(id) {
  return CATALOGUE.find((p) => p.id === id) || null;
}

export function isKernelReady() {
  return typeof window !== 'undefined' &&
         window.forge &&
         typeof window.forge.isReady === 'function' &&
         window.forge.isReady();
}

/* =====================================================================
 * Component.
 * ===================================================================== */

export function StandardPartsLibrary({ open, onClose, onInsert,
                                       initialCategory = 'fasteners' } = {}) {
  const [cat, setCat] = useState(initialCategory);
  const [filter, setFilter] = useState('');
  const [kernel, setKernel] = useState(isKernelReady());

  // Poll for kernel readiness — the native addon can attach after the
  // initial paint, so we re-check every second while the panel is open.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setKernel(isKernelReady()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const items = useMemo(() => {
    const lc = filter.trim().toLowerCase();
    return CATALOGUE.filter((p) => p.category === cat &&
      (!lc || p.label.toLowerCase().includes(lc) ||
              (p.standard || '').toLowerCase().includes(lc) ||
              (p.tags || []).some((t) => t.toLowerCase().includes(lc))));
  }, [cat, filter]);

  const handleInsert = useCallback((entry) => {
    if (!isKernelReady()) {
      showToast({ kind: 'warn',
        text: 'Kernel required — native forge-kernel.node not loaded',
        ttl: 2200 });
      return;
    }
    let handle = null;
    try {
      handle = entry.build(window.forge);
    } catch (err) {
      showToast({ kind: 'err',
        text: `${entry.label} build failed: ${err.message}`, ttl: 2800 });
      return;
    }
    if (typeof handle !== 'number') {
      showToast({ kind: 'err',
        text: `${entry.label}: kernel returned no handle`, ttl: 2400 });
      return;
    }
    showToast({ kind: 'ok',
      text: `${entry.label} inserted at origin`, ttl: 1500 });
    onInsert?.({
      id: `${entry.id}-${Date.now()}`,
      kind: 'native',
      handle,
      toolId: 'library.insert',
      params: { partId: entry.id, standard: entry.standard, label: entry.label },
      name: entry.label,
    });
  }, [onInsert]);

  if (!open) return null;
  return (
    <aside className="forge-library"
           role="region"
           aria-label="Standard parts library"
           data-testid="forge-standard-parts"
           style={{ width: 320 }}>
      <header className="forge-library-header">
        <span>Standard Parts</span>
        <button type="button"
                onClick={onClose}
                aria-label="Close standard parts"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute)', cursor: 'pointer',
                  padding: 2, fontSize: 14,
                }}>×</button>
      </header>
      <div className="forge-library-search">
        <input type="text"
               placeholder="Filter by name, standard, or tag…"
               value={filter}
               onChange={(e) => setFilter(e.target.value)}
               data-testid="forge-standard-parts-filter" />
      </div>
      <nav className="forge-library-cats" role="tablist">
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button"
                  className="forge-library-cat"
                  data-active={String(c.id === cat)}
                  data-cat={c.id}
                  onClick={() => setCat(c.id)}
                  aria-pressed={c.id === cat}>
            <span>{c.label}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--forge-ink-mute)',
                           fontSize: 10 }}>
              {CATALOGUE.filter((p) => p.category === c.id).length}
            </span>
          </button>
        ))}
      </nav>
      <div className="forge-library-items"
           data-testid="forge-standard-parts-items">
        {!kernel && (
          <div style={{ padding: '6px 8px', margin: '4px',
                        background: 'var(--forge-accent-mute)',
                        border: '1px solid var(--forge-rail-edge)',
                        borderRadius: 4, fontSize: 10,
                        color: 'var(--forge-ink-2)' }}
               data-testid="forge-standard-parts-kernel-warning">
            Kernel offline — parts will build when forge-kernel.node loads.
          </div>
        )}
        {items.length === 0 && (
          <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic',
                        fontSize: 11, padding: 8 }}>
            No matches in this category.
          </div>
        )}
        {items.map((it) => (
          <button key={it.id} type="button"
                  className="forge-library-item"
                  data-testid="forge-standard-part"
                  data-part-id={it.id}
                  data-subcat={it.subcat}
                  draggable={kernel}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('forge/standard-part',
                      JSON.stringify({ id: it.id, label: it.label }));
                  }}
                  onClick={() => handleInsert(it)}
                  disabled={!kernel}
                  style={!kernel ? { opacity: 0.55, cursor: 'not-allowed' } : null}>
            <span style={{ flex: 1 }}>{it.label}</span>
            {!kernel && (
              <span style={{ fontSize: 9, color: 'var(--forge-warn)',
                             border: '1px solid var(--forge-warn)',
                             borderRadius: 2, padding: '1px 4px' }}>
                kernel required
              </span>
            )}
            {kernel && it.standard && (
              <span style={{ fontSize: 9, color: 'var(--forge-ink-mute)' }}>
                {it.standard}
              </span>
            )}
          </button>
        ))}
      </div>
    </aside>
  );
}

/* =====================================================================
 * Self-mounting host. ForgeShellV4 is off-limits for this delivery, so
 * this module portals itself onto document.body and exposes:
 *
 *   window.__forgeOpenStandardParts(true|false)
 *
 * The host shell + e2e test can toggle the panel via this global. When
 * `onInsert` is needed (to register the body), set
 * `window.__forgeStandardPartsInsert = (record) => {...}` on the shell;
 * the panel forwards build() results to that callback.
 *
 * If neither callback is set, inserted bodies log to console + show a
 * toast so the user still sees feedback during development.
 * ===================================================================== */

export function StandardPartsLibraryHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeOpenStandardParts = (v) => setOpen(v === undefined ? true : !!v);
    return () => {
      try { delete window.__forgeOpenStandardParts; } catch {}
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <StandardPartsLibrary
      open={open}
      onClose={() => setOpen(false)}
      onInsert={(record) => {
        if (typeof window !== 'undefined' &&
            typeof window.__forgeStandardPartsInsert === 'function') {
          try { window.__forgeStandardPartsInsert(record); }
          catch (err) { console.warn('[forge.v4.standardParts] insert hook threw:', err); }
        } else {
          console.info('[forge.v4.standardParts] insert (no handler):', record);
        }
      }} />,
    document.body);
}

export default StandardPartsLibrary;
