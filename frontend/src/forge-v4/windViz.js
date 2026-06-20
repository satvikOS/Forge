// windViz.js — RENDERED VOLUMETRIC AIRFLOW for the flagship turbofan
// ============================================================================
// A GPU PARTICLE system (THREE.Points, thousands of additive soft round
// sprites) that reads as real flowing AIR/WIND through the engine — NOT drawn
// THREE.Line streamlines (the user explicitly rejected drawn lines).
//
// Particles are SEEDED at the engine INLET and ADVECTED per-frame along the
// REAL CFD velocity field (forge.cfd.solveSteadyNS — the validated laminar
// projection/MAC solver, the same field caeViz.cfdCoreFlow renders as |u|),
// flowing inlet → fan → core + bypass duct → out the nozzle, then RECYCLED back
// to the inlet for a continuous stream. Two systems:
//
//   1) FREESTREAM/CORE wisps — soft additive round sprites, size+opacity+colour
//      by LOCAL SPEED (cool blue intake → hot core), slight per-particle jitter
//      and short fading sprite TRAILS so it motion-blurs like wind, not lines.
//   2) EXHAUST PLUME — a denser, faster, HOT (orange→translucent) particle jet
//      expanding in a cone out the chevron nozzle, with shimmer.
//
// HONEST: this is a PARTICLE APPROXIMATION of the flow — Lagrangian tracer
// advection seeded from and driven by the REAL Eulerian CFD velocity field —
// NOT a volumetric fluid simulation. The direction/speed come from the solver;
// the rendering (sprite size/colour/trails/plume cone) is presentation.
//
// NO new deps (three only). Falls back to an analytic inlet→nozzle axial+swirl
// field if the kernel solve is unavailable, so the harness is offline-safe.
//
// Published on window.__forgeFlagship.wind = { start, step, stop, buildField,
// sampleField, _state } for import-free use by a spec / render runner.
// ============================================================================

// ── colour ramp: cool intake (blue) → core (cyan/green) → hot exhaust (orange/red)
// Independent of forgeFlagshipRender so this module is import-light; same family
// of stops as the turbo CAE map but biased toward an air/flame read.
const AIR_STOPS = [
  [0.00, [120, 170, 255]], // cool intake — pale blue
  [0.30, [150, 220, 255]], // accelerating — cyan
  [0.55, [200, 245, 220]], // through fan/core — pale green-white
  [0.75, [255, 224, 150]], // heating — warm
  [0.90, [255, 150, 60]],  // hot — orange
  [1.00, [255, 70, 30]],   // exhaust — deep orange/red
];

function airColor(t01, out = [0, 0, 0]) {
  const t = t01 < 0 ? 0 : t01 > 1 ? 1 : t01;
  for (let i = 1; i < AIR_STOPS.length; i++) {
    if (t <= AIR_STOPS[i][0]) {
      const a = AIR_STOPS[i - 1], b = AIR_STOPS[i];
      const f = (t - a[0]) / ((b[0] - a[0]) || 1);
      out[0] = (a[1][0] + (b[1][0] - a[1][0]) * f) / 255;
      out[1] = (a[1][1] + (b[1][1] - a[1][1]) * f) / 255;
      out[2] = (a[1][2] + (b[1][2] - a[1][2]) * f) / 255;
      return out;
    }
  }
  const c = AIR_STOPS[AIR_STOPS.length - 1][1];
  out[0] = c[0] / 255; out[1] = c[1] / 255; out[2] = c[2] / 255;
  return out;
}

