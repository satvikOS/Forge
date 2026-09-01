// forge-kernel/test/ft/arc_helix_compile_probe.cpp
//
// ARC AND HELIX, ACTUALLY BUILT.
//
// s0_acceptance_test.cpp proves the two ops PARSE. Parsing is not building, and
// the gap between them is where this repo has been bitten before: a profile that
// silently builds every arc as its CHORD parses perfectly and produces a wrong
// solid with no error anywhere. So this probe links the whole kernel, runs
// forge::ft::compileText, and checks a VECTOR of observables against CLOSED-FORM
// values -- never volume alone. VOLUME CANNOT VALIDATE GEOMETRY: a chord chain
// and a true arc can agree on one number and disagree on the part.
//
// It also asserts the one thing the parse-level suite structurally cannot see:
// HELIX's VALUE KIND. `Builder::kindOf` is a private static inside an anonymous
// namespace, so it is not linkable and not readable from any test. It IS
// observable -- refProfile / refSolid print kindName(kindOf(...)) into their
// refusal -- so the kind is measured through the refusal text rather than
// asserted about, and the helix wire itself is measured directly through the
// ShapeRegistry.
//
// Build + run: forge-kernel/test/ft/build_arc_helix_compile_probe.sh
#include <cmath>
#include <cstdio>
#include <string>

#include "forge/ft/FeatureTree.hpp"
#include "forge/Features.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/MassProps.hpp"

#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <GProp_GProps.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopoDS_Shape.hxx>

namespace {

int gChecks = 0;
int gFails = 0;

void ok(bool cond, const std::string& what, const std::string& detail = std::string()) {
    ++gChecks;
    if (cond) { std::printf("  PASS  %s\n", what.c_str()); return; }
    ++gFails;
    std::printf("  FAIL  %s\n", what.c_str());
    if (!detail.empty()) std::printf("        %s\n", detail.c_str());
}

bool near(double got, double want, double tol) { return std::fabs(got - want) <= tol; }

std::string num(double v) {
    char b[64];
    std::snprintf(b, sizeof b, "%.6f", v);
    return b;
}

forge::ft::CompileResult run(const std::string& ir) {
    return forge::ft::compileText(ir, std::string());
}

void report(const char* title, const forge::ft::CompileResult& r) {
    std::printf("--- %s\n", title);
    std::printf("    ok=%d valid=%d faces=%ld edges=%ld volume=%.6f failedOp=%d\n",
                r.ok ? 1 : 0, r.valid ? 1 : 0, r.faceCount, r.edgeCount, r.volume,
                r.failedOpId);
    std::printf("    bbox=[%.6f %.6f %.6f] .. [%.6f %.6f %.6f]\n",
                r.bboxMin[0], r.bboxMin[1], r.bboxMin[2],
                r.bboxMax[0], r.bboxMax[1], r.bboxMax[2]);
    if (!r.error.empty()) std::printf("    error: %s\n", r.error.c_str());
}

bool has(const std::string& hay, const char* needle) {
    return hay.find(needle) != std::string::npos;
}

const double kPi = 3.14159265358979323846;

}  // namespace

