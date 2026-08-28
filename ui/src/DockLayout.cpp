#include "forge/ui/DockLayout.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/Types.hpp"

namespace forge::ui {

// ── DockNode ────────────────────────────────────────────────────────────────
DockNode DockNode::tabs(std::vector<PanelId> ids, std::size_t active) {
  DockNode n;
  n.kind = DockNodeKind::Tabs;
  n.panels = std::move(ids);
  n.activeTab = active;
  return n;
}

DockNode DockNode::split(SplitAxis axis, double ratio, DockNode first, DockNode second) {
  DockNode n;
  n.kind = DockNodeKind::Split;
  n.axis = axis;
  n.ratio = ratio;
  n.children.push_back(std::move(first));
  n.children.push_back(std::move(second));
  return n;
}

void DockNode::collectPanels(std::vector<PanelId>& out) const {
  if (kind == DockNodeKind::Tabs) {
    out.insert(out.end(), panels.begin(), panels.end());
    return;
  }
  for (const DockNode& c : children) c.collectPanels(out);
}

bool DockNode::valid() const {
  if (kind == DockNodeKind::Split) {
    if (children.size() != 2) return false;
    if (!(ratio > 0.0 && ratio < 1.0)) return false;
    if (!panels.empty()) return false;
    return children[0].valid() && children[1].valid();
  }
  if (!children.empty()) return false;
  if (panels.empty()) return false;
  if (activeTab >= panels.size()) return false;
  for (const PanelId& p : panels) {
    if (p.empty() || p.find(' ') != std::string::npos) return false;
  }
  return true;
}

bool operator==(const DockNode& a, const DockNode& b) {
  if (a.kind != b.kind) return false;
  if (a.kind == DockNodeKind::Tabs) {
    return a.panels == b.panels && a.activeTab == b.activeTab;
  }
  if (a.axis != b.axis) return false;
  if (a.ratio < b.ratio - 1e-9 || a.ratio > b.ratio + 1e-9) return false;
  if (a.children.size() != b.children.size()) return false;
  for (std::size_t i = 0; i < a.children.size(); ++i) {
    if (!(a.children[i] == b.children[i])) return false;
  }
  return true;
}

bool operator==(const DockWindow& a, const DockWindow& b) {
  return a.id == b.id && a.monitor == b.monitor && a.rect == b.rect && a.main == b.main &&
         a.root == b.root;
}

// ── DockLayout ──────────────────────────────────────────────────────────────
void DockLayout::addWindow(DockWindow window) { windows_.push_back(std::move(window)); }

const DockWindow* DockLayout::mainWindow() const noexcept {
  for (const DockWindow& w : windows_) {
    if (w.main) return &w;
  }
  return nullptr;
}

std::vector<PanelId> DockLayout::panels() const {
  std::vector<PanelId> out;
  for (const DockWindow& w : windows_) w.root.collectPanels(out);
  std::sort(out.begin(), out.end());
  return out;
}

bool DockLayout::hasPanel(const PanelId& id) const {
  const std::vector<PanelId> all = panels();
  return std::binary_search(all.begin(), all.end(), id);
}

std::size_t DockLayout::panelCount() const { return panels().size(); }

bool DockLayout::valid() const {
  if (windows_.empty()) return false;
  std::size_t mains = 0;
  std::vector<std::int32_t> ids;
  for (const DockWindow& w : windows_) {
    if (w.main) ++mains;
    if (std::find(ids.begin(), ids.end(), w.id) != ids.end()) return false;  // duplicate window id
    ids.push_back(w.id);
    if (w.rect.empty()) return false;
    if (!w.root.valid()) return false;
  }
  if (mains != 1) return false;
  // A panel must live in exactly one place, or focus and state become ambiguous.
  std::vector<PanelId> all = panels();
  return std::adjacent_find(all.begin(), all.end()) == all.end();
}

// ── multi-monitor recovery ──────────────────────────────────────────────────
namespace {

const MonitorInfo* fallbackMonitor(const std::vector<MonitorInfo>& available) {
  const MonitorInfo* best = nullptr;
  for (const MonitorInfo& m : available) {
    if (m.primary) return &m;
    if (best == nullptr || m.id < best->id) best = &m;
  }
  return best;
}

const MonitorInfo* findMonitor(const std::vector<MonitorInfo>& available, MonitorId id) {
  for (const MonitorInfo& m : available) {
    if (m.id == id) return &m;
  }
  return nullptr;
}

// Clamp `r` into `wa`, shrinking first so the whole window is reachable, then
// sliding it inside. Returns true if anything changed.
bool clampInto(Rect& r, const Rect& wa) {
  const Rect before = r;
  r.w = std::min(r.w, wa.w);
  r.h = std::min(r.h, wa.h);
  r.x = std::max(wa.x, std::min(r.x, wa.right() - r.w));
  r.y = std::max(wa.y, std::min(r.y, wa.bottom() - r.h));
  return !(r == before);
}

}  // namespace

RecoveryReport DockLayout::reconcileMonitors(const std::vector<MonitorInfo>& available) {
  RecoveryReport report;
  report.panelsBefore = panelCount();
  report.panelsAfter = report.panelsBefore;
  if (available.empty()) return report;  // nothing to recover onto: change nothing

  const MonitorInfo* fallback = fallbackMonitor(available);
  if (fallback == nullptr) return report;

  std::size_t cascade = 0;
  for (DockWindow& w : windows_) {
    const MonitorInfo* home = findMonitor(available, w.monitor);
    if (home == nullptr) {
      // The monitor this window lived on is gone. Move it — never drop it: the
      // panels inside are the user's workspace, and an unreachable window and a
      // deleted one are the same thing from the user's side.
      w.monitor = fallback->id;
      const Rect& wa = fallback->workArea;
      const double offset = 24.0 * static_cast<double>(cascade);
      ++cascade;
      w.rect.w = std::min(w.rect.w, wa.w);
      w.rect.h = std::min(w.rect.h, wa.h);
      w.rect.x = wa.x + std::min(offset, std::max(0.0, wa.w - w.rect.w));
      w.rect.y = wa.y + std::min(offset, std::max(0.0, wa.h - w.rect.h));
      clampInto(w.rect, wa);
      ++report.windowsMoved;
    } else if (clampInto(w.rect, home->workArea)) {
      // Monitor survived but its work area shrank (resolution change, a dock
      // bar appearing). Slide the window back into view.
      ++report.windowsClamped;
    }
  }
  report.panelsAfter = panelCount();
  return report;
}

// ── serialization ───────────────────────────────────────────────────────────
namespace {

std::string num(double v) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.6f", v);
  return std::string(buf);
}

void writeNode(std::ostringstream& os, const DockNode& n) {
  if (n.kind == DockNodeKind::Tabs) {
    os << " T " << n.activeTab << ' ' << n.panels.size();
    for (const PanelId& p : n.panels) os << ' ' << p;
    return;
  }
  os << " S " << (n.axis == SplitAxis::Horizontal ? 'h' : 'v') << ' ' << num(n.ratio);
  writeNode(os, n.children[0]);
  writeNode(os, n.children[1]);
}

bool readNode(std::istringstream& is, DockNode& out) {
  std::string tag;
  if (!(is >> tag)) return false;
  if (tag == "T") {
    std::size_t active = 0;
    std::size_t count = 0;
    if (!(is >> active >> count)) return false;
    if (count == 0 || count > 4096) return false;
    DockNode n;
    n.kind = DockNodeKind::Tabs;
    n.activeTab = active;
    n.panels.reserve(count);
    for (std::size_t i = 0; i < count; ++i) {
      std::string p;
      if (!(is >> p)) return false;
      n.panels.push_back(p);
    }
    out = std::move(n);
    return true;
  }
  if (tag == "S") {
    std::string axis;
    double ratio = 0.0;
    if (!(is >> axis >> ratio)) return false;
    if (axis != "h" && axis != "v") return false;
    DockNode first;
    DockNode second;
    if (!readNode(is, first)) return false;
    if (!readNode(is, second)) return false;
    out = DockNode::split(axis == "h" ? SplitAxis::Horizontal : SplitAxis::Vertical, ratio,
                          std::move(first), std::move(second));
    return true;
  }
  return false;
}

}  // namespace

