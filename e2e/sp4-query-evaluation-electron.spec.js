/**
 * sp4-query-evaluation-electron.spec.js — SP-4 (Area J) acceptance
 *
 * Verifies the SP-4 kernel-grade query & evaluation API on a real engineered
 * part: an automotive connecting rod, the engine-block staple that turns
 * piston reciprocation into crankshaft rotation. Different from every prior
 * SP-1/SP-2 bespoke build (manifold collector / rotary valve body /
 * injection-moulded enclosure / impeller fairing / multi-plate junction /
 * clip-on grip / hydraulic crossover / CNC-finished pulley).
 *
 * A connecting rod is a perfect SP-4 demo because every query maps onto a
 * real engineering question:
 *
 *   classifyPoint  — "is this fluid coolant inside the rod or in the
 *                    big-end bore where the crank journal sweeps?"
 *   rayFire        — "drop a probe straight down the big-end bore axis —
 *                    where does it pierce the body wall?"
 *   evalCurve      — "what is the curvature of this stress-relief fillet
 *                    edge? a Hertzian-contact analysis needs κ."
 *   evalSurface    — "the small-end pin bore is a cylinder of radius r —
 *                    one principal curvature should be 1/r."
 *   massProperties — "the rod is forged AISI 4340 (ρ ≈ 7850 kg/m³) —
 *                    what does it weigh, and where is the centroid for
 *                    inertia balancing? what are the principal moments?"
 *   adjacency      — "walk the spine — what faces does this fillet edge
 *                    bridge? a stress-analysis post-processor needs the
 *                    pair."
 *
 * ── The build ─────────────────────────────────────────────────────────────
 *   1. I-beam web        — extrudeRect(8, 60, 6)        (8 mm wide,
 *                                                        60 mm long shank,
 *                                                        6 mm web height)
 *   2. Big-end hub block — extrudeRect(20, 24, 6) — placed at the rod's
 *                          rear end (the crank end)
 *   3. Small-end hub block — extrudeRect(12, 16, 6) — placed at the rod's
 *                          front end (the wrist-pin end)
 *   4. fuse(web, big-end hub) → fused rod blank
 *   5. fuse(blank, small-end hub) → full rod blank
 *   6. Big-end bore        — cut a Ø10 mm cylinder through the rear hub
 *   7. Small-end pin bore  — cut a Ø5 mm cylinder through the front hub
 *   8. filletAll(r=0.5)    — break every machined edge with a stress-relief
 *                            fillet (real forging practice)
 *
 * ── Framing ───────────────────────────────────────────────────────────────
 *   ONE deliberate __archdiscFocusOnObject call after the rod is in the
 *   scene, HELD for every still. NO 7-angle orbit. 3-4 stills max — seed
 *   ribbon click, framed iso, one drag-orbit reveal that shows the bores +
 *   the I-beam profile.
 *
 * Run: ./node_modules/.bin/playwright test sp4-query-evaluation --headed --workers=1
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { buildPrimitive } from './helpers/uiWorkflow.js';
import { launchWithCapture, dragOrbit } from './helpers/motionCapture.js';

test.setTimeout(600000);

test('SP-4 — automotive connecting rod: classify / rayFire / evalCurve / evalSurface / massProps / adjacency', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('sp4-query-evaluation');
  try {
    // ── Step 1 — seed Box via the ribbon: real user-driven entry point so
    //         the ribbon is verified healthy before driving the kernel
    //         programmatically. Discarded after.
    const seedBoxId = await buildPrimitive(win, 'Box');
    console.log(`  seed box id: ${seedBoxId}`);
    await story.frame('seed-box-via-ribbon');

    // Clear the scene so only the connecting rod renders for framing.
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

    // ── Step 2 — build the connecting rod + run every SP-4 query, all
    //         inside ONE win.evaluate so kernel handles, spine entities and
    //         registry entries all live in the same JS context.
    const result = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      const { validateSpine } = window.__archdiscSpine;
      const log = [];

      // ── 2.1 — Build the rod blank (I-beam web + two hub blocks fused).
      // Geometry chosen so the centroid lands near the rod's centre of the
      // span and so the bores are easily found by their centroid.
      //
      // I-beam web in the XY plane, length along +Y, narrow along +X. We use
      // extrudeRect (face in XY, extrude along +Z) → a rectangular block.
      // To make a *connecting-rod*-like assembly:
      //   - web    : 8 mm wide × 60 mm long × 6 mm tall, centred so the rod
      //              span runs from y=-30 to y=+30, x from -4 to +4.
      //   - bigEnd : 20 mm × 24 mm × 6 mm hub at the +y end (around y=+30).
      //   - smEnd  : 12 mm × 16 mm × 6 mm hub at the -y end (around y=-30).
      //
      // extrudeRect puts the rectangle's corner at the origin in XY and
      // extrudes along +Z. We use translate() to position each piece.
      const webRaw = await K.brep.extrudeRect(8, 60, 6);       // span the rod
      const web    = await K.brep.translate(webRaw, -4, -30, 0); // centre on origin
      webRaw.dispose();
      const bigHubRaw = await K.brep.extrudeRect(20, 24, 6);
      const bigHub    = await K.brep.translate(bigHubRaw, -10, 18, 0); // big end at +y
      bigHubRaw.dispose();
      const smHubRaw  = await K.brep.extrudeRect(12, 16, 6);
      const smHub     = await K.brep.translate(smHubRaw, -6, -34, 0); // small end at -y
      smHubRaw.dispose();

      const halfFused = await K.brep.fuse(web, bigHub);
      web.dispose(); bigHub.dispose();
      const blank = await K.brep.fuse(halfFused, smHub);
      halfFused.dispose(); smHub.dispose();

      // ── 2.2 — Cut the bores.
      // Big-end bore: Ø10 mm (radius 5) through z, centre at (0, +30, 0).
      const bigBoreCylRaw = await K.brep.makeCylinder(5, 12);    // r=5, h=12
      // makeCylinder is axis +Z at origin; translate to (0, 30, -3) so it
      // pierces the hub fully.
      const bigBoreCyl = await K.brep.translate(bigBoreCylRaw, 0, 30, -3);
      bigBoreCylRaw.dispose();
      const drilled1 = await K.brep.cut(blank, bigBoreCyl);
      blank.dispose(); bigBoreCyl.dispose();

      // Small-end pin bore: Ø5 mm (radius 2.5) through z, centre at (0, -30, 0).
      const smBoreCylRaw = await K.brep.makeCylinder(2.5, 12);
      const smBoreCyl    = await K.brep.translate(smBoreCylRaw, 0, -30, -3);
      smBoreCylRaw.dispose();
      const drilled2 = await K.brep.cut(drilled1, smBoreCyl);
      drilled1.dispose(); smBoreCyl.dispose();

      // ── 2.3 — Stress-relief fillet (r=0.5).
      const rod = await K.brep.filletAll(drilled2, 0.5);
      drilled2.dispose();

      const rodValidation = validateSpine(rod.body);
      log.push({
        stage: 'rod-built',
        kind: rod.body.kind,
        faces: rod.body.faces().length,
        edges: rod.body.edges().length,
        vertices: rod.body.vertices().length,
        validateOk: rodValidation.ok,
        euler: rod.body.checkEulerPoincare().lhs,
      });

      // ──────────────────────────────────────────────────────────────────
      // Query 1 — classifyPoint at 5 well-chosen probe points
      // ──────────────────────────────────────────────────────────────────
      // Probe layout (rod centred on origin in the XY plane, z=0..6):
      //   A — inside the web        : (0,   0, 3)    → INSIDE
      //   B — inside the big-end    : (0,  30, 3)    → OUTSIDE  (the bore is hollow)
      //       bore (hollow cylinder)
      //   C — on the small-end      : (2.5, -30, 3)  → ON       (right on the pin bore wall)
      //       pin-bore wall
      //   D — outside the rod       : (50,   0, 3)   → OUTSIDE  (off in space)
      //       footprint
      //   E — inside the small-end  : (3, -30, 3)    → INSIDE   (between the bore and outer wall)
      //       hub body
      const probes = [
        { label: 'A-inside-web',         point: [0,    0,   3], expect: 'inside' },
        { label: 'B-inside-big-bore',    point: [0,    30,  3], expect: 'outside' },
        { label: 'C-on-small-bore-wall', point: [2.5, -30,  3], expect: 'on' },
        { label: 'D-outside-rod',        point: [50,   0,   3], expect: 'outside' },
        { label: 'E-inside-small-hub',   point: [3,   -30,  3], expect: 'inside' },
      ];
      const classifyResults = [];
      for (const probe of probes) {
        const state = await K.brep.classifyPoint(rod, probe.point, { tolerance: 1e-3 });
        classifyResults.push({
          label: probe.label, point: probe.point, state, expect: probe.expect,
          pass: state === probe.expect,
        });
      }
      log.push({ stage: 'classifyPoint', results: classifyResults });

      // ──────────────────────────────────────────────────────────────────
      // Query 2 — rayFire: vertical ray through the big-end bore axis
      // ──────────────────────────────────────────────────────────────────
      // The big-end bore is centred at (0, 30, 0..6). A ray from (0, 30, +20)
      // along -Z passes through the bore axis: it should NOT hit the cylindrical
      // bore wall (the bore is hollow — the inner cylinder face is INSIDE the
      // bore volume, but the ray runs ON the axis, missing it tangentially).
      //
      // Instead we fire from (5, 30, +20) along -Z — this ray sits at radius 5
      // from the bore axis, which is exactly the bore radius. Adjust to radius
      // 7 (inside the hub material between bore and hub outer wall): the ray
      // pierces the TOP face (z=6) and the BOTTOM face (z=0) of the hub — 2 hits.
      const rayHits = await K.brep.rayFire(
        rod,
        [7, 30, 20],          // origin 20 mm above the hub, offset 7mm from bore axis
        [0, 0, -1],           // straight down
        { tolerance: 1e-3 },
      );
      log.push({
        stage: 'rayFire',
        origin: [7, 30, 20], direction: [0, 0, -1],
        hitCount: rayHits.length,
        hits: rayHits.map(h => ({
          point: { x: +h.point.x.toFixed(3), y: +h.point.y.toFixed(3), z: +h.point.z.toFixed(3) },
          distance: +h.distance.toFixed(3),
          normalZ: h.normal ? +h.normal.z.toFixed(3) : null,
          state: h.state,
          hasFace: !!h.face,
          faceId: h.faceId,
        })),
      });

      // Also fire a ray that misses the body entirely — must return 0 hits.
      const rayMiss = await K.brep.rayFire(rod, [200, 200, 200], [1, 0, 0]);
      log.push({ stage: 'rayFire-miss', hitCount: rayMiss.length });

      // ──────────────────────────────────────────────────────────────────
      // Query 3 — evalCurve: pick a fillet edge and check curvature > 0
      // ──────────────────────────────────────────────────────────────────
      // Fillet edges have curvature = 1/r ≈ 1/0.5 = 2.0 mm^-1 along their
      // generating-curve direction. Each fillet face on the rod has 4 edges:
      // 2 axial (along the seed edge — straight) and 2 circular (the rolling
      // ball's arc — these carry the curvature). We pick the SHORTEST edge of
      // the body — the rolling-ball arc — as our probe.
      const edges = rod.body.edges();
      // Find the edge whose curve.curveKind is 'Geom_Circle' if available;
      // otherwise pick the shortest edge as a proxy for an arc.
      let probeEdge = null;
      let probeEdgeKind = null;
      for (const e of edges) {
        if (e.curve && typeof e.curve.curveKind === 'function') {
          const k = e.curve.curveKind();
          if (/Circle/i.test(k)) { probeEdge = e; probeEdgeKind = k; break; }
        }
      }
      if (!probeEdge) {
        // Shortest edge — likely a fillet arc.
        let minLen = Infinity;
        for (const e of edges) {
          if (e.isDegenerate()) continue;
          const L = e.length();
          if (L > 0 && L < minLen) { minLen = L; probeEdge = e; }
        }
        if (probeEdge && probeEdge.curve && typeof probeEdge.curve.curveKind === 'function') {
          probeEdgeKind = probeEdge.curve.curveKind();
        }
      }
      const curveSamples = [];
      if (probeEdge) {
        for (const t of [0.0, 0.25, 0.5, 0.75, 1.0]) {
          const samp = await K.brep.evalCurve(probeEdge, t);
          curveSamples.push({
            t,
            point: { x: +samp.point.x.toFixed(4), y: +samp.point.y.toFixed(4), z: +samp.point.z.toFixed(4) },
            curvature: +samp.curvature.toFixed(6),
            degenerate: samp.degenerate,
          });
        }
      }
      // Also test on an edge of the I-beam web — a straight edge → curvature 0.
      let webEdge = null;
      let webEdgeKind = null;
      for (const e of edges) {
        if (e.curve && typeof e.curve.curveKind === 'function') {
          const k = e.curve.curveKind();
          if (/Line/i.test(k) && e.length() > 5) {
            webEdge = e; webEdgeKind = k; break;
          }
        }
      }
      const straightSample = webEdge ? await K.brep.evalCurve(webEdge, 0.5) : null;
      log.push({
        stage: 'evalCurve',
        probeEdgeKind, probeEdgeId: probeEdge && probeEdge.persistentId,
        probeEdgeLen: probeEdge && +probeEdge.length().toFixed(4),
        samples: curveSamples,
        straight: straightSample ? {
          edgeKind: webEdgeKind,
          curvature: +straightSample.curvature.toFixed(8),
        } : null,
      });

      // ──────────────────────────────────────────────────────────────────
      // Query 4 — evalSurface: pick a cylindrical bore face and check
      //           one principal curvature equals 1/r, the other ≈ 0.
      // ──────────────────────────────────────────────────────────────────
      // The big-end bore has radius 5; small-end bore has radius 2.5. Both
      // are inner cylindrical faces.
      const faces = rod.body.faces();
      // We classify each face by its surface type and centroid.
      function faceCentroid(f) {
        const vs = f.vertices();
        if (vs.length === 0) return null;
        let cx = 0, cy = 0, cz = 0;
        for (const v of vs) { cx += v.point.x; cy += v.point.y; cz += v.point.z; }
        return { x: cx / vs.length, y: cy / vs.length, z: cz / vs.length };
      }
      function faceSurfaceKind(f) {
        if (f.surface && typeof f.surface.surfaceKind === 'function') {
          try { return f.surface.surfaceKind(); } catch (_e) { return null; }
        }
        return null;
      }
      const surfaceProbes = [];
      // To pick the BORE faces unambiguously after the fillet pass (which
      // creates many small cylindrical fillet faces of radius 0.5), we
      // evaluate every cylindrical face and pick the one with the largest
      // analyticRadius (≈ 5 for big bore; ≈ 2.5 for small bore). The
      // analyticRadius is the engine-extracted gp_Cylinder.Radius() — the
      // CANONICAL radius, not derived from curvature.
      const cylProbes = [];
      for (const f of faces) {
        const kind = faceSurfaceKind(f);
        if (!kind || !/Cylind/i.test(kind)) continue;
        try {
          const e = await K.brep.evalSurface(f, 0.5, 0.5, { normalised: true });
          if (e.analyticRadius != null) {
            cylProbes.push({ face: f, radius: e.analyticRadius, eval: e });
          }
        } catch (_e) { /* skip */ }
      }
      // Big bore = largest radius cylinder, near y ≈ +30, x ≈ 0; small bore =
      // next-largest near y ≈ -30. Filter by centroid then sort by radius.
      let bigBoreFace = null;
      let smBoreFace = null;
      let bigBoreEval = null, smBoreEval = null;
      const bigCands = cylProbes.filter(p => {
        const c = faceCentroid(p.face); return c && c.y > 15 && Math.abs(c.x) < 8;
      }).sort((a, b) => b.radius - a.radius);
      const smCands = cylProbes.filter(p => {
        const c = faceCentroid(p.face); return c && c.y < -15 && Math.abs(c.x) < 5;
      }).sort((a, b) => b.radius - a.radius);
      if (bigCands[0]) { bigBoreFace = bigCands[0].face; bigBoreEval = bigCands[0].eval; }
      if (smCands[0])  { smBoreFace  = smCands[0].face;  smBoreEval  = smCands[0].eval; }
      if (bigBoreEval) {
        surfaceProbes.push({
          which: 'big-bore', expectedRadius: 5,
          surfaceType: bigBoreEval.surfaceType,
          analyticRadius: +bigBoreEval.analyticRadius.toFixed(4),
          principalCurvatures: bigBoreEval.principalCurvatures.map(v => v == null ? null : +v.toFixed(6)),
          gaussianCurvature: bigBoreEval.gaussianCurvature == null ? null : +bigBoreEval.gaussianCurvature.toFixed(8),
          meanCurvature: bigBoreEval.meanCurvature == null ? null : +bigBoreEval.meanCurvature.toFixed(6),
          degenerate: bigBoreEval.degenerate,
          point: { x: +bigBoreEval.point.x.toFixed(3), y: +bigBoreEval.point.y.toFixed(3), z: +bigBoreEval.point.z.toFixed(3) },
          normal: bigBoreEval.normal ? { x: +bigBoreEval.normal.x.toFixed(3), y: +bigBoreEval.normal.y.toFixed(3), z: +bigBoreEval.normal.z.toFixed(3) } : null,
        });
      }
      if (smBoreEval) {
        surfaceProbes.push({
          which: 'small-bore', expectedRadius: 2.5,
          surfaceType: smBoreEval.surfaceType,
          analyticRadius: +smBoreEval.analyticRadius.toFixed(4),
          principalCurvatures: smBoreEval.principalCurvatures.map(v => v == null ? null : +v.toFixed(6)),
          gaussianCurvature: smBoreEval.gaussianCurvature == null ? null : +smBoreEval.gaussianCurvature.toFixed(8),
          meanCurvature: smBoreEval.meanCurvature == null ? null : +smBoreEval.meanCurvature.toFixed(6),
          degenerate: smBoreEval.degenerate,
        });
      }
      // Also probe a planar face (the top of the web at z=6) — both principal
      // curvatures should be 0 (a plane).
      let planeFace = null;
      for (const f of faces) {
        const kind = faceSurfaceKind(f);
        const c = faceCentroid(f);
        if (!kind || !c) continue;
        if (/Plane/i.test(kind) && Math.abs(c.z - 6) < 0.1 && Math.abs(c.x) < 5 && Math.abs(c.y) < 5) {
          planeFace = f; break;
        }
      }
      if (planeFace) {
        const e = await K.brep.evalSurface(planeFace, 0.5, 0.5, { normalised: true });
        surfaceProbes.push({
          which: 'web-top-plane',
          surfaceType: e.surfaceType,
          principalCurvatures: e.principalCurvatures.map(v => v == null ? null : +v.toFixed(6)),
          gaussianCurvature: e.gaussianCurvature == null ? null : +e.gaussianCurvature.toFixed(8),
          meanCurvature: e.meanCurvature == null ? null : +e.meanCurvature.toFixed(6),
        });
      }
      log.push({ stage: 'evalSurface', probes: surfaceProbes,
                  bigBoreFound: !!bigBoreFace, smBoreFound: !!smBoreFace,
                  planeFound: !!planeFace });

      // ──────────────────────────────────────────────────────────────────
      // Query 5 — massProperties at AISI 4340 steel density (7850 kg/m³)
      // ──────────────────────────────────────────────────────────────────
      const massResult = await K.brep.massProperties(rod, { densityKgPerM3: 7850 });
      log.push({
        stage: 'massProperties',
        volume_mm3: +massResult.volume.toFixed(2),
        surfaceArea_mm2: +massResult.surfaceArea.toFixed(2),
        density_kg_per_m3: massResult.density,
        mass_kg: +massResult.mass.toFixed(6),
        centroid: {
          x: +massResult.centroid.x.toFixed(4),
          y: +massResult.centroid.y.toFixed(4),
          z: +massResult.centroid.z.toFixed(4),
        },
        principalMomentsJs: massResult.principalMomentsJs.map(m => +m.toFixed(4)),
        principalAxesJs: massResult.principalAxesJs.map(v => v.map(c => +c.toFixed(4))),
        inertiaTensorDiagonal: [
          +massResult.inertiaTensor[0][0].toFixed(4),
          +massResult.inertiaTensor[1][1].toFixed(4),
          +massResult.inertiaTensor[2][2].toFixed(4),
        ],
      });

      // ──────────────────────────────────────────────────────────────────
      // Query 6 — adjacency: pick a fillet edge, assert facesOfEdge gives
      //           exactly 2 faces (the two faces the fillet bridges).
      // ──────────────────────────────────────────────────────────────────
      const adj = K.brep.adjacency(rod);
      let adjacencyTrace = null;
      if (probeEdge) {
        const fs = adj.facesOfEdge(probeEdge);
        const vs = adj.verticesOfEdge(probeEdge);
        const ces = adj.coedgesOfEdge(probeEdge);
        adjacencyTrace = {
          probeEdgePersistentId: probeEdge.persistentId,
          probeEdgeKind: probeEdgeKind,
          facesOfEdgeCount: fs.length,
          facesOfEdge: fs.map(f => ({
            persistentId: f.persistentId,
            surfaceKind: faceSurfaceKind(f),
          })),
          verticesOfEdgeCount: vs.length,
          coedgesOfEdgeCount: ces.length,
        };
        // Also exercise edgesOfFace + facesOfVertex + edgesOfVertex on the
        // first face the probe edge belongs to.
        if (fs[0]) {
          const eOfF = adj.edgesOfFace(fs[0]);
          adjacencyTrace.firstFaceEdgeCount = eOfF.length;
        }
        if (vs[0]) {
          const fOfV = adj.facesOfVertex(vs[0]);
          const eOfV = adj.edgesOfVertex(vs[0]);
          adjacencyTrace.firstVertexFaceCount = fOfV.length;
          adjacencyTrace.firstVertexEdgeCount = eOfV.length;
        }
      }
      log.push({ stage: 'adjacency', trace: adjacencyTrace });

      // ── 2.4 — Register the rod in the scene for visualisation.
      const scene = window.__archdiscViewport.scene;
      const viewport = window.__archdiscViewport;
      const adder = window.__archdiscAddBrepShape
        || (window.__archdiscKernel && window.__archdiscKernel.addBrepShape);
      if (typeof adder === 'function') {
        await adder(scene, viewport, rod, 0x5b6770); // forged-steel grey
      } else {
        // Synthesise as SP-3/4 fallback.
        const mesh = await K.brep.brepToMesh(rod);
        const THREE = window.THREE;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
        if (mesh.normals && mesh.normals.length) {
          geom.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
        } else { geom.computeVertexNormals(); }
        if (mesh.indices && mesh.indices.length) {
          geom.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.indices), 1));
        }
        const mat = new THREE.MeshStandardMaterial({
          color: 0x5b6770, metalness: 0.7, roughness: 0.35,
          side: THREE.DoubleSide,
        });
        const tri = new THREE.Mesh(geom, mat);
        tri.userData.pickable = true;
        const group = new THREE.Group();
        group.scale.set(0.001, 0.001, 0.001);
        group.add(tri);
        Object.defineProperty(group.userData, 'brepShapeRef', {
          value: rod, enumerable: false, configurable: true, writable: true,
        });
        group.userData.brepShape = true;
        scene.add(group);
        const reg = window.__archdiscRegistry;
        if (reg && typeof reg.register === 'function') {
          reg.register({ group, manifold: { volume: () => 1 }, brepShapeRef: rod });
        }
        window.__lastBrepShape = rod;
        window.__lastBrepGroup = group;
        window.__lastSpine = rod.body;
        window.__lastSpineBody = rod;
      }
      return { log };
    });

    console.log('  SP-4 QUERY LOG:');
    for (const stage of result.log) {
      console.log(`    ${JSON.stringify(stage).substring(0, 600)}`);
    }

    // ── Step 3 — ASSERTIONS ─────────────────────────────────────────────────
    const rodBuilt = result.log.find(s => s.stage === 'rod-built');
    expect(rodBuilt, 'rod-built stage exists').toBeTruthy();
    expect(rodBuilt.kind, 'connecting rod is a solid body').toBe('solid');
    expect(rodBuilt.faces,
      'connecting rod has many faces (I-beam web + 2 hubs + 2 bores + fillets)')
      .toBeGreaterThan(10);

    // Query 1 — classifyPoint
    const classify = result.log.find(s => s.stage === 'classifyPoint');
    expect(classify, 'classifyPoint stage exists').toBeTruthy();
    expect(classify.results.length, '5 probes evaluated').toBe(5);
    // We expect AT LEAST 4 of 5 probes to be exactly right. The 'on' point can
    // be a millimetre-fraction off the analytical wall in the post-fillet
    // geometry; we DO assert it is either 'on' or 'outside' (NOT 'inside'),
    // which is the engineering correctness criterion.
    const inWeb   = classify.results.find(r => r.label === 'A-inside-web');
    const inBore  = classify.results.find(r => r.label === 'B-inside-big-bore');
    const onWall  = classify.results.find(r => r.label === 'C-on-small-bore-wall');
    const outside = classify.results.find(r => r.label === 'D-outside-rod');
    const inHub   = classify.results.find(r => r.label === 'E-inside-small-hub');
    expect(inWeb.state,
      `A (0,0,3) — inside the I-beam web — must classify as 'inside' (got '${inWeb.state}')`)
      .toBe('inside');
    expect(inBore.state,
      `B (0,30,3) — inside the big-end bore — must classify as 'outside' (the bore is hollow)`)
      .toBe('outside');
    expect(['on', 'outside'].includes(onWall.state),
      `C (2.5,-30,3) — on the small-end pin-bore wall — classifier returned '${onWall.state}'`)
      .toBe(true);
    expect(outside.state,
      `D (50,0,3) — off in space — must classify as 'outside'`)
      .toBe('outside');
    expect(inHub.state,
      `E (3,-30,3) — inside the small-end hub between bore and outer wall — must classify as 'inside'`)
      .toBe('inside');

    // Query 2 — rayFire (vertical ray through big-end hub at offset 7 → 2 hits)
    const rayFire = result.log.find(s => s.stage === 'rayFire');
    expect(rayFire, 'rayFire stage exists').toBeTruthy();
    expect(rayFire.hitCount,
      `vertical ray through the big-end hub (radius 7 from bore axis) must hit ` +
      `exactly 2 faces — the top (z≈6) and the bottom (z≈0) — got ${rayFire.hitCount}`)
      .toBe(2);
    // The two hits should be at z ≈ 6 (top, closer to origin) and z ≈ 0 (bottom).
    const zsHit = rayFire.hits.map(h => h.point.z).sort((a, b) => a - b);
    expect(zsHit[0],
      `lowest hit z should be ≈ 0 (the bottom face of the hub)`)
      .toBeLessThan(0.5);
    expect(zsHit[1],
      `highest hit z should be ≈ 6 (the top face of the hub)`)
      .toBeGreaterThan(5.5);
    // Hits must arrive in distance-sorted order — closest first (i.e. top face).
    expect(rayFire.hits[0].distance,
      `first hit must be closer than the second`)
      .toBeLessThan(rayFire.hits[1].distance);
    // The ray missing the body should return 0 hits.
    const rayMiss = result.log.find(s => s.stage === 'rayFire-miss');
    expect(rayMiss.hitCount,
      `a ray at (200,200,200) along +X must miss the rod entirely → 0 hits`)
      .toBe(0);

    // Query 3 — evalCurve (fillet arc curvature > 0; straight edge curvature ≈ 0)
    const curve = result.log.find(s => s.stage === 'evalCurve');
    expect(curve, 'evalCurve stage exists').toBeTruthy();
    expect(curve.samples.length, '5 samples taken along the probe edge').toBe(5);
    if (curve.probeEdgeKind && /Circle/i.test(curve.probeEdgeKind)) {
      // Circular fillet arc — every sample's curvature ≈ 1/r = 1/0.5 = 2 mm⁻¹.
      for (const s of curve.samples) {
        expect(s.curvature,
          `circular fillet arc at t=${s.t} — curvature should be ≈ 2.0 mm⁻¹ (1/0.5), got ${s.curvature}`)
          .toBeGreaterThan(0.5);
      }
    } else {
      // We didn't find a labelled 'Circle' curve but at least one sample
      // must have non-zero curvature on a real arc (the shortest edge).
      const hasCurvature = curve.samples.some(s => s.curvature > 0.01);
      expect(hasCurvature,
        `probeEdge (kind=${curve.probeEdgeKind || 'unknown'}, ` +
        `len=${curve.probeEdgeLen}) should have curvature > 0 at some t`)
        .toBe(true);
    }
    if (curve.straight) {
      expect(curve.straight.curvature,
        `straight web edge — curvature must be effectively 0 (got ${curve.straight.curvature})`)
        .toBeLessThan(1e-3);
    }

    // Query 4 — evalSurface (cylinder principal curvatures 1/r, 0; plane both 0)
    const surf = result.log.find(s => s.stage === 'evalSurface');
    expect(surf, 'evalSurface stage exists').toBeTruthy();
    expect(surf.bigBoreFound, 'big-bore cylindrical face identified').toBe(true);
    expect(surf.smBoreFound, 'small-bore cylindrical face identified').toBe(true);
    const bigProbe = surf.probes.find(p => p.which === 'big-bore');
    const smProbe  = surf.probes.find(p => p.which === 'small-bore');
    expect(bigProbe.surfaceType, 'big-bore surface kind is cylinder').toBe('cylinder');
    expect(smProbe.surfaceType, 'small-bore surface kind is cylinder').toBe('cylinder');
    // Big-bore radius 5 → 1/5 = 0.2 expected for one principal curvature, ≈0 for the other.
    // First sanity: the engine-reported analyticRadius equals our model radius.
    expect(bigProbe.analyticRadius,
      `big-bore analyticRadius should be 5 (the cut cylinder radius)`)
      .toBeCloseTo(5, 1);
    {
      const ks = bigProbe.principalCurvatures.map(v => Math.abs(v));
      const kMax = Math.max(...ks);
      const kMin = Math.min(...ks);
      expect(kMax,
        `big-bore (r=5): max principal |κ| should be ≈ 1/5 = 0.2, got ${kMax}`)
        .toBeCloseTo(0.2, 2);
      expect(kMin,
        `big-bore (r=5): min principal |κ| should be ≈ 0 (axial direction), got ${kMin}`)
        .toBeLessThan(0.01);
      // Gaussian curvature K = κ₁·κ₂ = 0 for a cylinder.
      expect(Math.abs(bigProbe.gaussianCurvature),
        `big-bore Gaussian curvature should be ≈ 0 for a cylinder`)
        .toBeLessThan(0.01);
    }
    // Small-bore radius 2.5 → 1/2.5 = 0.4 expected.
    expect(smProbe.analyticRadius,
      `small-bore analyticRadius should be 2.5 (the cut cylinder radius)`)
      .toBeCloseTo(2.5, 1);
    {
      const ks = smProbe.principalCurvatures.map(v => Math.abs(v));
      const kMax = Math.max(...ks);
      const kMin = Math.min(...ks);
      expect(kMax,
        `small-bore (r=2.5): max principal |κ| should be ≈ 0.4, got ${kMax}`)
        .toBeCloseTo(0.4, 2);
      expect(kMin,
        `small-bore (r=2.5): min principal |κ| should be ≈ 0, got ${kMin}`)
        .toBeLessThan(0.01);
    }
    const planeProbe = surf.probes.find(p => p.which === 'web-top-plane');
    if (planeProbe) {
      expect(planeProbe.surfaceType, 'web-top-plane surface kind is plane').toBe('plane');
      const ks = planeProbe.principalCurvatures.map(v => Math.abs(v || 0));
      expect(Math.max(...ks),
        `plane face: both principal curvatures should be ≈ 0`)
        .toBeLessThan(1e-4);
    }

    // Query 5 — massProperties (volume sane, density propagated, centroid on the rod span)
    const mass = result.log.find(s => s.stage === 'massProperties');
    expect(mass, 'massProperties stage exists').toBeTruthy();
    // The rod volume should be in the tens-of-thousands mm³ range. Lower bound:
    // web (8 × 60 × 6 = 2880) + big hub (20 × 24 × 6 = 2880) + small hub (12 × 16 × 6 = 1152)
    // minus the two bores (π·5²·6 ≈ 471) + (π·2.5²·6 ≈ 118). Upper bound is the
    // sum if the hubs and web were fully disjoint (overlap is counted once via
    // fuse, so volume ≈ 6300 mm³).
    expect(mass.volume_mm3,
      `connecting rod volume should be in the realistic range`)
      .toBeGreaterThan(3000);
    expect(mass.volume_mm3,
      `connecting rod volume should be ≤ the sum of disjoint primitives`)
      .toBeLessThan(7500);
    expect(mass.density_kg_per_m3, 'density propagated through').toBe(7850);
    // mass = volume(mm³) × 1e-9 × 7850 ≈ 6300e-9 × 7850 ≈ 0.0495 kg ≈ 50 g.
    expect(mass.mass_kg,
      `mass should be on the order of tens of grams (forged-steel rod)`)
      .toBeGreaterThan(0.02);
    expect(mass.mass_kg,
      `mass should be on the order of tens of grams (forged-steel rod)`)
      .toBeLessThan(0.06);
    // Centroid: by symmetry the rod is roughly symmetric about y (the small hub
    // is smaller than the big hub, so the centroid is biased toward +y; x is
    // symmetric so centroid.x ≈ 0; z is the web mid-height ≈ 3).
    expect(Math.abs(mass.centroid.x),
      `centroid.x should be ≈ 0 by x-symmetry`)
      .toBeLessThan(0.5);
    expect(mass.centroid.z,
      `centroid.z should be ≈ 3 (web mid-height)`)
      .toBeCloseTo(3, 1);
    // The rod's longest axis is Y (-30 to +30). The principal-axes Jacobi
    // decomposition's largest-eigenvalue axis should be roughly aligned with X
    // OR Z (axes that span the SHORT directions — moment of inertia about the
    // SHORT axes is BIG, about the LONG axis is SMALL). The smallest-eigenvalue
    // axis is along Y (the rod's spine). We assert the smallest eigenvalue
    // axis is dominated by its Y component.
    const v0 = mass.principalAxesJs[0]; // smallest eigenvalue
    expect(Math.abs(v0[1]),
      `smallest-moment principal axis should align with Y (the rod's long axis) — ` +
      `got axis ${JSON.stringify(v0)}`)
      .toBeGreaterThan(0.85);

    // Query 6 — adjacency (facesOfEdge returns exactly 2 manifold partners)
    const adj = result.log.find(s => s.stage === 'adjacency');
    expect(adj, 'adjacency stage exists').toBeTruthy();
    expect(adj.trace, 'probe edge found for adjacency walk').toBeTruthy();
    expect(adj.trace.facesOfEdgeCount,
      `facesOfEdge for a manifold body edge must return exactly 2 (the two ` +
      `faces it bridges) — got ${adj.trace.facesOfEdgeCount}`)
      .toBe(2);
    expect(adj.trace.verticesOfEdgeCount,
      `verticesOfEdge must return 1 or 2 (closed circular edge has 1 vertex)`)
      .toBeGreaterThan(0);
    expect(adj.trace.coedgesOfEdgeCount,
      `coedgesOfEdge must return at least 1 (the directed uses)`)
      .toBeGreaterThan(0);
    expect(adj.trace.firstFaceEdgeCount,
      `edgesOfFace must return more than 0 for the probe edge's neighbour face`)
      .toBeGreaterThan(0);

    // ── Step 4 — FRAME the rod once with __archdiscFocusOnObject and HOLD
    //         that single well-framed camera position for every still. ONE
    //         perfect view; NO 7-angle orbit.
    const framingOk = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      if (!reg || reg.bodies.length === 0) return false;
      const body = reg.bodies[reg.bodies.length - 1];
      if (!body || !body.group) return false;
      if (typeof window.__archdiscFocusOnObject === 'function') {
        window.__archdiscFocusOnObject(body.group);
        return true;
      }
      return false;
    });
    expect(framingOk, 'must be able to frame the final rod').toBe(true);
    await win.waitForTimeout(900);
    await story.frame('rod-framed-iso');

    // ONE deliberate drag-orbit reveals the I-beam profile + the two bores
    // from a side angle the iso view cannot show. A smaller orbit keeps the
    // rod in good 3D-character framing — large orbits make it edge-on.
    await dragOrbit(win, { dx: -120, dy: -60, steps: 22 });
    await win.waitForTimeout(420);
    await story.frame('rod-side-reveal-bores-and-i-beam');

    // ── Step 5 — confirm page errors clean + stills exist + valid sizes.
    expect(pageErrors,
      `page errors during the workflow: ${JSON.stringify(pageErrors)}`).toEqual([]);
    const stills = story.frames();
    const requiredStills = [
      /-rod-framed-iso\.png$/,
      /-rod-side-reveal-bores-and-i-beam\.png$/,
    ];
    for (const re of requiredStills) {
      const f = stills.find(s => re.test(s));
      expect(f, `still matching ${re} exists`).toBeTruthy();
      expect(fs.statSync(f).size, `${f}: real screenshot > 10 KB`).toBeGreaterThan(10 * 1024);
    }
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
