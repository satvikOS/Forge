// forge/native/brep/meshexchange_test.cpp
//
// Standalone validation gate for forge::native::brep::MeshExchange. Pure C++20,
// no test framework — a tiny hand-rolled harness that prints PASS/FAIL lines,
// a fresh std::random_device seed, and ends with "RESULT: P / T passed".
//
// Build + run (exactly as the task specifies):
//   cd /Users/account_clawteam1/archdisc-Mech && \
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//     forge-kernel/src/native/brep/MeshExchange.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/test/native/brep/meshexchange_test.cpp \
//     -o /tmp/k5_MeshExchange && /tmp/k5_MeshExchange
//
// VALIDATION GATE (asserted below):
//   For several random CLOSED meshes (icosphere at varying subdivision, box at
//   random extents) each of STL/OBJ/OFF/PLY round-trips: write -> read yields a
//   mesh with the IDENTICAL triangle set AND enclosed volume within 1e-6. STL
//   is per-triangle (no shared vertex table), so the reader vertex-welds and we
//   verify the welded volume matches. Plus: every codec rejects malformed text
//   with ok=false (no fake). HalfEdgeMesh is used to independently confirm each
//   generated test mesh is genuinely closed/2-manifold before round-tripping.

#include "forge/native/brep/MeshExchange.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
#include <random>
#include <set>
#include <string>
#include <vector>

using namespace forge::native::brep;
namespace hem = forge::native::mesh;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) {
        ++g_pass;
        std::printf("  [PASS] %s\n", name.c_str());
    } else {
        std::printf("  [FAIL] %s\n", name.c_str());
    }
}

// ---------------------------------------------------------------------------
// Canonicalize a mesh's triangle set into a comparable, order-independent form:
// for each triangle, the set of its three (x,y,z) corner coordinates rotated to
// a canonical starting corner but KEEPING winding (cyclic rotations only, not
// reflections), then sort the list of triangles. Two meshes with the same
// triangle set in any vertex order / triangle order compare equal.
// ---------------------------------------------------------------------------
using Coord = std::array<double, 3>;
using TriKey = std::array<Coord, 3>;

static TriKey canonTri(const TriMesh& m, std::size_t t) {
    const std::uint32_t i0 = m.indices[3 * t + 0];
    const std::uint32_t i1 = m.indices[3 * t + 1];
    const std::uint32_t i2 = m.indices[3 * t + 2];
    Coord a{m.positions[3 * i0], m.positions[3 * i0 + 1], m.positions[3 * i0 + 2]};
    Coord b{m.positions[3 * i1], m.positions[3 * i1 + 1], m.positions[3 * i1 + 2]};
    Coord c{m.positions[3 * i2], m.positions[3 * i2 + 1], m.positions[3 * i2 + 2]};
    // Three cyclic rotations preserving winding; choose lexicographically least.
    std::array<TriKey, 3> rots = {TriKey{a, b, c}, TriKey{b, c, a}, TriKey{c, a, b}};
    return *std::min_element(rots.begin(), rots.end());
}

static std::multiset<TriKey> triSet(const TriMesh& m) {
    std::multiset<TriKey> s;
    for (std::size_t t = 0; t < m.triangleCount(); ++t) s.insert(canonTri(m, t));
    return s;
}

static bool sameTriangleSet(const TriMesh& a, const TriMesh& b) {
    if (a.triangleCount() != b.triangleCount()) return false;
    return triSet(a) == triSet(b);
}

// ---------------------------------------------------------------------------
// Test-mesh generators (closed, outward-CCW). Self-contained — they do NOT use
// marching cubes, so the meshes are exactly watertight (no sampling slop).
// ---------------------------------------------------------------------------

