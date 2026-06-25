// forge-kernel/test/native_occt_wire_activation_test.cpp
//
// PHASE-D WIRE-ACTIVATION A/B GATE (2026-06-25).
//
// Proves that, with the FEAT gate forced ON (setForgeNativeBrepEnabled(true)), three
// already-wired tryNative* op call-sites now take the NATIVE path on an OCCT (ShapeKind::Occt)
// input — by importing it through forge::importOcctSolid (src/OcctImport.cpp) and running the
// native op on the imported native Solid — INSTEAD of deferring to OCCT, and that the native
// result MATCHES the OCCT-path result for analytic solids:
//
//   1) forge::detectInterference         — native clash test booleanSolid(Common)+massProperties
//      on two imported solids. A/B: overlap volume matches the OCCT BRepAlgoAPI_Common/GProp
//      narrow phase within tol (and equals the analytic 5x10x10 = 500).
//   2) forge::fea::meshFromBRep          — native computeAabb + pointInSolid hex grid on the
//      imported solid. A/B: mesh node bounding box + element/node counts match the OCCT
//      BRepBndLib/BRepClass3d_SolidClassifier grid.
//   3) forge::fea::tet::meshShapeFromHandle — native tessellateSolid + computeAabb + pointInSolid
//      tet build on the imported solid. A/B: node-cloud bbox spans the exact analytic box and
//      the summed tet volume matches the OCCT-path mesh's summed tet volume within tol.
//
// Each op additionally asserts importOcctSolidCallCount() INCREASED across the gated call —
// i.e. the OCCT->native importer was genuinely hit (the wire ACTIVATED, not silently deferred).
//
// (forge::shapecheck::analyse was evaluated as a 4th candidate and DELIBERATELY left deferring:
//  the native validator's G3 orientation predicate flags the importer's CW param-space winding
//  on every face -> a false-negative validity verdict. See ShapeCheck.cpp PHASE-D NOTE.)
//
// Inputs are built DIRECTLY with OCCT (BRepPrimAPI_MakeBox / MakeCylinder, BRepAlgoAPI_Cut) and
// registered as ShapeKind::Occt via ShapeRegistry::add — the FIRST time a Phase-D wire runs the
// native path on an OCCT input end-to-end.
//
// This LINKS OCCT (it drives the op files + the importer's bridge oracle) — it is NOT part of
// the pure-native run_native.sh gate. Build + run via test/build_occt_wire_activation_test.sh.

#include "forge/OcctImport.hpp"            // importOcctSolid, importOcctSolidCallCount
#include "forge/ShapeRegistry.hpp"
#include "forge/ComponentRegistry.hpp"
#include "forge/AssemblyHierarchy.hpp"
#include "forge/InterferenceDetection.hpp"
#include "forge/Fea.hpp"
#include "forge/FeaTet.hpp"
#include "forge/native/brep/NativeRoute.hpp"   // setForgeNativeBrepEnabled

// --- OCCT (build the analytic inputs + the OCCT A/B oracle) -----------------
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <TopoDS_Shape.hxx>

#include <cmath>
#include <cstdio>
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

double relErr(double a, double b) {
    double d = std::fabs(a - b);
    double s = std::max({std::fabs(a), std::fabs(b), 1e-12});
    return d / s;
}

// A translation-only row-major 4x4.
Transform4x4 translate(double x, double y, double z) {
    Transform4x4 t;  // identity
    t.m[3] = x; t.m[7] = y; t.m[11] = z;
    return t;
}

// World bounding box of a Fea Mesh's node cloud.
struct Box { double mn[3]; double mx[3]; bool empty = true; };
Box meshBox(const fea::Mesh& m) {
    Box b;
    for (std::size_t i = 0; i + 2 < m.nodes.size(); i += 3) {
        double p[3] = { m.nodes[i], m.nodes[i + 1], m.nodes[i + 2] };
        if (b.empty) { for (int k = 0; k < 3; ++k) b.mn[k] = b.mx[k] = p[k]; b.empty = false; }
        else for (int k = 0; k < 3; ++k) { b.mn[k] = std::min(b.mn[k], p[k]); b.mx[k] = std::max(b.mx[k], p[k]); }
    }
    return b;
}

