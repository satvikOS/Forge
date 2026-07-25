// PUSH-07 — CATIA ICEM / NX Studio-style Class-A surfacing diagnostics
// + guided sweeping for the Forge MCAD kernel.
//
// See forge/ClassASurfacing.hpp for the public API contract; this file
// implements every entry point against live OCCT machinery. No stubs,
// no constants — each function returns OCCT-derived data:
//
//   * zebraStripes      — BRepLProp_SLProps for normals on a UV grid,
//                         projected through a virtual light direction
//                         into a bucket index.
//   * curvatureComb     — BRepLProp_CLProps for signed curvature +
//                         frenet normal along an edge.
//   * continuityCheck   — BRepLProp_SLProps on both sides of a shared
//                         edge, BRepLProp_CLProps for the edge torsion,
//                         aggregating worst-case G0..G3 metrics.
//   * gaussianAndMean   — GeomLProp_SLProps for K, H, kappaMin/Max on a
//                         UV grid.
//   * stitchG2          — BRepBuilderAPI_Sewing + per-shared-edge
//                         continuity report.
//   * sweepWithGuides   — BRepOffsetAPI_MakePipeShell with one or more
//                         guide wires registered via SetMode.

#include "forge/ClassASurfacing.hpp"

// ============================ IN-HOUSE NATIVE FAST-PATH (GATED, ADDITIVE) ====
// Phase-D wire #12. ADDITIVE + FEAT-GATED, exactly the idiom of the 10 prior
// wires (Healing.cpp / Cam.cpp / CamAdvanced.cpp / Drawings.cpp / LoftGuide.cpp).
// Compiled in ONLY under -DFORGE_NATIVE_BREP and taken at runtime ONLY when the
// FEAT gate forge::native::brep::forgeNativeFeaturesEnabled() is true (env
// FORGE_NATIVE_FEATURES=1, or the A/B harness toggle). DEFAULT OFF leaves every
// op byte-for-byte on the OCCT path below.
//
//   stitchG2  -> native brep::sewFaces (Sew.hpp). The OCCT entry's topological
//                BRepBuilderAPI_Sewing step is the in-house sewer's exact job
//                (weld coincident boundary edges/vertices -> one connected
//                Shell). Taken ONLY when EVERY input face handle is a
//                NativeSolid (no OCCT-shape -> native-face importer exists, so
//                ShapeRegistry only ever holds Occt / NativeSolid / NativeMesh
//                kinds) AND reportContinuity == false (the per-shared-edge
//                G0..G3 ContinuityReport is an OCCT BRepLProp diagnostic with NO
//                native curvature-on-sewn-shell evaluator — so when continuity
//                is requested the call HONESTLY DEFERS to OCCT). tryNativeStitchG2
//                returns false (NEVER throws) on every other input, so the OCCT
//                path runs unchanged.
//
// LEFT OCCT-ONLY (no native target consuming a shape handle; SAID PLAINLY):
//   * zebraStripes / curvatureComb / continuityCheck / gaussianAndMeanCurvature
//     — pure OCCT BRepLProp_SLProps/CLProps + GeomLProp_SLProps surface/edge
//       DIAGNOSTICS on an existing face/edge. The native Class-A surface family
//       (SurfaceFill.hpp fillCoonsPatch / GregoryFill.hpp fillGregoryPatch)
//       BUILDS a new fill surface from NurbsCurve boundary+tangent data; it is
//       NOT a normal/curvature/zebra evaluator over a registered shape, so there
//       is no native equivalent to route these to.
//   * sweepWithGuides — guided BRepOffsetAPI_MakePipeShell. The native sweep
//       family (Sweep.hpp / HelicalSweep.hpp / LoftSweep.hpp) is UNGUIDED; there
//       is no native guided-pipe-shell target (same gap LoftGuide.cpp documents
//       for guided loft), and ShapeRegistry has no native wire/curve kind for the
//       profile/spine/guide handles. OCCT-only.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled()
#include "forge/native/brep/Sew.hpp"           // sewFaces, SewOptions, SewResult (native)
#include "forge/native/brep/Topology.hpp"      // TopologyBuilder, Face/Loop/Coedge/Vertex/Shell/Solid/Surface
#include "forge/ShapeRegistry.hpp"             // ShapeKind, getNativeSolid

