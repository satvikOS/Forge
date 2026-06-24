// ─────────────────────────────────────────────────────────────────────────────
//  cadgenbench_holdout.mjs — HELD-OUT generalization set for CADGenBench.
//
//  PURPOSE: an OVERFITTING DETECTOR. Same schema, same scorer, same op-types as
//  cadgenbench_set.mjs — but EVERY case uses dimensions that DO NOT appear in the
//  benchmark (odd, non-round values) and a DIFFERENT natural-language phrasing
//  (different voice / clause order / units framing — as if a different author
//  wrote it). A model that merely memorised the benchmark (or its synthetic
//  training corpus) keys off the exact numbers + wording and scores LOW here; a
//  model that learned the underlying CAD reasoning (parse intent → compute the
//  arithmetic → emit the right verbs) scores HIGH on both sets alike.
//
//  Exports { GEN_CASES, EDIT_CASES, tc } in the IDENTICAL shape the benchmark
//  uses, so cadgenbench_eval.mjs --case-set ./...holdout.mjs scores it unchanged.
//  The `--replay` discrimination floor (dispatch referenceCalls AS the model
//  output) MUST score ≈1.0 on every axis here too — proving every reference build
//  is a valid, scoreable solid.
//
//  Coverage mirrors the benchmark: primitive · hole · fillet · chamfer · pattern
//  (linear + circular) · shell · boolean-cut · boolean-fuse · sketch-extrude ·
//  revolve · multi-feature · small-assembly · edit.
// ─────────────────────────────────────────────────────────────────────────────

const tc = (name, args) => ({ name, arguments: args });

