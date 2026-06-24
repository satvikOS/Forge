// forge/native/brep/Check.hpp
//
// K5 / Phase-H1.1 — NATIVE B-REP VALIDATOR for the Forge native kernel: the
// in-house equivalent of Spatial ACIS `check_entity` / OCCT `BRepCheck_Analyzer`.
// This is "the oracle every heal op gates on" (docs/SCOPE_2026-06-24/kernel/
// healing-tolerance.md Phase H1 — P0). It runs a structured battery of
// ~20-30 PREDICATES across the three BRepCheck families on a geometry-bearing
// native B-rep (Shell / Solid built from Topology.hpp + Surface/Curve/PCurve),
// and reports per-predicate pass/fail with the offending entity ids.
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL algorithm, pure C++20 + stdlib ONLY — NO external dependencies, NO OCCT,
// NO WASM, no test framework. ADDITIVE: a brand-new header + TU. It does NOT edit
// Topology.hpp / Surface.hpp / Curve.hpp / TrimmedFace.hpp / Sew.hpp; it only
// READS the topology graph + the attached analytic geometry. It REUSES (no
// re-derivation):
//   * Topology.hpp        — Vertex/Edge/Coedge/Loop/Face/Shell/Solid + the
//                           structural closed-2-manifold machinery,
//   * diagnoseShell (Sew) — the same edge coedge-count classification (free /
//                           manifold / non-manifold) the sewer reports,
//   * Surface.hpp         — Surface::evaluate / evaluateDeriv / normalAt for the
//                           geometric predicates (face orientation, area),
//   * Curve.hpp           — Edge::curve / Coedge::pcurve sampling for the pcurve-
//                           vs-3D-edge agreement + zero-length-edge tests,
//   * ExactPredicates3D   — exactOrient3D for the geometric sign decisions
//                           (vertex-on-edge collinearity, signed-volume tetra
//                           sum) so the combinatorial verdict is EXACT, never a
//                           float tie-break (the stated kernel robustness ceiling).
//
// THE PREDICATE BATTERY (each is one CheckPredicate row in the report):
//
//   TOPOLOGY family
//     T1  EveryEdgeHasOneOrTwoCoedges   — no edge with 0 or 3+ coedges.
//     T2  NoDanglingCoedge              — every coedge has loop/next/prev/edge.
//     T3  NoDuplicateEdge               — no two distinct edges join the same
//                                         (welded) vertex pair with the same curve.
//     T4  WireClosure                   — every loop's coedge ring closes
//                                         (next^n returns to first; dest==next.origin).
//     T5  FaceHasOuterLoop              — every face has >=1 outer loop.
//     T6  ShellClosureConsistent        — a shell flagged closed has 0 free +
//                                         0 non-manifold edges, and vice-versa.
//     T7  ShellConnected                — the faces form ONE connected component
//                                         via shared edges (no detached island).
//     T8  EulerPoincareConsistent       — V-E+F-R-2(S-G)=0 for the reported genus.
//     T9  NoNonManifoldEdge             — no edge shared by 3+ coedges (the
//                                         explicit non-manifold flag, distinct
//                                         from T1 which also catches 0-use edges).
//
//   GEOMETRY family
//     G1  NoZeroLengthEdge              — every edge's two endpoints (and curve
//                                         trim) span > tol.
//     G2  NoDegenerateFace              — every face's outer loop encloses > tol^2
//                                         area (no collapsed / zero-area face).
//     G3  FaceNormalOutward             — every face's analytic outward normal
//                                         agrees with the global outward sense
//                                         derived from the closed-shell signed
//                                         volume (no flipped face).
//     G4  NoSelfIntersectingFace        — each face's outer loop, classified by the
//                                         TrimmedFace point-in-trim engine, is a
//                                         simple (non-self-crossing) wire.
//     G5  PCurveMatches3DEdge           — for every coedge carrying a pcurve, the
//                                         composition S(P(t)) reproduces the edge's
//                                         3D curve C(t) to <= tol over samples
//                                         (the K0 consistency invariant).
//     G6  VertexOnEdge                  — every edge endpoint vertex lies on the
//                                         edge's 3D curve (within tol).
//     G7  EdgeOnFace                    — every coedge's 3D curve lies on its face's
//                                         surface (sampled distance <= tol).
//     G8  ToleranceValid                — every per-entity tolerance is finite,
//                                         non-negative, and below a sanity ceiling.
//     G9  EdgeSameParameter             — every coedge's pcurve trim endpoints map
//                                         (through the surface) onto the edge's two
//                                         endpoint vertices within tol (OCCT
//                                         InvalidSameParameter / SameRange).
//
//   ORIENTATION family
//     O1  CoedgePairsOpposite           — the two coedges of every manifold edge
//                                         run in opposite sense (one fwd, one rev).
//     O2  OuterLoopCCW                   — every face's outer loop is wound CCW in
//                                         the surface (u,v) parameter plane (signed
//                                         param area > 0); inner loops wound CW.
//     O3  CoedgeMateConsistent          — coedgeA.mate==coedgeB and vice-versa on
//                                         every two-coedge edge.
//
// A valid sewn box passes ALL of these. Each predicate names the offending entity
// ids (edge / face / coedge / loop / vertex) when it fails, so a heal op can act.
//
// CONVENTIONS: namespace forge::native::brep. `tol` is model-space distance; a
// face/edge with a per-entity tolerance uses max(global tol, entity tolerance).

