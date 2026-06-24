// forge/native/brep/cadscore_gates_test.cpp
//
// Standalone validation gate for the CADGenBench PRE-SUBMIT GATES increment
// (CadScoreGates.hpp / CadScoreGates.cpp) — the in-kernel Betti-number /
// watertight-manifold / interface keep-in-keep-out IoU self-checks that double as
// CADGenBench RL-reward terms (research §3.2/§5.3, gaps G2 + G3). Pure C++20, NO
// external dependencies, NO OCCT, NO WASM, no test framework — a tiny hand-rolled
// harness that prints PASS/FAIL and exits non-zero on any failure (mirrors
// sew_test.cpp / k0_topology_test.cpp).
//
// Build + run (single clang invocation — links only the brep+mesh objects the
// gates need; does NOT run run_native.sh or any cmake-js build):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/CadScoreGates.cpp \
//     forge-kernel/src/native/brep/SolidTessellate.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/test/native/brep/cadscore_gates_test.cpp \
//     -o /tmp/cadscore_gates_test && /tmp/cadscore_gates_test
//
// CLOSED-FORM BETTI GATES (the EXACT count triple CADGenBench multiplies):
//   sphere/cube              -> (1, 0, 1)
//   torus                    -> (1, 2, 1)
//   two disjoint boxes       -> (2, 0, 2)
//   cube with a through-hole -> (1, 2, 1)
//   cube with a sealed void  -> (1, 0, 2)
//
// Each test shape is built as an explicit WATERTIGHT triangle soup (no dependency
// on heavy boolean / primitive ops) and fed to computeBettiFromSoup; the validity
// and interface gates are exercised on the cube soup.

#include "forge/native/brep/CadScoreGates.hpp"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else        std::printf("  [FAIL] %s\n", name.c_str());
}

// ---------------------------------------------------------------------------
// Soup builders. Each emits a CLOSED, consistently-wound triangle soup. Winding
// does not affect Betti (the partition + Euler + even-odd nesting are winding-
// agnostic), but we keep it CCW-outward so the validity gate also passes.
// ---------------------------------------------------------------------------

// Append an axis-aligned box [min,max] as 12 CCW-outward triangles into pos/idx,
// re-using a fresh block of 8 vertices. `flip` reverses every triangle (for an
// inverted INNER void shell whose material side faces inward).
static void appendBox(std::vector<double>& pos, std::vector<std::uint32_t>& idx,
                      double x0, double y0, double z0,
                      double x1, double y1, double z1, bool flip = false) {
    const std::uint32_t base = static_cast<std::uint32_t>(pos.size() / 3);
    const double V[8][3] = {
        {x0, y0, z0}, {x1, y0, z0}, {x1, y1, z0}, {x0, y1, z0},  // 0..3 z=z0
        {x0, y0, z1}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1},  // 4..7 z=z1
    };
    for (auto& p : V) { pos.push_back(p[0]); pos.push_back(p[1]); pos.push_back(p[2]); }
    // Six quads as CCW-outward triangle pairs.
    const std::uint32_t quads[6][4] = {
        {0, 3, 2, 1}, // bottom (-Z)
        {4, 5, 6, 7}, // top    (+Z)
        {0, 1, 5, 4}, // front  (-Y)
        {2, 3, 7, 6}, // back   (+Y)
        {0, 4, 7, 3}, // left   (-X)
        {1, 2, 6, 5}, // right  (+X)
    };
    for (auto& q : quads) {
        const std::uint32_t a = base + q[0], b = base + q[1], c = base + q[2], d = base + q[3];
        if (!flip) {
            idx.push_back(a); idx.push_back(b); idx.push_back(c);
            idx.push_back(a); idx.push_back(c); idx.push_back(d);
        } else {
            idx.push_back(a); idx.push_back(c); idx.push_back(b);
            idx.push_back(a); idx.push_back(d); idx.push_back(c);
        }
    }
}

