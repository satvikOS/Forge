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
//   * ADDITIVE ONLY. A version-3 key may not appear in a version-1 file: the
//     drawing blocks carry the version they were introduced in, so a hand-edited
//     hybrid is refused as the corruption it is rather than half-read.
inline constexpr const char* kPartFileMagic = "FORGE-PART";
inline constexpr int kPartFileVersion = 3;
inline constexpr int kOldestReadablePartFileVersion = 1;
// The version the DRAWING blocks were introduced in. A file older than this may
// not contain one.
inline constexpr int kPartFileDrawingVersion = 3;
inline constexpr const char* kPartFileExtension = ".fpart";

// Whether this build can read a file claiming `version`. The accepted set, not a
// range: see the note above about version 2.
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
  std::vector<PartFileFeature> features;
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

// ── document <-> file ───────────────────────────────────────────────────────
PartFileDoc capturePartDocument(const forge::ui::PartDocument& doc, const std::string& name,
                                const forge::ui::DrawingModel& drawing);
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
