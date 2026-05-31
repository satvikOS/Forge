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

}  // namespace forge
