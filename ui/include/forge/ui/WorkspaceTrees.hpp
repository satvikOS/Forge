// ui/include/forge/ui/WorkspaceTrees.hpp
//
// THE FOUR REMAINING READINGS OF ONE DOCUMENT — Assembly, Operations, Sheets
// and Studies.
//
// ── the defect this file exists for ─────────────────────────────────────────
// Seven docked tabs were dispatched by the frame builder to ONE function and all
// seven drew the feature history. ModelTree.hpp took three of them back --
// Features, Model and Sketch are now three different questions about one
// document. The other four were left with a tab, a sentence and NOTHING, on the
// reasoning that "nothing in this application holds an assembly, a machining
// setup, a simulation study or a drawing sheet".
//
// That reasoning is half right and the wrong half is load-bearing. There is no
// SECOND document holding components, operations, sheets or studies -- and there
// does not need to be, because all four are readings of the part document that
// already exists:
//
//   assembly    WHAT IS PLACED WHERE. Every body the program builds, nested
//               under the body that absorbed it, plus the statements that PLACE
//               copies of one -- TRANSLATE, ROTATE, MIRROR and PATTERN are the
//               kernel's own replication family and each one puts a counted
//               number of instances into the result.
//   operations  WHAT MUST BE TAKEN AWAY. The subtractive statements, in the
//               order the model removes them, with the diameter, depth, radius
//               or wall the statement itself carries and the smallest tool that
//               can make it.
//   sheets      WHAT IT TAKES TO DRAW IT. The standard sheet and the standard
//               scale a four-view general arrangement of THIS part needs, and
//               what each view will measure on the paper.
//   studies     WHAT CAN BE SOLVED, AND WHAT IS STILL MISSING. The balance point
//               of a homogeneous body is its volume centroid and needs no
//               material, so it is ANSWERED here; weight and stress name the
//               exact inputs the document does not yet carry.
//
// ── the rule these four are written to ──────────────────────────────────────
// The rule is InspectionReport.hpp's, quoted: A PANEL MAY ONLY PRINT WHAT
// SOMETHING HEADLESS HAS ALREADY ASSERTED. The frame builder is the one file CI
// compiles and never RUNS, so a number invented there is a number nothing can
// contradict. Every quantity below is computed here, from the document's own
// statements or from a measurement the application already made, and pinned by
// ui/test/workspace_trees_test.cpp. Nothing here includes a drawing header, a
// kernel header or ImGui.
//
// ── and the rule about what is NOT here ─────────────────────────────────────
// Where the document says nothing, these structures come back EMPTY or say
// Missing by name. A part with no cuts has no operations; a document with no
// measured body has no sheet. That is what lets a panel say "there are none yet"
// honestly instead of drawing a plausible fiction -- which is the failure the
// seven-tabs-one-function defect actually was.
#ifndef FORGE_UI_WORKSPACETREES_HPP
#define FORGE_UI_WORKSPACETREES_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/Material.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/ModelTree.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/Units.hpp"

