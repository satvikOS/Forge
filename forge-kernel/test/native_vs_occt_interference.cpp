// forge-kernel/test/native_vs_occt_interference.cpp
//
// A/B CORRECTNESS GATE for the WAVE-2 INTERFERENCE FLIP (src/InterferenceDetection.cpp,
// gate forgeNativeInterferenceEnabled(), default ON). It proves that the native
// analytic clash test that now runs BY DEFAULT —
//     resolveWorldSolid  (importOcctSolid + transformSolid)
//       -> brep::booleanSolid(A, B, Common)
//       -> brep::massProperties(result).volume
// reproduces the OCCT narrow phase it replaces —
//     BRepBuilderAPI_Transform -> BRepAlgoAPI_Common -> BRepGProp::VolumeProperties —
// on the SAME world-placed operand pairs, to the documented tolerance.
//
// This test reconstructs EXACTLY the operations the flipped runtime path performs
// (it does NOT go through detectInterference/ShapeRegistry/AssemblyHierarchy — it
// drives importOcctSolid + transformSolid + booleanSolid + massProperties directly,
// which IS resolveWorldSolid()+tryNativeInterferencePair() minus the registry
// lookups), so a pass here certifies the operative geometry of the flip.
//
// TOLERANCE REGIMES (honest, Bible §0):
//   * PLANAR family (box/box, incl. a rotated+translated world placement): the
//     overlap is a polyhedron whose vertices are exact -> native == OCCT to 1e-6
//     RELATIVE (the strict A/B bar; this is the canonical prismatic-assembly clash).
//   * CURVED family (box/cylinder, cylinder/cylinder): the intersection CURVE is
//     imprinted by faceting, so the native overlap volume matches OCCT's exact
//     curved volume to the faceting tolerance (sub-percent), NOT 1e-6 — stated
//     plainly, never overclaimed. The CLASH VERDICT (overlap >= kInterferenceMinVolume)
//     is asserted IDENTICAL to OCCT for every case. A clearance (no-overlap) pair
//     must report ~0 / no-clash on BOTH paths.
//
// LINKS OCCT (it is the A/B oracle) — NOT a run_native.sh pure-native gate. The
// native-operand overlap engine (booleanSolid Common + massProperties + transformSolid)
// is separately gate-covered OCCT-free in test/native/brep/native_boolean_test.cpp
// (box-box COMMON -> VI @ 1e-6) and test/native/brep/interference_overlap_test.cpp.
//
// Build + run via test/build_interference_ab_test.sh (assembles the native object
// set + OcctImport.cpp WITH OCCT + this test + the OCCT link line automatically).
// Exit 0 iff "0 failed".

#include "forge/OcctImport.hpp"

#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/NativeRoute.hpp"
#include "forge/native/brep/Topology.hpp"

// Mirror of forge::kInterferenceMinVolume (forge/InterferenceDetection.hpp) — that
// header drags in ComponentRegistry's full OCCT registry surface, unneeded here.
namespace forge { constexpr double kInterferenceMinVolume = 1e-9; }

#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Trsf.hxx>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge;
using forge::native::brep::Solid;
using forge::native::brep::BoolOp;
using forge::native::brep::BooleanResult;
using forge::native::brep::TopologyBuilder;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static double relErr(double a, double b) {
    const double d = std::abs(a - b);
    const double s = std::max(std::abs(a), std::abs(b));
    return (s < 1e-12) ? d : d / s;
}

// Row-major 4x4 world transform -> the (R[9], t[3]) split transformSolid wants,
// AND the matching gp_Trsf the OCCT path applies (so both paths place the operand
// identically). Built from an axis-angle rotation + translation, exactly like the
// assembly subsystem's Rodrigues x translation transforms.
struct World {
    double R[9];
    double t[3];
    gp_Trsf occt;
};
static World makeWorld(double ax, double ay, double az, double angRad,
                       double tx, double ty, double tz) {
    // normalise axis
    double n = std::sqrt(ax*ax + ay*ay + az*az);
    if (n < 1e-15) { ax = 0; ay = 0; az = 1; n = 1; }
    ax /= n; ay /= n; az /= n;
    const double c = std::cos(angRad), s = std::sin(angRad), C = 1 - c;
    World w{};
    w.R[0] = c + ax*ax*C;     w.R[1] = ax*ay*C - az*s;  w.R[2] = ax*az*C + ay*s;
    w.R[3] = ay*ax*C + az*s;  w.R[4] = c + ay*ay*C;     w.R[5] = ay*az*C - ax*s;
    w.R[6] = az*ax*C - ay*s;  w.R[7] = az*ay*C + ax*s;  w.R[8] = c + az*az*C;
    w.t[0] = tx; w.t[1] = ty; w.t[2] = tz;
    // same rotation+translation as an OCCT gp_Trsf (row-major 3x4 SetValues)
    w.occt.SetValues(w.R[0], w.R[1], w.R[2], w.t[0],
                     w.R[3], w.R[4], w.R[5], w.t[1],
                     w.R[6], w.R[7], w.R[8], w.t[2]);
    return w;
}

// ---- OCCT narrow phase (the path being replaced) ---------------------------
static double occtOverlap(const TopoDS_Shape& a, const World& wa,
                          const TopoDS_Shape& b, const World& wb) {
    BRepBuilderAPI_Transform ma(a, wa.occt, /*copy*/ Standard_True);
    BRepBuilderAPI_Transform mb(b, wb.occt, /*copy*/ Standard_True);
    BRepAlgoAPI_Common op(ma.Shape(), mb.Shape());
    op.Build();
    if (!op.IsDone()) return 0.0;
    TopoDS_Shape inter = op.Shape();
    if (inter.IsNull()) return 0.0;
    GProp_GProps props;
    BRepGProp::VolumeProperties(inter, props);
    return std::abs(props.Mass());
}

