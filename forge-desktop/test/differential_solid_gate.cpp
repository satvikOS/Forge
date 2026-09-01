// forge-desktop/test/differential_solid_gate.cpp
//
// THE INTEGRATION INVARIANT, TIER 2 -- THE SOLIDS.
//
// ir_pipeline_gate.cpp proved a UI-authored program compiles to A solid. It never
// compared that solid against anything. This gate compares the TWO PATHS a single
// feature tree can take to the kernel, on a VECTOR of observables:
//
//   A. HEADLESS -- forge::ft::compileText(plannerIr)
//      The exact entry forge-kernel/src/tools/forge_verify.cpp uses. Every
//      benchmark number in this programme is produced through this call.
//
//   B. IN-APP   -- forge::ft::parse(appIr) + forge::ft::compile(tree)
//      The exact pair KernelScene.cpp calls, over the IR the REAL registered
//      commands assembled (differential_corpus.hpp drives them). Separate from A
//      on purpose: `compileText` is a different entry point, and "the two entries
//      agree" is an assumption nobody has ever checked.
//
//   C. THE APPLICATION OBJECT -- forge::desktop::KernelScene::buildFromIr(appIr)
//      Not a re-implementation: the class ForgeFrame calls to rebuild the
//      viewport, including tessellation and the de-index into the vertex buffer.
//      If A and B agree and C does not, the viewport is drawing something the
//      verifier never scored.
//
// ── THE OBSERVABLE VECTOR ───────────────────────────────────────────────────
// VOLUME CANNOT VALIDATE GEOMETRY. A wrong solid reproducing a right volume to
// ten significant figures has been measured four times here, and in the worst
// case NO SINGLE observable caught it -- centre of mass was clean on the sphere,
// the bbox was clean on the cylinder. So every comparison below is a vector:
//
//   ok  valid  volume  area  bboxMin[3]  bboxMax[3]  faceCount  edgeCount
//   genus  shellCount  weldedVertices  weldedEdges  weldedTriangles  eulerChar
//   centreOfMass[3]  nDeclared  nParsed  nCompiled
//
// Doubles are compared with a RELATIVE tolerance of 1e-9 rather than exactly:
// both arms run the same code on the same text, so a difference above that is a
// real divergence and not floating-point noise.
//
// `--mutate N` injects one deliberate divergence and the gate must go RED.
//
// Exit codes
//   0  GREEN
//   1  RED  -- the arms disagree, or an injected divergence was NOT caught
//   2  RED  -- bad arguments
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "KernelScene.hpp"

#include "forge/MassProps.hpp"
#include "forge/Topology.hpp"
#include "forge/ft/FeatureTree.hpp"

#include "differential_corpus.hpp"

using forge::difftest::Mutation;

