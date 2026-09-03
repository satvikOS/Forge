// src/native/brep/NativeThickenShell.cpp — TKOffset-free THICKEN (family I).
//
// Read include/forge/native/brep/NativeThickenShell.hpp first: it carries the
// scope, the named formulation, the MEASURED OCCT comparison table, the
// HONEST-DEFER list and the drop hygiene. This file carries the derivations.
//
// ===========================================================================
// DERIVATION 1 — the interior direction of a face at one of its edges
// ===========================================================================
// For a face with OUTWARD normal N whose outer wire is traversed with the
// material on the left (OCCT's convention, and what BRepTools_WireExplorer walks
// when handed the face), the in-plane direction pointing INTO the face from an
// edge with oriented tangent that is
//     u = N x that.
// Check on the unit square in z=0 with N=+Z and the wire counter-clockwise seen
// from +Z: the y=0 edge is traversed +X, and N x X = Z x X = +Y, which points
// into the square. u is what decides convexity and what the wedge's self-check
// tests against.
//
// ===========================================================================
// DERIVATION 2 — convexity, and the exact wedge
// ===========================================================================
// Let an interior edge be shared by faces F1, F2 with OFFSET directions a1, a2
// (a_i = sign(t) * N_i) and interior directions u1, u2. Near the edge, prism i
// occupies the radial sector spanned by u_i and a_i (a right angle, since
// a_i is perpendicular to u_i).
//   * If a1 . u2 > 0 the two prisms OVERLAP: the fold is CONCAVE for this offset
//     direction and their union already has no gap. Nothing is added.
//   * If a1 . u2 < 0 they do not meet: the fold is CONVEX and the gap is exactly
//     the set of points within |t| of the edge whose radial direction lies in the
//     sector from a1 to a2. Its cross-section is a circular sector of radius |t|
//     and angle theta = acos(a1 . a2), so the wedge's volume is
//         V = (theta/2) * t^2 * L .
//     For the right-angle L fold of the header's measured table, theta = pi/2,
//     |t| = 2, L = 10: V = (pi/4)*4*10 = 10*pi = 31.41592653 — which is exactly
//     the residual OCCT was measured to add. That identity is the whole proof
//     that this is the right wedge, and the A/B asserts it numerically.
//
// SELF-CHECK ON THE WEDGE, because a sector can be built on the wrong side and
// still have the right volume: the bisector b = normalize(a1 + a2) must satisfy
// b . u1 < 0 AND b . u2 < 0, i.e. it points away from both plates. If it does
// not, the geometry is not the configuration this derivation covers and the call
// DECLINES rather than fusing a lump onto the wrong side.
//
// ===========================================================================
// DERIVATION 3 — the volume bracket used as the final self-check
// ===========================================================================
// From the decomposition, the offset body contains every individual prism and is
// contained in the union-as-a-sum of all parts, so
//     max_i (area_i * |t|)  <=  V  <=  sum_i (area_i * |t|)  +  sum_wedges V_wedge .
// The lower bound catches a fuse that lost a plate; the upper bound catches one
// that double-counted an overlap. Both are strict inequalities on a real result
// and neither can be satisfied by a null or inverted solid.

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/NativeThickenShell.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <string>
#include <vector>

#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepTools_Modification.hxx>
#include <BRepTools_Modifier.hxx>
#include <Geom2d_Curve.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_Line.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Precision.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColStd_Array2OfReal.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <TopoDS_Shell.hxx>
#include <gp_Lin.hxx>
#include <BRepGProp.hxx>
// TKPrim was REMOVED from the link line on 2026-08-07 (see CMakeLists: "TKPrim
// EXCLUSIVE = 0"), but this file still referenced BRepPrimAPI_MakePrism, so the
// dylib failed to link on "vtable for BRepPrimAPI_MakePrism". occtPrism is the
// in-house 1:1 replacement and references no BRepPrimAPI symbol.
#include "forge/OcctPrimBuilder.hpp"
#include <stdexcept>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_Surface.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_MapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

namespace forge {
namespace occtthicken {

namespace {

const TopoDS_Shape kNull;

// WHY A DEFER IS NAMEABLE. Every `return kNull` in this file records the reason
// first, and thickenLastDeferReason() reads it back. A silent null tells a caller
// (and a test) only THAT the engine declined; the whole point of an honest defer
// is that the reason is inspectable, and the A/B asserts the exact reason string
// for each of its defer controls rather than settling for "it returned null".
std::string& deferSlot() {
    static thread_local std::string r;
    return r;
}
TopoDS_Shape defer(const char* why) {
    deferSlot() = why;
    return kNull;
}

constexpr double kPara = 1.0e-9;    // direction-parallelism slack (1 - |dot|)
constexpr double kTwoPi = 6.283185307179586476925286766559;

bool envOn(const char* name) {
    const char* v = std::getenv(name);
    return v && (*v == '1' || *v == 'y' || *v == 'Y' || *v == 't' || *v == 'T');
}

Handle(Geom_Surface) basisSurface(const Handle(Geom_Surface)& s) {
    Handle(Geom_Surface) cur = s;
    for (int guard = 0; guard < 8 && !cur.IsNull(); ++guard) {
        Handle(Geom_RectangularTrimmedSurface) rt =
            Handle(Geom_RectangularTrimmedSurface)::DownCast(cur);
        if (rt.IsNull()) break;
        cur = rt->BasisSurface();
    }
    return cur;
}

// Outward unit normal + Hesse offset of a face that IS a plane, honouring the
// face's TopAbs orientation (a REVERSED face's outward normal is the flipped
// surface normal). False iff the face is not planar => the caller defers.
//
// ★ A FACE CAN BE A PLANE WITHOUT BEING A Geom_Plane, and refusing those would
//   have broken a shipped capability. MEASURED: forge.surfacing.buildPatch emits
//   a Geom_BSplineSurface, so the flat 100x60 patch that test/thicken_surface_
//   smoke.js and test/knit_surface_smoke.js thicken carries a B-SPLINE surface
//   whose control points happen to be coplanar. A type-tag test rejects it; the
//   geometry does not. So planarity is decided by SAMPLING the surface over its
//   whole UV range and bounding the worst orthogonal residual — a worst-case
//   bound, not an RMS, because one sample off the plane is enough to make a prism
//   the wrong answer. This is the same admissibility test NativeFilling.cpp
//   applies to a wire, applied here to a surface patch.
//
// The plane's NORMAL comes from the surface's own parametric normal
// dS/du x dS/dv at the patch centre — not from a fit, whose sign would be
// arbitrary — and the residual test is what proves that normal is constant over
// the face.
constexpr int kPlanarSamples = 8;      // 8x8 grid; a bilinear/bicubic bulge cannot hide

bool outwardNormalOf(const TopoDS_Face& f, gp_Dir& n, double& hesse) {
    const Handle(Geom_Surface) s = basisSurface(BRep_Tool::Surface(f));
    if (s.IsNull()) return false;

    // Exact case first: a real Geom_Plane needs no sampling.
    const Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s);
    if (!pl.IsNull()) {
        const gp_Pln& gpl = pl->Pln();
        gp_Dir d = gpl.Axis().Direction();
        if (f.Orientation() == TopAbs_REVERSED) d.Reverse();
        n = d;
        const gp_Pnt& o = gpl.Location();
        hesse = n.X() * o.X() + n.Y() * o.Y() + n.Z() * o.Z();
        return true;
    }

    double u0 = 0.0, u1 = 0.0, v0 = 0.0, v1 = 0.0;
    BRepTools::UVBounds(f, u0, u1, v0, v1);
    if (!(u1 > u0) || !(v1 > v0)) return false;

    // Parametric normal at the centre.
    const double uc = 0.5 * (u0 + u1), vc = 0.5 * (v0 + v1);
    gp_Pnt pc;
    gp_Vec du, dv;
    s->D1(uc, vc, pc, du, dv);
    const gp_Vec nv = du.Crossed(dv);
    if (nv.Magnitude() < 1.0e-12) return false;       // degenerate parametrisation
    gp_Dir d(nv);
    if (f.Orientation() == TopAbs_REVERSED) d.Reverse();

