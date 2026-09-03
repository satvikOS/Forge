// forge-desktop/test/imgui_recovery_gate.cpp
//
// THE INTERFACE-ERROR GATE. It asserts that a RECOVERABLE Dear ImGui error costs
// the user a repaired frame and one plain sentence -- never the process, and
// never the library's own prose drawn over their model.
//
// ── the two defects, both MEASURED against the vendored library ─────────────
//
// Dear ImGui 1.92.9 WIP ships ConfigErrorRecoveryEnableAssert = true. IM_ASSERT
// is `assert()` (imgui.h:96) and nothing here overrides it, so:
//
//   * WITHOUT NDEBUG a frame that leaves an unbalanced stack ABORTS the process:
//       Assertion failed: ((0) && "Missing End()"), function
//       ErrorRecoveryTryToRecoverState, file imgui.cpp, line 11195  -> exit 134
//     Everything the user had not saved dies with it.
//
//   * WITH NDEBUG -- CMAKE_BUILD_TYPE=Release, which is what the shipped bundle
//     is built with, so this is the live behaviour today -- the process survives
//     and the library instead opens a `##Tooltip_Error` window over the model
//     (created on the erring frame, active on the next) saying "In window
//     'Part': Missing End()", with a button labelled "Enable Asserts". Its
//     duplicate-id sibling opens the same window with "Programmer error: 2
//     visible items with conflicting ID!". That is the text the user reported.
//
// The second is live now; the first is one `-DCMAKE_BUILD_TYPE=Debug` away. An
// application that must never lose work cannot rest on NDEBUG happening to be
// defined, so the policy is set explicitly and this gate is what keeps it set.
//
// ── what is asserted, and why a gate rather than a review ───────────────────
//
// Section A is the sharp end of the task: on a context NOTHING has configured --
// the library's own defaults, which is exactly the state the application is left
// in if somebody deletes the policy call -- imGuiErrorPolicyViolations() returns
// a NON-EMPTY list naming every setting that is wrong. The gate fails on it.
// Section A also measures the six defaults themselves, so a vendored-ImGui
// upgrade that changes them is a red gate and not a silent change of behaviour.
//
// Sections B-E then drive the real thing: the policy applied, a REAL recoverable
// error raised in a REAL frame, the recovery observed as values (window stack,
// id stack, draw data), the absence of the library's tooltip window observed by
// name, and the sentence the user is handed scanned by the SAME
// forge::ui::scanUserFacingProse the application links.
//
// Section F closes the seam that made this possible in the first place: it reads
// forge-desktop/src/main.cpp and asserts the application actually CALLS the
// policy and sets none of those settings itself. CI does COMPILE main.cpp (the
// `desktop` job builds forge_desktop), but it defines main(), so no gate can
// LINK it and nothing can execute or assert on what it configures -- and
// run_syntax_gate.sh skips it as well, for SDL2 + Vulkan. Behaviour alone cannot
// bind a function to a caller no test can call; reading the caller can.
//
// PROVING THE GATE CAN FAIL: --mutate <n>, 1..8. Each undoes exactly one thing
// the policy does, or feeds one check the input a real defect would:
//   1  ConfigErrorRecoveryEnableAssert left at the library default (true)
//   2  ConfigErrorRecoveryEnableTooltip left at the default (true)
//   3  ConfigDebugHighlightIdConflicts left at the default (true)
//   4  ConfigDebugHighlightIdConflictsShowItemPicker left at the default (true)
//   5  ConfigErrorRecovery turned OFF -- the frame is never repaired
//   6  no error callback -- the error is recovered and the user is told nothing
//   7  the notice carries the library's raw message as the user's sentence
//   8  main.cpp with the settings inline and no call to the policy
//
// 1-6 are applied to the live context AFTER the production applyImGuiErrorPolicy
// has run, which is the honest form: the clean run proves the production
// function does the right thing, and the mutation proves the CHECK notices when
// something does not.
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <fcntl.h>
#include <unistd.h>
#include <sstream>
#include <string>
#include <vector>

#include "imgui.h"
#include "imgui_internal.h"

#include "ImGuiErrorPolicy.hpp"
#include "forge/ui/UserFacingText.hpp"

