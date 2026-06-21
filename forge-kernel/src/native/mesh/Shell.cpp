// forge/native/mesh/Shell.cpp
//
// Implementation of forge::native::mesh::Shell — shell / hollow a closed
// 2-manifold triangle mesh into a constant-thickness solid wall. Pure C++20, no
// external dependencies. See Shell.hpp for the honest scope and robustness
// posture.
//
// PIPELINE
//   1. Build the input soup into a HalfEdgeMesh and require validate().isValid()
//      (closed 2-manifold) — the precondition for a well-defined shell. Reject
//      thickness <= 0 up front.
//   2. Compute area-weighted vertex normals (each incident triangle contributes
//      its raw cross product = 2*area*unit-normal). With CCW (outward) winding
//      these point OUTWARD; the input validity check has pinned the orientation.
//   3. Build the INNER surface S': displace every vertex INWARD by `thickness`
//      along its unit outward normal (i.e. by -t*normal). This is a pure vertex
//      move on the SAME connectivity, so S' is itself a closed 2-manifold (it
//      re-validates trivially unless the offset folded / collapsed it).
//   4. Collapse / fold guard on S': S' must keep the same volume sign as S, must
//      still enclose a real (non-degenerate) volume, and NO inner face may have
//      inverted (a face flip is a local self-intersection = the wall pinching
//      through itself). Any of these => HONEST ok=false (t too large).
//   5. Combine into the wall soup:
//        outer vertices [0, N)   : S, original CCW winding (normals outward).
//        inner vertices [N, 2N)  : S', REVERSED winding (normals into the wall
//                                  material, away from the cavity).
//      For the CLOSED case the two surfaces are disjoint (no shared directed
//      edge), so the union is a closed 2-manifold; its enclosed signed volume is
//      vol(S) - vol(S') = the wall volume.
//   6. (Optional mouth) If openFace >= 0: drop the named outer triangle AND its
//      inner counterpart, then stitch the two triangular rims with a 6-triangle
//      side band so the wall stays a closed 2-manifold with a real lip.
//   7. Re-wire the wall soup through buildFromSoup and require validate(). The
//      enclosed volume / genus diagnostics are filled from the result.
//
// 0 FAKES: ok==true is returned ONLY when the wall mesh is a confirmed closed
// 2-manifold and the inner offset did not collapse.

#include "forge/native/mesh/Shell.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <utility>
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

// Per-face raw normal of triangle f in the soup (same winding the half-edge mesh
// uses). Returns the cross product (length = 2*area).
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

// Area-weighted vertex normals of a triangle soup: vertex v gets the sum over
// incident triangles of that triangle's raw cross product (weight = 2*area).
// Output length is numVertices; a vertex with zero total incident area gets a
// zero normal (the caller treats that as degenerate).
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

// Genus of a closed orientable surface from its validity report: by Euler's
// formula V - E + F = 2 - 2g (per connected component). For a SINGLE closed
// orientable component this gives g = (2 - chi)/2. Returns 0 when the report is
// not a valid closed surface (caller should not trust it then).
std::uint32_t genusFromEuler(int eulerChar) {
    // chi = 2 - 2g  =>  g = (2 - chi)/2. Clamp at 0 against round-off in chi.
    const int twoG = 2 - eulerChar;
    if (twoG <= 0) return 0;
    return static_cast<std::uint32_t>(twoG / 2);
}

} // namespace

