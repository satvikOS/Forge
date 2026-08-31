#include "forge/ui/FeatureIr.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace forge::ui {

// ── argument constructors ───────────────────────────────────────────────────
IrArg IrArg::num(double v) {
  IrArg a;
  a.kind = IrArgKind::Number;
  a.number = v;
  return a;
}

IrArg IrArg::valueRef(int id) {
  IrArg a;
  a.kind = IrArgKind::Ref;
  a.ref = id;
  return a;
}

IrArg IrArg::keyword(std::string k) {
  IrArg a;
  a.kind = IrArgKind::Keyword;
  a.word = std::move(k);
  return a;
}

IrArg IrArg::text(std::string s) {
  IrArg a;
  a.kind = IrArgKind::Text;
  a.word = std::move(s);
  return a;
}

bool parseIrPoints(const std::string& spec, std::size_t dim, std::vector<double>& out) {
  out.clear();
  if (dim < 2 || dim > 3) return false;
  std::size_t start = 0;
  while (true) {
    const std::size_t semi = spec.find(';', start);
    const std::string group =
        spec.substr(start, semi == std::string::npos ? std::string::npos : semi - start);
    // A trailing or repeated ';' contributes no point rather than a bad one --
    // the same tolerance forge::ft's tokenizer shows ("if (ps.empty()) continue").
    std::istringstream in(group);
    std::string word;
    std::size_t got = 0;
    while (in >> word) {
      const char* begin = word.c_str();
      char* end = nullptr;
      const double v = std::strtod(begin, &end);
      if (end == begin || *end != '\0' || !std::isfinite(v)) {
        out.clear();
        return false;
      }
      out.push_back(v);
      ++got;
    }
    if (got != 0 && got != dim) {   // "20 0" in a 3D ring is a MISSING coordinate
      out.clear();
      return false;
    }
    if (semi == std::string::npos) break;
    start = semi + 1;
  }
  if (out.empty()) return false;    // "empty point list", exactly as the kernel says
  return true;
}

bool irPointsWellFormed(const std::string& spec, std::size_t dim, std::size_t minPoints) {
  std::vector<double> coords;
  if (!parseIrPoints(spec, dim, coords)) return false;
  return coords.size() / dim >= minPoints;
}

namespace {
IrArg makePoints(const std::string& spec, std::size_t dim) {
  IrArg a;
  a.kind = IrArgKind::Points;
  a.dim = dim;
  // Discarding the answer is deliberate: parseIrPoints leaves `coords` EMPTY on
  // failure, and an empty POINTS argument is exactly what validateIr refuses by
  // name. Reporting the failure twice, once here and once there, would give two
  // places to change the rule.
  (void)parseIrPoints(spec, dim, a.coords);
  return a;
}
}  // namespace

IrArg IrArg::points2(const std::string& spec) { return makePoints(spec, 2); }
IrArg IrArg::points3(const std::string& spec) { return makePoints(spec, 3); }

std::size_t IrArg::pointCount() const noexcept {
  if (kind != IrArgKind::Points || dim == 0) return 0;
  return coords.size() / dim;
}

std::string IrArg::pointSpec() const {
  if (kind != IrArgKind::Points || dim == 0) return {};
  std::string out;
  for (std::size_t i = 0; i + dim <= coords.size(); i += dim) {
    if (i != 0) out += "; ";
    for (std::size_t k = 0; k < dim; ++k) {
      if (k != 0) out += " ";
      out += formatIrNumber(coords[i + k]);
    }
  }
  return out;
}

// forge::ft's parseDouble is std::strtod, so "%.10g" round-trips every value a
// UI dimension field can hold and never emits a locale-dependent separator.
// snprintf is used rather than std::to_string because to_string always prints
// six decimals: `12.000000` is legal IR but unreadable in a diff of an emitted
// tree, and every emitted tree in this repo is read by a human at some point.
std::string formatIrNumber(double v) {
  char buf[40];
  const int n = std::snprintf(buf, sizeof(buf), "%.10g", v);
  if (n <= 0) return "0";
  return std::string(buf, static_cast<std::size_t>(n));
}

std::string IrArg::token() const {
  switch (kind) {
    case IrArgKind::Number:  return formatIrNumber(number);
    case IrArgKind::Ref:     return "%" + std::to_string(ref);
    case IrArgKind::Keyword: return word;
    case IrArgKind::Text:    return "\"" + word + "\"";
    case IrArgKind::Points:  return "[" + pointSpec() + "]";
  }
  return formatIrNumber(number);
}

std::string IrLine::text() const {
  std::string out = "%";
  out += std::to_string(id);
  out += " = ";
  out += op;
  out += "(";
  for (std::size_t i = 0; i < args.size(); ++i) {
    if (i != 0) out += ", ";
    out += args[i].token();
  }
  out += ")";
  return out;
}

