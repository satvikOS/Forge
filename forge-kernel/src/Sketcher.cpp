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
#include <Precision.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
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

// ---------------------------------------------------------------- shared stitch
//
// OCCT_ZERO_ROADMAP W2.5 — the ONE endpoint-stitching state machine shared by
// BOTH extractWires (OCCT geometry) and extractProfileRings (native polylines),
// retiring the duplicated stitch loops the two previously carried. It is purely
// 2D + OCCT-free: it consumes only each open segment's (start,end) 2D endpoints
// and returns ordered CHAINS of (segmentIndex, reversed) so the caller can
// assemble its own per-segment geometry (an OCCT edge or a sampled polyline) in
// loop order, flipping the segment when `reversed`. The 1e-5 (10 µm) coincidence
// tolerance is the shared contract both paths used before this dedup.
struct StitchEnd { double x, y; };
struct ChainLink { std::size_t seg; bool reversed; };

// The 10 µm coincidence tolerance, named once. It is the sketcher's answer to
// "are these two points the same point", so it is also the bound on how far any
// repair below is allowed to move sketch geometry.
constexpr double kSketchStitchTol = 1.0e-5;

inline std::vector<std::vector<ChainLink>>
stitchSegments(const std::vector<std::pair<StitchEnd, StitchEnd>>& ends) {
    constexpr double kStitchEps = kSketchStitchTol;
    auto nearXY = [](const StitchEnd& p, const StitchEnd& q) {
        const double dx = p.x - q.x, dy = p.y - q.y;
        return std::sqrt(dx * dx + dy * dy) < kStitchEps;
    };
    std::vector<std::vector<ChainLink>> chains;
    std::vector<bool> used(ends.size(), false);
    for (std::size_t i = 0; i < ends.size(); ++i) {
        if (used[i]) continue;
        used[i] = true;
        std::vector<ChainLink> chain{ ChainLink{ i, false } };
        StitchEnd frontPt = ends[i].first;   // open end at the chain's head
        StitchEnd backPt  = ends[i].second;  // open end at the chain's tail
        bool grew = true;
        while (grew) {
            grew = false;
            for (std::size_t j = 0; j < ends.size(); ++j) {
                if (used[j]) continue;
                const StitchEnd& a = ends[j].first;
                const StitchEnd& b = ends[j].second;
                if (nearXY(backPt, a)) {              // append j forward at tail
                    chain.push_back({ j, false }); backPt = b; used[j] = true; grew = true;
                } else if (nearXY(backPt, b)) {        // append j reversed at tail
                    chain.push_back({ j, true });  backPt = a; used[j] = true; grew = true;
                } else if (nearXY(frontPt, b)) {       // prepend j forward at head
                    chain.insert(chain.begin(), { j, false }); frontPt = a; used[j] = true; grew = true;
                } else if (nearXY(frontPt, a)) {       // prepend j reversed at head
                    chain.insert(chain.begin(), { j, true });  frontPt = b; used[j] = true; grew = true;
                }
            }
        }
        chains.push_back(std::move(chain));
    }
    return chains;
}

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

    // What KIND an entity id names, without throwing. The constraint arms below
    // dispatch on this instead of try/catch-ing the typed accessors: a caller
    // that hands RADIUS an arc is not making a mistake, and "try circle, catch,
    // try arc" makes a legal call look like a recovered error in every log.
    SketchEntityKind kindOfEntity(std::uint32_t eid) {
        if (!isEntity(eid)) throw std::runtime_error("forge::sketcher: expected entity id");
        std::uint32_t idx = indexOf(eid);
        if (idx >= entityIndex.size())
            throw std::runtime_error("forge::sketcher: invalid entity id");
        return entityIndex[idx].kind;
    }

    // A CIRCLE OR AN ARC, as one reference.
    //
    // This is not a shortcut: GCS::Arc DERIVES from GCS::Circle (Geo.h:228), so
    // `center` and `rad` are literally the same members on both, and planegcs's
    // own Circle/Arc overloads have byte-identical bodies —
    //   addConstraintCircleRadius   -> addConstraintEqual(c.rad, radius)
    //   addConstraintArcRadius      -> addConstraintEqual(a.rad, radius)
    //   addConstraintCircleDiameter -> addConstraintProportional(c.rad, d, 0.5)
    //   addConstraintArcDiameter    -> addConstraintProportional(a.rad, d, 0.5)
    // (GCS.cpp:1188-1206). Writing a dispatch whose two arms cannot differ would
    // be a branch that can never be covered by a test, so there is one arm.
    GCS::Circle& conicByEntityId(std::uint32_t eid) {
        switch (kindOfEntity(eid)) {
            case SketchEntityKind::Circle: return circleByEntityId(eid);
            case SketchEntityKind::Arc:    return arcByEntityId(eid);
            case SketchEntityKind::Line:   break;
        }
        throw std::runtime_error("forge::sketcher: entity is a Line, expected a Circle or an Arc");
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
    // A value CAST into this enum from outside the enumerator set would fall
    // straight through the (default-less) switch below and return a tag for a
    // constraint that was never registered. The JS binding forwards an integer
    // from script, so this is reachable input, not a hypothetical.
    const auto rawKind = static_cast<std::uint32_t>(kind);
    if (rawKind < static_cast<std::uint32_t>(SketchConstraintKind::Coincident) ||
        rawKind > static_cast<std::uint32_t>(SketchConstraintKind::DistanceY)) {
        throw std::runtime_error("forge::sketcher: unknown constraint kind " +
                                 std::to_string(rawKind));
    }
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
        // POINT-ON-OBJECT, not point-on-line. The IR spells this one keyword
        // (PTON) and a drawing puts a point on a circle or an arc as readily as
        // on a line; refusing the other two would make the caller pick the right
        // one of three keywords for a distinction planegcs does not make either
        // — it has all three primitives and the target's kind already says which.
        // Before this, PTON onto a circle or an arc THREW.
        GCS::Point& p = s.pointByParamId(refs[0]);
        switch (s.kindOfEntity(refs[1])) {
            case SketchEntityKind::Line:
                s.gcs.addConstraintPointOnLine(p, s.lineByEntityId(refs[1]), tag);
                break;
            case SketchEntityKind::Circle:
                s.gcs.addConstraintPointOnCircle(p, s.circleByEntityId(refs[1]), tag);
                break;
            case SketchEntityKind::Arc:
                s.gcs.addConstraintPointOnArc(p, s.arcByEntityId(refs[1]), tag);
                break;
        }
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
        } else {
            // "Equal not supported for arcs (use circles)" was a REFUSAL with a
            // primitive sitting right there: GCS.h declares EqualRadius for
            // (Circle,Circle), (Circle,Arc) and (Arc,Arc). An arc's radius is a
            // radius. Equal fillets on a bracket are among the commonest sketch
            // constraints there are, and this said no to all of them.
            s.gcs.addConstraintEqualRadius(s.conicByEntityId(refs[0]),
                                           s.conicByEntityId(refs[1]), tag);
        }
        break;
    }
    case SketchConstraintKind::Tangent: {
        need(2);
        // line-circle was "the most common sketcher use", and it was the ONLY
        // one wired — so a fillet arc tangent to the wall it fillets, which is
        // what tangency is FOR, threw. GCS.h has (Line,Circle), (Line,Arc),
        // (Circle,Circle), (Arc,Arc) and (Circle,Arc); dispatch on the pair.
        //
        // The operands may arrive either way round (a drawing says "this arc is
        // tangent to that line" as readily as the reverse), so the line is found
        // rather than assumed to be first. `ccw=true` is planegcs's side-of-the-
        // line selector and keeps its previous default.
        const SketchEntityKind k0 = s.kindOfEntity(refs[0]);
        const SketchEntityKind k1 = s.kindOfEntity(refs[1]);
        if (k0 == SketchEntityKind::Line && k1 == SketchEntityKind::Line) {
            throw std::runtime_error(
                "forge::sketcher: Tangent needs at least one circle or arc "
                "(two lines are tangent only where they are collinear — use COLL)");
        }
        if (k0 == SketchEntityKind::Line || k1 == SketchEntityKind::Line) {
            const std::uint32_t lineRef  = (k0 == SketchEntityKind::Line) ? refs[0] : refs[1];
            const std::uint32_t conicRef = (k0 == SketchEntityKind::Line) ? refs[1] : refs[0];
            GCS::Line& l = s.lineByEntityId(lineRef);
            if (s.kindOfEntity(conicRef) == SketchEntityKind::Arc) {
                s.gcs.addConstraintTangent(l, s.arcByEntityId(conicRef), /*ccw=*/true, tag);
            } else {
                s.gcs.addConstraintTangent(l, s.circleByEntityId(conicRef), /*ccw=*/true, tag);
            }
        } else if (k0 == SketchEntityKind::Arc && k1 == SketchEntityKind::Arc) {
            s.gcs.addConstraintTangent(s.arcByEntityId(refs[0]), s.arcByEntityId(refs[1]), tag);
        } else if (k0 == SketchEntityKind::Circle && k1 == SketchEntityKind::Circle) {
            s.gcs.addConstraintTangent(s.circleByEntityId(refs[0]), s.circleByEntityId(refs[1]), tag);
        } else {
            const std::uint32_t circRef = (k0 == SketchEntityKind::Circle) ? refs[0] : refs[1];
            const std::uint32_t arcRef  = (k0 == SketchEntityKind::Circle) ? refs[1] : refs[0];
            s.gcs.addConstraintTangent(s.circleByEntityId(circRef), s.arcByEntityId(arcRef), tag);
        }
        break;
    }

    // =========================================================================
    // THE TEN THE CENSUS DESIGNED AND THE FACADE NEVER WIRED. Every arm is a
    // call into the vendored engine; nothing below computes geometry.
    // =========================================================================
    case SketchConstraintKind::Radius: {
        need(1);
        s.gcs.addConstraintCircleRadius(s.conicByEntityId(refs[0]), s.allocValue(value), tag);
        break;
    }
    case SketchConstraintKind::Diameter: {
        need(1);
        s.gcs.addConstraintCircleDiameter(s.conicByEntityId(refs[0]), s.allocValue(value), tag);
        break;
    }
    case SketchConstraintKind::Angle: {
        need(2);
        // RADIANS. The IR converts from degrees at its own boundary; see the
        // enumerator comment in Sketcher.hpp, which names the same seam.
        double* a = s.allocValue(value);
        if (isEntity(refs[0]) && isEntity(refs[1])) {
            s.gcs.addConstraintL2LAngle(s.lineByEntityId(refs[0]), s.lineByEntityId(refs[1]), a, tag);
        } else if (!isEntity(refs[0]) && !isEntity(refs[1])) {
            // The angle of the DIRECTION p0->p1 from +x: how a drawing dimensions
            // a single sloped edge, which has no second line to measure against.
            //
            // ★ THE FIVE-ARGUMENT OVERLOAD IS CALLED DELIBERATELY. The obvious
            // four-argument one, addConstraintP2PAngle(p1, p2, angle, tagId),
            // THROWS THE TAG AWAY — vendored GCS.cpp:655 reads
            //
            //     int System::addConstraintP2PAngle(Point& p1, Point& p2,
            //                                       double* angle,
            //                                       int /*tagId*/, bool driving)
            //     { return addConstraintP2PAngle(p1, p2, angle, 0., 0, driving); }
            //
            // with the parameter commented out and 0 — planegcs's "no tag"
            // sentinel — hard-coded in its place. It is the ONLY delegating
            // overload in that file that does this. Counted: 34 delegating
            // definitions, 33 of which forward tagId (the three
            // addConstraintTangentCircumf calls do too -- they are multi-line,
            // so a one-line grep MISSES them and a first count said 30/29).
            //
            // A constraint left on tag 0 is invisible to getConflicting(),
            // clearByTag() and calculateConstraintErrorByTag(), so the geometry
            // would still solve while the repair loop could never demote this
            // constraint and its residual would read NaN. Passing incrAngle = 0.0
            // explicitly reaches the implementation that honours the tag.
            //
            // MEASURED both ways: through the four-argument call the residual for
            // the returned tag is NaN; through this one it is finite.
            // 3rdParty is a verbatim vendor copy (see UPSTREAM.md), so the fix
            // belongs here rather than in the vendored file.
            s.gcs.addConstraintP2PAngle(s.pointByParamId(refs[0]), s.pointByParamId(refs[1]),
                                        a, /*incrAngle=*/0.0, tag);
        } else {
            throw std::runtime_error(
                "forge::sketcher: Angle takes two lines or two points, not one of each");
        }
        break;
    }
    case SketchConstraintKind::Concentric: {
        need(2);
        // Concentric IS coincident centres. planegcs has no separate primitive
        // because there is no separate constraint — FreeCAD spells it the same
        // way. `.center` is a member of Circle, and Arc derives from Circle.
        s.gcs.addConstraintP2PCoincident(s.conicByEntityId(refs[0]).center,
                                         s.conicByEntityId(refs[1]).center, tag);
        break;
    }
    case SketchConstraintKind::Collinear: {
        need(2);
        // Two solver constraints, ONE tag: parallel, plus an endpoint of B on A.
        // Parallel alone permits any offset; PointOnLine alone permits any angle
        // about that point. Sharing the tag means a repair demotes collinearity
        // as the single statement the author wrote, never half of it — a line
        // left parallel-but-offset would be a geometry error the verify channel
        // would report as a satisfied constraint.
        GCS::Line& a = s.lineByEntityId(refs[0]);
        GCS::Line& b = s.lineByEntityId(refs[1]);
        s.gcs.addConstraintParallel(a, b, tag);
        s.gcs.addConstraintPointOnLine(b.p1, a, tag);
        break;
    }
    case SketchConstraintKind::Symmetric: {
        need(3);
        GCS::Point& a = s.pointByParamId(refs[0]);
        GCS::Point& b = s.pointByParamId(refs[1]);
        if (isEntity(refs[2])) {
            s.gcs.addConstraintP2PSymmetric(a, b, s.lineByEntityId(refs[2]), tag);
        } else {
            s.gcs.addConstraintP2PSymmetric(a, b, s.pointByParamId(refs[2]), tag);
        }
        break;
    }
    case SketchConstraintKind::Midpoint: {
        need(3);
        // The point form of Symmetric, and deliberately a SEPARATE kind: see the
        // enumerator comment. Handing MIDPT a line is refused HERE so the caller
        // is told, rather than silently receiving a mirror about that line.
        if (isEntity(refs[2])) {
            throw std::runtime_error(
                "forge::sketcher: Midpoint's third operand is the MIDPOINT (a point), "
                "not a line — mirroring about a line is SYMM");
        }
        s.gcs.addConstraintP2PSymmetric(s.pointByParamId(refs[0]), s.pointByParamId(refs[1]),
                                        s.pointByParamId(refs[2]), tag);
        break;
    }
    case SketchConstraintKind::Fix: {
        need(1);
        // Pin the point WHERE IT IS. The value argument is ignored — a FIX that
        // took coordinates would be a move disguised as a constraint, and CON is
        // pass-through precisely so that no constraint statement moves geometry
        // before the solve.
        GCS::Point& p = s.pointByParamId(refs[0]);
        s.gcs.addConstraintCoordinateX(p, s.allocValue(*p.x), tag);
        s.gcs.addConstraintCoordinateY(p, s.allocValue(*p.y), tag);
        break;
    }
    case SketchConstraintKind::DistanceX: {
        need(2);
        // SIGNED: ConstraintDifference::value() is *param2 - *param1
        // (Constraints.cpp:645), so this enforces bx - ax == value. A DISTX
        // dimension on a drawing is signed, and an unsigned one would make
        // "B is 25 to the LEFT of A" unstateable.
        s.gcs.addConstraintDifference(s.pointByParamId(refs[0]).x, s.pointByParamId(refs[1]).x,
                                      s.allocValue(value), tag);
        break;
    }
    case SketchConstraintKind::DistanceY: {
        need(2);
        s.gcs.addConstraintDifference(s.pointByParamId(refs[0]).y, s.pointByParamId(refs[1]).y,
                                      s.allocValue(value), tag);
        break;
    }
    // NO `default:` ARM, DELIBERATELY. With one, -Wswitch goes quiet, and the
    // 11th kind added to SketchConstraintKind would compile into a silent
    // "registered nothing, returned a tag" — a constraint the caller believes it
    // applied, that the solver has never heard of, and that a residual query
    // reports as NaN rather than as missing. The two hazards are different and
    // each is caught by the mechanism that can actually see it: a NEW ENUMERATOR
    // by -Wswitch here, and an OUT-OF-RANGE CAST by the range check above.
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

