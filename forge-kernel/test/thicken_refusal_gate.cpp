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
// things that together make it loud, on an input the engine declines on one side
// and builds on the other:
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
// THE FIXTURE, and why this one. Two 10x10 plates folded at SIXTY degrees along a
// shared straight edge. On one offset side the fold is CONVEX and the engine builds
// it exactly (prisms plus the cylindrical sector wedge; test/ab_native_thicken_occt.cpp
// case 13 matches live OCCT on the full observable vector). On the other side the
// fold is ACUTE and CONCAVE: a face prism would pass through the neighbouring plate,
// putting material on the wrong side of the sheet (MEASURED before the rule: native
// 188.452995 with the bbox reaching z = -0.5, OCCT 182.679492), and the
// bisector-trimmed prism that would fix it is not built. So it declines.
//
// ★ THIS FIXTURE REPLACED THE THREE-PLATE CORNER, AND WHY THAT IS NOT A WEAKENING.
//   The corner used to decline on its convex side because the spherical vertex
//   wedge was not built. It IS built now (DERIVATION 4 in NativeThickenShell.cpp,
//   case 8 of the A/B: both sides match OCCT and the closed forms 488 and
//   600 + 30pi + 4pi/3), so the corner no longer has a declined side to test. The
//   property this gate guards — a decline surfaces as a NAMED refusal with a
//   negative control on the same input — is unchanged; only the input that still
//   exercises it changed.
//
// usage: thicken_refusal_gate      (exit 0 iff every check holds)

#include <cmath>
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

// Two 10x10 plates folded at 60 degrees about the y axis.
TopoDS_Shape acuteFold() {
    const double th = 60.0 * 3.14159265358979323846 / 180.0;
    const gp_Pnt b1(10.0 * std::cos(th), 0.0, 10.0 * std::sin(th));
    BRepBuilderAPI_Sewing sew(1.0e-6);
    sew.Add(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0), gp_Pnt(10, 10, 0), gp_Pnt(0, 10, 0)));
    sew.Add(quadFace(gp_Pnt(0, 0, 0), gp_Pnt(0, 10, 0), gp_Pnt(b1.X(), 10, b1.Z()), b1));
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

    const TopoDS_Shape corner = acuteFold();
    ok(!corner.IsNull(), "the 60-degree fold shell sewed");
    if (corner.IsNull()) return 1;

    const double T = 2.0;

    // Which side does the engine decline? Ask the ENGINE, so the gate cannot be
    // wrong about which sign is the convex one on this fixture.
    const bool declinePlus  = forge::occtthicken::thickenShell(corner,  T).IsNull();
    const std::string rPlus  = forge::occtthicken::thickenLastDeferReason();
    const bool declineMinus = forge::occtthicken::thickenShell(corner, -T).IsNull();
    const std::string rMinus = forge::occtthicken::thickenLastDeferReason();
    ok(declinePlus != declineMinus,
       "the engine declines EXACTLY ONE side of the fold (the acute concave one; "
       "the convex one builds)");
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
