#include "forge/LineageRegistry.hpp"

namespace forge {

LineageRegistry& LineageRegistry::instance() {
  static LineageRegistry inst;
  return inst;
}

void LineageRegistry::put(ShapeHandle out, std::vector<LineageEntry> entries) {
  std::lock_guard<std::mutex> g(mu_);
  store_[out] = std::move(entries);
}

std::vector<LineageEntry> LineageRegistry::get(ShapeHandle out) const {
  std::lock_guard<std::mutex> g(mu_);
  auto it = store_.find(out);
  if (it == store_.end()) return {};
  return it->second;
}

bool LineageRegistry::has(ShapeHandle out) const {
  std::lock_guard<std::mutex> g(mu_);
  return store_.count(out) > 0;
}

void LineageRegistry::erase(ShapeHandle out) {
  std::lock_guard<std::mutex> g(mu_);
  store_.erase(out);
}

}  // namespace forge