// A bored box (box - through-cylinder) built DIRECTLY with OCCT — an analytic-boolean
// result whose faces are all Plane/Cylinder, so importOcctSolid imports it faithfully.
TopoDS_Shape makeBoredBox() {
    TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 20.0, 20.0, 20.0).Shape();
    // A cylinder fully through the box along +Z (radius 4, height 40, centred at (10,10)).
    gp_Ax2 ax(gp_Pnt(10, 10, -10), gp_Dir(0, 0, 1));
    TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(ax, 4.0, 40.0).Shape();
    return BRepAlgoAPI_Cut(box, cyl).Shape();
}

}  // namespace

// === 1) detectInterference =================================================
// Two overlapping OCCT boxes registered as instances. Gate ON -> native booleanSolid(Common)+
// massProperties on the imported solids; importOcctSolidCallCount must rise. Overlap volume must
// match the OCCT BRepAlgoAPI_Common/GProp narrow phase.
void testInterference() {
    std::printf("[detectInterference on two OCCT boxes]\n");
    auto& reg   = ShapeRegistry::instance();
    auto& comps = ComponentRegistry::instance();

    // Box A: 10x10x10 at origin. Box B: 10x10x10 translated +5 in X -> overlap 5x10x10 = 500.
    ShapeHandle ha = reg.add(BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 10.0, 10.0, 10.0).Shape());
    ShapeHandle hb = reg.add(BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 10.0, 10.0, 10.0).Shape());
    InstanceId ia = comps.addInstance(ha, translate(0, 0, 0));
    InstanceId ib = comps.addInstance(hb, translate(5, 0, 0));
    std::vector<InstanceId> ids = { ia, ib };

    // --- gate OFF: OCCT narrow phase (A/B oracle) ---
    setForgeNativeBrepEnabled(false);
    unsigned long long before0 = importOcctSolidCallCount();
    auto occt = detectInterference(ids, 0.0);
    check(importOcctSolidCallCount() == before0, "gate OFF -> importer NOT hit (pure OCCT)");
    check(occt.size() == 1, "gate OFF -> 1 clash pair detected");
    double vOcct = occt.empty() ? 0.0 : occt[0].volume;

    // --- gate ON: native clash via importOcctSolid ---
    setForgeNativeBrepEnabled(true);
    unsigned long long before1 = importOcctSolidCallCount();
    auto nat = detectInterference(ids, 0.0);
    // Two instances -> two imports per pair evaluation -> count rises by >= 2.
    check(importOcctSolidCallCount() >= before1 + 2,
          "gate ON  -> importOcctSolid HIT for both operands (native wire activated)");
    check(nat.size() == 1, "gate ON  -> 1 clash pair detected (native)");
    double vNat = nat.empty() ? 0.0 : nat[0].volume;

    check(std::fabs(vNat - 500.0) < 1e-6,
          "native overlap volume == 500 (5x10x10)  got=" + std::to_string(vNat));
    check(relErr(vNat, vOcct) <= 1e-6,
          "native overlap matches OCCT  native=" + std::to_string(vNat) +
          " occt=" + std::to_string(vOcct) + " relerr=" + std::to_string(relErr(vNat, vOcct)));

    setForgeNativeBrepEnabled(false);
    comps.removeInstance(ia);
    comps.removeInstance(ib);
    reg.release(ha);
    reg.release(hb);
}

