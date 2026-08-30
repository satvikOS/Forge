// thicksolid_mixed_closedform.cpp — CLOSED-FORM gate for the MIXED
// polygon-plus-quadric thick solid (src/native/brep/NativeThickSolid.cpp,
// PART 3b + the quadric path's polygon branches).
//
// ===========================================================================
// WHY A CLOSED FORM AND NOT AN OCCT A/B
// ===========================================================================
// An A/B against BRepOffsetAPI_MakeThickSolid assumes OCCT is right, and for
// THIS operation it demonstrably is not. reports/TKOFFSET_DECOMPOSITION.md §4.2
// measured OCCT returning the CAVITY instead of the WALL with IsDone() == true;
// the 600-part corpus A/B measures OCCT returning a shape that fails
// BRepCheck_Analyzer on 133 of 133 successes, and a shape with MORE volume than
// the solid it hollowed on 6 of them. Every reference below is derived from the
// geometry and depends on no kernel at all.
//
// ===========================================================================
// THE DERIVATIONS
// ===========================================================================
// Shell convention: retained faces move INWARD by t along their own outward
// normal, so the OUTER boundary is preserved and the cavity is inset by t; a
// removed face is a mouth, and the cavity is PINNED to that face's original
// plane (the wall ends flush with the opening, leaving a lip of width t).
//
// (A) PLATE WITH A THROUGH-HOLE, TOP REMOVED — the case the mixed path exists
//     for, and the shape the corpus census says the corpus is made of.
//     Box 40 x 40 x 20 (x,y in [-20,20], z in [0,20]) with a central through
//     hole R = 5 about the z axis. Remove the top face z = 20. Wall t = 2.
//
//       source volume   = 40*40*20 - pi*5^2*20            = 32000 - 500*pi
//       the 4 side planes move in by 2  -> a 36 x 36 inset rectangle
//       the base plane z=0 moves to z=2
//       the hole cylinder's outward normal points INTO the hole, so moving into
//         the material grows it: R = 5 -> 7
//       the top plane is the mouth: the cavity is pinned at z = 20
//       cavity          = (36*36 - pi*7^2) * (20 - 2)     = 23328 - 882*pi
//       WALL VOLUME     = 8672 + 382*pi                   = 9872.1237...
//
//     Centre of mass, by first moments about z (both the source and the cavity
//     are prisms, so each has its own centroid exactly at its mid-height):
//       source moment   = 10 * (32000 - 500*pi)
//       cavity moment   = 11 * 18 * (1296 - 49*pi)
//       WALL COM z      = (63392 + 4702*pi) / (8672 + 382*pi) = 7.9177...
//     x and y are 0 by symmetry.
//
//     Total surface area, face by face:
//       outer base     1600 - 25*pi        outer sides   4*40*20 = 3200
//       outer hole     2*pi*5*20 = 200*pi  (top face removed)
//       cavity base    1296 - 49*pi        cavity sides  4*36*18 = 2592
//       cavity hole    2*pi*7*18 = 252*pi
//       lip at z=20    (1600 - 25*pi) - (1296 - 49*pi) = 304 + 24*pi
//       TOTAL AREA     = 8992 + 402*pi                   = 10254.9...
//
//     FACE CENSUS, which is what rejects a mirror image or a wrong-end wall —
//     volume and area cannot. The construction is 5 retained outer planes (base
//     + 4 sides; the top is the mouth) + the outer hole cylinder, 5 cavity
//     planes + the cavity hole cylinder, and TWO lips -- one per wire of the
//     mouth, the band between the outer square rim and its inset image and the
//     band between the R=5 hole rim and its R=7 image, which together are the
//     304 + 24*pi in the area sum above. 14 faces = 12 planar + 2 cylindrical,
//     the two cylinders of radius EXACTLY 5 (area 200*pi) and 7 (area 252*pi).
//
// (B) CYLINDER, TOP REMOVED — the ALL-CIRCULAR case that already worked.
//     R = 10, H = 30, t = 2, top removed. Lateral 10 -> 8, base z=0 -> z=2,
//     cavity z in [2, 30]:
//       WALL VOLUME = pi*(10^2*30 - 8^2*28) = 1208*pi = 3795.6...
//     It is here as a REGRESSION control: PART 3b must be strictly additive, so
//     a face this path already handled has to go on producing the same answer.
//
// NEGATIVE CONTROLS — a gate that only ever says yes has proved nothing.
//   (N1) Case A with t = 25, deeper than the solid's smallest half-extent:
//        must DEFER (a null shape), not return a collapsed solid.
//   (N2) A box with a SLOT cut by a cylinder that breaks the side wall, so a
//        planar face carries a wire mixing LINE and ARC edges: must DEFER with
//        reason q_planar_wire_not_circle_or_polygon. This is the guard that
//        stands between the corpus's 228 reachable parts and its 105
//        arc-bearing ones, and a gate that never saw it fire could not tell a
//        scope statement from a silent wrong answer.
//   (N3) A part with a NURBS face must DEFER with q_surface_unsupported.
//
// Exit 0 iff every case matches. Prints one line per assertion.
// BUILD: test/build_thicksolid_mixed_closedform.sh

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_NurbsConvert.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

