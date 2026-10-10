// PUSH-11 — forge::fea::tet implementation.
//
// Tet4 (constant-strain tet) linear-elastic FEA with Bowyer-Watson volume
// mesher, Jacobi-CG static solver, and shifted inverse-power modal solver.
//
// No external numerical libraries.  Only OCCT (for surface meshing +
// inside-tests) and C++ std.

#include "forge/math/Vec3.hpp"
#include "forge/FeaTet.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/NativeShapeAccess.hpp"  // nativeSolidOf — the OCCT-free registry read
#include "forge/OcctNativeMesh.hpp"   // K5 — native surface mesher (no TKMesh)
#include "forge/native/Predicates.hpp"  // exact orient3d / insphere (T-035 robust Bowyer-Watson)
#ifdef FORGE_NATIVE_PROJECTION
#include "forge/native/geom/NativeProjection.hpp"  // R1 point->surface (T-035 boundary on the CAD surface)
#endif
#include <cstdio>
#include <cstdlib>

#include <BRep_Tool.hxx>
#include <BRepBndLib.hxx>
#include <BRepTools.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Surface.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <TopoDS_Edge.hxx>
#include <gp_Vec.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <Bnd_Box.hxx>
#include <Standard_Handle.hxx>
#include <Poly_Triangle.hxx>
#include <Poly_Triangulation.hxx>
#include <Precision.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <vector>

// PHASE-D wiring (2026-06-25) — route the OCCT geometry ops that meshShape uses to build
// the tet-mesh DOMAIN, through the ALREADY-BUILT in-house native B-rep ops behind the
// FEAT gate, on the meshShapeFromHandle entry (the only point that sees the ShapeHandle,
// hence the only point that can detect a NativeSolid input):
//   * BRepMesh_IncrementalMesh + Poly_Triangulation boundary-triangle extraction
//                                    -> forge::native::brep::tessellateSolid (watertight
//                                       boundary triangle soup of the native Solid)
//   * BRepBndLib::Add / Bnd_Box      -> forge::native::brep::computeAabb (exact AABB; used
//                                       for the merge tolerance + interior-grid bounds)
//   * BRepClass3d_SolidClassifier    -> forge::native::brep::pointInSolid (even-odd ray
//                                       cast; the interior-grid seed test, the BW
//                                       tet-centroid inside filter, and the shell-fallback
//                                       inner-node test)
// Compiled in ONLY under -DFORGE_NATIVE_BREP and taken at runtime ONLY when the FEAT gate
// forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1, or the A/B harness's
// setForgeNativeBrepEnabled(true)). PRODUCTION DEFAULT IS OFF: with the gate off the
// original OCCT meshShape path runs byte-for-byte unchanged. Mirrors the prior wires
// (Cam.cpp / Healing.cpp / CamAdvanced.cpp / Drawings.cpp / Fea.cpp). PHASE-D ACTIVATION
// (2026-06-25): the native branch now runs on BOTH a NativeSolid handle AND an OCCT-backed
// (ShapeKind::Occt) handle, the latter imported into a native analytic Solid via
// forge::importOcctSolid (src/OcctImport.cpp) before tessellate/AABB/point-in-solid run.
// SAFE + HONEST: if importOcctSolid defers (ok==false: NURBS/Torus/non-analytic) the helper
// returns false and the OCCT meshShape path runs, byte-identical to today. The native tet
// build reuses the SAME backend-agnostic helpers (bowyerWatson, tetVolume, tet4B, the
// seed-densify + centroid-filter + shell-fallback logic), substituting ONLY the three
// geometry backends above; the resulting Mesh is structurally the same kind the OCCT path
// emits (Bowyer-Watson volume tets when they survive, else the documented shell fallback).
//
// The solvers (solveLinearStatic / solveModal) take a Mesh and run pure in-house sparse
// linear algebra (no OCCT geometry), so they have NO native geometry target and are left
// UNWIRED (not a gap; there is nothing to route).
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"      // forgeNativeFeaturesEnabled()
#include "forge/native/brep/Topology.hpp"         // Solid graph
#include "forge/native/brep/Aabb.hpp"             // computeAabb (native AABB)
#include "forge/native/brep/Query.hpp"            // pointInSolid (native point classify)
#include "forge/native/brep/SolidTessellate.hpp"  // tessellateSolid (boundary triangles)
#include "forge/OcctImport.hpp"                   // importOcctSolid (OCCT analytic -> native Solid)
#endif

