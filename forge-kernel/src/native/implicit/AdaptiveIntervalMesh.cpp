// forge/native/implicit/AdaptiveIntervalMesh.cpp
//
// Implementation of the ADAPTIVE interval-arithmetic mesher declared in
// forge/native/implicit/AdaptiveIntervalMesh.hpp.
//
// Pipeline:
//   1. CURVATURE-DRIVEN, INTERVAL-PRUNED, 2:1-BALANCED OCTREE.
//      Recurse from the root box. At each box use the F-rep tree's GUARANTEED
//      interval bound (FRep::classify) — IDENTICAL soundness to the uniform
//      mesher:
//         Outside (range.lo > 0) / Inside (range.hi < 0) → surface absent → PRUNE.
//         Crossing → MAY subdivide.
//      A Crossing box is subdivided when depth < minDepth (seed), OR when
//      depth < maxDepth AND a local FLATNESS estimate says the surface is too
//      curved to be captured by a single QEF vertex at this size. Flat crossing
//      regions therefore stop early (coarse leaves); curved regions refine
//      (fine leaves). The tree is then BALANCED to 2:1 (no leaf neighbour differs
//      by more than one level) so the minimal-edge dual is crack-free.
//
//   2. One DUAL-CONTOUR / QEF vertex per surface leaf (a leaf whose 8 corner
//      signs actually change). Hermite normals come from the ANALYTIC gradient
//      FRep::gradient. The QEF solve is the SAME Ju-Losasso-Schaefer-Warren
//      scheme the uniform IntervalMesh / DualContour use (one shared solver).
//
//   3. ADAPTIVE (minimal-edge) DUAL CONTOURING: the cell/face/edge recursion of
//      Ju et al. 2002 walks the octree and, on every MINIMAL sign-changing edge
//      (the smallest edge shared by up to four leaves), emits one dual polygon
//      joining those leaves' vertices. Because the recursion always contours on
//      the smallest incident cell, a coarse leaf and its finer neighbours share
//      ONE consistent dual edge set — the T-junction / hanging-node problem is
//      resolved exactly. On a 2:1-balanced octree this is a watertight, closed
//      2-manifold.
//
// Pure C++20. No external dependencies.

#include "forge/native/implicit/AdaptiveIntervalMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <unordered_set>
#include <vector>

namespace forge {
namespace native {
namespace implicit {

namespace {

// ---------------------------------------------------------------------------
// Cube corner numbering — IDENTICAL to IntervalMesh.cpp / DualContour.cpp.
// corner c has local coords (cornerOffset[c]) in {0,1}^3.
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
// Symmetric 3x3 eigen-decomposition (cyclic Jacobi) — SAME scheme as
// IntervalMesh.cpp / DualContour.cpp. M = V diag(w) V^T.
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

// QEF solve for one leaf — IDENTICAL math to IntervalMesh.cpp::solveQEF.
// Minimise E(x) = sum (n_i . (x - p_i))^2 via truncated SVD of A^T A about the
// mass point, then clamp to the cell box.
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
        if (std::fabs(w[k]) <= tol) continue;
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

// ---------------------------------------------------------------------------
// Integer octree on a virtual lattice of (1<<maxDepth) cells per axis. A node
// covers the integer cube [origin, origin+size)^3 (size a power of two) at
// `depth`. Internal nodes own 8 children (Morton-style, child c at
// origin + cornerOffset[c]*half). Surface leaves carry a dual vertex index.
// ---------------------------------------------------------------------------
struct OctNode {
    int o[3] = {0, 0, 0}; // integer origin (lattice units)
    int size = 0;         // integer side length (lattice units), power of two
    int depth = 0;
    bool leaf = true;
    int child[8] = {-1, -1, -1, -1, -1, -1, -1, -1}; // node indices or -1
    int vert = -1;        // dual vertex index in the output mesh, or -1
    // Corner signs (true == inside, f<0) for a leaf, used by the recursion.
    bool cornerInside[8] = {false, false, false, false, false, false, false, false};
    bool hasSurface = false; // leaf produced a vertex (sign change among corners)
};

// The builder: owns the FRep, the box mapping, and the node pool.
class Builder {
public:
    Builder(const FRep& frep, const Vec3& lo, const Vec3& hi, int minDepth,
            int maxDepth, double curvatureTol, double isovalue)
        : frep_(frep), lo_(lo), hi_(hi), minDepth_(minDepth),
          maxDepth_(maxDepth), curvatureTol_(curvatureTol), isovalue_(isovalue) {
        const int full = 1 << maxDepth_;
        cell_.x = (hi_.x - lo_.x) / full;
        cell_.y = (hi_.y - lo_.y) / full;
        cell_.z = (hi_.z - lo_.z) / full;
    }

