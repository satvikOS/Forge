// forge/native/brep/stepfaceted_test.cpp
//
// Standalone validation gate for forge::native::brep::StepFaceted. Pure C++20,
// no test framework — a tiny hand-rolled harness that prints PASS/FAIL lines, a
// fresh std::random_device seed, and ends with "RESULT: P / T passed".
//
// Build + run (exactly as the task specifies):
//   cd /Users/account_clawteam1/archdisc-Mech && \
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//     forge-kernel/src/native/brep/StepFaceted.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/test/native/brep/stepfaceted_test.cpp \
//     -o /tmp/k6_StepFaceted && /tmp/k6_StepFaceted
//
// VALIDATION GATE (asserted below) — this is a FACETED / tessellated STEP, NOT
// analytic B-rep surfaces (the module says so, and so do we):
//   * write(mesh) produces a well-formed ISO-10303-21 document: it contains the
//     ISO-10303-21; / END-ISO-10303-21; envelope, a HEADER; ... ENDSEC; block
//     with FILE_DESCRIPTION/FILE_NAME/FILE_SCHEMA, a DATA; ... ENDSEC; block,
//     and the RIGHT entity counts: one CARTESIAN_POINT + one VERTEX_POINT per
//     vertex and one ADVANCED_FACE per triangle, all wrapped by a CLOSED_SHELL
//     in a MANIFOLD_SOLID_BREP.
//   * read(write(mesh)) recovers a mesh with the IDENTICAL triangle set and the
//     same enclosed volume within 1e-6, for several random CLOSED solids.
//   * malformed STEP -> ok=false (no fake): broken envelope, missing section,
//     dangling reference, non-triangular loop, out-of-range / non-finite point,
//     truncated stream. write() of a degenerate mesh -> ok=false.
//   HalfEdgeMesh independently confirms each generated test solid is genuinely
//   closed / 2-manifold before the round trip, so the gate is grounded in a real
//   solid rather than an accidentally-open soup.

#include <limits>
#include "forge/native/brep/StepFaceted.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
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
// Count NON-OVERLAPPING occurrences of `needle` in `hay`.
// ---------------------------------------------------------------------------
static std::size_t countOccurrences(const std::string& hay,
                                    const std::string& needle) {
    if (needle.empty()) return 0;
    std::size_t n = 0, pos = 0;
    while ((pos = hay.find(needle, pos)) != std::string::npos) {
        ++n;
        pos += needle.size();
    }
    return n;
}

// ---------------------------------------------------------------------------
// Canonicalize a mesh's triangle set into a comparable, order-independent form:
// per triangle, the three (x,y,z) corners cyclically rotated to the
// lexicographically least start (winding preserved, reflections NOT), then a
// multiset over all triangles. Equal multisets <=> same triangle set in any
// vertex / triangle order.
// ---------------------------------------------------------------------------
using Coord = std::array<double, 3>;
using TriKey = std::array<Coord, 3>;

static TriKey canonTri(const StepMesh& m, std::size_t t) {
    const std::uint32_t i0 = m.indices[3 * t + 0];
    const std::uint32_t i1 = m.indices[3 * t + 1];
    const std::uint32_t i2 = m.indices[3 * t + 2];
    Coord a{m.positions[3 * i0], m.positions[3 * i0 + 1], m.positions[3 * i0 + 2]};
    Coord b{m.positions[3 * i1], m.positions[3 * i1 + 1], m.positions[3 * i1 + 2]};
    Coord c{m.positions[3 * i2], m.positions[3 * i2 + 1], m.positions[3 * i2 + 2]};
    std::array<TriKey, 3> rots = {TriKey{a, b, c}, TriKey{b, c, a}, TriKey{c, a, b}};
    return *std::min_element(rots.begin(), rots.end());
}

static std::multiset<TriKey> triSet(const StepMesh& m) {
    std::multiset<TriKey> s;
    for (std::size_t t = 0; t < m.triangleCount(); ++t) s.insert(canonTri(m, t));
    return s;
}

static bool sameTriangleSet(const StepMesh& a, const StepMesh& b) {
    if (a.triangleCount() != b.triangleCount()) return false;
    return triSet(a) == triSet(b);
}

// ---------------------------------------------------------------------------
// Test-mesh generators (closed, outward-CCW). Self-contained — no marching
// cubes, so the meshes are exactly watertight (no sampling slop).
// ---------------------------------------------------------------------------

