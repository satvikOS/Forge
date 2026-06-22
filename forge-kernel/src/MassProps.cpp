#include "forge/MassProps.hpp"

#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <gp_Mat.hxx>
#include <gp_Pnt.hxx>

namespace forge {

MassProperties massProperties(ShapeHandle h) {
    const auto& shape = ShapeRegistry::instance().get(h);
    GProp_GProps volumeProps;
    BRepGProp::VolumeProperties(shape, volumeProps);
    GProp_GProps surfaceProps;
    BRepGProp::SurfaceProperties(shape, surfaceProps);

    const gp_Pnt c = volumeProps.CentreOfMass();

    // Rigid-body inertia tensor ABOUT THE CENTRE OF MASS. OCCT documents
    // MatrixOfInertia() as already expressed in the central (G) coordinate
    // system, so it needs no parallel-axis shift. gp_Mat::Value is 1-indexed
    // and the matrix is symmetric; we mirror the off-diagonals explicitly.
    const gp_Mat I = volumeProps.MatrixOfInertia();
    const double Ixx = I.Value(1, 1);
    const double Iyy = I.Value(2, 2);
    const double Izz = I.Value(3, 3);
    const double Ixy = I.Value(1, 2);
    const double Ixz = I.Value(1, 3);
    const double Iyz = I.Value(2, 3);

    MassProperties out{
        volumeProps.Mass(),  // for unit density this equals volume
        surfaceProps.Mass(), // for surface props this is area
        c.X(), c.Y(), c.Z(),
        {
            Ixx, Ixy, Ixz,
            Ixy, Iyy, Iyz,
            Ixz, Iyz, Izz,
        },
    };
    return out;
}

} // namespace forge
