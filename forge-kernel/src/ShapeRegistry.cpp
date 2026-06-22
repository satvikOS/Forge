#include "forge/ShapeRegistry.hpp"

#include <cstdlib>
#include <stdexcept>

namespace forge {

ShapeRegistry& ShapeRegistry::instance() {
    static ShapeRegistry s;
    return s;
}

ShapeHandle ShapeRegistry::add(TopoDS_Shape shape) {
    std::lock_guard<std::mutex> g(mtx_);
    ShapeHandle h = next_++;
    Entry e;
    e.kind = ShapeKind::Occt;
    e.shape = std::move(shape);
    e.refcount = 1;
    entries_.emplace(h, std::move(e));
    ++totalEverIssued_;
    return h;
}

ShapeKind ShapeRegistry::kindOf(ShapeHandle h) const {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = entries_.find(h);
    if (it == entries_.end()) {
        throw std::runtime_error("ShapeRegistry::kindOf — invalid handle");
    }
    return it->second.kind;
}

void ShapeRegistry::retain(ShapeHandle h) {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = entries_.find(h);
    if (it == entries_.end()) {
        throw std::runtime_error("ShapeRegistry::retain — invalid handle");
    }
    ++it->second.refcount;
}

void ShapeRegistry::release(ShapeHandle h) {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = entries_.find(h);
    if (it == entries_.end()) return; // double-release is a no-op
    if (--it->second.refcount == 0) {
        entries_.erase(it);
    }
}

const TopoDS_Shape& ShapeRegistry::get(ShapeHandle h) const {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = entries_.find(h);
    if (it == entries_.end()) {
        throw std::runtime_error("ShapeRegistry::get — invalid handle");
    }
    if (it->second.kind != ShapeKind::Occt) {
        throw std::runtime_error(
            "ShapeRegistry::get — handle is native-backed (no TopoDS_Shape); "
            "branch on kindOf() / use getNativeSolid|getNativeMesh");
    }
    return it->second.shape;
}

std::size_t ShapeRegistry::liveCount() const {
    std::lock_guard<std::mutex> g(mtx_);
    return entries_.size();
}

std::size_t ShapeRegistry::totalEverIssued() const {
    std::lock_guard<std::mutex> g(mtx_);
    return totalEverIssued_;
}

#ifdef FORGE_NATIVE_BREP
ShapeHandle ShapeRegistry::addNativeSolid(
        std::shared_ptr<native::brep::TopologyBuilder> owner,
        native::brep::Solid* solid) {
    if (!owner || !solid) {
        throw std::runtime_error("ShapeRegistry::addNativeSolid — null owner/solid");
    }
    std::lock_guard<std::mutex> g(mtx_);
    ShapeHandle h = next_++;
    Entry e;
    e.kind = ShapeKind::NativeSolid;
    e.owner = std::move(owner);
    e.solid = solid;
    e.refcount = 1;
    entries_.emplace(h, std::move(e));
    ++totalEverIssued_;
    return h;
}

ShapeHandle ShapeRegistry::addNativeMesh(
        std::shared_ptr<native::mesh::HalfEdgeMesh> mesh) {
    if (!mesh) {
        throw std::runtime_error("ShapeRegistry::addNativeMesh — null mesh");
    }
    std::lock_guard<std::mutex> g(mtx_);
    ShapeHandle h = next_++;
    Entry e;
    e.kind = ShapeKind::NativeMesh;
    e.mesh = std::move(mesh);
    e.refcount = 1;
    entries_.emplace(h, std::move(e));
    ++totalEverIssued_;
    return h;
}

const native::brep::Solid& ShapeRegistry::getNativeSolid(ShapeHandle h) const {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = entries_.find(h);
    if (it == entries_.end()) {
        throw std::runtime_error("ShapeRegistry::getNativeSolid — invalid handle");
    }
    if (it->second.kind != ShapeKind::NativeSolid || !it->second.solid) {
        throw std::runtime_error(
            "ShapeRegistry::getNativeSolid — handle is not a native analytic solid");
    }
    return *it->second.solid;
}

const native::mesh::HalfEdgeMesh& ShapeRegistry::getNativeMesh(ShapeHandle h) const {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = entries_.find(h);
    if (it == entries_.end()) {
        throw std::runtime_error("ShapeRegistry::getNativeMesh — invalid handle");
    }
    if (it->second.kind != ShapeKind::NativeMesh || !it->second.mesh) {
        throw std::runtime_error(
            "ShapeRegistry::getNativeMesh — handle is not a native mesh result");
    }
    return *it->second.mesh;
}
#endif // FORGE_NATIVE_BREP

} // namespace forge
