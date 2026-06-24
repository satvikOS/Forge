// Sketcher.cpp — Forge-native facade over planegcs.
//
// Each `forge::Sketch` owns the planegcs GCS::System and the storage for the
// raw doubles that planegcs's pointer-based Point/Line/Circle/Arc structs
// reference. Solving in planegcs mutates those doubles in place; we read
// them back through the same storage.
//
// We tag the 32-bit IDs that JS sees so we can disambiguate "point id"
// (a ParamId) from "entity id" (a Line/Circle/Arc) in addConstraint without
// requiring a separate type argument:
//   - param IDs use bit 31 = 0
//   - entity IDs use bit 31 = 1
// The remaining 31 bits index into per-sketch vectors.

#include "forge/Sketcher.hpp"

#include "GCS.h"
#include "Geo.h"

#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <Geom_Circle.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GC_MakeCircle.hxx>
#include <Precision.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

#include <cmath>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <vector>

namespace forge {

namespace {

constexpr std::uint32_t kEntityTagBit = 0x80000000u;
constexpr std::uint32_t kIndexMask    = 0x7FFFFFFFu;

inline bool isEntity(std::uint32_t id) { return (id & kEntityTagBit) != 0; }
inline std::uint32_t toEntityId(std::uint32_t idx) { return idx | kEntityTagBit; }
inline std::uint32_t toParamId (std::uint32_t idx) { return idx; }
inline std::uint32_t indexOf   (std::uint32_t id ) { return id & kIndexMask; }

// Tag the constraints with monotonic positive integers so that planegcs's
// per-tag diagnostics line up with the order the JS caller added them in.
// Tag 0 is reserved by planegcs ("no tag" sentinel).
inline int nextTag(int& counter) { return ++counter; }

}  // namespace

// Enum class for entity kinds so we can route addConstraint correctly.
enum class SketchEntityKind : std::uint8_t {
    Line   = 1,
    Circle = 2,
    Arc    = 3,
};

struct SketchEntityRecord {
    SketchEntityKind kind;
    // Index into kind-specific vector (lines_, circles_, arcs_). We keep
    // them separated so the planegcs pointer fields stay stable across
    // additions — std::vector reallocations would invalidate Point&.
    std::uint32_t    typedIndex;
};

struct Sketch {
    // GCS::System holds the constraint network. ~System frees all
    // GCS::Constraint*s registered through addConstraint; we own everything
    // else (Point/Line/... structs and the raw doubles they point at).
    GCS::System gcs;

    // The unknown parameter storage. We allocate doubles via unique_ptrs so
    // their addresses are stable for the lifetime of the sketch.
    std::vector<std::unique_ptr<double>> params;

    // Parallel: each entry is a (px, py) pair into params[].
    struct PointRec {
        std::uint32_t xIdx;
        std::uint32_t yIdx;
    };
    std::vector<PointRec>       points;
    std::vector<GCS::Point>     gcsPoints;   // mirrors points; planegcs reads from here

    // Geometry objects (we own them; planegcs's constraints reference them
    // by pointer/reference so they must live as long as the sketch does).
    std::vector<std::unique_ptr<GCS::Line>>   lines;
    std::vector<std::unique_ptr<GCS::Circle>> circles;
    std::vector<std::unique_ptr<GCS::Arc>>    arcs;

    // Flat list mapping SketchEntityId index → (kind, typedIndex).
    std::vector<SketchEntityRecord> entityIndex;

    // "Value" parameters used by constraints that hold a target value
    // (e.g. Distance) — stored separately so they aren't part of the
    // unknowns vector handed to declareUnknowns().
    std::vector<std::unique_ptr<double>> constraintValues;

    // Tag counter for constraint registrations.
    int nextConstraintTag = 0;

    // Build the unknowns vector (every point's x,y plus every entity's
    // intrinsic params — radii and arc angles).
    void collectUnknowns(GCS::VEC_pD& out) const {
        out.clear();
        for (auto const& p : gcsPoints) {
            out.push_back(p.x);
            out.push_back(p.y);
        }
        for (auto const& c : circles) {
            out.push_back(c->rad);
        }
        for (auto const& a : arcs) {
            out.push_back(a->rad);
            out.push_back(a->startAngle);
            out.push_back(a->endAngle);
        }
    }