namespace forge::fea::tet {

namespace {

// ============================================================== utilities

constexpr double kEps = 1e-12;

// Vec3 is THE canonical forge::math::Vec3 (superset of this local copy:
// same layout, same ctors, and it already carries dot/cross/norm).
using Vec3 = forge::math::Vec3;

double tetVolume(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d) {
    return (b - a).cross(c - a).dot(d - a) / 6.0;
}

// Resolve the interior Steiner-seed lattice budget: explicit argument wins, then the
// FORGE_FEA_TET_SEED_BUDGET env escape hatch, then kDefaultSeedGridBudget. See the
// FeaTet.hpp note — this is a RUNTIME guard against the measured ~1.25 ms/tet meshing
// cost, not a mesh-quality choice, and exceeding it COARSENS the interior spacing.
int resolveSeedGridBudget(int requested) {
    if (requested > 0) return requested;
    if (const char* e = std::getenv("FORGE_FEA_TET_SEED_BUDGET")) {
        char* end = nullptr;
        long v = std::strtol(e, &end, 10);
        if (end != e && v > 0 && v <= 100000000L) return static_cast<int>(v);
    }
    return kDefaultSeedGridBudget;
}

// Size the interior lattice for an AABB extent under a budget, and REPORT whether the
// budget forced a coarsening. `nx/ny/nz` are counts of interior planes; the resulting
// spacing is extent/(n+1). Returns true when the budget bound (and therefore inflated)
// the spacing above `targetEdge`.
bool sizeSeedGrid(double ex, double ey, double ez, double targetEdge, int budget,
                  int& nx, int& ny, int& nz, double& spacingOut) {
    nx = std::max(1, static_cast<int>(std::ceil(ex / targetEdge)));
    ny = std::max(1, static_cast<int>(std::ceil(ey / targetEdge)));
    nz = std::max(1, static_cast<int>(std::ceil(ez / targetEdge)));
    const long long total = static_cast<long long>(nx) * ny * nz;
    bool capped = false;
    if (total > budget) {
        capped = true;
        double f = std::pow(static_cast<double>(total) / budget, 1.0 / 3.0);
        nx = std::max(1, static_cast<int>(nx / f));
        ny = std::max(1, static_cast<int>(ny / f));
        nz = std::max(1, static_cast<int>(nz / f));
    }
    spacingOut = std::max(ex / (nx + 1), std::max(ey / (ny + 1), ez / (nz + 1)));
    return capped;
}

void stampSeedDiag(Mesh& m, double targetEdge, int budget, bool capped, double spacing) {
    m.requestedEdge   = targetEdge;
    m.seedGridBudget  = budget;
    m.seedGridCapped  = capped;
    m.interiorSpacing = spacing;
}

// --------------------------------------------------------------------------- //
//  Boundary densification — RECURSIVE                                          //
// --------------------------------------------------------------------------- //
// This was a single pass over the ORIGINAL triangle list, duplicated verbatim at
// both call sites (the OCCT path and the native path):
//
//     std::size_t ntri = triangles.size();          // captured BEFORE the loop
//     for (std::size_t ti = 0; ti < ntri; ++ti) {
//         if ((B - A).norm() > minLen) tryAdd((A + B) * 0.5);   // one midpoint, once
//         if (area > minArea)          tryAdd((A + B + C) / 3);
//     }
//
// `tryAdd` appends to `bndPts` and never to `triangles`, so a second pass had
// nothing new to subdivide: every surface triangle contributed its edge midpoints
// and its barycentre exactly once, and boundary spacing floored at a fraction of the
// surface facet size INDEPENDENT of targetEdge. Only the interior AABB lattice
// tracked it.
//
// Measured on a unit box before this change: the z=0 face carried 11 nodes at
// 5 distinct x stations with a 0.33333 m maximum gap at targetEdge 0.5, 0.25, 0.125
// AND 0.0625 — byte-identical across a 118x increase in tet count (240 -> 28296),
// while total node count grew 65 -> 4951. The mesh refined everywhere except its
// surface. NAFEMS LE1/LE10 show the same signature on real geometry: boundary node
// set identical across a 69x tet increase, stress-recovery patch frozen at 0.625 m,
// and h_local at the probe falling 1.46x while targetEdge fell 2.9x.
//
// Subdividing to a depth bounded by the requested edge length fixes that. The work
// list is PRIVATE: `triangles` is not modified, so the shell fallback that consumes
// it downstream sees exactly what it saw before.
//
// The budget is a REPORTED cap, never a silent one — a surface that cannot be
// resolved within it says so, because a quietly truncated boundary is the defect
// this function exists to remove.
template <class AddFn>
void densifyBoundaryRecursive(const std::vector<Vec3>& pts,
                              const std::vector<std::array<int, 3>>& triangles,
                              AddFn&& tryAdd,
                              double minLen, double minArea,
                              std::size_t budget, int maxDepth,
                              std::size_t& added, bool& capped) {
    struct Item { Vec3 a, b, c; int depth; };
    std::vector<Item> stack;
    stack.reserve(256);
    const std::size_t ntri = triangles.size();
    for (std::size_t ti = 0; ti < ntri; ++ti) {
        // Copy the corners by value. tryAdd push_backs into the same vector `pts`
        // refers to, and a reference into its storage would dangle on reallocation.
        stack.push_back({pts[triangles[ti][0]], pts[triangles[ti][1]],
                         pts[triangles[ti][2]], 0});
        while (!stack.empty()) {
            const Item it = stack.back();
            stack.pop_back();
            const Vec3 A = it.a, B = it.b, C = it.c;
            const double lab = (B - A).norm();
            const double lbc = (C - B).norm();
            const double lca = (A - C).norm();
            const double longest = std::max(lab, std::max(lbc, lca));
            if (longest > minLen && it.depth < maxDepth) {
                if (added >= budget) { capped = true; continue; }
                // LONGEST-EDGE BISECTION, not 4-way subdivision.
                //
                // Splitting all three edges every level refines a slender triangle
                // in its SHORT direction as well, and the recursion only stops when
                // the LONGEST edge is small enough. On the 100x10 mm face of the
                // fea_smoke beam that meant subdividing until the long edge reached
                // 2.5 mm, by which point the short edge was 10/64 = 0.16 mm -- 16x
                // finer than asked for. Measured cost of that mistake: a 200x10x10
                // beam at targetEdge 4 mm produced 11,405 nodes where a uniform mesh
                // needs about 800, and doubling the beam's LENGTH multiplied nodes by
                // 3.8x and time by 14x. fea_smoke, a smoke test, ran for 12 minutes.
                //
                // Bisecting only the longest edge refines exactly the direction that
                // is too coarse, terminates when every edge is within minLen, and
                // keeps the aspect ratio bounded (Rivara).
                Vec3 m;
                Vec3 p0, p1, p2;
                if (lab >= lbc && lab >= lca)      { m = (A + B) * 0.5; p0 = A; p1 = B; p2 = C; }
                else if (lbc >= lca)               { m = (B + C) * 0.5; p0 = B; p1 = C; p2 = A; }
                else                               { m = (C + A) * 0.5; p0 = C; p1 = A; p2 = B; }
                if (tryAdd(m)) ++added;
                stack.push_back({p0, m,  p2, it.depth + 1});
                stack.push_back({m,  p1, p2, it.depth + 1});
            } else {
                const double area = 0.5 * (B - A).cross(C - A).norm();
                if (area > minArea) {
                    if (added < budget) { if (tryAdd((A + B + C) * (1.0 / 3.0))) ++added; }
                    else                { capped = true; }
                }
            }
        }
    }
}

// Inc1b — closed-form principal stresses (eigenvalues of the symmetric 3×3
// Cauchy tensor) via the trigonometric (Smith 1961) method for a real
// symmetric matrix. Input Voigt s = {sxx,syy,szz,sxy,syz,szx}; output
// {s1 ≥ s2 ≥ s3}. Exact, branch-stable, no iteration.
inline void principalStresses(const double s[6], double out[3]) {
    constexpr double kPi = 3.14159265358979323846;
    const double sxx = s[0], syy = s[1], szz = s[2];
    const double sxy = s[3], syz = s[4], szx = s[5];
    const double p1 = sxy * sxy + syz * syz + szx * szx;
    if (p1 <= 1e-30) {                       // tensor already diagonal
        out[0] = sxx; out[1] = syy; out[2] = szz;
    } else {
        const double q  = (sxx + syy + szz) / 3.0;
        const double p2 = (sxx - q) * (sxx - q) + (syy - q) * (syy - q)
                        + (szz - q) * (szz - q) + 2.0 * p1;
        const double p  = std::sqrt(p2 / 6.0);
        const double bxx = (sxx - q) / p, byy = (syy - q) / p, bzz = (szz - q) / p;
        const double bxy = sxy / p, byz = syz / p, bzx = szx / p;
        double detB = bxx * (byy * bzz - byz * byz)
                    - bxy * (bxy * bzz - byz * bzx)
                    + bzx * (bxy * byz - byy * bzx);
        double r = detB / 2.0;
        if (r < -1.0) r = -1.0; else if (r > 1.0) r = 1.0;
        const double phi = std::acos(r) / 3.0;
        const double e1 = q + 2.0 * p * std::cos(phi);
        const double e3 = q + 2.0 * p * std::cos(phi + 2.0 * kPi / 3.0);
        const double e2 = 3.0 * q - e1 - e3;       // trace invariant
        out[0] = e1; out[1] = e2; out[2] = e3;
    }
    if (out[0] < out[1]) std::swap(out[0], out[1]);
    if (out[1] < out[2]) std::swap(out[1], out[2]);
    if (out[0] < out[1]) std::swap(out[0], out[1]);
}

inline double vonMisesVoigt(const double s[6]) {
    const double sx = s[0], sy = s[1], sz = s[2];
    const double txy = s[3], tyz = s[4], tzx = s[5];
    return std::sqrt(0.5 * ((sx - sy) * (sx - sy) + (sy - sz) * (sy - sz)
                          + (sz - sx) * (sz - sx))
                     + 3.0 * (txy * txy + tyz * tyz + tzx * tzx));
}

// =================================================== Bowyer-Watson mesher
//
// Indices used during meshing: nodes are stored in a std::vector<Vec3>
// where [0..nReal-1] are the real points and, while meshing, the last four
// entries are the super-tet corners.
//
// T-035 — ROBUST INSERTION. The previous insertion tested every live tet with a
// floating-point circumsphere (centre + radius from a 3x3 solve, `<= r^2 + 1e-12`) and
// dropped any new tet whose circumsphere solve failed. That was tolerable while the
// boundary samples were chord midpoints, which are never cospherical. Once the samples are
// put ON the CAD surface they are cospherical by construction (every sample of a sphere lies
// on one sphere, every sample of a cylinder ring on one circle), and the float test then
// produced cavities that were not star-shaped: MEASURED on a cylinder r = 0.5, h = 1 at
// targetEdge 0.15 — 321,464 "tets" from ~650 points, 185,076 of 186,069 boundary faces with
// an interior vertex (overlapping garbage), and a sphere r = 1 at 0.3 that ran for 10+ minutes.
// It was not sound before either, only rarer: on the pre-T-035 mesher the gate's validity check
// (test/fea_tet_surface_conformance_gate.cpp) finds faces shared by more than two tets on the LE10 slab at
// 0.115 (summed tet volume 3.2230 m^3 against 3.0582 m^3 enclosed by the boundary) and on a
// sphere r = 1 at 0.1 — overlapping elements that went into the stiffness matrix unremarked.
//
// Now:
//   * every coordinate is snapped to a power-of-two grid fine enough to be invisible (q <=
//     2^-49 x the largest |coordinate| meshing sees, the super-tet corners at ~32x the model
//     size: ~1e-13 m on these models), so every coordinate
//     DIFFERENCE is an exact double and forge::native::orient3d / insphere (exact for exact
//     differences) give the exact sign — the triangulation's combinatorics can no longer be
//     corrupted by rounding;
//   * tets carry face adjacency; a point is located by a randomized visibility walk (exact
//     orientation), its cavity grown by breadth-first search over tets whose circumsphere
//     STRICTLY contains it (exact insphere), then SHRUNK until every cavity boundary face is
//     strictly visible from the point — so every new tet has strictly positive volume and the
//     result is a valid tetrahedralization even for cospherical input (where Delaunay is not
//     unique and a cospherical tie is resolved by keeping the old tet);
//   * a cavity face counts as visible only when its new tet is non-flat beyond the snap's
//     reach (NUMERICALLY FLAT TETS, in bowyerWatson), so a configuration that is degenerate
//     in the reals (mirrored samples on two faces of a box) never becomes a tet that is
//     positive only by the snap;
//     (MUTATION-TESTED, test/fea_tet_surface_conformance_gate.cpp: without the flat guard —
//     shrinking only on an exactly non-positive face, the round-1 code — or without the
//     shrink step at all, the gate fails: the fea_smoke cantilever gets a tet of 6V/L^3 =
//     2.1e-13 (CG 27430 iterations, peak von Mises +34.5 %) and the cylinder at 0.15 / 0.075
//     tets of ~1e-15. With orient3dNaive / insphereNaive in place of the exact predicates the
//     T-035 gate PASSED — the guard's band already absorbs every visibility decision the naive
//     orientation gets wrong — and the one symptom left was a point the walk cannot locate
//     (LE1 at 0.09, 1 of 3367, counted on stderr only); since T-256 the gate asserts that
//     census and the naive mutant FAILS on it. Before the guard the naive mutant failed:
//     flat tets on box, cylinder and sphere, a non-manifold cavity on the slab at 0.075.)
//   * a point that cannot be inserted (an exact duplicate after snapping, a point no live tet
//     contains, a cavity that cannot be star-shaped from it) is skipped and COUNTED — on
//     stderr and, since T-256, in BwStats -> Mesh::bwSkipped*, so a gate can assert that every
//     point it asked for became a vertex (MUTATION-TESTED: the naive-predicate mutant above,
//     whose only symptom was that stderr line, now fails test/fea_tet_surface_conformance_gate.cpp);
//   * each insertion costs a walk plus a local cavity, not a scan of every tet ever made.
// The output node coordinates are the snapped ones (the tets are valid for those).

struct LocalTet {
    int n[4];           // node indices; tetVolume(n[0], n[1], n[2], n[3]) > 0
};

// T-256 — the insertion census of one bowyerWatson() call (see Mesh::bwInputPoints).
struct BwStats {
    std::size_t input = 0, inserted = 0, duplicates = 0, unlocated = 0, rejected = 0;
    double snapQ = 0.0;   // the coordinate snap grid (T-253: a moved vertex is snapped to it too)
};

// Stamp the census on the Mesh the caller returns. `ran` is false when Bowyer-Watson threw.
void stampBwStats(Mesh& m, const BwStats& st, bool ran) {
    m.bwInputPoints      = static_cast<int>(st.input);
    m.bwInsertedPoints   = static_cast<int>(st.inserted);
    m.bwSkippedDuplicate = static_cast<int>(st.duplicates);
    m.bwSkippedUnlocated = static_cast<int>(st.unlocated);
    m.bwSkippedNoCavity  = static_cast<int>(st.rejected);
    m.bwFailed           = !ran;
}

struct FaceKey {
    int a, b, c;
    FaceKey(int x, int y, int z) {
        a = x; b = y; c = z;
        if (a > b) std::swap(a, b);
        if (b > c) std::swap(b, c);
        if (a > b) std::swap(a, b);
    }
    bool operator==(const FaceKey& o) const { return a==o.a && b==o.b && c==o.c; }
};
struct FaceHash {
    std::size_t operator()(const FaceKey& f) const noexcept {
        std::uint64_t h = 1469598103934665603ull;
        auto mix = [&](int v){ h ^= static_cast<std::uint64_t>(v); h *= 1099511628211ull; };
        mix(f.a); mix(f.b); mix(f.c);
        return static_cast<std::size_t>(h);
    }
};

// Orientation with tetVolume's sign, exact on snapped input. forge::native::orient3d is
// positive when its 4th point lies BELOW the plane of the first three seen counter-clockwise,
// which is the opposite sign of tetVolume.
inline int orientSign(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d) {
    return -forge::native::signValue(forge::native::orient3d(a.x, a.y, a.z, b.x, b.y, b.z,
                                                             c.x, c.y, c.z, d.x, d.y, d.z));
}
// > 0 iff e is STRICTLY inside the circumsphere of the positive (tetVolume > 0) tet abcd.
// forge::native::insphere wants its first four points with orient3d > 0 (tetVolume < 0),
// hence b before a.
inline int inSphereSign(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d, const Vec3& e) {
    return forge::native::signValue(forge::native::insphere(b.x, b.y, b.z, a.x, a.y, a.z,
                                                            c.x, c.y, c.z, d.x, d.y, d.z,
                                                            e.x, e.y, e.z));
}

std::vector<LocalTet>
bowyerWatson(std::vector<Vec3>& pts, BwStats& stats) {
    const int N = static_cast<int>(pts.size());
    stats = BwStats{};
    stats.input = static_cast<std::size_t>(N);
    if (N == 0) return {};
    // Wrap with a huge super-tetrahedron containing all points.
    double xmin=+1e30,ymin=+1e30,zmin=+1e30,xmax=-1e30,ymax=-1e30,zmax=-1e30;
    for (auto& p : pts) {
        xmin = std::min(xmin, p.x); xmax = std::max(xmax, p.x);
        ymin = std::min(ymin, p.y); ymax = std::max(ymax, p.y);
        zmin = std::min(zmin, p.z); zmax = std::max(zmax, p.z);
    }
    double dx = xmax - xmin, dy = ymax - ymin, dz = zmax - zmin;
    double dmax = std::max(dx, std::max(dy, dz));
    if (dmax < kEps) dmax = 1.0;
    double cx = 0.5 * (xmin + xmax);
    double cy = 0.5 * (ymin + ymax);
    double cz = 0.5 * (zmin + zmax);
    // Big enough to contain everything by a healthy factor.
    double s = 32.0 * dmax;

    // Snap to the grid q = 2^(e-50), 2^e > every |coordinate| meshing will see (the super
    // corners bound them all). Grid values below 2^e differ by < 2^51 q: exact doubles.
    const double M = std::max({std::abs(cx) + s, std::abs(cy) + s, std::abs(cz) + s});
    int e2 = 0;
    (void)std::frexp(M, &e2);                       // M < 2^e2
    const double q = std::ldexp(1.0, e2 - 50);
    stats.snapQ = q;
    auto snap = [q](double v) { return std::nearbyint(v / q) * q; };
    for (auto& p : pts) { p.x = snap(p.x); p.y = snap(p.y); p.z = snap(p.z); }
    pts.push_back({snap(cx - s), snap(cy - s), snap(cz - s)});
    pts.push_back({snap(cx + s), snap(cy - s), snap(cz - s)});
    pts.push_back({snap(cx),     snap(cy + s), snap(cz - s)});
    pts.push_back({snap(cx),     snap(cy),     snap(cz + s)});

    struct BT {
        int v[4];
        int nb[4];                 // nb[j]: the tet across the face opposite v[j]; -1 = none
        bool alive;
        unsigned inCav;            // == stamp: in the current cavity
        unsigned tested;           // == stamp: insphere already evaluated for this point
    };
    std::vector<BT> T;
    T.reserve(static_cast<std::size_t>(N) * 7 + 16);
    T.push_back({{N, N + 1, N + 2, N + 3}, {-1, -1, -1, -1}, true, 0u, 0u});
    {
        const int o = orientSign(pts[N], pts[N + 1], pts[N + 2], pts[N + 3]);
        if (o == 0) throw std::runtime_error("forge::fea::tet: degenerate super-tet");
        if (o < 0) std::swap(T[0].v[0], T[0].v[1]);
    }
    std::vector<int> freeList, cav, newIds;
    struct BFace { int c, j, n; };
    std::vector<BFace> bfaces;
    struct EdgeRef { int a, b, tet, k; };
    std::vector<EdgeRef> edges;

    // Orientation of tet t with its vertex j replaced by P: > 0 iff P is strictly on the
    // inner side of t's face j.
    auto replacedOrient = [&](const BT& t, int j, const Vec3& P) {
        const Vec3* q4[4] = {&pts[t.v[0]], &pts[t.v[1]], &pts[t.v[2]], &pts[t.v[3]]};
        q4[j] = &P;
        return orientSign(*q4[0], *q4[1], *q4[2], *q4[3]);
    };

    // NUMERICALLY FLAT TETS (T-035 fix round). Snapping moves every coordinate by <= q/2, and
    // the samples were computed in floating point, so a configuration that is EXACTLY
    // degenerate in the reals — four samples on two faces of a box mirrored across their
    // common edge form an isosceles trapezoid, coplanar and cocircular — reaches the exact
    // predicates perturbed by ~q. Read literally, that perturbation can put the trapezoid in
    // the cavity's boundary with P as one of its corners: MEASURED on the fea_smoke cantilever
    // (box 0.1 x 0.01 x 0.01 at targetEdge 0.002) the trapezoid became ONE tet, positive only
    // by the snap (radius ratio 1.48e-12; CG 1556 -> 27430 iterations, peak von Mises
    // 56.35 -> 80.67 MPa). So a cavity face counts as visible only when its new tet's
    // orientation is beyond the snap's reach (clearlyVisible); otherwise the star-shaping step
    // drops the cavity tet behind that face, as for an invisible face. That only happens when P
    // is within the snap's reach of that face's plane. The circumspheres of the two tets on
    // either side meet that plane in the same circle, so P's powers with respect to them differ
    // only by a term proportional to its distance from the plane; with one tet in conflict and
    // the other not, both are near zero, and keeping the tet resolves a near-tie, not a real
    // conflict. (The tet containing P is never dropped; its faces keep the exact test. P near
    // one of them with the neighbour out of conflict means P near a vertex, which the merge
    // tolerance in meshShape keeps away.) The in-sphere test itself stays EXACT: a
    // tolerance there was tried and MEASURED harmful — the in-sphere determinant of a sliver
    // (6V << L^3) is always inside a q-sized band, so slivers stopped being removed by later
    // insertions and the LE10 slab at 0.075 lost its boundary (2 non-manifold boundary edges,
    // an inner-surface vertex 0.054 m off the ellipsoid, min radius ratio 1.0e-10).
    //
    // Is P clearly (beyond the snap's reach) on the inner side of t's face j — i.e. is the
    // tet "face j + P" non-flat? Exact differences, double products.
    auto clearlyVisible = [&](const BT& t, int j, const Vec3& P) {
        const Vec3* q4[4] = {&pts[t.v[0]], &pts[t.v[1]], &pts[t.v[2]], &pts[t.v[3]]};
        q4[j] = &P;
        const Vec3 u = *q4[1] - *q4[0], v = *q4[2] - *q4[0], w = *q4[3] - *q4[0];
        const double v6 = u.cross(v).dot(w);          // tetVolume's sign: > 0 is the good side
        const Vec3 vu = v - u, wu = w - u, wv = w - v;
        const double L2 = std::max({u.dot(u), v.dot(v), w.dot(w), vu.dot(vu), wu.dot(wu), wv.dot(wv)});
        // A <= q move of each coordinate shifts 6V by <= ~12 q L^2 (L the longest edge), and
        // the double evaluation errs by < 1e-14 L^3; the band is >= 20x that, i.e. a tet is
        // emitted only with 6V / L^3 > 256 q / L (6e-11 .. 2e-9 on the gate's models: q is
        // 3.6e-15 m on the 0.1 m cantilever, 1.1e-13 m on the 3.5 m slab), never at rounding level.
        const double band = (256.0 * q + 1e-13 * std::sqrt(L2)) * L2;
        return v6 > band;
    };

    std::uint32_t rng = 2463534242u;               // xorshift32, deterministic
    auto nextRand = [&rng]() { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng; };
    unsigned stamp = 0;
    int hint = 0;
    // Counted straight into the caller's census, so a throw below still leaves what was
    // counted up to it.
    std::size_t& duplicates = stats.duplicates;
    std::size_t& unlocated  = stats.unlocated;
    std::size_t& rejected   = stats.rejected;

    for (int pi = 0; pi < N; ++pi) {
        const Vec3 P = pts[pi];

        // 1. Locate: randomized visibility walk, then an exhaustive scan if the walk fails.
        int t = hint;
        if (t < 0 || t >= static_cast<int>(T.size()) || !T[t].alive) {
            t = -1;
            for (int i = 0; i < static_cast<int>(T.size()); ++i) if (T[i].alive) { t = i; break; }
        }
        bool found = false;
        {
            int prev = -1;
            const std::size_t maxSteps = T.size() + 64;
            for (std::size_t step = 0; t >= 0 && step < maxSteps; ++step) {
                const int start = static_cast<int>(nextRand() & 3u);
                int go = -1;
                for (int k = 0; k < 4; ++k) {
                    const int j = (start + k) & 3;
                    const int nbj = T[t].nb[j];
                    if (nbj < 0 || nbj == prev) continue;
                    if (replacedOrient(T[t], j, P) < 0) { go = j; break; }
                }
                if (go < 0) { found = true; break; }
                prev = t;
                t = T[t].nb[go];
            }
        }
        if (!found) {
            t = -1;
            for (int i = 0; i < static_cast<int>(T.size()) && t < 0; ++i) {
                if (!T[i].alive) continue;
                bool in = true;
                for (int j = 0; j < 4 && in; ++j) in = replacedOrient(T[i], j, P) >= 0;
                if (in) t = i;
            }
            if (t < 0) { ++unlocated; continue; }
        }
        bool dup = false;
        for (int k = 0; k < 4; ++k) {
            const Vec3& w = pts[T[t].v[k]];
            if (w.x == P.x && w.y == P.y && w.z == P.z) dup = true;
        }
        if (dup) { ++duplicates; continue; }

        // 2. Cavity: tets reachable from t whose circumsphere strictly contains P. (A tet
        //    that contains P in its closed interior always qualifies, so t's star is in.)
        ++stamp;
        cav.clear();
        cav.push_back(t);
        T[t].inCav = stamp;
        T[t].tested = stamp;
        for (std::size_t i = 0; i < cav.size(); ++i) {
            const int c = cav[i];
            for (int j = 0; j < 4; ++j) {
                const int n = T[c].nb[j];
                if (n < 0 || T[n].tested == stamp) continue;
                T[n].tested = stamp;
                if (inSphereSign(pts[T[n].v[0]], pts[T[n].v[1]], pts[T[n].v[2]], pts[T[n].v[3]], P) > 0) {
                    T[n].inCav = stamp;
                    cav.push_back(n);
                }
            }
        }
        // 3. Star-shape it: drop any tet (never t) with a boundary face P does not CLEARLY see —
        //    a face P is (up to the snap) on would become a numerically flat tet (see NUMERICALLY
        //    FLAT TETS above).
        for (bool changed = true; changed;) {
            changed = false;
            for (int c : cav) {
                if (c == t || T[c].inCav != stamp) continue;
                for (int j = 0; j < 4; ++j) {
                    const int n = T[c].nb[j];
                    if (n >= 0 && T[n].inCav == stamp) continue;
                    if (!clearlyVisible(T[c], j, P)) { T[c].inCav = 0; changed = true; break; }
                }
            }
        }
        cav.erase(std::remove_if(cav.begin(), cav.end(), [&](int c) { return T[c].inCav != stamp; }),
                  cav.end());
        bfaces.clear();
        bool visible = true;
        for (int c : cav) {
            for (int j = 0; j < 4; ++j) {
                const int n = T[c].nb[j];
                if (n >= 0 && T[n].inCav == stamp) continue;
                if (replacedOrient(T[c], j, P) <= 0) visible = false;
                bfaces.push_back({c, j, n});
            }
        }
        if (!visible) { for (int c : cav) T[c].inCav = 0; ++rejected; continue; }

        // 4. Re-triangulate: one new tet per cavity boundary face, apex P.
        newIds.clear();
        edges.clear();
        for (const BFace& f : bfaces) {
            BT nt = T[f.c];                       // by value: T may reallocate below
            nt.v[f.j] = pi;
            nt.nb[0] = nt.nb[1] = nt.nb[2] = nt.nb[3] = -1;
            nt.nb[f.j] = f.n;
            nt.alive = true;
            nt.inCav = 0;
            nt.tested = 0;
            int id;
            if (!freeList.empty()) { id = freeList.back(); freeList.pop_back(); T[id] = nt; }
            else { id = static_cast<int>(T.size()); T.push_back(nt); }
            if (f.n >= 0) {
                for (int k = 0; k < 4; ++k) if (T[f.n].nb[k] == f.c) { T[f.n].nb[k] = id; break; }
            }
            for (int k = 0; k < 4; ++k) {
                if (k == f.j) continue;
                int a = -1, b = -1;
                for (int m = 0; m < 4; ++m) {
                    if (m == f.j || m == k) continue;
                    if (a < 0) a = nt.v[m]; else b = nt.v[m];
                }
                if (a > b) std::swap(a, b);
                edges.push_back({a, b, id, k});
            }
            newIds.push_back(id);
        }
        std::sort(edges.begin(), edges.end(), [](const EdgeRef& x, const EdgeRef& y) {
            return x.a != y.a ? x.a < y.a : x.b < y.b;
        });
        for (std::size_t i = 0; i < edges.size(); i += 2) {
            if (i + 1 >= edges.size() || edges[i].a != edges[i + 1].a || edges[i].b != edges[i + 1].b ||
                (i + 2 < edges.size() && edges[i + 2].a == edges[i].a && edges[i + 2].b == edges[i].b)) {
                throw std::runtime_error("forge::fea::tet: Bowyer-Watson cavity boundary is not a closed 2-manifold");
            }
            T[edges[i].tet].nb[edges[i].k] = edges[i + 1].tet;
            T[edges[i + 1].tet].nb[edges[i + 1].k] = edges[i].tet;
        }
        for (int c : cav) { T[c].alive = false; T[c].inCav = 0; freeList.push_back(c); }
        hint = newIds.empty() ? hint : newIds.front();
        ++stats.inserted;
    }

    if (duplicates + unlocated + rejected > 0) {
        std::fprintf(stderr, "[feaTet] Bowyer-Watson skipped %zu of %d points (%zu exact duplicates after "
                             "snapping, %zu unlocated, %zu without a star-shaped cavity)\n",
                     duplicates + unlocated + rejected, N, duplicates, unlocated, rejected);
    }

    // 5. Strip any tet that still touches a super-corner.
    std::vector<LocalTet> out;
    out.reserve(T.size());
    for (const auto& t : T) {
        if (!t.alive) continue;
        if (t.v[0] >= N || t.v[1] >= N || t.v[2] >= N || t.v[3] >= N) continue;
        out.push_back({{t.v[0], t.v[1], t.v[2], t.v[3]}});
    }
    // Trim super-tet corners from points buffer.
    pts.resize(N);
    return out;
}

// ============================================================== shell fallback
//
// As authorised by the task: convert each surface triangle into a Tet4
// by adding an inner-offset node along the inward face normal at
// 1/3 of the average edge length.  Acknowledged crude but real.

Mesh buildShellTetFallback(const std::vector<Vec3>& bndPts,
                           const std::vector<std::array<int,3>>& triangles,
                           const TopoDS_Shape& shape) {
    BRepClass3d_SolidClassifier classifier(shape);
    Mesh out;
    out.shellTetsOnly = true;

    // Boundary nodes.
    out.nodes.reserve(bndPts.size() + triangles.size());
    for (std::size_t i = 0; i < bndPts.size(); ++i) {
        out.nodes.push_back({bndPts[i].x, bndPts[i].y, bndPts[i].z, static_cast<int>(i)});
    }

    int idCounter = 0;
    for (auto& tri : triangles) {
        const Vec3& A = bndPts[tri[0]];
        const Vec3& B = bndPts[tri[1]];
        const Vec3& C = bndPts[tri[2]];
        Vec3 n = (B - A).cross(C - A);
        double nl = n.norm();
        if (nl < kEps) continue;
        Vec3 nu = n * (1.0 / nl);
        Vec3 centroid = (A + B + C) * (1.0 / 3.0);
        // Average edge length.
        double e = ((B - A).norm() + (C - B).norm() + (A - C).norm()) / 3.0;
        double offset = e / 3.0;
        // Try inward first (- normal), then outward if classifier says
        // the inward point is outside.
        auto trySign = [&](double sign) -> int {
            Vec3 inner = centroid + nu * (sign * offset);
            gp_Pnt p(inner.x, inner.y, inner.z);
            classifier.Perform(p, Precision::Confusion());
            if (classifier.State() == TopAbs_IN || classifier.State() == TopAbs_ON) {
                int newId = static_cast<int>(out.nodes.size());
                out.nodes.push_back({inner.x, inner.y, inner.z, newId});
                return newId;
            }
            return -1;
        };
        int inner = trySign(-1.0);
        if (inner < 0) inner = trySign(+1.0);
        if (inner < 0) continue;

        // Choose orientation that gives positive Tet4 volume.
        Vec3 D{out.nodes[inner].x, out.nodes[inner].y, out.nodes[inner].z};
        double V = tetVolume(A, B, C, D);
        Tet t{};
        t.a = tri[0]; t.b = tri[1]; t.c = tri[2]; t.d = inner;
        if (V < 0.0) std::swap(t.b, t.c);
        t.id = idCounter++;
        out.tets.push_back(t);
    }
    return out;
}

// =============================================================== Tet4 math
//
// Constant-strain tetrahedron in 3D, isotropic linear elasticity.
// 12 DOFs per element (3 × 4 nodes).  Reference: Zienkiewicz-Taylor v1.

// Compute the strain-displacement matrix B (6×12) and volume for one tet.
// Returns true on success, false on degenerate. Caller MUST pass nodes with
// positive signed volume (V = ((p1-p0)×(p2-p0))·(p3-p0)/6 > 0).
//
// Linear shape functions N_i(x,y,z) = a_i + b_i x + c_i y + d_i z satisfy
// N_i(p_j) = δ_ij.  Differentiating, [∇N_1 ∇N_2 ∇N_3] = J^{-T} where
// J = [p1-p0; p2-p0; p3-p0] (rows).  ∇N_0 = -(∇N_1+∇N_2+∇N_3).
bool tet4B(const Vec3 p[4], std::array<double, 6 * 12>& B, double& V) {
    V = tetVolume(p[0], p[1], p[2], p[3]);
    if (std::abs(V) < 1e-25) return false;

    // Jacobian rows: e1=p1-p0, e2=p2-p0, e3=p3-p0
    Vec3 e1 = p[1] - p[0];
    Vec3 e2 = p[2] - p[0];
    Vec3 e3 = p[3] - p[0];
    // det(J)
    double det = e1.x * (e2.y * e3.z - e2.z * e3.y)
               - e1.y * (e2.x * e3.z - e2.z * e3.x)
               + e1.z * (e2.x * e3.y - e2.y * e3.x);
    if (std::abs(det) < 1e-25) return false;
    double invDet = 1.0 / det;

    // Inverse(J)  (3x3 cofactor / det)
    double Ji[3][3];
    Ji[0][0] = (e2.y * e3.z - e2.z * e3.y) * invDet;
    Ji[0][1] = (e1.z * e3.y - e1.y * e3.z) * invDet;
    Ji[0][2] = (e1.y * e2.z - e1.z * e2.y) * invDet;
    Ji[1][0] = (e2.z * e3.x - e2.x * e3.z) * invDet;
    Ji[1][1] = (e1.x * e3.z - e1.z * e3.x) * invDet;
    Ji[1][2] = (e1.z * e2.x - e1.x * e2.z) * invDet;
    Ji[2][0] = (e2.x * e3.y - e2.y * e3.x) * invDet;
    Ji[2][1] = (e1.y * e3.x - e1.x * e3.y) * invDet;
    Ji[2][2] = (e1.x * e2.y - e1.y * e2.x) * invDet;

    // With M = [e1; e2; e3] (rows e_k = p_k - p_0), `Ji[k][j]` is the
    // (k,j) entry of M^{-1} = (J^T)^{-1} = J^{-T} (where J is the
    // textbook Jacobian J_{ij} = ∂x_i/∂ξ_j, so J columns are e1,e2,e3).
    // Then ∂N_1/∂x_j = (J^{-1})_{0,j} = (J^{-T})_{j,0} = Ji[j][0].
    // Same pattern for N_2 (column 1) and N_3 (column 2) of Ji.
    std::array<std::array<double, 3>, 4> grad;
    grad[1] = {Ji[0][0], Ji[1][0], Ji[2][0]};
    grad[2] = {Ji[0][1], Ji[1][1], Ji[2][1]};
    grad[3] = {Ji[0][2], Ji[1][2], Ji[2][2]};
    grad[0] = {
        -(grad[1][0] + grad[2][0] + grad[3][0]),
        -(grad[1][1] + grad[2][1] + grad[3][1]),
        -(grad[1][2] + grad[2][2] + grad[3][2]),
    };

    // Build B (6×12) in row-major.
    auto idx = [](int row, int col) { return row * 12 + col; };
    std::fill(B.begin(), B.end(), 0.0);
    for (int l = 0; l < 4; ++l) {
        double bx = grad[l][0];
        double by = grad[l][1];
        double bz = grad[l][2];
        int col = 3 * l;
        B[idx(0, col + 0)] = bx;
        B[idx(1, col + 1)] = by;
        B[idx(2, col + 2)] = bz;
        B[idx(3, col + 0)] = by;
        B[idx(3, col + 1)] = bx;
        B[idx(4, col + 1)] = bz;
        B[idx(4, col + 2)] = by;
        B[idx(5, col + 0)] = bz;
        B[idx(5, col + 2)] = bx;
    }
    return true;
}

// 6×6 isotropic elasticity matrix D.
void elasticityD(double E, double nu, std::array<double, 36>& D) {
    double c = E / ((1.0 + nu) * (1.0 - 2.0 * nu));
    double a = c * (1.0 - nu);
    double b = c * nu;
    double g = c * (1.0 - 2.0 * nu) / 2.0;
    std::fill(D.begin(), D.end(), 0.0);
    auto at = [&](int r, int c2) -> double& { return D[r * 6 + c2]; };
    at(0,0)=a; at(0,1)=b; at(0,2)=b;
    at(1,0)=b; at(1,1)=a; at(1,2)=b;
    at(2,0)=b; at(2,1)=b; at(2,2)=a;
    at(3,3)=g;
    at(4,4)=g;
    at(5,5)=g;
}

// ---------------------------------------------------------- sparse CSR matrix
//
// Built from a triplet stage (std::map keyed on (row,col)) then frozen
// into CSR for fast matvec.  Symmetric assembly — we store both halves.

struct Sparse {
    int n = 0;
    std::vector<int>    row_ptr; // size n+1
    std::vector<int>    col;
    std::vector<double> val;

