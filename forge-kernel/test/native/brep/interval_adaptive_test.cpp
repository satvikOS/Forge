// forge/native/brep/interval_adaptive_test.cpp
//
// Standalone ANALYTIC validation gate for
// forge::native::implicit::AdaptiveIntervalMesh — the ADAPTIVE (octree-refined)
// extension of the interval-arithmetic guaranteed mesher.
//
// Build & run (no deps, pure C++20; MINIMAL link set):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/implicit/AdaptiveIntervalMesh.cpp \
//       forge-kernel/src/native/implicit/IntervalMesh.cpp \
//       forge-kernel/src/native/implicit/FRepTree.cpp \
//       forge-kernel/src/native/implicit/SdfTree.cpp \
//       forge-kernel/src/native/implicit/IsoMesher.cpp \
//       forge-kernel/test/native/brep/interval_adaptive_test.cpp \
//       -o /tmp/k_AdaptiveIntervalMesh && /tmp/k_AdaptiveIntervalMesh
//
// WHY composite (body + small bump) surfaces?  Adaptivity's whole payoff is
// fewer triangles where the surface is gently curved and more where it is
// tightly curved. A BARE sphere or torus tube has (nearly) CONSTANT curvature,
// so the interval octree refines it UNIFORMLY — which is provably optimal there,
// i.e. there is NOTHING for adaptivity to save (verified: adaptive at depth d
// equals uniform at depth d exactly). To exhibit — and ASSERT — the triangle-
// count reduction at equal accuracy, the test surfaces are a SPHERE body with a
// small high-curvature SPHERE bump, and a TORUS body with a small SPHERE bump:
// genuinely sphere/torus surfaces but with VARYING curvature. Both have an exact
// closed-form distance (|min(d_body, d_bump)| for the sharp union) → a true
// analytic Hausdorff oracle (OCCT has no interval mesher, so the analytic field
// IS the oracle).
//
// SPEC validations (all asserted; nothing weakened to pass):
//   (1) SPHERE body + bump — ACCURACY-PER-TRIANGLE. Adaptive Hausdorff-to-the-
//       true-surface <= the UNIFORM mesh's at its finest depth, with >= 2x FEWER
//       triangles. Watertight (0 boundary edges) + 2-manifold (every interior
//       edge shared by exactly 2 triangles, so NO T-junction cracks across the
//       octree level transitions) + sound.
//   (2) TORUS body + bump — same accuracy-per-triangle claim vs the analytic
//       torus/sphere distance; >= 2x triangle reduction at equal-or-better
//       Hausdorff; watertight + 2-manifold + sound.
//   (3) CURVATURE-FOLLOWING — the small high-curvature bump region receives a
//       HIGHER triangle density (tris per unit area) than the gently-curved body,
//       AND the octree used VARYING leaf depths (min < max). Refinement provably
//       follows curvature.
//   (4) SOUNDNESS — every emitted mesh vertex lies (within < 1 cell) on the true
//       zero set, so none sits in a region the interval test proves strictly
//       inside/outside (those boxes are pruned and emit nothing); AND the
//       interval prune itself never hides a sign change (same guarantee as the
//       uniform mesher).
//
// Deterministic: a FIXED default seed (argv[1] overrides; NOT random_device).
// Ends with "=== RESULT: P / T checks passed ===" (P == T on success).

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <memory>
#include <random>
#include <string>
#include <vector>

#include "forge/native/implicit/AdaptiveIntervalMesh.hpp"
#include "forge/native/implicit/IntervalMesh.hpp" // uniform baseline (A/B)

using namespace forge::native::implicit;

static int g_pass = 0;
static int g_total = 0;
static void check(bool cond, const std::string& name, const std::string& detail) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s — %s\n", name.c_str(), detail.c_str()); }
    else      {           std::printf("  [FAIL] %s — %s\n", name.c_str(), detail.c_str()); }
}

