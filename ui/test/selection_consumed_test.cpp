// ui/test/selection_consumed_test.cpp — THE PICK MUST REACH THE STATEMENT.
//
// ── the defect this gate exists to keep closed ──────────────────────────────
// Five commands validated a selection and then discarded it. MEASURED by driving
// the real registry headlessly at 488e5328, three DIFFERENT picks emitted the
// SAME statement, status Ok every time:
//
//   part.hole         face@1 -> HOLE(%N, 9, 0, 0, 0)
//                     face@6 -> HOLE(%N, 9, 0, 0, 0)                 IDENTICAL
//   part.counterbore  face@1 -> CBORE(%N, 10, 18, 5, 0, 0, 0)
//                     face@6 -> CBORE(%N, 10, 18, 5, 0, 0, 0)        IDENTICAL
//   part.fillet       1 edge  -> FILLET(%N, 3, ALL)
//                     4 edges -> FILLET(%N, 3, ALL)                  IDENTICAL
//   part.chamfer      (the same three picks) -> CHAMFER(%N, 2, ALL)
//   part.variable_fillet                     -> BLEND(%N, 1, 4)   no selector at all
//
// Both hole commands demand a Face selection and then read x/y/z from OPTIONAL
// parameters defaulting to 0, so every hole went through the WORLD ORIGIN on a
// hard-coded +Z axis: a hole in a side face was not expressible from the command,
// and a counterbore clicked onto the top of a plate measured 112852.365373 —
// byte-identical to a plain HOLE of the same pilot diameter.
//
// ALL 45 UI GATES PASSED over that. They assert what a command REGISTERS and what
// it emits for ONE selection; none of them ever dispatched the same command twice
// under two different picks and compared. That is the shape of the hole, so this
// file's central assertion is a DIFFERENCE, not a value:
//
//     dispatch the same command under three different selections
//     and require the three emitted statements to DIFFER.
//
// A gate that only checked one placement would go green on a build that hard-codes
// the answer, which is precisely the build this replaces.
//
// ── the second thing it guards, which is subtler ────────────────────────────
// A reference that never went through a ray — from the feature tree, from a macro,
// from Archie — carries no evidence, and for those the emitted statement must be
// BYTE-IDENTICAL to the build before this change. Three of this application's four
// authoring paths are unpicked, and a change that silently re-placed their features
// would be a far worse defect than the one being fixed. Every "unpicked" case below
// is asserted against the literal text part_commands_test.cpp already expected.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ui/ActivityLog.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/PickModel.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "forge/ui/UserFacingText.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// ── THE REAL PART ───────────────────────────────────────────────────────────
// The reference bracket, not a unit cube: a 120 x 80 x 10 base plate carrying a
// 40 x 30 x 18 boss on its top face. Every face is at a different height and the
// three extents all differ, so no axis mix-up and no "it happened to be the
// origin" can pass by symmetry — and the boss top (z = 28) and the plate top
// (z = 10) are two DIFFERENT upward faces, which is the case a hard-coded +Z at
// the world origin cannot tell apart.
//
// Face ids are 1-based and assigned in the order below, the same convention
// OcctNativeMesh's picking ids use.
//
//    1 plate bottom  z = 0        6 plate right   x = +60
//    2 plate top     z = 10       7 boss top      z = 28
//    3 plate front   y = -40      8 boss front    y = -15
//    4 plate back    y = +40      9 boss back     y = +15
//    5 plate left    x = -60     10 boss left     x = -20
//                                11 boss right    x = +20
//
// The plate top is emitted as a ring around the boss footprint so that the solid
// is CLOSED — measureMesh() must find it watertight or the winding test, and
// therefore every normal in this file, has no meaning.

// One axis-aligned planar panel, subdivided at the given cut lines.
//
// THE SUBDIVISION IS NOT DECORATION. Where the plate top meets the plate front,
// both sides must be cut at the SAME stations or the long segment on one side
// meets three short ones on the other: a T-junction, which leaves the soup
// non-manifold, measureMesh() not watertight, and every normal in this file
// without a defined sign. So each panel is cut at every station its neighbours
// are, and the extra segments interior to one face id weld away as tessellation.
//
// `axis` is the constant coordinate. The two free axes are taken in CYCLIC order
// — z const -> (x,y), x const -> (y,z), y const -> (z,x) — because the right-hand
// rule then makes a counter-clockwise cell in (u,v) face +axis with no per-face
// winding table to get wrong. `outwardPositive` reverses it for the other side.
//
// `skip` names one cell range to leave open, which is how the plate top makes
// room for the boss footprint.
void panel(MeasureMesh& m, int axis, double level, const std::vector<double>& us,
           const std::vector<double>& vs, bool outwardPositive, std::uint32_t face,
           double skipU0 = 1.0, double skipU1 = -1.0, double skipV0 = 1.0, double skipV1 = -1.0) {
  const int ua = (axis + 1) % 3;
  const int va = (axis + 2) % 3;
  for (std::size_t i = 0; i + 1 < us.size(); ++i) {
    for (std::size_t j = 0; j + 1 < vs.size(); ++j) {
      if (us[i] >= skipU0 && us[i + 1] <= skipU1 && vs[j] >= skipV0 && vs[j + 1] <= skipV1) {
        continue;
      }
      double p[4][3];
      const double uu[4] = {us[i], us[i + 1], us[i + 1], us[i]};
      const double vv[4] = {vs[j], vs[j], vs[j + 1], vs[j + 1]};
      for (int k = 0; k < 4; ++k) {
        p[k][axis] = level;
        p[k][ua] = uu[k];
        p[k][va] = vv[k];
      }
      if (outwardPositive) {
        m.addTriangle(p[0], p[1], p[2], face);
        m.addTriangle(p[0], p[2], p[3], face);
      } else {
        m.addTriangle(p[0], p[2], p[1], face);
        m.addTriangle(p[0], p[3], p[2], face);
      }
    }
  }
}