    // World position of integer lattice node (i,j,k) at the finest lattice.
    Vec3 latPos(int i, int j, int k) const {
        return Vec3{lo_.x + i * cell_.x, lo_.y + j * cell_.y, lo_.z + k * cell_.z};
    }

    double fieldAt(const Vec3& p) const { return frep_.eval(p) - isovalue_; }

    std::vector<OctNode>& nodes() { return nodes_; }
    const std::vector<OctNode>& nodes() const { return nodes_; }

    std::uint64_t visited = 0, pruned = 0;

    // Build the (unbalanced) curvature-pruned octree, return the root index.
    int build() {
        nodes_.clear();
        const int full = 1 << maxDepth_;
        const int root = newNode(0, 0, 0, full, 0);
        subdivide(root);
        return root;
    }

    // Enforce the 2:1 balance constraint: no leaf may have a face neighbour more
    // than ONE level finer. Iterate over the node pool until stable (splits append
    // children to the pool in place; the root index is unchanged).
    void balance() {
        bool changed = true;
        int guard = 0;
        while (changed && guard++ < 64) {
            changed = false;
            // Snapshot leaf list (splitting appends, so iterate by index range
            // captured before this pass).
            const size_t count = nodes_.size();
            for (size_t idx = 0; idx < count; ++idx) {
                if (!nodes_[idx].leaf) continue;
                if (nodes_[idx].depth >= maxDepth_) continue;
                // 2:1 (restricted) rule: a leaf must split only if some face
                // neighbour is at depth >= this leaf's depth + 2 (i.e. more than
                // ONE level finer). Using +2 (not +1) is what keeps the balance a
                // single-level halo around fine features instead of cascading the
                // whole tree to maxDepth.
                if (neighbourFinerThan(static_cast<int>(idx), nodes_[idx].depth + 2)) {
                    splitLeaf(static_cast<int>(idx));
                    changed = true;
                }
            }
        }
    }

    // After balancing, (re)classify every leaf's corner signs and assign QEF
    // vertices for surface leaves. Fills mesh positions.
    void contourVertices(Mesh& out) {
        for (size_t idx = 0; idx < nodes_.size(); ++idx) {
            OctNode& nd = nodes_[idx];
            if (!nd.leaf) continue;
            classifyCorners(nd);
            int insideMask = 0;
            for (int c = 0; c < 8; ++c) if (nd.cornerInside[c]) insideMask |= (1 << c);
            if (insideMask == 0 || insideMask == 0xFF) continue; // no crossing
            // Hermite data on sign-changing edges.
            Vec3 corners[8];
            double fc[8];
            for (int c = 0; c < 8; ++c) {
                corners[c] = latPos(nd.o[0] + cornerOffset[c][0] * nd.size,
                                    nd.o[1] + cornerOffset[c][1] * nd.size,
                                    nd.o[2] + cornerOffset[c][2] * nd.size);
                fc[c] = fieldAt(corners[c]);
            }
            std::vector<std::pair<Vec3, Vec3>> planes;
            Vec3 mass{0, 0, 0};
            int nCross = 0;
            for (int e = 0; e < 12; ++e) {
                const int c0 = edgeCorner[e][0], c1 = edgeCorner[e][1];
                if ((fc[c0] < 0.0) == (fc[c1] < 0.0)) continue;
                const Vec3 x = edgeCross(corners[c0], fc[c0], corners[c1], fc[c1]);
                planes.emplace_back(x, surfaceNormal(x));
                mass = mass + x;
                ++nCross;
            }
            if (nCross == 0) continue;
            mass = mass * (1.0 / nCross);
            const Vec3 v = solveQEF(planes, mass, corners[0], corners[6]);
            nd.vert = static_cast<int>(out.positions.size());
            nd.hasSurface = true;
            out.positions.push_back(v);
        }
    }

    int minLeafDepth() const { return minLeafDepth_; }
    int maxLeafDepth() const { return maxLeafDepth_; }
    std::uint64_t leafCount() const { return leafCount_; }
    std::uint64_t surfaceCount() const { return surfaceCount_; }

