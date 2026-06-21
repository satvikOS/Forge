// forge/native/mesh/WallThickness.cpp
//
// Implementation of forge::native::mesh::analyzeWallThickness — see
// WallThickness.hpp for the honest scope statement. Pure C++20, standard
// library only. No OCCT, no WASM, no third-party libs. Builds ONLY on the
// existing forge native headers (HalfEdgeMesh for validation + Vec3, and
// geom/AABBTree for the accelerated inward ray query).
//
// METHOD (the ray / opposite-wall gauge):
//   1. Reject dishonest-to-accept input (ragged arrays, empty, non-finite,
//      out-of-range indices, non-watertight) up front via the HalfEdgeMesh
//      validator and direct soup checks.
//   2. Build a geom::AABBTree over the SAME soup so each inward ray is an
//      O(log n) query.
//   3. For each input vertex, accumulate the AREA-WEIGHTED incident face
//      normals to get a smooth OUTWARD normal (the soup is wound CCW-outside,
//      so cross(b-a, c-a) points outward). The inward probe direction is the
//      negated unit of that.
//   4. Nudge the ray origin a model-scaled eps INWARD (off the surface) and
//      take the nearest forward hit beyond eps — this skips the vertex's own
//      incident triangles. The local thickness is (eps + hit_t) measured from
//      the true surface sample.
//   5. Aggregate: global min (+location +normal), max, mean, and the full
//      per-vertex field.

#include "forge/native/mesh/WallThickness.hpp"

#include "forge/native/mesh/HalfEdgeMesh.hpp"   // HalfEdgeMesh, validate, Vec3
#include "forge/native/geom/AABBTree.hpp"       // geom::AABBTree, RayHit

#include <algorithm>   // std::min, std::max
#include <cmath>       // std::sqrt, std::isfinite, std::fabs
#include <cstddef>     // std::size_t
#include <cstdint>     // std::uint32_t
#include <limits>      // std::numeric_limits
#include <vector>      // std::vector