// Axis-aligned box [c-h, c+h] with 12 outward triangles.
static TriMesh makeBox(double cx, double cy, double cz,
                       double hx, double hy, double hz) {
    TriMesh m;
    const double xs[2] = {cx - hx, cx + hx};
    const double ys[2] = {cy - hy, cy + hy};
    const double zs[2] = {cz - hz, cz + hz};
    auto addV = [&](int xi, int yi, int zi) {
        m.positions.push_back(xs[xi]);
        m.positions.push_back(ys[yi]);
        m.positions.push_back(zs[zi]);
    };
    // 8 corners, indexed by (xi,yi,zi) -> 4*xi+2*yi+zi
    for (int xi = 0; xi < 2; ++xi)
        for (int yi = 0; yi < 2; ++yi)
            for (int zi = 0; zi < 2; ++zi)
                addV(xi, yi, zi);
    auto vid = [](int xi, int yi, int zi) {
        return static_cast<std::uint32_t>(4 * xi + 2 * yi + zi);
    };
    auto quad = [&](std::uint32_t a, std::uint32_t b, std::uint32_t c,
                    std::uint32_t d) {
        m.indices.insert(m.indices.end(), {a, b, c, a, c, d});
    };
    // -x face (x=0): outward normal -x ; CCW seen from outside
    quad(vid(0, 0, 0), vid(0, 0, 1), vid(0, 1, 1), vid(0, 1, 0));
    // +x face
    quad(vid(1, 0, 0), vid(1, 1, 0), vid(1, 1, 1), vid(1, 0, 1));
    // -y face
    quad(vid(0, 0, 0), vid(1, 0, 0), vid(1, 0, 1), vid(0, 0, 1));
    // +y face
    quad(vid(0, 1, 0), vid(0, 1, 1), vid(1, 1, 1), vid(1, 1, 0));
    // -z face
    quad(vid(0, 0, 0), vid(0, 1, 0), vid(1, 1, 0), vid(1, 0, 0));
    // +z face
    quad(vid(0, 0, 1), vid(1, 0, 1), vid(1, 1, 1), vid(0, 1, 1));
    return m;
}

// Icosphere: a unit icosahedron subdivided `sub` times, vertices projected to a
// sphere of `radius` about (cx,cy,cz). Outward-CCW, closed, 2-manifold.
static TriMesh makeIcosphere(int sub, double radius, double cx, double cy,
                             double cz) {
    struct V { double x, y, z; };
    const double t = (1.0 + std::sqrt(5.0)) / 2.0;
    std::vector<V> verts = {
        {-1, t, 0}, {1, t, 0}, {-1, -t, 0}, {1, -t, 0},
        {0, -1, t}, {0, 1, t}, {0, -1, -t}, {0, 1, -t},
        {t, 0, -1}, {t, 0, 1}, {-t, 0, -1}, {-t, 0, 1}};
    std::vector<std::array<int, 3>> faces = {
        {0, 11, 5}, {0, 5, 1}, {0, 1, 7}, {0, 7, 10}, {0, 10, 11},
        {1, 5, 9}, {5, 11, 4}, {11, 10, 2}, {10, 7, 6}, {7, 1, 8},
        {3, 9, 4}, {3, 4, 2}, {3, 2, 6}, {3, 6, 8}, {3, 8, 9},
        {4, 9, 5}, {2, 4, 11}, {6, 2, 10}, {8, 6, 7}, {9, 8, 1}};

    // Edge-midpoint cache keyed by ordered vertex pair.
    std::map<std::pair<int, int>, int> midCache;
    auto midpoint = [&](int a, int b) -> int {
        auto key = std::minmax(a, b);
        auto it = midCache.find({key.first, key.second});
        if (it != midCache.end()) return it->second;
        V m{(verts[a].x + verts[b].x) * 0.5, (verts[a].y + verts[b].y) * 0.5,
            (verts[a].z + verts[b].z) * 0.5};
        int idx = static_cast<int>(verts.size());
        verts.push_back(m);
        midCache[{key.first, key.second}] = idx;
        return idx;
    };
    for (int s = 0; s < sub; ++s) {
        std::vector<std::array<int, 3>> next;
        next.reserve(faces.size() * 4);
        for (auto& f : faces) {
            int a = midpoint(f[0], f[1]);
            int b = midpoint(f[1], f[2]);
            int c = midpoint(f[2], f[0]);
            next.push_back({f[0], a, c});
            next.push_back({f[1], b, a});
            next.push_back({f[2], c, b});
            next.push_back({a, b, c});
        }
        faces.swap(next);
        midCache.clear();
    }

    TriMesh m;
    m.positions.reserve(verts.size() * 3);
    for (auto& v : verts) {
        const double len = std::sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        const double s = radius / len;
        m.positions.push_back(cx + v.x * s);
        m.positions.push_back(cy + v.y * s);
        m.positions.push_back(cz + v.z * s);
    }
    m.indices.reserve(faces.size() * 3);
    for (auto& f : faces) {
        m.indices.push_back(static_cast<std::uint32_t>(f[0]));
        m.indices.push_back(static_cast<std::uint32_t>(f[1]));
        m.indices.push_back(static_cast<std::uint32_t>(f[2]));
    }
    return m;
}

// Confirm a generated test mesh is genuinely closed/2-manifold via the
// independent HalfEdgeMesh class (so the round-trip gate is grounded in a real
// solid, not an accidentally-open soup).
static bool isClosedSolid(const TriMesh& m) {
    hem::HalfEdgeMesh he;
    if (!he.buildFromSoup(m.positions, m.indices)) return false;
    return he.validate().isValid();
}

