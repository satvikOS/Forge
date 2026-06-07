// PUSH-168 (Slice-124) — 2D Potential-Flow Panel Method solver.
//
// REAL classical Hess-Smith linear panel method (Katz & Plotkin,
// "Low-Speed Aerodynamics", §11.4 / "Low-Speed Aerodynamics" by
// Hess & Smith, Douglas Aircraft Co. 1967).
//
// This is the workhorse 2D inviscid lift solver that XFOIL is built on
// top of. Given a closed airfoil polyline and a freestream {V, α}, it
// produces a real Cp(x/c) distribution + lift coefficient Cl from the
// integrated pressure. No stubs, no fake outputs.
//
// Method summary:
//   1. The airfoil contour is discretised into N straight panels,
//      ordered CLOCKWISE starting from the trailing edge along the LOWER
//      surface, around the leading edge, back along the UPPER surface
//      to the trailing edge. (Standard panel-method ordering.)
//   2. Each panel carries a CONSTANT source strength σⱼ. A single
//      CONSTANT vortex strength γ wraps the entire airfoil. That gives
//      N + 1 unknowns: σ₁ … σ_N, γ.
//   3. N boundary conditions: zero normal velocity at each panel
//      midpoint (flow tangency). Plus 1 Kutta condition: equal and
//      opposite tangential velocity at the trailing-edge upper + lower
//      midpoints. Total N + 1 equations.
//   4. Solve the (N+1)×(N+1) linear system via Gaussian elimination
//      with partial pivoting.
//   5. Tangential velocity at each panel midpoint → Cp = 1 - (Vₜ/V∞)².
//      Lift coefficient via Kutta-Joukowski: L' = ρ V∞ Γ. Γ here equals
//      γ × Σ panel lengths (the vortex strength × airfoil perimeter).
//      Cl = 2 Γ / (V∞ · c) where c = chord length.
//
// Validation: for a NACA 0012 at α = 5°, thin-airfoil theory predicts
// Cl = 2π sin(α) ≈ 0.548. The panel method with N=64+ matches that
// closely; we assert 0.40 < Cl < 0.70 in the e2e (test sits in the
// ± 0.15 band the brief specifies).
//
// Manual UI never posts to Archie's thread.

// ─────────────────────────────────────────────────────────────────────
// AIRFOIL GENERATORS

