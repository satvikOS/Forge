// forge/native/storage/StorageGovernor.cpp — see StorageGovernor.hpp.
//
// Contains no unlink/remove/rename/truncate. The only filesystem writes in the
// whole module are the caller's decision to save the rendered plan.

#include "forge/native/storage/StorageGovernor.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <functional>
#include <limits>
#include <sstream>
#include <system_error>

#include <csignal>
#include <cerrno>

namespace forge::native::storage {

// ═══════════════════════════════════════════════════════════════════════════
// enum names
// ═══════════════════════════════════════════════════════════════════════════

const char* toString(RootVerdict v) {
    switch (v) {
        case RootVerdict::OK:                    return "OK";
        case RootVerdict::EMPTY:                 return "EMPTY";
        case RootVerdict::NOT_ABSOLUTE:          return "NOT_ABSOLUTE";
        case RootVerdict::UNRESOLVED_VARIABLE:   return "UNRESOLVED_VARIABLE";
        case RootVerdict::IS_FILESYSTEM_ROOT:    return "IS_FILESYSTEM_ROOT";
        case RootVerdict::IS_HOME_DIRECTORY:     return "IS_HOME_DIRECTORY";
        case RootVerdict::IS_WORKSPACE_ROOT:     return "IS_WORKSPACE_ROOT";
        case RootVerdict::ANCESTOR_OF_WORKSPACE: return "ANCESTOR_OF_WORKSPACE";
        case RootVerdict::OUTSIDE_WORKSPACE:     return "OUTSIDE_WORKSPACE";
        case RootVerdict::SYMLINK_ESCAPE:        return "SYMLINK_ESCAPE";
        case RootVerdict::NOT_A_DIRECTORY:       return "NOT_A_DIRECTORY";
    }
    return "UNKNOWN_VERDICT";
}

const char* toString(ArtifactClass c) {
    switch (c) {
        case ArtifactClass::UNKNOWN:            return "UNKNOWN";
        case ArtifactClass::BUILD_TREE:         return "BUILD_TREE";
        case ArtifactClass::DEPENDENCY_TREE:    return "DEPENDENCY_TREE";
        case ArtifactClass::WORKTREE:           return "WORKTREE";
        case ArtifactClass::WORKTREE_RECORD:    return "WORKTREE_RECORD";
        case ArtifactClass::CACHE:              return "CACHE";
        case ArtifactClass::LOG:                return "LOG";
        case ArtifactClass::DATASET:            return "DATASET";
        case ArtifactClass::MODEL:              return "MODEL";
        case ArtifactClass::EVAL_HOLDOUT:       return "EVAL_HOLDOUT";
        case ArtifactClass::NORMATIVE_DOCUMENT: return "NORMATIVE_DOCUMENT";
        case ArtifactClass::PROVENANCE_RECORD:  return "PROVENANCE_RECORD";
        case ArtifactClass::SESSION_ARTIFACT:   return "SESSION_ARTIFACT";
        case ArtifactClass::FAILURE_REPRODUCER: return "FAILURE_REPRODUCER";
        case ArtifactClass::USER_PROJECT:       return "USER_PROJECT";
    }
    return "UNKNOWN";
}

bool isAlwaysPinnedClass(ArtifactClass c) {
    switch (c) {
        case ArtifactClass::DATASET:
        case ArtifactClass::MODEL:
        case ArtifactClass::EVAL_HOLDOUT:
        case ArtifactClass::NORMATIVE_DOCUMENT:
        case ArtifactClass::PROVENANCE_RECORD:
        case ArtifactClass::SESSION_ARTIFACT:
        case ArtifactClass::FAILURE_REPRODUCER:
        case ArtifactClass::USER_PROJECT:
            return true;
        default:
            return false;
    }
}

const char* toString(State s) {
    switch (s) {
        case State::HOT:          return "HOT";
        case State::WARM:         return "WARM";
        case State::PINNED:       return "PINNED";
        case State::ROLLBACK:     return "ROLLBACK";
        case State::ARCHIVED:     return "ARCHIVED";
        case State::GC_CANDIDATE: return "GC_CANDIDATE";
        case State::QUARANTINED:  return "QUARANTINED";
        case State::PURGED:       return "PURGED";
    }
    return "UNKNOWN_STATE";
}

bool isTerminal(State s) { return s == State::PURGED; }

bool isLegalTransition(State from, State to) {
    if (from == State::PURGED) return false;              // terminal
    if (to == State::PURGED)   return from == State::GC_CANDIDATE;  // ONLY door
    if (from == to)            return true;
    switch (from) {
        case State::HOT:
            return to == State::WARM || to == State::PINNED || to == State::QUARANTINED;
        case State::WARM:
            return to == State::HOT || to == State::PINNED || to == State::ROLLBACK ||
                   to == State::ARCHIVED || to == State::GC_CANDIDATE ||
                   to == State::QUARANTINED;
        case State::PINNED:
            return to == State::WARM || to == State::QUARANTINED;   // unpin is deliberate
        case State::ROLLBACK:
            return to == State::ARCHIVED || to == State::WARM || to == State::QUARANTINED;
        case State::ARCHIVED:
            return to == State::WARM || to == State::GC_CANDIDATE || to == State::QUARANTINED;
        case State::GC_CANDIDATE:
            // A candidate can always be pulled BACK by new evidence.
            return to == State::WARM || to == State::HOT || to == State::PINNED ||
                   to == State::QUARANTINED;
        case State::QUARANTINED:
            return to == State::WARM || to == State::PINNED;  // never straight to GC
        case State::PURGED:
            return false;
    }
    return false;
}

const char* toString(UnpushedEvidence e) {
    switch (e) {
        case UnpushedEvidence::UNKNOWN:               return "UNKNOWN";
        case UnpushedEvidence::COMPARISON_REF_ABSENT: return "COMPARISON_REF_ABSENT";
        case UnpushedEvidence::CONTAINED:             return "CONTAINED";
        case UnpushedEvidence::NOT_CONTAINED:         return "NOT_CONTAINED";
        case UnpushedEvidence::PROBE_FAILED:          return "PROBE_FAILED";
    }
    return "UNKNOWN";
}

const char* toString(Disposition d) {
    switch (d) {
        case Disposition::MUST_PIN:            return "MUST_PIN";
        case Disposition::NEEDS_PROOF:         return "NEEDS_PROOF";
        case Disposition::PROVABLY_DISPOSABLE: return "PROVABLY_DISPOSABLE";
    }
    return "NEEDS_PROOF";
}

// ═══════════════════════════════════════════════════════════════════════════
// path primitives
// ═══════════════════════════════════════════════════════════════════════════

fs::path resolveThroughLinks(const fs::path& p) {
    std::error_code ec;
    fs::path canon = fs::weakly_canonical(p, ec);
    if (!ec && !canon.empty()) return canon.lexically_normal();
    // weakly_canonical can fail on a broken link mid-path; walk it by hand,
    // resolving every component that resolves and keeping the rest lexically.
    fs::path acc = p.is_absolute() ? fs::path(p.root_path()) : fs::path();
    for (const auto& part : p.relative_path()) {
        if (part == ".") continue;
        if (part == "..") { acc = acc.parent_path(); continue; }
        acc /= part;
        std::error_code e2;
        if (fs::is_symlink(fs::symlink_status(acc, e2)) && !e2) {
            fs::path tgt = fs::read_symlink(acc, e2);
            if (!e2) acc = tgt.is_absolute() ? tgt : (acc.parent_path() / tgt);
            acc = acc.lexically_normal();
        }
    }
    return acc.lexically_normal();
}

bool lexicallyInside(const fs::path& parent, const fs::path& child) {
    const fs::path a = parent.lexically_normal();
    const fs::path b = child.lexically_normal();
    if (a.empty() || b.empty()) return false;
    auto ai = a.begin(), ae = a.end();
    auto bi = b.begin(), be = b.end();
    for (; ai != ae; ++ai, ++bi) {
        if (bi == be) return false;      // child is shorter -> cannot be inside
        if (*ai != *bi) return false;    // component mismatch (kills the /a/bc bug)
    }
    return bi != be;                     // strictly inside, not equal
}

static bool looksLikeVolumeRoot(const fs::path& p) {
    const fs::path n = p.lexically_normal();
    if (n == n.root_path()) return true;                 // "/"
    // "/Volumes/X", "/System/Volumes/Data" and equivalents: a single component
    // under a well-known mount parent is a volume root, not a managed root.
    std::vector<std::string> parts;
    for (const auto& c : n.relative_path()) parts.push_back(c.string());
    if (parts.size() == 2 && parts[0] == "Volumes") return true;
    if (parts.size() == 3 && parts[0] == "System" && parts[1] == "Volumes") return true;
    if (parts.size() == 1 && (parts[0] == "Users" || parts[0] == "home" ||
                              parts[0] == "mnt" || parts[0] == "media")) return true;
    if (parts.size() == 2 && (parts[0] == "Users" || parts[0] == "home")) return true;  // a home dir
    return false;
}

static bool hasUnresolvedVariable(const std::string& s) {
    if (s.find('$') != std::string::npos) return true;
    if (s.find('%') != std::string::npos) return true;
    if (!s.empty() && s[0] == '~') return true;
    if (s.find("/~") != std::string::npos) return true;
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// ManagedRootRegistry
// ═══════════════════════════════════════════════════════════════════════════

ManagedRootRegistry::ManagedRootRegistry(fs::path workspace, fs::path home)
    : workspace_(resolveThroughLinks(workspace)),
      workspaceDeclared_(workspace.lexically_normal()),
      home_(home.empty() ? fs::path() : resolveThroughLinks(home)) {}

RootVerdict ManagedRootRegistry::evaluate(const fs::path& p) const {
    const std::string raw = p.string();
    if (raw.empty()) return RootVerdict::EMPTY;
    if (hasUnresolvedVariable(raw)) return RootVerdict::UNRESOLVED_VARIABLE;
    if (!p.is_absolute()) return RootVerdict::NOT_ABSOLUTE;

    const fs::path lex   = p.lexically_normal();
    const fs::path canon = resolveThroughLinks(p);

    // ── identity checks, on the RESOLVED path ────────────────────────────
    // The workspace itself may be reached through a link (on macOS /tmp is a
    // link to /private/tmp), so "is this $HOME?" must be asked of where the
    // path LANDS, never of how it was spelled.
    if (lex == lex.root_path() || canon == canon.root_path())
        return RootVerdict::IS_FILESYSTEM_ROOT;
    if (!home_.empty() && (canon == home_ || lex == home_))
        return RootVerdict::IS_HOME_DIRECTORY;
    if (looksLikeVolumeRoot(lex) || looksLikeVolumeRoot(canon))
        return RootVerdict::IS_FILESYSTEM_ROOT;
    if (canon == workspace_ || lex == workspaceDeclared_)
        return RootVerdict::IS_WORKSPACE_ROOT;
    if (lexicallyInside(canon, workspace_) || lexicallyInside(lex, workspaceDeclared_))
        return RootVerdict::ANCESTOR_OF_WORKSPACE;

    // ── containment ───────────────────────────────────────────────────────
    // "Looked inside" is judged on the DECLARED spelling under either the
    // declared or the resolved workspace; "lands inside" is judged on the
    // RESOLVED path. Inside-then-outside is precisely a symlink escape.
    const bool declaredInside = lexicallyInside(workspaceDeclared_, lex) ||
                                lexicallyInside(workspace_, lex);
    const bool landsInside    = lexicallyInside(workspace_, canon);
    if (!declaredInside && !landsInside) return RootVerdict::OUTSIDE_WORKSPACE;
    if (!landsInside) return RootVerdict::SYMLINK_ESCAPE;

    std::error_code ec;
    if (!fs::is_directory(canon, ec) || ec) return RootVerdict::NOT_A_DIRECTORY;
    return RootVerdict::OK;
}

RootVerdict ManagedRootRegistry::registerRoot(const std::string& id, const fs::path& p) {
    const RootVerdict v = evaluate(p);
    if (v != RootVerdict::OK) return v;
    roots_.push_back(ManagedRoot{id, p.lexically_normal(), resolveThroughLinks(p)});
    return RootVerdict::OK;
}

bool ManagedRootRegistry::contains(const fs::path& p) const {
    return !owningRootId(p).empty();
}

std::string ManagedRootRegistry::owningRootId(const fs::path& p) const {
    if (p.empty() || !p.is_absolute()) return {};
    if (hasUnresolvedVariable(p.string())) return {};
    const fs::path canon = resolveThroughLinks(p);
    for (const auto& r : roots_) {
        // BOTH forms must be inside. The declared spelling must LOOK inside
        // the root (under either spelling of the root), AND the resolved path
        // must not have wandered out through a link. Requiring both is what
        // makes an escaping symlink un-reachable rather than merely unusual.
        const fs::path lex = p.lexically_normal();
        const bool lexOk = (lex == r.declared)  || lexicallyInside(r.declared, lex) ||
                           (lex == r.canonical) || lexicallyInside(r.canonical, lex);
        const bool canonOk = (canon == r.canonical) || lexicallyInside(r.canonical, canon);
        if (lexOk && canonOk) return r.id;
    }
    return {};
}

// ═══════════════════════════════════════════════════════════════════════════
// classify — the whole point
// ═══════════════════════════════════════════════════════════════════════════

Disposition classify(const Artifact& a, const ManagedRootRegistry& reg, std::string& reason) {
    // (0) AUTHORITY. Outside a registered managed root there is no authority to
    //     propose anything, at any pressure, ever.
    //     The empty-path check comes FIRST so it can report the actual defect:
    //     owningRootId("") also returns "", so the other order silently
    //     mislabels a missing path as "outside every managed root".
    if (a.canonicalPath.empty()) {
        reason = "artifact has no path — nothing can be proven about it";
        return Disposition::MUST_PIN;
    }
    const std::string rootId = reg.owningRootId(a.canonicalPath);
    if (rootId.empty()) {
        reason = "outside every registered managed root — no deletion authority";
        return Disposition::MUST_PIN;
    }

    // (1) CLASS. Some things are never candidates whatever the evidence says.
    if (isAlwaysPinnedClass(a.klass)) {
        reason = std::string("protected class ") + toString(a.klass) +
                 " is never auto-disposable";
        return Disposition::MUST_PIN;
    }
    if (a.klass == ArtifactClass::UNKNOWN) {
        reason = "artifact class UNKNOWN — an unclassified artifact is never disposable";
        return Disposition::NEEDS_PROOF;
    }

    // (2) STATE.
    if (a.state == State::QUARANTINED) {
        reason = "QUARANTINED" +
                 (a.evidenceConflict.empty() ? std::string()
                                             : (": " + a.evidenceConflict));
        return Disposition::MUST_PIN;
    }
    if (a.state == State::HOT) {
        reason = "HOT — in active use";
        return Disposition::MUST_PIN;
    }
    if (a.state == State::PINNED)   { reason = "PINNED by policy";          return Disposition::MUST_PIN; }
    if (a.state == State::ROLLBACK) { reason = "ROLLBACK target retained";  return Disposition::MUST_PIN; }
    if (a.state == State::PURGED)   { reason = "already PURGED";            return Disposition::MUST_PIN; }

    // (3) LEASE.
    if (a.lease.held) {
        reason = "active lease held by " + (a.lease.holder.empty() ? std::string("<unnamed holder>")
                                                                   : a.lease.holder);
        return Disposition::MUST_PIN;
    }

    // (4) EVIDENCE CONFLICT anywhere -> hands off.
    if (!a.evidenceConflict.empty()) {
        reason = "conflicting evidence: " + a.evidenceConflict;
        return Disposition::MUST_PIN;
    }

    // (5) DIRTY WORKING TREE. YES pins. UNKNOWN does NOT pass.
    if (a.dirty == Tri::YES) {
        reason = "working tree is DIRTY — uncommitted work would be destroyed";
        return Disposition::MUST_PIN;
    }
    const bool gitBacked = (a.klass == ArtifactClass::WORKTREE ||
                            a.klass == ArtifactClass::WORKTREE_RECORD);
    if (gitBacked && a.dirty == Tri::UNKNOWN) {
        reason = "cleanliness UNPROVEN (git status did not answer) — keeping";
        return Disposition::NEEDS_PROOF;
    }

    // (6) COMMIT CONTAINMENT — the s21.3 trap lives here.
    if (gitBacked) {
        switch (a.containment) {
            case UnpushedEvidence::NOT_CONTAINED:
                reason = "holds commits reachable from no pushed ref" +
                         (a.containmentDetail.empty() ? std::string()
                                                      : (" (" + a.containmentDetail + ")"));
                return Disposition::MUST_PIN;
            case UnpushedEvidence::COMPARISON_REF_ABSENT:
                // The trap, named out loud instead of silently keeping for ever.
                reason = "the ref this would be compared against no longer exists" +
                         (a.containmentDetail.empty() ? std::string()
                                                      : (" (" + a.containmentDetail + ")")) +
                         " — containment cannot be proven from a deleted ref; "
                         "re-run with a surviving pushed ref, or prove the recorded "
                         "HEAD sha is an ancestor of one";
                return Disposition::NEEDS_PROOF;
            case UnpushedEvidence::PROBE_FAILED:
                reason = "git containment probe FAILED — a failed probe is not a clean bill";
                return Disposition::NEEDS_PROOF;
            case UnpushedEvidence::UNKNOWN:
                reason = "commit containment never probed";
                return Disposition::NEEDS_PROOF;
            case UnpushedEvidence::CONTAINED:
                break;  // proven; fall through
        }
    }

    // (7) REFERENCES. Something points at it -> not ours to remove.
    if (!a.references.empty()) {
        reason = "referenced by " + std::to_string(a.references.size()) +
                 " site(s), first: " + a.references.front();
        return Disposition::MUST_PIN;
    }

    // (8) SIZE MEASUREMENT. An unmeasured tree may hide anything.
    if (!a.sizeMeasured) {
        reason = "size walk did not complete (permission or race) — contents unknown";
        return Disposition::NEEDS_PROOF;
    }

    // (9) RECOVERY. Nothing is disposable unless we can say how to get it back.
    if (a.recovery.empty()) {
        reason = "no recovery method recorded — treat as irreproducible";
        return Disposition::NEEDS_PROOF;
    }

    // (10) RETENTION FLOOR.
    if (a.retentionDays > 0 && a.ageDays < a.retentionDays) {
        reason = "inside retention window (" + std::to_string(a.ageDays) + "d of " +
                 std::to_string(a.retentionDays) + "d)";
        return Disposition::NEEDS_PROOF;
    }

    // (11) Only a state the scanner explicitly promoted may be disposable.
    if (a.state == State::GC_CANDIDATE || a.state == State::ARCHIVED) {
        reason = "unreferenced, lease-free, clean, reproducible via `" + a.recovery +
                 "`; idle " + std::to_string(a.ageDays) + "d in root '" + rootId + "'";
        return Disposition::PROVABLY_DISPOSABLE;
    }
    if (a.state == State::WARM) {
        reason = "WARM — passed every safety check but was never promoted to "
                 "GC_CANDIDATE (not proven idle long enough)";
        return Disposition::NEEDS_PROOF;
    }

    // (12) TERMINAL FALLTHROUGH. Uncertain defaults to KEEP, by construction.
    reason = "no rule established disposability — default KEEP";
    return Disposition::NEEDS_PROOF;
}

// ═══════════════════════════════════════════════════════════════════════════
// Planner
// ═══════════════════════════════════════════════════════════════════════════

// Render a path relative to the plan's root when it is inside it, otherwise
// leave it whole (a path outside the root is exactly the case an operator must
// see in full).
static std::string rel(const fs::path& p, const fs::path& root) {
    if (root.empty()) return p.string();
    if (p == root) return ".";
    if (lexicallyInside(root, p)) {
        std::error_code ec;
        const fs::path r = fs::relative(p, root, ec);
        if (!ec && !r.empty()) return r.string();
    }
    return p.string();
}


Plan Planner::dryRun(const std::vector<Artifact>& artifacts,
                     std::uint64_t headroomBytesBefore,
                     std::uint64_t volumeCapacityBytes,
                     const fs::path& renderRoot) const {
    Plan p;
    p.renderRoot = renderRoot.empty() ? reg_.workspace() : resolveThroughLinks(renderRoot);
    p.headroomBytesBefore = headroomBytesBefore;
    p.volumeCapacityBytes = volumeCapacityBytes;

    for (const auto& a : artifacts) {
        std::string reason;
        const Disposition d = classify(a, reg_, reason);

        PlanEntry e;
        e.path = a.canonicalPath;
        e.bytes = a.bytes;
        e.disposition = d;
        e.state = a.state;
        e.klass = a.klass;
        e.reason = reason;
        for (const auto& n : a.notes) e.reason += " | note: " + n;
        e.recovery = a.recovery.empty() ? "UNKNOWN — no regeneration recipe" : a.recovery;
        e.rootId = reg_.owningRootId(a.canonicalPath);
        if (a.references.empty()) {
            e.referenceProof = "no referencer found in workspace text scan";
        } else {
            std::ostringstream os;
            for (std::size_t i = 0; i < a.references.size(); ++i) {
                if (i) os << "; ";
                os << a.references[i];
            }
            e.referenceProof = os.str();
        }
        if (e.rootId.empty())
            p.exclusions.push_back(rel(a.canonicalPath, p.renderRoot) +
                                   "  [EXCLUDED: outside every managed root]");

        switch (d) {
            case Disposition::PROVABLY_DISPOSABLE: p.disposableBytes += a.bytes; break;
            case Disposition::NEEDS_PROOF:         p.needsProofBytes += a.bytes; break;
            case Disposition::MUST_PIN:            p.mustPinBytes    += a.bytes; break;
        }
        p.entries.push_back(std::move(e));
    }

    // Projected headroom counts ONLY provably-disposable bytes. NEEDS_PROOF
    // bytes are deliberately absent: a projection that borrows against unproven
    // reclaims is how pressure turns into pressure to delete.
    p.headroomBytesAfter = p.headroomBytesBefore + p.disposableBytes;

    std::stable_sort(p.entries.begin(), p.entries.end(),
                     [](const PlanEntry& x, const PlanEntry& y) {
                         if (x.disposition != y.disposition)
                             return static_cast<int>(x.disposition) > static_cast<int>(y.disposition);
                         return x.bytes > y.bytes;
                     });
    return p;
}

static std::string gib(std::uint64_t bytes) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.3f GiB", static_cast<double>(bytes) / (1024.0 * 1024.0 * 1024.0));
    return buf;
}

std::string Planner::renderText(const Plan& p) {
    std::ostringstream o;
    o << "FORGE NATIVE STORAGE GOVERNOR — DRY RUN PLAN (s21.3)\n";
    o << "NOTHING IS DELETED BY THIS TOOL. This is a proposal with proofs.\n";
    o << "All paths are relative to the workspace root.\n";
    o << "======================================================================\n\n";

    const char* order[] = {"PROVABLY_DISPOSABLE", "NEEDS_PROOF", "MUST_PIN"};
    const Disposition ds[] = {Disposition::PROVABLY_DISPOSABLE, Disposition::NEEDS_PROOF,
                              Disposition::MUST_PIN};
    for (int k = 0; k < 3; ++k) {
        o << "--- " << order[k] << " ---\n";
        int n = 0;
        for (const auto& e : p.entries) {
            if (e.disposition != ds[k]) continue;
            ++n;
            o << "  path      : " << rel(e.path, p.renderRoot) << "\n";
            o << "  bytes     : " << e.bytes << "  (" << gib(e.bytes) << ")\n";
            o << "  class     : " << toString(e.klass) << "   state: " << toString(e.state)
              << "   root: " << (e.rootId.empty() ? "<none>" : e.rootId) << "\n";
            o << "  reason    : " << e.reason << "\n";
            o << "  refproof  : " << e.referenceProof << "\n";
            o << "  recovery  : " << e.recovery << "\n\n";
        }
        if (n == 0) o << "  (none)\n\n";
    }

    o << "--- EXCLUSIONS (refused authority) ---\n";
    if (p.exclusions.empty()) o << "  (none)\n";
    for (const auto& x : p.exclusions) o << "  " << x << "\n";

    o << "\n--- TOTALS ---\n";
    o << "  provably disposable : " << gib(p.disposableBytes) << "  (" << p.disposableBytes << " B)\n";
    o << "  needs proof         : " << gib(p.needsProofBytes) << "  (" << p.needsProofBytes << " B)\n";
    o << "  must pin            : " << gib(p.mustPinBytes)    << "  (" << p.mustPinBytes    << " B)\n";
    o << "  headroom before     : " << gib(p.headroomBytesBefore) << "\n";
    o << "  headroom projected  : " << gib(p.headroomBytesAfter)
      << "   (disposable bytes ONLY; unproven bytes are never projected)\n";
    return o.str();
}

static std::string jesc(const std::string& s) {
    std::string o;
    o.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
            case '"':  o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n";  break;
            case '\r': o += "\\r";  break;
            case '\t': o += "\\t";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) { o += ' '; }
                else o += c;
        }
    }
    return o;
}