// === 2) meshFromBRep =======================================================
// Gate ON -> native computeAabb + pointInSolid hex grid on the imported solid;
// importOcctSolidCallCount must rise. Mesh node bbox + element/node counts must match
// the OCCT BRepBndLib/BRepClass3d_SolidClassifier grid.
void testMeshFromBRep() {
    std::printf("[meshFromBRep on OCCT box]\n");
    auto& reg = ShapeRegistry::instance();
    // A plain 12x8x6 box -> a clean exact-divisor hex grid (no partial-voxel ambiguity).
    ShapeHandle h = reg.add(BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 12.0, 8.0, 6.0).Shape());
    const double elem = 2.0;

    // --- gate OFF: OCCT grid (A/B oracle) ---
    setForgeNativeBrepEnabled(false);
    unsigned long long before0 = importOcctSolidCallCount();
    fea::Mesh occt = fea::meshFromBRep(h, elem);
    check(importOcctSolidCallCount() == before0, "gate OFF -> importer NOT hit (pure OCCT)");

    // --- gate ON: native grid via importOcctSolid ---
    setForgeNativeBrepEnabled(true);
    unsigned long long before1 = importOcctSolidCallCount();
    fea::Mesh nat = fea::meshFromBRep(h, elem);
    check(importOcctSolidCallCount() > before1,
          "gate ON  -> importOcctSolid HIT (native wire activated)");

    check(nat.nodes.size() == occt.nodes.size(),
          "node count matches OCCT  native=" + std::to_string(nat.nodes.size() / 3) +
          " occt=" + std::to_string(occt.nodes.size() / 3));
    check(nat.tets.size() == occt.tets.size(),
          "hex element count matches OCCT  native=" + std::to_string(nat.tets.size() / 8) +
          " occt=" + std::to_string(occt.tets.size() / 8));
    Box bn = meshBox(nat), bo = meshBox(occt);
    // The native grid is anchored to the EXACT analytic AABB (computeAabb); the OCCT grid
    // is anchored to OCCT's Bnd_Box, which PADS the bound by its gap tolerance. So the two
    // node clouds differ only by OCCT's padding (a small fraction of an element), never by a
    // structural error — assert agreement within 1% of the element size (and report exact).
    const double bbTol = 0.01 * elem;
    bool bbOk = !bn.empty && !bo.empty;
    double worst = 0.0;
    for (int k = 0; k < 3; ++k) {
        worst = std::max({worst, std::fabs(bn.mn[k] - bo.mn[k]), std::fabs(bn.mx[k] - bo.mx[k])});
    }
    bbOk = bbOk && worst <= bbTol;
    check(bbOk, "mesh node bbox matches OCCT (within " + std::to_string(bbTol) +
          ")  native=[" + std::to_string(bn.mn[0]) + ".." + std::to_string(bn.mx[0]) +
          "] occt=[" + std::to_string(bo.mn[0]) + ".." + std::to_string(bo.mx[0]) +
          "]  worst-delta=" + std::to_string(worst));
    // The native node cloud must span the EXACT analytic box [0,12]x[0,8]x[0,6].
    bool exactOk = std::fabs(bn.mn[0]) < 1e-9 && std::fabs(bn.mx[0] - 12.0) < 1e-9 &&
                   std::fabs(bn.mn[1]) < 1e-9 && std::fabs(bn.mx[1] - 8.0)  < 1e-9 &&
                   std::fabs(bn.mn[2]) < 1e-9 && std::fabs(bn.mx[2] - 6.0)  < 1e-9;
    check(exactOk, "native node cloud spans exact analytic box [0,12]x[0,8]x[0,6]");

    setForgeNativeBrepEnabled(false);
    reg.release(h);
}

