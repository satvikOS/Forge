// forge-desktop/test/copilot_input_gate.cpp
//
// AN ENGINEERING REQUEST MUST NOT BE SILENTLY TRUNCATED.
//
// drawCopilotPanel round-tripped copilotInput_ through a 256-byte STACK BUFFER on
// EVERY FRAME:
//
//     char buf[256];
//     const std::size_t copied = copilotInput_.copy(buf, sizeof(buf) - 1);
//     ImGui::InputTextWithHint(..., buf, sizeof(buf), ...);
//     copilotInput_.assign(buf);          // <- the truncated buffer goes back
//
// copilotInput_ IS a std::string, so nothing about the TYPE caps it -- and that is
// exactly why this is easy to miss. The cap is the round trip: anything past 255
// bytes is gone on the next frame the panel draws.
//
// 255 bytes is shorter than the requests doc 03 is written around -- "make the wall
// 20% thicker without moving the mounting-hole centres, and keep the connector
// mating face where it is" is the SHAPE of the input, and a longer one is silently
// shortened rather than refused.
//
// This gate drives the REAL panel through a real ImGui frame, because the
// truncation happens in the draw, not in the accessor. Asserting on copilotType()
// alone would pass while the defect stood.
#include "imgui.h"

#include "ForgeFrame.hpp"
#include "KernelScene.hpp"

#include <cstdint>
#include <cstdio>
#include <string>

namespace {

int g_pass = 0;
int g_fail = 0;

void check(bool ok, const std::string& what, const std::string& detail = "") {
  std::printf("  %s  %s%s%s\n", ok ? "PASS" : "FAIL", what.c_str(),
              detail.empty() ? "" : " -- ", detail.c_str());
  ok ? ++g_pass : ++g_fail;
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
    io.BackendRendererName = "copilot_input_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

void oneFrame(forge::desktop::ForgeFrame& frame) {
  ImGui::NewFrame();
  frame.build(0, 1.0f);
  ImGui::Render();
}

}  // namespace

int main() {
  forge::desktop::KernelScene scene;
  if (!scene.build()) {
    std::printf("[copilot-input] cannot continue without geometry: %s\n", scene.error().c_str());
    return 1;
  }
  HeadlessImGui gui(1680.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();
  // THE PANEL MUST ACTUALLY DRAW. The default workspace does not hold
  // archie_copilot, so a frame built without this never calls drawCopilotPanel --
  // and the first version of this gate PASSED against the unfixed code for exactly
  // that reason. A test that is green before the fix proves nothing.
  shell.setWorkspace(forge::ui::WorkspaceProfile::Archie);

  // A real engineering request, of the shape doc 03 is written around.
  const std::string kReal =
      "make the wall 20% thicker without moving the mounting-hole centres, keep the "
      "connector mating face exactly where it is, and leave the overall external "
      "envelope unchanged; mass may increase but the four M6 bolt positions must not "
      "move by more than 0.01 mm in any direction";

  std::printf("== a real request survives the panel drawing itself ==\n");
  std::printf("   request length: %zu bytes\n", kReal.size());
  check(kReal.size() > 255, "the fixture is longer than the old 255-byte cap",
        std::to_string(kReal.size()) + " bytes");

  frame.copilotType(kReal);
  check(frame.copilotInput() == kReal, "copilotType stores it whole (the accessor was never the cap)",
        std::to_string(frame.copilotInput().size()) + " bytes");

  oneFrame(frame);
  check(frame.copilotInput() == kReal,
        "and it is STILL whole after the panel has drawn a frame",
        std::to_string(frame.copilotInput().size()) + " of " + std::to_string(kReal.size()) +
            " bytes");

  std::printf("== it survives repeated frames, not just the first ==\n");
  for (int i = 0; i < 5; ++i) oneFrame(frame);
  check(frame.copilotInput() == kReal, "unchanged after six frames",
        std::to_string(frame.copilotInput().size()) + " bytes");

  std::printf("== boundary cases around the old cap ==\n");
  for (std::size_t n : {std::size_t{254}, std::size_t{255}, std::size_t{256}, std::size_t{257},
                        std::size_t{1024}}) {
    const std::string s(n, 'x');
    frame.copilotType(s);
    oneFrame(frame);
    check(frame.copilotInput().size() == n, "a " + std::to_string(n) + "-byte input survives",
          std::to_string(frame.copilotInput().size()) + " bytes");
  }

  std::printf("== and the ordinary short case still works ==\n");
  frame.copilotType("fillet 3");
  oneFrame(frame);
  check(frame.copilotInput() == "fillet 3", "a short request is untouched",
        frame.copilotInput());
  frame.copilotType("");
  oneFrame(frame);
  check(frame.copilotInput().empty(), "an empty request stays empty");

  std::printf("\nRESULT: %d passed, %d failed\n", g_pass, g_fail);
  return g_fail == 0 ? 0 : 1;
}
