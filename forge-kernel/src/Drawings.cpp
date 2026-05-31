#include "forge/Drawings.hpp"

// Drawings.cpp — HLR projection of a 3D BREP to a 2D polyline soup.
//
// The pipeline is:
//   1. Build a gp_Ax2 aligned with the requested view direction.
//   2. Run HLRBRep_Algo::Add → Projector → Update → Hide.
//   3. Pull the four edge classes we care about out of HLRBRep_HLRToShape:
//      VCompound + Rg1LineVCompound + RgNLineVCompound  → visible bucket
//      HCompound + Rg1LineHCompound + RgNLineHCompound  → hidden bucket
//      OutLineVCompound                                  → outline bucket
//      (We deliberately ignore IsoLine{V,H}Compound — we don't request
//      iso-lines via Add(shape, nbIso=0).)
//   4. The HLR edges have only a 2D Curve2d on the projection plane.
//      BRepLib::BuildCurves3d hoists them into 3D so we can use a
//      BRepAdaptor_Curve to sample. The Z-coordinate after lift equals
//      0 in the projector frame; X and Y are the screen coords.
//   5. Discretise each edge with GCPnts_QuasiUniformDeflection at a
//      tight tolerance so circles / NURBS render smoothly in SVG.
//
// We don't invert Y here — the JS layer decides Y orientation when
// composing a sheet (SVG conventionally has Y pointing down, but we
// hand back model-space Y-up and let the JS converter flip).

#include "forge/ShapeRegistry.hpp"

#include <BRepLib.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <GCPnts_QuasiUniformDeflection.hxx>
#include <HLRAlgo_Projector.hxx>
#include <HLRBRep_Algo.hxx>
#include <HLRBRep_HLRToShape.hxx>
#include <Precision.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace forge {

// ---------------------------------------------------------- view presets
//
// Convention: HLR's projector looks along the +Z direction of the gp_Ax2.
// The "view direction" we expose is the direction *from the camera toward
// the model*, so the gp_Ax2's Z direction is the *opposite* (model toward
// camera). Choosing the X direction of the Ax2 picks the screen-right axis.

ProjectionDirection frontView()     { return { 0.0, -1.0,  0.0 }; }  // look along +Y
ProjectionDirection topView()       { return { 0.0,  0.0, -1.0 }; }  // look down
ProjectionDirection rightView()     { return { 1.0,  0.0,  0.0 }; }  // look along -X
ProjectionDirection isometricView() {
    // Classic SE-isometric: equal foreshortening of X, Y, Z.
    const double s = 1.0 / std::sqrt(3.0);
    return { s, -s, -s };
}

