// forge-kernel/test/thicken_orientation_gate.cpp
//
// ═══════════════════════════════════════════════════════════════════════════
// THICKEN MUST HAND BACK A POSITIVELY ORIENTED SOLID — FROM EITHER ENGINE,
// UNDER EITHER BUILD FLAG.
// ═══════════════════════════════════════════════════════════════════════════
//
// THE MEASUREMENT THAT FORCED THIS GATE. Over the 600 gold reference solids
// (test/run_corpus_ab_coverage.sh, FAMILIES=THICKEN, all 600, both arms OK and
// BRepCheck-valid on every part):
//
//     native signed volume            POSITIVE on 600/600
//     raw BRepOffset signed volume    NEGATIVE on 600/600
//     signed ratio native/occt        p50 exactly -1.000000, |r+1| <= 1e-9 on 556/600
//     area ratio                      p50 exactly  1.000000
//     agree up to orientation         595/600
//
// ONE SIGN BIT, on every part. This gate exists because that bit is INVISIBLE to
// almost everything that looks at a solid: every self-check in the thicken engine
// itself reads std::fabs(Mass()), and so did the A/B's own volume comparison.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHICH CONVENTION IS RIGHT, AND WHY THAT IS NOT A MATTER OF TASTE
// ═══════════════════════════════════════════════════════════════════════════
// The native engine is the one that is right, and the deciding evidence is
// OCCT's OWN CLASSIFIER, not a house style:
//
//     BRepClass3d_SolidClassifier, on a point strictly inside the wall
//         against the native solid              -> TopAbs_IN
//         against the raw BRepOffset solid      -> TopAbs_OUT
//
// A solid that reports its own interior as OUTSIDE denotes the UNBOUNDED
// COMPLEMENT of the plate. That is a wrong answer to a question with exactly one
// right answer. So the native engine is NOT changed to match the incumbent; the
// incumbent is normalised — which production already did for its own branch —
// and the normalisation now sits OUTSIDE the drop flag so it covers both.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT IT ASSERTS, AND IN BOTH DIRECTIONS
// ═══════════════════════════════════════════════════════════════════════════
// A one-sided gate here would pass for the wrong reason if OCCT ever changed its
// convention, and a gate whose checks have never been SEEN to fail is
// indistinguishable from one that cannot. So every predicate this gate uses is
// also fired against a deliberately reversed copy of a known-good solid:
//
//   RAW      the OCCT oracle's own output MUST still be negative, and MUST still
//            classify its own interior as OUT. If either flips, the normalisation
//            downstream is dead code and this gate says so rather than silently
//            passing.
//   NATIVE   forge::occtthicken::thickenShell MUST be positive and classify IN.
//   ORACLE   forge::testoracle::occtThickenOracle — what production DID before
//            TKOffset family I was deleted — MUST be positive and classify IN.
//   AGREE    native and oracle MUST agree on SIGNED volume. This is now the
//            PARITY ASSERTION for the drop, not merely a fix for a harness bug:
//            it is the check that says the engine which replaced OCCT answers
//            the same question OCCT answered.
//   PROD     forge::part::thickenSurface's registered result MUST be positive and
//            classify IN.
//   NEG      the reversed copy of a known-good solid MUST read negative, MUST
//            classify OUT, and MUST come back positive from orientedPositiveSolid.
//            These are the checks that prove the instrument is not stuck at PASS.
//
// ★ THIS GATE USED TO RUN TWICE, and now runs once, because production now has
//   ONE engine. TKOffset family I (BRepOffset_MakeOffset, 5 symbols) is DELETED
//   from the kernel: there is no second branch for FORGE_THICKEN_NATIVE to select
//   and the variable is inert. The OCCT side of every comparison below comes from
//   test/OcctThickenOracle.hpp, which is TEST-ONLY — it is linked into this gate
//   binary on purpose and into nothing that ships. OCCT is still the oracle; it is
//   no longer the answer.
//
// exit 0 iff every one of them holds.

#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstring>

#include "forge/Features.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/OcctThickenBaseline.hpp"   // orientedPositiveSolid (ships)
#include "OcctThickenOracle.hpp"            // the OCCT answer (TEST-ONLY)
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeThickenShell.hpp"
#endif

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <BRepGProp.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <BRepOffset_Mode.hxx>
#include <GProp_GProps.hxx>
#include <Precision.hxx>
#include <TopAbs_State.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>