#include "forge/native/brep/NativeThickSolid.hpp"

namespace {

const double kPi = 3.14159265358979323846;
int g_bad = 0;
int g_ok = 0;

void ok(const char* what, bool good, const char* detail = "") {
    std::printf("  %-52s %s%s%s\n", what, good ? "ok" : "FAIL",
                *detail ? "  " : "", detail);
    if (good) ++g_ok; else ++g_bad;
}

void near(const char* what, double got, double want, double rel) {
    const bool good = std::fabs(got - want) <= rel * std::max(1.0, std::fabs(want));
    char d[160];
    std::snprintf(d, sizeof d, "got %.10g want %.10g", got, want);
    ok(what, good, d);
}

double volOf(const TopoDS_Shape& s) {
    GProp_GProps g;
    BRepGProp::VolumeProperties(s, g);
    return g.Mass();
}
double areaOf(const TopoDS_Shape& s) {
    GProp_GProps g;
    BRepGProp::SurfaceProperties(s, g);
    return g.Mass();
}
gp_Pnt comOf(const TopoDS_Shape& s) {
    GProp_GProps g;
    BRepGProp::VolumeProperties(s, g);
    return g.CentreOfMass();
}

Handle(Geom_Surface) basis(const Handle(Geom_Surface)& s) {
    Handle(Geom_Surface) cur = s;
    for (int i = 0; i < 8 && !cur.IsNull(); ++i) {
        Handle(Geom_RectangularTrimmedSurface) rt =
            Handle(Geom_RectangularTrimmedSurface)::DownCast(cur);
        if (rt.IsNull()) break;
        cur = rt->BasisSurface();
    }
    return cur;
}

// ── the plate: 40 x 40 x 20 centred on the z axis, with a R=5 through hole ──
TopoDS_Shape plate() {
    const TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(-20, -20, 0), 40.0, 40.0, 20.0).Shape();
    const TopoDS_Shape drill = BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(0, 0, -5), gp_Dir(0, 0, 1)), 5.0, 30.0).Shape();
    return BRepAlgoAPI_Cut(box, drill).Shape();
}

// The planar face of `s` whose plane is z == zWant, picked by its centroid.
TopoDS_Face planarFaceAtZ(const TopoDS_Shape& s, double zWant) {
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(s, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm.FindKey(i));
        Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(basis(BRep_Tool::Surface(f)));
        if (pl.IsNull()) continue;
        if (std::fabs(pl->Position().Direction().Z()) < 0.99) continue;
        GProp_GProps g;
        BRepGProp::SurfaceProperties(f, g);
        if (std::fabs(g.CentreOfMass().Z() - zWant) < 1e-6) return f;
    }
    return TopoDS_Face();
}

