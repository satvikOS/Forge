// ui/test/measure_model_test.cpp
//
// The Measure panel's arithmetic, against closed forms.
//
// The reference is a UNIT CUBE, because every quantity the panel prints has an
// exact value on one: area 6, volume 1, centroid (.5,.5,.5), six planar faces of
// area 1 whose normals are the axes, opposite faces 1 apart at 180 degrees and
// adjacent faces at 90. A measurement gate whose reference is "whatever the code
// returned" measures nothing.
//
// The four DEFECTIVE meshes are the point of the file. A volume is only a volume
// when the surface closes, so the module must refuse one on an open mesh, on an
// inconsistently wound mesh and on a non-manifold mesh — and must still close a
// mesh whose shared vertices differ by float32 noise, which is every real
// tessellation. (MEMORY: "Volume cannot validate geometry" — a plausible scalar
// is exactly how wrong geometry passes.)
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/ui/MeasureModel.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// The eight corners of the axis-aligned box [o, o+s]^3.
void corner(int index, double o, double s, double out[3]) {
  out[0] = o + ((index & 1) != 0 ? s : 0.0);
  out[1] = o + ((index & 2) != 0 ? s : 0.0);
  out[2] = o + ((index & 4) != 0 ? s : 0.0);
}

// The 12 outward-wound triangles of that box, face ids 1..6 in the order
// -Z, +Z, -Y, +Y, -X, +X. `skipFace` drops both triangles of one face (an open
// mesh); `flipTriangle` reverses one triangle's winding; `duplicate` appends a
// second copy of triangle 0 (a non-manifold edge). `jitter` displaces every
// SECOND written vertex by that much, simulating float32 noise on a shared
// corner without moving the surface meaningfully.
MeasureMesh box(double o, double s, std::uint32_t skipFace = 0, int flipTriangle = -1,
                bool duplicate = false, double jitter = 0.0) {
  // corner indices per face, as two triangles (a,b,c) (a,c,d) around the quad
  static const int kQuads[6][4] = {
      {0, 2, 3, 1},  // z = min, outward -Z
      {4, 5, 7, 6},  // z = max, outward +Z
      {0, 1, 5, 4},  // y = min, outward -Y
      {2, 6, 7, 3},  // y = max, outward +Y
      {0, 4, 6, 2},  // x = min, outward -X
      {1, 3, 7, 5},  // x = max, outward +X
  };
  MeasureMesh mesh;
  int written = 0;
  int wroteVertices = 0;
  for (int f = 0; f < 6; ++f) {
    const std::uint32_t faceId = static_cast<std::uint32_t>(f + 1);
    if (faceId == skipFace) continue;
    const int tri[2][3] = {{kQuads[f][0], kQuads[f][1], kQuads[f][2]},
                           {kQuads[f][0], kQuads[f][2], kQuads[f][3]}};
    for (int t = 0; t < 2; ++t) {
      double p[3][3];
      for (int v = 0; v < 3; ++v) {
        corner(tri[t][v], o, s, p[v]);
        if (jitter != 0.0 && (wroteVertices % 2) == 1) {
          p[v][0] += jitter;
          p[v][1] -= jitter;
        }
        ++wroteVertices;
      }
      if (written == flipTriangle) {
        mesh.addTriangle(p[0], p[2], p[1], faceId);
      } else {
        mesh.addTriangle(p[0], p[1], p[2], faceId);
      }
      ++written;
    }
  }
  if (duplicate) {
    double a[3], b[3], c[3];
    corner(kQuads[0][0], o, s, a);
    corner(kQuads[0][1], o, s, b);
    corner(kQuads[0][2], o, s, c);
    mesh.addTriangle(a, b, c, 1);
  }
  return mesh;
}

}  // namespace