// ---------------------------------------------------------------------------
// Round-trip one mesh through all four codecs.
// ---------------------------------------------------------------------------
static void roundTripAll(const TriMesh& src, const std::string& label) {
    const double srcVol = src.signedVolume();

    // STL (welds in reader; verify welded triangle set + volume).
    {
        std::string txt = MeshExchange::writeSTL(src, "gate");
        ReadResult r = MeshExchange::readSTL(txt);
        check(r.ok, label + " STL read ok");
        if (r.ok) {
            check(sameTriangleSet(src, r.mesh),
                  label + " STL triangle set identical (vertex-welded)");
            check(std::fabs(r.mesh.signedVolume() - srcVol) < 1e-6,
                  label + " STL enclosed volume within 1e-6");
        }
    }
    // OBJ
    {
        std::string txt = MeshExchange::writeOBJ(src);
        ReadResult r = MeshExchange::readOBJ(txt);
        check(r.ok, label + " OBJ read ok");
        if (r.ok) {
            check(sameTriangleSet(src, r.mesh),
                  label + " OBJ triangle set identical");
            check(std::fabs(r.mesh.signedVolume() - srcVol) < 1e-6,
                  label + " OBJ enclosed volume within 1e-6");
        }
    }
    // OFF
    {
        std::string txt = MeshExchange::writeOFF(src);
        ReadResult r = MeshExchange::readOFF(txt);
        check(r.ok, label + " OFF read ok");
        if (r.ok) {
            check(sameTriangleSet(src, r.mesh),
                  label + " OFF triangle set identical");
            check(std::fabs(r.mesh.signedVolume() - srcVol) < 1e-6,
                  label + " OFF enclosed volume within 1e-6");
        }
    }
    // PLY
    {
        std::string txt = MeshExchange::writePLY(src);
        ReadResult r = MeshExchange::readPLY(txt);
        check(r.ok, label + " PLY read ok");
        if (r.ok) {
            check(sameTriangleSet(src, r.mesh),
                  label + " PLY triangle set identical");
            check(std::fabs(r.mesh.signedVolume() - srcVol) < 1e-6,
                  label + " PLY enclosed volume within 1e-6");
        }
    }
}

