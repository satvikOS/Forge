// Forge-36 — NURBS surface authoring on OCCT.
//
// The kernel-side machinery for §1's "Surface modeling (NURBS authoring)"
// row of PARITY.md. Every function below routes through OCCT's
// Geom_BSplineSurface + BRep wrappers and registers its result in the
// global ShapeRegistry so JS callers see uint32 handles only.
//
// Notes on the OCCT APIs used:
//   - Geom_BSplineSurface is constructed from a TColgp_Array2OfPnt grid
//     plus per-axis (knots, multiplicities, degree) descriptors. We build
//     uniform clamped knots by default so a 4x4 grid with cubic degree
//     gives a single Bezier-equivalent patch.
//   - BRepBuilderAPI_MakeFace(surface) wraps the BSpline in a TopoDS_Face;
//     the (face, wire) overload re-trims it to a UV loop.
//   - BRepBuilderAPI_Sewing sews a heterogeneous bag of faces into a
//     TopoDS_Shell; we never call MakeSolid because NURBS patches need
//     not be closed.
//   - GeomLProp_SLProps evaluates curvature on a Geom_Surface; we drive
//     it via BRepAdaptor_Surface so trim ranges are respected.
//   - BRepAlgoAPI_Section intersects two shapes and returns the result as
//     a compound of edges — robust against analytic/free-form pairs.
//   - GeomAPI_ProjectPointOnSurf finds (u, v) of the closest point in
//     L^2 sense on the underlying Geom_Surface.
//   - ShapeUpgrade_ShapeDivideContinuity refines a face by upgrading
//     continuity, which OCCT implements via knot insertion / degree
//     elevation under the hood. For predictable degree increases we use
//     Geom_BSplineSurface::IncreaseDegree directly.

#include "forge/Nurbs.hpp"

#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <Geom2d_Line.hxx>
#include <GCE2d_MakeSegment.hxx>
#include <BRepLib.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <GeomLProp_SLProps.hxx>
#include <Precision.hxx>
#include <ShapeFix_Wire.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <stdexcept>