void caseA() {
    std::printf("(A) plate 40x40x20 with a R=5 through hole, top removed, t=2\n");
    const TopoDS_Shape src = plate();
    const TopoDS_Face top = planarFaceAtZ(src, 20.0);
    if (top.IsNull()) { ok("found the top face", false); return; }

    TopTools_ListOfShape rm;
    rm.Append(top);
    const TopoDS_Shape w = forge::occtoffset::makeThickSolid(src, 2.0, rm, 1.0e-3);
    if (w.IsNull()) {
        ok("engine built the wall", false, forge::occtoffset::lastThickSolidDeferReason());
        return;
    }
    ok("engine built the wall", true);

    near("wall volume  = 8672 + 382*pi", volOf(w), 8672.0 + 382.0 * kPi, 1e-9);
    near("wall area    = 8992 + 402*pi", areaOf(w), 8992.0 + 402.0 * kPi, 1e-9);
    const gp_Pnt c = comOf(w);
    near("wall com x   = 0", c.X(), 0.0, 1e-9);
    near("wall com y   = 0", c.Y(), 0.0, 1e-9);
    near("wall com z   = (63392+4702pi)/(8672+382pi)", c.Z(),
         (63392.0 + 4702.0 * kPi) / (8672.0 + 382.0 * kPi), 1e-9);

    // FACE CENSUS. Volume and area are both invariant under the mirror image and
    // under building the wall at the wrong end; the two cylinder RADII are not.
    int nPlane = 0, nCyl = 0;
    double rSmall = 0.0, rBig = 0.0, aSmall = 0.0, aBig = 0.0;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(w, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm.FindKey(i));
        const Handle(Geom_Surface) s = basis(BRep_Tool::Surface(f));
        if (!Handle(Geom_Plane)::DownCast(s).IsNull()) { ++nPlane; continue; }
        Handle(Geom_CylindricalSurface) cy = Handle(Geom_CylindricalSurface)::DownCast(s);
        if (cy.IsNull()) continue;
        ++nCyl;
        GProp_GProps g;
        BRepGProp::SurfaceProperties(f, g);
        if (cy->Radius() < 6.0) { rSmall = cy->Radius(); aSmall = g.Mass(); }
        else                    { rBig   = cy->Radius(); aBig   = g.Mass(); }
    }
    char cd[96];
    std::snprintf(cd, sizeof cd, "got %d planar, %d cylindrical", nPlane, nCyl);
    ok("face census: 12 planar (5 outer + 5 cavity + 2 lips)", nPlane == 12, cd);
    ok("face census: 2 cylindrical (outer hole + cavity hole)", nCyl == 2, cd);
    near("outer hole radius  = 5", rSmall, 5.0, 1e-9);
    near("cavity hole radius = 7", rBig, 7.0, 1e-9);
    near("outer hole area    = 200*pi", aSmall, 200.0 * kPi, 1e-9);
    near("cavity hole area   = 252*pi", aBig, 252.0 * kPi, 1e-9);

    BRepCheck_Analyzer an(w);
    ok("BRepCheck_Analyzer valid", an.IsValid());
}

void caseB() {
    std::printf("(B) REGRESSION: cylinder R=10 H=30, top removed, t=2 (all-circular)\n");
    const TopoDS_Shape src = BRepPrimAPI_MakeCylinder(10.0, 30.0).Shape();
    const TopoDS_Face top = planarFaceAtZ(src, 30.0);
    if (top.IsNull()) { ok("found the top face", false); return; }
    TopTools_ListOfShape rm;
    rm.Append(top);
    const TopoDS_Shape w = forge::occtoffset::makeThickSolid(src, 2.0, rm, 1.0e-3);
    if (w.IsNull()) {
        ok("engine built the wall", false, forge::occtoffset::lastThickSolidDeferReason());
        return;
    }
    ok("engine built the wall", true);
    near("wall volume = 1208*pi", volOf(w), 1208.0 * kPi, 1e-9);
}

