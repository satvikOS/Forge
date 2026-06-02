#include "forge/PathTrace.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <limits>
#include <random>
#include <stdexcept>

namespace forge { namespace pathtrace {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr std::uint32_t kMaxDim = 1024;

inline void v3sub(const double* a, const double* b, double* out) {
    out[0] = a[0]-b[0]; out[1] = a[1]-b[1]; out[2] = a[2]-b[2];
}
inline void v3cross(const double* a, const double* b, double* out) {
    out[0] = a[1]*b[2] - a[2]*b[1];
    out[1] = a[2]*b[0] - a[0]*b[2];
    out[2] = a[0]*b[1] - a[1]*b[0];
}
inline double v3dot(const double* a, const double* b) {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}
inline double v3length(const double* a) {
    return std::sqrt(v3dot(a, a));
}
inline void v3norm(double* a) {
    const double L = v3length(a);
    if (L > 1e-30) { a[0]/=L; a[1]/=L; a[2]/=L; }
}

struct AABB {
    double mn[3];
    double mx[3];
    void reset() {
        const double inf = std::numeric_limits<double>::infinity();
        mn[0] = mn[1] = mn[2] =  inf;
        mx[0] = mx[1] = mx[2] = -inf;
    }
    void expand(const double* p) {
        for (int c = 0; c < 3; ++c) {
            if (p[c] < mn[c]) mn[c] = p[c];
            if (p[c] > mx[c]) mx[c] = p[c];
        }
    }
    void expand(const AABB& b) {
        for (int c = 0; c < 3; ++c) {
            if (b.mn[c] < mn[c]) mn[c] = b.mn[c];
            if (b.mx[c] > mx[c]) mx[c] = b.mx[c];
        }
    }
    bool intersect(const double* orig, const double* invDir,
                   double tMax) const {
        for (int c = 0; c < 3; ++c) {
            const double t1 = (mn[c] - orig[c]) * invDir[c];
            const double t2 = (mx[c] - orig[c]) * invDir[c];
            const double tNear = std::min(t1, t2);
            const double tFar  = std::max(t1, t2);
            if (tNear > tMax || tFar < 0) return false;
            tMax = std::min(tMax, tFar);
            (void)tNear;
        }
        return true;
    }
};

struct BVHNode {
    AABB box;
    std::int32_t left  = -1;
    std::int32_t right = -1;
    std::uint32_t triStart = 0;
    std::uint32_t triCount = 0;   // 0 ⇒ interior
};

struct Hit {
    double tHit;
    std::uint32_t triId;
    double bary[3];
};

// Möller-Trumbore.
bool intersectTri(const double* orig, const double* dir,
                  const double* a, const double* b, const double* c,
                  double tMax, Hit& out) {
    double ab[3], ac[3], pvec[3], qvec[3], tvec[3];
    v3sub(b, a, ab);
    v3sub(c, a, ac);
    v3cross(dir, ac, pvec);
    const double det = v3dot(ab, pvec);
    if (std::fabs(det) < 1e-15) return false;
    const double invDet = 1.0 / det;
    v3sub(orig, a, tvec);
    const double u = v3dot(tvec, pvec) * invDet;
    if (u < 0 || u > 1) return false;
    v3cross(tvec, ab, qvec);
    const double vv = v3dot(dir, qvec) * invDet;
    if (vv < 0 || u + vv > 1) return false;
    const double t = v3dot(ac, qvec) * invDet;
    if (t < 1e-6 || t > tMax) return false;
    out.tHit = t;
    out.bary[0] = 1.0 - u - vv;
    out.bary[1] = u;
    out.bary[2] = vv;
    return true;
}

class BVH {
public:
    void build(const Mesh& m) {
        triIndex_.resize(m.indices.size() / 3);
        for (std::size_t i = 0; i < triIndex_.size(); ++i)
            triIndex_[i] = static_cast<std::uint32_t>(i);

        // Per-tri centroid + bbox.
        std::vector<AABB> triBox(triIndex_.size());
        std::vector<std::array<double, 3>> triCentroid(triIndex_.size());
        for (std::size_t i = 0; i < triIndex_.size(); ++i) {
            AABB box; box.reset();
            double c[3] = { 0, 0, 0 };
            for (int v = 0; v < 3; ++v) {
                const std::uint32_t idx = m.indices[i * 3 + v];
                const double p[3] = {
                    m.positions[idx * 3 + 0],
                    m.positions[idx * 3 + 1],
                    m.positions[idx * 3 + 2],
                };
                box.expand(p);
                c[0] += p[0]; c[1] += p[1]; c[2] += p[2];
            }
            triBox[i] = box;
            triCentroid[i] = { c[0]/3.0, c[1]/3.0, c[2]/3.0 };
        }
        nodes_.reserve(triIndex_.size() * 2);
        buildRec(0, static_cast<std::uint32_t>(triIndex_.size()),
                 triBox, triCentroid);
        mesh_ = &m;
    }