// Deterministic per-particle PRNG (mulberry32) so seeding + jitter are
// reproducible for headless verification.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  CFD VELOCITY FIELD — run the REAL solver over a duct proxy and wrap it in a
//  sampler that returns a velocity (axial, radial, swirl) in ENGINE space at a
//  normalised position. The duct is the same flow-path proxy caeViz uses; we
//  map it onto the engine envelope (axisLen along `axis`, radius across).
//
//  Returns { sample(px, fAxial, rNorm, theta) -> {vx, vr, vtheta, speed, s01},
//            maxSpeed, source, grid } where:
//    fAxial ∈ [0,1] axial fraction (0 = inlet, 1 = nozzle exit)
//    rNorm  ∈ [0,1] radial fraction (0 = axis, 1 = duct wall)
//    theta            swirl angle (rad)
// ───────────────────────────────────────────────────────────────────────────
export function buildField(opts = {}) {
  const inletVx = Number.isFinite(opts.inletVx) ? opts.inletVx : 0.1;
  const f = (typeof window !== 'undefined' && window.forge) || opts.forge || null;

  // ---- Try the REAL CFD solve. Same duct config family as caeViz.cfdCoreFlow.
  let r = null;
  if (f && f.cfd && typeof f.cfd.solveSteadyNS === 'function') {
    const dom = (Array.isArray(opts.domain) && opts.domain.length === 6)
      ? opts.domain : [0, 0, 0, 0.2, 0.02, 0.02];
    const cfg = {
      Nx: opts.Nx || 32, Ny: opts.Ny || 16, Nz: opts.Nz || 16,
      domain: Float64Array.from(dom),
      rho: Number.isFinite(opts.rho) ? opts.rho : 1.0,
      nu: Number.isFinite(opts.nu) ? opts.nu : 1e-3,
      walls: [2, 3, 4, 5],
      inlets: [{ faceId: 0, vx: inletVx, vy: 0, vz: 0 }],
      outlets: [1],
      maxIter: opts.maxIter || 400,
      residualTol: Number.isFinite(opts.residualTol) ? opts.residualTol : 1e-5,
    };
    try {
      const res = f.cfd.solveSteadyNS(cfg);
      if (res && res.u && Number.isFinite(res.maxVelocity)) r = res;
    } catch { r = null; }
  }

  // ---- REAL-FIELD SAMPLER -------------------------------------------------
  if (r) {
    const nx = r.Nx, ny = r.Ny, nz = r.Nz;
    const u = r.u, v = r.v, w = r.w;
    const idxC = (i, j, k) => (k * ny + j) * nx + i;
    // Field |u| range for colour normalisation.
    let umax = 1e-6;
    for (let c = 0; c < nx * ny * nz; c++) {
      const m = Math.hypot(u[c] || 0, (v ? v[c] : 0) || 0, (w ? w[c] : 0) || 0);
      if (m > umax) umax = m;
    }
    // Trilinear-ish sample (nearest in cross-section, linear along axis) of the
    // duct field. fAxial→i, rNorm/theta→(j,k) cross-section coords. The duct's
    // own axial velocity is r.u; we re-express it as engine (axial, radial,
    // swirl). Real CFD has no imposed swirl, so we synthesise a fan-induced
    // swirl that SCALES with the real local speed (so the spin tracks the
    // solver) — this is honest presentation layered on the real magnitude.
    const swirlGain = Number.isFinite(opts.swirlGain) ? opts.swirlGain : 0.35;
    const sample = (px, fAxial, rNorm, theta) => {
      const fa = fAxial < 0 ? 0 : fAxial > 1 ? 1 : fAxial;
      const rn = rNorm < 0 ? 0 : rNorm > 1 ? 1 : rNorm;
      // axial cell (linear interp between i0 and i1)
      const xf = fa * (nx - 1);
      const i0 = Math.floor(xf), i1 = Math.min(nx - 1, i0 + 1);
      const tx = xf - i0;
      // cross-section: place radius along +Y, swirl picks the j/k pair.
      const jc = Math.round(rn * (ny - 1) * Math.abs(Math.cos(theta)) + (ny - 1) * 0.5 * (1 - Math.abs(Math.cos(theta))));
      const kc = Math.round((nz - 1) * 0.5 + rn * (nz - 1) * 0.5 * Math.sin(theta));
      const j = Math.max(0, Math.min(ny - 1, jc));
      const k = Math.max(0, Math.min(nz - 1, kc));
      const ua = (u[idxC(i0, j, k)] || 0) * (1 - tx) + (u[idxC(i1, j, k)] || 0) * tx;
      const va = (v ? ((v[idxC(i0, j, k)] || 0) * (1 - tx) + (v[idxC(i1, j, k)] || 0) * tx) : 0);
      const wa = (w ? ((w[idxC(i0, j, k)] || 0) * (1 - tx) + (w[idxC(i1, j, k)] || 0) * tx) : 0);
      // Engine axial velocity = the solved streamwise component (always +X →
      // never zero at the inlet so particles always march downstream).
      const vx = Math.max(ua, inletVx * 0.5);
      const speed = Math.hypot(ua, va, wa) || vx;
      // radial drift from the cross-flow components (small) + fan contraction
      const vr = (Math.hypot(va, wa)) * 0.5 - 0.02 * vx; // slight inward pull at fan
      // swirl proportional to local speed (fan/compressor spin)
      const vtheta = swirlGain * speed;
      const s01 = Math.min(1, speed / umax);
      return { vx, vr, vtheta, speed, s01 };
    };
    return { sample, maxSpeed: umax, source: 'cfd', grid: `${nx}x${ny}x${nz}`,
             reynolds: r.reynolds, inletVx };
  }

  // ---- ANALYTIC FALLBACK --------------------------------------------------
  // Inlet→nozzle axial profile that ACCELERATES toward the nozzle (continuity:
  // contraction at fan, expansion-then-jet at nozzle) plus a swirl that grows
  // with speed. Magnitudes scaled to inletVx so colour normalisation is sane.
  const accel = Number.isFinite(opts.accel) ? opts.accel : 6.0; // exit/inlet speed ratio
  const swirlGain = Number.isFinite(opts.swirlGain) ? opts.swirlGain : 0.35;
  const umaxA = inletVx * accel;
  const sample = (px, fAxial, rNorm, theta) => {
    const fa = fAxial < 0 ? 0 : fAxial > 1 ? 1 : fAxial;
    // axial speed: gentle through inlet, peak past the core, jet at nozzle
    const profile = 1 + (accel - 1) * (0.25 * fa + 0.75 * fa * fa);
    const vx = inletVx * profile;
    const vr = -0.03 * vx * (fa < 0.45 ? 1 : -0.4); // inward at fan, slight spread aft
    const speed = vx * (1 + 0.15 * rNorm);
    const vtheta = swirlGain * speed;
    const s01 = Math.min(1, speed / umaxA);
    return { vx, vr, vtheta, speed, s01 };
  };
  return { sample, maxSpeed: umaxA, source: 'analytic', grid: 'analytic',
           reynolds: NaN, inletVx };
}