    // Triplet build helpers (used during assembly only).
    using Trip = std::map<std::pair<int,int>, double>;

    static Sparse fromTriplets(int n, Trip& trips) {
        Sparse S;
        S.n = n;
        S.row_ptr.resize(n + 1, 0);
        for (auto& kv : trips) S.row_ptr[kv.first.first + 1]++;
        for (int i = 0; i < n; ++i) S.row_ptr[i + 1] += S.row_ptr[i];
        S.col.resize(trips.size());
        S.val.resize(trips.size());
        std::vector<int> cursor(n, 0);
        for (auto& kv : trips) {
            int r = kv.first.first;
            int p = S.row_ptr[r] + cursor[r]++;
            S.col[p] = kv.first.second;
            S.val[p] = kv.second;
        }
        return S;
    }

    void matvec(const std::vector<double>& x, std::vector<double>& y) const {
        std::fill(y.begin(), y.end(), 0.0);
        for (int i = 0; i < n; ++i) {
            double s = 0.0;
            for (int p = row_ptr[i]; p < row_ptr[i + 1]; ++p) {
                s += val[p] * x[col[p]];
            }
            y[i] = s;
        }
    }

    // Find diagonal entry value at row i (0 if absent).
    double diag(int i) const {
        for (int p = row_ptr[i]; p < row_ptr[i + 1]; ++p) {
            if (col[p] == i) return val[p];
        }
        return 0.0;
    }
};

// --------------------------------------------------- Jacobi-preconditioned CG
//
// Solves Sx = b for symmetric positive-definite S.  Returns iteration
// count.  No external lib.  Inline well under 100 lines.

int conjugateGradient(const Sparse& S, const std::vector<double>& b,
                      std::vector<double>& x, int maxIter, double tol,
                      double& finalRes) {
    int n = S.n;
    std::vector<double> r(n), z(n), p(n), Ap(n), Minv(n);
    for (int i = 0; i < n; ++i) {
        double d = S.diag(i);
        Minv[i] = (std::abs(d) > 1e-30) ? 1.0 / d : 1.0;
    }
    // r = b - S x
    S.matvec(x, Ap);
    for (int i = 0; i < n; ++i) r[i] = b[i] - Ap[i];
    for (int i = 0; i < n; ++i) z[i] = Minv[i] * r[i];
    p = z;
    double rz = 0.0;
    for (int i = 0; i < n; ++i) rz += r[i] * z[i];

    double bnorm = 0.0;
    for (double bi : b) bnorm += bi * bi;
    bnorm = std::sqrt(bnorm);
    if (bnorm < 1e-30) bnorm = 1.0;

    int it = 0;
    for (; it < maxIter; ++it) {
        S.matvec(p, Ap);
        double pAp = 0.0;
        for (int i = 0; i < n; ++i) pAp += p[i] * Ap[i];
        if (std::abs(pAp) < 1e-30) break;
        double alpha = rz / pAp;
        for (int i = 0; i < n; ++i) x[i] += alpha * p[i];
        for (int i = 0; i < n; ++i) r[i] -= alpha * Ap[i];
        double rnorm = 0.0;
        for (double ri : r) rnorm += ri * ri;
        rnorm = std::sqrt(rnorm);
        finalRes = rnorm / bnorm;
        if (finalRes < tol) { ++it; break; }
        for (int i = 0; i < n; ++i) z[i] = Minv[i] * r[i];
        double rzNew = 0.0;
        for (int i = 0; i < n; ++i) rzNew += r[i] * z[i];
        double beta = rzNew / rz;
        rz = rzNew;
        for (int i = 0; i < n; ++i) p[i] = z[i] + beta * p[i];
    }
    return it;
}

// ------------------------------------------------------- assembly + utilities

// Map original node id → compact 0-based index used during solve.
struct CompactMap {
    std::unordered_map<int, int> orig2compact;
    std::vector<int> compact2orig;
    int add(int o) {
        auto [it, ins] = orig2compact.emplace(o, static_cast<int>(compact2orig.size()));
        if (ins) compact2orig.push_back(o);
        return it->second;
    }
};

void assembleKe(const std::array<double, 6 * 12>& B,
                const std::array<double, 36>& D,
                double V,
                std::array<double, 144>& Ke) {
    // Ke = V * Bᵀ D B
    std::array<double, 6 * 12> DB{}; // 6×12
    for (int i = 0; i < 6; ++i) {
        for (int j = 0; j < 12; ++j) {
            double s = 0.0;
            for (int k = 0; k < 6; ++k) s += D[i * 6 + k] * B[k * 12 + j];
            DB[i * 12 + j] = s;
        }
    }
    for (int i = 0; i < 12; ++i) {
        for (int j = 0; j < 12; ++j) {
            double s = 0.0;
            for (int k = 0; k < 6; ++k) s += B[k * 12 + i] * DB[k * 12 + j];
            Ke[i * 12 + j] = V * s;
        }
    }
}

// Consistent Tet4 mass: M_e = (ρ V / 20) * (2 on diag block, 1 elsewhere)
// per 3x3 block (translational lumping per coordinate).
void assembleMe(double rho, double V, std::array<double, 144>& Me) {
    double base = rho * std::abs(V) / 20.0;
    for (int i = 0; i < 12; ++i) for (int j = 0; j < 12; ++j) Me[i * 12 + j] = 0.0;
    for (int a = 0; a < 4; ++a) {
        for (int b = 0; b < 4; ++b) {
            double coef = (a == b) ? 2.0 : 1.0;
            for (int k = 0; k < 3; ++k) {
                Me[(3 * a + k) * 12 + (3 * b + k)] = base * coef;
            }
        }
    }
}

// ==================================================== shape → triangulation
//
// Walks all FACE TopoDS entities, asks BRepMesh for triangulations, and
// returns the unique vertex list + triangle index list.  Vertices are
// merged within `mergeTol` (typically 1e-6 * bbox diagonal).
//
// `triFace` (optional, T-035) receives, per triangle, the index of the face it came from
// in TopExp_Explorer(shape, TopAbs_FACE) order — the order buildCadGeometry() uses — so
// the boundary refinement can put every point it adds back ON that face's geometry.

void extractTrianglesAndVertices(const TopoDS_Shape& shape,
                                 double mergeTol,
                                 std::vector<Vec3>& uniqueVerts,
                                 std::vector<std::array<int, 3>>& triangles,
                                 std::vector<int>* triFace = nullptr) {
    // Spatial hash for vertex merging.
    auto key = [&](const Vec3& v) {
        double inv = 1.0 / mergeTol;
        return std::array<long long, 3>{
            static_cast<long long>(std::floor(v.x * inv)),
            static_cast<long long>(std::floor(v.y * inv)),
            static_cast<long long>(std::floor(v.z * inv))
        };
    };
    struct KeyHash {
        std::size_t operator()(const std::array<long long, 3>& k) const noexcept {
            std::uint64_t h = 1469598103934665603ull;
            for (auto v : k) {
                h ^= static_cast<std::uint64_t>(v);
                h *= 1099511628211ull;
            }
            return static_cast<std::size_t>(h);
        }
    };
    std::unordered_map<std::array<long long, 3>, int, KeyHash> seen;

    auto insertPoint = [&](const Vec3& v) {
        auto k = key(v);
        for (int di = -1; di <= 1; ++di) {
            for (int dj = -1; dj <= 1; ++dj) {
                for (int dk = -1; dk <= 1; ++dk) {
                    auto kn = k;
                    kn[0] += di; kn[1] += dj; kn[2] += dk;
                    auto it = seen.find(kn);
                    if (it != seen.end()) {
                        Vec3 d = uniqueVerts[it->second] - v;
                        if (d.norm() < mergeTol * 1.5) return it->second;
                    }
                }
            }
        }
        int id = static_cast<int>(uniqueVerts.size());
        uniqueVerts.push_back(v);
        seen[k] = id;
        return id;
    };

    int faceIndex = -1;
    for (TopExp_Explorer e(shape, TopAbs_FACE); e.More(); e.Next()) {
        ++faceIndex;
        const TopoDS_Face& F = TopoDS::Face(e.Current());
        TopLoc_Location loc;
        Handle(Poly_Triangulation) tri = ::BRep_Tool::Triangulation(F, loc);
        if (tri.IsNull()) continue;
        const gp_Trsf& trsf = loc.Transformation();
        int nNodes = tri->NbNodes();
        std::vector<int> nodeMap(nNodes + 1, -1);
        for (int i = 1; i <= nNodes; ++i) {
            gp_Pnt p = tri->Node(i);
            if (!loc.IsIdentity()) p.Transform(trsf);
            int id = insertPoint(Vec3{p.X(), p.Y(), p.Z()});
            nodeMap[i] = id;
        }
        int nTri = tri->NbTriangles();
        for (int i = 1; i <= nTri; ++i) {
            const Poly_Triangle& T = tri->Triangle(i);
            int a, b, c;
            T.Get(a, b, c);
            if (F.Orientation() == TopAbs_REVERSED) std::swap(b, c);
            std::array<int, 3> t{nodeMap[a], nodeMap[b], nodeMap[c]};
            if (t[0] == t[1] || t[1] == t[2] || t[0] == t[2]) continue;
            triangles.push_back(t);
            if (triFace) triFace->push_back(faceIndex);
        }
    }
}

// =========================================================================== //
//  T-035 — boundary samples ON the CAD geometry                                //
// =========================================================================== //
//
// MEASURED DEFECT (test/fea_tet_surface_conformance_gate.cpp, the NAFEMS LE10 slab,
// t = 0.6, pre-T-035 mesher; deviations against the true ellipsoids):
//
//     targetEdge                          0.30     0.20     0.15     0.115    0.075
//     outer-surface vertex max |dev| (m)  0.272    0.203    0.0701   0.0701   0.0701   <- frozen
//     curved facet sag max (m)            0.193    0.143    0.0602   0.0681   0.0523   <- frozen
//     LE10 mid-plane trace worst |dz| (m) 0        0.060    0.100    0.129    0.120    <- grows
//     top-face area error (m^2)          -0.674   -0.371   -0.200   -0.194   -0.189    <- frozen
//     LE10 sigma_yy error at D (%)        63.7     35.3     33.6     31.7     31.6     <- frozen
//
// densifyBoundaryRecursive() bisects the CHORDS of the surface tessellation and keeps the
// chord midpoints. Subdividing a flat facet only ever produces points on that facet, so the
// sag of the ORIGINAL tessellation is frozen into every finer mesh. The tessellation is made
// at angDefl = 0.5 rad: a 0.25 rad half-angle on the outer ellipse's 2.33 m minimum radius
// of curvature is a ~0.072 m sagitta — the scale of the frozen 0.070 m outer deviation above,
// and of the frozen 0.2 m^2 the top face is short by (a polygon inscribed with that sag).
//
// refineBoundaryOnCad() splits with the same longest-edge rule and the same stopping
// lengths, but puts every new point back ON the geometry:
//   * a point on a tessellation edge shared by triangles of TWO faces (a crease, or a smooth
//     seam between faces) goes onto the CAD EDGE CURVE the two faces share, so it is on both;
//   * any other new point (edge midpoint, leaf barycentre) goes onto its face's surface,
//     through the in-house R1 projector bounded to the face's UV box;
//   * a point on a PLANAR face, or on an edge between two planar faces, is exact already.
// A projection that fails, or that would move the point more than half the edge it splits
// (a chord's sag is below that for any arc under 180 degrees, so a larger move landed on some
// other part of the surface), keeps the chord point and is COUNTED (FORGE_FEA_TET_PROFILE=1).
//
// The split stays a BISECTION, so refinement is NESTED: halving targetEdge cuts every edge
// longer than minLen into exactly twice as many pieces and keeps every earlier edge sample. The
// price is that the boundary spacing is a staircase in targetEdge (an edge of length L ends at
// L / 2^k, k the least with L / 2^k <= minLen): a step of less than 2x can leave a region
// unrefined. MEASURED on the LE10 slab with projection: curved facet sag 0.002749 m at both
// 0.15 and 0.115, the mid-plane trace 0.0751 m at both 0.20 and 0.15, while the tet count rose
// ~2x per step. An n-section (cut into ceil(L / minLen) parts) was tried and measured: it does
// not remove the staircase either (n is an integer: L = 0.39 m is cut into 3 at both 0.15 and
// 0.115), and it loses the node row a bisected edge keeps at its midpoint — on LE10 the
// mid-plane trace went from 7.5e-5 m to 0.1275 m at 0.115 and the error from 18.0 % to 19.2 %.
// So convergence is asserted across ratio-2 steps (test/fea_tet_surface_conformance_gate.cpp).
//
// The interior lattice is unchanged except that a lattice point closer than kKeepOut *
// targetEdge to the refined boundary triangulation is not inserted: it would sit between the
// boundary samples and the surface and, once the outside tets are carved away, become a
// boundary vertex off the geometry (a step). The keep-out alone was measured to change
// nothing (2026-09-10, max |dev| identical at every level) because the frozen deviation was
// the chord sag; with the samples on the geometry it is what keeps lattice points off it —
// MUTATION-TESTED: without it 7 lattice vertices are exposed on the LE10 slab at 0.15 (inner
// surface vertex deviation 2.1e-4 m instead of 2.3e-8 m) and 12 on LE1 at 0.09.

constexpr double kKeepOut = 0.5;   // interior lattice keep-out from the boundary, x targetEdge

bool feaTetProfileEnabled() {
    static const bool on = [] {
        const char* e = std::getenv("FORGE_FEA_TET_PROFILE");
        return e && *e && *e != '0';
    }();
    return on;
}

struct CadFace {
    Handle(Geom_Surface) surf;              // GLOBAL frame (BRep_Tool::Surface applies the location)
    double u1 = 0.0, u2 = 0.0, v1 = 0.0, v2 = 0.0;   // the face's UV box (BRepTools::UVBounds)
    bool planar = false;
    bool ok = false;
};
struct CadEdge {
    Handle(Geom_Curve) crv;                 // GLOBAL frame (BRep_Tool::Curve applies the location)
    double f = 0.0, l = 0.0;
    bool ok = false;
};
struct CadGeometry {
    std::vector<CadFace> faces;                 // TopExp_Explorer(FACE) order == extractor order
    std::vector<CadEdge> edges;                 // unique edges (IsSame)
    std::vector<std::vector<int>> faceEdges;    // face -> its edge ids
};

CadGeometry buildCadGeometry(const TopoDS_Shape& shape) {
    CadGeometry g;
    std::vector<TopoDS_Edge> uniq;
    std::unordered_map<const void*, std::vector<int>> byTShape;
    for (TopExp_Explorer fe(shape, TopAbs_FACE); fe.More(); fe.Next()) {
        const TopoDS_Face& F = TopoDS::Face(fe.Current());
        CadFace cf;
        try {
            cf.surf = BRep_Tool::Surface(F);
            if (!cf.surf.IsNull()) {
                BRepTools::UVBounds(F, cf.u1, cf.u2, cf.v1, cf.v2);
                Handle(Geom_Surface) basis = cf.surf;
                if (auto tr = Handle(Geom_RectangularTrimmedSurface)::DownCast(basis); !tr.IsNull())
                    basis = tr->BasisSurface();
                cf.planar = !Handle(Geom_Plane)::DownCast(basis).IsNull();
                cf.ok = cf.u2 > cf.u1 && cf.v2 > cf.v1;
            }
        } catch (...) {
            cf.ok = false;
        }
        std::vector<int> ids;
        for (TopExp_Explorer ee(F, TopAbs_EDGE); ee.More(); ee.Next()) {
            const TopoDS_Edge& E = TopoDS::Edge(ee.Current());
            auto& bucket = byTShape[E.TShape().get()];
            int id = -1;
            for (int c : bucket) if (uniq[c].IsSame(E)) { id = c; break; }
            if (id < 0) {
                id = static_cast<int>(uniq.size());
                uniq.push_back(E);
                bucket.push_back(id);
                CadEdge ce;
                try {
                    double f = 0.0, l = 0.0;
                    Handle(Geom_Curve) c = BRep_Tool::Curve(E, f, l);
                    if (!c.IsNull() && l > f) { ce.crv = c; ce.f = f; ce.l = l; ce.ok = true; }
                } catch (...) {
                    ce.ok = false;
                }
                g.edges.push_back(ce);
            }
            if (std::find(ids.begin(), ids.end(), id) == ids.end()) ids.push_back(id);
        }
        g.faces.push_back(cf);
        g.faceEdges.push_back(std::move(ids));
    }
    return g;
}

// Nearest point on an edge's 3-D curve: a coarse scan of [f, l], then Newton on
// g(t) = C'(t).(C(t) - P), clamped to the edge's own range.
bool projectOntoCurve(const CadEdge& e, const Vec3& p, Vec3& out, double& dist) {
    if (!e.ok) return false;
    try {
        constexpr int kScan = 48;
        double bestT = e.f, bestD = std::numeric_limits<double>::max();
        for (int i = 0; i <= kScan; ++i) {
            const double t = e.f + (e.l - e.f) * (static_cast<double>(i) / kScan);
            const gp_Pnt c = e.crv->Value(t);
            const double d = (Vec3{c.X(), c.Y(), c.Z()} - p).norm();
            if (d < bestD) { bestD = d; bestT = t; }
        }
        double t = bestT;
        for (int it = 0; it < 30; ++it) {
            gp_Pnt C;
            gp_Vec d1, d2;
            e.crv->D2(t, C, d1, d2);
            const Vec3 r{C.X() - p.x, C.Y() - p.y, C.Z() - p.z};
            const Vec3 v1{d1.X(), d1.Y(), d1.Z()}, v2{d2.X(), d2.Y(), d2.Z()};
            double h = v1.dot(v1) + v2.dot(r);
            if (!(h > 1e-300)) h = v1.dot(v1);
            if (!(h > 1e-300)) break;
            const double tn = std::min(e.l, std::max(e.f, t - v1.dot(r) / h));
            const bool done = std::abs(tn - t) <= 1e-15 * std::max(1.0, e.l - e.f);
            t = tn;
            if (done) break;
        }
        const gp_Pnt c = e.crv->Value(t);
        out = Vec3{c.X(), c.Y(), c.Z()};
        dist = (out - p).norm();
        return std::isfinite(dist);
    } catch (...) {
        return false;
    }
}

// Nearest point on a face's surface within the face's UV box. Uses the in-house R1 projector
// (no TKGeomAlgo); a build without it has nothing to project with, and the caller keeps the
// chord point — exactly the pre-T-035 behaviour, and counted.
bool projectOntoFace(const CadFace& f, const Vec3& p, Vec3& out, double& dist) {
#ifdef FORGE_NATIVE_PROJECTION
    if (!f.ok) return false;
    try {
        const auto r = forge::occtproj::projectPointOnSurface(gp_Pnt(p.x, p.y, p.z), f.surf,
                                                              f.u1, f.u2, f.v1, f.v2);
        if (!r.IsDone() || r.NbPoints() < 1) return false;
        const gp_Pnt& q = r.NearestPoint();
        out = Vec3{q.X(), q.Y(), q.Z()};
        dist = (out - p).norm();
        return std::isfinite(dist);
    } catch (...) {
        return false;
    }
#else
    (void)f; (void)p; (void)out; (void)dist;
    return false;
#endif
}

struct SurfaceRefineStats {
    std::size_t added = 0;          // new boundary points actually inserted
    bool capped = false;            // the budget bound the refinement (REPORTED, never silent)
    std::size_t onFace = 0, onCrease = 0, planarExact = 0, unprojected = 0;
};

// Longest-edge bisection of the surface tessellation — the rule, stopping lengths, depth and
// budget of densifyBoundaryRecursive — with every new point ON the CAD geometry (see the block
// comment above). `pts` holds the tessellation vertices `triangles` index; `tryAdd(p)` appends
// p to the point set unless a point already sits within the merge tolerance. Corners are read
// BY VALUE per triangle: tryAdd may grow the vector `pts` refers to. `leaves` receives the
// refined surface triangles (for the interior keep-out and, T-255, the inside/outside parity),
// `leafFace` (optional) the CAD face of each.
template <class AddFn>
void refineBoundaryOnCad(const std::vector<Vec3>& pts,
                         const std::vector<std::array<int, 3>>& triangles,
                         const std::vector<int>& triFace,
                         const CadGeometry& cad,
                         AddFn&& tryAdd,
                         double minLen, double minArea,
                         std::size_t budget, int maxDepth,
                         std::vector<std::array<Vec3, 3>>& leaves,
                         SurfaceRefineStats& st,
                         std::vector<int>* leafFace = nullptr) {
    const int nFaces = static_cast<int>(cad.faces.size());
    auto faceOf = [&](std::size_t ti) -> int {
        const int f = ti < triFace.size() ? triFace[ti] : -1;
        return (f >= 0 && f < nFaces) ? f : -1;
    };

    // Tessellation edge -> the first two distinct faces whose triangles use it.
    auto ekey = [](int a, int b) -> std::uint64_t {
        if (a > b) std::swap(a, b);
        return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(a)) << 32) |
               static_cast<std::uint32_t>(b);
    };
    std::unordered_map<std::uint64_t, std::array<int, 2>> edgeFaces;
    edgeFaces.reserve(triangles.size() * 2);
    for (std::size_t ti = 0; ti < triangles.size(); ++ti) {
        const int f = faceOf(ti);
        for (int k = 0; k < 3; ++k) {
            auto [it, ins] = edgeFaces.try_emplace(ekey(triangles[ti][k], triangles[ti][(k + 1) % 3]),
                                                   std::array<int, 2>{f, -1});
            if (!ins && it->second[0] != f && it->second[1] < 0) it->second[1] = f;
        }
    }
    // A crease = an unordered pair of faces; its candidates are the CAD edges both share.
    std::map<std::pair<int, int>, int> creaseId;
    std::vector<std::vector<int>> creaseCands;
    std::vector<std::pair<int, int>> creaseFaces;
    auto tagOf = [&](int a, int b) -> int {
        auto it = edgeFaces.find(ekey(a, b));
        if (it == edgeFaces.end() || it->second[0] < 0 || it->second[1] < 0) return -1;
        const int fa = std::min(it->second[0], it->second[1]);
        const int fb = std::max(it->second[0], it->second[1]);
        auto [ci, ins] = creaseId.try_emplace({fa, fb}, static_cast<int>(creaseCands.size()));
        if (ins) {
            std::vector<int> cands;
            for (int e : cad.faceEdges[fa])
                if (cad.edges[e].ok &&
                    std::find(cad.faceEdges[fb].begin(), cad.faceEdges[fb].end(), e) != cad.faceEdges[fb].end())
                    cands.push_back(e);
            creaseCands.push_back(std::move(cands));
            creaseFaces.push_back({fa, fb});
        }
        return ci->second;
    };

