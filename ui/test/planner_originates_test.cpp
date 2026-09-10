// ui/test/planner_originates_test.cpp
//
// THE COPILOT MUST BE ABLE TO MAKE SOMETHING FROM NOTHING.
//
// Every verb in LocalPlanner's table CONSUMED geometry: a PROFILE, a WIRE or a
// SOLID. There was no box, no cylinder, no sphere, no sketch. MEASURED before this
// change, the table named 19 of the registry's 71 part commands -- 26.8% -- and not
// one of them could originate a body.
//
// The consequence is the whole product, not a rough edge: against an EMPTY document
// -- which is what a user opens -- the CoPilot could do nothing at all, while the
// registry carried all seven primitives sitting unreachable behind it. This was a
// wiring gap, not a missing capability.
//
// The test is written against the EMPTY-DOCUMENT case on purpose. A fixture that
// starts with a body already present cannot tell "can originate geometry" from
// "can edit geometry that happens to be there", which is exactly the distinction
// that went unnoticed.
#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"

#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::ui;

namespace {

int g_pass = 0;
int g_fail = 0;

void check(bool ok, const std::string& what, const std::string& detail = "") {
  std::printf("  %s  %s%s%s\n", ok ? "PASS" : "FAIL", what.c_str(),
              detail.empty() ? "" : " -- ", detail.c_str());
  ok ? ++g_pass : ++g_fail;
}

// The planner will not name a command the workspace does not hold -- it answers
// "this workspace's registry does not hold part.primitive_box". That is correct,
// and a first version of this test missed it by sending an EMPTY tool list: every
// case then failed for a reason that had nothing to do with the verb table, and
// the red-then-green control below "passed" for that same wrong reason. So the
// request carries the REAL registry.
struct Workspace {
  PartDocument doc;
  UndoStack undo;
  CommandRegistry registry;
  SelectionService selection;
  Workspace() { registerPartCommands(registry, doc, undo); }
};

PlanRequest ask(Workspace& ws, const std::string& intent) {
  PlanRequest r;
  r.id = 1;
  r.intent = intent;
  r.tools = planTools(ws.registry, ws.selection);
  // Deliberately EMPTY: no selection, no document. This is a new part.
  r.selectionSummary = "";
  r.documentSummary = "";
  return r;
}

}  // namespace

int main() {
  Workspace ws;
  LocalPlanner planner;

  std::printf("== an empty document: the CoPilot can now originate a body ==\n");
  struct Case {
    const char* intent;
    const char* commandId;
    const char* irOp;
  };
  const Case kCases[] = {
      {"make a box 60 40 20",            "part.primitive_box",      "BOX"},
      {"cube 25 25 25",                  "part.primitive_box",      "BOX"},
      {"cylinder radius 12 height 40",   "part.primitive_cylinder", "CYL"},
      {"sphere 15",                      "part.primitive_sphere",   "SPHERE"},
      {"cone 20 5 30",                   "part.primitive_cone",     "CONE"},
      {"torus 30 6",                     "part.primitive_torus",    "TORUS"},
      {"tube 20 14 50",                  "part.primitive_tube",     "TUBE"},
      {"prism 6 18 40",                  "part.primitive_prism",    "PRISM"},
  };
  for (const Case& c : kCases) {
    const PlanResponse reply = planner.plan(ask(ws, c.intent));
    const bool ok = reply.ok && !reply.plan.steps.empty();
    check(ok, std::string("\"") + c.intent + "\" produces a plan",
          ok ? reply.plan.steps[0].commandId : reply.error);
    if (!ok) continue;
    const PlanStep& s = reply.plan.steps[0];
    check(s.commandId == c.commandId, std::string("  -> ") + c.commandId, s.commandId);
    // A primitive runs on NOTHING. If it asked for a selection it could not be the
    // first step of an empty document, which is the entire point.
    check(s.select == PlanSelect::None, "  -> runs on no selection",
          s.select == PlanSelect::None ? "None" : "expects a selection");
  }

  std::printf("== the numbers in the sentence reach the command ==\n");
  {
    const PlanResponse reply = planner.plan(ask(ws, "make a box 60 40 20"));
    if (reply.ok && !reply.plan.steps.empty()) {
      const PlanStep& s = reply.plan.steps[0];
      check(s.args.size() >= 3, "three numbers become three arguments",
            std::to_string(s.args.size()) + " args");
      std::string names;
      for (const PlanArg& a : s.args) names += a.name + " ";
      check(names.find("dx") != std::string::npos && names.find("dy") != std::string::npos &&
                names.find("dz") != std::string::npos,
            "and they are named dx, dy, dz as the schema declares", names);
    } else {
      check(false, "box plan produced", reply.error);
    }
  }

  std::printf("== RED-THEN-GREEN: a consuming verb still refuses an empty document ==\n");
  std::printf("   (if everything passed on nothing, the select field would mean nothing)\n");
  {
    // FILLET consumes a SOLID. It must still ask for one -- otherwise the check
    // above ("runs on no selection") would be vacuous.
    const PlanResponse reply = planner.plan(ask(ws, "fillet 3"));
    if (reply.ok && !reply.plan.steps.empty()) {
      check(reply.plan.steps[0].select != PlanSelect::None,
            "fillet still expects a selection, so PlanSelect::None is meaningful");
    } else {
      check(true, "fillet declines on an empty document", reply.error);
    }
  }

  std::printf("== determinism: the same sentence twice is the same plan ==\n");
  {
    const PlanResponse a = planner.plan(ask(ws, "cylinder radius 12 height 40"));
    const PlanResponse b = planner.plan(ask(ws, "cylinder radius 12 height 40"));
    std::string sa, sb;
    for (const PlanStep& s : a.plan.steps) sa += s.display() + "|";
    for (const PlanStep& s : b.plan.steps) sb += s.display() + "|";
    check(sa == sb && !sa.empty(), "identical plans for an identical request", sa);
  }

  std::printf("\nRESULT: %d passed, %d failed\n", g_pass, g_fail);
  return g_fail == 0 ? 0 : 1;
}
