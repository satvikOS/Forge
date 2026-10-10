// ui/test/study_field_test.cpp — WHAT A STUDY'S ANSWER LOOKS LIKE, HEADLESS.
//
// Five claims, each against a value worked out by hand rather than read back:
//
//   A. the outside of a brick mesh is the faces no two bricks share: one brick
//      has 6 faces, 12 edges and 12 corners; two side by side have 10 faces and
//      20 edges (Euler: V - E + F = 2), of which 16 are corners. Every face is
//      wound so that its normal points out of the part.
//   B. a mode shape is scaled so its furthest node moves exactly 1 and turned so
//      that node's largest component is positive; nothing else about it changes.
//   C. a mode is named from its own field: a pure twist, a pure sideways swing,
//      a pure stretch, and a 50/50 sideways mixture are told apart.
//   D. the drawn shape moves each outside edge end by amplitude x sin(phase) x
//      shape, and not at all at phase 0.
//   E. the temperature colours run cold blue -> neutral -> hot red, and a field
//      with no spread is drawn neutral rather than divided by zero.
//
// Hostile inputs (an index past the node list, a shape of the wrong length, a
// NaN) give an EMPTY answer, never a read out of bounds.
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ui/StudyField.hpp"
#include "forge/ui/UserFacingText.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;

namespace {

constexpr double kPi = 3.14159265358979323846;

// A grid of nx x ny x nz bricks of unit size, numbered the way the solver's
// mesher numbers them (see StudyField.hpp).
struct Grid {
  std::vector<double> nodes;
  std::vector<std::uint32_t> hexes;
};

Grid grid(int nx, int ny, int nz, double sx = 1.0, double sy = 1.0, double sz = 1.0) {
  Grid g;
  auto id = [&](int i, int j, int k) {
    return static_cast<std::uint32_t>((i * (ny + 1) + j) * (nz + 1) + k);
  };
  for (int i = 0; i <= nx; ++i) {
    for (int j = 0; j <= ny; ++j) {
      for (int k = 0; k <= nz; ++k) {
        g.nodes.push_back(i * sx);
        g.nodes.push_back(j * sy);
        g.nodes.push_back(k * sz);
      }
    }
  }
  for (int i = 0; i < nx; ++i) {
    for (int j = 0; j < ny; ++j) {
      for (int k = 0; k < nz; ++k) {
        const std::uint32_t n[8] = {id(i, j, k),         id(i + 1, j, k),
                                    id(i + 1, j + 1, k), id(i, j + 1, k),
                                    id(i, j, k + 1),     id(i + 1, j, k + 1),
                                    id(i + 1, j + 1, k + 1), id(i, j + 1, k + 1)};
        for (std::uint32_t v : n) g.hexes.push_back(v);
      }
    }
  }
  return g;
}

// Every outside quad's normal points away from the middle of the part (true
// for a convex part such as a box grid).
bool woundOutward(const StudySurface& s) {
  double c[3] = {0.0, 0.0, 0.0};
  const std::size_t n = s.nodeCount();
  for (std::size_t i = 0; i < n; ++i) {
    for (int k = 0; k < 3; ++k) c[k] += s.nodesMm[3 * i + k] / static_cast<double>(n);
  }
  for (std::size_t q = 0; q < s.quadCount(); ++q) {
    const double* p[4];
    for (int k = 0; k < 4; ++k) p[k] = &s.nodesMm[3 * s.quads[4 * q + k]];
    const double u[3] = {p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]};
    const double v[3] = {p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]};
    const double nrm[3] = {u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2],
                           u[0] * v[1] - u[1] * v[0]};
    double mid[3] = {0.0, 0.0, 0.0};
    for (int k = 0; k < 4; ++k) {
      for (int a = 0; a < 3; ++a) mid[a] += p[k][a] / 4.0;
    }
    const double out = nrm[0] * (mid[0] - c[0]) + nrm[1] * (mid[1] - c[1]) +
                       nrm[2] * (mid[2] - c[2]);
    if (!(out > 0.0)) return false;
  }
  return true;
}

}  // namespace