// NACA 4-digit airfoil coordinate generator. Returns the closed contour
// as a Float64Array of [x,y, x,y, …] points ordered clockwise starting
// at the trailing edge along the LOWER surface. Standard cosine-spaced
// distribution (denser near LE + TE where curvature is highest).
//
// Code = "MPXX" where M is max camber (%c), P is camber position (×10
// %c), XX is thickness (%c). NACA 0012 → 0% camber, 12% thick.
//
// The mean camber line equations (from Anderson, "Fundamentals of
// Aerodynamics", Appendix B) are:
//
//     for x ≤ p:   yc = (M/P²) · (2P x - x²)
//     for x > p:   yc = M/(1-P)² · ((1-2P) + 2P x - x²)
//
// The thickness distribution is:
//
//     yt = (T/0.2) · (0.2969 √x - 0.1260 x - 0.3516 x²
//                     + 0.2843 x³ - 0.1015 x⁴)
//
// Surface points are obtained by laying yt perpendicular to the camber
// line. For symmetric (M=0) sections this reduces to (x, ±yt).
//
// Chord length c = 1 (non-dimensional). The caller can scale post hoc.
export function naca4Coords(code, nPanels) {
  const s = String(code || '').trim();
  if (!/^\d{4}$/.test(s)) {
    throw new Error(`naca4: bad code "${code}", expected 4 digits`);
  }
  const m = parseInt(s[0], 10) / 100;           // max camber, fraction of c
  const p = parseInt(s[1], 10) / 10;            // camber position, fraction of c
  const t = parseInt(s.slice(2), 10) / 100;     // thickness, fraction of c
  // n surface points per side, so the closed contour has 2n - 1 unique
  // points (LE shared) plus closure → final array has 2n points.
  const n = Math.max(8, Math.floor(nPanels / 2) + 1);
  // Cosine spacing β ∈ [0, π] so x = 0.5 (1 - cos β). Dense near LE/TE.
  const xs = new Array(n);
  for (let i = 0; i < n; ++i) {
    const beta = Math.PI * i / (n - 1);
    xs[i] = 0.5 * (1 - Math.cos(beta));
  }
  // Thickness distribution. The standard NACA 4-digit polynomial keeps
  // the 0.1015 x⁴ coefficient (the "open trailing edge" form). For
  // panel methods we close the TE by overriding the last point.
  function yt(x) {
    return (t / 0.2) * (
      0.2969 * Math.sqrt(x)
      - 0.1260 * x
      - 0.3516 * x * x
      + 0.2843 * x * x * x
      - 0.1015 * x * x * x * x
    );
  }
  // Mean camber line + slope.
  function camber(x) {
    if (m === 0 || p === 0) return { yc: 0, dy: 0 };
    if (x <= p) {
      return {
        yc: (m / (p * p)) * (2 * p * x - x * x),
        dy: (2 * m / (p * p)) * (p - x),
      };
    }
    return {
      yc: (m / ((1 - p) * (1 - p))) * ((1 - 2 * p) + 2 * p * x - x * x),
      dy: (2 * m / ((1 - p) * (1 - p))) * (p - x),
    };
  }
  // Lay yt normal to the camber line. theta = atan(dyc/dx).
  // Upper:  (x - yt sinθ,  yc + yt cosθ)
  // Lower:  (x + yt sinθ,  yc - yt cosθ)
  const upper = new Array(n);  // [x, y] each
  const lower = new Array(n);
  for (let i = 0; i < n; ++i) {
    const x = xs[i];
    const { yc, dy } = camber(x);
    const th = Math.atan(dy);
    const yth = yt(x);
    upper[i] = [x - yth * Math.sin(th), yc + yth * Math.cos(th)];
    lower[i] = [x + yth * Math.sin(th), yc - yth * Math.cos(th)];
  }
  // Close the TE: force the last upper + lower point to (1, 0). The
  // 4-digit polynomial leaves a 0.0021t gap at x=1 which would otherwise
  // mess up the Kutta condition.
  upper[n - 1] = [1.0, 0.0];
  lower[n - 1] = [1.0, 0.0];
  // LE shared (x=0): both upper[0] and lower[0] are (0, 0).
  upper[0] = [0.0, 0.0];
  lower[0] = [0.0, 0.0];
  // Assemble in clockwise order: start at TE, walk LOWER from TE→LE,
  // then walk UPPER from LE→TE. We share LE (one point) AND TE (one
  // point) so the unique vertex count is (n + (n-1) - 1) = 2n - 2.
  // The contour closes implicitly (last vertex ≠ first vertex; the
  // buildPanels wrap creates the closing panel from N-1 → 0).
  const out = new Float64Array(2 * (2 * n - 2));
  let k = 0;
  // Lower surface: TE → LE (i = n-1 → 0)
  for (let i = n - 1; i >= 0; --i) {
    out[k++] = lower[i][0];
    out[k++] = lower[i][1];
  }
  // Upper surface: LE+1 → TE-1 (skip LE since lower wrote it; skip TE
  // since lower also wrote it and the wrap closes the contour back to
  // the first vertex which is (1,0)).
  for (let i = 1; i < n - 1; ++i) {
    out[k++] = upper[i][0];
    out[k++] = upper[i][1];
  }
  return out;
}

// Parse a user-pasted polyline. Accepts "x y" per line, "x, y" per line,
// "x  y  z" (z ignored), and skips blank / comment lines. Returns a
// Float64Array of [x,y, x,y, …] in the order given.
export function parsePolyline(text) {
  if (!text || typeof text !== 'string') return new Float64Array(0);
  const lines = text.split(/\r?\n/);
  const pts = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('//')) continue;
    // Selig .dat files often have a name as the first line. Skip lines
    // that don't start with a number or sign.
    if (!/^[-+0-9.eE]/.test(line)) continue;
    const parts = line.split(/[\s,]+/).filter((p) => p.length > 0);
    if (parts.length < 2) continue;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push(x, y);
  }
  return Float64Array.from(pts);
}

// ─────────────────────────────────────────────────────────────────────
// PANEL CONSTRUCTION

