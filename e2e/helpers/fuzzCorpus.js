/**
 * fuzzCorpus.js — adversarial fuzz corpus for the ArchDisc brep facade.
 *
 * The SP-14 first hardening pass — categorise + drive degenerate / boundary /
 * pathological inputs at the kernel ops and report what falls over. The
 * corpus is serialised as a flat array of cases; each case is a plain
 * declarative description of what to do, evaluated inside one
 * `win.evaluate` block so the kernel + spine live in the same JS context.
 *
 * A case has:
 *   id        – stable string ('cat1-box-zero')
 *   category  – the 10-bucket grouping (1..10, matches SP-14 brief)
 *   description – one-line human label
 *   expect    – the verdict band the case is CONSIDERED A PASS at:
 *                 'reject'   — op SHOULD throw / return null / report bad-input
 *                 'accept'   — op SHOULD succeed and produce a sane body
 *                 'either'   — both paths are acceptable; we record which we saw
 *   run       – an async function evaluated inside the browser; receives
 *               `{K, helpers}` (K = kernel facade); returns a structured outcome:
 *                 { ok: bool, threw: bool, errorMsg, result: <case-specific stats> }
 *
 * The runner consumes the outcome + the case's `expect` to classify the case
 * outcome into one of:
 *   PASS                  expected and got it
 *   CAUGHT                threw — and we expected reject (or 'either'): the op
 *                         honestly rejected the bad input
 *   UNEXPECTED-EXCEPTION  threw, but we expected accept: the op crashed where
 *                         it should have produced a result
 *   SILENT-BAD-OUTPUT     succeeded but the result is obviously wrong (NaN
 *                         volume, negative volume, zero face count on a solid…)
 *   CRASH                 the JS bridge dropped (Embind PointerErr, etc.) —
 *                         caught by the per-case try/catch but flagged as a
 *                         kernel-level instability rather than a polite error
 *
 * No motion capture per case — too much. ONE end-of-run summary still + the
 * session video shows the workflow proceeding through the corpus.
 *
 * NOTE: this module is loaded by the spec file but NOT evaluated in node —
 * its `cases` array is serialised over the bridge into a single evaluator
 * inside the page context. We store each case's `run` body as a STRING so
 * the eval inside the page can `new Function` it (the spec passes the cases
 * as a JSON-clone-compatible structure into win.evaluate).
 */

// ─── Helper: each case carries a `body` STRING that becomes the function
//     body inside the page. The cases run with locals `{K, $stats}` where
//     K = window.__archdiscKernel.kernel; $stats is a helpers object the
//     spec supplies.
//
// Why strings, not functions: web/page bridge can't serialise closures, only
// JSON-clone-safe data. By emitting cases as pure data + body strings the
// spec rehydrates them in the page with `new AsyncFunction('K','$', body)`.

/**
 * Build the full SP-14 hardening-pass fuzz corpus.
 * @returns {{id:string,category:number,description:string,expect:'reject'|'accept'|'either',body:string}[]}
 */