MeasureMesh makeBracket() {
  const double X = 60.0, Y = 40.0, Z = 10.0;     // plate half-extents and height
  const double bx = 20.0, by = 15.0, bz = 28.0;  // boss half-extents and top
  const std::vector<double> xs{-X, -bx, bx, X};
  const std::vector<double> ys{-Y, -by, by, Y};
  const std::vector<double> zs{0.0, Z};
  const std::vector<double> bxs{-bx, bx};
  const std::vector<double> bys{-by, by};
  const std::vector<double> bzs{Z, bz};
  MeasureMesh m;

  panel(m, 2, 0.0, xs, ys, false, 1);                       // plate bottom,  -Z
  panel(m, 2, Z, xs, ys, true, 2, -bx, bx, -by, by);        // plate top,     +Z, boss cut out
  panel(m, 1, -Y, zs, xs, false, 3);                        // plate front,   -Y
  panel(m, 1, Y, zs, xs, true, 4);                          // plate back,    +Y
  panel(m, 0, -X, ys, zs, false, 5);                        // plate left,    -X
  panel(m, 0, X, ys, zs, true, 6);                          // plate right,   +X
  panel(m, 2, bz, bxs, bys, true, 7);                       // boss top,      +Z
  panel(m, 1, -by, bzs, bxs, false, 8);                     // boss front,    -Y
  panel(m, 1, by, bzs, bxs, true, 9);                       // boss back,     +Y
  panel(m, 0, -bx, bys, bzs, false, 10);                    // boss left,     -X
  panel(m, 0, bx, bys, bzs, true, 11);                      // boss right,    +X
  return m;
}

// ── THE SECOND PART: a block CROSS-DRILLED along X ─────────────────────────
// 60 x 10 x 10 (x in [-30,30], y in [-5,5], z in [0,10]) with an octagonal bore
// of circumradius 3 on the line y = 0, z = 5 -- the tessellated form of the side
// hole this change made expressible. It exists for the EDGE classes, and it was
// chosen because it is the part on which the classification can be wrong in a
// way that builds:
//
//   * each bore RIM is a closed chain lying in a VERTICAL plane. The kernel calls
//     a closed edge HORIZONTAL (its chord is a point), and the shipped worker
//     proves it acts on them: hole-then-FILLET(0.2, HORIZONTAL) measured
//     88358.578485759761 with 17 faces, FILLET(0.2, HORIZONTAL)-then-hole
//     88359.068728210448 with 15 -- two more faces and 0.49 mm3 less metal, the
//     two rims.
//   * each upright corner is TWO mesh segments, because the front and back faces
//     are cut at z = 5 to meet the octagon without a T-junction.
//
//    1 bottom  z = 0      3 front  y = -5     5 left  x = -30 (annulus)
//    2 top     z = 10     4 back   y = +5     6 right x = +30 (annulus)
//                                             7 the bore wall, ONE face id
constexpr double kPi = 3.14159265358979323846;

void annulus(MeasureMesh& m, double x, bool outwardPositive, std::uint32_t face) {
  // The square boundary is sampled at the octagon's own angles, which lands on
  // its four corners and four mid-sides -- the stations the panels are cut at.
  const double sq[8][2] = {{5, 5}, {5, 10}, {0, 10}, {-5, 10}, {-5, 5}, {-5, 0}, {0, 0}, {5, 0}};
  for (int k = 0; k < 8; ++k) {
    const int k1 = (k + 1) % 8;
    const double t0 = k * kPi / 4.0, t1 = k1 * kPi / 4.0;
    const double o0[3] = {x, sq[k][0], sq[k][1]}, o1[3] = {x, sq[k1][0], sq[k1][1]};
    const double i0[3] = {x, 3.0 * std::cos(t0), 5.0 + 3.0 * std::sin(t0)};
    const double i1[3] = {x, 3.0 * std::cos(t1), 5.0 + 3.0 * std::sin(t1)};
    if (outwardPositive) {  // counter-clockwise in (y,z) faces +X
      m.addTriangle(o0, o1, i1, face);
      m.addTriangle(o0, i1, i0, face);
    } else {
      m.addTriangle(o0, i1, o1, face);
      m.addTriangle(o0, i0, i1, face);
    }
  }
}

MeasureMesh makeCrossDrilledBlock() {
  MeasureMesh m;
  const std::vector<double> xs{-30.0, 30.0};
  panel(m, 2, 0.0, xs, {-5.0, 0.0, 5.0}, false, 1);   // bottom, -Z
  panel(m, 2, 10.0, xs, {-5.0, 0.0, 5.0}, true, 2);   // top,    +Z
  panel(m, 1, -5.0, {0.0, 5.0, 10.0}, xs, false, 3);  // front,  -Y
  panel(m, 1, 5.0, {0.0, 5.0, 10.0}, xs, true, 4);    // back,   +Y
  annulus(m, -30.0, false, 5);                         // left,   -X
  annulus(m, 30.0, true, 6);                           // right,  +X
  for (int k = 0; k < 8; ++k) {                        // the bore, facing its own axis
    const double t0 = k * kPi / 4.0, t1 = ((k + 1) % 8) * kPi / 4.0;
    const double a[3] = {-30.0, 3.0 * std::cos(t0), 5.0 + 3.0 * std::sin(t0)};
    const double b[3] = {30.0, a[1], a[2]};
    const double c[3] = {30.0, 3.0 * std::cos(t1), 5.0 + 3.0 * std::sin(t1)};
    const double d[3] = {-30.0, c[1], c[2]};
    m.addTriangle(a, b, c, 7);
    m.addTriangle(a, c, d, 7);
  }
  return m;
}

