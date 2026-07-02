// forge/native/gdt/FcfEvaluator.cpp
//
// Implementation of forge::native::gdt::fcf — the geometric GD&T / FCF evaluator
// that measures on a built native B-rep Solid. See FcfEvaluator.hpp for the full
// scope/honesty header. Pure C++20, standard library + forge::native::brep only;
// no OCCT, no WASM, no third-party deps.
//
// ============================ PMI-BRIDGE PLAN (task #26 wiring) =============
// This kernel module is the GEOMETRIC half. To let Archie EMIT GD&T and have it
// VERIFIED (not just authored as PMI text), three thin layers connect to it. The
// authoring verbs already exist in frontend/src/ai/ForgeToolBridge.js — gdt.datum
// (= gdt.add-datum{feature,label}) and gdt.feature-control-frame (= gdt.add-fcf
// {feature,characteristic,tolerance,datums,modifier}). Today both end with the
// honest note "PMI only — not geometrically verified" because there is NO native
// gdt namespace on the kernel handle path. This module is exactly that namespace.
//
//   (1) NATIVE BINDING (binding.cpp + ForgeKernel.d.ts):
//         forge.gdt.evaluateFcf({
//           shape, faceId|edgeId,            // the toleranced feature on the solid
//           characteristic, tolerance,       // the FCF
//           diametral, modifier,             // Ø + MMC/LMC
//           datums:[{faceId, kind:'plane'|'axis'}],  // datum features on the part
//           trueLoc:[x,y,z],                 // basic location for position
//           actualSize, materialLimit, basicAngleDeg
//         }) -> { measured, toleranceZone, bonus, pass }
//       Implementation: resolve the brep::Solid from `shape`, pick the Face/Edge by
//       id, build the Drf from the datum faces (buildDrfPlanes for 3 planes, or
//       buildDrfAxis for a primary axis datum), then dispatch on `characteristic`
//       to flatness()/position()/perpendicularity-via-orientationAxis()/
//       circularRunout()/… returning the FcfResult fields. This is the ONLY new
//       kernel binding; everything it calls lives in this file.
//
//   (2) ForgeToolBridge.js — add a `verify:true` option (or a sibling verb
//       gdt.verify-fcf) to gdt.feature-control-frame whose run() calls
//       forge.gdt.evaluateFcf(...) with the same characteristic/tolerance/datums it
//       authors, and returns { fcf, measured, toleranceZone, pass } so the authored
//       string and the geometric verdict ship together. The PMI-write path is
//       unchanged; verification is additive.
//
//   (3) part.set-surface-finish{ shape, faceId, Ra, Rz?, lay?, process? } — author a
//       surface-texture symbol (ASME Y14.36 / ISO 1302) as an AP242 PMI note on the
//       given face (mirrors gdt.datum's note accumulation). Roughness is a
//       MANUFACTURING/metrology attribute, NOT a B-rep deviation, so it is authored
//       (and surfaced to the drawing) — there is no geometric Ra to measure off an
//       ideal analytic surface; honest scope, like the FCF-string authoring.
//
// All three are wiring around this file; the geometry truth lives here.

#include "forge/native/gdt/FcfEvaluator.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <vector>

