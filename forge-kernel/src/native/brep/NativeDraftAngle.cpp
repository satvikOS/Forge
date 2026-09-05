// forge/native/brep/NativeDraftAngle.cpp
//
// Implementation of forge::occtdraft::draftFaces — the TKOffset-free replacement
// for BRepOffsetAPI_DraftAngle (TKOffset family C, 6 symbols, one call site at
// src/Features.cpp draftFaces). Read NativeDraftAngle.hpp first: it carries the
// measured OCCT oracle, the sign convention, and the honest defer list.
//
// This file references NO BRepOffset*/BRepOffsetAPI*/Draft_* symbol. It builds the
// two exact difference bodies (the material the draft removes, and the material it
// adds) as analytic primitives and applies them with exact B-rep booleans, so a
// drafted plane stays a plane and a drafted cylinder becomes a true cone. Nothing
// is tessellated.
//
// ---------------------------------------------------------------------------
// THE ONE THING TO GET RIGHT: LOCALISATION
// ---------------------------------------------------------------------------
// It is tempting to write the planar draft as `solid ∩ draftedHalfSpace`. That is
// correct only when the face's plane supports the entire solid. On an L-bracket the
// inner flank's plane does not, and the half-space quietly mills away the far leg —
// a silently wrong answer, which is worse than a defer. So the half-space is always
// intersected with a PRISM built from the face itself (inner wires included), which
// confines the change to the face's own footprint. The prism is finite: its depth is
// derived from the face's own bounding box, because the wedge can never be deeper
// than max|h·tan(alpha)| over the face.
//
// ---------------------------------------------------------------------------
// WHY THERE IS NO BRepPrimAPI HERE (regression fixed 2026-08-07)
// ---------------------------------------------------------------------------
// This file originally built its four helper bodies with BRepPrimAPI_Make{Box,Cone,
// Cylinder,Prism}, justified in the header as "TKPrim, already used by
// src/Primitives.cpp". That premise EXPIRED on 2026-07-21: the K-PRIM drop
// (CMakeLists.txt) retired the LAST TKPrim consumer in the tree, and every primitive
// now goes through forge::occt{Box,Cylinder,Cone}Solid / forge::occtPrism
// (src/OcctPrimBuilder.cpp). Writing BRepPrimAPI here therefore did not reuse an
// existing dependency — it RE-CREATED one. Measured on the shipped .node: TKPrim went
// from 0 exclusive undefined symbols (reports/OCCT_CLOSURE_TRUTH.md §1.3, 2026-07-31)
// to 12, and OCCT_PHANTOM 2 -> 3. macOS `-undefined dynamic_lookup` hid it; a
// strict-link Linux CI would have failed to link. A native replacement must never
// re-import the toolkit the surrounding programme is trying to delete.
//
// The four bodies now come from the SAME builders the rest of the kernel uses, and are
// proven region-identical to what they replace: symmetric difference EXACTLY zero over
// 22 constructions covering oblique frames, reversed axes, degenerate-to-cylinder cones
// and holed profiles.
//
// ONE representation difference is accepted and deliberate. occtPrism keeps the exact
// Geom_SurfaceOfLinearExtrusion lateral, where BRepPrimAPI_MakePrism defaulted to
// Canonize=true and rewrote a straight-edge lateral as a Plane. That is invisible here
// because the prism is only ever an INTERSECTION TOOL — it is intersected with a
// half-space to form the difference bodies and contributes no face to the result —
// verified by a 24-case volume / face-count / surface-type census that is bit-identical
// before and after.
//
// ONE behavioural note: the OcctPrimBuilder peers report failure by throwing
// std::runtime_error, NOT Standard_Failure. Every catch in this file therefore also
// takes std::exception, so a builder failure stays an HONEST DEFER instead of escaping
// draftFaces as an unhandled throw.

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/NativeDraftAngle.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include "forge/native/brep/NativeAabbBridge.hpp"  // shapeAabb: native analytic AABB, honest OCCT fall-through
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include "forge/OcctPrimBuilder.hpp"  // TKPrim-free box / cylinder / cone / prism builders
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_Surface.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopExp.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Pln.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