// ── AN ORACLE FOR THE KERNEL'S EDGE CLASS, written independently ────────────
// forge::ft selectEdges() takes the chord between the FIRST and LAST point of an
// edge's polyline: a closed edge's chord is a point (horizontal), an open edge's
// is the line between its two ends. MeshEdge::points is NOT that polyline -- it
// is the chain's segments in welded-id order, each oriented however the first
// triangle to use it was wound -- so the oracle recovers the ENDS from topology:
// a vertex used by exactly one segment of the chain is an end, and a chain with
// none is closed. Welded on the same quantum the edge model uses.
EdgeAxisClass kernelClassOf(const MeshEdge& e) {
  if (e.points.size() < 6) return EdgeAxisClass::None;
  struct End {
    long long k[3];
    const double* p;
    int uses;
  };
  std::vector<End> ends;
  for (std::size_t s = 0; s + 2 < e.points.size(); s += 3) {
    const double* p = &e.points[s];
    long long k[3];
    for (int i = 0; i < 3; ++i) k[i] = std::llround(p[i] / kMeasureWeldTolerance);
    bool found = false;
    for (End& x : ends) {
      if (x.k[0] == k[0] && x.k[1] == k[1] && x.k[2] == k[2]) {
        ++x.uses;
        found = true;
        break;
      }
    }
    if (!found) ends.push_back(End{{k[0], k[1], k[2]}, p, 1});
  }
  std::vector<const double*> open;
  for (const End& x : ends) {
    if (x.uses == 1) open.push_back(x.p);
    if (x.uses > 2) return EdgeAxisClass::None;  // branched: no single edge has this shape
  }
  if (open.empty()) return EdgeAxisClass::Horizontal;
  if (open.size() != 2) return EdgeAxisClass::None;
  const double dx = open[1][0] - open[0][0], dy = open[1][1] - open[0][1],
               dz = open[1][2] - open[0][2];
  const double len = std::sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) return EdgeAxisClass::Horizontal;
  if (std::fabs(std::fabs(dz) / len - 1.0) < 1e-2) return EdgeAxisClass::Vertical;
  if (std::fabs(dz) / len < 1e-2) return EdgeAxisClass::Horizontal;
  return EdgeAxisClass::None;
}

// ── building the references a viewport click would produce ──────────────────
EntityRef pickedFace(const MeasureMesh& mesh, MeshWinding winding, const std::string& node,
                     std::uint32_t faceId, const double hit[3]) {
  EntityRef r;
  r.bodyId = node;
  r.kind = EntityKind::Face;
  r.persistentName = "face@" + std::to_string(faceId);
  r.generation = 1;
  r.pick = faceEvidence(mesh, faceId, winding, hit);
  return r;
}

EntityRef plainRef(const std::string& node, EntityKind kind, const std::string& name) {
  return EntityRef{node, kind, name, 1};
}

// An edge reference as the viewport would hand it over: the persistent name from
// the recovered set, and the evidence the pick produced.
EntityRef pickedEdge(const EdgeSet& set, const std::string& node, std::size_t index,
                     const double origin[3], const double dir[3]) {
  EntityRef r;
  r.bodyId = node;
  r.kind = EntityKind::Edge;
  r.persistentName = set.edges[index].key();
  r.generation = 1;
  r.pick = edgeEvidence(set, index, origin, dir);
  return r;
}

std::string lastLine(const PartDocument& doc) {
  const FeatureRecord* f = doc.lastFeature();
  return f == nullptr ? std::string("<no feature>") : f->line.text();
}

int statusOf(const DispatchResult& r) { return static_cast<int>(r.status); }

CommandParams num1(const char* n, double v) {
  CommandParams p;
  p.setNumber(n, v);
  return p;
}

}  // namespace

