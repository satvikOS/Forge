// thicken_refusal_gate.cpp — with the OCCT fallback DELETED, does production
// REFUSE BY NAME, or does it quietly hand back something?
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS GATE EXISTS
// ═══════════════════════════════════════════════════════════════════════════
// TKOffset family I (BRepOffset_MakeOffset, 5 symbols) has been deleted from the
// kernel. forge::part::thickenSurface used to answer every input one of two ways:
// the native engine, or — when the native engine declined — OCCT. There is no
// second engine now, so every input the native engine declines has to become
// something, and there are exactly two candidates:
//
//   a REFUSAL, naming the reason                     (what this gate requires)
//   a plausible-looking wrong solid, reported ok     (what this repo has shipped)
//
// The second is not hypothetical. This kernel has already shipped a defect of
// precisely that shape: a valid thin plate healed to volume 0 while reporting
// ok=TRUE with an EMPTY reason string. A silent wrong answer is worse than a
// refusal, because a refusal is visible at the call site and a wrong solid is not.
//
// So the drop is only safe if the decline path is LOUD. This gate asserts three
// things that together make it loud, on the very shape the engine's own defer
// control uses:
//
//   1. thickenSurface THROWS. It does not return a handle.
//   2. The message QUOTES THE ENGINE'S OWN REASON — the same sentence
//      forge::occtthicken::thickenLastDeferReason() returns, not a generic
//      "thicken failed". A reason a caller cannot act on is not a reason.
//   3. The message SAYS THERE IS NO FALLBACK, so the failure is not misread as a
//      transient or as a second engine having also failed.
//
// ★ AND IT CARRIES ITS OWN NEGATIVE CONTROL. A gate that only ever sees a throw
//   cannot distinguish "refuses correctly" from "refuses everything". So the same
//   fixture is thickened on the side the engine DOES support, and that call must
//   SUCCEED and return a positively-oriented solid. Without that half, commenting
//   out the engine entirely would leave this gate green.
//
// THE FIXTURE, and why this one. Three mutually perpendicular unit-square plates
// meeting at the origin. On one offset side the corner is CONCAVE — the per-face
// prisms already overlap and the union is exact (Rossignac & Requicha, CAGD
// 3(2):129-148, 1986), so the engine builds it. On the other the corner is CONVEX,
// which by that same decomposition needs a SPHERICAL VERTEX WEDGE the engine does
// not build. It therefore declines rather than emit a body missing a corner patch.
// That is the honest-defer case this whole family turns on, and it is the exact
// fixture test/ab_native_thicken_occt.cpp uses as its defer(c) control.
//
// usage: thicken_refusal_gate      (exit 0 iff every check holds)

#include <cstdio>
#include <string>

#include "forge/Features.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/OcctThickenBaseline.hpp"
#include "forge/native/brep/NativeThickenShell.hpp"

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

namespace {

int g_fail = 0, g_checks = 0;

void ok(bool cond, const std::string& what) {
    ++g_checks;
    std::printf("  %-5s %s\n", cond ? "ok" : "FAIL", what.c_str());
    if (!cond) ++g_fail;
}

TopoDS_Face quadFace(const gp_Pnt& a, const gp_Pnt& b, const gp_Pnt& c, const gp_Pnt& d) {
    BRepBuilderAPI_MakePolygon poly(a, b, c, d, Standard_True);
    return BRepBuilderAPI_MakeFace(poly.Wire()).Face();
}

// Three mutually perpendicular plates meeting at the origin: defer(c)'s fixture.
TopoDS_Shape threePlateCorner() {
    BRepBuilderAPI_Sewing sew(1.0e-6);
    sew.Add(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0), gp_Pnt(10, 10, 0), gp_Pnt(0, 10, 0)));
    sew.Add(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(0, 10, 0), gp_Pnt(0, 10, 10), gp_Pnt(0, 0, 10)));
    sew.Add(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 10), gp_Pnt(10, 0, 10), gp_Pnt(10, 0, 0)));
    sew.Perform();
    return sew.SewedShape();
}

