// ui/test/edge_model_test.cpp
//
// The edge model's arithmetic, against a closed form.
//
// The reference is a UNIT CUBE tessellated as two triangles per face, because
// every number this module produces has an exact value on one:
//
//   8 welded vertices, 12 triangles, 36 directed segments -> 18 undirected;
//   12 of those separate two DIFFERENT faces (the cube's edges),
//    6 of those are the face diagonals the tessellator drew INSIDE one face,
//    0 are boundary or non-manifold, because the cube closes;
//   12 adjacent face pairs, each meeting along exactly one connected chain,
//   so 12 recovered edges of one segment and length 1, none closed.
//
// A gate whose reference is "whatever the code returned" measures nothing, so
// none of the counts below is read back from the object under test.
//
// The two DEFECTIVE / DEGENERATE meshes are the point of the second half:
//   * TWO cubes carrying the SAME six face ids — the face pair (1,3) now meets
//     along two DISJOINT chains, which is the case that makes component
//     splitting necessary rather than decorative. Without it the model returns
//     one "edge" whose polyline is in two places at once.
//   * an OPEN cube (one face dropped) — the four segments that lost their second
//     triangle must be counted as boundary, not silently turned into edges.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

void corner(int index, double o, double s, double out[3]) {
  out[0] = o + ((index & 1) != 0 ? s : 0.0);
  out[1] = o + ((index & 2) != 0 ? s : 0.0);
  out[2] = o + ((index & 4) != 0 ? s : 0.0);
}

// Append the 12 outward-wound triangles of the box [o, o+s]^3 to `mesh`, with
// face ids 1..6 in the order -Z, +Z, -Y, +Y, -X, +X. `skipFace` drops both
// triangles of one face, which is how the open-mesh case is built.
void addBox(MeasureMesh& mesh, double o, double s, std::uint32_t skipFace = 0) {
  static const int kQuads[6][4] = {
      {0, 2, 3, 1}, {4, 5, 7, 6}, {0, 1, 5, 4}, {2, 6, 7, 3}, {0, 4, 6, 2}, {1, 3, 7, 5},
  };
  for (int f = 0; f < 6; ++f) {
    const std::uint32_t faceId = static_cast<std::uint32_t>(f + 1);
    if (faceId == skipFace) continue;
    const int tri[2][3] = {{kQuads[f][0], kQuads[f][1], kQuads[f][2]},
                           {kQuads[f][0], kQuads[f][2], kQuads[f][3]}};
    for (int t = 0; t < 2; ++t) {
      double a[3], b[3], c[3];
      corner(tri[t][0], o, s, a);
      corner(tri[t][1], o, s, b);
      corner(tri[t][2], o, s, c);
      mesh.addTriangle(a, b, c, faceId);
    }
  }
}

}  // namespace

