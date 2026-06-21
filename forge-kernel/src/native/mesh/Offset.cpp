// forge/native/mesh/Offset.cpp
//
// Implementation of forge::native::mesh::Offset — uniform vertex-normal mesh
// offset / shell. Pure C++20, no external dependencies. See Offset.hpp for the
// honest scope statement and robustness posture.
//
// PIPELINE
//   1. Build the input soup into a HalfEdgeMesh and require validate().isValid()
//      (closed 2-manifold) — the precondition for a well-defined offset.
//   2. Compute area-weighted vertex normals: each incident triangle contributes
//      its raw cross product (= 2·area·unit-normal), so larger faces weigh more.
//      The orientation of these normals follows the mesh winding (CCW => outward),
//      which the input validity check has already pinned down.
//   3. Displace each vertex by  distance * normalize(vertexNormal).  A vertex
//      with zero incident area is degenerate => ok=false.
//   4. Re-wire the displaced soup through buildFromSoup and re-audit with
//      validate(). The face/vertex/edge connectivity is UNCHANGED by a pure
//      vertex move, so a valid input that stays embedded re-validates trivially;
//      a self-intersecting collapse is caught by the geometric pass in step 5.
//   5. Light validity / collapse pass:
//        * the result must be a closed 2-manifold (validate()), AND
//        * the signed volume must keep the input's sign and be non-degenerate,
//          AND no wholesale (>50%) face-normal inversion may have occurred.
//      Any of these failing on a shrink (or grow) yields an HONEST ok=false.

#include "forge/native/mesh/Offset.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

namespace {

// Raw (un-normalized) triangle normal = (b-a) x (c-a). Its magnitude is twice
// the triangle area, so summing these over a vertex's incident faces yields a
// genuinely AREA-WEIGHTED accumulation with no extra weighting factor.
inline Vec3 rawTriNormal(const Vec3& a, const Vec3& b, const Vec3& c) {
    const double ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const double vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    return Vec3{ uy * vz - uz * vy,
                uz * vx - ux * vz,
                ux * vy - uy * vx };
}

inline double dot(const Vec3& p, const Vec3& q) {
    return p.x * q.x + p.y * q.y + p.z * q.z;
}

inline double length(const Vec3& v) {
    return std::sqrt(dot(v, v));
}

// Per-face raw normal of triangle f in the soup (indexed by the same winding the
// half-edge mesh uses). Returns the cross product (length = 2*area).
inline Vec3 faceRawNormal(const std::vector<double>& pos,
                          const std::vector<std::uint32_t>& idx,
                          std::size_t f) {
    const std::uint32_t i0 = idx[3 * f + 0];
    const std::uint32_t i1 = idx[3 * f + 1];
    const std::uint32_t i2 = idx[3 * f + 2];
    const Vec3 a{pos[3 * i0 + 0], pos[3 * i0 + 1], pos[3 * i0 + 2]};
    const Vec3 b{pos[3 * i1 + 0], pos[3 * i1 + 1], pos[3 * i1 + 2]};
    const Vec3 c{pos[3 * i2 + 0], pos[3 * i2 + 1], pos[3 * i2 + 2]};
    return rawTriNormal(a, b, c);
}

} // namespace

std::vector<Vec3> areaWeightedVertexNormals(const std::vector<double>& positions,
                                            const std::vector<std::uint32_t>& indices) {
    std::vector<Vec3> normals;
    if (positions.size() % 3 != 0 || indices.size() % 3 != 0) return normals;
    const std::size_t numV = positions.size() / 3;
    const std::size_t numF = indices.size() / 3;
    normals.assign(numV, Vec3{0.0, 0.0, 0.0});

    for (std::size_t f = 0; f < numF; ++f) {
        const std::uint32_t i0 = indices[3 * f + 0];
        const std::uint32_t i1 = indices[3 * f + 1];
        const std::uint32_t i2 = indices[3 * f + 2];
        if (i0 >= numV || i1 >= numV || i2 >= numV) continue;  // skip OOB face
        const Vec3 n = faceRawNormal(positions, indices, f);   // weight = 2*area
        for (std::uint32_t vi : {i0, i1, i2}) {
            normals[vi].x += n.x;
            normals[vi].y += n.y;
            normals[vi].z += n.z;
        }
    }
    return normals;
}

