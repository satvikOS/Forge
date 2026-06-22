#include "forge/MassProps.hpp"

#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <gp_Mat.hxx>
#include <gp_Pnt.hxx>

// IN-HOUSE KERNEL STEP 3a — native mass-properties on a native-backed handle
// behind FORGE_NATIVE_BREP. NativeSolid -> exact analytic (divergence theorem);
// NativeMesh (fillet/chamfer result) -> mesh tetra-decomposition (HONEST: a mesh
// inertia, not analytic).
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"
#include "forge/native/brep/MassProps.hpp"
#endif

namespace forge {

MassProperties massProperties(ShapeHandle h) {
#ifdef FORGE_NATIVE_BREP
    {
        auto& reg = ShapeRegistry::instance();
        ShapeKind k = reg.kindOf(h);
        if (k == ShapeKind::NativeSolid) {
            forge::native::brep::MassProps mp =
                forge::native::brep::massProperties(reg.getNativeSolid(h));
            MassProperties out{mp.volume, mp.area, mp.com[0], mp.com[1], mp.com[2], {}};
            for (int i = 0; i < 9; ++i) out.inertiaCom[i] = mp.inertiaCom[i];
            return out;
        }
        if (k == ShapeKind::NativeMesh) {
            forge::native::brep::MeshMassOut mp =
                forge::native::brep::meshMassProperties(reg.getNativeMesh(h));
            MassProperties out{mp.volume, mp.area, mp.com[0], mp.com[1], mp.com[2], {}};
            for (int i = 0; i < 9; ++i) out.inertiaCom[i] = mp.inertiaCom[i];
            return out;
        }
    }
#endif
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
