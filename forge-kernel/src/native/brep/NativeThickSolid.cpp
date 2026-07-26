// forge/native/brep/NativeThickSolid.cpp
//
// Implementation of forge::occtoffset::makeThickSolid — the TKOffset-free,
// OCCT-TopoDS mirror of forge::native::brep::shellSolid (src/native/brep/Shell.cpp)
// for the PLANAR / PRISMATIC hollow. See NativeThickSolid.hpp for the full
// specification, the drop-hygiene toolkit list, and the honest scope boundary.
//
// This file references NO BRepOffset*/BRepOffsetAPI* symbol: it rebuilds the
// hollow solid from scratch on the SURVIVING toolkits (TKMath/TKG3d/TKBRep/
// TKTopAlgo/TKShHealing), exactly the way NativeSectionFill.cpp rebuilds a skin
// surface without GeomFill_NSections. A null TopoDS_Shape is an HONEST DEFER.

#include "forge/native/brep/NativeThickSolid.hpp"

#ifdef FORGE_NATIVE_BREP

#include <BRep_Tool.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepGProp.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include "forge/native/brep/NativeShapeHeal.hpp"  // occtheal::solidFromShell (TKShHealing-free ShapeFix_Solid subset)
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
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <cmath>
#include <vector>

namespace forge {
namespace occtoffset {

namespace {

// A plane in Hesse form { n . x = d }, n a unit outward normal.
struct Plane {
    double nx, ny, nz, d;
};

// Outward unit normal + Hesse offset of a PLANAR face, honouring the face's
// TopAbs orientation (a REVERSED face's outward normal is the flipped plane
// normal). Returns false iff the face is not a Geom_Plane (=> caller defers).
bool outwardPlaneOf(const TopoDS_Face& f, Plane& out) {
    Handle(Geom_Surface) s = BRep_Tool::Surface(f);
    Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s);
    if (pl.IsNull()) return false;
    const gp_Pln& gpl = pl->Pln();
    gp_Dir n = gpl.Axis().Direction();
    double nx = n.X(), ny = n.Y(), nz = n.Z();
    if (f.Orientation() == TopAbs_REVERSED) { nx = -nx; ny = -ny; nz = -nz; }
    const gp_Pnt& o = gpl.Location();
    out.nx = nx; out.ny = ny; out.nz = nz;
    out.d = nx * o.X() + ny * o.Y() + nz * o.Z();
    return true;
}

// Least-squares meet of k planes { n_i . x = d_i } by the 3x3 normal equations
// (Shell.cpp intersectPlanes, verbatim). Exact for >=3 independent planes (a
// convex corner). Returns false iff the system is rank-deficient.
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
            double fct = M[r][col] / M[col][col];
            for (int k = col; k < 4; ++k) M[r][k] -= fct * M[col][k];
        }
    }
    out.SetCoord(M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]);
    return true;
}

// Ordered outer-wire vertices of a face (wire order, each vertex once).
std::vector<TopoDS_Vertex> orderedRing(const TopoDS_Face& f) {
    std::vector<TopoDS_Vertex> ring;
    TopoDS_Wire w = BRepTools::OuterWire(f);
    if (w.IsNull()) return ring;
    for (BRepTools_WireExplorer wex(w, f); wex.More(); wex.Next())
        ring.push_back(wex.CurrentVertex());
    return ring;
}

}  // namespace

