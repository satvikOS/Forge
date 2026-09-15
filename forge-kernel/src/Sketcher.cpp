// Sketcher.cpp — Forge-native facade over the libforge_gcs constraint solver.
//
// Each `forge::Sketch` owns one solver system inside libforge_gcs — FreeCAD's
// planegcs, modified for Forge and built as a SEPARATE SHARED LIBRARY under
// third_party/freecad-derived/sketch-solver (LGPL-2.1-or-later). This file is
// Forge's own adapter: it maps Forge's sketch model (points, lines, circles,
// arcs, the SketchConstraintKind vocabulary) onto the library's C ABI and never
// compiles a line of the solver itself. The solver's parameter storage lives in
// the library; everything here reads and writes it through that interface.
//
// We tag the 32-bit IDs that JS sees so we can disambiguate "point id"
// (a ParamId) from "entity id" (a Line/Circle/Arc) in addConstraint without
// requiring a separate type argument:
//   - param IDs use bit 31 = 0
//   - entity IDs use bit 31 = 1
// The remaining 31 bits index into per-sketch vectors. A point id's index IS
// the library's point index and an entity id's index IS its curve index,
// because every point and curve is created through the library in id order.

#include "forge/Sketcher.hpp"

#include "forge_gcs/forge_gcs.h"

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

struct Sketch {
    struct SolverDeleter {
        void operator()(forge_gcs_system* g) const noexcept { forge_gcs_destroy(g); }
    };
    // The solver system. It owns the constraint network AND the parameter
    // storage (every point coordinate, radius and arc angle); this struct holds
    // only what Forge needs to address it.
    std::unique_ptr<forge_gcs_system, SolverDeleter> gcs{forge_gcs_create()};

    // Kind of each entity, indexed by the entity id's index — which is also the
    // library's curve index.
    std::vector<SketchEntityKind> entityKinds;
    std::uint32_t pointCount = 0;

    // Tag counter for constraint registrations.
    int nextConstraintTag = 0;

    forge_gcs_system* sys() {
        if (!gcs) throw std::runtime_error("forge::sketcher: the constraint solver could not allocate a sketch");
        return gcs.get();
    }
    // A library failure, raised as the facade's usual std::runtime_error with the
    // library's own sentence attached.
    [[noreturn]] void raise(const char* what) {
        throw std::runtime_error(std::string("forge::sketcher: ") + what + ": " +
                                 forge_gcs_last_error(gcs.get()));
    }
    std::int32_t check(std::int32_t rc, const char* what) {
        if (rc < 0) raise(what);
        return rc;
    }

    // Helpers ------------------------------------------------------------
    std::int32_t pointIndex(std::uint32_t pid) const {
        std::uint32_t idx = indexOf(pid);
        if (isEntity(pid) || idx >= pointCount) {
            throw std::runtime_error("forge::sketcher: invalid point id");
        }
        return static_cast<std::int32_t>(idx);
    }
    std::int32_t typedEntityIndex(std::uint32_t eid, SketchEntityKind want, const char* notMsg) const {
        if (!isEntity(eid)) throw std::runtime_error("forge::sketcher: expected entity id");
        std::uint32_t idx = indexOf(eid);
        if (idx >= entityKinds.size() || entityKinds[idx] != want)
            throw std::runtime_error(notMsg);
        return static_cast<std::int32_t>(idx);
    }
    std::int32_t lineIndex(std::uint32_t eid) const {
        return typedEntityIndex(eid, SketchEntityKind::Line, "forge::sketcher: entity is not a Line");
    }
    std::int32_t circleIndex(std::uint32_t eid) const {
        return typedEntityIndex(eid, SketchEntityKind::Circle, "forge::sketcher: entity is not a Circle");
    }
    std::int32_t arcIndex(std::uint32_t eid) const {
        return typedEntityIndex(eid, SketchEntityKind::Arc, "forge::sketcher: entity is not an Arc");
    }

    // What KIND an entity id names, without throwing. The constraint arms below
    // dispatch on this instead of try/catch-ing the typed accessors: a caller
    // that hands RADIUS an arc is not making a mistake, and "try circle, catch,
    // try arc" makes a legal call look like a recovered error in every log.
    SketchEntityKind kindOfEntity(std::uint32_t eid) const {
        if (!isEntity(eid)) throw std::runtime_error("forge::sketcher: expected entity id");
        std::uint32_t idx = indexOf(eid);
        if (idx >= entityKinds.size())
            throw std::runtime_error("forge::sketcher: invalid entity id");
        return entityKinds[idx];
    }

    // A CIRCLE OR AN ARC, as one reference. planegcs's Arc derives from its
    // Circle, and the radius / diameter / equal-radius primitives take either
    // (the library's "conic" operand), so there is one arm and not two that
    // could never differ.
    std::int32_t conicIndex(std::uint32_t eid) const {
        switch (kindOfEntity(eid)) {
            case SketchEntityKind::Circle:
            case SketchEntityKind::Arc:    return static_cast<std::int32_t>(indexOf(eid));
            case SketchEntityKind::Line:   break;
        }
        throw std::runtime_error("forge::sketcher: entity is a Line, expected a Circle or an Arc");
    }

