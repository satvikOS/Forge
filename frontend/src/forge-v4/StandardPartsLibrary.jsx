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

/* =====================================================================
 * Forge-108 — Massive catalogue expansion.
 *
 * Builders below cover the rest of the standard parts taxonomy a real
 * mech-design library would surface: NEMA + IEC motors, gearmotors,
 * hydraulic + pneumatic actuators, V-belt + timing pulleys, sprockets,
 * roller chain, T-slot extrusion, perforated brackets, cable tray, NPT
 * fittings. Every entry composes real kernel primitives + booleans;
 * dimensions follow NEMA ICS-16, IEC 60072, ISO 6431/6432/15552, ANSI
 * B29.1/B93.1, DIN 8187, MISUMI/Bosch-Rexroth T-slot tables, ANSI B1.20.1.
 * ===================================================================== */

// NEMA stepper — square body with rounded corner pilot, front face plate
// boss + rear endcap, central shaft on +Z. body is fl×fl×L, shaft Ø×Lshaft.
function makeNemaStepper(forge, fl, L, shaftD, shaftL, pilotD, pilotH) {
  // Body: rectangular prism (chamfered corners would be ideal but we use
  // box+fillet-as-cylinders subtraction approximation via 4 quarter cuts).
  const body = forge.makeBox(fl, fl, L);
  const bodyC = forge.translate(body, -fl / 2, -fl / 2, -L);
  // Corner relief: cut a small cylinder out of each of the 4 vertical edges
  // to read as a chamfered NEMA-style body.
  const reliefR = fl * 0.06;
  let chamfered = bodyC;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const cyl = forge.makeCylinder(reliefR, L * 1.2);
    const cylT = forge.translate(cyl, (sx * fl) / 2, (sy * fl) / 2, -L * 1.1);
    chamfered = forge.cut(chamfered, cylT);
  }
  // Pilot boss on +Z face.
  const pilot = forge.makeCylinder(pilotD / 2, pilotH);
  // Shaft pokes through pilot.
  const shaft = forge.makeCylinder(shaftD / 2, shaftL);
  const shaftZ = forge.translate(shaft, 0, 0, 0);
  let stepper = forge.fuse(chamfered, pilot);
  stepper = forge.fuse(stepper, shaftZ);
  return stepper;
}

// IEC B5 flange motor — cylindrical body + circular flange with bolt holes.
// frame: outer body Ø, len, flangeD, pilotD, shaftD, shaftL, boltPCD, holes.
function makeIECFlangeMotor(forge, frameD, frameL, flangeD, flangeT,
                            pilotD, pilotH, shaftD, shaftL, boltPCD, boltN,
                            boltD) {
  const body = forge.makeCylinder(frameD / 2, frameL);
  const bodyZ = forge.translate(body, 0, 0, -frameL);
  // Cooling fin band: thin annulus along the body — approximated as a
  // slightly larger cylinder fused on the body mid-section.
  const fins = forge.makeCylinder(frameD / 2 + 2, frameL * 0.6);
  const finsZ = forge.translate(fins, 0, 0, -frameL * 0.8);
  let motor = forge.fuse(bodyZ, finsZ);
  // Flange.
  const flange = forge.makeCylinder(flangeD / 2, flangeT);
  motor = forge.fuse(motor, flange);
  // Bolt holes through flange.
  for (let i = 0; i < boltN; i++) {
    const a = (2 * PI * i) / boltN;
    const hole = forge.makeCylinder(boltD / 2, flangeT * 2.2);
    const cx = (boltPCD / 2) * Math.cos(a);
    const cy = (boltPCD / 2) * Math.sin(a);
    const holeT = forge.translate(hole, cx, cy, -flangeT * 0.1);
    motor = forge.cut(motor, holeT);
  }
  // Pilot register on +Z face.
  const pilot = forge.makeCylinder(pilotD / 2, pilotH);
  const pilotZ = forge.translate(pilot, 0, 0, flangeT);
  motor = forge.fuse(motor, pilotZ);
  // Output shaft.
  const shaft = forge.makeCylinder(shaftD / 2, shaftL);
  const shaftZ = forge.translate(shaft, 0, 0, flangeT + pilotH);
  motor = forge.fuse(motor, shaftZ);
  return motor;
}

// Planetary gearmotor — round flange front + cylindrical gearhead + motor
// stub on the back. ratio annotated in the label only (geometry identical).
function makePlanetaryGearmotor(forge, flangeD, gearL, motorD, motorL,
                                outShaftD, outShaftL) {
  const flange = forge.makeCylinder(flangeD / 2, 5);
  // 4 bolt holes through flange at 0.85 * R.
  const pcd = flangeD * 0.85;
  let assy = flange;
  for (let i = 0; i < 4; i++) {
    const a = (PI / 4) + (PI / 2) * i;
    const hole = forge.makeCylinder(2.5, 12);
    const ht = forge.translate(hole, (pcd / 2) * Math.cos(a),
                                     (pcd / 2) * Math.sin(a), -3);
    assy = forge.cut(assy, ht);
  }
  // Gearhead body (slightly smaller than flange).
  const gear = forge.makeCylinder(flangeD / 2 - 2, gearL);
  const gearZ = forge.translate(gear, 0, 0, -gearL);
  assy = forge.fuse(assy, gearZ);
  // Motor stub on rear.
  const motor = forge.makeCylinder(motorD / 2, motorL);
  const motorZ = forge.translate(motor, 0, 0, -gearL - motorL);
  assy = forge.fuse(assy, motorZ);
  // Output shaft on +Z.
  const shaft = forge.makeCylinder(outShaftD / 2, outShaftL);
  const shaftZ = forge.translate(shaft, 0, 0, 5);
  assy = forge.fuse(assy, shaftZ);
  return assy;
}