// PHASE-D wiring (2026-06-25) — wire #11, the TRIMMED-NURBS KEYSTONE. Route the genuine
// OCCT NURBS-surface ops in this module (surface point/derivative EVAL, TRIMMED-FACE
// build, SURFACE-SURFACE INTERSECTION (SSI), point PROJECTION/QUERY, Class-A curvature
// QUERY) through the ALREADY-BUILT in-house native NURBS family behind a GATE. Compiled
// in ONLY under -DFORGE_NATIVE_BREP and taken at runtime ONLY when the FEAT gate
// forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1, or the A/B harness's
// setForgeNativeBrepEnabled(true), which flips CORE+FEAT+STEP together). PRODUCTION
// DEFAULT IS OFF: with the gate off, the original OCCT paths below run byte-for-byte
// unchanged. Mirrors the 10 prior merged wires (CamAdvanced.cpp generateCmm /
// Drawings.cpp projectShape / Fea.cpp / LoftGuide.cpp loft / Cam.cpp inwardOffset /
// Healing.cpp healBRep+sewFaces): each tryNativeNurbs* takes the native branch ONLY when
// the input is ALREADY native; an OCCT-backed input HONESTLY DEFERS to OCCT.
//
// The native NURBS targets ALL EXIST and map 1:1 to the OCCT ops here:
//   * evalSurface (point + dS/du, dS/dv + unit normal)  -> brep::evaluateWithDerivatives
//                                                          (NurbsSurface.hpp), the analytic
//                                                          rational quotient-rule evaluator.
//   * trimNurbsFace (build a face bounded by (u,v) loops) -> brep::TrimmedFace /
//                                                          tessellateTrimmedFace
//                                                          (TrimmedFace.hpp) — THE keystone:
//                                                          arbitrary rational B-spline surface
//                                                          bounded by N trim loops.
//   * intersectSurfaces (SSI)                            -> brep::intersectNurbsSurfaces +
//                                                          promoteToNurbs
//                                                          (NurbsSurfaceIntersect.hpp), the
//                                                          P&T/Patrikalakis-Maekawa marcher.
//                                                          NAMED + compile-checked but LEFT
//                                                          OCCT (no native edge/wire result
//                                                          handle kind — see below).
//   * projectPointToSurface (point projection/query)     -> a Newton closest-point on the
//                                                          native rational surface
//                                                          (brep::evaluateWithDerivatives
//                                                          partials), NurbsSurface.hpp.
//   * classAAnalyse (curvature query)                    -> brep::surfaceCurvature
//                                                          (NurbsAlgebra.hpp) 1st/2nd
//                                                          fundamental-form Gauss/mean.
//
// DEFERRAL IS TOTAL TODAY — and that is the HONEST, byte-identical state, NOT a gap in
// the native targets (they are built + gate-tested). The blocker is the SAME one the
// LoftGuide.cpp / Healing.cpp / CamAdvanced.cpp wires hit: every op here takes a
// ShapeHandle that resolves (via fetch()/firstFaceOf()) to an OCCT TopoDS_Face, and the
// ShapeRegistry has ONLY Kind::Occt / NativeSolid (brep::Solid) / NativeMesh
// (mesh::HalfEdgeMesh) — there is NO native NurbsSurface / TrimmedFace handle kind, and
// NO OCCT-face -> native-NurbsSurface importer. A NativeSolid face carries an analytic
// brep::Surface (Plane/Cylinder/Sphere/Cone/Torus), NOT the trimmed RATIONAL B-spline
// surface these ops need. We must NOT fabricate a NurbsSurface from an OCCT
// Geom_BSplineSurface (that would be a silent OCCT->native importer this slice does not
// own, and the surfacing inputs are OCCT faces in every live path), so every
// tryNativeNurbs* returns false and the OCCT path runs — identical to the gate-off
// default. nativeSurfaceOf() is the SINGLE seam a future native-surface producer plugs
// into; today no handle is natively backed, so it returns false and all five helpers
// defer. The gate + native targets are wired so the path activates the moment a native
// NURBS-surface handle lands, with ZERO change to today's behaviour.
//
// buildNurbsPatch / sewNurbsFaces / refineNurbs / intersectSurfaces are LEFT OCCT-ONLY:
//   * buildNurbsPatch AUTHORS an OCCT Geom_BSplineSurface face from a raw control grid
//     and registers an OCCT handle. There is no native NURBS-surface registry KIND to
//     return, so a native author would have nowhere to land its result — it would force
//     an OCCT bridge on every downstream op. Authoring stays OCCT until a native
//     NurbsSurface handle kind exists (the documented follow-up that unblocks ALL five
//     ops above too). NOT a gap in the evaluator — purely the missing handle kind.
//   * sewNurbsFaces is BRepBuilderAPI_Sewing over face handles — the SAME sew already
//     wired natively in Healing.cpp::sewShape (brep::sewFaces). Re-wiring it here would
//     DUPLICATE that wire; it is intentionally left to the Healing.cpp seam (and equally
//     defers for OCCT face handles). NOT re-wired to avoid a duplicate.
//   * refineNurbs is Geom_BSplineSurface::IncreaseDegree (degree elevation). The native
//     suite's knot/degree refinement lives in NurbsCalculus.hpp for CURVES; there is no
//     native SURFACE degree-elevation entry in the brep/ suite yet, so refineNurbs is
//     LEFT ON OCCT — a real capability GAP, surfaced not silently degraded.
//   * intersectSurfaces is BRepAlgoAPI_Section. The native NURBS-aware SSI marcher
//     (brep::intersectNurbsSurfaces) EXISTS, but it returns ORDERED 3D POLYLINES PER
//     BRANCH (wire/edge geometry) and the ShapeRegistry has NO native edge/wire/curve
//     handle kind to return them into (only Occt/NativeSolid/NativeMesh). LEFT ON OCCT
//     for the missing RESULT-HANDLE kind — NOT a gap in the marcher. (Same blocker as
//     buildNurbsPatch; the target is #included so it is named + compile-checked.)
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"            // forgeNativeFeaturesEnabled()
#include "forge/native/brep/Nurbs.hpp"                  // NurbsSurface (native rational surface)
#include "forge/native/brep/NurbsSurface.hpp"           // validateSurface / evaluateWithDerivatives
#include "forge/native/brep/NurbsAlgebra.hpp"           // surfaceCurvature (Gauss/mean)
#include "forge/native/brep/TrimmedFace.hpp"            // TrimmedFace / tessellateTrimmedFace (keystone)
#include "forge/native/brep/NurbsSurfaceIntersect.hpp"  // intersectNurbsSurfaces / promoteToNurbs (SSI)
#include <optional>
#endif