// ── interface-jig helpers (concrete probe clouds) — same forms as the benchmark ─
function ring(cx, cy, z, radius, n = 8) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a), z]);
  }
  return pts;
}
function holeJig(cx, cy, z, r, margin) {
  return {
    kind: 'hole', center: [cx, cy, z], r,
    keepIn: ring(cx, cy, z, r * 0.4, 6).concat([[cx, cy, z]]),
    keepOut: ring(cx, cy, z, r + margin, 8),
  };
}
function bossJig(cx, cy, z, r, airR) {
  return {
    kind: 'boss', center: [cx, cy, z], r,
    keepIn: [[cx, cy, z], [cx + r * 0.4, cy, z], [cx - r * 0.4, cy, z]],
    keepOut: ring(cx, cy, z, airR, 8),
  };
}
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
function gridJig(nx, ny, dx, dy, z, holeR) {
  const feats = [];
  const x0 = -((nx - 1) * dx) / 2, y0 = -((ny - 1) * dy) / 2;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const cx = x0 + i * dx, cy = y0 + j * dy;
    feats.push({ kind: 'hole', center: [cx, cy, z], r: holeR, keepIn: [[cx, cy, z]], keepOut: [] });
  }
  return feats;
}
function hollowJig(z, cavityPts, wallPts) {
  return {
    kind: 'hole', center: [0, 0, z], r: 1,
    keepIn: cavityPts, keepOut: wallPts || [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  GENERATION CASES (~16). Each: { id, prompt, category, referenceCalls, features? }
//  All dimensions are deliberately distinct from cadgenbench_set.mjs.
// ─────────────────────────────────────────────────────────────────────────────
const GEN_CASES = [
  // ── primitive ──────────────────────────────────────────────────────────────
  // bench used a 60-cube; here 47 mm, and phrased as "block whose sides all measure".
  { id: 'ho-prim-cube', category: 'primitive',
    prompt: 'I need a solid aluminium block whose sides all measure 47 mm — a perfect cube.',
    referenceCalls: [tc('part.make-box', { dx: 47, dy: 47, dz: 47 })] },

  // bench cylinder Ø40×25; here Ø34 (r17) × 63, units stated as cm-then-mm style framing.
  { id: 'ho-prim-cylinder', category: 'primitive',
    prompt: 'Give me a bare cylinder standing upright: its bore-free body is 63 mm in height with a 34 mm diameter.',
    referenceCalls: [tc('part.make-cylinder', { radius: 17, height: 63 })] },

  // bench cone r1 25 / r2 10 / h 40; here base Ø66 (r33), top Ø18 (r9), h 53.
  { id: 'ho-prim-cone', category: 'primitive',
    prompt: 'A frustum, please: it tapers from a 66 mm wide base up to an 18 mm wide flat top over a 53 mm rise.',
    referenceCalls: [tc('part.make-cone', { r1: 33, r2: 9, h: 53 })] },

  // ── hole (single subtract) ──────────────────────────────────────────────────
  // bench 80×80×15 plate, Ø20 hole; here 95×65×13 plate, Ø27 hole.
  { id: 'ho-hole-plate-center', category: 'hole',
    prompt: 'Drill one 27 mm clearance hole dead-centre through a rectangular plate measuring 95 by 65 by 13 mm.',
    referenceCalls: [
      tc('part.begin', { primitive: 'box', dx: 95, dy: 65, dz: 13, at: [-47.5, -32.5, 0] }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 27, depth: 13 }),
      tc('part.finish', {}),
    ],
    features: [holeJig(0, 0, 6.5, 13.5, 12)] },

  // bench disc Ø100×20 bore Ø25; here Ø86 (odd) × 17 thick, Ø33 bore.
  { id: 'ho-hole-disc-bore', category: 'hole',
    prompt: 'Bore a 33 mm hole right down the axis of an 86 mm diameter puck that is 17 mm thick.',
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 86, depth: 17 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 33, depth: 17 }),
      tc('part.finish', {}),
    ],
    features: [holeJig(0, 0, 8.5, 16.5, 14)] },

  // ── fillet ──────────────────────────────────────────────────────────────────
  // bench 70×50×30 block, 6 mm fillet; here 53×37×23 block, 4 mm fillet.
  { id: 'ho-fillet-block', category: 'fillet',
    prompt: 'On a 53 × 37 × 23 mm slab, soften every edge with a 4 mm radius round.',
    referenceCalls: [
      tc('part.begin', { primitive: 'box', dx: 53, dy: 37, dz: 23, at: [-26.5, -18.5, 0] }),
      tc('part.finish', { fillet: 4 }),
    ],
    // a sharp corner becomes air after filleting; the body well inside stays solid
    features: [{
      kind: 'hole', center: [25.5, 17.5, 21], r: 1,
      keepIn: [[26.0, 18.0, 21.5], [26.0, 18.0, 1.5], [-26.0, -18.0, 21.5]],
      keepOut: [[0, 0, 11.5], [12, 6, 11.5]],
    }] },

  // ── chamfer ──────────────────────────────────────────────────────────────────
  // bench Ø45×30 cyl, 3 mm chamfer; here Ø58 (r29) × 41, 5 mm chamfer.
  { id: 'ho-chamfer-cyl', category: 'chamfer',
    prompt: 'Take a post 41 mm tall and 58 mm across, then knock a 5 mm bevel onto each of its rims.',
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 58, depth: 41 }),
      tc('part.finish', { chamfer: 5 }),
    ],
    // the top outer rim is air after the chamfer; the core stays solid
    features: [{
      kind: 'hole', center: [29, 0, 41], r: 1,
      keepIn: [[28.2, 0, 39.6], [0, 28.2, 39.6]],
      keepOut: [[0, 0, 20.5], [12, 0, 20.5]],
    }] },

  // ── pattern: circular (bolt circle) ─────────────────────────────────────────
  // bench Ø120×16, 6×Ø8 on BCD96; here Ø134 (odd) × 19, 5×Ø9 on BCD104.
  { id: 'ho-pattern-bolt-circle', category: 'pattern-circular',
    prompt: 'Lay out five 9 mm bolt holes evenly around a 104 mm pitch circle on a 134 mm diameter flange that is 19 mm thick.',
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 134, depth: 19 }),
      tc('part.bolt-circle', { count: 5, bcd: 104, diameter: 9 }),
      tc('part.finish', {}),
    ],
    features: boltCircleJig(5, 104, 9.5, 4.5, 67) },

  // ── pattern: linear (grid) ──────────────────────────────────────────────────
  // bench 120×80×10, 3×2 of Ø6 @ 40/40; here 145×95×11, 4×3 of Ø7 @ 33/29.
  { id: 'ho-pattern-grid', category: 'pattern-linear',
    prompt: 'Perforate a 145 × 95 × 11 mm panel with a regular array of 7 mm holes — four columns and three rows, stepping 33 mm across and 29 mm up.',
    referenceCalls: [
      tc('part.begin', { primitive: 'box', dx: 145, dy: 95, dz: 11, at: [-72.5, -47.5, 0] }),
      tc('part.grid-holes', { nx: 4, ny: 3, dx: 33, dy: 29, diameter: 7 }),
      tc('part.finish', {}),
    ],
    features: gridJig(4, 3, 33, 29, 5.5, 3.5) },

  // ── shell ────────────────────────────────────────────────────────────────────
  // bench box 80×80×60 / 3 wall; here 55×95×35 / 4 wall, top open.
  // inner = outer - 2·wall in X,Y; depth = height - wall (base solid), offset by wall.
  { id: 'ho-shell-box', category: 'shell',
    prompt: 'Scoop out a 55 × 95 × 35 mm enclosure so only a 4 mm skin remains, and leave the upper face fully open.',
    referenceCalls: [
      tc('part.begin', { primitive: 'box', dx: 55, dy: 95, dz: 35, at: [-27.5, -47.5, 0] }),
      tc('part.subtract', { primitive: 'box', dx: 47, dy: 87, dz: 31, at: [-23.5, -43.5, 4] }),
      tc('part.finish', {}),
    ],
    features: [hollowJig(22, [[0, 0, 22], [15, 0, 22], [0, 30, 22]], [[26.5, 0, 18], [-26.5, 0, 18]])] },

  // bench cup Ø100×50 / 3 wall; here Ø78 (odd) × 64, 5 mm wall.
  { id: 'ho-shell-cup', category: 'shell',
    prompt: 'Turn a 78 mm diameter, 64 mm tall billet into an open beaker — 5 mm wall, closed bottom, open mouth.',
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 78, depth: 64 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 68, depth: 59, at: [0, 0, 5] }),
      tc('part.finish', {}),
    ],
    features: [hollowJig(40, [[0, 0, 40], [15, 0, 40], [0, 15, 40]], [[37.5, 0, 30], [0, 37.5, 30]])] },

  // ── boolean cut ──────────────────────────────────────────────────────────────
  // bench: 60-cube minus Ø40 sphere at centre (a fully-enclosed void); here a
  // spherical SEAT pocket Ø46 (r23) opening through the top face of a 74 mm cube —
  // same boolean-cut-with-a-sphere op-type, but an OPEN cavity (a valid manifold
  // solid, so the replay ceiling is clean rather than tripping the void gate).
  // Sphere centre at z=64 → bowl floor at z=41, rim opens at the top face z=74.
  { id: 'ho-bool-cut-sphere', category: 'boolean-cut',
    prompt: 'Scallop a 46 mm wide spherical seat into the top of a 74 mm cube, breaking through the upper face.',
    referenceCalls: [
      tc('part.make-box', { dx: 74, dy: 74, dz: 74 }),              // handle 1, [0..74]^3
      tc('part.make-sphere', { radius: 23 }),                       // handle 2, at origin
      tc('part.translate', { shape: 2, dx: 37, dy: 37, dz: 64 }),   // handle 3 → centre on top region
      tc('part.cut', { a: 1, b: 3 }),                               // handle 4
    ],
    // inside the bowl (axis below the rim) is air; the wall around the sphere is solid.
    features: [{
      kind: 'hole', center: [37, 37, 55], r: 23,
      keepIn: [[37, 37, 55], [37, 37, 50], [42, 37, 60]],           // inside the spherical cavity → air
      keepOut: ring(37, 37, 50, 30, 8),                            // ring outside the sphere wall → solid
    }] },

  // bench slot block 100×60×20, 20-wide slot; here 115×53×27 block, 17-wide slot.
  // cutter spans full X length, 17 wide centred in Y (y∈[18,35]), z through.
  { id: 'ho-bool-cut-slot', category: 'boolean-cut',
    prompt: 'Run a 17 mm wide channel the whole length of a 115 × 53 × 27 mm bar, keeping it centred between the two long edges.',
    referenceCalls: [
      tc('part.make-box', { dx: 115, dy: 53, dz: 27 }),            // handle 1
      tc('part.make-box', { dx: 115, dy: 17, dz: 29 }),            // handle 2, cutter
      tc('part.translate', { shape: 2, dx: 0, dy: 18, dz: -1 }),   // handle 3 → centred (y∈[18,35], mid=26.5)
      tc('part.cut', { a: 1, b: 3 }),                              // handle 4
    ],
    features: [{
      kind: 'slot', center: [57.5, 26.5, 13.5], r: 1,
      keepIn: [[57.5, 26.5, 13.5], [25, 26.5, 13.5], [90, 26.5, 13.5]],  // inside the channel
      keepOut: [[57.5, 7, 13.5], [57.5, 46, 13.5]],                      // the rails either side stay solid
    }] },

  // ── boolean fuse ─────────────────────────────────────────────────────────────
  // bench boss Ø30×30 on 80×80×12 plate; here Ø37 (r18.5) × 41 boss on 67×67×14 plate.
  { id: 'ho-bool-fuse-boss', category: 'boolean-fuse',
    prompt: 'Weld a 37 mm diameter cylindrical pad, 41 mm tall, onto the middle of the top face of a 67 × 67 × 14 mm baseplate.',
    referenceCalls: [
      tc('part.make-box', { dx: 67, dy: 67, dz: 14 }),             // handle 1
      tc('part.make-cylinder', { radius: 18.5, height: 41 }),       // handle 2, base at z=0
      tc('part.translate', { shape: 2, dx: 33.5, dy: 33.5, dz: 14 }),// handle 3 → centred on top
      tc('part.fuse', { a: 1, b: 3 }),                             // handle 4
    ],
    features: [bossJig(33.5, 33.5, 34, 18.5, 28)] },

  // ── sketch → extrude ─────────────────────────────────────────────────────────
  // bench L-profile 60×60, 20 leg, 30 thick; here 53×47 overall, 16 leg, 22 thick.
  { id: 'ho-sketch-extrude-L', category: 'sketch-extrude',
    prompt: 'From an L-shaped outline that is 53 mm along the bottom and 47 mm up the side with a uniform 16 mm leg, pull a 22 mm thick solid.',
    referenceCalls: [
      tc('part.extrude', {
        profile: [[0, 0], [53, 0], [53, 16], [16, 16], [16, 47], [0, 47]],
        distance: 22, dir: [0, 0, 1],
      }),
    ] },

  // ── revolve ──────────────────────────────────────────────────────────────────
  // bench bushing OD50 / bore30 / len40; here OD64 (r32) / bore38 (r19) / len29.
  { id: 'ho-revolve-bushing', category: 'revolve',
    prompt: 'Spin a rectangular section a full turn about Z to form a sleeve: 64 mm outside, 38 mm through-bore, 29 mm in length.',
    referenceCalls: [
      tc('part.revolve', {
        profile: [[19, 0], [32, 0], [32, 29], [19, 29]],
        axisOrigin: [0, 0, 0], axisDir: [0, 0, 1], angleDeg: 360,
      }),
    ],
    features: [holeJig(0, 0, 14.5, 19, 7)] },

  // ── multi-feature ────────────────────────────────────────────────────────────
  // bench flange asset od120/thick14/bore40/4×Ø11 on BCD90; here od108/thick17/bore34/3×Ø13 on BCD82.
  { id: 'ho-multi-flange', category: 'multi-feature',
    prompt: 'Produce a 108 mm flange, 17 mm thick, opened by a 34 mm centre bore and pierced by three 13 mm bolt holes spaced around an 82 mm circle.',
    referenceCalls: [tc('asset.make-flange', { od: 108, thick: 17, bore: 34, bolts: 3, bolt_d: 13, bcd: 82 })],
    features: [
      holeJig(0, 0, 8.5, 17, 9),
      ...boltCircleJig(3, 82, 8.5, 6.5, 54),
    ] },

  // bench stepped shaft d1 40/h1 50/d2 25/h2 40; here d1 53/h1 37/d2 31/h2 58.
  { id: 'ho-multi-stepped-shaft', category: 'multi-feature',
    prompt: 'Two coaxial diameters make this shaft: the fat end is 53 mm across over a 37 mm length, stepping down to a 31 mm diameter run that is 58 mm long.',
    referenceCalls: [tc('asset.make-stepped-shaft', { d1: 53, h1: 37, d2: 31, h2: 58 })],
    features: [bossJig(0, 0, 66, 15.5, 24)] },

  // ── small-assembly (standard parts) ──────────────────────────────────────────
  // bench washer od40/id21/thick4; here od53/id27/thick5.
  { id: 'ho-asm-washer', category: 'small-assembly',
    prompt: 'Make a plain washer 5 mm thick: its outer rim is 53 mm and the central opening is 27 mm.',
    referenceCalls: [tc('asset.make-washer', { od: 53, id: 27, thick: 5 })],
    features: [holeJig(0, 0, 2.5, 13.5, 5)] },

  // bench tube od50/wall3/len80; here od44/wall4/len97 → bore radius 18, mid-wall 20.
  { id: 'ho-asm-tube', category: 'small-assembly',
    prompt: 'Cut a 97 mm length of pipe with a 44 mm outside diameter and a 4 mm wall.',
    referenceCalls: [tc('asset.make-tube', { od: 44, wall: 4, len: 97 })],
    features: [{
      kind: 'hole', center: [0, 0, 48.5], r: 18,
      keepIn: ring(0, 0, 48.5, 18 * 0.4, 6).concat([[0, 0, 48.5]]),  // inside bore → air
      keepOut: ring(0, 0, 48.5, 20, 8),                             // mid-wall → solid
    }] },
];

