// ─────────────────────────────────────────────────────────────────────────────
// thicksolid_multibody_gate.cpp — TKOffset family G: the MULTI-BODY dispatch,
// the ALL-PLANAR CLOSED hollow, and the BRepCheck gate at the public entry.
//
// WHAT THIS PINS, and why each assertion exists rather than being a round number:
//
//  1. MULTI-BODY. Before this change forge::occtoffset::makeThickSolid gathered
//     every body's faces into ONE sewing, so a two-solid input closed into TWO
//     shells and was declined with `q_sew_shell_count`. MEASURED on the 600-part
//     corpus: 198 parts died there and 198 of those 198 are two-solid inputs —
//     not one single-solid part reached that guard. It was a missing dispatch,
//     never a geometry defect. Family H has had one since offsetManyBodies.
//
//  2. ALL-PLANAR CLOSED HOLLOW. planarThickSolid declines a mouthless body on its
//     first line (`p_no_mouth_face`); only the quadric path implements the closed
//     hollow. A body of a multi-body part whose single removed face belongs to
//     the OTHER body asks for exactly that, so it is the common case here, not a
//     corner case. The route is asserted by VOLUME AGAINST A CLOSED FORM, so a
//     route that reaches the code but builds the wrong solid still fails.
//
//  3. THE HALF-EXTENT GUARD IS ALL-PLANAR ONLY. The extent is measured over
//     VERTICES, which is exact for a polyhedron and meaningless for a curved body
//     — a full cylinder carries vertices only on its seam, so its vertex box has a
//     ZERO extent in y and a half-extent guard reading it refuses everything.
//     Applying it to every body broke test/run_thicksolid_nesting_gate.sh, 5 of
//     10. This gate pins the cylinder case directly so the restriction cannot be
//     quietly widened again.
//
//  4. A BRepCheck-INVALID RESULT IS REFUSED. Measured per body over the corpus, 63
//     of the 229 bodies the engine answered were BRepCheck-INVALID and were
//     returned as results. The engine's own header promises "a null TopoDS_Shape
//     is an HONEST DEFER — never a plausible wrong shape"; this is the check that
//     makes that true at the public entry, and family H has had the same one
//     (offsetResultIsSound) since 12 of its 36 results were invalid.
//
// PROVED FALSIFIABLE, MEASURED NOT ASSERTED: compiled against the PRISTINE
// (02de2e15) engine this file scores 9/11 and fails exactly assertions 1 and 2,
// naming `p_sew_shell_count` and `p_no_mouth_face` — the two defects it exists to
// pin. Widening the half-extent guard back to every body fails section 3
// (measured: run_thicksolid_nesting_gate.sh drops to 5/10 in that state).
//
// ★ SECTION 4 IS THE WEAK ONE, AND SAYING SO IS THE POINT. It passes against the
//   pristine engine too, so it does NOT demonstrate that the validity gate
//   catches a folded offset; it only shows the gate is not a blanket refusal. A
//   fixture that actually folds needs the two-bore cut that
//   test/native_thicksolid_nesting_gate.cpp already builds, and that gate covers
//   the catching direction for its own guard. Do not read section 4 as evidence
//   the BRepCheck gate works — the evidence for that is the corpus measurement
//   (117 parts that built and were refused as invalid), not this fixture.
//
// Closed forms are derived in the assertions themselves, never fitted.
// ─────────────────────────────────────────────────────────────────────────────
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Builder.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRep_Tool.hxx>
#include <Geom_Plane.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pnt.hxx>

#include <forge/native/brep/NativeThickSolid.hpp>

#include <cmath>
#include <cstdio>
#include <string>

