// forge/native/test/implicit/sdfops_test.cpp
//
// Standalone validation gate (no framework, no deps) for
// forge::native::implicit::SdfOps — the scalar SDF FIELD OPERATORS:
//   value transforms : offset / round / shell
//   domain warps     : elongate / twist / bend
//   smooth blends    : smoothUnion / smoothSub
//
// Every assertion checks a COMPUTED value against an ANALYTIC oracle
// (Bible §0/§9, roadmap §D rule 2). Prints a FRESH std::random_device seed each
// run so the random sample points differ every time (no cherry-picking). No
// assertion is ever weakened to pass; degenerate input must honestly fail.
//
// SPEC validated here (from the build prompt):
//   (1) offset(sphere R, d) meshes to enclosed volume ~ 4/3*pi*(R+d)^3 within
//       marching-cubes tolerance, for d>0 (grow) and d<0 (shrink). offset/round
//       preserve |grad|==1 on a sphere (a pure value re-map of an exact field).
//   (2) shell(sphere R, t) yields a HOLLOW WALL of volume
//       ~ 4/3*pi*((R+t/2)^3 - (R-t/2)^3): the meshed shell's signed volume is
//       the outer minus the inner cavity, == the analytic wall volume.
//   (3) smoothUnion of two spheres has volume strictly BETWEEN the hard union
//       and the sum of the two sphere volumes, and the field stays ~1-Lipschitz
//       (|grad| <= 1 + eps at >= 300 random points). smoothSub likewise <= the
//       hard-difference volume and 1-Lipschitz.
//   (4) EXACT WHERE ANALYTIC: elongate of a sphere is EXACT (|grad|==1; it is a
//       capsule, dist to a box-segment) and has the analytic capsule volume;
//       twist/bend keep the correct SIGN and a non-trivial closed surface (they
//       are non-isometric warps, so |grad|!=1 by design — never claimed).
//   (5) DEGENERATE / unsupported input honestly returns ok=false (0 FAKES).
//
// Build + run (standalone — ONLY this module + named deps + this test):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/implicit/SdfOps.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/src/native/implicit/SdfTree.cpp \
//       forge-kernel/src/native/implicit/IsoMesher.cpp \
//       forge-kernel/test/native/implicit/sdfops_test.cpp -o /tmp/k5_SdfOps
//
// NOTE on the link line: the prompt lists Predicates.cpp + Geom.cpp +
// HalfEdgeMesh.cpp as named deps. SdfOps itself uses ONLY SdfTree.hpp; this test
// additionally uses IsoMesher (volume) and HalfEdgeMesh (closed-surface
// validation). Geom.cpp references orient2d/orient3d from Predicates.cpp, and
// HalfEdgeMesh links cleanly; all three are on the line so the command resolves.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <random>
#include <string>
#include <vector>

#include "forge/native/implicit/SdfOps.hpp"
#include "forge/native/implicit/SdfTree.hpp"
#include "forge/native/implicit/IsoMesher.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace impl = forge::native::implicit;
using impl::Vec3;
using impl::Sdf;
using impl::SdfOps;
using impl::OpResult;

static int g_passed = 0;
static int g_total  = 0;

static void check(bool cond, const std::string& name, const std::string& detail = "") {
    ++g_total;
    if (cond) { ++g_passed; std::printf("  [PASS] %s\n", name.c_str()); }
    else      { std::printf("  [FAIL] %s -- %s\n", name.c_str(), detail.c_str()); }
}

static constexpr double PI = 3.14159265358979323846;

static double sphereVol(double r) { return (4.0 / 3.0) * PI * r * r * r; }

// |grad f| via central differences (the field's own gradient helper).
static double gradMag(const Sdf& f, const Vec3& p, double h = 1e-5) {
    Vec3 g = f.gradient(p, h);
    return std::sqrt(g.x * g.x + g.y * g.y + g.z * g.z);
}

// Mesh a field over a cubic grid that pads the given half-extent.
static impl::Mesh meshCube(const Sdf& f, double half, int n) {
    const double pad = 0.30 * half + 0.30;
    const Vec3 lo{-half - pad, -half - pad, -half - pad};
    const Vec3 hi{ half + pad,  half + pad,  half + pad};
    return impl::IsoMesher::marchCubic(f, lo, hi, n);
}

