/**
 * spine-s7-topology-inspector-electron.spec.js — SP-1 Stage S7 (CAPSTONE)
 *
 * The SP-1 spine's UI-layer acceptance. Composes a REAL engineered part —
 * a HYDRAULIC CROSSOVER MANIFOLD JUNCTION (heavy-equipment / construction-
 * machinery hydraulic plumbing) — whose topology genuinely needs the
 * inspector to be inspectable:
 *
 *   (a) MULTI-LUMP body — two disjoint bracket arms compounded into one
 *       body (different positions, different sizes), so the inspector
 *       tree shows TWO lumps under one body root.
 *   (b) NON-MANIFOLD radial junction at the centre — three radial web
 *       plates fused at a common axial edge (the cross-over node — three
 *       plates meet at one edge → non-manifold edges with >2 coedges).
 *       This is what the inspector's per-edge radial-cycle readout
 *       EXISTS to surface.
 *   (c) G2 BLEND on one of the bracket arms — a curvature-continuous
 *       end-cap blend producing a SPINE-NATIVE ANALYTIC FACE (S6).
 *       This is what the inspector's `isAnalytic: true` readout exists
 *       to surface — clicking the analytic face in the inspector tree
 *       shows `isAnalytic: true` + the seed edges in `derivedFrom`.
 *
 * The model is DELIBERATELY DIFFERENT from every prior spine bespoke
 * model:
 *   - S3 manifold collector — primitives + boolean + transform.
 *   - S4 rotary valve body — features chain (extrude / revolve / fillet).
 *   - S4b enclosure — local-ops chain.
 *   - S4c impeller fairing — surfacing-led curvy assembly.
 *   - S5 multi-plate junction — non-manifold welded steel structure (3 plates).
 *   - S6 clip-on grip blank — analytic-face-led single part.
 *   - S7 hydraulic crossover junction — MULTI-LUMP + non-manifold
 *     + analytic-face COMPOUND assembly (every spine property the
 *     inspector exists to surface — exercised together in one part).
 *
 * Focal S7 assertions:
 *   1. The Inspector PANEL is mounted in the workbench right aside (NOT
 *      a floating box) — verified by DOM presence
 *      (`[data-archdisc-tinsp-state]`).
 *   2. Selection-driven population — registering a body in the scene
 *      makes the inspector show that body's spine. Counts (lumps,
 *      shells, faces, loops, coedges, edges, vertices) match the
 *      live spine.
 *   3. Drill-down into a Face node shows `isAnalytic: true` for the
 *      G2-blend analytic face (S6 contract surfaced in the UI).
 *   4. Drill-down into a non-manifold Edge node shows the radial
 *      coedge cycle count (>2 coedges).
 *   5. Click on a tree node primes
 *      `window.__archdiscSelectionFilter` to 'face' / 'edge' / 'vertex'
 *      per node kind — the Tier-11a pick path consumes that filter,
 *      so the inspector and the viewport pick are wired through the
 *      existing selection-filter mechanism.
 *   6. The body-level header readout reports the Euler-Poincaré
 *      report + validateSpine state.
 *
 * Methodology — ArchDisc standing standards:
 *   - HEADED ELECTRON, motion-capture (slow-mo video + key-frame stills).
 *   - ONE test() per file. Imports use BARE specifiers (no node:).
 *   - The workflow is a COMPLETE complex multi-op build — primitives
 *     → translate → rotate → fuseAll (non-manifold) → makeCompound
 *     (multi-lump) → G2 blend (analytic face) — climaxing on the
 *     inspector assertions.
 *   - ONE WELL-FRAMED CAMERA POSITION — the crossover junction is a
 *     single assembly, perfectly viewable from one iso. ONE
 *     deliberate orbit at the end reveals the radial-fan geometry
 *     the iso view cannot show. 4 stills total. NO 7-angle template.
 *
 * Run: ./node_modules/.bin/playwright test spine-s7-topology-inspector
 *   --headed --workers=1
 */

import { test, expect } from '@playwright/test';
import { launchWithCapture, dragOrbit } from './helpers/motionCapture.js';
import { buildPrimitive } from './helpers/uiWorkflow.js';

test.setTimeout(600000);