#include <unordered_set>
#endif

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepLProp_CLProps.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRep_Tool.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Surface.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <GeomLProp_SLProps.hxx>
#include "forge/native/geom/NativeProjection.hpp"  // R1 native point→surface (drops TKGeomBase Extrema)
#include <Precision.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>

namespace forge { namespace classa {

namespace {

const TopoDS_Shape& fetch(ShapeHandle h) {
    return ShapeRegistry::instance().get(h);
}

TopoDS_Face firstFaceOf(const TopoDS_Shape& s, const char* what) {
    if (!s.IsNull() && s.ShapeType() == TopAbs_FACE) {
        return TopoDS::Face(s);
    }
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        return TopoDS::Face(ex.Current());
    }
    throw std::invalid_argument(std::string("forge.classa.") + what +
                                ": registered shape has no face");
}

TopoDS_Edge firstEdgeOf(const TopoDS_Shape& s, const char* what) {
    if (!s.IsNull() && s.ShapeType() == TopAbs_EDGE) {
        return TopoDS::Edge(s);
    }
    for (TopExp_Explorer ex(s, TopAbs_EDGE); ex.More(); ex.Next()) {
        return TopoDS::Edge(ex.Current());
    }
    throw std::invalid_argument(std::string("forge.classa.") + what +
                                ": registered shape has no edge");
}

TopoDS_Wire firstWireOf(const TopoDS_Shape& s, const char* what) {
    if (!s.IsNull() && s.ShapeType() == TopAbs_WIRE) {
        return TopoDS::Wire(s);
    }
    for (TopExp_Explorer ex(s, TopAbs_WIRE); ex.More(); ex.Next()) {
        return TopoDS::Wire(ex.Current());
    }
    // No wire? Fall through: build a wire from the first edge if any.
    for (TopExp_Explorer ex(s, TopAbs_EDGE); ex.More(); ex.Next()) {
        BRepBuilderAPI_MakeWire mk(TopoDS::Edge(ex.Current()));
        if (mk.IsDone()) return mk.Wire();
    }
    throw std::invalid_argument(std::string("forge.classa.") + what +
                                ": registered shape has no wire / edge");
}

// Bounds of a face's underlying surface, with infinite-bounds clamping
// for analytic surfaces (cylinder side, sphere top, etc.).
void faceUVBounds(const TopoDS_Face& f, double& u0, double& u1,
                  double& v0, double& v1) {
    BRepAdaptor_Surface adaptor(f, /*restriction*/ Standard_True);
    u0 = adaptor.FirstUParameter();
    u1 = adaptor.LastUParameter();
    v0 = adaptor.FirstVParameter();
    v1 = adaptor.LastVParameter();
    if (!std::isfinite(u0) || !std::isfinite(u1) || u1 - u0 <= 0) {
        u0 = 0.0;
        u1 = 1.0;
    }
    if (!std::isfinite(v0) || !std::isfinite(v1) || v1 - v0 <= 0) {
        v0 = 0.0;
        v1 = 1.0;
    }
}

inline std::array<double, 3> vec3(const gp_Pnt& p) {
    return {p.X(), p.Y(), p.Z()};
}

inline std::array<double, 3> vec3(const gp_Vec& v) {
    return {v.X(), v.Y(), v.Z()};
}

#ifdef FORGE_NATIVE_BREP
// Deep-clone one native Face (its outer ring vertices + any inner rings +
// analytic surface frame + trim window) into `tb` as an INDEPENDENT fragment
// with PRIVATE fresh vertices/edges — exactly the "N separate STEP ADVANCED_FACE
// records" import state the native sewer (Sew.hpp) ingests, so its weld pass acts
// on the raw fragment soup (NOT on an already-sewn shell). Byte-for-byte
// Healing.cpp::cloneFaceIndependent (identity copy, no transform).
forge::native::brep::Face* cloneFaceIndependent(
    forge::native::brep::TopologyBuilder& tb,
    const forge::native::brep::Face* sf) {
    using namespace forge::native::brep;
    Loop* lp = sf->outerLoop;
    if (!lp || lp->coedgeCount < 3) return nullptr;

    auto ringOf = [&](const Loop* loop) -> std::vector<Vertex*> {
        std::vector<Vertex*> ring;
        if (!loop || loop->coedgeCount < 3) return ring;
        ring.reserve(loop->coedgeCount);
        Coedge* c = loop->first;
        for (std::size_t i = 0; i < loop->coedgeCount && c != nullptr; ++i) {
            Vertex* o = c->originVertex();
            if (o) ring.push_back(tb.makeVertex(o->point));
            c = c->next;
        }
        return ring;
    };

    std::vector<Vertex*> outer = ringOf(lp);
    if (outer.size() < 3) return nullptr;

    Face* nf = tb.makeFace();
    tb.addOuterLoopToFace(nf, outer);
    for (Loop* il : sf->innerLoops) {
        std::vector<Vertex*> inner = ringOf(il);
        if (inner.size() >= 3) tb.addInnerLoopToFace(nf, inner);
    }
    if (sf->surface) {
        Surface* ns = tb.makeSurface();
        *ns = *sf->surface;
        nf->surface = ns;
    }
    nf->u0 = sf->u0; nf->u1 = sf->u1;
    nf->v0 = sf->v0; nf->v1 = sf->v1;
    nf->vertexUV = sf->vertexUV;
    nf->paramTri = sf->paramTri;
    return nf;
}

// Try the native sew (brep::sewFaces) for stitchG2. Returns true + sets `out` on
// success; returns false (NEVER throws) when the native path HONESTLY DEFERS to
// OCCT. Same deferral contract as Healing.cpp::tryNativeSewShape, adapted to the
// stitchG2 multi-handle signature:
//   * any input handle that is NOT a NativeSolid (no OCCT-shape -> native-face
//     importer exists) -> defer to OCCT (default-build behaviour unchanged);
//   * reportContinuity == true -> defer (the per-shared-edge G0..G3 ContinuityReport
//     is an OCCT BRepLProp diagnostic with no native curvature-on-sewn-shell
//     evaluator; the native sewer reports edge MANIFOLD classification, not G2
//     curvature continuity, so serving it would mean fabricating numbers -> defer);
//   * a malformed / degenerate sew -> defer.
bool tryNativeStitchG2(const std::vector<ShapeHandle>& faces,
                       double tolerance,
                       bool reportContinuity,
                       StitchReport& out) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();

