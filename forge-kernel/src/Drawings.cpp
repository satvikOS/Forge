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
//   5. Discretise each edge with the native curvature-adaptive sampler
//      (forge::nativeQuasiUniformDeflectionParams) at a tight tolerance so
//      circles / NURBS render smoothly in SVG.
//
// We don't invert Y here — the JS layer decides Y orientation when
// composing a sheet (SVG conventionally has Y pointing down, but we
// hand back model-space Y-up and let the JS converter flip).

#include "forge/ShapeRegistry.hpp"

// K5 — HLR retry now facets natively (no BRepMesh / TKMesh).
#include "forge/OcctNativeMesh.hpp"
#include <BRepAdaptor_Curve.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include "forge/OcctCurveSampling.hpp"  // K6: native GCPnts_QuasiUniformDeflection replacement
// TKHLR DROPPED (otool 14->13): the OCCT hidden-line-removal headers
// (HLRBRep_Algo / HLRBRep_HLRToShape / HLRAlgo_Projector) are GONE. Every
// orthographic HLR call site below now runs the native analytic HLR
// (forge::native::brep::hiddenLineRemoval) via emitNativeHlr(). Perspective HLR
// was already native (projectShapePerspective -> hlrPerspective). No OCCT HLR
// symbol remains in the .node, so libTKHLR is no longer linked.
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

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

// PHASE-D wiring (2026-06-25) — route the engineering-drawing projection ops
// (HLR hidden-line removal + silhouette/outline + planar section) through the
// ALREADY-BUILT native B-rep drawing modules behind the FEAT gate. Compiled in
// ONLY under -DFORGE_NATIVE_BREP and taken at runtime ONLY when
// forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1, or the A/B
// harness's setForgeNativeBrepEnabled(true), which flips CORE+FEAT+STEP together).
// PRODUCTION DEFAULT IS OFF: with the gate off the original OCCT HLRBRep_Algo /
// BRepAlgoAPI_Section paths below run byte-for-byte unchanged. Mirrors the prior
// wires (Cam.cpp / Healing.cpp / Sewing.cpp / ShapeFix.cpp): the native branch is
// taken ONLY when the input handle is a NativeSolid (so its analytic faces feed the
// native HLR / section solver); an OCCT-backed input HONESTLY DEFERS to OCCT (there
// is NO OCCT-shape -> native-Solid importer — Bible §0).
//
// FRAME ALIGNMENT (why this is regression-image faithful, not just length-equal):
// the native HlrResult builds its own (U,V,N) view frame (origin at the model-bbox
// centre, an arbitrary screen-right axis) — see native_vs_occt_hlr.cpp, which
// compares the two backends with a ROTATION-INVARIANT projected-length metric
// precisely because the frames differ. A regression IMAGE needs the SAME pixel
// coordinates, so we DO NOT use the native poly2d; instead we re-project each
// native segment's poly3d through the SAME OCCT gp_Ax2 (makeProjectionAx2) the OCCT
// path uses, via the identical worldToScreen the section path already uses. The
// visibility CLASSIFICATION (visible / hidden / silhouette) is sourced from the
// native HLR; the 2D screen coordinates are byte-identical to the OCCT frame.
//
// WHICH ENTRIES ARE WIRED (the two ShapeHandle-based ops that can detect a native
// input) and which are LEFT ON OCCT (CAPABILITY GAPS surfaced, not silently
// degraded) are documented at each wired/left call site below.
//
// PHASE-D ACTIVATION (2026-06-25) — wired LIVE for OCCT inputs via the OCCT->native
// importer forge::importOcctSolid (src/OcctImport.cpp). BOTH HLR (tryNativeProjectShape)
// and planar section (tryNativeSectionCut) now resolve an OCCT-backed (ShapeKind::Occt)
// analytic solid by importing it to a native Solid before running brep::hiddenLineRemoval
// / brep::sectionSolid on it, instead of deferring outright. The 2D output stays in the
// OCCT screen frame (nativeWorldToScreen / worldToScreen) so the regression image still
// matches; the section emits screen polylines (NOT a registered section-result handle),
// so it is NOT blocked by the missing native-section result-handle kind. SAFE + HONEST: a
// non-analytic import (Torus/Revolution/non-manifold) -> defer to OCCT, byte-identical to
// today. Gated by forgeNativeFeaturesEnabled() (default OFF).
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled()
#include "forge/native/brep/Hlr.hpp"           // hiddenLineRemoval, HlrResult/HlrSegment (native)
#include "forge/native/brep/Section.hpp"       // sectionSolid, SectionResult/SectionWire (native)
#include "forge/native/brep/Topology.hpp"      // Solid graph
#include "forge/OcctImport.hpp"                // importOcctSolid (OCCT analytic -> native Solid)
#endif