std::string Planner::renderJson(const Plan& p) {
    std::ostringstream o;
    o << "{\n  \"tool\": \"forge::native::storage governor\",\n";
    o << "  \"mode\": \"dry-run\",\n  \"deletes_performed\": 0,\n";
    o << "  \"totals\": {\n";
    o << "    \"provably_disposable_bytes\": " << p.disposableBytes << ",\n";
    o << "    \"needs_proof_bytes\": " << p.needsProofBytes << ",\n";
    o << "    \"must_pin_bytes\": " << p.mustPinBytes << ",\n";
    o << "    \"headroom_before_bytes\": " << p.headroomBytesBefore << ",\n";
    o << "    \"headroom_projected_bytes\": " << p.headroomBytesAfter << ",\n";
    o << "    \"volume_capacity_bytes\": " << p.volumeCapacityBytes << "\n  },\n";
    o << "  \"entries\": [\n";
    for (std::size_t i = 0; i < p.entries.size(); ++i) {
        const auto& e = p.entries[i];
        o << "    {\"path\": \"" << jesc(rel(e.path, p.renderRoot)) << "\""
          << ", \"bytes\": " << e.bytes
          << ", \"disposition\": \"" << toString(e.disposition) << "\""
          << ", \"class\": \"" << toString(e.klass) << "\""
          << ", \"state\": \"" << toString(e.state) << "\""
          << ", \"root\": \"" << jesc(e.rootId) << "\""
          << ", \"reason\": \"" << jesc(e.reason) << "\""
          << ", \"reference_proof\": \"" << jesc(e.referenceProof) << "\""
          << ", \"recovery\": \"" << jesc(e.recovery) << "\"}"
          << (i + 1 < p.entries.size() ? "," : "") << "\n";
    }
    o << "  ],\n  \"exclusions\": [\n";
    for (std::size_t i = 0; i < p.exclusions.size(); ++i)
        o << "    \"" << jesc(p.exclusions[i]) << "\""
          << (i + 1 < p.exclusions.size() ? "," : "") << "\n";
    o << "  ]\n}\n";
    return o.str();
}

