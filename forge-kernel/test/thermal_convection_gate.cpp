// forge-kernel/test/thermal_convection_gate.cpp — T-393.
//
// THE CONVECTION (ROBIN) TERM OF fea::solveThermal AND fea::solveTransientThermal,
// AGAINST CLOSED FORMS.
//
// A side of the part that loses heat to a fluid at T_inf through a film
// coefficient h adds h * integral(N_i (T - T_inf) dA) to the conduction
// equations. Before T-393 the kernel replaced that integral by "the area of the
// bounding box's face, shared equally over every node tagged with the side".
// Measured (evidence/T-393): a 100 x 10 x 10 mm bar held at 100 C on -X and
// convecting on +X read 59.75..61.15 C at its end with a 4 x 4 section, against
// the closed form 60.746 C; with a section filling 3/4 of the box face it read
// 54.10..55.51 C, 6.6 K low, because the missing quarter was convected too.
//
// Cases (each against a value worked out by hand):
//   C1  1 x 1 section bar, convecting end: T_L = (k/L T0 + h Tinf)/(k/L + h).
//   C2  4 x 4 and 3 x 5 (non-square bricks) sections: the SAME T_L at every node
//       of the end, to 1e-9 K -- the end of a prismatic bar is isothermal.
//   C3  an L-section bar (3/4 of its box face): the same T_L, to 1e-9 K -- the
//       area that convects is the part's, not the box's.
//   C4  a thin fin convecting on both faces, root held, tip and sides insulated:
//       theta(x)/theta0 = cosh(m (L - x)) / cosh(m L), m = sqrt(2 h / (k t)).
//       Three in-plane resolutions; the tip error must fall at second order and
//       the finest must sit inside 0.1% of theta0.
//   C5  the TRANSIENT solver marched to steady on the C3 bar lands on the same
//       T_L, to 1e-8 K -- its Robin term is the steady one.
//   C6  no convection at all: a bar between two temperatures is still the
//       straight line at every node (the path with an empty list is untouched).
//
// Built and run by run_thermal_convection_gate.sh, which links this file and
// forge-kernel/src/FeaExtras.cpp (or a MUTANT of it) ahead of
// libforge_kernel_core.dylib, so the code under test is exactly the file given.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "forge/Fea.hpp"

using namespace forge::fea;

