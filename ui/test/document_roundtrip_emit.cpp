// ui/test/document_roundtrip_emit.cpp
//
// The forge::ui half of ui/test/run_document_roundtrip_gate.sh: it builds the
// 71-statement fixture document, SAVES it, LOADS it back, and writes out the
// feature-IR programs so the KERNEL can measure the solids and say whether the
// round trip changed the geometry.
//
// It is a separate translation unit and not a `*_test.cpp` on purpose. run_ui.sh
// globs `ui/test/*_test.cpp` and runs each one with no arguments in a suite that
// must stay dependency-free; this one exists to be driven by a shell script that
// has a kernel binary, and it writes files. Mixing the two would make the cheap
// headless suite depend on a build of OCCT.
//
// It writes, into the directory given as argv[1]:
//
//   full.ir      the document as written, all 71 statements -- the POSITIVE
//                CONTROL. The gate requires this to MEASURE DIFFERENTLY from
//                active_before.ir, because "before == after" is only evidence
//                when the instrument can tell two programs apart at all.
//   before.ir    activeIrProgram() of the document IN MEMORY, with the rollback
//                bar and the suppression applied -- what the app would send the
//                kernel today.
//   after.ir     activeIrProgram() of the document RECONSTRUCTED from the bytes
//                that were written to disk. If saving lost a suppression flag, a
//                rollback bar, an argument, a value kind or a reference, this is
//                where it shows up as a different solid.
//   after2.ir    the same, after a SECOND save and load, because a format that
//                is stable once and drifts on the second cycle is a format that
//                drifts.
//   doc.fpart    the bytes themselves, so a failure can be read by a human.
//   status.txt   what happened in this process, so the shell script never has to
//                infer success from a file existing.
//
// A second mode, `--reload <in.fpart> <out.ir>`, loads a .fpart from disk and
// writes the program it would build. That is what makes this gate MUTATION-
// PROVABLE: the script corrupts one field of the saved document -- the
// SUPPRESSED flag, the ROLLBACK bar, one ARG, one NODE, one KIND -- reloads it
// through this mode, and requires the observable vector to MOVE. A round-trip
// gate that cannot show its instrument noticing a lost field is a gate that
// would stay green if the reader stopped reading that field altogether.
//
// Exit codes: 0 all four programs written; 1 the fixture did not build; 2 a save
// or a load failed (with the reason in status.txt); 3 bad arguments.
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>

#include "forge/ui/PartCommands.hpp"
#include "forge/ui/PartDocumentFile.hpp"
#include "part_document_fixture.hpp"

namespace {

bool writeText(const std::string& path, const std::string& text) {
  std::ofstream out(path, std::ios::trunc | std::ios::binary);
  if (!out) return false;
  out.write(text.data(), static_cast<std::streamsize>(text.size()));
  out.flush();
  return static_cast<bool>(out);
}

}  // namespace

