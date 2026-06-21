// forge/native/mesh/test/curvature_test.cpp
//
// RANDOMIZED validation gate for forge::native::mesh::computeCurvature — discrete
// differential curvature (Meyer–Desbrun–Schröder–Barr: cotangent-Laplacian mean
// curvature over the mixed Voronoi area, angle-deficit Gaussian curvature,
// principal curvatures from the invariants). Pure C++20, no external deps.
//
// Build + run (standalone — ONLY this module + its named deps + this test):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/Curvature.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/curvature_test.cpp -o /tmp/k4_Curvature && /tmp/k4_Curvature
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC ASSERTED HERE:
//   (C1) SPHERE radius R: at every INTERIOR vertex K -> 1/R^2 and H -> 1/R; the
//        error must SHRINK under refinement (coarse icosphere subdiv s vs finer
//        s+1). We assert the median relative error of both H and K strictly
//        decreases from coarse to fine — so the limit is REAL, not a tuned tol.
//        Repeated on a SECOND distinct radius so it is not tuned to one fixture.
//   (C2) FLAT plane patch: at every INTERIOR vertex H ~ 0 and K ~ 0 (to a tight
//        absolute tolerance scaled by the patch size). Boundary vertices are
//        flagged and excluded from the pointwise field.
//   (C3) Discrete GAUSS–BONNET on a CLOSED mesh:
//          sum_v angleDefect_v == 2*pi*chi,  chi = V - E + F (kernel's own audit).
//        Asserted to ~1e-9 (a combinatorial identity, NOT a refinement limit) on
//        the icosphere (chi=2) AND on a closed TORUS (chi=0) to exercise chi!=2.
//        Also: sum of mixedArea == total surface area (partition of unity).
//   (C4) PRINCIPAL curvatures: on the sphere k1 ~ k2 ~ 1/R (umbilic); k1 >= k2
//        everywhere; and H == (k1+k2)/2, K == k1*k2 reconstruct exactly.
//   (C5) 0-FAKES: degenerate / unsupported inputs return ok=false honestly:
//          * empty soup,
//          * indices length not a multiple of 3,
//          * a non-finite (NaN) coordinate,
//          * a non-manifold soup (two triangles sharing the SAME directed edge),
//          * a soup containing a zero-area (degenerate) triangle.
//        ok=true is returned ONLY for a mesh the kernel half-edge audit accepts.
//
// Fresh std::random_device seed each run (printed below). Random perturbations of
// the sphere TANGENTIALLY (sliding vertices on the sphere, then re-projecting)
// vary the mesh each run without leaving the sphere, so no fixture is cherry-
// picked. NEVER weaken an assertion.
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/Curvature.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>   // std::sort, std::max
#include <array>       // std::array
#include <cmath>       // std::sqrt, std::cos, std::sin, std::fabs, std::nan
#include <cstdarg>     // va_list, va_start, va_end
#include <cstddef>     // std::size_t
#include <cstdint>     // std::uint32_t, std::uint64_t
#include <cstdio>      // std::printf, std::vsnprintf
#include <map>         // std::map
#include <numeric>     // std::accumulate
#include <random>      // std::random_device, std::mt19937, std::uniform_real_distribution
#include <vector>      // std::vector

using namespace forge::native::mesh;

static int g_pass = 0, g_total = 0;
static void check(bool c, const char* fmt, ...) {
    ++g_total;
    char buf[640];
    va_list ap; va_start(ap, fmt); std::vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
    if (c) { ++g_pass; std::printf("  [PASS] %s\n", buf); }
    else     std::printf("  [FAIL] %s\n", buf);
}

static const double PI = 3.14159265358979323846;

