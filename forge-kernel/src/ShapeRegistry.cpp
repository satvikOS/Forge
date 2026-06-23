#include "forge/ShapeRegistry.hpp"

#ifdef FORGE_NATIVE_BREP
#include "forge/NativeOcctBridge.hpp"   // occtFromNativeSolid — lazy native→OCCT
#endif

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
    Entry& e = it->second;
    if (e.kind == ShapeKind::Occt) {
        return e.shape;
    }
#ifdef FORGE_NATIVE_BREP
    // LAZY native→OCCT BRIDGE. An OCCT-only op (heal/sheet-metal/weldments/...)
    // asked for the TopoDS_Shape of a native analytic handle. Materialize it ONCE
    // via the validated analytic STEP round-trip and cache it in e.shape, so a
    // native body flows transparently through every OCCT-only op without that op
    // knowing the backend. Bible §0: native-where-proven, OCCT everywhere else,
    // never a hard failure on a valid modelling request. occtFromNativeSolid does
    // NOT touch the registry, so calling it under mtx_ cannot deadlock.
    if (e.kind == ShapeKind::NativeSolid) {
        if (e.shape.IsNull()) {
            e.shape = occtFromNativeSolid(*e.solid);  // throws only on genuine failure
        }
        return e.shape;
    }
#endif
    throw std::runtime_error(
        "ShapeRegistry::get — handle is native-mesh-backed (a faceted feature "
        "result has no analytic TopoDS_Shape); branch on kindOf() / use getNativeMesh");
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
