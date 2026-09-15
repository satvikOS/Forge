// forge-desktop/test/archie_model_gate.cpp
//
// THE ARCHIE MODEL GATE — a prompt typed into Forge's CoPilot panel reaches a
// model service OVER REAL LOOPBACK HTTP, and the plan that comes back goes through
// Forge's validators and the kernel into a part whose geometry is measured.
//
//   ForgeFrame CoPilot input -> PlanRequest -> forge::archie::ArchieLink
//     -> GET /health, POST /plan on 127.0.0.1 (a real socket, a real server)
//     -> the sidecar's reply -> RemotePlanner::parseReply -> validatePlan
//     -> Accept -> ForgeShell::run -> PartDocument -> KernelScene rebuild
//     -> forge::ft::compile -> an observable VECTOR -> the feature tree
//
// WHAT WAS WRONG, and what each section holds shut:
//   * The app reached the model ONLY with FORGE_ARCHIE_ENDPOINT set, which a
//     Finder launch never has; everyone else talked to a verb matcher and the
//     panel did not say so. (sections 1, 3, 4; mutation 1)
//   * The request carried no tool schemas, so the sidecar's bridge could name no
//     parameter and every value the model emitted was dropped. (section 5;
//     mutation 2)
//   * The plan call ran inside the frame: a model thinking froze the window.
//     (section 4; mutation 3)
//   * An applied plan was drawn as "NOT OFFERED", and "every step dispatched"
//     was reported whether or not the kernel built the part. (sections 7, 9)
//   * The only test between app and sidecar used a FAKE transport.
//
// HERMETIC. The model service is archie/test/LoopbackSidecarStub.hpp, bound to an
// ephemeral 127.0.0.1 port inside this process and answering in serve.py's exact
// format with a plan RECORDED from the sidecar's own ir_bridge (see
// test/fixtures/archie/README.md). No model, no GPU, no ~/.forge-health, and
// nothing on port 8731 is touched -- a real sidecar running on this machine
// cannot answer for the stub. Real-model runs are evidence, not this gate.
//
// PROVING THE GATE CAN FAIL: `--mutate <n>`
//   1  discovery off -- the copilot is left with the built-in commands, which is
//      what every Finder launch got before this change
//   2  the request's tools carry no schema -- the wire format before this change
//   3  a planner service that WAITS for the model inside start() -- the frame
//      freeze the synchronous call had
//   4  the model places both holes off the part (x = +/-60 on an 80 mm plate):
//      every step validates and dispatches, and only the measured geometry can
//      tell that the part is wrong
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <functional>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "imgui.h"

#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "LoopbackSidecarStub.hpp"
#include "forge/archie/ArchieLink.hpp"
#include "forge/archie/RemotePlanner.hpp"
#include "forge/ft/FeatureTree.hpp"
#include "forge/retrieval/Json.hpp"
#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace {

int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

void check(bool ok, const char* what, const std::string& detail = std::string()) {
  ++g_checks;
  if (ok) {
    std::printf("  ok    %s\n", what);
    return;
  }
  ++g_failures;
  std::printf("  FAIL  %-60s  %s\n", what, detail.c_str());
}

std::string num(double v) {
  char b[64];
  std::snprintf(b, sizeof b, "%.6g", v);
  return b;
}

