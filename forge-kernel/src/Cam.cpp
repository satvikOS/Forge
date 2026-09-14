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
//        * profile: offset the outer wire INWARD by tool radius using the
//          in-house forge::native::geom::PolygonOffset2D, then sample with
//          nativeQuasiUniformDeflectionParams and emit one trace at this Z.
//          Lead-in is added as a straight tangential segment before the first
//          cutting vertex.
//        * pocket: same offset as profile, plus zigzag rasters clipped by
//          the offset boundary on the Y axis at stepover spacing.
//   4. drill / faceMill build their move lists directly without any wire-offset
//      machinery — they only need the face's planar bbox + center.
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
//   * The inward wire offset REFUSES with a named reason when it cannot be
//     computed. It does NOT fall back to "no offset": a toolpath that traces
//     the UNOFFSET boundary gouges the part by one tool radius while reporting
//     success, and that is the single worst failure this module can ship.
//     profile() and pocket() therefore propagate the refusal as an exception.

#include "forge/Cam.hpp"
#include "forge/ShapeRegistry.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include "forge/OcctCurveSampling.hpp"  // K6: native GCPnts_QuasiUniformDeflection replacement
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>     // snprintf, for the refusal reasons
#include <limits>
#include <string>
#include <utility>
#include <stdexcept>
#include <vector>

// ── TKOffset FAMILY A — the OCCT wire offset is GONE from this file ────────────
// (2026-09-14.) `forge::cam::inwardOffset` used to call
// BRepOffsetAPI_MakeOffset(wire, GeomAbs_Arc).Perform(-r) behind a default-OFF
// compile flag. The class, its header and the flag's branch are DELETED, not
// gated: a flag that stops taking a branch leaves the symbols in the binary, and
// the four TKOffset symbols this file owned — BRepOffsetAPI_MakeOffset's
// ctor(TopoDS_Wire const&, GeomAbs_JoinType, bool), Init(GeomAbs_JoinType, bool),
// Perform(double, double) and its vtable — leave only when the code that calls
// them leaves. This was the ONLY call site of that class in the tree, so family A
// is closed by this file alone.
//
// WHAT COMPUTES THE OFFSET NOW: forge::native::geom::PolygonOffset2D
// (src/native/geom/PolygonOffset2D.cpp), compiled unconditionally into
// FORGE_KERNEL_SOURCES (CMakeLists.txt:2452), so this path does not depend on
// FORGE_NATIVE_BREP. It is a Minkowski-with-a-disk polygon offset: each edge is
// displaced |d| along its outward normal, convex corners are bridged by a
// tessellated circular arc, and the self-overlap a reflex corner creates is
// removed by non-zero-winding region extraction whose ray-crossing tests use a
// robust orient2d predicate. Published provenance, as cited in that file:
//   * loop removal / winding: X. Chen & S. McMains, "Polygon offsetting by
//     computing winding numbers", ASME IDETC/CIE 2005, DETC2005-85513.
//   * exact orientation predicate: J. R. Shewchuk, "Adaptive precision
//     floating-point arithmetic and fast robust geometric predicates",
//     Discrete & Computational Geometry 18(3):305-363, 1997.
//   * the closed-form area law the engine's gate checks against (a CCW square of
//     side s grown by d with round joins has area s^2 + 4sd + pi d^2) is the
//     planar Steiner formula — see e.g. Schneider & Weil, "Stochastic and
//     Integral Geometry", Springer 2008, §14.2.
//
// THE ONE APPROXIMATION, STATED: PolygonOffset2D consumes and returns a POLYGON
// (Loop2 = std::vector<Point2>). A curved input edge is therefore discretised
// before the offset and the answer comes back as a polyline, where OCCT returned
// analytic Geom_OffsetCurve / Geom_Circle edges. That is invisible to every
// consumer of this function and the bound is derived, not asserted:
//   * the only two callers are profile() and pocket() in this file, and BOTH
//     immediately discard the exact geometry by calling
//     sampleWireXY(w, kSampleDeflection = 0.05 mm) — only that polyline reaches
//     the toolpath and the G-code;
//   * the input is discretised at kOffsetInputDeflection = kSampleDeflection/16
//     and the round joins are tessellated to the SAME budget (arcTolerance is set
//     explicitly below rather than left to the engine's |d|-proportional default,
//     so the bound does not grow with tool size), giving a worst-case departure
//     from the exact offset of 2 * 3.125e-3 = 6.25e-3 mm, i.e. 1/8 of the
//     tolerance the caller itself already spends.
// Measured against OCCT over 600 parts, the two answers coincide to 9.72e-3 mm
// worst case on every part where they offset in the same direction
// (reports/corpus_ab/MAKEOFFSET_DECOMPOSITION_2026-09-03.md, T2).
// A boundary that is ONE FULL CIRCLE needs no approximation at all and does not
// take that path — see the exact analytic case in inwardOffset below.
//
// WHERE IT CANNOT MATCH OCCT IT REFUSES. Every failure returns ok=false with a
// NAMED reason and a null shape, and profile()/pocket() turn that into an
// exception. The previous behaviour — return an empty shape, let the caller
// re-use the UNOFFSET wire (the `if (wires.empty()) wires.push_back(outer);`
// that stood at Cam.cpp:427/529) — is what forge-kernel/CMakeLists.txt:960-964
// names as the reason this family could not ship: on the parts where the offset
// was unavailable the cutter would gouge the part by a full tool radius and the
// call would report ok:true. A refusal is strictly better than that, and it is
// the reason the deletion is safe to make unconditional.
#include "forge/native/geom/PolygonOffset2D.hpp"   // PolygonOffset2D, Loop2, OffsetOptions/Result
#include "forge/native/geom/Geom.hpp"              // Point2 (shared 2D point)

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
// TopExp_Explorer returns subshapes in registration order, which for an
// offset result is not necessarily wire order — that gave us a zigzag
// toolpath in the first cut of this slice, when the offset still came from
// OCCT's BRepOffsetAPI_MakeOffset. The hazard is a property of the explorer,
// not of the engine, so the traversal stays as it is.
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

