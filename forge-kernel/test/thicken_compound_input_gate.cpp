// ─────────────────────────────────────────────────────────────────────────────
// thicken_compound_input_gate.cpp — TKOffset family I, the input-shape widening.
//
// WHAT THIS GATE EXISTS TO CATCH. forge::occtthicken::thickenShell's coplanar
// path (PATH A) used to hand the RAW INPUT to forge::occtPrism, which refuses a
// TopAbs_COMPOUND. Every OCCT boolean returns its result as a compound, so
// thickening the direct output of a cut — a plate with a bore, about as ordinary
// as sheet-metal input gets — declined with
//     "coplanar path: the shell prism failed"
// while the IDENTICAL face unwrapped answered exactly. Before family I the gap
// was invisible: part::thickenSurface fell through to BRepOffset_MakeOffset,
// which answered all three forms. With that engine DELETED a decline is a hard
// THROW, so the deletion is what made a latent engine gap user-visible.
//
// WHY THE ASSERTION IS AN EQUALITY AND NOT A TOLERANCE. A wrapper is not a
// geometry. The compound answer must equal the unwrapped answer on EVERY
// observable — volume, area, centroid, all six bbox bounds, F/E/V — because if
// unwrapping changed the answer at all, the unwrapping would itself be the bug.
// Volume alone cannot validate geometry (this repository has four measured cases
// of matching volume with wrong geometry), so the comparison is the vector.
//
// AND IT CARRIES A NEGATIVE CONTROL, because a gate that only ever sees success
// cannot tell "accepts a wrapper" from "accepts anything": a NON-PLANAR face in
// the same compound wrapper must still be DECLINED, by name.
//
// Closed form for the bored plate: V = (L^2 - pi r^2) t, derived here rather than
// read off either engine, so a gate failure cannot be argued away as a convention.
// ─────────────────────────────────────────────────────────────────────────────
#include <forge/native/brep/NativeThickenShell.hpp>

#include <BRep_Builder.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shell.hxx>
#include <gp_Pln.hxx>

#include <cmath>
#include <cstdio>
#include <string>

namespace {

int passed = 0, failed = 0;

void ck(bool ok, const std::string& what) {
    if (ok) { ++passed; std::printf("  PASS  %s\n", what.c_str()); }
    else    { ++failed; std::printf("  FAIL  %s\n", what.c_str()); }
}

// The full observable vector. Anything less has already let a wrong solid through
// in this repository.
struct Vec {
    bool   built = false;
    double vol = 0, area = 0;
    double cx = 0, cy = 0, cz = 0;
    double b[6] = {0,0,0,0,0,0};
    int    nf = 0, ne = 0, nv = 0;
    bool   valid = false;
    std::string reason;
};

Vec measure(const TopoDS_Shape& in, double t) {
    Vec v;
    const TopoDS_Shape out = forge::occtthicken::thickenShell(in, t, 1.0e-4);
    if (out.IsNull()) {
        v.reason = forge::occtthicken::thickenLastDeferReason();
        return v;
    }
    v.built = true;
    GProp_GProps gv, gs;
    BRepGProp::VolumeProperties(out, gv);
    BRepGProp::SurfaceProperties(out, gs);
    v.vol = gv.Mass(); v.area = gs.Mass();
    v.cx = gv.CentreOfMass().X(); v.cy = gv.CentreOfMass().Y(); v.cz = gv.CentreOfMass().Z();
    Bnd_Box bb; BRepBndLib::Add(out, bb);
    bb.Get(v.b[0], v.b[1], v.b[2], v.b[3], v.b[4], v.b[5]);
    for (TopExp_Explorer e(out, TopAbs_FACE);   e.More(); e.Next()) ++v.nf;
    for (TopExp_Explorer e(out, TopAbs_EDGE);   e.More(); e.Next()) ++v.ne;
    for (TopExp_Explorer e(out, TopAbs_VERTEX); e.More(); e.Next()) ++v.nv;
    v.valid = BRepCheck_Analyzer(out).IsValid();
    return v;
}

// EXACT equality on counts, and 1e-12 relative on the scalars: a wrapper removal
// must not perturb the arithmetic at all. (The measured deviation is 0.0.)
bool sameVector(const Vec& a, const Vec& b) {
    if (a.built != b.built || a.valid != b.valid) return false;
    if (a.nf != b.nf || a.ne != b.ne || a.nv != b.nv) return false;
    auto near = [](double x, double y) {
        const double s = std::max(1.0, std::max(std::fabs(x), std::fabs(y)));
        return std::fabs(x - y) <= 1.0e-12 * s;
    };
    if (!near(a.vol, b.vol) || !near(a.area, b.area)) return false;
    if (!near(a.cx, b.cx) || !near(a.cy, b.cy) || !near(a.cz, b.cz)) return false;
    for (int i = 0; i < 6; ++i) if (!near(a.b[i], b.b[i])) return false;
    return true;
}

void show(const char* tag, const Vec& v) {
    if (!v.built) { std::printf("    %-26s DECLINED \"%s\"\n", tag, v.reason.c_str()); return; }
    std::printf("    %-26s vol=%.9f area=%.6f com=(%.6f,%.6f,%.6f) "
                "bb=[%.4f %.4f %.4f]..[%.4f %.4f %.4f] F/E/V=%d/%d/%d valid=%d\n",
                tag, v.vol, v.area, v.cx, v.cy, v.cz,
                v.b[0],v.b[1],v.b[2],v.b[3],v.b[4],v.b[5], v.nf,v.ne,v.nv, v.valid?1:0);
}

TopoDS_Shape wrapCompound(const TopoDS_Shape& s) {
    TopoDS_Compound c; BRep_Builder b; b.MakeCompound(c); b.Add(c, s); return c;
}

}  // namespace

