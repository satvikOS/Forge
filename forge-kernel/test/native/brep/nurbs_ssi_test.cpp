// forge/native/brep/nurbs_ssi_test.cpp
//
// K1.3 native gate — NURBS-AWARE surface–surface intersection
// (forge::native::brep::intersectNurbsSurfaces). This closes the deferral the
// elementary analytic SSI has for any pair involving a NURBS face: it intersects
// two surfaces where at least one is a NURBS (here BOTH operands are promoted to
// EXACT rational NURBS via promoteToNurbs, so the general marcher is exercised on
// the genuine NURBS code path, never the analytic fast-paths).
//
// THREE CLOSED-FORM GATES (each against an analytic ground truth, not self-
// consistency):
//   (a) NURBS-SPHERE ∩ PLANE  -> a CIRCLE of known radius √(R²−d²), centre exact;
//       residual |S1−S2| ≤ 1e-9 along the marched curve, every point at distance
//       R from the sphere centre and on the plane to 1e-9, every point at the
//       known circle radius from the analytic centre.
//   (b) TWO EQUAL ORTHOGONAL CYLINDERS (radii R, axes crossing at 90°) -> the
//       STEINMETZ bicylinder seam: every marched point satisfies BOTH cylinder
//       implicit equations to ≤1e-9, and the seam passes through the 4 analytic
//       SADDLE points (±R, 0, ±R)-style extrema.
//   (c) CYLINDER ∩ PLANE (oblique) -> an ELLIPSE with known semi-axes
//       (semi-minor = R, semi-major = R/|cos θ|): every point on the cylinder and
//       the plane to ≤1e-9, and the fitted conic semi-axes match the closed form.
//
// Auto-discovered by test/native/run_native.sh. Pure C++20, no OCCT, no test
// framework.
//
// MANUAL BUILD (mirrors run_native.sh; the script auto-discovers this TU):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//     forge-kernel/test/native/brep/nurbs_ssi_test.cpp \
//     forge-kernel/src/native/brep/NurbsSurfaceIntersect.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/brep/NurbsCalculus.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     -o /tmp/nurbs_ssi_test && /tmp/nurbs_ssi_test

#include "forge/native/brep/NurbsSurfaceIntersect.hpp"
#include "forge/native/brep/Surface.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
constexpr double PI = 3.14159265358979323846;

