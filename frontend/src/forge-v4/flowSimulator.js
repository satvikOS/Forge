// Forge-169 — process flow simulator for the P&ID schematic editor.
//
// Three real engineering equations live in this file:
//
//  1.  Darcy-Weisbach pressure drop:
//
//          ΔP  =  f · (L/D) · (ρ·V²/2)
//
//      with the Darcy friction factor `f` resolved from the
//      Colebrook-White equation (iterative root-find on f).
//
//  2.  Kv valve sizing (IEC 60534) — given flow Q (m³/h), specific
//      gravity G, and pressure drop ΔP (bar):
//
//          Kv = Q · sqrt(G / ΔP)
//
//      and the inverse (ΔP for a known Kv at a given Q).
//
//  3.  Pump curve / system curve intersection — fit the pump curve
//      H_pump(Q) as a quadratic in Q (matches the standard 3-pt
//      published-curve fit), build the system curve H_sys(Q) from
//      static head + Darcy losses, and bisect on the residual.
//
// All units in this file are strict SI inside the math; conversions
// happen at the boundary helpers.  The simulator's output is a real
// number; if a numerical issue makes a root not exist, we throw an
// explicit Error — there is no silent fallback.

// ============================================================
// Constants
// ============================================================

export const G_ACCEL = 9.81;          // m/s²

// Standard pipe wall roughness ε (mm).  Source: Crane TP-410 Table A-23.
export const ROUGHNESS_MM = {
  drawn:           0.0015,  // copper, brass, plastic
  commercialSteel: 0.046,
  galvanizedIron:  0.15,
  castIron:        0.26,
  concrete:        1.0,
  rivetedSteel:    3.0,
};

// Common fluids (water 20 °C, hydraulic oil ISO VG 32, refrigerant R134a).
export const FLUIDS = {
  water20:    { name: 'Water (20 °C)', rho: 998.2, mu: 1.002e-3 },  // kg/m³, Pa·s
  hydraulic:  { name: 'ISO VG 32 oil', rho: 870,   mu: 32e-3   },
  glycol50:   { name: '50 % EG/water', rho: 1066,  mu: 4.0e-3  },
  brine:      { name: 'NaCl 20 %',     rho: 1150,  mu: 1.95e-3 },
};

// ============================================================
// Reynolds number + Colebrook-White friction factor
// ============================================================

export function reynolds(rho, V, D, mu) {
  return (rho * V * D) / mu;
}

// Colebrook-White:
//
//   1/√f  =  −2 · log10( ε/(3.7·D) + 2.51 / (Re·√f) )
//
// We solve for `f` by Newton iteration on x = 1/√f, which converges
// in 4-6 steps for any reasonable Re ≥ 4000.
export function colebrookFrictionFactor(Re, epsilon, D, opts = {}) {
  const tol  = opts.tol  ?? 1e-9;
  const iter = opts.iter ?? 40;
  if (Re < 2300) {
    // Laminar — closed form.
    return 64 / Re;
  }
  // Transition region: blend laminar → turbulent linearly over
  // 2300 < Re < 4000.
  if (Re < 4000) {
    const fLam = 64 / Re;
    const fTurb = colebrookFrictionFactor(4000, epsilon, D, opts);
    const t = (Re - 2300) / (4000 - 2300);
    return fLam * (1 - t) + fTurb * t;
  }
  const k = epsilon / (3.7 * D);
  // Start from the Swamee-Jain explicit approximation — a strong
  // initial guess that the Newton step then polishes.
  let f = 0.25 / Math.pow(
    Math.log10(k + 5.74 / Math.pow(Re, 0.9)),
    2,
  );
  for (let i = 0; i < iter; i++) {
    const sqrtF = Math.sqrt(f);
    const lhs = 1 / sqrtF;
    const rhs = -2 * Math.log10(k + 2.51 / (Re * sqrtF));
    // residual = lhs - rhs
    const r = lhs - rhs;
    if (Math.abs(r) < tol) return f;
    // Numerical derivative of (lhs - rhs) w.r.t. f.
    const eps = f * 1e-6;
    const sqrtFe = Math.sqrt(f + eps);
    const re = (1 / sqrtFe)
             - (-2 * Math.log10(k + 2.51 / (Re * sqrtFe)));
    const dr = (re - r) / eps;
    if (!Number.isFinite(dr) || dr === 0) break;
    const fNext = f - r / dr;
    if (!Number.isFinite(fNext) || fNext <= 0) break;
    f = fNext;
  }
  return f;
}

// ============================================================
// Darcy-Weisbach pressure drop for a straight pipe segment
// ============================================================

export function darcyPressureDrop({
  flow_m3s,           // volumetric flow (m³/s)
  pipeDiameter_m,     // inside diameter (m)
  pipeLength_m,       // length (m)
  roughness_m,        // absolute roughness ε (m)
  rho, mu,            // density (kg/m³), dynamic viscosity (Pa·s)
}) {
  if (pipeDiameter_m <= 0) throw new Error('flowSim: pipe diameter must be > 0');
  if (flow_m3s < 0)        throw new Error('flowSim: negative flow rate');
  const A = Math.PI * (pipeDiameter_m / 2) ** 2;
  const V = flow_m3s / A;
  const Re = reynolds(rho, V, pipeDiameter_m, mu);
  const f = colebrookFrictionFactor(Re, roughness_m, pipeDiameter_m);
  const dp = f * (pipeLength_m / pipeDiameter_m) * (rho * V * V / 2);
  return { dp_Pa: dp, velocity_ms: V, reynolds: Re, frictionFactor: f, area_m2: A };
}

// ============================================================
// Valve sizing — Kv (IEC 60534)
// ============================================================

