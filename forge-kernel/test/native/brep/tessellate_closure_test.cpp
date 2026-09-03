// test/native/brep/tessellate_closure_test.cpp
//
// THE INVARIANT: tessellateSolid must emit a CLOSED triangle 2-chain.
//
// "Closed" here is a topological statement, not a tolerance: over the welded soup
// every DIRECTED edge (a,b) must occur exactly as often as its reverse (b,a). That
// is strictly stronger than the undirected "every edge is shared by two triangles"
// check the sweep gate already runs, and it is the property everything downstream
// actually depends on --
//
//   * the divergence-theorem volume sum(det[A,B,C])/6 is only origin-independent
//     (i.e. only a VOLUME) when the chain is closed;
//   * BRepGProp's integral of the OCCT solid NativeOcctBridge rebuilds from the soup
//     agrees with that sum only when it is closed;
//   * so NativeOcctBridge's own self-check refuses the body when it is not.
//
// WHY THIS GATE EXISTS. tessellateSolid used to re-wind each fan triangle on its own
// so its normal agreed with the face's surface normal. A fan of a NON-CONVEX loop
// legitimately contains triangles wound the other way -- they SUBTRACT the reflex
// pockets, and the fan diagonals cancel in pairs so the chain's boundary is exactly
// the loop. Re-winding one of them breaks both halves of that. It was invisible to
// every existing gate because the primitive bodies they cover are convex-fanned, and
// the one non-convex case in the suite (native_sweep_analytic_test's L-prism) had its
// half-edge and volume assertions turned OFF with a comment blaming an inherent
// "display-mesh limitation". It was not inherent. The cost was measured on a real
// corpus: mmcad_b tractable_pool STEP import 110/215 -> 134/215.
//
// A U-PROFILE is the smallest shape that exercises it. Fanning the cap from corner 0
// of {0,0},{6,0},{6,5},{4,5},{4,2},{2,2},{2,5},{0,5} yields triangles of BOTH windings
// (verified below by the fan-winding census, which is itself asserted -- a gate whose
// stimulus silently stopped stimulating is a gate that cannot fail).
//
// Pure C++20, no OCCT, no deps.

#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
#include <string>
#include <utility>
#include <vector>

using namespace forge::native::brep;

