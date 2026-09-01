// ui/test/feature_ir_test.cpp
//
// CONTRACT — the UI's feature-IR emitter agrees with the KERNEL, not with itself.
//
// forge::ui ships a copy of forge::ft's op table (op name, required-arg count,
// required+optional count, and whether the first argument is a value ref). A
// copy rots silently, and a rotted copy is worse than no table at all: the UI
// would emit statements the kernel rejects while every UI gate stayed green.
//
// So this gate does NOT assert the table against a hand-written expectation. It
// RE-DERIVES all four columns by parsing the documented argument lists out of
// forge-kernel/include/forge/ft/FeatureTree.hpp — the file that defines the
// grammar — and diffs them against ui/src/FeatureIr.cpp. Add an optional
// argument to HOLE in the kernel and this test goes red until the UI follows.
//
// The kernel header is read as DATA. It is not compiled or linked, so this stays
// a headless, OCCT-free, node-free gate.
#include <algorithm>
#include <cstddef>
#include <fstream>
#include <map>
#include <string>
#include <vector>

#include "forge/ui/FeatureIr.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// ── the kernel header, parsed as data ───────────────────────────────────────
struct DerivedSpec {
  std::size_t minArgs = 0;
  std::size_t maxArgs = 0;
  bool firstArgIsValueRef = false;
  bool seen = false;
};

std::string trimmed(const std::string& s) {
  std::size_t a = 0;
  std::size_t b = s.size();
  while (a < b && (s[a] == ' ' || s[a] == '\t')) ++a;
  while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\r')) --b;
  return s.substr(a, b - a);
}

// Split on ',' at bracket/paren depth 0; trims and drops empty tokens.
std::vector<std::string> splitTop(const std::string& s) {
  std::vector<std::string> out;
  std::string cur;
  int depth = 0;
  for (char c : s) {
    if (c == '(' || c == '[') ++depth;
    if (c == ')' || c == ']') --depth;
    if (c == ',' && depth == 0) {
      const std::string t = trimmed(cur);
      if (!t.empty()) out.push_back(t);
      cur.clear();
    } else {
      cur += c;
    }
  }
  const std::string t = trimmed(cur);
  if (!t.empty()) out.push_back(t);
  return out;
}

// `%w2 ...` and `...` mark a variadic tail. `[x y; x y; ...]` does NOT — the
// ellipsis there is inside a point-ring literal, which is ONE argument.
bool variadicToken(const std::string& t) {
  if (t.size() < 3) return false;
  if (t.front() == '[') return false;
  return t.compare(t.size() - 3, 3, "...") == 0;
}

// Derive (min, max, firstArgIsValueRef) from one documented form, e.g.
// `%body, dia, cx, cy, cz [, axx=0, axy=0, axz=1, depth<=0 => through]`.
DerivedSpec deriveForm(const std::string& args) {
  std::string head;
  std::vector<std::string> optionalGroups;
  std::size_t i = 0;
  while (i < args.size()) {
    if (args[i] == '[') {
      std::size_t j = i + 1;
      while (j < args.size() && args[j] == ' ') ++j;
      if (j < args.size() && args[j] == ',') {  // an OPTIONAL group, not a literal
        std::size_t k = i;
        int depth = 0;
        for (; k < args.size(); ++k) {
          if (args[k] == '[') ++depth;
          if (args[k] == ']') {
            --depth;
            if (depth == 0) break;
          }
        }
        optionalGroups.push_back(args.substr(i + 1, k > i ? k - i - 1 : 0));
        i = (k < args.size()) ? k + 1 : k;
        continue;
      }
    }
    head += args[i];
    ++i;
  }

  DerivedSpec spec;
  spec.seen = true;
  bool variadic = false;
  std::vector<std::string> required;
  for (const std::string& t : splitTop(head)) {
    if (variadicToken(t)) {
      variadic = true;
    } else {
      required.push_back(t);
    }
  }
  spec.minArgs = required.size();
  spec.firstArgIsValueRef = !required.empty() && required.front().front() == '%';
  if (variadic) {
    spec.maxArgs = kIrArgsUnbounded;
    return spec;
  }
  spec.maxArgs = spec.minArgs;
  for (const std::string& g : optionalGroups) {
    const std::vector<std::string> toks = splitTop(g);
    for (const std::string& t : toks) {
      if (variadicToken(t)) {
        spec.maxArgs = kIrArgsUnbounded;
        return spec;
      }
    }
    spec.maxArgs += toks.size();
  }
  return spec;
}

