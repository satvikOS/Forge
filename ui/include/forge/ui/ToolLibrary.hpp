// ui/include/forge/ui/ToolLibrary.hpp
//
// THE CUTTERS THIS PART CALLS FOR — the Manufacturing workspace's Tools tab.
//
// ── the defect this file exists for, and the honest half of it ─────────────
// The Tools tab had a name, a sentence and no content. The sentence promised
// "the cutting tools available for this setup, with their diameters, flute
// counts and holders", and TWO THIRDS OF THAT PROMISE CANNOT BE KEPT from
// anything in this repository. A flute count and a holder are properties of a
// physical tool in a particular workshop's crib; nothing in a part document, a
// feature tree or a kernel measurement knows them, and a panel that printed
// three would be inventing two.
//
// What the document DOES know is the half that decides the job: every cut names
// the size of the cutter it needs, and that arithmetic is already done --
// forge/ui/WorkspaceTrees.hpp turns each material-removal statement into an
// operation carrying the diameter it calls for and the depth it must reach. A
// drill is the hole's diameter. A boring head is twice the bore's radius. An
// internal corner of radius r is cut by a tool of diameter 2r, which is the
// single number that limits a milling job. A counterbore calls for two cutters,
// and its statement carries both.
//
// So this file answers the question the tab is actually for -- WHICH CUTTERS DO
// I NEED AND HOW DEEP MUST THEY REACH -- and the panel says plainly that the
// flute count and the holder come from the shop's own crib. The catalogue
// sentence was corrected to match, because a promise a panel cannot keep is the
// same defect as an empty tab wearing a different hat.
//
// Everything here is arithmetic over MachiningPlan, which is itself read from
// the document. Nothing includes a drawing header or a kernel header, so every
// number a panel prints is asserted by ui/test/tool_library_test.cpp.
#ifndef FORGE_UI_TOOLLIBRARY_HPP
#define FORGE_UI_TOOLLIBRARY_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/WorkspaceTrees.hpp"

namespace forge::ui {

// What kind of cutter a statement calls for. Each one is decided by the
// operation's own kind, never guessed from a diameter.
enum class CutterKind : std::uint8_t {
  Drill,        // a hole, and the pilot of a counterbore
  EndMill,      // an internal corner radius, and the flat of a counterbore
  BoringHead,   // a bore opened to size
  ChamferTool,  // an edge break: any chamfer cutter will do, so it names no size
  Unsized,      // the cut names no cutter at all -- a boolean, or a shell wall
};

const char* cutterWord(CutterKind kind) noexcept;

struct RequiredTool {
  CutterKind kind = CutterKind::Drill;
  double diameterMm = 0.0;
  bool diameterKnown = false;
  // The deepest an operation using this cutter must reach. `depthKnown` is FALSE
  // when every cut it makes goes RIGHT THROUGH: the statement gives no depth
  // then, and the reach a tool needs is the part's thickness along that axis,
  // which is not a fact about the cut. Saying "0 mm deep" there would be a
  // number where there is no measurement.
  double deepestCutMm = 0.0;
  bool depthKnown = false;
  bool cutsThrough = false;
  // The name a person would call it: "10 mm drill", "6 mm end mill". Built from
  // the number the document carries.
  std::string name;
  // Which operations need it -- indices into MachiningPlan::operations, in the
  // order the machine runs them.
  std::vector<std::size_t> operations;

  std::size_t uses() const noexcept { return operations.size(); }
};

struct ToolList {
  // Smallest first, and the unsized ones last: the smallest cutter is what
  // limits the job, so it belongs at the top of the list.
  std::vector<RequiredTool> tools;
  // Operations naming no cutter at all -- a boolean cut by another body, a
  // shell. Counted rather than dropped, so a short list reads as a fact about
  // the model and not as a panel that lost some.
  std::size_t operationsWithNoCutter = 0;
  std::size_t sizedTools = 0;
  double smallestMm = 0.0;
  bool smallestKnown = false;
  double largestMm = 0.0;
  bool largestKnown = false;
  double deepestMm = 0.0;
  bool deepestKnown = false;
  // FALSE when the model has nothing to cut. Not an error: a part built entirely
  // by adding material calls for no cutters, and saying so is the honest answer.
  bool known = false;

  std::size_t rowCount() const noexcept { return tools.size(); }
};

ToolList buildToolList(const MachiningPlan& plan);

}  // namespace forge::ui

#endif  // FORGE_UI_TOOLLIBRARY_HPP
