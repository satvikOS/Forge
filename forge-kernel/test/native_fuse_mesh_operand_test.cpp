// forge-kernel/test/native_fuse_mesh_operand_test.cpp
//
// PHASE-D FUSE MESH-OPERAND BRIDGE GATE (2026-06-26).
//
// Proves the keystone OCCT-ZERO step: a boolean (cut / fuse) where AT LEAST ONE
// operand is a NativeMesh (a fillet/chamfer mesh-bridge result that carries NO
// analytic TopoDS_Shape / brep::Solid) now routes through the NATIVE mesh boolean
// (brep::booleanMeshOperand via tryNativeBoolean) INSTEAD of throwing in the OCCT
// bridge (ShapeRegistry::get -> "native-mesh-backed ... no analytic TopoDS_Shape").
//
// THE SCENARIO (exactly the failing context-build that motivated the fix):
//   setForgeNativeBrepEnabled(true)
//   1) makeBox            -> a NativeSolid box (analytic primitive, gate ON)
//   2) filletEdges(box)   -> a NativeMesh (the mesh-bridge feature verb) -- THE MESH OPERAND
//   3) makeCylinder       -> a NativeSolid cutter (analytic primitive)
//   4) cut(filletedMesh, cylinder)
//        ASSERT: no exception; result kindOf != Occt; importOcctSolidCallCount()
//        delta == 0 (NO OCCT bridge hit -- inverted importer probe, the same probe
//        the wire-activation gate uses); result is a valid CLOSED 2-MANIFOLD and
//        contains the bore (volume < the un-bored filleted box -> material removed).
//   5) FUSE: fuse(filletedMesh, NativeSolid boss)
//        ASSERT: native path (kindOf != Occt, importer delta == 0); valid closed
//        2-manifold; volume > the filleted box alone (material added by the boss).
//
// The importer-probe is INVERTED vs the wire-activation gate: there the native op
// IMPORTS an OCCT input so the count RISES; HERE the whole boolean is native end-to-
// end, so importOcctSolidCallCount() MUST NOT MOVE -- any rise would mean an operand
// silently fell through to the OCCT bridge (the bug this fix removes).
//
// This LINKS OCCT only to provide the importOcctSolidCallCount() oracle (OcctImport.cpp)
// -- the boolean itself touches NO OCCT. Build + run via build_fuse_mesh_operand_test.sh.

#include "forge/OcctImport.hpp"                 // importOcctSolidCallCount (inverted probe)
#include "forge/Primitives.hpp"                 // makeBox / makeCylinder
#include "forge/Features.hpp"                   // filletEdges
#include "forge/Booleans.hpp"                   // cut / fuse
#include "forge/Transform.hpp"                  // translate (place the cutter / boss)
#include "forge/ShapeRegistry.hpp"              // ShapeRegistry / ShapeKind / kindOf
#include "forge/native/brep/NativeRoute.hpp"    // setForgeNativeBrepEnabled
#include "forge/native/brep/Check.hpp"          // checkBRep, CheckReport (validity verdict)
#include "forge/native/brep/MassProps.hpp"      // massProperties(const Solid&) (native volume)
#include "forge/native/brep/SolidTessellate.hpp"// tessellateSolid (build the fillet edge-id list)
#include "forge/native/brep/Fillet.hpp"         // enumerateSharpConvexEdges (deterministic ids)
#include "forge/native/brep/Topology.hpp"       // Solid

#include <cmath>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

using namespace forge;
using forge::native::brep::setForgeNativeBrepEnabled;

namespace {

int g_pass = 0, g_fail = 0;

void check(bool cond, const std::string& label) {
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", label.c_str()); }
    else      { ++g_fail; std::printf("  [FAIL] %s\n", label.c_str()); }
}

// Resolve the 0-based fillet edge-id list for a NativeSolid box by enumerating its
// sharp convex edges through the SAME public enumeration the kernel fillet uses
// (so the ids are exactly valid -- a box yields 12). Returns every id.
std::vector<std::uint32_t> allSharpEdgeIds(ShapeHandle box) {
    auto& reg = ShapeRegistry::instance();
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    forge::native::brep::tessellateSolid(reg.getNativeSolid(box), pos, idx);
    auto edges = forge::native::brep::enumerateSharpConvexEdges(pos, idx);
    std::vector<std::uint32_t> ids;
    ids.reserve(edges.size());
    for (const auto& e : edges) ids.push_back(e.id);
    return ids;
}

}  // namespace