    // Recompute leaf statistics after contouring.
    void gatherStats() {
        leafCount_ = surfaceCount_ = 0;
        minLeafDepth_ = maxDepth_;
        maxLeafDepth_ = 0;
        for (const OctNode& nd : nodes_) {
            if (!nd.leaf) continue;
            int insideMask = 0;
            for (int c = 0; c < 8; ++c) if (nd.cornerInside[c]) insideMask |= (1 << c);
            const bool surfaceLeaf = !(insideMask == 0 || insideMask == 0xFF);
            if (!surfaceLeaf) continue;
            ++leafCount_;
            if (nd.hasSurface) ++surfaceCount_;
            minLeafDepth_ = std::min<int>(minLeafDepth_, nd.depth);
            maxLeafDepth_ = std::max<int>(maxLeafDepth_, nd.depth);
        }
    }

private:
    const FRep& frep_;
    Vec3 lo_, hi_, cell_;
    int minDepth_, maxDepth_;
    double curvatureTol_, isovalue_;
    std::vector<OctNode> nodes_;
    int minLeafDepth_ = 0, maxLeafDepth_ = 0;
    std::uint64_t leafCount_ = 0, surfaceCount_ = 0;

    int newNode(int x, int y, int z, int size, int depth) {
        OctNode nd;
        nd.o[0] = x; nd.o[1] = y; nd.o[2] = z;
        nd.size = size; nd.depth = depth; nd.leaf = true;
        nodes_.push_back(nd);
        return static_cast<int>(nodes_.size() - 1);
    }

    Vec3 nodeLo(const OctNode& nd) const {
        return latPos(nd.o[0], nd.o[1], nd.o[2]);
    }
    Vec3 nodeHi(const OctNode& nd) const {
        return latPos(nd.o[0] + nd.size, nd.o[1] + nd.size, nd.o[2] + nd.size);
    }

    void classifyCorners(OctNode& nd) const {
        for (int c = 0; c < 8; ++c) {
            const Vec3 p = latPos(nd.o[0] + cornerOffset[c][0] * nd.size,
                                  nd.o[1] + cornerOffset[c][1] * nd.size,
                                  nd.o[2] + cornerOffset[c][2] * nd.size);
            nd.cornerInside[c] = fieldAt(p) < 0.0;
        }
    }

    Vec3 edgeCross(const Vec3& pa, double fa, const Vec3& pb, double fb) const {
        double t = 0.5;
        const double denom = fa - fb;
        if (std::fabs(denom) > 1e-300) t = fa / denom;
        t = std::clamp(t, 0.0, 1.0);
        return pa + (pb - pa) * t;
    }
    Vec3 surfaceNormal(const Vec3& p) const {
        Vec3 g = frep_.gradient(p);
        const double L = length(g);
        if (L > 1e-300) g = g * (1.0 / L);
        return g;
    }

    // FLATNESS / CURVATURE estimate over a crossing box, driving adaptivity.
    //
    // We measure the box's DEVIATION FROM LINEAR: the field at the box centre vs
    // the average of the 8 corner field values. A trilinear (locally FLAT /
    // planar) field has centre == corner-mean exactly, so the deviation is 0; a
    // CURVED field (a sphere, a tight feature) produces a non-zero second-order
    // deviation. Normalised by the box diagonal it is a scale-aware curvature
    // proxy: for a sphere of radius R over a cell of size h it is ~ h/(8√3·R), so
    // it DROPS as the cell shrinks (→ refinement stops once the cell is small
    // enough for the local curvature) and is LARGER where curvature is higher
    // (small radius / tight features). Refine while it exceeds curvatureTol.
    //
    // This second-difference proxy is also robust at CSG seams: on a union the
    // field is min(...) — over a cell well inside one operand's region the field
    // is that operand's SMOOTH SDF, so the deviation reflects that operand's real
    // curvature, not the (measure-zero) seam. A gradient-direction metric, by
    // contrast, flips wildly across the seam and over-refines flat regions.
    //
    // SOUND driver: it only decides WHERE to STOP early. Every crossing leaf is
    // still kept by the interval prune up to maxDepth, so under-refinement never
    // holes the certified surface — the interval bound, not this estimate, is the
    // coverage guarantee.
    bool tooCurved(const OctNode& nd) const {
        const Vec3 bl = nodeLo(nd), bh = nodeHi(nd);
        double cornerSum = 0.0;
        for (int c = 0; c < 8; ++c) {
            const Vec3 p = latPos(nd.o[0] + cornerOffset[c][0] * nd.size,
                                  nd.o[1] + cornerOffset[c][1] * nd.size,
                                  nd.o[2] + cornerOffset[c][2] * nd.size);
            cornerSum += fieldAt(p);
        }
        const Vec3 ctr{0.5 * (bl.x + bh.x), 0.5 * (bl.y + bh.y), 0.5 * (bl.z + bh.z)};
        const double fCtr = fieldAt(ctr);
        const double meanCorner = cornerSum / 8.0;
        const double dev = std::fabs(fCtr - meanCorner); // 0 for a linear field
        const double diag = length(Vec3{bh.x - bl.x, bh.y - bl.y, bh.z - bl.z});
        if (diag < 1e-300) return false;
        const double curv = dev / diag; // scale-aware curvature proxy
        return curv > curvatureTol_;
    }