namespace forge {
namespace occtdraft {

namespace {

constexpr double kTiny = 1e-12;
// A face normal within this of the pull direction has no usable draft tangent.
constexpr double kParallelCos = 1.0 - 1e-7;
// Beyond this the taper is not a manufacturing draft and the wedge geometry
// degenerates; OCCT is unreliable here too.
constexpr double kMaxAngleRad = 80.0 * M_PI / 180.0;

struct Defer {
    std::string reason;
};

double shapeVolume(const TopoDS_Shape& s) {
    if (s.IsNull()) return 0.0;
    GProp_GProps g;
    BRepGProp::VolumeProperties(s, g);
    return g.Mass();
}

bool hasSolid(const TopoDS_Shape& s) {
    if (s.IsNull()) return false;
    TopExp_Explorer ex(s, TopAbs_SOLID);
    return ex.More() == Standard_True;
}

// The un-trimmed basis surface of a face (a Geom_RectangularTrimmedSurface wrapper
// carries the same analytic geometry; the draft acts on the basis).
Handle(Geom_Surface) basisOf(const TopoDS_Face& f) {
    TopLoc_Location loc;
    Handle(Geom_Surface) s = BRep_Tool::Surface(f, loc);
    if (s.IsNull()) return s;
    // BRep_Tool::Surface(face) (no location out-param) already applies the location;
    // use that form so the geometry is in world space.
    s = BRep_Tool::Surface(f);
    for (int guard = 0; guard < 8 && !s.IsNull(); ++guard) {
        Handle(Geom_RectangularTrimmedSurface) rt =
            Handle(Geom_RectangularTrimmedSurface)::DownCast(s);
        if (rt.IsNull()) break;
        s = rt->BasisSurface();
    }
    return s;
}

// Outward normal of `f` at the centre of its UV window, with the face's own
// orientation applied. Returns false when the surface is degenerate there.
bool outwardNormalAt(const TopoDS_Face& f, const Handle(Geom_Surface)& s,
                     double u, double v, gp_Dir& out) {
    gp_Pnt p;
    gp_Vec du, dv;
    s->D1(u, v, p, du, dv);
    gp_Vec n = du.Crossed(dv);
    if (n.Magnitude() < kTiny) return false;
    gp_Dir d(n);
    if (f.Orientation() == TopAbs_REVERSED) d.Reverse();
    out = d;
    return true;
}

struct Extent {
    double lo = 0.0;   // min signed height along pull
    double hi = 0.0;   // max signed height along pull
    double diag = 0.0; // bounding-box diagonal of the whole shape
};

// Signed-height window of `s` along `pull`, measured from `o`.
bool heightWindow(const TopoDS_Shape& s, const gp_Pnt& o, const gp_Dir& pull,
                  double& lo, double& hi, double& diag) {
    Bnd_Box bb;
    forge::native::brep::shapeAabb(s, bb);
    if (bb.IsVoid()) return false;
    double xa, ya, za, xb, yb, zb;
    bb.Get(xa, ya, za, xb, yb, zb);
    diag = gp_Pnt(xa, ya, za).Distance(gp_Pnt(xb, yb, zb));
    lo = std::numeric_limits<double>::max();
    hi = -std::numeric_limits<double>::max();
    for (int i = 0; i < 8; ++i) {
        gp_Pnt c((i & 1) ? xb : xa, (i & 2) ? yb : ya, (i & 4) ? zb : za);
        const double h = gp_Vec(o, c).Dot(gp_Vec(pull));
        lo = std::min(lo, h);
        hi = std::max(hi, h);
    }
    return true;
}

// A box covering the whole `side` of the plane {x : n·x = c}: the half-space
// {n·x >= c} when sign=+1, {n·x <= c} when sign=-1. Bounded, so every boolean is
// solid-against-solid (OCCT's infinite half-space solids are markedly less robust).
TopoDS_Shape halfSpaceBox(const gp_Dir& n, double c, const gp_Pnt& centre,
                          double reach, int sign) {
    const gp_Dir zdir = (sign >= 0) ? n : gp_Dir(-n.X(), -n.Y(), -n.Z());
    // Foot of `centre` on the plane.
    const double dist = gp_Vec(centre.XYZ()).Dot(gp_Vec(n)) - c;
    gp_Pnt foot(centre.XYZ() - n.XYZ() * dist);
    // Build a frame whose Z is `zdir`; slide the origin back by reach/2 laterally.
    gp_Ax2 frame(foot, zdir);
    const gp_Dir ux = frame.XDirection();
    const gp_Dir uy = frame.YDirection();
    gp_Pnt corner(foot.XYZ() - ux.XYZ() * (reach * 0.5) - uy.XYZ() * (reach * 0.5));
    // The TKPrim-free equivalent of BRepPrimAPI_MakeBox(gp_Ax2(corner, zdir, ux), r,r,r):
    // that call places a cube's min corner at the frame origin with its edges along the
    // frame axes, so the axis-aligned occtBoxSolid cube rigidly placed into the same
    // frame is the identical solid. The matrix columns ARE the frame axes and the
    // translation IS its origin, so local (x,y,z) maps to corner + x*X + y*Y + z*Z —
    // written out explicitly because gp_Trsf::SetTransformation's direction convention is
    // easy to invert by accident. Measured: symmetric difference exactly 0 over 8 frames
    // including body-diagonal, reversed and 3deg-tilted axes.
    const gp_Ax2 frame2(corner, zdir, ux);
    const gp_Dir fX = frame2.XDirection(), fY = frame2.YDirection(), fZ = frame2.Direction();
    gp_Trsf place;
    place.SetValues(fX.X(), fY.X(), fZ.X(), corner.X(),
                    fX.Y(), fY.Y(), fZ.Y(), corner.Y(),
                    fX.Z(), fY.Z(), fZ.Z(), corner.Z());
    const TopoDS_Shape cube = forge::occtBoxSolid(gp_Pnt(0, 0, 0), gp_Pnt(reach, reach, reach));
    BRepBuilderAPI_Transform mv(cube, place, Standard_True);
    if (!mv.IsDone()) throw std::runtime_error("draft: half-space box placement failed");
    return mv.Shape();
}

// A solid of revolution about `pull` whose radius is r0 at height h0 and r1 at h1.
// `axisAtZero` is the point of the axis lying on the neutral plane.
//
// The r0 == r1 case is the COMMON one here — the ORIGINAL body of a cylindrical wall
// has constant radius — and it is routed to the cylinder builder explicitly. That was
// once mandatory because BRepPrimAPI_MakeCone RAISED ("cone with the same radius") on
// equal radii; getting it wrong made every curved-wall draft throw. occtConeSolid
// degenerates to occtCylinderSolid on its own (|r1-r2| <= Precision::Confusion), so the
// branch is now belt-and-braces rather than load-bearing — and it additionally closes
// the old 1e-12..1e-7 radius window where MakeCone would still have raised.
TopoDS_Shape revolutionBody(const gp_Pnt& axisAtZero, const gp_Dir& pull,
                            double h0, double h1, double r0, double r1) {
    const double H = h1 - h0;
    if (H <= kTiny) return TopoDS_Shape();
    const gp_Pnt base(axisAtZero.XYZ() + pull.XYZ() * h0);
    const gp_Ax2 frame(base, pull);
    const double rmean = 0.5 * (r0 + r1);
    if (std::fabs(r0 - r1) <= 1e-12 * std::max(1.0, rmean)) {
        return forge::occtCylinderSolid(frame, rmean, H);
    }
    return forge::occtConeSolid(frame, r0, r1, H);
}

// A boolean that yields a null shape rather than a half-built one on failure.
TopoDS_Shape boolOp(int op, const TopoDS_Shape& a, const TopoDS_Shape& b) {
    if (a.IsNull() || b.IsNull()) return TopoDS_Shape();
    try {
        if (op == 0) {
            BRepAlgoAPI_Cut m(a, b);
            if (!m.IsDone()) return TopoDS_Shape();
            return m.Shape();
        }
        if (op == 1) {
            BRepAlgoAPI_Fuse m(a, b);
            if (!m.IsDone()) return TopoDS_Shape();
            return m.Shape();
        }
        BRepAlgoAPI_Common m(a, b);
        if (!m.IsDone()) return TopoDS_Shape();
        return m.Shape();
    } catch (const Standard_Failure&) {
        return TopoDS_Shape();
    }
}
const int kCut = 0, kFuse = 1, kCommon = 2;

// The two difference bodies for ONE selected face, computed against the ORIGINAL
// shape. `cutBody` is material the draft removes, `addBody` material it adds; both
// may be null (an empty difference is normal, e.g. a base-plane draft adds nothing).
struct Wedge {
    TopoDS_Shape cutBody;
    TopoDS_Shape addBody;
    // Planar-only book-keeping, needed for the SHARED-CORNER fill below.
    bool   planar = false;
    gp_Dir m;            // outward normal of the original face
    double dOrig = 0.0;  // original plane:  m·x = dOrig
    gp_Dir nDraft;       // unit normal of the drafted plane
    double cDraft = 0.0; // drafted plane:   nDraft·x = cDraft
};

// ---------------------------------------------------------------- planar face
bool planarWedge(const TopoDS_Face& face, const Handle(Geom_Plane)& pl,
                 const gp_Pnt& o, const gp_Dir& pull, double t,
                 const gp_Pnt& centre, double reach, Wedge& out, std::string& why) {
    gp_Dir m = pl->Pln().Axis().Direction();
    if (face.Orientation() == TopAbs_REVERSED) m.Reverse();

    const double cosMP = m.Dot(pull);
    if (std::fabs(cosMP) > kParallelCos) {
        why = "planar face normal is parallel to the pull direction — no draft tangent";
        return false;
    }

    // Drafted plane  N·x = c,  N = m + t·p̂,  c = m·q + t·(p̂·o)   with q on the face.
    const gp_Pnt q = pl->Pln().Location();
    gp_Vec Nv = gp_Vec(m) + gp_Vec(pull) * t;
    const double Nlen = Nv.Magnitude();
    if (Nlen < kTiny) {
        why = "drafted plane normal degenerates";
        return false;
    }
    const double c = (gp_Vec(q.XYZ()).Dot(gp_Vec(m)) + t * gp_Vec(o.XYZ()).Dot(gp_Vec(pull)));
    const gp_Dir Nhat(Nv);
    const double chat = c / Nlen;

    // Prism depth: strictly greater than max|h·t| over THIS face.
    double flo = 0.0, fhi = 0.0, fdiag = 0.0;
    if (!heightWindow(face, o, pull, flo, fhi, fdiag)) {
        why = "selected face has an empty bounding box";
        return false;
    }
    const double hmax = std::max(std::fabs(flo), std::fabs(fhi));
    const double depth = std::fabs(t) * hmax * 1.5 + 1e-6 * std::max(1.0, fdiag) + 1e-9;

    const TopoDS_Face fwd = TopoDS::Face(face.Oriented(TopAbs_FORWARD));
    TopoDS_Shape prismIn, prismOut, plus, minus;
    // occtPrism / occtBoxSolid signal failure with std::runtime_error, OCCT with
    // Standard_Failure. Both must land here, or a builder failure escapes draftFaces
    // as an unhandled throw instead of the honest defer the contract promises.
    try {
        // canonize=true is REQUIRED, not cosmetic. These prisms' lateral faces lie
        // exactly ON the neighbouring faces of the solid, and the following booleans
        // only stay exact when OCCT can see the two as the SAME surface. With the
        // default extrusion-typed laterals it falls back to a numerical surface/surface
        // intersection of two nominally coincident surfaces, and every PLANAR draft
        // comes out wrong by ~1e-8 relative (measured: box one wall @+3deg gave
        // 973.796119834 against the exact 973.796110358). Curved drafts are unaffected
        // because they never build a prism.
        prismIn = forge::occtPrism(fwd, gp_Vec(m) * (-depth), /*canonize=*/true);
        prismOut = forge::occtPrism(fwd, gp_Vec(m) * (depth), /*canonize=*/true);
        plus = halfSpaceBox(Nhat, chat, centre, reach, +1);
        minus = halfSpaceBox(Nhat, chat, centre, reach, -1);
    } catch (const Standard_Failure&) {
        why = "could not extrude the selected face into a localisation prism";
        return false;
    } catch (const std::exception& e) {
        why = std::string("could not build the draft localisation bodies: ") + e.what();
        return false;
    }
    if (prismIn.IsNull() || prismOut.IsNull()) {
        why = "localisation prism is null";
        return false;
    }
    if (plus.IsNull() || minus.IsNull()) {
        why = "draft half-space body is null";
        return false;
    }

    out.cutBody = boolOp(kCommon, prismIn, plus);
    out.addBody = boolOp(kCommon, prismOut, minus);
    out.planar = true;
    out.m = m;
    out.dOrig = gp_Vec(q.XYZ()).Dot(gp_Vec(m));
    out.nDraft = Nhat;
    out.cDraft = chat;
    return true;
}

// ---------------------------------------------------- shared corner (ADD side)
// WHY THIS EXISTS — measured, not anticipated.
//
// The CUT side needs no corner term: the wedges of two adjacent walls OVERLAP
// where they meet, so their union already removes the shared corner and the
// all-four-walls frustum comes out exact.
//
// The ADD side does not. Each per-face prism is bounded by its own face's
// footprint, so when two adjacent walls BOTH flare outward — which happens
// whenever part of a wall lies BELOW the neutral plane for a positive angle —
// the column beyond BOTH original planes belongs to neither prism and is left
// unfilled. Measured on the 10^3 box drafted on all four walls at +5deg:
//   neutral z=10  union-of-prisms 1174.977327052  vs OCCT 1185.183015379
//   neutral z=5   union-of-prisms 1001.275711041  vs OCCT 1002.551422082
// and the two shortfalls are 4·t²·1000/3 = 10.205688327 and 4·t²·125/3 =
// 1.275711041 EXACTLY — i.e. precisely the four missing corner columns. A
// volume-only gate would have called this "0.9% off" and shipped it.
//
// The corner column between adjacent walls i and j is bounded by four planes —
// beyond both ORIGINAL planes, inside both DRAFTED planes — and, along the
// shared edge, by that edge's own extent. Six half-space boxes, all bounded.
TopoDS_Shape cornerBody(const Wedge& a, const Wedge& b, const TopoDS_Edge& shared,
                        const gp_Pnt& centre, double reach) {
    // Direction of the shared edge: for two planes it is m_a x m_b.
    const gp_Vec cross = gp_Vec(a.m).Crossed(gp_Vec(b.m));
    if (cross.Magnitude() < 1e-9) return TopoDS_Shape();   // parallel walls: no corner
    const gp_Dir e(cross);

    // EXACT endpoints, not the bounding box — a Bnd_Box Gap of ~1e-7 here would
    // extend the fused column past the edge it belongs to, adding material the
    // drafted solid does not have (the same 1e-7 sliver trap the curved path hit).
    TopoDS_Vertex va, vb;
    TopExp::Vertices(shared, va, vb);
    if (va.IsNull() || vb.IsNull()) return TopoDS_Shape();
    const gp_Pnt pa = BRep_Tool::Pnt(va);
    const gp_Pnt pb = BRep_Tool::Pnt(vb);
    double lo = gp_Vec(pa.XYZ()).Dot(gp_Vec(e));
    double hi = gp_Vec(pb.XYZ()).Dot(gp_Vec(e));
    if (lo > hi) std::swap(lo, hi);
    if (hi - lo <= 1e-12) return TopoDS_Shape();

    // A null return is the caller's HARD DEFER signal ("could not build the shared
    // corner column"), so converting a builder throw into null here stays honest —
    // it never silently drops the corner.
    try {
        TopoDS_Shape acc = halfSpaceBox(a.m, a.dOrig, centre, reach, +1);
        const TopoDS_Shape parts[5] = {
            halfSpaceBox(b.m, b.dOrig, centre, reach, +1),
            halfSpaceBox(a.nDraft, a.cDraft, centre, reach, -1),
            halfSpaceBox(b.nDraft, b.cDraft, centre, reach, -1),
            halfSpaceBox(e, lo, centre, reach, +1),
            halfSpaceBox(e, hi, centre, reach, -1),
        };
        for (const TopoDS_Shape& p : parts) {
            acc = boolOp(kCommon, acc, p);
            if (acc.IsNull() || !hasSolid(acc)) return TopoDS_Shape();
        }
        return acc;
    } catch (const Standard_Failure&) {
        return TopoDS_Shape();
    } catch (const std::exception&) {
        return TopoDS_Shape();
    }
}

// Do faces `x` and `y` of `src` share at least one edge?
bool sharesEdge(const TopoDS_Face& x, const TopoDS_Face& y, TopoDS_Edge& out) {
    for (TopExp_Explorer ex(x, TopAbs_EDGE); ex.More(); ex.Next()) {
        for (TopExp_Explorer ey(y, TopAbs_EDGE); ey.More(); ey.Next()) {
            if (ex.Current().IsSame(ey.Current())) {
                out = TopoDS::Edge(ex.Current());
                return true;
            }
        }
    }
    return false;
}

// ------------------------------------------------- cylindrical / conical face
bool revolutionWedge(const TopoDS_Face& face, const Handle(Geom_Surface)& surf,
                     const gp_Pnt& o, const gp_Dir& pull, double t,
                     Wedge& out, std::string& why) {
    Handle(Geom_CylindricalSurface) cyl = Handle(Geom_CylindricalSurface)::DownCast(surf);
    Handle(Geom_ConicalSurface) con = Handle(Geom_ConicalSurface)::DownCast(surf);
    if (cyl.IsNull() && con.IsNull()) {
        why = "not a cylindrical or conical face";
        return false;
    }

    const gp_Ax3 ax = cyl.IsNull() ? con->Position() : cyl->Position();
    const gp_Dir adir = ax.Direction();
    const double align = adir.Dot(pull);
    if (std::fabs(align) < kParallelCos) {
        why = "curved wall axis is not parallel to the pull direction — "
              "the drafted surface would not be a surface of revolution";
        return false;
    }
    const double e = (align > 0.0) ? 1.0 : -1.0;

    // Full revolution only: a partial angular wall needs a real 2-D trim, and one
    // wire only: a hole through a curved wall likewise.
    double u0 = 0.0, u1 = 0.0, v0 = 0.0, v1 = 0.0;
    BRepTools::UVBounds(face, u0, u1, v0, v1);
    if (std::fabs((u1 - u0) - 2.0 * M_PI) > 1e-6) {
        why = "curved wall is not a full revolution in u";
        return false;
    }
    {
        int wires = 0;
        for (TopExp_Explorer ex(face, TopAbs_WIRE); ex.More(); ex.Next()) ++wires;
        if (wires != 1) {
            why = "curved wall carries more than one wire";
            return false;
        }
    }

    // Outward radial sense at the middle of the face.
    gp_Dir nrm;
    if (!outwardNormalAt(face, surf, 0.5 * (u0 + u1), 0.5 * (v0 + v1), nrm)) {
        why = "curved wall normal is degenerate at its parametric centre";
        return false;
    }
    gp_Pnt pm;
    surf->D0(0.5 * (u0 + u1), 0.5 * (v0 + v1), pm);
    // Radial direction at pm: pm minus its projection on the axis line.
    const gp_Vec toP(ax.Location(), pm);
    const gp_Vec radial = toP - gp_Vec(adir) * toP.Dot(gp_Vec(adir));
    if (radial.Magnitude() < kTiny) {
        why = "curved wall sample point lies on its own axis";
        return false;
    }
    const double s = (nrm.Dot(gp_Dir(radial)) >= 0.0) ? 1.0 : -1.0;

    // Radius as a function of signed height above the neutral plane.
    //   cylinder : r(h) = R
    //   cone     : r(h) = Rref + e·(h - hLoc)·tan(semiAngle)
    const double hLoc = gp_Vec(o, ax.Location()).Dot(gp_Vec(pull));
    const double Rref = cyl.IsNull() ? con->RefRadius() : cyl->Radius();
    const double slope = cyl.IsNull() ? (e * std::tan(con->SemiAngle())) : 0.0;
    auto rOrig = [&](double h) { return Rref + slope * (h - hLoc); };
    auto rNew = [&](double h) { return rOrig(h) - s * h * t; };

    // ── EXACT axial span, NOT the bounding box ─────────────────────────────────
    // Bnd_Box carries a Gap (the shape tolerance, ~1e-7). Feeding a span loose by
    // 1e-7 into the difference bodies puts their end caps within OCCT's confusion
    // tolerance of the solid's own caps, and the boolean then leaves a sliver:
    // measured, the cylinder->cone draft came out 8020.640533771 against the exact
    // 8020.640499186 (4.3e-9 relative) purely from that gap, and the JS replication
    // of this engine at span [-1e-7, 30+1e-7] reproduces the wrong figure to every
    // digit while the exact span [0,30] is right to 1.1e-16. The parametrisation
    // gives the span in closed form, so use it:
    //   Geom_CylindricalSurface  P(u,v) = loc + R·(cos u·X + sin u·Y) + v·Dir
    //       -> axial coordinate along Dir is v
    //   Geom_ConicalSurface      P(u,v) = loc + (R + v·sin a)(...) + v·cos a·Dir
    //       -> axial coordinate along Dir is v·cos(a)
    const double vScale = cyl.IsNull() ? std::cos(con->SemiAngle()) : 1.0;
    const double hv0 = hLoc + e * v0 * vScale;
    const double hv1 = hLoc + e * v1 * vScale;
    double flo = std::min(hv0, hv1);
    double fhi = std::max(hv0, hv1);
    if (!std::isfinite(flo) || !std::isfinite(fhi)) {
        why = "curved wall has an unbounded parametric span along its axis";
        return false;
    }
    if (fhi - flo <= 1e-9) {
        why = "selected curved face has zero axial extent along the pull direction";
        return false;
    }
    const double rA0 = rOrig(flo), rA1 = rOrig(fhi);
    const double rB0 = rNew(flo), rB1 = rNew(fhi);
    const double rmin = std::min(std::min(rA0, rA1), std::min(rB0, rB1));
    if (!(rmin > 1e-9)) {
        why = "the taper drives a radius to zero or negative inside the wall's own span";
        return false;
    }

    // Point of the axis lying on the neutral plane (the axis is parallel to pull,
    // so sliding along pull stays on it).
    const gp_Pnt axisAtZero(ax.Location().XYZ() - pull.XYZ() * hLoc);

    TopoDS_Shape A, B;
    // Same rule as planarWedge: occtCylinderSolid / occtConeSolid throw std::runtime_error.
    try {
        A = revolutionBody(axisAtZero, pull, flo, fhi, rA0, rA1);
        B = revolutionBody(axisAtZero, pull, flo, fhi, rB0, rB1);
    } catch (const Standard_Failure&) {
        why = "could not build the revolution bodies for the curved wall";
        return false;
    } catch (const std::exception& e) {
        why = std::string("could not build the revolution bodies for the curved wall: ") + e.what();
        return false;
    }
    if (A.IsNull() || B.IsNull()) {
        why = "could not build the revolution bodies for the curved wall";
        return false;
    }

    if (s > 0.0) {          // boss: material inside
        out.cutBody = boolOp(kCut, A, B);
        out.addBody = boolOp(kCut, B, A);
    } else {                // bore: material outside
        out.cutBody = boolOp(kCut, B, A);
        out.addBody = boolOp(kCut, A, B);
    }
    return true;
}

}  // namespace

// ---------------------------------------------------------------------------
TopoDS_Shape draftFaces(const TopoDS_Shape& src,
                        const gp_Pnt& neutralOrigin,
                        const gp_Dir& pull,
                        const std::vector<std::uint32_t>& faceIds,
                        double angleRad,
                        std::string* why) {
    auto defer = [&](const char* r) {
        if (why != nullptr) *why = r;
        return TopoDS_Shape();
    };
    auto deferS = [&](const std::string& r) {
        if (why != nullptr) *why = r;
        return TopoDS_Shape();
    };
    if (why != nullptr) why->clear();

    if (src.IsNull()) return defer("source shape is null");
    if (faceIds.empty()) return defer("no faces selected");
    if (!std::isfinite(angleRad)) return defer("draft angle is not finite");
    if (std::fabs(angleRad) >= kMaxAngleRad)
        return defer("draft angle magnitude is >= 80 deg — outside the wedge's valid range");

    const double t = std::tan(angleRad);
    if (std::fabs(t) < kTiny) return src;   // exact identity, as OCCT gives.

    if (!hasSolid(src)) return defer("source shape carries no solid");
    const double v0 = shapeVolume(src);
    if (!(std::isfinite(v0) && v0 > kTiny)) return defer("source shape has no positive volume");

    double slo = 0.0, shi = 0.0, sdiag = 0.0;
    if (!heightWindow(src, neutralOrigin, pull, slo, shi, sdiag))
        return defer("source shape has an empty bounding box");

    Bnd_Box bb;
    forge::native::brep::shapeAabb(src, bb);
    double xa, ya, za, xb, yb, zb;
    bb.Get(xa, ya, za, xb, yb, zb);
    const gp_Pnt centre(0.5 * (xa + xb), 0.5 * (ya + yb), 0.5 * (za + zb));
    // Reach must swallow the shape from any orientation, plus the wedge itself.
    const double reach = 4.0 * (sdiag + std::fabs(t) * std::max(std::fabs(slo), std::fabs(shi))) + 1.0;

    // Resolve every selected face against the ORIGINAL shape, then apply. Anything
    // else would make a multi-face draft sequence-dependent.
    std::vector<TopoDS_Face> picked;
    picked.reserve(faceIds.size());
    for (std::uint32_t want : faceIds) {
        std::uint32_t i = 0;
        TopoDS_Face found;
        for (TopExp_Explorer ex(src, TopAbs_FACE); ex.More(); ex.Next(), ++i) {
            if (i == want) { found = TopoDS::Face(ex.Current()); break; }
        }
        if (found.IsNull())
            return deferS("selected face id " + std::to_string(want) + " is out of range");
        picked.push_back(found);
    }

    std::vector<Wedge> wedges;
    wedges.reserve(picked.size());
    for (const TopoDS_Face& f : picked) {
        Handle(Geom_Surface) surf = basisOf(f);
        if (surf.IsNull()) return defer("selected face has no surface");

        Wedge w;
        std::string reason;
        bool ok = false;
        Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(surf);
        try {
            if (!pl.IsNull()) {
                ok = planarWedge(f, pl, neutralOrigin, pull, t, centre, reach, w, reason);
            } else {
                ok = revolutionWedge(f, surf, neutralOrigin, pull, t, w, reason);
            }
        } catch (const Standard_Failure& e) {
            reason = std::string("OCCT failure building the draft wedge: ") +
                     (e.GetMessageString() != nullptr ? e.GetMessageString() : "unknown");
            ok = false;
        } catch (const std::exception& e) {
            // The TKPrim-free primitive builders report failure this way. Without this
            // arm a builder throw would escape draftFaces entirely instead of deferring.
            reason = std::string("failure building the draft wedge: ") + e.what();
            ok = false;
        }
        if (!ok) return deferS(reason);
        wedges.push_back(w);
    }

    auto live = [](const TopoDS_Shape& s) {
        return !s.IsNull() && hasSolid(s) && shapeVolume(s) > 1e-12;
    };

    // ── SHARED-CORNER FILL (ADD side only; see cornerBody's note) ───────────────
    // Every pair of selected walls that BOTH flare outward and share an edge
    // contributes one corner column that no per-face prism reaches.
    std::vector<TopoDS_Shape> corners;
    std::vector<int> flaring;
    for (std::size_t i = 0; i < wedges.size(); ++i) {
        if (live(wedges[i].addBody)) flaring.push_back(static_cast<int>(i));
    }
    if (flaring.size() >= 2) {
        // A vertex shared by three or more flaring walls needs a genuine three-way
        // meet, which pairwise columns do not reconstruct. Refuse rather than be
        // quietly short.
        for (TopExp_Explorer ev(src, TopAbs_VERTEX); ev.More(); ev.Next()) {
            int n = 0;
            for (int idx : flaring) {
                for (TopExp_Explorer ex(picked[idx], TopAbs_VERTEX); ex.More(); ex.Next()) {
                    if (ex.Current().IsSame(ev.Current())) { ++n; break; }
                }
            }
            if (n >= 3) {
                return defer("three or more outward-flaring walls meet at one vertex — "
                             "the shared corner needs a three-way meet this engine does "
                             "not build");
            }
        }
        for (std::size_t a = 0; a < flaring.size(); ++a) {
            for (std::size_t b = a + 1; b < flaring.size(); ++b) {
                const Wedge& wa = wedges[flaring[a]];
                const Wedge& wb = wedges[flaring[b]];
                TopoDS_Edge shared;
                if (!sharesEdge(picked[flaring[a]], picked[flaring[b]], shared)) continue;
                if (!wa.planar || !wb.planar) {
                    return defer("two adjacent outward-flaring walls meet along a curved "
                                 "wall — the shared corner is not a planar column");
                }
                const TopoDS_Shape c = cornerBody(wa, wb, shared, centre, reach);
                if (c.IsNull() || !hasSolid(c)) {
                    return defer("could not build the shared corner column between two "
                                 "outward-flaring walls");
                }
                // A REFLEX shared edge puts the column INSIDE the solid, where fusing
                // it would be meaningless at best. Detect it by measurement.
                const TopoDS_Shape inside = boolOp(kCommon, c, src);
                if (!inside.IsNull() && shapeVolume(inside) > 1e-9 * shapeVolume(c)) {
                    return defer("the shared corner between two outward-flaring walls is "
                                 "reflex (the column lies inside the solid)");
                }
                corners.push_back(c);
            }
        }
    }

    TopoDS_Shape result = src;
    for (const Wedge& w : wedges) {
        if (live(w.cutBody)) {
            const TopoDS_Shape r = boolOp(kCut, result, w.cutBody);
            if (r.IsNull()) return defer("the draft cut boolean failed");
            result = r;
        }
    }
    for (const Wedge& w : wedges) {
        if (live(w.addBody)) {
            const TopoDS_Shape r = boolOp(kFuse, result, w.addBody);
            if (r.IsNull()) return defer("the draft fuse boolean failed");
            result = r;
        }
    }
    for (const TopoDS_Shape& c : corners) {
        const TopoDS_Shape r = boolOp(kFuse, result, c);
        if (r.IsNull()) return defer("the shared-corner fuse boolean failed");
        result = r;
    }

    if (!hasSolid(result)) return defer("drafted result carries no solid");
    const double v1 = shapeVolume(result);
    if (!(std::isfinite(v1) && v1 > kTiny)) return defer("drafted result has no positive volume");
    return result;
}

}  // namespace occtdraft
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
