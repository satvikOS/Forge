// ui/include/forge/ui/DocumentModel.hpp
//
// THE DOCUMENT — the thing an application saves. An app that cannot save is a
// demo, and until this file existed the only persistent state Forge had was a
// list of feature-IR statements: no units, no material, no view, no parameters,
// no names, and a feature tree that could only be appended to.
//
// ── what a document IS here ─────────────────────────────────────────────────
//   * the FEATURE TREE          — a forge::ui::PartDocument of feature-IR
//                                 statements (the sketches are in it: a sketch
//                                 is a RECT/CIRCLE/RING statement)
//   * UNITS                     — the storage unit (always millimetres, stated
//                                 rather than assumed) and the display units
//   * a MATERIAL                — density, so mass properties are real, plus the
//                                 appearance the viewport shades with
//   * PARAMETERS                — named, unit-aware values the user typed
//   * NAMED ENTITIES            — user labels bound to stable topology refs
//   * VIEW STATE                — where the camera was
//
// and ONE undo stack over all of it.
//
// ── ONE undo stack, and how metadata got onto it ────────────────────────────
// PartCommands.hpp already owns the GoF Command/Memento machinery: `UndoableEdit`
// (the ConcreteCommand) and `UndoStack` (the Caretaker). A second stack for
// "document" edits would be the classic two-code-paths defect — Ctrl+Z would
// mean different things depending on what you last touched, and the two stacks
// could interleave into an order neither of them knows.
//
// So there is no second stack. Every edit this file adds is an `UndoableEdit`
// that IGNORES the `PartDocument&` it is handed and mutates the DocumentModel it
// captured instead. The signature is unchanged, PartCommands.cpp is untouched,
// and a units change, a material change, a tree reorder and a fillet all sit in
// ONE stack in the order they happened.
//
// The camera is the ONE deliberate exception: `setView` is not undoable. Ctrl+Z
// after orbiting must undo the last MODEL edit — that is what it does in every
// CAD system, because a view stack that swallows undo steps is how users lose
// work. The view is still SAVED; it is just not an edit.
//
// ── the file format and its version policy ──────────────────────────────────
// Line-oriented, `KEY rest-of-line`, blocks terminated by `END`, first line
// `FORGE-PART <version>`. The full policy is stated at kDocumentFormatVersion
// below and ENFORCED by a per-key version table, so "a v1 file may not contain a
// v2 key" is a rule the reader applies rather than a paragraph nobody runs.
//
// The file stores each statement STRUCTURALLY (one `ARG <kind> <value>` line per
// argument) and DERIVES the IR text from it with the same IrLine::text() the live
// document uses. There is exactly one representation of a statement in this
// system and the file is not a second copy of it, so a document cannot come back
// as a program that merely happens to build.
#ifndef FORGE_UI_DOCUMENTMODEL_HPP
#define FORGE_UI_DOCUMENTMODEL_HPP

#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/Material.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/Units.hpp"

namespace forge::ui {

// ── format identity ─────────────────────────────────────────────────────────
inline constexpr const char* kDocumentMagic = "FORGE-PART";
inline constexpr const char* kDocumentExtension = ".fpart";

// THE VERSION POLICY. A format with no version field is a format you can never
// change; a format with a version and no POLICY is one you can only change once.
//
//   1. Every file begins `FORGE-PART <n>` with n a positive decimal integer.
//      This build WRITES kDocumentFormatVersion and nothing else.
//   2. READING is a RANGE: every version from kOldestReadableDocumentVersion up
//      to kDocumentFormatVersion is accepted. Older files are UPGRADED IN MEMORY
//      on load — fields the older version could not express take the documented
//      defaults in documentFormatHistory() — and are written back at the current
//      version. Upgrading is idempotent: writing an upgraded document and reading
//      it back yields the same document.
//   3. A version ABOVE kDocumentFormatVersion is REFUSED, and the refusal names
//      both numbers ("file is version 3; this build reads up to 2"). This is the
//      one place refusal is right: the bytes may carry records whose meaning this
//      build cannot know, and guessing corrupts a user's work. It is also the
//      only actionable answer — the fix is a newer build, and the message says so.
//   4. Within a known version, an UNKNOWN KEY is refused with its line number.
//      That is what makes rule 5 enforceable.
//   5. ADDITIVE ONLY. A new version may add keys and blocks; it may never change
//      what an existing key means. Every key carries the version it was
//      introduced in (and, if it was retired, the last version that accepts it),
//      so a v1 file containing a v2 key is refused as the corruption it is, and a
//      v2 file may still contain v1's retired spellings only if the table says so.
//   6. Anything that changes what a key means, or removes one, requires a new
//      version number AND a row in documentFormatHistory().
inline constexpr int kDocumentFormatVersion = 2;
inline constexpr int kOldestReadableDocumentVersion = 1;

struct FormatVersionNote {
  int version;
  const char* summary;
};
// One row per version, oldest first. The upgrade rules a reader applies are
// stated here in the same place a human reads them.
const std::vector<FormatVersionNote>& documentFormatHistory();

// ── value types ─────────────────────────────────────────────────────────────
struct Vec3 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};
bool operator==(const Vec3& a, const Vec3& b) noexcept;
bool operator!=(const Vec3& a, const Vec3& b) noexcept;