namespace forge::ui {

// ── 1. THE ASSEMBLY READING ────────────────────────────────────────────────
//
// A component is a body or a sheet the program builds. It is NESTED under the
// statement that absorbed it: `%7 = FUSE(%5, %6)` is one component whose two
// children are %5 and %6, which is exactly the tree a user means by "what is
// this made of". The nesting is finite and acyclic by construction, because the
// IR forbids a forward reference (FeatureIr.hpp, IrCheck::ForwardValueRef), so
// every operand id is strictly smaller than the statement that names it.

// The kernel's replication family, by what it does to the assembly. Transcribed
// from forge-kernel/include/forge/ft/FeatureTree.hpp:
//
//   Translate,   // TRANSLATE(%a, dx, dy, dz)
//   Rotate,      // ROTATE(%a, angleDeg, axx, axy, axz [, ox=0, oy=0, oz=0])
//   Mirror,      // MIRROR(%a, PLANE)                   PLANE = XY|YZ|XZ
//                // MIRROR(%a, px,py,pz, nx,ny,nz)      reflect + FUSE
//   Pattern,     // PATTERN(%a, LINEAR, n, dx [, dy=0, dz=0])
//                // PATTERN(%a, POLAR, n, totalAngleDeg [, ox,oy,oz, axx,axy,axz])
//                // PATTERN(%a, GRID, nx, ny, dx, dy)   nx*ny fused instances
enum class PlacementKind : std::uint8_t {
  Moved,           // TRANSLATE
  Turned,          // ROTATE
  Mirrored,        // MIRROR
  RepeatedInLine,  // PATTERN LINEAR
  RepeatedRound,   // PATTERN POLAR
  RepeatedInGrid,  // PATTERN GRID
  Repeated,        // PATTERN with a keyword this table does not know
};

const char* placementWord(PlacementKind kind) noexcept;

// TRUE for the four ops above and nothing else.
bool isPlacementOp(const std::string& op);

struct AssemblyPlacement {
  int irId = 0;
  std::string op;                              // "PATTERN"
  PlacementKind kind = PlacementKind::Moved;
  std::string label;                           // the record's own row label
  // What this statement does, in a user's words, with the statement's OWN
  // numbers in it: "6 copies, 25 mm apart". Never a remembered sentence -- the
  // numbers are read from the arguments and formatted with formatIrNumber.
  std::string describe;
  int source = 0;                              // the component it copies, 0 when none
  std::string sourceLabel;
  // How many placed copies of `source` this statement puts in the result.
  // PATTERN's own count (nx*ny for GRID); 1 for a move, a turn or a mirror. A
  // PATTERN whose count argument is not a positive whole number contributes 1
  // and says so through `countKnown`, rather than reporting 0 instances of a
  // statement that plainly makes some.
  std::size_t copies = 1;
  bool countKnown = true;
  bool live = false;                           // the document still binds a node
};

struct AssemblyComponent {
  int irId = 0;
  std::string label;
  std::string op;
  std::string statement;                       // for a tooltip
  std::string node;                            // the selection node, "" when none
  bool live = false;                           // still nameable by a selection
  IrValueKind kind = IrValueKind::Solid;
  std::size_t depth = 0;                       // 0 == a top-level component
  std::vector<std::size_t> children;           // indices into AssemblyTree::components
  // The placement statements that copy THIS component, if any.
  std::vector<std::size_t> placements;         // indices into AssemblyTree::placements
};

struct AssemblyTree {
  // Depth-first: a parent is always at a lower index than its children, so a
  // panel draws the tree by walking the vector once.
  std::vector<AssemblyComponent> components;
  std::vector<AssemblyPlacement> placements;
  std::vector<std::size_t> roots;              // the depth-0 components, in id order
  std::size_t placedCopies = 0;                // sum over placements of `copies`
  std::size_t liveComponents = 0;