    auto onGeometry = [&](const Vec3& raw, double maxMove, int face, int crease) -> Vec3 {
        if (crease >= 0) {
            const auto [fa, fb] = creaseFaces[crease];
            if (cad.faces[fa].planar && cad.faces[fb].planar) { ++st.planarExact; return raw; }  // a line
            double bestD = std::numeric_limits<double>::max();
            Vec3 best = raw;
            for (int e : creaseCands[crease]) {
                Vec3 q;
                double d = 0.0;
                if (projectOntoCurve(cad.edges[e], raw, q, d) && d < bestD) { bestD = d; best = q; }
            }
            if (bestD <= maxMove) { ++st.onCrease; return best; }
            ++st.unprojected;
            return raw;
        }
        if (face >= 0) {
            if (cad.faces[face].planar) { ++st.planarExact; return raw; }
            Vec3 q;
            double d = 0.0;
            if (projectOntoFace(cad.faces[face], raw, q, d) && d <= maxMove) { ++st.onFace; return q; }
        }
        ++st.unprojected;
        return raw;
    };

    struct Item { Vec3 v[3]; int depth; int tag[3]; };   // tag[k]: edge (v[k], v[k+1])
    std::vector<Item> stack;
    stack.reserve(256);
    for (std::size_t ti = 0; ti < triangles.size(); ++ti) {
        const int face = faceOf(ti);
        const auto& T = triangles[ti];
        stack.push_back({{pts[T[0]], pts[T[1]], pts[T[2]]}, 0,
                         {tagOf(T[0], T[1]), tagOf(T[1], T[2]), tagOf(T[2], T[0])}});
        while (!stack.empty()) {
            const Item it = stack.back();
            stack.pop_back();
            const Vec3 &A = it.v[0], &B = it.v[1], &C = it.v[2];
            const double len[3] = {(B - A).norm(), (C - B).norm(), (A - C).norm()};
            // Same tie-break as densifyBoundaryRecursive: ab, then bc, then ca.
            int k = 2;
            if (len[0] >= len[1] && len[0] >= len[2]) k = 0;
            else if (len[1] >= len[2]) k = 1;
            const double longest = len[k];
            if (longest > minLen && it.depth < maxDepth) {
                if (st.added >= budget) {
                    st.capped = true;
                    leaves.push_back({A, B, C});
                    if (leafFace) leafFace->push_back(face);
                    continue;
                }
                const Vec3 P0 = it.v[k], P1 = it.v[(k + 1) % 3], P2 = it.v[(k + 2) % 3];
                const int t01 = it.tag[k], t12 = it.tag[(k + 1) % 3], t20 = it.tag[(k + 2) % 3];
                // The midpoint is a function of the edge alone ((P0 + P1) * 0.5 is commutative),
                // so the triangle on the other side of the edge makes the identical split and the
                // refined surface stays conforming.
                const Vec3 m = onGeometry((P0 + P1) * 0.5, 0.5 * longest, face, t01);
                if (tryAdd(m)) ++st.added;
                stack.push_back({{P0, m, P2}, it.depth + 1, {t01, -1, t20}});
                stack.push_back({{m, P1, P2}, it.depth + 1, {t01, t12, -1}});
            } else {
                leaves.push_back({A, B, C});
                if (leafFace) leafFace->push_back(face);
                const double area = 0.5 * (B - A).cross(C - A).norm();
                if (area > minArea) {
                    if (st.added < budget) {
                        const Vec3 q = onGeometry((A + B + C) * (1.0 / 3.0), 0.5 * longest, face, -1);
                        if (tryAdd(q)) ++st.added;
                    } else {
                        st.capped = true;
                    }
                }
            }
        }
    }
}

// Closest point on triangle abc to p (Ericson, Real-Time Collision Detection, 5.1.5).
Vec3 closestOnTriangle(const Vec3& p, const Vec3& a, const Vec3& b, const Vec3& c) {
    const Vec3 ab = b - a, ac = c - a, ap = p - a;
    const double d1 = ab.dot(ap), d2 = ac.dot(ap);
    if (d1 <= 0.0 && d2 <= 0.0) return a;
    const Vec3 bp = p - b;
    const double d3 = ab.dot(bp), d4 = ac.dot(bp);
    if (d3 >= 0.0 && d4 <= d3) return b;
    const double vc = d1 * d4 - d3 * d2;
    if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) return a + ab * (d1 / (d1 - d3));
    const Vec3 cp = p - c;
    const double d5 = ab.dot(cp), d6 = ac.dot(cp);
    if (d6 >= 0.0 && d5 <= d6) return c;
    const double vb = d5 * d2 - d1 * d6;
    if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) return a + ac * (d2 / (d2 - d6));
    const double va = d3 * d6 - d5 * d4;
    if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0)
        return b + (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)));
    const double denom = 1.0 / (va + vb + vc);
    return a + ab * (vb * denom) + ac * (vc * denom);
}

// Uniform bucket grid over the refined boundary triangles: "is p within r of the boundary?"
// without a B-rep classifier call.
class BoundaryProximity {
public:
    BoundaryProximity(const std::vector<std::array<Vec3, 3>>& tris, double cell)
        : tris_(tris), inv_(1.0 / std::max(cell, 1e-30)) {
        for (std::size_t t = 0; t < tris.size(); ++t) {
            const Vec3& a = tris[t][0];
            const Vec3& b = tris[t][1];
            const Vec3& c = tris[t][2];
            const Key lo = key({std::min({a.x, b.x, c.x}), std::min({a.y, b.y, c.y}), std::min({a.z, b.z, c.z})});
            const Key hi = key({std::max({a.x, b.x, c.x}), std::max({a.y, b.y, c.y}), std::max({a.z, b.z, c.z})});
            for (long long i = lo[0]; i <= hi[0]; ++i)
                for (long long j = lo[1]; j <= hi[1]; ++j)
                    for (long long k = lo[2]; k <= hi[2]; ++k)
                        cells_[Key{i, j, k}].push_back(static_cast<int>(t));
        }
    }
    bool within(const Vec3& p, double r) const {
        const Key lo = key(p - Vec3{r, r, r}), hi = key(p + Vec3{r, r, r});
        const double r2 = r * r;
        for (long long i = lo[0]; i <= hi[0]; ++i)
            for (long long j = lo[1]; j <= hi[1]; ++j)
                for (long long k = lo[2]; k <= hi[2]; ++k) {
                    auto it = cells_.find(Key{i, j, k});
                    if (it == cells_.end()) continue;
                    for (int t : it->second) {
                        const Vec3 q = closestOnTriangle(p, tris_[t][0], tris_[t][1], tris_[t][2]);
                        if ((q - p).normSquared() < r2) return true;
                    }
                }
        return false;
    }

private:
    using Key = std::array<long long, 3>;
    struct KeyHash {
        std::size_t operator()(const Key& k) const noexcept {
            std::uint64_t h = 1469598103934665603ull;
            for (auto v : k) { h ^= static_cast<std::uint64_t>(v); h *= 1099511628211ull; }
            return static_cast<std::size_t>(h);
        }
    };
    Key key(const Vec3& v) const {
        return {static_cast<long long>(std::floor(v.x * inv_)), static_cast<long long>(std::floor(v.y * inv_)),
                static_cast<long long>(std::floor(v.z * inv_))};
    }
    const std::vector<std::array<Vec3, 3>>& tris_;
    double inv_;
    std::unordered_map<Key, std::vector<int>, KeyHash> cells_;
};

// =========================================================================== //
//  T-255 — inside/outside without one B-rep classifier call per point          //
// =========================================================================== //
//
// MEASURED (T-035, sample of meshShape on the LE10 slab at targetEdge 0.075, 14,775 nodes,
// 76-126 s): 94 % of the samples (6017 of 6434) were in BRepClass3d_SClassifier::Perform,
// projecting onto the slab's B-spline faces (Extrema_GenExtPS). meshShape called it once
// per interior lattice point and once per Delaunay tet (the carve).
//
// Both questions are now answered against the REFINED BOUNDARY TRIANGULATION (the `leaves`
// of refineBoundaryOnCad: every vertex ON the CAD geometry, watertight because a split
// point is a function of its edge alone) by the parity of a ray's crossings, and the B-rep
// classifier is asked only where that answer could differ from its own:
//   * within `band` of the triangulation, band = 3 x the largest distance between a curved
//     leaf and its CAD face (MEASURED per leaf: centroid and edge midpoints projected onto
//     the face) + 10 x the merge tolerance — the faceted and the true surface bound the same
//     solid everywhere farther than that from either;
//   * where the ray grazes an edge, a vertex or the plane of a crossed triangle (undecided);
//   * everywhere, when the triangulation is not watertight (budget-capped refinement) or a
//     projection failed — counted, and the whole call then classifies as before.
// FORGE_FEA_TET_CARVE_VERIFY=1 additionally asks the classifier at every point the parity
// decided and counts disagreements (stderr, with FORGE_FEA_TET_PROFILE=1): the A/B that
// shows the kept-tet set is the one the classifier would have kept.

bool feaTetCarveVerifyEnabled() {
    static const bool on = [] {
        const char* e = std::getenv("FORGE_FEA_TET_CARVE_VERIFY");
        return e && *e && *e != '0';
    }();
    return on;
}

class SurfaceParity {
public:
    SurfaceParity(const std::vector<std::array<Vec3, 3>>& tris, double cell)
        : tris_(tris), cell_(std::max(cell, 1e-30)), inv_(1.0 / cell_), stamp_(tris.size(), 0u) {
        // A fixed direction no model axis or face normal of a CAD primitive lines up with.
        dir_ = Vec3{0.6178034, 0.3532473, 0.7025991};
        dir_ = dir_ * (1.0 / dir_.norm());
        lo_ = {std::numeric_limits<long long>::max(), std::numeric_limits<long long>::max(),
               std::numeric_limits<long long>::max()};
        hi_ = {std::numeric_limits<long long>::min(), std::numeric_limits<long long>::min(),
               std::numeric_limits<long long>::min()};
        for (std::size_t t = 0; t < tris.size(); ++t) {
            const Vec3& a = tris[t][0];
            const Vec3& b = tris[t][1];
            const Vec3& c = tris[t][2];
            const Key l = key({std::min({a.x, b.x, c.x}), std::min({a.y, b.y, c.y}), std::min({a.z, b.z, c.z})});
            const Key h = key({std::max({a.x, b.x, c.x}), std::max({a.y, b.y, c.y}), std::max({a.z, b.z, c.z})});
            for (int k = 0; k < 3; ++k) { lo_[k] = std::min(lo_[k], l[k]); hi_[k] = std::max(hi_[k], h[k]); }
            for (long long i = l[0]; i <= h[0]; ++i)
                for (long long j = l[1]; j <= h[1]; ++j)
                    for (long long k = l[2]; k <= h[2]; ++k)
                        cells_[Key{i, j, k}].push_back(static_cast<int>(t));
        }
    }

    // Is the triangle soup a closed surface: every edge (by exact vertex coordinates) shared by
    // exactly two triangles?
    bool watertight() const {
        struct EK {
            double c[6];
            bool operator==(const EK& o) const { for (int i = 0; i < 6; ++i) if (c[i] != o.c[i]) return false; return true; }
        };
        struct EH {
            std::size_t operator()(const EK& k) const noexcept {
                std::uint64_t h = 1469598103934665603ull;
                for (double d : k.c) { std::uint64_t u; std::memcpy(&u, &d, sizeof u); h ^= u; h *= 1099511628211ull; }
                return static_cast<std::size_t>(h);
            }
        };
        std::unordered_map<EK, int, EH> cnt;
        cnt.reserve(tris_.size() * 2);
        auto less = [](const Vec3& p, const Vec3& q) {
            return p.x != q.x ? p.x < q.x : (p.y != q.y ? p.y < q.y : p.z < q.z);
        };
        for (const auto& t : tris_)
            for (int k = 0; k < 3; ++k) {
                Vec3 p = t[k], q = t[(k + 1) % 3];
                if (less(q, p)) std::swap(p, q);
                ++cnt[EK{{p.x, p.y, p.z, q.x, q.y, q.z}}];
            }
        for (const auto& kv : cnt) if (kv.second != 2) return false;
        return !tris_.empty();
    }

    // +1 inside, 0 outside, -1 undecided.
    int classify(const Vec3& p) const {
        if (++cur_ == 0) { std::fill(stamp_.begin(), stamp_.end(), 0u); cur_ = 1; }
        Key c = key(p);
        // Outside the triangulation's cell box the ray need only be cast from its entry; a
        // point outside the box is outside the solid.
        for (int k = 0; k < 3; ++k) if (c[k] < lo_[k] || c[k] > hi_[k]) return 0;
        const double d[3] = {dir_.x, dir_.y, dir_.z};
        const double o[3] = {p.x, p.y, p.z};
        long long idx[3] = {c[0], c[1], c[2]};
        int step[3];
        double tMax[3], tDelta[3];
        for (int k = 0; k < 3; ++k) {
            step[k] = d[k] > 0 ? 1 : -1;
            const double boundary = (static_cast<double>(idx[k]) + (d[k] > 0 ? 1.0 : 0.0)) * cell_;
            tMax[k] = (boundary - o[k]) / d[k];
            tDelta[k] = cell_ / std::abs(d[k]);
        }
        int hits = 0;
        for (;;) {
            auto it = cells_.find(Key{idx[0], idx[1], idx[2]});
            if (it != cells_.end()) {
                for (int t : it->second) {
                    if (stamp_[t] == cur_) continue;
                    stamp_[t] = cur_;
                    const int r = crossing(p, tris_[t]);
                    if (r < 0) return -1;
                    hits += r;
                }
            }
            int ax = 0;
            if (tMax[1] < tMax[ax]) ax = 1;
            if (tMax[2] < tMax[ax]) ax = 2;
            idx[ax] += step[ax];
            tMax[ax] += tDelta[ax];
            if (idx[ax] < lo_[ax] || idx[ax] > hi_[ax]) break;
        }
        return (hits & 1) ? 1 : 0;
    }

private:
    using Key = std::array<long long, 3>;
    struct KeyHash {
        std::size_t operator()(const Key& k) const noexcept {
            std::uint64_t h = 1469598103934665603ull;
            for (auto v : k) { h ^= static_cast<std::uint64_t>(v); h *= 1099511628211ull; }
            return static_cast<std::size_t>(h);
        }
    };
    Key key(const Vec3& v) const {
        return {static_cast<long long>(std::floor(v.x * inv_)), static_cast<long long>(std::floor(v.y * inv_)),
                static_cast<long long>(std::floor(v.z * inv_))};
    }
    // Does the ray p + s dir (s > 0) cross triangle abc? 1 yes, 0 no, -1 too close to call
    // (through an edge or a vertex, in the triangle's plane, or from a point on it).
    int crossing(const Vec3& p, const std::array<Vec3, 3>& tri) const {
        constexpr double kBary = 1e-9;
        const Vec3 e1 = tri[1] - tri[0], e2 = tri[2] - tri[0];
        const Vec3 pv = dir_.cross(e2);
        const double det = e1.dot(pv);
        const double scale = e1.norm() * e2.norm();
        const Vec3 tv = p - tri[0];
        if (std::abs(det) <= 1e-12 * scale) {
            // parallel: a miss unless the ray runs in the triangle's plane
            const Vec3 n = e1.cross(e2);
            const double nn = n.norm();
            if (!(nn > 0)) return -1;                      // degenerate triangle
            return std::abs(n.dot(tv)) / nn <= 1e-9 * std::sqrt(scale) ? -1 : 0;
        }
        const double inv = 1.0 / det;
        const double u = tv.dot(pv) * inv;
        if (u < -kBary || u > 1.0 + kBary) return 0;
        const Vec3 qv = tv.cross(e1);
        const double v = dir_.dot(qv) * inv;
        if (v < -kBary || u + v > 1.0 + kBary) return 0;
        const double s = e2.dot(qv) * inv;
        const double len = std::sqrt(scale);
        if (s < -1e-9 * len) return 0;                     // behind the start point
        if (s <= 1e-9 * len) return -1;                    // the start point is on it
        if (u < kBary || v < kBary || u + v > 1.0 - kBary) return -1;   // through an edge / vertex
        return 1;
    }

    const std::vector<std::array<Vec3, 3>>& tris_;
    double cell_, inv_;
    Vec3 dir_;
    Key lo_, hi_;
    std::unordered_map<Key, std::vector<int>, KeyHash> cells_;
    mutable std::vector<unsigned> stamp_;
    mutable unsigned cur_ = 0;
};

struct InsideStats {
    bool fast = false;                 // parity in use (false: every point went to the classifier)
    double band = 0, maxLeafDev = 0;   // m
    std::size_t curvedLeaves = 0, parity = 0, inBand = 0, undecided = 0, classifierCalls = 0, mismatches = 0;
};

// "Is p IN the solid?" as BRepClass3d_SolidClassifier::Perform(p, tol) answers it, asked of the
// classifier only where the boundary parity could differ from it (see the block comment above).
class InsideTest {
public:
    InsideTest(const std::vector<std::array<Vec3, 3>>& leaves, const std::vector<int>& leafFace,
               const CadGeometry& cad, double cell, double mergeTol, bool capped,
               BRepClass3d_SolidClassifier& cls, InsideStats& st)
        : cls_(cls), st_(st), near_(leaves, cell), parity_(leaves, cell), verify_(feaTetCarveVerifyEnabled()) {
        bool ok = !capped && !leaves.empty() && leafFace.size() == leaves.size();
        double dev = 0;
        for (std::size_t i = 0; ok && i < leaves.size(); ++i) {
            const int f = leafFace[i];
            if (f < 0 || f >= static_cast<int>(cad.faces.size())) { ok = false; break; }
            if (cad.faces[f].planar) continue;            // a planar leaf lies in its face
            ++st_.curvedLeaves;
            const auto& L = leaves[i];
            const Vec3 probe[4] = {(L[0] + L[1] + L[2]) * (1.0 / 3.0), (L[0] + L[1]) * 0.5,
                                   (L[1] + L[2]) * 0.5, (L[2] + L[0]) * 0.5};
            for (const Vec3& q : probe) {
                Vec3 on;
                double d = 0.0;
                if (!projectOntoFace(cad.faces[f], q, on, d)) { ok = false; break; }
                dev = std::max(dev, d);
            }
        }
        if (ok) ok = parity_.watertight();
        st_.fast = ok;
        st_.maxLeafDev = dev;
        band_ = 3.0 * dev + 10.0 * mergeTol;
        st_.band = band_;
    }

    bool in(const Vec3& p, double tol) {
        if (st_.fast) {
            if (!near_.within(p, band_)) {
                const int r = parity_.classify(p);
                if (r >= 0) {
                    ++st_.parity;
                    if (verify_ && classify(p, tol) != (r == 1)) ++st_.mismatches;
                    return r == 1;
                }
                ++st_.undecided;
            } else {
                ++st_.inBand;
            }
        }
        ++st_.classifierCalls;
        return classify(p, tol);
    }

private:
    bool classify(const Vec3& p, double tol) {
        cls_.Perform(gp_Pnt(p.x, p.y, p.z), tol);
        return cls_.State() == TopAbs_IN;
    }
    BRepClass3d_SolidClassifier& cls_;
    InsideStats& st_;
    BoundaryProximity near_;
    SurfaceParity parity_;
    bool verify_;
    double band_ = 0.0;
};

