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
#include <exception>
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
  // The edit was requested DURING A WALK over the document (a feature-tree
  // panel iterating records() while drawing its rows) and has been RECORDED to
  // run the moment the walk closes. It is not a refusal and not an error: the
  // edit WILL happen, in the order it was asked for. See DocumentWalk below.
  Deferred,
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
  // ── THE WALK, and why a structural edit may not run inside one ──────────
  //
  // MID-WALK CONTAINER MUTATION HAS SHIPPED THREE CRASHES IN THIS APPLICATION
  // (D-026). The dock tree grew a walk guard for exactly that, but the document
  // is the OTHER container a frame walks, and it had none: a feature-tree panel
  // draws its rows by iterating `tree().records()`, and every structural edit
  // below REBUILDS that vector -- deleteFeature and reorderFeature RENUMBER the
  // whole program through installTree(), so every reference, iterator and index
  // the panel is holding is dangling the instant a row's delete button is
  // clicked. That is the same defect, one container over, and it is reachable
  // from a button a user will press.
  //
  // The fix is the one the dock tree uses, and it is NOT a refusal: while a walk
  // is open, a structural edit is RECORDED and returns TreeEditStatus::Deferred,
  // and the queue is applied the moment the walk closes. The edit still happens,
  // in the order it was asked for, and the caller is told which of the two
  // occurred. Refusing would be the wrong answer -- an app that drops a user's
  // click because it was drawing at the time is broken in a quieter way.
  //
  // Nesting is a DEPTH: an inner walk closing does not apply the queue, only the
  // outermost one does. Prefer the DocumentWalk RAII guard below to these two,
  // so an early return or a throw out of a panel body cannot leave the depth
  // stuck above zero -- which would silently defer every later edit for ever.
  void beginWalk() noexcept;
  // Applies the queue when this closes the outermost walk. Returns how many
  // deferred edits ran.
  std::size_t endWalk();
  bool walking() const noexcept { return walkDepth_ > 0; }
  std::size_t walkDepth() const noexcept { return walkDepth_; }
  std::size_t pendingEdits() const noexcept { return pending_.size(); }
  // LIFETIME total, never reset: a gate asserts on it, and a counter that a
  // frame boundary clears cannot tell you a walk was violated three frames ago.
  std::size_t deferredEditCount() const noexcept { return deferredTotal_; }
  // Runs the queue now. Does nothing while a walk is open. Returns how many ran.
  std::size_t applyPendingEdits();
  // What the deferred edits did when they ran: one entry per edit that did NOT
  // return Ok, naming the statement and the reason. A deferred delete can still
  // be refused for a real reason (it strands a consumer), and the caller is no
  // longer on the stack to be told, so it is recorded here instead of dropped.
  const std::vector<std::string>& pendingEditErrors() const noexcept { return pendingErrors_; }
  // Records that closing a walk threw. Called only from ~DocumentWalk, which
  // must not let an exception escape; noexcept, and it swallows a failure to
  // record rather than throwing out of a destructor a second time.
  void noteWalkFailure(const char* what) noexcept;

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

  // One recorded structural intent. Deliberately a VALUE, holding no reference
  // and no iterator into the document: the whole point is that it stays valid
  // across the rebuild that invalidates everything else.
  struct PendingTreeEdit {
    enum class Kind : std::uint8_t { Suppress, Rename, Reorder, Delete };
    Kind kind = Kind::Suppress;
    int irId = 0;
    bool flag = false;                                       // Suppress
    std::string label;                                       // Rename
    std::size_t position = 0;                                // Reorder
    DeletePolicy policy = DeletePolicy::RefuseIfReferenced;  // Delete
  };

  // The bodies that actually mutate. The public methods above are the walk-aware
  // wrappers; these are what runs once it is safe to rebuild the tree.
  TreeEditStatus setSuppressedNow(int irId, bool value);
  TreeEditStatus renameFeatureNow(int irId, const std::string& label);
  TreeEditStatus reorderFeatureNow(int irId, std::size_t toPosition);
  TreeEditStatus deleteFeatureNow(int irId, DeletePolicy policy);
  // Records an intent and returns Deferred. Never mutates the document.
  TreeEditStatus defer(const PendingTreeEdit& edit);

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
  std::size_t walkDepth_ = 0;
  std::size_t deferredTotal_ = 0;
  std::vector<PendingTreeEdit> pending_;
  std::vector<std::string> pendingErrors_;
};

// ── the walk guard ──────────────────────────────────────────────────────────
// RAII, and balanced by a scope guard rather than by a matching call for the
// same reason ForgeFrame's dock walk is: an early return or a throw out of a
// panel body would otherwise leave the depth above zero for ever, and every
// later edit would be deferred and never applied. That is a silent failure,
// which is the worst kind.
//
//     {
//       DocumentWalk walk(model);          // rows may now be drawn safely
//       for (const FeatureRecord& r : model.tree().records()) { ... }
//     }                                    // queued edits run HERE
class DocumentWalk {
 public:
  explicit DocumentWalk(DocumentModel& model) : model_(model) { model_.beginWalk(); }

  // The destructor does REAL WORK — closing the outermost walk rebuilds the
  // feature tree — and a destructor that throws while the stack is already
  // unwinding calls std::terminate. That would be a hard crash inside the one
  // mechanism whose entire purpose is to prevent a crash, on the path a throw
  // out of a panel body takes. So the queue runs inside a catch-all: the
  // failure is recorded through DocumentModel::noteWalkFailure (readable in
  // pendingEditErrors()) and never propagated. The depth is decremented FIRST,
  // by endWalk() itself, so even a failed apply cannot leave the document stuck
  // in "walking" and defer every later edit for ever.
  ~DocumentWalk() {
    try {
      model_.endWalk();
    } catch (const std::exception& e) {
      model_.noteWalkFailure(e.what());
    } catch (...) {
      model_.noteWalkFailure("unknown exception");
    }
  }

  DocumentWalk(const DocumentWalk&) = delete;
  DocumentWalk& operator=(const DocumentWalk&) = delete;
  DocumentWalk(DocumentWalk&&) = delete;
  DocumentWalk& operator=(DocumentWalk&&) = delete;

 private:
  DocumentModel& model_;
};

// ── document <-> file ───────────────────────────────────────────────────────
DocumentFileData captureDocument(const DocumentModel& model);
bool restoreDocument(const DocumentFileData& data, DocumentModel& model, std::string& error);

}  // namespace forge::ui

#endif  // FORGE_UI_DOCUMENTMODEL_HPP
