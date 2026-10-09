// ===========================================================================
// fea_tet_surface_conformance_gate.cpp — does forge::fea::tet::meshShape's boundary
// converge to the CAD geometry?  (T-035; native C++, links forge_kernel_core only)
// ---------------------------------------------------------------------------
// The NAFEMS LE1/LE10 quarter elliptic annulus, built exactly as the JS harness built it
// (forge-kernel/test/fea_nafems_bc.mjs::buildEllipticSlab): an outer ellipsoid
// 3.25 x 2.75 x 30 minus an inner 2.0 x 1.0 x 30, common with a 3.5 x 3.0 x t box. With
// RZ = 30 the curved faces are a thin z-slice of two ellipsoids, so the TRUE surface of a
// curved boundary vertex is (x/a)^2 + (y/b)^2 + (z/30)^2 = 1, and every distance below is
// measured against that, not against the z-free ellipse (which is off by up to 6.5e-4 m at
// z = 0.6 -- a property of the geometry, not of the mesh).
//
// PART S — surface conformance (meshing only, t = 0.6, targetEdge 0.30 / 0.20 / 0.15 / 0.115 /
//   0.075). Every face incident on exactly one tet is assigned to ONE of the slab's six
//   surfaces by elimination (the four planes x=0, y=0, z=0, z=t by all-three-vertices-on-the-
//   plane, the rest to the nearer ellipsoid) — the method of fea_nafems_bc.mjs::
//   outerEllipseSurface, because the retracted T-026 root cause was two measurements against a
//   surface the vertex was never on. Measured per level, and ASSERTED TO CONVERGE (never
//   against a threshold) along the sweep's RATIO-2 chain (0.30 -> 0.15 -> 0.075):
//     S1a/b  curved-boundary VERTEX deviation, max, on the outer and on the inner surface:
//            the vertices the loads, the clamp and the stress recovery sit on.
//     S1c    the same over the curved vertices within 0.35 m of D (the acceptance's sample).
//     S2     curved-boundary FACET sag (max centroid deviation): the faceting itself, O(h^2).
//     S3     the LE10 mid-plane line trace, worst |dz| (the u_z support is traced on it).
//     S4     top-face (z = t) area error against the exact A0 (1 - t^2/30^2).
//   "Converges" (convergesCheck): EVERY step of the chain shrinks the quantity by at least
//   sqrt(2) (half order), and finest/coarsest shows observed order >= 1 (S3: >= 0.5, see the
//   call) against the targetEdge ratio; a value at geometric precision (<= 1e-6: 1 um, or
//   1 um^2 for S4) has nothing left to converge. A frozen or growing step fails. Only ratio-2 steps are
//   asserted because the boundary is refined by bisection: halving targetEdge cuts every edge
//   longer than minLen into exactly twice as many pieces, while a smaller step may leave a
//   region unrefined (the 0.20 and 0.115 levels are kept for the table and for the identical-
//   mesh LE10 A/B with the JS sweep). On the pre-T-035 mesher S1a/S1b/S2/S3/S4 are RED along
//   that chain — failing-first, measured, see reports/TET_SURFACE_ON_THE_GEOMETRY.md.
//   Also asserted at EVERY level: no unassigned curved facet, no shell fallback, no inverted
//   tet, and a VALID tetrahedralization (meshValidity: no face in > 2 tets, a closed 2-manifold
//   boundary, summed tet volume == enclosed volume). Reported only: node/tet counts, radius
//   ratio, volume error, mesh time.
//
// PART L — the LE1 / LE10 constraint and load model, ported from fea_nafems_bc.mjs
//   (elimination-based outer face; LE10 u_x = u_y = 0 on it and u_z = 0 on its mid-plane
//   line trace, 1 MPa down on z = t; LE1 10 MPa outward on the outer face, u_z = 0 on z = 0;
//   x = 0 / y = 0 symmetry), solved by forge::fea::tet::solveLinearStatic. The model's own
//   completeness checks are HARD (as in fea_nafems_gate.mjs): an empty outer set, an
//   unassigned facet, an empty LE10 line, an LE1 in-plane pressure resultant off
//   p t (2.75, 3.25) by > 0.1 %, a non-converged CG, a non-finite or wrong-sign sigma.
//   ACCURACY AGAINST NAFEMS IS MEASURED AND REPORTED, NOT ASSERTED: sigma_yy at D, error vs
//   the TNSB Rev.3 literal (LE10 -5.38 MPa, LE1 +92.7 MPa), and the refinement table.
//
// PART P — primitives: a box must mesh EXACTLY (volume, boundary vertices on the planes);
//   a cylinder and a sphere (seams, poles, plane/cylinder creases) must satisfy the same
//   convergence contract as Part S. Every primitive level must be a valid tetrahedralization:
//   cospherical surface samples are exactly what broke the old floating-point Bowyer-Watson.
// PART 11 — NAFEMS LE11 (fea_nafems_gate.mjs::solveLE11), REPORTED with correctness guards.
// PART Q — element quality: the fea_smoke.cjs cantilever (box 0.1 x 0.01 x 0.01 at 0.002),
//   static, with regression bounds on its min radius ratio, CG iterations, tip deflection and
//   peak von Mises (solveCantilever), and fea_boundary_refines_test.mjs's slender box
//   (0.2 x 0.01 x 0.01 at 0.004). Every mesh of every part is also asserted to hold NO
//   NUMERICALLY FLAT tet (checkNotFlat: min 6V / Lmax^3 >= kFlatFloor).
//
// Usage: fea_tet_surface_conformance_gate [surface|le10|le1|prim|le11|quality|all]   (default all)
//   FORGE_FEA_GATE_EDGES="0.3,0.2,..." overrides the Part S / LE10 sweep (diagnostics only;
//   Part S needs a ratio-2 chain of >= 3 levels in it), FORGE_FEA_GATE_LE1_EDGES the LE1 one.
// Output: human table + one machine line per level ("[surface-level] ...", "[le-level] ...")
// and a final "[surface-conformance] verdict=PASS|FAIL ..." line. Exit 0 iff every ASSERTED
// check held; 2 on a setup error.
// ===========================================================================

#include "forge/Booleans.hpp"
#include "forge/FeaTet.hpp"
#include "forge/Primitives.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/Transform.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

namespace tet = forge::fea::tet;

constexpr double kPi = 3.14159265358979323846;
constexpr double kRZ = 30.0;
struct Ell { double a, b; };
constexpr Ell kOuter{3.25, 2.75};
constexpr Ell kInner{2.0, 1.0};

// Exact cross-section area of the quarter annulus at z = 0, and its z-profile.
double areaAt(double z) {
    return 0.25 * kPi * (kOuter.a * kOuter.b - kInner.a * kInner.b) * (1.0 - z * z / (kRZ * kRZ));
}
double exactVolume(double t) {
    const double A0 = areaAt(0.0);
    return A0 * (t - t * t * t / (3.0 * kRZ * kRZ));
}

// First-order signed distance to the ellipse (x/a)^2 + (y/b)^2 = 1 — fea_nafems_bc.mjs's
// ellipseDistance, kept for JS parity of the model's printed diagnostics.
double ellipseDistance(double x, double y, Ell e) {
    const double f = (x / e.a) * (x / e.a) + (y / e.b) * (y / e.b);
    const double g = std::hypot(2.0 * x / (e.a * e.a), 2.0 * y / (e.b * e.b));
    return g > 0.0 ? (f - 1.0) / g : -std::min(e.a, e.b);
}
// First-order signed distance to the TRUE surface, the ellipsoid (x/a)^2+(y/b)^2+(z/RZ)^2=1.
double ellipsoidDistance(double x, double y, double z, Ell e) {
    const double f = (x / e.a) * (x / e.a) + (y / e.b) * (y / e.b) + (z / kRZ) * (z / kRZ);
    const double g = std::sqrt(std::pow(2.0 * x / (e.a * e.a), 2) + std::pow(2.0 * y / (e.b * e.b), 2) +
                               std::pow(2.0 * z / (kRZ * kRZ), 2));
    return g > 0.0 ? (f - 1.0) / g : -std::min(e.a, e.b);
}

struct P3 { double x, y, z; };
P3 nodeP(const tet::Mesh& m, int i) { return {m.nodes[i].x, m.nodes[i].y, m.nodes[i].z}; }

// A face incident on exactly one tet: v[0..2] and the tet's opposite vertex.
struct BFace { int v[3]; int apex; };

std::vector<BFace> tetBoundaryFaces(const tet::Mesh& m) {
    struct K { int a, b, c; bool operator==(const K& o) const { return a == o.a && b == o.b && c == o.c; } };
    struct H { std::size_t operator()(const K& k) const noexcept {
        std::uint64_t h = 1469598103934665603ull;
        for (int v : {k.a, k.b, k.c}) { h ^= static_cast<std::uint64_t>(static_cast<std::uint32_t>(v)); h *= 1099511628211ull; }
        return static_cast<std::size_t>(h); } };
    std::unordered_map<K, std::pair<int, BFace>, H> cnt;
    cnt.reserve(m.tets.size() * 3);
    for (const auto& t : m.tets) {
        const int n[4] = {t.a, t.b, t.c, t.d};
        const int f[4][4] = {{n[0], n[1], n[2], n[3]}, {n[0], n[1], n[3], n[2]},
                             {n[0], n[2], n[3], n[1]}, {n[1], n[2], n[3], n[0]}};
        for (const auto& q : f) {
            int s[3] = {q[0], q[1], q[2]};
            std::sort(s, s + 3);
            auto [it, ins] = cnt.try_emplace(K{s[0], s[1], s[2]}, 0, BFace{{q[0], q[1], q[2]}, q[3]});
            it->second.first++;
        }
    }
    std::vector<BFace> out;
    for (const auto& kv : cnt) if (kv.second.first == 1) out.push_back(kv.second.second);
    // Deterministic order (unordered_map iteration is not part of any contract).
    std::sort(out.begin(), out.end(), [](const BFace& a, const BFace& b) {
        int sa[3] = {a.v[0], a.v[1], a.v[2]}, sb[3] = {b.v[0], b.v[1], b.v[2]};
        std::sort(sa, sa + 3); std::sort(sb, sb + 3);
        return std::lexicographical_compare(sa, sa + 3, sb, sb + 3);
    });
    return out;
}

