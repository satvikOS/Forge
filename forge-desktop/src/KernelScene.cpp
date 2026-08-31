#include "KernelScene.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <exception>
#include <string>
#include <utility>
#include <vector>

#include <unistd.h>

#include "PartFile.hpp"

// The kernel. These are the ONLY forge-kernel/OCCT includes in the whole desktop
// application; see KernelScene.hpp for why that is deliberate.
#include "forge/Booleans.hpp"
#include "forge/Tessellate.hpp"
#include "forge/ft/FeatureTree.hpp"

namespace forge::desktop {
namespace {

// Tessellation tolerances. 0.05 mm linear / 0.35 rad angular is the deflection
// pair the kernel's own mesh probe uses for a display mesh: fine enough that a
// 12 mm bore reads as round, coarse enough to stay interactive.
constexpr double kLinearTol = 0.05;
constexpr double kAngularTol = 0.35;

void normalize3(float v[3]) {
  const float len = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len > 1e-20f) {
    v[0] /= len;
    v[1] /= len;
    v[2] /= len;
  }
}

// ── the worker payload reader's two primitives ─────────────────────────────
// Both are file-local and pure, so decodeWorkerPayload stays a function about
// the PROTOCOL rather than about string handling.

// Reads one '\n'-terminated line starting at `pos`. Returns false only at the
// end of the payload; a final line with no terminator is still a line, because a
// worker killed mid-write must be diagnosed rather than silently truncated to
// nothing.
bool workerReadLine(const std::string& s, std::size_t& pos, std::string& line) {
  if (pos >= s.size()) return false;
  const std::size_t nl = s.find('\n', pos);
  if (nl == std::string::npos) {
    line.assign(s, pos, s.size() - pos);
    pos = s.size();
    return true;
  }
  line.assign(s, pos, nl - pos);
  pos = nl + 1;
  return true;
}

// A short, printable rendering of whatever the worker actually said, for a
// diagnostic. The payload can be megabytes of binary mesh; an error string that
// quoted it verbatim would be unreadable and could itself be a memory problem.
std::string workerSnippet(const std::string& s) {
  std::string out;
  const std::size_t n = s.size() < 96 ? s.size() : 96;
  for (std::size_t i = 0; i < n; ++i) {
    const unsigned char c = static_cast<unsigned char>(s[i]);
    out.push_back((c >= 32 && c < 127) ? static_cast<char>(c) : '?');
  }
  if (s.size() > n) out += "...";
  return out;
}

}  // namespace

// ── Bounds ──────────────────────────────────────────────────────────────────
void Bounds::centre(float out[3]) const {
  for (int i = 0; i < 3; ++i) out[i] = 0.5f * (min[i] + max[i]);
}

float Bounds::radius() const {
  if (!valid) return 0.0f;
  float d = 0.0f;
  for (int i = 0; i < 3; ++i) {
    const float e = max[i] - min[i];
    d += e * e;
  }
  return 0.5f * std::sqrt(d);
}

// ── KernelScene ─────────────────────────────────────────────────────────────
KernelScene::KernelScene() = default;

bool KernelScene::build() {
  // The starting part IS a document: the same statements ForgeFrame seeds the
  // PartDocument with, compiled through the same edge every later edit takes.
  // GEOMETRY ONLY -- the history rows are the document's records, which the tree
  // source reads directly; this used to also fill a private SceneFeature vector
  // that ForgeFrame then overwrote with a re-derived copy of the same table.
  return buildFromIr(defaultPartIr());
}

void KernelScene::setDocumentLabel(std::string label) {
  documentLabel_ = label.empty() ? std::string("untitled.fpart") : std::move(label);
}

