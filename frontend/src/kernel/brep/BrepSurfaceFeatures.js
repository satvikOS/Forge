/**
 * ArchDisc Kernel — Surface feature ops (UX Tier 4, focused).
 *
 * Sheet-body variants of the SP-6 solid feature ops `extrudeProfile` /
 * `revolveProfile`. Where the solid variants build a closed planar FACE
 * from the input wire and then prism/revolve THAT face (producing a solid
 * with caps), the surface variants prism / revolve the **WIRE itself** —
 * the OCCT `BRepPrimAPI_MakePrism_1` / `BRepPrimAPI_MakeRevol_1` swept-
 * shape contract: when the seed is a TopoDS_Wire (not a face), the
 * algorithm sweeps each EDGE of the wire into a lateral face (a ruled
 * / surface-of-revolution patch) and joins them into a SHELL. No end
 * caps are added — the result is a non-watertight sheet body.
 *
 * This is the SolidWorks "Extruded Surface" / "Revolved Surface" feature
 * pair (course synthesis Tier 4 #37 / #38) — a NAMED surface op that
 * produces ONLY the side walls of an extrude/revolve. Real production
 * uses: HVAC/ductwork transition pieces (this campaign's bespoke), boat-
 * hull lofting precursors, sheet-metal flange-precursor surfaces, and
 * any workflow that builds the boundary of a future solid via surface
 * ops + `stitchFaces`.
 *
 * Lineage contract (carried via `carryLineage` on the algo's
 * `Modified` / `Generated` / `IsDeleted` history surface):
 *   - each profile EDGE (the input wire's edges) → one lateral FACE on
 *     the result via `Generated(edge_i)`. Each lateral face's
 *     `derivedFrom` records the seed edge — the same provenance
 *     contract `extrudeProfile`/`revolveProfile` deliver, just without
 *     the cap-face binding.
 *   - profile VERTICES → lateral EDGES via `Generated(vertex_i)`.
 *
 * Result kind: explicitly declared `sheet` to `bindSpine`. The binder
 * derives the topological kind from `isWatertight()`/`hasFreeBoundary()`
 * — the swept shell of a wire is non-watertight (the wire is open or
 * closed, but the resulting shell never has caps), so the declared kind
 * matches what topology would derive. The binder records any mismatch
 * in `diagnostics.kindMismatch` so a caller can detect (e.g.) a self-
 * intersecting revolve that accidentally closed.
 *
 * Inputs:
 *   - `wire` — same coercion as `extrudeProfile`/`revolveProfile` (raw
 *     TopoDS_Wire, `{wire}` carrier, or `[{x,y,z}, …]` polyline points).
 *     For surfaces, the wire MAY be open (a polyline / open profile) —
 *     unlike the solid variants which require a closed wire to build a
 *     face. We do not enforce closure here.
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

/**
 * Internal — coerce the `wire` input into a TopoDS_Wire. Mirrors the
 * `coerceWire` helper in `BrepFeatures.js` but does NOT require the wire
 * to be closed: surface ops accept open profiles (a polyline produces a
 * swept ruled-surface strip).
 *
 * Accepts:
 *   • raw TopoDS_Wire / TopoDS_Edge (a lone edge is promoted to a wire)
 *   • `{wire: TopoDS_Wire}` carrier
 *   • Array of {x,y,z} points — built into an OPEN polyline if the
 *     first/last don't coincide, or a closed polygon if they do.
 */
