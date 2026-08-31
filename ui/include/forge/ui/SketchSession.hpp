// ui/include/forge/ui/SketchSession.hpp
//
// SKETCH MODE — everything the user touches, as one headless state machine.
// Entering and leaving a sketch, the plane it lives on, the grid, the snaps, the
// entity tools with their rubber band, the auto-constrainer, the constraint and
// dimension palette, the visible constraint set, and the degrees-of-freedom
// readout. The ImGui frame builder reads this and draws it; it owns none of it.
//
// ════════════════════════════════════════════════════════════════════════════
// ★ THE MID-WALK MUTATION RULE, AND WHY THIS CLASS IS SHAPED AROUND IT
// ════════════════════════════════════════════════════════════════════════════
// Three crashes have shipped from this application, all one defect: a widget
// callback mutated a container while the frame walk was still iterating it (a
// dock tab, a splitter drag, a tree expander). Sketch editing is the densest
// source of that hazard in the whole app -- every click can add an entity, every
// entity changes the constraint list the panel is drawing, and the DOF readout
// depends on both.
//
// So this class makes the hazard STRUCTURALLY UNREACHABLE rather than avoided by
// discipline:
//
//   1. There is exactly ONE mutating function, `applyOne()`, and it is private.
//   2. Everything a widget can call during the frame is either CONST
//      (`preview()`, `dof()`, `status()`, `constraintOffers()`) or it merely
//      APPENDS TO A QUEUE (`post()`), which nothing in the frame iterates.
//   3. `flush()` drains the queue. Called during the walk it applies NOTHING and
//      COUNTS the attempt, exactly as ForgeFrame::setActiveTabAt defers and
//      counts a re-seat. Loud in test, safe in production.
//   4. `beginWalk()` fingerprints the observable state and `endWalk()` re-checks
//      it BEFORE draining. Any mutation that reached the scene by a path nobody
//      anticipated moves the fingerprint and is counted too -- a second,
//      independent instrument, because one can go quiet.
//
// `mutationsDuringWalk()` is the value a gate asserts is zero, and it is a
// LIFETIME total for the same reason `layoutReseatsDuringWalk()` is: the
// violation happens in the frame that carries the gesture, and the assertion is
// made after the FOLLOWING frame, which is precisely the frame a per-frame
// counter would have zeroed.
//
// ── the rubber band is a QUERY, not a state ─────────────────────────────────
// A preview that lived in a member would have to be written during the walk,
// which is the very thing above. `preview(cursorX, cursorY)` is const: it builds
// the ghost geometry, resolves the snap and computes the constraint offers on a
// COPY, returns them by value, and touches nothing. The renderer calls it every
// frame with the live cursor and draws what comes back. That is why the rubber
// band can be live while the state machine is strictly deferred.
//
// ── the owner's constraint: represent, repair or tolerate ───────────────────
// Nothing here refuses input to keep the model tidy. Apply a redundant
// constraint and you GET it -- the DOF report then says `over_constrained` and
// names the conflicting SET, which is a repairable state. The two places
// something is declined are both narrow and both NAMED: a constraint that refers
// to geometry which does not exist, and a gesture that would create degenerate
// geometry (a zero-radius circle). Both fill `lastRefusal()` with the entity and
// the reason, so a repair loop has something to act on.
#ifndef FORGE_UI_SKETCHSESSION_HPP
#define FORGE_UI_SKETCHSESSION_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/SelectionService.hpp"
#include "forge/ui/SketchAssist.hpp"
#include "forge/ui/SketchScene.hpp"

namespace forge::ui {

// ── tools ───────────────────────────────────────────────────────────────────
enum class SketchTool : std::uint8_t {
  Select = 0,
  Point,
  Line,
  Polyline,
  Rectangle,
  Circle,
  Arc,        // centre, start, end
  Dimension,  // reads what you picked and offers the dimension that fits it
};

inline constexpr std::size_t kSketchToolCount = 8;

const char* toString(SketchTool tool) noexcept;
bool sketchToolFromString(const std::string& name, SketchTool& out) noexcept;
std::vector<SketchTool> allSketchTools();

// How many picks the tool needs. 0 means DYNAMIC -- a polyline runs until the
// user ends it, and the dimension tool decides from what the first pick landed
// on. A fixed number here would make both of those unrepresentable.
std::size_t sketchToolPickCount(SketchTool tool) noexcept;

// ── the intent queue ────────────────────────────────────────────────────────
enum class SketchIntentKind : std::uint8_t {
  None = 0,
  Enter,                 // plane; flag = reopen (keep the geometry) rather than start fresh
  Exit,                  // flag = keep the edits; false restores the state at Enter
  SetTool,               // intA = SketchTool
  PointerMove,           // x, y
  PointerDown,           // x, y; flag = additive (shift-click) for the Select tool
  PointerUp,             // x, y
  Cancel,                // Escape: abandon the gesture, keep what is committed
  Complete,              // Enter / double-click: finish an open-ended tool
  Backtrack,             // Backspace: drop the last pick
  ToggleConstruction,    // the next entity, and the selected ones, flip
  ApplyConstraint,       // intA = SketchConstraintKind, built from the selection
  DeleteConstraint,      // intA = constraint id
  DeleteSelection,       // every selected entity and constraint
  SetConstraintValue,    // intA = constraint id, value
  SetConstraintDriving,  // intA = constraint id, flag
  SelectEntity,          // intA = entity id, flag = additive
  SelectPoint,           // intA = entity id, intB = SketchPointRole, flag = additive
  SelectConstraint,      // intA = constraint id, flag = additive
  ClearSelection,
  SetSnap,          // intA = SnapKind, flag
  SetGridSpacing,   // value
  SetGridVisible,   // flag
  SetPickRadius,    // value
  SetAutoConstrain, // flag
};

const char* toString(SketchIntentKind kind) noexcept;

struct SketchIntent {
  SketchIntentKind kind = SketchIntentKind::None;
  int intA = 0;
  int intB = 0;
  bool flag = false;
  double x = 0.0;
  double y = 0.0;
  double value = 0.0;
  SketchPlane plane{};

