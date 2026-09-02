#pragma once

// Sketcher — Forge-native facade over the vendored planegcs constraint solver.
//
// The goal is a tiny, stable, handle-based API that the N-API binding can
// forward to JS verbatim. Inside, each `forge::Sketch` owns:
//   - a planegcs `GCS::System` that holds the constraint network
//   - a pool of heap-allocated `double` parameters (point coords, radii, etc.)
//     — planegcs takes raw `double*` and edits them in place during solve()
//   - vectors of `Point`, `Line`, `Circle`, `Arc` instances whose internal
//     pointers tie back into the parameter pool
//   - a parallel vector of "distance value" parameters for value-bearing
//     constraints (Distance, Equal w/ value, etc.)
//
// IDs returned by add* are dense uint32 indices, NOT raw pointers — the JS
// side never sees a C++ pointer. The same is true for the SketchHandle.
//
// Lifetimes: a Sketch lives until destroySketch() is called or the process
// exits. Destruction frees the planegcs heap allocations and clears the
// parameter pool.

#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include <TopoDS_Wire.hxx>

// IN-HOUSE KERNEL STEP 3b — the OCCT-FREE profile bridge feeds the native
// feature ops (forge::native::brep::sweep/prism/loftSections,
// forge::native::csg::revolve), which consume an ordered 2D point ring, NOT an
// OCCT TopoDS_Wire. geom/Geom.hpp is pure C++20 (no OCCT) so it is safe to pull
// into this header (it is ALWAYS compiled — only the native ROUTING that uses
// the rings is gated behind FORGE_NATIVE_BREP).
#include "forge/native/geom/Geom.hpp"   // forge::native::geom::Point2

// Forward-declare planegcs types to avoid bleeding their headers into binding.cpp.
namespace GCS {
class System;
class Point;
class Line;
class Circle;
class Arc;
}  // namespace GCS

namespace forge {

using SketchHandle    = std::uint32_t;
using SketchParamId   = std::uint32_t;  // identifies a point's (x, y) parameter pair
using SketchEntityId  = std::uint32_t;  // identifies a geometry entity (line / circle / arc)
using SketchValueId   = std::uint32_t;  // identifies a value-bearing parameter (distance, etc.)

constexpr SketchHandle  kInvalidSketch = 0;

// Constraint kinds exposed to JS. The trailing comment is the planegcs
// primitive we route the call through.
enum class SketchConstraintKind : std::uint32_t {
    Coincident     = 1,   // addConstraintP2PCoincident
    Parallel       = 2,   // addConstraintParallel
    Perpendicular  = 3,   // addConstraintPerpendicular
    Distance       = 4,   // addConstraintP2PDistance  (value required)
    Horizontal     = 5,   // addConstraintHorizontal(line)  -- or 2-point overload
    Vertical       = 6,   // addConstraintVertical(line)
    PointOnLine    = 7,   // addConstraintPointOnLine
    PointOnCircle  = 8,   // addConstraintPointOnCircle
    Equal          = 9,   // addConstraintEqualLength (lines) / EqualRadius (circles/arcs)
    Tangent        = 10,  // addConstraintTangent (line↔circle/arc, circle/arc↔circle/arc)

