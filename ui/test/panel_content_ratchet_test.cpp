// ui/test/panel_content_ratchet_test.cpp
//
// THE EMPTY-PANEL RATCHET — how many docked tabs still show nothing, pinned so
// the number can only FALL.
//
// MEASURED, on the merge base of this change: the eight default workspaces
// define 50 distinct panels and 27 of them had no content. They named the tab,
// said in one sentence what it would one day show, and stopped. That is not a
// small cosmetic gap: it is more than half of every docked surface in the
// application, and nothing in the repository counted it, so it could have grown
// by one on any pull request and no check would have moved.
//
// ── WHY A RATCHET, AND WHY IT IS RED IN BOTH DIRECTIONS ─────────────────────
//
//   A NEW empty panel  -> RED. This is the regression the pin exists to stop: a
//                         workspace gains a tab, nobody writes its content, and
//                         the application gets emptier while every check stays
//                         green.
//
//   A pinned panel that GAINS content -> ALSO RED, and this half is the one that
//                         makes the pin evidence rather than decoration. It is
//                         progress, and the gate demands the pin be lowered in
//                         the same commit — so the list below can never sit
//                         above the truth and silently re-admit a regression it
//                         has already been raised past. (The same rule
//                         forge-kernel/test/gate_registration_ratchet.sh keeps,
//                         for the same reason.)
//
// ── WHAT "HAS CONTENT" MEANS HERE, AND WHY IT IS NOT ONE WORD ───────────────
// A panel counts as filled only when BOTH halves agree:
//
//   1. forge-desktop/src/ForgeFrame.cpp's drawPanel() actually dispatches it to
//      a panel body, read out of that file's own source; and
//   2. forge::ui::panelCatalog() declares it Live.
//
// Deriving it from the catalogue ALONE would make this gate satisfiable by
// editing one word — a panel could be declared finished without a line of it
// being written. Deriving it from the dispatch alone would let the sentence a
// user hovers go stale. Requiring both means lowering the pin costs an actual
// implementation. (ui/test/user_facing_text_test.cpp separately proves the two
// never disagree; this file does not depend on that, it re-derives both.)
//
// ── THE CHECK IS PROVED BEFORE IT IS BELIEVED ───────────────────────────────
// Section A drives the comparison with SYNTHETIC pins and measurements and
// requires it to go red in each direction. A ratchet whose comparison has never
// been seen to fire is indistinguishable from one that cannot.
#include <algorithm>
#include <cstddef>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "forge/ui/DockLayout.hpp"
#include "forge/ui/PanelCatalog.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// ── THE PIN ─────────────────────────────────────────────────────────────────
//
// Every panel in a shipped default workspace that still shows no content.
// MEASURED, not remembered — run this gate and it prints the list it measured.
//
// TO LOWER IT: implement the panel, dispatch it in ForgeFrame::drawPanel, flip
// its catalogue row to Live, and DELETE its line here. All four in one commit;
// the gate is red until they agree.
//
// Do not ADD a line here to make a red gate green. A new empty panel is the
// defect this file exists to report.
const char* const kPinnedEmptyPanels[] = {
    "annotation",
    "convergence",
    "fixtures",
    "gdt",
    "interference",
    "loads",
    "post_output",
    "restraints",
    "title_block",
    "view_list",
    "zebra_analysis",
};

// ── the comparison, as a function, so it can be proved falsifiable ──────────
struct RatchetVerdict {
  // Measured empty, not pinned: a panel LOST content or was added with none.
  std::vector<std::string> regressions;
  // Pinned empty, measured filled: progress. The pin must come down.
  std::vector<std::string> improvements;

  bool ok() const noexcept { return regressions.empty() && improvements.empty(); }
};

RatchetVerdict compare(const std::vector<std::string>& pinned,
                       const std::vector<std::string>& measured) {
  RatchetVerdict v;
  for (const std::string& id : measured) {
    if (std::find(pinned.begin(), pinned.end(), id) == pinned.end()) v.regressions.push_back(id);
  }
  for (const std::string& id : pinned) {
    if (std::find(measured.begin(), measured.end(), id) == measured.end()) {
      v.improvements.push_back(id);
    }
  }
  return v;
}

// ── reading the frame builder's own dispatch ────────────────────────────────
std::string readFile(const std::string& path, bool& ok) {
  std::ifstream in(path, std::ios::binary);
  if (!in) { ok = false; return {}; }
  std::ostringstream ss;
  ss << in.rdbuf();
  ok = true;
  return ss.str();
}

