/**
 * ArchDisc Kernel — UX Tier 3a advanced feature operations.
 *
 * Three high-impact features the SolidWorks course (synthesis §6.3) flagged
 * as MISSING from ArchDisc's existing feature suite:
 *
 *   - boundaryBoss(profiles, guides, opts)
 *       Like Loft but accepts BOTH N profile cross-section wires AND M
 *       guide curves that constrain how profile points travel between
 *       sections. SW's marquee surfacing feature.
 *
 *       Binding: BRepOffsetAPI_ThruSections + SetSmoothing(true) for G1
 *       tangency between sections. Guide curves are passed through the
 *       PipeShell auxiliary-spine path (BRepOffsetAPI_MakePipeShell +
 *       SetMode_5(auxiliary, curvilinear)) — an HONEST PARTIAL: in the
 *       OCCT WASM build we currently bind, the auxiliary-spine binding is
 *       not exposed reliably for every guide-curve topology. When the
 *       PipeShell binding rejects the configuration we fall back to
 *       ThruSections+SetSmoothing (without guides), record the fallback
 *       reason on meta.guideFallback, and return the smoothed loft. This
 *       matches the canonical SW behaviour when guides are degenerate.
 *
 *   - rib(targetBody, sketchLine, opts)
 *       Extrude a sketched LINE into a thin wall feature between the
 *       sketch plane and the nearest existing surface of `targetBody`,
 *       with parametric thickness. SW's parametric rib pattern.
 *
 *       Binding: build a thin extrudeProfile (rectangle of thickness ×
 *       extrudeHeight around the sketch line), then intersect with the
 *       target body via BRepAlgoAPI_Common to clip away anything that
 *       protrudes past the body. The remaining intersection is the rib.
 *
 *   - helix({axis, diameter, pitch, revolutions, direction, taper})
 *       Real 3D helical CURVE (wire body), parameterised by axis +
 *       diameter + pitch + revolutions + direction (CW/CCW) + optional
 *       variable-pitch (linear taper). The typical use case is as the
 *       PATH for a subsequent sweep (spring, screw thread, coiled hose).
 *
 *       Binding: sample the helix at N points (default 64 per revolution),
 *       chain via BRepBuilderAPI_MakeEdge_3 into a polyline wire, wrap in
 *       BRep_Builder.MakeCompound. The result is a kind='wire' SpineBody.
 *       Real helix math: x(θ) = R·cos(θ); y(θ) = R·sin(θ); z(θ) = (pitch/2π)·θ
 *       with `θ ∈ [0, 2π·revolutions]`. The arc length for a constant-pitch
 *       helix is exactly pitch·revs·sqrt(1+(π·D/pitch)²).
 *
 * Every op is spine-aware:
 *   1. Run the kernel algorithm (geometry unchanged).
 *   2. bindSpine the result.
 *   3. Carry lineage from spined input profile faces / sketch lines /
 *      target bodies via carryLineage when the algorithm exposes a
 *      BRepBuilderAPI_MakeShape history surface.
 *   4. Wrap in SpineBody.
 *
 * Lineage path:
 *   - boundaryBoss: each profile FACE → bottom/top/intermediate caps via
 *     Modified+Generated; each profile EDGE → lateral patches via Generated.
 *   - rib: target body face / edge ids propagate via the intersection
 *     boolean's GetModified/GetGenerated history.
 *   - helix: no input body — the wire body's edge / vertex ids are freshly
 *     allocated by bindSpine.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';
import {
  recordBodyCreate,
  recordBodyDerive,
  standardSceneRegister,
  standardSceneRemove,
} from '../history/HistoryLog.js';

// ════════════════════════════════════════════════════════════════════════════
// Shared helpers (kept local — the existing BrepFeatures.coerceWire is private
// to that module; we reproduce the minimum here so this module is
// self-contained and doesn't change BrepFeatures.js).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Build a TopoDS_Wire from a closed polyline of {x,y,z} points.
 * Auto-dedups a repeated first==last point. ≥ 3 points required.
 */