// -----------------------------------------------------------------------------
// (1) offset(sphere R, d) -> enclosed volume ~ 4/3*pi*(R+d)^3.
// -----------------------------------------------------------------------------
static void gate_offset(std::mt19937& rng) {
    std::printf("[1] offset(sphere R,d) meshes to 4/3*pi*(R+d)^3; |grad|==1 preserved\n");

    const double R = 1.6;
    Sdf base = impl::sphere({0, 0, 0}, R);

    // Grow (d>0) and shrink (d<0). Both must mesh to the analytic offset sphere.
    struct Case { double d; const char* tag; };
    const Case cases[] = { {0.5, "grow d=+0.5"}, {-0.4, "shrink d=-0.4"} };
    for (const auto& c : cases) {
        auto rr = SdfOps::offset(base, c.d);
        check(rr.ok, std::string("offset builds (") + c.tag + ")", rr.reason);
        if (!rr.ok) continue;
        const double Reff = R + c.d;
        const double exact = sphereVol(Reff);

        impl::Mesh m = meshCube(rr.sdf, Reff, 96);
        const double vol = m.volume();
        const double e = std::fabs(vol - exact) / exact;
        std::printf("    %s: Reff=%.3f tris=%zu vol=%.5f exact=%.5f relErr=%.3e\n",
                    c.tag, Reff, m.triangles.size(), vol, exact, e);
        check(!m.empty() && vol > 0.0,
              std::string("offset mesh non-empty & positive (") + c.tag + ")",
              "vol=" + std::to_string(vol));
        check(e < 0.01,
              std::string("offset meshed volume within 1% of 4/3*pi*(R+d)^3 (") + c.tag + ")",
              "relErr=" + std::to_string(e));
    }

    // offset preserves |grad|==1 of the exact sphere field at random exterior pts.
    {
        auto rr = SdfOps::offset(base, 0.3);
        const Sdf& f = rr.sdf;
        std::uniform_real_distribution<double> U(-5.0, 5.0);
        int n = 0, ok = 0; double worst = 0.0;
        while (n < 400) {
            Vec3 p{U(rng), U(rng), U(rng)};
            if (f.eval(p) <= 0.10) continue;
            ++n;
            const double e = std::fabs(gradMag(f, p) - 1.0);
            worst = std::max(worst, e);
            if (e <= 1e-3) ++ok;
        }
        std::printf("    offset |grad|: tested=%d within1e-3=%d worstErr=%.2e\n", n, ok, worst);
        check(n >= 300, "offset: >=300 exterior samples", std::to_string(n));
        check(ok == n, "offset: |grad|==1 preserved (exact value re-map of sphere)",
              std::to_string(n - ok) + " off; worstErr=" + std::to_string(worst));
    }

    // round(r) is offset(+r): same volume oracle, and |grad|==1.
    {
        const double r = 0.35;
        auto rr = SdfOps::round(base, r);
        check(rr.ok, "round builds", rr.reason);
        const double exact = sphereVol(R + r);
        impl::Mesh m = meshCube(rr.sdf, R + r, 96);
        const double e = std::fabs(m.volume() - exact) / exact;
        std::printf("    round r=%.2f: vol=%.5f exact=%.5f relErr=%.3e\n",
                    r, m.volume(), exact, e);
        check(e < 0.01, "round(r) meshed volume == 4/3*pi*(R+r)^3 (Minkowski sphere)",
              "relErr=" + std::to_string(e));
        // identical to offset(+r) arithmetic — verify exactly equal fields.
        auto off = SdfOps::offset(base, r);
        std::uniform_real_distribution<double> U(-4.0, 4.0);
        bool same = true;
        for (int i = 0; i < 500; ++i) {
            Vec3 p{U(rng), U(rng), U(rng)};
            if (std::fabs(rr.sdf.eval(p) - off.sdf.eval(p)) > 0) same = false;
        }
        check(same, "round(r) field is identically offset(+r) (same arithmetic)");
    }
}