    // Live reads of the library's parameter storage.
    StitchEnd pointAt(std::int32_t idx) {
        double x = 0.0, y = 0.0;
        check(forge_gcs_get_point(sys(), idx, &x, &y), "reading a point");
        return StitchEnd{x, y};
    }
    forge_gcs_curve curveAt(std::int32_t idx) {
        forge_gcs_curve c{};
        check(forge_gcs_get_curve(sys(), idx, &c), "reading a curve");
        return c;
    }
    // Every entity of one kind, in creation order.
    std::vector<std::int32_t> entitiesOfKind(SketchEntityKind k) const {
        std::vector<std::int32_t> out;
        for (std::size_t i = 0; i < entityKinds.size(); ++i)
            if (entityKinds[i] == k) out.push_back(static_cast<std::int32_t>(i));
        return out;
    }

    // One solver primitive under `tag`.
    void add(std::int32_t primitive, std::initializer_list<std::int32_t> refs, int tag,
             double value = 0.0, std::int32_t flags = 0) {
        const std::vector<std::int32_t> r(refs);
        check(forge_gcs_add_constraint(sys(), primitive, r.data(), static_cast<std::int32_t>(r.size()),
                                       value, flags, tag),
              "the solver refused a constraint");
    }
};

// ============================================================ SketchRegistry
SketchRegistry& SketchRegistry::instance() {
    static SketchRegistry r;
    return r;
}

SketchHandle SketchRegistry::createSketch() {
    // THE SOLVER IS A REPLACEABLE LIBRARY. libforge_gcs is LGPL and loaded
    // dynamically, so the copy in Frameworks may be one a user rebuilt. A library
    // speaking a different interface version would be misread silently -- struct
    // layouts and enumerator values are the interface -- so it is refused here,
    // with the reason, before a single sketch is built on it.
    if (forge_gcs_abi_version() != FORGE_GCS_ABI_VERSION) {
        throw std::runtime_error(
            "forge::sketcher: the sketch solver library (libforge_gcs) speaks interface version " +
            std::to_string(forge_gcs_abi_version()) + " but this build of Forge needs version " +
            std::to_string(FORGE_GCS_ABI_VERSION) + "; reinstall the library that shipped with Forge");
    }
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
    const std::int32_t idx = s.check(forge_gcs_add_point(s.sys(), x, y), "adding a point");
    s.pointCount = static_cast<std::uint32_t>(idx) + 1;
    return toParamId(static_cast<std::uint32_t>(idx));
}

SketchEntityId addLine(SketchHandle h, SketchParamId p0, SketchParamId p1) {
    Sketch& s = SketchRegistry::instance().get(h);
    const std::int32_t a = s.pointIndex(p0);
    const std::int32_t b = s.pointIndex(p1);
    const std::int32_t idx = s.check(forge_gcs_add_line(s.sys(), a, b), "adding a line");
    s.entityKinds.push_back(SketchEntityKind::Line);
    return toEntityId(static_cast<std::uint32_t>(idx));
}

SketchEntityId addCircle(SketchHandle h, SketchParamId center, double radius) {
    Sketch& s = SketchRegistry::instance().get(h);
    const std::int32_t c = s.pointIndex(center);
    const std::int32_t idx = s.check(forge_gcs_add_circle(s.sys(), c, radius), "adding a circle");
    s.entityKinds.push_back(SketchEntityKind::Circle);
    return toEntityId(static_cast<std::uint32_t>(idx));
}

SketchEntityId addArc(SketchHandle h, SketchParamId center, SketchParamId p0, SketchParamId p1) {
    Sketch& s = SketchRegistry::instance().get(h);
    const std::int32_t ci = s.pointIndex(center);
    const std::int32_t si = s.pointIndex(p0);
    const std::int32_t ei = s.pointIndex(p1);
    const StitchEnd cp = s.pointAt(ci), sp = s.pointAt(si), ep = s.pointAt(ei);
    double cx = cp.x, cy = cp.y;
    double sx = sp.x, sy = sp.y;
    double ex = ep.x, ey = ep.y;
    double dx = sx - cx, dy = sy - cy;
    double r0 = std::sqrt(dx * dx + dy * dy);
    double ang0 = std::atan2(sy - cy, sx - cx);
    double ang1 = std::atan2(ey - cy, ex - cx);
    const std::int32_t idx =
        s.check(forge_gcs_add_arc(s.sys(), ci, si, ei, r0, ang0, ang1), "adding an arc");
    s.entityKinds.push_back(SketchEntityKind::Arc);
    return toEntityId(static_cast<std::uint32_t>(idx));
}