namespace {

// Build the projection Ax2 from a view direction. The Z of the Ax2 points
// *back* toward the viewer (so we negate). We pick the Ax2's X axis as the
// "screen right" direction:
//   * For pure top view  (z down)  : screen-X = world X.
//   * For pure front view (y back) : screen-X = world X.
//   * For pure right view (x back) : screen-X = world Y.
//   * Otherwise: any orthogonal direction works.
gp_Ax2 makeProjectionAx2(const ProjectionDirection& d) {
    const double len = std::sqrt(d.dx * d.dx + d.dy * d.dy + d.dz * d.dz);
    if (len < Precision::Confusion()) {
        throw std::invalid_argument("forge.drawings: zero-length view direction");
    }
    const double nx = d.dx / len, ny = d.dy / len, nz = d.dz / len;

    // Camera-to-model direction is (nx,ny,nz). HLR projector looks DOWN the
    // Ax2's Z axis, so the Ax2's Z direction is the inverse.
    const gp_Dir az(-nx, -ny, -nz);

    // Pick a screen-right vector orthogonal to az. Preference order:
    //   world +X if not parallel, else world +Y.
    gp_Dir ax;
    const double cx = -nx;  // dot(az, world+X)
    if (std::abs(cx) < 0.999) {
        gp_Dir worldX(1, 0, 0);
        // Project worldX onto plane perpendicular to az.
        const double dot = az.Dot(worldX);
        gp_Dir proj(worldX.X() - dot * az.X(),
                    worldX.Y() - dot * az.Y(),
                    worldX.Z() - dot * az.Z());
        ax = proj;
    } else {
        gp_Dir worldY(0, 1, 0);
        const double dot = az.Dot(worldY);
        gp_Dir proj(worldY.X() - dot * az.X(),
                    worldY.Y() - dot * az.Y(),
                    worldY.Z() - dot * az.Z());
        ax = proj;
    }

    return gp_Ax2(gp_Pnt(0, 0, 0), az, ax);
}

// Discretise one TopoDS_Edge into a Polyline2D. After BRepLib::BuildCurves3d
// the curve lives in the projector's local frame: X / Y are screen coords,
// Z is the depth (we drop it).
Polyline2D discretiseEdge(const TopoDS_Edge& edge, double deflection) {
    Polyline2D out;
    if (edge.IsNull()) return out;

    BRepAdaptor_Curve adaptor(edge);
    GCPnts_QuasiUniformDeflection sampler(adaptor, deflection);
    if (!sampler.IsDone() || sampler.NbPoints() < 2) {
        // Fallback: two endpoints only.
        try {
            gp_Pnt a = adaptor.Value(adaptor.FirstParameter());
            gp_Pnt b = adaptor.Value(adaptor.LastParameter());
            out.emplace_back(a.X(), a.Y());
            out.emplace_back(b.X(), b.Y());
        } catch (...) {
            // Bail; return empty polyline (skipped by caller).
        }
        return out;
    }

    out.reserve(sampler.NbPoints());
    for (int i = 1; i <= sampler.NbPoints(); ++i) {
        gp_Pnt p = sampler.Value(i);
        out.emplace_back(p.X(), p.Y());
    }
    return out;
}

// Walk a TopoDS_Compound (or any shape) for TopoDS_Edges, discretise each,
// and append the resulting polylines to `dst`. Edges that produce <2
// points after sampling are dropped.
void collectEdges(const TopoDS_Shape& compound,
                  std::vector<Polyline2D>& dst,
                  double deflection)
{
    if (compound.IsNull()) return;
    for (TopExp_Explorer ex(compound, TopAbs_EDGE); ex.More(); ex.Next()) {
        TopoDS_Edge e = TopoDS::Edge(ex.Current());
        Polyline2D pl = discretiseEdge(e, deflection);
        if (pl.size() >= 2) dst.push_back(std::move(pl));
    }
}

// Run HLR once and pull everything we care about out into `view`.
// Returns false if Update / Hide threw — the caller can decide whether to
// fall back to tessellation-first retry.
bool runHLR(const TopoDS_Shape& shape,
            const gp_Ax2& ax2,
            ProjectedView& view,
            double deflection)
{
    Handle(HLRBRep_Algo) hlr = new HLRBRep_Algo();
    hlr->Add(shape);
    HLRAlgo_Projector projector(ax2);
    hlr->Projector(projector);

    try {
        hlr->Update();
        hlr->Hide();
    } catch (const Standard_Failure&) {
        return false;
    } catch (...) {
        return false;
    }

    HLRBRep_HLRToShape extractor(hlr);

    // ----- visible -----
    {
        TopoDS_Shape vc = extractor.VCompound();
        if (!vc.IsNull()) { BRepLib::BuildCurves3d(vc); collectEdges(vc, view.visible, deflection); }
        TopoDS_Shape rg1 = extractor.Rg1LineVCompound();
        if (!rg1.IsNull()) { BRepLib::BuildCurves3d(rg1); collectEdges(rg1, view.visible, deflection); }
        TopoDS_Shape rgn = extractor.RgNLineVCompound();
        if (!rgn.IsNull()) { BRepLib::BuildCurves3d(rgn); collectEdges(rgn, view.visible, deflection); }
    }

    // ----- hidden -----
    {
        TopoDS_Shape hc = extractor.HCompound();
        if (!hc.IsNull()) { BRepLib::BuildCurves3d(hc); collectEdges(hc, view.hidden, deflection); }
        TopoDS_Shape rg1 = extractor.Rg1LineHCompound();
        if (!rg1.IsNull()) { BRepLib::BuildCurves3d(rg1); collectEdges(rg1, view.hidden, deflection); }
        TopoDS_Shape rgn = extractor.RgNLineHCompound();
        if (!rgn.IsNull()) { BRepLib::BuildCurves3d(rgn); collectEdges(rgn, view.hidden, deflection); }
    }

    // ----- silhouette / outline (visible only) -----
    {
        TopoDS_Shape ol = extractor.OutLineVCompound();
        if (!ol.IsNull()) { BRepLib::BuildCurves3d(ol); collectEdges(ol, view.outline, deflection); }
    }

    return true;
}

} // namespace

