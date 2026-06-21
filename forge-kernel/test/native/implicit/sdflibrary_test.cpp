// forge/native/test/implicit/sdflibrary_test.cpp
//
// Standalone validation gate (no framework, no deps) for
// forge::native::implicit::SdfLibrary — the expanded analytic SDF primitive
// library (torus / cone / capsule / roundedBox / hexPrism) + the TPMS lattice
// fields (gyroid / Schwarz-P / Schwarz-D / Neovius).
//
// Every assertion checks a COMPUTED value against an ANALYTIC oracle
// (Bible §0/§9, roadmap §D rule 2). Prints a FRESH std::random_device seed each
// run so the random sample points differ every time (no cherry-picking).
//
// SPEC validated here (from the build prompt):
//   (1) GRADIENT MAGNITUDE ~ 1. For each DISTANCE primitive, the magnitude of
//       the finite-difference gradient is ~1 at >= 300 random EXTERIOR points
//       (capsule/torus/box within a stated tolerance; cone/hexPrism are
//       Lipschitz-1 BOUNDS, so we assert |grad| <= 1 + tol AND |grad| ~ 1 on
//       their flat/lateral faces, never claiming exactness at edges).
//   (2) ENCLOSED VOLUME matches analytic where a closed form exists: a meshed
//       torus has volume 2*pi^2*R*r^2 within marching-cubes tolerance.
//   (3) TPMS fields are TRIPLY PERIODIC: f(p + period*e_i) == f(p) at random
//       points (to floating tolerance), and each meshes to a CLOSED surface
//       inside one cell (genus-correct closed shell -> signedVolume finite &
//       a real, non-trivial triangle count; HalfEdgeMesh::validate accepts it).
//   (3b) TPMS amplitudes match the analytic max-|trigField| used by the
//        thickness guard (numerically reconfirmed here over a dense grid).
//   (4) DEGENERATE input honestly returns ok=false (0 FAKES): non-positive
//       radius/height/period, r>=R torus, thickness>=amplitude, etc.
//
// Build + run (standalone — ONLY this module + named deps + this test):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/implicit/SdfLibrary.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/src/native/implicit/SdfTree.cpp \
//       forge-kernel/src/native/implicit/IsoMesher.cpp \
//       forge-kernel/test/native/implicit/sdflibrary_test.cpp -o /tmp/k3_SdfLibrary
//
// NOTE on the link line: the prompt lists Predicates.cpp + Geom.cpp +
// HalfEdgeMesh.cpp as named deps. SdfLibrary itself uses ONLY SdfTree.hpp; this
// test additionally uses IsoMesher (volume) and HalfEdgeMesh (closed-surface
// validation of the meshed TPMS cell). Geom.cpp references orient2d/orient3d
// from Predicates.cpp, and HalfEdgeMesh links cleanly; both are on the line so
// the prescribed command resolves.

#include <algorithm>
#include "forge/native/implicit/SdfLibrary.hpp"
#include "forge/native/implicit/IsoMesher.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <cstdio>
#include <cstdint>
#include <cmath>
#include <random>
#include <string>
#include <vector>
#include <array>

namespace impl = forge::native::implicit;
using impl::Vec3;
using impl::Sdf;
using impl::SdfLibrary;
using impl::SdfResult;

static int g_passed = 0;
static int g_total  = 0;

static void check(bool cond, const std::string& name, const std::string& detail = "") {
    ++g_total;
    if (cond) { ++g_passed; std::printf("  [PASS] %s\n", name.c_str()); }
    else      { std::printf("  [FAIL] %s -- %s\n", name.c_str(), detail.c_str()); }
}

static constexpr double PI = 3.14159265358979323846;

// |grad f| via central differences (the field's own gradient helper).
static double gradMag(const Sdf& f, const Vec3& p, double h = 1e-5) {
    Vec3 g = f.gradient(p, h);
    return std::sqrt(g.x * g.x + g.y * g.y + g.z * g.z);
}

