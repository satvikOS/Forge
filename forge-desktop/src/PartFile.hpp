// forge-desktop/src/PartFile.hpp
//
// THE .fpart DOCUMENT — the format the application reads and writes.
//
// Before this file the app had no document persistence of ANY kind: grepping
// ofstream/ifstream/fopen across ui/src and forge-desktop/src found only the PNG
// screenshot writer and ~/.forge/shell_state.txt (workspace, dock layout,
// keymap). `file.open`'s whole execute body was `doc_.dirty = false;` — it never
// read the path argument. "Bracket.fpart" existed as a string literal used as a
// tree label and nothing else.
//
// ── what is stored, and why it is NOT the IR text ───────────────────────────
// A PartDocument is a list of FeatureRecords: an SSA feature-IR statement PLUS
// the UI metadata that makes it a document rather than a program — the tree
// label, the command that authored it, the IR value kind it produces, and the
// node id the typed selection binds it by.
//
// The obvious format is "write irProgram(), re-parse it on load". That is
// rejected for two measured reasons:
//
//   1. It is LOSSY. irProgram() carries none of the metadata above, so a
//      round-trip silently discards every label and every selection binding —
//      the document comes back as a program that happens to build.
//   2. It would need a SECOND IR parser, in the UI's vocabulary, alongside
//      forge::ft::parse. Two parsers for one grammar is the "same thing, two
//      code paths" failure the single-registry rule exists to prevent; the one
//      that drifts is always the one with fewer users.
//
// So the file stores the record STRUCTURALLY — one `ARG <kind> <value>` line per
// argument — and the IR program text is DERIVED from it by the same
// IrLine::text() the live document uses. There is exactly one representation of
// a statement in this system, and the file is not a copy of it.
//
// The format is line-oriented, versioned by its first line, and its writer and
// reader are proved to round-trip byte-for-byte by
// forge-desktop/test/document_gate.cpp.
#ifndef FORGE_DESKTOP_PARTFILE_HPP
#define FORGE_DESKTOP_PARTFILE_HPP

#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/Drawing.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::desktop {

// ── the version policy, and the number that is deliberately missing ─────────
//
// Version 1 was the feature tree and nothing else. Version 3 adds the DRAWING --
// the title block, the datums, the notes and the geometric tolerances -- as
// blocks alongside the FEATUREs.
//
// ★ WHY 3 AND NOT 2. `FORGE-PART` is written by TWO implementations in this
//   repository: this file, and ui/src/DocumentModel.cpp, which is a separate
//   document layer with its own vocabulary (UNITS, MATERIAL, PARAM, VIEW, NAMED,
//   SUPPRESSED) and which ALREADY MINTED VERSION 2 for it. Two different
//   dialects both calling themselves "FORGE-PART 2" would be a file that reads
//   as one format and means another, which is worse than either of them being
//   unreadable. ui/test/document_format_compat_test.cpp exists for that
//   collision and states it; this is the first change that had to act on it.
//
//   So the accepted set is {1, 3}, NOT the range 1..3, and a version 2 file is
//   refused BY NUMBER with a sentence saying whose it is. Accepting the header
//   and then dying on the first key would tell a user their file was corrupt
//   when it is merely somebody else's.
//
// The rest of the policy:
//   * a v1 file is upgraded in memory by taking an EMPTY drawing. Upgrading is
//     idempotent: writing an upgraded document and reading it back gives the
//     same document.
//   * a version this build does not know is refused, and the refusal names both
//     the file's number and what this build reads. Guessing at records it cannot
//     know corrupts a user's work.
//   * ADDITIVE ONLY. A key may not appear in a file older than the version that
//     introduced it: the drawing blocks carry theirs and so does INPUT-FILE, so
//     a hand-edited hybrid is refused as the corruption it is rather than
//     half-read.
//
// ★ WHY 4. Version 3 wrote `OP INPUT` and NOTHING ELSE for an imported body --
//   no path, no name, no bytes. MEASURED on this tree before the key below
//   existed: import a STEP, Save, reopen in a fresh process, and the document
//   comes back as the one statement `%1 = INPUT()` with nothing bound, so the
//   kernel answers "INPUT() used but no input STEP was supplied to the compiler"
//   and the user gets an EMPTY viewport from a Save that reported success. The
//   file has to carry the path or the most common CAD workflow there is --
//   import, save, come back tomorrow -- cannot survive a restart.
inline constexpr const char* kPartFileMagic = "FORGE-PART";
inline constexpr int kPartFileVersion = 4;
inline constexpr int kOldestReadablePartFileVersion = 1;
// The version the DRAWING blocks were introduced in. A file older than this may
// not contain one.
inline constexpr int kPartFileDrawingVersion = 3;
// The version INPUT-FILE was introduced in. A file older than this may not
// contain one, for the same additive-only reason the drawing blocks carry theirs.
inline constexpr int kPartFileInputVersion = 4;
inline constexpr const char* kPartFileExtension = ".fpart";

