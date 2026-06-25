// forge/native/geom/convexdecomposition_test.cpp
//
// Standalone validation gate for forge::native::geom::convexDecompose — the
// in-house APPROXIMATE convex decomposition. Pure C++20, standard library only.
//
// Build & run (exact command the module spec mandates):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/ConvexDecomposition.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/geom/convexdecomposition_test.cpp \
//       -o /tmp/k4_ConvexDecomposition && /tmp/k4_ConvexDecomposition
//
// SPEC validations (per the module brief):
//   (1) An already-CONVEX mesh (axis box, icosphere) is recognised as convex
//       within tol and returns EXACTLY 1 piece.
//   (2) A genuinely NON-CONVEX solid (L-shape, two fused boxes) returns >= 2
//       pieces whose UNION VOLUME ~ the original within a few %, and EVERY piece
//       passes an independent convexity check.
//   (3) Per-piece convexity is reported (printed).
//   (4) HONEST degenerate gating: open / non-manifold / zero-volume input -> ok=false.
//
// A fresh std::random_device seed is printed; random rotations/jitter exercise
// the exact-predicate side classification on non-axis-aligned planes so a
// failure is reproducible from the printed seed.

#include "forge/native/geom/ConvexDecomposition.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
#include <random>
#include <utility>
#include <vector>

using namespace forge::native;
using namespace forge::native::geom;
using forge::native::mesh::HalfEdgeMesh;

static int g_pass = 0;
static int g_total = 0;
static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {           std::printf("  [FAIL] %s\n", name); }
}

// ---------------------------------------------------------------------------
// Mesh fixture builders — each returns a CLOSED 2-manifold triangle soup.
// ---------------------------------------------------------------------------

// Axis-aligned box [x0,x1]x[y0,y1]x[z0,z1], outward CCW triangles.
static void addBox(std::vector<double>& pos, std::vector<std::uint32_t>& idx,
                   double x0, double y0, double z0,
                   double x1, double y1, double z1) {
    std::uint32_t base = static_cast<std::uint32_t>(pos.size() / 3);
    const double v[8][3] = {
        {x0, y0, z0}, {x1, y0, z0}, {x1, y1, z0}, {x0, y1, z0},
        {x0, y0, z1}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1}
    };
    for (auto& p : v) { pos.push_back(p[0]); pos.push_back(p[1]); pos.push_back(p[2]); }
    // 12 triangles, outward winding (CCW seen from outside).
    const std::uint32_t f[12][3] = {
        {0,3,2},{0,2,1},   // z0 bottom (normal -z)
        {4,5,6},{4,6,7},   // z1 top    (normal +z)
        {0,1,5},{0,5,4},   // y0 front  (normal -y)
        {3,7,6},{3,6,2},   // y1 back   (normal +y)
        {0,4,7},{0,7,3},   // x0 left   (normal -x)
        {1,2,6},{1,6,5}    // x1 right  (normal +x)
    };
    for (auto& t : f) { idx.push_back(base + t[0]); idx.push_back(base + t[1]); idx.push_back(base + t[2]); }
}

static void makeBox(std::vector<double>& pos, std::vector<std::uint32_t>& idx,
                    double s = 1.0) {
    pos.clear(); idx.clear();
    addBox(pos, idx, -s, -s, -s, s, s, s);
}

// Icosphere: icosahedron subdivided `sub` times, projected to the unit sphere.
// A convex closed manifold — the canonical "convex" fixture #2.
static void makeIcosphere(std::vector<double>& pos, std::vector<std::uint32_t>& idx,
                          int sub) {
    const double t = (1.0 + std::sqrt(5.0)) / 2.0;
    std::vector<std::array<double,3>> V = {
        {-1, t, 0},{ 1, t, 0},{-1,-t, 0},{ 1,-t, 0},
        { 0,-1, t},{ 0, 1, t},{ 0,-1,-t},{ 0, 1,-t},
        { t, 0,-1},{ t, 0, 1},{-t, 0,-1},{-t, 0, 1}
    };
    std::vector<std::array<int,3>> F = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1}
    };
    auto normalize = [](std::array<double,3>& p) {
        double L = std::sqrt(p[0]*p[0]+p[1]*p[1]+p[2]*p[2]);
        p[0]/=L; p[1]/=L; p[2]/=L;
    };
    for (auto& p : V) normalize(p);
    for (int s = 0; s < sub; ++s) {
        std::vector<std::array<int,3>> F2;
        std::map<std::pair<int,int>,int> mid;
        auto midpoint = [&](int a, int b) -> int {
            auto key = std::make_pair(std::min(a,b), std::max(a,b));
            auto it = mid.find(key);
            if (it != mid.end()) return it->second;
            std::array<double,3> m = {(V[a][0]+V[b][0])/2,(V[a][1]+V[b][1])/2,(V[a][2]+V[b][2])/2};
            normalize(m);
            int id = static_cast<int>(V.size());
            V.push_back(m);
            mid[key] = id;
            return id;
        };
        for (auto& f : F) {
            int a = midpoint(f[0],f[1]);
            int b = midpoint(f[1],f[2]);
            int c = midpoint(f[2],f[0]);
            F2.push_back({f[0],a,c});
            F2.push_back({f[1],b,a});
            F2.push_back({f[2],c,b});
            F2.push_back({a,b,c});
        }
        F.swap(F2);
    }
    pos.clear(); idx.clear();
    for (auto& p : V) { pos.push_back(p[0]); pos.push_back(p[1]); pos.push_back(p[2]); }
    for (auto& f : F) { idx.push_back(static_cast<std::uint32_t>(f[0]));
                        idx.push_back(static_cast<std::uint32_t>(f[1]));
                        idx.push_back(static_cast<std::uint32_t>(f[2])); }
}

