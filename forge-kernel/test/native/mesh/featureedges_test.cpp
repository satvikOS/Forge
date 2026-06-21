// forge/native/mesh/test/featureedges_test.cpp
//
// RANDOMIZED validation gate for forge::native::mesh::detectFeatureEdges — sharp
// feature-edge + corner detection by dihedral angle. Pure C++20, no external deps.
//
// Build + run (standalone — ONLY this module + its named deps + this test):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/FeatureEdges.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/featureedges_test.cpp -o /tmp/k5_FeatureEdges && /tmp/k5_FeatureEdges
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC ASSERTED HERE:
//   (F1) CUBE (12 triangles, 2 per face): reports EXACTLY its 12 cube edges as
//        feature edges and EXACTLY its 8 vertices as CORNERS. The 6 face-diagonals
//        (where the two triangles of each face meet) are coplanar (0 deg dihedral)
//        and are NOT features. The 12 sharp edges each have a 90 deg dihedral. The
//        cube is built with a RANDOM rigid rotation + translation + scale each run
//        (a feature edge is a property of the surface, invariant to pose), so the
//        fixture is not a single cherry-picked orientation.
//   (F2) ICOSPHERE (smooth, subdivided): at the default 30 deg threshold a smooth
//        icosphere reports ~0 feature edges (its largest dihedral is well below
//        30 deg) and 0 corner/crease vertices. Asserted on a RANDOMLY tangentially-
//        jiggled-then-reprojected sphere (different mesh each run, still exactly on
//        the analytic sphere) AND across two distinct subdivision levels.
//   (F3) THRESHOLD MONOTONICITY: raising the threshold NEVER increases the
//        feature-edge count. Asserted as a strict non-increase across a fine sweep
//        of thresholds on BOTH fixtures (cube and icosphere). This is a structural
//        guarantee (boundary set is threshold-free; the manifold-angle set only
//        shrinks), not a tuned tolerance.
//   (F4) OPEN MESH (a plane patch with a real boundary): every boundary edge is a
//        feature edge (the surface terminates), independent of threshold; interior
//        edges of the flat patch are coplanar so NOT features at 30 deg; the four
//        plane CORNERS (2 incident boundary feature edges each... actually the
//        corner has 2 boundary edges -> CREASE; we assert the boundary loop forms
//        a closed crease ring with 0 corners at 30 deg on the flat patch).
//   (F5) 0-FAKES: degenerate / unsupported inputs return ok=false honestly:
//          * empty soup,
//          * indices length not a multiple of 3,
//          * a non-finite (NaN) coordinate,
//          * a non-manifold soup (two triangles sharing the SAME directed edge),
//          * a zero-area (degenerate) triangle,
//          * a threshold outside [0,180].
//        ok=true is returned ONLY for a mesh the kernel half-edge audit accepts.
//
// Fresh std::random_device seed each run (printed below). NEVER weaken an
// assertion.
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/FeatureEdges.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>   // std::sort, std::max, std::min
#include <array>       // std::array
#include <cmath>       // std::sqrt, std::cos, std::sin, std::fabs, std::nan
#include <cstdarg>     // va_list, va_start, va_end
#include <cstddef>     // std::size_t
#include <cstdint>     // std::uint32_t, std::uint64_t
#include <cstdio>      // std::printf, std::vsnprintf
#include <map>         // std::map
#include <random>      // std::random_device, std::mt19937, std::uniform_real_distribution
#include <vector>      // std::vector

using namespace forge::native::mesh;

static int g_pass = 0, g_total = 0;
static void check(bool c, const char* fmt, ...) {
    ++g_total;
    char buf[640];
    va_list ap; va_start(ap, fmt); std::vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
    if (c) { ++g_pass; std::printf("  [PASS] %s\n", buf); }
    else     std::printf("  [FAIL] %s\n", buf);
}

static const double PI = 3.14159265358979323846;