// ---------------------------------------------------------------- constraints
//
// Every arm below RESOLVES its operands first — each resolution throws the
// facade's own message on a wrong id or a wrong kind — and only then hands
// primitives to the solver, so a refused constraint never leaves half of itself
// behind (COLL and FIX each add two primitives under one tag).
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
        const auto a = s.pointIndex(refs[0]);
        const auto b = s.pointIndex(refs[1]);
        s.add(FORGE_GCS_P2P_COINCIDENT, {a, b}, tag);
        break;
    }
    case SketchConstraintKind::Parallel: {
        need(2);
        const auto a = s.lineIndex(refs[0]);
        const auto b = s.lineIndex(refs[1]);
        s.add(FORGE_GCS_PARALLEL, {a, b}, tag);
        break;
    }
    case SketchConstraintKind::Perpendicular: {
        need(2);
        const auto a = s.lineIndex(refs[0]);
        const auto b = s.lineIndex(refs[1]);
        s.add(FORGE_GCS_PERPENDICULAR, {a, b}, tag);
        break;
    }
    case SketchConstraintKind::Distance: {
        need(2);
        const auto a = s.pointIndex(refs[0]);
        const auto b = s.pointIndex(refs[1]);
        s.add(FORGE_GCS_P2P_DISTANCE, {a, b}, tag, value);
        break;
    }
    case SketchConstraintKind::Horizontal: {
        if (refs.size() >= 1 && isEntity(refs[0])) {
            s.add(FORGE_GCS_HORIZONTAL_LINE, {s.lineIndex(refs[0])}, tag);
        } else {
            need(2);
            const auto a = s.pointIndex(refs[0]);
            const auto b = s.pointIndex(refs[1]);
            s.add(FORGE_GCS_HORIZONTAL_POINTS, {a, b}, tag);
        }
        break;
    }
    case SketchConstraintKind::Vertical: {
        if (refs.size() >= 1 && isEntity(refs[0])) {
            s.add(FORGE_GCS_VERTICAL_LINE, {s.lineIndex(refs[0])}, tag);
        } else {
            need(2);
            const auto a = s.pointIndex(refs[0]);
            const auto b = s.pointIndex(refs[1]);
            s.add(FORGE_GCS_VERTICAL_POINTS, {a, b}, tag);
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
        const auto p = s.pointIndex(refs[0]);
        switch (s.kindOfEntity(refs[1])) {
            case SketchEntityKind::Line:
                s.add(FORGE_GCS_POINT_ON_LINE, {p, s.lineIndex(refs[1])}, tag);
                break;
            case SketchEntityKind::Circle:
                s.add(FORGE_GCS_POINT_ON_CIRCLE, {p, s.circleIndex(refs[1])}, tag);
                break;
            case SketchEntityKind::Arc:
                s.add(FORGE_GCS_POINT_ON_ARC, {p, s.arcIndex(refs[1])}, tag);
                break;
        }
        break;
    }
    case SketchConstraintKind::PointOnCircle: {
        need(2);
        const auto p = s.pointIndex(refs[0]);
        const auto c = s.circleIndex(refs[1]);
        s.add(FORGE_GCS_POINT_ON_CIRCLE, {p, c}, tag);
        break;
    }
    case SketchConstraintKind::Equal: {
        need(2);
        // Equal-length for lines or equal-radius for circles. We dispatch by
        // looking up the entity kinds of refs[0] / refs[1].
        std::uint32_t idx0 = indexOf(refs[0]);
        if (!isEntity(refs[0]) || !isEntity(refs[1]) ||
            idx0 >= s.entityKinds.size()) {
            throw std::runtime_error("forge::sketcher: Equal requires two entities");
        }
        SketchEntityKind k0 = s.entityKinds[idx0];
        if (k0 == SketchEntityKind::Line) {
            const auto a = s.lineIndex(refs[0]);
            const auto b = s.lineIndex(refs[1]);
            s.add(FORGE_GCS_EQUAL_LENGTH, {a, b}, tag);
        } else {
            // "Equal not supported for arcs (use circles)" was a REFUSAL with a
            // primitive sitting right there: planegcs has EqualRadius for
            // (Circle,Circle), (Circle,Arc) and (Arc,Arc). An arc's radius is a
            // radius. Equal fillets on a bracket are among the commonest sketch
            // constraints there are, and this said no to all of them.
            const auto a = s.conicIndex(refs[0]);
            const auto b = s.conicIndex(refs[1]);
            s.add(FORGE_GCS_EQUAL_RADIUS, {a, b}, tag);
        }
        break;
    }
    case SketchConstraintKind::Tangent: {
        need(2);
        // line-circle was "the most common sketcher use", and it was the ONLY
        // one wired — so a fillet arc tangent to the wall it fillets, which is
        // what tangency is FOR, threw. planegcs has (Line,Circle), (Line,Arc),
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
            const auto l = s.lineIndex(lineRef);
            if (s.kindOfEntity(conicRef) == SketchEntityKind::Arc) {
                s.add(FORGE_GCS_TANGENT_LINE_ARC, {l, s.arcIndex(conicRef)}, tag, 0.0,
                      FORGE_GCS_FLAG_CCW);
            } else {
                s.add(FORGE_GCS_TANGENT_LINE_CIRCLE, {l, s.circleIndex(conicRef)}, tag, 0.0,
                      FORGE_GCS_FLAG_CCW);
            }
        } else if (k0 == SketchEntityKind::Arc && k1 == SketchEntityKind::Arc) {
            const auto a = s.arcIndex(refs[0]);
            const auto b = s.arcIndex(refs[1]);
            s.add(FORGE_GCS_TANGENT_ARC_ARC, {a, b}, tag);
        } else if (k0 == SketchEntityKind::Circle && k1 == SketchEntityKind::Circle) {
            const auto a = s.circleIndex(refs[0]);
            const auto b = s.circleIndex(refs[1]);
            s.add(FORGE_GCS_TANGENT_CIRCLE_CIRCLE, {a, b}, tag);
        } else {
            const std::uint32_t circRef = (k0 == SketchEntityKind::Circle) ? refs[0] : refs[1];
            const std::uint32_t arcRef  = (k0 == SketchEntityKind::Circle) ? refs[1] : refs[0];
            const auto c = s.circleIndex(circRef);
            const auto a = s.arcIndex(arcRef);
            s.add(FORGE_GCS_TANGENT_CIRCLE_ARC, {c, a}, tag);
        }
        break;
    }

    // =========================================================================
    // THE TEN THE CENSUS DESIGNED AND THE FACADE NEVER WIRED. Every arm is a
    // call into the solver library; nothing below computes geometry.
    // =========================================================================
    case SketchConstraintKind::Radius: {
        need(1);
        s.add(FORGE_GCS_CIRCLE_RADIUS, {s.conicIndex(refs[0])}, tag, value);
        break;
    }
    case SketchConstraintKind::Diameter: {
        need(1);
        s.add(FORGE_GCS_CIRCLE_DIAMETER, {s.conicIndex(refs[0])}, tag, value);
        break;
    }
    case SketchConstraintKind::Angle: {
        need(2);
        // RADIANS. The IR converts from degrees at its own boundary; see the
        // enumerator comment in Sketcher.hpp, which names the same seam.
        if (isEntity(refs[0]) && isEntity(refs[1])) {
            const auto a = s.lineIndex(refs[0]);
            const auto b = s.lineIndex(refs[1]);
            s.add(FORGE_GCS_L2L_ANGLE, {a, b}, tag, value);
        } else if (!isEntity(refs[0]) && !isEntity(refs[1])) {
            // The angle of the DIRECTION p0->p1 from +x: how a drawing dimensions
            // a single sloped edge, which has no second line to measure against.
            //
            // ★ planegcs's four-argument addConstraintP2PAngle(p1, p2, angle,
            // tagId) THROWS THE TAG AWAY — it hard-codes 0, planegcs's "no tag"
            // sentinel — and a constraint on tag 0 is invisible to the conflict
            // report, to removal by tag and to the per-tag residual. The
            // library's P2P_ANGLE primitive calls the five-argument overload
            // that honours the tag (see src/forge_gcs.cpp), which is the call
            // this facade has always made. MEASURED both ways when it was first
            // found: through the four-argument call the residual for the
            // returned tag is NaN; through the five-argument one it is finite.
            const auto a = s.pointIndex(refs[0]);
            const auto b = s.pointIndex(refs[1]);
            s.add(FORGE_GCS_P2P_ANGLE, {a, b}, tag, value);
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
        // way.
        const auto ca = s.curveAt(s.conicIndex(refs[0])).center;
        const auto cb = s.curveAt(s.conicIndex(refs[1])).center;
        s.add(FORGE_GCS_P2P_COINCIDENT, {ca, cb}, tag);
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
        const auto a = s.lineIndex(refs[0]);
        const auto b = s.lineIndex(refs[1]);
        const auto bStart = s.curveAt(b).p1;
        s.add(FORGE_GCS_PARALLEL, {a, b}, tag);
        s.add(FORGE_GCS_POINT_ON_LINE, {bStart, a}, tag);
        break;
    }
    case SketchConstraintKind::Symmetric: {
        need(3);
        const auto a = s.pointIndex(refs[0]);
        const auto b = s.pointIndex(refs[1]);
        if (isEntity(refs[2])) {
            s.add(FORGE_GCS_P2P_SYMMETRIC_LINE, {a, b, s.lineIndex(refs[2])}, tag);
        } else {
            s.add(FORGE_GCS_P2P_SYMMETRIC_POINT, {a, b, s.pointIndex(refs[2])}, tag);
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
        const auto a = s.pointIndex(refs[0]);
        const auto b = s.pointIndex(refs[1]);
        const auto m = s.pointIndex(refs[2]);
        s.add(FORGE_GCS_P2P_SYMMETRIC_POINT, {a, b, m}, tag);
        break;
    }
    case SketchConstraintKind::Fix: {
        need(1);
        // Pin the point WHERE IT IS. The value argument is ignored — a FIX that
        // took coordinates would be a move disguised as a constraint, and CON is
        // pass-through precisely so that no constraint statement moves geometry
        // before the solve.
        const auto p = s.pointIndex(refs[0]);
        const StitchEnd at = s.pointAt(p);
        s.add(FORGE_GCS_COORDINATE_X, {p}, tag, at.x);
        s.add(FORGE_GCS_COORDINATE_Y, {p}, tag, at.y);
        break;
    }
    case SketchConstraintKind::DistanceX: {
        need(2);
        // SIGNED: planegcs's ConstraintDifference::value() is *param2 - *param1,
        // so this enforces bx - ax == value. A DISTX dimension on a drawing is
        // signed, and an unsigned one would make "B is 25 to the LEFT of A"
        // unstateable.
        const auto a = s.pointIndex(refs[0]);
        const auto b = s.pointIndex(refs[1]);
        s.add(FORGE_GCS_DIFFERENCE_X, {a, b}, tag, value);
        break;
    }
    case SketchConstraintKind::DistanceY: {
        need(2);
        const auto a = s.pointIndex(refs[0]);
        const auto b = s.pointIndex(refs[1]);
        s.add(FORGE_GCS_DIFFERENCE_Y, {a, b}, tag, value);
        break;
    }
    // NO `default:` ARM, DELIBERATELY. With one, -Wswitch goes quiet, and the
    // next kind added to SketchConstraintKind would compile into a silent
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

    // Declares every point coordinate, circle radius and arc radius/angle as an
    // unknown (points, then circles, then arcs), prepares the solution — which
    // runs the rank diagnosis when none is held — and solves with DogLeg.
    std::int32_t rc = FORGE_GCS_SOLVE_FAILED;
    s.check(forge_gcs_solve(s.sys(), FORGE_GCS_DOGLEG, &rc), "solving");
    if (rc == FORGE_GCS_SOLVE_SUCCESS || rc == FORGE_GCS_SOLVE_CONVERGED ||
        rc == FORGE_GCS_SOLVE_SUCCESS_INVALID) {
        s.check(forge_gcs_apply_solution(s.sys()), "applying the solution");
    }

    // The diagnosis the solve itself made — read, not recomputed.
    forge_gcs_diagnosis diag{};
    s.check(forge_gcs_get_diagnosis(s.sys(), &diag), "reading the diagnosis");
    int dof = diag.dof;
    bool hasConflicting = diag.has_conflicting != 0;
    bool hasRedundant   = diag.has_redundant != 0;

    SketchSolveResult out{};
    out.dof = dof;
    out.iterations = 0;  // planegcs doesn't expose this through the public API
    if (rc == FORGE_GCS_SOLVE_SUCCESS || rc == FORGE_GCS_SOLVE_CONVERGED) {
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
    const StitchEnd p = s.pointAt(s.pointIndex(pid));
    return SketchPoint{p.x, p.y};
}

void writePoint(SketchHandle h, SketchParamId pid, double x, double y) {
    Sketch& s = SketchRegistry::instance().get(h);
    s.check(forge_gcs_set_point(s.sys(), s.pointIndex(pid), x, y), "writing a point");
}

// The live geometry of one entity. Every number below is READ from the storage
// the solver mutates in place; the only arithmetic is the length of the curve
// those numbers define, which is the same formula extractProfileRings uses to
// sample it.
SketchEntityGeometry readEntity(SketchHandle h, SketchEntityId eid) {
    constexpr double kPi = 3.14159265358979323846;
    Sketch& s = SketchRegistry::instance().get(h);
    SketchEntityGeometry g{};
    switch (s.kindOfEntity(eid)) {
        case SketchEntityKind::Line: {
            const forge_gcs_curve l = s.curveAt(s.lineIndex(eid));
            const StitchEnd p1 = s.pointAt(l.p1), p2 = s.pointAt(l.p2);
            g.shape = SketchEntityShape::Line;
            g.x0 = p1.x; g.y0 = p1.y;
            g.x1 = p2.x; g.y1 = p2.y;
            const double dx = g.x1 - g.x0, dy = g.y1 - g.y0;
            g.length = std::sqrt(dx * dx + dy * dy);
            return g;
        }
        case SketchEntityKind::Circle: {
            const forge_gcs_curve c = s.curveAt(s.circleIndex(eid));
            const StitchEnd ctr = s.pointAt(c.center);
            g.shape = SketchEntityShape::Circle;
            g.cx = ctr.x; g.cy = ctr.y;
            g.radius = c.radius;
            g.length = 2.0 * kPi * g.radius;
            return g;
        }
        case SketchEntityKind::Arc: {
            const forge_gcs_curve a = s.curveAt(s.arcIndex(eid));
            const StitchEnd ctr = s.pointAt(a.center);
            const StitchEnd st = s.pointAt(a.p1), en = s.pointAt(a.p2);
            g.shape = SketchEntityShape::Arc;
            g.cx = ctr.x; g.cy = ctr.y;
            g.radius = a.radius;
            g.x0 = st.x; g.y0 = st.y;
            g.x1 = en.x; g.y1 = en.y;
            // The SAME minor-arc normalisation extractWires and
            // extractProfileRings apply, for the same reason: a corner arc that
            // straddles the +/-pi branch cut would otherwise report the MAJOR
            // arc's length while the profile bridge builds the minor one, and a
            // length that disagrees with the geometry is worse than none.
            double sweep = a.end_angle - a.start_angle;
            while (sweep <= -kPi) sweep += 2.0 * kPi;
            while (sweep >   kPi) sweep -= 2.0 * kPi;
            g.startAngle = a.start_angle;
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
    for (const std::int32_t ci : s.entitiesOfKind(SketchEntityKind::Circle)) {
        const forge_gcs_curve c = s.curveAt(ci);
        const StitchEnd cc = s.pointAt(c.center);
        gp_Pnt center(cc.x, cc.y, 0.0);
        gp_Dir axis(0, 0, 1);
        gp_Circ circ(gp_Ax2(center, axis), c.radius);
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

    for (const std::int32_t li : s.entitiesOfKind(SketchEntityKind::Line)) {
        const forge_gcs_curve l = s.curveAt(li);
        const StitchEnd l1 = s.pointAt(l.p1), l2 = s.pointAt(l.p2);
        gp_Pnt p1(l1.x, l1.y, 0.0);
        gp_Pnt p2(l2.x, l2.y, 0.0);
        if (p1.Distance(p2) < Precision::Confusion()) continue;  // degenerate
        TopoDS_Edge e = BRepBuilderAPI_MakeEdge(p1, p2).Edge();
        segs.push_back({e, p1, p2});
    }

    for (const std::int32_t ai : s.entitiesOfKind(SketchEntityKind::Arc)) {
        const forge_gcs_curve ar = s.curveAt(ai);
        const StitchEnd ac = s.pointAt(ar.center), as = s.pointAt(ar.p1), ae = s.pointAt(ar.p2);
        gp_Pnt center(ac.x, ac.y, 0.0);
        gp_Pnt sp(as.x, as.y, 0.0);
        gp_Pnt ep(ae.x, ae.y, 0.0);
        // Midpoint on the arc via startAngle/endAngle so OCCT picks the
        // correct arc direction. Fall back to a straight-edge if degenerate.
        const double r = ar.radius;
        const double sa = ar.start_angle;
        double ea = ar.end_angle;
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
// IN-HOUSE KERNEL STEP 3b — OCCT-FREE. Walk the SAME line / circle / arc data
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
    for (const std::int32_t ci : s.entitiesOfKind(SketchEntityKind::Circle)) {
        const forge_gcs_curve c = s.curveAt(ci);
        const StitchEnd cc = s.pointAt(c.center);
        const double cx = cc.x, cy = cc.y, r = c.radius;
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

    for (const std::int32_t li : s.entitiesOfKind(SketchEntityKind::Line)) {
        const forge_gcs_curve l = s.curveAt(li);
        const StitchEnd l1 = s.pointAt(l.p1), l2 = s.pointAt(l.p2);
        Point2 a{l1.x, l1.y}, b{l2.x, l2.y};
        const double dx = b.x - a.x, dy = b.y - a.y;
        if (std::sqrt(dx*dx + dy*dy) < Precision::Confusion()) continue;
        segs2.push_back(Seg{{a, b}});
    }

    for (const std::int32_t ai : s.entitiesOfKind(SketchEntityKind::Arc)) {
        const forge_gcs_curve ar = s.curveAt(ai);
        const StitchEnd ac = s.pointAt(ar.center), as = s.pointAt(ar.p1), ae = s.pointAt(ar.p2);
        const double cx = ac.x, cy = ac.y, r = ar.radius;
        double sa = ar.start_angle, ea = ar.end_angle;
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
        pts.push_back(Point2{as.x, as.y});
        for (int i = 1; i < n; ++i) {
            const double a = sa + sweep * (static_cast<double>(i) / n);
            pts.push_back(Point2{cx + r * std::cos(a), cy + r * std::sin(a)});
        }
        pts.push_back(Point2{ae.x, ae.y});
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

// ----------------------------------------------------------- splitClosedLoops
//
// See Sketcher.hpp. Built out of the SAME pieces the two extractors use: circles
// are loops of their own, lines and arcs are chained by the shared stitcher at
// the same 10 µm tolerance, and a chain is a loop when it ends where it began.
std::vector<SketchLoop> splitClosedLoops(SketchHandle h, int circleSegments) {
    Sketch& s = SketchRegistry::instance().get(h);
    std::vector<SketchLoop> loops;

    // Registered in `loops` BEFORE anything else can throw, so the cleanup below
    // destroys it on every path.
    auto finish = [&](SketchHandle loopSketch) {
        loops.push_back(SketchLoop{});
        SketchLoop& loop = loops.back();
        loop.sketch = loopSketch;
        auto rings = extractProfileRings(loopSketch, circleSegments);
        if (!rings.empty()) loop.ring = std::move(rings.front());
        double a2 = 0.0;
        const std::size_t n = loop.ring.size();
        for (std::size_t i = 0; i < n; ++i) {
            const auto& p = loop.ring[i];
            const auto& q = loop.ring[(i + 1) % n];
            a2 += p.x * q.y - q.x * p.y;
        }
        loop.area = 0.5 * a2;
    };

    try {
        for (const std::int32_t ci : s.entitiesOfKind(SketchEntityKind::Circle)) {
            const forge_gcs_curve c = s.curveAt(ci);
            const StitchEnd ctr = s.pointAt(c.center);
            const SketchHandle one = createSketch();
            addCircle(one, addPoint(one, ctr.x, ctr.y), c.radius);
            finish(one);
        }

        // Open segments, in the order extractProfileRings reads them: lines, then arcs.
        struct Seg { SketchEntityKind kind; std::int32_t curve; StitchEnd a, b; };
        std::vector<Seg> segs;
        for (const std::int32_t li : s.entitiesOfKind(SketchEntityKind::Line)) {
            const forge_gcs_curve l = s.curveAt(li);
            segs.push_back({SketchEntityKind::Line, li, s.pointAt(l.p1), s.pointAt(l.p2)});
        }
        for (const std::int32_t ai : s.entitiesOfKind(SketchEntityKind::Arc)) {
            const forge_gcs_curve a = s.curveAt(ai);
            segs.push_back({SketchEntityKind::Arc, ai, s.pointAt(a.p1), s.pointAt(a.p2)});
        }
        std::vector<std::pair<StitchEnd, StitchEnd>> ends;
        for (const Seg& sg : segs) ends.push_back({sg.a, sg.b});
        for (const auto& chain : stitchSegments(ends)) {
            if (chain.size() < 2) continue;
            const Seg& first = segs[chain.front().seg];
            const Seg& last = segs[chain.back().seg];
            const StitchEnd head = chain.front().reversed ? first.b : first.a;
            const StitchEnd tail = chain.back().reversed ? last.a : last.b;
            const double gx = head.x - tail.x, gy = head.y - tail.y;
            if (std::sqrt(gx * gx + gy * gy) >= kSketchStitchTol) continue;  // open: not a loop
            const SketchHandle one = createSketch();
            for (const ChainLink& link : chain) {
                const Seg& sg = segs[link.seg];
                if (sg.kind == SketchEntityKind::Line) {
                    addLine(one, addPoint(one, sg.a.x, sg.a.y), addPoint(one, sg.b.x, sg.b.y));
                } else {
                    const forge_gcs_curve a = s.curveAt(sg.curve);
                    const StitchEnd ctr = s.pointAt(a.center);
                    addArc(one, addPoint(one, ctr.x, ctr.y), addPoint(one, sg.a.x, sg.a.y),
                           addPoint(one, sg.b.x, sg.b.y));
                }
            }
            finish(one);
        }
    } catch (...) {
        for (const SketchLoop& l : loops) destroySketch(l.sketch);
        throw;
    }
    return loops;
}

// =================================================================== diagnostics
//
// Phase A of sketcher-constraints.md — surface the planegcs diagnose pipeline.
// All numerics live in the solver library; these functions only re-package its
// report and map each dependent parameter back to the point / entity IDs the
// caller holds. The library names a parameter by (role, point-or-curve index),
// which is the same identity the old pointer comparison established.

namespace {

// Library parameter -> the facade's (role, owner id). Returns false for a
// parameter the library could not attribute, which leaves the caller's
// Unknown / 0 defaults in place exactly as an unmatched pointer did.
bool mapParamToGeometry(const forge_gcs_param& p, SketchParamRole& role, std::uint32_t& ownerId) {
    if (p.owner < 0) return false;
    const auto owner = static_cast<std::uint32_t>(p.owner);
    switch (p.role) {
        case FORGE_GCS_PARAM_POINT_X:         role = SketchParamRole::PointX;        ownerId = toParamId(owner);  return true;
        case FORGE_GCS_PARAM_POINT_Y:         role = SketchParamRole::PointY;        ownerId = toParamId(owner);  return true;
        case FORGE_GCS_PARAM_CIRCLE_RADIUS:   role = SketchParamRole::CircleRadius;  ownerId = toEntityId(owner); return true;
        case FORGE_GCS_PARAM_ARC_RADIUS:      role = SketchParamRole::ArcRadius;     ownerId = toEntityId(owner); return true;
        case FORGE_GCS_PARAM_ARC_START_ANGLE: role = SketchParamRole::ArcStartAngle; ownerId = toEntityId(owner); return true;
        case FORGE_GCS_PARAM_ARC_END_ANGLE:   role = SketchParamRole::ArcEndAngle;   ownerId = toEntityId(owner); return true;
        default: return false;
    }
}

bool sameParam(const forge_gcs_param& a, const forge_gcs_param& b) {
    return a.role == b.role && a.owner == b.owner;
}

// The library's size-then-fill list protocol, once.
std::vector<int> readTagList(Sketch& s, std::int32_t which) {
    const std::int32_t n = s.check(forge_gcs_get_tags(s.sys(), which, nullptr, 0), "reading a tag list");
    std::vector<std::int32_t> buf(static_cast<std::size_t>(n));
    if (n > 0) s.check(forge_gcs_get_tags(s.sys(), which, buf.data(), n), "reading a tag list");
    return std::vector<int>(buf.begin(), buf.end());
}

}  // namespace

SketchDiagnostics diagnoseSketch(SketchHandle h) {
    Sketch& s = SketchRegistry::instance().get(h);

    // A fresh diagnosis even if solve() was never called: the library declares
    // the unknowns, prepares the solution (which diagnoses) and diagnoses again,
    // exactly the sequence this facade always ran. diagnose is a Jacobian-rank
    // analysis: it does NOT move geometry.
    forge_gcs_diagnosis diag{};
    s.check(forge_gcs_diagnose(s.sys(), FORGE_GCS_DOGLEG, &diag), "diagnosing");

    SketchDiagnostics d{};
    d.dof                  = diag.dof;
    d.emptyDiagnoseMatrix  = diag.empty_matrix != 0;
    d.hasConflicting       = diag.has_conflicting != 0;
    d.hasRedundant         = diag.has_redundant != 0;
    d.hasPartiallyRedundant= diag.has_partially_redundant != 0;

    d.conflicting        = readTagList(s, FORGE_GCS_TAGS_CONFLICTING);
    d.redundant          = readTagList(s, FORGE_GCS_TAGS_REDUNDANT);
    d.partiallyRedundant = readTagList(s, FORGE_GCS_TAGS_PARTIALLY_REDUNDANT);
    d.proposedRemovals   = readTagList(s, FORGE_GCS_TAGS_PROPOSED_REMOVAL);
    {
        const std::int32_t groups = s.check(forge_gcs_conflict_group_count(s.sys()), "reading conflict groups");
        for (std::int32_t g = 0; g < groups; ++g) {
            const std::int32_t n = s.check(forge_gcs_get_conflict_group(s.sys(), g, nullptr, 0), "reading a conflict group");
            std::vector<std::int32_t> buf(static_cast<std::size_t>(n));
            if (n > 0) s.check(forge_gcs_get_conflict_group(s.sys(), g, buf.data(), n), "reading a conflict group");
            d.conflictingGroups.emplace_back(buf.begin(), buf.end());
        }
    }

    // Dependent params (still-free geometry) and the engine's coupling groups.
    std::vector<forge_gcs_param> dependent;
    {
        const std::int32_t n = s.check(forge_gcs_get_dependent_params(s.sys(), nullptr, 0), "reading free parameters");
        dependent.resize(static_cast<std::size_t>(n));
        if (n > 0) s.check(forge_gcs_get_dependent_params(s.sys(), dependent.data(), n), "reading free parameters");
    }
    std::vector<std::vector<forge_gcs_param>> groups;
    {
        const std::int32_t count = s.check(forge_gcs_dependent_group_count(s.sys()), "reading free groups");
        for (std::int32_t g = 0; g < count; ++g) {
            const std::int32_t n = s.check(forge_gcs_get_dependent_group(s.sys(), g, nullptr, 0), "reading a free group");
            std::vector<forge_gcs_param> members(static_cast<std::size_t>(n));
            if (n > 0) s.check(forge_gcs_get_dependent_group(s.sys(), g, members.data(), n), "reading a free group");
            groups.push_back(std::move(members));
        }
    }
    d.dependentParamGroupCount = static_cast<int>(groups.size());

    auto groupOf = [&](const forge_gcs_param& p) -> int {
        for (std::size_t g = 0; g < groups.size(); ++g) {
            for (const forge_gcs_param& q : groups[g]) {
                if (sameParam(q, p)) return static_cast<int>(g);
            }
        }
        return -1;
    };
    auto describe = [&](const forge_gcs_param& p, int group) {
        SketchDependentParam dp{};
        dp.role = SketchParamRole::Unknown;
        dp.ownerId = 0;
        SketchParamRole role;
        std::uint32_t owner;
        if (mapParamToGeometry(p, role, owner)) { dp.role = role; dp.ownerId = owner; }
        dp.group = group;
        return dp;
    };
    for (const forge_gcs_param& p : dependent) {
        d.dependentParams.push_back(describe(p, groupOf(p)));
    }

    // The two loss-free views. EVERY free parameter, ONCE — two entries naming
    // the same parameter are the same freedom counted twice, and that is the
    // whole defect these fields exist to avoid.
    {
        std::vector<forge_gcs_param> seen;
        for (const forge_gcs_param& p : dependent) {
            bool dup = false;
            for (const forge_gcs_param& q : seen) dup = dup || sameParam(p, q);
            if (dup) continue;
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
        std::vector<forge_gcs_param> seen;
        for (const forge_gcs_param& p : groups[g]) {
            bool dup = false;
            for (const forge_gcs_param& q : seen) dup = dup || sameParam(p, q);
            if (dup) continue;
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
    return forge_gcs_error_by_tag(s.sys(), tag);
}

std::vector<SketchConstraintResidual> allConstraintResiduals(SketchHandle h) {
    Sketch& s = SketchRegistry::instance().get(h);
    std::vector<SketchConstraintResidual> out;
    out.reserve(static_cast<std::size_t>(s.nextConstraintTag));
    // Tags are monotonic positive ints 1..nextConstraintTag (Sketcher.cpp::nextTag).
    for (int t = 1; t <= s.nextConstraintTag; ++t) {
        out.push_back(SketchConstraintResidual{t, forge_gcs_error_by_tag(s.sys(), t)});
    }
    return out;
}

SketchAuditResult auditSketch(SketchHandle h) {
    Sketch& s = SketchRegistry::instance().get(h);

    // Legacy static counting estimate (pre-solve UX hint only — NOT the truth).
    // entity DOF: point 2, line 4, circle 3, arc 5. We can recover the entity
    // breakdown from the Sketch's own storage.
    auto staticEstimate = [&]() -> int {
        int totalDof = 2 * static_cast<int>(s.pointCount)
                     + 1 * static_cast<int>(s.entitiesOfKind(SketchEntityKind::Circle).size())   // radius (centre is a point already counted)
                     + 3 * static_cast<int>(s.entitiesOfKind(SketchEntityKind::Arc).size());      // radius + 2 angles
        // We cannot recover per-constraint static cost without the original kind
        // list, so we approximate "removed DOF" by (totalParams - solverDof);
        // the solver value below is the real one anyway.
        return totalDof;  // raw parameter count; solverDof is the source of truth
    };

    SketchDiagnostics diag = diagnoseSketch(h);

    SketchAuditResult r{};
    r.totalEntities = static_cast<int>(s.entityKinds.size());
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
    // The library removes every primitive carrying the tag AND invalidates the
    // cached rank analysis, which describes a system that no longer exists. Not
    // invalidating it is how a repair loop "converges" against a stale verdict.
    s.check(forge_gcs_clear_tag(s.sys(), tag), "removing a constraint");
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
            const double e = forge_gcs_error_by_tag(s.sys(), t);
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

        const double res = forge_gcs_error_by_tag(s.sys(), victim);
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
