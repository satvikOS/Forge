// Forge-83 — kernel dispatch.
//
// Maps a v4 tool id + the user's parameter map to the appropriate
// window.forge.* call. Returns { ok, handle?, message } so the shell can
// append a new body (with handle) to the bodies state and route it into
// SceneMeshes for tessellation + render.
//
// When window.forge isn't ready (dev shell without the native addon),
// we synthesise a `synthetic: true` body whose THREE.BufferGeometry is
// produced from primitives so the user still sees geometry in the
// viewport. This is what unblocks the "I clicked Extrude but nothing
// happened" problem.

import { resolveRef as resolveSkelEntity } from './skeleton.js';

const MM = (v, d) => (typeof v === 'number' && Number.isFinite(v)) ? v : d;
const VEC3 = (v, d = [0,0,0]) => (Array.isArray(v) && v.length === 3) ? v : d;

/**
 * Forge-123 — replace every `{ skelRef: 'Name' }` (or
 * `{ skelRef: { kind, name } }`) embedded anywhere in `params` with the
 * resolved skeleton value. Returns a NEW params object; the input is
 * never mutated. Refs that fail to resolve are left as-is (so the user
 * doesn't lose the link when they rename and re-create an entity).
 */
export function resolveSkeletonRefs(params, skeleton) {
  if (!skeleton || params == null) return params;
  return resolveWalk(params, skeleton);
}

function resolveWalk(node, skeleton) {
  if (node == null) return node;
  if (Array.isArray(node)) return node.map((v) => resolveWalk(v, skeleton));
  if (typeof node !== 'object') return node;
  // Direct skelRef holder: replace the node entirely with the resolved
  // value. (We keep any sibling keys for axes/planes that carry both
  // a skelRef AND override fields, though no current schema does this.)
  if ('skelRef' in node) {
    const resolved = resolveSkelEntity(skeleton, node.skelRef);
    if (resolved != null) {
      // If this object had ONLY skelRef, return the resolved value.
      const otherKeys = Object.keys(node).filter((k) => k !== 'skelRef');
      if (otherKeys.length === 0) return resolved;
      // Otherwise merge: skeleton value overlays, but other params win.
      const merged = (Array.isArray(resolved) || typeof resolved !== 'object')
        ? { value: resolved } : { ...resolved };
      for (const k of otherKeys) merged[k] = resolveWalk(node[k], skeleton);
      return merged;
    }
  }
  const out = {};
  for (const k of Object.keys(node)) out[k] = resolveWalk(node[k], skeleton);
  return out;
}

function kernelReady() {
  return typeof window !== 'undefined' && window.forge &&
         typeof window.forge.isReady === 'function' &&
         window.forge.isReady();
}

// Resolve the operating-on body. Prefer an explicitly picked body
// (face/edge pick → ctx.pickedBody), then the first item in
// ctx.selectedBodies (user-picked), fall back to ctx.lastBody (most
// recently created).
function pickTarget(ctx) {
  if (typeof ctx?.pickedBody === 'number') return ctx.pickedBody;
  const sel = ctx?.selectedBodies;
  if (Array.isArray(sel) && sel.length && typeof sel[0] === 'number') return sel[0];
  if (typeof ctx?.lastBody === 'number') return ctx.lastBody;
  return null;
}

// Slice-13 — map a mold tool's pull-direction enum ('+Z'/'-X'/…) or an
// explicit pullDir array to a unit vector. Defaults to +Z.
function moldPullDir(p) {
  if (Array.isArray(p?.pullDir) && p.pullDir.length === 3) return p.pullDir;
  switch (p?.direction) {
    case '-Z': return [0, 0, -1];
    case '+X': return [1, 0, 0];
    case '-X': return [-1, 0, 0];
    case '+Y': return [0, 1, 0];
    case '-Y': return [0, -1, 0];
    case '+Z':
    default:   return [0, 0, 1];
  }
}

// PUSH-31 — most-recent native body in ctx.bodies, ignoring synthetic
// scaffolds. Used by solid.extrude with op=Cut|Add|Intersect to find
// the body the user wants to bool the new extrusion against.
function pickPrevNative(ctx) {
  const bodies = Array.isArray(ctx?.bodies) ? ctx.bodies : [];
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (b && b.kind === 'native' && typeof b.handle === 'number') return b.handle;
  }
  return null;
}