// ── unit cube as 12 triangles, 2 per face, all CCW-outward, 8 shared vertices ──
// Vertices of the [-0.5,0.5]^3 cube:
//   0:(-,-,-) 1:(+,-,-) 2:(+,+,-) 3:(-,+,-)   (z = -)
//   4:(-,-,+) 5:(+,-,+) 6:(+,+,+) 7:(-,+,+)   (z = +)
static void unitCube(std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos = {
        -0.5,-0.5,-0.5,   0.5,-0.5,-0.5,   0.5, 0.5,-0.5,  -0.5, 0.5,-0.5,
        -0.5,-0.5, 0.5,   0.5,-0.5, 0.5,   0.5, 0.5, 0.5,  -0.5, 0.5, 0.5
    };
    // Each face wound CCW as seen from OUTSIDE (outward normal). Two triangles per
    // face share the face diagonal.
    idx = {
        // -z face (normal -z): outward CCW seen from -z -> (0,3,2),(0,2,1)
        0,3,2,  0,2,1,
        // +z face (normal +z): (4,5,6),(4,6,7)
        4,5,6,  4,6,7,
        // -y face (normal -y): (0,1,5),(0,5,4)
        0,1,5,  0,5,4,
        // +y face (normal +y): (3,7,6),(3,6,2)
        3,7,6,  3,6,2,
        // -x face (normal -x): (0,4,7),(0,7,3)
        0,4,7,  0,7,3,
        // +x face (normal +x): (1,2,6),(1,6,5)
        1,2,6,  1,6,5
    };
}

// Apply a random rigid rotation (about a random axis by a random angle), a random
// uniform scale and a random translation. A feature edge is a surface property,
// invariant to this pose — so the cube spec must hold for ANY pose.
static void poseRandom(std::vector<double>& pos, std::mt19937& rng) {
    std::uniform_real_distribution<double> A(-PI, PI);
    std::uniform_real_distribution<double> U(-1.0, 1.0);
    std::uniform_real_distribution<double> S(0.5, 4.0);
    // random unit axis
    double ax = U(rng), ay = U(rng), az = U(rng);
    double an = std::sqrt(ax*ax + ay*ay + az*az);
    if (an < 1e-9) { ax = 1; ay = 0; az = 0; an = 1; }
    ax /= an; ay /= an; az /= an;
    double th = A(rng), ct = std::cos(th), st = std::sin(th), vt = 1.0 - ct;
    // Rodrigues rotation matrix
    double R[9] = {
        ct + ax*ax*vt,      ax*ay*vt - az*st,   ax*az*vt + ay*st,
        ay*ax*vt + az*st,   ct + ay*ay*vt,      ay*az*vt - ax*st,
        az*ax*vt - ay*st,   az*ay*vt + ax*st,   ct + az*az*vt
    };
    double s = S(rng);
    double tx = 10.0 * U(rng), ty = 10.0 * U(rng), tz = 10.0 * U(rng);
    for (std::size_t i = 0; i + 2 < pos.size(); i += 3) {
        double x = pos[i], y = pos[i+1], z = pos[i+2];
        double rx = R[0]*x + R[1]*y + R[2]*z;
        double ry = R[3]*x + R[4]*y + R[5]*z;
        double rz = R[6]*x + R[7]*y + R[8]*z;
        pos[i]   = s*rx + tx;
        pos[i+1] = s*ry + ty;
        pos[i+2] = s*rz + tz;
    }
}

