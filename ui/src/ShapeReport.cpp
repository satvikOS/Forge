#include "forge/ui/ShapeReport.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace forge::ui {
namespace {

// The kinds forge::faceInventory gives a `radius` to. `torus` is included
// because its `radius` IS the major radius (DirectEdit.hpp says so), and a torus
// with no radius reported would be a 125-face part of the target census showing
// blank.
bool kindCarriesRadius(const std::string& kind) {
  return kind == "cylinder" || kind == "cone" || kind == "sphere" || kind == "torus";
}

// The kinds that carry an axis: everything faceInventory fills `direction` +
// `axisLocation` for. A plane carries a `direction` (its normal) but NOT an
// axis line, which is why the two questions are asked separately.
bool kindCarriesAxis(const std::string& kind) {
  return kind == "cylinder" || kind == "cone" || kind == "torus";
}

std::string jsonEscape(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 8);
  for (char c : s) {
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n";  break;
      case '\r': out += "\\r";  break;
      case '\t': out += "\\t";  break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          // A control byte has no literal form in JSON. Rendering it as \u00xx
          // by hand keeps this file free of <cstdio>.
          static const char* kHex = "0123456789abcdef";
          out += "\\u00";
          out += kHex[(static_cast<unsigned char>(c) >> 4) & 0xF];
          out += kHex[static_cast<unsigned char>(c) & 0xF];
        } else {
          out.push_back(c);
        }
    }
  }
  return out;
}

// A CSV cell. Quoted only when it has to be, and an embedded quote is doubled —
// the rule every spreadsheet reads. A kind name never needs it today; a backend
// string or an error message can.
std::string csvCell(const std::string& s) {
  const bool needsQuote = s.find_first_of(",\"\n\r") != std::string::npos;
  if (!needsQuote) return s;
  std::string out = "\"";
  for (char c : s) {
    if (c == '"') out += "\"\"";
    else out.push_back(c);
  }
  out += "\"";
  return out;
}

std::string triple(const double v[3]) {
  return "[" + measureNumber(v[0]) + "," + measureNumber(v[1]) + "," + measureNumber(v[2]) + "]";
}

std::string countField(const char* name, long v) {
  if (v == kUnmeasuredCount) return std::string();
  return std::string(",\"") + name + "\":" + std::to_string(v);
}

}  // namespace

// ── formatting ──────────────────────────────────────────────────────────────
// Deliberately forge_verify's num(): fixed(6) then trim trailing zeros, and the
// '.' too when nothing survives it. Reproduced rather than shared because
// forge::ui may not include a kernel header — and reproduced EXACTLY, because
// the whole point of the export is that it diffs against the verifier's own
// line. ui/test/shape_report_test.cpp pins the cases that differ between the
// two obvious spellings (1e-7 -> "0", not "1e-07"; 12.0 -> "12", not "12.000000").
std::string measureNumber(double v) {
  if (!std::isfinite(v)) return "null";
  std::ostringstream os;
  os.precision(6);
  os << std::fixed << v;
  std::string s = os.str();
  const std::size_t last = s.find_last_not_of('0');
  if (last == std::string::npos) return s;
  std::size_t end = last;
  if (s[end] == '.') --end;
  return s.substr(0, end + 1);
}

// ── FaceCensusEntry ─────────────────────────────────────────────────────────
bool FaceCensusEntry::hasRadius() const noexcept { return kindCarriesRadius(kind); }
bool FaceCensusEntry::hasAxis() const noexcept { return kindCarriesAxis(kind); }

double FaceCensusEntry::axialSpan() const noexcept {
  if (kind != "cylinder") return 0.0;
  const double span = vMax - vMin;
  return span > 0.0 ? span : 0.0;
}

// ── ShapeReport ─────────────────────────────────────────────────────────────
double ShapeReport::bboxSize(std::size_t axis) const noexcept {
  if (!bboxValid || axis > 2) return 0.0;
  return bboxMax[axis] - bboxMin[axis];
}

double ShapeReport::bboxDiagonal() const noexcept {
  if (!bboxValid) return 0.0;
  const double dx = bboxMax[0] - bboxMin[0];
  const double dy = bboxMax[1] - bboxMin[1];
  const double dz = bboxMax[2] - bboxMin[2];
  return std::sqrt(dx * dx + dy * dy + dz * dz);
}