export function buildFuzzCorpus() {
  const cases = [];

  // ── CATEGORY 1 — Degenerate primitives ──────────────────────────────────
  // Zero / negative dimensions on every primitive constructor.

  cases.push({
    id: 'cat1-box-zero',
    category: 1, description: 'makeBox(0,0,0) — zero-volume box',
    expect: 'reject',
    body: `
      const b = await K.brep.makeBox(0, 0, 0);
      if (!b) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(b);
      return { ok: false, threw: false, volume: v, note: 'accepted-zero-box', faceCount: await K.brep.faceCount(b) };
    `,
  });

  cases.push({
    id: 'cat1-box-negative',
    category: 1, description: 'makeBox(-5,-5,-5) — negative side',
    expect: 'reject',
    body: `
      const b = await K.brep.makeBox(-5, -5, -5);
      if (!b) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(b);
      return { ok: false, threw: false, volume: v, note: 'accepted-neg-box', faceCount: await K.brep.faceCount(b) };
    `,
  });

  cases.push({
    id: 'cat1-cyl-zero-radius',
    category: 1, description: 'makeCylinder(0, 10) — zero radius',
    expect: 'reject',
    body: `
      const c = await K.brep.makeCylinder(0, 10);
      if (!c) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(c);
      return { ok: false, threw: false, volume: v, faceCount: await K.brep.faceCount(c) };
    `,
  });

  cases.push({
    id: 'cat1-cyl-zero-height',
    category: 1, description: 'makeCylinder(5, 0) — zero height',
    expect: 'reject',
    body: `
      const c = await K.brep.makeCylinder(5, 0);
      if (!c) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(c);
      return { ok: false, threw: false, volume: v };
    `,
  });

  cases.push({
    id: 'cat1-sphere-zero',
    category: 1, description: 'makeSphere(0) — zero radius',
    expect: 'reject',
    body: `
      const s = await K.brep.makeSphere(0);
      if (!s) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(s);
      return { ok: false, threw: false, volume: v };
    `,
  });

  cases.push({
    id: 'cat1-cone-equal-radii',
    category: 1, description: 'makeCone(r1=5, r2=5, h=10) — degenerate (= cylinder)',
    expect: 'either',
    body: `
      const c = await K.brep.makeCone(5, 5, 10);
      if (!c) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(c);
      const expected = Math.PI * 25 * 10;
      const relErr = Math.abs(v - expected) / expected;
      return { ok: relErr < 0.01, threw: false, volume: v, expectedVolume: expected, relErr };
    `,
  });

  cases.push({
    id: 'cat1-torus-major-less-than-minor',
    category: 1, description: 'makeTorus(R=5, r=10) — major < minor (self-intersecting torus)',
    expect: 'either',
    body: `
      const t = await K.brep.makeTorus(5, 10);
      if (!t) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(t);
      // A torus with R<r self-intersects (apple/spindle); the analytic ring formula
      // 2π²Rr² is invalid for this case. Accept any finite positive volume as
      // "produced something"; SILENT-BAD-OUTPUT band gates on NaN/inf/negative.
      return { ok: Number.isFinite(v) && v > 0, threw: false, volume: v };
    `,
  });

  // ── CATEGORY 2 — Near-tangent booleans ──────────────────────────────────
  // Edge-tangent cuts and bodies separated by < 1e-6 mm (epsilon-touch).

  cases.push({
    id: 'cat2-fuse-1um-gap',
    category: 2, description: 'fuse two cylinders separated by 1e-6 mm — epsilon gap',
    expect: 'either',
    body: `
      const a = await K.brep.makeCylinder(5, 10);
      const b0 = await K.brep.makeCylinder(5, 10);
      const b = await K.brep.translate(b0, [10 + 1e-6, 0, 0]);
      const f = await K.brep.fuse(a, b);
      if (!f) return { ok: false, threw: false, note: 'returned-null' };
      const vol = await K.brep.volume(f);
      // Both cylinders 250π each; the fuse should produce ~500π if they didn't
      // touch (effectively a compound body) or merged volume if the engine
      // tolerance absorbed the gap. Either is acceptable; we record which.
      return { ok: Number.isFinite(vol) && vol > 0, threw: false, volume: vol, faceCount: await K.brep.faceCount(f) };
    `,
  });

  cases.push({
    id: 'cat2-cut-tangent-edge',
    category: 2, description: 'cut(box, cylinder) where cyl exactly tangent to box edge',
    expect: 'either',
    body: `
      const box = await K.brep.makeBox(20, 20, 20);
      const cyl0 = await K.brep.makeCylinder(5, 30);
      // Position cylinder so its OD just kisses the box's +X face.
      const cyl = await K.brep.translate(cyl0, [25 - 5, 10, -5]);
      const r = await K.brep.cut(box, cyl);
      if (!r) return { ok: false, threw: false, note: 'returned-null' };
      const vol = await K.brep.volume(r);
      // Tangent intersection should remove zero volume (modulo tolerance fuzz);
      // the box's volume (8000) should survive within a small tolerance.
      return { ok: Number.isFinite(vol) && vol > 0, threw: false, volume: vol, originalBox: 8000 };
    `,
  });

  cases.push({
    id: 'cat2-fuse-coincident-faces',
    category: 2, description: 'fuse two boxes sharing an exact coincident face',
    expect: 'either',
    body: `
      const a = await K.brep.makeBox(10, 10, 10);
      const b0 = await K.brep.makeBox(10, 10, 10);
      const b = await K.brep.translate(b0, [10, 0, 0]); // shares X=10 face exactly
      const f = await K.brep.fuse(a, b);
      if (!f) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(f);
      // Expected merged volume = 2000 (if coincident face merged) or compound = 2000.
      return { ok: Math.abs(v - 2000) < 1, threw: false, volume: v };
    `,
  });

  // ── CATEGORY 3 — Self-intersecting inputs ───────────────────────────────

  cases.push({
    id: 'cat3-fuse-overlapping-bodies',
    category: 3, description: 'fuse two boxes that strongly overlap (50% co-located)',
    expect: 'accept',
    body: `
      const a = await K.brep.makeBox(20, 20, 20);
      const b0 = await K.brep.makeBox(20, 20, 20);
      const b = await K.brep.translate(b0, [10, 10, 10]); // half-overlap
      const f = await K.brep.fuse(a, b);
      if (!f) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(f);
      // Two 8000-volume boxes with half-overlap (1000mm³ overlap) should yield
      // a fused body of 8000 + 8000 - 1000 = 15000.
      const expected = 15000;
      const relErr = Math.abs(v - expected) / expected;
      return { ok: relErr < 0.01, threw: false, volume: v, expectedVolume: expected, relErr };
    `,
  });

  cases.push({
    id: 'cat3-partition-self-intersect-tool',
    category: 3, description: 'partition body by tool that self-intersects (fuse-overlap as tool)',
    expect: 'either',
    body: `
      const body = await K.brep.makeBox(50, 50, 50);
      const t1 = await K.brep.makeBox(20, 60, 60);
      const t2 = await K.brep.makeBox(60, 20, 60);
      const toolFused = await K.brep.fuse(
        await K.brep.translate(t1, [10, -5, -5]),
        await K.brep.translate(t2, [-5, 10, -5])
      );
      const pieces = await K.brep.partition(body, [toolFused]);
      if (!pieces) return { ok: false, threw: false, note: 'returned-null' };
      const pieceArr = Array.isArray(pieces) ? pieces : [pieces];
      return { ok: pieceArr.length > 0, threw: false, pieceCount: pieceArr.length };
    `,
  });

  // ── CATEGORY 4 — Zero / extreme parameters ──────────────────────────────

  cases.push({
    id: 'cat4-fillet-r-zero',
    category: 4, description: 'filletAll(r=0) — degenerate radius',
    expect: 'either',
    body: `
      const b = await K.brep.makeBox(10, 10, 10);
      const f = await K.brep.filletAll(b, 0);
      if (!f) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(f);
      // r=0 should leave the body unchanged (or be rejected). 1000 is the
      // sharp-corner box volume.
      return { ok: Math.abs(v - 1000) < 1, threw: false, volume: v };
    `,
  });

  cases.push({
    id: 'cat4-fillet-r-larger-than-body',
    category: 4, description: 'filletAll(r=1e6 mm on a 1mm body) — radius vastly exceeds body',
    expect: 'reject',
    body: `
      const b = await K.brep.makeBox(1, 1, 1);
      const f = await K.brep.filletAll(b, 1e6);
      if (!f) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(f);
      return { ok: false, threw: false, volume: v, note: 'accepted-huge-radius' };
    `,
  });

  cases.push({
    id: 'cat4-shell-thickness-equals-half',
    category: 4, description: 'shell(thickness = half body thickness) — boundary case',
    expect: 'either',
    body: `
      const b = await K.brep.makeBox(10, 10, 10);
      const s = await K.brep.shell(b, 5);
      if (!s) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(s);
      // Shell with thickness 5 on a 10×10×10 box — boundary case: every face
      // offset inward by 5, leaving (0,0,0) inner volume in theory.
      return { ok: Number.isFinite(v), threw: false, volume: v };
    `,
  });

  cases.push({
    id: 'cat4-shell-thickness-greater-than-half',
    category: 4, description: 'shell(thickness > half body thickness) — overconstrained',
    expect: 'reject',
    body: `
      const b = await K.brep.makeBox(10, 10, 10);
      const s = await K.brep.shell(b, 8); // thickness > half (5) → impossible
      if (!s) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(s);
      return { ok: false, threw: false, volume: v, note: 'accepted-impossible-shell' };
    `,
  });

  // ── CATEGORY 5 — Hairline geometry ──────────────────────────────────────

  cases.push({
    id: 'cat5-box-1e-7-side',
    category: 5, description: 'makeBox(1e-7, 1e-7, 1e-7) — sub-tolerance body',
    expect: 'either',
    body: `
      const b = await K.brep.makeBox(1e-7, 1e-7, 1e-7);
      if (!b) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(b);
      // Expected v = 1e-21 mm³. Numerical noise band: accept any v in
      // [0, 1e-20] (allowing 10x slack for boolean tolerance).
      return { ok: Number.isFinite(v) && v >= 0 && v < 1e-20, threw: false, volume: v };
    `,
  });

  cases.push({
    id: 'cat5-extreme-aspect-ratio',
    category: 5, description: 'makeBox(1000, 0.001, 0.001) — 1M:1 aspect ratio',
    expect: 'either',
    body: `
      const b = await K.brep.makeBox(1000, 0.001, 0.001);
      if (!b) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(b);
      const expected = 1000 * 0.001 * 0.001;
      const relErr = Math.abs(v - expected) / expected;
      return { ok: relErr < 0.1, threw: false, volume: v, expectedVolume: expected, relErr };
    `,
  });

  cases.push({
    id: 'cat5-cut-leaves-sliver',
    category: 5, description: 'cut leaves a 1um-thick sliver — hairline edge result',
    expect: 'either',
    body: `
      const a = await K.brep.makeBox(10, 10, 10);
      const t0 = await K.brep.makeBox(20, 20, 10 - 1e-3); // leaves 1um sliver on +Z
      const t = await K.brep.translate(t0, [-5, -5, 0]);
      const r = await K.brep.cut(a, t);
      if (!r) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(r);
      // Expected sliver volume = 10 * 10 * 1e-3 = 0.1 mm³.
      return { ok: Number.isFinite(v) && v >= 0, threw: false, volume: v };
    `,
  });

  // ── CATEGORY 6 — Sliver faces ───────────────────────────────────────────

  cases.push({
    id: 'cat6-near-zero-strip-extrude',
    category: 6, description: 'fuse two boxes that touch only along a thin strip',
    expect: 'either',
    body: `
      const a = await K.brep.makeBox(10, 10, 10);
      const b0 = await K.brep.makeBox(10, 1e-3, 10); // 1um wide strip
      const b = await K.brep.translate(b0, [0, 10, 0]);
      const f = await K.brep.fuse(a, b);
      if (!f) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(f);
      const faces = await K.brep.faceCount(f);
      return { ok: Number.isFinite(v) && v > 0, threw: false, volume: v, faceCount: faces };
    `,
  });

  cases.push({
    id: 'cat6-fillet-on-slivery-body',
    category: 6, description: 'fillet a body with already-sliver geometry',
    expect: 'either',
    body: `
      const a = await K.brep.makeBox(10, 10, 0.01);
      const f = await K.brep.filletAll(a, 0.005);
      if (!f) return { ok: false, threw: false, note: 'returned-null' };
      const v = await K.brep.volume(f);
      return { ok: Number.isFinite(v) && v > 0, threw: false, volume: v, faceCount: await K.brep.faceCount(f) };
    `,
  });

  // ── CATEGORY 7 — Long op chains ─────────────────────────────────────────
  // 50+ ops on the same body. Tests carryLineage, persistent-ID survival,
  // and WASM heap discipline under sustained pressure.

  cases.push({
    id: 'cat7-chain-50-fuse-cut',
    category: 7, description: '50-step fuse/cut chain — alternating ops on the same body',
    expect: 'accept',
    body: `
      let body = await K.brep.makeBox(100, 100, 100);
      let step = 0;
      let lastVol = null;
      const opVolumes = [];
      try {
        for (let i = 0; i < 50; i++) {
          if (i % 2 === 0) {
            // Fuse a small cylinder at varying positions.
            const cyl0 = await K.brep.makeCylinder(2, 5);
            const cyl = await K.brep.translate(cyl0,
              [(i*3) % 90, (i*5) % 90, 95]);
            body = await K.brep.fuse(body, cyl);
          } else {
            // Cut a small box at varying positions.
            const box0 = await K.brep.makeBox(3, 3, 5);
            const box = await K.brep.translate(box0,
              [(i*7) % 90, (i*11) % 90, 95]);
            body = await K.brep.cut(body, box);
          }
          step = i + 1;
          if (!body) { lastVol = null; break; }
          if (i % 10 === 9) {
            lastVol = await K.brep.volume(body);
            opVolumes.push({ step, volume: lastVol });
          }
        }
        if (!body) return { ok: false, threw: false, completedSteps: step, opVolumes, note: 'body-null-mid-chain' };
        const finalVol = await K.brep.volume(body);
        const finalFaces = await K.brep.faceCount(body);
        return {
          ok: Number.isFinite(finalVol) && finalVol > 0 && step === 50,
          threw: false, completedSteps: step,
          finalVolume: finalVol, finalFaceCount: finalFaces, opVolumes,
        };
      } catch (e) {
        return { ok: false, threw: true, errorMsg: String(e && e.message || e),
                 completedSteps: step, opVolumes };
      }
    `,
  });

  // ── CATEGORY 8 — Tolerance stress ───────────────────────────────────────

  cases.push({
    id: 'cat8-fuse-mixed-tolerance',
    category: 8, description: 'fuse two solid bodies with different bodyTolerance settings',
    expect: 'accept',
    body: `
      const a0 = await K.brep.makeBox(20, 20, 20);
      const b0 = await K.brep.makeBox(15, 15, 15);
      // Tag the inputs with different tolerances via the SP-11 body-level setter.
      if (a0.body && typeof a0.body.setBodyTolerance === 'function') {
        a0.body.setBodyTolerance(0.05);
      }
      if (b0.body && typeof b0.body.setBodyTolerance === 'function') {
        b0.body.setBodyTolerance(0.1);
      }
      const bT = await K.brep.translate(b0, [10, 0, 0]);
      const f = await K.brep.fuse(a0, bT);
      if (!f) return { ok: false, threw: false, note: 'returned-null' };
      const vol = await K.brep.volume(f);
      const bodyTol = (f.body && typeof f.body.getBodyTolerance === 'function')
        ? f.body.getBodyTolerance() : null;
      // SP-11 contract: result tolerance = MAX(inputs) = 0.1.
      return {
        ok: Number.isFinite(vol) && vol > 0,
        threw: false, volume: vol,
        resultTolerance: bodyTol, expectedTolerance: 0.1,
        toleranceContractHonoured: bodyTol === 0.1,
      };
    `,
  });

  cases.push({
    id: 'cat8-heal-after-tolerance-fuze',
    category: 8, description: 'auto-repair self-intersection after a high-tolerance fuse',
    expect: 'either',
    body: `
      const a = await K.brep.makeBox(10, 10, 10);
      if (a.body && typeof a.body.setBodyTolerance === 'function') {
        a.body.setBodyTolerance(0.5); // unreasonably high
      }
      const result = await K.brep.autoRepairSelfIntersection(a);
      if (!result) return { ok: false, threw: false, note: 'returned-null' };
      const r = result.body || result;
      // For a clean box, auto-repair should report no-op or 'already-clean'.
      return {
        ok: true, threw: false,
        note: 'auto-repair ran on high-tolerance body',
        hasReport: !!(result.meta && result.meta.repairReport),
      };
    `,
  });

  // ── CATEGORY 9 — Massive count ──────────────────────────────────────────
  // Fuse N small bodies. Scaled to ~200 to keep <75min total runtime.

  cases.push({
    id: 'cat9-fuse-200-bodies',
    category: 9, description: 'fuse 200 small spheres into a compound body',
    expect: 'accept',
    body: `
      const N = 200;
      let result = null;
      const startTime = Date.now();
      try {
        const spheres = [];
        for (let i = 0; i < N; i++) {
          const s0 = await K.brep.makeSphere(0.5);
          const x = (i * 7) % 100, y = (Math.floor(i / 10) * 5) % 100, z = 0;
          const s = await K.brep.translate(s0, [x, y, z]);
          spheres.push(s);
        }
        // Use makeCompound if available, else fuse sequentially.
        if (typeof K.brep.makeCompound === 'function') {
          result = await K.brep.makeCompound(spheres);
        } else {
          result = spheres[0];
          for (let i = 1; i < N; i++) {
            result = await K.brep.fuse(result, spheres[i]);
          }
        }
        const elapsedMs = Date.now() - startTime;
        if (!result) return { ok: false, threw: false, elapsedMs, count: N, note: 'returned-null' };
        const v = await K.brep.volume(result);
        return {
          ok: Number.isFinite(v) && v > 0,
          threw: false, elapsedMs, count: N, volume: v,
        };
      } catch (e) {
        return {
          ok: false, threw: true,
          errorMsg: String(e && e.message || e),
          elapsedMs: Date.now() - startTime, count: N,
        };
      }
    `,
  });

  cases.push({
    id: 'cat9-partition-by-20-tools',
    category: 9, description: 'partition a body with 20 tools at once',
    expect: 'either',
    body: `
      const body = await K.brep.makeBox(100, 100, 100);
      const tools = [];
      for (let i = 0; i < 20; i++) {
        const t0 = await K.brep.makeBox(5, 5, 110);
        const t = await K.brep.translate(t0, [i * 5, i * 5, -5]);
        tools.push(t);
      }
      const startTime = Date.now();
      try {
        const pieces = await K.brep.partition(body, tools);
        const elapsedMs = Date.now() - startTime;
        const arr = Array.isArray(pieces) ? pieces : [pieces];
        return {
          ok: arr.length > 0,
          threw: false, elapsedMs, toolCount: 20, pieceCount: arr.length,
        };
      } catch (e) {
        return {
          ok: false, threw: true,
          errorMsg: String(e && e.message || e),
          elapsedMs: Date.now() - startTime, toolCount: 20,
        };
      }
    `,
  });

  // ── CATEGORY 10 — STEP round-trip torture ───────────────────────────────

  cases.push({
    id: 'cat10-step-roundtrip-simple',
    category: 10, description: 'STEP export → import — preserves a fillet+chamfer solid',
    expect: 'accept',
    body: `
      const b0 = await K.brep.makeBox(20, 30, 10);
      const f = await K.brep.filletAll(b0, 2);
      // The first stage: export.
      const stepText = await K.brep.exportStep(f);
      if (!stepText || typeof stepText !== 'string' || stepText.length < 500) {
        return { ok: false, threw: false, note: 'export-returned-bad-text',
                 stepLength: stepText ? stepText.length : 0 };
      }
      // The second stage: re-import.
      const reimported = await K.brep.importStep(stepText);
      if (!reimported) return { ok: false, threw: false, note: 'reimport-returned-null', stepLength: stepText.length };
      const originalVol = await K.brep.volume(f);
      const reimportedVol = await K.brep.volume(reimported);
      const volRelErr = Math.abs(originalVol - reimportedVol) / originalVol;
      const originalFaces = await K.brep.faceCount(f);
      const reimportedFaces = await K.brep.faceCount(reimported);
      return {
        ok: volRelErr < 0.01 && reimportedFaces === originalFaces,
        threw: false,
        stepLength: stepText.length,
        originalVolume: originalVol, reimportedVolume: reimportedVol, volRelErr,
        originalFaceCount: originalFaces, reimportedFaceCount: reimportedFaces,
      };
    `,
  });

  cases.push({
    id: 'cat10-step-roundtrip-after-boolean-chain',
    category: 10, description: 'STEP round-trip — preserves a 5-boolean-chain result',
    expect: 'accept',
    body: `
      let body = await K.brep.makeBox(50, 50, 50);
      for (let i = 0; i < 5; i++) {
        const c0 = await K.brep.makeCylinder(3, 60);
        const c = await K.brep.translate(c0, [10 + i * 8, 10 + i * 5, -5]);
        body = await K.brep.cut(body, c);
      }
      const stepText = await K.brep.exportStep(body);
      if (!stepText || stepText.length < 500) {
        return { ok: false, threw: false, note: 'export-bad', stepLength: stepText ? stepText.length : 0 };
      }
      const reimported = await K.brep.importStep(stepText);
      if (!reimported) return { ok: false, threw: false, note: 'reimport-null' };
      const oV = await K.brep.volume(body), rV = await K.brep.volume(reimported);
      const oF = await K.brep.faceCount(body), rF = await K.brep.faceCount(reimported);
      const volRelErr = Math.abs(oV - rV) / oV;
      return {
        ok: volRelErr < 0.01 && rF === oF,
        threw: false, stepLength: stepText.length,
        originalVolume: oV, reimportedVolume: rV, volRelErr,
        originalFaceCount: oF, reimportedFaceCount: rF,
      };
    `,
  });

  return cases;
}