namespace {

int g_fail = 0;
int g_checks = 0;

void check(bool ok, const char* what, double got) {
    ++g_checks;
    if (ok) {
        std::printf("  ok    %-58s  %+.6f\n", what, got);
    } else {
        std::printf("  FAIL  %-58s  %+.6f\n", what, got);
        ++g_fail;
    }
}

void checkState(bool ok, const char* what, TopAbs_State st) {
    ++g_checks;
    const char* n = st == TopAbs_IN ? "IN" : st == TopAbs_OUT ? "OUT"
                  : st == TopAbs_ON ? "ON" : "UNKNOWN";
    std::printf("  %-5s %-58s  %s\n", ok ? "ok" : "FAIL", what, n);
    if (!ok) ++g_fail;
}

// A single planar face is the simplest shell BRepOffset will skin into a solid,
// and it is the SAME shape class the corpus A/B skins (the part's largest face).
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

// THE OBJECTIVE TEST. Where is a point that is unambiguously inside the wall of
// the thickened plate? The plate spans [0,w]x[0,h]x[0,t] for a +t offset (OCCT
// and the native engine agree on that: the corpus measures identical bounding
// boxes on 595 of 600). Its centre is interior by a margin of min(w,h,t)/2, which
// for the fixture below is 1 mm — five orders above Precision::Confusion.
TopAbs_State classifyInteriorPoint(const TopoDS_Shape& s, double w, double h, double t) {
    BRepClass3d_SolidClassifier cl(s);
    cl.Perform(gp_Pnt(0.5 * w, 0.5 * h, 0.5 * t), Precision::Confusion());
    return cl.State();
}

}  // namespace

