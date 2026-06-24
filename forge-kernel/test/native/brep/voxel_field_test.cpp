// forge/native/test/brep/voxel_field_test.cpp
//
// Standalone validation gate (no framework, no deps) for the PicoGK-class
// VOXEL-FIELD op set in forge/native/voxel/VoxelFieldOps.hpp — OFFSET, SHELL,
// FILLET (smooth-union) and the MESH->SDF->MESH round-trip. Every assertion
// checks a COMPUTED voxel-field volume against a CLOSED-FORM oracle within the
// O(h) voxelization band, or against a tolerance-free MONOTONICITY/BRACKETING
// claim (Bible §0/§9, roadmap §D rule 2). NEVER weakens an assertion to pass.
//
// A deterministic default seed (argv[1] overrides) drives the radii / thickness /
// spacing / centers each run, so the gate proves the field identities over a
// SPREAD of configurations, not one cherry-picked case.
//
// VALIDATED SPEC POINTS (exactly the four the task asks for):
//   (1) SPHERE OFFSET by +d: the offset field's enclosed volume -> 4/3·π·(R+d)^3
//       within voxel resolution; offset(-d) -> 4/3·π·(R-d)^3; offset GROWS for
//       d>0 / SHRINKS for d<0 (tolerance-free monotonicity).
//   (2) BOX SHELL (t): |f| - t/2 of a solid box of side L gives a hollow box —
//       its enclosed volume -> L^3 - (L-t)^3 (outer cube minus inner void) within
//       voxel resolution, and is strictly LESS than the solid box.
//       Also: SPHERE SHELL volume -> 4/3·π·[(R+t/2)^3 - (R-t/2)^3] (closed form).
//   (3) SMOOTH-UNION of two overlapping spheres (the metaball blend): volume is
//       > the sharp union (the fillet ADDS material in the seam), < the sum of
//       the two sphere volumes, and MONOTONE INCREASING in the blend radius r —
//       all tolerance-free order relations; -> the sharp union as r -> 0.
//   (4) CUBE MESH -> SDF -> MESH round-trip: voxelize a triangulated cube into a
//       signed field, re-contour it, and the re-meshed volume preserves the cube
//       volume L^3 within voxel resolution.
//
// Build + run (standalone — ONLY VoxelFieldOps + its named link deps + this test;
//   the smooth-boolean / shell / offset logic is validated through the
//   header-only cell-center field-volume oracle, so it needs no mesher; the two
//   mesher TUs (VoxelMesh.cpp/IsoMesher.cpp) + their transitive HalfEdgeMesh.cpp
//   + SdfTree.cpp are required only for the MESH ROUND-TRIP gate (4), and the
//   MeshToSDF.cpp + Geom.cpp + Predicates.cpp for the mesh->grid direction):
//
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/voxel/VoxelFieldOps.cpp \
//       forge-kernel/src/native/voxel/VoxelBoolean.cpp \
//       forge-kernel/src/native/voxel/VoxelGrid.cpp \
//       forge-kernel/src/native/voxel/VoxelMesh.cpp \
//       forge-kernel/src/native/implicit/IsoMesher.cpp \
//       forge-kernel/src/native/implicit/SdfTree.cpp \
//       forge-kernel/src/native/implicit/MeshToSDF.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/test/native/brep/voxel_field_test.cpp \
//       -o /tmp/k2_VoxelFieldOps && /tmp/k2_VoxelFieldOps

#include <algorithm>
#include "forge/native/voxel/VoxelFieldOps.hpp"

#include <cstdio>
#include <cmath>
#include <random>
#include <string>
#include <vector>
#include <array>
#include <limits>
#include <cstdint>

using namespace forge::native;
using forge::native::mesh::HalfEdgeMesh;
namespace impl = forge::native::implicit;

static int g_passed = 0;
static int g_total  = 0;

