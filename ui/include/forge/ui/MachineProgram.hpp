// ui/include/forge/ui/MachineProgram.hpp
//
// THE MANUFACTURING EGRESS — getting the posted machine program OUT of Forge
// and onto a machine.
//
// ── the gap this closes, MEASURED ───────────────────────────────────────────
// The Manufacturing workspace is real and it is gate-proven.
// `forge_desktop_cam_panels_gate` reports, on the app's own default part:
//
//   [gate] program: 578 lines, 8 passes, 2189.6 mm of cutting, 73.0 s
//   [gate] 152 checks, 0 failures
//
// and check 5 of that gate re-posts the SAME toolpath through
// forge::camx::postProcess and requires the panel's text to match byte for byte,
// so those 578 lines are the post-processor's own output and not a sample.
//
// And the ONLY way that program could leave the application was
// `ImGui::SetClipboardText` behind a "Copy" button. Measured before this file
// existed:
//
//   grep -rn 'export_gcode\|\.nc\b\|machine program' ui/src forge-desktop/src
//
// found the Copy button and nothing else — no command, no File-menu entry, no
// dialog policy, no writer. A shop cannot paste a clipboard into a machine, and
// a program a user cannot save is a program that was never produced.
//
// ── why a SEPARATE seam, and not FileExchange ───────────────────────────────
// FileExchange answers "what geometry can the kernel read and write", and its
// one implementation (FileExchangeHost) compiles the document and hands a
// ShapeHandle to forge::io. A machine program is not geometry and does not come
// from the document at all: it comes from the CAM plan the Manufacturing panels
// currently hold, which is state in the FRAME. Adding a method to FileExchange
// would also make its one implementer abstract, which is the exact defect the
// FileExchange header records ("a file nothing compiles cannot break").
//
// So this is a second, separately-installed interface, on the same pattern and
// for the same stated reason: a build with no CAM panels — every headless
// forge::ui gate is one — says so by leaving `file.export_gcode` DISABLED,
// rather than by failing when it is pressed.
//
// ── THE PROSE RULE APPLIES HERE TOO ─────────────────────────────────────────
// Every sentence a user can read is written in ONE function below
// (`machineProgramMessage`), and forge::ui::isUserReadable is the mechanical
// predicate a gate applies to every one of them — the same predicate the file
// exchange messages pass. An advice sentence supplied by the SOURCE is checked
// against it too, and replaced when it fails: the source is the best place to
// explain why there is no program, and it is not trusted to be the only one.
#ifndef FORGE_UI_MACHINEPROGRAM_HPP
#define FORGE_UI_MACHINEPROGRAM_HPP

#include <cstddef>
#include <cstdint>
#include <iterator>
#include <string>
#include <vector>

namespace forge::ui {

// Why a machine program was not written. A CLOSED set, because every value here
// has to have a sentence written for it and a gate that walks the whole list.
enum class MachineProgramRefusal : std::uint8_t {
  None = 0,
  NoPath,       // the command was invoked with an empty path
  NoSource,     // no machine-program source is installed in this build
  NoProgram,    // there is no operation set up yet, so nothing has been posted
  WriteFailed,  // Forge could not put the bytes on disk
};

inline constexpr MachineProgramRefusal kAllMachineProgramRefusals[] = {
    MachineProgramRefusal::None,
    MachineProgramRefusal::NoPath,
    MachineProgramRefusal::NoSource,
    MachineProgramRefusal::NoProgram,
    MachineProgramRefusal::WriteFailed,
};
static_assert(std::size(kAllMachineProgramRefusals) ==
                  static_cast<std::size_t>(MachineProgramRefusal::WriteFailed) + 1,
              "kAllMachineProgramRefusals must list EVERY MachineProgramRefusal: the "
              "prose gate walks it, and a value missing from it is a sentence nobody "
              "checked.");

// The stable machine spelling, for a log's detail field. Never shown to a user.
const char* toString(MachineProgramRefusal refusal) noexcept;

// The suffixes a shop puts on a machine program, canonical one FIRST, each with
// its leading dot and lower-case. ONE owner, for the reason FileDialog.hpp gives
// about extensions: a second list would eventually offer a suffix the command
// refuses.
//
// All three of the post-processor's dialects are here. `.nc` is the Fanuc-style
// suffix and the canonical one; `.h` is what a Heidenhain conversational program
// is called and `.mpf` a Siemens main program, and a panel that would not let a
// Heidenhain user save a `.H` file is a panel that has an opinion about their
// shop. NOTHING reconciles the suffix against the dialect — unlike STEP bytes in
// a file named `.igs`, a machine program in a differently-suffixed file is a
// naming convention and not a lie about its contents.
const std::vector<std::string>& machineProgramExtensions();

// ── what the source hands over ──────────────────────────────────────────────
struct MachineProgram {
  // The posted program, EXACTLY as the post-processor wrote it. Not reflowed,
  // not re-indented, not re-terminated: it is machine code, and every one of
  // those would change what it means.
  std::string text;
  // What the user chose on the Post Output tab -- "Fanuc", "Heidenhain",
  // "Siemens". A user word: it is quoted into the sentence they read.
  std::string dialect;
  std::size_t lines = 0;
  // Set when there IS no program, and only then: the source's own sentence for
  // why. Checked against isUserReadable before it is shown.
  std::string advice;
};

// What an export did. `message` is ALWAYS set and ALWAYS user-readable.
struct MachineProgramReport {
  bool ok = false;
  MachineProgramRefusal refusal = MachineProgramRefusal::None;
  std::string message;
  std::string dialect;
  std::size_t lines = 0;
  // How many bytes the program HELD when it was handed to the write, -1 when
  // nothing was written. Deliberately NOT re-read from the file: a gate that
  // compares this against what it reads back off the disk is then comparing two
  // independent things and can catch a short write. Reading the size back here
  // would make that comparison agree by construction.
  long long bytes = -1;
};

// ── the ONE place a sentence the user reads is written ──────────────────────
// `path` is quoted into the sentence when it says something; pass "" and the
// sentence still reads. Never returns empty.
std::string machineProgramMessage(MachineProgramRefusal refusal, const std::string& path);

// The sentence a SUCCESSFUL export shows. Same rules.
std::string machineProgramSuccessMessage(const std::string& dialect, std::size_t lines,
                                         const std::string& path);

// ── the seam ────────────────────────────────────────────────────────────────
// PURE, not a defaulted no-op, for the reason DocumentHost and FileExchange both
// give: a default that quietly answered "yes, here is an empty program" would
// let a build ship a File menu that writes a zero-byte file to a machine.
class MachineProgramSource {
 public:
  virtual ~MachineProgramSource() = default;

  // Is there a program to write at all?
  //
  // CHEAP BY CONTRACT, and that is not a style note. This is called from the
  // command's `enabled` predicate, which the frame builder evaluates for EVERY
  // command on EVERY frame to draw the menu, the ribbon and the palette. An
  // implementation that generated a toolpath here would put a CAM run inside the
  // menu. It must report what has already been computed and compute nothing.
  virtual bool hasMachineProgram() = 0;

  // The program itself. Returns false and fills `out.advice` when there is none.
  //
  // NOT const, deliberately: this one IS allowed to bring the plan up to date
  // before answering, so what reaches the disk is the operation the panels
  // currently show rather than whatever was cached when the tab was last drawn.
  // "The file I saved is not the program on screen" is the worst defect a Save
  // can have, and it is the one FileExchangeHost refuses a cached handle over.
  virtual bool machineProgram(MachineProgram& out) = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_MACHINEPROGRAM_HPP
