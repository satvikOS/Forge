// ui/test/app_surface_reachability_test.cpp
//
// CAN A USER REACH IT? capability_manifest_test.cpp proves the committed manifest
// equals the live registry. That is a different claim from the one the product
// makes. A command can be in the registry, in the manifest, dispatchable, and
// rendered by NO surface of the running app — and every gate stays green,
// because nothing was asserting the app's own enumeration.
//
// It happened. Measured on 6a7f3aa3, with all 12 UI gates passing: the ribbon
// showed 13 of 34 commands, and the 21 it omitted were every command that builds
// geometry — extrude, revolve, loft, shell, the three booleans, the three
// patterns, fillet/chamfer/hole/counterbore/mirror/variable_fillet, and the
// RECT/CIRCLE/TRANSLATE trio added to close the profile gap. ForgeFrame's ribbon
// was the one surface that did not enumerate the registry: it enumerated
// workspaceCategories(), a HAND-WRITTEN list of category names that claimed
// "Model" for the Part workspace and "Part" for no workspace at all.
//
// ── the two halves ──────────────────────────────────────────────────────────
// A gate that only checked forge::ui functions would be checking a library the
// app is free to stop calling, so this asserts both:
//
//   PART 1  ForgeFrame.cpp still BUILDS each surface from the registry. Its
//           source is read as data and each draw function is required to contain
//           the enumerating call, and to contain no hand-written command-id list.
//   PART 2  Those same forge::ui calls, run against the live registry, reach
//           every command — per surface, named individually on failure.
//
// Neither half alone is worth anything. Part 2 without Part 1 tests code nobody
// renders; Part 1 without Part 2 proves a call is present, not that it is total.
//
// ── what this gate does NOT prove ───────────────────────────────────────────
// Enumeration, not pixels. It proves each surface OFFERS every command; it
// cannot prove a widget is on screen, because the suite is headless by design
// (no display, no GPU, no ImGui header anywhere under ui/). Clipping is handled
// in ForgeFrame by making the ribbon horizontally scrollable; that part is
// unverified here and is stated as unverified rather than implied.
#include <algorithm>
#include <cstddef>
#include <cstdio>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/ToolCatalog.hpp"
#include "forge/ui/WorkspaceProfile.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

std::string readFile(const std::string& path, bool& ok) {
  std::ifstream in(path, std::ios::binary);
  if (!in) { ok = false; return {}; }
  std::ostringstream b; b << in.rdbuf(); ok = true; return b.str();
}

// Comments blanked, string and character literals KEPT, newlines preserved so
// line structure survives. Every check below reads the source for a call, and a
// comment is not a call: the comment in drawToolbar that explains why it stopped
// calling workspaceCategories() made this gate report that it still called it.
// Blanking rather than deleting keeps offsets stable for the reader.
std::string codeOnly(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  enum { Code, Line, Block, Str, Chr } st = Code;
  for (std::size_t i = 0; i < s.size(); ++i) {
    const char c = s[i];
    const char n = (i + 1 < s.size()) ? s[i + 1] : '\0';
    switch (st) {
      case Code:
        if (c == '/' && n == '/') { st = Line;  out += "  "; ++i; }
        else if (c == '/' && n == '*') { st = Block; out += "  "; ++i; }
        else { if (c == '"') st = Str; else if (c == '\'') st = Chr; out += c; }
        break;
      case Line:
        if (c == '\n') { st = Code; out += c; } else out += ' ';
        break;
      case Block:
        if (c == '*' && n == '/') { st = Code; out += "  "; ++i; }
        else out += (c == '\n' ? '\n' : ' ');
        break;
      case Str:
      case Chr:
        out += c;
        if (c == '\\') { if (i + 1 < s.size()) { out += s[i + 1]; ++i; } }
        else if ((st == Str && c == '"') || (st == Chr && c == '\'')) st = Code;
        break;
    }
  }
  return out;
}

// The body of `void ForgeFrame::<name>(`, from its signature to the closing
// brace in column 0. Empty when the function is not found, which the caller
// checks: a rename must turn this gate RED, not silently skip its assertions.
std::string functionBody(const std::string& src, const std::string& name) {
  const std::string sig = "void ForgeFrame::" + name + "(";
  const std::size_t begin = src.find(sig);
  if (begin == std::string::npos) return {};
  const std::size_t end = src.find("\n}\n", begin);
  if (end == std::string::npos) return {};
  return src.substr(begin, end - begin);
}

