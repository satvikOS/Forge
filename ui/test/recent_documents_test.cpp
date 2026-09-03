// ui/test/recent_documents_test.cpp
//
// CAN A USER FIND THE PART THEY SAVED YESTERDAY?
//
// Three subjects, and the second and third are the ones that matter, because a
// list nobody writes to and a list that does not survive a relaunch are both
// indistinguishable from no list at all:
//
//   1. RecentDocuments itself — order, dedup, the cap, the paths it refuses.
//   2. THE HANDLERS write it. file.open and file.save are what feed the list,
//      and they are driven here through ForgeShell::run() — the same dispatch a
//      menu click, Ctrl+O, the palette and `--open` go through — against a real
//      DocumentHost. A refused open must leave the list untouched.
//   3. IT SURVIVES A RELAUNCH, byte-identically, through saveState/loadState,
//      including the ORDER (a most-recent-first file replayed through remember()
//      would come back reversed) and including a session file that predates the
//      record entirely.
#include <cstddef>
#include <string>
#include <vector>

#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/RecentDocuments.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// A DocumentHost that does no I/O: it records what it was asked to do and
// answers with the path it "wrote", which is what the shell reads back. Open
// fails for any path this host has not been told exists — that is the refusal
// case the list must ignore.
class FakeHost final : public DocumentHost {
 public:
  std::vector<std::string> openable;
  // Where a bare save with no path goes, standing in for ~/.forge/<name>.fpart.
  std::string defaultSaveTarget = "/home/u/.forge/untitled.fpart";
  std::string path;
  std::size_t opens = 0;
  std::size_t saves = 0;
  std::size_t refusedOpens = 0;

  bool documentNew(std::string& error) override {
    error.clear();
    path.clear();
    return true;
  }
  bool documentReset(std::string& error) override {
    error.clear();
    return true;
  }
  bool documentOpen(const std::string& p, std::string& error) override {
    for (const std::string& ok : openable) {
      if (ok == p) {
        path = p;
        ++opens;
        error.clear();
        return true;
      }
    }
    ++refusedOpens;
    error = "no such document: " + p;
    return false;
  }
  bool documentSave(const std::string& p, std::string& error) override {
    error.clear();
    path = p.empty() ? (path.empty() ? defaultSaveTarget : path) : p;
    ++saves;
    return true;
  }
  bool documentUndo() override { return false; }
  bool documentRedo() override { return false; }
  void documentChanged() override {}
  std::size_t documentFeatureCount() const override { return 1; }
  std::size_t documentUndoDepth() const override { return 0; }
  std::size_t documentRedoDepth() const override { return 0; }
  bool documentDirty() const override { return true; }
  std::string documentPath() const override { return path; }
};

CommandParams withPath(const std::string& p) {
  CommandParams params;
  params.setText("path", p);
  return params;
}

}  // namespace