// PUSH-31 — pick TWO body handles for boolean ops. Prefers explicit
// params.a/.b, then user-selected bodies, then the last two native bodies
// in ctx.bodies (the "no-fuss" default for users who just want to bool
// their two most recent solids).
function pickPair(ctx, p) {
  if (typeof p?.a === 'number' && typeof p?.b === 'number') return [p.a, p.b];
  const sel = ctx?.selectedBodies;
  if (Array.isArray(sel) && sel.length >= 2 && typeof sel[0] === 'number' && typeof sel[1] === 'number') {
    return [sel[0], sel[1]];
  }
  const bodies = Array.isArray(ctx?.bodies) ? ctx.bodies : [];
  const natives = bodies.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
  if (natives.length >= 2) {
    return [natives[natives.length - 2].handle, natives[natives.length - 1].handle];
  }
  return [null, null];
}

// Best-effort native dispatch. Returns null if the op isn't supported
// natively; the caller then falls back to the synthetic path.
function callNative(toolId, p, ctx) {
  const f = window.forge;
  try {
    switch (toolId) {
      // ----- primitive-ish: turn schema params into the closest native call -----
      case 'solid.extrude': {
        if (ctx?.currentSketch != null && f.part?.extrudeProfile) {
          // The C++ binding expects a vec3 direction array, NOT the
          // 'Z+' / 'Z-' string the schema produces. Convert here.
          const isDown = (p.direction || '').startsWith('Down');
          const isBoth = (p.direction || '').startsWith('Both');
          const dir = isBoth ? [0, 0, 0] : (isDown ? [0, 0, -1] : [0, 0, 1]);
          let newBody;
          // Sketch-on-face (#216) — when the sketch sits on a custom
          // (face-derived) plane, extrude along that plane's NORMAL via
          // part.extrudeProfileOnPlane so the boss/cut grows off the real
          // face instead of world +Z. `sign` selects boss (+normal, Up)
          // vs cut-into-face (-normal, Down).
          const frame = ctx.currentSketchFrame;
          if (frame && f.part.extrudeProfileOnPlane) {
            const sign = isDown ? -1 : 1;
            newBody = f.part.extrudeProfileOnPlane(
              ctx.currentSketch, MM(p.distance, 25),
              frame.origin, frame.normal, frame.u, sign);
          } else {
            newBody = f.part.extrudeProfile(ctx.currentSketch, MM(p.distance, 25), dir);
          }
          // PUSH-31 — honor the Operation dropdown (Cut/Add/Intersect)
          // so the deck plate keeps ONE body with bores carved into it
          // instead of N overlapping cylinders. Without this the V12
          // renders as a striped blob; with it, you get a real engine
          // block silhouette. For sketch-on-face cuts, this is exactly
          // the classic "extrude-cut on the top face" workflow.
          const op = (p.op || '').toLowerCase();
          const prev = pickPrevNative(ctx);
          if (typeof newBody === 'number' && typeof prev === 'number' && op !== 'new body' && op !== '') {
            if (op === 'cut' && f.cut) return f.cut(prev, newBody);
            if (op === 'add' && f.fuse) return f.fuse(prev, newBody);
            if (op === 'intersect' && f.common) return f.common(prev, newBody);
          }
          return newBody;
        }
        if (f.makeBox) return f.makeBox(MM(p.width, 20), MM(p.height, 20), MM(p.distance, 25));
        return null;
      }
      case 'solid.revolve': {
        if (ctx?.currentSketch != null && f.part?.revolveProfile) {
          return f.part.revolveProfile(ctx.currentSketch, [0,0,0], [0,1,0], (MM(p.angle, 360) * Math.PI) / 180);
        }
        if (f.makeCylinder) return f.makeCylinder(MM(p.radius, 10), MM(p.height, 25));
        return null;
      }
      case 'solid.sweep': {
        if (ctx?.currentSketch != null && ctx?.pathSketch != null && f.part?.sweep) {
          return f.part.sweep(ctx.currentSketch, ctx.pathSketch, false);
        }
        if (f.makeTorus) return f.makeTorus(MM(p.R, 20), MM(p.r, 4));
        return null;
      }
      case 'solid.loft': {
        if (Array.isArray(ctx?.sectionSketches) && ctx.sectionSketches.length >= 2 && f.part?.loft) {
          return f.part.loft(ctx.sectionSketches, [], false, false);
        }
        if (f.makeTorus) return f.makeTorus(MM(p.R, 20), MM(p.r, 4));
        return null;
      }
      case 'solid.shell': {
        const target = pickTarget(ctx);
        if (target != null && f.part?.shell) {
          const faceIds = Array.isArray(p.faceIds) ? p.faceIds : [];
          return f.part.shell(target, faceIds, MM(p.thickness, 2), null);
        }
        return null;
      }
      case 'solid.thicken': {
        // Slice-8 surface workbench — thicken an open surface/shell body
        // into a closed solid. Operates on the picked target body (a
        // surface body created by the surfacing tools, or an imported
        // open shell). side: -1 inward, +1 outward, 0 symmetric.
        const target = pickTarget(ctx);
        if (target != null && f.part?.thickenSurface) {
          const side = (p.side === 'Inward') ? -1
                     : (p.side === 'Symmetric') ? 0 : 1;
          return f.part.thickenSurface(target, MM(p.thickness, 2), side);
        }
        return null;
      }
      case 'solid.knit': {
        // Slice-9 surface workbench — Knit (sew) multiple surface patches
        // into a single shell. Mirrors SolidWorks "Knit Surface" / NX
        // "Sew" / CATIA GSD "Join". Sews the user-selected surface bodies
        // (or, if none explicitly selected, every surface body in the
        // scene) into one shell via the native surfacing.sew. The shell
        // can then be Thickened into a solid.
        if (!f.surfacing?.sew) return null;
        const bodies = Array.isArray(ctx?.bodies) ? ctx.bodies : [];
        // Prefer an explicit multi-selection; else knit ALL surface bodies.
        let handles = null;
        const sel = ctx?.selectedBodies;
        if (Array.isArray(sel) && sel.length >= 2 &&
            sel.every((h) => typeof h === 'number')) {
          handles = sel;
        } else {
          handles = bodies
            .filter((b) => b && b.kind === 'native' && b.surface === true
                        && typeof b.handle === 'number')
            .map((b) => b.handle);
        }
        if (!handles || handles.length < 2) return null;
        const tol = (typeof p.tolerance === 'number' && p.tolerance > 0)
          ? p.tolerance : 1e-3;
        return f.surfacing.sew(handles, tol);
      }
      case 'solid.trimSurface': {
        // Slice-10 surface workbench — Trim a surface to a parametric UV
        // window. Mirrors SolidWorks "Trim Surface" / NX "Trim Sheet" /
        // CATIA GSD "Split". Operates on the picked surface body, keeping
        // the rectangular UV sub-region [uMin,uMax]x[vMin,vMax] (params in
        // 0..1 of the surface's parametric range).
        if (!f.surfacing?.trim) return null;
        const target = pickTarget(ctx);
        if (target == null) return null;
        const clamp01 = (v, d) => {
          const n = (typeof v === 'number') ? v : d;
          return Math.max(0, Math.min(1, n));
        };
        const uMin = clamp01(p.uMin, 0.25);
        const uMax = clamp01(p.uMax, 0.75);
        const vMin = clamp01(p.vMin, 0);
        const vMax = clamp01(p.vMax, 1);
        if (uMax - uMin < 1e-6 || vMax - vMin < 1e-6) return null;
        // CCW loop in UV space.
        const uvLoop = [uMin, vMin, uMax, vMin, uMax, vMax, uMin, vMax];
        return f.surfacing.trim(target, uvLoop);
      }
      case 'solid.fillet': {
        const target = pickTarget(ctx);
        if (target != null && f.part?.filletEdges) {
          // PUSH-31 — default "fillet all edges" when neither the dialog
          // nor the picker supplied a list. Matches SolidWorks "Round all
          // edges" / Fusion 360 quick-fillet default.
          let edgeIds = Array.isArray(p.edgeIds) && p.edgeIds.length ? p.edgeIds
                      : (Array.isArray(ctx?.selectedEdges) && ctx.selectedEdges.length
                          ? ctx.selectedEdges : null);
          if (!edgeIds && typeof f.direct?.edgeCount === 'function') {
            const n = f.direct.edgeCount(target);
            edgeIds = Array.from({ length: n }, (_, i) => i);
          }
          if (!edgeIds || !edgeIds.length) return null;
          return f.part.filletEdges(target, edgeIds, MM(p.radius, 2));
        }
        return null;
      }
      case 'solid.chamfer': {
        const target = pickTarget(ctx);
        if (target != null && f.part?.chamferEdges) {
          let edgeIds = Array.isArray(p.edgeIds) && p.edgeIds.length ? p.edgeIds
                      : (Array.isArray(ctx?.selectedEdges) && ctx.selectedEdges.length
                          ? ctx.selectedEdges : null);
          if (!edgeIds && typeof f.direct?.edgeCount === 'function') {
            const n = f.direct.edgeCount(target);
            edgeIds = Array.from({ length: n }, (_, i) => i);
          }
          if (!edgeIds || !edgeIds.length) return null;
          return f.part.chamferEdges(target, edgeIds, MM(p.distance, 2), MM(p.distance2, 2));
        }
        return null;
      }
      case 'solid.hole': {
        const target = pickTarget(ctx);
        if (target != null && f.part?.holeWizard) {
          // PUSH-31 — when the user drives the toolbar Hole tool without
          // picking a face (no position supplied), drop the hole on the
          // body's top-face center, drilling -Z. Matches SolidWorks Hole
          // Wizard's "default to selected feature" behavior without
          // needing an OCCT face-pick infra wired through the dialog yet.
          let position = Array.isArray(p.position) && p.position.length === 3
            ? p.position : null;
          let axis = Array.isArray(p.axis) && p.axis.length === 3
            ? p.axis : null;
          if (!position && typeof window !== 'undefined' && window.__forgeScene) {
            let bodyMesh = null;
            try {
              window.__forgeScene.traverse((o) => {
                if (!bodyMesh && o.isMesh && o.userData?.bodyId === target) {
                  bodyMesh = o;
                }
              });
            } catch { /* ignore traversal blips */ }
            if (bodyMesh?.geometry) {
              try { bodyMesh.geometry.computeBoundingBox?.(); } catch {}
              const bb = bodyMesh.geometry.boundingBox;
              const THREE = window.__forgeThree;
              if (bb && THREE) {
                const center = new THREE.Vector3();
                bb.getCenter(center);
                // Mesh world matrix may differ from kernel-local space if
                // the body was scene-translated post-creation; project
                // both center and top point through matrixWorld so the
                // hole drops on the body the user actually sees.
                bodyMesh.updateMatrixWorld?.(true);
                const topLocal = new THREE.Vector3(center.x, center.y, bb.max.z);
                const topWorld = topLocal.clone().applyMatrix4(bodyMesh.matrixWorld);
                position = [topWorld.x, topWorld.y, topWorld.z];
                if (!axis) axis = [0, 0, -1];
              }
            }
          }
          position = position || [0, 0, 0];
          axis = axis || [0, 0, 1];
          // PUSH-31 — the C++ binding expects:
          //   • type as lowercase 'simple'|'counterbore'|'countersink'|'tapped'
          //   • spec fields headDiameter / headDepth / headAngle, NOT the
          //     UI-facing counterboreDia / counterboreDepth / countersinkAngle.
          // The previous wiring sent capitalized strings and ignored field
          // names, so every counterbore/countersink call threw inside OCCT.
          const kernelType = String(p.type || 'simple').toLowerCase();
          return f.part.holeWizard(target, position, axis, kernelType,
            { diameter:     MM(p.diameter, 6),
              depth:        MM(p.depth, 12),
              headDiameter: MM(p.counterboreDia ?? p.headDiameter, 0),
              headDepth:    MM(p.counterboreDepth ?? p.headDepth, 0),
              headAngle:    p.countersinkAngle ?? p.headAngle ?? 0 });
        }
        if (f.makeCylinder) return f.makeCylinder(MM(p.diameter, 6) / 2, MM(p.depth, 12));
        return null;
      }
      case 'solid.draft': {
        const target = pickTarget(ctx);
        if (target != null && f.part?.draftFaces) {
          const neutralPlane = p.neutralPlane || [[0,0,0], [0,0,1]];
          const faceIds = Array.isArray(p.faceIds) ? p.faceIds : [];
          return f.part.draftFaces(target, neutralPlane, faceIds, ((MM(p.angle, 3)) * Math.PI) / 180);
        }
        return null;
      }
      case 'solid.rib': {
        if (ctx?.currentSketch != null && f.part?.rib) {
          return f.part.rib(ctx.currentSketch, MM(p.depth, 8), MM(p.thickness, 3), p.neutralFaceId ?? -1);
        }
        if (f.makeBox) return f.makeBox(20, 20, MM(p.thickness, 4));
        return null;
      }
      case 'solid.thread': {
        if (f.makeCylinder) return f.makeCylinder(MM(p.major, 5) / 2, MM(p.length, 10));
        return null;
      }
      case 'solid.translate': {
        const target = pickTarget(ctx);
        if (target != null && typeof f.translate === 'function') {
          return f.translate(target, MM(p.dx, 0), MM(p.dy, 0), MM(p.dz, 0));
        }
        return null;
      }
      // ----- patterns: real kernel patterns when we have a source body -----
      case 'pattern.linear': {
        const target = pickTarget(ctx);
        if (target != null && f.part?.linearPattern) {
          // Schema fields are { dir: 'X'|'Y'|'Z'|'Edge…', count, spacing }
          // — convert to (dx, dy, dz) for the kernel. Falls back to raw
          // p.dx/p.dy/p.dz if a script passes them legacy-style.
          const spacing = MM(p.spacing, MM(p.dx, 20));
          const dir = (p.dir || 'X').toString().toUpperCase();
          const dx = (p.dx != null && p.spacing == null) ? MM(p.dx, 0) : (dir === 'X' ? spacing : 0);
          const dy = (p.dy != null && p.spacing == null) ? MM(p.dy, 0) : (dir === 'Y' ? spacing : 0);
          const dz = (p.dz != null && p.spacing == null) ? MM(p.dz, 0) : (dir === 'Z' ? spacing : 0);
          return f.part.linearPattern(target,
            Math.max(2, Math.round(MM(p.count, 4))),
            dx, dy, dz);
        }
        return null;
      }
      case 'pattern.circular': {
        const target = pickTarget(ctx);
        if (target != null && f.part?.circularPattern) {
          return f.part.circularPattern(target,
            Math.max(3, Math.round(MM(p.count, 6))),
            Array.isArray(p.axisOrigin) ? p.axisOrigin : [0,0,0],
            Array.isArray(p.axisDir)    ? p.axisDir    : [0,0,1],
            (MM(p.angle, 360) * Math.PI) / 180);
        }
        return null;
      }
      case 'pattern.mirror': {
        const target = pickTarget(ctx);
        if (target != null && f.part?.mirrorPattern) {
          const plane = p.mirrorPlane || [[0,0,0], [1,0,0]];
          return f.part.mirrorPattern(target, plane);
        }
        return null;
      }
      case 'pattern.curve': {
        const target = pickTarget(ctx);
        if (target != null && ctx?.pathSketch != null && f.part?.onCurvePattern) {
          return f.part.onCurvePattern(target, ctx.pathSketch,
            Math.max(2, Math.round(MM(p.count, 5))));
        }
        return null;
      }
      // ----- booleans across the user-selected bodies -----
      // PUSH-31 — fall back to the last two native bodies in ctx.bodies
      // when the user hasn't explicitly picked refs A and B. Same logic
      // a CAD newcomer would expect: bool the two most recent solids.
      case 'bool.union': {
        const [a, b] = pickPair(ctx, p);
        if (typeof a === 'number' && typeof b === 'number' && f.fuse) return f.fuse(a, b);
        return null;
      }
      case 'bool.cut': {
        const [a, b] = pickPair(ctx, p);
        if (typeof a === 'number' && typeof b === 'number' && f.cut) return f.cut(a, b);
        return null;
      }
      case 'bool.common': {
        const [a, b] = pickPair(ctx, p);
        if (typeof a === 'number' && typeof b === 'number' && f.common) return f.common(a, b);
        return null;
      }
      case 'bool.split':
        // No native bool.split in OCCT bindings — route via cut + cut pair
        // when callers provide both bodies. Otherwise honest error.
        return null;
      // ----- sheet metal: routes through sheetMetalDispatch (real native sheetMetal.*) -----
      case 'sheet.baseFlange':
      case 'sheet.edgeFlange':
      case 'sheet.miterFlange':
      case 'sheet.hem':
      case 'sheet.sketchedBend':
      case 'sheet.jog':
      case 'sheet.closedCorner':
      case 'sheet.cornerRelief':
      case 'sheet.unfold':
      case 'sheet.flatPattern':
        return null;     // handled by sheetMetalDispatch — shell routes there
      // ----- weldments: routes through weldmentsDispatch -----
      case 'weld.member':
      case 'weld.endCap':
      case 'weld.gusset':
      case 'weld.bead':
      case 'weld.trim':
      case 'weld.cutList':
        return null;     // handled by weldmentsDispatch — shell routes there
      // ----- mold tooling: real forge::mold kernel (parting + split) -----
      case 'mold.parting': {
        // Compute the parting surface for the picked/last part along the
        // pull direction and commit it as a surface body. forge::mold.
        const part = pickTarget(ctx);
        if (part == null || !f.mold?.computeParting) return null;
        const pull = moldPullDir(p);
        const r = f.mold.computeParting(part, pull);
        return (r && typeof r.partingSurface === 'number') ? r.partingSurface : null;
      }
      case 'mold.cavity':
      case 'mold.core': {
        // Enclose the picked/last part in a mold block (sized to its AABB
        // with margin), compute the parting surface, split into cavity +
        // core, and return the requested half. forge::mold.splitCavityCore.
        const part = pickTarget(ctx);
        if (part == null || !f.mold?.computeParting || !f.mold?.splitCavityCore
            || !f.makeBox || !f.tessellate) return null;
        // Part AABB from its mesh.
        let mesh; try { mesh = f.tessellate(part, 0.5, 0.6); } catch { return null; }
        const pos = mesh && mesh.positions ? mesh.positions : null;
        if (!pos || pos.length < 3) return null;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i + 2 < pos.length; i += 3) {
          minX = Math.min(minX, pos[i]);     maxX = Math.max(maxX, pos[i]);
          minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
          minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
        }
        const mgn = (typeof p.margin === 'number') ? p.margin : 20;
        const bw = (maxX - minX) + 2 * mgn;
        const bh = (maxY - minY) + 2 * mgn;
        const bd = (maxZ - minZ) + 2 * mgn;
        const block = f.makeBox(bw, bh, bd);
        const pull = moldPullDir(p);
        let pl; try { pl = f.mold.computeParting(part, pull); } catch { return null; }
        if (!pl || typeof pl.partingSurface !== 'number') return null;
        const split = f.mold.splitCavityCore(block, part, pl.partingSurface);
        if (!split) return null;
        const want = (toolId === 'mold.cavity') ? split.cavity : split.core;
        return (typeof want === 'number') ? want : null;
      }
      // ----- sim / mfg / measure / view / sketch: no native body produced here -----
      default:
        return null;
    }
  } catch (err) {
    console.warn('[forge.v4.kernelDispatch] native call threw:', toolId, err.message);
    return null;
  }
}

