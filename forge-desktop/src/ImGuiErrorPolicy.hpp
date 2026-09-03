// forge-desktop/src/ImGuiErrorPolicy.hpp
//
// WHAT FORGE DOES WHEN ITS INTERFACE LIBRARY REPORTS A RECOVERABLE ERROR.
//
// ── the measurement this exists for ─────────────────────────────────────────
//
// Dear ImGui 1.92.9 WIP, the copy vendored in forge-desktop/third_party/imgui,
// ships these defaults (imgui.cpp:1701-1709, and MEASURED by this file's gate on
// a freshly created context, not read off the comment):
//
//     ConfigErrorRecovery                          = true
//     ConfigErrorRecoveryEnableAssert              = true
//     ConfigErrorRecoveryEnableDebugLog            = true
//     ConfigErrorRecoveryEnableTooltip             = true
//     ConfigDebugHighlightIdConflicts              = true
//     ConfigDebugHighlightIdConflictsShowItemPicker= true
//
// What those produce, both MEASURED against the vendored library with a real
// frame that leaves an unbalanced stack:
//
//   * WITHOUT NDEBUG the process DIES. IM_ASSERT is `assert()` (imgui.h:96) and
//     nothing in this repository overrides it, so IM_ASSERT_USER_ERROR's
//     `if (ErrorLog(msg)) IM_ASSERT(...)` aborts:
//         Assertion failed: ((0) && "Missing End()"), function
//         ErrorRecoveryTryToRecoverState, file imgui.cpp, line 11195
//         -> SIGABRT, exit 134
//     Every unsaved edit in the document goes with it.
//
//   * WITH NDEBUG -- which is what CMAKE_BUILD_TYPE=Release gives the shipped
//     bundle, so this is the shipping build TODAY -- the process survives, and
//     instead the library draws its own message over the user's model: a
//     `##Tooltip_Error` window, created on the erring frame and active on the
//     next, reading "In window 'Part': Missing End()", with a button labelled
//     "Enable Asserts" that turns the abort back on at runtime. Its sibling, the
//     duplicate-id path, opens the same window with "Programmer error: 2 visible
//     items with conflicting ID!" and advice to call PushID()/PopID().
//
// So the danger is not one thing but two, and only one of them is currently
// live. The abort is one `-DCMAKE_BUILD_TYPE=Debug` away from being live, and a
// guarantee that rests on NDEBUG being defined is a guarantee nobody stated and
// nothing checks. The prose is live now, and is what the user reported.
//
// ── the policy ──────────────────────────────────────────────────────────────
//
// RECOVER, DO NOT DIE, AND SAY IT IN FORGE'S OWN WORDS. The library keeps
// repairing the frame; it is told not to abort and not to draw; the message is
// handed to a callback here, translated by forge::ui::userFacingInterfaceFailure
// into a sentence a person can act on, and queued for the frame builder to put
// in the activity log -- user text in the message column, the library's own
// words kept verbatim in the detail column, where an engineer reads them.
//
// ── why this is a file and not six lines in main() ──────────────────────────
//
// It was six lines in main(). CI does COMPILE that file -- kernel-tests.yml's
// `desktop` job builds forge_desktop -- and compiling is not asserting: main.cpp
// defines main(), so no gate can LINK it, and nothing in the repository could
// execute or check what those six assignments did. (run_syntax_gate.sh, the
// cheap type-check, skips it as well, for SDL2 + Vulkan.) Deleting them would
// have built clean and stayed green everywhere, with a user's unsaved model one
// recoverable error away from the floor. Here they are a function with a
// predicate beside it, both linked into a gate that fails when the settings are
// left at the library's defaults -- and that gate READS main.cpp, so the
// application is still bound to the policy it is supposed to call.
#ifndef FORGE_DESKTOP_IMGUIERRORPOLICY_HPP
#define FORGE_DESKTOP_IMGUIERRORPOLICY_HPP

#include <cstddef>
#include <string>
#include <vector>

namespace forge::desktop {

enum class ImGuiErrorPolicy {
  // What a person who bought a CAD application gets.
  Shipping,
  // The library's own defaults, restored in full: asserts, tooltips, the
  // id-conflict popup and its item picker, and NO callback of ours. Selected by
  // FORGE_IMGUI_DEV_DIAGNOSTICS in the environment. A developer who wants to
  // break in the debugger at the offending frame asks for it by name.
  DeveloperDiagnostics,
};

// One recoverable error, in both registers.
struct ImGuiErrorNotice {
  // For the user. Produced by forge::ui::userFacingInterfaceFailure, so it is
  // prose-clean by construction and never quotes `detail`.
  std::string userText;
  // The library's own message, verbatim, for the log's detail column and for
  // stderr. Never drawn as a sentence.
  std::string detail;
};

// Apply `policy` to the CURRENT ImGui context: the six settings above, and the
// error callback. Requires a context to exist.
void applyImGuiErrorPolicy(ImGuiErrorPolicy policy);

// Which requirements of `policy` the CURRENT context does not meet, each named
// in full ("ConfigErrorRecoveryEnableAssert must be false, it is true"). EMPTY
// exactly when the policy is in force.
//
// This is the predicate the gate asserts on, and on a context that has just been
// created -- the library's defaults, the state main() used to leave it in if
// anybody deleted those six lines -- it is NOT empty. That is the whole point:
// "the configuration was left at its default" is a value this returns, not a
// thing a reviewer has to notice.
std::vector<std::string> imGuiErrorPolicyViolations(ImGuiErrorPolicy policy);

// Everything surfaced since the last drain, oldest first, and the queue is left
// empty. Called once per frame by the frame builder.
std::vector<ImGuiErrorNotice> drainImGuiErrorNotices();

// The queue is BOUNDED. A panel with a mismatched Begin() raises its error on
// EVERY frame, sixty times a second, for as long as the panel is open; an
// unbounded queue would turn a recovered error into memory growth, which is a
// second way to lose the user's work. Past the cap, notices are counted and
// dropped, oldest kept -- the first one is the one that says what happened.
std::size_t imGuiErrorNoticeCapacity() noexcept;
std::size_t imGuiErrorNoticesDropped() noexcept;

// Empty the queue and zero the dropped count, without touching the context.
void resetImGuiErrorNotices() noexcept;

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_IMGUIERRORPOLICY_HPP