    // Recursive subdivision driven by interval prune + curvature.
    void subdivide(int nodeIdx) {
        ++visited;
        OctNode nd = nodes_[nodeIdx]; // copy header (pool may reallocate)
        const Vec3 bl = nodeLo(nd), bh = nodeHi(nd);
        Interval r = frep_.range(bl, bh);
        r.lo -= isovalue_;
        r.hi -= isovalue_;
        if (r.lo > 0.0 || r.hi < 0.0) {
            // Provably empty / full → PRUNE (drop; leaf with no surface).
            ++pruned;
            return; // remains a leaf; corner classify later marks it non-surface
        }
        // Crossing. Decide whether to refine.
        const bool atMax = nd.depth >= maxDepth_;
        const bool belowMin = nd.depth < minDepth_;
        bool refine = false;
        if (!atMax) {
            if (belowMin) refine = true;
            else refine = tooCurved(nd);
        }
        if (!refine) return; // keep as a surface-bearing leaf
        splitNode(nodeIdx);
        for (int c = 0; c < 8; ++c) subdivide(nodes_[nodeIdx].child[c]);
    }

    // Split a node into 8 children (turns it internal). Children inherit
    // depth+1. Does NOT recurse — caller drives recursion / balancing.
    void splitNode(int nodeIdx) {
        const int half = nodes_[nodeIdx].size >> 1;
        const int ox = nodes_[nodeIdx].o[0];
        const int oy = nodes_[nodeIdx].o[1];
        const int oz = nodes_[nodeIdx].o[2];
        const int depth = nodes_[nodeIdx].depth;
        int kids[8];
        for (int c = 0; c < 8; ++c) {
            kids[c] = newNode(ox + cornerOffset[c][0] * half,
                              oy + cornerOffset[c][1] * half,
                              oz + cornerOffset[c][2] * half, half, depth + 1);
        }
        // nodes_ may have reallocated; index back in.
        for (int c = 0; c < 8; ++c) nodes_[nodeIdx].child[c] = kids[c];
        nodes_[nodeIdx].leaf = false;
    }

    // For balancing: split a leaf and re-run the interval prune on each child so
    // children that become provably empty/full stay non-surface leaves.
    void splitLeaf(int nodeIdx) {
        splitNode(nodeIdx);
        // Children are leaves at depth+1; leave them as leaves (balance pass and
        // contour will classify). No further curvature recursion here — balancing
        // only needs the 2:1 split, not full curvature refinement.
    }