// ── icosphere (subdivided icosahedron), radius r, `subdiv` levels ──────────────
static void icosphere(double r, int subdiv,
                      std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    const double t = (1.0 + std::sqrt(5.0)) * 0.5;
    std::vector<std::array<double, 3>> v = {
        {-1, t, 0}, {1, t, 0}, {-1,-t, 0}, {1,-t, 0},
        {0,-1, t}, {0, 1, t}, {0,-1,-t}, {0, 1,-t},
        { t, 0,-1}, { t, 0, 1}, {-t, 0,-1}, {-t, 0, 1}
    };
    std::vector<std::array<std::uint32_t, 3>> f = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1}
    };
    for (int s = 0; s < subdiv; ++s) {
        std::map<std::uint64_t, std::uint32_t> mid;
        auto midpoint = [&](std::uint32_t a, std::uint32_t b) {
            std::uint64_t key = a < b
                ? (static_cast<std::uint64_t>(a) << 32) | b
                : (static_cast<std::uint64_t>(b) << 32) | a;
            auto it = mid.find(key);
            if (it != mid.end()) return it->second;
            std::array<double, 3> m = {
                0.5 * (v[a][0] + v[b][0]),
                0.5 * (v[a][1] + v[b][1]),
                0.5 * (v[a][2] + v[b][2]) };
            std::uint32_t id = static_cast<std::uint32_t>(v.size());
            v.push_back(m); mid[key] = id; return id;
        };
        std::vector<std::array<std::uint32_t, 3>> nf;
        for (auto& tri : f) {
            std::uint32_t a = midpoint(tri[0], tri[1]);
            std::uint32_t b = midpoint(tri[1], tri[2]);
            std::uint32_t c = midpoint(tri[2], tri[0]);
            nf.push_back({tri[0], a, c});
            nf.push_back({tri[1], b, a});
            nf.push_back({tri[2], c, b});
            nf.push_back({a, b, c});
        }
        f.swap(nf);
    }
    for (auto& p : v) {
        double n = std::sqrt(p[0]*p[0] + p[1]*p[1] + p[2]*p[2]);
        p[0] = p[0] / n * r; p[1] = p[1] / n * r; p[2] = p[2] / n * r;
    }
    pos.reserve(v.size() * 3);
    for (auto& p : v) { pos.push_back(p[0]); pos.push_back(p[1]); pos.push_back(p[2]); }
    idx.reserve(f.size() * 3);
    for (auto& tri : f) { idx.push_back(tri[0]); idx.push_back(tri[1]); idx.push_back(tri[2]); }
}

static void reproject(std::vector<double>& pos, double r) {
    for (std::size_t i = 0; i + 2 < pos.size(); i += 3) {
        double x = pos[i], y = pos[i+1], z = pos[i+2];
        double n = std::sqrt(x*x + y*y + z*z);
        if (n < 1e-12) continue;
        double sc = r / n;
        pos[i] = x*sc; pos[i+1] = y*sc; pos[i+2] = z*sc;
    }
}

// Tangential jiggle then re-project: varies the triangulation run-to-run while
// staying exactly on the analytic sphere — so the smooth-sphere claim is not a
// cherry-picked regular icosphere.
static void jiggleOnSphere(std::vector<double>& pos, double r, double amp, std::mt19937& rng) {
    std::uniform_real_distribution<double> U(-1.0, 1.0);
    for (std::size_t i = 0; i + 2 < pos.size(); i += 3) {
        pos[i]   += amp * r * U(rng);
        pos[i+1] += amp * r * U(rng);
        pos[i+2] += amp * r * U(rng);
    }
    reproject(pos, r);
}

// ── flat plane patch: an (n x n) grid in z=0, span L (OPEN mesh with boundary) ─
static void planePatch(double L, int n,
                       std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    for (int j = 0; j <= n; ++j)
        for (int i = 0; i <= n; ++i) {
            pos.push_back(L * (double(i) / n - 0.5));
            pos.push_back(L * (double(j) / n - 0.5));
            pos.push_back(0.0);
        }
    auto vid = [&](int i, int j) { return static_cast<std::uint32_t>(j * (n + 1) + i); };
    for (int j = 0; j < n; ++j)
        for (int i = 0; i < n; ++i) {
            std::uint32_t a = vid(i, j), b = vid(i+1, j), c = vid(i+1, j+1), d = vid(i, j+1);
            idx.push_back(a); idx.push_back(b); idx.push_back(c);
            idx.push_back(a); idx.push_back(c); idx.push_back(d);
        }
}