// Is the mesh a valid tetrahedralization of a solid? Three independent necessary conditions,
// each of which an overlapping / self-intersecting tet set violates:
//   * no face is shared by more than two tets;
//   * the boundary (faces of exactly one tet) is a closed 2-manifold: every boundary edge
//     belongs to exactly two boundary faces;
//   * the summed tet volume equals the volume the boundary encloses (divergence theorem over
//     the boundary faces oriented away from their tet) — overlapping tets count twice in the
//     first and once in the second.
// MEASURED: the projected boundary samples drove the pre-T-035 floating-point Bowyer-Watson to
// 321,464 overlapping "tets" on a cylinder r 0.5 at targetEdge 0.15; no assertion here caught
// it before this check existed.
double radiusRatio(const P3& a, const P3& b, const P3& c, const P3& d);

struct Validity {
    std::size_t overShared = 0, nonManifoldEdges = 0, boundaryFaces = 0, inverted = 0;
    double tetVolume = 0, enclosedVolume = 0;
    double minRadiusRatio = 1;   // element quality, REPORTED (geometric slivers are T-253)
    double minRelVolume = 1;     // min 6|V| / (longest edge)^3: ASSERTED by checkNotFlat
    bool ok() const {
        return overShared == 0 && nonManifoldEdges == 0 && inverted == 0 && boundaryFaces > 0 &&
               std::abs(tetVolume - enclosedVolume) <= 1e-9 * std::max(1.0, std::abs(tetVolume));
    }
};
Validity meshValidity(const tet::Mesh& m) {
    Validity v;
    std::map<std::array<int, 3>, int> faceCount;
    for (const auto& t : m.tets) {
        const int n[4] = {t.a, t.b, t.c, t.d};
        for (int k = 0; k < 4; ++k) {
            std::array<int, 3> f{n[(k + 1) % 4], n[(k + 2) % 4], n[(k + 3) % 4]};
            std::sort(f.begin(), f.end());
            ++faceCount[f];
        }
        const double ax = m.nodes[t.a].x, ay = m.nodes[t.a].y, az = m.nodes[t.a].z;
        const double ux = m.nodes[t.b].x - ax, uy = m.nodes[t.b].y - ay, uz = m.nodes[t.b].z - az;
        const double vx = m.nodes[t.c].x - ax, vy = m.nodes[t.c].y - ay, vz = m.nodes[t.c].z - az;
        const double wx = m.nodes[t.d].x - ax, wy = m.nodes[t.d].y - ay, wz = m.nodes[t.d].z - az;
        const double v6 = ux * (vy * wz - vz * wy) - uy * (vx * wz - vz * wx) + uz * (vx * wy - vy * wx);
        if (!(v6 > 0)) ++v.inverted;
        v.tetVolume += std::abs(v6) / 6.0;
        v.minRadiusRatio = std::min(v.minRadiusRatio, radiusRatio(nodeP(m, t.a), nodeP(m, t.b), nodeP(m, t.c), nodeP(m, t.d)));
        const P3 q[4] = {nodeP(m, t.a), nodeP(m, t.b), nodeP(m, t.c), nodeP(m, t.d)};
        double l2 = 0;
        for (int i = 0; i < 4; ++i)
            for (int j = i + 1; j < 4; ++j)
                l2 = std::max(l2, std::pow(q[i].x - q[j].x, 2) + std::pow(q[i].y - q[j].y, 2) + std::pow(q[i].z - q[j].z, 2));
        if (l2 > 0) v.minRelVolume = std::min(v.minRelVolume, std::abs(v6) / (l2 * std::sqrt(l2)));
    }
    for (const auto& kv : faceCount) if (kv.second > 2) ++v.overShared;
    std::map<std::pair<int, int>, int> edgeCount;
    for (const auto& f : tetBoundaryFaces(m)) {
        ++v.boundaryFaces;
        // orient (v0, v1, v2) away from the apex, then sum p0 . (p1 x p2) / 6
        const P3 p0 = nodeP(m, f.v[0]), apex = nodeP(m, f.apex);
        P3 p1 = nodeP(m, f.v[1]), p2 = nodeP(m, f.v[2]);
        const double nx = (p1.y - p0.y) * (p2.z - p0.z) - (p1.z - p0.z) * (p2.y - p0.y);
        const double ny = (p1.z - p0.z) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.z - p0.z);
        const double nz = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
        if (nx * (apex.x - p0.x) + ny * (apex.y - p0.y) + nz * (apex.z - p0.z) > 0) std::swap(p1, p2);
        v.enclosedVolume += (p0.x * (p1.y * p2.z - p1.z * p2.y) - p0.y * (p1.x * p2.z - p1.z * p2.x) +
                             p0.z * (p1.x * p2.y - p1.y * p2.x)) / 6.0;
        for (int k = 0; k < 3; ++k) {
            const int a = f.v[k], b = f.v[(k + 1) % 3];
            ++edgeCount[{std::min(a, b), std::max(a, b)}];
        }
    }
    for (const auto& kv : edgeCount) if (kv.second != 2) ++v.nonManifoldEdges;
    return v;
}
std::string validityText(const Validity& v) {
    char b[256];
    std::snprintf(b, sizeof b, "faces>2tets=%zu nonManifoldBoundaryEdges=%zu inverted=%zu tetVol=%.9g enclosedVol=%.9g",
                  v.overShared, v.nonManifoldEdges, v.inverted, v.tetVolume, v.enclosedVolume);
    return b;
}

// No NUMERICALLY FLAT tet. A tet whose four vertices are coplanar up to rounding is positive
// only by the rounding: its stiffness is ~singular and it pollutes the whole solve. MEASURED
// (T-035 validator, round 1): the exact-predicate Bowyer-Watson built one such tet on the
// fea_smoke cantilever — four samples on two box faces mirrored across their common edge, an
// isosceles trapezoid, exactly coplanar and cocircular in the reals — relative volume
// 6V / Lmax^3 = 2.1e-13 (radius ratio 1.48e-12), and CG went 1556 -> 27430 iterations, peak
// von Mises 56.35 -> 80.67 MPa. meshValidity cannot see it (its volume is positive).
// FLATNESS IS MEASURED AS RELATIVE VOLUME, 6|V| / (longest edge)^3 (0.707 for a regular tet),
// NOT radius ratio: for four nearly coplanar points that are NOT cocircular the circumradius
// grows like L^2 / h, so the radius ratio falls like (h / L)^2 and calls a geometric sliver
// "flat at rounding level" — MEASURED, LE1 at 0.09: radius ratio 1.35e-11 on a tet of relative
// volume 2.84e-9 (four outer-surface samples on two near-vertical generators of the RZ = 30
// ellipsoid: a geometric boundary sliver, identical on the round-1 mesh, T-253).
// The floor: the mesher's snap moves a coordinate by <= q/2 with q = 2^-49 x ~32 x the model
// size, so a tet positive only by the snap has 6V / L^3 <~ 12 q / L — at most ~3e-11 on these
// meshes (the cantilever's q / L = 2.2e-12 is the largest) — and bowyerWatson now emits a tet
// (other than on the faces of the tet containing the new point) only above 256 q / L, i.e.
// above ~6e-11 on these meshes. kFlatFloor lies below that and 140x above the measured flat
// tet (2.1e-13), and 95x below the flattest geometric sliver (2.84e-9); every level REPORTS both.
constexpr double kFlatFloor = 3e-11;
void check(bool ok, const std::string& what);
void checkNotFlat(const std::string& label, const Validity& v) {
    char b[240];
    std::snprintf(b, sizeof b, "%s: no numerically flat tet (min 6V/Lmax^3 %.3g >= %.0e; min radius ratio %.3g, reported)",
                  label.c_str(), v.minRelVolume, kFlatFloor, v.minRadiusRatio);
    check(v.minRelVolume >= kFlatFloor, b);
}

// Area and UNIT outward normal (flipped away from the apex) — triAreaOutwardNormal.
void areaOutwardNormal(const P3& p0, const P3& p1, const P3& p2, const P3& apex, double& A, double n[3]) {
    const double ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
    const double vx = p2.x - p0.x, vy = p2.y - p0.y, vz = p2.z - p0.z;
    double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    double L = std::sqrt(nx * nx + ny * ny + nz * nz);
    if (!(L > 0.0)) L = 1.0;
    A = 0.5 * L; nx /= L; ny /= L; nz /= L;
    const double cx = (p0.x + p1.x + p2.x) / 3, cy = (p0.y + p1.y + p2.y) / 3, cz = (p0.z + p1.z + p2.z) / 3;
    if ((apex.x - cx) * nx + (apex.y - cy) * ny + (apex.z - cz) * nz > 0) { nx = -nx; ny = -ny; nz = -nz; }
    n[0] = nx; n[1] = ny; n[2] = nz;
}