// ═══════════════════════════════════════════════════════════════════════════
// Filesystem helpers
// ═══════════════════════════════════════════════════════════════════════════

std::uint64_t directorySize(const fs::path& p, bool& complete) {
    complete = true;
    std::error_code ec;
    if (!fs::exists(p, ec) || ec) { complete = false; return 0; }
    if (fs::is_regular_file(fs::symlink_status(p, ec)) && !ec) {
        auto s = fs::file_size(p, ec);
        if (ec) { complete = false; return 0; }
        return static_cast<std::uint64_t>(s);
    }
    std::uint64_t total = 0;
    fs::recursive_directory_iterator it(p, fs::directory_options::skip_permission_denied, ec);
    if (ec) { complete = false; return 0; }
    fs::recursive_directory_iterator end;
    for (; it != end; it.increment(ec)) {
        if (ec) { complete = false; ec.clear(); continue; }
        std::error_code e2;
        const auto st = it->symlink_status(e2);
        if (e2) { complete = false; continue; }
        if (fs::is_symlink(st)) continue;      // never follow, never count the target
        if (!fs::is_regular_file(st)) continue;
        const auto sz = it->file_size(e2);
        if (e2) { complete = false; continue; }
        total += static_cast<std::uint64_t>(sz);
    }
    return total;
}

