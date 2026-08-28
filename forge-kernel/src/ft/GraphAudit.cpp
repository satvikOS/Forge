// ============================================================================
// forge::ft — the s0.4 graph-quality gate (unresolved refs, duplicate ids,
// unexplained orphans). Pure std C++; see GraphAudit.hpp for the law it serves.
// ============================================================================

#include "forge/ft/GraphAudit.hpp"

#include <algorithm>
#include <set>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"

namespace forge {
namespace ft {
namespace {

bool isPredicate(OpCode c) { return c == OpCode::Verify || c == OpCode::Tag; }

std::string idList(const std::vector<int>& v) {
    std::string s;
    for (int id : v) {
        if (!s.empty()) s += ", ";
        s += "%" + std::to_string(id);
    }
    return s;
}

}  // namespace

std::string GraphAudit::report() const {
    if (clean()) return std::string();
    std::string s = "s0.4 graph-quality gate:";
    if (!unresolvedRefs.empty())
        s += " unresolved_references=" + std::to_string(unresolvedRefs.size()) + " [" +
             idList(unresolvedRefs) + "]";
    if (!duplicateIds.empty())
        s += " duplicate_ids=" + std::to_string(duplicateIds.size()) + " [" +
             idList(duplicateIds) + "]";
    if (!unexplainedOrphans.empty())
        s += " unexplained_orphans=" + std::to_string(unexplainedOrphans.size()) + " [" +
             idList(unexplainedOrphans) +
             "] — these ops contribute nothing to the result";
    s += ". The required value for each is ZERO.";
    return s;
}

GraphAudit auditGraph(const FeatureTree& ft, int rootId) {
    GraphAudit a;
    if (ft.ops.empty()) return a;

    // ---- defined ids, and duplicates -------------------------------------
    std::set<int> defined;
    for (const Op& op : ft.ops) {
        if (!defined.insert(op.id).second) a.duplicateIds.push_back(op.id);
    }

    // ---- unresolved references -------------------------------------------
    // Reported once per distinct missing id, in ascending order, so the message
    // is stable regardless of where in the graph the reference appeared. An
    // order-dependent diagnostic makes a test that asserts it order-dependent.
    {
        std::set<int> missing;
        for (const Op& op : ft.ops)
            for (const Token& t : op.args)
                if (t.kind == TokKind::Ref && !defined.count(t.ref)) missing.insert(t.ref);
        a.unresolvedRefs.assign(missing.begin(), missing.end());
    }

    // ---- the root ---------------------------------------------------------
    int root = rootId;
    if (root < 0) {
        root = ft.resultId;
        if (root < 0)
            for (const Op& op : ft.ops)
                if (!isPredicate(op.code)) root = op.id;   // documented fallback
    }

    // ---- reachability from the root --------------------------------------
    // Creation order IS evaluation order and a %ref always points at an earlier
    // id, so ONE reverse sweep closes the cone. A predicate (VERIFY / TAG) is
    // always live: it is an assertion about the part, not a step of it, and its
    // arguments keep whatever they name alive too.
    std::set<int> live;
    live.insert(root);
    for (auto it = ft.ops.rbegin(); it != ft.ops.rend(); ++it) {
        const Op& op = *it;
        if (!live.count(op.id) && !isPredicate(op.code)) continue;
        for (const Token& t : op.args)
            if (t.kind == TokKind::Ref) live.insert(t.ref);
    }

    for (const Op& op : ft.ops) {
        if (isPredicate(op.code)) continue;
        if (!live.count(op.id)) a.unexplainedOrphans.push_back(op.id);
    }
    std::sort(a.unexplainedOrphans.begin(), a.unexplainedOrphans.end());
    return a;
}

}  // namespace ft
}  // namespace forge
