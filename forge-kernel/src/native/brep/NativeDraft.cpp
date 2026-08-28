// src/native/brep/NativeDraft.cpp — TKOffset-free DRAFT (family J).
//
// Read include/forge/native/brep/NativeDraft.hpp first: it carries the scope,
// the named formulation, the sign convention, the HONEST-DEFER list and the drop
// hygiene. This file carries the derivation and the code.
//
// ===========================================================================
// WHY THE ANSWER IS EXACT, NOT AN APPROXIMATION OF OCCT'S
// ===========================================================================
// A planar-faced solid is completely determined by its face planes plus its
// face/edge/vertex incidence: each vertex is the meet of its incident planes.
// Draft changes ONLY the planes of the selected faces, and changes them by a
// RIGID ROTATION about a line lying in each of them. Therefore:
//   * no face changes type, count or incidence — the drafted solid has exactly
//     the same combinatorial boundary as the input;
//   * every vertex of the drafted solid is the meet of its incident (rotated or
//     untouched) planes, computed in closed form;
//   * a vertex ON the neutral plane does not move at all, because the rotation
//     axis of every incident rotated plane passes through the neutral plane and
//     the displacement w*sin(theta) vanishes there. That is the geometric reason
//     the drafted body is pinned to the neutral section, and it is asserted
//     directly in the A/B.
// So the result is the drafted solid, full stop. Comparing it against OCCT is a
// cross-check of two independent constructions, not a fit.
//
// ===========================================================================
// THE ROTATION, IN FULL
// ===========================================================================
// face plane    {n . x = d}      (n = OUTWARD normal, orientation-honoured)
// neutral plane {m . x = e}      (m flipped so m . pull > 0)
// c = n . m ;  axis dir a = (n x m)/|n x m| ;  |n x m|^2 = 1 - c^2
//
// point of the axis nearest the origin, from {n.p = d, m.p = e} in span{n,m}:
//     p0 = alpha n + beta m,  alpha = (d - c e)/(1 - c^2),  beta = (e - c d)/(1 - c^2)
// (substitute: n.p0 = alpha + beta c = d, m.p0 = alpha c + beta = e — exact.)
//
// u = a x n  (unit, lies in the face plane, perpendicular to the axis)
// n' = n cos(th) + u sin(th)          [Rodrigues with a . n = 0]
// d' = n' . p0
//
// For a face point p = p0 + s a + w u:  n'.p - d' = w sin(th)
// and its height above the neutral plane h = m.(p - p0) = w (m . u).
// So the wall moves along its own outward normal by  h * sin(th)/(m . u).
// th = +angleRad, which is BRepOffsetAPI_DraftAngle's own convention: the wall
// leans IN as h grows (the mould-release direction) and the volume shrinks. That
// sign was MEASURED against live OCCT, not assumed — see the SIGN comment at the
// theta assignment. m . u vanishes only when the face plane is parallel to the
// pull direction everywhere, the degenerate case the axis test already excludes.

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/NativeDraft.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <vector>

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepGProp.hxx>
#include <BRepLib.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_Surface.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopTools_MapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include "forge/native/brep/NativeShapeHeal.hpp"   // occtheal::solidFromShell

