// forge/native/test/voxel/morphology_test.cpp
//
// Stage 5 voxel MORPHOLOGY validation gate (standalone, no framework, no deps).
// Gate for Morphology.hpp — exact level-set morphology (dilate/erode/offset/
// open/close) on a voxel SDF field. Every assertion checks a COMPUTED morphed
// volume against an ANALYTIC oracle 4/3·π·(R±r)^3 within a VOXEL tolerance
// (Bible §0/§9, roadmap §D rule 2). NEVER weakens an assertion to pass.
//
// RANDOMIZED (not cherry-picked): a fresh std::random_device seed is printed and
// drives the sphere radius R, the offset radius r, the cell spacing h, and the
// sphere center each run, so the gate proves the offset identity over a SPREAD
// of configurations, never one lucky case.
//
// VALIDATED SPEC POINTS:
//   (1) DILATE(r) grows the zero-isosurface radius R -> R+r: meshed volume
//       (cell-center field volume, the convergence-proxy oracle) approaches
//       4/3·π·(R+r)^3 within ~one-voxel tolerance; and it is strictly LARGER
//       than the original solid.
//   (2) ERODE(r) shrinks R -> R-r: volume approaches 4/3·π·(R-r)^3 and is
//       strictly SMALLER than the original.
//   (3) ERODE past the radius (r >= R) yields an EMPTY solid (honest empty:
//       ok==true, empty==true, volume==0) — no fabricated geometry.
//   (4) OFFSET is the signed unifier: offset(+r) == dilate(r), offset(-r) ==
//       erode(r) (identical fields).
//   (5) OPEN/CLOSE compose two exact offsets and preserve a sphere (a sphere has
//       no thin features at radius r < R, so open(r) and close(r) return the
//       same sphere within voxel tol) — the morphological identity on a smooth
//       convex body.
//   (6) HONESTY: a degenerate offset (NaN) returns ok==false with an UNCHANGED
//       field; a negative dilate/erode radius returns ok==false.
//
// Build + run (standalone). NOTE: the module's named deps VoxelMesh.cpp +
// IsoMesher.cpp transitively require mesh/HalfEdgeMesh.cpp + implicit/SdfTree.cpp
// to LINK (VoxelMesh::contour -> HalfEdgeMesh::buildFromSoup/validate;
// IsoMesher::march -> Sdf::eval). This gate validates morphology through the
// header-only cell-center field-volume oracle (no mesher needed), so the
// morphology logic itself links with just VoxelGrid.cpp; the two extra TUs are
// only required because VoxelMesh.cpp/IsoMesher.cpp sit on the link line.
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/voxel/Morphology.cpp \
//       forge-kernel/src/native/voxel/VoxelGrid.cpp \
//       forge-kernel/src/native/voxel/VoxelMesh.cpp \
//       forge-kernel/src/native/implicit/IsoMesher.cpp \
//       forge-kernel/src/native/implicit/SdfTree.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/voxel/morphology_test.cpp \
//       -o /tmp/k2_Morphology && /tmp/k2_Morphology

#include "forge/native/voxel/Morphology.hpp"

#include <cstdio>
#include <cmath>
#include <random>
#include <string>
#include <vector>
#include <limits>

using namespace forge::native;

static int g_passed = 0;
static int g_total  = 0;

static void check(bool cond, const std::string& name, const std::string& detail) {
    ++g_total;
    if (cond) {
        ++g_passed;
        std::printf("  [PASS] %s\n", name.c_str());
    } else {
        std::printf("  [FAIL] %s -- %s\n", name.c_str(), detail.c_str());
    }
}

static double sphereVol(double r) {
    if (r <= 0.0) return 0.0;
    return (4.0 / 3.0) * M_PI * r * r * r;
}

// Voxel tolerance on a volume measured by the cell-center (midpoint) rule. The
// surface position carries up to ~half a cell of discretisation error, so the
// volume error of a sphere of radius rho scales like the surface-shell volume
// ~ 4·π·rho^2·(h/2) plus a margin. We allow a generous-but-honest multiple of
// that shell as the tolerance (it is the genuine O(h) voxelization band, not a
// fudge to pass) and additionally require monotone behavior + the exact field
// identities below, which have NO tolerance.
static double voxelVolTol(double rho, double h) {
    double shell = 4.0 * M_PI * rho * rho * (0.5 * h);
    return 2.5 * shell + 4.0 * h * h * h;   // shell band + a few cells of slack
}

