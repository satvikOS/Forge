// forge-desktop/test/copilot_gate.cpp
//
// THE HEADLESS ARCHIE COPILOT GATE — the gate that says an agent panel cannot do
// anything a user cannot do.
//
// It drives the REAL ForgeFrame, in real ImGui frames, with no window, no
// swapchain and no display: type an intent into the CoPilot panel, let the
// deterministic planner answer through the request/response seam, read the op
// plan the panel would show, press Apply, and then follow what actually happened
// all the way into the kernel:
//
//   intent -> PlanRequest -> Plan -> ForgeShell::run -> CommandRegistry::dispatch
//          -> PartDocument -> forge::ft::parse -> forge::ft::compile -> a SOLID
//
// The four claims asserted, none of them "it did not crash":
//
//   A. THE PANEL RAISES A REQUEST; IT DOES NO I/O. The request carries the LIVE
//      registry as its tool list, so a planner cannot name a command that does
//      not exist.
//   B. WHAT THE PANEL SHOWS IS WHAT WILL RUN. Every step's op is reconciled
//      against the command's own declared featureIrOp, and every required
//      parameter is stated (Apply is the RAW dispatch path — nothing is filled
//      in later).
//   C. APPLY GOES THROUGH THE ONE DOOR. The journal grows by exactly the planned
//      ids in order; the document's command-authored statements match them one
//      for one; every op that reaches the document is an op some registered
//      command declares. A private back door would break the last two at once.
//   D. THE BUTTON RECORDS INTENT AND THE FRAME APPLIES IT. Pressing Apply must
//      not mutate the document while the dock walk still holds references into
//      the containers it re-seats — the use-after-free this app has shipped
//      three times.
//
// PROVING THE GATE CAN FAIL: `--mutate <n>` injects defect n. Each one is a real
// regression a model-backed planner or a careless widget produces, expressed as
// data through the same seam a real planner would use:
//   1  the plan drops its selection contract     -> dispatch refuses on signature
//   2  the plan names a command that does not exist (a hallucinated tool)
//   3  the plan LABELS a step with an op the command does not emit
//   4  a statement reaches the document without a dispatch (a back door)
//   5  the plan omits a required argument
//   6  Apply mutates immediately instead of recording intent for after the walk
//   7  the plan hides a FORBIDDEN op inside a `selector` argument value
//   8  a `selector` value closes its quote and writes a whole further statement
//
// 7 and 8 are the op-constraint bypass. Every step of those plans names an
// allowed op, every parameter is declared, and every type is right -- the only
// thing wrong with them is what a VALUE says. They belong in this file because
// the claim being gated is about the APPLICATION: the panel a user presses
// Accept in must refuse them, and nothing may reach the kernel.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "imgui.h"

#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "PartFile.hpp"
#include "forge/ft/FeatureTree.hpp"
#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DockLayout.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/OpConstraintBridge.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace {

int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

// The intent every arm of this gate plans from. Two verbs, in an order where the
// second consumes what the first produced — the property a plan that is a
// SEQUENCE has and a plan that is a set does not.
//
// It deliberately does not begin with "extrude". The document already opens on a
// sketch that WAS extruded, so a second extrude of the same profile branches the
// program, and forge::ft's s0.4 graph-quality gate refuses a program whose ops do
// not all reach the result ("unexplained_orphans=1 [%2] — these ops contribute
// nothing to the result"). Section 9 exercises the profile-consuming path
// separately, where nothing is compiled.
const char* const kIntent = "fillet 4 then drill 8";
constexpr std::size_t kSteps = 2;

void check(bool ok, const char* what, const std::string& detail) {
  ++g_checks;
  if (!ok) {
    ++g_failures;
    std::printf("  FAIL  %-56s  %s\n", what, detail.c_str());
  }
}

template <typename A, typename B>
void checkEq(const A& got, const B& want, const char* what) {
  ++g_checks;
  if (!(got == static_cast<A>(want))) {
    ++g_failures;
    std::printf("  FAIL  %-56s  got %s want %s\n", what, std::to_string(got).c_str(),
                std::to_string(want).c_str());
  }
}

template <typename A, typename B>
void checkGe(const A& got, const B& floor, const char* what) {
  ++g_checks;
  if (!(got >= static_cast<A>(floor))) {
    ++g_failures;
    std::printf("  FAIL  %-56s  got %s, need >= %s\n", what, std::to_string(got).c_str(),
                std::to_string(floor).c_str());
  }
}

