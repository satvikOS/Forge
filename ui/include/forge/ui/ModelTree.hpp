// ui/include/forge/ui/ModelTree.hpp
//
// THE TWO READINGS OF ONE DOCUMENT THAT ARE NOT THE FEATURE HISTORY.
//
// ── the defect this file exists for, verbatim from a shipped build ──────────
// Seven docked tabs -- Features, Model, Sketch, Assembly, Operations, Studies
// and Sheets -- were dispatched by the frame builder to ONE function. Whichever
// of them a user clicked, they got the feature history: the same rows, in the
// same order, under seven different names. Six of those tabs were therefore
// telling the user something untrue about what they were looking at, and no gate
// could see it, because the panel they all shared was itself correct.
//
// A feature tree, a model browser and a sketch tree are three DIFFERENT
// questions about one document:
//
//   feature history   WHAT WAS DONE, in the order it was done. Every statement,
//                     including the ones whose result no longer exists because a
//                     later boolean absorbed it. That is ForgeFrame's own tree.
//   model browser     WHAT EXISTS NOW. The values the document can still NAME --
//                     the bodies, the sheets, the wires and the profiles a
//                     selection can still resolve to -- grouped by what they ARE
//                     rather than by when they were made, with what went into
//                     each one recorded underneath it.
//   sketch tree       WHAT WAS DRAWN. The sketches, the entities inside each
//                     one, the constraints holding them, and the 2D profiles
//                     whose dimensions are baked as coordinates.
//
// Every one of those is DERIVED FROM THE DOCUMENT ITSELF. Nothing here invents a
// row, a name or a number: a sketch owns an entity because that entity's first
// operand is the sketch's creation id, and a dimension is the argument the
// statement actually carries. Where the document says nothing, these structures
// come back EMPTY, which is what lets a panel say "there are none yet" honestly
// instead of drawing a plausible fiction.
//
// ── "STILL EXISTS" IS THE DOCUMENT'S ANSWER, NOT THIS FILE'S ────────────────
// The obvious rule -- a value is gone once a later statement mentions it -- is
// WRONG, and getting it wrong would make a model browser hide half a real part.
// `SOLVE(%sketch)` mentions its sketch and destroys nothing (the sketch keeps
// its node and can be constrained further), and `CON`, `TAG`, `VERIFY` and
// `SURFCHECK` are documented PASS-THROUGHS that return their operand unchanged.
// A boolean, by contrast, really does absorb both its operands.
//
// PartDocument already knows the difference, because `appendFeature` is told
// which nodes an edit CONSUMED and drops exactly those bindings. So "still
// exists" here is `PartDocument::nodeFor(irId) != ""` -- the receiver's own
// binding table -- and never a rule re-derived in this file that could disagree
// with the one the commands enforce. What the ref walk below computes is a
// different and weaker fact, USED BY: which later statement took this value as
// an operand.
//
// ── the argument names, and where they come from ────────────────────────────
// `RECT(80, 50)` means an 80 mm by 50 mm rectangle, and the only place that is
// written down is the documented form in
// forge-kernel/include/forge/ft/FeatureTree.hpp:
//
//     Rect,        // RECT(w, h [, cx=0, cy=0])
//
// So the names in this file are that comment, transcribed, and
// ui/test/model_tree_test.cpp RE-DERIVES them by reading the kernel header as
// data -- exactly as ui/test/feature_ir_test.cpp already re-derives the arities
// beside them. A UI that labels an argument from memory is a UI that will one
// day tell a user a slot's width is its length.
//
// Nothing here includes a drawing header. It is arithmetic and classification
// over value types, so the numbers a panel prints are asserted headless.
#ifndef FORGE_UI_MODELTREE_HPP
#define FORGE_UI_MODELTREE_HPP

#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

// ── one value of the program, as a browser sees it ──────────────────────────
struct ModelValue {
  int irId = 0;                  // the statement that produced it
  IrValueKind kind = IrValueKind::Solid;
  std::string label;             // the record's own row label
  std::string op;                // the statement's op name
  std::string statement;         // the statement text, for a tooltip
  std::string node;              // the selection node bound to it; "" when none
  // TRUE when the document still binds a selection node to this value -- the
  // receiver's own answer to "can a user still pick this". See the header note.
  bool live = false;
  int consumedBy = 0;            // the first later statement that takes it, else 0
  std::string consumedByLabel;   // that statement's row label, for the panel
  // The pass-through statements attached to this value: a constraint, a
  // persistent name, a recorded check. They produce no object of their own, so
  // they are counted here rather than listed as things that exist.
  std::size_t annotations = 0;
  // The operands this statement itself took, in argument order. This is the
  // "what went into it" half of a browser: a boolean's two bodies, an extrude's
  // profile.
  std::vector<int> operands;
};