// ---------------------------------------------------------- inward wire offset

// Outcome of an inward wire offset.
//
// `ok == false` ALWAYS carries a non-empty, NAMED `reason` and a null `shape`.
// There is deliberately no "empty means try something else" encoding: an empty
// result used to mean "re-use the unoffset wire", which emits a gouging toolpath
// under an ok:true report. Callers must either use `shape` or propagate `reason`.
struct InwardOffsetResult {
    TopoDS_Shape shape;
    bool         ok{false};
    std::string  reason;
};

InwardOffsetResult offsetRefused(std::string why) {
    InwardOffsetResult r;
    r.ok     = false;
    r.reason = std::move(why);
    return r;
}

InwardOffsetResult offsetDone(TopoDS_Shape sh) {
    InwardOffsetResult r;
    r.ok    = true;
    r.shape = std::move(sh);
    return r;
}

// Format a double into a reason string without dragging in <sstream>.
std::string num(double v) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.6g", v);
    return std::string(buf);
}

// If the wire is exactly ONE full circular edge, return its circle. This is the
// only input shape for which the offset has a closed form, and it is worth
// detecting because it is 38 of the 600 corpus parts' outer wire.
bool wireIsFullCircle(const TopoDS_Wire& wire, gp_Circ& out) {
    int nEdges = 0;
    TopoDS_Edge only;
    for (BRepTools_WireExplorer ex(wire); ex.More(); ex.Next()) {
        if (++nEdges > 1) return false;
        only = ex.Current();
    }
    if (nEdges != 1 || only.IsNull()) return false;
    try {
        BRepAdaptor_Curve ad(only);
        if (ad.GetType() != GeomAbs_Circle) return false;
        // A full circle, not an arc: the edge must span the whole 2*pi period.
        const double span = std::abs(ad.LastParameter() - ad.FirstParameter());
        if (span < 2.0 * M_PI - 1.0e-9) return false;
        out = ad.Circle();
        return true;
    } catch (...) {
        return false;
    }
}

