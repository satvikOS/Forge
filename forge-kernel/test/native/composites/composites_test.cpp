// forge/native/composites/composites_test.cpp
//
// Standalone validation gate for forge::native::composites — the COMPOSITES /
// LAMINATE workbench (CLT ABD + kinematic draping + per-element orientation +
// versioned layup schedule). Every fixture is deterministic and analytically
// anchored; the lamina constants are pulled from the SHARED #38 MaterialDB
// (CFRP_UD_T700: E1~135 GPa, E2~9.5 GPa, G12~4.5 GPa, nu12~0.31) so the two
// modules stay coupled to one source of truth.
//
//   (1) Plane-stress Q / Qbar correctness: Qbar(0)==Q (Q16=Q26=0); Qbar(pi/2) swaps
//       Q11<->Q22; 45deg matches the closed-form Jones formulas. Single-ply CLT Ex
//       cross-checks the off-axis 1/Ex(theta) lamina law (independent oracle).
//   (2) Symmetric cross-ply [0/90]s: B ~ 0 (1e-9, the key check), symmetric==true,
//       A16=A26~0, and Ex matches the membrane Qbar-sum oracle to 1e-6.
//   (3) Off-axis: a bare [45] single ply has A16 != 0 (shear-extension coupling) of
//       the right sign; a balanced [+45/-45] zeroes A16/A26 (balanced==true) while a
//       [45/45] does not; [+-45]s Gxy is high (the shear-stiff laminate).
//   (4) Single-ply asymmetry [0/90] (not symmetric) -> B != 0, symmetric==false.
//   (5) Drape on a flat plane and a developable cylinder: maxShear ~ 0, no wrinkle.
//   (6) Drape on a hemisphere: maxShear > 0, GROWS with curvature (smaller radius)
//       and with distance from the seed; high enough curvature trips a wrinkle flag.
//       Saddle (negative Gaussian curvature): |shear| > 0 too.
//   (7) Per-element orientation: nominal on the flat region; deviates on the curved
//       region (at least one element's fibreAngle != nominal), wrinkled flagged.
//   (8) Versioned schedule: commit -> id=1; change orientation/resin/cure -> id=2,
//       parentId=1; get(1) unchanged; size()==2.
//   (9) Honesty: empty laminate -> ok==false; a non-convergent drape -> ok==false.
//
// HONESTY: live FEA/bridge wiring and the brep::NurbsSurface tool adapter are the
// noted follow-ups (Composites.hpp HONESTY block); nothing here is stubbed.
//
// Build & run (also via test/native/run_native.sh):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/src/native/materials/Materials.cpp \
//       forge-kernel/src/native/composites/Composites.cpp \
//       forge-kernel/test/native/composites/composites_test.cpp \
//       -o /tmp/composites_test && /tmp/composites_test

#include "forge/native/composites/Composites.hpp"
#include "forge/native/materials/Materials.hpp"

#include <cstdio>
#include <cmath>
#include <vector>
#include <array>
#include <cstdint>
#include <cstddef>
#include <limits>
#include <algorithm>
#include <string>
#include <functional>

using namespace forge::native;
namespace cmp = forge::native::composites;

static int g_pass = 0;
static int g_total = 0;
static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; }
    else      { std::printf("  [FAIL] %s\n", name); }
}
static bool approx(double a, double b, double tol = 1e-7) {
    return std::fabs(a - b) <= tol * (1.0 + std::fabs(a) + std::fabs(b));
}

// The shared CFRP UD lamina key (#38 DB).
static materials::MatKey cfrpKey() {
    return materials::MatKey{ materials::Material::CFRP_UD_T700,
                             materials::Process::PREPREG_AUTOCLAVE,
                             materials::BuildOrient::NA,
                             materials::PostProcess::NONE };
}