// Worm gearmotor — right-angle output. Box gearbox + motor stub on -X,
// output shaft on +Y.
function makeWormGearmotor(forge, boxW, boxH, boxD, motorD, motorL,
                           outShaftD, outShaftL) {
  const box = forge.makeBox(boxW, boxH, boxD);
  const boxC = forge.translate(box, -boxW / 2, -boxH / 2, -boxD / 2);
  // Output shaft pierces along +Y from the top centre of the box.
  const out = forge.makeCylinder(outShaftD / 2, outShaftL);
  // Rotate to align with +Y axis (default is +Z).
  const outR = forge.rotate(out, 1, 0, 0, -PI / 2);
  const outT = forge.translate(outR, 0, boxH / 2, 0);
  // Motor stub on -X face.
  const motor = forge.makeCylinder(motorD / 2, motorL);
  const motorR = forge.rotate(motor, 0, 1, 0, PI / 2);
  const motorT = forge.translate(motorR, -boxW / 2 - motorL, 0, 0);
  let g = forge.fuse(boxC, outT);
  g = forge.fuse(g, motorT);
  return g;
}

// Helical inline gearmotor — long cylindrical gearhead + motor inline on Z.
function makeHelicalInlineGearmotor(forge, gearD, gearL, motorD, motorL,
                                    outShaftD, outShaftL) {
  const gear = forge.makeCylinder(gearD / 2, gearL);
  const motor = forge.makeCylinder(motorD / 2, motorL);
  const motorZ = forge.translate(motor, 0, 0, -motorL);
  const shaft = forge.makeCylinder(outShaftD / 2, outShaftL);
  const shaftZ = forge.translate(shaft, 0, 0, gearL);
  let g = forge.fuse(gear, motorZ);
  g = forge.fuse(g, shaftZ);
  return g;
}

// Hydraulic cylinder — tube body + two end caps with port bosses + extended
// piston rod. boreD = piston Ø, rodD = rod Ø, stroke = rod extension, capT.
function makeHydraulicCylinder(forge, boreD, rodD, stroke, capT = 18) {
  const tubeOD = boreD + 18;
  const tubeID = boreD;
  const tubeL = stroke + 30;
  // Outer tube as hollow cylinder.
  const outer = forge.makeCylinder(tubeOD / 2, tubeL);
  const inner = forge.makeCylinder(tubeID / 2, tubeL * 1.2);
  const innerC = forge.translate(inner, 0, 0, -tubeL * 0.1);
  let tube = forge.cut(outer, innerC);
  // Front cap with rod hole.
  const frontCap = forge.makeCylinder(tubeOD / 2 + 3, capT);
  const frontCapZ = forge.translate(frontCap, 0, 0, tubeL);
  const rodHole = forge.makeCylinder(rodD / 2 + 0.4, capT * 1.4);
  const rodHoleZ = forge.translate(rodHole, 0, 0, tubeL - capT * 0.2);
  let assy = forge.fuse(tube, frontCapZ);
  assy = forge.cut(assy, rodHoleZ);
  // Rear cap (closed).
  const rearCap = forge.makeCylinder(tubeOD / 2 + 3, capT);
  const rearCapZ = forge.translate(rearCap, 0, 0, -capT);
  assy = forge.fuse(assy, rearCapZ);
  // Two port bosses (rear + front side).
  const portR = 6;
  const portL = 14;
  const port1 = forge.makeCylinder(portR, portL);
  const port1R = forge.rotate(port1, 1, 0, 0, -PI / 2);
  const port1T = forge.translate(port1R, 0, tubeOD / 2 + 3, -capT / 2);
  assy = forge.fuse(assy, port1T);
  const port2 = forge.makeCylinder(portR, portL);
  const port2R = forge.rotate(port2, 1, 0, 0, -PI / 2);
  const port2T = forge.translate(port2R, 0, tubeOD / 2 + 3, tubeL + capT / 2);
  assy = forge.fuse(assy, port2T);
  // Piston rod (extended position — sticking out by `stroke`).
  const rod = forge.makeCylinder(rodD / 2, stroke + 30);
  const rodZ = forge.translate(rod, 0, 0, tubeL - 5);
  assy = forge.fuse(assy, rodZ);
  // Rod-end clevis: small block on the rod end with a pin hole.
  const clevis = forge.makeBox(rodD * 2, rodD * 1.2, rodD * 0.6);
  const clevisC = forge.translate(clevis, -rodD, -rodD * 0.6, tubeL + stroke + 30);
  const pinHole = forge.makeCylinder(rodD / 2 * 0.7, rodD * 2);
  const pinHoleR = forge.rotate(pinHole, 1, 0, 0, PI / 2);
  const pinHoleT = forge.translate(pinHoleR, 0, rodD,
                                   tubeL + stroke + 30 + rodD * 0.3);
  const clevisCut = forge.cut(clevisC, pinHoleT);
  assy = forge.fuse(assy, clevisCut);
  return assy;
}

// ISO 6432 pneumatic mini cylinder — round body, no tie-rods, M-thread
// rod end. boreD ∈ {16,20,25}, stroke ∈ {50,100}.
function makeIso6432Cylinder(forge, boreD, stroke) {
  const tubeOD = boreD + 6;
  const tubeL = stroke + 24;
  const tube = forge.makeCylinder(tubeOD / 2, tubeL);
  const innerCut = forge.makeCylinder(boreD / 2, tubeL * 1.2);
  const innerCutZ = forge.translate(innerCut, 0, 0, -tubeL * 0.1);
  let assy = forge.cut(tube, innerCutZ);
  // Rear M-thread mounting stud.
  const stud = forge.makeCylinder(4, 14);
  const studZ = forge.translate(stud, 0, 0, -14);
  assy = forge.fuse(assy, studZ);
  // Rod.
  const rodD = boreD * 0.35;
  const rod = forge.makeCylinder(rodD / 2, stroke + 20);
  const rodZ = forge.translate(rod, 0, 0, tubeL - 4);
  assy = forge.fuse(assy, rodZ);
  // M-thread on rod end (cylinder stub).
  const studF = forge.makeCylinder(rodD * 0.6 / 2, 12);
  const studFZ = forge.translate(studF, 0, 0, tubeL + stroke + 16);
  assy = forge.fuse(assy, studFZ);
  return assy;
}