namespace {

int g_checks = 0;
int g_failures = 0;

void check(bool ok, const char* what, const std::string& detail) {
  ++g_checks;
  if (!ok) {
    ++g_failures;
    std::printf("  FAIL  %-62s  %s\n", what, detail.c_str());
  }
}

std::string num(double v) {
  char b[64];
  std::snprintf(b, sizeof(b), "%.9g", v);
  return std::string(b);
}

// An nx x ny x nz brick grid over [0,L] x [0,W] x [0,H] in the mesher's node
// order and side tagging (Fea.cpp meshFromBRep); keep(i, j, k) chooses bricks.
template <class Keep>
Mesh grid(int nx, int ny, int nz, double L, double W, double H, Keep keep) {
  Mesh m;
  m.elemNodeCount = 8;
  std::vector<int> id(static_cast<std::size_t>((nx + 1) * (ny + 1) * (nz + 1)), -1);
  auto nid = [&](int i, int j, int k) -> std::uint32_t {
    int& v = id[static_cast<std::size_t>((i * (ny + 1) + j) * (nz + 1) + k)];
    if (v < 0) {
      v = static_cast<int>(m.nodes.size() / 3);
      m.nodes.push_back(L * i / nx);
      m.nodes.push_back(W * j / ny);
      m.nodes.push_back(H * k / nz);
      std::uint32_t mask = 0;
      if (i == 0) mask |= 1u;
      if (i == nx) mask |= 2u;
      if (j == 0) mask |= 4u;
      if (j == ny) mask |= 8u;
      if (k == 0) mask |= 16u;
      if (k == nz) mask |= 32u;
      m.nodeToFace.push_back(mask);
    }
    return static_cast<std::uint32_t>(v);
  };
  for (int i = 0; i < nx; ++i) {
    for (int j = 0; j < ny; ++j) {
      for (int k = 0; k < nz; ++k) {
        if (!keep(i, j, k)) continue;
        const std::uint32_t n[8] = {nid(i, j, k),         nid(i + 1, j, k),
                                    nid(i + 1, j + 1, k), nid(i, j + 1, k),
                                    nid(i, j, k + 1),     nid(i + 1, j, k + 1),
                                    nid(i + 1, j + 1, k + 1), nid(i, j + 1, k + 1)};
        for (std::uint32_t v : n) m.tets.push_back(v);
      }
    }
  }
  return m;
}

bool all(int, int, int) { return true; }

std::vector<ThermalNodalT> holdSide(const Mesh& m, std::uint32_t bit, double T) {
  std::vector<ThermalNodalT> d;
  for (std::size_t i = 0; i < m.nodeToFace.size(); ++i) {
    if ((m.nodeToFace[i] & bit) != 0u) d.push_back({static_cast<std::uint32_t>(i), T});
  }
  return d;
}

void sideRange(const Mesh& m, const std::vector<double>& T, std::uint32_t bit, double& lo,
               double& hi) {
  lo = 1e300;
  hi = -1e300;
  for (std::size_t i = 0; i < m.nodeToFace.size(); ++i) {
    if ((m.nodeToFace[i] & bit) == 0u) continue;
    lo = std::min(lo, T[i]);
    hi = std::max(hi, T[i]);
  }
}

constexpr double kK = 51.9;     // W/(m K), mild steel
constexpr double kH = 500.0;    // W/(m^2 K)
constexpr double kTinf = 20.0;  // C
constexpr double kT0 = 100.0;   // C
constexpr double kL = 0.100, kW = 0.010, kHt = 0.010;  // m

double barEnd() { return (kK / kL * kT0 + kH * kTinf) / (kK / kL + kH); }

}  // namespace