enum class Surf { X0, Y0, ZMin, ZMax, Outer, Inner, Unassigned };

struct Classified {
    std::vector<BFace> faces;
    std::vector<Surf> surf;
    double zMin = 0, zMax = 0;
    std::size_t unassigned = 0;
};

// outerEllipseSurface's elimination, applied to ALL six surfaces.
Classified classifyBoundary(const tet::Mesh& m, double maxDev = 0.5) {
    Classified c;
    c.faces = tetBoundaryFaces(m);
    double zMin = std::numeric_limits<double>::max(), zMax = -zMin, ext = 0;
    for (const auto& n : m.nodes) {
        zMin = std::min(zMin, n.z); zMax = std::max(zMax, n.z);
        ext = std::max({ext, std::abs(n.x), std::abs(n.y), std::abs(n.z)});
    }
    c.zMin = zMin; c.zMax = zMax;
    const double tol = 1e-6 * std::max(1.0, ext);
    c.surf.reserve(c.faces.size());
    for (const auto& f : c.faces) {
        const P3 p[3] = {nodeP(m, f.v[0]), nodeP(m, f.v[1]), nodeP(m, f.v[2])};
        auto all = [&](auto fn) { return fn(p[0]) && fn(p[1]) && fn(p[2]); };
        if (all([&](const P3& q) { return std::abs(q.x) < tol; })) { c.surf.push_back(Surf::X0); continue; }
        if (all([&](const P3& q) { return std::abs(q.y) < tol; })) { c.surf.push_back(Surf::Y0); continue; }
        if (all([&](const P3& q) { return std::abs(q.z - zMin) < tol; })) { c.surf.push_back(Surf::ZMin); continue; }
        if (all([&](const P3& q) { return std::abs(q.z - zMax) < tol; })) { c.surf.push_back(Surf::ZMax); continue; }
        const double cx = (p[0].x + p[1].x + p[2].x) / 3, cy = (p[0].y + p[1].y + p[2].y) / 3;
        const double dO = std::abs(ellipseDistance(cx, cy, kOuter)), dI = std::abs(ellipseDistance(cx, cy, kInner));
        if (std::min(dO, dI) > maxDev) { c.surf.push_back(Surf::Unassigned); ++c.unassigned; continue; }
        c.surf.push_back(dI < dO ? Surf::Inner : Surf::Outer);
    }
    return c;
}

// Largest |deviation| of a vertex of a curved boundary face from its own ellipsoid.
double curvedVertexMaxDev(const tet::Mesh& m, const Classified& c) {
    double worst = 0;
    for (std::size_t i = 0; i < c.faces.size(); ++i) {
        if (c.surf[i] != Surf::Outer && c.surf[i] != Surf::Inner) continue;
        const Ell e = c.surf[i] == Surf::Outer ? kOuter : kInner;
        for (int j = 0; j < 3; ++j) {
            const P3 q = nodeP(m, c.faces[i].v[j]);
            worst = std::max(worst, std::abs(ellipsoidDistance(q.x, q.y, q.z, e)));
        }
    }
    return worst;
}

// A curved-boundary vertex is either a projected sample (on the surface to the R1 projector's
// ~2e-8 m) or a lattice point the keep-out failed to hold back (off it by up to the keep-out,
// 0.5 targetEdge). kOnGeometry separates the two by >= 50x either way; it is asserted at EVERY
// level of Part S and of LE1 so that a lattice point exposed on a curved face is caught where
// it happens, not only where it changes a convergence ratio. (MEASURED, keep-out removed:
// 7 exposed vertices on the slab at 0.15, inner deviation 2.1e-4 m; 12 on LE1 at 0.09.)
constexpr double kOnGeometry = 1e-6;

// ---------------------------------------------------------------- the LE model
struct Diag {
    std::size_t outerNodes = 0, outerFaces = 0, outerUnassigned = 0, midNodes = 0;
    double outerWorstDev2D = 0, midWorstDz = 0, loadedArea = 0, resultantErr = 0;
    double resultant[3] = {0, 0, 0};
};
struct Model { tet::BC bc; Diag d; };

// ellipticPlateModel(kind, m, t) of fea_nafems_bc.mjs, line for line.
Model ellipticPlateModel(bool le10, const tet::Mesh& m, double t, const Classified& c,
                         double symTol = 1e-4, double topTol = 1e-3) {
    Model out;
    // outer faces (+ their outward normals) and node set
    struct OF { int v[3]; double A; double n[3]; };
    std::vector<OF> outer;
    std::set<int> outerNodes;
    for (std::size_t i = 0; i < c.faces.size(); ++i) {
        if (c.surf[i] != Surf::Outer) continue;
        const auto& f = c.faces[i];
        OF o{{f.v[0], f.v[1], f.v[2]}, 0, {0, 0, 0}};
        areaOutwardNormal(nodeP(m, f.v[0]), nodeP(m, f.v[1]), nodeP(m, f.v[2]), nodeP(m, f.apex), o.A, o.n);
        outer.push_back(o);
        for (int j = 0; j < 3; ++j) {
            outerNodes.insert(f.v[j]);
            const P3 q = nodeP(m, f.v[j]);
            out.d.outerWorstDev2D = std::max(out.d.outerWorstDev2D, std::abs(ellipseDistance(q.x, q.y, kOuter)));
        }
    }
    out.d.outerNodes = outerNodes.size();
    out.d.outerFaces = outer.size();
    out.d.outerUnassigned = c.unassigned;
    // LE10 line support: midPlaneTrace(m, outer.faces, t/2)
    std::set<int> mid;
    if (le10) {
        const double zMid = t / 2;
        const double tie = 1e-9 * std::max(1.0, std::abs(zMid));
        for (const auto& o : outer) {
            double zs[3], dz[3];
            for (int j = 0; j < 3; ++j) { zs[j] = m.nodes[o.v[j]].z; dz[j] = std::abs(zs[j] - zMid); }
            if (std::min({zs[0], zs[1], zs[2]}) > zMid || std::max({zs[0], zs[1], zs[2]}) < zMid) continue;
            const double best = std::min({dz[0], dz[1], dz[2]});
            for (int j = 0; j < 3; ++j) if (dz[j] <= best + tie) mid.insert(o.v[j]);
            out.d.midWorstDz = std::max(out.d.midWorstDz, best);
        }
    }
    out.d.midNodes = mid.size();
    // constraints
    for (std::size_t k = 0; k < m.nodes.size(); ++k) {
        const double x = m.nodes[k].x, y = m.nodes[k].y, z = m.nodes[k].z;
        tet::PrescribedDisp p;
        p.nodeId = m.nodes[k].id;
        if (std::abs(x) < symTol) p.fx = true;
        if (std::abs(y) < symTol) p.fy = true;
        if (!le10) {
            if (std::abs(z) < symTol) p.fz = true;
        } else {
            if (outerNodes.count(static_cast<int>(k))) { p.fx = true; p.fy = true; }
            if (mid.count(static_cast<int>(k))) p.fz = true;
        }
        if (p.fx || p.fy || p.fz) out.bc.prescribed.push_back(p);
    }
    // loads -> equivalent nodal forces
    std::vector<std::array<double, 3>> acc(m.nodes.size(), {0, 0, 0});
    std::vector<char> touched(m.nodes.size(), 0);
    auto add = [&](int v, double fx, double fy, double fz) { acc[v][0] += fx; acc[v][1] += fy; acc[v][2] += fz; touched[v] = 1; };
    if (!le10) {
        const double pres = 10e6;
        for (const auto& o : outer) {
            out.d.loadedArea += o.A;
            for (int j = 0; j < 3; ++j) add(o.v[j], pres * o.A / 3 * o.n[0], pres * o.A / 3 * o.n[1], pres * o.A / 3 * o.n[2]);
        }
    } else {
        const double pres = 1e6;
        for (std::size_t i = 0; i < c.faces.size(); ++i) {
            const auto& f = c.faces[i];
            const P3 p0 = nodeP(m, f.v[0]), p1 = nodeP(m, f.v[1]), p2 = nodeP(m, f.v[2]);
            if (!(std::abs(p0.z - t) < topTol && std::abs(p1.z - t) < topTol && std::abs(p2.z - t) < topTol)) continue;
            double A, n[3];
            areaOutwardNormal(p0, p1, p2, nodeP(m, f.apex), A, n);
            if (n[2] <= 0) continue;
            out.d.loadedArea += A;
            for (int j = 0; j < 3; ++j) add(f.v[j], 0, 0, -pres * A / 3);
        }
    }
    for (std::size_t v = 0; v < acc.size(); ++v) {
        if (!touched[v]) continue;
        out.bc.nodalForces.push_back({m.nodes[v].id, acc[v]});
        for (int k = 0; k < 3; ++k) out.d.resultant[k] += acc[v][k];
    }
    if (!le10) {
        const double ex = 10e6 * t * kOuter.b, ey = 10e6 * t * kOuter.a;
        out.d.resultantErr = std::hypot(out.d.resultant[0] - ex, out.d.resultant[1] - ey) / std::hypot(ex, ey);
    }
    return out;
}

// ---------------------------------------------------------------- geometry
forge::ShapeHandle buildEllipticSlab(double t) {
    using namespace forge;
    ShapeHandle o = makeEllipsoid(kOuter.a, kOuter.b, kRZ), i = makeEllipsoid(kInner.a, kInner.b, kRZ);
    ShapeHandle ann = cut(o, i), cl = makeBox(3.5, 3.0, t);
    ShapeHandle q = common(ann, cl);
    for (ShapeHandle h : {o, i, ann, cl}) ShapeRegistry::instance().release(h);
    return q;
}

