#include "FileExchangeHost.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <exception>
#include <fstream>
#include <ios>
#include <iterator>
#include <string>
#include <vector>

#include "KernelScene.hpp"

#include "forge/Booleans.hpp"
#include "forge/DirectEdit.hpp"
#include "forge/DirectModeling.hpp"
#include "forge/IoExchange.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/Tessellate.hpp"
#include "forge/Transform.hpp"
#include "forge/ft/FeatureTree.hpp"

namespace forge::desktop {
namespace {

using forge::ui::ExchangeFormat;
using forge::ui::ExchangeRefusal;
using forge::ui::ExchangeReport;

// The tessellation the observables are integrated over. FINER than the 0.3 / 0.6
// forge::ft::compile uses for its own bounding box, and the difference is
// MEASURED rather than chosen: a chord cuts inside a convex curved surface, so
// the mesh integral under-reports a curved solid, and at 0.3 / 0.6 that is
//
//   torus -4.17%   sphere -3.08%   cone -0.83%   bracket +0.002%   chamfered 0%
//
// A number shown to a user that is 4% wrong on a torus is not a measurement. At
// 0.02 / 0.05 the same five read
//
//   torus -0.31%   sphere -0.23%   cone -0.05%   bracket +0.004%   chamfered 0%
//
// and at the 0.05 / 0.10 actually used here
//
//   torus -0.80%   sphere -0.26%   cone -0.06%   bracket +0.016%   chamfered 0%
//
// which is what makes the gate's 1% cross-check against forge::ft::compile's
// ANALYTIC volume a real check rather than a tolerance widened until it passed.
// 0.02 / 0.05 would be three times better again (-0.31% worst) and costs 64 s of
// gate time against 6 s; the gate runs six times in CI, so the finer setting was
// measured and NOT taken. What would remove the approximation entirely is the
// analytic forge::massProperties, and that is unusable here for the reason above.
constexpr double kMeasureLinearTol = 0.05;
constexpr double kMeasureAngularTol = 0.10;

// A path that carries a newline cannot be quoted into a one-line message and
// cannot survive the worker's first-line input pragma. It is refused as an
// unfindable file, with the path left OUT of the sentence -- putting it in would
// break the sentence across lines, which is the very thing being guarded.
bool pathIsOneLine(const std::string& path) {
  return path.find('\n') == std::string::npos && path.find('\r') == std::string::npos;
}

long long fileBytes(const std::string& path) {
  std::ifstream in(path, std::ios::binary | std::ios::ate);
  if (!in) return -1;
  return static_cast<long long>(in.tellg());
}

// The first `n` bytes, or fewer. Empty when the file cannot be opened at all --
// which the caller distinguishes from "opened and empty" by checking existence
// separately, because those are different refusals.
std::string peek(const std::string& path, std::size_t n) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return std::string();
  std::string buf(n, '\0');
  in.read(&buf[0], static_cast<std::streamsize>(n));
  buf.resize(static_cast<std::size_t>(in.gcount()));
  return buf;
}

// ── does this file hold the format the command asked for? ───────────────────
// The SAME content sniff FeatureTreeCompiler::opInput performs, deliberately:
// the app and the kernel must agree about what a STEP file is, or the app offers
// a file the compiler will then reject. Content, never the extension -- a file
// called part.step containing an STL is an STL.
bool contentMatches(const std::string& path, ExchangeFormat format) {
  const std::string head = peek(path, 512);
  if (head.empty()) return false;
  switch (format) {
    case ExchangeFormat::Step:
      return head.find("ISO-10303") != std::string::npos;
    case ExchangeFormat::Brep:
      return head.rfind("DBRep_DrawableShape", 0) == 0 ||
             head.find("CASCADE Topology") != std::string::npos;
    case ExchangeFormat::Stl: {
      if (head.rfind("solid", 0) == 0 || head.find("facet normal") != std::string::npos) {
        return true;
      }
      // Binary STL: an 80-byte header, a uint32 triangle count, then exactly
      // 50 bytes per triangle. The size arithmetic is the check -- a magic
      // number does not exist for binary STL, so anything else would be a guess.
      const long long size = fileBytes(path);
      if (size <= 84) return false;
      const std::string countBytes = peek(path, 84);
      if (countBytes.size() < 84) return false;
      std::uint32_t triangles = 0;
      for (int i = 0; i < 4; ++i) {
        triangles |= static_cast<std::uint32_t>(
                         static_cast<unsigned char>(countBytes[80 + static_cast<std::size_t>(i)]))
                     << (8 * i);
      }
      return 84LL + 50LL * static_cast<long long>(triangles) == size;
    }
    case ExchangeFormat::Iges:
      // An IGES record is 80 columns and the section letter is column 73. The
      // first record of every conforming file is a Start record, so column 73
      // of the first line is 'S'.
      return head.size() >= 73 && head[72] == 'S';
  }
  return false;
}

// ── ★ IS THE FILE WHOLE? ────────────────────────────────────────────────────
// MEASURED, and this is the reason the check exists rather than a precaution: a
// BREP file truncated to half its length makes forge::io::importBrep SEGFAULT --
// exit 139, no exception, no message, the process gone. A truncated CAD file is
// also the most ordinary corruption there is (an interrupted copy, a download
// that stopped, a save that lost power), so "the reader will complain" is not an
// answer a user-facing Open may rely on.
//
// Both formats declare their own end, so the check is exact rather than a
// heuristic:
//   STEP  ISO-10303-21 part files terminate with `END-ISO-10303-21;`.
//   BREP  the header declares `TShapes <n>` and every shape record ends with a
//         line whose last non-space character is `*`. Counting them and
//         comparing with n is the format's own statement about its own length.
//         (Verified on the app's default bracket: `TShapes 72`, and 18 lines
//         that are exactly `*` plus 54 ending in ` *` -- 72.)
// STL is not checked here: it is not offered for import (see ui/src/FileExchange.cpp).
bool contentIsComplete(const std::string& path, ExchangeFormat format) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return false;
  if (format == ExchangeFormat::Step) {
    std::string all((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    return all.find("END-ISO-10303-21") != std::string::npos;
  }
  if (format != ExchangeFormat::Brep) return true;

  long long declared = -1;
  long long seen = 0;
  std::string line;
  while (std::getline(in, line)) {
    while (!line.empty() && (line.back() == '\r' || line.back() == ' ' || line.back() == '\t')) {
      line.pop_back();
    }
    if (declared < 0) {
      if (line.rfind("TShapes ", 0) == 0) {
        declared = std::atoll(line.c_str() + 8);
      }
      continue;
    }
    if (!line.empty() && line.back() == '*') ++seen;
  }
  // No TShapes header at all is not "complete", it is not a BREP file we can
  // reason about -- and the caller has already established the magic matched,
  // so the header is missing because the file was cut before it.
  return declared >= 0 && seen >= declared;
}

// ── the VECTOR of observables ───────────────────────────────────────────────
// Volume AND area AND centre of mass AND bounding box AND the per-kind face
// census AND the face/edge counts. Never one of them: this programme has
// measured four separate cases of a wrong solid reproducing a right volume, and
// one where no single observable caught the defect at all.
//
// ── ★ WHY THESE ARE INTEGRATED HERE AND NOT READ FROM forge::massProperties ──
// MEASURED on this tree, and it is a defect in the kernel's gate handling rather
// than in this file:
//
//   forge::ft::compile() saves ONE bit -- forgeNativeBrepEnabled() -- forces the
//   native surface off for the build, and restores by calling
//   setForgeNativeBrepEnabled(prev), which WRITES ALL FOUR overrides (core,
//   features, step, interference). The features gate is documented "NOT triggered
//   by FORGE_NATIVE_BREP -- its own opt-in (kept OFF in Wave 1)" and reads 0
//   before any compile. After ONE compile it reads 1, for the life of the process.
//
//   With that gate on, forge::massProperties routes an OCCT-backed handle through
//   importOcctSolid + the native integrator. On the app's own default bracket
//   that returns volume 11514.789967 where the analytic answer is 77583.539933
//   (-85.2%), and a centre of mass of (-1.37e34, -8.53e33, 67.38) where the true
//   one is (0, 0, 10).
//
// So `massProperties` answers differently depending on WHETHER A COMPILE HAS EVER
// RUN in this process. A file-exchange report is shown to a user and compared by a
// gate, and neither can depend on process history. The integrals below are over
// the TESSELLATION -- the same mesh the viewport draws -- so they are computed
// from geometry this file can see, with no global state involved, and the same
// instrument measures both arms of a round trip. They are approximations at the
// tessellation deflection, and the gate cross-checks them against the analytic
// volume forge::ft::compile reports from inside its own guard.
void measure(forge::ShapeHandle handle, ExchangeReport& report) {
  try {
    report.faceCount = static_cast<long>(forge::direct::faceCount(handle));
  } catch (...) {
  }
  try {
    report.edgeCount = static_cast<long>(forge::direct::edgeCount(handle));
  } catch (...) {
  }
  try {
    for (const forge::FaceInfo& face : forge::faceInventory(handle)) {
      ++report.faceKinds[face.kind];
    }
  } catch (...) {
  }
  try {
    const forge::Mesh mesh = forge::tessellate(handle, kMeasureLinearTol, kMeasureAngularTol);
    double lo[3] = {1e300, 1e300, 1e300};
    double hi[3] = {-1e300, -1e300, -1e300};
    for (std::size_t i = 0; i + 2 < mesh.positions.size(); i += 3) {
      for (int k = 0; k < 3; ++k) {
        const double v = static_cast<double>(mesh.positions[i + static_cast<std::size_t>(k)]);
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    if (lo[0] <= hi[0]) {
      for (int k = 0; k < 3; ++k) {
        report.bboxMin[k] = lo[k];
        report.bboxMax[k] = hi[k];
      }
    }

    // Divergence theorem over the closed triangle set: the signed volume of the
    // tetrahedron each triangle forms with the origin. Exact for a closed mesh,
    // and the same sum gives the first moment, hence the centroid. An OPEN shell
    // (what an STL import produces) gives a signed sum that is only meaningful if
    // the shell happens to close -- which is why the gate treats STL separately.
    double volume6 = 0.0;
    double moment[3] = {0.0, 0.0, 0.0};
    double area2 = 0.0;
    for (std::size_t t = 0; t + 2 < mesh.indices.size(); t += 3) {
      double p[3][3];
      bool bad = false;
      for (int c = 0; c < 3; ++c) {
        const std::size_t base = static_cast<std::size_t>(mesh.indices[t + static_cast<std::size_t>(c)]) * 3;
        if (base + 2 >= mesh.positions.size()) { bad = true; break; }
        for (int k = 0; k < 3; ++k) p[c][k] = static_cast<double>(mesh.positions[base + static_cast<std::size_t>(k)]);
      }
      if (bad) continue;
      const double cross[3] = {p[1][1] * p[2][2] - p[1][2] * p[2][1],
                               p[1][2] * p[2][0] - p[1][0] * p[2][2],
                               p[1][0] * p[2][1] - p[1][1] * p[2][0]};
      const double det = p[0][0] * cross[0] + p[0][1] * cross[1] + p[0][2] * cross[2];
      volume6 += det;
      for (int k = 0; k < 3; ++k) moment[k] += det * (p[0][k] + p[1][k] + p[2][k]);
      const double e1[3] = {p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]};
      const double e2[3] = {p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]};
      const double n[3] = {e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2],
                           e1[0] * e2[1] - e1[1] * e2[0]};
      area2 += std::sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    }
    report.volume = std::fabs(volume6) / 6.0;
    report.area = area2 / 2.0;
    if (std::fabs(volume6) > 1e-12) {
      // moment above is sum(det * (p0+p1+p2)); the tetra centroid is
      // (p0+p1+p2+origin)/4, so the first moment is det/6 * (p0+p1+p2)/4.
      for (int k = 0; k < 3; ++k) report.centreOfMass[k] = moment[k] / (4.0 * volume6);
    }
  } catch (...) {
  }
}

void refuse(ExchangeReport& report, ExchangeRefusal refusal, ExchangeFormat format,
            const std::string& path) {
  report.ok = false;
  report.refusal = refusal;
  report.message = forge::ui::exchangeMessage(refusal, format, path);
}

// ── the write, and the deliberate ways to break it ──────────────────────────
bool writeShape(forge::ShapeHandle handle, const std::string& path, ExchangeFormat format) {
  switch (format) {
    case ExchangeFormat::Step: return forge::io::exportStep(handle, path);
    case ExchangeFormat::Brep: return forge::io::exportBrep(handle, path);
    case ExchangeFormat::Stl:  return forge::io::exportStl(handle, path);
    case ExchangeFormat::Iges: return false;  // forge::io::exportIges refuses; see the header
  }
  return false;
}

void damageFile(const std::string& path, FileExchangeHost::WriteMutation mutation) {
  if (mutation == FileExchangeHost::WriteMutation::Truncate) {
    std::string all;
    {
      std::ifstream in(path, std::ios::binary);
      all.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    }
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out.write(all.data(), static_cast<std::streamsize>(all.size() / 2));
    return;
  }
  if (mutation == FileExchangeHost::WriteMutation::EmptyFile) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    return;
  }
  if (mutation == FileExchangeHost::WriteMutation::ZeroBody) {
    std::string all;
    {
      std::ifstream in(path, std::ios::binary);
      all.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    }
    // Keep the header so the file still LOOKS like the format it claims, which
    // is the interesting case: a reader that trusts the magic bytes passes it.
    for (std::size_t i = all.size() / 4; i < all.size(); ++i) all[i] = ' ';
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out.write(all.data(), static_cast<std::streamsize>(all.size()));
  }
}

}  // namespace