// =========================================================================== //
//  T-253 — sliver removal: flips, interior smoothing, flat boundary caps       //
// =========================================================================== //
//
// MEASURED DEFECT (after T-035): the exact Bowyer-Watson fill is a VALID tetrahedralization
// but a Delaunay one, and Delaunay keeps SLIVERS — four nearly coplanar, nearly cocircular
// vertices, a tet with a good circumradius-to-edge ratio and almost no volume. The boundary
// samples are cospherical by construction (rings of a cylinder; the LE1 slab's top and bottom
// faces sampled at the same (x, y), so every vertical quad through the thickness is a
// near-rectangle) and the lattice is cubic, so ties are everywhere. Census of the carved fill
// (radius ratio 3 r_in / R; tets < 0.02 counted, min in brackets):
//     LE1 slab  0.17 / 0.12 / 0.09         4 / 4 / 16          (min 1.35e-11 at 0.09)
//     LE10 slab 0.30 / 0.20 / 0.15 / 0.115 / 0.075   14 / 109 / 210 / 23 / 792
//     cylinder  0.15 / 0.075               511 / 2473          (min 3.8e-7)
// and they are what conditioned the solve: LE1 CG 2739 / 6437 / 46381 iterations at
// 0.17 / 0.12 / 0.09 (25,736 at 0.09 on the pre-T-035 mesh).
//
// improveSlivers() post-processes the carved tet set:
//   * EDGE REMOVAL (n -> 2n - 4; n = 3 is the 3-2 flip) on an INTERIOR edge (a closed ring of
//     n <= kMaxRing tets): the ring polygon is re-triangulated by the O(n^3) dynamic programme
//     that maximises the minimum quality of the new tets (Klincsek; Shewchuk 2002, "Two
//     discrete optimization algorithms for the topological improvement of tetrahedral
//     meshes"). It does almost all of the work (LE1 at 0.09: 32 removals, nothing else);
//   * the 2-3 FLIP on an INTERIOR face (rarely the best move: 1 on the LE10 slab at 0.075);
//   * SMOOTHING of an INTERIOR (lattice) vertex of a tet still bad after the flips: the
//     neighbour centroid, then a compass search, snapped to bowyerWatson's grid, kept only if
//     the minimum quality of its star rises. Without it the LE10 slab at 0.075 keeps 6
//     slivers (min 2.9e-4), interior quads of two symmetry-plane samples and two lattice
//     points that no flip of a closed ring can reach;
//   * deleting a FLAT CAP: a tet below 0.02 with exactly two boundary faces whose interior
//     dihedral at their common edge is >= kCapMinDihedral (the surface is flat across it),
//     when its opposite edge is not already a boundary edge and no vertex would be orphaned —
//     the surface edge flip of a cap made of four samples of one smooth face. Removing the
//     opposite edge instead (which would keep the outer pair) is INVALID for almost all of
//     them (MEASURED, cylinder at 0.15, all 355 caps removed: for 290 that ring has no valid
//     re-triangulation — its inner vertices all lie on one side of the cap — and for the other
//     65 only a worse one), so the cap goes and its inner pair of faces becomes the boundary. The
//     vertices stay ON the geometry; what changes is which diagonal of a near-planar quad the
//     surface uses. Cost, MEASURED on the cylinder (0.3 / 0.15 / 0.075): facet sag
//     6.94e-3 / 1.74e-3 / 4.35e-4 m -> 6.94e-3 / 2.54e-3 / 6.36e-4 m and volume error
//     -0.83 / -0.15 / -0.030 % -> -0.98 / -0.33 / -0.065 %, both still converging at the same
//     order; on the LE10 slab the curved facet sag is unchanged at every level.
// Flips and smoothing never touch a boundary face or vertex. Every operation is applied only
// if the minimum quality of what it creates EXCEEDS the minimum of what it removes (a cap
// removal creates nothing): the ascending-sorted quality vector rises lexicographically at
// every step, so the loop terminates and the global minimum never falls. A new or moved tet
// must be EXACTLY positively oriented on the snapped coordinates, so the result stays a valid
// tetrahedralization. FORGE_FEA_TET_IMPROVE=0 switches the whole step off (A/B diagnostics);
// FORGE_FEA_TET_PROFILE=1 prints what it did.

constexpr double kImproveBelow   = 0.15;   // radius ratio a tet is worked on below
constexpr double kCapMinDihedral = 150.0;  // deg, interior dihedral of a removable flat cap
constexpr int    kMaxRing        = 8;      // largest edge ring edge removal handles
constexpr int    kImprovePasses  = 12;     // flip passes per round
constexpr int    kImproveRounds  = 4;      // flip passes + one smoothing pass

bool feaTetImproveEnabled() {
    static const bool on = [] {
        const char* e = std::getenv("FORGE_FEA_TET_IMPROVE");   // A/B diagnostics only: "0" = off
        return !(e && *e == '0');
    }();
    return on;
}

// Radius ratio 3 r_in / R (1 for the regular tet, -> 0 for a flat one); 0 if V6 <= 0.
double radiusRatioOf(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d) {
    const Vec3 u = b - a, v = c - a, w = d - a;
    const Vec3 uv = u.cross(v), uw = u.cross(w), vw = v.cross(w), wu = w.cross(u);
    const double V6 = uv.dot(w);
    if (!(V6 > 0)) return 0.0;
    const Vec3 bcd = (c - b).cross(d - b);
    const double S = 0.5 * (uv.norm() + uw.norm() + vw.norm() + bcd.norm());
    const double rin = 0.5 * V6 / S;
    const Vec3 num = vw * u.dot(u) + wu * v.dot(v) + uv * w.dot(w);
    const double R = num.norm() / (2.0 * V6);
    return R > 0 ? 3.0 * rin / R : 0.0;
}

struct ImproveStats {
    std::size_t edgeRemovals = 0, flips23 = 0, capsRemoved = 0, smoothed = 0, passes = 0;
    std::size_t badBefore = 0, badAfter = 0;          // radius ratio < 0.02
    double minBefore = 1.0, minAfter = 1.0;
};

class TetImprover {
public:
    TetImprover(const std::vector<Vec3>& P, const std::vector<LocalTet>& tets, double snapQ)
        : P_(P), snapQ_(snapQ), inc_(P.size()), onBoundary_(P.size(), 0) {
        T_.reserve(tets.size() * 2);
        for (const auto& t : tets) add({t.n[0], t.n[1], t.n[2], t.n[3]});
        // Boundary vertices never move. (Flips never touch the boundary and a cap removal only
        // exposes faces whose vertices were boundary vertices already, so this set is fixed.)
        for (std::size_t i = 0; i < T_.size(); ++i)
            for (int f = 0; f < 4; ++f) {
                int o[2];
                const int a = T_[i][(f + 1) & 3], b = T_[i][(f + 2) & 3], c = T_[i][(f + 3) & 3];
                if (tetsWithFace(a, b, c, o) == 1) onBoundary_[a] = onBoundary_[b] = onBoundary_[c] = 1;
            }
    }

    void run(ImproveStats& st) {
        census(st.minBefore, st.badBefore);
        for (int round = 0; round < kImproveRounds; ++round) {
            flipPasses(st);
            if (smoothPass(st) == 0) break;
        }
        census(st.minAfter, st.badAfter);
    }

    const std::vector<Vec3>& points() const { return P_; }

    std::vector<LocalTet> result() const {
        std::vector<LocalTet> out;
        out.reserve(T_.size());
        for (std::size_t i = 0; i < T_.size(); ++i)
            if (alive_[i]) out.push_back({{T_[i][0], T_[i][1], T_[i][2], T_[i][3]}});
        return out;
    }

private:
    using Tet4 = std::array<int, 4>;
    struct Plan {
        std::vector<int> kill;
        std::vector<Tet4> add;
        std::vector<double> addQ;
        double oldMin = 0, newMin = -1;
    };

    std::vector<Vec3> P_;                 // own copy: smoothing moves interior vertices
    double snapQ_;                        // bowyerWatson's coordinate grid (exact predicates)
    std::vector<Tet4> T_;
    std::vector<double> q_;
    std::vector<char> alive_;
    std::vector<std::vector<int>> inc_;   // vertex -> ids of the ALIVE tets using it
    std::vector<char> onBoundary_;

    void flipPasses(ImproveStats& st) {
        std::vector<int> bad;
        for (int pass = 0; pass < kImprovePasses; ++pass) {
            ++st.passes;
            bad.clear();
            for (int i = 0; i < static_cast<int>(T_.size()); ++i)
                if (alive_[i] && q_[i] < kImproveBelow) bad.push_back(i);
            std::sort(bad.begin(), bad.end(), [&](int x, int y) { return q_[x] < q_[y]; });
            std::size_t applied = 0;
            for (int t : bad) {
                if (!alive_[t]) continue;
                if (improveTet(t, st)) ++applied;
            }
            if (applied == 0) break;
        }
    }

    // Min quality of the tets around v with v placed at p (-1 if any is not positively oriented).
    double starMin(int v, const Vec3& p) {
        const Vec3 keep = P_[v];
        P_[v] = p;
        double m = 2.0;
        for (int id : inc_[v]) {
            const auto& t = T_[id];
            m = std::min(m, quality(t[0], t[1], t[2], t[3]));
            if (m <= 0) break;
        }
        P_[v] = keep;
        return m;
    }
    Vec3 snapped(const Vec3& p) const {
        auto sn = [this](double x) { return std::nearbyint(x / snapQ_) * snapQ_; };
        return {sn(p.x), sn(p.y), sn(p.z)};
    }
    // Move interior vertex v to raise the minimum quality of its star: the neighbour centroid
    // (Laplacian) at a few step lengths, then a compass search along the axes with a halving
    // step. Kept only if the star's minimum strictly rises; every star tet stays EXACTLY
    // positive (quality() is -1 otherwise), so the mesh stays valid.
    bool smoothVertex(int v) {
        if (onBoundary_[v] || inc_[v].empty() || !(snapQ_ > 0)) return false;
        const double start = starMin(v, P_[v]);
        double cur = start;
        Vec3 at = P_[v];
        Vec3 cen{0, 0, 0};
        double lsum = 0;
        int nn = 0;
        for (int id : inc_[v])
            for (int w : T_[id])
                if (w != v) { cen = cen + P_[w]; lsum += (P_[w] - P_[v]).norm(); ++nn; }
        if (nn == 0) return false;
        cen = cen * (1.0 / nn);
        const double lavg = lsum / nn;
        for (double a : {1.0, 0.5, 0.25, 0.1}) {
            const Vec3 p = snapped(at + (cen - at) * a);
            const double m = starMin(v, p);
            if (m > cur) { cur = m; at = p; break; }
        }
        const Vec3 dirs[6] = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};
        for (double h = 0.1 * lavg; h > 1e-3 * lavg; h *= 0.5) {
            bool moved = true;
            for (int it = 0; it < 8 && moved; ++it) {
                moved = false;
                for (const Vec3& d : dirs) {
                    const Vec3 p = snapped(at + d * h);
                    const double m = starMin(v, p);
                    if (m > cur) { cur = m; at = p; moved = true; }
                }
            }
        }
        if (!(cur > start)) return false;
        P_[v] = at;
        for (int id : inc_[v]) q_[id] = radiusRatioOf(P_[T_[id][0]], P_[T_[id][1]], P_[T_[id][2]], P_[T_[id][3]]);
        return true;
    }
    std::size_t smoothPass(ImproveStats& st) {
        std::vector<int> bad;
        for (int i = 0; i < static_cast<int>(T_.size()); ++i)
            if (alive_[i] && q_[i] < kImproveBelow) bad.push_back(i);
        std::sort(bad.begin(), bad.end(), [&](int x, int y) { return q_[x] < q_[y]; });
        std::size_t moved = 0;
        for (int t : bad) {
            if (!alive_[t] || !(q_[t] < kImproveBelow)) continue;
            const Tet4 A = T_[t];
            for (int v : A) if (smoothVertex(v)) ++moved;
        }
        st.smoothed += moved;
        return moved;
    }

    void census(double& mn, std::size_t& bad) const {
        mn = 1.0; bad = 0;
        for (std::size_t i = 0; i < T_.size(); ++i) {
            if (!alive_[i]) continue;
            mn = std::min(mn, q_[i]);
            if (q_[i] < 0.02) ++bad;
        }
    }
    // Quality of the tet abcd as oriented: -1 unless EXACTLY positively oriented.
    double quality(int a, int b, int c, int d) const {
        if (orientSign(P_[a], P_[b], P_[c], P_[d]) <= 0) return -1.0;
        return radiusRatioOf(P_[a], P_[b], P_[c], P_[d]);
    }
    int add(const Tet4& t, double q = -2.0) {
        const int id = static_cast<int>(T_.size());
        T_.push_back(t);
        q_.push_back(q > -2.0 ? q : radiusRatioOf(P_[t[0]], P_[t[1]], P_[t[2]], P_[t[3]]));
        alive_.push_back(1);
        for (int v : t) inc_[v].push_back(id);
        return id;
    }
    void kill(int id) {
        alive_[id] = 0;
        for (int v : T_[id]) {
            auto& l = inc_[v];
            for (std::size_t k = 0; k < l.size(); ++k)
                if (l[k] == id) { l[k] = l.back(); l.pop_back(); break; }
        }
    }
    bool has(int id, int v) const { const auto& t = T_[id]; return t[0] == v || t[1] == v || t[2] == v || t[3] == v; }
    int tetsWithFace(int a, int b, int c, int out[2]) const {
        int n = 0;
        for (int id : inc_[a])
            if (has(id, b) && has(id, c)) { if (n < 2) out[n] = id; ++n; }
        return n;
    }
    bool isBoundaryEdge(int a, int b) const {
        for (int id : inc_[a]) {
            if (!has(id, b)) continue;
            for (int v : T_[id]) {
                if (v == a || v == b) continue;
                int o[2];
                if (tetsWithFace(a, b, v, o) == 1) return true;
            }
        }
        return false;
    }
    void apply(const Plan& p) {
        for (int id : p.kill) kill(id);
        for (std::size_t i = 0; i < p.add.size(); ++i) add(p.add[i], p.addQ[i]);
    }

    // Edge removal of (a, b): fills `p` and returns true when (a, b) is interior, its ring has
    // 3..kMaxRing tets and some re-triangulation is valid; p.newMin is its best minimum.
    bool planEdgeRemoval(int a, int b, Plan& p) const {
        std::vector<int> ring;
        for (int id : inc_[a]) if (has(id, b)) ring.push_back(id);
        const int n = static_cast<int>(ring.size());
        if (n < 3 || n > kMaxRing) return false;
        // ring edges (c, d): the two other vertices of each tet
        std::vector<std::array<int, 2>> re(n);
        for (int i = 0; i < n; ++i) {
            int k = 0;
            for (int v : T_[ring[i]]) if (v != a && v != b) re[i][k++] = v;
        }
        // walk the cycle
        std::vector<int> r;
        std::vector<char> used(n, 0);
        r.push_back(re[0][0]);
        r.push_back(re[0][1]);
        used[0] = 1;
        for (int step = 1; step < n; ++step) {
            const int last = r.back();
            int nxt = -1;
            for (int i = 0; i < n && nxt < 0; ++i) {
                if (used[i]) continue;
                if (re[i][0] == last) { nxt = re[i][1]; used[i] = 1; }
                else if (re[i][1] == last) { nxt = re[i][0]; used[i] = 1; }
            }
            if (nxt < 0) return false;            // open ring: a boundary edge
            r.push_back(nxt);
        }
        if (r.back() != r.front()) return false;  // not a single closed cycle
        r.pop_back();
        if (static_cast<int>(r.size()) != n) return false;
        // orientation of the cycle: tetVolume(a, b, r0, r1) sign s
        const int s = orientSign(P_[a], P_[b], P_[r[0]], P_[r[1]]);
        if (s == 0) return false;
        auto triQ = [&](int i, int j, int k, Tet4& up, Tet4& dn) {
            if (s < 0) { up = {r[i], r[j], r[k], a}; dn = {r[i], r[k], r[j], b}; }
            else       { up = {r[i], r[k], r[j], a}; dn = {r[i], r[j], r[k], b}; }
            const double qu = quality(up[0], up[1], up[2], up[3]);
            if (qu <= 0) return -1.0;
            const double qd = quality(dn[0], dn[1], dn[2], dn[3]);
            if (qd <= 0) return -1.0;
            return std::min(qu, qd);
        };
        // DP: best[i][k] = best min quality of a triangulation of polygon r_i..r_k (k - i >= 2)
        double best[kMaxRing][kMaxRing];
        int choice[kMaxRing][kMaxRing];
        for (int i = 0; i < n; ++i)
            for (int k = 0; k < n; ++k) { best[i][k] = (k == i + 1) ? 2.0 : -1.0; choice[i][k] = -1; }
        for (int len = 2; len < n; ++len) {
            for (int i = 0; i + len < n; ++i) {
                const int k = i + len;
                for (int j = i + 1; j < k; ++j) {
                    if (best[i][j] <= 0 || best[j][k] <= 0) continue;
                    Tet4 up, dn;
                    const double qt = triQ(i, j, k, up, dn);
                    if (qt <= 0) continue;
                    const double m = std::min({best[i][j], best[j][k], qt});
                    if (m > best[i][k]) { best[i][k] = m; choice[i][k] = j; }
                }
            }
        }
        if (best[0][n - 1] <= 0) return false;
        p = Plan{};
        p.kill = ring;
        p.oldMin = 2.0;
        for (int id : ring) p.oldMin = std::min(p.oldMin, q_[id]);
        p.newMin = best[0][n - 1];
        // backtrack
        std::vector<std::array<int, 2>> stack{{0, n - 1}};
        while (!stack.empty()) {
            const auto [i, k] = stack.back();
            stack.pop_back();
            if (k - i < 2) continue;
            const int j = choice[i][k];
            Tet4 up, dn;
            const double qt = triQ(i, j, k, up, dn);
            (void)qt;
            p.add.push_back(up); p.addQ.push_back(quality(up[0], up[1], up[2], up[3]));
            p.add.push_back(dn); p.addQ.push_back(quality(dn[0], dn[1], dn[2], dn[3]));
            stack.push_back({i, j});
            stack.push_back({j, k});
        }
        return true;
    }

    // 2-3 flip across face `f` (the face opposite vertex index f) of tet t.
    bool planFlip23(int t, int f, Plan& p) const {
        const Tet4& A = T_[t];
        const int fa = A[(f + 1) & 3], fb = A[(f + 2) & 3], fc = A[(f + 3) & 3];
        int o[2];
        if (tetsWithFace(fa, fb, fc, o) != 2) return false;   // boundary face
        const int u = o[0] == t ? o[1] : o[0];
        int e = -1;
        for (int v : T_[u]) if (v != fa && v != fb && v != fc) e = v;
        if (e < 0) return false;
        p = Plan{};
        p.kill = {t, u};
        p.oldMin = std::min(q_[t], q_[u]);
        p.newMin = 2.0;
        for (int k = 0; k < 4; ++k) {
            if (k == f) continue;
            Tet4 nt = A;
            nt[k] = e;                                          // positive iff e is on a's side
            const double qq = quality(nt[0], nt[1], nt[2], nt[3]);
            if (qq <= 0) return false;
            p.add.push_back(nt);
            p.addQ.push_back(qq);
            p.newMin = std::min(p.newMin, qq);
        }
        return true;
    }

    // Interior dihedral angle (deg) of tet t at its edge (a, b).
    double dihedralAt(int t, int a, int b) const {
        int c = -1, d = -1;
        for (int v : T_[t]) if (v != a && v != b) { if (c < 0) c = v; else d = v; }
        const Vec3 e = P_[b] - P_[a];
        const Vec3 n1 = e.cross(P_[c] - P_[a]), n2 = e.cross(P_[d] - P_[a]);
        const double den = n1.norm() * n2.norm();
        if (!(den > 0)) return 0.0;
        const double cs = std::max(-1.0, std::min(1.0, n1.dot(n2) / den));
        return std::acos(cs) * (180.0 / 3.14159265358979323846);
    }

    bool tryCap(int t, ImproveStats& st) {
        const Tet4 A = T_[t];
        int bnd[4], nb = 0;
        for (int f = 0; f < 4; ++f) {
            int o[2];
            if (tetsWithFace(A[(f + 1) & 3], A[(f + 2) & 3], A[(f + 3) & 3], o) == 1) bnd[nb++] = f;
        }
        if (nb != 2) return false;
        // boundary faces are opposite vertices A[bnd[0]], A[bnd[1]]; they share the edge made of
        // the other two vertices (e1); the edge (A[bnd[0]], A[bnd[1]]) is e2.
        const int w = A[bnd[0]], x = A[bnd[1]];
        int u = -1, v = -1;
        for (int k = 0; k < 4; ++k) if (k != bnd[0] && k != bnd[1]) { if (u < 0) u = A[k]; else v = A[k]; }
        if (dihedralAt(t, u, v) < kCapMinDihedral) return false;
        if (isBoundaryEdge(w, x)) return false;                // would become non-manifold
        for (int k = 0; k < 4; ++k) if (inc_[A[k]].size() < 2) return false;   // never orphan a vertex
        kill(t);
        ++st.capsRemoved;
        return true;
    }

    bool improveTet(int t, ImproveStats& st) {
        Plan best, cand;
        int kind = 0;
        const Tet4 A = T_[t];
        for (int i = 0; i < 4; ++i)
            for (int j = i + 1; j < 4; ++j)
                if (planEdgeRemoval(A[i], A[j], cand) && cand.newMin > cand.oldMin && cand.newMin > best.newMin) {
                    best = cand; kind = 1;
                }
        for (int f = 0; f < 4; ++f)
            if (planFlip23(t, f, cand) && cand.newMin > cand.oldMin && cand.newMin > best.newMin) {
                best = cand; kind = 2;
            }
        if (kind != 0) {
            apply(best);
            if (kind == 1) ++st.edgeRemovals; else ++st.flips23;
            return true;
        }
        return q_[t] < 0.02 && tryCap(t, st);
    }
};

