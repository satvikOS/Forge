// ui/include/forge/ui/UserFacingText.hpp
//
// WHAT A USER IS ALLOWED TO READ — the one place that decides whether a string
// is fit to put in front of somebody who bought a CAD application.
//
// THE DEFECT THIS EXISTS FOR, MEASURED.
//
//   forge-desktop/src/ForgeFrame.cpp drew, into a docked panel, in a shipped
//   build:
//
//     Panel "mates" is docked and laid out by forge::ui::DockLayout, and its
//     position, tab order and active tab persist across restart. Its content is
//     not implemented in this segment.
//
//   Three separate failures in one paragraph: it names a C++ class, it describes
//   the program's own internals instead of the user's work, and "in this
//   segment" is a note from one engineer to another about a development
//   schedule. It reached the user because nothing checked.
//
//   The same shape, in the same build, on the failure path: KernelScene's error
//   text ("parse failed: a non-std exception escaped forge::ft::parse") went
//   STRAIGHT into an ImGui::TextWrapped and into the activity log.
//
// ── two halves, deliberately ────────────────────────────────────────────────
//
//   scanUserFacingProse()  is the JUDGE. It takes a string and returns every
//                          class of developer leakage in it. The gate calls it
//                          over the shipped strings; the app can call it too.
//
//   userFacing*Failure()   is the TRANSLATOR. Internal detail in, a sentence a
//                          user can act on out. The detail is NOT echoed: a
//                          translator that appends the raw cause is the same
//                          leak wearing a hat, and the gate proves it does not,
//                          by feeding it every internal string this repository
//                          actually produces and scanning the answer.
//
// The technical detail is not destroyed. It goes to the activity log and to
// stderr, where an engineer can read it and a user never has to.
//
// ── why the scanner is in the SHIPPED library, not only in the test ────────
// A checker that lives in a test can only be run by a test. This one is linked
// into the application, so a panel that wants to show a message it did not
// write can ask first. It is also the reason the gate cannot be satisfied by
// prose: the gate calls THIS function, and a new violation is new input to a
// function that has already been proved to fire.
#ifndef FORGE_UI_USERFACINGTEXT_HPP
#define FORGE_UI_USERFACINGTEXT_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::ui {

// The classes of leakage. Each one is a thing a user cannot act on and should
// never have been shown.
enum class ProseDefect : std::uint8_t {
  // "forge::ui::DockLayout", "std::string", "ImGui::Begin" — a scope operator in
  // running text is a C++ name, always.
  CppScope,
  // "ImGui", "Vulkan", "SDL", "OCCT" — the parts list of the program, not of the
  // user's part.
  LibraryName,
  // "vkCreateFramebuffer", "ImGui_ImplVulkan_AddTexture", "SDL_Init" — a symbol
  // copied out of somebody else's API reference.
  ApiSymbol,
  // "not implemented", "TODO", "placeholder", "stub" — a note about the
  // development schedule, addressed to the developer.
  NotImplemented,
  // "programmer error", "assertion", "exception", "nullptr", "in this segment" —
  // the vocabulary of the debugger.
  DeveloperNoun,
  // "ForgeFrame.cpp:1278" — where the code is, which is never where the user is.
  SourceLocation,
};

const char* toString(ProseDefect defect) noexcept;

// What was found, and where, so a failure message can quote it.
struct ProseFinding {
  ProseDefect defect = ProseDefect::CppScope;
  std::string match;         // the offending substring, as it appears
  std::size_t offset = 0;    // byte offset into the scanned text
};

// Every defect in `text`, in offset order. EMPTY exactly when the string is fit
// to show a user.
//
// Total: it never throws and answers for any input, including the empty string
// (clean — an empty string shows nothing) and printf format strings (the format
// is scanned as written; "%s" is clean, because what it interpolates is scanned
// where that value is produced).
std::vector<ProseFinding> scanUserFacingProse(const std::string& text);

bool userFacingProseIsClean(const std::string& text);

// "forge::ui::DockLayout [CppScope]; not implemented [NotImplemented]" — for a
// gate's failure output. Empty when there are no findings.
std::string describeProseFindings(const std::vector<ProseFinding>& findings);

// ── the translators ─────────────────────────────────────────────────────────
//
// `detail` is the internal cause: an exception message, a kernel report, a
// driver string. It is used to CHOOSE a sentence and is never quoted in one.
// Callers must log `detail` separately — every one of these has a companion log
// call at its call site, and the panel that shows the sentence says where the
// detail is.

// The model could not be rebuilt from its features.
std::string userFacingBuildFailure(const std::string& detail);

// The 3D view could not be drawn (no GPU surface, no texture, a driver refusal).
std::string userFacingViewportFailure(const std::string& detail);

// The application could not finish starting. `stage` is a short internal name
// for what was being set up; it is used to choose a sentence and is not quoted.
std::string userFacingStartupFailure(const std::string& stage, const std::string& detail);

// Where a user can read the detail that was not shown. One sentence, appended by
// the callers that have a console to point at, so the wording is written once.
const char* userFacingDetailPointer() noexcept;

}  // namespace forge::ui

#endif  // FORGE_UI_USERFACINGTEXT_HPP