// The integer literal after `needle` — how the gate learns the palette's real
// result cap instead of hard-coding a second copy of it that can drift.
long long intAfter(const std::string& src, const std::string& needle, bool& ok) {
  const std::size_t at = src.find(needle);
  if (at == std::string::npos) { ok = false; return -1; }
  std::size_t i = at + needle.size();
  while (i < src.size() && (src[i] == ' ' || src[i] == '\t')) ++i;
  long long v = 0;
  bool any = false;
  while (i < src.size() && src[i] >= '0' && src[i] <= '9') { v = v * 10 + (src[i] - '0'); ++i; any = true; }
  ok = any;
  return any ? v : -1;
}

// Every double-quoted literal in `src` that is exactly a registry command ID.
std::set<std::string> hardcodedCommandIds(const std::string& src,
                                          const std::vector<std::string>& ids) {
  std::set<std::string> found;
  for (const std::string& id : ids) {
    if (src.find('"' + id + '"') != std::string::npos) found.insert(id);
  }
  return found;
}

// COVERAGE of `all` by `reached`, counted as |all ∩ reached| rather than
// |reached|: a surface that offers all 34 commands and one that does not exist
// covers 34, and saying "reaches 35 / 34" would be nonsense. Extras are a
// different defect and are checked where they can occur, at the manifest.
void reportMissing(Harness& H, const char* surface, const std::vector<std::string>& all,
                   const std::set<std::string>& reached) {
  std::size_t covered = 0;
  for (const std::string& id : all) {
    if (reached.count(id) != 0) { ++covered; continue; }
    std::printf("  [reachability] %s does NOT offer %s\n", surface, id.c_str());
  }
  std::printf("  [reachability] %-12s reaches %zu / %zu commands\n", surface, covered, all.size());
  ::forge::uitest::checkEqInt(H, static_cast<long long>(covered),
                              static_cast<long long>(all.size()),
                              std::string(surface).append(" reaches every command").c_str(),
                              __FILE__, __LINE__);
}

}  // namespace

