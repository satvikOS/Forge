// forge-desktop/test/archie_live_gate.cpp
//
// THE LIVE ARCHIE GATE. It answers one question that no other gate in this tree
// answers: with FORGE_ARCHIE_ENDPOINT set, does the app's CoPilot actually reach
// the model, or does it quietly go on using the deterministic LocalPlanner?
//
// THE BRANCH UNDER TEST is ForgeFrame::planWithFallback (ForgeFrame.cpp), whose
// whole condition is:
//
//     if (copilotRemote_ != nullptr) {
//       PlanResponse remote = copilotRemote_->plan(req);
//       if (remote.ok) return remote;              // <- Archie answered
//       ... copilotPlanner_.plan(req) ...          // <- LocalPlanner answered
//       local.plan.summary += "[deterministic fallback: Archie " + why + "]";
//     }
//     return copilotPlanner_.plan(req);            // <- no remote installed
//
// So "which planner answered" is OBSERVABLE FROM THE PLAN ITSELF, by design:
// a fallback stamps the summary and a remote success does not. This gate reads
// that stamp rather than asserting "it did not crash".
//
// It is headless: a real ForgeFrame over the real registry and the real kernel
// scene, with no window, no swapchain and no GPU -- the same shape as
// frame_gate.cpp and copilot_input_gate.cpp.
//
// THREE ARMS, so a green result cannot come from the instrument being blind:
//
//   A  NO remote planner installed          -> the LocalPlanner answers, and the
//                                              summary carries NO fallback stamp
//                                              (this is the SHIPPED Sep-6
//                                              behaviour, the negative control)
//   B  remote planner pointed at a DEAD port -> RemotePlanner::plan() must fail,
//                                              the LocalPlanner must answer, and
//                                              the summary MUST carry the stamp.
//                                              This is the proof that the stamp
//                                              is real and that arm C is not
//                                              measuring a marker that is never
//                                              written.
//   C  remote planner pointed at the LIVE    -> RemotePlanner::plan() must
//      sidecar                                  succeed and the plan must come
//                                               back WITHOUT the stamp.
//
// Arm C needs a sidecar and arm B needs a port with nothing on it, so this is
// NOT registered with add_test(): a gate that goes red when a model is not
// running would make every clean checkout fail. It is run by hand, and it prints
// the endpoint it used so the result names its own conditions.
//
//   FORGE_ARCHIE_ENDPOINT=127.0.0.1:8731 ./forge_desktop_archie_live_gate
//
// With FORGE_ARCHIE_ENDPOINT unset, arms A and B still run and arm C reports
// itself NOT RUN -- it never reports a pass it did not measure.

#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <memory>
#include <string>

#include "imgui.h"

#include "ForgeFrame.hpp"
#include "KernelScene.hpp"
#include "forge/archie/RemotePlanner.hpp"
#include "forge/retrieval/HttpTransport.hpp"