// ─────────────────────────────────────────────────────────────────────────────
//  EDIT CASES (~4). Each: { id, prompt, category:'edit', inputCalls, referenceCalls, features? }
//  Distinct dims + different phrasing from the benchmark's edit cases.
// ─────────────────────────────────────────────────────────────────────────────
const EDIT_CASES = [
  // bench: Ø80×12 hub, bore Ø20 → Ø34; here Ø94 × 15 hub, bore Ø23 → Ø41.
  { id: 'ho-edit-enlarge-bore', category: 'edit',
    prompt: 'This hub is 94 mm across and 15 mm thick with a 23 mm bore. Open that bore right up to 41 mm.',
    inputCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 94, depth: 15 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 23, depth: 15 }),
      tc('part.finish', {}),
    ],
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 94, depth: 15 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 23, depth: 15 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 41, depth: 15 }),
      tc('part.finish', {}),
    ],
    // the Ø23–Ø41 annulus (mid radius 16) must OPEN — solid in base, air in edit
    features: [{ kind: 'hole', center: [0, 0, 7.5], r: 20.5, keepIn: ring(0, 0, 7.5, 16, 8), keepOut: [] }] },

  // bench: Ø100×20 disc bore Ø25, add Ø40 counterbore 7 deep; here Ø88×23 disc bore Ø29,
  // add Ø47 counterbore 9 deep on top (sits at z = 23 - 9 = 14).
  { id: 'ho-edit-add-counterbore', category: 'edit',
    prompt: 'Given an 88 mm disc, 23 mm thick, already bored to 29 mm — sink a 47 mm counterbore 9 mm into the top face.',
    inputCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 88, depth: 23 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 29, depth: 23 }),
      tc('part.finish', {}),
    ],
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 88, depth: 23 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 29, depth: 23 }),
      tc('part.subtract', { primitive: 'cylinder', diameter: 47, depth: 9, at: [0, 0, 14] }),
      tc('part.finish', {}),
    ],
    // the Ø29–Ø47 ring at the top (z≈19) opens up
    features: [{ kind: 'hole', center: [0, 0, 19], r: 23.5, keepIn: ring(0, 0, 19, 19, 8), keepOut: [] }] },

  // bench: plain Ø120×16 disc, add 6×Ø8 on BCD96; here plain Ø126×21 disc, add 4×Ø11 on BCD88.
  { id: 'ho-edit-add-bolt-circle', category: 'edit',
    prompt: 'Starting from a featureless 126 mm disc that is 21 mm thick, punch in four 11 mm bolt holes around an 88 mm circle.',
    inputCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 126, depth: 21 }),
      tc('part.finish', {}),
    ],
    referenceCalls: [
      tc('part.begin', { primitive: 'cylinder', diameter: 126, depth: 21 }),
      tc('part.bolt-circle', { count: 4, bcd: 88, diameter: 11 }),
      tc('part.finish', {}),
    ],
    features: boltCircleJig(4, 88, 10.5, 5.5, 63) },

  // bench: solid 100×80×40 block → 3 wall top-open; here solid 73×119×46 block → 5 wall top-open.
  { id: 'ho-edit-shell-block', category: 'edit',
    prompt: 'Take this solid 73 × 119 × 46 mm block and shell it down to a 5 mm wall, leaving the top face open.',
    inputCalls: [
      tc('part.begin', { primitive: 'box', dx: 73, dy: 119, dz: 46, at: [-36.5, -59.5, 0] }),
      tc('part.finish', {}),
    ],
    referenceCalls: [
      tc('part.begin', { primitive: 'box', dx: 73, dy: 119, dz: 46, at: [-36.5, -59.5, 0] }),
      tc('part.subtract', { primitive: 'box', dx: 63, dy: 109, dz: 41, at: [-31.5, -54.5, 5] }),
      tc('part.finish', {}),
    ],
    features: [hollowJig(28, [[0, 0, 28], [20, 0, 28], [0, 40, 28]], [[35, 0, 23], [-35, 0, 23]])] },
];

export { GEN_CASES, EDIT_CASES, tc };