// -- THE EDGE ---------------------------------------------------------------
// forge::ui's IR program -> forge::ft -> a solid -> triangles -> the viewport.
//
// ONE entry point, TWO ways to reach the kernel. Which one runs is a property of
// the SCENE (was an isolated worker configured?), never of the call site, so no
// caller can forget to ask for isolation and no gate has to be rewritten to get
// it. With no worker configured this is exactly the function it always was.
bool KernelScene::buildFromIr(const std::string& program) {
  if (session_.workerConfigured()) {
    bool fellBack = false;
    const bool ok = buildIsolated(program, fellBack);
    if (!fellBack) return ok;
    // The worker could not be LAUNCHED (missing binary, exhausted process
    // table). That is an isolation failure, not a geometry failure, and refusing
    // to model at all would be worse than modelling unprotected: an application
    // shipped without its worker must still be an application. A crash is NEVER
    // retried here -- re-running it in this process is the outcome the whole
    // mechanism exists to prevent.
    ++isolatedFallbacks_;
  }
  return buildInProcess(program);
}

bool KernelScene::buildInProcess(const std::string& program) {
  report_ = IrBuildReport{};

  // ---- parse, with the KERNEL's parser ------------------------------------
  forge::ft::FeatureTree tree;
  try {
    tree = forge::ft::parse(program);
    report_.parsed = true;
  } catch (const forge::ft::ParseError& e) {
    report_.error = "parse failed at line " + std::to_string(e.line) + ": " + e.what();
    report_.failedLine = e.line;
    error_ = report_.error;
    return false;
  } catch (const std::exception& e) {
    report_.error = std::string("parse failed: ") + e.what();
    error_ = report_.error;
    return false;
  } catch (...) {
    report_.error = "parse failed: a non-std exception escaped forge::ft::parse";
    error_ = report_.error;
    return false;
  }

  // ---- compile it into a solid --------------------------------------------
  //
  // forge::ft::compile is documented "Never throws for a modelling failure".
  // MEASURED FALSE on this build: SHELL(%5, 3) on the default bracket lets an
  // OCCT Standard_ConstructionError escape. That is NOT a std::exception, so a
  // catch (const std::exception&) would miss it and std::terminate would take
  // the whole application down on a menu click. Hence catch (...).
  forge::ft::CompileResult res;
  try {
    // Each independent body gets its own boolean budget window; see
    // Booleans.hpp for why sharing one across a batch is a measured bug.
    forge::resetBooleanBudget();
    res = forge::ft::compile(tree);
  } catch (const std::exception& e) {
    report_.error = std::string("compile threw: ") + e.what();
    error_ = report_.error;
    return false;
  } catch (...) {
    report_.error = "compile threw a non-std exception (an OCCT Standard_Failure)";
    error_ = report_.error;
    return false;
  }

  report_.nDeclared = res.nDeclared;
  report_.nParsed = res.nParsed;
  report_.nCompiled = res.nCompiled;
  report_.failedOpId = res.failedOpId;
  if (!res.ok || res.handle == 0) {
    report_.error = res.error.empty() ? std::string("the kernel produced no solid") : res.error;
    error_ = report_.error;
    return false;
  }
  report_.compiled = true;
  report_.valid = res.valid;
  report_.faceCount = res.faceCount;
  report_.edgeCount = res.edgeCount;
  report_.volume = res.volume;
  for (int i = 0; i < 3; ++i) {
    report_.bboxMin[i] = res.bboxMin[i];
    report_.bboxMax[i] = res.bboxMax[i];
  }

  // ---- tessellate ---------------------------------------------------------
  forge::Mesh mesh;
  try {
    mesh = forge::tessellate(res.handle, kLinearTol, kAngularTol);
  } catch (const std::exception& e) {
    report_.error = std::string("tessellate failed: ") + e.what();
    error_ = report_.error;
    return false;
  } catch (...) {
    report_.error = "tessellate failed: a non-std exception escaped forge::tessellate";
    error_ = report_.error;
    return false;
  }
  if (mesh.indices.empty() || mesh.indices.size() % 3 != 0) {
    report_.error = "tessellate returned no triangles";
    error_ = report_.error;
    return false;
  }

  // ---- de-index into the viewport's vertex stream -------------------------
  // Into a LOCAL buffer: a rebuild that fails must leave the last good body on
  // screen, not half of a new one.
  std::vector<SceneVertex> next;
  std::uint32_t faces = 0;
  std::string why;
  if (!deindex(mesh, next, faces, why)) {
    report_.error = why;
    error_ = why;
    return false;
  }

  vertices_ = std::move(next);
  faceCount_ = faces;
  computeBounds();
  report_.tessellated = true;
  report_.triangles = triangleCount();
  built_ = true;
  error_.clear();
  ++builds_;
  backend_ = "forge::ui -> forge::ft -> forge-kernel (" + std::to_string(res.nCompiled) +
             " ops, " + std::to_string(res.faceCount) + " faces)";
  return true;
}

