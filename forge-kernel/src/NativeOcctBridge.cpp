// forge/NativeOcctBridge.cpp — native→OCCT fallback bridge (see header).

#include "forge/NativeOcctBridge.hpp"

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/Topology.hpp"        // Solid / Shell / Face / Loop / Coedge / Vertex
#include "forge/native/brep/Surface.hpp"         // SurfaceKind
#include "forge/native/brep/SolidTessellate.hpp" // tessellateSolid (faceted fallback)
#include "forge/native/brep/MassProps.hpp"       // massProperties (analytic volume cross-check)

#include <gp_Pnt.hxx>
#include <gp_Pln.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <gp_XYZ.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Vec2d.hxx>
#include <Geom_Plane.hxx>
#include <Geom2d_Line.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_ConicalSurface.hxx>
#include "forge/OcctPrimBuilder.hpp"   // TKPrim-free analytic primitive solids (cone/sphere/torus)
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopAbs.hxx>
#include <TopExp_Explorer.hxx>
#include <BRep_Builder.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRep_Tool.hxx>
#include <BRepLib.hxx>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <string>
#include <vector>

namespace forge {

using native::brep::Solid;
using native::brep::Shell;
using native::brep::Face;
using native::brep::Loop;
using native::brep::Coedge;
using native::brep::Edge;
using native::brep::Vertex;
using native::brep::Surface;
using native::brep::SurfaceKind;

namespace {

// Build a closed, GProp-valid OCCT solid from a set of PLANAR polygon faces (each
// a CCW-from-outside ring of points). Each polygon becomes a planar TopoDS_Face
// (BRepBuilderAPI_MakePolygon → MakeFace with OnlyPlane, which stamps pcurves);
// BRepBuilderAPI_Sewing then stitches the coincident boundary edges into ONE shell
// with consistent face orientation (the same stitch the repo's classa::stitchG2
// leans on). A box therefore reduces to the minimal 6-face / 12-edge B-rep whose
// re-imported BREP integrates to the exact enclosed volume. Returns a null shape on
// failure (caller then falls back to the faceted path).
TopoDS_Shape buildSewnPlanarSolid(const std::vector<std::vector<gp_Pnt>>& faces) {
    if (faces.empty()) return TopoDS_Shape();
    BRepBuilderAPI_Sewing sew(1e-6);
    int added = 0;
    for (const auto& poly : faces) {
        if (poly.size() < 3) continue;
        BRepBuilderAPI_MakePolygon mp;
        for (const auto& p : poly) mp.Add(p);
        mp.Close();
        if (!mp.IsDone()) continue;
        BRepBuilderAPI_MakeFace mf(mp.Wire(), /*OnlyPlane*/ Standard_True);
        if (!mf.IsDone()) continue;
        sew.Add(mf.Face());
        ++added;
    }
    if (added == 0) return TopoDS_Shape();

    sew.Perform();
    TopoDS_Shape sewn = sew.SewedShape();
    if (sewn.IsNull()) return TopoDS_Shape();

    TopoDS_Shell shell;
    if (sewn.ShapeType() == TopAbs_SHELL) {
        shell = TopoDS::Shell(sewn);
    } else {
        TopExp_Explorer ex(sewn, TopAbs_SHELL);
        if (ex.More()) shell = TopoDS::Shell(ex.Current());
    }
    if (shell.IsNull()) return TopoDS_Shape();

    BRep_Builder bb;
    TopoDS_Solid solid;
    bb.MakeSolid(solid);
    bb.Add(solid, shell);

    GProp_GProps vp;
    BRepGProp::VolumeProperties(solid, vp);
    if (vp.Mass() < 0.0) solid.Reverse();
    return solid;
}

// Native polyhedron signed volume (divergence theorem, tri-fan of every loop, in
// the loop's AS-WOUND orientation). For a watertight CCW-from-outside soup this is
// the exact enclosed volume — the ground truth the OCCT rebuild must reproduce.
double polyhedronSignedVolume(const std::vector<gp_Pnt>& pts,
                              const std::vector<std::vector<int>>& faces) {
    double v = 0.0;
    for (const auto& loop : faces) {
        if (loop.size() < 3) continue;
        for (std::size_t i = 1; i + 1 < loop.size(); ++i) {
            const gp_Pnt& A = pts[loop[0]];
            const gp_Pnt& B = pts[loop[i]];
            const gp_Pnt& C = pts[loop[i + 1]];
            v += (A.X() * (B.Y() * C.Z() - B.Z() * C.Y()) -
                  A.Y() * (B.X() * C.Z() - B.Z() * C.X()) +
                  A.Z() * (B.X() * C.Y() - B.Y() * C.X())) / 6.0;
        }
    }
    return v;
}

// Build a closed OCCT solid from a vertex list + a set of SINGLE-LOOP polygonal
// faces (each face = ordered global vertex indices, wound CCW as seen from OUTSIDE
// the solid). Feeds the faceted fallback (native tessellation triangles of a curved
// / mixed / booleaned body).
//
// Edges are SHARED across faces by their UNORDERED index pair, so the resulting
// shell is watertight AND carries the EXACT topological edge count (no proximity
// sewing, no STEP round-trip).
//
// CRITICAL: a planar TopoDS_Face is USELESS to BRepGProp / BOP unless every one of
// its boundary edges carries a PCURVE (a Geom2d curve) on THAT face's surface —
// BRepTools::UVBounds derives the integration domain from the pcurves, and with none
// it returns the plane's infinite natural bounds, so BRepGProp integrates garbage
// that CANCELS across faces. BRepBuilderAPI_MakeFace(pln, wire) does NOT reliably
// re-stamp a pcurve on the SECOND face of a shared edge (the edge already carries the
// first face's pcurve), which is exactly why the faceted bridge produced a solid that
// OCCT re-integrated at -99% (cylinder) / -53% (frustum) — the mold-cone malformation
// (b8251e83). We therefore build each face DIRECTLY (BRep_Builder::MakeFace on a
// Geom_Plane) and EXPLICITLY stamp, per edge, a Geom2d_Line pcurve in that plane's
// (u,v) frame (BRep_Builder::UpdateEdge + Range), then BRepLib::SameParameter, then a
// volume SELF-CHECK against the native signed volume that THROWS rather than emit a
// wrong solid. Returns a null shape only on total failure.
TopoDS_Shape buildOcctSolidFromPolyhedron(
        const std::vector<gp_Pnt>& pts,
        const std::vector<std::vector<int>>& faces) {
    if (pts.empty() || faces.empty()) return TopoDS_Shape();

    const double kTol = 1e-7;
    BRep_Builder bb;

    // One OCCT vertex per input point.
    std::vector<TopoDS_Vertex> verts;
    verts.reserve(pts.size());
    for (const auto& p : pts) verts.push_back(BRepBuilderAPI_MakeVertex(p));

    // Straight edges SHARED by unordered vertex-index pair (min<<32 | max), ALWAYS
    // built in the canonical lo->hi FORWARD sense so the per-face pcurve (also stamped
    // lo->hi) and the 3D curve are co-parameterised. Both faces that meet along an
    // edge reference the same TopoDS_Edge (same TShape) → TopExp counts it once and
    // the shell is watertight.
    std::unordered_map<std::uint64_t, TopoDS_Edge> emap;
    emap.reserve(faces.size() * 2);
    auto edgeKey = [](int a, int b) -> std::uint64_t {
        std::uint32_t lo = static_cast<std::uint32_t>(a < b ? a : b);
        std::uint32_t hi = static_cast<std::uint32_t>(a < b ? b : a);
        return (static_cast<std::uint64_t>(lo) << 32) | static_cast<std::uint64_t>(hi);
    };
    auto edgeFor = [&](int a, int b) -> TopoDS_Edge {
        const int lo = a < b ? a : b;
        const int hi = a < b ? b : a;
        const std::uint64_t k = edgeKey(a, b);
        auto it = emap.find(k);
        if (it != emap.end()) return it->second;
        BRepBuilderAPI_MakeEdge me(verts[lo], verts[hi]);  // FORWARD sense = lo->hi
        TopoDS_Edge e = me.IsDone() ? me.Edge() : TopoDS_Edge();
        emap.emplace(k, e);
        return e;
    };

    TopoDS_Shell shell;
    bb.MakeShell(shell);
    int built = 0;

    for (const auto& loop : faces) {
        if (loop.size() < 3) continue;
        const std::size_t n = loop.size();

        // Newell normal + centroid → the face's supporting plane (outward normal).
        gp_XYZ nrm(0.0, 0.0, 0.0);
        gp_XYZ ctr(0.0, 0.0, 0.0);
        bool badIndex = false;
        for (std::size_t i = 0; i < n; ++i) {
            const int ia = loop[i];
            const int ib = loop[(i + 1) % n];
            if (ia < 0 || ib < 0 || ia >= static_cast<int>(pts.size()) ||
                ib >= static_cast<int>(pts.size())) { badIndex = true; break; }
            const gp_Pnt& p0 = pts[ia];
            const gp_Pnt& p1 = pts[ib];
            nrm += gp_XYZ((p0.Y() - p1.Y()) * (p0.Z() + p1.Z()),
                          (p0.Z() - p1.Z()) * (p0.X() + p1.X()),
                          (p0.X() - p1.X()) * (p0.Y() + p1.Y()));
            ctr += p0.XYZ();
        }
        if (badIndex) continue;
        if (nrm.Modulus() < 1e-14) continue;  // degenerate / collinear loop
        ctr /= static_cast<double>(n);
        const gp_Pnt planeOrigin(ctr);
        const gp_Dir planeNormal(nrm);
        const gp_Pln pln(planeOrigin, planeNormal);

        // The face's plane and its (u,v) frame (Z = outward Newell normal). Every
        // pcurve is stamped in THIS exact frame so it matches the Geom_Plane surface.
        const gp_Ax3 ax = pln.Position();
        const gp_Pnt O = ax.Location();
        const gp_Vec Xd(ax.XDirection());
        const gp_Vec Yd(ax.YDirection());
        Handle(Geom_Plane) gplane = new Geom_Plane(pln);

        // Empty face on the plane, then its bounding wire.
        TopoDS_Face face;
        bb.MakeFace(face, gplane, kTol);
        TopoDS_Wire wire;
        bb.MakeWire(wire);

        bool ok = true;
        for (std::size_t i = 0; i < n; ++i) {
            const int a = loop[i];
            const int b = loop[(i + 1) % n];
            TopoDS_Edge e = edgeFor(a, b);
            if (e.IsNull()) { ok = false; break; }

            // The edge's CANONICAL forward endpoints (lo->hi); its 3D range is the
            // arc length [0, |hi-lo|]. Project both onto this plane's (u,v) frame and
            // build a co-parameterised Geom2d_Line, then stamp it on THIS face.
            const int lo = a < b ? a : b;
            const int hi = a < b ? b : a;
            const gp_Vec dLo(O, pts[lo]);
            const gp_Vec dHi(O, pts[hi]);
            const gp_Pnt2d uvLo(dLo.Dot(Xd), dLo.Dot(Yd));
            const gp_Pnt2d uvHi(dHi.Dot(Xd), dHi.Dot(Yd));
            const gp_Vec2d dir2d(uvLo, uvHi);
            if (dir2d.Magnitude() < 1e-12) { ok = false; break; }
            Handle(Geom2d_Line) pc = new Geom2d_Line(uvLo, gp_Dir2d(dir2d));
            Standard_Real f3 = 0.0, l3 = 0.0;
            BRep_Tool::Range(e, f3, l3);            // 3D arc-length range [0, len]
            bb.UpdateEdge(e, pc, face, kTol);       // pcurve on THIS face's surface
            bb.Range(e, face, f3, l3);              // co-parameterise pcurve with 3D

            e.Orientation(a < b ? TopAbs_FORWARD : TopAbs_REVERSED);
            bb.Add(wire, e);
        }
        if (!ok) continue;

        bb.Add(face, wire);
        bb.Add(shell, face);
        ++built;
    }

    if (built == 0) return TopoDS_Shape();

    TopoDS_Solid solid;
    bb.MakeSolid(solid);
    bb.Add(solid, shell);

    // Recompute the 2D curves to be exactly same-parameter with the 3D curves (our
    // pcurves already are; this is the mandated B-rep hygiene + repairs any residue).
    BRepLib::SameParameter(solid, kTol, Standard_True);

    // Orient positive: with every loop wound CCW-from-outside the Newell normals are
    // outward and the volume is already positive; this is the safety net.
    GProp_GProps vp;
    BRepGProp::VolumeProperties(solid, vp);
    if (vp.Mass() < 0.0) solid.Reverse();

    // VOLUME SELF-CHECK: the OCCT-integrated volume of the rebuilt solid MUST match
    // the native polyhedron's own signed volume (both integrate the SAME inscribed
    // triangle soup, so they agree to rounding). A gross gap means the OCCT faces do
    // not carry valid pcurves / consistent orientation (the -99% mold-cone
    // malformation) — THROW rather than hand a silently-wrong solid downstream.
    const double occtVol = std::fabs(vp.Mass());
    const double nativeVol = std::fabs(polyhedronSignedVolume(pts, faces));
    if (!(nativeVol > 1e-12)) {
        throw std::runtime_error(
            "native->OCCT bridge: faceted polyhedron has ~zero native volume");
    }
    if (std::fabs(occtVol - nativeVol) > 1e-3 * std::max(1.0, nativeVol)) {
        char msg[256];
        std::snprintf(msg, sizeof(msg),
            "native->OCCT bridge: faceted solid mis-integrates "
            "(OCCT %.4f vs native polyhedron %.4f) — malformed B-rep, refusing",
            occtVol, nativeVol);
        throw std::runtime_error(msg);
    }
    return solid;
}

// The faceted fallback: tessellate the native solid and build a watertight OCCT
// faceted solid from the welded triangle soup. Bounded (O(triangles)); it never
// touches OCCT's STEP reader, so the box-minus-cyl round-trip pathology (hang +
// 4.5 GB spike) is gone.
TopoDS_Shape occtFacetedFromNativeSolid(const Solid& solid) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    native::brep::tessellateSolid(solid, pos, idx, /*weldTol*/ 1e-9);
    if (idx.empty()) {
        throw std::runtime_error(
            "native->OCCT bridge: tessellation produced no triangles");
    }
    std::vector<gp_Pnt> pts(pos.size() / 3);
    for (std::size_t i = 0; i < pts.size(); ++i) {
        pts[i] = gp_Pnt(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
    }
    std::vector<std::vector<int>> tris(idx.size() / 3);
    for (std::size_t t = 0; t < tris.size(); ++t) {
        tris[t] = {static_cast<int>(idx[3 * t]),
                   static_cast<int>(idx[3 * t + 1]),
                   static_cast<int>(idx[3 * t + 2])};
    }
    TopoDS_Shape s = buildOcctSolidFromPolyhedron(pts, tris);
    if (s.IsNull()) {
        throw std::runtime_error(
            "native->OCCT bridge: faceted build produced a null shape");
    }
    return s;
}

// ===========================================================================
// ANALYTIC RECONSTRUCTION — native curved analytic solid -> the MINIMAL analytic
// OCCT B-rep that keeps each analytic surface as ONE face (see occtFromNativeSolid).
// ===========================================================================

// Ordered 3-D points of a native loop (origin vertex of each coedge, ring order).
std::vector<gp_Pnt> loopPoints(const Loop* lp) {
    std::vector<gp_Pnt> ring;
    if (!lp || !lp->first) return ring;
    const Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount && c; ++i, c = c->next) {
        const Vertex* v = c->originVertex();
        if (!v) return {};
        ring.emplace_back(v->point.x, v->point.y, v->point.z);
    }
    return ring;
}

// Newell normal + centroid of a ring (false if degenerate / collinear).
bool ringPlane(const std::vector<gp_Pnt>& r, gp_Pnt& ctr, gp_Dir& nrm) {
    const std::size_t n = r.size();
    if (n < 3) return false;
    gp_XYZ nn(0, 0, 0), cc(0, 0, 0);
    for (std::size_t i = 0; i < n; ++i) {
        const gp_Pnt& p0 = r[i];
        const gp_Pnt& p1 = r[(i + 1) % n];
        nn += gp_XYZ((p0.Y() - p1.Y()) * (p0.Z() + p1.Z()),
                     (p0.Z() - p1.Z()) * (p0.X() + p1.X()),
                     (p0.X() - p1.X()) * (p0.Y() + p1.Y()));
        cc += p0.XYZ();
    }
    if (nn.Modulus() < 1e-14) return false;
    cc /= static_cast<double>(n);
    ctr = gp_Pnt(cc);
    nrm = gp_Dir(nn);
    return true;
}

// A tessellated circle? (>= 8 vertices, all equidistant from the ring centroid,
// coplanar) -> its centre / radius / normal. Distinguishes a cap's 128-gon rim (a
// real circle) from a box face's 4 corners (a polygon).
bool ringIsCircle(const std::vector<gp_Pnt>& r, gp_Pnt& center, double& radius, gp_Dir& nrm) {
    if (r.size() < 8) return false;
    gp_Pnt ctr;
    gp_Dir nn;
    if (!ringPlane(r, ctr, nn)) return false;
    double rsum = 0.0;
    for (const auto& p : r) rsum += p.Distance(ctr);
    const double rad = rsum / static_cast<double>(r.size());
    if (rad < 1e-9) return false;
    for (const auto& p : r) {
        if (std::fabs(p.Distance(ctr) - rad) > 1e-6 * std::max(1.0, rad)) return false;
    }
    center = ctr;
    radius = rad;
    nrm = nn;
    return true;
}

// Wire around a ring: an EXACT circle when the ring is a tessellated circle,
// otherwise a straight polygon through the ring vertices. Null on failure. The
// circle's sense follows the ring's own Newell normal, so an inner (hole) loop —
// stored wound opposite the outer loop — yields an opposite-sense hole wire.
TopoDS_Wire wireForRing(const std::vector<gp_Pnt>& r) {
    gp_Pnt c;
    double rad;
    gp_Dir nrm;
    if (ringIsCircle(r, c, rad, nrm)) {
        const gp_Circ circ(gp_Ax2(c, nrm), rad);
        BRepBuilderAPI_MakeEdge me(circ);
        if (!me.IsDone()) return TopoDS_Wire();
        BRepBuilderAPI_MakeWire mw(me.Edge());
        return mw.IsDone() ? mw.Wire() : TopoDS_Wire();
    }
    BRepBuilderAPI_MakePolygon mp;
    for (const auto& p : r) mp.Add(p);
    mp.Close();
    return mp.IsDone() ? mp.Wire() : TopoDS_Wire();
}

// One analytic OCCT planar face for a native planar face (outer loop + hole loops).
TopoDS_Face buildAnalyticPlanarFace(const Face* f) {
    std::vector<gp_Pnt> outer = loopPoints(f->outerLoop);
    if (outer.size() < 3) return TopoDS_Face();
    gp_Pnt ctr;
    gp_Dir nrm;
    if (!ringPlane(outer, ctr, nrm)) return TopoDS_Face();
    const gp_Pln pln(ctr, nrm);
    const TopoDS_Wire ow = wireForRing(outer);
    if (ow.IsNull()) return TopoDS_Face();
    BRepBuilderAPI_MakeFace mf(pln, ow);
    if (!mf.IsDone()) return TopoDS_Face();
    for (const Loop* il : f->innerLoops) {
        const std::vector<gp_Pnt> inner = loopPoints(il);
        if (inner.size() < 3) return TopoDS_Face();
        const TopoDS_Wire iw = wireForRing(inner);
        if (iw.IsNull()) return TopoDS_Face();
        mf.Add(iw);
        if (!mf.IsDone()) return TopoDS_Face();
    }
    return mf.Face();
}

// ONE cylindrical OCCT face from the native strip-faces sharing a single cylinder
// surface. Handles a FULL 2*pi lateral (a complete cylinder / through bore); a
// partial patch returns null (caller then facets the whole body).
TopoDS_Face buildAnalyticCylinderFace(const Surface* s, const std::vector<gp_Pnt>& groupPts) {
    const double rad = s->r1;
    if (rad < 1e-9 || groupPts.empty()) return TopoDS_Face();
    const gp_Pnt O(s->origin.x, s->origin.y, s->origin.z);
    const gp_Dir A(s->axis.x, s->axis.y, s->axis.z);
    const gp_Dir R(s->refDir.x, s->refDir.y, s->refDir.z);
    const gp_Vec Av(A), Rv(R);
    const gp_Vec Bv = Av.Crossed(Rv);
    double zMin = 1e300, zMax = -1e300;
    std::vector<double> ang;
    ang.reserve(groupPts.size());
    for (const auto& p : groupPts) {
        const gp_Vec d(O, p);
        const double t = d.Dot(Av);
        zMin = std::min(zMin, t);
        zMax = std::max(zMax, t);
        double u = std::atan2(d.Dot(Bv), d.Dot(Rv));
        if (u < 0.0) u += 2.0 * M_PI;
        ang.push_back(u);
    }
    if (zMax - zMin < 1e-9) return TopoDS_Face();
    std::sort(ang.begin(), ang.end());
    double maxGap = ang.front() + 2.0 * M_PI - ang.back();
    for (std::size_t i = 1; i < ang.size(); ++i)
        maxGap = std::max(maxGap, ang[i] - ang[i - 1]);
    if (maxGap > M_PI / 4.0) return TopoDS_Face();  // partial patch -> decline
    Handle(Geom_CylindricalSurface) cyl = new Geom_CylindricalSurface(gp_Ax3(O, A, R), rad);
    BRepBuilderAPI_MakeFace mf(cyl, 0.0, 2.0 * M_PI, zMin, zMax, 1e-7);
    if (!mf.IsDone()) return TopoDS_Face();
    return mf.Face();
}

// ONE conical OCCT face from the native strip-faces sharing a single cone surface.
// Mirrors buildAnalyticCylinderFace, but on a Geom_ConicalSurface (base radius r1 at
// the surface origin, top radius r2 at origin + axis*height, half-angle atan2(r2-r1,h)
// — the EXACT construction occtConeSolid uses). Handles a FULL 2*pi lateral (a complete
// cone / frustum recess); a partial angular patch returns null (caller then facets the
// whole body). The v (slant) range is bounded to the group points' actual axial extent
// so a boolean that used only part of the cone height still trims to one exact face
// whose rim radii match the abutting planar caps.
TopoDS_Face buildAnalyticConeFace(const Surface* s, const std::vector<gp_Pnt>& groupPts) {
    const double r1 = s->r1, r2 = s->r2, h = s->param;
    if (!(h > 1e-9) || groupPts.empty()) return TopoDS_Face();
    if (std::fabs(r1 - r2) <= 1e-9 * std::max(1.0, std::fabs(r1))) return TopoDS_Face();  // a cylinder
    const gp_Pnt O(s->origin.x, s->origin.y, s->origin.z);
    const gp_Dir A(s->axis.x, s->axis.y, s->axis.z);
    const gp_Dir R(s->refDir.x, s->refDir.y, s->refDir.z);
    const gp_Vec Av(A), Rv(R);
    const gp_Vec Bv = Av.Crossed(Rv);
    double tMin = 1e300, tMax = -1e300;
    std::vector<double> ang;
    ang.reserve(groupPts.size());
    for (const auto& p : groupPts) {
        const gp_Vec d(O, p);
        const double t = d.Dot(Av);
        tMin = std::min(tMin, t);
        tMax = std::max(tMax, t);
        double u = std::atan2(d.Dot(Bv), d.Dot(Rv));
        if (u < 0.0) u += 2.0 * M_PI;
        ang.push_back(u);
    }
    if (tMax - tMin < 1e-9) return TopoDS_Face();
    std::sort(ang.begin(), ang.end());
    double maxGap = ang.front() + 2.0 * M_PI - ang.back();
    for (std::size_t i = 1; i < ang.size(); ++i)
        maxGap = std::max(maxGap, ang[i] - ang[i - 1]);
    if (maxGap > M_PI / 4.0) return TopoDS_Face();  // partial patch -> decline
    const double semiAng = std::atan2(r2 - r1, h);  // signed: r2<r1 -> negative
    const double cs = std::cos(semiAng);
    if (std::fabs(cs) < 1e-12) return TopoDS_Face();
    Handle(Geom_ConicalSurface) cone = new Geom_ConicalSurface(gp_Ax3(O, A, R), semiAng, r1);
    const double vLo = tMin / cs, vHi = tMax / cs;  // slant param = axial height / cos
    BRepBuilderAPI_MakeFace mf(cone, 0.0, 2.0 * M_PI, std::min(vLo, vHi), std::max(vLo, vHi), 1e-7);
    if (!mf.IsDone()) return TopoDS_Face();
    return mf.Face();
}

// Geometric key for an infinite cylinder (radius + sign-normalised axis direction
// + the axis line's foot-point nearest the world origin). Two faces on the SAME
// cylinder share this key even when a boolean gave each its own Surface COPY, so a
// bore's strip-faces regroup into ONE lateral face (a plain Surface-pointer key
// would strand each boolean strip in its own group and decline).
std::string cylinderKey(const Surface* s) {
    double ax = s->axis.x, ay = s->axis.y, az = s->axis.z;
    const double an = std::sqrt(ax * ax + ay * ay + az * az);
    if (an < 1e-12) return "bad";
    ax /= an; ay /= an; az /= an;
    const double sgn = std::fabs(ax) > 1e-9 ? ax : (std::fabs(ay) > 1e-9 ? ay : az);
    if (sgn < 0.0) { ax = -ax; ay = -ay; az = -az; }
    const double dp = s->origin.x * ax + s->origin.y * ay + s->origin.z * az;
    const double fx = s->origin.x - dp * ax;
    const double fy = s->origin.y - dp * ay;
    const double fz = s->origin.z - dp * az;
    auto q = [](double v) -> long long { return std::llround(v / 1e-6); };
    char buf[256];
    std::snprintf(buf, sizeof(buf), "C:%lld:%lld:%lld:%lld:%lld:%lld:%lld",
                  q(s->r1), q(ax), q(ay), q(az), q(fx), q(fy), q(fz));
    return std::string(buf);
}

// Geometric key for a cone lateral. Unlike an infinite cylinder, a cone has a
// definite apex + orientation, so two strip-faces on the SAME cone share ALL of
// {r1, r2, height, base-centre origin, axis, refDir} — key on the quantised tuple
// so a boolean that gave each strip its own Surface COPY still regroups into ONE
// conical face.
std::string coneKey(const Surface* s) {
    auto q = [](double v) -> long long { return std::llround(v / 1e-6); };
    char buf[384];
    std::snprintf(buf, sizeof(buf),
                  "K:%lld:%lld:%lld:%lld:%lld:%lld:%lld:%lld:%lld:%lld:%lld:%lld",
                  q(s->r1), q(s->r2), q(s->param),
                  q(s->origin.x), q(s->origin.y), q(s->origin.z),
                  q(s->axis.x), q(s->axis.y), q(s->axis.z),
                  q(s->refDir.x), q(s->refDir.y), q(s->refDir.z));
    return std::string(buf);
}

// Rebuild a native analytic Solid as the MINIMAL analytic OCCT B-rep: planar faces
// (incl. drilled / holed caps) 1:1, each cylinder's strip-faces collapsed to one
// Geom_CylindricalSurface face, and each cone/frustum's strip-faces collapsed to one
// Geom_ConicalSurface face. This is what makes a MIXED analytic body — a box with a
// tapered (conical) bore/pocket, a countersunk hole, a multi-cone body — keep ONE
// face per analytic surface instead of shattering into hundreds of plane facets (the
// face-identity that caps face-level edits + the interface/topology benchmark halves).
//
// A PURE single cone/frustum (one cone group, no cylinders, only circular disk caps)
// is DECLINED here so the seam-clean dedicated reconstructor (occtConeFromNativeSolid
// -> occtConeSolid, 3 edges) handles it instead: the sew-based analytic lateral leaves
// a spurious extra seam edge (the same benign artifact the cylinder bridge carries),
// which is acceptable for a mixed body being rescued from a 500-facet shatter but must
// not perturb the canonical primitive topology the A/B gates assert.
//
// Returns a null shape if ANY face/group is not a supported analytic form (sphere /
// torus / nurbs) OR the rebuilt volume does not match the native volume (the caller
// then falls back to the unchanged faceted path — no regression).
TopoDS_Shape occtAnalyticFromNativeSolid(const Solid& solid) {
    std::vector<const Face*> faces;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) if (f) faces.push_back(f);
    }
    if (faces.empty()) return TopoDS_Shape();

    std::vector<const Face*> planar;
    std::unordered_map<std::string, std::vector<const Face*>> cylGroups;
    std::unordered_map<std::string, const Surface*> cylRep;
    std::unordered_map<std::string, std::vector<const Face*>> coneGroups;
    std::unordered_map<std::string, const Surface*> coneRep;
    for (const Face* f : faces) {
        const Surface* s = f->surface;
        if (!s) return TopoDS_Shape();  // bare topology -> decline
        const bool isCyl =
            s->kind == SurfaceKind::Cylinder ||
            (s->kind == SurfaceKind::Cone &&
             std::fabs(s->r1 - s->r2) <= 1e-9 * std::max(1.0, std::fabs(s->r1)));
        const bool isCone =
            s->kind == SurfaceKind::Cone &&
            std::fabs(s->r1 - s->r2) > 1e-9 * std::max(1.0, std::fabs(s->r1));
        if (s->kind == SurfaceKind::Plane) {
            planar.push_back(f);
        } else if (isCyl) {
            const std::string k = cylinderKey(s);
            cylGroups[k].push_back(f);
            cylRep.emplace(k, s);
        } else if (isCone) {
            const std::string k = coneKey(s);
            coneGroups[k].push_back(f);
            coneRep.emplace(k, s);
        } else {
            return TopoDS_Shape();  // sphere / torus / nurbs -> dedicated / faceted path
        }
    }

    // A PURE single cone/frustum (one cone group, no cylinders, only circular disk
    // caps) has a seam-CLEAN dedicated reconstructor (occtConeFromNativeSolid, which
    // runs right after this function returns null). Decline so that canonical path
    // keeps the exact primitive topology (3 edges) the A/B gates assert, rather than
    // the sew-based cone lateral's spurious extra seam edge. MIXED cone bodies (box +
    // cone bore/pocket, multi-cone) have NO dedicated path and are rescued below.
    if (coneGroups.size() == 1 && cylGroups.empty()) {
        bool allDiskCaps = true;
        for (const Face* f : planar) {
            if (!f->innerLoops.empty()) { allDiskCaps = false; break; }
            gp_Pnt cc; double rr; gp_Dir nn;
            if (!ringIsCircle(loopPoints(f->outerLoop), cc, rr, nn)) { allDiskCaps = false; break; }
        }
        if (allDiskCaps) return TopoDS_Shape();
    }

    BRepBuilderAPI_Sewing sew(1e-6);
    int added = 0;
    for (const Face* f : planar) {
        const TopoDS_Face pf = buildAnalyticPlanarFace(f);
        if (pf.IsNull()) return TopoDS_Shape();
        sew.Add(pf);
        ++added;
    }
    for (const auto& kv : cylGroups) {
        std::vector<gp_Pnt> pts;
        for (const Face* f : kv.second) {
            const std::vector<gp_Pnt> r = loopPoints(f->outerLoop);
            pts.insert(pts.end(), r.begin(), r.end());
        }
        const TopoDS_Face cf = buildAnalyticCylinderFace(cylRep[kv.first], pts);
        if (cf.IsNull()) return TopoDS_Shape();
        sew.Add(cf);
        ++added;
    }
    for (const auto& kv : coneGroups) {
        std::vector<gp_Pnt> pts;
        for (const Face* f : kv.second) {
            const std::vector<gp_Pnt> r = loopPoints(f->outerLoop);
            pts.insert(pts.end(), r.begin(), r.end());
        }
        const TopoDS_Face cf = buildAnalyticConeFace(coneRep[kv.first], pts);
        if (cf.IsNull()) return TopoDS_Shape();
        sew.Add(cf);
        ++added;
    }
    if (added == 0) return TopoDS_Shape();

    sew.Perform();
    const TopoDS_Shape sewn = sew.SewedShape();
    if (sewn.IsNull()) return TopoDS_Shape();
    TopoDS_Shell shell;
    if (sewn.ShapeType() == TopAbs_SHELL) {
        shell = TopoDS::Shell(sewn);
    } else {
        TopExp_Explorer ex(sewn, TopAbs_SHELL);
        if (ex.More()) shell = TopoDS::Shell(ex.Current());
    }
    if (shell.IsNull()) return TopoDS_Shape();

    BRep_Builder bb;
    TopoDS_Solid out;
    bb.MakeSolid(out);
    bb.Add(out, shell);
    GProp_GProps vp;
    BRepGProp::VolumeProperties(out, vp);
    if (vp.Mass() < 0.0) out.Reverse();

    // Cross-check the rebuilt volume against the EXACT native volume: any subtle
    // orientation / hole / seam defect surfaces here and we decline to the faceted
    // path rather than emit a wrong solid.
    GProp_GProps vp2;
    BRepGProp::VolumeProperties(out, vp2);
    const double vol = vp2.Mass();
    const double ref = native::brep::massProperties(solid).volume;
    if (!(vol > 1e-12)) return TopoDS_Shape();
    if (std::fabs(vol - ref) > 1e-6 * std::max(1.0, std::fabs(ref))) return TopoDS_Shape();
    return out;
}

