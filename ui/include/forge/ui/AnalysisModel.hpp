// ui/include/forge/ui/AnalysisModel.hpp
//
// THE ANALYSIS DISPLAYS — section, draft, curvature / zebra, and wall thickness
// — as ARITHMETIC, so a headless gate can assert every number the viewport
// colours a face with.
//
// A shaded analysis display is the easiest thing in a CAD application to ship
// wrong and never notice: a draft display with the sign flipped still produces a
// confident red/green picture, and nothing about the picture says which. So the
// colouring is not the analysis. The analysis is here, it returns NUMBERS, and
// the renderer is a consumer that maps a number to a colour. Nothing in this
// file includes ImGui, OCCT or a forge-kernel header.
//
// ── what each one is FOR, and what it can honestly say ─────────────────────
//   SECTION    a plane through the solid, the cut polyline, and the area of the
//              cut. Answers "what does the inside look like here", and the AREA
//              is the number a stress calculation actually needs.
//   DRAFT      the angle between each face and the plane perpendicular to a
//              pull direction. Answers "can this part come out of the mould",
//              and the actionable class is INSUFFICIENT — a wall that is nearly
//              but not quite drafted, which no picture distinguishes from one
//              that is.
//   CURVATURE  a per-face radius estimate from the mesh's own dihedral angles,
//              plus the FACE-PAIR continuity census that zebra striping exists
//              to reveal. A zebra display shows a tangency break; this reports
//              the break's angle, which is the thing you can act on.
//   THICKNESS  a ray from each sample point, into the material, to the far wall.
//              Answers "is this rib mouldable / printable".
//
// ── the cost is measured, never assumed ────────────────────────────────────
// Thickness casts rays against the whole mesh, and the target part is 329-430
// faces of tessellated B-rep. A brute-force cast is O(triangles) per ray, and on
// that part it is not usable interactively, so this file carries a uniform-grid
// ray index. The index is not trusted on its own: ui/test/analysis_model_test.cpp
// asserts it returns the SAME hit as the brute-force scan for every ray in a
// fixture — a positive control, because an accelerator that silently misses is
// indistinguishable from a part with no far wall.
#ifndef FORGE_UI_ANALYSISMODEL_HPP
#define FORGE_UI_ANALYSISMODEL_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/MeasureModel.hpp"

namespace forge::ui {

// ── ray casting ─────────────────────────────────────────────────────────────
struct RayHit {
  bool hit = false;
  double distance = 0.0;  // along `direction`, which need not be unit length
  double point[3] = {0.0, 0.0, 0.0};
  double normal[3] = {0.0, 0.0, 0.0};  // the hit triangle's geometric normal
  std::uint32_t faceId = 0;
  std::size_t triangle = 0;
};

// Nearest intersection with any triangle, scanning them all. The reference
// implementation: obviously correct, and the thing the index below is proved
// against. `minDistance` skips the surface a ray was launched FROM — without it
// every self-cast returns a hit at zero.
RayHit rayMeshHitBruteForce(const MeasureMesh& mesh, const double origin[3],
                            const double direction[3], double minDistance,
                            double maxDistance);

// A uniform grid over the mesh's bounding box, traversed by 3D DDA. Build once,
// cast many. `cells()` reports the resolution actually chosen, so a caller can
// see whether the index degenerated to one cell (which it does, deliberately,
// for a mesh too small to be worth indexing).
class MeshRayIndex {
 public:
  MeshRayIndex() = default;
  explicit MeshRayIndex(const MeshRayIndex&) = delete;
  MeshRayIndex& operator=(const MeshRayIndex&) = delete;
  MeshRayIndex(MeshRayIndex&&) = default;
  MeshRayIndex& operator=(MeshRayIndex&&) = default;

  // `targetPerCell` is the average triangle count a cell should hold. Building
  // over an empty mesh leaves the index unbuilt, and cast() then reports no hit
  // rather than reading out of bounds.
  void build(const MeasureMesh& mesh, double targetPerCell = 4.0);
  bool built() const noexcept { return built_; }
  std::size_t cells(std::size_t axis) const noexcept {
    return axis < 3 ? dims_[axis] : 0;
  }
  std::size_t cellCount() const noexcept { return dims_[0] * dims_[1] * dims_[2]; }
  // How many triangle tests the last cast performed — the cost, measured. A
  // grid that visits every triangle is a grid that is not helping, and this is
  // how a gate says so instead of a comment claiming it.
  std::size_t lastTriangleTests() const noexcept { return lastTests_; }

  RayHit cast(const MeasureMesh& mesh, const double origin[3], const double direction[3],
              double minDistance, double maxDistance) const;

