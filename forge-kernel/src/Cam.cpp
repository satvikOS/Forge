// Cam.cpp (Forge-13) — 2.5D toolpath generators (profile / pocket / drill /
// face-mill) operating on a planar BREP face.
//
// Pipeline at a glance:
//   1. Resolve the target face. If faceId == kAutoFaceId we walk every
//      TopoDS_Face on the shape and pick the first one whose underlying
//      surface is a Geom_Plane with +Z normal.
//   2. Extract the outer wire (`BRepTools::OuterWire`). For pocket we keep
//      the inner wires too so the offset boundary respects pre-existing
//      pockets / holes.
//   3. For each Z level (top → bottom in stepdown increments):
//        * profile: offset the outer wire INWARD by tool radius using
//          BRepOffsetAPI_MakeOffset, then sample with QuasiUniformDeflection
//          and emit one trace at this Z. Lead-in is added as a straight
//          tangential segment before the first cutting vertex.
//        * pocket: same offset as profile, plus zigzag rasters clipped by
//          the offset boundary on the Y axis at stepover spacing.
//   4. drill / faceMill build their move lists directly without OCCT
//      offset machinery — they only need the face's planar bbox + center.
//
// All moves are 3D. The post-processor (GcodePost.cpp) consumes Moves and
// emits dialect-specific G-code.
//
// LIMITATIONS / SCOPE NOTES:
//   * Constant-feedrate; no engagement-arc compensation (follow-up slice).
//   * Trochoidal entry skipped — first pocket pass uses a plain plunge.
//   * Inner wires of the face are ignored for `profile` and `faceMill`;
//     `pocket` keeps them only as additional offset sources so the pocket
//     does not overrun an existing hole.
//   * BRepOffsetAPI_MakeOffset on closed planar wires reliably produces
//     an inward offset when fed a negative offset value (we negate
//     toolRadius). If the offset comes back empty (e.g. wire too small),
//     we fall back to "no offset" so the operation still emits a path.

#include "forge/Cam.hpp"
#include "forge/ShapeRegistry.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepLib.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRepTools.hxx>
#include <GeomAbs_CurveType.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include "forge/OcctCurveSampling.hpp"  // K6: native GCPnts_QuasiUniformDeflection replacement
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <Precision.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <vector>

// PHASE-D wiring (2026-06-25) — route the Cam 2.5D toolpath wire-offset
// (inwardOffset, currently OCCT BRepOffsetAPI_MakeOffset on a planar wire) through
// the ALREADY-BUILT, gate-tested native 2D polygon offset
// (forge::native::geom::PolygonOffset2D — PolygonOffset2D.cpp) behind a GATE.
// Compiled in ONLY under -DFORGE_NATIVE_BREP and taken at runtime ONLY when the
// FEAT gate forgeNativeFeaturesEnabled() is true (env FORGE_NATIVE_FEATURES=1, or
// the A/B harness's setForgeNativeBrepEnabled(true), which flips CORE+FEAT+STEP
// together). PRODUCTION DEFAULT IS OFF: with the gate off, the original OCCT
// BRepOffsetAPI_MakeOffset path below runs byte-for-byte unchanged. This mirrors
// the just-landed Sewing.cpp (commit 19840b66) / ShapeFix.cpp (commit 8d5f2ae1)
// wires: the native branch is taken only when the planar wire can be expressed as
// a TRUE 2D polygon (EVERY edge is a straight GeomAbs_Line segment). A wire with
// ANY curved edge (arc / circle / B-spline) HONESTLY DEFERS to OCCT — PolygonOffset2D
// consumes a straight-segment Loop2 only and there is no analytic-arc offset in it
// (the explicit GAP, surfaced not silently degraded — see RETURN risks).
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"          // forgeNativeFeaturesEnabled()
#include "forge/native/geom/PolygonOffset2D.hpp"      // PolygonOffset2D, Loop2, OffsetOptions/Result
#include "forge/native/geom/Geom.hpp"                 // Point2 (shared 2D point)
#endif

