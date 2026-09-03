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

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/PartCommands.hpp"

namespace forge::desktop {

// The magic + version the writer emits and the reader requires.
inline constexpr const char* kPartFileMagic = "FORGE-PART";
inline constexpr int kPartFileVersion = 1;
inline constexpr const char* kPartFileExtension = ".fpart";

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
PartFileDoc capturePartDocument(const forge::ui::PartDocument& doc, const std::string& name);
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