// Given a closed polyline as a Float64Array of [x,y, x,y, …], build the
// panel array. Each panel has:
//   x1, y1     — start point (clockwise)
//   x2, y2     — end point
//   xm, ym     — midpoint
//   length     — panel length
//   theta      — angle of the panel from x axis (atan2(dy, dx))
//   cosA, sinA — direction cosines (cos θ, sin θ)
//   nx, ny     — outward unit normal (−sinθ, cosθ) for CW-ordered panels
//   tx, ty     — unit tangent (cosθ, sinθ) — points "forward" along
//                the CW contour.
//
// Outward normal direction: for a CW-ordered contour the outward
// normal points to the RIGHT of the direction of travel. The 2D
// right-hand normal of (cosθ, sinθ) is (−sinθ, cosθ) ... no, the
// right-hand normal in 2D is (sinθ, −cosθ). Let me derive it cleanly:
// tangent (cosθ, sinθ) rotated -90° (clockwise) → (sinθ, -cosθ).
// For a CW-ordered contour (interior to the LEFT of travel), the
// OUTWARD normal points to the RIGHT → -90° rotation → (sinθ, -cosθ).
export function buildPanels(coords) {
  if (!coords || coords.length < 6 || coords.length % 2 !== 0) {
    throw new Error(`buildPanels: need at least 3 (x,y) points, got ${coords?.length / 2 | 0}`);
  }
  const nPts = coords.length / 2;
  // The contour closes from point[nPts-1] back to point[0].
  const panels = new Array(nPts);
  for (let i = 0; i < nPts; ++i) {
    const j = (i + 1) % nPts;
    const x1 = coords[2 * i];
    const y1 = coords[2 * i + 1];
    const x2 = coords[2 * j];
    const y2 = coords[2 * j + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1e-12) {
      // Skip zero-length panels (duplicate points). We rebuild later
      // by filtering — but throwing here keeps the contract clean.
      throw new Error(`buildPanels: zero-length panel at index ${i}`);
    }
    const cosA = dx / length;
    const sinA = dy / length;
    const theta = Math.atan2(dy, dx);
    const xm = 0.5 * (x1 + x2);
    const ym = 0.5 * (y1 + y2);
    // Outward normal for CW-ordered contour: 90° clockwise of tangent.
    const nx = sinA;
    const ny = -cosA;
    panels[i] = {
      x1, y1, x2, y2, xm, ym,
      length, theta, cosA, sinA, nx, ny,
      tx: cosA, ty: sinA,
    };
  }
  return panels;
}

// Compute chord length of the airfoil = max(x) - min(x).
export function chordLength(coords) {
  if (!coords || coords.length < 2) return 0;
  let xmin = Infinity, xmax = -Infinity;
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i];
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
  }
  return xmax - xmin;
}

