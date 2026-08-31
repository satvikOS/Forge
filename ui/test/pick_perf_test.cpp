// ui/test/pick_perf_test.cpp
//
// IS PICKING STILL INTERACTIVE AT 400 FACES? MEASURED, NOT ASSUMED.
//
// ── why a timing gate, and why this one ─────────────────────────────────────
// Hover picking runs on EVERY frame the cursor moves. Every other gate in this
// directory asserts an ANSWER; none of them asserts that the answer arrives in
// time, and a pick that is correct at 40 ms is a pick the user experiences as a
// broken application. The reference part is the owner's own: archie_edit_214's
// input carries 430 B-rep faces, and task_101's ground truth is 329 faces / 753
// edges, so 400 faces with ~760 recovered edges is the size the app has to stay
// interactive at.
//
// ── what is measured, and what is NOT ───────────────────────────────────────
// MEASURED, because they are forge::ui and run headless:
//   * deriveEdges()  — the whole edge model, rebuilt once per geometry change.
//   * pickEdge()     — the per-frame hover path, and the reason this file exists.
//
// NOT MEASURED HERE, and it is a real gap rather than an oversight: the FACE
// pick is forge::desktop::KernelScene::pick, which reads the GPU vertex stream
// filled by the kernel, so it cannot be driven without linking forge-kernel and
// OCCT. Its cost is the same shape as the edge pick's — a linear scan of the
// whole soup, O(triangles) per pick, with no spatial index — and the ratio it
// would report is measured below as a MODEL of that loop, clearly labelled,
// because a model of a function is not the function.
//
// ── the mesh, built rather than loaded ──────────────────────────────────────
// A 20x20 grid of square patches, each patch ONE B-rep face id, each subdivided
// 4x4 into 32 triangles: 400 faces, 12,800 triangles, and 2*20*19 = 760 interior
// boundaries between differently-identified patches, which is what deriveEdges
// recovers as edges. The counts are stated in closed form above and asserted
// below, so a mesh that silently stopped being the mesh this file describes
// fails before any timing is reported.
//
// ── how the bound is set ────────────────────────────────────────────────────
// The budget is a frame, not a guess: 60 fps is 16.67 ms, and hover picking may
// not be the frame. The gate asserts the MEDIAN pick stays under 2.0 ms — an
// eighth of the frame — and prints the measurement either way. Median, not mean,
// because one scheduler preemption on a shared machine should not turn a
// performance gate red; the max is printed for the reader and not asserted, for
// the same reason. THIS IS A CEILING, NOT A TARGET: it is set where a regression
// that makes picking feel broken is caught, and it is deliberately loose enough
// that a loaded CI runner does not produce a false red.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

#include "forge/ui/EdgeModel.hpp"
#include "forge/ui/MeasureModel.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

constexpr int kPatchesPerSide = 20;                                  // 20 x 20 patches
constexpr int kSubdiv = 4;                                           // 4 x 4 quads per patch
constexpr std::size_t kFaces = kPatchesPerSide * kPatchesPerSide;    // 400
constexpr std::size_t kTriangles = kFaces * kSubdiv * kSubdiv * 2;   // 12,800
constexpr std::size_t kInteriorEdges = 2 * kPatchesPerSide * (kPatchesPerSide - 1);  // 760
constexpr double kPatchSize = 10.0;   // mm, so the sheet is 200 mm across

// A gentle dome, so the patches are not coplanar and the segment geometry is
// three-dimensional. A flat sheet would let every ray-to-segment distance
// collapse onto one plane, which is a cheaper question than the real one.
double heightAt(double x, double y) {
  const double cx = x - kPatchesPerSide * kPatchSize * 0.5;
  const double cy = y - kPatchesPerSide * kPatchSize * 0.5;
  return 12.0 * std::cos(cx * 0.01) * std::cos(cy * 0.01);
}

void vertexAt(double x, double y, double out[3]) {
  out[0] = x;
  out[1] = y;
  out[2] = heightAt(x, y);
}

// The reference mesh. Vertices on a shared patch boundary are generated from the
// SAME (x, y) by both neighbours, so they weld and the boundary is a real shared
// segment rather than two coincident ones.
MeasureMesh buildMesh(int side) {
  MeasureMesh mesh;
  const double step = kPatchSize / kSubdiv;
  for (int px = 0; px < side; ++px) {
    for (int py = 0; py < side; ++py) {
      const std::uint32_t faceId = static_cast<std::uint32_t>(px * side + py) + 1u;  // 1-based
      const double ox = px * kPatchSize;
      const double oy = py * kPatchSize;
      for (int i = 0; i < kSubdiv; ++i) {
        for (int j = 0; j < kSubdiv; ++j) {
          double a[3], b[3], c[3], d[3];
          vertexAt(ox + i * step, oy + j * step, a);
          vertexAt(ox + (i + 1) * step, oy + j * step, b);
          vertexAt(ox + (i + 1) * step, oy + (j + 1) * step, c);
          vertexAt(ox + i * step, oy + (j + 1) * step, d);
          mesh.addTriangle(a, b, c, faceId);
          mesh.addTriangle(a, c, d, faceId);
        }
      }
    }
  }
  return mesh;
}