namespace forge {
namespace native {
namespace mesh {

namespace {

// ----- tiny local vector helpers (do not leak symbols) ---------------------
inline Vec3 vsub(const Vec3& a, const Vec3& b) {
    return {a.x - b.x, a.y - b.y, a.z - b.z};
}
inline Vec3 vadd(const Vec3& a, const Vec3& b) {
    return {a.x + b.x, a.y + b.y, a.z + b.z};
}
inline Vec3 vscale(const Vec3& a, double s) {
    return {a.x * s, a.y * s, a.z * s};
}
inline double vdot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline Vec3 vcross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double vlen(const Vec3& a) { return std::sqrt(vdot(a, a)); }

} // namespace

WallThicknessResult analyzeWallThickness(const std::vector<double>& positions,
                                         const std::vector<std::uint32_t>& indices) {
    WallThicknessResult out;

    // ---- (R) honest input validation ------------------------------------
    if (positions.size() % 3 != 0) { out.reason = "positions length not a multiple of 3"; return out; }
    if (indices.size() % 3 != 0)   { out.reason = "indices length not a multiple of 3"; return out; }
    if (positions.empty())         { out.reason = "empty positions"; return out; }
    if (indices.empty())           { out.reason = "empty indices (no triangles)"; return out; }

    const std::size_t numVerts = positions.size() / 3;
    const std::size_t numTris  = indices.size() / 3;

    for (double v : positions) {
        if (!std::isfinite(v)) { out.reason = "non-finite coordinate"; return out; }
    }
    for (std::uint32_t i : indices) {
        if (i >= numVerts) { out.reason = "index out of range"; return out; }
    }

    // The "shoot inward to the opposite wall" gauge is only well-defined for a
    // closed, consistently-wound, 2-manifold solid. Use the existing validator
    // as the single source of truth — do NOT re-derive watertightness here.
    HalfEdgeMesh hem;
    if (!hem.buildFromSoup(positions, indices)) {
        out.reason = "buildFromSoup failed (degenerate face / inconsistent winding)";
        return out;
    }
    const ValidityReport rep = hem.validate();
    if (!rep.isValid()) {
        out.reason = "mesh is not a watertight 2-manifold solid";
        return out;
    }

    // Orientation sign: signedVolume() > 0 means CCW-outward winding, so the
    // face normal cross(b-a, c-a) points OUTWARD. If the solid was wound the
    // other way (negative volume), flip so our "outward" is genuinely outward.
    const double signedVol = hem.signedVolume();
    if (signedVol == 0.0) { out.reason = "zero signed volume (degenerate solid)"; return out; }
    const double orient = (signedVol > 0.0) ? 1.0 : -1.0;

    // ---- model scale (for the unit-invariant self-hit nudge) -------------
    double minc[3] = { std::numeric_limits<double>::infinity(),
                       std::numeric_limits<double>::infinity(),
                       std::numeric_limits<double>::infinity() };
    double maxc[3] = { -std::numeric_limits<double>::infinity(),
                       -std::numeric_limits<double>::infinity(),
                       -std::numeric_limits<double>::infinity() };
    for (std::size_t i = 0; i < numVerts; ++i) {
        for (int a = 0; a < 3; ++a) {
            const double c = positions[3 * i + static_cast<std::size_t>(a)];
            minc[a] = std::min(minc[a], c);
            maxc[a] = std::max(maxc[a], c);
        }
    }
    const double diag = vlen(Vec3{maxc[0] - minc[0], maxc[1] - minc[1], maxc[2] - minc[2]});
    if (!(diag > 0.0)) { out.reason = "zero-extent bounding box"; return out; }
    // Nudge the ray off the surface by a small fraction of the model diagonal so
    // we skip the sample's own incident faces. Small enough not to perturb the
    // measured thickness beyond the coarse-mesh tolerance.
    const double eps = diag * 1e-7;

    // ---- accelerated ray structure over the same soup --------------------
    geom::AABBTree tree;
    if (!tree.build(positions, indices, geom::SplitMethod::Median)) {
        out.reason = "AABBTree build failed";
        return out;
    }

    // ---- per-vertex area-weighted OUTWARD normals ------------------------
    std::vector<Vec3> normal(numVerts, Vec3{0.0, 0.0, 0.0});
    for (std::size_t t = 0; t < numTris; ++t) {
        const std::uint32_t ia = indices[3 * t + 0];
        const std::uint32_t ib = indices[3 * t + 1];
        const std::uint32_t ic = indices[3 * t + 2];
        const Vec3 a{positions[3 * ia + 0], positions[3 * ia + 1], positions[3 * ia + 2]};
        const Vec3 b{positions[3 * ib + 0], positions[3 * ib + 1], positions[3 * ib + 2]};
        const Vec3 c{positions[3 * ic + 0], positions[3 * ic + 1], positions[3 * ic + 2]};
        // cross(b-a, c-a): magnitude == 2*area, direction == outward for CCW.
        const Vec3 fn = vscale(vcross(vsub(b, a), vsub(c, a)), orient);
        normal[ia] = vadd(normal[ia], fn);
        normal[ib] = vadd(normal[ib], fn);
        normal[ic] = vadd(normal[ic], fn);
    }

    // ---- inward probe per vertex -----------------------------------------
    out.perVertex.assign(numVerts, VertexThickness{});

    bool   haveMin = false;
    double minTh = std::numeric_limits<double>::infinity();
    std::size_t minVi = 0;
    double sumTh = 0.0, maxTh = 0.0;
    std::size_t measured = 0;

    for (std::size_t i = 0; i < numVerts; ++i) {
        VertexThickness& vt = out.perVertex[i];
        const Vec3 p{positions[3 * i + 0], positions[3 * i + 1], positions[3 * i + 2]};
        vt.position = p;

        const double nlen = vlen(normal[i]);
        if (!(nlen > 0.0) || !std::isfinite(nlen)) {
            // No well-defined normal (e.g. opposing faces cancelling) — cannot
            // probe this sample. Mark unmeasured honestly; this is NOT a global
            // failure.
            vt.measured = false;
            continue;
        }
        const Vec3 outward = vscale(normal[i], 1.0 / nlen);   // unit outward
        const Vec3 inward  = vscale(outward, -1.0);           // unit inward
        vt.inwardDir = inward;

        // Origin nudged eps inward; require the hit strictly beyond eps so we
        // never count the sample's own incident triangles as the opposite wall.
        const Vec3 origin = vadd(p, vscale(inward, eps));
        const geom::RayHit hit = tree.rayIntersect(origin, inward);
        if (!hit.hit) {
            // No opposite wall in the inward direction (an open detail or the
            // ray exits the body) — honestly unmeasured.
            vt.measured = false;
            continue;
        }
        // Thickness measured from the TRUE surface sample (add back the nudge).
        const double thickness = hit.t + eps;
        if (!(thickness > 0.0) || !std::isfinite(thickness)) {
            vt.measured = false;
            continue;
        }

        vt.measured = true;
        vt.thickness = thickness;
        vt.hitPoint = hit.point;

        ++measured;
        sumTh += thickness;
        maxTh = std::max(maxTh, thickness);
        if (!haveMin || thickness < minTh) {
            haveMin = true;
            minTh = thickness;
            minVi = i;
        }
    }

    out.ok = true;
    out.measuredCount = measured;
    if (haveMin) {
        out.hasMin = true;
        out.minThickness = minTh;
        out.minVertex = minVi;
        out.minLocation = out.perVertex[minVi].position;
        out.minInwardDir = out.perVertex[minVi].inwardDir;
        out.maxThickness = maxTh;
        out.meanThickness = (measured > 0) ? (sumTh / static_cast<double>(measured)) : 0.0;
    }
    return out;
}

} // namespace mesh
} // namespace native
} // namespace forge