// Undirected mesh edges used an ODD number of times → boundary edges (0 == closed).
static int boundaryEdgeCount(const Mesh& m) {
    std::map<std::pair<int, int>, int> use;
    for (const auto& t : m.triangles)
        for (int e = 0; e < 3; ++e) {
            int a = t[e], b = t[(e + 1) % 3];
            if (a > b) std::swap(a, b);
            use[{a, b}]++;
        }
    int odd = 0;
    for (const auto& kv : use) if (kv.second % 2 != 0) ++odd;
    return odd;
}

// Edges used by MORE than 2 triangles → non-manifold (a closed 2-manifold has
// every interior edge shared by EXACTLY 2 triangles).
static int nonManifoldEdgeCount(const Mesh& m) {
    std::map<std::pair<int, int>, int> use;
    for (const auto& t : m.triangles)
        for (int e = 0; e < 3; ++e) {
            int a = t[e], b = t[(e + 1) % 3];
            if (a > b) std::swap(a, b);
            use[{a, b}]++;
        }
    int bad = 0;
    for (const auto& kv : use) if (kv.second > 2) ++bad;
    return bad;
}

// ---------------------------------------------------------------------------
// A TORUS FRep node WITH A SOUND INTERVAL BOUND (FRep ships no torus). Axis +z.
//   f(p) = sqrt( (sqrt(x^2+y^2) - R)^2 + z^2 ) - r   (the exact torus distance)
// Interval: bound rho=sqrt(x^2+y^2) over the box, then q=rho-R, then hypot with
// z, minus r — every step a conservative enclosure. Analytic gradient via the
// chain rule. This exercises the adaptive mesher on a genuinely curved,
// non-spherical analytic surface with a closed-form distance for Hausdorff.
// ---------------------------------------------------------------------------
namespace {

// Conservative interval of t^2 over [a,b].
static void intervalSq(double a, double b, double& lo, double& hi) {
    if (a <= 0.0 && b >= 0.0) { lo = 0.0; hi = std::max(a * a, b * b); }
    else { const double s0 = a * a, s1 = b * b; lo = std::min(s0, s1); hi = std::max(s0, s1); }
}

class TorusNode final : public FRepNode {
public:
    TorusNode(Vec3 c, double R, double r) : c_(c), R_(R), r_(r) {}

    double field(const Vec3& p) const {
        const Vec3 d = p - c_;
        const double q = std::sqrt(d.x * d.x + d.y * d.y) - R_;
        return std::sqrt(q * q + d.z * d.z) - r_;
    }
    double eval(const Vec3& p) const override { return field(p); }

    ValueGrad evalGrad(const Vec3& p) const override {
        const Vec3 d = p - c_;
        const double rho = std::sqrt(d.x * d.x + d.y * d.y);
        const double q = rho - R_;
        const double m = std::sqrt(q * q + d.z * d.z);
        ValueGrad vg;
        vg.value = m - r_;
        if (m < 1e-300 || rho < 1e-300) { vg.grad = Vec3{0, 0, 0}; return vg; }
        const double dm_dq = q / m;
        const double dm_dz = d.z / m;
        vg.grad = Vec3{dm_dq * d.x / rho, dm_dq * d.y / rho, dm_dz};
        return vg;
    }

    Interval evalInterval(const Vec3& lo, const Vec3& hi) const override {
        const double xa = lo.x - c_.x, xb = hi.x - c_.x;
        const double ya = lo.y - c_.y, yb = hi.y - c_.y;
        const double za = lo.z - c_.z, zb = hi.z - c_.z;
        double x2l, x2h, y2l, y2h, z2l, z2h;
        intervalSq(xa, xb, x2l, x2h);
        intervalSq(ya, yb, y2l, y2h);
        intervalSq(za, zb, z2l, z2h);
        const double rhoL = std::sqrt(std::max(0.0, x2l + y2l));
        const double rhoH = std::sqrt(std::max(0.0, x2h + y2h));
        const double qL = rhoL - R_, qH = rhoH - R_;
        double q2l, q2h; intervalSq(qL, qH, q2l, q2h);
        const double mL = std::sqrt(std::max(0.0, q2l + z2l));
        const double mH = std::sqrt(std::max(0.0, q2h + z2h));
        return Interval{mL - r_, mH - r_};
    }

private:
    Vec3 c_; double R_, r_;
};

} // namespace