int main() {
  Harness H("recent_documents");

  // ═══ 1 — the model ════════════════════════════════════════════════════════
  {
    RecentDocuments r;
    CHECK_EQ_INT(r.capacity(), RecentDocuments::kDefaultCapacity);
    CHECK(r.empty());
    CHECK_EQ_STR(r.mostRecent(), std::string());

    CHECK(r.remember("/parts/a.fpart"));
    CHECK(r.remember("/parts/b.fpart"));
    CHECK_EQ_INT(r.size(), 2);
    // MOST RECENT FIRST. The order is the whole product of this class: a list
    // that appends would offer the oldest part at the top of the menu.
    CHECK_EQ_STR(r.mostRecent(), std::string("/parts/b.fpart"));
    CHECK_EQ_STR(r.paths()[1], std::string("/parts/a.fpart"));

    // Re-remembering MOVES, never duplicates. Reopening one part fifty times
    // must not evict the other nine.
    CHECK(r.remember("/parts/a.fpart"));
    CHECK_EQ_INT(r.size(), 2);
    CHECK_EQ_STR(r.mostRecent(), std::string("/parts/a.fpart"));

    CHECK(r.contains("/parts/b.fpart"));
    CHECK(!r.contains("/parts/nope.fpart"));
    CHECK(r.forget("/parts/b.fpart"));
    CHECK(!r.forget("/parts/b.fpart"));  // gone, and says so
    CHECK_EQ_INT(r.size(), 1);
  }

  // The refusals, each with its positive half so the check cannot pass by
  // refusing everything.
  {
    CHECK(RecentDocuments::isStorable("/parts/ok.fpart"));
    CHECK(!RecentDocuments::isStorable(""));
    // A POSIX path MAY contain a newline. The session file is line-oriented, so
    // storing one would emit a `recent` record whose tail parses as a further
    // record — this is the corruption the refusal exists to prevent.
    CHECK(!RecentDocuments::isStorable("/parts/two\nlines.fpart"));
    CHECK(!RecentDocuments::isStorable("/parts/carriage\rreturn.fpart"));

    RecentDocuments r;
    CHECK(!r.remember(""));
    CHECK(!r.remember("/parts/two\nlines.fpart"));
    CHECK_EQ_INT(r.size(), 0);  // a refused path changed NOTHING
  }

  // The cap evicts the OLDEST, and only the oldest.
  {
    RecentDocuments r(3);
    CHECK(r.remember("/1"));
    CHECK(r.remember("/2"));
    CHECK(r.remember("/3"));
    CHECK(r.remember("/4"));
    CHECK_EQ_INT(r.size(), 3);
    CHECK_EQ_STR(r.paths()[0], std::string("/4"));
    CHECK_EQ_STR(r.paths()[2], std::string("/2"));
    CHECK(!r.contains("/1"));
  }

  // restore() keeps ORDER — the reason it exists rather than replaying
  // remember(), which pushes to the front and would invert the file.
  {
    // The lists are named rather than braced inline: a braced initialiser inside
    // a macro argument is split on its commas by the preprocessor.
    const std::vector<std::string> three = {"/a", "/b", "/c"};
    RecentDocuments r(2);
    CHECK_EQ_INT(r.restore(three), 2);  // truncated to capacity
    CHECK_EQ_STR(r.paths()[0], std::string("/a"));
    CHECK_EQ_STR(r.paths()[1], std::string("/b"));
    // Duplicates and unstorable entries are dropped, not counted as kept.
    const std::vector<std::string> messy = {"/a", "/a", "", "/b"};
    RecentDocuments s;
    CHECK_EQ_INT(s.restore(messy), 2);
    CHECK_EQ_STR(s.paths()[0], std::string("/a"));
    CHECK_EQ_STR(s.paths()[1], std::string("/b"));
  }

  // labels(): the leaf where it is unique, the WHOLE PATH where it is not. Two
  // identical menu rows cannot tell a user which file they are about to open.
  {
    RecentDocuments r;
    r.restore({"/a/bracket.fpart", "/b/bracket.fpart", "/c/plate.fpart", "/d/"});
    const std::vector<std::string> l = r.labels();
    CHECK_EQ_INT(l.size(), 4);
    CHECK_EQ_STR(l[0], std::string("/a/bracket.fpart"));
    CHECK_EQ_STR(l[1], std::string("/b/bracket.fpart"));
    CHECK_EQ_STR(l[2], std::string("plate.fpart"));
    CHECK_EQ_STR(l[3], std::string("/d/"));  // empty leaf falls back to the path
    CHECK_EQ_STR(RecentDocuments::leafName("/a/b/c.fpart"), std::string("c.fpart"));
    CHECK_EQ_STR(RecentDocuments::leafName("bare.fpart"), std::string("bare.fpart"));
  }

  // ═══ 2 — THE HANDLERS WRITE IT, through the one dispatch ═════════════════
  {
    ForgeShell shell;
    FakeHost host;
    host.openable = {"/parts/bracket.fpart", "/parts/plate.fpart"};
    shell.setDocumentHost(&host);
    CHECK_EQ_INT(shell.recentDocuments().size(), 0);

    CHECK(shell.run("file.open", withPath("/parts/bracket.fpart")).ok());
    CHECK_EQ_STR(shell.lastDocumentError(), std::string());
    CHECK_EQ_INT(shell.recentDocuments().size(), 1);
    CHECK_EQ_STR(shell.recentDocuments().mostRecent(), std::string("/parts/bracket.fpart"));

    // A REFUSED open leaves the list alone. Offering a path that does not open
    // back to the user, for ever, is worse than not offering it at all.
    shell.run("file.open", withPath("/parts/ghost.fpart"));
    CHECK(!shell.lastDocumentError().empty());
    CHECK_EQ_INT(host.refusedOpens, 1);
    CHECK_EQ_INT(shell.recentDocuments().size(), 1);
    CHECK(!shell.recentDocuments().contains("/parts/ghost.fpart"));

    CHECK(shell.run("file.open", withPath("/parts/plate.fpart")).ok());
    CHECK_EQ_INT(shell.recentDocuments().size(), 2);
    CHECK_EQ_STR(shell.recentDocuments().mostRecent(), std::string("/parts/plate.fpart"));

    // A bare Ctrl+S — no path — remembers WHERE THE HOST PUT IT, not the empty
    // string it was handed. This is the case where a user saves successfully and
    // could otherwise never find the file again.
    FakeHost fresh;
    ForgeShell s2;
    s2.setDocumentHost(&fresh);
    CHECK(s2.run("file.save").ok());
    CHECK_EQ_INT(fresh.saves, 1);
    CHECK_EQ_INT(s2.recentDocuments().size(), 1);
    CHECK_EQ_STR(s2.recentDocuments().mostRecent(), fresh.defaultSaveTarget);
  }

  // ═══ 3 — IT SURVIVES A RELAUNCH ══════════════════════════════════════════
  {
    ForgeShell shell;
    FakeHost host;
    host.openable = {"/parts/one.fpart", "/parts/two.fpart", "/parts/three.fpart"};
    shell.setDocumentHost(&host);
    shell.run("file.open", withPath("/parts/one.fpart"));
    shell.run("file.open", withPath("/parts/two.fpart"));
    shell.run("file.open", withPath("/parts/three.fpart"));
    CHECK_EQ_INT(shell.recentDocuments().size(), 3);

    const std::string state = shell.saveState();
    ForgeShell restored;
    const ForgeShell::StateLoadReport rep = restored.loadStateReport(state);
    CHECK(rep.ok);
    CHECK_EQ_INT(rep.unknownRecords, 0);  // `recent` is a KNOWN record now
    CHECK_EQ_INT(restored.recentDocuments().size(), 3);
    // ORDER PRESERVED. Replaying the file through remember() would put
    // "/parts/one.fpart" on top — the oldest part offered as the newest.
    CHECK_EQ_STR(restored.recentDocuments().paths()[0], std::string("/parts/three.fpart"));
    CHECK_EQ_STR(restored.recentDocuments().paths()[1], std::string("/parts/two.fpart"));
    CHECK_EQ_STR(restored.recentDocuments().paths()[2], std::string("/parts/one.fpart"));
    // Byte-identical the second time round, which is what makes the file stable
    // rather than merely parseable.
    CHECK_EQ_STR(restored.saveState(), state);

    // A session file from BEFORE this record existed still loads, and simply has
    // no recents. Refusing it would cost the user their layouts and keymap to
    // protect them from a line that is not there.
    std::string older;
    {
      std::string out;
      std::size_t at = 0;
      while (at < state.size()) {
        const std::size_t nl = state.find('\n', at);
        const std::size_t end = nl == std::string::npos ? state.size() : nl;
        const std::string line = state.substr(at, end - at);
        if (line.rfind("recent ", 0) != 0) {
          out += line;
          out += '\n';
        }
        at = end + 1;
      }
      older = out;
    }
    CHECK(older.size() < state.size());  // the stripper really removed something
    ForgeShell old;
    const ForgeShell::StateLoadReport oldRep = old.loadStateReport(older);
    CHECK(oldRep.ok);
    CHECK_EQ_INT(oldRep.unknownRecords, 0);
    CHECK_EQ_INT(old.recentDocuments().size(), 0);

    // And a load REPLACES: a shell that already had recents and reads a file
    // without them must not keep its own, the same rule the layouts follow.
    ForgeShell carried;
    carried.recentDocuments().remember("/parts/stale.fpart");
    CHECK_EQ_INT(carried.recentDocuments().size(), 1);
    CHECK(carried.loadState(older));
    CHECK_EQ_INT(carried.recentDocuments().size(), 0);

    // A failed load moves NOTHING, recents included.
    ForgeShell guard;
    guard.recentDocuments().remember("/parts/keep.fpart");
    const std::string before = guard.saveState();
    CHECK(!guard.loadState("forge-shell 1\nworkspace not_a_workspace\n"));
    CHECK_EQ_STR(guard.saveState(), before);
    CHECK_EQ_INT(guard.recentDocuments().size(), 1);
  }

  return H.finish();
}