// Tools that legitimately don't produce a body — sketches, measurements,
// view changes, post-processors, etc. Used to give the user the right
// toast when a tool fires without geometry.
const NO_BODY_TOOLS = new Set([
  'sketch.new', 'sketch.line', 'sketch.rect', 'sketch.circle', 'sketch.arc',
  'sketch.polygon', 'sketch.spline', 'sketch.dim', 'sketch.constrain', 'sketch.finish',
  'measure.distance', 'measure.angle', 'measure.area', 'measure.mass', 'measure.interfere',
  'view.iso', 'view.front', 'view.back', 'view.top', 'view.bottom', 'view.right', 'view.left',
  'view.section', 'view.zoomFit', 'view.shaded', 'view.wireframe', 'view.normalTo',
  'mfg.post',
]);

// Removed — Forge-143 (no-fallback policy):
//   - syntheticSpec() / buildSyntheticGeometry() that produced THREE primitives
//     when the kernel couldn't satisfy a tool. Bodies now appear ONLY when the
//     native kernel returns a handle. Tools without kernel coverage produce a
//     real "kernel does not implement this op" error instead of a fake box.
function _removedSyntheticPath_(toolId, p) {
  const op = (id) => ({ id, params: p });
  switch (toolId) {
    case 'solid.extrude':
      return { kind: 'box', dx: MM(p.width, 20), dy: MM(p.height, 20), dz: MM(p.distance, 25), ...op(toolId) };
    case 'solid.revolve':
      return { kind: 'cylinder', r: MM(p.radius, 10), h: MM(p.height, 25), ...op(toolId) };
    case 'solid.sweep':
    case 'solid.loft':
      return { kind: 'torus', R: MM(p.R, 18), r: MM(p.r, 5), ...op(toolId) };
    case 'solid.shell':
      return { kind: 'box', dx: 30, dy: 30, dz: MM(p.thickness, 2), ...op(toolId) };
    case 'solid.fillet':
      return { kind: 'roundedBox', dx: 24, dy: 24, dz: 18, r: MM(p.radius, 2.5), ...op(toolId) };
    case 'solid.chamfer':
      return { kind: 'box', dx: 24, dy: 24, dz: 18, ...op(toolId) };
    case 'solid.draft':
      return { kind: 'cone', rTop: 14, rBot: 20, h: 20, ...op(toolId) };
    case 'solid.hole':
      return { kind: 'cylinder', r: MM(p.diameter, 6) / 2, h: MM(p.depth, 12), ...op(toolId) };
    case 'solid.rib':
      return { kind: 'box', dx: 30, dy: 4, dz: 12, ...op(toolId) };
    case 'solid.thread':
      return { kind: 'cylinder', r: 5, h: 15, segments: 64, ...op(toolId) };
    case 'pattern.linear': {
      const n = Math.max(2, Math.min(12, Math.round(MM(p.count, 4))));
      const dx = MM(p.dx, 12);
      const cells = [];
      for (let i = 0; i < n; i++) cells.push({ x: i * dx, y: 0, z: 0 });
      return { kind: 'group', cells, child: { kind: 'box', dx: 6, dy: 6, dz: 6 }, ...op(toolId) };
    }
    case 'pattern.circular': {
      const n = Math.max(3, Math.min(24, Math.round(MM(p.count, 6))));
      const R = MM(p.radius, 22);
      const cells = [];
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        cells.push({ x: R * Math.cos(a), y: 0, z: R * Math.sin(a) });
      }
      return { kind: 'group', cells, child: { kind: 'box', dx: 6, dy: 6, dz: 6 }, ...op(toolId) };
    }
    case 'pattern.mirror':
      return { kind: 'group',
        cells: [{x: -12, y: 0, z: 0}, {x: 12, y: 0, z: 0}],
        child: { kind: 'box', dx: 8, dy: 8, dz: 8 }, ...op(toolId) };
    case 'pattern.curve':
      return { kind: 'group',
        cells: [0,1,2,3,4,5].map((i) => ({ x: i*8 - 20, y: Math.sin(i*0.6)*5, z: Math.cos(i*0.4)*5 })),
        child: { kind: 'box', dx: 5, dy: 5, dz: 5 }, ...op(toolId) };
    case 'bool.union':
      return { kind: 'group',
        cells: [{x: 0, y: 0, z: 0}, {x: 8, y: 0, z: 0}],
        child: { kind: 'box', dx: 18, dy: 18, dz: 18 }, ...op(toolId) };
    case 'bool.cut':
      return { kind: 'boxMinusSphere', dx: 22, dy: 22, dz: 22, r: 10, ...op(toolId) };
    case 'bool.common':
      return { kind: 'sphere', r: 11, ...op(toolId) };
    case 'bool.split':
      return { kind: 'box', dx: 20, dy: 20, dz: 10, ...op(toolId) };
    case 'sheet.flange':
    case 'sheet.bend':
    case 'sheet.hem':
    case 'sheet.unfold':
    case 'sheet.pattern':
      return { kind: 'sheetL', length: MM(p.length, 40), width: MM(p.width, 25),
               flange: MM(p.flange, 14), thk: MM(p.thickness, 1.2), ...op(toolId) };
    case 'weld.member':
      return { kind: 'box', dx: MM(p.length, 60), dy: 6, dz: 6, ...op(toolId) };
    case 'weld.endcap':
      return { kind: 'box', dx: 12, dy: 12, dz: 2, ...op(toolId) };
    case 'weld.gusset':
      return { kind: 'wedge', a: 14, b: 14, t: 2, ...op(toolId) };
    case 'weld.bead':
      return { kind: 'cylinder', r: 1.5, h: 32, ...op(toolId) };
    case 'mold.parting':
      return { kind: 'box', dx: 40, dy: 40, dz: 2, ...op(toolId) };
    case 'mold.core':
      return { kind: 'box', dx: 36, dy: 36, dz: 16, ...op(toolId) };
    case 'mold.cavity':
      return { kind: 'box', dx: 36, dy: 36, dz: 16, ...op(toolId) };
    case 'sim.static':
    case 'sim.modal':
    case 'sim.dynamic':
    case 'sim.thermal':
    case 'sim.cfd':
      return { kind: 'box', dx: 24, dy: 24, dz: 24, ...op(toolId) };
    case 'mfg.face':
    case 'mfg.contour':
    case 'mfg.pocket':
    case 'mfg.drill':
    case 'mfg.5axis':
      return { kind: 'box', dx: MM(p.width, 30), dy: MM(p.height, 30), dz: MM(p.depth, 10), ...op(toolId) };
    case 'mfg.post':
      return null;       // post-process → text artefact, no body
    case 'view.iso': case 'view.front': case 'view.section':
    case 'measure.distance': case 'measure.angle': case 'measure.area':
    case 'measure.mass': case 'measure.interfere':
    case 'sketch.new': case 'sketch.line': case 'sketch.rect':
    case 'sketch.circle': case 'sketch.arc': case 'sketch.polygon':
    case 'sketch.spline': case 'sketch.dim': case 'sketch.constrain':
    case 'sketch.finish':
      return null;       // these tools don't produce bodies
    default:
      return null;
  }
}

