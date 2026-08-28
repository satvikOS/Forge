// forge/native/storage/storage_governor_test.cpp
//
// SAFETY GATE for the native storage governor (Sacrosanct s21.3).
//
// The reclaim math is the easy part. The properties that matter are the ones
// that stop this tool from destroying work, so those are what this gate proves:
//
//   (A) $HOME, "/", a volume root, the workspace root, and an ancestor of the
//       workspace are all REJECTED as managed roots.
//   (B) An unresolved variable ("$SCRATCH/x", "~/x") and a relative path are
//       REJECTED — a root that depends on the environment is not a root.
//   (C) A symlink escaping a registered root is REJECTED at registration AND
//       excluded by contains() on the read side. Built with REAL symlinks in a
//       real temp tree, not a mock.
//   (D) A dirty worktree is NEVER a candidate. Cleanliness UNKNOWN is not
//       cleanliness — it is NEEDS_PROOF.
//   (E) forge-kernel/build (HOT, holds the live .node) is never a candidate,
//       proven twice: by HOT state, and independently by reference proof even
//       after the state is downgraded to GC_CANDIDATE.
//   (F) An uncertain artifact defaults to KEEP. Proven by MUTATION: take a row
//       that IS provably disposable and, one field at a time, blank out each
//       piece of evidence. Every single mutation must stop being disposable.
//       This is what makes the gate unable to pass vacuously.
//   (G) The s21.3 TRAP: a comparison ref deleted by merging yields
//       COMPARISON_REF_ABSENT (not a silent keep) and the reason NAMES the
//       missing ref; the recorded-HEAD-ancestor fallback proves containment
//       without the branch.
//   (H) The state machine: PURGED is terminal and reachable ONLY from
//       GC_CANDIDATE; QUARANTINED can never go straight to GC_CANDIDATE.
//   (I) The planner projects headroom from PROVABLY_DISPOSABLE bytes ONLY.
//   (J) Every entry carries a non-empty reason. A KEEP that cannot say why is
//       the exact bug s21.3 calls out.
//
// Build & run standalone:
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//     forge-kernel/src/native/storage/StorageGovernor.cpp \
//     forge-kernel/test/native/storage/storage_governor_test.cpp -o /tmp/sg && /tmp/sg

#include "forge/native/storage/StorageGovernor.hpp"

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <limits>
#include <string>
#include <system_error>
#include <vector>

#include <cstdlib>
#include <unistd.h>

using namespace forge::native::storage;
namespace fs = std::filesystem;

static int g_pass = 0, g_total = 0;
static std::vector<std::string> g_failures;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; }
    else { g_failures.push_back(name); std::printf("  [FAIL] %s\n", name.c_str()); }
}

static bool contains(const std::string& hay, const std::string& needle) {
    return hay.find(needle) != std::string::npos;
}

// ───────────────────────────────────────────────────────────────────────────
// A real temp workspace with real symlinks.
// ───────────────────────────────────────────────────────────────────────────
struct TempWorld {
    fs::path base, home, workspace, outside;
    TempWorld() {
        std::error_code ec;
        char tmpl[] = "/tmp/forge_sg_test_XXXXXX";
        const char* d = ::mkdtemp(tmpl);
        base = d ? fs::path(d) : fs::path("/tmp/forge_sg_test_fallback");
        fs::create_directories(base, ec);
        home      = base / "home" / "someuser";
        workspace = home / "repo";
        outside   = base / "elsewhere";
        fs::create_directories(workspace / "forge-kernel" / "build", ec);
        fs::create_directories(workspace / "forge-kernel" / "build-old", ec);
        fs::create_directories(workspace / "artifacts", ec);
        fs::create_directories(outside / "precious", ec);
        // The escape: a link INSIDE the workspace pointing OUT of it.
        fs::create_directory_symlink(outside / "precious", workspace / "escape", ec);
        // A benign link that stays inside.
        fs::create_directory_symlink(workspace / "artifacts", workspace / "inside-link", ec);
    }
    ~TempWorld() {
        // Test scaffolding cleanup of a directory this test itself created in
        // /tmp. The GOVERNOR still deletes nothing — this is the test's own
        // mkdtemp, not a managed root.
        std::error_code ec;
        fs::remove_all(base, ec);
    }
};

