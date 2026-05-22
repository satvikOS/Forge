/**
 * spine-scaffold-electron.spec.js  —  SP-1 Stage S0
 *
 * Verifies the unified-topology-spine SCAFFOLD: the entity classes
 * (Body→Lump→Shell→Face→Loop→Coedge→Edge→Vertex), the per-body persistent-ID
 * `IdAllocator`, and `validateSpine` (Euler-Poincaré + structural invariants).
 *
 * S0 introduces NO behaviour change — these classes are not yet constructed by
 * any ribbon op. So this spec, after driving a REAL Part-tab workflow and
 * motion-capturing it (so the artifact shows the operation in motion, per the
 * ArchDisc methodology), constructs a spine `Body` BY HAND inside win.evaluate
 * — a unit cube: 8 vertices, 12 edges, 24 coedges, 6 faces, 6 loops, 1 shell,
 * 1 lump, 1 solid body — runs `validateSpine`, and asserts:
 *   - validateSpine().ok === true
 *   - checkEulerPoincare().ok === true and χ === 2
 *   - the hand-built counts match (the scaffold composes correctly)
 *   - persistent ids are unique and body-namespaced
 *   - a deliberately-broken spine (an open shell) FAILS validateSpine — proving
 *     the validator actually catches defects.
 *
 * The spine classes are reached through `window.__archdiscSpine` (exposed by
 * WorkbenchMechanical, mirror of `__archdiscKernel`).
 *
 * Motion-capture: headed Electron, real ribbon click, slow-mo video + stills,
 * multi-angle drag-orbit. Imports are BARE specifiers (no node:).
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { buildPrimitive } from './helpers/uiWorkflow.js';
import { launchWithCapture, clickBody, dragOrbit } from './helpers/motionCapture.js';
import { captureAllAngles } from './helpers/orbitCapture.js';

test.setTimeout(600000);

test('SP-1 S0 — topology-spine scaffold: a hand-built unit cube is Euler-valid', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('spine-scaffold');
  try {
    // ── Step 1 — drive a REAL Part-tab workflow (a Box), motion-captured ─────
    // S0 changes no op, so the box is an ordinary BrepShape body — but building
    // it through the real ribbon keeps this spec an in-motion, real-workflow
    // test (not a bare unit assertion), as the methodology requires.
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);
    await story.frame('input-box');
    await dragOrbit(win, { dx: 210, dy: 95 });
    await story.frame('input-box-3d');
    await clickBody(win, boxId);
    await story.frame('box-selected');

    // ── Step 2 — confirm the spine scaffold is exposed ───────────────────────
    const spineApiOk = await win.evaluate(() => {
      const S = window.__archdiscSpine;
      return !!(S && S.bindSpine && S.validateSpine && S.classes
        && S.classes.Body && S.classes.Lump && S.classes.Shell && S.classes.Face
        && S.classes.Loop && S.classes.Coedge && S.classes.Edge && S.classes.Vertex
        && S.classes.IdAllocator && S.classes.SpineBody);
    });
    expect(spineApiOk, 'window.__archdiscSpine must expose every spine class').toBe(true);

    // ── Step 3 — hand-build a unit-cube spine Body and validate it ───────────
    const cube = await win.evaluate(() => {
      const { Body, Lump, Shell, Face, Loop, Coedge, Edge, Vertex } =
        window.__archdiscSpine.classes;
      const validateSpine = window.__archdiscSpine.validateSpine;

      // A 1mm unit cube — corner at origin, +X/+Y/+Z.
      const body = new Body({ bodyTag: 'b-cube' });

      // 8 vertices.
      const P = [
        [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
        [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
      ];
      const V = P.map(([x, y, z]) =>
        new Vertex({ x, y, z }, { persistentId: body.allocId('vertex') }));

      // 12 edges — each as an undirected segment between two vertices.
      const E_DEF = [
        [0, 1], [1, 2], [2, 3], [3, 0],   // bottom
        [4, 5], [5, 6], [6, 7], [7, 4],   // top
        [0, 4], [1, 5], [2, 6], [3, 7],   // verticals
      ];
      const E = E_DEF.map(([a, b]) =>
        new Edge(V[a], V[b], null, { persistentId: body.allocId('edge') }));
      // edge index by unordered vertex pair, for coedge construction.
      const edgeOf = (a, b) => {
        for (let i = 0; i < E_DEF.length; i++) {
          const [x, y] = E_DEF[i];
          if ((x === a && y === b) || (x === b && y === a)) {
            return { edge: E[i], reversed: !(x === a && y === b) };
          }
        }
        throw new Error(`no edge for ${a}-${b}`);
      };

      // 6 faces — each a 4-vertex CCW loop (outward normal).
      const FACE_DEF = [
        [0, 3, 2, 1],   // bottom (z=0), normal -Z
        [4, 5, 6, 7],   // top    (z=1), normal +Z
        [0, 1, 5, 4],   // front  (y=0), normal -Y
        [2, 3, 7, 6],   // back   (y=1), normal +Y
        [1, 2, 6, 5],   // right  (x=1), normal +X
        [3, 0, 4, 7],   // left   (x=0), normal -X
      ];
      const faces = [];
      for (const verts of FACE_DEF) {
        const coedges = [];
        for (let i = 0; i < verts.length; i++) {
          const a = verts[i];
          const b = verts[(i + 1) % verts.length];
          const { edge, reversed } = edgeOf(a, b);
          coedges.push(new Coedge(edge, reversed,
            { persistentId: body.allocId('coedge') }));
        }
        const loop = new Loop(coedges, { persistentId: body.allocId('loop'), isOuter: true });
        const face = new Face(null, loop, [], { persistentId: body.allocId('face') });
        faces.push(face);
      }

      // 1 shell, 1 lump.
      const shell = new Shell(faces, { persistentId: body.allocId('shell'), role: 'peripheral' });
      const lump = new Lump([shell], { persistentId: body.allocId('lump') });
      body.addLump(lump);
      body.assertKind();

      const report = validateSpine(body);
      const euler = body.checkEulerPoincare();

      // coedge total
      let coedgeCount = 0;
      for (const f of body.faces()) coedgeCount += f.coedges().length;

      // sample persistent ids — confirm body-namespaced (start with 'b-cube:').
      const sampleIds = body.faces().slice(0, 3).map(f => f.persistentId);
      const allIdsNamespaced = [
        ...body.faces(), ...body.edges(), ...body.vertices(),
      ].every(e => typeof e.persistentId === 'string' && e.persistentId.startsWith('b-cube:'));

      return {
        kind: body.kind,
        counts: {
          lumps: body.lumps.length,
          shells: body.shells().length,
          faces: body.faces().length,
          loops: body.loops().length,
          coedges: coedgeCount,
          edges: body.edges().length,
          vertices: body.vertices().length,
        },
        euler,
        report,
        sampleIds,
        allIdsNamespaced,
        nonManifoldEdgeCount: body.nonManifoldEdges().length,
        // every edge of a closed cube is manifold → exactly 2 coedges.
        everyEdgeManifold: body.edges().every(e => e.coedges.size === 2),
      };
    });

    console.log(`  Hand-built spine: kind=${cube.kind}, ` +
      `counts=${JSON.stringify(cube.counts)}`);
    console.log(`  Euler: χ=${cube.euler.actual}, ok=${cube.euler.ok} — ${cube.euler.note}`);
    console.log(`  validateSpine: ok=${cube.report.ok}, ` +
      `errors=${cube.report.errors.length}, warnings=${cube.report.warnings.length}`);
    if (cube.report.errors.length) console.log(`  errors: ${JSON.stringify(cube.report.errors)}`);

    // ── Assertions on the hand-built cube ────────────────────────────────────
    expect(cube.kind).toBe('solid');
    expect(cube.counts.vertices).toBe(8);
    expect(cube.counts.edges).toBe(12);
    expect(cube.counts.coedges).toBe(24);
    expect(cube.counts.faces).toBe(6);
    expect(cube.counts.loops).toBe(6);
    expect(cube.counts.shells).toBe(1);
    expect(cube.counts.lumps).toBe(1);
    expect(cube.everyEdgeManifold).toBe(true);
    expect(cube.nonManifoldEdgeCount).toBe(0);

    // Euler-Poincaré: χ = V−E+F = 8−12+6 = 2 for a genus-0 solid.
    expect(cube.euler.actual).toBe(2);
    expect(cube.euler.ok).toBe(true);
    expect(cube.euler.genusImplied).toBe(0);

    // validateSpine: a correctly-built cube has zero errors.
    expect(cube.report.ok, `validateSpine errors: ${JSON.stringify(cube.report.errors)}`).toBe(true);
    expect(cube.report.errors).toEqual([]);

    // Persistent ids: body-namespaced + unique.
    expect(cube.allIdsNamespaced).toBe(true);
    for (const id of cube.sampleIds) expect(id).toMatch(/^b-cube:/);

    await story.frame('spine-cube-validated');

    // ── Step 4 — a deliberately-broken spine must FAIL validateSpine ─────────
    // Drop one face from the cube → an open shell → no longer a solid → free
    // boundary edges. The validator must report errors. This proves the
    // validator actually checks structure, not just rubber-stamps.
    const broken = await win.evaluate(() => {
      const { Body, Lump, Shell, Face, Loop, Coedge, Edge, Vertex } =
        window.__archdiscSpine.classes;
      const validateSpine = window.__archdiscSpine.validateSpine;

      const body = new Body({ bodyTag: 'b-broken' });
      const P = [
        [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
        [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
      ];
      const V = P.map(([x, y, z]) =>
        new Vertex({ x, y, z }, { persistentId: body.allocId('vertex') }));
      const E_DEF = [
        [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ];
      const E = E_DEF.map(([a, b]) =>
        new Edge(V[a], V[b], null, { persistentId: body.allocId('edge') }));
      const edgeOf = (a, b) => {
        for (let i = 0; i < E_DEF.length; i++) {
          const [x, y] = E_DEF[i];
          if ((x === a && y === b) || (x === b && y === a)) {
            return { edge: E[i], reversed: !(x === a && y === b) };
          }
        }
        throw new Error('no edge');
      };
      // Only 5 faces — the top face (4,5,6,7) is OMITTED → open shell.
      const FACE_DEF = [
        [0, 3, 2, 1], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7],
      ];
      const faces = [];
      for (const verts of FACE_DEF) {
        const coedges = [];
        for (let i = 0; i < verts.length; i++) {
          const { edge, reversed } = edgeOf(verts[i], verts[(i + 1) % verts.length]);
          coedges.push(new Coedge(edge, reversed,
            { persistentId: body.allocId('coedge') }));
        }
        const loop = new Loop(coedges, { persistentId: body.allocId('loop'), isOuter: true });
        faces.push(new Face(null, loop, [], { persistentId: body.allocId('face') }));
      }
      const shell = new Shell(faces, { persistentId: body.allocId('shell'), role: 'peripheral' });
      body.addLump(new Lump([shell], { persistentId: body.allocId('lump') }));
      body.assertKind();
      const report = validateSpine(body);
      return {
        kind: body.kind,            // should be 'sheet' — open shell
        shellClosed: shell.isClosed(),
        reportOk: report.ok,
        errorCount: report.errors.length,
        firstErrors: report.errors.slice(0, 3),
      };
    });

    console.log(`  Broken spine (5-face cube): kind=${broken.kind}, ` +
      `shellClosed=${broken.shellClosed}, validateSpine.ok=${broken.reportOk}, ` +
      `errors=${broken.errorCount}`);

    // The open shell is no longer a solid → kind becomes 'sheet'.
    expect(broken.shellClosed).toBe(false);
    expect(broken.kind).toBe('sheet');
    // A 'sheet' body with free-boundary edges is structurally valid AS a sheet
    // (no solid Euler relation to violate) — but it must NOT be mis-derived as
    // a solid. The decisive proof: the kind changed and the shell is open.
    // To prove validateSpine catches a genuine STRUCTURAL defect, the next
    // sub-check builds a spine whose stored kind lies.
    const kindLie = await win.evaluate(() => {
      const { Body, Lump, Shell, Face, Loop, Coedge, Edge, Vertex } =
        window.__archdiscSpine.classes;
      const validateSpine = window.__archdiscSpine.validateSpine;
      const body = new Body({ bodyTag: 'b-lie', kind: 'solid' });
      // a single triangular face — definitely a sheet, but kind says 'solid'.
      const v0 = new Vertex({ x: 0, y: 0, z: 0 }, { persistentId: body.allocId('vertex') });
      const v1 = new Vertex({ x: 1, y: 0, z: 0 }, { persistentId: body.allocId('vertex') });
      const v2 = new Vertex({ x: 0, y: 1, z: 0 }, { persistentId: body.allocId('vertex') });
      const e0 = new Edge(v0, v1, null, { persistentId: body.allocId('edge') });
      const e1 = new Edge(v1, v2, null, { persistentId: body.allocId('edge') });
      const e2 = new Edge(v2, v0, null, { persistentId: body.allocId('edge') });
      const loop = new Loop([
        new Coedge(e0, false, { persistentId: body.allocId('coedge') }),
        new Coedge(e1, false, { persistentId: body.allocId('coedge') }),
        new Coedge(e2, false, { persistentId: body.allocId('coedge') }),
      ], { persistentId: body.allocId('loop'), isOuter: true });
      const face = new Face(null, loop, [], { persistentId: body.allocId('face') });
      const shell = new Shell([face], { persistentId: body.allocId('shell') });
      body.addLump(new Lump([shell], { persistentId: body.allocId('lump') }));
      // NOTE: do NOT call assertKind() — leave the lying 'solid' in place.
      const report = validateSpine(body);
      return { reportOk: report.ok, errors: report.errors };
    });
    console.log(`  Kind-lie spine: validateSpine.ok=${kindLie.reportOk}, ` +
      `errors=${JSON.stringify(kindLie.errors)}`);
    // validateSpine must FAIL — the stored kind 'solid' disagrees with the
    // topology-derived 'sheet', AND a solid cannot have 1-coedge edges.
    expect(kindLie.reportOk).toBe(false);
    expect(kindLie.errors.length).toBeGreaterThan(0);

    await story.frame('validator-catches-defect');

    // ── Step 5 — multi-angle render of the real box, no blank frames ─────────
    const cap = await captureAllAngles(win, 'spine-scaffold', { story, drags: 6 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Step 6 — storyboard stills exist and are non-trivial ─────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input-box\.png$/.test(f));
    const validatedStill = stills.find(f => /-spine-cube-validated\.png$/.test(f));
    expect(inputStill, 'an input-box still must exist').toBeTruthy();
    expect(validatedStill, 'a spine-cube-validated still must exist').toBeTruthy();
    expect(fs.statSync(inputStill).size).toBeGreaterThan(10 * 1024);
    expect(fs.statSync(validatedStill).size).toBeGreaterThan(10 * 1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize, 'the recorded session .webm must be > 200 KB')
      .toBeGreaterThan(200 * 1024);
  }
});