int main(int argc, char** argv) {
  // ── mode 2: reload a .fpart and say what it would build ───────────────────
  // A LOAD FAILURE IS NOT AN ERROR HERE. The caller is deliberately handing this
  // corrupted documents, and "the reader refused it" is one of the ways a
  // mutation can be caught -- it is reported as an empty program plus a reason,
  // and the caller decides whether that counts.
  if (argc == 4 && std::string(argv[1]) == "--reload") {
    forge::ui::PartFileDoc file;
    std::string err;
    if (!forge::ui::loadPartFile(argv[2], file, err)) {
      std::fprintf(stderr, "[reload] refused: %s\n", err.c_str());
      writeText(argv[3], std::string());
      return 0;
    }
    forge::ui::PartDocument doc;
    if (!forge::ui::restorePartDocument(file, doc, err)) {
      std::fprintf(stderr, "[reload] restore refused: %s\n", err.c_str());
      writeText(argv[3], doc.activeIrProgram());
      return 0;
    }
    if (!writeText(argv[3], doc.activeIrProgram())) return 2;
    return 0;
  }

  if (argc != 2) {
    std::fprintf(stderr,
                 "usage: document_roundtrip_emit <out-dir>\n"
                 "       document_roundtrip_emit --reload <in.fpart> <out.ir>\n");
    return 3;
  }
  const std::string dir = argv[1];
  const auto path = [&dir](const char* name) { return dir + "/" + name; };
  std::string status;

  // The geometry variant: suppression and a rollback bar, but NOT the verifier
  // message. A kernel message puts %7 in Error and blocks the whole chain below
  // it -- correct for a document, and it would leave this gate measuring an
  // empty program.
  forge::ui::PartDocument doc;
  const forge::uitest::FixtureOptions opt{/*suppression=*/true, /*rollback=*/true,
                                          /*verifierMessage=*/false};
  if (!forge::uitest::buildFixture(doc, opt)) {
    std::fprintf(stderr, "fixture did not build to %d legal statements\n",
                 forge::uitest::kFixtureStatements);
    return 1;
  }

  const std::string full = doc.irProgram();
  const std::string before = doc.activeIrProgram();

  // SAVE -- through the same writer the application's Save uses.
  const forge::ui::PartFileDoc saved = forge::ui::capturePartDocument(doc, "");
  std::string err;
  if (!forge::ui::savePartFile(path("doc.fpart"), saved, err)) {
    writeText(path("status.txt"), "save failed: " + err + "\n");
    std::fprintf(stderr, "save failed: %s\n", err.c_str());
    return 2;
  }

  // LOAD -- from the BYTES ON DISK, not from the PartFileDoc still in memory.
  // Re-using the in-memory object would skip the writer and the reader, which
  // are the two halves this gate exists to test.
  forge::ui::PartFileDoc reloaded;
  if (!forge::ui::loadPartFile(path("doc.fpart"), reloaded, err)) {
    writeText(path("status.txt"), "load failed: " + err + "\n");
    std::fprintf(stderr, "load failed: %s\n", err.c_str());
    return 2;
  }
  forge::ui::PartDocument back;
  if (!forge::ui::restorePartDocument(reloaded, back, err)) {
    writeText(path("status.txt"), "restore failed: " + err + "\n");
    std::fprintf(stderr, "restore failed: %s\n", err.c_str());
    return 2;
  }
  const std::string after = back.activeIrProgram();

  // A SECOND cycle.
  const forge::ui::PartFileDoc saved2 = forge::ui::capturePartDocument(back, "");
  if (!forge::ui::savePartFile(path("doc2.fpart"), saved2, err)) {
    writeText(path("status.txt"), "second save failed: " + err + "\n");
    return 2;
  }
  forge::ui::PartFileDoc reloaded2;
  if (!forge::ui::loadPartFile(path("doc2.fpart"), reloaded2, err)) {
    writeText(path("status.txt"), "second load failed: " + err + "\n");
    return 2;
  }
  forge::ui::PartDocument back2;
  if (!forge::ui::restorePartDocument(reloaded2, back2, err)) {
    writeText(path("status.txt"), "second restore failed: " + err + "\n");
    return 2;
  }
  const std::string after2 = back2.activeIrProgram();

  if (!writeText(path("full.ir"), full) || !writeText(path("before.ir"), before) ||
      !writeText(path("after.ir"), after) || !writeText(path("after2.ir"), after2)) {
    writeText(path("status.txt"), "could not write the IR files\n");
    return 2;
  }

  // The TEXT comparison is reported, not asserted: this program's job is to
  // produce the programs. Whether they agree -- as text AND as geometry -- is
  // the shell script's verdict, and a gate whose two halves both decide is a
  // gate with two places to be wrong.
  status += "statements " + std::to_string(doc.records().size()) + "\n";
  status += "full_lines " + std::to_string(std::count(full.begin(), full.end(), '\n')) + "\n";
  status += "before_lines " + std::to_string(std::count(before.begin(), before.end(), '\n')) +
            "\n";
  status += "after_lines " + std::to_string(std::count(after.begin(), after.end(), '\n')) + "\n";
  status += std::string("text_before_eq_after ") + (before == after ? "yes" : "no") + "\n";
  status += std::string("text_after_eq_after2 ") + (after == after2 ? "yes" : "no") + "\n";
  status += std::string("text_full_eq_before ") + (full == before ? "yes" : "no") + "\n";
  status += "ok\n";
  if (!writeText(path("status.txt"), status)) return 2;
  std::printf("[emit] %s", status.c_str());
  return 0;
}