// ISO 15552 pneumatic cylinder — square heads + tie-rods. boreD ∈
// {32,40,50,63,80}, stroke ∈ {100,200}.
function makeIso15552Cylinder(forge, boreD, stroke) {
  // Square head dimension per ISO 15552 — roughly bore + 24mm.
  const head = boreD + 24;
  const tubeOD = boreD + 10;
  const headT = 18;
  // Tube.
  const tube = forge.makeCylinder(tubeOD / 2, stroke + 30);
  const inner = forge.makeCylinder(boreD / 2, stroke + 50);
  const innerC = forge.translate(inner, 0, 0, -10);
  let assy = forge.cut(tube, innerC);
  // Square rear head.
  const rear = forge.makeBox(head, head, headT);
  const rearC = forge.translate(rear, -head / 2, -head / 2, -headT);
  assy = forge.fuse(assy, rearC);
  // Square front head with rod through-hole.
  const front = forge.makeBox(head, head, headT);
  const frontC = forge.translate(front, -head / 2, -head / 2, stroke + 30);
  const rodD = boreD * 0.4;
  const frontHole = forge.makeCylinder(rodD / 2 + 0.5, headT * 1.4);
  const frontHoleZ = forge.translate(frontHole, 0, 0, stroke + 30 - headT * 0.2);
  const frontCut = forge.cut(frontC, frontHoleZ);
  assy = forge.fuse(assy, frontCut);
  // 4 tie-rods between heads.
  const rodOff = head * 0.38;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const tr = forge.makeCylinder(3, stroke + 30 + 2 * headT);
    const trT = forge.translate(tr, sx * rodOff, sy * rodOff, -headT);
    assy = forge.fuse(assy, trT);
  }
  // Piston rod extended by `stroke`.
  const rod = forge.makeCylinder(rodD / 2, stroke + 30);
  const rodZ = forge.translate(rod, 0, 0, stroke + 20);
  assy = forge.fuse(assy, rodZ);
  return assy;
}

// V-belt pulley — A/B section. OD, grooves count. groove geometry per
// SAE J636 / ISO 4184: A 13mm top × 8mm deep, B 17mm × 11mm.
function makeVBeltPulley(forge, OD, grooves, section = 'A', bore = 12,
                         hubD = null, hubL = null) {
  const grooveW = section === 'A' ? 13 : 17;
  const grooveD = section === 'A' ? 8 : 11;
  const sidewall = 4;                                  // wall between grooves
  const totalW = grooves * grooveW + (grooves + 1) * sidewall;
  let blank = forge.makeCylinder(OD / 2, totalW);
  // Cut each groove as a torus (approximating V-groove section).
  for (let i = 0; i < grooves; i++) {
    const z = sidewall + grooveW / 2 + i * (grooveW + sidewall);
    const tor = forge.makeTorus(OD / 2 - grooveD * 0.4, grooveW / 2);
    const torZ = forge.translate(tor, 0, 0, z);
    blank = forge.cut(blank, torZ);
  }
  // Hub boss.
  const hd = hubD || Math.min(OD * 0.45, bore * 2.5 + 14);
  const hl = hubL || totalW + 8;
  const hub = forge.makeCylinder(hd / 2, hl);
  const hubZ = forge.translate(hub, 0, 0, -4);
  let assy = forge.fuse(blank, hubZ);
  // Bore.
  const boreCyl = forge.makeCylinder(bore / 2, hl * 1.4);
  const boreC = forge.translate(boreCyl, 0, 0, -hl * 0.2);
  assy = forge.cut(assy, boreC);
  return assy;
}

// Timing pulley — HTD profile. pitch ∈ {3,5,8}, teeth count z, belt width.
function makeTimingPulley(forge, pitch, z, beltW = 15, bore = 6) {
  // Pitch diameter = pitch * z / PI.
  const pd = (pitch * z) / PI;
  const od = pd + pitch * 0.2;
  const totalW = beltW + 4;
  // Blank.
  let blank = forge.makeCylinder(od / 2, totalW);
  // Flanges (slightly larger discs at each end).
  const flange1 = forge.makeCylinder(od / 2 + 2, 2);
  const flange2 = forge.makeCylinder(od / 2 + 2, 2);
  const flange2Z = forge.translate(flange2, 0, 0, totalW - 2);
  blank = forge.fuse(blank, flange1);
  blank = forge.fuse(blank, flange2Z);
  // Teeth (approximated as small box cuts every 360/z degrees on the
  // pulley OD).
  const toothW = pitch * 0.45;
  const toothH = pitch * 0.35;
  for (let i = 0; i < z; i++) {
    const a = (2 * PI * i) / z;
    const tooth = forge.makeBox(toothW, toothH, beltW);
    const tt = forge.translate(tooth, -toothW / 2, od / 2 - toothH * 0.4, 2);
    const tr = forge.rotate(tt, 0, 0, 1, a);
    blank = forge.cut(blank, tr);
  }
  // Bore.
  const boreCyl = forge.makeCylinder(bore / 2, totalW * 1.4);
  const boreC = forge.translate(boreCyl, 0, 0, -totalW * 0.2);
  blank = forge.cut(blank, boreC);
  return blank;
}

// Sprocket — flat disc with cut tooth profile. pitch (ANSI inches→mm),
// teeth z, thickness based on chain width.
function makeSprocket(forge, pitch, z, thickness, bore = 8) {
  // Pitch diameter = pitch / sin(180/z).
  const pd = pitch / Math.sin(PI / z);
  const od = pd + pitch * 0.35;
  const rootR = pd / 2 - pitch * 0.45;
  let blank = forge.makeCylinder(od / 2, thickness);
  // Cut tooth gaps as small cylinders at PCD around the perimeter.
  const gapR = pitch * 0.32;
  for (let i = 0; i < z; i++) {
    const a = (2 * PI * i) / z;
    const cx = (pd / 2) * Math.cos(a);
    const cy = (pd / 2) * Math.sin(a);
    const gap = forge.makeCylinder(gapR, thickness * 1.4);
    const gapT = forge.translate(gap, cx, cy, -thickness * 0.2);
    blank = forge.cut(blank, gapT);
  }
  // Bore.
  const boreCyl = forge.makeCylinder(bore / 2, thickness * 1.4);
  const boreC = forge.translate(boreCyl, 0, 0, -thickness * 0.2);
  blank = forge.cut(blank, boreC);
  return blank;
}