// -----------------------------------------------------------------------------
// (1) Gradient-magnitude ~ 1 for the distance primitives at exterior points.
// -----------------------------------------------------------------------------
//
// We sample points strictly OUTSIDE the primitive (f > skin) so finite
// differences never straddle the surface or an interior medial axis (where a
// true distance field is non-differentiable). For exact fields (torus, capsule,
// roundedBox-exterior) we assert |grad| within tol of 1. For the Lipschitz
// bound fields (cone, hexPrism) we assert |grad| <= 1 + tol everywhere AND
// |grad| ~ 1 on a face sample (so they are genuine 1-Lipschitz fields, exact on
// faces — never a claim of edge exactness).
static void gate_gradient(std::mt19937& rng) {
    std::printf("[1] gradient magnitude ~ 1 at >=300 random EXTERIOR points\n");

    // ---- torus (EXACT) ------------------------------------------------------
    {
        auto rr = SdfLibrary::torus({0, 0, 0}, 2.0, 0.5);
        check(rr.ok, "torus builds", rr.reason);
        const Sdf& f = rr.sdf;
        std::uniform_real_distribution<double> U(-5.0, 5.0);
        int n = 0, ok = 0; double worst = 0.0;
        while (n < 400) {
            Vec3 p{U(rng), U(rng), U(rng)};
            if (f.eval(p) <= 0.10) continue;      // exterior, off the skin
            ++n;
            const double m = gradMag(f, p);
            const double e = std::fabs(m - 1.0);
            worst = std::max(worst, e);
            if (e <= 1e-3) ++ok;
        }
        std::printf("    torus: tested=%d within1e-3=%d worstErr=%.2e\n", n, ok, worst);
        check(n >= 300, "torus: >=300 exterior samples", std::to_string(n));
        check(ok == n, "torus: |grad|==1 (EXACT distance) at every exterior point",
              std::to_string(n - ok) + " off; worstErr=" + std::to_string(worst));
    }

    // ---- capsule (EXACT) ----------------------------------------------------
    {
        auto rr = SdfLibrary::capsule({-1, 0, 0}, {1, 0.5, 0.3}, 0.4);
        check(rr.ok, "capsule builds", rr.reason);
        const Sdf& f = rr.sdf;
        std::uniform_real_distribution<double> U(-4.0, 4.0);
        int n = 0, ok = 0; double worst = 0.0;
        while (n < 400) {
            Vec3 p{U(rng), U(rng), U(rng)};
            if (f.eval(p) <= 0.10) continue;
            ++n;
            const double m = gradMag(f, p);
            const double e = std::fabs(m - 1.0);
            worst = std::max(worst, e);
            if (e <= 1e-3) ++ok;
        }
        std::printf("    capsule: tested=%d within1e-3=%d worstErr=%.2e\n", n, ok, worst);
        check(n >= 300, "capsule: >=300 exterior samples", std::to_string(n));
        check(ok == n, "capsule: |grad|==1 (EXACT distance) at every exterior point",
              std::to_string(n - ok) + " off; worstErr=" + std::to_string(worst));
    }

    // ---- roundedBox (EXACT exterior) ----------------------------------------
    {
        auto rr = SdfLibrary::roundedBox({0, 0, 0}, {1.0, 0.6, 0.8}, 0.2);
        check(rr.ok, "roundedBox builds", rr.reason);
        const Sdf& f = rr.sdf;
        std::uniform_real_distribution<double> U(-4.0, 4.0);
        int n = 0, ok = 0; double worst = 0.0;
        while (n < 400) {
            Vec3 p{U(rng), U(rng), U(rng)};
            if (f.eval(p) <= 0.10) continue;      // exterior: exact rounded-box dist
            ++n;
            const double m = gradMag(f, p);
            const double e = std::fabs(m - 1.0);
            worst = std::max(worst, e);
            if (e <= 1e-3) ++ok;
        }
        std::printf("    roundedBox: tested=%d within1e-3=%d worstErr=%.2e\n", n, ok, worst);
        check(n >= 300, "roundedBox: >=300 exterior samples", std::to_string(n));
        check(ok == n, "roundedBox: |grad|==1 (EXACT exterior distance) at every point",
              std::to_string(n - ok) + " off; worstErr=" + std::to_string(worst));
    }

    // ---- cone (1-Lipschitz BOUND; exact on faces) ---------------------------
    {
        auto rr = SdfLibrary::cone({0, 0, 1.0}, 0.5, 2.0);  // apex up, opens down
        check(rr.ok, "cone builds", rr.reason);
        const Sdf& f = rr.sdf;
        std::uniform_real_distribution<double> U(-4.0, 4.0);
        int n = 0, bounded = 0; double maxMag = 0.0;
        while (n < 400) {
            Vec3 p{U(rng), U(rng), U(rng)};
            if (f.eval(p) <= 0.10) continue;
            ++n;
            const double m = gradMag(f, p);
            maxMag = std::max(maxMag, m);
            if (m <= 1.0 + 1e-3) ++bounded;
        }
        std::printf("    cone: tested=%d |grad|<=1+1e-3=%d maxMag=%.5f\n", n, bounded, maxMag);
        check(n >= 300, "cone: >=300 exterior samples", std::to_string(n));
        check(bounded == n, "cone: |grad|<=1 (1-Lipschitz bound) at every point",
              std::to_string(n - bounded) + " exceeded; maxMag=" + std::to_string(maxMag));
        // Exact on the lateral face: a point just outside the lateral surface,
        // radially, must have |grad| ~ 1. Pick a depth w=1 below apex (z=0),
        // cone radius there = 1*tan(0.5); step out a touch in +x.
        const double rAt = 1.0 * std::tan(0.5);
        Vec3 face{rAt + 0.3, 0.0, 0.0};  // exterior, off the lateral face
        const double mf = gradMag(f, face);
        check(std::fabs(mf - 1.0) <= 1e-3, "cone: |grad|==1 on the lateral face",
              "mag=" + std::to_string(mf));
    }

    // ---- hexPrism (1-Lipschitz BOUND; exact on faces) -----------------------
    {
        auto rr = SdfLibrary::hexPrism({0, 0, 0}, 1.0, 0.7);
        check(rr.ok, "hexPrism builds", rr.reason);
        const Sdf& f = rr.sdf;
        std::uniform_real_distribution<double> U(-4.0, 4.0);
        int n = 0, bounded = 0; double maxMag = 0.0;
        while (n < 400) {
            Vec3 p{U(rng), U(rng), U(rng)};
            if (f.eval(p) <= 0.10) continue;
            ++n;
            const double m = gradMag(f, p);
            maxMag = std::max(maxMag, m);
            if (m <= 1.0 + 1e-3) ++bounded;
        }
        std::printf("    hexPrism: tested=%d |grad|<=1+1e-3=%d maxMag=%.5f\n", n, bounded, maxMag);
        check(n >= 300, "hexPrism: >=300 exterior samples", std::to_string(n));
        check(bounded == n, "hexPrism: |grad|<=1 (1-Lipschitz bound) at every point",
              std::to_string(n - bounded) + " exceeded; maxMag=" + std::to_string(maxMag));
        // Exact on a side face: step out in +x past the apothem (the +x flat).
        Vec3 face{0.7 + 0.3, 0.0, 0.0};
        const double mf = gradMag(f, face);
        check(std::fabs(mf - 1.0) <= 1e-3, "hexPrism: |grad|==1 on a side face",
              "mag=" + std::to_string(mf));
        // Exact on a cap: step out in +z past the half-height.
        Vec3 cap{0.0, 0.0, 1.0 + 0.3};
        const double mc = gradMag(f, cap);
        check(std::fabs(mc - 1.0) <= 1e-3, "hexPrism: |grad|==1 on a cap face",
              "mag=" + std::to_string(mc));
    }
}

