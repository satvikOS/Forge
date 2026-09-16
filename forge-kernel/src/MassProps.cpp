#include "forge/MassProps.hpp"
#include "forge/ShapeRegistry.hpp"

#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <gp_Mat.hxx>
#include <gp_Pnt.hxx>

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
// REPRESENTATION CUT, STEP 1 (2026-09-16) — the two native branches below no
// longer reach the native payload through ShapeRegistry. They read it through
// the OCCT-free seam, forge/NativeShapeAccess.hpp: shapeKind() for the dispatch
// (ShapeHandle.hpp), nativeSolidOf() / nativeMeshOf() for the bodies. Neither
// header names an OCCT type, so the native half of this file is now expressed
// entirely in native nouns.
//
// ★ AND THIS FILE IS STILL NOT OCCT-FREE, WHICH IS THE HONEST HALF OF THE
//   RESULT. Two things keep OCCT here, and they are different in kind:
//     1. forge/ShapeRegistry.hpp, included above, declares get() -> const
//        TopoDS_Shape& and holds one by value in its private Entry, so it
//        includes TopoDS_Shape.hxx and every includer inherits OCCT no matter
//        how its own body is written (the argument forge/ShapeHandle.hpp makes
//        at length). That one is PLUMBING and a header split would remove it.
//     2. The ShapeKind::Occt fallback below IS OCCT MATHS — BRepGProp +
//        GProp_GProps on a TopoDS_Shape — and it is the DEFAULT live path.
//        MEASURED on this object file: its OCCT symbols are exactly those six
//        (TKG3d 4 + TKTopAlgo 2) and nothing else. No include split moves them;
//        only a sibling TU (the BodyInventory / BodyInventoryOcct split of
//        2026-09-12 is the precedent) or a native replacement would, and that
//        is outside this change's write set. Deleting the fallback to make the
//        number look better would change what the kernel computes.
#ifdef FORGE_NATIVE_BREP
#include "forge/NativeShapeAccess.hpp"         // nativeSolidOf / nativeMeshOf — no OCCT
#include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled()
#include "forge/native/brep/MassProps.hpp"
#include "forge/OcctImport.hpp"                // importOcctSolid (OCCT analytic -> native Solid)
#include <stdexcept>
#endif

namespace forge {

MassProperties massProperties(ShapeHandle h) {
#ifdef FORGE_NATIVE_BREP
    {
        // shapeKind() is kindOf() reached without the OCCT-typed registry header.
        // ONE DIFFERENCE, named rather than buried: kindOf() THREW for a handle
        // that names nothing, and shapeKind() answers ShapeKind::Occt for it by
        // design (see ShapeHandle.cpp). An invalid handle therefore falls through
        // to the OCCT path below, where get() throws for exactly the same set of
        // handles — so massProperties() still raises a std::runtime_error, and
        // callers that depend on that (FeatureTreeCompiler.cpp wraps this in
        // try/catch to decide `haveBefore`) see no change. Only the message text
        // differs: "ShapeRegistry::get — invalid handle" in place of
        // "ShapeRegistry::kindOf — invalid handle". MEASURED: no test, gate or
        // caller in the tree reads either string.
        const ShapeKind k = shapeKind(h);
        if (k == ShapeKind::NativeSolid) {
            const forge::native::brep::Solid* s = nativeSolidOf(h);
            if (s == nullptr) {
                // Faithful to getNativeSolid(), which REFUSED by throwing rather
                // than let a native handle take the OCCT route. Unreachable
                // today (addNativeSolid rejects a null solid, so no NativeSolid
                // entry has one), and kept because "unreachable" is a property
                // of the registry's current guards, not of this file.
                throw std::runtime_error(
                    "forge::massProperties — NativeSolid handle with no native solid");
            }
            forge::native::brep::MassProps mp = forge::native::brep::massProperties(*s);
            MassProperties out{mp.volume, mp.area, mp.com[0], mp.com[1], mp.com[2], {}};
            for (int i = 0; i < 9; ++i) out.inertiaCom[i] = mp.inertiaCom[i];
            return out;
        }
        if (k == ShapeKind::NativeMesh) {
            const forge::native::mesh::HalfEdgeMesh* m = nativeMeshOf(h);
            if (m == nullptr) {
                throw std::runtime_error(
                    "forge::massProperties — NativeMesh handle with no native mesh");
            }
            forge::native::brep::MeshMassOut mp =
                forge::native::brep::meshMassProperties(*m);
            MassProperties out{mp.volume, mp.area, mp.com[0], mp.com[1], mp.com[2], {}};
            for (int i = 0; i < 9; ++i) out.inertiaCom[i] = mp.inertiaCom[i];
            return out;
        }
        // PHASE-D ACTIVATION: an OCCT-backed analytic solid is imported into a native
        // Solid (importOcctSolid) and integrated by the EXACT divergence-theorem native
        // massProperties. Gated (default OFF). On an HONEST defer (non-analytic face /
        // non-manifold import) fall through to the OCCT BRepGProp path below — unchanged.
        // ★ THIS branch, and ONLY this branch, still speaks to the OCCT-typed
        //   registry: importOcctSolid() takes a TopoDS_Shape, so get() is the
        //   one call left that no native accessor can replace.
        if (k == ShapeKind::Occt && forge::native::brep::forgeNativeFeaturesEnabled()) {
            ImportResult ir = importOcctSolid(ShapeRegistry::instance().get(h));
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

} // namespace forge
