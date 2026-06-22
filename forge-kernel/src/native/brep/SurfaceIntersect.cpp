// forge/native/brep/SurfaceIntersect.cpp
//
// Implementation of the analytic surface–surface intersection (SurfaceIntersect.hpp).
// Closed-form solvers for the elementary quadric pairs; the high-degree pairs are
// reported as DEFERRED (ok=false) so the boolean falls back to the proven mesh
// arrangement. Pure C++20, no external deps. See header for honesty / scope.

#include "forge/native/brep/SurfaceIntersect.hpp"

#include <algorithm>
#include <cmath>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double kPi = 3.14159265358979323846;

// Build an orthonormal in-plane basis (e1,e2) for a plane with unit normal n.
void planeBasis(const Vec3& n, Vec3& e1, Vec3& e2) {
    Vec3 t = (std::fabs(n.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    e1 = vnorm(vcross(n, t));
    e2 = vnorm(vcross(n, e1));
}

// Densely sample an exact circle into a closed polyline (no duplicated endpoint).
void sampleCircle(IntersectionCurve& c, int N) {
    c.samples.clear();
    c.samples.reserve(N);
    Vec3 e1 = c.refDir, e2 = c.binorm();
    for (int i = 0; i < N; ++i) {
        double th = 2.0 * kPi * i / N;
        c.samples.push_back(vadd(c.origin,
            vadd(vscale(e1, c.r1 * std::cos(th)),
                 vscale(e2, c.r1 * std::sin(th)))));
    }
    c.closed = true;
}

// Densely sample an exact ellipse into a closed polyline.
void sampleEllipse(IntersectionCurve& c, int N) {
    c.samples.clear();
    c.samples.reserve(N);
    Vec3 e1 = c.refDir, e2 = c.binorm();
    for (int i = 0; i < N; ++i) {
        double th = 2.0 * kPi * i / N;
        c.samples.push_back(vadd(c.origin,
            vadd(vscale(e1, c.r1 * std::cos(th)),
                 vscale(e2, c.r2 * std::sin(th)))));
    }
    c.closed = true;
}

// Sample a line over a parameter span [t0,t1] (used after trimming).
void sampleLine(IntersectionCurve& c, double t0, double t1, int N) {
    c.samples.clear();
    c.samples.reserve(N);
    for (int i = 0; i < N; ++i) {
        double t = t0 + (t1 - t0) * i / (N - 1);
        c.samples.push_back(vadd(c.origin, vscale(c.dir, t)));
    }
    c.closed = false;
}

IntersectionCurve makeEmpty() {
    IntersectionCurve c; c.kind = CurveKind::Empty; c.closedForm = true; return c;
}

// ---- plane ∩ plane -> line ------------------------------------------------
bool planePlane(const Surface& A, const Surface& B,
                IntersectionCurve& out, int sampleN, double tol) {
    Vec3 nA = vnorm(A.axis), nB = vnorm(B.axis);
    Vec3 d = vcross(nA, nB);
    double dl = vlen(d);
    if (dl < tol) { out = makeEmpty(); return true; } // parallel (coincident or none)
    d = vscale(d, 1.0 / dl);
    // A point on both planes: solve [nA;nB] x = [dA;dB] in the plane spanned by nA,nB.
    double dA = vdot(nA, A.origin), dB = vdot(nB, B.origin);
    double n11 = vdot(nA, nA), n12 = vdot(nA, nB), n22 = vdot(nB, nB);
    double det = n11 * n22 - n12 * n12;
    if (std::fabs(det) < tol) { out = makeEmpty(); return true; }
    double c1 = (dA * n22 - dB * n12) / det;
    double c2 = (dB * n11 - dA * n12) / det;
    out.kind = CurveKind::Line; out.closedForm = true;
    out.origin = vadd(vscale(nA, c1), vscale(nB, c2));
    out.dir = d;
    sampleLine(out, -1e3, 1e3, sampleN);
    return true;
}

// ---- plane ∩ sphere -> circle / point / empty -----------------------------
bool planeSphere(const Surface& plane, const Surface& sph,
                 IntersectionCurve& out, int sampleN, double tol) {
    Vec3 n = vnorm(plane.axis);
    double dist = vdot(vsub(sph.origin, plane.origin), n); // signed dist centre->plane
    double R = sph.r1;
    if (std::fabs(dist) > R + tol) { out = makeEmpty(); return true; }
    Vec3 centre = vsub(sph.origin, vscale(n, dist)); // foot of centre on plane
    if (std::fabs(std::fabs(dist) - R) <= tol) {     // tangent => single point
        out.kind = CurveKind::Point; out.closedForm = true;
        out.origin = centre; out.samples = {centre};
        return true;
    }
    double r = std::sqrt(std::max(0.0, R * R - dist * dist));
    out.kind = CurveKind::Circle; out.closedForm = true;
    out.origin = centre; out.axis = n;
    Vec3 e1, e2; planeBasis(n, e1, e2);
    out.refDir = e1; out.r1 = r;
    sampleCircle(out, sampleN);
    return true;
}

// ---- sphere ∩ sphere -> circle / point / empty ----------------------------
bool sphereSphere(const Surface& A, const Surface& B,
                  IntersectionCurve& out, int sampleN, double tol) {
    Vec3 d = vsub(B.origin, A.origin);
    double dc = vlen(d);
    double rA = A.r1, rB = B.r1;
    if (dc < tol) { out = makeEmpty(); return true; }     // concentric
    if (dc > rA + rB + tol || dc < std::fabs(rA - rB) - tol) {
        out = makeEmpty(); return true;                   // disjoint / nested
    }
    Vec3 u = vscale(d, 1.0 / dc);
    // distance from A's centre to the radical plane along u.
    double a = (dc * dc + rA * rA - rB * rB) / (2.0 * dc);
    Vec3 centre = vadd(A.origin, vscale(u, a));
    double h2 = rA * rA - a * a;
    if (h2 <= tol * tol) {                                // tangent => point
        out.kind = CurveKind::Point; out.closedForm = true;
        out.origin = centre; out.samples = {centre};
        return true;
    }
    out.kind = CurveKind::Circle; out.closedForm = true;
    out.origin = centre; out.axis = u;
    Vec3 e1, e2; planeBasis(u, e1, e2);
    out.refDir = e1; out.r1 = std::sqrt(h2);
    sampleCircle(out, sampleN);
    return true;
}

// ---- plane ∩ cylinder -> circle (⊥) / line-pair (∥) / ellipse (oblique) ---
bool planeCylinder(const Surface& plane, const Surface& cyl,
                   std::vector<IntersectionCurve>& out, int sampleN, double tol) {
    Vec3 n = vnorm(plane.axis);
    Vec3 a = vnorm(cyl.axis);
    double R = cyl.r1;
    double cosA = vdot(n, a);
    // Distance from cylinder axis-point to the plane.
    Vec3 base = cyl.origin; // a point on the axis
    double distBase = vdot(vsub(base, plane.origin), n);

    if (std::fabs(cosA) <= tol) {
        // Plane PARALLEL to the axis: intersection is 0, 1 or 2 lines parallel to
        // the axis. The plane cuts the circular cross-section in a chord.
        // Work in the cross-section plane through `base` perpendicular to a.
        // Distance from the axis to the plane = |distBase| (plane ∥ axis, so the
        // perpendicular distance is constant along the axis).
        double dd = std::fabs(distBase);
        if (dd > R + tol) return true;       // miss (no curves)
        // The two lines are at the chord endpoints. Direction = axis a.
        // Find the foot of the axis on the plane's offset: move the axis point by
        // -distBase*n to land it on the plane, then move ±chord/2 along the
        // in-plane direction perpendicular to a.
        Vec3 footDir = vscale(n, -distBase);            // axis-point -> plane
        Vec3 inPlanePerp = vnorm(vcross(a, n));         // ⟂ both axis and normal, in plane
        double half = std::sqrt(std::max(0.0, R * R - distBase * distBase));
        for (int s = -1; s <= 1; s += 2) {
            if (half <= tol && s == 1) break;            // tangent => single line
            IntersectionCurve c;
            c.kind = CurveKind::Line; c.closedForm = true;
            c.origin = vadd(vadd(base, footDir), vscale(inPlanePerp, s * half));
            c.dir = a;
            sampleLine(c, -1e3, 1e3, sampleN);
            out.push_back(c);
            if (half <= tol) break;
        }
        return true;
    }

    // Plane not parallel: a single ELLIPSE (a circle when n ∥ a). The ellipse
    // centre is where the axis pierces the plane.
    double t = -distBase / cosA;                         // param along axis to plane
    Vec3 centre = vadd(base, vscale(a, t));
    // Minor semi-axis = R (the in-plane direction ⟂ to the axis projection).
    // Major semi-axis = R / |cosA| (stretch along the tilt direction).
    Vec3 minorDir = vnorm(vcross(a, n));                 // in plane, ⟂ axis projection
    if (vlen(minorDir) < tol) { // n ∥ a -> a circle
        IntersectionCurve c;
        c.kind = CurveKind::Circle; c.closedForm = true;
        c.origin = centre; c.axis = n;
        Vec3 e1, e2; planeBasis(n, e1, e2);
        c.refDir = e1; c.r1 = R;
        sampleCircle(c, sampleN);
        out.push_back(c);
        return true;
    }
    Vec3 majorDir = vnorm(vcross(n, minorDir));          // in plane, the tilt dir
    IntersectionCurve c;
    c.kind = CurveKind::Ellipse; c.closedForm = true;
    c.origin = centre; c.axis = n;
    c.refDir = majorDir; c.r1 = R / std::fabs(cosA);     // semi-major
    c.r2 = R;                                            // semi-minor (along minorDir)
    // Ensure binorm() == minorDir (axis x refDir): axis=n, refDir=majorDir.
    sampleEllipse(c, sampleN);
    out.push_back(c);
    return true;
}

// ---- cylinder ∩ cylinder (equal radius, intersecting axes) -> Steinmetz ---
// Returns true (handled) only for the coaxial-equal-r (=> no isolated curve, the
// surfaces coincide -> reported empty here, handled as coincident by the boolean)
// and the equal-radius perpendicular-intersecting-axes case (two ellipses). The
// general skew case returns false (DEFERRED).
bool cylinderCylinder(const Surface& A, const Surface& B,
                      std::vector<IntersectionCurve>& out, int sampleN, double tol) {
    Vec3 aA = vnorm(A.axis), aB = vnorm(B.axis);
    double cross = vlen(vcross(aA, aB));
    if (cross < tol) {
        // Parallel axes. If coaxial & equal radius -> coincident (let boolean's
        // coincident-face path handle it); else 0 curves (two parallel cylinders
        // of equal r either coincide or never meet on the surface in a curve).
        return false; // DEFER parallel-cylinder family to the mesh boolean
    }
    if (std::fabs(A.r1 - B.r1) > tol) return false;       // unequal radius -> quartic, DEFER

    // Equal radius, skew/intersecting axes. The intersection is two planar
    // ellipses ONLY when the axes intersect (Steinmetz). Find the closest points
    // of the two axis lines; if they are not coincident the axes are skew and the
    // closed-form ellipses do not hold -> DEFER.
    Vec3 w0 = vsub(A.origin, B.origin);
    double aa = 1.0, bb = vdot(aA, aB), cc = 1.0;
    double dd = vdot(aA, w0), ee = vdot(aB, w0);
    double den = aa * cc - bb * bb;
    if (std::fabs(den) < tol) return false;
    double sA = (bb * ee - cc * dd) / den;
    double sB = (aa * ee - bb * dd) / den;
    Vec3 pA = vadd(A.origin, vscale(aA, sA));
    Vec3 pB = vadd(B.origin, vscale(aB, sB));
    if (vlen(vsub(pA, pB)) > 1e-6) return false;           // skew -> DEFER
    Vec3 centre = vscale(vadd(pA, pB), 0.5);
    double R = A.r1;

    // Two ellipses lie in the two bisecting planes of the axes. The bisector
    // directions are (aA ± aB)/|aA ± aB|. Each ellipse is a circle of radius R
    // stretched along the bisector. For each bisecting plane the curve is an
    // ellipse with semi-minor R (perpendicular to both axes) and semi-major
    // R/|sin(half-angle)|-style stretch. We derive it directly: in a bisecting
    // plane the intersection of two equal cylinders is an ellipse whose minor
    // axis = R (shared perpendicular) and major axis = R/sin(theta/2-complement).
    Vec3 perp = vnorm(vcross(aA, aB)); // shared perpendicular (minor-axis dir)
    for (int s = -1; s <= 1; s += 2) {
        Vec3 bis = vnorm(vadd(aA, vscale(aB, (double)s)));
        // Plane normal of the ellipse = perp x bis (the plane containing bis & perp).
        Vec3 planeN = vnorm(vcross(bis, perp));
        // The angle between the two axes.
        double cosg = std::fabs(vdot(aA, aB));
        cosg = std::min(1.0, std::max(-1.0, cosg));
        double gamma = std::acos(cosg);          // angle between axes
        // semi-major along bis: R / sin(gamma/2) for the "+" bisector, R / cos(gamma/2)
        // for the "-"; choose by which bisector. Use the robust component form:
        // major = R / |sin(angle between bis and each axis)|.
        double sinHalf = std::fabs(vdot(bis, vnorm(vcross(perp, aA))));
        double major = (sinHalf > tol) ? R / sinHalf : R;
        IntersectionCurve c;
        c.kind = CurveKind::Ellipse; c.closedForm = true;
        c.origin = centre; c.axis = planeN;
        c.refDir = bis; c.r1 = major; c.r2 = R;
        sampleEllipse(c, sampleN);
        out.push_back(c);
    }
    return true;
}

// ---- cylinder ∩ sphere (axis through centre) -> circles -------------------
bool cylinderSphere(const Surface& cyl, const Surface& sph,
                    std::vector<IntersectionCurve>& out, int sampleN, double tol) {
    Vec3 a = vnorm(cyl.axis);
    Vec3 d = vsub(sph.origin, cyl.origin);
    // Perpendicular distance from sphere centre to cylinder axis.
    Vec3 dPerp = vsub(d, vscale(a, vdot(d, a)));
    if (vlen(dPerp) > tol) return false;                  // axis misses centre -> quartic, DEFER
    double R = sph.r1, rc = cyl.r1;
    if (rc > R + tol) return true;                         // no intersection (curves empty)
    // The cylinder of radius rc cuts the sphere in two circles at z = ±sqrt(R²-rc²).
    double h2 = R * R - rc * rc;
    if (h2 < -tol) return true;
    double h = std::sqrt(std::max(0.0, h2));
    // Position along the axis (relative to sphere centre projected onto axis).
    double base = vdot(vsub(cyl.origin, sph.origin), a); // not used for centre, axis passes centre
    (void)base;
    for (int s = -1; s <= 1; s += 2) {
        IntersectionCurve c;
        c.kind = CurveKind::Circle; c.closedForm = true;
        c.origin = vadd(sph.origin, vscale(a, s * h));
        c.axis = a;
        Vec3 e1, e2; planeBasis(a, e1, e2);
        c.refDir = e1; c.r1 = rc;
        sampleCircle(c, sampleN);
        out.push_back(c);
        if (h <= tol) break; // tangent (single circle of contact)
    }
    return true;
}

} // namespace

SurfaceIntersectResult intersectSurfaces(const Surface& a, const Surface& b,
                                         const SurfaceIntersectOptions& opts) {
    SurfaceIntersectResult res;
    const int N = opts.sampleN;
    const double tol = opts.tol;

    auto K = [](const Surface& s) { return s.kind; };
    using SK = SurfaceKind;

    // Normalize ordering helpers.
    auto isPlane = [&](const Surface& s) { return s.kind == SK::Plane; };
    auto isSphere = [&](const Surface& s) { return s.kind == SK::Sphere; };
    auto isCyl = [&](const Surface& s) { return s.kind == SK::Cylinder; };

    // plane ∩ plane
    if (isPlane(a) && isPlane(b)) {
        IntersectionCurve c;
        if (planePlane(a, b, c, N, tol)) {
            res.ok = true; res.allClosedForm = true; res.reason = "plane∩plane";
            if (c.kind != CurveKind::Empty) res.curves.push_back(c);
            return res;
        }
    }
    // plane ∩ sphere (either order)
    if ((isPlane(a) && isSphere(b)) || (isSphere(a) && isPlane(b))) {
        const Surface& P = isPlane(a) ? a : b;
        const Surface& S = isPlane(a) ? b : a;
        IntersectionCurve c;
        if (planeSphere(P, S, c, N, tol)) {
            res.ok = true; res.allClosedForm = true; res.reason = "plane∩sphere";
            if (c.kind != CurveKind::Empty) res.curves.push_back(c);
            return res;
        }
    }
    // sphere ∩ sphere
    if (isSphere(a) && isSphere(b)) {
        IntersectionCurve c;
        if (sphereSphere(a, b, c, N, tol)) {
            res.ok = true; res.allClosedForm = true; res.reason = "sphere∩sphere";
            if (c.kind != CurveKind::Empty) res.curves.push_back(c);
            return res;
        }
    }
    // plane ∩ cylinder (either order)
    if ((isPlane(a) && isCyl(b)) || (isCyl(a) && isPlane(b))) {
        const Surface& P = isPlane(a) ? a : b;
        const Surface& C = isPlane(a) ? b : a;
        std::vector<IntersectionCurve> cs;
        if (planeCylinder(P, C, cs, N, tol)) {
            res.ok = true; res.allClosedForm = true; res.reason = "plane∩cylinder";
            res.curves = std::move(cs);
            return res;
        }
    }
    // cylinder ∩ cylinder
    if (isCyl(a) && isCyl(b)) {
        std::vector<IntersectionCurve> cs;
        if (cylinderCylinder(a, b, cs, N, tol)) {
            res.ok = true; res.allClosedForm = true; res.reason = "cylinder∩cylinder";
            res.curves = std::move(cs);
            return res;
        }
        res.ok = false; res.reason = "cylinder∩cylinder (skew/unequal-r) deferred";
        return res;
    }
    // cylinder ∩ sphere (either order)
    if ((isCyl(a) && isSphere(b)) || (isSphere(a) && isCyl(b))) {
        const Surface& C = isCyl(a) ? a : b;
        const Surface& S = isCyl(a) ? b : a;
        std::vector<IntersectionCurve> cs;
        if (cylinderSphere(C, S, cs, N, tol)) {
            res.ok = true; res.allClosedForm = true; res.reason = "cylinder∩sphere";
            res.curves = std::move(cs);
            return res;
        }
        res.ok = false; res.reason = "cylinder∩sphere (general) deferred";
        return res;
    }

    // Everything else (cone-anything, torus-anything, NURBS) is DEFERRED.
    (void)K;
    res.ok = false; res.reason = "deferred (high-degree or NURBS pair)";
    return res;
}

} // namespace brep
} // namespace native
} // namespace forge