    // ─────────────────────────────────────────────────────────────────────────
    // THE TEN THE CENSUS DESIGNED AND THE FACADE NEVER WIRED.
    //
    // forge-kernel/reports/family_census/SKETCH_AND_CONSTRAINTS.md §4 specifies
    // the CON keyword set as
    //     geometric   COINC PARA PERP TANG EQUAL CONC COLL SYMM MIDPT
    //                 HORIZ VERT PTON FIX
    //     dimensional DIST DISTX DISTY ANGLE RADIUS DIAM
    // and closes with "Every one of those routes to a primitive that ALREADY
    // EXISTS in GCS.h. This is facade exposure, not numerics." Nine shipped.
    // These are the other ten, and that sentence is still true of every one:
    // each arm below is a call into the vendored engine, and no numerics are
    // added anywhere in this file.
    //
    // WHY IT IS NOT COSMETIC. interface is 40% of the benchmark composite and a
    // GT sketch is DIMENSIONED: a bolt circle is a RADIUS, a counterbore is a
    // DIAM, a bracket arm is an ANGLE. Without them a tree can only state a
    // sketch's TOPOLOGY and must bake every coordinate — which is the baked
    // form the whole family exists to replace, so a solver reachable only
    // through COINC/PARA/PERP is a solver that cannot express the drawing.
    //
    // The provenance trap this closes, recorded because it cost a wrong
    // conclusion once already: the census measured a built .node whose
    // `sketcher.kinds` reported 14 kinds, four of them (PointOnObject, Radius,
    // Diameter, Angle) present ONLY as uncommitted work in a shared checkout
    // and on no origin branch. The census flagged it itself. These are those
    // four and six more, written from the GCS.h signatures, IN THE REPOSITORY.
    Radius         = 11,  // addConstraintCircleRadius / ArcRadius     (value)
    Diameter       = 12,  // addConstraintCircleDiameter / ArcDiameter (value)
    Angle          = 13,  // addConstraintL2LAngle (lines) / P2PAngle (points)
                          //   ★ RADIANS here. The IR spells CON(..., ANGLE, 30)
                          //   in DEGREES and converts at the boundary, matching
                          //   ROTATE and every other angle in the IR. This
                          //   header is the planegcs-facing side of that seam,
                          //   so it takes what planegcs takes, and the seam is
                          //   named in both places rather than in neither.
    Concentric     = 14,  // addConstraintP2PCoincident on the two CENTRES
    Collinear      = 15,  // addConstraintParallel + PointOnLine, one tag
    Symmetric      = 16,  // addConstraintP2PSymmetric — refs {a, b, mirror}
                          //   where `mirror` is a LINE (mirror about the line)
                          //   or a POINT (mirror through the point).
    Midpoint       = 17,  // refs {a, b, mid}: `mid` bisects the segment a..b.
                          //   The SAME planegcs primitive as the point form of
                          //   Symmetric — P2PSymmetric(p1,p2,p) expands to
                          //   PointOnPerpBisector + PointOnLine, which IS "p is
                          //   the midpoint" (GCS.cpp:1265). It is a separate
                          //   kind rather than an alias so that MIDPT handed a
                          //   LINE is DIAGNOSED as the wrong operand instead of
                          //   silently becoming a mirror — the two mistakes are
                          //   confusable and must not share an outcome.
    Fix            = 18,  // addConstraintCoordinateX + CoordinateY at the
                          //   point's CURRENT position. Two solver constraints
                          //   under one tag, so one demotion frees both — a
                          //   half-fixed point is not a state a repair loop
                          //   should be able to reach.
    DistanceX      = 19,  // addConstraintDifference on the two x params.
                          //   SIGNED: enforces bx - ax == value (Constraints.cpp
                          //   ConstraintDifference::value() is *p2 - *p1), which
                          //   is what a DISTX dimension means on a drawing.
    DistanceY      = 20,  // the same on y.
};

enum class SketchSolveStatus : std::uint32_t {
    Success       = 0,
    Failed        = 1,
    Inconsistent  = 2,
};

struct SketchSolveResult {
    SketchSolveStatus status;
    int               dof;          // -1 if not diagnosable
    int               iterations;   // best-effort estimate; planegcs doesn't expose this directly
};

struct Sketch;  // opaque, defined in Sketcher.cpp

class SketchRegistry {
public:
    static SketchRegistry& instance();

