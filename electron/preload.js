// electron/preload.js — exposes the native Forge kernel to the renderer.
//
// The renderer runs with `contextIsolation: true` + `nodeIntegration: false`,
// so the only way to hand a Node native addon to React code is to load it
// here in the preload world and forward a curated surface via
// `contextBridge`. The renderer sees `window.forge.kernel.makeBox(...)` etc.
// — pure functions, no Node objects leak across the bridge.

const { contextBridge } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------- locate addon
// In dev, the addon lives at `forge-kernel/build/Release/forge-kernel.node`.
// In a packaged build, it ships under `resources/forge-kernel/` (set up by
// electron-builder.yml extraResources — added in a follow-up slice).
function locateAddon() {
  const candidates = [
    path.resolve(__dirname, '..', 'forge-kernel', 'build', 'Release', 'forge-kernel.node'),
    path.resolve(process.resourcesPath || '.', 'forge-kernel', 'forge-kernel.node'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let kernel = null;
let loadError = null;
try {
  const addonPath = locateAddon();
  if (!addonPath) {
    throw new Error('forge-kernel.node not found — run `npm run forge:kernel` first');
  }
  // eslint-disable-next-line global-require, import/no-dynamic-require
  kernel = require(addonPath);
  // Diagnostic to main-process console — helps debug ABI mismatches early.
  console.log('[forge:preload] loaded', addonPath, '→', kernel.version());
} catch (err) {
  loadError = err.message;
  console.error('[forge:preload] failed to load forge-kernel:', err.message);
}

// --------------------------------------------------------- bridge surface
// Wrap every kernel export in an arrow so the renderer never holds a
// reference to the addon object itself (defence-in-depth — contextBridge
// rejects Node objects anyway).
const forgeApi = {
  isReady: () => kernel !== null,
  loadError: () => loadError,
  version: () => (kernel ? kernel.version() : null),

  // primitives
  makeBox:      (dx, dy, dz)        => kernel.makeBox(dx, dy, dz),
  makeCylinder: (r, h)              => kernel.makeCylinder(r, h),
  makeSphere:   (r)                 => kernel.makeSphere(r),
  makeCone:     (r1, r2, h)         => kernel.makeCone(r1, r2, h),
  makeTorus:    (R, r)              => kernel.makeTorus(R, r),

  // booleans
  fuse:   (a, b) => kernel.fuse(a, b),
  cut:    (a, b) => kernel.cut(a, b),
  common: (a, b) => kernel.common(a, b),

  // transforms
  translate: (h, dx, dy, dz)        => kernel.translate(h, dx, dy, dz),
  rotate:    (h, ax, ay, az, ang)   => kernel.rotate(h, ax, ay, az, ang),

  // tessellation + mass
  tessellate: (h, linTol, angTol)   => kernel.tessellate(h, linTol, angTol),
  massProps:  (h)                   => kernel.massProps(h),

  // shape lifecycle
  retain:    (h) => kernel.retain(h),
  release:   (h) => kernel.release(h),
  liveCount: ()  => kernel.liveCount(),

  // assembly registry
  addInstance:       (comp, m16)    => kernel.addInstance(comp, m16),
  removeInstance:    (id)           => kernel.removeInstance(id),
  updateTransform:   (id, m16)      => kernel.updateTransform(id, m16),
  instanceCount:     ()             => kernel.instanceCount(),
  queryAABB:         (aabb6)        => kernel.queryAABB(aabb6),
  getInstanceAABB:   (id)           => kernel.getInstanceAABB(id),
  instanceExists:    (id)           => kernel.instanceExists(id),
  reserveInstances:  (n)            => kernel.reserveInstances(n),
  instanceBytesUsed: ()             => kernel.instanceBytesUsed(),

  // mate-constraint solver (Forge-7) — `forge.assembly`.
  assembly: kernel && kernel.assembly ? {
    MateKind: kernel.assembly.MateKind,
    addMate:       (kind, ia, ta, ib, tb, value) =>
      kernel.assembly.addMate(kind, ia, ta, ib, tb, value),
    removeMate:    (id)        => kernel.assembly.removeMate(id),
    setMateActive: (id, on)    => kernel.assembly.setMateActive(id, on),
    setFixed:      (inst, on)  => kernel.assembly.setFixed(inst, on),
    solve:         ()          => kernel.assembly.solve(),
    mateCount:     ()          => kernel.assembly.mateCount(),
    clear:         ()          => kernel.assembly.clear(),
  } : null,

  // engineering drawings (Forge-10) — HLR projection of a 3D shape.
  // direction = string preset ('front'|'top'|'right'|'iso') or Float64Array [dx,dy,dz].
  drawings: kernel && kernel.drawings ? {
    projectShape: (h, direction) => kernel.drawings.projectShape(h, direction),
  } : null,

  // 2.5D CAM (Forge-13) — toolpath generators + G-code post.
  // Defensive null guard: older addons that predate Forge-13 may not
  // ship the `cam` namespace; the renderer should detect that and
  // hide the CAM workbench instead of crashing.
  cam: kernel && kernel.cam ? {
    ToolType:    Object.freeze({ ...kernel.cam.ToolType }),
    kAutoFaceId: kernel.cam.kAutoFaceId,
    profile:  (shape, faceId, tool, params, zTop, zBottom, leadIn) =>
      kernel.cam.profile(shape, faceId, tool, params, zTop, zBottom, leadIn ?? 0),
    pocket:   (shape, faceId, tool, params, zTop, zBottom) =>
      kernel.cam.pocket(shape, faceId, tool, params, zTop, zBottom),
    drill:    (shape, holes, tool, params, zTop, zBottom, peck) =>
      kernel.cam.drill(shape, holes, tool, params, zTop, zBottom, !!peck),
    faceMill: (shape, faceId, tool, params, zTop, depth) =>
      kernel.cam.faceMill(shape, faceId, tool, params, zTop, depth),
    gcode: kernel.cam.gcode ? {
      Dialect: Object.freeze({ ...kernel.cam.gcode.Dialect }),
      toGcode: (toolpath, dialect, safeZ) =>
        kernel.cam.gcode.toGcode(toolpath, dialect, safeZ ?? 25),
    } : null,
  } : null,

  // parametric 2D sketcher (Forge-6) — planegcs-backed.
  sketcher: kernel && kernel.sketcher ? {
    kinds:    Object.freeze({ ...kernel.sketcher.kinds }),
    statuses: Object.freeze({ ...kernel.sketcher.statuses }),
    createSketch:  ()                       => kernel.sketcher.createSketch(),
    destroySketch: (h)                      => kernel.sketcher.destroySketch(h),
    addPoint:      (h, x, y)                => kernel.sketcher.addPoint(h, x, y),
    addLine:       (h, p0, p1)              => kernel.sketcher.addLine(h, p0, p1),
    addCircle:     (h, center, radius)      => kernel.sketcher.addCircle(h, center, radius),
    addArc:        (h, center, p0, p1)      => kernel.sketcher.addArc(h, center, p0, p1),
    addConstraint: (h, kind, refs, value)   => kernel.sketcher.addConstraint(h, kind, refs, value ?? 0),
    solve:         (h)                      => kernel.sketcher.solve(h),
    readPoint:     (h, pid)                 => kernel.sketcher.readPoint(h, pid),
    writePoint:    (h, pid, x, y)           => kernel.sketcher.writePoint(h, pid, x, y),
    liveCount:     ()                       => kernel.sketcher.liveCount(),
  } : null,

  // native FEA (Forge-12 + Forge-12b) — linear static + modal + dynamic
  // Newmark-β + steady thermal + geometric-nonlinear static + fatigue.
  // Mesh is the brick-grid fallback documented in forge/Fea.hpp; the
  // surface API stays stable once the proper tet mesher lands.
  fea: kernel && kernel.fea ? {
    meshFromBrep: (h, targetElemSize) =>
      kernel.fea.meshFromBrep(h, targetElemSize),
    solveStatic:  (mesh, material, loads, pressureLoads, bcs) =>
      kernel.fea.solveStatic(mesh, material, loads ?? [], pressureLoads ?? [], bcs ?? []),
    solveModal:   (mesh, material, bcs, nModes) =>
      kernel.fea.solveModal(mesh, material, bcs ?? [], nModes ?? 3),
    solveDynamic: (mesh, material, loads, bcs, tEnd, dt, alpha, beta) =>
      kernel.fea.solveDynamic(mesh, material, loads ?? [], bcs ?? [],
                              tEnd, dt, alpha ?? 0, beta ?? 0),
    solveThermal: (mesh, material, dirichlet, sources, convection) =>
      kernel.fea.solveThermal(mesh, material, dirichlet ?? [], sources ?? [], convection ?? []),
    solveNonlinearStatic: (mesh, material, loads, bcs, cfg) =>
      kernel.fea.solveNonlinearStatic(mesh, material, loads ?? [], bcs ?? [], cfg ?? {}),
    fatigueLife: (stressHistory, nElem, nSteps, cfg) =>
      kernel.fea.fatigueLife(stressHistory, nElem, nSteps, cfg ?? {}),
    MeanStressCorrection: kernel.fea.MeanStressCorrection
      ? Object.freeze({ ...kernel.fea.MeanStressCorrection })
      : Object.freeze({ None: 0, Goodman: 1, Soderberg: 2 }),
  } : null,

  // native CFD (Forge-12b) — incompressible Navier-Stokes on a staggered
  // MAC grid via projection-method SIMPLE iteration. Laminar-only; the
  // header in forge/Cfd.hpp documents the simplifications (no turbulence
  // model, structured cartesian grid, single-corrector PISO).
  cfd: kernel && kernel.cfd ? {
    solveSteadyNS: (cfg) => kernel.cfd.solveSteadyNS(cfg),
  } : null,

  // file I/O (Forge-21) — STEP / BREP / STL import + export. All
  // operations take absolute filesystem paths; renderer code calls
  // these from the file menu after the OS file dialog returns a path.
  io: kernel && kernel.io ? {
    importStep: (filepath)                     => kernel.io.importStep(filepath),
    exportStep: (handle, filepath)             => kernel.io.exportStep(handle, filepath),
    importBrep: (filepath)                     => kernel.io.importBrep(filepath),
    exportBrep: (handle, filepath)             => kernel.io.exportBrep(handle, filepath),
    importStl:  (filepath)                     => kernel.io.importStl(filepath),
    exportStl:  (handle, filepath, lt, at, asc) => kernel.io.exportStl(handle, filepath, lt ?? 0.1, at ?? 0.5, !!asc),
  } : null,

  // direct modeling (Forge-23) — synchronous-technology face editing.
  // Every operation returns a new handle; the caller owns its lifecycle.
  // Face ids are 1-based into the BREP face table (TopExp::MapShapes order).
  direct: kernel && kernel.direct ? {
    pushPullFace:      (h, faceId, distance)            => kernel.direct.pushPullFace(h, faceId, distance),
    moveFace:          (h, faceId, translation)         => kernel.direct.moveFace(h, faceId, translation),
    rotateFace:        (h, faceId, axisOrigin, axisDir, angleRad) =>
      kernel.direct.rotateFace(h, faceId, axisOrigin, axisDir, angleRad),
    deleteFaceAndHeal: (h, faceIds)                     => kernel.direct.deleteFaceAndHeal(h, faceIds),
    replaceFace:       (h, faceId, spec)                => kernel.direct.replaceFace(h, faceId, spec),
    inferFeature:      (h, faceId)                      => kernel.direct.inferFeature(h, faceId),
    faceCount:         (h)                              => kernel.direct.faceCount(h),
  } : null,

  // healing (Forge-23) — sew open shells, fill holes, simplify, repair, validate.
  heal: kernel && kernel.heal ? {
    sewShape:                   (h, tol)        => kernel.heal.sewShape(h, tol ?? 1e-3),
    simplifyShape:              (h, opts)       => kernel.heal.simplifyShape(h, opts ?? {}),
    autoFillMissingFaces:       (h, tol)        => kernel.heal.autoFillMissingFaces(h, tol ?? 1e-3),
    autoRepairSelfIntersection: (h, tol)        => kernel.heal.autoRepairSelfIntersection(h, tol ?? 1e-3),
    harmonizeNormals:           (h)             => kernel.heal.harmonizeNormals(h),
    checkValidity:              (h)             => kernel.heal.checkValidity(h),
  } : null,
};

if (kernel) {
  contextBridge.exposeInMainWorld('forge', forgeApi);
} else {
  // Still expose a "broken" surface so the renderer can detect load failures
  // and surface a friendly error in the UI instead of silent `undefined`.
  contextBridge.exposeInMainWorld('forge', {
    isReady: () => false,
    loadError: () => loadError,
  });
}
