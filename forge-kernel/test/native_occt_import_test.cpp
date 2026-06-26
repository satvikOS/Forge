// forge-kernel/test/native_occt_import_test.cpp
//
// A/B CORRECTNESS GATE for the OCCT -> native B-rep IMPORTER (src/OcctImport.cpp).
//
// Builds several solids with OCCT DIRECTLY (BRepPrimAPI_MakeBox / MakeCylinder /
// MakeCone / MakeSphere, and a BRepAlgoAPI_Cut of box - through-cylinder), imports
// each via forge::importOcctSolid, then asserts the NATIVE result MATCHES the OCCT
// original:
//   (a) VOLUME within 0.5%        (native massProperties vs OCCT GProp)
//   (b) SURFACE AREA within 0.5%  (native massProperties vs OCCT GProp)
//   (c) BOUNDING BOX within 0.5%  (native computeAabb vs OCCT Bnd_Box)
//   (d) BETTI b0/b1/b2 match      (native computeBetti vs the known topology;
//                                  the through-hole cut must import with b1>=1)
//
// This links OCCT (it is the bridge oracle) — it is NOT a run_native.sh pure-native
// gate. Build + run manually (mirrors test/native_vs_occt_fillet.cpp's build line):
//
//   clang++ -std=c++20 -O2 -DFORGE_NATIVE_BREP \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/OcctImport.cpp \
//     <native srcs: Surface MassProps Aabb SolidTessellate CadScoreGates Topology \
//        Curve NurbsSurface NurbsCalculus Nurbs Predicates Geom \
//        ConstrainedDelaunay2D HalfEdgeMesh ExactReal ExactPredicates3D> \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native_occt_import_test.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
//     -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing \   (GProp lives in TKTopAlgo)
//     -o /tmp/native_occt_import_test && /tmp/native_occt_import_test
//
// (The driver script build_occt_import_test.sh assembles this command + the full
//  native-source set automatically; see test/native/brep/README of OCCT tests.)

#include "forge/OcctImport.hpp"

#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Aabb.hpp"
#include "forge/native/brep/CadScoreGates.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Check.hpp"        // checkBRep — the native B-rep VALIDATOR

// --- OCCT ------------------------------------------------------------------
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>          // BSpline blend (variable fillet)
#include <BRepOffsetAPI_ThruSections.hxx>        // BSpline loft (through-sections)
#include <BRepPrimAPI_MakeRevol.hxx>             // surface of revolution (honest deferral)
#include <BRepPrimAPI_MakePrism.hxx>             // SOLID OF EXTRUSION (exact NURBS sweep)
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <Geom_BSplineCurve.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <gp_Ax1.hxx>
#include <gp_Vec.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopExp_Explorer.hxx>
#include <gp_Circ.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>   // OCCT validity oracle for the native-vs-OCCT verdict A/B
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge;