int main() {
  std::printf("[convection] closed form for every bar: T_L = %.9f C\n", barEnd());

  // ── C1 / C2 / C3: the end of a prismatic bar ─────────────────────────────
  struct Bar {
    const char* name;
    int ny, nz;
    bool ell;
  };
  const Bar bars[] = {{"1x1 section", 1, 1, false},
                      {"4x4 section", 4, 4, false},
                      {"3x5 section (non-square bricks)", 3, 5, false},
                      {"L-section, 3/4 of the box face", 4, 4, true}};
  for (const Bar& b : bars) {
    const Mesh m = grid(40, b.ny, b.nz, kL, kW, kHt, [&](int, int j, int k) {
      return !(b.ell && j >= b.ny / 2 && k >= b.nz / 2);
    });
    const ThermalResult r =
        solveThermal(m, {kK}, holdSide(m, 1u, kT0), {}, {{1, kH, kTinf}});
    double lo = 0.0, hi = 0.0;
    sideRange(m, r.T, 2u, lo, hi);
    const double miss = std::max(std::fabs(lo - barEnd()), std::fabs(hi - barEnd()));
    std::printf("[convection] %-34s end %.9f .. %.9f C  (worst miss %.3g K)\n", b.name, lo, hi,
                miss);
    check(miss < 1e-9, "the convecting end of a prismatic bar is the closed form",
          std::string(b.name) + ": " + num(miss) + " K");
  }

  // ── C4: a thin fin convecting on both faces ──────────────────────────────
  {
    const double L = 0.100, W = 0.050, t = 0.002, k = 200.0, h = 25.0, Tinf = 20.0, T0 = 80.0;
    const double mm = std::sqrt(2.0 * h / (k * t));
    const double tipExact = Tinf + (T0 - Tinf) / std::cosh(mm * L);
    double err[3] = {0.0, 0.0, 0.0};
    const int nxs[3] = {10, 20, 40};
    for (int r = 0; r < 3; ++r) {
      const int nx = nxs[r];
      const Mesh m = grid(nx, nx / 2, 1, L, W, t, all);
      const ThermalResult res = solveThermal(m, {k}, holdSide(m, 1u, T0), {},
                                             {{4, h, Tinf}, {5, h, Tinf}});
      double lo = 0.0, hi = 0.0;
      sideRange(m, res.T, 2u, lo, hi);
      err[r] = (0.5 * (lo + hi) - tipExact) / (T0 - Tinf);
      std::printf("[convection] fin %2d x %2d: tip %.6f .. %.6f C, closed form %.6f C "
                  "(error %+.3e of theta0)\n",
                  nx, nx / 2, lo, hi, tipExact, err[r]);
      // The fin is one brick thick and its sides are insulated, so the tip is
      // isothermal across its width to round-off.
      check(hi - lo < 1e-9, "the fin's tip is one temperature across its width", num(hi - lo));
    }
    const double p1 = std::log2(std::fabs(err[0] / err[1]));
    const double p2 = std::log2(std::fabs(err[1] / err[2]));
    std::printf("[convection] fin tip: observed order %.3f then %.3f\n", p1, p2);
    check(std::fabs(err[2]) < std::fabs(err[1]) && std::fabs(err[1]) < std::fabs(err[0]),
          "the fin's tip converges as the mesh is refined",
          num(err[0]) + " -> " + num(err[1]) + " -> " + num(err[2]));
    check(p1 > 1.8 && p1 < 2.2 && p2 > 1.8 && p2 < 2.2, "at second order",
          num(p1) + ", " + num(p2));
    check(std::fabs(err[2]) < 1e-3, "and the finest is within 0.1% of theta0", num(err[2]));
  }

  // ── C5: the transient solver, marched to steady ──────────────────────────
  {
    const Mesh m = grid(40, 4, 4, kL, kW, kHt, [](int, int j, int k) { return !(j >= 2 && k >= 2); });
    TransientThermalConfig cfg;
    cfg.rhoC = 3.6e6;  // J/(m^3 K), steel
    cfg.dt = 1.0e5;    // s: backward Euler at this step damps every mode by > 30 per step
    cfg.nSteps = 40;
    cfg.T0 = kTinf;
    const TransientThermalResult r = solveTransientThermal(m, {kK}, cfg, holdSide(m, 1u, kT0), {},
                                                           {{1, kH, kTinf}}, {});
    double lo = 0.0, hi = 0.0;
    sideRange(m, r.T, 2u, lo, hi);
    const double miss = std::max(std::fabs(lo - barEnd()), std::fabs(hi - barEnd()));
    std::printf("[convection] transient, marched to steady: end %.9f .. %.9f C (worst miss %.3g K)\n",
                lo, hi, miss);
    check(miss < 1e-8, "the transient Robin term is the steady one", num(miss) + " K");
  }

  // ── C6: no convection ────────────────────────────────────────────────────
  {
    const Mesh m = grid(40, 4, 4, kL, kW, kHt, all);
    std::vector<ThermalNodalT> d = holdSide(m, 1u, 100.0);
    const std::vector<ThermalNodalT> cold = holdSide(m, 2u, 20.0);
    d.insert(d.end(), cold.begin(), cold.end());
    const ThermalResult r = solveThermal(m, {kK}, d, {}, {});
    double worst = 0.0;
    for (std::size_t i = 0; i < r.T.size(); ++i) {
      worst = std::max(worst, std::fabs(r.T[i] - (100.0 - 80.0 * m.nodes[3 * i] / kL)));
    }
    std::printf("[convection] no convection: worst departure from the straight line %.3g K\n",
                worst);
    check(worst < 1e-9, "with no convection the bar is still the straight line", num(worst));
  }

  std::printf("[convection] %d checks, %d failures — %s\n", g_checks, g_failures,
              g_failures == 0 ? "PASS" : "FAIL");
  return g_failures == 0 ? 0 : 1;
}