// Roller chain segment — series of cylindrical rollers + side plates.
// pitch in mm, rollerD, plateH, length total ≈ 100mm.
function makeRollerChainSegment(forge, pitch, rollerD, plateH, plateT,
                                segmentL = 100) {
  const linkCount = Math.max(2, Math.floor(segmentL / pitch));
  let assy = null;
  for (let i = 0; i < linkCount; i++) {
    const cx = i * pitch;
    // Roller.
    const roller = forge.makeCylinder(rollerD / 2, pitch * 0.55);
    const rollerR = forge.rotate(roller, 1, 0, 0, PI / 2);
    const rollerT = forge.translate(rollerR, cx, -pitch * 0.275, 0);
    assy = assy ? forge.fuse(assy, rollerT) : rollerT;
    // Side plate (alternating inner/outer — we draw one figure-8 plate
    // per link).
    if (i < linkCount - 1) {
      const plateL = pitch + rollerD * 0.6;
      const plate = forge.makeBox(plateL, plateT, plateH);
      const plateT2 = forge.translate(plate, cx - rollerD * 0.3,
                                      pitch * 0.32, -plateH / 2);
      const plateNeg = forge.translate(plate, cx - rollerD * 0.3,
                                       -pitch * 0.32 - plateT, -plateH / 2);
      assy = forge.fuse(assy, plateT2);
      assy = forge.fuse(assy, plateNeg);
    }
  }
  return assy;
}

// T-slot extrusion — square outer with 4 T-slot grooves + central bore.
// side = nominal (20 or 40), length, slotW = slot opening width.
function makeTslotExtrusion(forge, side, length, slotW = null,
                            slotDepth = null) {
  const sw = slotW || (side === 20 ? 6 : 10);
  const sd = slotDepth || (side === 20 ? 7 : 14);
  // Outer block.
  const outer = forge.makeBox(side, side, length);
  const outerC = forge.translate(outer, -side / 2, -side / 2, -length / 2);
  let assy = outerC;
  // Slot on each of 4 faces: a slot box cut, plus a wider T cavity
  // behind it.
  for (let i = 0; i < 4; i++) {
    const slot = forge.makeBox(sw, sd, length + 4);
    const slotT = forge.translate(slot, -sw / 2, side / 2 - sd, -length / 2 - 2);
    const cavity = forge.makeBox(sw * 1.8, sd * 0.6, length + 4);
    const cavityT = forge.translate(cavity, -sw * 0.9,
                                    side / 2 - sd + sw * 0.1,
                                    -length / 2 - 2);
    const combo = forge.fuse(slotT, cavityT);
    const comboR = forge.rotate(combo, 0, 0, 1, (PI / 2) * i);
    assy = forge.cut(assy, comboR);
  }
  // Central bore.
  const boreD = side === 20 ? 4.2 : 8.5;
  const bore = forge.makeCylinder(boreD / 2, length + 4);
  const boreT = forge.translate(bore, 0, 0, -length / 2 - 2);
  assy = forge.cut(assy, boreT);
  return assy;
}

// Rectangular T-slot extrusion: two T-slot squares fused side by side.
function makeTslotRectExtrusion(forge, w, h, length) {
  const base = h;                                      // square module size
  const modules = w / base;
  let assy = null;
  for (let i = 0; i < modules; i++) {
    const ext = makeTslotExtrusion(forge, base, length);
    const extT = forge.translate(ext, (i - (modules - 1) / 2) * base, 0, 0);
    assy = assy ? forge.fuse(assy, extT) : extT;
  }
  return assy;
}

// Perforated L-bracket — angle profile cut from boxes + hole grid.
function makeLBracket(forge, profileSize, length, t = 3, holeD = null,
                     pitch = null) {
  const hd = holeD || (profileSize === 20 ? 5 : 8);
  const p = pitch || profileSize;
  // L-angle: two perpendicular flat strips meeting at the inside corner.
  const arm1 = forge.makeBox(profileSize, t, length);
  const arm1C = forge.translate(arm1, -profileSize / 2,
                                -profileSize / 2, -length / 2);
  const arm2 = forge.makeBox(t, profileSize, length);
  const arm2C = forge.translate(arm2, -profileSize / 2,
                                -profileSize / 2, -length / 2);
  let bracket = forge.fuse(arm1C, arm2C);
  // Hole grid on each arm.
  const cnt = Math.max(1, Math.floor(length / p));
  for (let i = 0; i < cnt; i++) {
    const z = -length / 2 + (i + 0.5) * p;
    const hole1 = forge.makeCylinder(hd / 2, profileSize);
    const hole1R = forge.rotate(hole1, 1, 0, 0, PI / 2);
    const hole1T = forge.translate(hole1R, 0, -profileSize / 2 + t / 2 - 2, z);
    bracket = forge.cut(bracket, hole1T);
    const hole2 = forge.makeCylinder(hd / 2, profileSize);
    const hole2R = forge.rotate(hole2, 0, 1, 0, PI / 2);
    const hole2T = forge.translate(hole2R, -profileSize / 2 + t / 2 - 2, 0, z);
    bracket = forge.cut(bracket, hole2T);
  }
  return bracket;
}

// Perforated T-bracket: three arm cross.
function makeTBracket(forge, profileSize, length, t = 3, holeD = null) {
  const hd = holeD || (profileSize === 20 ? 5 : 8);
  // Horizontal bar.
  const horiz = forge.makeBox(length, profileSize, t);
  const horizC = forge.translate(horiz, -length / 2, -profileSize / 2, -t / 2);
  // Vertical arm going down (positive-Y → -Y).
  const vert = forge.makeBox(profileSize, length / 2, t);
  const vertC = forge.translate(vert, -profileSize / 2, -length / 2, -t / 2);
  let bracket = forge.fuse(horizC, vertC);
  // Mounting holes — 4 on horizontal, 2 on vertical.
  const positions = [
    [-length / 3, 0], [length / 3, 0], [-length / 2 + profileSize / 2, 0],
    [length / 2 - profileSize / 2, 0],
    [0, -length / 4], [0, -length / 2 + profileSize / 2],
  ];
  for (const [px, py] of positions) {
    const hole = forge.makeCylinder(hd / 2, t * 2);
    const holeT = forge.translate(hole, px, py, -t);
    bracket = forge.cut(bracket, holeT);
  }
  return bracket;
}

