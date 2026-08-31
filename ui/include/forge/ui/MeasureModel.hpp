// ui/include/forge/ui/MeasureModel.hpp
//
// THE MEASURE PANEL'S MODEL — what a CAD Measure tool actually reports, computed
// from the tessellation the viewport is already drawing and the faces the typed
// selection service already holds.
//
// It is here, and not in forge-desktop, for the same reason the command registry
// and the dock tree are here: measurement is arithmetic, not drawing, and a
// number a UI prints is only trustworthy if something headless can assert it.
// Nothing in this file includes ImGui, OCCT or a forge-kernel header — the frame
// builder feeds it a triangle soup and prints what comes back.
//
// ── what "watertight" means here, and why the volume is gated on it ─────────
// A surface mesh has a volume only if it CLOSES. Summing signed tetrahedra over
// an open or inconsistently-wound mesh returns a number, and that number is
// meaningless — which is the failure mode this module exists to refuse. So the
// edge topology is checked first: every undirected edge must be used exactly
// twice, once in each direction, and `volume` is reported only when it is. An
// open mesh reports its boundary-edge count instead of a fabricated volume.
// (Recorded in MEMORY as "Volume cannot validate geometry": a single scalar that
// looks plausible is exactly how a wrong solid passes unnoticed.)
//
// Vertices are welded on a quantized key rather than by exact float equality:
// the incoming stream is de-indexed float32, so two references to one B-rep
// vertex agree only to float precision, and exact comparison would report every
// interior edge as a boundary. The weld is a BUCKET SNAP, and its known limit is
// stated rather than hidden: two vertices that straddle a bucket boundary stay
// distinct however close they are. That is tolerable here only because a real
// tessellation emits the SAME float for one B-rep vertex, so the snap is a
// safety net for accumulated noise and not the mechanism the closure depends on.
#ifndef FORGE_UI_MEASUREMODEL_HPP
#define FORGE_UI_MEASUREMODEL_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::ui {

// Vertex weld quantum, in model units (mm). Chosen above float32's ~1e-5 mm
// resolution at an 80 mm part, and far below any tessellation edge length.
inline constexpr double kMeasureWeldTolerance = 1.0e-4;

// Two faces count as parallel / perpendicular within this many degrees.
inline constexpr double kMeasureAngleTolerance = 0.5;

// ── an axis-aligned box ─────────────────────────────────────────────────────
struct MeasureBox {
  double min[3] = {0.0, 0.0, 0.0};
  double max[3] = {0.0, 0.0, 0.0};
  bool valid = false;

  double size(std::size_t axis) const noexcept;
  double diagonal() const noexcept;
  void centre(double out[3]) const noexcept;
  void grow(const double p[3]) noexcept;
};

// ── the input: a de-indexed triangle soup with one face id per triangle ─────
// The same shape the viewport's vertex stream already has (3 vertices per
// triangle, each carrying its 1-based B-rep face id), so the frame builder
// copies it across once rather than re-tessellating.
class MeasureMesh {
 public:
  void addTriangle(const double a[3], const double b[3], const double c[3],
                   std::uint32_t faceId);
  void clear() noexcept;

  std::size_t triangleCount() const noexcept { return faceIds_.size(); }
  bool empty() const noexcept { return faceIds_.empty(); }

  // 9 doubles per triangle: ax ay az bx by bz cx cy cz.
  const std::vector<double>& coords() const noexcept { return xyz_; }
  const std::vector<std::uint32_t>& faceIds() const noexcept { return faceIds_; }

  // Sorted, unique face ids present in the soup.
  std::vector<std::uint32_t> faces() const;

 private:
  std::vector<double> xyz_;
  std::vector<std::uint32_t> faceIds_;
};

// ── per-face measurement ────────────────────────────────────────────────────
struct FaceMeasure {
  std::uint32_t faceId = 0;
  std::size_t triangles = 0;
  double area = 0.0;
  double centroid[3] = {0.0, 0.0, 0.0};  // area-weighted
  double normal[3] = {0.0, 0.0, 0.0};    // area-weighted, unit; all-zero if degenerate
  bool planar = false;                   // every triangle normal within tolerance of `normal`
  MeasureBox box{};
};

// ── whole-model measurement ─────────────────────────────────────────────────
struct MeshMeasure {
  std::size_t triangles = 0;
  std::size_t faces = 0;
  double area = 0.0;
  MeasureBox box{};