// ── (C) COPLANAR-SPLIT MOUTH: the riser ─────────────────────────────────────
// The same plate, but its top face is SPLIT by an imprinted circle of r = 8
// (fusing a fully-contained coaxial cylinder leaves the imprint, because OCCT's
// fuse does not unify same-domain faces). The derivation removes the LARGER of
// the two coplanar top faces, so the r in (5,8) annulus stays RETAINED while the
// rest of the top is the mouth. Its cavity therefore drops to z = 18 while the
// mouth stays at z = 20, and the wall is closed across that step by a CYLINDER
// of radius exactly 8.
//
//   cavity over 7 < r < 8   (area pi*(64-49) = 15*pi) : z in [2,18], height 16
//   cavity elsewhere in the 36x36 inset, r > 8        : z in [2,20], height 18
//   cavity = 15*pi*16 + (1296 - 64*pi)*18 = 23328 - 912*pi
//   WALL VOLUME = (32000 - 500*pi) - (23328 - 912*pi) = 8672 + 412*pi
//
// The riser is the ONLY face of the answer at radius 8; its area is
// 2*pi*8*2 = 32*pi, and finding a cylinder of radius exactly 8 is what
// distinguishes this construction from one that simply ignored the split.
// A PLAIN 40 x 40 x 20 box whose top and bottom faces are each SPLIT by an
// imprinted circle of r = 8. Fusing a coaxial cylinder that spans the box
// exactly, top to bottom, changes no geometry at all -- the cylinder is wholly
// inside -- but OCCT's fuse does not unify same-domain faces, so each cap comes
// back as a disk r < 8 plus the rest, sharing that circle. That is exactly the
// coplanar split 228 corpus parts carry.
//
// NOTE it deliberately has NO through hole: the r=8 stud would have FILLED a
// r=5 hole, which is how the first version of this control silently became a
// plain box and reported p_ring_shorter_than_three.
TopoDS_Shape splitPlate() {
    const TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(-20, -20, 0), 40.0, 40.0, 20.0).Shape();
    const TopoDS_Shape stud = BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 8.0, 20.0).Shape();
    const TopoDS_Shape drill = BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(0, 0, -5), gp_Dir(0, 0, 1)), 5.0, 30.0).Shape();
    TopoDS_Shape out;
    try { out = BRepAlgoAPI_Cut(BRepAlgoAPI_Fuse(box, stud).Shape(), drill).Shape(); }
    catch (...) {}
    return out;
}

void caseC() {
    std::printf("(C) COPLANAR SPLIT with a RISER: box 40x40x20, top split at r=8,\n"
                "    the LARGER of the two top faces removed, t=2\n");
    const TopoDS_Shape src = splitPlate();
    if (src.IsNull()) { ok("C built the split box", false); return; }

    // The two coplanar faces at z = 20; the mouth is the LARGER one, exactly as
    // test/corpus_ab_coverage.cpp's derivation picks it.
    TopoDS_Face mouth;
    double best = -1.0;
    int nAtTop = 0;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(src, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm.FindKey(i));
        Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(basis(BRep_Tool::Surface(f)));
        if (pl.IsNull() || std::fabs(pl->Position().Direction().Z()) < 0.99) continue;
        GProp_GProps g;
        BRepGProp::SurfaceProperties(f, g);
        if (std::fabs(g.CentreOfMass().Z() - 20.0) > 1e-6) continue;
        ++nAtTop;
        if (g.Mass() > best) { best = g.Mass(); mouth = f; }
    }
    char d[64];
    std::snprintf(d, sizeof d, "got %d face(s) at z=20", nAtTop);
    ok("C the top face really is split in two", nAtTop == 2, d);
    near("C the imprint left the source volume untouched", volOf(src), 32000.0 - 500.0 * kPi, 1e-9);
    if (mouth.IsNull()) { ok("C found the mouth", false); return; }

    TopTools_ListOfShape rm;
    rm.Append(mouth);
    const TopoDS_Shape w = forge::occtoffset::makeThickSolid(src, 2.0, rm, 1.0e-3);
    if (w.IsNull()) {
        ok("C engine built the wall", false, forge::occtoffset::lastThickSolidDeferReason());
        return;
    }
    ok("C engine built the wall", true);
    near("C wall volume = 8672 + 412*pi", volOf(w), 8672.0 + 412.0 * kPi, 1e-9);

    // The riser is the ONLY curved face in the answer, at radius exactly 8, and
    // its area 2*pi*8*2 pins its HEIGHT to the wall thickness. A riser spanning
    // the whole box, or built at the wrong end, would leave the volume alone.
    int nCyl = 0, nR8 = 0;
    double aR8 = 0.0;
    TopTools_IndexedMapOfShape wm;
    TopExp::MapShapes(w, TopAbs_FACE, wm);
    for (int i = 1; i <= wm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(wm.FindKey(i));
        Handle(Geom_CylindricalSurface) cy =
            Handle(Geom_CylindricalSurface)::DownCast(basis(BRep_Tool::Surface(f)));
        if (cy.IsNull()) continue;
        ++nCyl;
        if (std::fabs(cy->Radius() - 8.0) > 1e-9) continue;
        ++nR8;
        GProp_GProps g;
        BRepGProp::SurfaceProperties(f, g);
        aR8 += g.Mass();
    }
    ok("C three cylindrical faces (hole 5, cavity 7, riser 8)", nCyl == 3);
    ok("C it is the riser, radius 8", nR8 == 1);
    near("C riser area = 32*pi (radius 8, height = the wall)", aR8, 32.0 * kPi, 1e-9);

    BRepCheck_Analyzer an(w);
    ok("C BRepCheck_Analyzer valid", an.IsValid());
}