namespace {

int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

void check(bool ok, const char* what, const std::string& detail) {
  ++g_checks;
  if (!ok) {
    ++g_failures;
    std::printf("  FAIL  %-54s  %s\n", what, detail.c_str());
  }
}

void checkBool(bool got, bool want, const char* what) {
  ++g_checks;
  if (got != want) {
    ++g_failures;
    std::printf("  FAIL  %-54s  got %s want %s\n", what, got ? "true" : "false",
                want ? "true" : "false");
  }
}

void checkSize(std::size_t got, std::size_t want, const char* what) {
  ++g_checks;
  if (got != want) {
    ++g_failures;
    std::printf("  FAIL  %-54s  got %zu want %zu\n", what, got, want);
  }
}

const char* const kSettingNames[] = {
    "ConfigErrorRecovery",
    "ConfigErrorRecoveryEnableAssert",
    "ConfigErrorRecoveryEnableDebugLog",
    "ConfigErrorRecoveryEnableTooltip",
    "ConfigDebugHighlightIdConflicts",
    "ConfigDebugHighlightIdConflictsShowItemPicker",
};

std::string join(const std::vector<std::string>& v) {
  std::string out;
  for (const std::string& s : v) {
    if (!out.empty()) out += " | ";
    out += s;
  }
  return out;
}

bool contains(const std::string& hay, const std::string& needle) {
  return hay.find(needle) != std::string::npos;
}

// A minimal, real ImGui context with a null renderer backend: no window, no
// swapchain, no GPU. Same shape frame_gate.cpp uses.
void standUpContext() {
  IMGUI_CHECKVERSION();
  ImGui::CreateContext();
  ImGuiIO& io = ImGui::GetIO();
  io.DisplaySize = ImVec2(1280.0f, 800.0f);
  io.DeltaTime = 1.0f / 60.0f;
  io.IniFilename = nullptr;
  io.LogFilename = nullptr;
  io.BackendRendererName = "imgui_recovery_gate_null";
  io.Fonts->AddFontDefault();
  unsigned char* pixels = nullptr;
  int tw = 0, th = 0;
  io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
  io.Fonts->SetTexID(static_cast<ImTextureID>(1));
}

// Undo exactly one thing the policy did. See the header block.
void applyLiveMutation() {
  ImGuiIO& io = ImGui::GetIO();
  ImGuiContext* ctx = ImGui::GetCurrentContext();
  switch (g_mutation) {
    case 1: io.ConfigErrorRecoveryEnableAssert = true; break;
    case 2: io.ConfigErrorRecoveryEnableTooltip = true; break;
    case 3: io.ConfigDebugHighlightIdConflicts = true; break;
    case 4: io.ConfigDebugHighlightIdConflictsShowItemPicker = true; break;
    case 5: io.ConfigErrorRecovery = false; break;
    case 6: ctx->ErrorCallback = nullptr; ctx->ErrorCallbackUserData = nullptr; break;
    default: break;
  }
}

std::string readFile(const std::string& path, bool& ok) {
  std::ifstream in(path);
  if (!in) {
    ok = false;
    return std::string();
  }
  std::ostringstream ss;
  ss << in.rdbuf();
  ok = true;
  return ss.str();
}

// The shape main.cpp had BEFORE the policy existed: the settings assigned inline,
// in main(), with no single place to check and nothing that links them. Used by
// mutation 8 so section F is proved falsifiable against the real regression and
// not against a string nobody would ever write.
const char* const kMainCppBeforeTheFix =
    "  const bool devDiagnostics = std::getenv(\"FORGE_IMGUI_DEV_DIAGNOSTICS\") != nullptr;\n"
    "  if (!devDiagnostics) {\n"
    "    io.ConfigErrorRecovery = true;\n"
    "    io.ConfigErrorRecoveryEnableAssert = false;\n"
    "    io.ConfigErrorRecoveryEnableDebugLog = true;\n"
    "    io.ConfigErrorRecoveryEnableTooltip = false;\n"
    "    io.ConfigDebugHighlightIdConflicts = false;\n"
    "    io.ConfigDebugHighlightIdConflictsShowItemPicker = false;\n"
    "  }\n";

// `<name> =` (not `==`) anywhere in the file: an assignment to a setting the
// policy owns. Comments are text too, and a commented-out assignment is still a
// second home for the decision, so no attempt is made to exclude them.
bool assignsSetting(const std::string& code, const char* name) {
  const std::string needle = name;
  std::size_t at = 0;
  while ((at = code.find(needle, at)) != std::string::npos) {
    std::size_t k = at + needle.size();
    while (k < code.size() && (code[k] == ' ' || code[k] == '\t')) ++k;
    if (k < code.size() && code[k] == '=' && (k + 1 >= code.size() || code[k + 1] != '=')) {
      return true;
    }
    at += needle.size();
  }
  return false;
}

}  // namespace

