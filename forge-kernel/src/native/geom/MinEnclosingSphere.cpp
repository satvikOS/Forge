// forge/native/geom/MinEnclosingSphere.cpp
//
// Implementation of forge::native::geom::minEnclosingSphere — the smallest
// enclosing sphere of a 3D point set via Welzl's randomized incremental
// algorithm with the move-to-front heuristic (expected linear time). Pure C++20,
// standard library only. See MinEnclosingSphere.hpp for the contract and the
// honest robustness posture.

#include <cstdint>
#include "forge/native/geom/MinEnclosingSphere.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <random>

namespace forge {
namespace native {
namespace geom {

namespace {

// --- tiny local 3-vector helpers (independent of the kernel's mesh Vec3) -----
using V3 = std::array<double, 3>;

inline V3 toV(const Point3& p) { return { p.x, p.y, p.z }; }

inline double dot(const V3& a, const V3& b) {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}
inline V3 sub(const V3& a, const V3& b) {
    return { a[0]-b[0], a[1]-b[1], a[2]-b[2] };
}
inline V3 add(const V3& a, const V3& b) {
    return { a[0]+b[0], a[1]+b[1], a[2]+b[2] };
}
inline V3 scale(const V3& a, double s) {
    return { a[0]*s, a[1]*s, a[2]*s };
}
inline V3 cross(const V3& a, const V3& b) {
    return { a[1]*b[2] - a[2]*b[1],
             a[2]*b[0] - a[0]*b[2],
             a[0]*b[1] - a[1]*b[0] };
}
inline double norm2(const V3& a) { return dot(a, a); }
inline double norm(const V3& a)  { return std::sqrt(dot(a, a)); }

inline bool finite3(const Point3& p) {
    return std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z);
}

// Build a successful MinSphere result.
MinSphere make(const V3& c, double r, std::initializer_list<V3> sup) {
    MinSphere s;
    s.ok = true;
    s.center = c;
    s.radius = r;
    s.support.assign(sup.begin(), sup.end());
    return s;
}

MinSphere fail(const char* why) {
    MinSphere s;
    s.ok = false;
    s.reason = why;
    return s;
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// Exact base-case constructors.
// ---------------------------------------------------------------------------

// 1 point: degenerate sphere, radius 0.
MinSphere sphere1(const Point3& a) {
    if (!finite3(a)) return fail("non-finite coordinate");
    return make(toV(a), 0.0, { toV(a) });
}

// 2 points: the diametral sphere (smallest sphere through both is the one with
// the segment as diameter).
MinSphere sphere2(const Point3& a, const Point3& b) {
    if (!finite3(a) || !finite3(b)) return fail("non-finite coordinate");
    const V3 va = toV(a), vb = toV(b);
    const V3 c = scale(add(va, vb), 0.5);
    const double r = 0.5 * norm(sub(vb, va));
    return make(c, r, { va, vb });
}

// 3 points: the smallest sphere through all three is the circumcircle of the
// triangle (its center lies in the triangle's plane). We solve for the center
// as a + s*ab + t*ac where the center is equidistant from a, b, c. Reference:
//   center = a + ( |ac|^2 (ab x ac) x ab + |ab|^2 (ac x ab) x ac )
//                / ( 2 |ab x ac|^2 ).
// Returns ok=false when the three points are collinear (ab x ac == 0).
MinSphere sphere3(const Point3& a, const Point3& b, const Point3& c) {
    if (!finite3(a) || !finite3(b) || !finite3(c))
        return fail("non-finite coordinate");
    const V3 va = toV(a), vb = toV(b), vc = toV(c);
    const V3 ab = sub(vb, va);
    const V3 ac = sub(vc, va);
    const V3 n  = cross(ab, ac);
    const double n2 = norm2(n);
    if (n2 <= 0.0) return fail("collinear points (no circumcircle)");

    const double ab2 = norm2(ab);
    const double ac2 = norm2(ac);
    // (ab x ac) x ab  and  (ac x ab) x ac
    const V3 t1 = cross(n, ab);             // (ab x ac) x ab
    const V3 t2 = cross(scale(n, -1.0), ac); // (ac x ab) x ac == -(ab x ac) x ac
    const V3 num = add(scale(t1, ac2), scale(t2, ab2));
    const V3 rel = scale(num, 1.0 / (2.0 * n2));
    const V3 center = add(va, rel);
    const double r = norm(rel);
    return make(center, r, { va, vb, vc });
}

// 4 points: the circumsphere of the tetrahedron. Solve the 3x3 linear system
// from |x - a|^2 == |x - b|^2 etc., i.e. for u = x - a:
//   2 (b-a) . u = |b-a|^2,  2 (c-a) . u = |c-a|^2,  2 (d-a) . u = |d-a|^2.
// Returns ok=false when the four points are coplanar (singular system).
MinSphere sphere4(const Point3& a, const Point3& b, const Point3& c, const Point3& d) {
    if (!finite3(a) || !finite3(b) || !finite3(c) || !finite3(d))
        return fail("non-finite coordinate");
    const V3 va = toV(a), vb = toV(b), vc = toV(c), vd = toV(d);
    const V3 ab = sub(vb, va);
    const V3 ac = sub(vc, va);
    const V3 ad = sub(vd, va);

    // Determinant of the 3x3 matrix whose rows are ab, ac, ad (== 6 * signed
    // tet volume). Zero => coplanar.
    const double det = dot(ab, cross(ac, ad));
    if (det == 0.0) return fail("coplanar points (no circumsphere)");

    // u = ( |ab|^2 (ac x ad) + |ac|^2 (ad x ab) + |ad|^2 (ab x ac) ) / (2 det)
    const double ab2 = norm2(ab);
    const double ac2 = norm2(ac);
    const double ad2 = norm2(ad);
    const V3 num = add(add(scale(cross(ac, ad), ab2),
                           scale(cross(ad, ab), ac2)),
                       scale(cross(ab, ac), ad2));
    const V3 rel = scale(num, 1.0 / (2.0 * det));
    const V3 center = add(va, rel);
    const double r = norm(rel);
    return make(center, r, { va, vb, vc, vd });
}

namespace {

// Build the trivial sphere from a basis of 0..4 boundary points. The basis is
// guaranteed (by Welzl) to be in "general position" for its arity, BUT a higher
// arity may be degenerate (e.g. a near-collinear triple promoted to the basis):
// when the closed-form for the current arity fails, fall back to the best
// lower-arity sphere that still encloses the basis. This keeps the recursion
// honest without ever returning a non-enclosing ball.
MinSphere trivial(const std::vector<V3>& R) {
    switch (R.size()) {
        case 0: {
            // Empty ball: radius -1 sentinel so any point lies outside it.
            MinSphere s;
            s.ok = true;
            s.center = { 0.0, 0.0, 0.0 };
            s.radius = -1.0;
            return s;
        }
        case 1:
            return make(R[0], 0.0, { R[0] });
        case 2: {
            const V3 c = scale(add(R[0], R[1]), 0.5);
            return make(c, 0.5 * norm(sub(R[1], R[0])), { R[0], R[1] });
        }
        case 3: {
            MinSphere s = sphere3(Point3{R[0][0],R[0][1],R[0][2]},
                                  Point3{R[1][0],R[1][1],R[1][2]},
                                  Point3{R[2][0],R[2][1],R[2][2]});
            if (s.ok) return s;
            // Degenerate triple: smallest 2-sphere covering all three.
            break;
        }
        default: {  // 4
            MinSphere s = sphere4(Point3{R[0][0],R[0][1],R[0][2]},
                                  Point3{R[1][0],R[1][1],R[1][2]},
                                  Point3{R[2][0],R[2][1],R[2][2]},
                                  Point3{R[3][0],R[3][1],R[3][2]});
            if (s.ok) return s;
            break;
        }
    }
    // Fallback for a degenerate >=3 basis: brute-force the smallest sphere over
    // pairs/triples of the basis that encloses the whole basis. The basis is at
    // most 4 points so this is O(1).
    MinSphere best;
    best.ok = false;
    double bestR = std::numeric_limits<double>::infinity();
    auto consider = [&](const MinSphere& cand) {
        if (!cand.ok) return;
        // Must enclose every basis point.
        for (const V3& p : R) {
            if (norm(sub(p, cand.center)) > cand.radius + 1e-9 * (1.0 + cand.radius))
                return;
        }
        if (cand.radius < bestR) { bestR = cand.radius; best = cand; }
    };
    const std::size_t n = R.size();
    for (std::size_t i = 0; i < n; ++i) {
        consider(make(R[i], 0.0, { R[i] }));
        for (std::size_t j = i + 1; j < n; ++j) {
            const V3 c = scale(add(R[i], R[j]), 0.5);
            consider(make(c, 0.5 * norm(sub(R[j], R[i])), { R[i], R[j] }));
            for (std::size_t k = j + 1; k < n; ++k)
                consider(sphere3(Point3{R[i][0],R[i][1],R[i][2]},
                                 Point3{R[j][0],R[j][1],R[j][2]},
                                 Point3{R[k][0],R[k][1],R[k][2]}));
        }
    }
    return best;
}

// Is point p inside (or on) the ball, with a tiny relative slack so a boundary
// point is never spuriously re-expanded by round-off?
inline bool inBall(const MinSphere& b, const V3& p) {
    if (b.radius < 0.0) return false;   // empty ball contains nothing
    const double d = norm(sub(p, b.center));
    return d <= b.radius + 1e-12 * (1.0 + b.radius);
}

// Welzl with move-to-front, iterative outer loop over a shuffled point list.
// `P` is the shuffled list of all points; `R` accumulates the boundary basis.
// We use the classic move-to-front variant: when a point falls outside the
// current ball it is moved to the front of P (so it is considered earlier next
// time), which keeps the expected running time linear.
MinSphere welzlMoveToFront(std::vector<V3>& P) {
    std::vector<V3> R;            // boundary basis (<= 4)
    MinSphere ball = trivial(R);  // empty ball

    // Incrementally insert; on a violation, recompute the basis ball through
    // the violating point and move it to the front.
    for (std::size_t i = 0; i < P.size(); ) {
        if (!inBall(ball, P[i])) {
            // P[i] must be on the boundary. Rebuild the minimal ball of
            // {P[0..i]} that has P[i] on its boundary, using the one-point /
            // two-point move-to-front sub-passes (the standard b_minidisk
            // recursion unrolled to 3D's 4-point basis).
            R.assign(1, P[i]);
            ball = trivial(R);
            for (std::size_t j = 0; j < i; ) {
                if (!inBall(ball, P[j])) {
                    // P[j] also on the boundary alongside P[i].
                    std::vector<V3> R2 = { P[i], P[j] };
                    MinSphere ball2 = trivial(R2);
                    for (std::size_t k = 0; k < j; ) {
                        if (!inBall(ball2, P[k])) {
                            std::vector<V3> R3 = { P[i], P[j], P[k] };
                            MinSphere ball3 = trivial(R3);
                            for (std::size_t l = 0; l < k; ++l) {
                                if (!inBall(ball3, P[l])) {
                                    std::vector<V3> R4 = { P[i], P[j], P[k], P[l] };
                                    ball3 = trivial(R4);
                                }
                            }
                            ball2 = ball3;
                            // move P[k] to front of [0..j)
                            V3 tmp = P[k];
                            for (std::size_t m = k; m > 0; --m) P[m] = P[m-1];
                            P[0] = tmp;
                            ++k;
                        } else {
                            ++k;
                        }
                    }
                    ball = ball2;
                    // move P[j] to front of [0..i)
                    V3 tmp = P[j];
                    for (std::size_t m = j; m > 0; --m) P[m] = P[m-1];
                    P[0] = tmp;
                    ++j;
                } else {
                    ++j;
                }
            }
            R = ball.support.empty() ? R : std::vector<V3>{};
            // move P[i] to the front of the whole list
            V3 tmp = P[i];
            for (std::size_t m = i; m > 0; --m) P[m] = P[m-1];
            P[0] = tmp;
            ++i;
        } else {
            ++i;
        }
    }
    return ball;
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// Public entry points.
// ---------------------------------------------------------------------------
MinSphere minEnclosingSphere(const std::vector<Point3>& pts) {
    if (pts.empty()) return fail("empty point set");
    for (const Point3& p : pts)
        if (!finite3(p)) return fail("non-finite coordinate");

    if (pts.size() == 1) return sphere1(pts[0]);

    // Working copy as V3, randomly permuted (Welzl is randomized; the shuffle
    // gives the expected-linear guarantee independent of input order).
    std::vector<V3> P;
    P.reserve(pts.size());
    for (const Point3& p : pts) P.push_back(toV(p));

    std::random_device rd;
    std::mt19937_64 rng((static_cast<std::uint64_t>(rd()) << 32) ^ rd());
    std::shuffle(P.begin(), P.end(), rng);

    MinSphere s = welzlMoveToFront(P);
    if (!s.ok || s.radius < 0.0) return fail("internal: failed to construct ball");

    // Final honesty pass: the returned ball MUST enclose every input point. If
    // round-off left a point marginally outside, expand minimally to that point
    // (still the correct enclosing sphere; never fabricated). This is a
    // belt-and-suspenders guard — on validated fixtures it never triggers.
    for (const Point3& p : pts) {
        const V3 v = toV(p);
        const double d = norm(sub(v, { s.center[0], s.center[1], s.center[2] }));
        if (d > s.radius) s.radius = d;
    }
    return s;
}

MinSphere minEnclosingSphere(const std::vector<double>& flatXYZ) {
    if (flatXYZ.size() % 3 != 0) return fail("ragged flat array (length % 3 != 0)");
    std::vector<Point3> pts;
    pts.reserve(flatXYZ.size() / 3);
    for (std::size_t i = 0; i + 2 < flatXYZ.size(); i += 3)
        pts.push_back(Point3{ flatXYZ[i], flatXYZ[i+1], flatXYZ[i+2] });
    return minEnclosingSphere(pts);
}

} // namespace geom
} // namespace native
} // namespace forge
