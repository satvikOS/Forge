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
#include <Geom_CylindricalSurface.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <Geom_Surface.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopAbs.hxx>
#include <TopAbs_Orientation.hxx>
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

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <unordered_map>
#include <string>
#include <vector>

namespace forge {

using native::brep::Solid;
using native::brep::Shell;
using native::brep::Face;
using native::brep::Loop;
using native::brep::Coedge;
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

// Build a closed OCCT solid from a vertex list + a set of SINGLE-LOOP polygonal
// faces (each face = ordered global vertex indices, wound CCW as seen from OUTSIDE
// the solid). This is used for BOTH bridge paths:
//   * analytic-planar : the native topology's faces fed 1:1 (box/prism/wedge/… stay
//                        the minimal analytic B-rep — 6F/12E box, 8F/18E prism, …),
//   * faceted fallback: the native tessellation's triangles (curved / holed bodies).
//
// Edges are SHARED across faces by their UNORDERED index pair, so the resulting
// shell is watertight AND carries the EXACT topological edge count (no proximity
// sewing, no STEP round-trip). Each face is built on the plane through its loop with
// the OUTWARD (Newell) normal — which also stamps the pcurves that OCCT's mass /
// mesh / BREP-write paths require. Returns a null shape only on total failure (the
// caller then throws or, from the planar path, falls back to the faceted path).
TopoDS_Shape buildOcctSolidFromPolyhedron(
        const std::vector<gp_Pnt>& pts,
        const std::vector<std::vector<int>>& faces) {
    if (pts.empty() || faces.empty()) return TopoDS_Shape();

    BRep_Builder bb;

    // One OCCT vertex per input point.
    std::vector<TopoDS_Vertex> verts;
    verts.reserve(pts.size());
    for (const auto& p : pts) verts.push_back(BRepBuilderAPI_MakeVertex(p));

    // Straight edges SHARED by unordered vertex-index pair (min<<32 | max),
    // oriented min->max in their FORWARD sense. Both faces that meet along an
    // edge reference the same TopoDS_Edge (same TShape) → TopExp counts it once
    // and the shell is watertight.
    std::unordered_map<std::uint64_t, TopoDS_Edge> emap;
    emap.reserve(faces.size() * 2);
    auto edgeKey = [](int a, int b) -> std::uint64_t {
        std::uint32_t lo = static_cast<std::uint32_t>(a < b ? a : b);
        std::uint32_t hi = static_cast<std::uint32_t>(a < b ? b : a);
        return (static_cast<std::uint64_t>(lo) << 32) | static_cast<std::uint64_t>(hi);
    };
    auto edgeFor = [&](int a, int b) -> TopoDS_Edge {
        const std::uint64_t k = edgeKey(a, b);
        auto it = emap.find(k);
        if (it != emap.end()) return it->second;
        BRepBuilderAPI_MakeEdge me(verts[a], verts[b]);
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

        // Wire from the SHARED oriented edges, in loop order (no reordering).
        TopoDS_Wire wire;
        bb.MakeWire(wire);
        bool ok = true;
        for (std::size_t i = 0; i < n; ++i) {
            const int a = loop[i];
            const int b = loop[(i + 1) % n];
            TopoDS_Edge e = edgeFor(a, b);
            if (e.IsNull()) { ok = false; break; }
            e.Orientation(a < b ? TopAbs_FORWARD : TopAbs_REVERSED);
            bb.Add(wire, e);
        }
        if (!ok) continue;

        // Planar face on `pln` bounded by `wire`; MakeFace stamps the pcurves.
        BRepBuilderAPI_MakeFace mf(pln, wire);
        if (!mf.IsDone()) continue;
        bb.Add(shell, mf.Face());
        ++built;
    }

    if (built == 0) return TopoDS_Shape();

    TopoDS_Solid solid;
    bb.MakeSolid(solid);
    bb.Add(solid, shell);

    // Orient positive: with every loop wound CCW-from-outside the Newell normals
    // are outward and the volume is already positive; this is the safety net.
    GProp_GProps vp;
    BRepGProp::VolumeProperties(solid, vp);
    if (vp.Mass() < 0.0) solid.Reverse();
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

// Rebuild a native analytic Solid as the MINIMAL analytic OCCT B-rep: planar faces
// (incl. drilled / holed caps) 1:1, and each cylinder's strip-faces collapsed to
// one Geom_CylindricalSurface face. Returns a null shape if ANY face/group is not
// a supported analytic form OR the rebuilt volume does not match the native volume
// (the caller then falls back to the unchanged faceted path — no regression).
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
    for (const Face* f : faces) {
        const Surface* s = f->surface;
        if (!s) return TopoDS_Shape();  // bare topology -> decline
        const bool isCyl =
            s->kind == SurfaceKind::Cylinder ||
            (s->kind == SurfaceKind::Cone &&
             std::fabs(s->r1 - s->r2) <= 1e-9 * std::max(1.0, std::fabs(s->r1)));
        if (s->kind == SurfaceKind::Plane) {
            planar.push_back(f);
        } else if (isCyl) {
            const std::string k = cylinderKey(s);
            cylGroups[k].push_back(f);
            cylRep.emplace(k, s);
        } else {
            return TopoDS_Shape();  // cone / sphere / torus / nurbs -> faceted path
        }
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
    // gp_Ax2: base circle centre O, +Z = A (base→top), +X = R. MakeCone puts the
    // r1 circle at O and the r2 circle at O + A*height — the native convention.
    BRepPrimAPI_MakeCone mk(gp_Ax2(O, A, R), cone->r1, cone->r2, cone->param);
    mk.Build();
    if (!mk.IsDone()) return TopoDS_Shape();
    const TopoDS_Shape out = mk.Shape();
    if (out.IsNull()) return TopoDS_Shape();

    GProp_GProps vp;
    BRepGProp::VolumeProperties(out, vp);
    const double vol = vp.Mass();
    const double ref = native::brep::massProperties(solid).volume;
    if (!(vol > 1e-12)) return TopoDS_Shape();
    if (std::fabs(vol - ref) > 1e-6 * std::max(1.0, std::fabs(ref))) return TopoDS_Shape();
    return out;
}

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
TopoDS_Shape occtFromNativeSolid(const Solid& solid) {
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
