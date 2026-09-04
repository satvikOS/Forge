// forge-desktop/test/isolation_gate.cpp — ★ THE APP SURVIVES A KERNEL SEGFAULT.
//
// ── what this gate is for ───────────────────────────────────────────────────
// forge-kernel/reports/OCCT_NULL_PCURVE_SEGV.md documents a null Geom2d_Curve
// dereferenced INSIDE OCCT, reached on three paths, crashing on Archie's emitted
// geometry AND on the gold reference STEP files. The report's own measured
// self-corrections close off every cheaper remedy:
//
//   * a pre-check on the INPUT cannot work — the crashing shape measured
//     nullPcurves=0, so the null is born inside OCCT's own merge;
//   * `KeepShapes` was implemented and measured, and all six cases still
//     SIGSEGV'd;
//   * the accessor a guard would call, BRep_Tool::CurveOnSurface, is itself one
//     of the faulting frames, so the guard would crash inside the guard.
//
// And a SIGSEGV is not an exception: KernelScene::buildInProcess catches
// std::exception AND (...), and neither clause exists for a signal.
//
// So the remedy is not a check at all — it is to run the operation somewhere the
// fault is recoverable. This gate proves that it IS recovered, against the REAL
// forge_kernel_worker binary, with a REAL fatal signal. Nothing here is mocked:
// a fake worker that returns "crashed" would test the fake.
//
// ── ★ what it also proves is NOT happening ──────────────────────────────────
// The owner's constraint is explicit: "dont gate anything if you do that then how
// will Archie generate ultra long feature trees for Kernel to execute". A
// mechanism that answered a crash by refusing to run that program again would be
// exactly the capability gate the OCCT report warns about — one that fires
// hardest on the longest, densest, most curved trees, i.e. on the ground truth
// (task_101 is 329 faces / 753 edges; archie_edit_214's input is 430 faces, 167
// of them cylinders and 67 B-splines). So this gate asserts the ABSENCE of a
// quarantine as forcefully as it asserts the presence of the isolation:
// re-submitting a program that has just crashed RUNS IT AGAIN.
//
// ── the observables ─────────────────────────────────────────────────────────
// Survival alone is a weak assertion — a scene that quietly rendered nothing
// would "survive" every case here. So each case checks a VECTOR: the process
// lives, the previous geometry is INTACT, the diagnostic NAMES the statement,
// and the session's counters moved by exactly one in the right column.
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <csignal>
#include <sys/stat.h>

#include "KernelScene.hpp"
#include "PartFile.hpp"
#include "forge/ui/GuardedProcess.hpp"
#include "forge/ui/KernelSession.hpp"

namespace {

int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

void check(bool cond, const char* what, const std::string& detail = std::string()) {
  ++g_checks;
  if (cond) return;
  ++g_failures;
  std::printf("  FAIL: %-62s %s\n", what, detail.c_str());
}

template <typename A, typename B>
void checkEq(const A& got, const B& want, const char* what) {
  ++g_checks;
  if (got == want) return;
  ++g_failures;
  std::printf("  FAIL: %-62s got %s want %s\n", what, std::to_string(got).c_str(),
              std::to_string(want).c_str());
}

bool fileExists(const std::string& p) {
  struct ::stat st {};
  return ::stat(p.c_str(), &st) == 0;
}

// The IR the app itself starts on, so the geometry assertions below are about the
// real default part rather than a fixture invented for the gate.
std::string defaultProgram() { return forge::desktop::defaultPartIr(); }

std::string selftest(const char* mode) {
  return std::string("#!forge-worker-selftest ") + mode + "\n";
}

// ★ TWO SEPARATE VECTORS, and keeping them apart is a correction this gate made
// to itself on its first run.
//
// The first version of this file compared ONE struct that mixed the mesh the
// viewport draws with the report of the last build attempt, and asserted the
// whole thing was unchanged after a crash. It failed — correctly. After a failed
// build the mesh IS still there (272 triangles, 11 faces, same bounds) but the
// report has been reset, because the report describes THE ATTEMPT THAT JUST
// HAPPENED and that attempt failed. Both facts are right; the assertion that
// bundled them was wrong.
//
// So: DRAWN is what survives a crash and must be identical. REPORTED is what
// must correctly describe the failure — a report still claiming valid=1 after a
// segfault would be a worse defect than a cleared one.
//
// VOLUME CANNOT VALIDATE GEOMETRY — a wrong solid matching a right volume to ten
// significant figures is a measured failure mode in this programme — so DRAWN
// carries a hash over the actual vertex bytes and not merely their length.
struct Observables {
  // DRAWN: what the viewport consumes.
  bool built = false;
  std::size_t triangles = 0;
  std::uint32_t faces = 0;
  float radius = 0.0f;
  std::size_t vertexBytes = 0;
  std::uint64_t vertexHash = 0;
  // REPORTED: what the last build attempt said about itself.
  double volume = 0.0;
  long faceCount = 0;
  long edgeCount = 0;
  bool valid = false;

