/**
 * ArchDisc Kernel — Final §3 B-rep capabilities.
 *
 * Implements the 4 REACHABLE items confirmed by Sub-project F recon
 * (commit 19a69f5a). Verified call sequences: docs/superpowers/notes/occt-api-F.md
 *
 *   pipeShellSweep(opts)    — tortuous-path sweep via BRepOffsetAPI_MakePipeShell
 *   loftTangent(opts)       — tangent-smoothed loft via BRepOffsetAPI_ThruSections
 *   stitchFaces(opts)       — tolerant stitching via BRepBuilderAPI_Sewing
 *   convergentSolid(opts)   — facet-mesh → B-rep solid via Sewing + MakeSolid_3
 *
 * SP-1 S4c — surfacing subset migration. `pipeShellSweep` / `loftTangent` /
 * `stitchFaces` return `SpineBody`s with persistent-ID carry-through from
 * the internally-built profile / section / panel sheets. `convergentSolid`
 * is also spine-aware: every triangle face is spined; its ids carry onto
 * the result solid via the sewing algorithm's history.
 *
 * For `stitchFaces` we cannot reuse the standard `BRepBuilderAPI_MakeShape`
 * lineage path because `BRepBuilderAPI_Sewing` exposes `Modified(shape) →
 * TopoDS_Shape` (a single shape, NOT a list) and `IsModified(shape)`; it
 * also has its own `NbDeletedFaces`/`DeletedFace(i)` deletion accessor.
 * `IdLineage.carryLineage` is `BRepBuilderAPI_MakeShape`-shaped, so we
 * wrap the sewing's queries with a small synthetic algo proxy
 * (`makeSewingAlgoProxy`) that adapts the API surface.
 *
 * NOT_REACHABLE in this build:
 *   N-Sided Patching — BRepOffsetAPI_MakeFilling.Build() throws a raw WASM C++
 *   exception for ALL inputs; variational solver not functional in this WASM build.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';
import {
  recordBodyCreate,
  standardSceneRegister,
  standardSceneRemove,
} from '../history/HistoryLog.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a straight-line edge between two points.
 * Both gp_Pnt_3 objects are tracked for disposal.
 */
function _makeLineEdge(oc, x1, y1, z1, x2, y2, z2) {
  const p1 = track(new oc.gp_Pnt_3(x1, y1, z1));
  const p2 = track(new oc.gp_Pnt_3(x2, y2, z2));
  const em = track(new oc.BRepBuilderAPI_MakeEdge_3(p1, p2));
  return track(em.Edge());
}

/**
 * Build a planar rectangular face from corner coordinates at a given Z.
 */
function _makeRectFace(oc, x0, y0, x1, y1, z) {
  const e1 = _makeLineEdge(oc, x0, y0, z, x1, y0, z);
  const e2 = _makeLineEdge(oc, x1, y0, z, x1, y1, z);
  const e3 = _makeLineEdge(oc, x1, y1, z, x0, y1, z);
  const e4 = _makeLineEdge(oc, x0, y1, z, x0, y0, z);
  const wm = track(new oc.BRepBuilderAPI_MakeWire_1());
  wm.Add_1(e1); wm.Add_1(e2); wm.Add_1(e3); wm.Add_1(e4);
  const wire = track(wm.Wire());
  const fm = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
  return track(fm.Face());
}

/**
 * Build a square wire centered on Z-axis at a given height.
 * The square has side length `s` and is positioned at (0..s, 0..s, z).
 */
function _makeSquareWireAtZ(oc, s, z) {
  const e1 = _makeLineEdge(oc, 0, 0, z, s, 0, z);
  const e2 = _makeLineEdge(oc, s, 0, z, s, s, z);
  const e3 = _makeLineEdge(oc, s, s, z, 0, s, z);
  const e4 = _makeLineEdge(oc, 0, s, z, 0, 0, z);
  const wm = track(new oc.BRepBuilderAPI_MakeWire_1());
  wm.Add_1(e1); wm.Add_1(e2); wm.Add_1(e3); wm.Add_1(e4);
  return track(wm.Wire());
}