// Whether this build can read a file claiming `version`. The accepted SET, not a
// range: see the note above about version 2. 3 is listed because a .fpart the
// shipped app wrote yesterday claims it, and dropping it would make this build
// refuse its own documents.
bool partFileVersionIsReadable(int version) noexcept;

// One stored feature: the document record, plus the selection node its value is
// bound to at save time ("" when nothing names it — because a later op consumed
// it, or because it was never nameable).
struct PartFileFeature {
  forge::ui::FeatureRecord record;
  std::string node;
};

struct PartFileDoc {
  std::string name = "untitled";
  std::string units = "mm";
  // ── WHAT THE PART IS MADE OF ──────────────────────────────────────────────
  // Stored WHOLE -- id, name, density and appearance -- rather than as the id
  // alone. Material.hpp gives the reason and it is a data-loss argument, not a
  // style one: a file carrying only `aluminium-6061` would silently change
  // weight when the library table is edited, and would open with NO density at
  // all on a build whose table lacks that id, so a part that plainly states its
  // material would have no mass. The library is a picker; the file is the record.
  //
  // Written only when a material has been chosen, so every .fpart saved before
  // this existed still reads, and one saved by a document with no material is
  // byte-identical to what the previous writer produced.
  forge::ui::Material material = forge::ui::unassignedMaterial();
  std::vector<PartFileFeature> features;
  // ── WHERE AN IMPORTED BODY CAME FROM ──────────────────────────────────────
  // The file the document's `INPUT()` binds, and "" when nothing is bound.
  //
  // ★ ABSOLUTE, AND BYTE FOR BYTE. capturePartDocument puts it through
  //   absolutePartPath, because a path is only a name of a file while the
  //   working directory it was relative to is still the current one -- MEASURED:
  //   an import typed as `rel.step` recorded `INPUT-FILE rel.step`, and the same
  //   document opened from any other directory was refused as a file that had
  //   gone missing while it sat there the whole time. And writePartFile writes
  //   these bytes VERBATIM rather than through the free-text writer every other
  //   value uses: that writer maps control characters to spaces, so a source
  //   whose folder contained a TAB was recorded under a name no file has --
  //   MEASURED, and the reopen then said "Forge cannot read it any more" about
  //   a file that had never moved.
  //
  // It is NOT an IR argument. `INPUT()` has arity 0..0 in the kernel's op table
  // and reads Builder::inputStep, so the path is document state beside the
  // program, the same way the selection bindings and the tree labels are. That
  // is also why the fix belongs here: a .fpart is the only thing that survives
  // the process, and before this field it carried no trace of the file at all.
  std::string inputFile;
  // The 2-D documentation side: the title block, the datum letters, the notes
  // and the geometric tolerances. Introduced in format version 2; a version 1
  // file loads with this empty.
  forge::ui::DrawingModel drawing;
  // The version the data was READ from, so a caller can tell a v1 document from
  // a v2 one. The writer always emits kPartFileVersion.
  int version = kPartFileVersion;

  // The feature-IR program these records spell, newline-joined — derived, never
  // stored, so it cannot disagree with the records.
  std::string irProgram() const;
};

// ── the format ──────────────────────────────────────────────────────────────
std::string writePartFile(const PartFileDoc& doc);
// Returns false and fills `error` with a line-numbered reason. `out` is only
// written on success: a rejected file never half-replaces a document.
bool readPartFile(const std::string& text, PartFileDoc& out, std::string& error);

// Does this document's program NEED an input file -- does it contain an
// `INPUT()` statement? ONE function, because two callers need the same answer
// and a second copy of the rule is how the writer and the reader come to
// disagree.
//
// ★ WHAT THIS IS NOT. It is not the answer to "was this document bound to a
//   file", and it was used as that answer once: capturePartDocument recorded
//   whatever path the session happened to be holding whenever the program
//   contained INPUT(). MEASURED -- import a part, File > New, state an imported
//   solid in the fresh document, Save, and the .fpart named the file the FIRST
//   part came from. The document's binding is now kept as a fact with a
//   lifetime (ForgeFrame::bindInputFile clears it whenever the document is
//   emptied or replaced), and this predicate answers only the question it is
//   right for: an open asks it whether an unreachable source file matters at
//   all, and a save asks it whether a path would describe anything in the file.
bool partFileBindsInput(const PartFileDoc& doc) noexcept;