    // Helpers ------------------------------------------------------------
    double* allocParam(double initial) {
        auto p = std::make_unique<double>(initial);
        double* raw = p.get();
        params.emplace_back(std::move(p));
        return raw;
    }
    double* allocValue(double initial) {
        auto p = std::make_unique<double>(initial);
        double* raw = p.get();
        constraintValues.emplace_back(std::move(p));
        return raw;
    }

    GCS::Point& pointByParamId(std::uint32_t pid) {
        std::uint32_t idx = indexOf(pid);
        if (isEntity(pid) || idx >= gcsPoints.size()) {
            throw std::runtime_error("forge::sketcher: invalid point id");
        }
        return gcsPoints[idx];
    }
    GCS::Line&   lineByEntityId(std::uint32_t eid) {
        if (!isEntity(eid)) throw std::runtime_error("forge::sketcher: expected entity id");
        std::uint32_t idx = indexOf(eid);
        if (idx >= entityIndex.size() || entityIndex[idx].kind != SketchEntityKind::Line)
            throw std::runtime_error("forge::sketcher: entity is not a Line");
        return *lines[entityIndex[idx].typedIndex];
    }
    GCS::Circle& circleByEntityId(std::uint32_t eid) {
        if (!isEntity(eid)) throw std::runtime_error("forge::sketcher: expected entity id");
        std::uint32_t idx = indexOf(eid);
        if (idx >= entityIndex.size() || entityIndex[idx].kind != SketchEntityKind::Circle)
            throw std::runtime_error("forge::sketcher: entity is not a Circle");
        return *circles[entityIndex[idx].typedIndex];
    }
    GCS::Arc& arcByEntityId(std::uint32_t eid) {
        if (!isEntity(eid)) throw std::runtime_error("forge::sketcher: expected entity id");
        std::uint32_t idx = indexOf(eid);
        if (idx >= entityIndex.size() || entityIndex[idx].kind != SketchEntityKind::Arc)
            throw std::runtime_error("forge::sketcher: entity is not an Arc");
        return *arcs[entityIndex[idx].typedIndex];
    }
};

// ============================================================ SketchRegistry
SketchRegistry& SketchRegistry::instance() {
    static SketchRegistry r;
    return r;
}

SketchHandle SketchRegistry::createSketch() {
    std::lock_guard<std::mutex> g(mtx_);
    SketchHandle h = next_++;
    if (h == kInvalidSketch) h = next_++;  // never hand out 0
    sketches_.emplace(h, std::make_unique<Sketch>());
    return h;
}

bool SketchRegistry::exists(SketchHandle h) const {
    std::lock_guard<std::mutex> g(mtx_);
    return sketches_.find(h) != sketches_.end();
}

Sketch& SketchRegistry::get(SketchHandle h) {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = sketches_.find(h);
    if (it == sketches_.end()) {
        throw std::runtime_error("forge::sketcher: invalid sketch handle");
    }
    return *it->second;
}

void SketchRegistry::destroySketch(SketchHandle h) {
    std::lock_guard<std::mutex> g(mtx_);
    sketches_.erase(h);
}

std::size_t SketchRegistry::liveCount() const {
    std::lock_guard<std::mutex> g(mtx_);
    return sketches_.size();
}

// ============================================================ free functions
SketchHandle createSketch() {
    return SketchRegistry::instance().createSketch();
}
void destroySketch(SketchHandle h) {
    SketchRegistry::instance().destroySketch(h);
}

SketchParamId addPoint(SketchHandle h, double x, double y) {
    Sketch& s = SketchRegistry::instance().get(h);
    double* px = s.allocParam(x);
    double* py = s.allocParam(y);
    s.points.push_back({static_cast<std::uint32_t>(s.params.size() - 2),
                        static_cast<std::uint32_t>(s.params.size() - 1)});
    GCS::Point gp; gp.x = px; gp.y = py;
    s.gcsPoints.push_back(gp);
    return toParamId(static_cast<std::uint32_t>(s.gcsPoints.size() - 1));
}

SketchEntityId addLine(SketchHandle h, SketchParamId p0, SketchParamId p1) {
    Sketch& s = SketchRegistry::instance().get(h);
    auto& a = s.pointByParamId(p0);
    auto& b = s.pointByParamId(p1);
    auto line = std::make_unique<GCS::Line>();
    line->p1 = a;
    line->p2 = b;
    s.lines.push_back(std::move(line));
    SketchEntityRecord rec{SketchEntityKind::Line, static_cast<std::uint32_t>(s.lines.size() - 1)};
    s.entityIndex.push_back(rec);
    return toEntityId(static_cast<std::uint32_t>(s.entityIndex.size() - 1));
}

SketchEntityId addCircle(SketchHandle h, SketchParamId center, double radius) {
    Sketch& s = SketchRegistry::instance().get(h);
    auto& c = s.pointByParamId(center);
    auto circle = std::make_unique<GCS::Circle>();
    circle->center = c;
    circle->rad = s.allocParam(radius);
    s.circles.push_back(std::move(circle));
    SketchEntityRecord rec{SketchEntityKind::Circle, static_cast<std::uint32_t>(s.circles.size() - 1)};
    s.entityIndex.push_back(rec);
    return toEntityId(static_cast<std::uint32_t>(s.entityIndex.size() - 1));
}

SketchEntityId addArc(SketchHandle h, SketchParamId center, SketchParamId p0, SketchParamId p1) {
    Sketch& s = SketchRegistry::instance().get(h);
    auto& cp = s.pointByParamId(center);
    auto& sp = s.pointByParamId(p0);
    auto& ep = s.pointByParamId(p1);
    double cx = *cp.x, cy = *cp.y;
    double sx = *sp.x, sy = *sp.y;
    double ex = *ep.x, ey = *ep.y;
    double dx = sx - cx, dy = sy - cy;
    double r0 = std::sqrt(dx * dx + dy * dy);
    double ang0 = std::atan2(sy - cy, sx - cx);
    double ang1 = std::atan2(ey - cy, ex - cx);
    auto arc = std::make_unique<GCS::Arc>();
    arc->center = cp;
    arc->start  = sp;
    arc->end    = ep;
    arc->rad        = s.allocParam(r0);
    arc->startAngle = s.allocParam(ang0);
    arc->endAngle   = s.allocParam(ang1);
    s.arcs.push_back(std::move(arc));
    SketchEntityRecord rec{SketchEntityKind::Arc, static_cast<std::uint32_t>(s.arcs.size() - 1)};
    s.entityIndex.push_back(rec);
    return toEntityId(static_cast<std::uint32_t>(s.entityIndex.size() - 1));
}

// ---------------------------------------------------------------- constraints
std::uint32_t addConstraint(SketchHandle h, SketchConstraintKind kind,
                            const std::vector<std::uint32_t>& refs, double value) {
    Sketch& s = SketchRegistry::instance().get(h);
    int tag = nextTag(s.nextConstraintTag);
    auto need = [&](std::size_t n) {
        if (refs.size() < n) {
            throw std::runtime_error("forge::sketcher: constraint missing refs");
        }
    };
    switch (kind) {
    case SketchConstraintKind::Coincident: {
        need(2);
        s.gcs.addConstraintP2PCoincident(s.pointByParamId(refs[0]), s.pointByParamId(refs[1]), tag);
        break;
    }
    case SketchConstraintKind::Parallel: {
        need(2);
        s.gcs.addConstraintParallel(s.lineByEntityId(refs[0]), s.lineByEntityId(refs[1]), tag);
        break;
    }
    case SketchConstraintKind::Perpendicular: {
        need(2);
        s.gcs.addConstraintPerpendicular(s.lineByEntityId(refs[0]), s.lineByEntityId(refs[1]), tag);
        break;
    }
    case SketchConstraintKind::Distance: {
        need(2);
        double* d = s.allocValue(value);
        s.gcs.addConstraintP2PDistance(s.pointByParamId(refs[0]), s.pointByParamId(refs[1]), d, tag);
        break;
    }
    case SketchConstraintKind::Horizontal: {
        if (refs.size() >= 1 && isEntity(refs[0])) {
            s.gcs.addConstraintHorizontal(s.lineByEntityId(refs[0]), tag);
        } else {
            need(2);
            s.gcs.addConstraintHorizontal(s.pointByParamId(refs[0]), s.pointByParamId(refs[1]), tag);
        }
        break;
    }
    case SketchConstraintKind::Vertical: {
        if (refs.size() >= 1 && isEntity(refs[0])) {
            s.gcs.addConstraintVertical(s.lineByEntityId(refs[0]), tag);
        } else {
            need(2);
            s.gcs.addConstraintVertical(s.pointByParamId(refs[0]), s.pointByParamId(refs[1]), tag);
        }
        break;
    }
    case SketchConstraintKind::PointOnLine: {
        need(2);
        s.gcs.addConstraintPointOnLine(s.pointByParamId(refs[0]), s.lineByEntityId(refs[1]), tag);
        break;
    }
    case SketchConstraintKind::PointOnCircle: {
        need(2);
        s.gcs.addConstraintPointOnCircle(s.pointByParamId(refs[0]), s.circleByEntityId(refs[1]), tag);
        break;
    }
    case SketchConstraintKind::Equal: {
        need(2);
        // Equal-length for lines or equal-radius for circles. We dispatch by
        // looking up the entity kinds of refs[0] / refs[1].
        std::uint32_t idx0 = indexOf(refs[0]);
        if (!isEntity(refs[0]) || !isEntity(refs[1]) ||
            idx0 >= s.entityIndex.size()) {
            throw std::runtime_error("forge::sketcher: Equal requires two entities");
        }
        SketchEntityKind k0 = s.entityIndex[idx0].kind;
        if (k0 == SketchEntityKind::Line) {
            s.gcs.addConstraintEqualLength(s.lineByEntityId(refs[0]), s.lineByEntityId(refs[1]), tag);
        } else if (k0 == SketchEntityKind::Circle) {
            s.gcs.addConstraintEqualRadius(s.circleByEntityId(refs[0]), s.circleByEntityId(refs[1]), tag);
        } else {
            throw std::runtime_error("forge::sketcher: Equal not supported for arcs (use circles)");
        }
        break;
    }
    case SketchConstraintKind::Tangent: {
        need(2);
        // We support line↔circle (the most common sketcher use). The `ccw`
        // direction flag is set to true by default — planegcs uses it to
        // select which side of the line is "inside".
        s.gcs.addConstraintTangent(s.lineByEntityId(refs[0]), s.circleByEntityId(refs[1]),
                                   /*ccw=*/true, tag);
        break;
    }
    default:
        throw std::runtime_error("forge::sketcher: unknown constraint kind");
    }
    return static_cast<std::uint32_t>(tag);
}

// -------------------------------------------------------------------- solve
SketchSolveResult solve(SketchHandle h) {
    Sketch& s = SketchRegistry::instance().get(h);

    GCS::VEC_pD unknowns;
    s.collectUnknowns(unknowns);

    s.gcs.declareUnknowns(unknowns);
    s.gcs.initSolution();
    int rc = s.gcs.solve(/*isFine=*/true, GCS::DogLeg);
    if (rc == GCS::Success || rc == GCS::Converged ||
        rc == GCS::SuccessfulSolutionInvalid) {
        s.gcs.applySolution();
    }

    int dof = s.gcs.dofsNumber();
    bool hasConflicting = s.gcs.hasConflicting();
    bool hasRedundant   = s.gcs.hasRedundant();

    SketchSolveResult out{};
    out.dof = dof;
    out.iterations = 0;  // planegcs doesn't expose this through the public API
    if (rc == GCS::Success || rc == GCS::Converged) {
        if (hasConflicting) {
            out.status = SketchSolveStatus::Inconsistent;
        } else {
            out.status = SketchSolveStatus::Success;
            (void)hasRedundant;  // redundant but consistent → still Success
        }
    } else {
        // Even a failed numeric solve may be diagnosed as conflicting via DOF.
        if (hasConflicting || dof < 0) {
            out.status = SketchSolveStatus::Inconsistent;
        } else {
            out.status = SketchSolveStatus::Failed;
        }
    }
    return out;
}

// -------------------------------------------------------------- read / write
SketchPoint readPoint(SketchHandle h, SketchParamId pid) {
    Sketch& s = SketchRegistry::instance().get(h);
    GCS::Point& p = s.pointByParamId(pid);
    return SketchPoint{*p.x, *p.y};
}

void writePoint(SketchHandle h, SketchParamId pid, double x, double y) {
    Sketch& s = SketchRegistry::instance().get(h);
    GCS::Point& p = s.pointByParamId(pid);
    *p.x = x;
    *p.y = y;
}

// ---------------------------------------------------------------- extractWires
//
// Convert each line / circle / arc into a TopoDS_Edge on the Z=0 plane,
// then stitch lines + arcs into wires by matching endpoints (within
// Precision::Confusion). Circles become their own closed wire each.
// Returns the (possibly multi-wire) collection — Features.cpp consumes the
// first wire for single-profile ops (extrude/revolve) and the full list
// for ops that want each loop independently (loft sections).
std::vector<TopoDS_Wire> extractWires(SketchHandle h) {
    Sketch& s = SketchRegistry::instance().get(h);
    std::vector<TopoDS_Wire> wires;

    // ---- (A) closed loops: each circle is its own wire --------------------
    for (const auto& cptr : s.circles) {
        const GCS::Circle& c = *cptr;
        gp_Pnt center(*c.center.x, *c.center.y, 0.0);
        gp_Dir axis(0, 0, 1);
        gp_Circ circ(gp_Ax2(center, axis), *c.rad);
        TopoDS_Edge e = BRepBuilderAPI_MakeEdge(circ).Edge();
        BRepBuilderAPI_MakeWire mkw(e);
        if (mkw.IsDone()) wires.push_back(mkw.Wire());
    }

    // ---- (B) open segments: lines + arcs ---------------------------------
    // Build each as a TopoDS_Edge, recording the (start, end) 3D points.
    struct Seg {
        TopoDS_Edge edge;
        gp_Pnt a, b;
    };
    std::vector<Seg> segs;

    for (const auto& lptr : s.lines) {
        const GCS::Line& l = *lptr;
        gp_Pnt p1(*l.p1.x, *l.p1.y, 0.0);
        gp_Pnt p2(*l.p2.x, *l.p2.y, 0.0);
        if (p1.Distance(p2) < Precision::Confusion()) continue;  // degenerate
        TopoDS_Edge e = BRepBuilderAPI_MakeEdge(p1, p2).Edge();
        segs.push_back({e, p1, p2});
    }

    for (const auto& aptr : s.arcs) {
        const GCS::Arc& ar = *aptr;
        gp_Pnt center(*ar.center.x, *ar.center.y, 0.0);
        gp_Pnt sp(*ar.start.x, *ar.start.y, 0.0);
        gp_Pnt ep(*ar.end.x,   *ar.end.y,   0.0);
        // Midpoint on the arc via startAngle/endAngle so OCCT picks the
        // correct arc direction. Fall back to a straight-edge if degenerate.
        const double r = *ar.rad;
        const double sa = *ar.startAngle;
        const double ea = *ar.endAngle;
        if (r < Precision::Confusion() || std::abs(ea - sa) < 1e-9) {
            continue;
        }
        const double ma = sa + 0.5 * (ea - sa);
        gp_Pnt mp(center.X() + r * std::cos(ma),
                  center.Y() + r * std::sin(ma), 0.0);
        GC_MakeArcOfCircle mk(sp, mp, ep);
        if (!mk.IsDone()) continue;
        TopoDS_Edge e = BRepBuilderAPI_MakeEdge(mk.Value()).Edge();
        segs.push_back({e, sp, ep});
    }

    // ---- (C) stitch segments into wires by endpoint matching -------------
    std::vector<bool> used(segs.size(), false);
    auto coincident = [](const gp_Pnt& p, const gp_Pnt& q) {
        return p.Distance(q) < 1.0e-5;  // 10 µm — looser than Precision::Confusion
    };

    for (std::size_t i = 0; i < segs.size(); ++i) {
        if (used[i]) continue;
        used[i] = true;
        BRepBuilderAPI_MakeWire mkw(segs[i].edge);
        gp_Pnt frontPt = segs[i].a;
        gp_Pnt backPt  = segs[i].b;
        bool grew = true;
        while (grew) {
            grew = false;
            for (std::size_t j = 0; j < segs.size(); ++j) {
                if (used[j]) continue;
                if (coincident(backPt, segs[j].a)) {
                    mkw.Add(segs[j].edge);
                    backPt = segs[j].b;
                    used[j] = true; grew = true;
                } else if (coincident(backPt, segs[j].b)) {
                    mkw.Add(segs[j].edge);
                    backPt = segs[j].a;
                    used[j] = true; grew = true;
                } else if (coincident(frontPt, segs[j].b)) {
                    mkw.Add(segs[j].edge);
                    frontPt = segs[j].a;
                    used[j] = true; grew = true;
                } else if (coincident(frontPt, segs[j].a)) {
                    mkw.Add(segs[j].edge);
                    frontPt = segs[j].b;
                    used[j] = true; grew = true;
                }
            }
        }
        if (mkw.IsDone()) {
            wires.push_back(mkw.Wire());
        }
    }

    return wires;
}

// ------------------------------------------------------- extractProfileRings
//
// IN-HOUSE KERNEL STEP 3b — OCCT-FREE. Walk the SAME GCS::Line/Circle/Arc data
// extractWires reads, but emit ordered geom::Point2 rings (no OCCT). A circle
// becomes its own sampled ring; lines + arcs (each sampled into chords) are
// stitched head-to-tail by endpoint matching into one ring per closed loop.
std::vector<std::vector<native::geom::Point2>>
extractProfileRings(SketchHandle h, int circleSegments) {
    using native::geom::Point2;
    Sketch& s = SketchRegistry::instance().get(h);
    std::vector<std::vector<Point2>> rings;

    const int segs = circleSegments < 8 ? 8 : circleSegments;
    constexpr double kTwoPi = 6.28318530717958647692;
    constexpr double kEps   = 1.0e-5;   // match extractWires' 10 µm stitch tol

    // ---- (A) closed loops: each circle is its own sampled ring -------------
    for (const auto& cptr : s.circles) {
        const GCS::Circle& c = *cptr;
        const double cx = *c.center.x, cy = *c.center.y, r = *c.rad;
        if (!(r > Precision::Confusion())) continue;
        std::vector<Point2> ring;
        ring.reserve(static_cast<std::size_t>(segs));
        // CCW sampling (positive signed area) — the caller re-orients anyway.
        for (int i = 0; i < segs; ++i) {
            const double a = (kTwoPi * i) / segs;
            ring.push_back(Point2{cx + r * std::cos(a), cy + r * std::sin(a)});
        }
        rings.push_back(std::move(ring));
    }

    // ---- (B) open segments: lines + arcs, each as an ordered polyline ------
    // Each segment is sampled to >= 2 points; we keep its endpoints exact so
    // the stitching by endpoint match is robust.
    struct Seg {
        std::vector<Point2> pts;  // ordered, >= 2, endpoints == pts.front()/back()
    };
    std::vector<Seg> segs2;

    for (const auto& lptr : s.lines) {
        const GCS::Line& l = *lptr;
        Point2 a{*l.p1.x, *l.p1.y}, b{*l.p2.x, *l.p2.y};
        const double dx = b.x - a.x, dy = b.y - a.y;
        if (std::sqrt(dx*dx + dy*dy) < Precision::Confusion()) continue;
        segs2.push_back(Seg{{a, b}});
    }

    for (const auto& aptr : s.arcs) {
        const GCS::Arc& ar = *aptr;
        const double cx = *ar.center.x, cy = *ar.center.y, r = *ar.rad;
        double sa = *ar.startAngle, ea = *ar.endAngle;
        if (r < Precision::Confusion() || std::abs(ea - sa) < 1e-9) continue;
        // Sample the arc at the same angular resolution as a full circle.
        const double sweep = ea - sa;
        int n = static_cast<int>(std::ceil(std::abs(sweep) / kTwoPi * segs));
        if (n < 1) n = 1;
        std::vector<Point2> pts;
        pts.reserve(static_cast<std::size_t>(n) + 1);
        // Exact endpoints from the stored start/end points (so stitching is
        // robust against startAngle/endAngle rounding); interior from angles.
        pts.push_back(Point2{*ar.start.x, *ar.start.y});
        for (int i = 1; i < n; ++i) {
            const double a = sa + sweep * (static_cast<double>(i) / n);
            pts.push_back(Point2{cx + r * std::cos(a), cy + r * std::sin(a)});
        }
        pts.push_back(Point2{*ar.end.x, *ar.end.y});
        segs2.push_back(Seg{std::move(pts)});
    }

    // ---- (C) stitch segments into rings by endpoint matching ---------------
    auto near = [&](const Point2& p, const Point2& q) {
        const double dx = p.x - q.x, dy = p.y - q.y;
        return std::sqrt(dx*dx + dy*dy) < kEps;
    };
    std::vector<bool> used(segs2.size(), false);
    for (std::size_t i = 0; i < segs2.size(); ++i) {
        if (used[i]) continue;
        used[i] = true;
        // Start the chain with segment i (front -> back).
        std::vector<Point2> chain = segs2[i].pts;
        bool grew = true;
        while (grew) {
            grew = false;
            for (std::size_t j = 0; j < segs2.size(); ++j) {
                if (used[j]) continue;
                const Point2& chFront = chain.front();
                const Point2& chBack  = chain.back();
                const auto& sp = segs2[j].pts;
                const Point2& sF = sp.front();
                const Point2& sB = sp.back();
                if (near(chBack, sF)) {                       // append forward
                    for (std::size_t k = 1; k < sp.size(); ++k) chain.push_back(sp[k]);
                    used[j] = true; grew = true;
                } else if (near(chBack, sB)) {                // append reversed
                    for (std::size_t k = sp.size(); k-- > 1; ) chain.push_back(sp[k-1]);
                    used[j] = true; grew = true;
                } else if (near(chFront, sB)) {               // prepend forward
                    for (std::size_t k = sp.size() - 1; k-- > 0; ) chain.insert(chain.begin(), sp[k]);
                    used[j] = true; grew = true;
                } else if (near(chFront, sF)) {               // prepend reversed
                    for (std::size_t k = 1; k < sp.size(); ++k) chain.insert(chain.begin(), sp[k]);
                    used[j] = true; grew = true;
                }
            }
        }
        // Drop a duplicated closing vertex if the chain closed on itself (the
        // native ring contract is "no repeated closing vertex").
        if (chain.size() >= 3 && near(chain.front(), chain.back())) {
            chain.pop_back();
        }
        // Keep chains of >= 2 points: a closed profile loop is >= 3, but an OPEN
        // path (the sweep spine) is legitimately a 2-point straight segment.
        // Profile callers filter by signedArea/size >= 3; path callers accept 2.
        if (chain.size() >= 2) rings.push_back(std::move(chain));
    }

    return rings;
}

// =================================================================== diagnostics
//
// Phase A of sketcher-constraints.md — surface the planegcs diagnose pipeline.
// All numerics already exist in GCS::System; these functions only re-package the
// engine's own getters and map the raw double* dependent-parameter pointers back
// to the point / entity IDs the JS caller holds.

namespace {

// Map a raw parameter pointer (as returned by GCS::System::getDependentParams)
// back to the owning geometry. The Sketch owns every double the engine touches:
//   - point x/y          → gcsPoints[i].x / .y      → SketchParamId i
//   - circle rad         → circles[i]->rad          → SketchEntityId for that circle
//   - arc rad/start/end  → arcs[i]->rad/startAngle/endAngle → SketchEntityId for that arc
// Returns true on a hit and fills role + ownerId.
bool mapParamToGeometry(const Sketch& s, const double* p,
                        SketchParamRole& role, std::uint32_t& ownerId) {
    // Points first (the common case).
    for (std::uint32_t i = 0; i < s.gcsPoints.size(); ++i) {
        if (s.gcsPoints[i].x == p) { role = SketchParamRole::PointX; ownerId = toParamId(i); return true; }
        if (s.gcsPoints[i].y == p) { role = SketchParamRole::PointY; ownerId = toParamId(i); return true; }
    }
    // Entity-intrinsic params: walk the flat entityIndex so ownerId is the SketchEntityId.
    for (std::uint32_t e = 0; e < s.entityIndex.size(); ++e) {
        const auto& rec = s.entityIndex[e];
        if (rec.kind == SketchEntityKind::Circle) {
            const GCS::Circle& c = *s.circles[rec.typedIndex];
            if (c.rad == p) { role = SketchParamRole::CircleRadius; ownerId = toEntityId(e); return true; }
        } else if (rec.kind == SketchEntityKind::Arc) {
            const GCS::Arc& a = *s.arcs[rec.typedIndex];
            if (a.rad == p)        { role = SketchParamRole::ArcRadius;      ownerId = toEntityId(e); return true; }
            if (a.startAngle == p) { role = SketchParamRole::ArcStartAngle;  ownerId = toEntityId(e); return true; }
            if (a.endAngle == p)   { role = SketchParamRole::ArcEndAngle;    ownerId = toEntityId(e); return true; }
        }
    }
    return false;
}

}  // namespace

SketchDiagnostics diagnoseSketch(SketchHandle h) {
    Sketch& s = SketchRegistry::instance().get(h);

    // Make sure the engine has a fresh diagnosis even if solve() was never
    // called. declareUnknowns + initSolution(DogLeg) runs diagnose() internally
    // (GCS::System::initSolution → diagnose). diagnose is a Jacobian-rank
    // analysis: it does NOT move geometry.
    GCS::VEC_pD unknowns;
    s.collectUnknowns(unknowns);
    s.gcs.declareUnknowns(unknowns);
    s.gcs.initSolution(GCS::DogLeg);
    s.gcs.diagnose(GCS::DogLeg);

    SketchDiagnostics d{};
    d.dof                  = s.gcs.dofsNumber();
    d.emptyDiagnoseMatrix  = s.gcs.isEmptyDiagnoseMatrix();
    d.hasConflicting       = s.gcs.hasConflicting();
    d.hasRedundant         = s.gcs.hasRedundant();
    d.hasPartiallyRedundant= s.gcs.hasPartiallyRedundant();

    GCS::VEC_I conflicting, redundant, partiallyRedundant;
    s.gcs.getConflicting(conflicting);
    s.gcs.getRedundant(redundant);
    s.gcs.getPartiallyRedundant(partiallyRedundant);
    d.conflicting        = std::vector<int>(conflicting.begin(), conflicting.end());
    d.redundant          = std::vector<int>(redundant.begin(), redundant.end());
    d.partiallyRedundant = std::vector<int>(partiallyRedundant.begin(), partiallyRedundant.end());

    // Dependent params (still-free geometry). getDependentParamsGroups gives the
    // coupling groups; we map each pointer to its geometry and record its group.
    GCS::VEC_pD dependent;
    s.gcs.getDependentParams(dependent);
    std::vector<std::vector<double*>> groups;
    s.gcs.getDependentParamsGroups(groups);
    d.dependentParamGroupCount = static_cast<int>(groups.size());

    auto groupOf = [&](const double* p) -> int {
        for (std::size_t g = 0; g < groups.size(); ++g) {
            for (const double* q : groups[g]) {
                if (q == p) return static_cast<int>(g);
            }
        }
        return -1;
    };
    for (const double* p : dependent) {
        SketchDependentParam dp{};
        dp.role  = SketchParamRole::Unknown;
        dp.ownerId = 0;
        SketchParamRole role; std::uint32_t owner;
        if (mapParamToGeometry(s, p, role, owner)) { dp.role = role; dp.ownerId = owner; }
        dp.group = groupOf(p);
        d.dependentParams.push_back(dp);
    }

    // DCM-style classification.
    if (d.emptyDiagnoseMatrix) {
        d.classification = "empty";
    } else if (d.hasConflicting) {
        d.classification = "over";
    } else if (d.dof > 0) {
        d.classification = "under";
    } else if (d.hasRedundant || d.hasPartiallyRedundant) {
        d.classification = "redundant";
    } else {
        d.classification = "well";
    }
    return d;
}

double constraintResidual(SketchHandle h, int tag) {
    Sketch& s = SketchRegistry::instance().get(h);
    return s.gcs.calculateConstraintErrorByTag(tag);
}

std::vector<SketchConstraintResidual> allConstraintResiduals(SketchHandle h) {
    Sketch& s = SketchRegistry::instance().get(h);
    std::vector<SketchConstraintResidual> out;
    out.reserve(static_cast<std::size_t>(s.nextConstraintTag));
    // Tags are monotonic positive ints 1..nextConstraintTag (Sketcher.cpp::nextTag).
    for (int t = 1; t <= s.nextConstraintTag; ++t) {
        out.push_back(SketchConstraintResidual{t, s.gcs.calculateConstraintErrorByTag(t)});
    }
    return out;
}

SketchAuditResult auditSketch(SketchHandle h) {
    Sketch& s = SketchRegistry::instance().get(h);

    // Legacy static counting estimate (pre-solve UX hint only — NOT the truth).
    // entity DOF: point 2, line 4, circle 3, arc 5. We can recover the entity
    // breakdown from the Sketch's own storage.
    auto staticEstimate = [&]() -> int {
        int totalDof = 2 * static_cast<int>(s.gcsPoints.size())
                     + 1 * static_cast<int>(s.circles.size())   // radius (centre is a point already counted)
                     + 3 * static_cast<int>(s.arcs.size());      // radius + 2 angles
        // We cannot recover per-constraint static cost without the original kind
        // list, so we approximate "removed DOF" by (totalParams - solverDof);
        // the solver value below is the real one anyway.
        return totalDof;  // raw parameter count; solverDof is the source of truth
    };

    SketchDiagnostics diag = diagnoseSketch(h);

    SketchAuditResult r{};
    r.totalEntities = static_cast<int>(s.entityIndex.size());
    r.totalConstraints = s.nextConstraintTag;
    r.staticEstimate = staticEstimate();
    r.solverDof = diag.dof;
    r.status = diag.classification;
    r.hasConflicting = diag.hasConflicting;
    r.hasRedundant = diag.hasRedundant;
    r.hasPartiallyRedundant = diag.hasPartiallyRedundant;
    return r;
}

}  // namespace forge
