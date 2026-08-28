// forge/native/storage/StorageGovernor.hpp
//
// NATIVE STORAGE GOVERNOR — Sacrosanct s21.3.
//
// Pure C++20, no OCCT, no npm, no external dependency. Builds and runs under
// forge-kernel/test/native/run_native.sh like every other forge::native module.
//
// WHAT THIS IS
//   A *planner*. It decides what MAY be reclaimed and proves why. It contains
//   NO unlink, NO remove, NO rename, NO truncate — not one destructive call.
//   The only output is a Plan: a list of (path, bytes, disposition, reason,
//   reference proof, recovery method) rows plus an exclusion ledger.
//
// THE INVERSION THAT MAKES IT SAFE
//   A normal cleanup asks "may I delete this?" and deletes when it finds no
//   objection. This one asks "can I PROVE this is disposable?" and keeps when
//   the proof is missing. Every rung of classify() that cannot establish a fact
//   returns NEEDS_PROOF; the terminal fallthrough is NEEDS_PROOF, never
//   PROVABLY_DISPOSABLE. Disk pressure is not an input to classify() at all —
//   it cannot be, because classify() never sees it.
//
// THE KNOWN TRAP (s21.3, explicitly handled — see UnpushedEvidence)
//   A merged worktree is kept for ever because its unpushed-check compares
//   against a ref that merging just deleted: `rev-list origin/X..refs/heads/Y`
//   with Y gone errors out, the caller reads "not proven pushed", and the thing
//   is kept for ever with nobody able to say why. Here the *absence of the
//   comparison ref is itself a distinct, reportable evidence state*
//   (COMPARISON_REF_ABSENT) with a documented fallback: resolve the record's
//   own recorded HEAD sha and ask whether that sha is an ancestor of a pushed
//   ref. If it is, containment is PROVEN and the reason says so. If the sha is
//   unresolvable too, the row is NEEDS_PROOF and prints exactly which ref went
//   missing. A KEEP always says WHY.

#ifndef FORGE_NATIVE_STORAGE_STORAGE_GOVERNOR_HPP
#define FORGE_NATIVE_STORAGE_STORAGE_GOVERNOR_HPP

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <limits>
#include <map>
#include <string>
#include <vector>

namespace forge::native::storage {

namespace fs = std::filesystem;

// ───────────────────────────────────────────────────────────────────────────
// 1. Managed-root registry
// ───────────────────────────────────────────────────────────────────────────

// Why a root was refused. OK is the only value that grants any authority.
enum class RootVerdict {
    OK = 0,
    EMPTY,                 // ""
    NOT_ABSOLUTE,          // relative path — resolution depends on cwd
    UNRESOLVED_VARIABLE,   // contains $VAR, ${VAR}, ~ , %VAR%
    IS_FILESYSTEM_ROOT,    // "/" or a volume root
    IS_HOME_DIRECTORY,     // $HOME itself
    IS_WORKSPACE_ROOT,     // the repo/workspace root itself
    ANCESTOR_OF_WORKSPACE, // a parent of the workspace ("/Users/x/..")
    OUTSIDE_WORKSPACE,     // lexically not under the workspace
    SYMLINK_ESCAPE,        // resolves, via a link, to somewhere outside
    NOT_A_DIRECTORY        // missing, or a file
};

const char* toString(RootVerdict v);

struct ManagedRoot {
    std::string id;
    fs::path declared;   // as registered
    fs::path canonical;  // fully resolved
};

// Deletion authority is restricted to roots that survive registerRoot().
// Registration is the ONLY way a path enters authority; there is no wildcard,
// no "and everything under the workspace", no implicit root.
class ManagedRootRegistry {
public:
    // `workspace` is the repo root; `home` is the user's home directory. Both
    // are injected rather than read from the environment so the safety tests
    // can exercise the HOME and "/" rejections without touching a real home.
    ManagedRootRegistry(fs::path workspace, fs::path home);

