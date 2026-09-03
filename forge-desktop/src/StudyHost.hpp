// forge-desktop/src/StudyHost.hpp
//
// THE SEAM BETWEEN THE SIMULATION PANELS AND THE SOLVER.
//
// The third and last translation unit in this application that may see a kernel
// header, and the reason it is its own file rather than another method on
// KernelScene is the reason FileExchangeHost is its own file: a study solves
// physics, owns no scene and draws nothing, and folding it into the viewport
// would make the thing that draws triangles also own a stiffness matrix. The
// property that matters is unchanged — the ImGui frame builder still reaches no
// kernel header, and every headless gate still links what it needs and no more.
//
// ── WHAT IS REAL HERE, AND WHAT WOULD BE A LIE ──────────────────────────────
// Every field of the StudyOutcome this fills comes from a call: the mesh's node
// and element counts are counted off the mesh the mesher returned, the per-side
// node counts are counted off that mesh's own per-node side bitfield, the
// residual, the peak stress and the peak displacement come out of the solved
// system, and the elapsed time is measured around the solve. Nothing is
// estimated and nothing is defaulted. Where the chain cannot produce an answer
// — no material, no restraint, a mesh with no elements in it — the outcome
// carries a sentence saying so and `solved` stays false.
//
// ── UNITS ───────────────────────────────────────────────────────────────────
// The document, the viewport and the mesher all work in millimetres. The solver
// is SI throughout: metres, newtons, pascals, kilograms. The node coordinates
// are therefore scaled by 1e-3 between the two — an exact similarity transform
// of the mesh, which leaves the connectivity and the side bitfield untouched —
// and the answers are scaled back for display. Getting this wrong is a factor of
// a thousand in the stiffness, which is precisely why the gate checks the
// deflection against a beam formula rather than only checking that a number came
// out.
#ifndef FORGE_DESKTOP_STUDYHOST_HPP
#define FORGE_DESKTOP_STUDYHOST_HPP

#include <string>

#include "forge/ui/StudyModel.hpp"

namespace forge::desktop {

// What the solver is asked. `irProgram` is the document's OWN feature history —
// the same text the viewport was built from — so the part that is tested is by
// construction the part on screen.
struct StudyRequest {
  std::string irProgram;
  std::string inputFile;  // backs INPUT(), "" for a document with no file bound
  forge::ui::StudyDefinition study;
};

// Runs the study. Returns `outcome.solved`. On any refusal the outcome carries a
// sentence in `blocker` written for the person reading the panel, and the
// technical cause — if there is one worth keeping — is appended to `detail` for
// the activity log. NEVER throws: a modelling failure inside the kernel is a
// result to report, not a crash to take the application down with.
forge::ui::StudyOutcome runStudy(const StudyRequest& request, std::string& detail);

// The element size the mesher will be asked for, in millimetres, given a part
// that spans `longestSideMm` and a division count. Exposed because the panel
// shows it before the study runs and the gate pins the two equal.
double studyElementSizeMm(double longestSideMm, int divisions) noexcept;

// How many voxels the mesher would have to classify. The panel refuses a study
// that would take minutes rather than starting one and freezing.
inline constexpr std::size_t kMaxStudyCells = 200000;

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_STUDYHOST_HPP