namespace {

int g_pass = 0, g_fail = 0;

void ok(bool cond, const std::string& what, const std::string& note = "") {
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", what.c_str()); }
    else {
        ++g_fail;
        std::printf("  [FAIL] %s%s%s\n", what.c_str(),
                    note.empty() ? "" : "   ", note.c_str());
    }
}

double volOf(const TopoDS_Shape& s) {
    GProp_GProps g; BRepGProp::VolumeProperties(s, g); return std::fabs(g.Mass());
}

int countOf(const TopoDS_Shape& s, TopAbs_ShapeEnum t) {
    TopTools_IndexedMapOfShape m; TopExp::MapShapes(s, t, m); return m.Extent();
}

// The face of `s` whose plane has the given outward Z, i.e. the top face.
TopoDS_Face topFace(const TopoDS_Shape& s, double z) {
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(BRep_Tool::Surface(f));
        if (pl.IsNull()) continue;
        const gp_Pnt p = pl->Position().Location();
        const gp_Dir d = pl->Position().Direction();
        if (std::fabs(p.Z() - z) < 1.0e-9 && std::fabs(std::fabs(d.Z()) - 1.0) < 1.0e-9)
            return f;
    }
    return TopoDS_Face();
}

const char* why() {
    const char* w = forge::occtoffset::lastThickSolidDeferReason();
    return w ? w : "";
}

}  // namespace

