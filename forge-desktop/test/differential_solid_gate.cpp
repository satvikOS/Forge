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
//   D. THE forge_verify BINARY -- a SEPARATE ARTIFACT, driven over its stdin
//      protocol. A, B and C are three entry points inside one process; the
//      integration invariant is about two ARTIFACTS built from one source, which
//      is the desync that has bitten this repo nine times. A stale,
//      differently-configured or differently-linked verifier is invisible to any
//      comparison that never runs it. Its transcript is quantised to 1e-6 by
//      forge_verify's own num(), so this arm compares at 5e-7 ABSOLUTE -- half
//      the last written place, and no sharper, because a tighter tolerance would
//      be comparing the formatter.
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
#include <fstream>
#include <string>
#include <utility>
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

// ── ARM D -- THE forge_verify BINARY, NOT ITS ENTRY POINT ───────────────────
// Arms A/B/C above are three entry points inside ONE process. That is worth
// checking and it is not what the integration invariant says. The headless path
// is a SEPARATE ARTIFACT: `forge_verify`, configured, compiled and linked on its
// own, fed IR over a pipe, answering in JSON. "Two artifacts from one source with
// no gate tying them together" is the defect class that has bitten this repo nine
// times, and comparing compileText against parse+compile in the same binary does
// not touch it -- a stale, differently-configured or differently-linked verifier
// is exactly the failure that stays invisible.
//
// So this arm runs the tool. One batch, one line per tree, over stdin.
//
// TOLERANCE. num() in forge_verify.cpp is `precision(6) << fixed`, so the
// transcript is quantised to 1e-6 ABSOLUTE. Comparing it at the 1e-9 RELATIVE
// tolerance the in-process arms use would compare the FORMATTER and go red on
// geometry that is identical. 5e-7 absolute is half the last written place: the
// sharpest claim the transcript can support, and stated rather than tuned.
constexpr double kTranscriptQuantum = 5e-7;

void checkNearTranscript(const std::string& tree, const char* what, double got, double want) {
  ++checks;
  if (std::fabs(got - want) <= kTranscriptQuantum) return;
  ++failures;
  std::printf("  [DIVERGE] %-22s %-18s inproc=%s  forge_verify=%s\n", tree.c_str(), what,
              num(want).c_str(), num(got).c_str());
}

// A minimal reader for the one line shape forge_verify writes. Deliberately not a
// JSON library: this tool must not acquire a dependency to read its own protocol,
// and the fields it needs are flat scalars and two fixed-length arrays.
//
// `found` is reported separately from the value on purpose. A field this gate
// cannot find must not read as 0.0 and silently agree with an arm that measured
// zero -- that is a green produced by an absence, which is the shape of every
// gate in this programme that turned out to be measuring nothing.
bool jsonNumberField(const std::string& line, const std::string& key, double& out) {
  const std::string needle = "\"" + key + "\":";
  const std::size_t at = line.find(needle);
  if (at == std::string::npos) return false;
  const char* p = line.c_str() + at + needle.size();
  if (std::strncmp(p, "null", 4) == 0) return false;
  char* end = nullptr;
  const double v = std::strtod(p, &end);
  if (end == p) return false;
  out = v;
  return true;
}

bool jsonBoolField(const std::string& line, const std::string& key, bool& out) {
  const std::string needle = "\"" + key + "\":";
  const std::size_t at = line.find(needle);
  if (at == std::string::npos) return false;
  const char* p = line.c_str() + at + needle.size();
  if (std::strncmp(p, "true", 4) == 0) { out = true; return true; }
  if (std::strncmp(p, "false", 5) == 0) { out = false; return true; }
  return false;
}

// The three numbers of "com":[x,y,z] or of a bbox corner.
bool jsonTripleField(const std::string& line, const std::string& key, double out[3]) {
  const std::string needle = "\"" + key + "\":[";
  const std::size_t at = line.find(needle);
  if (at == std::string::npos) return false;
  const char* p = line.c_str() + at + needle.size();
  for (int i = 0; i < 3; ++i) {
    char* end = nullptr;
    const double v = std::strtod(p, &end);
    if (end == p) return false;
    out[i] = v;
    p = end;
    while (*p == ',' || *p == ' ') ++p;
  }
  return true;
}

