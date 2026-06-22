// forge/native/composites/Composites.cpp
//
// Implementation of forge::native::composites — see Composites.hpp for the WHY.
// Pure C++20 + stdlib. SI units (Pa, m, rad). No OCCT / Eigen / WASM / third-party.

#include "forge/native/composites/Composites.hpp"

#include <cmath>
#include <algorithm>
#include <limits>
#include <array>
#include <vector>
#include <cstddef>
#include <cstdint>
#include <functional>

namespace forge {
namespace native {
namespace composites {

// ---------------------------------------------------------------------------
// Local vector helpers.
// ---------------------------------------------------------------------------
double dot3(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
Vec3   sub3(const Vec3& a, const Vec3& b) { return { a.x - b.x, a.y - b.y, a.z - b.z }; }
double norm3(const Vec3& a) { return std::sqrt(dot3(a, a)); }

static Vec3 scale3(const Vec3& a, double s) { return { a.x * s, a.y * s, a.z * s }; }
static Vec3 normalize3(const Vec3& a) {
    const double n = norm3(a);
    if (n < 1e-300) return { 0, 0, 0 };
    return scale3(a, 1.0 / n);
}

// ===========================================================================
// (B) CLT — plane-stress lamina.
// ===========================================================================

std::array<double, 9> Qbar::as3x3() const {
    return { Q11, Q12, Q16,
             Q12, Q22, Q26,
             Q16, Q26, Q66 };
}

ReducedStiffness reducedStiffness(const materials::OrthoConstants& c) {
    const double E1   = c.E1.mean;
    const double E2   = c.E2.mean;
    const double G12  = c.G12.mean;
    const double nu12 = c.nu12.mean;
    ReducedStiffness Q;
    if (E1 <= 0.0 || E2 <= 0.0) {     // degenerate lamina -> zero Q (CLT will reject)
        return Q;
    }
    const double nu21 = nu12 * E2 / E1;
    const double den  = 1.0 - nu12 * nu21;
    if (std::fabs(den) < 1e-300) return Q;
    Q.Q11 = E1 / den;
    Q.Q22 = E2 / den;
    Q.Q12 = nu12 * E2 / den;
    Q.Q66 = G12;
    return Q;
}

Qbar rotatedQ(const ReducedStiffness& Q, double thetaRad) {
    const double c = std::cos(thetaRad);
    const double s = std::sin(thetaRad);
    const double c2 = c * c, s2 = s * s;
    const double c3 = c2 * c, s3 = s2 * s;
    const double c4 = c2 * c2, s4 = s2 * s2, c2s2 = c2 * s2;
    const double Q11 = Q.Q11, Q22 = Q.Q22, Q12 = Q.Q12, Q66 = Q.Q66;

    Qbar qb;
    qb.Q11 = Q11 * c4 + 2.0 * (Q12 + 2.0 * Q66) * c2s2 + Q22 * s4;
    qb.Q22 = Q11 * s4 + 2.0 * (Q12 + 2.0 * Q66) * c2s2 + Q22 * c4;
    qb.Q12 = (Q11 + Q22 - 4.0 * Q66) * c2s2 + Q12 * (c4 + s4);
    qb.Q66 = (Q11 + Q22 - 2.0 * Q12 - 2.0 * Q66) * c2s2 + Q66 * (c4 + s4);
    qb.Q16 = (Q11 - Q12 - 2.0 * Q66) * c3 * s - (Q22 - Q12 - 2.0 * Q66) * s3 * c;
    qb.Q26 = (Q11 - Q12 - 2.0 * Q66) * c * s3 - (Q22 - Q12 - 2.0 * Q66) * s * c3;
    return qb;
}

// ---------------------------------------------------------------------------
// Laminate.
// ---------------------------------------------------------------------------
double Laminate::totalThickness() const {
    double t = 0.0;
    for (const Ply& p : plies) t += p.thickness;
    return t;
}

// Two laminae have the "same material" (for symmetry/balance) iff their reduced Q
// matches to a relative tolerance — robust to OrthoConstants coming from different
// sources but the same handbook lamina.
static bool sameMaterial(const materials::OrthoConstants& a,
                         const materials::OrthoConstants& b) {
    const ReducedStiffness qa = reducedStiffness(a);
    const ReducedStiffness qb = reducedStiffness(b);
    const double scale = std::max({ std::fabs(qa.Q11), std::fabs(qb.Q11), 1.0 });
    const double rt = 1e-9 * scale;
    return std::fabs(qa.Q11 - qb.Q11) < rt && std::fabs(qa.Q22 - qb.Q22) < rt &&
           std::fabs(qa.Q12 - qb.Q12) < rt && std::fabs(qa.Q66 - qb.Q66) < rt;
}

bool isSymmetric(const Laminate& lam, double tolDeg, double tolT) {
    const std::size_t N = lam.plies.size();
    if (N == 0) return false;
    const double tolRad = tolDeg * M_PI / 180.0;
    for (std::size_t k = 0; k < N / 2; ++k) {
        const Ply& a = lam.plies[k];
        const Ply& b = lam.plies[N - 1 - k];
        if (!sameMaterial(a.material, b.material)) return false;
        if (std::fabs(a.angle - b.angle) > tolRad) return false;
        if (std::fabs(a.thickness - b.thickness) > tolT) return false;
    }
    return true;
}

bool isBalanced(const Laminate& lam, double tolDeg) {
    if (lam.plies.empty()) return false;
    const double tolRad = tolDeg * M_PI / 180.0;
    // For every off-axis ply (not 0 / +-90), the summed +theta thickness must match
    // the summed -theta thickness (same |angle| & material bucket).
    struct Bucket { double absAngle; materials::OrthoConstants mat; double pos; double neg; };
    std::vector<Bucket> buckets;
    for (const Ply& p : lam.plies) {
        const double a = p.angle;
        const double aa = std::fabs(a);
        // skip 0 and +-90 (their own mirrors)
        if (aa < tolRad) continue;
        if (std::fabs(aa - M_PI / 2.0) < tolRad) continue;
        Bucket* found = nullptr;
        for (Bucket& bk : buckets) {
            if (std::fabs(bk.absAngle - aa) < tolRad && sameMaterial(bk.mat, p.material)) {
                found = &bk; break;
            }
        }
        if (!found) {
            buckets.push_back(Bucket{ aa, p.material, 0.0, 0.0 });
            found = &buckets.back();
        }
        if (a > 0.0) found->pos += p.thickness;
        else         found->neg += p.thickness;
    }
    for (const Bucket& bk : buckets) {
        if (std::fabs(bk.pos - bk.neg) > 1e-9) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// 3x3 inverse (Gauss-Jordan with partial pivot) — mirrors the materials::invert6
// pattern specialized to 3x3. Returns false on singular.
// ---------------------------------------------------------------------------
static bool invert3(const Mat3& A, Mat3& out) {
    double m[3][6];
    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) m[i][j] = A.at(i, j);
        for (int j = 0; j < 3; ++j) m[i][3 + j] = (i == j) ? 1.0 : 0.0;
    }
    for (int col = 0; col < 3; ++col) {
        int piv = col;
        double best = std::fabs(m[col][col]);
        for (int r = col + 1; r < 3; ++r) {
            if (std::fabs(m[r][col]) > best) { best = std::fabs(m[r][col]); piv = r; }
        }
        if (best < 1e-300) return false;
        if (piv != col) for (int j = 0; j < 6; ++j) std::swap(m[col][j], m[piv][j]);
        const double d = m[col][col];
        for (int j = 0; j < 6; ++j) m[col][j] /= d;
        for (int r = 0; r < 3; ++r) {
            if (r == col) continue;
            const double f = m[r][col];
            if (f == 0.0) continue;
            for (int j = 0; j < 6; ++j) m[r][j] -= f * m[col][j];
        }
    }
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) out.at(i, j) = m[i][3 + j];
    return true;
}

CltResult buildClt(const Laminate& lam) {
    CltResult r;
    const std::size_t N = lam.plies.size();
    if (N == 0) { r.ok = false; return r; }

    const double tTotal = lam.totalThickness();
    if (tTotal <= 0.0) { r.ok = false; return r; }

    // Validate every ply has a usable reduced Q.
    for (const Ply& p : lam.plies) {
        const ReducedStiffness Q = reducedStiffness(p.material);
        if (Q.Q11 <= 0.0 || Q.Q22 <= 0.0 || Q.Q66 <= 0.0 || p.thickness <= 0.0) {
            r.ok = false; return r;
        }
    }

    // ABD integration about the midplane: z from -tTotal/2 upward.
    double A[9] = {0}, B[9] = {0}, D[9] = {0};
    double z = -tTotal / 2.0;
    for (const Ply& p : lam.plies) {
        const ReducedStiffness Q = reducedStiffness(p.material);
        const Qbar qb = rotatedQ(Q, p.angle);
        const std::array<double, 9> q = qb.as3x3();
        const double zk0 = z;
        const double zk1 = z + p.thickness;
        const double dz1 = (zk1 - zk0);
        const double dz2 = (zk1 * zk1 - zk0 * zk0) / 2.0;
        const double dz3 = (zk1 * zk1 * zk1 - zk0 * zk0 * zk0) / 3.0;
        for (int i = 0; i < 9; ++i) {
            A[i] += q[i] * dz1;
            B[i] += q[i] * dz2;
            D[i] += q[i] * dz3;
        }
        z = zk1;
    }

    // Clean eps-noise so symmetric/balanced stacks read as clean zeros. Scale by the
    // dominant in-plane magnitude (A11-ish) so the threshold is relative.
    const double aScale = std::max({ std::fabs(A[0]), std::fabs(A[4]), std::fabs(A[8]), 1.0 });
    const double cleanA = 1e-9 * aScale;
    const double cleanB = 1e-9 * aScale * tTotal;          // B ~ A*length
    const double cleanD = 1e-9 * aScale * tTotal * tTotal; // D ~ A*length^2
    auto cleaner = [](double* M, double thr) {
        for (int i = 0; i < 9; ++i) if (std::fabs(M[i]) < thr) M[i] = 0.0;
    };
    cleaner(A, cleanA);
    cleaner(B, cleanB);
    cleaner(D, cleanD);

    for (int i = 0; i < 9; ++i) { r.A.a[i] = A[i]; r.B.a[i] = B[i]; r.D.a[i] = D[i]; }

    // Verdicts.
    double Bmax = 0.0;
    for (int i = 0; i < 9; ++i) Bmax = std::max(Bmax, std::fabs(B[i]));
    r.symmetric = (Bmax < cleanB) || (Bmax == 0.0);
    r.balanced  = (std::fabs(A[2]) < cleanA) && (std::fabs(A[5]) < cleanA);  // A16, A26

    // Effective membrane laminate constants from the in-plane compliance of A.
    //   a = (A / tTotal)^-1 ; Ex = 1/a11, Ey = 1/a22, Gxy = 1/a33, nuxy = -a12/a11.
    Mat3 An;
    for (int i = 0; i < 9; ++i) An.a[i] = A[i] / tTotal;
    Mat3 aInv;
    if (invert3(An, aInv)) {
        const double a11 = aInv.at(0, 0), a22 = aInv.at(1, 1), a33 = aInv.at(2, 2);
        const double a12 = aInv.at(0, 1);
        r.Ex   = (std::fabs(a11) > 1e-300) ? 1.0 / a11 : 0.0;
        r.Ey   = (std::fabs(a22) > 1e-300) ? 1.0 / a22 : 0.0;
        r.Gxy  = (std::fabs(a33) > 1e-300) ? 1.0 / a33 : 0.0;
        r.nuxy = (std::fabs(a11) > 1e-300) ? -a12 / a11 : 0.0;
        r.ok = true;
    } else {
        r.ok = false;
    }
    return r;
}

// ===========================================================================
// (C) KINEMATIC DRAPING — pin-jointed-net / fishnet.
// ===========================================================================
//
// The net is laid down from a seed node S(u0,v0). Two generator lines (warp & weft)
// are marched out from the seed as constant-arc-length geodesic-ish steps of the
// cell pitch d. Each interior node is the two-circle intersection on the surface of
// radius d about its already-placed (i-1,j) and (i,j-1) neighbours. Shear at a node
// = pi/2 - angle(warp edge, weft edge). Wrinkle iff |shear| > lockingAngle.

namespace {

struct SurfPoint { Vec2 uv; Vec3 xyz; bool ok; };

// Surface tangents by central finite difference in (u,v).
static void surfTangents(const ToolSurface& tool, double u, double v,
                         Vec3& Su, Vec3& Sv) {
    const double du = std::max(1e-6, 1e-4 * (tool.u1 - tool.u0));
    const double dv = std::max(1e-6, 1e-4 * (tool.v1 - tool.v0));
    const Vec3 pu1 = tool.S(u + du, v), pu0 = tool.S(u - du, v);
    const Vec3 pv1 = tool.S(u, v + dv), pv0 = tool.S(u, v - dv);
    Su = scale3(sub3(pu1, pu0), 1.0 / (2.0 * du));
    Sv = scale3(sub3(pv1, pv0), 1.0 / (2.0 * dv));
}

static double clampd(double x, double lo, double hi) {
    return std::min(std::max(x, lo), hi);
}

// Generator-line march: walk along a FIXED param-space ray from the anchor's param
// (u0,v0) and find the scalar t >= 0 placing the surface point at CHORD distance d
// from `p`. The param-direction (pdu,pdv) is pre-scaled so unit t ~ unit arc length,
// so g(t) = |S(u0+t*pdu, v0+t*pdv) - p| is monotone increasing for small t with
// g(0)=0 -> a 1D root of g(t)-d that bisection/Newton always finds. This is the
// robust, constraint-free generator step (the perpendicular-constraint 2D Newton was
// fragile near corners / high curvature). The fixed param direction IS the geodesic-
// ish constant-direction generator line of the fishnet.
static SurfPoint marchRay(const ToolSurface& tool, const Vec3& p,
                          double u0, double v0, double pdu, double pdv,
                          double d, int maxIt, double acceptBand) {
    auto at = [&](double t) {
        const double u = clampd(u0 + t * pdu, tool.u0, tool.u1);
        const double v = clampd(v0 + t * pdv, tool.v0, tool.v1);
        return tool.S(u, v);
    };
    auto g = [&](double t) { return norm3(sub3(at(t), p)) - d; };

    // Bracket: t=0 gives g<=0 (distance ~0 <= d). Grow tHi until g>0 or we run off.
    double tLo = 0.0, tHi = 1.0;
    double gHi = g(tHi);
    int grow = 0;
    while (gHi < 0.0 && grow < 80) { tHi *= 1.5; gHi = g(tHi); ++grow; }
    if (gHi < 0.0) {
        // never reached distance d (ran off the param domain) -> ply edge.
        const Vec3 S = at(tHi);
        return { { clampd(u0 + tHi * pdu, tool.u0, tool.u1),
                   clampd(v0 + tHi * pdv, tool.v0, tool.v1) }, S, false };
    }
    // Bisection (monotone near the anchor; robust even if not globally monotone).
    for (int it = 0; it < maxIt; ++it) {
        const double tMid = 0.5 * (tLo + tHi);
        const double gMid = g(tMid);
        if (std::fabs(gMid) < acceptBand) {
            const double u = clampd(u0 + tMid * pdu, tool.u0, tool.u1);
            const double v = clampd(v0 + tMid * pdv, tool.v0, tool.v1);
            return { { u, v }, tool.S(u, v), true };
        }
        if (gMid < 0.0) tLo = tMid; else tHi = tMid;
    }
    const double tMid = 0.5 * (tLo + tHi);
    const double u = clampd(u0 + tMid * pdu, tool.u0, tool.u1);
    const double v = clampd(v0 + tMid * pdv, tool.v0, tool.v1);
    const Vec3 S = tool.S(u, v);
    return { { u, v }, S, std::fabs(norm3(sub3(S, p)) - d) < acceptBand };
}

} // namespace

DrapeResult drape(const ToolSurface& tool, const DrapeParams& params) {
    DrapeResult res;
    const int nu = std::max(2, params.nu);
    const int nv = std::max(2, params.nv);
    res.nu = nu; res.nv = nv;
    const std::size_t Nn = std::size_t(nu) * nv;

    if (!tool.S) { res.ok = false; res.note = "no tool surface"; return res; }

    // Cell pitch: size the net so it FITS INSIDE the param patch with headroom. The
    // march enforces a constant CHORD distance d in R^3 (Euclidean, via Newton); on
    // a curved tool the chord is shorter than the arc and the trellis shear drifts
    // interior nodes further across the patch, so a net sized to the exact arc span
    // would run off the domain edge. A coverage factor < 1 leaves that headroom (the
    // net is a fabric property sized to the patch, not pinned to the exact arc).
    Vec3 Su0, Sv0; surfTangents(tool, clampd(params.origin.u, tool.u0, tool.u1),
                                clampd(params.origin.v, tool.v0, tool.v1), Su0, Sv0);
    const double lenU = norm3(Su0) * (tool.u1 - tool.u0);
    const double lenV = norm3(Sv0) * (tool.v1 - tool.v0);
    const double coverage = 0.8;   // net spans ~80% of the estimated arc -> domain headroom
    // pitch so (nu-1) warp cells span ~coverage*the warp extent and (nv-1) the weft.
    const double dWarp = (lenU > 1e-300) ? coverage * lenU / double(nu - 1) : 1.0;
    const double dWeft = (lenV > 1e-300) ? coverage * lenV / double(nv - 1) : 1.0;
    const double d = 0.5 * (dWarp + dWeft);   // single isotropic pitch (square net)

    res.nodes.assign(Nn, DrapeNode{});
    std::vector<char> placed(Nn, 0);
    auto idx = [&](int i, int j) { return std::size_t(i) + std::size_t(nu) * j; };

    const int newtIt = 200;
    // Converge the geometric residual to a tiny fraction of the cell pitch. This is
    // far tighter than needed for the shear-angle field (which only needs the node
    // POSITIONS), but keeps the inextensibility constraint crisp.
    const double newtTol = 1e-10 * d;
    // Acceptance is TIGHT (1e-9*d) so a developable/flat region reads as clean ~0
    // shear; the damped line-search drives the interior Gauss-Newton there reliably.
    const double acceptBand = 1e-9 * d;
    const int bisIt = 80;   // bisection iterations (>= 50 digits of t)
    bool allOk = true;

    // The seed's grid index: place it where params.origin falls in the domain so a
    // CORNER origin nets one quadrant (as before) and a CENTRE origin nets a centred
    // fishnet that marches out into all four quadrants (the canonical dome layup,
    // shear growing radially from the seed). Clamp to [0, n-1].
    const double su = (tool.u1 > tool.u0)
        ? (clampd(params.origin.u, tool.u0, tool.u1) - tool.u0) / (tool.u1 - tool.u0) : 0.0;
    const double sv = (tool.v1 > tool.v0)
        ? (clampd(params.origin.v, tool.v0, tool.v1) - tool.v0) / (tool.v1 - tool.v0) : 0.0;
    const int ci = std::min(std::max(int(std::lround(su * (nu - 1))), 0), nu - 1);
    const int cj = std::min(std::max(int(std::lround(sv * (nv - 1))), 0), nv - 1);

    // Initial in-plane param directions for the warp / weft marches.
    const Vec2 warpDir{ std::cos(params.warpDirRad), std::sin(params.warpDirRad) };
    const Vec2 weftDir{ std::cos(params.weftDirRad), std::sin(params.weftDirRad) };

    // Map a tangent-plane direction (in the local (Su,Sv) basis) to a param-space ray
    // direction scaled so unit t ~ unit arc length (pdu = dir.u/|Su|, pdv = dir.v/|Sv|).
    auto paramDir = [&](double u, double v, const Vec2& tdir) {
        Vec3 Su, Sv; surfTangents(tool, u, v, Su, Sv);
        const double nu_ = std::max(norm3(Su), 1e-12);
        const double nv_ = std::max(norm3(Sv), 1e-12);
        return Vec2{ tdir.u / nu_, tdir.v / nv_ };
    };

    // --- Seed at (ci,cj) ---
    {
        const double u0 = clampd(params.origin.u, tool.u0, tool.u1);
        const double v0 = clampd(params.origin.v, tool.v0, tool.v1);
        DrapeNode& n = res.nodes[idx(ci, cj)];
        n.uv = { u0, v0 };
        n.xyz = tool.S(u0, v0);
        placed[idx(ci, cj)] = 1;
    }

    // Generator march of the seed's two axes (warp along i, weft along j), in BOTH
    // directions from the seed. `sign` = +1 marches toward higher index, -1 lower.
    auto marchAxis = [&](bool alongWarp, int sign) {
        const int n = alongWarp ? nu : nv;
        const int start = alongWarp ? ci : cj;
        const Vec2 tdir0 = alongWarp ? warpDir : weftDir;
        for (int step = 1; ; ++step) {
            const int k = start + sign * step;
            if (k < 0 || k >= n) break;
            const int pi = alongWarp ? (k - sign) : ci;
            const int pj = alongWarp ? cj : (k - sign);
            const DrapeNode& prev = res.nodes[idx(pi, pj)];
            // march in the +/- tangent direction
            const Vec2 tdir{ sign * tdir0.u, sign * tdir0.v };
            const Vec2 pdir = paramDir(prev.uv.u, prev.uv.v, tdir);
            SurfPoint sp = marchRay(tool, prev.xyz, prev.uv.u, prev.uv.v,
                                    pdir.u, pdir.v, d, bisIt, acceptBand);
            const int ni = alongWarp ? k : ci;
            const int nj = alongWarp ? cj : k;
            if (!sp.ok) { allOk = false; return; }
            DrapeNode& n2 = res.nodes[idx(ni, nj)];
            n2.uv = sp.uv; n2.xyz = sp.xyz; placed[idx(ni, nj)] = 1;
        }
    };
    marchAxis(true,  +1); marchAxis(true,  -1);   // warp axis both ways
    marchAxis(false, +1); marchAxis(false, -1);   // weft axis both ways

    // --- Interior fill: two-circle-on-surface intersection ---
    // A node P(i,j) is distance d from its two already-placed neighbours toward the
    // seed (the cell's warp & weft anchors). Solve the 2D root |S-Pa|=|S-Pb|=d by a
    // damped Gauss-Newton (line-search keeps it stable under high curvature). The
    // anchors are the neighbours one step CLOSER to the seed on each axis.
    auto solveNode = [&](int i, int j) {
        const int ai = (i > ci) ? i - 1 : (i < ci ? i + 1 : i);   // warp anchor toward seed
        const int bj = (j > cj) ? j - 1 : (j < cj ? j + 1 : j);   // weft anchor toward seed
        const std::size_t cA = idx(ai, j), cB = idx(i, bj), cD = idx(ai, bj);
        if (!placed[cA] || !placed[cB] || !placed[cD]) return false;
        const Vec3 Pa = res.nodes[cA].xyz;   // warp neighbour (toward seed in i)
        const Vec3 Pb = res.nodes[cB].xyz;   // weft neighbour (toward seed in j)
        double u = clampd(res.nodes[cA].uv.u + res.nodes[cB].uv.u - res.nodes[cD].uv.u,
                          tool.u0, tool.u1);
        double v = clampd(res.nodes[cA].uv.v + res.nodes[cB].uv.v - res.nodes[cD].uv.v,
                          tool.v0, tool.v1);
        auto resNorm = [&](double uu, double vv) {
            const Vec3 S = tool.S(uu, vv);
            const double r1 = norm3(sub3(S, Pa)) - d;
            const double r2 = norm3(sub3(S, Pb)) - d;
            return std::sqrt(r1 * r1 + r2 * r2);
        };
        bool ok = false;
        for (int it = 0; it < newtIt; ++it) {
            const Vec3 S = tool.S(u, v);
            Vec3 Su, Sv; surfTangents(tool, u, v, Su, Sv);
            const Vec3 ea = sub3(S, Pa);
            const Vec3 eb = sub3(S, Pb);
            const double da = norm3(ea), dbb = norm3(eb);
            if (da < 1e-300 || dbb < 1e-300) break;
            const double r1 = da - d;
            const double r2 = dbb - d;
            if (std::fabs(r1) < newtTol && std::fabs(r2) < newtTol) { ok = true; break; }
            const double j11 = dot3(ea, Su) / da, j12 = dot3(ea, Sv) / da;
            const double j21 = dot3(eb, Su) / dbb, j22 = dot3(eb, Sv) / dbb;
            const double det = j11 * j22 - j12 * j21;
            if (std::fabs(det) < 1e-300) break;
            const double du = (r1 * j22 - r2 * j12) / det;
            const double dv = (j11 * r2 - j21 * r1) / det;
            const double base = resNorm(u, v);
            double alpha = 1.0; bool improved = false;
            for (int ls = 0; ls < 8; ++ls) {
                const double un = clampd(u - alpha * du, tool.u0, tool.u1);
                const double vn = clampd(v - alpha * dv, tool.v0, tool.v1);
                if (resNorm(un, vn) < base) { u = un; v = vn; improved = true; break; }
                alpha *= 0.5;
            }
            if (!improved) break;
        }
        if (!ok) ok = resNorm(u, v) < acceptBand * std::sqrt(2.0);
        if (!ok) return false;
        DrapeNode& n = res.nodes[idx(i, j)];
        n.uv = { u, v }; n.xyz = tool.S(u, v); placed[idx(i, j)] = 1;
        return true;
    };

    // Fill the four quadrants outward from the seed so every node's anchors (one step
    // toward the seed on each axis) are already placed before it.
    auto fillQuadrant = [&](int di, int dj) {
        for (int j = cj + dj; j >= 0 && j < nv && allOk; j += dj) {
            for (int i = ci + di; i >= 0 && i < nu && allOk; i += di) {
                if (!solveNode(i, j)) { allOk = false; return; }
            }
        }
    };
    if (allOk) fillQuadrant(+1, +1);
    if (allOk) fillQuadrant(-1, +1);
    if (allOk) fillQuadrant(+1, -1);
    if (allOk) fillQuadrant(-1, -1);

    if (!allOk) {
        res.ok = false;
        res.note = "fishnet/Newton did not converge (no fabricated geometry)";
        return res;
    }

    // --- Shear-angle field + fibre paths + wrinkle flags ---
    res.shearAngleField.assign(Nn, 0.0);
    res.fiberPaths.assign(Nn, { Vec3{}, Vec3{} });
    res.wrinkleFlags.assign(Nn, 0);
    double maxShear = 0.0;
    bool anyWrinkle = false;

    for (int j = 0; j < nv; ++j) {
        for (int i = 0; i < nu; ++i) {
            const std::size_t c = idx(i, j);
            // warp edge: toward +i neighbour (or from -i if at the top edge)
            Vec3 warp{ 0, 0, 0 }, weft{ 0, 0, 0 };
            if (i + 1 < nu)      warp = sub3(res.nodes[idx(i + 1, j)].xyz, res.nodes[c].xyz);
            else if (i - 1 >= 0) warp = sub3(res.nodes[c].xyz, res.nodes[idx(i - 1, j)].xyz);
            if (j + 1 < nv)      weft = sub3(res.nodes[idx(i, j + 1)].xyz, res.nodes[c].xyz);
            else if (j - 1 >= 0) weft = sub3(res.nodes[c].xyz, res.nodes[idx(i, j - 1)].xyz);

            const Vec3 wHat = normalize3(warp);
            const Vec3 fHat = normalize3(weft);
            res.fiberPaths[c] = { wHat, fHat };

            double shear = 0.0;
            const double nw = norm3(warp), nf = norm3(weft);
            if (nw > 1e-300 && nf > 1e-300) {
                double cosang = clampd(dot3(wHat, fHat), -1.0, 1.0);
                const double angle = std::acos(cosang);   // angle between warp & weft
                shear = std::fabs(M_PI / 2.0 - angle);     // trellis shear (deviation from 90)
            }
            res.nodes[c].shearAngle = shear;
            res.shearAngleField[c] = shear;
            const bool wr = shear > params.lockingAngle;
            res.nodes[c].wrinkle = wr;
            res.wrinkleFlags[c] = wr ? 1 : 0;
            if (wr) anyWrinkle = true;
            maxShear = std::max(maxShear, shear);
        }
    }

    res.maxShearAngle = maxShear;
    res.anyWrinkle = anyWrinkle;
    res.ok = true;
    res.note = anyWrinkle ? "wrinkling predicted (shear exceeds locking angle)"
                          : "drapeable (shear within locking angle)";
    return res;
}

// ===========================================================================
// (D) PER-ELEMENT ORTHOTROPIC ORIENTATION.
// ===========================================================================
std::vector<ElementOrientation> perElementOrientation(const DrapeResult& dr,
                                                      double nominalAngle) {
    std::vector<ElementOrientation> out;
    if (!dr.ok) return out;
    const int nu = dr.nu, nv = dr.nv;
    out.reserve(dr.nodes.size());

    // The local trellis rotation = how far the warp tangent has rotated away from
    // the seed warp tangent (the nominal fibre direction). We measure it in the
    // node's local tangent plane: the signed angle between this node's warp tangent
    // and the (0,0) seed warp tangent, projected to be a small fibre-angle delta.
    // The fishnet's shear concentrates this; on a developable region warp tangents
    // stay parallel-transported => ~0 rotation; on double curvature they fan out.
    if (dr.nodes.empty()) return out;
    const Vec3 warp0 = dr.fiberPaths.empty() ? Vec3{1, 0, 0} : dr.fiberPaths[0][0];

    for (int j = 0; j < nv; ++j) {
        for (int i = 0; i < nu; ++i) {
            const std::size_t c = std::size_t(i) + std::size_t(nu) * j;
            const Vec3 wHat = dr.fiberPaths[c][0];
            // rotation of the warp tangent relative to the seed warp tangent.
            double cosang = dot3(normalize3(warp0), normalize3(wHat));
            cosang = std::min(std::max(cosang, -1.0), 1.0);
            const double rot = std::acos(cosang);  // magnitude of fibre re-orientation
            ElementOrientation eo;
            eo.node = int(c);
            // The actual fibre angle = nominal + the accumulated trellis rotation
            // PLUS the local shear (the fibres of a sheared cell are no longer at
            // nominal). Use the shear angle as the local fibre re-orientation, which
            // is the standard draped-orientation handed to FEA, and add the
            // parallel-transport fan `rot` for the warp-direction drift.
            eo.fiberAngle = nominalAngle + dr.shearAngleField[c] + rot;
            eo.wrinkled = dr.wrinkleFlags[c] != 0;
            out.push_back(eo);
        }
    }
    return out;
}

// ===========================================================================
// (E) VERSIONED LAYUP SCHEDULE.
// ===========================================================================
std::uint64_t ScheduleRegistry::commit(const Laminate& stack, const char* resin,
                                        const char* cure, const char* provenance,
                                        std::uint64_t parentId) {
    LayupSchedule rec;
    rec.id = next_++;
    rec.stack = stack;            // immutable snapshot (deep copy of the plies)
    rec.resin = resin ? resin : "";
    rec.cure = cure ? cure : "";
    rec.provenance = provenance ? provenance : "";
    rec.parentId = parentId;
    records_.push_back(std::move(rec));
    return records_.back().id;
}

const LayupSchedule* ScheduleRegistry::get(std::uint64_t id) const {
    for (const LayupSchedule& r : records_) if (r.id == id) return &r;
    return nullptr;
}

// ===========================================================================
// Helper — pull orthotropic constants from the shared #38 MaterialDB.
// ===========================================================================
materials::OrthoConstants orthoFromDB(const materials::MaterialDB& db,
                                      const materials::MatKey& key, bool& ok) {
    const materials::MaterialRecord* rec = db.exact(key);
    if (!rec) { ok = false; return materials::OrthoConstants{}; }
    ok = true;
    return rec->C;
}

} // namespace composites
} // namespace native
} // namespace forge
