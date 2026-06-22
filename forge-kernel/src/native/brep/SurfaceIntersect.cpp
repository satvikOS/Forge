// forge/native/brep/SurfaceIntersect.cpp
//
// Implementation of the analytic surface–surface intersection (SurfaceIntersect.hpp).
// Closed-form solvers for the elementary quadric pairs; the high-degree pairs are
// reported as DEFERRED (ok=false) so the boolean falls back to the proven mesh
// arrangement. Pure C++20, no external deps. See header for honesty / scope.

#include "forge/native/brep/SurfaceIntersect.hpp"

#include <algorithm>
#include <cmath>
#include <functional>

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

// ===========================================================================
// CONE geometry helpers (apex / half-angle / implicit) — derived from the
// brep::Surface cone convention: origin = base centre (v=0), axis = symmetry
// axis (unit), radius r(v) = r1 + (r2-r1)*v, axial advance param*v over v∈[0,1].
// Apex is where r(v*)=0  ->  v* = r1/(r1-r2) ; half-angle α = atan(|r1-r2|/param).
// (If r1==r2 the surface is a cylinder and is handled by normalizeForSSI before
//  it ever reaches the cone path.)
// ===========================================================================
struct ConeGeom {
    Vec3   apex;        // cone apex point V
    Vec3   axisToBase;  // unit axis direction pointing from apex toward the base
    double alpha;       // half-angle (radians), in (0, π/2)
    double cosA, sinA;  // cos/sin of the half-angle
    bool   ok = false;
};

ConeGeom coneGeom(const Surface& cone) {
    ConeGeom g;
    const double dr = cone.r1 - cone.r2;          // r1 - r2 (positive if base wider)
    if (std::fabs(dr) < 1e-15 || cone.param <= 0.0) return g; // degenerate -> not a cone
    Vec3 ax = vnorm(cone.axis);
    const double vstar = cone.r1 / dr;            // v at which r(v)=0  (the apex)
    g.apex = vadd(cone.origin, vscale(ax, cone.param * vstar));
    // The base centre is at v=0 (cone.origin); apex->base direction points from the
    // apex toward the base. Base is "below" the apex by (param*vstar) along +ax.
    g.axisToBase = (vstar >= 0.0) ? vscale(ax, -1.0) : ax;
    g.alpha = std::atan(std::fabs(dr) / cone.param);
    g.cosA = std::cos(g.alpha);
    g.sinA = std::sin(g.alpha);
    g.ok = (g.alpha > 1e-12 && g.alpha < kPi / 2.0 - 1e-12);
    return g;
}

// Implicit value of the (double-napped) cone at a 3-D point P:
//   F(P) = ((P-V)·â)² - cos²α |P-V|²   (==0 on the cone, â the apex->base axis).
double coneImplicit(const ConeGeom& g, const Vec3& P) {
    Vec3 w = vsub(P, g.apex);
    double ax = vdot(w, g.axisToBase);
    return ax * ax - g.cosA * g.cosA * vdot(w, w);
}