function _coerceWireOpenOrClosed(oc, input, tag) {
  if (!input) throw new Error(`${tag}: wire input is null/undefined`);
  if (typeof input.ShapeType === 'function') {
    const t = input.ShapeType();
    if (t === oc.TopAbs_ShapeEnum.TopAbs_WIRE) return input;
    if (t === oc.TopAbs_ShapeEnum.TopAbs_EDGE) {
      const wm = track(new oc.BRepBuilderAPI_MakeWire_2(track(oc.TopoDS.Edge_1(input))));
      if (!wm.IsDone()) throw new Error(`${tag}: failed to wrap edge in wire`);
      return track(wm.Wire());
    }
    throw new Error(`${tag}: input shape type ${t} is neither WIRE nor EDGE`);
  }
  if (input.wire && typeof input.wire.ShapeType === 'function') {
    return _coerceWireOpenOrClosed(oc, input.wire, tag);
  }
  if (Array.isArray(input)) {
    if (input.length < 2) {
      throw new Error(`${tag}: points array needs ≥ 2 points (got ${input.length})`);
    }
    // Detect closure: if last≈first within 1e-6 mm, build a closed polygon.
    const first = input[0], last = input[input.length - 1];
    const dx = (last.x ?? 0) - (first.x ?? 0);
    const dy = (last.y ?? 0) - (first.y ?? 0);
    const dz = (last.z ?? 0) - (first.z ?? 0);
    const closed = (dx * dx + dy * dy + dz * dz) < 1e-12;
    const ring = closed ? input.slice(0, input.length - 1) : input.slice();
    const ocPts = ring.map(p =>
      track(new oc.gp_Pnt_3(p.x ?? 0, p.y ?? 0, p.z ?? 0)));
    const wireMaker = track(new oc.BRepBuilderAPI_MakeWire_1());
    const segCount = closed ? ocPts.length : ocPts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = ocPts[i];
      const b = ocPts[(i + 1) % ocPts.length];
      const em = track(new oc.BRepBuilderAPI_MakeEdge_3(a, b));
      if (!em.IsDone()) throw new Error(`${tag}: edge ${i} rejected (degenerate?)`);
      wireMaker.Add_1(track(em.Edge()));
    }
    if (!wireMaker.IsDone()) {
      throw new Error(`${tag}: kernel rejected wire (could not chain edges)`);
    }
    return track(wireMaker.Wire());
  }
  throw new Error(`${tag}: unknown wire input form (${typeof input})`);
}

/**
 * Extruded Surface — prism the wire's EDGES along a direction, producing
 * a SHEET body of lateral faces (no end caps). SW "Extruded Surface".
 *
 * Algorithm: `BRepPrimAPI_MakePrism_1(wire, gp_Vec, Copy=false,
 * Canonize=true)`. When the seed is a wire, the prism builder sweeps each
 * edge into a ruled lateral face and assembles them into a shell. The
 * result kind is explicitly declared 'sheet'.
 *
 * @param {object|Array} wire  open or closed planar wire | points array
 * @param {number}       depth prism length (mm, > 0)
 * @param {object}       [opts]
 * @param {number[]}     [opts.direction] [dx,dy,dz] override (default +Z).
 *                                         Magnitude ignored; depth controls
 *                                         length.
 * @returns {Promise<SpineBody>}  kind='sheet'
 */