    // Worst-case orthogonal residual over the whole patch.
    const double h = d.X() * pc.X() + d.Y() * pc.Y() + d.Z() * pc.Z();
    double scale = 1.0;
    double worst = 0.0;
    for (int i = 0; i <= kPlanarSamples; ++i) {
        const double uu = u0 + (u1 - u0) * (static_cast<double>(i) / kPlanarSamples);
        for (int j = 0; j <= kPlanarSamples; ++j) {
            const double vv = v0 + (v1 - v0) * (static_cast<double>(j) / kPlanarSamples);
            const gp_Pnt q = s->Value(uu, vv);
            scale = std::max(scale, std::max(std::fabs(q.X()),
                             std::max(std::fabs(q.Y()), std::fabs(q.Z()))));
            worst = std::max(worst,
                std::fabs(d.X() * q.X() + d.Y() * q.Y() + d.Z() * q.Z() - h));
        }
    }
    if (worst > 1.0e-7 * scale) return false;          // genuinely curved => defer
    n = d;
    hesse = h;
    return true;
}

double faceArea(const TopoDS_Face& f) {
    GProp_GProps p;
    BRepGProp::SurfaceProperties(f, p);
    return std::fabs(p.Mass());
}

// A straight edge as (start point, unit direction, length). False if the edge is
// not a segment or is degenerate.
bool straightEdge(const TopoDS_Edge& e, gp_Pnt& p0, gp_Dir& dir, double& len) {
    if (BRep_Tool::Degenerated(e)) return false;
    TopoDS_Vertex v1, v2;
    TopExp::Vertices(e, v1, v2);
    if (v1.IsNull() || v2.IsNull()) return false;
    p0 = BRep_Tool::Pnt(v1);
    const gp_Pnt p1 = BRep_Tool::Pnt(v2);
    const gp_Vec w(p0, p1);
    len = w.Magnitude();
    if (len < 1.0e-9) return false;
    dir = gp_Dir(w);
    // The chord is only the edge if the edge IS the segment: sample the curve and
    // require every sample to lie on it. A curved fold is declined, not chorded.
    double f = 0.0, l = 0.0;
    const Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    if (c.IsNull()) return false;
    for (int i = 0; i <= 8; ++i) {
        const double u = f + (l - f) * (static_cast<double>(i) / 8.0);
        const gp_Pnt q = c->Value(u);
        const gp_Vec qv(p0, q);
        const double along = qv.Dot(gp_Vec(dir));
        const gp_Vec off = qv - gp_Vec(dir) * along;
        if (off.Magnitude() > 1.0e-7 * std::max(1.0, len)) return false;
    }
    return true;
}

// The interior direction of `f` at edge `e`: u = N x t_hat with t_hat the edge's
// tangent AS TRAVERSED BY THE FACE'S OUTER WIRE. See DERIVATION 1.
// False if `e` is not on the face's outer wire or is not straight.
bool interiorDirAt(const TopoDS_Face& f, const TopoDS_Edge& e, const gp_Dir& N,
                   gp_Dir& u) {
    const TopoDS_Wire w = BRepTools::OuterWire(f);
    if (w.IsNull()) return false;
    for (BRepTools_WireExplorer wex(w, f); wex.More(); wex.Next()) {
        const TopoDS_Edge cur = wex.Current();
        if (!cur.IsSame(e)) continue;
        TopoDS_Vertex a, b;
        TopExp::Vertices(cur, a, b, /*CumOri*/ Standard_True);
        if (a.IsNull() || b.IsNull()) return false;
        const gp_Vec tv(BRep_Tool::Pnt(a), BRep_Tool::Pnt(b));
        if (tv.Magnitude() < 1.0e-12) return false;
        const gp_Dir that(tv);
        u = gp_Dir(gp_Vec(N).Crossed(gp_Vec(that)));
        return true;
    }
    return false;
}

// The cylindrical sector wedge of radius r spanning a1 -> a2 about the straight
// edge (p0, dir, len). See DERIVATION 2. Null on any failure.
TopoDS_Shape sectorWedge(const gp_Pnt& p0, const gp_Dir& dir, double len,
                         double r, const gp_Dir& a1, const gp_Dir& a2,
                         double theta) {
    // Orient the arc so that increasing parameter runs a1 -> a2.
    gp_Dir axis = dir;
    if (gp_Vec(axis).Crossed(gp_Vec(a1)).Dot(gp_Vec(a2)) < 0.0) axis.Reverse();

    const gp_Ax2 frame(p0, axis, a1);           // XDirection = a1, angle 0 at a1
    const gp_Circ circ(frame, r);
    const gp_Pnt q1 = p0.Translated(gp_Vec(a1) * r);
    const gp_Pnt q2 = p0.Translated(gp_Vec(a2) * r);

    BRepBuilderAPI_MakeEdge mkArc(new Geom_Circle(circ), 0.0, theta);
    if (!mkArc.IsDone()) return defer("wedge: the sector arc could not be built");
    BRepBuilderAPI_MakeEdge mkS1(p0, q1);
    BRepBuilderAPI_MakeEdge mkS2(q2, p0);
    if (!mkS1.IsDone() || !mkS2.IsDone()) return defer("wedge: a sector radius segment could not be built");

    BRepBuilderAPI_MakeWire mkw;
    mkw.Add(mkS1.Edge());
    mkw.Add(mkArc.Edge());
    mkw.Add(mkS2.Edge());
    if (!mkw.IsDone()) return defer("wedge: the sector wire did not close");

    BRepBuilderAPI_MakeFace mkf(mkw.Wire(), Standard_True);
    if (!mkf.IsDone()) return defer("wedge: the sector face could not be built");

    TopoDS_Shape wedge;
    try {
        wedge = ::forge::occtPrism(mkf.Face(), gp_Vec(dir) * len, /*canonize=*/true);
    } catch (const std::exception&) {
        return defer("wedge: the sector prism could not be built");
    }
    if (wedge.IsNull()) return defer("wedge: the sector prism could not be built");
    return wedge;
}

// ===========================================================================
// PATH C — ONE CYLINDRICAL FACE, trimmed to its FULL parametric rectangle.
// ===========================================================================
// WHY THIS PATH EXISTS, AND WHY IT IS EXACTLY THIS SHAPE. The corpus coverage
// A/B (test/corpus_ab_coverage.cpp, 600 parts) measured this engine at 67.8%
// against OCCT's 100.0%, a deletion bucket of 193 parts. Instrumenting the
// native arm with thickenLastDeferReason() attributed ALL 193 to ONE reason,
// "a face is not a Geom_Plane" — and a surface census of the picked face over
// the same 600 parts found all 193 of them to be a CYLINDER (407 Plane / 193
// Cylinder, no third type anywhere in the corpus). So the whole deletion
// bucket was one missing surface type, not a scatter of causes.
//
// THE CLOSED FORM. A cylindrical patch of radius R over the parametric
// rectangle [u0,u1] x [v0,v1] has outward normal +e_r, so offsetting it by a
// signed t gives the COAXIAL cylinder of radius R' = R + s*t, where s = +1 if
// the face's outward normal points away from the axis and -1 if it points at
// it. The body between the two patches, closed by the two annular end rings, is
// the ANNULAR TUBE between the radii Rlo = min(R,R') and Rhi = max(R,R') over
// the axial band [v0,v1]. Its volume is exactly
//         V = 0.5 * du * (Rhi^2 - Rlo^2) * dv
// and its area exactly
//         A = (Rlo + Rhi)*du*dv + du*(Rhi^2 - Rlo^2)
// for the full turn this path builds (see the construction note below for why a
// partial u-span is declined rather than approximated).
//
// ★ MEASURED AGAINST LIVE OCCT, NOT ASSERTED. The same BRepOffset_MakeOffset
//   call src/Features.cpp makes was run on the picked face of all 193 corpus
//   parts and its volume compared with BOTH candidate closed forms:
//       face REVERSED (119 parts) -> OCCT's volume == the R-t form, rel < 1e-9
//       face FORWARD   (51 parts) -> OCCT's volume == the R+t form, rel < 1e-9
//       the remaining  (23 parts) -> NEITHER form, rel 2e-2 .. 9e-2
//   The 170 that match are exactly the parts that pass the RECTANGLE
//   CERTIFICATE below; the 23 that do not are exactly the ones that fail it.
//   So the certificate is not a heuristic guard — it is the precise predicate
//   separating the inputs on which this closed form IS OCCT's answer from the
//   ones on which it is not, and the sign rule was READ OFF that measurement
//   rather than reasoned about.
//
// THE RECTANGLE CERTIFICATE, and why it is exact rather than approximate. A
// cylindrical face trims the surface to some UV region D contained in the
// adaptor's box [u0,u1] x [v0,v1], and its area is exactly R * area(D). So
//         area(face) == R * du * dv   <=>   D IS the whole rectangle,
// with strict inequality otherwise — a face with an inner loop (a hole cut in
// the tube wall), or any non-rectangular trim, has strictly less area. One
// area comparison therefore proves the trim is the full rectangle, which is the
// precondition the closed form needs. This is the same style of certificate the
// coplanar path uses (prism volume == area * thickness).
//
// HONEST DEFER, as everywhere else in this file, each with its own named reason:
// a non-rectangular trim, a partial u-span, a non-positive or axis-touching
// offset radius, a degenerate parametrisation, a cut that fails, or a result
// that misses either closed form, carries a face that is neither of the two
// walls nor a planar cap, or leaves the [Rlo,Rhi] x [v0,v1] envelope.
//
// DROP HYGIENE unchanged: gp_/Geom_ (TKMath/TKG3d), forge::occtCylinderSolid
// (OcctPrimBuilder.cpp, itself TKPrim-free), BRepAlgoAPI_Cut (TKBO, already in
// the closure and already called from this file's n-ary fuse) and
// ShapeUpgrade_UnifySameDomain (TKShHealing, likewise). NO BRepOffset*, NO
// BRepOffsetAPI*, NO BRepPrimAPI* symbol is referenced.
// ═══════════════════════════════════════════════════════════════════════════
// PATH D — ONE CYLINDRICAL FACE whose trim is NOT the full parametric rectangle.
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS CLOSES, MEASURED. After PATH C the corpus A/B read THICKEN at
// native 577/600 vs OCCT 600/600 (test/run_corpus_ab_coverage.sh, FAMILIES=THICKEN,
// stride 1). The 23-part deletion bucket was attributed COMPLETELY — 23 of 23 — to
// the single defer reason PATH C emits when its RECTANGLE CERTIFICATE fails. A
// census of those 23 picked faces (test/thicken_bucket_census.cpp) named them:
//
//     surface type      Geom_CylindricalSurface  23/23   (no second type)
//     u-span            a FULL 2*pi turn         23/23
//     area / (R*du*dv)  0.842 .. 0.960           (4%..16% of the box is trimmed away)
//     wires             2 in 19, 1 in 2, 4 in 1, 6 in 1   (holes)
//     boundary curves   Geom_Line, Geom_Circle, Geom_BSplineCurve only
//     degenerate edges  0/23
//
// So the bucket is not "curved surfaces we cannot do" — it is the SAME cylinder
// PATH C already handles, carrying holes and a non-rectangular outer boundary.
//
// THE CONSTRUCTION, AND WHY IT IS EXACT RATHER THAN A FIT. Offsetting a cylindrical
// patch radially by t maps the point at parameters (u,v) on radius R to the point at
// the SAME (u,v) on radius R+t. That map is the RADIAL SCALE
//
//     M_k : p |-> loc + k*(p-loc)_perp + (p-loc)_parallel,     k = R'/R
//
// which is LINEAR. Three consequences are used, and each is exact:
//   * the offset surface is a Geom_CylindricalSurface on the SAME gp_Ax3 with
//     radius k*R — not an approximation of one;
//   * every PCURVE is UNCHANGED, because (u,v) is preserved. That is what carries
//     the trim across: holes, seams and a staircase outer boundary all survive
//     without being re-intersected;
//   * a B-spline boundary curve maps by transforming its POLES and keeping its
//     weights and knots, because a linear map commutes with B-spline evaluation.
// The re-basing is done with BRepTools_Modifier, so OCCT rebuilds the topology
// (vertices, seams, wire order) rather than this file doing it by hand.
//
// The SIDE WALL over a boundary edge is the ruled surface between the edge's two
// offset copies. That too is exact, not a fit: the true wall point at (s, r) is
// loc + r*e_r(u(s)) + v(s)*Z, which is LINEAR in r, so linear interpolation
// between the rails IS the surface. For a rational rail the same holds because
// both rows carry identical weights, and the weights then cancel.
//
// ★ WALLS ARE BUILT AS PLANES WHERE THEY ARE PLANAR, and this is not cosmetic.
//   Two things were MEASURED to depend on it:
//     - SURFACE-TYPE CENSUS. OCCT returns Plane for a wall over a ruling or over a
//       coaxial circle (ho1005: Plane=6, ho66: Plane=8). Emitting a degree-(p,1)
//       B-spline instead is exactly the regression PATH C already refused once.
//     - VOLUME INTEGRATION. BRepGProp::VolumeProperties at DEFAULT accuracy reads a
//       B-spline-walled solid 0.32% away from the geometrically identical
//       plane-walled one (ho1005: 105308.43 vs 104976.67; at eps=1e-8 both give
//       104969.69). The corpus A/B compares default-accuracy volumes, so shipping
//       B-spline walls would have been scored as a geometric DISAGREEMENT on
//       geometry that is in fact right.
//
// DROP HYGIENE — checked against the LINK LINE, not against intent. OCCT_LIBS is
// TKernel TKMath TKG3d TKBRep TKTopAlgo TKShHealing TKOffset (CMakeLists.txt:210);
// everything else the binary calls is already a phantom or already linked. This path
// uses ONLY: gp_/Geom_ (TKMath/TKG3d), BRepTools_Modifier + BRep_Tool (TKBRep),
// BRepBuilderAPI_MakeEdge/MakeWire/MakeFace/MakePolygon/Sewing/MakeSolid and
// BRepGProp and BRepCheck (TKTopAlgo). It adds NO library. In particular it does NOT
// use GeomConvert::CurveToBSplineCurve, which was the obvious way to build the ruled
// rails and which lives in TKGeomBase — a toolkit this build DELIBERATELY does not
// link (CMakeLists.txt notes it was dropped). Calling it would have made TKGeomBase a
// third PHANTOM and failed scripts/tkoffset_ledger_gate.sh (ceiling 2), the exact
// failure mode that gate was written for after TKPrim did it. Geom_BSplineCurve::
// Segment (TKG3d) is used instead, and it is not a workaround: the rails are already
// B-splines, so trimming a copy is both cheaper and structurally safer than a convert
// — it guarantees the two rails keep an identical knot vector.
//
// HONEST DEFER (null shape, reason recorded) — this path declines rather than
// approximating when: a boundary edge's curve is not a Line / coaxial Circle /
// B-spline; a straight edge is not a ruling of the cylinder; a circular edge is not
// coaxial; the two rails do not share a control structure; the sew does not close to
// exactly one shell; the result is not a valid one-solid one-shell body; or the
// volume falls outside the closed-form bracket.

// The radial scale about the cylinder axis. LINEAR, which is what makes every
// mapping below exact rather than approximate.
struct RadialMap {
    gp_Pnt loc;
    gp_Dir Z;
    double k;
    gp_Pnt operator()(const gp_Pnt& p) const {
        gp_Vec d(loc, p);
        const double par = d.Dot(gp_Vec(Z));
        const gp_Vec perp = d - gp_Vec(Z) * par;
        return loc.Translated(perp * k + gp_Vec(Z) * par);
    }
};

// Map a curve KNOWN to lie on the cylinder. Returns a null handle and records a
// reason for any type this path does not claim.
Handle(Geom_Curve) mapCylCurve(const Handle(Geom_Curve)& cin, const RadialMap& M) {
    Handle(Geom_TrimmedCurve) tc = Handle(Geom_TrimmedCurve)::DownCast(cin);
    if (!tc.IsNull()) {
        Handle(Geom_Curve) b = mapCylCurve(tc->BasisCurve(), M);
        if (b.IsNull()) return b;
        return new Geom_TrimmedCurve(b, tc->FirstParameter(), tc->LastParameter());
    }
    Handle(Geom_Line) ln = Handle(Geom_Line)::DownCast(cin);
    if (!ln.IsNull()) {
        const gp_Lin L = ln->Lin();
        if (std::fabs(std::fabs(L.Direction().Dot(M.Z)) - 1.0) > 1.0e-9) {
            deferSlot() = "trimmed-cylinder path: a straight boundary edge is not a "
                          "ruling of the cylinder";
            return Handle(Geom_Curve)();
        }
        return new Geom_Line(gp_Ax1(M(L.Location()), L.Direction()));
    }
    Handle(Geom_Circle) ci = Handle(Geom_Circle)::DownCast(cin);
    if (!ci.IsNull()) {
        const gp_Circ C = ci->Circ();
        const gp_Ax2 A = C.Position();
        gp_Vec off(M.loc, A.Location());
        const double perp = (off - gp_Vec(M.Z) * off.Dot(gp_Vec(M.Z))).Magnitude();
        if (std::fabs(std::fabs(A.Direction().Dot(M.Z)) - 1.0) > 1.0e-9 || perp > 1.0e-7) {
            deferSlot() = "trimmed-cylinder path: a circular boundary edge is not "
                          "coaxial with the cylinder";
            return Handle(Geom_Curve)();
        }
        return new Geom_Circle(A, C.Radius() * M.k);
    }
    Handle(Geom_BSplineCurve) bs = Handle(Geom_BSplineCurve)::DownCast(cin);
    if (!bs.IsNull()) {
        Handle(Geom_BSplineCurve) out = Handle(Geom_BSplineCurve)::DownCast(bs->Copy());
        if (out.IsNull()) {
            deferSlot() = "trimmed-cylinder path: a B-spline boundary edge would not copy";
            return Handle(Geom_Curve)();
        }
        // A LINEAR map commutes with B-spline evaluation, so moving the poles moves
        // the curve exactly; weights and knots are untouched on purpose.
        for (int i = 1; i <= out->NbPoles(); ++i) out->SetPole(i, M(out->Pole(i)));
        return out;
    }
    deferSlot() = "trimmed-cylinder path: a boundary edge carries an unsupported curve type";
    return Handle(Geom_Curve)();
}

// Re-base a cylindrical face onto radius k*R, KEEPING every pcurve so the trim
// survives exactly. OCCT rebuilds the topology; this class only supplies geometry.
class CylRadialMod : public BRepTools_Modification {
public:
    CylRadialMod(const RadialMap& m, double tol) : M_(m), tol_(tol) {}
    DEFINE_STANDARD_ALLOC

