// ============================================================================
// forge::ft — the s0.4 graph-quality gate (unresolved refs, duplicate ids,
// unexplained orphans). Pure std C++; see GraphAudit.hpp for the law it serves.
// ============================================================================

#include "forge/ft/GraphAudit.hpp"

#include <algorithm>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"

namespace forge {
namespace ft {
namespace {

// SURFCHECK joins VERIFY and TAG: all three return their input unchanged, so all
// three are legitimate LEAVES. Omitting it here would make every diagnosed
// surface an "unexplained orphan" and reject the tree for measuring itself.
bool isPredicate(OpCode c) {
    return c == OpCode::Verify || c == OpCode::Tag || c == OpCode::SurfCheck;
}

// ---- the 2D sketch family contributes by SIDE EFFECT, not by dataflow ------
// Every other op in the IR delivers its value THROUGH its id: something later
// names %n, and that reference is the edge this audit walks. The sketch family
// does not. SPT / SLINE / SCIRC / SARC / CON mutate the SketchHandle their
// first operand belongs to, and the only thing that ever names them is another
// member of the same family. So the sweep below reaches the SKETCH (SOLVE
// references it) and then stops, and every entity and constraint that BUILT
// that sketch looks like dead code.
//
// That is invisible until something extrudes a solved sketch: a tree ending at
// SOLVE produces no SOLID, so compile() returns before this gate ever runs.
// forge-desktop/test/ir_pipeline_gate.cpp phase 2 is the first case to take
// that step, and it reported all 14 of them as orphans.
//
// The fix is NOT to exempt them the way VERIFY and TAG are exempt. A predicate
// is never an orphan because it is an assertion about the part; a sketch entity
// is a STEP of the part and must still earn its place. Exempting them would
// blunt the gate exactly where a generated tree is most likely to leave dead
// geometry -- a sketch built and never solved. So liveness FLOWS INSTEAD: a
// contributor is live if, and only if, the sketch it belongs to is live.
bool isSketchContributor(OpCode c) {
    return c == OpCode::SPt || c == OpCode::SLine || c == OpCode::SCirc ||
           c == OpCode::SArc || c == OpCode::Con;
}

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
    // id, so a reverse sweep closes the dataflow cone in one pass. A predicate
    // (VERIFY / TAG) is always live: it is an assertion about the part, not a
    // step of it, and its arguments keep whatever they name alive too.
    //
    // Dataflow is no longer the only edge, though -- see isSketchContributor
    // above -- so the sweep below carries a second rule and runs to a fixed
    // point rather than exactly once.

    // Which SKETCH each op belongs to. A %ref always points at an earlier id, so
    // one FORWARD pass closes it: a sketch owns itself, and every member of the
    // family inherits the owner of its first %ref (SPT names the sketch, SLINE
    // names two points, CON names an entity -- all resolve to the same root).
    std::map<int, int> sketchOwner;
    for (const Op& op : ft.ops) {
        if (op.code == OpCode::Sketch) {
            sketchOwner[op.id] = op.id;
        } else if (isSketchContributor(op.code)) {
            for (const Token& t : op.args) {
                if (t.kind != TokKind::Ref) continue;
                auto it = sketchOwner.find(t.ref);
                if (it != sketchOwner.end()) sketchOwner[op.id] = it->second;
                break;   // the FIRST %ref names the owner
            }
        }
    }

    std::set<int> live;
    live.insert(root);
    // Two rules, so the sweep is run to a FIXED POINT rather than once:
    //   (a) reverse -- a live op keeps whatever it names alive;
    //   (b) forward -- a sketch contributor is alive when its sketch is.
    // (b) can revive an op that (a) has already passed (a CON declared before
    // the SOLVE that makes its sketch live), and one pass in each direction is
    // not enough to settle that. Liveness only ever grows, so this terminates.
    bool changed = true;
    while (changed) {
        changed = false;
        for (auto it = ft.ops.rbegin(); it != ft.ops.rend(); ++it) {
            const Op& op = *it;
            if (!live.count(op.id) && !isPredicate(op.code)) continue;
            for (const Token& t : op.args)
                if (t.kind == TokKind::Ref && live.insert(t.ref).second) changed = true;
        }
        for (const Op& op : ft.ops) {
            if (!isSketchContributor(op.code) || live.count(op.id)) continue;
            auto own = sketchOwner.find(op.id);
            if (own != sketchOwner.end() && live.count(own->second)) {
                live.insert(op.id);
                changed = true;
            }
        }
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