// Two AXIS boxes fused along a shared face -> a single closed L/bar solid that
// is genuinely NON-convex (a re-entrant corner). We build the surface of the
// union directly (no shared interior wall) so it is a clean closed manifold.
//
// L-shape in the z-slab [0,1]: footprint is the union of
//   A = [0,2]x[0,1]  and  B = [0,1]x[1,2]  (an L). Extruded in z to [0,1].
// 6 distinct outline corners; we emit the prism walls + top/bottom caps.
// Parameterised L-prism: xy footprint scaled by (sx,sy), extruded z in [0,H].
// All windings are outward; the solid is a clean closed 2-manifold and genuinely
// non-convex (one re-entrant corner). Defaults reproduce the unit L (vol 3).
static void makeLShape(std::vector<double>& pos, std::vector<std::uint32_t>& idx,
                       double sx = 1.0, double sy = 1.0, double H = 1.0) {
    pos.clear(); idx.clear();
    // L outline (CCW in xy): (0,0)(2,0)(2,1)(1,1)(1,2)(0,2), then scaled.
    const double ox[6] = {0*sx,2*sx,2*sx,1*sx,1*sx,0*sx};
    const double oy[6] = {0*sy,0*sy,1*sy,1*sy,2*sy,2*sy};
    const double z0 = 0.0, z1 = H;
    // vertices: bottom ring (z0) 0..5, top ring (z1) 6..11
    for (int i = 0; i < 6; ++i) { pos.push_back(ox[i]); pos.push_back(oy[i]); pos.push_back(z0); }
    for (int i = 0; i < 6; ++i) { pos.push_back(ox[i]); pos.push_back(oy[i]); pos.push_back(z1); }
    // Side walls: for each outline edge (i,i+1), quad (bi,bj,tj,ti) outward.
    for (int i = 0; i < 6; ++i) {
        std::uint32_t bi = static_cast<std::uint32_t>(i);
        std::uint32_t bj = static_cast<std::uint32_t>((i+1)%6);
        std::uint32_t ti = bi + 6, tj = bj + 6;
        // outward normal points away from interior; outline is CCW so this winding
        // (bi,bj,tj),(bi,tj,ti) gives outward-facing walls.
        idx.push_back(bi); idx.push_back(bj); idx.push_back(tj);
        idx.push_back(bi); idx.push_back(tj); idx.push_back(ti);
    }
    // Bottom cap (z0, normal -z): triangulate the L footprint. Split L into two
    // quads: Q1=(0,1,2)&(0,2,3)->corners 0,1,2,3 ; Q2=(0,3,4,5).
    // Bottom faces wind CW seen from above => CCW from below (normal -z).
    auto botTri = [&](int a,int b,int c){ idx.push_back((std::uint32_t)a); idx.push_back((std::uint32_t)c); idx.push_back((std::uint32_t)b); };
    botTri(0,1,2); botTri(0,2,3); botTri(0,3,4); botTri(0,4,5);
    // Top cap (z1, normal +z): same fan but CCW from above.
    auto topTri = [&](int a,int b,int c){ idx.push_back((std::uint32_t)(a+6)); idx.push_back((std::uint32_t)(b+6)); idx.push_back((std::uint32_t)(c+6)); };
    topTri(0,1,2); topTri(0,2,3); topTri(0,3,4); topTri(0,4,5);
}

// The genuinely-non-convex "two boxes joined / stepped bar" fixture is the SAME
// clean L-prism construction with different proportions (taller, wider), built
// via makeLShape(sx,sy,H). That keeps it a clean closed 2-manifold (a hand-built
// "two fused boxes" surface is fiddly to keep watertight) while exercising the
// decomposition on a DIFFERENT, distinctly-shaped non-convex solid.