// The comment text after "//" is `NAME(...)  prose`. Returns "" if this line
// does not document a form.
bool readForm(const std::string& afterSlashes, std::string& name, std::string& argsOut) {
  const std::string t = trimmed(afterSlashes);
  std::size_t p = 0;
  while (p < t.size() && ((t[p] >= 'A' && t[p] <= 'Z') || (t[p] >= '0' && t[p] <= '9'))) ++p;
  if (p == 0 || p >= t.size() || t[p] != '(') return false;
  if (!(t.front() >= 'A' && t.front() <= 'Z')) return false;
  name = t.substr(0, p);

  int depth = 0;
  for (std::size_t k = p; k < t.size(); ++k) {
    if (t[k] == '(') ++depth;
    if (t[k] == ')') {
      --depth;
      if (depth == 0) {
        argsOut = t.substr(p + 1, k - p - 1);
        return true;
      }
    }
  }
  return false;
}

std::map<std::string, DerivedSpec> deriveKernelOpTable(const std::string& path, bool& opened) {
  std::map<std::string, DerivedSpec> table;
  std::ifstream in(path);
  opened = in.good();
  if (!opened) return table;

  std::string line;
  bool inEnum = false;
  std::string current;
  while (std::getline(in, line)) {
    if (line.find("enum class OpCode") != std::string::npos) {
      inEnum = true;
      continue;
    }
    if (!inEnum) continue;
    if (trimmed(line) == "};") break;

    const std::size_t c = line.find("//");
    if (c == std::string::npos) continue;
    const std::string before = trimmed(line.substr(0, c));
    const bool isPrimary = !before.empty() && before.back() == ',';
    if (!isPrimary && !before.empty()) continue;  // trailing prose on a code line

    std::string name;
    std::string args;
    if (!readForm(line.substr(c + 2), name, args)) continue;

    if (isPrimary) {
      table[name] = deriveForm(args);
      current = name;
      continue;
    }
    // A continuation line documents an ALTERNATE form of the op above it
    // (MIRROR, PATTERN and SWEEP each have more than one). Combine: the op
    // accepts the loosest arity of any form, and its first argument is a value
    // ref only if EVERY form says so.
    if (name != current) continue;
    DerivedSpec alt = deriveForm(args);
    DerivedSpec& cur = table[current];
    cur.minArgs = std::min(cur.minArgs, alt.minArgs);
    cur.maxArgs = (cur.maxArgs == kIrArgsUnbounded || alt.maxArgs == kIrArgsUnbounded)
                      ? kIrArgsUnbounded
                      : std::max(cur.maxArgs, alt.maxArgs);
    cur.firstArgIsValueRef = cur.firstArgIsValueRef && alt.firstArgIsValueRef;
  }
  return table;
}

std::string locateKernelHeader() {
  const char* candidates[] = {
#ifdef FORGE_UI_REPO_ROOT
      FORGE_UI_REPO_ROOT "/forge-kernel/include/forge/ft/FeatureTree.hpp",
#endif
      "forge-kernel/include/forge/ft/FeatureTree.hpp",
      "../forge-kernel/include/forge/ft/FeatureTree.hpp",
      "../../forge-kernel/include/forge/ft/FeatureTree.hpp",
  };
  for (const char* p : candidates) {
    std::ifstream in(p);
    if (in.good()) return p;
  }
  return {};
}

}  // namespace

