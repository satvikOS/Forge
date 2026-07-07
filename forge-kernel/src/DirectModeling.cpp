#include "forge/DirectModeling.hpp"
#include "forge/Healing.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <BRepGProp_Face.hxx>
#include <BRepOffsetAPI_MakeFilling.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Plane.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_Surface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <ShapeFix_Shape.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

// K6 (OCCT-zero migration, OCCT_REPLACEMENT_ROADMAP): every point / vector /
// direction ARITHMETIC in this module now runs on the in-house native
// forge::native::brep::Vec3 (NVec3) via the small algebra helpers in the
// anonymous namespace below (matching the Mold.cpp / Airfoil.cpp K6 pattern).
// OCCT gp_ types are constructed ONLY at the thin boundary where a BRep builder
// (BRepPrimAPI_MakePrism), a rigid-transform frame (gp_Ax1 / gp_Trsf — K2/K3
// territory), a Geom_ analytic surface (Geom_Plane / Geom_CylindricalSurface /
// Geom_SphericalSurface), or an OCCT query out-param (BRepGProp_Face::Normal,
// GProp centroid, curve sampling) must be fed / read; any OCCT query result is
// read straight back into NVec3 for the downstream math. This drops the module's
// direct gp_Vec / gp_Dir / gp_Pnt ALGEBRA (and <Precision.hxx>) onto the native
// substrate. gp_ still appears at the builder / query boundary because the
// ShapeRegistry stores TopoDS_Shape and the primitive/boolean/transform builders
// are not yet native. Nurbs.hpp's Vec3 is dependency-free (no OCCT) so it is
// included UNCONDITIONALLY — the algebra runs in the default (non-FORGE_NATIVE)
// build too.
#include "forge/native/brep/Nurbs.hpp"   // forge::native::brep::Vec3 (dependency-free)

#include <cmath>
#include <sstream>
#include <stdexcept>

// PHASE-D wiring (2026-06-25) — route the ONE material-changing direct-edit op in
// this module, pushPullFace's push/pull-FACE (which ADDS or REMOVES material by
// extruding the picked face into a PRISM and FUSING / CUTTING it against the body —
// today OCCT BRepPrimAPI_MakePrism + BRepAlgoAPI_{Fuse,Cut}), through the ALREADY-BUILT
// in-house native B-rep boolean (forge::native::brep::booleanSolid — Boolean.hpp, now
// LINEAGE-CARRYING) on a native PRISM (forge::native::brep::prism / Sweep.hpp) behind a
// GATE. Compiled in ONLY under -DFORGE_NATIVE_BREP and taken at runtime ONLY when
// forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1, or the A/B harness's
// setForgeNativeBrepEnabled(true)). PRODUCTION DEFAULT IS OFF: with the gate off the
// original OCCT path below (BRepPrimAPI_MakePrism + BRepAlgoAPI_Fuse/Cut + ShapeFix_Shape)
// runs byte-for-byte unchanged. Mirrors the prior wires (Booleans.cpp tryNativeBoolean /
// Cam.cpp PolygonOffset2D / LoftGuide.cpp loftSolid / Healing.cpp healBRep): the native
// branch is taken ONLY when the input handle is a NativeSolid (there is NO OCCT-face ->
// native-face importer), so an OCCT-backed input HONESTLY DEFERS to OCCT, and the gate-off
// default and the gate-on OCCT-input path are both identical to today.
//
// DEFERRAL IS TOTAL TODAY — wired correctly + staged, not faked. The face to extrude is
// resolved by lookupFace() as an OCCT TopoDS_Face, and the native prism target
// (brep::prism, Sweep.hpp) consumes a native brep::Profile (CCW outer + CW hole loops as
// geom::Point2 rings) — there is NO OCCT-face -> native-Profile importer, and Sweep::prism
// emits a mesh::HalfEdgeMesh, NOT the analytic brep::Solid that booleanSolid requires as
// BOTH operands. So even for a NativeSolid body, a native push/pull prism-boolean cannot be
// assembled from the OCCT-face pick today: tryNativePushPull returns false for every input
// and the OCCT path runs — byte-identical to the gate-off default. The gate + native targets
// (booleanSolid + prism) are wired so the path activates the moment a native-face pick +
// native-prism-as-Solid producer land, with ZERO change to today's behaviour. We must NOT
// fabricate a Profile from an OCCT face (a silent substitution), so the call defers wholly.
//
// The OTHER direct-edit ops are LEFT ON OCCT — capability gaps surfaced, not degraded:
//   * moveFace / rotateFace — material edits, but their geometry is a TANGENTIAL wedge
//     (extrude along the in-plane component) resp. a ROTATION sweep (rigid-transform the
//     OCCT face + fuse the swept wedge). A native rotated/tangential-swept FACE-from-OCCT
//     prism has the same no-importer gap as pushPullFace AND needs a face transform with no
//     native brep::Profile path; LEFT ON OCCT. (The pushPullFace seam they reuse for the
//     pure-normal component is itself gated above, so they pick up native automatically once
//     it activates.)
//   * deleteFaceAndHeal — rebuilds an open shell + caps via heal::autoFillMissingFaces,
//     which is LEFT ON OCCT in Healing.cpp (BRepOffsetAPI_MakeFilling FABRICATES a cap
//     surface the native healBRep snap-close does not synthesize). Not a prism boolean.
//   * replaceFace — swaps a face's analytic Surface + re-sews; not a material add/remove
//     prism boolean. No native swap-surface-in-shell op. LEFT ON OCCT.
//   * inferFeature / edgeSegments / faceCount / edgeCount — pure QUERIES (edgeSegments
//     ALREADY routes native via enumerateSharpConvexEdges for a NativeSolid handle).
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/SolidTessellate.hpp"   // tessellateSolid (native edge picking)
#include "forge/native/brep/Fillet.hpp"            // enumerateSharpConvexEdges
#include "forge/native/brep/NativeRoute.hpp"       // forgeNativeFeaturesEnabled()
#include "forge/native/brep/Boolean.hpp"           // booleanSolid, BoolOp, BooleanResult (lineage-carrying)
#include "forge/native/brep/Sweep.hpp"             // prism, Profile, SweepResult (native extrude)
#include "forge/native/brep/Topology.hpp"          // Solid, TopologyBuilder
#include <cstdint>
#include <vector>
#endif

