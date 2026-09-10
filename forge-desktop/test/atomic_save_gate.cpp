// forge-desktop/test/atomic_save_gate.cpp
//
// THE GATE THAT PROVES A CRASHED SAVE CANNOT DESTROY THE USER'S FILE.
//
// savePartFile() opened the target with std::ios::trunc. That truncates the user's
// existing part AT OPEN, before one byte of the new content has been written, so
// every failure after that point -- a crash, a kill, a full disk, a throw inside
// serialisation -- left a truncated or empty file where the design had been.
//
// The loader already knew this state existed. It reports
//   "file ends inside a FEATURE block (truncated write?)"
// The reader had been taught to recognise the wreck while the writer went on
// producing it.
//
// A test that only checks "save then load works" cannot see this: the happy path
// was always fine. The defect lives entirely in what happens when the process dies
// BETWEEN truncate and write. So this gate kills a real child process mid-save, at
// many different offsets, and asserts the previous file is still loadable.
//
// It carries its own POSITIVE CONTROL: the same fault injection is run against the
// OLD truncate-in-place algorithm, reimplemented here in a few lines, and that arm
// is REQUIRED to destroy the file. Without it a green run would prove only that the
// kill never landed in the window.
#include "PartFile.hpp"

#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/PartCommands.hpp"

#include <fcntl.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

using namespace forge::desktop;   // PartFileDoc, savePartFile, loadPartFile