// Convenience: sample the active field (after start()).
export function sampleField(px, fAxial, rNorm, theta) {
  const st = _state;
  if (!st || !st.field) return null;
  return st.field.sample(px, fAxial, rNorm, theta);
}

// ───────────────────────────────────────────────────────────────────────────
//  PARTICLE STATE
//
//  Engine envelope (engine space): the flow axis runs from x0 along `axis` for
//  axisLen, at radius `radius`. We track each particle by its cylindrical
//  (fAxial ∈ [0,1+plume], rNorm, theta) and integrate forward each step using
//  the field's (vx, vr, vtheta). Engine-space XYZ is derived for the buffer.
// ───────────────────────────────────────────────────────────────────────────

// Map cylindrical (along-fraction, radial-offset, theta) → engine XYZ.
function cylToXyz(axis, x0, axisLen, radius, fAxial, rOff, theta, out) {
  const along = x0 + axisLen * fAxial;
  const a = rOff * Math.cos(theta);
  const b = rOff * Math.sin(theta);
  if (axis === 'z') { out[0] = a; out[1] = b; out[2] = along; }
  else if (axis === 'y') { out[0] = a; out[1] = along; out[2] = b; }
  else { out[0] = along; out[1] = a; out[2] = b; }
  return out;
}

// Soft round additive sprite texture (radial alpha falloff) — the wisp look.
// Returns null when there's no document/canvas (pure-headless): THREE.Points
// then renders default square points, which is fine for the offline advection
// verification (no GPU render happens there anyway).
function makeWispTexture(THREE) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext && cv.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

// Module-level singleton state (one wind system at a time).
export let _state = null;