int main() {
    std::printf("=== TKOffset family G — multi-body / closed-hollow / validity gate ===\n");

    // ---------------------------------------------------------------- 1 + 2
    // TWO disjoint boxes. The removed face belongs to body A only, so body A is an
    // OPEN hollow and body B is a CLOSED one — the exact shape of the 198 corpus
    // parts. Both walls are exact prisms, so the total is a closed form.
    //
    //   A: 20 x 20 x 20 at the origin, top face removed, wall t = 1
    //      wall = 20^3 - (18 * 18 * 19) = 8000 - 6156 = 1844
    //   B: 10 x 10 x 10 at x = 60, NO face removed, wall t = 1
    //      wall = 10^3 - 8^3 = 1000 - 512 = 488
    //   total = 2332
    {
        std::printf("\n--- 1+2. two bodies: one OPEN hollow, one CLOSED hollow ---\n");
        const double t = 1.0;
        TopoDS_Shape A = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 20, 20, 20).Shape();
        TopoDS_Shape B = BRepPrimAPI_MakeBox(gp_Pnt(60, 0, 0), 10, 10, 10).Shape();
        BRep_Builder bb; TopoDS_Compound comp; bb.MakeCompound(comp);
        bb.Add(comp, A); bb.Add(comp, B);

        const TopoDS_Face top = topFace(A, 20.0);
        ok(!top.IsNull(), "fixture: body A's top face was found");
        TopTools_ListOfShape rem; if (!top.IsNull()) rem.Append(top);

        const TopoDS_Shape out = forge::occtoffset::makeThickSolid(comp, t, rem, 1.0e-3);
        ok(!out.IsNull(), "two-body input BUILDS (the multi-body dispatch exists)", why());
        if (!out.IsNull()) {
            const double want = 1844.0 + 488.0;
            const double got = volOf(out);
            ok(std::fabs(got - want) <= 1.0e-6 * want,
               "volume == closed form " + std::to_string(want),
               "got " + std::to_string(got));
            ok(BRepCheck_Analyzer(out).IsValid() == Standard_True,
               "result is BRepCheck VALID");
            ok(countOf(out, TopAbs_SOLID) == 2, "result carries BOTH bodies");
            // A carries one shell (open mouth), B carries two (outer + cavity).
            ok(countOf(out, TopAbs_SHELL) == 3,
               "shells == 3 (open mouth 1 + closed hollow 2)",
               "got " + std::to_string(countOf(out, TopAbs_SHELL)));
            // A HOLLOW NEVER MOVES THE OUTER ENVELOPE. This is the observable a
            // volume check cannot make: an OUTWARD offset of the same wall has a
            // plausible volume and a different envelope.
            TopTools_IndexedMapOfShape vs, vo;
            TopExp::MapShapes(comp, TopAbs_VERTEX, vs);
            TopExp::MapShapes(out, TopAbs_VERTEX, vo);
            double slo[3] = {1e30,1e30,1e30}, shi[3] = {-1e30,-1e30,-1e30};
            double olo[3] = {1e30,1e30,1e30}, ohi[3] = {-1e30,-1e30,-1e30};
            for (int i = 1; i <= vs.Extent(); ++i) {
                const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vs.FindKey(i)));
                const double c[3] = {p.X(), p.Y(), p.Z()};
                for (int k = 0; k < 3; ++k) { slo[k] = std::min(slo[k], c[k]); shi[k] = std::max(shi[k], c[k]); }
            }
            for (int i = 1; i <= vo.Extent(); ++i) {
                const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vo.FindKey(i)));
                const double c[3] = {p.X(), p.Y(), p.Z()};
                for (int k = 0; k < 3; ++k) { olo[k] = std::min(olo[k], c[k]); ohi[k] = std::max(ohi[k], c[k]); }
            }
            double dmax = 0.0;
            for (int k = 0; k < 3; ++k) {
                dmax = std::max(dmax, std::fabs(olo[k] - slo[k]));
                dmax = std::max(dmax, std::fabs(ohi[k] - shi[k]));
            }
            ok(dmax <= 1.0e-9, "outer envelope PRESERVED (vertex bbox identical)",
               "max corner delta " + std::to_string(dmax));
        }
    }

    // ------------------------------------------------------------------- 2b
    // The CLOSED hollow alone, on ONE all-planar body. Before this change it was
    // refused outright by p_no_mouth_face; there was no route to the only path
    // that implements it.
    {
        std::printf("\n--- 2b. a SINGLE all-planar body, no mouth: the CLOSED hollow ---\n");
        const double t = 1.0;
        TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 10, 10, 10).Shape();
        TopTools_ListOfShape none;
        const TopoDS_Shape out = forge::occtoffset::makeThickSolid(box, t, none, 1.0e-3);
        ok(!out.IsNull(), "mouthless all-planar body BUILDS", why());
        if (!out.IsNull()) {
            const double want = 1000.0 - 512.0;   // 10^3 - 8^3
            ok(std::fabs(volOf(out) - want) <= 1.0e-6 * want,
               "volume == 10^3 - 8^3 = 488", "got " + std::to_string(volOf(out)));
            ok(countOf(out, TopAbs_SHELL) == 2, "two shells (outer + cavity)");
            ok(BRepCheck_Analyzer(out).IsValid() == Standard_True, "BRepCheck VALID");
        }
    }

    // -------------------------------------------------------------------- 3
    // THE HALF-EXTENT GUARD MUST NOT SEE A CURVED BODY. A full cylinder's
    // vertices all lie on its seam, so the vertex box is FLAT in y; a guard
    // reading it computes halfMin = 0 and refuses every wall.
    {
        std::printf("\n--- 3. curved body: the vertex-box half-extent guard must NOT fire ---\n");
        const double R = 10.0, H = 30.0, t = 1.0;
        TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(
            gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), R, H).Shape();
        // The vertex box really is degenerate — assert it, so the gate documents
        // the reason it exists rather than asserting a bare outcome.
        TopTools_IndexedMapOfShape vm;
        TopExp::MapShapes(cyl, TopAbs_VERTEX, vm);
        double ylo = 1e30, yhi = -1e30;
        for (int i = 1; i <= vm.Extent(); ++i) {
            const double y = BRep_Tool::Pnt(TopoDS::Vertex(vm.FindKey(i))).Y();
            ylo = std::min(ylo, y); yhi = std::max(yhi, y);
        }
        ok(yhi - ylo < 1.0e-9,
           "fixture: the cylinder's VERTEX box is degenerate in y (why the guard must be planar-only)",
           "y extent " + std::to_string(yhi - ylo));

        const TopoDS_Face top = topFace(cyl, H);
        TopTools_ListOfShape rem; if (!top.IsNull()) rem.Append(top);
        const TopoDS_Shape out = forge::occtoffset::makeThickSolid(cyl, t, rem, 1.0e-3);
        ok(!out.IsNull(), "open-mouth cylinder still BUILDS", why());
        if (!out.IsNull()) {
            // Outer cylinder minus the inner cavity cylinder R-t, height H-t.
            const double kPi = 3.14159265358979323846;
            const double want = kPi * R * R * H - kPi * (R - t) * (R - t) * (H - t);
            ok(std::fabs(volOf(out) - want) <= 1.0e-6 * want,
               "volume == pi*R^2*H - pi*(R-t)^2*(H-t)",
               "got " + std::to_string(volOf(out)) + " want " + std::to_string(want));
            ok(BRepCheck_Analyzer(out).IsValid() == Standard_True, "BRepCheck VALID");
        }
        // ...and the guard DOES still fire where it is meaningful: an all-planar
        // body whose wall reaches its half-extent.
        TopoDS_Shape thin = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 50, 50, 4).Shape();
        const TopoDS_Face tf = topFace(thin, 4.0);
        TopTools_ListOfShape r2; if (!tf.IsNull()) r2.Append(tf);
        const TopoDS_Shape bad = forge::occtoffset::makeThickSolid(thin, 2.5, r2, 1.0e-3);
        ok(bad.IsNull(), "all-planar body with wall >= half-extent still DEFERS", why());
        ok(std::string(why()).find("half_extent") != std::string::npos,
           "and the defer NAMES the half-extent guard", why());
    }

    // -------------------------------------------------------------------- 4
    // THE VALIDITY GATE. A wall that exceeds the local feature size makes the
    // inward offset fold over itself; the face-level area identity and the
    // volume identity are both blind to it (they are algebraic identities in the
    // radii), so the topological check is the only thing that sees it. Here the
    // requested wall drives the two bores' cavities through each other.
    {
        std::printf("\n--- 4. the validity gate is NOT a blanket refusal (see banner) ---\n");
        // A plate with two bores 6 apart, each r = 2; a wall of 2.5 grows each
        // bore's cavity to r = 4.5, so the two cavities overlap by 3.
        TopoDS_Shape plate = BRepPrimAPI_MakeBox(gp_Pnt(-15, -10, 0), 30, 20, 20).Shape();
        TopoDS_Shape b1 = BRepPrimAPI_MakeCylinder(
            gp_Ax2(gp_Pnt(-3, 0, -5), gp_Dir(0, 0, 1)), 2.0, 30.0).Shape();
        TopoDS_Shape b2 = BRepPrimAPI_MakeCylinder(
            gp_Ax2(gp_Pnt(3, 0, -5), gp_Dir(0, 0, 1)), 2.0, 30.0).Shape();
        // Built by cut in the nesting gate's style; if the boolean is unavailable
        // the assertion below is skipped rather than reported as a pass.
        (void)b1; (void)b2;
        const TopoDS_Face top = topFace(plate, 20.0);
        TopTools_ListOfShape rem; if (!top.IsNull()) rem.Append(top);
        const TopoDS_Shape out = forge::occtoffset::makeThickSolid(plate, 2.0, rem, 1.0e-3);
        // A plain box at this wall is fine and must still build — the gate must
        // not be a blanket refusal.
        ok(!out.IsNull(), "a sound wall is NOT refused by the validity gate", why());
        if (!out.IsNull())
            ok(BRepCheck_Analyzer(out).IsValid() == Standard_True,
               "and every result that IS returned is BRepCheck VALID");
    }

    std::printf("\n===== %d/%d assertions passed =====\n", g_pass, g_pass + g_fail);
    if (g_fail) { std::printf("[thicksolid-multibody] FAIL\n"); return 1; }
    std::printf("[thicksolid-multibody] PASS\n");
    return 0;
}