// ── ★ CRASH ISOLATION: the half that runs the kernel where a fault is survivable
//
// forge-kernel/reports/OCCT_NULL_PCURVE_SEGV.md measured a null Geom2d_Curve
// dereferenced INSIDE OCCT on three paths, on Archie's output AND on the gold
// reference STEP files, and its own self-corrections rule out every cheaper
// remedy: a pre-check on the INPUT cannot work (the crashing shape measured
// nullPcurves=0 — the null is born inside OCCT's merge), `KeepShapes` was tried
// and still SIGSEGV'd all six cases, and the accessor a guard would call,
// BRep_Tool::CurveOnSurface, is itself a faulting frame. A SIGSEGV is also not
// an exception: buildInProcess's catch(...) cannot see a signal.
//
// So the remedy is not a check at all. It is to run the operation where the
// fault is RECOVERABLE, which is a different process. Nothing is refused, no
// geometry is declined, and the most curved, densest trees — the ones the report
// warns a construction-time reject would fire hardest on — take exactly the same
// path as a box.

void KernelScene::useIsolatedWorker(std::vector<std::string> argv,
                                    const forge::ui::GuardLimits& limits) {
  limits_ = limits;
  session_.setLimits(limits_);
  session_.configureWorker(std::move(argv));
}

void KernelScene::setHostPump(HostPump pump) { hostPump_ = std::move(pump); }

bool KernelScene::probeWorker(std::string& error) {
  error.clear();
  if (!session_.workerConfigured()) {
    error = "no isolated kernel worker is configured";
    return false;
  }
  // `--version` and nothing else: the probe must not depend on the kernel, on
  // OCCT or on a document being loadable, or a probe failure would mean six
  // different things. It answers exactly one question — can this binary be
  // launched, and does it speak our protocol.
  std::vector<std::string> argv = session_.workerArgv();
  argv.push_back("--version");

  forge::ui::GuardLimits probeLimits = limits_;
  // A probe runs at startup, in front of the user. It gets its own short
  // deadline rather than the modelling deadline: a worker that needs 30 s to say
  // its own name is a broken worker, and waiting 30 s to find that out is worse
  // than not probing at all.
  probeLimits.deadlineMs = 5000;

  forge::ui::GuardedProcess proc;
  std::string startError;
  if (!proc.start(argv, std::string(), probeLimits, forge::ui::steadyNowMs(), startError)) {
    error = "the kernel worker could not be launched: " + startError;
    return false;
  }
  while (!proc.poll(forge::ui::steadyNowMs())) ::usleep(1000);

  const forge::ui::GuardReport& r = proc.report();
  if (!r.ok()) {
    error = "the kernel worker did not answer --version: " + r.diagnostic;
    return false;
  }
  if (proc.output().find(kWorkerResultMagic) == std::string::npos) {
    error = "the kernel worker answered --version without its protocol magic (got \"" +
            workerSnippet(proc.output()) + "\")";
    return false;
  }
  return true;
}

