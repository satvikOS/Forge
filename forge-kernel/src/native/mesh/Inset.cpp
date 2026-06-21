// forge/native/mesh/Inset.cpp
//
// Implementation of forge::native::mesh::Inset — per-face centroid inset of a
// polygon soup. See Inset.hpp for the full honest scope / robustness posture.
//
// Pure C++20, standard library only. No OCCT, no WASM, no third-party libs.
// Every standard header actually used is included explicitly below — a missing
// include compiles on Mac libc++ via transitive includes but FAILS CI's
// libstdc++, so the list is exhaustive (Bible CI-portability rule).

#include "forge/native/mesh/Inset.hpp"

#include <algorithm>     // std::min, std::max
#include <cstddef>       // std::size_t
#include <cmath>         // std::sqrt, std::fabs
#include <cstdint>       // std::uint32_t
#include <limits>        // std::numeric_limits
#include <unordered_set> // std::unordered_set (repeated-index check)
#include <utility>       // std::move
#include <vector>        // std::vector

namespace forge {
namespace native {
namespace mesh {

namespace {

// ── tiny self-contained 3-vector helpers (no external geom dependency) ───────
struct V3 {
    double x = 0.0, y = 0.0, z = 0.0;
};
inline V3 operator+(const V3& a, const V3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 operator-(const V3& a, const V3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 operator*(const V3& a, double s)    { return {a.x * s, a.y * s, a.z * s}; }
inline double dot(const V3& a, const V3& b)   { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3 cross(const V3& a, const V3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double norm(const V3& a) { return std::sqrt(dot(a, a)); }

inline V3 getVertex(const std::vector<double>& pos, std::uint32_t i) {
    return {pos[3u * i + 0u], pos[3u * i + 1u], pos[3u * i + 2u]};
}

// Newell (vector) area of a polygon loop: half the magnitude of the summed edge
// cross products. Exact for planar polygons; magnitude of the signed vector area
// otherwise. Returns 0 for a loop of < 3 vertices.
double newellArea(const std::vector<double>& pos,
                  const std::vector<std::uint32_t>& loop) {
    if (loop.size() < 3) return 0.0;
    V3 acc{0.0, 0.0, 0.0};
    const std::size_t k = loop.size();
    for (std::size_t i = 0; i < k; ++i) {
        const V3 a = getVertex(pos, loop[i]);
        const V3 b = getVertex(pos, loop[(i + 1) % k]);
        acc = acc + cross(a, b);
    }
    return 0.5 * norm(acc);
}

// Centroid (arithmetic mean of the loop vertices).
V3 loopCentroid(const std::vector<double>& pos,
                const std::vector<std::uint32_t>& loop) {
    V3 c{0.0, 0.0, 0.0};
    for (std::uint32_t idx : loop) c = c + getVertex(pos, idx);
    const double inv = loop.empty() ? 0.0 : 1.0 / static_cast<double>(loop.size());
    return c * inv;
}

// The smallest centroid-symmetric extent of a face: the minimum over all
// vertices of 2*|v_i - c| projected sense — but the modeling-correct quantity
// for the centroid inset is the minimum perpendicular distance from the centroid
// to a face EDGE (the in-radius proxy). For a square of side L the centroid is
// L/2 from each edge, so half-extent == L/2 and factor == 1 - 2d/L. We return
// the FULL extent = 2 * (min centroid->edge distance), so factor = 1 - 2d/extent
// matches the documented square law exactly.
//
// `n` is the (unit) face normal used to keep the edge-distance measurement in
// the face plane.
double minCentroidExtent(const std::vector<double>& pos,
                         const std::vector<std::uint32_t>& loop,
                         const V3& c, const V3& n) {
    const std::size_t k = loop.size();
    double best = std::numeric_limits<double>::infinity();
    for (std::size_t i = 0; i < k; ++i) {
        const V3 a = getVertex(pos, loop[i]);
        const V3 b = getVertex(pos, loop[(i + 1) % k]);
        const V3 e = b - a;
        const double elen = norm(e);
        if (elen <= 0.0) continue;
        // Perpendicular (in-plane) distance from centroid c to the infinite line
        // through edge (a,b): |(c-a) x e| / |e|, but measured in the face plane.
        const V3 ca = c - a;
        // Remove any out-of-plane component of ca so the distance is the true
        // in-plane centroid->edge distance (the face may be slightly non-planar).
        const V3 caInPlane = ca - n * dot(ca, n);
        const double dist = norm(cross(caInPlane, e)) / elen;
        best = std::min(best, dist);
    }
    if (!(best < std::numeric_limits<double>::infinity())) return 0.0;
    return 2.0 * best;  // full extent
}

// Best-fit unit normal of a face via Newell's method. Returns false if the face
// is degenerate (near-zero vector area / collinear).
bool faceNormal(const std::vector<double>& pos,
                const std::vector<std::uint32_t>& loop, V3& nOut) {
    if (loop.size() < 3) return false;
    V3 acc{0.0, 0.0, 0.0};
    const std::size_t k = loop.size();
    for (std::size_t i = 0; i < k; ++i) {
        const V3 a = getVertex(pos, loop[i]);
        const V3 b = getVertex(pos, loop[(i + 1) % k]);
        acc = acc + cross(a, b);
    }
    const double len = norm(acc);
    if (len <= 0.0) return false;
    nOut = acc * (1.0 / len);
    return true;
}

// True if a face loop has a repeated index (degenerate topology).
bool hasRepeatedIndex(const std::vector<std::uint32_t>& loop) {
    std::unordered_set<std::uint32_t> seen;
    seen.reserve(loop.size() * 2);
    for (std::uint32_t i : loop) {
        if (!seen.insert(i).second) return true;
    }
    return false;
}

} // namespace

// ── public: polygon area ─────────────────────────────────────────────────────
double polygonArea(const std::vector<double>& positions,
                   const std::vector<std::uint32_t>& loop) {
    return newellArea(positions, loop);
}

// ── public: box builder ──────────────────────────────────────────────────────
PolyMesh makeBox(double L, const Vec3& origin) {
    PolyMesh m;
    const double x0 = origin.x, y0 = origin.y, z0 = origin.z;
    const double x1 = x0 + L, y1 = y0 + L, z1 = z0 + L;
    // 8 corners.
    m.positions = {
        x0, y0, z0,  // 0
        x1, y0, z0,  // 1
        x1, y1, z0,  // 2
        x0, y1, z0,  // 3
        x0, y0, z1,  // 4
        x1, y0, z1,  // 5
        x1, y1, z1,  // 6
        x0, y1, z1,  // 7
    };
    // 6 quad faces, each CCW as seen from OUTSIDE.
    m.faces = {
        {0, 3, 2, 1},  // bottom  (-z), outward normal -z
        {4, 5, 6, 7},  // top     (+z), outward normal +z
        {0, 1, 5, 4},  // front   (-y), outward normal -y
        {1, 2, 6, 5},  // right   (+x), outward normal +x
        {2, 3, 7, 6},  // back    (+y), outward normal +y
        {3, 0, 4, 7},  // left    (-x), outward normal -x
    };
    return m;
}

// ── core implementation ──────────────────────────────────────────────────────
InsetResult insetFaces(const std::vector<double>& positions,
                       const std::vector<std::vector<std::uint32_t>>& faces,
                       double d) {
    InsetResult R;

    // ---- input validation (whole-input failures => ok=false) ----------------
    if (positions.empty() || faces.empty()) {
        R.reason = "empty input (no positions or no faces)";
        return R;
    }
    if (positions.size() % 3u != 0u) {
        R.reason = "ragged positions length (not a multiple of 3)";
        return R;
    }
    const std::uint32_t nv = static_cast<std::uint32_t>(positions.size() / 3u);
    R.inputVertices = nv;
    R.inputFaces    = static_cast<std::uint32_t>(faces.size());

    for (const auto& f : faces) {
        for (std::uint32_t idx : f) {
            if (idx >= nv) {
                R.reason = "face index out of range";
                return R;
            }
        }
    }
    if (d < 0.0) {
        R.reason = "negative inset distance (use a positive inset; outset is a different op)";
        return R;
    }

    // ---- d == 0: faithful no-op (deep copy, ok=true) ------------------------
    if (d == 0.0) {
        R.mesh.positions = positions;
        R.mesh.faces     = faces;
        R.ok = true;
        R.outputVertices = nv;
        R.outputFaces    = static_cast<std::uint32_t>(faces.size());
        R.insetFaces     = 0;
        R.faceInfo.reserve(faces.size());
        double areaSum = 0.0;
        for (std::uint32_t fi = 0; fi < faces.size(); ++fi) {
            FaceInsetInfo info;
            info.sourceFace   = fi;
            info.valence      = static_cast<std::uint32_t>(faces[fi].size());
            info.factor       = 1.0;
            info.originalArea = newellArea(positions, faces[fi]);
            info.innerArea    = info.originalArea;
            info.ringArea     = 0.0;
            info.rejected     = false;
            info.innerFace    = fi;
            areaSum += info.originalArea;
            R.faceInfo.push_back(info);
        }
        R.inputArea  = areaSum;
        R.outputArea = areaSum;
        return R;
    }

    // ---- build the result soup ----------------------------------------------
    // Start with a copy of the original vertices; append inset vertices as we go.
    PolyMesh out;
    out.positions = positions;

    R.faceInfo.reserve(faces.size());
    double inAreaSum  = 0.0;
    double outAreaSum = 0.0;
    std::uint32_t accepted = 0;

    for (std::uint32_t fi = 0; fi < faces.size(); ++fi) {
        const std::vector<std::uint32_t>& loop = faces[fi];

        FaceInsetInfo info;
        info.sourceFace = fi;
        info.valence    = static_cast<std::uint32_t>(loop.size());

        const double origArea = newellArea(positions, loop);
        info.originalArea = origArea;
        inAreaSum += origArea;

        // -- per-face acceptance gate (rejected faces pass through unchanged) --
        V3 n;
        const bool tooSmall   = loop.size() < 3u;
        const bool repeated   = !tooSmall && hasRepeatedIndex(loop);
        const bool degenerate = tooSmall || repeated || origArea <= 0.0 ||
                                !faceNormal(positions, loop, n);

        if (degenerate) {
            info.rejected = true;
            info.factor   = 1.0;
            info.innerArea = origArea;
            info.ringArea  = 0.0;
            // pass face through unchanged
            const std::uint32_t fIdx = static_cast<std::uint32_t>(out.faces.size());
            out.faces.push_back(loop);
            info.innerFace = fIdx;
            outAreaSum += origArea;
            R.faceInfo.push_back(info);
            ++R.rejectedFaces;
            continue;
        }

        const V3 c = loopCentroid(positions, loop);
        const double extent = minCentroidExtent(positions, loop, c, n);
        info.extent = extent;

        // factor = 1 - 2d/extent. d >= extent/2 => factor <= 0 => collapse/invert.
        const double factor = (extent > 0.0) ? (1.0 - 2.0 * d / extent) : -1.0;
        info.factor = factor;

        // Honest collapse threshold: at d == extent/2 the inner face is a single
        // point (factor == 0), and floating-point rounding of (1 - 2d/extent) can
        // land a hair above 0 (e.g. +1.1e-16) at that exact boundary. A factor not
        // SAFELY positive means the inner face has collapsed (its area would be
        // < kFactorEps^2 of the original) — that is a degenerate, area-less panel,
        // so reject it rather than fabricate a near-zero "inner face". kFactorEps
        // is dimensionless (factor lives in (0,1)) so this is scale-invariant.
        constexpr double kFactorEps = 1e-9;
        if (!(factor > kFactorEps) || extent <= 0.0) {
            // d too large for this face -> reject honestly, pass through unchanged.
            info.rejected  = true;
            info.factor    = factor;  // record the offending (<=0) factor
            info.innerArea = origArea;
            info.ringArea  = 0.0;
            const std::uint32_t fIdx = static_cast<std::uint32_t>(out.faces.size());
            out.faces.push_back(loop);
            info.innerFace = fIdx;
            outAreaSum += origArea;
            R.faceInfo.push_back(info);
            ++R.rejectedFaces;
            continue;
        }

        // -- accepted: emit inset vertices (centroid scaling, in plane) --------
        const std::size_t k = loop.size();
        std::vector<std::uint32_t> innerLoop;
        innerLoop.reserve(k);
        for (std::size_t i = 0; i < k; ++i) {
            const V3 v = getVertex(positions, loop[i]);
            // v' = c + factor*(v - c). Since v lies in the face plane (the loop's
            // own affine hull) the result stays in that plane by construction.
            const V3 vp = c + (v - c) * factor;
            const std::uint32_t newIdx =
                static_cast<std::uint32_t>(out.positions.size() / 3u);
            out.positions.push_back(vp.x);
            out.positions.push_back(vp.y);
            out.positions.push_back(vp.z);
            innerLoop.push_back(newIdx);
        }

        // -- border ring: one quad per original edge, wound to match the face ---
        // For edge (a_i, a_{i+1}) the quad is (a_i, a_{i+1}, b_{i+1}, b_i) where
        // b are the inset vertices. This preserves the original face's outward
        // orientation (same CCW sense), so the panel normals match the face.
        const std::uint32_t ringBegin = static_cast<std::uint32_t>(out.faces.size());
        for (std::size_t i = 0; i < k; ++i) {
            const std::size_t j = (i + 1) % k;
            std::vector<std::uint32_t> quad = {
                loop[i], loop[j], innerLoop[j], innerLoop[i]
            };
            out.faces.push_back(std::move(quad));
        }
        const std::uint32_t ringEnd = static_cast<std::uint32_t>(out.faces.size());

        // -- inner (shrunken) face --------------------------------------------
        const std::uint32_t innerFaceIdx =
            static_cast<std::uint32_t>(out.faces.size());
        out.faces.push_back(innerLoop);

        // -- diagnostics -------------------------------------------------------
        const double innerArea = newellArea(out.positions, out.faces[innerFaceIdx]);
        double ringArea = 0.0;
        for (std::uint32_t q = ringBegin; q < ringEnd; ++q) {
            ringArea += newellArea(out.positions, out.faces[q]);
        }
        info.innerArea = innerArea;
        info.ringArea  = ringArea;
        info.rejected  = false;
        info.innerFace = innerFaceIdx;
        info.ringBegin = ringBegin;
        info.ringEnd   = ringEnd;

        outAreaSum += innerArea + ringArea;
        R.faceInfo.push_back(info);
        ++accepted;
    }

    R.insetFaces     = accepted;
    R.outputVertices = static_cast<std::uint32_t>(out.positions.size() / 3u);
    R.outputFaces    = static_cast<std::uint32_t>(out.faces.size());
    R.inputArea      = inAreaSum;
    R.outputArea     = outAreaSum;

    if (accepted == 0u) {
        // Every face rejected with d > 0 -> the whole inset is unusable.
        R.reason = "no face could be inset (d >= half the smallest face extent for every face)";
        R.ok = false;
        return R;
    }

    R.mesh = std::move(out);
    R.ok   = true;
    return R;
}

InsetResult insetFaces(const PolyMesh& input, double d) {
    return insetFaces(input.positions, input.faces, d);
}

} // namespace mesh
} // namespace native
} // namespace forge