struct VerifierLine {
  std::string id;
  bool present = false;
  bool ok = false;
  bool valid = false;
  double volume = 0.0;
  double area = 0.0;
  bool hasArea = false;
  double com[3] = {0, 0, 0};
  bool hasCom = false;
  double bboxMin[3] = {0, 0, 0};
  double bboxMax[3] = {0, 0, 0};
  double faceCount = -1;
  double edgeCount = -1;
  double genus = -1;
  double shellCount = -1;
  bool hasTopo = false;
};

std::string jsonStringField(const std::string& line, const std::string& key) {
  const std::string needle = "\"" + key + "\":\"";
  const std::size_t at = line.find(needle);
  if (at == std::string::npos) return std::string();
  const std::size_t from = at + needle.size();
  const std::size_t to = line.find('"', from);
  if (to == std::string::npos) return std::string();
  return line.substr(from, to - from);
}

// Run the tool ONCE over the whole corpus. `bin` is the verifier; `records` is one
// {"id","ir"} object per tree. Returns false when the tool could not be run at
// all -- which is RED, never a skip: a check that could not run is not a check
// that passed.
bool runVerifier(const std::string& bin, const std::vector<std::pair<std::string, std::string>>& records,
                 std::vector<VerifierLine>& out, std::string& why) {
  out.clear();
  const char* tmpdir = std::getenv("TMPDIR");
  const std::string dir = (tmpdir != nullptr && *tmpdir != '\0') ? std::string(tmpdir) : "/tmp/";
  const std::string inPath = dir + "forge_diffgate_in.jsonl";
  const std::string outPath = dir + "forge_diffgate_out.jsonl";
  {
    std::ofstream in(inPath);
    if (!in) { why = "cannot write " + inPath; return false; }
    for (const auto& rec : records) {
      // The IR is the only field needing escaping, and it holds newlines and no
      // quotes (IrLine::text() writes a quoted selector only, and no corpus tree
      // carries one). Escaped anyway: a corpus that gains one must not silently
      // hand the tool a truncated program.
      std::string ir;
      for (char c : rec.second) {
        if (c == '\n') ir += "\\n";
        else if (c == '"') ir += "\\\"";
        else if (c == '\\') ir += "\\\\";
        else ir += c;
      }
      in << "{\"id\":\"" << rec.first << "\",\"ir\":\"" << ir << "\"}\n";
    }
  }
  const std::string cmd = "\"" + bin + "\" < \"" + inPath + "\" > \"" + outPath + "\" 2>/dev/null";
  const int rc = std::system(cmd.c_str());
  if (rc != 0) {
    why = "forge_verify exited " + std::to_string(rc);
    return false;
  }
  std::ifstream res(outPath);
  if (!res) { why = "cannot read " + outPath; return false; }
  std::string line;
  while (std::getline(res, line)) {
    if (line.empty()) continue;
    VerifierLine v;
    v.present = true;
    v.id = jsonStringField(line, "id");
    jsonBoolField(line, "ok", v.ok);
    jsonBoolField(line, "valid", v.valid);
    jsonNumberField(line, "volume", v.volume);
    v.hasArea = jsonNumberField(line, "area", v.area);
    v.hasCom = jsonTripleField(line, "com", v.com);
    jsonNumberField(line, "faceCount", v.faceCount);
    jsonNumberField(line, "edgeCount", v.edgeCount);
    v.hasTopo = jsonNumberField(line, "genus", v.genus);
    jsonNumberField(line, "shellCount", v.shellCount);
    // bbox is nested one level; the corner arrays are what this needs.
    const std::size_t bb = line.find("\"bbox\":");
    if (bb != std::string::npos) {
      const std::string tail = line.substr(bb);
      jsonTripleField(tail, "min", v.bboxMin);
      jsonTripleField(tail, "max", v.bboxMax);
    }
    out.push_back(v);
  }
  std::remove(inPath.c_str());
  std::remove(outPath.c_str());
  if (out.size() != records.size()) {
    why = "forge_verify emitted " + std::to_string(out.size()) + " of " +
          std::to_string(records.size()) + " records";
    return false;
  }
  return true;
}