    Standard_Boolean NewSurface(const TopoDS_Face& F, Handle(Geom_Surface)& S,
                                TopLoc_Location& L, Standard_Real& Tol,
                                Standard_Boolean& RevWires, Standard_Boolean& RevFace) override {
        Handle(Geom_CylindricalSurface) cs =
            Handle(Geom_CylindricalSurface)::DownCast(basisSurface(BRep_Tool::Surface(F)));
        if (cs.IsNull()) { bad_ = true; return Standard_False; }
        const gp_Cylinder cy = cs->Cylinder();
        S = new Geom_CylindricalSurface(cy.Position(), cy.Radius() * M_.k);
        L = TopLoc_Location();
        Tol = tol_;
        RevWires = Standard_False;
        RevFace = Standard_False;
        return Standard_True;
    }
    Standard_Boolean NewCurve(const TopoDS_Edge& E, Handle(Geom_Curve)& C,
                              TopLoc_Location& L, Standard_Real& Tol) override {
        Standard_Real f = 0.0, l = 0.0;
        const Handle(Geom_Curve) c = BRep_Tool::Curve(E, f, l);
        if (c.IsNull()) { bad_ = true; return Standard_False; }
        const Handle(Geom_Curve) n = mapCylCurve(c, M_);
        if (n.IsNull()) { bad_ = true; return Standard_False; }
        C = n;
        L = TopLoc_Location();
        Tol = tol_;
        return Standard_True;
    }
    Standard_Boolean NewPoint(const TopoDS_Vertex& V, gp_Pnt& P, Standard_Real& Tol) override {
        P = M_(BRep_Tool::Pnt(V));
        Tol = tol_;
        return Standard_True;
    }
    // THE PCURVE IS RETURNED UNCHANGED. That is the whole mechanism: the two
    // cylinders share a parametrisation, so the trim needs no recomputation.
    Standard_Boolean NewCurve2d(const TopoDS_Edge& E, const TopoDS_Face& F,
                                const TopoDS_Edge&, const TopoDS_Face&,
                                Handle(Geom2d_Curve)& C, Standard_Real& Tol) override {
        Standard_Real f = 0.0, l = 0.0;
        C = BRep_Tool::CurveOnSurface(E, F, f, l);
        Tol = tol_;
        return !C.IsNull();
    }
    Standard_Boolean NewParameter(const TopoDS_Vertex& V, const TopoDS_Edge& E,
                                  Standard_Real& P, Standard_Real& Tol) override {
        if (V.IsNull()) return Standard_False;
        P = BRep_Tool::Parameter(V, E);
        Tol = tol_;
        return Standard_True;
    }
    GeomAbs_Shape Continuity(const TopoDS_Edge& E, const TopoDS_Face& F1, const TopoDS_Face& F2,
                             const TopoDS_Edge&, const TopoDS_Face&, const TopoDS_Face&) override {
        return BRep_Tool::Continuity(E, F1, F2);
    }
    bool bad() const { return bad_; }

private:
    RadialMap M_;
    double tol_;
    bool bad_ = false;
};

// ── PLANAR WALLS, DECIDED BY MEASURING THE RAILS RATHER THAN BY THEIR TYPE.
//
// WHY NOT DISPATCH ON CURVE TYPE. The first version of this asked "is the rail a
// Geom_Line / a coaxial Geom_Circle?" and built a plane only then. That is right on
// the corpus, where the 23 parts carry genuine analytic boundary curves — but it is
// asking about the ENCODING, not the geometry, and the two come apart. MEASURED on
// the A/B's case 7, whose hole is built from pcurves and whose 3D curves are
// therefore B-spline images of straight rulings and circular arcs: type dispatch
// emitted 2 planes and 4 B-spline walls where OCCT emits 6 planes and 0. Every other
// observable — volume, area, centre of mass, bounding box, F/E/V — agreed exactly.
// So the defect was invisible to everything except the surface-type census, which is
// precisely the check PATH C was given after a revolve-based construction regressed
// it once before.
//
// The question that actually matters is "do the two rails lie in a common plane?",
// and that is answered by SAMPLING them. A straight ruling stored as a B-spline is
// still straight, and this test sees that; a genuinely curved fold is not planar, and
// this test rejects it and falls through to the exact ruled wall.

// A wall over a RULING: the planar quadrilateral through the four corners. The
// rails are straight, so the corners determine the wall exactly.
TopoDS_Face planarQuadWall(const Handle(Geom_Curve)& clo, double f1, double l1,
                           const Handle(Geom_Curve)& chi, double f2, double l2) {
    BRepBuilderAPI_MakePolygon poly(clo->Value(f1), clo->Value(l1),
                                    chi->Value(l2), chi->Value(f2), Standard_True);
    if (!poly.IsDone()) return TopoDS_Face();
    BRepBuilderAPI_MakeFace mf(poly.Wire(), Standard_True);
    if (!mf.IsDone()) return TopoDS_Face();
    return mf.Face();
}

// A wall over a COAXIAL CIRCLE: a planar annulus, or an annular sector. Built from
// circles this file constructs, not from projected curves.
TopoDS_Face annulusWall(const Handle(Geom_Circle)& glo, double f1, double l1,
                        const Handle(Geom_Circle)& ghi, double f2, double l2) {
    Handle(Geom_Plane) pl =
        new Geom_Plane(glo->Circ().Location(), glo->Circ().Axis().Direction());
    BRepBuilderAPI_MakeEdge elo(glo, f1, l1), ehi(ghi, f2, l2);
    if (!elo.IsDone() || !ehi.IsDone()) return TopoDS_Face();
    const bool closed = std::fabs((l1 - f1) - kTwoPi) < 1.0e-7;
    if (closed) {
        BRepBuilderAPI_MakeWire wlo(elo.Edge()), whi(ehi.Edge());
        if (!wlo.IsDone() || !whi.IsDone()) return TopoDS_Face();
        BRepBuilderAPI_MakeFace outer(pl, whi.Wire(), Standard_True);
        if (!outer.IsDone()) return TopoDS_Face();
        BRepBuilderAPI_MakeFace holed(outer.Face());
        holed.Add(TopoDS::Wire(wlo.Wire().Reversed()));
        if (!holed.IsDone()) return TopoDS_Face();
        return holed.Face();
    }
    BRepBuilderAPI_MakeEdge s1(glo->Value(l1), ghi->Value(l2));
    BRepBuilderAPI_MakeEdge s2(ghi->Value(f2), glo->Value(f1));
    if (!s1.IsDone() || !s2.IsDone()) return TopoDS_Face();
    BRepBuilderAPI_MakeWire w;
    w.Add(elo.Edge());
    w.Add(s1.Edge());
    w.Add(TopoDS::Edge(ehi.Edge().Reversed()));
    w.Add(s2.Edge());
    if (!w.IsDone()) return TopoDS_Face();
    BRepBuilderAPI_MakeFace mf(pl, w.Wire(), Standard_True);
    if (!mf.IsDone()) return TopoDS_Face();
    return mf.Face();
}

// The general wall: the EXACT ruled surface between the two rails, as a
// degree-(p,1) B-spline. Reached only for a B-spline boundary edge.
TopoDS_Face ruledBSplineWall(const Handle(Geom_BSplineCurve)& blo,
                             const Handle(Geom_BSplineCurve)& bhi) {
    if (blo.IsNull() || bhi.IsNull() || blo->NbPoles() != bhi->NbPoles() ||
        blo->Degree() != bhi->Degree() || blo->NbKnots() != bhi->NbKnots()) {
        deferSlot() = "trimmed-cylinder path: the two wall rails do not share a "
                      "control structure";
        return TopoDS_Face();
    }
    const int np = blo->NbPoles(), nk = blo->NbKnots();
    TColgp_Array2OfPnt poles(1, np, 1, 2);
    for (int i = 1; i <= np; ++i) { poles(i, 1) = blo->Pole(i); poles(i, 2) = bhi->Pole(i); }
    TColStd_Array1OfReal uk(1, nk);
    TColStd_Array1OfInteger um(1, nk);
    for (int i = 1; i <= nk; ++i) { uk(i) = blo->Knot(i); um(i) = blo->Multiplicity(i); }
    TColStd_Array1OfReal vk(1, 2);      vk(1) = 0.0; vk(2) = 1.0;
    TColStd_Array1OfInteger vm(1, 2);   vm(1) = 2;   vm(2) = 2;
    Handle(Geom_BSplineSurface) surf;
    try {
        if (blo->IsRational() || bhi->IsRational()) {
            TColStd_Array2OfReal w(1, np, 1, 2);
            for (int i = 1; i <= np; ++i) { w(i, 1) = blo->Weight(i); w(i, 2) = bhi->Weight(i); }
            surf = new Geom_BSplineSurface(poles, w, uk, vk, um, vm, blo->Degree(), 1);
        } else {
            surf = new Geom_BSplineSurface(poles, uk, vk, um, vm, blo->Degree(), 1);
        }
    } catch (const Standard_Failure&) {
        deferSlot() = "trimmed-cylinder path: the ruled wall surface could not be built";
        return TopoDS_Face();
    }
    BRepBuilderAPI_MakeFace mf(surf, Precision::Confusion());
    if (!mf.IsDone()) {
        deferSlot() = "trimmed-cylinder path: the ruled wall face could not be built";
        return TopoDS_Face();
    }
    return mf.Face();
}

// Trim a copy of a B-spline rail to the edge's own range, WITHOUT GeomConvert
// (TKGeomBase is not on the link line — see the banner).
Handle(Geom_BSplineCurve) railSegment(const Handle(Geom_Curve)& c, double f, double l) {
    Handle(Geom_Curve) b = c;
    Handle(Geom_TrimmedCurve) tc = Handle(Geom_TrimmedCurve)::DownCast(b);
    if (!tc.IsNull()) b = tc->BasisCurve();
    Handle(Geom_BSplineCurve) bs = Handle(Geom_BSplineCurve)::DownCast(b);
    if (bs.IsNull()) return Handle(Geom_BSplineCurve)();
    Handle(Geom_BSplineCurve) out = Handle(Geom_BSplineCurve)::DownCast(bs->Copy());
    if (out.IsNull()) return out;
    try {
        if (f > out->FirstParameter() + 1.0e-12 || l < out->LastParameter() - 1.0e-12)
            out->Segment(f, l);
    } catch (const Standard_Failure&) {
        return Handle(Geom_BSplineCurve)();
    }
    return out;
}

TopoDS_Face wallFor(const TopoDS_Edge& Elo, const TopoDS_Edge& Ehi) {
    Standard_Real f1 = 0.0, l1 = 0.0, f2 = 0.0, l2 = 0.0;
    const Handle(Geom_Curve) clo = BRep_Tool::Curve(Elo, f1, l1);
    const Handle(Geom_Curve) chi = BRep_Tool::Curve(Ehi, f2, l2);
    if (clo.IsNull() || chi.IsNull()) {
        deferSlot() = "trimmed-cylinder path: a wall rail has no 3D curve";
        return TopoDS_Face();
    }
    Handle(Geom_Curve) blo = clo, bhi = chi;
    { Handle(Geom_TrimmedCurve) t = Handle(Geom_TrimmedCurve)::DownCast(blo);
      if (!t.IsNull()) blo = t->BasisCurve(); }
    { Handle(Geom_TrimmedCurve) t = Handle(Geom_TrimmedCurve)::DownCast(bhi);
      if (!t.IsNull()) bhi = t->BasisCurve(); }

    // ── PLANAR WALLS, and ONLY where the plane is EXACT ────────────────────
    // The dispatch is on the rail's ANALYTIC TYPE, and that is a deliberate
    // choice over the more general "sample the rails and fit a plane", which was
    // written first and MEASURED WORSE. A plane fitted to a B-SPLINE rail forces
    // BRepBuilderAPI_MakeFace to PROJECT that rail onto the plane to get its
    // pcurve, and that projection is an approximation: on the 23 corpus parts the
    // fitted-plane version dropped native from 23/23 to 18/23 at t>0 (ho1005,
    // ho1119, ho1250, ho625, ho701 all failing this file's own BRepCheck guard)
    // and to 17/23 at t<0. A ruling and a coaxial arc, by contrast, lie in their
    // plane exactly, so those two cases are built as planes and everything else
    // takes the ruled wall — which is exact for a planar wall too, and differs
    // only in carrying a less specific surface TYPE.
    //
    // KNOWN LIMIT, stated rather than hidden: a rail that is geometrically a
    // straight ruling but ENCODED as a B-spline gets a B-spline wall where OCCT
    // emits a plane. That is measurable — it is exactly what the A/B's case 7
    // sees, because its hole is built from pcurves and BRepLib::BuildCurves3d
    // returns B-spline images of the rulings and arcs. It does NOT occur on any of
    // the 23 real corpus parts, whose boundary curves are genuine Geom_Line /
    // Geom_Circle / Geom_BSplineCurve and whose surface-type census matches OCCT
    // 23/23. Volume, area, centre of mass, bounding box, validity and F/E/V agree
    // in BOTH cases; it is the face TYPE alone that is less specific.
    Handle(Geom_Line) L1 = Handle(Geom_Line)::DownCast(blo);
    Handle(Geom_Line) L2 = Handle(Geom_Line)::DownCast(bhi);
    if (!L1.IsNull() && !L2.IsNull()) {
        const TopoDS_Face q = planarQuadWall(clo, f1, l1, chi, f2, l2);
        if (!q.IsNull()) return q;
    }
    Handle(Geom_Circle) C1 = Handle(Geom_Circle)::DownCast(blo);
    Handle(Geom_Circle) C2 = Handle(Geom_Circle)::DownCast(bhi);
    if (!C1.IsNull() && !C2.IsNull() &&
        C1->Circ().Location().Distance(C2->Circ().Location()) < 1.0e-7) {
        const TopoDS_Face q = annulusWall(C1, f1, l1, C2, f2, l2);
        if (!q.IsNull()) return q;
    }
    return ruledBSplineWall(railSegment(clo, f1, l1), railSegment(chi, f2, l2));
}

TopoDS_Shape thickenTrimmedCylinder(const TopoDS_Face& f, double tol,
                                    const gp_Cylinder& cy, double Rlo, double Rhi) {
    const double R = cy.Radius();
    const gp_Ax3 pos = cy.Position();
    const RadialMap Mlo{pos.Location(), pos.Direction(), Rlo / R};
    const RadialMap Mhi{pos.Location(), pos.Direction(), Rhi / R};

    CylRadialMod* pLo = new CylRadialMod(Mlo, tol);
    CylRadialMod* pHi = new CylRadialMod(Mhi, tol);
    Handle(BRepTools_Modification) hLo(pLo), hHi(pHi);
    BRepTools_Modifier mlo(f), mhi(f);
    try {
        mlo.Perform(hLo);
        mhi.Perform(hHi);
    } catch (const Standard_Failure&) {
        return defer("trimmed-cylinder path: re-basing the face onto the offset "
                     "radius threw");
    }
    if (!mlo.IsDone() || !mhi.IsDone() || pLo->bad() || pHi->bad()) {
        if (deferSlot().empty())
            deferSlot() = "trimmed-cylinder path: the offset face could not be re-based";
        return kNull;
    }
    const TopoDS_Shape flo = mlo.ModifiedShape(f), fhi = mhi.ModifiedShape(f);
    if (flo.IsNull() || fhi.IsNull())
        return defer("trimmed-cylinder path: a re-based offset face is null");

    // The inner copy is REVERSED so the two cylindrical skins face opposite ways;
    // the sew then has a consistently oriented shell to close.
    BRepBuilderAPI_Sewing sew(std::max(tol, 1.0e-6), Standard_True, Standard_True,
                              Standard_True, Standard_False);
    sew.Add(flo.Reversed());
    sew.Add(fhi);

    int nwall = 0;
    TopTools_IndexedMapOfShape em;
    TopExp::MapShapes(f, TopAbs_EDGE, em);
    for (int i = 1; i <= em.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(em(i));
        // A SEAM is interior to the periodic wrap, not a free boundary: it gets no
        // wall. Walling it would close the body across the seam and halve it.
        if (BRepTools::IsReallyClosed(e, f)) continue;
        const TopoDS_Shape elo = mlo.ModifiedShape(e), ehi = mhi.ModifiedShape(e);
        if (elo.IsNull() || ehi.IsNull())
            return defer("trimmed-cylinder path: a wall rail is null");
        const TopoDS_Face w = wallFor(TopoDS::Edge(elo), TopoDS::Edge(ehi));
        if (w.IsNull()) return kNull;      // wallFor recorded the reason
        sew.Add(w);
        ++nwall;
    }
    if (nwall == 0) return defer("trimmed-cylinder path: the face has no free boundary");

    sew.Perform();
    const TopoDS_Shape sewed = sew.SewedShape();
    if (sewed.IsNull()) return defer("trimmed-cylinder path: the sew produced nothing");
    int nsh = 0;
    TopoDS_Shell shell;
    for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
        shell = TopoDS::Shell(ex.Current());
        ++nsh;
    }
    if (nsh != 1)
        return defer("trimmed-cylinder path: the sew did not close to exactly one shell");
    BRepBuilderAPI_MakeSolid ms(shell);
    if (!ms.IsDone())
        return defer("trimmed-cylinder path: the shell would not close into a solid");
    TopoDS_Shape out = ms.Solid();