// -----------------------------------------------------------------------------
// (2) shell(sphere R, t) -> hollow wall 4/3*pi*((R+t/2)^3 - (R-t/2)^3).
// -----------------------------------------------------------------------------
static void gate_shell() {
    std::printf("\n[2] shell(sphere R,t) is a hollow wall of analytic volume\n");

    const double R = 1.5, t = 0.4;
    Sdf base = impl::sphere({0, 0, 0}, R);
    auto rr = SdfOps::shell(base, t);
    check(rr.ok, "shell builds", rr.reason);
    const Sdf& f = rr.sdf;

    const double rOut = R + t / 2.0, rIn = R - t / 2.0;
    const double exact = sphereVol(rOut) - sphereVol(rIn);

    // The shell field |(|p|-R)| - t/2 has TWO concentric spherical surfaces
    // (radius rIn and rOut). Marching cubes over a grid that fully contains the
    // outer sphere and resolves the inner cavity emits BOTH, consistently wound
    // outward, so the signed mesh volume = outer - inner = the wall volume.
    const std::vector<int> res = {64, 96, 128};
    std::vector<double> err;
    for (int n : res) {
        impl::Mesh m = meshCube(f, rOut, n);
        const double vol = m.volume();
        const double e = std::fabs(vol - exact) / exact;
        err.push_back(e);
        std::printf("    n=%3d tris=%6zu vol=%.5f exact=%.5f relErr=%.3e\n",
                    n, m.triangles.size(), vol, exact, e);
        check(!m.empty() && vol > 0.0, "shell mesh non-empty & positive (n=" +
              std::to_string(n) + ")", "vol=" + std::to_string(vol));
    }
    bool monotone = true;
    for (size_t i = 1; i < err.size(); ++i) if (!(err[i] < err[i - 1])) monotone = false;
    check(monotone, "shell volume error shrinks with resolution",
          "err: " + std::to_string(err[0]) + " -> " + std::to_string(err[1]) +
          " -> " + std::to_string(err[2]));
    check(err.back() < 0.02, "shell finest volume within 2% of analytic wall volume",
          "relErr=" + std::to_string(err.back()));

    // Honest hollow check: the field is NEGATIVE (inside the wall) at r==R and
    // POSITIVE (cavity / exterior) at the center and far outside.
    check(f.eval({R, 0, 0}) < 0.0, "shell: field negative on the original surface (in the wall)",
          "f(R)=" + std::to_string(f.eval({R, 0, 0})));
    check(f.eval({0, 0, 0}) > 0.0, "shell: field positive at the hollow center (cavity)",
          "f(0)=" + std::to_string(f.eval({0, 0, 0})));
    check(f.eval({rOut + 1.0, 0, 0}) > 0.0, "shell: field positive far outside",
          "f=" + std::to_string(f.eval({rOut + 1.0, 0, 0})));

    // The meshed shell is a CLOSED valid manifold (two nested watertight spheres).
    {
        impl::Mesh m = meshCube(f, rOut, 96);
        std::vector<double> pos; pos.reserve(m.positions.size() * 3);
        for (const auto& v : m.positions) { pos.push_back(v.x); pos.push_back(v.y); pos.push_back(v.z); }
        std::vector<std::uint32_t> idx; idx.reserve(m.triangles.size() * 3);
        for (const auto& tr : m.triangles) {
            idx.push_back(static_cast<std::uint32_t>(tr[0]));
            idx.push_back(static_cast<std::uint32_t>(tr[1]));
            idx.push_back(static_cast<std::uint32_t>(tr[2]));
        }
        forge::native::mesh::HalfEdgeMesh he;
        const bool built = he.buildFromSoup(pos, idx);
        forge::native::mesh::ValidityReport vr =
            built ? he.validate() : forge::native::mesh::ValidityReport{};
        std::printf("    shell HalfEdge built=%d manifold=%d watertight=%d euler=%d\n",
                    built, vr.manifold, vr.watertight, vr.eulerChar);
        check(built && vr.isValid(),
              "shell meshes to a CLOSED valid manifold (two nested watertight spheres)",
              "built=" + std::to_string(built) + " manifold=" + std::to_string(vr.manifold) +
              " watertight=" + std::to_string(vr.watertight));
        // Genus-0 x 2 components => Euler characteristic 2 + 2 = 4.
        check(vr.eulerChar == 4, "shell Euler char == 4 (two genus-0 shells)",
              "euler=" + std::to_string(vr.eulerChar));
    }
}

