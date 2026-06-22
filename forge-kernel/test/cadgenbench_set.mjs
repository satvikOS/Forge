// ─────────────────────────────────────────────────────────────────────────────
//  cadgenbench_set.mjs — the rubric-spanning CADGenBench TEST SET (Task #15)
//
//  Each case authors its OWN deterministic, canonically-correct reference build
//  as a list of tool-call objects (the same {name,arguments} shape the model
//  emits and the ForgeToolBridge dispatches). The reference is NOT a JS closure
//  over `forge` (functions cannot cross the JSON job boundary into the fresh
//  worker child) — it is data that the worker replays via dispatchSequence in a
//  FRESH kernel, exactly like a model build. This guarantees:
//    • the reference + the model output are scored through the IDENTICAL path
//      (label phase replays referenceCalls, drive phase replays modelCalls),
//    • the handle counter starts at 1 in every case (process-global, no reset),
//    • a `--replay` discrimination floor (dispatch referenceCalls AS the model
//      output) must score ≈1.0 on every axis, proving the set + scorer are sound.
//
//  An optional `features[]` interface jig (GD&T / mating probe clouds) is authored
//  with concrete keepIn (must be CAVITY) / keepOut (must be SOLID) points relative
//  to the known feature geometry — a part missing/misplacing/mis-sizing the feature
//  fails it. `features` omitted ⇒ interface axis returns 1.0 (no feature to grade).
//
//  Coverage (≥20 gen, ≥3 edit): primitive · hole · fillet · chamfer · pattern
//  (linear+circular) · shell · boolean-cut · boolean-fuse · sketch-extrude ·
//  revolve · multi-feature · small-assembly. No two cases alike.
// ─────────────────────────────────────────────────────────────────────────────

const tc = (name, args) => ({ name, arguments: args });