    // Registers `p` under `id`. Returns OK and stores the root, or a verdict
    // naming the reason and stores nothing.
    RootVerdict registerRoot(const std::string& id, const fs::path& p);

    // Same checks WITHOUT storing — used by the tests and by callers that want
    // to explain a refusal.
    RootVerdict evaluate(const fs::path& p) const;

    // True iff `p` resolves (through every symlink on the way) to a location
    // inside a registered root. A path that is lexically inside a root but
    // resolves outside it returns FALSE — that is the symlink-escape guard on
    // the read side, mirroring SYMLINK_ESCAPE on the registration side.
    bool contains(const fs::path& p) const;

    // The root that contains `p`, or "" when none does.
    std::string owningRootId(const fs::path& p) const;

    const std::vector<ManagedRoot>& roots() const { return roots_; }
    const fs::path& workspace() const { return workspace_; }

private:
    fs::path workspace_;          // fully resolved
    fs::path workspaceDeclared_;  // as handed to us (may route through a link)
    fs::path home_;               // fully resolved
    std::vector<ManagedRoot> roots_;
};

// Resolve every symlink component that exists, keeping the non-existent tail
// lexically. Never throws. This is the primitive the escape guard rests on.
fs::path resolveThroughLinks(const fs::path& p);

// Lexical containment of `child` inside `parent` after normalisation.
// Guards against the "/a/bc is inside /a/b" prefix-string bug.
bool lexicallyInside(const fs::path& parent, const fs::path& child);

// ───────────────────────────────────────────────────────────────────────────
// 2. Artifact model
// ───────────────────────────────────────────────────────────────────────────

enum class ArtifactClass {
    UNKNOWN = 0,        // <- default; UNKNOWN is never disposable
    BUILD_TREE,         // CMake/cmake-js output
    DEPENDENCY_TREE,    // node_modules and friends
    WORKTREE,           // a git worktree checkout on disk
    WORKTREE_RECORD,    // .git/worktrees/<name> administrative record
    CACHE,
    LOG,
    DATASET,            // may be irreproducible -> never auto-disposable
    MODEL,              // active or rollback weights
    EVAL_HOLDOUT,
    NORMATIVE_DOCUMENT,
    PROVENANCE_RECORD,  // includes deletion records: never delete the receipts
    SESSION_ARTIFACT,   // live agent/session scratch
    FAILURE_REPRODUCER,
    USER_PROJECT
};

const char* toString(ArtifactClass c);

// Classes that are NEVER auto-disposable regardless of any other evidence.
bool isAlwaysPinnedClass(ArtifactClass c);

// Lifecycle state machine.
//
//              ┌──────────────── lease taken / referenced ─────────────┐
//              v                                                       │
//   (scan) → WARM ──stale+unreferenced──> GC_CANDIDATE ──proof ok──> PURGED
//              │  ^                             │
//              │  └──────── reference found ────┘
//              ├──live binary / open lease──> HOT
//              ├──operator pin──────────────> PINNED
//              ├──previous good version─────> ROLLBACK
//              ├──cold copy retained────────> ARCHIVED
//              └──evidence conflict─────────> QUARANTINED
//
// Only GC_CANDIDATE can reach PURGED, and only through a Plan a human ran.
// This module never emits PURGED — it is the state a future executor would
// write into a provenance record after acting on a plan.
enum class State {
    HOT = 0,        // in active use right now
    WARM,           // recently useful, not proven idle
    PINNED,         // explicitly protected
    ROLLBACK,       // retained to roll back to
    ARCHIVED,       // cold, retained by policy
    GC_CANDIDATE,   // proven idle and reproducible
    QUARANTINED,    // evidence conflicts — hands off, needs a human
    PURGED          // terminal, recorded by the executor, never by the planner
};

const char* toString(State s);
bool isTerminal(State s);
// The state machine's legal edges. An illegal transition is a bug, not a
// judgement call, so it is testable.
bool isLegalTransition(State from, State to);

struct Lease {
    bool held = false;
    std::string holder;   // pid / session / agent id
};

// Liveness of the process named in a git `locked` file, e.g.
// "claude agent worktree-x (pid 8412)".
//
// A lock is only a LEASE while its holder is alive. Deciding that requires two
// independent proofs (s21.3): the checkout directory is absent AND the pid is
// dead. This answers the second half, and it answers in the SAFE direction:
// only ESRCH ("no such process") counts as gone. EPERM — the pid exists but
// belongs to another user — counts as ALIVE, so pid reuse can only ever make
// the governor keep MORE, never delete more.
//
// Uses kill(pid, 0), never a pgrep-style command-line match: pgrep -f would
// match the checking process itself and report every dead holder as alive.
//
// Returns: 1 = alive (or existence unprovable), 0 = provably gone (ESRCH),
//         -1 = the text names no pid at all (an unidentifiable holder).
int lockHolderLiveness(const std::string& lockText);

// Tri-state evidence. UNKNOWN is not "false" — that conflation is the entire
// bug class this module exists to prevent.
enum class Tri { UNKNOWN = 0, NO, YES };

// How the pushed-containment question came out. Distinguishing
// COMPARISON_REF_ABSENT from NOT_CONTAINED is the fix for the s21.3 trap.
enum class UnpushedEvidence {
    UNKNOWN = 0,            // not probed
    COMPARISON_REF_ABSENT,  // the ref we would diff against no longer exists
    CONTAINED,              // every commit is reachable from a pushed ref
    NOT_CONTAINED,          // unique commits exist -> MUST_PIN
    PROBE_FAILED            // git errored -> treat as unknown, never as clean
};

const char* toString(UnpushedEvidence e);

struct Artifact {
    std::string   id;
    ArtifactClass klass = ArtifactClass::UNKNOWN;
    fs::path      canonicalPath;
    std::uint64_t bytes = 0;
    std::string   contentHash;      // structural digest (path,size,mtime fold)
    std::string   producer;         // what created it
    std::string   owner;            // who is accountable for it
    std::vector<std::string> references;  // concrete referencing sites found
    Lease         lease;
    State         state = State::WARM;
    std::uint32_t retentionDays = 0;     // 0 = no retention floor declared
    std::uint32_t ageDays = 0;
    std::string   recovery;         // exact command that regenerates it; empty = irreproducible