namespace {

int g_pass = 0, g_fail = 0;

void check(bool cond, const std::string& label) {
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", label.c_str()); }
    else      { ++g_fail; std::printf("  [FAIL] %s\n", label.c_str()); }
}

double relErr(double a, double b) {
    double d = std::fabs(a - b);
    double s = std::max({std::fabs(a), std::fabs(b), 1e-12});
    return d / s;
}

struct OcctMeasure {
    double volume = 0, area = 0;
    double mn[3] = {0,0,0}, mx[3] = {0,0,0};
};

OcctMeasure measureOcct(const TopoDS_Shape& s) {
    OcctMeasure m;
    GProp_GProps vp; BRepGProp::VolumeProperties(s, vp); m.volume = vp.Mass();
    GProp_GProps sp; BRepGProp::SurfaceProperties(s, sp); m.area = sp.Mass();
    Bnd_Box bb; BRepBndLib::Add(s, bb);
    bb.Get(m.mn[0], m.mn[1], m.mn[2], m.mx[0], m.mx[1], m.mx[2]);
    return m;
}

// TIGHT OCCT bbox oracle for the BSpline fixtures. OCCT's default Bnd_Box
// (BRepBndLib::Add) bounds a B-spline face by its CONTROL-POLYGON hull, which for
// a high-degree blend/loft surface extends measurably PAST the true surface (e.g.
// the variable fillet's z-extent is reported [-0.24, 4.24] vs the real [0, 4]).
// BRepBndLib::AddOptimal samples the actual surface, giving the EXACT solid extent
// — which is what the native exact-analytic/NURBS AABB computes — so the tight box
// is the correct A/B oracle for the curved-NURBS fixtures (it is still OCCT truth,
// just the non-padded bound). Mass/area are unchanged (GProp integrates the real
// surface either way).
OcctMeasure measureOcctTight(const TopoDS_Shape& s) {
    OcctMeasure m;
    GProp_GProps vp; BRepGProp::VolumeProperties(s, vp); m.volume = vp.Mass();
    GProp_GProps sp; BRepGProp::SurfaceProperties(s, sp); m.area = sp.Mass();
    Bnd_Box bb; BRepBndLib::AddOptimal(s, bb, Standard_False, Standard_False);
    bb.Get(m.mn[0], m.mn[1], m.mn[2], m.mx[0], m.mx[1], m.mx[2]);
    return m;
}

// Import + assert vs the OCCT original. `bbTol` widens the bbox tolerance for the
// curved primitives (OCCT's Bnd_Box pads, native AABB is exact-analytic) — it is
// a generous 1% so the gate is honest about the padded-vs-exact bound but still
// catches a wrong axis/extent.
void gate(const std::string& name, const TopoDS_Shape& shape,
          long long expB0, long long expB1, long long expB2,
          double volAreaTol = 0.005, double bbTol = 0.01,
          bool tightBbox = false) {
    std::printf("[%s]\n", name.c_str());
    OcctMeasure occt = tightBbox ? measureOcctTight(shape) : measureOcct(shape);

    ImportResult ir = importOcctSolid(shape);
    if (!ir.ok) {
        ++g_fail;
        std::printf("  [FAIL] import ok (reason: %s)\n", ir.reason.c_str());
        return;
    }
    check(true, "import ok");

    native::brep::MassProps mp = native::brep::massProperties(*ir.solid, 10);
    check(relErr(mp.volume, occt.volume) <= volAreaTol,
          "volume  native=" + std::to_string(mp.volume) +
          " occt=" + std::to_string(occt.volume) +
          " relerr=" + std::to_string(relErr(mp.volume, occt.volume)));
    check(relErr(mp.area, occt.area) <= volAreaTol,
          "area    native=" + std::to_string(mp.area) +
          " occt=" + std::to_string(occt.area) +
          " relerr=" + std::to_string(relErr(mp.area, occt.area)));

    native::brep::Aabb3 bb = native::brep::computeAabb(*ir.solid);
    double diag = std::sqrt((occt.mx[0]-occt.mn[0])*(occt.mx[0]-occt.mn[0]) +
                            (occt.mx[1]-occt.mn[1])*(occt.mx[1]-occt.mn[1]) +
                            (occt.mx[2]-occt.mn[2])*(occt.mx[2]-occt.mn[2]));
    double bbAbs = bbTol * std::max(1.0, diag);
    bool bbOk =
        std::fabs(bb.minX - occt.mn[0]) <= bbAbs && std::fabs(bb.maxX - occt.mx[0]) <= bbAbs &&
        std::fabs(bb.minY - occt.mn[1]) <= bbAbs && std::fabs(bb.maxY - occt.mx[1]) <= bbAbs &&
        std::fabs(bb.minZ - occt.mn[2]) <= bbAbs && std::fabs(bb.maxZ - occt.mx[2]) <= bbAbs;
    check(bbOk, "bbox    native=[" +
          std::to_string(bb.minX) + "," + std::to_string(bb.maxX) + "]x[" +
          std::to_string(bb.minY) + "," + std::to_string(bb.maxY) + "]x[" +
          std::to_string(bb.minZ) + "," + std::to_string(bb.maxZ) + "]");

    native::brep::BettiNumbers be = native::brep::computeBetti(*ir.solid);
    check(be.ok, "betti tessellation ok (watertight 2-manifold)");
    check(be.b0 == expB0, "betti b0 native=" + std::to_string(be.b0) +
          " expected=" + std::to_string(expB0));
    // The kernel's convention is b1 = sum(2*genus) over shells (see CadScoreGates.hpp),
    // so a genus-g body reports b1 = 2g. expB1 here is that 2g value; the through-hole
    // (genus 1) must therefore report b1 == 2 (>= 1, i.e. a real tunnel exists).
    check(be.b1 == expB1, "betti b1 native=" + std::to_string(be.b1) +
          " expected=" + std::to_string(expB1));
    check(be.b2 == expB2, "betti b2 native=" + std::to_string(be.b2) +
          " expected=" + std::to_string(expB2));

    // (e) NATIVE VALIDITY VERDICT must MATCH OCCT's (the winding-reconciliation gate).
    // Before the param-winding reconciliation, checkBRep(importer output) returned
    // valid=FALSE (a spurious O2.OuterLoopCCW / BadOrientationCCW on every face whose
    // surface frame's natural normal points INWARD — i.e. reversed==true), while OCCT's
    // BRepCheck_Analyzer reported the SAME solid valid=TRUE. Now O2 measures the outer
    // loop's signed param area against the face's OUTWARD normal (it consults the surface
    // `reversed` flag), so the native verdict equals OCCT's for these analytic solids.
    bool occtValid = BRepCheck_Analyzer(shape, Standard_True).IsValid();
    native::brep::CheckReport cr = native::brep::checkBRep(ir.solid);  // expectClosed=true (a solid)
    // Enumerate any residual native defect so a regression is self-describing.
    std::string defects;
    for (const auto& pr : cr.predicates)
        if (!pr.passed) { defects += " " + pr.name; }
    check(cr.valid == occtValid,
          "native validity verdict == OCCT  native=" + std::string(cr.valid ? "true" : "false") +
          " occt=" + std::string(occtValid ? "true" : "false") +
          " (predicates " + std::to_string(cr.passed()) + "/" + std::to_string(cr.total()) +
          (defects.empty() ? "" : ", native defects:" + defects) + ")");
    // And, for these clean analytic solids, the native verdict must be TRUE outright
    // (the proof the importer's faces pass the native predicate battery — what BLOCKED
    // activating the ShapeCheck validity wire on OCCT inputs before this reconciliation).
    check(cr.valid,
          "native checkBRep valid=TRUE on imported solid (all 21 predicates pass)");
}

} // namespace