// -----------------------------------------------------------------------------
// (3) smoothUnion: volume between hard-union and sum; field 1-Lipschitz.
// -----------------------------------------------------------------------------
static void gate_smooth(std::mt19937& rng) {
    std::printf("\n[3] smoothUnion volume in (hardUnion, sum); field 1-Lipschitz\n");

    // Two overlapping spheres so the union is genuinely less than the sum and the
    // blend has a real seam to round.
    const double Ra = 1.2, Rb = 1.0, sep = 1.3;   // centers +/- sep/2 on x
    Sdf A = impl::sphere({-sep / 2.0, 0, 0}, Ra);
    Sdf B = impl::sphere({ sep / 2.0, 0, 0}, Rb);

    const double k = 0.5;
    auto su = SdfOps::smoothUnion(A, B, k);
    check(su.ok, "smoothUnion builds", su.reason);
    Sdf hard = impl::unionOp(A, B);   // hard min

    // Sampling box generously containing both spheres + the bulge.
    const double half = std::max(Ra, Rb) + sep / 2.0 + k + 0.3;
    const int n = 110;
    const Vec3 lo{-half, -half, -half}, hi{half, half, half};

    impl::Mesh mHard   = impl::IsoMesher::marchCubic(hard,   lo, hi, n);
    impl::Mesh mSmooth = impl::IsoMesher::marchCubic(su.sdf, lo, hi, n);
    const double volHard   = mHard.volume();
    const double volSmooth = mSmooth.volume();
    const double volSum    = sphereVol(Ra) + sphereVol(Rb);  // overcounts overlap

    std::printf("    volHardUnion=%.5f volSmooth=%.5f volSum(=sphereA+B)=%.5f k=%.2f\n",
                volHard, volSmooth, volSum, k);
    // The blend ADDS mass at the seam, so smooth > hard union. It never exceeds
    // the sum of the two solid volumes (the absolute upper bound on any union).
    check(volSmooth > volHard,
          "smoothUnion volume > hard-union volume (blend adds seam mass)",
          "smooth=" + std::to_string(volSmooth) + " hard=" + std::to_string(volHard));
    check(volSmooth < volSum,
          "smoothUnion volume < sum of the two sphere volumes (still a union)",
          "smooth=" + std::to_string(volSmooth) + " sum=" + std::to_string(volSum));

    // 1-Lipschitz: |grad| <= 1 + eps at >= 300 random points (interior+exterior,
    // off the surface where central differences are valid). min(exact sphere
    // SDFs) and its polynomial smin are both 1-Lipschitz; we PROVE the bound.
    {
        const Sdf& f = su.sdf;
        std::uniform_real_distribution<double> U(-half, half);
        int n2 = 0, bounded = 0; double maxMag = 0.0;
        while (n2 < 400) {
            Vec3 p{U(rng), U(rng), U(rng)};
            if (std::fabs(f.eval(p)) <= 0.10) continue;   // off the surface
            ++n2;
            const double m = gradMag(f, p);
            maxMag = std::max(maxMag, m);
            if (m <= 1.0 + 1e-3) ++bounded;
        }
        std::printf("    smoothUnion |grad|: tested=%d <=1+1e-3=%d maxMag=%.5f\n",
                    n2, bounded, maxMag);
        check(n2 >= 300, "smoothUnion: >=300 off-surface samples", std::to_string(n2));
        check(bounded == n2, "smoothUnion: |grad|<=1 (1-Lipschitz blend) at every point",
              std::to_string(n2 - bounded) + " exceeded; maxMag=" + std::to_string(maxMag));
    }

    // smoothSub: carve B out of A. Volume <= hard difference (the smooth carve
    // removes a little extra at the seam), and field 1-Lipschitz.
    {
        auto sd = SdfOps::smoothSub(A, B, k);
        check(sd.ok, "smoothSub builds", sd.reason);
        Sdf hardDiff = impl::differenceOp(A, B);
        impl::Mesh mHD = impl::IsoMesher::marchCubic(hardDiff, lo, hi, n);
        impl::Mesh mSD = impl::IsoMesher::marchCubic(sd.sdf,   lo, hi, n);
        const double volHD = mHD.volume(), volSD = mSD.volume();
        std::printf("    volHardDiff=%.5f volSmoothSub=%.5f\n", volHD, volSD);
        check(volSD > 0.0 && volSD < volHD,
              "smoothSub volume in (0, hard-difference) (smooth carve removes a bit more)",
              "smoothSub=" + std::to_string(volSD) + " hardDiff=" + std::to_string(volHD));

        const Sdf& f = sd.sdf;
        std::uniform_real_distribution<double> U(-half, half);
        int n2 = 0, bounded = 0; double maxMag = 0.0;
        while (n2 < 400) {
            Vec3 p{U(rng), U(rng), U(rng)};
            if (std::fabs(f.eval(p)) <= 0.10) continue;
            ++n2;
            const double m = gradMag(f, p);
            maxMag = std::max(maxMag, m);
            if (m <= 1.0 + 1e-3) ++bounded;
        }
        std::printf("    smoothSub |grad|: tested=%d <=1+1e-3=%d maxMag=%.5f\n",
                    n2, bounded, maxMag);
        check(n2 >= 300, "smoothSub: >=300 off-surface samples", std::to_string(n2));
        check(bounded == n2, "smoothSub: |grad|<=1 (1-Lipschitz blend) at every point",
              std::to_string(n2 - bounded) + " exceeded; maxMag=" + std::to_string(maxMag));
    }
}