namespace {

int g_fail = 0;

void check(bool ok, const std::string& what) {
    if (!ok) { std::printf("  [FAIL] %s\n", what.c_str()); ++g_fail; }
}

struct SoupStats {
    std::size_t triangles = 0;
    int unbalancedDirected = 0;   // directed edges whose reverse count differs
    int boundaryUndirected = 0;   // undirected edges not shared by exactly 2 tris
    double closureX = 0, closureY = 0, closureZ = 0;   // sum(area * unit normal)
    double signedVolume = 0;      // divergence theorem about the origin
};

SoupStats analyse(const std::vector<double>& pos, const std::vector<std::uint32_t>& idx) {
    SoupStats s;
    s.triangles = idx.size() / 3;
    std::map<std::pair<std::uint32_t, std::uint32_t>, int> dir, undir;
    for (std::size_t t = 0; t + 2 < idx.size(); t += 3) {
        const std::uint32_t a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const std::uint32_t tri[3][2] = {{a, b}, {b, c}, {c, a}};
        for (auto& e : tri) {
            dir[{e[0], e[1]}]++;
            undir[e[0] < e[1] ? std::make_pair(e[0], e[1]) : std::make_pair(e[1], e[0])]++;
        }
        const double* A = &pos[3 * a];
        const double* B = &pos[3 * b];
        const double* C = &pos[3 * c];
        const double ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
        const double vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        const double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        s.closureX += 0.5 * nx; s.closureY += 0.5 * ny; s.closureZ += 0.5 * nz;
        s.signedVolume += (A[0] * (B[1] * C[2] - B[2] * C[1])
                         - A[1] * (B[0] * C[2] - B[2] * C[0])
                         + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6.0;
    }
    for (auto& kv : dir) {
        auto it = dir.find({kv.first.second, kv.first.first});
        if (it == dir.end() || it->second != kv.second) ++s.unbalancedDirected;
    }
    for (auto& kv : undir) if (kv.second != 2) ++s.boundaryUndirected;
    return s;
}

double closureMag(const SoupStats& s) {
    return std::sqrt(s.closureX * s.closureX + s.closureY * s.closureY + s.closureZ * s.closureZ);
}

// Every gate assertion below, run against one solid.
void gateSolid(const Solid& solid, const std::string& tag, double analyticVol, double area) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    tessellateSolid(solid, pos, idx);
    check(!idx.empty(), tag + ": tessellation produced triangles");
    if (idx.empty()) return;

    const SoupStats s = analyse(pos, idx);
    std::printf("      [%s] tris=%zu unbalancedDirected=%d boundaryUndirected=%d "
                "|sum(area*n)|=%.12g V=%.12g (analytic %.12g)\n",
                tag.c_str(), s.triangles, s.unbalancedDirected, s.boundaryUndirected,
                closureMag(s), s.signedVolume, analyticVol);

    check(s.boundaryUndirected == 0, tag + ": no boundary edge (every edge shared by 2 tris)");
    check(s.unbalancedDirected == 0, tag + ": every DIRECTED edge is balanced (closed 2-chain)");
    // sum(area * n) == 0 is the analytic face of the same statement. Scale the
    // tolerance by the body's own surface area so it is a shape property, not a
    // units accident.
    check(closureMag(s) <= 1e-9 * area, tag + ": sum(area * normal) == 0");
    // With a closed chain of PLANAR faces the divergence sum is the exact volume,
    // so this is an equality, not an approximation: an all-planar prism has no
    // chordal error at all.
    check(std::fabs(std::fabs(s.signedVolume) - analyticVol) <= 1e-9 * analyticVol,
          tag + ": divergence-theorem volume == analytic volume EXACTLY");

    forge::native::mesh::HalfEdgeMesh m;
    const bool built = m.buildFromSoup(pos, idx);
    check(built, tag + ": soup builds a half-edge mesh");
    if (built) {
        check(m.validate().isValid(), tag + ": half-edge mesh is a closed 2-manifold");
        check(std::fabs(std::fabs(m.signedVolume()) - analyticVol) <= 1e-9 * analyticVol,
              tag + ": half-edge volume == analytic volume EXACTLY");
    }
}

double shoelace(const std::vector<std::array<double, 2>>& p) {
    double a = 0;
    for (std::size_t i = 0; i < p.size(); ++i) {
        const auto& u = p[i];
        const auto& v = p[(i + 1) % p.size()];
        a += u[0] * v[1] - v[0] * u[1];
    }
    return 0.5 * a;
}

// THE GATE'S OWN CONTROL, part 1: prove the U cap really does fan into triangles of
// BOTH windings, so this file is still stimulating the defect it was written for.
int mixedWindingFanTriangles(const std::vector<std::array<double, 2>>& p) {
    const double ref = shoelace(p) > 0 ? 1.0 : -1.0;
    int against = 0;
    for (std::size_t t = 1; t + 1 < p.size(); ++t) {
        const double cross = (p[t][0] - p[0][0]) * (p[t + 1][1] - p[0][1])
                           - (p[t][1] - p[0][1]) * (p[t + 1][0] - p[0][0]);
        if (cross * ref < 0) ++against;
    }
    return against;
}

}  // namespace