    // The per-edge G0..G3 continuity diagnostic has no native equivalent -> defer
    // the WHOLE call to OCCT (which fills `reports` via continuityCheck/BRepLProp).
    if (reportContinuity) return false;

    // Every input must be a NativeSolid (the only native-backed shape kind; a
    // single OCCT face -> defer). Gather all their faces as independent fragments.
    auto owner = std::make_shared<TopologyBuilder>();
    std::vector<Face*> frags;
    for (ShapeHandle h : faces) {
        if (reg.kindOf(h) != ShapeKind::NativeSolid) return false;  // defer to OCCT
        const Solid& s = reg.getNativeSolid(h);
        for (Shell* sh : s.shells) {
            for (Face* sf : sh->faces) {
                if (Face* nf = cloneFaceIndependent(*owner, sf)) frags.push_back(nf);
            }
        }
    }
    if (frags.size() < 2) return false;  // need >= 2 faces to sew -> defer

    SewOptions sopt;
    if (tolerance > 0.0) sopt.tol = tolerance;
    SewResult r = sewFaces(*owner, frags, sopt);
    if (!r.ok || r.shells.empty()) return false;  // malformed -> defer

    Solid* solid = owner->makeSolid();
    for (Shell* sh : r.shells) owner->addShellToSolid(solid, sh);
    if (solid->shells.empty()) return false;

    out.handle = reg.addNativeSolid(std::move(owner), solid);
    // reportContinuity == false here: OCCT returns edgeCount = 0 with no reports
    // (the early-return branch). Match that exactly.
    out.edgeCount = 0;
    out.reports.clear();
    return true;
}
#endif

}  // namespace