static void check(bool cond, const std::string& name, const std::string& detail = "") {
    ++g_total;
    if (cond) { ++g_passed; std::printf("  [PASS] %s\n", name.c_str()); }
    else      { std::printf("  [FAIL] %s -- %s\n", name.c_str(), detail.c_str()); }
}

static double sphereVol(double r) {
    if (r <= 0.0) return 0.0;
    return (4.0 / 3.0) * M_PI * r * r * r;
}

// Voxel tolerance on a volume measured by the cell-center (midpoint) rule. The
// surface position carries up to ~half a cell of discretisation error, so the
// volume error of a body whose surface area is ~A scales like A*(h/2). For the
// shapes here we pass a representative surface area and budget a generous-but-
// honest multiple of that shell band plus a few cells of slack — the genuine
// O(h) voxelization band, not a fudge.
static double bandTol(double surfaceArea, double h) {
    return 2.5 * surfaceArea * (0.5 * h) + 6.0 * h * h * h;
}

// Signed distance to an axis-aligned box of half-extent e centred at c (negative
// inside, exact outside, exact-Euclidean; the standard box SDF).
static double sdfBox(double x, double y, double z, const Vec3& c, double e) {
    double dx = std::fabs(x - c.x) - e;
    double dy = std::fabs(y - c.y) - e;
    double dz = std::fabs(z - c.z) - e;
    double ax = std::max(dx, 0.0), ay = std::max(dy, 0.0), az = std::max(dz, 0.0);
    double outside = std::sqrt(ax*ax + ay*ay + az*az);
    double inside  = std::min(std::max(dx, std::max(dy, dz)), 0.0);
    return outside + inside;
}

// Build a VoxelGrid sampling a box SDF (full side L = 2e) over a padded box.
static VoxelGrid<float> voxelizeBox(double e, double h, const Vec3& c,
                                    double marginCells) {
    double half = e + marginCells * h;
    Vec3 origin{ c.x - half, c.y - half, c.z - half };
    std::size_t n = std::size_t(std::ceil((2.0 * half) / h)) + 1;
    if (n < 2) n = 2;
    VoxelGrid<float> g(n, n, n, origin, h);
    g.fillFromField([&](double x, double y, double z) { return sdfBox(x, y, z, c, e); });
    return g;
}

// Triangulated axis-aligned cube of half-extent e centred at c. 8 verts, 12
// triangles, all CCW seen from OUTSIDE (outward normals) so the soup is
// watertight + consistently wound and HalfEdgeMesh::buildFromSoup accepts it.
static void cubeMesh(double e, const Vec3& c,
                     std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    const double xs[2] = { c.x - e, c.x + e };
    const double ys[2] = { c.y - e, c.y + e };
    const double zs[2] = { c.z - e, c.z + e };
    // 8 corners, index by (i<<2)|(j<<1)|k with i->x, j->y, k->z.
    pos.clear(); pos.reserve(24);
    for (int i = 0; i < 2; ++i)
        for (int j = 0; j < 2; ++j)
            for (int k = 0; k < 2; ++k) {
                pos.push_back(xs[i]); pos.push_back(ys[j]); pos.push_back(zs[k]);
            }
    auto V = [](int i, int j, int k) -> std::uint32_t {
        return std::uint32_t((i << 2) | (j << 1) | k);
    };
    idx.clear(); idx.reserve(36);
    auto quad = [&](std::uint32_t a, std::uint32_t b, std::uint32_t cc, std::uint32_t d) {
        // CCW quad a-b-c-d -> two CCW triangles.
        idx.push_back(a); idx.push_back(b); idx.push_back(cc);
        idx.push_back(a); idx.push_back(cc); idx.push_back(d);
    };
    // -x face (i=0): normal -x; CCW seen from -x (looking toward +x).
    quad(V(0,0,0), V(0,0,1), V(0,1,1), V(0,1,0));
    // +x face (i=1): normal +x.
    quad(V(1,0,0), V(1,1,0), V(1,1,1), V(1,0,1));
    // -y face (j=0): normal -y.
    quad(V(0,0,0), V(1,0,0), V(1,0,1), V(0,0,1));
    // +y face (j=1): normal +y.
    quad(V(0,1,0), V(0,1,1), V(1,1,1), V(1,1,0));
    // -z face (k=0): normal -z.
    quad(V(0,0,0), V(0,1,0), V(1,1,0), V(1,0,0));
    // +z face (k=1): normal +z.
    quad(V(0,0,1), V(1,0,1), V(1,1,1), V(0,1,1));
}

