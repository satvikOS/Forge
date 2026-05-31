#include "forge/AssemblySolver.hpp"

#include <Eigen/Dense>
#include <Eigen/Sparse>
#include <Eigen/SparseQR>
#include <Eigen/OrderingMethods>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>

namespace forge {

// ---------------------------------------------------------------- helpers

std::array<double, 9> rodrigues(double rx, double ry, double rz) {
    // R = I + sin(θ) K + (1 - cos(θ)) K² ; K = skew(r̂)
    const double theta2 = rx * rx + ry * ry + rz * rz;
    if (theta2 < 1e-24) {
        return {1, 0, 0,
                0, 1, 0,
                0, 0, 1};
    }
    const double theta = std::sqrt(theta2);
    const double s = std::sin(theta), c = std::cos(theta);
    const double k = (1.0 - c) / theta2;
    const double sn = s / theta;
    // K
    const double Kxx = 0,    Kxy = -rz,  Kxz =  ry;
    const double Kyx = rz,   Kyy = 0,    Kyz = -rx;
    const double Kzx = -ry,  Kzy = rx,   Kzz = 0;
    // K² = r r^T - θ² I  (rotation-vector identity)
    const double rxrx = rx*rx, ryry = ry*ry, rzrz = rz*rz;
    const double rxry = rx*ry, rxrz = rx*rz, ryrz = ry*rz;
    std::array<double, 9> R{};
    R[0] = 1 + sn*Kxx + k*(rxrx - theta2);
    R[1] = 0 + sn*Kxy + k*(rxry);
    R[2] = 0 + sn*Kxz + k*(rxrz);
    R[3] = 0 + sn*Kyx + k*(rxry);
    R[4] = 1 + sn*Kyy + k*(ryry - theta2);
    R[5] = 0 + sn*Kyz + k*(ryrz);
    R[6] = 0 + sn*Kzx + k*(rxrz);
    R[7] = 0 + sn*Kzy + k*(ryrz);
    R[8] = 1 + sn*Kzz + k*(rzrz - theta2);
    return R;
}

Transform4x4 makeTransform(double tx, double ty, double tz,
                           double rx, double ry, double rz) {
    auto R = rodrigues(rx, ry, rz);
    Transform4x4 t;
    t.m[0]  = R[0]; t.m[1]  = R[1]; t.m[2]  = R[2]; t.m[3]  = tx;
    t.m[4]  = R[3]; t.m[5]  = R[4]; t.m[6]  = R[5]; t.m[7]  = ty;
    t.m[8]  = R[6]; t.m[9]  = R[7]; t.m[10] = R[8]; t.m[11] = tz;
    t.m[12] = 0;    t.m[13] = 0;    t.m[14] = 0;    t.m[15] = 1;
    return t;
}

static std::array<double, 3> mul3(const Transform4x4& x,
                                  double cx, double cy, double cz,
                                  bool isPoint) {
    const double w = isPoint ? 1.0 : 0.0;
    return {
        x.m[0]*cx + x.m[1]*cy + x.m[2]*cz + x.m[3]*w,
        x.m[4]*cx + x.m[5]*cy + x.m[6]*cz + x.m[7]*w,
        x.m[8]*cx + x.m[9]*cy + x.m[10]*cz + x.m[11]*w,
    };
}

TopoFrame frameFor(const Transform4x4& x, std::uint32_t topoId) {
    TopoFrame f;
    switch (topoId) {
        case 0: // origin / CSYS
            f.point     = mul3(x, 0, 0, 0, true);
            f.direction = mul3(x, 0, 0, 1, false); // CSYS forward axis
            break;
        case 1: // primary axis (+Z direction, anchored at origin)
            f.point     = mul3(x, 0, 0, 0, true);
            f.direction = mul3(x, 0, 0, 1, false);
            break;
        case 2: // primary face (normal +Z, point on origin)
            f.point     = mul3(x, 0, 0, 0, true);
            f.direction = mul3(x, 0, 0, 1, false);
            break;
        case 3: // secondary axis (+X direction)
            f.point     = mul3(x, 0, 0, 0, true);
            f.direction = mul3(x, 1, 0, 0, false);
            break;
        default:
            f.point     = mul3(x, 0, 0, 0, true);
            f.direction = mul3(x, 0, 0, 1, false);
            break;
    }
    return f;
}

// Decompose Transform4x4 back into (tx,ty,tz, rx,ry,rz axis-angle).
// On entry the rotation submatrix must be orthonormal (det = +1). Forge's
// transform inputs come from this same encoding so the assumption holds
// through a solve cycle.
static void decompose(const Transform4x4& x,
                      double& tx, double& ty, double& tz,
                      double& rx, double& ry, double& rz) {
    tx = x.m[3]; ty = x.m[7]; tz = x.m[11];
    // trace gives 1 + 2 cos(θ)
    const double trace = x.m[0] + x.m[5] + x.m[10];
    const double cosTheta = std::clamp((trace - 1.0) * 0.5, -1.0, 1.0);
    const double theta = std::acos(cosTheta);
    if (theta < 1e-9) {
        rx = ry = rz = 0;
        return;
    }
    const double twoSin = 2.0 * std::sin(theta);
    rx = (x.m[9] - x.m[6]) / twoSin * theta;
    ry = (x.m[2] - x.m[8]) / twoSin * theta;
    rz = (x.m[4] - x.m[1]) / twoSin * theta;
}

// ---------------------------------------------------------------- solver

AssemblySolver& AssemblySolver::instance() {
    static AssemblySolver s;
    return s;
}

MateId AssemblySolver::addMate(MateKind kind, MateRef a, MateRef b, double value) {
    std::lock_guard<std::mutex> g(mtx_);
    Mate m{kind, a, b, value, true};
    if (!freeList_.empty()) {
        const auto idx = freeList_.back();
        freeList_.pop_back();
        mates_[idx] = MateSlot{m, true};
        return static_cast<MateId>(idx + 1);
    }
    mates_.push_back(MateSlot{m, true});
    return static_cast<MateId>(mates_.size());
}

void AssemblySolver::removeMate(MateId id) {
    if (id == kInvalidMate) return;
    std::lock_guard<std::mutex> g(mtx_);
    const auto idx = static_cast<std::size_t>(id - 1);
    if (idx >= mates_.size() || !mates_[idx].alive) return;
    mates_[idx].alive = false;
    freeList_.push_back(static_cast<std::uint32_t>(idx));
}

void AssemblySolver::setActive(MateId id, bool active) {
    if (id == kInvalidMate) return;
    std::lock_guard<std::mutex> g(mtx_);
    const auto idx = static_cast<std::size_t>(id - 1);
    if (idx >= mates_.size() || !mates_[idx].alive) {
        throw std::invalid_argument("AssemblySolver::setActive — bad mate id");
    }
    mates_[idx].mate.active = active;
}

bool AssemblySolver::exists(MateId id) const {
    if (id == kInvalidMate) return false;
    std::lock_guard<std::mutex> g(mtx_);
    const auto idx = static_cast<std::size_t>(id - 1);
    return idx < mates_.size() && mates_[idx].alive;
}

std::size_t AssemblySolver::mateCount() const {
    std::lock_guard<std::mutex> g(mtx_);
    return mates_.size() - freeList_.size();
}

void AssemblySolver::setFixed(InstanceId id, bool fixed) {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = std::lower_bound(fixedInstances_.begin(), fixedInstances_.end(), id);
    const bool present = it != fixedInstances_.end() && *it == id;
    if (fixed && !present) {
        fixedInstances_.insert(it, id);
    } else if (!fixed && present) {
        fixedInstances_.erase(it);
    }
}

bool AssemblySolver::isFixed(InstanceId id) const {
    std::lock_guard<std::mutex> g(mtx_);
    return std::binary_search(fixedInstances_.begin(), fixedInstances_.end(), id);
}

std::uint32_t AssemblySolver::iterations() const { return lastIterations_; }
double        AssemblySolver::residual()   const { return lastResidual_;   }

void AssemblySolver::clearAll() {
    std::lock_guard<std::mutex> g(mtx_);
    mates_.clear();
    freeList_.clear();
    fixedInstances_.clear();
    lastIterations_ = 0;
    lastResidual_ = 0;
}

// ---------------------------------------------------------------- residuals

namespace {

constexpr std::size_t kDof = 6; // 3 trans + 3 rot per instance

// Snapshot of the working state — every iteration rebuilds residuals from
// a transient std::vector<double> rather than touching the registry.
struct State {
    // Per active instance (id → column index into x).
    std::unordered_map<InstanceId, std::size_t> instCol;
    std::vector<InstanceId>                     instOrder;   // dense reverse
    std::vector<double>                         x;           // size = 6*N
    std::unordered_set<InstanceId>              fixedSet;
    std::vector<Mate>                           activeMates;
};

// Number of scalar residuals contributed by one mate.
std::size_t residualSize(MateKind k) {
    switch (k) {
        case MateKind::Coincident:    return 6; // origin (3) + axis (3)
        case MateKind::Concentric:    return 5; // axis-cross (3) + perp-offset (2 -> we use 3 cross of disp×axis)
        case MateKind::Parallel:      return 3; // cross product
        case MateKind::Perpendicular: return 1; // dot product
        case MateKind::Distance:      return 1; // |Δ| - d
        case MateKind::Angle:         return 1; // cos⁻¹(â·b̂) - θ
        case MateKind::Tangent:       return 1; // |n̂_A · (p_B − p_A)| (point on plane)
        case MateKind::Fixed:         return 0; // handled via fixedSet
    }
    return 0;
}

void writeFrame(const State& s, InstanceId id, Transform4x4& out) {
    auto it = s.instCol.find(id);
    if (it == s.instCol.end()) {
        // Not in active set; pull from registry verbatim.
        out = ComponentRegistry::instance().getTransform(id);
        return;
    }
    const auto base = it->second;
    out = makeTransform(s.x[base+0], s.x[base+1], s.x[base+2],
                        s.x[base+3], s.x[base+4], s.x[base+5]);
}

// Cross product helper.
inline std::array<double, 3> cross(const std::array<double, 3>& a,
                                   const std::array<double, 3>& b) {
    return {a[1]*b[2] - a[2]*b[1],
            a[2]*b[0] - a[0]*b[2],
            a[0]*b[1] - a[1]*b[0]};
}
inline double dot(const std::array<double, 3>& a, const std::array<double, 3>& b) {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}
inline double len(const std::array<double, 3>& a) {
    return std::sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2]);
}
inline std::array<double, 3> normed(const std::array<double, 3>& a) {
    double L = len(a);
    if (L < 1e-15) return {0, 0, 0};
    return {a[0]/L, a[1]/L, a[2]/L};
}