// ── interface-jig helpers (concrete probe clouds) ───────────────────────────
function ring(cx, cy, z, radius, n = 8) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a), z]);
  }
  return pts;
}
// A through/blind hole: bore must be air (keepIn inside r·0.4), the body just
// outside the bore must be solid (keepOut at r + margin).
function holeJig(cx, cy, z, r, margin) {
  return {
    kind: 'hole', center: [cx, cy, z], r,
    keepIn: ring(cx, cy, z, r * 0.4, 6).concat([[cx, cy, z]]),
    keepOut: ring(cx, cy, z, r + margin, 8),
  };
}
// A boss/standoff that stands proud: its axis must be solid (keepIn), the air
// ring around it must stay air (keepOut).
function bossJig(cx, cy, z, r, airR) {
  return {
    kind: 'boss', center: [cx, cy, z], r,
    keepIn: [[cx, cy, z], [cx + r * 0.4, cy, z], [cx - r * 0.4, cy, z]],
    keepOut: ring(cx, cy, z, airR, 8),
  };
}
// Bolt circle: every hole centre is cavity; midpoints between holes are solid.
function boltCircleJig(count, bcd, z, holeR, odR) {
  const feats = [];
  const R = bcd / 2;
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count;
    const bx = R * Math.cos(a), by = R * Math.sin(a);
    feats.push({
      kind: 'hole', center: [bx, by, z], r: holeR,
      keepIn: [[bx, by, z]],
      keepOut: [
        [bx + holeR + 3, by, z], [bx - holeR - 3, by, z],
      ].filter((p) => Math.hypot(p[0], p[1]) < odR - 0.8),
    });
  }
  return feats;
}
// Grid of holes centred on the origin: each cell centre is cavity.
function gridJig(nx, ny, dx, dy, z, holeR) {
  const feats = [];
  const x0 = -((nx - 1) * dx) / 2, y0 = -((ny - 1) * dy) / 2;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const cx = x0 + i * dx, cy = y0 + j * dy;
    feats.push({ kind: 'hole', center: [cx, cy, z], r: holeR, keepIn: [[cx, cy, z]], keepOut: [] });
  }
  return feats;
}
// Hollow interior (shell / cup): the cavity is air; the wall mid-thickness is solid.
function hollowJig(z, cavityPts, wallPts) {
  return {
    kind: 'hole', center: [0, 0, z], r: 1,
    keepIn: cavityPts, keepOut: wallPts || [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  GENERATION CASES (≥20). Each: { id, prompt, category, referenceCalls, features? }
// ─────────────────────────────────────────────────────────────────────────────
const GEN_CASES = [
  // ── primitive ──────────────────────────────────────────────────────────────
  { id: 'prim-cube', category: 'primitive',
    prompt: 'Model a solid steel cube, 60 mm on every side.',
    // makeBox is corner-at-origin → spans [0,60]^3
    referenceCalls: [tc('part.make-box', { dx: 60, dy: 60, dz: 60 })] },

  { id: 'prim-cylinder', category: 'primitive',
    prompt: 'Make a plain cylinder, 40 mm diameter and 25 mm tall, standing on the XY plane.',
    referenceCalls: [tc('part.make-cylinder', { radius: 20, height: 25 })] },

  { id: 'prim-cone', category: 'primitive',
    prompt: 'Build a truncated cone, 50 mm diameter at the base, 20 mm diameter at the top, 40 mm tall.',
    referenceCalls: [tc('part.make-cone', { r1: 25, r2: 10, h: 40 })] },

  // ── hole (single subtract) ──────────────────────────────────────────────────
  { id: 'hole-plate-center', category: 'hole',
    prompt: 'An 80 × 80 × 15 mm plate with a single 20 mm diameter through-hole in the centre.',
    referenceCalls: [
      tc('part.begin', { primitive: 'box', dx: 80, dy: 80, dz: 15, at: [-40, -40, 0] }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 20, depth: 15 }),
      tc('part.finish', {}),
    ],
    features: [holeJig(0, 0, 7.5, 10, 12)] },

  { id: 'hole-disc-bore', category: 'hole',
    prompt: 'A 100 mm diameter, 20 mm thick disc with a 25 mm diameter bore through its centre.',
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 100, depth: 20 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 25, depth: 20 }),
      tc('part.finish', {}),
    ],
    features: [holeJig(0, 0, 10, 12.5, 15)] },

  // ── fillet ──────────────────────────────────────────────────────────────────
  { id: 'fillet-block', category: 'fillet',
    prompt: 'Take a 70 × 50 × 30 mm block and round every edge with a 6 mm fillet.',
    referenceCalls: [
      tc('part.begin', { primitive: 'box', dx: 70, dy: 50, dz: 30, at: [-35, -25, 0] }),
      tc('part.finish', { fillet: 6 }),
    ],
    // a sharp corner becomes air after filleting; the body well inside stays solid
    features: [{
      kind: 'hole', center: [34, 24, 28], r: 1,
      keepIn: [[34.5, 24.5, 28.5], [34.5, 24.5, 1.5], [-34.5, -24.5, 28.5]],
      keepOut: [[0, 0, 15], [20, 10, 15]],
    }] },

  // ── chamfer ──────────────────────────────────────────────────────────────────
  { id: 'chamfer-cyl', category: 'chamfer',
    prompt: 'A 45 mm diameter, 30 mm tall cylinder with a 3 mm chamfer broken on all its edges.',
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 45, depth: 30 }),
      tc('part.finish', { chamfer: 3 }),
    ],
    // the top outer rim is air after the chamfer; the core stays solid
    features: [{
      kind: 'hole', center: [22.5, 0, 30], r: 1,
      keepIn: [[22.0, 0, 29.0], [0, 22.0, 29.0]],
      keepOut: [[0, 0, 15], [10, 0, 15]],
    }] },

  // ── pattern: circular (bolt circle) ─────────────────────────────────────────
  { id: 'pattern-bolt-circle', category: 'pattern-circular',
    prompt: 'A 120 mm diameter, 16 mm thick flange disc with six 8 mm holes equally spaced on a 96 mm bolt circle.',
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 120, depth: 16 }),
      tc('part.bolt-circle', { count: 6, bcd: 96, diameter: 8 }),
      tc('part.finish', {}),
    ],
    features: boltCircleJig(6, 96, 8, 4, 60) },

  { id: 'pattern-bolt-circle-4', category: 'pattern-circular',
    prompt: 'A 90 mm diameter, 12 mm thick cap with four 6 mm bolt holes on a 70 mm bolt circle.',
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 90, depth: 12 }),
      tc('part.bolt-circle', { count: 4, bcd: 70, diameter: 6 }),
      tc('part.finish', {}),
    ],
    features: boltCircleJig(4, 70, 6, 3, 45) },

  // ── pattern: linear (grid) ──────────────────────────────────────────────────
  { id: 'pattern-grid', category: 'pattern-linear',
    prompt: 'A 120 × 80 × 10 mm plate with a 3 × 2 grid of 6 mm holes spaced 40 mm apart in X and 40 mm in Y.',
    referenceCalls: [
      tc('part.begin', { primitive: 'box', dx: 120, dy: 80, dz: 10, at: [-60, -40, 0] }),
      tc('part.grid-holes', { nx: 3, ny: 2, dx: 40, dy: 40, diameter: 6 }),
      tc('part.finish', {}),
    ],
    features: gridJig(3, 2, 40, 40, 5, 3) },

  // ── shell ────────────────────────────────────────────────────────────────────
  { id: 'shell-box', category: 'shell',
    prompt: 'Hollow out an 80 × 80 × 60 mm box to a 3 mm wall thickness, leaving the top face open.',
    referenceCalls: [
      tc('part.begin', { primitive: 'box', dx: 80, dy: 80, dz: 60, at: [-40, -40, 0] }),
      tc('part.subtract', { primitive: 'box', dx: 74, dy: 74, dz: 58, at: [-37, -37, 3] }),
      tc('part.finish', {}),
    ],
    features: [hollowJig(35, [[0, 0, 35], [20, 0, 35], [0, 20, 35]], [[39, 0, 30], [-39, 0, 30]])] },

  { id: 'shell-cup', category: 'shell',
    prompt: 'A 100 mm diameter, 50 mm tall cup with a 3 mm wall and a solid base, open at the top.',
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 100, depth: 50 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 94, depth: 47, at: [0, 0, 3] }),
      tc('part.finish', {}),
    ],
    features: [hollowJig(30, [[0, 0, 30], [20, 0, 30], [0, 20, 30]], [[48.5, 0, 25], [0, 48.5, 25]])] },

  // ── boolean cut ──────────────────────────────────────────────────────────────
  { id: 'bool-cut-sphere', category: 'boolean-cut',
    // makeBox is corner-at-origin (cube centre = [30,30,30]); makeSphere is at origin,
    // so translate it to the cube centre before the cut.
    prompt: 'Start from a 60 mm cube and cut a 40 mm diameter spherical cavity out of its centre.',
    referenceCalls: [
      tc('part.make-box', { dx: 60, dy: 60, dz: 60 }),               // handle 1, [0..60]^3
      tc('part.make-sphere', { radius: 20 }),                         // handle 2, at origin
      tc('part.translate', { shape: 2, dx: 30, dy: 30, dz: 30 }),     // handle 3, sphere → cube centre
      tc('part.cut', { a: 1, b: 3 }),                                 // handle 4
    ],
    features: [holeJig(30, 30, 30, 20, 8)] },

  { id: 'bool-cut-slot', category: 'boolean-cut',
    // block corner-at-origin spans [0,100]x[0,60]x[0,20]; slot cutter spans the
    // full length, 20 wide centred in Y (y∈[20,40]), z∈[0,20], cut through-X.
    prompt: 'A 100 × 60 × 20 mm block with a 20 mm wide slot cut straight through along its length, centred across the width.',
    referenceCalls: [
      tc('part.make-box', { dx: 100, dy: 60, dz: 20 }),               // handle 1
      tc('part.make-box', { dx: 100, dy: 20, dz: 22 }),               // handle 2, cutter
      tc('part.translate', { shape: 2, dx: 0, dy: 20, dz: -1 }),      // handle 3 → centred slot
      tc('part.cut', { a: 1, b: 3 }),                                 // handle 4
    ],
    features: [{
      kind: 'slot', center: [50, 30, 10], r: 1,
      keepIn: [[50, 30, 10], [20, 30, 10], [80, 30, 10]],            // inside the slot channel
      keepOut: [[50, 8, 10], [50, 52, 10]],                          // the rails either side stay solid
    }] },

  // ── boolean fuse ─────────────────────────────────────────────────────────────
  { id: 'bool-fuse-boss', category: 'boolean-fuse',
    // plate corner-at-origin [0,80]x[0,80]x[0,12]; boss cylinder XY-centred at origin,
    // translate to plate centre [40,40] on the top face z=12.
    prompt: 'Fuse a 30 mm diameter, 30 mm tall cylindrical boss centrally on top of an 80 × 80 × 12 mm plate.',
    referenceCalls: [
      tc('part.make-box', { dx: 80, dy: 80, dz: 12 }),               // handle 1
      tc('part.make-cylinder', { radius: 15, height: 30 }),           // handle 2, base at z=0
      tc('part.translate', { shape: 2, dx: 40, dy: 40, dz: 12 }),     // handle 3 → boss on top centre
      tc('part.fuse', { a: 1, b: 3 }),                                // handle 4
    ],
    features: [bossJig(40, 40, 25, 15, 24)] },

  // ── sketch → extrude ─────────────────────────────────────────────────────────
  { id: 'sketch-extrude-L', category: 'sketch-extrude',
    prompt: 'Sketch an L-shaped profile (60 mm × 60 mm overall, 20 mm leg width) and extrude it 30 mm thick.',
    referenceCalls: [
      tc('part.extrude', {
        profile: [[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60]],
        distance: 30, dir: [0, 0, 1],
      }),
    ] },

  { id: 'sketch-extrude-tee', category: 'sketch-extrude',
    prompt: 'Extrude a symmetric T-section profile, 80 mm wide flange and 60 mm tall web, by 25 mm.',
    referenceCalls: [
      tc('part.extrude', {
        profile: [[-40, 0], [40, 0], [40, 15], [10, 15], [10, 60], [-10, 60], [-10, 15], [-40, 15]],
        distance: 25, dir: [0, 0, 1],
      }),
    ] },

  // ── revolve ──────────────────────────────────────────────────────────────────
  { id: 'revolve-bushing', category: 'revolve',
    prompt: 'Revolve a rectangular section about the Z axis to make a bushing: 50 mm outer diameter, 30 mm bore, 40 mm long.',
    referenceCalls: [
      tc('part.revolve', {
        profile: [[15, 0], [25, 0], [25, 40], [15, 40]],
        axisOrigin: [0, 0, 0], axisDir: [0, 0, 1], angleDeg: 360,
      }),
    ],
    features: [holeJig(0, 0, 20, 15, 6)] },

  // ── multi-feature ────────────────────────────────────────────────────────────
  { id: 'multi-lbracket', category: 'multi-feature',
    prompt: 'An L-bracket 80 mm long, 60 mm wide, 8 mm thick with a 5 mm wall, and a 10 mm mounting hole in each leg.',
    referenceCalls: [tc('asset.make-l-bracket', { len: 80, width: 60, thick: 8, wall: 50, hole: 10 })] },

  { id: 'multi-flange', category: 'multi-feature',
    prompt: 'A 120 mm diameter, 14 mm thick flange with a 40 mm centre bore and four 11 mm bolt holes on a 90 mm bolt circle.',
    referenceCalls: [tc('asset.make-flange', { od: 120, thick: 14, bore: 40, bolts: 4, bolt_d: 11, bcd: 90 })],
    features: [
      holeJig(0, 0, 7, 20, 10),
      ...boltCircleJig(4, 90, 7, 5.5, 60),
    ] },

  { id: 'multi-stepped-shaft', category: 'multi-feature',
    prompt: 'A stepped shaft: a 40 mm diameter × 50 mm long lower section and a 25 mm diameter × 40 mm long upper section, coaxial.',
    referenceCalls: [tc('asset.make-stepped-shaft', { d1: 40, h1: 50, d2: 25, h2: 40 })],
    features: [bossJig(0, 0, 70, 12.5, 19.5)] },

  { id: 'multi-bored-plate-bolts', category: 'multi-feature',
    // plate centred [-70..70]x[-50..50]; Ø80 bolt circle (R=40) keeps all 4 holes
    // on the plate (±40 ≤ ±50 in Y, ≤ ±70 in X). Central Ø30 bore.
    prompt: 'A 140 × 100 × 16 mm plate with a 30 mm central through-hole and a 4-hole 8 mm bolt pattern on an 80 mm circle.',
    referenceCalls: [
      tc('part.begin', { primitive: 'box', dx: 140, dy: 100, dz: 16, at: [-70, -50, 0] }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 30, depth: 16 }),
      tc('part.bolt-circle', { count: 4, bcd: 80, diameter: 8 }),
      tc('part.finish', {}),
    ],
    features: [
      holeJig(0, 0, 8, 15, 8),
      ...boltCircleJig(4, 80, 8, 4, 49),
    ] },

  // ── small-assembly (standard parts) ──────────────────────────────────────────
  { id: 'asm-tube', category: 'small-assembly',
    // tube: OD 50 (R=25), wall 3 → bore radius 22, mid-wall ≈ 23.5; XY-centred, z∈[0,80]
    prompt: 'A length of round tube: 50 mm outer diameter, 3 mm wall thickness, 80 mm long.',
    referenceCalls: [tc('asset.make-tube', { od: 50, wall: 3, len: 80 })],
    features: [{
      kind: 'hole', center: [0, 0, 40], r: 22,
      keepIn: ring(0, 0, 40, 22 * 0.4, 6).concat([[0, 0, 40]]),  // inside bore → air
      keepOut: ring(0, 0, 40, 23.5, 8),                          // mid-wall → solid
    }] },

  { id: 'asm-washer', category: 'small-assembly',
    prompt: 'A flat washer: 40 mm outer diameter, 21 mm inner diameter, 4 mm thick.',
    referenceCalls: [tc('asset.make-washer', { od: 40, id: 21, thick: 4 })],
    features: [holeJig(0, 0, 2, 10.5, 4)] },

  { id: 'asm-hexnut', category: 'small-assembly',
    prompt: 'An M16 hex nut: 24 mm across flats, 13 mm thick, 16 mm tapped-size bore.',
    referenceCalls: [tc('asset.make-hex-nut', { af: 24, thick: 13, bore: 16 })],
    features: [holeJig(0, 0, 6.5, 8, 2)] },
];

