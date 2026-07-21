// forge/NativeOcctBridge.cpp — native→OCCT fallback bridge (see header).

#include "forge/NativeOcctBridge.hpp"

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/Topology.hpp"        // Solid / Shell / Face / Loop / Coedge / Vertex
#include "forge/native/brep/Surface.hpp"         // SurfaceKind
#include "forge/native/brep/SolidTessellate.hpp" // tessellateSolid (faceted fallback)

#include <gp_Pnt.hxx>
#include <gp_Pln.hxx>
#include <gp_Dir.hxx>
#include <gp_XYZ.hxx>
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
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>

#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <unordered_map>
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