// ── the model browser's whole answer ────────────────────────────────────────
// The index vectors address `values`; they are computed once here so a panel
// walks a list rather than re-deriving the grouping every frame.
struct ModelBrowser {
  std::vector<ModelValue> values;
  std::vector<std::size_t> bodies;    // named Solid
  std::vector<std::size_t> sheets;    // named Surface
  std::vector<std::size_t> wires;     // named Wire
  std::vector<std::size_t> profiles;  // named Profile
  std::vector<std::size_t> sketches;  // named Sketch / SketchRef
  std::vector<std::size_t> consumed;  // absorbed by a later statement
  // In the history, bound to no node and absorbed by nothing. Shown rather than
  // dropped: a statement a browser silently omits is one a user cannot ask about.
  std::vector<std::size_t> unnamed;

  std::size_t rowCount() const noexcept { return values.size(); }
  // The value `irId` names, or nullptr.
  const ModelValue* find(int irId) const noexcept;
};

// The four ops the kernel documents as PASS-THROUGH: they return their operand
// unchanged and produce no object of their own.
bool isPassThroughOp(const std::string& op);

ModelBrowser buildModelBrowser(const PartDocument& document);

// ── the sketch tree ─────────────────────────────────────────────────────────
enum class SketchItemRole : unsigned char { Point, Curve, Constraint, Solve };

const char* toString(SketchItemRole role) noexcept;

struct SketchEntity {
  int irId = 0;
  std::string op;
  SketchItemRole role = SketchItemRole::Point;
  std::string label;    // "Point", "Line", "Circle", "Arc", or the constraint's kind
  std::string detail;   // the operands/values the statement actually carries
};

// One SKETCH statement and everything the document attaches to it.
struct SketchGroup {
  int irId = 0;
  std::string label;                 // the record's row label
  std::string plane;                 // the PLANE keyword the statement carries
  std::vector<SketchEntity> entities;
  std::size_t points = 0;
  std::size_t curves = 0;
  std::size_t constraints = 0;
  int solvedBy = 0;                  // the SOLVE statement, 0 while unsolved
  int consumedBy = 0;                // what consumed the solved profile
  std::string consumedByLabel;
};

// One argument of a profile op: the kernel's own name for it, and the value the
// statement carries.
enum class DimensionUnit : unsigned char { Length, Angle, Count };

struct ProfileDimension {
  std::string name;      // the kernel header's token: "w", "cx", "angleDeg"
  std::string display;   // that token spelled for a person: "Width", "Centre X"
  double value = 0.0;
  DimensionUnit unit = DimensionUnit::Length;
  bool defaulted = false;  // the statement omitted it; the kernel's default applies
};

// A 2D profile whose shape is baked as numbers rather than solved from
// constraints: RECT, RRECT, CIRCLE, SLOT, REGPOLY, and the two ring forms POLY
// and ARC whose "dimension" is a point count.
struct ProfileShape {
  int irId = 0;
  std::string op;
  std::string label;
  std::vector<ProfileDimension> dimensions;
  std::size_t points = 0;            // POLY / ARC ring size, 0 for the rest
  int consumedBy = 0;
  std::string consumedByLabel;
};

struct SketchTree {
  std::vector<SketchGroup> sketches;
  std::vector<ProfileShape> profiles;
  // Statements of the sketch family whose owning SKETCH is not in this document.
  // Reported rather than dropped: a row that vanishes is a row a user cannot ask
  // about.
  std::vector<SketchEntity> unattached;

  std::size_t rowCount() const noexcept;
  bool empty() const noexcept { return sketches.empty() && profiles.empty(); }
};

SketchTree buildSketchTree(const PartDocument& document);

// ── the transcribed argument names ──────────────────────────────────────────
// TRUE and the names filled in when `op` is one of the baked 2D profile ops.
// The vector is in ARGUMENT ORDER and covers required and optional alike, so a
// statement that omitted an optional argument still knows what the next one
// would have been.
bool profileArgNames(const std::string& op, std::vector<std::string>& out);
// The reading of one of those tokens a person can use. Falls back to the token
// itself, so an argument this table has not been taught is shown verbatim rather
// than mislabelled.
std::string argDisplayName(const std::string& token);
DimensionUnit argUnit(const std::string& token);

// The constraint kinds CON dispatches, and the reading of each. "" for a keyword
// this table does not know -- CON names an unknown kind rather than failing, and
// so does this.
std::string constraintDisplayName(const std::string& keyword);

}  // namespace forge::ui

#endif  // FORGE_UI_MODELTREE_HPP
