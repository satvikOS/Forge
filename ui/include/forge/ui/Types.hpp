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
#include <string>

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

// A stable, rebuild-surviving reference to one topological entity.
//   bodyId          — persistent body/document-node identity
//   kind            — what sort of entity this names
//   persistentName  — the L4 TAG/@name style persistent label (survives index
//                     permutation); empty only for whole-body references
//   generation      — bumped by the modeller when the entity is re-resolved,
//                     so the UI can report a stale reference honestly
struct EntityRef {
  std::string bodyId;
  EntityKind kind = EntityKind::None;
  std::string persistentName;
  std::uint64_t generation = 0;

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