// Rebuild a native CONE / FRUSTUM body as an EXACT OCCT cone via the OCCT
// primitive builder (Geom_ConicalSurface + planar caps), instead of the faceted
// polyhedron fallback. The faceted path builds hundreds of plane facets whose
// re-imported B-rep integrates to the WRONG volume (the planar tri-faces carry no
// pcurves, so BRepGProp / BOP mis-read them) — which silently produces a bad solid
// that breaks every downstream boolean (e.g. forge.mold cavity/core split → an
// empty cavity). A native cone carries its full analytic definition on the shared
// lateral Surface (origin = base centre, axis, refDir, r1 = base radius, r2 = top
// radius, param = height), so BRepPrimAPI_MakeCone reproduces it 1:1. Triggers ONLY
// when EVERY face is a Plane cap or the SAME single Cone lateral, and the rebuilt
// volume matches the native volume (else null → unchanged faceted fallback).
TopoDS_Shape occtConeFromNativeSolid(const Solid& solid) {
    const Surface* cone = nullptr;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (!f) continue;
            const Surface* s = f->surface;
            if (!s) return TopoDS_Shape();               // bare topology → decline
            if (s->kind == SurfaceKind::Plane) continue;  // a cap
            if (s->kind != SurfaceKind::Cone) return TopoDS_Shape();  // other curve → decline
            // A true frustum/cone lateral (equal radii would be a cylinder shim).
            if (std::fabs(s->r1 - s->r2) <= 1e-9 * std::max(1.0, std::fabs(s->r1)))
                return TopoDS_Shape();
            if (!cone) { cone = s; continue; }
            // Every cone face must share ONE lateral surface (same r1/r2/height/frame).
            auto dist = [](const native::brep::Vec3& a, const native::brep::Vec3& b) {
                const double dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
                return std::sqrt(dx * dx + dy * dy + dz * dz);
            };
            const bool same =
                std::fabs(cone->r1 - s->r1) <= 1e-9 * std::max(1.0, std::fabs(cone->r1)) &&
                std::fabs(cone->r2 - s->r2) <= 1e-9 * std::max(1.0, std::fabs(cone->r2)) &&
                std::fabs(cone->param - s->param) <= 1e-9 * std::max(1.0, std::fabs(cone->param)) &&
                dist(cone->origin, s->origin) <= 1e-9 * std::max(1.0, cone->param) &&
                dist(cone->axis, s->axis) <= 1e-9 &&
                dist(cone->refDir, s->refDir) <= 1e-9;
            if (!same) return TopoDS_Shape();
        }
    }
    if (!cone) return TopoDS_Shape();  // no cone lateral → not our case
    if (!(cone->param > 1e-12)) return TopoDS_Shape();

    const gp_Pnt O(cone->origin.x, cone->origin.y, cone->origin.z);
    const gp_Dir A(cone->axis.x, cone->axis.y, cone->axis.z);
    const gp_Dir R(cone->refDir.x, cone->refDir.y, cone->refDir.z);
    // gp_Ax2: base circle centre O, +Z = A (base→top), +X = R. The r1 circle sits at
    // O and the r2 circle at O + A*height — the native convention. TKPrim-free: one
    // Geom_ConicalSurface lateral + planar caps (see OcctPrimBuilder), NOT MakeCone.
    TopoDS_Shape out;
    try {
        out = occtConeSolid(gp_Ax2(O, A, R), cone->r1, cone->r2, cone->param);
    } catch (const std::exception&) {
        return TopoDS_Shape();
    }
    if (out.IsNull()) return TopoDS_Shape();

    GProp_GProps vp;
    BRepGProp::VolumeProperties(out, vp);
    const double vol = vp.Mass();
    const double ref = native::brep::massProperties(solid).volume;
    if (!(vol > 1e-12)) return TopoDS_Shape();
    if (std::fabs(vol - ref) > 1e-6 * std::max(1.0, std::fabs(ref))) return TopoDS_Shape();
    return out;
}