// A canonical "provably disposable" build tree, used as the mutation base.
static Artifact goodBuildTree(const fs::path& p) {
    Artifact a;
    a.id = "buildtree:build-old";
    a.klass = ArtifactClass::BUILD_TREE;
    a.canonicalPath = p;
    a.bytes = 2ull * 1024 * 1024 * 1024;
    a.sizeMeasured = true;
    a.contentHash = "struct:deadbeefdeadbeef";
    a.producer = "cmake";
    a.owner = "forge-kernel";
    a.state = State::GC_CANDIDATE;
    a.ageDays = 40;
    a.retentionDays = 14;
    a.recovery = "cmake -S . -B build-old && cmake --build build-old -j";
    a.dirty = Tri::NO;
    return a;
}

int main() {
    std::printf("== forge::native::storage governor SAFETY gate (s21.3) ==\n");
    TempWorld W;

    ManagedRootRegistry reg(W.workspace, W.home);

    // ─────────────────────────────────────────────────────────────────────
    // (A) roots that must be refused
    // ─────────────────────────────────────────────────────────────────────
    check(reg.evaluate(W.home) == RootVerdict::IS_HOME_DIRECTORY,
          "A1 $HOME rejected as managed root");
    check(reg.registerRoot("home", W.home) == RootVerdict::IS_HOME_DIRECTORY &&
          reg.roots().empty(),
          "A2 rejecting $HOME stores no root");
    check(reg.evaluate(fs::path("/")) == RootVerdict::IS_FILESYSTEM_ROOT,
          "A3 filesystem root / rejected");
    check(reg.evaluate(fs::path("/Volumes/Data")) == RootVerdict::IS_FILESYSTEM_ROOT,
          "A4 volume root /Volumes/Data rejected");
    check(reg.evaluate(fs::path("/System/Volumes/Data")) == RootVerdict::IS_FILESYSTEM_ROOT,
          "A5 volume root /System/Volumes/Data rejected");
    check(reg.evaluate(fs::path("/Users")) == RootVerdict::IS_FILESYSTEM_ROOT,
          "A6 /Users rejected");
    check(reg.evaluate(W.workspace) == RootVerdict::IS_WORKSPACE_ROOT,
          "A7 workspace root itself rejected");
    // The workspace's immediate parent here IS $HOME, and the home rule is the
    // stronger statement, so the ancestor rule is exercised one level further up.
    check(reg.evaluate(W.workspace.parent_path()) == RootVerdict::IS_HOME_DIRECTORY,
          "A8a the workspace's parent is $HOME and is rejected as such");
    check(reg.evaluate(W.base) == RootVerdict::ANCESTOR_OF_WORKSPACE,
          "A8b a non-home ancestor of the workspace rejected");
    check(reg.evaluate(W.base / "home") == RootVerdict::ANCESTOR_OF_WORKSPACE,
          "A8c every ancestor level is rejected, not just the top");
    check(reg.evaluate(W.outside / "precious") == RootVerdict::OUTSIDE_WORKSPACE,
          "A9 a path outside the workspace rejected");
    check(reg.evaluate(W.workspace / "does-not-exist") == RootVerdict::NOT_A_DIRECTORY,
          "A10 a non-existent directory rejected");

    // ─────────────────────────────────────────────────────────────────────
    // (B) unresolved / relative
    // ─────────────────────────────────────────────────────────────────────
    check(reg.evaluate(fs::path("")) == RootVerdict::EMPTY, "B1 empty root rejected");
    check(reg.evaluate(fs::path("forge-kernel/build")) == RootVerdict::NOT_ABSOLUTE,
          "B2 relative root rejected");
    check(reg.evaluate(fs::path("$SCRATCH/build")) == RootVerdict::UNRESOLVED_VARIABLE,
          "B3 $VAR root rejected");
    check(reg.evaluate(fs::path("${WORKSPACE}/build")) == RootVerdict::UNRESOLVED_VARIABLE,
          "B4 ${VAR} root rejected");
    check(reg.evaluate(fs::path("~/build")) == RootVerdict::UNRESOLVED_VARIABLE,
          "B5 ~ root rejected");

    // ─────────────────────────────────────────────────────────────────────
    // (C) symlink escape — REAL links
    // ─────────────────────────────────────────────────────────────────────
    check(fs::is_symlink(fs::symlink_status(W.workspace / "escape")),
          "C0 the test really created a symlink (guard against a vacuous C)");
    check(reg.evaluate(W.workspace / "escape") == RootVerdict::SYMLINK_ESCAPE,
          "C1 a symlink escaping the workspace is REJECTED as a root");
    check(reg.evaluate(W.workspace / "escape" / "sub") == RootVerdict::SYMLINK_ESCAPE,
          "C2 a path THROUGH an escaping symlink is REJECTED");
    check(reg.evaluate(W.workspace / "inside-link") == RootVerdict::OK,
          "C3 a symlink that stays inside the workspace is accepted");

    // Read side: register a legitimate root, then plant an escaping link inside
    // it and confirm contains() refuses the escaped path.
    {
        std::error_code ec;
        const fs::path root = W.workspace / "forge-kernel";
        check(reg.registerRoot("kernel", root) == RootVerdict::OK, "C4 legitimate root registers");
        fs::create_directory_symlink(W.outside / "precious", root / "leak", ec);
        check(!ec, "C5 the test really created the escaping link inside the root");
        check(reg.contains(root / "build"), "C6 an in-root path is contained");
        check(!reg.contains(root / "leak"),
              "C7 contains() REFUSES a path that leaves the root via a symlink");
        check(!reg.contains(root / "leak" / "file"),
              "C8 contains() REFUSES a path THROUGH the escaping link");
        check(!reg.contains(W.outside / "precious"), "C9 contains() refuses an outside path");
        check(!reg.contains(W.home), "C10 contains() refuses $HOME");
        check(!reg.contains(fs::path("/")), "C11 contains() refuses /");

        // And an artifact sitting at the escaped path is MUST_PIN, not merely
        // skipped — the planner must SAY it has no authority there.
        Artifact leaked = goodBuildTree(root / "leak");
        std::string why;
        check(classify(leaked, reg, why) == Disposition::MUST_PIN,
              "C12 an artifact reached through an escaping symlink is MUST_PIN");
        check(contains(why, "outside every registered managed root"),
              "C13 ...and the reason names the missing authority");
    }

    // ─────────────────────────────────────────────────────────────────────
    // (D) a dirty worktree is never a candidate
    // ─────────────────────────────────────────────────────────────────────
    {
        Artifact wt;
        wt.klass = ArtifactClass::WORKTREE;
        wt.canonicalPath = W.workspace / "forge-kernel" / "build-old";
        wt.bytes = 1000;
        wt.sizeMeasured = true;
        wt.state = State::GC_CANDIDATE;
        wt.recovery = "git worktree add";
        wt.containment = UnpushedEvidence::CONTAINED;
        wt.ageDays = 99;
        wt.dirty = Tri::YES;

        std::string why;
        check(classify(wt, reg, why) == Disposition::MUST_PIN,
              "D1 a DIRTY worktree is MUST_PIN even when everything else says go");
        check(contains(why, "DIRTY"), "D2 ...and the reason says DIRTY");

        wt.dirty = Tri::UNKNOWN;
        check(classify(wt, reg, why) == Disposition::NEEDS_PROOF,
              "D3 cleanliness UNKNOWN is NOT clean — NEEDS_PROOF");
        check(contains(why, "UNPROVEN"), "D4 ...and the reason says the proof is missing");

        wt.dirty = Tri::NO;
        check(classify(wt, reg, why) == Disposition::PROVABLY_DISPOSABLE,
              "D5 (control) with dirty=NO the same row IS disposable — D1/D3 are not vacuous");
    }

    // ─────────────────────────────────────────────────────────────────────
    // (E) forge-kernel/build is never a candidate
    // ─────────────────────────────────────────────────────────────────────
    {
        Artifact hot = goodBuildTree(W.workspace / "forge-kernel" / "build");
        hot.state = State::HOT;
        hot.references.push_back("live linked binary in tree, age 0d <= hot window 7d");
        std::string why;
        check(classify(hot, reg, why) == Disposition::MUST_PIN,
              "E1 forge-kernel/build (HOT, holds the live .node) is MUST_PIN");
        check(contains(why, "HOT"), "E2 ...and the reason says HOT");

        // Independent second guard: even if the HOT flag were lost, the
        // reference proof alone must still pin it.
        Artifact downgraded = hot;
        downgraded.state = State::GC_CANDIDATE;
        check(classify(downgraded, reg, why) == Disposition::MUST_PIN,
              "E3 with HOT lost, the REFERENCE proof alone still pins it");
        check(contains(why, "referenced by"), "E4 ...and names the referencing site");

        // Third guard: an open lease pins it regardless of state or references.
        Artifact leased = goodBuildTree(W.workspace / "forge-kernel" / "build");
        leased.lease.held = true;
        leased.lease.holder = "cadgen_mm_pipeline pid 1234";
        check(classify(leased, reg, why) == Disposition::MUST_PIN,
              "E5 an open lease pins it");
        check(contains(why, "1234"), "E6 ...and names the lease holder");
    }

    // ─────────────────────────────────────────────────────────────────────
    // (F) uncertainty defaults to KEEP — proven by MUTATION
    // ─────────────────────────────────────────────────────────────────────
    {
        const fs::path p = W.workspace / "forge-kernel" / "build-old";
        Artifact base = goodBuildTree(p);
        std::string why;
        const Disposition d0 = classify(base, reg, why);
        check(d0 == Disposition::PROVABLY_DISPOSABLE,
              "F0 the mutation BASE is provably disposable (otherwise F is vacuous)");

        struct Mut { const char* name; std::function<void(Artifact&)> apply; };
        const std::vector<Mut> muts = {
            {"class becomes UNKNOWN",        [](Artifact& a){ a.klass = ArtifactClass::UNKNOWN; }},
            {"class becomes DATASET",        [](Artifact& a){ a.klass = ArtifactClass::DATASET; }},
            {"class becomes MODEL",          [](Artifact& a){ a.klass = ArtifactClass::MODEL; }},
            {"class becomes EVAL_HOLDOUT",   [](Artifact& a){ a.klass = ArtifactClass::EVAL_HOLDOUT; }},
            {"class becomes PROVENANCE",     [](Artifact& a){ a.klass = ArtifactClass::PROVENANCE_RECORD; }},
            {"class becomes SESSION",        [](Artifact& a){ a.klass = ArtifactClass::SESSION_ARTIFACT; }},
            {"class becomes REPRODUCER",     [](Artifact& a){ a.klass = ArtifactClass::FAILURE_REPRODUCER; }},
            {"class becomes USER_PROJECT",   [](Artifact& a){ a.klass = ArtifactClass::USER_PROJECT; }},
            {"class becomes NORMATIVE_DOC",  [](Artifact& a){ a.klass = ArtifactClass::NORMATIVE_DOCUMENT; }},
            {"state becomes HOT",            [](Artifact& a){ a.state = State::HOT; }},
            {"state becomes PINNED",         [](Artifact& a){ a.state = State::PINNED; }},
            {"state becomes ROLLBACK",       [](Artifact& a){ a.state = State::ROLLBACK; }},
            {"state becomes QUARANTINED",    [](Artifact& a){ a.state = State::QUARANTINED; }},
            {"state becomes WARM",           [](Artifact& a){ a.state = State::WARM; }},
            {"a lease is held",              [](Artifact& a){ a.lease.held = true; }},
            {"evidence conflicts",           [](Artifact& a){ a.evidenceConflict = "mtime says idle, lock says live"; }},
            {"a referencer appears",         [](Artifact& a){ a.references.push_back("scripts/x.sh:78"); }},
            {"size walk incomplete",         [](Artifact& a){ a.sizeMeasured = false; }},
            {"recovery method lost",         [](Artifact& a){ a.recovery.clear(); }},
            {"inside retention window",      [](Artifact& a){ a.ageDays = 3; }},
            {"path leaves the managed root", [&W](Artifact& a){ a.canonicalPath = W.outside / "precious"; }},
            {"path becomes empty",           [](Artifact& a){ a.canonicalPath.clear(); }},
            {"a stale plan cites it",        [](Artifact& a){
                 // a reference from the governor's own plan is filtered out by
                 // the scanner; if one ever reaches classify() it must still keep
                 a.references.push_back("forge-kernel/reports/storage_plan.txt:7:x"); }},
        };
        int survived = 0;
        for (const auto& m : muts) {
            Artifact a = base;
            m.apply(a);
            std::string r;
            const Disposition d = classify(a, reg, r);
            const bool keeps = (d != Disposition::PROVABLY_DISPOSABLE);
            check(keeps, std::string("F-mut '") + m.name + "' must stop being disposable");
            check(!r.empty(), std::string("F-mut '") + m.name + "' must state a reason");
            if (!keeps) ++survived;
        }
        check(survived == 0, "F1 EVERY evidence mutation flips the verdict away from disposable");

        // A worktree row with NO git evidence at all defaults to KEEP.
        Artifact empty = base;
        empty.canonicalPath.clear();
        std::string rEmpty;
        check(classify(empty, reg, rEmpty) == Disposition::MUST_PIN &&
              contains(rEmpty, "no path"),
              "F1b an artifact with no path is refused BY THAT NAME, not mislabelled "
              "as out-of-root");

        Artifact bare;
        bare.klass = ArtifactClass::WORKTREE_RECORD;
        bare.canonicalPath = p;
        bare.sizeMeasured = true;
        bare.recovery = "git worktree add";
        bare.state = State::GC_CANDIDATE;
        std::string r2;
        check(classify(bare, reg, r2) == Disposition::NEEDS_PROOF,
              "F2 a git-backed row with no probes run at all defaults to KEEP");

        // F3 - the terminal fallthrough, made reachable on purpose.
        // Every State the enum currently declares is handled by an explicit
        // rung above, so the "default KEEP" tail is dead code TODAY and a
        // mutation flipping it to PROVABLY_DISPOSABLE survived an earlier
        // version of this gate. A future State added to the enum WITHOUT a rung
        // in classify() is exactly the regression that tail exists to absorb,
        // so the gate forges that future here.
        Artifact future = goodBuildTree(p);
        future.state = static_cast<State>(0x7f);   // a state this build never heard of
        std::string r3;
        check(classify(future, reg, r3) == Disposition::NEEDS_PROOF,
              "F3 an UNRECOGNISED state falls through to KEEP, never to disposable");
        check(!r3.empty() && contains(r3, "default KEEP"),
              "F4 ...and the fallthrough says so out loud");
    }

    // ─────────────────────────────────────────────────────────────────────
    // (G) the s21.3 trap: the comparison ref merging deleted
    // ─────────────────────────────────────────────────────────────────────
    {
        Artifact rec;
        rec.klass = ArtifactClass::WORKTREE_RECORD;
        rec.canonicalPath = W.workspace / "forge-kernel" / "build-old";
        rec.bytes = 858437;
        rec.sizeMeasured = true;
        rec.state = State::GC_CANDIDATE;
        rec.recovery = "git worktree add <path> refs/heads/worktree-agent-x";
        rec.dirty = Tri::NO;   // checkout is gone: nothing can be dirty
        rec.ageDays = 90;

        std::string why;
        rec.containment = UnpushedEvidence::COMPARISON_REF_ABSENT;
        rec.containmentDetail = "branch refs/heads/worktree-agent-x is GONE";
        check(classify(rec, reg, why) == Disposition::NEEDS_PROOF,
              "G1 a deleted comparison ref yields NEEDS_PROOF, not a silent keep");
        check(contains(why, "no longer exists") && contains(why, "worktree-agent-x"),
              "G2 ...and the reason NAMES the ref that went missing (the KEEP says WHY)");

        rec.containment = UnpushedEvidence::PROBE_FAILED;
        check(classify(rec, reg, why) == Disposition::NEEDS_PROOF,
              "G3 a FAILED git probe is not a clean bill of health");

        rec.containment = UnpushedEvidence::NOT_CONTAINED;
        rec.containmentDetail = "1 commit(s) not reachable from origin/archdisc";
        check(classify(rec, reg, why) == Disposition::MUST_PIN,
              "G4 unique/unpushed commits force MUST_PIN");
        check(contains(why, "no pushed ref"), "G5 ...and the reason says so");

        // The fallback the scanner uses when the branch is gone: prove the
        // RECORDED HEAD sha is an ancestor of a surviving pushed ref.
        rec.containment = UnpushedEvidence::CONTAINED;
        rec.containmentDetail = "branch GONE, recorded HEAD abc123def456 IS an ancestor "
                                "of refs/remotes/origin/archdisc";
        check(classify(rec, reg, why) == Disposition::PROVABLY_DISPOSABLE,
              "G6 containment proven WITHOUT the branch unblocks the record");
    }

    // ─────────────────────────────────────────────────────────────────────
    // (H) state machine
    // ─────────────────────────────────────────────────────────────────────
    {
        const State all[] = {State::HOT, State::WARM, State::PINNED, State::ROLLBACK,
                             State::ARCHIVED, State::GC_CANDIDATE, State::QUARANTINED,
                             State::PURGED};
        int intoPurged = 0;
        for (State s : all) if (isLegalTransition(s, State::PURGED)) ++intoPurged;
        check(intoPurged == 1 && isLegalTransition(State::GC_CANDIDATE, State::PURGED),
              "H1 GC_CANDIDATE is the ONLY state that can reach PURGED");
        int outOfPurged = 0;
        for (State s : all) if (isLegalTransition(State::PURGED, s)) ++outOfPurged;
        check(outOfPurged == 0, "H2 PURGED is terminal");
        check(!isLegalTransition(State::QUARANTINED, State::GC_CANDIDATE),
              "H3 QUARANTINED can never go straight to GC_CANDIDATE");
        check(!isLegalTransition(State::HOT, State::GC_CANDIDATE),
              "H4 HOT cannot become a GC candidate without cooling to WARM first");
        check(isLegalTransition(State::GC_CANDIDATE, State::HOT) &&
              isLegalTransition(State::GC_CANDIDATE, State::PINNED),
              "H5 new evidence can always pull a candidate BACK");
        check(isTerminal(State::PURGED) && !isTerminal(State::GC_CANDIDATE),
              "H6 terminality");
    }

    // ─────────────────────────────────────────────────────────────────────
    // (I)+(J) planner totals, projection, and universal reasons
    // ─────────────────────────────────────────────────────────────────────
    {
        std::vector<Artifact> as;
        Artifact disp = goodBuildTree(W.workspace / "forge-kernel" / "build-old");
        disp.bytes = 1000;
        as.push_back(disp);

        Artifact pin = goodBuildTree(W.workspace / "forge-kernel" / "build");
        pin.state = State::HOT; pin.bytes = 2000;
        as.push_back(pin);

        Artifact unk = goodBuildTree(W.workspace / "forge-kernel" / "build-old");
        unk.recovery.clear(); unk.bytes = 4000;
        as.push_back(unk);

        Artifact out = goodBuildTree(W.outside / "precious");
        out.bytes = 8000;
        as.push_back(out);

        Planner pl(reg);
        const Plan p = pl.dryRun(as, /*headroomBefore=*/500, /*capacity=*/100000);
        check(p.disposableBytes == 1000, "I1 disposable total counts only proven rows");
        check(p.needsProofBytes == 4000, "I2 needs-proof total");
        check(p.mustPinBytes == 2000 + 8000, "I3 must-pin total includes the out-of-root row");
        check(p.headroomBytesAfter == 500 + 1000,
              "I4 projected headroom adds ONLY disposable bytes — unproven bytes are never projected");
        check(p.exclusions.size() == 1 && contains(p.exclusions[0], "precious"),
              "I5 the out-of-root row is listed in the exclusion ledger");
        check(p.entries.size() == as.size(), "I6 every artifact appears in the plan");

        bool allHaveReasons = true, allHaveRecovery = true, allHaveRefProof = true;
        for (const auto& e : p.entries) {
            if (e.reason.empty()) allHaveReasons = false;
            if (e.recovery.empty()) allHaveRecovery = false;
            if (e.referenceProof.empty()) allHaveRefProof = false;
        }
        check(allHaveReasons,  "J1 EVERY plan row states a reason (a KEEP can always say WHY)");
        check(allHaveRecovery, "J2 EVERY plan row states a recovery method or says it is unknown");
        check(allHaveRefProof, "J3 EVERY plan row states its reference proof");
        check(p.entries.front().disposition == Disposition::PROVABLY_DISPOSABLE,
              "J4 the plan is ordered with actionable rows first");

        const std::string txt = Planner::renderText(p);
        check(contains(txt, "NOTHING IS DELETED BY THIS TOOL"),
              "J5 the rendered plan declares itself a dry run");
        check(contains(txt, "PROVABLY_DISPOSABLE") && contains(txt, "MUST_PIN"),
              "J6 the rendered plan carries all three buckets");
        const std::string js = Planner::renderJson(p);
        check(contains(js, "\"deletes_performed\": 0"), "J7 the JSON records zero deletions");
        check(contains(js, "\"mode\": \"dry-run\""), "J8 the JSON records dry-run mode");
    }

    // ─────────────────────────────────────────────────────────────────────
    // (L) what counts as a REFERENCE
    //
    // Both halves of this were real misreadings of this repo. Counting a
    // .gitignore line pinned two build trees for a reason that is not true
    // ("do not track this" is the opposite of "something depends on this"),
    // and searching only the qualified path missed the four tracked files that
    // name build-native with no forge-kernel/ prefix.
    // ─────────────────────────────────────────────────────────────────────
    check(Scanner::isNonReferencingSite(".gitignore:97:forge-kernel/build-native/"),
          "L1 a .gitignore line is NOT a reference");
    check(Scanner::isNonReferencingSite("frontend/.gitignore:3:build/"),
          "L2 a nested .gitignore line is NOT a reference");
    check(Scanner::isNonReferencingSite(".git/config:4:build-native"),
          "L3 anything under .git/ is NOT a reference");
    check(Scanner::isNonReferencingSite("sub/.git/info/exclude:1:build-x"),
          "L4 a nested .git/ path is NOT a reference");
    check(!Scanner::isNonReferencingSite("package.json:12:\"build-native\""),
          "L5 package.json IS a reference");
    check(!Scanner::isNonReferencingSite(
              "forge-kernel/test/native_vs_occt_core.mjs:9:build-native"),
          "L6 a tracked test file IS a reference");
    check(!Scanner::isNonReferencingSite("docs/PLAN.md:2:build-desktop-ui"),
          "L7 a tracked document IS a reference");

    // L8-L11 — the self-poisoning guard. The plan this tool commits names every
    // build tree it examined, so once that plan is tracked the next scan would
    // find each tree "referenced" by the document that proposed reclaiming it,
    // and pin the entire repo for ever on circular evidence.
    check(Scanner::isNonReferencingSite(
              "forge-kernel/reports/storage_plan.txt:7:forge-kernel/build-thicken"),
          "L8 the governor's own PLAN is not a reference");
    check(Scanner::isNonReferencingSite(
              "forge-kernel/reports/storage_plan.json:12:build-unified"),
          "L9 the governor's own JSON plan is not a reference");
    check(Scanner::isNonReferencingSite(
              "forge-kernel/src/native/storage/StorageGovernor.cpp:5:build-native"),
          "L10 the governor's own source is not a reference");
    check(Scanner::isNonReferencingSite(
              "forge-kernel/tools/storage_govern_main.cpp:60:build-native"),
          "L11 the governor's own CLI is not a reference");
    check(!Scanner::isNonReferencingSite(
              "forge-kernel/reports/OCCT_DROP_ORDER.md:12:build-shheal"),
          "L12 an unrelated report in the SAME directory IS still a reference");

    // ─────────────────────────────────────────────────────────────────────
    // (K) lexicallyInside must not fall for the string-prefix bug
    // ─────────────────────────────────────────────────────────────────────
    check(!lexicallyInside("/a/b", "/a/bc"), "K1 /a/bc is NOT inside /a/b");
    check(lexicallyInside("/a/b", "/a/b/c"), "K2 /a/b/c is inside /a/b");
    check(!lexicallyInside("/a/b", "/a/b"), "K3 a path is not strictly inside itself");
    check(!lexicallyInside("/a/b/c", "/a/b"), "K4 a parent is not inside its child");

    std::printf("\n== storage governor SAFETY gate: %d/%d checks passed ==\n", g_pass, g_total);
    if (!g_failures.empty()) {
        std::printf("FAILURES (%zu):\n", g_failures.size());
        for (const auto& f : g_failures) std::printf("  - %s\n", f.c_str());
        std::printf("RESULT: FAIL\n");
        return 1;
    }
    if (g_total < 80) {   // the gate must not pass by running almost nothing
        std::printf("RESULT: FAIL — only %d checks ran; the gate is too thin to trust\n", g_total);
        return 1;
    }
    std::printf("RESULT: PASS — %d safety properties proven\n", g_total);
    return 0;
}
