#pragma once

// Healing — geometric repair toolbox: sew open shells, fill missing faces,
// simplify redundant BREP detail, harmonise normals, and run validity
// checks. Backed by OCCT's ShapeFix / ShapeUpgrade / ShapeAnalysis suites.
//
// Every public function takes a ShapeHandle and returns a *new* ShapeHandle
// (refcount=1). The original is never mutated, so callers can roll back
// trivially by releasing the new handle.

#include "forge/ShapeHandle.hpp"

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

    // ── HONEST-REFUSAL ACCOUNTING (2026-09-14, TKOffset family-C drop) ───────
    // Before the drop, a wire the filler could not cap was swallowed by a bare
    // catch(...) and vanished: facesAdded simply did not increment and the
    // caller was told nothing about WHY. That is the shape of the defect this
    // kernel has shipped before — a result that reports success with an empty
    // reason. These three fields make every decline countable and explicable.
    //
    //   wiresSeen      free-boundary wires the pass considered
    //   wiresDeferred  those it declined to cap (wiresSeen - facesAdded)
    //   deferReasons   one NAMED reason per declined wire, parallel to the
    //                  order encountered. Never empty when wiresDeferred > 0.
    //
    // A decline is NOT an error: the wire stays a residual open edge and is
    // counted in openEdgesAfter, exactly as a failed fill always has been.
    std::size_t              wiresSeen = 0;
    std::size_t              wiresDeferred = 0;
    std::vector<std::string> deferReasons;
};
struct AutoFillResult {
    ShapeHandle    handle = kInvalidHandle;
    AutoFillReport report;
};
// Detect every free-boundary wire on `shape`, cap each with an EXACT analytic
// planar face, then sew it all together. Closes leaky imports.
//
// The cap is forge::occtfill::fillC0BoundaryDiag (src/native/brep/NativeFilling.cpp):
// a total-least-squares plane fitted through samples off the boundary's real
// curves, VERIFIED against `tolerance` as a worst-case orthogonal residual, then
// a Geom_Plane trimmed by the wire itself. There is no fitting in the result, so
// area/centroid/bbox are exact to machine epsilon.
//
// ★ CAPABILITY BOUNDARY, STATED: a NON-PLANAR free boundary is DECLINED, not
//   approximated. OCCT's BRepOffsetAPI_MakeFilling — which this call site used
//   until 2026-09-14 — fits an energy-minimising GeomPlate patch across an
//   arbitrary 3-D loop; no native equivalent exports a Geom_ surface, so capping
//   one would mean flattening it. A declined wire is left as a residual open edge,
//   counted in openEdgesAfter, and NAMED in AutoFillReport.deferReasons.
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