// ============================================================ zebraStripes
std::vector<ZebraSample> zebraStripes(ShapeHandle face,
                                      std::uint32_t stripeCount,
                                      double lightDirX,
                                      double lightDirY,
                                      double lightDirZ,
                                      std::uint32_t uSamples,
                                      std::uint32_t vSamples) {
    if (stripeCount < 2) {
        throw std::invalid_argument(
            "forge.classa.zebraStripes: stripeCount must be >= 2");
    }
    if (uSamples < 2) uSamples = 2;
    if (vSamples < 2) vSamples = 2;

    TopoDS_Face f = firstFaceOf(fetch(face), "zebraStripes");

    // Normalise the light direction. Build an orthonormal frame (eX, eY)
    // spanning the viewing plane perpendicular to lightDir.
    gp_Vec L(lightDirX, lightDirY, lightDirZ);
    if (L.Magnitude() < Precision::Confusion()) {
        throw std::invalid_argument(
            "forge.classa.zebraStripes: lightDir must be non-zero");
    }
    L.Normalize();
    // Pick a stable seed vector not collinear with L.
    gp_Vec seed = (std::abs(L.X()) < 0.9) ? gp_Vec(1, 0, 0) : gp_Vec(0, 1, 0);
    gp_Vec eX  = seed - L * seed.Dot(L);
    if (eX.Magnitude() < Precision::Confusion()) {
        eX = gp_Vec(0, 0, 1) - L * gp_Vec(0, 0, 1).Dot(L);
    }
    eX.Normalize();
    gp_Vec eY = L.Crossed(eX);
    eY.Normalize();

    double u0, u1, v0, v1;
    faceUVBounds(f, u0, u1, v0, v1);
    // Inset slightly to dodge analytical poles (sphere ±pi/2 in v).
    const double uInset = (u1 - u0) * 0.005;
    const double vInset = (v1 - v0) * 0.005;
    const double uLo = u0 + uInset, uHi = u1 - uInset;
    const double vLo = v0 + vInset, vHi = v1 - vInset;

    BRepAdaptor_Surface surf(f, Standard_True);
    BRepLProp_SLProps props(surf, /*derivOrder*/ 1, Precision::Confusion());

    std::vector<ZebraSample> out;
    out.reserve(static_cast<std::size_t>(uSamples) * vSamples);

    for (std::uint32_t j = 0; j < vSamples; ++j) {
        for (std::uint32_t i = 0; i < uSamples; ++i) {
            const double uu = uLo + (uHi - uLo) * (i / static_cast<double>(uSamples - 1));
            const double vv = vLo + (vHi - vLo) * (j / static_cast<double>(vSamples - 1));

            double angle = 0.0;
            std::uint32_t bucket = 0;
            try {
                props.SetParameters(uu, vv);
                if (!props.IsNormalDefined()) {
                    out.push_back({uu, vv, 0u, 0.0});
                    continue;
                }
                gp_Dir n = props.Normal();
                // Project normal onto plane perpendicular to lightDir.
                gp_Vec nv(n.X(), n.Y(), n.Z());
                const double x = nv.Dot(eX);
                const double y = nv.Dot(eY);
                angle = std::atan2(y, x);  // in [-pi, pi]
                // Map angle ∈ [-pi, pi] → [0, stripeCount).
                double t = (angle + M_PI) / (2.0 * M_PI);  // [0, 1]
                if (t < 0.0) t = 0.0;
                if (t >= 1.0) t = 0.0;        // wrap exactly
                bucket = static_cast<std::uint32_t>(
                    std::floor(t * stripeCount)) % stripeCount;
            } catch (...) {
                bucket = 0;
                angle  = 0.0;
            }
            out.push_back({uu, vv, bucket, angle});
        }
    }
    return out;
}