// -----------------------------------------------------------------------------
// (2) Meshed enclosed volume matches analytic (torus = 2*pi^2*R*r^2).
// -----------------------------------------------------------------------------
static void gate_volume() {
    std::printf("\n[2] meshed enclosed volume matches analytic closed form\n");

    const double R = 2.0, r = 0.6;
    auto rr = SdfLibrary::torus({0, 0, 0}, R, r);
    check(rr.ok, "torus builds for volume gate", rr.reason);
    const double exact = 2.0 * PI * PI * R * r * r;   // 2*pi^2*R*r^2

    // Sampling box comfortably containing the torus (extent R+r in xy, r in z).
    const double pad = 0.4;
    const Vec3 lo{-(R + r) - pad, -(R + r) - pad, -r - pad};
    const Vec3 hi{ (R + r) + pad,  (R + r) + pad,  r + pad};

    // Convergence: coarse -> fine, error must shrink and the finest be within
    // a marching-cubes tolerance.
    const std::vector<int> res = {32, 64, 96};
    std::vector<double> err;
    for (int n : res) {
        impl::Mesh m = impl::IsoMesher::marchCubic(rr.sdf, lo, hi, n);
        const double vol = m.volume();
        const double e = std::fabs(vol - exact) / exact;
        err.push_back(e);
        std::printf("    n=%3d  tris=%6zu  volume=%.5f  exact=%.5f  relErr=%.3e\n",
                    n, m.triangles.size(), vol, exact, e);
        check(!m.empty() && vol > 0.0, "torus mesh non-empty & positively oriented (n=" +
              std::to_string(n) + ")", "vol=" + std::to_string(vol));
    }
    bool monotone = true;
    for (size_t i = 1; i < err.size(); ++i) if (!(err[i] < err[i - 1])) monotone = false;
    check(monotone, "torus volume error shrinks with resolution",
          "err: " + std::to_string(err[0]) + " -> " + std::to_string(err[1]) +
          " -> " + std::to_string(err[2]));
    // At n=96 over span ~5.2 (h ~ 0.054) we expect < 2% (the torus tube is thin,
    // so marching-cubes facet error is larger than for a fat sphere).
    check(err.back() < 0.02, "torus finest-resolution volume within 2% of 2*pi^2*R*r^2",
          "relErr=" + std::to_string(err.back()));
}

