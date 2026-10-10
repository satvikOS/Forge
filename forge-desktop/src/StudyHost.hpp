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

#include <cstddef>
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

// Runs the study the definition asks for -- Static, Modal or Thermal, picked by
// `request.study.kind` -- through ONE pipeline: the same compile of the
// document's own history, the same mesher, the same per-side node sets; only
// the solve and what is read off it differ. Returns the outcome; `solved` says
// whether it answered. On any refusal the outcome carries a sentence in
// `blocker` written for the person reading the panel, and the technical cause --
// if there is one worth keeping -- is appended to `detail` for the activity log.
// NEVER throws: a modelling failure inside the kernel is a result to report, not
// a crash to take the application down with.
//
// ── MODAL ───────────────────────────────────────────────────────────────────
// The restraints become fixed node sets exactly as for Static; forces are not
// used (a natural frequency does not depend on what pushes on the part). The
// kernel's solveModal returns omega^2 for the lowest `modeCount` modes of
// K phi = omega^2 M phi with the CONSISTENT mass; each becomes
// f = sqrt(omega^2) / 2 pi and a shape scaled so its furthest node moves 1.
//
// ── THERMAL ─────────────────────────────────────────────────────────────────
// Every node on a held side is given that side's temperature (where two held
// sides meet, the one listed FIRST keeps the shared nodes, and they are
// counted). Heat generated is spread evenly through the MESHED volume, so the
// watts assembled are exactly the watts asked for. After the kernel's
// solveThermal, the heat through each held side is read off the nodal
// reactions r = K T - f, with K rebuilt element by element from the kernel's
// own element matrix (ScalarElliptic.hpp) -- so heat in, heat out and heat
// generated can be shown to balance rather than asserted to. There is no
// convection (film coefficient) boundary yet, on purpose: the kernel's Robin
// term shares the bounding-box face area equally over a side's nodes, which
// MEASURED 1.0 K off the closed form on a box bar and 6.6 K off on an
// L-section (ledger task T-393). It is offered once that is fixed.
forge::ui::StudyOutcome runStudy(const StudyRequest& request, std::string& detail);

// The element size the mesher will be asked for, in millimetres, given a part
// that spans `longestSideMm` and a division count. Exposed because the panel
// shows it before the study runs and the gate pins the two equal.
double studyElementSizeMm(double longestSideMm, int divisions) noexcept;

// How many voxels the mesher would have to classify. The panel refuses a study
// that would take minutes rather than starting one and freezing.
inline constexpr std::size_t kMaxStudyCells = 200000;
// ── how big a Modal or Thermal study may be, MEASURED ───────────────────────
// A study runs on the thread that draws the window, so its length is a freeze.
// The limits below are set from the WORST shape measured on this tree
// (origin/archdisc b609b41d, Release, M-series Mac Studio; T-340 evidence
// *_size_probe.log): a solid cube, whose cross-section is as large as its length
// and so fills in the sparse factorisation the most. Slender parts solve far
// faster at the same count.
//
//   Modal, cube 100 mm:   1000 cells 0.43 s, 2744 cells 4.5 s, 5832 cells 16.8 s,
//                         10648 cells 69 s, 19683 cells 302 s (6.8 GB resident).
//   Thermal, cube 100 mm: 1000 cells 0.011 s, 8000 cells 1.17 s,
//                         27000 cells 23.7 s, 64000 cells 231 s.
//
// So a Modal study is refused above 3000 cells and a Thermal one above 12000:
// about five seconds at the worst measured shape (largest admitted cube,
// measured: thermal 10648 cells 1.9 s, modal 2744 cells 2.5-4.5 s). The Static
// study keeps kMaxStudyCells above; that it admits a cube a static solve needs
// 25.8 s for at 8000 cells is ledger task T-391, not changed here. Moving every
// study off this thread is T-394.
inline constexpr std::size_t kMaxModalCells = 3000;
inline constexpr std::size_t kMaxThermalCells = 12000;

// ── the modal sizes the kernel solves slowly ────────────────────────────────
// forge::fea::solveModal picks its eigensolver by the TOTAL number of freedoms:
// at or below kKernelDenseModalDof (its private kDenseModalCap, in
// forge-kernel/src/Fea.cpp -- pinned equal by forge_desktop_study_gate, which
// reads that file) it runs a dense generalised eigensolver whose time grows with
// the cube of the size; above it, a sparse shift-invert Lanczos. MEASURED on the
// cantilever and on the app's own starting part:
//
//   132 freedoms 6 ms | 567: 0.9-2.0 s | 819: 3.1 s | 1248: 25.9 s |
//   1392 (the starting part at the default 12 across): 20.7 s | 1488: 27.8 s ||
//   1680 freedoms, sparse: 17 ms | 3075: 41 ms
//
// A Modal study whose mesh lands between kModalQuickDenseDof and the kernel's
// cap is therefore REFUSED with the nearest element count that leaves the band,
// rather than started. The fix belongs in the kernel (ledger task T-390); when
// it lands, this band goes and the gate's pin on the cap moves with it.
inline constexpr std::size_t kKernelDenseModalDof = 1500;
inline constexpr std::size_t kModalQuickDenseDof = 450;

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_STUDYHOST_HPP