// ---- plane ∩ cone -> circle / ellipse / parabola / hyperbola / line-pair ----
// Returns the closed-form conic. EXACT-by-construction: every emitted point is the
// intersection of a cone GENERATOR ray with the plane, so it lies on BOTH surfaces
// to round-off. The bounded conics (circle/ellipse) also carry analytic
// centre/semi-axes for the gate; the unbounded ones (parabola/hyperbola) are
// returned as a dense `Conic` polyline sampled over the valid azimuth range.
bool planeCone(const Surface& plane, const Surface& cone,
               std::vector<IntersectionCurve>& out, int sampleN, double tol) {
    ConeGeom g = coneGeom(cone);
    if (!g.ok) return false;                       // not a genuine cone -> defer

    Vec3 n = vnorm(plane.axis);
    Vec3 d = g.axisToBase;                         // unit apex->base axis
    const double cosG = std::fabs(vdot(n, d));     // |cos(angle(normal, axis))|
    const double apexSide = vdot(vsub(plane.origin, g.apex), n); // signed apex->plane

    // Azimuth frame in the plane perpendicular to the axis: e1,e2 span directions
    // ⟂ d. The generator at azimuth θ is  ĝ(θ) = cosα·d + sinα·(cosθ e1 + sinθ e2).
    Vec3 e1, e2; planeBasis(d, e1, e2);

    // Intersect the generator ray  P(θ,s) = V + s·ĝ(θ)  with the plane
    // n·(P - Q) = 0  ->  s(θ) = n·(Q - V) / (n·ĝ(θ)).  s>0 is the base-side nappe.
    Vec3 QmV = vsub(plane.origin, g.apex);
    const double num = vdot(n, QmV);               // = apexSide
    auto genDir = [&](double th) -> Vec3 {
        double ct = std::cos(th), st = std::sin(th);
        return vadd(vscale(d, g.cosA),
                    vscale(vadd(vscale(e1, ct), vscale(e2, st)), g.sinA));
    };
    auto pointAt = [&](double th, bool& valid) -> Vec3 {
        Vec3 gdir = genDir(th);
        double den = vdot(n, gdir);
        if (std::fabs(den) < 1e-12) { valid = false; return Vec3{0,0,0}; }
        double s = num / den;
        // keep the base-side nappe (s>0) unless the plane sits on the apex-side
        // (num and den signs make s land on the geometrically-correct nappe).
        valid = std::isfinite(s);
        return vadd(g.apex, vscale(gdir, s));
    };

    // --- degenerate: plane through the apex -> point / line-pair --------------
    if (std::fabs(apexSide) <= tol) {
        // The section degenerates: a single point (apex) if the plane meets only
        // the apex, or two lines (generators in the plane) if it cuts through.
        // Find generator azimuths whose direction is ⟂ n (lie in the plane).
        // cos between ĝ(θ) and n:  f(θ) = n·ĝ(θ) = cosα (n·d) + sinα (n·e1 cosθ + n·e2 sinθ).
        double A = g.sinA * vdot(n, e1), B = g.sinA * vdot(n, e2), C = g.cosA * vdot(n, d);
        double amp = std::sqrt(A * A + B * B);
        if (amp > tol && std::fabs(C) <= amp + tol) {
            // f(θ)=C+amp·cos(θ-φ)=0 has solutions: two generators lie in the plane
            // -> line-pair (a single generator when |C|==amp, i.e. plane tangent).
            double phi = std::atan2(B, A);
            double base = std::acos(std::max(-1.0, std::min(1.0, -C / amp)));
            std::vector<double> ths = {phi + base, phi - base};
            if (base < 1e-9) ths.pop_back(); // tangent: one generator only
            for (double th : ths) {
                IntersectionCurve c;
                c.kind = CurveKind::Line; c.closedForm = true;
                c.origin = g.apex; c.dir = vnorm(genDir(th));
                sampleLine(c, 0.0, 1e3, sampleN);
                out.push_back(c);
            }
            return true;
        }
        // otherwise contact is the apex point only.
        IntersectionCurve c; c.kind = CurveKind::Point; c.closedForm = true;
        c.origin = g.apex; c.samples = {g.apex};
        out.push_back(c);
        return true;
    }

    // --- CIRCLE: plane ⟂ axis ------------------------------------------------
    if (cosG >= 1.0 - 1e-12) {
        // axis pierces the plane at t along d:  n·(V + t d - Q)=0 -> t = num/(n·d).
        double t = num / vdot(n, d);
        if (t <= tol) {                            // behind the apex / at apex -> point
            IntersectionCurve c; c.kind = CurveKind::Point; c.closedForm = true;
            c.origin = g.apex; c.samples = {g.apex};
            out.push_back(c);
            return true;
        }
        Vec3 centre = vadd(g.apex, vscale(d, t));
        double radius = t * g.sinA / g.cosA;       // r = (axial dist)·tanα
        if (radius <= tol) {
            IntersectionCurve c; c.kind = CurveKind::Point; c.closedForm = true;
            c.origin = centre; c.samples = {centre};
            out.push_back(c);
            return true;
        }
        IntersectionCurve c; c.kind = CurveKind::Circle; c.closedForm = true;
        c.origin = centre; c.axis = n;
        Vec3 b1, b2; planeBasis(n, b1, b2);
        c.refDir = b1; c.r1 = radius;
        sampleCircle(c, sampleN);
        out.push_back(c);
        return true;
    }

    // --- ELLIPSE: plane cuts all generators of one nappe (|n·d| > sinα) ------
    if (cosG > g.sinA + 1e-12) {
        // Exact section: sample the generator parametrization over θ∈[0,2π). Each
        // sample is exactly on cone+plane. The MAJOR axis lies along the in-plane
        // projection of the cone axis (the steepest in-plane direction); its two ends
        // are the generators most/least inclined to the plane, which sit at azimuths
        // thMaj and thMaj+π. We get the centre + semi-major from those two apsides,
        // then the semi-minor as the curve's max perpendicular reach (the generator
        // azimuth is NOT linear with the ellipse angle, so a quarter-turn in θ does
        // NOT give the minor endpoint — measure it from the samples instead).
        bool v0, v1;
        Vec3 nInPerp = vsub(n, vscale(d, vdot(n, d))); // in-plane part of the axis dir
        double thMaj;
        if (vlen(nInPerp) > tol) {
            thMaj = std::atan2(vdot(nInPerp, e2), vdot(nInPerp, e1));
        } else thMaj = 0.0;
        Vec3 pA = pointAt(thMaj, v0);
        Vec3 pB = pointAt(thMaj + kPi, v1);
        if (!v0 || !v1) return false;
        Vec3 centre = vscale(vadd(pA, pB), 0.5);
        Vec3 majDir = vsub(pA, centre);
        double semiMajor = vlen(majDir);
        if (semiMajor < tol) return false;
        majDir = vscale(majDir, 1.0 / semiMajor);
        Vec3 minDir = vnorm(vcross(n, majDir));     // in-plane, ⟂ major
        IntersectionCurve c; c.kind = CurveKind::Ellipse; c.closedForm = true;
        // Dense EXACT samples straight off the generator parametrization (every
        // point on cone+plane), so a consumer that just wants points is exact.
        c.samples.clear(); c.samples.reserve(sampleN);
        double semiMinor = 0.0;
        for (int i = 0; i < sampleN; ++i) {
            bool vv; Vec3 p = pointAt(2.0 * kPi * i / sampleN, vv);
            if (!vv) continue;
            c.samples.push_back(p);
            semiMinor = std::max(semiMinor, std::fabs(vdot(vsub(p, centre), minDir)));
        }
        c.origin = centre; c.axis = n;
        c.refDir = majDir; c.r1 = semiMajor; c.r2 = semiMinor;
        c.closed = true;
        out.push_back(c);
        return true;
    }

    // --- PARABOLA (|n·d| == sinα) / HYPERBOLA (|n·d| < sinα): unbounded ------
    // One or two generators are parallel to the plane (n·ĝ=0); the section runs to
    // infinity. Sample the EXACT generator parametrization over the azimuth range
    // for which s>0 (the base-side nappe) and |n·ĝ| is not vanishing, skipping a
    // neighbourhood of each asymptote azimuth. The boolean clips this dense polyline
    // to the overlap box, so a generous bounded sampling is sufficient + exact.
    {
        IntersectionCurve c; c.kind = CurveKind::Conic; c.closedForm = true;
        c.origin = g.apex; c.axis = n; c.closed = false;
        c.samples.clear();
        const int M = std::max(sampleN, 64);
        const double asyEps = 1e-4;                // skip ε around each asymptote
        for (int i = 0; i <= M; ++i) {
            double th = 2.0 * kPi * i / M;
            Vec3 gdir = genDir(th);
            double den = vdot(n, gdir);
            if (std::fabs(den) < asyEps) continue; // near-asymptote: skip
            double s = num / den;
            if (s <= tol) continue;                // wrong nappe / behind apex
            c.samples.push_back(vadd(g.apex, vscale(gdir, s)));
        }
        if (c.samples.size() < 2) {                // nothing on the base nappe
            out.clear();
            IntersectionCurve e; e.kind = CurveKind::Empty; e.closedForm = true;
            out.push_back(e);
            return true;
        }
        out.push_back(c);
        return true;
    }
}