// Rebuild a native SPHERE body as an EXACT OCCT sphere via the OCCT primitive
// builder (one Geom_SphericalSurface face), instead of the faceted polyhedron
// fallback. The faceted path shatters the sphere into ~N*M plane facets whose
// re-imported B-rep mis-integrates in OCCT booleans / mass (the identical bug the
// cone path fixes: a bridged cone read 24627 vs a true 19603 mm3 and broke the
// mold split). A native sphere carries its full analytic definition on the ONE
// shared spherical Surface (origin = centre, r1 = radius) that every strip face
// points at, so BRepPrimAPI_MakeSphere reproduces it 1:1. Triggers ONLY when EVERY
// face shares that SAME single sphere (centre + radius), and the rebuilt volume
// matches the native volume (else null -> unchanged faceted fallback; zero
// regression for any non-sphere or partial-sphere body).
TopoDS_Shape occtSphereFromNativeSolid(const Solid& solid) {
    auto dist = [](const native::brep::Vec3& a, const native::brep::Vec3& b) {
        const double dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        return std::sqrt(dx * dx + dy * dy + dz * dz);
    };
    const Surface* sph = nullptr;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (!f) continue;
            const Surface* s = f->surface;
            if (!s) return TopoDS_Shape();                              // bare topology -> decline
            if (s->kind != SurfaceKind::Sphere) return TopoDS_Shape();  // any other face -> decline
            if (!(s->r1 > 1e-12)) return TopoDS_Shape();
            if (!sph) { sph = s; continue; }
            // Every sphere face must share ONE surface (same centre + radius).
            const bool same =
                std::fabs(sph->r1 - s->r1) <= 1e-9 * std::max(1.0, std::fabs(sph->r1)) &&
                dist(sph->origin, s->origin) <= 1e-9 * std::max(1.0, sph->r1);
            if (!same) return TopoDS_Shape();
        }
    }
    if (!sph) return TopoDS_Shape();  // no sphere face -> not our case

    const gp_Pnt C(sph->origin.x, sph->origin.y, sph->origin.z);
    // TKPrim-free: ONE Geom_SphericalSurface periodic face (see OcctPrimBuilder),
    // NOT BRepPrimAPI_MakeSphere. The native sphere carries no meaningful frame, so
    // the canonical +Z/+X axis is used (a whole sphere is frame-invariant).
    TopoDS_Shape out;
    try {
        out = occtSphereSolid(gp_Ax2(C, gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)), sph->r1);
    } catch (const std::exception&) {
        return TopoDS_Shape();
    }
    if (out.IsNull()) return TopoDS_Shape();

    GProp_GProps vp;
    BRepGProp::VolumeProperties(out, vp);
    const double vol = vp.Mass();
    const double ref = native::brep::massProperties(solid).volume;
    if (!(vol > 1e-12)) return TopoDS_Shape();
    if (std::fabs(vol - ref) > 1e-6 * std::max(1.0, std::fabs(ref))) return TopoDS_Shape();
    return out;
}