    // Does leaf `nodeIdx` have any neighbour whose covering leaf is at depth
    // >= `minNeighbourDepth+1`? We test the 6 face neighbours (sufficient to
    // enforce 2:1 for dual contouring's face/edge recursion on the balanced tree;
    // face-balance implies the edge/vertex incidence is at most 2:1 as well once
    // iterated to a fixed point).
    bool neighbourFinerThan(int nodeIdx, int minNeighbourDepth) {
        const OctNode nd = nodes_[nodeIdx];
        const int full = 1 << maxDepth_;
        // The neighbour just outside each face, sampled at a lattice point one
        // finest-cell inside that neighbour, to find which leaf covers it.
        const int s = nd.size;
        const struct { int dx, dy, dz; } faces[6] = {
            {-1, 0, 0}, {1, 0, 0}, {0, -1, 0}, {0, 1, 0}, {0, 0, -1}, {0, 0, 1}};
        for (auto& fdir : faces) {
            // A point just across the face, at the centre of the face, nudged
            // one finest cell into the neighbour.
            int px = nd.o[0] + s / 2;
            int py = nd.o[1] + s / 2;
            int pz = nd.o[2] + s / 2;
            if (fdir.dx < 0) px = nd.o[0] - 1;
            if (fdir.dx > 0) px = nd.o[0] + s; // first cell of neighbour
            if (fdir.dy < 0) py = nd.o[1] - 1;
            if (fdir.dy > 0) py = nd.o[1] + s;
            if (fdir.dz < 0) pz = nd.o[2] - 1;
            if (fdir.dz > 0) pz = nd.o[2] + s;
            if (px < 0 || py < 0 || pz < 0 || px >= full || py >= full || pz >= full)
                continue; // outside the root → no neighbour
            const int nbDepth = depthOfLeafContaining(px, py, pz);
            if (nbDepth >= minNeighbourDepth) return true;
        }
        return false;
    }

    // Walk from the root to find the depth of the leaf covering finest-lattice
    // cell (cx,cy,cz). Returns the leaf depth (or maxDepth if it descends fully).
    int depthOfLeafContaining(int cx, int cy, int cz) const {
        const int idx = leafIndexContaining(cx, cy, cz);
        return idx < 0 ? -1 : nodes_[idx].depth;
    }

public:
    // Node index of the LEAF covering finest-lattice cell (cx,cy,cz), or -1 if
    // outside the root. Used by the dual-contour minimal-edge pass.
    int leafIndexContaining(int cx, int cy, int cz) const {
        const int full = 1 << maxDepth_;
        if (cx < 0 || cy < 0 || cz < 0 || cx >= full || cy >= full || cz >= full)
            return -1;
        int idx = 0; // root is node 0
        while (!nodes_[idx].leaf) {
            const OctNode& nd = nodes_[idx];
            const int half = nd.size >> 1;
            int bx = (cx >= nd.o[0] + half) ? 1 : 0;
            int by = (cy >= nd.o[1] + half) ? 1 : 0;
            int bz = (cz >= nd.o[2] + half) ? 1 : 0;
            int ci = -1;
            for (int t = 0; t < 8; ++t)
                if (cornerOffset[t][0] == bx && cornerOffset[t][1] == by &&
                    cornerOffset[t][2] == bz) { ci = t; break; }
            idx = nd.child[ci];
        }
        return idx;
    }

    int maxDepthVal() const { return maxDepth_; }
};

// ---------------------------------------------------------------------------
// ADAPTIVE (minimal-edge) DUAL CONTOURING via a VIRTUAL-LATTICE EDGE SWEEP.
//
// The classic Ju et al. 2002 cell/face/edge recursion and this edge-sweep are
// equivalent on a 2:1-balanced octree; the sweep is chosen here because it is
// far easier to verify watertight and it reuses the leaf-lookup the balancer
// already needs.
//
// IDEA. Every leaf, whatever its size, occupies an integer box on the VIRTUAL
// FINEST lattice [0, 2^maxDepth)^3. The DUAL of the octree has one vertex per
// surface leaf (already placed by the QEF) and one POLYGON per MINIMAL dual edge
// — i.e. per group of (up to 4) DISTINCT leaves that meet around a common octree
// edge. We enumerate those edges by sweeping every INTERIOR finest-lattice edge
// (three axis families). For a finest edge along an axis we look up the 4 leaves
// surrounding it (the 4 finest cells sharing that edge map, via leafIndexContaining,
// to ≤4 distinct leaves). The four leaves' QEF vertices are the quad corners.
//
// DEDUP / MINIMAL-EDGE: a coarse leaf spans many finest edges, so the SAME
// 4-leaf group is hit many times. We emit the quad only ONCE per unique group by
// keying on the sorted tuple of the 4 leaf-node indices. That is exactly the
// "one polygon per minimal dual edge" rule — on a balanced octree every such
// group's edge is unambiguous, so the dual mesh is watertight and crack-free
// across level transitions (the coarse leaf participates in ONE quad with each of
// its finer neighbours, never a T-junction).
//
// The sign test that decides whether an edge crosses the surface, and the
// outward winding, are taken from the finest edge's two endpoints (the true field
// there) — consistent with the leaves' own corner classification on a balanced
// tree.
// ---------------------------------------------------------------------------
struct DualEdgeSweep {
    Builder& builder;
    Mesh& out;