using Clock = std::chrono::steady_clock;
double msSince(Clock::time_point t0) {
  return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

bool waitFor(const std::function<bool()>& cond, int timeoutMs) {
  const auto t0 = Clock::now();
  while (!cond()) {
    if (msSince(t0) > timeoutMs) return false;
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  return true;
}

struct HeadlessImGui {
  HeadlessImGui(float w, float h) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(w, h);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "archie_model_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

void buildOneFrame(forge::desktop::ForgeFrame& frame) {
  ImGui::NewFrame();
  frame.build(0, 1.0f);
  ImGui::Render();
}

std::string readFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

std::string repoRoot() {
  if (const char* r = std::getenv("FORGE_DESKTOP_ROOT")) return r;
  return FORGE_DESKTOP_REPO_ROOT;
}

struct Measure {
  bool ok = false;
  bool valid = false;
  double volume = 0.0;
  double dx = 0.0, dy = 0.0, dz = 0.0;
  int faces = 0;
  bool reconciled = false;
  std::string error;
};

Measure measure(const std::string& program) {
  Measure m;
  try {
    const forge::ft::FeatureTree tree = forge::ft::parse(program);
    const forge::ft::CompileResult r = forge::ft::compile(tree);
    m.ok = r.ok;
    m.valid = r.valid;
    m.volume = r.volume;
    m.dx = r.bboxMax[0] - r.bboxMin[0];
    m.dy = r.bboxMax[1] - r.bboxMin[1];
    m.dz = r.bboxMax[2] - r.bboxMin[2];
    m.faces = r.faceCount;
    m.reconciled = r.nDeclared == r.nParsed && r.nParsed == r.nCompiled;
    m.error = r.error;
  } catch (const std::exception& e) {
    m.error = e.what();
  } catch (...) {
    m.error = "compile threw a non-std exception";
  }
  return m;
}

std::string lastSystemLine(const forge::desktop::ForgeFrame& frame) {
  std::string text;
  for (const forge::ui::TranscriptLine& l : frame.copilot().transcript()) {
    if (l.role == forge::ui::TranscriptRole::System) text = l.text;
  }
  return text;
}

// ── the mutations that live in the service, not in the app ────────────────
// Each wraps the REAL link and changes one thing a regressed implementation
// would change. Nothing in production code knows they exist.
class Decorated final : public forge::ui::PlannerService {
 public:
  explicit Decorated(forge::ui::PlannerService& inner) : inner_(inner) {}
  bool stripSchema = false;  // mutation 2
  bool blockInStart = false; // mutation 3

  forge::ui::ModelState state() const override { return inner_.state(); }
  bool start(const forge::ui::PlanRequest& request) override {
    forge::ui::PlanRequest rq = request;
    if (stripSchema) {
      for (forge::ui::PlanTool& t : rq.tools) t.schema.clear();
    }
    if (!inner_.start(rq)) return false;
    if (blockInStart) {
      // The synchronous call: wait here, inside the frame, for the model.
      const auto t0 = Clock::now();
      while (!inner_.poll(held_, heldFailed_)) {
        if (msSince(t0) > 30000) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
      }
      holding_ = true;
    }
    return true;
  }
  bool poll(forge::ui::PlanResponse& out, bool& transportFailed) override {
    if (holding_) {
      holding_ = false;
      out = held_;
      transportFailed = heldFailed_;
      return true;
    }
    return inner_.poll(out, transportFailed);
  }
  bool busy() const override { return holding_ || inner_.busy(); }

 private:
  forge::ui::PlannerService& inner_;
  forge::ui::PlanResponse held_;
  bool heldFailed_ = false;
  bool holding_ = false;
};

// Turn the model's answer around: waits frame by frame, as the app does.
bool driveUntilAnswered(forge::desktop::ForgeFrame& frame, int timeoutMs) {
  const auto t0 = Clock::now();
  do {
    buildOneFrame(frame);
    if (!frame.copilotAwaitingModel()) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(15));
  } while (msSince(t0) < timeoutMs);
  return !frame.copilotAwaitingModel();
}

const char* const kIntent =
    "drill two 6 mm through holes, 25 mm either side of the centre bore";

}  // namespace

int main(int argc, char** argv) {
  std::string dumpRequestPath;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
    if (std::strcmp(argv[i], "--dump-request") == 0 && i + 1 < argc) dumpRequestPath = argv[++i];
  }
  if (g_mutation != 0) std::printf("[archie-model] MUTATION %d ACTIVE\n", g_mutation);

  const std::string fixtureDir = repoRoot() + "/forge-desktop/test/fixtures/archie";
  std::string holesReply = readFile(fixtureDir + "/plan_two_holes.json");
  // Recording mode needs no fixture: it exists to capture the request the
  // fixtures are then generated from (see fixtures/archie/README.md).
  if (holesReply.empty() && !dumpRequestPath.empty()) {
    holesReply = "{\"ok\": false, \"error\": \"recording the request\"}";
  }
  const std::string holesOffPartReply = readFile(fixtureDir + "/plan_two_holes_off_part.json");
  const std::string filletTooBigReply = readFile(fixtureDir + "/plan_fillet_too_big.json");
  const std::string refusalReply = readFile(fixtureDir + "/plan_refused.json");
  check(!holesReply.empty() && !filletTooBigReply.empty() && !refusalReply.empty() &&
            !holesOffPartReply.empty(),
        "the recorded sidecar replies are on disk", fixtureDir);
  if ((holesReply.empty() || filletTooBigReply.empty()) && dumpRequestPath.empty()) return 1;

  // ── 0. the application as it opens ────────────────────────────────────────
  forge::desktop::KernelScene scene;
  check(scene.build(), "the starter part builds", scene.error());
  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();
  shell.setWorkspace(forge::ui::WorkspaceProfile::Archie);
  frame.setActiveTabAt({1, 1}, 1);  // the CoPilot tab, as copilot_gate opens it
  buildOneFrame(frame);
  check(frame.copilotAutoPlan(), "the CoPilot answers by itself, as in the shipped app");

  // ── 1. THE DEFAULT IS DISCOVERY ───────────────────────────────────────────
  // main.cpp builds its link from exactly this call. With the variable unset --
  // every Finder launch -- the app must LOOK for the model, on serve.py's port.
  {
    const forge::archie::LinkConfig unset = forge::archie::configFromEnvironment(nullptr);
    check(!unset.off, "with FORGE_ARCHIE_ENDPOINT unset the app looks for the model", unset.why);
    check(unset.endpoint.host == "127.0.0.1" && unset.endpoint.port == 8731,
          "  ...on 127.0.0.1:8731, serve.py's default port",
          unset.endpoint.host + ":" + std::to_string(unset.endpoint.port));
    check(unset.endpoint.path == "/plan" && unset.endpoint.healthPath == "/health",
          "  ...asking /health and /plan", unset.endpoint.path);
    const forge::archie::LinkConfig off = forge::archie::configFromEnvironment("off");
    check(off.off, "FORGE_ARCHIE_ENDPOINT=off switches the model off", off.why);
    const forge::archie::LinkConfig elsewhere =
        forge::archie::configFromEnvironment("127.0.0.1:9123");
    check(!elsewhere.off && elsewhere.endpoint.port == 9123,
          "FORGE_ARCHIE_ENDPOINT=127.0.0.1:9123 overrides the port", elsewhere.why);
    const forge::archie::LinkConfig v6 = forge::archie::configFromEnvironment("[::1]:9124");
    check(!v6.off && v6.endpoint.host == "::1" && v6.endpoint.port == 9124,
          "an IPv6 loopback override is read", v6.why);
    for (const char* bad : {"10.0.0.5:8731", "localhost:8731", "example.com:80", "127.0.0.1:0",
                            "127.0.0.1:99999"}) {
      const forge::archie::LinkConfig c = forge::archie::configFromEnvironment(bad);
      check(c.off && !c.why.empty(), "a non-loopback or malformed override is refused, not followed",
            bad);
    }
  }

  // A config for a port THIS process owns. Everything but the port is the
  // default main.cpp gets; the probe interval is shortened so the gate is quick.
  auto configFor = [](std::uint16_t port) {
    forge::archie::LinkConfig cfg = forge::archie::configFromEnvironment(nullptr);
    cfg.endpoint.port = port;
    cfg.probeEveryMs = 100;
    cfg.recheckEveryMs = 150;
    if (g_mutation == 1) cfg.off = true;
    return cfg;
  };

  // ── 2. NO MODEL SERVICE: the built-in commands answer, and the panel SAYS so ─
  {
    // A port that was just free and is now closed: nothing answers on it.
    forge::archie::test::LoopbackSidecarStub probe;
    std::string why;
    check(probe.start(0, why), "a free loopback port was found", why);
    const std::uint16_t closedPort = probe.port();
    probe.stop();

    forge::archie::ArchieLink nobody(configFor(closedPort));
    frame.setCopilotModel(&nobody);
    if (g_mutation != 1) {
      check(waitFor([&] { return nobody.probesCompleted() >= 1; }, 5000),
            "the link probed the port within 5 s", std::to_string(nobody.probesCompleted()));
    }
    check(frame.copilotModelState() != forge::ui::ModelState::Ready,
          "with nothing listening the model is not reported as running",
          forge::ui::machineName(frame.copilotModelState()));
    frame.copilotType("fillet 2");
    frame.copilotSubmit();
    buildOneFrame(frame);
    check(frame.copilotSource() == forge::desktop::ForgeFrame::CopilotSource::BuiltIn,
          "the built-in commands answered");
    const std::string said = lastSystemLine(frame);
    check(said == forge::ui::userText(forge::ui::ModelState::NotRunning) ||
              said == forge::ui::userText(forge::ui::ModelState::Off),
          "  ...and the transcript says Archie's model is not running", said);
    if (frame.copilot().hasPlan()) frame.copilotDiscardPlan();
    buildOneFrame(frame);
    frame.setCopilotModel(nullptr);
  }

  // ── 3. THE MODEL SERVICE ANSWERS: Archie is the model ─────────────────────
  forge::archie::test::LoopbackSidecarStub stub;
  {
    std::string why;
    check(stub.start(0, why), "the loopback sidecar stub is listening", why);
  }
  stub.setLoaded(true);
  stub.setPlanReply(g_mutation == 4 ? holesOffPartReply : holesReply);
  stub.setPlanDelayMs(1200);  // a model thinking; the window must not wait for it
  std::printf("[archie-model] stub sidecar on 127.0.0.1:%u\n", static_cast<unsigned>(stub.port()));

  forge::archie::ArchieLink link(configFor(stub.port()));
  Decorated decorated(link);
  decorated.stripSchema = g_mutation == 2;
  decorated.blockInStart = g_mutation == 3;
  frame.setCopilotModel(&decorated);

  const bool ready = waitFor([&] { return link.state() == forge::ui::ModelState::Ready; }, 5000);
  check(ready, "the link DISCOVERED the running model within 5 s",
        std::string(forge::ui::machineName(link.state())) + " / " + link.lastHealth().detail);
  check(stub.count("GET", "/health") >= 1, "  ...by asking GET /health on the wire");
  check(link.lastHealth().adapter == "adapters/archie-30b-knowing-v1",
        "  ...and read which model and adapter the service loaded", link.lastHealth().adapter);
  buildOneFrame(frame);
  check(frame.copilotModelState() == forge::ui::ModelState::Ready,
        "the panel reports Archie's model as running",
        forge::ui::machineName(frame.copilotModelState()));

  // ── 4. THE ASK: over HTTP, and the window keeps drawing ───────────────────
  const std::string framePng = std::string(std::getenv("TMPDIR") != nullptr ? std::getenv("TMPDIR")
                                                                             : "/tmp") +
                               "/archie_model_gate_frame.png";
  { std::ofstream(framePng, std::ios::binary) << "\x89PNG\r\n\x1a\n"; }
  frame.setCopilotFramePath(framePng);

  const std::string programBefore = frame.document().irProgram();
  const std::size_t recordsBefore = frame.document().records().size();
  const std::size_t journalBefore = shell.journal().size();
  const std::size_t treeRowsBefore = frame.treeRowCount();
  const Measure before = measure(programBefore);
  check(before.ok && before.valid, "the starter part measures before the edit", before.error);

  frame.copilotType(kIntent);
  frame.copilotSubmit();
  const auto submitStart = Clock::now();
  buildOneFrame(frame);
  const double submitFrameMs = msSince(submitStart);
  check(submitFrameMs < 400.0,
        "the frame that sent the prompt did not wait for the model (< 400 ms)",
        num(submitFrameMs) + " ms against a model that takes 1200 ms");
  check(frame.copilotAwaitingModel(), "  ...the panel shows Archie working on it");
  check(frame.copilotSource() == forge::desktop::ForgeFrame::CopilotSource::Model,
        "  ...and the ask went to the model, not the built-in commands");
  check(driveUntilAnswered(frame, 20000), "the model's answer arrived within 20 s");

  // ── 5. THE CONTRACT, READ AT THE FAR END OF THE WIRE ──────────────────────
  {
    const std::vector<forge::archie::test::LoopbackSidecarStub::Received> got = stub.received();
    std::size_t plans = 0;
    std::string contentType;
    for (const auto& r : got) {
      if (r.method == "POST" && r.path == "/plan") {
        ++plans;
        contentType = r.contentType;
      }
    }
    check(plans == 1, "exactly one POST /plan reached the sidecar", std::to_string(plans));
    check(contentType == "application/json", "  ...as application/json", contentType);
    const std::string body = stub.lastPlanBody();
    if (!dumpRequestPath.empty()) {
      std::ofstream(dumpRequestPath, std::ios::binary) << body;
      std::printf("[archie-model] wrote the /plan request body to %s\n", dumpRequestPath.c_str());
    }
    forge::retrieval::json::Value req;
    std::string perr;
    check(forge::retrieval::json::parse(body, req, perr), "  ...and its body is JSON", perr);
    check(req.at("id").isNumber() && req.at("id").number(0.0) >= 1.0,
          "  ...carrying the request id serve.py echoes", req.at("id").dump());
    check(req.stringField("text", "").rfind(kIntent, 0) == 0,
          "  ...carrying what was typed as `text`", req.stringField("text", "").substr(0, 80));
    check(req.stringField("image", "") == framePng,
          "  ...and the live viewport frame as `image`", req.stringField("image", ""));
    check(req.at("tools").items().size() == shell.registry().size(),
          "  ...offering every tool in the live registry",
          std::to_string(req.at("tools").items().size()));
    const forge::retrieval::json::Value* hole = nullptr;
    for (const auto& t : req.at("tools").items()) {
      if (t.stringField("id", "") == "part.hole") hole = &t;
    }
    check(hole != nullptr && hole->stringField("featureIrOp", "") == "HOLE",
          "  ...part.hole is offered with its feature-IR op");
    std::string names;
    if (hole != nullptr) {
      for (const auto& p : hole->at("schema").items()) {
        names += (names.empty() ? "" : ",") + p.stringField("name", "");
      }
    }
    check(names == "diameter,x,y,z,depth",
          "  ...WITH its schema, in declared order, so the bridge can name values", names);
  }

  // ── 6. THE PLAN ON OFFER IS THE MODEL'S, AND FORGE'S VALIDATORS PASSED IT ─
  const forge::ui::Plan offered = frame.copilot().plan();
  check(frame.copilotSource() == forge::desktop::ForgeFrame::CopilotSource::Model,
        "the plan on offer came from the model");
  check(frame.copilot().hasPlan(), "Forge's validators accepted it and it is on offer",
        forge::ui::machineName(frame.copilot().verdict().check) + std::string(": ") +
            frame.copilot().verdict().explanation);
  check(offered.steps.size() == 2, "  ...two steps, one per HOLE statement",
        std::to_string(offered.steps.size()));
  if (offered.steps.size() == 2) {
    const forge::ui::PlanStep& s0 = offered.steps[0];
    double diameter = -1.0, x0 = 0.0;
    for (const forge::ui::PlanArg& a : s0.args) {
      if (a.name == "diameter") diameter = a.number;
      if (a.name == "x") x0 = a.number;
    }
    check(s0.commandId == "part.hole" && s0.irOp == "HOLE", "  ...step 1 is part.hole / HOLE",
          s0.commandId);
    check(std::fabs(diameter - 6.0) < 1e-9, "  ...with the model's 6 mm diameter, not a default",
          num(diameter));
    check(std::fabs(std::fabs(x0) - (g_mutation == 4 ? 60.0 : 25.0)) < 1e-9,
          "  ...at the model's x position", num(x0));
    check(s0.select == forge::ui::PlanSelect::LatestSolid,
          "  ...working on the newest solid, as the IR's %ref chain says",
          forge::ui::toString(s0.select));
  }
  check(frame.copilotRowsDrawn() == 2 || !frame.copilot().hasPlan(),
        "the panel drew a row per planned step", std::to_string(frame.copilotRowsDrawn()));

  // ── 7. ACCEPT: through the one door, into the kernel ──────────────────────
  frame.copilotApplyPlan();
  buildOneFrame(frame);
  buildOneFrame(frame);
  const forge::ui::ApplyOutcome& outcome = frame.copilot().lastOutcome();
  check(outcome.requested == 2 && outcome.applied == 2, "both steps were applied",
        outcome.summary());
  check(shell.journal().size() == journalBefore + 2 &&
            shell.journal()[journalBefore] == "part.hole",
        "  ...each one journalled as a part.hole dispatch", std::to_string(shell.journal().size()));
  check(frame.document().records().size() == recordsBefore + 2,
        "  ...one statement per step reached the document");
  check(frame.copilot().lastBuildChecked() && frame.copilot().lastBuildOk(),
        "  ...and the panel reports that Forge REBUILT the part",
        frame.copilot().lastBuildSentence());
  check(frame.copilot().lastBuildSentence().rfind("Forge rebuilt the part", 0) == 0,
        "  ...in words", frame.copilot().lastBuildSentence());
  check(frame.treeRowCount() >= treeRowsBefore + 2, "the feature tree grew by the two holes",
        std::to_string(treeRowsBefore) + " -> " + std::to_string(frame.treeRowCount()));
  check(frame.copilotRowsDrawn() == 2, "the panel draws each applied step's row after Accept",
        std::to_string(frame.copilotRowsDrawn()));
  check(scene.lastBuild().ok() && scene.lastBuild().valid,
        "the viewport's scene rebuilt a valid solid", scene.lastBuild().error);

  // ── 8. A VECTOR OF OBSERVABLES, never one ─────────────────────────────────
  {
    const std::string program = frame.document().irProgram();
    std::printf("[archie-model] --- the program after Archie's plan ---\n%s", program.c_str());
    const Measure after = measure(program);
    const double removed = before.volume - after.volume;
    const double expected = 2.0 * M_PI * 3.0 * 3.0 * 20.0;  // two d6 x 20 through holes
    check(after.ok && after.valid, "the kernel compiles a VALID solid", after.error);
    check(after.reconciled, "declared == parsed == compiled (s0.4)");
    check(std::fabs(after.dx - before.dx) < 0.01 && std::fabs(after.dy - before.dy) < 0.01 &&
              std::fabs(after.dz - before.dz) < 0.01,
          "the bounding box is unchanged (holes add no extent)",
          num(after.dx) + " x " + num(after.dy) + " x " + num(after.dz));
    check(std::fabs(removed - expected) < 0.01 * expected,
          "the volume removed is two 6 mm x 20 mm through holes (within 1%)",
          num(removed) + " mm3 removed, expected " + num(expected));
    check(after.faces >= before.faces + 2, "the solid gained the holes' faces",
          std::to_string(before.faces) + " -> " + std::to_string(after.faces));
  }

  // ── 9. THE KERNEL REFUSES A PLAN'S RESULT: taken back, and said ───────────
  {
    stub.setPlanDelayMs(0);
    stub.setPlanReply(filletTooBigReply);
    const std::string programAtStart = frame.document().irProgram();
    frame.copilotType("round every edge 40 mm");
    frame.copilotSubmit();
    buildOneFrame(frame);
    check(driveUntilAnswered(frame, 20000), "the second answer arrived");
    check(frame.copilot().hasPlan(), "a well-formed but unbuildable plan is still offered",
          frame.copilot().verdict().explanation);
    frame.copilotApplyPlan();
    buildOneFrame(frame);
    buildOneFrame(frame);
    check(frame.copilot().lastOutcome().applied >= 1, "its step dispatched",
          frame.copilot().lastOutcome().summary());
    check(frame.copilot().lastBuildChecked() && !frame.copilot().lastBuildOk(),
          "the panel does NOT report the refused part as success",
          frame.copilot().lastBuildSentence());
    check(frame.document().irProgram() == programAtStart,
          "the plan was taken back: the program is byte-identical to before",
          frame.document().irProgram());
    check(frame.copilot().lastBuildSentence().find("taken back") != std::string::npos,
          "  ...and the panel says so in words", frame.copilot().lastBuildSentence());
    check(scene.lastBuild().ok(), "the part on screen is a part that builds",
          scene.lastBuild().error);
  }

  // ── 10. THE MODEL DECLINES: Archie's answer, not the verb matcher's ───────
  {
    stub.setPlanReply(refusalReply);
    const std::size_t refusedBefore = frame.copilot().plansRefused();
    frame.copilotType("fillet 2");
    frame.copilotSubmit();
    buildOneFrame(frame);
    check(driveUntilAnswered(frame, 20000), "the refusal arrived");
    check(!frame.copilot().hasPlan(),
          "a model's refusal is not replaced by the built-in commands' plan for the same words");
    check(frame.copilot().plansRefused() == refusedBefore + 1, "  ...it is recorded as a refusal");
    check(frame.copilotSource() == forge::desktop::ForgeFrame::CopilotSource::Model,
          "  ...and shown as the model's answer");
    std::string lastCopilot;
    for (const auto& l : frame.copilot().transcript()) {
      if (l.role == forge::ui::TranscriptRole::Copilot) lastCopilot = l.text;
    }
    check(lastCopilot.find("no offered command declares it") != std::string::npos,
          "  ...and the model's reason is what the transcript says", lastCopilot);
  }

  // ── 11. THE MODEL STOPS: said at once, and the built-in commands stand in ─
  {
    stub.setPlanReply(holesReply);
    const std::uint16_t port = stub.port();
    stub.stop();
    frame.copilotType("fillet 2");
    frame.copilotSubmit();
    buildOneFrame(frame);
    check(driveUntilAnswered(frame, 20000), "the failed ask came back");
    check(frame.copilotSource() == forge::desktop::ForgeFrame::CopilotSource::BuiltIn,
          "with the service gone the built-in commands answered");
    const std::string said = lastSystemLine(frame);
    check(said == "Archie's model stopped answering — using built-in commands." ||
              said == forge::ui::userText(forge::ui::ModelState::NotRunning),
          "  ...and the panel says the model is not answering", said);
    check(waitFor([&] { return link.state() == forge::ui::ModelState::NotRunning; }, 3000),
          "  ...and stops reporting the model as running",
          forge::ui::machineName(link.state()));
    if (frame.copilot().hasPlan()) frame.copilotDiscardPlan();
    buildOneFrame(frame);

    // ── 12. ...AND WHEN IT COMES BACK, THE APP NOTICES ────────────────────
    forge::archie::test::LoopbackSidecarStub again;
    std::string why;
    const bool rebound = again.start(port, why);
    check(rebound, "the sidecar came back on the same port", why);
    if (rebound) {
      again.setLoaded(false);
      check(waitFor([&] { return link.state() == forge::ui::ModelState::Loading; }, 3000),
            "a service that is back but still loading is reported as loading",
            forge::ui::machineName(link.state()));
      again.setLoaded(true);
      check(waitFor([&] { return link.state() == forge::ui::ModelState::Ready; }, 3000),
            "once its model is loaded Archie is the model again, with no restart",
            forge::ui::machineName(link.state()));
      again.stop();
    }
  }

  frame.setCopilotModel(nullptr);
  std::remove(framePng.c_str());
  std::printf("\n[archie-model] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures == 0) {
    std::printf("[archie-model] ALL ARCHIE MODEL GATES PASS (real loopback HTTP, no model)\n");
    return 0;
  }
  return 1;
}