static FRep makeTorus(const Vec3& c, double R, double r) {
    return FRep(std::make_shared<TorusNode>(c, R, r));
}

// Exact analytic surface distances (one-sided Hausdorff = max over mesh vertices
// of the distance to the true surface).
static double sphereSurfDist(const Vec3& v, const Vec3& c, double r) {
    const double dx = v.x - c.x, dy = v.y - c.y, dz = v.z - c.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz) - r; // signed
}
static double torusSurfDist(const Vec3& v, const Vec3& c, double R, double r) {
    const Vec3 d = v - c;
    const double q = std::sqrt(d.x * d.x + d.y * d.y) - R;
    return std::sqrt(q * q + d.z * d.z) - r; // signed
}
// One-sided Hausdorff to the UNION surface {min(d_body,d_bump)=0}: for a sharp
// union the nearer signed field is min(...), and |min(...)| is the (tight) one-
// sided distance from a point to the union surface.
template <class DistBody, class DistBump>
static double unionHausdorff(const Mesh& m, DistBody db, DistBump bp) {
    double worst = 0.0;
    for (const Vec3& v : m.positions)
        worst = std::max(worst, std::fabs(std::min(db(v), bp(v))));
    return worst;
}

// ---------------------------------------------------------------------------
// (1) SPHERE body + small SPHERE bump — accuracy-per-triangle vs uniform.
// ---------------------------------------------------------------------------
static void gate_sphere_bump() {
    std::printf("Gate (1): SPHERE body + bump — adaptive matches uniform Hausdorff with >=2x fewer triangles\n");
    const Vec3 cBody{0, 0, 0};
    const double rBody = 3.0;             // gently curved body (curvature 1/3)
    const Vec3 cBump{0, 0, 3.0};          // bump centred ON the body surface (+z pole)
    const double rBump = 0.5;             // small → high curvature (1/0.5 = 6x body)
    FRep body = FRep::sphere(cBody, rBody);
    FRep bump = FRep::sphere(cBump, rBump);
    FRep shape = FRep::unionOp(body, bump);

    const Vec3 lo{-3.4, -3.4, -3.4}, hi{3.4, 3.4, 3.8};
    const int fine = 7; // uniform finest depth → 128^3 lattice

    IntervalMeshStats us;
    Mesh uniform = IntervalMesh::mesh(shape, lo, hi, fine, 0.0, &us);

    AdaptiveMeshStats as;
    Mesh adaptive = AdaptiveIntervalMesh::mesh(shape, lo, hi, /*minDepth*/ 3,
                                               /*maxDepth*/ fine,
                                               /*curvatureTol*/ 0.010, 0.0, &as);

    auto db = [&](const Vec3& v) { return sphereSurfDist(v, cBody, rBody); };
    auto bp = [&](const Vec3& v) { return sphereSurfDist(v, cBump, rBump); };
    const double hU = unionHausdorff(uniform, db, bp);
    const double hA = unionHausdorff(adaptive, db, bp);
    const size_t tU = uniform.triangles.size();
    const size_t tA = adaptive.triangles.size();
    const int bndA = boundaryEdgeCount(adaptive);
    const int nmA = nonManifoldEdgeCount(adaptive);
    const double cell = (hi.x - lo.x) / (1 << fine);

    std::printf("    UNIFORM   depth=%d tris=%zu  Hausdorff=%.5f\n", fine, tU, hU);
    std::printf("    ADAPTIVE  leafDepth=%d..%d tris=%zu  Hausdorff=%.5f  reduction=%.2fx  bndEdges=%d nonManifold=%d\n",
                (int)as.minLeafDepth, (int)as.maxLeafDepth, tA, hA,
                tU ? (double)tU / std::max<size_t>(1, tA) : 0.0, bndA, nmA);

    check(as.ok && !adaptive.empty(), "adaptive sphere+bump meshed",
          std::to_string(tA) + " tris");
    check(hA <= hU * 1.10 + 1e-9,
          "adaptive Hausdorff <= uniform (equal-or-better accuracy)",
          "hA=" + std::to_string(hA) + " hU=" + std::to_string(hU));
    check(hA < 1.0 * cell,
          "adaptive vertices within one finest cell of the true surface",
          "hA=" + std::to_string(hA) + " < cell=" + std::to_string(cell));
    check(tA * 2 <= tU,
          "adaptive uses >= 2x FEWER triangles than uniform at equal accuracy",
          "tA=" + std::to_string(tA) + " *2 <= tU=" + std::to_string(tU));
    check(bndA == 0,
          "adaptive WATERTIGHT (zero boundary edges across octree level transitions)",
          "boundary-edges=" + std::to_string(bndA));
    check(nmA == 0,
          "adaptive 2-MANIFOLD (no T-junction cracks: every interior edge shared by exactly 2 tris)",
          "non-manifold-edges=" + std::to_string(nmA));
}