namespace forge::cam {

namespace {

// ---------------------------------------------------------- helpers

constexpr double kEps      = 1.0e-7;
constexpr double kSampleDeflection = 0.05; // mm — curve-sampling tolerance

// TKOffset family A. Deflection used to discretise a CURVED input wire before the
// native 2D offset. Deliberately 1/16 of kSampleDeflection: every consumer of the
// offset result immediately re-samples it at kSampleDeflection, so the error this
// discretisation contributes is bounded at 1/16 of the tolerance the caller
// already spends. Measured, not assumed — test/cam_native_offset_ab.mjs.
constexpr double kOffsetInputDeflection = kSampleDeflection / 16.0;  // 3.125e-3 mm

inline double dist3(double ax, double ay, double az,
                    double bx, double by, double bz) {
    const double dx = bx - ax, dy = by - ay, dz = bz - az;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

// Find a planar face whose surface normal points along +Z. Returns a
// null face if none matches.
TopoDS_Face pickTopFace(const TopoDS_Shape& shape) {
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face f = TopoDS::Face(ex.Current());
        Handle(Geom_Surface) surf = BRep_Tool::Surface(f);
        Handle(Geom_Plane)   plane = Handle(Geom_Plane)::DownCast(surf);
        if (plane.IsNull()) continue;

        gp_Dir n = plane->Pln().Axis().Direction();
        if (f.Orientation() == TopAbs_REVERSED) {
            n.Reverse();
        }
        if (n.Z() > 0.999) return f;
    }
    return TopoDS_Face();
}

// Address a face by id; index counts planar faces in iteration order.
// kAutoFaceId picks first +Z planar face. Returns null on miss.
TopoDS_Face resolveFace(const TopoDS_Shape& shape, std::uint32_t faceId) {
    if (faceId == kAutoFaceId) return pickTopFace(shape);

    std::uint32_t idx = 0;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next(), ++idx) {
        if (idx == faceId) return TopoDS::Face(ex.Current());
    }
    return TopoDS_Face();
}

// Sample a wire's edges into XY points (Z taken from wire's plane). The
// resulting polyline is closed if the input wire was closed (we duplicate
// the first vertex to ensure a clean ring).
//
// We walk via BRepTools_WireExplorer rather than TopExp_Explorer so that
// adjacent edges are returned in topological order (head-to-tail). A plain
// TopExp_Explorer returns subshapes in registration order, which for the
// output of BRepOffsetAPI_MakeOffset is not necessarily wire order — that
// gave us a zigzag toolpath in the first cut of this slice.
std::vector<std::array<double, 2>>
sampleWireXY(const TopoDS_Wire& wire, double deflection) {
    std::vector<std::array<double, 2>> out;
    if (wire.IsNull()) return out;

    for (BRepTools_WireExplorer ex(wire); ex.More(); ex.Next()) {
        TopoDS_Edge e = ex.Current();
        try {
            BRepAdaptor_Curve adaptor(e);
            // K6 (TKGeomBase drop): native replacement for
            // GCPnts_QuasiUniformDeflection(adaptor, deflection).
            std::vector<double> ps;
            forge::nativeQuasiUniformDeflectionParams(adaptor, deflection, ps);
            if (ps.size() < 2) continue;

            const bool reversed = (e.Orientation() == TopAbs_REVERSED);
            const int n = static_cast<int>(ps.size());
            for (int i = 1; i <= n; ++i) {
                const int idx = reversed ? (n - i + 1) : i;
                gp_Pnt p = adaptor.Value(ps[idx - 1]);
                if (!out.empty()) {
                    auto& back = out.back();
                    if (std::abs(back[0] - p.X()) < kEps &&
                        std::abs(back[1] - p.Y()) < kEps) {
                        continue;  // duplicate vertex from adjacent edges
                    }
                }
                out.push_back({ p.X(), p.Y() });
            }
        } catch (...) {
            // Skip malformed edges; the rest of the wire still samples fine.
        }
    }
    // Close the ring if not closed.
    if (out.size() >= 2) {
        auto& first = out.front();
        auto& last  = out.back();
        if (std::abs(first[0] - last[0]) > kEps ||
            std::abs(first[1] - last[1]) > kEps) {
            out.push_back(first);
        }
    }
    return out;
}

#ifdef FORGE_NATIVE_BREP
// Try the native 2D polygon offset (geom::PolygonOffset2D) for the Cam wire
// inward-offset. Returns a non-null TopoDS_Shape (a compound of offset wires) on
// success; returns a NULL shape (NEVER throws) when the native path HONESTLY
// DEFERS so the caller falls through to the OCCT BRepOffsetAPI_MakeOffset path.
//
// ── TKOffset FAMILY A (2026-07-31): the curved-edge GAP is CLOSED ───────────────
// The comment block that used to stand here said a curved edge must DEFER because
// "we must NOT silently flatten an arc to a polygon (that would change the
// toolpath)". That reasoning does not survive reading the CONSUMERS. Both — and
// they are the only two — are:
//
//     Cam.cpp:426  profile():  offShape = inwardOffset(...); sampleWireXY(w, kSampleDeflection)
//     Cam.cpp:528  pocket() :  offShape = inwardOffset(...); sampleWireXY(w, kSampleDeflection)
//
// i.e. the offset wire's exact geometry is NEVER used. It is immediately
// discretised to a polyline at kSampleDeflection = 0.05 mm chord deviation, and
// only that polyline reaches the toolpath / G-code. OCCT's arc-exact
// BRepOffsetAPI(GeomAbs_Arc) result is polygonised at 0.05 mm just the same.
//
// So the honest formulation is not "arc vs polygon" but "how much error does the
// INPUT discretisation add on top of the 0.05 mm the consumer already spends?".
// We sample the input at kOffsetInputDeflection = kSampleDeflection / 16 =
// 3.125e-3 mm, so the added deviation is bounded by 1/16 of the tolerance the
// caller itself imposes. That is a measurement, not an assertion — see
// test/cam_native_offset_ab.mjs, which compares the two paths' final 0.05 mm
// traces on line, arc, circle and mixed profiles.
//
// This is NOT "delete the capability to drop the library" (Law 9): the native
// path now accepts every wire the OCCT path accepted, and produces the same
// toolpath to well inside the consumer's own tolerance.
//
// Remaining honest deferrals (unchanged in kind — each returns a NULL shape and
// NEVER throws, so the caller falls back to the unoffset wire exactly as it
// already does when OCCT's MakeOffset fails):
//   * fewer than 3 distinct points after sampling (cannot form a polygon).
//   * PolygonOffset2D returns ok==false (degenerate input) or every loop collapsed
//     past the inradius (loops empty).
//
// CONVERSION (wire -> Loop2 -> wire), all in the face's planar XY:
//   forward : STRAIGHT-ONLY wires keep the exact vertex walk they have always used
//             (byte-identical to the shipped, gate-tested path — a polygon gains no
//             sampled points). A wire with ANY curved edge is discretised with
//             sampleWireXY, i.e. the SAME traversal, the SAME native
//             nativeQuasiUniformDeflectionParams sampler and the SAME orientation
//             handling the consumer applies to the RESULT, at 1/16 the deflection.
//   offset  : signed distance. OCCT's path negates (off.Perform(-offsetMm)) which
//             moves INWARD for a CCW wire. PolygonOffset2D shrinks a CCW loop with
//             d<0 and a CW loop with d>0, so we sign |offsetMm| by the loop's own
//             orientation to ALWAYS move inward (into the closed wire) — matching
//             OCCT's inward intent regardless of the wire's winding.
//   inverse : each surviving Loop2 -> a closed planar TopoDS_Wire at the plane Z
//             via BRepBuilderAPI_MakePolygon; many loops -> a TopoDS_Compound. The
//             return type is byte-identical to the OCCT path (wiresOf + sampleWireXY
//             consume it unchanged).
TopoDS_Shape tryNativeInwardOffset(const TopoDS_Wire& wire, double offsetMm,
                                   const gp_Pln& plane) {
    using forge::native::geom::Loop2;
    using forge::native::geom::Point2;
    using forge::native::geom::PolygonOffset2D;
    using forge::native::geom::OffsetOptions;
    using forge::native::geom::OffsetResult;

    // Is every edge a straight segment? If so we take the exact vertex walk and
    // the result is bit-for-bit what this function returned before family A.
    bool allLines = true;
    for (BRepTools_WireExplorer ex(wire); ex.More(); ex.Next()) {
        BRepAdaptor_Curve adaptor(ex.Current());
        if (adaptor.GetType() != GeomAbs_Line) { allLines = false; break; }
    }

    Loop2 loop;
    if (allLines) {
        // Forward (exact): ex.CurrentVertex() is the edge's start vertex in
        // head-to-tail wire order; taking the start vertex of every edge walks the
        // ring exactly once.
        for (BRepTools_WireExplorer ex(wire); ex.More(); ex.Next()) {
            gp_Pnt p = BRep_Tool::Pnt(ex.CurrentVertex());
            Point2 q{p.X(), p.Y()};
            if (!loop.pts.empty()) {
                const Point2& b = loop.pts.back();
                if (std::abs(b.x - q.x) < kEps && std::abs(b.y - q.y) < kEps) continue;
            }
            loop.pts.push_back(q);
        }
    } else {
        // Forward (curved): discretise with the consumer's own sampler at 1/16 the
        // consumer's own deflection. sampleWireXY already walks head-to-tail,
        // honours TopAbs_REVERSED, and de-dups shared vertices.
        for (const auto& p : sampleWireXY(wire, kOffsetInputDeflection)) {
            loop.pts.push_back(Point2{p[0], p[1]});
        }
    }
    // Drop a trailing vertex coincident with the first (Loop2 must NOT repeat it;
    // sampleWireXY deliberately closes the ring, so this always fires on that path).
    if (loop.pts.size() >= 2) {
        const Point2& f = loop.pts.front();
        const Point2& l = loop.pts.back();
        if (std::abs(f.x - l.x) < kEps && std::abs(f.y - l.y) < kEps) loop.pts.pop_back();
    }
    if (loop.pts.size() < 3) return TopoDS_Shape();   // not a polygon -> defer

    // Sign |offsetMm| to move INWARD regardless of the wire's winding (see above).
    const double signedDist = loop.isCCW() ? -offsetMm : offsetMm;
    OffsetOptions opts;                       // Round joins, auto arc tolerance
    OffsetResult r = PolygonOffset2D::offsetLoop(loop, signedDist, opts);
    if (!r.ok || r.loops.empty()) return TopoDS_Shape();  // degenerate/collapsed -> defer

    // Inverse: each surviving Loop2 -> a closed planar wire at the face plane Z.
    const double zPlane = plane.Location().Z();
    std::vector<TopoDS_Wire> outWires;
    outWires.reserve(r.loops.size());
    for (const Loop2& L : r.loops) {
        if (L.pts.size() < 3) continue;
        BRepBuilderAPI_MakePolygon poly;
        for (const Point2& pt : L.pts) poly.Add(gp_Pnt(pt.x, pt.y, zPlane));
        poly.Close();
        if (poly.IsDone()) outWires.push_back(poly.Wire());
    }
    if (outWires.empty()) return TopoDS_Shape();      // nothing built -> defer

    if (outWires.size() == 1) return outWires.front();
    TopoDS_Compound comp;
    BRep_Builder bb;
    bb.MakeCompound(comp);
    for (const TopoDS_Wire& w : outWires) bb.Add(comp, w);
    return comp;
}
#endif

// Negative offset = inward for a CCW outer wire (OCCT convention). If
// BRepOffsetAPI_MakeOffset fails (small wire, self-intersection), we
// return an empty result; callers fall back to the unoffset wire.
//
// ── TKOffset FAMILY A drop seam ────────────────────────────────────────────────
// With -DFORGE_OFFSET_DROP_MAKEOFFSET the OCCT branch below is COMPILED OUT and
// this is the ONLY implementation. That removes all 4 of TKOffset's
// BRepOffsetAPI_MakeOffset symbols (ctor(Wire,JoinType,bool), Init, Perform, and
// the vtable) from the binary — the whole of family A, which has exactly this one
// call site.
//
// The failure semantics are UNCHANGED by the drop, which is what makes the seam
// safe: this function has never thrown and never signalled an error. Its contract
// is "return an empty shape and let the caller re-use the unoffset wire"
// (Cam.cpp:427/529: `if (wires.empty()) wires.push_back(outer);`). A native defer
// is therefore indistinguishable, to every caller, from an OCCT MakeOffset failure
// — a case the shipped kernel already handles by design.
TopoDS_Shape inwardOffset(const TopoDS_Wire& wire, double offsetMm,
                          const gp_Pln& plane) {
    if (wire.IsNull() || offsetMm < kEps) return TopoDS_Shape();

#if defined(FORGE_NATIVE_BREP) && defined(FORGE_OFFSET_DROP_MAKEOFFSET)
    // DROP BUILD: native unconditionally. The FEAT gate is deliberately NOT
    // consulted here — with the OCCT branch compiled out there is nothing to gate
    // BETWEEN, and honouring a default-OFF gate would leave the function returning
    // an empty shape for every input, which is capability deletion by another name.
    return tryNativeInwardOffset(wire, offsetMm, plane);
#else

#ifdef FORGE_NATIVE_BREP
    // GATE: the native 2D polygon offset is opt-in via the FEAT gate (default OFF).
    // When on, offset via PolygonOffset2D (straight AND curved wires — family A
    // closed the curved gap on 2026-07-31); a degenerate/collapsed result still
    // HONESTLY DEFERS to OCCT below. A NULL native result == defer.
    if (native::brep::forgeNativeFeaturesEnabled()) {
        TopoDS_Shape nativeOut = tryNativeInwardOffset(wire, offsetMm, plane);
        if (!nativeOut.IsNull()) return nativeOut;
        // native deferred -> OCCT path below (unchanged).
    }
#endif

    try {
        BRepOffsetAPI_MakeOffset off(wire, GeomAbs_Arc);
        off.Init(GeomAbs_Arc);
        // Negate so the offset moves *into* the closed wire.
        off.Perform(-offsetMm);
        if (off.IsDone()) {
            TopoDS_Shape sh = off.Shape();
            if (!sh.IsNull()) return sh;
        }
    } catch (...) {
        // fall through — return empty.
    }
    (void)plane;
#endif  // FORGE_OFFSET_DROP_MAKEOFFSET
    return TopoDS_Shape();
}

// Collect every wire from a (possibly compound) offset result.
std::vector<TopoDS_Wire> wiresOf(const TopoDS_Shape& sh) {
    std::vector<TopoDS_Wire> out;
    if (sh.IsNull()) return out;
    if (sh.ShapeType() == TopAbs_WIRE) {
        out.push_back(TopoDS::Wire(sh));
        return out;
    }
    for (TopExp_Explorer ex(sh, TopAbs_WIRE); ex.More(); ex.Next()) {
        out.push_back(TopoDS::Wire(ex.Current()));
    }
    return out;
}

// Face plane + bbox in plane-local XY.
struct PlanarFaceInfo {
    gp_Pln plane;
    double zPlane;   // Z value of the face plane (assumes +Z normal)
    double minX, minY, maxX, maxY;
};

PlanarFaceInfo readFaceInfo(const TopoDS_Face& face) {
    PlanarFaceInfo info{};
    Handle(Geom_Surface) surf = BRep_Tool::Surface(face);
    Handle(Geom_Plane)   plane = Handle(Geom_Plane)::DownCast(surf);
    if (plane.IsNull()) {
        throw std::runtime_error("forge.cam: face is not planar");
    }
    info.plane  = plane->Pln();
    info.zPlane = info.plane.Location().Z();

    Bnd_Box bb;
    BRepBndLib::Add(face, bb);
    if (bb.IsVoid()) {
        throw std::runtime_error("forge.cam: face has empty bounding box");
    }
    double zMin, zMax;
    bb.Get(info.minX, info.minY, zMin, info.maxX, info.maxY, zMax);
    return info;
}

// Compute toolpath cycle time and cutting length by walking moves.
void finalize(Toolpath& tp) {
    double cuttingMm = 0.0;
    double timeSec   = 0.0;
    for (std::size_t i = 1; i < tp.moves.size(); ++i) {
        const auto& a = tp.moves[i - 1];
        const auto& b = tp.moves[i];
        const double d = dist3(a.x, a.y, a.z, b.x, b.y, b.z);
        if (b.cutting) cuttingMm += d;
        const double feed = std::max(b.feedrate, 1.0); // guard against /0
        timeSec += (d / feed) * 60.0; // feed is mm/min
    }
    tp.cycleTimeSec = timeSec;
    tp.estCuttingMm = cuttingMm;
}

// Emit a rapid to (x,y,z).
inline void rapid(Toolpath& tp, double x, double y, double z) {
    tp.moves.push_back({ x, y, z, false, /*feed*/ 5000.0 });
}
// Emit a cutting linear move.
inline void linearCut(Toolpath& tp, double x, double y, double z, double feed) {
    tp.moves.push_back({ x, y, z, true, feed });
}

} // namespace