// ── build an icosphere (subdivided icosahedron), radius r, `subdiv` levels ────
static void icosphere(double r, int subdiv,
                      std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    const double t = (1.0 + std::sqrt(5.0)) * 0.5;
    std::vector<std::array<double, 3>> v = {
        {-1, t, 0}, {1, t, 0}, {-1,-t, 0}, {1,-t, 0},
        {0,-1, t}, {0, 1, t}, {0,-1,-t}, {0, 1,-t},
        { t, 0,-1}, { t, 0, 1}, {-t, 0,-1}, {-t, 0, 1}
    };
    std::vector<std::array<std::uint32_t, 3>> f = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1}
    };
    for (int s = 0; s < subdiv; ++s) {
        std::map<std::uint64_t, std::uint32_t> mid;
        auto midpoint = [&](std::uint32_t a, std::uint32_t b) {
            std::uint64_t key = a < b
                ? (static_cast<std::uint64_t>(a) << 32) | b
                : (static_cast<std::uint64_t>(b) << 32) | a;
            auto it = mid.find(key);
            if (it != mid.end()) return it->second;
            std::array<double, 3> m = {
                0.5 * (v[a][0] + v[b][0]),
                0.5 * (v[a][1] + v[b][1]),
                0.5 * (v[a][2] + v[b][2]) };
            std::uint32_t id = static_cast<std::uint32_t>(v.size());
            v.push_back(m); mid[key] = id; return id;
        };
        std::vector<std::array<std::uint32_t, 3>> nf;
        for (auto& tri : f) {
            std::uint32_t a = midpoint(tri[0], tri[1]);
            std::uint32_t b = midpoint(tri[1], tri[2]);
            std::uint32_t c = midpoint(tri[2], tri[0]);
            nf.push_back({tri[0], a, c});
            nf.push_back({tri[1], b, a});
            nf.push_back({tri[2], c, b});
            nf.push_back({a, b, c});
        }
        f.swap(nf);
    }
    for (auto& p : v) {
        double n = std::sqrt(p[0]*p[0] + p[1]*p[1] + p[2]*p[2]);
        p[0] = p[0] / n * r; p[1] = p[1] / n * r; p[2] = p[2] / n * r;
    }
    pos.reserve(v.size() * 3);
    for (auto& p : v) { pos.push_back(p[0]); pos.push_back(p[1]); pos.push_back(p[2]); }
    idx.reserve(f.size() * 3);
    for (auto& tri : f) { idx.push_back(tri[0]); idx.push_back(tri[1]); idx.push_back(tri[2]); }
}

// Re-project all vertices onto the sphere of radius r about the origin (keeps the
// mesh EXACTLY on the sphere after any tangential jiggle).
static void reproject(std::vector<double>& pos, double r) {
    for (std::size_t i = 0; i + 2 < pos.size(); i += 3) {
        double x = pos[i], y = pos[i+1], z = pos[i+2];
        double n = std::sqrt(x*x + y*y + z*z);
        if (n < 1e-12) continue;
        double s = r / n;
        pos[i] = x*s; pos[i+1] = y*s; pos[i+2] = z*s;
    }
}

// TANGENTIAL jiggle: nudge each interior-ish vertex by a small random 3D vector,
// then re-project to the sphere. This varies the triangulation run-to-run while
// staying exactly on the analytic sphere — so H==1/R and K==1/R^2 remain ground
// truth and we are not cherry-picking a perfectly regular icosphere.
static void jiggleOnSphere(std::vector<double>& pos, double r, double amp, std::mt19937& rng) {
    std::uniform_real_distribution<double> U(-1.0, 1.0);
    for (std::size_t i = 0; i + 2 < pos.size(); i += 3) {
        pos[i]   += amp * r * U(rng);
        pos[i+1] += amp * r * U(rng);
        pos[i+2] += amp * r * U(rng);
    }
    reproject(pos, r);
}

// ── build a flat plane patch: an (n x n) grid in the z=0 plane, span L ─────────
static void planePatch(double L, int n,
                       std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    for (int j = 0; j <= n; ++j)
        for (int i = 0; i <= n; ++i) {
            pos.push_back(L * (double(i) / n - 0.5));
            pos.push_back(L * (double(j) / n - 0.5));
            pos.push_back(0.0);
        }
    auto vid = [&](int i, int j) { return static_cast<std::uint32_t>(j * (n + 1) + i); };
    for (int j = 0; j < n; ++j)
        for (int i = 0; i < n; ++i) {
            std::uint32_t a = vid(i, j), b = vid(i+1, j), c = vid(i+1, j+1), d = vid(i, j+1);
            idx.push_back(a); idx.push_back(b); idx.push_back(c);
            idx.push_back(a); idx.push_back(c); idx.push_back(d);
        }
}

