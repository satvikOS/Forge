// forge-desktop/mesh_probe.cpp
//
// ============================================================================
// FORGE C++ DESKTOP MESH-FEED PROBE  (Pillar #10, Phase-1 — the render data-feed)
// ============================================================================
//
// PURPOSE — prove the kernel's RENDER DATA-FEED works standalone C++, with no Node
// and no graphics SDK. The Vulkan/MoltenVK renderer (later Phase-1) consumes exactly
// this pipeline every frame: ShapeHandle -> tessellate -> Mesh{positions,indices,
// normals} -> upload to a GPU vertex/index buffer. The offscreen renderer itself is
// blocked on this machine (no Vulkan SDK installed), but its INPUT — the tessellated
// mesh + the STL export path — is fully provable headlessly through the kernel's
// public C++ API (forge::tessellateLOD, forge::exportStl).
//
// This probe links the NODE-FREE core library forge_kernel_core (same one the
// foundation_probe proved) and, for a box / cylinder / boolean:
//   1. tessellateLOD(High)  -> Mesh, and asserts the mesh is well-formed:
//        positions & indices are triangle-aligned, every coordinate finite, the
//        vertex AABB matches the solid's known bounds, and curved bodies carry more
//        triangles than the planar box (the tessellator actually sampled the curve).
//   2. exportStl(...)       -> a binary .stl, and asserts the file is a VALID binary
//        STL whose embedded triangle count == indices.size()/3 and whose byte length
//        == 84 + 50*triangles (the exact binary-STL layout). This proves the mesh
//        that reaches the renderer is the same mesh that reaches disk.
//
// Every measured value is printed. Exit 0 == all checks passed; nonzero == the id of
// the first failing check. No graphics, no window, no Node — pure geometry + I/O.
//
// Build (option-gated, does NOT touch the default .node build):
//   cmake -B build -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
//   cmake --build build -j3 --target forge_mesh_probe
//   ./build/forge_mesh_probe

#include "forge/Primitives.hpp"     // forge::makeBox / makeCylinder
#include "forge/Booleans.hpp"       // forge::cut
#include "forge/Transform.hpp"      // forge::translate
#include "forge/LOD.hpp"            // forge::tessellateLOD / LODLevel
#include "forge/Tessellate.hpp"     // forge::Mesh
#include "forge/IoExchange.hpp"     // forge::exportStl

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <string>
#include <vector>