// Rebuild a native TORUS body as an EXACT OCCT torus via the OCCT primitive builder
// (one Geom_ToroidalSurface face), instead of the faceted polyhedron fallback (same
// mis-integration bug as sphere/cone — a faceted torus void even collapses the
// enclosing boolean). A native torus carries its full analytic definition on the
// ONE shared toroidal Surface (origin = centre, axis, refDir, r1 = major R,
// r2 = minor r) that every strip face points at, so BRepPrimAPI_MakeTorus
// reproduces it 1:1. Triggers ONLY when EVERY face shares that SAME single torus
// (centre + frame + both radii), and the rebuilt volume matches the native volume
// (else null -> unchanged faceted fallback; zero regression).
TopoDS_Shape occtTorusFromNativeSolid(const Solid& solid) {
    auto dist = [](const native::brep::Vec3& a, const native::brep::Vec3& b) {
        const double dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        return std::sqrt(dx * dx + dy * dy + dz * dz);
    };
    const Surface* tor = nullptr;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (!f) continue;
            const Surface* s = f->surface;
            if (!s) return TopoDS_Shape();                             // bare topology -> decline
            if (s->kind != SurfaceKind::Torus) return TopoDS_Shape();  // any other face -> decline
            // A valid ring torus: 0 < minor < major.
            if (!(s->r1 > 1e-12) || !(s->r2 > 1e-12) || !(s->r2 < s->r1)) return TopoDS_Shape();
            if (!tor) { tor = s; continue; }
            // Every torus face must share ONE surface (same radii + frame + centre).
            const bool same =
                std::fabs(tor->r1 - s->r1) <= 1e-9 * std::max(1.0, std::fabs(tor->r1)) &&
                std::fabs(tor->r2 - s->r2) <= 1e-9 * std::max(1.0, std::fabs(tor->r2)) &&
                dist(tor->origin, s->origin) <= 1e-9 * std::max(1.0, tor->r1) &&
                dist(tor->axis, s->axis) <= 1e-9 &&
                dist(tor->refDir, s->refDir) <= 1e-9;
            if (!same) return TopoDS_Shape();
        }
    }
    if (!tor) return TopoDS_Shape();  // no torus face -> not our case

    const gp_Pnt O(tor->origin.x, tor->origin.y, tor->origin.z);
    const gp_Dir A(tor->axis.x, tor->axis.y, tor->axis.z);
    const gp_Dir R(tor->refDir.x, tor->refDir.y, tor->refDir.z);
    // gp_Ax2: torus centre O, +Z = symmetry axis A, +X = R. R1 = major radius
    // (centre -> tube centre), R2 = minor (tube) radius. TKPrim-free: ONE
    // Geom_ToroidalSurface doubly-periodic face (see OcctPrimBuilder), NOT MakeTorus.
    TopoDS_Shape out;
    try {
        out = occtTorusSolid(gp_Ax2(O, A, R), tor->r1, tor->r2);
    } catch (const std::exception&) {
        return TopoDS_Shape();
    }
    if (out.IsNull()) return TopoDS_Shape();

    GProp_GProps vp;
    BRepGProp::VolumeProperties(out, vp);
    const double vol = vp.Mass();
    const double ref = native::brep::massProperties(solid).volume;
    if (!(vol > 1e-12)) return TopoDS_Shape();
    if (std::fabs(vol - ref) > 1e-6 * std::max(1.0, std::fabs(ref))) return TopoDS_Shape();
    return out;
}