int main() {
    std::printf("== tessellateSolid closure gate (the soup must be a CLOSED 2-chain) ==\n");

    // U profile: 8 corners, one reflex pair. Fanned from corner 0 it yields
    // triangles of both windings -- exactly the case the removed per-triangle
    // re-winding corrupted.
    const std::vector<std::array<double, 2>> U =
        {{0, 0}, {6, 0}, {6, 5}, {4, 5}, {4, 2}, {2, 2}, {2, 5}, {0, 5}};
    const int against = mixedWindingFanTriangles(U);
    std::printf("      [control] U-profile fan: %d of %zu triangles wound against the "
                "profile\n", against, U.size() - 2);
    check(against > 0, "control: the U profile still fans into MIXED windings "
                       "(if this fails the gate has stopped stimulating the defect)");

    // ---- U-prism: non-convex caps, all-planar, exact closed-form volume ----
    {
        SolidFactory fac;
        const double h = 3.0;
        const double area2d = std::fabs(shoelace(U));            // 6*5 - 2*3 = 24
        const double expV = area2d * h;
        Solid* s = fac.buildPrismFromProfile(U, 0, 0, h);
        check(s != nullptr, "U-prism: builds");
        if (s) {
            const MassProps mp = massProperties(*s);
            check(std::fabs(mp.volume - expV) <= 1e-9 * expV,
                  "U-prism: analytic volume == area*h");
            const double surf = 2 * area2d + h * (6 + 5 + 2 + 3 + 2 + 3 + 2 + 5);
            gateSolid(*s, "U-prism", expV, surf);
        }
    }

    // ---- L-prism: the case native_sweep_analytic_test had to waive ----
    {
        SolidFactory fac;
        const std::vector<std::array<double, 2>> L =
            {{0, 0}, {4, 0}, {4, 2}, {2, 2}, {2, 4}, {0, 4}};
        const double h = 3.0;
        const double area2d = std::fabs(shoelace(L));            // 12
        const double expV = area2d * h;
        Solid* s = fac.buildPrismFromProfile(L, 0, 0, h);
        check(s != nullptr, "L-prism: builds");
        if (s) gateSolid(*s, "L-prism", expV, 2 * area2d + h * (4 + 2 + 2 + 2 + 2 + 4));
    }

    // ---- a CONVEX control: the fix must not perturb the ordinary case ----
    {
        SolidFactory fac;
        const std::vector<std::array<double, 2>> R = {{0, 0}, {2, 0}, {2, 3}, {0, 3}};
        Solid* s = fac.buildPrismFromProfile(R, 0, 0, 5);
        check(s != nullptr, "box-prism: builds");
        if (s) gateSolid(*s, "box-prism", 30.0, 2 * 6.0 + 5 * (2 + 3 + 2 + 3));
    }

    // THE GATE'S OWN CONTROL, part 2: the closure checks must actually FAIL on a
    // soup that is not closed. Re-wind ONE triangle of the U-prism -- the exact
    // corruption the removed rule used to apply -- and require every closure
    // assertion above to notice. A check that has only ever been observed passing
    // is not evidence.
    {
        SolidFactory fac;
        Solid* s = fac.buildPrismFromProfile(U, 0, 0, 3.0);
        if (s) {
            std::vector<double> pos;
            std::vector<std::uint32_t> idx;
            tessellateSolid(*s, pos, idx);
            const SoupStats clean = analyse(pos, idx);
            std::swap(idx[1], idx[2]);                       // re-wind triangle 0
            const SoupStats dirty = analyse(pos, idx);
            std::printf("      [control] one re-wound triangle: unbalancedDirected "
                        "%d -> %d, |sum(area*n)| %.12g -> %.12g\n",
                        clean.unbalancedDirected, dirty.unbalancedDirected,
                        closureMag(clean), closureMag(dirty));
            check(clean.unbalancedDirected == 0 && dirty.unbalancedDirected > 0,
                  "control: the directed-edge check DETECTS a single re-wound triangle");
            check(closureMag(dirty) > 1e-6,
                  "control: the sum(area*normal) check DETECTS a single re-wound triangle");
        }
    }

    if (g_fail == 0) std::printf("[tessclosure] ALL TESSELLATION-CLOSURE GATES PASS\n");
    else             std::printf("[tessclosure] %d FAILURE(S)\n", g_fail);
    return g_fail == 0 ? 0 : 1;
}