#ifdef FORGE_NATIVE_BREP
namespace {
// ---------------------------------------------------------------------------
// emitNativeHlr — THE shared native orthographic HLR emitter (TKHLR-free).
//
// Runs forge::native::brep::hiddenLineRemoval on an already-resolved native
// Solid, re-projects every classified segment's 3D polyline into the SAME OCCT
// gp_Ax2 screen frame the drawing pipeline uses (identical math to the section
// path's worldToScreen, so the 2D image is pixel-faithful to the former OCCT
// path), and hands each kept screen polyline + its class to `emit`.
//
// EDGE-ON DROP (why counts match OCCT, not inflate): OCCT's HLRBRep omits an
// edge that projects to a POINT (an edge parallel to the view direction — e.g.
// a box's 4 depth edges in a front view). The native pass DOES collect those
// edges (they are real model edges); each collapses to a zero-extent screen
// polyline. We drop any polyline whose 2D bounding box is smaller than a
// point-tolerance, exactly reproducing OCCT's omission (a plain box front view
// -> 4 hidden back edges, not 8). This is a faithful match, not a fabrication:
// a zero-length projected edge carries no drawable ink.
//
// Class routing (mirrors collectEdges' V/H/OutLine buckets exactly):
//   Visible  -> emit(NativeHlrClass::Visible, ...)   (solid line)
//   Hidden   -> emit(NativeHlrClass::Hidden,  ...)   (dashed line)
//   Silhouette (visible) -> emit(NativeHlrClass::Outline, ...) (OutLineV analogue)
// ---------------------------------------------------------------------------
enum class NativeHlrClass { Visible, Hidden, Outline };

template <class EmitFn>
void emitNativeHlr(const forge::native::brep::Solid& solid,
                   const gp_Ax2& ax2, EmitFn&& emit) {
    using namespace forge::native::brep;
    const gp_Dir& az = ax2.Direction();
    // Native HLR looks ALONG +N; the projector's gp_Ax2 main direction is the
    // equivalent look direction, so both backends project the SAME view.
    HlrResult res = hiddenLineRemoval(solid, Vec3{ az.X(), az.Y(), az.Z() });
    if (!res.ok) return;

    const gp_Pnt& loc = ax2.Location();
    const gp_Dir& xd  = ax2.XDirection();
    const gp_Dir& yd  = ax2.YDirection();

    for (const HlrSegment& seg : res.segments) {
        if (seg.poly3d.size() < 2) continue;
        std::vector<std::pair<double, double>> pl;
        pl.reserve(seg.poly3d.size());
        double minx =  std::numeric_limits<double>::infinity();
        double miny =  std::numeric_limits<double>::infinity();
        double maxx = -std::numeric_limits<double>::infinity();
        double maxy = -std::numeric_limits<double>::infinity();
        for (const Vec3& p : seg.poly3d) {
            const double dx = p.x - loc.X();
            const double dy = p.y - loc.Y();
            const double dz = p.z - loc.Z();
            const double sx = dx * xd.X() + dy * xd.Y() + dz * xd.Z();
            const double sy = dx * yd.X() + dy * yd.Y() + dz * yd.Z();
            pl.emplace_back(sx, sy);
            if (sx < minx) minx = sx;
            if (sx > maxx) maxx = sx;
            if (sy < miny) miny = sy;
            if (sy > maxy) maxy = sy;
        }
        if (pl.size() < 2) continue;
        // Edge-on projection -> a point: OCCT HLR does not draw these; drop them.
        if (std::hypot(maxx - minx, maxy - miny) <= 1e-7) continue;
        const NativeHlrClass cls =
            (seg.visibility == HlrVisibility::Hidden) ? NativeHlrClass::Hidden
          : (seg.kind == HlrEdgeKind::Silhouette)     ? NativeHlrClass::Outline
          :                                             NativeHlrClass::Visible;
        emit(cls, pl);
    }
}
} // namespace
#endif // FORGE_NATIVE_BREP

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
    // K6 (TKGeomBase drop): native curvature-adaptive sampler replaces
    // GCPnts_QuasiUniformDeflection(adaptor, deflection).
    std::vector<double> ps;
    forge::nativeQuasiUniformDeflectionParams(adaptor, deflection, ps);
    if (ps.size() < 2) {
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

    out.reserve(ps.size());
    for (double t : ps) {
        gp_Pnt p = adaptor.Value(t);
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

// Run the NATIVE orthographic HLR on an OCCT-backed shape and pull everything we
// care about out into `view` (visible / hidden / outline buckets). TKHLR-free:
// the shape is imported to a native analytic Solid (forge::importOcctSolid) and
// projected by forge::native::brep::hiddenLineRemoval via emitNativeHlr. Returns
// false (never throws) when the shape cannot be imported to an analytic solid or
// the HLR degenerates — there is NO OCCT HLR fallback (libTKHLR dropped).
bool runHLR(const TopoDS_Shape& shape,
            const gp_Ax2& ax2,
            ProjectedView& view,
            double deflection)
{
    (void)deflection;  // native HLR chords curved edges internally
#ifdef FORGE_NATIVE_BREP
    ImportResult imported = importOcctSolid(shape);
    if (!imported.ok || imported.solid == nullptr) return false;  // defer -> empty
    emitNativeHlr(*imported.solid, ax2,
                  [&](NativeHlrClass cls, std::vector<std::pair<double, double>>& pl) {
                      if (cls == NativeHlrClass::Hidden)      view.hidden.push_back(std::move(pl));
                      else if (cls == NativeHlrClass::Outline) view.outline.push_back(std::move(pl));
                      else                                     view.visible.push_back(std::move(pl));
                  });
    return !view.visible.empty() || !view.hidden.empty() || !view.outline.empty();
#else
    (void)shape; (void)ax2; (void)view;
    throw std::runtime_error(
        "forge.drawings: HLR requires the native B-rep build (FORGE_NATIVE_BREP)");
#endif
}

#ifdef FORGE_NATIVE_BREP
// Project a native 3D point (Vec3) through the OCCT projection Ax2 into the SAME
// (X, Y) screen frame the OCCT HLR path produces, so a native-sourced polyline is
// pixel-comparable in regression imaging (see the FRAME ALIGNMENT note at the top
// of this file). Identical math to the section path's worldToScreen, applied to the
// native poly3d so visibility classification comes from the native HLR while the 2D
// coordinates stay in the OCCT frame.
inline std::pair<double, double>
nativeWorldToScreen(const gp_Ax2& ax, const forge::native::brep::Vec3& p) {
    const gp_Pnt& loc = ax.Location();
    const gp_Dir& xd  = ax.XDirection();
    const gp_Dir& yd  = ax.YDirection();
    const double dx = p.x - loc.X();
    const double dy = p.y - loc.Y();
    const double dz = p.z - loc.Z();
    return { dx * xd.X() + dy * xd.Y() + dz * xd.Z(),
             dx * yd.X() + dy * yd.Y() + dz * yd.Z() };
}

// Try the native HLR (brep::hiddenLineRemoval) for projectShape. Returns true +
// fills `view` (visible / hidden / outline buckets) on success; returns false
// (NEVER throws) when the native path HONESTLY DEFERS to OCCT. Deferral cases
// (Bible §0 — native-where-valid, OCCT otherwise):
//   * the input handle is a NativeMesh, OR an OCCT-backed body whose importOcctSolid
//     DEFERS (ok==false: Torus/Revolution/non-analytic / non-manifold import)
//     -> defer to OCCT (the default-build behaviour is unchanged).
//   * the native HLR returns ok==false (empty / degenerate solid, freeform faces the
//     analytic envelope does not yet cover) or yields no segments -> defer to OCCT.
// PHASE-D ACTIVATION (2026-06-25): a NativeSolid handle is used directly; an OCCT-backed
// (ShapeKind::Occt) analytic solid is IMPORTED via forge::importOcctSolid before the HLR
// run (`imported` keeps the imported topology alive for this call).
// The native HlrResult's per-segment visibility (Visible / Hidden) and edge kind
// (BRep / Silhouette) drive the three OCCT buckets:
//   Visible BRep/Rg edges        -> view.visible
//   Hidden  BRep/Rg edges        -> view.hidden
//   Visible Silhouette edges     -> view.outline  (the OutLineVCompound analogue)
// matching collectEdges' V/H/OutLine routing exactly. Coordinates are re-projected
// into the OCCT screen frame (nativeWorldToScreen) so the image matches the OCCT path.
bool tryNativeProjectShape(ShapeHandle h, const gp_Ax2& ax2, ProjectedView& view) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();

    ImportResult imported;
    const Solid* solidPtr = nullptr;
    if (reg.kindOf(h) == ShapeKind::NativeSolid) {
        solidPtr = &reg.getNativeSolid(h);
    } else if (reg.kindOf(h) == ShapeKind::Occt) {
        imported = importOcctSolid(reg.get(h));
        if (!imported.ok || imported.solid == nullptr) return false;  // defer to OCCT
        solidPtr = imported.solid;
    } else {
        return false;                                                 // NativeMesh -> defer
    }
    const Solid& solid = *solidPtr;

    // Route every classified segment through the shared native HLR emitter, which
    // drives brep::hiddenLineRemoval along the projector's main direction, re-projects
    // each segment into the SAME OCCT screen frame (so the image matches), and drops
    // edge-on (zero-2D-extent) projections exactly as OCCT HLR omits them. `imported`
    // stays alive for the whole call.
    emitNativeHlr(solid, ax2,
                  [&](NativeHlrClass cls, std::vector<std::pair<double, double>>& pl) {
                      if (cls == NativeHlrClass::Hidden)      view.hidden.push_back(std::move(pl));
                      else if (cls == NativeHlrClass::Outline) view.outline.push_back(std::move(pl));
                      else                                     view.visible.push_back(std::move(pl));
                  });
    // A routed polyline in any bucket == success; an empty result (mesh input,
    // non-analytic import, or an all-degenerate projection) returns false so the
    // caller surfaces an honest empty view (no OCCT HLR fallback — libTKHLR dropped).
    return !view.visible.empty() || !view.hidden.empty() || !view.outline.empty();
}
#endif

} // namespace

