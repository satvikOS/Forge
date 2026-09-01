// ui/test/document_store_test.cpp
//
// THE AUTOSAVE PATH THE APPLICATION ACTUALLY CALLS, AND THE FILESYSTEM IT
// ACTUALLY WRITES TO.
//
// document_round_trip_test.cpp drives `autosaveNow()` against `MemoryStorage`.
// That leaves two things unproved, and DocumentStore.hpp claims BOTH of them in
// its own header comment:
//
//   * `tick()` is what a frame calls. It is the half that decides WHETHER to
//     autosave — the time cadence and the edit-count trigger — and none of that
//     logic was executed by anything. autosaveNow() skips the whole decision.
//   * "FileSystemStorage is the real one, and the gate exercises it on a real
//     temporary directory too, since a seam proved only against its own fake
//     proves only the fake." There was no gate at all when that was written, so
//     the sentence described an intention. This is the gate.
//
// The edit trigger matters for a specific reason the header states: a burst of
// twenty features in ten seconds is exactly the work a time-only cadence loses.
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <string>
#include <system_error>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/DocumentModel.hpp"
#include "forge/ui/DocumentStore.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

EntityRef ref(const std::string& node, EntityKind kind, const std::string& name) {
  return EntityRef{node, kind, name, 1};
}

CommandParams num1(const std::string& n, double v) {
  CommandParams p;
  p.setNumber(n, v);
  return p;
}

// Emits one real feature through the real registry, so undoDepth() moves the way
// it does in the application. A test that incremented a counter by hand would be
// testing the counter.
void addFeature(CommandRegistry& registry, SelectionService& sel, double radius) {
  sel.replaceWith({ref("body_3", EntityKind::Edge, "e1")});
  registry.dispatch("part.fillet", sel, num1("radius", radius));
}

}  // namespace