int main() {
  Harness H("app_surface_reachability");

  // ── the live registry, built exactly as ForgeFrame::wirePartCommands does ──
  ForgeShell shell;
  PartDocument doc;
  UndoStack undo;
  CHECK_EQ_INT(doc.seed(IrValueKind::Profile, "sketch.base", "RECT",
                        {IrArg::num(80.0), IrArg::num(50.0)}), 1);
  CHECK_EQ_INT(doc.seed(IrValueKind::Solid, "body.bracket", "BOX",
                        {IrArg::num(80.0), IrArg::num(50.0), IrArg::num(20.0)}), 2);
  CHECK(registerPartCommands(shell.registry(), doc, undo) > 0);

  const CommandRegistry& reg = shell.registry();
  const std::vector<std::string> all = reg.ids();
  CHECK(all.size() == reg.size());
  CHECK(reg.size() > 0);
  std::printf("  [reachability] live registry holds %zu commands in %zu categories\n", reg.size(),
              reg.categories().size());

  // ═══ PART 1 — ForgeFrame still builds each surface FROM THE REGISTRY ══════
  long long paletteLimit = 20;  // overwritten from the source below
#ifdef FORGE_UI_REPO_ROOT
  const std::string framePath = std::string(FORGE_UI_REPO_ROOT) + "/forge-desktop/src/ForgeFrame.cpp";
  bool haveFrame = false;
  const std::string frameRaw = readFile(framePath, haveFrame);
  if (!haveFrame) {
    std::printf("  [reachability] CANNOT READ %s -- a gate that cannot read its subject\n",
                framePath.c_str());
    std::printf("  cannot pass. This is RED on purpose.\n");
    CHECK(haveFrame);
    return H.finish();
  }
  // Every check below asks what the app CALLS, so it reads code, not prose.
  const std::string frame = codeOnly(frameRaw);
  CHECK_EQ_INT(frame.size(), frameRaw.size());  // blanking preserves length
  // POSITIVE CONTROL for the stripper: drawToolbar's comment NAMES the call it
  // stopped making. If codeOnly() were a no-op the "no direct call" check below
  // would fail on that comment -- and if it over-stripped, every check in PART 1
  // would pass vacuously. Assert it removed exactly the prose and kept the code.
  {
    const std::string rawBody = functionBody(frameRaw, "drawToolbar");
    const std::string codeBody = functionBody(frame, "drawToolbar");
    CHECK(rawBody.find("workspaceCategories(") != std::string::npos);   // present in prose
    CHECK(codeBody.find("workspaceCategories(") == std::string::npos);  // absent from code
    CHECK(codeBody.find("ImGui::Button(") != std::string::npos);        // code survived
  }

  // Each surface, the function that draws it, and the call it must still make.
  struct Surface { const char* fn; const char* mustCall; const char* why; };
  const Surface surfaces[] = {
      {"drawMenuBar", "registry().idsInCategory(", "menu bar enumerates the registry by category"},
      {"drawToolbar", "forge::ui::ribbonCategories(", "ribbon uses the TOTAL category list"},
      {"drawToolbar", "registry().idsInCategory(", "ribbon enumerates the registry by category"},
      {"drawContextMenu", "registry().ids()", "context menu enumerates every registry ID"},
      {"drawCommandPalette", "registry().search(", "palette uses the registry's own matcher"},
      {"drawGenericPanel", "forge::ui::ribbonCategories(", "panel list uses the TOTAL list"},
  };
  for (const Surface& s : surfaces) {
    const std::string body = functionBody(frame, s.fn);
    if (body.empty()) {
      std::printf("  [reachability] ForgeFrame::%s NOT FOUND in %s\n", s.fn, framePath.c_str());
      CHECK(!body.empty());
      continue;
    }
    const bool calls = body.find(s.mustCall) != std::string::npos;
    if (!calls)
      std::printf("  [reachability] ForgeFrame::%s no longer calls %s -- %s\n", s.fn, s.mustCall,
                  s.why);
    CHECK(calls);
  }

  // workspaceCategories() is the hand-written claim list. Only ribbonCategories()
  // -- which makes it total -- may drive a surface. A direct call from a draw
  // function is the exact defect this gate was written for, coming back.
  for (const char* fn : {"drawToolbar", "drawGenericPanel"}) {
    const std::string body = functionBody(frame, fn);
    const bool direct = body.find("workspaceCategories(") != std::string::npos;
    if (direct)
      std::printf("  [reachability] ForgeFrame::%s calls workspaceCategories() DIRECTLY -- that "
                  "is the hand-written list, and it is not total over the registry\n", fn);
    CHECK(!direct);
  }

  // No hand-written command list anywhere in the frame. `app.command_palette` is
  // the one legitimate literal (a named button that opens the palette). Any other
  // ID appearing as a literal is a second, drifting copy of the registry.
  const std::set<std::string> literals = hardcodedCommandIds(frame, all);
  for (const std::string& id : literals)
    if (id != "app.command_palette")
      std::printf("  [reachability] ForgeFrame.cpp hard-codes command ID \"%s\"\n", id.c_str());
  CHECK_EQ_INT(literals.size(), 1);
  CHECK_EQ_INT(literals.count("app.command_palette"), 1);

  // The palette's real cap, read from the app rather than restated here.
  bool haveLimit = false;
  paletteLimit = intAfter(frame, "registry().search(paletteQuery_,", haveLimit);
  if (!haveLimit)
    std::printf("  [reachability] could not read the palette's result cap from ForgeFrame.cpp\n");
  CHECK(haveLimit);
  CHECK(paletteLimit > 0);
  std::printf("  [reachability] palette result cap read from ForgeFrame.cpp = %lld\n", paletteLimit);
#else
#error "FORGE_UI_REPO_ROOT is required: this gate reads ForgeFrame.cpp as data."
#endif

  // ═══ PART 2 — those same calls reach EVERY command ═══════════════════════
  // menu bar: registry.categories() x registry.idsInCategory(cat)
  {
    std::set<std::string> reached;
    for (const std::string& cat : reg.categories())
      for (const std::string& id : reg.idsInCategory(cat)) reached.insert(id);
    reportMissing(H, "menu bar", all, reached);
  }

  // ribbon: ribbonCategories(ws, registry categories) x idsInCategory, over
  // every workspace. THE surface that was broken.
  {
    std::set<std::string> reached;
    const std::vector<std::string> regCats = reg.categories();
    for (WorkspaceProfile p : allWorkspaceProfiles()) {
      std::size_t here = 0;
      for (const std::string& cat : ribbonCategories(p, regCats))
        for (const std::string& id : reg.idsInCategory(cat)) { reached.insert(id); ++here; }
      std::printf("  [reachability] ribbon/%-14s offers %2zu commands\n", toString(p), here);
    }
    reportMissing(H, "ribbon", all, reached);
  }

  // palette: typing the full ID must surface it, at the app's OWN cap.
  {
    std::set<std::string> reached;
    for (const std::string& id : all) {
      const std::vector<std::string> hits =
          reg.search(id, static_cast<std::size_t>(paletteLimit));
      if (std::find(hits.begin(), hits.end(), id) != hits.end()) reached.insert(id);
    }
    reportMissing(H, "palette", all, reached);
  }

  // tool catalog: the Archie-facing view, unfiltered.
  {
    ToolCatalog cat = buildToolCatalog(reg, shell.selection(), "");
    std::set<std::string> reached;
    for (const ToolEntry& e : cat.entries) reached.insert(e.id);
    reportMissing(H, "tool catalog", all, reached);
  }

  // the committed manifest: what Archie is told exists.
#ifdef FORGE_UI_REPO_ROOT
  {
    bool ok = false;
    const std::string tsv = readFile(
        std::string(FORGE_UI_REPO_ROOT) + "/implementation/sacrosanct/APP_SURFACE_MANIFEST.tsv", ok);
    CHECK(ok);
    std::set<std::string> reached;
    std::istringstream in(tsv);
    std::string line;
    while (std::getline(in, line)) {
      if (line.empty() || line[0] == '#') continue;
      const std::size_t tab = line.find('\t');
      reached.insert(tab == std::string::npos ? line : line.substr(0, tab));
    }
    // Rows naming a command that no longer exists are the other drift direction.
    for (const std::string& id : reached)
      if (!reg.contains(id))
        std::printf("  [reachability] manifest lists %s, which the registry does NOT hold\n",
                    id.c_str());
    CHECK_EQ_INT(reached.size(), reg.size());
    reportMissing(H, "manifest", all, reached);
  }
#endif

  // ═══ the totality property itself ════════════════════════════════════════
  // Every category the registry holds must be claimed by some ribbon. This is
  // what ribbonCategories() guarantees; asserting it separately means a future
  // rewrite of that function cannot quietly drop the guarantee.
  {
    const std::vector<std::string> regCats = reg.categories();
    std::set<std::string> claimed;
    for (WorkspaceProfile p : allWorkspaceProfiles())
      for (const std::string& c : ribbonCategories(p, regCats)) claimed.insert(c);
    for (const std::string& c : regCats)
      if (claimed.count(c) == 0)
        std::printf("  [reachability] registry category \"%s\" is on NO workspace ribbon\n",
                    c.c_str());
    std::size_t orphans = 0;
    for (const std::string& c : regCats) if (claimed.count(c) == 0) ++orphans;
    CHECK_EQ_INT(orphans, 0);
  }

  // POSITIVE CONTROL for the fallback. A category no workspace claims must land
  // on the default ribbon. Without this the fallback is dead code that looks
  // alive: today every registry category is claimed outright, so the sweep never
  // fires and a broken sweep would be invisible.
  {
    std::vector<std::string> fake = reg.categories();
    fake.push_back("Sheetmetal");  // claimed by no workspace, now or ever
    const std::vector<std::string> onDefault = ribbonCategories(kDefaultWorkspace, fake);
    const bool swept = std::find(onDefault.begin(), onDefault.end(), "Sheetmetal") != onDefault.end();
    if (!swept)
      std::printf("  [reachability] the unclaimed-category sweep did NOT place \"Sheetmetal\" on "
                  "the %s ribbon -- a new category would be unreachable\n",
                  toString(kDefaultWorkspace));
    CHECK(swept);
    // and it must NOT be swept onto a non-default ribbon, or every workspace
    // would slowly accumulate every category and the claim list would mean nothing.
    for (WorkspaceProfile p : allWorkspaceProfiles()) {
      if (p == kDefaultWorkspace) continue;
      const std::vector<std::string> other = ribbonCategories(p, fake);
      CHECK(std::find(other.begin(), other.end(), "Sheetmetal") == other.end());
    }
    // A category that IS claimed must not be duplicated by the sweep.
    const std::vector<std::string> dflt = ribbonCategories(kDefaultWorkspace, reg.categories());
    std::vector<std::string> sorted = dflt;
    std::sort(sorted.begin(), sorted.end());
    CHECK(std::adjacent_find(sorted.begin(), sorted.end()) == sorted.end());
    CHECK(std::is_sorted(dflt.begin(), dflt.end()));
  }

  // NEGATIVE CONTROL for the reporter itself. reportMissing() must be able to
  // FAIL: a reporter that always passes is the silent-green failure this whole
  // gate exists to prevent. Run it against a deliberately short set on a private
  // harness, and assert THAT harness went red.
  {
    std::printf("  [reachability] ---- NEGATIVE CONTROL: the FAIL line below is EXPECTED. It is\n");
    std::printf("  [reachability] ---- raised on a private harness, and this gate goes RED if it\n");
    std::printf("  [reachability] ---- does NOT appear. ------------------------------------------\n");
    Harness probe("negative_control");
    std::set<std::string> deliberatelyShort(all.begin(), all.end());
    deliberatelyShort.erase(all.front());
    reportMissing(probe, "(negative control -- one command removed)", all, deliberatelyShort);
    CHECK_EQ_INT(probe.failures, 1);
    std::printf("  [reachability] negative control: reporter went RED on a 1-command hole "
                "(%zu failures) -- it can fail\n", probe.failures);
  }

  return H.finish();
}