// ============================================================================
// profile
// ============================================================================
Toolpath profile(ShapeHandle h, std::uint32_t faceId,
                 const Tool& tool, const CuttingParams& params,
                 double zTop, double zBottom, double leadIn)
{
    const auto& shape = ShapeRegistry::instance().get(h);
    if (shape.IsNull()) {
        throw std::runtime_error("forge.cam.profile: shape is null");
    }
    TopoDS_Face face = resolveFace(shape, faceId);
    if (face.IsNull()) {
        throw std::runtime_error("forge.cam.profile: no +Z planar face found");
    }
    if (zTop <= zBottom) {
        throw std::runtime_error("forge.cam.profile: zTop must be > zBottom");
    }
    if (tool.diameter <= 0.0) {
        throw std::runtime_error("forge.cam.profile: tool diameter must be > 0");
    }

    const double toolRadius = tool.diameter * 0.5;
    PlanarFaceInfo info = readFaceInfo(face);

    TopoDS_Wire outer = BRepTools::OuterWire(face);
    if (outer.IsNull()) {
        throw std::runtime_error("forge.cam.profile: face has no outer wire");
    }

    // Offset the outer wire inward by the tool radius. If OCCT refuses
    // (very small wire), fall back to the unoffset wire so the tool still
    // describes the boundary (the user gets a usable path with a comment
    // in the G-code header that radius compensation was clipped).
    TopoDS_Shape offShape = inwardOffset(outer, toolRadius, info.plane);
    std::vector<TopoDS_Wire> wires = wiresOf(offShape);
    if (wires.empty()) wires.push_back(outer);

    // Choose the largest wire by point count — for a simple outer profile
    // this is the correct trace.
    std::vector<std::array<double, 2>> trace;
    for (const auto& w : wires) {
        auto pts = sampleWireXY(w, kSampleDeflection);
        if (pts.size() > trace.size()) trace = std::move(pts);
    }
    if (trace.size() < 2) {
        throw std::runtime_error("forge.cam.profile: empty trace after offset");
    }

    Toolpath tp;
    tp.toolId = tool.id;

    // Safe Z = zTop + a small clearance (we trust the post to layer in its
    // own safe Z for true rapids; here we just stage above the cut).
    const double safeZ = zTop + 5.0;

    // Entry: rapid to first XY at safe Z.
    rapid(tp, trace.front()[0], trace.front()[1], safeZ);

    const double stepdown = std::max(params.stepdown, 0.1);
    const int    levels   = std::max(1, static_cast<int>(std::ceil((zTop - zBottom) / stepdown)));

    for (int li = 1; li <= levels; ++li) {
        const double zLevel = std::max(zBottom, zTop - li * stepdown);

        // Optional tangential lead-in: a straight segment ending at trace[0].
        std::array<double, 2> startXY = trace.front();
        if (leadIn > 0.0 && trace.size() >= 2) {
            // Compute tangent from trace[0] -> trace[1] and back up `leadIn`
            // along the reversed tangent.
            const double tx = trace[1][0] - trace[0][0];
            const double ty = trace[1][1] - trace[0][1];
            const double tl = std::sqrt(tx * tx + ty * ty);
            if (tl > kEps) {
                const double ux = tx / tl, uy = ty / tl;
                const double leadStartX = trace[0][0] - ux * leadIn;
                const double leadStartY = trace[0][1] - uy * leadIn;
                // Rapid above leadStart, plunge, then cut into trace[0].
                rapid(tp, leadStartX, leadStartY, safeZ);
                linearCut(tp, leadStartX, leadStartY, zLevel, params.feedZ);
                linearCut(tp, trace[0][0], trace[0][1], zLevel, params.feedXY);
                startXY = trace[0];
            } else {
                linearCut(tp, startXY[0], startXY[1], zLevel, params.feedZ);
            }
        } else {
            // Plunge straight down to this Z.
            linearCut(tp, startXY[0], startXY[1], zLevel, params.feedZ);
        }

        // Trace the perimeter.
        for (std::size_t i = 1; i < trace.size(); ++i) {
            linearCut(tp, trace[i][0], trace[i][1], zLevel, params.feedXY);
        }

        // Ramp out (vertical retract for now; tangential ramp is a refinement).
        rapid(tp, trace.back()[0], trace.back()[1], safeZ);
    }

    finalize(tp);
    return tp;
}