double signedVolume(const TopoDS_Shape& s) {
    GProp_GProps p;
    BRepGProp::VolumeProperties(s, p);
    return p.Mass();
}

}  // namespace

int main() {
    std::printf("[thicken-refusal] with the OCCT fallback DELETED, a decline must be a "
                "NAMED REFUSAL, never a silent answer\n");

    const TopoDS_Shape corner = threePlateCorner();
    ok(!corner.IsNull(), "the three-plate corner shell sewed");
    if (corner.IsNull()) return 1;

    const double T = 2.0;

    // Which side does the engine decline? Ask the ENGINE, so the gate cannot be
    // wrong about which sign is the convex one on this fixture.
    const bool declinePlus  = forge::occtthicken::thickenShell(corner,  T).IsNull();
    const std::string rPlus  = forge::occtthicken::thickenLastDeferReason();
    const bool declineMinus = forge::occtthicken::thickenShell(corner, -T).IsNull();
    const std::string rMinus = forge::occtthicken::thickenLastDeferReason();
    ok(declinePlus != declineMinus,
       "the engine declines EXACTLY ONE side of the corner (convex needs the "
       "spherical vertex wedge; concave does not)");
    if (declinePlus == declineMinus) return 1;

    const int badSide  = declinePlus ?  1 : -1;
    const int goodSide = declinePlus ? -1 :  1;
    const std::string reason = declinePlus ? rPlus : rMinus;
    std::printf("  ----  engine declines side %+d with reason: \"%s\"\n",
                badSide, reason.c_str());
    ok(!reason.empty(), "the engine's reason is NOT the empty string");

    // ── 1/2 THE REFUSAL ─────────────────────────────────────────────────────
    {
        forge::ShapeHandle in = forge::ShapeRegistry::instance().add(corner);
        bool threw = false;
        std::string msg;
        try {
            forge::ShapeHandle out = forge::part::thickenSurface(in, T, badSide);
            (void)out;
        } catch (const std::exception& e) {
            threw = true;
            msg = e.what();
        }
        ok(threw, "PRODUCTION thickenSurface THROWS on the declined side "
                  "(it does not return a handle)");
        if (threw) {
            std::printf("  ----  message: %s\n", msg.c_str());
            ok(msg.find(reason) != std::string::npos,
               "the message QUOTES THE ENGINE'S OWN REASON verbatim "
               "(not a generic 'thicken failed')");
            ok(msg.find("no OCCT fallback") != std::string::npos ||
               msg.find("NO OCCT fallback") != std::string::npos,
               "the message SAYS THERE IS NO FALLBACK, so the refusal is not "
               "misread as a second engine having also failed");
            ok(msg.find("thickenSurface") != std::string::npos,
               "the message names the operation");
        }
    }

    // ── 2/2 THE NEGATIVE CONTROL ────────────────────────────────────────────
    // Without this, an engine that refused EVERYTHING would pass the half above.
    {
        forge::ShapeHandle in = forge::ShapeRegistry::instance().add(corner);
        bool threw = false;
        double vol = 0.0;
        try {
            forge::ShapeHandle out = forge::part::thickenSurface(in, T, goodSide);
            vol = signedVolume(forge::ShapeRegistry::instance().get(out));
        } catch (const std::exception&) {
            threw = true;
        }
        ok(!threw, "NEGCTL the SUPPORTED side still SUCCEEDS "
                   "(the gate is not passing because thicken refuses everything)");
        ok(vol > 0.0, "NEGCTL and returns a POSITIVELY ORIENTED solid");
        std::printf("  ----  supported side %+d volume %+.6f\n", goodSide, vol);
    }

    std::printf("[thicken-refusal] %d checks, %d failed — %s\n",
                g_checks, g_fail, g_fail == 0 ? "PASS" : "FAIL");
    return g_fail == 0 ? 0 : 1;
}