std::string structuralHash(const fs::path& p, std::size_t cap) {
    std::uint64_t h = 1469598103934665603ULL;  // FNV-1a offset basis
    auto mix = [&h](const std::string& s) {
        for (unsigned char c : s) { h ^= c; h *= 1099511628211ULL; }
    };
    std::error_code ec;
    if (!fs::exists(p, ec) || ec) return "0000000000000000";
    std::size_t n = 0;
    fs::recursive_directory_iterator it(p, fs::directory_options::skip_permission_denied, ec);
    fs::recursive_directory_iterator end;
    if (ec) { mix(p.string()); }
    else {
        for (; it != end && n < cap; it.increment(ec), ++n) {
            if (ec) { ec.clear(); continue; }
            std::error_code e2;
            mix(fs::relative(it->path(), p, e2).string());
            const auto st = it->symlink_status(e2);
            if (!e2 && fs::is_regular_file(st)) {
                const auto sz = it->file_size(e2);
                if (!e2) mix(std::to_string(static_cast<std::uint64_t>(sz)));
            }
        }
    }
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(h));
    return buf;
}

static std::uint32_t ageDaysOf(const fs::path& p) {
    std::error_code ec;
    const auto t = fs::last_write_time(p, ec);
    if (ec) return 0;
    const auto now = fs::file_time_type::clock::now();
    const auto d = std::chrono::duration_cast<std::chrono::hours>(now - t).count() / 24;
    return d < 0 ? 0u : static_cast<std::uint32_t>(d);
}