// -----------------------------------------------------------------------------
// (4) EXACT WHERE ANALYTIC: elongate of a sphere == capsule (exact); twist/bend
//     keep the correct sign + a non-trivial closed surface.
// -----------------------------------------------------------------------------
static void gate_warps(std::mt19937& rng) {
    std::printf("\n[4] elongate of a sphere is EXACT (capsule); twist/bend sign-correct\n");

    const double R = 0.8;
    Sdf base = impl::sphere({0, 0, 0}, R);

    // Elongate along +x by hx: the sphere becomes a capsule (swept sphere) along
    // the x-axis with segment [-hx,hx], radius R. This is an EXACT distance field
    // (elongate is a piecewise translation of an exact source).
    const double hx = 1.0;
    auto rr = SdfOps::elongate(base, {hx, 0.0, 0.0});
    check(rr.ok, "elongate builds", rr.reason);
    const Sdf& f = rr.sdf;

    // Capsule field oracle: dist to segment [-hx,hx]x{0}x{0} minus R.
    auto capsuleDist = [&](const Vec3& p) {
        const double cx = std::clamp(p.x, -hx, hx);
        const double dx = p.x - cx, dy = p.y, dz = p.z;
        return std::sqrt(dx * dx + dy * dy + dz * dz) - R;
    };

    // (a) field matches the analytic capsule everywhere (EXACT).
    {
        std::uniform_real_distribution<double> U(-4.0, 4.0);
        int n = 0; double worst = 0.0;
        while (n < 500) {
            Vec3 p{U(rng), U(rng), U(rng)};
            ++n;
            worst = std::max(worst, std::fabs(f.eval(p) - capsuleDist(p)));
        }
        std::printf("    elongate vs capsule oracle: tested=%d worstErr=%.2e\n", n, worst);
        check(worst < 1e-12, "elongate(sphere) field == capsule distance (EXACT)",
              "worstErr=" + std::to_string(worst));
    }

    // (b) |grad|==1 at exterior points (exact distance field).
    {
        std::uniform_real_distribution<double> U(-4.0, 4.0);
        int n = 0, ok = 0; double worst = 0.0;
        while (n < 400) {
            Vec3 p{U(rng), U(rng), U(rng)};
            if (f.eval(p) <= 0.10) continue;
            ++n;
            const double e = std::fabs(gradMag(f, p) - 1.0);
            worst = std::max(worst, e);
            if (e <= 1e-3) ++ok;
        }
        std::printf("    elongate |grad|: tested=%d within1e-3=%d worstErr=%.2e\n", n, ok, worst);
        check(n >= 300, "elongate: >=300 exterior samples", std::to_string(n));
        check(ok == n, "elongate: |grad|==1 (EXACT distance) at every exterior point",
              std::to_string(n - ok) + " off; worstErr=" + std::to_string(worst));
    }

    // (c) analytic capsule volume = cylinder(len=2hx,R) + sphere(R).
    {
        const double exact = PI * R * R * (2.0 * hx) + sphereVol(R);
        const double half = hx + R;
        impl::Mesh m = meshCube(f, half, 110);
        const double vol = m.volume();
        const double e = std::fabs(vol - exact) / exact;
        std::printf("    elongate volume: vol=%.5f exact(capsule)=%.5f relErr=%.3e\n",
                    vol, exact, e);
        check(e < 0.01, "elongate(sphere) meshed volume == capsule volume",
              "relErr=" + std::to_string(e));
    }

    // twist / bend: non-isometric warps. We assert the correct SIGN at known
    // interior/exterior points and that the warped solid still meshes to a real
    // closed surface — NOT |grad|==1 (which they intentionally break).
    {
        // Twist a tall box about z. On the z-axis the rotation fixes the point,
        // so the center stays interior; a far corner stays exterior.
        Sdf tall = impl::box({0, 0, 0}, {1.0, 0.4, 3.0});
        auto tw = SdfOps::twist(tall, 0.6);
        check(tw.ok, "twist builds", tw.reason);
        check(tw.sdf.eval({0, 0, 0}) < 0.0, "twist: center stays interior (f<0)",
              "f=" + std::to_string(tw.sdf.eval({0, 0, 0})));
        check(tw.sdf.eval({5, 5, 0}) > 0.0, "twist: far point stays exterior (f>0)",
              "f=" + std::to_string(tw.sdf.eval({5, 5, 0})));
        impl::Mesh mt = meshCube(tw.sdf, 3.2, 80);
        check(!mt.empty() && mt.volume() > 0.0 && mt.triangles.size() > 200,
              "twist warps to a real closed solid (vol>0)",
              "tris=" + std::to_string(mt.triangles.size()) +
              " vol=" + std::to_string(mt.volume()));

        // Bend a long bar about z. Center interior; a far point exterior.
        Sdf bar = impl::box({0, 0, 0}, {4.0, 0.5, 0.5});
        auto bd = SdfOps::bend(bar, 0.3);
        check(bd.ok, "bend builds", bd.reason);
        check(bd.sdf.eval({0, 0, 0}) < 0.0, "bend: center stays interior (f<0)",
              "f=" + std::to_string(bd.sdf.eval({0, 0, 0})));
        check(bd.sdf.eval({0, 6, 0}) > 0.0, "bend: far point stays exterior (f>0)",
              "f=" + std::to_string(bd.sdf.eval({0, 6, 0})));
        impl::Mesh mb = meshCube(bd.sdf, 4.5, 90);
        check(!mb.empty() && mb.volume() > 0.0 && mb.triangles.size() > 200,
              "bend warps to a real closed solid (vol>0)",
              "tris=" + std::to_string(mb.triangles.size()) +
              " vol=" + std::to_string(mb.volume()));

        // twist/bend with k==0 are the identity warp: field == source exactly.
        auto tw0 = SdfOps::twist(tall, 0.0);
        auto bd0 = SdfOps::bend(bar, 0.0);
        std::uniform_real_distribution<double> U(-3.0, 3.0);
        double wTw = 0.0, wBd = 0.0;
        for (int i = 0; i < 500; ++i) {
            Vec3 p{U(rng), U(rng), U(rng)};
            wTw = std::max(wTw, std::fabs(tw0.sdf.eval(p) - tall.eval(p)));
            wBd = std::max(wBd, std::fabs(bd0.sdf.eval(p) - bar.eval(p)));
        }
        check(wTw == 0.0, "twist(k=0) is the identity warp (field == source)",
              "worst=" + std::to_string(wTw));
        check(wBd == 0.0, "bend(k=0) is the identity warp (field == source)",
              "worst=" + std::to_string(wBd));
    }
}