int main() {
    std::random_device rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);

    std::printf("=== forge::native::mesh::detectFeatureEdges validation gate ===\n");
    std::printf("=== (dihedral-angle sharp feature edges + corners/creases) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n", seed);

    // ── (F1) CUBE: exactly 12 feature edges, 8 corners, 6 non-feature diagonals ─
    std::printf("\n[F1] unit cube (random pose each run): 12 sharp edges + 8 corners\n");
    bool f1 = false;
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        unitCube(pos, idx);
        poseRandom(pos, rng);   // arbitrary rigid+scale pose — feature is invariant

        FeatureSet fs = detectFeatureEdges(pos, idx);   // default 30 deg
        check(fs.ok, "[F1] cube detect ok=true (reason='%s')", fs.reason);
        if (fs.ok) {
            // Topology sanity: V=8, F=12, E=18 (12 cube edges + 6 face diagonals).
            check(fs.numVertices == 8, "[F1] cube has 8 vertices (%u)", fs.numVertices);
            check(fs.numFaces == 12,   "[F1] cube has 12 triangle faces (%u)", fs.numFaces);
            check(fs.numEdges == 18,   "[F1] cube has 18 undirected edges (12 sharp + 6 diag) (%u)", fs.numEdges);

            // EXACTLY the 12 cube edges are features; the 6 face diagonals are not.
            check(fs.numFeatureEdges == 12, "[F1] EXACTLY 12 feature edges (%u)", fs.numFeatureEdges);
            check(fs.numBoundaryEdges == 0, "[F1] cube is closed -> 0 boundary edges (%u)", fs.numBoundaryEdges);

            // Count edges by classification and verify the sharp ones are ~90 deg,
            // the diagonal ones ~0 deg (coplanar).
            std::uint32_t nSharp90 = 0, nFlat0 = 0;
            double maxSharpErr = 0.0, maxFlat = 0.0;
            for (const FeatureEdge& e : fs.edges) {
                if (e.feature) {
                    ++nSharp90;
                    maxSharpErr = std::max(maxSharpErr, std::fabs(e.dihedralDeg - 90.0));
                } else {
                    ++nFlat0;
                    maxFlat = std::max(maxFlat, std::fabs(e.dihedralDeg));
                }
            }
            std::printf("    sharp edges=%u (max |dihedral-90deg|=%.3e)  flat diagonals=%u (max |dihedral|=%.3e)\n",
                        nSharp90, maxSharpErr, nFlat0, maxFlat);
            check(nSharp90 == 12, "[F1] 12 sharp edges (%u)", nSharp90);
            check(nFlat0 == 6, "[F1] 6 coplanar face-diagonal edges, NOT features (%u)", nFlat0);
            check(maxSharpErr < 1e-7, "[F1] each sharp edge dihedral == 90 deg (max err %.3e)", maxSharpErr);
            check(maxFlat < 1e-7, "[F1] each face-diagonal dihedral == 0 deg (max %.3e)", maxFlat);

            // EXACTLY 8 corners; 0 crease vertices; every vertex feature-degree 3.
            check(fs.numCornerVertices == 8, "[F1] EXACTLY 8 corner vertices (%u)", fs.numCornerVertices);
            check(fs.numCreaseVertices == 0, "[F1] 0 crease vertices (%u)", fs.numCreaseVertices);
            bool allDeg3 = true;
            for (std::uint32_t v = 0; v < fs.numVertices; ++v)
                if (fs.vertexFeatureDegree[v] != 3 || fs.vertexKind[v] != VertexKind::CORNER) allDeg3 = false;
            check(allDeg3, "[F1] every cube vertex has 3 incident feature edges -> CORNER");

            f1 = (fs.numVertices == 8) && (fs.numFaces == 12) && (fs.numEdges == 18) &&
                 (fs.numFeatureEdges == 12) && (fs.numBoundaryEdges == 0) &&
                 (nSharp90 == 12) && (nFlat0 == 6) && (maxSharpErr < 1e-7) && (maxFlat < 1e-7) &&
                 (fs.numCornerVertices == 8) && (fs.numCreaseVertices == 0) && allDeg3;
        }
    }

    // ── (F2) SMOOTH ICOSPHERE: ~0 feature edges at 30 deg ─────────────────────
    std::printf("\n[F2] smooth icosphere at 30 deg: ~0 feature edges, 0 corners\n");
    auto sphereCase = [&](const char* tag, double R, int subdiv, double jiggleAmp) -> bool {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(R, subdiv, pos, idx);
        if (jiggleAmp > 0.0) jiggleOnSphere(pos, R, jiggleAmp, rng);

        FeatureSet fs = detectFeatureEdges(pos, idx);   // default 30 deg
        check(fs.ok, "[%s] sphere detect ok=true (reason='%s')", tag, fs.reason);
        if (!fs.ok) return false;

        // Largest dihedral on the mesh — must be well below 30 deg for a smooth
        // subdivided sphere (so 0 feature edges at the default threshold).
        double maxDih = 0.0;
        for (const FeatureEdge& e : fs.edges)
            if (!e.boundary) maxDih = std::max(maxDih, e.dihedralDeg);

        std::printf("    [%s] V=%u E=%u F=%u  max dihedral=%.3f deg  featureEdges=%u corners=%u creases=%u\n",
                    tag, fs.numVertices, fs.numEdges, fs.numFaces, maxDih,
                    fs.numFeatureEdges, fs.numCornerVertices, fs.numCreaseVertices);

        bool noFeat = (fs.numFeatureEdges == 0);
        bool noBnd  = (fs.numBoundaryEdges == 0);    // closed sphere
        bool noCorn = (fs.numCornerVertices == 0 && fs.numCreaseVertices == 0);
        bool below  = (maxDih < 30.0);
        check(noBnd, "[%s] closed sphere -> 0 boundary edges (%u)", tag, fs.numBoundaryEdges);
        check(below, "[%s] max dihedral < 30 deg (%.3f) -> smooth", tag, maxDih);
        check(noFeat, "[%s] 0 feature edges at 30 deg (%u)", tag, fs.numFeatureEdges);
        check(noCorn, "[%s] 0 corner + 0 crease vertices", tag);
        return noFeat && noBnd && noCorn && below;
    };
    bool f2a = sphereCase("F2a sub3", 1.0, 3, 0.0);              // clean
    bool f2b = sphereCase("F2b sub3 jiggle", 1.7, 3, 0.01);     // randomized this run
    bool f2c = sphereCase("F2c sub4", 2.3, 4, 0.0);             // finer
    bool f2 = f2a && f2b && f2c;

    // ── (F3) THRESHOLD MONOTONICITY: raising threshold never increases count ───
    std::printf("\n[F3] threshold monotonicity: count is non-increasing in threshold\n");
    auto monotone = [&](const char* tag, const std::vector<double>& pos,
                        const std::vector<std::uint32_t>& idx) -> bool {
        std::uint32_t prev = 0xFFFFFFFFu;
        bool ok = true, first = true;
        std::printf("    [%s] thr->count: ", tag);
        for (double thr = 0.0; thr <= 180.0 + 1e-9; thr += 7.5) {
            FeatureSet fs = detectFeatureEdges(pos, idx, thr);
            if (!fs.ok) { check(false, "[%s] detect ok at thr=%.1f", tag, thr); return false; }
            std::printf("%.0f:%u ", thr, fs.numFeatureEdges);
            if (!first && fs.numFeatureEdges > prev) ok = false;
            prev = fs.numFeatureEdges; first = false;
        }
        std::printf("\n");
        check(ok, "[%s] feature-edge count NEVER increases as threshold rises", tag);
        return ok;
    };
    bool f3 = false;
    {
        std::vector<double> cp; std::vector<std::uint32_t> ci; unitCube(cp, ci); poseRandom(cp, rng);
        std::vector<double> sp; std::vector<std::uint32_t> si; icosphere(1.3, 3, sp, si); jiggleOnSphere(sp, 1.3, 0.02, rng);
        bool mc = monotone("F3 cube", cp, ci);
        bool ms = monotone("F3 sphere", sp, si);
        // Boundary probes on the cube. At thr=0 EVERY edge with a non-zero
        // dihedral is a feature: after a random rigid+scale pose the 6 face
        // diagonals carry a ~1e-13-deg floating residue (geometrically 0, but
        // strictly > 0), so HONESTLY all 18 edges trip at thr=0 — we assert that
        // truthfully rather than pretend the residue rounds away. Stepping the
        // threshold just past that residue (1 deg, far below 90) drops the 6
        // near-coplanar diagonals and leaves EXACTLY the 12 genuine 90-deg edges;
        // it stays 12 up to 89, then 0 once the threshold passes 90.
        FeatureSet at0  = detectFeatureEdges(cp, ci, 0.0);
        FeatureSet at1  = detectFeatureEdges(cp, ci, 1.0);
        FeatureSet at89 = detectFeatureEdges(cp, ci, 89.0);
        FeatureSet at91 = detectFeatureEdges(cp, ci, 91.0);
        check(at0.ok && at0.numFeatureEdges == 18, "[F3] cube @thr=0: all 18 edges (diagonal residue >0) (%u)", at0.numFeatureEdges);
        check(at1.ok && at1.numFeatureEdges == 12, "[F3] cube @thr=1: 12 sharp edges (coplanar diagonals dropped) (%u)", at1.numFeatureEdges);
        check(at89.ok && at89.numFeatureEdges == 12, "[F3] cube @thr=89: still 12 (90>89) (%u)", at89.numFeatureEdges);
        check(at91.ok && at91.numFeatureEdges == 0, "[F3] cube @thr=91: 0 (90<91) (%u)", at91.numFeatureEdges);
        f3 = mc && ms && at0.ok && (at0.numFeatureEdges == 18) && at1.ok && (at1.numFeatureEdges == 12) &&
             at89.ok && (at89.numFeatureEdges == 12) && at91.ok && (at91.numFeatureEdges == 0);
    }

    // ── (F4) OPEN MESH: boundary edges are always features ────────────────────
    std::printf("\n[F4] open flat plane patch: boundary edges always feature; flat interior not\n");
    bool f4 = false;
    {
        double L = 3.0; int n = 6;
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        planePatch(L, n, pos, idx);
        FeatureSet fs = detectFeatureEdges(pos, idx);   // 30 deg
        check(fs.ok, "[F4] plane detect ok=true (reason='%s')", fs.reason);
        if (fs.ok) {
            std::uint32_t perim = 4u * static_cast<std::uint32_t>(n);  // boundary edges
            // interior of a FLAT patch is coplanar everywhere -> only the boundary
            // edges are features.
            check(fs.numBoundaryEdges == perim, "[F4] boundary edges == perimeter (%u == %u)", fs.numBoundaryEdges, perim);
            check(fs.numFeatureEdges == perim, "[F4] feature edges == boundary edges (flat interior) (%u == %u)", fs.numFeatureEdges, perim);

            // Every feature edge that is a boundary edge is always a feature
            // regardless of threshold: re-run at the maximum threshold (180 deg).
            FeatureSet hi = detectFeatureEdges(pos, idx, 180.0);
            check(hi.ok && hi.numBoundaryEdges == perim && hi.numFeatureEdges == perim,
                  "[F4] boundary edges remain features even at thr=180 (%u feature)", hi.ok ? hi.numFeatureEdges : 0u);

            // The boundary loop forms a closed CREASE ring: each of the 4 plane
            // corners sits on exactly 2 boundary feature edges -> CREASE; the rest
            // of the perimeter vertices likewise sit on 2 -> all CREASE, 0 CORNER.
            check(fs.numCornerVertices == 0, "[F4] flat patch has 0 corner vertices (%u)", fs.numCornerVertices);
            std::uint32_t boundaryVerts = 4u * static_cast<std::uint32_t>(n);  // perimeter vertex count
            check(fs.numCreaseVertices == boundaryVerts,
                  "[F4] every perimeter vertex is a CREASE (2 boundary edges) (%u == %u)", fs.numCreaseVertices, boundaryVerts);

            f4 = (fs.numBoundaryEdges == perim) && (fs.numFeatureEdges == perim) &&
                 hi.ok && (hi.numFeatureEdges == perim) &&
                 (fs.numCornerVertices == 0) && (fs.numCreaseVertices == boundaryVerts);
        }
    }

    // ── (F5) 0-FAKES: degenerate / unsupported inputs return ok=false ─────────
    std::printf("\n[F5] 0-FAKES — degenerate / unsupported inputs must return ok=false\n");
    {
        // (a) empty soup
        std::vector<double> ep; std::vector<std::uint32_t> ei;
        FeatureSet ra = detectFeatureEdges(ep, ei);
        check(!ra.ok && ra.edges.empty(), "[F5a] empty soup -> ok=false (reason='%s')", ra.reason);

        // (b) indices not a multiple of 3
        std::vector<double> bp = { 0,0,0, 1,0,0, 0,1,0 };
        std::vector<std::uint32_t> bi = { 0,1 };
        FeatureSet rb = detectFeatureEdges(bp, bi);
        check(!rb.ok, "[F5b] indices length not multiple of 3 -> ok=false (reason='%s')", rb.reason);

        // (c) non-finite (NaN) coordinate
        std::vector<double> np; std::vector<std::uint32_t> ni;
        unitCube(np, ni);
        np[0] = std::nan("");
        FeatureSet rc = detectFeatureEdges(np, ni);
        check(!rc.ok && rc.edges.empty(), "[F5c] NaN coordinate -> ok=false (reason='%s')", rc.reason);

        // (d) non-manifold soup: two triangles sharing the SAME directed edge.
        std::vector<double> dp = { 0,0,0, 1,0,0, 0,1,0, 0,0,1 };
        std::vector<std::uint32_t> di = { 0,1,2, 0,1,3 };
        FeatureSet rdn = detectFeatureEdges(dp, di);
        check(!rdn.ok && rdn.edges.empty(), "[F5d] non-manifold soup -> ok=false (reason='%s')", rdn.reason);

        // (e) zero-area (degenerate) triangle inside an otherwise-closed soup.
        // Three collinear vertices form a closed degenerate "sliver" tetra-like
        // mesh; the kernel either rejects at build OR detect rejects the 0 area.
        std::vector<double> sp = { 0,0,0, 1,0,0, 2,0,0, 0,0,1 };
        std::vector<std::uint32_t> si = { 0,1,3, 1,2,3, 2,0,3, 0,2,1 };  // 0,1,2 collinear face
        FeatureSet re = detectFeatureEdges(sp, si);
        check(!re.ok && re.edges.empty(), "[F5e] zero-area triangle -> ok=false (reason='%s')", re.reason);

        // (f) threshold outside [0,180]
        std::vector<double> cp; std::vector<std::uint32_t> ci; unitCube(cp, ci);
        FeatureSet rf1 = detectFeatureEdges(cp, ci, -1.0);
        FeatureSet rf2 = detectFeatureEdges(cp, ci, 181.0);
        check(!rf1.ok && !rf2.ok, "[F5f] threshold out of [0,180] -> ok=false (neg='%s' big='%s')", rf1.reason, rf2.reason);
    }

    std::printf("\n=== HEADLINE: F1(cube)=%s F2(icosphere)=%s F3(monotone)=%s F4(open)=%s ===\n",
                f1?"PASS":"FAIL", f2?"PASS":"FAIL", f3?"PASS":"FAIL", f4?"PASS":"FAIL");
    std::printf("=== ENVELOPE: sharp-feature detection on a 2-manifold(-with-boundary) triangle mesh:\n");
    std::printf("===   per undirected edge, dihedral = atan2(|n0 x n1|, n0.n1) in [0,180] deg between the\n");
    std::printf("===   two OUTWARD incident face normals; a manifold edge is a feature when dihedral >\n");
    std::printf("===   threshold (default 30 deg), a boundary edge (1 incident face) is ALWAYS a feature.\n");
    std::printf("===   Vertices: >=3 incident feature edges -> CORNER, exactly 2 -> CREASE. A 12-triangle\n");
    std::printf("===   cube reports EXACTLY its 12 sharp (90 deg) edges + 8 corners (6 face-diagonals are\n");
    std::printf("===   coplanar, NOT features); a smooth icosphere reports ~0 feature edges at 30 deg;\n");
    std::printf("===   the feature-edge count is monotonically NON-INCREASING in the threshold (exact, no\n");
    std::printf("===   tuned tol). Degenerate/non-manifold/non-finite/out-of-range inputs return ok=false\n");
    std::printf("===   (0 fakes). Pose-invariant (random rotation+scale+translation each run). ===\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