// Evaluate the residual contribution of one mate, writing rows into `r`
// starting at `row`. Returns the number of rows written.
std::size_t evalMate(const Mate& mate, const State& s,
                     double* r, std::size_t row) {
    Transform4x4 xa, xb;
    writeFrame(s, mate.a.inst, xa);
    writeFrame(s, mate.b.inst, xb);
    auto fa = frameFor(xa, mate.a.topoId);
    auto fb = frameFor(xb, mate.b.topoId);

    switch (mate.kind) {
        case MateKind::Coincident: {
            // 3 origin equations + 3 axis equations.
            r[row+0] = fa.point[0] - fb.point[0];
            r[row+1] = fa.point[1] - fb.point[1];
            r[row+2] = fa.point[2] - fb.point[2];
            auto da = normed(fa.direction);
            auto db = normed(fb.direction);
            auto cr = cross(da, db);
            r[row+3] = cr[0];
            r[row+4] = cr[1];
            r[row+5] = cr[2];
            return 6;
        }
        case MateKind::Concentric: {
            // Axes collinear: cross product zero (3) + displacement
            // component perpendicular to axis zero (2 effective -> use
            // (Δp × â) = 0 which is 3 equations but lies in axis plane).
            auto da = normed(fa.direction);
            auto db = normed(fb.direction);
            auto cr = cross(da, db);
            r[row+0] = cr[0];
            r[row+1] = cr[1];
            r[row+2] = cr[2];
            std::array<double, 3> dp{fb.point[0] - fa.point[0],
                                     fb.point[1] - fa.point[1],
                                     fb.point[2] - fa.point[2]};
            auto perp = cross(dp, da);
            // Two algebraic constraints (drop one — Eigen handles
            // rank-deficiency, but skinnier is faster).
            r[row+3] = perp[0];
            r[row+4] = perp[1];
            return 5;
        }
        case MateKind::Parallel: {
            auto da = normed(fa.direction);
            auto db = normed(fb.direction);
            auto cr = cross(da, db);
            r[row+0] = cr[0];
            r[row+1] = cr[1];
            r[row+2] = cr[2];
            return 3;
        }
        case MateKind::Perpendicular: {
            auto da = normed(fa.direction);
            auto db = normed(fb.direction);
            r[row+0] = dot(da, db);
            return 1;
        }
        case MateKind::Distance: {
            std::array<double, 3> dp{fb.point[0] - fa.point[0],
                                     fb.point[1] - fa.point[1],
                                     fb.point[2] - fa.point[2]};
            r[row+0] = len(dp) - mate.value;
            return 1;
        }
        case MateKind::Angle: {
            auto da = normed(fa.direction);
            auto db = normed(fb.direction);
            const double c = std::clamp(dot(da, db), -1.0, 1.0);
            r[row+0] = std::acos(c) - mate.value;
            return 1;
        }
        case MateKind::Tangent: {
            // |n̂ · (p_B − p_A)| − 0; n̂ is A's face normal.
            auto na = normed(fa.direction);
            std::array<double, 3> dp{fb.point[0] - fa.point[0],
                                     fb.point[1] - fa.point[1],
                                     fb.point[2] - fa.point[2]};
            r[row+0] = dot(na, dp);
            return 1;
        }
        case MateKind::Fixed:
            return 0;
    }
    return 0;
}

