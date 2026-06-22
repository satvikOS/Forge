// forge/native/brep/native_route_test.cpp
//
// Native (OCCT-free) gate for IN-HOUSE KERNEL STEP 3a — the routing layer:
//   * transformSolid (the PLACEMENT-GAP fix): a rigid (R,t) clone preserves
//     volume/inertia and relocates COM exactly to R*com + t, and stays a closed
//     2-manifold (so makeBox->translate->cut composes on the native backend).
//   * meshMassProperties: volume/COM/inertia of a closed triangle mesh (the
//     fillet/chamfer RESULT-mesh mass path) match the analytic box closed form.
//
// Auto-discovered by run_native.sh (the `brep` class). OCCT is NOT linkable here,
// so the reference is the closed-form MATH, not OCCT (the Node-level
// native_vs_occt_core.mjs gate is the actual native-vs-OCCT comparison).
//
// Pure C++20, no external deps, no test framework.

#include "forge/native/brep/NativeRoute.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static bool rel(double got, double exp, double tol) {
    double d = std::fabs(got - exp);
    double scale = std::max(1.0, std::fabs(exp));
    return d <= tol * scale;
}

int main() {
    std::printf("native_route_test — STEP 3a routing layer (transformSolid + meshMass)\n");

    // ---- gate toggle round-trips -------------------------------------------
    setForgeNativeBrepEnabled(true);
    check(forgeNativeBrepEnabled() == true, "gate: setForgeNativeBrepEnabled(true)");
    setForgeNativeBrepEnabled(false);
    check(forgeNativeBrepEnabled() == false, "gate: setForgeNativeBrepEnabled(false)");

    // ---- transformSolid: PURE TRANSLATION of a box -------------------------
    // Box [0,dx]x[0,dy]x[0,dz], analytic COM (dx/2,dy/2,dz/2), volume dx*dy*dz.
    const double dx = 2.0, dy = 3.0, dz = 4.0;
    SolidFactory fac;
    Solid* box = fac.buildBox(dx, dy, dz);
    MassProps mp0 = massProperties(*box);
    const double vol0 = mp0.volume;

    {
        const double R[9] = {1,0,0, 0,1,0, 0,0,1};
        const double t[3] = {10.0, -5.0, 2.5};
        std::shared_ptr<TopologyBuilder> owner;
        Solid* moved = transformSolid(*box, R, t, owner);
        MassProps mp = massProperties(*moved);
        check(rel(mp.volume, vol0, 1e-9), "translate: volume preserved");
        check(rel(mp.com[0], dx/2 + t[0], 1e-9), "translate: com.x = com0.x + tx");
        check(rel(mp.com[1], dy/2 + t[1], 1e-9), "translate: com.y = com0.y + ty");
        check(rel(mp.com[2], dz/2 + t[2], 1e-9), "translate: com.z = com0.z + tz");
        // inertia about COM is translation-invariant
        bool inertiaSame = true;
        for (int k = 0; k < 9; ++k)
            if (std::fabs(mp.inertiaCom[k] - mp0.inertiaCom[k]) > 1e-7 * std::max(1.0, std::fabs(mp0.inertiaCom[k])))
                inertiaSame = false;
        check(inertiaSame, "translate: inertia(about COM) invariant");
        // still a closed 2-manifold tessellation
        bool ok = false;
        auto m = tessellateSolidToMesh(*moved, ok);
        check(ok && m.validate().isValid(), "translate: clone is watertight 2-manifold");
    }

    // ---- transformSolid: 90deg rotation about Z ----------------------------
    {
        const double a = M_PI / 2.0, c = std::cos(a), s = std::sin(a);
        const double R[9] = { c,-s,0,  s,c,0,  0,0,1 };
        const double t[3] = {0,0,0};
        std::shared_ptr<TopologyBuilder> owner;
        Solid* rot = transformSolid(*box, R, t, owner);
        MassProps mp = massProperties(*rot);
        check(rel(mp.volume, vol0, 1e-9), "rotate90Z: volume preserved");
        // COM (1,1.5,2) -> R*com = (-1.5, 1, 2)
        check(rel(mp.com[0], -1.5, 1e-9), "rotate90Z: com.x");
        check(rel(mp.com[1],  1.0, 1e-9), "rotate90Z: com.y");
        check(rel(mp.com[2],  2.0, 1e-9), "rotate90Z: com.z");
        // Ixx and Iyy swap under a 90deg Z rotation (box 2x3x4):
        //   pre  Ixx=m/12(dy^2+dz^2)=50, Iyy=m/12(dx^2+dz^2)=40
        //   post Ixx=40, Iyy=50, Izz=26 unchanged
        check(rel(mp.inertiaCom[0], 40.0, 1e-7), "rotate90Z: Ixx -> 40 (was 50)");
        check(rel(mp.inertiaCom[4], 50.0, 1e-7), "rotate90Z: Iyy -> 50 (was 40)");
        check(rel(mp.inertiaCom[8], 26.0, 1e-7), "rotate90Z: Izz -> 26 (unchanged)");
        bool ok = false;
        auto m = tessellateSolidToMesh(*rot, ok);
        check(ok && m.validate().isValid(), "rotate90Z: clone is watertight 2-manifold");
    }

    // ---- meshMassProperties on the box tessellation ------------------------
    // The fillet/chamfer RESULT-mesh mass path. A box's tessellation is exact, so
    // its mesh mass must equal the analytic box closed form.
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        tessellateSolid(*box, pos, idx);
        forge::native::mesh::HalfEdgeMesh m;
        bool built = m.buildFromSoup(pos, idx);
        check(built && m.validate().isValid(), "meshMass: box tessellation is valid mesh");
        MeshMassOut mm = meshMassProperties(m);
        check(rel(mm.volume, dx*dy*dz, 1e-9), "meshMass: volume = dx*dy*dz");
        check(rel(mm.com[0], dx/2, 1e-9), "meshMass: com.x = dx/2");
        check(rel(mm.com[1], dy/2, 1e-9), "meshMass: com.y = dy/2");
        check(rel(mm.com[2], dz/2, 1e-9), "meshMass: com.z = dz/2");
        // analytic box inertia about COM: Ixx=50, Iyy=40, Izz=26 (computed above)
        check(rel(mm.inertiaCom[0], 50.0, 1e-6), "meshMass: Ixx = 50");
        check(rel(mm.inertiaCom[4], 40.0, 1e-6), "meshMass: Iyy = 40");
        check(rel(mm.inertiaCom[8], 26.0, 1e-6), "meshMass: Izz = 26");
        // off-diagonals ~ 0 for an axis-aligned box
        bool offZero = std::fabs(mm.inertiaCom[1]) < 1e-6 &&
                       std::fabs(mm.inertiaCom[2]) < 1e-6 &&
                       std::fabs(mm.inertiaCom[5]) < 1e-6;
        check(offZero, "meshMass: products of inertia ~ 0 (axis-aligned)");
    }

    std::printf("native_route_test RESULT: %d/%d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