struct DocumentUnits {
  // What the user SEES. Presentation only; nothing is stored in these.
  LengthUnit displayLength = LengthUnit::Millimetre;
  AngleUnit displayAngle = AngleUnit::Degree;
  MassUnit displayMass = MassUnit::Gram;
  // What every stored length in the file IS. This writer only ever emits
  // kInternalLengthUnit, but the field is written explicitly so that a reader
  // facing a file from a build that changed its mind CONVERTS rather than
  // silently mis-scaling a part by 25.4.
  LengthUnit storageLength = kInternalLengthUnit;
};
bool operator==(const DocumentUnits& a, const DocumentUnits& b) noexcept;
bool operator!=(const DocumentUnits& a, const DocumentUnits& b) noexcept;

struct ViewState {
  Vec3 eye{140.0, -180.0, 120.0};
  Vec3 target{0.0, 0.0, 10.0};
  Vec3 up{0.0, 0.0, 1.0};
  double fieldOfViewDegrees = 45.0;
  double zoom = 1.0;
  bool orthographic = false;
  bool wireframe = false;
  bool showGrid = true;
};
bool operator==(const ViewState& a, const ViewState& b) noexcept;
bool operator!=(const ViewState& a, const ViewState& b) noexcept;

// A named user parameter. `expression` is what the user TYPED ("1/2 in"), kept
// beside the millimetre value so reopening the document shows their own words
// rather than this program's rounding of them.
struct DocumentParameter {
  std::string name;
  double millimetres = 0.0;
  std::string expression;
  std::string comment;
};
bool operator==(const DocumentParameter& a, const DocumentParameter& b) noexcept;

// A user label bound to a STABLE topology reference (Types.hpp): "largest bore"
// survives a rebuild that repermutes the B-rep, which is exactly when a name is
// worth having.
struct NamedEntity {
  std::string name;
  EntityRef ref;
};
bool operator==(const NamedEntity& a, const NamedEntity& b) noexcept;

// One stored statement: the document record, the selection node its value is
// bound to at save time ("" when nothing names it), and whether it is suppressed.
struct DocumentFeature {
  FeatureRecord record;
  std::string node;
  bool suppressed = false;
};

// The whole serialisable payload. `version` is the version the data was READ
// from; the writer always emits kDocumentFormatVersion.
struct DocumentFileData {
  int version = kDocumentFormatVersion;
  std::string name = "untitled";
  DocumentUnits units{};
  Material material{};
  ViewState view{};
  std::vector<DocumentParameter> parameters;
  std::vector<NamedEntity> names;
  std::vector<DocumentFeature> features;

  // The feature-IR program these records spell, newline-joined — DERIVED, never
  // stored, so it cannot disagree with the records.
  std::string irProgram() const;
};

// ── reading and writing the text ────────────────────────────────────────────
struct DocumentWriteOptions {
  // The view is part of the document but NOT part of its content identity:
  // orbiting the camera must not mark a part dirty. `dirty()` compares the
  // document against its last saved state through THIS writer with the view
  // omitted, so there is one serialiser and no second description of the format
  // to drift.
  bool includeView = true;
};