void ShapeReport::bboxCentre(double out[3]) const noexcept {
  for (std::size_t i = 0; i < 3; ++i) {
    out[i] = bboxValid ? 0.5 * (bboxMin[i] + bboxMax[i]) : 0.0;
  }
}

double ShapeReport::censusArea() const noexcept {
  double total = 0.0;
  for (const FaceCensusEntry& f : faces) total += f.area;
  return total;
}

// ── derived queries ─────────────────────────────────────────────────────────
std::vector<KindCount> kindHistogram(const ShapeReport& report) {
  std::map<std::string, KindCount> byKind;
  for (const FaceCensusEntry& f : report.faces) {
    KindCount& k = byKind[f.kind];
    k.kind = f.kind;
    ++k.count;
    k.area += f.area;
  }
  std::vector<KindCount> out;
  out.reserve(byKind.size());
  for (const auto& [name, count] : byKind) {
    (void)name;
    out.push_back(count);
  }
  return out;  // std::map iterates in key order, so this is sorted by kind
}

long faceKindCount(const ShapeReport& report, const std::string& kind) {
  long n = 0;
  for (const FaceCensusEntry& f : report.faces) {
    if (f.kind == kind) ++n;
  }
  return n;
}

std::vector<std::size_t> boresByRadius(const ShapeReport& report) {
  std::vector<std::size_t> idx(report.bores.size());
  for (std::size_t i = 0; i < idx.size(); ++i) idx[i] = i;
  const std::vector<BoreEntry>& b = report.bores;
  std::stable_sort(idx.begin(), idx.end(), [&b](std::size_t l, std::size_t r) {
    if (b[l].radius != b[r].radius) return b[l].radius > b[r].radius;
    if (b[l].span != b[r].span) return b[l].span > b[r].span;
    return l < r;
  });
  return idx;
}

std::size_t largestBore(const ShapeReport& report) {
  const std::vector<std::size_t> order = boresByRadius(report);
  return order.empty() ? kNoBore : order.front();
}

std::size_t smallestBore(const ShapeReport& report) {
  // NOT `boresByRadius().back()`: that reverses the tie-breaks too, so two
  // equal-radius bores would return the one with the SHORTER span and the
  // HIGHER index — the opposite of the documented rule. Ties break the same way
  // at both ends: longer span first, then lower index.
  const std::vector<BoreEntry>& b = report.bores;
  if (b.empty()) return kNoBore;
  std::size_t best = 0;
  for (std::size_t i = 1; i < b.size(); ++i) {
    if (b[i].radius < b[best].radius) { best = i; continue; }
    if (b[i].radius > b[best].radius) continue;
    if (b[i].span > b[best].span) best = i;
  }
  return best;
}

// ── the census filter ───────────────────────────────────────────────────────
std::vector<std::size_t> queryFaceCensus(const ShapeReport& report,
                                         const FaceCensusQuery& query) {
  std::vector<std::size_t> out;
  out.reserve(report.faces.size());
  for (std::size_t i = 0; i < report.faces.size(); ++i) {
    const FaceCensusEntry& f = report.faces[i];
    if (!query.kind.empty() && f.kind != query.kind) continue;
    // concaveOnly and convexOnly TOGETHER select nothing, and that is the
    // honest answer to "faces that are both": a UI offering two exclusive
    // toggles must not silently drop one of them.
    if (query.concaveOnly && !f.concave) continue;
    if (query.convexOnly && f.concave) continue;
    if (query.radiusOnly && !f.hasRadius()) continue;
    if (f.area < query.minArea) continue;
    if (query.maxArea > 0.0 && f.area > query.maxArea) continue;
    if (query.minRadius > 0.0 || query.maxRadius > 0.0) {
      // A radius bound is a statement ABOUT a radius; a face with none cannot
      // satisfy it, so it is excluded rather than treated as radius 0.
      if (!f.hasRadius()) continue;
      if (f.radius < query.minRadius) continue;
      if (query.maxRadius > 0.0 && f.radius > query.maxRadius) continue;
    }
    out.push_back(i);
  }

  const std::vector<FaceCensusEntry>& F = report.faces;
  switch (query.sort) {
    case FaceCensusQuery::Sort::Index:
      break;  // already in face order
    case FaceCensusQuery::Sort::AreaDesc:
      std::stable_sort(out.begin(), out.end(), [&F](std::size_t l, std::size_t r) {
        return F[l].area != F[r].area ? F[l].area > F[r].area : F[l].index < F[r].index;
      });
      break;
    case FaceCensusQuery::Sort::AreaAsc:
      std::stable_sort(out.begin(), out.end(), [&F](std::size_t l, std::size_t r) {
        return F[l].area != F[r].area ? F[l].area < F[r].area : F[l].index < F[r].index;
      });
      break;
    case FaceCensusQuery::Sort::RadiusDesc:
      std::stable_sort(out.begin(), out.end(), [&F](std::size_t l, std::size_t r) {
        return F[l].radius != F[r].radius ? F[l].radius > F[r].radius : F[l].index < F[r].index;
      });
      break;
    case FaceCensusQuery::Sort::RadiusAsc:
      std::stable_sort(out.begin(), out.end(), [&F](std::size_t l, std::size_t r) {
        return F[l].radius != F[r].radius ? F[l].radius < F[r].radius : F[l].index < F[r].index;
      });
      break;
    case FaceCensusQuery::Sort::Kind:
      std::stable_sort(out.begin(), out.end(), [&F](std::size_t l, std::size_t r) {
        return F[l].kind != F[r].kind ? F[l].kind < F[r].kind : F[l].index < F[r].index;
      });
      break;
  }
  return out;
}

