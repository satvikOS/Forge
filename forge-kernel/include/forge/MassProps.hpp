#pragma once

#include "forge/ShapeRegistry.hpp"

namespace forge {

struct MassProperties {
    double volume;
    double area;
    double cx, cy, cz;
    // Rigid-body inertia tensor of the solid about its CENTRE OF MASS, at unit
    // density (units = mm^5 ≡ mass·mm² when mass == volume). Symmetric 3×3,
    // stored row-major:
    //   [ Ixx Ixy Ixz   Iyx Iyy Iyz   Izx Izy Izz ].
    // Sourced from OCCT GProp_GProps::MatrixOfInertia(), which is documented to
    // be returned in the central (centre-of-mass) coordinate system — so no
    // Huygens/parallel-axis shift is applied here. Off-diagonals are the real
    // products of inertia (zero only for axis-aligned symmetric solids).
    double inertiaCom[9];
};

MassProperties massProperties(ShapeHandle h);

} // namespace forge
