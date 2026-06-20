#include "forge/MultibodyDynamics.hpp"

#include <Eigen/Dense>

#include <algorithm>
#include <cmath>

namespace forge {

// ============================================================================
// Constrained multibody dynamics — index-3 DAE, HHT-α + Baumgarte.
//
//   M q̈ + Φ_qᵀ λ = Q(q, q̇, t)             (Newton-Euler, generalised)
//   Φ(q) = 0                                (holonomic constraints)
//
// q   = [ pos₀(3) rot₀(3) | pos₁(3) rot₁(3) | … ]   (6 DOF / body, axis-angle)
// M   = blkdiag( m·I₃ , J )                          (constant, lumped at COM)
// Q   = applied forces/torques + gravity + gyroscopic −ω×(Jω)
//
// Each step solves the saddle-point (KKT) system for (q̈, λ):
//
//   [  M    Φ_qᵀ ] [ q̈ ]   [ Q − M_extra        ]
//   [  Φ_q   0   ] [ λ  ] = [ −(Φ̇_q q̇ + γ_stab) ]
//
// with Baumgarte stabilisation γ_stab = 2ξω Φ̇ + ω² Φ rolled into the
// acceleration constraint Φ̈ = −γ_stab so the constraint manifold is actively
// pulled back rather than drifting (index reduction 3 → effectively 1).
//
// HHT-α blends the residual at t_{n+1} and t_n with weight (1+α)/(−α). With
// α = 0 the scheme is trapezoidal Newmark (β=¼, γ=½), exactly the
// constant-average-acceleration rule the Fea transient path already uses.
// ============================================================================

namespace {

constexpr std::size_t kDof = 6; // 3 trans + 3 rot per body

using Vec = Eigen::VectorXd;
using Mat = Eigen::MatrixXd;

inline std::array<double, 3> cross3(const std::array<double, 3>& a,
                                    const std::array<double, 3>& b) {
    return {a[1]*b[2] - a[2]*b[1],
            a[2]*b[0] - a[0]*b[2],
            a[0]*b[1] - a[1]*b[0]};
}

// Rotate a body-frame vector into world via the body's axis-angle rotation.
inline std::array<double, 3> rotateLocal(const double* rot,
                                         const std::array<double, 3>& v) {
    Transform4x4 x = makeTransform(0, 0, 0, rot[0], rot[1], rot[2]);
    return {
        x.m[0]*v[0] + x.m[1]*v[1] + x.m[2]*v[2],
        x.m[4]*v[0] + x.m[5]*v[1] + x.m[6]*v[2],
        x.m[8]*v[0] + x.m[9]*v[1] + x.m[10]*v[2],
    };
}

// World position of a body-local point: p_world = COM + R(rot)·local.
inline std::array<double, 3> worldPoint(const double* q, std::size_t base,
                                        const std::array<double, 3>& local) {
    auto r = rotateLocal(q + base + 3, local);
    return {q[base+0] + r[0], q[base+1] + r[1], q[base+2] + r[2]};
}

// --- constraint residual ----------------------------------------------------
// Writes the scalar rows for one constraint at `row`; returns row count.
std::size_t evalConstraint(const MbdConstraint& c, const double* q,
                           double* out, std::size_t row) {
    const std::size_t a = c.bodyA * kDof;
    switch (c.kind) {
        case MbdConstraintKind::BallJoint: {
            auto p = worldPoint(q, a, c.pointA);
            out[row+0] = p[0] - c.anchor[0];
            out[row+1] = p[1] - c.anchor[1];
            out[row+2] = p[2] - c.anchor[2];
            return 3;
        }
        case MbdConstraintKind::AxisLock: {
            // Body's +Z body axis must stay collinear with the allowed world
            // axis: cross(R·ẑ_local, axis) lies in the plane ⟂ axis → 2 indep
            // equations. We use the two components of the cross product that
            // are largest for the nominal axis to keep the rows independent;
            // for the canonical axis = +Z this is the X and Y cross terms.
            auto zb = rotateLocal(q + a + 3, c.axis); // current orientation of
                                                      // the locked body axis
            auto cr = cross3(zb, c.axis);
            // Two rows orthogonal to `axis`. With axis≈+Z the natural picks
            // are cr[0],cr[1]; generalise by dropping the component along the
            // axis with the largest |component|.
            const double ax = std::abs(c.axis[0]);
            const double ay = std::abs(c.axis[1]);
            const double az = std::abs(c.axis[2]);
            if (az >= ax && az >= ay) { out[row+0] = cr[0]; out[row+1] = cr[1]; }
            else if (ay >= ax)        { out[row+0] = cr[0]; out[row+1] = cr[2]; }
            else                      { out[row+0] = cr[1]; out[row+1] = cr[2]; }
            return 2;
        }
        case MbdConstraintKind::Distance: {
            auto pa = worldPoint(q, a, c.pointA);
            auto pb = worldPoint(q, c.bodyB * kDof, c.pointB);
            const double dx = pb[0]-pa[0], dy = pb[1]-pa[1], dz = pb[2]-pa[2];
            out[row+0] = std::sqrt(dx*dx + dy*dy + dz*dz) - c.value;
            return 1;
        }
    }
    return 0;
}

std::size_t constraintRows(MbdConstraintKind k) {
    switch (k) {
        case MbdConstraintKind::BallJoint: return 3;
        case MbdConstraintKind::AxisLock:  return 2;
        case MbdConstraintKind::Distance:  return 1;
    }
    return 0;
}

// Evaluate the full constraint vector Φ(q).
void evalAll(const std::vector<MbdConstraint>& cs, const Vec& q, Vec& phi) {
    std::size_t row = 0;
    for (const auto& c : cs) row += evalConstraint(c, q.data(), phi.data(), row);
}

// Forward-difference constraint Jacobian Φ_q (nC × nDof), built exactly the
// way AssemblySolver does, restricted to the columns each constraint touches.
void buildJacobian(const std::vector<MbdConstraint>& cs, const Vec& q,
                   const Vec& phi0, Mat& J) {
    const std::size_t nDof = static_cast<std::size_t>(q.size());
    J.setZero();
    Vec qp = q;
    std::vector<double> rp(static_cast<std::size_t>(phi0.size()));
    // For each constraint, perturb only its involved bodies' 6 DOFs.
    std::size_t row = 0;
    for (const auto& c : cs) {
        const std::size_t nr = constraintRows(c.kind);
        std::array<std::uint32_t, 2> bodies{c.bodyA, c.bodyB};
        const std::size_t nb = (c.kind == MbdConstraintKind::Distance) ? 2 : 1;
        for (std::size_t bi = 0; bi < nb; ++bi) {
            const std::size_t base = bodies[bi] * kDof;
            for (std::size_t k = 0; k < kDof; ++k) {
                const std::size_t col = base + k;
                const double orig = qp[col];
                const double h = 1e-7 * std::max(1.0, std::abs(orig));
                qp[col] = orig + h;
                evalConstraint(c, qp.data(), rp.data(), row);
                qp[col] = orig;
                for (std::size_t rr = 0; rr < nr; ++rr) {
                    const double d = (rp[row+rr] - phi0[static_cast<int>(row+rr)]) / h;
                    if (std::abs(d) > 1e-14)
                        J(static_cast<int>(row+rr), static_cast<int>(col)) = d;
                }
            }
        }
        row += nr;
    }
}

// Generalised applied force Q = external + gravity + gyroscopic.
//   translational rows: ΣF + m·g
//   rotational rows:     Στ − ω × (Jω)     (Euler gyroscopic term, world J)
void buildForce(const std::vector<MbdBody>& bodies,
                const std::vector<MbdLoad>& loads,
                const MbdGravity& grav,
                const Vec& q, const Vec& qd, Vec& Q) {
    Q.setZero();
    for (std::size_t b = 0; b < bodies.size(); ++b) {
        const std::size_t base = b * kDof;
        const double m = bodies[b].mass;
        Q[static_cast<int>(base+0)] += m * grav.g[0];
        Q[static_cast<int>(base+1)] += m * grav.g[1];
        Q[static_cast<int>(base+2)] += m * grav.g[2];
        // Gyroscopic −ω × (J_world ω). J_world = R J_body Rᵀ.
        const double* rot = q.data() + base + 3;
        Transform4x4 x = makeTransform(0, 0, 0, rot[0], rot[1], rot[2]);
        Eigen::Matrix3d R;
        R << x.m[0], x.m[1], x.m[2],
             x.m[4], x.m[5], x.m[6],
             x.m[8], x.m[9], x.m[10];
        Eigen::Matrix3d Jb;
        Jb << bodies[b].inertia[0], bodies[b].inertia[1], bodies[b].inertia[2],
              bodies[b].inertia[3], bodies[b].inertia[4], bodies[b].inertia[5],
              bodies[b].inertia[6], bodies[b].inertia[7], bodies[b].inertia[8];
        Eigen::Matrix3d Jw = R * Jb * R.transpose();
        Eigen::Vector3d w(qd[static_cast<int>(base+3)],
                          qd[static_cast<int>(base+4)],
                          qd[static_cast<int>(base+5)]);
        Eigen::Vector3d gyro = w.cross(Jw * w);
        Q[static_cast<int>(base+3)] -= gyro[0];
        Q[static_cast<int>(base+4)] -= gyro[1];
        Q[static_cast<int>(base+5)] -= gyro[2];
    }
    for (const auto& ld : loads) {
        const std::size_t base = ld.body * kDof;
        Q[static_cast<int>(base+0)] += ld.force[0];
        Q[static_cast<int>(base+1)] += ld.force[1];
        Q[static_cast<int>(base+2)] += ld.force[2];
        Q[static_cast<int>(base+3)] += ld.torque[0];
        Q[static_cast<int>(base+4)] += ld.torque[1];
        Q[static_cast<int>(base+5)] += ld.torque[2];
    }
}

// Build the constant block-diagonal mass matrix M = blkdiag(m·I₃, J_world).
// The rotational block is the *world*-frame inertia at the current pose; for
// the verified single-axis benchmarks this is constant, and recomputing it
// per step keeps general 3-D motion consistent without a separate update path.
void buildMass(const std::vector<MbdBody>& bodies, const Vec& q, Mat& M) {
    M.setZero();
    for (std::size_t b = 0; b < bodies.size(); ++b) {
        const std::size_t base = b * kDof;
        const double m = bodies[b].mass;
        M(static_cast<int>(base+0), static_cast<int>(base+0)) = m;
        M(static_cast<int>(base+1), static_cast<int>(base+1)) = m;
        M(static_cast<int>(base+2), static_cast<int>(base+2)) = m;
        const double* rot = q.data() + base + 3;
        Transform4x4 x = makeTransform(0, 0, 0, rot[0], rot[1], rot[2]);
        Eigen::Matrix3d R;
        R << x.m[0], x.m[1], x.m[2],
             x.m[4], x.m[5], x.m[6],
             x.m[8], x.m[9], x.m[10];
        Eigen::Matrix3d Jb;
        Jb << bodies[b].inertia[0], bodies[b].inertia[1], bodies[b].inertia[2],
              bodies[b].inertia[3], bodies[b].inertia[4], bodies[b].inertia[5],
              bodies[b].inertia[6], bodies[b].inertia[7], bodies[b].inertia[8];
        Eigen::Matrix3d Jw = R * Jb * R.transpose();
        M.block(static_cast<int>(base+3), static_cast<int>(base+3), 3, 3) = Jw;
    }
}

// Total mechanical energy: Σ ½ m v² + ½ ωᵀ J_world ω − Σ m g·r.
double totalEnergy(const std::vector<MbdBody>& bodies, const MbdGravity& grav,
                   const Vec& q, const Vec& qd) {
    double E = 0.0;
    for (std::size_t b = 0; b < bodies.size(); ++b) {
        const std::size_t base = b * kDof;
        const double m = bodies[b].mass;
        Eigen::Vector3d v(qd[static_cast<int>(base+0)],
                          qd[static_cast<int>(base+1)],
                          qd[static_cast<int>(base+2)]);
        E += 0.5 * m * v.squaredNorm();
        const double* rot = q.data() + base + 3;
        Transform4x4 x = makeTransform(0, 0, 0, rot[0], rot[1], rot[2]);
        Eigen::Matrix3d R;
        R << x.m[0], x.m[1], x.m[2],
             x.m[4], x.m[5], x.m[6],
             x.m[8], x.m[9], x.m[10];
        Eigen::Matrix3d Jb;
        Jb << bodies[b].inertia[0], bodies[b].inertia[1], bodies[b].inertia[2],
              bodies[b].inertia[3], bodies[b].inertia[4], bodies[b].inertia[5],
              bodies[b].inertia[6], bodies[b].inertia[7], bodies[b].inertia[8];
        Eigen::Matrix3d Jw = R * Jb * R.transpose();
        Eigen::Vector3d w(qd[static_cast<int>(base+3)],
                          qd[static_cast<int>(base+4)],
                          qd[static_cast<int>(base+5)]);
        E += 0.5 * w.dot(Jw * w);
        // Potential energy (gravity points along grav.g; PE = −m g·r).
        E -= m * (grav.g[0]*q[static_cast<int>(base+0)] +
                  grav.g[1]*q[static_cast<int>(base+1)] +
                  grav.g[2]*q[static_cast<int>(base+2)]);
    }
    return E;
}

// Solve the KKT saddle-point system for (a, λ):
//   [ M  Jᵀ ][ a ]   [ rhsTop ]
//   [ J  0  ][ λ ] = [ rhsBot ]
// Returns the acceleration `a` (λ discarded by the caller).
Vec solveKKT(const Mat& M, const Mat& J, const Vec& rhsTop, const Vec& rhsBot) {
    const int n = static_cast<int>(M.rows());
    const int m = static_cast<int>(J.rows());
    if (m == 0) {
        // Unconstrained: M a = rhsTop.
        return M.ldlt().solve(rhsTop);
    }
    Mat K(n + m, n + m);
    K.setZero();
    K.topLeftCorner(n, n)      = M;
    K.topRightCorner(n, m)     = J.transpose();
    K.bottomLeftCorner(m, n)   = J;
    // Tiny regularisation on the λ block guards against redundant constraints
    // (rank-deficient J) — standard for an over-constrained mate set.
    K.bottomRightCorner(m, m)  = -1e-9 * Mat::Identity(m, m);
    Vec rhs(n + m);
    rhs.head(n) = rhsTop;
    rhs.tail(m) = rhsBot;
    Vec sol = K.fullPivLu().solve(rhs);
    return sol.head(n);
}

} // namespace

// ----------------------------------------------------------------------------

MbdResult simulateMultibody(const std::vector<MbdBody>& bodies,
                            const std::vector<MbdConstraint>& constraints,
                            const std::vector<MbdLoad>& loads,
                            const MbdGravity& gravity,
                            const MbdConfig& cfg) {
    MbdResult res;
    const std::size_t nB = bodies.size();
    if (nB == 0 || cfg.steps == 0) { res.stable = true; return res; }

    const std::size_t nDof = nB * kDof;
    std::size_t nC = 0;
    for (const auto& c : constraints) nC += constraintRows(c.kind);

    // --- state vectors ---
    Vec q(static_cast<int>(nDof)), qd(static_cast<int>(nDof)), qdd(static_cast<int>(nDof));
    q.setZero(); qd.setZero(); qdd.setZero();
    for (std::size_t b = 0; b < nB; ++b) {
        const std::size_t base = b * kDof;
        for (int i = 0; i < 3; ++i) {
            q[static_cast<int>(base+i)]   = bodies[b].position[i];
            q[static_cast<int>(base+3+i)] = bodies[b].orientation[i];
            qd[static_cast<int>(base+i)]   = bodies[b].linVel[i];
            qd[static_cast<int>(base+3+i)] = bodies[b].angVel[i];
        }
    }

    // HHT-α / Newmark coefficients. α ∈ [-1/3,0]; β,γ from α for 2nd-order.
    const double alpha = std::clamp(cfg.alpha, -1.0/3.0, 0.0);
    const double gamma = 0.5 - alpha;
    const double beta  = 0.25 * (1.0 - alpha) * (1.0 - alpha);
    const double dt = cfg.dt;
    const double bOm = cfg.baumgarteOmega;
    const double bZ  = cfg.baumgarteZeta;

    Mat M(static_cast<int>(nDof), static_cast<int>(nDof));
    Mat J(static_cast<int>(nC), static_cast<int>(nDof));
    Vec phi(static_cast<int>(nC)), phidot(static_cast<int>(nC));
    Vec Q(static_cast<int>(nDof));

    // --- consistent initial acceleration: solve KKT at t=0 ---
    auto computeAccel = [&](const Vec& qc, const Vec& qdc) -> Vec {
        buildMass(bodies, qc, M);
        buildForce(bodies, loads, gravity, qc, qdc, Q);
        if (nC > 0) {
            evalAll(constraints, qc, phi);
            buildJacobian(constraints, qc, phi, J);
            phidot = J * qdc;
            // Baumgarte: enforce Φ̈ = −(2ξω Φ̇ + ω² Φ). The acceleration
            // constraint is J·a = −J̇·q̇ − (2ξω Φ̇ + ω² Φ). We fold the
            // (small) J̇·q̇ term into the stabilisation by finite difference
            // of J along q̇ — but for the verified cases J̇·q̇ is captured by
            // the stabilisation magnitude; we use the standard reduced form
            // J·a = −(2ξω Φ̇ + ω² Φ) − γ_accel, with γ_accel ≈ J̇ q̇.
            // Estimate J̇ q̇ by finite difference of (J q̇) along the flow.
            const double eps = 1e-6;
            Vec qf = qc + eps * qdc;
            Vec phif(static_cast<int>(nC));
            evalAll(constraints, qf, phif);
            Mat Jf(static_cast<int>(nC), static_cast<int>(nDof));
            buildJacobian(constraints, qf, phif, Jf);
            Vec jdotqd = (Jf * qdc - J * qdc) / eps; // (J̇)·q̇
            Vec rhsBot = -jdotqd
                         - (2.0 * bZ * bOm) * phidot
                         - (bOm * bOm) * phi;
            return solveKKT(M, J, Q, rhsBot);
        }
        return solveKKT(M, J, Q, Q); // rhsBot unused when nC==0
    };

    qdd = computeAccel(q, qd);

    double E0 = totalEnergy(bodies, gravity, q, qd);
    res.maxConstraintDrift = 0.0;
    res.stable = true;

    auto record = [&](double t) {
        MbdSample s;
        s.t = t;
        s.position.resize(nB);
        s.orientation.resize(nB);
        s.linVel.resize(nB);
        s.angVel.resize(nB);
        for (std::size_t b = 0; b < nB; ++b) {
            const std::size_t base = b * kDof;
            for (int i = 0; i < 3; ++i) {
                s.position[b][i]    = q[static_cast<int>(base+i)];
                s.orientation[b][i] = q[static_cast<int>(base+3+i)];
                s.linVel[b][i]      = qd[static_cast<int>(base+i)];
                s.angVel[b][i]      = qd[static_cast<int>(base+3+i)];
            }
        }
        if (nC > 0) {
            evalAll(constraints, q, phi);
            s.constraintResidual = phi.norm();
        }
        s.energy = totalEnergy(bodies, gravity, q, qd);
        res.samples.push_back(std::move(s));
    };

    record(0.0);

    // --- HHT-α time march ---
    // Predictor (Newmark):
    //   q_{n+1}  = q_n + dt q̇_n + dt²(½−β) q̈_n + dt² β q̈_{n+1}
    //   q̇_{n+1} = q̇_n + dt(1−γ) q̈_n + dt γ q̈_{n+1}
    // The unknown q̈_{n+1} appears via the equation of motion evaluated at the
    // α-weighted state. For this block-constant-mass rigid system we solve the
    // (q̈, λ) KKT directly at the predicted configuration and iterate twice to
    // resolve the implicit coupling (fixed-point; converges in ≤2 for these
    // stiffnesses, matching the trapezoidal-Newmark behaviour).
    const std::uint32_t stride = std::max<std::uint32_t>(1, cfg.sampleStride);

    for (std::uint32_t step = 0; step < cfg.steps; ++step) {
        const Vec q_n = q, qd_n = qd, qdd_n = qdd;

        // Predictor with q̈_{n+1} ≈ q̈_n.
        Vec qddNew = qdd_n;
        for (int it = 0; it < 2; ++it) {
            Vec qNew  = q_n + dt * qd_n
                        + dt*dt*(0.5 - beta) * qdd_n
                        + dt*dt*beta * qddNew;
            Vec qdNew = qd_n + dt*(1.0 - gamma) * qdd_n + dt*gamma * qddNew;
            // HHT α-weighted state for the force/constraint evaluation.
            Vec qEval  = (1.0 + alpha) * qNew  - alpha * q_n;
            Vec qdEval = (1.0 + alpha) * qdNew - alpha * qd_n;
            qddNew = computeAccel(qEval, qdEval);
        }
        // Corrector at the resolved q̈_{n+1}.
        q  = q_n + dt * qd_n + dt*dt*(0.5 - beta) * qdd_n + dt*dt*beta * qddNew;
        qd = qd_n + dt*(1.0 - gamma) * qdd_n + dt*gamma * qddNew;
        qdd = qddNew;

        if (!q.allFinite() || !qd.allFinite()) { res.stable = false; break; }

        // Track constraint drift every step (cheap).
        if (nC > 0) {
            evalAll(constraints, q, phi);
            res.maxConstraintDrift = std::max(res.maxConstraintDrift, phi.norm());
        }

        res.stepsTaken = step + 1;
        if ((step + 1) % stride == 0)
            record(static_cast<double>(step + 1) * dt);
    }

    if (!res.samples.empty()) {
        const double Eend = res.samples.back().energy;
        res.energyDrift = (std::abs(E0) > 1e-12)
            ? std::abs(Eend - E0) / std::abs(E0)
            : std::abs(Eend - E0);
    }
    return res;
}

} // namespace forge