#ifndef FORGE_NATIVE_BREP_CHECK_HPP
#define FORGE_NATIVE_BREP_CHECK_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/native/brep/Topology.hpp"   // Vertex/Edge/Coedge/Loop/Face/Shell/Solid

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// CheckFamily — which BRepCheck family a predicate belongs to.
// ---------------------------------------------------------------------------
enum class CheckFamily {
    Topology,
    Geometry,
    Orientation
};

// ---------------------------------------------------------------------------
// CheckStatus — the OCCT-BRepCheck_Status-equivalent enum each predicate maps to.
// The names mirror the OCCT statuses so the A/B comparison against
// BRepCheck_Analyzer is a direct enum-name lookup. `NoError` == predicate passed.
// ---------------------------------------------------------------------------
enum class CheckStatus {
    NoError = 0,            // predicate passed

    // TOPOLOGY
    InvalidMultiConnexity, // T1: edge with 0 or 3+ coedges (OCCT InvalidMultiConnexity)
    SubshapeNotInShape,    // T2: dangling coedge (no loop / next / prev / edge)
    RedundantEdge,         // T3: duplicate edge on same vertex pair + curve
    NotClosedWire,         // T4: loop ring does not close (OCCT -> InvalidWire family)
    EmptyWire,             // T5: face has no outer loop (OCCT EmptyWire / NoSurface)
    NotClosed,             // T6: shell closure flag inconsistent with free edges
    NotConnected,          // T7: shell faces are not one connected component
    EulerInvalid,          // T8: Euler-Poincare characteristic inconsistent
    NonManifoldEdge,       // T9: an edge has 3+ coedges (explicit non-manifold flag)

    // GEOMETRY
    ZeroLengthEdge,        // G1: collapsed edge (OCCT -> InvalidRange / degenerate)
    DegeneratedFace,       // G2: zero-area / collapsed face
    BadOrientationFace,    // G3: face normal points inward (OCCT BadOrientation)
    SelfIntersectingWire,  // G4: a face's outer loop self-crosses
    InvalidCurveOnSurface, // G5: pcurve composition disagrees with 3D edge curve
    InvalidPointOnCurve,   // G6: edge endpoint vertex not on the edge's 3D curve
    NoCurveOnSurface,      // G7: edge 3D curve does not lie on the face surface
    InvalidToleranceValue, // G8: a per-entity tolerance is NaN/inf/negative/huge
    InvalidSameParameter,  // G9: edge endpoints disagree with the pcurve trim ends

    // ORIENTATION
    BadOrientation,        // O1: a manifold edge's two coedges agree in sense
    BadOrientationCCW,     // O2: an outer loop is wound CW (or inner loop CCW)
    BadOrientationMate     // O3: coedge mate links inconsistent
};

