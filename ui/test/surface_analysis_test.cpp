// ui/test/surface_analysis_test.cpp
//
// WHAT THE ISOCLINE AND CONTINUITY TABS SHOW.
//
// Two of the eight tabs of the Surface workspace drew nothing at all. Both are
// now readings of the tessellation the viewport is already drawing, and the rule
// they are written to is InspectionReport.hpp's: A PANEL MAY ONLY PRINT WHAT
// SOMETHING HEADLESS HAS ALREADY ASSERTED.
//
// The fixtures are built here, from arithmetic, so every expected number is
// derived rather than remembered: a box's sides are square to a pull along Z,
// and a taper of five degrees measures five degrees.
//
// THE CHECK THAT MATTERS MOST is the last one. Continuity needs an angle below
// which a break is not a break, and choosing one would be exactly the "a
// threshold must be MEASURED, not chosen" defect. It is measured -- from the
// mesh's own facet step -- and the control proves it: the SAME join, at the SAME
// angle, reads as a break on a finely drawn surface and as no break at all on a
// coarse one, because on the coarse one it genuinely cannot be told apart.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/SurfaceAnalysis.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

constexpr double kPi = 3.14159265358979323846;

void quad(MeasureMesh& m, const double a[3], const double b[3], const double c[3],
          const double d[3], std::uint32_t faceId) {
  m.addTriangle(a, b, c, faceId);
  m.addTriangle(a, c, d, faceId);
}

// An axis-aligned box, wound so every face's normal points OUT. Six face ids,
// 1..6, in the order bottom, top, -Y, +Y, -X, +X.
void addBox(MeasureMesh& m, double ax, double ay, double az, double bx, double by, double bz,
            std::uint32_t firstFace) {
  const double p000[3] = {ax, ay, az};
  const double p100[3] = {bx, ay, az};
  const double p110[3] = {bx, by, az};
  const double p010[3] = {ax, by, az};
  const double p001[3] = {ax, ay, bz};
  const double p101[3] = {bx, ay, bz};
  const double p111[3] = {bx, by, bz};
  const double p011[3] = {ax, by, bz};
  quad(m, p000, p010, p110, p100, firstFace + 0);  // bottom, -Z
  quad(m, p001, p101, p111, p011, firstFace + 1);  // top, +Z
  quad(m, p000, p100, p101, p001, firstFace + 2);  // -Y
  quad(m, p010, p011, p111, p110, firstFace + 3);  // +Y
  quad(m, p000, p001, p011, p010, firstFace + 4);  // -X
  quad(m, p100, p110, p111, p101, firstFace + 5);  // +X
}

// A square frustum: a `half` by `half` half-width at the bottom, drawn in by
// `taperDeg` per unit of height, so every side wall's outward normal tilts up by
// exactly `taperDeg` and the part strips upward with that much draft.
void addFrustum(MeasureMesh& m, double half, double height, double taperDeg,
                std::uint32_t firstFace) {
  const double inset = height * std::tan(taperDeg * kPi / 180.0);
  const double t = half - inset;
  const double b000[3] = {-half, -half, 0.0};
  const double b100[3] = {half, -half, 0.0};
  const double b110[3] = {half, half, 0.0};
  const double b010[3] = {-half, half, 0.0};
  const double t000[3] = {-t, -t, height};
  const double t100[3] = {t, -t, height};
  const double t110[3] = {t, t, height};
  const double t010[3] = {-t, t, height};
  quad(m, b000, b010, b110, b100, firstFace + 0);  // bottom, -Z
  quad(m, t000, t100, t110, t010, firstFace + 1);  // top, +Z
  quad(m, b000, b100, t100, t000, firstFace + 2);  // -Y wall
  quad(m, b010, t010, t110, b110, firstFace + 3);  // +Y wall
  quad(m, b000, t000, t010, b010, firstFace + 4);  // -X wall
  quad(m, b100, b110, t110, t100, firstFace + 5);  // +X wall
}

const DraftFace* faceOf(const DraftReport& r, std::uint32_t id) {
  for (const DraftFace& f : r.faces) {
    if (f.faceId == id) return &f;
  }
  return nullptr;
}

