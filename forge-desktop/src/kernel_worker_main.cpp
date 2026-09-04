// forge-desktop/src/kernel_worker_main.cpp — `forge_kernel_worker`.
//
// THE PROCESS THE APPLICATION IS ALLOWED TO LOSE.
//
// It reads one feature-IR program on stdin, compiles and tessellates it, and
// writes the viewport's vertex stream back on stdout. If OCCT dereferences a
// null Geom2d_Curve halfway through — the defect measured in
// forge-kernel/reports/OCCT_NULL_PCURVE_SEGV.md, reached on three paths, on
// Archie's output AND on the gold reference parts — THIS process dies and the
// application does not. The user's document, their unsaved edits, their layout
// and every other panel survive, and the last good body stays on screen.
//
// ── the protocol, in three streams ──────────────────────────────────────────
//   stdin   the IR program text, terminated by EOF.
//   stderr  a progress trail. Before each op is built, one line
//             FORGE-OP <id> <NAME>
//           written and FLUSHED. This is the only thing that survives a signal,
//           and it is what lets the parent say "%7 = SHELL" instead of nothing.
//           Anything else on stderr is a human-readable note.
//   stdout  the answer: a text header of `key value` lines, a blank line, then
//           `VERTICES <n>` and n fixed-size binary records. Binary because a
//           430-face part is ~1e6 vertices and text would cost more than the
//           geometry; fixed-size because the reader is one memcpy per record and
//           a length-prefixed frame cannot desynchronise.
//
// Exit 0 means the header is complete and trustworthy — INCLUDING a header that
// reports a modelling failure, which is a RESULT, not a crash. A non-zero exit
// means the worker could not answer at all.
//
// ── the self-test pragmas, and why they are not a back door ────────────────
// A first line of `#!forge-worker-selftest <mode>` makes the worker crash, hang
// or exit non-zero ON PURPOSE. They exist because the isolation gate has to
// prove the isolation with a REAL signal — a mock that returns "crashed" tests
// the mock — and because there is no other way to make OCCT segfault on demand.
// They are inert on any program that does not begin with that exact line, they
// are the FIRST thing the file says rather than something hidden inside it, and
// no path in forge::ui can emit one: `#` is not a token the IR grammar produces.
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include <unistd.h>

#include "KernelScene.hpp"
#include "forge/ft/FeatureTree.hpp"
#include "forge/ui/KernelSession.hpp"

namespace {

void announce(int opId, const char* opName, int /*srcLine*/, void* /*user*/) {
  std::fprintf(stderr, "%s%d %s\n", forge::ui::kOpProgressPrefix, opId,
               opName != nullptr ? opName : "?");
  std::fflush(stderr);
}

std::string readAllStdin() {
  std::string all;
  char buf[65536];
  for (;;) {
    const ssize_t n = ::read(STDIN_FILENO, buf, sizeof(buf));
    if (n > 0) {
      all.append(buf, static_cast<std::size_t>(n));
      continue;
    }
    if (n < 0 && errno == EINTR) continue;
    break;
  }
  return all;
}

// The selftest pragma, read from the FIRST line only.
std::string selftestMode(const std::string& program) {
  static const char* kPragma = "#!forge-worker-selftest ";
  if (program.rfind(kPragma, 0) != 0) return std::string();
  const std::size_t begin = std::strlen(kPragma);
  std::size_t end = program.find('\n', begin);
  if (end == std::string::npos) end = program.size();
  std::string mode = program.substr(begin, end - begin);
  while (!mode.empty() && (mode.back() == '\r' || mode.back() == ' ')) mode.pop_back();
  return mode;
}

void emitHeader(const forge::desktop::IrBuildReport& r, const std::string& backend) {
  std::printf("%s\n", forge::desktop::kWorkerResultMagic);
  std::printf("parsed %d\n", r.parsed ? 1 : 0);
  std::printf("compiled %d\n", r.compiled ? 1 : 0);
  std::printf("tessellated %d\n", r.tessellated ? 1 : 0);
  std::printf("valid %d\n", r.valid ? 1 : 0);
  std::printf("failedOpId %d\n", r.failedOpId);
  std::printf("failedLine %d\n", r.failedLine);
  std::printf("faceCount %ld\n", r.faceCount);
  std::printf("edgeCount %ld\n", r.edgeCount);
  std::printf("volume %.17g\n", r.volume);
  std::printf("bboxMin %.17g %.17g %.17g\n", r.bboxMin[0], r.bboxMin[1], r.bboxMin[2]);
  std::printf("bboxMax %.17g %.17g %.17g\n", r.bboxMax[0], r.bboxMax[1], r.bboxMax[2]);
  std::printf("nDeclared %zu\n", r.nDeclared);
  std::printf("nParsed %zu\n", r.nParsed);
  std::printf("nCompiled %zu\n", r.nCompiled);
  std::printf("triangles %zu\n", r.triangles);
  // ── the body inventory's scalars ────────────────────────────────────────
  // Sent because the PARENT is where the assembly panels are drawn and the
  // CHILD is where the B-rep exists. Without these three lines a user running
  // the shipped application -- which always runs the kernel out of process --
  // would see an empty parts list for a model that plainly has parts, and the
  // panels would be honest about nothing at all.
  std::printf("bodiesAnalysed %d\n", r.bodiesAnalysed ? 1 : 0);
  std::printf("pairsEvaluated %zu\n", r.pairsEvaluated);
  std::printf("pairsTruncated %d\n", r.pairsTruncated ? 1 : 0);
  // The error is LAST and length-prefixed, so a newline inside it cannot be read
  // as the start of another field.
  std::printf("errorBytes %zu\n", r.error.size());
  std::fwrite(r.error.data(), 1, r.error.size(), stdout);
  std::printf("\nbackend %s\n", backend.c_str());

  // ── the body inventory's tables ─────────────────────────────────────────
  // Each block is COUNT-PREFIXED and fixed-shape, for the same reason the
  // vertex stream is: a reader that knows how many records to expect cannot
  // desynchronise, and a truncated block is a diagnosis rather than a
  // half-filled panel. %.17g round-trips a double exactly, so a volume the
  // parent prints is the volume the kernel measured and not a re-rounding
  // of it.
  std::printf("bodies %zu\n", r.bodies.size());
  for (const forge::desktop::SceneBody& b : r.bodies) {
    std::printf("body %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %u\n",
                b.volume, b.area, b.centroid[0], b.centroid[1], b.centroid[2], b.bboxMin[0],
                b.bboxMin[1], b.bboxMin[2], b.bboxMax[0], b.bboxMax[1], b.bboxMax[2],
                b.faceCount);
  }
  std::printf("bodyPairs %zu\n", r.bodyPairs.size());
  for (const forge::desktop::SceneBodyPair& q : r.bodyPairs) {
    std::printf("bodyPair %u %u %.17g %.17g\n", q.a, q.b, q.gap, q.overlapVolume);
  }
  std::printf("alignments %zu\n", r.alignments.size());
  for (const forge::desktop::SceneBodyAlignment& a : r.alignments) {
    std::printf("alignment %d %u %u %u %u %.17g %.17g %.17g %.17g %.17g %.17g %.17g\n",
                static_cast<int>(a.kind), a.a, a.b, a.faceA, a.faceB, a.deviation, a.point[0],
                a.point[1], a.point[2], a.direction[0], a.direction[1], a.direction[2]);
  }
  // One line of counts, index 0 first. A face carries the body it belongs to and
  // nothing else, so the whole map is small enough to send whole -- which is
  // what keeps "which body is this triangle" a lookup rather than a second
  // derivation that could disagree with the child's.
  std::printf("faceBodies %zu\n", r.bodyOfFace.size());
  if (!r.bodyOfFace.empty()) {
    for (std::size_t i = 0; i < r.bodyOfFace.size(); ++i) {
      std::printf("%s%u", i == 0 ? "" : " ", r.bodyOfFace[i]);
    }
    std::printf("\n");
  }
}

}  // namespace