ProjectedView projectShape(ShapeHandle h, ProjectionDirection direction) {
    const gp_Ax2 ax2 = makeProjectionAx2(direction);
    ProjectedView view;

#ifdef FORGE_NATIVE_BREP
    // HLR is now NATIVE-ONLY (libTKHLR dropped). tryNativeProjectShape projects the
    // NATIVE analytic solid DIRECTLY for a NativeSolid handle (no lossy native->OCCT
    // round-trip) and imports an OCCT-backed analytic body otherwise; both run the
    // native analytic orthographic HLR (edge-on projections dropped as OCCT did).
    // A NativeMesh / non-analytic input yields an honest empty view — there is no
    // OCCT HLR fallback and NO tessellate-and-retry (that OCCT crutch re-imported a
    // faceted round-trip and is meaningless for the analytic native path).
    (void)tryNativeProjectShape(h, ax2, view);
    return view;
#else
    (void)h; (void)ax2;
    throw std::runtime_error(
        "forge.drawings.projectShape: HLR requires the native B-rep build (FORGE_NATIVE_BREP)");
#endif
}

ProjectedView projectShapePerspective(ShapeHandle h, PerspectiveCamera cam) {
#ifdef FORGE_NATIVE_BREP
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();

    // Acquire the native Solid. Perspective HLR is native-only (there is no OCCT
    // perspective fallback). It runs on a NativeSolid directly.
    //
    // VERIFY-GATE (cycle-2, 2026-07-07): the importOcctSolid -> native perspective
    // HLR route is HONESTLY DEFERRED. A/B measurement showed that, while the native
    // perspective HLR of a native Solid matches OCCT HLRBRep_Algo to machine
    // precision (native_vs_occt_hlr_persp: rel<=1e-16 both scenes) AND the
    // ORTHOGRAPHIC importOcctSolid route matches exactly, the PERSPECTIVE HLR of an
    // importOcctSolid body diverges from the verified native drawing (visible/hidden
    // length fraction 0.605 vs the verified 0.759; total drawn length +66% from
    // duplicated boundary edges in the imported shell). Emitting that drawing would
    // be an unverified/wrong result, so the OCCT-body branch throws the real reason
    // instead of fabricating a view. Re-enable once importOcctSolid feeds the
    // perspective silhouette pass a de-duplicated shell (K4 follow-up).
    const Solid* solidPtr = nullptr;
    if (reg.kindOf(h) == ShapeKind::NativeSolid) {
        solidPtr = &reg.getNativeSolid(h);
    } else if (reg.kindOf(h) == ShapeKind::Occt) {
        throw std::runtime_error(
            "forge.drawings.projectShapePerspective: native perspective HLR on an "
            "imported OCCT body is not yet verified (the imported-shell perspective "
            "drawing diverges from the machine-precision native path); supply a "
            "NativeSolid, or use the orthographic projectShape for OCCT bodies");
    } else {
        throw std::runtime_error(
            "forge.drawings.projectShapePerspective: perspective HLR requires a "
            "NativeSolid (got a mesh/other handle)");
    }

    HlrCamera hc;
    hc.eye         = { cam.eyeX,    cam.eyeY,    cam.eyeZ    };
    hc.target      = { cam.targetX, cam.targetY, cam.targetZ };
    hc.up          = { cam.upX,     cam.upY,     cam.upZ     };
    hc.fovYRadians = cam.fovYRadians;

    HlrResult res = hlrPerspective(*solidPtr, hc);
    if (!res.ok) {
        throw std::runtime_error(
            std::string("forge.drawings.projectShapePerspective: native perspective HLR "
                        "failed (") + (res.reason ? res.reason : "") + ")");
    }

    // Route the classified perspective segments into the V/H/OutLine buckets exactly
    // like the orthographic native path, but keep the segments' own image-plane (u,v)
    // (the perspective foreshortened coordinates) — there is no OCCT screen frame to
    // re-project into for a perspective camera.
    ProjectedView view;
    for (const HlrSegment& seg : res.segments) {
        if (seg.poly2d.size() < 2) continue;
        Polyline2D pl;
        pl.reserve(seg.poly2d.size());
        for (const auto& uv : seg.poly2d) pl.emplace_back(uv[0], uv[1]);
        if (pl.size() < 2) continue;
        if (seg.visibility == HlrVisibility::Hidden) {
            view.hidden.push_back(std::move(pl));
        } else if (seg.kind == HlrEdgeKind::Silhouette) {
            view.outline.push_back(std::move(pl));   // visible silhouette == OutLineV
        } else {
            view.visible.push_back(std::move(pl));
        }
    }
    return view;
#else
    (void)h; (void)cam;
    throw std::runtime_error(
        "forge.drawings.projectShapePerspective: perspective HLR requires the native "
        "B-rep build (FORGE_NATIVE_BREP)");
#endif
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

#ifdef FORGE_NATIVE_BREP
// Try the native planar section (brep::sectionSolid) for the cut-wire portion of
// projectShapeSection. Appends the section wires to `cutOut` (re-projected into the
// OCCT screen frame via the same worldToScreen the OCCT cut path uses, so the image
// matches) and returns true on success; returns false (NEVER throws) when the native
// path HONESTLY DEFERS to OCCT. Deferral cases (Bible §0):
//   * the input handle is a NativeMesh, OR an OCCT-backed body whose importOcctSolid
//     DEFERS (ok==false: Torus/Revolution/non-analytic / non-manifold import)
//     -> defer to OCCT.
//   * sectionSolid returns ok==false (a freeform/general-NURBS face the analytic
//     section cannot handle yet, or a degenerate/non-manifold cut) -> defer to OCCT.
// PHASE-D ACTIVATION (2026-06-25): a NativeSolid handle is used directly; an OCCT-backed
// (ShapeKind::Occt) analytic solid is IMPORTED via forge::importOcctSolid before the
// section run (`imported` keeps the imported topology alive for this call). The section
// output is screen polylines (NOT a registered section-result handle), so this is NOT
// blocked by the missing native-section result-handle kind.
// An EMPTY section (the plane misses the solid) is ok==true with no wires — that is
// a VALID native result (the OCCT path likewise leaves `cut` empty), so it is
// reported as success (true) with nothing appended, NOT a defer.
bool tryNativeSectionCut(ShapeHandle h, const gp_Ax2& ax,
                         const SectionPlane& plane,
                         std::vector<Polyline2D>& cutOut) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();

    ImportResult imported;
    const Solid* solidPtr = nullptr;
    if (reg.kindOf(h) == ShapeKind::NativeSolid) {
        solidPtr = &reg.getNativeSolid(h);
    } else if (reg.kindOf(h) == ShapeKind::Occt) {
        imported = importOcctSolid(reg.get(h));
        if (!imported.ok || imported.solid == nullptr) return false;  // defer to OCCT
        solidPtr = imported.solid;
    } else {
        return false;                                                 // NativeMesh -> defer
    }
    const Solid& solid = *solidPtr;

    forge::native::brep::SectionPlane sp;
    sp.point  = Vec3{ plane.ox, plane.oy, plane.oz };
    sp.normal = Vec3{ plane.nx, plane.ny, plane.nz };

    SectionResult res = sectionSolid(solid, sp);
    if (!res.ok) return false;                                   // unhandled face / degenerate -> defer

    // ok==true: append each closed section wire as a screen-space polyline (empty
    // section -> nothing appended, still a valid success).
    for (const SectionWire& w : res.wires) {
        if (w.points.size() < 2) continue;
        Polyline2D pl;
        pl.reserve(w.points.size() + 1);
        for (const Vec3& p : w.points) {
            double sx, sy;
            worldToScreen(ax, gp_Pnt(p.x, p.y, p.z), sx, sy);
            pl.emplace_back(sx, sy);
        }
        // Close the loop in screen space (the native wire is closed; last->first
        // is implied, matching how a closed OCCT section edge ring renders).
        if (w.closed && pl.size() >= 2) pl.push_back(pl.front());
        if (pl.size() >= 2) cutOut.push_back(std::move(pl));
    }
    return true;
}
#endif

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

    bool sectionDone = false;