// ── (D) COPLANAR SPLIT, BOTH SIDES RETAINED ─────────────────────────────────
// The same split box, but a SIDE face is the mouth, so both halves of the split
// top — and both halves of the split bottom — are retained. Each pair offsets
// onto the SAME plane, so there is no step and NO riser: a topological split of
// one flat region must be invisible in the answer.
//
//   mouth x = +20 (pinned); the other three sides inset by 2; z in [2,18]
//   cavity = 38 * 36 * 16 = 21888
//   WALL VOLUME = 32000 - 21888 = 10112, exactly
//
// The negative half of the assertion is that NO cylindrical face appears at all.
// A riser fabricated here would be a face the answer does not have, and the
// volume would not notice it.
void caseD() {
    std::printf("(D) COPLANAR SPLIT, both sides retained (a SIDE face removed), t=2\n");
    const TopoDS_Shape src = splitPlate();
    if (src.IsNull()) { ok("D built the split box", false); return; }

    TopoDS_Face side;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(src, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm.FindKey(i));
        Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(basis(BRep_Tool::Surface(f)));
        if (pl.IsNull() || std::fabs(pl->Position().Direction().X()) < 0.99) continue;
        GProp_GProps g;
        BRepGProp::SurfaceProperties(f, g);
        if (std::fabs(g.CentreOfMass().X() - 20.0) < 1e-6) { side = f; break; }
    }
    if (side.IsNull()) { ok("D found the +x side face", false); return; }

    TopTools_ListOfShape rm;
    rm.Append(side);
    const TopoDS_Shape w = forge::occtoffset::makeThickSolid(src, 2.0, rm, 1.0e-3);
    if (w.IsNull()) {
        ok("D engine built the wall", false, forge::occtoffset::lastThickSolidDeferReason());
        return;
    }
    ok("D engine built the wall", true);
    near("D wall volume = 10112 + 284*pi", volOf(w), 10112.0 + 284.0 * kPi, 1e-9);

    int nCyl = 0, nR8 = 0;
    TopTools_IndexedMapOfShape wm;
    TopExp::MapShapes(w, TopAbs_FACE, wm);
    for (int i = 1; i <= wm.Extent(); ++i) {
        Handle(Geom_CylindricalSurface) cy = Handle(Geom_CylindricalSurface)::DownCast(
            basis(BRep_Tool::Surface(TopoDS::Face(wm.FindKey(i)))));
        if (cy.IsNull()) continue;
        ++nCyl;
        if (std::fabs(cy->Radius() - 8.0) < 1e-9) ++nR8;
    }
    ok("D two cylinders only (hole 5, cavity 7) - NO riser", nCyl == 2);
    ok("D no face at radius 8 was fabricated", nR8 == 0);
    BRepCheck_Analyzer an(w);
    ok("D BRepCheck_Analyzer valid", an.IsValid());
}

