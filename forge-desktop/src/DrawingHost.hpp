// forge-desktop/src/DrawingHost.hpp
//
// THE SEAM BETWEEN THE DRAWING SHEET AND THE KERNEL'S HIDDEN-LINE REMOVER (T-230).
//
// forge::ui lays the sheet out and writes the file; it includes no kernel header.
// This translation unit is the one that compiles the document's own feature
// history and asks forge::native::brep::hiddenLineRemoval -- the native analytic
// HLR the kernel switched to when libTKHLR was dropped -- for each view's visible
// and hidden edge spans. Same split, and the same reason, as StudyHost and
// FileExchangeHost: the ImGui frame builder still reaches no kernel header.
//
// ── what is real here ───────────────────────────────────────────────────────
// The program compiled is the document's irProgram(), the text the viewport is
// built from, so the drawing is of the part on screen by construction and never
// of a cached body. Each view's polylines are re-projected onto the SAME
// forge::ui::drawingViewAxes() the View List prints, so the file and the panel
// agree about which way is right and up on every view. A body the native HLR
// cannot take (the importer defers on a face kind, or the solid is degenerate)
// is REFUSED with a sentence; a view is never fabricated.
//
// NEVER THROWS: every kernel call is wrapped, and a failure is a result.
#ifndef FORGE_DESKTOP_DRAWINGHOST_HPP
#define FORGE_DESKTOP_DRAWINGHOST_HPP

#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/DrawingExport.hpp"
#include "forge/ui/Types.hpp"

namespace forge::desktop {

struct DrawingProjectionRequest {
  std::string irProgram;
  std::string inputFile;  // backs INPUT(), "" for a document with no file bound
  std::vector<forge::ui::NamedView> views;
};

struct DrawingProjectionResult {
  bool ok = false;
  std::string blocker;  // a sentence for the user when !ok
  std::string detail;   // the technical cause, for the activity log
  std::vector<forge::ui::DrawingViewLines> views;
  // The compiled body's own bounding box (forge::ft::compile's), an oracle
  // independent of both the HLR and the display tessellation.
  double bboxMin[3] = {0.0, 0.0, 0.0};
  double bboxMax[3] = {0.0, 0.0, 0.0};
  std::size_t edgesClassified = 0;
  // The two HLR densities this body was drawn at, chosen from the body itself
  // (see hlrOptionsFor in DrawingHost.cpp): curved-face tessellation 4..48 and
  // samples per edge (1 when no edge has a curve). 0 when nothing was drawn.
  std::size_t curveTess = 0;
  std::size_t samplesPerEdge = 0;
  // Where the time went, for the activity log: this all runs on the thread that
  // dispatched the command. Wall-clock milliseconds; 0 for a phase not reached.
  double compileMs = 0.0;
  double importMs = 0.0;   // importOcctSolid, and nothing else
  double viewsMs = 0.0;    // tessellation choice + every view's HLR + tidying
  std::size_t nativeFaces = 0;
};

// Compiles `request.irProgram` and projects every requested view. Fills each
// view's extent from its own lines. Never throws.
DrawingProjectionResult projectDrawingViews(const DrawingProjectionRequest& request);

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_DRAWINGHOST_HPP
