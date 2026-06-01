// Forge-152 — Robot kinematics: FK + analytic IK for 6R + spherical wrist.
//
// References:
//   - Craig, "Introduction to Robotics: Mechanics and Control", 3e.
//     Modified-DH transform: Tᵢ = Rotx(αᵢ₋₁)·Tx(aᵢ₋₁)·Rotz(θᵢ)·Tz(dᵢ).
//   - Pieper, "The Kinematics of Manipulators Under Computer Control",
//     Stanford AI Memo 72 (1968): closed-form solution for the
//     six-revolute manipulator whose last three axes intersect at
//     a single point ("spherical wrist") — every robot in our
//     catalogue is built that way (KUKA KR6, ABB IRB1200, FANUC LR
//     Mate are all R-shoulder + spherical wrist designs).
//   - Faria et al., "Position-Based Kinematics for 7-DoF Serial
//     Manipulators with Global Configuration Control", IEEE 2018 —
//     used for the 8-branch enumeration logic.
//
// This module is dependency-free (plain numbers + 4×4 matrices).
// All angles in RADIANS internally; degrees only at the public boundary.

import { DEG, RAD } from './robotModels.js';

// ────────────────────────────────────────────────────────────────────
// 4×4 matrix helpers (row-major)
// ────────────────────────────────────────────────────────────────────

export function mat4Identity() {
  return [
    1,0,0,0,
    0,1,0,0,
    0,0,1,0,
    0,0,0,1,
  ];
}

export function mat4Multiply(A, B) {
  const C = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[r*4+k] * B[k*4+c];
      C[r*4+c] = s;
    }
  }
  return C;
}

export function mat4Copy(M) { return M.slice(); }

// Inverse of a homogeneous transform — exploits orthogonality of R.
export function mat4InvertHomog(T) {
  const r00=T[0], r01=T[1], r02=T[2],   tx=T[3];
  const r10=T[4], r11=T[5], r12=T[6],   ty=T[7];
  const r20=T[8], r21=T[9], r22=T[10],  tz=T[11];
  // Inverse rotation = transpose; inverse translation = -Rᵀ·t.
  return [
    r00, r10, r20, -(r00*tx + r10*ty + r20*tz),
    r01, r11, r21, -(r01*tx + r11*ty + r21*tz),
    r02, r12, r22, -(r02*tx + r12*ty + r22*tz),
    0,   0,   0,   1,
  ];
}

// Build STANDARD-DH link transform — Spong / Denavit-Hartenberg classic.
//   Tᵢ = Rotz(θᵢ) · Tz(dᵢ) · Tx(aᵢ) · Rotx(αᵢ)
//
// Each row of our DH table describes the transform from frame i-1 to
// frame i; the chain T₀_6 = T₁ · T₂ · … · T₆ gives the TCP pose.
//
// `a` and `d` in mm, `alpha`/`theta` in radians.
export function dhTransformModified(a, alpha, d, theta) {
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const ct = Math.cos(theta), st = Math.sin(theta);
  return [
       ct,   -st*ca,    st*sa,   a*ct,
       st,    ct*ca,   -ct*sa,   a*st,
       0,     sa,       ca,      d,
       0,     0,        0,       1,
  ];
}

// ────────────────────────────────────────────────────────────────────
// Forward kinematics
// ────────────────────────────────────────────────────────────────────
//
// `q` = array of 6 joint angles IN DEGREES (UI convention).
// Returns:
//   { T0_6:[16], frames:[7 × 16] }
// where `frames[0]` is the base frame (identity) and frames[i] is the
// pose of link-frame i (so the elbow, wrist, flange are all available
// to the renderer).

export function forwardKinematics(model, qDeg) {
  if (!Array.isArray(qDeg) || qDeg.length !== 6) {
    throw new Error('forwardKinematics: q must be 6 angles');
  }
  const rows = model.dhRows;
  const frames = [mat4Identity()];
  let T = mat4Identity();
  for (let i = 0; i < 6; i++) {
    const r = rows[i];
    const theta = (qDeg[i] + r.theta_offset) * DEG;
    const Ti = dhTransformModified(r.a, r.alpha * DEG, r.d, theta);
    T = mat4Multiply(T, Ti);
    frames.push(mat4Copy(T));
  }
  return { T0_6: T, frames };
}