int main() {
    std::printf("thicken_compound_input_gate — TKOffset family I input widening\n");

    const double L = 200.0, r = 40.0, t = 1.0;

    // ── FIXTURE: a plate with a bore, taken as the DIRECT OUTPUT of a boolean ──
    TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(0,0,0), L, L, 1.0).Shape();
    TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(L/2, L/2, -1.0), gp_Dir(0,0,1)), r, 3.0).Shape();
    TopoDS_Shape cut = BRepAlgoAPI_Cut(box, cyl).Shape();
    ck(cut.ShapeType() == TopAbs_COMPOUND,
       "OCCT's boolean really does return a COMPOUND (the premise of this gate)");

    TopoDS_Face bottom;
    for (TopExp_Explorer ex(cut, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        Bnd_Box b; BRepBndLib::Add(f, b);
        double a0,b0,c0,a1,b1,c1; b.Get(a0,b0,c0,a1,b1,c1);
        if (std::fabs(c0) < 1.0e-4 && std::fabs(c1) < 1.0e-4) { bottom = f; break; }
    }
    if (bottom.IsNull()) { std::printf("FATAL: fixture has no bottom face\n"); return 2; }

    const double exact = (L*L - M_PI*r*r) * t;

    const Vec bare   = measure(bottom, t);
    const Vec comp   = measure(wrapCompound(bottom), t);
    const Vec nested = measure(wrapCompound(wrapCompound(bottom)), t);
    TopoDS_Shell sh; { BRep_Builder b; b.MakeShell(sh); b.Add(sh, bottom); }
    const Vec shell  = measure(sh, t);

    std::printf("  bored plate, t=%.1f, closed form (L^2 - pi r^2) t = %.9f\n", t, exact);
    show("bare face",            bare);
    show("1-child COMPOUND",     comp);
    show("nested COMPOUND",      nested);
    show("SHELL",                shell);

    ck(bare.built,  "the bare face builds (the engine works at all)");
    ck(bare.built && std::fabs(bare.vol - exact) <= 1.0e-9 * exact,
       "the bare face matches the CLOSED FORM, not just the other arm");
    ck(comp.built,   "a 1-child COMPOUND builds  <- THE DEFECT THIS GATE PINS");
    ck(nested.built, "a NESTED compound builds");
    ck(shell.built,  "a SHELL still builds (unchanged path, control)");
    ck(comp.built   && sameVector(bare, comp),
       "COMPOUND answer equals the bare answer on the WHOLE observable vector");
    ck(nested.built && sameVector(bare, nested),
       "NESTED answer equals the bare answer on the WHOLE observable vector");
    ck(shell.built  && sameVector(bare, shell),
       "SHELL answer equals the bare answer on the WHOLE observable vector");
    ck(comp.valid,   "the COMPOUND answer is BRepCheck-valid");

    // ── a multi-face compound: two disjoint coplanar squares ──────────────────
    auto square = [](double x0) {
        TopoDS_Wire w = BRepBuilderAPI_MakePolygon(
            gp_Pnt(x0,0,0), gp_Pnt(x0+10,0,0), gp_Pnt(x0+10,10,0), gp_Pnt(x0,10,0),
            Standard_True).Wire();
        return BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(0,0,0), gp_Dir(0,0,1)), w).Face();
    };
    TopoDS_Compound two; { BRep_Builder b; b.MakeCompound(two);
                           b.Add(two, square(0.0)); b.Add(two, square(50.0)); }
    const Vec twoV = measure(two, 2.0);
    show("two-face COMPOUND", twoV);
    ck(twoV.built, "a two-face coplanar COMPOUND builds");
    ck(twoV.built && std::fabs(twoV.vol - 400.0) <= 1.0e-9 * 400.0,
       "two 10x10 squares thickened 2.0 give exactly 2 * 200 = 400");
    ck(twoV.nf == 12 && twoV.ne == 48 && twoV.nv == 96,
       "and exactly twice one square's 6/24/48 topology — two bodies, not one welded body");
    ck(twoV.built && std::fabs(twoV.b[2]) < 1.0e-6 && std::fabs(twoV.b[5] - 2.0) < 1.0e-6,
       "and both slabs sit on the faces' own (+Z) side: z in [0, 2]");

    // ── MIXED ORIENTATION: one sweep vector cannot serve two normals ──────────
    // Opening the compound up to PATH A exposed this: the coplanarity test compares
    // PLANES, so a REVERSED coplanar face passes it, and PATH A then swept every
    // face along the FIRST face's normal. The reversed square's slab landed on the
    // wrong side while the volume check still read area * thickness. Thicken's side
    // convention is per face, so the engine must DECLINE, by name — as OCCT's
    // BRepOffset_MakeOffset does on the same input (test/OcctThickenOracle.hpp).
    {
        const TopoDS_Face up   = square(0.0);
        const TopoDS_Face down = TopoDS::Face(square(50.0).Reversed());
        const Vec downAlone = measure(down, 2.0);
        show("reversed square ALONE", downAlone);
        ck(downAlone.built && std::fabs(downAlone.b[2] + 2.0) < 1.0e-6 &&
               std::fabs(downAlone.b[5]) < 1.0e-6,
           "CONTROL: a reversed square alone thickens along ITS OWN normal, z in [-2, 0]");

        TopoDS_Compound mixC; { BRep_Builder b; b.MakeCompound(mixC); b.Add(mixC, up); b.Add(mixC, down); }
        TopoDS_Shell    mixS; { BRep_Builder b; b.MakeShell(mixS);    b.Add(mixS, up); b.Add(mixS, down); }
        const Vec mc = measure(mixC, 2.0);
        const Vec ms = measure(mixS, 2.0);
        show("MIXED-orientation COMPOUND", mc);
        show("MIXED-orientation SHELL", ms);
        ck(!mc.built, "a COMPOUND of opposite-oriented coplanar faces is DECLINED "
                      "(it used to put the reversed slab on the wrong side)");
        ck(!ms.built, "the same pair as a SHELL is DECLINED too");
        ck(!mc.built && mc.reason.find("opposite orientations") != std::string::npos,
           "and the decline NAMES the cause");
    }

    // ── NEGATIVE CONTROL ──────────────────────────────────────────────────────
    // The widening accepts a WRAPPER. It must not have become "accept anything":
    // a NON-PLANAR face in the same wrapper must still be declined, by name.
    TopoDS_Shape sph = BRepPrimAPI_MakeSphere(10.0).Shape();
    TopoDS_Face sphFace;
    for (TopExp_Explorer e(sph, TopAbs_FACE); e.More(); e.Next()) {
        sphFace = TopoDS::Face(e.Current()); break;
    }
    const Vec neg = measure(wrapCompound(sphFace), 1.0);
    show("NEG spherical face in a COMPOUND", neg);
    ck(!neg.built,
       "NEGATIVE CONTROL: a non-planar face in a COMPOUND is still DECLINED");
    ck(!neg.built && !neg.reason.empty(),
       "NEGATIVE CONTROL: and the decline carries a NAMED reason, never silence");

    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed ? 1 : 0;
}