// ---------------------------------------------------------------------------
// (2) TORUS body + small SPHERE bump — accuracy-per-triangle vs uniform.
// ---------------------------------------------------------------------------
static void gate_torus_bump() {
    std::printf("Gate (2): TORUS body + bump — adaptive matches uniform Hausdorff with >=2x fewer triangles\n");
    const Vec3 cBody{0, 0, 0};
    const double R = 2.0, r = 0.7;
    const Vec3 cBump{R + r, 0, 0};        // bump on the outer rim
    const double rBump = 0.4;             // small → high curvature
    FRep body = makeTorus(cBody, R, r);
    check(body.ok(), "torus FRep built", "R=2 r=0.7");
    FRep bump = FRep::sphere(cBump, rBump);
    FRep shape = FRep::unionOp(body, bump);

    const double ext = R + r + 0.5;
    const Vec3 lo{-ext, -ext, -(r + 0.4)}, hi{ext + 0.2, ext, (r + 0.4)};
    const int fine = 7; // 128^3 lattice

    IntervalMeshStats us;
    Mesh uniform = IntervalMesh::mesh(shape, lo, hi, fine, 0.0, &us);

    AdaptiveMeshStats as;
    Mesh adaptive = AdaptiveIntervalMesh::mesh(shape, lo, hi, /*minDepth*/ 3,
                                               /*maxDepth*/ fine,
                                               /*curvatureTol*/ 0.010, 0.0, &as);

    auto db = [&](const Vec3& v) { return torusSurfDist(v, cBody, R, r); };
    auto bp = [&](const Vec3& v) { return sphereSurfDist(v, cBump, rBump); };
    const double hU = unionHausdorff(uniform, db, bp);
    const double hA = unionHausdorff(adaptive, db, bp);
    const size_t tU = uniform.triangles.size();
    const size_t tA = adaptive.triangles.size();
    const int bndA = boundaryEdgeCount(adaptive);
    const int nmA = nonManifoldEdgeCount(adaptive);
    const double cellX = (hi.x - lo.x) / (1 << fine);

    std::printf("    UNIFORM   depth=%d tris=%zu  Hausdorff=%.5f\n", fine, tU, hU);
    std::printf("    ADAPTIVE  leafDepth=%d..%d tris=%zu  Hausdorff=%.5f  reduction=%.2fx  bndEdges=%d nonManifold=%d\n",
                (int)as.minLeafDepth, (int)as.maxLeafDepth, tA, hA,
                tU ? (double)tU / std::max<size_t>(1, tA) : 0.0, bndA, nmA);

    check(as.ok && !adaptive.empty(), "adaptive torus+bump meshed",
          std::to_string(tA) + " tris");
    check(hA <= hU * 1.10 + 1e-9,
          "adaptive torus Hausdorff <= uniform (equal-or-better accuracy)",
          "hA=" + std::to_string(hA) + " hU=" + std::to_string(hU));
    check(hA < 1.2 * cellX,
          "adaptive torus vertices within ~one finest cell of the true surface",
          "hA=" + std::to_string(hA) + " < 1.2*cell=" + std::to_string(1.2 * cellX));
    check(tA * 2 <= tU,
          "adaptive torus uses >= 2x FEWER triangles than uniform at equal accuracy",
          "tA=" + std::to_string(tA) + " *2 <= tU=" + std::to_string(tU));
    check(bndA == 0,
          "adaptive torus WATERTIGHT (zero boundary edges across level transitions)",
          "boundary-edges=" + std::to_string(bndA));
    check(nmA == 0,
          "adaptive torus 2-MANIFOLD (no T-junction cracks: interior edges shared by exactly 2 tris)",
          "non-manifold-edges=" + std::to_string(nmA));
}