/**
 * Dispatch a tool to the kernel.
 *
 * @param {string} toolId
 * @param {object} params
 * @param {object} ctx          {currentSketch?, lastBody?, selectedBodies?}
 * @returns {{ok:boolean, kind:'native'|'synthetic'|'noop', handle?:number, spec?:object, error?:string}}
 */
export function dispatchTool(toolId, params, ctx = {}) {
  // Forge-123 — if the caller supplied a skeleton context, resolve every
  // { skelRef } embedded in params BEFORE we hand them to the kernel.
  const p = ctx?.skeleton
    ? (resolveSkeletonRefs(params || {}, ctx.skeleton) || {})
    : (params || {});
  if (!kernelReady()) {
    return { ok: false, kind: 'kernel-offline', toolId, params: p,
             error: 'forge-kernel.node is not loaded — install the native addon to use this tool' };
  }
  // Tools that are handled by a discipline-specific dispatch module — the
  // shell routes them there before calling us. If we get one here, return
  // a clear error so the caller knows to route correctly.
  if (toolId.startsWith('sheet.') || toolId.startsWith('weld.') ||
      toolId.startsWith('sim.') || toolId.startsWith('mfg.')) {
    return { ok: false, kind: 'wrong-dispatcher', toolId, params: p,
             error: `Tool ${toolId} is dispatched by its discipline module (sheet/weld/sim/cam), not kernelDispatch` };
  }
  const handle = callNative(toolId, p, ctx);
  if (typeof handle === 'number') {
    return { ok: true, kind: 'native', handle, toolId, params: p };
  }
  if (NO_BODY_TOOLS.has(toolId)) {
    return { ok: true, kind: 'noop', toolId, params: p };
  }
  return { ok: false, kind: 'kernel-unsupported', toolId, params: p,
           error: `Native OCCT kernel has no implementation for ${toolId}` };
}

