// forge/native/implicit/IntervalMesh.cpp
//
// Implementation of the interval-arithmetic guaranteed mesher declared in
// forge/native/implicit/IntervalMesh.hpp.
//
// Pipeline:
//   1. INTERVAL-PRUNED OCTREE. Recurse from the root box; at each box use the
//      F-rep tree's GUARANTEED interval bound (FRep::classify, i.e.
//      FRepNode::evalInterval) to decide:
//         Outside (range.lo > 0)  → surface absent  → PRUNE (drop the subtree)
//         Inside  (range.hi < 0)  → surface absent  → PRUNE (drop the subtree)
//         Crossing                → subdivide into 8 children, recurse.
//      At the target depth a Crossing box becomes a SURFACE LEAF. Because the
//      interval is a sound enclosure, no box the surface actually crosses is ever
//      pruned — the coverage certificate marching cubes lacks.
//
//   2. The surviving surface leaves all sit on a UNIFORM lattice of 2^depth cells
//      per axis. We mark those cells, then evaluate the field sign at the lattice
//      VERTICES they touch (memoised, evaluated lazily so empty space is never
//      sampled — the interval-prune saving).
//
//   3. TOPOLOGY-AWARE DUAL CONTOURING on the marked cells: one QEF vertex per
//      sign-changing cell (Hermite normals from the ANALYTIC gradient
//      FRep::evalGrad, NOT finite differences); one dual quad per interior
//      sign-changing lattice edge, wound outward and triangulated. Each interior
//      edge is shared by its four incident cells; the box boundary is not crossed,
//      so a uniform leaf layer yields a CLOSED (watertight) 2-manifold.
//
// Pure C++20. No external dependencies.

#include "forge/native/implicit/IntervalMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace implicit {

namespace {

// ---------------------------------------------------------------------------
// Cube corner / edge numbering — IDENTICAL to IsoMesher.cpp & DualContour.cpp so
// all three meshers agree on cell topology. Local-cell coords 0/1 per axis.
// ---------------------------------------------------------------------------
constexpr int cornerOffset[8][3] = {
    {0, 0, 0}, {1, 0, 0}, {1, 1, 0}, {0, 1, 0},
    {0, 0, 1}, {1, 0, 1}, {1, 1, 1}, {0, 1, 1},
};
constexpr int edgeCorner[12][2] = {
    {0, 1}, {1, 2}, {2, 3}, {3, 0}, // bottom face
    {4, 5}, {5, 6}, {6, 7}, {7, 4}, // top face
    {0, 4}, {1, 5}, {2, 6}, {3, 7}, // vertical
};

// ---------------------------------------------------------------------------
// Symmetric 3x3 eigen-decomposition (cyclic Jacobi) — same scheme DualContour.cpp
// uses for the QEF normal matrix M = A^T A = V diag(w) V^T.
// ---------------------------------------------------------------------------
struct Sym3 { double m[3][3]; };

void jacobiEigen(Sym3 A, double w[3], double V[3][3]) {
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) V[i][j] = (i == j) ? 1.0 : 0.0;

    for (int sweep = 0; sweep < 64; ++sweep) {
        double off = std::fabs(A.m[0][1]) + std::fabs(A.m[0][2]) + std::fabs(A.m[1][2]);
        if (off < 1e-300) break;
        for (int p = 0; p < 3; ++p) {
            for (int q = p + 1; q < 3; ++q) {
                const double apq = A.m[p][q];
                if (std::fabs(apq) < 1e-300) continue;
                const double app = A.m[p][p];
                const double aqq = A.m[q][q];
                const double phi = 0.5 * (aqq - app) / apq;
                double t = (phi >= 0.0 ? 1.0 : -1.0) /
                           (std::fabs(phi) + std::sqrt(phi * phi + 1.0));
                const double c = 1.0 / std::sqrt(t * t + 1.0);
                const double s = t * c;
                for (int k = 0; k < 3; ++k) {
                    const double akp = A.m[k][p];
                    const double akq = A.m[k][q];
                    A.m[k][p] = c * akp - s * akq;
                    A.m[k][q] = s * akp + c * akq;
                }
                for (int k = 0; k < 3; ++k) {
                    const double apk = A.m[p][k];
                    const double aqk = A.m[q][k];
                    A.m[p][k] = c * apk - s * aqk;
                    A.m[q][k] = s * apk + c * aqk;
                }
                for (int k = 0; k < 3; ++k) {
                    const double vkp = V[k][p];
                    const double vkq = V[k][q];
                    V[k][p] = c * vkp - s * vkq;
                    V[k][q] = s * vkp + c * vkq;
                }
            }
        }
    }
    w[0] = A.m[0][0];
    w[1] = A.m[1][1];
    w[2] = A.m[2][2];
}