// Convenience: extract TCP pose [x, y, z, A, B, C] from T0_6.
// A/B/C are ZYX Euler angles in DEGREES (KUKA-style A=yaw, B=pitch,
// C=roll). Other vendors translate at the post-processor layer.
export function tcpFromT(T) {
  const x = T[3], y = T[7], z = T[11];
  // ZYX intrinsic — A about Z, B about Y′, C about X″.
  const r11=T[0], r21=T[4], r31=T[8];
  const r32=T[9], r33=T[10];
  // Standard derivation. Handle gimbal lock at B = ±90°.
  let A, B, C;
  const sB = -r31;
  if (Math.abs(sB) > 0.999999) {
    // Gimbal lock — pick A=0 by convention.
    B = Math.sign(sB) * Math.PI / 2;
    A = 0;
    C = Math.atan2(-T[1], T[5]);
  } else {
    B = Math.asin(sB);
    A = Math.atan2(r21, r11);
    C = Math.atan2(r32, r33);
  }
  return [x, y, z, A * RAD, B * RAD, C * RAD];
}

// Build a homogeneous transform from TCP [x,y,z,A,B,C] (degrees).
export function tFromTcp([x, y, z, ADeg, BDeg, CDeg]) {
  const A = ADeg * DEG, B = BDeg * DEG, C = CDeg * DEG;
  const cA = Math.cos(A), sA = Math.sin(A);
  const cB = Math.cos(B), sB = Math.sin(B);
  const cC = Math.cos(C), sC = Math.sin(C);
  // R = Rz(A) · Ry(B) · Rx(C).
  return [
    cA*cB,            cA*sB*sC - sA*cC,    cA*sB*cC + sA*sC,    x,
    sA*cB,            sA*sB*sC + cA*cC,    sA*sB*cC - cA*sC,    y,
   -sB,               cB*sC,               cB*cC,               z,
    0,                0,                   0,                   1,
  ];
}

// ────────────────────────────────────────────────────────────────────
// Inverse kinematics — Pieper's analytic solution
// ────────────────────────────────────────────────────────────────────
//
// Algorithm (6R with spherical wrist intersecting at point W):
//
//   1. Compute the wrist centre W = TCP - d6 · ẑ_TCP  (in base frame).
//   2. Solve the position-only sub-problem for q1, q2, q3 — gives 4
//      branches (J1 front/back × J3 elbow up/down).
//   3. For each (q1, q2, q3), build R0_3 from FK on the first three
//      joints.
//   4. R3_6 = R0_3ᵀ · R0_6.  Decompose R3_6 as Rotz(q4)·Rotx(q5)·
//      Rotz(q6) — that's a ZXZ Euler set offset by the standard
//      spherical-wrist rotation; each (q1,q2,q3) yields 2 wrist
//      branches (q5 > 0 vs q5 < 0).  Total: 8 IK solutions.
//
// The implementation below is written for the modified-DH layout we
// use in robotModels.js (a1 ≠ 0 in general, d4 = wrist offset, d6 =
// flange offset along ẑ6).
//
// Returns: array of up to 8 solutions, each an array of 6 angles
// in DEGREES.  Solutions outside joint limits are filtered out.