std::string writeDocumentFile(const DocumentFileData& data,
                              const DocumentWriteOptions& options = {});

struct DocumentIoError {
  std::string message;    // always names the reason; empty means success
  std::size_t line = 0;   // 1-based; 0 when the fault is the file as a whole
  int fileVersion = 0;    // the version the file claimed, when it claimed one
  bool ok() const noexcept { return message.empty(); }
  std::string describe() const;  // "line 12: unknown key 'FOO'"
};

// `out` is written ONLY on success: a rejected file never half-replaces a
// document.
bool readDocumentFile(const std::string& text, DocumentFileData& out, DocumentIoError& error);

// ── feature-tree structural edits ───────────────────────────────────────────
enum class TreeEditStatus : std::uint8_t {
  Ok = 0,
  NoSuchFeature,        // no statement carries that id
  DependencyViolation,  // the move would put a statement before an operand
  StillReferenced,      // the delete would strand a consumer (use Cascade)
  NoChange,             // the request is already true; nothing is pushed on undo
  Refused,              // the rebuilt program failed the document's own validator
};
const char* toString(TreeEditStatus status) noexcept;

enum class DeletePolicy : std::uint8_t {
  // Refuse when a live statement consumes the victim, and NAME the consumer.
  RefuseIfReferenced,
  // Take the victim and everything transitively built on it. The set is
  // reported by lastCascade() so the caller can tell the user what went.
  Cascade,
};

// ── the model ───────────────────────────────────────────────────────────────
class DocumentModel {
 public:
  DocumentModel();

  // The receiver the Part commands mutate. registerPartCommands(registry,
  // model.tree(), model.undo()) wires the product commands to THIS document.
  PartDocument& tree() noexcept { return tree_; }
  const PartDocument& tree() const noexcept { return tree_; }
  UndoStack& undo() noexcept { return undo_; }
  const UndoStack& undo() const noexcept { return undo_; }

  // ── identity, units, material, view ─────────────────────────────────────
  const std::string& name() const noexcept { return name_; }
  bool setName(std::string value);  // undoable

  const DocumentUnits& units() const noexcept { return units_; }
  bool setUnits(const DocumentUnits& value);          // undoable
  bool setDisplayLengthUnit(LengthUnit unit);         // undoable
  bool setDisplayAngleUnit(AngleUnit unit);           // undoable
  bool setDisplayMassUnit(MassUnit unit);             // undoable

  const Material& material() const noexcept { return material_; }
  bool setMaterial(const Material& value);            // undoable
  // Looks the id up in materialLibrary(). Returns false, changing nothing, when
  // the id is unknown — a picker must not be able to blank a document's density.
  bool setMaterialById(const std::string& id);        // undoable

  // NOT undoable, on purpose — see the header comment.
  const ViewState& view() const noexcept { return view_; }
  void setView(const ViewState& value);

  // ── unit-aware entry, in the document's own units ───────────────────────
  QuantityParse parseLengthEntry(const std::string& text) const;
  std::string formatLengthForDisplay(double millimetres, int decimals = 4) const;
  MassProperties massProperties(double volumeMm3) const;

  // ── parameters ──────────────────────────────────────────────────────────
  const std::vector<DocumentParameter>& parameters() const noexcept { return parameters_; }
  const DocumentParameter* parameter(const std::string& name) const;
  // Parses `expression` through the document's display unit and stores BOTH the
  // millimetre value and the text. Returns false with `error` naming the
  // offending token when the expression cannot be read.
  bool setParameter(const std::string& name, const std::string& expression, std::string& error);
  bool removeParameter(const std::string& name);      // undoable

  // ── named entities ──────────────────────────────────────────────────────
  const std::vector<NamedEntity>& namedEntities() const noexcept { return names_; }
  const EntityRef* entityNamed(const std::string& name) const;
  bool nameEntity(const std::string& name, const EntityRef& ref);  // undoable
  bool removeName(const std::string& name);                        // undoable