// A UV sphere (genus-0 closed surface) built as a GENUINE 2-manifold: a single
// shared NORTH apex + single shared SOUTH apex (triangle fans at the caps) and
// quad bands between the (nV-1) interior latitude rings, with longitude wrapping
// to the same ring vertices. This avoids the degenerate pole-collapse that would
// corrupt the index-based Euler count. nU longitudes, nV latitude bands.
static void buildSphere(std::vector<double>& pos, std::vector<std::uint32_t>& idx,
                        double r, int nU, int nV) {
    pos.clear(); idx.clear();
    const double PI = 3.14159265358979323846;
    // North apex = vertex 0 (phi=0, +z). South apex = vertex 1 (phi=pi, -z).
    pos.push_back(0); pos.push_back(0); pos.push_back(r);    // 0 north
    pos.push_back(0); pos.push_back(0); pos.push_back(-r);   // 1 south
    // Interior rings i = 1..nV-1, each with nU vertices. Index of ring i, lon j:
    auto ringV = [&](int i, int j) -> std::uint32_t {
        return static_cast<std::uint32_t>(2 + (i - 1) * nU + (j % nU));
    };
    for (int i = 1; i < nV; ++i) {
        const double phi = PI * (double)i / (double)nV;
        for (int j = 0; j < nU; ++j) {
            const double th = 2.0 * PI * (double)j / (double)nU;
            const double x = r * std::sin(phi) * std::cos(th);
            const double y = r * std::sin(phi) * std::sin(th);
            const double z = r * std::cos(phi);
            pos.push_back(x); pos.push_back(y); pos.push_back(z);
        }
    }
    // North cap fan (apex 0 to ring 1).
    for (int j = 0; j < nU; ++j) {
        idx.push_back(0); idx.push_back(ringV(1, j)); idx.push_back(ringV(1, j + 1));
    }
    // Middle quad bands (ring i to ring i+1).
    for (int i = 1; i < nV - 1; ++i) {
        for (int j = 0; j < nU; ++j) {
            std::uint32_t a = ringV(i, j), b = ringV(i + 1, j);
            std::uint32_t c = ringV(i + 1, j + 1), d = ringV(i, j + 1);
            idx.push_back(a); idx.push_back(b); idx.push_back(c);
            idx.push_back(a); idx.push_back(c); idx.push_back(d);
        }
    }
    // South cap fan (last ring nV-1 to apex 1).
    for (int j = 0; j < nU; ++j) {
        idx.push_back(1); idx.push_back(ringV(nV - 1, j + 1)); idx.push_back(ringV(nV - 1, j));
    }
}

// A UV torus (genus-1 closed surface). nU around the tube, nV around the ring.
static void buildTorus(std::vector<double>& pos, std::vector<std::uint32_t>& idx,
                       double R, double r, int nU, int nV) {
    pos.clear(); idx.clear();
    const double PI = 3.14159265358979323846;
    auto vid = [&](int i, int j) -> std::uint32_t {
        return static_cast<std::uint32_t>((i % nV) * nU + (j % nU));
    };
    for (int i = 0; i < nV; ++i) {
        const double u = 2.0 * PI * (double)i / (double)nV;  // around the ring
        for (int j = 0; j < nU; ++j) {
            const double v = 2.0 * PI * (double)j / (double)nU;  // around the tube
            const double x = (R + r * std::cos(v)) * std::cos(u);
            const double y = (R + r * std::cos(v)) * std::sin(u);
            const double z = r * std::sin(v);
            pos.push_back(x); pos.push_back(y); pos.push_back(z);
        }
    }
    for (int i = 0; i < nV; ++i) {
        for (int j = 0; j < nU; ++j) {
            std::uint32_t a = vid(i, j), b = vid(i + 1, j);
            std::uint32_t c = vid(i + 1, j + 1), d = vid(i, j + 1);
            idx.push_back(a); idx.push_back(b); idx.push_back(c);
            idx.push_back(a); idx.push_back(c); idx.push_back(d);
        }
    }
}