// ============================================================ curvatureComb
std::vector<CurvatureCombSample> curvatureComb(ShapeHandle edge,
                                               std::uint32_t samples,
                                               double combScale) {
    if (samples < 2) {
        throw std::invalid_argument(
            "forge.classa.curvatureComb: samples must be >= 2");
    }
    TopoDS_Edge e = firstEdgeOf(fetch(edge), "curvatureComb");
    BRepAdaptor_Curve adaptor(e);
    const double u0 = adaptor.FirstParameter();
    const double u1 = adaptor.LastParameter();
    if (!std::isfinite(u0) || !std::isfinite(u1) || u1 - u0 <= 0) {
        throw std::runtime_error(
            "forge.classa.curvatureComb: edge has degenerate parameter range");
    }

    BRepLProp_CLProps props(adaptor, /*N*/ 2, Precision::Confusion());

    std::vector<CurvatureCombSample> out;
    out.reserve(samples);

    for (std::uint32_t i = 0; i < samples; ++i) {
        const double t  = i / static_cast<double>(samples - 1);
        const double uu = u0 + (u1 - u0) * t;
        props.SetParameter(uu);
        const gp_Pnt& p = props.Value();
        double kappa = 0.0;
        gp_Dir nDir(0, 0, 1);
        try {
            kappa = props.Curvature();
            if (!std::isfinite(kappa)) kappa = 0.0;
            // Curve normal is only defined where curvature > 0.
            if (kappa > Precision::Confusion()) {
                props.Normal(nDir);
            }
        } catch (...) {
            kappa = 0.0;
        }
        gp_Vec offset(nDir);
        offset *= (kappa * combScale);
        gp_Pnt tip(p.X() + offset.X(),
                   p.Y() + offset.Y(),
                   p.Z() + offset.Z());
        CurvatureCombSample s{};
        s.u = uu;
        s.position3d = vec3(p);
        s.combTip3d  = vec3(tip);
        s.curvature  = kappa;
        out.push_back(s);
    }
    return out;
}