// Run the improver over a carved tet set, in place: `kept` is replaced by the improved tets and
// the interior vertices it moved are written back into `pts`. Returns the stats.
ImproveStats improveSlivers(std::vector<Vec3>& pts, std::vector<LocalTet>& kept, double snapQ) {
    ImproveStats st;
    if (!feaTetImproveEnabled() || kept.empty()) return st;
    const auto t0 = std::chrono::steady_clock::now();
    TetImprover imp(pts, kept, snapQ);
    imp.run(st);
    kept = imp.result();
    pts = imp.points();
    if (feaTetProfileEnabled()) {
        const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
        std::fprintf(stderr, "[feaTet] sliver removal: %zu passes, %zu edge removals, %zu 2-3 flips, %zu flat caps "
                             "removed, %zu vertex moves; radius ratio < 0.02: %zu -> %zu, min %.3g -> %.3g (%.0f ms)\n",
                     st.passes, st.edgeRemovals, st.flips23, st.capsRemoved, st.smoothed, st.badBefore, st.badAfter,
                     st.minBefore, st.minAfter, ms);
    }
    return st;
}

} // anonymous namespace

// ============================================================= public surface

Mesh meshShape(const TopoDS_Shape& shape, double targetEdge, int seedGridBudget) {
    const int seedBudget = resolveSeedGridBudget(seedGridBudget);
    bool  seedCapped     = false;
    double seedSpacing   = 0.0;
    if (shape.IsNull()) {
        throw std::invalid_argument("forge::fea::tet::meshShape: null shape");
    }
    if (!(targetEdge > 0.0)) {
        throw std::invalid_argument("forge::fea::tet::meshShape: targetEdge must be > 0");
    }

    // 1. Surface mesh — NATIVE (forge::occtmesh, no BRepMesh / TKMesh). Attaches a
    // Poly_Triangulation to every face in-place; extractTrianglesAndVertices reads
    // it back exactly like the old BRepMesh triangulation (and the tet seeder
    // classifies inside/outside with BRepClass3d_SolidClassifier, so triangle
    // winding is irrelevant to the result). TKMesh is dropped — there is NO
    // BRepMesh fallback; an unreadable face is an HONEST DEFERRAL (below).
    if (!forge::occtmesh::triangulateShapeInPlace(shape, targetEdge, /*ang*/ 0.5)) {
        // HONEST DEFERRAL: TKMesh is gone — no BRepMesh fallback. extractTriangles
        // below then finds no attached triangulation and meshShape throws its "no
        // triangles" error for THIS shape (never a crash / silent bad mesh).
        // Verified: no fea shape defers under fea_smoke / fea_nafems.
        std::fprintf(stderr, "[K5][feaTet] native occtmesh DEFERRED (no BRepMesh)\n");
    }

    // 2. Collect unique boundary vertices + triangles.
    Bnd_Box bb;
    BRepBndLib::Add(shape, bb);
    double xmin, ymin, zmin, xmax, ymax, zmax;
    bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    double diag = std::sqrt((xmax - xmin) * (xmax - xmin) +
                            (ymax - ymin) * (ymax - ymin) +
                            (zmax - zmin) * (zmax - zmin));
    double mergeTol = std::max(targetEdge * 1e-3, diag * 1e-7);

    std::vector<Vec3> bndPts;
    std::vector<std::array<int, 3>> triangles;
    std::vector<int> triFace;
    extractTrianglesAndVertices(shape, mergeTol, bndPts, triangles, &triFace);

    if (bndPts.empty() || triangles.empty()) {
        throw std::runtime_error("forge::fea::tet::meshShape: BRepMesh produced no triangles");
    }

    std::size_t nSurfPts = 0;   // [0, nSurfPts) of bndPts are boundary samples; the rest lattice

    // T-255: the refined boundary triangulation outlives the seeding block — the carve
    // classifies against it too (InsideTest below).
    std::vector<std::array<Vec3, 3>> leaves;
    std::vector<int> leafFace;
    BRepClass3d_SolidClassifier classifier(shape);
    InsideStats ist;
    std::unique_ptr<InsideTest> inside;
    const bool profile = feaTetProfileEnabled();
    auto tNow = [] { return std::chrono::steady_clock::now(); };
    auto msSince = [](std::chrono::steady_clock::time_point t0) {
        return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    };
    double msRefine = 0, msInside = 0, msLattice = 0, msBw = 0, msCarve = 0, msImprove = 0;

    // 2b. Densify seeds.
    //
    // BRepMesh on a planar face only produces corner+edge vertices — a
    // box face becomes a single 2-triangle fan with the 4 corner points,
    // regardless of `targetEdge`. To produce a useful tet mesh for FEA
    // we explicitly seed:
    //   (a) surface points: subdivide every triangle edge whose length
    //       exceeds 1.25 * targetEdge into one extra midpoint, plus the
    //       triangle barycenter if its area is large — every such point
    //       put back ON the CAD face / edge it belongs to (T-035,
    //       refineBoundaryOnCad).
    //   (b) interior points: regular grid spaced by targetEdge inside
    //       the AABB, classified IN by BRepClass3d_SolidClassifier, and
    //       kept at least kKeepOut * targetEdge off the boundary (T-035).
    //
    // De-duplication uses a spatial hash with cell size = mergeTol.
    {
        struct ArrHash {
            std::size_t operator()(const std::array<long long, 3>& k) const noexcept {
                std::uint64_t h = 1469598103934665603ull;
                for (auto v : k) { h ^= static_cast<std::uint64_t>(v); h *= 1099511628211ull; }
                return static_cast<std::size_t>(h);
            }
        };
        std::unordered_set<std::array<long long, 3>, ArrHash> occupied;
        double invCell = 1.0 / std::max(mergeTol, 1e-30);
        auto cell = [&](const Vec3& v) {
            return std::array<long long, 3>{
                static_cast<long long>(std::floor(v.x * invCell)),
                static_cast<long long>(std::floor(v.y * invCell)),
                static_cast<long long>(std::floor(v.z * invCell))
            };
        };
        for (const auto& p : bndPts) occupied.insert(cell(p));

        auto tryAdd = [&](const Vec3& p) {
            auto k = cell(p);
            // Check the 3×3×3 neighbourhood.
            for (int di = -1; di <= 1; ++di) {
                for (int dj = -1; dj <= 1; ++dj) {
                    for (int dk = -1; dk <= 1; ++dk) {
                        auto kn = k; kn[0] += di; kn[1] += dj; kn[2] += dk;
                        if (occupied.count(kn)) return false;
                    }
                }
            }
            occupied.insert(k);
            bndPts.push_back(p);
            return true;
        };

        // (a) Triangle midpoints + barycenters (operate on the original
        // triangle list to avoid iterating new points).
        const double minLen = 1.25 * targetEdge;
        const double minArea = 0.5 * targetEdge * targetEdge;
        auto t0 = tNow();
        const CadGeometry cad = buildCadGeometry(shape);
        SurfaceRefineStats rst;
        refineBoundaryOnCad(bndPts, triangles, triFace, cad, tryAdd, minLen, minArea,
                            static_cast<std::size_t>(seedBudget), 40, leaves, rst, &leafFace);
        msRefine = msSince(t0);
        t0 = tNow();
        inside = std::make_unique<InsideTest>(leaves, leafFace, cad, targetEdge, mergeTol, rst.capped, classifier, ist);
        msInside = msSince(t0);
        const bool bndCapped = rst.capped;
        nSurfPts = bndPts.size();
        if (bndCapped) {
            std::fprintf(stderr,
                         "[feaTet] boundary densification hit its budget (%d points) at "
                         "targetEdge=%.6g -- the SURFACE is coarser than requested; raise "
                         "FORGE_FEA_TET_SEED_BUDGET before trusting a convergence sweep.\n",
                         seedBudget, targetEdge);
        }
        // (b) Interior grid.
        t0 = tNow();
        int nx = 0, ny = 0, nz = 0;
        seedCapped = sizeSeedGrid(xmax - xmin, ymax - ymin, zmax - zmin,
                                  targetEdge, seedBudget, nx, ny, nz, seedSpacing);
        double dx = (xmax - xmin) / (nx + 1);
        double dy = (ymax - ymin) / (ny + 1);
        double dz = (zmax - zmin) / (nz + 1);
        const double keepOut = kKeepOut * targetEdge;
        const BoundaryProximity nearBoundary(leaves, targetEdge);
        std::size_t latticeIn = 0, latticeKeptOut = 0;
        for (int ix = 1; ix <= nx; ++ix) {
            for (int iy = 1; iy <= ny; ++iy) {
                for (int iz = 1; iz <= nz; ++iz) {
                    Vec3 p{xmin + ix * dx, ymin + iy * dy, zmin + iz * dz};
                    if (nearBoundary.within(p, keepOut)) { ++latticeKeptOut; continue; }
                    if (!inside->in(p, mergeTol)) continue;   // T-255 (was: one classifier call)
                    if (tryAdd(p)) ++latticeIn;
                }
            }
        }
        if (feaTetProfileEnabled()) {
            std::fprintf(stderr,
                         "[feaTet] targetEdge=%.6g boundary: %zu tessellation verts, +%zu refined "
                         "(on face %zu, on crease %zu, planar-exact %zu, UNPROJECTED %zu)%s; "
                         "lattice: %zu inserted, %zu within the %.3g keep-out\n",
                         targetEdge, bndPts.size() - rst.added - latticeIn, rst.added, rst.onFace,
                         rst.onCrease, rst.planarExact, rst.unprojected, rst.capped ? " CAPPED" : "",
                         latticeIn, latticeKeptOut, keepOut);
        }
        msLattice = msSince(t0);
    }

    // 3. Bowyer-Watson on the boundary points (try).
    std::vector<Vec3> ptsCopy = bndPts;
    std::vector<LocalTet> bw;
    BwStats bwStats;
    bool bwOk = true;
    auto tBw = tNow();
    try {
        bw = bowyerWatson(ptsCopy, bwStats);
    } catch (...) {
        bw.clear();
        bwOk = false;
    }
    msBw = msSince(tBw);

    Mesh out;
    if (bwOk && !bw.empty()) {
        // 4. Filter against the solid: keep tets whose centroid is inside — decided by the
        //    boundary parity, the B-rep classifier only near the boundary (T-255).
        auto tCarve = tNow();
        std::vector<LocalTet> kept;
        kept.reserve(bw.size());
        for (auto& t : bw) {
            Vec3 c = (ptsCopy[t.n[0]] + ptsCopy[t.n[1]] + ptsCopy[t.n[2]] + ptsCopy[t.n[3]])
                     * 0.25;
            if (inside->in(c, Precision::Confusion())) kept.push_back(t);
        }
        msCarve = msSince(tCarve);
        if (feaTetProfileEnabled() && !kept.empty()) {
            // Boundary recovery census: a face of the carved mesh that lies on its boundary
            // and has a LATTICE vertex is a lattice point exposed on the surface (a step).
            std::unordered_map<FaceKey, int, FaceHash> fc;
            fc.reserve(kept.size() * 4);
            for (const auto& t : kept) {
                const int* n = t.n;
                for (const FaceKey& k : {FaceKey(n[1], n[2], n[3]), FaceKey(n[0], n[2], n[3]),
                                         FaceKey(n[0], n[1], n[3]), FaceKey(n[0], n[1], n[2])})
                    ++fc[k];
            }
            std::size_t bFaces = 0, exposed = 0;
            const int ns = static_cast<int>(nSurfPts);
            for (const auto& kv : fc) {
                if (kv.second != 1) continue;
                ++bFaces;
                if (kv.first.a >= ns || kv.first.b >= ns || kv.first.c >= ns) ++exposed;
            }
            std::fprintf(stderr, "[feaTet] carve: %zu of %zu Delaunay tets kept; %zu boundary faces, "
                                 "%zu with an exposed lattice vertex\n",
                         kept.size(), bw.size(), bFaces, exposed);
        }
        auto tImp = tNow();
        improveSlivers(ptsCopy, kept, bwStats.snapQ);   // T-253
        msImprove = msSince(tImp);
        if (profile) {
            std::fprintf(stderr, "[feaTet] inside test: %s band %.3g m (max leaf-to-face %.3g m over %zu curved leaves); "
                                 "%zu by parity, %zu in the band, %zu undecided -> %zu B-rep classifier calls; "
                                 "VERIFY %s: %zu disagreements\n",
                         ist.fast ? "parity," : "B-REP ONLY", ist.band, ist.maxLeafDev, ist.curvedLeaves,
                         ist.parity, ist.inBand, ist.undecided, ist.classifierCalls,
                         feaTetCarveVerifyEnabled() ? "on" : "off", ist.mismatches);
            std::fprintf(stderr, "[feaTet] time ms: refine %.0f, inside-test setup %.0f, lattice %.0f, Bowyer-Watson %.0f, "
                                 "carve %.0f, sliver removal %.0f\n",
                         msRefine, msInside, msLattice, msBw, msCarve, msImprove);
        }
        if (!kept.empty()) {
            // Build nodes — use the union of points referenced by kept tets.
            std::unordered_map<int, int> remap;
            for (auto& t : kept) {
                for (int k = 0; k < 4; ++k) {
                    auto [it, ins] = remap.try_emplace(t.n[k], static_cast<int>(remap.size()));
                    (void)it; (void)ins;
                }
            }
            out.nodes.resize(remap.size());
            for (auto& kv : remap) {
                const Vec3& p = ptsCopy[kv.first];
                out.nodes[kv.second] = Node{p.x, p.y, p.z, kv.second};
            }
            int idc = 0;
            for (auto& t : kept) {
                Tet T{};
                T.a = remap[t.n[0]];
                T.b = remap[t.n[1]];
                T.c = remap[t.n[2]];
                T.d = remap[t.n[3]];
                // Ensure positive volume.
                double V = tetVolume({out.nodes[T.a].x, out.nodes[T.a].y, out.nodes[T.a].z},
                                     {out.nodes[T.b].x, out.nodes[T.b].y, out.nodes[T.b].z},
                                     {out.nodes[T.c].x, out.nodes[T.c].y, out.nodes[T.c].z},
                                     {out.nodes[T.d].x, out.nodes[T.d].y, out.nodes[T.d].z});
                if (V < 0.0) std::swap(T.b, T.c);
                T.id = idc++;
                out.tets.push_back(T);
            }
            stampSeedDiag(out, targetEdge, seedBudget, seedCapped, seedSpacing);
            stampBwStats(out, bwStats, bwOk);
            return out;
        }
    }

    // 5. Shell fallback (documented).
    Mesh fb = buildShellTetFallback(bndPts, triangles, shape);
    stampSeedDiag(fb, targetEdge, seedBudget, seedCapped, seedSpacing);
    stampBwStats(fb, bwStats, bwOk);
    return fb;
}

