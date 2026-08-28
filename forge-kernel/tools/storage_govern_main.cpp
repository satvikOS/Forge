// forge-kernel/tools/storage_govern_main.cpp
//
// CLI driver for the native storage governor (Sacrosanct s21.3).
//
// DRY RUN ONLY. This binary has no delete path, no --execute flag, and no
// --force. It reads the filesystem, asks git read-only questions, and writes
// a plan. If you want something removed you take the plan to a human.
//
// It lives in tools/ rather than src/native/ deliberately: run_native.sh links
// every src/native object into every gate, and a main() there would collide.
//
// Usage:
//   storage_govern --workspace <abs path> [--home <abs path>]
//                  [--pushed-ref refs/remotes/origin/archdisc]
//                  [--hot-days 7] [--stale-days 14]
//                  [--out <file.txt>] [--json <file.json>]
//                  [--receipt <file.txt>]

#include "forge/native/storage/StorageGovernor.hpp"

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

using namespace forge::native::storage;
namespace fs = std::filesystem;

static std::string arg(int argc, char** argv, const std::string& key, const std::string& def) {
    for (int i = 1; i + 1 < argc; ++i) if (key == argv[i]) return argv[i + 1];
    return def;
}

int main(int argc, char** argv) {
    const std::string ws = arg(argc, argv, "--workspace", "");
    if (ws.empty()) {
        std::fprintf(stderr, "storage_govern: --workspace <absolute path> is required\n");
        return 2;
    }
    const fs::path workspace = fs::path(ws).lexically_normal();
    const char* homeEnv = std::getenv("HOME");
    const fs::path home = fs::path(arg(argc, argv, "--home", homeEnv ? homeEnv : ""));

    ScanConfig cfg;
    cfg.workspace = workspace;
    cfg.home = home;
    cfg.pushedRef = arg(argc, argv, "--pushed-ref", "refs/remotes/origin/archdisc");
    cfg.hotWindowDays = static_cast<std::uint32_t>(std::stoul(arg(argc, argv, "--hot-days", "7")));
    cfg.staleDays = static_cast<std::uint32_t>(std::stoul(arg(argc, argv, "--stale-days", "14")));

    // ── managed roots: EXPLICIT registration, nothing implicit ──────────────
    ManagedRootRegistry reg(workspace, home);
    struct Cand { const char* id; fs::path p; };
    const std::vector<Cand> candidates = {
        {"kernel-build-trees", workspace / "forge-kernel"},
        {"git-worktree-records", workspace / ".git" / "worktrees"},
        {"frontend",  workspace / "frontend"},
        {"electron",  workspace / "electron"},
        {"forge-desktop", workspace / "forge-desktop"},
        {"tools",     workspace / "tools"},
        {"root-node-modules", workspace / "node_modules"},
        // Deliberate negative controls: these MUST be refused, and the refusal
        // is printed so the operator can see the guard is live, not decorative.
        {"NEGATIVE-CONTROL home", home},
        {"NEGATIVE-CONTROL fsroot", fs::path("/")},
        {"NEGATIVE-CONTROL workspace-root", workspace},
        {"NEGATIVE-CONTROL unresolved", fs::path("$SCRATCH/build")},
    };

    std::printf("=== MANAGED ROOT REGISTRATION ===\n");
    for (const auto& c : candidates) {
        const RootVerdict v = reg.registerRoot(c.id, c.p);
        std::printf("  %-28s %-22s %s\n", c.id, toString(v), c.p.string().c_str());
    }
    std::printf("  registered roots: %zu\n\n", reg.roots().size());

    // ── scan ────────────────────────────────────────────────────────────────
    RealGitProbe git;
    Scanner sc(cfg, git);
    const std::vector<Artifact> artifacts = sc.scanAll();
    std::printf("=== SCAN ===\n  artifacts considered: %zu\n\n", artifacts.size());

    std::error_code ec;
    const auto sp = fs::space(workspace, ec);
    const std::uint64_t free = ec ? 0 : static_cast<std::uint64_t>(sp.available);
    const std::uint64_t cap = ec ? 0 : static_cast<std::uint64_t>(sp.capacity);

    Planner pl(reg);
    const Plan plan = pl.dryRun(artifacts, free, cap);

    const std::string txt = Planner::renderText(plan);
    std::fputs(txt.c_str(), stdout);

    const std::string outPath = arg(argc, argv, "--out", "");
    if (!outPath.empty()) { std::ofstream f(outPath); f << txt; }
    // The receipt attests to the EXACT bytes written to disk, so render the
    // JSON once and hash that same string — re-rendering could differ.
    const std::string planJson = Planner::renderJson(plan);
    const std::string jsonPath = arg(argc, argv, "--json", "");
    if (!jsonPath.empty()) { std::ofstream f(jsonPath); f << planJson; }

    const Receipt receipt = makeReceipt(planJson, plan);
    const std::string receiptText = renderReceipt(receipt);
    std::fputs("\n", stdout);
    std::fputs(receiptText.c_str(), stdout);

    // Verify what we just produced. A receipt the tool cannot itself verify is
    // a bug, and it must surface here rather than at audit time.
    std::string why;
    if (!verifyReceipt(planJson, receiptText, why)) {
        std::fprintf(stderr, "storage_govern: self-check FAILED — %s\n", why.c_str());
        return 3;
    }
    const std::string receiptPath = arg(argc, argv, "--receipt", "");
    if (!receiptPath.empty()) { std::ofstream f(receiptPath); f << receiptText; }

    // Exit 0 means "a plan was produced", NOT "something was reclaimed".
    // Nothing was reclaimed. Nothing can be, by this binary.
    return 0;
}