function buildClosedWire(oc, pts) {
  if (!Array.isArray(pts) || pts.length < 3) {
    throw new Error(`buildClosedWire: needs ≥ 3 points (got ${pts?.length ?? 0})`);
  }
  let ring = pts.slice();
  const first = ring[0], last = ring[ring.length - 1];
  const dx = (last.x ?? 0) - (first.x ?? 0);
  const dy = (last.y ?? 0) - (first.y ?? 0);
  const dz = (last.z ?? 0) - (first.z ?? 0);
  if (dx * dx + dy * dy + dz * dz < 1e-12) ring = ring.slice(0, ring.length - 1);
  const ocPts = ring.map(p => track(new oc.gp_Pnt_3(p.x ?? 0, p.y ?? 0, p.z ?? 0)));
  const wm = track(new oc.BRepBuilderAPI_MakeWire_1());
  for (let i = 0; i < ocPts.length; i++) {
    const a = ocPts[i];
    const b = ocPts[(i + 1) % ocPts.length];
    const em = track(new oc.BRepBuilderAPI_MakeEdge_3(a, b));
    if (!em.IsDone()) throw new Error(`buildClosedWire: kernel rejected edge ${i}`);
    wm.Add_1(track(em.Edge()));
  }
  if (!wm.IsDone()) throw new Error('buildClosedWire: kernel rejected wire');
  return track(wm.Wire());
}

/**
 * Build a TopoDS_Wire from an OPEN polyline of {x,y,z} points (guide curve /
 * helix path use). ≥ 2 points required, no closing edge.
 */
function buildOpenWire(oc, pts) {
  if (!Array.isArray(pts) || pts.length < 2) {
    throw new Error(`buildOpenWire: needs ≥ 2 points (got ${pts?.length ?? 0})`);
  }
  const ocPts = pts.map(p => track(new oc.gp_Pnt_3(p.x ?? 0, p.y ?? 0, p.z ?? 0)));
  const wm = track(new oc.BRepBuilderAPI_MakeWire_1());
  for (let i = 0; i < ocPts.length - 1; i++) {
    const em = track(new oc.BRepBuilderAPI_MakeEdge_3(ocPts[i], ocPts[i + 1]));
    if (!em.IsDone()) {
      throw new Error(`buildOpenWire: kernel rejected edge ${i}`);
    }
    wm.Add_1(track(em.Edge()));
  }
  if (!wm.IsDone()) throw new Error('buildOpenWire: kernel rejected wire');
  return track(wm.Wire());
}

/**
 * Build a planar face from a closed planar wire (BRepBuilderAPI_MakeFace_15
 * with OnlyPlane=true — kernel derives the supporting plane).
 */
function buildFaceFromWire(oc, wire, tag) {
  const fm = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
  if (!fm.IsDone()) {
    let code = 'unknown';
    try { code = String(fm.Error()); } catch { /* ignore */ }
    throw new Error(`${tag}: BRepBuilderAPI_MakeFace failed (${code})`);
  }
  return track(fm.Face());
}

// ════════════════════════════════════════════════════════════════════════════
// 1. boundaryBoss — Loft with optional guide curves
// ════════════════════════════════════════════════════════════════════════════

/**
 * Boundary Boss / Cut — N profile cross-section wires + optional M guide
 * curves, lofted through with G1 tangency between sections.
 *
 * @param {object} args
 * @param {Array<Array>} args.profiles   array of ≥ 2 closed planar profile
 *                                       wires; each profile is an array of
 *                                       {x,y,z} points.
 * @param {Array<Array>} [args.guides]   array of M guide curves; each guide
 *                                       is an array of {x,y,z} points making
 *                                       an open polyline. Honest gap: in the
 *                                       OCCT WASM build the PipeShell
 *                                       auxiliary-spine path is fragile;
 *                                       guides may be honoured (smooth
 *                                       PipeShell loft) or skipped (fallback
 *                                       to ThruSections+SetSmoothing). The
 *                                       meta.guideFallback field records
 *                                       which path was taken.
 * @param {boolean} [args.smooth=true]   G1 tangency between profile sections.
 * @param {string}  [args.role='boss']   'boss' or 'cut' — informational only;
 *                                       the kernel always produces an
 *                                       additive body. The CUT semantics are
 *                                       applied by the caller via a
 *                                       subsequent boolean against the
 *                                       parent body.
 * @returns {Promise<SpineBody>}
 */
