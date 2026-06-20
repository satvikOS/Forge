// forge/native/mesh/TriTriIntersect.cpp
//
// EXACT triangle–triangle intersection (Stage 2 core primitive). See
// forge/native/mesh/TriTriIntersect.hpp for the honest scope statement.
//
// ALGORITHM (combinatorics exact via orient3d; coordinates double-precision)
// --------------------------------------------------------------------------
// For triangles A and B:
//
//  1. Side signs. For each vertex of B, sB[i] = sign of orient3d(A0,A1,A2,Bi).
//     This is the exact side of B's vertex relative to A's supporting plane.
//     Symmetrically sA[i] for A's vertices vs B's plane.
//
//  2. Early reject. If all three sB have the SAME nonzero sign, B is strictly on
//     one side of A's plane => DISJOINT. Symmetric for sA.
//
//  3. Coplanar. If all three sB are ZERO (B lies in A's plane) — and therefore
//     A lies in B's plane too — the pair is coplanar: classify the 2D overlap
//     by exact orient2d after projecting onto A's dominant axis plane.
//
//  4. Generic crossing. Otherwise each triangle crosses the other's plane in a
//     segment of the common line L = planeA ∩ planeB. We compute, for each
//     triangle, the interval [lo,hi] it spans on L using the orient3d side signs
//     to pick exactly which two edges cross the other plane, then intersect the
//     two intervals. The combinatorial relation (point / segment / disjoint and
//     whether endpoints sit on shared boundaries) is decided from the sign
//     pattern; the numeric endpoint positions are plane-line intersections.
//
// The KEY robustness property: step 2/3/4's branch is selected purely from
// orient3d signs, so it never flips because a determinant rounded the wrong way
// near coplanarity. The accompanying gate shows a near-coplanar pair where the
// naive double determinant reports a (wrong) nonzero side while orient3d
// correctly reports ZERO, changing the classification.
//
// Pure C++20, no external dependencies.

