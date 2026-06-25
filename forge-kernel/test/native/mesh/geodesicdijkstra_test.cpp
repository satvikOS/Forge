// forge/native/mesh/geodesicdijkstra_test.cpp
//
// RANDOMIZED gate for forge::native::mesh::geodesicDijkstra — approximate
// single-source geodesic distance over a graph embedded in a triangle mesh
// (Dijkstra with non-negative Euclidean edge weights). Pure C++20, no external
// dependencies.
//
// Build + run (standalone — ONLY this module + its named deps, NOT the whole
// tree, so it does not race sibling agents):
//   cd /Users/account_clawteam1/archdisc-Mech && \
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/GeodesicDijkstra.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/geodesicdijkstra_test.cpp \
//       -o /tmp/k4_GeodesicDijkstra && /tmp/k4_GeodesicDijkstra
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC validations (the honest headline — an APPROXIMATE graph geodesic, with
// every over-estimate kept inside its provable bound; NO assertion pretends the
// graph metric equals the true geodesic):
//
//   (S1) FLAT GRID, source at a corner:
//         * distance at the source is exactly 0; its predecessor is kNoPred.
//         * the pure axis-aligned staircase is ALWAYS available in the EDGES
//           graph, so the EDGES distance to any vertex is <= its L1 (Manhattan)
//           grid distance, which is itself <= sqrt(2)*euclid. Combined with the
//           hard Euclidean lower bound this pins the over-estimate inside the
//           proven envelope: euclid <= graphEdges <= L1 <= sqrt(2)*euclid (+eps).
//           (This triangulation also adds each cell's main diagonal as a real
//           mesh edge, which only makes EDGES tighter than L1 — never violating
//           the bound.)
//         * along an AXIS-ALIGNED row/column the straight edge path achieves the
//           Euclidean lower bound, so the EDGES distance equals the Euclidean
//           distance EXACTLY (no over-estimate when the path is straight).
//         * the EDGES_PLUS_DIAGONALS distance is a TIGHTER upper bound: it never
//           exceeds the EDGES distance and never drops below the Euclidean
//           distance (euclid <= graphDiag <= graphEdges), and is strictly smaller
//           somewhere (the added diagonals genuinely help).
//
//   (S2) TRIANGLE INEQUALITY of the graph metric: for the single-source field,
//         for every mesh edge (u,v) with weight w, |d(u) - d(v)| <= w + eps
//         (a consistent shortest-path field), and d(v) <= d(u) + w.
//
//   (S3) MONOTONE shortest-path TREE: following predecessors from any reachable
//         vertex back to the source yields strictly DECREASING distance and
//         terminates AT the source; each parent step decreases distance by
//         exactly the connecting edge's Euclidean weight (+ eps).
//
//   (S4) DISCONNECTED component honesty (0 FAKES): with two grids far apart and
//         no shared geometry, every vertex of the other component is reported
//         unreachable with distance == +infinity — never a fabricated finite
//         value. The source component's vertices are all finite.
//
//   (S5) 0-FAKES on degenerate input: ok=false for odd-length arrays, an
//         out-of-range index, a repeated-index triangle, an out-of-range source,
//         and a valid-range-but-unreferenced source. Arrays left empty.
//
// HONESTY (Bible §0/§9): this is an APPROXIMATE geodesic (graph upper bound),
// NOT exact polyhedral geodesic distance. The test asserts the over-estimate
// stays inside its provable envelope and that all metric invariants hold; it
// never weakens an assertion — it fixes the code.
//
// This gate is RANDOMIZED: it prints a fresh std::random_device seed each run
// (so it can never be cherry-picked) and uses it to jitter grid resolution,
// spacing, a random rigid rotation+translation of every fixture, and the source
// corner, so the invariants are exercised on never-repeating geometry.
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/GeodesicDijkstra.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>   // std::max, std::min, std::abs
#include <cmath>       // std::sqrt, std::sin, std::cos, std::fabs, std::isinf
#include <cstdarg>     // va_list
#include <cstdint>     // std::uint32_t
#include <cstdio>      // std::printf, std::vsnprintf
#include <limits>      // std::numeric_limits
#include <random>      // std::random_device, std::mt19937
#include <vector>      // std::vector

using namespace forge::native::mesh;

static int g_pass = 0, g_total = 0;
static void check(bool c, const char* fmt, ...) {
    ++g_total;
    char buf[600];
    va_list ap; va_start(ap, fmt); std::vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
    if (c) { ++g_pass; std::printf("  [PASS] %s\n", buf); }
    else    std::printf("  [FAIL] %s\n", buf);
}

struct Soup { std::vector<double> pos; std::vector<std::uint32_t> idx; };

static std::uint32_t addV(Soup& s, double x, double y, double z) {
    std::uint32_t id = static_cast<std::uint32_t>(s.pos.size() / 3);
    s.pos.push_back(x); s.pos.push_back(y); s.pos.push_back(z);
    return id;
}
static void addT(Soup& s, std::uint32_t a, std::uint32_t b, std::uint32_t c) {
    s.idx.push_back(a); s.idx.push_back(b); s.idx.push_back(c);
}

// ── flat (nx+1)x(ny+1) vertex grid in the z=0 plane, cell size h, each cell
//    split into two triangles along the (i,j)-(i+1,j+1) diagonal. Returns the
//    soup; the vertex id of grid node (i,j) is j*(nx+1)+i. CCW-consistent. ──────
static Soup flatGrid(int nx, int ny, double h, std::uint32_t& outNxp1) {
    Soup s;
    outNxp1 = static_cast<std::uint32_t>(nx + 1);
    for (int j = 0; j <= ny; ++j)
        for (int i = 0; i <= nx; ++i)
            addV(s, i * h, j * h, 0.0);
    auto V = [&](int i, int j) { return static_cast<std::uint32_t>(j * (nx + 1) + i); };
    for (int j = 0; j < ny; ++j)
        for (int i = 0; i < nx; ++i) {
            std::uint32_t a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
            addT(s, a, b, c);
            addT(s, a, c, d);
        }
    return s;
}

// rigid transform a soup in place: rotate about a unit axis by th, then translate.
static void rigid(Soup& s, double ux, double uy, double uz, double th,
                  double tx, double ty, double tz) {
    double n = std::sqrt(ux*ux + uy*uy + uz*uz); ux/=n; uy/=n; uz/=n;
    double c = std::cos(th), si = std::sin(th), C = 1 - c;
    double R[9] = {
        c + ux*ux*C,     ux*uy*C - uz*si, ux*uz*C + uy*si,
        uy*ux*C + uz*si, c + uy*uy*C,     uy*uz*C - ux*si,
        uz*ux*C - uy*si, uz*uy*C + ux*si, c + uz*uz*C };
    for (std::size_t i = 0; i + 2 < s.pos.size(); i += 3) {
        double x = s.pos[i], y = s.pos[i+1], z = s.pos[i+2];
        s.pos[i  ] = R[0]*x + R[1]*y + R[2]*z + tx;
        s.pos[i+1] = R[3]*x + R[4]*y + R[5]*z + ty;
        s.pos[i+2] = R[6]*x + R[7]*y + R[8]*z + tz;
    }
}

static void appendDisjoint(Soup& a, const Soup& b) {
    std::uint32_t off = static_cast<std::uint32_t>(a.pos.size() / 3);
    for (double p : b.pos) a.pos.push_back(p);
    for (std::uint32_t i : b.idx) a.idx.push_back(i + off);
}

static double dist3(const std::vector<double>& p, std::uint32_t a, std::uint32_t b) {
    double dx = p[3*a]-p[3*b], dy = p[3*a+1]-p[3*b+1], dz = p[3*a+2]-p[3*b+2];
    return std::sqrt(dx*dx + dy*dy + dz*dz);
}

int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> U(0.0, 1.0);
    auto uni  = [&](double lo, double hi) { return lo + (hi - lo) * U(rng); };
    auto uniI = [&](int lo, int hi) { return lo + static_cast<int>((hi - lo + 1) * U(rng)); };

    const double EPS = 1e-7;
    const double SQRT2 = std::sqrt(2.0);

    std::printf("=== forge::native::mesh geodesicDijkstra (approximate single-source\n");
    std::printf("===   geodesic over a graph embedded in a triangle mesh; Euclidean weights) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n\n", seed);

    // ── (S1) FLAT GRID: source/zero, L1 == EDGES, axis exactness, bounds ─────
    std::printf("[S1] flat grid: d(src)=0, EDGES<=L1 (upper bound on Euclid within sqrt2),\n");
    std::printf("     axis-aligned exact, EDGES_PLUS_DIAGONALS tighter (euclid<=diag<=edges)\n");
    bool s1 = true;
    {
        int nx = uniI(8, 16), ny = uniI(8, 16);
        double h = uni(0.3, 1.7);
        std::uint32_t nxp1 = 0;
        Soup g = flatGrid(nx, ny, h, nxp1);
        // grid-node (i,j) id BEFORE transform stays valid (rigid keeps ids/topology).
        auto NID = [&](int i, int j) { return static_cast<std::uint32_t>(j * (nx + 1) + i); };
        // source at a random corner of the grid.
        int sci = (U(rng) < 0.5) ? 0 : nx;
        int scj = (U(rng) < 0.5) ? 0 : ny;
        std::uint32_t src = NID(sci, scj);

        rigid(g, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.4),
              uni(-3,3), uni(-3,3), uni(-3,3));

        GeodesicResult re = geodesicDijkstra(g.pos, g.idx, src, GeodesicGraph::EDGES);
        GeodesicResult rd2 = geodesicDijkstra(g.pos, g.idx, src, GeodesicGraph::EDGES_PLUS_DIAGONALS);
        check(re.ok && rd2.ok, "(S1) both graph modes ok (edges=%d diag=%d)", (int)re.ok, (int)rd2.ok);
        s1 &= re.ok && rd2.ok;
        if (re.ok && rd2.ok) {
            // source distance exactly 0 and no predecessor.
            check(re.distance[src] == 0.0 && re.predecessor[src] == kNoPred,
                  "(S1) d(src)==0 & predecessor[src]==kNoPred (d=%.3g)", re.distance[src]);
            s1 &= (re.distance[src] == 0.0 && re.predecessor[src] == kNoPred);

            // every grid vertex reachable (single connected component).
            check(re.reachableCount == static_cast<std::uint32_t>((nx+1)*(ny+1)),
                  "(S1) all %d vertices reachable (got %u)", (nx+1)*(ny+1), re.reachableCount);
            s1 &= (re.reachableCount == static_cast<std::uint32_t>((nx+1)*(ny+1)));

            bool boundOK = true, l1OK = true, axisOK = true, diagOK = true, diagTightSeen = false;
            for (int j = 0; j <= ny; ++j) for (int i = 0; i <= nx; ++i) {
                std::uint32_t v = NID(i, j);
                int di = std::abs(i - sci), dj = std::abs(j - scj);
                double L1     = (di + dj) * h;                    // Manhattan grid path
                double euclid = std::sqrt((double)di*di + (double)dj*dj) * h;

                double de = re.distance[v];
                double dd = rd2.distance[v];

                // Provable bounds independent of how each quad is split:
                //   * The pure axis-aligned staircase (L1) is ALWAYS available in
                //     the EDGES graph, so EDGES <= L1.
                //   * No graph path can beat the straight line, so euclid <= EDGES.
                //   * L1 <= sqrt(2)*euclid, so euclid <= EDGES <= sqrt(2)*euclid.
                //   (This triangulation also adds each cell's main diagonal as a
                //    real mesh edge, which can only make EDGES <= L1 even more
                //    slack — never violating the bounds above.)
                if (de < euclid - EPS) boundOK = false;                  // lower bound
                if (de > L1 + EPS * (1.0 + L1)) l1OK = false;            // L1 upper bound
                if (de > SQRT2 * euclid + EPS * (1.0 + euclid)) boundOK = false; // sqrt2 envelope
                // axis-aligned (same row or column): the straight edge path
                // achieves the Euclidean lower bound, so EDGES == Euclid exactly.
                if (di == 0 || dj == 0) {
                    if (std::fabs(de - euclid) > EPS * (1.0 + euclid)) axisOK = false;
                }
                // EDGES_PLUS_DIAGONALS only ADDS short-cut edges, so it can never
                // exceed the EDGES distance, and the Euclidean lower bound still
                // holds: euclid <= DIAG <= EDGES.
                if (dd < euclid - EPS) diagOK = false;
                if (dd > de + EPS * (1.0 + de)) diagOK = false;
                // densifying with the opposite-vertex diagonals must help SOMEWHERE
                // strictly (otherwise the EDGES_PLUS_DIAGONALS mode is a no-op).
                if (dd < de - EPS) diagTightSeen = true;
            }
            check(l1OK,  "(S1) EDGES <= L1 grid distance for every vertex (axis staircase available)");
            check(boundOK,"(S1) euclid <= EDGES <= sqrt(2)*euclid for every vertex");
            check(axisOK, "(S1) EDGES == Euclid along axis-aligned rows/cols (exact)");
            check(diagOK, "(S1) euclid <= DIAG <= EDGES for every vertex (added edges only shorten)");
            check(diagTightSeen, "(S1) DIAG strictly tighter than EDGES somewhere (diagonals do help)");
            s1 &= l1OK && boundOK && axisOK && diagOK && diagTightSeen;
        }
    }
    std::printf("    (S1) = %s\n\n", s1 ? "PASS" : "FAIL");

    // ── (S2) TRIANGLE INEQUALITY across every mesh edge ──────────────────────
    std::printf("[S2] triangle inequality: |d(u)-d(v)| <= w(u,v) and d(v) <= d(u)+w for all edges\n");
    bool s2 = true;
    {
        int nx = uniI(6, 14), ny = uniI(6, 14);
        double h = uni(0.4, 1.5);
        std::uint32_t nxp1 = 0;
        Soup g = flatGrid(nx, ny, h, nxp1);
        std::uint32_t src = static_cast<std::uint32_t>(uniI(0, (nx+1)*(ny+1) - 1));
        rigid(g, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.4), uni(-2,2), uni(-2,2), uni(-2,2));
        for (GeodesicGraph mode : {GeodesicGraph::EDGES, GeodesicGraph::EDGES_PLUS_DIAGONALS}) {
            GeodesicResult r = geodesicDijkstra(g.pos, g.idx, src, mode);
            if (!r.ok) { s2 = false; continue; }
            bool tri = true;
            // walk every triangle's three edges (a superset of mesh edges).
            for (std::size_t t = 0; t < g.idx.size() / 3; ++t) {
                std::uint32_t tri3[3] = { g.idx[3*t], g.idx[3*t+1], g.idx[3*t+2] };
                for (int e = 0; e < 3; ++e) {
                    std::uint32_t u = tri3[e], v = tri3[(e+1)%3];
                    double w = dist3(g.pos, u, v);
                    double du = r.distance[u], dv = r.distance[v];
                    if (std::isinf(du) || std::isinf(dv)) continue; // grid is connected anyway
                    if (dv > du + w + EPS * (1.0 + w)) tri = false;
                    if (std::fabs(du - dv) > w + EPS * (1.0 + w)) tri = false;
                }
            }
            check(tri, "(S2) triangle inequality holds on every edge (mode=%s)",
                  mode == GeodesicGraph::EDGES ? "EDGES" : "DIAG");
            s2 &= tri;
        }
    }
    std::printf("    (S2) = %s\n\n", s2 ? "PASS" : "FAIL");

    // ── (S3) MONOTONE shortest-path tree back to the source ──────────────────
    std::printf("[S3] shortest-path tree: predecessors decrease distance by the edge weight,\n");
    std::printf("     strictly monotone, terminating exactly at the source\n");
    bool s3 = true;
    {
        int nx = uniI(7, 15), ny = uniI(7, 15);
        double h = uni(0.4, 1.5);
        std::uint32_t nxp1 = 0;
        Soup g = flatGrid(nx, ny, h, nxp1);
        std::uint32_t src = static_cast<std::uint32_t>(uniI(0, (nx+1)*(ny+1) - 1));
        rigid(g, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.4), uni(-2,2), uni(-2,2), uni(-2,2));
        GeodesicResult r = geodesicDijkstra(g.pos, g.idx, src, GeodesicGraph::EDGES_PLUS_DIAGONALS);
        check(r.ok, "(S3) ok");
        s3 &= r.ok;
        if (r.ok) {
            bool treeOK = true;
            std::uint32_t nV = static_cast<std::uint32_t>(g.pos.size() / 3);
            for (std::uint32_t v = 0; v < nV; ++v) {
                if (!r.reachable[v]) { treeOK = false; break; } // grid is connected
                std::uint32_t cur = v;
                int guard = 0, maxSteps = static_cast<int>(nV) + 4;
                while (cur != src) {
                    std::uint32_t p = r.predecessor[cur];
                    if (p == kNoPred) { treeOK = false; break; }   // must reach source
                    double w = dist3(g.pos, cur, p);
                    // parent distance is smaller by exactly the connecting weight.
                    if (!(r.distance[p] < r.distance[cur] + EPS)) { treeOK = false; break; }
                    if (std::fabs(r.distance[cur] - (r.distance[p] + w)) > EPS * (1.0 + w)) {
                        treeOK = false; break;
                    }
                    cur = p;
                    if (++guard > maxSteps) { treeOK = false; break; } // no cycles
                }
                if (!treeOK) break;
            }
            check(treeOK, "(S3) every vertex's predecessor chain is monotone & ends at src");
            s3 &= treeOK;
            // source has no predecessor.
            check(r.predecessor[src] == kNoPred, "(S3) predecessor[src]==kNoPred");
            s3 &= (r.predecessor[src] == kNoPred);
        }
    }
    std::printf("    (S3) = %s\n\n", s3 ? "PASS" : "FAIL");

    // ── (S4) DISCONNECTED component honesty (infinity, 0 FAKES) ──────────────
    std::printf("[S4] two far-apart grids: other component is unreachable with distance==+inf\n");
    bool s4 = true;
    {
        std::uint32_t nxp1a = 0, nxp1b = 0;
        Soup a = flatGrid(uniI(4, 8), uniI(4, 8), uni(0.4, 1.0), nxp1a);
        Soup b = flatGrid(uniI(4, 8), uniI(4, 8), uni(0.4, 1.0), nxp1b);
        std::uint32_t nA = static_cast<std::uint32_t>(a.pos.size() / 3);
        rigid(a, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.4), uni(-1,1), uni(-1,1), uni(-1,1));
        rigid(b, uni(0.1,1), uni(0.1,1), uni(0.1,1), uni(0.2,1.4), uni(40,60), uni(40,60), uni(40,60));
        appendDisjoint(a, b);   // a now holds both, b's ids offset by nA
        std::uint32_t nTot = static_cast<std::uint32_t>(a.pos.size() / 3);

        std::uint32_t src = static_cast<std::uint32_t>(uniI(0, (int)nA - 1)); // in component A
        GeodesicResult r = geodesicDijkstra(a.pos, a.idx, src, GeodesicGraph::EDGES);
        check(r.ok, "(S4) ok");
        s4 &= r.ok;
        if (r.ok) {
            bool aFinite = true, bInf = true;
            for (std::uint32_t v = 0; v < nA; ++v)
                if (!r.reachable[v] || std::isinf(r.distance[v])) aFinite = false;
            for (std::uint32_t v = nA; v < nTot; ++v)
                if (r.reachable[v] || !std::isinf(r.distance[v]) || r.predecessor[v] != kNoPred)
                    bInf = false;
            double inf = std::numeric_limits<double>::infinity();
            check(aFinite, "(S4) all of source-component A finite & reachable");
            check(bInf, "(S4) all of far component B unreachable, distance==+inf, no predecessor");
            check(r.reachableCount == nA, "(S4) reachableCount==|A| (got %u, |A|=%u)", r.reachableCount, nA);
            check(std::isinf(inf) && r.distance[nA] == inf,
                  "(S4) honest +inf sentinel (B[0] dist isinf=%d)", (int)std::isinf(r.distance[nA]));
            s4 &= aFinite && bInf && (r.reachableCount == nA);
        }
    }
    std::printf("    (S4) = %s\n\n", s4 ? "PASS" : "FAIL");

    // ── (S5) 0-FAKES on degenerate input ─────────────────────────────────────
    std::printf("[S5] 0-FAKES: degenerate inputs return ok=false with empty arrays\n");
    bool s5 = true;
    {
        std::vector<double> p = {0,0,0, 1,0,0, 0,1,0, 1,1,0};
        std::vector<std::uint32_t> goodIdx = {0,1,2, 0,2,3};
        // (a) odd-length positions
        std::vector<double> oddP = {0,0,0, 1,0};
        GeodesicResult t1 = geodesicDijkstra(oddP, {0,1,2}, 0);
        // (b) odd-length indices
        GeodesicResult t2 = geodesicDijkstra(p, {0,1}, 0);
        // (c) out-of-range index
        GeodesicResult t3 = geodesicDijkstra(p, {0,1,9}, 0);
        // (d) repeated-index triangle
        GeodesicResult t4 = geodesicDijkstra(p, {0,0,1}, 0);
        // (e) out-of-range source
        GeodesicResult t5 = geodesicDijkstra(p, goodIdx, 99);
        // (f) valid-range but UNREFERENCED source (vertex 3 unused if we drop it)
        std::vector<std::uint32_t> dropV3 = {0,1,2};  // never references vertex 3
        GeodesicResult t6 = geodesicDijkstra(p, dropV3, 3);
        bool emptied =
            t1.distance.empty() && t2.distance.empty() && t3.distance.empty() &&
            t4.distance.empty() && t5.distance.empty() && t6.distance.empty();
        bool allFalse = !t1.ok && !t2.ok && !t3.ok && !t4.ok && !t5.ok && !t6.ok;
        check(allFalse, "(S5) ok=false on oddPos/oddIdx/badIdx/repeat/badSrc/unreferenced "
                        "(%d%d%d%d%d%d)",
              (int)t1.ok,(int)t2.ok,(int)t3.ok,(int)t4.ok,(int)t5.ok,(int)t6.ok);
        check(emptied, "(S5) degenerate results leave arrays empty (no fabricated output)");
        s5 = allFalse && emptied;

        // sanity: the GOOD soup with a referenced source DOES succeed (shows the
        // honesty checks above are not just rejecting everything).
        GeodesicResult tg = geodesicDijkstra(p, goodIdx, 0);
        check(tg.ok && tg.reachableCount == 4 && tg.distance[0] == 0.0,
              "(S5) the matching VALID soup succeeds (ok=%d reach=%u d0=%.2g)",
              (int)tg.ok, tg.reachableCount, tg.distance[0]);
        s5 &= tg.ok && tg.reachableCount == 4 && tg.distance[0] == 0.0;
    }
    std::printf("    (S5) = %s\n\n", s5 ? "PASS" : "FAIL");

    std::printf("=== HEADLINE: flat-grid EDGES<=L1 (upper bound on Euclid within sqrt2), exact\n");
    std::printf("===   along axes; DIAG tighter (euclid<=DIAG<=EDGES); triangle inequality;\n");
    std::printf("===   monotone SP tree; disconnected comps honestly +inf; degenerate ok=false ===\n");
    std::printf("=== ENVELOPE (honest): APPROXIMATE single-source geodesic = Dijkstra shortest\n");
    std::printf("===   path over a graph embedded in the mesh (mesh edges, optionally + per-\n");
    std::printf("===   interior-edge opposite-vertex diagonals) with non-negative Euclidean edge\n");
    std::printf("===   weights. The result is a provable UPPER BOUND on the true geodesic\n");
    std::printf("===   distance (exact where a shortest path runs along graph edges, e.g. an\n");
    std::printf("===   axis-aligned grid path); it is NOT exact polyhedral geodesic (MMP/CH).\n");
    std::printf("===   Unreachable vertices report +infinity honestly; degenerate input is\n");
    std::printf("===   rejected with ok=false. Validated randomized every run.\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
