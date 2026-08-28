#pragma once

// ============================================================================
// forge::ft — the s0.4 graph-quality gate.
//
// SACROSANCT 3.1 s0.4: "The required values for unresolved references,
// unexplained orphans, opaque placeholders, and unapproved failed nodes are
// zero", and Appendix B NOOP-PADDING: "graph-quality gate rejects or removes
// padding without hiding required intent".
//
// Opaque placeholders are rejected at the parser (s0.5, FeatureTreeCompiler.cpp).
// The other two are GRAPH properties, computable from the parsed IR alone with
// no geometry: this file computes them, and compile() refuses a graph that
// carries any of them. That is the "without hiding required intent" half as
// well — nothing is stripped or rewritten, the graph is REJECTED and the exact
// offending ids are named so the emitter can repair them.
//
// Pure std C++: no kernel, no OCCT. A quality gate that can only run once a
// solid has been built is a gate that runs too late.
// ============================================================================

#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"

namespace forge {
namespace ft {

struct GraphAudit {
    // %N referenced by some op but never defined by any op.
    std::vector<int> unresolvedRefs;
    // The same %id defined twice — the second definition silently shadows.
    std::vector<int> duplicateIds;
    // Ops that contribute nothing to the result: not the root, and not reachable
    // from the root through %ref arguments. This is exactly the NOOP-PADDING
    // dead branch, and equally a genuinely forgotten sub-body.
    std::vector<int> unexplainedOrphans;

    bool clean() const {
        return unresolvedRefs.empty() && duplicateIds.empty() && unexplainedOrphans.empty();
    }
    // Human-readable, ids named exactly, suitable to hand back as a repair
    // instruction. Empty string when clean().
    std::string report() const;
};

// Audit a parsed graph.
//
// `rootId` is the op whose value is the delivered part: the explicit RESULT(%id)
// when the tree has one, or the id the compiler would fall back to. Pass -1 to
// let the audit infer it the way the IR documents the fallback — the last op
// that is not a pass-through predicate (VERIFY / TAG).
//
// VERIFY and TAG are never orphans: they are predicates whose entire job is to
// be leaves. Every other op must earn its place in the result.
GraphAudit auditGraph(const FeatureTree& ft, int rootId = -1);

}  // namespace ft
}  // namespace forge