// ---------------------------------------------------------------------------
// Random rigid transform (rotation + translation) to move fixtures off-axis so
// the exact-predicate cut planes are non-axis-aligned.
// ---------------------------------------------------------------------------
static void applyTransform(std::vector<double>& pos, const double R[9], const double t[3]) {
    for (std::size_t i = 0; i < pos.size(); i += 3) {
        double x = pos[i], y = pos[i+1], z = pos[i+2];
        pos[i]   = R[0]*x + R[1]*y + R[2]*z + t[0];
        pos[i+1] = R[3]*x + R[4]*y + R[5]*z + t[1];
        pos[i+2] = R[6]*x + R[7]*y + R[8]*z + t[2];
    }
}
static void makeRotation(double ax, double ay, double az, double R[9]) {
    double cx=std::cos(ax),sx=std::sin(ax),cy=std::cos(ay),sy=std::sin(ay),cz=std::cos(az),sz=std::sin(az);
    // Rz * Ry * Rx
    R[0]=cy*cz; R[1]=cz*sx*sy - cx*sz; R[2]=cx*cz*sy + sx*sz;
    R[3]=cy*sz; R[4]=cx*cz + sx*sy*sz; R[5]=-cz*sx + cx*sy*sz;
    R[6]=-sy;   R[7]=cy*sx;            R[8]=cx*cy;
}

