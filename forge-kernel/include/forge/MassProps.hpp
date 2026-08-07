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

// World-space axis-aligned bounding box of a shape.
//
// EXACT, and deliberately not the tessellated box. A mesh AABB is wrong twice
// over for placement: it under-reports a cylinder by the sag of the facet chords
// (0.5 mm at the deflection the compiler tessellates with), and it CHANGES when
// a shape acquires a triangulation from some unrelated earlier call — so the same
// tree would place a feature differently depending on what had been meshed
// before it. Placement has to be a function of the geometry alone.
//
// `valid` is false for a void/empty shape; the bounds are then untouched zeros.
struct BBox {
    double lo[3] = {0, 0, 0};
    double hi[3] = {0, 0, 0};
    bool   valid = false;
};

BBox boundingBox(ShapeHandle h);

} // namespace forge