namespace {

int checks = 0;
int failures = 0;

std::string num(double v) {
  char b[64];
  std::snprintf(b, sizeof b, "%.12g", v);
  return std::string(b);
}

void checkEq(const std::string& tree, const char* what, long long got, long long want) {
  ++checks;
  if (got == want) return;
  ++failures;
  std::printf("  [DIVERGE] %-22s %-18s A=%lld  B=%lld\n", tree.c_str(), what, want, got);
}

void checkNear(const std::string& tree, const char* what, double got, double want) {
  ++checks;
  const double scale = std::fmax(1.0, std::fmax(std::fabs(got), std::fabs(want)));
  if (std::fabs(got - want) <= 1e-9 * scale) return;
  ++failures;
  std::printf("  [DIVERGE] %-22s %-18s A=%s  B=%s\n", tree.c_str(), what, num(want).c_str(),
              num(got).c_str());
}

void checkStr(const std::string& tree, const char* what, const std::string& got,
              const std::string& want) {
  ++checks;
  if (got == want) return;
  ++failures;
  std::printf("  [DIVERGE] %-22s %-18s A=\"%s\"  B=\"%s\"\n", tree.c_str(), what, want.c_str(),
              got.c_str());
}

// ── one arm's full observable vector ────────────────────────────────────────
struct Observed {
  bool measured = false;      // the compile ran (whether or not it succeeded)
  bool ok = false;
  std::string error;
  int failedOpId = -1;
  bool valid = false;
  long faceCount = -1;
  long edgeCount = -1;
  double volume = 0.0;
  double area = 0.0;
  double bboxMin[3] = {0, 0, 0};
  double bboxMax[3] = {0, 0, 0};
  double com[3] = {0, 0, 0};
  long genus = -1;
  long shellCount = -1;
  long weldedVertices = -1;
  long weldedEdges = -1;
  long weldedTriangles = -1;
  long eulerChar = 0;
  bool topoMeasured = false;
  std::size_t nDeclared = 0, nParsed = 0, nCompiled = 0;
};

// Fill the parts of the vector that need the SHAPE rather than the compile
// result: genus and shell count (Topology.hpp, weld-betti over the mesh) and the
// centre of mass and area (MassProps.hpp, OCCT GProp). Both arms are measured by
// the SAME functions, so a difference here is a difference in the solid.
void measureShape(forge::ShapeHandle h, Observed& o) {
  if (h == forge::kInvalidHandle) return;
  forge::TopoSignature sig;
  if (forge::topologySignature(h, sig)) {
    o.topoMeasured = true;
    o.genus = sig.genus;
    o.shellCount = sig.shellCount;
    o.weldedVertices = sig.vertexCount;
    o.weldedEdges = sig.edgeCount;
    o.weldedTriangles = sig.faceCount;
    o.eulerChar = sig.eulerChar;
  }
  const forge::MassProperties mp = forge::massProperties(h);
  o.area = mp.area;
  o.com[0] = mp.cx;
  o.com[1] = mp.cy;
  o.com[2] = mp.cz;
}

void fillFromCompile(const forge::ft::CompileResult& r, Observed& o) {
  o.measured = true;
  o.ok = r.ok;
  o.error = r.error;
  o.failedOpId = r.failedOpId;
  o.valid = r.valid;
  o.faceCount = r.faceCount;
  o.edgeCount = r.edgeCount;
  o.volume = r.volume;
  for (int i = 0; i < 3; ++i) {
    o.bboxMin[i] = r.bboxMin[i];
    o.bboxMax[i] = r.bboxMax[i];
  }
  o.nDeclared = r.nDeclared;
  o.nParsed = r.nParsed;
  o.nCompiled = r.nCompiled;
  if (r.ok) measureShape(static_cast<forge::ShapeHandle>(r.handle), o);
}

// ARM A -- what forge_verify does.
Observed headlessArm(const std::string& ir) {
  Observed o;
  fillFromCompile(forge::ft::compileText(ir, std::string()), o);
  return o;
}

// ARM B -- what KernelScene.cpp does, statement for statement.
Observed inAppArm(const std::string& ir) {
  Observed o;
  forge::ft::FeatureTree tree;
  try {
    tree = forge::ft::parse(ir);
  } catch (const std::exception& e) {
    o.measured = true;
    o.ok = false;
    o.error = std::string("parse: ") + e.what();
    return o;
  }
  fillFromCompile(forge::ft::compile(tree), o);
  return o;
}

void compare(const std::string& tree, const Observed& a, const Observed& b) {
  checkEq(tree, "measured", b.measured, a.measured);
  checkEq(tree, "ok", b.ok, a.ok);
  checkStr(tree, "error", b.error, a.error);
  checkEq(tree, "failedOpId", b.failedOpId, a.failedOpId);
  checkEq(tree, "s0.4 declared", static_cast<long long>(b.nDeclared),
          static_cast<long long>(a.nDeclared));
  checkEq(tree, "s0.4 parsed", static_cast<long long>(b.nParsed),
          static_cast<long long>(a.nParsed));
  checkEq(tree, "s0.4 compiled", static_cast<long long>(b.nCompiled),
          static_cast<long long>(a.nCompiled));
  if (!a.ok || !b.ok) return;  // the failure itself already had to match

  checkEq(tree, "valid", b.valid, a.valid);
  checkEq(tree, "faceCount", b.faceCount, a.faceCount);
  checkEq(tree, "edgeCount", b.edgeCount, a.edgeCount);
  checkNear(tree, "volume", b.volume, a.volume);
  checkNear(tree, "area", b.area, a.area);
  checkNear(tree, "bboxMin.x", b.bboxMin[0], a.bboxMin[0]);
  checkNear(tree, "bboxMin.y", b.bboxMin[1], a.bboxMin[1]);
  checkNear(tree, "bboxMin.z", b.bboxMin[2], a.bboxMin[2]);
  checkNear(tree, "bboxMax.x", b.bboxMax[0], a.bboxMax[0]);
  checkNear(tree, "bboxMax.y", b.bboxMax[1], a.bboxMax[1]);
  checkNear(tree, "bboxMax.z", b.bboxMax[2], a.bboxMax[2]);
  checkNear(tree, "com.x", b.com[0], a.com[0]);
  checkNear(tree, "com.y", b.com[1], a.com[1]);
  checkNear(tree, "com.z", b.com[2], a.com[2]);
  checkEq(tree, "topo measured", b.topoMeasured, a.topoMeasured);
  checkEq(tree, "genus", b.genus, a.genus);
  checkEq(tree, "shellCount", b.shellCount, a.shellCount);
  checkEq(tree, "welded V", b.weldedVertices, a.weldedVertices);
  checkEq(tree, "welded E", b.weldedEdges, a.weldedEdges);
  checkEq(tree, "welded F", b.weldedTriangles, a.weldedTriangles);
  checkEq(tree, "euler chi", b.eulerChar, a.eulerChar);
}

// ARM C -- the application object itself.
void compareScene(const std::string& tree, const Observed& b,
                  const forge::desktop::IrBuildReport& c) {
  checkEq(tree, "scene compiled", c.compiled, b.ok);
  checkEq(tree, "scene valid", c.valid, b.valid);
  checkEq(tree, "scene faceCount", c.faceCount, b.faceCount);
  checkEq(tree, "scene edgeCount", c.edgeCount, b.edgeCount);
  checkNear(tree, "scene volume", c.volume, b.volume);
  checkNear(tree, "scene bboxMin.x", c.bboxMin[0], b.bboxMin[0]);
  checkNear(tree, "scene bboxMin.y", c.bboxMin[1], b.bboxMin[1]);
  checkNear(tree, "scene bboxMin.z", c.bboxMin[2], b.bboxMin[2]);
  checkNear(tree, "scene bboxMax.x", c.bboxMax[0], b.bboxMax[0]);
  checkNear(tree, "scene bboxMax.y", c.bboxMax[1], b.bboxMax[1]);
  checkNear(tree, "scene bboxMax.z", c.bboxMax[2], b.bboxMax[2]);
  checkEq(tree, "scene declared", static_cast<long long>(c.nDeclared),
          static_cast<long long>(b.nDeclared));
  checkEq(tree, "scene parsed", static_cast<long long>(c.nParsed),
          static_cast<long long>(b.nParsed));
  checkEq(tree, "scene compiled#", static_cast<long long>(c.nCompiled),
          static_cast<long long>(b.nCompiled));
}

}  // namespace

