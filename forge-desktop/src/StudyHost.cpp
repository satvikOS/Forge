#include "StudyHost.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <string>
#include <utility>
#include <vector>

#include "forge/Booleans.hpp"
#include "forge/Fea.hpp"
#include "forge/ft/FeatureTree.hpp"
#include "forge/native/fea/ScalarElliptic.hpp"
#include "forge/native/linalg/LinAlg.hpp"
#include "forge/ui/StudyField.hpp"

namespace forge::desktop {

namespace {

// The document works in millimetres; the solver works in metres.
constexpr double kMmPerM = 1000.0;
constexpr double kPi = 3.14159265358979323846;

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

// The part, compiled from the document's own history, and meshed. Shared by
// every kind of study: whatever question is asked, it is asked of the same
// solid divided the same way.
struct Prepared {
  forge::fea::Mesh mesh;  // node coordinates still in millimetres
  forge::ShapeHandle handle = 0;  // the compiled part, for a re-mesh at another size
  double longestMm = 0.0;
  double bboxMin[3] = {0.0, 0.0, 0.0};
  double bboxMax[3] = {0.0, 0.0, 0.0};
  std::size_t nNodes = 0;
  std::size_t nElems = 0;
};

// The volume of every brick the mesh holds, in the mesh's own units cubed.
double meshVolume(const forge::fea::Mesh& mesh) {
  const std::size_t per = mesh.elemNodeCount;
  if (per != 8) return 0.0;
  double total = 0.0;
  const std::size_t nElems = mesh.tets.size() / per;
  for (std::size_t e = 0; e < nElems; ++e) {
    // An axis-aligned brick: node 0 is (i,j,k) and node 6 is (i+1,j+1,k+1).
    const std::uint32_t a = mesh.tets[e * per + 0];
    const std::uint32_t b = mesh.tets[e * per + 6];
    double v = 1.0;
    for (int c = 0; c < 3; ++c) v *= std::fabs(mesh.nodes[3 * b + c] - mesh.nodes[3 * a + c]);
    total += v;
  }
  return total;
}

bool prepare(const StudyRequest& request, std::size_t maxCells, forge::ui::StudyOutcome& out,
             Prepared& prep, std::string& detail) {
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
    return false;
  } catch (...) {
    detail = "study compile threw a non-standard failure";
    out.blocker = "Forge could not rebuild this part to test it. The part on screen is the last "
                  "one that built.";
    return false;
  }
  if (!compiled.ok || compiled.handle == 0) {
    detail = compiled.error.empty() ? std::string("the kernel produced no solid") : compiled.error;
    out.blocker = "Forge could not rebuild this part to test it, so there was nothing to hold or "
                  "to push on.";
    return false;
  }
  out.partVolumeMm3 = compiled.volume;
  for (int i = 0; i < 3; ++i) {
    prep.bboxMin[i] = compiled.bboxMin[i];
    prep.bboxMax[i] = compiled.bboxMax[i];
  }

  double span[3];
  for (int i = 0; i < 3; ++i) span[i] = compiled.bboxMax[i] - compiled.bboxMin[i];
  const double longest = std::max(span[0], std::max(span[1], span[2]));
  if (!(longest > 0.0)) {
    out.blocker = "This part has no size to speak of, so there is nothing to test.";
    return false;
  }
  const double elemMm = studyElementSizeMm(longest, request.study.divisions);
  out.elementSizeMm = elemMm;
  prep.handle = compiled.handle;
  prep.longestMm = longest;

  // How much work the mesher is about to be asked for. Refusing a study that
  // would freeze the application for minutes beats starting one.
  {
    double cells = 1.0;
    for (int i = 0; i < 3; ++i) {
      const double n = std::max(1.0, std::floor(span[i] / elemMm + 0.5));
      cells *= n;
    }
    if (cells > static_cast<double>(maxCells)) {
      out.blocker = "That is a finer mesh than this part can be tested with in one go. Lower the "
                    "number of elements across the part and run it again.";
      return false;
    }
  }