int main(int argc, char** argv) {
  std::string rootOverride;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) {
      g_mutation = std::atoi(argv[++i]);
    } else {
      std::printf("[imgui_recovery] unknown argument: %s\n", argv[i]);
      return 2;
    }
  }
  if (g_mutation != 0) std::printf("[imgui_recovery] MUTATION %d ACTIVE\n", g_mutation);

  using forge::desktop::ImGuiErrorNotice;
  using forge::desktop::ImGuiErrorPolicy;

  standUpContext();
  ImGuiContext* ctx = ImGui::GetCurrentContext();
  ImGuiIO& io = ImGui::GetIO();

  // ── A. the library's defaults, on a context nothing has configured ────────
  // This is the state the application is in if the policy call is deleted. Every
  // value is READ from the fresh context, never from the comment beside it, so a
  // vendored-ImGui upgrade that changes a default turns this section red.
  std::printf("[imgui_recovery] vendored Dear ImGui %s (%d)\n", IMGUI_VERSION, IMGUI_VERSION_NUM);
  std::printf("[imgui_recovery] library defaults: Recovery=%d Assert=%d Log=%d Tooltip=%d "
              "IdConflicts=%d ItemPicker=%d\n",
              static_cast<int>(io.ConfigErrorRecovery),
              static_cast<int>(io.ConfigErrorRecoveryEnableAssert),
              static_cast<int>(io.ConfigErrorRecoveryEnableDebugLog),
              static_cast<int>(io.ConfigErrorRecoveryEnableTooltip),
              static_cast<int>(io.ConfigDebugHighlightIdConflicts),
              static_cast<int>(io.ConfigDebugHighlightIdConflictsShowItemPicker));
  checkBool(io.ConfigErrorRecovery, true, "A1 default ConfigErrorRecovery");
  checkBool(io.ConfigErrorRecoveryEnableAssert, true, "A2 default ...EnableAssert (the abort)");
  checkBool(io.ConfigErrorRecoveryEnableDebugLog, true, "A3 default ...EnableDebugLog");
  checkBool(io.ConfigErrorRecoveryEnableTooltip, true, "A4 default ...EnableTooltip (the prose)");
  checkBool(io.ConfigDebugHighlightIdConflicts, true, "A5 default ...HighlightIdConflicts");
  checkBool(io.ConfigDebugHighlightIdConflictsShowItemPicker, true,
            "A6 default ...ShowItemPicker");
  check(ctx->ErrorCallback == nullptr, "A7 a fresh context has no error callback", "it has one");

  {
    // THE CHECK THE TASK ASKS FOR: left at its default, the configuration is a
    // FAILURE, stated as a value and not as a reviewer's opinion.
    const std::vector<std::string> v = imGuiErrorPolicyViolations(ImGuiErrorPolicy::Shipping);
    checkSize(v.size(), 5u, "A8 defaults violate the shipping policy (4 settings + no callback)");
    const std::string all = join(v);
    for (const char* name : {"ConfigErrorRecoveryEnableAssert", "ConfigErrorRecoveryEnableTooltip",
                             "ConfigDebugHighlightIdConflicts",
                             "ConfigDebugHighlightIdConflictsShowItemPicker"}) {
      check(contains(all, name), "A9 the violation names the setting that is wrong", name);
    }
    check(contains(all, "callback"), "A10 the violation names the missing callback", all);
    if (!v.empty()) std::printf("[imgui_recovery] defaults are refused: %s\n", all.c_str());
    // The control, without which A8 would pass over a predicate that always
    // complains: the fresh context IS the developer default, so that policy is
    // satisfied by it exactly.
    checkSize(imGuiErrorPolicyViolations(ImGuiErrorPolicy::DeveloperDiagnostics).size(), 0u,
              "A11 a fresh context already satisfies developer diagnostics");
  }

  // ── B. the shipping policy, applied by the code the application calls ─────
  forge::desktop::applyImGuiErrorPolicy(ImGuiErrorPolicy::Shipping);
  applyLiveMutation();

  checkBool(io.ConfigErrorRecovery, true, "B1 ConfigErrorRecovery stays ON (repair the frame)");
  checkBool(io.ConfigErrorRecoveryEnableAssert, false, "B2 ...EnableAssert OFF (never abort)");
  checkBool(io.ConfigErrorRecoveryEnableDebugLog, true, "B3 ...EnableDebugLog ON (engineer reads)");
  checkBool(io.ConfigErrorRecoveryEnableTooltip, false, "B4 ...EnableTooltip OFF (never drawn)");
  checkBool(io.ConfigDebugHighlightIdConflicts, false, "B5 ...HighlightIdConflicts OFF");
  checkBool(io.ConfigDebugHighlightIdConflictsShowItemPicker, false, "B6 ...ShowItemPicker OFF");
  {
    const std::vector<std::string> v = imGuiErrorPolicyViolations(ImGuiErrorPolicy::Shipping);
    check(v.empty(), "B7 the shipping policy is in force", join(v));
  }
  check(ctx->ErrorCallback != nullptr, "B8 an error callback carries the message out", "none");
  // The library's OWN rule, imgui.cpp:11103, asserted here as a value so this
  // configuration can never be the one that trips it inside NewFrame().
  check(io.ConfigErrorRecoveryEnableAssert || io.ConfigErrorRecoveryEnableDebugLog ||
            io.ConfigErrorRecoveryEnableTooltip || ctx->ErrorCallback != nullptr,
        "B9 recovery is not 100% silent (the library's own rule)", "all four are off");

  // ── C. a REAL recoverable error, in a REAL frame ──────────────────────────
  forge::desktop::resetImGuiErrorNotices();
  {
    // The abort decision itself, as a boolean. ErrorLog() RETURNS whether the
    // caller should assert (imgui.cpp:11332), which is the exact value that
    // decides whether the user's model survives.
    ImGui::NewFrame();
    ImGui::Begin("Part");
    const bool shouldAssert = ImGui::ErrorLog("gate: a deliberate recoverable error");
    checkBool(shouldAssert, false, "C1 the library is told NOT to assert");
    ImGui::End();
    ImGui::EndFrame();
    ImGui::Render();
    forge::desktop::drainImGuiErrorNotices();  // C1's own notice, not part of D
  }

  // A window that has never been drawn before is HIDDEN for its first frame
  // while ImGui auto-fits it -- MEASURED: 0 vertices on frame 1, 58 on frame 2.
  // So the erring frame is preceded by two clean ones, and the reference the
  // checks below compare against is the vertex count of a frame that WORKED,
  // read from this same run rather than written down.
  int cleanVerts = 0;
  auto cleanFrame = [&]() {
    ImGui::NewFrame();
    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
    ImGui::SetNextWindowSize(ImVec2(400.0f, 300.0f));
    ImGui::Begin("Part");
    ImGui::TextUnformatted("the user's model");
    ImGui::End();
    ImGui::EndFrame();
    ImGui::Render();
    return ImGui::GetDrawData() != nullptr ? ImGui::GetDrawData()->TotalVtxCount : 0;
  };
  cleanFrame();
  cleanVerts = cleanFrame();
  check(cleanVerts > 0, "C2 a clean frame draws the model (the reference)",
        std::to_string(cleanVerts) + " vertices");
  forge::desktop::drainImGuiErrorNotices();

  std::vector<ImGuiErrorNotice> notices;
  {
    ImGui::NewFrame();
    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
    ImGui::SetNextWindowSize(ImVec2(400.0f, 300.0f));
    ImGui::Begin("Part");
    ImGui::PushID("row");
    ImGui::TextUnformatted("the user's model");
    // No PopID(). No End(). A real, recoverable, entirely ordinary mistake.
    ImGuiWindow* part = ImGui::FindWindowByName("Part");
    ImGui::EndFrame();

    // MEASURED, both ways, against this library: repaired leaves the window
    // stack fully unwound and the id stack back at 1; NOT repaired leaves 1 and
    // 2. These are values that discriminate, not "it did not crash".
    checkSize(static_cast<std::size_t>(ctx->CurrentWindowStack.Size), 0u,
              "C3 the window stack is repaired by EndFrame()");
    check(part != nullptr && part->IDStack.Size == 1, "C4 the id stack is repaired",
          part == nullptr ? "no window" : std::to_string(part->IDStack.Size));

    ImGui::Render();
    const int verts = ImGui::GetDrawData() != nullptr ? ImGui::GetDrawData()->TotalVtxCount : 0;
    // EQUAL to the clean frame, not merely non-zero. The user's model is drawn,
    // and nothing the library wanted to say about itself is drawn beside it --
    // an unrepaired window leaves 42 extra vertices behind (measured), and a
    // tooltip would add its own.
    checkSize(static_cast<std::size_t>(verts), static_cast<std::size_t>(cleanVerts),
              "C5 the erring frame draws the model, and only the model");
    check(ImGui::FindWindowByName("##Tooltip_Error") == nullptr,
          "C6 the library drew none of its own prose", "##Tooltip_Error exists");
    notices = forge::desktop::drainImGuiErrorNotices();
  }
  {
    // Recovery is only worth anything if the application keeps running.
    const int verts = cleanFrame();
    checkSize(static_cast<std::size_t>(verts), static_cast<std::size_t>(cleanVerts),
              "C7 the next frame renders: the application kept running");
    checkSize(forge::desktop::drainImGuiErrorNotices().size(), 0u,
              "C8 a clean frame produces no notice");
    check(ImGui::FindWindowByName("##Tooltip_Error") == nullptr,
          "C9 still no library prose on the next frame", "##Tooltip_Error exists");
  }

  // ── D. what the user is handed ───────────────────────────────────────────
  if (g_mutation == 7) {
    // A translator that hands the library's message straight through. The exact
    // defect ui/test/run_user_prose_gate.sh mutation 6 exists for, aimed at this
    // gate's own copy of that rule.
    for (ImGuiErrorNotice& n : notices) n.userText = n.detail;
  }
  checkSize(notices.size(), 2u, "D1 both recovered errors were surfaced");
  {
    std::string details;
    for (const ImGuiErrorNotice& n : notices) {
      if (!details.empty()) details += " | ";
      details += n.detail;
    }
    check(contains(details, "Missing End()"), "D2 the library's own words are kept: Missing End()",
          details);
    check(contains(details, "Missing PopID()"),
          "D3 the library's own words are kept: Missing PopID()", details);
    std::printf("[imgui_recovery] %zu notice(s): %s\n", notices.size(), details.c_str());
  }
  for (const ImGuiErrorNotice& n : notices) {
    check(!n.userText.empty(), "D4 the user is told something", "empty sentence");
    const std::vector<forge::ui::ProseFinding> f = forge::ui::scanUserFacingProse(n.userText);
    check(f.empty(), "D5 the sentence is fit for a user",
          forge::ui::describeProseFindings(f) + " in \"" + n.userText + "\"");
    check(!n.detail.empty() && !contains(n.userText, n.detail),
          "D6 the sentence does not echo the library's message", n.userText);
    for (const char* word : {"Missing", "PopID", "End()", "ImGui", "imgui"}) {
      check(!contains(n.userText, word), "D7 no library vocabulary in the sentence", word);
    }
  }
  if (!notices.empty()) {
    std::printf("[imgui_recovery] the user reads: %s\n", notices.front().userText.c_str());
  }

  {
    // The queue is BOUNDED. One mismatched Begin() errs on every frame for as
    // long as the panel is open; an unbounded queue turns a recovered error into
    // memory growth, which is another way to lose the user's work.
    forge::desktop::resetImGuiErrorNotices();
    const std::size_t cap = forge::desktop::imGuiErrorNoticeCapacity();
    const std::size_t over = 9;
    // Both consoles are silenced for the flood and restored after: the library's
    // debug log goes to the TTY by default, and the policy's own callback writes
    // every message to stderr, which is the property C1..D7 rely on. Neither is
    // being changed -- 73 identical lines are simply not evidence of anything,
    // and a gate whose output nobody can read is a gate nobody reads. The POLICY
    // is untouched; this is the gate's console, not the application's.
    const ImGuiDebugLogFlags saved = ctx->DebugLogFlags;
    ctx->DebugLogFlags &= ~ImGuiDebugLogFlags_OutputToTTY;
    std::fflush(stderr);
    const int savedStderr = ::dup(2);
    const int devnull = ::open("/dev/null", O_WRONLY);
    if (savedStderr >= 0 && devnull >= 0) ::dup2(devnull, 2);
    ImGui::NewFrame();
    ImGui::Begin("Part");
    for (std::size_t i = 0; i < cap + over; ++i) ImGui::ErrorLog("Missing End()");
    ImGui::End();
    ImGui::EndFrame();
    ImGui::Render();
    std::fflush(stderr);
    if (savedStderr >= 0 && devnull >= 0) ::dup2(savedStderr, 2);
    if (devnull >= 0) ::close(devnull);
    if (savedStderr >= 0) ::close(savedStderr);
    ctx->DebugLogFlags = saved;
    check(savedStderr >= 0 && devnull >= 0, "D8 the flood ran with the console redirected",
          "could not redirect; the counts below are still the claim");
    const std::size_t dropped = forge::desktop::imGuiErrorNoticesDropped();
    const std::vector<ImGuiErrorNotice> flood = forge::desktop::drainImGuiErrorNotices();
    checkSize(flood.size(), cap, "D9 the notice queue is capped");
    checkSize(dropped, over, "D10 what the cap dropped is counted, not silently lost");
    forge::desktop::resetImGuiErrorNotices();
    checkSize(forge::desktop::imGuiErrorNoticesDropped(), 0u, "D11 the dropped count resets");
  }

  // ── E. the developer's escape hatch is real, and it is not the default ───
  {
    forge::desktop::applyImGuiErrorPolicy(ImGuiErrorPolicy::DeveloperDiagnostics);
    checkBool(io.ConfigErrorRecoveryEnableAssert, true, "E1 developer mode restores the assert");
    checkBool(io.ConfigErrorRecoveryEnableTooltip, true, "E2 developer mode restores the tooltip");
    checkBool(io.ConfigDebugHighlightIdConflicts, true, "E3 developer mode restores the popup");
    checkBool(io.ConfigDebugHighlightIdConflictsShowItemPicker, true,
              "E4 developer mode restores the item picker");
    check(ctx->ErrorCallback == nullptr, "E5 developer mode takes our callback back off", "still set");
    checkSize(imGuiErrorPolicyViolations(ImGuiErrorPolicy::DeveloperDiagnostics).size(), 0u,
              "E6 developer diagnostics are in force");
    check(!imGuiErrorPolicyViolations(ImGuiErrorPolicy::Shipping).empty(),
          "E7 and that state is NOT the shipping policy", "it satisfies both, which is impossible");
    // Back again, from a configured context rather than a fresh one: the policy
    // must be reachable from wherever the context happens to be.
    forge::desktop::applyImGuiErrorPolicy(ImGuiErrorPolicy::Shipping);
    applyLiveMutation();
    const std::vector<std::string> v = imGuiErrorPolicyViolations(ImGuiErrorPolicy::Shipping);
    check(v.empty(), "E8 shipping is restorable over developer mode", join(v));
  }

  // ── F. the application actually calls it ─────────────────────────────────
  {
    std::string root;
    if (const char* env = std::getenv("FORGE_DESKTOP_ROOT"); env != nullptr && *env != '\0') {
      root = env;
    } else {
#ifdef FORGE_DESKTOP_REPO_ROOT
      root = FORGE_DESKTOP_REPO_ROOT;
#endif
    }
    const std::string path = root + "/forge-desktop/src/main.cpp";
    bool ok = false;
    std::string code = readFile(path, ok);
    if (g_mutation == 8) {
      ok = true;
      code = kMainCppBeforeTheFix;
    }
    // A check that cannot read its subject must be RED. Silently passing on a
    // missing file is the zero-that-arrives-too-fast failure in another costume.
    check(ok && !code.empty(), "F1 the application's entry point is readable", path);
    if (ok && !code.empty()) {
      check(contains(code, "applyImGuiErrorPolicy("),
            "F2 the entry point applies the policy", path);
      check(contains(code, "ImGuiErrorPolicy.hpp"), "F3 and includes it by name", path);
      for (const char* name : kSettingNames) {
        check(!assignsSetting(code, name),
              "F4 the entry point sets no error setting itself", name);
      }
    }
  }

  ImGui::DestroyContext();

  std::printf("[imgui_recovery] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures == 0) {
    std::printf("[imgui_recovery] GREEN — a recoverable interface error costs a repaired frame "
                "and one plain sentence, never the model\n");
  }
  return g_failures == 0 ? 0 : 1;
}