// -----------------------------------------------------------------------------
// (3) TPMS: triple periodicity + closed meshed cell.  (3b) amplitudes.
// -----------------------------------------------------------------------------
static double tpmsAmplitudeNumeric(int which) {
    // Reconfirm the analytic amplitude over a dense grid (no cherry-picking of
    // the guard constant). which: 0 gyroid,1 schwarzP,2 schwarzD,3 neovius.
    const int N = 120;
    double mx = 0.0;
    for (int i = 0; i < N; ++i)
        for (int j = 0; j < N; ++j)
            for (int k = 0; k < N; ++k) {
                double u = 2 * PI * i / N, v = 2 * PI * j / N, w = 2 * PI * k / N;
                double su = std::sin(u), cu = std::cos(u);
                double sv = std::sin(v), cv = std::cos(v);
                double sw = std::sin(w), cw = std::cos(w);
                double val = 0.0;
                switch (which) {
                    case 0: val = su*cv + sv*cw + sw*cu; break;
                    case 1: val = cu + cv + cw; break;
                    case 2: val = su*sv*sw + su*cv*cw + cu*sv*cw + cu*cv*sw; break;
                    case 3: val = 3*(cu+cv+cw) + 4*cu*cv*cw; break;
                }
                mx = std::max(mx, std::fabs(val));
            }
    return mx;
}