MeasureMesh buildReferenceMesh() { return buildMesh(kPatchesPerSide); }

// Median cost of one pickEdge over a swept fan of rays across a mesh of `side`
// squared patches. Returns milliseconds, and reports how many rays actually hit
// so the caller can refuse a timing taken on the miss path.
double medianPickMs(int side, std::size_t& hits, std::size_t& edges) {
  const MeasureMesh m = buildMesh(side);
  const EdgeSet s = deriveEdges(m);
  edges = s.edges.size();
  const double span = side * kPatchSize;
  constexpr int kRays = 200;
  std::vector<double> ms;
  ms.reserve(kRays);
  hits = 0;
  for (int r = 0; r < kRays; ++r) {
    const double u = static_cast<double>(r) / (kRays - 1);
    const double origin[3] = {span * u, span * (1.0 - u), 200.0};
    const double dir[3] = {0.05, -0.05, -1.0};
    const auto a = std::chrono::steady_clock::now();
    const EdgePick p = pickEdge(s, origin, dir, 4.0);
    const auto b = std::chrono::steady_clock::now();
    ms.push_back(std::chrono::duration<double, std::milli>(b - a).count());
    if (p.hit()) ++hits;
  }
  std::sort(ms.begin(), ms.end());
  return ms[ms.size() / 2];
}

double medianOf(std::vector<double> v) {
  if (v.empty()) return 0.0;
  std::sort(v.begin(), v.end());
  return v[v.size() / 2];
}

}  // namespace