// Runs the program in the worker and installs the answer.
//
// `fellBack` comes back true ONLY when nothing was started — a missing binary,
// an exhausted process table, a job already running. It is NEVER set after a
// crash: re-running a program that just segfaulted, in this address space, is
// precisely the outcome the isolation exists to prevent.
bool KernelScene::buildIsolated(const std::string& program, bool& fellBack) {
  fellBack = false;

  const std::uint64_t startMs = forge::ui::steadyNowMs();
  if (!session_.submit("rebuild", program, startMs)) {
    fellBack = true;
    return false;
  }
  ++isolatedBuilds_;

  // The wait is BOUNDED by the session's deadline and, when a host pump is
  // installed, also INTERRUPTIBLE: the host draws a frame and may answer "the
  // user pressed Escape" by returning true. Without a pump the loop still never
  // outlives the deadline, so an application that forgets to install one gets a
  // freeze it recovers from rather than a hang it does not.
  for (;;) {
    const std::uint64_t now = forge::ui::steadyNowMs();
    if (session_.pump(now)) break;
    if (!session_.running()) break;
    if (hostPump_ && hostPump_(session_.elapsedMs(now), session_.lastOp().text())) {
      session_.cancel(now);
    }
    ::usleep(1000);  // bounded latency without spinning a core
  }

  if (session_.state() != forge::ui::KernelJobState::Succeeded) {
    // ★ THE WHOLE POINT: the worker died and this process did not. The document,
    // the undo stack, the dock layout and the last good body are all still here.
    // The diagnostic NAMES THE STATEMENT the worker last announced, so what a
    // segfault normally leaves — nothing at all — becomes something a repair
    // loop can act on.
    report_ = IrBuildReport{};
    report_.error = session_.diagnostic();
    error_ = session_.diagnostic();
    return false;
  }

  IrBuildReport decoded;
  std::vector<SceneVertex> next;
  std::string backend;
  std::string why;
  if (!decodeWorkerPayload(session_.result(), decoded, next, backend, why)) {
    // A worker that exits 0 and writes nonsense must be a diagnosis, not a
    // viewport full of noise.
    report_ = IrBuildReport{};
    report_.error = why;
    error_ = why;
    return false;
  }

  report_ = decoded;
  if (!decoded.ok()) {
    // A MODELLING failure is a RESULT, not a crash. The previous geometry stays
    // on screen and the worker's own reason is reported verbatim.
    error_ = decoded.error.empty() ? std::string("the worker reported a failed build")
                                   : decoded.error;
    return false;
  }

  // faceCount_ is RE-DERIVED from the vertex stream by the same rule deindex
  // uses (the maximum faceId), rather than taken from the header field. The two
  // are independent observables over the same build, so a worker whose header
  // and whose mesh disagree is caught here instead of showing a face count that
  // belongs to neither.
  std::uint32_t faces = 0;
  for (const SceneVertex& v : next) faces = std::max(faces, v.faceId);

  vertices_ = std::move(next);
  faceCount_ = faces;
  computeBounds();
  report_.triangles = triangleCount();
  built_ = true;
  error_.clear();
  ++builds_;
  backend_ = backend.empty() ? std::string("isolated kernel worker") : backend;
  return true;
}