int main(int argc, char** argv) {
  Mutation mutation = Mutation::None;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutation-count") == 0) {
      std::printf("%d\n", forge::difftest::kMutationCount);
      return 0;
    }
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) {
      const int n = std::atoi(argv[i + 1]);
      if (n <= 0 || n > forge::difftest::kMutationCount) {
        std::printf("[differential-solid] --mutate takes 1..%d\n",
                    forge::difftest::kMutationCount);
        return 2;
      }
      mutation = static_cast<Mutation>(n);
      ++i;
    }
  }

  const std::vector<forge::difftest::Tree>& corpus = forge::difftest::trees();
  std::printf("=== differential_solid_gate: one tree, two paths, one solid ===\n");
  std::printf("[differential-solid] %zu trees, mutation=%s\n", corpus.size(),
              forge::difftest::mutationName(mutation));

  // The corpus is shared with the kernel-free tier. If it ever shrinks to
  // nothing, an empty sweep must not be able to report a pass.
  ++checks;
  if (corpus.size() != 8) {
    ++failures;
    std::printf("  [FAIL] the shared corpus has %zu trees, expected 8 -- the two tiers are\n"
                "         no longer reading the same file.\n",
                corpus.size());
  }

  std::size_t built = 0;
  for (const forge::difftest::Tree& t : corpus) {
    const forge::difftest::AppRun app = forge::difftest::runInApp(t, mutation);
    ++checks;
    if (!app.ok) {
      ++failures;
      std::printf("  [FAIL] the app path did not run: %s\n", app.failure.c_str());
      continue;
    }

    const std::string plannerIr = forge::difftest::headlessProgram(t, mutation);
    const Observed a = headlessArm(plannerIr);
    const Observed b = inAppArm(app.ir);
    compare(t.id, a, b);

    forge::desktop::KernelScene scene;
    const bool sceneOk = scene.buildFromIr(app.ir);
    (void)sceneOk;
    compareScene(t.id, b, scene.lastBuild());

    if (a.ok && b.ok) {
      ++built;
      std::printf("  [%-22s] V=%-14s faces=%-4ld edges=%-4ld genus=%ld shells=%ld "
                  "com=(%s, %s, %s) tris=%zu\n",
                  t.id.c_str(), num(a.volume).c_str(), a.faceCount, a.edgeCount, a.genus,
                  a.shellCount, num(a.com[0]).c_str(), num(a.com[1]).c_str(),
                  num(a.com[2]).c_str(), scene.lastBuild().triangles);
    } else {
      std::printf("  [%-22s] both arms report NOT BUILT: A=\"%s\" B=\"%s\"\n", t.id.c_str(),
                  a.error.c_str(), b.error.c_str());
    }
  }

  // How many trees BUILD is a separate fact from whether the arms agree, and it
  // is pinned so a silent collapse to "everything fails identically in both
  // arms" cannot pass as agreement. That is exactly the shape a gate takes when
  // it stops measuring anything.
  ++checks;
  if (built != corpus.size()) {
    ++failures;
    std::printf("  [FAIL] %zu of %zu trees built; the corpus is chosen to build, so a drop\n"
                "         here is a kernel regression, not a corpus problem.\n",
                built, corpus.size());
  }

  if (mutation != Mutation::None && failures == 0) {
    std::printf("[differential-solid] MUTATION %s WAS NOT CAUGHT -- the gate is decoration.\n",
                forge::difftest::mutationName(mutation));
    ++checks;
    ++failures;
  }

  std::printf("[differential-solid] %d checks, %d failures -- %s\n", checks, failures,
              failures == 0 ? "PASS" : "FAIL");
  if (failures == 0) {
    std::printf("[differential-solid] GREEN -- the verifier's solid and the application's solid\n"
                "                     are identical on every observable, for all %zu trees.\n",
                corpus.size());
  }
  return failures == 0 ? 0 : 1;
}