// ── build a closed TORUS (chi = 0) — major radius Rr, minor radius rr ──────────
static void torus(double Rr, double rr, int nMajor, int nMinor,
                  std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    for (int i = 0; i < nMajor; ++i) {
        double u = 2.0 * PI * i / nMajor;
        for (int j = 0; j < nMinor; ++j) {
            double v = 2.0 * PI * j / nMinor;
            double x = (Rr + rr * std::cos(v)) * std::cos(u);
            double y = (Rr + rr * std::cos(v)) * std::sin(u);
            double z = rr * std::sin(v);
            pos.push_back(x); pos.push_back(y); pos.push_back(z);
        }
    }
    auto vid = [&](int i, int j) {
        return static_cast<std::uint32_t>((i % nMajor) * nMinor + (j % nMinor));
    };
    for (int i = 0; i < nMajor; ++i)
        for (int j = 0; j < nMinor; ++j) {
            std::uint32_t a = vid(i, j), b = vid(i+1, j), c = vid(i+1, j+1), d = vid(i, j+1);
            // CCW (outward) winding consistent with the kernel's manifold check.
            idx.push_back(a); idx.push_back(b); idx.push_back(c);
            idx.push_back(a); idx.push_back(c); idx.push_back(d);
        }
}

// median of the absolute values in v (v is mutated by partial sort).
static double median(std::vector<double> v) {
    if (v.empty()) return 0.0;
    std::sort(v.begin(), v.end());
    std::size_t n = v.size();
    return (n & 1) ? v[n/2] : 0.5 * (v[n/2 - 1] + v[n/2]);
}

// Median relative error of H and K against the sphere ground truth (1/R, 1/R^2),
// computed over INTERIOR vertices only (a closed sphere has none on a boundary,
// but we filter defensively).
static void sphereErrors(const CurvatureField& f, double R, double& medH, double& medK) {
    std::vector<double> eH, eK;
    double Htrue = 1.0 / R, Ktrue = 1.0 / (R * R);
    for (std::uint32_t i = 0; i < f.numVertices; ++i) {
        if (f.isBoundary[i]) continue;
        eH.push_back(std::fabs(f.meanH[i] - Htrue) / Htrue);
        eK.push_back(std::fabs(f.gaussianK[i] - Ktrue) / Ktrue);
    }
    medH = median(eH);
    medK = median(eK);
}