    // Evidence
    Tri              dirty      = Tri::UNKNOWN;  // working tree modified?
    UnpushedEvidence containment = UnpushedEvidence::UNKNOWN;
    std::string      containmentDetail;          // e.g. which ref went missing
    bool             sizeMeasured = false;       // false => bytes is a guess

    // Set by the scanner when two probes disagree (e.g. "stale" by mtime but a
    // live lease). Forces QUARANTINED.
    std::string evidenceConflict;

    // Free-form findings the scanner wants carried into the plan's reason —
    // e.g. "the git lock naming pid N is stale, N does not exist". Notes are
    // EVIDENCE, not authority: they are printed, never consulted by classify().
    std::vector<std::string> notes;
};

// ───────────────────────────────────────────────────────────────────────────
// 3. Planner
// ───────────────────────────────────────────────────────────────────────────

enum class Disposition {
    MUST_PIN = 0,          // protected; never a candidate
    NEEDS_PROOF,           // might be disposable, but a fact is missing
    PROVABLY_DISPOSABLE    // idle, unreferenced, reproducible, in-authority
};

const char* toString(Disposition d);

struct PlanEntry {
    fs::path      path;
    std::uint64_t bytes = 0;
    Disposition   disposition = Disposition::NEEDS_PROOF;
    State         state = State::WARM;
    ArtifactClass klass = ArtifactClass::UNKNOWN;
    std::string   reason;           // WHY this disposition — always non-empty
    std::string   referenceProof;   // who points at it, or "no referencer found"
    std::string   recovery;         // how to get it back
    std::string   rootId;           // owning managed root, or "" if none
};

struct Plan {
    // Paths are rendered RELATIVE to this root, with the root printed once in
    // the header. A committed plan must not carry machine-absolute paths: they
    // are noise on another machine and leak the operator's home directory.
    fs::path renderRoot;
    std::vector<PlanEntry> entries;                 // every artifact considered
    std::vector<std::string> exclusions;            // paths refused authority, with reason
    std::uint64_t disposableBytes = 0;
    std::uint64_t needsProofBytes = 0;
    std::uint64_t mustPinBytes    = 0;
    std::uint64_t headroomBytesBefore = 0;
    std::uint64_t headroomBytesAfter  = 0;          // before + disposable ONLY
    std::uint64_t volumeCapacityBytes = 0;
};

// THE decision function. Pure: depends only on the artifact and the registry.
// It cannot see free space, a quota, or a deadline — so pressure can never
// convert uncertainty into authority. `reason` is always written.
Disposition classify(const Artifact& a,
                     const ManagedRootRegistry& reg,
                     std::string& reason);

class Planner {
public:
    explicit Planner(const ManagedRootRegistry& reg) : reg_(reg) {}