ProjectedView projectShape(ShapeHandle h, ProjectionDirection direction) {
    const auto& shape = ShapeRegistry::instance().get(h);
    if (shape.IsNull()) {
        throw std::runtime_error("forge.drawings.projectShape: shape is null");
    }

    const gp_Ax2 ax2 = makeProjectionAx2(direction);

    // Curve-sampling deflection. Tight enough that a 100 mm radius circle
    // becomes ~100 vertices, which renders smoothly in SVG without blowing
    // up message size for typical assembly views.
    constexpr double kDeflection = 0.05;

    ProjectedView view;
    bool ok = runHLR(shape, ax2, view, kDeflection);

    // Heuristic retry: if the first pass produced nothing visible, OCCT
    // may have rejected the shape because it lacks a triangulation
    // (some versions of HLR refuse curved faces without it). Force a
    // tessellation and try once more.
    if (!ok || view.visible.empty()) {
        BRepMesh_IncrementalMesh mesher(shape, 0.1, Standard_False, 0.5, Standard_True);
        mesher.Perform();

        ProjectedView retry;
        if (runHLR(shape, ax2, retry, kDeflection)) {
            // Prefer the retry if it found visible edges; otherwise stick
            // with whatever the first pass produced (could legitimately
            // be empty for a pathological shape).
            if (!retry.visible.empty()) view = std::move(retry);
        }
    }

    return view;
}

// ---------------------------------------------------------- Forge-32 helpers