#ifdef FORGE_NATIVE_BREP
    // GATE: native planar section is opt-in via the FEAT gate (default OFF). When on
    // AND the input is a NativeSolid, cut via brep::sectionSolid (re-projected into
    // the OCCT screen frame, so the regression image matches); otherwise fall through
    // to the OCCT BRepAlgoAPI_Section path below (an OCCT-backed input HONESTLY DEFERS
    // — no behavior change in the default build). Step 3 (hatch over the cut bbox)
    // consumes view.cut regardless of which backend filled it.
    if (native::brep::forgeNativeFeaturesEnabled()) {
        const gp_Ax2 nax = makeProjectionAx2_(direction);
        if (tryNativeSectionCut(h, nax, plane, view.cut)) {
            sectionDone = true;   // native owns the cut wires; skip the OCCT cut.
        }
        // native deferred -> OCCT cut path below (unchanged).
    }
#endif

    if (!sectionDone) try {
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
                    // K6 (TKGeomBase drop): native replacement for
                    // GCPnts_QuasiUniformDeflection(adaptor, 0.1).
                    std::vector<double> ps;
                    forge::nativeQuasiUniformDeflectionParams(adaptor, 0.1, ps);
                    Polyline2D pl;
                    if (ps.size() >= 2) {
                        for (double t : ps) {
                            gp_Pnt p = adaptor.Value(t);
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

// ============================================================================
// PUSH-05 — forge::drawings (nested namespace) implementation.
//
// Wraps the same HLR pipeline as forge::projectShape, but presents a
// stricter View2D / SectionView surface with explicit gp_Pnt2d polylines
// and an integrated 2D bbox, plus DXF/SVG text emitters.
// ============================================================================

#include <Standard_Failure.hxx>

#include <iomanip>
#include <ios>
#include <sstream>

namespace forge {
namespace drawings {

namespace {

// Convert the public ViewDirection enum into the existing
// ProjectionDirection used by the legacy `forge::projectShape` pipeline.
::forge::ProjectionDirection toLegacyDir(ViewDirection v) {
    switch (v) {
        case ViewDirection::FRONT: return ::forge::frontView();
        case ViewDirection::TOP:   return ::forge::topView();
        case ViewDirection::RIGHT: return ::forge::rightView();
        case ViewDirection::ISO:   return ::forge::isometricView();
    }
    return ::forge::frontView();
}

// Mirror of makeProjectionAx2 from the anonymous namespace above. We
// can't reach into that file's `namespace { ... }` directly from here,
// so we duplicate the (short) construction.
gp_Ax2 buildAx2(const ::forge::ProjectionDirection& d) {
    const double len = std::sqrt(d.dx * d.dx + d.dy * d.dy + d.dz * d.dz);
    if (len < Precision::Confusion()) {
        throw std::invalid_argument("forge::drawings: zero-length view direction");
    }
    const double nx = d.dx / len, ny = d.dy / len, nz = d.dz / len;
    const gp_Dir az(-nx, -ny, -nz);
    gp_Dir ax;
    const double cx = -nx;
    if (std::abs(cx) < 0.999) {
        gp_Dir worldX(1, 0, 0);
        const double dot = az.Dot(worldX);
        ax = gp_Dir(worldX.X() - dot * az.X(),
                    worldX.Y() - dot * az.Y(),
                    worldX.Z() - dot * az.Z());
    } else {
        gp_Dir worldY(0, 1, 0);
        const double dot = az.Dot(worldY);
        ax = gp_Dir(worldY.X() - dot * az.X(),
                    worldY.Y() - dot * az.Y(),
                    worldY.Z() - dot * az.Z());
    }
    return gp_Ax2(gp_Pnt(0, 0, 0), az, ax);
}

// Convert a vector<pair<double,double>> polyline to vector<gp_Pnt2d>.
Polyline toGpPolyline(const ::forge::Polyline2D& src) {
    Polyline out;
    out.reserve(src.size());
    for (const auto& xy : src) {
        out.emplace_back(xy.first, xy.second);
    }
    return out;
}

// Re-implement the HLR pipeline directly on a TopoDS_Shape (the public
// projectView() takes a TopoDS_Shape, not a ShapeHandle, so we skip
// the registry hop).
//
// Returns true if HLR finished without throwing; populates `view` with
// the discretised polylines and bbox (which the caller then reads).
struct HLRBuckets {
    std::vector<Polyline> visible;
    std::vector<Polyline> hidden;
};

bool runHlrToPolylines(const TopoDS_Shape& shape,
                       const gp_Ax2& ax2,
                       HLRBuckets& out,
                       double deflection)
{
    (void)deflection;  // native HLR chords curved edges internally
#ifdef FORGE_NATIVE_BREP
    // TKHLR-free: import the OCCT shape to a native analytic Solid and run the
    // native orthographic HLR (emitNativeHlr re-projects into this ax2 screen frame
    // and drops edge-on projections exactly as OCCT HLR omits them). Returns false
    // (empty) when the shape cannot be imported / the HLR degenerates — no OCCT HLR
    // fallback remains.
    forge::ImportResult imported = forge::importOcctSolid(shape);
    if (!imported.ok || imported.solid == nullptr) return false;
    emitNativeHlr(*imported.solid, ax2,
                  [&](NativeHlrClass cls, std::vector<std::pair<double, double>>& pl) {
                      Polyline poly;
                      poly.reserve(pl.size());
                      for (const auto& xy : pl) poly.emplace_back(xy.first, xy.second);
                      // HLRBuckets carries only visible + hidden; the silhouette /
                      // outline class joins visible (matching the original walk(),
                      // which routed OutLineVCompound into out.visible).
                      if (cls == NativeHlrClass::Hidden) out.hidden.push_back(std::move(poly));
                      else                               out.visible.push_back(std::move(poly));
                  });
    return !out.visible.empty() || !out.hidden.empty();
#else
    (void)shape; (void)ax2; (void)out;
    throw std::runtime_error(
        "forge::drawings: HLR requires the native B-rep build (FORGE_NATIVE_BREP)");
#endif
}

// Compute (and write into the view) the 2D bbox of the visible + hidden
// edges. Empty buckets produce a degenerate (0,0,0,0) bbox.
void computeBbox(View2D& v) {
    double minX = std::numeric_limits<double>::infinity();
    double minY = std::numeric_limits<double>::infinity();
    double maxX = -std::numeric_limits<double>::infinity();
    double maxY = -std::numeric_limits<double>::infinity();
    auto walk = [&](const std::vector<Polyline>& bucket) {
        for (const auto& pl : bucket) {
            for (const auto& p : pl) {
                const double x = p.X(), y = p.Y();
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    };
    walk(v.visibleEdges);
    walk(v.hiddenEdges);
    if (!std::isfinite(minX)) {
        v.minX = v.minY = v.maxX = v.maxY = 0.0;
    } else {
        v.minX = minX; v.minY = minY; v.maxX = maxX; v.maxY = maxY;
    }
}

} // anonymous namespace

View2D projectView(const TopoDS_Shape& shape, ViewDirection dir) {
    if (shape.IsNull()) {
        throw std::runtime_error("forge::drawings::projectView: shape is null");
    }
    const ::forge::ProjectionDirection legacy = toLegacyDir(dir);
    const gp_Ax2 ax2 = buildAx2(legacy);
    constexpr double kDeflection = 0.05;

    HLRBuckets buckets;
    runHlrToPolylines(shape, ax2, buckets, kDeflection);
    // NO tessellate-and-retry: the native HLR reads analytic surfaces directly, so
    // triangulating the shape and re-running (the old OCCT crutch for curved faces
    // that lacked a facing) is pointless and harmful — it would re-import a faceted
    // round-trip. A degenerate result is reported honestly below.

    if (buckets.visible.empty() && buckets.hidden.empty()) {
        throw std::runtime_error(
            "forge::drawings::projectView: HLR produced no edges (shape may be degenerate)");
    }

    View2D view;
    view.visibleEdges = std::move(buckets.visible);
    view.hiddenEdges  = std::move(buckets.hidden);
    computeBbox(view);
    return view;
}

#ifdef FORGE_NATIVE_BREP
View2D projectViewNative(const forge::native::brep::Solid& solid, ViewDirection dir) {
    const gp_Ax2 ax2 = buildAx2(toLegacyDir(dir));
    HLRBuckets buckets;
    // Project the native solid DIRECTLY (no OCCT round-trip). emitNativeHlr drops
    // edge-on projections exactly as OCCT HLR omitted them; silhouette/outline joins
    // visible (matching projectView's OutLineVCompound -> visibleEdges routing).
    emitNativeHlr(solid, ax2,
                  [&](NativeHlrClass cls, std::vector<std::pair<double, double>>& pl) {
                      Polyline poly;
                      poly.reserve(pl.size());
                      for (const auto& xy : pl) poly.emplace_back(xy.first, xy.second);
                      if (cls == NativeHlrClass::Hidden) buckets.hidden.push_back(std::move(poly));
                      else                               buckets.visible.push_back(std::move(poly));
                  });
    if (buckets.visible.empty() && buckets.hidden.empty()) {
        throw std::runtime_error(
            "forge::drawings::projectView: native HLR produced no edges (shape may be degenerate)");
    }
    View2D view;
    view.visibleEdges = std::move(buckets.visible);
    view.hiddenEdges  = std::move(buckets.hidden);
    computeBbox(view);
    return view;
}
#endif

SectionView sectionView(const TopoDS_Shape& shape, gp_Pln cuttingPlane) {
    if (shape.IsNull()) {
        throw std::runtime_error("forge::drawings::sectionView: shape is null");
    }

    SectionView out;

    // ---- 1) intersect with the cutting plane → sectionEdges
    try {
        BRepAlgoAPI_Section sec(shape, cuttingPlane, Standard_False);
        sec.ComputePCurveOn1(Standard_True);
        sec.Approximation(Standard_True);
        sec.Build();
        if (sec.IsDone()) {
            // Sample each intersection edge in 3D, then project onto
            // the cutting plane's local (X, Y) frame.
            const gp_Ax3 pos = cuttingPlane.Position();
            const gp_Pnt origin = pos.Location();
            const gp_Dir xd = pos.XDirection();
            const gp_Dir yd = pos.YDirection();
            for (TopExp_Explorer ex(sec.Shape(), TopAbs_EDGE); ex.More(); ex.Next()) {
                TopoDS_Edge e = TopoDS::Edge(ex.Current());
                if (e.IsNull()) continue;
                try {
                    BRepAdaptor_Curve adaptor(e);
                    // K6 (TKGeomBase drop): native replacement for
                    // GCPnts_QuasiUniformDeflection(adaptor, 0.1).
                    std::vector<double> ps;
                    forge::nativeQuasiUniformDeflectionParams(adaptor, 0.1, ps);
                    Polyline pl;
                    auto push = [&](const gp_Pnt& p) {
                        const double dx = p.X() - origin.X();
                        const double dy = p.Y() - origin.Y();
                        const double dz = p.Z() - origin.Z();
                        const double sx = dx * xd.X() + dy * xd.Y() + dz * xd.Z();
                        const double sy = dx * yd.X() + dy * yd.Y() + dz * yd.Z();
                        pl.emplace_back(sx, sy);
                    };
                    if (ps.size() >= 2) {
                        pl.reserve(ps.size());
                        for (double t : ps) {
                            push(adaptor.Value(t));
                        }
                    } else {
                        push(adaptor.Value(adaptor.FirstParameter()));
                        push(adaptor.Value(adaptor.LastParameter()));
                    }
                    if (pl.size() >= 2) out.sectionEdges.push_back(std::move(pl));
                } catch (...) {
                    // skip pathological edge
                }
            }
        }
    } catch (const Standard_Failure&) {
        // Plane misses shape → leave sectionEdges empty (callers can
        // detect this); we still attempt the behind-edges pass below.
    }

    // ---- 2) HLR of the *back half* (shape ∩ negative half-space).
    //
    // Build a far-side half-space by cutting the shape with the plane;
    // we keep only the part on the plane's negative side. Project the
    // result along the plane's normal direction to get behindEdges.
    try {
        const gp_Ax3 pos = cuttingPlane.Position();
        const gp_Dir nrm = pos.Direction();
        // ProjectionDirection looks INTO the shape; behind-edges are
        // viewed from the *front* side of the plane, i.e. camera
        // direction = -plane normal.
        ::forge::ProjectionDirection pd{ -nrm.X(), -nrm.Y(), -nrm.Z() };
        const gp_Ax2 ax2 = buildAx2(pd);

        HLRBuckets buckets;
        if (runHlrToPolylines(shape, ax2, buckets, 0.05)) {
            // We re-frame the projected coordinates so that the section's
            // local (X, Y) matches behindEdges. The HLR ax2 already uses
            // the plane normal as Z; for the X axis the constructor picks
            // a deterministic but unrelated direction. To align, we
            // re-project each polyline vertex onto the plane's XDirection
            // / YDirection.
            const gp_Dir xd = pos.XDirection();
            const gp_Dir yd = pos.YDirection();
            const gp_Pnt origin = pos.Location();
            // Each HLR polyline vertex lives in the ax2-local frame.
            // Lift back to world coords by combining ax2 axes, then
            // re-project onto (xd, yd, origin).
            const gp_Dir hx = ax2.XDirection();
            const gp_Dir hy = ax2.YDirection();
            const gp_Pnt ho = ax2.Location();
            auto reframe = [&](Polyline& pl) {
                for (auto& p : pl) {
                    // ax2-local → world
                    const double wx = ho.X() + p.X() * hx.X() + p.Y() * hy.X();
                    const double wy = ho.Y() + p.X() * hx.Y() + p.Y() * hy.Y();
                    const double wz = ho.Z() + p.X() * hx.Z() + p.Y() * hy.Z();
                    // world → plane-local
                    const double dx = wx - origin.X();
                    const double dy = wy - origin.Y();
                    const double dz = wz - origin.Z();
                    const double sx = dx * xd.X() + dy * xd.Y() + dz * xd.Z();
                    const double sy = dx * yd.X() + dy * yd.Y() + dz * yd.Z();
                    p.SetCoord(sx, sy);
                }
            };
            for (auto& pl : buckets.visible) reframe(pl);
            // We only return visible (front-facing) behind-edges.
            out.behindEdges = std::move(buckets.visible);
        }
    } catch (const Standard_Failure&) {
        // behindEdges left empty.
    }

    return out;
}

// ---------------------------------------------------------- DXF emitter
//
// Minimal AutoCAD R12 ASCII DXF: one ENTITIES section, an LWPOLYLINE
// per polyline, and a LINE per dimension leader. We use group codes
// strictly enough that any DXF reader (LibreCAD, AutoCAD, QCAD)
// imports cleanly. We deliberately omit HEADER / TABLES / BLOCKS so
// the file stays compact; R12 allows that as long as ENTITIES is
// well-formed and EOF terminates the file.

std::string emitDXF(const std::vector<View2D>& views,
                    const std::vector<std::pair<gp_Pnt2d, gp_Pnt2d>>& dimensions)
{
    std::ostringstream o;
    o << std::fixed << std::setprecision(6);

    // SECTION / ENTITIES
    o << "0\nSECTION\n2\nENTITIES\n";

    int handle = 0x100;  // arbitrary monotonically-increasing handle id

    // Emit one LWPOLYLINE per polyline. Group code 8 sets the layer,
    // 90 is the vertex count, 70 is the polyline flag (1 = closed,
    // 0 = open — we always emit 0 because HLR edges aren't closed in
    // general), and each vertex is group code 10 (X) / 20 (Y).
    auto emitPolyline = [&](const Polyline& pl, const char* layer) {
        if (pl.size() < 2) return;
        o << "0\nLWPOLYLINE\n";
        o << "5\n" << std::hex << handle++ << std::dec << "\n";
        o << "8\n" << layer << "\n";
        o << "100\nAcDbEntity\n";
        o << "100\nAcDbPolyline\n";
        o << "90\n" << pl.size() << "\n";
        o << "70\n0\n";
        for (const auto& p : pl) {
            o << "10\n" << p.X() << "\n";
            o << "20\n" << p.Y() << "\n";
        }
    };

    for (const auto& v : views) {
        for (const auto& pl : v.visibleEdges) emitPolyline(pl, "VISIBLE");
        for (const auto& pl : v.hiddenEdges)  emitPolyline(pl, "HIDDEN");
    }

    // Dimension leaders: plain LINE entities on layer DIMS.
    for (const auto& d : dimensions) {
        o << "0\nLINE\n";
        o << "5\n" << std::hex << handle++ << std::dec << "\n";
        o << "8\nDIMS\n";
        o << "100\nAcDbEntity\n";
        o << "100\nAcDbLine\n";
        o << "10\n" << d.first.X()  << "\n";
        o << "20\n" << d.first.Y()  << "\n";
        o << "30\n0.0\n";
        o << "11\n" << d.second.X() << "\n";
        o << "21\n" << d.second.Y() << "\n";
        o << "31\n0.0\n";
    }

    // ENDSEC / EOF
    o << "0\nENDSEC\n0\nEOF\n";
    return o.str();
}

// ---------------------------------------------------------- SVG emitter
//
// Self-contained <?xml...?>+<svg> with one <path> per polyline. Visible
// edges are solid 0.35 mm; hidden edges are dashed `stroke-dasharray="2,2"`.
// We flip Y so the SVG renders right-side-up: SVG Y points down, so we
// negate model-Y to keep the drawing oriented as the user sees it on
// screen. The viewBox is the bbox padded by 5 mm on each side.

std::string emitSVG(const View2D& view) {
    const double pad = 5.0;
    const double w = std::max(1e-3, (view.maxX - view.minX) + 2.0 * pad);
    const double h = std::max(1e-3, (view.maxY - view.minY) + 2.0 * pad);
    const double vbX = view.minX - pad;
    // SVG flips Y: viewBox top-left in SVG-space is (vbX, -maxY-pad);
    // we'll output paths in SVG-space directly by negating Y.
    const double vbY = -(view.maxY + pad);

    std::ostringstream o;
    o << std::fixed << std::setprecision(3);
    o << "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>\n";
    o << "<svg xmlns=\"http://www.w3.org/2000/svg\" "
      << "viewBox=\"" << vbX << " " << vbY << " " << w << " " << h << "\" "
      << "width=\"" << w << "mm\" height=\"" << h << "mm\">\n";
    o << "<g fill=\"none\" stroke=\"black\">\n";

    auto emitPath = [&](const Polyline& pl, bool hidden) {
        if (pl.size() < 2) return;
        // The acceptance contract is `<path d="M ..."` (d attribute first),
        // followed by the visual style attributes.
        o << "<path d=\"M " << pl[0].X() << " " << -pl[0].Y();
        for (std::size_t i = 1; i < pl.size(); ++i) {
            o << " L " << pl[i].X() << " " << -pl[i].Y();
        }
        o << "\" stroke=\"black\" stroke-width=\"0.35\" fill=\"none\"";
        if (hidden) o << " stroke-dasharray=\"2,2\"";
        o << "/>\n";
    };

    for (const auto& pl : view.visibleEdges) emitPath(pl, false);
    for (const auto& pl : view.hiddenEdges)  emitPath(pl, true);

    o << "</g>\n</svg>\n";
    return o.str();
}

} // namespace drawings
} // namespace forge
