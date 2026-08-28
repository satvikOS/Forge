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
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
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
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
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

    BRepPrimAPI_MakePrism mkp(mkf.Face(), gp_Vec(dir) * len);
    if (!mkp.IsDone()) return defer("wedge: the sector prism could not be built");
    return mkp.Shape();
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
        BRepPrimAPI_MakePrism mkp(shell, gp_Vec(N[0]) * (sgn * r));
        if (!mkp.IsDone()) return defer("coplanar path: the shell prism failed");
        const TopoDS_Shape sol = mkp.Shape();
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
        BRepPrimAPI_MakePrism mkp(faces[i], gp_Vec(N[i]) * (sgn * r));
        if (!mkp.IsDone()) return defer("folded path: a face prism failed");
        parts.push_back(mkp.Shape());
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
