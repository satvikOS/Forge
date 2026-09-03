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
// SIX CHECKS:
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
//   E. THE COPILOT ARM -- the path the invariant actually NAMES. A-D drive
//      CommandRegistry::dispatch with the selection nodes spelled out, which is a
//      menu click. A CoPilot plan step cannot carry a %ref, so resolveSelection
//      CHOOSES the operands at apply time, and an operand chosen differently is a
//      different solid built from the same request. Ratcheted on the divergence
//      SET, because WHICH tree diverges is the fact.
//   F. THE forge_verify TRANSCRIPT READER, which tier 2's fourth arm depends on.
//      It needs no kernel, so it is checked here rather than only in the macOS
//      job behind an OCCT build -- against a line captured VERBATIM from the
//      verifier, not written from its protocol comment.
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
#include "verify_transcript.hpp"

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
  CHECK_EQ_INT(corpus.size(), 9u);

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
  std::printf("[differential] kernel-legal argument counts NO forge::ui command can author "
              "(a gap in the COMMAND SET, not a refusal -- see the live sweep below):\n");
  for (const ArityGap& g : gaps) {
    refusedTotal += g.refused.size();
    // "no command emits", NOT "the bridge refuses" -- since the kernel's range
    // became the refusal boundary the bridge refuses none of these, and a line
    // that still called them refusals would be the stalest kind of comment: one
    // the gate itself prints.
    std::printf("    %-10s kernel accepts %zu..%zu, no command emits {%s}\n", g.op.c_str(),
                g.kernelMin, g.kernelMax, countList(g.refused).c_str());
  }
  std::printf("[differential] %zu unauthorable counts across %zu of %zu user-invocable ops\n",
              refusedTotal, gaps.size(), bridge.allowedOps().size());

  // THE RATCHET, on the CAPABILITY GAP. `arityDifferential` reads the vocabulary
  // TABLE: these 61 counts are the forms the kernel builds and no forge::ui
  // command can author. That gap is a fact about the COMMAND SET and closing it
  // means writing commands, so the pin stays where it was and stays two-directional:
  //   * a GROWTH is a new kernel-legal form the app cannot reach.
  //   * a SHRINK without moving this pin is progress the ledger cannot see, and a
  //     ratchet that cannot notice progress stops being evidence.
  // Measured 2026-08-31 against the 28 user-invocable ops. UNCHANGED by this
  // commit -- what changed is what the BRIDGE DOES about it, swept below.
  CHECK_EQ_INT(refusedTotal, 61u);
  CHECK_EQ_INT(gaps.size(), 23u);

  // ---- D2. AND THE BRIDGE MUST REFUSE NONE OF THEM ------------------------
  // The gap above is a table read. THIS is the live behaviour, and it is the
  // owner's constraint made executable: REPRESENT / REPAIR / TOLERATE, never
  // refuse. "dont gate anything if you do that then how will Archie generate
  // ultra long feature trees for Kernel to execute".
  //
  // Every one of the 61 kernel-legal forms is driven through the REAL bridge.
  // None may come back WrongArity -- that verdict now belongs to forms the
  // KERNEL cannot build, which is a fact about the statement rather than a fact
  // about which buttons the app happens to have. A statement may still be
  // refused for a different reason (a leading %ref it should not have, a value
  // kind it cannot consume); those are separate rules with their own tests, and
  // this sweep rules only on the one it is about.
  //
  // Swept, not sampled: a single positive control is one row of a table of 61,
  // and it was the row someone happened to pick.
  {
    std::size_t swept = 0;
    std::size_t refusedForArity = 0;
    std::size_t toleratedAndRecorded = 0;
    std::string firstRefusal;
    for (const ArityGap& g : gaps) {
      const OpVocabulary::Op* op = bridge.vocabulary().find(g.op);
      if (op == nullptr) continue;
      for (const std::size_t n : g.refused) {
        forge::ui::IrLine line;
        line.id = 2;
        line.op = g.op;
        for (std::size_t i = 0; i < n; ++i) {
          line.args.push_back(i == 0 && op->firstArgIsValueRef ? forge::ui::IrArg::valueRef(1)
                                                               : forge::ui::IrArg::num(1));
        }
        forge::ui::ProposedOp p;
        p.line = line;
        const forge::ui::OpRuling r = bridge.check(p);
        ++swept;
        if (r.verdict == forge::ui::OpConstraint::WrongArity) {
          ++refusedForArity;
          if (firstRefusal.empty()) firstRefusal = r.reason;
        }
        if (r.accepted() && !r.tolerated.empty()) ++toleratedAndRecorded;
      }
    }
    // Every line self-standing and prefixed: run_differential_gate.sh prints the
    // clean run with `grep -E '^\[differential\]'`, so an indented continuation
    // line is dropped from the CI log and the measurement stops being visible.
    std::printf("[differential] the %zu kernel-legal forms no command emits, driven through "
                "the LIVE bridge: %zu refused for arity, %zu accepted AND recorded\n",
                swept, refusedForArity, toleratedAndRecorded);
    if (!firstRefusal.empty()) {
      std::printf("[differential] first refusal: %s\n", firstRefusal.c_str());
    }
    CHECK_EQ_INT(swept, 61u);
    CHECK_EQ_INT(refusedForArity, 0u);
    // Tolerating must not mean forgetting: every one carries the note that says
    // the app cannot author it, or the capability gap becomes invisible.
    CHECK_EQ_INT(toleratedAndRecorded, 61u);
  }

  // The two documented forms, named rather than counted, because they are the
  // ones FeatureTree.hpp itself writes down and they were both refused:
  //   FILLET(%body, radius [, sel=ALL])   CHAMFER(%body, distance [, sel=ALL])
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
    CHECK(r.accepted());
    CHECK(!r.tolerated.empty());
    std::printf("[differential] `%s` -- the form FeatureTree.hpp documents -- is now ACCEPTED: %s\n",
                defaulted.text().c_str(), r.tolerated.c_str());
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
                    t.id.c_str(), forge::ui::machineName(c.check), c.verdict.c_str());
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
    //   * and the third, closed here: `resolveSelection` took exactly
    //     `signature.minCount` values because a PlanStep named a value KIND and
    //     never a COUNT, so an open-ended selection always got the MINIMUM. The
    //     three-ring lofted_nozzle was applied as LOFT(%2, %3, RULED) -- a
    //     two-section loft, a DIFFERENT SOLID, from a plan that named three
    //     rings, with no error raised anywhere. `PlanStep::selectCount` carries
    //     the count now; 0 still means "the signature's minimum", so a step that
    //     states nothing is unchanged.
    //
    // THE SET IS NOW EMPTY, and it is asserted empty rather than deleted: a
    // ratchet that stops being checked when it reaches zero cannot notice the
    // next divergence. `diverged` is printed in full on every run above, so a
    // regression names the tree that broke.
    CHECK_EQ_INT(unreachable.size(), 0u);
    CHECK_EQ_INT(diverged.size(), 0u);
    CHECK_EQ_INT(copilotAgreed, corpus.size());
  }

  // ---- F. THE forge_verify TRANSCRIPT READER ------------------------------
  // Tier 2's fourth arm runs the forge_verify BINARY and reads its JSON. That
  // reader is the riskiest part of the arm and the LEAST convenient place to
  // debug it: it would otherwise only ever execute in the macOS `kernel` job,
  // behind an OCCT build. It needs no kernel, so it is checked here, on every PR,
  // against a line captured VERBATIM from the pinned native verifier rather than
  // written from the protocol comment -- which does not list `bodies`,
  // `vertexCount`, or the `bores` array whose own `cx`/`at`/`axis` are exactly the
  // kind of thing a careless field search collides with.
  {
    const forge::difftest::VerifierLine v =
        forge::difftest::parseVerifierLine(forge::difftest::capturedVerifierLine());
    CHECK(v.present);
    CHECK_EQ_STR(v.id, std::string("t1"));
    CHECK(v.ok);
    CHECK(v.valid);
    CHECK_NEAR(v.volume, 21738.053289, 1e-9);
    CHECK_EQ_INT(static_cast<int>(v.faceCount), 7);
    CHECK_EQ_INT(static_cast<int>(v.edgeCount), 15);
    CHECK(v.hasTopo);
    CHECK_EQ_INT(static_cast<int>(v.genus), 1);
    CHECK_EQ_INT(static_cast<int>(v.shellCount), 1);
    // The bbox, and NOT the `at`/`axis` triples of the bores array that follows it.
    CHECK(v.hasBbox);
    CHECK_NEAR(v.bboxMin[0], -20.0, 1e-12);
    CHECK_NEAR(v.bboxMin[1], -15.0, 1e-12);
    CHECK_NEAR(v.bboxMin[2], 0.0, 1e-12);
    CHECK_NEAR(v.bboxMax[0], 20.0, 1e-12);
    CHECK_NEAR(v.bboxMax[1], 15.0, 1e-12);
    CHECK_NEAR(v.bboxMax[2], 20.0, 1e-12);
    // THE NEGATIVE HALF, and the one that matters most. This line is from a
    // verifier built BEFORE area and com were added, so both must report ABSENT.
    // A reader that answered 0.0 here would agree with an arm that measured a
    // centre of mass at the origin, which is where a great many parts have one.
    CHECK(!v.hasArea);
    CHECK(!v.hasCom);
    CHECK_NEAR(v.area, 0.0, 1e-12);

    const forge::difftest::VerifierLine w = forge::difftest::parseVerifierLine(
        forge::difftest::capturedVerifierLineWithMassProps());
    CHECK(w.hasArea);
    CHECK_NEAR(w.area, 6209.734156, 1e-9);
    CHECK(w.hasCom);
    CHECK_NEAR(w.com[0], -0.5, 1e-12);
    CHECK_NEAR(w.com[1], 0.25, 1e-12);
    CHECK_NEAR(w.com[2], 9.875, 1e-12);
    // com must not have been read out of the bores array's `at`/`axis`.
    CHECK(w.hasBbox);
    CHECK_NEAR(w.bboxMax[2], 20.0, 1e-12);

    // A line with nothing in it must report ABSENT everywhere rather than zero.
    const forge::difftest::VerifierLine e = forge::difftest::parseVerifierLine("{}");
    CHECK(!e.hasArea);
    CHECK(!e.hasCom);
    CHECK(!e.hasBbox);
    CHECK(!e.hasTopo);
    CHECK(!e.ok);
    CHECK_EQ_STR(e.id, std::string());
    std::printf("[differential] forge_verify transcript reader: checked against a CAPTURED "
                "line\n");
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