// A square SLAB with a square THROUGH-HOLE in Z (a "picture frame" extruded along
// Z) — a genus-1 closed surface. Outer square [−o,o]^2, inner hole [−h,h]^2, the
// slab spans z in [z0,z1]. Built as 4 outer walls + 4 inner walls + top/bottom
// annulus rings (each ring = 4 quads), all sharing the 16 corner verts.
static void buildThroughHoleSlab(std::vector<double>& pos, std::vector<std::uint32_t>& idx,
                                 double o, double h, double z0, double z1) {
    pos.clear(); idx.clear();
    // 8 outer corners (z0: 0..3, z1: 4..7), 8 inner corners (z0: 8..11, z1: 12..15).
    auto P = [&](double x, double y, double z) {
        pos.push_back(x); pos.push_back(y); pos.push_back(z);
    };
    // outer z0
    P(-o, -o, z0); P(o, -o, z0); P(o, o, z0); P(-o, o, z0);   // 0..3
    // outer z1
    P(-o, -o, z1); P(o, -o, z1); P(o, o, z1); P(-o, o, z1);   // 4..7
    // inner z0
    P(-h, -h, z0); P(h, -h, z0); P(h, h, z0); P(-h, h, z0);   // 8..11
    // inner z1
    P(-h, -h, z1); P(h, -h, z1); P(h, h, z1); P(-h, h, z1);   // 12..15

    auto quad = [&](std::uint32_t a, std::uint32_t b, std::uint32_t c, std::uint32_t d) {
        idx.push_back(a); idx.push_back(b); idx.push_back(c);
        idx.push_back(a); idx.push_back(c); idx.push_back(d);
    };

    // OUTER side walls (z0 ring 0..3 -> z1 ring 4..7).
    quad(0, 1, 5, 4); quad(1, 2, 6, 5); quad(2, 3, 7, 6); quad(3, 0, 4, 7);
    // INNER side walls (around the hole) — reversed so the hole surface is closed.
    quad(9, 8, 12, 13); quad(10, 9, 13, 14); quad(11, 10, 14, 15); quad(8, 11, 15, 12);
    // BOTTOM annulus (z0): between outer ring 0..3 and inner ring 8..11 (4 quads).
    quad(0, 8, 9, 1); quad(1, 9, 10, 2); quad(2, 10, 11, 3); quad(3, 11, 8, 0);
    // TOP annulus (z1): between outer ring 4..7 and inner ring 12..15.
    quad(4, 5, 13, 12); quad(5, 6, 14, 13); quad(6, 7, 15, 14); quad(7, 4, 12, 15);
}