 private:
  bool built_ = false;
  std::size_t dims_[3] = {0, 0, 0};
  double origin_[3] = {0.0, 0.0, 0.0};
  double cell_[3] = {1.0, 1.0, 1.0};
  std::vector<std::size_t> cellStart_;  // cellCount()+1 prefix offsets
  std::vector<std::size_t> items_;      // triangle indices, bucketed
  mutable std::size_t lastTests_ = 0;
};

// ── SECTION ─────────────────────────────────────────────────────────────────
// The plane is n . x = offset. `normal` need not be unit length; it is
// normalized on entry, and a zero-length normal is refused (measured=false)
// rather than producing a section of everything.
struct SectionPlane {
  double normal[3] = {0.0, 0.0, 1.0};
  double offset = 0.0;

  // The plane through `point` with this normal — how a UI actually places one:
  // drag a handle to a point on the part.
  static SectionPlane through(const double point[3], const double normal[3]);
};

struct SectionResult {
  bool measured = false;
  std::size_t segments = 0;
  // 6 doubles per segment: ax ay az bx by bz — the polyline the viewport draws.
  std::vector<double> points;
  std::size_t loops = 0;     // closed chains recovered from those segments
  std::size_t openChains = 0;  // chains that did NOT close — reported, not hidden
  double perimeter = 0.0;
  // In-plane area enclosed by the CLOSED loops. Signed contributions are summed
  // before the absolute value is taken, so an inner loop (a bore) SUBTRACTS from
  // an outer one — a sectioned tube reports its annulus, not its outside disc.
  double area = 0.0;
  std::size_t trianglesAbove = 0;  // wholly on the +n side
  std::size_t trianglesBelow = 0;
  std::size_t trianglesCut = 0;
  MeasureBox box{};  // of the cut geometry
};

SectionResult sectionMesh(const MeasureMesh& mesh, const SectionPlane& plane);

// ── DRAFT ───────────────────────────────────────────────────────────────────
// The draft angle of a face is asin(n . pull) in degrees, so it runs -90..+90:
//   +90  the face looks straight along the pull (a top face)
//     0  the face is PARALLEL to the pull (a vertical wall — zero draft)
//   -90  the face looks straight against the pull (a bottom face)
// The actionable class is Insufficient: |angle| < required. A picture cannot
// distinguish 0.4 degrees of draft from 3, and 0.4 is a part that sticks.
enum class DraftClass : std::uint8_t {
  Positive,      // angle >= required — pulls clean toward +pull
  Negative,      // angle <= -required — pulls clean toward -pull
  Insufficient,  // |angle| < required — THE problem
  Degenerate,    // no usable normal (a sliver face)
};

const char* toString(DraftClass cls) noexcept;

struct FaceDraft {
  std::uint32_t faceId = 0;
  double angleDegrees = 0.0;
  DraftClass cls = DraftClass::Degenerate;
  double area = 0.0;
  // Every triangle of the face agrees with the face's own class. False on a
  // curved face that straddles the requirement, which is exactly the face a
  // per-FACE colour would mislabel — a cylinder wall drafted at one end and not
  // the other.
  bool uniform = true;
  double minTriangleAngle = 0.0;
  double maxTriangleAngle = 0.0;
};

struct DraftAnalysis {
  bool measured = false;
  double pull[3] = {0.0, 0.0, 1.0};
  double requiredDegrees = 0.0;
  std::vector<FaceDraft> faces;
  std::size_t countPositive = 0;
  std::size_t countNegative = 0;
  std::size_t countInsufficient = 0;
  std::size_t countDegenerate = 0;
  double areaPositive = 0.0;
  double areaNegative = 0.0;
  double areaInsufficient = 0.0;
  // The worst offender: the insufficient face with the LARGEST area, because
  // that is the one worth fixing first. kNoFace when there is none.
  std::uint32_t worstFace = 0;
};

inline constexpr std::uint32_t kNoFace = 0;

DraftAnalysis draftAnalysis(const MeasureMesh& mesh, const double pull[3],
                            double requiredDegrees);

// ── CURVATURE / ZEBRA ───────────────────────────────────────────────────────
struct FaceCurvature {
  std::uint32_t faceId = 0;
  std::size_t interiorEdges = 0;  // segments shared by two triangles OF THIS FACE
  double area = 0.0;
  // Mesh statistics. Both DEPEND ON THE TESSELLATION — a cylinder at 32
  // segments bends 11.25 degrees per seam and at 64 segments 5.6 — so they are
  // named as dihedrals, never as curvature. They are still worth reporting: the
  // maximum dihedral is what a facet-shaded viewport actually shows.
  double meanDihedralDegrees = 0.0;
  double maxDihedralDegrees = 0.0;