// ============================================================ continuityCheck
ContinuityReport continuityCheck(ShapeHandle face1, ShapeHandle face2,
                                 ShapeHandle sharedEdge,
                                 std::uint32_t samples) {
    if (samples < 2) samples = 2;
    TopoDS_Face fA = firstFaceOf(fetch(face1), "continuityCheck(faceA)");
    TopoDS_Face fB = firstFaceOf(fetch(face2), "continuityCheck(faceB)");
    TopoDS_Edge eS = firstEdgeOf(fetch(sharedEdge), "continuityCheck(edge)");

    Handle(Geom_Surface) sA = BRep_Tool::Surface(fA);
    Handle(Geom_Surface) sB = BRep_Tool::Surface(fB);
    if (sA.IsNull() || sB.IsNull()) {
        throw std::invalid_argument(
            "forge.classa.continuityCheck: one of the faces has no surface");
    }

    BRepAdaptor_Curve curve(eS);
    const double u0 = curve.FirstParameter();
    const double u1 = curve.LastParameter();
    if (!std::isfinite(u0) || !std::isfinite(u1) || u1 - u0 <= 0) {
        throw std::runtime_error(
            "forge.classa.continuityCheck: edge has degenerate range");
    }
    BRepLProp_CLProps cProps(curve, /*N*/ 3, Precision::Confusion());

    BRepAdaptor_Surface adA(fA, Standard_True);
    BRepAdaptor_Surface adB(fB, Standard_True);
    BRepLProp_SLProps propA(adA, /*N*/ 2, Precision::Confusion());
    BRepLProp_SLProps propB(adB, /*N*/ 2, Precision::Confusion());

    double g0_max = 0.0;
    double g1_max = 0.0;   // radians
    double g2_max = 0.0;   // [0, 1]+
    double g3_max = 0.0;   // raw torsion-delta magnitude

    std::uint32_t okSamples = 0;

    for (std::uint32_t i = 0; i < samples; ++i) {
        const double t  = i / static_cast<double>(samples - 1);
        const double uu = u0 + (u1 - u0) * t;
        cProps.SetParameter(uu);
        const gp_Pnt edgePt = cProps.Value();

        // Curve torsion = (d1 ^ d2) . d3 / |d1 ^ d2|^2 — compute by hand
        // so the same value is referenced on both faces (the torsion is
        // a property of the edge itself but we still need its magnitude
        // to compute the per-face torsion deviation below).
        double tEdge = 0.0;
        try {
            const gp_Vec& d1 = cProps.D1();
            const gp_Vec& d2 = cProps.D2();
            const gp_Vec& d3 = cProps.D3();
            gp_Vec d1xd2 = d1.Crossed(d2);
            const double denom = d1xd2.SquareMagnitude();
            if (denom > Precision::Confusion()) {
                tEdge = d1xd2.Dot(d3) / denom;
            }
        } catch (...) {
            tEdge = 0.0;
        }

        // Project edgePt onto each face to find (uA, vA), (uB, vB).
        double uA = 0.0, vA = 0.0, uB = 0.0, vB = 0.0;
        try {
#ifdef FORGE_NATIVE_PROJECTION
            auto projA = forge::occtproj::projectPointOnSurface(edgePt, sA);
#else
            GeomAPI_ProjectPointOnSurf projA(edgePt, sA);
#endif
            if (projA.NbPoints() < 1) continue;
            projA.LowerDistanceParameters(uA, vA);
#ifdef FORGE_NATIVE_PROJECTION
            auto projB = forge::occtproj::projectPointOnSurface(edgePt, sB);
#else
            GeomAPI_ProjectPointOnSurf projB(edgePt, sB);
#endif
            if (projB.NbPoints() < 1) continue;
            projB.LowerDistanceParameters(uB, vB);
        } catch (...) {
            continue;
        }

        propA.SetParameters(uA, vA);
        propB.SetParameters(uB, vB);
        if (!propA.IsNormalDefined() || !propB.IsNormalDefined()) continue;

        const gp_Pnt pA = propA.Value();
        const gp_Pnt pB = propB.Value();
        const gp_Dir nA = propA.Normal();
        const gp_Dir nB = propB.Normal();

        // G0 — position gap. Use max(distance from each surface point to
        // the edge point) so we measure how well each face touches the
        // shared edge.
        const double gap = std::max(edgePt.Distance(pA), edgePt.Distance(pB));
        g0_max = std::max(g0_max, gap);

        // G1 — tangent / normal angle. Flip nB if it points opposite to
        // nA (faces may have opposite outward normals around a shared
        // edge); we measure the acute angle.
        double cosAng = nA.X() * nB.X() + nA.Y() * nB.Y() + nA.Z() * nB.Z();
        cosAng = std::abs(cosAng);
        if (cosAng > 1.0) cosAng = 1.0;
        const double angRad = std::acos(cosAng);
        g1_max = std::max(g1_max, angRad);

        // G2 — curvature ratio deviation. Compare mean curvature (a
        // signed scalar, robust to principal-direction sign flips).
        double kA = 0.0, kB = 0.0;
        try { kA = propA.MeanCurvature(); } catch (...) { kA = 0.0; }
        try { kB = propB.MeanCurvature(); } catch (...) { kB = 0.0; }
        if (!std::isfinite(kA)) kA = 0.0;
        if (!std::isfinite(kB)) kB = 0.0;
        const double kRef = std::max({std::abs(kA), std::abs(kB), 1e-9});
        const double kDev = std::abs(kA - kB) / kRef;
        g2_max = std::max(g2_max, kDev);

        // G3 — torsion of the surface-section curves through the edge
        // direction. We approximate per-face torsion by combining the
        // edge's third derivative with each face's normal: t_face =
        // (d1 . n) * tEdge — i.e. project the edge torsion through the
        // face's normal so a face that meets the edge tangentially has
        // zero contribution. The G3 metric is the absolute difference.
        const gp_Vec& d1 = cProps.D1();
        const double tA = std::abs(d1.X() * nA.X() + d1.Y() * nA.Y() + d1.Z() * nA.Z()) * tEdge;
        const double tB = std::abs(d1.X() * nB.X() + d1.Y() * nB.Y() + d1.Z() * nB.Z()) * tEdge;
        const double tDev = std::abs(tA - tB);
        g3_max = std::max(g3_max, tDev);

        ++okSamples;
    }

    ContinuityReport out{};
    out.g0_max_mm  = g0_max;
    out.g1_max_deg = g1_max * 180.0 / M_PI;
    out.g2_max_pct = g2_max * 100.0;
    out.g3_max_pct = g3_max * 100.0;
    out.g3_continuity =
        (out.g0_max_mm  < 1e-3) &&
        (out.g1_max_deg < 1.0)  &&
        (out.g2_max_pct < 5.0)  &&
        (out.g3_max_pct < 5.0);
    out.samples = okSamples;
    return out;
}

