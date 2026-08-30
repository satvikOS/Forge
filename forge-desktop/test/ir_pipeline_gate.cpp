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

  std::printf("\n[ir-pipeline] %d checks, %d failures -- %s\n", checks, failures,
              failures == 0 ? "PASS" : "FAIL");
  if (failures == 0) {
    std::printf("[ir-pipeline] GREEN -- a UI-authored program compiled to a solid entirely in C++.\n");
  }
  return failures == 0 ? 0 : 1;
}
