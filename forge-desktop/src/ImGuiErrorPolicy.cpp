#include "ImGuiErrorPolicy.hpp"

#include <cstddef>
#include <cstdio>
#include <string>
#include <vector>

#include "imgui.h"
// ErrorCallback lives on ImGuiContext, not on ImGuiIO. imgui.h:2507 documents
// the recovery recipe ("disable assert, set log callback ... recover") and
// imgui_internal.h:2601 is where the field is, marked "May be exposed in public
// API eventually". Until it is, this is the seam, and it is the one the library
// itself points at -- ErrorCheckNewFrameSanityChecks (imgui.cpp:11102) accepts
// `g.ErrorCallback != NULL` as a legitimate answer to its own "we do not accept
// 100% silent recovery" requirement.
#include "imgui_internal.h"

#include "forge/ui/UserFacingText.hpp"

namespace forge::desktop {
namespace {

// Sixty-four is not a budget, it is a stop. One mismatched Begin() raises its
// error every frame for as long as the panel is open; what a reader needs is the
// first few and an honest count of the rest.
constexpr std::size_t kNoticeCapacity = 64;

// ImGui is single-threaded by construction -- every entry point asserts on the
// context it was given and there is no locking anywhere in it -- and this
// callback is only ever called from inside an ImGui call on that thread. So the
// queue is a plain static, with no lock that would be a lie about the threading
// model.
std::vector<ImGuiErrorNotice>& queue() {
  static std::vector<ImGuiErrorNotice> q;
  return q;
}
std::size_t& droppedCount() {
  static std::size_t dropped = 0;
  return dropped;
}

// The callback the library calls, from inside EndFrame()/End(), on the frame
// that erred. It must not call back into ImGui -- the context is mid-recovery
// and its stacks are being unwound as we are called.
void onRecoverableError(ImGuiContext*, void*, const char* msg) {
  const std::string detail = msg != nullptr ? msg : "";
  // stderr, ALWAYS, and unconditionally: this is where an engineer reads the
  // library's own words. The user never sees this stream.
  std::fprintf(stderr, "[forge] interface recovered: %s\n", detail.c_str());
  std::vector<ImGuiErrorNotice>& q = queue();
  if (q.size() >= kNoticeCapacity) {
    ++droppedCount();
    return;
  }
  q.push_back(ImGuiErrorNotice{forge::ui::userFacingInterfaceFailure(detail), detail});
}

struct Requirement {
  const char* name;
  bool required;
  bool actual;
};

}  // namespace

void applyImGuiErrorPolicy(ImGuiErrorPolicy policy) {
  ImGuiIO& io = ImGui::GetIO();
  ImGuiContext* ctx = ImGui::GetCurrentContext();

  if (policy == ImGuiErrorPolicy::DeveloperDiagnostics) {
    // The library's own defaults, restored in full and by value, not by "leave
    // it alone": this function may run on a context another one already
    // configured, and a hatch that only half-opens is worse than none.
    io.ConfigErrorRecovery = true;
    io.ConfigErrorRecoveryEnableAssert = true;
    io.ConfigErrorRecoveryEnableDebugLog = true;
    io.ConfigErrorRecoveryEnableTooltip = true;
    io.ConfigDebugHighlightIdConflicts = true;
    io.ConfigDebugHighlightIdConflictsShowItemPicker = true;
    if (ctx != nullptr) {
      ctx->ErrorCallback = nullptr;
      ctx->ErrorCallbackUserData = nullptr;
    }
    std::fprintf(stderr,
                 "[forge] developer diagnostics are ON: a recoverable interface error will "
                 "assert, and the library will draw its own messages over the model\n");
    return;
  }

  // ── the shipping policy ───────────────────────────────────────────────────
  // KEEP repairing the frame. Recovery is what makes a mismatched Begin() a
  // tidied frame instead of a wrecked context; turning it off does not make the
  // error go away, it makes the next frame the one that dies.
  io.ConfigErrorRecovery = true;
  // NEVER abort. This is the setting the whole file is about: it decides whether
  // a recoverable error costs a repaired frame or an unsaved model.
  io.ConfigErrorRecoveryEnableAssert = false;
  // KEEP the library's debug log. Nothing is being hidden from the engineer --
  // the same lines are printed as before, on the same stream.
  io.ConfigErrorRecoveryEnableDebugLog = true;
  // NEVER draw. The tooltip is the library talking to a programmer, in a
  // programmer's words, on top of the part somebody is working on.
  io.ConfigErrorRecoveryEnableTooltip = false;
  // NEVER draw the duplicate-id popup either. Its first line is "Programmer
  // error: N visible items with conflicting ID!" and its last offers to open an
  // item picker; the library's own advice, in that popup, is to set this to
  // false "in non-programmers builds".
  io.ConfigDebugHighlightIdConflicts = false;
  io.ConfigDebugHighlightIdConflictsShowItemPicker = false;
  // ... and BECAUSE nothing is drawn, something must carry the message out. This
  // is also what keeps the arrangement legal by the library's own rule: with
  // asserts and tooltips off, `g.ErrorCallback != NULL` is what satisfies
  // ErrorCheckNewFrameSanityChecks' refusal of 100% silent recovery.
  if (ctx != nullptr) {
    ctx->ErrorCallback = &onRecoverableError;
    ctx->ErrorCallbackUserData = nullptr;
  }
}

std::vector<std::string> imGuiErrorPolicyViolations(ImGuiErrorPolicy policy) {
  std::vector<std::string> out;
  ImGuiContext* ctx = ImGui::GetCurrentContext();
  if (ctx == nullptr) {
    out.emplace_back("there is no interface context to configure");
    return out;
  }
  const ImGuiIO& io = ctx->IO;
  const bool dev = policy == ImGuiErrorPolicy::DeveloperDiagnostics;

  const Requirement reqs[] = {
      {"ConfigErrorRecovery", true, io.ConfigErrorRecovery},
      {"ConfigErrorRecoveryEnableAssert", dev, io.ConfigErrorRecoveryEnableAssert},
      {"ConfigErrorRecoveryEnableDebugLog", true, io.ConfigErrorRecoveryEnableDebugLog},
      {"ConfigErrorRecoveryEnableTooltip", dev, io.ConfigErrorRecoveryEnableTooltip},
      {"ConfigDebugHighlightIdConflicts", dev, io.ConfigDebugHighlightIdConflicts},
      {"ConfigDebugHighlightIdConflictsShowItemPicker", dev,
       io.ConfigDebugHighlightIdConflictsShowItemPicker},
  };
  for (const Requirement& r : reqs) {
    if (r.actual != r.required) {
      out.push_back(std::string(r.name) + " must be " + (r.required ? "true" : "false") +
                    ", it is " + (r.actual ? "true" : "false"));
    }
  }

  const bool haveCallback = ctx->ErrorCallback == &onRecoverableError;
  if (!dev && !haveCallback) {
    out.emplace_back(
        "no error callback is installed, so a recovered error reaches nobody: the user is told "
        "nothing and the library's own no-silent-recovery rule is broken");
  }
  if (dev && ctx->ErrorCallback != nullptr) {
    out.emplace_back("an error callback is installed, which developer diagnostics must not have");
  }
  return out;
}

std::vector<ImGuiErrorNotice> drainImGuiErrorNotices() {
  std::vector<ImGuiErrorNotice> out;
  out.swap(queue());
  return out;
}

std::size_t imGuiErrorNoticeCapacity() noexcept { return kNoticeCapacity; }

std::size_t imGuiErrorNoticesDropped() noexcept { return droppedCount(); }

void resetImGuiErrorNotices() noexcept {
  queue().clear();
  droppedCount() = 0;
}

}  // namespace forge::desktop
