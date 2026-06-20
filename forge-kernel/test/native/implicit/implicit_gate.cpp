// forge/native/implicit/implicit_gate.cpp
//
// Standalone validation gate for the in-house implicit / F-rep class
// (forge::native::implicit) — Stage 4 of KERNEL_INHOUSE_ROADMAP.md.
//
// Build & run (no deps, pure C++20):
//   clang++ -std=c++20 -O2 -I <forge-kernel/include> \
//       src/native/implicit/SdfTree.cpp \
//       src/native/implicit/IsoMesher.cpp \
//       test/native/implicit/implicit_gate.cpp \
//       -o /tmp/implicit_test && /tmp/implicit_test
//
// Gates (from the roadmap + the increment spec):
//   (a) Marched SDF sphere volume CONVERGES to 4/3·π·r³ as grid resolution rises
//       (error must SHRINK monotonically across resolutions, and be within a
//       stated tolerance at the finest level).
//   (b) CSG "box minus sphere" produces a non-empty, sensible mesh.
//   (c) smooth-min of two spheres produces a BLENDED (non-sharp) surface,
//       verified by a sampled-distance check against the sharp union.
//
// Every assertion prints PASS/FAIL with the measured number. No faked success.

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/native/implicit/SdfTree.hpp"
#include "forge/native/implicit/IsoMesher.hpp"

using namespace forge::native::implicit;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name, const std::string& detail) {
    ++g_total;
    if (cond) {
        ++g_pass;
        std::printf("  [PASS] %s — %s\n", name.c_str(), detail.c_str());
    } else {
        std::printf("  [FAIL] %s — %s\n", name.c_str(), detail.c_str());
    }
}

static constexpr double PI = 3.14159265358979323846;

// ---------------------------------------------------------------------------
// Gate (a): sphere volume convergence
// ---------------------------------------------------------------------------
static void gate_sphere_convergence() {
    std::printf("Gate (a): SDF sphere volume converges to 4/3·π·r³\n");

    const double r = 1.0;
    const double exact = 4.0 / 3.0 * PI * r * r * r;
    // Sampling box a little larger than the sphere so the surface is interior
    // to the grid (closed mesh, no boundary clipping).
    const Vec3 lo{-1.5, -1.5, -1.5};
    const Vec3 hi{1.5, 1.5, 1.5};

    Sdf s = sphere({0, 0, 0}, r);

    const std::vector<int> resolutions = {8, 16, 32, 64};
    std::vector<double> relErr;
    std::vector<int> triCount;
    for (int n : resolutions) {
        Mesh m = IsoMesher::marchCubic(s, lo, hi, n);
        const double vol = m.volume();
        const double err = std::fabs(vol - exact) / exact;
        relErr.push_back(err);
        triCount.push_back(static_cast<int>(m.triangles.size()));
        std::printf("    n=%2d  tris=%6zu  volume=%.6f  exact=%.6f  relErr=%.3e\n",
                    n, m.triangles.size(), vol, exact, err);
    }

    // The mesh must be non-empty and the volume must be positive (correct
    // winding/orientation) at every resolution.
    bool allPositive = true;
    for (size_t i = 0; i < resolutions.size(); ++i) {
        Mesh m = IsoMesher::marchCubic(s, lo, hi, resolutions[i]);
        if (m.empty() || m.volume() <= 0.0) allPositive = false;
    }
    check(allPositive, "sphere mesh non-empty & positively oriented",
          "volume > 0 and tris > 0 at every resolution");

    // Convergence: error must STRICTLY shrink as resolution rises.
    bool monotone = true;
    for (size_t i = 1; i < relErr.size(); ++i)
        if (!(relErr[i] < relErr[i - 1])) monotone = false;
    check(monotone, "relative error shrinks with resolution",
          "relErr[8]=" + std::to_string(relErr[0]) +
          " > relErr[16]=" + std::to_string(relErr[1]) +
          " > relErr[32]=" + std::to_string(relErr[2]) +
          " > relErr[64]=" + std::to_string(relErr[3]));

    // Finest-level tolerance: marching cubes is O(h^2); at n=64 over a span of 3
    // (h ≈ 0.047) we expect well under 1% relative error.
    const double finest = relErr.back();
    check(finest < 0.01, "finest-resolution volume within 1% of analytic",
          "relErr[64]=" + std::to_string(finest) + " < 0.01");
}

