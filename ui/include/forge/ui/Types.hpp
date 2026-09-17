// ui/include/forge/ui/Types.hpp — shared value types for the Forge UI layer.
//
// The Forge desktop UI is drawn with Dear ImGui (DECISION D-001), but NOTHING in
// this layer includes an ImGui header. The command registry, the selection
// service, the keymap, the dock model and the feature-tree model are pure C++20
// value/service types with no windowing, no GPU and no global mutable state, so
// they run headless in CI and the ImGui frame builder is a thin consumer on top.
#ifndef FORGE_UI_TYPES_HPP
#define FORGE_UI_TYPES_HPP

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace forge::ui {

// ── typed topology selection ────────────────────────────────────────────────
// Sacrosanct s19.2: selection resolves to a STABLE topology reference, never a
// raw face index — an index is invalidated by any rebuild that repermutes the
// B-rep, which is exactly when a UI selection most needs to survive.
enum class EntityKind : std::uint8_t {
  None = 0,
  Vertex,
  Edge,
  Face,
  Body,
  Sketch,
  SketchCurve,
  // A closed 3D section ring (forge::ft's WIRE value: RING / WIRE). NOT a Sketch:
  // a sketch is a Z=0 profile, and the whole reason the kernel has a separate WIRE
  // kind is that a loft section lives at an arbitrary height and plane. Selecting
  // one has to be distinguishable from selecting a profile, or LOFT and EXTRUDE
  // would offer themselves on each other's input -- which is the mis-selection a
  // typed signature exists to refuse.
  Wire,
  // A SHEET body (forge::ft's SURFACE value: SKIN / FACES / SEW). NOT a Body:
  // a sheet bounds no volume, and the whole reason the kernel has a separate
  // SURFACE kind is that THICKEN/CAP consume the one and FILLET/SHELL the other.
  // Selecting a sheet has to be distinguishable from selecting a solid for the
  // SAME reason Wire had to be distinguishable from Sketch -- otherwise THICKEN
  // offers itself on a solid and SHELL offers itself on a sheet, and the kernel
  // throws on both swaps. This is the fourth value-kind entity, and the last:
  // PROFILE, WIRE, SOLID and SURFACE are the whole of IrValueKind.
  Surface,
  // ── the two SKETCH-SOLVER kinds ───────────────────────────────────────────
  // These carry the last two IrValueKinds a selection could not name. The four
  // above (Sketch/Wire/Body/Surface) cover PROFILE, WIRE, SOLID and SURFACE; the
  // constraint-solver family added SKETCH and SKETCHREF, and until a selection
  // could distinguish them no command consuming one could be offered.
  //
  //   * OpenSketch -- forge::ft's SKETCH value: a sketch still UNDER
  //     CONSTRUCTION. It is NOT `Sketch`, which this file has always used for a
  //     solved PROFILE (ArchieCopilot::wantedKind maps it to
  //     IrValueKind::Profile and the node prefix is `sketch_`). SPT and SOLVE
  //     consume this one; EXTRUDE consumes the other. Offering either on the
  //     other's value is the mis-selection a typed signature exists to refuse.
  //   * SketchRef -- forge::ft's SKETCHREF value: one point / line / circle / arc
  //     INSIDE a sketch. A constraint has to NAME two entities, and the IR
  //     addresses every value by its %N creation id, so an entity has to BE a
  //     selectable value.
  //
  // THEIR toString() SPELLING IS NOT FREE, and this is the rule the two-word
  // kinds above got away with breaking. archie_op_vocabulary.json records a
  // command's selection kind by its ENUM SPELLING ("OpenSketch"), and both
  // consumers compare that against toString() CASE-FOLDED --
  // ui/test/archie_op_vocabulary_test.cpp asserts the equality and
  // OpConstraintBridge's mapEntityKind resolves the spelling back to this enum
  // through it. So a kind that appears in a SELECTION SIGNATURE must spell
  // itself as its enum name lowered, with no separator: `opensketch`, not
  // `open_sketch`. `SketchCurve` keeps its underscore only because no signature
  // names it -- the vocabulary gate would go red the moment one did.
  OpenSketch,
  SketchRef,
  Feature,
  Component,
  Datum,
  Any,  // signature wildcard: any single concrete kind satisfies it
};

// THE SIGNATURE SPELLING. This is the enum's own name, lowered, and a selection
// signature is MATCHED against it -- so it is a wire name and must not change to
// suit a sentence. It is not fit to draw: "sketch_curve", "opensketch" and
// "sketchref" are identifiers, and a status strip that reads one out loud is
// showing the user the inside of the program.
const char* toString(EntityKind kind) noexcept;

// THE WORD A MACHINIST USES for the same thing, singular, lower case, so a
// caller can pluralise it ("2 sketch curves") or put it in a sentence ("Set the
// pick filter to edge"). Every user-facing surface uses THIS one.
const char* userText(EntityKind kind) noexcept;

// ── the standard views ──────────────────────────────────────────────────────
// The six orthographic directions plus true isometric. The ANGLES live in
// forge::ui::CameraModel; only the vocabulary is here, beside EntityKind, so
// that the shell and the command layer can name a view without depending on the
// camera's geometry headers.
//
// Z-up, matching the convention forge-kernel's primitives are authored in
// (makeBox extrudes +Z): FRONT puts the eye on -Y and RIGHT puts it on +X.
//
// Only views whose angles are DEFINED are here. Dimetric and trimetric are real
// CAD menu entries, but their angles are a house convention rather than a
// derivation, and inventing one would be inventing a number.
enum class NamedView : std::uint8_t {
  Front = 0,
  Back,
  Left,
  Right,
  Top,
  Bottom,
  Isometric,
};

inline constexpr std::size_t kNamedViewCount = 7;

const char* toString(NamedView view) noexcept;
// The command suffix: "front", "back", ... as `view.front` spells it.
const char* commandSuffix(NamedView view) noexcept;
// Parse a suffix back. Returns false and leaves `out` untouched on an unknown
// name — a viewport must never silently pick an arbitrary view.
bool namedViewFromSuffix(const std::string& suffix, NamedView& out) noexcept;

// ── the kernel's edge-selector classes, as forge::ft ACTUALLY resolves them ──
// forge-kernel/src/ft/FeatureTreeCompiler.cpp selectEdges() offers exactly four
// keywords -- ALL | VERTICAL | RIM | HORIZONTAL -- and decides VERTICAL and
// HORIZONTAL from the CHORD between an edge's first and last tessellation point:
//
//     dz/len -> vertical when | |dz|/len - 1 | < 1e-2
//               horizontal when len < 1e-9 (a closed rim) or |dz|/len < 1e-2
//
// (RIM is a byte-identical alias of HORIZONTAL on that build; the audit measured
// both at 47662.772762 on a 60x40x20 box. This enum therefore has three values,
// not four -- naming a duplicate would be inventing a distinction the kernel does
// not make.) An edge that is neither -- a chamfer's slant, a loft's silhouette --
// falls in NO class, and no keyword in the kernel's vocabulary can name it.
//
// This enum is here rather than beside EdgeModel because it is the vocabulary a
// COMMAND has to emit into, and PartCommands must read it off a selection without
// taking a dependency on the mesh headers.
enum class EdgeAxisClass : std::uint8_t {
  None = 0,   // in neither class: the kernel cannot name this edge at all
  Vertical,   // FILLET/CHAMFER/BLEND keyword VERTICAL
  Horizontal  // keyword HORIZONTAL (and its alias RIM)
};

// ── WHAT THE PICK ITSELF SAW ────────────────────────────────────────────────
// EntityRef above this line is pure IDENTITY: which body, what sort of thing,
// what it is called. That is what has to survive a rebuild, and it is all that
// key() and operator== may ever look at.
//
// This is the other half, and until now the application threw it away. MEASURED
// on the real registry at 488e5328: part.hole emits HOLE(%N, 9, 0, 0, 0) for a
// click on ANY face -- the world origin, on a hard-coded +Z axis
// (ui/src/PartCommands.cpp) -- because a face reference carried a NAME and no
// POSITION, while KernelScene::pick() computed the hit point four lines earlier
// and dropped it on the floor. PickResult::point had zero readers in the tree.
//
// So the evidence travels WITH the reference, and stays separable from it:
//
//   * It is NOT identity. Two clicks on the same face at different pixels are
//     the SAME face, and toggling one must remove the other -- so key() and
//     operator== ignore every field here, deliberately, and
//     selection_consumed_test.cpp asserts that they do.
//   * It is OPTIONAL. `valid` false is the honest state of a reference that came
//     from the feature tree, from a macro or from Archie, none of which involve
//     a ray. Every command below treats absent evidence as "use the typed
//     parameters", which is exactly what it did before this record existed, so
//     those three paths emit byte-identically to the build before this change.
struct PickEvidence {
  // Where the ray met the model, in model units (mm). For a face this is a point
  // ON that face; for an edge it is the closest point on the picked polyline.
  double point[3] = {0.0, 0.0, 0.0};
  // The face's OUTWARD unit normal -- outward as in "away from the material",
  // decided from the closed surface's own winding rather than assumed (see
  // faceOutwardNormal in PickModel.hpp). All-zero when unknown or not a face.
  double normal[3] = {0.0, 0.0, 0.0};
  // ── the two edge fields, and why a COUNT is one of them ──────────────────
  // The kernel cannot name an individual edge: its whole vocabulary is the three
  // classes above. So an edge pick can only be honoured when the picked set IS a
  // whole class -- pick every vertical edge and VERTICAL means exactly that; pick
  // three of twelve and no keyword in the language says so.
  //
  // Deciding that needs the size of the class, which is a property of the BODY
  // and not of one edge, and the command layer never sees the body's mesh. So the
  // viewport -- which has just derived the edge set to do the pick at all --
  // records it here, on each edge it hands over. A command then compares the
  // number of picked edges against it. That is the whole mechanism, and it is why
  // a count lives on a reference.
  EdgeAxisClass axisClass = EdgeAxisClass::None;
  std::uint32_t classMembers = 0;  // edges of THIS class on the body, at pick time

  // ── WHICH BUILD OF THE PART THE PICK WAS TAKEN ON ────────────────────────
  // buildStamp() of the program the viewport was SHOWING when the ray was cast.
  // Everything above is a fact about that one tessellation, and none of it
  // survives an edit: MEASURED on the shipped worker, a boss-top pick at z = 28
  // kept its point after the boss was edited down to z = 16, and a counterbore
  // placed from it came out as a plain through hole; a pick of all 4 upright
  // edges kept classMembers = 4 after an edit gave the body 8, and VERTICAL
  // rounded all 8. The selection survives a rebuild on purpose -- identity is
  // what must survive -- so the evidence has to say which build it describes, and
  // a command compares this against the document it is about to append to.
  // 0 means "never stamped", and matches no document.
  std::uint64_t built = 0;

  // ── FACE ONLY: what the placement rule needs to refuse honestly ──────────
  // True when every triangle of the picked face points the same way
  // (FaceMeasure::planar). A hole needs ONE drilling direction, and a curved face
  // does not have one: the area-weighted normal of a bore wall cancels to zero,
  // and that of a quarter-round fillet is the bisector, 45 degrees off the local
  // normal at its ends. Neither is an axis, so a command refuses a face that is
  // not planar rather than drilling along either.
  bool planar = false;
  // The picked face's own triangles, 9 doubles each, in model units. A position
  // TYPED for a feature on a picked face must lie ON that face, and the plane
  // alone cannot say so: the plate top of a plate-and-boss is one plane with a
  // hole in it where the boss stands, and a point typed there is inside the boss.
  // Shared, because a reference is copied into the selection, the focus and every
  // command context, and the triangles never change once recorded.
  std::shared_ptr<const std::vector<double>> faceTriangles = {};

  bool valid = false;

  bool hasNormal() const noexcept {
    return normal[0] != 0.0 || normal[1] != 0.0 || normal[2] != 0.0;
  }
};

// The stamp PickEvidence::built carries: FNV-1a (Fowler, Noll, Vo), 64-bit, over
// the bytes of a feature-IR program. It is a CONTENT stamp, not a counter, and
// that is the property wanted: an undo that restores a program restores the
// geometry a pick was taken on, and a pick from before the edit is valid again,
// while any edit that changes a single byte of the program invalidates it.
// Never 0, so an unstamped record can never match a document.
std::uint64_t buildStamp(const std::string& program) noexcept;

// A stable, rebuild-surviving reference to one topological entity.
//   bodyId          — persistent body/document-node identity
//   kind            — what sort of entity this names
//   persistentName  — the label this reference is KNOWN BY. For faces it is
//                     "face@<index>", which is a TOPOLOGY INDEX and does NOT
//                     survive an edit: MEASURED, the same conceptual face is
//                     "cylinder face 6" before an earlier HOLE is inserted and
//                     "cylinder face 7" after. This comment used to claim it
//                     "survives index permutation", which is the property doc 04
//                     calls a major product risk when it is absent -- and saying
//                     so here is very likely why nobody went looking.
//   signature       — the identity that DOES survive: a quantised geometric
//                     signature of the face (kind, area, centroid, normal).
//                     Empty when unknown, so this is additive and every existing
//                     .fpart still loads. Resolution prefers it and falls back to
//                     the index only when it is absent.
//   generation      — bumped by the modeller when the entity is re-resolved,
//                     so the UI can report a stale reference honestly
struct EntityRef {
  std::string bodyId;
  EntityKind kind = EntityKind::None;
  std::string persistentName;
  std::uint64_t generation = 0;
  // LAST, and with a DEFAULT MEMBER INITIALISER. Both halves are required.
  //
  // EntityRef is aggregate-initialised across the tree -- EntityRef{"body_1",
  // EntityKind::Face, name, 1} appears in nine test files -- so inserting a member
  // before `generation` silently rebinds that 1 to a std::string. Appending fixes
  // that but not the second problem: ui builds with -Werror
  // -Wmissing-field-initializers, under which ANY new aggregate member breaks every
  // brace-initialiser that does not list it.
  //
  // MEASURED on this compiler: `std::string c;` warns, `std::string c = {};` does
  // not. The initialiser is what makes this change additive instead of a nine-file
  // edit, so do not "tidy" it away.
  std::string signature = {};
  // LAST, for the same two reasons `signature` is, and with the same default
  // member initialiser: every aggregate brace-initialiser in the tree that stops
  // short of it must keep compiling under -Werror -Wmissing-field-initializers.
  PickEvidence pick = {};

  bool valid() const noexcept { return kind != EntityKind::None && !bodyId.empty(); }
  std::string key() const;  // deterministic identity string, used for set membership
};

bool operator==(const EntityRef& a, const EntityRef& b) noexcept;
bool operator!=(const EntityRef& a, const EntityRef& b) noexcept;

// ── geometry for the dock model ─────────────────────────────────────────────
struct Rect {
  double x = 0.0, y = 0.0, w = 0.0, h = 0.0;

  double right() const noexcept { return x + w; }
  double bottom() const noexcept { return y + h; }
  bool empty() const noexcept { return w <= 0.0 || h <= 0.0; }
  bool contains(const Rect& r) const noexcept;
};

bool operator==(const Rect& a, const Rect& b) noexcept;
bool operator!=(const Rect& a, const Rect& b) noexcept;

using MonitorId = std::int32_t;
inline constexpr MonitorId kNoMonitor = -1;

struct MonitorInfo {
  MonitorId id = kNoMonitor;
  Rect workArea{};  // virtual-desktop coordinates
  bool primary = false;
  double dpiScale = 1.0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_TYPES_HPP