    // Quads already emitted, keyed by (axis, sorted 4-leaf group). On a 2:1-
    // balanced octree a group of 4 leaves meets along exactly ONE axis-aligned
    // minimal dual edge, so (axis, sorted-leaf-tuple) uniquely identifies that
    // minimal edge — a coarse leaf spanning many finest edges yields exactly one
    // quad per minimal edge. COLLISION-FREE: the key is the full 4 int32 indices
    // plus the axis, hashed by a struct-set (no lossy bit-packing).
    struct GroupKey {
        int axis;
        int v[4];
        bool operator==(const GroupKey& o) const {
            return axis == o.axis && v[0] == o.v[0] && v[1] == o.v[1] &&
                   v[2] == o.v[2] && v[3] == o.v[3];
        }
    };
    struct GroupKeyHash {
        std::size_t operator()(const GroupKey& k) const {
            std::uint64_t h = 1469598103934665603ull; // FNV-1a 64
            auto mix = [&](std::uint64_t x) {
                h ^= (x & 0xffffffffull);
                h *= 1099511628211ull;
            };
            mix(static_cast<std::uint64_t>(k.axis));
            for (int i = 0; i < 4; ++i) mix(static_cast<std::uint64_t>(k.v[i]));
            return static_cast<std::size_t>(h);
        }
    };
    std::unordered_set<GroupKey, GroupKeyHash> emitted;

    static GroupKey groupKey(int axis, int a, int b, int c, int d) {
        GroupKey k;
        k.axis = axis;
        k.v[0] = a; k.v[1] = b; k.v[2] = c; k.v[3] = d;
        std::sort(k.v, k.v + 4);
        return k;
    }

    void run() {
        const int full = 1 << builder.maxDepthVal();
        // Sweep interior edges of each axis family. An edge along `axis` from
        // finest-lattice node (i,j,k) to +axis is shared by the 4 finest CELLS
        // offset by -1/0 in the two OTHER axes. We require all 4 cells in-grid
        // (interior edge) so the box boundary is never crossed → watertight.
        // axis 0 (x-edge): endpoints (i,j,k)->(i+1,j,k); 4 cells vary in (j,k).
        sweepAxis(0, full);
        sweepAxis(1, full);
        sweepAxis(2, full);
    }

    void sweepAxis(int axis, int full) {
        const int b = (axis + 1) % 3;
        const int c = (axis + 2) % 3;
        // Iterate every interior finest edge: its low endpoint runs the full
        // lattice along `axis` ([0,full)), and along b,c it runs (1..full-1) so
        // all four incident cells are in-grid.
        int e[3];
        for (e[axis] = 0; e[axis] < full; ++e[axis]) {
            for (e[b] = 1; e[b] < full; ++e[b]) {
                for (e[c] = 1; e[c] < full; ++e[c]) {
                    handleEdge(axis, b, c, e[0], e[1], e[2]);
                }
            }
        }
    }