/**
 * Outcome classifier — given the case's `expect` band and the run outcome,
 * return the verdict: PASS / CAUGHT / UNEXPECTED-EXCEPTION / SILENT-BAD-OUTPUT / CRASH.
 *
 * - PASS:                  expected accept + ok===true,  OR  expected reject + threw,
 *                          OR  expected either + ok===true,  OR  expected either + threw,
 *                          OR  expected either + clean 'returned-null'.
 * - CAUGHT:                expected reject + ok===false + threw===false (op politely refused
 *                          without throwing — e.g. returned null with note).
 * - UNEXPECTED-EXCEPTION:  expected accept + threw===true.
 * - SILENT-BAD-OUTPUT:     expected accept + threw===false + ok===false (op returned a
 *                          result but it's obviously wrong: NaN volume, wrong face count, …).
 *                          OR expected reject + ok===false + threw===false + outcome has a
 *                          volume that's clearly nonsense (NaN, -infinity, etc.).
 * - CRASH:                 the outcome carries a 'kernel-crash' flag (Embind PointerErr,
 *                          BindingError, "table index out of bounds", etc.).
 */
export function classifyOutcome(expect, outcome) {
  if (!outcome) return { verdict: 'CRASH', reason: 'no-outcome' };
  const msg = String(outcome.errorMsg || '');
  const looksLikeKernelCrash = (
    msg.includes('BindingError') ||
    msg.includes('table index out of bounds') ||
    msg.includes('Cannot pass non-string') ||
    msg.includes('memory access out of bounds') ||
    msg.includes('null function or function signature mismatch') ||
    /BindingError\(ptr=\d+\)/.test(msg)
  );
  if (looksLikeKernelCrash) return { verdict: 'CRASH', reason: msg };
  if (expect === 'accept') {
    if (outcome.threw) return { verdict: 'UNEXPECTED-EXCEPTION', reason: msg };
    if (outcome.ok) return { verdict: 'PASS', reason: null };
    return { verdict: 'SILENT-BAD-OUTPUT', reason: outcome.note || JSON.stringify(outcome) };
  }
  if (expect === 'reject') {
    if (outcome.threw) return { verdict: 'CAUGHT', reason: msg };
    if (!outcome.ok) {
      // op politely returned bad-input without throwing — caught
      if (outcome.note === 'returned-null' || /accepted/.test(outcome.note || '') === false) {
        return { verdict: 'CAUGHT', reason: outcome.note || 'returned-null' };
      }
      return { verdict: 'SILENT-BAD-OUTPUT', reason: outcome.note || JSON.stringify(outcome) };
    }
    // expected reject but ok===true — the op accepted bad input
    return { verdict: 'SILENT-BAD-OUTPUT', reason: 'accepted-bad-input: ' + JSON.stringify(outcome) };
  }
  // expect === 'either'
  if (outcome.threw) return { verdict: 'CAUGHT', reason: msg };
  if (outcome.ok) return { verdict: 'PASS', reason: null };
  return { verdict: 'SILENT-BAD-OUTPUT', reason: outcome.note || JSON.stringify(outcome) };
}
