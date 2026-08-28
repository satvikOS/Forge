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
  // A panel ID is a user-facing name ("Scratch Notes"), and serialization
  // percent-encodes it, so whitespace is legal here. Empty is not: it names
  // nothing and cannot be round-tripped back to itself.
  for (const PanelId& p : panels) {
    if (p.empty()) return false;
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

// Panel IDs are user-facing names and the stream is whitespace-tokenized, so
// every ID goes on the wire percent-encoded: '%' and any space/control byte
// become %XX. Without this a panel called "Scratch Notes" was written as two
// tokens under a count of one, so it parsed back as "Scratch" AND left "Notes"
// in the stream to be misread as the next node's tag. Nothing else needs
// escaping — the tokenizer splits on nothing else — so UTF-8 names stay legible.
// A lone '%' is the (otherwise unreachable) encoding of the empty string, which
// keeps serialize/parse token-aligned even for a layout valid() would reject.
std::string encodePanel(const PanelId& p) {
  if (p.empty()) return "%";
  static const char kHex[] = "0123456789ABCDEF";
  std::string out;
  out.reserve(p.size());
  for (unsigned char c : p) {
    if (c == '%' || c <= ' ' || c == 0x7F) {
      out += '%';
      out += kHex[c >> 4];
      out += kHex[c & 0x0F];
    } else {
      out += static_cast<char>(c);
    }
  }
  return out;
}

bool hexDigit(char c, int& out) {
  if (c >= '0' && c <= '9') { out = c - '0'; return true; }
  if (c >= 'A' && c <= 'F') { out = c - 'A' + 10; return true; }
  if (c >= 'a' && c <= 'f') { out = c - 'a' + 10; return true; }
  return false;
}

bool decodePanel(const std::string& token, PanelId& out) {
  if (token.empty()) return false;
  if (token == "%") { out.clear(); return true; }
  std::string decoded;
  decoded.reserve(token.size());
  for (std::size_t i = 0; i < token.size(); ++i) {
    if (token[i] != '%') {
      decoded += token[i];
      continue;
    }
    int hi = 0;
    int lo = 0;
    if (i + 2 >= token.size() || !hexDigit(token[i + 1], hi) || !hexDigit(token[i + 2], lo)) {
      return false;  // a truncated escape is corruption, not a panel name
    }
    decoded += static_cast<char>((hi << 4) | lo);
    i += 2;
  }
  out = std::move(decoded);
  return true;
}

void writeNode(std::ostringstream& os, const DockNode& n) {
  if (n.kind == DockNodeKind::Tabs) {
    os << " T " << n.activeTab << ' ' << n.panels.size();
    for (const PanelId& p : n.panels) os << ' ' << encodePanel(p);
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
      std::string token;
      if (!(is >> token)) return false;
      PanelId p;
      if (!decodePanel(token, p)) return false;
      n.panels.push_back(std::move(p));
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
  std::size_t declared = 0;
  if (!std::getline(lines, header)) return false;
  {
    std::istringstream hs(header);
    std::string magic;
    int version = 0;
    if (!(hs >> magic >> version >> declared)) return false;
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
    std::string trailing;
    if (is >> trailing) return false;  // leftover tokens: the stream desynchronised
    built.addWindow(std::move(w));
  }
  // The header states how many windows follow. Not comparing it is how a file
  // cut short loaded as a clean, smaller layout with its missing panels gone.
  if (built.windows_.size() != declared) return false;
  // And a well-formed record can still be nonsense — an activeTab past the end
  // of its tab vector, two mains, no main, the same panel docked twice. Refuse
  // it here rather than hand the frame builder an index it will read with.
  if (!built.valid()) return false;
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