// ===========================================================================
// IMPLICIT-SURFACE MARCHING — the robust general SSI for the quartic pairs that
// have NO low-degree closed form (skew/unequal-r cyl∩cyl, general cyl∩sphere).
// We trace the intersection curve of two implicit surfaces Fa(P)=0, Fb(P)=0 by:
//   * seeding on the curve (coarse scan + Newton onto both),
//   * stepping along the tangent  t = ∇Fa × ∇Fb  (the curve direction),
//   * Newton-correcting each new point back onto BOTH surfaces (residual <tol),
//   * shrinking the arc step where the curve bends (adaptive),
//   * detecting closed loops (return near the seed) and walking disjoint branches.
// The emitted polyline is fine enough for the boolean imprint and every vertex is
// on both surfaces to `tol`, so the result is flagged allClosedForm=true ONLY when
// every traced vertex meets that residual.
// ===========================================================================
struct Implicit {
    // F and ∇F at a point.
    std::function<double(const Vec3&)> F;
    std::function<Vec3(const Vec3&)>   grad;
};

Implicit cylImplicit(const Surface& cyl) {
    Vec3 o = cyl.origin, a = vnorm(cyl.axis); double r = cyl.r1;
    Implicit im;
    im.F = [o, a, r](const Vec3& p) {
        Vec3 w = vsub(p, o);
        Vec3 rad = vsub(w, vscale(a, vdot(w, a)));
        return vdot(rad, rad) - r * r;
    };
    im.grad = [o, a](const Vec3& p) {
        Vec3 w = vsub(p, o);
        Vec3 rad = vsub(w, vscale(a, vdot(w, a)));
        return vscale(rad, 2.0);
    };
    return im;
}