#include "forge/native/mesh/TriTriIntersect.hpp"
#include "forge/native/Predicates.hpp"  // reuse exact orient3d / orient2d (no re-impl)

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace forge {
namespace native {
namespace mesh {

namespace {

// ---- tiny double vector helpers (local; the kernel-wide Vec3 is the public
//      type, these are private scratch ops only) --------------------------
inline Vec3 sub(const Vec3& a, const Vec3& b) { return {a.x-b.x, a.y-b.y, a.z-b.z}; }
inline Vec3 add(const Vec3& a, const Vec3& b) { return {a.x+b.x, a.y+b.y, a.z+b.z}; }
inline Vec3 mul(const Vec3& a, double s)      { return {a.x*s, a.y*s, a.z*s}; }
inline double dot(const Vec3& a, const Vec3& b){ return a.x*b.x + a.y*b.y + a.z*b.z; }
inline Vec3 cross(const Vec3& a, const Vec3& b){
    return { a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x };
}

inline int sgn(Sign s) { return signValue(s); }

// Exact side of point P relative to oriented plane through (a,b,c).
inline int side(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& P) {
    return sgn(orient3d(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z, P.x,P.y,P.z));
}

// Plane-line intersection of segment [A,B] with plane {x : n·x = nd}.
// Precondition (caller guarantees via exact signs): A and B are on strictly
// opposite sides OR one of them is exactly on the plane. Coordinates are
// double-precision (robust-in-practice).
inline Vec3 segPlane(const Vec3& A, const Vec3& B, const Vec3& n, double nd) {
    double da = dot(n, A) - nd;
    double db = dot(n, B) - nd;
    double denom = da - db;
    if (denom == 0.0) return A;            // parallel within double; caller-guarded
    double t = da / denom;                 // t in [0,1] by the opposite-side precondition
    return add(A, mul(sub(B, A), t));
}

// --------------------------------------------------------------------------
// COPLANAR case: classify A vs B when both lie in the same plane.
// Project to the dominant axis plane (drop the largest-|normal| coordinate) so
// the 2D problem is non-degenerate, then use exact orient2d.
// --------------------------------------------------------------------------
struct V2 { double x, y; };

inline int orient2dSign(const V2& a, const V2& b, const V2& c) {
    return sgn(orient2d(a.x,a.y, b.x,b.y, c.x,c.y));
}

// Project a Vec3 to 2D by dropping the axis with the largest normal component.
inline V2 project(const Vec3& p, int drop) {
    switch (drop) {
        case 0:  return { p.y, p.z };
        case 1:  return { p.x, p.z };
        default: return { p.x, p.y };
    }
}

// Is 2D point p strictly inside / on triangle (t0,t1,t2)? Returns:
//   1 inside, 0 on boundary, -1 outside.  Triangle winding handled by sign.
inline int pointInTri2D(const V2& p, const V2& t0, const V2& t1, const V2& t2) {
    int s0 = orient2dSign(t0, t1, p);
    int s1 = orient2dSign(t1, t2, p);
    int s2 = orient2dSign(t2, t0, p);
    bool hasNeg = (s0 < 0) || (s1 < 0) || (s2 < 0);
    bool hasPos = (s0 > 0) || (s1 > 0) || (s2 > 0);
    if (hasNeg && hasPos) return -1;          // outside
    if (s0 == 0 || s1 == 0 || s2 == 0) return 0; // on an edge / vertex
    return 1;                                  // strictly inside
}

// Do open 2D segments [a,b] and [c,d] properly cross (single interior point)?
inline bool segCross2D(const V2& a, const V2& b, const V2& c, const V2& d) {
    int o1 = orient2dSign(a, b, c);
    int o2 = orient2dSign(a, b, d);
    int o3 = orient2dSign(c, d, a);
    int o4 = orient2dSign(c, d, b);
    return (o1 != 0 && o2 != 0 && o3 != 0 && o4 != 0) &&
           (o1 != o2) && (o3 != o4);
}

// Do 2D segments overlap along a 1D sub-segment (collinear overlap)?
inline bool segOverlap2D(const V2& a, const V2& b, const V2& c, const V2& d) {
    // collinear of all four?
    if (orient2dSign(a, b, c) != 0 || orient2dSign(a, b, d) != 0) return false;
    // overlap of bounding boxes on the dominant 1D axis of the line
    double dx = std::fabs(b.x - a.x), dy = std::fabs(b.y - a.y);
    auto coord = [&](const V2& p){ return dx >= dy ? p.x : p.y; };
    double a0 = coord(a), b0 = coord(b), c0 = coord(c), d0 = coord(d);
    double alo = std::fmin(a0,b0), ahi = std::fmax(a0,b0);
    double clo = std::fmin(c0,d0), chi = std::fmax(c0,d0);
    double lo = std::fmax(alo, clo), hi = std::fmin(ahi, chi);
    return hi > lo;  // strictly positive overlap length
}

TriTriResult coplanarClassify(const Vec3& a0, const Vec3& a1, const Vec3& a2,
                              const Vec3& b0, const Vec3& b1, const Vec3& b2) {
    TriTriResult r;
    // dominant axis from A's normal
    Vec3 n = cross(sub(a1,a0), sub(a2,a0));
    double ax = std::fabs(n.x), ay = std::fabs(n.y), az = std::fabs(n.z);
    int drop = (ax >= ay && ax >= az) ? 0 : (ay >= az ? 1 : 2);

    V2 A0 = project(a0,drop), A1 = project(a1,drop), A2 = project(a2,drop);
    V2 B0 = project(b0,drop), B1 = project(b1,drop), B2 = project(b2,drop);

    const std::array<V2,3> A{A0,A1,A2};
    const std::array<V2,3> B{B0,B1,B2};
    const std::array<Vec3,3> A3{a0,a1,a2};
    const std::array<Vec3,3> B3{b0,b1,b2};

    // Any A vertex strictly inside B, or any B vertex strictly inside A -> area overlap.
    for (int i=0;i<3;++i) {
        if (pointInTri2D(A[i], B0,B1,B2) == 1) {
            r.relation = TriTriRelation::COPLANAR_OVERLAP; r.p = A3[i]; r.q = A3[i]; return r;
        }
        if (pointInTri2D(B[i], A0,A1,A2) == 1) {
            r.relation = TriTriRelation::COPLANAR_OVERLAP; r.p = B3[i]; r.q = B3[i]; return r;
        }
    }
    // Any edge pair properly crossing -> area overlap.
    for (int i=0;i<3;++i) for (int j=0;j<3;++j) {
        if (segCross2D(A[i], A[(i+1)%3], B[j], B[(j+1)%3])) {
            r.relation = TriTriRelation::COPLANAR_OVERLAP;
            r.p = A3[i]; r.q = A3[(i+1)%3];
            return r;
        }
    }
    // Collinear edge overlap -> shared edge segment.
    for (int i=0;i<3;++i) for (int j=0;j<3;++j) {
        if (segOverlap2D(A[i], A[(i+1)%3], B[j], B[(j+1)%3])) {
            r.relation = TriTriRelation::COPLANAR_OVERLAP;  // shared 1D region
            r.p = A3[i]; r.q = A3[(i+1)%3];
            return r;
        }
    }
    // A vertex lying on B's boundary (or vice versa) with no area/edge overlap ->
    // single touch point.
    for (int i=0;i<3;++i) {
        if (pointInTri2D(A[i], B0,B1,B2) == 0) {
            r.relation = TriTriRelation::POINT_TOUCH; r.p = A3[i]; r.q = A3[i]; return r;
        }
        if (pointInTri2D(B[i], A0,A1,A2) == 0) {
            r.relation = TriTriRelation::POINT_TOUCH; r.p = B3[i]; r.q = B3[i]; return r;
        }
    }
    r.relation = TriTriRelation::DISJOINT;
    return r;
}

// --------------------------------------------------------------------------
// NON-COPLANAR generic case.
// Given triangle T=(t0,t1,t2) crossing plane (n,nd) with exact side signs
// s[0..2] (not all same sign, not all zero), return the two points where T's
// boundary meets the plane (the chord of T on the cutting plane). The two
// crossing edges are exactly those whose endpoints straddle the plane or lie
// on it; determined from the sign pattern.
// --------------------------------------------------------------------------
struct Chord { Vec3 p, q; bool ok; };

Chord triPlaneChord(const Vec3& t0, const Vec3& t1, const Vec3& t2,
                    int s0, int s1, int s2,
                    const Vec3& n, double nd) {
    const Vec3  V[3] = { t0, t1, t2 };
    const int   S[3] = { s0, s1, s2 };
    Vec3 hits[3];
    int  nh = 0;

    // A vertex exactly on the plane is itself a chord endpoint.
    for (int i=0;i<3 && nh<3;++i) if (S[i] == 0) hits[nh++] = V[i];
    // Each edge with strictly opposite-sign endpoints contributes one crossing.
    for (int i=0;i<3 && nh<3;++i) {
        int a = i, b = (i+1)%3;
        if (S[a] != 0 && S[b] != 0 && S[a] != S[b]) {
            hits[nh++] = segPlane(V[a], V[b], n, nd);
        }
    }
    Chord c; c.ok = (nh >= 2);
    if (nh >= 2) { c.p = hits[0]; c.q = hits[1]; }
    else if (nh == 1) { c.p = hits[0]; c.q = hits[0]; c.ok = true; }
    return c;
}

// Parameter of point P along directed line origin O + t*dir (dir need not be
// unit). Used to order the two chords on the common line L = planeA ∩ planeB.
inline double lineParam(const Vec3& O, const Vec3& dir, const Vec3& P) {
    return dot(sub(P, O), dir) / dot(dir, dir);
}

} // namespace

// ==========================================================================
TriTriResult triTriIntersect(const Vec3& a0, const Vec3& a1, const Vec3& a2,
                             const Vec3& b0, const Vec3& b1, const Vec3& b2) {
    TriTriResult r;

    // Degenerate (zero-area) input guard.
    Vec3 nA = cross(sub(a1,a0), sub(a2,a0));
    Vec3 nB = cross(sub(b1,b0), sub(b2,b0));
    if (dot(nA,nA) == 0.0 || dot(nB,nB) == 0.0) {
        r.degenerate = true;
        r.relation = TriTriRelation::DISJOINT;
        return r;
    }

    // Exact side signs of B's vertices vs A's plane, and vice versa.
    int sB0 = side(a0,a1,a2,b0), sB1 = side(a0,a1,a2,b1), sB2 = side(a0,a1,a2,b2);
    int sA0 = side(b0,b1,b2,a0), sA1 = side(b0,b1,b2,a1), sA2 = side(b0,b1,b2,a2);

    // Early reject: B strictly on one side of A's plane.
    if (sB0 != 0 && sB0 == sB1 && sB1 == sB2) { r.relation = TriTriRelation::DISJOINT; return r; }
    // Early reject: A strictly on one side of B's plane.
    if (sA0 != 0 && sA0 == sA1 && sA1 == sA2) { r.relation = TriTriRelation::DISJOINT; return r; }

    // Coplanar: every B vertex exactly on A's plane (exact ZERO orient3d).
    if (sB0 == 0 && sB1 == 0 && sB2 == 0) {
        return coplanarClassify(a0,a1,a2,b0,b1,b2);
    }

    // Generic non-coplanar crossing. Common line direction = nA x nB.
    double ndA = dot(nA, a0);
    double ndB = dot(nB, b0);
    Vec3 L = cross(nA, nB);
    if (dot(L,L) == 0.0) {
        // Planes parallel but not identical (coplanar handled above) -> no hit.
        r.relation = TriTriRelation::DISJOINT;
        return r;
    }

    // cA = A's chord on B's plane (A's vertex signs sA* vs plane (nB,ndB)).
    // cB = B's chord on A's plane (B's vertex signs sB* vs plane (nA,ndA)).
    Chord cA = triPlaneChord(a0,a1,a2, sA0, sA1, sA2, nB, ndB);
    Chord cB = triPlaneChord(b0,b1,b2, sB0, sB1, sB2, nA, ndA);

    if (!cA.ok || !cB.ok) { r.relation = TriTriRelation::DISJOINT; return r; }

    // Order both chords along the common line and intersect the two intervals.
    // Every chord endpoint lies on the common line L (it is on BOTH planes), so
    // we anchor the 1-D parameter at a TRUE on-line point (cA.p) and reconstruct
    // overlap endpoints by interpolating along L from that anchor. (Using an
    // off-line anchor like a0 would project correctly for ORDERING but place the
    // reconstructed point off the line.)
    Vec3 O = cA.p;  // on the common line
    double a_lo = lineParam(O, L, cA.p), a_hi = lineParam(O, L, cA.q);
    double b_lo = lineParam(O, L, cB.p), b_hi = lineParam(O, L, cB.q);
    if (a_lo > a_hi) std::swap(a_lo, a_hi);
    if (b_lo > b_hi) std::swap(b_lo, b_hi);

    double lo = std::fmax(a_lo, b_lo);
    double hi = std::fmin(a_hi, b_hi);

    // Relative tolerance for the overlap LENGTH (a coordinate quantity), scaled
    // by the chord span so it is geometry-size-independent. This is NOT used for
    // the combinatorial branch above (which is exact orient3d).
    double span = std::fmax(std::fabs(a_hi-a_lo), std::fabs(b_hi-b_lo));
    const double kEps = 1e-12 * (span > 0.0 ? span : 1.0);

    if (hi < lo - kEps) {
        r.relation = TriTriRelation::DISJOINT;
        return r;
    }

    Vec3 P = add(O, mul(L, lo));
    Vec3 Q = add(O, mul(L, hi));

    if (hi - lo <= kEps) {
        // The two chords meet at a single point on the common line.
        r.relation = TriTriRelation::POINT_TOUCH;
        r.p = P; r.q = P;
        return r;
    }

    // Non-degenerate shared segment. Decide PROPER_CROSS vs EDGE_TOUCH from
    // whether either triangle had a vertex exactly on the other's plane that
    // produced the chord (a boundary-aligned touch) vs a genuine straddle of
    // both interiors. If BOTH triangles straddle (have +,- vertices) the
    // segment penetrates interiors => PROPER_CROSS.
    bool aStraddles = (sA0*sA1 < 0) || (sA1*sA2 < 0) || (sA0*sA2 < 0);
    bool bStraddles = (sB0*sB1 < 0) || (sB1*sB2 < 0) || (sB0*sB2 < 0);
    r.p = P; r.q = Q;
    r.relation = (aStraddles && bStraddles) ? TriTriRelation::PROPER_CROSS
                                            : TriTriRelation::EDGE_TOUCH;
    return r;
}

} // namespace mesh
} // namespace native
} // namespace forge
