#include "forge/ComponentRegistry.hpp"
#include "forge/BVH.hpp"

#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <algorithm>
#include <limits>
#include <stdexcept>

namespace forge {

ComponentRegistry::ComponentRegistry() = default;
ComponentRegistry::~ComponentRegistry() = default;

ComponentRegistry& ComponentRegistry::instance() {
    static ComponentRegistry s;
    return s;
}

void ComponentRegistry::reserve(std::size_t n) {
    std::lock_guard<std::mutex> g(mtx_);
    slots_.reserve(n);
}

void ComponentRegistry::markBvhDirty() {
    bvhDirty_ = true;
}

InstanceId ComponentRegistry::addInstance(ShapeHandle component, const Transform4x4& xform) {
    AABB aabb = computeAABB(component, xform);

    std::lock_guard<std::mutex> g(mtx_);
    markBvhDirty();
    if (!freeList_.empty()) {
        const auto idx = freeList_.back();
        freeList_.pop_back();
        slots_[idx] = Slot{component, xform, aabb, true};
        return static_cast<InstanceId>(idx + 1); // 1-indexed (0 = invalid)
    }
    slots_.push_back(Slot{component, xform, aabb, true});
    return static_cast<InstanceId>(slots_.size()); // 1-indexed
}

void ComponentRegistry::removeInstance(InstanceId id) {
    if (id == kInvalidInstance) return;
    std::lock_guard<std::mutex> g(mtx_);
    const auto idx = static_cast<std::size_t>(id - 1);
    if (idx >= slots_.size() || !slots_[idx].alive) return;
    slots_[idx].alive = false;
    freeList_.push_back(static_cast<std::uint32_t>(idx));
    markBvhDirty();
}

void ComponentRegistry::updateTransform(InstanceId id, const Transform4x4& xform) {
    if (id == kInvalidInstance) {
        throw std::invalid_argument("ComponentRegistry::updateTransform — invalid handle");
    }
    AABB newAabb;
    ShapeHandle comp;
    {
        std::lock_guard<std::mutex> g(mtx_);
        const auto idx = static_cast<std::size_t>(id - 1);
        if (idx >= slots_.size() || !slots_[idx].alive) {
            throw std::invalid_argument("ComponentRegistry::updateTransform — dead handle");
        }
        comp = slots_[idx].component;
    }
    newAabb = computeAABB(comp, xform);
    {
        std::lock_guard<std::mutex> g(mtx_);
        const auto idx = static_cast<std::size_t>(id - 1);
        slots_[idx].xform = xform;
        slots_[idx].aabb = newAabb;
        markBvhDirty();
    }
}

bool ComponentRegistry::exists(InstanceId id) const {
    if (id == kInvalidInstance) return false;
    std::lock_guard<std::mutex> g(mtx_);
    const auto idx = static_cast<std::size_t>(id - 1);
    return idx < slots_.size() && slots_[idx].alive;
}

std::size_t ComponentRegistry::count() const {
    std::lock_guard<std::mutex> g(mtx_);
    return slots_.size() - freeList_.size();
}

ShapeHandle ComponentRegistry::getComponent(InstanceId id) const {
    std::lock_guard<std::mutex> g(mtx_);
    const auto idx = static_cast<std::size_t>(id - 1);
    if (idx >= slots_.size() || !slots_[idx].alive) {
        throw std::invalid_argument("ComponentRegistry::getComponent — bad id");
    }
    return slots_[idx].component;
}

Transform4x4 ComponentRegistry::getTransform(InstanceId id) const {
    std::lock_guard<std::mutex> g(mtx_);
    const auto idx = static_cast<std::size_t>(id - 1);
    if (idx >= slots_.size() || !slots_[idx].alive) {
        throw std::invalid_argument("ComponentRegistry::getTransform — bad id");
    }
    return slots_[idx].xform;
}

AABB ComponentRegistry::getAABB(InstanceId id) const {
    std::lock_guard<std::mutex> g(mtx_);
    const auto idx = static_cast<std::size_t>(id - 1);
    if (idx >= slots_.size() || !slots_[idx].alive) {
        throw std::invalid_argument("ComponentRegistry::getAABB — bad id");
    }
    return slots_[idx].aabb;
}

void ComponentRegistry::ensureBvhLocked() const {
    if (!bvhDirty_ && bvh_) return;
    if (!bvh_) bvh_ = std::make_unique<BVH>();
    std::vector<AABB> boxes;
    std::vector<InstanceId> ids;
    boxes.reserve(slots_.size());
    ids.reserve(slots_.size());
    for (std::size_t i = 0; i < slots_.size(); ++i) {
        if (!slots_[i].alive) continue;
        boxes.push_back(slots_[i].aabb);
        ids.push_back(static_cast<InstanceId>(i + 1));
    }
    bvh_->build(boxes, ids);
    bvhDirty_ = false;
}

std::size_t ComponentRegistry::buildBvh() const {
    std::lock_guard<std::mutex> g(mtx_);
    ensureBvhLocked();
    return bvh_ ? bvh_->primCount() : 0;
}

bool ComponentRegistry::isBvhFresh() const {
    std::lock_guard<std::mutex> g(mtx_);
    return !bvhDirty_ && bvh_ && !bvh_->empty();
}

std::vector<InstanceId> ComponentRegistry::queryAABB(const AABB& box) const {
    std::vector<InstanceId> hits;
    std::lock_guard<std::mutex> g(mtx_);
    hits.reserve(64);
    if (!bvhDirty_ && bvh_ && !bvh_->empty()) {
        bvh_->queryAABB(box, hits);
        return hits;
    }
    // Fallback linear scan — preserved so the bench's first query still
    // works when callers forgot to call buildBvh().
    for (std::size_t i = 0; i < slots_.size(); ++i) {
        const auto& s = slots_[i];
        if (!s.alive) continue;
        if (s.aabb.intersects(box)) {
            hits.push_back(static_cast<InstanceId>(i + 1));
        }
    }
    return hits;
}

std::vector<InstanceId> ComponentRegistry::queryRay(double ox, double oy, double oz,
                                                    double dx, double dy, double dz) const {
    std::vector<InstanceId> hits;
    std::lock_guard<std::mutex> g(mtx_);
    ensureBvhLocked();
    if (!bvh_ || bvh_->empty()) return hits;
    BvhRay r{ox, oy, oz, dx, dy, dz};
    hits.reserve(32);
    bvh_->queryRay(r, hits);
    return hits;
}

std::vector<InstanceId> ComponentRegistry::queryFrustum(
    const std::array<double,24>& planes) const {
    std::vector<InstanceId> hits;
    std::lock_guard<std::mutex> g(mtx_);
    ensureBvhLocked();
    if (!bvh_ || bvh_->empty()) return hits;
    std::array<BvhPlane,6> p;
    for (int i = 0; i < 6; ++i) {
        p[i] = BvhPlane{ planes[4*i+0], planes[4*i+1], planes[4*i+2], planes[4*i+3] };
    }
    hits.reserve(1024);
    bvh_->queryFrustum(p, hits);
    return hits;
}

std::size_t ComponentRegistry::bytesUsed() const {
    std::lock_guard<std::mutex> g(mtx_);
    std::size_t bvhBytes = bvh_ ? bvh_->bytesUsed() : 0;
    return slots_.capacity() * sizeof(Slot) +
           freeList_.capacity() * sizeof(std::uint32_t) +
           bvhBytes;
}

// ---------------------------------------------------------------- AABB

AABB ComponentRegistry::computeAABB(ShapeHandle component, const Transform4x4& xform) const {
    const auto& shape = ShapeRegistry::instance().get(component);
    Bnd_Box local;
    BRepBndLib::Add(shape, local);
    return transformAABB(local, xform);
}

AABB ComponentRegistry::transformAABB(const Bnd_Box& local, const Transform4x4& x) const {
    if (local.IsVoid()) {
        return AABB{0, 0, 0, 0, 0, 0};
    }
    double xmin, ymin, zmin, xmax, ymax, zmax;
    local.Get(xmin, ymin, zmin, xmax, ymax, zmax);

    // Transform 8 corners and take the new min/max — cheap and exact
    // enough for axis-aligned culling. SIMD this later if profile says so.
    const double corners[8][3] = {
        {xmin, ymin, zmin}, {xmax, ymin, zmin}, {xmin, ymax, zmin}, {xmax, ymax, zmin},
        {xmin, ymin, zmax}, {xmax, ymin, zmax}, {xmin, ymax, zmax}, {xmax, ymax, zmax},
    };

    double Mx = -std::numeric_limits<double>::infinity();
    double My = -std::numeric_limits<double>::infinity();
    double Mz = -std::numeric_limits<double>::infinity();
    double mx =  std::numeric_limits<double>::infinity();
    double my =  std::numeric_limits<double>::infinity();
    double mz =  std::numeric_limits<double>::infinity();

    for (const auto& c : corners) {
        const double cx = c[0], cy = c[1], cz = c[2];
        const double tx = x.m[0]*cx + x.m[1]*cy + x.m[2]*cz + x.m[3];
        const double ty = x.m[4]*cx + x.m[5]*cy + x.m[6]*cz + x.m[7];
        const double tz = x.m[8]*cx + x.m[9]*cy + x.m[10]*cz + x.m[11];
        if (tx < mx) mx = tx; if (tx > Mx) Mx = tx;
        if (ty < my) my = ty; if (ty > My) My = ty;
        if (tz < mz) mz = tz; if (tz > Mz) Mz = tz;
    }
    return AABB{mx, my, mz, Mx, My, Mz};
}

} // namespace forge
