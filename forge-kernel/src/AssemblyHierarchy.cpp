#include "forge/AssemblyHierarchy.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge {

AssemblyHierarchy& AssemblyHierarchy::instance() {
    static AssemblyHierarchy s;
    return s;
}

Transform4x4 multiplyTransforms(const Transform4x4& a, const Transform4x4& b) {
    Transform4x4 r{};
    for (int i = 0; i < 4; ++i) {
        for (int j = 0; j < 4; ++j) {
            double v = 0.0;
            for (int k = 0; k < 4; ++k) {
                v += a.m[i * 4 + k] * b.m[k * 4 + j];
            }
            r.m[i * 4 + j] = v;
        }
    }
    return r;
}

bool AssemblyHierarchy::wouldCreateCycle(InstanceId child, InstanceId proposedParent) const {
    // Walk up from proposedParent toward the root. If we ever land on
    // `child`, the new edge would close a cycle.
    InstanceId cur = proposedParent;
    int hops = 0;
    while (cur != 0 && hops < 1000000) {
        if (cur == child) return true;
        auto it = parentOf_.find(cur);
        if (it == parentOf_.end()) break;
        cur = it->second;
        ++hops;
    }
    return false;
}

void AssemblyHierarchy::setParent(InstanceId child, InstanceId parent) {
    if (child == 0) {
        throw std::invalid_argument(
            "AssemblyHierarchy::setParent — child cannot be the world id 0");
    }
    if (child == parent) {
        throw std::invalid_argument(
            "AssemblyHierarchy::setParent — instance cannot parent itself");
    }
    std::lock_guard<std::mutex> g(mtx_);
    if (parent != 0 && wouldCreateCycle(child, parent)) {
        throw std::invalid_argument(
            "AssemblyHierarchy::setParent — cycle rejected");
    }
    // Detach from previous parent's children list, if any.
    auto prev = parentOf_.find(child);
    if (prev != parentOf_.end()) {
        auto& sib = childrenOf_[prev->second];
        sib.erase(std::remove(sib.begin(), sib.end(), child), sib.end());
        if (sib.empty()) childrenOf_.erase(prev->second);
    }
    if (parent == 0) {
        parentOf_.erase(child);
    } else {
        parentOf_[child] = parent;
        childrenOf_[parent].push_back(child);
    }
}

InstanceId AssemblyHierarchy::getParent(InstanceId child) const {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = parentOf_.find(child);
    return it == parentOf_.end() ? 0u : it->second;
}

std::vector<InstanceId> AssemblyHierarchy::getChildren(InstanceId parent) const {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = childrenOf_.find(parent);
    if (it == childrenOf_.end()) return {};
    return it->second; // copy under lock
}

Transform4x4 AssemblyHierarchy::worldTransform(InstanceId instance) const {
    if (instance == 0) {
        return Transform4x4{}; // identity
    }
    // Collect the parent chain (root-most last) under lock, then release
    // before fetching transforms from ComponentRegistry to avoid a nested
    // lock acquisition.
    std::vector<InstanceId> chain;
    {
        std::lock_guard<std::mutex> g(mtx_);
        InstanceId cur = instance;
        int hops = 0;
        while (cur != 0 && hops < 1000000) {
            chain.push_back(cur);
            auto it = parentOf_.find(cur);
            if (it == parentOf_.end()) break;
            cur = it->second;
            ++hops;
        }
    }
    // Compose root-down: world = parent_n × … × parent_1 × local
    Transform4x4 out = ComponentRegistry::instance().getTransform(chain.back());
    for (auto it = chain.rbegin() + 1; it != chain.rend(); ++it) {
        Transform4x4 local = ComponentRegistry::instance().getTransform(*it);
        out = multiplyTransforms(out, local);
    }
    return out;
}

void AssemblyHierarchy::clearAll() {
    std::lock_guard<std::mutex> g(mtx_);
    parentOf_.clear();
    childrenOf_.clear();
}

std::size_t AssemblyHierarchy::edgeCount() const {
    std::lock_guard<std::mutex> g(mtx_);
    return parentOf_.size();
}

} // namespace forge
