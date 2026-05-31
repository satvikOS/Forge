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
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

#include <cmath>
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

} // namespace forge
