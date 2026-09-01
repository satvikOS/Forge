// forge-desktop/test/ir_pipeline_gate.cpp
//
// THE GATE THAT AUTHORISES DELETING THE JAVASCRIPT.
//
// forge::ui emits an SSA feature-IR program; forge::ft parses and compiles one. Both
// have existed for a while, and ui/test/part_commands_test.cpp calls the emitted text
// "kernel-legal" -- but it only compares that text against an expected STRING. Nothing
// ever fed a UI-authored program into the kernel, so "kernel-legal" was an assertion
// about characters, not about geometry. `ft::compile` appeared in ui/ exactly zero
// times.
//
// This gate closes the loop end to end, entirely in C++:
//
//     real Part commands  ->  PartDocument::irProgram()
//                         ->  forge::ft::parse()
//                         ->  forge::ft::compile()
//                         ->  a SOLID, asserted on a VECTOR of observables
//
// It drives the SAME registerPartCommands() registry the application does and
// dispatches through it, rather than hand-writing IR: a program assembled independently
// of the UI would prove the kernel can compile something, not that the UI emits
// something the kernel can compile.
//
// Volume alone is not accepted as proof here. A wrong solid reproducing a right volume
// to ten significant figures has been measured repeatedly in this programme, so the
// assertions below span validity, face and edge counts, volume AND the bounding box,
// plus the s0.4 declared/parsed/compiled reconciliation.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"

using namespace forge::ui;

namespace {

int failures = 0;
int checks = 0;

void check(bool ok, const std::string& what, const std::string& evidence) {
  ++checks;
  if (ok) {
    std::printf("  [PASS] %-52s %s\n", what.c_str(), evidence.c_str());
  } else {
    std::printf("  [FAIL] %-52s %s\n", what.c_str(), evidence.c_str());
    ++failures;
  }
}
std::string num(double v) {
  char b[64];
  std::snprintf(b, sizeof b, "%.10g", v);
  return std::string(b);
}
EntityRef ref(const std::string& node, EntityKind kind, const std::string& name) {
  return EntityRef{node, kind, name, 1};
}
CommandParams p1(const std::string& n, double v) {
  CommandParams p;
  p.setNumber(n, v);
  return p;
}

}  // namespace