Implicit sphereImplicit(const Surface& sph) {
    Vec3 c = sph.origin; double R = sph.r1;
    Implicit im;
    im.F = [c, R](const Vec3& p) { Vec3 w = vsub(p, c); return vdot(w, w) - R * R; };
    im.grad = [c](const Vec3& p) { return vscale(vsub(p, c), 2.0); };
    return im;
}

// Newton-correct P onto {Fa=0, Fb=0}: minimal move in the plane spanned by the two
// gradients to drive both residuals to zero. Returns false if it cannot converge.
bool newtonOntoBoth(const Implicit& A, const Implicit& B, Vec3& P, double tol) {
    for (int it = 0; it < 64; ++it) {
        double fa = A.F(P), fb = B.F(P);
        if (std::fabs(fa) < tol && std::fabs(fb) < tol) return true;
        Vec3 ga = A.grad(P), gb = B.grad(P);
        // Solve for δ = α·ga + β·gb such that  ga·δ = -fa, gb·δ = -fb  (2x2).
        double m00 = vdot(ga, ga), m01 = vdot(ga, gb), m11 = vdot(gb, gb);
        double det = m00 * m11 - m01 * m01;
        if (std::fabs(det) < 1e-300) return false; // gradients parallel (tangency)
        double alpha = (-fa * m11 + fb * m01) / det;
        double beta  = (-fb * m00 + fa * m01) / det;
        P = vadd(P, vadd(vscale(ga, alpha), vscale(gb, beta)));
    }
    double fa = A.F(P), fb = B.F(P);
    return std::fabs(fa) < tol && std::fabs(fb) < tol;
}