    // DRY RUN. Reads nothing destructive, writes nothing but the returned Plan.
    Plan dryRun(const std::vector<Artifact>& artifacts,
                std::uint64_t headroomBytesBefore = 0,
                std::uint64_t volumeCapacityBytes = 0,
                const fs::path& renderRoot = {}) const;

    static std::string renderText(const Plan& p);
    static std::string renderJson(const Plan& p);

private:
    const ManagedRootRegistry& reg_;
};

// ───────────────────────────────────────────────────────────────────────────
// 3b. Tamper-evident receipt
// ───────────────────────────────────────────────────────────────────────────
//
// A plan is evidence for a destructive decision taken later, by hand, possibly
// on another machine. Between the planning and the acting it is just a text
// file that anyone can edit — and the dangerous edit is not a wholesale forgery
// but a one-line one: moving a path from MUST_PIN into the disposable list, or
// nudging a byte total so the headroom case looks better than it is.
//
// The receipt makes that class of edit DETECTABLE, with two digests that cover
// each other's blind spot:
//   plan_sha256    — over the exact bytes of the rendered plan JSON. Change any
//                    row, reason, or total in the plan and this stops matching.
//   receipt_sha256 — over the receipt's own body. Change a number printed on
//                    the receipt to agree with a doctored plan and THIS stops
//                    matching instead.
//
// HONEST LIMIT: this is a checksum, not a signature. It detects accident,
// drift, and casual edits — not an adversary who can recompute both digests.
// Saying so here is part of the deliverable: a receipt that overstates what it
// proves is worse than none, because it buys trust it has not earned.
struct Receipt {
    std::string   planSha256;
    std::size_t   entryCount = 0;
    std::uint64_t disposableBytes = 0;
    std::uint64_t needsProofBytes = 0;
    std::uint64_t mustPinBytes    = 0;
    // Structurally always 0: this module has no delete path. It is printed so a
    // reader never has to take that on faith, and verified so a receipt that
    // claims otherwise is refused rather than believed.
    std::uint64_t deletesPerformed = 0;
};

// Build a receipt over the EXACT bytes of a rendered plan (pass the same string
// that was written to disk — re-rendering could differ).
Receipt makeReceipt(const std::string& planJson, const Plan& p);

// Render the receipt, terminating with its own self-digest line.
std::string renderReceipt(const Receipt& r);

// Recompute both digests and compare. Returns false, with `why` naming the
// failed check, when the plan no longer matches its receipt, the receipt body
// has been edited, the self-digest line is missing, or the receipt claims a
// deletion. Fails CLOSED: anything unparseable is a failure, never a pass.
bool verifyReceipt(const std::string& planJson, const std::string& receiptText,
                   std::string& why);

// ───────────────────────────────────────────────────────────────────────────
// 4. Scanner (filesystem side; still read-only)
// ───────────────────────────────────────────────────────────────────────────

// A git probe, injected so the planner core stays testable without a repo.
struct GitProbe {
    virtual ~GitProbe() = default;
    // "" when clean, non-empty porcelain when dirty, std::nullopt-ish via ok=false
    virtual bool statusPorcelain(const fs::path& worktree, std::string& out) const = 0;
    virtual bool refExists(const fs::path& repo, const std::string& ref) const = 0;
    // ok=false when the probe could not run (e.g. a ref is gone)
    virtual bool countUnreachable(const fs::path& repo, const std::string& fromRef,
                                  const std::string& toRef, std::uint64_t& count) const = 0;
    virtual bool isAncestor(const fs::path& repo, const std::string& sha,
                            const std::string& ofRef) const = 0;
    virtual bool resolve(const fs::path& repo, const std::string& rev, std::string& sha) const = 0;
};

// Real implementation: shells out to git, read-only subcommands only.
class RealGitProbe : public GitProbe {
public:
    bool statusPorcelain(const fs::path& worktree, std::string& out) const override;
    bool refExists(const fs::path& repo, const std::string& ref) const override;
    bool countUnreachable(const fs::path& repo, const std::string& fromRef,
                          const std::string& toRef, std::uint64_t& count) const override;
    bool isAncestor(const fs::path& repo, const std::string& sha,
                    const std::string& ofRef) const override;
    bool resolve(const fs::path& repo, const std::string& rev, std::string& sha) const override;
};

struct ScanConfig {
    fs::path workspace;
    fs::path home;
    std::string pushedRef = "refs/remotes/origin/archdisc";  // containment oracle
    std::uint32_t hotWindowDays = 7;    // a linked binary newer than this = HOT
    std::uint32_t staleDays     = 14;   // below this a build tree is WARM, not GC
};

// Recursive byte total. Follows no symlinks, swallows permission errors,
// reports whether the walk completed (an incomplete walk => sizeMeasured=false).
std::uint64_t directorySize(const fs::path& p, bool& complete);

// Cheap structural digest over (relative path, size, mtime) of up to `cap`
// entries — enough to detect "this tree changed", not a content hash, and
// labelled as such wherever it is printed.
std::string structuralHash(const fs::path& p, std::size_t cap = 4096);

class Scanner {
public:
    Scanner(ScanConfig cfg, const GitProbe& git) : cfg_(std::move(cfg)), git_(git) {}

