#include "StudyHost.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <string>
#include <vector>

#include "forge/Booleans.hpp"
#include "forge/Fea.hpp"
#include "forge/ft/FeatureTree.hpp"

namespace forge::desktop {

namespace {

// The document works in millimetres; the solver works in metres.
constexpr double kMmPerM = 1000.0;

// The nodes the mesher tagged as lying on one side of the bounding box. The
// bitfield is the mesher's, not ours -- see StudyModel.hpp.
std::vector<std::uint32_t> nodeIdsOnSide(const forge::fea::Mesh& mesh,
                                         forge::ui::StudyFace face) {
  const std::uint32_t bit = forge::ui::studyFaceBit(face);
  std::vector<std::uint32_t> ids;
  for (std::size_t i = 0; i < mesh.nodeToFace.size(); ++i) {
    if ((mesh.nodeToFace[i] & bit) != 0u) ids.push_back(static_cast<std::uint32_t>(i));
  }
  return ids;
}

double planeOf(const double bboxMin[3], const double bboxMax[3], forge::ui::StudyFace face) {
  const int axis = forge::ui::studyFaceAxis(face);
  return forge::ui::studyFaceIsMax(face) ? bboxMax[axis] : bboxMin[axis];
}

}  // namespace

double studyElementSizeMm(double longestSideMm, int divisions) noexcept {
  if (!(longestSideMm > 0.0) || divisions <= 0) return 0.0;
  return longestSideMm / static_cast<double>(divisions);
}

forge::ui::StudyOutcome runStudy(const StudyRequest& request, std::string& detail) {
  forge::ui::StudyOutcome out;
  detail.clear();

  const forge::ui::ElasticProperties* elastic =
      forge::ui::elasticPropertiesFor(request.study.materialId);
  {
    // The blocker the study can be refused on WITHOUT touching the kernel is
    // asked first and asked by the shared function, so the panel's "why the Run
    // button is off" and this function's refusal cannot drift apart.
    const std::string blocked = forge::ui::studyBlocker(request.study, !request.irProgram.empty());
    if (!blocked.empty()) {
      out.blocker = blocked;
      return out;
    }
  }
  if (elastic == nullptr) {
    // studyBlocker() already refuses this; kept because dereferencing on the
    // strength of another function's promise is how a null gets read once the
    // two are edited apart.
    out.blocker = "Choose a material for this part first.";
    return out;
  }

  // ── the part, compiled from the document's own history ────────────────────
  forge::ft::FeatureTree tree;
  forge::ft::CompileResult compiled;
  try {
    tree = forge::ft::parse(request.irProgram);
    forge::resetBooleanBudget();
    compiled = forge::ft::compile(tree, request.inputFile);
  } catch (const std::exception& e) {
    detail = std::string("study compile threw: ") + e.what();
    out.blocker = "Forge could not rebuild this part to test it. The part on screen is the last "
                  "one that built.";
    return out;
  } catch (...) {
    detail = "study compile threw a non-standard failure";
    out.blocker = "Forge could not rebuild this part to test it. The part on screen is the last "
                  "one that built.";
    return out;
  }
  if (!compiled.ok || compiled.handle == 0) {
    detail = compiled.error.empty() ? std::string("the kernel produced no solid") : compiled.error;
    out.blocker = "Forge could not rebuild this part to test it, so there was nothing to hold or "
                  "to push on.";
    return out;
  }

  double span[3];
  for (int i = 0; i < 3; ++i) span[i] = compiled.bboxMax[i] - compiled.bboxMin[i];
  const double longest = std::max(span[0], std::max(span[1], span[2]));
  if (!(longest > 0.0)) {
    out.blocker = "This part has no size to speak of, so there is nothing to test.";
    return out;
  }
  const double elemMm = studyElementSizeMm(longest, request.study.divisions);
  out.elementSizeMm = elemMm;

  // How much work the mesher is about to be asked for. Refusing a study that
  // would freeze the application for minutes beats starting one.
  {
    double cells = 1.0;
    for (int i = 0; i < 3; ++i) {
      const double n = std::max(1.0, std::floor(span[i] / elemMm + 0.5));
      cells *= n;
    }
    if (cells > static_cast<double>(kMaxStudyCells)) {
      out.blocker = "That is a finer mesh than this part can be tested with in one go. Lower the "
                    "number of elements across the part and run it again.";
      return out;
    }
  }

  // ── the mesh ──────────────────────────────────────────────────────────────
  forge::fea::Mesh mesh;
  try {
    mesh = forge::fea::meshFromBRep(compiled.handle, elemMm);
  } catch (const std::exception& e) {
    detail = std::string("mesh failed: ") + e.what();
    out.blocker = "Forge could not divide this part into pieces to test it.";
    return out;
  } catch (...) {
    detail = "mesh failed with a non-standard failure";
    out.blocker = "Forge could not divide this part into pieces to test it.";
    return out;
  }

  const std::size_t nNodes = mesh.nodes.size() / 3;
  const std::size_t nElems =
      mesh.elemNodeCount > 0 ? mesh.tets.size() / mesh.elemNodeCount : 0;
  if (nNodes == 0 || nElems == 0) {
    out.blocker = "Forge could not fit a single test element inside this part. Raise the number "
                  "of elements across the part and run it again.";
    return out;
  }
  if (mesh.nodeToFace.size() != nNodes) {
    detail = "mesh side tags do not match its node count";
    out.blocker = "Forge could not work out which mesh points sit on which side of this part.";
    return out;
  }
  out.meshNodes = nNodes;
  out.meshElements = nElems;
  out.freedoms = nNodes * 3;

  // ── the restraints, as node sets counted off that mesh ─────────────────────
  std::vector<forge::fea::BCPinned> bcs;
  for (const forge::ui::Restraint& r : request.study.restraints) {
    forge::ui::FaceCensus census;
    census.face = r.face;
    census.planeMm = planeOf(compiled.bboxMin, compiled.bboxMax, r.face);
    const std::vector<std::uint32_t> ids = nodeIdsOnSide(mesh, r.face);
    census.meshNodes = ids.size();
    out.restraintCensus.push_back(census);
    if (!r.holdsAnything()) continue;
    for (std::uint32_t id : ids) {
      forge::fea::BCPinned bc;
      bc.nodeId = id;
      bc.fx = r.holdX;
      bc.fy = r.holdY;
      bc.fz = r.holdZ;
      bcs.push_back(bc);
      out.heldFreedoms += static_cast<std::size_t>(r.heldDirections());
    }
  }
  if (bcs.empty()) {
    out.blocker = "None of this study's restraints landed on a mesh point. Hold a side the part "
                  "actually reaches.";
    return out;
  }

  // ── the loads, spread over the nodes on the side they name ────────────────
  std::vector<forge::fea::LoadNodal> loads;
  for (const forge::ui::Load& l : request.study.loads) {
    forge::ui::FaceCensus census;
    census.face = l.face;
    census.planeMm = planeOf(compiled.bboxMin, compiled.bboxMax, l.face);
    const std::vector<std::uint32_t> ids = nodeIdsOnSide(mesh, l.face);
    census.meshNodes = ids.size();
    out.loadCensus.push_back(census);
    if (l.isZero() || ids.empty()) continue;
    const double share = 1.0 / static_cast<double>(ids.size());
    for (std::uint32_t id : ids) {
      forge::fea::LoadNodal ln;
      ln.nodeId = id;
      ln.fx = l.fx * share;
      ln.fy = l.fy * share;
      ln.fz = l.fz * share;
      loads.push_back(ln);
    }
    out.loadedNodes += ids.size();
    out.appliedForceN[0] += l.fx;
    out.appliedForceN[1] += l.fy;
    out.appliedForceN[2] += l.fz;
  }
  if (loads.empty()) {
    out.blocker = "None of this study's forces landed on a mesh point. Push on a side the part "
                  "actually reaches.";
    return out;
  }

  // ── millimetres to metres ─────────────────────────────────────────────────
  // A similarity transform of the node coordinates and nothing else: the
  // connectivity and the per-node side tags are untouched by it.
  for (double& c : mesh.nodes) c /= kMmPerM;

  forge::fea::Material material;
  material.E = elastic->youngsModulusPa;
  material.nu = elastic->poissonRatio;
  material.rho = request.study.densityKgPerM3;
  out.youngsModulusPa = material.E;
  out.poissonRatio = material.nu;
  out.densityKgPerM3 = material.rho;

  // ── the solve ─────────────────────────────────────────────────────────────
  forge::fea::StaticResult result;
  const std::chrono::steady_clock::time_point t0 = std::chrono::steady_clock::now();
  try {
    result = forge::fea::solveStatic(mesh, material, loads, {}, bcs);
  } catch (const std::exception& e) {
    detail = std::string("solve failed: ") + e.what();
    out.blocker = "The study could not be solved on this part. Try holding a different side, or "
                  "a coarser mesh.";
    return out;
  } catch (...) {
    detail = "solve failed with a non-standard failure";
    out.blocker = "The study could not be solved on this part. Try holding a different side, or "
                  "a coarser mesh.";
    return out;
  }
  const std::chrono::steady_clock::time_point t1 = std::chrono::steady_clock::now();
  out.solveMs = std::chrono::duration<double, std::milli>(t1 - t0).count();

  if (result.u.size() != nNodes * 3) {
    detail = "the solver returned " + std::to_string(result.u.size()) + " values for " +
             std::to_string(nNodes * 3) + " degrees of freedom";
    out.blocker = "The study did not finish on this part.";
    return out;
  }

  // ── the answer, read off the solved system ────────────────────────────────
  out.residualN = result.residual;
  double best = -1.0;
  for (std::size_t n = 0; n < nNodes; ++n) {
    const double ux = result.u[3 * n + 0];
    const double uy = result.u[3 * n + 1];
    const double uz = result.u[3 * n + 2];
    const double d = std::sqrt(ux * ux + uy * uy + uz * uz);
    if (d > best) {
      best = d;
      out.maxDisplacementNode = static_cast<std::uint32_t>(n);
    }
  }
  out.maxDisplacementMm = (best > 0.0 ? best : 0.0) * kMmPerM;
  out.maxStressMPa = result.maxVonMises / 1.0e6;
  out.maxStressElement = result.maxAtElem;

  // A displacement or a stress that is not a finite number is a failed solve
  // that returned. Reporting it as an answer is exactly the defect this file's
  // header refuses.
  if (!std::isfinite(out.maxDisplacementMm) || !std::isfinite(out.maxStressMPa) ||
      !std::isfinite(out.residualN)) {
    detail = "the solver returned a value that is not a finite number";
    out.blocker = "The study did not settle on an answer for this part. Try holding a different "
                  "side, or a coarser mesh.";
    return out;
  }

  out.solved = true;
  return out;
}

}  // namespace forge::desktop