  std::size_t rowCount() const noexcept { return components.size() + placements.size(); }
  bool empty() const noexcept { return components.empty(); }
  const AssemblyComponent* find(int irId) const noexcept;
};

AssemblyTree buildAssemblyTree(const PartDocument& document);

// ── 2. THE MACHINING READING ───────────────────────────────────────────────
//
// A machining operation is a statement that TAKES MATERIAL AWAY. Which ops those
// are is not a judgement call: the kernel documents each one's effect, and the
// six below are the ones whose effect is subtractive.
//
//   Hole,        // HOLE(%body, dia, cx, cy, cz [, axx, axy, axz, depth<=0 => through])
//   Cbore,       // CBORE(%body, dia, cboreDia, cboreDepth, cx, cy, cz [, ...])
//   Cut,         // CUT(%a, %b)
//   Shell,       // SHELL(%body, wall [, ...])   hollow (inward)
//   Fillet,      // FILLET(%body, radius [, sel=ALL])
//   Chamfer,     // CHAMFER(%body, dist [, sel=ALL])
//   ResizeBore,  // RESIZEBORE(%body, "sel", newRadius)
//
// FILLET and CHAMFER are here because a rounded internal corner is the single
// constraint that decides a cutter's diameter, and a shop reads them as
// operations. PUSHFACE and DEFEATURE are NOT here: pushing a face adds material
// as readily as it removes it, and defeaturing deletes faces and heals the
// wound, so neither has a subtractive reading this file could defend. They are
// counted as shaping statements instead of being silently dropped.
enum class MachiningKind : std::uint8_t {
  Drill,        // HOLE
  Counterbore,  // CBORE
  Bore,         // RESIZEBORE
  Cutout,       // CUT
  Hollow,       // SHELL
  EdgeRound,    // FILLET
  EdgeBreak,    // CHAMFER
};

const char* machiningWord(MachiningKind kind) noexcept;

// TRUE for the seven ops above and nothing else.
bool isMaterialRemovalOp(const std::string& op);

struct MachiningOperation {
  int irId = 0;
  std::size_t order = 0;      // 1-based, in the order the model removes the material
  std::string op;
  MachiningKind kind = MachiningKind::Cutout;
  std::string label;          // the record's own row label
  std::string action;         // "Drill a hole", in a user's words
  // `evidence`, not `detail` -- see InspectionReport.hpp: `detail` names
  // untranslated internal detail in this codebase, and this is the opposite.
  std::string evidence;       // the numbers the statement carries
  // The diameter of the round tool this feature NAMES, in mm: a drill of the
  // hole's diameter, a cutter of twice the fillet's corner radius, a boring head
  // at twice the bore's radius. 0 when the statement names none -- a CUT by
  // another body says nothing at all about a tool, and a chamfer can be cut with
  // any size of chamfer mill.
  double toolDiameterMm = 0.0;
  double depthMm = 0.0;
  bool through = false;       // a HOLE whose depth argument is absent or <= 0
};

struct MachiningPlan {
  std::vector<MachiningOperation> operations;
  // Statements that are neither an operation nor a pass-through: the ones that
  // ADD or shape material. Reported so a short list of cuts reads as a fact
  // about the model rather than as a panel that lost some.
  std::size_t shapingStatements = 0;
  std::size_t holes = 0;
  std::size_t cutouts = 0;
  std::size_t edgeOperations = 0;
  // The smallest diameter any operation names -- the tool that limits the job.
  // 0, and `smallestToolKnown` false, when no operation names one.
  double smallestToolMm = 0.0;
  bool smallestToolKnown = false;

