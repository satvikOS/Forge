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
    entries_.emplace(h, Entry{std::move(shape), 1});
    ++totalEverIssued_;
    return h;
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

} // namespace forge