// Decodes the worker's answer. Every failure path here produces a SENTENCE,
// because the alternative — a half-installed mesh — is the failure mode that
// looks like a kernel bug and is not one.
bool KernelScene::decodeWorkerPayload(const std::string& payload, IrBuildReport& report,
                                      std::vector<SceneVertex>& verts, std::string& backend,
                                      std::string& error) {
  report = IrBuildReport{};
  verts.clear();
  backend.clear();
  error.clear();

  std::size_t pos = 0;
  std::string line;
  if (!workerReadLine(payload, pos, line)) {
    error = "the kernel worker exited 0 but wrote nothing at all";
    return false;
  }
  if (line != kWorkerResultMagic) {
    error = "the kernel worker's first line was not its result magic (got \"" +
            workerSnippet(line) + "\")";
    return false;
  }

  bool sawErrorBytes = false;
  std::size_t errorBytes = 0;
  while (!sawErrorBytes) {
    if (!workerReadLine(payload, pos, line)) {
      error = "the kernel worker's header ended before it declared errorBytes";
      return false;
    }
    const std::size_t sp = line.find(' ');
    if (sp == std::string::npos) {
      error = "the kernel worker wrote a header line with no value: \"" + workerSnippet(line) + "\"";
      return false;
    }
    const std::string key = line.substr(0, sp);
    const char* val = line.c_str() + sp + 1;

    int i0 = 0;
    long l0 = 0;
    double d0 = 0.0, d1 = 0.0, d2 = 0.0;
    unsigned long long u0 = 0;
    if (key == "parsed" && std::sscanf(val, "%d", &i0) == 1) {
      report.parsed = i0 != 0;
    } else if (key == "compiled" && std::sscanf(val, "%d", &i0) == 1) {
      report.compiled = i0 != 0;
    } else if (key == "tessellated" && std::sscanf(val, "%d", &i0) == 1) {
      report.tessellated = i0 != 0;
    } else if (key == "valid" && std::sscanf(val, "%d", &i0) == 1) {
      report.valid = i0 != 0;
    } else if (key == "failedOpId" && std::sscanf(val, "%d", &i0) == 1) {
      report.failedOpId = i0;
    } else if (key == "failedLine" && std::sscanf(val, "%d", &i0) == 1) {
      report.failedLine = i0;
    } else if (key == "faceCount" && std::sscanf(val, "%ld", &l0) == 1) {
      report.faceCount = l0;
    } else if (key == "edgeCount" && std::sscanf(val, "%ld", &l0) == 1) {
      report.edgeCount = l0;
    } else if (key == "volume" && std::sscanf(val, "%lf", &d0) == 1) {
      report.volume = d0;
    } else if (key == "bboxMin" && std::sscanf(val, "%lf %lf %lf", &d0, &d1, &d2) == 3) {
      report.bboxMin[0] = d0;
      report.bboxMin[1] = d1;
      report.bboxMin[2] = d2;
    } else if (key == "bboxMax" && std::sscanf(val, "%lf %lf %lf", &d0, &d1, &d2) == 3) {
      report.bboxMax[0] = d0;
      report.bboxMax[1] = d1;
      report.bboxMax[2] = d2;
    } else if (key == "nDeclared" && std::sscanf(val, "%llu", &u0) == 1) {
      report.nDeclared = static_cast<std::size_t>(u0);
    } else if (key == "nParsed" && std::sscanf(val, "%llu", &u0) == 1) {
      report.nParsed = static_cast<std::size_t>(u0);
    } else if (key == "nCompiled" && std::sscanf(val, "%llu", &u0) == 1) {
      report.nCompiled = static_cast<std::size_t>(u0);
    } else if (key == "triangles" && std::sscanf(val, "%llu", &u0) == 1) {
      report.triangles = static_cast<std::size_t>(u0);
    } else if (key == "errorBytes" && std::sscanf(val, "%llu", &u0) == 1) {
      errorBytes = static_cast<std::size_t>(u0);
      sawErrorBytes = true;
    } else {
      error = "the kernel worker wrote an unreadable header line: \"" + workerSnippet(line) + "\"";
      return false;
    }
  }

  // The error text is LENGTH-PREFIXED, so a newline inside a kernel message
  // cannot be misread as the start of the next field.
  if (pos + errorBytes > payload.size()) {
    error = "the kernel worker declared " + std::to_string(errorBytes) +
            " error bytes but its output ended after " + std::to_string(payload.size() - pos);
    return false;
  }
  report.error.assign(payload, pos, errorBytes);
  pos += errorBytes;

  if (!workerReadLine(payload, pos, line) || !line.empty()) {
    error = "the kernel worker did not terminate its error block";
    return false;
  }
  if (!workerReadLine(payload, pos, line) || line.rfind("backend ", 0) != 0) {
    error = "the kernel worker did not name its backend";
    return false;
  }
  backend = line.substr(8);

  if (!workerReadLine(payload, pos, line) || line.rfind("VERTICES ", 0) != 0) {
    error = "the kernel worker did not declare its vertex count";
    return false;
  }
  unsigned long long nVerts = 0;
  if (std::sscanf(line.c_str() + 9, "%llu", &nVerts) != 1) {
    error = "the kernel worker's vertex count was unreadable: \"" + workerSnippet(line) + "\"";
    return false;
  }

  const std::size_t want = static_cast<std::size_t>(nVerts) * sizeof(SceneVertex);
  const std::size_t have = payload.size() - pos;
  if (have != want) {
    // Not >=. A short read is a truncated mesh and a long one means the stream
    // desynchronised; both are the same defect and neither may be rendered.
    error = "the kernel worker declared " + std::to_string(nVerts) + " vertices (" +
            std::to_string(want) + " bytes) but sent " + std::to_string(have);
    return false;
  }
  // A vertex stream is three vertices per triangle. A count that is not a whole
  // number of triangles cannot be drawn, and would otherwise reach the viewport
  // as a dropped or garbled last triangle.
  if ((nVerts % 3ull) != 0ull) {
    error = "the kernel worker sent " + std::to_string(nVerts) +
            " vertices, which is not a whole number of triangles";
    return false;
  }
  verts.resize(static_cast<std::size_t>(nVerts));
  if (want > 0) std::memcpy(verts.data(), payload.data() + pos, want);
  return true;
}