  // Edge topology, reported rather than hidden behind the boolean.
  std::size_t boundaryEdges = 0;     // used exactly once
  std::size_t nonManifoldEdges = 0;  // used more than twice
  std::size_t reversedEdges = 0;     // used twice, but in the SAME direction

  bool watertight = false;  // all three counts zero AND at least one triangle
  double volume = 0.0;      // magnitude; ZERO and meaningless unless watertight
  bool outward = false;     // the closed surface's winding faces out
  double centroid[3] = {0.0, 0.0, 0.0};  // volume centroid if watertight, else area centroid
};

// ── selection measurement ───────────────────────────────────────────────────
struct SelectionMeasure {
  std::size_t faces = 0;
  std::size_t triangles = 0;
  double area = 0.0;
  double centroid[3] = {0.0, 0.0, 0.0};
  MeasureBox box{};

  // The two-entity measure every CAD Measure tool offers. Only meaningful with
  // exactly two faces picked, which is what `hasPair` says.
  bool hasPair = false;
  double centreDistance = 0.0;
  double angleDegrees = 0.0;  // 0..180 between the two area-weighted normals
  bool parallel = false;
  bool perpendicular = false;

  // ── the distance a machinist means ────────────────────────────────────────
  // `centreDistance` is between CENTROIDS, and on two faces of a bracket that is
  // not the number anyone wants: the gap between an L's two arms is the MINIMUM
  // distance between their surfaces, and their centroids can be much further
  // apart than the material is. Both are reported, named apart, because they are
  // different questions and only one of them is the clearance.
  bool hasMinDistance = false;
  double minDistance = 0.0;      // closest approach of the two triangle sets
  double minPointA[3] = {0.0, 0.0, 0.0};  // where on face A it occurs
  double minPointB[3] = {0.0, 0.0, 0.0};  // and on face B
  // Zero (within tolerance) means the two faces TOUCH or intersect. Reported as
  // its own fact so a clearance readout of "0" is distinguishable from a
  // clearance that was never computed.
  bool touching = false;
};

MeshMeasure measureMesh(const MeasureMesh& mesh);
bool measureFace(const MeasureMesh& mesh, std::uint32_t faceId, FaceMeasure& out);
SelectionMeasure measureFaces(const MeasureMesh& mesh,
                              const std::vector<std::uint32_t>& faceIds);

// ── the geometric primitives an interactive Measure tool is made of ─────────
// Point / segment / triangle, in world coordinates. Every interactive
// measurement in the app — point-to-face, edge-to-edge, face-to-face clearance,
// a bore's radius from its rim — is one of these applied to entities the
// selection service already holds, so they live here and are asserted headless
// rather than being written inline in a frame builder where nothing can see
// them.

// Distance from `p` to the segment [a, b]; writes the closest point on the
// segment to `closest`. A degenerate segment reduces to its endpoint rather
// than dividing by zero.
double pointSegmentDistance(const double p[3], const double a[3], const double b[3],
                            double closest[3]);

// Closest approach of two segments, with the witness point on each. The
// PARALLEL case is handled explicitly (the shared perpendicular is not unique,
// so the overlap interval is clamped) — the textbook formula divides by zero
// there, and two parallel edges of a plate is not an exotic input.
double segmentSegmentDistance(const double a0[3], const double a1[3], const double b0[3],
                              const double b1[3], double closestA[3], double closestB[3]);

// Distance from `p` to the triangle (a, b, c), with the closest point on the
// triangle. Barycentric-region method: the answer is exact for every region,
// including the three vertex regions, where a naive plane projection is wrong.
double pointTriangleDistance(const double p[3], const double a[3], const double b[3],
                             const double c[3], double closest[3]);

// Distance from a point to a whole FACE of the mesh, i.e. the minimum over its
// triangles. Returns false when the face has no triangles.
bool pointFaceDistance(const MeasureMesh& mesh, std::uint32_t faceId, const double p[3],
                       double& distance, double closest[3]);