    SketchHandle createSketch();
    bool         exists(SketchHandle h) const;
    Sketch&      get(SketchHandle h);
    void         destroySketch(SketchHandle h);
    std::size_t  liveCount() const;

private:
    SketchRegistry() = default;
    mutable std::mutex mtx_;
    std::unordered_map<SketchHandle, std::unique_ptr<Sketch>> sketches_;
    SketchHandle next_ = 1;
};

// --------------------------------------------------------------------- Sketch API
// Each function dispatches to SketchRegistry::get(handle) and operates on
// the sketch's internal state. They throw std::runtime_error on bad input.

SketchHandle createSketch();
void         destroySketch(SketchHandle h);

// Point — returns a SketchParamId. The point's coordinates can be read back
// with readPoint() and modified by solving constraints.
SketchParamId addPoint(SketchHandle h, double x, double y);

// Line between two existing points. Returns a SketchEntityId.
SketchEntityId addLine(SketchHandle h, SketchParamId p0, SketchParamId p1);

// Circle: center point + scalar radius. The scalar lives in the sketch's
// value pool but is referenced by entity id only.
SketchEntityId addCircle(SketchHandle h, SketchParamId center, double radius);

// Arc: center + start + end + initial radius derived from |start - center|.
// planegcs's arc has 5 free params (cx, cy, rad, startAngle, endAngle); we
// derive the angles from start / end on initial insertion.
SketchEntityId addArc(SketchHandle h, SketchParamId center, SketchParamId p0, SketchParamId p1);

// Add a constraint. `refs` is a span of entity / point IDs whose meaning
// depends on `kind`:
//   Coincident:    refs = {ptA, ptB}
//   Parallel:      refs = {lineA, lineB}
//   Perpendicular: refs = {lineA, lineB}
//   Distance:      refs = {ptA, ptB}             value = target distance
//   Horizontal:    refs = {lineA}                (or {ptA, ptB})
//   Vertical:      refs = {lineA}                (or {ptA, ptB})
//   PointOnLine:   refs = {pt, line}
//   PointOnCircle: refs = {pt, circle}
//   Equal:         refs = {lineA, lineB}         (or two of circle/arc)
//   Tangent:       refs = {line, circle|arc}    (or two of circle/arc)
//   Radius:        refs = {circle|arc}          value = radius
//   Diameter:      refs = {circle|arc}          value = diameter
//   Angle:         refs = {lineA, lineB}        value = RADIANS
//                  refs = {ptA, ptB}            value = RADIANS
//   Concentric:    refs = {circle|arc, circle|arc}
//   Collinear:     refs = {lineA, lineB}
//   Symmetric:     refs = {ptA, ptB, line}      mirror about the line
//                  refs = {ptA, ptB, ptMirror}  mirror through the point
//   Midpoint:      refs = {ptA, ptB, ptMid}     ptMid bisects ptA..ptB
//   Fix:           refs = {pt}                  pins it where it currently is
//   DistanceX:     refs = {ptA, ptB}            value = signed bx - ax
//   DistanceY:     refs = {ptA, ptB}            value = signed by - ay
// `value` is consulted only when the constraint has a scalar — pass 0.0 to
// skip. IDs are tagged in the low bit (lsb=1 means SketchEntityId, lsb=0
// means SketchParamId) so we can disambiguate without a separate type tag.
std::uint32_t addConstraint(
    SketchHandle h,
    SketchConstraintKind kind,
    const std::vector<std::uint32_t>& refs,
    double value
);

// Solve the constraint network. Returns final status + DOF.
SketchSolveResult solve(SketchHandle h);

// Read back a point's current (x, y).
struct SketchPoint { double x; double y; };
SketchPoint readPoint(SketchHandle h, SketchParamId pid);

// Mutate a point's coordinates (without resolving). Used to set up "move
// one point, then solve" workflows from JS.
void writePoint(SketchHandle h, SketchParamId pid, double x, double y);

// Build OCCT wires (TopoDS_Wire) from the sketch's lines / circles / arcs.
// The sketch is assumed to live on the XY plane (Z = 0) — every native
// part-feature consumer (extrude, revolve, sweep, …) re-orients via its
// own gp_Ax1 / direction inputs. Closed curves (circles) become their own
// closed wire; line + arc segments are stitched into wires by matching
// shared endpoints within Precision::Confusion.
std::vector<TopoDS_Wire> extractWires(SketchHandle h);

// IN-HOUSE KERNEL STEP 3b — OCCT-FREE profile bridge.
//
// Extract the sketch's closed loops as ordered 2D point RINGS on the local
// (Z=0) sketch plane — the input form the in-house native feature ops want
// (forge::native::brep::Profile / LoftSection, forge::native::csg::revolve).
//
// This walks the SAME raw GCS::Line / GCS::Circle / GCS::Arc data that
// extractWires reads, but emits ordered `geom::Point2` rings instead of OCCT
// wires, so the feature-profile path is genuinely OCCT-free. Each ring is
// returned WITHOUT a repeated closing vertex.
//
//   * A circle becomes its own ring, sampled into `circleSegments` chords.
//   * Arcs and lines are stitched head-to-tail (endpoint matching within
//     1e-5, mirroring extractWires) into one ring per closed loop; arcs are
//     sampled into chords at the same angular resolution as a full circle.
//
// Winding is NOT forced here — the caller orients each ring (CCW outer / CW
// hole) via the native signedArea, exactly as the native Profile contract
// requires. Open (non-closed) chains are still returned as a ring (the caller
// decides whether an open chain is valid for its op).
std::vector<std::vector<native::geom::Point2>>
extractProfileRings(SketchHandle h, int circleSegments = 96);

// ===================================================================
// Constraint DIAGNOSTICS — sketcher-constraints.md "Phase A".
//
// These SURFACE the diagnose pipeline that planegcs's GCS::System already
// computes (GCS.h: diagnose(), getConflicting/getRedundant/
// getPartiallyRedundant/getDependentParams(Groups), dofsNumber(),
// calculateConstraintErrorByTag()) but which the original 3-state `solve()`
// status dropped on the floor. No new numerics — pure facade exposure.
//
// They are bound to JS under `forge.sketch.diagnose.*` by
// src/binding_sketchdiag.cpp.

// What kind of geometry parameter a dependent param maps back to.
enum class SketchParamRole : std::uint8_t {
    PointX = 0,
    PointY = 1,
    CircleRadius = 2,
    ArcRadius = 3,
    ArcStartAngle = 4,
    ArcEndAngle = 5,
    Unknown = 255,
};

// A dependent (still-free) geometry parameter the solver flagged as a remaining
// degree of freedom — mapped back from the raw double* to the owning point /
// entity ID the JS caller knows.
struct SketchDependentParam {
    SketchParamRole role;
    std::uint32_t   ownerId;   // SketchParamId (PointX/Y) or SketchEntityId (radius/angles)
    int             group;     // index into getDependentParamsGroups(), or -1 if ungrouped
};

// Per-constraint residual: how far the constraint is from satisfied, by tag.
struct SketchConstraintResidual {
    int    tag;       // the tag returned by addConstraint()
    double residual;  // RMS error from GCS::calculateConstraintErrorByTag (NaN if no such tag)
};

// The full solver-backed diagnosis of a sketch.
struct SketchDiagnostics {
    int                 dof;                    // dofsNumber(): remaining DOF, or -1 if not diagnosable
    bool                emptyDiagnoseMatrix;    // isEmptyDiagnoseMatrix(): no driving constraints
    bool                hasConflicting;
    bool                hasRedundant;
    bool                hasPartiallyRedundant;
    std::vector<int>    conflicting;            // constraint TAGS that are mutually inconsistent
    std::vector<int>    redundant;              // constraint TAGS removable with no info lost
    std::vector<int>    partiallyRedundant;     // constraint TAGS over-determining a sub-DOF
    std::vector<SketchDependentParam> dependentParams;  // which geometry is still free
    int                 dependentParamGroupCount;
    // Classification derived from the above (DCM-style):
    //   "well"       — dof == 0, no conflicts/redundancy
    //   "under"      — dof  > 0
    //   "over"       — has conflicting tags (structurally inconsistent)
    //   "redundant"  — consistent but has redundant/partially-redundant tags
    //   "empty"      — no driving constraints to diagnose
    std::string         classification;
};

// Run a real solver-backed diagnose on the live sketch and return the full
// conflicting / redundant / partially-redundant / dependent-param report plus
// the rank-based DOF. Re-declares unknowns + initSolution(diagnose) so the
// report is valid even if the caller never called solve(). Does NOT mutate
// geometry (diagnose is a Jacobian-rank analysis, not a solve).
SketchDiagnostics diagnoseSketch(SketchHandle h);

// Residual of the constraint(s) carrying `tag`, via
// GCS::calculateConstraintErrorByTag (RMS of the per-solver-constraint errors;
// NaN if no constraint has that tag).
double constraintResidual(SketchHandle h, int tag);

// Residuals for EVERY tag the JS caller has added (1..nextConstraintTag).
std::vector<SketchConstraintResidual> allConstraintResiduals(SketchHandle h);

// SOLVER-BACKED replacement for the static src/SketchDof.cpp counting table.
// Builds nothing new — it diagnoses the live sketch and returns a DOF/health
// report whose `dof` is the true Jacobian-rank DOF (correct for coupled/looped
// systems, where the static count is wrong). `staticEstimate` carries the old
// counting value alongside, for a pre-solve UX hint only.
struct SketchAuditResult {
    int          totalEntities;
    int          totalConstraints;
    int          staticEstimate;   // legacy counting-table freeDof (pre-solve hint)
    int          solverDof;        // dofsNumber() — the SOURCE OF TRUTH
    std::string  status;           // SketchDiagnostics::classification
    bool         hasConflicting;
    bool         hasRedundant;
    bool         hasPartiallyRedundant;
};
SketchAuditResult auditSketch(SketchHandle h);

// ===================================================================
// DIAGNOSE, NEVER REFUSE — the solve contract the feature-IR uses.
//
// THE OWNER'S BINDING CONSTRAINT: "dont gate anything if you do that then how
// will Archie generate ultra long feature trees for Kernel to execute". A
// SOLVE that throws on a contradictory dimension is a capability gate wearing
// a safety hat, and it fires hardest on the LONGEST trees: one bad constraint
// in a 200-statement tree would cost all 200 statements. So the contract is
// REPRESENT / REPAIR / TOLERATE, and it never refuses.
//
// ── why plain `diagnoseSketch` is NOT sufficient, MEASURED ──────────────────
// planegcs's conflict analysis is a JACOBIAN-RANK analysis, so it sees
// STRUCTURAL over-determination and is BLIND to numeric infeasibility. Both
// failure modes were driven through the built facade on 2026-08-31:
//
//   over-constrained  p0,p1 COINCIDENT and DISTANCE 10
//     solve status=2  diagnose class="over"   conflicting=[1,2]   <- rank sees it
//
//   infeasible        p0p1=10, p1p2=10, p0p2=100 (violates the triangle ineq.)
//     solve status=1  diagnose class="under"  conflicting=[]      <- rank is BLIND
//                     residuals tag1=-5.0  tag2=-2.93  tag3=-95.0 <- but these name it
//
// A repair keyed only on `conflicting` demotes NOTHING in the second case and
// hands back a silently broken sketch. So the repair below is RESIDUAL-RANKED
// as well as conflict-ranked, and the residual pass is what covers the half
// the rank analysis cannot see.
enum class SketchDemotionReason : std::uint8_t {
    Conflicting = 0,   // named by GCS::getConflicting() — a rank conflict
    Residual    = 1,   // no rank conflict, but this tag carried the worst error
};

struct SketchDemotion {
    int                  tag;       // the tag addConstraint() returned
    SketchDemotionReason reason;
    double               residual;  // its error at the moment it was dropped
};

// The outcome of solveOrRepair(). `status` is the status of the FINAL solve.
// It is a REPORT, never an exception: every field is filled on every path.
struct SketchSolveReport {
    SketchSolveStatus           status;
    int                         dof;
    std::string                 classification;  // of the final state
    std::vector<SketchDemotion> demoted;         // in the order they were dropped
    double                      worstResidual;   // over the constraints that REMAIN
    bool                        geometryApplied; // false => the as-drawn seed was kept
    int                         passes;          // solves performed (>=1)
};

// Remove every constraint carrying `tag` (GCS::clearByTag) and invalidate the
// cached diagnosis. Adds no numerics — it exposes an engine entry the facade
// was missing, and without it the repair contract above is impossible.
void removeConstraintsByTag(SketchHandle h, int tag);

// Solve, and if that fails, REPAIR — never throw, never leave the caller
// without geometry.
//
//   1. solve(). If it converges clean, return.
//   2. While the solver reports CONFLICTING tags: drop the LAST-DECLARED
//      member (deterministic beats clever — a repair loop needs to be able to
//      predict what was dropped) and re-solve.
//   3. While the solve still FAILS numerically: drop the remaining constraint
//      with the LARGEST |residual| and re-solve. This is the pass that catches
//      the infeasible-triangle case above.
//   4. If nothing worked, keep the AS-DRAWN coordinates. That is byte-for-byte
//      what the IR produces today (every profile is currently baked, never
//      solved), so the FLOOR of this whole feature is the status quo: SOLVE
//      can never be worse than not having SOLVE.
//
// `maxDemotions` bounds the repair so a pathological sketch cannot spin; it is
// a work bound, not a capability gate — the sketch is still returned.
SketchSolveReport solveOrRepair(SketchHandle h, int maxDemotions = 16);

}  // namespace forge