  std::size_t rowCount() const noexcept { return operations.size(); }
  bool empty() const noexcept { return operations.empty(); }
};

MachiningPlan buildMachiningPlan(const PartDocument& document);

// ── 3. THE DRAWING READING ─────────────────────────────────────────────────
//
// A drawing of a part is a SHEET at a SCALE carrying a set of VIEWS, and which
// sheet and which scale is arithmetic over the part's own bounding box against
// two standard tables. Both tables are standards, not house choices:
//
//   sheet sizes   ISO 216 A-series trimmed sizes, in millimetres.
//   scales        ISO 5455 preferred scales -- the ones a drawing is allowed to
//                 be at. A part is never drawn at 1:3.
//
// The arrangement is the four-view general arrangement every mechanical drawing
// starts from: a front view, the plan above it, an end view beside it, and an
// isometric in the corner they leave free.
struct SheetSize {
  std::string name;        // "A3"
  double widthMm = 0.0;    // landscape: width >= height
  double heightMm = 0.0;
};

// A4 through A0, smallest first. Deterministic.
const std::vector<SheetSize>& sheetSizeLibrary();

// ISO 5455 preferred scales as a multiplier (drawn size / real size), LARGEST
// first, so the first one that fits is the largest the part can be drawn at.
//
// THE SELECTION RULE, stated because it is a choice: buildDrawingSheets() picks
// the LARGEST scale not greater than full size at which the four views fit on
// any sheet, and then the SMALLEST sheet that holds them at that scale. Scale
// first, because the scale is what decides whether a person can read the
// drawing and the sheet is only the paper it takes to hold it. Enlargement is a
// decision a person makes about a part too small to read, and nothing in a
// bounding box can make it, so the enlargement half of the series is offered
// here and never chosen automatically.
const std::vector<double>& drawingScaleLibrary();

// "1:2", "5:1", "1:1". Exact for every entry of the library above.
std::string scaleLabel(double scale);

struct SheetView {
  NamedView view = NamedView::Front;
  std::string name;            // "Front"
  double widthMm = 0.0;        // the part's extent across this view, full size
  double heightMm = 0.0;
  double paperWidthMm = 0.0;   // the same extent at the sheet's scale
  double paperHeightMm = 0.0;
};

struct DrawingSheet {
  std::string name;            // "Sheet 1"
  SheetSize size{};
  double marginMm = 0.0;       // the border kept clear on every edge
  double gapMm = 0.0;          // the space left between neighbouring views
  double scale = 1.0;
  std::string scaleLabelText;  // "1:2"
  std::vector<SheetView> views;
  double usedWidthMm = 0.0;    // what the arrangement occupies ON THE PAPER
  double usedHeightMm = 0.0;
  double drawableWidthMm = 0.0;
  double drawableHeightMm = 0.0;
  // FALSE when no sheet in the library holds the arrangement at any preferred
  // scale. The sheet is then the largest one at the smallest preferred scale and
  // says it does not fit, rather than reporting a scale nobody could draw at.
  bool fits = false;
};

struct DrawingSheetSet {
  std::vector<DrawingSheet> sheets;
  // FALSE when there is no measured part to draw. Not an error: a document with
  // nothing built has no views, and saying so is the honest answer.
  bool known = false;
  std::size_t rowCount() const noexcept;
};

// The border kept clear of the trimmed edge, and the space between views. Both
// are stated rather than buried, because they decide which sheet is chosen.
inline constexpr double kSheetMarginMm = 10.0;
inline constexpr double kSheetViewGapMm = 15.0;

// `box` is the measured bounding box of what the document builds. An invalid or
// zero-sized box yields `known == false` and no sheets.
DrawingSheetSet buildDrawingSheets(const MeasureBox& box);

// ── 4. THE SIMULATION READING ──────────────────────────────────────────────
//
// A study is a question plus the inputs it needs, and the useful thing a study
// tree can say about a document that has never been set up is WHICH INPUT IS
// MISSING. One of the three below is answerable from geometry alone and is
// therefore answered: the point a homogeneous body balances about is its volume
// centroid, and no material property enters that.
enum class StudyItemState : std::uint8_t {
  // The document supplies this input, and `detail` says what it is.
  Ready,
  // Nothing in the document supplies it yet. `detail` says what would.
  Missing,
  // Something supplies it and it cannot be used -- an open surface has no
  // volume, so it cannot be balanced, weighed or meshed. NOT Missing: the
  // difference is what a user has to do next.
  Blocked,
};

const char* toString(StudyItemState state) noexcept;

struct StudySetupItem {
  std::string name;    // "Shape", "Material", "Restraints", "Loads"
  std::string evidence;  // the evidence, with its numbers
  StudyItemState state = StudyItemState::Missing;
};

enum class StudyState : std::uint8_t {
  // Every input is Ready and `answer` holds the result.
  Answered,
  // Every input the study needs is not there yet; `missing` counts them.
  Waiting,
  // An input is Blocked: something is present and unusable.
  Stopped,
};

const char* toString(StudyState state) noexcept;

struct Study {
  std::string name;       // "Balance point"
  std::string solvesFor;  // "the point this part balances about"
  std::vector<StudySetupItem> setup;
  StudyState state = StudyState::Waiting;
  std::string answer;     // non-empty exactly when state == Answered
  std::size_t missing = 0;
  std::size_t blocked = 0;
};

struct StudyPlan {
  std::vector<Study> studies;
  std::size_t rowCount() const noexcept;
  std::size_t answered() const noexcept;
};

// `mesh` is what measureMesh() reported for what is on screen; `exactVolumeMm3`
// is the kernel's own volume when it has one and 0 when it does not (the mesh's
// is used then, and the study says which); `material` is the document's material
// choice -- pass unassignedMaterial() when the document carries none, which is a
// real state and not a gap.
//
// `picked` is the LIVE SELECTION, and it is here because the two inputs a stress
// study is missing are both FACES. "nothing holds this part still" and "three
// faces are picked and none of them is holding it" are different sentences and
// the second one is the one a user can act on; a row that could not tell them
// apart would be a constant wearing a state's clothes.
StudyPlan buildStudyPlan(const MeshMeasure& mesh, double exactVolumeMm3, const Material& material,
                         MassUnit massDisplay, const SelectionMeasure& picked);

}  // namespace forge::ui

#endif  // FORGE_UI_WORKSPACETREES_HPP
