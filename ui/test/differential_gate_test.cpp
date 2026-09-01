// ui/test/differential_gate_test.cpp
//
// THE INTEGRATION INVARIANT, TIER 1 -- KERNEL-FREE.
//
// Two execution paths exist for one feature tree:
//
//   headless : IR text -> forge::ft::compileText  (forge_verify; every benchmark
//              number in this programme comes out of it)
//   in-app   : commands -> OpConstraintBridge -> PartDocument::appendFeature
//              -> PartDocument::irProgram() -> forge::ft::parse + compile
//
// NOTHING checked that they agree. This gate is the first half of that check and
// it needs NO KERNEL, so it runs in the ubuntu `ui` job on every PR in ~1 second.
// The second half -- the solids, on a vector of observables -- is
// forge-desktop/test/differential_solid_gate.cpp, which links forge_kernel_core
// and runs in the macOS `kernel` job that already builds it.
//
// The split is not a compromise, it is where the divergence actually lives:
// forge_verify and KernelScene both end in forge::ft::compile, so given the SAME
// IR TEXT the solid is the same function of the same input. What is NOT the same
// by construction is the TEXT -- one arm is written by a planner, the other is
// assembled by 30 registered commands -- and whether the bridge will let the app
// have the text at all. That is what this file measures.
//
// FOUR CHECKS:
//   A. per tree, the app-authored IR is byte-identical to the planner's IR.
//   B. per tree, the bridge ACCEPTS every statement the app itself emitted.
//      A bridge that refuses its own application's output is not a safety
//      feature, it is a defect (the owner's constraint: represent, never refuse).
//   C. per tree, forge::ui::validateIr -- the kernel grammar as transcribed and
//      gate-verified by feature_ir_test.cpp -- accepts every statement.
//   D. THE ARITY DIFFERENTIAL, over the whole vocabulary: every argument count
//      the KERNEL accepts and the BRIDGE refuses. This is measured, not assumed,
//      and RATCHETED: the gate is RED if the disagreement GROWS, and RED if it
//      SHRINKS without the pin moving (a ratchet that cannot notice progress is
//      not a ratchet). Reported verbatim on every run so the defect is visible
//      rather than remembered.
//
// `--mutate N` injects one deliberate divergence and the gate must go RED. Run
// by ui/test/run_differential_gate.sh; run_ui.sh runs the clean pass with no
// arguments.
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "differential_corpus.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/OpConstraintBridge.hpp"
#include "forge/ui/PartCommands.hpp"
#include "ui_test_util.hpp"

using forge::difftest::Mutation;
using forge::ui::IrCheck;
using forge::ui::IrOpSpec;
using forge::ui::kIrArgsUnbounded;
using forge::ui::OpConstraintBridge;
using forge::ui::OpVocabulary;
using forge::ui::PlanRuling;

namespace {

// ---------------------------------------------------------------------------
// D. THE ARITY DIFFERENTIAL
//
// forge::ui::irOpTable() is the KERNEL's arity, transcribed from
// forge-kernel/include/forge/ft/FeatureTree.hpp and re-derived from that header
// AS DATA by feature_ir_test.cpp, so it cannot drift from the kernel silently.
// OpVocabulary::Op::emittedForms is what the BRIDGE will accept. Every count in
// the first and not the second is a statement forge_verify compiles and the app
// refuses.
struct ArityGap {
  std::string op;
  std::size_t kernelMin = 0;
  std::size_t kernelMax = 0;
  std::vector<std::size_t> refused;
};

bool bridgeAcceptsArity(const OpVocabulary::Op& op, std::size_t argc) {
  for (const OpVocabulary::ArgCounts& form : op.emittedForms) {
    if (argc < form.min) continue;
    if (form.max != kIrArgsUnbounded && argc > form.max) continue;
    return true;
  }
  return false;
}

std::vector<ArityGap> arityDifferential(const OpConstraintBridge& bridge) {
  std::vector<ArityGap> gaps;
  for (const std::string& name : bridge.allowedOps()) {
    const OpVocabulary::Op* op = bridge.vocabulary().find(name);
    const IrOpSpec* kernel = forge::ui::findIrOp(name);
    if (op == nullptr || kernel == nullptr) continue;
    // An unbounded kernel op (LOFT) has no finite top to sweep; its emitted
    // forms are unbounded too, so there is nothing to disagree about above the
    // minimum. Sweep only the bounded window.
    if (kernel->maxArgs == kIrArgsUnbounded) continue;
    ArityGap g;
    g.op = name;
    g.kernelMin = kernel->minArgs;
    g.kernelMax = kernel->maxArgs;
    for (std::size_t n = kernel->minArgs; n <= kernel->maxArgs; ++n) {
      if (!bridgeAcceptsArity(*op, n)) g.refused.push_back(n);
    }
    if (!g.refused.empty()) gaps.push_back(g);
  }
  return gaps;
}

std::string countList(const std::vector<std::size_t>& v) {
  std::string s;
  for (std::size_t i = 0; i < v.size(); ++i) {
    if (i != 0) s += ",";
    s += std::to_string(v[i]);
  }
  return s;
}

}  // namespace

