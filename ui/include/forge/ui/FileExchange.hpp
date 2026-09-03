// ui/include/forge/ui/FileExchange.hpp
//
// FILE EXCHANGE — opening and saving REAL CAD FILES.
//
// ── the gap this closes, measured ───────────────────────────────────────────
// Before this file existed:
//     grep -rnE 'importStep|exportStep|\.stp|ISO-10303' ui/src forge-desktop/src
// printed ONE COMMENT LINE and ZERO CALL SITES, and none of the 80 commands in
// APP_SURFACE_MANIFEST.tsv touched STEP. Meanwhile forge::io::importStep and
// forge::io::exportStep were implemented, linked and green (forge_step_probe,
// 21/21). The capability existed in the kernel and NOTHING IN THE APP COULD
// REACH IT — so the one thing every reference CAD session begins and ends with,
// opening and saving a file, was the single largest hole in the product.
//
// ── why the seam is here and not in the command ─────────────────────────────
// Nothing under ui/ may include a kernel or OCCT header: `bash ui/test/run_ui.sh`
// compiles this whole layer with `-I ui/include -I ui/test` and NOTHING ELSE,
// which is what keeps the command registry testable headless. So the commands
// live in ForgeShell (one registry, as s19.2 requires) and the geometry lives
// behind this pure interface, implemented by forge-desktop, where OCCT is.
//
// ── ★ THE PROSE RULE, MADE MECHANICAL ───────────────────────────────────────
// The kernel's refusals are DELIBERATE and they are worded for us, not for the
// user. Measured, verbatim, from forge-kernel/src/IoExchange.cpp:
//
//   "forge.io: IGES export is not available in this build. No IGES writer is
//    linked (OCCT TKDEIGES is read-only; the native kernel ships an analytic
//    STEP writer, not an IGES 5.3 writer)…"
//
// A user must never see that sentence. Neither may they see a C++ exception type
// name, a `forge::io::` qualified name, or an OCCT toolkit code. (Spelling the
// exception class out here would trip ui/test/check_includes_ui.sh, which reads
// this file as text and would then demand an include the header does not use --
// so the class is named in ui/src/ForgeShell.cpp's leak stop instead, where the
// translation actually happens.) Every sentence this
// layer can show is therefore written HERE, in one function, and `isUserReadable`
// below is the mechanical predicate a gate applies to every one of them: no `::`,
// no snake_case, no interior-capital identifier (TopoDS, ShapeHandle, runtimeError
// are all caught; STEP, IGES, BREP, STL and Forge are not). A file PATH is exempt
// because it is the user's own text, and it is exempt only inside double quotes,
// which is where every message puts it.
#ifndef FORGE_UI_FILEEXCHANGE_HPP
#define FORGE_UI_FILEEXCHANGE_HPP

#include <cstddef>
#include <cstdint>
#include <iterator>
#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace forge::ui {

// The formats the app names. This is NOT the list of formats the kernel has a
// function for — forge::io also declares importJt and importParasolid, which are
// honest stubs that THROW because they need proprietary Siemens kits Forge does
// not vendor. A format with no working implementation is not a format the app
// offers; canImport/canExport below say which direction each one really works in.
//
// APPENDED, never inserted (same rule as IrValueKind): every use is an equality
// test or a name lookup, and the static_assert below is what makes a format added
// to the enum a COMPILE ERROR here rather than a menu entry nothing can serve.
enum class ExchangeFormat : std::uint8_t { Step, Brep, Stl, Iges };

inline constexpr ExchangeFormat kAllExchangeFormats[] = {
    ExchangeFormat::Step,
    ExchangeFormat::Brep,
    ExchangeFormat::Stl,
    ExchangeFormat::Iges,
};
static_assert(std::size(kAllExchangeFormats) ==
                  static_cast<std::size_t>(ExchangeFormat::Iges) + 1,
              "kAllExchangeFormats must list EVERY ExchangeFormat: it is what the "
              "message gate and the capability table both walk.");

// The stable machine spelling ("step"), used in command ids and in the manifest.
const char* toString(ExchangeFormat format) noexcept;
// What a USER calls it ("STEP"). Safe to put in a sentence: see isUserReadable.
const char* formatName(ExchangeFormat format) noexcept;
// The file extensions a user may reasonably type, canonical one FIRST, each with
// its leading dot and lower-case.
const std::vector<std::string>& formatExtensions(ExchangeFormat format);
// The format `path`'s extension names, if any. Case-insensitive.
bool formatFromPath(std::string_view path, ExchangeFormat& out) noexcept;

// ── WHAT THE KERNEL ACTUALLY DOES, NOT WHAT IT DECLARES ─────────────────────
// forge/IoExchange.hpp declares exportIges(); its body is an HONEST DEFERRAL that
// refuses, because OCCT 7.9's TKDEIGES ships a reader and no writer and the native
// kernel has no from-scratch IGES 5.3 writer. Registering an "Export IGES" command
// would put a capability in APP_SURFACE_MANIFEST.tsv that can never succeed, which
// is a lie told to the user AND to Archie (which is trained from that surface). So
// canExport(Iges) is FALSE, no such command is registered, and the refusal is
// surfaced where a user can actually reach it: by typing an .igs path into Save.
bool canImport(ExchangeFormat format) noexcept;
bool canExport(ExchangeFormat format) noexcept;