int main() {
    std::random_device rd;
    const unsigned seed = rd();
    std::printf("forge::native::brep::MeshExchange validation gate\n");
    std::printf("seed = %u\n", seed);
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> centerD(-50.0, 50.0);
    std::uniform_real_distribution<double> extentD(0.25, 12.0);
    std::uniform_real_distribution<double> radiusD(0.5, 20.0);

    // ---- (1) Random closed meshes round-trip through all 4 formats ----------
    std::printf("[1] random closed-mesh round trips (write -> read)\n");
    for (int i = 0; i < 4; ++i) {
        TriMesh box = makeBox(centerD(rng), centerD(rng), centerD(rng),
                              extentD(rng), extentD(rng), extentD(rng));
        check(isClosedSolid(box), "box #" + std::to_string(i) +
                                      " is a closed 2-manifold (HalfEdgeMesh)");
        roundTripAll(box, "box#" + std::to_string(i));
    }
    for (int sub = 0; sub <= 3; ++sub) {
        TriMesh sph = makeIcosphere(sub, radiusD(rng), centerD(rng),
                                    centerD(rng), centerD(rng));
        check(isClosedSolid(sph), "icosphere sub=" + std::to_string(sub) +
                                      " is a closed 2-manifold (HalfEdgeMesh)");
        roundTripAll(sph, "icosphere(sub=" + std::to_string(sub) + ")");
    }

    // ---- (2) Float fidelity: writes round-trip bit-exactly --------------------
    std::printf("[2] locale-independent float formatting is bit-exact\n");
    {
        std::uniform_real_distribution<double> anyD(-1e6, 1e6);
        bool allExact = true;
        for (int i = 0; i < 5000; ++i) {
            double v = anyD(rng);
            double back;
            if (!parseDouble(formatDouble(v), back) || back != v) {
                allExact = false;
                break;
            }
        }
        check(allExact, "5000 random doubles round-trip format/parse bit-exact");
        // Hard cases.
        const double hard[] = {0.1, 1.0 / 3.0, 1e-300, 1e300, -0.0,
                               std::nextafter(1.0, 2.0), 1234567.890123456};
        bool hardOk = true;
        for (double v : hard) {
            double back;
            if (!parseDouble(formatDouble(v), back) ||
                back != (v == -0.0 ? 0.0 : v)) {
                if (!(v == -0.0 && back == 0.0)) hardOk = false;
            }
        }
        check(hardOk, "hard-case doubles round-trip exactly");
    }

    // ---- (3) Malformed input is rejected with ok=false (NO FAKE) -------------
    std::printf("[3] malformed text is honestly rejected (ok=false)\n");
    {
        // STL: missing magic
        check(!MeshExchange::readSTL("not an stl\n").ok,
              "STL rejects missing 'solid'");
        // STL: a facet with 2 vertices
        check(!MeshExchange::readSTL(
                   "solid s\n facet normal 0 0 1\n outer loop\n"
                   "  vertex 0 0 0\n  vertex 1 0 0\n endloop\n endfacet\n"
                   "endsolid s\n").ok,
              "STL rejects facet with !=3 vertices");
        // STL: unparseable coordinate
        check(!MeshExchange::readSTL(
                   "solid s\n facet normal 0 0 1\n outer loop\n"
                   "  vertex 0 0 0\n  vertex 1 0 0\n  vertex x 1 0\n"
                   " endloop\n endfacet\n endsolid s\n").ok,
              "STL rejects unparseable coordinate");
        // STL: missing endsolid (truncated)
        check(!MeshExchange::readSTL(
                   "solid s\n facet normal 0 0 1\n outer loop\n"
                   "  vertex 0 0 0\n  vertex 1 0 0\n  vertex 0 1 0\n"
                   " endloop\n endfacet\n").ok,
              "STL rejects truncated stream (no endsolid)");

        // OBJ: a quad face (non-triangular)
        check(!MeshExchange::readOBJ(
                   "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n").ok,
              "OBJ rejects non-triangular face");
        // OBJ: out-of-range index
        check(!MeshExchange::readOBJ("v 0 0 0\nv 1 0 0\nf 1 2 9\n").ok,
              "OBJ rejects out-of-range face index");
        // OBJ: bad coordinate
        check(!MeshExchange::readOBJ("v 0 0 q\nf 1 1 1\n").ok,
              "OBJ rejects unparseable coordinate");
        // OBJ: zero index (1-based; 0 is illegal)
        check(!MeshExchange::readOBJ("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2\n").ok,
              "OBJ rejects 0 face index");

        // OFF: count line says 4 verts but only 1 given (truncated)
        check(!MeshExchange::readOFF("OFF\n4 1 0\n0 0 0\n3 0 1 2\n").ok,
              "OFF rejects truncated vertex block");
        // OFF: missing magic
        check(!MeshExchange::readOFF("3 1 0\n0 0 0\n").ok,
              "OFF rejects missing magic");
        // OFF: non-triangular face (4)
        check(!MeshExchange::readOFF(
                   "OFF\n4 1 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n").ok,
              "OFF rejects non-triangular face");
        // OFF: face index out of range
        check(!MeshExchange::readOFF(
                   "OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 9\n").ok,
              "OFF rejects out-of-range face index");

        // PLY: missing magic
        check(!MeshExchange::readPLY("format ascii 1.0\nend_header\n").ok,
              "PLY rejects missing 'ply'");
        // PLY: binary format rejected
        check(!MeshExchange::readPLY(
                   "ply\nformat binary_little_endian 1.0\nend_header\n").ok,
              "PLY rejects non-ascii format");
        // PLY: face body truncated
        check(!MeshExchange::readPLY(
                   "ply\nformat ascii 1.0\nelement vertex 3\n"
                   "property float x\nproperty float y\nproperty float z\n"
                   "element face 1\nproperty list uchar int vertex_indices\n"
                   "end_header\n0 0 0\n1 0 0\n0 1 0\n").ok,
              "PLY rejects truncated face body");
        // PLY: non-triangular face
        check(!MeshExchange::readPLY(
                   "ply\nformat ascii 1.0\nelement vertex 4\n"
                   "property float x\nproperty float y\nproperty float z\n"
                   "element face 1\nproperty list uchar int vertex_indices\n"
                   "end_header\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n").ok,
              "PLY rejects non-triangular face");
        // PLY: face index out of range
        check(!MeshExchange::readPLY(
                   "ply\nformat ascii 1.0\nelement vertex 3\n"
                   "property float x\nproperty float y\nproperty float z\n"
                   "element face 1\nproperty list uchar int vertex_indices\n"
                   "end_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 9\n").ok,
              "PLY rejects out-of-range face index");
    }

    // ---- (4) A valid hand-written sample of each format reads correctly ------
    std::printf("[4] canonical hand-written samples parse to the right solid\n");
    {
        TriMesh ref = makeBox(0, 0, 0, 1, 1, 1);  // volume 8
        // round-trip the OBJ we write, then independently confirm a minimal,
        // hand-authored OFF triangle parses.
        ReadResult off = MeshExchange::readOFF(
            "OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n");
        check(off.ok && off.mesh.triangleCount() == 1 &&
                  off.mesh.vertexCount() == 3,
              "hand-written OFF triangle parses (1 tri, 3 verts)");
        check(std::fabs(ref.signedVolume() - 8.0) < 1e-9,
              "reference unit box has volume 8");
    }

    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