std::string repoRoot() {
#ifdef FORGE_UI_REPO_ROOT
  return std::string(FORGE_UI_REPO_ROOT);
#else
  return std::string(".");
#endif
}

// The body of `void ForgeFrame::drawPanel(`, brace-balanced, with comments and
// character literals removed so a panel id mentioned in a comment is not read as
// a dispatch. String literals are KEPT: they are what is being collected.
std::string dispatchBody(const std::string& src, bool& found) {
  found = false;
  const std::size_t sig = src.find("void ForgeFrame::drawPanel(");
  if (sig == std::string::npos) return {};
  const std::size_t open = src.find('{', sig);
  if (open == std::string::npos) return {};

  std::string body;
  int depth = 0;
  for (std::size_t i = open; i < src.size(); ++i) {
    const char c = src[i];
    if (c == '/' && i + 1 < src.size() && src[i + 1] == '/') {
      const std::size_t nl = src.find('\n', i);
      if (nl == std::string::npos) break;
      i = nl;
      continue;
    }
    if (c == '/' && i + 1 < src.size() && src[i + 1] == '*') {
      const std::size_t end = src.find("*/", i + 2);
      if (end == std::string::npos) break;
      i = end + 1;
      continue;
    }
    if (c == '\'') {
      std::size_t j = i + 1;
      while (j < src.size() && src[j] != '\'') { if (src[j] == '\\') ++j; ++j; }
      i = j;
      continue;
    }
    if (c == '"') {
      std::size_t j = i + 1;
      while (j < src.size() && src[j] != '"') { if (src[j] == '\\') ++j; ++j; }
      body.append(src, i, j - i + 1);
      i = j;
      continue;
    }
    body.push_back(c);
    if (c == '{') ++depth;
    if (c == '}') {
      --depth;
      if (depth == 0) { found = true; return body; }
    }
  }
  return body;
}

std::vector<std::string> stringLiterals(const std::string& text) {
  std::vector<std::string> out;
  for (std::size_t i = 0; i < text.size(); ++i) {
    if (text[i] != '"') continue;
    std::size_t j = i + 1;
    std::string lit;
    while (j < text.size() && text[j] != '"') {
      if (text[j] == '\\' && j + 1 < text.size()) { lit.push_back(text[j + 1]); j += 2; continue; }
      lit.push_back(text[j]);
      ++j;
    }
    out.push_back(lit);
    i = j;
  }
  return out;
}

}  // namespace