// Axis-aligned box [c-h, c+h] with 12 outward triangles.
static StepMesh makeBox(double cx, double cy, double cz,
                        double hx, double hy, double hz) {
    StepMesh m;
    const double xs[2] = {cx - hx, cx + hx};
    const double ys[2] = {cy - hy, cy + hy};
    const double zs[2] = {cz - hz, cz + hz};
    auto addV = [&](int xi, int yi, int zi) {
        m.positions.push_back(xs[xi]);
        m.positions.push_back(ys[yi]);
        m.positions.push_back(zs[zi]);
    };
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
    quad(vid(0, 0, 0), vid(0, 0, 1), vid(0, 1, 1), vid(0, 1, 0));  // -x
    quad(vid(1, 0, 0), vid(1, 1, 0), vid(1, 1, 1), vid(1, 0, 1));  // +x
    quad(vid(0, 0, 0), vid(1, 0, 0), vid(1, 0, 1), vid(0, 0, 1));  // -y
    quad(vid(0, 1, 0), vid(0, 1, 1), vid(1, 1, 1), vid(1, 1, 0));  // +y
    quad(vid(0, 0, 0), vid(0, 1, 0), vid(1, 1, 0), vid(1, 0, 0));  // -z
    quad(vid(0, 0, 1), vid(1, 0, 1), vid(1, 1, 1), vid(0, 1, 1));  // +z
    return m;
}

