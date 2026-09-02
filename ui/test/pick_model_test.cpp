// ui/test/pick_model_test.cpp — the viewport pick engine, and its TIMING on a
// part the size of the ones this programme is actually scored on.
//
// ── why the timing lives in a gate and not in a notebook ────────────────────
// "Picking must stay interactive on a real part" is a claim about microseconds,
// and the ground truth is specific: task_101 compiles to 329 faces / 753 edges,
// and the archie_edit_214 input is 430 faces (167 cylinder, 125 torus, 67
// b-spline, 25 sphere, 4 cone, 42 plane) — heavy CURVED geometry, which is
// exactly the case a coarse acceleration structure handles worst. So the
// fixture here is a 400-face closed torus tessellated to 20,000 triangles: 400
// distinct B-rep face ids, every one of them curved, adjacent patches sharing
// bit-identical boundary vertices so the weld is exact and every census below
// is a closed-form number rather than a fitted one.
//
// ── the two instruments, and why neither alone is enough ───────────────────
//  1. A COUNT. PickAccelerator::lastTested() is how many ray/triangle tests the
//     grid actually performed. It is deterministic, machine-independent and
//     immune to a loaded CI runner, so THAT is what the acceleration assertion
//     is made against.
//  2. A CLOCK. The microseconds are reported and asserted only against a
//     catastrophe bound, because a wall-clock assertion tight enough to be
//     interesting is tight enough to flake.
//
// An instrument can MEASURE BACKWARDS, so the clock gets a positive control: a
// monotonic sweep over 1x / 2x / 4x triangle counts through the LINEAR scanner,
// whose cost is O(triangles) by construction. If those three times are not
// increasing, the timer is not measuring what this file says it is and every
// number below is void.
//
// The grid is also checked for EQUALITY with the linear reference on every ray
// it is timed against — same face id, same distance. A faster answer that is a
// different answer is not an optimisation.
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/PickModel.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using forge::ui::deriveEdges;
using forge::ui::deriveVertices;
using forge::ui::EdgeSet;
using forge::ui::EntityKind;
using forge::ui::FacePick;
using forge::ui::MeasureMesh;
using forge::ui::PickAccelerator;
using forge::ui::PickRequest;
using forge::ui::PickScene;
using forge::ui::pickFaceLinear;
using forge::ui::pickScene;
using forge::ui::ScenePick;
using forge::ui::VertexSet;