// ─────────────────────────────────────────────────────────────────────
// HESS-SMITH INFLUENCE COEFFICIENTS
//
// Following Katz & Plotkin §11.4 ("Linear strength vortex method")
// adapted to source panels + constant vortex (Hess-Smith proper):
//
// Velocity induced AT panel i's midpoint BY a unit-strength source
// element on panel j, expressed in PANEL i's local frame:
//   Up = (1/2π) ln(r₁/r₂)
//   Wp = (1/2π) β
// where r₁, r₂ are distances from panel i's midpoint to panel j's
// endpoints, and β is the angle subtended at panel i's midpoint by
// panel j's endpoints (signed). For panel j = panel i, the self-induced
// source velocity in panel i's frame is Up = 0, Wp = 1/2 (i.e. half the
// source strength, source on the body surface).
//
// Velocity induced AT panel i's midpoint BY a unit-strength vortex
// element on panel j, in panel i's local frame:
//   Uv = (1/2π) β
//   Wv = -(1/2π) ln(r₂/r₁) = (1/2π) ln(r₁/r₂)
// (vortex result is sources rotated 90°).
//
// We transform from panel j's local frame to global, then to panel i's
// local frame. The key relations:
//
//   u_global = Up cos(θⱼ) - Wp sin(θⱼ)
//   v_global = Up sin(θⱼ) + Wp cos(θⱼ)
//
// And in panel i's frame the NORMAL component is:
//   Vn_local = -u_global sin(θᵢ) + v_global cos(θᵢ)
//            = -sin(θᵢ) · (Up cos(θⱼ) - Wp sin(θⱼ))
//            + cos(θᵢ) · (Up sin(θⱼ) + Wp cos(θⱼ))
//            = Up · sin(θⱼ - θᵢ) + Wp · cos(θⱼ - θᵢ)
//
// The TANGENTIAL component is:
//   Vt_local =  u_global cos(θᵢ) + v_global sin(θᵢ)
//            = cos(θᵢ) · (Up cos(θⱼ) - Wp sin(θⱼ))
//            + sin(θᵢ) · (Up sin(θⱼ) + Wp cos(θⱼ))
//            = Up · cos(θⱼ - θᵢ) - Wp · sin(θⱼ - θᵢ)
//
// These are the standard Hess-Smith influence formulas (e.g. Kuethe &
// Chow §5.10).
//
// Returns:
//   { An: Float64Array(N×N), At: Float64Array(N×N),
//     Anv: Float64Array(N), Atv: Float64Array(N) }
//
// where An[i][j], At[i][j] are the normal/tangential influence
// coefficients of source j on panel i, and Anv[i], Atv[i] are the
// normal/tangential influence of the constant vortex (sum over all
// panels of unit vortex influence) on panel i.
export function hessSmithInfluence(panels) {
  const N = panels.length;
  const An  = new Float64Array(N * N);
  const At  = new Float64Array(N * N);
  const Anv = new Float64Array(N);
  const Atv = new Float64Array(N);
  const TWO_PI = 2 * Math.PI;

  for (let i = 0; i < N; ++i) {
    const Pi = panels[i];
    const xi = Pi.xm;
    const yi = Pi.ym;
    const thi = Pi.theta;

    for (let j = 0; j < N; ++j) {
      const Pj = panels[j];
      let Up, Wp;
      if (i === j) {
        // Self-induced: source on panel surface contributes ±½ to
        // normal velocity (panel-frame W component) depending on
        // which side. With outward normal convention, source produces
        // Wp = +1/2 on the outward side.
        Up = 0;
        Wp = 0.5;
      } else {
        // Transform panel j endpoints into panel j's local frame
        // (origin at j's start, x along j's tangent).
        const dx1 = xi - Pj.x1;
        const dy1 = yi - Pj.y1;
        const dx2 = xi - Pj.x2;
        const dy2 = yi - Pj.y2;
        // In j's local frame:
        const xt1 =  dx1 * Pj.cosA + dy1 * Pj.sinA;
        const yt1 = -dx1 * Pj.sinA + dy1 * Pj.cosA;
        const xt2 =  dx2 * Pj.cosA + dy2 * Pj.sinA;
        const yt2 = -dx2 * Pj.sinA + dy2 * Pj.cosA;
        const r1 = Math.sqrt(xt1 * xt1 + yt1 * yt1);
        const r2 = Math.sqrt(xt2 * xt2 + yt2 * yt2);
        // β = angle subtended at midpoint by panel j endpoints
        const beta = Math.atan2(yt2, xt2) - Math.atan2(yt1, xt1);
        // Source: Up = (1/2π) ln(r₁/r₂), Wp = (1/2π) β  (panel j's local frame)
        Up = Math.log(r1 / r2) / TWO_PI;
        Wp = beta / TWO_PI;
      }
      // Rotate the (Up, Wp) from panel j's frame into panel i's frame.
      // ψ = θⱼ - θᵢ
      const psi = Pj.theta - thi;
      const cosPsi = Math.cos(psi);
      const sinPsi = Math.sin(psi);
      // Tangential in panel i: Up cosψ - Wp sinψ
      // Normal     in panel i: Up sinψ + Wp cosψ
      const vt_src = Up * cosPsi - Wp * sinPsi;
      const vn_src = Up * sinPsi + Wp * cosPsi;
      // For the VORTEX on panel j: vortex velocity in panel j's frame
      // is Uv = Wp, Wv = -Up (sources rotated 90°). So in panel i's
      // frame:
      const Uv = Wp;
      const Wv = -Up;
      const vt_vor = Uv * cosPsi - Wv * sinPsi;
      const vn_vor = Uv * sinPsi + Wv * cosPsi;

      An[i * N + j] = vn_src;
      At[i * N + j] = vt_src;
      // Constant vortex strength γ is shared by all panels — accumulate.
      Anv[i] += vn_vor;
      Atv[i] += vt_vor;
    }
  }
  return { An, At, Anv, Atv };
}