namespace {

// Re-export the projection Ax2 builder under a name visible to the second
// anonymous namespace below (the first namespace closed at line 214). We
// just re-declare an alias so projectShapeSection() can use it.
gp_Ax2 makeProjectionAx2_(const ProjectionDirection& d) {
    const double len = std::sqrt(d.dx * d.dx + d.dy * d.dy + d.dz * d.dz);
    if (len < Precision::Confusion()) {
        throw std::invalid_argument("forge.drawings: zero-length view direction");
    }
    const double nx = d.dx / len, ny = d.dy / len, nz = d.dz / len;
    const gp_Dir az(-nx, -ny, -nz);
    gp_Dir ax;
    const double cx = -nx;
    if (std::abs(cx) < 0.999) {
        gp_Dir worldX(1, 0, 0);
        const double dot = az.Dot(worldX);
        gp_Dir proj(worldX.X() - dot * az.X(),
                    worldX.Y() - dot * az.Y(),
                    worldX.Z() - dot * az.Z());
        ax = proj;
    } else {
        gp_Dir worldY(0, 1, 0);
        const double dot = az.Dot(worldY);
        gp_Dir proj(worldY.X() - dot * az.X(),
                    worldY.Y() - dot * az.Y(),
                    worldY.Z() - dot * az.Z());
        ax = proj;
    }
    return gp_Ax2(gp_Pnt(0, 0, 0), az, ax);
}

// Compute the projected (x, y) of a 3D point under the given Ax2.
// Mirrors HLR's screen-space coordinates: project the world point onto
// the Ax2 plane, then read the local (x, y) along ax.XDirection /
// ax.YDirection.
void worldToScreen(const gp_Ax2& ax, const gp_Pnt& p, double& sx, double& sy) {
    const gp_Pnt& loc = ax.Location();
    const gp_Dir& xd  = ax.XDirection();
    const gp_Dir& yd  = ax.YDirection();
    const double dx = p.X() - loc.X();
    const double dy = p.Y() - loc.Y();
    const double dz = p.Z() - loc.Z();
    sx = dx * xd.X() + dy * xd.Y() + dz * xd.Z();
    sy = dx * yd.X() + dy * yd.Y() + dz * yd.Z();
}

// 2D bbox helper across a vector of polylines.
struct Bbox2D {
    double minX = std::numeric_limits<double>::infinity();
    double minY = std::numeric_limits<double>::infinity();
    double maxX = -std::numeric_limits<double>::infinity();
    double maxY = -std::numeric_limits<double>::infinity();
    bool empty() const { return !std::isfinite(minX); }
    void add(double x, double y) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
};

Bbox2D viewBbox(const ProjectedView& v) {
    Bbox2D b;
    auto walk = [&](const std::vector<Polyline2D>& bucket) {
        for (const auto& p : bucket) {
            for (const auto& xy : p) b.add(xy.first, xy.second);
        }
    };
    walk(v.visible);
    walk(v.hidden);
    walk(v.outline);
    walk(v.cut);
    return b;
}

// Cohen-Sutherland-style clip of a single 2D segment against a circle.
// Returns the (possibly two) parametric intersections t in [0,1] where
// (1-t)*p0 + t*p1 sits exactly on the circle.
bool clipSegmentToCircle(double x0, double y0, double x1, double y1,
                         double cx, double cy, double r,
                         double& tEnter, double& tExit)
{
    const double dx = x1 - x0;
    const double dy = y1 - y0;
    const double fx = x0 - cx;
    const double fy = y0 - cy;
    const double A = dx * dx + dy * dy;
    if (A < 1e-20) return false;
    const double B = 2.0 * (fx * dx + fy * dy);
    const double C = fx * fx + fy * fy - r * r;
    const double disc = B * B - 4.0 * A * C;
    if (disc < 0) return false;
    const double s = std::sqrt(disc);
    const double t0 = (-B - s) / (2.0 * A);
    const double t1 = (-B + s) / (2.0 * A);
    tEnter = std::max(0.0, std::min(1.0, t0));
    tExit  = std::max(0.0, std::min(1.0, t1));
    if (tExit <= tEnter) return false;
    return true;
}

// Clip a polyline against a circle, returning the list of sub-polylines
// that lie *inside* the circle. Vertex-walk: track inside/outside state,
// emit segment intersections when crossing the boundary.
std::vector<Polyline2D> clipPolylineToCircle(const Polyline2D& pl,
                                             double cx, double cy, double r)
{
    std::vector<Polyline2D> out;
    if (pl.size() < 2) return out;
    auto inside = [&](double x, double y) {
        const double dx = x - cx, dy = y - cy;
        return dx * dx + dy * dy <= r * r + 1e-9;
    };

    Polyline2D current;
    for (size_t i = 0; i + 1 < pl.size(); ++i) {
        const double x0 = pl[i].first,     y0 = pl[i].second;
        const double x1 = pl[i + 1].first, y1 = pl[i + 1].second;
        const bool in0 = inside(x0, y0);
        const bool in1 = inside(x1, y1);

        if (in0 && in1) {
            if (current.empty()) current.emplace_back(x0, y0);
            current.emplace_back(x1, y1);
        } else if (in0 && !in1) {
            double tEnter, tExit;
            if (clipSegmentToCircle(x0, y0, x1, y1, cx, cy, r, tEnter, tExit)) {
                if (current.empty()) current.emplace_back(x0, y0);
                const double xe = x0 + tExit * (x1 - x0);
                const double ye = y0 + tExit * (y1 - y0);
                current.emplace_back(xe, ye);
            }
            if (current.size() >= 2) out.push_back(std::move(current));
            current.clear();
        } else if (!in0 && in1) {
            double tEnter, tExit;
            if (clipSegmentToCircle(x0, y0, x1, y1, cx, cy, r, tEnter, tExit)) {
                const double xs = x0 + tEnter * (x1 - x0);
                const double ys = y0 + tEnter * (y1 - y0);
                current.clear();
                current.emplace_back(xs, ys);
                current.emplace_back(x1, y1);
            }
        } else {
            // Both outside — segment may still pass through.
            double tEnter, tExit;
            if (clipSegmentToCircle(x0, y0, x1, y1, cx, cy, r, tEnter, tExit)
                && (tExit - tEnter) > 1e-6) {
                Polyline2D thru;
                thru.emplace_back(x0 + tEnter * (x1 - x0),
                                  y0 + tEnter * (y1 - y0));
                thru.emplace_back(x0 + tExit  * (x1 - x0),
                                  y0 + tExit  * (y1 - y0));
                out.push_back(std::move(thru));
            }
        }
    }
    if (current.size() >= 2) out.push_back(std::move(current));
    return out;
}

// Generate the 45° (or arbitrary-angle) hatch pattern over a 2D polygon
// bbox. We emit horizontal-equivalent lines after rotating the bbox into
// the hatch frame, then clip each line to the bbox in that frame and
// rotate back. Caller may then clip to actual cut faces; for now we just
// fill the bbox of the cut wires.
std::vector<Polyline2D> hatchBbox(const Bbox2D& bb,
                                  double spacing, double angleDeg)
{
    std::vector<Polyline2D> lines;
    if (bb.empty() || spacing <= 1e-6) return lines;
    const double a = angleDeg * M_PI / 180.0;
    const double ca = std::cos(a);
    const double sa = std::sin(a);

    // Corners in hatch frame: (u,v) where u = x*ca + y*sa, v = -x*sa + y*ca.
    auto toUV = [&](double x, double y, double& u, double& v) {
        u =  x * ca + y * sa;
        v = -x * sa + y * ca;
    };
    auto fromUV = [&](double u, double v, double& x, double& y) {
        x = u * ca - v * sa;
        y = u * sa + v * ca;
    };

    double u0, v0, u1, v1, u2, v2, u3, v3;
    toUV(bb.minX, bb.minY, u0, v0);
    toUV(bb.maxX, bb.minY, u1, v1);
    toUV(bb.maxX, bb.maxY, u2, v2);
    toUV(bb.minX, bb.maxY, u3, v3);
    const double uMin = std::min({u0, u1, u2, u3});
    const double uMax = std::max({u0, u1, u2, u3});
    const double vMin = std::min({v0, v1, v2, v3});
    const double vMax = std::max({v0, v1, v2, v3});

    // Sweep along v at `spacing` intervals; each hatch line is at constant v.
    const int N = static_cast<int>(std::ceil((vMax - vMin) / spacing));
    for (int i = 0; i <= N; ++i) {
        const double v = vMin + i * spacing;
        if (v > vMax) break;
        double xa, ya, xb, yb;
        fromUV(uMin, v, xa, ya);
        fromUV(uMax, v, xb, yb);
        Polyline2D pl;
        pl.emplace_back(xa, ya);
        pl.emplace_back(xb, yb);
        lines.push_back(std::move(pl));
    }
    return lines;
}

} // anonymous namespace