TopoDS_Shape makeThickSolid(const TopoDS_Shape& shape, double t,
                            const TopTools_ListOfShape& facesToRemove,
                            double tol) {
    const TopoDS_Shape kNull;  // IsNull() == honest defer
    if (shape.IsNull() || t <= 0.0) return kNull;

    // ---- 0. removed-face set (IsSame semantics) ----
    TopTools_MapOfShape removedSet;
    for (TopTools_ListIteratorOfListOfShape it(facesToRemove); it.More(); it.Next())
        removedSet.Add(it.Value());
    // Zero openings => a fully-closed void (two-shell solid) — HONEST DEFER to OCCT.
    if (removedSet.IsEmpty()) return kNull;

    // ---- 1. gather faces; every one must be a Geom_Plane (else defer) ----
    std::vector<TopoDS_Face> allFaces;
    std::vector<Plane> outward;   // outward plane per face (parallel to allFaces)
    std::vector<bool> removed;    // is this face an opening?
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face f = TopoDS::Face(ex.Current());
        Plane pl;
        if (!outwardPlaneOf(f, pl)) return kNull;  // non-planar => defer
        allFaces.push_back(f);
        outward.push_back(pl);
        removed.push_back(removedSet.Contains(f));
    }
    if (allFaces.size() < 4) return kNull;  // not a solid we can hollow

    // ---- 1b. thickness guard vs the solid's minimum half-extent ----
    TopTools_IndexedMapOfShape vmapAll;
    TopExp::MapShapes(shape, TopAbs_VERTEX, vmapAll);
    if (vmapAll.Extent() == 0) return kNull;
    double lo[3] = {0, 0, 0}, hi[3] = {0, 0, 0};
    for (int i = 1; i <= vmapAll.Extent(); ++i) {
        gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vmapAll.FindKey(i)));
        double c[3] = {p.X(), p.Y(), p.Z()};
        for (int k = 0; k < 3; ++k) {
            if (i == 1) { lo[k] = hi[k] = c[k]; }
            else { lo[k] = std::min(lo[k], c[k]); hi[k] = std::max(hi[k], c[k]); }
        }
    }
    double halfMin = 0.5 * std::min(std::min(hi[0] - lo[0], hi[1] - lo[1]), hi[2] - lo[2]);
    if (t >= halfMin) return kNull;  // inner offset would collapse => defer

    // ---- 2. vertex -> incident faces (indexed) ----
    TopTools_IndexedDataMapOfShapeListOfShape vfMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_FACE, vfMap);
    // Face -> its index in allFaces (IsSame lookup via an indexed map).
    TopTools_IndexedMapOfShape faceIndex;
    for (const TopoDS_Face& f : allFaces) faceIndex.Add(f);

    // ---- 3. inner corner per vertex (offset-plane meet, mouth-pinned) ----
    // innerPnt[i] is the cavity corner for vmap vertex i (1-based -> [i-1]).
    const int nV = vfMap.Extent();
    std::vector<gp_Pnt> innerPnt(nV);
    std::vector<bool> haveInner(nV, false);
    for (int i = 1; i <= nV; ++i) {
        const TopTools_ListOfShape& faces = vfMap.FindFromIndex(i);
        std::vector<Plane> meet;
        gp_Pnt vpnt = BRep_Tool::Pnt(TopoDS::Vertex(vfMap.FindKey(i)));
        double navg[3] = {0, 0, 0};
        int nContrib = 0;
        for (TopTools_ListIteratorOfListOfShape it(faces); it.More(); it.Next()) {
            int fi = faceIndex.FindIndex(it.Value());
            if (fi == 0) continue;
            const Plane& op = outward[static_cast<std::size_t>(fi) - 1];
            if (removed[static_cast<std::size_t>(fi) - 1]) {
                // Pin the mouth corner into the removed face's ORIGINAL plane.
                meet.push_back(op);
            } else {
                // Retained face: offset its plane INWARD by t (d -> d - t).
                Plane in = op; in.d = op.d - t;
                meet.push_back(in);
                navg[0] += op.nx; navg[1] += op.ny; navg[2] += op.nz; ++nContrib;
            }
        }
        gp_Pnt corner;
        if (!intersectPlanes(meet, corner)) {
            // Rank-deficient (edge-only vertex): push inward along the averaged
            // retained normal by t (Shell.cpp degenerate fallback).
            if (nContrib == 0) return kNull;
            double n = std::sqrt(navg[0]*navg[0] + navg[1]*navg[1] + navg[2]*navg[2]);
            if (n < 1e-12) return kNull;
            corner.SetCoord(vpnt.X() - t * navg[0] / n,
                            vpnt.Y() - t * navg[1] / n,
                            vpnt.Z() - t * navg[2] / n);
        }
        innerPnt[static_cast<std::size_t>(i) - 1] = corner;
        haveInner[static_cast<std::size_t>(i) - 1] = true;
    }
    auto innerOf = [&](const TopoDS_Vertex& v, gp_Pnt& out) -> bool {
        int idx = vfMap.FindIndex(v);
        if (idx == 0 || !haveInner[static_cast<std::size_t>(idx) - 1]) return false;
        out = innerPnt[static_cast<std::size_t>(idx) - 1];
        return true;
    };

    // ---- 4/5. assemble outer(unchanged) + inner + lip faces ----
    BRepBuilderAPI_Sewing sew(std::max(tol, 1.0e-6));
    int nInner = 0, nLip = 0, nOuter = 0;

    for (std::size_t fi = 0; fi < allFaces.size(); ++fi) {
        const TopoDS_Face& f = allFaces[fi];
        std::vector<TopoDS_Vertex> ring = orderedRing(f);
        if (ring.size() < 3) return kNull;

        if (!removed[fi]) {
            // Outer face: unchanged (an inward hollow keeps the outer boundary).
            sew.Add(f);
            ++nOuter;
            // Inner face: the offset-plane meet corners, wound REVERSE so the
            // inner normal points into the cavity.
            BRepBuilderAPI_MakePolygon poly;
            for (auto it = ring.rbegin(); it != ring.rend(); ++it) {
                gp_Pnt ip;
                if (!innerOf(*it, ip)) return kNull;
                poly.Add(ip);
            }
            poly.Close();
            if (!poly.IsDone()) return kNull;
            BRepBuilderAPI_MakeFace mkf(poly.Wire(), Standard_True);
            if (!mkf.IsDone()) return kNull;
            sew.Add(mkf.Face());
            ++nInner;
        } else {
            // Removed face: one lip quad per rim edge (outer_a, outer_b, inner_b,
            // inner_a), bridging the outer rim to the inner rim.
            const std::size_t n = ring.size();
            for (std::size_t k = 0; k < n; ++k) {
                const TopoDS_Vertex& va = ring[k];
                const TopoDS_Vertex& vb = ring[(k + 1) % n];
                gp_Pnt oa = BRep_Tool::Pnt(va), ob = BRep_Tool::Pnt(vb);
                gp_Pnt ia, ib;
                if (!innerOf(va, ia) || !innerOf(vb, ib)) return kNull;
                BRepBuilderAPI_MakePolygon quad;
                quad.Add(oa); quad.Add(ob); quad.Add(ib); quad.Add(ia);
                quad.Close();
                if (!quad.IsDone()) return kNull;
                BRepBuilderAPI_MakeFace mkq(quad.Wire(), Standard_True);
                if (!mkq.IsDone()) return kNull;
                sew.Add(mkq.Face());
                ++nLip;
            }
        }
    }
    if (nInner == 0 || nOuter == 0) return kNull;

    // ---- 5b. sew into one shell; must be watertight (no free edges) ----
    sew.Perform();
    if (sew.NbFreeEdges() != 0) return kNull;  // not closed => honest defer
    TopoDS_Shape sewed = sew.SewedShape();
    if (sewed.IsNull()) return kNull;

    TopoDS_Shell shell;
    int nShells = 0;
    for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
        shell = TopoDS::Shell(ex.Current());
        ++nShells;
    }
    if (nShells != 1 || shell.IsNull()) return kNull;  // want ONE connected wall

    // ---- 5c. orient into a valid positive-volume solid ----
    // Native ShapeFix_Solid::SolidFromShell subset (TKShHealing-free):
    // BRepBuilderAPI_MakeSolid + signed-volume outward flip.
    TopoDS_Solid solid = forge::occtheal::solidFromShell(shell);
    if (solid.IsNull()) return kNull;

    GProp_GProps props;
    BRepGProp::VolumeProperties(solid, props);
    double vol = props.Mass();
    if (std::fabs(vol) < 1e-12) return kNull;  // degenerate volume -> honest defer
    // solidFromShell already oriented the solid to positive (outward) volume.

    (void)nLip;
    return solid;
}

}  // namespace occtoffset
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