// === 1) CUT: NativeMesh (filleted box) - NativeSolid (cylinder) ============
void testCutFilletedMeshByCylinder() {
    std::printf("[cut: filleted-box NativeMesh - cylinder NativeSolid]\n");
    setForgeNativeBrepEnabled(true);
    auto& reg = ShapeRegistry::instance();

    // 1) NativeSolid box 20x20x20.
    ShapeHandle box = makeBox(20.0, 20.0, 20.0);
    check(reg.kindOf(box) == ShapeKind::NativeSolid,
          "box is a NativeSolid (analytic primitive, gate ON)");

    // 2) Fillet all sharp convex edges -> THE MESH OPERAND (NativeMesh).
    std::vector<std::uint32_t> edgeIds = allSharpEdgeIds(box);
    check(edgeIds.size() == 12,
          "box enumerates 12 sharp convex edges  got=" + std::to_string(edgeIds.size()));
    ShapeHandle filleted = kInvalidHandle;
    bool filletThrew = false;
    try { filleted = forge::part::filletEdges(box, edgeIds, 2.0); }
    catch (const std::exception& e) { filletThrew = true; std::printf("    fillet threw: %s\n", e.what()); }
    check(!filletThrew, "filletEdges did NOT throw");
    check(filleted != kInvalidHandle && reg.kindOf(filleted) == ShapeKind::NativeMesh,
          "filleted result is a NativeMesh (THE mesh operand)");

    // Volume of the filleted body (NativeMesh -> tessellate to measure). We reuse the
    // cut RESULT's native volume comparison below; here capture the un-bored reference
    // by tessellating the mesh and integrating its signed volume.
    double vFilleted = 0.0;
    {
        std::vector<double> p; std::vector<std::uint32_t> i;
        reg.getNativeMesh(filleted).toSoup(p, i);
        // signed volume of the soup (divergence theorem on triangles)
        double v6 = 0.0;
        for (std::size_t t = 0; t + 2 < i.size(); t += 3) {
            const double* a = &p[3 * i[t]]; const double* b = &p[3 * i[t + 1]]; const double* c = &p[3 * i[t + 2]];
            v6 += a[0] * (b[1] * c[2] - b[2] * c[1])
                + a[1] * (b[2] * c[0] - b[0] * c[2])
                + a[2] * (b[0] * c[1] - b[1] * c[0]);
        }
        vFilleted = std::fabs(v6) / 6.0;
    }
    check(vFilleted > 0.0, "filleted body has positive volume  v=" + std::to_string(vFilleted));

    // 3) NativeSolid cylinder cutter: radius 4, height 40, axis +Z. makeCylinder builds
    //    it on the +Z axis at the origin; to bore THROUGH the box centre we need it at
    //    (10,10). makeCylinder has no placement arg, so place it via translate.
    ShapeHandle cutter0 = makeCylinder(4.0, 40.0);
    check(reg.kindOf(cutter0) == ShapeKind::NativeSolid, "cylinder cutter is a NativeSolid");
    // Move the cutter to the box centre in XY and start below the box so it punches through
    // (cylinder base at z=0 on +Z axis -> translate to (10,10,-10) spans z=-10..30 thru box).
    ShapeHandle cutter = forge::translate(cutter0, 10.0, 10.0, -10.0);
    check(reg.kindOf(cutter) == ShapeKind::NativeSolid, "translated cutter is still a NativeSolid");

    // 4) cut(filletedMesh, cylinder) -- the boolean under test.
    unsigned long long before = importOcctSolidCallCount();
    ShapeHandle result = kInvalidHandle;
    bool cutThrew = false;
    try { result = cut(filleted, cutter); }
    catch (const std::exception& e) { cutThrew = true; std::printf("    cut threw: %s\n", e.what()); }
    unsigned long long after = importOcctSolidCallCount();

    check(!cutThrew, "cut(filletedMesh, cylinder) did NOT throw");
    check(result != kInvalidHandle, "cut returned a valid handle");
    check(reg.kindOf(result) != ShapeKind::Occt,
          "result kindOf != Occt (native path)  kind=" +
          std::to_string(static_cast<int>(reg.kindOf(result))));
    check(after == before,
          "importOcctSolidCallCount delta == 0 (NO OCCT bridge hit)  before=" +
          std::to_string(before) + " after=" + std::to_string(after));

    // (d) valid closed 2-manifold + bore present (volume < un-bored filleted box).
    bool validClosed = false;
    double vResult = 0.0;
    if (result != kInvalidHandle && reg.kindOf(result) == ShapeKind::NativeSolid) {
        const forge::native::brep::Solid& rs = reg.getNativeSolid(result);
        forge::native::brep::CheckReport cr = forge::native::brep::checkBRep(&rs);
        validClosed = cr.valid;
        check(cr.valid, "cut result is a valid closed 2-manifold (checkBRep)  predicates " +
              std::to_string(cr.passed()) + "/" + std::to_string(cr.total()));
        vResult = forge::native::brep::massProperties(rs).volume;
    } else {
        check(false, "cut result is a NativeSolid (so checkBRep/volume apply)");
    }
    check(validClosed, "cut result VALID closed 2-manifold == TRUE");
    check(vResult > 0.0 && vResult < vFilleted,
          "bore present: result volume < un-bored filleted box  result=" +
          std::to_string(vResult) + " filleted=" + std::to_string(vFilleted));

    setForgeNativeBrepEnabled(false);
    reg.release(box);
    reg.release(filleted);
    reg.release(cutter0);
    reg.release(cutter);
    if (result != kInvalidHandle) reg.release(result);
}

