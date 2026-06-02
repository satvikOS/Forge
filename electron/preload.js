// electron/preload.js — exposes the native Forge kernel to the renderer.
//
// The renderer runs with `contextIsolation: true` + `nodeIntegration: false`,
// so the only way to hand a Node native addon to React code is to load it
// here in the preload world and forward a curated surface via
// `contextBridge`. The renderer sees `window.forge.kernel.makeBox(...)` etc.
// — pure functions, no Node objects leak across the bridge.

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Forge-77 — auto-update IPC bridge.
// main.js sends update:available / update:progress / update:downloaded.
// The renderer subscribes via window.forge.updater.onEvent(cb).
const updateListeners = new Set();
['update:available', 'update:progress', 'update:downloaded'].forEach((ch) => {
  ipcRenderer.on(ch, (_event, payload) => {
    for (const cb of updateListeners) {
      try { cb({ kind: ch.replace('update:', ''), ...payload }); } catch {}
    }
  });
});

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

  // Forge-25 worker-thread tessellation. Returns a Promise<Mesh>; the
  // C++ pool is sized (hardware_concurrency-1) so the V8 main thread
  // keeps a core. Renderer should batch dozens of shapes here and await
  // them with Promise.all() rather than calling `tessellate()` in a loop.
  tessellateAsync:       (h, linTol, angTol) => kernel.tessellateAsync(h, linTol, angTol),
  tessellationPoolSize:  ()                  => kernel.tessellationPoolSize(),
  tessellationWaitIdle:  ()                  => kernel.tessellationWaitIdle(),

  // Forge-25 LOD chain — three pre-tessellated levels cached per ShapeHandle.
  LODLevel:        Object.freeze({ Low: 0, Med: 1, High: 2 }),
  tessellateLOD:   (h, level)                                => kernel.tessellateLOD(h, level),
  selectLOD:       (id, eyeX, eyeY, eyeZ, fovRad, screenPxH) =>
    kernel.selectLOD(id, eyeX, eyeY, eyeZ, fovRad, screenPxH),
  clearLODCache:   ()                                        => kernel.clearLODCache(),
  lodCacheEntries: ()                                        => kernel.lodCacheEntries(),

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

  // Forge-25 BVH queries — caller must invoke buildBvh() once after a
  // batch of add/remove/update to make subsequent queries O(log N).
  buildBvh:     ()                          => kernel.buildBvh(),
  isBvhFresh:   ()                          => kernel.isBvhFresh(),
  queryRay:     (origin3, dir3)             => kernel.queryRay(origin3, dir3),
  queryFrustum: (planes24)                  => kernel.queryFrustum(planes24),

  // mate-constraint solver (Forge-7) — `forge.assembly`.
  // Forge-35 adds hierarchy + interference + motion-study entries; every
  // one is defensively null-guarded so a pre-Forge-35 kernel still loads.
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
    clearHierarchy:     kernel.assembly.clearHierarchy
      ? () => kernel.assembly.clearHierarchy()
      : null,
    setParent:          kernel.assembly.setParent
      ? (child, parent) => kernel.assembly.setParent(child, parent ?? 0)
      : null,
    getChildren:        kernel.assembly.getChildren
      ? (parent) => kernel.assembly.getChildren(parent ?? 0)
      : null,
    worldTransform:     kernel.assembly.worldTransform
      ? (inst) => kernel.assembly.worldTransform(inst)
      : null,
    detectInterference: kernel.assembly.detectInterference
      ? (ids, tolerance) => kernel.assembly.detectInterference(ids ?? [], tolerance ?? 0)
      : null,
    runMotionStudy:     kernel.assembly.runMotionStudy
      ? (motor, axis, totalAngleRad, steps) =>
          kernel.assembly.runMotionStudy(motor, axis, totalAngleRad, steps)
      : null,
  } : null,

  // engineering drawings (Forge-10 + Forge-32) — HLR projection of a 3D
  // shape, plus section / detail / broken views.
  // direction = string preset ('front'|'top'|'right'|'iso') or Float64Array [dx,dy,dz].
  drawings: kernel && kernel.drawings ? {
    projectShape:   (h, direction) =>
      kernel.drawings.projectShape(h, direction),
    projectSection: (h, direction, sectionPlane, hatchSpec) =>
      kernel.drawings.projectSection(h, direction, sectionPlane, hatchSpec ?? {}),
    projectDetail:  (h, direction, focusCircle, scale) =>
      kernel.drawings.projectDetail(h, direction, focusCircle, scale ?? 2),
    projectBroken:  (h, direction, breakRegion) =>
      kernel.drawings.projectBroken(h, direction, breakRegion),
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
    // Forge-33 — advanced CAM. Defensive forwarders that no-op gracefully on
    // older kernels (returns null instead of crashing the renderer).
    adaptiveClear: kernel.cam.adaptiveClear
      ? (shape, stockAabb, tool, params, adaptive) =>
          kernel.cam.adaptiveClear(shape, stockAabb, tool, params, adaptive)
      : null,
    multiAxisIndexed: kernel.cam.multiAxisIndexed
      ? (shape, tool, params, orientations, zTop, zBottom) =>
          kernel.cam.multiAxisIndexed(shape, tool, params, orientations, zTop, zBottom)
      : null,
    multiAxisContinuous: kernel.cam.multiAxisContinuous
      ? (shape, tool, params, path) =>
          kernel.cam.multiAxisContinuous(shape, tool, params, path)
      : null,
    simulateStock: kernel.cam.simulateStock
      ? (stockAabb, toolpath, tool, gridResolution) =>
          kernel.cam.simulateStock(stockAabb, toolpath, tool, gridResolution ?? 50)
      : null,
    generateCmm: kernel.cam.generateCmm
      ? (shape, features, gauge) =>
          kernel.cam.generateCmm(shape, features, gauge)
      : null,
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
    // Forge-31 — buckling / contact / plasticity (defensive: native bindings
    // may not be present on older kernels, in which case we expose nulls so
    // the JS facade can degrade gracefully without throwing on import.)
    solveBuckling: typeof kernel.fea.solveBuckling === 'function'
      ? (mesh, material, loads, bcs, nModes) =>
          kernel.fea.solveBuckling(mesh, material, loads ?? [], bcs ?? [], nModes ?? 3)
      : null,
    solveContact: typeof kernel.fea.solveContact === 'function'
      ? (meshA, meshB, material, loadsA, loadsB, bcsA, bcsB, pairs, normalPenalty) =>
          kernel.fea.solveContact(meshA, meshB, material,
                                  loadsA ?? [], loadsB ?? [],
                                  bcsA ?? [], bcsB ?? [],
                                  pairs ?? [], normalPenalty ?? 0)
      : null,
    solveNonlinearPlastic: typeof kernel.fea.solveNonlinearPlastic === 'function'
      ? (mesh, material, loads, bcs, loadSteps) =>
          kernel.fea.solveNonlinearPlastic(mesh, material,
                                           loads ?? [], bcs ?? [],
                                           loadSteps ?? 5)
      : null,
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

  // geotech (Forge-176) — slope stability (Bishop + Janbu, circular search).
  geotech: kernel && kernel.geotech ? {
    analyse: (cfg) => kernel.geotech.analyse(cfg),
  } : null,

  // casting (Forge-173) — solidification (enthalpy FDM with phase change).
  casting: kernel && kernel.casting ? {
    solidify: (cfg) => kernel.casting.solidify(cfg),
  } : null,

  // mold (Forge-172) — injection-mould flow (Hele-Shaw + Cross-WLF).
  mold: kernel && kernel.mold ? {
    heleShawFill: (mesh, gate, mat, moldT, maxT, maxSteps) =>
      kernel.mold.heleShawFill(mesh, gate, mat, moldT, maxT, maxSteps ?? 500),
  } : null,

  // acoustics (Forge-175) — image-source method + Eyring stat tail.
  acoustics: kernel && kernel.acoustics ? {
    simulate: (cfg) => kernel.acoustics.simulate(cfg),
  } : null,

  // welding (Forge-174) — Goldak heat source + thermo-mechanical FEA.
  welding: kernel && kernel.welding ? {
    simulateWeld: (mesh, mat, src, totalTimeSec, snapshotCount) =>
      kernel.welding.simulateWeld(mesh, mat, src, totalTimeSec, snapshotCount ?? 4),
  } : null,

  // gltf (Forge-178) — glTF 2.0 binary export (.glb) for web publishing.
  // Forge-198 — streaming variant that tessellates one body at a time.
  gltf: kernel && kernel.gltf ? {
    exportGlb: (bodies, filepath, options) =>
      kernel.gltf.exportGlb(bodies, filepath, options ?? {}),
    exportGlbStream: (bodies, filepath, options) =>
      kernel.gltf.exportGlbStream(bodies, filepath, options ?? {}),
  } : null,

  // meshrepair (Forge-200) — triangle mesh cleanup + simplification.
  meshrepair: kernel && kernel.meshrepair ? {
    analyse:          (mesh) => kernel.meshrepair.analyse(mesh),
    dedupeVertices:   (mesh, eps) => kernel.meshrepair.dedupeVertices(mesh, eps),
    removeDegenerate: (mesh) => kernel.meshrepair.removeDegenerate(mesh),
    fillHoles:        (mesh, maxLoopLen) => kernel.meshrepair.fillHoles(mesh, maxLoopLen),
    laplacianSmooth:  (mesh, iter, lambda) => kernel.meshrepair.laplacianSmooth(mesh, iter, lambda),
    decimate:         (mesh, target) => kernel.meshrepair.decimate(mesh, target),
  } : null,

  // sheetmetal (Forge-201) — flat-pattern unfold + bend allowance.
  sheetmetal: kernel && kernel.sheetmetal ? {
    kFactor:     (material, ratioRoT) => kernel.sheetmetal.kFactor(material, ratioRoT),
    computeBend: (input) => kernel.sheetmetal.computeBend(input),
    unfoldChain: (input) => kernel.sheetmetal.unfoldChain(input),
  } : null,

  // pointcloud (Forge-202) — scan-data utilities.
  pointcloud: kernel && kernel.pointcloud ? {
    stats:           (points) => kernel.pointcloud.stats(points),
    voxelDownsample: (points, leaf) => kernel.pointcloud.voxelDownsample(points, leaf),
    estimateNormals: (points, k, viewpoint) => kernel.pointcloud.estimateNormals(points, k, viewpoint),
    voxelMesh:       (points, leaf) => kernel.pointcloud.voxelMesh(points, leaf),
  } : null,

  // pathtrace (Forge-203) — CPU path tracer preview.
  pathtrace: kernel && kernel.pathtrace ? {
    render: (input) => kernel.pathtrace.render(input),
  } : null,

  // stdparts (Forge-204) — parametric ISO/ANSI standard parts.
  stdparts: kernel && kernel.stdparts ? {
    makeBolt:          (spec, segs) => kernel.stdparts.makeBolt(spec, segs),
    makeNut:           (spec, segs) => kernel.stdparts.makeNut(spec, segs),
    makeWasher:        (spec, segs) => kernel.stdparts.makeWasher(spec, segs),
    makeBearing:       (spec, segs) => kernel.stdparts.makeBearing(spec, segs),
    makeSpurGear:      (spec, segs) => kernel.stdparts.makeSpurGear(spec, segs),
    specForMetricBolt: (mCode, len) => kernel.stdparts.specForMetricBolt(mCode, len),
    specForMetricNut:  (mCode)      => kernel.stdparts.specForMetricNut(mCode),
  } : null,

  // frame (Forge-205) — 3D truss linear-elastic FEA + Forge-210 modal.
  frame: kernel && kernel.frame ? {
    solve: (input) => kernel.frame.solve(input),
    modal: (input) => kernel.frame.modal(input),
  } : null,

  // piperoute (Forge-206) — A* axis-aligned pipe router.
  piperoute: kernel && kernel.piperoute ? {
    route: (input) => kernel.piperoute.route(input),
  } : null,

  // dxf (Forge-207) — AutoCAD DXF round-trip.
  dxf: kernel && kernel.dxf ? {
    parse: (text) => kernel.dxf.parse(text),
    write: (doc)  => kernel.dxf.write(doc),
  } : null,

  // sketchdof (Forge-208) — sketch constraint DOF audit.
  sketchdof: kernel && kernel.sketchdof ? {
    audit: (input) => kernel.sketchdof.audit(input),
  } : null,

  // animation (Forge-209) — keyframe animation evaluator.
  animation: kernel && kernel.animation ? {
    duration:    (tracks) => kernel.animation.duration(tracks),
    evaluateAll: (tracks, time) => kernel.animation.evaluateAll(tracks, time),
    sampleRange: (tracks, t0, t1, n) => kernel.animation.sampleRange(tracks, t0, t1, n),
  } : null,

  // cost (Forge-179) — material × machining × labour cost engine.
  cost: kernel && kernel.cost ? {
    computeUnit:    (inputs) => kernel.cost.computeUnit(inputs),
    computeProject: (inputs) => kernel.cost.computeProject(inputs),
  } : null,

  // carbon (Forge-180) — cradle-to-gate kgCO2e per part + batch.
  carbon: kernel && kernel.carbon ? {
    computeLca: (inputs) => kernel.carbon.computeLca(inputs),
  } : null,

  // sun (Forge-181) — solar position + daylight (NOAA SPA Spencer/Iqbal).
  sun: kernel && kernel.sun ? {
    compute:     (cfg) => kernel.sun.compute(cfg),
    sweepHourly: (cfg) => kernel.sun.sweepHourly(cfg),
    annualNoon:  (cfg) => kernel.sun.annualNoon(cfg),
  } : null,

  // tolerance (Forge-185) — 1D stack-up worst-case + RSS + Monte-Carlo.
  tolerance: kernel && kernel.tolerance ? {
    compute: (cfg) => kernel.tolerance.compute(cfg),
  } : null,

  // duct (Forge-186) — HVAC ductwork sizing + pressure-drop.
  duct: kernel && kernel.duct ? {
    compute:               (cfg) => kernel.duct.compute(cfg),
    sizeRoundForFriction:  (Q, tgt, air) => kernel.duct.sizeRoundForFriction(Q, tgt, air),
  } : null,

  // variants (Forge-187) — Latin-hypercube + Pareto-front primitives.
  variants: kernel && kernel.variants ? {
    latinHypercube: (cfg)                  => kernel.variants.latinHypercube(cfg),
    paretoFront:    (objs, nObj, signs)    => kernel.variants.paretoFront(objs, nObj, signs),
  } : null,

  // psychro (Forge-192) — HVAC psychrometric chart calculator.
  psychro: kernel && kernel.psychro ? {
    saturationPressurePa: (T)                  => kernel.psychro.saturationPressurePa(T),
    humidityRatio:        (pw, pAtm)           => kernel.psychro.humidityRatio(pw, pAtm),
    dewPointC:            (pw)                 => kernel.psychro.dewPointC(pw),
    wetBulbC:             (Tdb, W, pAtm)       => kernel.psychro.wetBulbC(Tdb, W, pAtm),
    stateFromTwo:         (mask, a, b, pAtm)   => kernel.psychro.stateFromTwo(mask, a, b, pAtm),
  } : null,

  // circuit (Forge-190) — linear circuit DC + AC analysis (MNA).
  circuit: kernel && kernel.circuit ? {
    dcAnalysis: (spec)         => kernel.circuit.dcAnalysis(spec),
    acAnalysis: (spec, freqs)  => kernel.circuit.acAnalysis(spec, freqs),
  } : null,

  // terrain (Forge-191) — Delaunay triangulation + cut/fill volume.
  terrain: kernel && kernel.terrain ? {
    delaunay:        (spec) => kernel.terrain.delaunay(spec),
    cutFillVsPlane:  (spec) => kernel.terrain.cutFillVsPlane(spec),
  } : null,

  // nurbsfit (Forge-194) — cubic B-spline surface fitting to point cloud.
  nurbsfit: kernel && kernel.nurbsfit ? {
    fitSurface: (spec) => kernel.nurbsfit.fitSurface(spec),
  } : null,

  // airfoil (Forge-171) — NACA 4/5-digit + Selig parametric airfoils,
  // trapezoidal wing loft via OCCT ThruSections.
  airfoil: kernel && kernel.airfoil ? {
    naca4:            (code, nPts)        => kernel.airfoil.naca4(code, nPts ?? 160),
    naca5:            (code, nPts)        => kernel.airfoil.naca5(code, nPts ?? 160),
    parseSelig:       (text)              => kernel.airfoil.parseSelig(text),
    resampleCosine:   (profile, nPts)     => kernel.airfoil.resampleCosine(profile, nPts ?? 160),
    profileToFace:    (profile, chordMm)  => kernel.airfoil.profileToFace(profile, chordMm),
    loftWing:         (stations, capTips) => kernel.airfoil.loftWing(stations, capTips !== false),
    trapezoidalWing:  (spec)              => kernel.airfoil.trapezoidalWing(spec),
    planformMetrics:  (spec)              => kernel.airfoil.planformMetrics(spec),
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
    // Forge-34 — IGES + JT/Parasolid (stub-with-error) + STEP AP242 PMI.
    // Defensive `&&`: older kernels predate Forge-34 and will lack these.
    importIges:        kernel.io.importIges
                       ? (filepath) => kernel.io.importIges(filepath)
                       : () => { throw new Error('[forge.io] importIges: kernel < Forge-34'); },
    importJt:          kernel.io.importJt
                       ? (filepath) => kernel.io.importJt(filepath)
                       : () => { throw new Error('[forge.io] importJt: kernel < Forge-34'); },
    importParasolid:   kernel.io.importParasolid
                       ? (filepath) => kernel.io.importParasolid(filepath)
                       : () => { throw new Error('[forge.io] importParasolid: kernel < Forge-34'); },
    exportStepWithPmi: kernel.io.exportStepWithPmi
                       ? (h, fp, notes) => kernel.io.exportStepWithPmi(h, fp, notes || [])
                       : () => { throw new Error('[forge.io] exportStepWithPmi: kernel < Forge-34'); },
    // Forge-151 — write raw bytes to a tmp file so the renderer can
    // round-trip a generated mesh through importStl(). Pure file
    // I/O — no kernel dependency.
    writeTmpStl: (name, bytes) => {
      const safe = String(name || 'forge-mesh').replace(/[^a-zA-Z0-9._-]/g, '_');
      const p = path.join(os.tmpdir(), `${safe}-${Date.now()}.stl`);
      const buf = bytes instanceof Uint8Array ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
                                              : Buffer.from(bytes);
      fs.writeFileSync(p, buf);
      return p;
    },
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

  // part features (Forge-22 + Forge-36 closures) — extrude / revolve /
  // sweep / loft / shell / fillet / chamfer / draft / hole / rib /
  // patterns / sweepWithGuides / loftWithGuides / shellMultiThickness.
  part: kernel && kernel.part ? {
    extrudeProfile:     (sk, distance, direction) =>
      kernel.part.extrudeProfile(sk, distance, direction),
    revolveProfile:     (sk, axisOrigin, axisDir, angleRad) =>
      kernel.part.revolveProfile(sk, axisOrigin, axisDir, angleRad),
    sweep:              (profileSk, pathSk, withGuides) =>
      kernel.part.sweep(profileSk, pathSk, !!withGuides),
    loft:               (sectionHandles, guides, ruled, closed) =>
      kernel.part.loft(sectionHandles, guides ?? [], !!ruled, !!closed),
    shell:              (shape, faceIdsToRemove, thickness, multiThickness) =>
      kernel.part.shell(shape, faceIdsToRemove ?? [], thickness, multiThickness ?? []),
    filletEdges:        (shape, edgeIds, radius) =>
      kernel.part.filletEdges(shape, edgeIds, radius),
    variableFilletEdge: (shape, edgeId, anchorRadii) =>
      kernel.part.variableFilletEdge(shape, edgeId, anchorRadii),
    chamferEdges:       (shape, edgeIds, distance, distance2) =>
      kernel.part.chamferEdges(shape, edgeIds, distance, distance2 ?? -1),
    draftFaces:         (shape, neutralPlane, faceIds, angleRad) =>
      kernel.part.draftFaces(shape, neutralPlane, faceIds, angleRad),
    holeWizard:         (shape, position, axis, type, spec) =>
      kernel.part.holeWizard(shape, position, axis, type, spec ?? {}),
    rib:                (sk, depth, thickness, neutralFaceId) =>
      kernel.part.rib(sk, depth, thickness, neutralFaceId ?? 0),
    linearPattern:      (shape, count, dx, dy, dz) =>
      kernel.part.linearPattern(shape, count, dx, dy, dz),
    circularPattern:    (shape, count, axisOrigin, axisDir, totalAngleRad) =>
      kernel.part.circularPattern(shape, count, axisOrigin, axisDir, totalAngleRad),
    mirrorPattern:      (shape, mirrorPlane) =>
      kernel.part.mirrorPattern(shape, mirrorPlane),
    onCurvePattern:     (shape, pathSk, count) =>
      kernel.part.onCurvePattern(shape, pathSk, count),
    // Forge-36 closures of the §1 ◐ partial rows.
    sweepWithGuides:    (profileSk, pathSk, guideSks) =>
      kernel.part.sweepWithGuides(profileSk, pathSk, guideSks ?? []),
    loftWithGuides:     (sectionHandles, guideSks, ruled, closed) =>
      kernel.part.loftWithGuides(sectionHandles, guideSks ?? [], !!ruled, !!closed),
    shellMultiThickness: (shape, faceIdsToRemove, baseThickness, perFaceOverrides) =>
      kernel.part.shellMultiThickness(shape, faceIdsToRemove ?? [], baseThickness, perFaceOverrides ?? []),
  } : null,

  // NURBS surfacing (Forge-36) — build/trim/sew/refine/eval/intersect/
  // project/classA-analyse over `Geom_BSplineSurface` faces.
  surfacing: kernel && kernel.surfacing ? {
    buildPatch:    (grid, uDegree, vDegree, uKnots, vKnots) =>
      kernel.surfacing.buildPatch(grid, uDegree ?? 3, vDegree ?? 3, uKnots ?? null, vKnots ?? null),
    trim:          (face, uvFlat)             => kernel.surfacing.trim(face, uvFlat),
    sew:           (faces, tolerance)         => kernel.surfacing.sew(faces, tolerance ?? 1e-3),
    refine:        (face, uTimes, vTimes)     => kernel.surfacing.refine(face, uTimes ?? 1, vTimes ?? 1),
    eval:          (face, u, v)               => kernel.surfacing.eval(face, u, v),
    intersect:     (faceA, faceB)             => kernel.surfacing.intersect(faceA, faceB),
    projectPoint:  (face, pt)                 => kernel.surfacing.projectPoint(face, pt),
    classAAnalyse: (face, samples)            => kernel.surfacing.classAAnalyse(face, samples ?? 16),
  } : null,

  // sheet-metal authoring (Forge-24) — base flange + edge/miter/hem/bend/
  // jog + corner ops + unfold + flat-pattern. Defensive null guard so
  // older kernels without the sheet-metal namespace just hide the
  // workbench instead of crashing.
  sheetMetal: kernel && kernel.sheetMetal ? {
    makeWireRect: (w, h)                                => kernel.sheetMetal.makeWireRect(w, h),
    makeLineEdge: (x0, y0, z0, x1, y1, z1)              => kernel.sheetMetal.makeLineEdge(x0, y0, z0, x1, y1, z1),
    baseFlange:   (wire, params)                        => kernel.sheetMetal.baseFlange(wire, params),
    edgeFlange:   (sh, edgeId, params, len, ang, mode)  => kernel.sheetMetal.edgeFlange(sh, edgeId, params, len, ang, mode ?? 'rect'),
    miterFlange:  (sh, edgeIds, params, len, ang)       => kernel.sheetMetal.miterFlange(sh, edgeIds, params, len, ang),
    hem:          (sh, edgeId, params, hemType, length) => kernel.sheetMetal.hem(sh, edgeId, params, hemType ?? 'closed', length),
    sketchedBend: (sh, line, params, ang, r)            => kernel.sheetMetal.sketchedBend(sh, line, params, ang, r),
    jog:          (sh, edgeId, params, height, ang)     => kernel.sheetMetal.jog(sh, edgeId, params, height, ang),
    closedCorner: (sh, vertexId, params, gap)           => kernel.sheetMetal.closedCorner(sh, vertexId, params, gap),
    cornerRelief: (sh, vertexId, params, mode, size)    => kernel.sheetMetal.cornerRelief(sh, vertexId, params, mode ?? 'circular', size),
    unfold:       (sh, params)                          => kernel.sheetMetal.unfold(sh, params),
    flatPattern:  (sh, params)                          => kernel.sheetMetal.flatPattern(sh, params),
    bends:        (sh)                                  => kernel.sheetMetal.bends(sh),
  } : null,

  // Forge-46 — trace persistence sink. ArchieTraceSink calls this once
  // per run to append a JSONL line under ~/.forge/traces/. We do the
  // fs work in preload because the renderer has no fs access.
  trace: {
    write: (filename, line) => {
      try {
        if (!/^[a-zA-Z0-9._-]+$/.test(String(filename || ''))) {
          throw new Error('invalid trace filename');
        }
        const dir = path.join(os.homedir(), '.forge', 'traces');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const full = path.join(dir, filename);
        fs.appendFileSync(full, String(line), 'utf8');
        return { ok: true, path: full, bytes: Buffer.byteLength(String(line)) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  // Forge-77 — Auto-update bridge. Renderer subscribes to update events.
  updater: {
    onEvent: (cb) => {
      updateListeners.add(cb);
      return () => updateListeners.delete(cb);
    },
    quitAndInstall: () => ipcRenderer.send('updater:quitAndInstall'),
    check: () => ipcRenderer.send('updater:check'),
  },

  // Forge-87 — native file dialog bridge for STEP/IGES/STL/BREP I/O.
  // Renderer asks main to show a system file picker, gets a path back, then
  // the renderer calls `forge.io.importStep(path)` against that path.
  //
  // Forge-103 — `writeBlob(filepath, uint8array)` lets the renderer ship
  // arbitrary bytes (e.g. a JSZip-built project bundle) to disk via the
  // same main-process file system the export dialog returns paths into.
  // The Uint8Array is base64-encoded here in preload so it survives the
  // contextBridge serialization boundary intact.
  dialog: {
    openFile: (opts) => ipcRenderer.invoke('io:openDialog', opts || {}),
    saveFile: (opts) => ipcRenderer.invoke('io:saveDialog', opts || {}),
    writeBlob: (filepath, uint8array) => {
      // Convert Uint8Array → base64 string. We can't pass the typed array
      // straight through contextBridge because some Electron versions clone
      // it lossily; base64 is small, safe, and round-trips cleanly.
      const bytes = uint8array instanceof Uint8Array
        ? uint8array
        : new Uint8Array(uint8array || []);
      // Buffer is available in preload (Node side of the bridge).
      const base64 = Buffer.from(bytes).toString('base64');
      return ipcRenderer.invoke('io:writeBlob', { filepath, base64 });
    },
  },

  // Forge-112 — video transcode bridge. The renderer's MediaRecorder only
  // emits WebM/VP9 from a <canvas> stream; if the user wants a real .mp4 we
  // ship the bytes to disk via writeBlob and then call this to run ffmpeg
  // in the main process. Returns { ok, mp4Path, durationMs, error? } —
  // never throws over the bridge.
  video: {
    transcodeWebmToMp4: (srcPath) =>
      ipcRenderer.invoke('io:transcodeWebmToMp4', { srcPath }),
  },

  // Forge-195 — Multi-window. The renderer can ask the main process to
  // spawn a new BrowserWindow with the same renderer + an optional
  // initial workbench (encoded in URL hash so the new renderer's
  // OnboardingTour / WorkbenchRail can read it on mount).
  win: {
    newWindow:    (opts)   => ipcRenderer.invoke('win:newWindow', opts || {}),
    listWindows:  ()       => ipcRenderer.invoke('win:listWindows'),
    closeWindow:  (id)     => ipcRenderer.invoke('win:closeWindow', { id }),
  },

  // Forge-197 — Webhook receiver. Renderer can start / stop the
  // embedded loopback HTTP listener and subscribe to incoming payloads.
  webhook: {
    start:  (opts)    => ipcRenderer.invoke('webhook:start', opts || {}),
    stop:   ()        => ipcRenderer.invoke('webhook:stop'),
    status: ()        => ipcRenderer.invoke('webhook:status'),
    onPayload: (cb) => {
      const handler = (_evt, payload) => { try { cb(payload); } catch {} };
      ipcRenderer.on('webhook:received', handler);
      return () => ipcRenderer.removeListener('webhook:received', handler);
    },
  },

  // weldments authoring (Forge-24) — structural members, end caps, gussets,
  // weld beads, member trims, BOM cut list.
  weldments: kernel && kernel.weldments ? {
    makePathEdge:     (x0, y0, z0, x1, y1, z1)          => kernel.weldments.makePathEdge(x0, y0, z0, x1, y1, z1),
    structuralMember: (path, profile, alignment)        => kernel.weldments.structuralMember(path, profile, alignment ?? 'centroid'),
    endCap:           (sh, openingEdgeId, capThk, off)  => kernel.weldments.endCap(sh, openingEdgeId, capThk, off ?? 0),
    gusset:           (sh, vertexId, size, thk)         => kernel.weldments.gusset(sh, vertexId, size, thk),
    weldBead:         (sh, edgeIds, beadSize, kind)     => kernel.weldments.weldBead(sh, edgeIds, beadSize, kind ?? 'fillet'),
    trimMember:       (a, b, mode)                      => kernel.weldments.trimMember(a, b, mode ?? 'butt'),
    cutList:          (root)                            => kernel.weldments.cutList(root),
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
    dialog: {
      openFile: (opts) => ipcRenderer.invoke('io:openDialog', opts || {}),
      saveFile: (opts) => ipcRenderer.invoke('io:saveDialog', opts || {}),
      writeBlob: (filepath, uint8array) => {
        const bytes = uint8array instanceof Uint8Array
          ? uint8array
          : new Uint8Array(uint8array || []);
        const base64 = Buffer.from(bytes).toString('base64');
        return ipcRenderer.invoke('io:writeBlob', { filepath, base64 });
      },
    },
    video: {
      transcodeWebmToMp4: (srcPath) =>
        ipcRenderer.invoke('io:transcodeWebmToMp4', { srcPath }),
    },
  });
}