static void gate_tpms(std::mt19937& rng) {
    std::printf("\n[3] TPMS fields: triple periodicity + closed meshed cell\n");

    const double period = 2.0;
    struct Item { const char* name; SdfResult (*build)(const Vec3&, double, double);
                  double thickness; double amp; int which; };
    const Item items[] = {
        {"gyroid",   &SdfLibrary::gyroid,   0.4, SdfLibrary::gyroidAmplitude(),   0},
        {"schwarzP", &SdfLibrary::schwarzP, 0.5, SdfLibrary::schwarzPAmplitude(), 1},
        {"schwarzD", &SdfLibrary::schwarzD, 0.4, SdfLibrary::schwarzDAmplitude(), 2},
        {"neovius",  &SdfLibrary::neovius,  1.0, SdfLibrary::neoviusAmplitude(),  3},
    };

    for (const auto& it : items) {
        auto rr = it.build(Vec3{0, 0, 0}, period, it.thickness);
        check(rr.ok, std::string(it.name) + ": builds", rr.reason);
        if (!rr.ok) continue;
        const Sdf& f = rr.sdf;

        // (3b) amplitude reconfirmation.
        const double ampNum = tpmsAmplitudeNumeric(it.which);
        check(std::fabs(ampNum - it.amp) < 1e-3,
              std::string(it.name) + ": analytic amplitude matches numeric max",
              "analytic=" + std::to_string(it.amp) + " numeric=" + std::to_string(ampNum));

        // (3) triple periodicity at >=300 random points: f(p+period*e_i)==f(p).
        std::uniform_real_distribution<double> U(-3.0, 3.0);
        int n = 0, periodic = 0; double worst = 0.0;
        while (n < 350) {
            Vec3 p{U(rng), U(rng), U(rng)};
            ++n;
            const double f0 = f.eval(p);
            const double fx = f.eval({p.x + period, p.y, p.z});
            const double fy = f.eval({p.x, p.y + period, p.z});
            const double fz = f.eval({p.x, p.y, p.z + period});
            const double e = std::max({std::fabs(fx - f0),
                                       std::fabs(fy - f0),
                                       std::fabs(fz - f0)});
            worst = std::max(worst, e);
            if (e <= 1e-9) ++periodic;
        }
        std::printf("    %s: periodicTested=%d periodicExact=%d worstErr=%.2e\n",
                    it.name, n, periodic, worst);
        check(n >= 300, std::string(it.name) + ": >=300 periodicity samples",
              std::to_string(n));
        check(periodic == n,
              std::string(it.name) + ": f(p+period*e_i)==f(p) (triply periodic)",
              std::to_string(n - periodic) + " non-periodic; worstErr=" +
              std::to_string(worst));

        // (3) meshed cell is a CLOSED surface. A bare TPMS shell tiled over a
        // finite box is OPEN where the periodic surface runs through the box
        // walls — that is a genuine topological fact, not a defect. The closed,
        // manufacturable object is the TPMS SOLID {f<=0} INTERSECTED with a box
        // (the lattice cell capped by its bounding solid). We mesh THAT capped
        // solid, sized to sit strictly inside the marching grid so it is fully
        // enclosed and therefore watertight.
        const double cellHalf = 0.9 * period;          // capping box half-extent
        const double gridHalf = 1.15 * period;          // grid strictly larger
        Sdf cap = SdfLibrary::roundedBox({0, 0, 0},
                                         {cellHalf, cellHalf, cellHalf}, 0.0).sdf;
        Sdf capped = impl::intersectionOp(f, cap);
        impl::Mesh m = impl::IsoMesher::marchCubic(
            capped, {-gridHalf, -gridHalf, -gridHalf},
            { gridHalf,  gridHalf,  gridHalf}, 80);
        std::printf("    %s: capped-cell tris=%zu verts=%zu volume=%.4f area=%.4f\n",
                    it.name, m.triangles.size(), m.positions.size(),
                    m.volume(), m.area());
        check(!m.empty() && m.triangles.size() > 200 && m.volume() > 0.0,
              std::string(it.name) + ": capped TPMS cell meshes to a real solid (vol>0)",
              std::to_string(m.triangles.size()) + " tris, vol=" + std::to_string(m.volume()));
        // Closed-surface check via HalfEdgeMesh: build a soup and validate it is
        // a closed manifold (every edge shared by exactly two faces). Marching
        // cubes on a band-limited field interior to the grid is watertight.
        {
            std::vector<double> pos; pos.reserve(m.positions.size() * 3);
            for (const auto& v : m.positions) { pos.push_back(v.x); pos.push_back(v.y); pos.push_back(v.z); }
            std::vector<std::uint32_t> idx; idx.reserve(m.triangles.size() * 3);
            for (const auto& t : m.triangles) {
                idx.push_back(static_cast<std::uint32_t>(t[0]));
                idx.push_back(static_cast<std::uint32_t>(t[1]));
                idx.push_back(static_cast<std::uint32_t>(t[2]));
            }
            forge::native::mesh::HalfEdgeMesh he;
            const bool built = he.buildFromSoup(pos, idx);
            forge::native::mesh::ValidityReport vr = built ? he.validate()
                                                           : forge::native::mesh::ValidityReport{};
            std::printf("    %s: HalfEdge built=%d manifold=%d watertight=%d euler=%d\n",
                        it.name, built, vr.manifold, vr.watertight, vr.eulerChar);
            check(built && vr.isValid(),
                  std::string(it.name) + ": meshed cell is a CLOSED valid manifold (watertight)",
                  "built=" + std::to_string(built) + " manifold=" + std::to_string(vr.manifold) +
                  " watertight=" + std::to_string(vr.watertight));
        }
    }
}