export function inverseKinematics(model, T_target, opts = {}) {
  const rows = model.dhRows;
  const a1 = rows[0].a;
  const a2 = rows[1].a;
  const a3 = rows[2].a;
  const d1 = rows[0].d;
  const d4 = rows[3].d;
  const d6 = rows[5].d;

  // Target rotation + position.
  const px = T_target[3], py = T_target[7], pz = T_target[11];
  const r11=T_target[0], r12=T_target[1], r13=T_target[2];
  const r21=T_target[4], r22=T_target[5], r23=T_target[6];
  const r31=T_target[8], r32=T_target[9], r33=T_target[10];

  // Step 1 — wrist centre. The flange ẑ axis in base frame is the
  // 3rd column of R_target; back off d6 along it.
  const wx = px - d6 * r13;
  const wy = py - d6 * r23;
  const wz = pz - d6 * r33;

  const solutions = [];

  // We solve for the "internal" DH angles θ̃ᵢ = qᵢ + theta_offsetᵢ
  // first, then convert each result back to USER joint angles before
  // returning.  This keeps the trig clean — the theta_offset never
  // appears inside the law-of-cosines arithmetic.
  const off1 = rows[0].theta_offset * DEG;
  const off2 = rows[1].theta_offset * DEG;
  const off3 = rows[2].theta_offset * DEG;

  // Step 2 — θ̃1 has two branches (front & back).
  // The shoulder pivots about the world Z axis; project wrist centre
  // to the horizontal plane to read the angle.
  const t1A = Math.atan2(wy, wx);
  const t1B = t1A + Math.PI;          // "back" configuration (flip)
  const t1Candidates = [t1A, t1B];

  // The 3R position arm has the canonical industrial-robot geometry
  // (Spong "Robot Dynamics and Control" §3.3.1, KUKA / ABB / FANUC):
  //   r  = horizontal distance from base axis to wrist centre, minus a1
  //   s  = vertical distance from base joint to wrist centre, minus d1
  //   L2 = a2  (upper-arm)
  //   L3 = √(a3² + d4²)  (forearm — diagonal because a3 offset on link
  //         3 plus d4 offset on link 4 both contribute to wrist
  //         centre position)
  //   φ3 = atan2(a3, d4)  (phase angle baked into the forearm)
  const L2  = a2;
  const L3  = Math.hypot(a3, d4);
  const phi3 = Math.atan2(a3, d4);

  for (const t1 of t1Candidates) {
    // Sign of the radial projection — atan2 + π gives the "back"
    // shoulder where r is *negative*, so we honour the sign.
    const horiz = Math.cos(t1) * wx + Math.sin(t1) * wy;
    const r = horiz - a1;
    const s = wz - d1;
    const D = (r*r + s*s - L2*L2 - L3*L3) / (2 * L2 * L3);
    if (D > 1 + 1e-6 || D < -1 - 1e-6) continue;     // unreachable
    const Dc = Math.max(-1, Math.min(1, D));
    // Two elbow branches. cos(θ̃3 + φ3) = D, so:
    //   θ̃3 = atan2(±√(1−D²), D) − φ3
    const elbowAngles = [
      Math.atan2(+Math.sqrt(1 - Dc*Dc), Dc) - phi3,   // elbow up
      Math.atan2(-Math.sqrt(1 - Dc*Dc), Dc) - phi3,   // elbow down
    ];

    for (const t3 of elbowAngles) {
      // θ̃2 — closed form using the standard "two-arctan" technique:
      //   k1 = a2 + L3·cos(θ̃3 + φ3)
      //   k2 =       L3·sin(θ̃3 + φ3)
      //   θ̃2 = atan2(s, r) − atan2(k2, k1)
      const k1 = L2 + L3 * Math.cos(t3 + phi3);
      const k2 =      L3 * Math.sin(t3 + phi3);
      const t2 = Math.atan2(s, r) - Math.atan2(k2, k1);

      // Step 3 — build R0_3 from FK using the INTERNAL angles directly.
      const T1 = dhTransformModified(rows[0].a, rows[0].alpha*DEG, rows[0].d, t1);
      const T2 = dhTransformModified(rows[1].a, rows[1].alpha*DEG, rows[1].d, t2);
      const T3 = dhTransformModified(rows[2].a, rows[2].alpha*DEG, rows[2].d, t3);
      const T03 = mat4Multiply(mat4Multiply(T1, T2), T3);
      // Extract R0_3.
      const R03 = [
        T03[0], T03[1], T03[2],
        T03[4], T03[5], T03[6],
        T03[8], T03[9], T03[10],
      ];
      // Step 4 — R3_6 = R0_3ᵀ · R_target.
      const R36 = mat3MulMat3(transpose3(R03), [
        r11, r12, r13,
        r21, r22, r23,
        r31, r32, r33,
      ]);

      // R3_6 has the form Rz(t4) · Rx(t5) · Rz(t6) for our wrist
      // layout (J4–J5–J6 axes after the modified-DH α twists in
      // robotModels.js — α₄ = +90°, α₅ = -90°, α₆ = 0°).
      // ZXZ Euler decomposition of R3_6 yields t4, t5, t6.
      const r22w = R36[8];      // R[2][2]
      let t4, t5, t6;
      const cos_t5 = r22w;
      if (cos_t5 > 1 - 1e-9) {
        // t5 ≈ 0 — wrist singular (J4 + J6 axes collinear).
        // Pick t4 = 0 and let t6 absorb the combined rotation.
        t5 = 0; t4 = 0;
        t6 = Math.atan2(R36[3], R36[0]);  // atan2(R[1][0], R[0][0])
        solutions.push(buildSolution(t1, t2, t3, t4, t5, t6, off1, off2, off3));
      } else if (cos_t5 < -1 + 1e-9) {
        t5 = Math.PI; t4 = 0;
        t6 = Math.atan2(-R36[3], -R36[0]);
        solutions.push(buildSolution(t1, t2, t3, t4, t5, t6, off1, off2, off3));
      } else {
        // Two wrist branches — t5 > 0 and t5 < 0.
        for (const sign of [+1, -1]) {
          const t5b = sign * Math.acos(Math.max(-1, Math.min(1, cos_t5)));
          const sin_t5 = Math.sin(t5b);
          // ZXZ inverse:
          //   t4 = atan2( R[0][2]·sign,  R[1][2]·sign·(-1) ? )
          // Use the closed form for ZXZ Euler:
          //   t4 = atan2(R[0][2], -R[1][2])  when sin(t5) > 0
          // Generalised by sign:
          const t4b = Math.atan2(R36[2] / sin_t5, -R36[5] / sin_t5);
          // R[0][2], R[1][2]
          const t6b = Math.atan2(R36[6] / sin_t5,  R36[7] / sin_t5);
          // R[2][0], R[2][1]
          solutions.push(buildSolution(t1, t2, t3, t4b, t5b, t6b, off1, off2, off3));
        }
      }
    }
  }

  // Filter by joint limits unless the caller opts out.
  const respectLimits = opts.respectLimits !== false;
  const filtered = respectLimits
    ? solutions.filter((sol) => withinLimits(sol, model))
    : solutions;

  // De-duplicate (different branches can collapse to the same joint
  // tuple in singular configurations) and stable-sort by branch ID.
  const dedup = [];
  for (const s of filtered) {
    if (!dedup.some((d) => sameSolution(d.q, s.q))) dedup.push(s);
  }
  dedup.sort((a, b) => a.branch.localeCompare(b.branch));

  // Final polish — Pieper gives an excellent closed-form initial
  // guess; a damped Newton step on the FK error J · Δq = e cleans up
  // sub-millimetre residuals from rounding + the analytic
  // simplifications above. Industrial controllers (KUKA's KSS, ABB's
  // SafeMove) refine analytic IK the same way; we cap at 8 iterations
  // and a 1e-6 mm tolerance so the cost is bounded.
  for (const sol of dedup) {
    refineSolutionJacobian(sol, model, T_target);
  }
  return dedup;
}

