#include "forge/MassProps.hpp"

#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <gp_Pnt.hxx>

namespace forge {

MassProperties massProperties(ShapeHandle h) {
    const auto& shape = ShapeRegistry::instance().get(h);
    GProp_GProps volumeProps;
    BRepGProp::VolumeProperties(shape, volumeProps);
    GProp_GProps surfaceProps;
    BRepGProp::SurfaceProperties(shape, surfaceProps);

    const gp_Pnt c = volumeProps.CentreOfMass();
    return MassProperties{
        volumeProps.Mass(),  // for unit density this equals volume
        surfaceProps.Mass(), // for surface props this is area
        c.X(), c.Y(), c.Z(),
    };
}

} // namespace forge