void checkStr(const std::string& got, const std::string& want, const char* what) {
  ++g_checks;
  if (got != want) {
    ++g_failures;
    std::printf("  FAIL  %-56s  got \"%s\" want \"%s\"\n", what, got.c_str(), want.c_str());
  }
}

std::string num(double v) {
  char b[64];
  std::snprintf(b, sizeof b, "%.10g", v);
  return std::string(b);
}

// A headless ImGui context: a null renderer backend and a font atlas with a
// texture id set is everything the draw lists need.
struct HeadlessImGui {
  HeadlessImGui(float w, float h) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(w, h);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "copilot_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

ImDrawData* buildOneFrame(forge::desktop::ForgeFrame& frame) {
  ImGui::NewFrame();
  frame.build(0, 1.0f);
  ImGui::Render();
  return ImGui::GetDrawData();
}

// Every op the LIVE registry can reach: the featureIrOp some registered command
// declares. This is the set derivation the whole design rests on — the reachable
// op set is a PROPERTY of the registry, not a list maintained beside it.
bool opIsCommandReachable(const forge::ui::CommandRegistry& registry, const std::string& op) {
  for (const std::string& id : registry.ids()) {
    const forge::ui::CommandDescriptor* d = registry.find(id);
    if (d != nullptr && !d->featureIrOp.empty() && d->featureIrOp == op) return true;
  }
  return false;
}

std::size_t commandAuthored(const forge::ui::PartDocument& doc) {
  std::size_t n = 0;
  for (const forge::ui::FeatureRecord& r : doc.records()) {
    if (!r.commandId.empty()) ++n;
  }
  return n;
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[copilot] MUTATION %d ACTIVE\n", g_mutation);

  // ── 0. the body the app opens with ───────────────────────────────────────
  forge::desktop::KernelScene scene;
  const bool built = scene.build();
  check(built, "kernel body builds", scene.error());
  if (!built) {
    std::printf("[copilot] cannot continue without geometry\n");
    return 1;
  }

  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();

  // ── 1. the panel is a first-class citizen of the dock model ──────────────
  {
    const forge::ui::DockLayout archie = forge::ui::defaultLayout(forge::ui::WorkspaceProfile::Archie);
    check(archie.hasPanel("archie_copilot"), "the Archie workspace holds archie_copilot", "");
    checkEq(archie.panelCount(), 8u, "the Archie workspace still has its 8 panels");
    check(archie.valid(), "the Archie layout is valid", "");
    // It survives a save/load, or it is not a dockable panel, it is a decoration.
    std::string text = archie.serialize();
    forge::ui::DockLayout back;
    check(forge::ui::DockLayout::parse(text, back), "the layout parses back", "");
    check(back.hasPanel("archie_copilot"), "the panel survives serialize -> parse", "");
    checkStr(back.serialize(), text, "serialize -> parse -> serialize is byte-identical");
  }

  shell.setWorkspace(forge::ui::WorkspaceProfile::Archie);
  // The Archie right column is the tab group at path {1,1}; CoPilot is its 2nd tab.
  frame.setActiveTabAt({1, 1}, 1);

  // ── 2. the document the CoPilot plans against is REAL ────────────────────
  // Both seeds must bind. A seed whose op the kernel does not know is refused by
  // PartDocument::appendFeature and binds NOTHING, which is how part.extrude,
  // part.revolve and part.loft were unreachable in the running application while
  // every gate stayed green.
  // Read from defaultPartStatements() rather than spelled as a count: the app's
  // opening part is a table in forge::desktop, and a gate that hardcodes its
  // length goes red the day the table gains a statement -- reporting a defect
  // where there is only a different part.
  checkGe(frame.document().valueFor(forge::desktop::defaultPartBodyNode()), 1,
          "the seeded SOLID is bound to the body node the app names");
  checkEq(frame.document().records().size(),
          forge::desktop::defaultPartStatements().size(),
          "every default-part statement became a record");
  // A seed whose op the kernel does not know is refused by appendFeature and
  // binds NOTHING, which is how part.extrude, part.revolve and part.loft were
  // unreachable in the running application while every gate stayed green.
  checkGe(frame.document().records().size(), 2u, "the opening document is not empty");

  // ── 3. typing raises a REQUEST; the frame does no I/O ────────────────────
  frame.setCopilotAutoPlan(false);  // the gate plays the app layer's transport
  frame.copilotType(kIntent);
  frame.copilotSubmit();
  {
    ImDrawData* dd = buildOneFrame(frame);
    check(dd != nullptr && dd->TotalVtxCount > 500, "the CoPilot panel draws a real frame", "");
  }
  const forge::ui::PlanRequest* req = frame.copilotRequest();
  check(req != nullptr, "the panel raised a request instead of calling out", "");
  if (req == nullptr) {
    std::printf("[copilot] no request was raised; nothing further is testable\n");
    std::printf("\n[copilot] %d checks, %d failures\n", g_checks, g_failures);
    return 1;
  }
  checkStr(req->intent, kIntent, "the request carries what was typed");
  checkEq(req->tools.size(), shell.registry().size(),
          "the request offers the LIVE registry as its tool list");
  {
    // ...and every offered tool is really in that registry, with the op the
    // descriptor declares. A planner reading this list cannot invent a command.
    std::size_t mismatched = 0;
    for (const forge::ui::PlanTool& t : req->tools) {
      const forge::ui::CommandDescriptor* d = shell.registry().find(t.id);
      if (d == nullptr || d->featureIrOp != t.featureIrOp) ++mismatched;
    }
    checkEq(mismatched, 0u, "every offered tool matches its live descriptor");
  }

  // ── 4. the planner answers through the seam ──────────────────────────────
  forge::ui::LocalPlanner planner;
  forge::ui::PlanResponse reply = planner.plan(*req);
  check(reply.ok, "the local planner produced a plan", reply.error);
  checkEq(reply.plan.size(), kSteps, "one step per verb in the request");
  {
    // Determinism: the same request twice is the same plan. A planner that
    // drifts cannot be gated, reviewed, or trusted with a document.
    const forge::ui::PlanResponse again = planner.plan(*req);
    std::string a, b;
    for (const forge::ui::PlanStep& s : reply.plan.steps) a += s.display() + "|";
    for (const forge::ui::PlanStep& s : again.plan.steps) b += s.display() + "|";
    checkStr(b, a, "the planner is deterministic for one request");
  }

  // ── the injected defects, delivered exactly as a real planner's reply is ──
  if (g_mutation == 1 && !reply.plan.steps.empty()) {
    for (forge::ui::PlanStep& s : reply.plan.steps) s.select = forge::ui::PlanSelect::Keep;
  }
  if (g_mutation == 2 && !reply.plan.steps.empty()) {
    reply.plan.steps[0].commandId = "part.emboss";
  }
  if (g_mutation == 3 && !reply.plan.steps.empty()) {
    reply.plan.steps[0].irOp = "CUT";
  }
  if (g_mutation == 5 && !reply.plan.steps.empty()) {
    reply.plan.steps[0].args.clear();
  }
  // 7 and 8 change NOTHING a name-and-type check can see: `selector` is declared
  // on part.fillet, it is declared as Text, and these are Text. Only the VALUE
  // is different, and the value is what becomes a feature-IR argument.
  if (g_mutation == 7 && !reply.plan.steps.empty()) {
    reply.plan.steps[0].args.push_back(forge::ui::PlanArg::str("selector", "SLOT"));
  }
  if (g_mutation == 8 && !reply.plan.steps.empty()) {
    reply.plan.steps[0].args.push_back(
        forge::ui::PlanArg::str("selector", "ALL\")\n%9 = SLOT(50, 20)\n#"));
  }

  // ── 5. what the panel SHOWS is what will RUN ─────────────────────────────
  // Reconciled independently of deliver(), against the live descriptors. These
  // are UNCONDITIONAL: a check that relaxes itself under its own mutation proves
  // nothing.
  {
    std::size_t unknown = 0, opMismatch = 0, underspecified = 0;
    for (const forge::ui::PlanStep& s : reply.plan.steps) {
      const forge::ui::CommandDescriptor* d = shell.registry().find(s.commandId);
      if (d == nullptr) {
        ++unknown;
        continue;
      }
      if (s.irOp != d->featureIrOp) ++opMismatch;
      if (!forge::ui::missingRequired(*d, s.params()).empty()) ++underspecified;
    }
    checkEq(unknown, 0u, "every planned command is in the live registry");
    checkEq(opMismatch, 0u, "the op the panel shows is the op the command emits");
    checkEq(underspecified, 0u, "every required argument is stated by the plan");
  }

  const forge::ui::PlanCheck verdict = frame.deliverCopilotPlan(reply);
  checkEq(static_cast<int>(verdict), static_cast<int>(forge::ui::PlanCheck::Ok),
          "the CoPilot accepted the delivered plan");
  check(frame.copilot().hasPlan(), "a plan is on offer", forge::ui::machineName(verdict));

  // ── 6. the panel draws a row per step ────────────────────────────────────
  {
    ImDrawData* dd = buildOneFrame(frame);
    check(dd != nullptr && dd->TotalVtxCount > 500, "the panel draws the plan", "");
    checkEq(frame.copilotRowsDrawn(), kSteps, "the panel drew a row per planned step");
    checkGe(frame.copilot().transcript().size(), 2u,
            "the transcript holds the ask and the answer");
  }

  // ── 7. Apply RECORDS INTENT; the frame applies it after the walk ─────────
  const std::size_t recordsBefore = frame.document().records().size();
  const std::size_t journalBefore = shell.journal().size();
  if (g_mutation == 6) {
    // MUTATION 6: the button applies immediately, which is exactly what a widget
    // that mutates mid-walk does — it re-seats the plan vector the panel's draw
    // loop is still walking. The public API makes that injectable without a
    // test-only knob.
    frame.copilot().apply(shell, frame.document());
  } else {
    frame.copilotApplyPlan();
  }
  checkEq(frame.document().records().size(), recordsBefore,
          "pressing Apply mutates nothing until the frame is over");
  {
    ImDrawData* dd = buildOneFrame(frame);
    check(dd != nullptr && dd->TotalVtxCount > 500, "the frame after Apply still draws", "");
  }
  checkEq(frame.layoutReseatsDuringWalk(), 0u,
          "no deferred mutation was applied during a walk");

  // ── 8. the one door: journal, document and op set all agree ──────────────
  {
    const std::vector<std::string>& j = shell.journal();
    checkEq(j.size(), journalBefore + kSteps, "one journalled dispatch per planned step");
    const char* const want[kSteps] = {"part.fillet", "part.hole"};
    for (std::size_t i = 0; i < kSteps; ++i) {
      const std::string got = journalBefore + i < j.size() ? j[journalBefore + i] : "<missing>";
      checkStr(got, want[i], "the journalled ids are the planned ids, in order");
    }
    checkEq(frame.document().records().size(), recordsBefore + kSteps,
            "one statement per applied step");

    std::size_t unreachable = 0, disagreeing = 0;
    for (const forge::ui::FeatureRecord& r : frame.document().records()) {
      if (r.commandId.empty()) continue;  // a seed, deliberately unattributed
      if (!opIsCommandReachable(shell.registry(), r.line.op)) ++unreachable;
      const forge::ui::CommandDescriptor* d = shell.registry().find(r.commandId);
      if (d == nullptr || d->featureIrOp != r.line.op) ++disagreeing;
    }
    checkEq(unreachable, 0u, "every op in the document is one a command declares");
    checkEq(disagreeing, 0u, "every statement names the op its own command emits");
    checkEq(commandAuthored(frame.document()), shell.journal().size(),
            "one command-authored statement per dispatch, exactly");
  }

  // ── 9. the same invariant, with a back door injected into it ─────────────
  // Section 8's last three checks are what catches a CoPilot that reaches past
  // the registry. That claim is only worth anything if a real back door turns it
  // red, so one is built here, in a document this gate owns.
  {
    forge::ui::ForgeShell probe;
    forge::ui::PartDocument doc;
    forge::ui::UndoStack undo;
    doc.seed(forge::ui::IrValueKind::Profile, "sketch.base", "RECT",
             {forge::ui::IrArg::num(80.0), forge::ui::IrArg::num(50.0)});
    doc.seed(forge::ui::IrValueKind::Solid, "body.bracket", "EXTRUDE",
             {forge::ui::IrArg::valueRef(1), forge::ui::IrArg::num(20.0)});
    forge::ui::registerPartCommands(probe.registry(), doc, undo);

    // This intent starts with a PROFILE-consuming verb, so the LatestProfile
    // resolution path is exercised here as well as LatestSolid above.
    forge::ui::PlanRequest r2;
    r2.id = 1;
    r2.intent = "extrude 30 then fillet 2";
    r2.tools = forge::ui::planTools(probe.registry(), probe.selection());
    const forge::ui::PlanResponse clean = planner.plan(r2);
    checkEq(clean.plan.size(), 2u, "the probe plan has both steps");
    const forge::ui::OpConstraintBridge probeBridge;
    const forge::ui::ApplyOutcome out =
        forge::ui::applyPlan(clean.plan, probe, doc, probeBridge);
    checkEq(out.applied, 2u, "a profile-consuming plan applies in a second document");
    check(out.allOk(), "every step of it landed", out.summary());
    // The EXTRUDE consumed the SEEDED PROFILE (%1), not the body: a step that
    // resolved its selection to the wrong value would still dispatch Ok.
    checkStr(doc.irProgram(),
             "%1 = RECT(80, 50)\n"
             "%2 = EXTRUDE(%1, 20)\n"
             "%3 = EXTRUDE(%1, 30)\n"
             "%4 = FILLET(%3, 2, ALL)\n",
             "the plan emitted the statements its ops imply, in order");

    if (g_mutation == 4) {
      // MUTATION 4: a statement written straight into the document, with a
      // command id on it, bypassing the registry entirely. This is precisely
      // what "the CoPilot got a private back door into the kernel" looks like in
      // the data — and BOX is an op no command declares.
      forge::ui::FeatureRecord back;
      back.irId = doc.nextIrId();
      back.commandId = "archie.direct";
      back.label = "back door";
      back.line = forge::ui::IrLine{back.irId,
                                    "BOX",
                                    {forge::ui::IrArg::num(5.0), forge::ui::IrArg::num(5.0),
                                     forge::ui::IrArg::num(5.0)}};
      back.produces = forge::ui::IrValueKind::Solid;
      check(doc.appendFeature(back, {}, "body_backdoor"), "the injected statement was written",
            forge::ui::toString(doc.lastCheck()));
    }

    std::size_t unreachable = 0;
    for (const forge::ui::FeatureRecord& rec : doc.records()) {
      if (rec.commandId.empty()) continue;
      if (!opIsCommandReachable(probe.registry(), rec.line.op)) ++unreachable;
    }
    checkEq(unreachable, 0u, "no op reached the document that no command declares");
    checkEq(commandAuthored(doc), probe.journal().size(),
            "no statement reached the document without a dispatch");
  }

  // ── 10. the program the CoPilot authored COMPILES to a solid ─────────────
  // Volume alone is never accepted here: a wrong solid reproducing a right volume
  // has been measured repeatedly in this programme.
  {
    const std::string program = frame.document().irProgram();
    std::printf("[copilot] --- the program the CoPilot authored ---\n%s\n", program.c_str());
    forge::ft::FeatureTree tree;
    bool parsed = true;
    try {
      tree = forge::ft::parse(program);
    } catch (const std::exception& e) {
      parsed = false;
      check(false, "the kernel parses the CoPilot's program", e.what());
    }
    if (parsed) {
      check(true, "the kernel parses the CoPilot's program", "");
      forge::ft::CompileResult res;
      bool threw = false;
      try {
        res = forge::ft::compile(tree);
      } catch (...) {
        threw = true;  // OCCT's Standard_Failure is not a std::exception
      }
      check(!threw, "compiling did not throw", "");
      check(res.ok, "the kernel compiles it to a solid", res.error);
      check(res.valid, "the solid is valid (watertight / manifold / oriented)",
            res.valid ? "true" : "false");
      check(res.handle != 0, "a shape handle was produced", std::to_string(res.handle));
      check(res.volume > 0.0, "volume is positive", num(res.volume));
      checkGe(res.faceCount, 6, "the solid has at least a box's faces");
      checkGe(res.edgeCount, 12, "the solid has at least a box's edges");
      // The bounding box is the check volume cannot make: a mispositioned or
      // mis-scaled solid can carry the right volume.
      const double dx = res.bboxMax[0] - res.bboxMin[0];
      const double dy = res.bboxMax[1] - res.bboxMin[1];
      const double dz = res.bboxMax[2] - res.bboxMin[2];
      check(dx > 79.0 && dx < 81.0, "bbox X spans the seeded profile's width", num(dx));
      check(dy > 49.0 && dy < 51.0, "bbox Y spans the seeded profile's height", num(dy));
      check(dz > 19.0 && dz < 21.0, "bbox Z spans the planned extrude distance", num(dz));
      check(res.volume < 80.0 * 50.0 * 20.0, "the plan REMOVED material (V < the raw prism)",
            num(res.volume) + " < " + num(80.0 * 50.0 * 20.0));
      // s0.4: a feature declared and parsed but never compiled is a missing
      // feature reported as a built part.
      check(res.nDeclared == res.nParsed && res.nParsed == res.nCompiled,
            "declared == parsed == compiled (s0.4 reconciles)",
            std::to_string(res.nDeclared) + "/" + std::to_string(res.nParsed) + "/" +
                std::to_string(res.nCompiled));
    }
  }

  // ── 11. a request outside the vocabulary is refused, not answered ────────
  {
    frame.copilotType("make it look nicer please");
    frame.copilotSubmit();
    buildOneFrame(frame);
    const forge::ui::PlanRequest* r = frame.copilotRequest();
    check(r != nullptr, "the panel raised a request for the unknown intent", "");
    if (r != nullptr) {
      const forge::ui::PlanResponse bad = planner.plan(*r);
      check(!bad.ok, "the planner refused an intent outside its vocabulary", "");
      check(!bad.error.empty(), "and said why", bad.error);
      const forge::ui::PlanCheck v = frame.deliverCopilotPlan(bad);
      checkEq(static_cast<int>(v), static_cast<int>(forge::ui::PlanCheck::PlannerFailed),
              "a refusal is recorded as a refusal");
      check(!frame.copilot().hasPlan(), "and no plan is offered for it", "");
    }
  }

  // -- 12. THE OP-CONSTRAINT GATE, END TO END --------------------------------
  //
  // Everything above proves the CoPilot can only name commands that exist. This
  // proves the stronger claim the op-constraint bridge exists for: it can only
  // EMIT ops a user could have emitted -- including through an argument.
  //
  // `part.fillet` builds a feature-IR argument out of its `selector` TEXT
  // parameter verbatim. So a plan can be perfectly well-formed by name and type
  // and still carry an op the app forbids. Two forms are gated here: the bare
  // forbidden op, and the injection that closes the quote and writes a whole
  // further statement (`IrLine::text()` escapes nothing, and forge::ft reads
  // statements LINE BY LINE).
  {
    // FIRST, MEASURED WITH THE REAL KERNEL: the smuggled text is not a
    // hypothetical. Parsed by forge::ft, it really does yield an op named
    // SLOT -- an op no forge::ui command declares.
    const std::string smuggled =
        "%1 = RECT(80, 50)\n"
        "%2 = EXTRUDE(%1, 20)\n"
        "%3 = FILLET(%2, 2, \"ALL\")\n"
        "%4 = SLOT(50, 20)\n";
    std::size_t slotOps = 0;
    try {
      const forge::ft::FeatureTree smuggledTree = forge::ft::parse(smuggled);
      for (const forge::ft::Op& op : smuggledTree.ops) {
        if (op.name == "SLOT") ++slotOps;
      }
    } catch (const std::exception& e) {
      check(false, "the smuggled text parses at all", e.what());
    }
    checkEq(slotOps, 1u,
            "the kernel really does read a SLOT out of the smuggled text");
    check(!opIsCommandReachable(shell.registry(), "SLOT"),
          "and SLOT is an op NO registered command declares", "");

    // SECOND, THE PANEL REFUSES BOTH FORMS. Delivered exactly as a model's reply
    // arrives, through the same seam section 4 used.
    const char* const kSmugglers[] = {"SLOT", "ALL\")\n%9 = SLOT(50, 20)\n#"};
    for (const char* selector : kSmugglers) {
      const std::size_t recordsBeforeSmuggle = frame.document().records().size();
      const std::size_t journalBeforeSmuggle = shell.journal().size();
      const std::string programBefore = frame.document().irProgram();

      frame.copilotType("fillet 4");
      frame.copilotSubmit();
      buildOneFrame(frame);
      const forge::ui::PlanRequest* sreq = frame.copilotRequest();
      check(sreq != nullptr, "a request was raised for the smuggling intent", "");
      if (sreq == nullptr) continue;

      forge::ui::PlanResponse smugglerReply = planner.plan(*sreq);
      check(smugglerReply.ok, "the planner produced the carrier plan", smugglerReply.error);
      if (!smugglerReply.ok || smugglerReply.plan.steps.empty()) continue;
      smugglerReply.plan.steps[0].args.push_back(
          forge::ui::PlanArg::str("selector", selector));

      // Name and type are BOTH right -- that is the whole point.
      {
        const forge::ui::CommandDescriptor* d =
            shell.registry().find(smugglerReply.plan.steps[0].commandId);
        bool declared = false;
        if (d != nullptr) {
          for (const forge::ui::ParamSpec& spec : d->schema) {
            if (spec.name == "selector" && spec.type == forge::ui::ParamType::Text) {
              declared = true;
            }
          }
        }
        check(declared, "the schema really does declare `selector` as Text", "");
      }

      const forge::ui::PlanCheck sv = frame.deliverCopilotPlan(smugglerReply);
      checkEq(static_cast<int>(sv),
              static_cast<int>(forge::ui::PlanCheck::OpConstraintRefused),
              "the op-constraint gate refused the plan");
      check(!frame.copilot().hasPlan(), "no plan is offered for it", "");

      // WHICH constraint, WHICH line, WHICH parameter -- the panel must be able
      // to say all three, or a user cannot act on the refusal.
      const forge::ui::StepVerdict* refusal = frame.copilot().verdict().firstRefusal();
      check(refusal != nullptr, "the verdict names a refused step", "");
      if (refusal != nullptr) {
        checkStr(refusal->parameter, "selector", "the verdict names the parameter");
        checkStr(refusal->commandId, "part.fillet", "the verdict names the command");
        check(refusal->constraint != forge::ui::OpConstraint::Ok,
              "the verdict names an op constraint",
              forge::ui::machineName(refusal->constraint));
        check(!refusal->reason.empty(), "and says why", refusal->reason);
        std::printf("[copilot] refused: %s\n", refusal->display().c_str());
      }

      // AND NOTHING RAN. Pressing Accept with nothing on offer must stay a
      // no-op, and the frame must keep drawing after it.
      frame.copilotApplyPlan();
      buildOneFrame(frame);
      checkEq(shell.journal().size(), journalBeforeSmuggle,
              "no dispatch was journalled for the refused plan");
      checkEq(frame.document().records().size(), recordsBeforeSmuggle,
              "no statement reached the document");
      checkStr(frame.document().irProgram(), programBefore,
               "the emitted program is byte-identical to before");
      check(frame.document().irProgram().find("SLOT") == std::string::npos,
            "and no SLOT reached the program", "");
      checkEq(frame.layoutReseatsDuringWalk(), 0u, "still no mid-walk mutation");
    }

    // THE POSITIVE CONTROL. The same command, the same parameter, a LEGITIMATE
    // value -- it must go all the way through. Without this the four checks
    // above would also pass if the CoPilot had simply stopped working.
    {
      const std::size_t journalBeforeControl = shell.journal().size();
      frame.copilotType("fillet 3");
      frame.copilotSubmit();
      buildOneFrame(frame);
      const forge::ui::PlanRequest* creq = frame.copilotRequest();
      check(creq != nullptr, "a request was raised for the control intent", "");
      if (creq != nullptr) {
        forge::ui::PlanResponse ok = planner.plan(*creq);
        if (ok.ok && !ok.plan.steps.empty()) {
          ok.plan.steps[0].args.push_back(forge::ui::PlanArg::str("selector", "VERTICAL"));
        }
        const forge::ui::PlanCheck cv = frame.deliverCopilotPlan(ok);
        checkEq(static_cast<int>(cv), static_cast<int>(forge::ui::PlanCheck::Ok),
                "a legitimate selector value is ACCEPTED");
        check(frame.copilot().hasPlan(), "and the plan is offered", "");
        frame.copilotApplyPlan();
        buildOneFrame(frame);
        checkEq(shell.journal().size(), journalBeforeControl + 1,
                "the control plan DID dispatch");
      }
    }
  }

  std::printf("\n[copilot] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures == 0) {
    std::printf("[copilot] ALL ARCHIE COPILOT GATES PASS "
                "(headless: no window, no swapchain, no socket)\n");
    return 0;
  }
  return 1;
}