int main(int argc, char** argv) {
  bool wantVersion = false;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--version") == 0) wantVersion = true;
  }
  if (wantVersion) {
    // A liveness probe the application can run once at startup: if this does not
    // answer, the app knows it has no isolation and says so, rather than
    // discovering it on the first rebuild.
    std::printf("%s\n", forge::desktop::kWorkerResultMagic);
    return 0;
  }

  std::string program = readAllStdin();

  // ── the input-file pragma ────────────────────────────────────────────────
  // The parent prepends `#!forge-worker-input <path>` when the document's
  // `INPUT()` binds a file (KernelScene::buildIsolated). Read it off the FIRST
  // LINE and strip it, so the scene compiles the same program the parent would
  // have compiled in process. `#` starts a comment in the IR grammar, so leaving
  // the line in would still parse -- but the path would be lost and INPUT()
  // would fail here and nowhere else, which is the divergence this exists to
  // prevent.
  std::string workerInputFile;
  {
    const std::string pragma = forge::desktop::kWorkerInputPragma;
    if (program.rfind(pragma, 0) == 0) {
      std::size_t end = program.find('\n', pragma.size());
      if (end == std::string::npos) end = program.size();
      workerInputFile = program.substr(pragma.size(), end - pragma.size());
      program = end < program.size() ? program.substr(end + 1) : std::string();
    }
  }

  const std::string mode = selftestMode(program);
  if (!mode.empty()) {
    std::fprintf(stderr, "[worker] SELFTEST mode '%s'\n", mode.c_str());
    std::fflush(stderr);
    if (mode == "crash") {
      // The trail first, so the parent can prove it names the statement.
      announce(5, "CUT", 0, nullptr);
      announce(7, "SHELL", 0, nullptr);
      volatile int* p = nullptr;
      *p = 1;
      return 0;  // unreachable
    }
    if (mode == "hang") {
      announce(4, "LOFT", 0, nullptr);
      for (;;) ::usleep(50000);
    }
    if (mode == "refuse") {
      std::fprintf(stderr, "[worker] selftest refusal\n");
      return 4;
    }
    std::fprintf(stderr, "[worker] unknown selftest mode '%s'\n", mode.c_str());
    return 5;
  }

  // ── the real work ─────────────────────────────────────────────────────────
  forge::ft::setCompileProgressHook(&announce, nullptr);
  forge::desktop::KernelScene scene;
  if (!workerInputFile.empty()) scene.setInputFile(workerInputFile);
  const bool ok = scene.buildFromIr(program);
  forge::ft::setCompileProgressHook(nullptr, nullptr);

  emitHeader(scene.lastBuild(), scene.backend());

  const std::vector<forge::desktop::SceneVertex>& verts = scene.vertices();
  std::printf("VERTICES %zu\n", ok ? verts.size() : static_cast<std::size_t>(0));
  if (ok && !verts.empty()) {
    std::fwrite(verts.data(), sizeof(forge::desktop::SceneVertex), verts.size(), stdout);
  }
  std::fflush(stdout);
  // A modelling failure is a RESULT, not a crash: the header says what went
  // wrong and names the op. Exiting non-zero here would make the supervisor
  // report "the worker failed" and throw away a perfectly good diagnosis.
  return 0;
}