double nowMs() {
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

double radiusRatio(const P3& a, const P3& b, const P3& c, const P3& d) {
    const double u[3] = {b.x - a.x, b.y - a.y, b.z - a.z}, v[3] = {c.x - a.x, c.y - a.y, c.z - a.z},
                 w[3] = {d.x - a.x, d.y - a.y, d.z - a.z};
    auto cross = [](const double* p, const double* q, double* r) {
        r[0] = p[1] * q[2] - p[2] * q[1]; r[1] = p[2] * q[0] - p[0] * q[2]; r[2] = p[0] * q[1] - p[1] * q[0]; };
    auto dot = [](const double* p, const double* q) { return p[0] * q[0] + p[1] * q[1] + p[2] * q[2]; };
    auto nrm = [&](const double* p) { return std::sqrt(dot(p, p)); };
    double uv[3], uw[3], vw[3], wu[3];
    cross(u, v, uv); cross(u, w, uw); cross(v, w, vw); cross(w, u, wu);
    const double V6 = std::abs(dot(uv, w));
    if (!(V6 > 0)) return 0.0;
    const double cb[3] = {c.x - b.x, c.y - b.y, c.z - b.z}, db[3] = {d.x - b.x, d.y - b.y, d.z - b.z};
    double bcd[3]; cross(cb, db, bcd);
    const double S = 0.5 * (nrm(uv) + nrm(uw) + nrm(vw) + nrm(bcd));
    const double rin = 0.5 * V6 / S;
    double num[3];
    for (int k = 0; k < 3; ++k) num[k] = vw[k] * dot(u, u) + wu[k] * dot(v, v) + uv[k] * dot(w, w);
    const double R = nrm(num) / (2.0 * V6);
    return R > 0 ? 3.0 * rin / R : 0.0;
}

// ---------------------------------------------------------------- Part S metrics
struct SurfaceLevel {
    double edge = 0, meshMs = 0;
    std::size_t nodes = 0, tets = 0, bndVerts = 0, curvedVerts = 0, offSurface = 0, unassigned = 0, inverted = 0;
    std::size_t nearProbeVerts = 0, slivers = 0;
    bool shell = false;
    double vertMax = 0, vertP95 = 0, vertMean = 0;        // curved-boundary vertex |dev| (ellipsoid)
    double outerVertMax = 0, innerVertMax = 0;            // the same, per curved surface
    double facetSag = 0;                                  // curved-boundary facet centroid |dev|, max
    double nearProbeMax = 0;                              // curved vertices within 0.35 m of D
    double outerWorstDev2D = 0, midWorstDz = 0;
    std::size_t midNodes = 0, outerFaces = 0;
    double topArea = 0, topAreaErrPct = 0, volErrPct = 0, minRadiusRatio = 1;
    Validity valid;
};

SurfaceLevel measureSurface(const tet::Mesh& m, const Classified& c, double t, double edge) {
    SurfaceLevel s;
    s.edge = edge; s.nodes = m.nodes.size(); s.tets = m.tets.size(); s.shell = m.shellTetsOnly;
    s.unassigned = c.unassigned;
    // Every vertex of a curved face belongs to that face's ellipsoid; a crease vertex is on
    // both a plane and an ellipsoid and must be on the ellipsoid too.
    std::unordered_map<int, double> dev;   // vertex -> |dev| from its ellipsoid (max if on both)
    std::set<int> bnd;
    for (std::size_t i = 0; i < c.faces.size(); ++i) {
        const auto& f = c.faces[i];
        for (int j = 0; j < 3; ++j) bnd.insert(f.v[j]);
        if (c.surf[i] != Surf::Outer && c.surf[i] != Surf::Inner) continue;
        const Ell e = c.surf[i] == Surf::Outer ? kOuter : kInner;
        P3 cen{0, 0, 0};
        for (int j = 0; j < 3; ++j) {
            const P3 q = nodeP(m, f.v[j]);
            cen.x += q.x / 3; cen.y += q.y / 3; cen.z += q.z / 3;
            const double d = std::abs(ellipsoidDistance(q.x, q.y, q.z, e));
            auto [it, ins] = dev.try_emplace(f.v[j], d);
            if (!ins) it->second = std::max(it->second, d);
            double& perSurf = c.surf[i] == Surf::Outer ? s.outerVertMax : s.innerVertMax;
            perSurf = std::max(perSurf, d);
        }
        s.facetSag = std::max(s.facetSag, std::abs(ellipsoidDistance(cen.x, cen.y, cen.z, e)));
    }
    s.bndVerts = bnd.size();
    std::vector<double> ds;
    ds.reserve(dev.size());
    const P3 D{2.0, 0.0, t};
    for (const auto& kv : dev) {
        ds.push_back(kv.second);
        if (kv.second > 1e-3) ++s.offSurface;
        const P3 q = nodeP(m, kv.first);
        if (std::hypot(q.x - D.x, q.y - D.y, q.z - D.z) <= 0.35) {
            ++s.nearProbeVerts;
            s.nearProbeMax = std::max(s.nearProbeMax, kv.second);
        }
    }
    s.curvedVerts = ds.size();
    if (!ds.empty()) {
        std::sort(ds.begin(), ds.end());
        s.vertMax = ds.back();
        s.vertP95 = ds[static_cast<std::size_t>(std::floor(0.95 * (ds.size() - 1)))];
        double sum = 0; for (double d : ds) sum += d;
        s.vertMean = sum / ds.size();
    }
    // top-face area (z = zMax plane faces with an upward outward normal)
    for (std::size_t i = 0; i < c.faces.size(); ++i) {
        if (c.surf[i] != Surf::ZMax) continue;
        const auto& f = c.faces[i];
        double A, n[3];
        areaOutwardNormal(nodeP(m, f.v[0]), nodeP(m, f.v[1]), nodeP(m, f.v[2]), nodeP(m, f.apex), A, n);
        if (n[2] > 0) s.topArea += A;
    }
    s.topAreaErrPct = (s.topArea - areaAt(t)) / areaAt(t) * 100.0;
    double V = 0;
    for (const auto& T : m.tets) {
        const P3 a = nodeP(m, T.a), b = nodeP(m, T.b), cc = nodeP(m, T.c), d = nodeP(m, T.d);
        const double v6 = (b.x - a.x) * ((cc.y - a.y) * (d.z - a.z) - (cc.z - a.z) * (d.y - a.y)) -
                          (b.y - a.y) * ((cc.x - a.x) * (d.z - a.z) - (cc.z - a.z) * (d.x - a.x)) +
                          (b.z - a.z) * ((cc.x - a.x) * (d.y - a.y) - (cc.y - a.y) * (d.x - a.x));
        if (!(v6 > 0)) ++s.inverted;
        V += std::abs(v6) / 6.0;
        const double rr = radiusRatio(a, b, cc, d);
        s.minRadiusRatio = std::min(s.minRadiusRatio, rr);
        if (rr < 0.02) ++s.slivers;
    }
    s.volErrPct = (V - exactVolume(t)) / exactVolume(t) * 100.0;
    s.valid = meshValidity(m);
    const Model md = ellipticPlateModel(/*le10*/ true, m, t, c);
    s.outerWorstDev2D = md.d.outerWorstDev2D; s.midWorstDz = md.d.midWorstDz;
    s.midNodes = md.d.midNodes; s.outerFaces = md.d.outerFaces;
    return s;
}

// ---------------------------------------------------------------- Part L solve
struct LeLevel {
    double edge = 0, sigma = 0, errPct = 0, meshMs = 0, solveMs = 0, cgResidual = 0, curvedMaxDev = 0;
    std::size_t nodes = 0, tets = 0;
    int cgIters = 0;
    bool converged = false;
    Diag d;
    P3 probe{0, 0, 0};
    Validity valid;
};

int gFail = 0;
void check(bool ok, const std::string& what) {
    std::printf("  %s  %s\n", ok ? "ok  " : "FAIL", what.c_str());
    if (!ok) ++gFail;
}

LeLevel solveLe(bool le10, const tet::Mesh& m, const Classified& c, double t, const P3& probe, double target) {
    LeLevel L;
    L.nodes = m.nodes.size(); L.tets = m.tets.size();
    L.valid = meshValidity(m);
    L.curvedMaxDev = curvedVertexMaxDev(m, c);
    Model md = ellipticPlateModel(le10, m, t, c);
    L.d = md.d;
    const tet::Material mat{210e9, 0.3, 7850, 0.0};
    const double t0 = nowMs();
    const tet::Result r = tet::solveLinearStatic(m, mat, md.bc);
    L.solveMs = nowMs() - t0;
    L.converged = r.converged; L.cgIters = r.cgIterations; L.cgResidual = r.cgResidual;
    double best = std::numeric_limits<double>::max(); int bi = -1;
    for (std::size_t k = 0; k < m.nodes.size(); ++k) {
        const double d = std::pow(m.nodes[k].x - probe.x, 2) + std::pow(m.nodes[k].y - probe.y, 2) +
                         std::pow(m.nodes[k].z - probe.z, 2);
        if (d < best) { best = d; bi = static_cast<int>(k); }
    }
    if (bi >= 0 && static_cast<std::size_t>(bi) < r.nodalStress.size()) {
        L.sigma = r.nodalStress[bi][1];
        L.probe = nodeP(m, bi);
    } else {
        L.sigma = std::numeric_limits<double>::quiet_NaN();
    }
    L.errPct = (L.sigma / 1e6 - target) / std::abs(target) * 100.0;
    return L;
}

// "Converges", decided per refinement STEP and overall, never against a threshold:
//   * every step h_prev -> h_next shrinks the quantity by at least (h_prev/h_next)^0.5
//     (half order — slack for a quantity that is a maximum over a sample that changes
//     with the mesh), and
//   * finest against coarsest shows observed order p >= pMin (1: first order) against the
//     targetEdge ratio;
//   a step (or the overall pair) whose two values are BOTH at geometric precision —
//   <= 1e-6 (1 um, or 1 um^2 for the S4 area; the R1 projector puts vertices on these
//   metre-scale surfaces to ~2e-8 m) — passes: there is nothing left to converge.
// A frozen quantity (ratio 1 on a step) or a growing one fails.
bool convergesCheck(const char* name, const std::vector<double>& edges, const std::vector<double>& vals,
                    double pMin) {
    const std::size_t n = vals.size();
    auto prec = [&](std::size_t i) { return std::abs(vals[i]) <= 1e-6; };
    bool stepsOk = true;
    std::string stepTxt;
    for (std::size_t i = 1; i < n; ++i) {
        const double need = std::sqrt(edges[i - 1] / edges[i]);
        const double a = std::abs(vals[i - 1]), b = std::abs(vals[i]);
        const bool ok = (prec(i - 1) && prec(i)) || (b > 0 ? a / b >= need : a > 0 || prec(i));
        char t[96];
        std::snprintf(t, sizeof t, "%sx%.3g%s", i > 1 ? " " : "", b > 0 ? a / b : std::numeric_limits<double>::infinity(),
                      ok ? "" : "(!)");
        stepTxt += t;
        if (!ok) stepsOk = false;
    }
    const double vc = std::abs(vals.front()), vf = std::abs(vals.back());
    double p = std::numeric_limits<double>::quiet_NaN();
    if (vc > 0 && vf > 0) p = std::log(vc / vf) / std::log(edges.front() / edges.back());
    const bool overallOk = (prec(0) && prec(n - 1)) || prec(n - 1) || (std::isfinite(p) && p >= pMin);
    const bool ok = stepsOk && overallOk;
    std::ostringstream os;
    os << name << ": [";
    for (std::size_t i = 0; i < n; ++i) { char b[32]; std::snprintf(b, sizeof b, "%s%.4g", i ? ", " : "", vals[i]); os << b; }
    char tail[256];
    std::snprintf(tail, sizeof tail, "]  step shrink {%s} (need >= sqrt(h ratio)), overall p = %s (need >= %.1f)%s",
                  stepTxt.c_str(), std::isfinite(p) ? std::to_string(p).substr(0, 5).c_str() : "n/a", pMin,
                  prec(n - 1) ? ", finest at geometric precision" : "");
    os << tail;
    check(ok, os.str());
    return ok;
}

std::vector<double> parseEdges(const char* env, std::vector<double> dflt) {
    if (!env || !*env) return dflt;
    std::vector<double> out;
    std::stringstream ss(env);
    std::string tok;
    while (std::getline(ss, tok, ',')) { const double v = std::atof(tok.c_str()); if (v > 0) out.push_back(v); }
    return out.size() >= 2 ? out : dflt;
}


// ---------------------------------------------------------------- Part P: primitives
// The same convergence contract on shapes whose every surface is known in closed form:
// a box (all planar — the mesh must be EXACT: volume, and every boundary vertex on a face
// plane), a cylinder (planar caps + a periodic lateral face with a seam) and a sphere (one
// periodic face, a seam and two poles). These guard the seam/pole/crease cases the slab does
// not have.
struct PrimLevel { double edge = 0, vertMax = 0, facetSag = 0, volErr = 0; std::size_t tets = 0, curved = 0; bool shell = false; Validity valid; };

PrimLevel measurePrim(const tet::Mesh& m, double edge, int kind, double R, double H, double Vexact) {
    // kind 1 = cylinder (radius R, z in [0, H]), 2 = sphere (radius R, centred)
    PrimLevel L;
    L.edge = edge; L.tets = m.tets.size(); L.shell = m.shellTetsOnly;
    const auto faces = tetBoundaryFaces(m);
    auto dev = [&](const P3& q) {
        return kind == 1 ? std::abs(std::hypot(q.x, q.y) - R) : std::abs(std::sqrt(q.x * q.x + q.y * q.y + q.z * q.z) - R);
    };
    std::set<int> curved;
    for (const auto& f : faces) {
        const P3 p[3] = {nodeP(m, f.v[0]), nodeP(m, f.v[1]), nodeP(m, f.v[2])};
        if (kind == 1) {
            const double tol = 1e-9 * std::max(1.0, H);
            bool cap = true;
            for (const auto& q : p) if (!(std::abs(q.z) < tol)) cap = false;
            if (cap) continue;
            cap = true;
            for (const auto& q : p) if (!(std::abs(q.z - H) < tol)) cap = false;
            if (cap) continue;
        }
        const P3 c{(p[0].x + p[1].x + p[2].x) / 3, (p[0].y + p[1].y + p[2].y) / 3, (p[0].z + p[1].z + p[2].z) / 3};
        L.facetSag = std::max(L.facetSag, dev(c));
        for (int j = 0; j < 3; ++j) { curved.insert(f.v[j]); L.vertMax = std::max(L.vertMax, dev(p[j])); }
    }
    L.curved = curved.size();
    double V = 0;
    for (const auto& T : m.tets) {
        const P3 a = nodeP(m, T.a), b = nodeP(m, T.b), cc = nodeP(m, T.c), d = nodeP(m, T.d);
        V += std::abs((b.x - a.x) * ((cc.y - a.y) * (d.z - a.z) - (cc.z - a.z) * (d.y - a.y)) -
                      (b.y - a.y) * ((cc.x - a.x) * (d.z - a.z) - (cc.z - a.z) * (d.x - a.x)) +
                      (b.z - a.z) * ((cc.x - a.x) * (d.y - a.y) - (cc.y - a.y) * (d.x - a.x))) / 6.0;
    }
    L.volErr = (V - Vexact) / Vexact;
    L.valid = meshValidity(m);
    return L;
}

// ---------------------------------------------------------------- Part 11: LE11
// NAFEMS LE11 solid cylinder/taper/sphere, thermal — fea_nafems_gate.mjs::solveLE11, line for
// line: quarter sector, inner sphere R1.0 -> cylinder r0.7071, outer sphere R1.4 -> cone taper
// -> cylinder r1.0, z in [0, zTop]; dT = sqrt(x^2+y^2) + z, alpha = 2.3e-4; u_x = 0 on x=0,
// u_y = 0 on y=0, u_z = 0 on z=0 and z=zTop. sigma_zz at A(1,0,0), target -105 MPa.
// REPORTED, not asserted, except the correctness guards (solid mesh, CG, finite, sign).
// The native boolean is known to REFUSE this fuse on some machines (fea_nafems_baseline.txt):
// a refusal is reported BLOCKED and is not a failure of this gate.
struct Le11 { double edge = 0, sigma = 0, errPct = 0; std::size_t nodes = 0, tets = 0; bool converged = false, shell = false; std::string blocked; Validity valid; };
Le11 solveLe11(double edge) {
    using namespace forge;
    Le11 r;
    r.edge = edge;
    const double z1 = std::sin(kPi / 4), zTop = z1 + 0.69 + 0.4, alpha = 2.3e-4;
    ShapeHandle le11 = kInvalidHandle;
    try {
        ShapeHandle ballO = makeSphere(1.4), ballI = makeSphere(1.0);
        ShapeHandle cone0 = makeCone(std::sqrt(1.4 * 1.4 - z1 * z1), 1.0, 0.69);
        ShapeHandle coneO = translate(cone0, 0, 0, z1);
        ShapeHandle cyl0 = makeCylinder(1.0, 0.4);
        ShapeHandle cylO = translate(cyl0, 0, 0, z1 + 0.69);
        ShapeHandle cylI = makeCylinder(0.7071, 2.2);
        ShapeHandle f1 = fuse(ballO, coneO);
        ShapeHandle outerS = fuse(f1, cylO);
        ShapeHandle innerS = fuse(ballI, cylI);
        ShapeHandle body = cut(outerS, innerS);
        ShapeHandle clip = makeBox(1.5, 1.5, zTop);
        le11 = common(body, clip);
        for (ShapeHandle h : {ballO, ballI, cone0, coneO, cyl0, cylO, cylI, f1, outerS, innerS, body, clip})
            ShapeRegistry::instance().release(h);
    } catch (const std::exception& ex) {
        r.blocked = ex.what();
        const auto nl = r.blocked.find('\n');
        if (nl != std::string::npos) r.blocked.resize(nl);
        return r;
    }
    tet::Mesh m = tet::meshShapeFromHandle(le11, edge);
    ShapeRegistry::instance().release(le11);
    r.nodes = m.nodes.size(); r.tets = m.tets.size(); r.shell = m.shellTetsOnly;
    r.valid = meshValidity(m);
    tet::BC bc;
    for (const auto& n : m.nodes) {
        tet::PrescribedDisp p;
        p.nodeId = n.id;
        if (std::abs(n.x) < 1e-5) p.fx = true;
        if (std::abs(n.y) < 1e-5) p.fy = true;
        if (std::abs(n.z) < 1e-5 || std::abs(n.z - zTop) < 1e-5) p.fz = true;
        if (p.fx || p.fy || p.fz) bc.prescribed.push_back(p);
        bc.nodeTemps.push_back({n.id, std::hypot(n.x, n.y) + n.z});
    }
    const tet::Result res = tet::solveLinearStatic(m, tet::Material{210e9, 0.3, 7850, alpha}, bc);
    r.converged = res.converged;
    double best = std::numeric_limits<double>::max(); int bi = -1;
    for (std::size_t k = 0; k < m.nodes.size(); ++k) {
        const double d = std::pow(m.nodes[k].x - 1, 2) + std::pow(m.nodes[k].y, 2) + std::pow(m.nodes[k].z, 2);
        if (d < best) { best = d; bi = static_cast<int>(k); }
    }
    r.sigma = (bi >= 0 && static_cast<std::size_t>(bi) < res.nodalStress.size()) ? res.nodalStress[bi][2]
                                                                                   : std::numeric_limits<double>::quiet_NaN();
    r.errPct = (r.sigma / 1e6 + 105.0) / 105.0 * 100.0;
    return r;
}

// ---------------------------------------------------------------- Part Q: element quality
// The fea_smoke.cjs cantilever, native and STATIC only (its modal solve is ~160 s): a steel
// beam 0.1 x 0.01 x 0.01 m meshed at targetEdge 0.002, every node at x = xmin clamped, 100 N
// in -z spread evenly over the nodes at x = xmax — fea_smoke.cjs's node selection (tolerance
// 1e-3 of the length) and material, line for line. All planar, so the boundary projection and
// the keep-out play no part: this is the mesher's Delaunay fill on cospherical lattice and
// mirrored face samples, the case that produced a numerically flat tet (kFlatFloor above).
struct Cantilever {
    std::size_t nodes = 0, tets = 0, fixedN = 0, tipN = 0;
    double meshMs = 0, solveMs = 0, maxDisp = 0, maxVM = 0;
    int cgIters = 0;
    bool converged = false, shell = false;
    Validity valid;
};
Cantilever solveCantilever() {
    Cantilever c;
    forge::ShapeHandle h = forge::makeBox(0.1, 0.01, 0.01);
    double t0 = nowMs();
    tet::Mesh m = tet::meshShapeFromHandle(h, 0.002);
    c.meshMs = nowMs() - t0;
    forge::ShapeRegistry::instance().release(h);
    c.nodes = m.nodes.size(); c.tets = m.tets.size(); c.shell = m.shellTetsOnly;
    c.valid = meshValidity(m);
    double xmin = std::numeric_limits<double>::max(), xmax = -xmin;
    for (const auto& n : m.nodes) { xmin = std::min(xmin, n.x); xmax = std::max(xmax, n.x); }
    const double tol = (xmax - xmin) * 1e-3;
    tet::BC bc;
    std::vector<int> tip;
    for (std::size_t i = 0; i < m.nodes.size(); ++i) {
        if (m.nodes[i].x - xmin < tol) bc.fixedNodes.push_back(static_cast<int>(i));
        if (xmax - m.nodes[i].x < tol) tip.push_back(static_cast<int>(i));
    }
    for (int i : tip) bc.nodalForces.push_back({i, {0.0, 0.0, -100.0 / static_cast<double>(tip.size())}});
    c.fixedN = bc.fixedNodes.size(); c.tipN = tip.size();
    t0 = nowMs();
    const tet::Result r = tet::solveLinearStatic(m, tet::Material{200e9, 0.3, 7850, 0.0}, bc);
    c.solveMs = nowMs() - t0;
    c.converged = r.converged; c.cgIters = r.cgIterations; c.maxDisp = r.maxDisp; c.maxVM = r.maxVonMises;
    return c;
}
}  // namespace