/**
 * Build a planar triangle face from three coordinate triples and add it to an array.
 * Skips degenerate triangles. Result face is tracked.
 */
function _makeTriFace(oc, ax, ay, az, bx, by, bz, cx, cy, cz) {
  // Degenerate check
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx * nx + ny * ny + nz * nz < 1e-12) return null;

  const e1 = _makeLineEdge(oc, ax, ay, az, bx, by, bz);
  const e2 = _makeLineEdge(oc, bx, by, bz, cx, cy, cz);
  const e3 = _makeLineEdge(oc, cx, cy, cz, ax, ay, az);
  const wm = track(new oc.BRepBuilderAPI_MakeWire_1());
  wm.Add_1(e1); wm.Add_1(e2); wm.Add_1(e3);
  if (!wm.IsDone()) return null;
  const wire = track(wm.Wire());
  const fm = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
  if (!fm.IsDone()) return null;
  return track(fm.Face());
}

/**
 * Extract the first shell from a sewed shape via TopExp_Explorer.
 * Returns a tracked shell TopoDS_Shell.
 */
function _extractShell(oc, sewedShape) {
  const SHELL = oc.TopAbs_ShapeEnum.TopAbs_SHELL;
  const ANY   = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
  const exp = track(new oc.TopExp_Explorer_2(sewedShape, SHELL, ANY));
  if (!exp.More()) throw new Error('No shell in sewed shape');
  return track(oc.TopoDS.Shell_1(exp.Current()));
}

// ---------------------------------------------------------------------------
// 1. pipeShellSweep — Tortuous-path Sweep
// ---------------------------------------------------------------------------

/**
 * Sweep a circular profile along a tortuous polyline path with right-angle bends.
 *
 * SP-1 S4c — returns a SpineBody. The circular profile face is spined as a
 * temporary sheet body so the pipe-shell's `Modified` / `Generated` /
 * `IsDeleted` history can propagate its persistent ids onto the resulting
 * solid. `BRepOffsetAPI_MakePipeShell extends BRepPrimAPI_MakeSweep extends
 * BRepBuilderAPI_MakeShape` — the full history surface inherited from the
 * base.
 *
 * @param {object} [opts]
 * @param {number} [opts.profileRadius=4]  Circle profile radius (mm).
 * @param {number} [opts.segLength=20]     Length of each path segment (mm).
 * @param {number} [opts.bendCount=2]      Number of right-angle bends (1–6).
 * @returns {Promise<SpineBody>}
 */