// ---------------------------------------------------------------------------
// Gate (b): CSG "box minus sphere"
// ---------------------------------------------------------------------------
static void gate_csg_difference() {
    std::printf("Gate (b): CSG box minus sphere is non-empty & sensible\n");

    // Unit-ish box [-1,1]^3 (volume 8) with a sphere of radius 0.8 drilled out
    // of the center.
    const double boxVol = 2.0 * 2.0 * 2.0;
    const double rSphere = 0.8;
    const double sphereVol = 4.0 / 3.0 * PI * rSphere * rSphere * rSphere;
    const double expected = boxVol - sphereVol;

    Sdf b = box({0, 0, 0}, {2, 2, 2});
    Sdf s = sphere({0, 0, 0}, rSphere);
    Sdf cut = differenceOp(b, s);

    // Sample box must contain the whole box surface; pad slightly.
    const Vec3 lo{-1.2, -1.2, -1.2};
    const Vec3 hi{1.2, 1.2, 1.2};
    Mesh m = IsoMesher::marchCubic(cut, lo, hi, 64);

    std::printf("    tris=%zu verts=%zu  volume=%.4f  expected≈%.4f (box %.1f - sphere %.4f)\n",
                m.triangles.size(), m.positions.size(), m.volume(), expected, boxVol, sphereVol);

    check(!m.empty(), "box-minus-sphere mesh is non-empty",
          std::to_string(m.triangles.size()) + " triangles");

    // The cavity must actually be carved: the resulting volume should be clearly
    // less than the solid box and clearly more than zero, and within a sensible
    // band of the analytic difference (marching-cubes box facets soften the
    // hard edges, so we allow a generous 10% band — this is a "sensible", not
    // an exact, check).
    const double vol = m.volume();
    bool sensible = vol > 0.0 && vol < boxVol &&
                    std::fabs(vol - expected) / expected < 0.10;
    check(sensible, "carved volume is sensible (cavity present, ~analytic)",
          "volume=" + std::to_string(vol) + " in (0, " + std::to_string(boxVol) +
          "), |err|/exp=" + std::to_string(std::fabs(vol - expected) / expected));

    // The center of the cut must be EMPTY (inside the drilled sphere => f>0,
    // i.e. outside the solid). The corner of the box must be SOLID (f<0).
    const double fCenter = cut.eval({0, 0, 0});
    const double fCorner = cut.eval({0.95, 0.95, 0.95});
    check(fCenter > 0.0 && fCorner < 0.0,
          "field classifies cavity vs solid correctly",
          "f(center)=" + std::to_string(fCenter) + " (>0 empty), f(corner)=" +
          std::to_string(fCorner) + " (<0 solid)");
}