int main() {
  Harness H("selection_consumed");

  // ── PART 1: the geometry the evidence is built from ───────────────────────
  const MeasureMesh bracket = makeBracket();
  const MeshMeasure mm = measureMesh(bracket);
  // The fixture must be a closed solid or the winding test is meaningless and
  // every normal below is a guess. Assert it rather than assume it.
  CHECK(mm.watertight);
  CHECK_EQ_INT(mm.boundaryEdges, 0);
  CHECK_EQ_INT(mm.nonManifoldEdges, 0);
  CHECK_EQ_INT(mm.faces, 11);
  // 120*80*10 plate + 40*30*18 boss = 96000 + 21600
  CHECK_NEAR(mm.volume, 117600.0, 1e-6);

  const MeshWinding winding = meshWinding(bracket);
  CHECK_EQ_INT(static_cast<int>(winding), static_cast<int>(MeshWinding::Outward));
  // An OPEN mesh has no inside, so it must not be given a winding — a normal
  // derived from one would point into the material half the time.
  {
    MeasureMesh open;
    const double a[3] = {0, 0, 0}, b[3] = {1, 0, 0}, c[3] = {1, 1, 0};
    open.addTriangle(a, b, c, 1);
    CHECK_EQ_INT(static_cast<int>(meshWinding(open)), static_cast<int>(MeshWinding::Unknown));
    double n[3] = {9, 9, 9};
    CHECK(!faceOutwardNormal(open, 1, MeshWinding::Unknown, n));
    CHECK_NEAR(n[0], 9.0, 0.0);  // refused means UNTOUCHED, not zeroed
  }

  // every outward normal, by name, on a real part
  {
    const double want[11][3] = {{0, 0, -1}, {0, 0, 1}, {0, -1, 0}, {0, 1, 0}, {-1, 0, 0},
                                {1, 0, 0},  {0, 0, 1}, {0, -1, 0}, {0, 1, 0}, {-1, 0, 0},
                                {1, 0, 0}};
    for (std::uint32_t f = 1; f <= 11; ++f) {
      double n[3] = {0, 0, 0};
      CHECK(faceOutwardNormal(bracket, f, winding, n));
      for (int a = 0; a < 3; ++a) CHECK_NEAR(n[a], want[f - 1][a], 1e-12);
    }
    // ... and the sign FOLLOWS the winding rather than being assumed: told the
    // soup is wound inward, every normal flips.
    double n[3] = {0, 0, 0};
    CHECK(faceOutwardNormal(bracket, 2, MeshWinding::Inward, n));
    CHECK_NEAR(n[2], -1.0, 1e-12);
  }

  // ── PART 2: the hit point is SNAPPED onto the face's own plane ────────────
  // A ray/triangle solve in float delivers z = 9.9999994 for a click on a face at
  // z = 10. Left alone, CBORE would roof its recess with a 0.6 um film of metal.
  {
    const double sloppy[3] = {12.5, -7.25, 9.99999940395355225};
    const PickEvidence ev = faceEvidence(bracket, 2, winding, sloppy);
    CHECK(ev.valid);
    CHECK(ev.hasNormal());
    CHECK_NEAR(ev.point[2], 10.0, 1e-12);   // snapped, exactly
    CHECK_NEAR(ev.point[0], 12.5, 1e-12);   // and only along the normal:
    CHECK_NEAR(ev.point[1], -7.25, 1e-12);  // the in-plane coordinates are untouched
    // the projection is orthogonal, so it works on a face that is not +Z too
    const double side[3] = {59.9999994, 3.0, 4.0};
    const PickEvidence sv = faceEvidence(bracket, 6, winding, side);
    CHECK_NEAR(sv.point[0], 60.0, 1e-12);
    CHECK_NEAR(sv.point[1], 3.0, 1e-12);
    CHECK_NEAR(sv.normal[0], 1.0, 1e-12);
  }

  // ── PART 3: identity must NOT see the evidence ───────────────────────────
  // Two clicks on one face at two pixels are the SAME face. If the hit point
  // reached key(), toggle() would add the second click instead of removing the
  // first, and shift-clicking to deselect would select twice.
  {
    const double p1[3] = {0, 0, 10}, p2[3] = {40, 20, 10};
    const EntityRef a = pickedFace(bracket, winding, "body_4", 2, p1);
    const EntityRef b = pickedFace(bracket, winding, "body_4", 2, p2);
    CHECK(a.pick.point[0] != b.pick.point[0]);  // the evidence really does differ
    CHECK(a == b);
    CHECK_EQ_STR(a.key(), b.key());
    SelectionService s;
    s.replaceWith({a});
    CHECK_EQ_INT(s.count(), 1);
    s.toggle(b);  // the same face, clicked elsewhere: this must REMOVE it
    CHECK_EQ_INT(s.count(), 0);
  }

  // ── PART 4: the kernel's edge classes, re-derived ────────────────────────
  const EdgeSet edges = deriveEdges(bracket);
  {
    // A box-with-a-boss has upright edges (the 4 plate corners + 4 boss corners)
    // and flat ones. The counts are what a keyword would act on, so they are
    // asserted as numbers rather than described.
    const std::uint32_t vertical = edgesInAxisClass(edges, EdgeAxisClass::Vertical);
    const std::uint32_t horizontal = edgesInAxisClass(edges, EdgeAxisClass::Horizontal);
    const std::uint32_t none = edgesInAxisClass(edges, EdgeAxisClass::None);
    CHECK_EQ_INT(vertical, 8);
    CHECK_EQ_INT(vertical + horizontal + none, static_cast<std::uint32_t>(edges.size()));
    CHECK_EQ_INT(none, 0);  // a rectilinear part has no slanted edges
    // and every upright edge really does run in z
    for (const MeshEdge& e : edges.edges) {
      if (classifyEdgeAxis(e) != EdgeAxisClass::Vertical) continue;
      CHECK_NEAR(std::fabs(e.points[e.points.size() - 1] - e.points[2]), e.length, 1e-9);
    }
  }

  // ── PART 4-bis: THE CLASS IS THE KERNEL'S, ON A PART WHERE IT CAN DIFFER ──
  // A class the UI computes differently from the kernel is worse than no class:
  // the count a pick is compared against stops being the count the keyword acts
  // on. Pick the eight flat box edges of the cross-drilled block, have the UI call
  // the two bore rims something else, and FILLET(%N, r, HORIZONTAL) is emitted as
  // "exactly what you picked" while the kernel rounds ten edges -- a wrong solid,
  // reported as success.
  const MeasureMesh drilled = makeCrossDrilledBlock();
  {
    const MeshMeasure dm = measureMesh(drilled);
    CHECK(dm.watertight);
    CHECK_EQ_INT(dm.reversedEdges, 0);
    CHECK(dm.outward);
    CHECK_EQ_INT(dm.faces, 7);
    CHECK_NEAR(dm.volume, 6000.0 - 1080.0 * std::sqrt(2.0), 1e-9);  // block - octagon*60
  }
  const EdgeSet drilledEdges = deriveEdges(drilled);
  {
    CHECK_EQ_INT(drilledEdges.size(), 14);  // 12 box edges + 2 rims
    std::size_t rims = 0, twoSegmentUprights = 0;
    for (const MeshEdge& e : drilledEdges.edges) {
      // Every edge agrees with the independent oracle -- the whole class
      // vocabulary, not a hand-picked instance of it.
      const EdgeAxisClass want = kernelClassOf(e);
      if (classifyEdgeAxis(e) != want) {
        std::printf("  edge %s: classifyEdgeAxis=%d, kernel rule=%d (%zu segments, %s)\n",
                    e.key().c_str(), static_cast<int>(classifyEdgeAxis(e)),
                    static_cast<int>(want), e.segments, e.closed ? "closed" : "open");
      }
      CHECK_EQ_INT(static_cast<int>(classifyEdgeAxis(e)), static_cast<int>(want));
      if (e.faceB == 7) {
        ++rims;
        CHECK(e.closed);
        CHECK_EQ_INT(static_cast<int>(classifyEdgeAxis(e)),
                     static_cast<int>(EdgeAxisClass::Horizontal));
      }
      if (e.box.max[2] - e.box.min[2] > 9.0) {
        CHECK_EQ_INT(e.segments, 2);
        ++twoSegmentUprights;
        CHECK_EQ_INT(static_cast<int>(classifyEdgeAxis(e)),
                     static_cast<int>(EdgeAxisClass::Vertical));
      }
    }
    CHECK_EQ_INT(rims, 2);
    CHECK_EQ_INT(twoSegmentUprights, 4);
    // THE COUNTS THE KEYWORDS ACT ON, as numbers.
    CHECK_EQ_INT(edgesInAxisClass(drilledEdges, EdgeAxisClass::Vertical), 4);
    CHECK_EQ_INT(edgesInAxisClass(drilledEdges, EdgeAxisClass::Horizontal), 10);
    CHECK_EQ_INT(edgesInAxisClass(drilledEdges, EdgeAxisClass::None), 0);
  }

  // ── PART 5: the registry, driven for real ────────────────────────────────
  CommandRegistry registry;
  PartDocument doc;
  UndoStack undoStack;
  SelectionService sel;
  CHECK_EQ_INT(registerPartCommands(registry, doc, undoStack), 71);
  CHECK_EQ_INT(doc.seed(IrValueKind::Solid, "body_4", "BOX",
                        {IrArg::num(120), IrArg::num(80), IrArg::num(10)}),
               1);

  // ── 5a. THE CENTRAL ASSERTION: three picks, three DIFFERENT statements ───
  // This is the measurement inverted. Before this change all three were
  // "HOLE(%1, 9, 0, 0, 0)".
  std::vector<std::string> holes;
  {
    const double onPlateTop[3] = {-50.0, -30.0, 10.0};
    const double onBossTop[3] = {0.0, 0.0, 28.0};
    const double onRight[3] = {60.0, 25.0, 5.0};
    const std::uint32_t faces[3] = {2, 7, 6};
    const double* pts[3] = {onPlateTop, onBossTop, onRight};
    for (int i = 0; i < 3; ++i) {
      sel.replaceWith({pickedFace(bracket, winding, "body_4", faces[i], pts[i])});
      sel.setFocus(sel.selection().front());
      CHECK(registry.dispatch("part.hole", sel, num1("diameter", 9)).ok());
      holes.push_back(lastLine(doc));
      CHECK(undoStack.undo(doc));
    }
    CHECK(holes[0] != holes[1]);
    CHECK(holes[0] != holes[2]);
    CHECK(holes[1] != holes[2]);
  }
  // ... and each is the RIGHT statement, not merely a different one.
  //
  // The axis is the INWARD normal: opHole runs a blind cutter from the point
  // along +axis, so it has to point into the metal
  // (forge-kernel/src/ft/FeatureTreeCompiler.cpp:2077).
  CHECK_EQ_STR(holes[0], "%2 = HOLE(%1, 9, -50, -30, 10, 0, 0, -1)");
  CHECK_EQ_STR(holes[1], "%2 = HOLE(%1, 9, 0, 0, 28, 0, 0, -1)");
  // THE ONE THAT WAS NOT EXPRESSIBLE AT ALL: a hole in a side face. The command
  // could only ever emit a +Z axis, so a cross-drilling could not be authored.
  CHECK_EQ_STR(holes[2], "%2 = HOLE(%1, 9, 60, 25, 5, -1, 0, 0)");

  // ── 5b. the same for the counterbore, and the SIGN IS THE OTHER WAY ──────
  // opCbore cuts its recess from (at - axis*depth) TOWARD the point, so the
  // OUTWARD normal is what puts the recess in the metal. Emitting the inward one
  // — which is what a hard-coded +Z with z = 0 amounted to — is how the shipped
  // command produced a part byte-identical to a plain hole.
  {
    const double onPlateTop[3] = {-50.0, -30.0, 10.0};
    const double onBossTop[3] = {0.0, 0.0, 28.0};
    CommandParams p;
    p.setNumber("diameter", 10);
    p.setNumber("cbore_diameter", 18);
    p.setNumber("cbore_depth", 5);
    sel.replaceWith({pickedFace(bracket, winding, "body_4", 2, onPlateTop)});
    sel.setFocus(sel.selection().front());
    CHECK(registry.dispatch("part.counterbore", sel, p).ok());
    const std::string a = lastLine(doc);
    CHECK(undoStack.undo(doc));
    CHECK_EQ_STR(a, "%2 = CBORE(%1, 10, 18, 5, -50, -30, 10, 0, 0, 1)");

    sel.replaceWith({pickedFace(bracket, winding, "body_4", 7, onBossTop)});
    sel.setFocus(sel.selection().front());
    CHECK(registry.dispatch("part.counterbore", sel, p).ok());
    const std::string b = lastLine(doc);
    CHECK(undoStack.undo(doc));
    CHECK(a != b);  // the measurement that used to say IDENTICAL
    CHECK_EQ_STR(b, "%2 = CBORE(%1, 10, 18, 5, 0, 0, 28, 0, 0, 1)");
  }

  // ── 5c. a number the user TYPED is never overridden by where they clicked ─
  {
    const double onPlateTop[3] = {-50.0, -30.0, 10.0};
    sel.replaceWith({pickedFace(bracket, winding, "body_4", 2, onPlateTop)});
    sel.setFocus(sel.selection().front());
    CommandParams p = num1("diameter", 9);
    p.setNumber("x", 25);
    p.setNumber("y", -15);
    CHECK(registry.dispatch("part.hole", sel, p).ok());
    // the typed position wins outright — including z, which is NOT silently
    // taken from the pick, because mixing a typed x with a picked z puts the
    // hole somewhere neither of them asked for
    CHECK_EQ_STR(lastLine(doc), "%2 = HOLE(%1, 9, 25, -15, 0, 0, 0, -1)");
    CHECK(undoStack.undo(doc));
  }

  // ── 5d. AN UNPICKED REFERENCE MUST EMIT EXACTLY WHAT IT USED TO ──────────
  // The feature tree, macros and Archie all build references with no evidence.
  // These four literals are copied from part_commands_test.cpp's existing
  // expectations: if this change re-placed those features it would be a much
  // worse defect than the one it fixes.
  {
    sel.replaceWith({plainRef("body_4", EntityKind::Face, "top")});
    CHECK(registry.dispatch("part.hole", sel, num1("diameter", 10)).ok());
    CHECK_EQ_STR(lastLine(doc), "%2 = HOLE(%1, 10, 0, 0, 0)");
    CHECK(undoStack.undo(doc));

    CommandParams p = num1("diameter", 10);
    p.setNumber("x", 25);
    p.setNumber("y", -15);
    p.setNumber("depth", 8);
    CHECK(registry.dispatch("part.hole", sel, p).ok());
    CHECK_EQ_STR(lastLine(doc), "%2 = HOLE(%1, 10, 25, -15, 0, 0, 0, 1, 8)");
    CHECK(undoStack.undo(doc));

    CommandParams q;
    q.setNumber("diameter", 11);
    q.setNumber("cbore_diameter", 18);
    q.setNumber("cbore_depth", 6);
    CHECK(registry.dispatch("part.counterbore", sel, q).ok());
    CHECK_EQ_STR(lastLine(doc), "%2 = CBORE(%1, 11, 18, 6, 0, 0, 0)");
    CHECK(undoStack.undo(doc));

    sel.replaceWith({plainRef("body_4", EntityKind::Edge, "e1"),
                     plainRef("body_4", EntityKind::Edge, "e2")});
    CHECK(registry.dispatch("part.fillet", sel, num1("radius", 4)).ok());
    CHECK_EQ_STR(lastLine(doc), "%2 = FILLET(%1, 4, ALL)");
    CHECK(undoStack.undo(doc));
  }

  // ── 5e. THE DRESS-UP COMMANDS MUST NOT SILENTLY WIDEN A PARTIAL PICK ─────
  // The kernel's whole edge vocabulary is ALL | VERTICAL | RIM | HORIZONTAL and
  // it refuses every quoted selector by name, so "these three edges" cannot be
  // said. Rounding all of them instead is the silent wrong answer this closes.
  {
    const double ro[3] = {200.0, 200.0, 200.0};
    const double rd[3] = {-1.0, -1.0, -1.0};
    // collect the upright edges of the body, in order
    std::vector<std::size_t> upright;
    for (std::size_t i = 0; i < edges.size(); ++i) {
      if (classifyEdgeAxis(edges.edges[i]) == EdgeAxisClass::Vertical) upright.push_back(i);
    }
    CHECK_EQ_INT(upright.size(), 8);

    // THREE of eight: refused, with the two numbers a user needs
    std::vector<EntityRef> some;
    for (int i = 0; i < 3; ++i) some.push_back(pickedEdge(edges, "body_4", upright[i], ro, rd));
    sel.replaceWith(some);
    const DispatchResult r = registry.dispatch("part.fillet", sel, num1("radius", 3));
    CHECK_EQ_INT(statusOf(r), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(r.detail.find("3 edges are picked") != std::string::npos);
    CHECK(r.detail.find("8 upright edges") != std::string::npos);
    CHECK_EQ_INT(doc.records().size(), 1);  // and NOTHING was written

    // ALL eight: a keyword says exactly that, so it runs and says VERTICAL
    std::vector<EntityRef> all;
    for (std::size_t i : upright) all.push_back(pickedEdge(edges, "body_4", i, ro, rd));
    sel.replaceWith(all);
    CHECK(registry.dispatch("part.fillet", sel, num1("radius", 3)).ok());
    CHECK_EQ_STR(lastLine(doc), "%2 = FILLET(%1, 3, VERTICAL)");
    CHECK(undoStack.undo(doc));

    // the same rule for the other two, including BLEND, which had no selector
    sel.replaceWith(some);
    CHECK_EQ_INT(statusOf(registry.dispatch("part.chamfer", sel, num1("distance", 2))),
                 static_cast<int>(DispatchStatus::EditRefused));
    CommandParams blend;
    blend.setNumber("radius_start", 1);
    blend.setNumber("radius_end", 3);
    CHECK_EQ_INT(statusOf(registry.dispatch("part.variable_fillet", sel, blend)),
                 static_cast<int>(DispatchStatus::EditRefused));
    CHECK_EQ_INT(doc.records().size(), 1);

    sel.replaceWith(all);
    CHECK(registry.dispatch("part.chamfer", sel, num1("distance", 2)).ok());
    CHECK_EQ_STR(lastLine(doc), "%2 = CHAMFER(%1, 2, VERTICAL)");
    CHECK(undoStack.undo(doc));
    CHECK(registry.dispatch("part.variable_fillet", sel, blend).ok());
    CHECK_EQ_STR(lastLine(doc), "%2 = BLEND(%1, 1, 3, VERTICAL)");
    CHECK(undoStack.undo(doc));

    // a MIXTURE of directions gets its own reason, not the counting one
    std::vector<EntityRef> mixed;
    mixed.push_back(pickedEdge(edges, "body_4", upright[0], ro, rd));
    for (std::size_t i = 0; i < edges.size(); ++i) {
      if (classifyEdgeAxis(edges.edges[i]) == EdgeAxisClass::Horizontal) {
        mixed.push_back(pickedEdge(edges, "body_4", i, ro, rd));
        break;
      }
    }
    CHECK_EQ_INT(mixed.size(), 2);
    sel.replaceWith(mixed);
    const DispatchResult mr = registry.dispatch("part.fillet", sel, num1("radius", 3));
    CHECK_EQ_INT(statusOf(mr), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(mr.detail.find("not all of one kind") != std::string::npos);

    // a TYPED selector is the user overriding all of this, and it still wins
    sel.replaceWith(some);
    CommandParams p = num1("radius", 3);
    p.setText("selector", "ALL");
    CHECK(registry.dispatch("part.fillet", sel, p).ok());
    CHECK_EQ_STR(lastLine(doc), "%2 = FILLET(%1, 3, ALL)");
    CHECK(undoStack.undo(doc));

    // HORIZONTAL is a keyword the kernel RESOLVES, so it must go in bare. It used
    // to be quoted — and forge::ft refuses a quoted token in a keyword slot.
    p.setText("selector", "HORIZONTAL");
    CHECK(registry.dispatch("part.fillet", sel, p).ok());
    CHECK_EQ_STR(lastLine(doc), "%2 = FILLET(%1, 3, HORIZONTAL)");
    CHECK(undoStack.undo(doc));
  }

  // ── 5e-bis. THE REFUSALS ARE SHOWN TO A USER, SO THEY ARE SCANNED AS PROSE ─
  // A refusal reaches the person as a sentence: ForgeShell writes it through
  // explainDispatch and ForgeFrame prints it in the status strip. The house rule
  // is that no developer prose is shown in this application, and the gate of
  // record for that — user_facing_text_test — drives tool-catalogue reasons,
  // empty states and plan verdicts, NOT the detail of a refused dispatch. Its
  // sentence count is IDENTICAL before and after this change (2152 both times),
  // which is the measurement saying these new strings are outside its reach.
  //
  // So they are held to the same standard here, through the same published judge
  // rather than a second opinion invented for this file.
  {
    const double ro[3] = {200.0, 200.0, 200.0};
    const double rd[3] = {-1.0, -1.0, -1.0};
    std::vector<std::size_t> upright;
    for (std::size_t i = 0; i < edges.size(); ++i) {
      if (classifyEdgeAxis(edges.edges[i]) == EdgeAxisClass::Vertical) upright.push_back(i);
    }
    std::vector<std::vector<EntityRef>> cases;
    {  // part of a class
      std::vector<EntityRef> v;
      for (int i = 0; i < 3; ++i) v.push_back(pickedEdge(edges, "body_4", upright[i], ro, rd));
      cases.push_back(v);
    }
    {  // two directions at once
      std::vector<EntityRef> v;
      v.push_back(pickedEdge(edges, "body_4", upright[0], ro, rd));
      for (std::size_t i = 0; i < edges.size(); ++i) {
        if (classifyEdgeAxis(edges.edges[i]) == EdgeAxisClass::Horizontal) {
          v.push_back(pickedEdge(edges, "body_4", i, ro, rd));
          break;
        }
      }
      cases.push_back(v);
    }
    {  // a census that went stale across a rebuild
      std::vector<EntityRef> v;
      for (int i = 0; i < 2; ++i) v.push_back(pickedEdge(edges, "body_4", upright[i], ro, rd));
      v[1].pick.classMembers = 99;
      cases.push_back(v);
    }
    {  // an edge in no class the kernel can name
      std::vector<EntityRef> v;
      v.push_back(pickedEdge(edges, "body_4", upright[0], ro, rd));
      v[0].pick.axisClass = EdgeAxisClass::None;
      cases.push_back(v);
    }
    std::size_t scanned = 0;
    for (const std::vector<EntityRef>& picks : cases) {
      sel.replaceWith(picks);
      for (const char* id : {"part.fillet", "part.chamfer", "part.variable_fillet"}) {
        CommandParams p;
        p.setNumber("radius", 3);
        p.setNumber("distance", 2);
        p.setNumber("radius_start", 1);
        p.setNumber("radius_end", 3);
        const DispatchResult r = registry.dispatch(id, sel, p);
        CHECK_EQ_INT(statusOf(r), static_cast<int>(DispatchStatus::EditRefused));
        CHECK(!r.detail.empty());
        // The sentence the user is actually shown is the wrapper around it.
        const std::string shown = explainUnavailable(id, registry.find(id), r.status, r.detail, {},
                                                     &sel);
        const std::vector<ProseFinding> f = scanUserFacingProse(shown);
        if (!f.empty()) {
          std::printf("  %s: \"%s\"\n        %s\n", id, shown.c_str(),
                      describeProseFindings(f).c_str());
        }
        CHECK(f.empty());
        // A refusal a user cannot act on is a refusal that wastes their time:
        // every one of these has to end in something to DO.
        CHECK(r.detail.find("Pick") != std::string::npos ||
              r.detail.find("Clear the selection") != std::string::npos);
        ++scanned;
      }
    }
    CHECK_EQ_INT(scanned, 12);
    CHECK_EQ_INT(doc.records().size(), 1);  // twelve refusals, nothing written
  }

  // ── 5f. every statement this file emits must pass the app's own validator ─
  // Emitting a well-formed sentence the kernel refuses is the failure mode the
  // audit already caught once (the app authored FILLET(%10, 3, "face:14"), its
  // own validateIr said ok, and the shipped worker stopped at op %11).
  {
    const double onPlateTop[3] = {-50.0, -30.0, 10.0};
    sel.replaceWith({pickedFace(bracket, winding, "body_4", 2, onPlateTop)});
    sel.setFocus(sel.selection().front());
    CommandParams p = num1("diameter", 9);
    p.setNumber("depth", 6);
    CHECK(registry.dispatch("part.hole", sel, p).ok());
    CHECK_EQ_STR(lastLine(doc), "%2 = HOLE(%1, 9, -50, -30, 10, 0, 0, -1, 6)");
    CHECK_EQ_INT(static_cast<int>(doc.lastCheck()), static_cast<int>(IrCheck::Ok));
    CHECK(undoStack.undo(doc));
  }

  // ── 5g. THE WRONG SOLID PART 4-bis EXISTS TO PREVENT, through the registry ──
  // The cross-drilled block has ten edges the kernel calls HORIZONTAL: eight on
  // the box and the two bore rims. Picking the eight box edges is PART of that
  // class and must be refused; picking all ten is the class and must say so.
  // The picks are chosen by GEOMETRY (which faces an edge divides, how tall its
  // box is), never by the classifier this section is checking.
  {
    const double ro[3] = {0.0, 0.0, 100.0};
    const double rd[3] = {0.0, 0.0, -1.0};
    std::vector<EntityRef> flatBox, flatAll, upright;
    for (std::size_t i = 0; i < drilledEdges.size(); ++i) {
      const MeshEdge& e = drilledEdges.edges[i];
      const EntityRef ref = pickedEdge(drilledEdges, "body_4", i, ro, rd);
      if (e.faceB == 7) {  // a bore rim
        flatAll.push_back(ref);
      } else if (e.box.max[2] - e.box.min[2] < 1e-9) {
        flatBox.push_back(ref);
        flatAll.push_back(ref);
      } else {
        upright.push_back(ref);
      }
    }
    CHECK_EQ_INT(flatBox.size(), 8);
    CHECK_EQ_INT(flatAll.size(), 10);
    CHECK_EQ_INT(upright.size(), 4);

    sel.replaceWith(flatBox);
    const DispatchResult r = registry.dispatch("part.fillet", sel, num1("radius", 1));
    CHECK_EQ_INT(statusOf(r), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(r.detail.find("8 edges are picked") != std::string::npos);
    CHECK(r.detail.find("10 flat edges") != std::string::npos);
    CHECK_EQ_INT(doc.records().size(), 1);

    // ... and the chamfer's refusal describes a chamfer. It used to offer to
    // "round all" the edges, which is what a different command does.
    const DispatchResult c = registry.dispatch("part.chamfer", sel, num1("distance", 1));
    CHECK_EQ_INT(statusOf(c), static_cast<int>(DispatchStatus::EditRefused));
    CHECK(c.detail.find("chamfer all 10") != std::string::npos);
    CHECK(c.detail.find("round") == std::string::npos);
    CHECK_EQ_INT(doc.records().size(), 1);

    sel.replaceWith(flatAll);
    CHECK(registry.dispatch("part.fillet", sel, num1("radius", 1)).ok());
    CHECK_EQ_STR(lastLine(doc), "%2 = FILLET(%1, 1, HORIZONTAL)");
    CHECK(undoStack.undo(doc));

    sel.replaceWith(upright);
    CHECK(registry.dispatch("part.chamfer", sel, num1("distance", 1)).ok());
    CHECK_EQ_STR(lastLine(doc), "%2 = CHAMFER(%1, 1, VERTICAL)");
    CHECK(undoStack.undo(doc));
  }

  return H.finish();
}
