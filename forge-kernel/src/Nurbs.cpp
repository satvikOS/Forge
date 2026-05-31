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
    if (trimUV.size() < 6 || (trimUV.size() % 2) != 0) {
        throw std::invalid_argument(
            "forge.surfacing.trimNurbsFace: trimUV must have >= 3 (u,v) pairs");
    }
    const TopoDS_Face f = firstFaceOf(fetch(face), "trimNurbsFace");
    Handle(Geom_Surface) s = surfaceOf(f, "trimNurbsFace");

    // Build a parametric polyline wire in 3D by evaluating the surface at
    // each (u, v) sample — the resulting wire lives on the surface so
    // BRepBuilderAPI_MakeFace(surface, wire) accepts it as a trim.
    BRepBuilderAPI_MakeWire wireMk;
    const std::size_t n = trimUV.size() / 2;
    auto eval = [&](std::size_t i) {
        gp_Pnt p; s->D0(trimUV[2*i], trimUV[2*i + 1], p);
        return p;
    };
    for (std::size_t i = 0; i < n; ++i) {
        gp_Pnt a = eval(i);
        gp_Pnt b = eval((i + 1) % n);
        if (a.Distance(b) < Precision::Confusion()) continue;
        BRepBuilderAPI_MakeEdge edgeMk(a, b);
        if (!edgeMk.IsDone()) continue;
        wireMk.Add(edgeMk.Edge());
    }
    if (!wireMk.IsDone()) {
        throw std::runtime_error(
            "forge.surfacing.trimNurbsFace: failed to assemble trim wire");
    }
    BRepBuilderAPI_MakeFace mk(s, wireMk.Wire(), /*inside*/ Standard_True);
    if (!mk.IsDone()) {
        throw std::runtime_error(
            "forge.surfacing.trimNurbsFace: MakeFace(surface, wire) failed");
    }
    return ShapeRegistry::instance().add(mk.Face());
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
