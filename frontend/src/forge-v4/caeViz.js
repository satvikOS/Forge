// caeViz.js — EQUATION-GROUNDED CAE POST-PROCESSOR for the flagship viewport
// ============================================================================
// An Ansys/Abaqus-grade CAE visualisation layer that is driven by the VALIDATED
// native kernel solvers (FORGE_PHYSICS_VERIFICATION / forge-physics-rigor-met):
//
//   • forge.fea.solveStatic     — real per-element von-Mises field (verified
//                                  cantilever tip-deflection 0.2–0.33% vs PL³/3EI,
//                                  modal f1 within the consistent-mass gate)
//   • forge.cfd.solveSteadyNS   — real cell-centre velocity + pressure field
//                                  (channel Poiseuille peak/mean ≈ 1.5 verified,
//                                  laminar projection/MAC, no turbulence model)
//   • forge.simulate.multibodyDynamics — real constrained Newton–Euler EOM
//                                  (rotor spin-up ω=αt 0.00%, pendulum 0.016%)
//
// What this module does — and explicitly does NOT do:
//   ✓ runs the REAL solvers and reads the REAL fields (von-Mises array, |u|
//     field, ω(t)); NOTHING here fabricates physics — if the kernel is offline
//     the call returns { error } rather than a decorative colormap.
//   ✓ paints a SMOOTH per-vertex (nodal-averaged) contour with a turbo colormap,
//     a MPa / m·s⁻¹ legend scale-bar, the peak value, and on-canvas GOVERNING
//     EQUATIONS next to each live field with the real solved numbers.
//   ✗ does NOT invent fields, does NOT use turbulence/transition modelling
//     (laminar only — stated on the CFD overlay), does NOT smooth across solver
//     error (nodal averaging is the standard Ansys/Abaqus surface-recovery, not
//     a beautification of bad data).
//
// Units: SI from the kernel (Pa, m, m/s, rad/s); displayed in MPa / m·s⁻¹.
// Operates entirely on the window surfaces the viewport already publishes:
//   window.__forgeThree / __forgeScene / __forgeRenderer / forge (kernel addon)
// No new npm/C++ deps, no network — matches feedback-forge-native-no-deps.
// ============================================================================