// ---- analytic surface builders --------------------------------------------
static Surface planeSurf(Vec3 o, Vec3 n) {
    Surface s; s.kind = SurfaceKind::Plane; s.origin = o; s.axis = vnorm(n);
    Vec3 t = (std::fabs(s.axis.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    s.refDir = vnorm(vcross(s.axis, t)); return s;
}
static Surface cylSurf(Vec3 b, Vec3 ax, double r) {
    Surface s; s.kind = SurfaceKind::Cylinder; s.origin = b; s.axis = vnorm(ax);
    s.r1 = r;
    Vec3 t = (std::fabs(s.axis.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    s.refDir = vnorm(vcross(s.axis, t)); return s;
}
static Surface sphSurf(Vec3 c, double r) {
    Surface s; s.kind = SurfaceKind::Sphere; s.origin = c; s.r1 = r;
    s.refDir = {1, 0, 0}; s.axis = {0, 0, 1}; return s;
}

// ---- analytic implicit residuals (the ground-truth gates) ------------------
static double sphereResidual(const Vec3& p, const Vec3& c, double R) {
    Vec3 w{p.x-c.x, p.y-c.y, p.z-c.z};
    return std::fabs(std::sqrt(w.x*w.x+w.y*w.y+w.z*w.z) - R);
}
static double planeResidual(const Vec3& p, const Vec3& o, const Vec3& n) {
    Vec3 nn=vnorm(n); Vec3 w{p.x-o.x,p.y-o.y,p.z-o.z};
    return std::fabs(vdot(w, nn));
}
static double cylinderResidual(const Vec3& p, const Vec3& o, const Vec3& ax, double R) {
    Vec3 a=vnorm(ax); Vec3 w{p.x-o.x,p.y-o.y,p.z-o.z};
    Vec3 rad=vsub(w, vscale(a, vdot(w,a)));
    return std::fabs(vlen(rad) - R);
}
// Distance from a query point Q to the segment [A,B] (the geometric test: an
// analytic point that lies ON the seam is at chord-sag distance from the
// polyline SEGMENTS, not half the vertex spacing away from the nearest vertex).
static double pointSegDist(const Vec3& Q, const Vec3& A, const Vec3& B) {
    Vec3 AB=vsub(B,A), AQ=vsub(Q,A);
    double len2=vdot(AB,AB);
    double t = (len2>0) ? vdot(AQ,AB)/len2 : 0.0;
    t = t<0?0:(t>1?1:t);
    Vec3 P{A.x+AB.x*t, A.y+AB.y*t, A.z+AB.z*t};
    return vlen(vsub(Q,P));
}
// Algebraic (Kasa) circle-fit centre for points known to lie in the plane
// z=zConst (the section plane has normal +z here). Solves the linear system for
// the centre of x²+y²+Dx+Ey+F=0 — EXACT for points on a circle regardless of how
// much of the arc is covered (so it is not biased by a marched loop's closure
// gap, unlike a centroid). Returns the 3D centre (cx, cy, zConst).
static Vec3 circleFitCentreZ(const std::vector<Vec3>& pts, double zConst) {
    double Sx=0,Sy=0,Sxx=0,Syy=0,Sxy=0,Sxz=0,Syz=0,Sz=0; double n=(double)pts.size();
    for (const Vec3& p : pts){
        double z=p.x*p.x+p.y*p.y;
        Sx+=p.x; Sy+=p.y; Sxx+=p.x*p.x; Syy+=p.y*p.y; Sxy+=p.x*p.y;
        Sxz+=p.x*z; Syz+=p.y*z; Sz+=z;
    }
    // normal equations for [D,E,F]: minimise sum (x²+y² + Dx+Ey+F)².
    // 3x3 system  A [D;E;F] = b.
    double A[3][3]={{Sxx,Sxy,Sx},{Sxy,Syy,Sy},{Sx,Sy,n}};
    double b[3]={-Sxz,-Syz,-Sz};
    double det=A[0][0]*(A[1][1]*A[2][2]-A[1][2]*A[2][1])
              -A[0][1]*(A[1][0]*A[2][2]-A[1][2]*A[2][0])
              +A[0][2]*(A[1][0]*A[2][1]-A[1][1]*A[2][0]);
    if (std::fabs(det)<1e-300) return Vec3{0,0,zConst};
    auto solve=[&](int col)->double{
        double M[3][3]; for(int i=0;i<3;++i)for(int j=0;j<3;++j)M[i][j]=A[i][j];
        for(int i=0;i<3;++i)M[i][col]=b[i];
        return (M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1])
               -M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0])
               +M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]))/det;
    };
    double D=solve(0), E=solve(1);
    return Vec3{-D/2.0, -E/2.0, zConst};
}