namespace {

// ── fixtures ────────────────────────────────────────────────────────────────

// A unit-ish axis-aligned box, 6 face ids, 12 triangles, wound outward.
// Corner (0,0,0)..(40,30,20) so the three extents differ and an axis mix-up
// cannot pass by symmetry.
MeasureMesh makeBox() {
  const double X = 40.0, Y = 30.0, Z = 20.0;
  const double v[8][3] = {{0, 0, 0}, {X, 0, 0}, {X, Y, 0}, {0, Y, 0},
                          {0, 0, Z}, {X, 0, Z}, {X, Y, Z}, {0, Y, Z}};
  // face id -> the four corner indices, counter-clockwise seen from outside
  const int quad[6][4] = {
      {0, 3, 2, 1},  // 1: bottom  z = 0
      {4, 5, 6, 7},  // 2: top     z = Z
      {0, 1, 5, 4},  // 3: front   y = 0
      {2, 3, 7, 6},  // 4: back    y = Y
      {0, 4, 7, 3},  // 5: left    x = 0
      {1, 2, 6, 5},  // 6: right   x = X
  };
  MeasureMesh m;
  for (int f = 0; f < 6; ++f) {
    const double* a = v[quad[f][0]];
    const double* b = v[quad[f][1]];
    const double* c = v[quad[f][2]];
    const double* d = v[quad[f][3]];
    m.addTriangle(a, b, c, static_cast<std::uint32_t>(f + 1));
    m.addTriangle(a, c, d, static_cast<std::uint32_t>(f + 1));
  }
  return m;
}

// ── the 400-face curved part ────────────────────────────────────────────────
// A closed torus split into uPatches x vPatches B-rep faces, each tessellated
// into k x k quads. Coordinates are computed from INTEGER grid indices, so two
// patches that share a boundary emit bit-identical doubles and the weld is
// exact rather than tolerant.
struct TorusSpec {
  int uPatches = 20;
  int vPatches = 20;
  int k = 5;  // quads per patch per axis
  double major = 60.0;
  double minor = 20.0;
};

void torusPoint(const TorusSpec& s, int a, int b, double out[3]) {
  const int NU = s.uPatches * s.k;
  const int NV = s.vPatches * s.k;
  const double twoPi = 6.283185307179586;
  const double u = twoPi * static_cast<double>(((a % NU) + NU) % NU) / static_cast<double>(NU);
  const double vv = twoPi * static_cast<double>(((b % NV) + NV) % NV) / static_cast<double>(NV);
  const double ring = s.major + s.minor * std::cos(vv);
  out[0] = ring * std::cos(u);
  out[1] = ring * std::sin(u);
  out[2] = s.minor * std::sin(vv);
}

MeasureMesh makeTorus(const TorusSpec& s) {
  MeasureMesh m;
  for (int iu = 0; iu < s.uPatches; ++iu) {
    for (int iv = 0; iv < s.vPatches; ++iv) {
      const std::uint32_t faceId = static_cast<std::uint32_t>(iu * s.vPatches + iv + 1);
      for (int i = 0; i < s.k; ++i) {
        for (int j = 0; j < s.k; ++j) {
          const int a0 = iu * s.k + i, a1 = a0 + 1;
          const int b0 = iv * s.k + j, b1 = b0 + 1;
          double p00[3], p10[3], p11[3], p01[3];
          torusPoint(s, a0, b0, p00);
          torusPoint(s, a1, b0, p10);
          torusPoint(s, a1, b1, p11);
          torusPoint(s, a0, b1, p01);
          m.addTriangle(p00, p10, p11, faceId);
          m.addTriangle(p00, p11, p01, faceId);
        }
      }
    }
  }
  return m;
}

// A deterministic 32-bit LCG (Numerical Recipes constants). Reproducible on
// every platform, which is what a timing fixture needs so two runs compare.
struct Lcg {
  std::uint32_t state = 12345u;
  std::uint32_t next() {
    state = state * 1664525u + 1013904223u;
    return state;
  }
  double unit() { return static_cast<double>(next()) / 4294967296.0; }
  double range(double lo, double hi) { return lo + (hi - lo) * unit(); }
};

struct Ray {
  double o[3];
  double d[3];
};

// Rays fired from a shell around the part AT A POINT ON ITS SURFACE — which is
// what a user's cursor does. Aiming at the bounding box instead would send more
// than half the rays through the hole in the middle of a torus and time the
// early-out rather than the pick.
std::vector<Ray> makeRays(std::size_t n, double shell, const TorusSpec& spec, std::uint32_t seed) {
  Lcg rng{seed};
  std::vector<Ray> rays;
  rays.reserve(n);
  const double twoPi = 6.283185307179586;
  for (std::size_t i = 0; i < n; ++i) {
    // Uniform-ish direction on the sphere for the eye position.
    const double z = rng.range(-1.0, 1.0);
    const double phi = rng.range(0.0, twoPi);
    const double r = std::sqrt(1.0 - z * z);
    Ray ray;
    ray.o[0] = shell * r * std::cos(phi);
    ray.o[1] = shell * r * std::sin(phi);
    ray.o[2] = shell * z;
    // ...and a target on the analytic torus the tessellation approximates.
    const double u = rng.range(0.0, twoPi);
    const double v = rng.range(0.0, twoPi);
    const double ring = spec.major + spec.minor * std::cos(v);
    const double t[3] = {ring * std::cos(u), ring * std::sin(u), spec.minor * std::sin(v)};
    double len = 0.0;
    for (int a = 0; a < 3; ++a) {
      ray.d[a] = t[a] - ray.o[a];
      len += ray.d[a] * ray.d[a];
    }
    len = std::sqrt(len);
    for (int a = 0; a < 3; ++a) ray.d[a] /= len;
    rays.push_back(ray);
  }
  return rays;
}

double microsPerCall(std::chrono::steady_clock::duration d, std::size_t calls) {
  const double us = static_cast<double>(
      std::chrono::duration_cast<std::chrono::nanoseconds>(d).count()) / 1000.0;
  return calls == 0 ? 0.0 : us / static_cast<double>(calls);
}

// ── 1. face picking on a box, linear and accelerated ───────────────────────
int testBoxFace() {
  forge::uitest::Harness H("pick:box-face");
  const MeasureMesh box = makeBox();
  CHECK_EQ_INT(box.triangleCount(), 12);

  PickAccelerator grid;
  grid.build(box);
  CHECK(grid.built());
  CHECK_EQ_INT(grid.triangles(), 12);

  // Straight down onto the top face (id 2) from above the middle.
  const double o[3] = {20.0, 15.0, 100.0};
  const double d[3] = {0.0, 0.0, -1.0};
  const FacePick lin = pickFaceLinear(box, o, d);
  const FacePick acc = grid.pick(box, o, d);
  CHECK_EQ_INT(lin.faceId, 2);
  CHECK_EQ_INT(acc.faceId, 2);
  CHECK_NEAR(lin.distance, 80.0, 1e-9);
  CHECK_NEAR(acc.distance, 80.0, 1e-9);
  CHECK_NEAR(acc.point[2], 20.0, 1e-9);

  // Up from below hits the BOTTOM face, not the top: nearest hit, not any hit.
  const double up[3] = {0.0, 0.0, 1.0};
  const double below[3] = {20.0, 15.0, -100.0};
  CHECK_EQ_INT(pickFaceLinear(box, below, up).faceId, 1);
  CHECK_EQ_INT(grid.pick(box, below, up).faceId, 1);

  // Sideways at the right face.
  const double side[3] = {200.0, 15.0, 10.0};
  const double west[3] = {-1.0, 0.0, 0.0};
  CHECK_EQ_INT(pickFaceLinear(box, side, west).faceId, 6);
  CHECK_EQ_INT(grid.pick(box, side, west).faceId, 6);

  // A clean miss is a miss in both.
  const double away[3] = {0.0, 0.0, 1.0};
  const double high[3] = {1000.0, 1000.0, 1000.0};
  CHECK_EQ_INT(pickFaceLinear(box, high, away).faceId, 0);
  CHECK_EQ_INT(grid.pick(box, high, away).faceId, 0);
  CHECK(!grid.pick(box, high, away).hit());

  // An empty mesh answers "miss" rather than reading past the end.
  const MeasureMesh empty;
  CHECK_EQ_INT(pickFaceLinear(empty, o, d).faceId, 0);
  PickAccelerator none;
  none.build(empty);
  CHECK(!none.built());
  CHECK_EQ_INT(none.pick(empty, o, d).faceId, 0);
  return H.finish();
}

// ── 2. vertex recovery on a box ────────────────────────────────────────────
int testBoxVertices() {
  forge::uitest::Harness H("pick:box-vertices");
  const MeasureMesh box = makeBox();
  const VertexSet vs = deriveVertices(box);

  // A box has 8 corners and nothing else: every welded point IS a corner,
  // because a 12-triangle box has no point interior to a face.
  CHECK_EQ_INT(vs.size(), 8);
  CHECK_EQ_INT(vs.weldedPoints, 8);
  CHECK_EQ_INT(vs.twoFacePoints, 0);
  CHECK_EQ_INT(vs.oneFacePoints, 0);
  for (const forge::ui::MeshVertex& v : vs.vertices) {
    CHECK_EQ_INT(v.faces.size(), 3);
    CHECK_EQ_INT(v.component, 0);  // three planes meet in one point
  }

  // The corner at the origin is where faces 1 (bottom), 3 (front) and 5 (left)
  // meet, and the key names exactly that, sorted.
  const std::size_t at = vs.indexOf("vertex@1_3_5#0");
  CHECK(at != forge::ui::kNoVertex);
  if (at != forge::ui::kNoVertex) {
    CHECK_NEAR(vs.vertices[at].p[0], 0.0, 1e-12);
    CHECK_NEAR(vs.vertices[at].p[1], 0.0, 1e-12);
    CHECK_NEAR(vs.vertices[at].p[2], 0.0, 1e-12);
  }
  CHECK(vs.indexOf("vertex@2_4_6#0") != forge::ui::kNoVertex);  // the far corner
  CHECK(vs.indexOf("vertex@9_9_9#0") == forge::ui::kNoVertex);

  // DETERMINISM: the same mesh gives byte-identical keys in the same order.
  const VertexSet again = deriveVertices(box);
  CHECK_EQ_INT(again.size(), vs.size());
  bool identical = again.size() == vs.size();
  for (std::size_t i = 0; identical && i < vs.size(); ++i) {
    identical = again.vertices[i].key() == vs.vertices[i].key();
  }
  CHECK(identical);

  // Picking a corner: a ray down the (1,1,1) diagonal at the far corner.
  const double o[3] = {40.0 + 30.0, 30.0 + 30.0, 20.0 + 30.0};
  const double d[3] = {-0.5773502691896258, -0.5773502691896258, -0.5773502691896258};
  const forge::ui::VertexPick vp = forge::ui::pickVertex(vs, o, d, 0.5);
  CHECK(vp.hit());
  if (vp.hit()) CHECK_EQ_STR(vs.vertices[vp.index].key(), std::string("vertex@2_4_6#0"));

  // ...and a tolerance that is too small refuses rather than snapping wildly.
  const double off[3] = {70.0, 60.0, 60.0};
  CHECK(!forge::ui::pickVertex(vs, off, d, 1e-6).hit());
  return H.finish();
}

// ── 3. the typed pick: filter, priority and the depth test ─────────────────
int testScenePick() {
  forge::uitest::Harness H("pick:scene");
  const MeasureMesh box = makeBox();
  PickAccelerator grid;
  grid.build(box);
  const EdgeSet edges = deriveEdges(box);
  const VertexSet verts = deriveVertices(box);
  CHECK_EQ_INT(edges.size(), 12);  // a box has twelve
  CHECK_EQ_INT(verts.size(), 8);

  PickScene scene;
  scene.mesh = &box;
  scene.accelerator = &grid;
  scene.edges = &edges;
  scene.vertices = &verts;
  scene.bodyId = "body.test";

  // (a) middle of the top face, Any filter -> a FACE, because no edge or vertex
  //     is within tolerance.
  PickRequest r;
  r.origin[0] = 20.0; r.origin[1] = 15.0; r.origin[2] = 100.0;
  r.direction[0] = 0.0; r.direction[1] = 0.0; r.direction[2] = -1.0;
  r.filter = EntityKind::Any;
  r.pixelTolerance = 8.0;
  r.worldPerPixel = 0.05;  // 0.4 mm snap radius
  ScenePick p = pickScene(scene, r);
  CHECK(p.hit());
  CHECK(p.ref.kind == EntityKind::Face);
  CHECK_EQ_STR(p.ref.persistentName, std::string("face@2"));
  CHECK_EQ_STR(p.ref.bodyId, std::string("body.test"));
  CHECK(p.ref.valid());

  // (b) straight down at a CORNER of the top face -> a VERTEX wins.
  r.origin[0] = 40.0; r.origin[1] = 30.0;
  p = pickScene(scene, r);
  CHECK(p.hit());
  CHECK(p.ref.kind == EntityKind::Vertex);
  CHECK_EQ_STR(p.ref.persistentName, std::string("vertex@2_4_6#0"));

  // (c) ...and the FACE filter refuses that vertex and answers with the face.
  r.filter = EntityKind::Face;
  p = pickScene(scene, r);
  CHECK(p.ref.kind == EntityKind::Face);
  CHECK_EQ_STR(p.ref.persistentName, std::string("face@2"));

  // (d) down at the middle of the top face's +X edge -> an EDGE wins under Any.
  r.filter = EntityKind::Any;
  r.origin[0] = 40.0; r.origin[1] = 15.0;
  p = pickScene(scene, r);
  CHECK(p.hit());
  CHECK(p.ref.kind == EntityKind::Edge);
  CHECK_EQ_STR(p.ref.persistentName, std::string("edge@2_6#0"));

  // (e) EDGE filter over the middle of a face: nothing is within tolerance, so
  //     the pick MISSES rather than falling back to the face. A filter that
  //     silently degrades is how a command runs on the wrong topology.
  r.filter = EntityKind::Edge;
  r.origin[0] = 20.0; r.origin[1] = 15.0;
  p = pickScene(scene, r);
  CHECK(!p.hit());

  // (f) BODY filter: any surface hit names the whole body, with no sub-entity
  //     name — which is what Types.hpp says a whole-body reference carries.
  r.filter = EntityKind::Body;
  p = pickScene(scene, r);
  CHECK(p.hit());
  CHECK(p.ref.kind == EntityKind::Body);
  CHECK(p.ref.persistentName.empty());
  CHECK(p.ref.valid());
  CHECK_EQ_INT(p.faceId, 2);  // the surface it actually struck is still reported

  // (g) THE DEPTH TEST. Aim down the +X face from outside, along -X, at the
  //     height of the top-back edge. The vertex at the FAR corner
  //     (x = 0 side) is nowhere near the ray; the near one is. Without the
  //     depth test a far-side entity within the tolerance TUBE would win.
  r.filter = EntityKind::Any;
  r.origin[0] = 400.0; r.origin[1] = 30.0; r.origin[2] = 20.0;
  r.direction[0] = -1.0; r.direction[1] = 0.0; r.direction[2] = 0.0;
  p = pickScene(scene, r);
  CHECK(p.hit());
  CHECK(p.ref.kind == EntityKind::Vertex);
  CHECK_EQ_STR(p.ref.persistentName, std::string("vertex@2_4_6#0"));  // the NEAR corner
  CHECK_NEAR(p.point[0], 40.0, 1e-9);

  // (h) a miss stays a miss for every filter.
  r.origin[0] = 400.0; r.origin[1] = 400.0; r.origin[2] = 400.0;
  r.direction[0] = 1.0; r.direction[1] = 0.0; r.direction[2] = 0.0;
  for (EntityKind k : {EntityKind::Any, EntityKind::Face, EntityKind::Edge, EntityKind::Vertex,
                       EntityKind::Body}) {
    r.filter = k;
    CHECK(!pickScene(scene, r).hit());
  }

  // (i) a scene with no body id cannot produce a reference at all: an EntityRef
  //     with an empty bodyId is invalid() and no command could resolve it.
  PickScene anonymous = scene;
  anonymous.bodyId.clear();
  r.origin[0] = 20.0; r.origin[1] = 15.0; r.origin[2] = 100.0;
  r.direction[0] = 0.0; r.direction[2] = -1.0; r.direction[1] = 0.0;
  r.filter = EntityKind::Any;
  CHECK(!pickScene(anonymous, r).hit());

  // (j) a filter of a kind this engine cannot produce (Sketch, Feature) refuses
  //     rather than answering with something else.
  r.filter = EntityKind::Sketch;
  CHECK(!pickScene(scene, r).hit());
  r.filter = EntityKind::Feature;
  CHECK(!pickScene(scene, r).hit());
  return H.finish();
}

// ── 4. the 400-face curved part: census, equality and TIMING ───────────────
int testRealSizedPart() {
  forge::uitest::Harness H("pick:400-face-part");
  const TorusSpec spec;
  const MeasureMesh mesh = makeTorus(spec);

  // The fixture is the size the claim is about. Every number here is closed
  // form, so a generator that quietly built something else fails at once.
  const std::size_t faces = static_cast<std::size_t>(spec.uPatches * spec.vPatches);
  CHECK_EQ_INT(faces, 400);
  CHECK_EQ_INT(mesh.triangleCount(), 20000);
  CHECK_EQ_INT(mesh.faces().size(), 400);

  PickAccelerator grid;
  const auto buildStart = std::chrono::steady_clock::now();
  grid.build(mesh);
  const auto buildEnd = std::chrono::steady_clock::now();
  CHECK(grid.built());
  CHECK_EQ_INT(grid.triangles(), 20000);
  // A sane grid: at most four stored entries per triangle. A duplication factor
  // above that means the resolution is wrong and the walk is doing the linear
  // scan in disguise.
  CHECK(grid.entries() <= 4 * mesh.triangleCount());

  const VertexSet verts = deriveVertices(mesh);
  // 100 x 100 welded grid points. 20 x 20 of them are patch CORNERS where four
  // faces meet; the rest lie on one patch boundary (two faces) or inside a
  // patch (one face). These add up to 10,000 exactly.
  CHECK_EQ_INT(verts.weldedPoints, 10000);
  CHECK_EQ_INT(verts.size(), 400);
  CHECK_EQ_INT(verts.twoFacePoints, 3200);
  CHECK_EQ_INT(verts.oneFacePoints, 6400);
  bool allFour = true;
  for (const forge::ui::MeshVertex& v : verts.vertices) {
    if (v.faces.size() != 4) allFour = false;
  }
  CHECK(allFour);  // four patches meet at every corner of this tiling

  const EdgeSet edges = deriveEdges(mesh);
  // Each of the 400 patches has four neighbours and every pair meets along one
  // connected chain: 400 * 4 / 2 = 800 recovered edges.
  CHECK_EQ_INT(edges.size(), 800);

  // ── the rays ──────────────────────────────────────────────────────────────
  const std::size_t kRays = 2000;
  const std::vector<Ray> rays = makeRays(kRays, 300.0, spec, 20260831u);

  // Linear reference first, and keep every answer.
  std::vector<FacePick> reference;
  reference.reserve(kRays);
  const auto linStart = std::chrono::steady_clock::now();
  for (const Ray& ray : rays) reference.push_back(pickFaceLinear(mesh, ray.o, ray.d));
  const auto linEnd = std::chrono::steady_clock::now();

  // Then the grid, asserting EQUALITY as it goes.
  std::size_t mismatches = 0;
  std::size_t hits = 0;
  std::size_t testedTotal = 0;
  std::size_t testedWorst = 0;
  const auto accStart = std::chrono::steady_clock::now();
  for (std::size_t i = 0; i < rays.size(); ++i) {
    const FacePick got = grid.pick(mesh, rays[i].o, rays[i].d);
    if (got.faceId != reference[i].faceId) ++mismatches;
    if (got.faceId != 0 && std::fabs(got.distance - reference[i].distance) > 1e-9) ++mismatches;
    if (got.faceId != 0) ++hits;
    const std::size_t tested = grid.lastTested();
    testedTotal += tested;
    if (tested > testedWorst) testedWorst = tested;
  }
  const auto accEnd = std::chrono::steady_clock::now();

  CHECK_EQ_INT(mismatches, 0);
  // The fixture has to be doing real work: a ray set that mostly misses would
  // time the early-out and say nothing about picking. Every ray is aimed at the
  // analytic surface, so the shortfall from 100% is only the rays whose target
  // the FACETED surface has pulled inside its chord — a few percent.
  CHECK(hits > (kRays * 9) / 10);

  const double linUs = microsPerCall(linEnd - linStart, kRays);
  const double accUs = microsPerCall(accEnd - accStart, kRays);
  const double buildMs = static_cast<double>(std::chrono::duration_cast<std::chrono::microseconds>(
                             buildEnd - buildStart).count()) / 1000.0;
  const double meanTested = static_cast<double>(testedTotal) / static_cast<double>(kRays);

  std::printf(
      "[pick:400-face-part] 400 faces / %zu triangles / %zu recovered edges / %zu vertices\n"
      "    grid            %d x %d x %d cells, %zu entries (%.2f per triangle), built in %.2f ms\n"
      "    LINEAR scan     %8.2f us/pick   (%zu triangle tests per pick, by construction)\n"
      "    GRID   scan     %8.2f us/pick   (mean %.1f triangle tests, worst %zu)\n"
      "    speed-up        %8.1fx wall, %.1fx in triangle tests\n"
      "    %zu of %zu rays hit; %zu answers differed from the linear reference\n",
      mesh.triangleCount(), edges.size(), verts.size(), grid.dim(0), grid.dim(1), grid.dim(2),
      grid.entries(),
      static_cast<double>(grid.entries()) / static_cast<double>(mesh.triangleCount()), buildMs,
      linUs, mesh.triangleCount(), accUs, meanTested, testedWorst,
      accUs > 0.0 ? linUs / accUs : 0.0,
      meanTested > 0.0 ? static_cast<double>(mesh.triangleCount()) / meanTested : 0.0,
      hits, kRays, mismatches);

  // ── the acceleration assertion is a COUNT, not a clock ───────────────────
  // Deterministic and machine-independent: the grid must touch under 5% of the
  // triangles on an average pick. A regression to a linear walk fails here on
  // any runner, loaded or idle.
  CHECK(meanTested < 0.05 * static_cast<double>(mesh.triangleCount()));

  // ── the clock assertion is a CATASTROPHE bound ───────────────────────────
  // One 60 Hz frame is 16,667 us. A pick that costs a whole millisecond is
  // still comfortably interactive at hover rates; anything above 2000 us is a
  // structural regression rather than a busy runner.
  CHECK(accUs < 2000.0);
  CHECK(buildMs < 2000.0);
  return H.finish();
}

// ── 5. the positive control for the CLOCK ──────────────────────────────────
// The linear scanner is O(triangles) by construction, so its cost MUST rise
// with the triangle count. If it does not, the timer in this file is not
// measuring elapsed work and every microsecond printed above is void.
//
// ── why ONE timed pass per size is not a measurement ────────────────────────
// This gate went red on ubuntu-latest at a commit that touched nothing it
// reads, and green on the same code one run earlier (34.69 -> 77.75 -> 142.51
// us). The red run read 922.92 -> 267.33 -> 184.89 us: MONOTONICALLY DOWN, with
// the FIRST sample 27x the same sample in the green run and the LAST sample in
// its normal band. A linear scan that got 27x slower for 3,200 triangles and
// stayed normal for 12,800 is not a thing that can happen; what the first timed
// region actually measured was PROCESS COLD START -- first-touch page faults on
// a freshly built mesh, a cold instruction cache, and an unramped clock on a
// cold, shared, throttled runner. A dev machine is warm and pays none of it,
// which is precisely why this only ever failed in CI.
//
// The assertion is NOT the thing that was wrong and is UNCHANGED below. What
// was wrong is that a single-shot sample measures work PLUS whatever else the
// machine was doing, so two corrections make the sample mean what it says:
//
//   1. a WARM-UP pass per size, outside the clock, so the page faults and the
//      cold caches are paid before the timer starts. The first size also gets
//      the process-level warm-up for free by being warmed the same way.
//   2. the MINIMUM of kReps timed repeats rather than one. Scheduler noise on a
//      shared runner is ONE-SIDED -- preemption only ever ADDS time -- so the
//      minimum is the robust estimator of the cost of the work itself. It
//      relaxes nothing: it estimates the same quantity the assertion has always
//      been about, with the interference removed.
int testTimerIsOrientedForward() {
  forge::uitest::Harness H("pick:timer-positive-control");
  const std::size_t kRays = 400;
  const int kReps = 5;
  const std::vector<Ray> rays = makeRays(kRays, 300.0, TorusSpec{}, 7u);

  double us[3] = {0.0, 0.0, 0.0};
  std::size_t tris[3] = {0, 0, 0};
  const int ks[3] = {2, 3, 4};  // 3,200 / 7,200 / 12,800 triangles
  for (int i = 0; i < 3; ++i) {
    TorusSpec spec;
    spec.k = ks[i];
    const MeasureMesh mesh = makeTorus(spec);
    tris[i] = mesh.triangleCount();
    std::uint32_t sink = 0;

    // (1) warm up: touch every page of this mesh and this code path OUTSIDE the
    // clock, so no timed region below pays for a first touch.
    for (const Ray& r : rays) sink += pickFaceLinear(mesh, r.o, r.d).faceId;

    // (2) the minimum over kReps. Noise is one-sided, so the floor is the work.
    double best = 0.0;
    for (int rep = 0; rep < kReps; ++rep) {
      const auto t0 = std::chrono::steady_clock::now();
      for (const Ray& r : rays) sink += pickFaceLinear(mesh, r.o, r.d).faceId;
      const auto t1 = std::chrono::steady_clock::now();
      const double got = microsPerCall(t1 - t0, kRays);
      if (rep == 0 || got < best) best = got;
    }
    us[i] = best;
    // Consume the result so the loop cannot be optimised away entirely.
    CHECK(sink > 0);
  }
  std::printf("[pick:timer-positive-control] linear scan cost vs mesh size "
              "(best of %d, after a warm-up pass): "
              "%zu tris %.2f us  ->  %zu tris %.2f us  ->  %zu tris %.2f us\n",
              kReps, tris[0], us[0], tris[1], us[1], tris[2], us[2]);
  CHECK(tris[0] < tris[1] && tris[1] < tris[2]);
  CHECK(us[0] < us[1]);
  CHECK(us[1] < us[2]);
  return H.finish();
}

// ── 6. the pixel -> world tolerance conversion ─────────────────────────────
int testWorldPerPixel() {
  forge::uitest::Harness H("pick:tolerance");
  // 45 degrees vertical fov, 800 px tall, eye 200 mm away: the visible height
  // at the target is 2 * 200 * tan(22.5 deg) = 165.685 mm over 800 px.
  const double fov = 0.7853981633974483;
  const double w = forge::ui::worldPerPixel(200.0, fov, 800.0);
  CHECK_NEAR(w, 2.0 * 200.0 * std::tan(0.5 * fov) / 800.0, 1e-12);
  CHECK_NEAR(w * 800.0, 165.68542494923804, 1e-9);

  // It scales with the eye distance -- that is the whole point: an edge stays
  // as easy to hit zoomed out as zoomed in.
  CHECK_NEAR(forge::ui::worldPerPixel(400.0, fov, 800.0), 2.0 * w, 1e-12);
  // ...and shrinks with a taller viewport.
  CHECK_NEAR(forge::ui::worldPerPixel(200.0, fov, 1600.0), 0.5 * w, 1e-12);
  // Degenerate inputs answer rather than divide by zero.
  CHECK_NEAR(forge::ui::worldPerPixel(0.0, fov, 800.0), 0.0, 1e-12);
  CHECK(forge::ui::worldPerPixel(200.0, fov, 0.0) > 0.0);
  return H.finish();
}

}  // namespace

int main() {
  int rc = 0;
  rc |= testBoxFace();
  rc |= testBoxVertices();
  rc |= testScenePick();
  rc |= testRealSizedPart();
  rc |= testTimerIsOrientedForward();
  rc |= testWorldPerPixel();
  return rc;
}