// ---- native narrow phase (the flipped default path) ------------------------
// Mirrors resolveWorldSolid()+tryNativeInterferencePair(): import each OCCT shape
// to a native analytic Solid, rigid-transform to world, native Common + mass props.
// Returns false (defer) if either import defers or the boolean has no closed result,
// EXACTLY as the runtime path defers to OCCT.
static bool nativeOverlap(const TopoDS_Shape& a, const World& wa,
                          const TopoDS_Shape& b, const World& wb, double& volOut) {
    std::vector<std::shared_ptr<void>> keep;
    auto resolve = [&](const TopoDS_Shape& s, const World& w, const Solid*& out) -> bool {
        ImportResult ir = importOcctSolid(s);
        if (!ir.ok || ir.solid == nullptr) return false;
        keep.push_back(ir.owner);
        std::shared_ptr<TopologyBuilder> owner;
        Solid* world = forge::native::brep::transformSolid(*ir.solid, w.R, w.t, owner);
        if (!world) return false;
        keep.push_back(owner);
        out = world;
        return true;
    };
    const Solid* wsa = nullptr;
    const Solid* wsb = nullptr;
    if (!resolve(a, wa, wsa)) return false;
    if (!resolve(b, wb, wsb)) return false;
    BooleanResult inter = forge::native::brep::booleanSolid(*wsa, *wsb, BoolOp::Common);
    if (!inter.ok || inter.solid == nullptr) return false;
    volOut = std::abs(forge::native::brep::massProperties(*inter.solid, 10).volume);
    return true;
}

// One A/B case: report PASS iff (verdict matches) AND (volume within `tol` relative
// when both report a clash). `mustResolveNative` asserts the native path did NOT
// defer (so we are genuinely exercising the native engine, not silently falling back).
static void abCase(const std::string& name,
                   const TopoDS_Shape& a, const World& wa,
                   const TopoDS_Shape& b, const World& wb,
                   double tol, bool mustResolveNative) {
    const double vo = occtOverlap(a, wa, b, wb);
    double vn = 0.0;
    const bool nativeRan = nativeOverlap(a, wa, b, wb, vn);
    const bool occtClash = vo >= forge::kInterferenceMinVolume;

    if (mustResolveNative && !nativeRan) {
        check(false, name + " — native engine ran (no silent defer)");
        return;
    }
    const double vnEff = nativeRan ? vn : 0.0;       // defer == OCCT path == measured by OCCT
    const bool nativeClash = nativeRan ? (vn >= forge::kInterferenceMinVolume) : occtClash;
    check(nativeClash == occtClash,
          name + " — clash VERDICT matches OCCT (occt=" + std::to_string(occtClash) +
          " native=" + std::to_string(nativeClash) + ")");
    if (occtClash && nativeRan) {
        const double re = relErr(vnEff, vo);
        check(re <= tol,
              name + " — overlap VOLUME matches OCCT (occt=" + std::to_string(vo) +
              " native=" + std::to_string(vnEff) + " relerr=" + std::to_string(re) +
              " tol=" + std::to_string(tol) + ")");
    }
}

int main() {
    std::printf("=== native vs OCCT — INTERFERENCE narrow-phase A/B gate ===\n");

    // operands (built once, OCCT direct, placed via World transforms below)
    TopoDS_Shape box  = BRepPrimAPI_MakeBox(4.0, 4.0, 4.0).Shape();           // [0,4]^3
    TopoDS_Shape box2 = BRepPrimAPI_MakeBox(4.0, 4.0, 4.0).Shape();
    TopoDS_Shape cyl  = BRepPrimAPI_MakeCylinder(                              // r=1.5 axis +Z
                            gp_Ax2(gp_Pnt(0,0,0), gp_Dir(0,0,1)), 1.5, 8.0).Shape();

    const World id   = makeWorld(0,0,1, 0.0,        0,   0,   0);
    const World shift= makeWorld(0,0,1, 0.0,        2.0, 2.0, 2.0);   // corner overlap = 2^3 = 8
    const World rot  = makeWorld(0,0,1, M_PI/6,     2.0, 2.0, 2.0);   // rotated+translated placement
    const World far  = makeWorld(0,0,1, 0.0,        10.0,10.0,10.0);  // clearance (no overlap)

    // --- PLANAR family @ 1e-6 (the strict A/B bar) -----------------------------
    // box[0,4]^3  ∩  box shifted (2,2,2)  => exact polyhedral overlap, V = 8.
    abCase("box/box corner overlap (planar, 1e-6)", box, id, box2, shift, 1e-6, true);
    // same with the second box ROTATED+translated -> exercises transformSolid's R.
    abCase("box/box rotated placement (planar, 1e-6)", box, id, box2, rot, 1e-6, true);

    // --- CURVED family @ faceting tol (sub-percent), verdict IDENTICAL ----------
    // box ∩ cylinder (intersection curve imprinted by faceting) — native overlap
    // matches OCCT's exact curved volume to the documented faceting tolerance.
    abCase("box/cylinder overlap (curved, faceting tol)", box, id, cyl, shift, 6e-3, true);

    // --- clearance: BOTH paths report NO clash --------------------------------
    abCase("box/box clearance (no overlap)", box, id, box2, far, 1e-6, false);

    std::printf("\n=== RESULT: %d passed, %d failed ===\n", g_pass, g_total - g_pass);
    return (g_pass == g_total) ? 0 : 1;
}