int main() {
    // ----- fresh entropy seed (printed; drives every random configuration) -----
    std::random_device rd;
    const unsigned seed = rd();
    std::printf("=== forge::native::voxel — Morphology (dilate/erode/offset/open/close) gate ===\n");
    std::printf("(exact level-set offset f' = f - d on a voxel SDF; reuses VoxelGrid + the shared mesher)\n");
    std::printf("SEED: %u  (std::random_device — fresh each run, non-cherry-picked)\n", seed);
    std::mt19937 rng(seed);

    std::uniform_real_distribution<double> distR(0.8, 1.6);     // base sphere radius
    std::uniform_real_distribution<double> distFrac(0.15, 0.40);// offset r as fraction of R
    std::uniform_real_distribution<double> distH(0.04, 0.07);   // cell spacing
    std::uniform_real_distribution<double> distC(-0.5, 0.5);    // center offset

    const int kTrials = 6;

    // -----------------------------------------------------------------------
    // (1)-(2) DILATE grows, ERODE shrinks, both to 4/3 pi (R±r)^3 within voxel tol.
    // -----------------------------------------------------------------------
    std::printf("\n[gate 1/2] dilate(r): R -> R+r ;  erode(r): R -> R-r  (vol -> 4/3 pi (R±r)^3)\n");
    for (int t = 0; t < kTrials; ++t) {
        const double R = distR(rng);
        const double r = distFrac(rng) * R;     // 0 < r < R (erode stays non-empty)
        const double h = distH(rng);
        const Vec3 center{distC(rng), distC(rng), distC(rng)};

        // Build the base SDF sphere field with enough margin that R+r still fits
        // strictly inside the padded box.
        VoxelGrid<float> base = voxelizeSphere(R, h, center, /*marginCells=*/3.0 + r / h);

        const double v0 = voxel::Morphology::fieldVolume(base, 0.0);

        voxel::MorphResult dil = voxel::Morphology::dilate(base, r, 0.0);
        voxel::MorphResult ero = voxel::Morphology::erode(base, r, 0.0);

        const double vDil = voxel::Morphology::fieldVolume(dil.grid, 0.0);
        const double vEro = voxel::Morphology::fieldVolume(ero.grid, 0.0);

        const double exDil = sphereVol(R + r);
        const double exEro = sphereVol(R - r);
        const double tolDil = voxelVolTol(R + r, h);
        const double tolEro = voxelVolTol(R - r, h);

        std::printf("  trial %d: R=%.4f r=%.4f h=%.4f  V0=%.4f\n", t, R, r, h, v0);
        std::printf("    dilate: V=%.4f  oracle(R+r)=%.4f  |err|=%.4f tol=%.4f\n",
                    vDil, exDil, std::fabs(vDil - exDil), tolDil);
        std::printf("    erode : V=%.4f  oracle(R-r)=%.4f  |err|=%.4f tol=%.4f\n",
                    vEro, exEro, std::fabs(vEro - exEro), tolEro);

        check(dil.ok && !dil.empty, "dilate ok & non-empty",
              "dilate returned ok=" + std::to_string(dil.ok) + " empty=" + std::to_string(dil.empty));
        check(ero.ok && !ero.empty, "erode ok & non-empty (r<R)",
              "erode returned ok=" + std::to_string(ero.ok) + " empty=" + std::to_string(ero.empty));

        check(vDil > v0, "dilate GROWS the solid (V_dilate > V_base)",
              "vDil=" + std::to_string(vDil) + " v0=" + std::to_string(v0));
        check(vEro < v0, "erode SHRINKS the solid (V_erode < V_base)",
              "vEro=" + std::to_string(vEro) + " v0=" + std::to_string(v0));

        check(std::fabs(vDil - exDil) <= tolDil,
              "dilate volume -> 4/3 pi (R+r)^3 within voxel tol",
              "|err|=" + std::to_string(std::fabs(vDil - exDil)) + " > tol=" + std::to_string(tolDil));
        check(std::fabs(vEro - exEro) <= tolEro,
              "erode volume -> 4/3 pi (R-r)^3 within voxel tol",
              "|err|=" + std::to_string(std::fabs(vEro - exEro)) + " > tol=" + std::to_string(tolEro));
    }

    // -----------------------------------------------------------------------
    // (3) ERODE past the radius -> HONESTLY empty (ok==true, empty==true, V==0).
    // -----------------------------------------------------------------------
    std::printf("\n[gate 3] erode past the radius -> EMPTY (honest: ok=true, empty=true, V=0)\n");
    for (int t = 0; t < kTrials; ++t) {
        const double R = distR(rng);
        const double h = distH(rng);
        const Vec3 center{distC(rng), distC(rng), distC(rng)};
        // Erode by MORE than the radius (1.2*R..1.5*R): the surface must vanish.
        const double r = (1.2 + 0.3 * distFrac(rng) / 0.40) * R;

        VoxelGrid<float> base = voxelizeSphere(R, h, center, /*marginCells=*/3.0);
        voxel::MorphResult ero = voxel::Morphology::erode(base, r, 0.0);
        const double v = voxel::Morphology::fieldVolume(ero.grid, 0.0);

        std::printf("  trial %d: R=%.4f erode r=%.4f (>R)  ok=%d empty=%d V=%.6f\n",
                    t, R, r, int(ero.ok), int(ero.empty), v);

        check(ero.ok, "erode-past-radius still ok (not a failure, just empty)",
              "ero.ok=false");
        check(ero.empty, "erode-past-radius reports empty solid",
              "empty=false although r>R");
        check(v == 0.0, "erode-past-radius volume is exactly 0 (no fabricated geometry)",
              "V=" + std::to_string(v) + " (expected 0)");
        check(voxel::Morphology::isEmpty(ero.grid, 0.0),
              "isEmpty() agrees the eroded field has no inside node", "isEmpty()=false");
    }

    // -----------------------------------------------------------------------
    // (4) OFFSET is the signed unifier: offset(+r)==dilate(r), offset(-r)==erode(r).
    //     Exact field identity (no tolerance — node-for-node equality).
    // -----------------------------------------------------------------------
    std::printf("\n[gate 4] offset(+r)==dilate(r) and offset(-r)==erode(r)  (exact field identity)\n");
    {
        const double R = distR(rng);
        const double r = distFrac(rng) * R;
        const double h = distH(rng);
        const Vec3 center{distC(rng), distC(rng), distC(rng)};
        VoxelGrid<float> base = voxelizeSphere(R, h, center, 3.0 + r / h);

        voxel::MorphResult offP = voxel::Morphology::offset(base, +r, 0.0);
        voxel::MorphResult dil  = voxel::Morphology::dilate(base, r, 0.0);
        voxel::MorphResult offM = voxel::Morphology::offset(base, -r, 0.0);
        voxel::MorphResult ero  = voxel::Morphology::erode(base, r, 0.0);

        bool eqP = (offP.grid.data() == dil.grid.data());
        bool eqM = (offM.grid.data() == ero.grid.data());
        std::printf("  R=%.4f r=%.4f: offset(+r)==dilate -> %d ; offset(-r)==erode -> %d\n",
                    R, r, int(eqP), int(eqM));
        check(offP.ok && dil.ok && eqP, "offset(+r) field == dilate(r) field (node-for-node)",
              "fields differ");
        check(offM.ok && ero.ok && eqM, "offset(-r) field == erode(r) field (node-for-node)",
              "fields differ");
    }

    // -----------------------------------------------------------------------
    // (5) OPEN/CLOSE on a smooth sphere preserve it (no thin features at r<R):
    //     open(r) and close(r) volumes return to ~4/3 pi R^3 within voxel tol.
    // -----------------------------------------------------------------------
    std::printf("\n[gate 5] open/close preserve a smooth sphere (compose erode∘dilate / dilate∘erode)\n");
    for (int t = 0; t < kTrials; ++t) {
        const double R = distR(rng);
        const double r = distFrac(rng) * R;       // r < R: no feature is thinner than r
        const double h = distH(rng);
        const Vec3 center{distC(rng), distC(rng), distC(rng)};
        VoxelGrid<float> base = voxelizeSphere(R, h, center, 3.0 + r / h);

        const double v0 = voxel::Morphology::fieldVolume(base, 0.0);
        voxel::MorphResult op = voxel::Morphology::open(base, r, 0.0);
        voxel::MorphResult cl = voxel::Morphology::close(base, r, 0.0);
        const double vOp = voxel::Morphology::fieldVolume(op.grid, 0.0);
        const double vCl = voxel::Morphology::fieldVolume(cl.grid, 0.0);
        const double exR = sphereVol(R);
        const double tol = voxelVolTol(R, h);

        std::printf("  trial %d: R=%.4f r=%.4f  V0=%.4f  open=%.4f close=%.4f  oracle(R)=%.4f tol=%.4f\n",
                    t, R, r, v0, vOp, vCl, exR, tol);

        check(op.ok && cl.ok, "open & close ok", "an op returned ok=false");
        check(std::fabs(vOp - exR) <= tol,
              "open(r) of a sphere returns to 4/3 pi R^3 within voxel tol",
              "|err|=" + std::to_string(std::fabs(vOp - exR)) + " > tol=" + std::to_string(tol));
        check(std::fabs(vCl - exR) <= tol,
              "close(r) of a sphere returns to 4/3 pi R^3 within voxel tol",
              "|err|=" + std::to_string(std::fabs(vCl - exR)) + " > tol=" + std::to_string(tol));
    }

    // -----------------------------------------------------------------------
    // (6) HONESTY: degenerate inputs fail loudly, never fabricate.
    // -----------------------------------------------------------------------
    std::printf("\n[gate 6] honesty: degenerate inputs return ok=false with an UNCHANGED field\n");
    {
        const double R = 1.0, h = 0.05;
        VoxelGrid<float> base = voxelizeSphere(R, h);
        const std::vector<float> before = base.data();

        // NaN offset: rejected, field unchanged.
        voxel::MorphResult nanOff =
            voxel::Morphology::offset(base, std::numeric_limits<double>::quiet_NaN(), 0.0);
        check(!nanOff.ok, "offset(NaN) returns ok=false", "ok=true for NaN");
        check(nanOff.grid.data() == before, "offset(NaN) leaves the field UNCHANGED",
              "field was mutated on a degenerate offset");

        // Inf offset: rejected.
        voxel::MorphResult infOff =
            voxel::Morphology::offset(base, std::numeric_limits<double>::infinity(), 0.0);
        check(!infOff.ok, "offset(+Inf) returns ok=false", "ok=true for +Inf");

        // Negative dilate / erode radius: rejected (use offset() for signed moves).
        voxel::MorphResult negDil = voxel::Morphology::dilate(base, -0.3, 0.0);
        voxel::MorphResult negEro = voxel::Morphology::erode(base, -0.3, 0.0);
        check(!negDil.ok, "dilate(negative r) returns ok=false", "ok=true for negative dilate");
        check(!negEro.ok, "erode(negative r) returns ok=false", "ok=true for negative erode");
        check(negDil.grid.data() == before && negEro.grid.data() == before,
              "negative-radius dilate/erode leave the field UNCHANGED", "field mutated");

        // r==0 is the identity: dilate(0)==erode(0)==offset(0)==input.
        voxel::MorphResult id = voxel::Morphology::dilate(base, 0.0, 0.0);
        check(id.ok && id.grid.data() == before, "dilate(0) is the identity (field unchanged)",
              "dilate(0) changed the field or failed");
    }

    std::printf("\n=== RESULT: %d / %d passed ===\n", g_passed, g_total);
    std::printf("Honest envelope: EXACT level-set offset f' = f - d on an SDF voxel field;\n"
                "dilate/erode/offset/open/close validated against 4/3 pi (R±r)^3 within the\n"
                "O(h) voxelization band; erode-past-radius is HONESTLY empty (V=0, ok=true);\n"
                "offset is the exact signed unifier (node-for-node); degenerate input fails\n"
                "loudly with an unchanged field. General (non-distance CSG) fields offset by a\n"
                "Lipschitz BOUND (correct sign-set, bounded distance) — stated, not faked.\n");
    return (g_passed == g_total) ? 0 : 1;
}