// ---------------------------------------------------------------------------
// Gate (c): smooth-min blend of two spheres
// ---------------------------------------------------------------------------
static void gate_smooth_blend() {
    std::printf("Gate (c): smooth-min of two spheres produces a blended surface\n");

    // Two unit spheres whose surfaces nearly touch, so a smooth union creates a
    // visible neck/fillet between them.
    const double r = 1.0;
    const Vec3 cA{-0.9, 0, 0};
    const Vec3 cB{0.9, 0, 0};
    Sdf a = sphere(cA, r);
    Sdf bb = sphere(cB, r);

    const double k = 0.6; // blend radius
    Sdf sharp = unionOp(a, bb);
    Sdf blend = smoothUnionOp(a, bb, k);

    // The midpoint between the spheres (0,0,0) is the seam. For the sharp union
    // the field there is just min of the two sphere distances; the smooth union
    // ROUNDS the field outward (more negative / further inside), producing
    // material in the neck where the sharp union had none or a crease.
    const Vec3 seam{0, 0, 0};
    const double fSharp = sharp.eval(seam);
    const double fBlend = blend.eval(seam);
    std::printf("    at seam (0,0,0): f_sharp=%.4f  f_blend=%.4f  (blend should be < sharp)\n",
                fSharp, fBlend);

    // Smooth-min subtracts a positive bump, so the blended field is strictly
    // LESS than the sharp min wherever both fields are comparable — this is the
    // signature of the rounded blend (it fills in the seam).
    check(fBlend < fSharp - 1e-9,
          "smooth field is rounded below sharp min at the seam",
          "f_blend=" + std::to_string(fBlend) + " < f_sharp=" + std::to_string(fSharp));

    // Curvature / non-sharpness check: sample the surface crossing along the
    // seam plane (the y-profile at x=0 where the field is zero). For a SHARP
    // union the union surface at x=0 has a crease (the two spheres meet at an
    // angle); for the smooth union the zero crossing bulges OUTWARD in y,
    // i.e. the smooth surface reaches a larger |y| at x=0 than the sharp one.
    auto surfaceY = [](const Sdf& f) -> double {
        // March outward in +y at x=z=0 to find the zero crossing radius.
        double lo = 0.0, hiB = 3.0;
        // Ensure sign change (inside at y=0, outside far away).
        for (int it = 0; it < 60; ++it) {
            double mid = 0.5 * (lo + hiB);
            if (f.eval({0, mid, 0}) < 0.0) lo = mid; else hiB = mid;
        }
        return 0.5 * (lo + hiB);
    };
    const double ySharp = surfaceY(sharp);
    const double yBlend = surfaceY(blend);
    std::printf("    seam-plane surface radius in +y: sharp=%.4f  blend=%.4f (blend larger => bulged neck)\n",
                ySharp, yBlend);
    check(yBlend > ySharp + 1e-4,
          "blended surface bulges outward at the seam (non-sharp neck)",
          "y_blend=" + std::to_string(yBlend) + " > y_sharp=" + std::to_string(ySharp));

    // And the meshed blend must be a real, non-empty mesh.
    Mesh m = IsoMesher::marchCubic(blend, {-2.2, -2.0, -2.0}, {2.2, 2.0, 2.0}, 64);
    std::printf("    meshed blend: tris=%zu volume=%.4f\n", m.triangles.size(), m.volume());
    check(!m.empty() && m.volume() > 0.0, "smooth-union meshes to a real solid",
          std::to_string(m.triangles.size()) + " tris, volume " +
          std::to_string(m.volume()));
}

// ---------------------------------------------------------------------------
// Sanity: analytic primitive fields (cheap, anchors the gate)
// ---------------------------------------------------------------------------
static void gate_primitive_fields() {
    std::printf("Primitive analytic distance sanity\n");
    Sdf s = sphere({0, 0, 0}, 2.0);
    // |(3,0,0)| - 2 = 1 ; center => -2 ; on surface => 0
    check(std::fabs(s.eval({3, 0, 0}) - 1.0) < 1e-12, "sphere exterior distance",
          "f(3,0,0)=" + std::to_string(s.eval({3, 0, 0})));
    check(std::fabs(s.eval({0, 0, 0}) + 2.0) < 1e-12, "sphere center distance",
          "f(0,0,0)=" + std::to_string(s.eval({0, 0, 0})));

    Sdf p = plane({0, 0, 1}, 0.0); // z=0 plane, solid is z<0
    check(std::fabs(p.eval({5, -3, 2}) - 2.0) < 1e-12, "plane distance (unit normal)",
          "f=" + std::to_string(p.eval({5, -3, 2})));
    // Non-unit normal must be normalised internally.
    Sdf p2 = plane({0, 0, 3}, 6.0); // same as z=2 plane
    check(std::fabs(p2.eval({0, 0, 5}) - 3.0) < 1e-12, "plane normalises non-unit normal",
          "f=" + std::to_string(p2.eval({0, 0, 5})));

    Sdf b = box({0, 0, 0}, {2, 2, 2}); // half-extent 1
    check(std::fabs(b.eval({2, 0, 0}) - 1.0) < 1e-12, "box exterior distance (axis)",
          "f(2,0,0)=" + std::to_string(b.eval({2, 0, 0})));
    check(b.eval({0, 0, 0}) < 0.0, "box interior is negative",
          "f(0,0,0)=" + std::to_string(b.eval({0, 0, 0})));
}

int main() {
    std::printf("=== forge::native::implicit — Stage 4 validation gate ===\n\n");

    gate_primitive_fields();
    std::printf("\n");
    gate_sphere_convergence();
    std::printf("\n");
    gate_csg_difference();
    std::printf("\n");
    gate_smooth_blend();

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