int main() {
  Harness H("panel_content_ratchet");

  const std::vector<std::string> pinned(std::begin(kPinnedEmptyPanels),
                                        std::end(kPinnedEmptyPanels));

  // ── A. THE COMPARISON GOES RED IN BOTH DIRECTIONS ─────────────────────────
  {
    const std::vector<std::string> base = {"bom", "gdt", "mates"};
    CHECK(compare(base, base).ok());

    // A new empty panel.
    std::vector<std::string> worse = base;
    worse.push_back("flange_wizard");
    const RatchetVerdict a = compare(base, worse);
    CHECK(!a.ok());
    CHECK_EQ_INT(a.regressions.size(), 1);
    CHECK_EQ_STR(forge::uitest::at(a.regressions, 0), "flange_wizard");
    CHECK_EQ_INT(a.improvements.size(), 0);

    // A pinned panel that gained content: ALSO red, with the pin named.
    const std::vector<std::string> better = {"bom", "mates"};
    const RatchetVerdict b = compare(base, better);
    CHECK(!b.ok());
    CHECK_EQ_INT(b.improvements.size(), 1);
    CHECK_EQ_STR(forge::uitest::at(b.improvements, 0), "gdt");
    CHECK_EQ_INT(b.regressions.size(), 0);

    // Both at once, and the empty pin against a non-empty measurement.
    const RatchetVerdict c = compare(base, {"bom", "gdt", "sheet_wizard"});
    CHECK_EQ_INT(c.regressions.size(), 1);
    CHECK_EQ_INT(c.improvements.size(), 1);
    CHECK(!compare({}, {"bom"}).ok());
    CHECK(!compare({"bom"}, {}).ok());
    CHECK(compare({}, {}).ok());
  }

  // ── B. WHAT THE FRAME BUILDER ACTUALLY DISPATCHES ─────────────────────────
  const std::string framePath = repoRoot() + "/forge-desktop/src/ForgeFrame.cpp";
  bool ok = false;
  const std::string frame = readFile(framePath, ok);
  if (!ok) std::printf("  cannot read %s -- the measurement cannot run\n", framePath.c_str());
  CHECK(ok);
  if (!ok) return H.finish();

  bool foundDispatch = false;
  const std::string body = dispatchBody(frame, foundDispatch);
  if (!foundDispatch) {
    std::printf("  ForgeFrame::drawPanel() was not found, or its body did not close -- this "
                "gate cannot measure anything and must not report success\n");
  }
  CHECK(foundDispatch);
  const std::vector<std::string> dispatched = stringLiterals(body);
  // A dispatch that parsed to almost nothing would make every panel look empty
  // and the ratchet would report a flood of false regressions rather than a
  // silent pass -- but it would still be a lie. Refuse the parse instead.
  if (dispatched.size() < 10) {
    std::printf("  only %zu ids parsed out of drawPanel() -- the reader has stopped matching\n",
                dispatched.size());
  }
  CHECK(dispatched.size() >= 10);

  // The viewport family is matched by a PREFIX and so appears in no literal.
  // Mirrored here, and the mirror is PINNED: if the predicate changes this fails
  // and asks to be updated rather than quietly disagreeing with the application.
  const bool predicatePinned =
      frame.find("return id.rfind(\"viewport_\", 0) == 0 || id == \"sheet_canvas\";") !=
      std::string::npos;
  if (!predicatePinned) {
    std::printf("  isViewportPanel() has changed; update the mirror in this gate\n");
  }
  CHECK(predicatePinned);

  const auto isDispatched = [&dispatched](const std::string& id) {
    if (id.rfind("viewport_", 0) == 0 || id == "sheet_canvas") return true;
    return std::find(dispatched.begin(), dispatched.end(), id) != dispatched.end();
  };

  // ── C. MEASURE, then apply the ratchet ────────────────────────────────────
  const std::vector<PanelId> shipped = defaultLayoutPanelIds();
  // The population must not be able to collapse: if defaultLayout() stopped
  // naming panels, every pinned id would look "filled" and this gate would
  // report a triumphant improvement over an application with no panels at all.
  CHECK(shipped.size() >= 40);

  std::vector<std::string> measuredEmpty;
  std::vector<std::string> disagreements;
  for (const PanelId& id : shipped) {
    const PanelInfo* info = findPanelInfo(id);
    const bool drawn = isDispatched(id);
    const bool declared = info != nullptr && info->live();
    // BOTH halves, so lowering the pin costs an implementation and not a word.
    if (!drawn || !declared) measuredEmpty.push_back(id);
    if (drawn != declared) disagreements.push_back(id);
  }
  std::sort(measuredEmpty.begin(), measuredEmpty.end());

  std::printf("[panel-ratchet] %zu panels in the eight default workspaces, %zu still empty "
              "(pinned at %zu)\n",
              shipped.size(), measuredEmpty.size(), pinned.size());
  for (const std::string& id : measuredEmpty) std::printf("[panel-ratchet]     %s\n", id.c_str());

  // A panel drawn but declared planned (or the reverse) is a separate defect and
  // is reported by name rather than folded into the count.
  for (const std::string& id : disagreements) {
    std::printf("  panel \"%s\": the frame builder and the catalogue disagree about whether it "
                "has content\n", id.c_str());
  }
  CHECK_EQ_INT(disagreements.size(), 0);

  const RatchetVerdict v = compare(pinned, measuredEmpty);
  for (const std::string& id : v.regressions) {
    std::printf("  RED: \"%s\" shows no content and is not pinned. A workspace tab that draws "
                "nothing is not a feature; write its content, or say here why it cannot be "
                "written yet.\n", id.c_str());
  }
  for (const std::string& id : v.improvements) {
    std::printf("  RED ON AN IMPROVEMENT: \"%s\" now has content. Delete it from "
                "kPinnedEmptyPanels in this file. A pin left above the truth can silently "
                "re-admit a regression it has already been lowered past.\n", id.c_str());
  }
  CHECK_EQ_INT(v.regressions.size(), 0);
  CHECK_EQ_INT(v.improvements.size(), 0);
  CHECK_EQ_INT(measuredEmpty.size(), pinned.size());

  return H.finish();
}