int main() {
    std::printf("=== ARC + HELIX — compiled, not just parsed ===\n\n");

    // ══════════════════════════════════════════════════════════════════════
    // 1. ARC BUILDS A REAL ARC, AND THE CLOSED FORM SAYS SO
    // ══════════════════════════════════════════════════════════════════════
    // A D-shape: the straight chord x=0 from (0,10) down to (0,-10), closed by
    // the semicircle of radius 10 through (10,0). Chosen because EVERY
    // observable has an exact closed form and because it exercises BOTH row
    // kinds in one statement -- row 0 is 2 numbers (the closing segment is the
    // straight one) and row 1 is 4.
    //
    //   area   = pi*r^2/2                   = 157.079633
    //   volume = area * 5                   = 785.398163
    //   bbox   = [0,-10,0] .. [10,10,5]
    //   com    = (4r/3pi, 0, h/2)           = (4.244132, 0, 2.5)
    const double r = 10.0, h = 5.0;
    const double wantVol = kPi * r * r / 2.0 * h;
    const double wantComX = 4.0 * r / (3.0 * kPi);
    forge::ft::CompileResult arc;
    {
        arc = run("%1 = ARC([0 -10; 0 10 10 0])\n"
                  "%2 = EXTRUDE(%1, 5)\n"
                  "RESULT(%2)\n");
        report("ARC D-shape extruded 5mm", arc);
        ok(arc.ok, "the ARC tree COMPILES", arc.error);
        ok(arc.valid, "the resulting solid is VALID (watertight, manifold, oriented)");
        // OBSERVABLE 1 — volume against the closed form.
        ok(near(arc.volume, wantVol, 1e-3),
           "volume == pi*r^2/2*h = " + num(wantVol),
           "got " + num(arc.volume));
        // OBSERVABLE 2 — the bounding box, all six numbers. A chord chain would
        // agree on the two straight sides and be WRONG on max x: the triangle
        // that POLY builds from the same three vertices reaches x=10 too, so
        // this alone is not enough either -- which is the whole point of a
        // vector.
        ok(near(arc.bboxMin[0], 0.0, 1e-6) && near(arc.bboxMin[1], -r, 1e-6) &&
           near(arc.bboxMin[2], 0.0, 1e-6) && near(arc.bboxMax[0], r, 1e-6) &&
           near(arc.bboxMax[1], r, 1e-6) && near(arc.bboxMax[2], h, 1e-6),
           "bbox == [0,-10,0]..[10,10,5]",
           "got [" + num(arc.bboxMin[0]) + " " + num(arc.bboxMin[1]) + " " +
               num(arc.bboxMin[2]) + "] .. [" + num(arc.bboxMax[0]) + " " +
               num(arc.bboxMax[1]) + " " + num(arc.bboxMax[2]) + "]");
        // OBSERVABLE 3 — the CENTRE OF MASS. This is the one a chord chain
        // cannot fake: the half-disc's centroid sits at 4r/3pi = 4.2441 while
        // the inscribed triangle's sits at 10/3 = 3.3333. Volume and bbox can
        // both be argued about; the centroid separates the two shapes by 27%.
        if (arc.ok && arc.handle != 0) {
            const forge::MassProperties mp = forge::massProperties(arc.handle);
            ok(near(mp.cx, wantComX, 1e-3) && near(mp.cy, 0.0, 1e-6) &&
                   near(mp.cz, h / 2.0, 1e-6),
               "centre of mass == (4r/3pi, 0, h/2) = (" + num(wantComX) + ", 0, 2.5)",
               "got (" + num(mp.cx) + ", " + num(mp.cy) + ", " + num(mp.cz) + ")");
            // OBSERVABLE 4 — surface area. Lateral = (chord 2r + arc pi*r) * h,
            // caps = 2 * pi*r^2/2. Independent of all three above.
            const double wantArea = (2.0 * r + kPi * r) * h + kPi * r * r;
            ok(near(mp.area, wantArea, 1e-3),
               "surface area == (2r + pi*r)*h + pi*r^2 = " + num(wantArea),
               "got " + num(mp.area));
        } else {
            ok(false, "centre of mass and area measurable (the tree built)");
            ok(false, "surface area measurable (the tree built)");
        }
        // OBSERVABLE 5 — face count. Three lateral faces (one planar chord, two
        // 90-degree cylindrical panels: profArc splits the 180-degree arc
        // because anything wider than 120 degrees is split on its own circle)
        // plus two caps.
        std::printf("    [reported, not gated] faces=%ld edges=%ld\n",
                    arc.faceCount, arc.edgeCount);
        ok(arc.faceCount >= 4,
           "the solid has >= 4 faces (a chord chain of these 3 vertices has 5 too, "
           "so this is a floor, not a fingerprint)",
           "faces=" + std::to_string(arc.faceCount));
    }

    // ── 1b. THE DIFFERENTIAL: what POLY does with the SAME vertices ─────────
    // This is the failure ARC exists to remove, quantified. POLY over the same
    // three points is the inscribed triangle: 100 mm^2 against 157.08 mm^2. The
    // arc carries 36.34% more material, and POLY reports no error whatever.
    {
        const auto poly = run("%1 = POLY([0 -10; 10 0; 0 10])\n"
                              "%2 = EXTRUDE(%1, 5)\n"
                              "RESULT(%2)\n");
        report("POSITIVE CONTROL — the same three vertices as POLY (chords)", poly);
        ok(poly.ok, "the POLY control also compiles (it is not an error, it is WRONG)",
           poly.error);
        ok(near(poly.volume, 500.0, 1e-6),
           "POLY volume == the inscribed triangle, 100*5 = 500.000000",
           "got " + num(poly.volume));
        const double lost = arc.ok && poly.ok ? (arc.volume - poly.volume) : 0.0;
        ok(arc.ok && poly.ok && lost > 280.0,
           "ARC carries " + num(lost) + " mm^3 MORE than the chord chain "
           "(" + num(arc.volume > 0 ? 100.0 * lost / arc.volume : 0.0) +
           "% of the part) — silently, with no diagnostic, if the op were absent",
           "arc=" + num(arc.volume) + " poly=" + num(poly.volume));
    }

    // ── 1c. THE ARC IS A TRUE CIRCLE, NOT A FINE POLYGON ────────────────────
    // A full circle written as two semicircular ARC rows must measure EXACTLY
    // pi*r^2*h. A tessellation with n sides would measure
    // (n/2)*r^2*sin(2pi/n)*h and fall short: even n=64 loses 0.16%, which is
    // 4.9 mm^3 here and 30x this tolerance.
    {
        const auto circ = run("%1 = ARC([-10 0 0 -10; 10 0 0 10])\n"
                              "%2 = EXTRUDE(%1, 5)\n"
                              "RESULT(%2)\n");
        report("ARC full circle (two semicircular rows) extruded 5mm", circ);
        const double wantCircVol = kPi * r * r * h;
        ok(circ.ok, "the full-circle ARC tree COMPILES", circ.error);
        ok(near(circ.volume, wantCircVol, 5e-3),
           "volume == pi*r^2*h = " + num(wantCircVol) +
               " (a 64-gon would read " + num(32.0 * r * r * std::sin(2.0 * kPi / 64.0) * h) + ")",
           "got " + num(circ.volume));
        ok(circ.ok && near(circ.bboxMin[0], -r, 1e-6) && near(circ.bboxMax[0], r, 1e-6) &&
               near(circ.bboxMin[1], -r, 1e-6) && near(circ.bboxMax[1], r, 1e-6),
           "bbox is the full circumscribing square [-10,-10]..[10,10] in XY");
    }

    // ══════════════════════════════════════════════════════════════════════
    // 2. HELIX PRODUCES A WIRE — MEASURED, NOT ASSERTED
    // ══════════════════════════════════════════════════════════════════════
    // The GT statement, verbatim from bolt_000012_s20260505: an M10 thread
    // spine. 26/1.5 = 17.3333 turns.
    const double pitch = 1.5, height = 26.0, hr = 5.0;
    const double nTurns = height / pitch;
    const double wantLen = nTurns * std::sqrt((2.0 * kPi * hr) * (2.0 * kPi * hr) +
                                              pitch * pitch);
    {
        std::printf("--- HELIX(1.5, 26, 5) measured directly through the kernel verb\n");
        const forge::ShapeHandle wh =
            forge::part::helixWire(pitch, height, hr, 0, 0, 0, 0, 0, 1, /*left*/ false);
        const TopoDS_Shape& s = forge::ShapeRegistry::instance().get(wh);

        // OBSERVABLE 1 — THE SHAPE TYPE. This is the value kind at the geometry
        // level: a TopoDS_WIRE, not a TopoDS_SOLID. Nothing downstream can
        // mistake it for a body because it is not one.
        ok(s.ShapeType() == TopAbs_WIRE,
           "part::helixWire returns a TopoDS_WIRE (ShapeType == TopAbs_WIRE)",
           "ShapeType=" + std::to_string(static_cast<int>(s.ShapeType())));

        // OBSERVABLE 2 — ARC LENGTH against the closed form
        //   n * sqrt((2*pi*R)^2 + pitch^2).
        // This is the check a polyline CANNOT pass: a chord chain is strictly
        // shorter, and the shortfall grows with coarseness. It is also the check
        // that would catch a helix trimmed to the wrong parameter -- the whole
        // reason gp_Dir2d's normalisation matters.
        GProp_GProps lin;
        BRepGProp::LinearProperties(s, lin);
        ok(near(lin.Mass(), wantLen, 1e-4),
           "arc length == n*sqrt((2*pi*R)^2 + pitch^2) = " + num(wantLen),
           "got " + num(lin.Mass()));

        // OBSERVABLE 3 — the bounding box. 17.33 turns wraps the cylinder
        // completely, so X and Y must reach +-R and Z must span exactly the
        // requested height. A helix whose LEFT flag had negated the RISE instead
        // of the winding would come back with z in [-26, 0].
        //
        // ★ THE INSTRUMENT PADS, AND THAT COST A FALSE FAILURE. BRepBndLib::Add
        // returns a CONSERVATIVE OUTER box: on this curve it reported
        // +-5.255558 for a radius of exactly 5, i.e. 0.2556 mm of enlargement,
        // and an assertion written against it would have been an assertion about
        // OCCT's padding policy rather than about the helix. AddOptimal is the
        // tight box. BOTH are printed, so the pad stays visible rather than
        // being quietly tuned away by a wider tolerance.
        Bnd_Box padded;
        BRepBndLib::Add(s, padded);
        double pxa, pya, pza, pxb, pyb, pzb;
        padded.Get(pxa, pya, pza, pxb, pyb, pzb);
        Bnd_Box bb;
        BRepBndLib::AddOptimal(s, bb);
        double xa, ya, za, xb, yb, zb;
        bb.Get(xa, ya, za, xb, yb, zb);
        std::printf("    length=%.6f\n", lin.Mass());
        std::printf("    bbox  (AddOptimal, tight) =[%.6f %.6f %.6f] .. [%.6f %.6f %.6f]\n",
                    xa, ya, za, xb, yb, zb);
        std::printf("    bbox  (Add, padded)       =[%.6f %.6f %.6f] .. [%.6f %.6f %.6f]"
                    "   <- conservative, NOT the extent\n",
                    pxa, pya, pza, pxb, pyb, pzb);
        ok(near(xa, -hr, 1e-3) && near(xb, hr, 1e-3) && near(ya, -hr, 1e-3) &&
               near(yb, hr, 1e-3) && near(za, 0.0, 1e-3) && near(zb, height, 1e-3),
           "tight bbox == [-5,-5,0]..[5,5,26] — it CLIMBS, and it wraps the full cylinder",
           "got [" + num(xa) + " " + num(ya) + " " + num(za) + "] .. [" + num(xb) +
               " " + num(yb) + " " + num(zb) + "]");
        // And the padded box must CONTAIN the tight one — a cheap check that the
        // two calls were made on the same shape and not silently swapped.
        ok(pxa <= xa + 1e-9 && pxb >= xb - 1e-9 && pza <= za + 1e-9 && pzb >= zb - 1e-9,
           "the padded box CONTAINS the tight box (both were measured on this wire)");

        // OBSERVABLE 4 — LEFT is the winding, not the rise. Same length, same
        // bbox, opposite hand. If LEFT had negated the v component the z span
        // would be [-26, 0] and this is where that shows.
        const forge::ShapeHandle lh =
            forge::part::helixWire(pitch, height, hr, 0, 0, 0, 0, 0, 1, /*left*/ true);
        const TopoDS_Shape& sl = forge::ShapeRegistry::instance().get(lh);
        GProp_GProps linL;
        BRepGProp::LinearProperties(sl, linL);
        Bnd_Box bbL;
        BRepBndLib::AddOptimal(sl, bbL);
        double lxa, lya, lza, lxb, lyb, lzb;
        bbL.Get(lxa, lya, lza, lxb, lyb, lzb);
        ok(near(linL.Mass(), wantLen, 1e-4) && near(lza, 0.0, 1e-3) &&
               near(lzb, height, 1e-3),
           "LEFT-handed helix has the SAME length and the SAME z span [0, 26] — "
           "LEFT reverses the winding, never the rise",
           "len=" + num(linL.Mass()) + " z=[" + num(lza) + ", " + num(lzb) + "]");
    }

    // ── 2b. THE VALUE KIND, THROUGH THE ONLY SEAM THAT EXPOSES IT ──────────
    // kindOf is a private static in an anonymous namespace: not linkable, not
    // readable. But refProfile builds its refusal out of
    // kindName(kindOf(OpCode::Helix)), so a kindOf that returned Val::Solid
    // could not produce the string "is a WIRE" -- it would produce a
    // successful, empty extrusion instead. The failing op id must be 2, which
    // is the separate proof that op 1 BUILT: a HELIX that threw would fail at 1.
    {
        const auto r2 = run("%1 = HELIX(1.5, 26, 5)\n"
                            "%2 = EXTRUDE(%1, 10)\n"
                            "RESULT(%2)\n");
        report("EXTRUDE(%helix, 10) — the kind, observed", r2);
        ok(!r2.ok && has(r2.error, "is a WIRE") && has(r2.error, "expected a PROFILE"),
           "EXTRUDE(%helix) is REFUSED and the refusal NAMES the kind: "
           "\"%1 is a WIRE, expected a PROFILE\"",
           "error: " + r2.error);
        ok(r2.failedOpId == 2,
           "the failure is at op 2, NOT op 1 — so HELIX itself built successfully",
           "failedOpId=" + std::to_string(r2.failedOpId));
    }
    {
        const auto r3 = run("%1 = BOX(40, 40, 40)\n"
                            "%2 = HELIX(1.5, 26, 5)\n"
                            "%3 = CUT(%1, %2)\n"
                            "RESULT(%3)\n");
        ok(!r3.ok && has(r3.error, "is a WIRE") && has(r3.error, "expected a SOLID"),
           "CUT(%body, %helix) is REFUSED as \"%2 is a WIRE, expected a SOLID\" — "
           "the curve cannot reach the boolean engine",
           "error: " + r3.error);
    }
    {
        // The failure mode that a SOLID typing would have produced: an EMPTY
        // STEP export reported as a successful build.
        const auto r4 = run("%1 = HELIX(1.5, 26, 5)\nRESULT(%1)\n");
        ok(!r4.ok && has(r4.error, "is not a defined SOLID"),
           "RESULT(%helix) is REFUSED — a helix is not a part, and an empty "
           "export reported as ok=true is the failure this kind prevents",
           "ok=" + std::to_string(r4.ok ? 1 : 0) + " error: " + r4.error);
    }

    // ── 2c. THE BOUNDS ARE CHECKED AT THE STATEMENT, WITH ITS ID ───────────
    {
        const auto z = run("%1 = HELIX(0, 26, 5)\nRESULT(%1)\n");
        ok(!z.ok && has(z.error, "pitch") && z.failedOpId == 1,
           "HELIX(0, ...) is refused at op 1 and the message names `pitch`",
           "error: " + z.error);
    }
    {
        const auto k = run("%1 = HELIX(1.5, 26, 5, SIDEWAYS)\nRESULT(%1)\n");
        ok(!k.ok && has(k.error, "unknown flag"),
           "an UNKNOWN flag is REFUSED, not ignored — a dropped LEFT builds the "
           "opposite-handed thread with no diagnostic",
           "error: " + k.error);
    }

    // ── 2c-bis. HELIX IS A CREATOR, NOT A PREDICATE ────────────────────────
    // GraphAudit::isPredicate names the three ops that return their input
    // unchanged (VERIFY / TAG / SURFCHECK) and are therefore legitimate LEAVES.
    // HELIX was deliberately NOT added to it, and this is the assertion that
    // makes that decision falsifiable instead of merely argued: a helix nothing
    // consumes MUST be reported as an unexplained orphan, naming its own id. If
    // it had been listed as a predicate the tree below would compile silently
    // and the audit would have stopped seeing exactly what it exists to see.
    {
        const auto orph = run("%1 = BOX(20, 20, 20)\n"
                              "%2 = HELIX(1.5, 26, 5)\n"
                              "RESULT(%1)\n");
        ok(!orph.ok && has(orph.error, "unexplained_orphans") &&
               has(orph.error, "%2") && orph.failedOpId == 2,
           "a HELIX nothing consumes is reported as an UNEXPLAINED ORPHAN naming %2 "
           "— it is a CREATOR, not a predicate",
           "ok=" + std::to_string(orph.ok ? 1 : 0) + " failedOp=" +
               std::to_string(orph.failedOpId) + " error: " + orph.error);
    }
    {
        // The control: the same tree with the helix CONSUMED is clean. This is
        // the shape the one GT program has -- SWEEP(%profile, %helix, ...) -- so
        // the orphan report above is about the graph, not about the op.
        const auto used = run("%1 = RING(20, 20, 0)\n"
                              "%2 = RING(12, 12, 30)\n"
                              "%3 = LOFT(%1, %2)\n"
                              "RESULT(%3)\n");
        ok(used.ok, "control: a WIRE that IS consumed leaves no orphan", used.error);
    }

    // ── 2d. POSITIVE CONTROL THE OTHER WAY ─────────────────────────────────
    // The other two WIRE producers still build and still loft. If adding a third
    // Val::Wire case had disturbed the kind, this is where it would show.
    {
        const auto l = run("%1 = RING(20, 20, 0)\n"
                           "%2 = RING(12, 12, 30)\n"
                           "%3 = LOFT(%1, %2)\n"
                           "RESULT(%3)\n");
        report("POSITIVE CONTROL — RING/RING LOFT is unchanged", l);
        ok(l.ok && l.valid && l.volume > 0.0,
           "RING + LOFT still builds a valid solid of positive volume",
           l.error.empty() ? "volume=" + num(l.volume) : l.error);
    }

    std::printf("\n---------------------------------------------------------------\n");
    std::printf("TOTAL  checks=%d  fail=%d\n", gChecks, gFails);
    std::printf("RESULT: %s\n", gFails ? "FAIL" : "PASS");
    return gFails ? 1 : 0;
}