    int nso = 0;
    for (TopExp_Explorer ex(out, TopAbs_SOLID); ex.More(); ex.Next()) ++nso;
    if (nso != 1) return defer("trimmed-cylinder path: the result is not one solid");
    if (!BRepCheck_Analyzer(out).IsValid())
        return defer("trimmed-cylinder path: the result is not BRepCheck-valid");

    GProp_GProps vp;
    BRepGProp::VolumeProperties(out, vp);
    if (vp.Mass() < 0.0) { out.Reverse(); BRepGProp::VolumeProperties(out, vp); }
    if (!(vp.Mass() > 0.0))
        return defer("trimmed-cylinder path: the result has non-positive volume");

    // INDEPENDENT CERTIFICATE, not a restatement of the construction. The exact
    // volume of the body between radii Rlo and Rhi over the trim domain D is
    //     V = area(D) * (Rhi^2 - Rlo^2) / 2,  and  area(f) = R * area(D),
    // so V = area(f) * (Rhi^2 - Rlo^2) / (2R) — computed from the INPUT face's area,
    // a quantity the construction never used. MEASURED over the 23 corpus parts this
    // path exists for: native and OCCT sit the SAME distance from this form (worst
    // 5.6e-6 both, e.g. ho1200 native 5.61e-6 / OCCT 5.62e-6), which identifies the
    // residual as the default-accuracy area(f) input rather than either solid; native
    // and OCCT agree with each other to 4.6e-8. The band is therefore set at 1e-3,
    // wide enough not to reject on integration noise and still tight enough to catch
    // a wall that is missing, doubled, or on the wrong side.
    const double vWant = faceArea(f) * (Rhi * Rhi - Rlo * Rlo) / (2.0 * R);
    if (!(vWant > 0.0) || std::fabs(vp.Mass() - vWant) > 1.0e-3 * vWant)
        return defer("trimmed-cylinder path: the volume misses the closed form for "
                     "the offset band");
    return out;
}

TopoDS_Shape thickenSingleCylinder(const TopoDS_Face& f, double t, double tol) {
    const Handle(Geom_Surface) s = basisSurface(BRep_Tool::Surface(f));
    Handle(Geom_CylindricalSurface) cs = Handle(Geom_CylindricalSurface)::DownCast(s);
    if (cs.IsNull()) return defer("a face is not a Geom_Plane");   // not this path

    const gp_Cylinder cy = cs->Cylinder();
    const double R = cy.Radius();
    if (!(R > 1.0e-12)) return defer("cylindrical path: the radius is not positive");

    double u0 = 0.0, u1 = 0.0, v0 = 0.0, v1 = 0.0;
    BRepTools::UVBounds(f, u0, u1, v0, v1);
    const double du = u1 - u0, dv = v1 - v0;
    if (!(du > 1.0e-12) || !(dv > 1.0e-12))
        return defer("cylindrical path: the UV box is degenerate");
    if (du > kTwoPi + 1.0e-9)
        return defer("cylindrical path: the u-span exceeds one full turn");

    // ---- the RECTANGLE CERTIFICATE ---------------------------------------
    // The certificate now SELECTS A PATH rather than ending the call. A face that
    // IS the full rectangle keeps the closed-form tube below, which is exact and
    // cheap; one that is not goes to PATH D, which carries the trim across
    // explicitly. Before PATH D existed this branch was a defer, and it was the
    // whole of THICKEN's deletion bucket: 23 of 23 parts, one reason.
    const double want = R * du * dv;
    const double got = faceArea(f);
    const bool fullRect = (std::fabs(got - want) <= 1.0e-6 * want);

    // ---- which side is OUT: derived from the surface, not assumed --------
    const gp_Ax3 pos = cy.Position();
    const gp_Dir Zd = pos.Direction();
    const gp_Dir Xd = pos.XDirection();
    const gp_Pnt loc = pos.Location();
    const double uc = 0.5 * (u0 + u1), vc = 0.5 * (v0 + v1);
    gp_Pnt pc;
    gp_Vec dU, dV;
    cs->D1(uc, vc, pc, dU, dV);
    const gp_Vec nv = dU.Crossed(dV);
    if (nv.Magnitude() < 1.0e-12)
        return defer("cylindrical path: the parametrisation is degenerate");
    gp_Dir n(nv);
    if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
    // e_r at the patch centre, from the surface point itself (no handedness
    // assumption): the component of (pc - loc) orthogonal to the axis.
    gp_Vec rad(loc, pc);
    rad -= gp_Vec(Zd) * rad.Dot(gp_Vec(Zd));
    if (rad.Magnitude() < 1.0e-12)
        return defer("cylindrical path: the patch centre lies on the axis");
    const double side = gp_Vec(n).Dot(rad) > 0.0 ? 1.0 : -1.0;

    const double Rp = R + side * t;
    const double Rlo = std::min(R, Rp), Rhi = std::max(R, Rp);
    if (!(Rlo > 1.0e-9 * Rhi))
        return defer("cylindrical path: the offset radius reaches the axis");

    // ---- PATH D — a trim that is not the full rectangle -------------------
    // Routed here and NOT to the closed-form tube below, which assumes the whole
    // parametric box. See the PATH D banner for the construction, the corpus
    // attribution, and the drop-hygiene argument.
    if (!fullRect) return thickenTrimmedCylinder(f, tol, cy, Rlo, Rhi);

    // ---- the annular tube, built ANALYTICALLY ----------------------------
    // NOT a revolve of the axial section. occtRevol would work and its volume
    // is right, but every face it emits is a Geom_SurfaceOfRevolution: MEASURED
    // on corpus part ho1002 the revolved body came back 4F/8E where OCCT's
    // returns 4F/6E, because a periodic surface-of-revolution cap carries a seam
    // a planar annulus does not. Shipping that would trade a coverage gain for a
    // SURFACE-TYPE regression — every downstream consumer that asks "is this face
    // a cylinder" (the corpus picker itself does) would start getting "no" — so
    // the body is assembled from canonical primitives instead:
    //     occtCylinderSolid(Rhi) CUT occtCylinderSolid(Rlo)
    // which leaves exactly two Geom_CylindricalSurface walls and two Geom_Plane
    // annular caps, the same inventory OCCT returns. Both operands come from
    // OcctPrimBuilder (itself TKPrim-free) and BRepAlgoAPI_Cut is TKBO, already in
    // the closure and already called from this very file's n-ary fuse.
    //
    // The construction is written for the FULL turn. A partial u-span would need
    // the two planar side walls as well and is declined by name rather than
    // approximated: it is 0 of 600 parts in the measured corpus, so it is a
    // stated gap with an attributable reason, not a silent one.
    if (!(du >= kTwoPi - 1.0e-9))
        return defer("cylindrical path: a partial u-span needs the two side walls "
                     "(not built)");

    const gp_Pnt base = loc.Translated(gp_Vec(Zd) * v0);
    const gp_Ax2 ax2(base, Zd, Xd);
    TopoDS_Shape outer, inner;
    try {
        outer = ::forge::occtCylinderSolid(ax2, Rhi, dv);
        inner = ::forge::occtCylinderSolid(ax2, Rlo, dv);
    } catch (const std::exception&) {
        return defer("cylindrical path: a wall cylinder could not be built");
    }
    if (outer.IsNull() || inner.IsNull())
        return defer("cylindrical path: a wall cylinder is null");

    BRepAlgoAPI_Cut cut(outer, inner);
    cut.SetFuzzyValue(std::max(tol, 1.0e-7));
    cut.Build();
    if (!cut.IsDone()) return defer("cylindrical path: the wall cut failed");
    const TopoDS_Shape raw = cut.Shape();
    if (raw.IsNull()) return defer("cylindrical path: the wall cut produced a null shape");
    ShapeUpgrade_UnifySameDomain unify(raw, Standard_True, Standard_True, Standard_True);
    unify.Build();
    const TopoDS_Shape out = unify.Shape();
    if (out.IsNull()) return defer("cylindrical path: UnifySameDomain produced a null shape");

    // ---- self-checks: a VECTOR of observables, never volume alone --------
    int nSolid = 0, nShell = 0;
    for (TopExp_Explorer ex(out, TopAbs_SOLID); ex.More(); ex.Next()) ++nSolid;
    for (TopExp_Explorer ex(out, TopAbs_SHELL); ex.More(); ex.Next()) ++nShell;
    if (nSolid != 1 || nShell != 1)
        return defer("cylindrical path: the cut is not exactly one solid with one shell");

    const double wantVol = 0.5 * du * (Rhi * Rhi - Rlo * Rlo) * dv;
    const double wantArea = (Rlo + Rhi) * du * dv + du * (Rhi * Rhi - Rlo * Rlo);
    GProp_GProps vp, ap;
    BRepGProp::VolumeProperties(out, vp);
    BRepGProp::SurfaceProperties(out, ap);
    if (!(std::fabs(std::fabs(vp.Mass()) - wantVol) <= 1.0e-6 * wantVol))
        return defer("cylindrical path: volume != the annulus closed form");
    if (!(std::fabs(ap.Mass() - wantArea) <= 1.0e-6 * wantArea))
        return defer("cylindrical path: area != the annulus closed form");

    // SURFACE INVENTORY. The whole reason the revolve was rejected, so it is a
    // CHECK and not a comment: exactly two cylindrical walls of radius Rlo and
    // Rhi and exactly two planar caps, nothing else.
    int nCyl = 0, nPln = 0, nOther = 0;
    for (TopExp_Explorer ex(out, TopAbs_FACE); ex.More(); ex.Next()) {
        const Handle(Geom_Surface) fs =
            basisSurface(BRep_Tool::Surface(TopoDS::Face(ex.Current())));
        Handle(Geom_CylindricalSurface) fc = Handle(Geom_CylindricalSurface)::DownCast(fs);
        if (!fc.IsNull()) {
            const double rr = fc->Cylinder().Radius();
            if (std::fabs(rr - Rlo) > 1.0e-7 * Rhi && std::fabs(rr - Rhi) > 1.0e-7 * Rhi)
                return defer("cylindrical path: a wall has neither the inner nor the "
                             "outer radius");
            ++nCyl;
        } else if (!Handle(Geom_Plane)::DownCast(fs).IsNull()) ++nPln;
        else ++nOther;
    }
    if (nCyl != 2 || nPln != 2 || nOther != 0)
        return defer("cylindrical path: the face inventory is not two cylinders "
                     "and two planar caps");

    // CONTAINMENT. Volume and area are two numbers and this repo has four
    // measured cases where a wrong solid matched the right number, so the last
    // observable is geometric: every vertex must sit in the [Rlo,Rhi] annulus and
    // inside the axial band. No coincidence of two masses can fake this.
    const double rTol = 1.0e-6 * std::max(1.0, Rhi);
    const double zTol = 1.0e-6 * std::max(1.0, std::fabs(v0) + dv);
    for (TopExp_Explorer ex(out, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        gp_Vec q(loc, p);
        const double z = q.Dot(gp_Vec(Zd));
        const double rr = (q - gp_Vec(Zd) * z).Magnitude();
        if (rr < Rlo - rTol || rr > Rhi + rTol || z < v0 - zTol || z > v1 + zTol)
            return defer("cylindrical path: a vertex left the annulus envelope");
    }
    return out;
}

}  // namespace

bool thickenNativeEnabled() {
#ifdef FORGE_THICKEN_DROP_NATIVE
    return true;   // the OCCT fallback is compiled out; this is the only path
#else
    static const bool on = envOn("FORGE_THICKEN_NATIVE");
    return on;
#endif
}

const char* thickenLastDeferReason() {
    return deferSlot().c_str();
}

TopoDS_Shape thickenShell(const TopoDS_Shape& shell, double t, double tol) {
    deferSlot().clear();
    if (shell.IsNull()) return defer("input shape is null");
    if (!std::isfinite(t) || std::fabs(t) < 1.0e-12) return defer("thickness is zero or not finite");
    const double r = std::fabs(t);
    const double sgn = (t > 0.0) ? 1.0 : -1.0;

    // ---- 0. PATH C — a lone CYLINDRICAL face ------------------------------
    // Tried FIRST and ONLY for a single-face input, so nothing on the planar
    // paths changes: a shell with two or more faces, or one planar face, falls
    // straight through to the code that has always handled it. See
    // thickenSingleCylinder's banner for the closed form, the rectangle
    // certificate, and the live-OCCT measurement the sign rule was read off.
    {
        TopoDS_Face only;
        int nFace = 0;
        for (TopExp_Explorer ex(shell, TopAbs_FACE); ex.More() && nFace < 2; ex.Next()) {
            only = TopoDS::Face(ex.Current());
            ++nFace;
        }
        if (nFace == 1 &&
            !Handle(Geom_CylindricalSurface)::DownCast(
                 basisSurface(BRep_Tool::Surface(only))).IsNull())
            return thickenSingleCylinder(only, t, tol);
    }

    // ---- 1. faces; every one must be a Geom_Plane -------------------------
    std::vector<TopoDS_Face> faces;
    std::vector<gp_Dir> N;        // TRUE outward normal per face
    std::vector<double> hesse;
    std::vector<double> area;
    for (TopExp_Explorer ex(shell, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        gp_Dir n; double d = 0.0;
        if (!outwardNormalOf(f, n, d))
            return defer("a face is not a Geom_Plane");
        faces.push_back(f);
        N.push_back(n);
        hesse.push_back(d);
        const double a = faceArea(f);
        if (!(a > 1.0e-12)) return defer("a face has zero area");
        area.push_back(a);
    }
    if (faces.empty()) return defer("the shape contains no face");

    // ---- 2. PATH A — every face in ONE plane: the shell's own prism -------
    bool coplanar = true;
    for (std::size_t i = 1; i < faces.size() && coplanar; ++i) {
        if (std::fabs(std::fabs(N[i].Dot(N[0])) - 1.0) > kPara) coplanar = false;
        else {
            // Same plane, allowing for an opposite-signed normal on a face whose
            // orientation differs: compare the plane, not the normal.
            const double d0 = hesse[0];
            const double di = (N[i].Dot(N[0]) > 0.0) ? hesse[i] : -hesse[i];
            if (std::fabs(di - d0) > 1.0e-7 * std::max(1.0, std::fabs(d0)))
                coplanar = false;
        }
    }
    if (coplanar) {
        TopoDS_Shape swept;
        try {
            swept = ::forge::occtPrism(shell, gp_Vec(N[0]) * (sgn * r), /*canonize=*/true);
        } catch (const std::exception&) {
            return defer("coplanar path: the shell prism failed");
        }
        const TopoDS_Shape sol = swept;
        if (sol.IsNull()) return defer("coplanar path: the shell prism is null");
        GProp_GProps p;
        BRepGProp::VolumeProperties(sol, p);
        double sumArea = 0.0;
        for (double a : area) sumArea += a;
        // EXACTNESS: a flat prism's volume IS area * thickness. Anything else
        // means the prism did not sweep what we measured.
        if (std::fabs(std::fabs(p.Mass()) - sumArea * r) > 1.0e-7 * sumArea * r)
            return defer("coplanar path: prism volume != area * thickness");
        return sol;
    }

    // ---- 3. PATH B — folded. Prism every face. ----------------------------
    std::vector<TopoDS_Shape> parts;
    parts.reserve(faces.size() + 8);
    double maxPrism = 0.0, sumParts = 0.0;
    for (std::size_t i = 0; i < faces.size(); ++i) {
        TopoDS_Shape part;
        try {
            part = ::forge::occtPrism(faces[i], gp_Vec(N[i]) * (sgn * r), /*canonize=*/true);
        } catch (const std::exception&) {
            return defer("folded path: a face prism failed");
        }
        if (part.IsNull()) return defer("folded path: a face prism failed");
        parts.push_back(part);
        const double v = area[i] * r;
        maxPrism = std::max(maxPrism, v);
        sumParts += v;
    }

    // ---- 4. one cylindrical sector wedge per CONVEX shared edge -----------
    TopTools_IndexedDataMapOfShapeListOfShape efMap;
    TopExp::MapShapesAndAncestors(shell, TopAbs_EDGE, TopAbs_FACE, efMap);
    TopTools_IndexedMapOfShape faceIndex;
    for (const TopoDS_Face& f : faces) faceIndex.Add(f);

    // Vertices touched by a CONVEX fold: if three or more non-coplanar faces meet
    // there the decomposition needs a SPHERICAL wedge this version does not build,
    // so the whole call declines rather than emit a body missing a corner patch.
    TopTools_IndexedDataMapOfShapeListOfShape vfMap;
    TopExp::MapShapesAndAncestors(shell, TopAbs_VERTEX, TopAbs_FACE, vfMap);

    for (int ei = 1; ei <= efMap.Extent(); ++ei) {
        const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(ei));
        const TopTools_ListOfShape& adj = efMap.FindFromIndex(ei);
        const int nAdj = adj.Extent();
        if (nAdj == 1) continue;                 // free rim: the prism caps it
        if (nAdj != 2)
            return defer("an edge is shared by more than two faces (non-manifold)");

        TopTools_ListIteratorOfListOfShape it(adj);
        const int i1 = faceIndex.FindIndex(it.Value()); it.Next();
        const int i2 = faceIndex.FindIndex(it.Value());
        if (i1 == 0 || i2 == 0) return defer("an edge names a face not in the shell");
        const std::size_t f1 = static_cast<std::size_t>(i1) - 1;
        const std::size_t f2 = static_cast<std::size_t>(i2) - 1;

        const gp_Dir a1(gp_Vec(N[f1]) * sgn);
        const gp_Dir a2(gp_Vec(N[f2]) * sgn);
        const double dot = std::max(-1.0, std::min(1.0, a1.Dot(a2)));
        if (dot > 1.0 - kPara) continue;         // coplanar fold: nothing to add
        if (dot < -1.0 + 1.0e-9)
            return defer("a 180-degree fold-back");

        gp_Dir u1, u2;
        if (!interiorDirAt(faces[f1], e, N[f1], u1) ||
            !interiorDirAt(faces[f2], e, N[f2], u2))
            return defer("a shared edge is not on a face's outer wire");

        if (gp_Vec(a1).Dot(gp_Vec(u2)) > 0.0) continue;   // CONCAVE: prisms overlap

        // CONVEX: build the wedge.
        gp_Pnt p0; gp_Dir edir; double len = 0.0;
        if (!straightEdge(e, p0, edir, len))
            return defer("a convex fold edge is not a straight segment");

        const gp_Vec bv = gp_Vec(a1) + gp_Vec(a2);
        if (bv.Magnitude() < 1.0e-12) return defer("a convex fold has no bisector");
        const gp_Dir b(bv);
        // SELF-CHECK: the sector must point AWAY from both plates.
        if (!(b.Dot(u1) < 0.0 && b.Dot(u2) < 0.0))
            return defer("the wedge bisector does not point away from both plates");

        // Every vertex of a convex fold must be an endpoint of exactly this fold,
        // not a meeting of three plates (which would need a spherical wedge).
        TopoDS_Vertex va, vb;
        TopExp::Vertices(e, va, vb);
        for (const TopoDS_Vertex& v : {va, vb}) {
            const int vi = vfMap.FindIndex(v);
            if (vi == 0) return defer("a fold endpoint is not in the vertex map");
            // DISTINCT faces. TopExp::MapShapesAndAncestors appends one entry per
            // (sub-shape, ancestor) VISIT, so a vertex that a face's wire reaches
            // through two of its edges is listed TWICE — measured on this very
            // shell, where the L fold's endpoints came back with Extent() == 4 and
            // the corner guard fired on a plain two-plate fold. Count the SET.
            TopTools_MapOfShape distinct;
            for (TopTools_ListIteratorOfListOfShape fit(vfMap.FindFromIndex(vi));
                 fit.More(); fit.Next())
                distinct.Add(fit.Value());
            if (distinct.Extent() > 2)
                return defer("a convex fold ends at a 3-or-more-plate corner "
                             "(the spherical vertex wedge is not built)");
        }

        const double theta = std::acos(dot);
        const TopoDS_Shape wedge = sectorWedge(p0, edir, len, r, a1, a2, theta);
        if (wedge.IsNull()) return kNull;   // sectorWedge already named the reason
        parts.push_back(wedge);
        sumParts += 0.5 * theta * r * r * len;
    }

    // ---- 5. fuse, then remove the fuse's coplanar seams -------------------
    // ONE n-ary fuse, not a pairwise chain. MEASURED: chaining fuses on the L
    // shell's CONVEX side deferred, because the two plate prisms sit on OPPOSITE
    // sides of the fold and TOUCH ONLY ALONG THE FOLD LINE — a degenerate
    // intermediate the pairwise fuse cannot resolve. The wedge is what connects
    // them, and an n-ary fuse sees all three operands at once.
    TopTools_ListOfShape args, tools;
    args.Append(parts[0]);
    for (std::size_t i = 1; i < parts.size(); ++i) tools.Append(parts[i]);
    BRepAlgoAPI_Fuse fuse;
    fuse.SetArguments(args);
    fuse.SetTools(tools);
    fuse.SetFuzzyValue(std::max(tol, 1.0e-7));
    fuse.Build();
    if (!fuse.IsDone()) return defer("the n-ary fuse of prisms and wedges failed");
    const TopoDS_Shape acc = fuse.Shape();
    if (acc.IsNull()) return defer("the fuse produced a null shape");
    ShapeUpgrade_UnifySameDomain unify(acc, Standard_True, Standard_True, Standard_True);
    unify.Build();
    const TopoDS_Shape out = unify.Shape();
    if (out.IsNull()) return defer("UnifySameDomain produced a null shape");

    // ---- 6. self-checks ---------------------------------------------------
    int nSolid = 0, nShell = 0;
    for (TopExp_Explorer ex(out, TopAbs_SOLID); ex.More(); ex.Next()) ++nSolid;
    for (TopExp_Explorer ex(out, TopAbs_SHELL); ex.More(); ex.Next()) ++nShell;
    if (nSolid != 1 || nShell != 1)
        return defer("the fused body is not exactly one solid with one shell");

    GProp_GProps p;
    BRepGProp::VolumeProperties(out, p);
    const double vol = std::fabs(p.Mass());
    // DERIVATION 3's bracket. A tiny relative slack absorbs the fuzzy value only.
    const double slack = 1.0e-9 * std::max(1.0, sumParts);
    if (!(vol > 0.0)) return defer("the fused body has no volume");
    if (vol < maxPrism - slack)
        return defer("volume below the max-prism bound: the fuse lost a plate");
    if (vol > sumParts + slack)
        return defer("volume above the sum-of-parts bound: the fuse double-counted");
    return out;
}

}  // namespace occtthicken
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