FileExchangeHost::FileExchangeHost(const forge::ui::PartDocument& document, KernelScene* scene)
    : document_(document), scene_(scene) {}

bool FileExchangeHost::importFile(const std::string& path, ExchangeFormat format,
                                  ExchangeReport& report) {
  report = ExchangeReport{};
  if (!pathIsOneLine(path)) {
    refuse(report, ExchangeRefusal::FileMissing, format, std::string());
    return false;
  }
  if (fileBytes(path) < 0) {
    refuse(report, ExchangeRefusal::FileMissing, format, path);
    return false;
  }
  if (!contentMatches(path, format)) {
    refuse(report, ExchangeRefusal::WrongContents, format, path);
    return false;
  }
  if (!contentIsComplete(path, format)) {
    refuse(report, ExchangeRefusal::Truncated, format, path);
    return false;
  }

  forge::ShapeHandle handle = 0;
  try {
    switch (format) {
      case ExchangeFormat::Step: handle = forge::io::importStep(path); break;
      case ExchangeFormat::Brep: handle = forge::io::importBrep(path); break;
      case ExchangeFormat::Stl:  handle = forge::io::importStl(path); break;
      case ExchangeFormat::Iges: handle = forge::io::importIges(path); break;
    }
  } catch (const std::exception&) {
    // The kernel's sentence is DISCARDED, not forwarded: it names OCCT toolkits
    // and forge::io entry points. The refusal below is the fact; the sentence is
    // forge::ui's.
    handle = 0;
  } catch (...) {
    handle = 0;
  }
  if (handle == 0 || handle == forge::kInvalidHandle) {
    refuse(report, ExchangeRefusal::NoSolid, format, path);
    return false;
  }
  // The SAME normalisation opInput performs, so what the app measures here and
  // what the compiler puts in the document are one shape. Without it a body
  // imported through the native bridge has its analytic faces split into strips
  // and the face census reported to the user is not the one the document holds.
  try {
    handle = forge::unifyFaces(handle);
  } catch (...) {
  }

  measure(handle, report);
  report.bytes = fileBytes(path);
  report.ok = true;
  report.refusal = ExchangeRefusal::None;
  report.message = forge::ui::exchangeSuccessMessage(true, format, path);

  // Bind it: this is what makes the document's `INPUT()` mean this file.
  inputFile_ = path;
  if (scene_ != nullptr) scene_->setInputFile(path);
  return true;
}