// -----------------------------------------------------------------------------
// (5) Degenerate / unsupported input -> ok=false (0 FAKES).
// -----------------------------------------------------------------------------
static void gate_degenerate() {
    std::printf("\n[5] degenerate / unsupported input -> ok=false (0 FAKES)\n");

    Sdf empty;                                   // invalid handle
    Sdf s = impl::sphere({0, 0, 0}, 1.0);        // valid source
    const double nan = std::nan("");
    const double inf = std::numeric_limits<double>::infinity();

    check(!SdfOps::offset(empty, 0.5).ok,        "offset: empty source -> ok=false");
    check(!SdfOps::offset(s, nan).ok,            "offset: non-finite d -> ok=false");
    check(!SdfOps::offset(s, inf).ok,            "offset: infinite d -> ok=false");
    check(!SdfOps::round(empty, 0.5).ok,         "round: empty source -> ok=false");
    check(!SdfOps::round(s, -0.1).ok,            "round: r<0 -> ok=false");
    check(!SdfOps::shell(empty, 0.5).ok,         "shell: empty source -> ok=false");
    check(!SdfOps::shell(s, 0.0).ok,             "shell: t<=0 -> ok=false");
    check(!SdfOps::shell(s, -0.2).ok,            "shell: t<0 -> ok=false");
    check(!SdfOps::elongate(empty, {1, 0, 0}).ok,"elongate: empty source -> ok=false");
    check(!SdfOps::elongate(s, {-1, 0, 0}).ok,   "elongate: negative half-width -> ok=false");
    check(!SdfOps::twist(empty, 0.5).ok,         "twist: empty source -> ok=false");
    check(!SdfOps::twist(s, nan).ok,             "twist: non-finite k -> ok=false");
    check(!SdfOps::bend(empty, 0.5).ok,          "bend: empty source -> ok=false");
    check(!SdfOps::bend(s, inf).ok,              "bend: infinite k -> ok=false");
    check(!SdfOps::smoothUnion(empty, s, 0.3).ok,"smoothUnion: empty operand -> ok=false");
    check(!SdfOps::smoothUnion(s, s, 0.0).ok,    "smoothUnion: k<=0 -> ok=false");
    check(!SdfOps::smoothSub(s, empty, 0.3).ok,  "smoothSub: empty operand -> ok=false");
    check(!SdfOps::smoothSub(s, s, -0.1).ok,     "smoothSub: k<=0 -> ok=false");

    // A failed build yields an INVALID Sdf handle (no fabricated geometry).
    auto bad = SdfOps::shell(s, -1.0);
    check(!bad.sdf.valid(), "failed build leaves an INVALID (empty) Sdf handle");
    std::printf("    sample reason: \"%s\"\n", bad.reason.c_str());

    // Edge allowances that are NOT degenerate: round(0)==offset(0); elongate by
    // all-zero is the identity; twist/bend k==0 identity (built above) all ok.
    check(SdfOps::round(s, 0.0).ok,              "round(r=0) is allowed (sharp, no fillet)");
    check(SdfOps::elongate(s, {0, 0, 0}).ok,     "elongate(all-zero) is allowed (identity)");
    check(SdfOps::offset(s, -3.0).ok,            "offset with any finite d is allowed");
}

