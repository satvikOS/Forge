// forge-kernel/test/thicken_orientation_gate.cpp
//
// THE PRODUCTION PATH MUST HAND THE REGISTRY A POSITIVELY ORIENTED SOLID.
//
// BRepOffset_MakeOffset, called the way forge::part::thickenSurface calls it (Skin +
// makeThickSolid + GeomAbs_Arc), returns a NEGATIVELY ORIENTED solid. That is measured,
// not suspected: the corpus A/B ran this exact call against the native engine over 600
// reference parts and every one of the 407 shared successes disagreed on SIGNED volume
// while agreeing on |volume| with face, edge, vertex, area, centre of mass and bounding
// box all identical.
//
// The existing thicken A/B could not see this, because it compares std::fabs(Mass()).
// Comparing magnitudes is right for the geometry question it asks and blind to this one,
// so the defect survived a harness that was otherwise thorough. This gate asks the
// orientation question directly and ONLY that question.
//
// It is deliberately TWO-SIDED, because a one-sided test here would pass for the wrong
// reason if OCCT ever changed its convention:
//   RAW  — BRepOffset_MakeOffset's own output MUST be negative. If this ever goes
//          positive the normalisation in Features.cpp is dead code and should be revisited,
//          and this gate says so rather than silently passing.
//   PROD — forge::part::thickenSurface's registered result MUST be positive.
// Reverting the Features.cpp normalisation makes PROD fail while RAW still passes, which
// is exactly the discrimination a gate has to have to be worth running.
//
// exit 0 iff both hold.

#include <cstdio>
#include <cmath>

#include "forge/Features.hpp"
#include "forge/ShapeRegistry.hpp"

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepGProp.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <BRepOffset_Mode.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

namespace {

int g_fail = 0;

void check(bool ok, const char* what, double got) {
    if (ok) {
        std::printf("  ok    %-52s  %+.6f\n", what, got);
    } else {
        std::printf("  FAIL  %-52s  %+.6f\n", what, got);
        ++g_fail;
    }
}

// A single planar face is the simplest shell BRepOffset will skin into a solid.
TopoDS_Shape planarShell(double w, double h) {
    BRepBuilderAPI_MakePolygon poly(gp_Pnt(0, 0, 0), gp_Pnt(w, 0, 0),
                                    gp_Pnt(w, h, 0), gp_Pnt(0, h, 0), Standard_True);
    return BRepBuilderAPI_MakeFace(poly.Wire()).Face();
}

double signedVolume(const TopoDS_Shape& s) {
    GProp_GProps p;
    BRepGProp::VolumeProperties(s, p);
    return p.Mass();
}

}  // namespace

int main() {
    std::printf("[thicken-orientation] the production path must register a positively "
                "oriented solid\n");

    const double w = 80.0, h = 50.0, t = 2.0;
    const TopoDS_Shape shell = planarShell(w, h);

    // ---- RAW: OCCT's own output, the exact call Features.cpp makes -----------------
    double rawVol = 0.0;
    {
        BRepOffset_MakeOffset mk;
        mk.Initialize(shell, t, 1.0e-4, BRepOffset_Skin,
                      Standard_False, Standard_False, GeomAbs_Arc, Standard_True);
        mk.MakeThickSolid();
        if (!mk.IsDone()) {
            std::printf("  FAIL  raw BRepOffset_MakeOffset did not build a solid\n");
            return 1;
        }
        rawVol = signedVolume(mk.Shape());
    }
    check(rawVol < 0.0,
          "RAW BRepOffset_MakeOffset volume is NEGATIVE", rawVol);

    // ---- PROD: what the ShapeRegistry actually receives ----------------------------
    forge::ShapeHandle in = forge::ShapeRegistry::instance().add(shell);
    forge::ShapeHandle out = forge::part::thickenSurface(in, t, +1);
    const double prodVol = signedVolume(forge::ShapeRegistry::instance().get(out));

    check(prodVol > 0.0,
          "PRODUCTION thickenSurface volume is POSITIVE", prodVol);

    // The fix must normalise orientation WITHOUT changing the geometry.
    check(std::fabs(std::fabs(rawVol) - std::fabs(prodVol)) <= 1.0e-6 * std::fabs(rawVol),
          "|volume| unchanged by the normalisation", std::fabs(prodVol) - std::fabs(rawVol));

    std::printf("[thicken-orientation] %s\n", g_fail == 0 ? "PASS" : "FAIL");
    return g_fail == 0 ? 0 : 1;
}