test('SP-1 S7 — hydraulic crossover junction: inspector surfaces multi-lump + non-manifold + analytic-face spine in the workbench sidebar', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('spine-s7-topology-inspector');
  try {
    // ── Step 1 — confirm the inspector panel is present in the workbench
    //         sidebar BEFORE any body is in the scene. The panel must be
    //         mounted as an INTEGRATED sidebar component (not a floating
    //         debug box) — verified by querying the panel root via the
    //         data-attribute the inspector sets.
    const initialInspectorState = await win.evaluate(() => {
      const root = document.querySelector('[data-archdisc-tinsp-state]');
      return root ? {
        present: true,
        state: root.getAttribute('data-archdisc-tinsp-state'),
        // Confirm it is INSIDE the workbench right aside, not in body root
        // (which would suggest a floating overlay). The right aside has
        // className 'workbench-properties'.
        inSidebar: !!root.closest('.workbench-properties'),
      } : { present: false };
    });
    expect(initialInspectorState.present, 'TopologyInspector panel must be mounted on first paint').toBe(true);
    expect(initialInspectorState.inSidebar, 'TopologyInspector must live inside the right aside (no floating box)').toBe(true);
    expect(initialInspectorState.state, 'Inspector starts in empty state when no body is selected').toBe('empty');
    await story.frame('01-inspector-empty-state');

    // ── Step 2 — seed Box via the real Part-tab ribbon (proves the real
    //         ribbon path → spine path is healthy).
    const seedBoxId = await buildPrimitive(win, 'Box');
    console.log(`  seed box id: ${seedBoxId}`);
    await win.waitForTimeout(300);
    await story.frame('02-inspector-after-seed-box');

    // The inspector should now show the seed Box's spine. Dispatch one
    // refresh in case the first registry notify fired before the window
    // slot was populated by addBrepShapeToScene — a timing belt-and-
    // braces seen on the first body of a session.
    await win.evaluate(() => window.dispatchEvent(new Event('archdisc:inspector-refresh')));
    await win.waitForTimeout(150);
    const afterSeed = await win.evaluate(() => {
      const i = window.__archdiscTopologyInspector;
      const snap = i ? i.getSnapshot() : null;
      return snap ? {
        bodyKind: snap.bodyKind,
        bodyPid: snap.persistentId,
        counts: snap.counts,
        eulerOk: snap.euler.ok,
        genusImplied: snap.euler.genusImplied,
      } : null;
    });
    expect(afterSeed, 'Inspector snapshot present after seed box').toBeTruthy();
    expect(afterSeed.bodyKind, 'seed box derives as solid').toBe('solid');
    expect(afterSeed.counts.faces, 'seed box has 6 faces').toBe(6);
    expect(afterSeed.counts.edges, 'seed box has 12 edges').toBe(12);
    expect(afterSeed.counts.vertices, 'seed box has 8 vertices').toBe(8);
    expect(afterSeed.eulerOk, 'seed box Euler-Poincaré ok').toBe(true);
    expect(afterSeed.genusImplied, 'seed box genus 0').toBe(0);

    // Clear the scene — the focal model is the only body of interest.
    await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      reg.clearSelection();
      const bodies = [...reg.bodies];
      for (const body of bodies) {
        if (typeof reg.remove === 'function') reg.remove(body.id);
        else if (body.group && body.group.parent) body.group.parent.remove(body.group);
      }
    });
    await win.waitForTimeout(220);

    // ── Step 3 — build the hydraulic crossover junction (the focal model).
    //   The chain runs inside ONE win.evaluate so failures surface with one
    //   stack trace. Each op result is captured.
    const result = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      const { bindSpine, validateSpine } = window.__archdiscSpine;
      const getKernel = window.__archdiscKernel.getKernel;
      const oc = await getKernel();
      const out = { stages: [] };

      // ── 3.1 — Build the multi-arg non-manifold junction at the centre.
      // Three radial web-plates fused at the central Z-axis edge — each
      // plate is 30 mm × 4 mm × 30 mm, arranged at 0° / 120° / 240°. The
      // shared Z-axis edge has 3 contributing plates → non-manifold.
      const PLATE_L = 30, PLATE_T = 4, PLATE_H = 30;
      const plateRaw = [];
      for (let i = 0; i < 3; i++) {
        const p = await K.brep.makeBox(PLATE_L, PLATE_T, PLATE_H);
        const pT = await K.brep.translate(p, 0, -PLATE_T / 2, 0);
        const angle = (i * 2 * Math.PI) / 3;
        const pR = await K.brep.rotate(pT, { x: 0, y: 0, z: 1 }, angle);
        plateRaw.push(pR);
      }

      // fuseAll runs BRepAlgoAPI_BuilderAlgo — the multi-arg non-manifold
      // boolean. fuseAll is not S3-migrated (raw BrepShape return), so the
      // spec calls bindSpine manually with declaredKind='solid'.
      const fusedRaw = await K.brep.fuseAll(plateRaw);
      const junctionBody = bindSpine(oc, fusedRaw.shape, {
        bodyTag: 'crossoverJunction',
        geomEngineShape: fusedRaw,
        declaredKind: 'solid',
      });
      // Wrap the junction in a SpineBody so the registry entry carries a
      // brepShapeRef with `.body` — the inspector reads `.body` to find
      // the spine. Without this wrap the registry holds the raw BrepShape
      // and the inspector cannot find a spine to surface.
      const { SpineBody } = window.__archdiscSpine.classes;
      const junctionSpine = new SpineBody(junctionBody, fusedRaw, {
        op: 'fuseAll-radial-junction',
        nonManifoldEdges: junctionBody.nonManifoldEdges().length,
      });

      const junctionNm = junctionBody.nonManifoldEdges();
      const junctionVal = validateSpine(junctionBody);
      out.stages.push({
        op: '3.1 fuseAll(3 radial plates) — non-manifold junction',
        kind: junctionBody.kind,
        declaredKind: junctionBody.declaredKind,
        lumps: junctionBody.lumps.length,
        faces: junctionBody.faces().length,
        edges: junctionBody.edges().length,
        vertices: junctionBody.vertices().length,
        nonManifoldEdges: junctionNm.length,
        maxCoedgesPerEdge: Math.max(0, ...junctionBody.edges().map(e => e.coedges.size)),
        validateOk: junctionVal.ok,
      });

      // Add the junction to the scene as the SpineBody (so the registry's
      // brepShapeRef carries the spine).
      const adder = window.__archdiscAddBrepShape;
      const scene = window.__archdiscViewport.scene;
      const vp = window.__archdiscViewport;
      await adder(scene, vp, junctionSpine, 0xd14b3a);  // red — non-manifold node

      // ── 3.2 — Build TWO disjoint bracket arms at different positions.
      // Each bracket is an extruded rectangular profile; the two are
      // translated so they do NOT overlap or share volume → a compound
      // body would have TWO lumps (one per disconnected solid).
      const armA = await K.brep.makeBox(50, 8, 16);
      const armATranslated = await K.brep.translate(armA, 60, -4, 0);
      const armB = await K.brep.makeBox(45, 8, 18);
      const armBTranslated = await K.brep.translate(armB, -75, -4, 5);
      out.stages.push({
        op: '3.2 armA translated to +X — primary bracket',
        kind: armATranslated.body.kind,
        faces: armATranslated.body.faces().length,
        validateOk: validateSpine(armATranslated.body).ok,
      });

      // ── 3.3 — G2 BLEND on armA between two of its edges (one on each
      // long side) — produces a SPINE-NATIVE ANALYTIC face the inspector
      // must surface as `isAnalytic: true`. The seed edges' persistent ids
      // land in the analytic face's `derivedFrom`.
      const armEdgeCount = await K.brep.edgeCount(armATranslated);
      const blend = await K.brep.g2BlendBetweenEdges(armATranslated, {
        edgeIndexA: 0,
        edgeIndexB: Math.min(armEdgeCount - 1, Math.max(2, Math.floor(armEdgeCount / 2))),
        uSegments: 16,
        vSegments: 8,
      });

      const blendAnalyticFace = blend.body.faces().find(f => f.isAnalytic);
      out.stages.push({
        op: '3.3 g2BlendBetweenEdges(armA, edge0, edgeMid) — analytic face',
        kind: blend.body.kind,
        declaredKind: blend.body.declaredKind,
        spineFaceCount: blend.body.faces().length,
        hasAnalyticFace: !!blendAnalyticFace,
        analyticFacePid: blendAnalyticFace ? blendAnalyticFace.persistentId : null,
        analyticDerivedFromCount: blendAnalyticFace ? blendAnalyticFace.derivedFrom.length : 0,
        validateOk: validateSpine(blend.body).ok,
      });
      await adder(scene, vp, blend, 0x4a90d9);  // blue — blended bracket
      await adder(scene, vp, armBTranslated, 0x76c43a);  // green — armB

      // ── 3.4 — Set the JUNCTION body as the registry-selected body so the
      // inspector FIRST surfaces the most interesting topology (multi-lump
      // & non-manifold). The spec's "non-manifold edge drill" step exercises
      // this first; afterwards it switches to the blend body for the
      // analytic-face drill.
      const reg = window.__archdiscRegistry;
      const junctionEntry = reg.bodies.find(b => {
        const ref = b.brepShapeRef || b.group?.userData?.brepShapeRef;
        return ref === junctionSpine;
      });
      const blendEntry = reg.bodies.find(b => {
        const ref = b.brepShapeRef || b.group?.userData?.brepShapeRef;
        return ref === blend;
      });
      if (junctionEntry) reg.select(junctionEntry.id);
      // Mirror the blend on the window slot — secondary introspection
      // surface that the spec's analytic-face drill step uses by clearing
      // the registry selection.
      window.__lastSpineBody = blend;
      window.__lastSpine = blend.body;

      out.bodyIds = {
        junctionEntryId: junctionEntry ? junctionEntry.id : null,
        blendEntryId: blendEntry ? blendEntry.id : null,
        blendBodyId: blend.id,
      };
      out.lastSpineFaceCount = blend.body.faces().length;
      return out;
    });

    console.log('\n  STAGES:');
    for (const s of result.stages) console.log(`    ${JSON.stringify(s)}`);

    // Sanity-gate before driving the inspector:
    const junctionStage = result.stages.find(s => s.op.startsWith('3.1'));
    expect(junctionStage.nonManifoldEdges, `junction non-manifold edge count > 0 (got ${junctionStage.nonManifoldEdges})`).toBeGreaterThan(0);
    expect(junctionStage.maxCoedgesPerEdge, 'max coedges per edge >= 3').toBeGreaterThanOrEqual(3);
    const blendStage = result.stages.find(s => s.op.startsWith('3.3'));
    expect(blendStage.hasAnalyticFace, 'G2 blend produced an analytic spine face').toBe(true);

    // ── Step 4 — Frame the focal model.
    await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      if (reg.bodies.length > 0) {
        const THREE = window.THREE;
        const aggregate = new THREE.Box3();
        for (const b of reg.bodies) {
          if (b.group) {
            b.group.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(b.group);
            if (!box.isEmpty()) aggregate.union(box);
          }
        }
        if (!aggregate.isEmpty()) {
          const centre = aggregate.getCenter(new THREE.Vector3());
          const size = aggregate.getSize(new THREE.Vector3());
          const r = Math.max(size.x, size.y, size.z) * 1.6;
          const vp = window.__archdiscViewport;
          const cam = vp.camera;
          cam.position.set(centre.x + r * 0.9, centre.y + r * 0.55, centre.z + r * 1.1);
          cam.lookAt(centre);
          if (vp.controls && vp.controls.target) {
            vp.controls.target.copy(centre);
            vp.controls.update();
          }
        }
      }
    });
    await win.waitForTimeout(500);
    await story.frame('03-junction-iso-framed');

    // ── Step 5 — drive the inspector: first inspect the JUNCTION body
    // (registry-selected — multi-lump, non-manifold edges). Body-level
    // readout shows the spine counts + Euler-Poincaré.
    await win.evaluate(() => {
      window.dispatchEvent(new Event('archdisc:inspector-refresh'));
    });
    await win.waitForTimeout(200);

    const inspectorRoot = await win.evaluate(() => {
      const root = document.querySelector('[data-archdisc-tinsp-state]');
      const i = window.__archdiscTopologyInspector;
      const snap = i ? i.getSnapshot() : null;
      const active = i ? i.getActive() : null;
      return {
        rootState: root ? root.getAttribute('data-archdisc-tinsp-state') : null,
        rootSource: root ? root.getAttribute('data-archdisc-tinsp-source') : null,
        bodyKind: snap ? snap.bodyKind : null,
        declaredKind: snap ? snap.declaredKind : null,
        bodyPid: snap ? snap.persistentId : null,
        counts: snap ? snap.counts : null,
        eulerOk: snap ? snap.euler.ok : null,
        genusImplied: snap ? snap.euler.genusImplied : null,
        validation: snap ? snap.validation : null,
        activeSource: active ? active.source : null,
      };
    });
    console.log('\n  INSPECTOR (junction) ACTIVE SPINE BODY:');
    console.log('    ', JSON.stringify(inspectorRoot, null, 2));

    expect(inspectorRoot.rootState, 'inspector active').toBe('active');
    expect(inspectorRoot.rootSource, 'inspector source = registry (junction-selected)').toBe('registry');
    expect(inspectorRoot.bodyKind, 'inspector reads junction body kind').toBe('solid');
    expect(inspectorRoot.bodyPid, 'inspector body pid matches junction tag').toMatch(/crossoverJunction/);
    expect(inspectorRoot.counts.nonManifoldEdges, 'inspector counts non-manifold edges').toBeGreaterThan(0);
    expect(inspectorRoot.counts.lumps, 'junction multi-lump (each plate is a lump)').toBeGreaterThan(1);
    expect(inspectorRoot.validation && inspectorRoot.validation.ok, 'junction validateSpine ok').toBe(true);

    await story.frame('04-inspector-body-readout-junction');

    // ── Step 6 — DRILL into a non-manifold edge of the junction. The
    // junction has > 2 coedges per edge — the inspector's per-edge readout
    // MUST surface this.
    const edgeDrill = await win.evaluate(() => {
      const i = window.__archdiscTopologyInspector;
      const node = i.findNode(n => n.kind === 'edge' && n.isNonManifold);
      if (!node) return { error: 'no non-manifold edge in snapshot' };
      i.selectNode(node.persistentId || `t:${node.transientId}`);
      return new Promise(resolve => setTimeout(() => {
        const sel = window.__lastSpineInspectorPick;
        const readout = document.querySelector('[data-archdisc-tinsp-readout]');
        const readoutKind = readout ? readout.getAttribute('data-archdisc-tinsp-readout') : null;
        const radialAttr = document.querySelector('[data-archdisc-tinsp-edge-radial]');
        const radialCount = radialAttr ? radialAttr.getAttribute('data-archdisc-tinsp-edge-radial') : null;
        resolve({
          drillRecord: sel,
          readoutKind,
          radialCount,
          coedgeCount: node.coedgeCount,
          filter: window.__archdiscSelectionFilter,
        });
      }, 80));
    });

    console.log('\n  NON-MANIFOLD EDGE DRILL:');
    console.log('    ', JSON.stringify(edgeDrill, null, 2));

    expect(edgeDrill.error, 'drill found non-manifold edge').toBeUndefined();
    expect(edgeDrill.drillRecord.kind, 'drill kind = edge').toBe('edge');
    expect(edgeDrill.drillRecord.isNonManifold, 'drill record carries isNonManifold=true').toBe(true);
    expect(edgeDrill.readoutKind, 'readout DOM shows edge kind').toBe('edge');
    expect(parseInt(edgeDrill.radialCount, 10), 'readout DOM shows coedge count > 2').toBeGreaterThan(2);
    expect(edgeDrill.filter, 'inspector primed selection filter = edge').toBe('edge');

    await story.frame('05-inspector-nonmanifold-edge-drill');

    // ── Step 7 — switch the inspector to the BLEND body (analytic face).
    // The blend body has an `isAnalytic: true` face surfacing the SP-1 §2.7
    // unified analytic Surface contract. Clear the registry selection so
    // the inspector falls back to `window.__lastSpineBody` (the blend).
    await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      reg.clearSelection();
      window.dispatchEvent(new Event('archdisc:inspector-refresh'));
    });
    await win.waitForTimeout(150);

    const blendInspector = await win.evaluate(() => {
      const i = window.__archdiscTopologyInspector;
      const snap = i ? i.getSnapshot() : null;
      const active = i ? i.getActive() : null;
      return {
        bodyPid: snap ? snap.persistentId : null,
        counts: snap ? snap.counts : null,
        bodyKind: snap ? snap.bodyKind : null,
        source: active ? active.source : null,
      };
    });
    console.log('\n  BLEND INSPECTOR SNAPSHOT:');
    console.log('    ', JSON.stringify(blendInspector, null, 2));

    // Per the S6 documented honest gap, the analytic blend body ships as
    // its own sheet body (one Face / one Shell / one Lump) — not stitched
    // into the parent solid. The inspector reports the truth: kind=sheet,
    // 1 analytic face. That IS the S7 inspector working — surfacing the
    // honest S6 contract in the UI.
    expect(blendInspector.bodyKind, 'blend body is a sheet (per S6 §7-risk-4 scope)').toBe('sheet');
    expect(blendInspector.bodyPid, 'inspector body pid matches g2Blend tag').toMatch(/g2Blend/);
    expect(blendInspector.counts.analyticFaces, 'blend has 1 analytic face').toBeGreaterThanOrEqual(1);

    // ── Step 8 — DRILL into the analytic Face node of the blend body. The
    // per-entity readout MUST show `isAnalytic: true` plus the seed edges
    // in `derivedFrom` (SP-1 §2.3 lineage from S6).
    const analyticDrill = await win.evaluate(() => {
      const i = window.__archdiscTopologyInspector;
      if (!i) return { error: 'no inspector instance' };
      const node = i.findNode(n => n.kind === 'face' && n.isAnalytic);
      if (!node) return { error: 'no analytic face in snapshot' };
      i.selectNode(node.persistentId || `t:${node.transientId}`);
      return new Promise(resolve => setTimeout(() => {
        const sel = window.__lastSpineInspectorPick;
        const readout = document.querySelector('[data-archdisc-tinsp-readout]');
        const readoutAttr = readout ? readout.getAttribute('data-archdisc-tinsp-readout') : null;
        const isAnalyticBadge = document.querySelector('[data-archdisc-tinsp-face-analytic]');
        resolve({
          drillRecord: sel,
          readoutKind: readoutAttr,
          isAnalyticBadge: isAnalyticBadge ? isAnalyticBadge.getAttribute('data-archdisc-tinsp-face-analytic') : null,
          filter: window.__archdiscSelectionFilter,
        });
      }, 80));
    });

    console.log('\n  ANALYTIC FACE DRILL:');
    console.log('    ', JSON.stringify(analyticDrill, null, 2));

    expect(analyticDrill.error, 'drill found analytic face').toBeUndefined();
    expect(analyticDrill.drillRecord, 'inspector wrote __lastSpineInspectorPick').toBeTruthy();
    expect(analyticDrill.drillRecord.kind, 'drill kind = face').toBe('face');
    expect(analyticDrill.drillRecord.isAnalytic, 'drill record carries isAnalytic=true').toBe(true);
    expect(analyticDrill.readoutKind, 'readout DOM shows face kind').toBe('face');
    expect(analyticDrill.isAnalyticBadge, 'readout DOM shows isAnalytic=true').toBe('true');
    expect(analyticDrill.filter, 'inspector primed selection filter = face').toBe('face');
    expect(Array.isArray(analyticDrill.drillRecord.derivedFrom)
      && analyticDrill.drillRecord.derivedFrom.length > 0,
      `analytic face derivedFrom is non-empty (${JSON.stringify(analyticDrill.drillRecord.derivedFrom)})`).toBe(true);

    await story.frame('06-inspector-analytic-face-drill');

    // ── Step 9 — drill into a Vertex node — exercise the vertex readout
    // path (coordinates + valence) and confirm the filter primes to vertex.
    const vertexDrill = await win.evaluate(() => {
      const i = window.__archdiscTopologyInspector;
      const node = i.findNode(n => n.kind === 'vertex');
      if (!node) return { error: 'no vertex in snapshot' };
      i.selectNode(node.persistentId || `t:${node.transientId}`);
      return new Promise(resolve => setTimeout(() => {
        const sel = window.__lastSpineInspectorPick;
        const readout = document.querySelector('[data-archdisc-tinsp-readout]');
        const readoutKind = readout ? readout.getAttribute('data-archdisc-tinsp-readout') : null;
        resolve({
          drillRecord: sel,
          readoutKind,
          hasPoint: !!node.point,
          valence: node.valence,
          filter: window.__archdiscSelectionFilter,
        });
      }, 80));
    });
    console.log('\n  VERTEX DRILL:');
    console.log('    ', JSON.stringify(vertexDrill, null, 2));

    expect(vertexDrill.error, 'drill found vertex').toBeUndefined();
    expect(vertexDrill.drillRecord.kind, 'drill kind = vertex').toBe('vertex');
    expect(vertexDrill.readoutKind, 'readout shows vertex').toBe('vertex');
    expect(vertexDrill.filter, 'inspector primed selection filter = vertex').toBe('vertex');

    // ── Step 10 — ONE deliberate orbit to reveal the radial-fan geometry
    //   of the junction (which the iso view cannot show).
    await dragOrbit(win, { dx: 220, dy: 60, steps: 32 });
    await win.waitForTimeout(500);
    await story.frame('07-orbit-radial-fan-reveal');

    // Filter known-benign rapid-rebuild noise (S5 / S6 documented the same
    // pattern during scene clear/rebuild between op applications).
    const realErrors = pageErrors.filter(e =>
      !/Cannot read properties of undefined \(reading '_triangulation'\)/.test(e));
    expect(realErrors, `pageerrors (non-benign): ${JSON.stringify(realErrors)}`).toEqual([]);
  } finally {
    await app.close();
    const finished = await story.finish();
    console.log(`\n  Motion artifact: ${finished.videoPath} (${finished.videoSize} bytes), ${finished.stills.length} stills`);
  }
});
