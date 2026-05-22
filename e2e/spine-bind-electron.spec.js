/**
 * spine-bind-electron.spec.js  —  SP-1 Stage S1
 *
 * Verifies `bindSpine` — the OCCT→spine bridge: a B-rep-engine `TopoDS_Shape`
 * walked into a fully-populated, validated spine `Body`
 * (Body→Lump→Shell→Face→Loop→Coedge→Edge→Vertex).
 *
 * S1 is HIGH RISK and additive — no ribbon op calls `bindSpine` in production
 * yet; it is exercised only by this spec. The spec:
 *   - drives the REAL Part-tab ribbon to build each primitive + boolean (so the
 *     artifact is an in-motion real-workflow capture — slow-mo video, key-frame
 *     stills, multi-angle drag-orbit, per the ArchDisc methodology);
 *   - then, inside win.evaluate, `bindSpine`s each result and asserts the spine
 *     against the source shape:
 *       * spine entity counts (faces / edges / vertices / loops / coedges)
 *         match independent `TopExp` counts of the same shape;
 *       * `validateSpine().ok` and `checkEulerPoincare().ok`, χ correct;
 *       * the non-manifold case shows ≥1 edge with >2 coedges;
 *       * the multi-lump compound binds to >1 lump;
 *       * the degenerate-shape case (a sphere — has pole seam edges) binds and
 *         validates, exercising the degenerate-edge handling.
 *
 * `bindSpine` + `validateSpine` are reached through `window.__archdiscSpine`.
 * Imports are BARE specifiers (no node:).
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { buildPrimitive } from './helpers/uiWorkflow.js';
import { launchWithCapture, clickBody, dragOrbit } from './helpers/motionCapture.js';
import { captureAllAngles } from './helpers/orbitCapture.js';

test.setTimeout(600000);

test('SP-1 S1 — bindSpine: OCCT primitives + booleans bind to Euler-valid spine Bodies', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('spine-bind');
  try {
    // ── Step 1 — drive a REAL Part-tab workflow, motion-captured ─────────────
    // Build a Box and a Cylinder via the ribbon — these are the in-motion,
    // real-workflow artifacts. The spine-binding assertions follow.
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);
    await story.frame('input-box');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-box-3d');
    // Select the box with a REAL viewport click while it is the only body —
    // a genuine viewport interaction in the motion capture, no occlusion.
    await clickBody(win, boxId);
    await story.frame('box-selected');

    const cylId = await buildPrimitive(win, 'Cylinder');
    console.log(`  Cylinder id: ${cylId}`);
    await story.frame('input-cylinder');
    await dragOrbit(win, { dx: -180, dy: 70 });
    await story.frame('input-cylinder-3d');

    // ── Step 2 — bindSpine every primitive; compare to independent TopExp ────
    const primitives = await win.evaluate(async () => {
      const oc = await window.__archdiscKernel.getOCCT();
      const K = window.__archdiscKernel.kernel;
      const { bindSpine, validateSpine } = window.__archdiscSpine;

      const SE = oc.TopAbs_ShapeEnum;
      const SHAPE = SE.TopAbs_SHAPE;

      /** Independent IsSame-deduped TopExp count of a level. */
      function uniqueCount(shape, level) {
        const seen = [];
        const exp = new oc.TopExp_Explorer_2(shape, level, SHAPE);
        for (; exp.More(); exp.Next()) {
          const cur = exp.Current();
          let dup = false;
          for (const p of seen) { try { if (p.IsSame(cur)) { dup = true; break; } } catch (_e) {} }
          if (!dup) seen.push(cur);
        }
        const n = seen.length;
        exp.delete();
        return n;
      }

      const out = {};
      const cases = [
        ['box', () => K.brep.makeBox(20, 30, 40)],
        ['cylinder', () => K.brep.makeCylinder(12, 36)],
        ['sphere', () => K.brep.makeSphere(15)],
        ['cone', () => K.brep.makeCone(14, 6, 30)],
        ['torus', () => K.brep.makeTorus(20, 7)],
      ];
      for (const [name, make] of cases) {
        try {
          const brep = await make();
          const shape = brep.shape;
          // independent engine counts
          const occtCounts = {
            solids: uniqueCount(shape, SE.TopAbs_SOLID),
            shells: uniqueCount(shape, SE.TopAbs_SHELL),
            faces: uniqueCount(shape, SE.TopAbs_FACE),
            edges: uniqueCount(shape, SE.TopAbs_EDGE),
            vertices: uniqueCount(shape, SE.TopAbs_VERTEX),
          };
          // bind the spine
          const body = bindSpine(oc, shape, { geomEngineShape: brep });
          const report = validateSpine(body);
          const euler = body.checkEulerPoincare();
          let coedgeCount = 0;
          for (const f of body.faces()) coedgeCount += f.coedges().length;
          out[name] = {
            occtCounts,
            spineCounts: {
              lumps: body.lumps.length,
              shells: body.shells().length,
              faces: body.faces().length,
              loops: body.loops().length,
              coedges: coedgeCount,
              edges: body.edges().length,
              vertices: body.vertices().length,
            },
            kind: body.kind,
            euler: { actual: euler.actual, ok: euler.ok, genusImplied: euler.genusImplied },
            reportOk: report.ok,
            reportErrors: report.errors.slice(0, 4),
            adjacencyStrategy: body.diagnostics.bind && body.diagnostics.bind.adjacencyStrategy,
            degenerateEdges: body.diagnostics.bind && body.diagnostics.bind.degenerateEdges,
            coedgePartners: body.diagnostics.bind && body.diagnostics.bind.coedgePartners,
            realEdgeCount: body.realEdges().length,
            // counts agree: spine faces/edges/vertices == engine unique counts.
            facesMatch: body.faces().length === occtCounts.faces,
            edgesMatch: body.edges().length === occtCounts.edges,
            verticesMatch: body.vertices().length === occtCounts.vertices,
            // every REAL (non-degenerate) face edge of a closed solid is
            // manifold — exactly 2 coedges. Degenerate seam/pole edges are
            // exempt (they bound nothing).
            allRealEdgesManifold: body.realEdges().every(e => e.coedges.size === 2),
          };
          brep.dispose();
        } catch (e) {
          out[name] = { error: String(e).substring(0, 400) };
        }
      }
      return out;
    });

    for (const [name, r] of Object.entries(primitives)) {
      if (r.error) { console.log(`  ${name}: ERROR ${r.error}`); continue; }
      console.log(`  ${name}: spine ${JSON.stringify(r.spineCounts)} ` +
        `kind=${r.kind} χ=${r.euler.actual} eulerOk=${r.euler.ok} ` +
        `validateOk=${r.reportOk} adj="${r.adjacencyStrategy}" ` +
        `degenEdges=${r.degenerateEdges} partners=${JSON.stringify(r.coedgePartners)}`);
      if (r.reportErrors && r.reportErrors.length) {
        console.log(`    errors: ${JSON.stringify(r.reportErrors)}`);
      }
    }

    // ── Assertions on every primitive ────────────────────────────────────────
    for (const name of ['box', 'cylinder', 'sphere', 'cone', 'torus']) {
      const r = primitives[name];
      expect(r, `${name} must bind without throwing`).toBeDefined();
      expect(r.error, `${name} bindSpine error: ${r.error}`).toBeUndefined();
      // counts agree with independent engine TopExp counts.
      expect(r.facesMatch, `${name}: spine face count != engine count`).toBe(true);
      expect(r.edgesMatch, `${name}: spine edge count != engine count`).toBe(true);
      expect(r.verticesMatch, `${name}: spine vertex count != engine count`).toBe(true);
      // a primitive solid is one lump.
      expect(r.spineCounts.lumps).toBe(1);
      // Every primitive is a watertight SOLID — including the sphere, whose
      // degenerate pole edges must NOT mis-classify it as a sheet.
      expect(r.kind, `${name}: a watertight primitive must bind as 'solid'`).toBe('solid');
      // Euler-Poincaré holds (degenerate edges excluded from the count — so
      // the sphere is χ=2 genus-0, the torus χ=0 genus-1).
      expect(r.euler.ok, `${name}: Euler-Poincaré failed (χ=${r.euler.actual})`).toBe(true);
      // every REAL face edge is manifold (the primitives are watertight solids).
      expect(r.allRealEdgesManifold, `${name}: a real face edge is not manifold`).toBe(true);
      // validateSpine clean.
      expect(r.reportOk,
        `${name}: validateSpine errors ${JSON.stringify(r.reportErrors)}`).toBe(true);
      // a closed solid has NO non-manifold edge; every real edge has a
      // manifold partner — so manifold-partner count == real edge count.
      expect(r.coedgePartners.manifold).toBe(r.realEdgeCount);
      expect(r.coedgePartners.nonManifold).toBe(0);
    }
    // The box is the V−E+F=2 canonical case.
    expect(primitives.box.spineCounts).toMatchObject({
      lumps: 1, shells: 1, faces: 6, loops: 6, edges: 12, vertices: 8,
    });
    expect(primitives.box.euler.actual).toBe(2);
    // The sphere is THE degenerate-edge edge case (SP-1 methodology): the
    // engine represents it as ONE face + a seam edge + 2 degenerate pole
    // edges. bindSpine must (a) detect the degenerate edges, (b) exclude them
    // from the Euler count so the sphere is χ=2 genus-0 (not a spurious
    // genus-1), and (c) NOT mis-classify the watertight sphere as a sheet.
    expect(primitives.sphere.reportOk,
      `sphere validateSpine errors ${JSON.stringify(primitives.sphere.reportErrors)}`).toBe(true);
    expect(primitives.sphere.degenerateEdges,
      'the engine sphere must yield ≥1 degenerate (pole) edge').toBeGreaterThan(0);
    expect(primitives.sphere.kind).toBe('solid');
    expect(primitives.sphere.euler.actual,
      'a genus-0 sphere has χ=2 once degenerate edges are excluded').toBe(2);
    expect(primitives.sphere.euler.genusImplied).toBe(0);
    // The torus is genus-1 → χ=0; Euler-Poincaré still consistent.
    expect(primitives.torus.euler.actual).toBe(0);
    expect(primitives.torus.euler.genusImplied).toBe(1);

    // ── Step 3 — bindSpine boolean results (fuse / cut / common) ─────────────
    const booleans = await win.evaluate(async () => {
      const oc = await window.__archdiscKernel.getOCCT();
      const K = window.__archdiscKernel.kernel;
      const { bindSpine, validateSpine } = window.__archdiscSpine;
      const SE = oc.TopAbs_ShapeEnum;
      const SHAPE = SE.TopAbs_SHAPE;
      function uniqueCount(shape, level) {
        const seen = [];
        const exp = new oc.TopExp_Explorer_2(shape, level, SHAPE);
        for (; exp.More(); exp.Next()) {
          const cur = exp.Current();
          let dup = false;
          for (const p of seen) { try { if (p.IsSame(cur)) { dup = true; break; } } catch (_e) {} }
          if (!dup) seen.push(cur);
        }
        const n = seen.length;
        exp.delete();
        return n;
      }
      const out = {};

      // fuse — a box ∪ a cylinder poking through it.
      try {
        const a = await K.brep.makeBox(30, 30, 30);
        const b = await K.brep.makeCylinder(8, 50);
        const r = await K.brep.fuse(a, b);
        const body = bindSpine(oc, r.shape, { geomEngineShape: r });
        const report = validateSpine(body);
        out.fuse = {
          spineFaces: body.faces().length,
          occtFaces: uniqueCount(r.shape, SE.TopAbs_FACE),
          spineEdges: body.edges().length,
          occtEdges: uniqueCount(r.shape, SE.TopAbs_EDGE),
          lumps: body.lumps.length,
          kind: body.kind,
          eulerOk: body.checkEulerPoincare().ok,
          eulerActual: body.checkEulerPoincare().actual,
          reportOk: report.ok,
          reportErrors: report.errors.slice(0, 4),
        };
        a.dispose(); b.dispose(); r.dispose();
      } catch (e) { out.fuse = { error: String(e).substring(0, 300) }; }

      // cut — a box with a cylindrical hole drilled CLEAN THROUGH it. The
      // drill is translated to span well past BOTH the top and bottom faces
      // so the cut unambiguously produces a through-hole (no coplanar-face
      // numerical degeneracy).
      try {
        const block = await K.brep.makeBox(40, 40, 20);
        const drillRaw = await K.brep.makeCylinder(6, 80);
        const drill = await K.brep.translate(drillRaw, 20, 20, -30); // centred, z∈[-30,50]
        const r = await K.brep.cut(block, drill);
        const body = bindSpine(oc, r.shape, { geomEngineShape: r });
        const report = validateSpine(body);
        // a through-drilled box has faces with an inner (hole) loop.
        const facesWithHoles = body.faces().filter(f => f.innerLoops.length > 0).length;
        // per-face loop census: total loops (outer + inner) on each face.
        const loopCensus = body.faces().map(f => f.allLoops().length).sort((a, b) => b - a);
        const facesWithMultipleLoops = body.faces().filter(f => f.allLoops().length > 1).length;
        // independent engine wire-per-face count — confirms the engine result
        // itself has multi-wire faces, isolating bindSpine's classification.
        let occtMaxWiresPerFace = 0;
        const fe = new oc.TopExp_Explorer_2(r.shape, SE.TopAbs_FACE, SHAPE);
        const seenF = [];
        for (; fe.More(); fe.Next()) {
          const f = oc.TopoDS.Face_1(fe.Current());
          if (seenF.some(p => { try { return p.IsSame(f); } catch (_e) { return false; } })) continue;
          seenF.push(f);
          let w = 0;
          const we = new oc.TopExp_Explorer_2(f, SE.TopAbs_WIRE, SHAPE);
          const seenW = [];
          for (; we.More(); we.Next()) {
            const wi = we.Current();
            if (seenW.some(p => { try { return p.IsSame(wi); } catch (_e) { return false; } })) continue;
            seenW.push(wi); w += 1;
          }
          we.delete();
          if (w > occtMaxWiresPerFace) occtMaxWiresPerFace = w;
        }
        fe.delete();
        const eu = body.checkEulerPoincare();
        out.cut = {
          spineFaces: body.faces().length,
          occtFaces: uniqueCount(r.shape, SE.TopAbs_FACE),
          facesWithHoles,
          facesWithMultipleLoops,
          loopCensus,
          occtMaxWiresPerFace,
          ringLoops: body.ringLoopCount(),
          lumps: body.lumps.length,
          kind: body.kind,
          eulerOk: eu.ok,
          eulerActual: eu.actual,
          eulerLhs: eu.lhs,
          eulerGenus: eu.genusImplied,
          reportOk: report.ok,
          reportErrors: report.errors.slice(0, 4),
        };
        block.dispose(); drillRaw.dispose(); drill.dispose(); r.dispose();
      } catch (e) { out.cut = { error: String(e).substring(0, 300) }; }

      // common — intersection of a box and a sphere.
      try {
        const block = await K.brep.makeBox(24, 24, 24);
        const ball = await K.brep.makeSphere(16);
        const r = await K.brep.common(block, ball);
        const body = bindSpine(oc, r.shape, { geomEngineShape: r });
        const report = validateSpine(body);
        out.common = {
          spineFaces: body.faces().length,
          occtFaces: uniqueCount(r.shape, SE.TopAbs_FACE),
          lumps: body.lumps.length,
          kind: body.kind,
          eulerOk: body.checkEulerPoincare().ok,
          reportOk: report.ok,
          reportErrors: report.errors.slice(0, 4),
        };
        block.dispose(); ball.dispose(); r.dispose();
      } catch (e) { out.common = { error: String(e).substring(0, 300) }; }

      return out;
    });

    console.log(`  fuse:   ${JSON.stringify(booleans.fuse)}`);
    console.log(`  cut:    ${JSON.stringify(booleans.cut)}`);
    console.log(`  common: ${JSON.stringify(booleans.common)}`);

    for (const op of ['fuse', 'cut', 'common']) {
      const r = booleans[op];
      expect(r, `${op} must bind`).toBeDefined();
      expect(r.error, `${op} bindSpine error: ${r.error}`).toBeUndefined();
      expect(r.spineFaces).toBe(r.occtFaces);
      expect(r.kind).toBe('solid');
      expect(r.eulerOk, `${op}: Euler-Poincaré failed`).toBe(true);
      expect(r.reportOk,
        `${op}: validateSpine errors ${JSON.stringify(r.reportErrors)}`).toBe(true);
    }
    expect(booleans.fuse.spineEdges).toBe(booleans.fuse.occtEdges);
    // The drilled box must have ≥1 face carrying a hole — a face with more
    // than one loop (an outer boundary + an inner hole loop). The hole pierces
    // the top and bottom faces, so ≥2 faces are multi-loop.
    console.log(`  cut loop census: ${JSON.stringify(booleans.cut.loopCensus)}, ` +
      `facesWithHoles=${booleans.cut.facesWithHoles}, ` +
      `ringLoops=${booleans.cut.ringLoops}, ` +
      `χ=${booleans.cut.eulerActual} V−E+F−R=${booleans.cut.eulerLhs} ` +
      `genus=${booleans.cut.eulerGenus}`);
    expect(booleans.cut.facesWithMultipleLoops,
      'a drilled box must have ≥1 face with an outer + an inner loop').toBeGreaterThan(0);
    expect(booleans.cut.facesWithHoles,
      'the inner loop must be classified as a hole (innerLoops)').toBeGreaterThan(0);
    // A box drilled CLEAN THROUGH is topologically genus 1 (a handle). The
    // full Euler-Poincaré formula V−E+F−R = 2(S−G) must yield genus 1 —
    // proving bindSpine counts ring loops and the validator's Euler check is
    // the real formula, not the naive χ=2.
    expect(booleans.cut.ringLoops,
      'a through-hole contributes ring (inner) loops').toBeGreaterThan(0);
    expect(booleans.cut.eulerGenus,
      'a through-drilled box is genus 1').toBe(1);

    await story.frame('booleans-bound');

    // ── Step 4 — non-manifold + multi-lump bindSpine ─────────────────────────
    const advanced = await win.evaluate(async () => {
      const oc = await window.__archdiscKernel.getOCCT();
      const K = window.__archdiscKernel.kernel;
      const { bindSpine, validateSpine } = window.__archdiscSpine;
      const out = {};

      // Non-manifold — fuseNonManifold of two boxes sharing a face.
      try {
        const a = await K.brep.makeBox(20, 20, 10);
        const b = await K.brep.makeBox(20, 20, 10);
        const bUp = await K.brep.translate(b, 0, 0, 10);
        const nm = await K.brep.fuseNonManifold(a, bUp);
        const body = bindSpine(oc, nm.shape, { geomEngineShape: nm });
        const report = validateSpine(body);
        const eu = body.checkEulerPoincare();
        out.nonManifold = {
          faces: body.faces().length,
          edges: body.edges().length,
          nonManifoldEdgeCount: body.nonManifoldEdges().length,
          maxCoedgesPerEdge: Math.max(0, ...body.edges().map(e => e.coedges.size)),
          coedgePartners: body.diagnostics.bind.coedgePartners,
          kind: body.kind,
          eulerOk: eu.ok,
          eulerNonManifoldEdges: eu.nonManifoldEdges,
          eulerNote: eu.note,
          // radial-cycle check: on a non-manifold edge every coedge's partner
          // is another coedge of the SAME edge (the radial cycle).
          radialCycleValid: body.nonManifoldEdges().every(e => {
            const ces = [...e.coedges];
            return ces.every(ce => ce.partner && e.coedges.has(ce.partner));
          }),
          reportOk: report.ok,
          reportErrors: report.errors.slice(0, 5),
        };
        a.dispose(); b.dispose(); bUp.dispose(); nm.dispose();
      } catch (e) { out.nonManifold = { error: String(e).substring(0, 400) }; }

      // Multi-lump — a compound of two disjoint boxes.
      try {
        const b1 = await K.brep.makeBox(10, 10, 10);
        const b2box = await K.brep.makeBox(10, 10, 10);
        const b2 = await K.brep.translate(b2box, 40, 0, 0); // far apart — disjoint
        const compound = await K.brep.makeCompound([b1, b2]);
        const body = bindSpine(oc, compound.shape, { geomEngineShape: compound });
        const report = validateSpine(body);
        out.multiLump = {
          lumps: body.lumps.length,
          faces: body.faces().length,
          shells: body.shells().length,
          kind: body.kind,
          eulerActual: body.checkEulerPoincare().actual,
          eulerOk: body.checkEulerPoincare().ok,
          reportOk: report.ok,
          reportErrors: report.errors.slice(0, 4),
        };
        b1.dispose(); b2box.dispose(); b2.dispose(); compound.dispose();
      } catch (e) { out.multiLump = { error: String(e).substring(0, 400) }; }

      return out;
    });

    console.log(`  non-manifold: ${JSON.stringify(advanced.nonManifold)}`);
    console.log(`  multi-lump:   ${JSON.stringify(advanced.multiLump)}`);

    // Non-manifold: bindSpine must produce a structurally valid spine with the
    // non-manifold topology represented as first-class radial coedge cycles.
    expect(advanced.nonManifold, 'non-manifold must bind').toBeDefined();
    expect(advanced.nonManifold.error,
      `non-manifold bindSpine error: ${advanced.nonManifold.error}`).toBeUndefined();
    expect(advanced.nonManifold.reportOk,
      `non-manifold validateSpine errors ${JSON.stringify(advanced.nonManifold.reportErrors)}`)
      .toBe(true);
    // The recon (probe 6) showed fuseNonManifold of stacked boxes yields a
    // non-manifold edge — bindSpine must reflect that as a >2-coedge edge.
    expect(advanced.nonManifold.maxCoedgesPerEdge).toBeGreaterThan(2);
    expect(advanced.nonManifold.nonManifoldEdgeCount).toBeGreaterThan(0);
    expect(advanced.nonManifold.coedgePartners.nonManifold).toBeGreaterThan(0);
    // each non-manifold edge's coedges form a radial cycle (every coedge's
    // partner is another coedge of the same edge).
    expect(advanced.nonManifold.radialCycleValid,
      'non-manifold edges must have valid radial coedge cycles').toBe(true);
    // checkEulerPoincare must IDENTIFY the body as non-manifold and report the
    // manifold relation as inapplicable (not violated) — so validateSpine's
    // Euler check does not false-positive on first-class non-manifold topology.
    expect(advanced.nonManifold.eulerOk).toBe(true);
    expect(advanced.nonManifold.eulerNonManifoldEdges).toBeGreaterThan(0);

    // Multi-lump: a compound of two disjoint boxes → 2 lumps.
    expect(advanced.multiLump, 'multi-lump must bind').toBeDefined();
    expect(advanced.multiLump.error,
      `multi-lump bindSpine error: ${advanced.multiLump.error}`).toBeUndefined();
    expect(advanced.multiLump.lumps).toBe(2);
    expect(advanced.multiLump.faces).toBe(12); // 6 + 6
    expect(advanced.multiLump.reportOk).toBe(true);

    await story.frame('advanced-bound');

    // ── Step 5 — multi-angle render, no blank frames ─────────────────────────
    const cap = await captureAllAngles(win, 'spine-bind', { story, drags: 6 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Step 6 — storyboard stills exist ─────────────────────────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input-box\.png$/.test(f));
    const boundStill = stills.find(f => /-booleans-bound\.png$/.test(f));
    expect(inputStill, 'an input-box still must exist').toBeTruthy();
    expect(boundStill, 'a booleans-bound still must exist').toBeTruthy();
    expect(fs.statSync(inputStill).size).toBeGreaterThan(10 * 1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize, 'the recorded session .webm must be > 200 KB')
      .toBeGreaterThan(200 * 1024);
  }
});