// === 2) FUSE: NativeMesh (filleted box) + NativeSolid (boss) ===============
void testFuseFilletedMeshWithBoss() {
    std::printf("[fuse: filleted-box NativeMesh + boss NativeSolid]\n");
    setForgeNativeBrepEnabled(true);
    auto& reg = ShapeRegistry::instance();

    ShapeHandle box = makeBox(20.0, 20.0, 20.0);
    std::vector<std::uint32_t> edgeIds = allSharpEdgeIds(box);
    ShapeHandle filleted = forge::part::filletEdges(box, edgeIds, 2.0);
    check(reg.kindOf(filleted) == ShapeKind::NativeMesh, "filleted body is a NativeMesh (operand)");

    // Filleted-box volume reference (soup signed volume).
    double vFilleted = 0.0;
    {
        std::vector<double> p; std::vector<std::uint32_t> i;
        reg.getNativeMesh(filleted).toSoup(p, i);
        double v6 = 0.0;
        for (std::size_t t = 0; t + 2 < i.size(); t += 3) {
            const double* a = &p[3 * i[t]]; const double* b = &p[3 * i[t + 1]]; const double* c = &p[3 * i[t + 2]];
            v6 += a[0] * (b[1] * c[2] - b[2] * c[1])
                + a[1] * (b[2] * c[0] - b[0] * c[2])
                + a[2] * (b[0] * c[1] - b[1] * c[0]);
        }
        vFilleted = std::fabs(v6) / 6.0;
    }

    // A boss: a smaller box that overlaps the top face so the fuse adds material that
    // protrudes (overlap guarantees a closeable union; protrusion guarantees a net gain).
    ShapeHandle boss0 = makeBox(8.0, 8.0, 12.0);
    check(reg.kindOf(boss0) == ShapeKind::NativeSolid, "boss is a NativeSolid");
    // Centre the boss in XY (6..14) and straddle the top face (z 14..26) -> sticks out by 6.
    ShapeHandle boss = forge::translate(boss0, 6.0, 6.0, 14.0);

    unsigned long long before = importOcctSolidCallCount();
    ShapeHandle result = kInvalidHandle;
    bool threw = false;
    try { result = fuse(filleted, boss); }
    catch (const std::exception& e) { threw = true; std::printf("    fuse threw: %s\n", e.what()); }
    unsigned long long after = importOcctSolidCallCount();

    check(!threw, "fuse(filletedMesh, boss) did NOT throw");
    check(result != kInvalidHandle, "fuse returned a valid handle");
    check(reg.kindOf(result) != ShapeKind::Occt,
          "fuse result kindOf != Occt (native path)  kind=" +
          std::to_string(static_cast<int>(reg.kindOf(result))));
    check(after == before,
          "fuse importOcctSolidCallCount delta == 0 (NO OCCT bridge hit)  before=" +
          std::to_string(before) + " after=" + std::to_string(after));

    bool validClosed = false;
    double vResult = 0.0;
    if (result != kInvalidHandle && reg.kindOf(result) == ShapeKind::NativeSolid) {
        const forge::native::brep::Solid& rs = reg.getNativeSolid(result);
        forge::native::brep::CheckReport cr = forge::native::brep::checkBRep(&rs);
        validClosed = cr.valid;
        check(cr.valid, "fuse result is a valid closed 2-manifold (checkBRep)  predicates " +
              std::to_string(cr.passed()) + "/" + std::to_string(cr.total()));
        vResult = forge::native::brep::massProperties(rs).volume;
    } else {
        check(false, "fuse result is a NativeSolid (so checkBRep/volume apply)");
    }
    check(validClosed, "fuse result VALID closed 2-manifold == TRUE");
    check(vResult > vFilleted,
          "material added: fuse result volume > filleted box  result=" +
          std::to_string(vResult) + " filleted=" + std::to_string(vFilleted));

    setForgeNativeBrepEnabled(false);
    reg.release(box);
    reg.release(filleted);
    reg.release(boss0);
    reg.release(boss);
    if (result != kInvalidHandle) reg.release(result);
}

int main() {
    std::printf("=== PHASE-D FUSE MESH-OPERAND BRIDGE GATE (NativeMesh boolean, OCCT-zero) ===\n");
    testCutFilletedMeshByCylinder();
    testFuseFilletedMeshWithBoss();
    std::printf("\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