#ifdef FORGE_NATIVE_BREP
namespace {

// Native counterpart of buildShellTetFallback — same crude-but-real surface-triangle ->
// Tet4 conversion (inner-offset node along the inward face normal at 1/3 the average edge
// length), but the inside/outside test that picks the inner node uses the native even-odd
// pointInSolid instead of BRepClass3d_SolidClassifier. Identical geometry/orientation
// logic otherwise.
Mesh buildShellTetFallbackNative(const std::vector<Vec3>& bndPts,
                                 const std::vector<std::array<int,3>>& triangles,
                                 const forge::native::brep::Solid& solid) {
    using namespace forge::native::brep;
    Mesh out;
    out.shellTetsOnly = true;

    out.nodes.reserve(bndPts.size() + triangles.size());
    for (std::size_t i = 0; i < bndPts.size(); ++i) {
        out.nodes.push_back({bndPts[i].x, bndPts[i].y, bndPts[i].z, static_cast<int>(i)});
    }

    int idCounter = 0;
    for (auto& tri : triangles) {
        const Vec3& A = bndPts[tri[0]];
        const Vec3& B = bndPts[tri[1]];
        const Vec3& C = bndPts[tri[2]];
        Vec3 n = (B - A).cross(C - A);
        double nl = n.norm();
        if (nl < kEps) continue;
        Vec3 nu = n * (1.0 / nl);
        Vec3 centroid = (A + B + C) * (1.0 / 3.0);
        double e = ((B - A).norm() + (C - B).norm() + (A - C).norm()) / 3.0;
        double offset = e / 3.0;
        auto trySign = [&](double sign) -> int {
            Vec3 inner = centroid + nu * (sign * offset);
            const PointClass st =
                pointInSolid(solid, forge::native::brep::Vec3{inner.x, inner.y, inner.z},
                             Precision::Confusion());
            if (st == PointClass::Inside || st == PointClass::On) {
                int newId = static_cast<int>(out.nodes.size());
                out.nodes.push_back({inner.x, inner.y, inner.z, newId});
                return newId;
            }
            return -1;
        };
        int inner = trySign(-1.0);
        if (inner < 0) inner = trySign(+1.0);
        if (inner < 0) continue;

        Vec3 D{out.nodes[inner].x, out.nodes[inner].y, out.nodes[inner].z};
        double V = tetVolume(A, B, C, D);
        Tet t{};
        t.a = tri[0]; t.b = tri[1]; t.c = tri[2]; t.d = inner;
        if (V < 0.0) std::swap(t.b, t.c);
        t.id = idCounter++;
        out.tets.push_back(t);
    }
    return out;
}

// =========================================================================== //
//  T-254 — the native path's boundary samples ON the native analytic surfaces  //
// =========================================================================== //
//
// MEASURED DEFECT (T-035 / T-253, FORGE_NATIVE_FEATURES=1, gate PART=prim): the native path
// took its boundary samples from forge::native::brep::tessellateSolid and densified them with
// densifyBoundaryRecursive (chord midpoints). The native primitives are SEGMENTED B-reps —
// the cylinder r 0.5 is 128 lateral sub-faces (Cone kind, r1 == r2) plus two 128-gon disk
// caps, the sphere r 1 is 128 x 64 = 8192 sub-faces — so the tessellation is a fixed
// 128-sector polyhedron whatever targetEdge asks for: its chords (0.0245 m on the cylinder)
// are shorter than minLen at every gate level, nothing is ever split, and the curved-boundary
// error is frozen at the sector sag: 1.506e-4 m = 0.5 (1 - cos(pi/128)) on the cylinder
// (vertex deviation AND facet sag, the barycentres being chord points), 5.353e-4 m facet sag
// on the sphere, at 0.3 / 0.15 / 0.075 and 0.4 / 0.2 / 0.1 alike. Projecting the densified
// points onto the surfaces cannot fix the facet sag — the 128-sector chords stay — and
// refining those chords by a sag criterion would have to go FINER than the native sectors at
// every level for the error to keep falling (estimated: ~1.4 M boundary samples on the sphere
// at 0.1 for a sag tolerance that falls 4x per halving from the sectors' own 5.4e-4 m).
//
// So the samples are made from the analytic surfaces themselves, at the requested spacing,
// independent of how finely the B-rep happens to be segmented:
//   * curved faces are grouped into SURFACE CLASSES — the same kind and the same analytic
//     parameters (origin, axis, refDir, r1, r2, param) — whose (u, v) windows must tile one
//     parameter rectangle; each class is sampled on that rectangle: rows in v at a parameter
//     step whose 3-D length is <= targetEdge, each row cut into <= targetEdge pieces in u
//     (closedness in u / v detected numerically, so a periodic seam is not doubled; a row of
//     zero length — a pole, a cone apex — is one point). The rectangle's boundary rows are
//     the creases with the neighbouring classes (a cylinder's rims), exact on both surfaces;
//   * a planar face is sampled with its plane-plane crease edges cut into <= targetEdge
//     pieces (a crease with a curved class is that class's boundary row) and a lattice of
//     spacing <= targetEdge inside its outer loop, kept kKeepOut x targetEdge off the loop;
//   * every sample is S(u, v) of the face's own Surface (or a point of a plane / a straight
//     crease), i.e. ON the native geometry to rounding.
// Only planes, cylinders, cones and spheres are sampled this way. A face
// this cannot handle — no surface, a NURBS skin, a torus (MEASURED: its saddle region carves
// non-manifold with these samples at 0.075, see sampleNativeSurfaces) or an elliptic extrusion,
// a parameter-triangle / trimmed-region / holed face, inner loops, coplanar neighbouring planar
// faces, a class whose windows do not tile a rectangle — makes the whole call fall back to the
// tessellation densify in tryNativeMeshShape (reported with FORGE_FEA_TET_PROFILE=1), which is
// what every native body did before.

struct NativeSampleStats {
    std::size_t curvedClasses = 0, planarFaces = 0, curvedSamples = 0, planarEdgeSamples = 0, planarInterior = 0;
    const char* why = "";
};

bool sampleNativeSurfaces(const forge::native::brep::Solid& solid, double h, std::vector<Vec3>& out,
                          NativeSampleStats& st) {
    using namespace forge::native::brep;
    std::vector<const Face*> faces;
    for (const Shell* sh : solid.shells)
        for (const Face* f : sh->faces) faces.push_back(f);
    if (faces.empty()) { st.why = "no faces"; return false; }

    auto same = [](double a, double b) { return std::abs(a - b) <= 1e-12 * std::max({1.0, std::abs(a), std::abs(b)}); };
    auto sameV = [&](const Vec3& a, const Vec3& b) { return same(a.x, b.x) && same(a.y, b.y) && same(a.z, b.z); };
    auto sameSurface = [&](const Surface& a, const Surface& b) {
        return a.kind == b.kind && sameV(a.origin, b.origin) && sameV(a.axis, b.axis) && sameV(a.refDir, b.refDir) &&
               same(a.r1, b.r1) && same(a.r2, b.r2) && same(a.param, b.param);
    };
    auto isPlane = [](const Face* f) { return f->surface && f->surface->kind == SurfaceKind::Plane; };

    for (const Face* f : faces) {
        if (!f->surface) { st.why = "a face without a surface"; return false; }
        const SurfaceKind k = f->surface->kind;
        if (k == SurfaceKind::Nurbs) { st.why = "a NURBS face"; return false; }
        if (k != SurfaceKind::Plane && k != SurfaceKind::Cylinder && k != SurfaceKind::Cone && k != SurfaceKind::Sphere) {
            // MEASURED: a torus R 1 r 0.3 sampled this way carves with 16 non-manifold boundary
            // edges at 0.075 (all in the saddle region, phi ~ +-1.9..2.7 rad), where the old
            // tessellation densify gives a valid mesh; elliptic extrusions are untested.
            st.why = "a torus / elliptic-extrusion face";
            return false;
        }
        if (f->paramTri || f->regionUV || f->boolHoled || !f->innerLoops.empty() || !f->outerLoop) {
            st.why = "a parameter-triangle / trimmed / holed face";
            return false;
        }
    }

    // ---- curved surface classes ---------------------------------------------------------
    std::vector<std::vector<const Face*>> classes;
    for (const Face* f : faces) {
        if (isPlane(f)) continue;
        bool placed = false;
        for (auto& c : classes)
            if (sameSurface(*c.front()->surface, *f->surface)) { c.push_back(f); placed = true; break; }
        if (!placed) classes.push_back({f});
    }
    for (const auto& c : classes) {
        const Surface& S = *c.front()->surface;
        double U0 = c.front()->u0, U1 = c.front()->u1, V0 = c.front()->v0, V1 = c.front()->v1, area = 0.0;
        for (const Face* f : c) {
            U0 = std::min(U0, f->u0); U1 = std::max(U1, f->u1);
            V0 = std::min(V0, f->v0); V1 = std::max(V1, f->v1);
            area += (f->u1 - f->u0) * (f->v1 - f->v0);
        }
        const double rect = (U1 - U0) * (V1 - V0);
        if (!(rect > 0) || std::abs(area - rect) > 1e-9 * rect) { st.why = "a surface class whose windows do not tile a rectangle"; return false; }
        auto P = [&](double u, double v) { return S.evaluate(u, v); };
        auto lenU = [&](double v) {
            double L = 0; Vec3 a = P(U0, v);
            for (int i = 1; i <= 256; ++i) { const Vec3 b = P(U0 + (U1 - U0) * i / 256.0, v); L += (b - a).norm(); a = b; }
            return L;
        };
        auto lenV = [&](double u) {
            double L = 0; Vec3 a = P(u, V0);
            for (int i = 1; i <= 256; ++i) { const Vec3 b = P(u, V0 + (V1 - V0) * i / 256.0); L += (b - a).norm(); a = b; }
            return L;
        };
        double Lv = 0, scale = 0;
        for (int k = 0; k <= 4; ++k) {
            const double u = U0 + (U1 - U0) * k / 4.0;
            Lv = std::max(Lv, lenV(u));
            scale = std::max(scale, lenU(V0 + (V1 - V0) * k / 4.0));
        }
        scale = std::max(scale, Lv);
        const double closeTol = 1e-9 * std::max(1.0, scale);
        bool closedU = true, closedV = true;
        for (int k = 0; k <= 4; ++k) {
            const double v = V0 + (V1 - V0) * k / 4.0, u = U0 + (U1 - U0) * k / 4.0;
            if ((P(U0, v) - P(U1, v)).norm() > closeTol) closedU = false;
            if ((P(u, V0) - P(u, V1)).norm() > closeTol) closedV = false;
        }
        const int nv = std::max(1, static_cast<int>(std::ceil(Lv / h)));
        const int rows = closedV ? nv : nv + 1;
        for (int j = 0; j < rows; ++j) {
            const double v = V0 + (V1 - V0) * j / nv;
            const double Lu = lenU(v);
            if (!(Lu > closeTol)) { out.push_back(P(U0, v)); ++st.curvedSamples; continue; }   // pole / apex
            const int nu = std::max(closedU ? 3 : 1, static_cast<int>(std::ceil(Lu / h)));
            const int cols = closedU ? nu : nu + 1;
            for (int i = 0; i < cols; ++i) { out.push_back(P(U0 + (U1 - U0) * i / nu, v)); ++st.curvedSamples; }
        }
        ++st.curvedClasses;
    }

    // ---- planar faces ---------------------------------------------------------------------
    for (const Face* f : faces) {
        if (!isPlane(f)) continue;
        const Surface& S = *f->surface;
        const Vec3 o = S.origin, e1 = S.refDir, e2 = S.binormal();
        std::vector<std::array<double, 2>> poly;
        const Coedge* c0 = f->outerLoop->first;
        const Coedge* c = c0;
        do {
            const Vertex* va = c->originVertex();
            const Vertex* vb = c->destVertex();
            const Vec3 A{va->point.x, va->point.y, va->point.z}, B{vb->point.x, vb->point.y, vb->point.z};
            poly.push_back({(A - o).dot(e1), (A - o).dot(e2)});
            const Face* mf = c->mate && c->mate->loop ? c->mate->loop->face : nullptr;
            if (!mf) { st.why = "an open edge"; return false; }
            if (isPlane(mf)) {
                // a coplanar neighbour (a split planar face): the two lattices would not line up
                if (std::abs(std::abs(mf->surface->axis.dot(S.axis)) - 1.0) <= 1e-12 &&
                    std::abs((mf->surface->origin - o).dot(S.axis)) <= 1e-9 * std::max(1.0, o.norm())) {
                    st.why = "coplanar neighbouring planar faces";
                    return false;
                }
                const double L = (B - A).norm();
                const int n = std::max(1, static_cast<int>(std::ceil(L / h)));
                for (int k = 0; k <= n; ++k) { out.push_back(A + (B - A) * (static_cast<double>(k) / n)); ++st.planarEdgeSamples; }
            }
            c = c->next;
        } while (c && c != c0);
        if (poly.size() < 3) { st.why = "a degenerate planar loop"; return false; }
        double xmin = poly[0][0], xmax = xmin, ymin = poly[0][1], ymax = ymin;
        for (const auto& q : poly) { xmin = std::min(xmin, q[0]); xmax = std::max(xmax, q[0]); ymin = std::min(ymin, q[1]); ymax = std::max(ymax, q[1]); }
        auto inside = [&](double x, double y) {
            bool in = false;
            for (std::size_t i = 0, j = poly.size() - 1; i < poly.size(); j = i++) {
                const double xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
                if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) in = !in;
            }
            return in;
        };
        auto distToLoop = [&](double x, double y) {
            double best = std::numeric_limits<double>::max();
            for (std::size_t i = 0, j = poly.size() - 1; i < poly.size(); j = i++) {
                const double ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
                const double vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
                double t = l2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / l2 : 0.0;
                t = std::max(0.0, std::min(1.0, t));
                best = std::min(best, std::hypot(x - (ax + t * vx), y - (ay + t * vy)));
            }
            return best;
        };
        const int nx = std::max(1, static_cast<int>(std::ceil((xmax - xmin) / h)));
        const int ny = std::max(1, static_cast<int>(std::ceil((ymax - ymin) / h)));
        const double dx = (xmax - xmin) / nx, dy = (ymax - ymin) / ny;
        for (int i = 1; i < nx; ++i)
            for (int j = 1; j < ny; ++j) {
                const double x = xmin + i * dx, y = ymin + j * dy;
                if (!inside(x, y) || distToLoop(x, y) < kKeepOut * h) continue;
                out.push_back(o + e1 * x + e2 * y);
                ++st.planarInterior;
            }
        ++st.planarFaces;
    }
    return !out.empty();
}

// Try the native boundary tessellation + native AABB + native point-in-solid for the
// meshShape domain build. Returns true + fills `out` on success; returns false (NEVER
// throws) when the native path HONESTLY DEFERS so meshShapeFromHandle falls through to the
// OCCT meshShape path. Same deferral contract as Fea.cpp::tryNativeMeshFromBRep /
// Cam.cpp::tryNativeInwardOffset.
//
// Deferral cases (Bible §0 — native-where-valid, OCCT otherwise):
//   * the input is a NativeMesh, or an OCCT-backed body whose importOcctSolid defers
//     (ok==false: NURBS/Torus/non-analytic) -> the whole call defers to OCCT.
//   * the native tessellation yields no triangles, or the native AABB is void_/degenerate
//     -> defer (OCCT owns the descriptive throw on an empty boundary).
//
// The build below mirrors meshShape's structure: native watertight boundary triangles
// (tessellateSolid) -> seed densify (triangle midpoints/barycenters + an interior grid
// classified by native pointInSolid) -> Bowyer-Watson (the SAME backend-agnostic mesher)
// -> centroid inside-filter (native pointInSolid) -> documented native shell fallback.
bool tryNativeMeshShape(::forge::ShapeHandle h, double targetEdge, int seedGridBudget,
                        Mesh& out) {
    using namespace forge::native::brep;
    const int seedBudget = resolveSeedGridBudget(seedGridBudget);
    bool   seedCapped    = false;
    double seedSpacing   = 0.0;
    auto& reg = ::forge::ShapeRegistry::instance();

    // Resolve the input to a native analytic Solid. A NativeSolid handle is used
    // directly; PHASE-D ACTIVATION (2026-06-25) — an OCCT-backed (ShapeKind::Occt)
    // handle is IMPORTED via forge::importOcctSolid (analytic box/cyl/cone/sphere/
    // prism + analytic-boolean results) so the native tessellate + point-in-solid
    // tet build runs on it. SAFE: importOcctSolid ok==false (NURBS/Torus/non-analytic)
    // -> defer to OCCT. `imported` keeps the imported topology alive for this call.
    ::forge::ImportResult imported;
    const Solid* solidPtr = nullptr;
    // T-129: the NativeSolid arm is ONE question through the OCCT-free seam.
    // INVALID HANDLE: unchanged. nativeSolidOf() answers nullptr instead of
    // throwing, and control then falls into the `else if (reg.kindOf(h) ...)`
    // below — the SAME kindOf() call that used to be first — so an unknown handle
    // still raises ShapeRegistry's "invalid handle" error here, unchanged.
    if (const Solid* ns = ::forge::nativeSolidOf(h)) {
        solidPtr = ns;
    } else if (reg.kindOf(h) == ::forge::ShapeKind::Occt) {
        imported = ::forge::importOcctSolid(reg.get(h));
        if (!imported.ok || imported.solid == nullptr) return false;     // defer to OCCT
        solidPtr = imported.solid;
    } else {
        return false;   // NativeMesh -> no analytic Solid -> defer to OCCT
    }
    const Solid& solid = *solidPtr;

    // 1. Native AABB (sizes the merge tolerance + the interior seed grid bounds).
    const Aabb3 box = computeAabb(solid);
    if (box.void_) return false;                                         // empty -> defer
    const double xmin = box.minX, ymin = box.minY, zmin = box.minZ;
    const double xmax = box.maxX, ymax = box.maxY, zmax = box.maxZ;
    double diag = std::sqrt((xmax - xmin) * (xmax - xmin) +
                            (ymax - ymin) * (ymax - ymin) +
                            (zmax - zmin) * (zmax - zmin));
    double mergeTol = std::max(targetEdge * 1e-3, diag * 1e-7);

    // 2. Native watertight boundary triangles -> unique vertex list + triangle indices,
    //    in the SAME (uniqueVerts, triangles) form the OCCT extractor produced. The native
    //    soup is already welded by position (tessellateSolid weldTol); we keep its vertex
    //    indexing directly (no re-merge needed — coincident topological vertices already
    //    map to one position).
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    tessellateSolid(solid, pos, idx, mergeTol);
    if (pos.empty() || idx.size() < 3) return false;                    // no boundary -> defer

    std::vector<Vec3> bndPts;
    bndPts.reserve(pos.size() / 3);
    for (std::size_t i = 0; i + 2 < pos.size(); i += 3) {
        bndPts.push_back(Vec3{pos[i], pos[i + 1], pos[i + 2]});
    }
    std::vector<std::array<int, 3>> triangles;
    triangles.reserve(idx.size() / 3);
    for (std::size_t i = 0; i + 2 < idx.size(); i += 3) {
        std::array<int, 3> t{ static_cast<int>(idx[i]),
                              static_cast<int>(idx[i + 1]),
                              static_cast<int>(idx[i + 2]) };
        if (t[0] == t[1] || t[1] == t[2] || t[0] == t[2]) continue;
        triangles.push_back(t);
    }
    if (bndPts.empty() || triangles.empty()) return false;              // degenerate -> defer

    // 2b. Seeds. T-254: when every face allows it, the boundary samples are made ON the native
    //     analytic surfaces at the requested spacing (sampleNativeSurfaces) and interior lattice
    //     points keep kKeepOut x targetEdge off the boundary; otherwise, as before, the
    //     tessellation is densified (a: triangle midpoints/barycentres) and the lattice is not
    //     kept out. b: the interior grid is classified IN by the NATIVE pointInSolid.
    std::vector<Vec3> seeds;
    NativeSampleStats nss;
    std::vector<Vec3> surfSamples;
    const bool onSurfaces = sampleNativeSurfaces(solid, targetEdge, surfSamples, nss);
    {
        struct ArrHash {
            std::size_t operator()(const std::array<long long, 3>& k) const noexcept {
                std::uint64_t hh = 1469598103934665603ull;
                for (auto v : k) { hh ^= static_cast<std::uint64_t>(v); hh *= 1099511628211ull; }
                return static_cast<std::size_t>(hh);
            }
        };
        std::unordered_set<std::array<long long, 3>, ArrHash> occupied;
        double invCell = 1.0 / std::max(mergeTol, 1e-30);
        auto cell = [&](const Vec3& v) {
            return std::array<long long, 3>{
                static_cast<long long>(std::floor(v.x * invCell)),
                static_cast<long long>(std::floor(v.y * invCell)),
                static_cast<long long>(std::floor(v.z * invCell))
            };
        };
        auto tryAdd = [&](const Vec3& p) {
            auto k = cell(p);
            for (int di = -1; di <= 1; ++di) {
                for (int dj = -1; dj <= 1; ++dj) {
                    for (int dk = -1; dk <= 1; ++dk) {
                        auto kn = k; kn[0] += di; kn[1] += dj; kn[2] += dk;
                        if (occupied.count(kn)) return false;
                    }
                }
            }
            occupied.insert(k);
            seeds.push_back(p);
            return true;
        };

        const double minLen = 1.25 * targetEdge;
        const double minArea = 0.5 * targetEdge * targetEdge;
        std::size_t bndAdded = 0;
        bool bndCapped = false;
        std::size_t surfKept = 0;
        if (onSurfaces) {
            for (const Vec3& p : surfSamples) if (tryAdd(p)) ++surfKept;
        } else {
            seeds = bndPts;
            for (const auto& p : seeds) occupied.insert(cell(p));
            // densifyBoundaryRecursive reads the tessellation vertices from `seeds` (= bndPts
            // here) by the triangles' indices and appends to the same vector, as it did when
            // both were bndPts.
            densifyBoundaryRecursive(seeds, triangles, tryAdd, minLen, minArea,
                                     static_cast<std::size_t>(seedBudget), 40,
                                     bndAdded, bndCapped);
        }
        if (feaTetProfileEnabled()) {
            if (onSurfaces)
                std::fprintf(stderr, "[feaTet] native samples ON the surfaces: %zu curved classes (%zu samples), %zu planar faces "
                                     "(%zu crease-edge + %zu interior samples); %zu kept after merging\n",
                             nss.curvedClasses, nss.curvedSamples, nss.planarFaces, nss.planarEdgeSamples, nss.planarInterior, surfKept);
            else
                std::fprintf(stderr, "[feaTet] native samples: tessellation densify (on-surface sampling declined: %s)\n", nss.why);
        }
        if (bndCapped) {
            std::fprintf(stderr,
                         "[feaTet] boundary densification hit its budget (%d points) at "
                         "targetEdge=%.6g -- the SURFACE is coarser than requested; raise "
                         "FORGE_FEA_TET_SEED_BUDGET before trusting a convergence sweep.\n",
                         seedBudget, targetEdge);
        }
        int nx = 0, ny = 0, nz = 0;
        seedCapped = sizeSeedGrid(xmax - xmin, ymax - ymin, zmax - zmin,
                                  targetEdge, seedBudget, nx, ny, nz, seedSpacing);
        double dx = (xmax - xmin) / (nx + 1);
        double dy = (ymax - ymin) / (ny + 1);
        double dz = (zmax - zmin) / (nz + 1);
        // T-254: with the samples on the surfaces, a lattice point closer than the keep-out to
        // the boundary would sit between them and the surface (the T-035 keep-out, measured
        // against the native tessellation, whose chord error is far below the keep-out).
        std::vector<std::array<Vec3, 3>> tessTris;
        if (onSurfaces) {
            tessTris.reserve(triangles.size());
            for (const auto& t : triangles) tessTris.push_back({bndPts[t[0]], bndPts[t[1]], bndPts[t[2]]});
        }
        const BoundaryProximity nearTess(tessTris, targetEdge);
        for (int ix = 1; ix <= nx; ++ix) {
            for (int iy = 1; iy <= ny; ++iy) {
                for (int iz = 1; iz <= nz; ++iz) {
                    Vec3 p{xmin + ix * dx, ymin + iy * dy, zmin + iz * dz};
                    if (onSurfaces && nearTess.within(p, kKeepOut * targetEdge)) continue;
                    const PointClass st = pointInSolid(
                        solid, forge::native::brep::Vec3{p.x, p.y, p.z}, mergeTol);
                    if (st != PointClass::Inside) continue;
                    tryAdd(p);
                }
            }
        }
    }

    // 3. Bowyer-Watson on the boundary points (the SAME backend-agnostic mesher).
    std::vector<Vec3> ptsCopy = seeds;
    std::vector<LocalTet> bw;
    BwStats bwStats;
    bool bwOk = true;
    try {
        bw = bowyerWatson(ptsCopy, bwStats);
    } catch (...) {
        bw.clear();
        bwOk = false;
    }

    if (bwOk && !bw.empty()) {
        // 4. Filter against the solid: keep tets whose centroid is inside (native test).
        std::vector<LocalTet> kept;
        kept.reserve(bw.size());
        for (auto& t : bw) {
            Vec3 c = (ptsCopy[t.n[0]] + ptsCopy[t.n[1]] + ptsCopy[t.n[2]] + ptsCopy[t.n[3]])
                     * 0.25;
            const PointClass st = pointInSolid(
                solid, forge::native::brep::Vec3{c.x, c.y, c.z}, Precision::Confusion());
            if (st == PointClass::Inside) kept.push_back(t);
        }
        improveSlivers(ptsCopy, kept, bwStats.snapQ);   // T-253
        if (!kept.empty()) {
            std::unordered_map<int, int> remap;
            for (auto& t : kept) {
                for (int k = 0; k < 4; ++k) {
                    auto [it, ins] = remap.try_emplace(t.n[k], static_cast<int>(remap.size()));
                    (void)it; (void)ins;
                }
            }
            Mesh m;
            m.nodes.resize(remap.size());
            for (auto& kv : remap) {
                const Vec3& p = ptsCopy[kv.first];
                m.nodes[kv.second] = Node{p.x, p.y, p.z, kv.second};
            }
            int idc = 0;
            for (auto& t : kept) {
                Tet T{};
                T.a = remap[t.n[0]];
                T.b = remap[t.n[1]];
                T.c = remap[t.n[2]];
                T.d = remap[t.n[3]];
                double V = tetVolume({m.nodes[T.a].x, m.nodes[T.a].y, m.nodes[T.a].z},
                                     {m.nodes[T.b].x, m.nodes[T.b].y, m.nodes[T.b].z},
                                     {m.nodes[T.c].x, m.nodes[T.c].y, m.nodes[T.c].z},
                                     {m.nodes[T.d].x, m.nodes[T.d].y, m.nodes[T.d].z});
                if (V < 0.0) std::swap(T.b, T.c);
                T.id = idc++;
                m.tets.push_back(T);
            }
            out = std::move(m);
            stampSeedDiag(out, targetEdge, seedBudget, seedCapped, seedSpacing);
            stampBwStats(out, bwStats, bwOk);
            return true;
        }
    }

    // 5. Shell fallback (documented; native inside-test variant).
    out = buildShellTetFallbackNative(bndPts, triangles, solid);
    stampSeedDiag(out, targetEdge, seedBudget, seedCapped, seedSpacing);
    stampBwStats(out, bwStats, bwOk);
    return true;
}

} // namespace
#endif

Mesh meshShapeFromHandle(::forge::ShapeHandle h, double targetEdge, int seedGridBudget) {
#ifdef FORGE_NATIVE_BREP
    // GATE: the native boundary-tessellation + AABB + point-in-solid tet-domain build is
    // opt-in via the FEAT gate (default OFF). When on AND the input is a NativeSolid, build
    // the tet mesh natively; otherwise fall through to the OCCT meshShape path below (an
    // OCCT-backed input HONESTLY DEFERS — no behavior change in the default build). A false
    // return == defer.
    if (::forge::native::brep::forgeNativeFeaturesEnabled() && targetEdge > 0.0) {
        Mesh nativeMesh;
        if (tryNativeMeshShape(h, targetEdge, seedGridBudget, nativeMesh)) return nativeMesh;
        // native deferred -> OCCT path below (unchanged).
    }
#endif
    const TopoDS_Shape& s = ::forge::ShapeRegistry::instance().get(h);
    return meshShape(s, targetEdge, seedGridBudget);
}

