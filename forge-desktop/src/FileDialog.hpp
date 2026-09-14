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

// ── ★ WHAT THE APPLICATION KNOWS ABOUT THE DOCUMENT (T-127 / T-128) ─────────
// Handed to the two seed producers below so that a box can never OPEN on a file
// it would then be refused for. The refusal is the shell's job and it holds;
// this is the other half, and skipping it is what the eighth and ninth members
// of this family were:
//
//   T-128  a document opened from bracket.txt put `bracket.fpart` in the Save As
//          box by swapping the suffix. A DIFFERENT PART was at that name, and one
//          Run with nothing typed replaced it -- 2 NOTE / 5 FEATURE / 738 B ->
//          1 / 5 / 635 B, warnings +1, errors +0.
//   T-127  a document imported from bracket.step and saved as bracket.fpart put
//          `bracket.step` in the export box by the same suffix swap. That file is
//          what the part is BUILT FROM, and one Run took it from 53903 bytes /
//          1991 entity lines to 49327 / 1751.
//
// NO DEFAULT VALUE, deliberately. A defaulted empty context would give every
// existing caller the unsafe answer silently, which is the exact shape of the
// eight defects this is closing.
struct SeedContext {
  // The open document's own file; "" for an untitled part. A Save box MAY open
  // on this one -- replacing the file you chose is what Save means.
  std::string ownDocument;
  // Every file the open document READS -- forge::ui::ForgeShell::documentBindings().
  // No box may open on one of these.
  std::vector<std::string> boundFiles;
};

// The policy filled in with the app's own state: where the panel should open and
// what it should be called. `seed` is a path the application already knows (the
// open document, or the most recent one, or a bare document name); "" is legal
// and means the panel opens wherever the platform last left it.
//
// For a SAVE panel the seed's extension is REPLACED by the policy's, so
// "Save a Copy as STEP" on `bracket.fpart` starts on `bracket.step` rather than
// offering to write STEP bytes into a Forge document.
bool fileDialogRequestFor(const std::string& commandId, const std::string& seed,
                          const SeedContext& context, FileDialogRequest& out);

// ── ★ THE ONE RULE ABOUT WHAT A SAVE STARTS ON ──────────────────────────────
// `seed` (which file this command is about) with the NAME this command's own
// output should carry: for a SAVE-mode command the seed's extension is replaced
// by the policy's, and an OPEN-mode command -- or one with no policy row at all
// -- gets the seed back unchanged.
//
// It is its own function because it has TWO callers and they are two different
// UIs: fileDialogRequestFor() above (the native panel) and
// ForgeFrame::openPrompt() (the typed-path box, which is what asks in every
// headless build and in any future non-Apple port). It existed only inside the
// first of those, and T-123 is the measurement of that: on a document that HAS
// a file, "Save a Copy as STEP" opened its PANEL on bracket.step and pre-filled
// its BOX with bracket.fpart, and one Run with nothing typed replaced the user's
// part with 53903 bytes of ISO-10303-21 -- no panel, no sheet, no confirmation,
// errors +0. forge_desktop_write_target_gate measures both halves of that on raw
// bytes now, one population per route.
// ── ★ AND IT MAY NOT HAND BACK A NAME SOMETHING IS SITTING ON ──────────────
// Four rules, in order, and each one is a measurement:
//
//   (a) the candidate IS context.ownDocument -> STAND. Save As on a .fpart keeps
//       the identity, which is what the native panel has always offered.
//   (b) the candidate names a context.boundFiles entry -> the next FREE name.
//       T-127: the box opened on the file the part is built from.
//   (c) file.save_as and the candidate EXISTS -> the next FREE name. T-128:
//       "Save As" means "give it a name it does not have", so a name invented
//       for it must be one nothing is on.
//   (d) an EXPORT onto a merely-occupied path -> STAND. "Export over my last
//       export" is ordinary intent and forge_desktop_write_target_gate W4(b)
//       pins it; a seed that swerved on occupancy would hand the user
//       bracket-2.step, bracket-3.step, for ever. The Run-time Replace question
//       covers that case instead.
//
// The discriminator between (c) and (d) is what the COMMAND MEANS, not a fudge.
std::string fileDialogSuggestedPath(const std::string& commandId, const std::string& seed,
                                    const SeedContext& context);

// ── the free-name rule, in ONE place ────────────────────────────────────────
// Moved here from ForgeFrame's anonymous namespace, unchanged, because it now
// has THREE callers in two files and its contract -- "may ONLY return a path
// std::filesystem::exists() says is absent, and never `forbidden`" -- is the
// whole of why a seed built through it cannot name a file anybody could lose.
//
// `swerved` says WHY the first name in the series was not the one returned, and
// the two reasons are different sentences to a user: a file really is in the
// way, or the caller forbade a name nothing is on. `firstChoice` is the name it
// wanted, for that sentence.
enum class Swerve {
  None,      // the first name in the series was free and was taken
  Occupied,  // a file really is sitting on it
  Refused,   // the caller forbade it -- nothing on disk
};

std::string firstFreeFallbackPath(const std::string& directory, const std::string& stem,
                                  const std::string& forbidden, const std::string& extension,
                                  Swerve& swerved, std::string& firstChoice);

// The file NAME a Save panel starts on -- the leaf of `suggestedPath`. Written
// here rather than in the Cocoa file so that the rule about what a file is
// called sits beside the rule that decides its suffix.
std::string fileDialogNameField(const std::string& suggestedPath);

// Every command this table covers, in registration order. The file-dialog gate
// walks it, so a file command that is registered and NOT given a policy is a
// gate failure rather than a menu item that silently cannot be reached. (That
// check has already earned its keep once: file.export_gcode, the Manufacturing
// workspace's only way out, is the seventh row.)
const std::vector<std::string>& fileDialogCommandIds();

// ── the native panel ────────────────────────────────────────────────────────
// Defined in FileDialogMac.mm and linked into the APPLICATION only. A build with
// no implementation for its platform gets nullptr, and ForgeFrame falls back to
// the text prompt it has always had -- so "there is no panel here" degrades to
// the previous behaviour instead of to a dead menu item.
std::unique_ptr<FileDialog> makeNativeFileDialog();

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_FILEDIALOG_HPP
