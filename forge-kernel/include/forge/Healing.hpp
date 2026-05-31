#pragma once

// Healing — geometric repair toolbox: sew open shells, fill missing faces,
// simplify redundant BREP detail, harmonise normals, and run validity
// checks. Backed by OCCT's ShapeFix / ShapeUpgrade / ShapeAnalysis suites.
//
// Every public function takes a ShapeHandle and returns a *new* ShapeHandle
// (refcount=1). The original is never mutated, so callers can roll back
// trivially by releasing the new handle.

#include "forge/ShapeRegistry.hpp"

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::heal {

struct SewReport {
    bool   closedBefore = false;
    bool   closedAfter  = false;
    std::size_t facesBefore = 0;
    std::size_t facesAfter  = 0;
    std::size_t openEdgesBefore = 0;
    std::size_t openEdgesAfter  = 0;
};

// Stitch every free edge in `shape` whose neighbours fall within
// `tolerance` mm. Used to convert a "pile of faces" into a closed shell
// (and ideally a solid). Returns the sewn shape + a before/after report.
struct SewResult {
    ShapeHandle handle = kInvalidHandle;
    SewReport   report;
};
SewResult sewShape(ShapeHandle shape, double tolerance = 1e-3);

struct SimplifyOptions {
    bool unifyFaces = true;
    bool unifyEdges = true;
    bool concatBSplines = false;
    double angularTol = 1e-3;
};
struct SimplifyResult {
    ShapeHandle handle = kInvalidHandle;
    std::size_t facesBefore = 0;
    std::size_t facesAfter  = 0;
    std::size_t edgesBefore = 0;
    std::size_t edgesAfter  = 0;
};
SimplifyResult simplifyShape(ShapeHandle shape, const SimplifyOptions& opts = {});

struct AutoFillReport {
    std::size_t facesAdded = 0;
    bool        closedAfter = false;
    std::size_t openEdgesBefore = 0;
    std::size_t openEdgesAfter  = 0;
};
struct AutoFillResult {
    ShapeHandle    handle = kInvalidHandle;
    AutoFillReport report;
};
// Detect every free-boundary wire on `shape`, fit a `BRepOffsetAPI_MakeFilling`
// cap across each, then sew it all together. Closes leaky imports.
AutoFillResult autoFillMissingFaces(ShapeHandle shape, double tolerance = 1e-3);

struct RepairReport {
    bool fixedTolerance = false;
    bool fixedSelfIntersection = false;
    bool fixedSmallFaces = false;
    bool fixedOrientation = false;
    bool fixedWires = false;
    std::size_t fixersFired = 0;
};
struct RepairResult {
    ShapeHandle  handle = kInvalidHandle;
    RepairReport report;
};
RepairResult autoRepairSelfIntersection(ShapeHandle shape, double tolerance = 1e-3);

// Re-orient every face so its parametric normal points OUT of the closed
// volume. Required after CAD imports that lost orientation flags.
ShapeHandle harmonizeNormals(ShapeHandle shape);

struct ValidityReport {
    bool isClosed = false;
    bool isManifold = false;
    bool isOriented = false;
    bool hasSelfIntersect = false;
    bool hasNonManifoldEdge = false;
    std::vector<std::uint32_t> badFaces;
    std::vector<std::uint32_t> badEdges;
};
ValidityReport checkValidity(ShapeHandle shape);

} // namespace forge::heal
