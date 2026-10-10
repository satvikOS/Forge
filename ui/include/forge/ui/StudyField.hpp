// ui/include/forge/ui/StudyField.hpp
//
// WHAT A STUDY'S ANSWER LOOKS LIKE ON THE PART — the geometry a viewport draws
// for a mode shape or a temperature field, computed here, headless, so that what
// is drawn can be asserted rather than eyeballed.
//
// A frequency in a panel is a number; the mode shape is the part MOVING, and a
// user reads the second far faster than the first. But a drawing is also the
// easiest place to lie: an animation that wobbles looks like physics whether or
// not it is the solver's vector. So nothing here invents motion. The surface is
// the solver's OWN mesh (the bricks the study was solved on, not the smooth part
// the viewport shades), the displacement at every drawn point is the solver's own
// eigenvector at that mesh node, and the only number this file chooses is the
// AMPLITUDE -- which a mode shape does not have (an eigenvector is defined up to
// a scale) and which the panel therefore has to state in words as exaggerated.
//
// Nothing in this file includes ImGui, the geometry kernel or the solver.
#ifndef FORGE_UI_STUDYFIELD_HPP
#define FORGE_UI_STUDYFIELD_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::ui {

// ── the outside of the solver's mesh ────────────────────────────────────────
// The mesher returns 8-node bricks, each listed as its bottom face (z low) in
// counter-clockwise order seen from above, then the top face in the same order:
//     n0 (i,j,k)  n1 (i+1,j,k)  n2 (i+1,j+1,k)  n3 (i,j+1,k)   then +1 in k.
// A brick face is on the OUTSIDE of the part exactly when no other brick shares
// it, which is a count, not a geometric guess.
struct StudySurface {
  std::vector<double> nodesMm;          // 3 per mesh node, millimetres, document frame
  std::vector<std::uint32_t> quads;     // 4 per outside brick face, wound outward
  std::vector<std::uint32_t> edges;     // 2 per distinct edge of those faces
  // The subset of `edges` where the outside surface turns a corner: the two
  // outside faces meeting there are not coplanar. On a box-shaped part these are
  // the box's own twelve edges, cut at every mesh node along them -- the lines a
  // drawing of the part would have.
  std::vector<std::uint32_t> creases;

  std::size_t nodeCount() const noexcept { return nodesMm.size() / 3; }
  std::size_t quadCount() const noexcept { return quads.size() / 4; }
  std::size_t edgeCount() const noexcept { return edges.size() / 2; }
  std::size_t creaseCount() const noexcept { return creases.size() / 2; }
  bool empty() const noexcept { return quads.empty(); }
};

// Builds the outside of a brick mesh. `hexes` holds 8 node indices per brick in
// the order described above. An index past the node list makes the result empty
// rather than reading out of bounds.
StudySurface exteriorOfHexMesh(const std::vector<double>& nodesMm,
                               const std::vector<std::uint32_t>& hexes);

// ── a mode shape ────────────────────────────────────────────────────────────
// Scales an eigenvector (3 values per node) so the node that moves furthest
// moves exactly 1, and turns it so that node's largest component is positive.
// An eigenvector has no size and no sign of its own; fixing both here is what
// makes two runs of one study draw the same picture. Returns false (and leaves
// the vector alone) when it is empty, the wrong length, not finite, or zero.
bool normaliseModeShape(std::vector<double>& shape, std::size_t nodeCount,
                        std::uint32_t& peakNode);

// What a mode does, read off its own displacement field.
enum class ModeCharacter : std::uint8_t {
  Bending,     // the part swings sideways to its long axis
  Twisting,    // each cross-section turns about the long axis
  Stretching,  // the part stretches and shortens along its long axis
  Mixed,       // none of the three dominates
};

struct ModeMotion {
  // Fraction of the mode's squared displacement along x, y and z; sums to 1.
  double share[3] = {0.0, 0.0, 0.0};
  // Fraction of the mode's squared displacement that is each cross-section
  // turning RIGIDLY about the long axis (through the middle of the mesh's box),
  // each by its own angle: per slice of nodes at one position along the axis,
  // the best-fitting rotation explains (sum u.r)^2 / (sum r.r) of it, with r the
  // velocity of a unit rotation. Between 0 and 1. A cantilever's first torsion
  // mode, whose angle grows from nothing at the held end, scores close to 1;
  // bending and stretching score close to 0. The slices are the planes of the
  // brick mesh, so this reads a grid mesh as intended.
  double twist = 0.0;
  // The long axis (0 = x, 1 = y, 2 = z): the longest side of the mesh's box.
  int longAxis = 0;
  ModeCharacter character = ModeCharacter::Mixed;
  // For Bending: the sideways axis with the larger share; for Mixed, the axis
  // with the largest share; otherwise the long axis.
  int direction = 0;
  // For Bending: whether one sideways axis carries most of the motion. A part
  // with a square or round section bends at ONE frequency in both sideways
  // directions, and the solver may return any mixture of the two -- that pair
  // is described as bending along both axes, not forced onto one.
  bool singleDirection = false;

  // "bends along Z", "bends along Y and Z", "twists about X",
  // "stretches along X", "moves mostly along Y".
  std::string describe() const;
};

// The thresholds the classification uses, so a gate can state them.
inline constexpr double kModeTwistThreshold = 0.9;
inline constexpr double kModeShareThreshold = 0.8;

ModeMotion classifyModeMotion(const std::vector<double>& nodesMm,
                              const std::vector<double>& unitShape);

// How far the drawing moves the part's furthest-moving point, in millimetres,
// for a part whose longest side is `longestSideMm`. A tenth of that side: big
// enough to read, small enough not to turn the part inside out. The viewport
// must say it is exaggerated, because a natural mode has no real amplitude.
inline constexpr double kModeDisplayFraction = 0.1;
double modeDisplayAmplitudeMm(double longestSideMm) noexcept;

struct Segment3 {
  double a[3] = {0.0, 0.0, 0.0};
  double b[3] = {0.0, 0.0, 0.0};
};

// The outside edges of the mesh, each end moved by
//     amplitudeMm * sin(phaseRad) * shape(node).
// `creasesOnly` draws the corners of the outside surface instead of every brick
// edge. Empty when the shape does not match the surface.
std::vector<Segment3> modeShapeSegments(const StudySurface& surface,
                                        const std::vector<double>& unitShape,
                                        double amplitudeMm, double phaseRad,
                                        bool creasesOnly);

// ── a temperature field ─────────────────────────────────────────────────────
struct Rgb {
  float r = 0.0f;
  float g = 0.0f;
  float b = 0.0f;
};

// Blue at the coldest temperature, through white, to red at the hottest. A
// field with no spread at all is drawn white rather than divided by zero.
Rgb temperatureColour(double temperature, double coldest, double hottest) noexcept;

}  // namespace forge::ui

#endif  // FORGE_UI_STUDYFIELD_HPP
