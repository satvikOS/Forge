#pragma once

#include "forge/ShapeHandle.hpp"

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

// The NATIVE kernel's answer only: the divergence-theorem integrator of
// forge::native::brep over the handle's analytic B-rep -- directly for a native
// solid, through the OCCT->native importer for an engine-built one. Returns false,
// leaving `out` untouched, whenever the native kernel cannot represent the shape
// exactly (a faceted native body, a face the importer defers, a build without
// FORGE_NATIVE_BREP). It never falls back to the engine: a caller that wants the
// native figure must be able to tell when it did not get one.
//
// The importer takes the FIRST solid of a compound, so for a multi-solid shape the
// answer covers one body. A caller compares it with massProperties() before
// trusting it -- the desktop's mass properties do exactly that.
bool nativeMassProperties(ShapeHandle h, MassProperties& out);

} // namespace forge