ProjectedView projectShapeSection(ShapeHandle h,
                                  ProjectionDirection direction,
                                  SectionPlane plane,
                                  HatchSpec hatch)
{
    const auto& shape = ShapeRegistry::instance().get(h);
    if (shape.IsNull()) {
        throw std::runtime_error("forge.drawings.projectShapeSection: shape is null");
    }

    // 1) baseline HLR projection (visible/hidden/outline buckets).
    ProjectedView view = projectShape(h, direction);

    // 2) intersect with the cutting plane to get the cut wires.
    const double nlen = std::sqrt(plane.nx * plane.nx + plane.ny * plane.ny + plane.nz * plane.nz);
    if (nlen < Precision::Confusion()) {
        throw std::invalid_argument("forge.drawings.projectShapeSection: zero-length plane normal");
    }
    gp_Pln cuttingPlane(gp_Pnt(plane.ox, plane.oy, plane.oz),
                        gp_Dir(plane.nx / nlen, plane.ny / nlen, plane.nz / nlen));

    try {
        BRepAlgoAPI_Section sec(shape, cuttingPlane, Standard_False);
        sec.ComputePCurveOn1(Standard_True);
        sec.Approximation(Standard_True);
        sec.Build();
        if (sec.IsDone()) {
            const gp_Ax2 ax = makeProjectionAx2_(direction);
            for (TopExp_Explorer ex(sec.Shape(), TopAbs_EDGE); ex.More(); ex.Next()) {
                TopoDS_Edge e = TopoDS::Edge(ex.Current());
                if (e.IsNull()) continue;
                try {
                    BRepAdaptor_Curve adaptor(e);
                    GCPnts_QuasiUniformDeflection sampler(adaptor, 0.1);
                    Polyline2D pl;
                    if (sampler.IsDone() && sampler.NbPoints() >= 2) {
                        for (int i = 1; i <= sampler.NbPoints(); ++i) {
                            gp_Pnt p = sampler.Value(i);
                            double sx, sy;
                            worldToScreen(ax, p, sx, sy);
                            pl.emplace_back(sx, sy);
                        }
                    } else {
                        gp_Pnt a = adaptor.Value(adaptor.FirstParameter());
                        gp_Pnt b = adaptor.Value(adaptor.LastParameter());
                        double sx, sy;
                        worldToScreen(ax, a, sx, sy); pl.emplace_back(sx, sy);
                        worldToScreen(ax, b, sx, sy); pl.emplace_back(sx, sy);
                    }
                    if (pl.size() >= 2) view.cut.push_back(std::move(pl));
                } catch (...) {
                    // skip pathological edge
                }
            }
        }
    } catch (const Standard_Failure&) {
        // Plane misses the shape, etc — leave cut/hatch empty.
    }

    // 3) emit hatch lines over the cut-wire bbox.
    {
        Bbox2D bb;
        for (const auto& pl : view.cut) {
            for (const auto& xy : pl) bb.add(xy.first, xy.second);
        }
        if (!bb.empty()) {
            const double spacing  = hatch.spacing  > 1e-6 ? hatch.spacing  : 2.5;
            const double angleDeg = std::isfinite(hatch.angleDeg) ? hatch.angleDeg : 45.0;
            view.hatch = hatchBbox(bb, spacing, angleDeg);
        }
    }

    return view;
}

