// transaction_gate.cpp — a rebuild that FAILS must leave nothing behind.
//
// Doc 00 orders the build chain "... document/feature graph -> KERNEL TRANSACTION
// ENGINE -> sketches -> ..." and doc 04 states the rule: "Any failure rolls back to
// the last known-good document graph without partially mutating the user-visible
// model." Stage 4 is the earliest stage on that chain that nothing implements, and
// everything after it inherits the inconsistency.
//
// WHAT IT LOOKS LIKE WITHOUT THIS. ForgeFrame::syncSceneToDocument() sets
// `builtProgram_ = program` UNCONDITIONALLY, above its own `if (ok)`. So after a
// statement the kernel refuses there is a THREE-WAY disagreement:
//
//   the document   keeps the failing statement
//   the viewport   shows the previous body ("the previous body stays on screen")
//   builtProgram_  claims the failing program is what the scene holds
//
// and because builtProgram_ is the staleness test, the next edit compares against a
// program that was never built.
//
// SCOPE, stated honestly: PartDocument::restore() truncates by record COUNT and
// restores the binding table, so it reverts APPENDS. An argument EDIT needs the
// FeatureEdit memento (PartCommands.hpp `before_`) and is not covered here; the
// header says so itself. This gate asserts the append case and nothing more.
//
// Headless: no window, no swapchain, no GPU.
#include "../src/ForgeFrame.hpp"
#include "../src/KernelScene.hpp"

#include "forge/ui/ForgeShell.hpp"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

namespace {
int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

void ck(const char* what, bool ok, const std::string& detail = "") {
  ++g_checks;
  if (ok) {
    std::printf("    ok   %s\n", what);
  } else {
    ++g_failures;
    std::printf("    FAIL %s%s%s\n", what, detail.empty() ? "" : "  -> ", detail.c_str());
  }
}
}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) {
      g_mutation = std::atoi(argv[++i]);
    }
  }
  std::printf("== kernel transaction boundary ==\n");

  forge::desktop::KernelScene scene;
  if (!scene.build()) {
    std::printf("[transaction] cannot continue without geometry: %s\n", scene.error().c_str());
    return 1;
  }
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();

  // ── a known-good starting state ──────────────────────────────────────────
  frame.syncSceneToDocument();
  const std::size_t records0 = frame.document().records().size();
  const std::string program0 = frame.document().irProgram();
  const std::string built0 = frame.documentProgram();
  const std::size_t tris0 = scene.triangleCount();

  ck("the document starts consistent with the scene", program0 == built0,
     "document and builtProgram_ already disagree before any edit");
  ck("  ...and there is geometry to lose", tris0 > 0, std::to_string(tris0));

  // ── a statement the REGISTRY accepts and the KERNEL refuses ──────────────
  // A fillet radius far larger than the body. It passes the op-constraint gate --
  // the app would let a user ask for it -- and the kernel then cannot build it,
  // which is exactly the case doc 04 says must roll back.
  // part.fillet has a 1..n edge signature, so the registry refuses it outright
  // without a selection and the kernel is never asked -- the first draft of this
  // gate did exactly that, and its own precondition check caught it.
  forge::ui::EntityRef body;
  body.bodyId = frame.activeBodyNode();
  body.kind = forge::ui::EntityKind::Edge;
  body.persistentName = "edge@all";
  body.generation = 1;
  shell.selection().replaceWith({body});

  forge::ui::CommandParams bad;
  bad.setNumber("radius", g_mutation == 4 ? 3.0 : 100000.0);
  const forge::ui::DispatchResult r = shell.run("part.fillet", bad);
  std::printf("    (dispatch: %s %s)\n", forge::ui::machineName(r.status),
              r.detail.substr(0, 60).c_str());

  const bool kernelRefused = !frame.rebuildError().empty();
  ck("the kernel refused the statement, so there is a failure to roll back",
     kernelRefused, "rebuildError is empty — the kernel BUILT it, so this gate "
                    "cannot test a rollback; pick a statement it really refuses");

  if (kernelRefused) {
    // (a) THE FAILING STATEMENT STAYS. That is deliberate and it is what every
    //     history-based CAD system does with a failed feature: the user fixes or
    //     deletes it. Doc 04 asks that the USER-VISIBLE MODEL not be partially
    //     mutated, not that the edit be thrown away. Asserting the opposite was my
    //     first draft of this gate, and it would have deleted the user's work.
    ck("the refused statement stays in the document, for the user to fix",
       frame.document().records().size() == records0 + 1,
       std::to_string(frame.document().records().size()) + " vs " +
           std::to_string(records0 + 1));

    // (b) THE INVARIANT, and it must be stated against the LAST GOOD program, not
    //     against the document.
    //
    //     Comparing builtProgram_ to document().irProgram() is too weak and the
    //     first draft of this gate made exactly that mistake: on the unfixed code
    //     BOTH hold the failing program -- builtProgram_ because it is assigned
    //     unconditionally, the document because the statement was never rolled back
    //     -- so they agree while both name something the scene does not hold, and
    //     the check passed against the defect it exists for.
    //
    //     The scene holds the last body that BUILT. builtProgram_ is the staleness
    //     test, so it must name that.
    ck("builtProgram_ names the LAST GOOD program, not the failed one",
       frame.documentProgram() == built0,
       "builtProgram_ claims a program that never built");

    // (c) the user-visible model must not have moved -- doc 04's actual rule
    ck("the viewport still holds the last good body",
       scene.triangleCount() == tris0,
       std::to_string(scene.triangleCount()) + " vs " + std::to_string(tris0));

    // (e) AND IT MUST NOT SPIN. builtProgram_ can no longer be the do-I-have-work
    //     guard, because the document now legitimately holds a program it does not
    //     name. Without a separate last-attempted witness the same doomed rebuild
    //     runs every frame; that cost 96 click_gate failures, one per command.
    ck("a second sync reports no further work -- the failure is not retried for ever",
       !frame.syncSceneToDocument());

    // (d) and the failure is still REPORTED -- rolling back silently would be its
    //     own defect, worse than the inconsistency it fixes.
    ck("the failure is still reported to the user", !frame.rebuildError().empty());
  }

  std::printf("\n[transaction] %d checks, %d failures\n", g_checks, g_failures);
  if (g_mutation != 0 && g_failures == 0) {
    std::printf("[transaction] mutation %d was NOT caught\n", g_mutation);
    return 1;
  }
  return g_failures == 0 ? 0 : 1;
}