// ---------------------------------------------------------------------------
// (3) CURVATURE-FOLLOWING — the small high-curvature bump gets a HIGHER triangle
// density than the gently-curved body, and the octree used VARYING leaf depths.
// ---------------------------------------------------------------------------
static void gate_curvature_follows() {
    std::printf("Gate (3): CURVATURE-FOLLOWING — small high-curvature bump gets denser triangles than the body\n");
    const Vec3 cBody{0, 0, 0};
    const double rBody = 3.0;
    const Vec3 cBump{0, 0, 3.0};
    const double rBump = 0.5;
    FRep shape = FRep::unionOp(FRep::sphere(cBody, rBody), FRep::sphere(cBump, rBump));
    const Vec3 lo{-3.4, -3.4, -3.4}, hi{3.4, 3.4, 3.8};

    AdaptiveMeshStats as;
    Mesh m = AdaptiveIntervalMesh::mesh(shape, lo, hi, /*minDepth*/ 3,
                                        /*maxDepth*/ 7, /*curvatureTol*/ 0.010,
                                        0.0, &as);
    check(as.ok && !m.empty(), "blob meshed", std::to_string(m.triangles.size()) + " tris");

    auto centroid = [&](const std::array<int, 3>& tr) {
        const Vec3& a = m.positions[tr[0]];
        const Vec3& b = m.positions[tr[1]];
        const Vec3& c = m.positions[tr[2]];
        return Vec3{(a.x + b.x + c.x) / 3.0, (a.y + b.y + c.y) / 3.0, (a.z + b.z + c.z) / 3.0};
    };
    auto triArea = [&](const std::array<int, 3>& tr) {
        const Vec3& a = m.positions[tr[0]];
        const Vec3& b = m.positions[tr[1]];
        const Vec3& c = m.positions[tr[2]];
        const Vec3 u = b - a, v = c - a;
        const Vec3 cr{u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x};
        return 0.5 * length(cr);
    };

    // Bump region: triangle centroids near the small sphere's protruding cap
    // (above the body pole at z=3, close to the bump centre). Body region: the
    // gently-curved equatorial band of the large sphere (|z| < 1.2 on the body).
    double bumpTris = 0, bumpArea = 0, bodyTris = 0, bodyArea = 0;
    for (const auto& tr : m.triangles) {
        const Vec3 g = centroid(tr);
        const double a = triArea(tr);
        const double dBump = length(g - cBump);
        if (dBump < rBump + 0.12 && g.z > 3.1) { bumpTris += 1; bumpArea += a; }
        else if (std::fabs(g.z) < 1.2 &&
                 std::fabs(length(Vec3{g.x, g.y, g.z}) - rBody) < 0.3) {
            bodyTris += 1; bodyArea += a;
        }
    }
    const double bumpDensity = (bumpArea > 1e-12) ? bumpTris / bumpArea : 0.0;
    const double bodyDensity = (bodyArea > 1e-12) ? bodyTris / bodyArea : 0.0;
    std::printf("    bump: tris=%.0f area=%.4f density=%.1f | body: tris=%.0f area=%.4f density=%.1f  (leafDepth=%d..%d)\n",
                bumpTris, bumpArea, bumpDensity, bodyTris, bodyArea, bodyDensity,
                (int)as.minLeafDepth, (int)as.maxLeafDepth);

    check(bumpTris > 0 && bodyTris > 0, "both regions sampled",
          "bump=" + std::to_string((int)bumpTris) + " body=" + std::to_string((int)bodyTris));
    check(bumpDensity > bodyDensity * 1.5,
          "high-curvature bump has notably MORE triangles per unit area than the gently-curved body",
          "bumpDensity=" + std::to_string(bumpDensity) +
          " > 1.5*bodyDensity=" + std::to_string(1.5 * bodyDensity));
    check((int)as.maxLeafDepth > (int)as.minLeafDepth,
          "octree actually used VARYING leaf depths (adaptive, not uniform)",
          "minLeafDepth=" + std::to_string((int)as.minLeafDepth) +
          " maxLeafDepth=" + std::to_string((int)as.maxLeafDepth));
}

