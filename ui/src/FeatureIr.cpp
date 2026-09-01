#include "forge/ui/FeatureIr.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
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

IrArg IrArg::points(std::vector<IrPoint> ring, int dim) {
  IrArg a;
  a.kind = IrArgKind::Points;
  a.pts = std::move(ring);
  // 2 or 3 and nothing else. A dim of 0 or 4 would render a token forge::ft's lexer
  // reads as a DIFFERENT ring -- it takes the first two coordinates of each point and
  // treats the rest as absent -- so a wrong dim is a silently wrong shape rather than a
  // refusal. Clamp to the only two spellings the grammar has.
  a.dim = (dim == 3) ? 3 : 2;
  return a;
}

IrArg IrArg::pointsFromText(const std::string& text, int dim) {
  return points(parseIrPoints(text, dim), dim);
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
    case IrArgKind::Points: {
      // `[x y; x y; ...]` / `[x y z; ...]` -- the spelling forge::ft's lexer reads: one
      // '[' ... ']' pair, points separated by ';', coordinates by whitespace. NO commas
      // anywhere inside, which is why an argument list carrying a ring (SWEEP's two) still
      // splits correctly at its top-level commas.
      std::string out = "[";
      for (std::size_t i = 0; i < pts.size(); ++i) {
        if (i != 0) out += "; ";
        out += formatIrNumber(pts[i].x);
        out += " ";
        out += formatIrNumber(pts[i].y);
        if (dim == 3) {
          out += " ";
          out += formatIrNumber(pts[i].z);
        }
      }
      out += "]";
      return out;
    }
  }
  return formatIrNumber(number);
}

// Hand-rolled over strtod rather than routed through a string stream, on purpose:
// forge::ft's parseDouble IS std::strtod, and strtod is what round-trips
// formatIrNumber's "%.10g" output exactly. Reading with a different converter here
// would let the value the app displays differ from the value the kernel builds in the
// last digit. (The symbol for that other converter is deliberately not written above:
// check_includes_ui.sh reads this file as TEXT and would demand the header for it.)
std::vector<IrPoint> parseIrPoints(const std::string& text, int dim) {
  const int want = (dim == 3) ? 3 : 2;
  std::vector<IrPoint> out;
  std::size_t i = 0;
  const std::size_t n = text.size();
  while (i <= n) {
    const std::size_t semi = text.find(';', i);
    const std::size_t end = (semi == std::string::npos) ? n : semi;
    const std::string chunk = text.substr(i, end - i);
    i = end + 1;
    // A trailing or doubled ';' contributes no point rather than a point at the origin.
    bool blank = true;
    for (const char ch : chunk) {
      if (!std::isspace(static_cast<unsigned char>(ch))) { blank = false; break; }
    }
    if (blank) {
      if (semi == std::string::npos) break;
      continue;
    }
    double coord[3] = {0.0, 0.0, 0.0};
    const char* cur = chunk.c_str();
    for (int k = 0; k < want; ++k) {
      char* next = nullptr;
      coord[k] = std::strtod(cur, &next);
      // strtod returns 0 with next == cur when it consumed nothing: too few coordinates.
      // A ring the user has not finished typing is not a SHORT ring, it is no ring --
      // report nothing rather than invent a point at the origin.
      if (next == cur) return {};
      if (!std::isfinite(coord[k])) return {};
      cur = next;
    }
    while (*cur != '\0' && std::isspace(static_cast<unsigned char>(*cur))) ++cur;
    // Trailing junk: `10 20 30` read as a 2D point, or `10 20 abc`. Both mean the text
    // says something this dim cannot express, and silently dropping the tail is exactly
    // how a 3D ring would become a flat one.
    if (*cur != '\0') return {};
    out.push_back(IrPoint{coord[0], coord[1], want == 3 ? coord[2] : 0.0});
    if (semi == std::string::npos) break;
  }
  return out;
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
      {"ARC", 1, 1, false},
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
      // the fourth boolean; same arity, different RESULT KIND (a WIRE, not a solid)
      {"SECTION", 2, 2, true},
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
      // surface sheets (produce a SURFACE)
      {"SKIN", 2, kIrArgsUnbounded, true},
      {"FACES", 2, 2, true},
      {"SEW", 1, kIrArgsUnbounded, true},
      {"THICKEN", 2, 3, true},
      {"CAP", 1, 2, true},
      {"SURFCHECK", 2, kIrArgsUnbounded, true},
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
    case IrCheck::EmptyPointList:      return "empty_point_list";
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

  // An empty ring renders as the literal `[]`, and forge::ft's lexer fails that
  // outright ("empty point list"). Checked AFTER the arity rules on purpose: a
  // statement with the wrong number of arguments is wrong whatever is in them, and
  // naming the smaller problem first would send the author to fix the ring.
  for (const IrArg& a : line.args) {
    if (a.kind == IrArgKind::Points && a.pts.empty()) return IrCheck::EmptyPointList;
  }
  return IrCheck::Ok;
}

}  // namespace forge::ui