// Icosphere: unit icosahedron subdivided `sub` times, projected to a sphere of
// `radius` about (cx,cy,cz). Outward-CCW, closed, 2-manifold.
static StepMesh makeIcosphere(int sub, double radius, double cx, double cy,
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

    StepMesh m;
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

// A double tetrahedron (octahedron-like) closed solid, distinct topology from
// box / sphere, to vary the corpus.
static StepMesh makeOctahedron(double r, double cx, double cy, double cz) {
    StepMesh m;
    auto addV = [&](double x, double y, double z) {
        m.positions.push_back(cx + x);
        m.positions.push_back(cy + y);
        m.positions.push_back(cz + z);
    };
    addV(r, 0, 0); addV(-r, 0, 0);   // 0,1  +-x
    addV(0, r, 0); addV(0, -r, 0);   // 2,3  +-y
    addV(0, 0, r); addV(0, 0, -r);   // 4,5  +-z
    auto tri = [&](std::uint32_t a, std::uint32_t b, std::uint32_t c) {
        m.indices.push_back(a); m.indices.push_back(b); m.indices.push_back(c);
    };
    // Outward-CCW faces of a regular octahedron.
    tri(0, 2, 4); tri(2, 1, 4); tri(1, 3, 4); tri(3, 0, 4);
    tri(2, 0, 5); tri(1, 2, 5); tri(3, 1, 5); tri(0, 3, 5);
    return m;
}

// Confirm a generated test mesh is genuinely closed / 2-manifold via the
// independent HalfEdgeMesh class.
static bool isClosedSolid(const StepMesh& m) {
    hem::HalfEdgeMesh he;
    if (!he.buildFromSoup(m.positions, m.indices)) return false;
    return he.validate().isValid();
}

// ---------------------------------------------------------------------------
// Validate the STEP document is well-formed and carries the right counts.
// ---------------------------------------------------------------------------
static void checkHeaderWellFormed(const std::string& step, const StepMesh& src,
                                  const std::string& label) {
    const std::size_t vc = src.vertexCount();
    const std::size_t tc = src.triangleCount();

    check(step.rfind("ISO-10303-21;", 0) == 0,
          label + " begins with ISO-10303-21;");
    check(step.find("END-ISO-10303-21;") != std::string::npos,
          label + " ends the ISO envelope (END-ISO-10303-21;)");
    check(step.find("HEADER;") != std::string::npos,
          label + " has a HEADER; section");
    check(step.find("FILE_DESCRIPTION(") != std::string::npos,
          label + " HEADER has FILE_DESCRIPTION");
    check(step.find("FILE_NAME(") != std::string::npos,
          label + " HEADER has FILE_NAME");
    check(step.find("FILE_SCHEMA(") != std::string::npos,
          label + " HEADER has FILE_SCHEMA");
    check(step.find("DATA;") != std::string::npos,
          label + " has a DATA; section");
    // Two ENDSEC; (one closing HEADER, one closing DATA).
    check(countOccurrences(step, "ENDSEC;") == 2,
          label + " has exactly two ENDSEC; (HEADER + DATA)");
    // Honest self-description: this is a faceted/tessellated, NOT analytic, STEP.
    check(step.find("NOT analytic B-rep surfaces") != std::string::npos,
          label + " self-declares faceted (NOT analytic B-rep)");

    // Entity counts.
    check(countOccurrences(step, "=CARTESIAN_POINT(") == vc + tc,
          label + " CARTESIAN_POINT count == vertices + triangles "
                  "(one origin point per face)");
    check(countOccurrences(step, "=VERTEX_POINT(") == vc,
          label + " VERTEX_POINT count == vertex count");
    check(countOccurrences(step, "=ADVANCED_FACE(") == tc,
          label + " ADVANCED_FACE count == triangle count");
    check(countOccurrences(step, "=EDGE_LOOP(") == tc,
          label + " EDGE_LOOP count == triangle count");
    check(countOccurrences(step, "=FACE_OUTER_BOUND(") == tc,
          label + " FACE_OUTER_BOUND count == triangle count");
    check(countOccurrences(step, "=ORIENTED_EDGE(") == 3 * tc,
          label + " ORIENTED_EDGE count == 3 * triangle count");
    check(countOccurrences(step, "=CLOSED_SHELL(") == 1,
          label + " exactly one CLOSED_SHELL");
    check(countOccurrences(step, "=MANIFOLD_SOLID_BREP(") == 1,
          label + " exactly one MANIFOLD_SOLID_BREP");
}

// ---------------------------------------------------------------------------
// Round-trip one mesh: write -> validate header -> read -> compare.
// ---------------------------------------------------------------------------
static void roundTrip(const StepMesh& src, const std::string& label) {
    const double srcVol = src.signedVolume();

    WriteResult w = StepFaceted::write(src, "gate_" + label);
    check(w.ok, label + " write ok");
    if (!w.ok) return;

    checkHeaderWellFormed(w.text, src, label);

    ReadStepResult r = StepFaceted::read(w.text);
    check(r.ok, label + " read(write(mesh)) ok");
    if (!r.ok) {
        std::printf("        (read reason: %s)\n", r.reason.c_str());
        return;
    }
    check(sameTriangleSet(src, r.mesh),
          label + " recovered triangle set is IDENTICAL");
    check(std::fabs(r.mesh.signedVolume() - srcVol) < 1e-6,
          label + " recovered enclosed volume within 1e-6");

    // Idempotent: re-writing the recovered mesh and reading again is stable.
    WriteResult w2 = StepFaceted::write(r.mesh, "gate2_" + label);
    check(w2.ok, label + " re-write ok");
    if (w2.ok) {
        ReadStepResult r2 = StepFaceted::read(w2.text);
        check(r2.ok && sameTriangleSet(r.mesh, r2.mesh),
              label + " second round-trip is stable");
    }
}

int main() {
    std::random_device rd;
    const unsigned seed = rd();
    std::printf("forge::native::brep::StepFaceted validation gate\n");
    std::printf("seed = %u\n", seed);
    std::printf("(faceted / tessellated STEP AP242 — NOT analytic B-rep "
                "surfaces)\n");
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> centerD(-50.0, 50.0);
    std::uniform_real_distribution<double> extentD(0.25, 12.0);
    std::uniform_real_distribution<double> radiusD(0.5, 20.0);

    // ---- (1) Random closed solids round-trip through faceted STEP ------------
    std::printf("[1] random closed-solid STEP round trips (write -> read)\n");
    for (int i = 0; i < 4; ++i) {
        StepMesh box = makeBox(centerD(rng), centerD(rng), centerD(rng),
                               extentD(rng), extentD(rng), extentD(rng));
        check(isClosedSolid(box), "box #" + std::to_string(i) +
                                      " is a closed 2-manifold (HalfEdgeMesh)");
        roundTrip(box, "box" + std::to_string(i));
    }
    for (int i = 0; i < 2; ++i) {
        StepMesh oct = makeOctahedron(radiusD(rng), centerD(rng), centerD(rng),
                                      centerD(rng));
        check(isClosedSolid(oct), "octahedron #" + std::to_string(i) +
                                      " is a closed 2-manifold (HalfEdgeMesh)");
        roundTrip(oct, "oct" + std::to_string(i));
    }
    for (int sub = 0; sub <= 2; ++sub) {
        StepMesh sph = makeIcosphere(sub, radiusD(rng), centerD(rng),
                                     centerD(rng), centerD(rng));
        check(isClosedSolid(sph), "icosphere sub=" + std::to_string(sub) +
                                      " is a closed 2-manifold (HalfEdgeMesh)");
        roundTrip(sph, "icosphere_sub" + std::to_string(sub));
    }

    // ---- (2) Float fidelity: writes round-trip bit-exactly -------------------
    std::printf("[2] locale-independent float formatting is bit-exact\n");
    {
        std::uniform_real_distribution<double> anyD(-1e6, 1e6);
        bool allExact = true;
        for (int i = 0; i < 5000; ++i) {
            double v = anyD(rng);
            double back;
            if (!stepParseDouble(stepFormatDouble(v), back) || back != v) {
                allExact = false;
                break;
            }
        }
        check(allExact, "5000 random doubles round-trip format/parse bit-exact");
        const double hard[] = {0.1, 1.0 / 3.0, 1e-300, 1e300,
                               std::nextafter(1.0, 2.0), 1234567.890123456,
                               3.0, 100.0};
        bool hardOk = true;
        for (double v : hard) {
            double back;
            if (!stepParseDouble(stepFormatDouble(v), back) || back != v) {
                hardOk = false;
                break;
            }
        }
        check(hardOk, "hard-case doubles round-trip exactly");
    }

    // ---- (3) Malformed STEP is honestly rejected (ok=false, NO FAKE) ---------
    std::printf("[3] malformed STEP is honestly rejected (ok=false)\n");
    {
        // A known-good document to mutate.
        StepMesh ref = makeBox(0, 0, 0, 1, 1, 1);
        WriteResult good = StepFaceted::write(ref);
        check(good.ok, "reference box writes ok (for mutation tests)");
        const std::string& g = good.text;

        // Not a STEP file at all.
        check(!StepFaceted::read("this is not a step file\n").ok,
              "rejects non-STEP text");
        // Missing ISO envelope start.
        check(!StepFaceted::read(
                   "HEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n").ok,
              "rejects missing ISO-10303-21; marker");
        // Missing ISO envelope end.
        {
            std::string s = g;
            std::size_t p = s.find("END-ISO-10303-21;");
            if (p != std::string::npos) s.erase(p);
            check(!StepFaceted::read(s).ok,
                  "rejects missing END-ISO-10303-21; marker");
        }
        // Missing DATA section.
        check(!StepFaceted::read(
                   "ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n").ok,
              "rejects missing DATA; section");
        // Empty DATA section (no instances).
        check(!StepFaceted::read(
                   "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\n"
                   "END-ISO-10303-21;\n").ok,
              "rejects empty DATA section (no MANIFOLD_SOLID_BREP)");
        // Dangling reference: the CLOSED_SHELL points at a face id that is gone.
        {
            std::string s = g;
            // Corrupt the shell to reference #999999 (nonexistent).
            std::size_t p = s.find("=CLOSED_SHELL('',(");
            check(p != std::string::npos, "found CLOSED_SHELL to corrupt");
            if (p != std::string::npos) {
                std::size_t open = s.find('(', p + 14);  // the list '('
                std::size_t close = s.find(')', open);
                s.replace(open, close - open + 1, "(#999999)");
                check(!StepFaceted::read(s).ok,
                      "rejects CLOSED_SHELL with a dangling face reference");
            }
        }
        // Non-triangular loop: append a 4th oriented edge into an EDGE_LOOP.
        {
            std::string s = g;
            std::size_t p = s.find("=EDGE_LOOP('',(#");
            check(p != std::string::npos, "found EDGE_LOOP to corrupt");
            if (p != std::string::npos) {
                std::size_t close = s.find("))", p);
                // Insert ",#1" before the closing "))" -> 4 entries.
                s.insert(close, ",#1");
                check(!StepFaceted::read(s).ok,
                      "rejects non-triangular EDGE_LOOP (4 oriented edges)");
            }
        }
        // Out-of-range / corrupted point coordinate -> non-finite.
        {
            std::string s = g;
            std::size_t p = s.find("=CARTESIAN_POINT('',(");
            if (p != std::string::npos) {
                std::size_t open = s.find('(', p + 16);  // coord list '('
                std::size_t close = s.find(')', open);
                s.replace(open, close - open + 1, "(nan,0.,0.)");
                check(!StepFaceted::read(s).ok,
                      "rejects a non-finite (nan) coordinate");
            }
        }
        // Truncated stream: cut the document in half.
        check(!StepFaceted::read(g.substr(0, g.size() / 2)).ok,
              "rejects a truncated stream");
        // Unbalanced parentheses in an instance.
        check(!StepFaceted::read(
                   "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n"
                   "#1=CARTESIAN_POINT('',(0.,0.,0.;\nENDSEC;\n"
                   "END-ISO-10303-21;\n").ok,
              "rejects unbalanced parentheses in an instance");
    }

    // ---- (4) write() of a degenerate mesh is honestly refused ----------------
    std::printf("[4] write() refuses a degenerate / not-well-formed mesh\n");
    {
        StepMesh empty;
        check(!StepFaceted::write(empty).ok, "write rejects an empty mesh");

        StepMesh ragged;
        ragged.positions = {0, 0, 0, 1, 0, 0};      // 2 verts
        ragged.indices = {0, 1, 5};                  // index 5 out of range
        check(!StepFaceted::write(ragged).ok,
              "write rejects an out-of-range index");

        StepMesh nonfinite;
        nonfinite.positions = {0, 0, 0, 1, 0, 0, 0,
                               std::numeric_limits<double>::infinity(), 0};
        nonfinite.indices = {0, 1, 2};
        check(!StepFaceted::write(nonfinite).ok,
              "write rejects a non-finite coordinate");
    }

    // ---- (5) A minimal hand-written single-triangle solid reads correctly ----
    //          (sanity that the parser accepts a manually authored document) ---
    std::printf("[5] hand-written minimal faceted document parses\n");
    {
        // One triangle, three points/vertices, three edges, one face.
        const char* doc =
            "ISO-10303-21;\n"
            "HEADER;\n"
            "FILE_DESCRIPTION(('hand-written faceted'),'2;1');\n"
            "FILE_NAME('t','2026-01-01T00:00:00',(''),(''),'x','y','');\n"
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 442 3 1 4 }'));\n"
            "ENDSEC;\n"
            "DATA;\n"
            "#1=CARTESIAN_POINT('',(0.,0.,0.));\n"
            "#2=CARTESIAN_POINT('',(1.,0.,0.));\n"
            "#3=CARTESIAN_POINT('',(0.,1.,0.));\n"
            "#4=VERTEX_POINT('',#1);\n"
            "#5=VERTEX_POINT('',#2);\n"
            "#6=VERTEX_POINT('',#3);\n"
            "#7=EDGE_CURVE('',#4,#5,*,.T.);\n"
            "#8=EDGE_CURVE('',#5,#6,*,.T.);\n"
            "#9=EDGE_CURVE('',#4,#6,*,.T.);\n"
            "#10=ORIENTED_EDGE('',*,*,#7,.T.);\n"
            "#11=ORIENTED_EDGE('',*,*,#8,.T.);\n"
            "#12=ORIENTED_EDGE('',*,*,#9,.F.);\n"
            "#13=EDGE_LOOP('',(#10,#11,#12));\n"
            "#14=FACE_OUTER_BOUND('',#13,.T.);\n"
            "#15=CARTESIAN_POINT('',(0.,0.,0.));\n"
            "#16=DIRECTION('',(0.,0.,1.));\n"
            "#17=DIRECTION('',(1.,0.,0.));\n"
            "#18=AXIS2_PLACEMENT_3D('',#15,#16,#17);\n"
            "#19=PLANE('',#18);\n"
            "#20=ADVANCED_FACE('',(#14),#19,.T.);\n"
            "#21=CLOSED_SHELL('',(#20));\n"
            "#22=MANIFOLD_SOLID_BREP('t',#21);\n"
            "ENDSEC;\n"
            "END-ISO-10303-21;\n";
        ReadStepResult r = StepFaceted::read(doc);
        check(r.ok, "hand-written single-triangle document parses");
        if (r.ok) {
            check(r.mesh.triangleCount() == 1 && r.mesh.vertexCount() == 3,
                  "hand-written doc yields 1 triangle / 3 vertices");
            // The directed start vertices are (#4 via #7.T -> v0), (#5 via #8.T
            // -> v1), (#6 via #9.F : edge #9 is #4->#6, reversed start is #6 ->
            // v2). So corners are points (0,0,0),(1,0,0),(0,1,0).
            check(std::fabs(std::fabs(r.mesh.signedVolume()) - 0.0) < 1e-12,
                  "single flat triangle encloses ~0 volume (sanity)");
        } else {
            std::printf("        (reason: %s)\n", r.reason.c_str());
        }
    }

    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