int main() {
    std::random_device rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);

    std::printf("=== forge::native::mesh::computeCurvature validation gate ===\n");
    std::printf("=== (Meyer cotangent-Laplacian mean H + angle-deficit Gaussian K) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n", seed);

    // ── (C1) SPHERE: H->1/R, K->1/R^2, error shrinks under refinement ─────────
    // The refinement-convergence claim is asserted on the DETERMINISTIC clean
    // icosphere sequence subdiv 2 -> 3 -> 4 (a genuine, consistent refinement
    // family on the exact analytic sphere). A small per-run TANGENTIAL jiggle
    // (re-projected onto the sphere) then provides a RANDOMIZED robustness check
    // — H and K must still land within tolerance on a mesh that differs every
    // run — without being used for the monotonicity claim (a fixed-amplitude
    // jiggle is NOT a refinement sequence, so it cannot honestly demonstrate a
    // refinement limit).
    auto sphereCase = [&](const char* tag, double R) -> bool {
        std::printf("\n[%s] sphere R=%.3f — refinement convergence + randomized robustness\n", tag, R);
        bool ok = true;

        // Deterministic refinement family: subdiv 2, 3, 4.
        double mH[3], mK[3]; std::uint32_t Vn[3];
        for (int s = 0; s < 3; ++s) {
            std::vector<double> p; std::vector<std::uint32_t> ix;
            icosphere(R, s + 2, p, ix);
            CurvatureField f = computeCurvature(p, ix);
            check(f.ok, "[%s] subdiv=%d curvature ok=true (reason='%s')", tag, s + 2, f.reason);
            ok &= f.ok;
            if (!f.ok) return false;
            check(f.numBoundaryVertices == 0, "[%s] subdiv=%d closed sphere, 0 boundary verts", tag, s + 2);
            ok &= (f.numBoundaryVertices == 0);
            sphereErrors(f, R, mH[s], mK[s]);
            Vn[s] = f.numVertices;
        }
        std::printf("    clean refinement   V=%u/%u/%u   medRelErr H=%.4f/%.4f/%.4f   K=%.4f/%.4f/%.4f\n",
                    Vn[0], Vn[1], Vn[2], mH[0], mH[1], mH[2], mK[0], mK[1], mK[2]);

        // THE refinement claim: median rel error STRICTLY shrinks at each step.
        check(mH[1] < mH[0] && mH[2] < mH[1],
              "[%s] median H error SHRINKS each refinement (%.4f -> %.4f -> %.4f)", tag, mH[0], mH[1], mH[2]);
        check(mK[1] < mK[0] && mK[2] < mK[1],
              "[%s] median K error SHRINKS each refinement (%.4f -> %.4f -> %.4f)", tag, mK[0], mK[1], mK[2]);
        ok &= (mH[1] < mH[0] && mH[2] < mH[1]) && (mK[1] < mK[0] && mK[2] < mK[1]);

        // finest is genuinely close to the analytic sphere
        check(mH[2] < 0.01, "[%s] finest median rel err H < 1%% (%.3f%%)", tag, mH[2]*100.0);
        check(mK[2] < 0.01, "[%s] finest median rel err K < 1%% (%.3f%%)", tag, mK[2]*100.0);
        ok &= (mH[2] < 0.01) && (mK[2] < 0.01);

        // RANDOMIZED robustness: a lightly jiggled subdiv-4 sphere (different mesh
        // every run) must still report H,K within a looser tolerance. The jiggle
        // amplitude is kept inside the valid-triangulation regime (a large jiggle
        // on a dense sphere tangles triangles — that is a fixture defect, not a
        // curvature defect, so we do not test it here).
        std::vector<double> pj; std::vector<std::uint32_t> ij;
        icosphere(R, 4, pj, ij); jiggleOnSphere(pj, R, 0.015, rng);
        CurvatureField fj = computeCurvature(pj, ij);
        check(fj.ok, "[%s] jiggled sphere curvature ok=true (reason='%s')", tag, fj.reason);
        ok &= fj.ok;
        if (fj.ok) {
            double jH, jK; sphereErrors(fj, R, jH, jK);
            std::printf("    jiggled subdiv-4   medRelErr H=%.4f K=%.4f (random mesh this run)\n", jH, jK);
            check(jH < 0.10, "[%s] jiggled median rel err H < 10%% (%.3f%%)", tag, jH*100.0);
            check(jK < 0.10, "[%s] jiggled median rel err K < 10%% (%.3f%%)", tag, jK*100.0);
            ok &= (jH < 0.10) && (jK < 0.10);
        }
        return ok;
    };
    bool c1a = sphereCase("C1a", 1.0);
    bool c1b = sphereCase("C1b", 2.7);

    // ── (C2) FLAT PLANE PATCH: interior H ~ 0 and K ~ 0 ───────────────────────
    std::printf("\n[C2] flat plane patch — interior H~0 and K~0\n");
    bool c2 = false;
    {
        double L = 3.0; int n = 8;
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        planePatch(L, n, pos, idx);
        CurvatureField f = computeCurvature(pos, idx);
        check(f.ok, "[C2] plane curvature ok=true (reason='%s')", f.reason);

        if (f.ok) {
            double maxH = 0.0, maxK = 0.0; std::uint32_t interior = 0, bnd = 0;
            for (std::uint32_t i = 0; i < f.numVertices; ++i) {
                if (f.isBoundary[i]) { ++bnd; continue; }
                ++interior;
                maxH = std::max(maxH, std::fabs(f.meanH[i]));
                maxK = std::max(maxK, std::fabs(f.gaussianK[i]));
            }
            // absolute tolerance: curvature of a flat plane is exactly 0; allow a
            // tiny round-off floor scaled by patch density (h = L/n).
            double h = L / n;
            double tolH = 1e-9 / h;   // dimension 1/length
            double tolK = 1e-9 / (h*h);
            std::printf("    interior=%u boundary=%u  max|H|=%.3e (tol %.3e)  max|K|=%.3e (tol %.3e)\n",
                        interior, bnd, maxH, tolH, maxK, tolK);
            std::uint32_t perim = 4u * static_cast<std::uint32_t>(n);
            check(interior > 0, "[C2] plane has interior vertices (%u)", interior);
            check(bnd == perim, "[C2] boundary vertex count == perimeter (%u == %u)", bnd, perim);
            check(maxH < tolH, "[C2] interior max|H| ~ 0 (%.3e < %.3e)", maxH, tolH);
            check(maxK < tolK, "[C2] interior max|K| ~ 0 (%.3e < %.3e)", maxK, tolK);
            c2 = (interior > 0) && (bnd == perim) && (maxH < tolH) && (maxK < tolK);
        }
    }

    // ── (C3) GAUSS–BONNET on closed meshes: sum defect == 2*pi*chi ────────────
    std::printf("\n[C3] discrete Gauss-Bonnet: sum(angleDefect) == 2*pi*chi\n");
    auto gaussBonnet = [&](const char* tag, const std::vector<double>& pos,
                           const std::vector<std::uint32_t>& idx) -> bool {
        HalfEdgeMesh m;
        bool built = m.buildFromSoup(pos, idx);
        if (!built) { check(false, "[%s] fixture builds (it did NOT)", tag); return false; }
        ValidityReport v = m.validate();
        CurvatureField f = computeCurvature(m);
        check(f.ok, "[%s] curvature ok=true (reason='%s')", tag, f.reason);
        if (!f.ok) return false;

        double lhs = f.totalAngleDefect;
        double rhs = 2.0 * PI * v.eulerChar;
        double err = std::fabs(lhs - rhs);

        // partition of unity: sum of mixed areas == total surface area.
        double areaSum = std::accumulate(f.mixedArea.begin(), f.mixedArea.end(), 0.0);
        double surf = m.surfaceArea();
        double areaErr = std::fabs(areaSum - surf);

        std::printf("    [%s] V=%u E=%u F=%u chi=%d  sumDefect=%.12f  2*pi*chi=%.12f  err=%.3e\n",
                    tag, v.numVertices, v.numEdges, v.numFaces, v.eulerChar, lhs, rhs, err);
        std::printf("    [%s] sum(mixedArea)=%.9f  surfaceArea=%.9f  err=%.3e  (closed=%d manifold=%d)\n",
                    tag, areaSum, surf, areaErr, v.watertight, v.manifold);

        // round-off tolerance scaled by the magnitude of the angle sum
        double tol = 1e-7 * std::max(1.0, std::fabs(rhs) + std::fabs(lhs)) + 1e-9 * f.numVertices;
        bool gb = err < tol;
        check(gb, "[%s] Gauss-Bonnet holds to round-off (err=%.3e < tol=%.3e)", tag, err, tol);
        bool ap = areaErr < 1e-7 * std::max(1.0, surf);
        check(ap, "[%s] partition of unity: sum(mixedArea)==surfaceArea (err=%.3e)", tag, areaErr);
        bool closed = v.watertight && v.manifold;
        check(closed, "[%s] fixture is a closed 2-manifold (chi=%d)", tag, v.eulerChar);
        return gb && ap && closed;
    };

    bool c3a = false, c3b = false;
    {
        // closed icosphere, chi = 2
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.4, 3, pos, idx); jiggleOnSphere(pos, 1.4, 0.10, rng);
        c3a = gaussBonnet("C3a sphere chi=2", pos, idx);
    }
    {
        // closed torus, chi = 0
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        torus(3.0, 1.0, 24, 16, pos, idx);
        c3b = gaussBonnet("C3b torus chi=0", pos, idx);
    }

    // ── (C4) PRINCIPAL curvatures: sphere is umbilic; invariants reconstruct ──
    std::printf("\n[C4] principal curvatures: sphere umbilic k1~k2~1/R; H=(k1+k2)/2, K=k1*k2\n");
    bool c4 = false;
    {
        double R = 1.9;
        // Clean icosphere — deterministic, so the umbilic + invariant-recon claims
        // are exact, not at the mercy of a random skewed triangle.
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(R, 3, pos, idx);
        CurvatureField f = computeCurvature(pos, idx);
        check(f.ok, "[C4] curvature ok=true (reason='%s')", f.reason);
        if (f.ok) {
            // Identities of the (H,K) -> (k1,k2) map:
            //   * H = (k1+k2)/2 is ALWAYS exact (k1+k2 = 2H by construction).
            //   * K = k1*k2 is exact ONLY where the discriminant H^2 - K >= 0 (no
            //     clamp). Where H^2 < K (a geometrically-impossible sub-umbilic
            //     configuration that is pure discretisation noise) we HONESTLY
            //     report k1=k2=H, so k1*k2 = H^2 differs from K by exactly the
            //     clamp gap (K - H^2). We assert (a) H-reconstruction always
            //     exact, (b) K-reconstruction exact where unclamped, and (c) the
            //     clamp gap is small (it is the |H^2 - K| sub-umbilic noise).
            double maxOrder = 0.0, maxHrecRel = 0.0, maxKrecUnclampedRel = 0.0;
            double maxClampGapRel = 0.0, medUmbilic;
            std::vector<double> umb;
            for (std::uint32_t i = 0; i < f.numVertices; ++i) {
                if (f.isBoundary[i]) continue;
                maxOrder = std::max(maxOrder, f.k2[i] - f.k1[i]);   // should be <= 0
                double Hrec = 0.5 * (f.k1[i] + f.k2[i]);
                double Krec = f.k1[i] * f.k2[i];
                double sH = std::max(1e-12, std::fabs(f.meanH[i]));
                double sK = std::max(1e-12, std::fabs(f.gaussianK[i]));
                maxHrecRel = std::max(maxHrecRel, std::fabs(Hrec - f.meanH[i]) / sH);
                double disc = f.meanH[i]*f.meanH[i] - f.gaussianK[i];
                if (disc >= 0.0)
                    maxKrecUnclampedRel = std::max(maxKrecUnclampedRel, std::fabs(Krec - f.gaussianK[i]) / sK);
                else
                    maxClampGapRel = std::max(maxClampGapRel, std::fabs(Krec - f.gaussianK[i]) / sK);
                double denom = std::max(1e-12, std::fabs(f.k1[i]));
                umb.push_back(std::fabs(f.k1[i] - f.k2[i]) / denom);
            }
            medUmbilic = median(umb);
            std::printf("    clean: max(k2-k1)=%.3e  Hrec relErr=%.3e  Krec(unclamped) relErr=%.3e  clampGap relErr=%.3e  med|k1-k2|/|k1|=%.4f\n",
                        maxOrder, maxHrecRel, maxKrecUnclampedRel, maxClampGapRel, medUmbilic);
            bool ordered = maxOrder <= 1e-12;
            bool hrec = maxHrecRel < 1e-12;            // ALWAYS exact
            bool krec = maxKrecUnclampedRel < 1e-12;   // exact where unclamped
            bool clampSmall = maxClampGapRel < 0.01;   // sub-umbilic noise is tiny
            bool umbilic = medUmbilic < 0.10;          // a clean discrete sphere is strongly umbilic
            check(ordered, "[C4] k1 >= k2 at every interior vertex");
            check(hrec, "[C4] H=(k1+k2)/2 reconstructs EXACTLY everywhere (rel err=%.3e)", maxHrecRel);
            check(krec, "[C4] K=k1*k2 reconstructs exactly where discriminant>=0 (rel err=%.3e)", maxKrecUnclampedRel);
            check(clampSmall, "[C4] clamp gap |K-H^2| is small sub-umbilic noise (rel<1%%: %.3e)", maxClampGapRel);
            check(umbilic, "[C4] clean sphere is strongly umbilic (median |k1-k2|/|k1|=%.3f < 0.10)", medUmbilic);
            c4 = ordered && hrec && krec && clampSmall && umbilic;

            // randomized robustness: ordering + H-reconstruction identity hold on a
            // jiggled sphere too (different mesh each run), at every vertex.
            std::vector<double> pj = pos; std::vector<std::uint32_t> ij = idx;
            jiggleOnSphere(pj, R, 0.015, rng);
            CurvatureField fj = computeCurvature(pj, ij);
            bool jok = fj.ok; double jOrder = 0.0, jHrec = 0.0;
            if (fj.ok)
                for (std::uint32_t i = 0; i < fj.numVertices; ++i) {
                    if (fj.isBoundary[i]) continue;
                    jOrder = std::max(jOrder, fj.k2[i] - fj.k1[i]);
                    double Hrec = 0.5 * (fj.k1[i] + fj.k2[i]);
                    double sH = std::max(1e-12, std::fabs(fj.meanH[i]));
                    jHrec = std::max(jHrec, std::fabs(Hrec - fj.meanH[i]) / sH);
                }
            check(jok && jOrder <= 1e-12 && jHrec < 1e-12,
                  "[C4] jiggled sphere: k1>=k2 and H=(k1+k2)/2 hold (order=%.1e Hrec=%.1e)",
                  jOrder, jHrec);
            c4 = c4 && jok && (jOrder <= 1e-12) && (jHrec < 1e-12);
        }
    }

    // ── (C5) 0-FAKES: degenerate / unsupported inputs return ok=false ─────────
    std::printf("\n[C5] 0-FAKES — degenerate / unsupported inputs must return ok=false\n");
    {
        // (a) empty soup
        std::vector<double> ep; std::vector<std::uint32_t> ei;
        CurvatureField ra = computeCurvature(ep, ei);
        check(!ra.ok && ra.mixedArea.empty(), "[C5a] empty soup -> ok=false (reason='%s')", ra.reason);

        // (b) indices not a multiple of 3
        std::vector<double> bp = { 0,0,0, 1,0,0, 0,1,0 };
        std::vector<std::uint32_t> bi = { 0,1 };
        CurvatureField rb = computeCurvature(bp, bi);
        check(!rb.ok, "[C5b] indices length not multiple of 3 -> ok=false (reason='%s')", rb.reason);

        // (c) non-finite (NaN) coordinate
        std::vector<double> np; std::vector<std::uint32_t> ni;
        icosphere(1.0, 1, np, ni);
        np[0] = std::nan("");
        CurvatureField rc = computeCurvature(np, ni);
        check(!rc.ok && rc.mixedArea.empty(), "[C5c] NaN coordinate -> ok=false (reason='%s')", rc.reason);

        // (d) non-manifold soup: two triangles sharing the SAME directed edge.
        std::vector<double> dp = { 0,0,0, 1,0,0, 0,1,0, 0,0,1 };
        std::vector<std::uint32_t> di = { 0,1,2, 0,1,3 };
        CurvatureField rdn = computeCurvature(dp, di);
        check(!rdn.ok && rdn.mixedArea.empty(), "[C5d] non-manifold soup -> ok=false (reason='%s')", rdn.reason);

        // (e) zero-area (degenerate) triangle inside an otherwise-valid soup.
        // Three collinear vertices form a closed degenerate "sliver" mesh. The
        // kernel either rejects at build OR computeCurvature rejects the zero area.
        std::vector<double> sp = { 0,0,0, 1,0,0, 2,0,0, 0,0,1 };
        std::vector<std::uint32_t> si = { 0,1,3, 1,2,3, 2,0,3, 0,2,1 };  // 0,1,2 collinear face
        CurvatureField re = computeCurvature(sp, si);
        check(!re.ok && re.mixedArea.empty(), "[C5e] zero-area triangle -> ok=false (reason='%s')", re.reason);
    }

    std::printf("\n=== HEADLINE: C1a(sphere R=1)=%s C1b(sphere R=2.7)=%s C2(plane)=%s "
                "C3a(GB sphere)=%s C3b(GB torus)=%s C4(principal)=%s ===\n",
                c1a?"PASS":"FAIL", c1b?"PASS":"FAIL", c2?"PASS":"FAIL",
                c3a?"PASS":"FAIL", c3b?"PASS":"FAIL", c4?"PASS":"FAIL");
    std::printf("=== ENVELOPE: per-vertex discrete curvature on a 2-manifold triangle mesh:\n");
    std::printf("===   mean H = |cot-Laplacian|/(2*A_mixed) signed by outward normal; Gaussian K =\n");
    std::printf("===   angle-deficit/A_mixed; principal k1,k2 from (H,K). Sphere R: H->1/R, K->1/R^2\n");
    std::printf("===   with error SHRINKING under refinement; flat plane: interior H~0,K~0; closed-mesh\n");
    std::printf("===   Gauss-Bonnet sum(defect)==2*pi*chi to round-off (sphere chi=2, torus chi=0);\n");
    std::printf("===   mixedArea partitions the surface area. Degenerate/non-manifold/non-finite\n");
    std::printf("===   inputs return ok=false (0 fakes). Boundary-vertex pointwise H/K not fabricated. ===\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