// ── export ──────────────────────────────────────────────────────────────────
std::string shapeReportJson(const ShapeReport& report) {
  std::string o = "{";
  o += "\"measured\":";
  o += report.measured ? "true" : "false";
  if (!report.error.empty()) o += ",\"error\":\"" + jsonEscape(report.error) + "\"";
  if (!report.backend.empty()) o += ",\"backend\":\"" + jsonEscape(report.backend) + "\"";
  if (!report.measured) {
    o += "}";
    return o;
  }

  o += ",\"valid\":";
  o += report.valid ? "true" : "false";
  o += ",\"volume\":" + measureNumber(report.volume);
  o += countField("faceCount", report.faceCount);
  o += countField("edgeCount", report.edgeCount);
  o += countField("vertexCount", report.vertexCount);
  o += countField("genus", report.genus);
  o += countField("shellCount", report.shellCount);
  if (report.surfaceArea > 0.0) o += ",\"surfaceArea\":" + measureNumber(report.surfaceArea);
  if (report.bboxValid) {
    o += ",\"bbox\":{\"min\":" + triple(report.bboxMin) + ",\"max\":" + triple(report.bboxMax) + "}";
  }
  if (report.hasCentreOfMass) o += ",\"com\":" + triple(report.centreOfMass);

  o += ",\"bores\":[";
  for (std::size_t i = 0; i < report.bores.size(); ++i) {
    if (i) o += ",";
    const BoreEntry& b = report.bores[i];
    o += "{\"cx\":" + measureNumber(b.at[0]) + ",\"cy\":" + measureNumber(b.at[1]) +
         ",\"r\":" + measureNumber(b.radius) + ",\"span\":" + measureNumber(b.span) +
         ",\"at\":" + triple(b.at) + ",\"axis\":" + triple(b.axis) +
         ",\"faces\":" + std::to_string(b.faces) + "}";
  }
  o += "]";
  if (!report.boresDegraded.empty()) {
    o += ",\"boresDegraded\":\"" + jsonEscape(report.boresDegraded) + "\"";
  } else if (report.boresFellBack > 0) {
    o += ",\"boresFellBack\":" + std::to_string(report.boresFellBack);
  }

  if (report.hasCensus()) {
    o += ",\"census\":{\"faceCount\":" + std::to_string(report.faces.size()) +
         ",\"kind_histogram\":{";
    const std::vector<KindCount> hist = kindHistogram(report);
    for (std::size_t i = 0; i < hist.size(); ++i) {
      if (i) o += ",";
      o += "\"" + jsonEscape(hist[i].kind) + "\":" + std::to_string(hist[i].count);
    }
    o += "},\"faces\":[";
    for (std::size_t i = 0; i < report.faces.size(); ++i) {
      if (i) o += ",";
      const FaceCensusEntry& f = report.faces[i];
      o += "{\"kind\":\"" + jsonEscape(f.kind) + "\",\"area\":" + measureNumber(f.area) +
           ",\"centroid\":" + triple(f.centroid);
      if (f.hasRadius()) {
        if (f.kind == "torus") {
          o += ",\"major\":" + measureNumber(f.radius) +
               ",\"minor\":" + measureNumber(f.minorRadius);
        } else {
          o += ",\"radius\":" + measureNumber(f.radius);
        }
      }
      if (f.hasAxis()) {
        o += ",\"axis\":" + triple(f.direction) + ",\"axisAt\":" + triple(f.axisLocation);
      }
      if (f.kind == "plane") o += ",\"normal\":" + triple(f.direction);
      o += ",\"concave\":";
      o += f.concave ? "true" : "false";
      o += "}";
    }
    o += "]}";
  }
  o += "}";
  return o;
}

