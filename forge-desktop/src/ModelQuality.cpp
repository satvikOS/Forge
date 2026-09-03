// forge-desktop/src/ModelQuality.cpp — the kernel queries behind the trust panels.
//
// THE ONE PLACE the five quality checks reach geometry. Everything above it —
// the frame builder, the panels, the gate's assertions — sees only the plain
// struct in ModelQuality.hpp, which is what keeps the panels drawable in a
// process that has no kernel and keeps every number in them traceable to the
// call that produced it.
//
// NOTHING IS COMPUTED HERE THAT A KERNEL QUERY ALREADY ANSWERS. The overlap
// volume is the interference query's; the continuity metrics are the Class-A
// module's; the draft angles are the mould module's; the stripes are the
// zebra pass's. What this file adds is the enumeration each of them needs (the
// solids of the model, the edges with a face on each side, the face map) and a
// SECOND measurement of a clash from a different primitive, so a disagreement
// between two instruments over one overlap is visible rather than averaged.
//
// EVERY CALL IS GUARDED, and each answer carries its own `checked*` flag. A
// kernel query that refuses a particular body must cost that ONE row, never the
// four other panels, and a zero that was never measured must never be printed
// beside one that was.
#include "ModelQuality.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "forge/Booleans.hpp"
#include "forge/ClassASurfacing.hpp"
#include "forge/ComponentRegistry.hpp"
#include "forge/DirectEdit.hpp"
#include "forge/DirectModeling.hpp"
#include "forge/Healing.hpp"
#include "forge/InterferenceDetection.hpp"
#include "forge/MassProps.hpp"
#include "forge/Mold.hpp"
#include "forge/ShapeCheck.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/Topology.hpp"

#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <TopAbs.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Dir.hxx>

namespace forge::desktop {

namespace {

// A handle this file made and must give back. The quality check can be run once
// a second for a whole session, so an entry left behind is a leak with a rate.
class OwnedHandle {
 public:
  OwnedHandle() = default;
  explicit OwnedHandle(forge::ShapeHandle h) : h_(h) {}
  OwnedHandle(const OwnedHandle&) = delete;
  OwnedHandle& operator=(const OwnedHandle&) = delete;
  OwnedHandle(OwnedHandle&& o) noexcept : h_(o.h_) { o.h_ = 0; }
  OwnedHandle& operator=(OwnedHandle&& o) noexcept {
    if (this != &o) { reset(); h_ = o.h_; o.h_ = 0; }
    return *this;
  }
  ~OwnedHandle() { reset(); }
  void reset() {
    if (h_ != 0) {
      try { forge::ShapeRegistry::instance().release(h_); } catch (...) {}
      h_ = 0;
    }
  }
  forge::ShapeHandle get() const noexcept { return h_; }

 private:
  forge::ShapeHandle h_ = 0;
};

bool boxOf(const TopoDS_Shape& shape, double lo[3], double hi[3]) {
  try {
    Bnd_Box box;
    BRepBndLib::Add(shape, box);
    if (box.IsVoid()) return false;
    box.Get(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]);
    return true;
  } catch (...) {
    return false;
  }
}

}  // namespace