    void handleEdge(int axis, int b, int c, int ex, int ey, int ez) {
        const int e[3] = {ex, ey, ez};
        // Endpoints of the finest edge along `axis`.
        int p0[3] = {e[0], e[1], e[2]};
        int p1[3] = {e[0], e[1], e[2]};
        p1[axis] += 1;
        const Vec3 wa = builder.latPos(p0[0], p0[1], p0[2]);
        const Vec3 wb = builder.latPos(p1[0], p1[1], p1[2]);
        const double fa = builder.fieldAt(wa);
        const double fb = builder.fieldAt(wb);
        if ((fa < 0.0) == (fb < 0.0)) return; // edge does not cross the surface

        // The 4 finest CELLS sharing this edge: vary by -1/0 in axes b and c.
        // Cell origin = edge low endpoint shifted by {0 or -1} in b and c.
        int leaves[4];
        for (int q = 0; q < 4; ++q) {
            const int sb = (q & 1) ? -1 : 0;
            const int sc = (q & 2) ? -1 : 0;
            int cell[3] = {e[0], e[1], e[2]};
            cell[b] += sb;
            cell[c] += sc;
            // along axis, the cell at the low endpoint covers [e[axis], e[axis]+1)
            leaves[q] = builder.leafIndexContaining(cell[0], cell[1], cell[2]);
        }
        // All four must resolve to surface leaves carrying a vertex.
        for (int q = 0; q < 4; ++q)
            if (leaves[q] < 0 || !builder.nodes()[leaves[q]].leaf ||
                builder.nodes()[leaves[q]].vert < 0)
                return;

        // CCW order around the edge (looking down +axis). The four cells in the
        // (b,c) plane at offsets:
        //   q=0 (0,0)   q=1 (-1,0)   q=3 (-1,-1)  q=2 (0,-1)
        // gives a consistent ring; map to leaves[].
        const int ring[4] = {leaves[0], leaves[1], leaves[3], leaves[2]};

        const GroupKey key = groupKey(axis, ring[0], ring[1], ring[2], ring[3]);
        if (!emitted.insert(key).second) return; // already emitted this minimal edge

        const int v0 = builder.nodes()[ring[0]].vert;
        const int v1 = builder.nodes()[ring[1]].vert;
        const int v2 = builder.nodes()[ring[2]].vert;
        const int v3 = builder.nodes()[ring[3]].vert;

        // Winding: the ring above is CCW when viewed from +axis. If the low
        // endpoint is OUTSIDE (fa>=0, i.e. f increases toward -axis) flip so the
        // face points outward (toward increasing f).
        const bool flip = (fa < 0.0);
        emitQuad(v0, v1, v2, v3, flip);
    }

    void emitQuad(int a, int b, int c, int d, bool flip) {
        // Collapse duplicate consecutive indices (a coarse leaf can appear twice
        // in the ring when it borders the edge on two sides) so the quad degrades
        // to a single triangle rather than producing a degenerate/duplicated edge.
        int v[4] = {a, b, c, d};
        std::vector<int> poly;
        for (int i = 0; i < 4; ++i)
            if (poly.empty() || poly.back() != v[i]) poly.push_back(v[i]);
        if (poly.size() >= 2 && poly.front() == poly.back()) poly.pop_back();
        if (poly.size() < 3) return;
        if (!flip) {
            for (size_t i = 1; i + 1 < poly.size(); ++i)
                out.triangles.push_back({poly[0], poly[i], poly[i + 1]});
        } else {
            for (size_t i = 1; i + 1 < poly.size(); ++i)
                out.triangles.push_back({poly[0], poly[i + 1], poly[i]});
        }
    }
};

} // namespace

// ===========================================================================
// AdaptiveIntervalMesh::mesh
// ===========================================================================
Mesh AdaptiveIntervalMesh::mesh(const FRep& frep, const Vec3& lo, const Vec3& hi,
                                int minDepth, int maxDepth, double curvatureTol,
                                double isovalue, AdaptiveMeshStats* stats) {
    AdaptiveMeshStats st;
    st.minDepth = minDepth;
    st.maxDepth = maxDepth;
    Mesh out;

    if (!frep.ok() || maxDepth < 1 || minDepth < 0 || minDepth > maxDepth ||
        !(hi.x > lo.x) || !(hi.y > lo.y) || !(hi.z > lo.z)) {
        if (stats) *stats = st;
        return out;
    }

    Builder builder(frep, lo, hi, minDepth, maxDepth, curvatureTol, isovalue);

    // (1) Build the curvature-pruned octree (root is always node 0).
    builder.build();

    // (1b) Balance to 2:1 so the minimal-edge dual is crack-free.
    builder.balance();

    // (2) Place one QEF vertex per surface leaf.
    builder.contourVertices(out);

    // (3) Adaptive (minimal-edge) dual contouring via the virtual-lattice edge
    // sweep (watertight, crack-free across level transitions on the balanced tree).
    DualEdgeSweep sweep{builder, out, {}};
    sweep.run();

    builder.gatherStats();
    st.visitedNodes = builder.visited;
    st.prunedNodes = builder.pruned;
    st.leafCells = builder.leafCount();
    st.surfaceCells = builder.surfaceCount();
    st.minLeafDepth = static_cast<std::uint64_t>(builder.minLeafDepth());
    st.maxLeafDepth = static_cast<std::uint64_t>(builder.maxLeafDepth());
    st.ok = true;
    if (stats) *stats = st;
    return out;
}

} // namespace implicit
} // namespace native
} // namespace forge