namespace {

int g_pass = 0;
int g_fail = 0;

// ForgeFrame::build() IS an ImGui frame builder, so it dereferences the current
// ImGui context unconditionally. Without this the gate SIGSEGVs before its first
// printf -- and because stdout to a pipe is block-buffered, it does so leaving a
// ZERO-BYTE log, which is exactly how a crash gets mistaken for "it printed
// nothing". A null renderer backend is all a frame needs; no window, no GPU.
struct HeadlessImGui {
  HeadlessImGui(float w, float h) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(w, h);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "archie_live_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

void check(bool ok, const std::string& what, const std::string& saw = "") {
  if (ok) {
    ++g_pass;
    std::printf("   PASS  %s%s%s\n", what.c_str(), saw.empty() ? "" : "  -- ", saw.c_str());
  } else {
    ++g_fail;
    std::printf("   FAIL  %s%s%s\n", what.c_str(), saw.empty() ? "" : "  -- ", saw.c_str());
  }
}

// The exact marker planWithFallback writes. Spelled once, here, so a change to
// the message is a change this gate notices rather than one it sleeps through.
const char* kFallbackMark = "[deterministic fallback: Archie ";

bool stamped(const std::string& summary) {
  return summary.find(kFallbackMark) != std::string::npos;
}

// Build the REAL PlanRequest the app would send: the live registry's tools, the
// live selection, the live document summary. Constructed by the frame itself --
// this gate does not hand-roll a request, because a hand-rolled one is not the
// one the app sends.
//
// setCopilotAutoPlan(false) leaves the request PENDING after a submit instead of
// answering it in process, which is exactly the seam the windowed host uses.
const forge::ui::PlanRequest* raise(forge::desktop::ForgeFrame& frame,
                                    const std::string& intent) {
  frame.setCopilotAutoPlan(false);
  frame.copilotType(intent);
  frame.copilotSubmit();
  ImGui::NewFrame();       // the press is RECORDED; build() runs it
  frame.build(0, 1.0f);
  ImGui::Render();
  return frame.copilotRequest();
}

}  // namespace

int main() {
  std::printf("== the live Archie gate ==\n");

  forge::desktop::KernelScene scene;
  if (!scene.build()) {
    std::printf("[archie-live] cannot continue without geometry: %s\n", scene.error().c_str());
    return 2;
  }
  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();
  // The default workspace does not hold archie_copilot, so a frame built without
  // this never draws the CoPilot panel at all.
  shell.setWorkspace(forge::ui::WorkspaceProfile::Archie);

  // A request the DETERMINISTIC planner is documented to understand, so arm A and
  // arm B have something to answer with. If LocalPlanner refused it, arms A and B
  // would be measuring a refusal rather than a fallback.
  const std::string kIntent = "fillet 3";

  // ── arm A: no remote planner installed ──────────────────────────────────────
  std::printf("\n-- A: no remote planner installed (the shipped Sep-6 behaviour)\n");
  check(frame.copilotRemotePlanner() == nullptr,
        "copilotRemotePlanner() is null before anything is installed");
  {
    const forge::ui::PlanRequest* req = raise(frame, kIntent);
    if (req == nullptr) {
      check(false, "a request was raised");
    } else {
      const forge::ui::PlanResponse r = frame.planWithFallback(*req);
      check(r.ok, "the deterministic planner answered", r.ok ? r.plan.summary : r.error);
      check(!stamped(r.plan.summary),
            "and it carries NO fallback stamp (nothing to fall back FROM)");
      frame.deliverCopilotPlan(r);
    }
  }

  // ── arm B: remote planner pointed at a dead port ────────────────────────────
  // Port 9 is discard/, which nothing on this machine listens on. A transport
  // error here is the POINT: it proves the stamp is written on a real failure.
  std::printf("\n-- B: remote planner installed, pointed at a DEAD port (negative control)\n");
  {
    auto transport = std::make_shared<forge::retrieval::LoopbackHttpTransport>();
    forge::archie::Endpoint dead;
    dead.host = "127.0.0.1";
    dead.port = 9;
    dead.timeout_ms = 3000;
    forge::archie::RemotePlanner planner(transport, dead);

    frame.setCopilotRemotePlanner(&planner);
    check(frame.copilotRemotePlanner() == &planner,
          "copilotRemotePlanner() now names the RemotePlanner that was installed");

    const forge::ui::PlanRequest* req = raise(frame, kIntent);
    if (req == nullptr) {
      check(false, "a request was raised");
    } else {
      const forge::ui::PlanResponse direct = planner.plan(*req);
      check(!direct.ok, "RemotePlanner::plan() refuses against a dead port", direct.error);

      const forge::ui::PlanResponse r = frame.planWithFallback(*req);
      check(r.ok, "the frame still answered (the app does not stop working)",
            r.ok ? r.plan.summary : r.error);
      check(stamped(r.plan.summary),
            "and the summary ANNOUNCES the fallback", r.plan.summary);
      frame.deliverCopilotPlan(r);
    }
    frame.setCopilotRemotePlanner(nullptr);
  }

  // ── arm C: remote planner pointed at the live sidecar ───────────────────────
  std::printf("\n-- C: remote planner installed, pointed at the LIVE sidecar\n");
  const char* ep = std::getenv("FORGE_ARCHIE_ENDPOINT");
  if (ep == nullptr) {
    std::printf("   NOT RUN  FORGE_ARCHIE_ENDPOINT is unset, so there is no sidecar to\n");
    std::printf("            reach. This arm reports nothing rather than passing.\n");
    std::printf("            Re-run as: FORGE_ARCHIE_ENDPOINT=127.0.0.1:8731 %s\n",
                "./forge_desktop_archie_live_gate");
  } else {
    // The SAME parse main.cpp does, including the loopback refusal, so this gate
    // reaches the sidecar by the app's rule and not by a looser one of its own.
    const std::string spec(ep);
    forge::archie::Endpoint live;
    const std::size_t colon = spec.rfind(':');
    if (colon != std::string::npos) {
      live.host = spec.substr(0, colon);
      live.port = static_cast<std::uint16_t>(std::atoi(spec.c_str() + colon + 1));
    } else {
      live.host = spec;
    }
    check(forge::retrieval::isLoopbackLiteral(live.host) && live.port != 0,
          "the endpoint passes the app's own loopback check", spec);

    auto transport = std::make_shared<forge::retrieval::LoopbackHttpTransport>();
    forge::archie::RemotePlanner planner(transport, live);
    frame.setCopilotRemotePlanner(&planner);

    const forge::ui::PlanRequest* req = raise(frame, kIntent);
    if (req == nullptr) {
      check(false, "a request was raised");
    } else {
      std::printf("   (request carries %zu tools from the live registry)\n", req->tools.size());
      check(!req->tools.empty(),
            "the app tells the model its OWN vocabulary rather than trusting it to remember one",
            std::to_string(req->tools.size()) + " tools");

      const forge::ui::PlanResponse r = frame.planWithFallback(*req);
      if (r.ok) {
        std::printf("   plan summary: %s\n", r.plan.summary.c_str());
        std::printf("   plan steps  : %zu\n", r.plan.steps.size());
        for (const forge::ui::PlanStep& s : r.plan.steps) {
          std::printf("     - %s (irOp %s, %zu args)\n", s.commandId.c_str(),
                      s.irOp.c_str(), s.args.size());
        }
      }
      check(r.ok, "the frame answered", r.ok ? "ok" : r.error);
      check(r.ok && !stamped(r.plan.summary),
            "THE MODEL ANSWERED: no fallback stamp, so planWithFallback returned "
            "RemotePlanner's own plan",
            r.ok ? r.plan.summary : r.error);
      check(r.ok && !r.plan.steps.empty(),
            "and the plan Archie returned has steps",
            std::to_string(r.plan.steps.size()) + " steps");
      frame.deliverCopilotPlan(r);
    }
    frame.setCopilotRemotePlanner(nullptr);
  }

  std::printf("\nRESULT: %d passed, %d failed\n", g_pass, g_fail);
  return g_fail == 0 ? 0 : 1;
}