// ── the run ────────────────────────────────────────────────────────────────
ModelQualityReport analyseSolidQuality(std::uint32_t shapeHandle,
                                       const QualitySettings& settings) {
  ModelQualityReport out;
  for (int i = 0; i < 3; ++i) {
    out.pull[i] = settings.pull[i];
    out.light[i] = settings.light[i];
  }
  out.draftThresholdDeg = settings.draftThresholdDeg;
  out.stripeCount = settings.stripeCount;
  out.clashTolerance = settings.clashTolerance;

  const forge::ShapeHandle h = static_cast<forge::ShapeHandle>(shapeHandle);
  if (h == 0) {
    out.unavailable = "There is no model to check yet. Build or open a part first.";
    return out;
  }

  auto& reg = forge::ShapeRegistry::instance();
  const TopoDS_Shape* shape = nullptr;
  try {
    if (reg.kindOf(h) != forge::ShapeKind::Occt) {
      // The kernel has two ways of holding a body and these checks read one of
      // them. Saying so is the honest answer; reporting zeros for a model that
      // was never measured would not be.
      out.unavailable =
          "This model is held in a form these checks cannot read yet, so none of them ran.";
      return out;
    }
    shape = &reg.get(h);
  } catch (...) {
    out.unavailable = "The model could not be read back for checking.";
    return out;
  }
  if (shape == nullptr || shape->IsNull()) {
    out.unavailable = "The model came back empty, so there is nothing to check.";
    return out;
  }
  out.ran = true;

  // ── verification ─────────────────────────────────────────────────────────
  try {
    const forge::shapecheck::AnalysisReport a = forge::shapecheck::analyse(h);
    out.shapeValid = a.valid;
    out.faultyCount = static_cast<long>(a.faultyCount);
    out.faults = a.faultStrings;
    out.checkedShape = true;
  } catch (...) {}

  try {
    const forge::heal::ValidityReport v = forge::heal::checkValidity(h);
    out.closed = v.isClosed;
    out.manifold = v.isManifold;
    out.oriented = v.isOriented;
    out.selfIntersecting = v.hasSelfIntersect;
    out.nonManifoldEdge = v.hasNonManifoldEdge;
    out.badFaces = v.badFaces.size();
    out.badEdges = v.badEdges.size();
    out.checkedClosure = true;
  } catch (...) {}

  try {
    const forge::MassProperties mp = forge::massProperties(h);
    out.volume = mp.volume;
    out.area = mp.area;
    out.com[0] = mp.cx;
    out.com[1] = mp.cy;
    out.com[2] = mp.cz;
    out.checkedMass = true;
  } catch (...) {}

  out.checkedBox = boxOf(*shape, out.bboxMin, out.bboxMax);

  try {
    out.faceCount = static_cast<long>(forge::direct::faceCount(h));
    out.edgeCount = static_cast<long>(forge::direct::edgeCount(h));
    out.checkedCounts = true;
  } catch (...) {}

  try {
    forge::TopoSignature sig;
    if (forge::topologySignature(h, sig)) {
      out.genus = sig.genus;
      out.shells = sig.shellCount;
      out.topoVertices = sig.vertexCount;
      out.topoEdges = sig.edgeCount;
      out.topoFaces = sig.faceCount;
      out.checkedTopology = true;
    }
  } catch (...) {}

  // ── the face map, shared by draft and zebra ──────────────────────────────
  TopTools_IndexedMapOfShape faceMap;
  try {
    TopExp::MapShapes(*shape, TopAbs_FACE, faceMap);
  } catch (...) {}

  // ── interference ─────────────────────────────────────────────────────────
  // A clash needs two solids. The model's own solids are enumerated here and
  // handed to the kernel's interference query as instances at the identity, so
  // what is compared is exactly what the user is looking at.
  {
    std::vector<OwnedHandle> solidHandles;
    std::vector<forge::InstanceId> instances;
    auto& components = forge::ComponentRegistry::instance();
    try {
      int index = 0;
      for (TopExp_Explorer e(*shape, TopAbs_SOLID); e.More(); e.Next()) {
        ++index;
        QualitySolid s;
        s.index = index;
        const TopoDS_Shape& solid = e.Current();
        OwnedHandle sh(reg.add(solid));
        try {
          const forge::MassProperties mp = forge::massProperties(sh.get());
          s.volume = mp.volume;
          s.area = mp.area;
          s.com[0] = mp.cx;
          s.com[1] = mp.cy;
          s.com[2] = mp.cz;
          s.measured = true;
        } catch (...) {}
        boxOf(solid, s.bboxMin, s.bboxMax);
        out.solids.push_back(s);
        try {
          instances.push_back(
              components.addInstance(sh.get(), forge::Transform4x4{}));
        } catch (...) {
          instances.push_back(0);
        }
        solidHandles.push_back(std::move(sh));
      }
    } catch (...) {}

    if (instances.size() >= 2) {
      // The live instances AND the solid each one stands for, kept side by side.
      // Deriving the solid from a position in the filtered list would be right
      // only while every registration succeeds, and wrong exactly when one does
      // not -- which is when a clash report matters most.
      std::vector<forge::InstanceId> live;
      std::vector<std::size_t> liveSolid;  // index into solidHandles / out.solids
      for (std::size_t k = 0; k < instances.size(); ++k) {
        if (instances[k] == 0) continue;
        live.push_back(instances[k]);
        liveSolid.push_back(k);
      }
      if (live.size() >= 2) {
        try {
          const std::vector<forge::InterferencePair> hits =
              forge::detectInterference(live, settings.clashTolerance);
          for (const forge::InterferencePair& p : hits) {
            QualityClash c;
            c.volume = p.volume;
            // The instance ids come back in the order they were added, so the
            // position in `live` is the solid's own 1-based index.
            std::size_t slotA = solidHandles.size();
            std::size_t slotB = solidHandles.size();
            for (std::size_t k = 0; k < live.size(); ++k) {
              if (live[k] == p.instA) slotA = liveSolid[k];
              if (live[k] == p.instB) slotB = liveSolid[k];
            }
            if (slotA < out.solids.size()) c.solidA = out.solids[slotA].index;
            if (slotB < out.solids.size()) c.solidB = out.solids[slotB].index;
            // The SECOND instrument: build the overlap and measure it in its own
            // right, which is also the only way to say WHERE the clash is.
            if (slotA < solidHandles.size() && slotB < solidHandles.size()) {
              try {
                forge::resetBooleanBudget();
                const forge::ShapeHandle overlapRaw =
                    forge::common(solidHandles[slotA].get(), solidHandles[slotB].get());
                if (overlapRaw != 0) {
                  OwnedHandle overlap(overlapRaw);
                  const forge::MassProperties mp = forge::massProperties(overlap.get());
                  c.commonVolume = mp.volume;
                  c.com[0] = mp.cx;
                  c.com[1] = mp.cy;
                  c.com[2] = mp.cz;
                  c.located = boxOf(reg.get(overlap.get()), c.bboxMin, c.bboxMax);
                }
              } catch (...) {}
            }
            out.clashes.push_back(c);
          }
          out.checkedClashes = true;
        } catch (...) {}
      }
    } else if (!out.solids.empty()) {
      // One solid is a complete, honest answer: there is no pair to compare.
      out.checkedClashes = true;
    }

    for (forge::InstanceId id : instances) {
      if (id == 0) continue;
      try { components.removeInstance(id); } catch (...) {}
    }
  }

  // ── continuity ───────────────────────────────────────────────────────────
  // One report per edge that has a face on each side. A seam — where one face
  // meets itself — has the same face twice and is skipped, because "how does
  // this face meet itself" is not the question a continuity check answers.
  try {
    TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
    TopExp::MapShapesAndAncestors(*shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    for (int k = 1; k <= edgeFaces.Extent(); ++k) {
      const TopTools_ListOfShape& adjacent = edgeFaces.FindFromIndex(k);
      if (adjacent.Extent() != 2) continue;
      auto it = adjacent.begin();
      const TopoDS_Face faceA = TopoDS::Face(*it);
      ++it;
      const TopoDS_Face faceB = TopoDS::Face(*it);
      // A SEAM has the same face on both sides -- the closing line of a bore is
      // the standard example. "How does this face meet itself" is not a
      // continuity question, so it is not counted as one either: `sharedEdges`
      // is the number of joins there ARE, so a shortfall against `joins` can
      // only mean the cap was reached.
      if (faceA.IsSame(faceB)) continue;
      ++out.sharedEdges;
      if (out.joins.size() >= kQualityMaxJoins) {
        out.continuityCapped = true;
        continue;
      }
      QualityJoin join;
      join.faceA = faceMap.Contains(faceA) ? faceMap.FindIndex(faceA) : 0;
      join.faceB = faceMap.Contains(faceB) ? faceMap.FindIndex(faceB) : 0;
      if (join.faceA > join.faceB) std::swap(join.faceA, join.faceB);
      OwnedHandle ha(reg.add(faceA));
      OwnedHandle hb(reg.add(faceB));
      OwnedHandle he(reg.add(TopoDS::Edge(edgeFaces.FindKey(k))));
      try {
        const forge::classa::ContinuityReport rep = forge::classa::continuityCheck(
            ha.get(), hb.get(), he.get(), kQualityContinuitySamples);
        join.g0mm = rep.g0_max_mm;
        join.g1deg = rep.g1_max_deg;
        join.g2pct = rep.g2_max_pct;
        join.samples = rep.samples;
        join.measured = rep.samples > 0;
      } catch (...) {}
      out.joins.push_back(join);
    }
    out.checkedContinuity = true;
  } catch (...) {}

  // ── draft ────────────────────────────────────────────────────────────────
  // The face KIND comes from the kernel's own face inventory, keyed by the same
  // 1-based face index the draft rows carry, so the two describe one face.
  // `faceFlatness` is filled by the per-face curvature pass below; a face
  // missing from it is one whose curvature could not be measured, and its draft
  // row says the caveat is unknown rather than saying the face is flat.
  std::map<int, bool> faceFlatness;
  std::map<int, std::pair<std::string, double>> faceKinds;
  try {
    for (const forge::FaceInfo& f : forge::faceInventory(h)) {
      faceKinds[f.index] = std::make_pair(f.kind, f.area);
    }
  } catch (...) {}

  // ── the per-face pass: is this face FLAT, and what does it stripe like ───
  // Both questions want the same registered face handle, so they share one walk.
  // The curvature answer is NOT capped -- it is nine samples per face and it is
  // what stops a curved face's single draft sample being read as a verdict on
  // the whole face -- while the stripe grid is, because it is four hundred.
  for (int k = 1; k <= faceMap.Extent(); ++k) {
    OwnedHandle hc(reg.add(faceMap(k)));
    try {
      const std::vector<forge::classa::CurvatureSample> curv =
          forge::classa::gaussianAndMeanCurvature(hc.get(), 3, 3);
      if (curv.empty()) continue;
      bool flat = true;
      for (const forge::classa::CurvatureSample& c : curv) {
        if (std::fabs(c.K_gaussian) > 1e-9 || std::fabs(c.H_mean) > 1e-9) {
          flat = false;
          break;
        }
      }
      faceFlatness[k] = flat;
    } catch (...) {
      // A face whose curvature will not evaluate is left UNKNOWN rather than
      // called flat: the caveat is what protects the reader, so its absence must
      // never be the default.
    }
  }


  try {
    const double n = std::sqrt(settings.pull[0] * settings.pull[0] +
                               settings.pull[1] * settings.pull[1] +
                               settings.pull[2] * settings.pull[2]);
    if (n > 1e-12) {
      const gp_Dir pull(settings.pull[0] / n, settings.pull[1] / n, settings.pull[2] / n);
      const std::vector<forge::mold::DraftFace> rows =
          forge::mold::analyseDraft(*shape, pull, settings.draftThresholdDeg);
      for (const forge::mold::DraftFace& d : rows) {
        QualityDraftFace row;
        row.face = faceMap.Contains(d.face) ? faceMap.FindIndex(d.face) : 0;
        row.angleDeg = d.angleDeg;
        // The three verdicts are the kernel's, not a re-derivation: a face that
        // stands along the pull is reported as standing even when the sign of
        // its normal would otherwise call it one of the other two.
        if (d.isVertical) {
          row.verdict = DraftVerdict::Vertical;
          ++out.standingVertical;
        } else if (d.isNegative) {
          row.verdict = DraftVerdict::Undercut;
          ++out.undercutting;
        } else {
          row.verdict = DraftVerdict::Releases;
          ++out.releasing;
        }
        const auto found = faceKinds.find(row.face);
        if (found != faceKinds.end()) {
          row.kind = found->second.first;
          row.area = found->second.second;
        }
        const auto flat = faceFlatness.find(row.face);
        if (flat != faceFlatness.end()) {
          row.flat = flat->second;
          row.curvatureMeasured = true;
        }
        out.draft.push_back(row);
      }
      out.checkedDraft = !rows.empty();
    }
  } catch (...) {}

  // ── zebra ────────────────────────────────────────────────────────────────
  try {
    for (int k = 1; k <= faceMap.Extent(); ++k) {
      if (out.zebra.size() >= kQualityMaxZebraFaces) {
        out.zebraCapped = true;
        break;
      }
      OwnedHandle hf(reg.add(faceMap(k)));
      QualityZebraFace face;
      face.face = k;
      try {
        const std::vector<forge::classa::ZebraSample> samples =
            forge::classa::zebraStripes(hf.get(), settings.stripeCount, settings.light[0],
                                        settings.light[1], settings.light[2],
                                        kQualityZebraGrid, kQualityZebraGrid);
        if (samples.empty()) continue;
        face.gridW = kQualityZebraGrid;
        face.gridH = kQualityZebraGrid;
        face.stripes.reserve(samples.size());
        std::vector<bool> present(256, false);
        for (const forge::classa::ZebraSample& s : samples) {
          const std::uint8_t band = static_cast<std::uint8_t>(s.stripeIndex & 0xFFu);
          face.stripes.push_back(band);
          present[band] = true;
        }
        for (bool p : present) {
          if (p) ++face.bands;
        }
      } catch (...) {
        continue;
      }
      if (face.stripes.empty()) continue;
      out.zebra.push_back(std::move(face));
    }
    out.checkedZebra = !out.zebra.empty();
  } catch (...) {}

  return out;
}

// ── the wire format ────────────────────────────────────────────────────────
namespace {

void writeVec(std::ostringstream& os, const char* key, const double v[3]) {
  os << key << ' ' << v[0] << ' ' << v[1] << ' ' << v[2] << '\n';
}

}  // namespace

std::string encodeQualityReport(const ModelQualityReport& report) {
  std::ostringstream os;
  os.precision(17);
  os << kQualityResultMagic << '\n';
  os << "ran " << (report.ran ? 1 : 0) << '\n';
  os << "unavailableBytes " << report.unavailable.size() << '\n';
  os << report.unavailable << '\n';
  writeVec(os, "pull", report.pull);
  writeVec(os, "light", report.light);
  os << "draftThreshold " << report.draftThresholdDeg << '\n';
  os << "stripeCount " << report.stripeCount << '\n';
  os << "clashTolerance " << report.clashTolerance << '\n';

  os << "shape " << (report.checkedShape ? 1 : 0) << ' ' << (report.shapeValid ? 1 : 0) << ' '
     << report.faultyCount << ' ' << report.faults.size() << '\n';
  for (const std::string& f : report.faults) os << "fault " << f << '\n';

  os << "closure " << (report.checkedClosure ? 1 : 0) << ' ' << (report.closed ? 1 : 0) << ' '
     << (report.manifold ? 1 : 0) << ' ' << (report.oriented ? 1 : 0) << ' '
     << (report.selfIntersecting ? 1 : 0) << ' ' << (report.nonManifoldEdge ? 1 : 0) << ' '
     << report.badFaces << ' ' << report.badEdges << '\n';

  os << "mass " << (report.checkedMass ? 1 : 0) << ' ' << report.volume << ' ' << report.area
     << ' ' << report.com[0] << ' ' << report.com[1] << ' ' << report.com[2] << '\n';
  os << "box " << (report.checkedBox ? 1 : 0) << ' ' << report.bboxMin[0] << ' '
     << report.bboxMin[1] << ' ' << report.bboxMin[2] << ' ' << report.bboxMax[0] << ' '
     << report.bboxMax[1] << ' ' << report.bboxMax[2] << '\n';
  os << "counts " << (report.checkedCounts ? 1 : 0) << ' ' << report.faceCount << ' '
     << report.edgeCount << '\n';
  os << "topology " << (report.checkedTopology ? 1 : 0) << ' ' << report.genus << ' '
     << report.shells << ' ' << report.topoVertices << ' ' << report.topoEdges << ' '
     << report.topoFaces << '\n';

  os << "clashes " << (report.checkedClashes ? 1 : 0) << ' ' << report.solids.size() << ' '
     << report.clashes.size() << '\n';
  for (const QualitySolid& s : report.solids) {
    os << "solid " << s.index << ' ' << (s.measured ? 1 : 0) << ' ' << s.volume << ' ' << s.area
       << ' ' << s.com[0] << ' ' << s.com[1] << ' ' << s.com[2] << ' ' << s.bboxMin[0] << ' '
       << s.bboxMin[1] << ' ' << s.bboxMin[2] << ' ' << s.bboxMax[0] << ' ' << s.bboxMax[1]
       << ' ' << s.bboxMax[2] << '\n';
  }
  for (const QualityClash& c : report.clashes) {
    os << "clash " << c.solidA << ' ' << c.solidB << ' ' << c.volume << ' ' << c.commonVolume
       << ' ' << (c.located ? 1 : 0) << ' ' << c.com[0] << ' ' << c.com[1] << ' ' << c.com[2]
       << ' ' << c.bboxMin[0] << ' ' << c.bboxMin[1] << ' ' << c.bboxMin[2] << ' '
       << c.bboxMax[0] << ' ' << c.bboxMax[1] << ' ' << c.bboxMax[2] << '\n';
  }

  os << "continuity " << (report.checkedContinuity ? 1 : 0) << ' ' << report.sharedEdges << ' '
     << report.joins.size() << ' ' << (report.continuityCapped ? 1 : 0) << '\n';
  for (const QualityJoin& j : report.joins) {
    os << "join " << j.faceA << ' ' << j.faceB << ' ' << j.g0mm << ' ' << j.g1deg << ' '
       << j.g2pct << ' ' << j.samples << ' ' << (j.measured ? 1 : 0) << '\n';
  }

  os << "draft " << (report.checkedDraft ? 1 : 0) << ' ' << report.draft.size() << ' '
     << report.releasing << ' ' << report.undercutting << ' ' << report.standingVertical << '\n';
  for (const QualityDraftFace& d : report.draft) {
    os << "draftface " << d.face << ' ' << static_cast<int>(d.verdict) << ' ' << d.angleDeg
       << ' ' << d.area << ' ' << (d.flat ? 1 : 0) << ' ' << (d.curvatureMeasured ? 1 : 0) << ' '
       << (d.kind.empty() ? std::string("-") : d.kind) << '\n';
  }

  os << "zebra " << (report.checkedZebra ? 1 : 0) << ' ' << report.zebra.size() << ' '
     << (report.zebraCapped ? 1 : 0) << '\n';
  for (const QualityZebraFace& z : report.zebra) {
    os << "zebraface " << z.face << ' ' << z.gridW << ' ' << z.gridH << ' ' << z.bands << ' '
       << z.stripes.size();
    for (std::uint8_t b : z.stripes) os << ' ' << static_cast<unsigned>(b);
    os << '\n';
  }
  os << "end\n";
  return os.str();
}

bool decodeQualityReport(const std::string& payload, ModelQualityReport& out,
                         std::string& failure) {
  out = ModelQualityReport{};
  failure.clear();
  std::istringstream is(payload);
  std::string magic;
  if (!std::getline(is, magic) || magic != kQualityResultMagic) {
    failure = "the check did not report in the expected form";
    return false;
  }
  std::string line;
  bool sawEnd = false;
  while (std::getline(is, line)) {
    if (line == "end") { sawEnd = true; break; }
    std::istringstream ls(line);
    std::string key;
    ls >> key;
    if (key == "ran") {
      int v = 0;
      ls >> v;
      out.ran = v != 0;
    } else if (key == "unavailableBytes") {
      std::size_t n = 0;
      ls >> n;
      std::string text;
      if (!std::getline(is, text)) {
        failure = "the check's answer ended early";
        return false;
      }
      if (text.size() != n) {
        failure = "the check's answer did not match its own length";
        return false;
      }
      out.unavailable = text;
    } else if (key == "pull") {
      ls >> out.pull[0] >> out.pull[1] >> out.pull[2];
    } else if (key == "light") {
      ls >> out.light[0] >> out.light[1] >> out.light[2];
    } else if (key == "draftThreshold") {
      ls >> out.draftThresholdDeg;
    } else if (key == "stripeCount") {
      ls >> out.stripeCount;
    } else if (key == "clashTolerance") {
      ls >> out.clashTolerance;
    } else if (key == "shape") {
      int a = 0, b = 0;
      std::size_t n = 0;
      ls >> a >> b >> out.faultyCount >> n;
      out.checkedShape = a != 0;
      out.shapeValid = b != 0;
    } else if (key == "fault") {
      std::string rest;
      std::getline(ls, rest);
      if (!rest.empty() && rest[0] == ' ') rest.erase(0, 1);
      out.faults.push_back(rest);
    } else if (key == "closure") {
      int a = 0, b = 0, c = 0, d = 0, e = 0, f = 0;
      ls >> a >> b >> c >> d >> e >> f >> out.badFaces >> out.badEdges;
      out.checkedClosure = a != 0;
      out.closed = b != 0;
      out.manifold = c != 0;
      out.oriented = d != 0;
      out.selfIntersecting = e != 0;
      out.nonManifoldEdge = f != 0;
    } else if (key == "mass") {
      int a = 0;
      ls >> a >> out.volume >> out.area >> out.com[0] >> out.com[1] >> out.com[2];
      out.checkedMass = a != 0;
    } else if (key == "box") {
      int a = 0;
      ls >> a >> out.bboxMin[0] >> out.bboxMin[1] >> out.bboxMin[2] >> out.bboxMax[0] >>
          out.bboxMax[1] >> out.bboxMax[2];
      out.checkedBox = a != 0;
    } else if (key == "counts") {
      int a = 0;
      ls >> a >> out.faceCount >> out.edgeCount;
      out.checkedCounts = a != 0;
    } else if (key == "topology") {
      int a = 0;
      ls >> a >> out.genus >> out.shells >> out.topoVertices >> out.topoEdges >> out.topoFaces;
      out.checkedTopology = a != 0;
    } else if (key == "clashes") {
      int a = 0;
      std::size_t ns = 0, nc = 0;
      ls >> a >> ns >> nc;
      out.checkedClashes = a != 0;
    } else if (key == "solid") {
      QualitySolid s;
      int m = 0;
      ls >> s.index >> m >> s.volume >> s.area >> s.com[0] >> s.com[1] >> s.com[2] >>
          s.bboxMin[0] >> s.bboxMin[1] >> s.bboxMin[2] >> s.bboxMax[0] >> s.bboxMax[1] >>
          s.bboxMax[2];
      s.measured = m != 0;
      out.solids.push_back(s);
    } else if (key == "clash") {
      QualityClash c;
      int located = 0;
      ls >> c.solidA >> c.solidB >> c.volume >> c.commonVolume >> located >> c.com[0] >>
          c.com[1] >> c.com[2] >> c.bboxMin[0] >> c.bboxMin[1] >> c.bboxMin[2] >>
          c.bboxMax[0] >> c.bboxMax[1] >> c.bboxMax[2];
      c.located = located != 0;
      out.clashes.push_back(c);
    } else if (key == "continuity") {
      int a = 0, capped = 0;
      std::size_t n = 0;
      ls >> a >> out.sharedEdges >> n >> capped;
      out.checkedContinuity = a != 0;
      out.continuityCapped = capped != 0;
    } else if (key == "join") {
      QualityJoin j;
      int m = 0;
      ls >> j.faceA >> j.faceB >> j.g0mm >> j.g1deg >> j.g2pct >> j.samples >> m;
      j.measured = m != 0;
      out.joins.push_back(j);
    } else if (key == "draft") {
      int a = 0;
      std::size_t n = 0;
      ls >> a >> n >> out.releasing >> out.undercutting >> out.standingVertical;
      out.checkedDraft = a != 0;
    } else if (key == "draftface") {
      QualityDraftFace d;
      int verdict = 0;
      int flat = 0;
      int known = 0;
      ls >> d.face >> verdict >> d.angleDeg >> d.area >> flat >> known >> d.kind;
      d.flat = flat != 0;
      d.curvatureMeasured = known != 0;
      d.verdict = verdict == 1 ? DraftVerdict::Undercut
                               : (verdict == 2 ? DraftVerdict::Vertical : DraftVerdict::Releases);
      if (d.kind == "-") d.kind.clear();
      out.draft.push_back(d);
    } else if (key == "zebra") {
      int a = 0, capped = 0;
      std::size_t n = 0;
      ls >> a >> n >> capped;
      out.checkedZebra = a != 0;
      out.zebraCapped = capped != 0;
    } else if (key == "zebraface") {
      QualityZebraFace z;
      std::size_t n = 0;
      ls >> z.face >> z.gridW >> z.gridH >> z.bands >> n;
      z.stripes.reserve(n);
      for (std::size_t i = 0; i < n; ++i) {
        unsigned v = 0;
        if (!(ls >> v)) {
          failure = "one stripe row of the check's answer was cut short";
          return false;
        }
        z.stripes.push_back(static_cast<std::uint8_t>(v));
      }
      if (z.stripes.size() != static_cast<std::size_t>(z.gridW) * z.gridH) {
        failure = "one stripe row of the check's answer did not fill its own grid";
        return false;
      }
      out.zebra.push_back(std::move(z));
    } else if (!key.empty()) {
      failure = "the check reported something this version cannot read";
      return false;
    }
  }
  if (!sawEnd) {
    failure = "the check stopped before it finished reporting";
    return false;
  }
  return true;
}

}  // namespace forge::desktop