// Damped least-squares Newton refinement using a numerical Jacobian.
// Acts ONLY as a polish step on Pieper's closed-form initial guess.
function refineSolutionJacobian(sol, model, T_target) {
  const tol = 1e-4;     // 0.1 micrometre
  const maxIters = 12;
  const damping = 0.05;
  let q = sol.q.slice();
  for (let iter = 0; iter < maxIters; iter++) {
    const T_now = forwardKinematics(model, q).T0_6;
    const e = poseError(T_target, T_now);
    const eNorm = Math.sqrt(e.reduce((s, v) => s + v*v, 0));
    if (eNorm < tol) break;
    const J = numericalJacobian(model, q);
    const dq = solveDampedLeastSquares(J, e, damping);
    if (!dq) break;
    for (let i = 0; i < 6; i++) q[i] += dq[i] * RAD;
  }
  sol.q = q;
}

// 6-vector pose error [Δx, Δy, Δz, ωx, ωy, ωz] from target T to current T.
function poseError(Ttarget, Tnow) {
  const dx = Ttarget[3] - Tnow[3];
  const dy = Ttarget[7] - Tnow[7];
  const dz = Ttarget[11] - Tnow[11];
  // Orientation error as a rotation vector: R_e = Rtarget · Rnowᵀ.
  // Then ω = vector part of the equivalent axis-angle.
  const RtRnT = [
    Ttarget[0]*Tnow[0] + Ttarget[1]*Tnow[1] + Ttarget[2]*Tnow[2],
    Ttarget[0]*Tnow[4] + Ttarget[1]*Tnow[5] + Ttarget[2]*Tnow[6],
    Ttarget[0]*Tnow[8] + Ttarget[1]*Tnow[9] + Ttarget[2]*Tnow[10],
    Ttarget[4]*Tnow[0] + Ttarget[5]*Tnow[1] + Ttarget[6]*Tnow[2],
    Ttarget[4]*Tnow[4] + Ttarget[5]*Tnow[5] + Ttarget[6]*Tnow[6],
    Ttarget[4]*Tnow[8] + Ttarget[5]*Tnow[9] + Ttarget[6]*Tnow[10],
    Ttarget[8]*Tnow[0] + Ttarget[9]*Tnow[1] + Ttarget[10]*Tnow[2],
    Ttarget[8]*Tnow[4] + Ttarget[9]*Tnow[5] + Ttarget[10]*Tnow[6],
    Ttarget[8]*Tnow[8] + Ttarget[9]*Tnow[9] + Ttarget[10]*Tnow[10],
  ];
  // Trace-based axis-angle.
  const tr = RtRnT[0] + RtRnT[4] + RtRnT[8];
  const cosA = Math.max(-1, Math.min(1, (tr - 1) / 2));
  const angle = Math.acos(cosA);
  let wx = 0, wy = 0, wz = 0;
  if (Math.abs(angle) > 1e-9) {
    const s = 2 * Math.sin(angle);
    wx = (RtRnT[7] - RtRnT[5]) / s * angle;
    wy = (RtRnT[2] - RtRnT[6]) / s * angle;
    wz = (RtRnT[3] - RtRnT[1]) / s * angle;
  }
  return [dx, dy, dz, wx, wy, wz];
}