// Snapshot ComponentRegistry → State.x and build the active-instance map.
void seed(State& s, const std::vector<Mate>& mates,
          const std::vector<InstanceId>& fixedInstances) {
    s.fixedSet.insert(fixedInstances.begin(), fixedInstances.end());
    auto addInst = [&](InstanceId id) {
        if (s.instCol.count(id)) return;
        if (s.fixedSet.count(id)) return; // fixed → not a variable
        s.instCol.emplace(id, s.instOrder.size() * kDof);
        s.instOrder.push_back(id);
    };
    for (const auto& m : mates) {
        if (!m.active) continue;
        addInst(m.a.inst);
        addInst(m.b.inst);
        s.activeMates.push_back(m);
    }
    s.x.assign(s.instOrder.size() * kDof, 0.0);
    for (std::size_t i = 0; i < s.instOrder.size(); ++i) {
        const auto id = s.instOrder[i];
        const auto xform = ComponentRegistry::instance().getTransform(id);
        const auto base = i * kDof;
        decompose(xform, s.x[base+0], s.x[base+1], s.x[base+2],
                          s.x[base+3], s.x[base+4], s.x[base+5]);
    }
}

} // namespace

SolveReport AssemblySolver::solve() {
    // ------------------------------------------------------------
    // 1. Snapshot mates + fixedInstances under lock, then release.
    //    The solve itself is single-threaded and works on a local State.
    // ------------------------------------------------------------
    std::vector<Mate>       mates;
    std::vector<InstanceId> fixedInstances;
    {
        std::lock_guard<std::mutex> g(mtx_);
        mates.reserve(mates_.size());
        for (const auto& slot : mates_) if (slot.alive) mates.push_back(slot.mate);
        fixedInstances = fixedInstances_;
    }

    State s;
    seed(s, mates, fixedInstances);

    const std::size_t N    = s.instOrder.size();
    const std::size_t nVar = N * kDof;

    if (nVar == 0) {
        SolveReport rep{true, 0, 0.0};
        std::lock_guard<std::mutex> g(mtx_);
        lastIterations_ = rep.iterations;
        lastResidual_   = rep.residual;
        return rep;
    }

    // Total residual rows.
    std::size_t nRes = 0;
    for (const auto& m : s.activeMates) nRes += residualSize(m.kind);
    if (nRes == 0) {
        SolveReport rep{true, 0, 0.0};
        std::lock_guard<std::mutex> g(mtx_);
        lastIterations_ = rep.iterations;
        lastResidual_   = rep.residual;
        return rep;
    }

    Eigen::VectorXd r(nRes);
    Eigen::VectorXd rTrial(nRes);
    auto evalAll = [&](double* out) {
        std::size_t row = 0;
        for (const auto& m : s.activeMates) {
            row += evalMate(m, s, out, row);
        }
    };

    evalAll(r.data());
    double rnorm = r.norm();

    constexpr int    kMaxIter = 100;
    constexpr double kTolerance = 1e-6;
    constexpr double kFiniteDiffEps = 1e-7;

    int iter = 0;
    for (iter = 0; iter < kMaxIter; ++iter) {
        if (rnorm < kTolerance) break;

        // ----------------------------------------------------
        // Build sparse Jacobian J (nRes × nVar) by forward diff.
        // Each mate touches at most 12 columns; we restrict the
        // perturbation loop to the two involved instances.
        // ----------------------------------------------------
        Eigen::SparseMatrix<double> J(static_cast<int>(nRes), static_cast<int>(nVar));
        std::vector<Eigen::Triplet<double>> trips;
        trips.reserve(s.activeMates.size() * kDof * 2 * 6);

        // For each variable column, find the rows it might affect by
        // looping over mates that reference its instance.
        // We instead loop over mates and perturb both A and B columns.
        std::size_t rowOffset = 0;
        std::vector<std::size_t> mateRowOffsets;
        mateRowOffsets.reserve(s.activeMates.size() + 1);
        for (const auto& m : s.activeMates) {
            mateRowOffsets.push_back(rowOffset);
            rowOffset += residualSize(m.kind);
        }
        mateRowOffsets.push_back(rowOffset);

        // Pre-evaluate the baseline residual once per mate (we already
        // have r in hand).
        std::vector<double> rBuf(nRes);
        std::memcpy(rBuf.data(), r.data(), nRes * sizeof(double));

        // Index mates per instance for cheaper column derivatives.
        std::unordered_map<InstanceId, std::vector<std::size_t>> mateByInst;
        for (std::size_t i = 0; i < s.activeMates.size(); ++i) {
            mateByInst[s.activeMates[i].a.inst].push_back(i);
            if (s.activeMates[i].b.inst != s.activeMates[i].a.inst) {
                mateByInst[s.activeMates[i].b.inst].push_back(i);
            }
        }

        std::vector<double> rPert(nRes);
        for (std::size_t inst = 0; inst < s.instOrder.size(); ++inst) {
            const auto base = inst * kDof;
            const InstanceId iid = s.instOrder[inst];
            const auto& touchedMates = mateByInst[iid];
            if (touchedMates.empty()) continue;
            for (std::size_t k = 0; k < kDof; ++k) {
                const std::size_t col = base + k;
                const double orig = s.x[col];
                const double h = kFiniteDiffEps * std::max(1.0, std::abs(orig));
                s.x[col] = orig + h;
                // Recompute only the rows belonging to touched mates.
                for (auto mi : touchedMates) {
                    std::size_t off = mateRowOffsets[mi];
                    evalMate(s.activeMates[mi], s, rPert.data(), off);
                }
                s.x[col] = orig;
                for (auto mi : touchedMates) {
                    std::size_t off = mateRowOffsets[mi];
                    std::size_t sz  = residualSize(s.activeMates[mi].kind);
                    for (std::size_t rr = 0; rr < sz; ++rr) {
                        const double dval = (rPert[off+rr] - rBuf[off+rr]) / h;
                        if (std::abs(dval) > 1e-12) {
                            trips.emplace_back(static_cast<int>(off+rr),
                                               static_cast<int>(col),
                                               dval);
                        }
                    }
                }
            }
        }
        J.setFromTriplets(trips.begin(), trips.end());
        J.makeCompressed();

        // ----------------------------------------------------
        // Solve J Δx = -r in least-squares sense via SparseQR.
        // Fall back to a damped step if rank-deficient.
        // ----------------------------------------------------
        Eigen::VectorXd rhs = -r;
        Eigen::VectorXd dx(nVar);
        bool solved = false;

        if (static_cast<int>(nRes) >= static_cast<int>(nVar)) {
            // Over- or square-determined: SparseQR.
            Eigen::SparseQR<Eigen::SparseMatrix<double>,
                            Eigen::COLAMDOrdering<int>> qr;
            qr.compute(J);
            if (qr.info() == Eigen::Success) {
                dx = qr.solve(rhs);
                if (qr.info() == Eigen::Success && dx.allFinite()) solved = true;
            }
        }
        if (!solved) {
            // Under-determined or rank-deficient: solve J^T J Δx = J^T (-r)
            // with Tikhonov damping. Robust for over-/under-constrained
            // mate sets — over-shoots are caught by line search below.
            Eigen::SparseMatrix<double> JTJ = J.transpose() * J;
            for (int i = 0; i < static_cast<int>(nVar); ++i) {
                JTJ.coeffRef(i, i) += 1e-8;
            }
            Eigen::SimplicialLDLT<Eigen::SparseMatrix<double>> ldlt(JTJ);
            if (ldlt.info() == Eigen::Success) {
                dx = ldlt.solve(J.transpose() * rhs);
                solved = dx.allFinite();
            }
        }
        if (!solved) {
            // Last-resort: gradient step.
            dx = -(J.transpose() * r) * 1e-3;
        }

        // ----------------------------------------------------
        // Backtracking line search: scale α from 1 → 1/2 → 1/4 ... until
        // residual decreases, or 8 halvings exhausted.
        // ----------------------------------------------------
        double alpha = 1.0;
        bool accepted = false;
        std::vector<double> snapshot = s.x;
        for (int trial = 0; trial < 8; ++trial) {
            for (std::size_t i = 0; i < nVar; ++i) {
                s.x[i] = snapshot[i] + alpha * dx[static_cast<int>(i)];
            }
            evalAll(rTrial.data());
            const double trialNorm = rTrial.norm();
            if (trialNorm < rnorm) {
                r = rTrial;
                rnorm = trialNorm;
                accepted = true;
                break;
            }
            alpha *= 0.5;
        }
        if (!accepted) {
            // No descent — restore and bail.
            s.x = snapshot;
            break;
        }
    }

    // ------------------------------------------------------------
    // Write back to ComponentRegistry on convergence (or best effort).
    // ------------------------------------------------------------
    for (std::size_t i = 0; i < s.instOrder.size(); ++i) {
        const auto base = i * kDof;
        Transform4x4 xform = makeTransform(s.x[base+0], s.x[base+1], s.x[base+2],
                                           s.x[base+3], s.x[base+4], s.x[base+5]);
        ComponentRegistry::instance().updateTransform(s.instOrder[i], xform);
    }

    SolveReport rep;
    rep.converged  = rnorm < kTolerance;
    rep.iterations = static_cast<std::uint32_t>(iter);
    rep.residual   = rnorm;

    {
        std::lock_guard<std::mutex> g(mtx_);
        lastIterations_ = rep.iterations;
        lastResidual_   = rep.residual;
    }
    return rep;
}

} // namespace forge
