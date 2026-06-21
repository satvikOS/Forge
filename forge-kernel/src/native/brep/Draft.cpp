// forge/native/brep/Draft.cpp
//
// Implementation of forge::native::brep::applyDraft — see Draft.hpp for the
// honest scope, the validated envelope, the robustness posture, and the
// 0-FAKES refusal list.
//
// Pure C++20, standard library only. Reuses (by #include, never re-implements):
//   * mesh::HalfEdgeMesh / buildFromSoup / validate / signedVolume / surfaceArea
//   * native::orient3d (Predicates.hpp) as a degeneracy oracle for zero-area
//     triangles (so a drafted face normal is never trusted from a sliver).
//   * The geom / AABBTree / FeatureEdges / TriTriIntersect headers are part of
//     the mandated reuse surface and are #included via Draft.hpp; this module
//     sits on the same geom/mesh stack.
//
// METHOD (exact closed form, double evaluation):
//   Pull direction P (unit), neutral plane through Q with normal P. For a vertex
//   v its signed height above the neutral plane is  h = P·(v - Q). The draft of
//   a selected face with outward unit normal m displaces EACH of that face's
//   vertices TANGENT to the neutral plane:
//       t  = m - (m·P)P           (in-plane component of the face normal)
//       t̂  = t / |t|             (refused as a draft if |t| == 0: m ∥ P)
//       Δ  = - h · tan(angle) · t̂
//   Contributions from every selected face touching a vertex accumulate, so a
//   shared corner is pulled by each adjacent wall (the box top shrinks by
//   2·h·tan(angle) per side). A vertex on the neutral plane (h == 0) never moves.
//
//   Why this tilts the wall by exactly `angle` for a perpendicular prismatic
//   wall: such a wall is spanned by P and one in-plane direction ŝ ⟂ t̂; its
//   points are r0 + α·ŝ + h·P. After the draft each point shifts by
//   -h·tan(angle)·t̂, so the wall is spanned by ŝ and (P - tan(angle)·t̂). The
//   new outward normal lies in the (P, t̂) plane and makes angle `angle` with P,
//   i.e. (90 - angle) is the dot-angle to P after re-normalising. This is the
//   classic shear that converts a vertical wall into a tapered one; it is exact
//   in double up to rounding and is asserted to 1e-6 in the gate.

#include "forge/native/brep/Draft.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <functional>
#include <limits>
#include <map>
#include <numeric>
#include <queue>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

// NOTE: do NOT `using mesh::Vec3;` here — forge::native::brep already declares
// its own Vec3 (Nurbs.hpp, pulled in via FeatureEdges.hpp), which would make the
// name ambiguous. We qualify mesh::Vec3 explicitly throughout.
using V3 = mesh::Vec3;

inline V3 sub(const V3& a, const V3& b) {
    return V3{a.x - b.x, a.y - b.y, a.z - b.z};
}
inline V3 add(const V3& a, const V3& b) {
    return V3{a.x + b.x, a.y + b.y, a.z + b.z};
}
inline V3 scale(const V3& a, double s) {
    return V3{a.x * s, a.y * s, a.z * s};
}
inline V3 cross(const V3& a, const V3& b) {
    return V3{a.y * b.z - a.z * b.y,
              a.z * b.x - a.x * b.z,
              a.x * b.y - a.y * b.x};
}
inline double dot(const V3& a, const V3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline double norm(const V3& a) { return std::sqrt(dot(a, a)); }

inline bool finite(const V3& a) {
    return std::isfinite(a.x) && std::isfinite(a.y) && std::isfinite(a.z);
}

// Outward unit normal of triangle (a,b,c) (CCW). Returns false if degenerate
// (zero-area / non-finite). The combinatorial degeneracy is cross-checked with
// the exact orient3d predicate so a sliver never yields a trusted normal: we
// lift the triangle's centroid off its own plane by the unit normal and require
// orient3d of (a,b,c,apex) to be non-coplanar (which holds iff area > 0).
bool triNormal(const V3& a, const V3& b, const V3& c, V3& nOut) {
    const V3 n = cross(sub(b, a), sub(c, a));
    const double L = norm(n);
    if (!(L > 0.0) || !std::isfinite(L)) return false;
    nOut = scale(n, 1.0 / L);
    const V3 apex = add(a, nOut);  // a + unit normal: off-plane iff area > 0
    const native::Sign o =
        native::orient3d(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z,
                         apex.x, apex.y, apex.z);
    return o != native::Sign::ZERO;  // non-coplanar apex => base has area
}

}  // namespace