OffsetResult offsetMesh(const std::vector<double>& positions,
                        const std::vector<std::uint32_t>& indices,
                        double distance) {
    OffsetResult result;

    // ---- 1. parse + require a closed 2-manifold input ---------------------
    if (positions.size() % 3 != 0) { result.reason = "positions length not a multiple of 3"; return result; }
    if (indices.size() % 3 != 0)   { result.reason = "indices length not a multiple of 3";   return result; }
    if (indices.empty())           { result.reason = "no triangles in input";                return result; }

    HalfEdgeMesh inMesh;
    if (!inMesh.buildFromSoup(positions, indices)) {
        result.reason = "input soup failed to build (bad index / non-manifold winding)";
        return result;
    }
    const ValidityReport inRep = inMesh.validate();
    if (!inRep.isValid()) {
        result.reason = "input is not a closed 2-manifold (offset is undefined)";
        return result;
    }

    const double inVol = inMesh.signedVolume();
    result.inputVolume = inVol;
    result.numVertices = static_cast<std::uint32_t>(positions.size() / 3);
    result.numFaces    = static_cast<std::uint32_t>(indices.size() / 3);

    // A valid closed solid must enclose non-zero volume; our outward/inward sense
    // is keyed to the input's sign, so a zero-volume input is degenerate.
    if (std::fabs(inVol) < 1e-300) {
        result.reason = "input encloses zero signed volume (degenerate solid)";
        return result;
    }

    // ---- 2. area-weighted vertex normals ----------------------------------
    const std::vector<Vec3> vnorm = areaWeightedVertexNormals(positions, indices);
    if (vnorm.size() != positions.size() / 3) {
        result.reason = "internal: vertex-normal count mismatch";
        return result;
    }

    // ---- 3. displace every vertex along its unit normal -------------------
    // Sign convention: with CCW (outward) winding the raw cross products point
    // outward, so signedVolume() > 0. To make distance>0 ALWAYS grow regardless
    // of the input's stored orientation, scale the displacement by sign(inVol).
    const double orient = (inVol > 0.0) ? 1.0 : -1.0;

    std::vector<double> outPos = positions;  // same connectivity, moved coords
    for (std::size_t v = 0; v < vnorm.size(); ++v) {
        const double len = length(vnorm[v]);
        if (!(len > 0.0) || !std::isfinite(len)) {
            result.reason = "degenerate vertex normal (zero incident area / non-finite)";
            return result;
        }
        const double s = orient * distance / len;  // (distance / |n|) along unit n
        outPos[3 * v + 0] += vnorm[v].x * s;
        outPos[3 * v + 1] += vnorm[v].y * s;
        outPos[3 * v + 2] += vnorm[v].z * s;
        if (!std::isfinite(outPos[3 * v + 0]) ||
            !std::isfinite(outPos[3 * v + 1]) ||
            !std::isfinite(outPos[3 * v + 2])) {
            result.reason = "non-finite coordinate after displacement";
            return result;
        }
    }

    // ---- 4. re-wire + re-audit (connectivity is unchanged) ----------------
    HalfEdgeMesh outMesh;
    if (!outMesh.buildFromSoup(outPos, indices)) {
        // A pure vertex move keeps the index winding, so the only way this fails
        // is a coordinate that produced a zero-area / duplicate-collapsed face
        // through the build's degeneracy checks — an honest collapse.
        result.reason = "displaced soup failed to rebuild (collapsed face / degeneracy)";
        return result;
    }
    const ValidityReport outRep = outMesh.validate();
    if (!outRep.isValid()) {
        result.reason = "offset mesh is not a closed 2-manifold (offset folded the surface)";
        return result;
    }

    const double outVol = outMesh.signedVolume();
    result.outputVolume = outVol;

    // ---- 5. light geometric validity / collapse pass ----------------------
    // (a) volume sign must be preserved — a flip means the solid turned inside out.
    if ((inVol > 0.0) != (outVol > 0.0)) {
        result.reason = "signed-volume sign flipped (shrink collapsed/inverted the solid)";
        return result;
    }
    // (b) a non-degenerate output must still enclose a real volume.
    if (std::fabs(outVol) < 1e-12 * std::fabs(inVol)) {
        result.reason = "offset collapsed the enclosed volume to ~0 (shrink too deep)";
        return result;
    }

    // (c) face-normal inversion check — the local self-intersection signal.
    // A vertex-normal offset of a SOUND closed solid translates every vertex
    // without ever turning a triangle inside-out: empirically (validated in the
    // gate across grow AND shrink, all tessellation levels, down to a 0.15·r
    // sphere) a non-collapsing offset leaves EXACTLY ZERO faces inverted. The
    // first triangle to flip is the surface folding through itself — a local
    // self-intersection — even when the GLOBAL signed volume is still positive.
    // So ANY inverted face is rejected: this is mesh-intrinsic (not sphere-
    // specific) and catches the near-singular `|d| ~ r` collapse that slips
    // through the volume-sign test (where the folded blob keeps a tiny positive
    // volume). A face whose area degenerated to ~0 (l1==0) is likewise a fold.
    const std::size_t numF = indices.size() / 3;
    std::uint32_t flipped = 0;
    for (std::size_t f = 0; f < numF; ++f) {
        const Vec3 n0 = faceRawNormal(positions, indices, f);
        const Vec3 n1 = faceRawNormal(outPos,    indices, f);
        const double l0 = length(n0), l1 = length(n1);
        if (!(l0 > 0.0) || !(l1 > 0.0)) { ++flipped; continue; }  // degenerate face
        if (dot(n0, n1) < 0.0) ++flipped;                          // inverted face
    }
    result.flippedFaces = flipped;
    if (flipped > 0) {  // any inversion => the offset surface folded (collapsed)
        result.reason = "face normal inverted (offset folded the surface / collapsed)";
        return result;
    }

    // ---- success: a validated closed 2-manifold offset --------------------
    result.mesh   = std::move(outMesh);
    result.ok     = true;
    result.reason = "";
    return result;
}

OffsetResult offsetMesh(const HalfEdgeMesh& input, double distance) {
    OffsetResult result;
    // The mesh must already be a valid closed 2-manifold.
    if (!input.validate().isValid()) {
        result.reason = "input HalfEdgeMesh is not a closed 2-manifold";
        return result;
    }
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    input.toSoup(pos, idx);
    return offsetMesh(pos, idx, distance);
}

} // namespace mesh
} // namespace native
} // namespace forge