// Why an exchange did not happen. A CLOSED set, because every value here has to
// have a sentence written for it and a gate that walks the whole cross product.
enum class ExchangeRefusal : std::uint8_t {
  None = 0,
  NoPath,            // the command was invoked with an empty path
  NoExchange,        // no file-exchange implementation is installed in this build
  NoDocument,        // nothing is open, so there is nothing to save
  CannotWrite,       // Forge cannot WRITE that format (IGES)
  CannotRead,        // Forge cannot READ that format (JT, Parasolid, anything else)
  FileMissing,       // the path does not name a readable file
  WrongContents,     // the file is not the format the command was asked for
  NoSolid,           // the file was read but held no solid body
  BuildFailed,       // the document did not compile, so there is nothing to write
  WriteFailed,       // the kernel could not write the file
  // APPENDED, never inserted. The file was read and bound, and then the command
  // that states an imported body in feature-IR would not run -- so the user has
  // a bound file and an unchanged part, which is a different fact from any
  // failure above and must not be reported as one of them.
  NotPlaced,
  // The file is the right format and is INCOMPLETE -- it stops before its own
  // end marker. Its own refusal because the remedy is different from every other
  // one here: get a whole copy of the file. And because handing an incomplete
  // one to the reader is not merely useless: MEASURED, a BREP file truncated to
  // half its length SEGFAULTS the reader, taking the application with it.
  Truncated,
};

inline constexpr ExchangeRefusal kAllExchangeRefusals[] = {
    ExchangeRefusal::None,         ExchangeRefusal::NoPath,
    ExchangeRefusal::NoExchange,   ExchangeRefusal::NoDocument,
    ExchangeRefusal::CannotWrite,  ExchangeRefusal::CannotRead,
    ExchangeRefusal::FileMissing,  ExchangeRefusal::WrongContents,
    ExchangeRefusal::NoSolid,      ExchangeRefusal::BuildFailed,
    ExchangeRefusal::WriteFailed,  ExchangeRefusal::NotPlaced,
    ExchangeRefusal::Truncated,
};
static_assert(std::size(kAllExchangeRefusals) ==
                  static_cast<std::size_t>(ExchangeRefusal::Truncated) + 1,
              "kAllExchangeRefusals must list EVERY ExchangeRefusal: the prose gate "
              "walks it, and a value missing from it is a sentence nobody checked.");

const char* toString(ExchangeRefusal refusal) noexcept;

// ── the ONE place a sentence the user reads is written ──────────────────────
// `path` is quoted into the sentence when it says something; pass "" and the
// sentence still reads. Never returns empty, and never returns a kernel string.
std::string exchangeMessage(ExchangeRefusal refusal, ExchangeFormat format,
                            const std::string& path);

// The sentence a SUCCESSFUL exchange shows. Same rules.
std::string exchangeSuccessMessage(bool imported, ExchangeFormat format,
                                   const std::string& path);

// ── the prose rule as a predicate ───────────────────────────────────────────
// True when `sentence` contains nothing a user would recognise as source code.
// Spans inside double quotes are SKIPPED: a file path is the user's own text and
// `/Users/a_b/part_v2.step` must not be mistaken for an identifier.
//
// Rejects: "::" anywhere; a word containing '_'; a word with an interior capital
// preceded by a lower-case letter (TopoDS, ShapeHandle, runtimeError, MoltenVK);
// a word ending in "()" ; and the literal substrings "std", "OCCT", "TKDE" and
// "forge." as free-standing words. Accepts STEP, IGES, BREP, STL, AP242, Forge.
bool isUserReadable(std::string_view sentence);

// ── the VECTOR of observables ───────────────────────────────────────────────
// Never volume alone. This programme has measured four separate cases where a
// wrong solid reproduced the right volume, and one (a native quadric offset)
// where NO SINGLE observable caught it — the centre of mass was clean on the
// sphere and the bounding box was clean on the cylinder. So a caller that wants
// to know whether a round trip preserved the geometry gets volume AND bounding
// box AND centre of mass AND the per-kind face census, and is expected to check
// all four.
struct ExchangeReport {
  bool ok = false;
  ExchangeRefusal refusal = ExchangeRefusal::None;
  std::string message;   // ALWAYS set, ALWAYS user-readable, success or refusal

  double volume = 0.0;
  double area = 0.0;
  double centreOfMass[3] = {0.0, 0.0, 0.0};
  double bboxMin[3] = {0.0, 0.0, 0.0};
  double bboxMax[3] = {0.0, 0.0, 0.0};
  long faceCount = -1;
  long edgeCount = -1;
  // kind -> how many faces carry it. forge::FaceInfo::kind spelling:
  // plane|cylinder|cone|sphere|torus|bspline|bezier|revolution|other.
  std::map<std::string, int> faceKinds;
  long long bytes = -1;  // the file's size on disk, -1 when unknown
};

// ── the seam ────────────────────────────────────────────────────────────────
// PURE, not a defaulted no-op, for the reason DocumentHost gives: a default that
// quietly answered "yes" would let a build ship a File menu that writes nothing.
// An implementation may not throw: every kernel exception has to be turned into
// an ExchangeRefusal and a sentence before it crosses this line, which is the
// whole point of the interface.
class FileExchange {
 public:
  virtual ~FileExchange() = default;

  // Read `path` and bind it as the document's input body. Returns `report.ok`.
  // The IMPLEMENTATION performs the read for real: it is not permitted to
  // answer true without having produced a solid from the file.
  virtual bool importFile(const std::string& path, ExchangeFormat format,
                          ExchangeReport& report) = 0;

  // Compile the open document and write it to `path` in `format`.
  virtual bool exportFile(const std::string& path, ExchangeFormat format,
                          ExchangeReport& report) = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_FILEEXCHANGE_HPP