  bool sameDrawn(const Observables& o) const {
    return built == o.built && triangles == o.triangles && faces == o.faces &&
           radius == o.radius && vertexBytes == o.vertexBytes && vertexHash == o.vertexHash;
  }
  bool sameReport(const Observables& o) const {
    return volume == o.volume && faceCount == o.faceCount && edgeCount == o.edgeCount &&
           valid == o.valid;
  }
  bool operator==(const Observables& o) const { return sameDrawn(o) && sameReport(o); }

  std::string text() const {
    return "built=" + std::to_string(built) + " tris=" + std::to_string(triangles) +
           " faces=" + std::to_string(faces) + " r=" + std::to_string(radius) +
           " bytes=" + std::to_string(vertexBytes) + " h=" + std::to_string(vertexHash) +
           " | V=" + std::to_string(volume) + " F=" + std::to_string(faceCount) +
           " E=" + std::to_string(edgeCount) + " valid=" + std::to_string(valid);
  }
};

// FNV-1a over the raw vertex bytes. A length check alone would pass a mesh whose
// every coordinate had changed.
std::uint64_t hashVertices(const std::vector<forge::desktop::SceneVertex>& v) {
  const unsigned char* p = reinterpret_cast<const unsigned char*>(v.data());
  const std::size_t n = v.size() * sizeof(forge::desktop::SceneVertex);
  std::uint64_t h = 1469598103934665603ull;
  for (std::size_t i = 0; i < n; ++i) {
    h ^= p[i];
    h *= 1099511628211ull;
  }
  return h;
}

Observables observe(const forge::desktop::KernelScene& s) {
  Observables o;
  o.built = s.built();
  o.triangles = s.triangleCount();
  o.faces = s.faceCount();
  o.radius = s.bounds().radius();
  o.vertexBytes = s.vertices().size() * sizeof(forge::desktop::SceneVertex);
  o.vertexHash = hashVertices(s.vertices());
  o.volume = s.lastBuild().volume;
  o.faceCount = s.lastBuild().faceCount;
  o.edgeCount = s.lastBuild().edgeCount;
  o.valid = s.lastBuild().valid;
  return o;
}

}  // namespace