// === 3) fea::tet::meshShapeFromHandle ======================================
// Gate ON -> native tessellateSolid + computeAabb + pointInSolid tet build on the imported
// solid; importOcctSolidCallCount must rise. The node-cloud bbox must span the exact analytic
// box, and the summed tet volume must match the OCCT-path mesh's summed tet volume within tol.
namespace {
struct TetBox { double mn[3]; double mx[3]; bool empty = true; };
TetBox tetBox(const fea::tet::Mesh& m) {
    TetBox b;
    for (const auto& n : m.nodes) {
        double p[3] = { n.x, n.y, n.z };
        if (b.empty) { for (int k = 0; k < 3; ++k) b.mn[k] = b.mx[k] = p[k]; b.empty = false; }
        else for (int k = 0; k < 3; ++k) { b.mn[k] = std::min(b.mn[k], p[k]); b.mx[k] = std::max(b.mx[k], p[k]); }
    }
    return b;
}
double tetMeshVolume(const fea::tet::Mesh& m) {
    double vol = 0.0;
    for (const auto& t : m.tets) {
        const auto& a = m.nodes[t.a]; const auto& b = m.nodes[t.b];
        const auto& c = m.nodes[t.c]; const auto& d = m.nodes[t.d];
        double e1[3] = { b.x - a.x, b.y - a.y, b.z - a.z };
        double e2[3] = { c.x - a.x, c.y - a.y, c.z - a.z };
        double e3[3] = { d.x - a.x, d.y - a.y, d.z - a.z };
        double cr[3] = { e2[1]*e3[2] - e2[2]*e3[1],
                         e2[2]*e3[0] - e2[0]*e3[2],
                         e2[0]*e3[1] - e2[1]*e3[0] };
        vol += std::fabs(e1[0]*cr[0] + e1[1]*cr[1] + e1[2]*cr[2]) / 6.0;
    }
    return vol;
}
}  // namespace

void testFeaTetMeshShape() {
    std::printf("[fea::tet::meshShapeFromHandle on OCCT box]\n");
    auto& reg = ShapeRegistry::instance();
    // A 10x6x4 box (volume 240). targetEdge sized to give a handful of tets.
    ShapeHandle h = reg.add(BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 10.0, 6.0, 4.0).Shape());
    const double targetEdge = 3.0;

    // --- gate OFF: OCCT BRepMesh tet path (A/B oracle) ---
    setForgeNativeBrepEnabled(false);
    unsigned long long before0 = importOcctSolidCallCount();
    fea::tet::Mesh occt = fea::tet::meshShapeFromHandle(h, targetEdge);
    check(importOcctSolidCallCount() == before0, "gate OFF -> importer NOT hit (pure OCCT)");
    check(!occt.tets.empty(), "gate OFF -> OCCT tet mesh non-empty");

    // --- gate ON: native tet build via importOcctSolid ---
    setForgeNativeBrepEnabled(true);
    unsigned long long before1 = importOcctSolidCallCount();
    fea::tet::Mesh nat = fea::tet::meshShapeFromHandle(h, targetEdge);
    check(importOcctSolidCallCount() > before1,
          "gate ON  -> importOcctSolid HIT (native wire activated)");
    check(!nat.tets.empty(), "gate ON  -> native tet mesh non-empty");

    // Node cloud must span the EXACT analytic box [0,10]x[0,6]x[0,4].
    TetBox bn = tetBox(nat);
    bool exactOk = !bn.empty &&
                   std::fabs(bn.mn[0]) < 1e-6 && std::fabs(bn.mx[0] - 10.0) < 1e-6 &&
                   std::fabs(bn.mn[1]) < 1e-6 && std::fabs(bn.mx[1] - 6.0)  < 1e-6 &&
                   std::fabs(bn.mn[2]) < 1e-6 && std::fabs(bn.mx[2] - 4.0)  < 1e-6;
    check(exactOk, "native tet node cloud spans exact analytic box [0,10]x[0,6]x[0,4]");

    // Summed tet volume: native vs OCCT-path mesh, and vs the analytic 240.
    double vNat = tetMeshVolume(nat), vOcct = tetMeshVolume(occt);
    check(relErr(vNat, vOcct) <= 0.05,
          "native tet volume matches OCCT  native=" + std::to_string(vNat) +
          " occt=" + std::to_string(vOcct) + " relerr=" + std::to_string(relErr(vNat, vOcct)));
    check(relErr(vNat, 240.0) <= 0.05,
          "native tet volume ~ analytic 240  got=" + std::to_string(vNat));

    setForgeNativeBrepEnabled(false);
    reg.release(h);
}

int main() {
    std::printf("=== PHASE-D WIRE-ACTIVATION A/B GATE (OCCT analytic input -> native) ===\n");
    testInterference();
    testMeshFromBRep();
    testFeaTetMeshShape();
    std::printf("\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
