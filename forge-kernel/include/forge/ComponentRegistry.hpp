#pragma once

// ComponentRegistry — the assembly-instance store.
//
// An "instance" is a (componentHandle, 4×4 transform) pair. The
// componentHandle points at a ShapeRegistry entry that owns the actual
// TopoDS_Shape; many instances can reference the same shape (Forge's
// answer to 100k-component assemblies — a fastener BREP is built once
// and instanced 50,000 times via cheap transforms).
//
// The registry keeps instances in flat std::vectors so iteration is
// cache-friendly and queries can be SIMD-vectorised later. Slots vacated
// by removeInstance() are recycled via a free list, so InstanceId values
// are not contiguous but the dense storage stays compact.
//
// AABBs are kept in world space and recomputed lazily on
// updateTransform(); queryAABB() uses a linear scan today and will gain
// a BVH overlay in a follow-up slice once the workload profile justifies
// the build cost.

#include "forge/ShapeRegistry.hpp"

#include <array>
#include <cstdint>
#include <functional>
#include <mutex>
#include <vector>
#include <Bnd_Box.hxx>

namespace forge {

using InstanceId = std::uint32_t;
constexpr InstanceId kInvalidInstance = 0;

struct Transform4x4 {
    // Row-major 4×4. Identity by default.
    std::array<double, 16> m{
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    };
};

struct AABB {
    double minX, minY, minZ;
    double maxX, maxY, maxZ;
    bool intersects(const AABB& o) const {
        return !(o.maxX < minX || o.minX > maxX ||
                 o.maxY < minY || o.minY > maxY ||
                 o.maxZ < minZ || o.minZ > maxZ);
    }
};

class ComponentRegistry {
public:
    static ComponentRegistry& instance();

    // ---- core ----
    InstanceId addInstance(ShapeHandle component, const Transform4x4& xform);
    void       removeInstance(InstanceId id);
    void       updateTransform(InstanceId id, const Transform4x4& xform);

    // ---- queries ----
    bool        exists(InstanceId id) const;
    std::size_t count() const;
    ShapeHandle getComponent(InstanceId id) const;
    Transform4x4 getTransform(InstanceId id) const;
    AABB         getAABB(InstanceId id) const;

    // O(N) linear scan today; sufficient for the 100k benchmark target
    // on a single M-series core (<5 ms typical). Callback receives the
    // dense slot index — pass it back to liveIds() to map to InstanceId.
    std::vector<InstanceId> queryAABB(const AABB& box) const;

    // Total memory accounted for by the registry's flat storage.
    std::size_t bytesUsed() const;

    // ---- bulk-load helper ----
    // Reserves capacity for `n` instances up front. Saves N reallocations
    // when streaming a 100k benchmark or a large STEP assembly.
    void reserve(std::size_t n);

private:
    ComponentRegistry() = default;

    struct Slot {
        ShapeHandle  component;
        Transform4x4 xform;
        AABB         aabb;
        bool         alive;
    };

    AABB computeAABB(ShapeHandle component, const Transform4x4& xform) const;
    AABB transformAABB(const Bnd_Box& local, const Transform4x4& x) const;

    mutable std::mutex mtx_;
    std::vector<Slot>  slots_;
    std::vector<std::uint32_t> freeList_;
};

} // namespace forge