// ───────────────────────────────────────────────────────────────────────────
//  Turbo / jet colormap (blue → cyan → green → yellow → red) — the canonical
//  CAE field ramp. Returns [r,g,b] in 0..1 for a THREE vertex colour.
// ───────────────────────────────────────────────────────────────────────────
const TURBO = [
  [0.00, [0.188, 0.071, 0.231]], // deep indigo
  [0.25, [0.129, 0.565, 1.000]], // blue
  [0.50, [0.149, 0.878, 0.557]], // green
  [0.70, [0.945, 0.898, 0.235]], // yellow
  [0.85, [1.000, 0.518, 0.157]], // orange
  [1.00, [0.863, 0.141, 0.125]], // red
];
function turbo01(t01) {
  const t = Math.max(0, Math.min(1, t01));
  for (let i = 1; i < TURBO.length; i++) {
    if (t <= TURBO[i][0]) {
      const [t0, c0] = TURBO[i - 1];
      const [t1, c1] = TURBO[i];
      const f = (t - t0) / ((t1 - t0) || 1);
      return [c0[0] + (c1[0] - c0[0]) * f,
              c0[1] + (c1[1] - c0[1]) * f,
              c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return TURBO[TURBO.length - 1][1].slice();
}
function turboHex(t01) {
  const c = turbo01(t01);
  const h = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

// ───────────────────────────────────────────────────────────────────────────
//  Kernel access — never fabricate physics. Returns null when not available so
//  the caller surfaces the REAL "kernel not ready" error.
// ───────────────────────────────────────────────────────────────────────────
function kernel() {
  if (typeof window === 'undefined') return null;
  const f = window.forge;
  if (!f) return null;
  if (typeof f.isReady === 'function' && !f.isReady()) return null;
  return f;
}
function three() { return (typeof window !== 'undefined') ? window.__forgeThree : null; }
function scene() { return (typeof window !== 'undefined') ? window.__forgeScene : null; }

// The 6 quad faces of an 8-node linear hex in the kernel's canonical OCCT/Abaqus
// node ordering (see forge-kernel/src/Fea.cpp): each entry is 4 local node idx.
//        7-------6
//       /|      /|
//      4-------5 |
//      | 3-----|-2
//      |/      |/
//      0-------1
const HEX_FACES = [
  [0, 1, 2, 3], // ζ- bottom
  [4, 5, 6, 7], // ζ+ top
  [0, 1, 5, 4], // η- front
  [3, 2, 6, 7], // η+ back
  [0, 3, 7, 4], // ξ- left
  [1, 2, 6, 5], // ξ+ right
];

// Face occupancy key (sorted node ids) so we can keep only the OUTER skin of the
// brick mesh — exactly the surface a CAE post-processor contours.
function faceKey(a, b, c, d) {
  return [a, b, c, d].sort((x, y) => x - y).join(',');
}

// ───────────────────────────────────────────────────────────────────────────
//  NODAL AVERAGING — convert the kernel's PER-ELEMENT von-Mises (one scalar per
//  hex, vonMises[e]) into a smooth PER-NODE field by averaging every element
//  incident on each node. This is the standard Ansys/Abaqus "unaveraged →
//  averaged" surface stress recovery, NOT a cosmetic blur.
// ───────────────────────────────────────────────────────────────────────────
function nodalAverage(mesh, elemScalar) {
  const nNodes = mesh.nodeCount;
  const ENC = mesh.elemNodeCount || 8;
  const nElems = mesh.elemCount;
  const acc = new Float64Array(nNodes);
  const cnt = new Float64Array(nNodes);
  for (let e = 0; e < nElems; e++) {
    const v = elemScalar[e];
    if (!Number.isFinite(v)) continue;
    for (let i = 0; i < ENC; i++) {
      const nid = mesh.tets[e * ENC + i];
      acc[nid] += v;
      cnt[nid] += 1;
    }
  }
  const out = new Float64Array(nNodes);
  for (let n = 0; n < nNodes; n++) out[n] = cnt[n] > 0 ? acc[n] / cnt[n] : 0;
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
//  CONTOUR GEOMETRY — build a THREE.Mesh from the FEA hex mesh outer skin,
//  with one position per (face, corner) and a per-vertex turbo colour from the
//  nodal-averaged field. Optionally deform by the displacement field u, scaled.
// ───────────────────────────────────────────────────────────────────────────
function buildContourMesh(mesh, nodalField, fieldMin, fieldMax, opts = {}) {
  const THREE = three();
  if (!THREE) return null;
  const ENC = mesh.elemNodeCount || 8;
  const nElems = mesh.elemCount;
  const span = (fieldMax - fieldMin) || 1;

  // 1) count outer faces (those referenced by exactly one element).
  const seen = new Map();
  for (let e = 0; e < nElems; e++) {
    for (const f of HEX_FACES) {
      const g = [mesh.tets[e * ENC + f[0]], mesh.tets[e * ENC + f[1]],
                 mesh.tets[e * ENC + f[2]], mesh.tets[e * ENC + f[3]]];
      const k = faceKey(g[0], g[1], g[2], g[3]);
      const prev = seen.get(k);
      if (prev) prev.count++;
      else seen.set(k, { nodes: g, count: 1 });
    }
  }

  // 2) displacement scale: target a visible deflection (~6% of model diagonal)
  //    when a u field is supplied, else 0 (undeformed contour).
  const u = opts.u || null;
  let dScale = 0;
  if (u && opts.deform !== false) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let maxDisp = 0;
    for (let n = 0; n < mesh.nodeCount; n++) {
      for (let k = 0; k < 3; k++) {
        const c = mesh.nodes[3 * n + k];
        if (c < lo[k]) lo[k] = c;
        if (c > hi[k]) hi[k] = c;
      }
      const dx = u[3 * n] || 0, dy = u[3 * n + 1] || 0, dz = u[3 * n + 2] || 0;
      const d = Math.hypot(dx, dy, dz);
      if (d > maxDisp) maxDisp = d;
    }
    const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    dScale = (maxDisp > 0) ? (opts.deformFraction ?? 0.06) * diag / maxDisp : 0;
  }

  // 3) emit per-corner vertices for every OUTER quad → 2 triangles.
  const pos = [], col = [];
  const pushVert = (nid) => {
    let x = mesh.nodes[3 * nid], y = mesh.nodes[3 * nid + 1], z = mesh.nodes[3 * nid + 2];
    if (dScale && u) {
      x += (u[3 * nid] || 0) * dScale;
      y += (u[3 * nid + 1] || 0) * dScale;
      z += (u[3 * nid + 2] || 0) * dScale;
    }
    pos.push(x, y, z);
    const t = (nodalField[nid] - fieldMin) / span;
    const c = turbo01(t);
    col.push(c[0], c[1], c[2]);
  };
  for (const { nodes, count } of seen.values()) {
    if (count !== 1) continue; // interior face — skip (keep outer skin only)
    const [a, b, c, d] = nodes;
    pushVert(a); pushVert(b); pushVert(c);
    pushVert(a); pushVert(c); pushVert(d);
  }
  if (!pos.length) return null;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.05, roughness: 0.65,
    side: THREE.DoubleSide, flatShading: false,
  });
  const m = new THREE.Mesh(geom, mat);
  m.userData.forgeCae = 'fea-contour';
  return { mesh: m, vertexCount: pos.length / 3, deformScale: dScale };
}

// ───────────────────────────────────────────────────────────────────────────
//  HTML OVERLAY — legend scale-bar + governing-equation annotation, drawn over
//  the live canvas (THREE renders the field; HTML labels it like a real CAE
//  post-processor). All overlays carry data-forge-cae so a later call clears.
// ───────────────────────────────────────────────────────────────────────────
function overlayHost() {
  if (typeof document === 'undefined') return null;
  const gl = (typeof window !== 'undefined') ? window.__forgeRenderer : null;
  const canvas = gl && gl.domElement ? gl.domElement : document.querySelector('canvas');
  const parent = (canvas && canvas.parentElement) ? canvas.parentElement : document.body;
  if (parent && getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  return parent;
}

function fmtSci(x, units) {
  if (!Number.isFinite(x)) return `— ${units}`;
  const a = Math.abs(x);
  if (a !== 0 && (a < 0.01 || a >= 1e4)) return `${x.toExponential(2)} ${units}`;
  return `${x.toPrecision(4)} ${units}`;
}

/**
 * Render the colour scale-bar legend with N labelled ticks (MPa or m/s …).
 * @returns {HTMLElement|null}
 */
export function renderLegend({ title, unit, min, max, ticks = 6, peakLabel } = {}) {
  const host = overlayHost();
  if (!host) return null;
  const el = document.createElement('div');
  el.setAttribute('data-forge-cae', 'legend');
  el.style.cssText = [
    'position:absolute', 'top:16px', 'right:16px', 'z-index:40',
    'font:12px/1.35 "Inter",system-ui,sans-serif', 'color:#e8edf2',
    'background:rgba(14,18,24,0.82)', 'backdrop-filter:blur(6px)',
    'border:1px solid rgba(255,255,255,0.10)', 'border-radius:8px',
    'padding:12px 14px', 'box-shadow:0 6px 24px rgba(0,0,0,0.45)',
    'min-width:150px', 'letter-spacing:0.2px',
  ].join(';');

  const head = document.createElement('div');
  head.style.cssText = 'font-weight:600;margin-bottom:8px;font-size:12.5px;color:#fff;';
  head.textContent = title || 'Field';
  el.appendChild(head);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:stretch;';

  // colour bar
  const bar = document.createElement('div');
  bar.style.cssText = 'width:18px;border-radius:3px;height:150px;border:1px solid rgba(255,255,255,0.12);';
  const stops = [];
  for (let i = 0; i <= 24; i++) {
    const t = 1 - i / 24; // top = max
    stops.push(`${turboHex(t)} ${(i / 24 * 100).toFixed(1)}%`);
  }
  bar.style.background = `linear-gradient(to bottom, ${stops.join(',')})`;
  row.appendChild(bar);

  // tick labels (top=max … bottom=min)
  const labels = document.createElement('div');
  labels.style.cssText = 'display:flex;flex-direction:column;justify-content:space-between;height:150px;';
  for (let i = 0; i < ticks; i++) {
    const t = 1 - i / (ticks - 1);
    const v = min + (max - min) * t;
    const lab = document.createElement('div');
    lab.style.cssText = 'font-variant-numeric:tabular-nums;color:#cfd6dd;';
    lab.textContent = (Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 0.01))
      ? v.toExponential(2) : v.toPrecision(3);
    labels.appendChild(lab);
  }
  row.appendChild(labels);
  el.appendChild(row);

  const foot = document.createElement('div');
  foot.style.cssText = 'margin-top:8px;font-size:11px;color:#9aa6b1;';
  foot.textContent = unit ? `[ ${unit} ]` : '';
  el.appendChild(foot);

  if (peakLabel) {
    const peak = document.createElement('div');
    peak.style.cssText = 'margin-top:6px;font-weight:600;color:#ff8f6b;font-size:12px;';
    peak.textContent = peakLabel;
    el.appendChild(peak);
  }
  host.appendChild(el);
  return el;
}

/**
 * Render an on-canvas governing-equation annotation card with the live solved
 * numbers. `equations` is an array of {tex|text} lines; `values` an array of
 * {label, value} rows. Rendered as crisp HTML (no MathJax dep — the PDE is
 * written in a clear unicode form an engineer reads at a glance).
 */
export function renderEquationCard({ title, equations = [], values = [], scope, position = 'left' } = {}) {
  const host = overlayHost();
  if (!host) return null;
  const el = document.createElement('div');
  el.setAttribute('data-forge-cae', 'equation');
  const side = position === 'right' ? 'right:16px' : 'left:16px';
  el.style.cssText = [
    'position:absolute', 'top:16px', side, 'z-index:40', 'max-width:360px',
    'font:13px/1.5 "Inter",system-ui,sans-serif', 'color:#e8edf2',
    'background:rgba(14,18,24,0.82)', 'backdrop-filter:blur(6px)',
    'border:1px solid rgba(255,255,255,0.10)', 'border-radius:8px',
    'padding:14px 16px', 'box-shadow:0 6px 24px rgba(0,0,0,0.45)',
  ].join(';');

  const head = document.createElement('div');
  head.style.cssText = 'font-weight:600;margin-bottom:10px;color:#fff;font-size:13.5px;';
  head.textContent = title || 'Governing equations';
  el.appendChild(head);

  for (const eq of equations) {
    const line = document.createElement('div');
    line.style.cssText = [
      'font-family:"Cambria Math","Latin Modern Math",Georgia,serif',
      'font-size:15px', 'color:#bfe3ff', 'margin:4px 0',
      'padding:4px 8px', 'background:rgba(40,90,140,0.18)', 'border-radius:5px',
      'white-space:nowrap', 'overflow-x:auto',
    ].join(';');
    line.textContent = typeof eq === 'string' ? eq : (eq.text || eq.tex || '');
    el.appendChild(line);
  }

  if (values.length) {
    const tbl = document.createElement('div');
    tbl.style.cssText = 'margin-top:10px;border-top:1px solid rgba(255,255,255,0.10);padding-top:8px;';
    for (const v of values) {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;justify-content:space-between;gap:18px;margin:3px 0;';
      const k = document.createElement('span');
      k.style.cssText = 'color:#9aa6b1;';
      k.textContent = v.label;
      const val = document.createElement('span');
      val.style.cssText = 'font-variant-numeric:tabular-nums;font-weight:600;color:#fff;';
      val.textContent = v.value;
      r.appendChild(k); r.appendChild(val);
      tbl.appendChild(r);
    }
    el.appendChild(tbl);
  }

  if (scope) {
    const s = document.createElement('div');
    s.style.cssText = 'margin-top:9px;font-size:11px;color:#8b97a2;font-style:italic;';
    s.textContent = scope;
    el.appendChild(s);
  }
  host.appendChild(el);
  return el;
}

/** Remove every CAE overlay (legend + equation cards) and contour mesh. */
export function clearCaeOverlays() {
  if (typeof document !== 'undefined') {
    document.querySelectorAll('[data-forge-cae]').forEach((n) => n.remove());
  }
  const sc = scene();
  if (sc) {
    const dead = [];
    sc.traverse((o) => { if (o.userData && o.userData.forgeCae) dead.push(o); });
    for (const o of dead) {
      try { sc.remove(o); o.geometry?.dispose?.(); o.material?.dispose?.(); } catch { /* ignore */ }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Body / shape resolution — find a flagship body to analyse. The fan blade is
//  preferred; any handle works. Accepts a numeric handle, a {handle} body, or
//  a name substring matched against the supplied bodies list.
// ───────────────────────────────────────────────────────────────────────────
function resolveShape(bodies, prefer) {
  if (typeof prefer === 'number' && prefer > 0) return { handle: prefer, name: 'shape', body: null };
  const list = Array.isArray(bodies) ? bodies : [];
  if (prefer && typeof prefer === 'object' && typeof prefer.handle === 'number') {
    return { handle: prefer.handle, name: prefer.name || 'shape', body: prefer };
  }
  const wants = typeof prefer === 'string' ? prefer.toLowerCase() : 'blade';
  let hit = list.find((b) => typeof b.handle === 'number' &&
    String(b.name || '').toLowerCase().includes(wants));
  if (!hit) hit = list.find((b) => typeof b.handle === 'number' &&
    /blade|airfoil|vane|rotor/.test(String(b.name || '').toLowerCase()));
  if (!hit) hit = list.find((b) => typeof b.handle === 'number');
  return hit ? { handle: hit.handle, name: hit.name || 'shape', body: hit } : null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  (a) FEA von-Mises CONTOUR on the FAN BLADE
//      Real solver: forge.fea.meshFromBrep + forge.fea.solveStatic
//      Field:       r.vonMises (per element) → nodal-averaged → per-vertex
//      Equations:   ∇·σ + b = 0,  σ = C:ε,  K u = F
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @param {Array} bodies         engine bodies [{handle,name,...}]
 * @param {object} opts
 *   shape         numeric handle | name substring | {handle} (default: fan blade)
 *   material      {E,nu,rho} (default Ti-6Al-4V — fan-blade alloy)
 *   meshSizeM     target element size in METRES (default auto from bbox)
 *   fixedFace     0..5 face bit clamped (default 0 = -X root)
 *   loadFace      0..5 face bit loaded (default 1 = +X tip)
 *   force         [fx,fy,fz] total load (N) on loadFace (default centrifugal-ish pull)
 *   deform        render the deformed shape (default true)
 *   render        mount the contour + overlays into the live scene (default true)
 * @returns {object} { error? , maxVonMises_MPa, maxDisplacement_m, nodes, elements, ... }
 */
export function feaContourBlade(bodies = [], opts = {}) {
  const f = kernel();
  if (!f || !f.fea || typeof f.fea.solveStatic !== 'function') {
    return { error: 'kernel not ready — forge.fea.solveStatic unavailable' };
  }
  const target = resolveShape(bodies, opts.shape ?? 'blade');
  if (!target) return { error: 'no analysable body supplied (need a handle or a named blade)' };

  // Ti-6Al-4V — the real fan-blade alloy (titanium).
  const material = opts.material || { E: 113.8e9, nu: 0.342, rho: 4430 };

  // Mesh size: auto from the body AABB if not given, so a physical-scale blade
  // (metres) and a small test box both mesh sensibly (~12 elems along longest).
  let meshSizeM = opts.meshSizeM;
  if (!(meshSizeM > 0)) {
    try {
      const mp = f.massProps ? f.massProps(target.handle) : null;
      const v = mp && mp.volume > 0 ? mp.volume : null;
      meshSizeM = v ? Math.cbrt(v) / 4 : 0.01;
    } catch { meshSizeM = 0.01; }
  }

  let mesh;
  try {
    mesh = f.fea.meshFromBrep(target.handle, meshSizeM);
  } catch (e) { return { error: `meshFromBrep failed: ${e.message || e}` }; }
  if (!mesh || !mesh.nodeCount || !mesh.elemCount) {
    return { error: 'FEA mesh empty — shape invalid or mesh size too coarse' };
  }

  // BCs / loads: clamp the root face, pull the tip face. nodeToFace is a bitmask.
  const fixedBit = opts.fixedFace ?? 0;
  const loadBit = opts.loadFace ?? 1;
  const bcs = [], loadIds = [];
  for (let i = 0; i < mesh.nodeCount; i++) {
    if (mesh.nodeToFace[i] & (1 << fixedBit)) bcs.push({ nodeId: i, fx: true, fy: true, fz: true });
    if (mesh.nodeToFace[i] & (1 << loadBit)) loadIds.push(i);
  }
  if (!bcs.length) return { error: `no nodes on fixed face bit ${fixedBit}` };
  // Default load: a centrifugal-like spanwise pull + bending (N). Scale to body.
  const F = Array.isArray(opts.force) && opts.force.length === 3 ? opts.force : [8000, 0, -2000];
  const n = loadIds.length || 1;
  const loads = loadIds.map((id) => ({ nodeId: id, fx: F[0] / n, fy: F[1] / n, fz: F[2] / n }));

  let r;
  try {
    r = f.fea.solveStatic(mesh, material, loads, [], bcs);
  } catch (e) { return { error: `solveStatic failed: ${e.message || e}` }; }
  if (!r || !r.vonMises || !r.vonMises.length) {
    return { error: 'solveStatic returned no von-Mises field' };
  }

  // REAL field → nodal-averaged per-vertex contour.
  const nodal = nodalAverage(mesh, r.vonMises);
  let vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < nodal.length; i++) {
    if (nodal[i] < vMin) vMin = nodal[i];
    if (nodal[i] > vMax) vMax = nodal[i];
  }
  if (!Number.isFinite(vMin)) vMin = 0;
  if (!Number.isFinite(vMax) || vMax <= vMin) vMax = vMin + 1;

  // Peak nodal displacement magnitude.
  let maxDisp = 0;
  const u = r.u || [];
  for (let i = 0; i < mesh.nodeCount; i++) {
    const d = Math.hypot(u[3 * i] || 0, u[3 * i + 1] || 0, u[3 * i + 2] || 0);
    if (d > maxDisp) maxDisp = d;
  }

  const peakMPa = r.maxVonMises / 1e6;
  const sigmaY_MPa = (material.sigmaY ? material.sigmaY : 880e6) / 1e6; // Ti-6Al-4V yield ≈ 880 MPa
  const out = {
    op: 'fea-static',
    shape: target.name, handle: target.handle,
    nodes: mesh.nodeCount, elements: mesh.elemCount, meshSizeM,
    maxVonMises_Pa: r.maxVonMises, maxVonMises_MPa: peakMPa,
    maxAtElem: r.maxAtElem, residual: r.residual,
    maxDisplacement_m: maxDisp,
    fieldMin_MPa: vMin / 1e6, fieldMax_MPa: vMax / 1e6,
    safetyFactor: sigmaY_MPa / (peakMPa || 1e-9),
    material,
  };

  if (opts.render === false || !three() || !scene()) return out;

  // Mount contour + overlays.
  clearCaeOverlays();
  const built = buildContourMesh(mesh, nodal, vMin, vMax, {
    u: opts.deform === false ? null : r.u, deform: opts.deform !== false,
    deformFraction: opts.deformFraction,
  });
  if (built && built.mesh) {
    scene().add(built.mesh);
    out.contourVertices = built.vertexCount;
    out.deformScale = built.deformScale;
  }
  renderLegend({
    title: 'σ_vM von Mises',
    unit: 'MPa', min: vMin / 1e6, max: vMax / 1e6, ticks: 6,
    peakLabel: `peak σ_max = ${peakMPa.toPrecision(4)} MPa`,
  });
  renderEquationCard({
    title: 'FEM equilibrium — linear elasticity',
    equations: [
      '∇·σ + b = 0',
      'σ = C : ε,   ε = ½(∇u + ∇uᵀ)',
      'K u = F',
    ],
    values: [
      { label: 'σ_max (von Mises)', value: `${peakMPa.toPrecision(4)} MPa` },
      { label: 'peak displacement', value: fmtSci(maxDisp, 'm') },
      { label: 'safety factor (Ti-6Al-4V)', value: out.safetyFactor.toPrecision(3) },
      { label: 'nodes / elements', value: `${mesh.nodeCount} / ${mesh.elemCount}` },
      { label: 'solver residual', value: r.residual != null ? r.residual.toExponential(2) : '—' },
    ],
    scope: 'Hex8 incompatible-modes FEA · validated 0.2–0.33% vs PL³/3EI · deformed × auto-scale',
    position: 'left',
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  (b) CFD velocity-magnitude field through the core / bypass
//      Real solver: forge.cfd.solveSteadyNS (laminar projection/MAC channel)
//      Field:       r.u/v/w cell-centre → |u| → contour + streamlines
//      Equations:   ρ(∂u/∂t + u·∇u) = −∇p + μ∇²u,   ∇·u = 0
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Drive incompressible steady Navier–Stokes through a duct domain (core/bypass
 * flow-path proxy) and render the REAL velocity-magnitude field + streamlines
 * coloured by |u|, with a m/s legend and the Reynolds number.
 *
 * Uses the VALIDATED straight inlet→outlet channel configuration (peak/mean ≈
 * 1.5 verified). Honest scope: LAMINAR — no turbulence/transition model.
 *
 * @param {object} opts
 *   domain  [minX,minY,minZ,maxX,maxY,maxZ] (m)  default a 0.2×0.02×0.02 duct
 *   N       grid resolution per long axis (default 32×16×16)
 *   rho,nu  fluid density (kg/m³) + kinematic viscosity (m²/s)
 *   inletVx inlet velocity (m/s)
 *   maxIter outer projection iterations
 *   render  mount field overlays + streamlines (default true)
 *   axisLen,radius streamline envelope for the live scene (model units)
 */
export function cfdCoreFlow(opts = {}) {
  const f = kernel();
  if (!f || !f.cfd || typeof f.cfd.solveSteadyNS !== 'function') {
    return { error: 'kernel not ready — forge.cfd.solveSteadyNS unavailable' };
  }
  const dom = (Array.isArray(opts.domain) && opts.domain.length === 6)
    ? opts.domain : [0, 0, 0, 0.2, 0.02, 0.02];
  const Nx = opts.Nx || 32, Ny = opts.Ny || 16, Nz = opts.Nz || 16;
  const inletVx = Number.isFinite(opts.inletVx) ? opts.inletVx : 0.1;
  const cfg = {
    Nx, Ny, Nz,
    domain: Float64Array.from(dom),
    rho: Number.isFinite(opts.rho) ? opts.rho : 1.0,
    nu: Number.isFinite(opts.nu) ? opts.nu : 1e-3,
    walls: [2, 3, 4, 5],                                  // -Y,+Y,-Z,+Z no-slip
    inlets: [{ faceId: 0, vx: inletVx, vy: 0, vz: 0 }],   // -X inlet
    outlets: [1],                                          // +X outlet
    maxIter: opts.maxIter || 600,
    residualTol: Number.isFinite(opts.residualTol) ? opts.residualTol : 1e-5,
  };

  let r;
  try {
    r = f.cfd.solveSteadyNS(cfg);
  } catch (e) { return { error: `solveSteadyNS failed: ${e.message || e}` }; }
  if (!r || !r.u || !Number.isFinite(r.maxVelocity)) {
    return { error: 'CFD returned no finite velocity field' };
  }

  // Build the REAL cell-centre velocity-magnitude field |u| = √(u²+v²+w²).
  const { Nx: nx, Ny: ny, Nz: nz } = r;
  const idxC = (i, j, k) => (k * ny + j) * nx + i;
  let umin = Infinity, umax = -Infinity, ucount = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = idxC(i, j, k);
    const mag = Math.hypot(r.u[c] || 0, (r.v ? r.v[c] : 0) || 0, (r.w ? r.w[c] : 0) || 0);
    if (Number.isFinite(mag)) { if (mag < umin) umin = mag; if (mag > umax) umax = mag; ucount++; }
  }
  if (!Number.isFinite(umin)) umin = 0;
  if (!Number.isFinite(umax) || umax <= umin) umax = umin + 1e-6;

  // Sample the mid-X cross-section centre-line peak/mean (the validated band).
  const iMid = Math.floor(nx / 2), kMid = Math.floor(nz / 2);
  let rowPeak = 0, rowSum = 0, rowN = 0;
  for (let j = 0; j < ny; j++) {
    const uc = r.u[idxC(iMid, j, kMid)];
    if (Number.isFinite(uc)) { rowPeak = Math.max(rowPeak, uc); rowSum += uc; rowN++; }
  }
  const rowMean = rowN ? rowSum / rowN : 0;
  const peakOverMean = rowMean > 1e-9 ? rowPeak / rowMean : (rowPeak / (inletVx || 1));

  const out = {
    op: 'cfd',
    grid: `${nx}×${ny}×${nz}`,
    maxVelocity_m_s: r.maxVelocity,
    reynolds: r.reynolds,
    fieldMin_m_s: umin, fieldMax_m_s: umax,
    iterations: r.iterations,
    finalResidual: r.finalResidual,
    initialResidual: r.initialResidual,
    peakOverMean,
    regime: r.reynolds < 2300 ? 'laminar (Re < 2300)' : 'NOTE: Re > 2300 — solver is laminar-only, no turbulence model',
  };

  if (opts.render === false || !three() || !scene()) return out;

  // Streamlines coloured by REAL |u|. Map the duct domain to the model envelope
  // (axisLen × radius) so the lines sit in the live viewport; speed01 from |u|.
  clearCaeOverlays();
  const THREE = three();
  const axisLen = opts.axisLen || 5000, radius = opts.radius || 800;
  const x0 = opts.x0 || 0, axis = opts.axis || 'x';
  const dx = dom[3] - dom[0];
  const count = opts.streamlines || 28, steps = 64;
  const group = new THREE.Group();
  group.userData.forgeCae = 'cfd-streamlines';
  for (let s = 0; s < count; s++) {
    const j = Math.floor((s / count) * ny);
    const k = Math.floor(((s * 7) % count) / count * nz);
    const pts = [];
    for (let p = 0; p <= steps; p++) {
      const fr = p / steps;
      const i = Math.min(nx - 1, Math.floor(fr * nx));
      const c = idxC(i, j, Math.min(nz - 1, k));
      const mag = Math.hypot(r.u[c] || 0, (r.v ? r.v[c] : 0) || 0, (r.w ? r.w[c] : 0) || 0);
      const speed01 = (mag - umin) / ((umax - umin) || 1);
      // place along axis; radial offset from cross-section (j,k) normalised.
      const ry = (j / Math.max(1, ny - 1) - 0.5) * 2 * radius;
      const rz = (k / Math.max(1, nz - 1) - 0.5) * 2 * radius;
      const along = x0 + axisLen * fr;
      let v3;
      if (axis === 'z') v3 = [ry, rz, along];
      else if (axis === 'y') v3 = [ry, along, rz];
      else v3 = [along, ry, rz];
      pts.push({ v: new THREE.Vector3(v3[0], v3[1], v3[2]), s01: speed01 });
    }
    // colour each segment by local |u|.
    for (let p = 0; p < pts.length - 1; p++) {
      const geom = new THREE.BufferGeometry().setFromPoints([pts[p].v, pts[p + 1].v]);
      const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(turboHex(pts[p].s01)) });
      group.add(new THREE.Line(geom, mat));
    }
  }
  scene().add(group);

  renderLegend({
    title: '|u| velocity magnitude',
    unit: 'm·s⁻¹', min: umin, max: umax, ticks: 6,
    peakLabel: `|u|_max = ${r.maxVelocity.toPrecision(4)} m/s`,
  });
  renderEquationCard({
    title: 'Incompressible Navier–Stokes',
    equations: [
      'ρ(∂u/∂t + u·∇u) = −∇p + μ∇²u',
      '∇·u = 0',
    ],
    values: [
      { label: '|u|_max', value: `${r.maxVelocity.toPrecision(4)} m/s` },
      { label: 'Reynolds Re', value: r.reynolds.toPrecision(4) },
      { label: 'inlet velocity', value: `${inletVx} m/s` },
      { label: 'peak/mean (mid-X)', value: peakOverMean.toFixed(2) },
      { label: 'final residual', value: r.finalResidual != null ? r.finalResidual.toExponential(2) : '—' },
    ],
    scope: `LAMINAR projection/MAC · ${out.regime} · channel Poiseuille validated peak/mean ≈ 1.5`,
    position: 'right',
  });
  out.streamlines = group.children.length;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  (c) Multibody rotor SPIN-UP — ω(t)
//      Real solver: forge.simulate.multibodyDynamics (HHT-α + Baumgarte)
//      Field:       per-step angVel[0][z] → ω(t) timeseries
//      Equation:    M q̈ + C q̇ + Φ_qᵀ λ = F
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Spin a rotor disk up from rest under a constant torque about +Z and return the
 * REAL ω(t) timeseries (rad/s) sampled by the validated multibody solver, plus
 * the analytical α = T/Izz check (validated rotor 0.00%).
 *
 * @param {object} opts
 *   Izz     rotor polar inertia about spin axis (kg·m²)  default 0.5
 *   torque  drive torque about +Z (N·m)                  default 2.0
 *   mass    rotor mass (kg)                               default 5.0
 *   tEnd    spin-up duration (s)                          default 1.0
 *   dt,steps integrator config
 *   render  draw the ω(t) equation card                  default true
 */
export function rotorSpinUp(opts = {}) {
  const f = kernel();
  if (!f || !f.simulate || typeof f.simulate.multibodyDynamics !== 'function') {
    return { error: 'kernel not ready — forge.simulate.multibodyDynamics unavailable' };
  }
  const Izz = Number.isFinite(opts.Izz) ? opts.Izz : 0.5;
  const torque = Number.isFinite(opts.torque) ? opts.torque : 2.0;
  const mass = Number.isFinite(opts.mass) ? opts.mass : 5.0;
  const Ixy = opts.Ixy ?? 0.25;
  const tEnd = Number.isFinite(opts.tEnd) ? opts.tEnd : 1.0;
  const dt = Number.isFinite(opts.dt) ? opts.dt : 1e-3;
  const steps = opts.steps || Math.round(tEnd / dt);

  let r;
  try {
    r = f.simulate.multibodyDynamics({
      bodies: [{
        mass,
        inertia: [Ixy, 0, 0, 0, Ixy, 0, 0, 0, Izz],
        position: [0, 0, 0], orientation: [0, 0, 0],
        linVel: [0, 0, 0], angVel: [0, 0, 0],
      }],
      constraints: [],
      loads: [{ body: 0, force: [0, 0, 0], torque: [0, 0, torque] }],
      gravity: [0, 0, 0],
      dt, steps, alpha: 0.0, sampleStride: 1,
    });
  } catch (e) { return { error: `multibodyDynamics failed: ${e.message || e}` }; }
  const samples = Array.isArray(r.samples) ? r.samples : [];
  if (!samples.length) return { error: 'multibody returned no samples' };

  // REAL ω(t): angular velocity about +Z of body 0 at every sample.
  const omega = samples.map((s) => ({ t: s.t, w: s.angVel[0][2], theta: s.orientation[0][2] }));
  const last = samples[samples.length - 1];
  const wMeas = last.angVel[0][2], thMeas = last.orientation[0][2];
  const accel = torque / Izz;                  // α = T / I
  const wRef = accel * tEnd, thRef = 0.5 * accel * tEnd * tEnd;
  const wErrPct = wRef !== 0 ? 100 * Math.abs(wMeas - wRef) / Math.abs(wRef) : 0;

  const out = {
    op: 'multibody-rotor-spinup',
    Izz, torque, mass, tEnd, steps, dt,
    alpha_rad_s2: accel,
    omegaFinal_rad_s: wMeas, omegaRef_rad_s: wRef, omegaErrPct: wErrPct,
    thetaFinal_rad: thMeas, thetaRef_rad: thRef,
    rpmFinal: wMeas * 60 / (2 * Math.PI),
    stable: !!r.stable,
    maxConstraintDrift: r.maxConstraintDrift,
    energyDrift: r.energyDrift,
    sampleCount: samples.length,
    omega,            // full ω(t) timeseries
  };

  if (opts.render === false || !three() || !scene()) return out;
  renderEquationCard({
    title: 'Constrained multibody dynamics — rotor spin-up',
    equations: [
      'M q̈ + C q̇ + Φ_qᵀ λ = F',
      'α = T / I_zz,   ω(t) = α t',
    ],
    values: [
      { label: 'α = T/I_zz', value: `${accel.toPrecision(4)} rad/s²` },
      { label: 'ω(t_end)', value: `${wMeas.toPrecision(4)} rad/s  (${out.rpmFinal.toFixed(0)} rpm)` },
      { label: 'ω error vs αt', value: `${wErrPct.toPrecision(3)} %` },
      { label: 'θ(t_end)', value: `${thMeas.toPrecision(4)} rad` },
      { label: 'energy drift', value: r.energyDrift != null ? r.energyDrift.toExponential(2) : '—' },
    ],
    scope: 'HHT-α + Baumgarte constrained DAE · validated rotor ω=αt 0.00% / pendulum 0.016%',
    position: 'right',
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  (d) FULL CAE POST — run all three solvers + every overlay in one call.
//      This is the "open the part in a CAE post-processor" entry point.
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Run the FEA blade contour, the CFD core flow, and the rotor spin-up in one
 * pass and lay all the overlays (legends + equation cards) over the live
 * viewport. The three are spatially distinct (FEA card left, CFD card right /
 * legend swap) so callers typically pick ONE field to show at a time; this
 * returns every result so a demo can step through them.
 */
export function runCaePost(bodies = [], opts = {}) {
  const fea = feaContourBlade(bodies, opts.fea || {});
  const cfd = cfdCoreFlow(opts.cfd || {});
  const rotor = rotorSpinUp(opts.rotor || {});
  return { fea, cfd, rotor };
}

// ── publish on window.__forgeFlagship (extend, don't clobber) + standalone ──
const caeApi = {
  feaContourBlade, cfdCoreFlow, rotorSpinUp, runCaePost,
  renderLegend, renderEquationCard, clearCaeOverlays,
};
if (typeof window !== 'undefined') {
  window.__forgeFlagship = Object.assign(window.__forgeFlagship || {}, caeApi);
  window.__forgeCaeViz = caeApi;
}

export default caeApi;