// ─────────────────────────────────────────────────────────────────────────────
//  EDIT CASES (≥3). Each: { id, prompt, category:'edit',
//                           inputCalls (the base/no-op echo), referenceCalls (base+edit),
//                           features? } — scored with the no-op-renormalized editing rubric.
// ─────────────────────────────────────────────────────────────────────────────
const EDIT_CASES = [
  { id: 'edit-enlarge-bore', category: 'edit',
    prompt: 'Here is an 80 mm diameter, 12 mm thick hub with a 20 mm bore. Enlarge the bore to 34 mm diameter.',
    inputCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 80, depth: 12 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 20, depth: 12 }),
      tc('part.finish', {}),
    ],
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 80, depth: 12 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 20, depth: 12 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 34, depth: 12 }),
      tc('part.finish', {}),
    ],
    // the Ø20–Ø34 annulus (mid radius 13.5) must OPEN — solid in base, air in edit
    features: [{ kind: 'hole', center: [0, 0, 6], r: 17, keepIn: ring(0, 0, 6, 13.5, 8), keepOut: [] }] },

  { id: 'edit-add-counterbore', category: 'edit',
    prompt: 'Here is a 100 mm diameter, 20 mm thick disc with a 25 mm bore. Add a 40 mm diameter counterbore, 7 mm deep, on the top face.',
    inputCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 100, depth: 20 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 25, depth: 20 }),
      tc('part.finish', {}),
    ],
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 100, depth: 20 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 25, depth: 20 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 40, depth: 7, at: [0, 0, 13] }),
      tc('part.finish', {}),
    ],
    // the Ø25–Ø40 ring at the top (z≈17) opens up
    features: [{ kind: 'hole', center: [0, 0, 17], r: 20, keepIn: ring(0, 0, 17, 16.25, 8), keepOut: [] }] },

  { id: 'edit-add-bolt-circle', category: 'edit',
    prompt: 'Here is a plain 120 mm diameter, 16 mm thick disc. Add six 8 mm bolt holes on a 96 mm bolt circle.',
    inputCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 120, depth: 16 }),
      tc('part.finish', {}),
    ],
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 120, depth: 16 }),
      tc('part.bolt-circle', { count: 6, bcd: 96, diameter: 8 }),
      tc('part.finish', {}),
    ],
    features: boltCircleJig(6, 96, 8, 4, 60) },

  { id: 'edit-shell-block', category: 'edit',
    prompt: 'Here is a solid 100 × 80 × 40 mm block. Hollow it to a 3 mm wall with the top open.',
    inputCalls: [
      tc('part.begin', { primitive: 'box', dx: 100, dy: 80, dz: 40, at: [-50, -40, 0] }),
      tc('part.finish', {}),
    ],
    referenceCalls: [
      tc('part.begin', { primitive: 'box', dx: 100, dy: 80, dz: 40, at: [-50, -40, 0] }),
      tc('part.subtract', { primitive: 'box', dx: 94, dy: 74, dz: 37, at: [-47, -37, 3] }),
      tc('part.finish', {}),
    ],
    features: [hollowJig(25, [[0, 0, 25], [25, 0, 25], [0, 20, 25]], [[49, 0, 20], [-49, 0, 20]])] },
];

export { GEN_CASES, EDIT_CASES, tc };