  // ── feature-tree structure ──────────────────────────────────────────────
  bool suppressed(int irId) const noexcept;
  // Suppression is DEPENDENCY-CLOSED, because the alternative is a program that
  // references a statement that is not there. Suppressing cascades DOWN to every
  // consumer; unsuppressing cascades UP to every operand. What else moved is in
  // lastCascade().
  TreeEditStatus setSuppressed(int irId, bool value);
  TreeEditStatus renameFeature(int irId, const std::string& label);
  // `toPosition` is 0-based over the whole statement list.
  TreeEditStatus reorderFeature(int irId, std::size_t toPosition);
  TreeEditStatus deleteFeature(int irId, DeletePolicy policy);

  // Why the last structural edit refused, naming the statement AND the operand
  // that made it impossible — so a repair loop can act instead of guessing.
  const std::string& lastTreeError() const noexcept { return treeError_; }
  const std::vector<int>& lastCascade() const noexcept { return cascade_; }

  // ── programs ────────────────────────────────────────────────────────────
  // Every statement, including suppressed ones: the document as authored.
  std::string irProgram() const;
  // What the kernel is asked to build: suppressed statements elided and the
  // survivors renumbered, so `%N` still means the Nth statement of THIS program.
  std::string buildProgram() const;

  // ── dirty ───────────────────────────────────────────────────────────────
  // DERIVED, never accumulated: the document is dirty when its serialisation
  // differs from the one that was last saved. A flag that some mutation path
  // forgets to set is how "saved" comes to mean nothing, and there is no path
  // here that can forget.
  bool dirty() const;
  void markSaved();
  // The bytes `dirty()` compares — the document minus the view.
  std::string contentDigest() const;

  // ── whole-document moves ────────────────────────────────────────────────
  DocumentFileData capture() const;
  // Replaces everything and CLEARS the undo stack: opening a file is not an
  // edit, and offering to undo past an Open into the previous document's history
  // is how a modeller loses a part.
  bool restore(const DocumentFileData& data, std::string& error);
  void reset();  // a new, empty document
  std::string serialize() const { return writeDocumentFile(capture()); }
  bool load(const std::string& text, DocumentIoError& error);

 private:
  friend class DocumentMetadataEdit;
  friend class DocumentTreeEdit;

  // Everything an undoable metadata edit has to put back. Small: no geometry.
  struct MetaState {
    std::string name;
    DocumentUnits units;
    Material material;
    std::vector<DocumentParameter> parameters;
    std::vector<NamedEntity> names;
  };
  // Everything an undoable STRUCTURAL edit has to put back.
  struct TreeState {
    std::vector<FeatureRecord> records;
    std::map<std::string, int> bindings;
    std::vector<int> suppressed;
  };

  MetaState captureMeta() const;
  void installMeta(const MetaState& state);
  TreeState captureTree() const;
  // Rebuilds the PartDocument through its ONE mutation entry point
  // (appendFeature), so a state that would not be a legal document is refused by
  // the same validator a live command is refused by.
  bool installTree(const TreeState& state, std::string& error);

  // Applies `next` as an undoable step when it differs from the current state.
  bool commitMeta(const MetaState& next);
  bool commitTree(const TreeState& next);

  // Renumbers `ordered` (old ids, desired order) into a consistent SSA program.
  // Fails, naming both statements, when a reference would point forward.
  bool renumber(const std::vector<FeatureRecord>& ordered,
                const std::map<std::string, int>& bindings,
                const std::vector<int>& suppressed, TreeState& out, std::string& error) const;

  std::vector<int> consumersOf(int irId) const;   // statements that reference it
  std::vector<int> operandsOf(int irId) const;    // statements it references

  PartDocument tree_;
  UndoStack undo_;
  std::string name_ = "untitled";
  DocumentUnits units_{};
  Material material_{};
  ViewState view_{};
  std::vector<DocumentParameter> parameters_;
  std::vector<NamedEntity> names_;
  std::vector<int> suppressed_;
  std::string savedDigest_;
  std::string treeError_;
  std::vector<int> cascade_;
};

// ── document <-> file ───────────────────────────────────────────────────────
DocumentFileData captureDocument(const DocumentModel& model);
bool restoreDocument(const DocumentFileData& data, DocumentModel& model, std::string& error);

}  // namespace forge::ui

#endif  // FORGE_UI_DOCUMENTMODEL_HPP
