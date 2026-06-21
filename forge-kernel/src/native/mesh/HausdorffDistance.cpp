// forge/native/mesh/HausdorffDistance.cpp
//
// Implementation of forge::native::mesh::HausdorffDistance — a SAMPLED, directed
// + symmetric Hausdorff / surface-deviation distance between two triangle soups.
// Pure C++20, standard library only. NO OCCT, NO WASM, NO third-party libs.
//
// Strategy (see HausdorffDistance.hpp for the honest envelope):
//   * Build a geom::AABBTree over the TARGET soup (O(log n) closest-point).
//   * Densely sample the SOURCE surface: every vertex, plus a regular
//     barycentric grid of interior face samples per triangle.
//   * For each source sample, query the target tree's closestPoint; the directed
//     Hausdorff is the MAX of those distances (a sup), with mean / RMS / argmax.
//   * Symmetric Hausdorff = max of both directed maxima; symmetric mean / RMS are
//     the sample-count-weighted aggregate over BOTH directions.
//
// CI-PORTABILITY: every standard header actually used is included explicitly
// (a missing include can pass on Mac libc++ yet FAIL CI's libstdc++).

#include "forge/native/mesh/HausdorffDistance.hpp"

#include <algorithm>      // std::max
#include <array>          // std::array
#include <cmath>          // std::sqrt, std::isfinite
#include <cstddef>        // std::size_t
#include <cstdint>        // std::uint32_t
#include <vector>         // std::vector

#include "forge/native/geom/AABBTree.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace mesh {