int main() {
  std::printf("=== ir_pipeline_gate: forge::ui -> forge::ft -> a solid ===\n");

  PartDocument doc;
  UndoStack undo;
  CommandRegistry registry;
  SelectionService sel;
  const std::size_t added = registerPartCommands(registry, doc, undo);
  check(added > 0, "Part commands registered", std::to_string(added));

  // A sketch authored in the Sketch workspace, exactly as the app seeds one.
  const int sketchId = doc.seed(IrValueKind::Profile, "sketch_1", "RECT",
                                {IrArg::num(80), IrArg::num(60)});
  check(sketchId == 1, "sketch seeded as %1", std::to_string(sketchId));

  // ---- drive the REAL commands, through the registry the app uses ----------
  const int extrudeId = doc.nextIrId();
  sel.replaceWith({ref("sketch_1", EntityKind::Sketch, "s1")});
  DispatchResult r1 = registry.dispatch("part.extrude", sel, p1("distance", 20));
  check(r1.ok(), "part.extrude dispatched", "status=" + std::to_string(static_cast<int>(r1.status)));

  const std::string body = "body_" + std::to_string(extrudeId);
  const int filletId = doc.nextIrId();
  sel.replaceWith({ref(body, EntityKind::Edge, "e1")});
  DispatchResult r2 = registry.dispatch("part.fillet", sel, p1("radius", 4));
  check(r2.ok(), "part.fillet dispatched", "status=" + std::to_string(static_cast<int>(r2.status)));
  (void)filletId;

  // ---- the program the UI actually emits ----------------------------------
  const std::string program = doc.irProgram();
  std::printf("  --- emitted program ---\n");
  std::printf("%s\n", program.c_str());
  check(!program.empty(), "UI emitted a non-empty IR program",
        std::to_string(program.size()) + " bytes");

  // ---- parse it with the KERNEL's parser -----------------------------------
  forge::ft::FeatureTree tree;
  bool parsed = true;
  try {
    tree = forge::ft::parse(program);
  } catch (const std::exception& e) {
    parsed = false;
    check(false, "kernel PARSED the UI's program", std::string("threw: ") + e.what());
  }
  if (!parsed) {
    std::printf("\n[ir-pipeline] RED -- the UI emits a program its own kernel cannot parse.\n");
    return 1;
  }
  check(true, "kernel PARSED the UI's program", "ok");

  // ---- compile it into a solid --------------------------------------------
  const forge::ft::CompileResult res = forge::ft::compile(tree);
  check(res.ok, "kernel COMPILED it to a solid", res.ok ? "ok" : ("error: " + res.error));
  if (!res.ok) {
    std::printf("\n[ir-pipeline] RED -- parsed but did not compile. failedOpId=%d\n", res.failedOpId);
    return 1;
  }

  // ---- A VECTOR OF OBSERVABLES, never volume alone -------------------------
  check(res.valid, "the solid is valid (watertight/manifold/oriented)", res.valid ? "true" : "false");
  check(res.handle != 0, "a shape handle was produced", std::to_string(res.handle));
  check(res.volume > 0.0, "volume is positive", num(res.volume));
  check(res.faceCount > 0, "face count is positive", std::to_string(res.faceCount));
  check(res.edgeCount > 0, "edge count is positive", std::to_string(res.edgeCount));

  // A filleted 80 x 60 x 20 block: strictly less than the raw prism (the fillet only
  // removes material), and strictly more than 95% of it for r=4 on those dimensions.
  const double prism = 80.0 * 60.0 * 20.0;
  check(res.volume < prism, "fillet REMOVED material (V < the raw prism)",
        num(res.volume) + " < " + num(prism));
  check(res.volume > 0.95 * prism, "fillet removed only a rim (V > 95% of the prism)",
        num(res.volume) + " > " + num(0.95 * prism));

  // The bounding box is the check volume cannot make: a mispositioned or mis-scaled
  // solid can hold the right volume, and this is where that shows.
  const double dx = res.bboxMax[0] - res.bboxMin[0];
  const double dy = res.bboxMax[1] - res.bboxMin[1];
  const double dz = res.bboxMax[2] - res.bboxMin[2];
  check(dx > 79.0 && dx < 81.0, "bbox X spans the sketch width", num(dx));
  check(dy > 59.0 && dy < 61.0, "bbox Y spans the sketch height", num(dy));
  check(dz > 19.0 && dz < 21.0, "bbox Z spans the extrude distance", num(dz));

  // s0.4: a feature declared and parsed but never compiled is a missing feature
  // reported as a built part.
  check(res.nDeclared == res.nParsed && res.nParsed == res.nCompiled,
        "declared == parsed == compiled (s0.4 reconciles)",
        std::to_string(res.nDeclared) + "/" + std::to_string(res.nParsed) + "/" +
            std::to_string(res.nCompiled));

  // =========================================================================
  // PHASE 2 -- ★ SKETCH -> SOLVE -> PROFILE -> EXTRUDE -> a SOLID.
  //
  // The SKETCH value kind rests on one sentence: "a solved sketch IS a profile,
  // so EXTRUDE consumes it unmodified." Until this phase nothing measured it.
  // The family's own gate (forge-kernel/test/ft/sketch_solve_test.cpp) says so
  // in its header -- it stops at forge::extractProfileRings because linking
  // EXTRUDE would drag in the whole OCCT-backed kernel. This gate ALREADY links
  // that kernel, so the missing half belongs here and costs nothing extra.
  // Without it the fourth value kind is decorative: it can be produced and
  // solved, and nothing shows a SOLID ever comes out of one.
  //
  // Hand-written IR rather than dispatched commands, and the reason is worth
  // stating plainly: the seven sketch ops are still FORBIDDEN in
  // implementation/sacrosanct/archie_op_vocabulary.json because no forge::ui
  // command emits them, so no UI-authored program CAN contain one. This phase
  // therefore proves the KERNEL half only. Phase 1 above remains the UI half.
  //
  // ★ THE RECTANGLE IS DRAWN WRONG ON PURPOSE -- 61 x 41 and skewed. Only the
  // constraints say 60 x 40. That makes the assertions a POSITIVE CONTROL as
  // well as a measurement: a solver that silently did nothing, or an EXTRUDE
  // that quietly consumed the as-drawn seed instead of the solved geometry,
  // yields 61 x 41 and FAILS here. A gate built on an already-correct sketch
  // would pass in both worlds and prove nothing.
  {
    std::printf("\n  --- phase 2: a CONSTRAINED sketch, solved, then extruded ---\n");
    const char* sketchIr =
        "%1  = SKETCH(XY)\n"
        "%2  = SPT(%1, 0, 0)\n"
        "%3  = SPT(%1, 61, 2)\n"      // as-drawn: wrong length, and skewed
        "%4  = SPT(%1, 59, 41)\n"
        "%5  = SPT(%1, 1, 39)\n"
        "%6  = SLINE(%2, %3)\n"
        "%7  = SLINE(%3, %4)\n"
        "%8  = SLINE(%4, %5)\n"
        "%9  = SLINE(%5, %2)\n"
        "%10 = CON(%6, HORIZ)\n"
        "%11 = CON(%8, HORIZ)\n"
        "%12 = CON(%7, VERT)\n"
        "%13 = CON(%9, VERT)\n"
        "%14 = CON(%2, DIST, %3, 60)\n"
        "%15 = CON(%2, DIST, %5, 40)\n"
        "%16 = SOLVE(%1)\n"
        "%17 = EXTRUDE(%16, 10)\n"
        "RESULT(%17)\n";

    forge::ft::FeatureTree stree;
    bool sparsed = true;
    try {
      stree = forge::ft::parse(sketchIr);
    } catch (const std::exception& e) {
      sparsed = false;
      check(false, "the sketch program PARSED", std::string("threw: ") + e.what());
    }
    if (sparsed) {
      check(true, "the sketch program PARSED", "17 statements");
      const forge::ft::CompileResult s = forge::ft::compile(stree);
      for (const std::string& line : s.verify) std::printf("    verify| %s\n", line.c_str());
      check(s.ok, "SOLVE -> EXTRUDE COMPILED to a solid", s.ok ? "ok" : ("error: " + s.error));

      if (s.ok) {
        // The vector of observables again -- volume alone cannot separate a
        // correct 60 x 40 ring from a self-intersecting one of equal measure.
        check(s.valid, "the solid is valid (watertight/manifold/oriented)",
              s.valid ? "true" : "false");
        check(s.faceCount == 6, "a solved 4-line sketch extrudes to 6 faces",
              std::to_string(s.faceCount));
        check(s.edgeCount == 12, "and to 12 edges", std::to_string(s.edgeCount));

        const double sdx = s.bboxMax[0] - s.bboxMin[0];
        const double sdy = s.bboxMax[1] - s.bboxMin[1];
        const double sdz = s.bboxMax[2] - s.bboxMin[2];
        std::printf("    solved bbox = %s x %s x %s\n", num(sdx).c_str(), num(sdy).c_str(),
                    num(sdz).c_str());

        // ★ 1e-3 mm, AND THE OLD 1e-6 WAS BELOW THE SOLVER'S OWN REPRODUCIBILITY.
        //
        // The bar this case has to clear is 1 mm: the seed is 61 x 41 and the
        // constraints say 60 x 40, so ANY tolerance under 1 mm rejects a solver
        // that did nothing, and an EXTRUDE that consumed the as-drawn seed still
        // fails by a factor of a thousand. The old comment claimed 1e-6 was
        // required to keep the positive control alive -- "anything looser would
        // also accept the 61 x 41 seed" -- and that is simply not true of any
        // number below 1.0. It bought no strictness against the defect; it bought
        // strictness against ARITHMETIC.
        //
        // MEASURED, twice, on the same commit (CI run 33542797683, attempts 1 and
        // 2 of the desktop job):
        //
        //     attempt 1   solved bbox = 60.00000125 x 39.99999999   -> X failed
        //     attempt 2   solved bbox = 60          x 39.99999821   -> Y failed
        //
        // Same sha, same sources, DIFFERENT residuals, and a different axis red
        // each time. planegcs solves by DogLeg iteration and converges on the
        // constraint error function, not on a coordinate, so the last ulps of a
        // bbox edge are not reproducible run to run. A gate pinned tighter than
        // that is a coin toss wearing an assertion's clothes -- it cannot pass
        // reliably even when the code is right, which is worse than no gate,
        // because a red that means nothing teaches everyone to ignore it.
        //
        // 1e-3 mm is three orders of magnitude above the ~1.8e-6 mm spread those
        // two runs show, and three orders BELOW the 1 mm the positive control
        // needs. It is also exactly the tolerance the volume check below already
        // uses, so the block now states one standard instead of two.
        //
        // NOT DONE HERE, and worth saying so: the other repair is to tighten the
        // solver -- convergence, or a final Newton polish on the solved
        // parameters -- so the coordinates ARE reproducible to 1e-6. That is a
        // change to the sketcher's contract rather than to this gate, it needs
        // its own measurement across many solves, and it belongs to whoever owns
        // Sketcher::solve. This commit only stops a correct solve from failing at
        // random.
        check(std::abs(sdx - 60.0) < 1e-3, "CONSTRAINTS moved X to 60 (as-drawn was 61)",
              num(sdx));
        check(std::abs(sdy - 40.0) < 1e-3, "CONSTRAINTS moved Y to 40 (as-drawn was 41)",
              num(sdy));
        check(std::abs(sdz - 10.0) < 1e-6, "EXTRUDE applied the 10 mm distance", num(sdz));
        check(std::abs(s.volume - 60.0 * 40.0 * 10.0) < 1e-3,
              "volume is the solved prism, not the as-drawn one", num(s.volume));
        check(s.nDeclared == s.nParsed && s.nParsed == s.nCompiled,
              "declared == parsed == compiled (s0.4 reconciles)",
              std::to_string(s.nDeclared) + "/" + std::to_string(s.nParsed) + "/" +
                  std::to_string(s.nCompiled));
      }
    }
  }

  std::printf("\n[ir-pipeline] %d checks, %d failures -- %s\n", checks, failures,
              failures == 0 ? "PASS" : "FAIL");
  if (failures == 0) {
    std::printf("[ir-pipeline] GREEN -- a UI-authored program compiled to a solid entirely in C++.\n");
  }
  return failures == 0 ? 0 : 1;
}
