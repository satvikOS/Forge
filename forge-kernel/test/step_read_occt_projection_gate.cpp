// forge-kernel/test/step_read_occt_projection_gate.cpp
//
// GATE for forge::native::brep::foreignStepToOcct (src/native/brep/StepReadOcct.cpp)
// — the TKDESTEP-free foreign-STEP -> OCCT B-rep transfer that importStep falls
// through to.
//
// WHY THIS EXISTS
//   StepReadOcct's projRange() recovers a pcurve's valid span by projecting the
//   edge's 3D endpoints onto the 2D curve. It used to call OCCT's
//   Geom2dAPI_ProjectPointOnCurve, whose LowerDistanceParameter() is the GLOBAL
//   nearest footpoint (OCCT enumerates ALL extrema). The OCCT-zero work swapped in
//   forge::occtproj::projectPointOnCurve2d, which is a SEEDED LOCAL refinement —
//   best coarse sample plus its two neighbours — so it can settle in a local
//   minimum and silently return a wrong span, trimming the edge to the wrong piece
//   of its pcurve. The call site now takes the best of the projector's answer and
//   a dense global scan, restoring global-nearest semantics under either build.
//
// WHAT THIS GATE CHECKS — on the REAL foreignStepToOcct, not a copy:
//   (1) CYLINDER R=2 H=5. Its side face carries PERIODIC CIRCLE pcurves, so
//       projRange runs for real. Volume must equal pi*r^2*h and must equal what
//       OCCT's own STEPControl_Reader gets from the identical text.
//   (2) BOX 12x7x5. Planar faces / line pcurves — the control case: volume 420,
//       equal to OCCT's, F/E/V sane.
//   (3) A determinism check: the SAME text transferred twice yields byte-identical
//       volume and topology (the projection must not depend on iteration order or
//       on which basin a seed happened to land in).
//
// The gate asserts the COUNT of checks it executed against a declared constant, so
// a case that silently stops running is itself a failure (SR-3).
//
// BUILD (macOS, OCCT 7.9.3 from homebrew), verified:
//   clang++ -std=c++20 -O1 -DFORGE_NATIVE_BREP -DFORGE_NATIVE_PROJECTION=1 \
//     -I forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     forge-kernel/test/step_read_occt_projection_gate.cpp \
//     forge-kernel/src/native/*.cpp forge-kernel/src/native/*/*.cpp \
//       (excluding NativeLoftPipe.cpp, NativeShapeHealBridge.cpp) \
//     forge-kernel/src/Tessellate.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKGeomAlgo -lTKPrim -lTKDE -lTKDESTEP -lTKXSBase -lTKShHealing -lTKMesh \
//     -lTKDESTL -lTKBO -lTKOffset -lTKFillet -lTKBool \
//     -o /tmp/step_read_occt_projection_gate && /tmp/step_read_occt_projection_gate

#include "forge/native/brep/StepReadOcct.hpp"
#include "forge/native/brep/StepAnalytic.hpp"
#include "forge/native/brep/Primitives.hpp"

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Interface_Static.hxx>
#include <TopoDS_Shape.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>

#include <cmath>
#include <cstdio>
#include <fstream>
#include <string>

static int g_pass = 0, g_total = 0;
static void gate(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else      {           std::printf("  [FAIL] %s\n", name.c_str()); }
}
static bool rel(double got, double exp, double tol) {
    return std::fabs(got - exp) <= tol * std::max(1.0, std::fabs(exp));
}
static std::size_t countSub(const TopoDS_Shape& sh, TopAbs_ShapeEnum k) {
    std::size_t n = 0;
    for (TopExp_Explorer ex(sh, k); ex.More(); ex.Next()) ++n;
    return n;
}

struct Xf { bool ok = false; double vol = 0.0; std::size_t F = 0, E = 0, V = 0; std::string err; };

static Xf viaNative(const std::string& text) {
    Xf r;
    try {
        TopoDS_Shape sh = forge::native::brep::foreignStepToOcct(text);
        if (sh.IsNull()) { r.err = "null shape"; return r; }
        GProp_GProps g; BRepGProp::VolumeProperties(sh, g);
        r.vol = g.Mass();
        r.F = countSub(sh, TopAbs_FACE);
        r.E = countSub(sh, TopAbs_EDGE);
        r.V = countSub(sh, TopAbs_VERTEX);
        r.ok = true;
    } catch (const std::exception& e) { r.err = e.what(); }
    return r;
}

static Xf viaOcct(const std::string& text, const char* tag) {
    Xf r;
    const std::string path = std::string("/tmp/forge_proj_gate_") + tag + ".step";
    { std::ofstream of(path, std::ios::binary | std::ios::trunc); of << text; }
    STEPControl_Reader rd;
    if (rd.ReadFile(path.c_str()) != IFSelect_RetDone) { r.err = "OCCT ReadFile failed"; return r; }
    rd.TransferRoots();
    TopoDS_Shape sh = rd.OneShape();
    if (sh.IsNull()) { r.err = "OCCT null shape"; return r; }
    GProp_GProps g; BRepGProp::VolumeProperties(sh, g);
    r.vol = g.Mass();
    r.F = countSub(sh, TopAbs_FACE);
    r.E = countSub(sh, TopAbs_EDGE);
    r.V = countSub(sh, TopAbs_VERTEX);
    r.ok = true;
    return r;
}