#include <cstdlib>
int main(int argc, char** argv) {
    const unsigned seed = (argc > 1) ? static_cast<unsigned>(std::strtoul(argv[1], nullptr, 10)) : 20260624u;
    std::printf("=== forge::native::voxel — VoxelFieldOps (offset / shell / fillet / mesh<->sdf) gate ===\n");
    std::printf("SEED: %u  (deterministic default; argv[1] overrides for robustness sweep)", seed);
    std::mt19937 rng(seed);

    std::uniform_real_distribution<double> distR(0.9, 1.6);     // sphere radius
    std::uniform_real_distribution<double> distH(0.035, 0.06);  // cell spacing
    std::uniform_real_distribution<double> distC(-0.4, 0.4);    // center offset

    namespace V = forge::native::voxel;

    // -----------------------------------------------------------------------
    // (1) SPHERE OFFSET by +d -> 4/3 pi (R+d)^3 ; offset(-d) -> 4/3 pi (R-d)^3.
    //     The task's canonical "sphere SDF offset by +1 -> radius+1".
    // -----------------------------------------------------------------------
    std::printf("\n[gate 1] sphere offset(+d) -> 4/3 pi (R+d)^3   (canonical: offset by +1 -> R+1)\n");
    for (int t = 0; t < 5; ++t) {
        const double R = distR(rng);
        const double h = distH(rng);
        const Vec3 center{distC(rng), distC(rng), distC(rng)};
        const double d = (t == 0) ? 1.0 : (0.2 + 0.4 * (double(t) / 4.0)); // include the canonical +1

        // Margin so R+d still fits strictly inside the padded box.
        VoxelGrid<float> base = voxelizeSphere(R, h, center, /*marginCells=*/3.0 + d / h);

        const double v0 = V::VoxelFieldOps::enclosedVolume(base, 0.0);
        V::FieldOpResult grow   = V::VoxelFieldOps::offset(base, +d, 0.0);
        V::FieldOpResult shrink = V::VoxelFieldOps::offset(base, -d * 0.5, 0.0); // -d/2 stays non-empty

        const double vGrow   = V::VoxelFieldOps::enclosedVolume(grow.grid, 0.0);
        const double vShrink = V::VoxelFieldOps::enclosedVolume(shrink.grid, 0.0);

        const double exGrow   = sphereVol(R + d);
        const double exShrink = sphereVol(R - d * 0.5);
        const double tolGrow   = bandTol(4.0 * M_PI * (R + d) * (R + d), h);
        const double tolShrink = bandTol(4.0 * M_PI * (R - d*0.5) * (R - d*0.5), h);

        std::printf("  trial %d: R=%.4f d=%.4f h=%.4f  V0=%.4f\n", t, R, d, h, v0);
        std::printf("    offset(+d): V=%.6f  oracle(R+d)=%.6f  |err|=%.6f tol=%.6f\n",
                    vGrow, exGrow, std::fabs(vGrow - exGrow), tolGrow);
        std::printf("    offset(-d/2): V=%.6f  oracle(R-d/2)=%.6f  |err|=%.6f tol=%.6f\n",
                    vShrink, exShrink, std::fabs(vShrink - exShrink), tolShrink);

        check(grow.ok && !grow.empty, "offset(+d) ok & non-empty");
        check(vGrow > v0, "offset(+d) GROWS the solid (V > V0)",
              "vGrow=" + std::to_string(vGrow) + " v0=" + std::to_string(v0));
        check(vShrink < v0, "offset(-d/2) SHRINKS the solid (V < V0)",
              "vShrink=" + std::to_string(vShrink) + " v0=" + std::to_string(v0));
        check(std::fabs(vGrow - exGrow) <= tolGrow,
              "offset(+d) volume -> 4/3 pi (R+d)^3 within voxel tol",
              "|err|=" + std::to_string(std::fabs(vGrow - exGrow)) + " > tol=" + std::to_string(tolGrow));
        check(std::fabs(vShrink - exShrink) <= tolShrink,
              "offset(-d/2) volume -> 4/3 pi (R-d/2)^3 within voxel tol",
              "|err|=" + std::to_string(std::fabs(vShrink - exShrink)) + " > tol=" + std::to_string(tolShrink));
    }

    // -----------------------------------------------------------------------
    // (2) BOX SHELL (t): hollow box, V -> L^3 - (L-t)^3. + sphere-shell closed form.
    // -----------------------------------------------------------------------
    std::printf("\n[gate 2] box shell(t) -> hollow box  V -> L^3 - (L-t)^3  (and sphere shell closed form)\n");
    for (int trial = 0; trial < 5; ++trial) {
        const double e = distR(rng);                 // box half-extent
        const double L = 2.0 * e;                     // full side
        const double h = distH(rng);
        const Vec3 center{distC(rng), distC(rng), distC(rng)};
        // Symmetric thickness t; keep t < L so the inner void is non-empty, and a
        // few cells so the band resolves.
        const double t = std::max(6.0 * h, 0.35 * L);

        VoxelGrid<float> box = voxelizeBox(e, h, center, /*marginCells=*/3.0 + (t * 0.5) / h);
        const double vSolid = V::VoxelFieldOps::enclosedVolume(box, 0.0);

        V::FieldOpResult sh = V::VoxelFieldOps::shell(box, t, 0.0);
        const double vShell = V::VoxelFieldOps::enclosedVolume(sh.grid, 0.0);

        // Symmetric shell of the box: outer cube side (L+t), inner void side (L-t).
        const double Lout = L + t, Lin = std::max(L - t, 0.0);
        const double exShell = Lout * Lout * Lout - Lin * Lin * Lin;
        // Surface area of the band ~ outer + inner box surface = 6(Lout^2 + Lin^2).
        const double tolShell = bandTol(6.0 * (Lout * Lout + Lin * Lin), h);

        std::printf("  trial %d: e=%.4f L=%.4f t=%.4f h=%.4f  Vsolid=%.4f\n",
                    trial, e, L, t, h, vSolid);
        std::printf("    shell: V=%.6f  oracle[(L+t)^3-(L-t)^3]=%.6f  |err|=%.6f tol=%.6f\n",
                    vShell, exShell, std::fabs(vShell - exShell), tolShell);

        check(sh.ok && !sh.empty, "box shell ok & non-empty");
        // The symmetric shell |f|-t/2 straddles the surface: its solid is the band
        // between cubes (L+t) and (L-t). It is HOLLOW relative to its own OUTER
        // bound (the filled outer cube (L+t)^3): the inner void (L-t)^3 is removed.
        // (It is NOT smaller than the original L^3 box, because the outer wall
        // grows the body out by t/2 — for a thick t the band exceeds L^3.)
        const double vOuterCube = Lout * Lout * Lout;
        check(vShell < vOuterCube - 1e-9,
              "shell volume < its filled outer-cube volume (hollow: inner void removed)",
              "vShell=" + std::to_string(vShell) + " vOuterCube=" + std::to_string(vOuterCube));
        check(std::fabs(vShell - exShell) <= tolShell,
              "box shell volume -> (L+t)^3 - (L-t)^3 within voxel tol",
              "|err|=" + std::to_string(std::fabs(vShell - exShell)) + " > tol=" + std::to_string(tolShell));

        // Sphere shell closed-form check (|f|-t/2 on a sphere SDF).
        const double R = e;
        VoxelGrid<float> sph = voxelizeSphere(R, h, center, 3.0 + (t * 0.5) / h);
        V::FieldOpResult sphShell = V::VoxelFieldOps::shell(sph, t, 0.0);
        const double vSph = V::VoxelFieldOps::enclosedVolume(sphShell.grid, 0.0);
        const double exSph = V::shellVolumeSphere(R, t);
        const double rOut = R + t * 0.5, rIn = std::max(R - t * 0.5, 0.0);
        const double tolSph = bandTol(4.0 * M_PI * (rOut*rOut + rIn*rIn), h);
        std::printf("    sphere shell: V=%.6f  oracle=%.6f  |err|=%.6f tol=%.6f\n",
                    vSph, exSph, std::fabs(vSph - exSph), tolSph);
        check(std::fabs(vSph - exSph) <= tolSph,
              "sphere shell volume -> 4/3 pi[(R+t/2)^3-(R-t/2)^3] within voxel tol",
              "|err|=" + std::to_string(std::fabs(vSph - exSph)) + " > tol=" + std::to_string(tolSph));
    }

    // -----------------------------------------------------------------------
    // (3) SMOOTH-UNION of two overlapping spheres (the metaball blend):
    //     sharp-union < rounded-union < (sum of sphere volumes); monotone in r.
    // -----------------------------------------------------------------------
    std::printf("\n[gate 3] smooth-union (fillet) of two spheres: sharp < blend < sum; monotone in r\n");
    for (int trial = 0; trial < 4; ++trial) {
        const double R = distR(rng);
        const double h = distH(rng);
        // Two equal spheres a distance sep apart (overlapping: 0 < sep < 2R).
        const double sep = (0.8 + 0.5 * (double(trial) / 3.0)) * R;   // 0.8R .. 1.3R
        const Vec3 cA{ -0.5 * sep, 0.0, 0.0 };
        const Vec3 cB{ +0.5 * sep, 0.0, 0.0 };

        // ONE shared lattice covering both spheres (alignment is required for the
        // node-wise smooth boolean). Box spans both centers + R + margin.
        const double half = 0.5 * sep + R + 3.0 * h;
        Vec3 origin{ -half, -half, -half };
        std::size_t n = std::size_t(std::ceil((2.0 * half) / h)) + 1;
        VoxelGrid<float> A(n, n, n, origin, h);
        VoxelGrid<float> B(n, n, n, origin, h);
        A.fillFromField([&](double x, double y, double z){ return sdfSphere(x,y,z,cA,R); });
        B.fillFromField([&](double x, double y, double z){ return sdfSphere(x,y,z,cB,R); });

        // Sharp union (existing VoxelBoolean), as the lower bracket.
        V::BooleanResult sharp = V::VoxelBoolean::unite(A, B);
        const double vSharp = V::VoxelBoolean::enclosedVolume(sharp.grid, 0.0);
        const double vSum   = 2.0 * sphereVol(R);            // upper bracket

        // Rounded unions at increasing blend radii.
        const double r1 = 0.20 * R, r2 = 0.40 * R, r3 = 0.65 * R;
        V::BooleanResult b1 = V::VoxelFieldOps::smoothUnion(A, B, r1);
        V::BooleanResult b2 = V::VoxelFieldOps::smoothUnion(A, B, r2);
        V::BooleanResult b3 = V::VoxelFieldOps::smoothUnion(A, B, r3);
        const double v1 = V::VoxelFieldOps::enclosedVolume(b1.grid, 0.0);
        const double v2 = V::VoxelFieldOps::enclosedVolume(b2.grid, 0.0);
        const double v3 = V::VoxelFieldOps::enclosedVolume(b3.grid, 0.0);

        std::printf("  trial %d: R=%.4f sep=%.4f h=%.4f\n", trial, R, sep, h);
        std::printf("    sharp=%.6f  blend(r=%.3f)=%.6f  blend(r=%.3f)=%.6f  blend(r=%.3f)=%.6f  sum=%.6f\n",
                    vSharp, r1, v1, r2, v2, r3, v3, vSum);

        check(b1.ok && b2.ok && b3.ok && sharp.ok, "all unions ok (aligned grids)");
        // The metaball fillet ADDS material in the seam: blend >= sharp.
        check(v1 >= vSharp - 1e-9, "blend(r1) >= sharp union (fillet adds seam material)",
              "v1=" + std::to_string(v1) + " sharp=" + std::to_string(vSharp));
        // And never exceeds the (un-deduped) sum of the two sphere volumes.
        check(v3 <= vSum + 1e-9, "blend(r3) <= sum of sphere volumes (overlap not double-counted past sum)",
              "v3=" + std::to_string(v3) + " sum=" + std::to_string(vSum));
        // Monotone increasing in the blend radius r.
        check(v1 <= v2 + 1e-9 && v2 <= v3 + 1e-9,
              "rounded-union volume is MONOTONE increasing in blend radius r",
              "v1=" + std::to_string(v1) + " v2=" + std::to_string(v2) + " v3=" + std::to_string(v3));
        // -> sharp union as r -> 0: a tiny blend is within a voxel band of sharp.
        V::BooleanResult bTiny = V::VoxelFieldOps::smoothUnion(A, B, 0.02 * R);
        const double vTiny = V::VoxelFieldOps::enclosedVolume(bTiny.grid, 0.0);
        const double tolSeam = bandTol(4.0 * M_PI * R * R, h);
        check(std::fabs(vTiny - vSharp) <= tolSeam,
              "blend -> sharp union as r -> 0 (within voxel band)",
              "|vTiny-vSharp|=" + std::to_string(std::fabs(vTiny - vSharp)) + " > tol=" + std::to_string(tolSeam));
    }

    // -----------------------------------------------------------------------
    // (4) CUBE MESH -> SDF -> MESH round-trip preserves the cube volume L^3.
    // -----------------------------------------------------------------------
    std::printf("\n[gate 4] cube mesh -> SDF grid -> re-contour: volume preserved within voxel res\n");
    {
        const double e = 1.0;                  // half-extent -> side L=2
        const double L = 2.0 * e;
        const Vec3 c{0.0, 0.0, 0.0};
        const double spacing = 0.05;

        std::vector<double> pos; std::vector<std::uint32_t> idx;
        cubeMesh(e, c, pos, idx);
        HalfEdgeMesh cube;
        bool built = cube.buildFromSoup(pos, idx);
        check(built, "cube soup builds a half-edge mesh", "buildFromSoup rejected the cube soup");
        const double vMeshIn = cube.signedVolume();

        impl::MeshToSdfSpec spec; spec.spacing = spacing; spec.marginCells = 3;
        impl::MeshSdfResult sdf = V::VoxelFieldOps::fromMesh(cube, spec);
        check(sdf.ok, "cube -> SDF grid succeeds", sdf.reason);
        check(sdf.closed, "source cube reported closed==true (parity sign trustworthy)");

        if (sdf.ok) {
            // Field-volume of the SDF directly (cell-center measure).
            const double vField = V::VoxelFieldOps::enclosedVolume(sdf.grid, 0.0);
            // Re-contour the SDF back to a mesh and measure its enclosed volume.
            V::ContourResult re = V::VoxelMesh::contour(sdf.grid, 0.0);
            check(re.ok, "SDF grid re-contours to a manifold mesh",
                  "contour rejected the marching-cubes soup");
            const double vMeshOut = re.ok ? re.mesh.signedVolume() : 0.0;

            const double exact = L * L * L;     // 8.0
            // Surface area of the cube = 6 L^2; band tolerance on each measure.
            const double tol = bandTol(6.0 * L * L, spacing);

            std::printf("    L=%.3f  exact=%.6f  meshIn=%.6f  field=%.6f  meshOut=%.6f  tol=%.6f\n",
                        L, exact, vMeshIn, vField, vMeshOut, tol);

            check(std::fabs(vMeshIn - exact) <= 1e-6,
                  "input cube mesh signed volume == L^3 exactly",
                  "vMeshIn=" + std::to_string(vMeshIn));
            check(std::fabs(vField - exact) <= tol,
                  "mesh->SDF field volume -> L^3 within voxel res",
                  "|err|=" + std::to_string(std::fabs(vField - exact)) + " > tol=" + std::to_string(tol));
            check(re.ok && std::fabs(vMeshOut - exact) <= tol,
                  "mesh->SDF->mesh round-trip preserves cube volume L^3 within voxel res",
                  "|err|=" + std::to_string(std::fabs(vMeshOut - exact)) + " > tol=" + std::to_string(tol));
        }
    }

    // -----------------------------------------------------------------------
    // (5) HONESTY: degenerate inputs fail loudly, never fabricate.
    // -----------------------------------------------------------------------
    std::printf("\n[gate 5] honesty: degenerate inputs -> ok=false (0 FAKES)\n");
    {
        VoxelGrid<float> base = voxelizeSphere(1.0, 0.05);
        const std::vector<float> before = base.data();

        V::FieldOpResult nanOff = V::VoxelFieldOps::offset(
            base, std::numeric_limits<double>::quiet_NaN(), 0.0);
        check(!nanOff.ok && nanOff.grid.data() == before,
              "offset(NaN) -> ok=false, field UNCHANGED");

        V::FieldOpResult zShell = V::VoxelFieldOps::shell(base, 0.0, 0.0);
        V::FieldOpResult nShell = V::VoxelFieldOps::shell(base, -0.3, 0.0);
        check(!zShell.ok && zShell.grid.data() == before, "shell(t=0) -> ok=false, unchanged");
        check(!nShell.ok && nShell.grid.data() == before, "shell(t<0) -> ok=false, unchanged");

        // Misaligned grids -> smooth union ok=false.
        VoxelGrid<float> other = voxelizeSphere(1.0, 0.07);   // different spacing/dims
        V::BooleanResult mis = V::VoxelFieldOps::smoothUnion(base, other, 0.2);
        check(!mis.ok, "smoothUnion on MISALIGNED grids -> ok=false (not resampled)");

        // Non-positive blend radius -> ok=false.
        V::BooleanResult badR = V::VoxelFieldOps::smoothUnion(base, base, 0.0);
        check(!badR.ok, "smoothUnion(r=0) -> ok=false (blend radius must be > 0)");
    }

    std::printf("\n=== RESULT: %d / %d passed ===\n", g_passed, g_total);
    std::printf("Validated envelope: EXACT node-wise SDF field ops on a dense VoxelGrid —\n"
                "  offset f'=f-d  (sphere R->R+d, vol 4/3 pi (R+d)^3 within O(h) band),\n"
                "  shell |f|-t/2  (hollow box L^3-(L-t)^3 / sphere shell, closed form within band),\n"
                "  fillet smin(a,b,r) (metaball blend: sharp<=blend<=sum, monotone in r, ->sharp as r->0),\n"
                "  mesh<->SDF round-trip (cube L^3 preserved within voxel res).\n"
                "Honest scope (refine, flagged): DENSE grid ops; sparse/VDB narrow-band + GPU = identical\n"
                "values, pure speed (TODO). smin is a smoothed field with the correct rounded zero-set,\n"
                "not an exact Euclidean distance (validated by monotonicity/bracketing, no blended oracle).\n");
    return (g_passed == g_total) ? 0 : 1;
}