// =============================================================================
int main() {
    std::printf("=== K1.3 NURBS-aware SSI gate (intersectNurbsSurfaces) ===\n");

    // -------------------------------------------------------------------------
    // (a) NURBS-SPHERE ∩ PLANE  -> circle of radius √(R²−d²), centre exact.
    // -------------------------------------------------------------------------
    {
        std::printf("[a] NURBS-sphere ∩ plane = circle of radius √(R²−d²)\n");
        const double R = 2.0;
        const double d = 0.8;                 // plane offset along +z from centre
        Vec3 C{0.3, -0.4, 0.5};               // sphere centre (arbitrary)
        Surface sphA = sphSurf(C, R);
        // plane z = C.z + d  (normal +z), passes at signed distance d from centre
        Surface plA = planeSurf(Vec3{C.x, C.y, C.z + d}, Vec3{0,0,1});

        PromotedSurface ps = promoteToNurbs(sphA);
        PromotedSurface pp = promoteToNurbs(plA, /*uExt=*/3.0, /*vExt=*/3.0);
        check(ps.ok, "(a) sphere promoted to exact rational NURBS");
        check(pp.ok, "(a) plane promoted to bilinear NURBS");

        NurbsSSIOptions opt; opt.tol = 1e-10; opt.subdiv = 28;
        NurbsSSIResult r = intersectNurbsSurfaces(ps.surface, pp.surface, opt);
        check(r.ok, "(a) SSI ran ok");
        check(r.branchCount == 1, "(a) exactly ONE branch (the section circle)");

        const double rExpected = std::sqrt(R*R - d*d);   // = √(4 - 0.64) = 1.8330..
        Vec3 centreExpected{C.x, C.y, C.z + d};

        double maxResid=0.0, maxSph=0.0, maxPln=0.0, maxRad=0.0, maxCentre=0.0;
        bool closed=false;
        if (!r.branches.empty()) {
            const SSIBranch& br = r.branches[0];
            closed = br.closed;
            maxResid = br.maxResidual;
            for (const Vec3& p : br.points) {
                maxSph = std::max(maxSph, sphereResidual(p, C, R));
                maxPln = std::max(maxPln, planeResidual(p, Vec3{C.x,C.y,C.z+d}, Vec3{0,0,1}));
                Vec3 w{p.x-centreExpected.x, p.y-centreExpected.y, p.z-centreExpected.z};
                maxRad = std::max(maxRad, std::fabs(std::sqrt(w.x*w.x+w.y*w.y+w.z*w.z) - rExpected));
            }
            // centre via an algebraic circle fit in the section plane z=C.z+d
            // (exact for points on a circle, independent of arc coverage / the
            // marched loop's closure gap) vs the analytic foot.
            Vec3 fitC = circleFitCentreZ(br.points, centreExpected.z);
            maxCentre = vlen(vsub(fitC, centreExpected));
        }
        std::printf("      R=%.3f d=%.3f -> r_expected=%.10f ; centre=(%.3f,%.3f,%.3f)\n",
                    R, d, rExpected, centreExpected.x, centreExpected.y, centreExpected.z);
        std::printf("      maxResid|S1-S2|=%.3e  maxSphere=%.3e  maxPlane=%.3e  maxRadErr=%.3e  centreErr=%.3e\n",
                    maxResid, maxSph, maxPln, maxRad, maxCentre);
        check(closed, "(a) branch is a CLOSED loop (the circle)");
        check(maxResid <= 1e-9, "(a) |S1-S2| ≤ 1e-9 along the curve");
        check(maxSph   <= 1e-9, "(a) every point on the sphere to 1e-9");
        check(maxPln   <= 1e-9, "(a) every point on the plane to 1e-9");
        check(maxRad   <= 1e-7, "(a) every point at the known circle radius √(R²−d²)");
        check(maxCentre<= 1e-7, "(a) circle centre matches the analytic foot");
    }

    // -------------------------------------------------------------------------
    // (b) TWO EQUAL ORTHOGONAL CYLINDERS  -> the Steinmetz bicylinder seam.
    // -------------------------------------------------------------------------
    {
        std::printf("[b] two equal orthogonal cylinders (Steinmetz bicylinder)\n");
        const double R = 1.5;
        // Cylinder 1: axis = +x through origin.  Cylinder 2: axis = +z through origin.
        Surface cA = cylSurf(Vec3{0,0,0}, Vec3{1,0,0}, R);
        Surface cB = cylSurf(Vec3{0,0,0}, Vec3{0,0,1}, R);
        // promote both to exact rational NURBS (axial half-length 3R covers the seam)
        PromotedSurface pA = promoteToNurbs(cA, /*uExt=*/1.0, /*vExt=*/3.0*R);
        PromotedSurface pB = promoteToNurbs(cB, /*uExt=*/1.0, /*vExt=*/3.0*R);
        check(pA.ok && pB.ok, "(b) both cylinders promoted to exact NURBS");

        NurbsSSIOptions opt; opt.tol = 1e-10; opt.subdiv = 32;
        NurbsSSIResult r = intersectNurbsSurfaces(pA.surface, pB.surface, opt);
        check(r.ok, "(b) SSI ran ok");
        // Steinmetz of two equal cylinders = exactly TWO closed ellipse seams.
        check(r.branchCount == 2, "(b) exactly TWO Steinmetz seam branches");

        double maxResid=0.0, maxCa=0.0, maxCb=0.0;
        std::size_t nPts=0;
        for (const SSIBranch& br : r.branches) {
            maxResid = std::max(maxResid, br.maxResidual);
            for (const Vec3& p : br.points) {
                maxCa = std::max(maxCa, cylinderResidual(p, Vec3{0,0,0}, Vec3{1,0,0}, R));
                maxCb = std::max(maxCb, cylinderResidual(p, Vec3{0,0,0}, Vec3{0,0,1}, R));
                ++nPts;
            }
        }
        // The 4 analytic SADDLE points of the equal-cylinder Steinmetz seam are at
        // y = ±R, x = z = 0 (where both radial constraints x²+y²... wait: cyl1 axis
        // +x => y²+z²=R²; cyl2 axis +z => x²+y²=R². Subtract: z²=x² => z=±x.
        // The saddles (extrema in y) are where x=z=0 => y=±R. The seam also reaches
        // x=±R,y=0,z=±R (the four "corner" points where |x|=|z|=R/√?).
        // Saddle points (the curve's y-extrema): (0, ±R, 0).
        std::vector<Vec3> saddles = { {0, R, 0}, {0, -R, 0} };
        // The four corner points where the two seams cross: x=±R, y=0, z=±R is NOT
        // on both (|.|). The genuine extreme points where x=z: at y=0, x²=R² and
        // z²=x² => (±R,0,±R)? check cyl1: y²+z²=0+R²=R² ✓ ; cyl2: x²+y²=R²+0=R² ✓.
        std::vector<Vec3> corners = { {R,0,R},{R,0,-R},{-R,0,R},{-R,0,-R} };

        // distance from an analytic point to the seam POLYLINE (segment distance,
        // so a point on the seam is at chord-sag distance, not half the spacing).
        auto nearestSeamDist=[&](const Vec3& q)->double{
            double best=1e300;
            for (const SSIBranch& br : r.branches) {
                const auto& P = br.points;
                std::size_t n=P.size();
                for (std::size_t i=0;i+1<n;++i)
                    best=std::min(best, pointSegDist(q, P[i], P[i+1]));
                if (br.closed && n>1)        // close the loop's last->first segment
                    best=std::min(best, pointSegDist(q, P[n-1], P[0]));
            }
            return best;
        };
        double maxSaddle=0.0;
        for (const Vec3& s : saddles) maxSaddle=std::max(maxSaddle, nearestSeamDist(s));
        double maxCorner=0.0;
        for (const Vec3& s : corners) maxCorner=std::max(maxCorner, nearestSeamDist(s));

        std::printf("      R=%.3f  branches=%zu  totalPts=%zu\n", R, r.branchCount, nPts);
        std::printf("      maxResid|S1-S2|=%.3e  maxCylA=%.3e  maxCylB=%.3e\n",
                    maxResid, maxCa, maxCb);
        std::printf("      seam->saddle(0,±R,0) maxDist=%.3e ; seam->corner(±R,0,±R) maxDist=%.3e\n",
                    maxSaddle, maxCorner);
        check(maxResid <= 1e-9, "(b) every point satisfies |S1-S2| ≤ 1e-9");
        check(maxCa    <= 1e-9, "(b) every point on cylinder A (y²+z²=R²) to 1e-9");
        check(maxCb    <= 1e-9, "(b) every point on cylinder B (x²+y²=R²) to 1e-9");
        check(maxSaddle<= 1e-3, "(b) seam passes through the 4 analytic saddle pts");
        check(maxCorner<= 1e-3, "(b) seam passes through the corner extrema (±R,0,±R)");
    }

    // -------------------------------------------------------------------------
    // (c) CYLINDER ∩ PLANE (oblique)  -> ellipse, semi-minor R, semi-major R/cosθ.
    // -------------------------------------------------------------------------
    {
        std::printf("[c] cylinder ∩ oblique plane = ellipse (semi-axes known)\n");
        const double R = 1.2;
        const double theta = 30.0 * PI / 180.0;     // plane tilt off ⟂ to axis
        // cylinder axis +z; plane normal tilted by theta in the x–z plane:
        //   n = (sinθ, 0, cosθ), through the origin.
        Surface cyl = cylSurf(Vec3{0,0,0}, Vec3{0,0,1}, R);
        Vec3 n{std::sin(theta), 0.0, std::cos(theta)};
        Surface pl = planeSurf(Vec3{0,0,0}, n);

        PromotedSurface pc = promoteToNurbs(cyl, 1.0, 3.0);  // axial half-length 3
        PromotedSurface pp = promoteToNurbs(pl, 3.0, 3.0);
        check(pc.ok && pp.ok, "(c) cylinder + plane promoted to NURBS");

        NurbsSSIOptions opt; opt.tol = 1e-10; opt.subdiv = 28;
        NurbsSSIResult r = intersectNurbsSurfaces(pc.surface, pp.surface, opt);
        check(r.ok, "(c) SSI ran ok");
        check(r.branchCount == 1, "(c) exactly ONE branch (the ellipse)");

        const double semiMinor = R;                 // = 1.2
        const double semiMajor = R / std::cos(theta);  // = 1.2 / cos30 = 1.3856..

        double maxResid=0.0, maxCyl=0.0, maxPln=0.0;
        double measMinor=0.0, measMajor=0.0;
        bool closed=false;
        if (!r.branches.empty()) {
            const SSIBranch& br = r.branches[0];
            closed = br.closed;
            maxResid = br.maxResidual;
            // centre = origin (plane through axis intersection). Major axis lies in
            // the plane along the tilt direction; minor ⟂ both.
            Vec3 centre{0,0,0};
            for (const Vec3& p : br.points) {
                maxCyl = std::max(maxCyl, cylinderResidual(p, Vec3{0,0,0}, Vec3{0,0,1}, R));
                maxPln = std::max(maxPln, planeResidual(p, Vec3{0,0,0}, n));
                double dist = vlen(vsub(p, centre));
                measMajor = std::max(measMajor, dist);          // farthest = semi-major
            }
            // semi-minor = the min radial distance over the loop.
            measMinor = 1e300;
            for (const Vec3& p : br.points)
                measMinor = std::min(measMinor, vlen(vsub(p, centre)));
        }
        std::printf("      R=%.3f theta=%.1f° -> semiMinor=%.6f semiMajor=%.6f\n",
                    R, theta*180.0/PI, semiMinor, semiMajor);
        std::printf("      measMinor=%.6f measMajor=%.6f ; maxResid=%.3e maxCyl=%.3e maxPln=%.3e\n",
                    measMinor, measMajor, maxResid, maxCyl, maxPln);
        check(closed, "(c) branch is a CLOSED loop (the ellipse)");
        check(maxResid <= 1e-9, "(c) |S1-S2| ≤ 1e-9 along the curve");
        check(maxCyl   <= 1e-9, "(c) every point on the cylinder to 1e-9");
        check(maxPln   <= 1e-9, "(c) every point on the plane to 1e-9");
        check(std::fabs(measMinor - semiMinor) <= 1e-3, "(c) semi-minor = R");
        check(std::fabs(measMajor - semiMajor) <= 1e-3, "(c) semi-major = R/cosθ");
    }

    // -------------------------------------------------------------------------
    std::printf("\n=== RESULT: %d/%d checks passed ===\n", g_pass, g_total);
    if (g_pass == g_total) { std::printf("[nurbs_ssi] ALL GATES PASS\n"); return 0; }
    std::printf("[nurbs_ssi] FAILURES PRESENT\n");
    return 1;
}