int main(int argc, char** argv) {
  std::string worker;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--worker") == 0 && i + 1 < argc) worker = argv[++i];
    if (std::strcmp(argv[i], "--mutation") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (worker.empty()) {
    // Beside this binary, which is where the app looks for it too.
    const std::string self(argv[0]);
    const std::size_t slash = self.find_last_of('/');
    worker = (slash == std::string::npos ? std::string(".") : self.substr(0, slash)) +
             "/forge_kernel_worker";
  }
  std::printf("[isolation] worker: %s\n", worker.c_str());
  if (!fileExists(worker)) {
    // A GATE THAT CANNOT RUN IS NOT A GATE THAT PASSED.
    std::printf("[isolation] the worker binary does not exist. RED.\n");
    return 3;
  }

  forge::ui::GuardLimits limits;
  limits.deadlineMs = 60000;

  // ══ 1. THE ISOLATED BUILD IS THE SAME BUILD ═══════════════════════════════
  // Isolation that quietly changed the geometry would be worse than no
  // isolation. The in-process answer is the reference, and the out-of-process
  // answer must equal it on EVERY observable — including the byte length of the
  // vertex stream, which is what actually crosses the pipe.
  Observables inProcess;
  {
    forge::desktop::KernelScene scene;
    check(scene.build(), "the reference build succeeds IN PROCESS", scene.error());
    inProcess = observe(scene);
    check(!scene.isolationConfigured(), "a default scene has no worker configured");
    checkEq(scene.isolatedBuilds(), std::size_t{0}, "and runs nothing out of process");
  }

  forge::desktop::KernelScene scene;
  scene.useIsolatedWorker({worker}, limits);
  check(scene.isolationConfigured(), "the worker is configured");

  std::string probeError;
  check(scene.probeWorker(probeError), "the worker answers --version", probeError);

  check(scene.build(), "the same part builds OUT OF PROCESS", scene.error());
  const Observables isolated = observe(scene);
  check(isolated == inProcess, "the isolated build equals the in-process build",
        isolated.text() + "  vs  " + inProcess.text());
  checkEq(scene.isolatedBuilds(), std::size_t{1}, "one build was served out of process");
  checkEq(scene.isolatedFallbacks(), std::size_t{0}, "and none fell back");
  check(scene.lastBuild().nCompiled > 0, "the worker reported compiled statements");
  check(scene.triangleCount() > 0, "the worker returned a mesh");

  // The geometry that must still be on screen after every failure below.
  const Observables good = observe(scene);

  // ══ 2. ★ A REAL SIGSEGV IN A REAL CHILD ═══════════════════════════════════
  // The worker dereferences null on purpose. This process must reach the next
  // line — which, without the isolation, it would not.
  //
  // GATE MUTATION 1 is the POSITIVE CONTROL for that claim. It performs the same
  // null dereference IN THIS PROCESS, i.e. exactly what happens today when OCCT
  // faults during an in-process build. If the run below survives it, then either
  // the signal is being swallowed or this gate is not measuring what it says it
  // measures, and every "the parent survived" check underneath is worthless.
  // A mechanism proven only by its success case is not proven.
  if (g_mutation == 1) {
    std::printf("[isolation] MUTATION 1: dereferencing null IN THE PARENT — this is what an\n");
    std::printf("[isolation]   UNISOLATED kernel fault does, and the gate must NOT survive it.\n");
    std::fflush(stdout);
    volatile int* p = nullptr;
    *p = 1;
    std::printf("[isolation] MUTATION 1 SURVIVED — the positive control did not fire.\n");
    return 0;  // green on purpose: the runner asserts this case is RED
  }
  {
    const bool ok = scene.buildFromIr(selftest("crash"));
    check(!ok, "a crashing program does not report success");
    // ★ THE ASSERTION THIS WHOLE FILE EXISTS FOR: control reached here at all.
    check(true, "★ THE PARENT SURVIVED A KERNEL SIGSEGV");

    checkEq(static_cast<int>(scene.session().state()),
            static_cast<int>(forge::ui::KernelJobState::Crashed),
            "the session classifies it as Crashed");
    checkEq(scene.session().crashes(), std::size_t{1}, "the crash counter moved by one");
    checkEq(scene.session().lastGuardReport().signalNumber, SIGSEGV,
            "and it was SIGSEGV specifically");

    // ★ THE DIAGNOSTIC NAMES THE STATEMENT. A segfault normally yields nothing
    // at all — "no verdict, no error string, no partial measurement" — which is
    // indistinguishable from a broken harness. The worker announces each op on
    // stderr before executing it, so the parent still holds the last one.
    const forge::ui::OpProgress& last = scene.session().lastOp();
    checkEq(last.id, 7, "the op trail names the LAST statement announced");
    check(last.op == "SHELL", "and names the operation", last.op);
    checkEq(last.announced, std::size_t{2}, "having seen both announcements");
    const std::string diag = scene.session().diagnostic();
    check(diag.find("SHELL") != std::string::npos,
          "the human-readable diagnostic contains the op", diag);
    check(diag.find("%7") != std::string::npos, "and the SSA id", diag);
    check(scene.error().find("SHELL") != std::string::npos,
          "and the scene reports it to the UI", scene.error());

    // ★ THE LAST GOOD BODY IS STILL ON SCREEN. A crash that blanked the viewport
    // would lose the user's work just as effectively as taking the app down. The
    // hash is over the vertex bytes, so this is the same MESH and not merely a
    // mesh of the same size.
    const Observables after = observe(scene);
    check(after.sameDrawn(good), "★ the drawn geometry is INTACT after the crash",
          after.text() + "  vs  " + good.text());
    // And the report describes THE ATTEMPT THAT JUST FAILED. A report still
    // claiming valid=1 with the old volume would be worse than a cleared one: it
    // would state, of a build that segfaulted, that it succeeded.
    check(!scene.lastBuild().ok(), "the build report does not claim success");
    check(!scene.lastBuild().error.empty(), "and carries the reason");
  }

  // ══ 3. ★ NOTHING IS QUARANTINED — the same program RUNS AGAIN ═════════════
  // If this ever fails, a capability gate has grown where a safety net was.
  {
    const std::size_t before = scene.session().submissions();
    const bool ok = scene.buildFromIr(selftest("crash"));
    check(!ok, "the re-run still fails (it is still a crashing program)");
    checkEq(scene.session().submissions(), before + 1,
            "★ but it WAS SUBMITTED AGAIN — no quarantine, no refusal");
    checkEq(scene.session().crashes(), std::size_t{2}, "and it really crashed a second time");
    check(scene.session().priorIncidentFor(selftest("crash")) != nullptr,
          "the ledger recorded the incident (advisory only)");
  }

  // ══ 4. A HANG IS BOUNDED ══════════════════════════════════════════════════
  // 6 of 600 corpus parts exceed 300 s in the verifier, so a deadline is not
  // optional: an operation with no deadline is indistinguishable from a hang.
  {
    forge::ui::GuardLimits shortLimits = limits;
    shortLimits.deadlineMs = 900;
    scene.useIsolatedWorker({worker}, shortLimits);

    const bool ok = scene.buildFromIr(selftest("hang"));
    check(!ok, "a hanging program does not report success");
    check(true, "★ THE PARENT SURVIVED A KERNEL HANG");
    checkEq(static_cast<int>(scene.session().state()),
            static_cast<int>(forge::ui::KernelJobState::TimedOut),
            "the session classifies it as TimedOut");
    checkEq(scene.session().timeouts(), std::size_t{1}, "the timeout counter moved by one");
    // The trail still names what it was doing when the deadline fired.
    check(scene.session().lastOp().op == "LOFT", "the op trail survives a timeout too",
          scene.session().lastOp().op);
    const Observables after = observe(scene);
    check(after.sameDrawn(good), "the drawn geometry is INTACT after the timeout", after.text());
    check(!scene.lastBuild().ok(), "and the report does not claim success");
    scene.useIsolatedWorker({worker}, limits);
  }

  // ══ 5. A WORKER THAT EXITS NON-ZERO IS A FAILURE, NOT A CRASH ═════════════
  {
    const bool ok = scene.buildFromIr(selftest("refuse"));
    check(!ok, "a refusing worker does not report success");
    checkEq(static_cast<int>(scene.session().state()),
            static_cast<int>(forge::ui::KernelJobState::Failed),
            "the session classifies it as Failed, NOT Crashed");
    checkEq(scene.session().crashes(), std::size_t{2},
            "and the crash counter did NOT move (a taxonomy that blurs is a taxonomy "
            "that cannot be acted on)");
    const Observables after = observe(scene);
    check(after.sameDrawn(good), "the drawn geometry is INTACT after the refusal", after.text());
    check(!scene.lastBuild().ok(), "and the report does not claim success");
  }

  // ══ 6. A WORKER THAT EXITS 0 AND WRITES NONSENSE IS DIAGNOSED ═════════════
  // /bin/echo exits 0 and writes a line that is not the protocol. Without the
  // payload check that is a viewport full of noise; with it, it is a sentence.
  {
    forge::desktop::KernelScene noisy;
    noisy.useIsolatedWorker({"/bin/echo", "not-a-forge-worker"}, limits);
    const bool ok = noisy.buildFromIr(defaultProgram());
    check(!ok, "a worker that speaks the wrong protocol does not report success");
    checkEq(static_cast<int>(noisy.session().state()),
            static_cast<int>(forge::ui::KernelJobState::Succeeded),
            "the PROCESS succeeded (exit 0) — so only the payload check can catch this");
    check(noisy.error().find("magic") != std::string::npos,
          "and the decode names what was wrong", noisy.error());
    checkEq(noisy.isolatedFallbacks(), std::size_t{0},
            "a protocol breach is NOT a launch failure and must not silently fall back");
  }

  // ══ 7. ★ A MISSING WORKER FALLS BACK — IT DOES NOT REFUSE ════════════════
  // An application shipped without its worker must still be an application.
  {
    forge::desktop::KernelScene fallback;
    fallback.useIsolatedWorker({worker + ".does-not-exist"}, limits);
    std::string why;
    check(!fallback.probeWorker(why), "the probe reports a missing worker");
    check(!why.empty(), "and says why", why);

    const bool ok = fallback.build();
    check(ok, "★ THE PART STILL BUILDS with no worker available", fallback.error());
    checkEq(fallback.isolatedFallbacks(), std::size_t{1}, "exactly one fallback was recorded");
    const Observables o = observe(fallback);
    check(o == inProcess, "and the fallback geometry is the in-process geometry", o.text());
  }

  // ══ 7b. AN UNBOUNDED, UNINTERRUPTIBLE WAIT FALLS BACK RATHER THAN HANGING ══
  // deadlineMs = 0 means "no deadline", which is fine for a caller pumping the
  // session from its own frame loop but cannot terminate a SYNCHRONOUS build
  // with no host pump. The app would hang on rebuild, which to a user is
  // indistinguishable from the crash this mechanism exists to prevent. It must
  // fall back -- never refuse, and never spin.
  {
    forge::desktop::KernelScene unbounded;
    forge::ui::GuardLimits noDeadline = limits;
    noDeadline.deadlineMs = 0;
    unbounded.useIsolatedWorker({worker}, noDeadline);

    const bool ok = unbounded.build();
    check(ok, "★ a no-deadline scene with no host pump still BUILDS (it did not hang)",
          unbounded.error());
    checkEq(unbounded.isolatedFallbacks(), std::size_t{1},
            "and it fell back rather than entering a wait nothing can end");
    const Observables o = observe(unbounded);
    check(o == inProcess, "the fallback geometry is the in-process geometry", o.text());

    // With a host pump installed the same limits ARE usable, because the pump
    // can cancel. This is what makes the guard a property of the CONFIGURATION
    // rather than a blanket ban on deadlineMs = 0.
    forge::desktop::KernelScene pumped;
    pumped.useIsolatedWorker({worker}, noDeadline);
    pumped.setHostPump([](std::uint64_t, const std::string&) { return false; });
    check(pumped.build(), "and with a host pump the same limits run OUT of process",
          pumped.error());
    checkEq(pumped.isolatedFallbacks(), std::size_t{0}, "with no fallback");
    checkEq(pumped.isolatedBuilds(), std::size_t{1}, "and one isolated build");
  }

  // ══ 8. THE WAIT IS INTERRUPTIBLE ══════════════════════════════════════════
  // Bounded is not enough. A 300 s operation the user cannot stop is a hang as
  // far as the user is concerned, so the host pump can cancel.
  {
    forge::desktop::KernelScene cancellable;
    forge::ui::GuardLimits longLimits = limits;
    // Long enough that the CANCEL is unambiguously what ends this (the pump
    // cancels after ~20 ms), short enough that GATE MUTATION 2 — which never
    // cancels — costs 15 s rather than two minutes.
    longLimits.deadlineMs = 15000;
    cancellable.useIsolatedWorker({worker}, longLimits);

    int pumped = 0;
    std::string sawOp;
    cancellable.setHostPump([&](std::uint64_t elapsedMs, const std::string& opText) {
      ++pumped;
      if (!opText.empty()) sawOp = opText;
      (void)elapsedMs;
      // GATE MUTATION 2: never cancel. If the cancel is what actually stops this
      // job, removing it means the DEADLINE ends it instead — state TimedOut, not
      // Cancelled — and the assertions below go red. If instead the gate stayed
      // green, the cancel path was never load-bearing.
      if (g_mutation == 2) return false;
      // ★ Cancel on the FACT this case exists to demonstrate — that the pump is
      // told what the kernel is doing — not on a pump count.
      //
      // The first version cancelled after 20 pumps, and it FLAKED: 20 one-
      // millisecond polls can elapse before the child's first write to stderr
      // arrives, so `sawOp` was still "before the first statement" and the run
      // went red with nothing wrong. A gate that fails on timing is worse than no
      // gate, because it teaches people to re-run it until it is green.
      if (sawOp.find("LOFT") != std::string::npos) return true;
      // Backstop, so a worker that never announces cannot spin here for ever. It
      // is far above any plausible scheduling delay, and reaching it makes the
      // assertions below fail loudly rather than hanging.
      return pumped >= 5000;
    });

    const bool ok = cancellable.buildFromIr(selftest("hang"));
    check(!ok, "a cancelled build does not report success");
    check(pumped >= 1, "the host pump was called while the worker ran",
          std::to_string(pumped));
    checkEq(static_cast<int>(cancellable.session().state()),
            static_cast<int>(forge::ui::KernelJobState::Cancelled),
            "★ the user's cancel ended it");
    checkEq(cancellable.session().cancellations(), std::size_t{1},
            "the cancellation counter moved by one");
    check(sawOp.find("LOFT") != std::string::npos,
          "and the pump was told what the kernel was doing", sawOp);
  }

  // ══ 9. THE WIRE FORMAT IS CHECKED, NOT TRUSTED ════════════════════════════
  // decodeWorkerPayload is the only thing between a corrupted pipe and the
  // viewport. These drive it directly, because a truncated mesh is not something
  // a live worker can be asked to produce on demand.
  {
    // THE BODY INVENTORY'S TABLES, which the worker writes between its backend
    // line and its vertex count. Four count-prefixed blocks; an empty inventory
    // is four zeroes, and the face-to-body map sends no line at all when its
    // count is zero. Spelled ONCE here and appended to every fixture below, so a
    // protocol change breaks these fixtures in one place instead of in five.
    const std::string emptyInventory = "bodies 0\nbodyPairs 0\nalignments 0\nfaceBodies 0\n";

    // A well-formed minimal answer, built from the same constant the worker
    // writes, so this cannot pass against a protocol that has drifted.
    const std::string head =
        std::string(forge::desktop::kWorkerResultMagic) +
        "\nparsed 1\ncompiled 1\ntessellated 1\nvalid 1\nfailedOpId -1\nfailedLine 0\n"
        "faceCount 6\nedgeCount 12\nvolume 1000\nbboxMin 0 0 0\nbboxMax 10 10 10\n"
        "nDeclared 1\nnParsed 1\nnCompiled 1\ntriangles 1\nbodiesAnalysed 1\n"
        "pairsEvaluated 0\npairsTruncated 0\nerrorBytes 0\n\nbackend test\n" + emptyInventory;

    forge::desktop::IrBuildReport r;
    std::vector<forge::desktop::SceneVertex> v;
    std::string backend;
    std::string err;

    const std::string threeVerts(3 * sizeof(forge::desktop::SceneVertex), '\0');
    check(forge::desktop::KernelSceneTestAccess::decode(head + "VERTICES 3\n" + threeVerts, r, v,
                                                        backend, err),
          "a well-formed payload decodes", err);
    checkEq(v.size(), std::size_t{3}, "with its vertices");
    check(backend == "test", "and its backend name", backend);
    check(r.volume == 1000.0, "and its scalars");

    // Truncated: the count says 3, the bytes say 2. Rendering this is a garbled
    // mesh; the check turns it into a sentence.
    check(!forge::desktop::KernelSceneTestAccess::decode(
              head + "VERTICES 3\n" + threeVerts.substr(sizeof(forge::desktop::SceneVertex)), r, v,
              backend, err),
          "a TRUNCATED vertex stream is refused");
    check(err.find("but sent") != std::string::npos, "and the size mismatch is named", err);

    // Over-long: the stream desynchronised. Same defect, opposite sign, and a
    // `>=` check would have missed it.
    check(!forge::desktop::KernelSceneTestAccess::decode(head + "VERTICES 3\n" + threeVerts + "x",
                                                         r, v, backend, err),
          "an OVER-LONG vertex stream is refused too");

    // Not a whole number of triangles.
    const std::string twoVerts(2 * sizeof(forge::desktop::SceneVertex), '\0');
    check(!forge::desktop::KernelSceneTestAccess::decode(head + "VERTICES 2\n" + twoVerts, r, v,
                                                         backend, err),
          "a vertex count that is not whole triangles is refused");
    check(err.find("triangles") != std::string::npos, "and says so", err);

    // A newline INSIDE the error text must not be read as the next field. This is
    // why the error block is length-prefixed.
    // ★ The declared length is COMPUTED from the string, never typed. Hardcoding
    // it is how the first run of this gate declared 21 bytes for a 22-byte error
    // and then blamed the decoder for refusing it.
    const std::string embeddedError = "line one\nbackend fake\n";
    const std::string embedded =
        std::string(forge::desktop::kWorkerResultMagic) +
        "\nparsed 1\ncompiled 0\ntessellated 0\nvalid 0\nfailedOpId 7\nfailedLine 0\n"
        "faceCount -1\nedgeCount -1\nvolume 0\nbboxMin 0 0 0\nbboxMax 0 0 0\n"
        "nDeclared 1\nnParsed 1\nnCompiled 0\ntriangles 0\nerrorBytes " +
        std::to_string(embeddedError.size()) + "\n" + embeddedError + "\nbackend real\n" +
        emptyInventory + "VERTICES 0\n";
    check(forge::desktop::KernelSceneTestAccess::decode(embedded, r, v, backend, err),
          "an error string containing a newline decodes", err);
    check(backend == "real", "★ and the EMBEDDED 'backend fake' was not mistaken for a field",
          backend);
    check(r.error.find("line one") != std::string::npos, "the error text is intact", r.error);
    checkEq(r.failedOpId, 7, "and the failed op id survives");

    // A DECLARED LENGTH THAT DOES NOT MATCH is itself a protocol breach, and this
    // is the case the first run of this gate hit by accident. Asserted on purpose
    // now: one byte short, and the backend line is misread.
    const std::string shortCount =
        std::string(forge::desktop::kWorkerResultMagic) +
        "\nparsed 1\ncompiled 0\ntessellated 0\nvalid 0\nfailedOpId 7\nfailedLine 0\n"
        "faceCount -1\nedgeCount -1\nvolume 0\nbboxMin 0 0 0\nbboxMax 0 0 0\n"
        "nDeclared 1\nnParsed 1\nnCompiled 0\ntriangles 0\nerrorBytes " +
        std::to_string(embeddedError.size() - 1) + "\n" + embeddedError + "\nbackend real\n" +
        emptyInventory + "VERTICES 0\n";
    check(!forge::desktop::KernelSceneTestAccess::decode(shortCount, r, v, backend, err),
          "an error block whose declared length is one byte short is refused");

    // ── the BODY INVENTORY crosses the same pipe, and is checked the same way ──
    // A parts list is drawn from these tables, so a block that arrives short must
    // be a sentence and not a panel one body short of the truth.
    {
      const std::string inventoryHead =
          std::string(forge::desktop::kWorkerResultMagic) +
          "\nparsed 1\ncompiled 1\ntessellated 1\nvalid 1\nfailedOpId -1\nfailedLine 0\n"
          "faceCount 12\nedgeCount 24\nvolume 2000\nbboxMin 0 0 0\nbboxMax 10 10 10\n"
          "nDeclared 1\nnParsed 1\nnCompiled 1\ntriangles 1\nbodiesAnalysed 1\n"
          "pairsEvaluated 1\npairsTruncated 0\nerrorBytes 0\n\nbackend test\n";
      const std::string twoBodies =
          "bodies 2\n"
          "body 1000 600 0 0 5 -5 -5 0 5 5 10 6\n"
          "body 1000 600 30 0 5 25 -5 0 35 5 10 6\n"
          "bodyPairs 1\nbodyPair 1 2 20 0\n"
          "alignments 1\nalignment 1 1 2 3 9 0.25 1 2 3 0 0 1\n"
          "faceBodies 13\n0 1 1 1 1 1 1 2 2 2 2 2 2\n";
      check(forge::desktop::KernelSceneTestAccess::decode(
                inventoryHead + twoBodies + "VERTICES 3\n" + threeVerts, r, v, backend, err),
            "a payload carrying a body inventory decodes", err);
      checkEq(r.bodies.size(), std::size_t{2}, "both bodies arrive");
      check(r.bodies.size() == 2 && r.bodies[1].centroid[0] == 30.0,
            "and a body's centroid crosses intact");
      checkEq(r.bodyPairs.size(), std::size_t{1}, "the measured pair arrives");
      check(!r.bodyPairs.empty() && r.bodyPairs[0].gap == 20.0, "with its exact gap");
      checkEq(r.alignments.size(), std::size_t{1}, "the alignment arrives");
      check(!r.alignments.empty() && r.alignments[0].deviation == 0.25,
            "with its measured deviation");
      checkEq(r.bodyOfFace.size(), std::size_t{13}, "the whole face-to-body map arrives");
      checkEq(r.bodyForFace(7), std::uint32_t{2}, "and a face still names its body");

      // One body short of what it declared.
      const std::string shortBodies =
          "bodies 2\nbody 1000 600 0 0 5 -5 -5 0 5 5 10 6\n"
          "bodyPairs 0\nalignments 0\nfaceBodies 0\n";
      check(!forge::desktop::KernelSceneTestAccess::decode(
                inventoryHead + shortBodies + "VERTICES 3\n" + threeVerts, r, v, backend, err),
            "an inventory one body short of its own count is refused");

      // A face-to-body map that ends early.
      const std::string shortMap =
          "bodies 0\nbodyPairs 0\nalignments 0\nfaceBodies 5\n0 1 1\n";
      check(!forge::desktop::KernelSceneTestAccess::decode(
                inventoryHead + shortMap + "VERTICES 3\n" + threeVerts, r, v, backend, err),
            "a face-to-body map that ends early is refused");
      check(err.find("of 5 entries") != std::string::npos, "and names how far it got", err);

      // An alignment kind this build does not know. Defaulting it would put a
      // wrong WORD in front of a user, which is worse than refusing the payload.
      const std::string strangeKind =
          "bodies 0\nbodyPairs 0\nalignments 1\n"
          "alignment 9 1 2 3 4 0 0 0 0 0 0 1\nfaceBodies 0\n";
      check(!forge::desktop::KernelSceneTestAccess::decode(
                inventoryHead + strangeKind + "VERTICES 3\n" + threeVerts, r, v, backend, err),
            "an alignment kind this build does not know is refused");
    }

    // Empty output from a worker that exited 0.
    check(!forge::desktop::KernelSceneTestAccess::decode("", r, v, backend, err),
          "an empty payload is refused");
  }

  std::printf("\n[isolation] %d checks, %d failures\n", g_checks, g_failures);
  if (g_failures != 0) {
    std::printf("[isolation] RED\n");
    return 1;
  }
  std::printf("[isolation] ★ THE APPLICATION SURVIVES A KERNEL SEGFAULT, A HANG, A REFUSAL,\n");
  std::printf("[isolation]   A PROTOCOL BREACH AND A MISSING WORKER — and refuses nothing.\n");
  return 0;
}