// ===========================================================================
// MERGED-STRIP ANALYTIC RECONSTRUCTION — a BOOLEAN-RESULT native solid.
//
// A native boolean result (box - corner cylinder = a "corner notch") does NOT
// arrive as clean logical faces: it is a soup of CDT STRIP faces — the corner
// notch is 106 strips (its 6 logical PLANES shattered into ~74 triangles + its
// ONE quarter-cylinder wall split into 32 angular strips). occtAnalyticFromNativeSolid
// declines it (the notch's cylinder is a PARTIAL 90-degree arc, not a full 2*pi
// lateral, so buildAnalyticCylinderFace bails), so it used to fall to the FACETED
// path and export 140 {plane:140} faces — the analytic identity of the wall (and
// therefore every face-level edit + the interface/topology benchmark halves) is lost.
//
// This reconstructs ONE OCCT face per LOGICAL analytic face — the SAME
// signature + shared-edge grouping forge.nativeFaceInventory reports (7 for the
// notch: {plane:6, cylinder:1}) — so the exported B-rep carries the exact clean
// faces with the exact volume:
//   * strips are grouped into components by surface SIGNATURE + shared-edge
//     connectivity (analyticFaceInventory's grouping);
//   * each CYLINDER/CONE component becomes ONE analytic (u,v) patch face over its
//     ACTUAL angular sector [theta0,theta1] x axial extent — a partial wall, not a
//     full lateral;
//   * each PLANAR component's boundary loop is RECOVERED from its strips (the edges
//     used by exactly one strip of the component), and each maximal run of chords
//     that traces a bordering cylinder/cone rim is COLLAPSED back into ONE true
//     circular ARC (identical to that wall's rim arc, so the two sew);
//   * the faces are sewn, solidified, and the rebuilt volume is cross-checked
//     against the EXACT native volume — any mismatch declines to the (unchanged)
//     faceted path (ZERO regression). It runs ONLY after every dedicated
//     reconstructor (analytic/cone/sphere/torus) has already declined.
//
// (These helpers live in the SAME anonymous namespace as the reconstructors above.)
// ===========================================================================

// A boolean-result MERGE diagnostic (FORGE_BRIDGE_MERGE_DIAG=1 -> stderr the reason
// a reconstruction declined). OFF by default -> zero effect on the production path.
inline bool mergeDiagOn() {
    const char* e = std::getenv("FORGE_BRIDGE_MERGE_DIAG");
    return e && e[0] == '1';
}
#define MERGE_BAIL(msg) do { if (mergeDiagOn()) std::fprintf(stderr, "[bridge-merge] decline: %s\n", (msg)); return TopoDS_Shape(); } while (0)

// The shared analytic surface of a CYLINDER / CONE component plus its axis frame —
// used to build the ONE lateral patch face AND to recognise the arc runs a bordering
// planar cap traces along this component's rim.
struct CurvedComp {
    const Surface* surf = nullptr;
    gp_Pnt O;       // axis base point (surface origin)
    gp_Dir A;       // unit axis
    gp_Dir R;       // unit refDir
    bool   isCone = false;
};

// Distance of P from the component's axis line, and its signed height along the axis.
void axisMetrics(const CurvedComp& c, const gp_Pnt& P, double& dist, double& height) {
    const gp_Vec d(c.O, P);
    const gp_Vec Av(c.A);
    height = d.Dot(Av);
    const gp_Vec radial = d - Av * height;
    dist = radial.Magnitude();
}

// The component's analytic radius at axial height t (cone tapers; cylinder is constant).
double compRadiusAt(const CurvedComp& c, double t) {
    if (!c.isCone) return c.surf->r1;
    const double h = c.surf->param;
    if (!(std::fabs(h) > 1e-12)) return c.surf->r1;
    return c.surf->r1 + (c.surf->r2 - c.surf->r1) * (t / h);
}

// Is P on this component's lateral surface (within scale-relative tol)? Returns its
// axial height in `height`.
bool onCurvedRim(const CurvedComp& c, const gp_Pnt& P, double& height) {
    double dist = 0.0;
    axisMetrics(c, P, dist, height);
    const double want = compRadiusAt(c, height);
    return std::fabs(dist - want) <= 1e-6 * std::max(1.0, std::fabs(want));
}