std::string faceCensusCsv(const ShapeReport& report) {
  std::string out =
      "index,kind,area,cx,cy,cz,radius,minorRadius,concave,dirx,diry,dirz,"
      "axisx,axisy,axisz\n";
  for (const FaceCensusEntry& f : report.faces) {
    out += std::to_string(f.index);
    out += ",";
    out += csvCell(f.kind);
    out += "," + measureNumber(f.area);
    out += "," + measureNumber(f.centroid[0]);
    out += "," + measureNumber(f.centroid[1]);
    out += "," + measureNumber(f.centroid[2]);
    // An empty cell, not a zero: a plane has no radius, and "0" is a number a
    // spreadsheet will happily average.
    out += ",";
    if (f.hasRadius()) out += measureNumber(f.radius);
    out += ",";
    if (f.kind == "torus") out += measureNumber(f.minorRadius);
    out += ",";
    out += f.concave ? "1" : "0";
    out += "," + measureNumber(f.direction[0]);
    out += "," + measureNumber(f.direction[1]);
    out += "," + measureNumber(f.direction[2]);
    out += ",";
    if (f.hasAxis()) {
      out += measureNumber(f.axisLocation[0]) + "," + measureNumber(f.axisLocation[1]) + "," +
             measureNumber(f.axisLocation[2]);
    } else {
      out += ",,";
    }
    out += "\n";
  }
  return out;
}

std::string shapeReportText(const ShapeReport& report) {
  std::string out;
  if (!report.measured) {
    out += "no measured body";
    if (!report.error.empty()) out += ": " + report.error;
    out += "\n";
    return out;
  }
  out += std::string("valid          ") + (report.valid ? "yes" : "NO") + "\n";
  out += "volume         " + measureNumber(report.volume) + " mm3\n";
  if (report.surfaceArea > 0.0) {
    out += "surface area   " + measureNumber(report.surfaceArea) + " mm2\n";
  }
  const auto count = [&out](const char* label, long v) {
    out += label;
    out += (v == kUnmeasuredCount) ? std::string("not measured") : std::to_string(v);
    out += "\n";
  };
  count("faces          ", report.faceCount);
  count("edges          ", report.edgeCount);
  count("vertices       ", report.vertexCount);
  count("genus          ", report.genus);
  count("shells         ", report.shellCount);
  if (report.bboxValid) {
    out += "bbox           " + measureNumber(report.bboxSize(0)) + " x " +
           measureNumber(report.bboxSize(1)) + " x " + measureNumber(report.bboxSize(2)) + " mm\n";
    out += "bbox min       " + triple(report.bboxMin) + "\n";
    out += "bbox max       " + triple(report.bboxMax) + "\n";
  }
  if (report.hasCentreOfMass) {
    out += "centre of mass " + triple(report.centreOfMass) + "\n";
  }
  out += "holes          " + std::to_string(report.bores.size());
  if (!report.boresDegraded.empty()) {
    out += "  (DEGRADED — over-count: " + report.boresDegraded + ")";
  } else if (report.boresFellBack > 0) {
    out += "  (" + std::to_string(report.boresFellBack) + " face(s) fell back)";
  }
  out += "\n";
  const std::vector<std::size_t> order = boresByRadius(report);
  for (std::size_t rank = 0; rank < order.size(); ++rank) {
    const BoreEntry& b = report.bores[order[rank]];
    out += "  hole " + std::to_string(order[rank]) + "  dia " + measureNumber(b.diameter()) +
           "  span " + measureNumber(b.span) + "  at " + triple(b.at) + "  axis " +
           triple(b.axis) + "  (" + std::to_string(b.faces) + " face(s))\n";
  }
  if (report.hasCensus()) {
    out += "face census    " + std::to_string(report.faces.size()) + " faces\n";
    for (const KindCount& k : kindHistogram(report)) {
      out += "  " + k.kind + " " + std::to_string(k.count) + "  area " + measureNumber(k.area) +
             "\n";
    }
  }
  return out;
}

}  // namespace forge::ui