  // ── the geometry, and it is tessellation-INDEPENDENT ──────────────────────
  // Cohen-Steiner & Morvan, "Restricted Delaunay triangulations and normal
  // cycle" (SoCG 2003): the integrated mean curvature over a mesh region is
  // (1/2) * sum over interior edges of beta(e) * |e|, with beta the dihedral
  // angle. So the area-averaged mean curvature is
  //     H = sum(beta * |e|) / (2 * area).
  // The first implementation here used R ~ L/theta over triangle CENTROIDS
  // instead, and it was measurably wrong: on a 32-segment cylinder of radius 10
  // it returned 34.6, because the centroid separation of two triangles across a
  // vertical seam is dominated by the AXIAL offset of the strip split, which has
  // nothing to do with the curvature. The formula below returns 9.98 on the same
  // mesh, and 9.99 at 64 segments — it does not move with the tessellation.
  bool hasCurvature = false;
  double meanCurvature = 0.0;  // 1/mm

  // 1 / (2H). STATED PRECISELY because mean curvature averages the two principal
  // curvatures and one of a cylinder's is zero:
  //     a CYLINDRICAL face of radius R  ->  curvatureRadius == R
  //     a SPHERICAL   face of radius R  ->  curvatureRadius == R / 2
  // Both cases are pinned by ui/test/analysis_model_test.cpp. A caller that
  // needs "the radius of this hole" should measure the rim with
  // forge::ui::fitCircle, which answers that question directly.
  double curvatureRadius = 0.0;

  bool planar = false;  // every dihedral below kMeasureAngleTolerance
};

// The continuity between two adjacent faces — what a zebra display is looking
// for. A tangent (G1) join shows continuous stripes; a break shows a kink, and
// `angleDegrees` is the size of that kink.
struct FaceContinuity {
  std::uint32_t faceA = 0;  // the LOWER face id
  std::uint32_t faceB = 0;
  std::size_t segments = 0;
  double maxAngleDegrees = 0.0;
  double meanAngleDegrees = 0.0;
  bool tangent = false;  // maxAngleDegrees <= tangentToleranceDegrees
};

struct CurvatureAnalysis {
  bool measured = false;
  std::vector<FaceCurvature> faces;
  std::vector<FaceContinuity> joins;  // ordered by (faceA, faceB)
  double tangentToleranceDegrees = 0.0;
  std::size_t tangentJoins = 0;
  std::size_t sharpJoins = 0;
  double sharpestJoinDegrees = 0.0;
};

CurvatureAnalysis curvatureAnalysis(const MeasureMesh& mesh,
                                    double tangentToleranceDegrees = 5.0);

// The scalar a zebra shader bands. `viewDir` is the direction from the surface
// toward the eye. The value is the elevation of the REFLECTED view vector, in
// turns [0, 1), times `stripes` — so the integer part is the stripe index and
// its discontinuity across an edge is what the eye reads as a tangency break.
// Kept here, not in a shader, so the stripe a viewport draws is a number a gate
// can assert.
double zebraValue(const double normal[3], const double viewDir[3], double stripes);

// ── THICKNESS ───────────────────────────────────────────────────────────────
struct FaceThickness {
  std::uint32_t faceId = 0;
  std::size_t samples = 0;   // rays cast on this face
  std::size_t hits = 0;      // rays that found a far wall
  double minThickness = 0.0;
  double maxThickness = 0.0;
  double meanThickness = 0.0;
  double minPoint[3] = {0.0, 0.0, 0.0};  // where the thinnest sample was taken
};

struct ThicknessAnalysis {
  bool measured = false;
  std::vector<FaceThickness> faces;
  std::size_t samplesRequested = 0;
  std::size_t samplesTaken = 0;
  std::size_t rayHits = 0;
  double minThickness = 0.0;
  std::uint32_t minFace = kNoFace;
  double minPoint[3] = {0.0, 0.0, 0.0};
  // Faces where NO sample found a far wall. Not an error: an outer wall of an
  // open shell genuinely has none. Named so a zero thickness is never invented
  // for one.
  std::size_t facesWithoutHits = 0;
};

// `samplesPerFace` rays per face, taken at triangle centroids spread evenly
// through the face's triangle list. The budget is per FACE and the totals are
// reported, because "it ran" and "it measured the part" are different claims.
ThicknessAnalysis thicknessAnalysis(const MeasureMesh& mesh, std::size_t samplesPerFace = 8);

// ── export ──────────────────────────────────────────────────────────────────
std::string analysisText(const SectionResult& section);
std::string analysisText(const DraftAnalysis& draft);
std::string analysisText(const CurvatureAnalysis& curvature);
std::string analysisText(const ThicknessAnalysis& thickness);

// One row per face, for the clipboard / a spreadsheet.
std::string draftCsv(const DraftAnalysis& draft);
std::string thicknessCsv(const ThicknessAnalysis& thickness);

}  // namespace forge::ui

#endif  // FORGE_UI_ANALYSISMODEL_HPP