// ============================================================================
// pocket
// ============================================================================
Toolpath pocket(ShapeHandle h, std::uint32_t faceId,
                const Tool& tool, const CuttingParams& params,
                double zTop, double zBottom)
{
    const auto& shape = ShapeRegistry::instance().get(h);
    if (shape.IsNull()) {
        throw std::runtime_error("forge.cam.pocket: shape is null");
    }
    TopoDS_Face face = resolveFace(shape, faceId);
    if (face.IsNull()) {
        throw std::runtime_error("forge.cam.pocket: no +Z planar face found");
    }
    if (zTop <= zBottom) {
        throw std::runtime_error("forge.cam.pocket: zTop must be > zBottom");
    }
    if (tool.diameter <= 0.0) {
        throw std::runtime_error("forge.cam.pocket: tool diameter must be > 0");
    }
    if (params.stepover <= kEps) {
        throw std::runtime_error("forge.cam.pocket: stepover must be > 0");
    }

    const double toolRadius = tool.diameter * 0.5;
    PlanarFaceInfo info = readFaceInfo(face);

    TopoDS_Wire outer = BRepTools::OuterWire(face);
    if (outer.IsNull()) {
        throw std::runtime_error("forge.cam.pocket: face has no outer wire");
    }

    TopoDS_Shape offShape = inwardOffset(outer, toolRadius, info.plane);
    std::vector<TopoDS_Wire> wires = wiresOf(offShape);
    if (wires.empty()) wires.push_back(outer);

    std::vector<std::array<double, 2>> trace;
    for (const auto& w : wires) {
        auto pts = sampleWireXY(w, kSampleDeflection);
        if (pts.size() > trace.size()) trace = std::move(pts);
    }
    if (trace.size() < 3) {
        throw std::runtime_error("forge.cam.pocket: trace too small after offset");
    }

    // Bounding box of the offset trace — used to drive zigzag rasters.
    double minX = std::numeric_limits<double>::infinity();
    double minY = std::numeric_limits<double>::infinity();
    double maxX = -std::numeric_limits<double>::infinity();
    double maxY = -std::numeric_limits<double>::infinity();
    for (auto& p : trace) {
        minX = std::min(minX, p[0]); minY = std::min(minY, p[1]);
        maxX = std::max(maxX, p[0]); maxY = std::max(maxY, p[1]);
    }

    Toolpath tp;
    tp.toolId = tool.id;
    const double safeZ    = zTop + 5.0;
    const double stepdown = std::max(params.stepdown, 0.1);
    const int    levels   = std::max(1, static_cast<int>(std::ceil((zTop - zBottom) / stepdown)));
    const double rowStep  = std::min(params.stepover, tool.diameter * 0.9);

    // Even-odd-rule clip: for a single closed trace (convex or moderately
    // concave) this is sufficient. Compounds with holes would need a more
    // careful winding-number test — out of scope here.
    auto clipScanlineY = [&](double y, double xLo, double xHi,
                             std::vector<std::pair<double, double>>& spans) {
        std::vector<double> xs;
        for (std::size_t i = 1; i < trace.size(); ++i) {
            const double y0 = trace[i - 1][1];
            const double y1 = trace[i][1];
            if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
                const double t = (y - y0) / (y1 - y0);
                const double x = trace[i - 1][0] + t * (trace[i][0] - trace[i - 1][0]);
                xs.push_back(std::max(xLo, std::min(xHi, x)));
            }
        }
        std::sort(xs.begin(), xs.end());
        for (std::size_t i = 0; i + 1 < xs.size(); i += 2) {
            // Drop hair-thin spans that would emit a no-op pair.
            if (xs[i + 1] - xs[i] > 0.01) spans.emplace_back(xs[i], xs[i + 1]);
        }
    };

    rapid(tp, trace.front()[0], trace.front()[1], safeZ);

    for (int li = 1; li <= levels; ++li) {
        const double zLevel = std::max(zBottom, zTop - li * stepdown);

        // Plunge at the first trace point.
        rapid(tp, trace.front()[0], trace.front()[1], safeZ);
        linearCut(tp, trace.front()[0], trace.front()[1], zLevel, params.feedZ);

        // (a) Perimeter pass at this level.
        for (std::size_t i = 1; i < trace.size(); ++i) {
            linearCut(tp, trace[i][0], trace[i][1], zLevel, params.feedXY);
        }

        // (b) Zigzag interior fill on the Y axis at rowStep spacing.
        bool flip = false;
        double y = minY + rowStep * 0.5;
        while (y < maxY) {
            std::vector<std::pair<double, double>> spans;
            clipScanlineY(y, minX, maxX, spans);
            if (!spans.empty()) {
                // Choose direction based on flip.
                if (flip) std::reverse(spans.begin(), spans.end());
                for (auto& sp : spans) {
                    if (flip) std::swap(sp.first, sp.second);
                }
                for (const auto& sp : spans) {
                    rapid(tp, sp.first, y, safeZ);
                    linearCut(tp, sp.first, y, zLevel, params.feedZ);
                    linearCut(tp, sp.second, y, zLevel, params.feedXY);
                    rapid(tp, sp.second, y, safeZ);
                }
                flip = !flip;
            }
            y += rowStep;
        }

        rapid(tp, trace.front()[0], trace.front()[1], safeZ);
    }

    finalize(tp);
    return tp;
}

