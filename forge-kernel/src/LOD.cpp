#include "forge/LOD.hpp"

#include <BRepTools.hxx>
#include <cmath>
#include <mutex>
#include <unordered_map>

namespace forge {

namespace {

struct LODKey {
    ShapeHandle handle;
    LODLevel    level;
    bool operator==(const LODKey& o) const {
        return handle == o.handle && level == o.level;
    }
};
struct LODKeyHash {
    std::size_t operator()(const LODKey& k) const noexcept {
        // 24 bits of level fit comfortably alongside 32 bits of handle.
        return std::hash<std::uint64_t>{}(
            (static_cast<std::uint64_t>(k.handle) << 8) |
            static_cast<std::uint64_t>(k.level));
    }
};

std::mutex& cacheMutex() { static std::mutex m; return m; }
auto& cacheMap() {
    static std::unordered_map<LODKey, Mesh, LODKeyHash> m;
    return m;
}

double linTolFor(LODLevel l) {
    switch (l) {
        case LODLevel::High: return kLodLinTolHigh;
        case LODLevel::Med:  return kLodLinTolMed;
        case LODLevel::Low:  return kLodLinTolLow;
    }
    return kLodLinTolMed;
}

} // namespace

const Mesh& tessellateLOD(ShapeHandle handle, LODLevel level) {
    {
        std::lock_guard<std::mutex> g(cacheMutex());
        auto& m = cacheMap();
        auto it = m.find(LODKey{handle, level});
        if (it != m.end()) return it->second;
    }
    // Tessellate without holding the cache lock — OCCT's internal locking
    // is fine for distinct shapes and we don't want one expensive mesh to
    // block lookups of unrelated cached entries. Clean the cached
    // BRepMesh triangulation off the shape first so subsequent levels at
    // looser tolerance get a fresh — coarser — mesh; otherwise OCCT
    // happily reuses the fine triangulation it already attached.
    {
        const auto& shape = ShapeRegistry::instance().get(handle);
        BRepTools::Clean(shape);
    }
    Mesh mesh = tessellate(handle, linTolFor(level), kLodAngTol);
    std::lock_guard<std::mutex> g(cacheMutex());
    auto& m = cacheMap();
    // Re-check in case another thread inserted while we were tessellating.
    auto it = m.find(LODKey{handle, level});
    if (it != m.end()) return it->second;
    auto [ins, _] = m.emplace(LODKey{handle, level}, std::move(mesh));
    return ins->second;
}

LODLevel selectLOD(InstanceId instanceId,
                   double eyeX, double eyeY, double eyeZ,
                   double fovRad, double screenHeightPx) {
    auto box = ComponentRegistry::instance().getAABB(instanceId);
    const double cx = 0.5 * (box.minX + box.maxX);
    const double cy = 0.5 * (box.minY + box.maxY);
    const double cz = 0.5 * (box.minZ + box.maxZ);
    const double dx = box.maxX - box.minX;
    const double dy = box.maxY - box.minY;
    const double dz = box.maxZ - box.minZ;
    const double diameter = std::sqrt(dx*dx + dy*dy + dz*dz);

    const double ex = eyeX - cx, ey = eyeY - cy, ez = eyeZ - cz;
    const double dist = std::max(std::sqrt(ex*ex + ey*ey + ez*ez), 1e-9);

    // Pixels subtended by the diameter on a perspective projection.
    const double tanHalfFov = std::tan(0.5 * fovRad);
    const double px = (diameter * screenHeightPx) / (2.0 * dist * tanHalfFov);

    if (px > kLodPxLowHi) return LODLevel::High;
    if (px > kLodPxLowMd) return LODLevel::Med;
    return LODLevel::Low;
}

void clearLODCache() {
    std::lock_guard<std::mutex> g(cacheMutex());
    cacheMap().clear();
}
std::size_t lodCacheEntries() {
    std::lock_guard<std::mutex> g(cacheMutex());
    return cacheMap().size();
}

} // namespace forge