const char* checkStatusName(CheckStatus s);
const char* checkFamilyName(CheckFamily f);

// ---------------------------------------------------------------------------
// CheckPredicate — one row of the report: a single predicate's verdict.
// ---------------------------------------------------------------------------
struct CheckPredicate {
    CheckFamily family = CheckFamily::Topology;
    CheckStatus status = CheckStatus::NoError;  // the status this predicate maps to
    std::string name;                            // short stable id, e.g. "T1.EveryEdgeHasOneOrTwoCoedges"
    bool        passed = true;

    // The offending entity ids (edge / face / coedge / loop / vertex) when failed.
    // The kind tag tells a heal op what each id refers to.
    enum class IdKind { Edge, Face, Coedge, Loop, Vertex, Shell };
    struct Offender {
        IdKind        kind = IdKind::Edge;
        std::uint32_t id   = 0;
    };
    std::vector<Offender> offenders;

    // Optional human note (e.g. the measured deviation that tripped a tolerance).
    std::string detail;
};

// ---------------------------------------------------------------------------
// CheckReport — the full structured battery result.
// ---------------------------------------------------------------------------
struct CheckReport {
    bool                        valid = false;  // true iff EVERY predicate passed
    std::vector<CheckPredicate> predicates;     // ~20-30 rows

    // Convenience accessors used by the gate / a heal op.
    std::size_t total()  const { return predicates.size(); }
    std::size_t passed() const {
        std::size_t n = 0;
        for (const auto& p : predicates) if (p.passed) ++n;
        return n;
    }
    std::size_t failed() const { return total() - passed(); }

    // Find a predicate by its short name (e.g. "G3.FaceNormalOutward"); null if
    // absent. (Used by the A/B oracle to map a name -> verdict.)
    const CheckPredicate* find(const std::string& name) const {
        for (const auto& p : predicates) if (p.name == name) return &p;
        return nullptr;
    }

    // True iff the named predicate ran and FAILED.
    bool failedPredicate(const std::string& name) const {
        const CheckPredicate* p = find(name);
        return p != nullptr && !p->passed;
    }

    // The set of distinct CheckStatus enums that FAILED (the BRepCheck_Status list
    // OCCT would report). Useful for the per-status A/B verdict comparison.
    std::vector<CheckStatus> failedStatuses() const;
};

// ---------------------------------------------------------------------------
// CheckOptions — tolerances and toggles for the battery.
// ---------------------------------------------------------------------------
struct CheckOptions {
    // Model-space distance tolerance for the geometric predicates (vertex-on-edge,
    // edge-on-face, pcurve agreement, zero-length). Per-entity tolerances on
    // Vertex/Edge/Coedge are OR-ed in (max(global, entity)).
    double tol = 1e-6;

    // Samples per curve / loop segment for the geometric agreement tests.
    std::size_t curveSamples = 8;

    // Sanity ceiling for the InvalidToleranceValue predicate (a tolerance larger
    // than this is treated as a defect — a runaway tolerant entity).
    double maxTolerance = 1.0;

    // When true (default), the shell is expected to be CLOSED (a solid). When the
    // caller knows the input is an open sheet body, set false so T6 checks the
    // OPEN-consistency direction instead of demanding closure.
    bool expectClosed = true;
};

// ===========================================================================
// THE VALIDATOR — checkBRep
// ===========================================================================
//
// Run the full predicate battery on a SHELL given by its face set (the canonical
// entry: a shell is a set of faces). Returns the structured report. The input is
// NOT mutated. `faces` must be the complete face set of one body (the validator
// derives edges/coedges/vertices/loops by walking the loops).
CheckReport checkBRep(const std::vector<Face*>& faces,
                      const CheckOptions& opt = {});

// Convenience overload: validate a Shell (uses shell->faces).
CheckReport checkBRep(const Shell* shell, const CheckOptions& opt = {});

// Convenience overload: validate a Solid (concatenates all its shells' faces;
// multi-shell solids are validated as one face set, which is what the structural
// predicates need — T7 connectivity will then report the shell count honestly).
CheckReport checkBRep(const Solid* solid, const CheckOptions& opt = {});

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_CHECK_HPP