int main() {
  Harness H("document_store");

  // ── the document under test ───────────────────────────────────────────────
  DocumentModel model;
  CommandRegistry registry;
  SelectionService sel;
  registerPartCommands(registry, model.tree(), model.undo());
  model.tree().seed(IrValueKind::Profile, "sketch_1", "RECT",
                    {IrArg::num(80), IrArg::num(60)});
  model.tree().seed(IrValueKind::Solid, "body_x", "BOX",
                    {IrArg::num(5), IrArg::num(5), IrArg::num(5)});
  sel.replaceWith({ref("sketch_1", EntityKind::Sketch, "s1")});
  CHECK(registry.dispatch("part.extrude", sel, num1("distance", 20)).ok());
  CHECK_EQ_INT(model.tree().valueFor("body_3"), 3);

  // ── 1. tick(): the TIME cadence ───────────────────────────────────────────
  {
    MemoryStorage storage;
    RecoveryService session(storage, "/session");
    AutosavePolicy policy;
    policy.intervalMillis = 30000;
    policy.everyNEdits = 20;
    session.setPolicy(policy);

    std::string err;
    CHECK(session.beginSession("t1", 0, err));

    // The FIRST tick writes: lastAutosaveMillis_ starts at 0, so any now >= the
    // interval is due. This is the baseline the rest is measured against.
    CHECK(session.tick(30000, model, "/parts/p.fpart", err));
    CHECK_EQ_INT(session.stats().autosavesWritten, 1);

    // NOT due: one millisecond short of the next interval. A cadence that fires
    // early is a cadence that is not a cadence.
    addFeature(registry, sel, 4);
    CHECK(!session.tick(59999, model, "/parts/p.fpart", err));
    CHECK_EQ_INT(session.stats().autosavesWritten, 1);

    // due, and the document HAS changed, so it writes
    CHECK(session.tick(60000, model, "/parts/p.fpart", err));
    CHECK_EQ_INT(session.stats().autosavesWritten, 2);

    // Due by TIME but the document is unchanged: skipped, and counted as a skip
    // rather than silently doing nothing. A timer that rewrites an unchanged
    // document spins a disk for nothing and hides real activity in its stats.
    CHECK(!session.tick(200000, model, "/parts/p.fpart", err));
    CHECK_EQ_INT(session.stats().autosavesWritten, 2);
    CHECK_EQ_INT(session.stats().autosavesSkipped, 1);

    // A DISABLED policy writes nothing at all, however overdue.
    AutosavePolicy off;
    off.enabled = false;
    session.setPolicy(off);
    addFeature(registry, sel, 5);
    CHECK(!session.tick(1000000, model, "/parts/p.fpart", err));
    CHECK_EQ_INT(session.stats().autosavesWritten, 2);
  }

  // ── 2. tick(): the EDIT trigger, which is the one that matters ────────────
  // "A burst of twenty features in ten seconds is exactly the work a time-only
  // cadence loses." So the edit trigger has to fire while the clock says no.
  {
    DocumentModel burst;
    CommandRegistry br;
    SelectionService bs;
    registerPartCommands(br, burst.tree(), burst.undo());
    burst.tree().seed(IrValueKind::Profile, "sketch_1", "RECT",
                      {IrArg::num(80), IrArg::num(60)});
    bs.replaceWith({ref("sketch_1", EntityKind::Sketch, "s1")});
    CHECK(br.dispatch("part.extrude", bs, num1("distance", 20)).ok());

    MemoryStorage storage;
    RecoveryService session(storage, "/session");
    AutosavePolicy policy;
    policy.intervalMillis = 30000;  // far away
    policy.everyNEdits = 5;
    session.setPolicy(policy);
    std::string err;
    CHECK(session.beginSession("t2", 0, err));
    // consume the free first-tick write so the clock is genuinely not due below
    CHECK(session.tick(30000, burst, "/parts/b.fpart", err));
    CHECK_EQ_INT(session.stats().autosavesWritten, 1);

    // four edits: under the threshold, and the clock says no
    for (int i = 0; i < 4; ++i) {
      bs.replaceWith({ref("body_2", EntityKind::Edge, "e1")});
      br.dispatch("part.fillet", bs, num1("radius", 1.0 + i));
      CHECK(!session.tick(30001 + static_cast<std::uint64_t>(i), burst, "/parts/b.fpart", err));
    }
    CHECK_EQ_INT(session.stats().autosavesWritten, 1);

    // the FIFTH edit crosses everyNEdits while the interval is still far off
    bs.replaceWith({ref("body_2", EntityKind::Edge, "e1")});
    br.dispatch("part.fillet", bs, num1("radius", 9));
    CHECK(session.tick(30005, burst, "/parts/b.fpart", err));
    CHECK_EQ_INT(session.stats().autosavesWritten, 2);
    std::printf("[document_store] the edit trigger fired at 5 edits with the 30 s clock "
                "%llu ms away -- the burst a time-only cadence loses\n",
                static_cast<unsigned long long>(29995));
  }

  // ── 3. the recovery marker round-trips ────────────────────────────────────
  // scan() reports what it chose to; this asserts on the EVIDENCE itself.
  {
    RecoveryCandidate c;
    c.sessionId = "pid-4711-1699999999";
    c.markerPath = "/session/pid-4711.forgesession";
    c.autosavePath = "/session/pid-4711.autosave.fpart";
    c.documentPath = "/parts/bracket rev C.fpart";
    c.documentName = "bracket rev C";
    c.startedAtMillis = 1699999999000ULL;
    c.savedAtMillis = 1700000029000ULL;
    c.hasAutosave = true;

    const std::string text = writeRecoveryMarker(c);
    CHECK_EQ_STR(text.substr(0, 16), "FORGE-RECOVERY 1");
    RecoveryCandidate back;
    std::string err;
    CHECK(parseRecoveryMarker(text, back, err));
    CHECK_EQ_STR(err, "");
    CHECK_EQ_STR(back.sessionId, c.sessionId);
    CHECK_EQ_STR(back.autosavePath, c.autosavePath);
    // a path with a SPACE in it survives -- documents have spaces in their names
    CHECK_EQ_STR(back.documentPath, c.documentPath);
    CHECK_EQ_STR(back.documentName, c.documentName);
    CHECK_EQ_INT(back.startedAtMillis, c.startedAtMillis);
    CHECK_EQ_INT(back.savedAtMillis, c.savedAtMillis);
    CHECK(back.hasAutosave);
    CHECK_EQ_STR(writeRecoveryMarker(back), text);  // idempotent

    // rubbish is refused, not silently accepted as an empty candidate
    RecoveryCandidate junk;
    std::string jerr;
    CHECK(!parseRecoveryMarker("hello\n", junk, jerr));
    CHECK(!jerr.empty());
  }

  // ── 4. THE REAL FILESYSTEM ────────────────────────────────────────────────
  // A seam proved only against its own fake proves only the fake.
  {
    std::error_code ec;
    const std::filesystem::path root =
        std::filesystem::temp_directory_path(ec) / "forge_document_store_gate";
    std::filesystem::remove_all(root, ec);  // a stale run must not seed this one
    const std::string dir = root.string();

    FileSystemStorage fs;
    const std::string file = dir + "/nested/deeper/part.fpart";

    // nothing there yet, and asking is not an error
    CHECK(!fs.exists(file));
    std::string readErr;
    std::string text;
    CHECK(!fs.read(file, text, readErr));
    CHECK(!readErr.empty());
    // a missing directory is an empty list, not a throw
    CHECK_EQ_INT(fs.list(dir + "/does-not-exist").size(), 0);

    // write creates intermediate directories
    std::string err;
    const std::string payload = model.serialize();
    CHECK(fs.write(file, payload, err));
    CHECK_EQ_STR(err, "");
    CHECK(fs.exists(file));

    // it is on disk BYTE FOR BYTE, read back through the seam...
    std::string readBack;
    CHECK(fs.read(file, readBack, err));
    CHECK_EQ_STR(readBack, payload);
    // ...and it is a real document, not just bytes that match
    DocumentModel reloaded;
    DocumentIoError io;
    CHECK(reloaded.load(readBack, io));
    CHECK_EQ_STR(io.describe(), "ok");
    CHECK_EQ_STR(reloaded.irProgram(), model.irProgram());

    // ATOMIC REPLACEMENT: the temporary must not survive the write. A leftover
    // `.forge-tmp` beside every document is the visible symptom of a rename that
    // did not happen, and it would also be offered by list().
    const std::vector<std::string> entries = fs.list(dir + "/nested/deeper");
    CHECK_EQ_INT(entries.size(), 1);
    CHECK(!std::filesystem::exists(std::filesystem::path(file + ".forge-tmp")));

    // overwrite with different content: the file is replaced, not appended to,
    // and not left half-written
    CHECK(model.setName("second revision"));
    const std::string second = model.serialize();
    CHECK(second != payload);
    CHECK(fs.write(file, second, err));
    std::string afterOverwrite;
    CHECK(fs.read(file, afterOverwrite, err));
    CHECK_EQ_STR(afterOverwrite, second);
    CHECK_EQ_INT(fs.list(dir + "/nested/deeper").size(), 1);

    // the plain save/open pair, against real files
    const std::string viaHelper = dir + "/helper.fpart";
    std::string saveErr;
    CHECK(saveDocumentFile(viaHelper, model.capture(), saveErr));
    CHECK_EQ_STR(saveErr, "");
    DocumentFileData opened;
    DocumentIoError openErr;
    CHECK(loadDocumentFile(viaHelper, opened, openErr));
    CHECK_EQ_STR(openErr.describe(), "ok");
    CHECK_EQ_STR(opened.name, "second revision");
    CHECK_EQ_STR(opened.irProgram(), model.irProgram());

    // remove
    CHECK(fs.remove(file, err));
    CHECK(!fs.exists(file));
    // Removing what is ALREADY GONE succeeds. std::filesystem::remove returns
    // false without setting an error_code for a path that does not exist, so
    // this reports true -- and that is the right contract rather than an
    // oversight: remove() means "make sure this is not there", and endSession()
    // depends on it, since a session that never wrote an autosave must still be
    // able to close cleanly. Asserted because the behaviour is surprising
    // enough that a reader would otherwise have to go and check.
    CHECK(fs.remove(file, err));
    CHECK_EQ_STR(err, "");

    // ── a WHOLE crash-and-recover cycle on real files ────────────────────
    RecoveryService crashed(fs, dir + "/session");
    std::string cerr;
    CHECK(crashed.beginSession("real-1", 1000, cerr));
    CHECK(fs.exists(crashed.markerPath()));
    CHECK(crashed.autosaveNow(2000, model, viaHelper, cerr));
    CHECK(fs.exists(crashed.autosavePath()));
    // ...and the process "dies": endSession is never called.

    RecoveryService next(fs, dir + "/session");
    std::string nerr;
    CHECK(next.beginSession("real-2", 3000, nerr));
    const std::vector<RecoveryCandidate> found = next.scan();
    CHECK_EQ_INT(found.size(), 1);
    if (!found.empty()) {
      CHECK_EQ_STR(found.front().sessionId, "real-1");
      CHECK(found.front().hasAutosave);
      DocumentModel recovered;
      DocumentIoError rerr;
      CHECK(next.recover(found.front(), recovered, rerr));
      CHECK_EQ_STR(rerr.describe(), "ok");
      CHECK_EQ_STR(recovered.name(), "second revision");
      CHECK_EQ_STR(recovered.irProgram(), model.irProgram());
      CHECK_EQ_STR(recovered.contentDigest(), model.contentDigest());
      std::printf("[document_store] recovered a real on-disk autosave after a simulated "
                  "crash: %zu statements, digest matched\n",
                  recovered.tree().records().size());
    }
    CHECK(next.endSession(nerr));
    CHECK(!fs.exists(next.markerPath()));

    // leave nothing behind: a gate that litters /tmp is a gate that will fail
    // differently on its second run
    std::filesystem::remove_all(root, ec);
    CHECK(!std::filesystem::exists(root));
  }

  return H.finish();
}