namespace forge {
namespace occtdraft {

namespace {

const TopoDS_Shape kNull;

constexpr double kPi = 3.14159265358979323846;

// A plane in Hesse form: n . x = d, with n the face's OUTWARD unit normal.
struct Plane {
    double nx = 0.0, ny = 0.0, nz = 0.0, d = 0.0;
};

bool envOn(const char* name) {
    const char* v = std::getenv(name);
    return v && (*v == '1' || *v == 'y' || *v == 'Y' || *v == 't' || *v == 'T');
}

// Unwrap a Geom_RectangularTrimmedSurface down to its analytic basis.
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

// Outward unit normal + Hesse offset of a PLANAR face, honouring the face's
// TopAbs orientation (a REVERSED face's outward normal is the flipped plane
// normal). False iff the face is not a Geom_Plane => the caller defers.
// Identical in intent and in code to NativeThickSolid.cpp's outwardPlaneOf; kept
// local so this TU stays self-contained and can be compiled alone by the A/B.
bool outwardPlaneOf(const TopoDS_Face& f, Plane& out) {
    Handle(Geom_Surface) s = basisSurface(BRep_Tool::Surface(f));
    Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s);
    if (pl.IsNull()) return false;
    const gp_Pln& gpl = pl->Pln();
    const gp_Dir n = gpl.Axis().Direction();
    double nx = n.X(), ny = n.Y(), nz = n.Z();
    if (f.Orientation() == TopAbs_REVERSED) { nx = -nx; ny = -ny; nz = -nz; }
    const gp_Pnt& o = gpl.Location();
    out.nx = nx; out.ny = ny; out.nz = nz;
    out.d = nx * o.X() + ny * o.Y() + nz * o.Z();
    return true;
}

// Least-squares meet of k planes { n_i . x = d_i } by the 3x3 normal equations
// (Shell.cpp / NativeThickSolid.cpp intersectPlanes, verbatim — the family-H
// corner solve the header says to reuse). Exact for >= 3 independent planes.
// False iff the system is rank-deficient.
bool intersectPlanes(const std::vector<Plane>& planes, gp_Pnt& out) {
    double A[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};
    double b[3] = {0, 0, 0};
    for (const Plane& p : planes) {
        A[0][0] += p.nx * p.nx; A[0][1] += p.nx * p.ny; A[0][2] += p.nx * p.nz;
        A[1][0] += p.ny * p.nx; A[1][1] += p.ny * p.ny; A[1][2] += p.ny * p.nz;
        A[2][0] += p.nz * p.nx; A[2][1] += p.nz * p.ny; A[2][2] += p.nz * p.nz;
        b[0] += p.d * p.nx; b[1] += p.d * p.ny; b[2] += p.d * p.nz;
    }
    double M[3][4] = {
        {A[0][0], A[0][1], A[0][2], b[0]},
        {A[1][0], A[1][1], A[1][2], b[1]},
        {A[2][0], A[2][1], A[2][2], b[2]},
    };
    for (int col = 0; col < 3; ++col) {
        int piv = col;
        for (int r = col + 1; r < 3; ++r)
            if (std::fabs(M[r][col]) > std::fabs(M[piv][col])) piv = r;
        if (std::fabs(M[piv][col]) < 1e-12) return false;
        if (piv != col) for (int k = 0; k < 4; ++k) std::swap(M[col][k], M[piv][k]);
        for (int r = 0; r < 3; ++r) {
            if (r == col) continue;
            const double fct = M[r][col] / M[col][col];
            for (int k = col; k < 4; ++k) M[r][k] -= fct * M[col][k];
        }
    }
    out.SetCoord(M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]);
    return true;
}

// Ordered outer-wire vertices of a face (wire order, each vertex once).
std::vector<TopoDS_Vertex> orderedRing(const TopoDS_Face& f) {
    std::vector<TopoDS_Vertex> ring;
    const TopoDS_Wire w = BRepTools::OuterWire(f);
    if (w.IsNull()) return ring;
    for (BRepTools_WireExplorer wex(w, f); wex.More(); wex.Next())
        ring.push_back(wex.CurrentVertex());
    return ring;
}

// Rotate the plane `p` about its intersection line with the neutral plane
// {m . x = e} by `theta`. False iff the two planes are parallel (no axis).
bool rotatePlaneAboutNeutral(const Plane& p, const gp_Dir& m, double e,
                             double theta, Plane& out) {
    const gp_Vec n(p.nx, p.ny, p.nz);
    const gp_Vec mv(m);
    const double c = n.Dot(mv);
    const double s2 = 1.0 - c * c;                     // = |n x m|^2
    if (s2 < 1.0e-12) return false;                    // parallel: no axis

    const gp_Vec a = n.Crossed(mv) / std::sqrt(s2);    // unit axis direction
    const gp_Vec u = a.Crossed(n);                     // unit, lies IN the face plane

    const double alpha = (p.d - c * e) / s2;
    const double beta  = (e - c * p.d) / s2;
    const gp_Vec p0v = n * alpha + mv * beta;          // axis point nearest the origin

    const gp_Vec nn = n * std::cos(theta) + u * std::sin(theta);
    out.nx = nn.X(); out.ny = nn.Y(); out.nz = nn.Z();
    out.d  = nn.Dot(p0v);
    return true;
}

}  // namespace