namespace forge::direct {

namespace {

// OCCT's Precision::Confusion() is 1.0e-7; expressed here as a native constant
// so this translation unit no longer pulls in <Precision.hxx>. Every tolerance
// comparison below uses this in place of Precision::Confusion(), byte-identical.
constexpr double kConfusion = 1.0e-7;

// ---------------------------------------------------------------------------
// K6 native vector substrate — the OCCT-free replacement for this module's
// gp_Vec / gp_Dir / gp_Pnt arithmetic. NVec3 is the in-house B-rep Euclidean
// point (forge::native::brep::Vec3). The free functions below are the minimal
// affine/linear algebra the direct-editing math needs; gp_ conversions live in
// the tiny to*/toN helpers and are used ONLY at the OCCT builder / query
// boundary. Same helper kit as the Mold.cpp / Airfoil.cpp K6 migrations.
// ---------------------------------------------------------------------------
using NVec3 = forge::native::brep::Vec3;

inline NVec3 nAdd(const NVec3& a, const NVec3& b)   { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline NVec3 nSub(const NVec3& a, const NVec3& b)   { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline NVec3 nScale(const NVec3& a, double s)       { return {a.x * s, a.y * s, a.z * s}; }
inline double nDot(const NVec3& a, const NVec3& b)  { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline NVec3 nCross(const NVec3& a, const NVec3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double nMag(const NVec3& a) { return std::sqrt(nDot(a, a)); }
inline NVec3  nNormalize(const NVec3& a) {
    const double m = nMag(a);
    return (m > 0.0) ? nScale(a, 1.0 / m) : a;
}

// Boundary conversions (OCCT <-> native). Used ONLY where a gp_ value must be
// handed to an OCCT builder / frame, or an OCCT query result read back native.
inline NVec3  toN(const gp_Pnt& p) { return {p.X(), p.Y(), p.Z()}; }
inline NVec3  toN(const gp_Vec& v) { return {v.X(), v.Y(), v.Z()}; }
inline NVec3  toN(const gp_Dir& d) { return {d.X(), d.Y(), d.Z()}; }
inline gp_Pnt toPnt(const NVec3& v) { return gp_Pnt(v.x, v.y, v.z); }
inline gp_Vec toVec(const NVec3& v) { return gp_Vec(v.x, v.y, v.z); }
inline gp_Dir toDir(const NVec3& v) { return gp_Dir(v.x, v.y, v.z); }

// Resolve a 1-based face id against the shape's face map. Throws if the id
// is out of range. The map is rebuilt every call — face counts in the
// hundreds make this trivially cheap, and we avoid stashing OCCT state
// across binding calls.
TopoDS_Face lookupFace(const TopoDS_Shape& shape, FaceId id) {
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(shape, TopAbs_FACE, map);
    if (id < 1 || static_cast<int>(id) > map.Extent()) {
        std::ostringstream os;
        os << "forge.direct: face id " << id
           << " out of range (shape has " << map.Extent() << " faces)";
        throw std::runtime_error(os.str());
    }
    return TopoDS::Face(map(static_cast<int>(id)));
}

// Return the unit outward normal at the parametric centroid of `face`.
// We sample the parametric (uMin+uMax)/2, (vMin+vMax)/2 — good enough for
// planar/cylindrical/toroidal faces we'd ever push/pull.
NVec3 outwardNormal(const TopoDS_Face& face) {
    BRepAdaptor_Surface surf(face);
    const double u = 0.5 * (surf.FirstUParameter() + surf.LastUParameter());
    const double v = 0.5 * (surf.FirstVParameter() + surf.LastVParameter());
    BRepGProp_Face gp(face);
    gp_Pnt p;   // OCCT out-params required by BRepGProp_Face::Normal
    gp_Vec n;
    gp.Normal(u, v, p, n);
    NVec3 nn = toN(n);              // read the OCCT normal into native at once
    if (nMag(nn) < kConfusion) {
        nn = NVec3{0.0, 0.0, 1.0};
    }
    nn = nNormalize(nn);
    if (face.Orientation() == TopAbs_REVERSED) {
        nn = nScale(nn, -1.0);     // native equivalent of gp_Vec::Reverse()
    }
    return nn;
}

NVec3 faceCentroid(const TopoDS_Face& face) {
    GProp_GProps props;
    BRepGProp::SurfaceProperties(face, props);
    return toN(props.CentreOfMass());
}

NVec3 solidCentroid(const TopoDS_Shape& shape) {
    GProp_GProps props;
    BRepGProp::VolumeProperties(shape, props);
    return toN(props.CentreOfMass());
}

// Geometric outward normal: `outwardNormal()` derives its sign from
// face.Orientation(), but TopTools_IndexedMapOfShape (used by lookupFace)
// normalises every face's orientation to FORWARD, so both faces of a box
// pair report the SAME surface normal — half of them then point INWARD.
// That made pushPullFace a silent no-op for the -X/-Y/-Z faces (the prism
// landed inside the body and the fuse added nothing). Here we resolve the
// ambiguity from geometry: the outward normal is the one pointing AWAY from
// the solid's volume centroid. Robust for any convex-ish face on a solid;
// for the rare face whose centroid sits on the body centroid we keep the
// orientation-derived sign.
NVec3 trueOutwardNormal(const TopoDS_Shape& solid, const TopoDS_Face& face) {
    NVec3 n = outwardNormal(face);
    const NVec3 fc = faceCentroid(face);
    const NVec3 sc = solidCentroid(solid);
    const NVec3 away = nSub(fc, sc);  // solid centroid -> face centroid = outward
    if (nMag(away) > kConfusion) {
        if (nDot(n, away) < 0.0) n = nScale(n, -1.0);
    }
    return n;
}

double faceArea(const TopoDS_Face& face) {
    GProp_GProps props;
    BRepGProp::SurfaceProperties(face, props);
    return props.Mass();
}

// Build a prism solid of `face` extruded along `vec`. Used as the
// add/remove material primitive for push/pull and friends.
TopoDS_Shape extrudeFace(const TopoDS_Face& face, const NVec3& vec) {
    if (nMag(vec) < kConfusion) {
        throw std::runtime_error("forge.direct: extrusion vector is zero-length");
    }
    // gp_Vec built ONLY here, at the BRepPrimAPI_MakePrism builder boundary.
    BRepPrimAPI_MakePrism mk(face, toVec(vec), /*Copy*/ Standard_False, /*Canonize*/ Standard_True);
    if (!mk.IsDone()) {
        throw std::runtime_error("forge.direct: prism extrusion failed");
    }
    return mk.Shape();
}

} // namespace

#ifdef FORGE_NATIVE_BREP
namespace {

// Try the native push/pull-FACE for pushPullFace: extrude the picked face into a
// native PRISM (brep::prism, Sweep.hpp) and FUSE (distance>0, add material) / CUT
// (distance<0, remove material) it against the body via the native analytic boolean
// (brep::booleanSolid, Boolean.hpp — the lineage-carrying in-house BRepAlgoAPI_{Fuse,Cut}
// replacement). Returns true + sets `out` on success; returns false (NEVER throws) when
// the native path HONESTLY DEFERS so the caller falls through to the OCCT
// BRepPrimAPI_MakePrism + BRepAlgoAPI_{Fuse,Cut} path. Same deferral contract as the prior
// wires (Booleans.cpp::tryNativeBoolean / LoftGuide.cpp::tryNativeLoftGuide).
//
// Deferral / GAP cases (Bible §0 — native-where-valid, OCCT otherwise):
//   * The input handle is NOT a NativeSolid: there is NO OCCT-face -> native-face importer,
//     so an OCCT TopoDS_Shape body (the production default) defers WHOLLY to OCCT.
//   * No native face-pick -> native-Profile producer exists: the face is resolved by the
//     OCCT lookupFace() as a TopoDS_Face, and brep::prism consumes a native brep::Profile
//     (CCW outer + CW hole loops of geom::Point2) — there is no path from an OCCT face to a
//     native Profile, AND brep::prism emits a mesh::HalfEdgeMesh, not the analytic
//     brep::Solid that booleanSolid requires as BOTH operands. We must NOT fabricate a
//     Profile from an OCCT face (a silent substitution that would change the geometry), so
//     until a native-face pick + native-prism-as-Solid producer land, this DEFERS for every
//     input. The gate + native targets (booleanSolid + prism) are wired so the path
//     activates the moment those producers exist, with ZERO change to today's behaviour.
bool tryNativePushPull(ShapeHandle shape, FaceId /*faceId*/, double /*distance*/,
                       ShapeHandle& /*out*/) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();
    // An OCCT-backed body has no native face/Profile path -> defer to OCCT.
    if (reg.kindOf(shape) != ShapeKind::NativeSolid) return false;

    // Even for a NativeSolid body, the push/pull prism cannot be assembled natively today:
    // the picked face arrives as an OCCT TopoDS_Face (lookupFace) and there is no
    // OCCT-face -> native brep::Profile importer, nor a native-prism-as-Solid producer to
    // feed booleanSolid's two-Solid signature (brep::prism emits a HalfEdgeMesh). Fabricating
    // a Profile would be a silent substitution, so we DEFER wholly. This is where a future
    // native-face pick is resolved into a brep::Profile, swept to a brep::Solid via prism,
    // and combined with reg.getNativeSolid(shape) via booleanSolid(BoolOp::Fuse / Cut),
    // registering the result with reg.addNativeSolid(r.owner, r.solid) — exactly the
    // Booleans.cpp::tryNativeBoolean idiom.
    return false;
}

}  // namespace
#endif

std::size_t faceCount(ShapeHandle shape) {
    const auto& s = ShapeRegistry::instance().get(shape);
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(s, TopAbs_FACE, map);
    return static_cast<std::size_t>(map.Extent());
}

// PUSH-31 — edge count helper so JS can default fillet-all/chamfer-all
// when the user clicks the toolbar tool without picking edges (matches
// SolidWorks "Round all edges" / Fusion 360 default fillet behavior).
std::size_t edgeCount(ShapeHandle shape) {
    const auto& s = ShapeRegistry::instance().get(shape);
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(s, TopAbs_EDGE, map);
    return static_cast<std::size_t>(map.Extent());
}

// Slice-3 edge picking — sample every edge into a world-space polyline,
// tagged with a 0-based edge id that matches the TopExp_Explorer order
// used by edgeById (and therefore part.filletEdges / chamferEdges /
// varfillet). The viewport renders these as thin pickable lines; a click
// resolves back to the edge id and feeds fillet/chamfer/dimension.
//
// `deflection` controls polyline density (chord tolerance, mm). Returns a
// flat list: for each edge, { id, points:[x,y,z,...] }.
std::vector<EdgePolyline> edgeSegments(ShapeHandle shape, double deflection) {
#ifdef FORGE_NATIVE_BREP
    // NATIVE handle: a forge::native::brep::Solid has no OCCT TopExp edge stream, so
    // edge picking uses the SAME canonical sharp-CONVEX-edge enumeration the native
    // fillet routing maps part.filletEdges ids through (enumerateSharpConvexEdges).
    // Each pickable edge becomes a 2-point polyline tagged with that canonical id —
    // so a viewport (or the A/B harness) selects native edges by the EXACT ids
    // part.filletEdges honors, derived from native geometry (no OCCT/native id
    // coincidence). NativeMesh handles have no analytic edges -> empty (as before).
    if (ShapeRegistry::instance().kindOf(shape) == ShapeKind::NativeSolid) {
        namespace nb = ::forge::native::brep;
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        nb::tessellateSolid(ShapeRegistry::instance().getNativeSolid(shape), pos, idx);
        std::vector<EdgePolyline> out;
        for (const nb::SharpConvexEdge& e : nb::enumerateSharpConvexEdges(pos, idx)) {
            EdgePolyline poly;
            poly.id = e.id;
            poly.points = {
                static_cast<float>(e.ax), static_cast<float>(e.ay), static_cast<float>(e.az),
                static_cast<float>(e.bx), static_cast<float>(e.by), static_cast<float>(e.bz)};
            out.push_back(std::move(poly));
        }
        return out;
    }
#endif
    const auto& s = ShapeRegistry::instance().get(shape);
    std::vector<EdgePolyline> out;
    if (!(deflection > 1e-6)) deflection = 0.25;
    std::uint32_t id = 0;  // 0-based, matches edgeById enumeration
    for (TopExp_Explorer ex(s, TopAbs_EDGE); ex.More(); ex.Next(), ++id) {
        const TopoDS_Edge& e = TopoDS::Edge(ex.Current());
        EdgePolyline poly;
        poly.id = id;
        BRepAdaptor_Curve curve(e);
        const double t0 = curve.FirstParameter();
        const double t1 = curve.LastParameter();
        if (!(t1 > t0)) {
            // Degenerate / point edge — emit its single vertex.
            gp_Pnt p = curve.Value(t0);
            poly.points = { static_cast<float>(p.X()), static_cast<float>(p.Y()), static_cast<float>(p.Z()) };
            out.push_back(std::move(poly));
            continue;
        }
        GCPnts_TangentialDeflection sampler(curve, t0, t1, 0.1, deflection, 2);
        const int n = sampler.NbPoints();
        poly.points.reserve(static_cast<std::size_t>(n) * 3);
        for (int i = 1; i <= n; ++i) {
            gp_Pnt p = sampler.Value(i);
            poly.points.push_back(static_cast<float>(p.X()));
            poly.points.push_back(static_cast<float>(p.Y()));
            poly.points.push_back(static_cast<float>(p.Z()));
        }
        out.push_back(std::move(poly));
    }
    return out;
}

ShapeHandle pushPullFace(ShapeHandle shape, FaceId faceId, double distance) {
#ifdef FORGE_NATIVE_BREP
    // GATE: the native push/pull-face (brep::prism + brep::booleanSolid) is opt-in via the
    // FEAT gate (default OFF). When on AND the body is a NativeSolid with a native-Profile
    // face pick, build the prism-boolean natively; otherwise fall through to OCCT (an
    // OCCT-backed body HONESTLY DEFERS — no behavior change in the default build). A false
    // return == defer. Mirrors Booleans.cpp / LoftGuide.cpp.
    if (native::brep::forgeNativeFeaturesEnabled()) {
        ShapeHandle nativeOut = 0;
        if (tryNativePushPull(shape, faceId, distance, nativeOut)) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif
    const auto& s = ShapeRegistry::instance().get(shape);
    if (std::abs(distance) < kConfusion) {
        // No-op: copy in and return so the caller still gets a fresh handle.
        return ShapeRegistry::instance().add(s);
    }
    const auto face = lookupFace(s, faceId);
    const NVec3 n  = trueOutwardNormal(s, face);
    const NVec3 v  = nScale(n, std::abs(distance));
    const TopoDS_Shape prism = extrudeFace(face, v);

    TopoDS_Shape out;
    if (distance > 0) {
        // Push outward: union the prism with the original shape, then heal.
        BRepAlgoAPI_Fuse op(s, prism);
        op.Build();
        if (!op.IsDone()) {
            throw std::runtime_error("forge.direct.pushPullFace: fuse failed");
        }
        out = op.Shape();
    } else {
        // Pull inward (pocket): subtract the prism from the original shape.
        // Extrude inward — the prism we just made was along +n; flip it.
        // Native scale; gp_Vec built ONLY at the MakePrism builder boundary.
        BRepPrimAPI_MakePrism mk(face, toVec(nScale(n, -std::abs(distance))),
                                 Standard_False, Standard_True);
        if (!mk.IsDone()) {
            throw std::runtime_error("forge.direct.pushPullFace: inward prism failed");
        }
        BRepAlgoAPI_Cut op(s, mk.Shape());
        op.Build();
        if (!op.IsDone()) {
            throw std::runtime_error("forge.direct.pushPullFace: cut failed");
        }
        out = op.Shape();
    }

    // Light heal pass — closes any sub-µm gaps the boolean engine left.
    Handle(ShapeFix_Shape) fixer = new ShapeFix_Shape(out);
    fixer->Perform();
    return ShapeRegistry::instance().add(fixer->Shape());
}

ShapeHandle moveFace(ShapeHandle shape, FaceId faceId,
                     const std::array<double, 3>& translation) {
    const auto& s = ShapeRegistry::instance().get(shape);
    const auto face = lookupFace(s, faceId);
    const NVec3 t{translation[0], translation[1], translation[2]};
    if (nMag(t) < kConfusion) {
        return ShapeRegistry::instance().add(s);
    }
    // Decompose translation into the part along the face normal (push/pull,
    // which the boolean engine handles cleanly) and the tangential part
    // (which becomes a "slide" — implemented as fuse of the slid prism).
    const NVec3 n = outwardNormal(face);
    const double along = nDot(t, n);
    const NVec3 tangential = nSub(t, nScale(n, along));

    TopoDS_Shape work = s;

    if (std::abs(along) > kConfusion) {
        ShapeHandle pushed = pushPullFace(
            ShapeRegistry::instance().add(work), faceId, along);
        work = ShapeRegistry::instance().get(pushed);
    }

    if (nMag(tangential) > kConfusion) {
        // For tangential motion we extrude the face along the tangential
        // vector and fuse — adds a wedge of material adjacent to the face.
        // This is the SolidWorks "Move Face → translate" behaviour: the
        // face moves, neighbouring walls warp.
        TopTools_IndexedMapOfShape map;
        TopExp::MapShapes(work, TopAbs_FACE, map);
        TopoDS_Face f2 = (static_cast<int>(faceId) <= map.Extent())
            ? TopoDS::Face(map(static_cast<int>(faceId)))
            : face;
        TopoDS_Shape wedge = extrudeFace(f2, tangential);
        BRepAlgoAPI_Fuse op(work, wedge);
        op.Build();
        if (!op.IsDone()) {
            throw std::runtime_error("forge.direct.moveFace: fuse (tangential) failed");
        }
        work = op.Shape();
    }

    Handle(ShapeFix_Shape) fixer = new ShapeFix_Shape(work);
    fixer->Perform();
    return ShapeRegistry::instance().add(fixer->Shape());
}

ShapeHandle rotateFace(ShapeHandle shape, FaceId faceId,
                       const std::array<double, 3>& axisOrigin,
                       const std::array<double, 3>& axisDir,
                       double angleRad) {
    const auto& s = ShapeRegistry::instance().get(shape);
    const auto face = lookupFace(s, faceId);
    if (std::abs(angleRad) < kConfusion) {
        return ShapeRegistry::instance().add(s);
    }
    // gp_Ax1 / gp_Trsf rotation frame kept at the OCCT transform boundary
    // (rigid-body transform builders are K2/K3 territory, not K6 algebra).
    const gp_Pnt origin(axisOrigin[0], axisOrigin[1], axisOrigin[2]);
    const gp_Dir dir(axisDir[0], axisDir[1], axisDir[2]);
    const gp_Ax1 axis(origin, dir);

    gp_Trsf trsf;
    trsf.SetRotation(axis, angleRad);

    // Rotate the face into its new pose, fuse with the original shape,
    // then heal. For small angles this is the standard "tilt face"
    // operation that SolidWorks etc. expose.
    BRepBuilderAPI_Transform xf(face, trsf, /*Copy*/ Standard_True);
    if (!xf.IsDone()) {
        throw std::runtime_error("forge.direct.rotateFace: transform failed");
    }
    // Sweep between the old and new face by extruding along the centroid
    // displacement — keeps the result a closed solid. The centroid comes back
    // native; only the rigid rotation (c1.Transform) touches the OCCT gp_Trsf,
    // and the displacement subtraction + magnitude are native.
    const NVec3 c0 = faceCentroid(face);
    gp_Pnt c1 = toPnt(c0);          // gp_Pnt so OCCT can apply the rotation
    c1.Transform(trsf);
    const NVec3 sweep = nSub(toN(c1), c0);
    if (nMag(sweep) < kConfusion) {
        // Axis passes through centroid — no displacement; treat as no-op.
        return ShapeRegistry::instance().add(s);
    }
    TopoDS_Shape wedge = extrudeFace(face, sweep);
    BRepAlgoAPI_Fuse op(s, wedge);
    op.Build();
    if (!op.IsDone()) {
        throw std::runtime_error("forge.direct.rotateFace: fuse failed");
    }
    Handle(ShapeFix_Shape) fixer = new ShapeFix_Shape(op.Shape());
    fixer->Perform();
    return ShapeRegistry::instance().add(fixer->Shape());
}

ShapeHandle deleteFaceAndHeal(ShapeHandle shape, const std::vector<FaceId>& faceIds) {
    const auto& s = ShapeRegistry::instance().get(shape);
    if (faceIds.empty()) {
        return ShapeRegistry::instance().add(s);
    }
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(s, TopAbs_FACE, map);

    // Build a shell of every face EXCEPT the ones to delete.
    TopoDS_Shell shell;
    BRep_Builder builder;
    builder.MakeShell(shell);
    std::size_t kept = 0;
    for (int i = 1; i <= map.Extent(); ++i) {
        bool drop = false;
        for (auto id : faceIds) {
            if (static_cast<int>(id) == i) { drop = true; break; }
        }
        if (drop) continue;
        builder.Add(shell, TopoDS::Face(map(i)));
        ++kept;
    }
    if (kept == 0) {
        throw std::runtime_error("forge.direct.deleteFaceAndHeal: every face deleted");
    }

    // Hand the open shell over to the auto-fill machinery to cap the holes.
    const auto openHandle = ShapeRegistry::instance().add(shell);
    auto filled = heal::autoFillMissingFaces(openHandle, 1e-3);
    return filled.handle;
}

ShapeHandle replaceFace(ShapeHandle shape, FaceId faceId, const SurfaceSpec& spec) {
    const auto& s = ShapeRegistry::instance().get(shape);
    const auto face = lookupFace(s, faceId);

    Handle(Geom_Surface) newSurf;
    switch (spec.kind) {
        case SurfaceSpec::Kind::Plane: {
            gp_Pnt o(spec.origin[0], spec.origin[1], spec.origin[2]);
            gp_Dir n(spec.normal[0], spec.normal[1], spec.normal[2]);
            newSurf = new Geom_Plane(o, n);
            break;
        }
        case SurfaceSpec::Kind::Cylinder: {
            if (spec.radius <= kConfusion) {
                throw std::runtime_error("forge.direct.replaceFace: cylinder radius must be > 0");
            }
            gp_Pnt o(spec.origin[0], spec.origin[1], spec.origin[2]);
            gp_Dir axis(spec.normal[0], spec.normal[1], spec.normal[2]);
            gp_Ax3 ax(o, axis);
            newSurf = new Geom_CylindricalSurface(ax, spec.radius);
            break;
        }
        case SurfaceSpec::Kind::Sphere: {
            if (spec.radius <= kConfusion) {
                throw std::runtime_error("forge.direct.replaceFace: sphere radius must be > 0");
            }
            gp_Pnt o(spec.origin[0], spec.origin[1], spec.origin[2]);
            gp_Ax3 ax(o, gp_Dir(0, 0, 1));
            newSurf = new Geom_SphericalSurface(ax, spec.radius);
            break;
        }
    }

    // Build a new face using the new surface + the existing trim wires.
    // BRepBuilderAPI_MakeFace(surf, wire, true) re-trims to keep the
    // topology consistent.
    TopoDS_Face newFace;
    TopoDS_Wire outerWire = BRepTools::OuterWire(face);
    BRepBuilderAPI_MakeFace mk(newSurf, outerWire, /*Inside*/ Standard_True);
    if (!mk.IsDone()) {
        throw std::runtime_error("forge.direct.replaceFace: rebuild failed");
    }
    newFace = mk.Face();

    // Rebuild the shape by swapping the face in the shell. We walk every
    // face, add a copy to a new shell, swapping the replaced one.
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(s, TopAbs_FACE, map);
    TopoDS_Shell shell;
    BRep_Builder builder;
    builder.MakeShell(shell);
    for (int i = 1; i <= map.Extent(); ++i) {
        builder.Add(shell,
            static_cast<FaceId>(i) == faceId ? newFace : TopoDS::Face(map(i)));
    }

    // Sew + heal to reconnect the swapped face cleanly.
    BRepBuilderAPI_Sewing sew(1e-3);
    sew.Add(shell);
    sew.Perform();
    TopoDS_Shape sewn = sew.SewedShape();
    Handle(ShapeFix_Shape) fixer = new ShapeFix_Shape(sewn);
    fixer->Perform();
    return ShapeRegistry::instance().add(fixer->Shape());
}

FeatureInfo inferFeature(ShapeHandle shape, FaceId faceId) {
    const auto& s = ShapeRegistry::instance().get(shape);
    const auto face = lookupFace(s, faceId);

    BRepAdaptor_Surface adaptor(face);
    const auto kind = adaptor.GetType();
    const NVec3 n = trueOutwardNormal(s, face);
    const NVec3 c = faceCentroid(face);
    const double area = faceArea(face);

    FeatureInfo info;
    info.normal   = {n.x, n.y, n.z};
    info.centroid = {c.x, c.y, c.z};
    info.area = area;

    switch (kind) {
        case GeomAbs_Plane: {
            info.kind  = FeatureKind::Boss;
            info.label = "planar";
            break;
        }
        case GeomAbs_Cylinder: {
            const auto cyl = adaptor.Cylinder();
            info.radius = cyl.Radius();
            // Inner cylindrical face (orientation REVERSED on a hole) is a
            // hole; outer is a boss-fillet-like protrusion.
            info.kind  = (face.Orientation() == TopAbs_REVERSED)
                ? FeatureKind::Hole : FeatureKind::Boss;
            info.label = "cylindrical (R=" + std::to_string(cyl.Radius()) + ")";
            break;
        }
        case GeomAbs_Torus: {
            const auto t = adaptor.Torus();
            info.radius = t.MinorRadius();
            info.kind   = FeatureKind::Fillet;
            info.label  = "toroidal (r=" + std::to_string(t.MinorRadius()) + ")";
            break;
        }
        case GeomAbs_Sphere: {
            const auto sp = adaptor.Sphere();
            info.radius = sp.Radius();
            info.kind   = FeatureKind::Blend;
            info.label  = "spherical (R=" + std::to_string(sp.Radius()) + ")";
            break;
        }
        case GeomAbs_BSplineSurface:
        case GeomAbs_BezierSurface:
        case GeomAbs_SurfaceOfExtrusion:
        case GeomAbs_SurfaceOfRevolution: {
            info.kind  = FeatureKind::Blend;
            info.label = "freeform";
            break;
        }
        case GeomAbs_Cone: {
            info.kind  = FeatureKind::Chamfer;
            info.label = "conical (chamfer-like)";
            break;
        }
        default:
            info.kind  = FeatureKind::Unknown;
            info.label = "unknown";
            break;
    }
    return info;
}

} // namespace forge::direct