std::string DockLayout::serialize() const {
  std::ostringstream os;
  os << "forge-dock 1 " << windows_.size() << '\n';
  for (const DockWindow& w : windows_) {
    os << "w " << w.id << ' ' << w.monitor << ' ' << num(w.rect.x) << ' ' << num(w.rect.y) << ' '
       << num(w.rect.w) << ' ' << num(w.rect.h) << ' ' << (w.main ? 1 : 0);
    writeNode(os, w.root);
    os << '\n';
  }
  return os.str();
}

bool DockLayout::parse(const std::string& text, DockLayout& out) {
  std::istringstream lines(text);
  std::string header;
  if (!std::getline(lines, header)) return false;
  {
    std::istringstream hs(header);
    std::string magic;
    int version = 0;
    std::size_t count = 0;
    if (!(hs >> magic >> version >> count)) return false;
    if (magic != "forge-dock" || version != 1) return false;
  }

  DockLayout built;
  std::string line;
  while (std::getline(lines, line)) {
    if (line.empty()) continue;
    std::istringstream is(line);
    std::string tag;
    DockWindow w;
    int mainFlag = 0;
    if (!(is >> tag >> w.id >> w.monitor >> w.rect.x >> w.rect.y >> w.rect.w >> w.rect.h >>
          mainFlag)) {
      return false;
    }
    if (tag != "w") return false;
    w.main = mainFlag != 0;
    if (!readNode(is, w.root)) return false;
    built.addWindow(std::move(w));
  }
  if (built.windows_.empty()) return false;
  out = std::move(built);
  return true;
}

bool operator==(const DockLayout& a, const DockLayout& b) {
  if (a.windowCount() != b.windowCount()) return false;
  for (std::size_t i = 0; i < a.windowCount(); ++i) {
    if (!(a.windows()[i] == b.windows()[i])) return false;
  }
  return true;
}

}  // namespace forge::ui