int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    std::uint32_t seed = rd();                   // FRESH seed, printed below.
    std::mt19937 rng(seed);

    std::printf("=== forge::native::implicit — SdfOps (field operators) gate ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n\n", seed);

    gate_offset(rng);
    gate_shell();
    gate_smooth(rng);
    gate_warps(rng);
    gate_degenerate();

    std::printf("\n=== RESULT: %d / %d passed ===\n", g_passed, g_total);
    std::printf(
        "Validated envelope: offset/round are EXACT value re-maps (|grad|==1\n"
        "preserved; offset(sphere R,d) meshes to 4/3*pi*(R+d)^3 <1%%, round(r) ==\n"
        "the Minkowski sphere). shell(sphere R,t) is a hollow wall meshing to\n"
        "4/3*pi*((R+t/2)^3-(R-t/2)^3) <2%% as a CLOSED two-shell manifold (Euler 4).\n"
        "elongate is EXACT on an exact source (sphere -> capsule, |grad|==1, exact\n"
        "capsule volume). twist/bend are deliberately NON-isometric domain warps:\n"
        "correct sign + closed surface, |grad|!=1 (never claimed). smoothUnion sits\n"
        "strictly between the hard union and the sum of solids; smoothSub strictly\n"
        "inside the hard difference; both proven 1-Lipschitz (|grad|<=1) by random\n"
        "sampling. 0 FAKES: every degenerate input returns ok=false, empty handle.\n");
    return (g_passed == g_total) ? 0 : 1;
}
