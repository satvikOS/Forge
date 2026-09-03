// forge-desktop/src/FileDialog.hpp
//
// THE MOUSE LAYER OF FILE EXCHANGE — the panel that turns a required `path`
// parameter into a file a user actually chose.
//
// ── the gap this closes, measured ───────────────────────────────────────────
// PR #206 registered six commands -- file.open, file.save, file.import_step,
// file.export_step, file.import_brep, file.export_brep -- and the registry went
// from 80 to 84 entries. Four of them declare `path` REQUIRED with no default,
// which ForgeShell::invoke() correctly answers with
// DispatchStatus::MissingRequiredParameter, and ForgeFrame answered THAT with an
// ImGui text box the user had to type an absolute path into. So the capability
// was real at the command layer and, for anyone driving Forge with a mouse,
// absent: nothing in the application could produce a path.
//
// ── WHAT THIS FILE IS, AND WHAT IT IS NOT ───────────────────────────────────
// It is TWO things and deliberately no more:
//
//   1. the SEAM  -- an abstract FileDialog whose one method takes a request and
//      answers with a path or with "the user cancelled". Cancel is a VALUE, not
//      an error and not an exception: `accepted == false` and nothing else
//      happens. Every native panel in every operating system can be cancelled,
//      and a cancel reported as a failure is how a File menu grows an error
//      toast that says a user did something wrong by changing their mind.
//
//   2. the POLICY -- which of the registered commands opens a panel, whether it
//      is an Open or a Save panel, and which extensions it filters for. That
//      table is pure data, it lives in forge_desktop_core, and it is therefore
//      linkable by a headless gate with no AppKit, no window and no mouse.
//
// It is NOT the Cocoa code. NSOpenPanel and NSSavePanel are in FileDialogMac.mm,
// which is compiled into the APPLICATION only, for the same reason the updater's
// socket is: a gate that had to open a modal window would be a gate nobody runs.
//
// ── THE EXTENSIONS ARE NOT SPELLED HERE ─────────────────────────────────────
// forge::ui::formatExtensions() already owns the canonical list, canonical entry
// first, and forge::ui::formatFromPath() is what ForgeShell::runExport uses to
// refuse a STEP write into a file the user named `.igs`. A second list of
// extensions in this file would be a second opinion about what a STEP file is
// called, and the two would eventually disagree -- with the panel offering a
// suffix the command then refuses. So the filters are READ from that function
// and the only literal extension here is Forge's own document suffix, which
// forge::ui has never heard of because .fpart is not an exchange format.
#ifndef FORGE_DESKTOP_FILEDIALOG_HPP
#define FORGE_DESKTOP_FILEDIALOG_HPP

#include <memory>
#include <string>
#include <vector>

namespace forge::desktop {

enum class FileDialogMode { Open, Save };

// One row of the panel's format popup: what a user calls the format, and the
// extensions that belong to it, canonical one first, each with its leading dot.
struct FileFilter {
  std::string label;                   // "STEP", "Forge Part"
  std::vector<std::string> extensions; // ".step", ".stp"
};

struct FileDialogRequest {
  FileDialogMode mode = FileDialogMode::Open;
  // Every one of these is shown to a user, so every one of them is subject to
  // the prose rule -- forge::ui::isUserReadable() is applied to all three by the
  // file-dialog gate, which is the same predicate the exchange messages pass.
  std::string title;   // the panel's title
  std::string prompt;  // the accept button: "Open", "Save", "Export"
  // Where the panel opens, and (Save only) the name it starts on. May be a bare
  // file name, an absolute path, or empty.
  std::string suggestedPath;
  // Appended by a Save panel when the user types a name with no suffix. "" means
  // the panel must not add one.
  std::string defaultExtension;
  std::vector<FileFilter> filters;  // empty = accept anything
};

struct FileDialogResult {
  // FALSE MEANS THE USER CANCELLED, and a cancel is a no-op. It is not an error,
  // it raises no refusal, it writes nothing to the activity log's error count
  // and it must never reach the status strip as a failure. This is the whole
  // reason the result is a struct rather than a std::string: "" is both "the
  // user cancelled" and "the user chose a file named nothing", and a caller that
  // cannot tell those apart eventually reports one as the other.
  bool accepted = false;
  std::string path;  // absolute; meaningful only when `accepted`
};

class FileDialog {
 public:
  virtual ~FileDialog() = default;
  // Runs the panel MODALLY and returns what the user chose. Called on the main
  // thread, from outside the ImGui frame -- see ForgeFrame::runPendingFileDialog.
  virtual FileDialogResult run(const FileDialogRequest& request) = 0;
};

// ── the policy table ────────────────────────────────────────────────────────
// What `path` MEANS to a command, which is what decides when a panel is owed.
//
//   Required    the command declares `path` required with no default, so the
//               dispatcher answers MissingRequiredParameter until one is
//               supplied. file.open and the four exchange commands.
//   SaveTarget  the command's `path` is OPTIONAL -- a bare Ctrl+S is a Save, and
//               making the parameter required would turn every keyboard save
//               into MissingRequiredParameter (ForgeShell.cpp says exactly
//               that). A panel is owed only when the application has nowhere to
//               save: an untitled document. Otherwise Save means SAVE, silently,
//               over the file it came from, which is what Save has meant since
//               1984 and what a panel on every keystroke would destroy.
enum class PathRole { Required, SaveTarget };

struct FileDialogPolicy {
  FileDialogMode mode = FileDialogMode::Open;
  PathRole role = PathRole::Required;
  std::string title;
  std::string prompt;
  std::vector<FileFilter> filters;
  std::string defaultExtension;
};

// The policy for `commandId`, or false when that command opens no panel. The
// answer is the SAME for every invoker -- a menu click, a keystroke, the command
// palette, the ribbon -- because they all reach the one function that reads it.
bool fileDialogPolicyFor(const std::string& commandId, FileDialogPolicy& out);

// The policy filled in with the app's own state: where the panel should open and
// what it should be called. `seed` is a path the application already knows (the
// open document, or the most recent one, or a bare document name); "" is legal
// and means the panel opens wherever the platform last left it.
//
// For a SAVE panel the seed's extension is REPLACED by the policy's, so
// "Save a Copy as STEP" on `bracket.fpart` starts on `bracket.step` rather than
// offering to write STEP bytes into a Forge document.
bool fileDialogRequestFor(const std::string& commandId, const std::string& seed,
                          FileDialogRequest& out);

// The file NAME a Save panel starts on -- the leaf of `suggestedPath`. Written
// here rather than in the Cocoa file so that the rule about what a file is
// called sits beside the rule that decides its suffix.
std::string fileDialogNameField(const std::string& suggestedPath);

// Every command this table covers, in registration order. The file-dialog gate
// walks it, so a seventh file command that is registered and NOT given a policy
// is a gate failure rather than a menu item that silently cannot be reached.
const std::vector<std::string>& fileDialogCommandIds();

// ── the native panel ────────────────────────────────────────────────────────
// Defined in FileDialogMac.mm and linked into the APPLICATION only. A build with
// no implementation for its platform gets nullptr, and ForgeFrame falls back to
// the text prompt it has always had -- so "there is no panel here" degrades to
// the previous behaviour instead of to a dead menu item.
std::unique_ptr<FileDialog> makeNativeFileDialog();

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_FILEDIALOG_HPP