// ── clearance / interference between two face groups ────────────────────────
struct ClearanceMeasure {
  bool measured = false;
  double distance = 0.0;
  double pointA[3] = {0.0, 0.0, 0.0};
  double pointB[3] = {0.0, 0.0, 0.0};
  // Distance at or below `touchTolerance`: the two groups meet. This is the
  // INTERFERENCE answer a mesh can honestly give — a triangle soup can tell you
  // two surfaces touch, and cannot tell you the signed depth of an overlap
  // without a solid classifier, so it does not claim to.
  bool touching = false;
  std::size_t trianglesA = 0;
  std::size_t trianglesB = 0;
  std::size_t pairsTested = 0;  // the cost, reported rather than assumed
};

inline constexpr double kMeasureTouchTolerance = 1.0e-6;

ClearanceMeasure measureClearance(const MeasureMesh& mesh,
                                  const std::vector<std::uint32_t>& groupA,
                                  const std::vector<std::uint32_t>& groupB,
                                  double touchTolerance = kMeasureTouchTolerance);

// ── circle / arc fit: RADIUS, DIAMETER and ARC LENGTH ──────────────────────
// A bore rim is a polyline in the tessellation, not a circle, so "what is the
// diameter of this hole" is a FIT, and a fit that does not report its residual
// is a number with no error bar. `rms` is that residual in model units: a rim of
// a real cylinder fits to a small fraction of the tessellation's sagitta, and a
// rounded-rectangle slot end does not — which is how a UI can decline to print
// "diameter" for something that is not round.
struct CircleFit {
  bool ok = false;
  double centre[3] = {0.0, 0.0, 0.0};
  double normal[3] = {0.0, 0.0, 1.0};  // unit normal of the best-fit plane
  double radius = 0.0;
  double rms = 0.0;          // RMS radial residual
  double planeRms = 0.0;     // RMS out-of-plane residual
  std::size_t points = 0;

  double diameter() const noexcept { return 2.0 * radius; }
};

// Least-squares circle through 3+ points: best-fit plane by the covariance's
// smallest eigenvector, then Kasa's algebraic circle fit in that plane. Returns
// ok=false with fewer than three points, or when they are collinear.
// `points` is 3 doubles per point, exactly like MeasureMesh::coords().
CircleFit fitCircle(const std::vector<double>& points);

// Length of an open or closed polyline, 3 doubles per point. `closed` adds the
// closing segment. This is ARC LENGTH for a recovered edge.
double polylineLength(const std::vector<double>& points, bool closed);

// ── mass properties ─────────────────────────────────────────────────────────
// Density is in g/cm3, the unit every material table is written in, and lengths
// are mm — so mass in grams is volume(mm3) * density / 1000. Getting that
// conversion wrong by 10^3 is the classic CAD units defect, so it is done in one
// place and pinned by a gate on a 100 mm steel cube (7850 g).
struct MaterialDensity {
  const char* name;
  double gramsPerCm3;
};

// A small, honest table — the materials this app can name. Not a materials
// database: a name here is a number a user can check, and one they cannot is
// worse than a blank field.
const std::vector<MaterialDensity>& materialDensities();
// Density by name, or 0.0 when the name is not in the table. Case-sensitive on
// purpose: the caller picks from the list.
double densityForMaterial(const std::string& name);

struct MassMeasure {
  bool valid = false;   // the mesh was watertight; without that there is no mass
  double density = 0.0;  // g/cm3, as supplied
  double volume = 0.0;   // mm3
  double mass = 0.0;     // g
  double surfaceArea = 0.0;  // mm2
  double centreOfMass[3] = {0.0, 0.0, 0.0};
  // Inertia about the CENTRE OF MASS, row-major, in g*mm2.
  double inertiaCom[9] = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
  // Principal moments, ascending. Eigenvalues of the symmetric tensor above.
  double principalMoments[3] = {0.0, 0.0, 0.0};
  // sqrt(I / m) about each principal axis, mm.
  double radiiOfGyration[3] = {0.0, 0.0, 0.0};
};

MassMeasure measureMass(const MeasureMesh& mesh, double densityGramsPerCm3);

// ── export ──────────────────────────────────────────────────────────────────
// Every measurement must be copyable. These produce the clipboard text.
std::string measureText(const MeshMeasure& mesh);
std::string measureText(const SelectionMeasure& selection);
std::string measureText(const MassMeasure& mass);
std::string measureText(const ClearanceMeasure& clearance);
std::string measureText(const CircleFit& fit);

}  // namespace forge::ui

#endif  // FORGE_UI_MEASUREMODEL_HPP
