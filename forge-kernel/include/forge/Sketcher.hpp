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
    Equal          = 9,   // addConstraintEqualLength (lines) / EqualRadius (circles)
    Tangent        = 10,  // addConstraintTangent (line↔circle is the supported pair)
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
//   Equal:         refs = {lineA, lineB}         (or {circleA, circleB})
//   Tangent:       refs = {line, circle}
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

}  // namespace forge
