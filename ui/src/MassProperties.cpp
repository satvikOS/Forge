#include "forge/ui/MassProperties.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/Units.hpp"

namespace forge::ui {
namespace {

// kg per mm^3 for a density in kg/m^3.
constexpr double kKgPerMm3PerKgPerM3 = 1.0e-9;

std::string num(double v) { return formatRoundTripNumber(v); }

std::string triple(const std::array<double, 3>& v) {
  return "(" + num(v[0]) + "," + num(v[1]) + "," + num(v[2]) + ")";
}

}  // namespace

bool symmetricEigenvalues(const std::array<double, 9>& in, std::array<double, 3>& out) {
  double scale = 0.0;
  for (double v : in) scale = std::max(scale, std::fabs(v));
  const auto at = [](int r, int c) { return static_cast<std::size_t>(r * 3 + c); };
  for (int r = 0; r < 3; ++r) {
    for (int c = r + 1; c < 3; ++c) {
      if (std::fabs(in[at(r, c)] - in[at(c, r)]) > 1e-9 * std::max(scale, 1e-300)) return false;
    }
  }
  if (scale == 0.0) {
    out = {0.0, 0.0, 0.0};
    return true;
  }
  std::array<double, 9> a = in;
  for (int sweep = 0; sweep < 64; ++sweep) {
    double off = 0.0;
    for (int r = 0; r < 3; ++r) {
      for (int c = r + 1; c < 3; ++c) off += a[at(r, c)] * a[at(r, c)];
    }
    if (off <= 1e-30 * scale * scale) break;
    for (int p = 0; p < 3; ++p) {
      for (int q = p + 1; q < 3; ++q) {
        const double apq = a[at(p, q)];
        if (std::fabs(apq) <= 1e-300) continue;
        const double theta = (a[at(q, q)] - a[at(p, p)]) / (2.0 * apq);
        const double t = (theta >= 0.0 ? 1.0 : -1.0) /
                         (std::fabs(theta) + std::sqrt(theta * theta + 1.0));
        const double cs = 1.0 / std::sqrt(t * t + 1.0);
        const double sn = t * cs;
        for (int k = 0; k < 3; ++k) {
          const double akp = a[at(k, p)];
          const double akq = a[at(k, q)];
          a[at(k, p)] = cs * akp - sn * akq;
          a[at(k, q)] = sn * akp + cs * akq;
        }
        for (int k = 0; k < 3; ++k) {
          const double apk = a[at(p, k)];
          const double aqk = a[at(q, k)];
          a[at(p, k)] = cs * apk - sn * aqk;
          a[at(q, k)] = sn * apk + cs * aqk;
        }
      }
    }
  }
  out = {a[0], a[4], a[8]};
  std::sort(out.begin(), out.end());
  return true;
}

MassPropertiesReport massPropertiesFor(const Material& material, const GeometricIntegrals& integrals,
                                       const std::string& currentProgram) {
  MassPropertiesReport r;
  r.materialId = material.id;
  r.materialName = material.name;
  r.densityKgPerM3 = material.densityKgPerM3;
  if (!material.hasDensity()) {
    r.refusal = "this part has no material with a density, so it has no mass; choose a material "
                "first";
    return r;
  }
  if (!integrals.known) {
    r.refusal = integrals.refusal.empty()
                    ? std::string("the shape has not been measured, so it has no mass yet")
                    : integrals.refusal;
    return r;
  }
  if (integrals.program != currentProgram) {
    r.refusal = "the shape has changed since it was last measured; its mass will be available "
                "once it has been rebuilt";
    return r;
  }
  if (!(integrals.volumeMm3 > 0.0) || !std::isfinite(integrals.volumeMm3)) {
    r.refusal = "the shape does not enclose a positive volume, so it has no mass";
    return r;
  }
  const double k = material.densityKgPerM3 * kKgPerMm3PerKgPerM3;
  r.volumeMm3 = integrals.volumeMm3;
  r.massKg = k * integrals.volumeMm3;
  r.centreOfMassMm = integrals.centroidMm;
  for (std::size_t i = 0; i < 9; ++i) r.inertiaKgMm2[i] = k * integrals.inertiaUnitDensityMm5[i];
  if (!symmetricEigenvalues(r.inertiaKgMm2, r.principalMomentsKgMm2)) {
    r.refusal = "the measured inertia is not symmetric, so it is not a valid measurement of a solid";
    return r;
  }
  // A rigid body's principal moments are non-negative and obey the triangle
  // inequality (I1 + I2 >= I3). A tensor that breaks either is not the inertia of
  // any solid, whatever produced it.
  const auto& p = r.principalMomentsKgMm2;
  const double tol = 1e-9 * std::max(1.0, p[2]);
  if (p[0] < -tol || p[0] + p[1] < p[2] - tol) {
    r.refusal = "the measured inertia is not that of a real solid, so it is not reported";
    return r;
  }
  r.bodies.reserve(integrals.bodies.size());
  for (const BodyIntegrals& b : integrals.bodies) {
    BodyMass m;
    m.volumeMm3 = b.volumeMm3;
    m.massKg = k * b.volumeMm3;
    m.centreOfMassMm = b.centroidMm;
    r.bodies.push_back(m);
  }
  r.known = true;
  return r;
}

std::string MassPropertiesReport::evidence() const {
  if (!known) return "mass_known=0";
  std::string s = "mass_known=1 material=" + materialId + " density_kg_m3=" + num(densityKgPerM3) +
                  " volume_mm3=" + num(volumeMm3) + " mass_kg=" + num(massKg) +
                  " com_mm=" + triple(centreOfMassMm) + " inertia_com_kg_mm2=[";
  for (std::size_t i = 0; i < 9; ++i) {
    s += num(inertiaKgMm2[i]);
    s += (i == 8) ? "]" : ((i % 3 == 2) ? ";" : ",");
  }
  s += " principal_kg_mm2=" + triple(principalMomentsKgMm2);
  s += " bodies=" + std::to_string(bodies.empty() ? 1 : bodies.size());
  return s;
}

}  // namespace forge::ui