namespace forge { namespace surfacing {

namespace {

const TopoDS_Shape& fetch(ShapeHandle h) {
    return ShapeRegistry::instance().get(h);
}

// Pick the first TopAbs_FACE child of a registered shape; throws if none.
// Accepts either a TopoDS_Face directly or any compound / shell / solid
// containing one (used so callers can pass a primitive like `makeSphere`).
TopoDS_Face firstFaceOf(const TopoDS_Shape& s, const char* what) {
    if (!s.IsNull() && s.ShapeType() == TopAbs_FACE) {
        return TopoDS::Face(s);
    }
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        return TopoDS::Face(ex.Current());
    }
    throw std::invalid_argument(std::string("forge.surfacing.") + what +
                                ": registered shape has no face");
}

// Lift a Handle(Geom_Surface) on a registered face. Throws if the face
// has no underlying surface (e.g. a vertex-only shape).
Handle(Geom_Surface) surfaceOf(const TopoDS_Face& f, const char* what) {
    Handle(Geom_Surface) s = BRep_Tool::Surface(f);
    if (s.IsNull()) {
        throw std::invalid_argument(std::string("forge.surfacing.") + what +
                                    ": face has no underlying surface");
    }
    return s;
}

// Lift a Handle(Geom_BSplineSurface) — throws if the face isn't a NURBS
// patch (e.g. it's an analytic plane / cylinder).
Handle(Geom_BSplineSurface) bsplineOf(const TopoDS_Face& f, const char* what) {
    Handle(Geom_Surface) s = surfaceOf(f, what);
    Handle(Geom_BSplineSurface) bs = Handle(Geom_BSplineSurface)::DownCast(s);
    if (bs.IsNull()) {
        throw std::invalid_argument(std::string("forge.surfacing.") + what +
                                    ": face is not a Geom_BSplineSurface");
    }
    return bs;
}

// Uniform clamped knot + multiplicity vectors for `count` control points
// and `degree`. Total knots = count + degree + 1; OCCT wants distinct
// knot values + per-knot multiplicities.
void buildUniformClampedKnots(std::uint32_t count, std::uint32_t degree,
                              std::vector<double>& knotsDistinct,
                              std::vector<std::uint32_t>& mults) {
    const std::uint32_t nInner = (count > degree) ? (count - degree - 1) : 0;
    knotsDistinct.clear();
    mults.clear();
    knotsDistinct.push_back(0.0);
    mults.push_back(degree + 1);
    for (std::uint32_t i = 1; i <= nInner; ++i) {
        knotsDistinct.push_back(static_cast<double>(i) / static_cast<double>(nInner + 1));
        mults.push_back(1);
    }
    knotsDistinct.push_back(1.0);
    mults.push_back(degree + 1);
}

}  // namespace

#ifdef FORGE_NATIVE_BREP
namespace {

// ---------------------------------------------------------------------------
// THE SINGLE DEFERRAL SEAM. Resolve a surfacing ShapeHandle to a NATIVE rational
// B-spline surface (forge::native::brep::NurbsSurface). Returns std::nullopt
// whenever the handle is NOT natively backed by a NURBS surface — which is the
// case for EVERY live input today, because:
//   * ShapeRegistry kinds are Occt / NativeSolid (brep::Solid) / NativeMesh
//     (mesh::HalfEdgeMesh) — there is NO native NurbsSurface / TrimmedFace handle
//     kind, and NO OCCT-face -> native-NurbsSurface importer.
//   * A NativeSolid face carries an ANALYTIC brep::Surface (Plane/Cylinder/Sphere/
//     Cone/Torus), NOT a trimmed rational B-spline surface, so it cannot yield the
//     NurbsSurface these ops require.
// We must NOT fabricate a NurbsSurface from an OCCT Geom_BSplineSurface (that would
// be a silent OCCT->native importer this slice does not own). So this returns
// nullopt for every input -> all five helpers below defer -> the OCCT paths run,
// byte-identical to the gate-off default. This is the ONE place a future native
// NURBS-surface handle producer plugs in; the moment it lands, every helper below
// activates with zero further change.
std::optional<forge::native::brep::NurbsSurface>
nativeSurfaceOf(ShapeHandle /*face*/) {
    // No native NURBS-surface handle kind in ShapeRegistry, and no OCCT-face ->
    // native-NurbsSurface importer -> never natively backed today -> defer.
    return std::nullopt;
}

// (1) evalSurface — native rational surface point + analytic partials + unit normal
// (brep::evaluateWithDerivatives). Returns true + fills `out` when the input is a
// native NURBS surface; returns false (NEVER throws) to DEFER to OCCT otherwise.
bool tryNativeEvalSurface(ShapeHandle face, double u, double v, SurfaceEval& out) {
    using namespace forge::native::brep;
    std::optional<NurbsSurface> ns = nativeSurfaceOf(face);
    if (!ns) return false;                                  // OCCT input -> defer
    const char* why = nullptr;
    if (!validateSurface(*ns, &why)) return false;          // malformed -> defer
    SurfaceSample s = evaluateWithDerivatives(*ns, u, v);
    if (!s.ok) return false;                                // degenerate -> defer

    out.point  = { s.point.x,  s.point.y,  s.point.z  };
    out.du     = { s.du.x,     s.du.y,     s.du.z     };
    out.dv     = { s.dv.x,     s.dv.y,     s.dv.z     };
    out.normal = { s.normal.x, s.normal.y, s.normal.z };
    // Native rational quotient-rule eval carries the first-order derivatives + unit
    // normal but not the 2nd-fundamental-form curvatures evaluateWithDerivatives
    // omits; surfaceCurvature (NurbsAlgebra.hpp) supplies them when this seam opens.
    SurfaceCurvature k = surfaceCurvature(*ns, u, v);
    // Mirror the OCCT path's fallback: when curvature is undefined (degenerate
    // tangent plane) the OCCT branch leaves gaussian/mean at 0 too.
    out.gaussian = k.ok ? k.gaussian : 0.0;
    out.mean     = k.ok ? k.mean     : 0.0;
    return true;
}

// (2) trimNurbsFace — THE KEYSTONE. Build a trimmed face from a native NURBS surface
// + the (u,v) trim loop (brep::TrimmedFace + tessellateTrimmedFace). Returns true +
// sets `out` to a NativeMesh handle of the trimmed region on success; returns false
// (NEVER throws) to DEFER to OCCT otherwise.
bool tryNativeTrimNurbsFace(ShapeHandle face, const std::vector<double>& trimUV,
                            ShapeHandle& out) {
    using namespace forge::native::brep;
    std::optional<NurbsSurface> ns = nativeSurfaceOf(face);
    if (!ns) return false;                                  // OCCT input -> defer
    const char* why = nullptr;
    if (!validateSurface(*ns, &why)) return false;          // malformed -> defer

    // Build the single outer trim loop from the (u,v) pairs as straight Line2 pcurve
    // segments (the same polygonal loop the OCCT path builds from trimUV). A native
    // TrimmedFace + tessellateTrimmedFace yields the watertight-at-the-trim mesh.
    TrimmedFace tf;
    tf.surface = *ns;
    TrimLoop loop;
    loop.isOuter = true;
    const std::size_t n = trimUV.size() / 2;
    for (std::size_t i = 0; i < n; ++i) {
        UVCoord a{ trimUV[2 * i],                 trimUV[2 * i + 1] };
        UVCoord b{ trimUV[2 * ((i + 1) % n)],     trimUV[2 * ((i + 1) % n) + 1] };
        loop.segments.push_back(PCurve::makeLine2(a, b));
    }
    tf.loops.push_back(std::move(loop));
    if (!tf.valid(&why)) return false;                      // bad loop -> defer

    TrimMesh m = tessellateTrimmedFace(tf);
    if (!m.ok || m.triangles.empty()) return false;         // degenerate -> defer

    // Pack the trimmed-region triangles into a flat soup for the HalfEdgeMesh.
    std::vector<double>        positions;
    std::vector<std::uint32_t> indices;
    positions.reserve(m.positions.size() * 3);
    for (const Vec3& p : m.positions) {
        positions.push_back(p.x); positions.push_back(p.y); positions.push_back(p.z);
    }
    indices.reserve(m.triangles.size() * 3);
    for (const auto& t : m.triangles) {
        indices.push_back(t[0]); indices.push_back(t[1]); indices.push_back(t[2]);
    }
    auto hm = std::make_shared<forge::native::mesh::HalfEdgeMesh>();
    if (!hm->buildFromSoup(positions, indices)) return false;  // non-manifold -> defer
    out = ShapeRegistry::instance().addNativeMesh(std::move(hm));
    return true;
}

// NOTE on intersectSurfaces (SSI): the native NURBS-aware marcher
// brep::intersectNurbsSurfaces (NurbsSurfaceIntersect.hpp) EXISTS and would map to the
// OCCT BRepAlgoAPI_Section here, but its result is an ORDERED 3D POLYLINE PER BRANCH (a
// wire/edge geometry), and the ShapeRegistry has NO native edge / wire / curve handle
// kind (only Occt / NativeSolid / NativeMesh). There is no honest native handle to
// return the section polyline into — fabricating a degenerate vertex-only / triangle
// NativeMesh would MISREPRESENT a wire as a mesh. So intersectSurfaces is LEFT ON OCCT
// for the RESULT-HANDLE reason (the SAME missing-handle-kind blocker as buildNurbsPatch),
// surfaced honestly — NOT a gap in the SSI marcher itself, which is built + gate-tested.
// (NurbsSurfaceIntersect.hpp is #included so the target is named + compile-checked.)

// (4) projectPointToSurface — Newton closest-point on the native rational surface
// (brep::evaluateWithDerivatives partials). Returns true + fills `out` on success;
// returns false (NEVER throws) to DEFER to OCCT otherwise.
bool tryNativeProjectPointToSurface(ShapeHandle face, double px, double py, double pz,
                                    PointOnSurface& out) {
    using namespace forge::native::brep;
    std::optional<NurbsSurface> ns = nativeSurfaceOf(face);
    if (!ns) return false;                                  // OCCT input -> defer
    const char* why = nullptr;
    if (!validateSurface(*ns, &why)) return false;          // malformed -> defer

    // Newton minimisation of |S(u,v) - P|^2 using the analytic first partials. The
    // domain is the clamped knot interval [u0,u1] x [v0,v1]; seed at the centre.
    const double u0 = ns->knotsU.front(), u1 = ns->knotsU.back();
    const double v0 = ns->knotsV.front(), v1 = ns->knotsV.back();
    double u = 0.5 * (u0 + u1), v = 0.5 * (v0 + v1);
    Vec3 P{ px, py, pz };
    SurfaceSample s{};
    for (int it = 0; it < 32; ++it) {
        s = evaluateWithDerivatives(*ns, u, v);
        if (!s.ok) return false;                            // singular sample -> defer
        const Vec3 r{ s.point.x - P.x, s.point.y - P.y, s.point.z - P.z };
        // Gradient of 0.5|r|^2 is (r.Su, r.Sv); Gauss-Newton step with the metric
        // [Su.Su Su.Sv; Su.Sv Sv.Sv].
        const double E = s.du.x * s.du.x + s.du.y * s.du.y + s.du.z * s.du.z;
        const double F = s.du.x * s.dv.x + s.du.y * s.dv.y + s.du.z * s.dv.z;
        const double G = s.dv.x * s.dv.x + s.dv.y * s.dv.y + s.dv.z * s.dv.z;
        const double gu = r.x * s.du.x + r.y * s.du.y + r.z * s.du.z;
        const double gv = r.x * s.dv.x + r.y * s.dv.y + r.z * s.dv.z;
        const double det = E * G - F * F;
        if (std::abs(det) < 1e-18) break;                   // degenerate metric -> stop
        const double du_ = -(G * gu - F * gv) / det;
        const double dv_ = -(E * gv - F * gu) / det;
        u = std::min(u1, std::max(u0, u + du_));
        v = std::min(v1, std::max(v0, v + dv_));
        if (std::abs(du_) + std::abs(dv_) < 1e-12) break;
    }
    s = evaluateWithDerivatives(*ns, u, v);
    if (!s.ok) return false;
    out.u = u;
    out.v = v;
    out.point = { s.point.x, s.point.y, s.point.z };
    out.distance = std::sqrt((s.point.x - px) * (s.point.x - px) +
                             (s.point.y - py) * (s.point.y - py) +
                             (s.point.z - pz) * (s.point.z - pz));
    return true;
}

// (5) classAAnalyse — native Gauss-curvature spread + isophote-bucket cardinality
// over a (u,v) sample grid via brep::surfaceCurvature. Returns true + fills `out`
// on success; returns false (NEVER throws) to DEFER to OCCT otherwise.
bool tryNativeClassAAnalyse(ShapeHandle face, std::uint32_t samples, ClassASummary& out) {
    using namespace forge::native::brep;
    std::optional<NurbsSurface> ns = nativeSurfaceOf(face);
    if (!ns) return false;                                  // OCCT input -> defer
    const char* why = nullptr;
    if (!validateSurface(*ns, &why)) return false;          // malformed -> defer

    const double u0 = ns->knotsU.front(), u1 = ns->knotsU.back();
    const double v0 = ns->knotsV.front(), v1 = ns->knotsV.back();
    if (samples < 4) samples = 4;
    // Inset 1% to mirror the OCCT path's pole-avoidance.
    const double uIn = (u1 - u0) * 0.01, vIn = (v1 - v0) * 0.01;
    const double uLo = u0 + uIn, uHi = u1 - uIn;
    const double vLo = v0 + vIn, vHi = v1 - vIn;
    double minK = std::numeric_limits<double>::infinity();
    double maxK = -std::numeric_limits<double>::infinity();
    double sumK = 0.0;
    std::size_t count = 0;
    constexpr int kBuckets = 16;
    std::set<int> seen;
    for (std::uint32_t i = 0; i < samples; ++i) {
        for (std::uint32_t j = 0; j < samples; ++j) {
            const double u = uLo + (uHi - uLo) * (i / static_cast<double>(samples - 1));
            const double v = vLo + (vHi - vLo) * (j / static_cast<double>(samples - 1));
            SurfaceCurvature k = surfaceCurvature(*ns, u, v);
            if (!k.ok || !std::isfinite(k.gaussian)) continue;
            minK = std::min(minK, k.gaussian);
            maxK = std::max(maxK, k.gaussian);
            sumK += k.gaussian;
            ++count;
            const double kn = std::max(-1.0, std::min(1.0, k.gaussian));
            int bucket = static_cast<int>(std::floor((kn + 1.0) * 0.5 * kBuckets));
            if (bucket >= kBuckets) bucket = kBuckets - 1;
            seen.insert(bucket);
        }
    }
    if (count == 0) return false;                           // no usable samples -> defer
    out.minK = minK;
    out.maxK = maxK;
    out.avgK = sumK / static_cast<double>(count);
    out.isophoteCount = static_cast<std::uint32_t>(seen.size());
    return true;
}

}  // namespace
#endif

// ============================================================ buildNurbsPatch
ShapeHandle buildNurbsPatch(const ControlGrid& grid,
                            std::uint32_t uDegree,
                            std::uint32_t vDegree,
                            const std::vector<double>& uKnotsCustom,
                            const std::vector<double>& vKnotsCustom) {
    if (grid.uCount < 2 || grid.vCount < 2) {
        throw std::invalid_argument(
            "forge.surfacing.buildNurbsPatch: control grid must be >= 2x2");
    }
    if (grid.xyz.size() != static_cast<std::size_t>(grid.uCount) * grid.vCount * 3) {
        throw std::invalid_argument(
            "forge.surfacing.buildNurbsPatch: xyz length != uCount*vCount*3");
    }
    if (uDegree < 1 || vDegree < 1) {
        throw std::invalid_argument(
            "forge.surfacing.buildNurbsPatch: degree must be >= 1");
    }
    if (uDegree >= grid.uCount || vDegree >= grid.vCount) {
        throw std::invalid_argument(
            "forge.surfacing.buildNurbsPatch: degree must be < control count per axis");
    }

    // ---- pack control points into TColgp_Array2OfPnt --------------------
    TColgp_Array2OfPnt poles(1, static_cast<Standard_Integer>(grid.uCount),
                             1, static_cast<Standard_Integer>(grid.vCount));
    for (std::uint32_t v = 0; v < grid.vCount; ++v) {
        for (std::uint32_t u = 0; u < grid.uCount; ++u) {
            const std::size_t base = (static_cast<std::size_t>(v) * grid.uCount + u) * 3;
            poles.SetValue(static_cast<Standard_Integer>(u + 1),
                           static_cast<Standard_Integer>(v + 1),
                           gp_Pnt(grid.xyz[base + 0],
                                  grid.xyz[base + 1],
                                  grid.xyz[base + 2]));
        }
    }

    // ---- knot vectors (uniform clamped by default) ----------------------
    std::vector<double>      uKnots;
    std::vector<std::uint32_t> uMults;
    std::vector<double>      vKnots;
    std::vector<std::uint32_t> vMults;
    auto buildKnots = [&](const std::vector<double>& custom,
                          std::uint32_t count, std::uint32_t degree,
                          std::vector<double>& knots,
                          std::vector<std::uint32_t>& mults) {
        if (custom.empty()) {
            buildUniformClampedKnots(count, degree, knots, mults);
        } else {
            // Custom knots: caller passes the dense knot vector
            // (size = count + degree + 1). Reduce to (distinct values,
            // multiplicities) for OCCT.
            const std::size_t expected = static_cast<std::size_t>(count) + degree + 1;
            if (custom.size() != expected) {
                throw std::invalid_argument(
                    "forge.surfacing.buildNurbsPatch: custom knot vector size " +
                    std::to_string(custom.size()) + " != count+degree+1 = " +
                    std::to_string(expected));
            }
            knots.clear();
            mults.clear();
            for (std::size_t i = 0; i < custom.size(); ) {
                std::size_t j = i;
                while (j < custom.size() &&
                       std::abs(custom[j] - custom[i]) < 1e-12) ++j;
                knots.push_back(custom[i]);
                mults.push_back(static_cast<std::uint32_t>(j - i));
                i = j;
            }
        }
    };
    buildKnots(uKnotsCustom, grid.uCount, uDegree, uKnots, uMults);
    buildKnots(vKnotsCustom, grid.vCount, vDegree, vKnots, vMults);

    TColStd_Array1OfReal    uKnotArr(1, static_cast<Standard_Integer>(uKnots.size()));
    TColStd_Array1OfInteger uMultArr(1, static_cast<Standard_Integer>(uMults.size()));
    for (std::size_t i = 0; i < uKnots.size(); ++i) {
        uKnotArr.SetValue(static_cast<Standard_Integer>(i + 1), uKnots[i]);
        uMultArr.SetValue(static_cast<Standard_Integer>(i + 1),
                          static_cast<Standard_Integer>(uMults[i]));
    }
    TColStd_Array1OfReal    vKnotArr(1, static_cast<Standard_Integer>(vKnots.size()));
    TColStd_Array1OfInteger vMultArr(1, static_cast<Standard_Integer>(vMults.size()));
    for (std::size_t i = 0; i < vKnots.size(); ++i) {
        vKnotArr.SetValue(static_cast<Standard_Integer>(i + 1), vKnots[i]);
        vMultArr.SetValue(static_cast<Standard_Integer>(i + 1),
                          static_cast<Standard_Integer>(vMults[i]));
    }

    Handle(Geom_BSplineSurface) surf = new Geom_BSplineSurface(
        poles, uKnotArr, vKnotArr, uMultArr, vMultArr,
        static_cast<Standard_Integer>(uDegree),
        static_cast<Standard_Integer>(vDegree),
        /*uPeriodic*/ Standard_False, /*vPeriodic*/ Standard_False);

    BRepBuilderAPI_MakeFace mk(surf, Precision::Confusion());
    if (!mk.IsDone()) {
        throw std::runtime_error(
            "forge.surfacing.buildNurbsPatch: BRepBuilderAPI_MakeFace failed");
    }
    return ShapeRegistry::instance().add(mk.Face());
}

// ============================================================ trimNurbsFace
ShapeHandle trimNurbsFace(ShapeHandle face, const std::vector<double>& trimUV) {
#ifdef FORGE_NATIVE_BREP
    // GATE: the native trimmed-NURBS keystone (brep::TrimmedFace) is opt-in via the FEAT
    // gate (default OFF). When on AND the input is a native NURBS surface, build the
    // trimmed face natively; otherwise fall through to OCCT (an OCCT-backed face HONESTLY
    // DEFERS — no behavior change in the default build). A false return == defer.
    if (native::brep::forgeNativeFeaturesEnabled()) {
        ShapeHandle nativeOut = 0;
        if (tryNativeTrimNurbsFace(face, trimUV, nativeOut)) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif
    if (trimUV.size() < 6 || (trimUV.size() % 2) != 0) {
        throw std::invalid_argument(
            "forge.surfacing.trimNurbsFace: trimUV must have >= 3 (u,v) pairs");
    }
    const TopoDS_Face f = firstFaceOf(fetch(face), "trimNurbsFace");
    Handle(Geom_Surface) s = surfaceOf(f, "trimNurbsFace");

    // Build the trim loop as 2D parametric edges in the surface's (u,v)
    // space. A 3D polyline of straight edges (the old approach) carries no
    // pcurve, so MakeFace(surface, wire) produced an EMPTY face — the trim
    // silently did nothing. Geom2d line segments in UV give each edge a
    // real pcurve on the surface; BRepLib::BuildCurves3d then synthesises
    // the matching 3D curves so the wire is valid in both spaces.
    BRepBuilderAPI_MakeWire wireMk;
    const std::size_t n = trimUV.size() / 2;
    auto uv = [&](std::size_t i) {
        return gp_Pnt2d(trimUV[2*i], trimUV[2*i + 1]);
    };
    for (std::size_t i = 0; i < n; ++i) {
        gp_Pnt2d a = uv(i);
        gp_Pnt2d b = uv((i + 1) % n);
        if (a.Distance(b) < Precision::PConfusion()) continue;
        Handle(Geom2d_TrimmedCurve) seg = GCE2d_MakeSegment(a, b);
        if (seg.IsNull()) continue;
        BRepBuilderAPI_MakeEdge edgeMk(seg, s);
        if (!edgeMk.IsDone()) continue;
        wireMk.Add(edgeMk.Edge());
    }
    if (!wireMk.IsDone()) {
        throw std::runtime_error(
            "forge.surfacing.trimNurbsFace: failed to assemble trim wire");
    }
    TopoDS_Wire trimWire = wireMk.Wire();
    // Generate 3D curves for the parametric edges so the face is valid.
    BRepLib::BuildCurves3d(trimWire);
    BRepBuilderAPI_MakeFace mk(s, trimWire, /*inside*/ Standard_True);
    if (!mk.IsDone()) {
        throw std::runtime_error(
            "forge.surfacing.trimNurbsFace: MakeFace(surface, wire) failed");
    }
    TopoDS_Face trimmed = mk.Face();
    BRepLib::BuildCurves3d(trimmed);
    return ShapeRegistry::instance().add(trimmed);
}

// ============================================================ sewNurbsFaces
ShapeHandle sewNurbsFaces(const std::vector<ShapeHandle>& faces, double tolerance) {
    if (faces.size() < 2) {
        throw std::invalid_argument(
            "forge.surfacing.sewNurbsFaces: need >= 2 faces to sew");
    }
    BRepBuilderAPI_Sewing sew(tolerance > 0 ? tolerance : 1e-3);
    for (auto h : faces) sew.Add(fetch(h));
    sew.Perform();
    TopoDS_Shape sewn = sew.SewedShape();
    if (sewn.IsNull()) {
        throw std::runtime_error(
            "forge.surfacing.sewNurbsFaces: BRepBuilderAPI_Sewing returned null");
    }
    return ShapeRegistry::instance().add(sewn);
}

// ============================================================ refineNurbs
ShapeHandle refineNurbs(ShapeHandle face, std::uint32_t uTimes, std::uint32_t vTimes) {
    TopoDS_Face f = firstFaceOf(fetch(face), "refineNurbs");
    Handle(Geom_BSplineSurface) bs = bsplineOf(f, "refineNurbs");

    // Take a deep copy via Copy() so we don't mutate the registered shape.
    Handle(Geom_BSplineSurface) bsCopy = Handle(Geom_BSplineSurface)::DownCast(bs->Copy());
    const Standard_Integer newU = bsCopy->UDegree() + static_cast<Standard_Integer>(uTimes);
    const Standard_Integer newV = bsCopy->VDegree() + static_cast<Standard_Integer>(vTimes);
    if (newU > bsCopy->UDegree() || newV > bsCopy->VDegree()) {
        bsCopy->IncreaseDegree(newU, newV);
    }
    BRepBuilderAPI_MakeFace mk(bsCopy, Precision::Confusion());
    if (!mk.IsDone()) {
        throw std::runtime_error(
            "forge.surfacing.refineNurbs: BRepBuilderAPI_MakeFace failed");
    }
    return ShapeRegistry::instance().add(mk.Face());
}

// ============================================================ evalSurface
SurfaceEval evalSurface(ShapeHandle face, double u, double v) {
#ifdef FORGE_NATIVE_BREP
    // GATE: native rational surface eval (brep::evaluateWithDerivatives) is opt-in via
    // the FEAT gate (default OFF). When on AND the input is a native NURBS surface,
    // evaluate natively; otherwise fall through to OCCT (an OCCT-backed face HONESTLY
    // DEFERS). A false return == defer.
    if (native::brep::forgeNativeFeaturesEnabled()) {
        SurfaceEval nativeOut{};
        if (tryNativeEvalSurface(face, u, v, nativeOut)) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif
    TopoDS_Face f = firstFaceOf(fetch(face), "evalSurface");
    Handle(Geom_Surface) s = surfaceOf(f, "evalSurface");
    GeomLProp_SLProps props(s, u, v, /*derivOrder*/ 2, Precision::Confusion());

    SurfaceEval out{};
    if (!props.IsNormalDefined()) {
        // Fall back to first-order eval; curvature stays NaN/0.
        gp_Pnt p; gp_Vec du, dv;
        s->D1(u, v, p, du, dv);
        out.point  = {p.X(), p.Y(), p.Z()};
        out.du     = {du.X(), du.Y(), du.Z()};
        out.dv     = {dv.X(), dv.Y(), dv.Z()};
        gp_Vec n = du.Crossed(dv);
        if (n.Magnitude() > Precision::Confusion()) n.Normalize();
        out.normal = {n.X(), n.Y(), n.Z()};
        out.gaussian = 0.0;
        out.mean     = 0.0;
        return out;
    }
    gp_Pnt p = props.Value();
    gp_Vec du = props.D1U();
    gp_Vec dv = props.D1V();
    gp_Dir n  = props.Normal();
    out.point    = {p.X(), p.Y(), p.Z()};
    out.du       = {du.X(), du.Y(), du.Z()};
    out.dv       = {dv.X(), dv.Y(), dv.Z()};
    out.normal   = {n.X(), n.Y(), n.Z()};
    out.gaussian = props.GaussianCurvature();
    out.mean     = props.MeanCurvature();
    return out;
}

// ============================================================ intersectSurfaces
ShapeHandle intersectSurfaces(ShapeHandle faceA, ShapeHandle faceB) {
    const TopoDS_Shape& a = fetch(faceA);
    const TopoDS_Shape& b = fetch(faceB);
    BRepAlgoAPI_Section sec(a, b, /*PerformNow*/ Standard_False);
    sec.ComputePCurveOn1(Standard_True);
    sec.Approximation(Standard_True);
    sec.Build();
    if (!sec.IsDone()) {
        throw std::runtime_error(
            "forge.surfacing.intersectSurfaces: BRepAlgoAPI_Section failed");
    }
    return ShapeRegistry::instance().add(sec.Shape());
}

// ============================================================ projectPointToSurface
PointOnSurface projectPointToSurface(ShapeHandle face,
                                     double px, double py, double pz) {
#ifdef FORGE_NATIVE_BREP
    // GATE: native point projection (Newton closest-point on the rational surface) is
    // opt-in via the FEAT gate (default OFF). When on AND the input is a native NURBS
    // surface, project natively; otherwise fall through to OCCT (an OCCT-backed face
    // HONESTLY DEFERS). A false return == defer.
    if (native::brep::forgeNativeFeaturesEnabled()) {
        PointOnSurface nativeOut{};
        if (tryNativeProjectPointToSurface(face, px, py, pz, nativeOut)) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif
    TopoDS_Face f = firstFaceOf(fetch(face), "projectPointToSurface");
    Handle(Geom_Surface) s = surfaceOf(f, "projectPointToSurface");
    gp_Pnt P(px, py, pz);
    GeomAPI_ProjectPointOnSurf proj(P, s);
    if (proj.NbPoints() < 1) {
        throw std::runtime_error(
            "forge.surfacing.projectPointToSurface: no projection found");
    }
    Standard_Real u = 0.0, v = 0.0;
    proj.LowerDistanceParameters(u, v);
    gp_Pnt q = proj.NearestPoint();
    PointOnSurface out{};
    out.u = u;
    out.v = v;
    out.point = {q.X(), q.Y(), q.Z()};
    out.distance = proj.LowerDistance();
    return out;
}

// ============================================================ classAAnalyse
ClassASummary classAAnalyse(ShapeHandle face, std::uint32_t samples) {
#ifdef FORGE_NATIVE_BREP
    // GATE: native Class-A curvature query (brep::surfaceCurvature over a (u,v) grid) is
    // opt-in via the FEAT gate (default OFF). When on AND the input is a native NURBS
    // surface, analyse natively; otherwise fall through to OCCT (an OCCT-backed face
    // HONESTLY DEFERS). A false return == defer.
    if (native::brep::forgeNativeFeaturesEnabled()) {
        ClassASummary nativeOut{};
        if (tryNativeClassAAnalyse(face, samples, nativeOut)) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif
    TopoDS_Face f = firstFaceOf(fetch(face), "classAAnalyse");
    Handle(Geom_Surface) s = surfaceOf(f, "classAAnalyse");

    Standard_Real u0, u1, v0, v1;
    s->Bounds(u0, u1, v0, v1);
    // Some analytic surfaces report infinite bounds — clamp those.
    if (!std::isfinite(u0) || !std::isfinite(u1)) { u0 = 0.0; u1 = 1.0; }
    if (!std::isfinite(v0) || !std::isfinite(v1)) { v0 = 0.0; v1 = 1.0; }

    if (samples < 4) samples = 4;
    double minK =  std::numeric_limits<double>::infinity();
    double maxK = -std::numeric_limits<double>::infinity();
    double sumK = 0.0;
    std::size_t count = 0;
    // Bucket Gauss curvature into 16 isophote bins on a fixed normalised
    // range; the resulting bucket count is the cardinality of "distinct
    // shading bands" a Class-A reviewer would see on a zebra map.
    constexpr int kBuckets = 16;
    std::set<int> seenBuckets;

    // Inset the sample grid by 1% on each axis to avoid singular poles on
    // analytical surfaces (sphere at v=±π/2 is the canonical case).
    const double uInset = (u1 - u0) * 0.01;
    const double vInset = (v1 - v0) * 0.01;
    const double uLo = u0 + uInset, uHi = u1 - uInset;
    const double vLo = v0 + vInset, vHi = v1 - vInset;
    for (std::uint32_t i = 0; i < samples; ++i) {
        for (std::uint32_t j = 0; j < samples; ++j) {
            const double u = uLo + (uHi - uLo) * (i / static_cast<double>(samples - 1));
            const double v = vLo + (vHi - vLo) * (j / static_cast<double>(samples - 1));
            double k = 0.0;
            bool ok = false;
            try {
                GeomLProp_SLProps props(s, u, v, 2, Precision::Confusion());
                if (!props.IsNormalDefined()) continue;
                k = props.GaussianCurvature();
                ok = std::isfinite(k);
            } catch (...) {
                continue;
            }
            if (!ok) continue;
            minK = std::min(minK, k);
            maxK = std::max(maxK, k);
            sumK += k;
            ++count;
            // Map k → bucket assuming k normalised in [-1, 1] for typical
            // automotive sweeps. Clamped so wildly curved samples saturate
            // at the boundary buckets instead of skewing the cardinality.
            const double kn = std::max(-1.0, std::min(1.0, k));
            int bucket = static_cast<int>(std::floor((kn + 1.0) * 0.5 * kBuckets));
            if (bucket >= kBuckets) bucket = kBuckets - 1;
            seenBuckets.insert(bucket);
        }
    }
    ClassASummary out{};
    if (count == 0) {
        out.minK = out.maxK = out.avgK = 0.0;
        out.isophoteCount = 0;
        return out;
    }
    out.minK = minK;
    out.maxK = maxK;
    out.avgK = sumK / static_cast<double>(count);
    out.isophoteCount = static_cast<std::uint32_t>(seenBuckets.size());
    return out;
}

}}  // namespace forge::surfacing