int main(int argc, char** argv) {
  Mutation mutation = Mutation::None;
  for (int i = 1; i < argc; ++i) {
    // The sweep in run_differential_gate.sh pins how many mutations it runs. It
    // asks the BINARY for that number rather than carrying its own copy: two
    // numbers for one fact is the desync this whole gate exists to prevent.
    if (std::strcmp(argv[i], "--mutation-count") == 0) {
      std::printf("%d\n", forge::difftest::kMutationCount);
      return 0;
    }
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) {
      const int n = std::atoi(argv[i + 1]);
      if (n <= 0 || n > forge::difftest::kMutationCount) {
        std::printf("[differential] --mutate takes 1..%d\n", forge::difftest::kMutationCount);
        return 2;
      }
      mutation = static_cast<Mutation>(n);
      ++i;
    }
  }

  forge::uitest::Harness H("differential");
  const OpConstraintBridge bridge;
  const std::vector<forge::difftest::Tree>& corpus = forge::difftest::trees();

  std::printf("[differential] tier 1 (kernel-free): %zu trees, mutation=%s\n", corpus.size(),
              forge::difftest::mutationName(mutation));

  // The corpus must not be able to shrink to nothing and report a pass: an empty
  // sweep is not a green sweep. Pinned EXACTLY so adding a tree is a deliberate,
  // reviewed act.
  CHECK_EQ_INT(corpus.size(), 8u);

  std::size_t agreed = 0;
  for (const forge::difftest::Tree& t : corpus) {
    const forge::difftest::AppRun app = forge::difftest::runInApp(t, mutation);
    if (!app.ok) {
      ++H.checks;
      ++H.failures;
      std::printf("  FAIL [%s] the app path did not run: %s\n", t.id.c_str(),
                  app.failure.c_str());
      continue;
    }

    // ---- A. the two arms must carry the SAME PROGRAM ----------------------
    const std::string planner = forge::difftest::headlessProgram(t, mutation);
    ++H.checks;
    if (app.ir == planner) {
      ++agreed;
    } else {
      ++H.failures;
      std::printf("  FAIL [%s] the two paths do not carry the same IR\n", t.id.c_str());
      std::printf("        planner (headless / forge_verify):\n%s", planner.c_str());
      std::printf("        app     (commands -> PartDocument):\n%s", app.ir.c_str());
    }

    // ---- B. the bridge must ACCEPT what the app itself emitted ------------
    const std::vector<forge::ui::ProposedOp> plan = forge::difftest::proposalOf(app, mutation);
    const PlanRuling ruling = bridge.check(plan, app.priorValues);
    ++H.checks;
    if (!ruling.allAccepted()) {
      ++H.failures;
      std::printf("  FAIL [%s] BRIDGE DEFECT -- the bridge refused %zu of %zu statements the\n"
                  "        app itself authored. A bridge that refuses its own application's\n"
                  "        output cannot be a safety feature.\n%s",
                  t.id.c_str(), ruling.rejected, ruling.rulings.size(), ruling.report().c_str());
    }

    // ---- C. the kernel grammar (as transcribed) must accept every line ----
    for (const forge::ui::IrLine& line : app.commandLines) {
      const IrCheck v = forge::ui::validateIr(line);
      ++H.checks;
      if (v != IrCheck::Ok) {
        ++H.failures;
        std::printf("  FAIL [%s] validateIr refused an app-authored statement: %s -- %s\n",
                    t.id.c_str(), line.text().c_str(), forge::ui::toString(v));
      }
    }
  }

  std::printf("[differential] %zu of %zu trees carry an identical program on both paths\n", agreed,
              corpus.size());

  // ---- D. THE ARITY DIFFERENTIAL, ratcheted -------------------------------
  const std::vector<ArityGap> gaps = arityDifferential(bridge);
  std::size_t refusedTotal = 0;
  std::printf("[differential] kernel-legal argument counts the OpConstraintBridge REFUSES:\n");
  for (const ArityGap& g : gaps) {
    refusedTotal += g.refused.size();
    std::printf("    %-10s kernel accepts %zu..%zu, bridge refuses {%s}\n", g.op.c_str(),
                g.kernelMin, g.kernelMax, countList(g.refused).c_str());
  }
  std::printf("[differential] %zu refused counts across %zu of %zu user-invocable ops\n",
              refusedTotal, gaps.size(), bridge.allowedOps().size());

  // THE RATCHET. Both directions are checked on purpose:
  //   * a GROWTH is a new way for an Archie-emitted tree the kernel builds to be
  //     refused by the app, and the owner's constraint is REPRESENT / REPAIR /
  //     TOLERATE, never refuse.
  //   * a SHRINK without moving this pin is progress the ledger cannot see, and a
  //     ratchet that cannot notice progress stops being evidence.
  // Measured 2026-08-31 against the 28 user-invocable ops of vocabulary
  // sha 7e6f9c903385. Recorded in implementation/sacrosanct/findings/.
  CHECK_EQ_INT(refusedTotal, 61u);
  CHECK_EQ_INT(gaps.size(), 23u);

  // The gap is REAL only if the bridge really refuses one. Prove it on a live
  // statement rather than on a table read: FILLET(%1, 3) is the two-argument form
  // FeatureTree.hpp documents (`FILLET(%body, radius [, sel=ALL])`), it is what a
  // planner writes when it wants the default selector, and forge::ui's own
  // validateIr -- the kernel's rule -- accepts it.
  {
    forge::ui::IrLine defaulted;
    defaulted.id = 2;
    defaulted.op = "FILLET";
    defaulted.args = {forge::ui::IrArg::valueRef(1), forge::ui::IrArg::num(3)};
    CHECK_EQ_INT(static_cast<int>(forge::ui::validateIr(defaulted)), static_cast<int>(IrCheck::Ok));

    forge::ui::ProposedOp p;
    p.line = defaulted;
    p.selection = forge::ui::EntityKind::Edge;
    p.selectionCount = 1;
    const forge::ui::OpRuling r = bridge.check(p);
    CHECK_EQ_INT(static_cast<int>(r.verdict),
                 static_cast<int>(forge::ui::OpConstraint::WrongArity));
    std::printf("[differential] live positive control -- kernel-legal `%s` is refused: %s\n",
                defaulted.text().c_str(), r.reason.c_str());
  }

  // ---- E. THE COPILOT ARM -------------------------------------------------
  // Checks A-C drove `CommandRegistry::dispatch` with the selection nodes SPELLED
  // OUT, which is a menu click. The path the integration invariant actually names
  // is the CoPilot's, and it differs where it matters: a plan step cannot carry a
  // `%ref`, so `resolveSelection` CHOOSES the operands at apply time. An operand
  // chosen differently is a different solid built from the same request, and that
  // is invisible to every arm that states its operands.
  //
  // Reported per tree and RATCHETED on the divergence SET, not on a count: which
  // tree diverges is the fact, and a set that changes in either direction must be
  // read by a human before this pin moves.
  {
    std::vector<std::string> diverged;
    std::vector<std::string> unreachable;
    std::size_t copilotAgreed = 0;
    std::printf("[differential] the COPILOT arm (symbolic selection, resolved at apply time):\n");
    for (const forge::difftest::Tree& t : corpus) {
      const forge::difftest::CopilotRun c = forge::difftest::runViaCopilot(t, mutation);
      const std::string planner = forge::difftest::headlessProgram(t, mutation);

      if (c.reach != forge::difftest::CopilotReach::Reachable) {
        unreachable.push_back(t.id);
        std::printf("    %-22s UNREACHABLE -- no PlanSelect names the selection '%s' needs\n",
                    t.id.c_str(), c.unreachableStep.c_str());
        continue;
      }
      ++H.checks;
      if (c.check != forge::ui::PlanCheck::Ok) {
        ++H.failures;
        std::printf("  FAIL [%s] the CoPilot REFUSED a plan built entirely from registered\n"
                    "        commands: %s\n%s",
                    t.id.c_str(), forge::ui::toString(c.check), c.verdict.c_str());
        continue;
      }
      ++H.checks;
      if (!c.ran || !c.failure.empty()) {
        ++H.failures;
        std::printf("  FAIL [%s] the CoPilot did not apply its own plan: %s\n", t.id.c_str(),
                    c.failure.empty() ? "it never ran" : c.failure.c_str());
        continue;
      }

      // The bridge must accept what the CoPilot itself put in the document, and
      // the kernel grammar must too. A refusal here is a BRIDGE DEFECT for the
      // same reason it is in check B.
      std::vector<forge::ui::ProposedOp> plan;
      for (const forge::ui::IrLine& line : c.commandLines) {
        forge::ui::ProposedOp p;
        p.line = line;
        plan.push_back(p);
      }
      const PlanRuling ruling = bridge.check(plan, c.priorValues);
      ++H.checks;
      if (!ruling.allAccepted()) {
        ++H.failures;
        std::printf("  FAIL [%s] BRIDGE DEFECT -- the bridge refused %zu of %zu statements the\n"
                    "        CoPilot itself authored through the registry.\n%s",
                    t.id.c_str(), ruling.rejected, ruling.rulings.size(),
                    ruling.report().c_str());
      }
      for (const forge::ui::IrLine& line : c.commandLines) {
        const IrCheck v = forge::ui::validateIr(line);
        ++H.checks;
        if (v != IrCheck::Ok) {
          ++H.failures;
          std::printf("  FAIL [%s] validateIr refused a CoPilot-authored statement: %s -- %s\n",
                      t.id.c_str(), line.text().c_str(), forge::ui::toString(v));
        }
      }

      if (c.ir == planner) {
        ++copilotAgreed;
        std::printf("    %-22s agrees (%zu/%zu steps applied)\n", t.id.c_str(), c.applied,
                    c.requested);
      } else {
        diverged.push_back(t.id);
        std::printf("    %-22s DIVERGES -- the CoPilot chose different operands\n"
                    "        planner:\n%s        copilot:\n%s",
                    t.id.c_str(), planner.c_str(), c.ir.c_str());
      }
    }
    std::printf("[differential] copilot arm: %zu agree, %zu diverge, %zu unreachable, of %zu\n",
                copilotAgreed, diverged.size(), unreachable.size(), corpus.size());

    // THE RATCHET, on the SET. Measured 2026-08-31 after two repairs landed in
    // this same change:
    //
    //   * resolveSelection handed the `need` newest values NEWEST FIRST, and
    //     PartCommands.cpp registers the booleans with "the first pick is the
    //     target, the second is the tool". So every two-body boolean ran the
    //     wrong way round: block_bore_chamfer built CUT(%2, %1) -- the pin minus
    //     the block -- and boss_on_plate / prism_meets_tube reversed FUSE and
    //     COMMON, which is the same solid but the other surviving node.
    //   * PlanSelect had no WIRE value, so lofted_nozzle was UNREACHABLE and the
    //     LocalPlanner's own `loft` verb asked for a PROFILE it could not use.
    //
    // What REMAINS, and is pinned here rather than hidden: `resolveSelection`
    // takes exactly `signature.minCount` values, because a PlanStep names a value
    // KIND and never a COUNT. So an open-ended selection always gets the minimum:
    // the three-ring lofted_nozzle comes out as LOFT(%2, %3, RULED), a
    // two-section loft. It is a DIFFERENT SOLID and it is reported on every run.
    CHECK_EQ_INT(unreachable.size(), 0u);
    CHECK_EQ_INT(diverged.size(), 1u);
    CHECK_EQ_STR(diverged.empty() ? std::string() : diverged.front(),
                 std::string("lofted_nozzle"));
    if (mutation == Mutation::None && diverged.size() == 1) {
      std::printf("[differential] OPEN DEFECT -- a PlanStep names a value KIND and never a\n"
                  "               COUNT, so an open-ended selection gets signature.minCount\n"
                  "               values and no more. lofted_nozzle loses its first section.\n");
    }
  }

  // A mutation must have MOVED something. A --mutate run that reports the same
  // failure count as the clean run has not been proved to inject anything, and
  // that is exactly how a decorative gate looks from the outside.
  if (mutation != Mutation::None && H.failures == 0) {
    std::printf("[differential] MUTATION %s WAS NOT CAUGHT -- the gate is decoration.\n",
                forge::difftest::mutationName(mutation));
    ++H.checks;
    ++H.failures;
  }
  return H.finish();
}