// ── (E) RANK-2 POLYGON CORNERS ──────────────────────────────────────────────
// Box 40 x 40 x 20 fused with a slab that shares three of its faces, so the top,
// the bottom and BOTH y walls are each split along the line x = -10, and a R = 5
// through hole at (5, 0) keeps the solid off the all-planar path. The +x side
// face is the mouth.
//
// The four vertices at x = -10 on the y walls carry THREE OR FOUR incident faces
// but only TWO distinct planes, so the least-squares corner meet is singular
// there however many faces are listed. Their cavity image is the perpendicular
// projection onto the line where the two offset planes meet. MEASURED: this is
// the guard 198 of the 235 in-scope corpus parts stop on.
//
//   mouth x = +20 (pinned); the other three sides inset by 2; z in [2,18]
//   cavity = 38 * 36 * 16 - pi*7^2*16 = 21888 - 784*pi
//   source = 32000 - pi*5^2*20        = 32000 - 500*pi
//   WALL VOLUME = 10112 + 284*pi
//
// The split must be invisible in the geometry, so the answer must carry exactly
// TWO cylinders (the R=5 outer hole and the R=7 cavity hole) and no other.
void caseE() {
    std::printf("(E) RANK-2 polygon corners: top/bottom/y-walls split at x=-10, +x removed, t=2\n");
    const TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(-20, -20, 0), 40.0, 40.0, 20.0).Shape();
    const TopoDS_Shape slab = BRepPrimAPI_MakeBox(gp_Pnt(-20, -20, 0), 10.0, 40.0, 20.0).Shape();
    const TopoDS_Shape drill = BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(5, 0, -5), gp_Dir(0, 0, 1)), 5.0, 30.0).Shape();
    TopoDS_Shape src;
    try { src = BRepAlgoAPI_Cut(BRepAlgoAPI_Fuse(box, slab).Shape(), drill).Shape(); }
    catch (...) {}
    if (src.IsNull()) { ok("E built the split box", false); return; }
    near("E the imprint left the source volume untouched", volOf(src),
         32000.0 - 500.0 * kPi, 1e-9);

    // The +x side face, which the split does NOT touch.
    TopoDS_Face side;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(src, TopAbs_FACE, fm);
    int nPlanarTop = 0;
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm.FindKey(i));
        Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(basis(BRep_Tool::Surface(f)));
        if (pl.IsNull()) continue;
        GProp_GProps g;
        BRepGProp::SurfaceProperties(f, g);
        if (std::fabs(pl->Position().Direction().Z()) > 0.99 &&
            std::fabs(g.CentreOfMass().Z() - 20.0) < 1e-6) ++nPlanarTop;
        if (std::fabs(pl->Position().Direction().X()) > 0.99 &&
            std::fabs(g.CentreOfMass().X() - 20.0) < 1e-6) side = f;
    }
    char d[64];
    std::snprintf(d, sizeof d, "got %d face(s) at z=20", nPlanarTop);
    ok("E the top face really is split in two", nPlanarTop == 2, d);
    if (side.IsNull()) { ok("E found the +x side face", false); return; }

    TopTools_ListOfShape rm;
    rm.Append(side);
    const TopoDS_Shape w = forge::occtoffset::makeThickSolid(src, 2.0, rm, 1.0e-3);
    if (w.IsNull()) {
        ok("E engine built the wall", false, forge::occtoffset::lastThickSolidDeferReason());
        return;
    }
    ok("E engine built the wall", true);
    near("E wall volume = 10112 + 284*pi", volOf(w), 10112.0 + 284.0 * kPi, 1e-9);

    int nCyl = 0;
    TopTools_IndexedMapOfShape wm;
    TopExp::MapShapes(w, TopAbs_FACE, wm);
    for (int i = 1; i <= wm.Extent(); ++i)
        if (!Handle(Geom_CylindricalSurface)::DownCast(
                basis(BRep_Tool::Surface(TopoDS::Face(wm.FindKey(i))))).IsNull()) ++nCyl;
    ok("E two cylinders only (hole 5, cavity 7)", nCyl == 2);
    BRepCheck_Analyzer an(w);
    ok("E BRepCheck_Analyzer valid", an.IsValid());
}