int main() {
  forge::uitest::Harness H("study_field");

  // ── A. the outside of the mesh ───────────────────────────────────────────
  {
    const Grid one = grid(1, 1, 1);
    const StudySurface s = exteriorOfHexMesh(one.nodes, one.hexes);
    CHECK_EQ_INT(s.quadCount(), 6);
    CHECK_EQ_INT(s.edgeCount(), 12);
    CHECK_EQ_INT(s.creaseCount(), 12);
    CHECK_EQ_INT(s.nodeCount(), 8);
    CHECK(woundOutward(s));

    const Grid two = grid(2, 1, 1);
    const StudySurface t = exteriorOfHexMesh(two.nodes, two.hexes);
    CHECK_EQ_INT(t.quadCount(), 10);
    CHECK_EQ_INT(t.edgeCount(), 12 + 10 - 2);
    CHECK_EQ_INT(t.creaseCount(), 16);
    CHECK(woundOutward(t));

    // 4 x 3 x 2: F = 2 (12 + 6 + 8) = 52; surface nodes = 5*4*3 - 3*2*1 = 54;
    // E = V + F - 2 = 104; corners = 4 (4 + 3 + 2) = 36.
    const Grid box = grid(4, 3, 2, 2.5, 2.0, 1.5);
    const StudySurface b = exteriorOfHexMesh(box.nodes, box.hexes);
    CHECK_EQ_INT(b.quadCount(), 52);
    CHECK_EQ_INT(b.edgeCount(), 104);
    CHECK_EQ_INT(b.creaseCount(), 36);
    CHECK(woundOutward(b));

    // An L of three bricks: its re-entrant edge is a corner too.
    Grid ell = grid(2, 2, 1);
    ell.hexes.erase(ell.hexes.begin() + 3 * 8, ell.hexes.end());  // drop brick (1,1)
    const StudySurface l = exteriorOfHexMesh(ell.nodes, ell.hexes);
    CHECK_EQ_INT(l.quadCount(), 3 * 2 + 8);
    // 6 corners around the L at the bottom, 6 at the top, 6 vertical: each
    // horizontal corner run of the L's outline is cut at every node it passes,
    // giving 8 bottom + 8 top segments, plus 6 vertical corner edges.
    CHECK_EQ_INT(l.creaseCount(), 8 + 8 + 6);

    // Hostile inputs give nothing rather than a read out of bounds.
    std::vector<std::uint32_t> bad = one.hexes;
    bad[5] = 99;
    CHECK(exteriorOfHexMesh(one.nodes, bad).empty());
    std::vector<std::uint32_t> ragged = one.hexes;
    ragged.pop_back();
    CHECK(exteriorOfHexMesh(one.nodes, ragged).empty());
    std::vector<double> odd = one.nodes;
    odd.pop_back();
    CHECK(exteriorOfHexMesh(odd, one.hexes).empty());
  }

  // ── B. normalising a mode shape ──────────────────────────────────────────
  {
    std::vector<double> shape = {0.0, 0.0, 0.0, 1.0, -2.0, 0.0, 0.0, 3.0, -4.0};
    std::uint32_t peak = 99;
    CHECK(normaliseModeShape(shape, 3, peak));
    CHECK_EQ_INT(peak, 2);
    // |(0, 3, -4)| = 5, and its largest component (-4) is turned positive.
    CHECK_NEAR(shape[6], 0.0, 1e-15);
    CHECK_NEAR(shape[7], -0.6, 1e-15);
    CHECK_NEAR(shape[8], 0.8, 1e-15);
    CHECK_NEAR(shape[3], -0.2, 1e-15);
    CHECK_NEAR(shape[4], 0.4, 1e-15);
    // Idempotent.
    std::vector<double> again = shape;
    CHECK(normaliseModeShape(again, 3, peak));
    for (std::size_t i = 0; i < shape.size(); ++i) CHECK_NEAR(again[i], shape[i], 1e-15);

    std::vector<double> zero(9, 0.0);
    CHECK(!normaliseModeShape(zero, 3, peak));
    std::vector<double> shortShape(8, 1.0);
    CHECK(!normaliseModeShape(shortShape, 3, peak));
    std::vector<double> nanShape(9, 1.0);
    nanShape[4] = std::nan("");
    CHECK(!normaliseModeShape(nanShape, 3, peak));
    CHECK(nanShape[0] == 1.0);  // left alone
  }

  // ── C. naming a mode from its own field ──────────────────────────────────
  {
    // A 10 x 2 x 2 beam along X, 1 mm bricks, so the long axis is X and the
    // section is 2 x 2 about (y, z) = (1, 1).
    const Grid beam = grid(10, 2, 2);
    const std::size_t n = beam.nodes.size() / 3;
    auto field = [&](auto f) {
      std::vector<double> u(3 * n, 0.0);
      for (std::size_t i = 0; i < n; ++i) {
        f(beam.nodes[3 * i], beam.nodes[3 * i + 1], beam.nodes[3 * i + 2], &u[3 * i]);
      }
      return u;
    };
    // Twist growing from nothing at x = 0: u = theta(x) e_x x (p - c).
    const std::vector<double> twist = field([](double x, double y, double z, double* u) {
      const double th = std::sin(kPi * x / 20.0);
      u[0] = 0.0;
      u[1] = -th * (z - 1.0);
      u[2] = th * (y - 1.0);
    });
    const ModeMotion t = classifyModeMotion(beam.nodes, twist);
    CHECK_EQ_INT(t.longAxis, 0);
    CHECK(t.character == ModeCharacter::Twisting);
    CHECK_NEAR(t.twist, 1.0, 1e-12);
    CHECK_EQ_STR(t.describe(), "twists about X");

    const std::vector<double> swingZ = field([](double x, double, double, double* u) {
      u[0] = 0.0;
      u[1] = 0.0;
      u[2] = (x / 10.0) * (x / 10.0);
    });
    const ModeMotion b = classifyModeMotion(beam.nodes, swingZ);
    CHECK(b.character == ModeCharacter::Bending);
    CHECK_EQ_INT(b.direction, 2);
    CHECK(b.singleDirection);
    CHECK_NEAR(b.share[2], 1.0, 1e-12);
    CHECK_NEAR(b.twist, 0.0, 1e-12);
    CHECK_EQ_STR(b.describe(), "bends along Z");

    // Half along Y, half along Z: one frequency, either direction.
    const std::vector<double> diagonal = field([](double x, double, double, double* u) {
      const double w = (x / 10.0) * (x / 10.0);
      u[0] = 0.0;
      u[1] = w;
      u[2] = w;
    });
    const ModeMotion d = classifyModeMotion(beam.nodes, diagonal);
    CHECK(d.character == ModeCharacter::Bending);
    CHECK(!d.singleDirection);
    CHECK_NEAR(d.share[1], 0.5, 1e-12);
    CHECK_EQ_STR(d.describe(), "bends along Y and Z");

    const std::vector<double> stretch = field([](double x, double, double, double* u) {
      u[0] = x / 10.0;
      u[1] = 0.0;
      u[2] = 0.0;
    });
    const ModeMotion s = classifyModeMotion(beam.nodes, stretch);
    CHECK(s.character == ModeCharacter::Stretching);
    CHECK_EQ_STR(s.describe(), "stretches along X");

    // A section that turns ONE way on one side and the OTHER way on the other
    // is not a twist: the best rigid turn of each slice explains none of it.
    const std::vector<double> scissor = field([](double x, double y, double z, double* u) {
      const double sign = (y < 1.0) ? -1.0 : (y > 1.0 ? 1.0 : 0.0);
      u[0] = 0.0;
      u[1] = -sign * (x / 10.0) * (z - 1.0);
      u[2] = sign * (x / 10.0) * (y - 1.0);
    });
    const ModeMotion sc = classifyModeMotion(beam.nodes, scissor);
    CHECK(sc.twist < 0.1);
    CHECK(sc.character != ModeCharacter::Twisting);

    // Every description is a sentence a person may read.
    for (const ModeMotion& m : {t, b, d, s, sc}) CHECK(scanUserFacingProse(m.describe()).empty());

    // A field of the wrong length is not classified.
    const ModeMotion none = classifyModeMotion(beam.nodes, std::vector<double>(5, 1.0));
    CHECK_NEAR(none.share[0] + none.share[1] + none.share[2], 0.0, 0.0);
  }

  // ── D. the drawn shape ───────────────────────────────────────────────────
  {
    const Grid beam = grid(4, 1, 1, 25.0, 10.0, 10.0);  // 100 x 10 x 10 mm
    const StudySurface s = exteriorOfHexMesh(beam.nodes, beam.hexes);
    const std::size_t n = s.nodeCount();
    std::vector<double> shape(3 * n, 0.0);
    for (std::size_t i = 0; i < n; ++i) shape[3 * i + 2] = s.nodesMm[3 * i] / 100.0;
    const double amp = modeDisplayAmplitudeMm(100.0);
    CHECK_NEAR(amp, 10.0, 1e-12);
    CHECK_NEAR(modeDisplayAmplitudeMm(0.0), 0.0, 0.0);
    CHECK_NEAR(modeDisplayAmplitudeMm(-5.0), 0.0, 0.0);
    CHECK_NEAR(modeDisplayAmplitudeMm(std::nan("")), 0.0, 0.0);

    const std::vector<Segment3> rest = modeShapeSegments(s, shape, amp, 0.0, false);
    const std::vector<Segment3> peak = modeShapeSegments(s, shape, amp, kPi / 2.0, false);
    const std::vector<Segment3> corners = modeShapeSegments(s, shape, amp, kPi / 2.0, true);
    CHECK_EQ_INT(rest.size(), s.edgeCount());
    CHECK_EQ_INT(corners.size(), s.creaseCount());
    double restMove = 0.0, tipMove = 0.0, rootMove = 0.0;
    for (std::size_t i = 0; i < rest.size(); ++i) {
      for (int e = 0; e < 2; ++e) {
        const double* r = e == 0 ? rest[i].a : rest[i].b;
        const double* p = e == 0 ? peak[i].a : peak[i].b;
        // At phase 0 the drawing is the mesh itself.
        const std::uint32_t id = s.edges[2 * i + static_cast<std::size_t>(e)];
        for (int c = 0; c < 3; ++c) {
          restMove = std::max(restMove, std::fabs(r[c] - s.nodesMm[3 * id + c]));
        }
        const double dz = p[2] - r[2];
        if (r[0] == 100.0) tipMove = std::max(tipMove, dz);
        if (r[0] == 0.0) rootMove = std::max(rootMove, std::fabs(dz));
        CHECK_NEAR(p[0], r[0], 0.0);
        CHECK_NEAR(p[1], r[1], 0.0);
      }
    }
    CHECK_NEAR(restMove, 0.0, 0.0);
    CHECK_NEAR(tipMove, amp, 1e-12);
    CHECK_NEAR(rootMove, 0.0, 0.0);
    // Half a cycle on, the tip is exactly as far the other way.
    const std::vector<Segment3> restCorners = modeShapeSegments(s, shape, amp, 0.0, true);
    const std::vector<Segment3> back = modeShapeSegments(s, shape, amp, -kPi / 2.0, true);
    CHECK_EQ_INT(back.size(), restCorners.size());
    double tipBack = 0.0;
    for (std::size_t i = 0; i < back.size() && i < restCorners.size(); ++i) {
      if (restCorners[i].a[0] == 100.0) tipBack = std::min(tipBack, back[i].a[2] - restCorners[i].a[2]);
    }
    CHECK_NEAR(tipBack, -amp, 1e-12);

    CHECK(modeShapeSegments(s, std::vector<double>(3 * n - 3, 0.0), amp, 1.0, false).empty());
    CHECK(modeShapeSegments(s, shape, std::nan(""), 1.0, false).empty());
  }

  // ── E. the temperature colours ───────────────────────────────────────────
  {
    const Rgb cold = temperatureColour(20.0, 20.0, 100.0);
    const Rgb mid = temperatureColour(60.0, 20.0, 100.0);
    const Rgb hot = temperatureColour(100.0, 20.0, 100.0);
    CHECK(cold.b > cold.r);
    CHECK(hot.r > hot.b);
    CHECK_NEAR(mid.r, mid.g, 1e-6);
    CHECK_NEAR(mid.g, mid.b, 1e-6);
    // Outside the range is clamped to its ends.
    const Rgb below = temperatureColour(-50.0, 20.0, 100.0);
    const Rgb above = temperatureColour(500.0, 20.0, 100.0);
    CHECK_NEAR(below.b, cold.b, 0.0);
    CHECK_NEAR(above.r, hot.r, 0.0);
    // The two halves move toward and away from the neutral middle: across the
    // cold half red rises (blue -> near-white), across the hot half blue falls
    // (near-white -> deep red). Neither channel is monotone over the whole range
    // on purpose: the middle is lighter than both ends.
    float lastBlue = 2.0f;
    bool blueFalls = true;
    for (int i = 0; i <= 100; ++i) {
      const Rgb c = temperatureColour(20.0 + 0.8 * i, 20.0, 100.0);
      if (i > 50 && c.b > lastBlue) blueFalls = false;
      lastBlue = c.b;
    }
    CHECK(blueFalls);
    float lastRed = -1.0f;
    bool redRises = true;
    for (int i = 0; i <= 50; ++i) {
      const Rgb c = temperatureColour(20.0 + 0.8 * i, 20.0, 100.0);
      if (c.r < lastRed) redRises = false;
      lastRed = c.r;
    }
    CHECK(redRises);
    const Rgb flat = temperatureColour(20.0, 20.0, 20.0);
    CHECK_NEAR(flat.r, 1.0, 0.0);
    CHECK_NEAR(flat.g, 1.0, 0.0);
    CHECK_NEAR(flat.b, 1.0, 0.0);
    const Rgb nan = temperatureColour(std::nan(""), 20.0, 100.0);
    CHECK_NEAR(nan.r, 1.0, 0.0);
  }

  return H.finish();
}