int main() {
  Harness H("feature_ir");

  // ── 1. the UI table IS the kernel's table ─────────────────────────────────
  const std::string headerPath = locateKernelHeader();
  CHECK(!headerPath.empty());  // a gate that cannot find its oracle FAILS
  bool opened = false;
  const std::map<std::string, DerivedSpec> kernel = deriveKernelOpTable(headerPath, opened);
  CHECK(opened);
  // forge::ft::opFromName registers 47 ops: the original 40, plus the six that
  // give the SURFACE value kind its producers and consumers (SKIN / FACES / SEW
  // / THICKEN / CAP / SURFCHECK), plus SECTION. MEASURED on the merged tree --
  // the two sides of this merge said 46 and 41, and the answer is neither.
  // Anything else means the derivation itself broke, and a broken oracle must
  // not pass quietly.
  CHECK_EQ_INT(kernel.size(), 47);
  CHECK_EQ_INT(irOpTable().size(), kernel.size());

  for (const auto& [name, want] : kernel) {
    const IrOpSpec* got = findIrOp(name);
    CHECK(got != nullptr);
    if (got == nullptr) continue;
    CHECK_EQ_INT(got->minArgs, want.minArgs);
    // kIrArgsUnbounded is (size_t)-1; compare as the same type both sides.
    CHECK_EQ_INT(got->maxArgs == kIrArgsUnbounded ? -1 : static_cast<long long>(got->maxArgs),
                 want.maxArgs == kIrArgsUnbounded ? -1 : static_cast<long long>(want.maxArgs));
    CHECK_EQ_INT(got->firstArgIsValueRef ? 1 : 0, want.firstArgIsValueRef ? 1 : 0);
  }
  // and nothing in the UI table that the kernel does not have
  for (const IrOpSpec& spec : irOpTable()) {
    CHECK(kernel.find(spec.name) != kernel.end());
  }

  // spot-check the derivation itself against values read by eye out of the
  // kernel header, so a derivation that silently returned junk cannot pass
  CHECK_EQ_INT(kernel.at("HOLE").minArgs, 5);
  CHECK_EQ_INT(kernel.at("HOLE").maxArgs, 9);
  CHECK_EQ_INT(kernel.at("CBORE").minArgs, 7);
  CHECK_EQ_INT(kernel.at("FILLET").maxArgs, 3);
  CHECK_EQ_INT(kernel.at("PATTERN").minArgs, 4);   // %a, LINEAR, n, dx
  CHECK_EQ_INT(kernel.at("PATTERN").maxArgs, 10);  // the POLAR form with an axis
  CHECK_EQ_INT(kernel.at("MIRROR").minArgs, 2);    // MIRROR(%a, PLANE)
  CHECK_EQ_INT(kernel.at("MIRROR").maxArgs, 7);    // MIRROR(%a, p..., n...)
  CHECK(kernel.at("LOFT").maxArgs == kIrArgsUnbounded);
  CHECK(kernel.at("VERIFY").maxArgs == kIrArgsUnbounded);
  CHECK_EQ_INT(kernel.at("POLY").maxArgs, 1);      // [x y; ...] is ONE argument
  CHECK_EQ_INT(kernel.at("SWEEP").maxArgs, 2);
  CHECK_EQ_INT(kernel.at("INPUT").minArgs, 0);
  CHECK_EQ_INT(kernel.at("INPUT").maxArgs, 0);
  CHECK_EQ_INT(kernel.at("BOX").firstArgIsValueRef ? 1 : 0, 0);
  CHECK_EQ_INT(kernel.at("SHELL").firstArgIsValueRef ? 1 : 0, 1);

  // The SURFACE ops, read by eye out of the kernel header the same way. A count
  // that moved from 40 to 46 proves six enumerators appeared; only these prove
  // their documented ARGUMENT LISTS were derived rather than defaulted.
  CHECK_EQ_INT(kernel.at("SKIN").minArgs, 2);        // SKIN(%w0, %w1 [, %w2 ...])
  CHECK(kernel.at("SKIN").maxArgs == kIrArgsUnbounded);
  CHECK_EQ_INT(kernel.at("FACES").minArgs, 2);       // FACES(%body, "sel")
  CHECK_EQ_INT(kernel.at("FACES").maxArgs, 2);
  CHECK_EQ_INT(kernel.at("SEW").minArgs, 1);         // SEW(%s0 [, %s1 ...] [, tol])
  CHECK(kernel.at("SEW").maxArgs == kIrArgsUnbounded);
  CHECK_EQ_INT(kernel.at("THICKEN").minArgs, 2);     // THICKEN(%surface, wall [, side])
  CHECK_EQ_INT(kernel.at("THICKEN").maxArgs, 3);
  CHECK_EQ_INT(kernel.at("CAP").minArgs, 1);         // CAP(%surface [, tol])
  CHECK_EQ_INT(kernel.at("CAP").maxArgs, 2);
  CHECK_EQ_INT(kernel.at("SURFCHECK").minArgs, 2);   // SURFCHECK(%surface, "expr", ...)
  CHECK(kernel.at("SURFCHECK").maxArgs == kIrArgsUnbounded);
  // Every surface op transforms an existing value, so every one leads with a %ref.
  for (const char* op : {"SKIN", "FACES", "SEW", "THICKEN", "CAP", "SURFCHECK"}) {
    CHECK_EQ_INT(kernel.at(op).firstArgIsValueRef ? 1 : 0, 1);
  }

  // ── 2. emission is textually exact ────────────────────────────────────────
  CHECK_EQ_STR(formatIrNumber(12.0), "12");
  CHECK_EQ_STR(formatIrNumber(2.5), "2.5");
  CHECK_EQ_STR(formatIrNumber(-0.125), "-0.125");
  CHECK_EQ_STR(formatIrNumber(47.5), "47.5");
  CHECK_EQ_STR(formatIrNumber(0.0), "0");

  {
    IrLine line{4, "FILLET", {IrArg::valueRef(3), IrArg::num(2.5), IrArg::keyword("ALL")}};
    CHECK_EQ_STR(line.text(), "%4 = FILLET(%3, 2.5, ALL)");
    CHECK_EQ_INT(static_cast<int>(validateIr(line)), static_cast<int>(IrCheck::Ok));
  }
  {
    IrLine line{9, "RESIZEBORE", {IrArg::valueRef(8), IrArg::text("bore:r=47.5"), IrArg::num(50)}};
    CHECK_EQ_STR(line.text(), "%9 = RESIZEBORE(%8, \"bore:r=47.5\", 50)");
    CHECK_EQ_INT(static_cast<int>(validateIr(line)), static_cast<int>(IrCheck::Ok));
  }
  {
    IrLine line{1, "INPUT", {}};
    CHECK_EQ_STR(line.text(), "%1 = INPUT()");
    CHECK_EQ_INT(static_cast<int>(validateIr(line)), static_cast<int>(IrCheck::Ok));
  }

  // ── 3. every rejection has its own status ─────────────────────────────────
  {
    IrLine bad{3, "EXTRUDEZ", {IrArg::valueRef(1), IrArg::num(5)}};
    CHECK_EQ_INT(static_cast<int>(validateIr(bad)), static_cast<int>(IrCheck::UnknownOp));
  }
  {
    IrLine bad{3, "", {}};
    CHECK_EQ_INT(static_cast<int>(validateIr(bad)), static_cast<int>(IrCheck::EmptyOp));
  }
  {
    IrLine bad{0, "HEAL", {IrArg::valueRef(1)}};
    CHECK_EQ_INT(static_cast<int>(validateIr(bad)), static_cast<int>(IrCheck::BadStatementId));
  }
  {
    IrLine bad{3, "FILLET", {IrArg::valueRef(2)}};  // radius missing
    CHECK_EQ_INT(static_cast<int>(validateIr(bad)), static_cast<int>(IrCheck::TooFewArgs));
  }
  {
    IrLine bad{3,
               "FUSE",
               {IrArg::valueRef(1), IrArg::valueRef(2), IrArg::valueRef(2)}};  // FUSE takes 2
    CHECK_EQ_INT(static_cast<int>(validateIr(bad)), static_cast<int>(IrCheck::TooManyArgs));
  }
  {
    IrLine bad{3, "FILLET", {IrArg::num(2), IrArg::num(2.5)}};  // first arg must be %body
    CHECK_EQ_INT(static_cast<int>(validateIr(bad)),
                 static_cast<int>(IrCheck::FirstArgNotValueRef));
  }
  {
    IrLine bad{3, "FUSE", {IrArg::valueRef(1), IrArg::valueRef(7)}};  // %7 defined later
    CHECK_EQ_INT(static_cast<int>(validateIr(bad)), static_cast<int>(IrCheck::ForwardValueRef));
  }
  {
    IrLine bad{3, "FUSE", {IrArg::valueRef(1), IrArg::valueRef(3)}};  // self-reference
    CHECK_EQ_INT(static_cast<int>(validateIr(bad)), static_cast<int>(IrCheck::ForwardValueRef));
  }
  // a variadic op accepts far more than its minimum
  {
    IrLine ok{6,
              "LOFT",
              {IrArg::valueRef(1), IrArg::valueRef(2), IrArg::valueRef(3), IrArg::valueRef(4),
               IrArg::keyword("RULED")}};
    CHECK_EQ_INT(static_cast<int>(validateIr(ok)), static_cast<int>(IrCheck::Ok));
  }

  CHECK_EQ_STR(toString(IrCheck::Ok), "ok");
  CHECK_EQ_STR(toString(IrCheck::TooManyArgs), "too_many_args");
  CHECK_EQ_STR(toString(IrCheck::ForwardValueRef), "forward_value_ref");

  return H.finish();
}