int main() {
  Harness H("pick_perf");

  // ── 1. the mesh is the mesh this file documents ──────────────────────────
  // Asserted BEFORE any timing, because a timing number for the wrong mesh is
  // worse than no timing number: it is a plausible one.
  const MeasureMesh mesh = buildReferenceMesh();
  CHECK_EQ_INT(mesh.triangleCount(), static_cast<long long>(kTriangles));
  CHECK_EQ_INT(mesh.faces().size(), static_cast<long long>(kFaces));

  // ── 2. deriveEdges: once per geometry change ─────────────────────────────
  const auto t0 = std::chrono::steady_clock::now();
  const EdgeSet set = deriveEdges(mesh);
  const auto t1 = std::chrono::steady_clock::now();
  const double deriveMs = std::chrono::duration<double, std::milli>(t1 - t0).count();

  // The recovered edge count is the closed form above, not a number read back
  // out of the object under test.
  CHECK_EQ_INT(set.edges.size(), static_cast<long long>(kInteriorEdges));

  // ── 3. pickEdge: the per-frame hover path ────────────────────────────────
  // 200 rays swept across the sheet, each aimed down at it from above, which is
  // what a cursor moving over the part produces. The ray is REBUILT every
  // iteration so nothing can be hoisted out of the loop by the optimiser, and
  // the hit is accumulated into a checksum for the same reason -- a benchmark
  // whose result is unused is a benchmark the compiler is free to delete.
  constexpr int kRays = 200;
  const double span = kPatchesPerSide * kPatchSize;
  std::vector<double> perPickMs;
  perPickMs.reserve(kRays);
  std::size_t hits = 0;
  for (int r = 0; r < kRays; ++r) {
    const double u = static_cast<double>(r) / (kRays - 1);
    const double origin[3] = {span * u, span * (1.0 - u), 200.0};
    const double dir[3] = {0.05, -0.05, -1.0};
    const auto p0 = std::chrono::steady_clock::now();
    const EdgePick pick = pickEdge(set, origin, dir, 4.0);
    const auto p1 = std::chrono::steady_clock::now();
    perPickMs.push_back(std::chrono::duration<double, std::milli>(p1 - p0).count());
    if (pick.hit()) ++hits;
  }

  const double medianMs = medianOf(perPickMs);
  const double maxMs = *std::max_element(perPickMs.begin(), perPickMs.end());
  double totalMs = 0.0;
  for (double v : perPickMs) totalMs += v;

  // THE RAYS MUST ACTUALLY HIT SOMETHING. A pick that misses everything is the
  // fast path, and timing the fast path would report an interactive application
  // that is not one. This is the positive control for the whole measurement.
  CHECK(hits > 0);

  std::printf("  [measured] %zu faces, %zu triangles, %zu recovered edges\n",
              kFaces, mesh.triangleCount(), set.edges.size());
  std::printf("  [measured] deriveEdges      %8.3f ms  (once per geometry change)\n", deriveMs);
  std::printf("  [measured] pickEdge median  %8.3f ms  max %.3f ms  mean %.3f ms over %d rays,"
              " %zu hits\n",
              medianMs, maxMs, totalMs / kRays, kRays, hits);
  std::printf("  [measured] a 16.67 ms frame at 60 fps would spend %.2f%% of itself"
              " on one hover pick\n",
              100.0 * medianMs / 16.67);

  // ── 4. the bound ─────────────────────────────────────────────────────────
  CHECK(medianMs < 2.0);
  // deriveEdges is not per-frame, but it IS on the path from "run a command" to
  // "the viewport responds", so a second of it would be felt. One frame's worth
  // of budget for a whole-model rebuild is generous and still catches a
  // regression that makes editing feel stuck.
  CHECK(deriveMs < 250.0);

  // ── 5. THE COST MODEL FOR THE FACE PICK, LABELLED AS A MODEL ─────────────
  // KernelScene::pick cannot be driven from here (it needs forge-kernel and
  // OCCT), so this is NOT a measurement of it. It is the same loop shape over
  // the same triangle soup -- Moller-Trumbore against every triangle, no spatial
  // index -- so it says what ORDER of cost that design has at this size, and
  // whether a face pick could plausibly be the thing that breaks a frame.
  const std::vector<double>& xyz = mesh.coords();
  const double origin[3] = {span * 0.5, span * 0.5, 200.0};
  const double dir[3] = {0.0, 0.0, -1.0};
  const auto f0 = std::chrono::steady_clock::now();
  double nearest = 1e300;
  std::size_t faceHits = 0;
  for (std::size_t t = 0; t + 8 < xyz.size(); t += 9) {
    const double* a = &xyz[t];
    const double e1[3] = {xyz[t + 3] - a[0], xyz[t + 4] - a[1], xyz[t + 5] - a[2]};
    const double e2[3] = {xyz[t + 6] - a[0], xyz[t + 7] - a[1], xyz[t + 8] - a[2]};
    const double pv[3] = {dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2],
                          dir[0] * e2[1] - dir[1] * e2[0]};
    const double det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
    if (std::fabs(det) < 1e-12) continue;
    const double inv = 1.0 / det;
    const double tv[3] = {origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]};
    const double u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
    if (u < 0.0 || u > 1.0) continue;
    const double qv[3] = {tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2],
                          tv[0] * e1[1] - tv[1] * e1[0]};
    const double v = (dir[0] * qv[0] + dir[1] * qv[1] + dir[2] * qv[2]) * inv;
    if (v < 0.0 || u + v > 1.0) continue;
    const double hitT = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
    if (hitT <= 1e-6) continue;
    ++faceHits;
    nearest = std::min(nearest, hitT);
  }
  const auto f1 = std::chrono::steady_clock::now();
  const double faceMs = std::chrono::duration<double, std::milli>(f1 - f0).count();
  CHECK(faceHits > 0);   // the positive control again: a miss is the fast path
  std::printf("  [model, NOT KernelScene::pick] one brute-force ray/triangle sweep of %zu"
              " triangles: %.3f ms, %zu hits, nearest t=%.3f\n",
              mesh.triangleCount(), faceMs, faceHits, nearest);

  // ── 6. THE SCALING CHECK, which is the part that survives a slow machine ──
  // An absolute millisecond bound on a shared CI runner has to be set loose
  // enough not to false-red, and a loose bound only catches a catastrophe. The
  // SHAPE of the cost curve does not depend on how fast the machine is, so this
  // is the check that actually holds the design: pickEdge is O(edges) and the
  // recovered edge count grows as 2*s*(s-1), so 10x10 -> 20x20 patches is a
  // 180 -> 760 edge step, a factor of 4.22. Anything that made picking
  // quadratic (a nested scan, a per-segment allocation, a rebuild inside the
  // loop) would show up here as a factor near 18 on a machine of any speed.
  //
  // The measured ratio is printed either way, and the bound is 3x the honest
  // one -- room for timer granularity at these durations, and still nowhere near
  // quadratic.
  std::size_t smallHits = 0, smallEdges = 0, bigHits = 0, bigEdges = 0;
  const double smallMs = medianPickMs(kPatchesPerSide / 2, smallHits, smallEdges);
  const double bigMs = medianPickMs(kPatchesPerSide, bigHits, bigEdges);
  CHECK(smallHits > 0);   // a timing on the miss path measures nothing
  CHECK(bigHits > 0);
  const double edgeRatio = static_cast<double>(bigEdges) / static_cast<double>(smallEdges);
  const double timeRatio = smallMs > 0.0 ? bigMs / smallMs : 0.0;
  std::printf("  [measured] scaling %zu -> %zu edges (x%.2f) costs %.4f -> %.4f ms (x%.2f);"
              " linear would be x%.2f, quadratic x%.2f\n",
              smallEdges, bigEdges, edgeRatio, smallMs, bigMs, timeRatio, edgeRatio,
              edgeRatio * edgeRatio);
  CHECK_EQ_INT(smallEdges, 2 * (kPatchesPerSide / 2) * (kPatchesPerSide / 2 - 1));
  CHECK(timeRatio < edgeRatio * 3.0);

  return H.finish();
}