// Gusseted corner bracket — triangular flat plate with two perpendicular
// tabs + bolt holes.
function makeGussetedCorner(forge, profileSize, t = 4, holeD = null) {
  const hd = holeD || (profileSize === 20 ? 5 : 8);
  const arm = profileSize * 2;
  // Diagonal gusset: triangle approximated as box rotated 45°, cut against
  // a clipping plane (two cuts to form the triangle).
  const gusset = forge.makeBox(arm * 1.4, arm * 1.4, t);
  const gussetR = forge.rotate(gusset, 0, 0, 1, PI / 4);
  const gussetT = forge.translate(gussetR, 0, 0, -t / 2);
  // Trim with bounding box.
  const clip = forge.makeBox(arm, arm, t * 2);
  const clipT = forge.translate(clip, -arm, -arm, -t);
  let g = forge.common(gussetT, clipT);
  // Add two perpendicular flange tabs.
  const tab1 = forge.makeBox(arm, t, profileSize);
  const tab1T = forge.translate(tab1, -arm, -t, -profileSize / 2);
  g = forge.fuse(g, tab1T);
  const tab2 = forge.makeBox(t, arm, profileSize);
  const tab2T = forge.translate(tab2, -t, -arm, -profileSize / 2);
  g = forge.fuse(g, tab2T);
  // Bolt holes on each tab.
  const hole1 = forge.makeCylinder(hd / 2, t * 4);
  const hole1R = forge.rotate(hole1, 1, 0, 0, PI / 2);
  const hole1T = forge.translate(hole1R, -profileSize, t, 0);
  g = forge.cut(g, hole1T);
  const hole2 = forge.makeCylinder(hd / 2, t * 4);
  const hole2R = forge.rotate(hole2, 0, 1, 0, PI / 2);
  const hole2T = forge.translate(hole2R, t, -profileSize, 0);
  g = forge.cut(g, hole2T);
  return g;
}

// Wire-mesh cable tray — U-channel with a grid of "wire" bars. width mm,
// length (3000 default), depth 50mm.
function makeWireMeshCableTray(forge, width, length, depth = 50) {
  // Side rails: 2 thin bars running the length on each side at top + bottom.
  const railR = 2;
  let assy = null;
  for (const [yOff, zOff] of [[width / 2, 0], [width / 2, depth],
                              [-width / 2, 0], [-width / 2, depth]]) {
    const rail = forge.makeCylinder(railR, length);
    const railT = forge.translate(rail, 0, yOff, zOff);
    const railR2 = forge.rotate(railT, 1, 0, 0, PI / 2);
    // Re-translate after rotation: rotate around X swaps Y/Z; build the
    // rail along +Y by rotating the +Z cylinder.
    const rail2 = forge.makeCylinder(railR, length);
    const rail2T = forge.translate(rail2, 0, 0, -length / 2);
    const rail2R = forge.rotate(rail2T, 1, 0, 0, PI / 2);
    const rail2F = forge.translate(rail2R, yOff, 0, zOff);
    assy = assy ? forge.fuse(assy, rail2F) : rail2F;
  }
  // Transverse U-shaped ribs every 75 mm.
  const ribCount = Math.max(2, Math.floor(length / 75));
  for (let i = 0; i < ribCount; i++) {
    const y = -length / 2 + (i + 0.5) * (length / ribCount);
    // Two vertical legs + a base bar.
    const baseBar = forge.makeCylinder(railR, width);
    const baseR = forge.rotate(baseBar, 0, 1, 0, PI / 2);
    const baseT = forge.translate(baseR, -width / 2, y, 0);
    assy = forge.fuse(assy, baseT);
    const leg1 = forge.makeCylinder(railR, depth);
    const leg1T = forge.translate(leg1, width / 2, y, 0);
    assy = forge.fuse(assy, leg1T);
    const leg2 = forge.makeCylinder(railR, depth);
    const leg2T = forge.translate(leg2, -width / 2, y, 0);
    assy = forge.fuse(assy, leg2T);
  }
  return assy;
}

// NPT fitting body — cylindrical fitting with port hub on one or two
// ends; angles configurable for elbow + tee. nominalD = nominal pipe
// thread (e.g. 1/4 in = 13.7mm OD).
const NPT_OD = { '1/4': 13.72, '3/8': 17.15, '1/2': 21.34 };
function makeNptStraight(forge, sizeKey) {
  const od = NPT_OD[sizeKey];
  const id = od - 5;
  const L = 38;
  const outer = forge.makeCylinder(od / 2 + 2, L);
  const hex = makeHexPrism(forge, od * 1.6, 12);
  const hexT = forge.translate(hex, 0, 0, L / 2 - 6);
  let assy = forge.fuse(outer, hexT);
  // Through bore.
  const bore = forge.makeCylinder(id / 2, L * 1.4);
  const boreC = forge.translate(bore, 0, 0, -L * 0.2);
  assy = forge.cut(assy, boreC);
  return assy;
}
function makeNptElbow(forge, sizeKey) {
  const od = NPT_OD[sizeKey];
  const id = od - 5;
  const L = 26;
  // Arm 1 along +Z.
  const arm1 = forge.makeCylinder(od / 2 + 2, L);
  // Arm 2 along +X, fused at the elbow.
  const arm2 = forge.makeCylinder(od / 2 + 2, L);
  const arm2R = forge.rotate(arm2, 0, 1, 0, PI / 2);
  let assy = forge.fuse(arm1, arm2R);
  // Hex collar at the elbow.
  const collar = forge.makeSphere(od / 2 + 4);
  assy = forge.fuse(assy, collar);
  // Through bore arm1.
  const bore1 = forge.makeCylinder(id / 2, L * 1.4);
  const bore1C = forge.translate(bore1, 0, 0, -L * 0.2);
  assy = forge.cut(assy, bore1C);
  const bore2 = forge.makeCylinder(id / 2, L * 1.4);
  const bore2R = forge.rotate(bore2, 0, 1, 0, PI / 2);
  const bore2T = forge.translate(bore2R, -L * 0.2, 0, 0);
  assy = forge.cut(assy, bore2T);
  return assy;
}
function makeNptTee(forge, sizeKey) {
  const od = NPT_OD[sizeKey];
  const id = od - 5;
  const L = 24;
  // Run along Z.
  const run = forge.makeCylinder(od / 2 + 2, L * 2);
  const runT = forge.translate(run, 0, 0, -L);
  // Branch along +X from mid.
  const branch = forge.makeCylinder(od / 2 + 2, L);
  const branchR = forge.rotate(branch, 0, 1, 0, PI / 2);
  let assy = forge.fuse(runT, branchR);
  // Sphere at the junction.
  const ball = forge.makeSphere(od / 2 + 3);
  assy = forge.fuse(assy, ball);
  // Through bores.
  const boreR = forge.makeCylinder(id / 2, L * 2.4);
  const boreRT = forge.translate(boreR, 0, 0, -L * 1.2);
  assy = forge.cut(assy, boreRT);
  const boreB = forge.makeCylinder(id / 2, L * 1.4);
  const boreBR = forge.rotate(boreB, 0, 1, 0, PI / 2);
  const boreBT = forge.translate(boreBR, -L * 0.2, 0, 0);
  assy = forge.cut(assy, boreBT);
  return assy;
}