bool FileExchangeHost::exportFile(const std::string& path, ExchangeFormat format,
                                  ExchangeReport& report) {
  report = ExchangeReport{};
  if (!pathIsOneLine(path)) {
    refuse(report, ExchangeRefusal::WriteFailed, format, std::string());
    return false;
  }
  if (!forge::ui::canExport(format)) {
    refuse(report, ExchangeRefusal::CannotWrite, format, path);
    return false;
  }

  // ── SAVE WHAT YOU SEE ───────────────────────────────────────────────────
  // The document's own feature-IR program, compiled through the same
  // parse -> compile the viewport is built from, with the same input file bound.
  // There is no second geometry path and no cached handle: a cached one can be
  // stale, and "the file I saved is not the part on screen" is the worst defect
  // a Save can have.
  const std::string program = document_.irProgram();
  if (program.empty()) {
    refuse(report, ExchangeRefusal::NoDocument, format, path);
    return false;
  }

  forge::ft::CompileResult built;
  try {
    forge::resetBooleanBudget();
    const forge::ft::FeatureTree tree = forge::ft::parse(program);
    built = forge::ft::compile(tree, inputFile_);
  } catch (...) {
    refuse(report, ExchangeRefusal::BuildFailed, format, path);
    return false;
  }
  if (!built.ok || built.handle == 0) {
    refuse(report, ExchangeRefusal::BuildFailed, format, path);
    return false;
  }

  forge::ShapeHandle toWrite = built.handle;
  if (mutation_ == WriteMutation::Translate) {
    try {
      toWrite = forge::translate(toWrite, 37.0, -11.0, 5.0);
    } catch (...) {
    }
  } else if (mutation_ == WriteMutation::SameVolumeCube) {
    try {
      // The cube's size and placement come from the MESH INTEGRAL, not from
      // forge::massProperties. Using the latter is how this mutation first
      // aborted the process: after a compile it reports a centre of mass of
      // (-1.4e34, -8.5e33, 67.4) for this body, and translating a box by 1e34
      // trips an internal assertion ("edge already has two coedges").
      ExchangeReport ref;
      measure(built.handle, ref);
      const double side = std::cbrt(ref.volume > 0.0 ? ref.volume : 1.0);
      // Built through the IR compiler so the cube is an OCCT-backed body like the
      // one it replaces -- the mutation must change the SHAPE, not the backend.
      const forge::ft::FeatureTree cube =
          forge::ft::parse("%1 = BOX(" + std::to_string(side) + ", " + std::to_string(side) +
                           ", " + std::to_string(side) + ")\n");
      const forge::ft::CompileResult cubeBuilt = forge::ft::compile(cube);
      if (cubeBuilt.ok && cubeBuilt.handle != 0) {
        toWrite = forge::translate(cubeBuilt.handle, ref.centreOfMass[0] - side / 2.0,
                                   ref.centreOfMass[1] - side / 2.0,
                                   ref.centreOfMass[2] - side / 2.0);
      }
    } catch (...) {
    }
  }

  bool wrote = false;
  try {
    wrote = writeShape(toWrite, path, format);
  } catch (...) {
    wrote = false;
  }
  if (!wrote) {
    refuse(report, ExchangeRefusal::WriteFailed, format, path);
    return false;
  }
  if (mutation_ == WriteMutation::Truncate || mutation_ == WriteMutation::EmptyFile ||
      mutation_ == WriteMutation::ZeroBody) {
    damageFile(path, mutation_);
  }

  // ── the report describes THE DOCUMENT, not the bytes ────────────────────
  // Deliberate, and it is what makes the round-trip gate able to fail. This is
  // the application saying "here is what I believe I just saved". A gate reads
  // the file back and compares. Measuring `toWrite` instead would make the
  // report agree with the file BY CONSTRUCTION -- including when the write is
  // deliberately broken -- and the comparison would be a tautology.
  measure(built.handle, report);
  report.bytes = fileBytes(path);
  report.ok = true;
  report.refusal = ExchangeRefusal::None;
  report.message = forge::ui::exchangeSuccessMessage(false, format, path);
  return true;
}

}  // namespace forge::desktop