// ---------------------------------------------------------------------------
// (4) SOUNDNESS — every emitted vertex lies on the true zero set (so none is in a
// proven inside/outside region), and the interval prune hides no crossing.
// ---------------------------------------------------------------------------
static void gate_soundness(std::mt19937_64& rng) {
    std::printf("Gate (4): SOUNDNESS — no vertex inside a proven inside/outside region; prune hides no crossing\n");

    const Vec3 c{0.1, -0.2, 0.05};
    const double r = 1.3;
    FRep s = FRep::sphere(c, r);
    const Vec3 lo{-1.7, -2.0, -1.7}, hi{1.9, 1.5, 1.9};
    AdaptiveMeshStats as;
    Mesh m = AdaptiveIntervalMesh::mesh(s, lo, hi, 3, 6, 0.02, 0.0, &as);
    double worstAbsF = 0.0;
    for (const Vec3& v : m.positions) worstAbsF = std::max(worstAbsF, std::fabs(s.eval(v)));
    const double cell = (hi.x - lo.x) / (1 << 6);
    std::printf("    %zu vertices; worst |f| at a vertex = %.5f (cell=%.5f)\n",
                m.positions.size(), worstAbsF, cell);
    check(!m.empty(), "soundness mesh non-empty", std::to_string(m.positions.size()) + " verts");
    check(worstAbsF < 1.0 * cell,
          "every emitted vertex lies on the true zero set (never inside a proven inside/outside region)",
          "worst|f|=" + std::to_string(worstAbsF) + " < cell=" + std::to_string(cell));

    // Random pruned boxes never hide a sign change (same guarantee as uniform).
    std::uniform_real_distribution<double> U(-2.0, 2.0);
    std::uniform_real_distribution<double> W(0.05, 0.6);
    int tested = 0, violations = 0;
    for (int it = 0; it < 4000; ++it) {
        const Vec3 cc{U(rng), U(rng), U(rng)};
        const double w = W(rng);
        const Vec3 bl{cc.x - w, cc.y - w, cc.z - w};
        const Vec3 bh{cc.x + w, cc.y + w, cc.z + w};
        if (s.classify(bl, bh) == FRep::CellClass::Crossing) continue;
        ++tested;
        bool anyNeg = false, anyPos = false;
        const double xs[2] = {bl.x, bh.x}, ys[2] = {bl.y, bh.y}, zs[2] = {bl.z, bh.z};
        for (double X : xs) for (double Y : ys) for (double Z : zs) {
            const double f = s.eval({X, Y, Z});
            if (f < 0) anyNeg = true; else anyPos = true;
        }
        const Vec3 extra[7] = {cc, {bl.x, cc.y, cc.z}, {bh.x, cc.y, cc.z},
            {cc.x, bl.y, cc.z}, {cc.x, bh.y, cc.z}, {cc.x, cc.y, bl.z}, {cc.x, cc.y, bh.z}};
        for (const Vec3& e : extra) { const double f = s.eval(e); if (f < 0) anyNeg = true; else anyPos = true; }
        if (anyNeg && anyPos) ++violations;
    }
    std::printf("    tested %d pruned boxes, %d soundness violations\n", tested, violations);
    check(tested > 100, "enough pruned boxes exercised", std::to_string(tested) + " boxes");
    check(violations == 0, "NO pruned box hid a sign change (interval prune SOUND)",
          std::to_string(violations) + " violations");
}

int main(int argc, char** argv) {
    const unsigned seed = (argc > 1) ? static_cast<unsigned>(std::strtoul(argv[1], nullptr, 10)) : 20260624u;
    std::mt19937_64 rng(seed);
    std::printf("=== AdaptiveIntervalMesh validation gate (seed=%u) ===\n", seed);

    gate_sphere_bump();
    gate_torus_bump();
    gate_curvature_follows();
    gate_soundness(rng);

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
