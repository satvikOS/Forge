// forge/native/mesh/test/mesh_gate.cpp
//
// Standalone validation gate for the in-house half-edge mesh + first boolean
// (plane clip). Pure C++20, no external deps. Run:
//
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/src/native/mesh/MeshBoolean.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/test/native/mesh/mesh_gate.cpp -o /tmp/mesh_test && /tmp/mesh_test
//
// Gate (from the task):
//   (a) a unit cube (12 tris) builds a valid half-edge mesh with V=8, E=18,
//       F=12, Euler chi=2, and passes 2-manifold + watertight.
//   (b) plane-clipping the cube at z=0 yields a closed, 2-manifold mesh whose
//       volume is half the cube within 1e-6.

#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

using namespace forge::native::mesh;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {            std::printf("  [FAIL] %s\n", name); }
}

// Unit cube [0,1]^3 as an indexed triangle soup, 8 verts, 12 triangles, all
// outward-facing CCW.
static void unitCube(std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos = {
        0,0,0,  // 0
        1,0,0,  // 1
        1,1,0,  // 2
        0,1,0,  // 3
        0,0,1,  // 4
        1,0,1,  // 5
        1,1,1,  // 6
        0,1,1   // 7
    };
    idx = {
        // bottom z=0 (outward normal -z, so CCW seen from below)
        0,2,1,  0,3,2,
        // top z=1 (outward +z)
        4,5,6,  4,6,7,
        // front y=0 (outward -y)
        0,1,5,  0,5,4,
        // right x=1 (outward +x)
        1,2,6,  1,6,5,
        // back y=1 (outward +y)
        2,3,7,  2,7,6,
        // left x=0 (outward -x)
        3,0,4,  3,4,7
    };
}

int main() {
    std::printf("=== forge::native::mesh gate ===\n");

    // ---- (a) cube builds a valid half-edge mesh -------------------------
    std::printf("\n[a] unit cube half-edge build + invariants\n");
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    unitCube(pos, idx);

    HalfEdgeMesh cube;
    bool built = cube.buildFromSoup(pos, idx);
    check(built, "cube builds from triangle soup");

    ValidityReport vr = cube.validate();
    std::printf("    V=%u E=%u F=%u  chi=%d  twins=%d manifold=%d watertight=%d\n",
                vr.numVertices, vr.numEdges, vr.numFaces, vr.eulerChar,
                (int)vr.twinsConsistent, (int)vr.manifold, (int)vr.watertight);

    check(vr.numVertices == 8, "V == 8");
    check(vr.numEdges    == 18, "E == 18");
    check(vr.numFaces    == 12, "F == 12");
    check(vr.eulerChar   == 2,  "Euler characteristic == 2");
    check(vr.twinsConsistent,   "twin/next/prev wiring consistent");
    check(vr.manifold,          "2-manifold");
    check(vr.watertight,        "watertight (closed)");
    check(vr.isValid(),         "cube is a valid closed 2-manifold");

    double cubeVol = cube.signedVolume();
    double cubeArea = cube.surfaceArea();
    std::printf("    signedVolume=%.15f  surfaceArea=%.15f\n", cubeVol, cubeArea);
    check(std::fabs(cubeVol - 1.0) < 1e-12, "cube signed volume == 1");
    check(std::fabs(cubeArea - 6.0) < 1e-12, "cube surface area == 6");

    // ---- negative: an open mesh must fail watertight --------------------
    std::printf("\n[a'] open mesh (cube missing one face) fails watertight\n");
    std::vector<std::uint32_t> openIdx(idx.begin(), idx.end() - 3); // drop last tri
    HalfEdgeMesh open;
    bool openBuilt = open.buildFromSoup(pos, openIdx);
    check(openBuilt, "open mesh still builds (boundary allowed)");
    ValidityReport ovr = open.validate();
    std::printf("    open: watertight=%d manifold=%d valid=%d\n",
                (int)ovr.watertight, (int)ovr.manifold, (int)ovr.isValid());
    check(!ovr.watertight, "open mesh correctly NOT watertight");
    check(!ovr.isValid(),  "open mesh correctly NOT valid");

    // ---- (b) plane clip at z=0 keeps half the volume --------------------
    std::printf("\n[b] plane-clip cube, keep z <= 0.5 (half-space n=(0,0,1), d=0.5)\n");
    bool ok = false;
    // Keep n·p <= d  with n=(0,0,1), d=0.5  ->  keep z <= 0.5.
    HalfEdgeMesh clipped = cube.planeClip(Vec3{0,0,1}, 0.5, ok);
    check(ok, "plane clip reports success");

    ValidityReport cvr = clipped.validate();
    std::printf("    clipped: V=%u E=%u F=%u chi=%d manifold=%d watertight=%d\n",
                cvr.numVertices, cvr.numEdges, cvr.numFaces, cvr.eulerChar,
                (int)cvr.manifold, (int)cvr.watertight);
    check(cvr.manifold,   "clipped mesh is 2-manifold");
    check(cvr.watertight, "clipped mesh is watertight (closed)");
    check(cvr.eulerChar == 2, "clipped mesh Euler char == 2 (genus-0)");

    double clipVol = clipped.signedVolume();
    std::printf("    clipped signed volume = %.15f (expect 0.5)\n", clipVol);
    check(std::fabs(clipVol - 0.5) < 1e-6, "clipped volume == half cube within 1e-6");

    // ---- (b') clip at an arbitrary z to cross-check (z<=0.25 -> vol 0.25)
    std::printf("\n[b'] plane-clip cube keep z <= 0.25 (expect volume 0.25)\n");
    bool ok2 = false;
    HalfEdgeMesh clip2 = cube.planeClip(Vec3{0,0,1}, 0.25, ok2);
    check(ok2, "second plane clip reports success");
    if (ok2) {
        ValidityReport c2 = clip2.validate();
        double v2 = clip2.signedVolume();
        std::printf("    z<=0.25: valid=%d volume=%.15f (expect 0.25)\n",
                    (int)c2.isValid(), v2);
        check(c2.isValid(), "z<=0.25 clip valid closed 2-manifold");
        check(std::fabs(v2 - 0.25) < 1e-6, "z<=0.25 volume == 0.25 within 1e-6");
    }

    // ---- (b'') clip on a tilted plane through the cube center -----------
    // Plane n=(1,1,1)/sqrt3, d through the center (0.5,0.5,0.5): keep half.
    std::printf("\n[b''] tilted plane through center keeps half volume\n");
    double s = 1.0 / std::sqrt(3.0);
    double dc = s * (0.5 + 0.5 + 0.5); // n·center
    bool ok3 = false;
    HalfEdgeMesh clip3 = cube.planeClip(Vec3{s, s, s}, dc, ok3);
    check(ok3, "tilted plane clip reports success");
    if (ok3) {
        ValidityReport c3 = clip3.validate();
        double v3 = clip3.signedVolume();
        std::printf("    tilted: valid=%d volume=%.15f (expect 0.5)\n",
                    (int)c3.isValid(), v3);
        check(c3.isValid(), "tilted clip valid closed 2-manifold");
        check(std::fabs(v3 - 0.5) < 1e-6, "tilted clip volume == 0.5 within 1e-6");
    }

    std::printf("\n=== %d/%d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
