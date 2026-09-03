// ui/src/RecentDocuments.cpp — see RecentDocuments.hpp for what this is for.
#include "forge/ui/RecentDocuments.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <vector>

namespace forge::ui {

RecentDocuments::RecentDocuments(std::size_t capacity) : capacity_(capacity) {}

bool RecentDocuments::isStorable(const std::string& path) noexcept {
  if (path.empty()) return false;
  // '\n' would split one `recent` record into two; '\r' would ride along into
  // the stored path on a file that has ever been through a CRLF tool and make
  // the reopened path differ from the saved one by an invisible byte.
  return path.find('\n') == std::string::npos && path.find('\r') == std::string::npos;
}

bool RecentDocuments::remember(const std::string& path) {
  if (!isStorable(path)) return false;
  if (capacity_ == 0) return false;
  const auto at = std::find(paths_.begin(), paths_.end(), path);
  if (at != paths_.end()) paths_.erase(at);
  paths_.insert(paths_.begin(), path);
  if (paths_.size() > capacity_) paths_.resize(capacity_);
  return true;
}

bool RecentDocuments::forget(const std::string& path) {
  const auto at = std::find(paths_.begin(), paths_.end(), path);
  if (at == paths_.end()) return false;
  paths_.erase(at);
  return true;
}

void RecentDocuments::clear() noexcept { paths_.clear(); }

bool RecentDocuments::contains(const std::string& path) const noexcept {
  return std::find(paths_.begin(), paths_.end(), path) != paths_.end();
}

const std::string& RecentDocuments::mostRecent() const noexcept {
  // A function-local static rather than a member: returning a reference to a
  // temporary is undefined behaviour, and an empty MEMBER would be one more
  // piece of state that has to be kept consistent with the vector.
  static const std::string kNone;
  return paths_.empty() ? kNone : paths_.front();
}

std::size_t RecentDocuments::restore(const std::vector<std::string>& paths) {
  paths_.clear();
  for (const std::string& p : paths) {
    if (paths_.size() >= capacity_) break;
    if (!isStorable(p)) continue;
    if (contains(p)) continue;
    paths_.push_back(p);
  }
  return paths_.size();
}

std::string RecentDocuments::leafName(const std::string& path) {
  const std::size_t slash = path.find_last_of('/');
  return slash == std::string::npos ? path : path.substr(slash + 1);
}

std::vector<std::string> RecentDocuments::labels() const {
  std::vector<std::string> out;
  out.reserve(paths_.size());
  for (const std::string& p : paths_) {
    const std::string leaf = leafName(p);
    // Ambiguous when ANOTHER entry shares this leaf, or when the leaf is empty
    // (a path ending in '/'), which would otherwise draw a blank menu row.
    std::size_t sharing = 0;
    for (const std::string& other : paths_) {
      if (leafName(other) == leaf) ++sharing;
    }
    out.push_back((leaf.empty() || sharing > 1) ? p : leaf);
  }
  return out;
}

}  // namespace forge::ui
