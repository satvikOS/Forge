#pragma once

// Forge-208 — sketch constraint health audit.
//
// Counts the geometric degrees of freedom in a 2D sketch and the DOFs
// removed by its constraints. Reports whether the sketch is
// under-constrained, fully constrained, or over-constrained.
//
// DOF table per entity:
//   point  → 2 (x, y)
//   line   → 4 (start x/y + end x/y)
//   circle → 3 (centre x/y + radius)
//   arc    → 5 (centre x/y + radius + start/end angles)
//
// DOF removed per constraint (typical values):
//   fix              → 2
//   coincident       → 2
//   horizontal       → 1
//   vertical         → 1
//   distance         → 1
//   radius           → 1
//   diameter         → 1
//   angle            → 1
//   parallel         → 1
//   perpendicular    → 1
//   tangent          → 1
//   equal            → 1
//   concentric       → 2
//   symmetric        → 2
//   midpoint         → 2
//
// The caller can override the per-kind DOF cost via the `customDof`
// map so domain-specific constraints (e.g. block, alignment) get the
// right count.

#include <cstdint>
#include <string>
#include <vector>

namespace forge { namespace sketchdof {

struct Entity {
    std::string kind;   // "point" | "line" | "circle" | "arc"
};

struct Constraint {
    std::string kind;   // see DOF-removal table above
};

struct CustomDof {
    std::string kind;
    std::int32_t dof;
};

struct Inputs {
    std::vector<Entity>     entities;
    std::vector<Constraint> constraints;
    std::vector<CustomDof>  entityOverrides;     // per-kind add DOF override
    std::vector<CustomDof>  constraintOverrides; // per-kind removal override
};

struct Outputs {
    std::uint32_t totalEntities;
    std::uint32_t totalConstraints;
    std::int32_t  totalDof;          // sum of entity DOFs
    std::int32_t  constrainedDof;    // sum of constraint DOFs removed
    std::int32_t  freeDof;           // totalDof - constrainedDof
    std::string   status;            // "under" | "fully" | "over"
};

Outputs audit(const Inputs& in);

}} // namespace forge::sketchdof