// Trace ONE connected branch starting from `seed` (already on both surfaces).
// Appends ordered points to `pts`; sets `closedLoop` if the walk returned to the
// seed. `maxResidual` is updated with the worst |F| seen (so the caller can flag
// closedForm honestly). Returns false if the trace broke (Newton diverged).
bool traceBranch(const Implicit& A, const Implicit& B, const Vec3& seed,
                 double h0, double tol, double extent,
                 std::vector<Vec3>& pts, bool& closedLoop, double& maxResidual) {
    closedLoop = false;
    Vec3 P = seed;
    if (!newtonOntoBoth(A, B, P, tol)) return false;
    auto tangent = [&](const Vec3& q, bool& okT) -> Vec3 {
        Vec3 t = vcross(A.grad(q), B.grad(q));
        double L = vlen(t);
        okT = (L > 1e-300);
        return okT ? vscale(t, 1.0 / L) : Vec3{0,0,0};
    };
    bool okT; Vec3 t0 = tangent(P, okT);
    if (!okT) return false;

    // Walk forward, then (if not closed) walk backward and prepend.
    for (int dirSign = +1; dirSign >= -1; dirSign -= 2) {
        Vec3 cur = seed;
        if (!newtonOntoBoth(A, B, cur, tol)) return false;
        Vec3 prevT = vscale(t0, (double)dirSign);
        std::vector<Vec3> branch;
        double h = h0;
        double walked = 0.0;
        for (int step = 0; step < 200000; ++step) {
            bool okt; Vec3 tg = tangent(cur, okt);
            if (!okt) break;
            if (vdot(tg, prevT) < 0) tg = vscale(tg, -1.0); // keep marching forward
            // adaptive predictor: trial step, measure turning, shrink if it bends.
            Vec3 trial = vadd(cur, vscale(tg, h));
            if (!newtonOntoBoth(A, B, trial, tol)) { h *= 0.5; if (h < 1e-7) break; continue; }
            bool okt2; Vec3 tg2 = tangent(trial, okt2);
            double turn = okt2 ? (1.0 - std::min(1.0, std::max(-1.0, vdot(tg, tg2)))) : 1.0;
            if (turn > 2e-3 && h > 1e-6) { h *= 0.5; continue; } // bends too much: refine
            // accept
            cur = trial; prevT = tg2; walked += h;
            maxResidual = std::max(maxResidual,
                                   std::max(std::fabs(A.F(cur)), std::fabs(B.F(cur))));
            // closed-loop detection: came back near the seed after moving away.
            if (dirSign == +1 && step > 4 && vlen(vsub(cur, seed)) < 1.5 * h0 &&
                walked > 4.0 * h0) {
                closedLoop = true; break;
            }
            branch.push_back(cur);
            if (turn < 5e-4 && h < h0) h = std::min(h0, h * 1.6); // open up on flat runs
            if (walked > extent) break;        // unbounded branch: stop at extent
        }
        if (dirSign == +1) {
            pts.push_back(seed);
            for (const Vec3& q : branch) pts.push_back(q);
            if (closedLoop) break;             // a loop needs no backward pass
        } else {
            std::vector<Vec3> pre(branch.rbegin(), branch.rend());
            pts.insert(pts.begin(), pre.begin(), pre.end());
        }
    }
    return pts.size() >= 2;
}