int main() {
  Harness H("edge-model");

  // ── 1. the unit cube's census is exact ───────────────────────────────────
  MeasureMesh cube;
  addBox(cube, 0.0, 1.0);
  CHECK_EQ_INT(cube.triangleCount(), 12u);

  const EdgeSet set = deriveEdges(cube);
  CHECK_EQ_INT(set.segmentCount(), 18u);
  CHECK_EQ_INT(set.faceBoundarySegments, 12u);
  CHECK_EQ_INT(set.interiorSegments, 6u);
  CHECK_EQ_INT(set.boundarySegments, 0u);
  CHECK_EQ_INT(set.nonManifoldSegments, 0u);
  CHECK_EQ_INT(set.size(), 12u);

  // Every recovered edge is one unit-length segment between two DISTINCT faces,
  // ordered low-face-first, and none of them closes.
  double total = 0.0;
  std::size_t oneSegment = 0;
  std::size_t ordered = 0;
  std::size_t closed = 0;
  for (const MeshEdge& e : set.edges) {
    total += e.length;
    if (e.segments == 1) ++oneSegment;
    if (e.faceA < e.faceB && e.faceA >= 1 && e.faceB <= 6) ++ordered;
    if (e.closed) ++closed;
    CHECK_EQ_INT(e.points.size(), 6u);
  }
  CHECK_NEAR(total, 12.0, 1e-9);
  CHECK_EQ_INT(oneSegment, 12u);
  CHECK_EQ_INT(ordered, 12u);
  CHECK_EQ_INT(closed, 0u);

  // ── 2. the keys are unique, stable and addressable ───────────────────────
  std::vector<std::string> keys;
  for (const MeshEdge& e : set.edges) keys.push_back(e.key());
  std::size_t duplicates = 0;
  for (std::size_t i = 0; i < keys.size(); ++i) {
    for (std::size_t j = i + 1; j < keys.size(); ++j) {
      if (keys[i] == keys[j]) ++duplicates;
    }
  }
  CHECK_EQ_INT(duplicates, 0u);
  // The first pair in (faceA, faceB) order is (1,3): the -Z face meets the -Y
  // face along the cube's bottom-front edge. Spelled out rather than read back,
  // so a change in ordering is a failure and not a silently different name.
  CHECK_EQ_STR(forge::uitest::at(keys, 0), std::string("edge@1_3#0"));
  CHECK_EQ_INT(set.indexOf("edge@1_3#0"), 0u);
  CHECK_EQ_INT(set.indexOf("edge@1_2#0"), kNoEdge);  // opposite faces share nothing

  // A second derivation of the same mesh must produce the same keys in the same
  // order — determinism is what makes a persistent name persistent.
  const EdgeSet again = deriveEdges(cube);
  std::size_t sameOrder = 0;
  for (std::size_t i = 0; i < again.edges.size() && i < keys.size(); ++i) {
    if (again.edges[i].key() == keys[i]) ++sameOrder;
  }
  CHECK_EQ_INT(sameOrder, 12u);

  // ── 3. picking ───────────────────────────────────────────────────────────
  // Sight straight down -X at the midpoint of the cube's (x=1, z=1) edge, which
  // runs along Y at (1, *, 1). The nearest edge to that ray must be that edge.
  {
    const double origin[3] = {5.0, 0.5, 1.0};
    const double dir[3] = {-1.0, 0.0, 0.0};
    const EdgePick p = pickEdge(set, origin, dir, 0.25);
    CHECK(p.hit());
    if (p.hit()) {
      const MeshEdge& e = set.edges[p.index];
      CHECK(e.faceA == 2 || e.faceB == 2);  // +Z is face 2
      CHECK(e.faceA == 6 || e.faceB == 6);  // +X is face 6
      CHECK_NEAR(p.distance, 0.0, 1e-9);
      CHECK_NEAR(p.along, 4.0, 1e-9);
    }
  }
  // A ray that passes the cube by more than the tolerance must MISS. A picker
  // that hits everything is worse than one that hits nothing.
  {
    const double origin[3] = {5.0, 0.5, 3.0};
    const double dir[3] = {-1.0, 0.0, 0.0};
    const EdgePick p = pickEdge(set, origin, dir, 0.25);
    CHECK(!p.hit());
    CHECK_EQ_INT(p.index, kNoEdge);
  }
  // The SAME ray inside a tolerance that reaches must hit — so the miss above is
  // the tolerance doing its job, not the picker being blind.
  {
    const double origin[3] = {5.0, 0.5, 3.0};
    const double dir[3] = {-1.0, 0.0, 0.0};
    const EdgePick p = pickEdge(set, origin, dir, 2.5);
    CHECK(p.hit());
    CHECK_NEAR(p.distance, 2.0, 1e-9);
  }
  // A ray pointing AWAY from the body must not hit something behind the eye.
  {
    const double origin[3] = {5.0, 0.5, 1.0};
    const double dir[3] = {1.0, 0.0, 0.0};
    const EdgePick p = pickEdge(set, origin, dir, 0.25);
    CHECK(!p.hit());
  }

  // ── 4. measurement over a picked set ─────────────────────────────────────
  {
    const std::vector<std::size_t> three = {0, 1, 2};
    const EdgeMeasure m = measureEdges(set, three);
    CHECK_EQ_INT(m.edges, 3u);
    CHECK_EQ_INT(m.segments, 3u);
    CHECK_NEAR(m.length, 3.0, 1e-9);
    CHECK(!m.hasPair);
    CHECK(m.box.valid);

    const std::vector<std::size_t> two = {0, 1};
    const EdgeMeasure pair = measureEdges(set, two);
    CHECK(pair.hasPair);
    CHECK(pair.centreDistance > 0.0);

    // An out-of-range index is ignored, not indexed. The panel feeds this from a
    // selection that may name an edge a rebuild has removed.
    const std::vector<std::size_t> stale = {0, 999};
    CHECK_EQ_INT(measureEdges(set, stale).edges, 1u);
  }

  // ── 5. one face pair, TWO chains: component splitting ────────────────────
  {
    MeasureMesh twoCubes;
    addBox(twoCubes, 0.0, 1.0);
    addBox(twoCubes, 10.0, 1.0);  // the SAME face ids 1..6, ten units away
    const EdgeSet s2 = deriveEdges(twoCubes);
    CHECK_EQ_INT(s2.segmentCount(), 36u);
    CHECK_EQ_INT(s2.faceBoundarySegments, 24u);
    // 12 face pairs x 2 disjoint chains. Merging the chains would give 12.
    CHECK_EQ_INT(s2.size(), 24u);
    CHECK_EQ_INT(s2.indexOf("edge@1_3#0"), 0u);
    CHECK_EQ_INT(s2.indexOf("edge@1_3#1"), 1u);
    std::size_t twoComponents = 0;
    for (const MeshEdge& e : s2.edges) {
      if (e.component == 1) ++twoComponents;
      CHECK_EQ_INT(e.segments, 1u);
    }
    CHECK_EQ_INT(twoComponents, 12u);
  }

  // ── 6. an OPEN mesh reports boundary segments, not extra edges ───────────
  {
    MeasureMesh open;
    addBox(open, 0.0, 1.0, /*skipFace=*/2);  // drop the +Z face
    const EdgeSet s3 = deriveEdges(open);
    CHECK_EQ_INT(open.triangleCount(), 10u);
    CHECK_EQ_INT(s3.segmentCount(), 17u);  // 18 minus the dropped face's diagonal
    CHECK_EQ_INT(s3.boundarySegments, 4u);
    CHECK_EQ_INT(s3.interiorSegments, 5u);
    CHECK_EQ_INT(s3.faceBoundarySegments, 8u);
    CHECK_EQ_INT(s3.size(), 8u);  // the four edges that touched +Z are gone
  }

  // ── 7. an empty mesh answers empty, and does not index ───────────────────
  {
    const MeasureMesh none;
    const EdgeSet s4 = deriveEdges(none);
    CHECK_EQ_INT(s4.size(), 0u);
    CHECK_EQ_INT(s4.segmentCount(), 0u);
    const double origin[3] = {0.0, 0.0, 0.0};
    const double dir[3] = {1.0, 0.0, 0.0};
    CHECK(!pickEdge(s4, origin, dir, 1.0).hit());
  }

  return H.finish();
}
