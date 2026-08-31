// ui/include/forge/ui/SketchProfile.hpp
//
// THE BRIDGE — a solved sketch becomes a value the existing ops consume, or the
// whole sketcher is decorative.
//
// ── what it produces, and why those two ops ─────────────────────────────────
// The kernel's IR has exactly six PROFILE producers (RECT, RRECT, CIRCLE, SLOT,
// POLY, REGPOLY) and two WIRE producers (RING, WIRE). Five of the six profile
// ops are PARAMETRIC SHAPES — a rectangle, a slot, an n-gon — and a solved
// sketch is not one of those; it is an arbitrary closed loop of lines and arcs.
// The only two statements in the whole op table that can carry an arbitrary loop
// are:
//
//     POLY([x y; x y; ...])       -> PROFILE, consumed by EXTRUDE and REVOLVE
//     WIRE([x y z; x y z; ...])   -> WIRE,    consumed by LOFT
//
// So the plane decides the op, and it is not a preference: POLY's points are
// read as Z = 0 WORLD coordinates (`forge::ft` builds it through the Z=0
// sketcher), so a sketch on the world XY plane emits POLY and a sketch on any
// other plane emits WIRE, whose points are world-space and carry the plane with
// them. Emitting POLY for a sketch on the front plane would silently lay the
// profile flat — a statement the kernel accepts and a solid nobody drew.
//
// One shape is recognised exactly rather than tessellated: a sketch whose only
// non-construction entity is a circle emits CIRCLE(r, cx, cy). A 24-gon that is
// 99.7% of a circle is not a circle, and every revolve, bore and boss in the
// target parts starts from one.
//
// ── DIAGNOSE, NEVER REFUSE ──────────────────────────────────────────────────
// `extractSketchProfile` never returns nothing when there is something to
// return. An open chain reports WHICH endpoint is unmatched; a branching vertex
// reports WHERE; a sketch with two loops returns the first loop AND says there
// are more. `emitSketchProfile` emits the statement whenever it has three
// points, and carries the profile's own complaint alongside it, because a
// profile a repair loop can see is worth more than a refusal it cannot act on.
#ifndef FORGE_UI_SKETCHPROFILE_HPP
#define FORGE_UI_SKETCHPROFILE_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/Sketch.hpp"

namespace forge::ui {

enum class SketchProfileStatus : std::uint8_t {
  Ok = 0,
  NoGeometry,        // nothing but construction geometry and points
  NotClosed,         // the chain has a loose end; `detail` names the entity
  Branching,         // three or more curve ends meet at one point
  MultipleLoops,     // the returned ring closed, and curves were left over
  Degenerate,        // fewer than three distinct points, or zero enclosed area
  SelfIntersecting,  // the ring crosses itself; still returned
  Unsupported,       // an entity kind that cannot bound a region
};

const char* toString(SketchProfileStatus status) noexcept;

struct SketchProfile {
  SketchProfileStatus status = SketchProfileStatus::NoGeometry;
  // (u, v) pairs in the sketch plane, counter-clockwise, NOT repeating the first
  // point at the end — that is how both POLY and WIRE want a ring.
  std::vector<double> ring;
  std::vector<int> entities;  // the curves the ring walked, in walk order
  bool closed = false;
  double area = 0.0;          // signed before the CCW flip, |area| after
  std::string detail;

  std::size_t points() const noexcept { return ring.size() / 2; }
};

struct SketchProfileOptions {
  // Points per arc / per full circle or ellipse. 24 is not a magic number: it is
  // the tessellation the ring shares with the kernel's own RING default of 48
  // halved for an arc's typical quarter-turn, and every gate that checks an area
  // states its own tolerance against the chord error this implies.
  std::size_t arcSegments = 24;
  // Two curve ends closer than this are the same vertex. Millimetres.
  double tolerance = 1e-6;
};

SketchProfile extractSketchProfile(const Sketch& sketch,
                                   const SketchProfileOptions& options = SketchProfileOptions{});

enum class SketchEmitStatus : std::uint8_t {
  Ok = 0,
  NoProfile,          // nothing to emit: fewer than three ring points
  InvalidStatement,   // the statement failed validateIr(); `check` says which rule
};

const char* toString(SketchEmitStatus status) noexcept;

struct SketchEmission {
  SketchEmitStatus status = SketchEmitStatus::NoProfile;
  IrLine line{};
  IrValueKind produces = IrValueKind::None;
  IrCheck check = IrCheck::Ok;
  SketchProfileStatus profile = SketchProfileStatus::NoGeometry;
  std::string detail;

  bool ok() const noexcept { return status == SketchEmitStatus::Ok; }
};

// `statementId` is the 1-based creation id the statement will hold. It must be
// the document's next id; the emission is validated against it here so a caller
// never appends a statement the document is going to refuse.
SketchEmission emitSketchProfile(const Sketch& sketch, int statementId,
                                 const SketchProfileOptions& options = SketchProfileOptions{});

// Put the emitted value INTO a part document under `nodeId`, so a selection can
// name it and `part.extrude` / `part.revolve` / `part.loft` can consume it.
//
// It goes in through PartDocument::seed, which is the documented seam for "a
// sketch authored in the Sketch workspace" — the value exists before any Part
// command ran, and binding it to a node id is what makes the sketch SELECTABLE.
// Returns the statement id, or 0 when nothing was emitted (the document is
// untouched in that case).
int seedSketchProfile(PartDocument& document, const Sketch& sketch, const std::string& nodeId,
                      const SketchProfileOptions& options = SketchProfileOptions{});

}  // namespace forge::ui

#endif  // FORGE_UI_SKETCHPROFILE_HPP