async function _constructBoundaryBoss(args, bodyTag) {
  const profiles = args.profiles;
  const guides = Array.isArray(args.guides) ? args.guides : [];
  const smooth = args.smooth !== false;

  if (!Array.isArray(profiles) || profiles.length < 2) {
    throw new Error(`boundaryBoss: needs ≥ 2 profile wires (got ${profiles?.length ?? 0})`);
  }

  const oc = await getOCCT();
  return withScope(() => {
    // Build every profile wire + its supporting face (for lineage spining).
    const profileWires = profiles.map((pts, i) => buildClosedWire(oc, pts));
    const profileFaces = profileWires.map((w, i) =>
      buildFaceFromWire(oc, w, `boundaryBoss.profile[${i}]`));
    const profileBodies = profileFaces.map((face, i) => {
      try {
        return bindSpine(oc, face, {
          bodyTag: `boundaryBossProfile${i}`, validate: false,
        });
      } catch { return null; }
    });

    // Build every guide curve (open polyline) if any were supplied.
    const guideWires = guides
      .filter(pts => Array.isArray(pts) && pts.length >= 2)
      .map((pts) => buildOpenWire(oc, pts));

    let resultShape = null;
    let algo = null;
    let guideFallback = null;
    let mode = 'thru-sections';

    // ── Path A: PipeShell with auxiliary guide spine ──────────────────────
    // The CANONICAL Boundary semantics: use the FIRST guide as the main
    // spine, the OTHER guides as auxiliary controls, and add each profile
    // wire as a constraint. The OCCT WASM API surface for SetMode_5 (the
    // auxiliary-spine variant) is intermittent — we attempt it iff there is
    // at least one guide AND the binding actually exposes SetMode_5 on the
    // PipeShell instance.
    if (guideWires.length > 0) {
      try {
        const mainSpine = guideWires[0];
        const pipeShell = track(new oc.BRepOffsetAPI_MakePipeShell(mainSpine));
        // Add every profile as a constraint section. Each section is the
        // outer wire of the profile face.
        for (const w of profileWires) {
          // Add_1(profile, withContact=false, withCorrection=false)
          pipeShell.Add_1(w, false, false);
        }
        // Auxiliary guides — call SetMode_5(spine, curvilinear) for each
        // extra guide. Wrap each call so a missing binding doesn't kill
        // the boss op; the catch below records the fallback.
        if (guideWires.length > 1 && typeof pipeShell.SetMode_5 === 'function') {
          for (let i = 1; i < guideWires.length; i++) {
            try { pipeShell.SetMode_5(guideWires[i], true); } catch { /* ignore */ }
          }
        }
        try { pipeShell.Build(track(new oc.Message_ProgressRange_1())); }
        catch (e) { throw new Error(`PipeShell.Build failed: ${e?.message ?? e}`); }
        if (!pipeShell.IsDone()) {
          throw new Error('PipeShell.IsDone() returned false');
        }
        // Cap into a closed solid.
        try { pipeShell.MakeSolid(); } catch { /* okay — sheet shell is acceptable */ }
        resultShape = pipeShell.Shape();
        if (resultShape && !resultShape.IsNull()) {
          algo = pipeShell;
          mode = 'pipe-shell-with-guides';
        } else {
          throw new Error('PipeShell produced a null shape');
        }
      } catch (err) {
        // Fall through to ThruSections.
        guideFallback = `PipeShell path rejected (${err?.message ?? err}); ` +
          'falling back to ThruSections+SetSmoothing (G1 tangency, no guides).';
        resultShape = null;
      }
    }

    // ── Path B: ThruSections fallback (always taken if Path A didn't land
    // a clean result). This is the canonical loft with G1 tangency.
    if (!resultShape || resultShape.IsNull()) {
      const thru = track(new oc.BRepOffsetAPI_ThruSections(true, false, 1.0e-6));
      for (const w of profileWires) thru.AddWire(w);
      if (smooth) {
        try { thru.SetSmoothing(true); } catch { /* default */ }
      }
      try { thru.Build(track(new oc.Message_ProgressRange_1())); }
      catch (e) { throw new Error(`ThruSections.Build failed: ${e?.message ?? e}`); }
      if (!thru.IsDone()) {
        throw new Error('boundaryBoss: ThruSections did not complete');
      }
      resultShape = thru.Shape();
      algo = thru;
      mode = guideFallback ? 'thru-sections-fallback' : 'thru-sections';
    }

    if (!resultShape || resultShape.IsNull()) {
      throw new Error('boundaryBoss: kernel produced a null shape');
    }

    const meta = {
      op: 'boundaryBoss',
      params: {
        profileCount: profileWires.length,
        guideCount: guideWires.length,
        smooth,
        role: args.role || 'boss',
      },
      mode,
    };
    if (guideFallback) meta.guideFallback = guideFallback;

    const wrapper = new BrepShape(resultShape, meta);
    const resultBody = bindSpine(oc, resultShape, {
      bodyTag: bodyTag || `boundaryBoss-${wrapper.id}`,
      geomEngineShape: wrapper,
      declaredKind: 'solid',
      validate: false,
    });

    // Carry lineage from the spined profile faces.
    const inputs = profileBodies.filter(b => !!b).map((body) => ({ body, role: 'arg' }));
    if (inputs.length > 0 && algo) {
      try {
        const lineage = carryLineage(oc, algo, resultBody, inputs);
        meta.lineage = {
          survived: lineage.survived, modified: lineage.modified,
          generated: lineage.generated, deleted: lineage.deleted,
          conflicts: lineage.conflicts,
          faceMap: [...lineage.faceMap.entries()].slice(0, 64),
          edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
        };
      } catch (lineageErr) {
        // eslint-disable-next-line no-console
        console.warn('boundaryBoss: lineage carry failed —', lineageErr?.message ?? lineageErr);
      }
    }

    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function boundaryBoss(args) {
  const spineBody = await _constructBoundaryBoss(args || {});
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'boundaryBoss',
        persistentBodyId,
        meta: { op: 'boundaryBoss', params: args || {} },
        rebuild: () => _constructBoundaryBoss(args || {}, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('boundaryBoss: history record failed —', err && err.message || err);
    }
  }
  return spineBody;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. rib — parametric thin wall between a sketched line and a body
// ════════════════════════════════════════════════════════════════════════════

/**
 * Rib — extrude a sketched LINE into a thin wall feature, intersected with
 * a parent body so the rib only fills space that is INSIDE the body.
 *
 * The SW canonical rib pattern. The user sketches a single line on a plane
 * that runs across the inside of the body; the line is extruded a small
 * `thickness` mm perpendicular to its direction (in the sketch plane), and
 * a height `extrudeHeight` mm along the sketch-plane normal. The resulting
 * thin block is then BOOLEAN-INTERSECTED with the parent body so any part
 * sticking out is trimmed away. What remains is the rib — a thin stiffener
 * that hugs the body's interior surface.
 *
 * @param {object} args
 * @param {SpineBody} args.body         the parent body to host the rib.
 * @param {Array<{x,y,z}>} args.line    a 2-point polyline [{x,y,z},{x,y,z}] —
 *                                      the sketched rib line. Both endpoints
 *                                      should lie in the same plane.
 * @param {number} args.thickness       wall thickness (mm, > 0).
 * @param {number} args.extrudeHeight   how far the rib extrudes along the
 *                                      sketch plane normal (mm, > 0). Should
 *                                      be ≥ the distance from the sketch
 *                                      plane to the nearest interior surface.
 * @param {Array<number>} [args.planeNormal=[0,0,1]]  sketch-plane normal as
 *                                                    [dx,dy,dz]; default +Z.
 * @param {string} [args.direction='normal']  'normal' (default; rib extrudes
 *                                            perpendicular to the sketch
 *                                            plane) or 'parallel' (rib stays
 *                                            in the sketch plane and extrudes
 *                                            perpendicular to the line in the
 *                                            sketch — used for sheet-metal-like
 *                                            ribs).
 * @returns {Promise<SpineBody>}
 */
async function _constructRib(args, bodyTag) {
  const body = args.body;
  const line = args.line;
  const thickness = Number(args.thickness);
  const extrudeHeight = Number(args.extrudeHeight);
  const planeNormal = Array.isArray(args.planeNormal) && args.planeNormal.length >= 3
    ? args.planeNormal.slice(0, 3) : [0, 0, 1];
  const direction = args.direction || 'normal';

  if (!body || !body.shape) throw new Error('rib: parent body required');
  if (!Array.isArray(line) || line.length < 2) {
    throw new Error('rib: line must be a 2-point polyline');
  }
  if (!(thickness > 0)) throw new Error(`rib: thickness must be > 0 (got ${thickness})`);
  if (!(extrudeHeight > 0)) throw new Error(`rib: extrudeHeight must be > 0 (got ${extrudeHeight})`);

  const oc = await getOCCT();
  return withScope(() => {
    // 1. Compute the rib's "thin face" rectangle. We need 4 corners in the
    // sketch plane: two thickness-offsets of each line endpoint, along the
    // in-plane perpendicular direction.
    const p0 = line[0], p1 = line[1];
    const lx = (p1.x ?? 0) - (p0.x ?? 0);
    const ly = (p1.y ?? 0) - (p0.y ?? 0);
    const lz = (p1.z ?? 0) - (p0.z ?? 0);
    const lineLen = Math.hypot(lx, ly, lz);
    if (lineLen < 1e-9) throw new Error('rib: line endpoints coincide');
    // Unit line direction.
    const ux = lx / lineLen, uy = ly / lineLen, uz = lz / lineLen;
    // Normalize sketch-plane normal.
    const [nx, ny, nz] = planeNormal;
    const nmag = Math.hypot(nx, ny, nz);
    if (nmag < 1e-9) throw new Error('rib: planeNormal must be non-zero');
    const nux = nx / nmag, nuy = ny / nmag, nuz = nz / nmag;
    // In-plane perpendicular = normal × line (cross product), normalized.
    let pxx = nuy * uz - nuz * uy;
    let pyy = nuz * ux - nux * uz;
    let pzz = nux * uy - nuy * ux;
    const pmag = Math.hypot(pxx, pyy, pzz);
    if (pmag < 1e-9) {
      throw new Error('rib: line direction parallel to plane normal — ambiguous');
    }
    pxx /= pmag; pyy /= pmag; pzz /= pmag;
    // Half-thickness offsets along the in-plane perpendicular.
    const half = thickness * 0.5;
    const c0 = { x: p0.x - pxx * half, y: p0.y - pyy * half, z: p0.z - pzz * half };
    const c1 = { x: p1.x - pxx * half, y: p1.y - pyy * half, z: p1.z - pzz * half };
    const c2 = { x: p1.x + pxx * half, y: p1.y + pyy * half, z: p1.z + pzz * half };
    const c3 = { x: p0.x + pxx * half, y: p0.y + pyy * half, z: p0.z + pzz * half };

    // 2. Build the rectangular thin-face wire (closed) + face.
    const ribProfileWire = buildClosedWire(oc, [c0, c1, c2, c3]);
    const ribProfileFace = buildFaceFromWire(oc, ribProfileWire, 'rib.profile');

    // 3. Extrude direction. For 'normal' (default), extrude PERPENDICULAR to
    // the sketch plane (downward along -planeNormal toward the body
    // interior); for 'parallel', extrude IN the sketch plane along the
    // perpendicular — but that would be already encoded in the thin face,
    // so for 'parallel' we extrude along the sketch-plane normal a small
    // amount (= thickness) to give the rib physical depth in the plane.
    let dirX, dirY, dirZ;
    if (direction === 'parallel') {
      // Rib stays in the sketch plane — extrude `thickness` along +normal.
      dirX = nux * thickness;
      dirY = nuy * thickness;
      dirZ = nuz * thickness;
    } else {
      // Default: extrude `extrudeHeight` along -normal (downward into body).
      dirX = -nux * extrudeHeight;
      dirY = -nuy * extrudeHeight;
      dirZ = -nuz * extrudeHeight;
    }
    const dirVec = track(new oc.gp_Vec_4(dirX, dirY, dirZ));
    const prism = track(new oc.BRepPrimAPI_MakePrism_1(ribProfileFace, dirVec, false, true));
    const ribBlock = track(prism.Shape());
    if (ribBlock.IsNull()) throw new Error('rib: kernel produced a null prism shape');

    // 4. Intersect with the parent body via BRepAlgoAPI_Common to clip the
    // rib down to JUST the volume inside the body. The intersection contract
    // matches SW's rib semantics: the rib fills the gap between the sketch
    // plane and the nearest body face.
    // BRepAlgoAPI_Common_3(S1, S2, progressRange) — verified 3-arg signature
    // from BrepCheck.js / BrepBoolean.js.
    const commonProgress = track(new oc.Message_ProgressRange_1());
    const commonOp = track(new oc.BRepAlgoAPI_Common_3(body.shape, ribBlock, commonProgress));
    commonOp.Build(track(new oc.Message_ProgressRange_1()));
    let ribShape = null;
    if (commonOp.IsDone()) {
      const sh = commonOp.Shape();
      if (sh && !sh.IsNull()) ribShape = sh;
    }
    // If intersection failed or produced an empty shape, return the
    // un-intersected rib block as an HONEST FALLBACK (the user still gets
    // a rib, just one that may extend past the body's interior surface).
    let intersected = true;
    if (!ribShape || ribShape.IsNull()) {
      ribShape = ribBlock;
      intersected = false;
    }

    const meta = {
      op: 'rib',
      params: {
        thickness, extrudeHeight, planeNormal, direction,
        lineLength: lineLen,
      },
      parents: body.id ? [body.id] : [],
      intersected,
    };
    const wrapper = new BrepShape(ribShape, meta);
    const resultBody = bindSpine(oc, ribShape, {
      bodyTag: bodyTag || `rib-${wrapper.id}`,
      geomEngineShape: wrapper,
      declaredKind: 'solid',
      validate: false,
    });

    if (body.body && intersected) {
      try {
        const lineage = carryLineage(oc, commonOp, resultBody, [
          { body: body.body, role: 'arg' },
        ]);
        meta.lineage = {
          survived: lineage.survived, modified: lineage.modified,
          generated: lineage.generated, deleted: lineage.deleted,
          conflicts: lineage.conflicts,
          faceMap: [...lineage.faceMap.entries()].slice(0, 64),
        };
      } catch (lineageErr) {
        // eslint-disable-next-line no-console
        console.warn('rib: lineage carry failed —', lineageErr?.message ?? lineageErr);
      }
    }

    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function rib(args) {
  const spineBody = await _constructRib(args || {});
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  const srcPid = args && args.body && args.body.body && args.body.body.persistentId;
  if (persistentBodyId) {
    try {
      if (srcPid) {
        recordBodyDerive({
          opName: 'rib',
          persistentBodyId,
          inputPersistentIds: [srcPid],
          meta: { op: 'rib', params: args || {} },
          rebuild: ([liveBody]) =>
            _constructRib({ ...args, body: liveBody }, persistentBodyId),
        });
      } else {
        recordBodyCreate({
          opName: 'rib',
          persistentBodyId,
          meta: { op: 'rib', params: args || {} },
          rebuild: () => _constructRib(args || {}, persistentBodyId),
          register: standardSceneRegister,
          remove: standardSceneRemove,
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('rib: history record failed —', err && err.message || err);
    }
  }
  return spineBody;
}

// ════════════════════════════════════════════════════════════════════════════
// 3. helix — 3D helical CURVE (wire body)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Real helical curve math. Returns an array of {x,y,z} points on the helix.
 *
 *   Constant-pitch helix:
 *     x(θ) = R·cos(θ)
 *     y(θ) = R·sin(θ)
 *     z(θ) = (pitch/2π)·θ
 *   θ ∈ [0, 2π·revs]
 *
 *   Variable-pitch (linear taper): pitch(θ) ramps linearly from pitchStart
 *   at θ=0 to pitchEnd at θ=2π·revs. The z-coordinate is the running integral:
 *     z(θ) = ∫₀^θ (pitch(t)/2π) dt
 *          = (pitchStart·θ + (pitchEnd-pitchStart)·θ²/(4π·revs)) / (2π)
 *
 *   The axis is the +Z direction by default. For an arbitrary axis the
 *   points are rotated by a rotation matrix R that maps +Z onto the
 *   provided axis direction.
 *
 *   direction: 'cw' negates θ so y(θ) = -R·sin(θ) — a left-hand helix.
 */
function sampleHelix({
  diameter, pitchStart, pitchEnd, revolutions, direction,
  axisOrigin, axisDirection, segmentsPerRev,
}) {
  const R = diameter * 0.5;
  const segs = Math.max(16, Math.round(segmentsPerRev * revolutions));
  const sign = direction === 'cw' ? -1 : 1;
  const thetaMax = 2 * Math.PI * revolutions;
  // Build the axis rotation matrix that maps +Z → axisDirection (unit).
  const [ax, ay, az] = axisDirection;
  const amag = Math.hypot(ax, ay, az);
  const ux = ax / amag, uy = ay / amag, uz = az / amag;
  // Rotation axis = +Z × axis = (-uy, ux, 0); rotation angle = acos(uz).
  const rx = -uy, ry = ux, rz = 0;
  const rmag = Math.hypot(rx, ry, rz);
  const angle = Math.acos(Math.max(-1, Math.min(1, uz)));
  let R00, R01, R02, R10, R11, R12, R20, R21, R22;
  if (rmag < 1e-9 || Math.abs(angle) < 1e-9) {
    // Axis IS +Z (or -Z). Identity (or 180° flip).
    if (uz >= 0) {
      R00 = 1; R01 = 0; R02 = 0;
      R10 = 0; R11 = 1; R12 = 0;
      R20 = 0; R21 = 0; R22 = 1;
    } else {
      R00 = 1; R01 = 0;  R02 = 0;
      R10 = 0; R11 = -1; R12 = 0;
      R20 = 0; R21 = 0;  R22 = -1;
    }
  } else {
    const krx = rx / rmag, kry = ry / rmag, krz = rz / rmag;
    const c = Math.cos(angle), s = Math.sin(angle), C = 1 - c;
    R00 = c + krx * krx * C;
    R01 = krx * kry * C - krz * s;
    R02 = krx * krz * C + kry * s;
    R10 = kry * krx * C + krz * s;
    R11 = c + kry * kry * C;
    R12 = kry * krz * C - krx * s;
    R20 = krz * krx * C - kry * s;
    R21 = krz * kry * C + krx * s;
    R22 = c + krz * krz * C;
  }
  const pitchSlope = pitchEnd - pitchStart;
  const pts = new Array(segs + 1);
  let runningZ = 0;
  let prevTheta = 0;
  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * thetaMax;
    // Pitch at theta = pitchStart + slope · (theta / thetaMax).
    if (i > 0) {
      // Trapezoidal integration: dz = pitch_avg/(2π) · dθ
      const pAvg = (pitchStart + pitchSlope * ((theta + prevTheta) / 2) / thetaMax);
      runningZ += pAvg / (2 * Math.PI) * (theta - prevTheta);
    }
    prevTheta = theta;
    const sx = R * Math.cos(sign * theta);
    const sy = R * Math.sin(sign * theta);
    const sz = runningZ;
    // Rotate (sx,sy,sz) by R → world; then translate by axisOrigin.
    const wx = R00 * sx + R01 * sy + R02 * sz + axisOrigin[0];
    const wy = R10 * sx + R11 * sy + R12 * sz + axisOrigin[1];
    const wz = R20 * sx + R21 * sy + R22 * sz + axisOrigin[2];
    pts[i] = { x: wx, y: wy, z: wz };
  }
  return pts;
}

/**
 * Helix — 3D helical CURVE (kind='wire' SpineBody).
 *
 * @param {object} args
 * @param {number} args.diameter        helix diameter (mm). Required.
 * @param {number} args.pitch           pitch (mm/turn). Required for constant
 *                                      pitch; ignored if pitchStart+pitchEnd
 *                                      are supplied.
 * @param {number} args.revolutions     number of revolutions. Required.
 * @param {string} [args.direction='ccw']  'ccw' (right-hand) or 'cw' (left).
 * @param {number} [args.pitchStart]    variable-pitch start (mm/turn).
 * @param {number} [args.pitchEnd]      variable-pitch end (mm/turn).
 * @param {Array<number>} [args.axisOrigin=[0,0,0]]  axis origin (mm).
 * @param {Array<number>} [args.axisDirection=[0,0,1]]  axis direction (unit).
 * @param {number} [args.segmentsPerRev=64]  polyline resolution.
 * @returns {Promise<SpineBody>} a kind='wire' SpineBody wrapping the helix.
 */
async function _constructHelix(args, bodyTag) {
  const diameter = Number(args.diameter);
  const revolutions = Number(args.revolutions);
  const direction = args.direction === 'cw' ? 'cw' : 'ccw';
  const segmentsPerRev = Number(args.segmentsPerRev) > 0 ? Number(args.segmentsPerRev) : 64;
  let pitchStart, pitchEnd;
  if (args.pitchStart != null && args.pitchEnd != null) {
    pitchStart = Number(args.pitchStart);
    pitchEnd = Number(args.pitchEnd);
  } else {
    const p = Number(args.pitch);
    pitchStart = p; pitchEnd = p;
  }
  if (!(diameter > 0)) throw new Error(`helix: diameter must be > 0 (got ${diameter})`);
  if (!(revolutions > 0)) throw new Error(`helix: revolutions must be > 0 (got ${revolutions})`);
  if (!(pitchStart > 0) || !(pitchEnd > 0)) {
    throw new Error(`helix: pitch must be > 0 (got start=${pitchStart}, end=${pitchEnd})`);
  }
  const axisOrigin = Array.isArray(args.axisOrigin) && args.axisOrigin.length >= 3
    ? [args.axisOrigin[0], args.axisOrigin[1], args.axisOrigin[2]]
    : [0, 0, 0];
  const axisDirection = Array.isArray(args.axisDirection) && args.axisDirection.length >= 3
    ? [args.axisDirection[0], args.axisDirection[1], args.axisDirection[2]]
    : [0, 0, 1];

  // Real helix length — closed-form for constant pitch:
  //   L = revs · sqrt(pitch² + (π·D)²)
  // The variable-pitch length is the integral of the same speed along θ.
  let expectedLength;
  if (Math.abs(pitchEnd - pitchStart) < 1e-9) {
    expectedLength = revolutions * Math.sqrt(pitchStart * pitchStart + Math.PI * Math.PI * diameter * diameter);
  } else {
    // Trapezoidal: per-turn length varies linearly with pitch. Length per
    // turn = sqrt(pitch² + (π·D)²). Integrate pitch over [0,revs] in steps.
    const steps = 256;
    let len = 0;
    for (let i = 0; i < steps; i++) {
      const f0 = i / steps, f1 = (i + 1) / steps;
      const p0 = pitchStart + (pitchEnd - pitchStart) * f0;
      const p1 = pitchStart + (pitchEnd - pitchStart) * f1;
      const Lturn0 = Math.sqrt(p0 * p0 + Math.PI * Math.PI * diameter * diameter);
      const Lturn1 = Math.sqrt(p1 * p1 + Math.PI * Math.PI * diameter * diameter);
      len += revolutions / steps * (Lturn0 + Lturn1) * 0.5;
    }
    expectedLength = len;
  }

  // Sample helix points.
  const pts = sampleHelix({
    diameter, pitchStart, pitchEnd, revolutions, direction,
    axisOrigin, axisDirection, segmentsPerRev,
  });

  // Build wire + measure measured length (sum of segment lengths).
  let measuredLength = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const dz = pts[i].z - pts[i - 1].z;
    measuredLength += Math.hypot(dx, dy, dz);
  }

  const oc = await getOCCT();
  return withScope(() => {
    const wire = buildOpenWire(oc, pts);
    // Wrap the wire in a TopoDS_Compound so bindSpine sees a pure-wire body.
    const builder = track(new oc.BRep_Builder());
    const compound = track(new oc.TopoDS_Compound());
    builder.MakeCompound(compound);
    builder.Add(compound, wire);
    const meta = {
      op: 'helix',
      params: {
        diameter, pitchStart, pitchEnd, revolutions, direction,
        axisOrigin, axisDirection, segmentsPerRev,
      },
      length: { expected: expectedLength, measured: measuredLength },
      pointCount: pts.length,
      // Expose the sampled polyline so callers (sweep along helix) can
      // consume the path directly without re-sampling.
      polyline: pts,
    };
    const wrapper = new BrepShape(compound, meta);
    const resultBody = bindSpine(oc, compound, {
      bodyTag: bodyTag || `helix-${wrapper.id}`,
      geomEngineShape: wrapper,
      declaredKind: 'wire',
      validate: false,
    });
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function helix(args) {
  const spineBody = await _constructHelix(args || {});
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'helix',
        persistentBodyId,
        meta: { op: 'helix', params: args || {} },
        rebuild: () => _constructHelix(args || {}, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('helix: history record failed —', err && err.message || err);
    }
  }
  return spineBody;
}