// ============================================================================
// drill
// ============================================================================
Toolpath drill(ShapeHandle h,
               const std::vector<std::array<double, 3>>& holes,
               const Tool& bit, const CuttingParams& params,
               double zTop, double zBottom, bool peck)
{
    const auto& shape = ShapeRegistry::instance().get(h);
    if (shape.IsNull()) {
        throw std::runtime_error("forge.cam.drill: shape is null");
    }
    if (holes.empty()) {
        throw std::runtime_error("forge.cam.drill: no holes supplied");
    }
    if (zTop <= zBottom) {
        throw std::runtime_error("forge.cam.drill: zTop must be > zBottom");
    }
    if (bit.diameter <= 0.0) {
        throw std::runtime_error("forge.cam.drill: drill diameter must be > 0");
    }

    Toolpath tp;
    tp.toolId = bit.id;
    const double safeZ    = zTop + 5.0;
    const double pkStep   = std::max(params.stepdown, 0.5);
    const double depth    = zTop - zBottom;

    rapid(tp, holes.front()[0], holes.front()[1], safeZ);
    for (const auto& hole : holes) {
        // Reposition above hole.
        rapid(tp, hole[0], hole[1], safeZ);

        if (peck) {
            // Incremental pecks until we reach zBottom.
            int    pecks = std::max(1, static_cast<int>(std::ceil(depth / pkStep)));
            double zCur  = zTop;
            for (int i = 1; i <= pecks; ++i) {
                const double zNext = std::max(zBottom, zTop - i * pkStep);
                // Rapid down to the previous depth (chip-clear retract).
                rapid(tp, hole[0], hole[1], zCur + 1.0);
                // Plunge.
                linearCut(tp, hole[0], hole[1], zNext, params.feedZ);
                // Retract for chip clearance.
                rapid(tp, hole[0], hole[1], safeZ);
                zCur = zNext;
                if (zCur <= zBottom) break;
            }
        } else {
            linearCut(tp, hole[0], hole[1], zBottom, params.feedZ);
            rapid(tp, hole[0], hole[1], safeZ);
        }
    }

    finalize(tp);
    return tp;
}