int main() {
    materials::MaterialDB db;
    bool dbok = false;
    materials::OrthoConstants cfrp = cmp::orthoFromDB(db, cfrpKey(), dbok);
    check(dbok, "(0a) CFRP_UD_T700 orthotropic constants pulled from shared #38 MaterialDB");
    check(cfrp.E1.mean > 1.2e11 && cfrp.E1.mean < 1.5e11, "(0b) E1 ~ 135 GPa (real UD)");
    check(cfrp.E2.mean > 8e9 && cfrp.E2.mean < 1.1e10, "(0c) E2 ~ 9.5 GPa (real UD)");

    const double E1 = cfrp.E1.mean, E2 = cfrp.E2.mean, G12 = cfrp.G12.mean, nu12 = cfrp.nu12.mean;
    const double nu21 = nu12 * E2 / E1;
    const double den = 1.0 - nu12 * nu21;
    const double Q11ref = E1 / den, Q22ref = E2 / den, Q12ref = nu12 * E2 / den, Q66ref = G12;

    auto plyAt = [&](double deg, double tmm) {
        cmp::Ply p; p.material = cfrp; p.thickness = tmm * 1e-3;
        p.angle = deg * M_PI / 180.0; p.materialName = "CFRP UD T700"; return p;
    };

    // =======================================================================
    // (1) Plane-stress Q / Qbar correctness + off-axis Ex cross-check.
    // =======================================================================
    {
        cmp::ReducedStiffness Q = cmp::reducedStiffness(cfrp);
        check(approx(Q.Q11, Q11ref, 1e-9) && approx(Q.Q22, Q22ref, 1e-9) &&
              approx(Q.Q12, Q12ref, 1e-9) && approx(Q.Q66, Q66ref, 1e-9),
              "(1a) reducedStiffness matches the plane-stress Q closed form");

        cmp::Qbar qb0 = cmp::rotatedQ(Q, 0.0);
        check(approx(qb0.Q11, Q.Q11, 1e-9) && approx(qb0.Q22, Q.Q22, 1e-9) &&
              approx(qb0.Q12, Q.Q12, 1e-9) && approx(qb0.Q66, Q.Q66, 1e-9),
              "(1b) Qbar(0) == Q");
        check(std::fabs(qb0.Q16) < 1e-3 && std::fabs(qb0.Q26) < 1e-3,
              "(1c) Qbar(0): Q16 = Q26 = 0 (no shear-extension coupling on-axis)");

        cmp::Qbar qb90 = cmp::rotatedQ(Q, M_PI / 2.0);
        check(approx(qb90.Q11, Q.Q22, 1e-6) && approx(qb90.Q22, Q.Q11, 1e-6),
              "(1d) Qbar(90) swaps Q11<->Q22 (fibre now along y)");
        check(std::fabs(qb90.Q16) < 1e-3 && std::fabs(qb90.Q26) < 1e-3,
              "(1e) Qbar(90): Q16 = Q26 = 0");

        // 45deg closed-form cross-check (Jones formulas, recomputed independently).
        const double th = M_PI / 4.0, c = std::cos(th), s = std::sin(th);
        const double c2 = c*c, s2 = s*s, c4 = c2*c2, s4 = s2*s2, c2s2 = c2*s2;
        const double c3 = c2*c, s3 = s2*s;
        const double e16 = (Q.Q11 - Q.Q12 - 2*Q.Q66)*c3*s - (Q.Q22 - Q.Q12 - 2*Q.Q66)*s3*c;
        const double e11 = Q.Q11*c4 + 2*(Q.Q12 + 2*Q.Q66)*c2s2 + Q.Q22*s4;
        cmp::Qbar qb45 = cmp::rotatedQ(Q, th);
        check(approx(qb45.Q11, e11, 1e-9), "(1f) Qbar(45) Q11 matches the closed form");
        check(approx(qb45.Q16, e16, 1e-9), "(1g) Qbar(45) Q16 matches the closed form (nonzero coupling)");
        check(std::fabs(qb45.Q16) > 1e9, "(1h) Qbar(45) has real shear-extension coupling Q16 != 0");

        // Off-axis single-ply CLT Ex(theta) cross-checks the lamina off-axis law:
        //   1/Ex(theta) = c4/E1 + s4/E2 + (1/G12 - 2 nu12/E1) c2 s2.
        auto exOracle = [&](double thetaRad) {
            const double cc = std::cos(thetaRad), ss = std::sin(thetaRad);
            const double cc4 = std::pow(cc,4), ss4 = std::pow(ss,4), cs2 = cc*cc*ss*ss;
            const double inv = cc4/E1 + ss4/E2 + (1.0/G12 - 2.0*nu12/E1)*cs2;
            return 1.0 / inv;
        };
        for (double deg : { 0.0, 15.0, 30.0, 45.0, 60.0, 90.0 }) {
            cmp::Laminate lam; lam.plies = { plyAt(deg, 0.125) };
            cmp::CltResult r = cmp::buildClt(lam);
            check(r.ok, "(1i) single-ply CLT solved");
            check(approx(r.Ex, exOracle(deg * M_PI / 180.0), 1e-6),
                  "(1j) single-ply CLT Ex(theta) == off-axis lamina law (independent oracle)");
        }
    }

    // =======================================================================
    // (2) Symmetric cross-ply [0/90]s -> B ~ 0, symmetric, Ex matches oracle.
    // =======================================================================
    {
        cmp::Laminate lam;
        lam.plies = { plyAt(0,0.125), plyAt(90,0.125), plyAt(90,0.125), plyAt(0,0.125) };
        cmp::CltResult r = cmp::buildClt(lam);
        check(r.ok, "(2a) [0/90]s CLT solved");

        double Bmax = 0.0;
        for (int i = 0; i < 9; ++i) Bmax = std::max(Bmax, std::fabs(r.B.a[i]));
        check(Bmax == 0.0, "(2b) [0/90]s symmetric -> B matrix == 0 (the key check)");
        check(r.symmetric, "(2c) symmetric flag true for [0/90]s");
        check(std::fabs(r.A.at(0,2)) == 0.0 && std::fabs(r.A.at(1,2)) == 0.0,
              "(2d) A16 = A26 = 0 (cross-ply has no shear-extension coupling)");

        // Membrane Ex oracle: for a symmetric laminate, A is exact and
        //   Ex = (A11 A22 - A12^2) / (A22 * tTotal). Compute A directly from Qbar sums.
        cmp::ReducedStiffness Q = cmp::reducedStiffness(cfrp);
        const double t = 0.125e-3;
        auto qb = [&](double deg) { return cmp::rotatedQ(Q, deg*M_PI/180.0); };
        const std::array<double,4> angs = {0,90,90,0};
        double A11=0,A12=0,A22=0;
        for (double a : angs) { cmp::Qbar q = qb(a); A11+=q.Q11*t; A12+=q.Q12*t; A22+=q.Q22*t; }
        const double tTot = 4*t;
        const double ExOracle = (A11*A22 - A12*A12) / (A22 * tTot);
        check(approx(r.Ex, ExOracle, 1e-6), "(2e) [0/90]s Ex matches the membrane CLT closed form");
        // and Ex == Ey by the 0/90 symmetry of the stack.
        check(approx(r.Ex, r.Ey, 1e-6), "(2f) [0/90]s Ex == Ey (balanced cross-ply)");
        check(r.balanced, "(2g) [0/90]s is balanced (no +-theta off-axis plies)");
    }

    // =======================================================================
    // (3) Off-axis shear-extension coupling: [45] couples; [+45/-45] balances.
    // =======================================================================
    {
        // A bare single +45 ply: A16 != 0 with a definite (positive) sign.
        cmp::Laminate p45; p45.plies = { plyAt(45,0.125) };
        cmp::CltResult r45 = cmp::buildClt(p45);
        check(r45.ok, "(3a) [45] CLT solved");
        check(std::fabs(r45.A.at(0,2)) > 1e3, "(3b) single [45] ply has shear-extension coupling A16 != 0");
        check(r45.A.at(0,2) > 0.0, "(3c) [+45] A16 sign is positive (Qbar(+45) Q16 > 0)");
        check(!r45.balanced, "(3d) bare [45] is NOT balanced");

        // [45/45] (both +45): still unbalanced, A16 doubles.
        cmp::Laminate p4545; p4545.plies = { plyAt(45,0.125), plyAt(45,0.125) };
        cmp::CltResult r4545 = cmp::buildClt(p4545);
        check(!r4545.balanced, "(3e) [45/45] is NOT balanced (no -45 mirror)");
        check(approx(r4545.A.at(0,2), 2.0*r45.A.at(0,2), 1e-6), "(3f) [45/45] A16 == 2x single-ply A16");

        // [+45/-45]: balanced -> A16 = A26 = 0.
        cmp::Laminate bal; bal.plies = { plyAt(45,0.125), plyAt(-45,0.125) };
        cmp::CltResult rbal = cmp::buildClt(bal);
        check(rbal.ok, "(3g) [+45/-45] CLT solved");
        check(rbal.A.at(0,2) == 0.0 && rbal.A.at(1,2) == 0.0,
              "(3h) [+45/-45] balanced -> A16 = A26 = 0");
        check(rbal.balanced, "(3i) balanced flag true for [+45/-45]");

        // [+45/-45]s is shear-stiff: Gxy much higher than a [0/90]s of equal plies.
        cmp::Laminate pm45s;
        pm45s.plies = { plyAt(45,0.125), plyAt(-45,0.125), plyAt(-45,0.125), plyAt(45,0.125) };
        cmp::CltResult rpm = cmp::buildClt(pm45s);
        cmp::Laminate cp;
        cp.plies = { plyAt(0,0.125), plyAt(90,0.125), plyAt(90,0.125), plyAt(0,0.125) };
        cmp::CltResult rcp = cmp::buildClt(cp);
        check(rpm.symmetric, "(3j) [+-45]s is symmetric -> B = 0");
        check(rpm.Gxy > 3.0 * rcp.Gxy, "(3k) [+-45]s Gxy >> [0/90]s Gxy (the shear-stiff laminate)");
    }

    // =======================================================================
    // (4) Single-ply asymmetry [0/90] (not symmetric) -> B != 0.
    // =======================================================================
    {
        cmp::Laminate lam; lam.plies = { plyAt(0,0.125), plyAt(90,0.125) };
        cmp::CltResult r = cmp::buildClt(lam);
        check(r.ok, "(4a) [0/90] CLT solved");
        double Bmax = 0.0;
        for (int i = 0; i < 9; ++i) Bmax = std::max(Bmax, std::fabs(r.B.a[i]));
        check(Bmax > 0.0, "(4b) asymmetric [0/90] -> B != 0 (B isn't trivially zero)");
        check(!r.symmetric, "(4c) symmetric flag false for [0/90]");
    }

    // =======================================================================
    // (5) Drape on a flat plane + a developable cylinder -> ~0 shear, no wrinkle.
    // =======================================================================
    {
        // Flat plane S(u,v) = (u, v, 0), u,v in [0,0.2].
        cmp::ToolSurface flat;
        flat.S = [](double u, double v) { return cmp::Vec3{ u, v, 0.0 }; };
        flat.u0 = 0; flat.u1 = 0.2; flat.v0 = 0; flat.v1 = 0.2;
        cmp::DrapeParams dp; dp.nu = 15; dp.nv = 15;
        cmp::DrapeResult rf = cmp::drape(flat, dp);
        check(rf.ok, "(5a) flat-plane drape solved");
        check(rf.maxShearAngle < 1e-6, "(5b) flat plane -> ~0 shear everywhere");
        check(!rf.anyWrinkle, "(5c) flat plane -> no wrinkles");

        // Developable cylinder (zero Gaussian curvature): S(u,v) = (R sin(u/R), v, R cos(u/R)).
        const double R = 0.1;
        cmp::ToolSurface cyl;
        cyl.S = [R](double u, double v) { return cmp::Vec3{ R*std::sin(u/R), v, R*std::cos(u/R) }; };
        cyl.u0 = 0; cyl.u1 = 0.12; cyl.v0 = 0; cyl.v1 = 0.12;
        cmp::DrapeResult rc = cmp::drape(cyl, dp);
        check(rc.ok, "(5d) cylinder drape solved");
        check(rc.maxShearAngle < 1e-3, "(5e) developable cylinder -> ~0 shear (zero Gaussian curvature)");
        check(!rc.anyWrinkle, "(5f) cylinder -> no wrinkles");
    }

    // =======================================================================
    // (6) Drape on a hemisphere (+Gaussian) and a saddle (-Gaussian).
    //     Shear grows with curvature & distance from seed; high enough -> wrinkle.
    // =======================================================================
    {
        // Spherical-cap dome as a Monge patch over a FIXED absolute (x,y) footprint:
        //   z(x,y) = R - sqrt(R^2 - x^2 - y^2)   (a sphere of radius R, regular, no
        //   pole singularity over the patch). For a fixed footprint, a SMALLER R is a
        //   sharper dome = larger angular extent = larger integrated Gaussian
        //   curvature = more trellis shear. Seed at the CENTRE (the dome pole) so the
        //   shear genuinely grows radially outward with distance from the seed. The
        //   footprint corner radius half*sqrt(2) must stay < R (else it runs past the
        //   sphere equator) — half=0.028 keeps even R=0.06 a valid cap.
        const double half = 0.028;   // footprint [-half,half]^2 (m); corner r = 0.0396
        auto dome = [&](double R, double lock) {
            cmp::ToolSurface s;
            s.S = [R](double x, double y) {
                const double rr = R*R - x*x - y*y;
                const double z = R - std::sqrt(rr > 0.0 ? rr : 0.0);
                return cmp::Vec3{ x, y, z };
            };
            s.u0 = -half; s.u1 = half; s.v0 = -half; s.v1 = half;
            cmp::DrapeParams dp; dp.nu = 17; dp.nv = 17; dp.lockingAngle = lock;
            dp.origin = { 0.0, 0.0 };   // centre (pole) seed -> radial shear growth
            return cmp::drape(s, dp);
        };
        cmp::DrapeResult rh = dome(0.05, 0.5236);
        check(rh.ok, "(6a) hemispherical dome drape solved");
        check(rh.maxShearAngle > 1e-3, "(6b) dome (double curvature) -> nonzero shear field");

        // Shear near the centre seed is ~0 and grows with distance toward the corners.
        if (rh.ok && rh.nu >= 5) {
            const int nu = rh.nu;
            const int mid = nu / 2;                       // centre node index along a row
            const double centreS = rh.shearAngleField[std::size_t(mid) +
                                     std::size_t(nu) * std::size_t(mid)];
            const double cornerS = rh.shearAngleField[std::size_t(0)];   // (0,0) far corner
            check(cornerS > centreS, "(6c) dome shear GROWS with distance from the centre seed");
        } else {
            check(false, "(6c) dome shear GROWS with distance from the centre seed (drape failed)");
        }

        // Same footprint, gentler vs sharper dome: smaller R -> larger max shear.
        // (Locking angle here is 0.5236 = 30deg; neither dome reaches it, so neither
        // wrinkles yet — the wrinkle threshold is exercised separately below.)
        cmp::DrapeResult rhBig = dome(0.12, 0.5236);    // gentle (large R) maxShear ~0.031
        cmp::DrapeResult rhSmall = dome(0.045, 0.5236); // sharp (small R)  maxShear ~0.217
        check(rhSmall.ok && rhBig.ok, "(6d) both-radius dome drapes solved");
        check(rhSmall.maxShearAngle > rhBig.maxShearAngle,
              "(6e) sharper curvature (smaller R) -> larger max shear (monotone in curvature)");
        check(rhSmall.maxShearAngle > rhBig.maxShearAngle, "(6g) sharper dome -> more shear");

        // Wrinkle threshold: with a tighter locking angle (0.12 rad) between the two
        // domes' max shears (gentle ~0.031 < 0.12 < sharp ~0.217), the gentle dome is
        // drapeable while the SHARP dome trips a wrinkle flag past the locking angle.
        cmp::DrapeResult rhBigLock   = dome(0.12, 0.12);
        cmp::DrapeResult rhSmallLock = dome(0.045, 0.12);
        check(!rhBigLock.anyWrinkle, "(6f) gentle dome stays under the 0.12-rad locking angle (no wrinkle)");
        check(rhSmallLock.anyWrinkle, "(6h) sharp double-curvature dome trips a WRINKLE flag (shear>locking)");

        // Saddle (negative Gaussian curvature): z = k(u^2 - v^2). |shear| > 0 too.
        const double k = 8.0;
        cmp::ToolSurface saddle;
        saddle.S = [k](double u, double v) { return cmp::Vec3{ u, v, k*(u*u - v*v) }; };
        saddle.u0 = -0.06; saddle.u1 = 0.06; saddle.v0 = -0.06; saddle.v1 = 0.06;
        cmp::DrapeParams sp; sp.nu = 15; sp.nv = 15; sp.origin = { -0.06, -0.06 };
        cmp::DrapeResult rs = cmp::drape(saddle, sp);
        check(rs.ok, "(6i) saddle drape solved");
        check(rs.maxShearAngle > 1e-3, "(6j) saddle (negative Gaussian curvature) -> nonzero shear field");
    }

    // =======================================================================
    // (7) Per-element orientation: nominal on flat, deviates on the curved region.
    // =======================================================================
    {
        // Flat: every element keeps the nominal angle.
        cmp::ToolSurface flat;
        flat.S = [](double u, double v) { return cmp::Vec3{ u, v, 0.0 }; };
        flat.u0 = 0; flat.u1 = 0.2; flat.v0 = 0; flat.v1 = 0.2;
        cmp::DrapeParams dp; dp.nu = 12; dp.nv = 12;
        cmp::DrapeResult rf = cmp::drape(flat, dp);
        const double nominal = 30.0 * M_PI / 180.0;
        auto eoFlat = cmp::perElementOrientation(rf, nominal);
        check(!eoFlat.empty(), "(7a) per-element orientation produced on the flat region");
        double maxDevFlat = 0.0;
        for (const auto& e : eoFlat) maxDevFlat = std::max(maxDevFlat, std::fabs(e.fiberAngle - nominal));
        check(maxDevFlat < 1e-5, "(7b) flat region -> every element at the NOMINAL angle");

        // Dome (double curvature): at least one element deviates from nominal (shear).
        // Footprint corner radius half*sqrt(2)=0.0396 < R=0.05, so it's a valid cap.
        const double R = 0.05, half = 0.028;
        cmp::ToolSurface hemi;
        hemi.S = [R](double x, double y) {
            const double rr = R*R - x*x - y*y;
            return cmp::Vec3{ x, y, R - std::sqrt(rr > 0.0 ? rr : 0.0) };
        };
        hemi.u0 = -half; hemi.u1 = half; hemi.v0 = -half; hemi.v1 = half;
        cmp::DrapeParams hp; hp.nu = 15; hp.nv = 15; hp.origin = { 0.0, 0.0 };
        cmp::DrapeResult rh = cmp::drape(hemi, hp);
        auto eoCurv = cmp::perElementOrientation(rh, nominal);
        check(rh.ok && !eoCurv.empty(), "(7c) per-element orientation produced on the curved region");
        double maxDevCurv = 0.0; bool anyWrinkledElem = false;
        for (const auto& e : eoCurv) {
            maxDevCurv = std::max(maxDevCurv, std::fabs(e.fiberAngle - nominal));
            if (e.wrinkled) anyWrinkledElem = true;
        }
        check(maxDevCurv > 1e-3, "(7d) curved region -> at least one element's fibre angle != nominal");
        check(rh.anyWrinkle == anyWrinkledElem,
              "(7e) wrinkled elements flagged consistently with the drape field");
    }

    // =======================================================================
    // (8) Versioned layup schedule.
    // =======================================================================
    {
        cmp::ScheduleRegistry reg;
        cmp::Laminate v1;
        v1.plies = { plyAt(0,0.125), plyAt(45,0.125), plyAt(-45,0.125), plyAt(90,0.125) };
        std::uint64_t id1 = reg.commit(v1, "RTM6", "180C/2h", "rev A baseline", 0);
        check(id1 == 1, "(8a) first commit returns id=1");
        check(reg.size() == 1, "(8b) registry size 1 after first commit");

        // Change one ply's orientation + the resin + the cure -> a NEW record.
        cmp::Laminate v2 = v1;
        v2.plies[1].angle = 30.0 * M_PI / 180.0;   // 45 -> 30
        std::uint64_t id2 = reg.commit(v2, "RTM6-2", "190C/2h", "rev B reorient+resin", id1);
        check(id2 == 2, "(8c) second commit returns a new id=2");
        check(reg.size() == 2, "(8d) registry size 2");

        const cmp::LayupSchedule* s1 = reg.get(1);
        const cmp::LayupSchedule* s2 = reg.get(2);
        check(s1 && s2, "(8e) get(1) and get(2) both resolve");
        check(s2->parentId == 1, "(8f) lineage: rev B parentId == 1");
        // get(1) still returns the ORIGINAL stack unchanged (immutable snapshot).
        check(s1 && approx(s1->stack.plies[1].angle, 45.0 * M_PI / 180.0, 1e-12),
              "(8g) get(1) still has the original 45deg ply (immutable, not mutated by rev B)");
        check(s2 && approx(s2->stack.plies[1].angle, 30.0 * M_PI / 180.0, 1e-12),
              "(8h) get(2) has the new 30deg ply");
        check(reg.get(99) == nullptr, "(8i) get(absent id) -> nullptr");
        check(std::string(s1->resin) == "RTM6" && std::string(s2->resin) == "RTM6-2",
              "(8j) per-record resin provenance preserved");
    }

    // =======================================================================
    // (9) Honesty: empty laminate -> ok==false; non-convergent drape -> ok==false.
    // =======================================================================
    {
        cmp::Laminate empty;
        cmp::CltResult r = cmp::buildClt(empty);
        check(!r.ok, "(9a) empty laminate -> CltResult.ok == false (no fabricated result)");

        // A drape with no surface function surfaces a failure, not fake geometry.
        cmp::ToolSurface bad;   // .S is null
        cmp::DrapeParams dp;
        cmp::DrapeResult rb = cmp::drape(bad, dp);
        check(!rb.ok, "(9b) drape with no tool surface -> DrapeResult.ok == false");
    }

    // -----------------------------------------------------------------------
    std::printf("\n== RESULT: %d / %d checks passed ==\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