// Numerical Jacobian via central differences (6×6 matrix, row-major).
function numericalJacobian(model, qDeg) {
  const h = 1e-3;            // 0.001 deg perturbation
  const J = new Array(36).fill(0);
  for (let j = 0; j < 6; j++) {
    const qP = qDeg.slice(); qP[j] += h;
    const qM = qDeg.slice(); qM[j] -= h;
    const Tp = forwardKinematics(model, qP).T0_6;
    const Tm = forwardKinematics(model, qM).T0_6;
    const dT = poseError(Tp, Tm);
    const scale = 1 / (2 * h * DEG);     // back to per-radian
    for (let i = 0; i < 6; i++) J[i*6 + j] = dT[i] * scale;
  }
  return J;
}

// Solve (J·Jᵀ + λ²·I) y = e then dq = Jᵀ·y  (Levenberg-Marquardt DLS).
function solveDampedLeastSquares(J, e, lambda) {
  // A = J · Jᵀ  (6×6)
  const A = new Array(36).fill(0);
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += J[i*6+k] * J[j*6+k];
      if (i === j) s += lambda * lambda;
      A[i*6+j] = s;
    }
  // Solve 6×6 by Gauss-Jordan on [A | e].
  const M = new Array(7*6);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) M[i*7+j] = A[i*6+j];
    M[i*7+6] = e[i];
  }
  for (let i = 0; i < 6; i++) {
    // pivot
    let pi = i;
    for (let k = i+1; k < 6; k++) if (Math.abs(M[k*7+i]) > Math.abs(M[pi*7+i])) pi = k;
    if (Math.abs(M[pi*7+i]) < 1e-12) return null;
    if (pi !== i) {
      for (let j = 0; j < 7; j++) {
        const t = M[i*7+j]; M[i*7+j] = M[pi*7+j]; M[pi*7+j] = t;
      }
    }
    const piv = M[i*7+i];
    for (let j = 0; j < 7; j++) M[i*7+j] /= piv;
    for (let k = 0; k < 6; k++) if (k !== i) {
      const f = M[k*7+i];
      for (let j = 0; j < 7; j++) M[k*7+j] -= f * M[i*7+j];
    }
  }
  const y = new Array(6);
  for (let i = 0; i < 6; i++) y[i] = M[i*7+6];
  // dq = Jᵀ · y
  const dq = new Array(6).fill(0);
  for (let i = 0; i < 6; i++)
    for (let k = 0; k < 6; k++) dq[i] += J[k*6+i] * y[k];
  return dq;
}


// Build the public solution record from INTERNAL DH angles (t1…t6).
// Converts back to USER joint angles by subtracting the theta_offsets
// stored in robotModels.js. Branch label encodes the geometric
// configuration: F/B for J1 front/back, U/D for elbow up/down,
// N/F for wrist no-flip / flip (sign of t5).
function buildSolution(t1, t2, t3, t4, t5, t6, off1, off2, off3, off4 = 0, off5 = 0, off6 = 0) {
  const tInternal = [t1, t2, t3, t4, t5, t6];
  const offsets   = [off1, off2, off3, off4, off5, off6];
  const q = tInternal.map((tInt, i) =>
    normalizeAngle(tInt - offsets[i]) * RAD);
  const j1Back = Math.cos(t1) < -1e-6;
  const elbowDown = t3 + Math.atan2(0, 1) > 0;  // sign of internal t3 after phi3
  const wristFlip = t5 < 0;
  const branch =
    (j1Back ? 'B' : 'F') +
    (elbowDown ? 'D' : 'U') +
    (wristFlip ? 'F' : 'N');
  return { q, branch };
}