// QEF solve for one cell: minimise E(x) = sum (n_i . (x - p_i))^2 via truncated
// SVD of A^T A about the mass point, then clamp to the cell box. Same Ju et al.
// regularisation as DualContour.cpp.
Vec3 solveQEF(const std::vector<std::pair<Vec3, Vec3>>& planes,
              const Vec3& massPoint, const Vec3& lo, const Vec3& hi) {
    Sym3 ATA{};
    for (auto& r : ATA.m) for (double& v : r) v = 0.0;
    double ATb[3] = {0.0, 0.0, 0.0};

    for (const auto& pl : planes) {
        const Vec3& n = pl.second;
        const Vec3 d = pl.first - massPoint;
        const double bi = dot(n, d);
        const double nv[3] = {n.x, n.y, n.z};
        for (int a = 0; a < 3; ++a) {
            ATb[a] += nv[a] * bi;
            for (int c = 0; c < 3; ++c) ATA.m[a][c] += nv[a] * nv[c];
        }
    }

    double w[3];
    double V[3][3];
    jacobiEigen(ATA, w, V);

    const double wmax =
        std::max(std::max(std::fabs(w[0]), std::fabs(w[1])), std::fabs(w[2]));
    const double tol = wmax * 1e-6;

    double y[3] = {0.0, 0.0, 0.0};
    for (int k = 0; k < 3; ++k) {
        if (std::fabs(w[k]) <= tol) continue; // under-determined dir → keep 0
        const double vk[3] = {V[0][k], V[1][k], V[2][k]};
        const double proj = vk[0] * ATb[0] + vk[1] * ATb[1] + vk[2] * ATb[2];
        const double coef = proj / w[k];
        for (int a = 0; a < 3; ++a) y[a] += coef * vk[a];
    }

    Vec3 x{massPoint.x + y[0], massPoint.y + y[1], massPoint.z + y[2]};
    x.x = std::clamp(x.x, lo.x, hi.x);
    x.y = std::clamp(x.y, lo.y, hi.y);
    x.z = std::clamp(x.z, lo.z, hi.z);
    return x;
}

} // namespace