void negatives() {
    std::printf("NEGATIVE CONTROLS\n");

    // N1: a wall deeper than the smallest half-extent must decline.
    {
        const TopoDS_Shape src = plate();
        const TopoDS_Face top = planarFaceAtZ(src, 20.0);
        TopTools_ListOfShape rm;
        rm.Append(top);
        const TopoDS_Shape w = forge::occtoffset::makeThickSolid(src, 25.0, rm, 1.0e-3);
        ok("N1 t=25 (> half extent) declines", w.IsNull(),
           w.IsNull() ? forge::occtoffset::lastThickSolidDeferReason() : "BUILT SOMETHING");
    }

    // N2: a planar wire mixing LINE and ARC edges must decline, and must say so.
    // A cylinder cut through one side wall leaves that wall's wire as lines plus
    // an arc — the exact form the corpus's other 105 deletion-bucket parts have.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(-20, -20, 0), 40.0, 40.0, 20.0).Shape();
        const TopoDS_Shape slot = BRepPrimAPI_MakeCylinder(
            gp_Ax2(gp_Pnt(0, -25, 20), gp_Dir(0, 1, 0)), 6.0, 60.0).Shape();
        const TopoDS_Shape src = BRepAlgoAPI_Cut(box, slot).Shape();
        const TopoDS_Face bottom = planarFaceAtZ(src, 0.0);
        if (bottom.IsNull()) { ok("N2 built the slotted box", false); }
        else {
            TopTools_ListOfShape rm;
            rm.Append(bottom);
            const TopoDS_Shape w = forge::occtoffset::makeThickSolid(src, 2.0, rm, 1.0e-3);
            const char* why = forge::occtoffset::lastThickSolidDeferReason();
            ok("N2 line+arc planar wire declines", w.IsNull(), why);
            ok("N2 reason names the wire rule",
               w.IsNull() && std::strstr(why, "q_planar_wire_not_circle_or_polygon") != nullptr,
               why);
        }
    }

    // N3: a NURBS face must decline on the surface-type rule.
    {
        const TopoDS_Shape src0 = plate();
        const TopoDS_Face top = planarFaceAtZ(src0, 20.0);
        BRepBuilderAPI_NurbsConvert nc(src0);
        const TopoDS_Shape src = nc.Shape();
        // The converted shape's own top face, found the same way.
        const TopoDS_Face top2 = planarFaceAtZ(src, 20.0);
        TopTools_ListOfShape rm;
        rm.Append(top2.IsNull() ? top : top2);
        const TopoDS_Shape w = forge::occtoffset::makeThickSolid(src, 2.0, rm, 1.0e-3);
        const char* why = forge::occtoffset::lastThickSolidDeferReason();
        ok("N3 NURBS faces decline", w.IsNull(), why);
        ok("N3 reason names the surface rule",
           w.IsNull() && std::strstr(why, "q_surface_unsupported") != nullptr, why);
    }
}

}  // namespace

int main() {
    caseA();
    caseB();
    caseC();
    caseD();
    caseE();
    negatives();
    // The summary line is in the shape test/run_ab_all.sh parses ("N passed,
    // M failed"), so this gate can be ratcheted alongside the other live-OCCT
    // harnesses instead of being a script nobody runs.
    std::printf("%d passed, %d failed\n", g_ok, g_bad);
    std::printf(g_bad ? "FAIL: %d assertion(s) wrong\n" : "PASS: every assertion held\n", g_bad);
    return g_bad ? 1 : 0;
}