// ============================================================================
// faceMill
// ============================================================================
Toolpath faceMill(ShapeHandle h, std::uint32_t faceId,
                  const Tool& tool, const CuttingParams& params,
                  double zTop, double depth)
{
    const auto& shape = ShapeRegistry::instance().get(h);
    if (shape.IsNull()) {
        throw std::runtime_error("forge.cam.faceMill: shape is null");
    }
    TopoDS_Face face = resolveFace(shape, faceId);
    if (face.IsNull()) {
        throw std::runtime_error("forge.cam.faceMill: no +Z planar face found");
    }
    if (depth <= 0.0) {
        throw std::runtime_error("forge.cam.faceMill: depth must be > 0");
    }
    if (tool.diameter <= 0.0) {
        throw std::runtime_error("forge.cam.faceMill: tool diameter must be > 0");
    }

    PlanarFaceInfo info = readFaceInfo(face);
    const double zCut  = zTop - depth;
    const double safeZ = zTop + 5.0;
    const double step  = std::min(params.stepover, tool.diameter * 0.9);
    if (step <= kEps) {
        throw std::runtime_error("forge.cam.faceMill: stepover must be > 0");
    }

    // Inset the bbox slightly so the cutter sweeps over the face edges
    // by (radius), giving a complete face mill rather than leaving a
    // perimeter ridge.
    const double r = tool.diameter * 0.5;
    const double xLo = info.minX - r, xHi = info.maxX + r;
    const double yLo = info.minY - r, yHi = info.maxY + r;

    Toolpath tp;
    tp.toolId = tool.id;

    rapid(tp, xLo, yLo, safeZ);
    linearCut(tp, xLo, yLo, zCut, params.feedZ);

    bool   flip = false;
    double y    = yLo;
    while (y <= yHi + kEps) {
        const double xStart = flip ? xHi : xLo;
        const double xEnd   = flip ? xLo : xHi;

        // Reposition to row start at cut depth (avoid an unnecessary rapid
        // if we're already there).
        if (std::abs(tp.moves.back().x - xStart) > kEps) {
            linearCut(tp, xStart, y, zCut, params.feedXY);
        }
        linearCut(tp, xEnd, y, zCut, params.feedXY);

        y += step;
        if (y <= yHi + kEps) {
            // Step to the next row at the same Z (no retract for face-mill).
            linearCut(tp, xEnd, y, zCut, params.feedXY);
        }
        flip = !flip;
    }

    rapid(tp, tp.moves.back().x, tp.moves.back().y, safeZ);

    finalize(tp);
    return tp;
}

} // namespace forge::cam