    bool nearest(const double* orig, const double* dir, double tMax,
                 Hit& bestHit, std::uint64_t& rayCount) const {
        double invDir[3] = { 1.0/dir[0], 1.0/dir[1], 1.0/dir[2] };
        bool found = false;
        bestHit.tHit = tMax;
        std::int32_t stack[64];
        int sp = 0;
        stack[sp++] = 0;
        while (sp > 0) {
            const std::int32_t idx = stack[--sp];
            const BVHNode& n = nodes_[idx];
            if (!n.box.intersect(orig, invDir, bestHit.tHit)) continue;
            if (n.triCount > 0) {
                for (std::uint32_t k = 0; k < n.triCount; ++k) {
                    const std::uint32_t triId = triIndex_[n.triStart + k];
                    const std::uint32_t i0 = mesh_->indices[triId * 3 + 0];
                    const std::uint32_t i1 = mesh_->indices[triId * 3 + 1];
                    const std::uint32_t i2 = mesh_->indices[triId * 3 + 2];
                    const double a[3] = { mesh_->positions[i0*3+0], mesh_->positions[i0*3+1], mesh_->positions[i0*3+2] };
                    const double b[3] = { mesh_->positions[i1*3+0], mesh_->positions[i1*3+1], mesh_->positions[i1*3+2] };
                    const double c[3] = { mesh_->positions[i2*3+0], mesh_->positions[i2*3+1], mesh_->positions[i2*3+2] };
                    Hit h;
                    ++rayCount;
                    if (intersectTri(orig, dir, a, b, c, bestHit.tHit, h)) {
                        h.triId = triId;
                        bestHit = h;
                        found = true;
                    }
                }
            } else {
                if (n.left  >= 0) stack[sp++] = n.left;
                if (n.right >= 0) stack[sp++] = n.right;
            }
        }
        return found;
    }

private:
    std::int32_t buildRec(std::uint32_t start, std::uint32_t end,
                          const std::vector<AABB>& triBox,
                          const std::vector<std::array<double, 3>>& triCentroid) {
        BVHNode n;
        n.box.reset();
        for (std::uint32_t i = start; i < end; ++i)
            n.box.expand(triBox[triIndex_[i]]);
        const std::uint32_t count = end - start;
        if (count <= 4) {
            n.triStart = start;
            n.triCount = count;
            nodes_.push_back(n);
            return static_cast<std::int32_t>(nodes_.size() - 1);
        }
        const double dx = n.box.mx[0] - n.box.mn[0];
        const double dy = n.box.mx[1] - n.box.mn[1];
        const double dz = n.box.mx[2] - n.box.mn[2];
        int axis = 0;
        if (dy > dx && dy >= dz) axis = 1;
        else if (dz > dx)        axis = 2;
        std::nth_element(triIndex_.begin() + start,
                         triIndex_.begin() + (start + end) / 2,
                         triIndex_.begin() + end,
                         [&](std::uint32_t a, std::uint32_t b) {
                             return triCentroid[a][axis] < triCentroid[b][axis];
                         });
        const std::uint32_t mid = (start + end) / 2;
        n.triStart = 0; n.triCount = 0;
        const std::int32_t self = static_cast<std::int32_t>(nodes_.size());
        nodes_.push_back(n);
        const std::int32_t L = buildRec(start, mid, triBox, triCentroid);
        const std::int32_t R = buildRec(mid,   end, triBox, triCentroid);
        nodes_[self].left  = L;
        nodes_[self].right = R;
        return self;
    }