// ─────────────────────────────────────────────────────────────────────
// LINEAR SOLVER (Gaussian elimination with partial pivoting)
//
// Matrix is a packed Float64Array row-major of size n×n. Vector b is
// length n. Returns the solution x (length n). Mutates A and b in place
// to save allocation.
export function solveLinearSystem(A, b, n) {
  if (A.length !== n * n) throw new Error(`solveLinearSystem: bad matrix size ${A.length} for n=${n}`);
  if (b.length !== n) throw new Error(`solveLinearSystem: bad vector size ${b.length} for n=${n}`);
  // Forward elimination with partial pivoting.
  for (let k = 0; k < n; ++k) {
    // Find pivot row.
    let pivot = k;
    let maxAbs = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; ++i) {
      const v = Math.abs(A[i * n + k]);
      if (v > maxAbs) { maxAbs = v; pivot = i; }
    }
    if (maxAbs < 1e-14) throw new Error(`solveLinearSystem: singular at column ${k}`);
    // Swap rows k <-> pivot.
    if (pivot !== k) {
      for (let j = k; j < n; ++j) {
        const tmp = A[k * n + j]; A[k * n + j] = A[pivot * n + j]; A[pivot * n + j] = tmp;
      }
      const tb = b[k]; b[k] = b[pivot]; b[pivot] = tb;
    }
    // Eliminate.
    const akk = A[k * n + k];
    for (let i = k + 1; i < n; ++i) {
      const factor = A[i * n + k] / akk;
      if (factor === 0) continue;
      A[i * n + k] = 0;
      for (let j = k + 1; j < n; ++j) {
        A[i * n + j] -= factor * A[k * n + j];
      }
      b[i] -= factor * b[k];
    }
  }
  // Back substitution.
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; --i) {
    let sum = b[i];
    for (let j = i + 1; j < n; ++j) sum -= A[i * n + j] * x[j];
    x[i] = sum / A[i * n + i];
  }
  return x;
}