namespace {

// Is every coordinate of this flat position array finite?
bool allFinite(const std::vector<double>& v) {
    for (double x : v) {
        if (!std::isfinite(x)) return false;
    }
    return true;
}

// Validate a soup as a *source* (we only read it; the target is validated by the
// AABBTree build itself). The sampler needs:
//   * positions a multiple of 3, indices a multiple of 3, at least one triangle,
//   * every index in range, every coordinate finite.
// Returns nullptr on success, else a static reason string.
const char* validateSource(const SoupRef& s) {
    if (s.positions.size() % 3 != 0) return "source positions length not a multiple of 3";
    if (s.indices.size() % 3 != 0)   return "source indices length not a multiple of 3";
    if (s.indices.empty())           return "source has no triangles";
    if (!allFinite(s.positions))     return "source has a non-finite coordinate";
    const std::size_t nv = s.positions.size() / 3;
    for (std::uint32_t id : s.indices) {
        if (static_cast<std::size_t>(id) >= nv) return "source index out of range";
    }
    return nullptr;
}

Vec3 vertexOf(const std::vector<double>& pos, std::uint32_t v) {
    const std::size_t b = static_cast<std::size_t>(v) * 3;
    return Vec3{pos[b], pos[b + 1], pos[b + 2]};
}

double dist(const Vec3& a, const Vec3& b) {
    const double dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

// Generate the barycentric weights for a regular sub-triangle grid producing
// roughly `target` STRICTLY-INTERIOR samples per face. We pick the smallest grid
// resolution g such that the count of interior lattice points (g-1)(g-2)/2 is
// >= target, then emit those interior points. g<=2 emits nothing (vertices only,
// which the caller always samples separately). Deterministic — no RNG — so the
// estimate is reproducible for a fixed density.
void interiorBarycentric(std::uint32_t target,
                         std::vector<std::array<double, 3>>& out) {
    out.clear();
    if (target == 0) return;
    std::uint32_t g = 2;
    while (((g - 1) * (g - 2)) / 2 < target) ++g;
    const double inv = 1.0 / static_cast<double>(g);
    // Interior lattice points (i,j,k), i+j+k=g, all > 0.
    for (std::uint32_t i = 1; i < g; ++i) {
        for (std::uint32_t j = 1; i + j < g; ++j) {
            const std::uint32_t k = g - i - j;     // > 0 by the loop bound
            out.push_back({static_cast<double>(i) * inv,
                           static_cast<double>(j) * inv,
                           static_cast<double>(k) * inv});
        }
    }
}

// One evaluated sample: its closest-point distance to the target and (kept for
// the worst case) the sample point and its closest point on the target.
struct Eval {
    bool   ok = false;
    double d = 0.0;
    Vec3   sample{};
    Vec3   closest{};
};

Eval evalSample(const Vec3& p, const geom::AABBTree& dst) {
    Eval e;
    const geom::ClosestResult cr = dst.closestPoint(p);
    if (!cr.ok) return e;            // empty tree — caller already guards this
    e.ok      = true;
    e.d       = std::sqrt(std::max(0.0, cr.dist2));
    e.sample  = p;
    e.closest = cr.point;
    return e;
}

// Core directed sweep against a prebuilt, non-empty target tree.
// Accumulates max / mean / RMS / argmax and an estimate of the mean spacing
// between adjacent source samples (a coarse bound on the sup under-estimate).
bool directedCore(const SoupRef& src, const geom::AABBTree& dstTree,
                  const HausdorffParams& params, DirectedDistance& out,
                  double& sumSpacing, std::size_t& spacingCount) {
    out = DirectedDistance{};
    sumSpacing = 0.0;
    spacingCount = 0;

    const char* why = validateSource(src);
    if (why != nullptr) return false;
    if (dstTree.empty()) return false;

    std::vector<std::array<double, 3>> bary;
    interiorBarycentric(params.facesSamples, bary);

    double maxD = -1.0;
    double sumD = 0.0;
    double sumD2 = 0.0;
    std::size_t count = 0;
    Vec3 argSample{}, argClosest{};

    // (a) every source VERTEX.
    const std::size_t nv = src.positions.size() / 3;
    for (std::size_t v = 0; v < nv; ++v) {
        const Vec3 p = vertexOf(src.positions, static_cast<std::uint32_t>(v));
        const Eval e = evalSample(p, dstTree);
        if (!e.ok) return false;
        sumD += e.d; sumD2 += e.d * e.d; ++count;
        if (e.d > maxD) { maxD = e.d; argSample = e.sample; argClosest = e.closest; }
    }

    // (b) interior barycentric samples on every source TRIANGLE; also accumulate
    //     an edge-length-based spacing estimate per triangle.
    const std::size_t nt = src.indices.size() / 3;
    for (std::size_t t = 0; t < nt; ++t) {
        const Vec3 a = vertexOf(src.positions, src.indices[3 * t + 0]);
        const Vec3 b = vertexOf(src.positions, src.indices[3 * t + 1]);
        const Vec3 c = vertexOf(src.positions, src.indices[3 * t + 2]);

        // Mean spacing proxy: average edge length of this triangle, scaled down
        // by the sub-grid resolution implied by the sample count.
        const double e0 = dist(a, b), e1 = dist(b, c), e2 = dist(c, a);
        const double meanEdge = (e0 + e1 + e2) / 3.0;
        // grid resolution g used by interiorBarycentric for this density:
        std::uint32_t g = 1;
        if (params.facesSamples > 0) {
            g = 2;
            while (((g - 1) * (g - 2)) / 2 < params.facesSamples) ++g;
        }
        sumSpacing += meanEdge / static_cast<double>(g);
        ++spacingCount;

        for (const auto& w : bary) {
            const Vec3 p{
                w[0] * a.x + w[1] * b.x + w[2] * c.x,
                w[0] * a.y + w[1] * b.y + w[2] * c.y,
                w[0] * a.z + w[1] * b.z + w[2] * c.z};
            const Eval e = evalSample(p, dstTree);
            if (!e.ok) return false;
            sumD += e.d; sumD2 += e.d * e.d; ++count;
            if (e.d > maxD) { maxD = e.d; argSample = e.sample; argClosest = e.closest; }
        }
    }

    if (count == 0) return false;     // unreachable given >=1 triangle, but honest

    out.maxDistance   = (maxD < 0.0) ? 0.0 : maxD;
    out.meanDistance  = sumD / static_cast<double>(count);
    out.rmsDistance   = std::sqrt(sumD2 / static_cast<double>(count));
    out.argmaxPoint   = argSample;
    out.argmaxClosest = argClosest;
    out.sampleCount   = count;
    return true;
}

// Build an AABBTree over a soup. Returns true iff the tree built (the AABBTree
// itself enforces: multiple-of-3, in-range indices, finite coords, no zero-area
// triangle). On failure `tree` is left empty.
bool buildTree(const SoupRef& s, geom::AABBTree& tree) {
    return tree.build(s.positions, s.indices, geom::SplitMethod::Median);
}

} // namespace

// ---------------------------------------------------------------------------
bool directedHausdorff(const SoupRef& src, const geom::AABBTree& dstTree,
                       const HausdorffParams& params, DirectedDistance& out) {
    double sumSpacing = 0.0;
    std::size_t spacingCount = 0;
    return directedCore(src, dstTree, params, out, sumSpacing, spacingCount);
}

bool directedHausdorff(const SoupRef& src, const SoupRef& dst,
                       const HausdorffParams& params, DirectedDistance& out) {
    out = DirectedDistance{};
    geom::AABBTree dstTree;
    if (!buildTree(dst, dstTree)) return false;
    double sumSpacing = 0.0;
    std::size_t spacingCount = 0;
    return directedCore(src, dstTree, params, out, sumSpacing, spacingCount);
}

// ---------------------------------------------------------------------------
HausdorffResult hausdorffDistance(const SoupRef& a, const SoupRef& b,
                                  const HausdorffParams& params) {
    HausdorffResult r;

    // Both sides must be valid SOURCES (we sample both) and valid TARGETS (we
    // build a tree on both). Validate sources up front for a precise reason.
    const char* whyA = validateSource(a);
    if (whyA != nullptr) { r.reason = whyA; return r; }
    const char* whyB = validateSource(b);
    if (whyB != nullptr) { r.reason = whyB; return r; }

    geom::AABBTree treeA, treeB;
    if (!buildTree(a, treeA)) { r.reason = "mesh A is not a valid AABBTree soup (e.g. zero-area triangle)"; return r; }
    if (!buildTree(b, treeB)) { r.reason = "mesh B is not a valid AABBTree soup (e.g. zero-area triangle)"; return r; }

    double spcAB = 0.0, spcBA = 0.0;
    std::size_t spcCntAB = 0, spcCntBA = 0;

    if (!directedCore(a, treeB, params, r.aToB, spcAB, spcCntAB)) {
        r.reason = "directed A->B failed";
        return r;
    }
    if (!directedCore(b, treeA, params, r.bToA, spcBA, spcCntBA)) {
        r.reason = "directed B->A failed";
        return r;
    }

    r.ok = true;
    r.hausdorff = std::max(r.aToB.maxDistance, r.bToA.maxDistance);

    // Sample-count-weighted symmetric mean and RMS over both directions.
    const std::size_t nA = r.aToB.sampleCount;
    const std::size_t nB = r.bToA.sampleCount;
    const std::size_t nTot = nA + nB;
    if (nTot > 0) {
        const double wsumMean =
            r.aToB.meanDistance * static_cast<double>(nA) +
            r.bToA.meanDistance * static_cast<double>(nB);
        r.meanDistance = wsumMean / static_cast<double>(nTot);

        // RMS combines the two mean-squares by sample count.
        const double ms =
            (r.aToB.rmsDistance * r.aToB.rmsDistance * static_cast<double>(nA) +
             r.bToA.rmsDistance * r.bToA.rmsDistance * static_cast<double>(nB)) /
            static_cast<double>(nTot);
        r.rmsDistance = std::sqrt(std::max(0.0, ms));
    }

    r.totalSamples = nTot;

    const std::size_t spcCnt = spcCntAB + spcCntBA;
    if (spcCnt > 0) {
        r.meanSampleSpacing = (spcAB + spcBA) / static_cast<double>(spcCnt);
    }

    return r;
}

} // namespace mesh
} // namespace native
} // namespace forge