int main() {
    std::printf("=== OCCT -> native importer A/B gate ===\n");

    // (1) BOX 10x6x4 at origin.
    {
        TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 6.0, 4.0).Shape();
        gate("box 10x6x4", box, 1, 0, 1);
    }
    // (2) CYLINDER r=3 h=8 along +Z.
    {
        TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(3.0, 8.0).Shape();
        gate("cylinder r3 h8", cyl, 1, 0, 1);
    }
    // (3) CONE rB=4 rT=2 h=7 (frustum) along +Z.
    {
        TopoDS_Shape cone = BRepPrimAPI_MakeCone(4.0, 2.0, 7.0).Shape();
        gate("cone 4->2 h7", cone, 1, 0, 1);
    }
    // (4) CONE to apex (rB=4 rT=0 h=6).
    {
        TopoDS_Shape cone = BRepPrimAPI_MakeCone(4.0, 0.0, 6.0).Shape();
        gate("cone 4->apex h6", cone, 1, 0, 1);
    }
    // (5) SPHERE r=5 at origin.
    {
        TopoDS_Shape sph = BRepPrimAPI_MakeSphere(5.0).Shape();
        gate("sphere r5", sph, 1, 0, 1);
    }
    // (6) Placed cylinder — built directly on a rotated/translated axis. Exercises
    // the OCCT-frame -> native-frame match (origin/axis/refDir off the world axes).
    {
        gp_Ax2 ax(gp_Pnt(2, 3, 1), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0));
        TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(ax, 2.5, 9.0).Shape();
        gate("placed cylinder r2.5 h9", cyl, 1, 0, 1);
    }
    // (7) BOX - through CYLINDER (a genuine through-hole; b1 must be >= 1).
    {
        TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(-5, -5, -5), gp_Pnt(5, 5, 5)).Shape();
        // cylinder axis along +Z, fully through the box (z from -6 to 6).
        gp_Ax2 ax(gp_Pnt(0, 0, -6), gp_Dir(0, 0, 1));
        TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(ax, 2.0, 12.0).Shape();
        TopoDS_Shape cut = BRepAlgoAPI_Cut(box, cyl).Shape();
        // genus-1 (one through tunnel) -> kernel b1 = 2*genus = 2 (>= 1: a real hole).
        gate("box - through-cylinder", cut, 1, 2, 1);
    }

    // ========================================================================
    // BSPLINE / NURBS SURFACE FACES — the OCCT-zero gap this slice closes. Real
    // CAD parts (filleted blends, lofts, sweeps) carry BSpline faces; the importer
    // now extracts Geom_BSplineSurface EXACTLY into a native NurbsSurface + (u,v)
    // trim and welds it watertight to the analytic faces of the SAME solid.
    //
    // TOLERANCE JUSTIFICATION: the analytic gate is 0.5% because a quadric sub-face
    // integrates EXACTLY (paramTri over the closed-form Jacobian). A NURBS sub-face
    // also integrates its EXACT rational Jacobian, but the *trim region* is meshed
    // (Steiner grid) and the divergence-theorem volume term ∮ x·n_x dA accumulates
    // over that mesh, so a strongly-curved blend has a small chordal residual. We
    // therefore allow a slightly looser but still tight 1% vol/area band for the
    // NURBS fixtures (honest: it is approximate where the analytic path is exact),
    // and assert the ACTUAL relerr is reported so any regression is visible. The
    // bbox is gated against OCCT's TIGHT (AddOptimal) box — see measureOcctTight.
    // ========================================================================

    // (9) BOX with a VARIABLE-RADIUS FILLET on one edge. A constant-radius straight
    // fillet is an analytic CYLINDER; a VARIABLE radius forces OCCT to build a real
    // Geom_BSplineSurface blend. Result: ONE BSpline face + the SIX box planes — a
    // genuine MIXED analytic+BSpline solid the importer must handle in one piece.
    {
        TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 6.0, 4.0).Shape();
        BRepFilletAPI_MakeFillet mf(box);
        TopExp_Explorer ee(box, TopAbs_EDGE);
        mf.Add(0.5, 2.0, TopoDS::Edge(ee.Current()));   // r: 0.5 -> 2.0 along the edge
        mf.Build();
        if (!mf.IsDone()) { ++g_fail; std::printf("[var-fillet] FAIL: OCCT fillet not done\n"); }
        else gate("box + variable-radius fillet (BSpline blend + 6 planes)",
                  mf.Shape(), 1, 0, 1, /*volArea*/0.01, /*bb*/0.01, /*tight*/true);
    }

    // (10) THROUGH-SECTIONS (loft) SOLID over two circular sections of different
    // radius (r=4 at z=0 -> r=2 at z=8), smoothed. OCCT builds the side as a single
    // Geom_BSplineSurface; the two end caps are planar disks. Mixed BSpline + plane,
    // a monotone taper so the control hull ~ the surface (tight bbox matches).
    {
        auto circWire = [](double z, double r) -> TopoDS_Wire {
            gp_Circ c(gp_Ax2(gp_Pnt(0, 0, z), gp_Dir(0, 0, 1)), r);
            return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(c).Edge()).Wire();
        };
        BRepOffsetAPI_ThruSections ts(Standard_True /*solid*/, Standard_False /*ruled=false -> smooth BSpline*/);
        ts.AddWire(circWire(0.0, 4.0));
        ts.AddWire(circWire(8.0, 2.0));
        ts.Build();
        if (!ts.IsDone()) { ++g_fail; std::printf("[loft] FAIL: OCCT ThruSections not done\n"); }
        else gate("lofted taper r4->r2 (BSpline side + 2 plane caps)",
                  ts.Shape(), 1, 0, 1, /*volArea*/0.01, /*bb*/0.01, /*tight*/true);
    }

    // ========================================================================
    // NEWLY-SUPPORTED SURFACE TYPES (was: honest deferral). The importer now imports
    // a full TORUS exactly (native SurfaceKind::Torus, gp_Torus copied 1:1) and a
    // SOLID OF REVOLUTION (GeomConvert::SurfaceToBSplineSurface -> native NURBS path).
    // ========================================================================

    // (8) FULL TORUS R=8 r=2. A torus IS an exact native analytic surface (its
    // parameterization is identical to gp_Torus), so the importer copies major/minor
    // radii + frame 1:1 and stages a doubly-periodic NxM grid of EXACT torus cells.
    // It is genus 1 (one through-tunnel through the ring centre) => kernel b1 = 2*genus
    // = 2 (the killer topology axis: a torus MUST report b1==2). Volume/area are gated
    // at the tight 0.5% analytic band (the cells integrate the EXACT torus Jacobian).
    {
        TopoDS_Shape tor = BRepPrimAPI_MakeTorus(8.0, 2.0).Shape();
        gate("torus R8 r2 (native Torus, genus 1 -> b1=2)", tor, 1, 2, 1,
             /*volArea*/0.005, /*bb*/0.01, /*tight*/true);
    }

    // (11) SOLID OF EXTRUSION — extrude a CLOSED B-spline-bounded profile (a B-spline
    // outer edge + a straight return edge, in the XY plane) along +Z by 5. OCCT keeps
    // the swept outer wall as a GeomAbs_SurfaceOfExtrusion; the importer builds the
    // EXACT rational tensor B-spline of that extrusion DIRECTLY from the basis curve
    // (basis x linear-in-direction — matches OCCT to machine precision in geometry AND
    // (u,v) parameterization) and routes it through the native NURBS path, welded to
    // the planar back wall + 2 planar caps. Genus 0 (b1=0). The swept NURBS wall's trim
    // meshing is approximate vs the exact analytic path, so vol/area use the same honest
    // 1% band as the loft/fillet; the bbox is gated against OCCT's tight (AddOptimal) box.
    {
        TColgp_Array1OfPnt pts(1, 4);
        pts.SetValue(1, gp_Pnt(2, 0, 0));
        pts.SetValue(2, gp_Pnt(4, 1, 0));
        pts.SetValue(3, gp_Pnt(4, 3, 0));
        pts.SetValue(4, gp_Pnt(2, 4, 0));
        Handle(Geom_BSplineCurve) bc = GeomAPI_PointsToBSpline(pts).Curve();
        TopoDS_Edge eb = BRepBuilderAPI_MakeEdge(bc).Edge();
        TopoDS_Edge eret = BRepBuilderAPI_MakeEdge(gp_Pnt(2, 4, 0), gp_Pnt(2, 0, 0)).Edge();
        TopoDS_Wire w = BRepBuilderAPI_MakeWire(eb, eret).Wire();
        TopoDS_Face pf = BRepBuilderAPI_MakeFace(w).Face();
        TopoDS_Shape pr = BRepPrimAPI_MakePrism(pf, gp_Vec(0, 0, 5)).Shape();
        gate("solid of extrusion (exact BSpline-extrusion wall + 3 planes, genus 0)",
             pr, 1, 0, 1, /*volArea*/0.01, /*bb*/0.01, /*tight*/true);
    }

    // (12) HONEST DEFERRAL — a SOLID OF REVOLUTION. A circular sweep has no exact
    // UNIFORM-ANGLE NURBS representation (the exact rational-quadratic circle is
    // non-uniform in the angle, so it cannot keep OCCT's u-domain that the face's
    // p-curves live in), and GeomConvert's polynomial approximation misses by ~4.6%
    // volume. The importer therefore MUST defer (ok=false, "Revolution" named), NOT
    // import an inexact/p-curve-misindexed body. (The native Torus IS supported because
    // that quadric's parameterization is uniform-angle and matches OCCT exactly.)
    {
        std::printf("[revolution deferral]\n");
        gp_Ax1 zax(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));
        TColgp_Array1OfPnt pts(1, 4);
        pts.SetValue(1, gp_Pnt(2, 0, 0));
        pts.SetValue(2, gp_Pnt(4, 0, 2));
        pts.SetValue(3, gp_Pnt(4, 0, 4));
        pts.SetValue(4, gp_Pnt(2, 0, 6));
        Handle(Geom_BSplineCurve) bc = GeomAPI_PointsToBSpline(pts).Curve();
        TopoDS_Edge eb = BRepBuilderAPI_MakeEdge(bc).Edge();
        TopoDS_Edge eret = BRepBuilderAPI_MakeEdge(gp_Pnt(2, 0, 6), gp_Pnt(2, 0, 0)).Edge();
        TopoDS_Wire w = BRepBuilderAPI_MakeWire(eb, eret).Wire();
        TopoDS_Face pf = BRepBuilderAPI_MakeFace(w).Face();
        TopoDS_Shape rv = BRepPrimAPI_MakeRevol(pf, zax).Shape();
        ImportResult ir = importOcctSolid(rv);
        check(!ir.ok, std::string("revolution deferred (ok=false), reason=\"") + ir.reason + "\"");
        check(ir.reason.find("Revolution") != std::string::npos,
              "deferral reason names the Revolution face");
        check(ir.solid == nullptr, "deferred revolution import yields no solid");
    }

    std::printf("\n=== RESULT: %d passed, %d failed ===\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