    // Every scan* method APPENDS Artifacts. None of them delete anything.
    void scanBuildTrees(const fs::path& parent, std::vector<Artifact>& out) const;
    void scanDependencyTrees(std::vector<Artifact>& out) const;
    void scanWorktreeRecords(std::vector<Artifact>& out) const;

    std::vector<Artifact> scanAll() const;

    // Grep the workspace's TRACKED text files for literal needles and return
    // the referencing sites (file:line). This is the reference proof: a build
    // tree hard-coded into a script is REFERENCED even if its mtime is ancient.
    //
    // Two rules learned the hard way, both from real false readings in this
    // repo:
    //   * search the BARE directory name as well as the qualified path —
    //     package.json and three test/*.mjs name `build-native` with no
    //     `forge-kernel/` prefix, and a qualified-only search calls a tree
    //     nobody uses when four things use it;
    //   * a `.gitignore` line is NOT a reference. It says "do not track this",
    //     the opposite of a dependency, and counting it pins every build tree
    //     for a reason that is not true. A KEEP must say a TRUE why.
    std::vector<std::string> findReferencers(const std::vector<std::string>& needles,
                                             std::size_t maxHits = 8) const;

    // True for a grep hit that must not count as a reference (ignore files,
    // and anything under .git/).
    static bool isNonReferencingSite(const std::string& hitLine);

    const ScanConfig& config() const { return cfg_; }

private:
    ScanConfig cfg_;
    const GitProbe& git_;
};

}  // namespace forge::native::storage

#endif  // FORGE_NATIVE_STORAGE_STORAGE_GOVERNOR_HPP