  // ── the mesh ──────────────────────────────────────────────────────────────
  try {
    prep.mesh = forge::fea::meshFromBRep(compiled.handle, elemMm);
  } catch (const std::exception& e) {
    detail = std::string("mesh failed: ") + e.what();
    out.blocker = "Forge could not divide this part into pieces to test it.";
    return false;
  } catch (...) {
    detail = "mesh failed with a non-standard failure";
    out.blocker = "Forge could not divide this part into pieces to test it.";
    return false;
  }

  const forge::fea::Mesh& mesh = prep.mesh;
  prep.nNodes = mesh.nodes.size() / 3;
  prep.nElems = mesh.elemNodeCount > 0 ? mesh.tets.size() / mesh.elemNodeCount : 0;
  if (prep.nNodes == 0 || prep.nElems == 0) {
    out.blocker = "Forge could not fit a single test element inside this part. Raise the number "
                  "of elements across the part and run it again.";
    return false;
  }
  if (mesh.nodeToFace.size() != prep.nNodes) {
    detail = "mesh side tags do not match its node count";
    out.blocker = "Forge could not work out which mesh points sit on which side of this part.";
    return false;
  }
  out.meshNodes = prep.nNodes;
  out.meshElements = prep.nElems;
  out.meshVolumeMm3 = meshVolume(mesh);
  return true;
}

// The restraints, as node sets counted off the mesh. Shared by Static and Modal.
std::vector<forge::fea::BCPinned> restraintsOnMesh(const StudyRequest& request,
                                                   const Prepared& prep,
                                                   forge::ui::StudyOutcome& out) {
  std::vector<forge::fea::BCPinned> bcs;
  for (const forge::ui::Restraint& r : request.study.restraints) {
    forge::ui::FaceCensus census;
    census.face = r.face;
    census.planeMm = planeOf(prep.bboxMin, prep.bboxMax, r.face);
    const std::vector<std::uint32_t> ids = nodeIdsOnSide(prep.mesh, r.face);
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
  return bcs;
}

// ════════════════════════════════════════════════════════════════════════════
// STATIC
// ════════════════════════════════════════════════════════════════════════════
forge::ui::StudyOutcome runStatic(const StudyRequest& request,
                                  const forge::ui::ElasticProperties& elastic,
                                  std::string& detail) {
  forge::ui::StudyOutcome out;
  out.kind = forge::ui::StudyKind::Static;
  Prepared prep;
  if (!prepare(request, kMaxStudyCells, out, prep, detail)) return out;
  forge::fea::Mesh& mesh = prep.mesh;
  const std::size_t nNodes = prep.nNodes;
  out.freedoms = nNodes * 3;

  const std::vector<forge::fea::BCPinned> bcs = restraintsOnMesh(request, prep, out);
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
    census.planeMm = planeOf(prep.bboxMin, prep.bboxMax, l.face);
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
  material.E = elastic.youngsModulusPa;
  material.nu = elastic.poissonRatio;
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

// ════════════════════════════════════════════════════════════════════════════
// MODAL
// ════════════════════════════════════════════════════════════════════════════
forge::ui::StudyOutcome runModal(const StudyRequest& request,
                                 const forge::ui::ElasticProperties& elastic,
                                 std::string& detail) {
  forge::ui::StudyOutcome out;
  out.kind = forge::ui::StudyKind::Modal;
  out.modesRequested = request.study.modeCount;
  Prepared prep;
  if (!prepare(request, kMaxModalCells, out, prep, detail)) return out;
  forge::fea::Mesh& mesh = prep.mesh;
  const std::size_t nNodes = prep.nNodes;
  out.freedoms = nNodes * 3;

  const std::vector<forge::fea::BCPinned> bcs = restraintsOnMesh(request, prep, out);
  if (bcs.empty()) {
    out.blocker = "None of this study's restraints landed on a mesh point. Hold a side the part "
                  "actually reaches.";
    return out;
  }

  // ── the sizes the kernel solves slowly ────────────────────────────────────
  // See kKernelDenseModalDof in StudyHost.hpp for the measurements. The nearest
  // FINER count that leaves the band is preferred (finer is also more
  // accurate); failing that, the nearest coarser one that is quick.
  if (out.freedoms > kModalQuickDenseDof && out.freedoms <= kKernelDenseModalDof) {
    auto freedomsAt = [&](int divisions) -> std::size_t {
      try {
        const forge::fea::Mesh trial =
            forge::fea::meshFromBRep(prep.handle, studyElementSizeMm(prep.longestMm, divisions));
        return trial.nodes.size();  // three per node
      } catch (...) {
        return 0;
      }
    };
    double span[3];
    for (int i = 0; i < 3; ++i) span[i] = prep.bboxMax[i] - prep.bboxMin[i];
    auto cellsAt = [&](int divisions) {
      const double e = studyElementSizeMm(prep.longestMm, divisions);
      double cells = 1.0;
      for (int i = 0; i < 3; ++i) cells *= std::max(1.0, std::floor(span[i] / e + 0.5));
      return cells;
    };
    int suggest = 0;
    for (int d = request.study.divisions + 1; d <= forge::ui::kMaxStudyDivisions; ++d) {
      if (cellsAt(d) > static_cast<double>(kMaxModalCells)) break;
      if (freedomsAt(d) > kKernelDenseModalDof) {
        suggest = d;
        break;
      }
    }
    if (suggest == 0) {
      for (int d = request.study.divisions - 1; d >= forge::ui::kMinStudyDivisions; --d) {
        const std::size_t f = freedomsAt(d);
        if (f > 0 && f <= kModalQuickDenseDof) {
          suggest = d;
          break;
        }
      }
    }
    out.suggestedDivisions = suggest;
    const std::string asked = std::to_string(request.study.divisions);
    if (suggest > request.study.divisions) {
      out.blocker = "Finding this part's natural frequencies with " + asked +
                    " elements across it would hold Forge for many seconds. Use " +
                    std::to_string(suggest) +
                    " or more and run it again: a finer mesh is solved a faster way.";
    } else if (suggest > 0) {
      out.blocker = "Finding this part's natural frequencies with " + asked +
                    " elements across it would hold Forge for many seconds. Use " +
                    std::to_string(suggest) + " or fewer and run it again.";
    } else {
      out.blocker = "Finding this part's natural frequencies with " + asked +
                    " elements across it would hold Forge for many seconds, and no other count "
                    "avoids that for this part yet.";
    }
    detail = std::to_string(out.freedoms) + " freedoms: the kernel's dense eigensolver path";
    return out;
  }

  // The surface to draw is the mesh's own, in the document's millimetres, taken
  // BEFORE the coordinates are scaled for the solver.
  const std::vector<double> nodesMm = mesh.nodes;

  for (double& c : mesh.nodes) c /= kMmPerM;

  forge::fea::Material material;
  material.E = elastic.youngsModulusPa;
  material.nu = elastic.poissonRatio;
  material.rho = request.study.densityKgPerM3;
  out.youngsModulusPa = material.E;
  out.poissonRatio = material.nu;
  out.densityKgPerM3 = material.rho;
  out.meshMassKg = out.meshVolumeMm3 * 1.0e-9 * material.rho;

  forge::fea::ModalResult result;
  const std::chrono::steady_clock::time_point t0 = std::chrono::steady_clock::now();
  try {
    result = forge::fea::solveModal(mesh, material, bcs, request.study.modeCount);
  } catch (const std::exception& e) {
    detail = std::string("modal solve failed: ") + e.what();
    out.blocker = "Forge could not find this part's natural frequencies. If no side is held in "
                  "every direction the part can still slide or spin freely; hold one side fully "
                  "and run it again.";
    return out;
  } catch (...) {
    detail = "modal solve failed with a non-standard failure";
    out.blocker = "Forge could not find this part's natural frequencies. If no side is held in "
                  "every direction the part can still slide or spin freely; hold one side fully "
                  "and run it again.";
    return out;
  }
  const std::chrono::steady_clock::time_point t1 = std::chrono::steady_clock::now();
  out.solveMs = std::chrono::duration<double, std::milli>(t1 - t0).count();

  const std::size_t found = result.eigenvalues.size();
  if (found == 0 || result.eigenvectors.size() != found ||
      static_cast<std::size_t>(result.nModes) != found) {
    detail = "the eigensolver returned " + std::to_string(found) + " values and " +
             std::to_string(result.eigenvectors.size()) + " shapes for " +
             std::to_string(result.nModes) + " modes";
    out.blocker = "The study did not finish on this part.";
    return out;
  }

  // ── modes that are not vibrations ─────────────────────────────────────────
  // Two kinds come back from a part that is not held firmly, MEASURED on the
  // kernel's dense path (T-340 evidence partial_hold_probe_BEFORE.log: a
  // cantilever held along Z only returned 0, 0, 0.0032 and 0.159 Hz "modes"):
  //   * free motion: the part slides or turns without bending, omega^2 ~ 0. The
  //     scale is E / (rho L^2) for the part's longest side L; a genuine mode of a
  //     part this mesher can divide (at most 40 bricks across, so no feature
  //     thinner than L / 40) sits above about (1/40)^2 of it, so anything below
  //     1e-8 of it is motion, not vibration.
  //   * artefacts of the held freedoms: the kernel holds a freedom by putting 1
  //     on its diagonal in both K and M, which is an eigenvalue of 1 (0.159 Hz)
  //     whose shape MOVES the held freedom. A real mode never moves a held one.
  // Either one means the list is not the part's natural frequencies, so the
  // study refuses rather than print it.
  {
    std::vector<char> held(nNodes * 3, 0);
    for (const forge::fea::BCPinned& bc : bcs) {
      if (bc.nodeId >= nNodes) continue;
      if (bc.fx) held[3 * bc.nodeId + 0] = 1;
      if (bc.fy) held[3 * bc.nodeId + 1] = 1;
      if (bc.fz) held[3 * bc.nodeId + 2] = 1;
    }
    const double longestM = prep.longestMm / kMmPerM;
    const double scale = material.E / (material.rho * longestM * longestM);
    std::size_t freeMotion = 0, artefacts = 0;
    for (std::size_t k = 0; k < found; ++k) {
      const std::vector<double>& v = result.eigenvectors[k];
      if (v.size() != nNodes * 3) continue;  // refused below, with the others
      double all = 0.0, onHeld = 0.0;
      for (std::size_t i = 0; i < v.size(); ++i) {
        const double a = std::fabs(v[i]);
        all = std::max(all, a);
        if (held[i] != 0) onHeld = std::max(onHeld, a);
      }
      // Free motion is asked FIRST: on the dense path a zero-frequency mode can
      // come back mixed with the held freedoms' own, and it is still the part
      // drifting (measured: a cantilever held along Z only).
      if (result.eigenvalues[k] < 1e-8 * scale) {
        ++freeMotion;
      } else if (all > 0.0 && onHeld > 1e-6 * all) {
        ++artefacts;
      }
    }
    if (freeMotion > 0) {
      detail = std::to_string(freeMotion) + " of " + std::to_string(found) +
               " modes are free motion (omega^2 below 1e-8 E / rho L^2), " +
               std::to_string(artefacts) + " move a held freedom";
      out.blocker = "This part is not held firmly enough to vibrate: it can still slide or turn "
                    "freely. Hold one side in all three directions and run it again.";
      return out;
    }
    if (artefacts > 0) {
      detail = std::to_string(artefacts) + " of " + std::to_string(found) +
               " modes move a held freedom (eigenvalue " + std::to_string(result.eigenvalues[0]) +
               " first)";
      out.blocker = "The study did not settle on an answer for this part. Hold one side in all "
                    "three directions, or try a different number of elements across it.";
      return out;
    }
  }

  // Lowest first, with each shape travelling with its own value.
  std::vector<std::size_t> order(found);
  for (std::size_t i = 0; i < found; ++i) order[i] = i;
  std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
    return result.eigenvalues[a] < result.eigenvalues[b];
  });

  for (std::size_t k : order) {
    const double lambda = result.eigenvalues[k];
    std::vector<double> shape = std::move(result.eigenvectors[k]);
    if (!std::isfinite(lambda) || lambda < 0.0) {
      detail = "the eigensolver returned omega^2 = " + std::to_string(lambda);
      out.blocker = "The study did not settle on an answer for this part. Try a coarser mesh.";
      out.modes.clear();
      out.modeShapes.clear();
      return out;
    }
    forge::ui::NaturalMode mode;
    mode.eigenvalue = lambda;
    mode.frequencyHz = std::sqrt(lambda) / (2.0 * kPi);
    if (!forge::ui::normaliseModeShape(shape, nNodes, mode.peakNode)) {
      detail = "mode shape " + std::to_string(out.modes.size() + 1) +
               " has the wrong length, is not finite, or is zero";
      out.blocker = "The study did not settle on an answer for this part. Try a coarser mesh.";
      out.modes.clear();
      out.modeShapes.clear();
      return out;
    }
    mode.motion = forge::ui::classifyModeMotion(nodesMm, shape);
    out.modes.push_back(mode);
    out.modeShapes.push_back(std::move(shape));
  }

  out.surface = forge::ui::exteriorOfHexMesh(nodesMm, mesh.tets);
  out.solved = true;
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// THERMAL
// ════════════════════════════════════════════════════════════════════════════
forge::ui::StudyOutcome runThermal(const StudyRequest& request,
                                   const forge::ui::ThermalProperties& thermal,
                                   std::string& detail) {
  forge::ui::StudyOutcome out;
  out.kind = forge::ui::StudyKind::Thermal;
  out.conductivityWPerMK = thermal.conductivityWPerMK;
  out.densityKgPerM3 = request.study.densityKgPerM3;
  Prepared prep;
  if (!prepare(request, kMaxThermalCells, out, prep, detail)) return out;
  forge::fea::Mesh& mesh = prep.mesh;
  const std::size_t nNodes = prep.nNodes;
  const std::size_t nElems = prep.nElems;
  out.freedoms = nNodes;  // one temperature per node

  // ── the held temperatures, as node sets ──────────────────────────────────
  // owner[n] is the index of the temperature row that holds node n, or -1. The
  // FIRST row to reach a node keeps it: where two held sides meet, the shared
  // nodes cannot be at both temperatures, and which one wins is a rule, stated
  // in StudyHost.hpp and counted here, not an accident of a loop order.
  const std::vector<forge::ui::FixedTemperature>& rows = request.study.temperatures;
  std::vector<int> owner(nNodes, -1);
  std::vector<forge::fea::ThermalNodalT> dirichlet;
  std::vector<std::size_t> heldPerRow(rows.size(), 0);
  for (std::size_t r = 0; r < rows.size(); ++r) {
    forge::ui::FaceCensus census;
    census.face = rows[r].face;
    census.planeMm = planeOf(prep.bboxMin, prep.bboxMax, rows[r].face);
    const std::vector<std::uint32_t> ids = nodeIdsOnSide(mesh, rows[r].face);
    census.meshNodes = ids.size();
    out.temperatureCensus.push_back(census);
    for (std::uint32_t id : ids) {
      if (owner[id] >= 0) {
        if (rows[static_cast<std::size_t>(owner[id])].temperatureC != rows[r].temperatureC) {
          ++out.sharedHeldNodes;
        }
        continue;
      }
      owner[id] = static_cast<int>(r);
      forge::fea::ThermalNodalT t;
      t.nodeId = id;
      t.T = rows[r].temperatureC;
      dirichlet.push_back(t);
      ++heldPerRow[r];
    }
  }
  out.heldNodes = dirichlet.size();
  if (dirichlet.empty()) {
    out.blocker = "None of this study's held temperatures landed on a mesh point. Hold a side the "
                  "part actually reaches.";
    return out;
  }

  const std::vector<double> nodesMm = mesh.nodes;
  for (double& c : mesh.nodes) c /= kMmPerM;

  // ── heat generated, spread evenly through the meshed volume ──────────────
  // Per unit volume of the MESH, so the total assembled is exactly the total
  // asked for even where the bricks only approximate the part.
  const double meshVolumeM3 = out.meshVolumeMm3 * 1.0e-9;
  std::vector<forge::fea::ThermalElemSource> sources;
  double qPerM3 = 0.0;
  if (request.study.heatGeneratedW != 0.0) {
    if (!(meshVolumeM3 > 0.0)) {
      out.blocker = "Forge could not measure the volume of this part's mesh, so it cannot spread "
                    "the heat through it.";
      return out;
    }
    qPerM3 = request.study.heatGeneratedW / meshVolumeM3;
    sources.reserve(nElems);
    for (std::size_t e = 0; e < nElems; ++e) {
      forge::fea::ThermalElemSource s;
      s.elemId = static_cast<std::uint32_t>(e);
      s.q = qPerM3;
      sources.push_back(s);
    }
  }

  forge::fea::ThermalMaterial material;
  material.k = thermal.conductivityWPerMK;

  forge::fea::ThermalResult result;
  const std::chrono::steady_clock::time_point t0 = std::chrono::steady_clock::now();
  try {
    result = forge::fea::solveThermal(mesh, material, dirichlet, sources, {});
  } catch (const std::exception& e) {
    detail = std::string("thermal solve failed: ") + e.what();
    out.blocker = "The study could not be solved on this part. Try holding a different side, or "
                  "a coarser mesh.";
    return out;
  } catch (...) {
    detail = "thermal solve failed with a non-standard failure";
    out.blocker = "The study could not be solved on this part. Try holding a different side, or "
                  "a coarser mesh.";
    return out;
  }
  const std::chrono::steady_clock::time_point t1 = std::chrono::steady_clock::now();
  out.solveMs = std::chrono::duration<double, std::milli>(t1 - t0).count();

  if (result.T.size() != nNodes) {
    detail = "the solver returned " + std::to_string(result.T.size()) + " temperatures for " +
             std::to_string(nNodes) + " nodes";
    out.blocker = "The study did not finish on this part.";
    return out;
  }

  // ── the nodal heat balance, r = K T - f ───────────────────────────────────
  // K is rebuilt element by element with the kernel's OWN element matrix, and f
  // with the kernel's own lumping (q V_e / 8 per corner), so r is what the
  // solved system says enters at each node. At a held node it is the heat that
  // side supplies; at a free node it should be nothing.
  std::vector<double> reaction(nNodes, 0.0);
  double assembledW = 0.0;
  try {
    for (std::size_t e = 0; e < nElems; ++e) {
      double X[8][3];
      std::uint32_t ids[8];
      for (int i = 0; i < 8; ++i) {
        ids[i] = mesh.tets[e * 8 + static_cast<std::size_t>(i)];
        for (int c = 0; c < 3; ++c) X[i][c] = mesh.nodes[3 * ids[i] + static_cast<std::size_t>(c)];
      }
      forge::native::linalg::MatrixD Ke(8, 8);
      const double volume = forge::native::fea::scalar_elliptic::elementStiffness(
          material.k, X, Ke, "forge.desktop.thermalReactions");
      for (int i = 0; i < 8; ++i) {
        double kt = 0.0;
        for (int j = 0; j < 8; ++j) kt += Ke(i, j) * result.T[ids[j]];
        reaction[ids[i]] += kt;
      }
      if (qPerM3 != 0.0) {
        const double per = qPerM3 * volume / 8.0;
        for (int i = 0; i < 8; ++i) reaction[ids[i]] -= per;
        assembledW += qPerM3 * volume;
      }
    }
  } catch (const std::exception& e) {
    detail = std::string("thermal reactions failed: ") + e.what();
    out.blocker = "The study did not finish on this part.";
    return out;
  }
  out.heatGeneratedW = assembledW;

  // One flow per row that held at least one node; rowFlow maps a row to it.
  std::vector<int> rowFlow(rows.size(), -1);
  for (std::size_t r = 0; r < rows.size(); ++r) {
    if (heldPerRow[r] == 0) continue;
    forge::ui::SideHeatFlow flow;
    flow.face = rows[r].face;
    flow.temperatureC = rows[r].temperatureC;
    flow.meshNodes = heldPerRow[r];
    rowFlow[r] = static_cast<int>(out.heatFlows.size());
    out.heatFlows.push_back(flow);
  }
  double sumIn = 0.0;
  for (std::size_t n = 0; n < nNodes; ++n) {
    if (owner[n] < 0) {
      out.maxResidualW = std::max(out.maxResidualW, std::fabs(reaction[n]));
      continue;
    }
    sumIn += reaction[n];
    const int f = rowFlow[static_cast<std::size_t>(owner[n])];
    if (f >= 0) out.heatFlows[static_cast<std::size_t>(f)].heatInW += reaction[n];
  }
  out.heatImbalanceW = sumIn + out.heatGeneratedW;

  // ── the field ─────────────────────────────────────────────────────────────
  out.nodeTemperatureC = result.T;
  out.minTemperatureC = result.T[0];
  out.maxTemperatureC = result.T[0];
  for (std::size_t n = 0; n < nNodes; ++n) {
    if (result.T[n] < out.minTemperatureC) {
      out.minTemperatureC = result.T[n];
      out.coldestNode = static_cast<std::uint32_t>(n);
    }
    if (result.T[n] > out.maxTemperatureC) {
      out.maxTemperatureC = result.T[n];
      out.hottestNode = static_cast<std::uint32_t>(n);
    }
  }
  for (double q : result.elemFluxMag) out.maxHeatFluxWPerM2 = std::max(out.maxHeatFluxWPerM2, q);

  bool finite = std::isfinite(out.heatImbalanceW) && std::isfinite(out.maxResidualW) &&
                std::isfinite(out.maxHeatFluxWPerM2);
  for (double t : result.T) finite = finite && std::isfinite(t);
  if (!finite) {
    detail = "the solver returned a value that is not a finite number";
    out.blocker = "The study did not settle on an answer for this part. Try a coarser mesh.";
    return out;
  }

  out.surface = forge::ui::exteriorOfHexMesh(nodesMm, mesh.tets);
  out.solved = true;
  return out;
}

}  // namespace

double studyElementSizeMm(double longestSideMm, int divisions) noexcept {
  if (!(longestSideMm > 0.0) || divisions <= 0) return 0.0;
  return longestSideMm / static_cast<double>(divisions);
}

forge::ui::StudyOutcome runStudy(const StudyRequest& request, std::string& detail) {
  detail.clear();
  forge::ui::StudyOutcome refused;
  refused.kind = request.study.kind;
  {
    // The blocker the study can be refused on WITHOUT touching the kernel is
    // asked first and asked by the shared function, so the panel's "why the Run
    // button is off" and this function's refusal cannot drift apart.
    const std::string blocked = forge::ui::studyBlocker(request.study, !request.irProgram.empty());
    if (!blocked.empty()) {
      refused.blocker = blocked;
      return refused;
    }
  }

  // studyBlocker() already refuses a material without the constants the kind
  // needs; each lookup is still checked here, because dereferencing on the
  // strength of another function's promise is how a null gets read once the two
  // are edited apart.
  switch (request.study.kind) {
    case forge::ui::StudyKind::Thermal: {
      const forge::ui::ThermalProperties* thermal =
          forge::ui::thermalPropertiesFor(request.study.materialId);
      if (thermal == nullptr) {
        refused.blocker = "Choose a material for this part first.";
        return refused;
      }
      return runThermal(request, *thermal, detail);
    }
    case forge::ui::StudyKind::Modal:
    case forge::ui::StudyKind::Static:
      break;
  }
  const forge::ui::ElasticProperties* elastic =
      forge::ui::elasticPropertiesFor(request.study.materialId);
  if (elastic == nullptr) {
    refused.blocker = "Choose a material for this part first.";
    return refused;
  }
  if (request.study.kind == forge::ui::StudyKind::Modal) {
    return runModal(request, *elastic, detail);
  }
  return runStatic(request, *elastic, detail);
}

}  // namespace forge::desktop