// A circular ARC edge from S to E through interior point M (all on a circle of radius
// `rad` centred at O). Chooses the circle sense so the S->E arc actually contains M
// (the ring-order midpoint), so a >pi notch sector is honoured rather than the
// complementary minor arc. Null on degeneracy.
TopoDS_Edge makeArcEdge(const gp_Pnt& O, double rad,
                        const gp_Pnt& S, const gp_Pnt& E, const gp_Pnt& M) {
    const gp_Vec os(O, S), om(O, M), oe(O, E);
    if (os.Magnitude() < 1e-12 || om.Magnitude() < 1e-12 || oe.Magnitude() < 1e-12)
        return TopoDS_Edge();
    gp_Vec nrm = os.Crossed(om);
    if (nrm.Magnitude() < 1e-12) return TopoDS_Edge();  // S,O,M collinear
    gp_Ax2 ax(O, gp_Dir(nrm), gp_Dir(os));
    const gp_Vec xd(ax.XDirection()), yd(ax.YDirection());
    auto ang = [&](const gp_Vec& v) {
        double a = std::atan2(v.Dot(yd), v.Dot(xd));
        if (a < 0.0) a += 2.0 * M_PI;
        return a;
    };
    // With +X toward S, S is at angle 0 and M is CCW-positive (nrm = os x om). If E is
    // NOT further CCW than M, flip the sense so the S->E CCW arc sweeps through M.
    if (!(ang(oe) > ang(om))) {
        nrm.Reverse();
        ax = gp_Ax2(O, gp_Dir(nrm), gp_Dir(os));
    }
    const gp_Circ circ(ax, rad);
    BRepBuilderAPI_MakeEdge me(circ, S, E);
    return me.IsDone() ? me.Edge() : TopoDS_Edge();
}

// ONE analytic OCCT patch face for a CYLINDER / CONE component, bounded to the strips'
// ACTUAL angular sector [u0,u1] and axial extent (a PARTIAL wall — the notch quarter
// cylinder — not a full 2*pi lateral). Its rim arcs are true circles that coincide with
// the bordering caps' collapsed arcs, so they sew.
TopoDS_Face buildCurvedPatchFace(const CurvedComp& c, const std::vector<gp_Pnt>& pts) {
    if (pts.empty()) return TopoDS_Face();
    const gp_Vec Av(c.A), Rv(c.R);
    const gp_Vec Bv = Av.Crossed(Rv);
    double tMin = 1e300, tMax = -1e300;
    std::vector<double> ang;
    ang.reserve(pts.size());
    for (const auto& p : pts) {
        const gp_Vec d(c.O, p);
        const double t = d.Dot(Av);
        tMin = std::min(tMin, t);
        tMax = std::max(tMax, t);
        double u = std::atan2(d.Dot(Bv), d.Dot(Rv));
        if (u < 0.0) u += 2.0 * M_PI;
        ang.push_back(u);
    }
    if (tMax - tMin < 1e-9) return TopoDS_Face();
    std::sort(ang.begin(), ang.end());
    // Occupied angular span = COMPLEMENT of the largest gap between successive angles
    // (the wrap gap is between the last and first+2pi).
    double maxGap = ang.front() + 2.0 * M_PI - ang.back();  // wrap gap
    std::size_t gapIdx = ang.size();                        // sentinel: wrap gap wins
    for (std::size_t i = 1; i < ang.size(); ++i) {
        const double g = ang[i] - ang[i - 1];
        if (g > maxGap) { maxGap = g; gapIdx = i; }
    }
    double u0, u1;
    if (maxGap < M_PI / 6.0) {           // no real gap -> a full 2*pi lateral
        u0 = 0.0; u1 = 2.0 * M_PI;
    } else if (gapIdx == ang.size()) {   // wrap gap is largest -> occupied is [front,back]
        u0 = ang.front(); u1 = ang.back();
    } else {                             // internal gap -> occupied wraps around it
        u0 = ang[gapIdx]; u1 = ang[gapIdx - 1] + 2.0 * M_PI;
    }
    if (u1 - u0 < 1e-9) return TopoDS_Face();
    if (!c.isCone) {
        Handle(Geom_CylindricalSurface) cyl =
            new Geom_CylindricalSurface(gp_Ax3(c.O, c.A, c.R), c.surf->r1);
        BRepBuilderAPI_MakeFace mf(cyl, u0, u1, tMin, tMax, 1e-7);
        return mf.IsDone() ? mf.Face() : TopoDS_Face();
    }
    const double r1 = c.surf->r1, r2 = c.surf->r2, h = c.surf->param;
    if (!(h > 1e-9)) return TopoDS_Face();
    const double semiAng = std::atan2(r2 - r1, h);
    const double cs = std::cos(semiAng);
    if (std::fabs(cs) < 1e-12) return TopoDS_Face();
    Handle(Geom_ConicalSurface) cone =
        new Geom_ConicalSurface(gp_Ax3(c.O, c.A, c.R), semiAng, r1);
    const double vLo = tMin / cs, vHi = tMax / cs;
    BRepBuilderAPI_MakeFace mf(cone, u0, u1, std::min(vLo, vHi), std::max(vLo, vHi), 1e-7);
    return mf.IsDone() ? mf.Face() : TopoDS_Face();
}

// Recover the boundary loop(s) of one component from its BOUNDARY edges (an edge used
// by exactly one strip OF the component). Each boundary vertex of a clean manifold
// component has degree 2, so the edges chain into closed rings. Returns the ordered
// 3D point rings; empty on any open / non-manifold boundary (caller then declines).
std::vector<std::vector<gp_Pnt>> recoverBoundaryLoops(const std::vector<const Edge*>& be) {
    std::unordered_map<const Vertex*, std::vector<std::pair<const Vertex*, const Edge*>>> adj;
    adj.reserve(be.size() * 2);
    for (const Edge* e : be) {
        if (!e->start || !e->end) return {};
        adj[e->start].push_back({e->end, e});
        adj[e->end].push_back({e->start, e});
    }
    for (const auto& kv : adj) if (kv.second.size() != 2) return {};  // non-manifold boundary

    std::unordered_set<const Edge*> used;
    used.reserve(be.size() * 2);
    std::vector<std::vector<gp_Pnt>> loops;
    for (const Edge* e0 : be) {
        if (used.count(e0)) continue;
        const Vertex* start = e0->start;
        const Vertex* cur = e0->end;
        used.insert(e0);
        const Edge* prev = e0;
        std::vector<const Vertex*> ring;
        ring.push_back(start);
        ring.push_back(cur);
        bool ok = true;
        while (cur != start) {
            const auto it = adj.find(cur);
            if (it == adj.end()) { ok = false; break; }
            const Edge* nxt = nullptr;
            const Vertex* nv = nullptr;
            for (const auto& pr : it->second) {
                if (pr.second != prev && !used.count(pr.second)) { nxt = pr.second; nv = pr.first; break; }
            }
            if (!nxt) { ok = false; break; }
            used.insert(nxt);
            prev = nxt;
            cur = nv;
            if (cur != start) ring.push_back(cur);
        }
        if (!ok || ring.size() < 3) return {};
        std::vector<gp_Pnt> pl;
        pl.reserve(ring.size());
        for (const Vertex* v : ring) pl.emplace_back(v->point.x, v->point.y, v->point.z);
        loops.push_back(std::move(pl));
    }
    return loops;
}

// Signed-area magnitude of a planar ring (Newell), used to pick a face's OUTER loop.
double ringArea(const std::vector<gp_Pnt>& r) {
    gp_XYZ nn(0, 0, 0);
    const std::size_t m = r.size();
    for (std::size_t i = 0; i < m; ++i) {
        const gp_Pnt& p0 = r[i];
        const gp_Pnt& p1 = r[(i + 1) % m];
        nn += gp_XYZ((p0.Y() - p1.Y()) * (p0.Z() + p1.Z()),
                     (p0.Z() - p1.Z()) * (p0.X() + p1.X()),
                     (p0.X() - p1.X()) * (p0.Y() + p1.Y()));
    }
    return 0.5 * nn.Modulus();
}

// Collapse a recovered boundary ring into a wire of MAXIMAL analytic edges: collinear
// chord runs -> ONE straight edge; a run of chords tracing a bordering cylinder/cone
// rim (both endpoints on the wall, at equal axial height => a planar circle) -> ONE
// true circular ARC. A ring that is itself a full tessellated circle (a hole) is a full
// gp_Circ. Null on any run it cannot certify (caller then declines).
TopoDS_Wire collapseLoopToWire(const std::vector<gp_Pnt>& ring,
                               const std::vector<CurvedComp>& curved) {
    const std::size_t m = ring.size();
    if (m < 3) return TopoDS_Wire();

    // Whole-ring circle (e.g. a through-bore hole): reuse the exact-circle path.
    {
        gp_Pnt cc; double rr; gp_Dir nn;
        if (ringIsCircle(ring, cc, rr, nn)) {
            const gp_Circ circ(gp_Ax2(cc, nn), rr);
            BRepBuilderAPI_MakeEdge me(circ);
            if (!me.IsDone()) return TopoDS_Wire();
            BRepBuilderAPI_MakeWire mw(me.Edge());
            return mw.IsDone() ? mw.Wire() : TopoDS_Wire();
        }
    }

    // Classify each ring edge i = (ring[i], ring[i+1]) as an arc of curved comp k, or
    // straight (-1). An edge is an arc of k iff BOTH endpoints lie on comp k's wall AND
    // are at equal axial height (=> the intersection is a planar circle, not an ellipse
    // and not an axial generator line).
    std::vector<int> cls(m, -1);
    for (std::size_t i = 0; i < m; ++i) {
        const gp_Pnt& a = ring[i];
        const gp_Pnt& b = ring[(i + 1) % m];
        for (std::size_t k = 0; k < curved.size(); ++k) {
            double ha = 0.0, hb = 0.0;
            if (onCurvedRim(curved[k], a, ha) && onCurvedRim(curved[k], b, hb) &&
                std::fabs(ha - hb) <= 1e-6 * std::max(1.0, std::fabs(ha))) {
                cls[i] = static_cast<int>(k);
                break;
            }
        }
    }

    // Corner = a ring vertex j where the incoming edge (j-1) and outgoing edge (j)
    // cannot be part of the same analytic edge: their classification differs, or both
    // are straight but the direction turns.
    std::vector<std::size_t> corners;
    for (std::size_t j = 0; j < m; ++j) {
        const std::size_t jp = (j + m - 1) % m;
        bool isCorner = false;
        if (cls[jp] != cls[j]) {
            isCorner = true;
        } else if (cls[j] == -1) {
            const gp_Vec u(ring[jp], ring[j]);
            const gp_Vec v(ring[j], ring[(j + 1) % m]);
            if (u.Magnitude() < 1e-12 || v.Magnitude() < 1e-12) isCorner = true;
            else if (u.Crossed(v).Magnitude() > 1e-9 * u.Magnitude() * v.Magnitude()) isCorner = true;
        }
        if (isCorner) corners.push_back(j);
    }
    if (corners.empty()) return TopoDS_Wire();  // not a full circle, yet no corners

    BRepBuilderAPI_MakeWire mw;
    const std::size_t C = corners.size();
    for (std::size_t ci = 0; ci < C; ++ci) {
        const std::size_t s = corners[ci];
        const std::size_t e = corners[(ci + 1) % C];
        const int segCls = cls[s];
        const gp_Pnt& S = ring[s];
        const gp_Pnt& E = ring[e];
        if (segCls < 0) {
            BRepBuilderAPI_MakeEdge me(S, E);
            if (!me.IsDone()) return TopoDS_Wire();
            mw.Add(me.Edge());
            continue;
        }
        // Arc segment: need a strictly-interior ring vertex, all at one axial height on
        // comp segCls => a planar circle whose centre is that wall's axis foot.
        std::size_t steps = 0, t = s;
        while (t != e) { t = (t + 1) % m; ++steps; }
        if (steps < 2) return TopoDS_Wire();  // single chord -> ambiguous arc
        const std::size_t mid = (s + steps / 2) % m;
        const CurvedComp& cc = curved[static_cast<std::size_t>(segCls)];
        double hS = 0.0;
        onCurvedRim(cc, S, hS);
        const gp_Pnt center = cc.O.Translated(gp_Vec(cc.A) * hS);
        const double radius = S.Distance(center);
        if (radius < 1e-9) return TopoDS_Wire();
        if (std::fabs(E.Distance(center) - radius) > 1e-6 * std::max(1.0, radius)) return TopoDS_Wire();
        const TopoDS_Edge ae = makeArcEdge(center, radius, S, E, ring[mid]);
        if (ae.IsNull()) return TopoDS_Wire();
        mw.Add(ae);
    }
    return mw.IsDone() ? mw.Wire() : TopoDS_Wire();
}