// Newest mtime among files matching a suffix, as an age in days; -1 if none.
static long newestSuffixAgeDays(const fs::path& root, const std::string& suffix) {
    std::error_code ec;
    long best = -1;
    fs::recursive_directory_iterator it(root, fs::directory_options::skip_permission_denied, ec);
    fs::recursive_directory_iterator end;
    if (ec) return -1;
    for (; it != end; it.increment(ec)) {
        if (ec) { ec.clear(); continue; }
        const std::string s = it->path().filename().string();
        if (s.size() < suffix.size()) continue;
        if (s.compare(s.size() - suffix.size(), suffix.size(), suffix) != 0) continue;
        const long a = static_cast<long>(ageDaysOf(it->path()));
        if (best < 0 || a < best) best = a;
    }
    return best;
}

// Lease-holder liveness. A lock file that names a pid is only a lease while
// that pid is alive. `kill(pid, 0)` answers definitively in the safe direction:
// ESRCH means gone; anything else (including EPERM — exists, other user) is
// treated as ALIVE, so pid reuse can only ever make us keep more.
//
// Returns: 1 alive, 0 provably gone, -1 no pid in the text.
static int leaseHolderAlive(const std::string& lockText) {
    const std::string tag = "(pid ";
    const auto at = lockText.find(tag);
    if (at == std::string::npos) return -1;
    std::size_t i = at + tag.size();
    std::string digits;
    while (i < lockText.size() && lockText[i] >= '0' && lockText[i] <= '9') digits += lockText[i++];
    if (digits.empty()) return -1;
    long pid = 0;
    try { pid = std::stol(digits); } catch (...) { return -1; }
    if (pid <= 0) return -1;
    errno = 0;
    if (::kill(static_cast<pid_t>(pid), 0) == 0) return 1;
    return (errno == ESRCH) ? 0 : 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// RealGitProbe — read-only git subcommands via popen
// ═══════════════════════════════════════════════════════════════════════════

static bool runCapture(const std::string& cmd, std::string& out, int& rc) {
    out.clear();
    std::FILE* f = ::popen((cmd + " 2>/dev/null").c_str(), "r");
    if (!f) { rc = -1; return false; }
    std::array<char, 4096> buf{};
    while (std::fgets(buf.data(), static_cast<int>(buf.size()), f)) out += buf.data();
    const int st = ::pclose(f);
    rc = (st == -1) ? -1 : ((st & 0x7f) ? 128 + (st & 0x7f) : ((st >> 8) & 0xff));
    return rc == 0;
}

static std::string shq(const std::string& s) {
    std::string o = "'";
    for (char c : s) { if (c == '\'') o += "'\\''"; else o += c; }
    o += "'";
    return o;
}

bool RealGitProbe::statusPorcelain(const fs::path& worktree, std::string& out) const {
    int rc = 0;
    return runCapture("git -C " + shq(worktree.string()) + " status --porcelain", out, rc);
}

bool RealGitProbe::refExists(const fs::path& repo, const std::string& ref) const {
    std::string o; int rc = 0;
    return runCapture("git -C " + shq(repo.string()) + " rev-parse --verify --quiet " + shq(ref),
                      o, rc) && !o.empty();
}

bool RealGitProbe::countUnreachable(const fs::path& repo, const std::string& fromRef,
                                    const std::string& toRef, std::uint64_t& count) const {
    std::string o; int rc = 0;
    if (!runCapture("git -C " + shq(repo.string()) + " rev-list --count " +
                    shq(fromRef + ".." + toRef), o, rc)) return false;
    try { count = static_cast<std::uint64_t>(std::stoull(o)); }
    catch (...) { return false; }
    return true;
}

bool RealGitProbe::isAncestor(const fs::path& repo, const std::string& sha,
                              const std::string& ofRef) const {
    std::string o; int rc = 0;
    runCapture("git -C " + shq(repo.string()) + " merge-base --is-ancestor " + shq(sha) +
               " " + shq(ofRef), o, rc);
    return rc == 0;
}

bool RealGitProbe::resolve(const fs::path& repo, const std::string& rev, std::string& sha) const {
    std::string o; int rc = 0;
    if (!runCapture("git -C " + shq(repo.string()) + " rev-parse --verify --quiet " + shq(rev),
                    o, rc)) return false;
    while (!o.empty() && (o.back() == '\n' || o.back() == '\r')) o.pop_back();
    sha = o;
    return !sha.empty();
}

// ═══════════════════════════════════════════════════════════════════════════
// Scanner
// ═══════════════════════════════════════════════════════════════════════════

bool Scanner::isNonReferencingSite(const std::string& hitLine) {
    // hitLine is "path:line:text". Judge on the PATH only.
    const auto colon = hitLine.find(':');
    const std::string path = (colon == std::string::npos) ? hitLine : hitLine.substr(0, colon);
    auto endsWith = [&](const char* suf) {
        const std::string t(suf);
        return path.size() >= t.size() && path.compare(path.size() - t.size(), t.size(), t) == 0;
    };
    if (endsWith(".gitignore")) return true;     // "do not track" is not "depends on"
    if (endsWith(".npmignore") || endsWith(".dockerignore") || endsWith(".eslintignore"))
        return true;
    if (path.rfind(".git/", 0) == 0) return true;
    if (path.find("/.git/") != std::string::npos) return true;

    // The governor's OWN output and source are a record ABOUT artifacts, not a
    // user OF them. Without this the tool poisons itself the moment its plan is
    // committed: reports/storage_plan.txt names every build tree it examined,
    // so the NEXT scan would find each tree "referenced" — by the very document
    // that proposed reclaiming it — and pin the whole repo for ever, with a
    // reason that reads plausible and is circular.
    const auto slash = path.find_last_of('/');
    const std::string base = (slash == std::string::npos) ? path : path.substr(slash + 1);
    if (base.rfind("storage_plan.", 0) == 0) return true;
    if (base == "storage_govern_main.cpp") return true;
    if (path.find("native/storage/") != std::string::npos) return true;
    return false;
}

std::vector<std::string> Scanner::findReferencers(const std::vector<std::string>& needles,
                                                  std::size_t maxHits) const {
    // `git grep` only sees TRACKED files, which is exactly right: a reference
    // from a tracked script is a durable claim on the artifact.
    std::vector<std::string> hits;
    for (const auto& needle : needles) {
        if (needle.empty()) continue;
        std::string out; int rc = 0;
        runCapture("git -C " + shq(cfg_.workspace.string()) +
                   " grep -n --fixed-strings -I -- " + shq(needle),
                   out, rc);
        std::istringstream is(out);
        std::string line;
        while (std::getline(is, line)) {
            if (line.empty()) continue;
            if (isNonReferencingSite(line)) continue;
            if (line.size() > 200) line = line.substr(0, 200) + "...";
            if (std::find(hits.begin(), hits.end(), line) != hits.end()) continue;
            hits.push_back(line);
            if (hits.size() >= maxHits) return hits;
        }
    }
    return hits;
}

void Scanner::scanBuildTrees(const fs::path& parent, std::vector<Artifact>& out) const {
    std::error_code ec;
    if (!fs::is_directory(parent, ec) || ec) return;
    std::vector<fs::path> dirs;
    for (fs::directory_iterator it(parent, ec), end; it != end && !ec; it.increment(ec)) {
        const std::string name = it->path().filename().string();
        if (name.rfind("build", 0) != 0) continue;
        std::error_code e2;
        if (!fs::is_directory(it->path(), e2) || e2) continue;
        dirs.push_back(it->path());
    }
    std::sort(dirs.begin(), dirs.end());

    for (const auto& d : dirs) {
        Artifact a;
        a.id = "buildtree:" + d.filename().string();
        a.klass = ArtifactClass::BUILD_TREE;
        a.canonicalPath = resolveThroughLinks(d);
        bool complete = false;
        a.bytes = directorySize(d, complete);
        a.sizeMeasured = complete;
        a.contentHash = "struct:" + structuralHash(d);
        a.producer = "cmake / cmake-js (forge-kernel/CMakeLists.txt)";
        a.owner = "forge-kernel";
        a.ageDays = ageDaysOf(d);
        a.recovery = "cd forge-kernel && cmake -S . -B " + d.filename().string() +
                     " && cmake --build " + d.filename().string() + " -j";
        a.retentionDays = 0;

        // Reference proof: a tracked file naming this tree, by qualified path
        // OR by bare directory name. The bare name is skipped only for the
        // generic "build", where it would match thousands of unrelated lines;
        // that tree is identified by its qualified path instead.
        const std::string dname = d.filename().string();
        std::vector<std::string> needles = {"forge-kernel/" + dname};
        if (dname != "build") needles.push_back(dname);
        a.references = findReferencers(needles);

        // HOT detection: a linked loadable binary younger than the hot window.
        const long nodeAge = newestSuffixAgeDays(d, ".node");
        const long dylibAge = newestSuffixAgeDays(d, ".dylib");
        long liveAge = -1;
        if (nodeAge >= 0) liveAge = nodeAge;
        if (dylibAge >= 0 && (liveAge < 0 || dylibAge < liveAge)) liveAge = dylibAge;

        if (liveAge >= 0 && liveAge <= static_cast<long>(cfg_.hotWindowDays)) {
            a.state = State::HOT;
            a.references.push_back("live linked binary in tree, age " +
                                   std::to_string(liveAge) + "d <= hot window " +
                                   std::to_string(cfg_.hotWindowDays) + "d");
        } else if (!a.references.empty()) {
            a.state = State::WARM;
        } else if (a.ageDays >= cfg_.staleDays && a.sizeMeasured) {
            a.state = State::GC_CANDIDATE;
        } else {
            a.state = State::WARM;
        }
        // A build tree carries no commits; its git evidence is not applicable,
        // and classify() only consults it for git-backed classes.
        out.push_back(std::move(a));
    }
}

void Scanner::scanDependencyTrees(std::vector<Artifact>& out) const {
    // Depth-limited: node_modules nests, and only the TOP of each nest is an
    // artifact. Walking into one would double-count and take minutes.
    std::vector<fs::path> found;
    std::error_code ec;
    std::function<void(const fs::path&, int)> walk = [&](const fs::path& dir, int depth) {
        if (depth > 3) return;
        std::error_code e;
        for (fs::directory_iterator it(dir, fs::directory_options::skip_permission_denied, e), end;
             it != end && !e; it.increment(e)) {
            std::error_code e2;
            const auto st = it->symlink_status(e2);
            if (e2 || fs::is_symlink(st) || !fs::is_directory(st)) continue;
            const std::string name = it->path().filename().string();
            if (name == "node_modules") { found.push_back(it->path()); continue; }  // do not descend
            if (name == ".git") continue;
            walk(it->path(), depth + 1);
        }
    };
    walk(cfg_.workspace, 0);
    std::sort(found.begin(), found.end());

    for (const auto& d : found) {
        Artifact a;
        a.id = "deps:" + fs::relative(d, cfg_.workspace, ec).string();
        a.klass = ArtifactClass::DEPENDENCY_TREE;
        a.canonicalPath = resolveThroughLinks(d);
        bool complete = false;
        a.bytes = directorySize(d, complete);
        a.sizeMeasured = complete;
        a.contentHash = "struct:" + structuralHash(d, 2048);
        a.producer = "npm install";
        a.owner = d.parent_path().filename().string();
        a.ageDays = ageDaysOf(d);
        a.recovery = "cd " + fs::relative(d.parent_path(), cfg_.workspace, ec).string() +
                     " && npm ci";
        // The live kernel build links against these. Consuming build tree HOT
        // => this is HOT too. Detect by a sibling/ancestor build tree holding a
        // fresh binary.
        const fs::path kbuild = cfg_.workspace / "forge-kernel" / "build";
        const long kAge = newestSuffixAgeDays(kbuild, ".node");
        if (kAge >= 0 && kAge <= static_cast<long>(cfg_.hotWindowDays)) {
            a.state = State::HOT;
            a.references.push_back("forge-kernel/build holds a binary linked " +
                                   std::to_string(kAge) + "d ago; the kernel build needs these deps");
        } else {
            a.state = State::WARM;
        }
        out.push_back(std::move(a));
    }
}

void Scanner::scanWorktreeRecords(std::vector<Artifact>& out) const {
    const fs::path wtDir = cfg_.workspace / ".git" / "worktrees";
    std::error_code ec;
    if (!fs::is_directory(wtDir, ec) || ec) return;

    const bool pushedRefExists = git_.refExists(cfg_.workspace, cfg_.pushedRef);

    std::vector<fs::path> recs;
    for (fs::directory_iterator it(wtDir, ec), end; it != end && !ec; it.increment(ec))
        recs.push_back(it->path());
    std::sort(recs.begin(), recs.end());

    for (const auto& rec : recs) {
        const std::string name = rec.filename().string();
        Artifact a;
        a.id = "wtrecord:" + name;
        a.klass = ArtifactClass::WORKTREE_RECORD;
        a.canonicalPath = resolveThroughLinks(rec);
        bool complete = false;
        a.bytes = directorySize(rec, complete);
        a.sizeMeasured = complete;
        a.contentHash = "struct:" + structuralHash(rec, 256);
        a.producer = "git worktree add";
        a.owner = name;
        a.ageDays = ageDaysOf(rec);
        a.recovery = "git worktree add <path> " + std::string("refs/heads/worktree-") + name +
                     "   (record is re-created from the branch; `git worktree prune` removes it)";

        // Where the checkout should be.
        fs::path checkout;
        {
            std::ifstream f(rec / "gitdir");
            std::string line;
            if (std::getline(f, line)) {
                while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
                checkout = fs::path(line).parent_path();
            }
        }
        const bool dirExists = !checkout.empty() && fs::exists(checkout, ec) && !ec;

        // A `locked` file means git itself was told to protect it.
        std::string lockReason;
        {
            std::ifstream f(rec / "locked");
            std::getline(f, lockReason);
        }

        if (dirExists) {
            // A REAL checkout — this is a live session artifact, never a candidate.
            a.klass = ArtifactClass::SESSION_ARTIFACT;
            a.lease.held = true;
            // Relative spelling: a plan is committed as evidence and must not
            // carry the operator's absolute home path.
            const std::string co = rel(resolveThroughLinks(checkout), cfg_.workspace);
            a.lease.holder = lockReason.empty() ? ("checkout present at " + co) : lockReason;
            a.state = State::HOT;
            a.references.push_back("checkout exists on disk: " + co);
            std::string porc;
            if (git_.statusPorcelain(checkout, porc)) a.dirty = porc.empty() ? Tri::NO : Tri::YES;
            out.push_back(std::move(a));
            continue;
        }

        // PHANTOM: record present, checkout gone.
        // Dirtiness: with no working tree there is nothing to be dirty. That is
        // a PROVEN NO, not an unknown — and it is the only place we may say so.
        a.dirty = Tri::NO;

        // ── the s21.3 trap ───────────────────────────────────────────────────
        const std::string branch = "refs/heads/worktree-" + name;

        // The record's OWN memory of where it was. Three sources, in order of
        // directness. This matters: a worktree record's HEAD is almost always
        // SYMBOLIC ("ref: refs/heads/worktree-x"), so when the branch is gone
        // the HEAD file alone resolves to nothing and the deleted-ref fallback
        // has no sha to work with — which is precisely how the s21.3 trap keeps
        // a merged worktree for ever. The per-worktree reflog survives the
        // branch deletion and still names the commit.
        std::string headSha;
        auto readFirstLine = [](const fs::path& p) {
            std::ifstream f(p);
            std::string line;
            std::getline(f, line);
            while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
            return line;
        };
        {
            const std::string h = readFirstLine(rec / "HEAD");
            if (!h.empty() && h.rfind("ref: ", 0) != 0) headSha = h;   // detached HEAD
        }
        if (headSha.empty()) {
            // logs/HEAD: "<old-sha> <new-sha> <who> <when>\t<message>"; the LAST
            // line's new-sha is where this worktree finished.
            std::ifstream f(rec / "logs" / "HEAD");
            std::string line, last;
            while (std::getline(f, line)) if (!line.empty()) last = line;
            if (!last.empty()) {
                std::istringstream ls(last);
                std::string oldSha, newSha;
                ls >> oldSha >> newSha;
                if (newSha.size() >= 7) headSha = newSha;
            }
        }
        if (headSha.empty()) headSha = readFirstLine(rec / "ORIG_HEAD");
        if (headSha.size() < 7) headSha.clear();
        if (!pushedRefExists) {
            a.containment = UnpushedEvidence::COMPARISON_REF_ABSENT;
            a.containmentDetail = "pushed ref '" + cfg_.pushedRef + "' does not exist";
        } else if (git_.refExists(cfg_.workspace, branch)) {
            std::uint64_t n = 0;
            if (git_.countUnreachable(cfg_.workspace, cfg_.pushedRef, branch, n)) {
                a.containment = (n == 0) ? UnpushedEvidence::CONTAINED
                                         : UnpushedEvidence::NOT_CONTAINED;
                a.containmentDetail = std::to_string(n) + " commit(s) on " + branch +
                                      " not reachable from " + cfg_.pushedRef;
            } else {
                a.containment = UnpushedEvidence::PROBE_FAILED;
                a.containmentDetail = "rev-list " + cfg_.pushedRef + ".." + branch + " failed";
            }
        } else {
            // THE TRAP: the branch this record belongs to is GONE (merged and
            // deleted, or pruned). The naive check errors and the record is
            // kept for ever with no explanation. Fall back to the record's own
            // recorded HEAD sha and ask the containment question directly.
            if (headSha.empty()) git_.resolve(cfg_.workspace, branch, headSha);
            if (!headSha.empty() && git_.isAncestor(cfg_.workspace, headSha, cfg_.pushedRef)) {
                a.containment = UnpushedEvidence::CONTAINED;
                a.containmentDetail = "branch " + branch + " is GONE, but the record's recorded "
                                      "HEAD " + headSha.substr(0, 12) + " IS an ancestor of " +
                                      cfg_.pushedRef + " — containment proven without the branch";
            } else {
                a.containment = UnpushedEvidence::COMPARISON_REF_ABSENT;
                a.containmentDetail = "branch " + branch + " is GONE and the record's HEAD (" +
                                      (headSha.empty() ? "unreadable" : headSha.substr(0, 12)) +
                                      ") could not be proven an ancestor of " + cfg_.pushedRef;
            }
        }

        a.references.clear();
        // The containment EVIDENCE must reach the plan whatever the verdict.
        // A disposable row that cannot show how containment was established is
        // as unreviewable as a KEEP that cannot say why.
        a.notes.push_back(std::string("containment=") + toString(a.containment) +
                          (a.containmentDetail.empty() ? std::string()
                                                       : (" (" + a.containmentDetail + ")")));
        a.state = (a.containment == UnpushedEvidence::CONTAINED) ? State::GC_CANDIDATE
                                                                 : State::WARM;
        if (!lockReason.empty()) {
            // git says LOCKED but the checkout is gone. Resolve the conflict by
            // PROVING the named lease holder is dead — never by assuming it.
            const int alive = leaseHolderAlive(lockReason);
            if (alive == 1) {
                a.lease.held = true;
                a.lease.holder = lockReason + " [process ALIVE]";
                a.state = State::HOT;
            } else if (alive == 0) {
                // A lock whose holder is provably gone is not a lease. Record
                // the finding; it does not pin, but the plan must SAY it.
                a.notes.push_back("git lock \"" + lockReason +
                                  "\" is STALE: named pid does not exist (kill(pid,0)=ESRCH)");
            } else {
                // Locked by something we cannot identify -> conflict, hands off.
                a.evidenceConflict = "record is git-LOCKED (\"" + lockReason +
                                     "\") with no identifiable holder, yet its checkout "
                                     "directory is absent";
                a.state = State::QUARANTINED;
            }
        }
        out.push_back(std::move(a));
    }
}

std::vector<Artifact> Scanner::scanAll() const {
    std::vector<Artifact> v;
    scanBuildTrees(cfg_.workspace / "forge-kernel", v);
    scanDependencyTrees(v);
    scanWorktreeRecords(v);
    return v;
}

}  // namespace forge::native::storage