/* =====================================================================
 * Forge-108 — Catalogue tables (real engineering data).
 * ===================================================================== */

// NEMA ICS-16 stepper frames — flange × length × shaft × pilot.
const NEMA_STEPPERS = {
  'NEMA 17': { fl: 42,  L: 40, shaftD: 5,    shaftL: 22, pilotD: 22, pilotH: 2 },
  'NEMA 23': { fl: 57,  L: 56, shaftD: 6.35, shaftL: 24, pilotD: 38.1, pilotH: 1.6 },
  'NEMA 34': { fl: 86,  L: 80, shaftD: 14,   shaftL: 33, pilotD: 73, pilotH: 2 },
  'NEMA 42': { fl: 110, L: 99, shaftD: 19,   shaftL: 38, pilotD: 55, pilotH: 2 },
};

// IEC 60072 B5 flange motors. Frame N, B5 dims: frame Ø, body L, flange
// (M) Ø, flange T, pilot (N) Ø, pilot H, shaft Ø, shaft L, bolt PCD, holes,
// bolt Ø.
const IEC_B5_MOTORS = {
  'IEC 63 B5':  { frameD: 110, frameL: 195, flangeD: 140, flangeT: 10,
                  pilotD:  95, pilotH: 3, shaftD: 11, shaftL: 23,
                  boltPCD: 115, boltN: 4, boltD: 9 },
  'IEC 71 B5':  { frameD: 130, frameL: 220, flangeD: 160, flangeT: 11,
                  pilotD: 110, pilotH: 3.5, shaftD: 14, shaftL: 30,
                  boltPCD: 130, boltN: 4, boltD: 9 },
  'IEC 80 B5':  { frameD: 150, frameL: 250, flangeD: 200, flangeT: 12,
                  pilotD: 130, pilotH: 3.5, shaftD: 19, shaftL: 40,
                  boltPCD: 165, boltN: 4, boltD: 11 },
  'IEC 90 B5':  { frameD: 170, frameL: 290, flangeD: 200, flangeT: 12,
                  pilotD: 130, pilotH: 3.5, shaftD: 24, shaftL: 50,
                  boltPCD: 165, boltN: 4, boltD: 11 },
  'IEC 100 B5': { frameD: 195, frameL: 340, flangeD: 250, flangeT: 14,
                  pilotD: 180, pilotH: 4, shaftD: 28, shaftL: 60,
                  boltPCD: 215, boltN: 4, boltD: 14 },
};

// Hydraulic cylinder selection (bore × stroke). 8 representative.
const HYD_CYL = [
  { bore: 25,  rod: 12, stroke: 50  },
  { bore: 25,  rod: 12, stroke: 100 },
  { bore: 40,  rod: 22, stroke: 100 },
  { bore: 40,  rod: 22, stroke: 200 },
  { bore: 63,  rod: 36, stroke: 100 },
  { bore: 63,  rod: 36, stroke: 200 },
  { bore: 80,  rod: 45, stroke: 200 },
  { bore: 100, rod: 56, stroke: 200 },
];

// Pneumatic combinations.
const PNEU_6432  = [
  { bore: 16, stroke: 50 },  { bore: 16, stroke: 100 },
  { bore: 20, stroke: 50 },  { bore: 20, stroke: 100 },
  { bore: 25, stroke: 50 },  { bore: 25, stroke: 100 },
];
const PNEU_15552 = [
  { bore: 32, stroke: 100 }, { bore: 32, stroke: 200 },
  { bore: 40, stroke: 100 }, { bore: 40, stroke: 200 },
  { bore: 50, stroke: 100 }, { bore: 50, stroke: 200 },
  { bore: 63, stroke: 100 }, { bore: 63, stroke: 200 },
  { bore: 80, stroke: 100 }, { bore: 80, stroke: 200 },
];

// V-belt pulley specs (A & B sections, OD set, groove counts).
const VBELT_PULLEYS = [
  { section: 'A', OD: 60  }, { section: 'A', OD: 100 },
  { section: 'A', OD: 160 }, { section: 'A', OD: 250 },
  { section: 'B', OD: 60  }, { section: 'B', OD: 100 },
  { section: 'B', OD: 160 }, { section: 'B', OD: 250 },
];

// Timing pulley specs — HTD profiles.
const TIMING_PROFILES = [
  { pitch: 3, code: 'HTD 3M' },
  { pitch: 5, code: 'HTD 5M' },
  { pitch: 8, code: 'HTD 8M' },
];
const TIMING_TEETH = [20, 30, 40, 60];

// ANSI chain pitches (mm).
const ANSI_CHAIN = {
  '#25': { pitch: 6.35,  rollerD: 3.3,  plateH: 6.0,  plateT: 0.76, chainW: 3.18 },
  '#35': { pitch: 9.525, rollerD: 5.08, plateH: 9.0,  plateT: 1.27, chainW: 4.78 },
  '#40': { pitch: 12.7,  rollerD: 7.92, plateH: 12.0, plateT: 1.5,  chainW: 7.95 },
  '#50': { pitch: 15.875, rollerD: 10.16, plateH: 15.0, plateT: 2.03, chainW: 9.53 },
};
const SPROCKET_TEETH = [15, 20, 30, 45];

// T-slot extrusion dim table.
const TSLOT_20 = [
  { code: '20×20', w: 20,  h: 20 },
  { code: '20×40', w: 40,  h: 20 },
  { code: '20×80', w: 80,  h: 20 },
];
const TSLOT_40 = [
  { code: '40×40',  w: 40,   h: 40 },
  { code: '40×80',  w: 80,   h: 40 },
  { code: '40×160', w: 160,  h: 40 },
];