// ONE analytic planar OCCT face for a merged planar component: its outer wire is the
// largest recovered loop; any remaining loops are holes.
TopoDS_Face buildMergedPlanarFace(const Surface* ps,
                                  const std::vector<std::vector<gp_Pnt>>& loops,
                                  const std::vector<CurvedComp>& curved) {
    if (loops.empty()) return TopoDS_Face();
    const gp_Pnt O(ps->origin.x, ps->origin.y, ps->origin.z);
    const gp_Dir N(ps->axis.x, ps->axis.y, ps->axis.z);
    const gp_Pln pln(O, N);

    std::size_t outer = 0;
    double best = -1.0;
    for (std::size_t i = 0; i < loops.size(); ++i) {
        const double a = ringArea(loops[i]);
        if (a > best) { best = a; outer = i; }
    }
    const TopoDS_Wire ow = collapseLoopToWire(loops[outer], curved);
    if (ow.IsNull()) return TopoDS_Face();
    BRepBuilderAPI_MakeFace mf(pln, ow);
    if (!mf.IsDone()) return TopoDS_Face();
    for (std::size_t i = 0; i < loops.size(); ++i) {
        if (i == outer) continue;
        const TopoDS_Wire iw = collapseLoopToWire(loops[i], curved);
        if (iw.IsNull()) return TopoDS_Face();
        mf.Add(iw);
        if (!mf.IsDone()) return TopoDS_Face();
    }
    return mf.Face();
}

// The MERGED-strip analytic reconstructor (see the block comment above).
TopoDS_Shape occtMergedAnalyticFromNativeSolid(const Solid& solid) {
    std::vector<const Face*> faces;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) if (f) faces.push_back(f);
    }
    const std::size_t n = faces.size();
    if (n < 4) MERGE_BAIL("fewer than 4 faces");

    std::unordered_map<const Face*, std::size_t> idx;
    idx.reserve(n * 2);
    for (std::size_t i = 0; i < n; ++i) idx.emplace(faces[i], i);

    // Per-face analytic signature (plane: signed normal+offset; cyl/cone: geometric
    // key). Decline on ANY non-plane/cyl/cone surface (sphere/torus/nurbs boolean
    // results keep the existing dedicated / faceted paths).
    auto q = [](double v) -> long long { return std::llround(v / 1e-6); };
    std::vector<std::string> sig(n);
    for (std::size_t i = 0; i < n; ++i) {
        const Surface* s = faces[i]->surface;
        if (!s) MERGE_BAIL("bare-topology face");
        SurfaceKind kind = s->kind;
        if (kind == SurfaceKind::Cone &&
            std::fabs(s->r1 - s->r2) <= 1e-9 * std::max(1.0, std::fabs(s->r1)))
            kind = SurfaceKind::Cylinder;
        if (kind == SurfaceKind::Plane) {
            double ax = s->axis.x, ay = s->axis.y, az = s->axis.z;
            const double nn = std::sqrt(ax * ax + ay * ay + az * az);
            if (nn < 1e-12) MERGE_BAIL("degenerate plane normal");
            ax /= nn; ay /= nn; az /= nn;
            const double d = s->origin.x * ax + s->origin.y * ay + s->origin.z * az;
            char buf[128];
            std::snprintf(buf, sizeof(buf), "P:%lld:%lld:%lld:%lld",
                          q(ax), q(ay), q(az), q(d));
            sig[i] = buf;
        } else if (kind == SurfaceKind::Cylinder) {
            sig[i] = cylinderKey(s);
        } else if (kind == SurfaceKind::Cone) {
            sig[i] = coneKey(s);
        } else {
            MERGE_BAIL("non-analytic (sphere/torus/nurbs) face");
        }
    }

    // Union-find: merge two faces IFF they share an edge AND carry the same signature
    // (== analyticFaceInventory grouping). First gather unique edges.
    std::unordered_set<const Edge*> seen;
    seen.reserve(n * 4);
    std::vector<const Edge*> edges;
    auto visit = [&](const Loop* lp) {
        if (!lp || !lp->first) return;
        const Coedge* c = lp->first;
        for (std::size_t i = 0; i < lp->coedgeCount && c; ++i, c = c->next) {
            const Edge* e = c->edge;
            if (e && seen.insert(e).second) edges.push_back(e);
        }
    };
    for (const Face* f : faces) {
        visit(f->outerLoop);
        for (const Loop* il : f->innerLoops) visit(il);
    }

    std::vector<std::size_t> parent(n);
    for (std::size_t i = 0; i < n; ++i) parent[i] = i;
    auto find = [&](std::size_t x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    };
    auto unite = [&](std::size_t a, std::size_t b) {
        const std::size_t ra = find(a), rb = find(b);
        if (ra != rb) parent[std::max(ra, rb)] = std::min(ra, rb);
    };
    auto faceOf = [](const Coedge* ce) -> const Face* {
        return (ce && ce->loop) ? ce->loop->face : nullptr;
    };
    for (const Edge* e : edges) {
        const Face* fa = faceOf(e->coedgeA);
        const Face* fb = faceOf(e->coedgeB);
        if (!fa || !fb) MERGE_BAIL("edge with fewer than 2 incident faces (open shell)");
        if (fa == fb) continue;
        const auto ia = idx.find(fa), ib = idx.find(fb);
        if (ia == idx.end() || ib == idx.end()) continue;
        if (sig[ia->second] == sig[ib->second]) unite(ia->second, ib->second);
    }

    std::unordered_map<std::size_t, std::vector<std::size_t>> comp;
    for (std::size_t i = 0; i < n; ++i) comp[find(i)].push_back(i);
    if (comp.size() >= n) MERGE_BAIL("no strips merged (already-clean solid)");

    // Curved components (cyl/cone) + their axis frames; planar component roots.
    std::unordered_map<std::size_t, CurvedComp> curvedByRoot;
    std::vector<std::size_t> planarRoots;
    for (const auto& kv : comp) {
        const Surface* s = faces[kv.second.front()]->surface;
        SurfaceKind kind = s->kind;
        if (kind == SurfaceKind::Cone &&
            std::fabs(s->r1 - s->r2) <= 1e-9 * std::max(1.0, std::fabs(s->r1)))
            kind = SurfaceKind::Cylinder;
        if (kind == SurfaceKind::Plane) {
            planarRoots.push_back(kv.first);
        } else {
            CurvedComp cc;
            cc.surf = s;
            cc.O = gp_Pnt(s->origin.x, s->origin.y, s->origin.z);
            cc.A = gp_Dir(s->axis.x, s->axis.y, s->axis.z);
            cc.R = gp_Dir(s->refDir.x, s->refDir.y, s->refDir.z);
            cc.isCone = (kind == SurfaceKind::Cone);
            curvedByRoot.emplace(kv.first, cc);
        }
    }
    if (curvedByRoot.empty()) MERGE_BAIL("no curved component to rescue (all-planar)");

    // Boundary edges per component root (an edge whose two faces are in DIFFERENT
    // components is a boundary edge of BOTH).
    std::unordered_map<std::size_t, std::vector<const Edge*>> bEdges;
    for (const Edge* e : edges) {
        const Face* fa = faceOf(e->coedgeA);
        const Face* fb = faceOf(e->coedgeB);
        if (!fa || !fb) MERGE_BAIL("open edge in boundary pass");
        const std::size_t ra = find(idx[fa]), rb = find(idx[fb]);
        if (ra == rb) continue;
        bEdges[ra].push_back(e);
        bEdges[rb].push_back(e);
    }

    std::vector<CurvedComp> curvedList;
    curvedList.reserve(curvedByRoot.size());
    for (const auto& kv : curvedByRoot) curvedList.push_back(kv.second);

    BRepBuilderAPI_Sewing sew(1e-6);
    int added = 0;

    // ONE lateral patch face per curved component.
    for (const auto& kv : curvedByRoot) {
        std::vector<gp_Pnt> pts;
        for (const std::size_t fi : comp[kv.first]) {
            const std::vector<gp_Pnt> r = loopPoints(faces[fi]->outerLoop);
            pts.insert(pts.end(), r.begin(), r.end());
        }
        const TopoDS_Face cf = buildCurvedPatchFace(kv.second, pts);
        if (cf.IsNull()) MERGE_BAIL("curved patch face build failed");
        sew.Add(cf);
        ++added;
    }

    // ONE planar face per planar component (boundary recovered + arcs collapsed).
    for (const std::size_t root : planarRoots) {
        const auto it = bEdges.find(root);
        if (it == bEdges.end()) MERGE_BAIL("planar component has no boundary edges");
        const std::vector<std::vector<gp_Pnt>> loops = recoverBoundaryLoops(it->second);
        if (loops.empty()) MERGE_BAIL("planar boundary loop recovery failed");
        const Surface* ps = faces[comp[root].front()]->surface;
        const TopoDS_Face pf = buildMergedPlanarFace(ps, loops, curvedList);
        if (pf.IsNull()) MERGE_BAIL("merged planar face build failed");
        sew.Add(pf);
        ++added;
    }
    if (added == 0) MERGE_BAIL("no faces added");

    sew.Perform();
    const TopoDS_Shape sewn = sew.SewedShape();
    if (sewn.IsNull()) MERGE_BAIL("sew produced a null shape");
    TopoDS_Shell shell;
    if (sewn.ShapeType() == TopAbs_SHELL) {
        shell = TopoDS::Shell(sewn);
    } else {
        TopExp_Explorer ex(sewn, TopAbs_SHELL);
        if (ex.More()) shell = TopoDS::Shell(ex.Current());
    }
    if (shell.IsNull()) MERGE_BAIL("no shell after sew (faces did not stitch watertight)");

    BRep_Builder bb;
    TopoDS_Solid out;
    bb.MakeSolid(out);
    bb.Add(out, shell);
    GProp_GProps vp;
    BRepGProp::VolumeProperties(out, vp);
    if (vp.Mass() < 0.0) out.Reverse();

    GProp_GProps vp2;
    BRepGProp::VolumeProperties(out, vp2);
    const double vol = vp2.Mass();
    const double ref = native::brep::massProperties(solid).volume;
    if (!(vol > 1e-12)) MERGE_BAIL("rebuilt volume non-positive");
    if (std::fabs(vol - ref) > 1e-6 * std::max(1.0, std::fabs(ref))) {
        if (mergeDiagOn())
            std::fprintf(stderr, "[bridge-merge] decline: volume %.6f != native %.6f\n", vol, ref);
        return TopoDS_Shape();
    }
    return out;
}