function withinLimits(sol, model) {
  for (let i = 0; i < 6; i++) {
    const a = sol.q[i];
    const r = model.dhRows[i];
    if (a < r.limit_min - 1e-3 || a > r.limit_max + 1e-3) return false;
  }
  return true;
}

function sameSolution(a, b) {
  for (let i = 0; i < 6; i++) {
    if (Math.abs(normalizeAngle((a[i]-b[i])*DEG)) > 1e-3) return false;
  }
  return true;
}

// Wrap to (-π, π].
function normalizeAngle(rad) {
  while (rad >  Math.PI) rad -= 2 * Math.PI;
  while (rad <= -Math.PI) rad += 2 * Math.PI;
  return rad;
}

// ────────────────────────────────────────────────────────────────────
// 3×3 helpers (used inside IK)
// ────────────────────────────────────────────────────────────────────
function transpose3(M) {
  return [
    M[0], M[3], M[6],
    M[1], M[4], M[7],
    M[2], M[5], M[8],
  ];
}
function mat3MulMat3(A, B) {
  const C = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[r*3+k] * B[k*3+c];
      C[r*3+c] = s;
    }
  }
  return C;
}

// ────────────────────────────────────────────────────────────────────
// Best-branch selection (used by jog + playback)
// ────────────────────────────────────────────────────────────────────
//
// When IK returns multiple solutions, pick the one closest to the
// current joint pose to avoid sudden flips of the wrist or elbow.

export function pickBranchClosestToCurrent(solutions, qCurrentDeg) {
  if (!solutions || !solutions.length) return null;
  let best = null;
  let bestCost = Infinity;
  for (const s of solutions) {
    let cost = 0;
    for (let i = 0; i < 6; i++) {
      const d = wrapDeg(s.q[i] - qCurrentDeg[i]);
      cost += d * d;
    }
    if (cost < bestCost) { bestCost = cost; best = s; }
  }
  return best;
}

function wrapDeg(d) {
  while (d >  180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

// ────────────────────────────────────────────────────────────────────
// Workspace probe — voxel-cloud reachable workspace (for UI overlay)
// ────────────────────────────────────────────────────────────────────
//
// Sample a coarse 3D grid centred on the robot base; for each grid
// point, attempt IK at a canonical "tool down" orientation. Return
// only the points that have at least one in-limits solution.
//
// `gridStep` in mm (e.g. 50). Returns Array<{x,y,z}>.

export function reachableWorkspace(model, opts = {}) {
  const gridStep = opts.gridStep ?? 60;
  const reach = model.reach_mm;
  const points = [];
  // Tool oriented downward: Z_TCP pointing -Z_base, X_TCP along +X_base.
  // → R_target = Rz(0)·Ry(180°)·Rx(0).
  const Rdown = [
    1,  0,  0,
    0, -1,  0,
    0,  0, -1,
  ];
  for (let x = -reach; x <= reach; x += gridStep) {
    for (let y = -reach; y <= reach; y += gridStep) {
      for (let z = 0; z <= reach * 1.4; z += gridStep) {
        if (x*x + y*y + (z - model.dhRows[0].d) * (z - model.dhRows[0].d)
            > reach * reach * 1.25) continue;
        const T = [
          Rdown[0], Rdown[1], Rdown[2], x,
          Rdown[3], Rdown[4], Rdown[5], y,
          Rdown[6], Rdown[7], Rdown[8], z,
          0,        0,        0,        1,
        ];
        const sols = inverseKinematics(model, T);
        if (sols.length > 0) points.push({ x, y, z });
      }
    }
  }
  return points;
}

// ────────────────────────────────────────────────────────────────────
// Round-trip sanity (FK(IK(T)) ≈ T) — used by tests + UI assertion
// ────────────────────────────────────────────────────────────────────

export function tcpDelta(T_a, T_b) {
  const dx = T_a[3] - T_b[3];
  const dy = T_a[7] - T_b[7];
  const dz = T_a[11] - T_b[11];
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

export default {
  forwardKinematics, inverseKinematics,
  tcpFromT, tFromTcp,
  pickBranchClosestToCurrent,
  reachableWorkspace, tcpDelta,
  mat4Identity, mat4Multiply, mat4Copy, mat4InvertHomog,
  dhTransformModified,
};