ShellResult shellMesh(const std::vector<double>& positions,
                      const std::vector<std::uint32_t>& indices,
                      double thickness,
                      int openFace) {
    ShellResult result;

    // ---- 1. parse + require a closed 2-manifold input + positive thickness --
    if (positions.size() % 3 != 0) { result.reason = "positions length not a multiple of 3"; return result; }
    if (indices.size() % 3 != 0)   { result.reason = "indices length not a multiple of 3";   return result; }
    if (indices.empty())           { result.reason = "no triangles in input";                return result; }
    if (!(thickness > 0.0) || !std::isfinite(thickness)) {
        result.reason = "thickness must be a positive finite value";
        return result;
    }

    HalfEdgeMesh inMesh;
    if (!inMesh.buildFromSoup(positions, indices)) {
        result.reason = "input soup failed to build (bad index / non-manifold winding)";
        return result;
    }
    const ValidityReport inRep = inMesh.validate();
    if (!inRep.isValid()) {
        result.reason = "input is not a closed 2-manifold (shell is undefined)";
        return result;
    }

    const std::size_t numV = positions.size() / 3;
    const std::size_t numF = indices.size() / 3;
    if (openFace >= 0 && static_cast<std::size_t>(openFace) >= numF) {
        result.reason = "openFace index out of range";
        return result;
    }

    const double outerVol = inMesh.signedVolume();
    result.outerVolume = outerVol;
    result.inputGenus  = genusFromEuler(inRep.eulerChar);

    // A valid closed solid must enclose non-zero volume; the inward sense is
    // keyed to the input's orientation sign, so a zero-volume input is degenerate.
    if (std::fabs(outerVol) < 1e-300) {
        result.reason = "input encloses zero signed volume (degenerate solid)";
        return result;
    }

    // ---- 2. area-weighted vertex normals -----------------------------------
    const std::vector<Vec3> vnorm = areaWeightedVertexNormals(positions, indices);
    if (vnorm.size() != numV) {
        result.reason = "internal: vertex-normal count mismatch";
        return result;
    }

    // ---- 3. build the INNER surface S' (vertices moved inward by t) ---------
    // Sign convention: with CCW (outward) winding the raw cross products point
    // outward, so signedVolume() > 0. To move ALWAYS inward (toward the solid
    // interior) regardless of the input's stored orientation, displace by
    // -t * sign(outerVol) * unit-normal.
    const double orient = (outerVol > 0.0) ? 1.0 : -1.0;

    std::vector<double> innerPos = positions;  // same connectivity, shrunk coords
    for (std::size_t v = 0; v < numV; ++v) {
        const double len = length(vnorm[v]);
        if (!(len > 0.0) || !std::isfinite(len)) {
            result.reason = "degenerate vertex normal (zero incident area / non-finite)";
            return result;
        }
        const double s = -orient * thickness / len;  // (-t / |n|) along unit n (inward)
        innerPos[3 * v + 0] += vnorm[v].x * s;
        innerPos[3 * v + 1] += vnorm[v].y * s;
        innerPos[3 * v + 2] += vnorm[v].z * s;
        if (!std::isfinite(innerPos[3 * v + 0]) ||
            !std::isfinite(innerPos[3 * v + 1]) ||
            !std::isfinite(innerPos[3 * v + 2])) {
            result.reason = "non-finite coordinate after inward displacement";
            return result;
        }
    }

    // The inner surface as its OWN closed mesh (same winding as input) — used
    // both to validate it and to compute the cavity volume.
    HalfEdgeMesh innerMesh;
    if (!innerMesh.buildFromSoup(innerPos, indices)) {
        result.reason = "inner offset soup failed to rebuild (collapsed face / degeneracy)";
        return result;
    }
    const ValidityReport innerRep = innerMesh.validate();
    if (!innerRep.isValid()) {
        result.reason = "inner offset is not a closed 2-manifold (wall folded the surface)";
        return result;
    }
    const double innerVol = innerMesh.signedVolume();
    result.innerVolume = innerVol;
    result.wallVolume  = outerVol - innerVol;

    // ---- 4. collapse / fold guard on S' (t too large => HONEST ok=false) ----
    // (a) volume sign must be preserved — a flip means the cavity turned inside out.
    if ((outerVol > 0.0) != (innerVol > 0.0)) {
        result.reason = "inner-surface volume sign flipped (thickness >= feature size: wall collapsed)";
        return result;
    }
    // (b) the cavity must still enclose a real, strictly smaller volume.
    if (std::fabs(innerVol) >= std::fabs(outerVol)) {
        result.reason = "inner surface did not shrink (degenerate normals / over-thick wall)";
        return result;
    }
    if (std::fabs(innerVol) < 1e-12 * std::fabs(outerVol)) {
        result.reason = "inner cavity collapsed to ~0 volume (thickness too large)";
        return result;
    }
    // (c) inner face-normal inversion check — the local self-intersection signal.
    // A non-collapsing inward offset translates every vertex without turning any
    // triangle inside-out; the first inner triangle to flip is the wall folding
    // through itself even when the GLOBAL cavity volume is still positive.
    {
        std::uint32_t flipped = 0;
        for (std::size_t f = 0; f < numF; ++f) {
            const Vec3 n0 = faceRawNormal(positions, indices, f);
            const Vec3 n1 = faceRawNormal(innerPos,  indices, f);
            const double l0 = length(n0), l1 = length(n1);
            if (!(l0 > 0.0) || !(l1 > 0.0)) { ++flipped; continue; }  // degenerate face
            if (dot(n0, n1) < 0.0) ++flipped;                          // inverted face
        }
        if (flipped > 0) {
            result.reason = "inner face normal inverted (thickness too large: wall self-intersects)";
            return result;
        }
    }

    // ---- 5. assemble the combined WALL soup --------------------------------
    // outer: vertices [0, N), original triangles (CCW outward).
    // inner: vertices [N, 2N), REVERSED triangles (normals into the wall).
    std::vector<double> wallPos;
    wallPos.reserve(numV * 6);
    wallPos.insert(wallPos.end(), positions.begin(), positions.end());   // [0, N)
    wallPos.insert(wallPos.end(), innerPos.begin(),  innerPos.end());    // [N, 2N)

    const std::uint32_t off = static_cast<std::uint32_t>(numV);  // inner-vertex base

    std::vector<std::uint32_t> wallIdx;
    wallIdx.reserve(numF * 6 + (openFace >= 0 ? 18 : 0));

    const std::size_t skip = (openFace >= 0) ? static_cast<std::size_t>(openFace)
                                             : numF + 1;  // never matches when closed

    for (std::size_t f = 0; f < numF; ++f) {
        if (f == skip) continue;  // mouth: omit this outer face
        wallIdx.push_back(indices[3 * f + 0]);
        wallIdx.push_back(indices[3 * f + 1]);
        wallIdx.push_back(indices[3 * f + 2]);
    }
    for (std::size_t f = 0; f < numF; ++f) {
        if (f == skip) continue;  // mouth: omit the matching inner face
        // REVERSED winding (i0,i2,i1) so the inner normal points into the wall.
        wallIdx.push_back(off + indices[3 * f + 2]);
        wallIdx.push_back(off + indices[3 * f + 1]);
        wallIdx.push_back(off + indices[3 * f + 0]);
    }

    // ---- 6. stitch the mouth rim (if a face was opened) --------------------
    // Removed OUTER triangle (a,b,c) CCW has boundary directed edges a->b, b->c,
    // c->a; with that triangle gone those edges are open and need twins b->a,
    // c->b, a->c from the rim. The removed INNER triangle was reversed to
    // (c',b',a') (CCW into the wall), boundary directed edges c'->b', b'->a',
    // a'->c'; it needs twins b'->c', a'->b', c'->a'.
    //
    // For each outer boundary edge u->w (here primed counterparts u', w'), build
    // the side quad (u, w, w', u') and split it into two triangles wound so that:
    //   * the rim's outer-side directed edge is w->u  (twin of outer u->w), and
    //   * the rim's inner-side directed edge is u'->w' (twin of inner w'->u').
    // Triangulation (u, w, w') + (u, w', u') gives directed edges w->u and u'->w'
    // on the boundary and the shared diagonal u<->w' once each way (interior to
    // the band). Walking all three outer edges chains the band into a closed
    // 2-manifold collar; together with the (now-open) outer and inner surfaces
    // the whole wall is closed again.
    if (openFace >= 0) {
        const std::uint32_t a = indices[3 * skip + 0];
        const std::uint32_t b = indices[3 * skip + 1];
        const std::uint32_t c = indices[3 * skip + 2];
        const std::array<std::uint32_t, 3> ring = {a, b, c};  // outer CCW order
        for (int e = 0; e < 3; ++e) {
            const std::uint32_t u = ring[e];
            const std::uint32_t w = ring[(e + 1) % 3];
            const std::uint32_t up = off + u;   // u'  (inner counterpart)
            const std::uint32_t wp = off + w;   // w'
            // triangle 1: (u, w, w')  -> boundary edge w->u twins outer u->w
            wallIdx.push_back(u);
            wallIdx.push_back(w);
            wallIdx.push_back(wp);
            // triangle 2: (u, w', u') -> boundary edge u'->w' twins inner w'->u'
            wallIdx.push_back(u);
            wallIdx.push_back(wp);
            wallIdx.push_back(up);
        }
    }

    // ---- 7. re-wire + require a closed 2-manifold result -------------------
    HalfEdgeMesh wallMesh;
    if (!wallMesh.buildFromSoup(wallPos, wallIdx)) {
        result.reason = "wall soup failed to build (rim winding / shared directed edge)";
        return result;
    }
    const ValidityReport wallRep = wallMesh.validate();
    if (!wallRep.isValid()) {
        result.reason = "shelled wall is not a closed 2-manifold";
        return result;
    }

    // Diagnostics from the assembled result.
    result.numVertices = static_cast<std::uint32_t>(wallPos.size() / 3);
    result.numFaces    = static_cast<std::uint32_t>(wallIdx.size() / 3);
    // For the CLOSED case the result is two disjoint genus-g components; chi is
    // additive so eulerChar = 2*(2-2g). Report per-component genus (== input).
    // For the OPEN case the wall is one connected genus-g handlebody surface; the
    // rim turns the two g-surfaces into a single closed surface of genus g.
    if (openFace >= 0) {
        result.resultGenus = genusFromEuler(wallRep.eulerChar);
    } else {
        // Two components: eulerChar = 2 * chi_component => chi_component = chi/2.
        result.resultGenus = genusFromEuler(wallRep.eulerChar / 2);
    }

    result.mesh   = std::move(wallMesh);
    result.ok     = true;
    result.reason = "";
    return result;
}

ShellResult shellMesh(const HalfEdgeMesh& input, double thickness, int openFace) {
    ShellResult result;
    if (!input.validate().isValid()) {
        result.reason = "input HalfEdgeMesh is not a closed 2-manifold";
        return result;
    }
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    input.toSoup(pos, idx);
    return shellMesh(pos, idx, thickness, openFace);
}

} // namespace mesh
} // namespace native
} // namespace forge