ProjectedView projectShapeDetail(ShapeHandle h,
                                 ProjectionDirection direction,
                                 FocusCircle focus,
                                 double scale)
{
    if (focus.r <= 1e-6) {
        throw std::invalid_argument("forge.drawings.projectShapeDetail: focus radius must be > 0");
    }
    if (scale <= 1e-6) {
        throw std::invalid_argument("forge.drawings.projectShapeDetail: scale must be > 0");
    }
    ProjectedView base = projectShape(h, direction);

    auto clipBucket = [&](const std::vector<Polyline2D>& src) {
        std::vector<Polyline2D> out;
        out.reserve(src.size());
        for (const auto& pl : src) {
            auto pieces = clipPolylineToCircle(pl, focus.x, focus.y, focus.r);
            for (auto& sub : pieces) {
                // translate so circle centre → origin, scale, translate back.
                for (auto& xy : sub) {
                    xy.first  = (xy.first  - focus.x) * scale + focus.x;
                    xy.second = (xy.second - focus.y) * scale + focus.y;
                }
                out.push_back(std::move(sub));
            }
        }
        return out;
    };
    ProjectedView dv;
    dv.visible = clipBucket(base.visible);
    dv.hidden  = clipBucket(base.hidden);
    dv.outline = clipBucket(base.outline);
    return dv;
}

ProjectedView projectShapeBroken(ShapeHandle h,
                                 ProjectionDirection direction,
                                 BreakRegion region)
{
    if (region.end <= region.start) {
        throw std::invalid_argument("forge.drawings.projectShapeBroken: end must be > start");
    }
    ProjectedView base = projectShape(h, direction);
    const double gap = region.end - region.start;
    const int axis = (region.axis == 1) ? 1 : 0;

    auto axisCoord = [&](double x, double y) { return axis == 0 ? x : y; };

    auto crush = [&](const std::vector<Polyline2D>& src) {
        std::vector<Polyline2D> out;
        out.reserve(src.size());
        for (const auto& pl : src) {
            // Compute polyline mean along axis.
            double sum = 0.0;
            for (const auto& xy : pl) sum += axisCoord(xy.first, xy.second);
            const double mid = sum / std::max<size_t>(1, pl.size());
            if (mid > region.start && mid < region.end) {
                continue;  // polyline lives inside the break — drop it
            }
            Polyline2D moved;
            moved.reserve(pl.size());
            for (const auto& xy : pl) {
                double x = xy.first, y = xy.second;
                if (axisCoord(x, y) >= region.end) {
                    if (axis == 0) x -= gap; else y -= gap;
                }
                moved.emplace_back(x, y);
            }
            out.push_back(std::move(moved));
        }
        return out;
    };

    ProjectedView bv;
    bv.visible = crush(base.visible);
    bv.hidden  = crush(base.hidden);
    bv.outline = crush(base.outline);
    return bv;
}

} // namespace forge
