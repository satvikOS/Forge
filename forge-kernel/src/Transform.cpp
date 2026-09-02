#include "forge/Transform.hpp"

#include <BRepBuilderAPI_Transform.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>

// IN-HOUSE KERNEL STEP 3a — native translate/rotate on a native-backed handle
// (closes the placement gap: makeBox -> translate -> cut runs on the native
// backend). Behind FORGE_NATIVE_BREP + the runtime gate.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"
#include <cmath>
#include <memory>
#include <stdexcept>   // std::invalid_argument — the zero-axis guard on BOTH paths
#endif

namespace forge {

namespace {
ShapeHandle applyTrsf(ShapeHandle h, const gp_Trsf& tr) {
    const auto& shape = ShapeRegistry::instance().get(h);
    BRepBuilderAPI_Transform mover(shape, tr, /*copy*/ Standard_False);
    return ShapeRegistry::instance().add(mover.Shape());
}

#ifdef FORGE_NATIVE_BREP
// Apply a rigid (R,t) to a native-backed handle. NativeSolid -> analytic clone
// (transformSolid); NativeMesh -> transform the result soup. Returns a fresh
// native-backed handle. Throws "not native" so the caller can fall through to
// the OCCT path for an OCCT-backed handle.
ShapeHandle applyNativeRT(ShapeHandle h, const double R[9], const double t[3]) {
    using namespace forge::native::brep;
    auto& reg = ShapeRegistry::instance();
    if (reg.kindOf(h) == ShapeKind::NativeSolid) {
        std::shared_ptr<TopologyBuilder> owner;
        Solid* s = transformSolid(reg.getNativeSolid(h), R, t, owner);
        return reg.addNativeSolid(std::move(owner), s);
    }
    if (reg.kindOf(h) == ShapeKind::NativeMesh) {
        const auto& m = reg.getNativeMesh(h);
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        m.toSoup(pos, idx);
        for (std::size_t i = 0; i + 2 < pos.size(); i += 3) {
            double x = pos[i], y = pos[i+1], z = pos[i+2];
            pos[i]   = R[0]*x + R[1]*y + R[2]*z + t[0];
            pos[i+1] = R[3]*x + R[4]*y + R[5]*z + t[1];
            pos[i+2] = R[6]*x + R[7]*y + R[8]*z + t[2];
        }
        auto nm = std::make_shared<native::mesh::HalfEdgeMesh>();
        if (!nm->buildFromSoup(pos, idx))
            throw std::runtime_error("forge native transform: mesh rebuild failed");
        return reg.addNativeMesh(std::move(nm));
    }
    throw std::runtime_error("forge native transform: handle is OCCT-backed");
}
#endif
}

ShapeHandle translate(ShapeHandle h, double dx, double dy, double dz) {
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled() &&
        ShapeRegistry::instance().kindOf(h) != ShapeKind::Occt) {
        const double R[9] = {1,0,0, 0,1,0, 0,0,1};
        const double t[3] = {dx, dy, dz};
        return applyNativeRT(h, R, t);
    }
#endif
    gp_Trsf tr;
    tr.SetTranslation(gp_Vec(dx, dy, dz));
    return applyTrsf(h, tr);
}

ShapeHandle rotate(ShapeHandle h, double ax, double ay, double az, double angleRad) {
#ifdef FORGE_NATIVE_BREP
    if (native::brep::forgeNativeBrepEnabled() &&
        ShapeRegistry::instance().kindOf(h) != ShapeKind::Occt) {
        // Rodrigues rotation about the unit axis (ax,ay,az) through the origin —
        // identical convention to OCCT's gp_Ax1(origin, dir) + SetRotation.
        double n = std::sqrt(ax*ax + ay*ay + az*az);
        if (n < 1e-300) throw std::invalid_argument("forge rotate: zero axis");
        double ux = ax / n, uy = ay / n, uz = az / n;
        double c = std::cos(angleRad), s = std::sin(angleRad), C = 1.0 - c;
        const double R[9] = {
            c + ux*ux*C,      ux*uy*C - uz*s,   ux*uz*C + uy*s,
            uy*ux*C + uz*s,   c + uy*uy*C,      uy*uz*C - ux*s,
            uz*ux*C - uy*s,   uz*uy*C + ux*s,   c + uz*uz*C
        };
        const double t[3] = {0, 0, 0};
        return applyNativeRT(h, R, t);
    }
#endif
    // THE SAME INVARIANT THE NATIVE PATH ABOVE ALREADY CHECKS, on the OCCT path
    // that until now did not. gp_Dir's constructor RAISES on a null vector, and
    // Standard_ConstructionError does not derive from std::exception, so nothing
    // in the callers caught it: the throw unwound past every handler and
    // std::terminate aborted the process.
    //
    // MEASURED 2026-09-01 (600-row self-consistency run, verifier pid-parent
    // 68311): exactly 7 emissions carried a zero-axis ROTATE -- `ROTATE(%2, 0,
    // 0, 0, 0, 0, 30)` and kin -- and each one killed forge_verify with SIGABRT.
    // All 7 were then recorded by the harness as "the tree does not compile:
    // verifier produced no output", which is a claim about the MODEL'S OUTPUT
    // that nothing had established. Every one of the 19 forge_verify crash
    // reports on the machine that day has forge::rotate in its faulting frame.
    //
    // A std::invalid_argument here is caught by the compiler's per-op handler
    // and becomes an ordinary, attributable op error, so the row gets a VERDICT
    // instead of destroying the run that was measuring it.
    {
        const double n = std::sqrt(ax * ax + ay * ay + az * az);
        if (!(n > 0.0) || !std::isfinite(n))
            throw std::invalid_argument("forge rotate: zero axis");
    }
    gp_Trsf tr;
    const gp_Pnt origin(0, 0, 0);
    const gp_Dir axis(ax, ay, az);
    tr.SetRotation(gp_Ax1(origin, axis), angleRad);
    return applyTrsf(h, tr);
}

} // namespace forge