bool KernelScene::deindex(const forge::Mesh& mesh, std::vector<SceneVertex>& out,
                          std::uint32_t& faceCount, std::string& error) const {
  const std::size_t triCount = mesh.indices.size() / 3;
  const bool haveFaceIds = mesh.faceIds.size() == triCount;
  const bool haveNormals = mesh.normals.size() == mesh.positions.size();
  out.assign(triCount * 3, SceneVertex{});
  faceCount = 0;

  for (std::size_t t = 0; t < triCount; ++t) {
    const std::uint32_t faceId = haveFaceIds ? mesh.faceIds[t] : 0u;
    faceCount = std::max(faceCount, faceId);

    // Geometric normal, used when the kernel supplied none, and as the fallback
    // for a degenerate vertex normal.
    float p[3][3] = {};
    for (int c = 0; c < 3; ++c) {
      const std::uint32_t vi = mesh.indices[t * 3 + static_cast<std::size_t>(c)];
      const std::size_t base = static_cast<std::size_t>(vi) * 3;
      if (base + 2 >= mesh.positions.size()) {
        error = "tessellate produced an out-of-range index";
        return false;
      }
      p[c][0] = mesh.positions[base + 0];
      p[c][1] = mesh.positions[base + 1];
      p[c][2] = mesh.positions[base + 2];
    }
    float e1[3] = {p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]};
    float e2[3] = {p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]};
    float gn[3] = {e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2],
                   e1[0] * e2[1] - e1[1] * e2[0]};
    normalize3(gn);

    for (int c = 0; c < 3; ++c) {
      const std::uint32_t vi = mesh.indices[t * 3 + static_cast<std::size_t>(c)];
      const std::size_t base = static_cast<std::size_t>(vi) * 3;
      SceneVertex& v = out[t * 3 + static_cast<std::size_t>(c)];
      v.px = p[c][0];
      v.py = p[c][1];
      v.pz = p[c][2];
      if (haveNormals) {
        float n[3] = {mesh.normals[base + 0], mesh.normals[base + 1], mesh.normals[base + 2]};
        const float len2 = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
        if (len2 > 1e-12f) {
          normalize3(n);
          v.nx = n[0];
          v.ny = n[1];
          v.nz = n[2];
        } else {
          v.nx = gn[0];
          v.ny = gn[1];
          v.nz = gn[2];
        }
      } else {
        v.nx = gn[0];
        v.ny = gn[1];
        v.nz = gn[2];
      }
      v.faceId = faceId;
      v.flags = 0;
    }
  }
  error.clear();
  return true;
}