namespace forge {
namespace native {
namespace gdt {
namespace fcf {

// ===========================================================================
// Internal numeric helpers (file-local: anonymous namespace -> no ODR clash
// with the sibling Gdt.cpp statics that share some names).
// ===========================================================================
namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kEps = 1e-12;

inline Vec3 P2V(const brep::Point3& p) { return Vec3{p.x, p.y, p.z}; }

inline double len(const Vec3& a) {
    return std::sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}
// Normalize with an explicit ok flag (true unless the vector is ~zero).
inline Vec3 unit(const Vec3& a, bool& ok) {
    double n = len(a);
    if (n < 1e-300) { ok = false; return Vec3{0, 0, 0}; }
    ok = true;
    return Vec3{a.x / n, a.y / n, a.z / n};
}
inline Vec3 unit(const Vec3& a) { bool ok; return unit(a, ok); }

inline Vec3 add(const Vec3& a, const Vec3& b) { return brep::vadd(a, b); }
inline Vec3 sub(const Vec3& a, const Vec3& b) { return brep::vsub(a, b); }
inline Vec3 mul(const Vec3& a, double s) { return brep::vscale(a, s); }
inline double dot(const Vec3& a, const Vec3& b) { return brep::vdot(a, b); }
inline Vec3 cross(const Vec3& a, const Vec3& b) { return brep::vcross(a, b); }

// Any unit vector perpendicular to `a` (a assumed non-zero).
inline Vec3 anyPerp(const Vec3& a) {
    Vec3 helper = (std::fabs(a.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    return unit(cross(a, helper));
}

inline double clampUnit(double x) { return x > 1.0 ? 1.0 : (x < -1.0 ? -1.0 : x); }

// 3x3 symmetric eigensolver (cyclic Jacobi) — eigenvalues in w[3], eigenvectors
// as the COLUMNS of V[3][3]. Always converges for symmetric input. (Same proven
// routine as Gdt.cpp; kept file-local here.)
void jacobiEigen(const double A[3][3], double w[3], double V[3][3]) {
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) V[i][j] = (i == j) ? 1.0 : 0.0;
    double a[3][3];
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) a[i][j] = A[i][j];
    for (int sweep = 0; sweep < 100; ++sweep) {
        double off = std::fabs(a[0][1]) + std::fabs(a[0][2]) + std::fabs(a[1][2]);
        if (off < 1e-300) break;
        for (int p = 0; p < 2; ++p) {
            for (int q = p + 1; q < 3; ++q) {
                if (std::fabs(a[p][q]) < 1e-300) continue;
                double app = a[p][p], aqq = a[q][q], apq = a[p][q];
                double phi = 0.5 * std::atan2(2.0 * apq, aqq - app);
                double c = std::cos(phi), s = std::sin(phi);
                for (int k = 0; k < 3; ++k) {
                    double akp = a[k][p], akq = a[k][q];
                    a[k][p] = c * akp - s * akq;
                    a[k][q] = s * akp + c * akq;
                }
                for (int k = 0; k < 3; ++k) {
                    double apk = a[p][k], aqk = a[q][k];
                    a[p][k] = c * apk - s * aqk;
                    a[q][k] = s * apk + c * aqk;
                }
                for (int k = 0; k < 3; ++k) {
                    double vkp = V[k][p], vkq = V[k][q];
                    V[k][p] = c * vkp - s * vkq;
                    V[k][q] = s * vkp + c * vkq;
                }
            }
        }
    }
    w[0] = a[0][0];
    w[1] = a[1][1];
    w[2] = a[2][2];
}

// Symmetric covariance of centered points + its eigen-decomposition.
bool covarianceEigen(const std::vector<Vec3>& pts, Vec3& centroid,
                     double w[3], double V[3][3]) {
    if (pts.size() < 2) return false;
    Vec3 c{0, 0, 0};
    for (const auto& p : pts) c = add(c, p);
    c = mul(c, 1.0 / static_cast<double>(pts.size()));
    double cov[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};
    for (const auto& p : pts) {
        Vec3 d = sub(p, c);
        cov[0][0] += d.x * d.x; cov[0][1] += d.x * d.y; cov[0][2] += d.x * d.z;
        cov[1][1] += d.y * d.y; cov[1][2] += d.y * d.z;
        cov[2][2] += d.z * d.z;
    }
    cov[1][0] = cov[0][1]; cov[2][0] = cov[0][2]; cov[2][1] = cov[1][2];
    jacobiEigen(cov, w, V);
    centroid = c;
    return true;
}

inline Vec3 eigvec(const double V[3][3], int k) {
    return Vec3{V[0][k], V[1][k], V[2][k]};
}

double det3(double a, double b, double c,
            double d, double e, double f,
            double g, double h, double i) {
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

// Solve the 3x3 system M x = r by Cramer's rule. Returns false if singular.
bool solve3(const double M[3][3], const double r[3], double x[3]) {
    double D = det3(M[0][0], M[0][1], M[0][2],
                    M[1][0], M[1][1], M[1][2],
                    M[2][0], M[2][1], M[2][2]);
    if (std::fabs(D) < 1e-300) return false;
    double Dx = det3(r[0], M[0][1], M[0][2],
                     r[1], M[1][1], M[1][2],
                     r[2], M[2][1], M[2][2]);
    double Dy = det3(M[0][0], r[0], M[0][2],
                     M[1][0], r[1], M[1][2],
                     M[2][0], r[2], M[2][2]);
    double Dz = det3(M[0][0], M[0][1], r[0],
                     M[1][0], M[1][1], r[1],
                     M[2][0], M[2][1], r[2]);
    x[0] = Dx / D; x[1] = Dy / D; x[2] = Dz / D;
    return true;
}

struct Pt2 { double x, y; };

// Algebraic (Kåsa) least-squares circle fit of 2D points. Solves the normal
// equations for (a,b,c) in  x²+y² = 2a x + 2b y + c, giving centre (a,b),
// radius sqrt(c + a² + b²). Returns false on collinear / degenerate input.
bool lsCircle2D(const std::vector<Pt2>& P, double& cx, double& cy, double& r) {
    const std::size_t n = P.size();
    if (n < 3) return false;
    double Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
    for (const auto& p : P) {
        double z = p.x * p.x + p.y * p.y;
        Sx += p.x; Sy += p.y;
        Sxx += p.x * p.x; Syy += p.y * p.y; Sxy += p.x * p.y;
        Sxz += p.x * z; Syz += p.y * z; Sz += z;
    }
    double N = static_cast<double>(n);
    double M[3][3] = {{Sxx, Sxy, Sx}, {Sxy, Syy, Sy}, {Sx, Sy, N}};
    double rhs[3] = {Sxz, Syz, Sz};
    double sol[3];
    if (!solve3(M, rhs, sol)) return false;
    double a = 0.5 * sol[0];   // sol = (2a, 2b, c)
    double b = 0.5 * sol[1];
    double c = sol[2];
    cx = a; cy = b;
    double rr = c + a * a + b * b;
    r = (rr > 0) ? std::sqrt(rr) : 0.0;
    return true;
}

// Radial band (R_max − R_min) of `pts` about the axis (cen, axisDir), via an
// in-plane LS circle. Also returns the fitted axis location (the LS circle centre
// lifted back to 3D) and the mean radius. Returns false on a degenerate fit.
bool radialBandAboutAxis(const std::vector<Vec3>& pts, const Vec3& cen,
                         const Vec3& axisDir, double& band, Vec3& axisPtOut,
                         double& radiusOut) {
    bool ok;
    Vec3 a = unit(axisDir, ok);
    if (!ok) return false;
    Vec3 e1 = anyPerp(a);
    Vec3 e2 = unit(cross(a, e1), ok);
    if (!ok) return false;
    std::vector<Pt2> P;
    P.reserve(pts.size());
    for (const auto& p : pts) {
        Vec3 d = sub(p, cen);
        P.push_back(Pt2{dot(d, e1), dot(d, e2)});
    }
    double cu, cv, rr;
    if (!lsCircle2D(P, cu, cv, rr)) return false;
    double rmin = std::numeric_limits<double>::infinity();
    double rmax = -std::numeric_limits<double>::infinity();
    for (const auto& p : P) {
        double rad = std::sqrt((p.x - cu) * (p.x - cu) + (p.y - cv) * (p.y - cv));
        rmin = std::min(rmin, rad);
        rmax = std::max(rmax, rad);
    }
    band = rmax - rmin;
    axisPtOut = add(cen, add(mul(e1, cu), mul(e2, cv)));
    radiusOut = rr;
    return true;
}

// Perpendicular (radial) distance of `p` from the infinite line (axisPt, axisDir).
double radialFromAxis(const Vec3& p, const Vec3& axisPt, const Vec3& axisDir) {
    bool ok;
    Vec3 a = unit(axisDir, ok);
    if (!ok) return 0.0;
    Vec3 d = sub(p, axisPt);
    Vec3 perp = sub(d, mul(a, dot(d, a)));
    return len(perp);
}

// Diagonal of the axis-aligned bounding box of a point set (a feature's extent).
double aabbDiagonal(const std::vector<Vec3>& pts) {
    if (pts.empty()) return 0.0;
    Vec3 lo = pts[0], hi = pts[0];
    for (const auto& p : pts) {
        lo.x = std::min(lo.x, p.x); lo.y = std::min(lo.y, p.y); lo.z = std::min(lo.z, p.z);
        hi.x = std::max(hi.x, p.x); hi.y = std::max(hi.y, p.y); hi.z = std::max(hi.z, p.z);
    }
    return len(sub(hi, lo));
}

} // anonymous namespace

// ===========================================================================
// DATUM REFERENCE FRAME
// ===========================================================================
Drf buildDrfPlanes(const Vec3& aPoint, const Vec3& aNormal,
                   const Vec3& bPoint, const Vec3& bNormal,
                   const Vec3& cPoint, const Vec3& cNormal) {
    Drf d;
    bool ok;
    Vec3 nA = unit(aNormal, ok);
    if (!ok) { d.reason = "primary datum A normal degenerate"; return d; }
    // ez = A normal (primary). ex = B normal with A-component removed (⊥ A).
    Vec3 ez = nA;
    Vec3 nB = unit(bNormal, ok);
    if (!ok) { d.reason = "secondary datum B normal degenerate"; return d; }
    Vec3 exRaw = sub(nB, mul(ez, dot(nB, ez)));
    Vec3 ex = unit(exRaw, ok);
    if (!ok) { d.reason = "secondary datum B parallel to A (no ⊥ component)"; return d; }
    Vec3 ey = unit(cross(ez, ex), ok);   // right-handed
    if (!ok) { d.reason = "cannot complete frame"; return d; }

    // origin = mutual intersection of the three ORIGINAL planes:
    //   n_i · x = n_i · p_i  for i = A, B, C  (normalized normals as rows).
    Vec3 nC = unit(cNormal, ok);
    if (!ok) { d.reason = "tertiary datum C normal degenerate"; return d; }
    double M[3][3] = {{nA.x, nA.y, nA.z}, {nB.x, nB.y, nB.z}, {nC.x, nC.y, nC.z}};
    double r[3] = {dot(nA, aPoint), dot(nB, bPoint), dot(nC, cPoint)};
    double x[3];
    if (!solve3(M, r, x)) { d.reason = "three datum planes do not meet in a point"; return d; }
    d.origin = Vec3{x[0], x[1], x[2]};
    d.ex = ex; d.ey = ey; d.ez = ez;
    d.ok = true;
    return d;
}

Drf buildDrfAxis(const Vec3& axisPoint, const Vec3& axisDir) {
    Drf d;
    bool ok;
    Vec3 ez = unit(axisDir, ok);
    if (!ok) { d.reason = "datum axis direction degenerate"; return d; }
    Vec3 ex = anyPerp(ez);
    Vec3 ey = unit(cross(ez, ex), ok);
    if (!ok) { d.reason = "cannot complete axis frame"; return d; }
    d.origin = axisPoint;
    d.ex = ex; d.ey = ey; d.ez = ez;
    d.ok = true;
    return d;
}

Vec3 toDrf(const Drf& d, const Vec3& world) {
    Vec3 rel = sub(world, d.origin);
    return Vec3{dot(rel, d.ex), dot(rel, d.ey), dot(rel, d.ez)};
}

Vec3 toWorld(const Drf& d, const Vec3& p) {
    return add(d.origin, add(add(mul(d.ex, p.x), mul(d.ey, p.y)), mul(d.ez, p.z)));
}

// ===========================================================================
// SUBSTITUTE-FEATURE FITS
// ===========================================================================
FitPlane fitPlane(const std::vector<Vec3>& pts) {
    FitPlane r;
    if (pts.size() < 3) return r;
    Vec3 c; double w[3]; double V[3][3];
    if (!covarianceEigen(pts, c, w, V)) return r;
    int imin = 0;
    if (w[1] < w[imin]) imin = 1;
    if (w[2] < w[imin]) imin = 2;
    bool ok;
    Vec3 n = unit(eigvec(V, imin), ok);
    if (!ok) return r;
    r.ok = true; r.point = c; r.normal = n;
    return r;
}

FitLine fitLine(const std::vector<Vec3>& pts) {
    FitLine r;
    if (pts.size() < 2) return r;
    Vec3 c; double w[3]; double V[3][3];
    if (!covarianceEigen(pts, c, w, V)) return r;
    int imax = 0;
    if (w[1] > w[imax]) imax = 1;
    if (w[2] > w[imax]) imax = 2;
    bool ok;
    Vec3 dir = unit(eigvec(V, imax), ok);
    if (!ok) return r;
    r.ok = true; r.point = c; r.dir = dir;
    return r;
}

FitAxis fitCylinderAxis(const std::vector<Vec3>& pts) {
    FitAxis r;
    if (pts.size() < 6) return r;
    Vec3 c; double w[3]; double V[3][3];
    if (!covarianceEigen(pts, c, w, V)) return r;
    double bestBand = std::numeric_limits<double>::infinity();
    bool any = false;
    for (int k = 0; k < 3; ++k) {
        Vec3 axis = eigvec(V, k);
        double band, radius; Vec3 axisPt;
        if (radialBandAboutAxis(pts, c, axis, band, axisPt, radius)) {
            if (band < bestBand) {
                bestBand = band; any = true;
                bool ok;
                r.dir = unit(axis, ok);
                r.point = axisPt;
                r.radius = radius;
            }
        }
    }
    r.ok = any;
    return r;
}

// ===========================================================================
// NATIVE-GEOMETRY SAMPLING
// ===========================================================================
std::vector<Vec3> sampleFace(const brep::Face& f, int nu, int nv) {
    std::vector<Vec3> out;
    if (nu < 2) nu = 2;
    if (nv < 2) nv = 2;
    if (f.surface) {
        const brep::Surface& s = *f.surface;
        double du = (f.u1 - f.u0);
        double dv = (f.v1 - f.v0);
        for (int i = 0; i < nu; ++i) {
            double u = f.u0 + du * (static_cast<double>(i) / (nu - 1));
            for (int j = 0; j < nv; ++j) {
                double v = f.v0 + dv * (static_cast<double>(j) / (nv - 1));
                out.push_back(s.evaluate(u, v));
            }
        }
        return out;
    }
    // Bare topology: outer-loop vertex polygon (coplanar for a planar quad).
    if (f.outerLoop && f.outerLoop->first) {
        const brep::Coedge* start = f.outerLoop->first;
        const brep::Coedge* c = start;
        std::size_t guard = 0;
        do {
            if (c->originVertex()) out.push_back(P2V(c->originVertex()->point));
            c = c->next;
            ++guard;
        } while (c && c != start && guard < 1000000);
    }
    return out;
}

std::vector<Vec3> sampleEdge(const brep::Edge& e, int n) {
    std::vector<Vec3> out;
    if (n < 2) n = 2;
    if (e.curve) {
        double t0 = e.curve->t0, t1 = e.curve->t1;
        for (int i = 0; i < n; ++i) {
            double t = t0 + (t1 - t0) * (static_cast<double>(i) / (n - 1));
            out.push_back(e.curve->evaluate(t));
        }
        return out;
    }
    if (e.start && e.end) {
        Vec3 a = P2V(e.start->point), b = P2V(e.end->point);
        for (int i = 0; i < n; ++i) {
            double t = static_cast<double>(i) / (n - 1);
            out.push_back(add(mul(a, 1.0 - t), mul(b, t)));
        }
    }
    return out;
}

bool faceCylinderAxis(const brep::Face& f, Vec3& axisPoint, Vec3& axisDir,
                      double& radius) {
    if (!f.surface) return false;
    if (f.surface->kind != brep::SurfaceKind::Cylinder &&
        f.surface->kind != brep::SurfaceKind::Cone)
        return false;
    bool ok;
    axisPoint = f.surface->origin;
    axisDir = unit(f.surface->axis, ok);
    if (!ok) return false;
    radius = f.surface->r1;
    return true;
}

// Sample one circumferential ring of an analytic cylinder/cone face at axial
// fraction vfrac (0..1 over the trim), as n points around u. Falls back to the
// whole-face samples for a non-analytic face.
static std::vector<Vec3> sampleFaceRing(const brep::Face& f, double vfrac, int n) {
    std::vector<Vec3> out;
    if (n < 3) n = 3;
    if (f.surface && (f.surface->kind == brep::SurfaceKind::Cylinder ||
                      f.surface->kind == brep::SurfaceKind::Cone)) {
        double v = f.v0 + (f.v1 - f.v0) * vfrac;
        double du = (f.u1 - f.u0);
        for (int i = 0; i < n; ++i) {
            double u = f.u0 + du * (static_cast<double>(i) / n);  // open ring (no dup)
            out.push_back(f.surface->evaluate(u, v));
        }
        return out;
    }
    return sampleFace(f, n, 4);
}

// ===========================================================================
// (1) FLATNESS (§5.4.2)
// ===========================================================================
FcfResult measureFlatness(const std::vector<Vec3>& pts, double tol) {
    FcfResult r; r.characteristic = Characteristic::Flatness;
    r.toleranceZone = tol; r.nSamples = static_cast<int>(pts.size());
    if (pts.size() < 3) { r.reason = "fewer than 3 points"; return r; }
    FitPlane fp = fitPlane(pts);
    if (!fp.ok) { r.reason = "degenerate plane fit (collinear points)"; return r; }
    double dmin = std::numeric_limits<double>::infinity();
    double dmax = -std::numeric_limits<double>::infinity();
    for (const auto& p : pts) {
        double sd = dot(sub(p, fp.point), fp.normal);
        dmin = std::min(dmin, sd);
        dmax = std::max(dmax, sd);
    }
    r.measured = dmax - dmin;               // peak-to-valley band
    r.pass = (r.measured <= tol + kEps);
    r.ok = true;
    return r;
}

FcfResult flatness(const brep::Face& f, double tol, int nu, int nv) {
    return measureFlatness(sampleFace(f, nu, nv), tol);
}

// ===========================================================================
// (2) STRAIGHTNESS (§5.4.1)
// ===========================================================================
FcfResult measureStraightness(const std::vector<Vec3>& pts, double tol,
                              bool diametral) {
    FcfResult r; r.characteristic = Characteristic::Straightness;
    r.toleranceZone = tol; r.nSamples = static_cast<int>(pts.size());
    if (pts.size() < 2) { r.reason = "fewer than 2 points"; return r; }
    FitLine fl = fitLine(pts);
    if (!fl.ok) { r.reason = "degenerate line fit"; return r; }

    if (diametral) {
        // Ø derived-median-line zone: 2 × max perpendicular distance from the LS line.
        double maxPerp = 0.0;
        for (const auto& p : pts) {
            Vec3 d = sub(p, fl.point);
            Vec3 perp = sub(d, mul(fl.dir, dot(d, fl.dir)));
            maxPerp = std::max(maxPerp, len(perp));
        }
        r.measured = 2.0 * maxPerp;
    } else {
        // Planar line-element zone: range of the SIGNED perpendicular deviation
        // along the in-plane direction of maximum spread (2×2 principal direction).
        bool ok;
        Vec3 e1 = anyPerp(fl.dir);
        Vec3 e2 = unit(cross(fl.dir, e1), ok);
        double Saa = 0, Sbb = 0, Sab = 0;
        std::vector<double> as, bs;
        as.reserve(pts.size()); bs.reserve(pts.size());
        for (const auto& p : pts) {
            Vec3 d = sub(p, fl.point);
            Vec3 perp = sub(d, mul(fl.dir, dot(d, fl.dir)));
            double a = dot(perp, e1), b = dot(perp, e2);
            as.push_back(a); bs.push_back(b);
            Saa += a * a; Sbb += b * b; Sab += a * b;
        }
        double theta = 0.5 * std::atan2(2.0 * Sab, Saa - Sbb);
        double ct = std::cos(theta), st = std::sin(theta);
        double lo = std::numeric_limits<double>::infinity();
        double hi = -std::numeric_limits<double>::infinity();
        for (std::size_t i = 0; i < as.size(); ++i) {
            double t = as[i] * ct + bs[i] * st;
            lo = std::min(lo, t); hi = std::max(hi, t);
        }
        r.measured = hi - lo;
    }
    r.pass = (r.measured <= tol + kEps);
    r.ok = true;
    return r;
}

FcfResult straightnessEdge(const brep::Edge& e, double tol, int n) {
    return measureStraightness(sampleEdge(e, n), tol, /*diametral=*/false);
}

FcfResult straightnessAxis(const brep::Face& cyl, double tol, int nu, int nv) {
    // Derived median line = the per-axial-ring centres of the cylindrical face.
    FcfResult bad; bad.characteristic = Characteristic::Straightness;
    bad.toleranceZone = tol;
    if (nu < 3) nu = 3;
    if (nv < 2) nv = 2;
    std::vector<Vec3> centres;
    if (cyl.surface && (cyl.surface->kind == brep::SurfaceKind::Cylinder ||
                        cyl.surface->kind == brep::SurfaceKind::Cone)) {
        for (int j = 0; j < nv; ++j) {
            double vfrac = static_cast<double>(j) / (nv - 1);
            std::vector<Vec3> ring = sampleFaceRing(cyl, vfrac, nu);
            if (ring.empty()) continue;
            Vec3 c{0, 0, 0};
            for (const auto& p : ring) c = add(c, p);
            centres.push_back(mul(c, 1.0 / static_cast<double>(ring.size())));
        }
    }
    if (centres.size() < 2) { bad.reason = "face is not an analytic cylinder/cone"; return bad; }
    return measureStraightness(centres, tol, /*diametral=*/true);
}

// ===========================================================================
// (3) CIRCULARITY (§5.4.3)
// ===========================================================================
FcfResult measureCircularity(const std::vector<Vec3>& sectionPts, double tol) {
    FcfResult r; r.characteristic = Characteristic::Circularity;
    r.toleranceZone = tol; r.nSamples = static_cast<int>(sectionPts.size());
    if (sectionPts.size() < 3) { r.reason = "fewer than 3 section points"; return r; }
    // Project the (nominally coplanar) section onto its LS plane, fit a circle.
    FitPlane fp = fitPlane(sectionPts);
    Vec3 nrm, e1, e2; Vec3 cen;
    if (fp.ok) {
        cen = fp.point; nrm = fp.normal;
        e1 = anyPerp(nrm);
        bool ok; e2 = unit(cross(nrm, e1), ok);
    } else {
        // collinear-in-3D fallback: use the raw XY plane.
        cen = Vec3{0, 0, 0}; e1 = Vec3{1, 0, 0}; e2 = Vec3{0, 1, 0};
    }
    std::vector<Pt2> P; P.reserve(sectionPts.size());
    for (const auto& p : sectionPts) {
        Vec3 d = sub(p, cen);
        P.push_back(Pt2{dot(d, e1), dot(d, e2)});
    }
    double cu, cv, rr;
    if (!lsCircle2D(P, cu, cv, rr)) { r.reason = "degenerate circle fit"; return r; }
    double rmin = std::numeric_limits<double>::infinity();
    double rmax = -std::numeric_limits<double>::infinity();
    for (const auto& p : P) {
        double rad = std::sqrt((p.x - cu) * (p.x - cu) + (p.y - cv) * (p.y - cv));
        rmin = std::min(rmin, rad);
        rmax = std::max(rmax, rad);
    }
    r.measured = rmax - rmin;
    r.pass = (r.measured <= tol + kEps);
    r.ok = true;
    return r;
}

FcfResult circularity(const brep::Edge& circEdge, double tol, int n) {
    return measureCircularity(sampleEdge(circEdge, n), tol);
}

// ===========================================================================
// (4) CYLINDRICITY (§5.4.4)
// ===========================================================================
FcfResult measureCylindricity(const std::vector<Vec3>& surfPts, double tol) {
    FcfResult r; r.characteristic = Characteristic::Cylindricity;
    r.toleranceZone = tol; r.nSamples = static_cast<int>(surfPts.size());
    if (surfPts.size() < 6) { r.reason = "fewer than 6 surface points"; return r; }
    Vec3 c; double w[3]; double V[3][3];
    if (!covarianceEigen(surfPts, c, w, V)) { r.reason = "covariance failed"; return r; }
    double bestBand = std::numeric_limits<double>::infinity();
    bool any = false;
    for (int k = 0; k < 3; ++k) {
        double band, radius; Vec3 axisPt;
        if (radialBandAboutAxis(surfPts, c, eigvec(V, k), band, axisPt, radius)) {
            if (band < bestBand) { bestBand = band; any = true; }
        }
    }
    if (!any) { r.reason = "degenerate axis / circle fit"; return r; }
    r.measured = bestBand;
    r.pass = (r.measured <= tol + kEps);
    r.ok = true;
    return r;
}

FcfResult cylindricity(const brep::Face& cyl, double tol, int nu, int nv) {
    return measureCylindricity(sampleFace(cyl, nu, nv), tol);
}

// ===========================================================================
// (5) POSITION (§7.3)
// ===========================================================================
double mmcBonus(double actualSize, double matLimit, MatCond mc, FoSType ft) {
    double bonus = 0.0;
    if (mc == MatCond::MMC)
        bonus = (ft == FoSType::Hole) ? (actualSize - matLimit)
                                      : (matLimit - actualSize);
    else if (mc == MatCond::LMC)
        bonus = (ft == FoSType::Hole) ? (matLimit - actualSize)
                                      : (actualSize - matLimit);
    return (bonus < 0.0) ? 0.0 : bonus;   // RFS or out-of-size -> no bonus
}

FcfResult measurePosition(const Vec3& featAxisPtDrf, const Vec3& trueLocDrf,
                          double posTol, double actualSize, double matLimit,
                          MatCond mc, FoSType ft) {
    FcfResult r; r.characteristic = Characteristic::Position;
    double dx = featAxisPtDrf.x - trueLocDrf.x;
    double dy = featAxisPtDrf.y - trueLocDrf.y;
    double radial = std::sqrt(dx * dx + dy * dy);
    r.measured = 2.0 * radial;                       // diametral position error
    r.bonus = mmcBonus(actualSize, matLimit, mc, ft);
    r.toleranceZone = posTol + r.bonus;
    r.pass = (r.measured <= r.toleranceZone + kEps);
    r.ok = true;
    return r;
}

FcfResult position(const brep::Face& holeCyl, const Drf& drf,
                   const Vec3& trueLocDrf, double posTol, double actualSize,
                   double matLimit, MatCond mc, FoSType ft) {
    FcfResult r; r.characteristic = Characteristic::Position;
    r.toleranceZone = posTol;
    Vec3 axisPt, axisDir; double radius;
    if (!faceCylinderAxis(holeCyl, axisPt, axisDir, radius)) {
        r.reason = "feature face is not an analytic cylinder (no axis)"; return r;
    }
    if (!drf.ok) { r.reason = "datum reference frame invalid"; return r; }
    Vec3 ptDrf = toDrf(drf, axisPt);
    double sz = (actualSize > 0.0) ? actualSize : (2.0 * radius);
    return measurePosition(ptDrf, trueLocDrf, posTol, sz, matLimit, mc, ft);
}

// ===========================================================================
// (6) ORIENTATION: Perpendicularity / Parallelism / Angularity (§6.7–6.9)
// ===========================================================================
FcfResult measureOrientation(Characteristic c, const Vec3& featureDir,
                             const Vec3& datumDir, double basicAngleDeg,
                             double tol, double featureLength) {
    FcfResult r; r.characteristic = c; r.toleranceZone = tol;
    bool ok1, ok2;
    Vec3 f = unit(featureDir, ok1);
    Vec3 dd = unit(datumDir, ok2);
    if (!ok1 || !ok2) { r.reason = "degenerate feature/datum direction"; return r; }
    double cosT = std::fabs(dot(f, dd));            // fold line sense
    double beta = std::acos(clampUnit(cosT)) * 180.0 / kPi;   // [0,90]
    double angErr = std::fabs(beta - basicAngleDeg);          // degrees
    r.measured = std::fabs(featureLength) * std::sin(angErr * kPi / 180.0);
    r.pass = (r.measured <= tol + kEps);
    r.ok = true;
    return r;
}

FcfResult orientationAxis(const brep::Face& cyl, const Vec3& datumDir,
                          Characteristic c, double basicAngleDeg, double tol) {
    FcfResult r; r.characteristic = c; r.toleranceZone = tol;
    Vec3 axisPt, axisDir; double radius;
    if (!faceCylinderAxis(cyl, axisPt, axisDir, radius)) {
        r.reason = "feature face is not an analytic cylinder (no axis)"; return r;
    }
    double length = (cyl.surface && cyl.surface->param > 0.0)
                        ? cyl.surface->param
                        : aabbDiagonal(sampleFace(cyl, 8, 8));
    return measureOrientation(c, axisDir, datumDir, basicAngleDeg, tol, length);
}

FcfResult orientationFace(const brep::Face& f, const Vec3& datumDir,
                          Characteristic c, double basicAngleDeg, double tol,
                          int nu, int nv) {
    FcfResult r; r.characteristic = c; r.toleranceZone = tol;
    std::vector<Vec3> pts = sampleFace(f, nu, nv);
    FitPlane fp = fitPlane(pts);
    if (!fp.ok) { r.reason = "degenerate planar feature fit"; return r; }
    double length = aabbDiagonal(pts);   // in-plane feature extent
    return measureOrientation(c, fp.normal, datumDir, basicAngleDeg, tol, length);
}

// ===========================================================================
// (7) CONCENTRICITY (§5.12)
// ===========================================================================
FcfResult measureConcentricity(const Vec3& featAxisPt, const Vec3& datumAxisPt,
                               const Vec3& datumAxisDir, double tol) {
    FcfResult r; r.characteristic = Characteristic::Concentricity;
    r.toleranceZone = tol;
    double rho = radialFromAxis(featAxisPt, datumAxisPt, datumAxisDir);
    r.measured = 2.0 * rho;              // diametral coaxiality error
    r.pass = (r.measured <= tol + kEps);
    r.ok = true;
    return r;
}

FcfResult concentricity(const brep::Face& cyl, const Vec3& datumAxisPt,
                        const Vec3& datumAxisDir, double tol) {
    FcfResult r; r.characteristic = Characteristic::Concentricity;
    r.toleranceZone = tol;
    Vec3 axisPt, axisDir; double radius;
    if (!faceCylinderAxis(cyl, axisPt, axisDir, radius)) {
        r.reason = "feature face is not an analytic cylinder (no axis)"; return r;
    }
    return measureConcentricity(axisPt, datumAxisPt, datumAxisDir, tol);
}

// ===========================================================================
// (8) RUNOUT (§9)
// ===========================================================================
FcfResult measureCircularRunout(const std::vector<Vec3>& sectionPts,
                                const Vec3& datumAxisPt, const Vec3& datumAxisDir,
                                double tol) {
    FcfResult r; r.characteristic = Characteristic::CircularRunout;
    r.toleranceZone = tol; r.nSamples = static_cast<int>(sectionPts.size());
    if (sectionPts.size() < 3) { r.reason = "fewer than 3 section points"; return r; }
    double rmin = std::numeric_limits<double>::infinity();
    double rmax = -std::numeric_limits<double>::infinity();
    for (const auto& p : sectionPts) {
        double rad = radialFromAxis(p, datumAxisPt, datumAxisDir);
        rmin = std::min(rmin, rad);
        rmax = std::max(rmax, rad);
    }
    r.measured = rmax - rmin;            // FIM at the section about the datum axis
    r.pass = (r.measured <= tol + kEps);
    r.ok = true;
    return r;
}

FcfResult circularRunout(const brep::Face& cyl, const Vec3& datumAxisPt,
                         const Vec3& datumAxisDir, double tol, int nSection) {
    return measureCircularRunout(sampleFaceRing(cyl, 0.5, nSection),
                                 datumAxisPt, datumAxisDir, tol);
}

FcfResult measureTotalRunout(const std::vector<Vec3>& surfPts,
                             const Vec3& datumAxisPt, const Vec3& datumAxisDir,
                             double tol) {
    FcfResult r; r.characteristic = Characteristic::TotalRunout;
    r.toleranceZone = tol; r.nSamples = static_cast<int>(surfPts.size());
    if (surfPts.size() < 6) { r.reason = "fewer than 6 surface points"; return r; }
    double rmin = std::numeric_limits<double>::infinity();
    double rmax = -std::numeric_limits<double>::infinity();
    for (const auto& p : surfPts) {
        double rad = radialFromAxis(p, datumAxisPt, datumAxisDir);
        rmin = std::min(rmin, rad);
        rmax = std::max(rmax, rad);
    }
    r.measured = rmax - rmin;            // FIM over the whole surface
    r.pass = (r.measured <= tol + kEps);
    r.ok = true;
    return r;
}

FcfResult totalRunout(const brep::Face& cyl, const Vec3& datumAxisPt,
                      const Vec3& datumAxisDir, double tol, int nu, int nv) {
    return measureTotalRunout(sampleFace(cyl, nu, nv), datumAxisPt, datumAxisDir, tol);
}

// ===========================================================================
// (9) PROFILE OF A SURFACE (§11)
// ===========================================================================
FcfResult measureProfile(const std::vector<Vec3>& measuredPts,
                         const std::vector<Vec3>& trueProfilePts,
                         const std::vector<Vec3>& trueProfileNormals,
                         double tol, bool unilateral) {
    FcfResult r; r.characteristic = Characteristic::ProfileSurface;
    r.toleranceZone = tol; r.nSamples = static_cast<int>(measuredPts.size());
    if (measuredPts.empty() ||
        measuredPts.size() != trueProfilePts.size() ||
        measuredPts.size() != trueProfileNormals.size()) {
        r.reason = "empty or mismatched profile arrays"; return r;
    }
    const double half = 0.5 * tol;
    double worstAbs = 0.0;
    bool allInBand = true;
    for (std::size_t i = 0; i < measuredPts.size(); ++i) {
        bool ok;
        Vec3 nrm = unit(trueProfileNormals[i], ok);
        if (!ok) { r.reason = "degenerate true-profile normal"; return r; }
        double sd = dot(sub(measuredPts[i], trueProfilePts[i]), nrm);
        if (std::fabs(sd) > worstAbs) worstAbs = std::fabs(sd);
        bool conf = unilateral ? (sd >= -kEps && sd <= tol + kEps)
                               : (std::fabs(sd) <= half + kEps);
        if (!conf) allInBand = false;
    }
    r.measured = worstAbs;               // max |signed normal deviation|
    r.pass = unilateral ? allInBand : (worstAbs <= half + kEps);
    r.ok = true;
    return r;
}

} // namespace fcf
} // namespace gdt
} // namespace native
} // namespace forge