// ===========================================================================
// IntervalMesh::mesh
// ===========================================================================
Mesh IntervalMesh::mesh(const FRep& frep, const Vec3& lo, const Vec3& hi,
                        int maxDepth, double isovalue,
                        IntervalMeshStats* stats) {
    IntervalMeshStats st;
    Mesh out;

    if (!frep.ok() || maxDepth < 1 ||
        !(hi.x > lo.x) || !(hi.y > lo.y) || !(hi.z > lo.z)) {
        if (stats) *stats = st; // ok = false, never fabricate geometry
        return out;
    }

    const int N = 1 << maxDepth;          // leaf cells per axis (uniform leaf grid)
    const int VN = N + 1;                  // leaf VERTICES per axis
    st.depth = maxDepth;
    st.leafGrid = N;
    st.totalCells = static_cast<std::uint64_t>(N) * N * N;

    const double dx = (hi.x - lo.x) / N;
    const double dy = (hi.y - lo.y) / N;
    const double dz = (hi.z - lo.z) / N;

    auto vpos = [&](int i, int j, int k) {
        return Vec3{lo.x + i * dx, lo.y + j * dy, lo.z + k * dz};
    };
    // Interval-box of the integer leaf-cell range [i0,i1)x... (i1 = i0 + span).
    auto boxLo = [&](int i, int j, int k) { return vpos(i, j, k); };
    auto boxHi = [&](int i, int j, int k) { return vpos(i, j, k); };

    // --- (1)+(2) INTERVAL-PRUNED OCTREE -------------------------------------
    // A node covers the leaf-cell range [ci, ci+span) along each axis (span a
    // power of two). We shift the iso to the field (range against the isovalue)
    // by classifying f - isovalue: subtract isovalue from the interval bounds.
    //
    // markedCells holds the linear index (k*N + j)*N + i of every surface leaf
    // (a depth-target box whose interval straddles the isovalue).
    std::vector<std::uint8_t> cellMark(static_cast<size_t>(N) * N * N, 0);
    std::uint64_t visited = 0, pruned = 0, marked = 0;

    // Iterative octree traversal (explicit stack — no recursion depth worries).
    struct Node { int ci, cj, ck, span; };
    std::vector<Node> stack;
    stack.push_back({0, 0, 0, N});

    while (!stack.empty()) {
        const Node nd = stack.back();
        stack.pop_back();
        ++visited;

        const Vec3 bl = boxLo(nd.ci, nd.cj, nd.ck);
        const Vec3 bh = boxHi(nd.ci + nd.span, nd.cj + nd.span, nd.ck + nd.span);

        // GUARANTEED interval bound of f over this whole box (sound enclosure).
        Interval r = frep.range(bl, bh);
        r.lo -= isovalue;
        r.hi -= isovalue;

        const std::uint64_t leafEquiv =
            static_cast<std::uint64_t>(nd.span) * nd.span * nd.span;

        if (r.lo > 0.0 || r.hi < 0.0) {
            // Provably wholly outside or wholly inside → surface absent → PRUNE.
            pruned += leafEquiv;
            continue;
        }

        // Crossing: the surface MAY pass through. If we are at a leaf, mark it;
        // otherwise subdivide into 8 octants and recurse.
        if (nd.span == 1) {
            cellMark[(static_cast<size_t>(nd.ck) * N + nd.cj) * N + nd.ci] = 1;
            ++marked;
            continue;
        }
        const int h = nd.span >> 1;
        for (int oz = 0; oz < 2; ++oz)
            for (int oy = 0; oy < 2; ++oy)
                for (int ox = 0; ox < 2; ++ox)
                    stack.push_back({nd.ci + ox * h, nd.cj + oy * h,
                                     nd.ck + oz * h, h});
    }

    // --- Lattice vertex signs (lazy, memoised) ------------------------------
    // We only ever query vertices belonging to a marked cell or to an interior
    // edge between marked cells, so empty space is never sampled. Memoise both
    // the field value (for the zero-crossing) and its sign.
    std::unordered_map<std::uint64_t, double> fieldCache;
    fieldCache.reserve(st.totalCells / 8 + 16);
    auto vkey = [&](int i, int j, int k) -> std::uint64_t {
        return (static_cast<std::uint64_t>(k) * VN + j) * VN + i;
    };
    auto fieldAt = [&](int i, int j, int k) -> double {
        const std::uint64_t key = vkey(i, j, k);
        auto it = fieldCache.find(key);
        if (it != fieldCache.end()) return it->second;
        const double f = frep.eval(vpos(i, j, k)) - isovalue;
        fieldCache.emplace(key, f);
        return f;
    };

    auto cidx = [&](int i, int j, int k) -> size_t {
        return (static_cast<size_t>(k) * N + j) * N + i;
    };
    auto isMarked = [&](int i, int j, int k) -> bool {
        if (i < 0 || j < 0 || k < 0 || i >= N || j >= N || k >= N) return false;
        return cellMark[cidx(i, j, k)] != 0;
    };

    // --- (3) DUAL CONTOURING on the marked surface leaves -------------------
    // One QEF vertex per marked cell that actually changes sign (a marked cell
    // whose interval straddled 0 but whose 8 corners happen to be same-sign — a
    // conservative false-positive — emits nothing). Hermite normals come from the
    // ANALYTIC gradient of the F-rep tree.
    std::vector<int> cellVert(static_cast<size_t>(N) * N * N, -1);

    auto edgeCross = [&](const Vec3& pa, double fa, const Vec3& pb, double fb) -> Vec3 {
        double t = 0.5;
        const double denom = fa - fb;
        if (std::fabs(denom) > 1e-300) t = fa / denom;
        t = std::clamp(t, 0.0, 1.0);
        return pa + (pb - pa) * t;
    };
    auto surfaceNormal = [&](const Vec3& p) -> Vec3 {
        Vec3 g = frep.gradient(p); // ANALYTIC chain-rule gradient
        const double L = length(g);
        if (L > 1e-300) g = g * (1.0 / L);
        return g;
    };

    std::uint64_t surfaceCells = 0;
    for (int k = 0; k < N; ++k) {
        for (int j = 0; j < N; ++j) {
            for (int i = 0; i < N; ++i) {
                if (!cellMark[cidx(i, j, k)]) continue;

                double fc[8];
                Vec3 pc[8];
                int insideMask = 0;
                for (int c = 0; c < 8; ++c) {
                    const int ic = i + cornerOffset[c][0];
                    const int jc = j + cornerOffset[c][1];
                    const int kc = k + cornerOffset[c][2];
                    fc[c] = fieldAt(ic, jc, kc);
                    pc[c] = vpos(ic, jc, kc);
                    if (fc[c] < 0.0) insideMask |= (1 << c);
                }
                if (insideMask == 0 || insideMask == 0xFF) continue; // no crossing

                std::vector<std::pair<Vec3, Vec3>> planes;
                Vec3 mass{0, 0, 0};
                int nCross = 0;
                for (int e = 0; e < 12; ++e) {
                    const int c0 = edgeCorner[e][0];
                    const int c1 = edgeCorner[e][1];
                    if ((fc[c0] < 0.0) == (fc[c1] < 0.0)) continue;
                    const Vec3 x = edgeCross(pc[c0], fc[c0], pc[c1], fc[c1]);
                    planes.emplace_back(x, surfaceNormal(x));
                    mass = mass + x;
                    ++nCross;
                }
                if (nCross == 0) continue;
                mass = mass * (1.0 / nCross);

                const Vec3 v = solveQEF(planes, mass, pc[0], pc[6]);
                const int idx = static_cast<int>(out.positions.size());
                out.positions.push_back(v);
                cellVert[cidx(i, j, k)] = idx;
                ++surfaceCells;
            }
        }
    }

    // --- Dual quads: one per INTERIOR lattice edge that changes sign. --------
    // For each axis-aligned interior edge, the four cells sharing it own the
    // dual-quad corners. Wind outward (toward increasing f). Only interior edges
    // (all four incident cells in-grid) are used, so the box boundary is never
    // crossed → the uniform leaf layer is closed/watertight. emitQuad skips any
    // quad with a missing incident cell vertex (its cells were pruned as
    // non-surface — they cannot border a sign-changing edge for a sound interval,
    // so this only guards numerical edge cases, never holes the certified region).
    auto emitQuad = [&](int a, int b, int c, int d, bool flip) {
        if (a < 0 || b < 0 || c < 0 || d < 0) return;
        if (!flip) {
            out.triangles.push_back({a, b, c});
            out.triangles.push_back({a, c, d});
        } else {
            out.triangles.push_back({a, c, b});
            out.triangles.push_back({a, d, c});
        }
    };

    auto cellVertAt = [&](int i, int j, int k) -> int {
        if (!isMarked(i, j, k)) return -1;
        return cellVert[cidx(i, j, k)];
    };

    // X-edges (i,j,k)->(i+1,j,k): shared by cells offset in (j,k).
    for (int k = 1; k < N; ++k)
        for (int j = 1; j < N; ++j)
            for (int i = 0; i < N; ++i) {
                // Only consult vertices that touch a marked cell (else skip — an
                // edge bordered by no surface leaf cannot change sign for a sound
                // interval bound; this keeps empty space unsampled).
                if (!isMarked(i, j - 1, k - 1) && !isMarked(i, j, k - 1) &&
                    !isMarked(i, j, k) && !isMarked(i, j - 1, k))
                    continue;
                const double f0 = fieldAt(i, j, k);
                const double f1 = fieldAt(i + 1, j, k);
                if ((f0 < 0.0) == (f1 < 0.0)) continue;
                emitQuad(cellVertAt(i, j - 1, k - 1), cellVertAt(i, j, k - 1),
                         cellVertAt(i, j, k), cellVertAt(i, j - 1, k),
                         !(f0 < 0.0));
            }

    // Y-edges (i,j,k)->(i,j+1,k): shared by cells offset in (i,k).
    for (int k = 1; k < N; ++k)
        for (int j = 0; j < N; ++j)
            for (int i = 1; i < N; ++i) {
                if (!isMarked(i - 1, j, k - 1) && !isMarked(i, j, k - 1) &&
                    !isMarked(i, j, k) && !isMarked(i - 1, j, k))
                    continue;
                const double f0 = fieldAt(i, j, k);
                const double f1 = fieldAt(i, j + 1, k);
                if ((f0 < 0.0) == (f1 < 0.0)) continue;
                emitQuad(cellVertAt(i - 1, j, k - 1), cellVertAt(i, j, k - 1),
                         cellVertAt(i, j, k), cellVertAt(i - 1, j, k),
                         f0 < 0.0);
            }

    // Z-edges (i,j,k)->(i,j,k+1): shared by cells offset in (i,j).
    for (int k = 0; k < N; ++k)
        for (int j = 1; j < N; ++j)
            for (int i = 1; i < N; ++i) {
                if (!isMarked(i - 1, j - 1, k) && !isMarked(i, j - 1, k) &&
                    !isMarked(i, j, k) && !isMarked(i - 1, j, k))
                    continue;
                const double f0 = fieldAt(i, j, k);
                const double f1 = fieldAt(i, j, k + 1);
                if ((f0 < 0.0) == (f1 < 0.0)) continue;
                emitQuad(cellVertAt(i - 1, j - 1, k), cellVertAt(i, j - 1, k),
                         cellVertAt(i, j, k), cellVertAt(i - 1, j, k),
                         !(f0 < 0.0));
            }

    st.visitedCells = visited;
    st.prunedCells = pruned;
    st.markedCells = marked;
    st.surfaceCells = surfaceCells;
    st.ok = true;
    if (stats) *stats = st;
    return out;
}

} // namespace implicit
} // namespace native
} // namespace forge