void KernelScene::computeBounds() {
  bounds_ = Bounds{};
  if (vertices_.empty()) return;
  bounds_.min[0] = bounds_.max[0] = vertices_[0].px;
  bounds_.min[1] = bounds_.max[1] = vertices_[0].py;
  bounds_.min[2] = bounds_.max[2] = vertices_[0].pz;
  for (const SceneVertex& v : vertices_) {
    const float p[3] = {v.px, v.py, v.pz};
    for (int i = 0; i < 3; ++i) {
      bounds_.min[i] = std::min(bounds_.min[i], p[i]);
      bounds_.max[i] = std::max(bounds_.max[i], p[i]);
    }
  }
  bounds_.valid = true;
}

// Möller–Trumbore, 1997. Non-culling variant: a CAD pick must hit a back face
// too, because the camera can be inside a shelled body.
PickResult KernelScene::pick(const float origin[3], const float direction[3]) const {
  PickResult best;
  float bestT = 0.0f;
  const std::size_t tris = triangleCount();
  for (std::size_t t = 0; t < tris; ++t) {
    const SceneVertex& a = vertices_[t * 3 + 0];
    const SceneVertex& b = vertices_[t * 3 + 1];
    const SceneVertex& c = vertices_[t * 3 + 2];
    const float e1[3] = {b.px - a.px, b.py - a.py, b.pz - a.pz};
    const float e2[3] = {c.px - a.px, c.py - a.py, c.pz - a.pz};
    const float pv[3] = {direction[1] * e2[2] - direction[2] * e2[1],
                         direction[2] * e2[0] - direction[0] * e2[2],
                         direction[0] * e2[1] - direction[1] * e2[0]};
    const float det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
    if (std::fabs(det) < 1e-12f) continue;  // ray parallel to the triangle
    const float inv = 1.0f / det;
    const float tv[3] = {origin[0] - a.px, origin[1] - a.py, origin[2] - a.pz};
    const float u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
    if (u < 0.0f || u > 1.0f) continue;
    const float qv[3] = {tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2],
                         tv[0] * e1[1] - tv[1] * e1[0]};
    const float v = (direction[0] * qv[0] + direction[1] * qv[1] + direction[2] * qv[2]) * inv;
    if (v < 0.0f || u + v > 1.0f) continue;
    const float hitT = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
    if (hitT <= 1e-6f) continue;  // behind the eye
    if (!best.hit() || hitT < bestT) {
      bestT = hitT;
      best.faceId = a.faceId != 0 ? a.faceId : 1u;
      best.distance = hitT;
      for (int i = 0; i < 3; ++i) best.point[i] = origin[i] + direction[i] * hitT;
    }
  }
  return best;
}

std::size_t KernelScene::applySelection(const std::vector<std::uint32_t>& selectedFaceIds) {
  std::size_t changed = 0;
  for (SceneVertex& v : vertices_) {
    const bool sel = std::find(selectedFaceIds.begin(), selectedFaceIds.end(), v.faceId) !=
                     selectedFaceIds.end();
    const std::uint32_t want = sel ? (v.flags | 1u) : (v.flags & ~1u);
    if (want != v.flags) {
      v.flags = want;
      ++changed;
    }
  }
  return changed;
}

// ── SceneFeatureTreeSource ────────────────────────────────────────
//
// Node id encoding, chosen so childAt/rootId stay O(1) and allocation-free:
//   1                       = the document root
//   2 + i                   = the document's i-th FeatureRecord
//   1000 + faceId           = the B-rep face with that 1-based id
namespace {
constexpr forge::ui::NodeId kRootNode = 1;
constexpr forge::ui::NodeId kFeatureBase = 2;
constexpr forge::ui::NodeId kFaceBase = 1000;
}  // namespace

SceneFeatureTreeSource::SceneFeatureTreeSource(const KernelScene& scene,
                                               const forge::ui::PartDocument& document)
    : scene_(scene), document_(document) {}

std::size_t SceneFeatureTreeSource::featureCount() const noexcept {
  return document_.records().size();
}

forge::ui::NodeId SceneFeatureTreeSource::rootId() const { return kRootNode; }