// ---------------------------------------------------------------------------
int main() {
    std::printf("== CADGenBench pre-submit gate tests (CadScoreGates) ==\n");

    // (A) CUBE -> (1, 0, 1).
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        appendBox(pos, idx, 0, 0, 0, 1, 1, 1);
        BettiNumbers b = computeBettiFromSoup(pos, idx);
        std::printf("  cube           -> b0=%lld b1=%lld b2=%lld (ok=%d)\n",
                    b.b0, b.b1, b.b2, (int)b.ok);
        check(b.ok && b.b0 == 1 && b.b1 == 0 && b.b2 == 1, "cube Betti == (1,0,1)");
    }

    // (B) SPHERE -> (1, 0, 1).
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        buildSphere(pos, idx, 1.0, 24, 16);
        BettiNumbers b = computeBettiFromSoup(pos, idx);
        std::printf("  sphere         -> b0=%lld b1=%lld b2=%lld (ok=%d)\n",
                    b.b0, b.b1, b.b2, (int)b.ok);
        check(b.ok && b.b0 == 1 && b.b1 == 0 && b.b2 == 1, "sphere Betti == (1,0,1)");
    }

    // (C) TORUS -> (1, 2, 1).
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        buildTorus(pos, idx, 3.0, 1.0, 24, 16);
        BettiNumbers b = computeBettiFromSoup(pos, idx);
        std::printf("  torus          -> b0=%lld b1=%lld b2=%lld (ok=%d, genus[0]=%lld)\n",
                    b.b0, b.b1, b.b2, (int)b.ok,
                    b.shells.empty() ? -1 : b.shells[0].genus);
        check(b.ok && b.b0 == 1 && b.b1 == 2 && b.b2 == 1, "torus Betti == (1,2,1)");
    }

    // (D) TWO DISJOINT BOXES -> (2, 0, 2).
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        appendBox(pos, idx, 0, 0, 0, 1, 1, 1);
        appendBox(pos, idx, 5, 0, 0, 6, 1, 1);   // far apart -> disjoint
        BettiNumbers b = computeBettiFromSoup(pos, idx);
        std::printf("  two boxes      -> b0=%lld b1=%lld b2=%lld (ok=%d, shells=%zu)\n",
                    b.b0, b.b1, b.b2, (int)b.ok, b.shells.size());
        check(b.ok && b.b0 == 2 && b.b1 == 0 && b.b2 == 2, "two boxes Betti == (2,0,2)");
    }

    // (E) CUBE WITH A THROUGH-HOLE -> (1, 2, 1).
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        buildThroughHoleSlab(pos, idx, 2.0, 0.6, 0.0, 1.0);
        BettiNumbers b = computeBettiFromSoup(pos, idx);
        std::printf("  through-hole   -> b0=%lld b1=%lld b2=%lld (ok=%d, genus[0]=%lld)\n",
                    b.b0, b.b1, b.b2, (int)b.ok,
                    b.shells.empty() ? -1 : b.shells[0].genus);
        check(b.ok && b.b0 == 1 && b.b1 == 2 && b.b2 == 1, "through-hole Betti == (1,2,1)");
    }

    // (F) CUBE WITH A SEALED INTERNAL VOID -> (1, 0, 2).
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        appendBox(pos, idx, 0, 0, 0, 4, 4, 4);                 // outer shell
        appendBox(pos, idx, 1, 1, 1, 3, 3, 3, /*flip=*/true);  // inner void shell
        BettiNumbers b = computeBettiFromSoup(pos, idx);
        int voids = 0; for (auto& s : b.shells) if (s.isVoid) ++voids;
        std::printf("  internal-void  -> b0=%lld b1=%lld b2=%lld (ok=%d, shells=%zu, voids=%d)\n",
                    b.b0, b.b1, b.b2, (int)b.ok, b.shells.size(), voids);
        check(b.ok && b.b0 == 1 && b.b1 == 0 && b.b2 == 2, "internal-void Betti == (1,0,2)");
    }

    // (G) VALIDITY self-check on the cube soup (watertight + manifold + outward).
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        appendBox(pos, idx, 0, 0, 0, 1, 1, 1);
        forge::native::mesh::HalfEdgeMesh m;
        bool built = m.buildFromSoup(pos, idx);
        ValiditySelfCheck v = checkValidity(m);
        std::printf("  validity(cube) -> built=%d watertight=%d manifold=%d posVol=%d valid=%d\n",
                    (int)built, (int)v.watertight, (int)v.manifold,
                    (int)v.positiveVolume, (int)v.valid());
        check(built && v.valid(), "cube is a watertight manifold solid");
    }

    // (H) INTERFACE keep-in / keep-out IoU on a unit cube [0,1]^3.
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        appendBox(pos, idx, 0, 0, 0, 1, 1, 1);

        // keep-in fully inside the cube -> material fills it -> IoU ~ 1.0.
        AABBox keepIn;  keepIn.min[0]=0.2; keepIn.min[1]=0.2; keepIn.min[2]=0.2;
                        keepIn.max[0]=0.8; keepIn.max[1]=0.8; keepIn.max[2]=0.8;
        // keep-out fully OUTSIDE the cube -> no material -> overlap ~ 0.
        AABBox keepOut; keepOut.min[0]=2.0; keepOut.min[1]=2.0; keepOut.min[2]=2.0;
                        keepOut.max[0]=3.0; keepOut.max[1]=3.0; keepOut.max[2]=3.0;

        InterfaceIoU r = interfaceIoUFromSoup(pos, idx, keepIn, keepOut, 8);
        std::printf("  interface OK   -> keepInIoU=%.3f keepOutOverlap=%.3f ramped=%.3f (ok=%d)\n",
                    r.keepInIoU, r.keepOutOverlap, r.rampedScore, (int)r.ok);
        check(r.ok && r.keepInIoU > 0.99 && r.keepOutOverlap < 0.01 && r.rampedScore > 0.99,
              "interface satisfied -> keep-in filled, keep-out clean, ramp 1.0");

        // A violating keep-out that overlaps the cube interior -> overlap high,
        // ramp collapses to 0 (worst feature carries the score).
        AABBox bad;     bad.min[0]=0.0; bad.min[1]=0.0; bad.min[2]=0.0;
                        bad.max[0]=0.5; bad.max[1]=0.5; bad.max[2]=0.5;
        InterfaceIoU rb = interfaceIoUFromSoup(pos, idx, keepIn, bad, 8);
        std::printf("  interface VIOL -> keepInIoU=%.3f keepOutOverlap=%.3f ramped=%.3f\n",
                    rb.keepInIoU, rb.keepOutOverlap, rb.rampedScore);
        check(rb.ok && rb.keepOutOverlap > 0.5 && rb.rampedScore < 0.01,
              "interface violated -> keep-out overlap penalized to ramp 0");
    }

    std::printf("== %d/%d checks passed ==\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