// ── POST-CONDITION: the answer must satisfy the definition of the operation ───
// The inward offset of a region P at distance d is, by definition,
//
//     O_d = { x in P : dist(x, boundary(P)) >= d }
//
// so EVERY point on the boundary of O_d lies at distance exactly d from
// boundary(P). That is checkable in a few microseconds and it is checked here
// rather than trusted, because the engine can return a non-empty answer that
// does not satisfy it.
//
// MEASURED 2026-09-14, forge::native::geom::PolygonOffset2D, CCW 10x10 square,
// arcTolerance 3.125e-3:
//     d = -5.0 .. -10.0   ok=1, 0 loops, "loop collapsed under inward offset"   CORRECT
//     d = -10.5           ok=1, 1 loop,  area 0.5,  vertices 4.5 mm from the boundary
//     d = -12.0           ok=1, 1 loop,  area 8,    vertices 3.0 mm from the boundary
//     d = -20.0           ok=1, 1 loop,  area 200,  vertices 5.0 mm from the boundary,
//                                                   and OUTSIDE the square (winding 0)
// i.e. for |d| greater than the square's SIDE (not its inradius) a ghost loop of
// area 2(|d|-10)^2 comes back with ok=true. Reached through profile(), a 24 mm
// tool on a 10 mm boss would have emitted a toolpath 3 mm from the boundary when
// 12 mm of standoff was asked for -- a gouge reported as success, which is the
// exact failure this whole change exists to remove. The defect is in the engine
// and is reported there; this file does not rely on it being absent.
//
// SAMPLING, STATED HONESTLY: at most kClearanceProbes vertices per result loop
// are probed (evenly spaced, always including the first). The check is therefore
// a NECESSARY condition evaluated on a sample -- it can miss a violation that
// touches no probed vertex, and it can NEVER refuse a result that satisfies the
// definition. Every ghost measured above is caught by any sample, because the
// whole loop violates.
constexpr int kClearanceProbes = 256;

double distPointToSegment2D(const forge::native::geom::Point2& p,
                            const forge::native::geom::Point2& a,
                            const forge::native::geom::Point2& b) {
    const double vx = b.x - a.x, vy = b.y - a.y;
    const double wx = p.x - a.x, wy = p.y - a.y;
    const double vv = vx * vx + vy * vy;
    double t = (vv > 0.0) ? (wx * vx + wy * vy) / vv : 0.0;
    t = std::max(0.0, std::min(1.0, t));
    const double dx = wx - t * vx, dy = wy - t * vy;
    return std::sqrt(dx * dx + dy * dy);
}

// Smallest probed clearance between the offset result and the source boundary.
// Returns +inf when there is nothing to probe.
double worstOffsetClearance(const forge::native::geom::Loop2& src,
                            const std::vector<forge::native::geom::Loop2>& out) {
    using forge::native::geom::Point2;
    double worst = std::numeric_limits<double>::infinity();
    const std::size_t ns = src.pts.size();
    if (ns < 2) return worst;
    for (const auto& L : out) {
        const std::size_t n = L.pts.size();
        if (n == 0) continue;
        const std::size_t step = (n > static_cast<std::size_t>(kClearanceProbes))
                                     ? (n / static_cast<std::size_t>(kClearanceProbes)) : 1;
        for (std::size_t i = 0; i < n; i += step) {
            const Point2& q = L.pts[i];
            double best = std::numeric_limits<double>::infinity();
            for (std::size_t j = 0; j < ns; ++j) {
                best = std::min(best, distPointToSegment2D(q, src.pts[j], src.pts[(j + 1) % ns]));
            }
            worst = std::min(worst, best);
        }
    }
    return worst;
}

