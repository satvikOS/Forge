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
// IN-HOUSE KERNEL STEP 3b — the native sketch-feature ops (OCCT-free).
#include "forge/native/brep/Sweep.hpp"
#include "forge/native/brep/Loft.hpp"
#include "forge/native/csg/Revolve.hpp"
#include "forge/native/geom/Geom.hpp"

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

    // ======================================================== STEP 3b feature ops
    // OCCT-free closed-form gate for the native sketch-feature ops that the live
    // extrude / revolve / sweep / loft route into. Reference = analytic MATH (no
    // OCCT here). Each must build a watertight 2-manifold solid.
    {
        namespace ng = forge::native::geom;
        namespace nbk = forge::native::brep;
        namespace ncsg = forge::native::csg;

        // ---- PRISM: square 4x4 swept length 5  -> volume = area * L = 80 -------
        {
            nbk::Profile p;
            p.outer = { {0,0},{4,0},{4,4},{0,4} };   // CCW, area 16
            nbk::SweepResult r = nbk::prism(p, 5.0);
            check(r.ok, "3b prism(square4x4, L=5): ok");
            check(r.ok && r.solid.validate().isValid(), "3b prism: watertight 2-manifold");
            check(r.ok && rel(r.volume, 16.0 * 5.0, 1e-9), "3b prism: volume = area*L = 80");
        }

        // ---- LINEAR SWEEP straight: square 2x2 along +X length 7 -> vol = 28 ---
        {
            nbk::Profile p;
            p.outer = { {-1,-1},{1,-1},{1,1},{-1,1} };  // CCW, area 4
            std::vector<ng::Point3> path = { {0,0,0}, {7,0,0} };
            nbk::SweepResult r = nbk::sweep(p, path);
            check(r.ok, "3b sweep(square along +X, L=7): ok");
            check(r.ok && r.solid.validate().isValid(), "3b sweep: watertight 2-manifold");
            check(r.ok && rel(r.volume, 4.0 * 7.0, 1e-9), "3b sweep: volume = area*L = 28");
        }

        // ---- REVOLVE 360: rect profile (u in [0,4], v in [2,3]) about an axis --
        // through origin along +Z (here u is the along-axis coord, v radial).
        // Annulus solid of revolution: V = pi*(R_out^2 - R_in^2)*height
        //   = pi*(9-4)*4 = 20 pi ~= 62.83185.
        {
            std::vector<ng::Point2> prof = { {0,2},{4,2},{4,3},{0,3} };  // (u=along, v=radial)
            ncsg::RevolveResult r = ncsg::revolve(prof, {0,0,0}, {0,0,1}, 360.0, 256);
            check(r.ok, "3b revolve360(annulus): ok");
            check(r.ok && r.mesh.validate().isValid(), "3b revolve360: watertight 2-manifold");
            const double vexp = M_PI * (9.0 - 4.0) * 4.0;
            check(r.ok && rel(r.mesh.signedVolume() < 0 ? -r.mesh.signedVolume()
                                                        : r.mesh.signedVolume(),
                              vexp, 5e-3), "3b revolve360: volume ~ 20*pi (mesh tol)");
            // Pappus analytic cross-check exposed by the op: theta*Rbar*A.
            check(r.ok && rel(r.pappusVolume, vexp, 1e-9), "3b revolve360: Pappus ref = 20*pi");
        }

        // ---- REVOLVE partial 90deg: same profile -> quarter of the annulus -----
        {
            std::vector<ng::Point2> prof = { {0,2},{4,2},{4,3},{0,3} };
            ncsg::RevolveResult r = ncsg::revolve(prof, {0,0,0}, {0,0,1}, 90.0, 64);
            check(r.ok, "3b revolve90(annulus quarter): ok");
            check(r.ok && r.mesh.validate().isValid(), "3b revolve90: watertight 2-manifold");
            const double vexp = M_PI * (9.0 - 4.0) * 4.0 * 0.25;
            const double vgot = std::fabs(r.mesh.signedVolume());
            check(r.ok && rel(vgot, vexp, 5e-3), "3b revolve90: volume ~ 5*pi (mesh tol)");
        }

        // ---- LOFT: square 4x4 (z=0) -> square 2x2 (z=1)  (frustum) -------------
        // V = h/3 (A0 + A1 + sqrt(A0 A1)) = 1/3 (16 + 4 + 8) = 28/3 ~= 9.33333.
        {
            nbk::LoftSection s0, s1;
            s0.points = { {-2,-2,0},{2,-2,0},{2,2,0},{-2,2,0} };  // 4x4, A=16
            s1.points = { {-1,-1,1},{1,-1,1},{1,1,1},{-1,1,1} };  // 2x2, A=4
            nbk::LoftResult r = nbk::loftSections({s0, s1}, {0,0,1});
            check(r.ok, "3b loft(4x4 -> 2x2 frustum): ok");
            check(r.ok && r.mesh.validate().isValid(), "3b loft: watertight 2-manifold");
            const double vexp = (1.0/3.0) * (16.0 + 4.0 + std::sqrt(16.0*4.0));
            check(r.ok && rel(r.volume, vexp, 1e-9), "3b loft: volume = 28/3 (frustum)");
        }

        // ---- LOFT honest gap: mismatched vertex counts -> ok=false (no fake) ---
        {
            nbk::LoftSection s0, s1;
            s0.points = { {-2,-2,0},{2,-2,0},{2,2,0},{-2,2,0} };          // 4 verts
            s1.points = { {-1,-1,1},{1,-1,1},{1,1,1},{0,1.4,1},{-1,1,1} }; // 5 verts
            nbk::LoftResult r = nbk::loftSections({s0, s1}, {0,0,1});
            check(!r.ok, "3b loft mismatched-count: honest ok=false (OCCT-only case)");
        }
    }

    std::printf("native_route_test RESULT: %d/%d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