bool draftNativeEnabled() {
#ifdef FORGE_DRAFT_DROP_NATIVE
    return true;   // the OCCT fallback is compiled out; this is the only path
#else
    static const bool on = envOn("FORGE_DRAFT_NATIVE");
    return on;
#endif
}

TopoDS_Shape draftFaces(const TopoDS_Shape& shape,
                        const TopTools_ListOfShape& faces,
                        const gp_Dir& pull,
                        double angleRad,
                        const gp_Pln& neutral,
                        double tol) {
    if (shape.IsNull() || faces.IsEmpty()) return kNull;
    if (!(std::fabs(angleRad) > 1.0e-12)) return kNull;          // a no-op is not a draft
    if (std::fabs(angleRad) >= 0.5 * kPi - 1.0e-9) return kNull; // >= 90 deg is not a draft

    // ---- 0. the neutral plane, oriented along the PULL direction -----------
    gp_Dir m = neutral.Axis().Direction();
    if (gp_Vec(m).Dot(gp_Vec(pull)) < 0.0) m.Reverse();
    const gp_Pnt no = neutral.Location();
    const double e = m.X() * no.X() + m.Y() * no.Y() + m.Z() * no.Z();

    // theta = +angleRad: see the header's SIGN paragraph. MEASURED, not assumed —
    // the first A/B run of this engine used -angleRad and every case came back
    // MIRRORED (cube 5 deg: 1185.18 grown against OCCT's 835.23 shrunk), so the
    // convention was read off live OCCT and fixed here. A positive angle leans each
    // selected wall INTO the material as height above the neutral plane grows,
    // which is BRepOffsetAPI_DraftAngle's own convention and the mould-release
    // sense. The A/B compares the SOLIDS, so a sign error cannot pass unnoticed.
    const double theta = angleRad;

    // ---- 1. gather faces; every one must be a single-wire Geom_Plane -------
    std::vector<TopoDS_Face> allFaces;
    std::vector<Plane> planes;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        Plane pl;
        if (!outwardPlaneOf(f, pl)) return kNull;      // non-planar => defer
        int nWires = 0;
        for (TopoDS_Iterator it(f); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++nWires;
        if (nWires != 1) return kNull;                 // face with a hole => defer
        allFaces.push_back(f);
        planes.push_back(pl);
    }
    if (allFaces.size() < 4) return kNull;             // not a closed polyhedron

    // ---- 2. rotate the plane of every SELECTED face ------------------------
    TopTools_MapOfShape want;
    for (TopTools_ListIteratorOfListOfShape it(faces); it.More(); it.Next())
        want.Add(it.Value());

    int nSelected = 0;
    for (std::size_t i = 0; i < allFaces.size(); ++i) {
        if (!want.Contains(allFaces[i])) continue;
        Plane rot;
        if (!rotatePlaneAboutNeutral(planes[i], m, e, theta, rot)) return kNull;
        planes[i] = rot;
        ++nSelected;
    }
    // Every requested face must have been found on the shape. A face silently
    // dropped here would emit a HALF-DRAFTED part that looks plausible.
    if (nSelected != want.Extent()) return kNull;
    if (nSelected == 0) return kNull;

    // ---- 3. re-meet every vertex against its incident planes ---------------
    TopTools_IndexedDataMapOfShapeListOfShape vfMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_FACE, vfMap);
    TopTools_IndexedMapOfShape faceIndex;
    for (const TopoDS_Face& f : allFaces) faceIndex.Add(f);

    const int nV = vfMap.Extent();
    if (nV == 0) return kNull;
    std::vector<gp_Pnt> moved(static_cast<std::size_t>(nV));
    // Scale the residual bound by the model size so the check means the same
    // thing on a 1 mm part and a 1 m one.
    double extent = 1.0;
    for (int i = 1; i <= nV; ++i) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vfMap.FindKey(i)));
        extent = std::max(extent, std::max(std::fabs(p.X()),
                          std::max(std::fabs(p.Y()), std::fabs(p.Z()))));
    }
    const double resTol = 1.0e-7 * extent;

    for (int i = 1; i <= nV; ++i) {
        std::vector<Plane> meet;
        for (TopTools_ListIteratorOfListOfShape it(vfMap.FindFromIndex(i)); it.More(); it.Next()) {
            const int fi = faceIndex.FindIndex(it.Value());
            if (fi == 0) return kNull;
            meet.push_back(planes[static_cast<std::size_t>(fi) - 1]);
        }
        if (meet.size() < 3) return kNull;             // no exact corner to meet
        gp_Pnt corner;
        if (!intersectPlanes(meet, corner)) return kNull;   // rank-deficient
        // EXACTNESS GUARD: the least-squares meet is the drafted corner ONLY if
        // every incident plane actually contains it. An over-determined apex that
        // the rotation has pulled apart is declined, never averaged.
        for (const Plane& p : meet) {
            const double r = p.nx * corner.X() + p.ny * corner.Y() + p.nz * corner.Z() - p.d;
            if (std::fabs(r) > resTol) return kNull;
        }
        moved[static_cast<std::size_t>(i) - 1] = corner;
    }

    // ---- 4. rebuild every face over its own ring of moved corners ----------
    // Orientation is left to the sew + solidFromShell pair (as planarThickSolid
    // and planarOffsetShape do): the wires fix the region, the signed-volume flip
    // fixes the side.
    BRepBuilderAPI_Sewing sew(std::max(tol, 1.0e-6));
    for (const TopoDS_Face& f : allFaces) {
        const std::vector<TopoDS_Vertex> ring = orderedRing(f);
        if (ring.size() < 3) return kNull;
        BRepBuilderAPI_MakePolygon poly;
        for (const TopoDS_Vertex& v : ring) {
            const int idx = vfMap.FindIndex(v);
            if (idx == 0) return kNull;
            poly.Add(moved[static_cast<std::size_t>(idx) - 1]);
        }
        poly.Close();
        if (!poly.IsDone()) return kNull;
        BRepBuilderAPI_MakeFace mkf(poly.Wire(), Standard_True);
        if (!mkf.IsDone()) return kNull;               // face collapsed under the draft
        sew.Add(mkf.Face());
    }

    sew.Perform();
    if (sew.NbFreeEdges() != 0) return kNull;          // not watertight => defer
    const TopoDS_Shape sewed = sew.SewedShape();
    if (sewed.IsNull()) return kNull;
    TopoDS_Shell shell;
    int nShells = 0;
    for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
        shell = TopoDS::Shell(ex.Current());
        ++nShells;
    }
    if (nShells != 1 || shell.IsNull()) return kNull;

    TopoDS_Solid solid = forge::occtheal::solidFromShell(shell);
    if (solid.IsNull()) return kNull;
    BRepLib::SameParameter(solid, std::max(tol, 1.0e-6), Standard_True);

    // ---- 5. self-checks: a draft preserves the face count and stays a solid --
    int nFaceOut = 0;
    for (TopExp_Explorer ex(solid, TopAbs_FACE); ex.More(); ex.Next()) ++nFaceOut;
    if (nFaceOut != static_cast<int>(allFaces.size())) return kNull;

    GProp_GProps pn;
    BRepGProp::VolumeProperties(solid, pn);
    if (!(std::fabs(pn.Mass()) > 1.0e-12)) return kNull;
    return solid;
}

}  // namespace occtdraft
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