// The live geometry of one entity. Every number below is READ from the storage
// planegcs mutates in place; the only arithmetic is the length of the curve
// those numbers define, which is the same formula extractProfileRings uses to
// sample it.
SketchEntityGeometry readEntity(SketchHandle h, SketchEntityId eid) {
    constexpr double kPi = 3.14159265358979323846;
    Sketch& s = SketchRegistry::instance().get(h);
    SketchEntityGeometry g{};
    switch (s.kindOfEntity(eid)) {
        case SketchEntityKind::Line: {
            const GCS::Line& l = s.lineByEntityId(eid);
            g.shape = SketchEntityShape::Line;
            g.x0 = *l.p1.x; g.y0 = *l.p1.y;
            g.x1 = *l.p2.x; g.y1 = *l.p2.y;
            const double dx = g.x1 - g.x0, dy = g.y1 - g.y0;
            g.length = std::sqrt(dx * dx + dy * dy);
            return g;
        }
        case SketchEntityKind::Circle: {
            const GCS::Circle& c = s.circleByEntityId(eid);
            g.shape = SketchEntityShape::Circle;
            g.cx = *c.center.x; g.cy = *c.center.y;
            g.radius = *c.rad;
            g.length = 2.0 * kPi * g.radius;
            return g;
        }
        case SketchEntityKind::Arc: {
            const GCS::Arc& a = s.arcByEntityId(eid);
            g.shape = SketchEntityShape::Arc;
            g.cx = *a.center.x; g.cy = *a.center.y;
            g.radius = *a.rad;
            g.x0 = *a.start.x; g.y0 = *a.start.y;
            g.x1 = *a.end.x;   g.y1 = *a.end.y;
            // The SAME minor-arc normalisation extractWires and
            // extractProfileRings apply, for the same reason: a corner arc that
            // straddles the +/-pi branch cut would otherwise report the MAJOR
            // arc's length while the profile bridge builds the minor one, and a
            // length that disagrees with the geometry is worse than none.
            double sweep = *a.endAngle - *a.startAngle;
            while (sweep <= -kPi) sweep += 2.0 * kPi;
            while (sweep >   kPi) sweep -= 2.0 * kPi;
            g.startAngle = *a.startAngle;
            g.endAngle   = g.startAngle + sweep;
            g.length = std::abs(g.radius * sweep);
            return g;
        }
    }
    throw std::runtime_error("forge::sketcher: unknown entity kind");
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
        double ea = *ar.endAngle;
        // MINOR-ARC NORMALISATION (fix #1). addArc stores start/end angles via
        // atan2 (each in (-pi, pi]), so a corner arc whose sweep straddles the
        // +/-pi branch cut (e.g. a centred rounded-rect's bottom-left corner:
        // start at pi, end at -pi/2) gives a raw sweep of -3pi/2, which would make
        // the native trim below span the MAJOR arc — a concave bite into the profile
        // instead of the convex rounded corner. Bring the sweep into (-pi, pi] so the
        // SHORTER arc is always taken (the trim spans [min(sa,ea), max(sa,ea)], which
        // is the short arc only while |ea - sa| <= pi). Corner/fillet arcs
        // are <= 90deg, so this is unambiguous.
        //
        // ★ THE SEMICIRCLE IS NOT UNAMBIGUOUS, AND THIS COMMENT USED TO SAY IT WAS.
        // It read "a true semicircle (sweep == pi) is preserved unchanged". That is
        // true of +pi and FALSE of -pi: the first loop's boundary is `<=`, so a sweep
        // of exactly -pi becomes +pi -- which does not shorten the arc (both halves
        // are pi) but REVERSES WHICH HALF OF THE CIRCLE IT IS.
        //
        // The deeper fact is that (center, start, end) cannot express a semicircle at
        // all. For |sweep| < pi the two orderings name the same point set, which is
        // why the trim below may discard the sign; at exactly pi they name OPPOSITE
        // halves, and the trim `[min(sa,ea), max(sa,ea)]` always takes the CCW one
        // from the smaller angle. So every semicircle built through here bulges to
        // whichever side that rule picks, and a caller who wanted the other side has
        // no way to say so through this representation.
        //
        // MEASURED CONSEQUENCE, and there is exactly one: `addArc` has two callers
        // (FeatureTreeCompiler.cpp) and only one of them makes semicircles. profSlot's
        // two end caps are `addArc(cR, tr, br)` and `addArc(cL, bl, tl)`, and BOTH land
        // on the inward half -- the right cap via the -pi flip above, the left cap via
        // the min/max trim directly. SLOT therefore builds the straight section with a
        // full circle's area REMOVED: area exactly |(len-wid)*wid - pi*(wid/2)^2| and
        // bbox +/-(len-wid)/2, i.e. -50.4% of the volume its signature promises on
        // SLOT(40,12) (forge-kernel/reports/MODELLING_OP_FAMILIES.md 6.1, three sizes).
        // profRRect is the control and is exact: its arcs are 90deg, so it never
        // reaches the ambiguous case. SLOT is the only defective profile builder, and
        // it is the only op still in the vocabulary's `forbidden_ops` for it.
        //
        // Not fixed here: a fix must be MEASURED through the pinned verifier before it
        // is believed, and this comment is the diagnosis rather than the repair. Two
        // repairs are available and they are not equivalent -- swapping both callers'
        // endpoint order (minimal, keeps 4 edges / 6 faces, but leaves correctness
        // resting on the `<=` boundary two lines below) or splitting each cap into two
        // 90deg arcs through an explicit outer apex (removes the ambiguity by
        // construction, the way profRRect already avoids it, at 6 edges / 8 faces).
        {
            constexpr double kPi = 3.14159265358979323846;
            double sweep = ea - sa;
            while (sweep <= -kPi) sweep += 2.0 * kPi;
            while (sweep >   kPi) sweep -= 2.0 * kPi;
            ea = sa + sweep;
        }
        if (r < Precision::Confusion() || std::abs(ea - sa) < 1e-9) {
            continue;
        }
        // NATIVE ARC (OCCT-zero: no GC_MakeArcOfCircle / TKGeomBase). addArc stores
        // the exact circle for this arc: center, r = |start - center|, and start/end
        // angles as atan2 about center. So `sp` lies exactly on Geom_Circle(center, r)
        // at parameter sa, and the SHORTER arc to ep spans the normalised angular range
        // [min(sa,ea), max(sa,ea)] (|ea - sa| <= pi, guaranteed above). Build the circle
        // in the global XY frame (X dir = +X so param u -> center + r*(cos u, sin u),
        // matching the stored atan2 angles), trim to that CCW span (which passes through
        // the mid-angle, i.e. IS the short arc), and pin the edge vertices to the stored
        // sp/ep so the stitcher's shared-vertex wire assembly stays exact.
        auto makeArcEdge = [&](const gp_Pnt& c, double rr, double a0, double a1,
                               BRepBuilderAPI_MakeEdge& out) {
            gp_Ax2 frame(c, gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
            Handle(Geom_Circle) circ = new Geom_Circle(gp_Circ(frame, rr));
            Handle(Geom_TrimmedCurve) trimmed = new Geom_TrimmedCurve(
                circ, std::min(a0, a1), std::max(a0, a1), Standard_True);
            // pa/pb are the stored endpoints at the (u1,u2) ends so the edge's
            // parameter order increases (MakeEdge requires param(pa) < param(pb)).
            out.Init(trimmed, (a0 <= a1) ? sp : ep, (a0 <= a1) ? ep : sp);
        };

        BRepBuilderAPI_MakeEdge mk;
        makeArcEdge(center, r, sa, ea, mk);

        // ── SARC's SILENT DROP, AND THE CIRCLE THAT PASSES THROUGH NEITHER ──
        //
        // `r` above is |start - centre| ALONE. The end point is then required to
        // lie on THAT circle, and BRepBuilderAPI_MakeEdge(curve, P1, P2) projects
        // both points and REFUSES with PointProjectionFailed once one of them is
        // further than Precision::Confusion() (1e-7 mm) off it. The old code read
        // that refusal as `continue` — the arc vanished from `segs`, the ring it
        // belonged to broke into two OPEN chains, and the caller extruded whichever
        // fragment came back first. No error was raised anywhere.
        //
        // The trigger is NOT "an arc". It is
        //
        //      | |end - centre| - |start - centre| |  >  Precision::Confusion()
        //
        // — the two endpoints are not equidistant from the stated centre. Arcs
        // built by our own profile builders (profRRect and friends) derive both
        // endpoints from the centre by exact arithmetic, so that difference is
        // BIT-ZERO and a rounded-rectangle repro can never fail. Arcs whose three
        // points arrive as independently rounded data — a real CAD tree printed at
        // six decimals, or solver output — miss by ~1e-7..1e-6, and whether a given
        // arc trips depends on WHICH endpoint happens to define `r`, which is why
        // two arcs of one 12-segment ring failed and the other two did not.
        //
        // THE REPAIR. The endpoints are shared topology: the neighbouring line
        // segments end on those exact points and the wire is assembled by matching
        // them, so they may not move. The centre is REDUNDANT — it is over-stated
        // data that must not contradict the endpoints. So correct the centre, not
        // the endpoints: project it onto the perpendicular bisector of (start,end),
        // the unique nearest point from which the two endpoints ARE equidistant.
        // The arc then passes exactly through both stated endpoints, with the same
        // sense, and the projection is a no-op when the input was already
        // consistent (every profile builder, and every arc that works today).
        //
        // BOUNDED, AND LOUD WHEN THE BOUND IS EXCEEDED. |C' - C| is exactly how far
        // this moved geometry, so that is what is bounded — by the SAME 10 µm the
        // stitcher already treats as "the same point". Past it, the three points do
        // not describe an arc and the sketch is REFUSED by name. Nothing is dropped.
        if (!mk.IsDone()) {
            const gp_Vec d(sp, ep);
            const double dlen = d.Magnitude();
            if (dlen > Precision::Confusion()) {
                const gp_Dir dhat(d);
                const gp_Pnt mid(0.5 * (sp.X() + ep.X()), 0.5 * (sp.Y() + ep.Y()), 0.0);
                const double t = gp_Vec(center, mid).Dot(gp_Vec(dhat));
                const gp_Pnt c2(center.XYZ() + t * dhat.XYZ());
                const double shift = center.Distance(c2);
                if (shift > kSketchStitchTol)
                    throw std::runtime_error(
                        "forge::sketcher: arc endpoints are not equidistant from its centre — "
                        "no circle through both lies within " + std::to_string(kSketchStitchTol) +
                        " mm of the stated centre (nearest is " + std::to_string(shift) +
                        " mm away). The three points do not describe an arc.");
                const double r2 = 0.5 * (sp.Distance(c2) + ep.Distance(c2));
                double a0 = std::atan2(sp.Y() - c2.Y(), sp.X() - c2.X());
                double a1 = std::atan2(ep.Y() - c2.Y(), ep.X() - c2.X());
                {
                    constexpr double kPi = 3.14159265358979323846;
                    double sweep2 = a1 - a0;
                    while (sweep2 <= -kPi) sweep2 += 2.0 * kPi;
                    while (sweep2 >   kPi) sweep2 -= 2.0 * kPi;
                    a1 = a0 + sweep2;
                }
                if (r2 > Precision::Confusion() && std::abs(a1 - a0) >= 1e-9)
                    makeArcEdge(c2, r2, a0, a1, mk);
            }
        }
        // An arc that still cannot be built is an ERROR. It used to be a `continue`,
        // and a `continue` here is indistinguishable — to every caller, and to every
        // gate — from a sketch that never contained the arc at all.
        if (!mk.IsDone())
            throw std::runtime_error(
                "forge::sketcher: could not build an edge for a sketch arc (OCCT "
                "BRepBuilderAPI_MakeEdge error " + std::to_string(static_cast<int>(mk.Error())) +
                "). The arc is NOT dropped: the sketch is refused.");
        TopoDS_Edge e = mk.Edge();
        segs.push_back({e, sp, ep});
    }

    // ---- (C) stitch segments into wires via the SHARED stitcher -----------
    // W2.5: the endpoint-matching state machine lives ONCE in stitchSegments
    // (shared with extractProfileRings). Here we feed it each open segment's 2D
    // endpoints, then assemble an OCCT wire per returned chain by adding the
    // ordered edges (BRepBuilderAPI_MakeWire connects them by shared vertices).
    std::vector<std::pair<StitchEnd, StitchEnd>> ends;
    ends.reserve(segs.size());
    for (const auto& sg : segs) {
        ends.push_back({ StitchEnd{ sg.a.X(), sg.a.Y() },
                         StitchEnd{ sg.b.X(), sg.b.Y() } });
    }
    for (const auto& chain : stitchSegments(ends)) {
        if (chain.empty()) continue;
        BRepBuilderAPI_MakeWire mkw;
        for (const auto& link : chain) {
            mkw.Add(segs[link.seg].edge);
        }
        // A chain that will not assemble is an ERROR, for the same reason the arc
        // above is: a dropped wire and a sketch that never drew it are the same
        // thing to every caller downstream.
        if (!mkw.IsDone())
            throw std::runtime_error(
                "forge::sketcher: could not assemble a wire from " +
                std::to_string(chain.size()) + " stitched sketch segment(s) (OCCT "
                "BRepBuilderAPI_MakeWire error " +
                std::to_string(static_cast<int>(mkw.Error())) +
                "). The wire is NOT dropped: the sketch is refused.");
        wires.push_back(mkw.Wire());
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
        // MINOR-ARC NORMALISATION (fix #1) — mirror extractWires: bring the sweep
        // into (-pi, pi] so a corner arc straddling the +/-pi branch cut samples
        // the SHORTER (convex) arc, not the major arc (a concave bite). Corner
        // arcs are <= 90deg; a true semicircle (sweep == pi) is preserved.
        {
            constexpr double kPi = 3.14159265358979323846;
            double s = ea - sa;
            while (s <= -kPi) s += 2.0 * kPi;
            while (s >   kPi) s -= 2.0 * kPi;
            ea = sa + s;
        }
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

    // ---- (C) stitch segments into rings via the SHARED stitcher ------------
    // W2.5: the SAME stitchSegments state machine extractWires uses (10 µm tol).
    // We feed each polyline's two ENDPOINTS, then rebuild each ring by walking
    // the returned ordered (seg, reversed) chain — concatenating each segment's
    // sampled points (reversed when flagged) and dropping the shared joint vertex
    // between consecutive links so interior arc samples are preserved exactly.
    auto near = [&](const Point2& p, const Point2& q) {
        const double dx = p.x - q.x, dy = p.y - q.y;
        return std::sqrt(dx*dx + dy*dy) < kEps;
    };
    std::vector<std::pair<StitchEnd, StitchEnd>> ends2;
    ends2.reserve(segs2.size());
    for (const auto& sg : segs2) {
        ends2.push_back({ StitchEnd{ sg.pts.front().x, sg.pts.front().y },
                          StitchEnd{ sg.pts.back().x,  sg.pts.back().y  } });
    }
    for (const auto& links : stitchSegments(ends2)) {
        std::vector<Point2> chain;
        for (const auto& link : links) {
            const auto& sp = segs2[link.seg].pts;
            if (!link.reversed) {
                for (std::size_t k = (chain.empty() ? 0 : 1); k < sp.size(); ++k)
                    chain.push_back(sp[k]);
            } else {
                for (std::size_t k = (chain.empty() ? sp.size() : sp.size() - 1); k-- > 0; )
                    chain.push_back(sp[k]);
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

    // The two loss-free views. `describe` is the SAME mapping the loop above
    // uses; it is a lambda rather than a third copy of those five lines.
    auto describe = [&](const double* p, int group) {
        SketchDependentParam dp{};
        dp.role = SketchParamRole::Unknown;
        dp.ownerId = 0;
        SketchParamRole role;
        std::uint32_t owner;
        if (mapParamToGeometry(s, p, role, owner)) { dp.role = role; dp.ownerId = owner; }
        dp.group = group;
        return dp;
    };
    // EVERY free parameter, ONCE. Deduplicated by POINTER, which is the
    // parameter's identity here — two entries naming the same double are the
    // same freedom counted twice, and that is the whole defect.
    {
        std::vector<const double*> seen;
        for (const double* p : dependent) {
            if (std::find(seen.begin(), seen.end(), p) != seen.end()) continue;
            seen.push_back(p);
            d.distinctDependentParams.push_back(describe(p, groupOf(p)));
        }
    }
    // The groups, as the engine computed them. Deduplicated WITHIN a group
    // (belt and braces — the engine writes each column once per group) and
    // deliberately NOT deduplicated between groups: two groups sharing a
    // parameter is the coupling this report exists to show.
    for (std::size_t g = 0; g < groups.size(); ++g) {
        std::vector<SketchDependentParam> members;
        std::vector<const double*> seen;
        for (const double* p : groups[g]) {
            if (std::find(seen.begin(), seen.end(), p) != seen.end()) continue;
            seen.push_back(p);
            members.push_back(describe(p, static_cast<int>(g)));
        }
        d.dependentParamGroups.push_back(std::move(members));
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

// ============================================================================
// DIAGNOSE, NEVER REFUSE  (see the contract in Sketcher.hpp)
// ============================================================================

void removeConstraintsByTag(SketchHandle h, int tag) {
    Sketch& s = SketchRegistry::instance().get(h);
    s.gcs.clearByTag(tag);
    // The cached rank analysis describes a system that no longer exists. Not
    // invalidating it is how a repair loop "converges" against a stale verdict.
    s.gcs.invalidatedDiagnosis();
}

SketchSolveReport solveOrRepair(SketchHandle h, int maxDemotions) {
    // Every exit from this function is a REPORT. There is no throw path for a
    // geometry outcome: the only errors left are grammar errors (a bad handle),
    // which SketchRegistry::get already raises before we get here.
    Sketch& s = SketchRegistry::instance().get(h);

    SketchSolveReport rep{};
    rep.passes = 0;
    rep.geometryApplied = false;
    rep.worstResidual = 0.0;

    // Tags still live in the system. A demoted tag is erased from here so it can
    // never be chosen twice.
    std::vector<int> live;
    for (int t = 1; t <= s.nextConstraintTag; ++t) live.push_back(t);

    auto worstLiveResidual = [&](int& tagOut) {
        tagOut = 0;
        double worst = 0.0;
        for (int t : live) {
            const double e = s.gcs.calculateConstraintErrorByTag(t);
            if (!std::isfinite(e)) continue;
            if (std::fabs(e) > std::fabs(worst)) { worst = e; tagOut = t; }
        }
        return worst;
    };

    for (int attempt = 0; attempt <= maxDemotions; ++attempt) {
        const SketchSolveResult r = solve(h);
        ++rep.passes;
        rep.status = r.status;
        rep.dof = r.dof;
        if (r.status == SketchSolveStatus::Success) rep.geometryApplied = true;

        const SketchDiagnostics d = diagnoseSketch(h);
        rep.classification = d.classification;

        // (1) converged and structurally clean — done.
        if (r.status == SketchSolveStatus::Success && !d.hasConflicting) break;
        if (attempt == maxDemotions) break;   // work bound reached; report as-is

        // (2) RANK-VISIBLE conflict: drop the LAST-DECLARED conflicting tag.
        //     Deterministic beats clever — a repair loop needs to predict which
        //     constraint it lost far more than it needs the "best" choice.
        int victim = 0;
        SketchDemotionReason why = SketchDemotionReason::Conflicting;
        for (int t : d.conflicting) {
            const bool isLive = std::find(live.begin(), live.end(), t) != live.end();
            if (isLive && t > victim) victim = t;
        }

        // (3) RANK-BLIND infeasibility: the solve failed but no tag is flagged
        //     conflicting (MEASURED: the 10/10/100 triangle). Fall back to the
        //     residual vector, which DOES name the offender.
        if (victim == 0) {
            if (r.status == SketchSolveStatus::Success) break;  // nothing to repair
            why = SketchDemotionReason::Residual;
            worstLiveResidual(victim);
            if (victim == 0) break;   // no live tag carries a finite error
        }

        const double res = s.gcs.calculateConstraintErrorByTag(victim);
        removeConstraintsByTag(h, victim);
        live.erase(std::remove(live.begin(), live.end(), victim), live.end());
        rep.demoted.push_back(SketchDemotion{victim, why, res});
    }

    // Worst error over the constraints that SURVIVED — the honest "how well is
    // this sketch actually satisfied" number for the caller's verify channel.
    int ignored = 0;
    rep.worstResidual = std::fabs(worstLiveResidual(ignored));

    // (4) Nothing converged? The as-drawn coordinates are still in the parameter
    //     pool — solve() only calls applySolution() on success — so the caller
    //     gets exactly the geometry today's unsolved IR would have produced.
    return rep;
}

}  // namespace forge
