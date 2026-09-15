// ui/include/forge/ui/MassProperties.hpp
//
// MASS PROPERTIES -- mass, centre of mass and the inertia tensor of a part, from
// its material's density and the kernel's volume integrals.
//
// ── WHAT IS MEASURED AND WHAT IS MULTIPLIED ─────────────────────────────────
// The geometry is integrated ONCE, by the kernel, at unit density: a volume, a
// centroid and the second moments about that centroid. Those numbers belong to
// the SHAPE and do not change when the material does. A density is a scalar, so
// for a homogeneous solid
//
//     mass    = rho * V
//     COM     = centroid                       (density cancels)
//     I_com   = rho * I_unit                   (every entry scales)
//
// and changing aluminium to steel is three multiplications, not a rebuild. That
// is the property the Materials tab and part.set_material rely on, and a gate
// proves the rebuild counter does not move.
//
// ── UNITS, STATED ONCE AND CARRIED IN EVERY NAME ────────────────────────────
// The kernel works in millimetres, so the integrals are mm^3 and mm^5. Density is
// kg/m^3 (what every datasheet prints). 1 m^3 = 1e9 mm^3, so
//
//     kg per mm^3 = rho * 1e-9
//     massKg      = rho * 1e-9 * volumeMm3
//     inertiaKgMm2 = rho * 1e-9 * inertiaUnitDensityMm5
//
// A 100 x 50 x 10 mm aluminium block: 50000 mm^3 * 2700 * 1e-9 = 0.135 kg.
//
// ── A MEASUREMENT BELONGS TO THE PROGRAM IT WAS TAKEN ON ────────────────────
// GeometricIntegrals carries the exact IR program text the solid was built from.
// A report asked for against a document whose program has since changed is
// REFUSED -- the shape on record is not the shape in the document, and a weight
// for the old one presented as the weight of the new one is the wrong result
// reported as success this layer exists to prevent.
#ifndef FORGE_UI_MASSPROPERTIES_HPP
#define FORGE_UI_MASSPROPERTIES_HPP

#include <array>
#include <string>
#include <vector>

#include "forge/ui/Material.hpp"

namespace forge::ui {

struct BodyIntegrals {
  double volumeMm3 = 0.0;
  std::array<double, 3> centroidMm{};
};

struct GeometricIntegrals {
  bool known = false;
  std::string refusal;  // why they are not known, in words a person can act on
  std::string program;  // the IR program text the solid was built from
  double volumeMm3 = 0.0;
  std::array<double, 3> centroidMm{};
  // About the centroid, document axes, row-major, at unit density: the rigid-body
  // inertia tensor, I_ij = integral( |r|^2 delta_ij - r_i r_j ) dV, so the
  // off-diagonal entries are the NEGATED products of inertia.
  std::array<double, 9> inertiaUnitDensityMm5{};
  std::vector<BodyIntegrals> bodies;  // the separate solids, when there is more than one
};

struct BodyMass {
  double volumeMm3 = 0.0;
  double massKg = 0.0;
  std::array<double, 3> centreOfMassMm{};
};

struct MassPropertiesReport {
  bool known = false;
  std::string refusal;

  std::string materialId;
  std::string materialName;
  double densityKgPerM3 = 0.0;

  double volumeMm3 = 0.0;
  double massKg = 0.0;
  std::array<double, 3> centreOfMassMm{};
  std::array<double, 9> inertiaKgMm2{};           // about the centre of mass, row-major
  std::array<double, 3> principalMomentsKgMm2{};  // ascending
  std::vector<BodyMass> bodies;

  // One line of typed key=value pairs with the unit in every key. It is what
  // part.mass_properties returns to a caller, so Archie cites a number with its
  // unit and its provenance instead of a sentence it has to parse.
  std::string evidence() const;
};

// The report for `material` on `integrals`, or a refusal naming the reason: no
// density, geometry not measured, or measured on a different program than
// `currentProgram`.
MassPropertiesReport massPropertiesFor(const Material& material, const GeometricIntegrals& integrals,
                                       const std::string& currentProgram);

// Eigenvalues of a symmetric 3x3 matrix (row-major), ascending, by cyclic Jacobi
// rotation. False when the input is not symmetric to 1e-9 relative.
bool symmetricEigenvalues(const std::array<double, 9>& m, std::array<double, 3>& out);

}  // namespace forge::ui

#endif  // FORGE_UI_MASSPROPERTIES_HPP