  static SketchIntent enter(const SketchPlane& p, bool reopen = false);
  static SketchIntent exit(bool keep);
  static SketchIntent setTool(SketchTool t);
  static SketchIntent move(double x, double y);
  static SketchIntent down(double x, double y, bool additive = false);
  static SketchIntent up(double x, double y);
  static SketchIntent cancel();
  static SketchIntent complete();
  static SketchIntent backtrack();
  static SketchIntent apply(SketchConstraintKind kind);
  static SketchIntent deleteConstraint(int id);
  static SketchIntent selectEntity(int id, bool additive = false);
  static SketchIntent selectPoint(int entity, SketchPointRole role, bool additive = false);
  static SketchIntent selectConstraint(int id, bool additive = false);
  static SketchIntent setConstraintValue(int id, double value);
  static SketchIntent setSnap(SnapKind kind, bool on);
  static SketchIntent setAutoConstrain(bool on);

  std::string describe() const;  // what the journal records
};

// ── what the renderer draws this frame ──────────────────────────────────────
struct SketchPreview {
  bool active = false;  // a tool is mid-gesture
  SketchTool tool = SketchTool::Select;
  SnapResult snap{};
  // The entities that WOULD be created if the gesture completed here. Ids are 0:
  // they are not in the scene and must never be treated as if they were.
  std::vector<SketchEntity> ghosts;
  // The auto-constraints that would come with them, already filtered to the ones
  // that say something new. These are the glyphs that appear at the cursor.
  std::vector<ConstraintProposal> proposals;
  // Entities the gesture would attach to -- highlight targets.
  std::vector<int> references;
  std::string hint;       // "click the opposite corner"
  bool completes = false; // clicking here finishes the entity
};

// One line for the status strip, plus the parts of it a panel wants separately.
struct SketchStatus {
  bool active = false;
  std::string plane;
  SketchTool tool = SketchTool::Select;
  SketchDofStatus dof = SketchDofStatus::Empty;
  std::size_t degreesOfFreedom = 0;
  std::size_t entities = 0;
  std::size_t constraints = 0;
  std::size_t conflicts = 0;
  bool solverInstalled = false;
  std::string text;
};

// What the constraint palette offers for the CURRENT selection. Every kind
// appears, always: a button the user cannot press with no explanation is the
// least actionable thing a CAD UI does. `reason` says what to select instead.
struct SketchConstraintOffer {
  SketchConstraintKind kind = SketchConstraintKind::Coincident;
  bool applicable = false;
  std::string reason;
};

// ── the session ─────────────────────────────────────────────────────────────
class SketchSession {
 public:
  explicit SketchSession(const SketchSolver& solver);

  // The solver port may be swapped for the real core at any time; the report is
  // invalidated so the next read comes from the new one.
  void setSolver(const SketchSolver& solver);
  // Optional. With none installed, a dimension is RECORDED and the status says
  // the geometry was not re-solved -- see SketchSolveDriver.
  void setDriver(SketchSolveDriver* driver) noexcept;
  bool driverInstalled() const noexcept { return driver_ != nullptr; }
  // Mirror entity picks into the application's typed selection service, as
  // EntityKind::SketchCurve references. Optional: the sketch keeps its own
  // selection either way, because a constraint is not a topology entity and has
  // no EntityKind to be.
  void attachSelection(SelectionService* selection, const std::string& bodyId);

  // ── the frame walk ──────────────────────────────────────────────────────
  void beginWalk() noexcept;
  void endWalk();
  bool inWalk() const noexcept { return walkDepth_ != 0; }
  std::size_t mutationsDuringWalk() const noexcept { return mutationsDuringWalk_; }
  std::size_t deferredApplied() const noexcept { return applied_; }
  std::size_t pendingCount() const noexcept { return pending_.size(); }