// ============================================================ gaussianAndMeanCurvature
std::vector<CurvatureSample> gaussianAndMeanCurvature(ShapeHandle face,
                                                      std::uint32_t uSamples,
                                                      std::uint32_t vSamples) {
    if (uSamples < 2) uSamples = 2;
    if (vSamples < 2) vSamples = 2;
    TopoDS_Face f = firstFaceOf(fetch(face), "gaussianAndMeanCurvature");
    Handle(Geom_Surface) surf = BRep_Tool::Surface(f);
    if (surf.IsNull()) {
        throw std::invalid_argument(
            "forge.classa.gaussianAndMeanCurvature: face has no surface");
    }
    double u0, u1, v0, v1;
    faceUVBounds(f, u0, u1, v0, v1);
    const double uInset = (u1 - u0) * 0.005;
    const double vInset = (v1 - v0) * 0.005;
    const double uLo = u0 + uInset, uHi = u1 - uInset;
    const double vLo = v0 + vInset, vHi = v1 - vInset;

    std::vector<CurvatureSample> out;
    out.reserve(static_cast<std::size_t>(uSamples) * vSamples);

    for (std::uint32_t j = 0; j < vSamples; ++j) {
        for (std::uint32_t i = 0; i < uSamples; ++i) {
            const double uu = uLo + (uHi - uLo) * (i / static_cast<double>(uSamples - 1));
            const double vv = vLo + (vHi - vLo) * (j / static_cast<double>(vSamples - 1));
            CurvatureSample s{};
            s.u = uu;
            s.v = vv;
            try {
                GeomLProp_SLProps props(surf, uu, vv, /*N*/ 2,
                                        Precision::Confusion());
                if (!props.IsNormalDefined()) {
                    s.K_gaussian = 0.0;
                    s.H_mean     = 0.0;
                    s.kappaMax   = 0.0;
                    s.kappaMin   = 0.0;
                } else {
                    s.K_gaussian = props.GaussianCurvature();
                    s.H_mean     = props.MeanCurvature();
                    if (props.IsCurvatureDefined()) {
                        s.kappaMax = props.MaxCurvature();
                        s.kappaMin = props.MinCurvature();
                    }
                    if (!std::isfinite(s.K_gaussian)) s.K_gaussian = 0.0;
                    if (!std::isfinite(s.H_mean))     s.H_mean     = 0.0;
                    if (!std::isfinite(s.kappaMax))   s.kappaMax   = 0.0;
                    if (!std::isfinite(s.kappaMin))   s.kappaMin   = 0.0;
                }
            } catch (...) {
                s.K_gaussian = 0.0;
                s.H_mean     = 0.0;
                s.kappaMax   = 0.0;
                s.kappaMin   = 0.0;
            }
            out.push_back(s);
        }
    }
    return out;
}