// ── the op table ────────────────────────────────────────────────────────────
// Transcribed from the `enum class OpCode` comment table in
// forge-kernel/include/forge/ft/FeatureTree.hpp. min/max are the documented
// required-argument count and required+optional count; ops whose documented
// form ends in `...` are unbounded. `firstArgIsValueRef` is true exactly when
// the header writes the first argument as `%something`.
//
// This is a COPY, and a copy silently rots. feature_ir_test.cpp re-derives all
// four columns from the kernel header itself and diffs them against this table,
// so the rot is caught by a red gate rather than by a wrong emission.
const std::vector<IrOpSpec>& irOpTable() {
  static const std::vector<IrOpSpec> table = {
      // 2D profiles
      {"RECT", 2, 4, false},
      {"RRECT", 3, 5, false},
      {"CIRCLE", 1, 3, false},
      {"SLOT", 2, 5, false},
      {"POLY", 1, 1, false},
      {"REGPOLY", 2, 5, false},
      // 3D section rings
      {"RING", 3, 7, false},
      {"WIRE", 1, 1, false},
      // 3D primitives
      {"BOX", 3, 6, false},
      {"CYL", 2, 8, false},
      {"CONE", 3, 9, false},
      {"SPHERE", 1, 4, false},
      {"TORUS", 2, 8, false},
      {"PRISM", 3, 6, false},
      {"TUBE", 3, 6, false},
      // sketch/wire -> solid
      {"EXTRUDE", 2, 5, true},
      {"REVOLVE", 2, 8, true},
      {"LOFT", 2, kIrArgsUnbounded, true},
      {"SWEEP", 2, 2, false},
      // booleans
      {"FUSE", 2, 2, true},
      {"CUT", 2, 2, true},
      {"COMMON", 2, 2, true},
      // transforms / replication
      {"TRANSLATE", 4, 4, true},
      {"ROTATE", 5, 8, true},
      {"MIRROR", 2, 7, true},
      {"PATTERN", 4, 10, true},
      // features
      {"HOLE", 5, 9, true},
      {"CBORE", 7, 10, true},
      {"FILLET", 2, 3, true},
      {"CHAMFER", 2, 3, true},
      {"BLEND", 3, 5, true},
      {"SHELL", 2, 5, true},
      {"FOLD", 8, 9, true},
      {"HEAL", 1, 1, true},
      // edit ops
      {"TAG", 3, 3, true},
      {"INPUT", 0, 0, false},
      {"PUSHFACE", 3, 3, true},
      {"RESIZEBORE", 3, 3, true},
      {"DEFEATURE", 2, 2, true},
      {"VERIFY", 2, kIrArgsUnbounded, true},
  };
  return table;
}

const IrOpSpec* findIrOp(const std::string& name) {
  const std::vector<IrOpSpec>& table = irOpTable();
  auto it = std::find_if(table.begin(), table.end(),
                         [&name](const IrOpSpec& s) { return s.name == name; });
  return it == table.end() ? nullptr : &*it;
}

const char* toString(IrCheck check) noexcept {
  switch (check) {
    case IrCheck::Ok:                  return "ok";
    case IrCheck::EmptyOp:             return "empty_op";
    case IrCheck::UnknownOp:           return "unknown_op";
    case IrCheck::BadStatementId:      return "bad_statement_id";
    case IrCheck::TooFewArgs:          return "too_few_args";
    case IrCheck::TooManyArgs:         return "too_many_args";
    case IrCheck::FirstArgNotValueRef: return "first_arg_not_value_ref";
    case IrCheck::ForwardValueRef:     return "forward_value_ref";
    case IrCheck::MalformedPointList:  return "malformed_point_list";
  }
  return "unknown_op";
}

IrCheck validateIr(const IrLine& line) {
  if (line.op.empty()) return IrCheck::EmptyOp;
  if (line.id <= 0) return IrCheck::BadStatementId;

  const IrOpSpec* spec = findIrOp(line.op);
  if (spec == nullptr) return IrCheck::UnknownOp;

  if (line.args.size() < spec->minArgs) return IrCheck::TooFewArgs;
  if (spec->maxArgs != kIrArgsUnbounded && line.args.size() > spec->maxArgs) {
    return IrCheck::TooManyArgs;
  }
  if (spec->firstArgIsValueRef &&
      (line.args.empty() || line.args.front().kind != IrArgKind::Ref)) {
    return IrCheck::FirstArgNotValueRef;
  }

  // Creation order == evaluation order: %N is only resolvable if N < this id.
  for (const IrArg& a : line.args) {
    if (a.kind != IrArgKind::Ref) continue;
    if (a.ref <= 0 || a.ref >= line.id) return IrCheck::ForwardValueRef;
  }

  // A POINTS argument the tokenizer would refuse. Both halves are the kernel's
  // rules: "empty point list" and "point needs `x y` or `x y z`". Without this an
  // unparsable spec would reach forge::ft as `WIRE([])`, which is a parse error
  // several layers away from the field the user typed into.
  for (const IrArg& a : line.args) {
    if (a.kind != IrArgKind::Points) continue;
    if (a.dim < 2 || a.dim > 3) return IrCheck::MalformedPointList;
    if (a.coords.empty() || a.coords.size() % a.dim != 0) return IrCheck::MalformedPointList;
  }
  return IrCheck::Ok;
}

}  // namespace forge::ui