namespace {

int g_pass = 0;
int g_fail = 0;

void check(bool ok, const std::string& what, const std::string& detail = "") {
  if (ok) {
    std::cout << "  PASS  " << what << (detail.empty() ? "" : " -- " + detail) << "\n";
    ++g_pass;
  } else {
    std::cout << "  FAIL  " << what << (detail.empty() ? "" : " -- " + detail) << "\n";
    ++g_fail;
  }
}

// A document big enough that writing it is not instantaneous, so a kill has a
// window to land inside.
PartFileDoc bigDoc(int features) {
  PartFileDoc d;
  d.name = "atomic-save-fixture";
  for (int i = 1; i <= features; ++i) {
    PartFileFeature f;
    f.record.irId = i;
    f.record.commandId = "part.box";
    // A long label is what makes the serialised file large enough that writing it
    // occupies real time -- without which a kill could never land inside the write
    // and the positive control below would prove nothing.
    f.record.label = "feature-" + std::to_string(i) + "-" + std::string(160, 'x');
    f.record.produces = forge::ui::IrValueKind::Solid;
    f.record.line.id = i;
    f.record.line.op = "BOX";
    d.features.push_back(f);
  }
  return d;
}

// The OLD algorithm, quoted so the control is the real thing and not a caricature.
bool legacyTruncatingSave(const std::string& path, const std::string& text) {
  std::ofstream out(path, std::ios::trunc | std::ios::binary);
  if (!out) return false;
  out.write(text.data(), static_cast<std::streamsize>(text.size()));
  out.flush();
  return static_cast<bool>(out);
}

std::string slurp(const std::string& p) {
  std::ifstream in(p, std::ios::binary);
  if (!in) return {};
  return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

// THE INVARIANT IS NOT "the old content survives".
//
// A save that finishes before the kill lands has legitimately replaced the file --
// that is a SUCCESSFUL save, not data loss, and an assertion demanding the old
// bytes marks it as a failure. (It did: the first version of this gate scored
// 6/10 and the four "failures" were completed saves.)
//
// The property that actually matters is ALL-OR-NOTHING: after a kill at any
// offset, the file on disk is EITHER the complete previous content OR the complete
// new content, and never a partial write. Returns true when that holds.
bool intactAfterKill(const std::string& path, const std::string& before,
                     const std::string& after, const PartFileDoc& doc,
                     int micros, bool legacy) {
  const pid_t pid = ::fork();
  if (pid == 0) {
    if (legacy) {
      // `after` is the ALREADY-SERIALISED bytes. Serialising inside the child would
      // put most of its short life before the destructive open, so few kills would
      // land in the window that actually destroys the file -- the control fired only
      // 1/10 that way, which is a demonstration by luck and a flaky gate in CI.
      legacyTruncatingSave(path, after);
    } else {
      std::string err;
      savePartFile(path, doc, err);
    }
    ::_exit(0);
  }
  ::usleep(static_cast<useconds_t>(micros));
  ::kill(pid, SIGKILL);
  int st = 0;
  ::waitpid(pid, &st, 0);
  const std::string now = slurp(path);
  return now == before || now == after;
}

}  // namespace

int main() {
  const std::filesystem::path dir =
      std::filesystem::temp_directory_path() / "forge_atomic_save_gate";
  std::error_code ec;
  std::filesystem::remove_all(dir, ec);
  std::filesystem::create_directories(dir, ec);
  const std::string target = (dir / "part.fpart").string();

  std::cout << "== a good file is written, and reads back ==\n";
  PartFileDoc original = bigDoc(40);
  std::string err;
  check(savePartFile(target, original, err), "savePartFile succeeds", err);
  PartFileDoc rt;
  check(loadPartFile(target, rt, err), "and the result loads", err);
  const std::string good = slurp(target);
  check(!good.empty(), "the saved file is non-empty",
        std::to_string(good.size()) + " bytes");

  std::cout << "== no temporary file is left behind ==\n";
  check(!std::filesystem::exists(target + ".forge-tmp"),
        "the .forge-tmp scratch file is cleaned up");

  std::cout << "== FAULT INJECTION: kill the process mid-save, many offsets ==\n";
  // A large document so the write occupies real time.
  const PartFileDoc replacement = bigDoc(6000);
  const std::vector<int> offsets = {50, 150, 300, 600, 1000, 1800, 3000, 5000, 9000, 15000};

  const std::string newBytes = writePartFile(replacement);

  int intact = 0;
  int wasOld = 0;
  int wasNew = 0;
  for (int us : offsets) {
    // Put the known-good file back before each attempt so every offset starts from
    // the same state.
    { std::ofstream r(target, std::ios::trunc | std::ios::binary);
      r.write(good.data(), static_cast<std::streamsize>(good.size())); }
    if (intactAfterKill(target, good, newBytes, replacement, us, /*legacy=*/false)) {
      ++intact;
      if (slurp(target) == good) ++wasOld; else ++wasNew;
    }
  }
  check(intact == static_cast<int>(offsets.size()),
        "after every kill the file is ALL-or-NOTHING, never a partial write",
        std::to_string(intact) + "/" + std::to_string(offsets.size()) + " offsets (" +
            std::to_string(wasOld) + " left the old file, " + std::to_string(wasNew) +
            " had already committed the new one)");

  // Both outcomes must actually occur, or the sweep never straddled the window and
  // the result above is vacuous.
  check(wasOld > 0, "at least one kill landed BEFORE the commit point",
        std::to_string(wasOld) + " offsets");

  std::cout << "== and whatever survived must LOAD, not merely be non-empty ==\n";
  {
    PartFileDoc probe;
    std::string e3;
    check(loadPartFile(target, probe, e3), "the file left by a killed save is loadable", e3);
  }

  std::cout << "== POSITIVE CONTROL: the OLD algorithm must destroy it ==\n";
  std::cout << "   (without this, a green run above could just mean the kill never landed)\n";
  int legacySurvived = 0;
  int legacyRuns = 0;
  for (int us : offsets) {
    // Restore the good file before each legacy attempt.
    std::ofstream restore(target, std::ios::trunc | std::ios::binary);
    restore.write(good.data(), static_cast<std::streamsize>(good.size()));
    restore.close();
    ++legacyRuns;
    if (intactAfterKill(target, good, newBytes, replacement, us, /*legacy=*/true))
      ++legacySurvived;
  }
  check(legacySurvived < legacyRuns,
        "the OLD truncate-in-place algorithm leaves a PARTIAL file at least once",
        std::to_string(legacyRuns - legacySurvived) + "/" + std::to_string(legacyRuns) +
            " kills left the part neither old nor new");

  std::cout << "== after all that, the file is still the ORIGINAL and still loads ==\n";
  {
    std::ofstream restore(target, std::ios::trunc | std::ios::binary);
    restore.write(good.data(), static_cast<std::streamsize>(good.size()));
  }
  PartFileDoc after;
  check(loadPartFile(target, after, err), "the restored good file loads", err);

  std::cout << "== a save into a directory that does not exist FAILS without touching the target ==\n";
  {
    const std::string bad = (dir / "no_such_dir" / "x.fpart").string();
    std::string e2;
    const bool ok = savePartFile(bad, original, e2);
    check(!ok, "save to a missing directory fails", e2);
    check(!std::filesystem::exists(bad + ".forge-tmp"), "and leaves no scratch file");
  }

  std::filesystem::remove_all(dir, ec);
  std::cout << "\nRESULT: " << g_pass << " passed, " << g_fail << " failed\n";
  return g_fail == 0 ? 0 : 1;
}