// ============================================================ stitchG2
StitchReport stitchG2(const std::vector<ShapeHandle>& faces,
                      double tolerance,
                      bool reportContinuity) {
    if (faces.size() < 2) {
        throw std::invalid_argument(
            "forge.classa.stitchG2: need >= 2 faces to stitch");
    }
#ifdef FORGE_NATIVE_BREP
    // GATE: native sewer is opt-in via the FEAT gate (default OFF). When on AND
    // every input is a NativeSolid AND no per-edge continuity report is requested,
    // sew via brep::sewFaces; otherwise fall through to OCCT (any OCCT-backed input
    // or a continuity request HONESTLY DEFERS — no behaviour change in the default
    // build).
    if (native::brep::forgeNativeFeaturesEnabled()) {
        StitchReport nativeOut{};
        if (tryNativeStitchG2(faces, tolerance, reportContinuity, nativeOut)) {
            return nativeOut;
        }
        // native deferred -> OCCT path below (unchanged).
    }
#endif
    BRepBuilderAPI_Sewing sew(tolerance > 0 ? tolerance : 1e-3);
    // Keep TopoDS_Faces around so we can pair them with the sewn shape
    // when running the continuity report.
    std::vector<TopoDS_Face> srcFaces;
    srcFaces.reserve(faces.size());
    for (auto h : faces) {
        TopoDS_Face f = firstFaceOf(fetch(h), "stitchG2");
        sew.Add(f);
        srcFaces.push_back(f);
    }
    sew.Perform();
    TopoDS_Shape sewn = sew.SewedShape();
    if (sewn.IsNull()) {
        throw std::runtime_error(
            "forge.classa.stitchG2: BRepBuilderAPI_Sewing returned null");
    }
    StitchReport report{};
    report.handle = ShapeRegistry::instance().add(sewn);

    if (!reportContinuity) {
        report.edgeCount = 0;
        return report;
    }

    // Map every edge in the sewn shape to the faces that share it.
    TopTools_IndexedDataMapOfShapeListOfShape edgeFaceMap;
    TopExp::MapShapesAndAncestors(sewn, TopAbs_EDGE, TopAbs_FACE, edgeFaceMap);

    std::uint32_t sharedEdges = 0;
    for (Standard_Integer i = 1; i <= edgeFaceMap.Extent(); ++i) {
        const TopTools_ListOfShape& faceList = edgeFaceMap.FindFromIndex(i);
        if (faceList.Extent() < 2) continue;  // not a shared edge
        // Pick the first two faces sharing this edge.
        TopTools_ListOfShape::Iterator it(faceList);
        TopoDS_Face fA = TopoDS::Face(it.Value()); it.Next();
        TopoDS_Face fB = TopoDS::Face(it.Value());
        TopoDS_Edge eS = TopoDS::Edge(edgeFaceMap.FindKey(i));

        // Register the edge + faces transiently so continuityCheck can
        // resolve them via ShapeRegistry handles, mirroring the public
        // API. We retain locally then release at the end.
        ShapeHandle hA = ShapeRegistry::instance().add(fA);
        ShapeHandle hB = ShapeRegistry::instance().add(fB);
        ShapeHandle hE = ShapeRegistry::instance().add(eS);
        try {
            report.reports.push_back(continuityCheck(hA, hB, hE, 16));
            ++sharedEdges;
        } catch (...) {
            // Skip degenerate edges (seams, singular at sphere poles, …)
        }
        ShapeRegistry::instance().release(hA);
        ShapeRegistry::instance().release(hB);
        ShapeRegistry::instance().release(hE);
    }
    report.edgeCount = sharedEdges;
    return report;
}

// ============================================================ sweepWithGuides
ShapeHandle sweepWithGuides(ShapeHandle profileWire,
                            ShapeHandle spineCurve,
                            const std::vector<ShapeHandle>& guideCurves,
                            bool isFrenet,
                            bool isSolid) {
    TopoDS_Wire spine = firstWireOf(fetch(spineCurve), "sweepWithGuides(spine)");
    TopoDS_Wire profile = firstWireOf(fetch(profileWire), "sweepWithGuides(profile)");

    BRepOffsetAPI_MakePipeShell mk(spine);
    if (isFrenet) {
        mk.SetMode(/*IsFrenet*/ Standard_True);
    }
    // Each guide is added in curvilinear-equivalence mode so the pipe
    // follows the guide curvature, not just the spine.
    for (auto gh : guideCurves) {
        TopoDS_Wire g = firstWireOf(fetch(gh), "sweepWithGuides(guide)");
        // SetMode(auxiliarySpine, curvilinearEquivalence) is the guide
        // entry point. (KeepContact = ContactOnBorder lets the profile
        // ride the guide rather than being merely guided by tangent.)
        mk.SetMode(g, Standard_True);
    }
    mk.Add(profile);
    mk.Build();
    if (!mk.IsDone()) {
        throw std::runtime_error(
            "forge.classa.sweepWithGuides: pipe-shell build failed");
    }
    if (isSolid) {
        mk.MakeSolid();
    }
    return ShapeRegistry::instance().add(mk.Shape());
}

}}  // namespace forge::classa