// March every connected branch of {Fa=0,Fb=0} that passes through a coarse seed
// grid sampled on surface A (param u,v). Emits one IntersectionCurve per branch.
// `allExact` is set false if any vertex failed the residual (caller defers).
bool marchSurfaces(const Surface& A, const Surface& B,
                   const Implicit& fA, const Implicit& fB,
                   std::vector<IntersectionCurve>& out, int sampleN, double tol,
                   bool& allExact) {
    allExact = true;
    // characteristic size for step / extent from the two surfaces' radii + spans.
    double scale = std::max({std::fabs(A.r1), std::fabs(B.r1),
                             std::fabs(A.param), std::fabs(B.param), 1.0});
    const double h0 = 0.02 * scale;
    const double extent = 64.0 * scale;
    const double seedTol = tol;

    // Coarse seeds: scan surface A's parameter rectangle and keep points that
    // Newton-converge onto B too. Dedup seeds that fall on an already-traced curve.
    std::vector<std::vector<Vec3>> branches;
    auto onExisting = [&](const Vec3& p) {
        for (auto& br : branches)
            for (const Vec3& q : br)
                if (vlen(vsub(p, q)) < 2.0 * h0) return true;
        return false;
    };

    // A's natural (u,v) sampling domain.
    double u0, u1, v0, v1;
    if (A.kind == SurfaceKind::Cylinder) { u0 = 0; u1 = 2 * kPi; v0 = -extent; v1 = extent; }
    else if (A.kind == SurfaceKind::Sphere) { u0 = 0; u1 = 2 * kPi; v0 = 0; v1 = kPi; }
    else { u0 = 0; u1 = 2 * kPi; v0 = -extent; v1 = extent; }
    const int NU = 96, NV = 64;
    for (int iu = 0; iu < NU; ++iu) {
        for (int iv = 0; iv <= NV; ++iv) {
            double u = u0 + (u1 - u0) * iu / NU;
            double v = v0 + (v1 - v0) * iv / NV;
            Vec3 P = A.evaluate(u, v);
            // only seed where B's implicit changes sign nearby (near the curve).
            if (std::fabs(fB.F(P)) > 0.25 * scale * scale) continue;
            Vec3 seed = P;
            if (!newtonOntoBoth(fA, fB, seed, seedTol)) continue;
            if (onExisting(seed)) continue;
            std::vector<Vec3> pts; bool closed = false; double maxRes = 0.0;
            if (!traceBranch(fA, fB, seed, h0, tol, extent, pts, closed, maxRes)) continue;
            if (pts.size() < 2) continue;
            if (maxRes > 1e-7) allExact = false;
            branches.push_back(pts);
            IntersectionCurve c;
            c.kind = CurveKind::Polyline; c.closedForm = true; c.closed = closed;
            c.samples = std::move(pts);
            out.push_back(std::move(c));
        }
    }
    return !out.empty();
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
    auto isCone = [&](const Surface& s) { return s.kind == SK::Cone; };

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
            res.ok = true; res.allClosedForm = true; res.reason = "cylinder∩cylinder (closed-form)";
            res.curves = std::move(cs);
            return res;
        }
        // General / skew / unequal-radius pair -> robust adaptive MARCHED trace.
        std::vector<IntersectionCurve> mc; bool exact = false;
        if (marchSurfaces(a, b, cylImplicit(a), cylImplicit(b), mc, N, tol, exact)) {
            res.ok = true; res.allClosedForm = exact;
            res.reason = "cylinder∩cylinder (marched)";
            res.curves = std::move(mc);
            return res;
        }
        res.ok = false; res.reason = "cylinder∩cylinder (no intersection / degenerate)";
        return res;
    }
    // cylinder ∩ sphere (either order)
    if ((isCyl(a) && isSphere(b)) || (isSphere(a) && isCyl(b))) {
        const Surface& C = isCyl(a) ? a : b;
        const Surface& S = isCyl(a) ? b : a;
        std::vector<IntersectionCurve> cs;
        if (cylinderSphere(C, S, cs, N, tol)) {
            res.ok = true; res.allClosedForm = true; res.reason = "cylinder∩sphere (closed-form)";
            res.curves = std::move(cs);
            return res;
        }
        // General offset -> robust adaptive MARCHED trace (quartic curve).
        std::vector<IntersectionCurve> mc; bool exact = false;
        if (marchSurfaces(C, S, cylImplicit(C), sphereImplicit(S), mc, N, tol, exact)) {
            res.ok = true; res.allClosedForm = exact;
            res.reason = "cylinder∩sphere (marched)";
            res.curves = std::move(mc);
            return res;
        }
        res.ok = false; res.reason = "cylinder∩sphere (no intersection / degenerate)";
        return res;
    }
    // plane ∩ cone (either order) -> Dandelin conic (circle/ellipse/parabola/
    // hyperbola/line-pair), closed-form.
    if ((isPlane(a) && isCone(b)) || (isCone(a) && isPlane(b))) {
        const Surface& P = isPlane(a) ? a : b;
        const Surface& C = isPlane(a) ? b : a;
        std::vector<IntersectionCurve> cs;
        if (planeCone(P, C, cs, N, tol)) {
            res.ok = true; res.allClosedForm = true; res.reason = "plane∩cone";
            // strip an Empty placeholder (no curve) but keep ok=true.
            for (auto& c : cs) if (c.kind != CurveKind::Empty) res.curves.push_back(c);
            return res;
        }
        res.ok = false; res.reason = "plane∩cone (degenerate cone) deferred";
        return res;
    }

    // Everything else (cone∩cone / cone∩sphere / cone∩cyl, torus-anything, NURBS)
    // is DEFERRED.
    (void)K;
    res.ok = false; res.reason = "deferred (high-degree or NURBS pair)";
    return res;
}

} // namespace brep
} // namespace native
} // namespace forge