const NPT_SIZES = ['1/4', '3/8', '1/2'];
const NPT_FORMS = ['Straight', 'Elbow 90°', 'Tee'];

const PLANETARY_RATIOS = [5, 10, 50];
const WORM_RATIOS = [30, 60];

/* =====================================================================
 * Forge-108 — entry builders.
 * ===================================================================== */

function buildMotorEntries() {
  const out = [];
  for (const [code, d] of Object.entries(NEMA_STEPPERS)) {
    out.push({
      id: `motor-${code.toLowerCase().replace(/\s+/g, '-')}`,
      category: 'motors',
      subcat: 'Stepper',
      label: `${code} stepper`,
      standard: 'NEMA ICS-16',
      tags: ['motor', 'stepper', 'nema', code],
      build: (forge) => makeNemaStepper(forge, d.fl, d.L, d.shaftD,
                                        d.shaftL, d.pilotD, d.pilotH),
    });
  }
  for (const [code, d] of Object.entries(IEC_B5_MOTORS)) {
    out.push({
      id: `motor-${code.toLowerCase().replace(/\s+/g, '-')}`,
      category: 'motors',
      subcat: 'IEC B5',
      label: `${code} flange motor`,
      standard: 'IEC 60072',
      tags: ['motor', 'iec', 'b5', code],
      build: (forge) => makeIECFlangeMotor(forge, d.frameD, d.frameL,
        d.flangeD, d.flangeT, d.pilotD, d.pilotH, d.shaftD, d.shaftL,
        d.boltPCD, d.boltN, d.boltD),
    });
  }
  return out;
}

function buildGearmotorEntries() {
  const out = [];
  for (const ratio of PLANETARY_RATIOS) {
    out.push({
      id: `gearmotor-planetary-42-${ratio}`,
      category: 'gearmotors',
      subcat: 'Planetary',
      label: `Planetary 42mm ${ratio}:1`,
      standard: 'DIN 42948',
      tags: ['gearmotor', 'planetary', `${ratio}:1`],
      build: (forge) => makePlanetaryGearmotor(forge, 42, 50, 36, 60, 8, 25),
    });
  }
  for (const ratio of WORM_RATIOS) {
    out.push({
      id: `gearmotor-worm-50-${ratio}`,
      category: 'gearmotors',
      subcat: 'Worm',
      label: `Worm 50mm right-angle ${ratio}:1`,
      standard: 'ISO 4019',
      tags: ['gearmotor', 'worm', 'right-angle', `${ratio}:1`],
      build: (forge) => makeWormGearmotor(forge, 70, 60, 50, 60, 60, 12, 30),
    });
  }
  out.push({
    id: 'gearmotor-helical-inline-70-10',
    category: 'gearmotors',
    subcat: 'Helical inline',
    label: 'Helical inline 70mm 10:1',
    standard: 'IEC 60034',
    tags: ['gearmotor', 'helical', 'inline'],
    build: (forge) => makeHelicalInlineGearmotor(forge, 70, 80, 60, 100, 14, 35),
  });
  return out;
}

function buildHydraulicEntries() {
  return HYD_CYL.map((d) => ({
    id: `hyd-cyl-${d.bore}x${d.stroke}`,
    category: 'hydraulic',
    subcat: 'Cylinder',
    label: `Hydraulic Ø${d.bore} stroke ${d.stroke}`,
    standard: 'ISO 6020-2',
    tags: ['hydraulic', 'cylinder', `bore${d.bore}`, `stroke${d.stroke}`],
    build: (forge) => makeHydraulicCylinder(forge, d.bore, d.rod, d.stroke),
  }));
}

function buildPneumaticEntries() {
  const out = [];
  for (const d of PNEU_6432) {
    out.push({
      id: `pneu-6432-${d.bore}x${d.stroke}`,
      category: 'pneumatic',
      subcat: 'ISO 6432',
      label: `ISO 6432 mini Ø${d.bore} × ${d.stroke}`,
      standard: 'ISO 6432',
      tags: ['pneumatic', 'mini', 'iso6432', `bore${d.bore}`],
      build: (forge) => makeIso6432Cylinder(forge, d.bore, d.stroke),
    });
  }
  for (const d of PNEU_15552) {
    out.push({
      id: `pneu-15552-${d.bore}x${d.stroke}`,
      category: 'pneumatic',
      subcat: 'ISO 15552',
      label: `ISO 15552 profile Ø${d.bore} × ${d.stroke}`,
      standard: 'ISO 15552',
      tags: ['pneumatic', 'iso15552', `bore${d.bore}`],
      build: (forge) => makeIso15552Cylinder(forge, d.bore, d.stroke),
    });
  }
  return out;
}

function buildVBeltEntries() {
  const out = [];
  for (const p of VBELT_PULLEYS) {
    for (const g of [1, 2, 3]) {
      out.push({
        id: `vbelt-${p.section.toLowerCase()}-${p.OD}-${g}g`,
        category: 'pulleys',
        subcat: 'V-belt',
        label: `V-belt ${p.section}-section Ø${p.OD} ${g}-groove`,
        standard: 'ISO 4184',
        tags: ['pulley', 'vbelt', p.section, `Ø${p.OD}`, `${g}gr`],
        build: (forge) => makeVBeltPulley(forge, p.OD, g, p.section,
                                          Math.min(20, p.OD * 0.18)),
      });
    }
  }
  return out;
}

function buildTimingPulleyEntries() {
  const out = [];
  for (const prof of TIMING_PROFILES) {
    for (const z of TIMING_TEETH) {
      out.push({
        id: `timing-${prof.code.toLowerCase().replace(/\s+/g, '-')}-z${z}`,
        category: 'pulleys',
        subcat: 'Timing',
        label: `${prof.code} z=${z}`,
        standard: 'ISO 5294',
        tags: ['pulley', 'timing', prof.code, `z${z}`],
        build: (forge) => makeTimingPulley(forge, prof.pitch, z, 15, 6),
      });
    }
  }
  return out;
}

function buildSprocketEntries() {
  const out = [];
  for (const [code, d] of Object.entries(ANSI_CHAIN)) {
    for (const z of SPROCKET_TEETH) {
      out.push({
        id: `sprocket-${code.replace('#', '')}-z${z}`,
        category: 'sprockets',
        subcat: code,
        label: `Sprocket ANSI ${code} z=${z}`,
        standard: 'ANSI B29.1',
        tags: ['sprocket', code, `z${z}`],
        build: (forge) => makeSprocket(forge, d.pitch, z,
                                       d.chainW + 2, 10),
      });
    }
  }
  return out;
}