int main() {
    std::printf("[thicken-orientation] thicken must register a POSITIVELY ORIENTED "
                "solid, from either engine\n");

    const double w = 80.0, h = 50.0, t = 2.0;
    const double wantVol = w * h * t;          // a flat prism's volume IS area * thickness
    const TopoDS_Shape shell = planarShell(w, h);

    // ── RAW ── OCCT's own output, the exact call the oracle makes, un-normalised.
    // Written out here rather than delegated, so that if the oracle header ever
    // drifts from what production used to do, these two disagree and the gate says
    // so instead of comparing the oracle against itself.
    TopoDS_Shape raw;
    {
        BRepOffset_MakeOffset mk;
        mk.Initialize(shell, t, 1.0e-4, BRepOffset_Skin,
                      Standard_False, Standard_False, GeomAbs_Arc, Standard_True);
        mk.MakeThickSolid();
        if (!mk.IsDone()) {
            std::printf("  FAIL  raw BRepOffset_MakeOffset did not build a solid\n");
            return 1;
        }
        raw = mk.Shape();
    }
    const double rawVol = signedVolume(raw);
    check(rawVol < 0.0, "RAW BRepOffset_MakeOffset volume is NEGATIVE", rawVol);
    check(std::fabs(std::fabs(rawVol) - wantVol) <= 1.0e-6 * wantVol,
          "RAW |volume| is area*thickness (geometry is RIGHT)", std::fabs(rawVol) - wantVol);
    // THE DECIDING EVIDENCE: OCCT's own classifier calls the raw solid's interior
    // OUTSIDE. That is why the raw orientation is WRONG and not merely different.
    checkState(classifyInteriorPoint(raw, w, h, t) == TopAbs_OUT,
               "RAW solid classifies its own interior as OUT (wrong)",
               classifyInteriorPoint(raw, w, h, t));

    // ── ORACLE ── the WHOLE block TKOffset family I deleted from production:
    // the OCCT call AND the normalisation, now living in test/ and shipped nowhere.
    const TopoDS_Shape base = forge::testoracle::occtThickenOracle(shell, t, 1.0e-4);
    const double baseVol = signedVolume(base);
    check(baseVol > 0.0, "ORACLE occtThickenOracle volume is POSITIVE", baseVol);
    checkState(classifyInteriorPoint(base, w, h, t) == TopAbs_IN,
               "ORACLE classifies its interior as IN",
               classifyInteriorPoint(base, w, h, t));
    check(std::fabs(std::fabs(rawVol) - baseVol) <= 1.0e-9 * wantVol,
          "|volume| UNCHANGED by the normalisation", baseVol - std::fabs(rawVol));

#ifdef FORGE_NATIVE_BREP
    // ── NATIVE ── the engine that replaces the baseline when the option flips.
    const TopoDS_Shape nat = forge::occtthicken::thickenShell(shell, t, 1.0e-4);
    if (nat.IsNull()) {
        std::printf("  FAIL  native thickenShell declined the fixture: %s\n",
                    forge::occtthicken::thickenLastDeferReason());
        ++g_fail;
    } else {
        const double natVol = signedVolume(nat);
        check(natVol > 0.0, "NATIVE thickenShell volume is POSITIVE", natVol);
        checkState(classifyInteriorPoint(nat, w, h, t) == TopAbs_IN,
                   "NATIVE classifies its interior as IN",
                   classifyInteriorPoint(nat, w, h, t));
        check(std::fabs(natVol - wantVol) <= 1.0e-6 * wantVol,
              "NATIVE volume is area*thickness", natVol - wantVol);
        // ── AGREE ── THE PARITY ASSERTION FOR THE DROP, stated as one number:
        // the engine that replaced OCCT and OCCT itself must agree on SIGNED
        // volume, not merely on |volume|. Before the normalisation was hoisted out
        // of the drop flag this ratio read -1, and that was a harness artefact,
        // not geometry — see OcctThickenBaseline.hpp.
        const double ratio = natVol / baseVol;
        check(std::fabs(ratio - 1.0) <= 1.0e-6,
              "NATIVE / ORACLE SIGNED volume ratio is +1", ratio);
    }
#else
    std::printf("  note  built without FORGE_NATIVE_BREP: the NATIVE and AGREE "
                "checks are not compiled\n");
#endif

    // ── PROD ── what the ShapeRegistry actually receives.
    //
    // There is exactly ONE production engine now. FORGE_THICKEN_NATIVE used to
    // select between the native engine and the OCCT fallback; the fallback is
    // deleted, so the variable selects nothing. It is still READ and still
    // PRINTED — silently ignoring an environment variable a driver is still
    // setting is how a gate comes to run one arm twice and report two passes.
    const char* envNat = std::getenv("FORGE_THICKEN_NATIVE");
    const bool envSet = envNat && envNat[0];
    std::printf("  ----  production engine under test: NATIVE (the only one; "
                "TKOffset family I is deleted)%s\n",
                envSet ? "  [FORGE_THICKEN_NATIVE is set and is INERT]" : "");
    forge::ShapeHandle in = forge::ShapeRegistry::instance().add(shell);
    forge::ShapeHandle out = forge::part::thickenSurface(in, t, +1);
    const TopoDS_Shape prod = forge::ShapeRegistry::instance().get(out);
    const double prodVol = signedVolume(prod);
    check(prodVol > 0.0, "PRODUCTION thickenSurface volume is POSITIVE", prodVol);
    checkState(classifyInteriorPoint(prod, w, h, t) == TopAbs_IN,
               "PRODUCTION classifies its interior as IN",
               classifyInteriorPoint(prod, w, h, t));
    check(std::fabs(prodVol - wantVol) <= 1.0e-6 * wantVol,
          "PRODUCTION volume is area*thickness (geometry intact)", prodVol - wantVol);

    // ═══════════════════════════════════════════════════════════════════════
    // NEGATIVE CONTROLS — every predicate above, fired.
    // ═══════════════════════════════════════════════════════════════════════
    // A check that has only ever been seen to pass is not evidence. Each of the
    // three instruments this gate relies on is now pointed at a KNOWN-BAD shape
    // (a good solid, deliberately reversed) and must say so.
    std::printf("  ----  negative controls: the same predicates on a REVERSED good solid\n");
    TopoDS_Shape bad = base;
    bad.Reverse();
    check(signedVolume(bad) < 0.0,
          "NEG signed volume of a reversed good solid is NEGATIVE", signedVolume(bad));
    checkState(classifyInteriorPoint(bad, w, h, t) == TopAbs_OUT,
               "NEG the classifier calls the reversed solid's interior OUT",
               classifyInteriorPoint(bad, w, h, t));
    check(!forge::part::isPositivelyOrientedSolid(bad),
          "NEG isPositivelyOrientedSolid says NO to it",
          forge::part::isPositivelyOrientedSolid(bad) ? 1.0 : 0.0);
    const TopoDS_Shape fixed = forge::part::orientedPositiveSolid(bad);
    check(signedVolume(fixed) > 0.0,
          "NEG orientedPositiveSolid REPAIRS it (the normaliser is not a no-op)",
          signedVolume(fixed));
    check(std::fabs(signedVolume(fixed) - wantVol) <= 1.0e-9 * wantVol,
          "NEG the repair changed the SIGN and nothing else",
          signedVolume(fixed) - wantVol);
    check(forge::part::isPositivelyOrientedSolid(fixed),
          "NEG isPositivelyOrientedSolid says YES to the repair",
          forge::part::isPositivelyOrientedSolid(fixed) ? 1.0 : 0.0);

    std::printf("[thicken-orientation] %d checks, %d failed — %s\n",
                g_checks, g_fail, g_fail == 0 ? "PASS" : "FAIL");
    return g_fail == 0 ? 0 : 1;
}