async function _constructExtrudedSurface(wire, depth, opts, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const profileWire = _coerceWireOpenOrClosed(oc, wire, 'extrudedSurface');
    // Spine the profile wire into a temporary body so its edges +
    // vertices have persistent ids. Per-edge ids carry through onto
    // lateral faces via `Generated(edge_i)`.
    const profileBody = bindSpine(oc, profileWire, {
      bodyTag: 'extrudedSurface-profile', validate: false,
    });
    // Prism direction. Default +Z scaled by depth. Caller direction is
    // normalised and scaled to depth.
    let dirX = 0, dirY = 0, dirZ = depth;
    if (opts && Array.isArray(opts.direction) && opts.direction.length >= 3) {
      const dx = opts.direction[0], dy = opts.direction[1], dz = opts.direction[2];
      const mag = Math.hypot(dx, dy, dz);
      if (mag < 1e-12) throw new Error('extrudedSurface: direction must be non-zero');
      dirX = (dx / mag) * depth;
      dirY = (dy / mag) * depth;
      dirZ = (dz / mag) * depth;
    }
    const dirVec = track(new oc.gp_Vec_4(dirX, dirY, dirZ));
    // Sweep the WIRE (not a face) → shell of lateral faces. No caps.
    const maker = track(new oc.BRepPrimAPI_MakePrism_1(profileWire, dirVec, false, true));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('extrudedSurface: kernel produced a null shape');
    const meta = { op: 'extrudedSurface', params: { depth, opts } };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `extrudedSurface-${wrapper.id}`,
      geomEngineShape: wrapper,
      // Declared 'sheet' — the swept shell of a wire has free boundary
      // (top + bottom open boundaries), so isWatertight() → false. The
      // binder records any mismatch in diagnostics.kindMismatch.
      declaredKind: 'sheet',
      validate: false,
    });
    const lineage = carryLineage(oc, maker, resultBody, [
      { body: profileBody, role: 'arg' },
    ]);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
    };
    meta.profileEdgeIds = profileBody.edges().map(e => e.persistentId);
    meta.profileVertexIds = profileBody.vertices().map(v => v.persistentId);
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function extrudedSurface(wire, depth, opts = {}) {
  if (!(depth > 0)) {
    throw new Error(`extrudedSurface: depth must be positive (got ${depth})`);
  }
  const spineBody = await _constructExtrudedSurface(wire, depth, opts);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'extrudedSurface',
        persistentBodyId,
        meta: { op: 'extrudedSurface', params: { depth, opts } },
        rebuild: () => _constructExtrudedSurface(wire, depth, opts, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('extrudedSurface: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}

/**
 * Revolved Surface — revolve the wire's EDGES around an axis to produce
 * a SHEET body of surface-of-revolution faces (no end caps). SW
 * "Revolved Surface".
 *
 * Algorithm: `BRepPrimAPI_MakeRevol_1(wire, gp_Ax1, angleRad, Copy=false)`.
 * When the seed is a wire, each edge revolves into a surface-of-revolution
 * face (cone, cylinder, sphere, or general SOR depending on the edge's
 * curve type); the faces join into a shell. Result kind='sheet'.
 *
 * @param {object|Array} wire  open or closed planar wire | points array
 * @param {object}       axis  { origin: [x,y,z], direction: [dx,dy,dz] }
 * @param {number}       angle revolution angle in degrees, (0, 360]
 * @returns {Promise<SpineBody>}  kind='sheet'
 */
async function _constructRevolvedSurface(wire, axis, angle, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const profileWire = _coerceWireOpenOrClosed(oc, wire, 'revolvedSurface');
    const profileBody = bindSpine(oc, profileWire, {
      bodyTag: 'revolvedSurface-profile', validate: false,
    });
    const ox = axis.origin?.[0] ?? 0;
    const oy = axis.origin?.[1] ?? 0;
    const oz = axis.origin?.[2] ?? 0;
    const dx = axis.direction?.[0] ?? 0;
    const dy = axis.direction?.[1] ?? 0;
    const dz = axis.direction?.[2] ?? 1;
    const dmag = Math.hypot(dx, dy, dz);
    if (dmag < 1e-12) throw new Error('revolvedSurface: axis direction must be non-zero');
    const ocOrigin = track(new oc.gp_Pnt_3(ox, oy, oz));
    const ocDir = track(new oc.gp_Dir_4(dx / dmag, dy / dmag, dz / dmag));
    const ocAxis = track(new oc.gp_Ax1_2(ocOrigin, ocDir));
    const angleRad = (angle * Math.PI) / 180;
    // Revolve the WIRE (not a face) → shell of SOR faces. No caps.
    const maker = track(new oc.BRepPrimAPI_MakeRevol_1(profileWire, ocAxis, angleRad, false));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('revolvedSurface: kernel produced a null shape');
    const meta = { op: 'revolvedSurface', params: { axis, angle } };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `revolvedSurface-${wrapper.id}`,
      geomEngineShape: wrapper,
      declaredKind: 'sheet',
      validate: false,
    });
    const lineage = carryLineage(oc, maker, resultBody, [
      { body: profileBody, role: 'arg' },
    ]);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
    };
    meta.profileEdgeIds = profileBody.edges().map(e => e.persistentId);
    meta.profileVertexIds = profileBody.vertices().map(v => v.persistentId);
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function revolvedSurface(wire, axis, angle) {
  if (!axis || !Array.isArray(axis.direction)) {
    throw new Error('revolvedSurface: axis must be { origin: [x,y,z], direction: [dx,dy,dz] }');
  }
  if (!(angle > 0 && angle <= 360)) {
    throw new Error(`revolvedSurface: angle must be in (0, 360] degrees (got ${angle})`);
  }
  const spineBody = await _constructRevolvedSurface(wire, axis, angle);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'revolvedSurface',
        persistentBodyId,
        meta: { op: 'revolvedSurface', params: { axis, angle } },
        rebuild: () => _constructRevolvedSurface(wire, axis, angle, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('revolvedSurface: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}
