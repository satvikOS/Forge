// forge/native/ExactPredicates3D.cpp
//
// Implementation of the exact 3D predicates + exact constructions (see
// ExactPredicates3D.hpp for the contract + audit citation). Pure C++20, builds
// only on ExactReal. Every algebraic identity below is the textbook determinant /
// line-plane formula, evaluated through ExactReal so it is exact and consistent.

#include "forge/native/ExactPredicates3D.hpp"

namespace forge {
namespace native {

namespace {

using R = ExactReal;

// 3x3 determinant of the matrix whose rows are (a,b,c), exact.
//   | a0 a1 a2 |
//   | b0 b1 b2 |
//   | c0 c1 c2 |
inline R det3(const R& a0, const R& a1, const R& a2,
              const R& b0, const R& b1, const R& b2,
              const R& c0, const R& c1, const R& c2) {
    return a0 * (b1 * c2 - b2 * c1)
         - a1 * (b0 * c2 - b2 * c0)
         + a2 * (b0 * c1 - b1 * c0);
}

} // namespace

int exactOrient3D(const ExactPoint3& a, const ExactPoint3& b,
                  const ExactPoint3& c, const ExactPoint3& d) {
    // det of (a-d, b-d, c-d). Sign convention identical to Predicates.hpp orient3d.
    R adx = a.x - d.x, ady = a.y - d.y, adz = a.z - d.z;
    R bdx = b.x - d.x, bdy = b.y - d.y, bdz = b.z - d.z;
    R cdx = c.x - d.x, cdy = c.y - d.y, cdz = c.z - d.z;
    R det = det3(adx, ady, adz, bdx, bdy, bdz, cdx, cdy, cdz);
    return det.sign();
}

int exactOrient3D(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d) {
    return exactOrient3D(ExactPoint3(a), ExactPoint3(b), ExactPoint3(c), ExactPoint3(d));
}

int exactInSphere(const ExactPoint3& a, const ExactPoint3& b, const ExactPoint3& c,
                  const ExactPoint3& d, const ExactPoint3& e) {
    // Standard lifted 4x4 determinant relative to e (matches insphere convention).
    R aex = a.x - e.x, aey = a.y - e.y, aez = a.z - e.z;
    R bex = b.x - e.x, bey = b.y - e.y, bez = b.z - e.z;
    R cex = c.x - e.x, cey = c.y - e.y, cez = c.z - e.z;
    R dex = d.x - e.x, dey = d.y - e.y, dez = d.z - e.z;
    R alift = aex * aex + aey * aey + aez * aez;
    R blift = bex * bex + bey * bey + bez * bez;
    R clift = cex * cex + cey * cey + cez * cez;
    R dlift = dex * dex + dey * dey + dez * dez;
    // 4x4 determinant expanded along the lift column.
    R m0 = det3(bey, bez, blift, cey, cez, clift, dey, dez, dlift);
    R m1 = det3(aey, aez, alift, cey, cez, clift, dey, dez, dlift);
    R m2 = det3(aey, aez, alift, bey, bez, blift, dey, dez, dlift);
    R m3 = det3(aey, aez, alift, bey, bez, blift, cey, cez, clift);
    R det = aex * m0 - bex * m1 + cex * m2 - dex * m3;
    return det.sign();
}

ExactPoint3 exactEdgePlaneIntersection(const ExactPoint3& P0, const ExactPoint3& P1,
                                       const ExactPoint3& Q0, const ExactPoint3& Q1,
                                       const ExactPoint3& Q2, bool& ok) {
    // Plane normal n = (Q1-Q0) x (Q2-Q0); plane: n . (X - Q0) = 0.
    R ux = Q1.x - Q0.x, uy = Q1.y - Q0.y, uz = Q1.z - Q0.z;
    R vx = Q2.x - Q0.x, vy = Q2.y - Q0.y, vz = Q2.z - Q0.z;
    R nx = uy * vz - uz * vy;
    R ny = uz * vx - ux * vz;
    R nz = ux * vy - uy * vx;
    // f(P) = n . (P - Q0). Solve P0 + t(P1-P0) on the plane: t = f(P0)/(f(P0)-f(P1)).
    R f0 = nx * (P0.x - Q0.x) + ny * (P0.y - Q0.y) + nz * (P0.z - Q0.z);
    R f1 = nx * (P1.x - Q0.x) + ny * (P1.y - Q0.y) + nz * (P1.z - Q0.z);
    R denom = f0 - f1;
    if (denom.sign() == 0) { ok = false; return P0; }  // segment parallel to plane
    ok = true;
    R t = f0 / denom;
    R dx = P1.x - P0.x, dy = P1.y - P0.y, dz = P1.z - P0.z;
    return ExactPoint3(P0.x + t * dx, P0.y + t * dy, P0.z + t * dz);
}

ExactPoint3 exactSegmentSegmentIntersection(const ExactPoint3& A0, const ExactPoint3& A1,
                                            const ExactPoint3& B0, const ExactPoint3& B1,
                                            bool& ok) {
    // Coplanar lines: A0 + s*(A1-A0) = B0 + u*(B1-B0). Solve in the dominant 2D
    // projection of the shared plane. We choose the projection axis-pair that
    // maximises the (exact) cross-product magnitude component so the 2D system is
    // non-degenerate; the sign of each candidate is exact, so the choice is
    // deterministic. We pick the first axis-pair whose 2x2 system determinant is
    // nonzero, tested in a fixed order (xy, yz, zx).
    R dax = A1.x - A0.x, day = A1.y - A0.y, daz = A1.z - A0.z;
    R dbx = B1.x - B0.x, dby = B1.y - B0.y, dbz = B1.z - B0.z;
    // Try each projection: solve [ da  -db ] [s u]^T = (B0 - A0) in that plane.
    struct Axis { const R* a1; const R* a2; const R* b1; const R* b2;
                  const R* r1; const R* r2; };
    R rx = B0.x - A0.x, ry = B0.y - A0.y, rz = B0.z - A0.z;
    const R* das[3] = { &dax, &day, &daz };
    const R* dbs[3] = { &dbx, &dby, &dbz };
    const R* rs[3]  = { &rx,  &ry,  &rz  };
    const int pairs[3][2] = { {0,1}, {1,2}, {2,0} };
    for (int k = 0; k < 3; ++k) {
        int i = pairs[k][0], j = pairs[k][1];
        // [ da_i  -db_i ] [s]   [r_i]
        // [ da_j  -db_j ] [u] = [r_j]
        R D = (*das[i]) * (-(*dbs[j])) - (-(*dbs[i])) * (*das[j]);
        if (D.sign() == 0) continue;
        R s = ((*rs[i]) * (-(*dbs[j])) - (-(*dbs[i])) * (*rs[j])) / D;
        ok = true;
        return ExactPoint3(A0.x + s * dax, A0.y + s * day, A0.z + s * daz);
    }
    ok = false;
    return A0;
}

PointTriPos exactPointInTriangle(const ExactPoint3& p,
                                 const ExactPoint3& Q0, const ExactPoint3& Q1,
                                 const ExactPoint3& Q2) {
    // Coincident with a vertex?
    if (p.equals(Q0) || p.equals(Q1) || p.equals(Q2)) return PointTriPos::ON_VERTEX;
    // Three signed volumes orient3d(edge_i, edge_{i+1}, p_lifted) collapse, in the
    // triangle's plane, to consistent same-sign barycentric tests. We use a 4th
    // reference point off the plane so each orient3d is well-defined; the apex is
    // the triangle's plane normal tip, exact.
    R ux = Q1.x - Q0.x, uy = Q1.y - Q0.y, uz = Q1.z - Q0.z;
    R vx = Q2.x - Q0.x, vy = Q2.y - Q0.y, vz = Q2.z - Q0.z;
    R nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    ExactPoint3 apex(Q0.x + nx, Q0.y + ny, Q0.z + nz);
    int s0 = exactOrient3D(Q0, Q1, apex, p);
    int s1 = exactOrient3D(Q1, Q2, apex, p);
    int s2 = exactOrient3D(Q2, Q0, apex, p);
    int zeros = (s0 == 0) + (s1 == 0) + (s2 == 0);
    bool anyNeg = (s0 < 0) || (s1 < 0) || (s2 < 0);
    bool anyPos = (s0 > 0) || (s1 > 0) || (s2 > 0);
    if (anyNeg && anyPos) return PointTriPos::OUTSIDE;
    if (zeros >= 1)        return PointTriPos::ON_EDGE;     // on a boundary edge
    return PointTriPos::INSIDE;
}

SegTriResult segmentTriangleClassify(const ExactPoint3& P0, const ExactPoint3& P1,
                                     const ExactPoint3& Q0, const ExactPoint3& Q1,
                                     const ExactPoint3& Q2) {
    SegTriResult res;
    int s0 = exactOrient3D(Q0, Q1, Q2, P0);
    int s1 = exactOrient3D(Q0, Q1, Q2, P1);
    if (s0 == 0 && s1 == 0) {   // segment lies in the triangle plane
        res.coplanar = true;
        res.intersects = true;  // conservative; the boolean handles coplanar separately
        return res;
    }
    if (s0 != 0 && s1 != 0 && s0 == s1) {
        res.intersects = false; // both endpoints strictly on the same side: no cross
        return res;
    }
    // Endpoints straddle (or one is on the plane): construct the pierce point.
    bool ok = false;
    ExactPoint3 X = exactEdgePlaneIntersection(P0, P1, Q0, Q1, Q2, ok);
    if (!ok) { res.intersects = false; return res; }
    PointTriPos pos = exactPointInTriangle(X, Q0, Q1, Q2);
    if (pos == PointTriPos::OUTSIDE) { res.intersects = false; return res; }
    res.intersects = true;
    res.crosses = (pos == PointTriPos::INSIDE);
    res.point = X;
    return res;
}

} // namespace native
} // namespace forge
