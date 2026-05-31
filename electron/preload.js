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

  // native FEA (Forge-12) — linear static + modal + dynamic Newmark-β.
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