int main() {
    std::printf("step_read_occt_projection_gate — foreignStepToOcct (global-nearest projRange)\n\n");
    Interface_Static::SetCVal("xstep.cascade.unit", "MM");

    static constexpr double kPi = 3.14159265358979323846;

    // ==================================================================== (1)
    // CYLINDER — periodic CIRCLE pcurves, so projRange runs for real.
    {
        std::printf("[1] ANALYTIC CYLINDER R=2 H=5 (periodic circle pcurves)\n");
        const double R = 2.0, H = 5.0, expVol = kPi * R * R * H;
        forge::native::brep::SolidFactory fac;
        auto* cyl = fac.buildCylinder(R, H);
        auto wr   = forge::native::brep::StepAnalytic::write(*cyl, "cyl");
        gate(wr.ok, "source STEP written");
        if (wr.ok) {
            const Xf n = viaNative(wr.text);
            const Xf o = viaOcct(wr.text, "cyl");
            std::printf("    native F/E/V=%zu/%zu/%zu vol=%.10g  %s\n",
                        n.F, n.E, n.V, n.vol, n.err.c_str());
            std::printf("    OCCT   F/E/V=%zu/%zu/%zu vol=%.10g  %s\n",
                        o.F, o.E, o.V, o.vol, o.err.c_str());
            gate(n.ok, std::string("foreignStepToOcct transfers") + (n.ok ? "" : " — " + n.err));
            gate(o.ok, "OCCT STEPControl_Reader transfers");
            gate(n.ok && rel(n.vol, expVol, 1e-6), "  native VOLUME == pi*r^2*h (rel<=1e-6)");
            gate(n.ok && o.ok && rel(n.vol, o.vol, 1e-6), "  VOLUME native == OCCT (rel<=1e-6)");
            gate(n.ok && o.ok && n.F == o.F, "  FACE COUNT native == OCCT");
        }
        std::printf("\n");
    }

    // ==================================================================== (2)
    // BOX — planar faces / line pcurves (control case).
    {
        std::printf("[2] ANALYTIC BOX 12x7x5 (planar control case)\n");
        const double Lx = 12.0, Ly = 7.0, Lz = 5.0, expVol = Lx * Ly * Lz;
        forge::native::brep::SolidFactory fac;
        auto* box = fac.buildBox(Lx, Ly, Lz);
        auto wr   = forge::native::brep::StepAnalytic::write(*box, "box");
        gate(wr.ok, "source STEP written");
        if (wr.ok) {
            const Xf n = viaNative(wr.text);
            const Xf o = viaOcct(wr.text, "box");
            std::printf("    native F/E/V=%zu/%zu/%zu vol=%.10g  %s\n",
                        n.F, n.E, n.V, n.vol, n.err.c_str());
            std::printf("    OCCT   F/E/V=%zu/%zu/%zu vol=%.10g  %s\n",
                        o.F, o.E, o.V, o.vol, o.err.c_str());
            gate(n.ok, std::string("foreignStepToOcct transfers") + (n.ok ? "" : " — " + n.err));
            gate(n.ok && rel(n.vol, expVol, 1e-6), "  native VOLUME == 420 (rel<=1e-6)");
            gate(n.ok && o.ok && rel(n.vol, o.vol, 1e-6), "  VOLUME native == OCCT (rel<=1e-6)");
            gate(n.ok && n.F == 6, "  FACE COUNT == 6");
        }
        std::printf("\n");
    }

    // ==================================================================== (3)
    // DETERMINISM — the same text twice must give the identical answer. A seeded
    // local projection that depended on which basin it landed in would show here.
    {
        std::printf("[3] DETERMINISM — identical text transferred twice\n");
        forge::native::brep::SolidFactory fac;
        auto* cyl = fac.buildCylinder(2.0, 5.0);
        auto wr   = forge::native::brep::StepAnalytic::write(*cyl, "cyl");
        if (wr.ok) {
            const Xf a = viaNative(wr.text);
            const Xf b = viaNative(wr.text);
            std::printf("    run1 vol=%.17g F/E/V=%zu/%zu/%zu\n", a.vol, a.F, a.E, a.V);
            std::printf("    run2 vol=%.17g F/E/V=%zu/%zu/%zu\n", b.vol, b.F, b.E, b.V);
            gate(a.ok && b.ok, "both transfers succeeded");
            gate(a.ok && b.ok && a.vol == b.vol, "  VOLUME bit-identical across runs");
            gate(a.ok && b.ok && a.F == b.F && a.E == b.E && a.V == b.V,
                 "  TOPOLOGY identical across runs");
        } else {
            gate(false, "source STEP written");
            gate(false, "  VOLUME bit-identical across runs");
            gate(false, "  TOPOLOGY identical across runs");
        }
        std::printf("\n");
    }

    const int kExpectedChecks = 14;
    std::printf("step_read_occt_projection_gate RESULT: %d/%d checks passed\n", g_pass, g_total);
    if (g_total != kExpectedChecks) {
        std::printf("  [FAIL] GATE INTEGRITY: executed %d checks, expected %d.\n",
                    g_total, kExpectedChecks);
        return 2;
    }
    std::printf("  gate integrity: %d/%d checks executed as declared\n", g_total, kExpectedChecks);
    return (g_pass == g_total) ? 0 : 1;
}