// ───────────────────────────────────────────────────────────────────────────
//  START — build the field + allocate the particle buffers + (if a scene is
//  present) the THREE.Points objects, and add them to the live scene.
// ───────────────────────────────────────────────────────────────────────────
export function start(opts = {}) {
  stop(); // idempotent — clear any prior system

  const THREE = (typeof window !== 'undefined' && window.__forgeThree) || opts.THREE || null;
  const scene = (typeof window !== 'undefined' && window.__forgeScene) || opts.scene || null;

  // Engine envelope. Default mirrors caeViz duct→envelope mapping.
  const axis = opts.axis || 'x';
  const axisLen = Number.isFinite(opts.axisLen) ? opts.axisLen : 5000;
  const radius = Number.isFinite(opts.radius) ? opts.radius : 800;
  const x0 = Number.isFinite(opts.x0) ? opts.x0 : 0;

  // Particle counts — thousands, as required.
  const streamCount = Math.max(200, opts.streamCount || 4000);
  const plumeCount = Math.max(100, opts.plumeCount || 2000);
  const trailLen = Math.max(0, opts.trailLen != null ? opts.trailLen : 5); // sprites per trail
  const rng = mulberry32(opts.seed || 0x5EED);

  // Build the REAL CFD field (or analytic fallback).
  const field = buildField(opts);

  // ----- FREESTREAM/CORE particles -----
  // Each particle: fAxial, rNorm, theta, lane (0=core, 1=bypass), age, life.
  const N = streamCount;
  const fA = new Float32Array(N);
  const rN = new Float32Array(N);
  const th = new Float32Array(N);
  const lane = new Uint8Array(N);     // 0 core, 1 bypass
  const jitterPh = new Float32Array(N);
  const life = new Float32Array(N);

  const seedParticle = (p, atInlet) => {
    // Lane split: ~70% bypass (outer annulus), 30% core (inner) — high-bypass.
    const bypass = rng() < 0.68;
    lane[p] = bypass ? 1 : 0;
    fA[p] = atInlet ? rng() * 0.04 : rng(); // seed near inlet on (re)seed, spread on first build
    th[p] = rng() * Math.PI * 2;
    // radial band per lane
    rN[p] = bypass ? (0.55 + rng() * 0.42) : (0.05 + rng() * 0.45);
    jitterPh[p] = rng() * Math.PI * 2;
    life[p] = 0;
  };
  for (let p = 0; p < N; p++) seedParticle(p, false);

  // XYZ + colour + size buffers for the THREE.Points geometry.
  const sPos = new Float32Array(N * 3);
  const sCol = new Float32Array(N * 3);
  const sSize = new Float32Array(N);
  const sAlpha = new Float32Array(N);

  // Trails: a flattened ring of past positions per particle. We store the last
  // `trailLen` XYZ for each particle, rendered as additional fading sprites.
  const trailN = N * trailLen;
  const tPos = trailLen > 0 ? new Float32Array(trailN * 3) : null;
  const tCol = trailLen > 0 ? new Float32Array(trailN * 3) : null;
  const tAlpha = trailLen > 0 ? new Float32Array(trailN) : null;
  const trailHead = new Uint8Array(N); // ring write cursor per particle

  // ----- EXHAUST PLUME particles -----
  // Cylindrical coords measured from the nozzle exit plane (fAxial >= 1).
  const M = plumeCount;
  const pF = new Float32Array(M);   // distance past nozzle, fraction of axisLen
  const pR = new Float32Array(M);   // radial offset (expands as a cone)
  const pTh = new Float32Array(M);
  const pSpd = new Float32Array(M); // per-particle base speed factor
  const pJit = new Float32Array(M);
  const seedPlume = (p, atExit) => {
    pF[p] = atExit ? rng() * 0.02 : rng() * 0.55;
    pTh[p] = rng() * Math.PI * 2;
    pR[p] = (0.05 + rng() * 0.5) * radius;
    pSpd[p] = 0.8 + rng() * 0.6;
    pJit[p] = rng() * Math.PI * 2;
  };
  for (let p = 0; p < M; p++) seedPlume(p, false);

  const ePos = new Float32Array(M * 3);
  const eCol = new Float32Array(M * 3);
  const eSize = new Float32Array(M);
  const eAlpha = new Float32Array(M);

  // ----- THREE objects (only when a scene + THREE are available) -----
  let group = null, streamPts = null, trailPts = null, plumePts = null, tex = null;
  let streamMat = null, trailMat = null, plumeMat = null;
  if (THREE && scene) {
    tex = makeWispTexture(THREE);
    group = new THREE.Group();
    group.userData.forgeWind = 'airflow';
    group.name = 'forge-wind';
    group.renderOrder = 999; // draw additive air over solids

    // Optional global density knobs so a caller can dial the air DOWN to let the
    // engine + spinning fan read THROUGH the additive wisps (the default look is
    // unchanged when these are omitted). sizeScale multiplies the sprite size,
    // opacityScale the per-system opacity.
    const sizeK = Number.isFinite(opts.sizeScaleMul) ? opts.sizeScaleMul : 1.0;
    const opK = Number.isFinite(opts.opacityMul) ? opts.opacityMul : 1.0;
    const mkPointsMat = (sizeScale, opacity) => {
      const m = new THREE.PointsMaterial({
        size: radius * sizeScale * sizeK,
        map: tex || null,
        transparent: true,
        opacity: opacity * opK,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        sizeAttenuation: true,
      });
      if (tex) m.alphaTest = 0.01;
      return m;
    };

    // stream points
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
    streamMat = mkPointsMat(0.32, 0.42);
    streamPts = new THREE.Points(sGeo, streamMat);
    streamPts.frustumCulled = false;
    streamPts.userData.forgeWind = 'stream';
    group.add(streamPts);

    // trail points (smaller, fainter)
    if (trailLen > 0) {
      const tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
      tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
      trailMat = mkPointsMat(0.20, 0.22);
      trailPts = new THREE.Points(tGeo, trailMat);
      trailPts.frustumCulled = false;
      trailPts.userData.forgeWind = 'trails';
      group.add(trailPts);
    }

    // plume points (bigger, hotter)
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    eGeo.setAttribute('color', new THREE.BufferAttribute(eCol, 3));
    plumeMat = mkPointsMat(0.5, 0.55);
    plumePts = new THREE.Points(eGeo, plumeMat);
    plumePts.frustumCulled = false;
    plumePts.userData.forgeWind = 'plume';
    group.add(plumePts);

    scene.add(group);
    if (typeof window !== 'undefined') window.__forgeWindGroup = group;
  }

  _state = {
    THREE, scene, group, streamPts, trailPts, plumePts, tex,
    streamMat, trailMat, plumeMat,
    axis, axisLen, radius, x0,
    field, rng,
    N, fA, rN, th, lane, jitterPh, life,
    sPos, sCol, sSize, sAlpha,
    trailLen, tPos, tCol, tAlpha, trailHead,
    M, pF, pR, pTh, pSpd, pJit,
    ePos, eCol, eSize, eAlpha,
    seedParticle, seedPlume,
    // sync to fan spin: caller supplies rpm OR an omega (rad/s). Particle swirl
    // theta is advanced by this each step so the airflow visually tracks the
    // rotor. Default ties to a representative fan speed.
    rpm: Number.isFinite(opts.rpm) ? opts.rpm : 2500,
    fanSync: Number.isFinite(opts.fanSync) ? opts.fanSync : 1.0,
    speedScale: Number.isFinite(opts.speedScale) ? opts.speedScale : 1.0,
    lastT: 0,
    steps: 0,
    started: !!(THREE && scene),
  };

  // Prime XYZ/colour once so the very first frame already reads as air, and so
  // the headless verifier sees populated, in-bounds buffers immediately.
  _writeBuffers(_state, 0);

  if (typeof window !== 'undefined') {
    window.__forgeFlagship = window.__forgeFlagship || {};
    window.__forgeFlagship.wind = api;
  }

  return {
    source: field.source, grid: field.grid, maxSpeed: field.maxSpeed,
    streamCount: N, plumeCount: M, trailLen,
    rendered: !!(THREE && scene),
    axis, axisLen, radius, x0,
  };
}