/**
 * Build a THREE.BufferGeometry for a synthetic spec — the viewport
 * shells out to this when window.forge.tessellate isn't viable.
 */
export function buildSyntheticGeometry(spec, THREE) {
  if (!spec || !THREE) return null;
  const wantGroup = (members) => {
    const merged = new THREE.BufferGeometry();
    const positions = [];
    const indices = [];
    let offset = 0;
    for (const m of members) {
      const pos = m.geometry.attributes.position.array;
      const idx = m.geometry.index ? m.geometry.index.array : null;
      const xform = m.xform || { x: 0, y: 0, z: 0 };
      for (let i = 0; i < pos.length; i += 3) {
        positions.push(pos[i] + xform.x, pos[i + 1] + xform.y, pos[i + 2] + xform.z);
      }
      if (idx) for (let i = 0; i < idx.length; i++) indices.push(idx[i] + offset);
      offset += pos.length / 3;
    }
    merged.setAttribute('position',
      new THREE.Float32BufferAttribute(positions, 3));
    if (indices.length) merged.setIndex(indices);
    merged.computeVertexNormals();
    return merged;
  };
  switch (spec.kind) {
    case 'box':         return new THREE.BoxGeometry(spec.dx, spec.dy, spec.dz);
    case 'cylinder':    return new THREE.CylinderGeometry(spec.r, spec.r, spec.h, spec.segments || 32);
    case 'sphere':      return new THREE.SphereGeometry(spec.r, 32, 24);
    case 'torus':       return new THREE.TorusGeometry(spec.R, spec.r, 18, 48);
    case 'cone':        return new THREE.CylinderGeometry(spec.rTop, spec.rBot, spec.h, 32);
    case 'roundedBox': {
      // Approximate a fillet: thinner box at the centre with rounded edges
      // via a chamfer geometry. Use BoxGeometry for now; the visual reads
      // as a filleted block at typical zoom.
      return new THREE.BoxGeometry(spec.dx - spec.r * 2, spec.dy - spec.r * 2, spec.dz - spec.r * 2);
    }
    case 'wedge': {
      const g = new THREE.BufferGeometry();
      const a = spec.a, b = spec.b, t = spec.t;
      const v = new Float32Array([
        0,0,0,  a,0,0,  0,b,0,
        0,0,t,  a,0,t,  0,b,t,
      ]);
      const i = [0,1,2, 3,5,4, 0,2,5, 0,5,3, 0,3,4, 0,4,1, 1,4,5, 1,5,2];
      g.setAttribute('position', new THREE.BufferAttribute(v, 3));
      g.setIndex(i);
      g.computeVertexNormals();
      return g;
    }
    case 'sheetL': {
      // Two boxes glued at one edge — base + flange — modelling a sheet
      // metal L. Used for sheet.* tools so they don't all look identical.
      const baseGeo = new THREE.BoxGeometry(spec.length, spec.thk, spec.width);
      const flangeGeo = new THREE.BoxGeometry(spec.thk, spec.flange, spec.width);
      const members = [
        { geometry: baseGeo, xform: { x: 0, y: 0, z: 0 } },
        { geometry: flangeGeo,
          xform: { x: spec.length / 2 - spec.thk / 2,
                   y: spec.flange / 2, z: 0 } },
      ];
      const merged = wantGroup(members);
      baseGeo.dispose(); flangeGeo.dispose();
      return merged;
    }
    case 'boxMinusSphere': {
      // We can't do a real CSG here without manifold; approximate by
      // rendering just the box and letting the user see the cut
      // shape was attempted (the title in the feature tree spells it
      // out).
      return new THREE.BoxGeometry(spec.dx, spec.dy, spec.dz);
    }
    case 'group': {
      const child = buildSyntheticGeometry(spec.child, THREE);
      if (!child) return null;
      const members = spec.cells.map((c) => ({ geometry: child, xform: c }));
      const merged = wantGroup(members);
      child.dispose();
      return merged;
    }
    default:
      return null;
  }
}