    std::vector<std::uint32_t> triIndex_;
    std::vector<BVHNode>       nodes_;
    const Mesh*                mesh_ = nullptr;
};

inline void hemisphereSample(std::mt19937& rng,
                             const double n[3], double out[3]) {
    std::uniform_real_distribution<double> U(0.0, 1.0);
    const double r1 = U(rng), r2 = U(rng);
    const double phi = 2.0 * kPi * r1;
    const double sinT = std::sqrt(r2);
    const double cosT = std::sqrt(1.0 - r2);
    double tangent[3];
    if (std::fabs(n[0]) > 0.1) tangent[0] = 0;
    else                       tangent[0] = 1;
    tangent[1] = (tangent[0] == 0) ? 1 : 0;
    tangent[2] = 0;
    double t[3], b[3];
    v3cross(n, tangent, t); v3norm(t);
    v3cross(n, t, b);
    out[0] = t[0]*std::cos(phi)*sinT + b[0]*std::sin(phi)*sinT + n[0]*cosT;
    out[1] = t[1]*std::cos(phi)*sinT + b[1]*std::sin(phi)*sinT + n[1]*cosT;
    out[2] = t[2]*std::cos(phi)*sinT + b[2]*std::sin(phi)*sinT + n[2]*cosT;
    v3norm(out);
}

} // namespace

RenderOutputs render(const RenderInputs& in) {
    if (in.mesh.indices.empty())
        throw std::invalid_argument("forge.pathtrace: mesh is empty");
    if (in.width == 0 || in.height == 0)
        throw std::invalid_argument("forge.pathtrace: width/height required");
    if (in.width > kMaxDim || in.height > kMaxDim)
        throw std::invalid_argument("forge.pathtrace: max 1024px on each side");

    const auto t0 = std::chrono::steady_clock::now();
    BVH bvh;
    bvh.build(in.mesh);

    // Camera basis.
    double forward[3], right[3], camUp[3];
    v3sub(in.camera.lookAt, in.camera.position, forward);
    v3norm(forward);
    v3cross(forward, in.camera.up, right); v3norm(right);
    v3cross(right, forward, camUp);
    const double aspect = static_cast<double>(in.width) / static_cast<double>(in.height);
    const double tanHalfFov = std::tan(in.camera.fovYDegrees * kPi / 360.0);

    double sunDir[3] = { in.sun.direction[0], in.sun.direction[1], in.sun.direction[2] };
    v3norm(sunDir);

    RenderOutputs out{};
    out.width  = in.width;
    out.height = in.height;
    out.rgb.assign(in.width * in.height * 3, 0.0f);

    std::uint64_t rayCount = 0;
    std::mt19937 rng(in.randomSeed ? in.randomSeed : 0xC0FFEEu);

    for (std::uint32_t y = 0; y < in.height; ++y) {
        for (std::uint32_t x = 0; x < in.width; ++x) {
            const double sx = (2.0 * (x + 0.5) / in.width  - 1.0) * aspect * tanHalfFov;
            const double sy = (1.0 - 2.0 * (y + 0.5) / in.height) * tanHalfFov;
            double dir[3] = {
                forward[0] + right[0] * sx + camUp[0] * sy,
                forward[1] + right[1] * sx + camUp[1] * sy,
                forward[2] + right[2] * sx + camUp[2] * sy,
            };
            v3norm(dir);

            Hit h;
            ++rayCount;
            if (!bvh.nearest(in.camera.position, dir, 1e9, h, rayCount)) {
                const std::size_t base = (y * in.width + x) * 3;
                out.rgb[base + 0] = static_cast<float>(in.background[0]);
                out.rgb[base + 1] = static_cast<float>(in.background[1]);
                out.rgb[base + 2] = static_cast<float>(in.background[2]);
                continue;
            }

            // Hit position + normal.
            const std::uint32_t i0 = in.mesh.indices[h.triId * 3 + 0];
            const std::uint32_t i1 = in.mesh.indices[h.triId * 3 + 1];
            const std::uint32_t i2 = in.mesh.indices[h.triId * 3 + 2];
            const double a[3] = { in.mesh.positions[i0*3+0], in.mesh.positions[i0*3+1], in.mesh.positions[i0*3+2] };
            const double b[3] = { in.mesh.positions[i1*3+0], in.mesh.positions[i1*3+1], in.mesh.positions[i1*3+2] };
            const double c[3] = { in.mesh.positions[i2*3+0], in.mesh.positions[i2*3+1], in.mesh.positions[i2*3+2] };
            double hp[3] = {
                in.camera.position[0] + dir[0] * h.tHit,
                in.camera.position[1] + dir[1] * h.tHit,
                in.camera.position[2] + dir[2] * h.tHit,
            };
            double n[3];
            if (in.mesh.normals.size() == in.mesh.positions.size()) {
                n[0] = in.mesh.normals[i0*3+0]*h.bary[0] + in.mesh.normals[i1*3+0]*h.bary[1] + in.mesh.normals[i2*3+0]*h.bary[2];
                n[1] = in.mesh.normals[i0*3+1]*h.bary[0] + in.mesh.normals[i1*3+1]*h.bary[1] + in.mesh.normals[i2*3+1]*h.bary[2];
                n[2] = in.mesh.normals[i0*3+2]*h.bary[0] + in.mesh.normals[i1*3+2]*h.bary[1] + in.mesh.normals[i2*3+2]*h.bary[2];
            } else {
                double ab[3], ac[3];
                v3sub(b, a, ab); v3sub(c, a, ac); v3cross(ab, ac, n);
            }
            v3norm(n);
            if (v3dot(n, dir) > 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }

            // Pull material.
            const Material* mat = nullptr;
            if (h.triId < in.mesh.materialIds.size()) {
                const std::uint32_t mId = in.mesh.materialIds[h.triId];
                if (mId < in.mesh.materials.size()) mat = &in.mesh.materials[mId];
            }
            double albedo[3] = { 0.8, 0.8, 0.8 };
            double emission[3] = { 0, 0, 0 };
            if (mat) {
                albedo[0] = mat->albedo[0]; albedo[1] = mat->albedo[1]; albedo[2] = mat->albedo[2];
                emission[0] = mat->emission[0]; emission[1] = mat->emission[1]; emission[2] = mat->emission[2];
            }

            // Direct sun shading: occluded?
            double shadowFactor = 1.0;
            {
                double shadowOrig[3] = { hp[0] + n[0]*1e-4, hp[1] + n[1]*1e-4, hp[2] + n[2]*1e-4 };
                Hit sh;
                ++rayCount;
                if (bvh.nearest(shadowOrig, sunDir, 1e9, sh, rayCount)) shadowFactor = 0.0;
            }
            const double nDotL = std::max(0.0, v3dot(n, sunDir));

            // AO indirect: hemisphere visibility.
            double aoFactor = 1.0;
            if (in.aoSamples > 0) {
                std::uint32_t hits = 0;
                for (std::uint32_t s = 0; s < in.aoSamples; ++s) {
                    double dirAO[3];
                    hemisphereSample(rng, n, dirAO);
                    double orig[3] = { hp[0] + n[0]*1e-4, hp[1] + n[1]*1e-4, hp[2] + n[2]*1e-4 };
                    Hit hh;
                    ++rayCount;
                    if (bvh.nearest(orig, dirAO, in.aoMaxDistance, hh, rayCount)) ++hits;
                }
                aoFactor = 1.0 - in.aoStrength * (static_cast<double>(hits) / in.aoSamples);
                if (aoFactor < 0.0) aoFactor = 0.0;
            }

            const std::size_t base = (y * in.width + x) * 3;
            for (int c = 0; c < 3; ++c) {
                const double direct  = nDotL * shadowFactor * in.sun.colour[c];
                const double ambient = in.ambient[c];
                const double col = emission[c]
                                + albedo[c] * (ambient * aoFactor + direct);
                out.rgb[base + c] = static_cast<float>(col);
            }
        }
    }

    const auto t1 = std::chrono::steady_clock::now();
    out.elapsedSec = std::chrono::duration<double>(t1 - t0).count();
    out.rayCount = rayCount;
    return out;
}

}} // namespace forge::pathtrace