  // Records intent. SAFE from inside the walk: it appends to a queue nothing in
  // the frame iterates, and mutates no scene, no selection and no constraint.
  void post(const SketchIntent& intent);
  // Drains the queue. Returns how many intents were applied. Called during the
  // walk it applies NOTHING, counts the attempt, and returns 0.
  std::size_t flush();

  // ── const state ─────────────────────────────────────────────────────────
  bool active() const noexcept { return active_; }
  const SketchPlane& plane() const noexcept { return plane_; }
  const SketchScene& scene() const noexcept { return scene_; }
  SketchTool tool() const noexcept { return tool_; }
  bool constructionMode() const noexcept { return construction_; }
  bool autoConstrain() const noexcept { return autoConstrain_; }
  const SnapSettings& snapSettings() const noexcept { return snap_; }
  const InferenceSettings& inferenceSettings() const noexcept { return inference_; }
  const std::vector<SnapResult>& picks() const noexcept { return picks_; }
  double cursorX() const noexcept { return cursorX_; }
  double cursorY() const noexcept { return cursorY_; }

  // The rubber band, computed fresh and owning nothing. See the header comment.
  //
  // `filterIndependent` runs the offered auto-constraints through the rank test
  // so the glyphs at the cursor are exactly the ones a click would apply. That
  // is the honest preview and it is the default; it also costs one rank analysis
  // per offer, so a caller drawing a very large sketch at 60 Hz may pass false
  // and show the raw offers instead. The flag changes what is DISPLAYED, never
  // what a commit applies -- commit always filters.
  SketchPreview preview(double cursorX, double cursorY, bool filterIndependent = true) const;
  SketchPreview preview() const { return preview(cursorX_, cursorY_, true); }

  // Cached; recomputed only when the scene changed. Const, and it never touches
  // the scene: the analysis runs over a copy.
  const SketchDofReport& dof() const;
  SketchStatus status() const;
  bool isConflicting(int constraintId) const;

  const std::vector<int>& selectedEntities() const noexcept { return selEntities_; }
  const std::vector<SketchPointId>& selectedPoints() const noexcept { return selPoints_; }
  const std::vector<int>& selectedConstraints() const noexcept { return selConstraints_; }

  std::vector<SketchConstraintOffer> constraintOffers() const;
  // The constraint a given kind WOULD build from the current selection. False
  // with `why` naming what is missing.
  bool constraintFromSelection(SketchConstraintKind kind, SketchConstraint& out,
                               std::string& why) const;

  const std::vector<std::string>& journal() const noexcept { return journal_; }
  const std::string& lastRefusal() const noexcept { return refusal_; }
  const std::string& lastSolveDetail() const noexcept { return solveDetail_; }
  std::size_t autoConstraintsApplied() const noexcept { return autoApplied_; }
  std::size_t autoConstraintsDeclined() const noexcept { return autoDeclined_; }

 private:
  // THE ONLY MUTATOR. Private, and every path into it is `flush()`.
  bool applyOne(const SketchIntent& intent);
  void applyPointerDown(double x, double y, bool additive);
  void commitPicks();
  void commitDimension();
  // Runs after the shapes are already in the scene, so every binding and every
  // structural constraint can name a REAL id. Applies the tool's own
  // constraints and, when auto-constrain is on, the inferred ones -- both
  // through the same independence filter.
  void finishEntities(const std::vector<int>& newIds,
                      const std::vector<SketchPickBinding>& bindings,
                      const std::vector<SketchConstraint>& structural);
  void applyConstraintKind(SketchConstraintKind kind);
  void resolveWithDriver();
  void selectAt(double x, double y, bool additive);
  void resetGesture() noexcept;
  void touchScene() noexcept;
  void syncSelectionService();
  std::size_t fingerprint() const noexcept;
  void note(const std::string& line);

  const SketchSolver* solver_ = nullptr;
  SketchSolveDriver* driver_ = nullptr;
  SelectionService* selectionService_ = nullptr;
  std::string selectionBodyId_;

  bool active_ = false;
  SketchPlane plane_ = basePlane(SketchPlaneKind::XY);
  SketchScene scene_;
  SketchScene entrySnapshot_;  // restored by Exit(keep = false)

  SketchTool tool_ = SketchTool::Select;
  bool construction_ = false;
  bool autoConstrain_ = true;
  SnapSettings snap_{};
  InferenceSettings inference_{};
  std::vector<SnapResult> picks_;
  double cursorX_ = 0.0;
  double cursorY_ = 0.0;

  std::vector<int> selEntities_;
  std::vector<SketchPointId> selPoints_;
  std::vector<int> selConstraints_;

  std::vector<SketchIntent> pending_;
  std::size_t walkDepth_ = 0;
  std::size_t walkFingerprint_ = 0;
  std::size_t mutationsDuringWalk_ = 0;
  std::size_t applied_ = 0;

  mutable SketchDofReport dofCache_{};
  mutable bool dofDirty_ = true;

  std::vector<std::string> journal_;
  std::string refusal_;
  std::string solveDetail_;
  std::size_t autoApplied_ = 0;
  std::size_t autoDeclined_ = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_SKETCHSESSION_HPP