int main(int argc, char** argv) {
    const std::string which = argc > 1 ? argv[1] : "all";
    const bool doS = which == "all" || which == "surface";
    const bool doL10 = which == "all" || which == "le10";
    const bool doL1 = which == "all" || which == "le1";
    const bool doP = which == "all" || which == "prim";
    const bool doL11 = which == "all" || which == "le11";
    const bool doQ = which == "all" || which == "quality";
    if (!doS && !doL10 && !doL1 && !doP && !doL11 && !doQ) {
        std::fprintf(stderr, "usage: %s [surface|le10|le1|prim|le11|quality|all]\n", argv[0]);
        return 2;
    }

    std::printf("=====================================================================\n");
    std::printf(" fea::tet surface conformance + NAFEMS LE1/LE10 model (native C++)\n");
    std::printf("=====================================================================\n");

    // ---- t = 0.6: Part S and LE10 share the mesh of each level -------------------------
    if (doS || doL10) {
        const double t = 0.6;
        std::vector<double> edges = parseEdges(std::getenv("FORGE_FEA_GATE_EDGES"), {0.30, 0.20, 0.15, 0.115, 0.075});
        std::vector<SurfaceLevel> S;
        std::vector<LeLevel> L10;
        for (double e : edges) {
            forge::ShapeHandle q;
            try { q = buildEllipticSlab(t); }
            catch (const std::exception& ex) { std::printf("SETUP ERROR: slab build failed: %s\n", ex.what()); return 2; }
            const double t0 = nowMs();
            tet::Mesh m = tet::meshShapeFromHandle(q, e);
            const double ms = nowMs() - t0;
            forge::ShapeRegistry::instance().release(q);
            const Classified c = classifyBoundary(m);
            SurfaceLevel s = measureSurface(m, c, t, e);
            s.meshMs = ms;
            S.push_back(s);
            std::printf("[surface-level] edge=%.4g nodes=%zu tets=%zu meshMs=%.0f shell=%d bndVerts=%zu curvedVerts=%zu "
                        "vertMax=%.6g outerVertMax=%.6g innerVertMax=%.6g vertP95=%.6g vertMean=%.6g offSurface=%zu facetSag=%.6g nearProbeVerts=%zu "
                        "nearProbeMax=%.6g outerFaces=%zu outerWorstDev2D=%.6g midNodes=%zu midWorstDz=%.6g "
                        "topArea=%.6g topAreaErrPct=%.4f volErrPct=%.4f unassigned=%zu inverted=%zu "
                        "minRadiusRatio=%.3g slivers=%zu minRelVolume=%.3g\n",
                        e, s.nodes, s.tets, s.meshMs, s.shell ? 1 : 0, s.bndVerts, s.curvedVerts, s.vertMax, s.outerVertMax, s.innerVertMax, s.vertP95,
                        s.vertMean, s.offSurface, s.facetSag, s.nearProbeVerts, s.nearProbeMax, s.outerFaces,
                        s.outerWorstDev2D, s.midNodes, s.midWorstDz, s.topArea, s.topAreaErrPct, s.volErrPct,
                        s.unassigned, s.inverted, s.minRadiusRatio, s.slivers, s.valid.minRelVolume);
            std::fflush(stdout);
            if (doL10) {
                LeLevel l = solveLe(true, m, c, t, P3{2.0, 0.0, 0.6}, -5.38);
                l.edge = e; l.meshMs = ms;
                L10.push_back(l);
                std::printf("[le-level] case=LE10 edge=%.4g nodes=%zu tets=%zu sigma=%.4f target=-5.38 errPct=%.2f "
                            "probe=(%.3f,%.3f,%.3f) outerNodes=%zu outerFaces=%zu outerWorstDev2D=%.4g midNodes=%zu "
                            "midWorstDz=%.4g loadedArea=%.4f converged=%d cgIters=%d solveMs=%.0f\n",
                            e, l.nodes, l.tets, l.sigma / 1e6, l.errPct, l.probe.x, l.probe.y, l.probe.z, l.d.outerNodes,
                            l.d.outerFaces, l.d.outerWorstDev2D, l.d.midNodes, l.d.midWorstDz, l.d.loadedArea,
                            l.converged ? 1 : 0, l.cgIters, l.solveMs);
                std::fflush(stdout);
            }
        }
        if (doS) {
            std::printf("\n--- PART S: surface conformance (t = 0.6) -----------------------------\n");
            std::printf(" edge    nodes   tets  curvedV  outerVmax  innerVmax  nearD      vertP95    facetSag   midDz      topErr%%   volErr%%  minRR     meshMs\n");
            for (const auto& s : S)
                std::printf(" %-6.4g %6zu %6zu %7zu  %-9.3e  %-9.3e  %-9.3e  %-9.3e  %-9.3e  %-9.3e  %+7.3f  %+7.3f  %-8.2e  %6.0f\n",
                            s.edge, s.nodes, s.tets, s.curvedVerts, s.outerVertMax, s.innerVertMax, s.nearProbeMax,
                            s.vertP95, s.facetSag, s.midWorstDz, s.topAreaErrPct, s.volErrPct, s.minRadiusRatio, s.meshMs);
            // Convergence is asserted along the RATIO-2 chain of the sweep (0.30 -> 0.15 -> 0.075
            // by default). The boundary is refined by bisection, so halving targetEdge cuts every
            // edge longer than minLen into exactly twice as many pieces; a smaller step can
            // legitimately leave a region unrefined (an edge of length L ends at L / 2^k — a
            // staircase in targetEdge), which is a property of the refinement ratio, not a
            // frozen surface. The intermediate levels are printed above and stay in the LE10
            // table (they are the JS sweep's levels, for the identical-mesh A/B).
            std::vector<std::size_t> chain{0};
            for (std::size_t i = 1; i < edges.size(); ++i)
                if (std::abs(edges[i] - 0.5 * edges[chain.back()]) <= 1e-9 * edges[chain.back()]) chain.push_back(i);
            std::vector<double> ce, vOut, vIn, vNear, fSag, mDz, aErr;
            for (std::size_t i : chain) {
                const auto& s = S[i];
                ce.push_back(s.edge);
                vOut.push_back(s.outerVertMax); vIn.push_back(s.innerVertMax); vNear.push_back(s.nearProbeMax);
                fSag.push_back(s.facetSag); mDz.push_back(s.midWorstDz);
                aErr.push_back(s.topAreaErrPct / 100.0 * areaAt(t));   // absolute area error, m^2
            }
            {
                std::string c = "ratio-2 chain of the sweep: ";
                for (double e : ce) c += std::to_string(e).substr(0, 5) + " ";
                check(chain.size() >= 3, c + "(need >= 3 levels to assert convergence)");
            }
            if (chain.size() >= 3) {
                convergesCheck("S1a outer-surface vertex max |dev| (m)", ce, vOut, 1.0);
                convergesCheck("S1b inner-surface vertex max |dev| (m)", ce, vIn, 1.0);
                convergesCheck("S1c curved vertices within 0.35 m of D, max |dev| (m)", ce, vNear, 1.0);
                convergesCheck("S2 curved-boundary facet sag max (m)", ce, fSag, 1.0);
                // S3 is first order at best (half the vertical extent of the facet that crosses
                // the line z = t/2, which is not a mesh feature) and its max over a discretely
                // moving set of crossing facets need not drop a full 2x per halving, so its overall
                // order bound is 0.5 — implied by the sqrt(2)-per-halving step rule, which still
                // fails a frozen or growing trace (the pre-T-035 signature: 0.06 -> 0.10 -> 0.13 m).
                convergesCheck("S3 LE10 mid-plane line trace worst |dz| (m)", ce, mDz, 0.5);
                convergesCheck("S4 top-face area error (m^2)", ce, aErr, 1.0);
            }
            for (const auto& s : S) {
                char b[160];
                std::snprintf(b, sizeof b, "edge %.4g: solid mesh, no unassigned facet, no inverted tet (shell=%d unassigned=%zu inverted=%zu)",
                              s.edge, s.shell ? 1 : 0, s.unassigned, s.inverted);
                check(!s.shell && s.unassigned == 0 && s.inverted == 0, b);
                check(s.valid.ok(), "edge " + std::to_string(s.edge).substr(0, 5) +
                                        ": valid tetrahedralization (" + validityText(s.valid) + ")");
                checkNotFlat("edge " + std::to_string(s.edge).substr(0, 5), s.valid);
                std::snprintf(b, sizeof b, "edge %.4g: every curved-boundary vertex on its ellipsoid (max |dev| %.3g <= %.0e m)",
                              s.edge, s.vertMax, kOnGeometry);
                check(s.vertMax <= kOnGeometry, b);
            }
        }
        if (doL10) {
            std::printf("\n--- PART L: LE10 thick plate, sigma_yy at D(2,0,0.6) [REPORTED, not asserted] ---\n");
            std::printf(" edge    nodes   tets   sigma[MPa]   err%%     outerN  midN  midDz      CG\n");
            for (const auto& l : L10)
                std::printf(" %-6.4g %6zu %6zu  %9.4f  %+7.2f   %6zu %5zu  %-9.3e  %s/%d\n", l.edge, l.nodes, l.tets,
                            l.sigma / 1e6, l.errPct, l.d.outerNodes, l.d.midNodes, l.d.midWorstDz,
                            l.converged ? "conv" : "NOT", l.cgIters);
            bool mono = true;
            for (std::size_t i = 1; i < L10.size(); ++i) if (std::abs(L10[i].errPct) >= std::abs(L10[i - 1].errPct)) mono = false;
            std::printf(" monotone |err| sequence: %s\n", mono ? "YES" : "NO (Richardson/GCI does not apply)");
            for (const auto& l : L10) {
                char b[200];
                std::snprintf(b, sizeof b, "LE10 edge %.4g: model complete (outer %zu nodes, unassigned %zu, line %zu nodes), CG converged, sigma finite and negative",
                              l.edge, l.d.outerNodes, l.d.outerUnassigned, l.d.midNodes);
                check(l.d.outerNodes > 0 && l.d.outerUnassigned == 0 && l.d.midNodes > 0 && l.converged &&
                          std::isfinite(l.sigma) && l.sigma < 0, b);
                if (!doS) {   // Part S already asserts both on the same mesh
                    check(l.valid.ok(), "LE10 edge " + std::to_string(l.edge).substr(0, 5) +
                                            ": valid tetrahedralization (" + validityText(l.valid) + ")");
                    checkNotFlat("LE10 edge " + std::to_string(l.edge).substr(0, 5), l.valid);
                }
            }
        }
    }

    // ---- t = 0.1: LE1 -----------------------------------------------------------------
    if (doL1) {
        const double t = 0.1;
        std::vector<double> edges = parseEdges(std::getenv("FORGE_FEA_GATE_LE1_EDGES"), {0.17, 0.12, 0.09});
        std::vector<LeLevel> L1;
        for (double e : edges) {
            forge::ShapeHandle q;
            try { q = buildEllipticSlab(t); }
            catch (const std::exception& ex) { std::printf("SETUP ERROR: slab build failed: %s\n", ex.what()); return 2; }
            const double t0 = nowMs();
            tet::Mesh m = tet::meshShapeFromHandle(q, e);
            const double ms = nowMs() - t0;
            forge::ShapeRegistry::instance().release(q);
            const Classified c = classifyBoundary(m);
            LeLevel l = solveLe(false, m, c, t, P3{2.0, 0.0, 0.05}, 92.7);
            l.edge = e; l.meshMs = ms;
            L1.push_back(l);
            std::printf("[le-level] case=LE1 edge=%.4g nodes=%zu tets=%zu sigma=%.4f target=92.7 errPct=%.2f "
                        "probe=(%.3f,%.3f,%.3f) outerNodes=%zu outerFaces=%zu outerWorstDev2D=%.4g loadedArea=%.5f "
                        "resultantErr=%.3e converged=%d cgIters=%d meshMs=%.0f solveMs=%.0f minRadiusRatio=%.3g minRelVolume=%.3g\n",
                        e, l.nodes, l.tets, l.sigma / 1e6, l.errPct, l.probe.x, l.probe.y, l.probe.z, l.d.outerNodes,
                        l.d.outerFaces, l.d.outerWorstDev2D, l.d.loadedArea, l.d.resultantErr, l.converged ? 1 : 0,
                        l.cgIters, ms, l.solveMs, l.valid.minRadiusRatio, l.valid.minRelVolume);
            std::fflush(stdout);
        }
        std::printf("\n--- PART L: LE1 elliptic membrane, sigma_yy at D(2,0) [REPORTED, not asserted] ---\n");
        std::printf(" edge    nodes   tets   sigma[MPa]   err%%    resultantErr  CG\n");
        for (const auto& l : L1)
            std::printf(" %-6.4g %6zu %6zu  %9.4f  %+7.2f   %-10.3e  %s/%d\n", l.edge, l.nodes, l.tets, l.sigma / 1e6,
                        l.errPct, l.d.resultantErr, l.converged ? "conv" : "NOT", l.cgIters);
        bool mono = true;
        for (std::size_t i = 1; i < L1.size(); ++i) if (std::abs(L1[i].errPct) >= std::abs(L1[i - 1].errPct)) mono = false;
        std::printf(" monotone |err| sequence: %s\n", mono ? "YES" : "NO (Richardson/GCI does not apply)");
        for (const auto& l : L1) {
            char b[200];
            std::snprintf(b, sizeof b, "LE1 edge %.4g: outer set complete (resultant err %.2e <= 1e-3, unassigned %zu), CG converged, sigma finite and positive",
                          l.edge, l.d.resultantErr, l.d.outerUnassigned);
            check(l.d.outerNodes > 0 && l.d.outerUnassigned == 0 && l.d.resultantErr <= 1e-3 && l.converged &&
                      std::isfinite(l.sigma) && l.sigma > 0, b);
            check(l.valid.ok(), "LE1 edge " + std::to_string(l.edge).substr(0, 5) +
                                    ": valid tetrahedralization (" + validityText(l.valid) + ")");
            checkNotFlat("LE1 edge " + std::to_string(l.edge).substr(0, 5), l.valid);
            std::snprintf(b, sizeof b, "LE1 edge %.4g: every curved-boundary vertex on its ellipsoid (max |dev| %.3g <= %.0e m)",
                          l.edge, l.curvedMaxDev, kOnGeometry);
            check(l.curvedMaxDev <= kOnGeometry, b);
        }
    }

    // ---- primitives ---------------------------------------------------------------------
    if (doP) {
        std::printf("\n--- PART P: primitives (box exact; cylinder and sphere converge) ---------\n");
        {
            const double a = 1.0, b = 0.6, c = 0.4;
            for (double e : {0.2, 0.1}) {
                forge::ShapeHandle h = forge::makeBox(a, b, c);
                tet::Mesh m = tet::meshShapeFromHandle(h, e);
                forge::ShapeRegistry::instance().release(h);
                double V = 0, worst = 0;
                for (const auto& T : m.tets) {
                    const P3 p0 = nodeP(m, T.a), p1 = nodeP(m, T.b), p2 = nodeP(m, T.c), p3 = nodeP(m, T.d);
                    V += std::abs((p1.x - p0.x) * ((p2.y - p0.y) * (p3.z - p0.z) - (p2.z - p0.z) * (p3.y - p0.y)) -
                                  (p1.y - p0.y) * ((p2.x - p0.x) * (p3.z - p0.z) - (p2.z - p0.z) * (p3.x - p0.x)) +
                                  (p1.z - p0.z) * ((p2.x - p0.x) * (p3.y - p0.y) - (p2.y - p0.y) * (p3.x - p0.x))) / 6.0;
                }
                for (const auto& f : tetBoundaryFaces(m))
                    for (int j = 0; j < 3; ++j) {
                        const P3 q = nodeP(m, f.v[j]);
                        worst = std::max(worst, std::min({std::abs(q.x), std::abs(q.x - a), std::abs(q.y), std::abs(q.y - b),
                                                          std::abs(q.z), std::abs(q.z - c)}));
                    }
                const double vErr = std::abs(V - a * b * c) / (a * b * c);
                const Validity bv = meshValidity(m);
                std::printf("[prim-level] shape=box edge=%.3g nodes=%zu tets=%zu volRelErr=%.3e worstPlaneDist=%.3e shell=%d minRadiusRatio=%.3g minRelVolume=%.3g\n",
                            e, m.nodes.size(), m.tets.size(), vErr, worst, m.shellTetsOnly ? 1 : 0, bv.minRadiusRatio, bv.minRelVolume);
                char msg[200];
                std::snprintf(msg, sizeof msg, "box edge %.3g: exact (volume rel err %.2e <= 1e-9, boundary vertices on the faces %.2e <= 1e-9, solid)",
                              e, vErr, worst);
                check(!m.shellTetsOnly && vErr <= 1e-9 && worst <= 1e-9, msg);
                check(bv.ok(), "box edge " + std::to_string(e).substr(0, 5) + ": valid tetrahedralization (" +
                                   validityText(bv) + ")");
                checkNotFlat("box edge " + std::to_string(e).substr(0, 5), bv);
            }
        }
        struct Spec { const char* name; int kind; double R, H; std::vector<double> edges; };
        // Ratio-2 sweeps, for the reason Part S gives (bisection: a smaller step may leave a
        // region unrefined — MEASURED on this cylinder at 0.15 -> 0.10: facet sag 0.001739 m at
        // both).
        for (const Spec& sp : {Spec{"cylinder", 1, 0.5, 1.0, {0.3, 0.15, 0.075}}, Spec{"sphere", 2, 1.0, 0.0, {0.4, 0.2, 0.1}}}) {
            std::vector<PrimLevel> P;
            for (double e : sp.edges) {
                forge::ShapeHandle h = sp.kind == 1 ? forge::makeCylinder(sp.R, sp.H) : forge::makeSphere(sp.R);
                tet::Mesh m = tet::meshShapeFromHandle(h, e);
                forge::ShapeRegistry::instance().release(h);
                const double Vx = sp.kind == 1 ? kPi * sp.R * sp.R * sp.H : 4.0 / 3.0 * kPi * sp.R * sp.R * sp.R;
                PrimLevel L = measurePrim(m, e, sp.kind, sp.R, sp.H, Vx);
                P.push_back(L);
                std::printf("[prim-level] shape=%s edge=%.3g tets=%zu curvedVerts=%zu vertMax=%.3e facetSag=%.3e volRelErr=%+.3e shell=%d minRadiusRatio=%.3g minRelVolume=%.3g\n",
                            sp.name, e, L.tets, L.curved, L.vertMax, L.facetSag, L.volErr, L.shell ? 1 : 0, L.valid.minRadiusRatio, L.valid.minRelVolume);
            }
            std::vector<double> vm, fs;
            for (const auto& L : P) { vm.push_back(L.vertMax); fs.push_back(L.facetSag); }
            std::string n1 = std::string("P ") + sp.name + " curved-boundary vertex max |dev| (m)";
            std::string n2 = std::string("P ") + sp.name + " curved-boundary facet sag max (m)";
            convergesCheck(n1.c_str(), sp.edges, vm, 1.0);
            convergesCheck(n2.c_str(), sp.edges, fs, 1.0);
            for (const auto& L : P) {
                char msg[120];
                std::snprintf(msg, sizeof msg, "%s edge %.3g: solid mesh (shell=%d)", sp.name, L.edge, L.shell ? 1 : 0);
                check(!L.shell, msg);
                check(L.valid.ok(), std::string(sp.name) + " edge " + std::to_string(L.edge).substr(0, 5) +
                                        ": valid tetrahedralization (" + validityText(L.valid) + ")");
                checkNotFlat(std::string(sp.name) + " edge " + std::to_string(L.edge).substr(0, 5), L.valid);
            }
        }
    }

    // ---- LE11 ---------------------------------------------------------------------------
    if (doL11) {
        std::printf("\n--- PART 11: LE11 cyl/taper/sphere thermal, sigma_zz at A(1,0,0) [REPORTED] ---\n");
        for (double e : {0.34, 0.26}) {
            const Le11 r = solveLe11(e);
            if (!r.blocked.empty()) {
                std::printf("[le-level] case=LE11 edge=%.3g BLOCKED (%s)\n", e, r.blocked.c_str());
                continue;
            }
            std::printf("[le-level] case=LE11 edge=%.3g nodes=%zu tets=%zu sigma=%.4f target=-105 errPct=%.2f converged=%d shell=%d\n",
                        e, r.nodes, r.tets, r.sigma / 1e6, r.errPct, r.converged ? 1 : 0, r.shell ? 1 : 0);
            char msg[160];
            std::snprintf(msg, sizeof msg, "LE11 edge %.3g: solid mesh, CG converged, sigma finite and negative", e);
            check(!r.shell && r.converged && std::isfinite(r.sigma) && r.sigma < 0, msg);
            check(r.valid.ok(), "LE11 edge " + std::to_string(e).substr(0, 5) + ": valid tetrahedralization (" +
                                    validityText(r.valid) + ")");
            checkNotFlat("LE11 edge " + std::to_string(e).substr(0, 5), r.valid);
        }
    }

    // ---- element quality: the fea_smoke cantilever ---------------------------------------
    if (doQ) {
        std::printf("\n--- PART Q: element quality, the fea_smoke cantilever (static) ---------------\n");
        const Cantilever c = solveCantilever();
        std::printf("[quality-level] shape=cantilever edge=0.002 nodes=%zu tets=%zu meshMs=%.0f minRadiusRatio=%.3g minRelVolume=%.3g "
                    "fixed=%zu tip=%zu converged=%d cgIters=%d solveMs=%.0f maxDisp=%.3f um maxVM=%.2f MPa\n",
                    c.nodes, c.tets, c.meshMs, c.valid.minRadiusRatio, c.valid.minRelVolume, c.fixedN, c.tipN, c.converged ? 1 : 0,
                    c.cgIters, c.solveMs, c.maxDisp * 1e6, c.maxVM / 1e6);
        check(!c.shell && c.valid.ok(), "cantilever: solid, valid tetrahedralization (" + validityText(c.valid) + ")");
        checkNotFlat("cantilever", c.valid);
        // Regression bounds, from the measured pre-T-035 mesher on this exact mesh request
        // (fb98b794: min radius ratio 0.104, CG 1556 iterations, 184.15 um = -7.9 % and
        // 56.35 MPa = -6.1 % of the Euler-Bernoulli 200 um / 60 MPa) and the flat-tet
        // regression they must reject (1.48e-12, 27430 iterations, 80.67 MPa = +34.5 %).
        // Looser than either baseline on purpose: a smoke-level contract, not a ratchet.
        char b[256];
        std::snprintf(b, sizeof b, "cantilever: min radius ratio %.3g >= 0.05 (pre-T-035: 0.104)", c.valid.minRadiusRatio);
        check(c.valid.minRadiusRatio >= 0.05, b);
        std::snprintf(b, sizeof b, "cantilever: CG converged in %d <= 3112 iterations (2x pre-T-035's 1556)", c.cgIters);
        check(c.converged && c.cgIters <= 3112, b);
        const double dErr = (c.maxDisp - 200e-6) / 200e-6 * 100.0, sErr = (c.maxVM - 60e6) / 60e6 * 100.0;
        std::snprintf(b, sizeof b, "cantilever: tip deflection %.2f um within 15%% of 200 um (%+.1f%%)", c.maxDisp * 1e6, dErr);
        check(std::abs(dErr) <= 15.0, b);
        std::snprintf(b, sizeof b, "cantilever: peak von Mises %.2f MPa within 15%% of 60 MPa (%+.1f%%)", c.maxVM / 1e6, sErr);
        check(std::abs(sErr) <= 15.0, b);
        // The slender box of fea_boundary_refines_test.mjs: MEASURED on the round-1 mesher,
        // 264 tets of radius ratio < 1e-6 (min 1.2e-12); pre-T-035 and now, min 0.013.
        {
            forge::ShapeHandle h = forge::makeBox(0.2, 0.01, 0.01);
            const tet::Mesh m = tet::meshShapeFromHandle(h, 0.004);
            forge::ShapeRegistry::instance().release(h);
            const Validity v = meshValidity(m);
            std::printf("[quality-level] shape=slender-box edge=0.004 nodes=%zu tets=%zu minRadiusRatio=%.3g minRelVolume=%.3g\n",
                        m.nodes.size(), m.tets.size(), v.minRadiusRatio, v.minRelVolume);
            check(!m.shellTetsOnly && v.ok(), "slender box: solid, valid tetrahedralization (" + validityText(v) + ")");
            checkNotFlat("slender box", v);
        }
    }

    std::printf("\n[surface-conformance] verdict=%s failures=%d part=%s\n", gFail ? "FAIL" : "PASS", gFail, which.c_str());
    return gFail ? 1 : 0;
}