// ===========================================================================
int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    unsigned seed = rd();
    std::printf("== forge::native::geom::convexDecompose validation gate ==\n");
    std::printf("   seed = %u  (random_device; reproduce a failure from this)\n", seed);
    std::printf("   NOTE: approximate / heuristic decomposition (honest) — see header.\n");
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> ang(-3.14159, 3.14159);
    std::uniform_real_distribution<double> tr(-5.0, 5.0);

    DecompositionParams params;   // defaults: concavityTol 0.02

    // -----------------------------------------------------------------------
    // (1a) CONVEX box -> exactly 1 piece, recognised convex.
    // -----------------------------------------------------------------------
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        makeBox(pos, idx, 1.0);
        double R[9]; makeRotation(ang(rng), ang(rng), ang(rng), R);
        double t[3] = {tr(rng), tr(rng), tr(rng)};
        applyTransform(pos, R, t);

        DecompositionResult r = convexDecompose(pos, idx, params);
        check(r.ok, "box: decompose ok");
        check(r.pieces.size() == 1, "box: returns EXACTLY 1 piece");
        check(r.inputWasConvex, "box: recognised convex within tol");
        if (!r.pieces.empty())
            std::printf("       box piece concavity = %.6g (tol %.3g), convex=%d\n",
                        r.pieces[0].concavity, params.concavityTol, (int)r.pieces[0].convex);
        bool allConvex = !r.pieces.empty();
        for (auto& p : r.pieces) allConvex = allConvex && p.convex;
        check(allConvex, "box: the single piece passes convexity check");
    }

    // -----------------------------------------------------------------------
    // (1b) CONVEX icosphere -> exactly 1 piece, recognised convex.
    // -----------------------------------------------------------------------
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        makeIcosphere(pos, idx, 2);   // 320 faces
        double R[9]; makeRotation(ang(rng), ang(rng), ang(rng), R);
        double t[3] = {tr(rng), tr(rng), tr(rng)};
        applyTransform(pos, R, t);

        // Sanity: it really is a closed manifold.
        HalfEdgeMesh m; bool built = m.buildFromSoup(pos, idx);
        check(built && m.validate().isValid(), "icosphere: is a closed 2-manifold");

        DecompositionResult r = convexDecompose(pos, idx, params);
        check(r.ok, "icosphere: decompose ok");
        check(r.pieces.size() == 1, "icosphere: returns EXACTLY 1 piece");
        check(r.inputWasConvex, "icosphere: recognised convex within tol");
        if (!r.pieces.empty())
            std::printf("       icosphere piece concavity = %.6g (tol %.3g)\n",
                        r.pieces[0].concavity, params.concavityTol);
    }

    // -----------------------------------------------------------------------
    // (2) NON-CONVEX L-shape -> >= 2 pieces; union volume ~ original within a
    //     few %; every piece passes the convexity check.
    // -----------------------------------------------------------------------
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        makeLShape(pos, idx);
        double R[9]; makeRotation(ang(rng), ang(rng), ang(rng), R);
        double t[3] = {tr(rng), tr(rng), tr(rng)};
        applyTransform(pos, R, t);

        HalfEdgeMesh m; bool built = m.buildFromSoup(pos, idx);
        check(built && m.validate().isValid(), "L-shape: is a closed 2-manifold");

        // It must genuinely be non-convex (independent report).
        ConvexityReport cr = meshConcavity(m);
        check(cr.ok && cr.concavity > params.concavityTol,
              "L-shape: independently measured NON-convex");
        std::printf("       L-shape input concavity = %.6g\n", cr.concavity);

        DecompositionResult r = convexDecompose(m, params);
        check(r.ok, "L-shape: decompose ok");
        check(r.pieces.size() >= 2, "L-shape: returns >= 2 pieces");
        check(!r.inputWasConvex, "L-shape: NOT flagged convex");

        std::printf("       L-shape -> %zu pieces; per-piece concavity:\n", r.pieces.size());
        bool allConvex = !r.pieces.empty();
        for (std::size_t i = 0; i < r.pieces.size(); ++i) {
            const ConvexPiece& p = r.pieces[i];
            std::printf("         piece %zu: vol=%.6g concavity=%.6g convex=%d\n",
                        i, p.volume, p.concavity, (int)p.convex);
            allConvex = allConvex && p.convex;
        }
        check(allConvex, "L-shape: EVERY piece passes the convexity check");

        // Union volume ~ original within a few %.
        double ratio = (r.inputVolume > 0.0) ? r.totalVolume / r.inputVolume : 0.0;
        std::printf("       L-shape volume: input=%.6g  sum-of-pieces=%.6g  ratio=%.5f\n",
                    r.inputVolume, r.totalVolume, ratio);
        check(std::fabs(ratio - 1.0) <= 0.03, "L-shape: union volume within 3% of original");
    }

    // -----------------------------------------------------------------------
    // (2b) NON-CONVEX "two boxes joined" stepped bar -> same guarantees.
    //      A DISTINCTLY-proportioned L-prism (wider + taller) so this is a
    //      different non-convex solid than (2), not a relabelling of it.
    // -----------------------------------------------------------------------
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        makeLShape(pos, idx, /*sx=*/1.5, /*sy=*/1.0, /*H=*/2.5);  // vol = 3*1.5*2.5 = 11.25
        double R[9]; makeRotation(ang(rng), ang(rng), ang(rng), R);
        double t[3] = {tr(rng), tr(rng), tr(rng)};
        applyTransform(pos, R, t);

        HalfEdgeMesh m; bool built = m.buildFromSoup(pos, idx);
        check(built && m.validate().isValid(), "stepped-bar: is a closed 2-manifold");

        ConvexityReport cr = meshConcavity(m);
        check(cr.ok && cr.concavity > params.concavityTol,
              "stepped-bar: independently measured NON-convex");

        DecompositionResult r = convexDecompose(m, params);
        check(r.ok && r.pieces.size() >= 2, "stepped-bar: ok and >= 2 pieces");
        bool allConvex = !r.pieces.empty();
        for (auto& p : r.pieces) allConvex = allConvex && p.convex;
        check(allConvex, "stepped-bar: every piece convex");
        double ratio = (r.inputVolume > 0.0) ? r.totalVolume / r.inputVolume : 0.0;
        std::printf("       stepped-bar pieces=%zu volume ratio=%.5f\n", r.pieces.size(), ratio);
        check(std::fabs(ratio - 1.0) <= 0.03, "stepped-bar: union volume within 3%");
    }

    // -----------------------------------------------------------------------
    // (4) HONEST degenerate gating.
    // -----------------------------------------------------------------------
    {
        // Open mesh: a box missing one face (drop the last 2 triangles).
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        makeBox(pos, idx, 1.0);
        idx.resize(idx.size() - 6);   // remove the +x face (2 tris)
        DecompositionResult r = convexDecompose(pos, idx, params);
        check(!r.ok, "open mesh (missing face): ok==false (honest)");
        std::printf("       open-mesh reason: \"%s\"\n", r.reason);
    }
    {
        // Malformed soup: positions size not a multiple of 3.
        std::vector<double> pos = {0,0,0, 1,0};   // 5 doubles
        std::vector<std::uint32_t> idx = {0,0,0};
        DecompositionResult r = convexDecompose(pos, idx, params);
        check(!r.ok, "malformed soup (bad size): ok==false (honest)");
    }
    {
        // Empty input.
        std::vector<double> pos;
        std::vector<std::uint32_t> idx;
        DecompositionResult r = convexDecompose(pos, idx, params);
        check(!r.ok, "empty input: ok==false (honest)");
    }
    {
        // Non-manifold / bad winding: two triangles sharing a directed edge.
        std::vector<double> pos = {0,0,0, 1,0,0, 0,1,0, 1,1,0};
        std::vector<std::uint32_t> idx = {0,1,2, 0,1,3};  // both have directed 0->1
        DecompositionResult r = convexDecompose(pos, idx, params);
        check(!r.ok, "non-manifold soup: ok==false (honest)");
    }

    std::printf("RESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