int main() {
  Harness H("measure_model");

  // ── 1. the unit cube: every number has a closed form ──────────────────────
  {
    const MeasureMesh cube = box(0.0, 1.0);
    CHECK_EQ_INT(cube.triangleCount(), 12);
    CHECK_EQ_INT(cube.faces().size(), 6);
    CHECK_EQ_INT(cube.coords().size(), 12 * 9);

    const MeshMeasure m = measureMesh(cube);
    CHECK_EQ_INT(m.triangles, 12);
    CHECK_EQ_INT(m.faces, 6);
    CHECK_NEAR(m.area, 6.0, 1e-12);
    CHECK(m.box.valid);
    CHECK_NEAR(m.box.min[0], 0.0, 1e-12);
    CHECK_NEAR(m.box.max[2], 1.0, 1e-12);
    CHECK_NEAR(m.box.size(0), 1.0, 1e-12);
    CHECK_NEAR(m.box.size(1), 1.0, 1e-12);
    CHECK_NEAR(m.box.size(2), 1.0, 1e-12);
    CHECK_NEAR(m.box.diagonal(), std::sqrt(3.0), 1e-12);

    // The topology gate, then the volume it gates.
    CHECK_EQ_INT(m.boundaryEdges, 0);
    CHECK_EQ_INT(m.nonManifoldEdges, 0);
    CHECK_EQ_INT(m.reversedEdges, 0);
    CHECK(m.watertight);
    CHECK_NEAR(m.volume, 1.0, 1e-12);
    CHECK(m.outward);
    CHECK_NEAR(m.centroid[0], 0.5, 1e-12);
    CHECK_NEAR(m.centroid[1], 0.5, 1e-12);
    CHECK_NEAR(m.centroid[2], 0.5, 1e-12);

    double c[3];
    m.box.centre(c);
    CHECK_NEAR(c[0], 0.5, 1e-12);
  }

  // ── 2. it scales as a volume and an area must ─────────────────────────────
  {
    const MeshMeasure m = measureMesh(box(-3.0, 2.0));
    CHECK_NEAR(m.area, 24.0, 1e-12);      // 6 * s^2
    CHECK_NEAR(m.volume, 8.0, 1e-12);     // s^3
    CHECK(m.watertight);
    CHECK_NEAR(m.centroid[0], -2.0, 1e-12);
    CHECK_NEAR(m.box.min[0], -3.0, 1e-12);
    CHECK_NEAR(m.box.max[0], -1.0, 1e-12);
  }

  // ── 3. per-face measurement ───────────────────────────────────────────────
  {
    const MeasureMesh cube = box(0.0, 1.0);
    FaceMeasure f{};
    CHECK(measureFace(cube, 1, f));  // z = min
    CHECK_EQ_INT(f.faceId, 1);
    CHECK_EQ_INT(f.triangles, 2);
    CHECK_NEAR(f.area, 1.0, 1e-12);
    CHECK_NEAR(f.centroid[0], 0.5, 1e-12);
    CHECK_NEAR(f.centroid[2], 0.0, 1e-12);
    CHECK_NEAR(f.normal[0], 0.0, 1e-12);
    CHECK_NEAR(f.normal[1], 0.0, 1e-12);
    CHECK_NEAR(f.normal[2], -1.0, 1e-12);
    CHECK(f.planar);
    CHECK_NEAR(f.box.size(2), 0.0, 1e-12);
    CHECK_NEAR(f.box.size(0), 1.0, 1e-12);

    FaceMeasure top{};
    CHECK(measureFace(cube, 2, top));
    CHECK_NEAR(top.normal[2], 1.0, 1e-12);
    CHECK_NEAR(top.centroid[2], 1.0, 1e-12);

    FaceMeasure right{};
    CHECK(measureFace(cube, 6, right));
    CHECK_NEAR(right.normal[0], 1.0, 1e-12);
    CHECK_NEAR(right.centroid[0], 1.0, 1e-12);

    // A face id nothing carries is not measurable, and says so.
    FaceMeasure none{};
    CHECK(!measureFace(cube, 99, none));
    CHECK_EQ_INT(none.triangles, 0);
  }

  // ── 4. the two-face measure ───────────────────────────────────────────────
  {
    const MeasureMesh cube = box(0.0, 1.0);

    const SelectionMeasure opposite = measureFaces(cube, {1, 2});  // -Z and +Z
    CHECK_EQ_INT(opposite.faces, 2);
    CHECK_EQ_INT(opposite.triangles, 4);
    CHECK_NEAR(opposite.area, 2.0, 1e-12);
    CHECK_NEAR(opposite.centroid[2], 0.5, 1e-12);
    CHECK(opposite.hasPair);
    CHECK_NEAR(opposite.centreDistance, 1.0, 1e-12);
    CHECK_NEAR(opposite.angleDegrees, 180.0, 1e-9);
    CHECK(opposite.parallel);
    CHECK(!opposite.perpendicular);
    CHECK_NEAR(opposite.box.size(2), 1.0, 1e-12);

    const SelectionMeasure adjacent = measureFaces(cube, {1, 6});  // -Z and +X
    CHECK(adjacent.hasPair);
    CHECK_NEAR(adjacent.angleDegrees, 90.0, 1e-9);
    CHECK(adjacent.perpendicular);
    CHECK(!adjacent.parallel);
    CHECK_NEAR(adjacent.centreDistance, std::sqrt(0.5), 1e-12);

    // One face is not a pair; three faces are not a pair either.
    const SelectionMeasure single = measureFaces(cube, {3});
    CHECK_EQ_INT(single.faces, 1);
    CHECK(!single.hasPair);
    const SelectionMeasure three = measureFaces(cube, {1, 2, 6});
    CHECK_EQ_INT(three.faces, 3);
    CHECK_NEAR(three.area, 3.0, 1e-12);
    CHECK(!three.hasPair);

    // A face picked twice is one face: the panel must not report a 0 mm
    // distance from a face to itself as if two things had been measured.
    const SelectionMeasure duped = measureFaces(cube, {2, 2, 1});
    CHECK_EQ_INT(duped.faces, 2);
    CHECK(duped.hasPair);
    CHECK_NEAR(duped.centreDistance, 1.0, 1e-12);

    // Unknown ids contribute nothing rather than a zero-area phantom face.
    const SelectionMeasure phantom = measureFaces(cube, {99, 100});
    CHECK_EQ_INT(phantom.faces, 0);
    CHECK_NEAR(phantom.area, 0.0, 1e-12);
    CHECK(!phantom.hasPair);
    CHECK(!phantom.box.valid);
    const SelectionMeasure empty = measureFaces(cube, {});
    CHECK_EQ_INT(empty.faces, 0);
    CHECK(!empty.hasPair);
  }

  // ── 5. an OPEN mesh has no volume, and says which edges are open ──────────
  {
    const MeasureMesh open = box(0.0, 1.0, /*skipFace=*/2);
    const MeshMeasure m = measureMesh(open);
    CHECK_EQ_INT(m.triangles, 10);
    CHECK_EQ_INT(m.faces, 5);
    CHECK_NEAR(m.area, 5.0, 1e-12);
    CHECK_EQ_INT(m.boundaryEdges, 4);   // the square hole's rim
    CHECK_EQ_INT(m.nonManifoldEdges, 0);
    CHECK_EQ_INT(m.reversedEdges, 0);
    CHECK(!m.watertight);
    CHECK_NEAR(m.volume, 0.0, 1e-12);   // refused, not fabricated
    CHECK(!m.outward);
    // The centroid falls back to the AREA centroid, which for the cube minus its
    // top face sits below the middle.
    CHECK_NEAR(m.centroid[2], 0.4, 1e-12);
  }

  // ── 6. an inconsistently WOUND mesh has no volume either ──────────────────
  {
    const MeasureMesh flipped = box(0.0, 1.0, /*skipFace=*/0, /*flipTriangle=*/0);
    const MeshMeasure m = measureMesh(flipped);
    CHECK_EQ_INT(m.triangles, 12);
    CHECK_NEAR(m.area, 6.0, 1e-12);     // area is winding-blind, and stays right
    CHECK_EQ_INT(m.boundaryEdges, 0);   // it still CLOSES; only the winding broke
    CHECK_EQ_INT(m.nonManifoldEdges, 0);
    CHECK_EQ_INT(m.reversedEdges, 3);   // the flipped triangle's three edges
    CHECK(!m.watertight);
    CHECK_NEAR(m.volume, 0.0, 1e-12);
  }

  // ── 7. a NON-MANIFOLD mesh has no volume either ───────────────────────────
  {
    const MeasureMesh dup = box(0.0, 1.0, 0, -1, /*duplicate=*/true);
    const MeshMeasure m = measureMesh(dup);
    CHECK_EQ_INT(m.triangles, 13);
    CHECK_EQ_INT(m.nonManifoldEdges, 3);  // the repeated triangle's three edges
    CHECK_EQ_INT(m.boundaryEdges, 0);
    CHECK(!m.watertight);
    CHECK_NEAR(m.volume, 0.0, 1e-12);
  }

  // ── 8. float32 noise on shared corners must NOT open the mesh ─────────────
  // This is the difference between working on a real tessellation and working
  // only on a fixture: the viewport's stream is de-indexed float32, so two
  // references to one B-rep vertex agree to ~1e-5 mm and no further.
  {
    const MeshMeasure welded = measureMesh(box(0.0, 80.0, 0, -1, false, 1.0e-5));
    CHECK_EQ_INT(welded.boundaryEdges, 0);
    CHECK(welded.watertight);
    CHECK_NEAR(welded.volume, 80.0 * 80.0 * 80.0, 1.0);

    // ...and a displacement well ABOVE the weld tolerance is a real gap, which
    // must be reported as one. A tolerance that swallows everything is not a
    // tolerance.
    const MeshMeasure torn = measureMesh(box(0.0, 80.0, 0, -1, false, 1.0e-2));
    CHECK(!torn.watertight);
    CHECK(torn.boundaryEdges > 0);
  }

  // ── 9. the empty mesh ─────────────────────────────────────────────────────
  {
    const MeasureMesh none;
    const MeshMeasure m = measureMesh(none);
    CHECK_EQ_INT(m.triangles, 0);
    CHECK_EQ_INT(m.faces, 0);
    CHECK(!m.watertight);
    CHECK(!m.box.valid);
    CHECK_NEAR(m.box.diagonal(), 0.0, 1e-12);
    CHECK_NEAR(m.box.size(0), 0.0, 1e-12);
    CHECK_NEAR(m.volume, 0.0, 1e-12);
  }

  return H.finish();
}