const SurfaceJoin* joinOf(const ContinuityReport& r, std::uint32_t a, std::uint32_t b) {
  const std::uint32_t lo = a < b ? a : b;
  const std::uint32_t hi = a < b ? b : a;
  for (const SurfaceJoin& j : r.joins) {
    if (j.faceA == lo && j.faceB == hi) return &j;
  }
  return nullptr;
}

}  // namespace

int main() {
  Harness H("surface_analysis");

  // ── the pull directions ─────────────────────────────────────────────────
  {
    CHECK_EQ_INT(allPullAxes().size(), 6);
    CHECK_EQ_STR(pullAxisWord(PullAxis::ZPlus), "+Z");
    CHECK_EQ_STR(pullAxisWord(PullAxis::XMinus), "-X");
    double v[3] = {9.0, 9.0, 9.0};
    pullAxisVector(PullAxis::YMinus, v);
    CHECK_NEAR(v[0], 0.0, 1e-12);
    CHECK_NEAR(v[1], -1.0, 1e-12);
    CHECK_NEAR(v[2], 0.0, 1e-12);
    // Every axis is a unit vector and no two are the same.
    for (PullAxis a : allPullAxes()) {
      double u[3];
      pullAxisVector(a, u);
      CHECK_NEAR(std::sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]), 1.0, 1e-12);
    }
  }

  // ── A BOX HAS NO DRAFT AT ALL ───────────────────────────────────────────
  // Four walls exactly square to a pull along Z: they drag the whole way out,
  // whatever taper the job asks for. That is the answer a user opens this tab
  // for, and it must not depend on the requirement.
  {
    MeasureMesh box;
    addBox(box, 0.0, 0.0, 0.0, 40.0, 30.0, 20.0, 1);
    for (double required : {0.0, 3.0, 10.0}) {
      const DraftReport r = buildDraftReport(box, PullAxis::ZPlus, required);
      CHECK(r.known);
      CHECK_EQ_INT(r.faces.size(), 6);
      CHECK_EQ_INT(r.square, 4);
      CHECK_EQ_INT(r.releasing, 1);   // the top
      CHECK_EQ_INT(r.opposite, 1);    // the bottom
      CHECK_EQ_INT(r.shallow, 0);
      CHECK_EQ_INT(r.unmeasured, 0);
      CHECK_EQ_INT(r.needsAttention(), 5);
      // Every face of a box is flat, so the worst and best parts of each agree.
      for (const DraftFace& f : r.faces) {
        CHECK(f.uniform);
        CHECK_NEAR(f.bestDraftDeg, f.draftDeg, 1e-9);
        CHECK(f.planar);
      }
      // THE CENSUS IS TOTAL: every face is in exactly one bucket and the areas
      // add up to the whole surface.
      CHECK_EQ_INT(r.releasing + r.shallow + r.square + r.opposite + r.unmeasured,
                   r.faces.size());
      CHECK_NEAR(r.releasingArea + r.shallowArea + r.squareArea + r.oppositeArea, r.area, 1e-9);
      // 2*(40*30) + 2*(40*20) + 2*(30*20)
      CHECK_NEAR(r.area, 2.0 * (1200.0 + 800.0 + 600.0), 1e-9);
      // The top is the only face that comes away with this half.
      CHECK(r.worstKnown);
      CHECK_NEAR(r.worstDraftDeg, 90.0, 1e-6);
      const DraftFace* top = faceOf(r, 2);
      CHECK(top != nullptr);
      if (top != nullptr) {
        CHECK(top->verdict == DraftVerdict::Releasing);
        CHECK_NEAR(top->draftDeg, 90.0, 1e-6);
        CHECK(top->planar);
        CHECK_NEAR(top->area, 1200.0, 1e-9);
        CHECK_NEAR(top->centroid[2], 20.0, 1e-9);
      }
      const DraftFace* bottom = faceOf(r, 1);
      CHECK(bottom != nullptr);
      if (bottom != nullptr) {
        CHECK(bottom->verdict == DraftVerdict::Opposite);
        CHECK_NEAR(bottom->draftDeg, -90.0, 1e-6);
      }
      const DraftFace* wall = faceOf(r, 3);
      CHECK(wall != nullptr);
      if (wall != nullptr) {
        CHECK(wall->verdict == DraftVerdict::Square);
        CHECK_NEAR(wall->draftDeg, 0.0, 1e-9);
      }
      // WORST FIRST: the bottom, at -90, leads the list.
      CHECK(!r.faces.empty());
      if (!r.faces.empty()) CHECK_EQ_INT(r.faces.front().faceId, 1);
    }
  }

  // ── A TAPERED PART, AND THE REQUIREMENT IS THE THING THAT MOVES ─────────
  {
    MeasureMesh part;
    addFrustum(part, 20.0, 20.0, 5.0, 1);

    // The measured taper is the taper that was built.
    const DraftReport lenient = buildDraftReport(part, PullAxis::ZPlus, 3.0);
    CHECK(lenient.known);
    CHECK_EQ_INT(lenient.faces.size(), 6);
    CHECK_EQ_INT(lenient.releasing, 5);  // four walls and the top
    CHECK_EQ_INT(lenient.shallow, 0);
    CHECK_EQ_INT(lenient.square, 0);
    CHECK_EQ_INT(lenient.opposite, 1);
    CHECK(lenient.worstKnown);
    CHECK_NEAR(lenient.worstDraftDeg, 5.0, 1e-6);
    const DraftFace* wall = faceOf(lenient, 3);
    CHECK(wall != nullptr);
    if (wall != nullptr) CHECK_NEAR(wall->draftDeg, 5.0, 1e-6);

    // THE POSITIVE CONTROL. Ask for more taper than the part has and the same
    // four walls change verdict. Nothing that printed a constant survives this.
    const DraftReport strict = buildDraftReport(part, PullAxis::ZPlus, 10.0);
    CHECK_EQ_INT(strict.releasing, 1);   // only the top
    CHECK_EQ_INT(strict.shallow, 4);
    CHECK_EQ_INT(strict.opposite, 1);
    CHECK_EQ_INT(strict.needsAttention(), 5);
    CHECK_NEAR(strict.shallowArea + strict.releasingArea + strict.oppositeArea, strict.area, 1e-9);
    // and the measured angle itself did NOT move: the requirement is a
    // question, not a measurement.
    const DraftFace* same = faceOf(strict, 3);
    CHECK(same != nullptr);
    if (same != nullptr) CHECK_NEAR(same->draftDeg, 5.0, 1e-6);

    // THE SECOND CONTROL: pull it the other way and every verdict flips.
    const DraftReport flipped = buildDraftReport(part, PullAxis::ZMinus, 3.0);
    CHECK_EQ_INT(flipped.releasing, 1);   // the bottom, now
    CHECK_EQ_INT(flipped.opposite, 5);
    const DraftFace* flippedWall = faceOf(flipped, 3);
    CHECK(flippedWall != nullptr);
    if (flippedWall != nullptr) {
      CHECK_NEAR(flippedWall->draftDeg, -5.0, 1e-6);
      CHECK(flippedWall->verdict == DraftVerdict::Opposite);
    }

    // A negative requirement is not a taper. Clamped, and said so by the report
    // carrying what it actually used.
    const DraftReport clamped = buildDraftReport(part, PullAxis::ZPlus, -4.0);
    CHECK_NEAR(clamped.requiredDeg, 0.0, 1e-12);
  }

  // ── ★ A BORE ACROSS THE PULL IS THE CASE AN AVERAGE CANNOT ANSWER ───────
  //
  // A whole cylinder faces every direction at once, so its area-weighted normal
  // cancels to nothing. A reading built on that average would call the one
  // feature that certainly traps the part "unmeasurable". The worst part of the
  // face is what decides, so this reports exactly what it is: pulled along its
  // own axis it is square to the pull the whole way round, and pulled across its
  // axis half of it faces backwards.
  {
    MeasureMesh bore;
    const std::size_t sides = 24;
    const double radius = 6.0;
    const double height = 20.0;
    for (std::size_t i = 0; i < sides; ++i) {
      const double a0 = 2.0 * kPi * static_cast<double>(i) / static_cast<double>(sides);
      const double a1 = 2.0 * kPi * static_cast<double>(i + 1) / static_cast<double>(sides);
      const double p0[3] = {radius * std::cos(a0), radius * std::sin(a0), 0.0};
      const double p1[3] = {radius * std::cos(a1), radius * std::sin(a1), 0.0};
      const double p2[3] = {radius * std::cos(a1), radius * std::sin(a1), height};
      const double p3[3] = {radius * std::cos(a0), radius * std::sin(a0), height};
      quad(bore, p0, p1, p2, p3, 1);
    }
    const DraftReport alongAxis = buildDraftReport(bore, PullAxis::ZPlus, 3.0);
    CHECK(alongAxis.known);
    CHECK_EQ_INT(alongAxis.faces.size(), 1);
    CHECK_EQ_INT(alongAxis.unmeasured, 0);
    CHECK_EQ_INT(alongAxis.square, 1);
    if (!alongAxis.faces.empty()) {
      const DraftFace& f = alongAxis.faces.front();
      CHECK_NEAR(f.draftDeg, 0.0, 1e-9);
      CHECK_NEAR(f.bestDraftDeg, 0.0, 1e-9);
      CHECK(f.uniform);
      // It is not flat, and saying so is different from failing to measure it.
      CHECK(!f.planar);
    }

    const DraftReport acrossAxis = buildDraftReport(bore, PullAxis::XPlus, 3.0);
    CHECK_EQ_INT(acrossAxis.faces.size(), 1);
    CHECK_EQ_INT(acrossAxis.unmeasured, 0);
    // Half of it faces backwards, so the whole face traps.
    CHECK_EQ_INT(acrossAxis.opposite, 1);
    if (!acrossAxis.faces.empty()) {
      const DraftFace& f = acrossAxis.faces.front();
      CHECK(!f.uniform);
      CHECK(f.draftDeg < -80.0);
      CHECK(f.bestDraftDeg > 80.0);
      CHECK(f.verdict == DraftVerdict::Opposite);
    }
  }

  // ── NOTHING TO MEASURE IS NOT AN ERROR ──────────────────────────────────
  {
    const MeasureMesh nothing;
    const DraftReport r = buildDraftReport(nothing, PullAxis::ZPlus, 3.0);
    CHECK(!r.known);
    CHECK_EQ_INT(r.faces.size(), 0);
    CHECK(!r.worstKnown);
    const MeshMeasure m = measureMesh(nothing);
    const ContinuityReport c = buildContinuityReport(nothing, m);
    CHECK(!c.known);
    CHECK_EQ_INT(c.joins.size(), 0);
    CHECK(!c.worstKnown);
  }

  // ── CONTINUITY ON A BOX: TWELVE JOINS, ALL OF THEM BREAKS ───────────────
  {
    MeasureMesh box;
    addBox(box, 0.0, 0.0, 0.0, 40.0, 30.0, 20.0, 1);
    const MeshMeasure m = measureMesh(box);
    CHECK(m.watertight);
    CHECK(m.outward);

    const ContinuityReport r = buildContinuityReport(box, m);
    CHECK(r.known);
    // Six faces, and every pair but the three opposite pairs touches.
    CHECK_EQ_INT(r.joins.size(), 12);
    CHECK_EQ_INT(r.sharp, 12);
    CHECK_EQ_INT(r.smooth, 0);
    CHECK_EQ_INT(r.openEdges, 0);
    CHECK_EQ_INT(r.oddEdges, 0);
    CHECK(r.worstKnown);
    CHECK_NEAR(r.worstBreakDeg, 90.0, 1e-6);
    // A box is drawn with flat faces, so there is no facet step to measure and
    // the report SAYS the floor was used rather than reporting a measurement it
    // did not make.
    CHECK(r.resolutionIsFloor);
    CHECK_NEAR(r.resolutionDeg, kMeasureAngleTolerance, 1e-12);
    // Every join is an outside corner, and the mesh closes so the answer may be
    // given at all.
    for (const SurfaceJoin& j : r.joins) {
      CHECK(j.convexKnown);
      CHECK(j.convex);
      CHECK_NEAR(j.maxBreakDeg, 90.0, 1e-6);
      CHECK_NEAR(j.minBreakDeg, 90.0, 1e-6);
      CHECK_NEAR(j.meanBreakDeg, 90.0, 1e-6);
      CHECK(j.smoothness == JoinSmoothness::Sharp);
      CHECK(j.sharedEdges >= 1);
      CHECK(j.sharedLength > 0.0);
    }
    // The two faces across the box from each other never meet.
    CHECK(joinOf(r, 1, 2) == nullptr);
    CHECK(joinOf(r, 3, 4) == nullptr);
    CHECK(joinOf(r, 5, 6) == nullptr);
    // The top meets the +X wall along the 40 mm... no: along the 30 mm edge.
    const SurfaceJoin* topToPlusX = joinOf(r, 2, 6);
    CHECK(topToPlusX != nullptr);
    if (topToPlusX != nullptr) CHECK_NEAR(topToPlusX->sharedLength, 30.0, 1e-9);
    CHECK_NEAR(r.sharpLength, 4.0 * (40.0 + 30.0 + 20.0), 1e-9);
    CHECK_NEAR(r.smoothLength, 0.0, 1e-12);
  }

  // ── AN INSIDE CORNER IS TOLD FROM AN OUTSIDE ONE ────────────────────────
  // Two boxes side by side, sharing a wall plane, is not a solid this file can
  // build cleanly -- but a box with a step in it is. The simplest honest case:
  // the SAME box wound INWARD is not outward-facing, and the report must then
  // refuse the inside/outside answer instead of giving the wrong one.
  {
    MeasureMesh inward;
    // Swapping two corners of every quad reverses every triangle.
    addBox(inward, 0.0, 0.0, 0.0, 10.0, 10.0, 10.0, 1);
    MeasureMesh reversed;
    const std::vector<double>& xyz = inward.coords();
    for (std::size_t t = 0; t < inward.triangleCount(); ++t) {
      const double a[3] = {xyz[t * 9 + 0], xyz[t * 9 + 1], xyz[t * 9 + 2]};
      const double b[3] = {xyz[t * 9 + 3], xyz[t * 9 + 4], xyz[t * 9 + 5]};
      const double c[3] = {xyz[t * 9 + 6], xyz[t * 9 + 7], xyz[t * 9 + 8]};
      reversed.addTriangle(a, c, b, inward.faceIds()[t]);
    }
    const MeshMeasure m = measureMesh(reversed);
    CHECK(m.watertight);
    CHECK(!m.outward);
    const ContinuityReport r = buildContinuityReport(reversed, m);
    CHECK_EQ_INT(r.joins.size(), 12);
    for (const SurfaceJoin& j : r.joins) {
      // The break itself is still measurable -- an angle between two planes does
      // not care which way they are wound.
      CHECK_NEAR(j.maxBreakDeg, 90.0, 1e-6);
      // Which side the material is on is NOT, and the report says so rather
      // than reporting the opposite of the truth.
      CHECK(!j.convexKnown);
    }
  }

  // ── COPLANAR FACES RUN INTO EACH OTHER ──────────────────────────────────
  {
    MeasureMesh flat;
    const double a[3] = {0.0, 0.0, 0.0};
    const double b[3] = {10.0, 0.0, 0.0};
    const double c[3] = {10.0, 10.0, 0.0};
    const double d[3] = {0.0, 10.0, 0.0};
    const double e[3] = {20.0, 0.0, 0.0};
    const double f[3] = {20.0, 10.0, 0.0};
    quad(flat, a, b, c, d, 1);
    quad(flat, b, e, f, c, 2);
    const MeshMeasure m = measureMesh(flat);
    const ContinuityReport r = buildContinuityReport(flat, m);
    CHECK(r.known);
    CHECK_EQ_INT(r.joins.size(), 1);
    CHECK_EQ_INT(r.smooth, 1);
    CHECK_EQ_INT(r.sharp, 0);
    if (!r.joins.empty()) {
      CHECK_NEAR(r.joins.front().maxBreakDeg, 0.0, 1e-9);
      CHECK(r.joins.front().smoothness == JoinSmoothness::Smooth);
      CHECK_NEAR(r.joins.front().sharedLength, 10.0, 1e-9);
      // Two faces in one plane are neither an inside corner nor an outside one,
      // and an open sheet has no inside at all.
      CHECK(!r.joins.front().convexKnown);
    }
    // An open sheet is open, and the report counts the boundary rather than
    // pretending the shape closes.
    CHECK(r.openEdges > 0);
  }

  // ── ★ THE TOLERANCE IS MEASURED, AND THIS IS THE PROOF ──────────────────
  //
  // One join, at one angle, on two meshes of the same shape. On the finely drawn
  // one the join is a break; on the coarse one it is smaller than the steps the
  // surface is already made of, so nothing could tell it from tangent -- and the
  // report says Smooth AND says what resolution it said it at.
  {
    const double joinDeg = 30.0;

    // FINE: five segments of one face turning 10 degrees each, then a sixth
    // segment of a SECOND face turned 30.
    {
      MeasureMesh turning;
      {
        double x = 0.0, z = 0.0, angle = 0.0;
        const std::uint32_t faces[6] = {1, 1, 1, 1, 1, 2};
        const double steps[6] = {0.0, 10.0, 10.0, 10.0, 10.0, joinDeg};
        for (std::size_t i = 0; i < 6; ++i) {
          angle += steps[i] * kPi / 180.0;
          const double nx = x + 10.0 * std::cos(angle);
          const double nz = z + 10.0 * std::sin(angle);
          const double p0[3] = {x, 0.0, z};
          const double p1[3] = {nx, 0.0, nz};
          const double p2[3] = {nx, 5.0, nz};
          const double p3[3] = {x, 5.0, z};
          quad(turning, p0, p1, p2, p3, faces[i]);
          x = nx;
          z = nz;
        }
      }
      const MeshMeasure m = measureMesh(turning);
      const ContinuityReport r = buildContinuityReport(turning, m);
      CHECK(r.known);
      CHECK(!r.resolutionIsFloor);
      CHECK_NEAR(r.resolutionDeg, 10.0, 1e-6);
      CHECK_EQ_INT(r.joins.size(), 1);
      if (!r.joins.empty()) {
        CHECK_NEAR(r.joins.front().maxBreakDeg, joinDeg, 1e-6);
        CHECK(r.joins.front().smoothness == JoinSmoothness::Sharp);
      }
      CHECK_EQ_INT(r.sharp, 1);
    }

    // COARSE: the same 30 degree join, on a surface already made of 45 degree
    // steps. Nothing in this mesh can tell that join from tangent, and the
    // report must not claim to.
    {
      MeasureMesh coarse;
      double x = 0.0, z = 0.0, angle = 0.0;
      const std::uint32_t faces[4] = {1, 1, 1, 2};
      const double steps[4] = {0.0, 45.0, 45.0, joinDeg};
      for (std::size_t i = 0; i < 4; ++i) {
        angle += steps[i] * kPi / 180.0;
        const double nx = x + 10.0 * std::cos(angle);
        const double nz = z + 10.0 * std::sin(angle);
        const double p0[3] = {x, 0.0, z};
        const double p1[3] = {nx, 0.0, nz};
        const double p2[3] = {nx, 5.0, nz};
        const double p3[3] = {x, 5.0, z};
        quad(coarse, p0, p1, p2, p3, faces[i]);
        x = nx;
        z = nz;
      }
      const MeshMeasure m = measureMesh(coarse);
      const ContinuityReport r = buildContinuityReport(coarse, m);
      CHECK(r.known);
      CHECK(!r.resolutionIsFloor);
      CHECK_NEAR(r.resolutionDeg, 45.0, 1e-6);
      CHECK_EQ_INT(r.joins.size(), 1);
      if (!r.joins.empty()) {
        // The SAME measured break as the fine mesh -- the geometry did not
        // change -- and a different verdict, because the instrument did.
        CHECK_NEAR(r.joins.front().maxBreakDeg, joinDeg, 1e-6);
        CHECK(r.joins.front().smoothness == JoinSmoothness::Smooth);
      }
      CHECK_EQ_INT(r.smooth, 1);
      CHECK_EQ_INT(r.sharp, 0);
    }
  }

  return H.finish();
}