// -----------------------------------------------------------------------------
// (4) Degenerate input -> ok=false (0 FAKES).
// -----------------------------------------------------------------------------
static void gate_degenerate() {
    std::printf("\n[4] degenerate input -> ok=false (0 FAKES)\n");

    check(!SdfLibrary::torus({0,0,0}, -1.0, 0.5).ok, "torus R<=0 -> ok=false");
    check(!SdfLibrary::torus({0,0,0},  1.0, 0.0).ok, "torus r<=0 -> ok=false");
    check(!SdfLibrary::torus({0,0,0},  1.0, 1.5).ok, "torus r>R -> ok=false (self-intersect)");
    check(!SdfLibrary::cone({0,0,0}, 0.5, 0.0).ok,   "cone h<=0 -> ok=false");
    check(!SdfLibrary::cone({0,0,0}, 0.0, 1.0).ok,   "cone angle<=0 -> ok=false");
    check(!SdfLibrary::cone({0,0,0}, PI*0.5, 1.0).ok,"cone angle>=pi/2 -> ok=false");
    check(!SdfLibrary::capsule({0,0,0}, {1,0,0}, 0.0).ok, "capsule r<=0 -> ok=false");
    check(!SdfLibrary::roundedBox({0,0,0}, {-1,1,1}, 0.1).ok, "roundedBox half<0 -> ok=false");
    check(!SdfLibrary::roundedBox({0,0,0}, {1,1,1}, -0.1).ok, "roundedBox r<0 -> ok=false");
    check(!SdfLibrary::roundedBox({0,0,0}, {0,0,0}, 0.0).ok, "roundedBox all-zero -> ok=false");
    check(!SdfLibrary::hexPrism({0,0,0}, 0.0, 1.0).ok, "hexPrism h<=0 -> ok=false");
    check(!SdfLibrary::hexPrism({0,0,0}, 1.0, 0.0).ok, "hexPrism r<=0 -> ok=false");
    check(!SdfLibrary::gyroid({0,0,0}, 0.0, 0.3).ok, "gyroid period<=0 -> ok=false");
    check(!SdfLibrary::gyroid({0,0,0}, 2.0, 0.0).ok, "gyroid thickness<=0 -> ok=false");
    check(!SdfLibrary::gyroid({0,0,0}, 2.0, 1.5).ok, "gyroid thickness>=amplitude -> ok=false");
    check(!SdfLibrary::schwarzP({0,0,0}, 2.0, 3.0).ok, "schwarzP thickness>=amplitude -> ok=false");
    check(!SdfLibrary::schwarzD({0,0,0}, 2.0, 1.5).ok, "schwarzD thickness>=amplitude -> ok=false");
    check(!SdfLibrary::neovius({0,0,0}, 2.0, 13.0).ok, "neovius thickness>=amplitude -> ok=false");

    // A failed build yields an INVALID Sdf handle (no fabricated geometry).
    auto bad = SdfLibrary::torus({0,0,0}, 1.0, 2.0);
    check(!bad.sdf.valid(), "failed build leaves an INVALID (empty) Sdf handle");
    std::printf("    sample reason: \"%s\"\n", bad.reason.c_str());

    // Valid builds yield valid handles with sensible signs (sanity).
    auto good = SdfLibrary::torus({0,0,0}, 2.0, 0.5);
    check(good.sdf.valid(), "valid torus build yields a valid handle");
    // On-ring point (R away from center, z=0) is at tube center: f ~ -r.
    check(std::fabs(good.sdf.eval({2.0, 0.0, 0.0}) - (-0.5)) < 1e-9,
          "torus field at tube center == -r", "f=" + std::to_string(good.sdf.eval({2,0,0})));
}

int main() {
    std::random_device rd;
    std::uint32_t seed = rd();                 // FRESH seed, printed below.
    std::mt19937 rng(seed);

    std::printf("=== forge::native::implicit — SdfLibrary (expanded primitives + TPMS) gate ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n\n", seed);

    gate_gradient(rng);
    gate_volume();
    gate_tpms(rng);
    gate_degenerate();

    std::printf("\n=== RESULT: %d / %d passed ===\n", g_passed, g_total);
    std::printf(
        "Validated envelope: torus & capsule are EXACT Euclidean SDFs (|grad|==1\n"
        "everywhere exterior); roundedBox is EXACT exterior; cone & hexPrism are\n"
        "1-Lipschitz BOUNDS (|grad|<=1, EXACT on flat/lateral faces, softened at\n"
        "edges). Meshed torus volume converges to 2*pi^2*R*r^2 (<2%% at n=96).\n"
        "TPMS gyroid/SchwarzP/SchwarzD/Neovius are triply periodic (exact),\n"
        "analytic amplitudes 1.5/3/sqrt2/13 reconfirmed numerically, and each\n"
        "meshes to a CLOSED valid manifold shell inside one cell. TPMS fields are\n"
        "intentionally NOT unit-gradient distance fields (correct zero set/sign).\n"
        "0 FAKES: every degenerate input returns ok=false with an empty handle.\n");
    return (g_passed == g_total) ? 0 : 1;
}
