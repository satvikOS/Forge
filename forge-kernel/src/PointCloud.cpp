#include "forge/PointCloud.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <queue>
#include <stdexcept>
#include <unordered_map>

namespace forge { namespace pointcloud {

namespace {

struct VoxelKey {
    std::int32_t x, y, z;
    bool operator==(const VoxelKey& o) const { return x == o.x && y == o.y && z == o.z; }
};
struct VoxelHash {
    std::size_t operator()(const VoxelKey& k) const noexcept {
        const std::uint64_t a = static_cast<std::uint64_t>(k.x) * 73856093u;
        const std::uint64_t b = static_cast<std::uint64_t>(k.y) * 19349663u;
        const std::uint64_t c = static_cast<std::uint64_t>(k.z) * 83492791u;
        return static_cast<std::size_t>(a ^ b ^ c);
    }
};

inline VoxelKey vkey(float x, float y, float z, double leaf) {
    return {
        static_cast<std::int32_t>(std::floor(x / leaf)),
        static_cast<std::int32_t>(std::floor(y / leaf)),
        static_cast<std::int32_t>(std::floor(z / leaf)),
    };
}

void validate(const std::vector<float>& p) {
    if (p.size() % 3 != 0)
        throw std::invalid_argument("forge.pointcloud: points length not divisible by 3");
}

} // namespace

Stats stats(const std::vector<float>& p) {
    validate(p);
    Stats s{};
    const std::uint32_t n = static_cast<std::uint32_t>(p.size() / 3);
    s.pointCount = n;
    if (n == 0) return s;
    for (int c = 0; c < 3; ++c) {
        s.bboxMin[c] =  std::numeric_limits<float>::infinity();
        s.bboxMax[c] = -std::numeric_limits<float>::infinity();
    }
    double sum[3] = { 0, 0, 0 };
    for (std::uint32_t i = 0; i < n; ++i) {
        for (int c = 0; c < 3; ++c) {
            const float v = p[i * 3 + c];
            if (v < s.bboxMin[c]) s.bboxMin[c] = v;
            if (v > s.bboxMax[c]) s.bboxMax[c] = v;
            sum[c] += v;
        }
    }
    for (int c = 0; c < 3; ++c) s.centroid[c] = static_cast<float>(sum[c] / n);
    const double vol = (s.bboxMax[0] - s.bboxMin[0])
                     * (s.bboxMax[1] - s.bboxMin[1])
                     * (s.bboxMax[2] - s.bboxMin[2]);
    s.density = vol > 0.0 ? static_cast<float>(n / vol) : 0.0f;
    return s;
}

std::vector<float> voxelDownsample(const std::vector<float>& p, double leaf) {
    validate(p);
    if (leaf <= 0.0) throw std::invalid_argument("voxelDownsample: leaf > 0");
    std::unordered_map<VoxelKey, std::array<double, 4>, VoxelHash> bins;
    bins.reserve(p.size() / 3);
    const std::uint32_t n = static_cast<std::uint32_t>(p.size() / 3);
    for (std::uint32_t i = 0; i < n; ++i) {
        const float x = p[i*3+0], y = p[i*3+1], z = p[i*3+2];
        auto& acc = bins[vkey(x, y, z, leaf)];
        acc[0] += x; acc[1] += y; acc[2] += z; acc[3] += 1.0;
    }
    std::vector<float> out;
    out.reserve(bins.size() * 3);
    for (const auto& kv : bins) {
        const double inv = 1.0 / kv.second[3];
        out.push_back(static_cast<float>(kv.second[0] * inv));
        out.push_back(static_cast<float>(kv.second[1] * inv));
        out.push_back(static_cast<float>(kv.second[2] * inv));
    }
    return out;
}

namespace {

// 3x3 symmetric matrix eigendecomposition via Jacobi rotation.
// Returns the eigenvector for the smallest eigenvalue (the surface
// normal direction in PCA-based normal estimation).
void smallestEigenVec3(const double M[6], double out[3]) {
    // M layout: [Mxx, Myy, Mzz, Mxy, Mxz, Myz]
    double a[3][3] = {
        { M[0], M[3], M[4] },
        { M[3], M[1], M[5] },
        { M[4], M[5], M[2] },
    };
    double V[3][3] = { {1,0,0}, {0,1,0}, {0,0,1} };
    for (int it = 0; it < 50; ++it) {
        // find largest off-diagonal
        int p = 0, q = 1;
        double maxOff = std::fabs(a[0][1]);
        if (std::fabs(a[0][2]) > maxOff) { maxOff = std::fabs(a[0][2]); p = 0; q = 2; }
        if (std::fabs(a[1][2]) > maxOff) { maxOff = std::fabs(a[1][2]); p = 1; q = 2; }
        if (maxOff < 1e-12) break;
        const double app = a[p][p], aqq = a[q][q], apq = a[p][q];
        const double theta = (aqq - app) / (2.0 * apq);
        const double t = (theta >= 0)
            ?  1.0 / (theta + std::sqrt(1.0 + theta * theta))
            : -1.0 / (-theta + std::sqrt(1.0 + theta * theta));
        const double c = 1.0 / std::sqrt(1.0 + t * t);
        const double s = t * c;
        a[p][p] = app - t * apq;
        a[q][q] = aqq + t * apq;
        a[p][q] = 0.0; a[q][p] = 0.0;
        for (int k = 0; k < 3; ++k) {
            if (k != p && k != q) {
                const double akp = a[k][p], akq = a[k][q];
                a[k][p] = a[p][k] = c * akp - s * akq;
                a[k][q] = a[q][k] = s * akp + c * akq;
            }
            const double vkp = V[k][p], vkq = V[k][q];
            V[k][p] = c * vkp - s * vkq;
            V[k][q] = s * vkp + c * vkq;
        }
    }
    int smallest = 0;
    double minEv = a[0][0];
    if (a[1][1] < minEv) { minEv = a[1][1]; smallest = 1; }
    if (a[2][2] < minEv) { minEv = a[2][2]; smallest = 2; }
    out[0] = V[0][smallest]; out[1] = V[1][smallest]; out[2] = V[2][smallest];
    const double len = std::sqrt(out[0]*out[0] + out[1]*out[1] + out[2]*out[2]);
    if (len > 1e-30) {
        out[0] /= len; out[1] /= len; out[2] /= len;
    }
}

} // namespace

std::vector<float> estimateNormals(const std::vector<float>& p,
                                   std::uint32_t k,
                                   const double viewpoint[3]) {
    validate(p);
    const std::uint32_t n = static_cast<std::uint32_t>(p.size() / 3);
    if (n == 0) return {};
    if (k < 3) k = 3;
    if (k > n - 1) k = n - 1;
    if (k == 0) k = 1;

    std::vector<float> normals(p.size(), 0.0f);
    std::vector<std::pair<double, std::uint32_t>> dists;
    dists.reserve(n);

    for (std::uint32_t i = 0; i < n; ++i) {
        const double px = p[i*3+0], py = p[i*3+1], pz = p[i*3+2];
        dists.clear();
        for (std::uint32_t j = 0; j < n; ++j) {
            if (j == i) continue;
            const double dx = p[j*3+0] - px;
            const double dy = p[j*3+1] - py;
            const double dz = p[j*3+2] - pz;
            dists.emplace_back(dx*dx + dy*dy + dz*dz, j);
        }
        const std::uint32_t use = std::min<std::uint32_t>(k, static_cast<std::uint32_t>(dists.size()));
        std::nth_element(dists.begin(), dists.begin() + use, dists.end(),
                         [](const auto& a, const auto& b) { return a.first < b.first; });

        double mean[3] = { 0, 0, 0 };
        for (std::uint32_t kk = 0; kk < use; ++kk) {
            const std::uint32_t j = dists[kk].second;
            mean[0] += p[j*3+0]; mean[1] += p[j*3+1]; mean[2] += p[j*3+2];
        }
        const double inv = 1.0 / static_cast<double>(use);
        mean[0] *= inv; mean[1] *= inv; mean[2] *= inv;

        double M[6] = { 0, 0, 0, 0, 0, 0 };
        for (std::uint32_t kk = 0; kk < use; ++kk) {
            const std::uint32_t j = dists[kk].second;
            const double dx = p[j*3+0] - mean[0];
            const double dy = p[j*3+1] - mean[1];
            const double dz = p[j*3+2] - mean[2];
            M[0] += dx*dx; M[1] += dy*dy; M[2] += dz*dz;
            M[3] += dx*dy; M[4] += dx*dz; M[5] += dy*dz;
        }
        double nrm[3];
        smallestEigenVec3(M, nrm);
        // Orient toward the viewpoint.
        const double vx = viewpoint[0] - px;
        const double vy = viewpoint[1] - py;
        const double vz = viewpoint[2] - pz;
        if (nrm[0]*vx + nrm[1]*vy + nrm[2]*vz < 0.0) {
            nrm[0] = -nrm[0]; nrm[1] = -nrm[1]; nrm[2] = -nrm[2];
        }
        normals[i*3+0] = static_cast<float>(nrm[0]);
        normals[i*3+1] = static_cast<float>(nrm[1]);
        normals[i*3+2] = static_cast<float>(nrm[2]);
    }
    return normals;
}

// Emits a triangle mesh of the voxel-occupancy shell: each occupied
// voxel contributes the faces it doesn't share with another occupied
// voxel. Useful as a quick scan-preview / coarse hull.
Mesh voxelMesh(const std::vector<float>& p, double leaf) {
    validate(p);
    if (leaf <= 0.0) throw std::invalid_argument("voxelMesh: leaf > 0");
    std::unordered_map<VoxelKey, std::uint32_t, VoxelHash> occ;
    occ.reserve(p.size() / 3);
    for (std::size_t i = 0; i < p.size(); i += 3) {
        const auto k = vkey(p[i+0], p[i+1], p[i+2], leaf);
        ++occ[k];
    }

    Mesh m;
    m.positions.reserve(occ.size() * 24);
    m.indices.reserve(occ.size() * 36);

    // Face directions: ±X, ±Y, ±Z. For each face, the 4 corner offsets
    // (in CCW order viewed from outside).
    struct FaceDef {
        VoxelKey neighbour;
        float corner[4][3];
    };
    auto h = static_cast<float>(leaf);
    const FaceDef faces[6] = {
        // -X
        {{-1,0,0}, {{0,0,0},{0,h,0},{0,h,h},{0,0,h}}},
        // +X
        {{ 1,0,0}, {{h,0,0},{h,0,h},{h,h,h},{h,h,0}}},
        // -Y
        {{0,-1,0}, {{0,0,0},{0,0,h},{h,0,h},{h,0,0}}},
        // +Y
        {{0, 1,0}, {{0,h,0},{h,h,0},{h,h,h},{0,h,h}}},
        // -Z
        {{0,0,-1}, {{0,0,0},{h,0,0},{h,h,0},{0,h,0}}},
        // +Z
        {{0,0, 1}, {{0,0,h},{0,h,h},{h,h,h},{h,0,h}}},
    };

    for (const auto& kv : occ) {
        const float bx = static_cast<float>(kv.first.x) * h;
        const float by = static_cast<float>(kv.first.y) * h;
        const float bz = static_cast<float>(kv.first.z) * h;
        for (int f = 0; f < 6; ++f) {
            VoxelKey nb {
                kv.first.x + faces[f].neighbour.x,
                kv.first.y + faces[f].neighbour.y,
                kv.first.z + faces[f].neighbour.z,
            };
            if (occ.count(nb)) continue;
            const std::uint32_t base = static_cast<std::uint32_t>(m.positions.size() / 3);
            for (int c = 0; c < 4; ++c) {
                m.positions.push_back(bx + faces[f].corner[c][0]);
                m.positions.push_back(by + faces[f].corner[c][1]);
                m.positions.push_back(bz + faces[f].corner[c][2]);
            }
            m.indices.push_back(base + 0);
            m.indices.push_back(base + 1);
            m.indices.push_back(base + 2);
            m.indices.push_back(base + 0);
            m.indices.push_back(base + 2);
            m.indices.push_back(base + 3);
        }
    }
    return m;
}

}} // namespace forge::pointcloud