void compareVerifier(const std::string& tree, const Observed& a, const VerifierLine& v) {
  checkEq(tree, "fv present", v.present, true);
  if (!v.present) return;
  checkEq(tree, "fv ok", v.ok, a.ok);
  if (!a.ok || !v.ok) return;
  checkEq(tree, "fv valid", v.valid, a.valid);
  checkEq(tree, "fv faceCount", static_cast<long long>(v.faceCount), a.faceCount);
  checkEq(tree, "fv edgeCount", static_cast<long long>(v.edgeCount), a.edgeCount);
  checkNearTranscript(tree, "fv volume", v.volume, a.volume);
  checkNearTranscript(tree, "fv bboxMin.x", v.bboxMin[0], a.bboxMin[0]);
  checkNearTranscript(tree, "fv bboxMin.y", v.bboxMin[1], a.bboxMin[1]);
  checkNearTranscript(tree, "fv bboxMin.z", v.bboxMin[2], a.bboxMin[2]);
  checkNearTranscript(tree, "fv bboxMax.x", v.bboxMax[0], a.bboxMax[0]);
  checkNearTranscript(tree, "fv bboxMax.y", v.bboxMax[1], a.bboxMax[1]);
  checkNearTranscript(tree, "fv bboxMax.z", v.bboxMax[2], a.bboxMax[2]);
  // area and com are the fields this change ADDED to the tool. Their ABSENCE is a
  // failure, not a skip: the whole point of adding them was that the observable
  // vector could not otherwise be compared against the artifact at all.
  checkEq(tree, "fv reports area", v.hasArea, true);
  if (v.hasArea) checkNearTranscript(tree, "fv area", v.area, a.area);
  checkEq(tree, "fv reports com", v.hasCom, true);
  if (v.hasCom) {
    checkNearTranscript(tree, "fv com.x", v.com[0], a.com[0]);
    checkNearTranscript(tree, "fv com.y", v.com[1], a.com[1]);
    checkNearTranscript(tree, "fv com.z", v.com[2], a.com[2]);
  }
  checkEq(tree, "fv topo measured", v.hasTopo, a.topoMeasured);
  if (v.hasTopo && a.topoMeasured) {
    checkEq(tree, "fv genus", static_cast<long long>(v.genus), a.genus);
    checkEq(tree, "fv shellCount", static_cast<long long>(v.shellCount), a.shellCount);
  }
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
  std::vector<std::pair<std::string, std::string>> batch;
  std::vector<Observed> headless;
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

    batch.emplace_back(t.id, plannerIr);
    headless.push_back(a);

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

  // ── ARM D ────────────────────────────────────────────────────────────────
  // FORGE_VERIFY_BIN is set by run_differential_solid_gate.sh, which builds the
  // tool. Its absence is RED and never a skip -- a gate that silently drops its
  // only cross-ARTIFACT arm is the decoration this whole file argues against.
  {
    const char* bin = std::getenv("FORGE_VERIFY_BIN");
    ++checks;
    if (bin == nullptr || *bin == '\0') {
      ++failures;
      std::printf("  [FAIL] FORGE_VERIFY_BIN is unset, so the forge_verify ARTIFACT was never\n"
                  "         run. Arms A/B/C are three entry points in ONE process; without D\n"
                  "         this gate does not compare two artifacts at all.\n");
    } else {
      std::vector<VerifierLine> lines;
      std::string why;
      if (!runVerifier(bin, batch, lines, why)) {
        ++failures;
        std::printf("  [FAIL] could not run the forge_verify artifact at %s: %s\n", bin,
                    why.c_str());
      } else {
        std::printf("[differential-solid] arm D: the forge_verify ARTIFACT at %s\n", bin);
        for (std::size_t i = 0; i < lines.size() && i < headless.size(); ++i) {
          compareVerifier(batch[i].first, headless[i], lines[i]);
        }
      }
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