// Offset a closed planar wire INWARD (into the region it bounds) by offsetMm.
//
// CONTRACT, unchanged from the OCCT original in everything a caller can observe
// except the failure channel: input is the outer wire of a planar face, output is
// a TopoDS_Wire, or a TopoDS_Compound of wires when the offset splits the region
// into several. wiresOf() + sampleWireXY() consume either unchanged.
//
// -- THE INWARD SIGN, AND A DEFECT THIS FIXES ---------------------------------
// PolygonOffset2D's `d` is NOT winding-relative: d<0 shrinks the region a loop
// encloses and d>0 grows it, for BOTH windings. The code that stood here read
//
//     const double signedDist = loop.isCCW() ? -offsetMm : offsetMm;
//
// which is correct for a CCW loop and BACKWARDS for a CW one -- a wire presenting
// CW offset OUTWARD under a function named inwardOffset. That was measured on the
// engine directly (a 10 mm square: CCW d=-1 -> |area| 64.00000 SHRANK, CW d=+1 ->
// |area| 143.13761 GREW, CW d=-1 -> 64.00000 SHRANK) and pinned rather than fixed
// on 2026-09-03 because a measurement change must not carry a behaviour change
// (reports/corpus_ab/MAKEOFFSET_DECOMPOSITION_2026-09-03.md section 6). It is
// fixed here, where the behaviour change belongs. The 600-part corpus CANNOT see
// it: all 594 outer wires present CCW in their face's own plane frame, so the
// corpus A/B is blind by construction and only a direct CW input reaches it --
// test/cam_family_a_offset_gate.cpp exercises exactly that.
//   * NOTE FOR THE HARNESS OWNER: test/corpus_ab_coverage.cpp:1112 carries a
//     REPLICA of the old rule and :1639 pins it at 143.13761. That replica now
//     differs from this shipped function. No corpus number moves either way (the
//     branch is never taken on the corpus), but the replica should be brought
//     back into line when that harness is next touched.
InwardOffsetResult inwardOffset(const TopoDS_Wire& wire, double offsetMm,
                                const gp_Pln& plane) {
    using forge::native::geom::Loop2;
    using forge::native::geom::Point2;
    using forge::native::geom::PolygonOffset2D;
    using forge::native::geom::OffsetOptions;
    using forge::native::geom::OffsetResult;

    if (wire.IsNull()) return offsetRefused("outer wire is null");
    if (!std::isfinite(offsetMm)) {
        return offsetRefused("tool radius is not finite");
    }
    if (offsetMm < kEps) {
        return offsetRefused("tool radius " + num(offsetMm) +
                             " mm is below the " + num(kEps) +
                             " mm floor -- no standoff to compute");
    }

    // -- EXACT ANALYTIC CASE: the boundary is one full circle ------------------
    // The parallel (offset) curve of a plane curve p(s) with unit normal n(s) at
    // signed distance t is p(s) + t n(s). For a circle n is the radial direction
    // everywhere, so the offset is the CONCENTRIC circle of radius R - d exactly
    // -- no discretisation, no tessellation, no tolerance. (do Carmo,
    // "Differential Geometry of Curves and Surfaces", Prentice-Hall 1976, section
    // 1-5, parallel curves; the general case is not of this kind because the
    // offset of a rational curve is in general irrational -- Farouki & Neff,
    // "Analytic properties of plane offset curves", CAGD 7(1-4):83-99, 1990,
    // which is why everything else below goes through the polygonal engine.)
    gp_Circ circ;
    if (wireIsFullCircle(wire, circ)) {
        const double r0 = circ.Radius();
        const double r1 = r0 - offsetMm;
        if (r1 <= kEps) {
            return offsetRefused("tool radius " + num(offsetMm) +
                                 " mm meets or exceeds the boundary circle radius " +
                                 num(r0) + " mm -- the region has no interior left");
        }
        try {
            gp_Circ inner(circ.Position(), r1);
            BRepBuilderAPI_MakeEdge me(inner);
            if (!me.IsDone()) {
                return offsetRefused("could not build the offset circle edge at radius " +
                                     num(r1) + " mm");
            }
            // Assemble the wire with BRep_Builder (already needed below for the
            // compound) rather than BRepBuilderAPI_MakeWire: a single closed
            // circular edge IS the ring, so there is no chaining to do and the
            // extra header buys nothing.
            TopoDS_Wire w;
            BRep_Builder wb;
            wb.MakeWire(w);
            wb.Add(w, me.Edge());
            if (w.IsNull()) {
                return offsetRefused("could not close the offset circle into a wire");
            }
            return offsetDone(w);
        } catch (...) {
            return offsetRefused("offset circle construction threw at radius " + num(r1) + " mm");
        }
    }

    // -- GENERAL CASE: polygonal offset ---------------------------------------
    // Forward map (wire -> Loop2) in the face's planar XY.
    //  * a wire whose every edge is a straight segment keeps its EXACT vertex walk
    //    (a polygon gains nothing from sampling);
    //  * any curved edge is discretised with the consumer's own sampler at 1/16 of
    //    the consumer's own deflection -- see the bound derived in the block above.
    bool allLines = true;
    for (BRepTools_WireExplorer ex(wire); ex.More(); ex.Next()) {
        try {
            BRepAdaptor_Curve adaptor(ex.Current());
            if (adaptor.GetType() != GeomAbs_Line) { allLines = false; break; }
        } catch (...) {
            allLines = false;
            break;
        }
    }

    Loop2 loop;
    if (allLines) {
        // ex.CurrentVertex() is the edge's start vertex in head-to-tail wire
        // order, so taking it for every edge walks the ring exactly once.
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
        for (const auto& p : sampleWireXY(wire, kOffsetInputDeflection)) {
            loop.pts.push_back(Point2{p[0], p[1]});
        }
    }
    // Loop2 must NOT repeat the first vertex at the end; sampleWireXY closes the
    // ring deliberately, so this always fires on that path.
    if (loop.pts.size() >= 2) {
        const Point2& f = loop.pts.front();
        const Point2& l = loop.pts.back();
        if (std::abs(f.x - l.x) < kEps && std::abs(f.y - l.y) < kEps) loop.pts.pop_back();
    }
    if (loop.pts.size() < 3) {
        return offsetRefused("boundary reduced to " + num(static_cast<double>(loop.pts.size())) +
                             " distinct vertices -- not a polygon");
    }

    // Inward is d < 0 for BOTH windings -- see the sign note above.
    const double signedDist = -offsetMm;

    OffsetOptions opts;
    opts.join = forge::native::geom::JoinType::Round;
    // Tessellate the round joins to the SAME budget the input was sampled at,
    // rather than the engine's |d|-proportional default, so the total departure
    // from the exact offset is bounded by 2*kOffsetInputDeflection independently
    // of the tool size.
    opts.arcTolerance = kOffsetInputDeflection;

    OffsetResult r = PolygonOffset2D::offsetLoop(loop, signedDist, opts);
    if (!r.ok) {
        return offsetRefused("PolygonOffset2D declined: " +
                             (r.reason.empty() ? std::string("unstated reason") : r.reason));
    }
    if (r.loops.empty()) {
        return offsetRefused("the boundary collapsed under an inward offset of " +
                             num(offsetMm) + " mm -- the tool does not fit inside it (" +
                             num(static_cast<double>(r.droppedLoops)) + " loop(s) dropped)");
    }

    // Post-condition (see the block above): every probed vertex of the answer
    // must stand at least `offsetMm` clear of the source boundary. The slack
    // covers the round-join chord sagitta (bounded by arcTolerance) plus
    // rounding, and is 4*3.125e-3 = 0.0125 mm plus a part per million of d --
    // a quarter of the tolerance the consumer itself spends, and three orders
    // of magnitude below the 3 mm error the ghost above would have shipped.
    const double clearanceSlack = 4.0 * opts.arcTolerance + 1.0e-6 * offsetMm + 1.0e-9;
    const double worstClear = worstOffsetClearance(loop, r.loops);
    if (std::isfinite(worstClear) && worstClear < offsetMm - clearanceSlack) {
        return offsetRefused("the offset engine returned a region only " + num(worstClear) +
                             " mm clear of the boundary when " + num(offsetMm) +
                             " mm of standoff was required -- refusing it rather than "
                             "cutting there");
    }

    // Inverse map (Loop2 -> wire) at the face plane's Z.
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
    if (outWires.empty()) {
        return offsetRefused("the offset produced " +
                             num(static_cast<double>(r.loops.size())) +
                             " loop(s) but none closed into a wire");
    }

    if (outWires.size() == 1) return offsetDone(outWires.front());
    TopoDS_Compound comp;
    BRep_Builder bb;
    bb.MakeCompound(comp);
    for (const TopoDS_Wire& w : outWires) bb.Add(comp, w);
    return offsetDone(comp);
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

    // Offset the outer wire inward by the tool radius.
    //
    // REFUSAL, NOT FALLBACK. What stood here re-used the UNOFFSET wire when the
    // offset was unavailable, and said so in a comment about "a usable path".
    // It is not a usable path: tracing the boundary itself drives the cutter
    // centre along the finished edge, so the part is gouged by a full tool
    // radius (3 mm for the 6 mm tool this corpus uses) while profile() returns
    // a Toolpath that reports success. forge-kernel/CMakeLists.txt:960-964 names
    // exactly that as the reason family A could not ship. An offset that cannot
    // be computed is now an error carrying the engine's own named reason.
    InwardOffsetResult off = inwardOffset(outer, toolRadius, info.plane);
    if (!off.ok) {
        throw std::runtime_error(
            "forge.cam.profile: refusing to emit a toolpath with no tool-radius "
            "standoff -- inward offset unavailable: " + off.reason);
    }
    std::vector<TopoDS_Wire> wires = wiresOf(off.shape);
    if (wires.empty()) {
        throw std::runtime_error(
            "forge.cam.profile: inward offset reported success but yielded no wire");
    }

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

    // REFUSAL, NOT FALLBACK -- see the note at the same point in profile().
    InwardOffsetResult off = inwardOffset(outer, toolRadius, info.plane);
    if (!off.ok) {
        throw std::runtime_error(
            "forge.cam.pocket: refusing to emit a toolpath with no tool-radius "
            "standoff -- inward offset unavailable: " + off.reason);
    }
    std::vector<TopoDS_Wire> wires = wiresOf(off.shape);
    if (wires.empty()) {
        throw std::runtime_error(
            "forge.cam.pocket: inward offset reported success but yielded no wire");
    }

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