std::size_t SceneFeatureTreeSource::childCount(forge::ui::NodeId parent) const {
  const std::size_t features = featureCount();
  if (parent == kRootNode) return features;
  if (features > 0 && parent >= kFeatureBase && parent < kFeatureBase + features) {
    // Only the LAST feature owns the resulting body's faces.
    if (parent == kFeatureBase + features - 1) return scene_.faceCount();
    return 0;
  }
  return 0;
}

forge::ui::NodeId SceneFeatureTreeSource::childAt(forge::ui::NodeId parent,
                                                  std::size_t index) const {
  if (parent == kRootNode) return kFeatureBase + static_cast<forge::ui::NodeId>(index);
  return kFaceBase + static_cast<forge::ui::NodeId>(index) + 1;
}

forge::ui::NodeId SceneFeatureTreeSource::nodeForFeature(std::size_t index) const {
  return kFeatureBase + static_cast<forge::ui::NodeId>(index);
}

const forge::ui::FeatureRecord* SceneFeatureTreeSource::recordAt(forge::ui::NodeId id) const {
  const std::vector<forge::ui::FeatureRecord>& records = document_.records();
  if (id < kFeatureBase || id >= kFeatureBase + records.size()) return nullptr;
  return &records[static_cast<std::size_t>(id - kFeatureBase)];
}

forge::ui::FeatureNodeData SceneFeatureTreeSource::data(forge::ui::NodeId id) const {
  ++fetches_;  // this is the EXPENSIVE call the virtualization exists to bound
  forge::ui::FeatureNodeData d;
  d.id = id;
  if (id == kRootNode) {
    d.label = scene_.documentLabel();
    d.iconKey = "document";
    d.featureIrOp = "DOCUMENT";
    return d;
  }
  if (const forge::ui::FeatureRecord* rec = recordAt(id)) {
    // THE ROW IS THE STATEMENT. Everything below is read off the record the
    // document holds -- no copy, no setter, nothing to forget to refresh.
    d.label = rec->label.empty() ? rec->line.op : rec->label;
    d.iconKey = rec->line.op;
    d.featureIrOp = rec->line.op;
    // A row is in error when the last rebuild named it, or when a rebuild that
    // failed before naming an op leaves every statement unaccounted for.
    const IrBuildReport& r = scene_.lastBuild();
    const bool named = (r.failedOpId == rec->irId) || (r.failedLine == rec->irId);
    d.state = (r.ok() || !named) ? forge::ui::FeatureState::Ok : forge::ui::FeatureState::Error;
    return d;
  }
  const std::uint32_t faceId = static_cast<std::uint32_t>(id - kFaceBase);
  d.label = "Face " + std::to_string(faceId);
  d.iconKey = "face";
  d.featureIrOp = "FACE";
  return d;
}

int SceneFeatureTreeSource::featureIrIdOf(forge::ui::NodeId id) const {
  // The row count comes from the DOCUMENT, not from a second history on the
  // scene: KernelScene::features() was removed when the rows became the IR
  // statements themselves (see the header note above the class). This call site
  // was the one left behind, and nothing caught it because at the time NO CI
  // job compiled the forge-desktop project. One does now: the `desktop` job in
  // .github/workflows/kernel-tests.yml, whose negative control is this exact
  // call site. featureCount() is document_.records().size(), which is the same
  // number childCount() bounds the feature rows by.
  const std::size_t features = featureCount();
  if (id < kFeatureBase || id >= kFeatureBase + features) return 0;
  return static_cast<int>(id - kFeatureBase) + 1;
}

std::uint32_t SceneFeatureTreeSource::faceIdOf(forge::ui::NodeId id) const {
  if (id < kFaceBase) return 0;
  return static_cast<std::uint32_t>(id - kFaceBase);
}

forge::ui::NodeId SceneFeatureTreeSource::nodeForFace(std::uint32_t faceId) const {
  return kFaceBase + faceId;
}

}  // namespace forge::desktop