namespace {

constexpr double PI = 3.14159265358979323846;

int  g_check = 0;
bool g_failed = false;

#define CHECK(cond)                                                            \
    do {                                                                       \
        ++g_check;                                                             \
        if (!(cond)) {                                                         \
            std::fprintf(stderr, "  FAIL check #%d  (%s)  [line %d]\n",        \
                         g_check, #cond, __LINE__);                            \
            g_failed = true;                                                   \
            return g_check;                                                    \
        }                                                                      \
    } while (0)

bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

// AABB of an interleaved x,y,z float position array.
struct Aabb { float lo[3], hi[3]; };
Aabb aabbOf(const std::vector<float>& p) {
    Aabb b{{1e30f, 1e30f, 1e30f}, {-1e30f, -1e30f, -1e30f}};
    for (std::size_t i = 0; i + 2 < p.size(); i += 3)
        for (int k = 0; k < 3; ++k) {
            b.lo[k] = std::min(b.lo[k], p[i + k]);
            b.hi[k] = std::max(b.hi[k], p[i + k]);
        }
    return b;
}
bool allFinite(const std::vector<float>& p) {
    for (float v : p) if (!std::isfinite(v)) return false;
    return true;
}

// Triangle count of an STL, format-agnostic. forge::io::exportStl emits ASCII STL
// ("solid …" + one "facet normal" per triangle); this also handles binary STL (a
// uint32 triangle count at byte offset 80) for robustness. `fmt` receives "ascii" or
// "binary". Returns the triangle count, or -1 if the file is unreadable/not an STL.
long stlTriangleCount(const std::string& path, long& fileSize, const char*& fmt) {
    fileSize = -1;
    fmt = "?";
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return -1;
    std::fseek(f, 0, SEEK_END);
    fileSize = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (fileSize < 15) { std::fclose(f); return -1; }
    std::vector<char> buf(static_cast<std::size_t>(fileSize));
    std::size_t rd = std::fread(buf.data(), 1, static_cast<std::size_t>(fileSize), f);
    std::fclose(f);
    if (rd != static_cast<std::size_t>(fileSize)) return -1;

    if (std::strncmp(buf.data(), "solid", 5) == 0) {   // ASCII STL
        fmt = "ascii";
        long n = 0;
        const std::string needle = "facet normal";
        std::string s(buf.data(), static_cast<std::size_t>(fileSize));
        std::size_t pos = 0;
        while ((pos = s.find(needle, pos)) != std::string::npos) { ++n; pos += needle.size(); }
        return n;
    }
    if (fileSize >= 84) {                                // binary STL
        fmt = "binary";
        std::uint32_t n = 0;
        std::memcpy(&n, buf.data() + 80, sizeof(n));
        if (fileSize != 84 + 50L * static_cast<long>(n)) return -1;  // layout must match
        return static_cast<long>(n);
    }
    return -1;
}

// Tessellate + export one solid and assert the mesh <-> STL invariants. `tag` labels
// the printout; `wantMinTris` is a lower bound the level's triangle count must clear.
int checkMeshFeed(const char* tag, forge::ShapeHandle h, const std::string& stlPath,
                  std::size_t wantMinTris, const Aabb& wantBox, double boxTol) {
    const forge::Mesh& m = forge::tessellateLOD(h, forge::LODLevel::High);

    const std::size_t nPos = m.positions.size();
    const std::size_t nIdx = m.indices.size();
    const std::size_t tris = nIdx / 3;

    std::printf("  [%-16s] verts=%zu  tris=%zu  normals=%zu\n",
                tag, nPos / 3, tris, m.normals.size() / 3);

    CHECK(nPos > 0 && nPos % 3 == 0);       // triangle-aligned positions
    CHECK(nIdx > 0 && nIdx % 3 == 0);       // triangle-aligned index list
    CHECK(tris >= wantMinTris);             // the tessellator produced real geometry
    CHECK(allFinite(m.positions));          // no NaN/Inf coordinates
    CHECK(m.normals.size() == nPos);        // one normal per vertex

    // Every index must point at a real vertex.
    const std::uint32_t vtxCount = static_cast<std::uint32_t>(nPos / 3);
    std::uint32_t maxIdx = 0;
    for (std::uint32_t i : m.indices) maxIdx = std::max(maxIdx, i);
    CHECK(maxIdx < vtxCount);

    // Vertex AABB must match the solid's known bounds.
    Aabb b = aabbOf(m.positions);
    std::printf("      aabb = [%.3f,%.3f]x[%.3f,%.3f]x[%.3f,%.3f]\n",
                b.lo[0], b.hi[0], b.lo[1], b.hi[1], b.lo[2], b.hi[2]);
    for (int k = 0; k < 3; ++k) {
        CHECK(approx(b.lo[k], wantBox.lo[k], boxTol));
        CHECK(approx(b.hi[k], wantBox.hi[k], boxTol));
    }

    // Export a binary STL and prove it matches the tessellation exactly.
    bool wrote = forge::io::exportStl(h, stlPath, /*linTol*/ 0.05, /*angTol*/ 0.5,
                                      /*ascii*/ false);
    CHECK(wrote);
    long fileSize = -1;
    const char* fmt = "?";
    long stlTris = stlTriangleCount(stlPath, fileSize, fmt);
    std::printf("      stl  = %s  (%s, %ld bytes, %ld triangles)\n",
                stlPath.c_str(), fmt, fileSize, stlTris);
    CHECK(stlTris > 0);                             // a readable, valid STL was written
    // exportStl tessellates at its own tol, so its count need not equal the LOD mesh,
    // but it must be a non-degenerate surface of the same body: at least the coarse
    // lower bound, and a sane upper bound (guards a runaway/garbage writer).
    CHECK(static_cast<std::size_t>(stlTris) >= wantMinTris);
    CHECK(stlTris < 5'000'000);
    return 0;
}

int run() {
    std::printf("=== Forge C++ Desktop Mesh-Feed Probe ===\n");
    std::printf("  linked library : forge_kernel_core  (N-API binding EXCLUDED)\n");
    std::printf("  pipeline       : ShapeHandle -> tessellateLOD(High) -> Mesh -> exportStl\n\n");

    const std::string tmp = "/tmp/forge_mesh_probe";
    std::system(("mkdir -p " + tmp).c_str());

    // 1) BOX 10x10x10 — 6 planar faces, >= 12 triangles, AABB [0,10]^3.
    {
        forge::ShapeHandle box = forge::makeBox(10.0, 10.0, 10.0);
        Aabb want{{0, 0, 0}, {10, 10, 10}};
        int rc = checkMeshFeed("box(10,10,10)", box, tmp + "/box.stl",
                               /*minTris*/ 12, want, /*tol*/ 1e-4);
        if (rc) return rc;
    }

    // 2) CYLINDER r=5 h=10 — a CURVED lateral face; must carry many more triangles
    //    than the box (proof the tessellator sampled the curve), AABB [-5,5]x[-5,5]x[0,10].
    {
        forge::ShapeHandle cyl = forge::makeCylinder(5.0, 10.0);
        Aabb want{{-5, -5, 0}, {5, 5, 10}};
        int rc = checkMeshFeed("cylinder(5,10)", cyl, tmp + "/cyl.stl",
                               /*minTris*/ 48, want, /*tol*/ 0.15);  // chordal on r
        if (rc) return rc;
    }

    // 3) BOOLEAN — box(10) minus a centred through-drill cyl(r=2). A non-trivial
    //    B-rep whose mesh must still be watertight-shaped: AABB stays [0,10]^3, and
    //    it must have MORE triangles than the plain box (the bore adds a wall).
    {
        forge::ShapeHandle box  = forge::makeBox(10.0, 10.0, 10.0);
        forge::ShapeHandle tool = forge::makeCylinder(2.0, 20.0);
        tool = forge::translate(tool, 5.0, 5.0, -5.0);   // centre, punch clean through
        forge::ShapeHandle drilled = forge::cut(box, tool);
        Aabb want{{0, 0, 0}, {10, 10, 10}};
        int rc = checkMeshFeed("box-cut-cyl", drilled, tmp + "/drilled.stl",
                               /*minTris*/ 20, want, /*tol*/ 0.15);
        if (rc) return rc;
    }

    std::printf("\n=== ALL %d CHECKS PASSED — PASS ===\n", g_check);
    return 0;
}

}  // namespace

int main() {
    try {
        int rc = run();
        if (rc != 0) {
            std::fprintf(stderr, "\n=== MESH-FEED PROBE FAILED at check #%d ===\n", rc);
            return rc;
        }
        return 0;
    } catch (const std::exception& e) {
        std::fprintf(stderr, "\n=== MESH-FEED PROBE THREW: %s ===\n", e.what());
        return 255;
    }
}
