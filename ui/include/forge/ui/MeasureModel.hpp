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
};

MeshMeasure measureMesh(const MeasureMesh& mesh);
bool measureFace(const MeasureMesh& mesh, std::uint32_t faceId, FaceMeasure& out);
SelectionMeasure measureFaces(const MeasureMesh& mesh,
                              const std::vector<std::uint32_t>& faceIds);

}  // namespace forge::ui

#endif  // FORGE_UI_MEASUREMODEL_HPP
