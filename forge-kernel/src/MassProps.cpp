#include "forge/MassProps.hpp"

#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <gp_Mat.hxx>
#include <gp_Pnt.hxx>

#include <cmath>

// IN-HOUSE KERNEL STEP 3a — native mass-properties on a native-backed handle
// behind FORGE_NATIVE_BREP. NativeSolid -> exact analytic (divergence theorem);
// NativeMesh (fillet/chamfer result) -> mesh tetra-decomposition (HONEST: a mesh
// inertia, not analytic).
//
// PHASE-D ACTIVATION (2026-06-25) — wired LIVE for OCCT inputs via the OCCT->native
// importer forge::importOcctSolid (src/OcctImport.cpp). An OCCT-backed (ShapeKind::Occt)
// handle is now imported into a native analytic Solid (analytic box/cyl/cone/sphere/prism
// + analytic-boolean results + NURBS/Bezier faces) and the EXACT divergence-theorem
// massProperties runs on it, instead of deferring to OCCT's BRepGProp. SAFE + HONEST: if
// importOcctSolid defers (ok==false: Torus/Revolution/non-analytic, or a non-manifold
// import) the helper falls through to the OCCT BRepGProp path below, byte-identical to
// today. Behind forgeNativeFeaturesEnabled() (default OFF). Mirrors the InterferenceDetection
// / Fea / FeaTet / ShapeCheck / ShapeFix importer activations.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled()
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Aabb.hpp"          // computeAabb (exact analytic AABB, native handles)
#include "forge/OcctImport.hpp"                // importOcctSolid (OCCT analytic -> native Solid)
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
        // PHASE-D ACTIVATION: an OCCT-backed analytic solid is imported into a native
        // Solid (importOcctSolid) and integrated by the EXACT divergence-theorem native
        // massProperties. Gated (default OFF). On an HONEST defer (non-analytic face /
        // non-manifold import) fall through to the OCCT BRepGProp path below — unchanged.
        if (k == ShapeKind::Occt && forge::native::brep::forgeNativeFeaturesEnabled()) {
            ImportResult ir = importOcctSolid(reg.get(h));
            if (ir.ok && ir.solid != nullptr) {
                forge::native::brep::MassProps mp =
                    forge::native::brep::massProperties(*ir.solid);
                MassProperties out{mp.volume, mp.area, mp.com[0], mp.com[1], mp.com[2], {}};
                for (int i = 0; i < 9; ++i) out.inertiaCom[i] = mp.inertiaCom[i];
                return out;
            }
            // import deferred -> OCCT BRepGProp path below (unchanged).
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

// ------------------------------------------------------------------ boundingBox
//
// BRepBndLib::AddOptimal(shape, box, useTriangulation=false, useShapeTolerance=false):
//
//  * useTriangulation=false — a triangulation is an ARTEFACT of whoever meshed the
//    shape last, not a property of it. With the default (true) the same solid boxes
//    differently before and after a tessellate() call, which would make a placement
//    op non-deterministic. Turning it off makes the answer a function of the
//    geometry alone.
//  * useShapeTolerance=false — Add() inflates by each sub-shape's tolerance; that
//    turns "flush" into "flush plus 1e-7" and the box would no longer reproduce the
//    TRANSLATE it replaces to full precision.
//  * AddOptimal rather than Add because Add bounds a B-spline face by its POLE hull,
//    which overshoots. AddOptimal solves for the real extrema.
//
// SetGap(0) afterwards because Bnd_Box::Get() returns the stored bounds widened by
// the gap, and any Enlarge() inside OCCT leaves one behind.
BBox boundingBox(ShapeHandle h) {
    BBox out;
#ifdef FORGE_NATIVE_BREP
    {
        auto& reg = ShapeRegistry::instance();
        const ShapeKind k = reg.kindOf(h);
        if (k == ShapeKind::NativeSolid) {
            const auto bb = forge::native::brep::computeAabb(reg.getNativeSolid(h));
            if (bb.void_) return out;
            out.lo[0] = bb.minX; out.lo[1] = bb.minY; out.lo[2] = bb.minZ;
            out.hi[0] = bb.maxX; out.hi[1] = bb.maxY; out.hi[2] = bb.maxZ;
            out.valid = true;
            return out;
        }
        if (k == ShapeKind::NativeMesh) {
            // A native mesh has no analytic surface: its AABB IS its vertex hull.
            const auto& m = reg.getNativeMesh(h);
            bool any = false;
            for (const auto& v : m.vertices()) {
                const double c[3] = {v.position.x, v.position.y, v.position.z};
                for (int j = 0; j < 3; ++j) {
                    if (!any || c[j] < out.lo[j]) out.lo[j] = c[j];
                    if (!any || c[j] > out.hi[j]) out.hi[j] = c[j];
                }
                any = true;
            }
            out.valid = any;
            return out;
        }
    }
#endif
    try {
        const auto& shape = ShapeRegistry::instance().get(h);
        Bnd_Box bb;
        BRepBndLib::AddOptimal(shape, bb, Standard_False, Standard_False);
        if (bb.IsVoid()) return out;
        bb.SetGap(0.0);
        bb.Get(out.lo[0], out.lo[1], out.lo[2], out.hi[0], out.hi[1], out.hi[2]);
        for (int k = 0; k < 3; ++k)
            if (!std::isfinite(out.lo[k]) || !std::isfinite(out.hi[k])) return out;
        out.valid = true;
    } catch (const std::exception&) {
        out.valid = false;
    }
    return out;
}

} // namespace forge