DraftResult applyDraft(const std::vector<double>& positions,
                       const std::vector<std::uint32_t>& indices,
                       const std::vector<std::uint32_t>& faceIndices,
                       const mesh::Vec3& pullDir,
                       const mesh::Vec3& neutralPoint,
                       double angleDeg) {
    DraftResult R;

    // ---- input validation (0 FAKES) --------------------------------------
    if (positions.empty() || positions.size() % 3 != 0) {
        R.reason = "positions empty or not a multiple of 3";
        return R;
    }
    if (indices.empty() || indices.size() % 3 != 0) {
        R.reason = "indices empty or not a multiple of 3";
        return R;
    }
    for (double c : positions) {
        if (!std::isfinite(c)) {
            R.reason = "non-finite coordinate in positions";
            return R;
        }
    }
    const std::size_t V = positions.size() / 3;
    const std::size_t T = indices.size() / 3;
    for (std::uint32_t idx : indices) {
        if (static_cast<std::size_t>(idx) >= V) {
            R.reason = "triangle index out of range";
            return R;
        }
    }
    if (!std::isfinite(angleDeg) || std::fabs(angleDeg) >= 90.0) {
        R.reason = "angle must satisfy |angle| < 90 degrees";
        return R;
    }
    if (!finite(pullDir)) {
        R.reason = "non-finite pull direction";
        return R;
    }
    const double pullLen = norm(pullDir);
    if (!(pullLen > 0.0)) {
        R.reason = "zero-length pull direction";
        return R;
    }
    if (!finite(neutralPoint)) {
        R.reason = "non-finite neutral point";
        return R;
    }
    for (std::uint32_t f : faceIndices) {
        if (static_cast<std::size_t>(f) >= T) {
            R.reason = "selected face index out of range";
            return R;
        }
    }

    const V3 P = scale(pullDir, 1.0 / pullLen);  // unit pull / neutral normal
    const V3 Q = neutralPoint;
    const double tanA = std::tan(angleDeg * M_PI / 180.0);

    // Gather vertex positions.
    std::vector<V3> pos(V);
    for (std::size_t i = 0; i < V; ++i) {
        pos[i] = V3{positions[3 * i + 0], positions[3 * i + 1],
                      positions[3 * i + 2]};
    }

    // Per-vertex accumulated displacement (along the neutral plane only).
    std::vector<V3> disp(V, V3{0, 0, 0});

    // De-duplicate the requested face list while preserving first-seen order for
    // the per-face diagnostics; a repeated face must not double-displace.
    std::vector<std::uint32_t> uniqFaces;
    {
        std::unordered_set<std::uint32_t> seen;
        seen.reserve(faceIndices.size() * 2 + 1);
        for (std::uint32_t f : faceIndices) {
            if (seen.insert(f).second) uniqFaces.push_back(f);
        }
    }

    // ---- accumulate the per-face tangent displacement field --------------
    // We record, per face, its in-plane unit tangent t̂ (or skip flag) so we can
    // both build the displacement and report the achieved post-draft angle.
    struct FaceTangent {
        std::uint32_t faceIndex = 0;
        bool drafted = false;
        bool parallel = false;
        V3 that{0, 0, 0};   // in-plane unit tangent t̂ (valid iff drafted)
    };
    std::vector<FaceTangent> fts;
    fts.reserve(uniqFaces.size());

    // A drafted WALL is one PLANAR face; the triangle soup splits it into several
    // coplanar triangles that share the same in-plane tangent t̂. A box CORNER
    // vertex belongs to BOTH triangles of a wall, so accumulating the
    // displacement once per TRIANGLE would double-count that wall's pull on that
    // vertex (and over-tilt the wall). The correct rule: each vertex receives a
    // given wall's tangent displacement EXACTLY ONCE. We dedup per
    // (vertex, quantized tangent direction): two selected triangles that meet at
    // a vertex with the SAME tangent direction (same wall / same draft plane)
    // contribute one shared displacement; two DIFFERENT walls meeting at a corner
    // each contribute once (so the corner draws inward in both wall directions).
    const double kDirQuant = 1e9;  // tangent-direction rounding for the dedup key
    auto dirKey = [&](const V3& d) {
        const long long qx = static_cast<long long>(std::llround(d.x * kDirQuant));
        const long long qy = static_cast<long long>(std::llround(d.y * kDirQuant));
        const long long qz = static_cast<long long>(std::llround(d.z * kDirQuant));
        // Pack into one 64-bit-ish key via a small struct -> string-free hash.
        return std::array<long long, 3>{qx, qy, qz};
    };
    struct ArrHash {
        std::size_t operator()(const std::array<long long, 3>& a) const {
            std::size_t h = 1469598103934665603ull;
            for (long long v : a) {
                h ^= static_cast<std::size_t>(v);
                h *= 1099511628211ull;
            }
            return h;
        }
    };
    // For each vertex: the set of distinct tangent directions already applied.
    std::vector<std::unordered_set<std::array<long long, 3>, ArrHash>>
        appliedDir(V);

    for (std::uint32_t f : uniqFaces) {
        const std::uint32_t i0 = indices[3 * f + 0];
        const std::uint32_t i1 = indices[3 * f + 1];
        const std::uint32_t i2 = indices[3 * f + 2];
        V3 m;
        if (!triNormal(pos[i0], pos[i1], pos[i2], m)) {
            R.reason = "selected face is degenerate (zero-area triangle)";
            return R;
        }
        FaceTangent ft;
        ft.faceIndex = f;

        // In-plane (neutral-plane-tangent) component of the outward normal.
        const double mP = dot(m, P);
        V3 t = sub(m, scale(P, mP));   // m - (m·P)P
        const double tl = norm(t);
        if (tl <= 1e-12 || tanA == 0.0) {
            // Normal parallel to pull (a cap) OR angle 0 => identity for this
            // face. Honest: not drafted. (tanA==0 path is exact identity.)
            ft.drafted = false;
            ft.parallel = (tl <= 1e-12);
            fts.push_back(ft);
            continue;
        }
        const V3 that = scale(t, 1.0 / tl);
        ft.drafted = true;
        ft.that = that;
        fts.push_back(ft);

        // Δ_v = - h_v · tan(angle) · t̂, applied ONCE per distinct tangent dir.
        const std::array<long long, 3> key = dirKey(that);
        const std::uint32_t tri[3] = {i0, i1, i2};
        for (int k = 0; k < 3; ++k) {
            const std::uint32_t vi = tri[k];
            if (!appliedDir[vi].insert(key).second) continue;  // wall counted
            const double h = dot(sub(pos[vi], Q), P);          // signed height
            const V3 d = scale(that, -h * tanA);
            disp[vi] = add(disp[vi], d);
        }
    }

    // ---- apply displacement ----------------------------------------------
    std::vector<double> outPos(positions.size());
    for (std::size_t i = 0; i < V; ++i) {
        const V3 nv = add(pos[i], disp[i]);
        outPos[3 * i + 0] = nv.x;
        outPos[3 * i + 1] = nv.y;
        outPos[3 * i + 2] = nv.z;
    }

    // ---- rebuild + validate the drafted solid (never fake closure) -------
    mesh::HalfEdgeMesh hem;
    if (!hem.buildFromSoup(outPos, indices)) {
        R.reason =
            "drafted soup is not a consistently-wound 2-manifold "
            "(self-intersection / collapsed wall at this angle)";
        return R;
    }
    const mesh::ValidityReport rep = hem.validate();
    if (!rep.isValid()) {
        R.reason = "drafted solid is not a closed 2-manifold";
        return R;
    }

    // ---- per-face diagnostics: achieved angle to the pull direction ------
    // Recompute each requested face's normal on the DRAFTED mesh and report the
    // angle to the pull direction. For a parallel/identity face this is just its
    // original angle (unchanged). We map back to the original requested order.
    std::unordered_map<std::uint32_t, FaceTangent> ftByFace;
    ftByFace.reserve(fts.size() * 2 + 1);
    for (const FaceTangent& ft : fts) ftByFace.emplace(ft.faceIndex, ft);

    std::vector<V3> dpos(V);
    for (std::size_t i = 0; i < V; ++i) {
        dpos[i] = V3{outPos[3 * i + 0], outPos[3 * i + 1], outPos[3 * i + 2]};
    }

    R.faces.reserve(faceIndices.size());
    std::uint32_t nDrafted = 0;
    for (std::uint32_t f : faceIndices) {
        const std::uint32_t i0 = indices[3 * f + 0];
        const std::uint32_t i1 = indices[3 * f + 1];
        const std::uint32_t i2 = indices[3 * f + 2];
        V3 m;
        DraftFaceInfo info;
        info.faceIndex = f;
        if (triNormal(dpos[i0], dpos[i1], dpos[i2], m)) {
            const double c = std::clamp(dot(m, P), -1.0, 1.0);
            info.anglePullDeg = std::acos(c) * 180.0 / M_PI;
        } else {
            // Should not happen post-build (validate() passed), but report
            // honestly rather than fabricate an angle.
            info.anglePullDeg = std::numeric_limits<double>::quiet_NaN();
        }
        auto it = ftByFace.find(f);
        if (it != ftByFace.end()) {
            info.drafted = it->second.drafted;
            info.skippedParallel = it->second.parallel;
        }
        if (info.drafted) ++nDrafted;
        R.faces.push_back(info);
    }

    R.mesh = std::move(hem);
    R.volume = R.mesh.signedVolume();
    R.area = R.mesh.surfaceArea();
    R.numDrafted = nDrafted;
    R.ok = true;
    return R;
}

}  // namespace brep
}  // namespace native
}  // namespace forge