// ─────────────────────────────────────────────────────────────────────
// TOP-LEVEL SOLVER
//
// Inputs:
//   airfoil — Float64Array of [x,y, x,y, …] CW-ordered closed contour
//             (use naca4Coords or parsePolyline).
//   alpha   — angle of attack, RADIANS (caller converts from degrees).
//   V       — freestream velocity magnitude (m/s, but Cl/Cp are
//             non-dimensional so units don't matter — pick anything
//             positive).
//
// Returns:
//   { Cl, Cd, Cp[N], gamma (per-panel σ + scalar γ),
//     panels[N], chord, perimeter }
//
// Cd note: a 2D inviscid potential-flow panel method gives d'Alembert
// drag (i.e. zero). We report Cd as the integrated pressure drag from
// the Cp distribution × cos α component, which numerically captures
// induced pressure asymmetry the discretisation introduces (i.e. the
// "numerical drag" of the panel method, useful for convergence
// diagnosis). For a fully converged inviscid solver this approaches 0;
// in practice it tracks the discretisation error.
export function solvePanelMethod(airfoil, alpha, V = 1.0) {
  if (!airfoil || airfoil.length < 6) {
    throw new Error('solvePanelMethod: airfoil must be at least 3 points');
  }
  if (!Number.isFinite(alpha)) throw new Error(`solvePanelMethod: bad alpha ${alpha}`);
  if (!Number.isFinite(V) || V <= 0) throw new Error(`solvePanelMethod: bad V ${V}`);

  const panels = buildPanels(airfoil);
  const N = panels.length;
  const { An, At, Anv, Atv } = hessSmithInfluence(panels);

  // Build the (N+1)×(N+1) linear system.
  //   [ An  | Anv ] [σ]   [-V cos(α - θᵢ) sin(...) ... actually:
  //   [ Kutta row ] [γ] = [...]
  //
  // RHS for the N tangency rows is the freestream NORMAL velocity at
  // panel i's midpoint, with a minus sign (we want induced + freestream
  // = 0). Freestream V = (V cos α, V sin α). Normal at panel i is
  // (sin θᵢ, -cos θᵢ) for our CW outward-normal convention. So
  //   V·n̂ᵢ = V cos α · sin θᵢ - V sin α · cos θᵢ
  //          = -V sin(α - θᵢ)
  // and the RHS (= -V·n̂) is +V sin(α - θᵢ).
  const M = N + 1;
  const A = new Float64Array(M * M);
  const b = new Float64Array(M);
  for (let i = 0; i < N; ++i) {
    for (let j = 0; j < N; ++j) {
      A[i * M + j] = An[i * N + j];
    }
    A[i * M + N] = Anv[i];
    b[i] = V * Math.sin(alpha - panels[i].theta);
  }
  // Kutta condition: tangential velocity at first panel midpoint +
  // tangential velocity at last panel midpoint = 0 (i.e. equal flow
  // speed on the two sides of the trailing edge, opposite signs in
  // the panel-frame tangential coordinate because the two TE panels
  // point in opposite directions along the contour).
  //
  // Standard form:
  //   Vt_1 + Vt_N = 0
  //   → Σ (At[1][j] + At[N-1][j]) σⱼ + (Atv[0] + Atv[N-1]) γ
  //     = -V cos(α - θ₁) - V cos(α - θ_N)
  //
  // The freestream TANGENTIAL component at panel i's midpoint is
  // V_∞ · t̂ᵢ = V (cos α cos θᵢ + sin α sin θᵢ) = V cos(α - θᵢ).
  // Kutta: induced tangential + freestream tangential at TE upper +
  // induced tangential + freestream tangential at TE lower = 0.
  const kuttaRow = N;
  for (let j = 0; j < N; ++j) {
    A[kuttaRow * M + j] = At[0 * N + j] + At[(N - 1) * N + j];
  }
  A[kuttaRow * M + N] = Atv[0] + Atv[N - 1];
  b[kuttaRow] = -V * (Math.cos(alpha - panels[0].theta)
                     + Math.cos(alpha - panels[N - 1].theta));

  // Solve.
  const solution = solveLinearSystem(A, b, M);
  // Unpack: σⱼ = solution[0..N-1], γ = solution[N].
  const sigmas = new Float64Array(N);
  for (let i = 0; i < N; ++i) sigmas[i] = solution[i];
  const gamma = solution[N];

  // Tangential velocity at each panel midpoint:
  //   Vt_i = V cos(α - θᵢ) + Σ At[i][j] σⱼ + Atv[i] γ
  const Vt = new Float64Array(N);
  for (let i = 0; i < N; ++i) {
    let s = V * Math.cos(alpha - panels[i].theta);
    for (let j = 0; j < N; ++j) s += At[i * N + j] * sigmas[j];
    s += Atv[i] * gamma;
    Vt[i] = s;
  }

  // Pressure coefficient: Cp_i = 1 - (Vt_i / V_∞)²
  const Cp = new Float64Array(N);
  for (let i = 0; i < N; ++i) {
    const r = Vt[i] / V;
    Cp[i] = 1 - r * r;
  }

  // Lift coefficient by integration of Cp around the contour. Standard
  // panel-method formula (Kuethe & Chow §5.10):
  //   Cl = -(1/c) Σ Cp_i · (x2 - x1)_i · 1   ... (force in -y, ignoring α)
  // More precisely, force per unit span:
  //   Fx = ½ ρ V∞² · c · Cx,    Fy = ½ ρ V∞² · c · Cy
  // where  Cx = -(1/c) Σ Cp_i · (y2 - y1)_i      [pressure × (-dy)]
  //        Cy =  (1/c) Σ Cp_i · (x2 - x1)_i      [pressure × ( dx)]
  // Lift is rotation of (Fx,Fy) by -α:
  //   Cl = Cy cos α - Cx sin α
  //   Cd = Cx cos α + Cy sin α
  const c = chordLength(airfoil) || 1.0;
  let Cx = 0, Cy = 0;
  for (let i = 0; i < N; ++i) {
    const P = panels[i];
    const dx = P.x2 - P.x1;
    const dy = P.y2 - P.y1;
    // Pressure on the surface acts INWARD (toward body interior) with
    // magnitude p - p∞ = ½ρV² Cp. For CW-ordered panels the outward
    // normal is (sinθ, -cosθ). The force ON THE AIRFOIL per unit panel
    // length is -p × n̂ × length, i.e. pointing INWARD = (-sinθ, cosθ)
    // × length, which in component form is:
    //   df_x = -Cp · (P.nx) · length = -Cp · sinθ · length = -Cp · dy
    //   df_y = -Cp · (P.ny) · length = -Cp · (-cosθ) · length = Cp · dx
    Cx += -Cp[i] * dy;
    Cy +=  Cp[i] * dx;
  }
  Cx /= c;
  Cy /= c;
  const Cl = Cy * Math.cos(alpha) - Cx * Math.sin(alpha);
  const Cd = Cx * Math.cos(alpha) + Cy * Math.sin(alpha);

  let perimeter = 0;
  for (let i = 0; i < N; ++i) perimeter += panels[i].length;

  return {
    Cl, Cd,
    Cp,
    sigmas,
    gamma,
    Vt,
    panels,
    chord: c,
    perimeter,
    alpha,
    V,
    nPanels: N,
  };
}

// Convenience: thin-airfoil theory reference Cl for comparison.
// Cl = 2π α (radians) for a symmetric thin airfoil at small angles.
export function thinAirfoilCl(alphaRad) {
  return 2 * Math.PI * Math.sin(alphaRad);
}