function buildRollerChainEntries() {
  const out = [];
  for (const [code, d] of Object.entries(ANSI_CHAIN)) {
    out.push({
      id: `chain-${code.replace('#', '')}-100`,
      category: 'chain',
      subcat: code,
      label: `Roller chain ANSI ${code} × 100mm`,
      standard: 'ANSI B29.1',
      tags: ['chain', 'roller', code],
      build: (forge) => makeRollerChainSegment(forge, d.pitch, d.rollerD,
                                                d.plateH, d.plateT, 100),
    });
  }
  return out;
}

function buildExtrusionEntries() {
  const out = [];
  for (const e of TSLOT_20) {
    out.push({
      id: `tslot-20-${e.w}x${e.h}`,
      category: 'extrusion',
      subcat: '20-series',
      label: `T-slot ${e.code} × 1000mm`,
      standard: 'Bosch-Rexroth 20',
      tags: ['extrusion', 'tslot', '20', e.code],
      build: (forge) => (e.w === e.h
        ? makeTslotExtrusion(forge, 20, 1000)
        : makeTslotRectExtrusion(forge, e.w, e.h, 1000)),
    });
  }
  for (const e of TSLOT_40) {
    out.push({
      id: `tslot-40-${e.w}x${e.h}`,
      category: 'extrusion',
      subcat: '40-series',
      label: `T-slot ${e.code} × 1000mm`,
      standard: 'Bosch-Rexroth 40',
      tags: ['extrusion', 'tslot', '40', e.code],
      build: (forge) => (e.w === e.h
        ? makeTslotExtrusion(forge, 40, 1000)
        : makeTslotRectExtrusion(forge, e.w, e.h, 1000)),
    });
  }
  return out;
}

function buildBracketEntries() {
  const out = [];
  for (const sz of [20, 40]) {
    out.push({
      id: `bracket-l-${sz}`,
      category: 'brackets',
      subcat: 'L-bracket',
      label: `L-bracket ${sz}-series`,
      standard: 'Bosch-Rexroth',
      tags: ['bracket', 'L', `${sz}`],
      build: (forge) => makeLBracket(forge, sz, sz * 2),
    });
    out.push({
      id: `bracket-t-${sz}`,
      category: 'brackets',
      subcat: 'T-bracket',
      label: `T-bracket ${sz}-series`,
      standard: 'Bosch-Rexroth',
      tags: ['bracket', 'T', `${sz}`],
      build: (forge) => makeTBracket(forge, sz, sz * 3),
    });
    out.push({
      id: `bracket-gusset-${sz}`,
      category: 'brackets',
      subcat: 'Gusseted corner',
      label: `Gusseted corner ${sz}-series`,
      standard: 'Bosch-Rexroth',
      tags: ['bracket', 'gusset', `${sz}`],
      build: (forge) => makeGussetedCorner(forge, sz),
    });
  }
  return out;
}

function buildCableTrayEntries() {
  return [100, 200, 300].map((w) => ({
    id: `cable-tray-${w}`,
    category: 'cable',
    subcat: 'Wire mesh',
    label: `Wire mesh cable tray ${w}mm × 3m`,
    standard: 'IEC 61537',
    tags: ['cable', 'tray', `${w}mm`],
    build: (forge) => makeWireMeshCableTray(forge, w, 3000, 50),
  }));
}

function buildHoseFittingEntries() {
  const out = [];
  for (const sz of NPT_SIZES) {
    out.push({
      id: `npt-straight-${sz.replace('/', '-')}`,
      category: 'fittings',
      subcat: 'NPT straight',
      label: `NPT ${sz}" straight`,
      standard: 'ANSI B1.20.1',
      tags: ['fitting', 'npt', 'straight', sz],
      build: (forge) => makeNptStraight(forge, sz),
    });
    out.push({
      id: `npt-elbow-${sz.replace('/', '-')}`,
      category: 'fittings',
      subcat: 'NPT elbow',
      label: `NPT ${sz}" 90° elbow`,
      standard: 'ANSI B1.20.1',
      tags: ['fitting', 'npt', 'elbow', sz],
      build: (forge) => makeNptElbow(forge, sz),
    });
    out.push({
      id: `npt-tee-${sz.replace('/', '-')}`,
      category: 'fittings',
      subcat: 'NPT tee',
      label: `NPT ${sz}" tee`,
      standard: 'ANSI B1.20.1',
      tags: ['fitting', 'npt', 'tee', sz],
      build: (forge) => makeNptTee(forge, sz),
    });
  }
  return out;
}

const CATALOGUE = [
  ...buildFastenerEntries(),
  ...buildBearingEntries(),
  ...buildProfileEntries(),
  ...buildGearEntries(),
  ...buildMotorEntries(),
  ...buildGearmotorEntries(),
  ...buildHydraulicEntries(),
  ...buildPneumaticEntries(),
  ...buildVBeltEntries(),
  ...buildTimingPulleyEntries(),
  ...buildSprocketEntries(),
  ...buildRollerChainEntries(),
  ...buildExtrusionEntries(),
  ...buildBracketEntries(),
  ...buildCableTrayEntries(),
  ...buildHoseFittingEntries(),
];

const CATEGORIES = [
  { id: 'fasteners',  label: 'Fasteners' },
  { id: 'bearings',   label: 'Bearings' },
  { id: 'profiles',   label: 'Structural profiles' },
  { id: 'gears',      label: 'Gears' },
  { id: 'motors',     label: 'Electric motors' },
  { id: 'gearmotors', label: 'Gearmotors' },
  { id: 'hydraulic',  label: 'Hydraulic cylinders' },
  { id: 'pneumatic',  label: 'Pneumatic actuators' },
  { id: 'pulleys',    label: 'Pulleys' },
  { id: 'sprockets',  label: 'Sprockets' },
  { id: 'chain',      label: 'Roller chain' },
  { id: 'extrusion',  label: 'T-slot extrusion' },
  { id: 'brackets',   label: 'Brackets' },
  { id: 'cable',      label: 'Cable tray' },
  { id: 'fittings',   label: 'Hose + fittings' },
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