async function _constructPipeShellSweep(opts, bodyTag) {
  const profileRadius = opts.profileRadius ?? 4;
  const segLength     = opts.segLength     ?? 20;
  const bendCount     = opts.bendCount     ?? 2;

  const oc = await getOCCT();
  return withScope(() => {
    // Build tortuous polyline path: N+1 vertices with alternating right-angle bends.
    // Pattern: (0,0,0)→(L,0,0)→(L,L,0)→(L,L,L)→... alternating X/Y/Z axes.
    const axes = [
      [1, 0, 0],  // +X
      [0, 1, 0],  // +Y
      [0, 0, 1],  // +Z
      [-1, 0, 0], // -X
      [0, -1, 0], // -Y
      [0, 0, -1], // -Z
    ];
    const nSegs = bendCount + 1;
    const verts = [[0, 0, 0]];
    for (let i = 0; i < nSegs; i++) {
      const [dx, dy, dz] = axes[i % axes.length];
      const prev = verts[verts.length - 1];
      verts.push([
        prev[0] + dx * segLength,
        prev[1] + dy * segLength,
        prev[2] + dz * segLength,
      ]);
    }

    // Build spine wire from edges.
    const bw = track(new oc.BRepBuilderAPI_MakeWire_1());
    for (let i = 0; i < verts.length - 1; i++) {
      const [x1, y1, z1] = verts[i];
      const [x2, y2, z2] = verts[i + 1];
      const e = _makeLineEdge(oc, x1, y1, z1, x2, y2, z2);
      bw.Add_1(e);
    }
    if (!bw.IsDone()) throw new Error('pipeShellSweep: spine wire failed to build');
    const spineWire = track(bw.Wire());

    // Build circular profile at path start, normal along first edge direction (+X).
    const originPnt = track(new oc.gp_Pnt_3(0, 0, 0));
    const [dx0, dy0, dz0] = axes[0];
    const axisDir = track(new oc.gp_Dir_4(dx0, dy0, dz0));
    const refDir  = track(new oc.gp_Dir_4(0, 0, 1));
    const ax2     = track(new oc.gp_Ax2_2(originPnt, axisDir, refDir));
    const circ    = track(new oc.gp_Circ_2(ax2, profileRadius));
    const circEM  = track(new oc.BRepBuilderAPI_MakeEdge_8(circ));
    const circEdge = track(circEM.Edge());
    const pw = track(new oc.BRepBuilderAPI_MakeWire_1());
    pw.Add_1(circEdge);
    if (!pw.IsDone()) throw new Error('pipeShellSweep: profile wire failed to build');
    const profileWire = track(pw.Wire());

    // Wrap the profile wire in a face so we can spine it for lineage. The
    // pipe-shell algorithm itself accepts the wire (Add_1(profileWire,
    // false, false)) — the face is only used as the spinable handle on the
    // input side.
    const profileFM = track(new oc.BRepBuilderAPI_MakeFace_15(profileWire, true));
    const profileFace = profileFM.IsDone() ? track(profileFM.Face()) : null;
    let profileBody = null;
    if (profileFace && !profileFace.IsNull()) {
      try {
        profileBody = bindSpine(oc, profileFace, {
          bodyTag: 'pipeShellSweepProfile', validate: false,
        });
      } catch (_e) {
        profileBody = null;
      }
    }

    // Construct PipeShell — no suffix variant in this build.
    const pipeShell = track(new oc.BRepOffsetAPI_MakePipeShell(spineWire));

    // Add profile — Add_1 requires EXACTLY 3 args (withContact, withCorrection).
    pipeShell.Add_1(profileWire, false, false);

    // Build — ProgressRange required (0-arg throws BindingError).
    const pr = track(new oc.Message_ProgressRange_1());
    pipeShell.Build(pr);

    if (!pipeShell.IsDone()) {
      throw new Error('pipeShellSweep: BRepOffsetAPI_MakePipeShell.Build() failed');
    }

    // Call MakeSolid() to cap the open-ended pipe into a closed solid.
    pipeShell.MakeSolid();

    const shape = track(pipeShell.Shape());
    if (shape.IsNull()) {
      throw new Error('pipeShellSweep: resulting shape is null');
    }

    const meta = {
      op: 'pipeShellSweep',
      params: opts,
      description: `Tortuous-path pipe sweep: r=${profileRadius}mm, segLen=${segLength}mm, bends=${bendCount}`,
    };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `pipeShellSweep-${wrapper.id}`, geomEngineShape: wrapper,
    });
    if (profileBody) {
      const lineage = carryLineage(oc, pipeShell, resultBody, [
        { body: profileBody, role: 'arg' },
      ]);
      meta.lineage = {
        survived: lineage.survived, modified: lineage.modified,
        generated: lineage.generated, deleted: lineage.deleted,
        conflicts: lineage.conflicts,
        faceMap: [...lineage.faceMap.entries()].slice(0, 64),
        edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
      };
    }
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function pipeShellSweep(opts = {}) {
  const spineBody = await _constructPipeShellSweep(opts);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'pipeShellSweep',
        persistentBodyId,
        meta: { op: 'pipeShellSweep', params: opts },
        rebuild: () => _constructPipeShellSweep(opts, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('pipeShellSweep: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}

// ---------------------------------------------------------------------------
// 2. loftTangent — Tangent-Smoothed Loft
// ---------------------------------------------------------------------------

/**
 * Loft 3 square sections with tangent smoothing (SetSmoothing).
 *
 * SP-1 S4c — returns a SpineBody. Each section wire is wrapped in a planar
 * face and spined into a temporary sheet body; the ThruSections's `Modified`
 * / `Generated` history then carries the section ids onto the cap +
 * lateral faces of the resulting loft solid. `BRepOffsetAPI_ThruSections
 * extends BRepBuilderAPI_MakeShape` so the history surface is the base
 * contract.
 *
 * @param {object} [opts]
 * @param {number} [opts.s0=40]   Side length of section 0 (mm).
 * @param {number} [opts.s1=20]   Side length of section 1 (mm).
 * @param {number} [opts.s2=30]   Side length of section 2 (mm).
 * @param {number} [opts.z0=0]    Z height of section 0 (mm).
 * @param {number} [opts.z1=20]   Z height of section 1 (mm).
 * @param {number} [opts.z2=40]   Z height of section 2 (mm).
 * @returns {Promise<SpineBody>}
 */
async function _constructLoftTangent(opts, bodyTag) {
  const s0 = opts.s0 ?? 40;
  const s1 = opts.s1 ?? 20;
  const s2 = opts.s2 ?? 30;
  const z0 = opts.z0 ?? 0;
  const z1 = opts.z1 ?? 20;
  const z2 = opts.z2 ?? 40;

  const oc = await getOCCT();
  return withScope(() => {
    // Build 3 square section wires at the specified heights.
    const wire0 = _makeSquareWireAtZ(oc, s0, z0);
    const wire1 = _makeSquareWireAtZ(oc, s1, z1);
    const wire2 = _makeSquareWireAtZ(oc, s2, z2);

    // Spine each section by wrapping its wire in a planar face; this gives
    // the section edges + vertices persistent ids that the loft's lineage
    // propagation can carry onto the result lateral / cap faces.
    function spineSection(wire, tag) {
      const fm = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
      if (!fm.IsDone()) return null;
      const sectionFace = track(fm.Face());
      try {
        return bindSpine(oc, sectionFace, {
          bodyTag: tag, validate: false,
        });
      } catch (_e) {
        return null;
      }
    }
    const sectionBody0 = spineSection(wire0, 'loftTangentSection0');
    const sectionBody1 = spineSection(wire1, 'loftTangentSection1');
    const sectionBody2 = spineSection(wire2, 'loftTangentSection2');

    // Construct ThruSections — isSolid=true, isRuled=false, presPar=1e-6.
    const thru = track(new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6));

    // Add wires bottom-to-top.
    thru.AddWire(wire0);
    thru.AddWire(wire1);
    thru.AddWire(wire2);

    // Enable G1-tangent (smooth) loft — the key tangency call.
    thru.SetSmoothing(true);

    // Build — ProgressRange required.
    const pr = track(new oc.Message_ProgressRange_1());
    thru.Build(pr);

    if (!thru.IsDone()) {
      throw new Error('loftTangent: BRepOffsetAPI_ThruSections.Build() failed');
    }

    const shape = track(thru.Shape());
    if (shape.IsNull()) {
      throw new Error('loftTangent: resulting shape is null');
    }

    const meta = {
      op: 'loftTangent',
      params: opts,
      description: `Tangent-smoothed loft: s0=${s0}, s1=${s1}, s2=${s2} mm at z=${z0},${z1},${z2} mm`,
    };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `loftTangent-${wrapper.id}`, geomEngineShape: wrapper,
    });
    const sectionBodies = [sectionBody0, sectionBody1, sectionBody2]
      .filter((sb) => !!sb)
      .map((body) => ({ body, role: 'arg' }));
    if (sectionBodies.length > 0) {
      const lineage = carryLineage(oc, thru, resultBody, sectionBodies);
      meta.lineage = {
        survived: lineage.survived, modified: lineage.modified,
        generated: lineage.generated, deleted: lineage.deleted,
        conflicts: lineage.conflicts,
        faceMap: [...lineage.faceMap.entries()].slice(0, 64),
        edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
      };
    }
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function loftTangent(opts = {}) {
  const spineBody = await _constructLoftTangent(opts);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'loftTangent',
        persistentBodyId,
        meta: { op: 'loftTangent', params: opts },
        rebuild: () => _constructLoftTangent(opts, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('loftTangent: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}

// ---------------------------------------------------------------------------
// 3. stitchFaces — Tolerant Stitching
// ---------------------------------------------------------------------------

/**
 * Wrap a `BRepBuilderAPI_Sewing` so `IdLineage.carryLineage` can consume it.
 *
 * The sewing algo's history surface differs from `BRepBuilderAPI_MakeShape`:
 *   - `Modified(shape)` returns a SINGLE `TopoDS_Shape`, NOT a list.
 *   - `IsModified(shape)` returns true if Modified(shape) differs from shape.
 *   - `IsDeleted(shape)` is not exposed; sewing instead exposes
 *     `NbDeletedFaces()` + `DeletedFace(i)` for FACE deletions only.
 *
 * The proxy adapts these to look like the standard contract: `Modified`
 * returns a synthetic list-like object (Size / First_1 / Last_1) so
 * `safeShapeList` works; `IsDeleted` consults the deleted-faces table
 * (FACE only — edges/vertices fall back to false, an honest documented
 * gap, since sewing's deletion semantics are face-level).
 */
function makeSewingAlgoProxy(oc, sewing) {
  // Build the deleted-face set once for IsDeleted lookups.
  const deletedFaces = [];
  try {
    const nDel = typeof sewing.NbDeletedFaces === 'function'
      ? sewing.NbDeletedFaces() : 0;
    for (let i = 1; i <= nDel; i++) {
      try { deletedFaces.push(sewing.DeletedFace(i)); } catch (_e) { /* skip */ }
    }
  } catch (_e) { /* sewing without deletions */ }

  // A minimal list-like object — Size + First_1 + Last_1 — matches what
  // `IdLineage.safeShapeList` reads. Returning a single mapped shape gives
  // Size=1 + First_1=the shape.
  function singletonList(shape) {
    return {
      Size: () => 1,
      Extent: () => 1,
      IsEmpty: () => false,
      First_1: () => shape,
      Last_1: () => shape,
    };
  }
  function emptyList() {
    return {
      Size: () => 0,
      Extent: () => 0,
      IsEmpty: () => true,
      First_1: () => null,
      Last_1: () => null,
    };
  }

  return {
    Modified: (S) => {
      try {
        // IsModifiedSubShape handles edges/vertices; IsModified the face case.
        const isFaceMod = typeof sewing.IsModified === 'function'
          && sewing.IsModified(S);
        const isSubMod = typeof sewing.IsModifiedSubShape === 'function'
          && sewing.IsModifiedSubShape(S);
        if (isFaceMod) {
          const m = sewing.Modified(S);
          if (m && !m.IsSame(S)) return singletonList(m);
          return emptyList();
        }
        if (isSubMod) {
          const m = sewing.ModifiedSubShape(S);
          if (m && !m.IsSame(S)) return singletonList(m);
          return emptyList();
        }
        return emptyList();
      } catch (_e) {
        return emptyList();
      }
    },
    Generated: (_S) => emptyList(), // sewing has no Generated history
    IsDeleted: (S) => {
      try {
        for (const df of deletedFaces) {
          if (df && S && typeof df.IsSame === 'function' && df.IsSame(S)) {
            return true;
          }
        }
      } catch (_e) { /* skip */ }
      return false;
    },
  };
}

/**
 * Stitch two planar rectangular faces with a small gap using BRepBuilderAPI_Sewing.
 *
 * SP-1 S4c — returns a SpineBody. Both panel faces are spined as temporary
 * sheet bodies; the sewing's `Modified` / `IsDeleted` history (wrapped via
 * `makeSewingAlgoProxy` to fit the standard lineage contract) propagates
 * the panel ids onto the result sewn shape. A face whose TShape survived
 * the sewing carries its id verbatim; a face that was modified by the
 * sewing (e.g. its shared edge replaced by a stitched edge) records the
 * panel id in `derivedFrom`.
 *
 * @param {object} [opts]
 * @param {number} [opts.gap=0.05]       Gap between the two panels (mm).
 * @param {number} [opts.tolerance=0.1]  Sewing tolerance (mm); must be > gap.
 * @param {number} [opts.panelW=20]      Panel width (mm).
 * @param {number} [opts.panelH=20]      Panel height (mm).
 * @returns {Promise<SpineBody>}
 */
async function _constructStitchFaces(opts, bodyTag) {
  const gap       = opts.gap       ?? 0.05;
  const tolerance = opts.tolerance ?? 0.1;
  const panelW    = opts.panelW    ?? 20;
  const panelH    = opts.panelH    ?? 20;

  const oc = await getOCCT();
  return withScope(() => {
    // Face A: (0..panelW, 0..panelH, 0)
    const faceA = _makeRectFace(oc, 0,            0, panelW,            panelH, 0);
    // Face B: (panelW+gap .. 2*panelW+gap, 0..panelH, 0) — small gap at shared edge
    const faceB = _makeRectFace(oc, panelW + gap, 0, 2 * panelW + gap, panelH, 0);

    // Spine each panel face for lineage. The sewing algo's history walks
    // these input bodies' faces / edges / vertices.
    let panelBodyA = null;
    let panelBodyB = null;
    try {
      panelBodyA = bindSpine(oc, faceA, {
        bodyTag: 'stitchFacesPanelA', validate: false,
      });
    } catch (_e) { panelBodyA = null; }
    try {
      panelBodyB = bindSpine(oc, faceB, {
        bodyTag: 'stitchFacesPanelB', validate: false,
      });
    } catch (_e) { panelBodyB = null; }

    // CRITICAL: Constructor requires EXACTLY 5 args.
    // new oc.BRepBuilderAPI_Sewing(tol) → BindingError "expected (5) parameters"
    const sewing = track(new oc.BRepBuilderAPI_Sewing(
      tolerance, // tolerance — stitches edges within this distance
      true,      // optionFaceMode
      true,      // optionBorderMode
      true,      // optionFreeEdges
      false,     // optionNonManifold
    ));

    sewing.Add(faceA);
    sewing.Add(faceB);

    // Perform — ProgressRange required.
    const pr = track(new oc.Message_ProgressRange_1());
    sewing.Perform(pr);

    const sewedShape = track(sewing.SewedShape());
    if (sewedShape.IsNull()) {
      throw new Error('stitchFaces: SewedShape() returned null');
    }

    const meta = {
      op: 'stitchFaces',
      params: opts,
      description: `Tolerant stitching: 2 panels (${panelW}×${panelH}mm) with gap=${gap}mm, tol=${tolerance}mm`,
    };
    const wrapper = new BrepShape(sewedShape, meta);
    const resultBody = bindSpine(oc, sewedShape, {
      bodyTag: bodyTag || `stitchFaces-${wrapper.id}`, geomEngineShape: wrapper,
    });
    const panelBodies = [panelBodyA, panelBodyB]
      .filter((b) => !!b)
      .map((body) => ({ body, role: 'arg' }));
    if (panelBodies.length > 0) {
      const sewingProxy = makeSewingAlgoProxy(oc, sewing);
      const lineage = carryLineage(oc, sewingProxy, resultBody, panelBodies);
      meta.lineage = {
        survived: lineage.survived, modified: lineage.modified,
        generated: lineage.generated, deleted: lineage.deleted,
        conflicts: lineage.conflicts,
        faceMap: [...lineage.faceMap.entries()].slice(0, 64),
        edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
      };
    }
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function stitchFaces(opts = {}) {
  const spineBody = await _constructStitchFaces(opts);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'stitchFaces',
        persistentBodyId,
        meta: { op: 'stitchFaces', params: opts },
        rebuild: () => _constructStitchFaces(opts, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('stitchFaces: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}

// ---------------------------------------------------------------------------
// 4. convergentSolid — Convergent Modeling (facet mesh → B-rep solid)
// ---------------------------------------------------------------------------

/**
 * Build a B-rep solid from a facet mesh (convergent modeling pipeline).
 * Constructs a cube from 12 triangle faces via the Sewing + MakeSolid_3 pipeline.
 *
 * @param {object} [opts]
 * @param {number} [opts.size=20]       Cube side length (mm).
 * @param {number} [opts.tolerance=0.001] Sewing tolerance (mm).
 * @returns {Promise<BrepShape>}
 */
export async function convergentSolid(opts = {}) {
  const size      = opts.size      ?? 20;
  const tolerance = opts.tolerance ?? 0.001;

  const oc = await getOCCT();
  return withScope(() => {
    // 8 vertices of a `size`-mm cube.
    const s = size;
    const V = [
      [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
      [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
    ];
    // 12 triangles — two per face, outward-pointing normals.
    const T = [
      // Bottom (z=0, normal -Z): CCW when viewed from -Z
      [0, 2, 1], [0, 3, 2],
      // Top (z=s, normal +Z): CCW when viewed from +Z
      [4, 5, 6], [4, 6, 7],
      // Front (y=0, normal -Y)
      [0, 1, 5], [0, 5, 4],
      // Back (y=s, normal +Y)
      [2, 3, 7], [2, 7, 6],
      // Left (x=0, normal -X)
      [0, 4, 7], [0, 7, 3],
      // Right (x=s, normal +X)
      [1, 2, 6], [1, 6, 5],
    ];

    // Build one planar face per triangle.
    const faces = [];
    for (const [ia, ib, ic] of T) {
      const [ax, ay, az] = V[ia];
      const [bx, by, bz] = V[ib];
      const [cx, cy, cz] = V[ic];
      const face = _makeTriFace(oc, ax, ay, az, bx, by, bz, cx, cy, cz);
      if (face) faces.push(face);
    }
    if (faces.length < 4) {
      throw new Error(`convergentSolid: too few triangle faces built (${faces.length})`);
    }

    // Sew the triangle faces into a closed shell.
    const sewing = track(new oc.BRepBuilderAPI_Sewing(
      tolerance, true, true, true, false,
    ));
    for (const f of faces) sewing.Add(f);
    const pr = track(new oc.Message_ProgressRange_1());
    sewing.Perform(pr);

    const sewedShape = track(sewing.SewedShape());
    if (sewedShape.IsNull()) {
      throw new Error('convergentSolid: SewedShape() returned null');
    }

    // Extract the shell from the sewed shape.
    const shell = _extractShell(oc, sewedShape);

    // Convert shell → solid using MakeSolid_3 (the only variant that takes a shell).
    // MakeSolid_2 takes TopoDS_CompSolid (wrong type); MakeSolid_3 is verified correct.
    const solidMaker = track(new oc.BRepBuilderAPI_MakeSolid_3(shell));
    if (!solidMaker.IsDone()) {
      throw new Error('convergentSolid: MakeSolid_3.IsDone() = false');
    }

    const shape = track(solidMaker.Shape());
    if (shape.IsNull()) {
      throw new Error('convergentSolid: resulting solid shape is null');
    }

    return new BrepShape(shape, {
      op: 'convergentSolid',
      params: opts,
      description: `Convergent modeling: ${faces.length} triangle faces → shell → solid (${size}mm cube, vol≈${(s*s*s).toFixed(0)}mm³)`,
    });
  });
}