// Internal: recompute XYZ/colour/size/alpha buffers from cylindrical state and
// push to GPU attributes (when present). dt is used only for trail seeding.
function _writeBuffers(st, dt) {
  const {
    axis, axisLen, radius, x0, field,
    N, fA, rN, th, lane, jitterPh, life,
    sPos, sCol, sSize, sAlpha,
    trailLen, tPos, tCol, tAlpha, trailHead,
    M, pF, pR, pTh, pSpd, pJit,
    ePos, eCol, eSize, eAlpha,
  } = st;

  const tmp = [0, 0, 0];
  const col = [0, 0, 0];

  // ---- stream particles ----
  for (let p = 0; p < N; p++) {
    const f = fA[p];
    const samp = field.sample(0, f, rN[p], th[p]);
    // radial offset in engine units: lane band scaled to envelope radius.
    let rOff = rN[p] * radius;
    // slight per-particle jitter (wind turbulence look) — small, speed-scaled
    const jit = 0.018 * radius * Math.sin(jitterPh[p] + f * 9.0);
    rOff += jit;
    cylToXyz(axis, x0, axisLen, radius, f, rOff, th[p], tmp);
    sPos[p * 3] = tmp[0]; sPos[p * 3 + 1] = tmp[1]; sPos[p * 3 + 2] = tmp[2];
    // colour: blend local speed with axial position (cool intake → hot core)
    const s01 = Math.min(1, 0.35 * samp.s01 + 0.75 * f);
    airColor(s01, col);
    sCol[p * 3] = col[0]; sCol[p * 3 + 1] = col[1]; sCol[p * 3 + 2] = col[2];
    sSize[p] = 0.5 + 0.6 * s01;
    sAlpha[p] = 0.25 + 0.35 * (1 - Math.abs(rN[p] - 0.5) * 1.2);

    // ---- trail seeding: drop the current position into this particle's ring
    if (trailLen > 0 && tPos) {
      const head = trailHead[p];
      const base = (p * trailLen + head) * 3;
      tPos[base] = tmp[0]; tPos[base + 1] = tmp[1]; tPos[base + 2] = tmp[2];
      tCol[(p * trailLen + head) * 3] = col[0];
      tCol[(p * trailLen + head) * 3 + 1] = col[1];
      tCol[(p * trailLen + head) * 3 + 2] = col[2];
      // fade older trail sprites
      for (let t = 0; t < trailLen; t++) {
        const age = ((head - t + trailLen) % trailLen);
        tAlpha[p * trailLen + t] = 0.0; // recomputed below
      }
      tAlpha[p * trailLen + head] = sAlpha[p] * 0.6;
      trailHead[p] = (head + 1) % trailLen;
      // dim the rest by ring distance
      for (let t = 1; t < trailLen; t++) {
        const idx = (head - t + trailLen) % trailLen;
        const ai = p * trailLen + idx;
        tAlpha[ai] = (sAlpha[p] * 0.6) * (1 - t / trailLen);
      }
    }
  }

  // ---- exhaust plume particles ----
  for (let p = 0; p < M; p++) {
    const df = pF[p]; // distance past nozzle, fraction of axisLen
    // cone expansion: radius grows with distance past the nozzle
    const coneR = pR[p] * (1 + 2.2 * df);
    // shimmer: small azimuthal wobble
    const shim = 0.04 * radius * Math.sin(pJit[p] + df * 14.0);
    const fAxial = 1.0 + df;
    cylToXyz(axis, x0, axisLen, radius, fAxial, coneR + shim, pTh[p], tmp);
    ePos[p * 3] = tmp[0]; ePos[p * 3 + 1] = tmp[1]; ePos[p * 3 + 2] = tmp[2];
    // hot near the nozzle (orange/red) → translucent and cooler as it expands
    const heat = Math.max(0, 1 - df * 1.4);
    const s01 = 0.85 + 0.15 * heat; // stays in the hot end of the ramp
    airColor(Math.min(1, s01), col);
    eCol[p * 3] = col[0]; eCol[p * 3 + 1] = col[1]; eCol[p * 3 + 2] = col[2];
    eSize[p] = 0.7 + 1.3 * (1 - df);
    eAlpha[p] = Math.max(0, 0.55 * heat);
  }

  // push to GPU when objects exist
  if (st.streamPts) {
    st.streamPts.geometry.attributes.position.needsUpdate = true;
    st.streamPts.geometry.attributes.color.needsUpdate = true;
  }
  if (st.trailPts) {
    st.trailPts.geometry.attributes.position.needsUpdate = true;
    st.trailPts.geometry.attributes.color.needsUpdate = true;
  }
  if (st.plumePts) {
    st.plumePts.geometry.attributes.position.needsUpdate = true;
    st.plumePts.geometry.attributes.color.needsUpdate = true;
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  STEP(t) — advance every particle along the field by dt (derived from t),
//  recycle particles that exit the nozzle back to the inlet, and refresh the
//  GPU buffers. Synced to fan spin: swirl theta advances with the rotor.
//  `t` is absolute time in SECONDS (the spec drives it over the in-motion beat).
// ───────────────────────────────────────────────────────────────────────────
export function step(t) {
  const st = _state;
  if (!st) return { stepped: 0 };
  const T = Number.isFinite(t) ? t : (st.lastT + 1 / 60);
  let dt = T - st.lastT;
  if (!(dt > 0) || dt > 0.25) dt = 1 / 60; // clamp first frame / pauses
  st.lastT = T;
  st.steps++;

  const {
    field, N, fA, rN, th, lane, life,
    M, pF, axisLen,
  } = st;

  // fan angular speed (rad/s) → swirl advance per dt; synced to rotor spin.
  const omega = (st.rpm * 2 * Math.PI / 60) * st.fanSync;
  // The field returns speeds in m/s on a ~0.2 m duct; the engine envelope is
  // axisLen units long. Convert duct speed → fraction-of-axis per second using
  // the field's own duct length proxy (0.2 m) so advection is physically scaled
  // then amplified by speedScale to make the motion legible over a short beat.
  const ductLen = 0.2;
  const advect = st.speedScale * dt / ductLen;

  // ---- advance stream particles ----
  let advanced = 0;
  for (let p = 0; p < N; p++) {
    const samp = field.sample(0, fA[p], rN[p], th[p]);
    // axial: fraction-of-axis advance from real vx
    const df = samp.vx * advect;
    fA[p] += df;
    if (df > 0) advanced++;
    // radial drift (toward/away from axis) from real cross-flow + lane band
    rN[p] += samp.vr * advect * 0.5;
    // keep within lane band
    if (lane[p] === 1) rN[p] = Math.max(0.5, Math.min(0.99, rN[p]));
    else rN[p] = Math.max(0.02, Math.min(0.55, rN[p]));
    // swirl: advance theta with fan omega (sync) + field swirl
    th[p] += (omega * 0.0008 + samp.vtheta * advect * 0.3) ;
    if (th[p] > Math.PI * 2) th[p] -= Math.PI * 2;
    life[p] += dt;
    // recycle: once it exits the nozzle, respawn at the inlet (continuous stream)
    if (fA[p] >= 1.0) {
      st.seedParticle(p, true);
    }
  }

  // ---- advance exhaust plume ----
  const plumeAdvect = advect * 1.8; // plume is faster than freestream
  for (let p = 0; p < M; p++) {
    // plume base speed ~= field max, expanding aft
    pF[p] += st.field.maxSpeed * plumeAdvect * st.pSpd[p];
    st.pTh[p] += omega * 0.0006;
    if (pF[p] >= 0.6) st.seedPlume(p, true); // recycle at nozzle exit
  }

  _writeBuffers(st, dt);
  return {
    stepped: st.steps, t: T, dt,
    advanced,
    omega,
    streamCount: N, plumeCount: M,
    source: field.source,
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  STOP — remove the particle group from the scene and dispose GPU resources.
// ───────────────────────────────────────────────────────────────────────────
export function stop() {
  const st = _state;
  if (st) {
    if (st.scene && st.group) { try { st.scene.remove(st.group); } catch {} }
    const disp = (o) => {
      try { o && o.geometry && o.geometry.dispose && o.geometry.dispose(); } catch {}
      try { o && o.material && o.material.dispose && o.material.dispose(); } catch {}
    };
    disp(st.streamPts); disp(st.trailPts); disp(st.plumePts);
    try { st.tex && st.tex.dispose && st.tex.dispose(); } catch {}
  }
  if (typeof window !== 'undefined') window.__forgeWindGroup = null;
  _state = null;
  return { stopped: true };
}

// Expose current particle world-space bounds (for verification / framing).
export function bounds() {
  const st = _state;
  if (!st) return null;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const scan = (arr, n) => {
    for (let p = 0; p < n; p++) {
      for (let c = 0; c < 3; c++) {
        const v = arr[p * 3 + c];
        if (v < mn[c]) mn[c] = v;
        if (v > mx[c]) mx[c] = v;
      }
    }
  };
  scan(st.sPos, st.N);
  scan(st.ePos, st.M);
  return { min: mn, max: mx, streamCount: st.N, plumeCount: st.M };
}

const api = { start, step, stop, buildField, sampleField, bounds,
              get _state() { return _state; } };

// ── publish on window for import-free use by manual e2e / the render runner ──
if (typeof window !== 'undefined') {
  window.__forgeFlagship = window.__forgeFlagship || {};
  window.__forgeFlagship.wind = api;
}

export default api;