#undef MERGE_BAIL

}  // namespace

// native analytic Solid -> OCCT TopoDS_Shape, built DIRECTLY via BRepBuilderAPI
// (BRep_Builder + MakeVertex/MakeEdge/MakeFace). NO analytic-STEP round-trip and
// NO STEPControl_Reader — the previous StepAnalytic::write -> temp.step -> OCCT
// reader path hung and spiked ~4.5 GB on box-minus-cyl.
//
//   * ALL-PLANAR simple bodies (every face a single-loop, non-disk PLANE face) are
//     rebuilt 1:1 from the native topology, so a primitive keeps its minimal
//     analytic B-rep (box 6F/12E, prism 8F/18E, wedge 6F/12E, pyramid 5F/8E) — the
//     exact-count contract the A/B brep-signature gate asserts.
//   * everything else (curved faces, disk caps, holed faces, or a planar build that
//     fails) falls back to the FACETED path (native tessellation -> OCCT solid).

// Test/diagnostic hook: FORGE_BRIDGE_FACETED=1 forces the FACETED fallback for the
// whole bridge, skipping ALL analytic reconstruction (planar-sewn, cylinder, cone,
// sphere, torus). This lets an A/B smoke drive a KNOWN analytic body (a cylinder or
// cone whose exact volume is closed-form) through occtFacetedFromNativeSolid and
// measure the OCCT-integrated volume of the faceted solid against truth — the exact
// mis-integration path the mold-cone bug (b8251e83) exposed. OFF by default → zero
// effect on the production path (each analytic reconstructor runs as before).
bool bridgeForceFaceted() {
    const char* e = std::getenv("FORGE_BRIDGE_FACETED");
    return e && e[0] == '1';
}

TopoDS_Shape occtFromNativeSolid(const Solid& solid) {
    if (bridgeForceFaceted()) return occtFacetedFromNativeSolid(solid);

    // Gather every face and decide whether the whole body is all-planar-simple.
    std::vector<const Face*> allFaces;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (f) allFaces.push_back(f);
        }
    }
    if (allFaces.empty()) {
        throw std::runtime_error("native->OCCT bridge: solid has no faces");
    }

    bool planarSimple = true;
    for (const Face* f : allFaces) {
        if (!f->outerLoop || !f->innerLoops.empty()) { planarSimple = false; break; }
        const Surface* s = f->surface;
        if (s && (s->kind != SurfaceKind::Plane || s->isDisk)) { planarSimple = false; break; }
    }

    if (planarSimple) {
        // Rebuild each native planar face as an OCCT planar polygon face; sewing
        // stitches them into the minimal analytic B-rep (box 6F/12E, prism 8F/18E,
        // wedge 6F/12E, pyramid 5F/8E) with the exact enclosed volume on re-import.
        std::vector<std::vector<gp_Pnt>> faces;
        faces.reserve(allFaces.size());
        bool good = true;
        for (const Face* f : allFaces) {
            const Loop* lp = f->outerLoop;
            std::vector<gp_Pnt> ring;
            const Coedge* c = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount && c; ++i, c = c->next) {
                const Vertex* v = c->originVertex();
                if (!v) { good = false; break; }
                ring.emplace_back(v->point.x, v->point.y, v->point.z);
            }
            if (!good || ring.size() < 3) { good = false; break; }
            faces.push_back(std::move(ring));
        }
        if (good) {
            TopoDS_Shape s = buildSewnPlanarSolid(faces);
            if (!s.IsNull()) return s;
        }
        // otherwise: honest fall-through to the faceted path.
    }

    // ANALYTIC RECONSTRUCTION: a curved body (cylinder / through-bore / degenerate
    // cone) whose faces we can rebuild EXACTLY keeps its analytic B-rep — ONE
    // cylindrical face per surface instead of hundreds of triangle planes — so
    // ShapeUpgrade_UnifySameDomain and every face-level direct edit work. Best
    // effort: a null result falls through to the (unchanged) faceted path.
    {
        const TopoDS_Shape analytic = occtAnalyticFromNativeSolid(solid);
        if (!analytic.IsNull()) return analytic;
    }

    // CONE / FRUSTUM: rebuild as an EXACT OCCT cone (Geom_ConicalSurface) instead of
    // the faceted polyhedron, whose plane-facet re-import integrates to the wrong
    // volume and breaks downstream booleans. Volume-cross-checked → decline to the
    // faceted path on any mismatch (zero regression for non-cone bodies).
    {
        const TopoDS_Shape coneShape = occtConeFromNativeSolid(solid);
        if (!coneShape.IsNull()) return coneShape;
    }

    // SPHERE: rebuild as an EXACT OCCT sphere (one Geom_SphericalSurface face)
    // instead of the ~N*M plane-facet polyhedron. Volume-cross-checked → decline to
    // the faceted path on any mismatch (zero regression for non-sphere bodies).
    {
        const TopoDS_Shape sphereShape = occtSphereFromNativeSolid(solid);
        if (!sphereShape.IsNull()) return sphereShape;
    }

    // TORUS: rebuild as an EXACT OCCT torus (one Geom_ToroidalSurface face) instead
    // of the faceted polyhedron, whose plane-facet void even collapses the enclosing
    // boolean. Volume-cross-checked → decline to the faceted path on any mismatch.
    {
        const TopoDS_Shape torusShape = occtTorusFromNativeSolid(solid);
        if (!torusShape.IsNull()) return torusShape;
    }

    // MERGED-STRIP ANALYTIC: a BOOLEAN-RESULT strip soup none of the dedicated
    // reconstructors accepted (the corner-notch = box - corner cylinder: 6 planes
    // shattered into ~74 triangles + a 32-strip PARTIAL cylinder wall). Group the
    // strips into their logical analytic faces (signature + shared-edge, exactly like
    // nativeFaceInventory) and rebuild ONE OCCT face each — so faceInventory / the
    // exported STEP carry the exact clean faces {plane:6, cylinder:1} instead of the
    // faceted shatter. Volume-cross-checked → decline to the faceted path on any
    // mismatch (zero regression: every earlier path had its chance first).
    {
        const TopoDS_Shape merged = occtMergedAnalyticFromNativeSolid(solid);
        if (!merged.IsNull()) return merged;
    }

    return occtFacetedFromNativeSolid(solid);
}

ShapeHandle toOcctBackedHandle(ShapeHandle h) {
    auto& reg = ShapeRegistry::instance();
    const ShapeKind k = reg.kindOf(h);
    if (k == ShapeKind::NativeSolid) {
        return reg.add(occtFromNativeSolid(reg.getNativeSolid(h)));
    }
    if (k == ShapeKind::NativeMesh) {
        throw std::runtime_error(
            "toOcctBackedHandle: NativeMesh (faceted feature result) bridging is a "
            "later wave — the analytic-solid bridge does not cover it");
    }
    return h;  // already OCCT-backed
}

}  // namespace forge

#else  // !FORGE_NATIVE_BREP — pure OCCT build: identity (no native handles exist).

namespace forge {
ShapeHandle toOcctBackedHandle(ShapeHandle h) { return h; }
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