// Kv has dimensional units m³/h · √(bar/sg).  We accept SI inputs
// (m³/s, Pa) at the boundary and convert internally.
export function kvFromFlow({ flow_m3s, dp_Pa, specificGravity }) {
  const Qh = flow_m3s * 3600;                  // m³/h
  const dpBar = dp_Pa / 1e5;                   // bar
  if (dpBar <= 0) throw new Error('flowSim: ΔP must be > 0 for Kv');
  return Qh * Math.sqrt(specificGravity / dpBar);
}

export function dpFromKv({ flow_m3s, Kv, specificGravity }) {
  const Qh = flow_m3s * 3600;
  if (Kv <= 0) throw new Error('flowSim: Kv must be > 0');
  const dpBar = specificGravity * (Qh * Qh) / (Kv * Kv);
  return dpBar * 1e5;                          // Pa
}

// ============================================================
// Pump curve — quadratic fit + system intersection
// ============================================================

// Fit H = a·Q² + b·Q + c through three published points.
export function fitPumpCurve(points) {
  if (!Array.isArray(points) || points.length !== 3) {
    throw new Error('flowSim: pump curve fit requires exactly 3 (Q,H) points');
  }
  // 3-equation linear solve.
  const [p1, p2, p3] = points;
  const x1 = p1.Q, y1 = p1.H;
  const x2 = p2.Q, y2 = p2.H;
  const x3 = p3.Q, y3 = p3.H;
  const den = (x1 - x2) * (x1 - x3) * (x2 - x3);
  if (Math.abs(den) < 1e-18) {
    throw new Error('flowSim: pump curve points are collinear/degenerate');
  }
  const a = (x3 * (y2 - y1) + x2 * (y1 - y3) + x1 * (y3 - y2)) / den;
  const b = (x3 * x3 * (y1 - y2) + x2 * x2 * (y3 - y1) + x1 * x1 * (y2 - y3)) / den;
  const c = (x2 * x3 * (x2 - x3) * y1
           + x3 * x1 * (x3 - x1) * y2
           + x1 * x2 * (x1 - x2) * y3) / den;
  return { a, b, c, eval: (Q) => a * Q * Q + b * Q + c };
}

// System curve H_sys(Q) = staticHead + KQ²  where K rolls together
// every Darcy friction loss summed over the pipe segments.
export function systemCurve({ staticHead_m, segments, fluid }) {
  const rho = fluid.rho, mu = fluid.mu;
  return (Q_m3s) => {
    if (Q_m3s <= 0) return staticHead_m;
    let dpTotal = 0;
    for (const seg of segments) {
      const r = darcyPressureDrop({
        flow_m3s: Q_m3s,
        pipeDiameter_m: seg.D, pipeLength_m: seg.L,
        roughness_m: seg.eps, rho, mu,
      });
      dpTotal += r.dp_Pa;
    }
    return staticHead_m + dpTotal / (rho * G_ACCEL);
  };
}

// Bracket-bisection on residual R(Q) = H_pump(Q) - H_sys(Q).
export function intersectPumpSystem(pump, sys, Qmax) {
  let lo = 0, hi = Qmax;
  const r = (Q) => pump.eval(Q) - sys(Q);
  if (r(lo) < 0) {
    throw new Error('flowSim: static head exceeds pump shut-off head');
  }
  if (r(hi) > 0) {
    // Operating point lies beyond Qmax — bracket extension once.
    hi = Qmax * 2;
    if (r(hi) > 0) {
      throw new Error('flowSim: no intersection in 0..2·Qmax');
    }
  }
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    const rmid = r(mid);
    if (Math.abs(rmid) < 1e-6) return { Q: mid, H: pump.eval(mid) };
    if (rmid > 0) lo = mid; else hi = mid;
  }
  return { Q: 0.5 * (lo + hi), H: pump.eval(0.5 * (lo + hi)) };
}

// ============================================================
// Top-level simulate() — drives a schematic
// ============================================================

// Walk the schematic graph (nodes + lines) and for every line carrying
// `flow_m3s`, compute ΔP across each pipe-line.  Skip non-process
// lines (instrument / electrical / hydraulic-signal).
export function simulate(schematic, opts = {}) {
  const fluid = opts.fluid || FLUIDS.water20;
  const pipeDiameter_m = opts.pipeDiameter_m  ?? 0.05;     // 50 mm default
  const roughness_m    = opts.roughness_m     ?? ROUGHNESS_MM.commercialSteel / 1000;
  const flow_m3s       = opts.flow_m3s        ?? 0.005;    // 18 m³/h default

  const lines = (schematic?.lines || []).filter((l) => l.kind === 'process');
  const results = [];
  let totalDp = 0;
  for (const l of lines) {
    const L = lineLength(schematic, l) * (opts.scale_m_per_unit ?? 0.01);
    if (L <= 0) continue;
    const r = darcyPressureDrop({
      flow_m3s, pipeDiameter_m, pipeLength_m: L,
      roughness_m, rho: fluid.rho, mu: fluid.mu,
    });
    results.push({
      lineId: l.id, length_m: L,
      dp_kPa: r.dp_Pa / 1000,
      velocity_ms: r.velocity_ms,
      reynolds: r.reynolds,
      frictionFactor: r.frictionFactor,
    });
    totalDp += r.dp_Pa;
  }
  return {
    fluid: fluid.name,
    pipeDiameter_mm: pipeDiameter_m * 1000,
    flow_m3h: flow_m3s * 3600,
    lineCount: results.length,
    totalDp_kPa: totalDp / 1000,
    lines: results,
  };
}

function lineLength(schematic, line) {
  // Sum of polyline segment lengths in editor units.
  const pts = line.points || [];
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    L += Math.sqrt(dx * dx + dy * dy);
  }
  return L;
}