// ── a path that still names the file tomorrow ───────────────────────────────
// Returns `path` unchanged when it is already absolute (or empty), and
// otherwise PREPENDS the current working directory -- which is the directory the
// relative path was typed in, and the only one it means.
//
// ★ WHAT IT DOES NOT DO, AND WHAT IT CANNOT AVOID. It never rewrites `path`
//   itself: no realpath, no "..", no symlink resolution, so the NAME the user
//   typed comes through intact. The BASE is another matter and this comment
//   used to claim otherwise. std::filesystem::current_path() is getcwd(), and
//   getcwd() is resolved by the kernel -- so a relative import made in
//   /var/folders/... is recorded under /private/var/folders/..., which is
//   exactly the rewrite the old comment cited as the thing this function avoids.
//   MEASURED on this tree.
//
//   It is left that way ON PURPOSE. The resolved base is the more DURABLE of
//   the two: it goes on naming the file after a symlink in the user's path is
//   removed or re-pointed, and a recorded path is read back tomorrow, not now.
//   The price is real and is paid in words, not in geometry -- a refusal can
//   quote a prefix the user did not type -- and it is the price this function
//   pays rather than the other one. There is no portable way to ask for the
//   unresolved cwd: $PWD is the shell's belief, and the app is usually launched
//   with no shell at all.
std::string absolutePartPath(const std::string& path);

// ── document <-> file ───────────────────────────────────────────────────────
// `inputFile` is the file BOUND TO THIS DOCUMENT -- KernelScene's, which is what
// the compiler is handed, and which ForgeFrame clears whenever the document is
// emptied or replaced. It is a REQUIRED argument and not a defaulted one on
// purpose: the defect this parameter exists for is a caller that never thought
// about the input file, and a default would let the next one make the same
// omission silently.
//
// It is stored ABSOLUTE (absolutePartPath) and only when the program actually
// contains an INPUT() statement, so a .fpart never names a file none of its
// features read. The staleness guard is the BINDING's lifetime, not this
// predicate -- see the note on partFileBindsInput for what that distinction
// cost when it was the other way round.
PartFileDoc capturePartDocument(const forge::ui::PartDocument& doc, const std::string& name,
                                const forge::ui::DrawingModel& drawing,
                                const std::string& inputFile);
// Appends every stored record into `doc` through its ONE mutation entry point
// (PartDocument::appendFeature), so a file that would build an illegal document
// is refused by the same validator a live command is refused by.
bool restorePartDocument(const PartFileDoc& file, forge::ui::PartDocument& doc,
                         std::string& error);

// ── disk ────────────────────────────────────────────────────────────────────
bool savePartFile(const std::string& path, const PartFileDoc& doc, std::string& error);
bool loadPartFile(const std::string& path, PartFileDoc& out, std::string& error);

// ── the part a fresh document starts on ─────────────────────────────────────
//
// ONE table, read by BOTH the document seed (ForgeFrame::wirePartCommands) and
// the scene's default build (KernelScene::build). Two hand-written copies of a
// starting part is how the app ended up rendering a body that no document
// described: the C++-hardcoded KernelScene part and the `%1 = BOX(80, 50, 20)`
// PartDocument seed were different objects that never met.
//
// It is a CONNECTED chain on purpose. forge::ft::compile runs an s0.4
// graph-quality gate that fails the whole program when any op "contributes
// nothing to the result" — MEASURED here: seeding an unconsumed `%1 = RECT(80,
// 50)` alongside a BOX chain returns
//   "unexplained_orphans=1 [%1] ... The required value for each is ZERO".
// So the sketch is EXTRUDEd rather than left dangling, and only the final solid
// is bound to a selection node.
struct SeedStatement {
  forge::ui::IrLine line;
  forge::ui::IrValueKind produces = forge::ui::IrValueKind::Solid;
  std::string node;    // "" = this value is not addressable by the selection
  std::string label;   // feature-tree row
  std::string detail;  // properties/timeline row
};

const std::vector<SeedStatement>& defaultPartStatements();
std::string defaultPartIr();
// The node id the default part's finished solid is bound to — what a solid
// command's selection resolves against.
const char* defaultPartBodyNode();

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_PARTFILE_HPP