Result solveLinearStatic(const Mesh& mesh, const Material& mat, const BC& bc) {
    const int N = static_cast<int>(mesh.nodes.size());
    if (N == 0 || mesh.tets.empty()) {
        throw std::invalid_argument("forge::fea::tet::solveLinearStatic: empty mesh");
    }
    const int ndof = 3 * N;
    std::array<double, 36> D;
    elasticityD(mat.E, mat.nu, D);

    // Triplet assembly.
    Sparse::Trip trips;
    std::vector<double> f(ndof, 0.0);

    // Map original Node::id to row index. We assume mesh nodes are
    // contiguous 0..N-1 — but tolerate sparse ids by mapping through.
    std::unordered_map<int, int> idMap;
    idMap.reserve(N);
    for (int i = 0; i < N; ++i) idMap[mesh.nodes[i].id] = i;

    auto idOf = [&](int origOrIdx) -> int {
        auto it = idMap.find(origOrIdx);
        if (it != idMap.end()) return it->second;
        if (origOrIdx >= 0 && origOrIdx < N) return origOrIdx;
        return -1;
    };

    for (const Tet& t : mesh.tets) {
        int ni[4];
        ni[0] = idOf(t.a); ni[1] = idOf(t.b);
        ni[2] = idOf(t.c); ni[3] = idOf(t.d);
        for (int k = 0; k < 4; ++k) {
            if (ni[k] < 0 || ni[k] >= N) {
                throw std::runtime_error("forge::fea::tet::solveLinearStatic: tet node out of range");
            }
        }
        Vec3 P[4]{
            {mesh.nodes[ni[0]].x, mesh.nodes[ni[0]].y, mesh.nodes[ni[0]].z},
            {mesh.nodes[ni[1]].x, mesh.nodes[ni[1]].y, mesh.nodes[ni[1]].z},
            {mesh.nodes[ni[2]].x, mesh.nodes[ni[2]].y, mesh.nodes[ni[2]].z},
            {mesh.nodes[ni[3]].x, mesh.nodes[ni[3]].y, mesh.nodes[ni[3]].z},
        };
        // Make sure volume is positive (B-matrix sign convention).
        double V = tetVolume(P[0], P[1], P[2], P[3]);
        if (V < 0) {
            std::swap(ni[1], ni[2]);
            std::swap(P[1], P[2]);
            V = -V;
        }
        std::array<double, 6 * 12> B;
        double Vchk;
        if (!tet4B(P, B, Vchk)) continue;
        std::array<double, 144> Ke;
        assembleKe(B, D, V, Ke);
        int gdof[12];
        for (int k = 0; k < 4; ++k) {
            gdof[3 * k + 0] = 3 * ni[k] + 0;
            gdof[3 * k + 1] = 3 * ni[k] + 1;
            gdof[3 * k + 2] = 3 * ni[k] + 2;
        }
        for (int i = 0; i < 12; ++i) {
            for (int j = 0; j < 12; ++j) {
                double v = Ke[i * 12 + j];
                if (v == 0.0) continue;
                trips[{gdof[i], gdof[j]}] += v;
            }
        }
    }

    // Apply nodal forces.
    for (const auto& nf : bc.nodalForces) {
        int idx = idOf(nf.first);
        if (idx < 0) continue;
        f[3 * idx + 0] += nf.second[0];
        f[3 * idx + 1] += nf.second[1];
        f[3 * idx + 2] += nf.second[2];
    }

    // ---- Inc1c: thermoelastic initial-strain load (per-node ΔT → element ε₀) ----
    // ε₀ = α·ΔT̄ₑ·[1,1,1,0,0,0]; constant-strain Tet4 ⇒ f_e = V·Bᵀ·(D ε₀).
    // elemE0[e] (= α·ΔT̄ₑ) is retained so the stress recovery reports σ = D(ε−ε₀).
    std::vector<double> elemE0;   // empty ⇒ isothermal
    if (mat.alpha != 0.0 && !bc.nodeTemps.empty()) {
        std::vector<double> nodeDT(N, 0.0);
        for (const auto& nt : bc.nodeTemps) {
            int idx = idOf(nt.first);
            if (idx >= 0 && idx < N) nodeDT[idx] = nt.second;
        }
        elemE0.assign(mesh.tets.size(), 0.0);
        for (std::size_t e = 0; e < mesh.tets.size(); ++e) {
            const Tet& t = mesh.tets[e];
            int ni[4]{ idOf(t.a), idOf(t.b), idOf(t.c), idOf(t.d) };
            bool ok = true;
            for (int k = 0; k < 4; ++k) if (ni[k] < 0 || ni[k] >= N) ok = false;
            if (!ok) continue;
            double dT = 0.0;
            for (int k = 0; k < 4; ++k) dT += nodeDT[ni[k]];
            const double e0 = mat.alpha * (dT * 0.25);
            elemE0[e] = e0;
            if (e0 == 0.0) continue;
            Vec3 P[4]{
                {mesh.nodes[ni[0]].x, mesh.nodes[ni[0]].y, mesh.nodes[ni[0]].z},
                {mesh.nodes[ni[1]].x, mesh.nodes[ni[1]].y, mesh.nodes[ni[1]].z},
                {mesh.nodes[ni[2]].x, mesh.nodes[ni[2]].y, mesh.nodes[ni[2]].z},
                {mesh.nodes[ni[3]].x, mesh.nodes[ni[3]].y, mesh.nodes[ni[3]].z},
            };
            double V = tetVolume(P[0], P[1], P[2], P[3]);
            if (V < 0) { std::swap(ni[1], ni[2]); std::swap(P[1], P[2]); V = -V; }
            std::array<double, 6 * 12> B;
            double Vchk;
            if (!tet4B(P, B, Vchk)) continue;
            double sig0[6];
            for (int i = 0; i < 6; ++i) sig0[i] = (D[i*6+0] + D[i*6+1] + D[i*6+2]) * e0;
            int gdof[12];
            for (int k = 0; k < 4; ++k) {
                gdof[3*k+0] = 3*ni[k]+0; gdof[3*k+1] = 3*ni[k]+1; gdof[3*k+2] = 3*ni[k]+2;
            }
            for (int j = 0; j < 12; ++j) {
                double v = 0.0;
                for (int i = 0; i < 6; ++i) v += B[i*12+j] * sig0[i];
                f[gdof[j]] += V * v;
            }
        }
    }

    // ---- Inc1c: general per-DOF boundary conditions via penalty -------------
    // fixedNodes → full 3-DOF pin at value 0 (legacy). prescribed → per-DOF
    // constraint with a (possibly non-zero) value; value 0 on a single axis is a
    // SYMMETRY plane (zero normal component). Penalty: the constrained row keeps
    // only a large diagonal d with f = d·value (⇒ u = value); free rows retain
    // the constrained COLUMN, giving the correct K_free,c·value coupling.
    constexpr double kPenalty = 1e30;
    std::map<int, double> prescribedDof;   // dof -> prescribed value
    for (int nid : bc.fixedNodes) {
        int idx = idOf(nid);
        if (idx < 0) continue;
        prescribedDof[3 * idx + 0] = 0.0;
        prescribedDof[3 * idx + 1] = 0.0;
        prescribedDof[3 * idx + 2] = 0.0;
    }
    for (const auto& pd : bc.prescribed) {
        int idx = idOf(pd.nodeId);
        if (idx < 0) continue;
        if (pd.fx) prescribedDof[3 * idx + 0] = pd.ux;
        if (pd.fy) prescribedDof[3 * idx + 1] = pd.uy;
        if (pd.fz) prescribedDof[3 * idx + 2] = pd.uz;
    }
    if (!prescribedDof.empty()) {
        Sparse::Trip newTrips;
        for (auto& kv : trips) {
            int r = kv.first.first;
            if (prescribedDof.count(r)) continue;   // drop the constrained row
            newTrips[{r, kv.first.second}] = kv.second;
        }
        for (const auto& pr : prescribedDof) {
            const int fd = pr.first;
            double existing = 0.0;
            auto it = trips.find({fd, fd});
            if (it != trips.end()) existing = it->second;
            const double diag = std::max(std::abs(existing), 1.0) * kPenalty;
            newTrips[{fd, fd}] = diag;
            f[fd] = diag * pr.second;     // u_fd = prescribed value (0 = pin / symmetry)
        }
        trips.swap(newTrips);
    }

    Sparse K = Sparse::fromTriplets(ndof, trips);

    // Solve.
    std::vector<double> u(ndof, 0.0);
    double finalRes = 0.0;
    int iters = conjugateGradient(K, f, u, std::max(2000, 20 * ndof), 1e-10, finalRes);

    Result R;
    R.displacement.resize(N);
    R.maxDisp = 0.0;
    for (int i = 0; i < N; ++i) {
        R.displacement[i] = {u[3 * i + 0], u[3 * i + 1], u[3 * i + 2]};
        double m = std::sqrt(u[3*i]*u[3*i] + u[3*i+1]*u[3*i+1] + u[3*i+2]*u[3*i+2]);
        if (m > R.maxDisp) R.maxDisp = m;
    }
    R.cgIterations = iters;
    R.cgResidual   = finalRes;
    R.converged    = (finalRes < 1e-6);

    // ---- Inc1b: element stress recovery — full Cauchy tensor + principal,
    // per-element AND nodal-averaged. The sig[6] vector computed here was
    // previously reduced to von Mises and discarded; we now STORE it. ----
    const std::size_t nE = mesh.tets.size();
    R.vonMises.resize(nE, 0.0);
    R.elemStress.assign(nE, {0, 0, 0, 0, 0, 0});
    R.elemPrincipal.assign(nE, {0, 0, 0});
    R.maxVonMises = 0.0;

    std::vector<std::array<double, 6>> nodeAccum(N, {0, 0, 0, 0, 0, 0});
    std::vector<int>                   nodeCount(N, 0);

    for (std::size_t e = 0; e < nE; ++e) {
        const Tet& t = mesh.tets[e];
        int ni[4]{ idOf(t.a), idOf(t.b), idOf(t.c), idOf(t.d) };
        Vec3 P[4]{
            {mesh.nodes[ni[0]].x, mesh.nodes[ni[0]].y, mesh.nodes[ni[0]].z},
            {mesh.nodes[ni[1]].x, mesh.nodes[ni[1]].y, mesh.nodes[ni[1]].z},
            {mesh.nodes[ni[2]].x, mesh.nodes[ni[2]].y, mesh.nodes[ni[2]].z},
            {mesh.nodes[ni[3]].x, mesh.nodes[ni[3]].y, mesh.nodes[ni[3]].z},
        };
        double V = tetVolume(P[0], P[1], P[2], P[3]);
        if (V < 0) { std::swap(ni[1], ni[2]); std::swap(P[1], P[2]); V = -V; }
        std::array<double, 6 * 12> B;
        double Vchk;
        if (!tet4B(P, B, Vchk)) continue;
        double ue[12];
        for (int k = 0; k < 4; ++k) {
            ue[3*k+0] = u[3*ni[k]+0];
            ue[3*k+1] = u[3*ni[k]+1];
            ue[3*k+2] = u[3*ni[k]+2];
        }
        double eps[6] = {0,0,0,0,0,0};
        for (int i = 0; i < 6; ++i) {
            for (int j = 0; j < 12; ++j) eps[i] += B[i * 12 + j] * ue[j];
        }
        // Inc1c — remove the element thermal (initial) strain so σ = D·(ε − ε₀);
        // ε₀ = α·ΔT̄ₑ·[1,1,1,0,0,0]. No-op when isothermal (elemE0 empty).
        if (!elemE0.empty()) {
            const double e0 = elemE0[e];
            eps[0] -= e0; eps[1] -= e0; eps[2] -= e0;
        }
        double sig[6] = {0,0,0,0,0,0};
        for (int i = 0; i < 6; ++i) {
            for (int j = 0; j < 6; ++j) sig[i] += D[i * 6 + j] * eps[j];
        }
        for (int i = 0; i < 6; ++i) R.elemStress[e][i] = sig[i];
        double pr[3]; principalStresses(sig, pr);
        R.elemPrincipal[e] = {pr[0], pr[1], pr[2]};
        double vm = vonMisesVoigt(sig);
        R.vonMises[e] = vm;
        if (vm > R.maxVonMises) R.maxVonMises = vm;

        for (int k = 0; k < 4; ++k) {
            const int nd = ni[k];
            for (int i = 0; i < 6; ++i) nodeAccum[nd][i] += sig[i];
            nodeCount[nd]++;
        }
    }

    // Nodal-recovered stress: unweighted average of incident-element stresses,
    // then principal + von Mises recomputed from the averaged tensor (averaging
    // the principal triplet directly would be wrong — eigenframes differ).
    R.nodalStress.assign(N, {0, 0, 0, 0, 0, 0});
    R.nodalPrincipal.assign(N, {0, 0, 0});
    R.nodalVonMises.assign(N, 0.0);
    for (int n = 0; n < N; ++n) {
        if (nodeCount[n] == 0) continue;
        double s[6];
        for (int i = 0; i < 6; ++i) { s[i] = nodeAccum[n][i] / nodeCount[n]; R.nodalStress[n][i] = s[i]; }
        double pr[3]; principalStresses(s, pr);
        R.nodalPrincipal[n] = {pr[0], pr[1], pr[2]};
        R.nodalVonMises[n] = vonMisesVoigt(s);
    }
    return R;
}

ModalResult solveModal(const Mesh& mesh, const Material& mat,
                       const std::vector<int>& fixedNodes, int nModes) {
    const int N = static_cast<int>(mesh.nodes.size());
    if (N == 0 || mesh.tets.empty()) {
        throw std::invalid_argument("forge::fea::tet::solveModal: empty mesh");
    }
    const int ndof = 3 * N;

    std::array<double, 36> D;
    elasticityD(mat.E, mat.nu, D);

    Sparse::Trip Kt, Mt;
    std::unordered_map<int, int> idMap;
    for (int i = 0; i < N; ++i) idMap[mesh.nodes[i].id] = i;
    auto idOf = [&](int o) -> int {
        auto it = idMap.find(o);
        if (it != idMap.end()) return it->second;
        return (o >= 0 && o < N) ? o : -1;
    };

    for (const Tet& t : mesh.tets) {
        int ni[4]{ idOf(t.a), idOf(t.b), idOf(t.c), idOf(t.d) };
        Vec3 P[4]{
            {mesh.nodes[ni[0]].x, mesh.nodes[ni[0]].y, mesh.nodes[ni[0]].z},
            {mesh.nodes[ni[1]].x, mesh.nodes[ni[1]].y, mesh.nodes[ni[1]].z},
            {mesh.nodes[ni[2]].x, mesh.nodes[ni[2]].y, mesh.nodes[ni[2]].z},
            {mesh.nodes[ni[3]].x, mesh.nodes[ni[3]].y, mesh.nodes[ni[3]].z},
        };
        double V = tetVolume(P[0], P[1], P[2], P[3]);
        if (V < 0) { std::swap(ni[1], ni[2]); std::swap(P[1], P[2]); V = -V; }
        std::array<double, 6 * 12> B;
        double Vchk;
        if (!tet4B(P, B, Vchk)) continue;
        std::array<double, 144> Ke, Me;
        assembleKe(B, D, V, Ke);
        assembleMe(mat.rho, V, Me);
        int gdof[12];
        for (int k = 0; k < 4; ++k) {
            gdof[3 * k + 0] = 3 * ni[k] + 0;
            gdof[3 * k + 1] = 3 * ni[k] + 1;
            gdof[3 * k + 2] = 3 * ni[k] + 2;
        }
        for (int i = 0; i < 12; ++i) {
            for (int j = 0; j < 12; ++j) {
                if (Ke[i * 12 + j] != 0.0) Kt[{gdof[i], gdof[j]}] += Ke[i * 12 + j];
                if (Me[i * 12 + j] != 0.0) Mt[{gdof[i], gdof[j]}] += Me[i * 12 + j];
            }
        }
    }

    // Apply BCs via penalty.
    constexpr double kPenalty = 1e30;
    std::unordered_set<int> fixedSet;
    for (int nid : fixedNodes) {
        int idx = idOf(nid);
        if (idx < 0) continue;
        fixedSet.insert(3 * idx + 0);
        fixedSet.insert(3 * idx + 1);
        fixedSet.insert(3 * idx + 2);
    }
    if (!fixedSet.empty()) {
        Sparse::Trip Kn, Mn;
        for (auto& kv : Kt) {
            if (fixedSet.count(kv.first.first)) continue;
            Kn[kv.first] = kv.second;
        }
        for (auto& kv : Mt) {
            if (fixedSet.count(kv.first.first)) continue;
            Mn[kv.first] = kv.second;
        }
        for (int fd : fixedSet) {
            Kn[{fd, fd}] = kPenalty;
            Mn[{fd, fd}] = 1.0; // unit mass on fixed DOFs so 1/M is fine
        }
        Kt.swap(Kn); Mt.swap(Mn);
    }

    Sparse K = Sparse::fromTriplets(ndof, Kt);
    Sparse M = Sparse::fromTriplets(ndof, Mt);

    // Inverse-power iteration with M-orthonormal deflation against
    // previously-converged modes.  Computes the nModes lowest
    // eigenfrequencies of K φ = λ M φ.
    int nWanted = std::max(1, nModes);
    ModalResult R;
    R.eigenfrequencies.reserve(nWanted);
    R.modeShapes.reserve(nWanted);

    std::vector<std::vector<double>> converged; // M-orthonormal vectors

    auto Mmul = [&](const std::vector<double>& x, std::vector<double>& y) {
        M.matvec(x, y);
    };
    auto innerM = [&](const std::vector<double>& a, const std::vector<double>& b) {
        std::vector<double> Mb(ndof);
        Mmul(b, Mb);
        double s = 0.0;
        for (int i = 0; i < ndof; ++i) s += a[i] * Mb[i];
        return s;
    };
    auto normM = [&](const std::vector<double>& x) {
        return std::sqrt(std::max(0.0, innerM(x, x)));
    };
    auto deflate = [&](std::vector<double>& v) {
        for (auto& q : converged) {
            double c = innerM(v, q);
            for (int i = 0; i < ndof; ++i) v[i] -= c * q[i];
        }
    };

    for (int m = 0; m < nWanted; ++m) {
        // Random start, deterministic seed for reproducibility.
        std::vector<double> v(ndof, 0.0);
        for (int i = 0; i < ndof; ++i) {
            // Pseudo-random — keep deterministic per (m, i).
            double x = std::sin(1.0 + 7.13 * (i + 1) + 17.71 * (m + 1));
            v[i] = x;
        }
        // Zero out fixed DOFs.
        for (int fd : fixedSet) v[fd] = 0.0;
        deflate(v);
        double nm = normM(v);
        if (nm < 1e-30) {
            for (int i = 0; i < ndof; ++i) v[i] = (i % 3 == 0) ? 1.0 : 0.0;
            deflate(v); nm = normM(v);
        }
        for (int i = 0; i < ndof; ++i) v[i] /= nm;

        double lambda = 0.0;
        bool ok = false;
        for (int it = 0; it < 80; ++it) {
            // Solve K w = M v.
            std::vector<double> Mv(ndof);
            Mmul(v, Mv);
            std::vector<double> w = v; // warm start
            double res = 0.0;
            conjugateGradient(K, Mv, w, std::max(2000, 10 * ndof), 1e-10, res);
            deflate(w);
            double wnorm = normM(w);
            if (wnorm < 1e-30) break;
            for (int i = 0; i < ndof; ++i) w[i] /= wnorm;

            // Rayleigh quotient on (K, M).
            std::vector<double> Kw(ndof);
            K.matvec(w, Kw);
            std::vector<double> Mw(ndof);
            M.matvec(w, Mw);
            double num = 0.0, den = 0.0;
            for (int i = 0; i < ndof; ++i) { num += w[i] * Kw[i]; den += w[i] * Mw[i]; }
            double lambdaNew = (std::abs(den) > 1e-30) ? num / den : 0.0;

            double diff = 0.0;
            for (int i = 0; i < ndof; ++i) {
                double d = w[i] - v[i];
                diff += d * d;
            }
            v = std::move(w);
            if (std::abs(lambdaNew - lambda) < 1e-8 * (1.0 + std::abs(lambdaNew))
                && diff < 1e-12) {
                lambda = lambdaNew;
                ok = true;
                break;
            }
            lambda = lambdaNew;
        }
        // Skip if this mode is penalty-dominated (ω² ~ kPenalty).
        if (lambda > kPenalty * 0.5) break;
        converged.push_back(v);
        if (lambda < 0.0) lambda = 0.0;
        double freq = std::sqrt(lambda) / (2.0 * M_PI);
        R.eigenfrequencies.push_back(freq);
        std::vector<std::array<double, 3>> shape(N);
        for (int i = 0; i < N; ++i) {
            shape[i] = {v[3*i+0], v[3*i+1], v[3*i+2]};
        }
        R.modeShapes.push_back(std::move(shape));
        if (!ok) {
            // accept partial — still inserted, but mark non-converged overall
        }
    }
    R.converged = (static_cast<int>(R.eigenfrequencies.size()) == nWanted);
    return R;
}

} // namespace forge::fea::tet
