#include "forge/ui/MaterialCards.hpp"

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace forge::ui {
namespace {

// ════════════════════════════════════════════════════════════════════════════
// A READER FOR THE YAML THIS FILE FORMAT USES, AND NO MORE
// ════════════════════════════════════════════════════════════════════════════
// Block mappings and sequences by indentation, quoted and plain scalars, folded
// (>) and literal (|) block scalars, and flow sequences ([...]) that may run over
// several lines. That is every construct in FreeCAD's card and model files. What
// it does not recognise it REFUSES with a line number -- a reader that skipped an
// unfamiliar line would load a card with a property silently missing.

struct YNode {
  enum class Kind : std::uint8_t { Null, Scalar, Map, Seq };
  Kind kind = Kind::Null;
  std::string scalar;
  std::vector<std::pair<std::string, YNode>> map;
  std::vector<YNode> seq;

  const YNode* get(const std::string& key) const {
    if (kind != Kind::Map) return nullptr;
    for (const auto& kv : map) {
      if (kv.first == key) return &kv.second;
    }
    return nullptr;
  }
  std::string text(const std::string& key) const {
    const YNode* n = get(key);
    return (n != nullptr && n->kind == Kind::Scalar) ? n->scalar : std::string();
  }
};

struct RawLine {
  int indent = 0;
  std::string text;  // after the indent, comment and trailing space removed
  int number = 0;    // 1-based, for a refusal
  bool blank = true;
  std::string raw;   // the whole line, for block scalars
};

bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n'; }

std::string trim(const std::string& s) {
  std::size_t b = 0;
  std::size_t e = s.size();
  while (b < e && isSpace(s[b])) ++b;
  while (e > b && isSpace(s[e - 1])) --e;
  return s.substr(b, e - b);
}

// Removes a trailing `# comment` that is outside quotes and preceded by a space
// (or starts the text).
std::string stripComment(const std::string& s) {
  char quote = 0;
  for (std::size_t i = 0; i < s.size(); ++i) {
    const char c = s[i];
    if (quote != 0) {
      if (c == quote) {
        if (quote == '\'' && i + 1 < s.size() && s[i + 1] == '\'') {
          ++i;  // '' inside a single-quoted scalar
        } else {
          quote = 0;
        }
      } else if (quote == '"' && c == '\\') {
        ++i;
      }
      continue;
    }
    if (c == '"' || c == '\'') {
      // A quote only opens a scalar at the start of a value, never mid-word
      // ("it's" in a plain scalar is an apostrophe).
      if (i == 0 || isSpace(s[i - 1]) || s[i - 1] == '[' || s[i - 1] == ',' || s[i - 1] == ':' ||
          s[i - 1] == '-') {
        quote = c;
      }
      continue;
    }
    if (c == '#' && (i == 0 || isSpace(s[i - 1]))) return s.substr(0, i);
  }
  return s;
}

class YamlReader {
 public:
  explicit YamlReader(const std::string& text) {
    std::string body = text;
    // A UTF-8 byte-order mark. Several of FreeCAD's own cards begin with one.
    if (body.size() >= 3 && static_cast<unsigned char>(body[0]) == 0xEF &&
        static_cast<unsigned char>(body[1]) == 0xBB && static_cast<unsigned char>(body[2]) == 0xBF) {
      body.erase(0, 3);
    }
    std::size_t pos = 0;
    int number = 0;
    while (pos <= body.size()) {
      std::size_t nl = body.find('\n', pos);
      if (nl == std::string::npos) nl = body.size();
      std::string line = body.substr(pos, nl - pos);
      pos = nl + 1;
      ++number;
      if (!line.empty() && line.back() == '\r') line.pop_back();
      RawLine r;
      r.number = number;
      r.raw = line;
      int indent = 0;
      while (static_cast<std::size_t>(indent) < line.size() && line[indent] == ' ') ++indent;
      if (static_cast<std::size_t>(indent) < line.size() && line[indent] == '\t') {
        error_ = "line " + std::to_string(number) + " is indented with a tab";
      }
      r.indent = indent;
      const std::string content = trim(stripComment(line.substr(static_cast<std::size_t>(indent))));
      r.text = content;
      r.blank = content.empty() || content == "---" || content == "...";
      lines_.push_back(std::move(r));
      if (nl == body.size()) break;
    }
  }

  bool read(YNode& out) {
    if (!error_.empty()) return false;
    std::size_t i = skipBlank(0);
    if (i >= lines_.size()) {
      out = YNode{};
      return true;
    }
    out = parseBlock(i, lines_[i].indent);
    if (!error_.empty()) return false;
    i = skipBlank(i);
    if (i < lines_.size()) {
      fail(lines_[i], "is indented less than the document it belongs to");
      return false;
    }
    return true;
  }

  const std::string& error() const { return error_; }

 private:
  std::vector<RawLine> lines_;
  std::string error_;
  // NESTING IS BOUNDED. The library is a file a user may replace, and a reader
  // that recursed once per bracket or indent would let a crafted card exhaust the
  // stack of the application that opened it. No FreeCAD file nests beyond 6.
  static constexpr int kMaxDepth = 64;
  int depth_ = 0;
  struct DepthGuard {
    YamlReader& r;
    bool ok;
    explicit DepthGuard(YamlReader& reader) : r(reader), ok(++reader.depth_ <= kMaxDepth) {}
    ~DepthGuard() { --r.depth_; }
  };

  void fail(const RawLine& l, const std::string& what) {
    if (error_.empty()) error_ = "line " + std::to_string(l.number) + " " + what;
  }

  std::size_t skipBlank(std::size_t i) const {
    while (i < lines_.size() && lines_[i].blank) ++i;
    return i;
  }

  static bool isSeqItem(const std::string& t) { return t == "-" || t.rfind("- ", 0) == 0; }

  // The position of the ':' that ends a mapping key, or npos when the text is
  // not a `key:` form.
  static std::size_t keyColon(const std::string& t) {
    if (t.empty()) return std::string::npos;
    std::size_t i = 0;
    if (t[0] == '"' || t[0] == '\'') {
      const char q = t[0];
      i = 1;
      while (i < t.size() && t[i] != q) {
        if (q == '"' && t[i] == '\\') ++i;
        ++i;
      }
      if (i >= t.size()) return std::string::npos;
      ++i;
      while (i < t.size() && t[i] == ' ') ++i;
      if (i < t.size() && t[i] == ':' && (i + 1 == t.size() || t[i + 1] == ' ')) return i;
      return std::string::npos;
    }
    if (t[0] == '[' || t[0] == '{' || t[0] == '>' || t[0] == '|') return std::string::npos;
    for (i = 0; i < t.size(); ++i) {
      if (t[i] == ':' && (i + 1 == t.size() || t[i + 1] == ' ')) return i;
    }
    return std::string::npos;
  }

  bool unquote(const RawLine& l, const std::string& in, std::string& out) {
    const std::string s = trim(in);
    if (s.empty()) {
      out.clear();
      return true;
    }
    if (s[0] == '"') {
      std::string v;
      std::size_t i = 1;
      for (; i < s.size() && s[i] != '"'; ++i) {
        if (s[i] == '\\' && i + 1 < s.size()) {
          ++i;
          switch (s[i]) {
            case 'n': v.push_back('\n'); break;
            case 't': v.push_back('\t'); break;
            case '"': v.push_back('"'); break;
            case '\\': v.push_back('\\'); break;
            case '/': v.push_back('/'); break;
            default:
              fail(l, "uses an escape this reader does not know");
              return false;
          }
        } else {
          v.push_back(s[i]);
        }
      }
      if (i >= s.size()) {
        fail(l, "has a double-quoted value that is never closed");
        return false;
      }
      if (!trim(s.substr(i + 1)).empty()) {
        fail(l, "has text after a quoted value");
        return false;
      }
      out = v;
      return true;
    }
    if (s[0] == '\'') {
      std::string v;
      std::size_t i = 1;
      for (; i < s.size(); ++i) {
        if (s[i] == '\'') {
          if (i + 1 < s.size() && s[i + 1] == '\'') {
            v.push_back('\'');
            ++i;
            continue;
          }
          break;
        }
        v.push_back(s[i]);
      }
      if (i >= s.size()) {
        fail(l, "has a single-quoted value that is never closed");
        return false;
      }
      if (!trim(s.substr(i + 1)).empty()) {
        fail(l, "has text after a quoted value");
        return false;
      }
      out = v;
      return true;
    }
    out = s;
    return true;
  }

  // A flow collection starting at lines_[i].text[from], possibly continuing on
  // following lines. Advances i past the last line it used.
  YNode parseFlow(std::size_t& i, const std::string& first) {
    std::string buf = first;
    int depth = 0;
    char quote = 0;
    auto balanced = [&](const std::string& s) {
      depth = 0;
      quote = 0;
      for (std::size_t k = 0; k < s.size(); ++k) {
        const char c = s[k];
        if (quote != 0) {
          if (c == quote) quote = 0;
          else if (quote == '"' && c == '\\') ++k;
          continue;
        }
        if (c == '"' || c == '\'') quote = c;
        else if (c == '[' || c == '{') ++depth;
        else if (c == ']' || c == '}') --depth;
      }
      return depth <= 0 && quote == 0;
    };
    const RawLine& start = lines_[i];
    std::size_t j = i;
    while (!balanced(buf)) {
      ++j;
      if (j >= lines_.size()) {
        fail(start, "opens a bracket that is never closed");
        return YNode{};
      }
      buf += " " + lines_[j].text;
    }
    i = j + 1;
    std::size_t at = 0;
    YNode node = flowValue(start, buf, at);
    while (at < buf.size() && isSpace(buf[at])) ++at;
    if (at != buf.size() && error_.empty()) fail(start, "has text after a closing bracket");
    return node;
  }

  YNode flowValue(const RawLine& l, const std::string& s, std::size_t& at) {
    DepthGuard guard(*this);
    if (!guard.ok) {
      fail(l, "nests brackets deeper than any material file does");
      return YNode{};
    }
    while (at < s.size() && isSpace(s[at])) ++at;
    if (at >= s.size()) {
      fail(l, "ends inside a bracketed list");
      return YNode{};
    }
    if (s[at] == '[') {
      YNode seq;
      seq.kind = YNode::Kind::Seq;
      ++at;
      for (;;) {
        while (at < s.size() && isSpace(s[at])) ++at;
        if (at < s.size() && s[at] == ']') {
          ++at;
          return seq;
        }
        seq.seq.push_back(flowValue(l, s, at));
        if (!error_.empty()) return YNode{};
        while (at < s.size() && isSpace(s[at])) ++at;
        if (at < s.size() && s[at] == ',') {
          ++at;
          continue;
        }
        if (at < s.size() && s[at] == ']') {
          ++at;
          return seq;
        }
        fail(l, "has a bracketed list with a missing comma");
        return YNode{};
      }
    }
    if (s[at] == '{') {
      fail(l, "uses a braced mapping, which no material file uses");
      return YNode{};
    }
    YNode scalar;
    scalar.kind = YNode::Kind::Scalar;
    if (s[at] == '"' || s[at] == '\'') {
      const char q = s[at];
      std::size_t e = at + 1;
      while (e < s.size() && s[e] != q) {
        if (q == '"' && s[e] == '\\') ++e;
        ++e;
      }
      if (e >= s.size()) {
        fail(l, "has a quoted value that is never closed");
        return YNode{};
      }
      std::string v;
      if (!unquote(l, s.substr(at, e - at + 1), v)) return YNode{};
      scalar.scalar = v;
      at = e + 1;
      return scalar;
    }
    std::size_t e = at;
    while (e < s.size() && s[e] != ',' && s[e] != ']') ++e;
    scalar.scalar = trim(s.substr(at, e - at));
    at = e;
    return scalar;
  }

  std::string blockScalar(std::size_t& i, int parentIndent, char style) {
    std::vector<std::string> collected;
    int bodyIndent = -1;
    std::size_t j = i + 1;
    for (; j < lines_.size(); ++j) {
      const RawLine& l = lines_[j];
      const bool empty = trim(l.raw).empty();
      if (!empty && l.indent <= parentIndent) break;
      if (empty) {
        collected.emplace_back();
        continue;
      }
      if (bodyIndent < 0) bodyIndent = l.indent;
      collected.push_back(l.raw.size() > static_cast<std::size_t>(bodyIndent)
                              ? l.raw.substr(static_cast<std::size_t>(std::min(bodyIndent, l.indent)))
                              : std::string());
    }
    i = j;
    while (!collected.empty() && collected.back().empty()) collected.pop_back();
    std::string out;
    for (std::size_t k = 0; k < collected.size(); ++k) {
      if (k > 0) out += (style == '|' || collected[k].empty() || collected[k - 1].empty()) ? "\n" : " ";
      out += collected[k];
    }
    return out;
  }

  // The value that follows `key:` (rest non-empty) or that sits on the lines
  // below it (rest empty).
  YNode valueAfter(std::size_t& i, int indent, const std::string& rest) {
    const RawLine& l = lines_[i];
    if (rest.empty()) {
      std::size_t j = skipBlank(i + 1);
      if (j < lines_.size() &&
          (lines_[j].indent > indent || (lines_[j].indent == indent && isSeqItem(lines_[j].text)))) {
        i = j;
        return parseBlock(i, lines_[j].indent);
      }
      i = i + 1;
      return YNode{};
    }
    if (rest[0] == '>' || rest[0] == '|') {
      YNode n;
      n.kind = YNode::Kind::Scalar;
      n.scalar = blockScalar(i, indent, rest[0]);
      return n;
    }
    if (rest[0] == '[') return parseFlow(i, rest);
    if (rest[0] == '{') {
      fail(l, "uses a braced mapping, which no material file uses");
      return YNode{};
    }
    YNode n;
    n.kind = YNode::Kind::Scalar;
    if (!unquote(l, rest, n.scalar)) return YNode{};
    i = i + 1;
    return n;
  }

  // parseBlock leaves `i` on the first line it did not consume.
  YNode parseBlock(std::size_t& i, int indent) {
    DepthGuard guard(*this);
    i = skipBlank(i);
    if (i >= lines_.size()) return YNode{};
    if (!guard.ok) {
      fail(lines_[i], "nests entries deeper than any material file does");
      return YNode{};
    }
    if (isSeqItem(lines_[i].text)) return parseSeq(i, indent);
    if (keyColon(lines_[i].text) != std::string::npos) return parseMap(i, indent);
    // A plain or quoted scalar on its own line(s) under a key.
    const RawLine& l = lines_[i];
    YNode n;
    n.kind = YNode::Kind::Scalar;
    if (!l.text.empty() && l.text[0] == '[') return parseFlow(i, l.text);
    std::string joined = l.text;
    std::size_t j = i + 1;
    while (j < lines_.size() && !lines_[j].blank && lines_[j].indent >= indent &&
           keyColon(lines_[j].text) == std::string::npos && !isSeqItem(lines_[j].text)) {
      joined += " " + lines_[j].text;
      ++j;
    }
    if (!unquote(l, joined, n.scalar)) return YNode{};
    i = j;
    return n;
  }

  YNode parseMap(std::size_t& i, int indent) {
    YNode node;
    node.kind = YNode::Kind::Map;
    while (error_.empty()) {
      i = skipBlank(i);
      if (i >= lines_.size()) break;
      const RawLine& l = lines_[i];
      if (l.indent < indent) break;
      if (l.indent > indent) {
        fail(l, "is indented further than the entry before it");
        break;
      }
      if (isSeqItem(l.text)) break;  // a sequence at the same indent ends the mapping
      const std::size_t colon = keyColon(l.text);
      if (colon == std::string::npos) {
        fail(l, "is not a `name: value` entry");
        break;
      }
      std::string key;
      if (!unquote(l, l.text.substr(0, colon), key)) break;
      for (const auto& kv : node.map) {
        if (kv.first == key) {
          fail(l, "repeats the name \"" + key + "\"");
          return node;
        }
      }
      const std::string rest = trim(l.text.substr(colon + 1));
      YNode value = valueAfter(i, indent, rest);
      node.map.emplace_back(std::move(key), std::move(value));
    }
    return node;
  }

  YNode parseSeq(std::size_t& i, int indent) {
    YNode node;
    node.kind = YNode::Kind::Seq;
    while (error_.empty()) {
      i = skipBlank(i);
      if (i >= lines_.size()) break;
      RawLine& l = lines_[i];
      if (l.indent < indent || !isSeqItem(l.text)) break;
      if (l.indent > indent) {
        fail(l, "is indented further than the list item before it");
        break;
      }
      const std::string rest = l.text == "-" ? std::string() : trim(l.text.substr(2));
      if (rest.empty()) {
        YNode item = valueAfter(i, indent, rest);
        node.seq.push_back(std::move(item));
        continue;
      }
      if (keyColon(rest) != std::string::npos) {
        // `- key: value` opens a mapping whose keys sit two columns in.
        l.indent = indent + 2;
        l.text = rest;
        node.seq.push_back(parseMap(i, indent + 2));
        continue;
      }
      node.seq.push_back(valueAfter(i, indent, rest));
    }
    return node;
  }
};

// ════════════════════════════════════════════════════════════════════════════
// UNITS
// ════════════════════════════════════════════════════════════════════════════
struct UnitSymbol {
  const char* symbol;
  double toSI;
  PhysicalDimension dim;
  bool prefixable;
};

constexpr double kPi = 3.14159265358979323846;

const std::vector<UnitSymbol>& unitSymbols() {
  // {mass, length, time, temperature, current}
  static const std::vector<UnitSymbol> table = {
      {"m", 1.0, {0, 1, 0, 0, 0}, true},
      {"g", 1.0e-3, {1, 0, 0, 0, 0}, true},
      {"s", 1.0, {0, 0, 1, 0, 0}, true},
      {"K", 1.0, {0, 0, 0, 1, 0}, true},
      {"A", 1.0, {0, 0, 0, 0, 1}, true},
      {"N", 1.0, {1, 1, -2, 0, 0}, true},
      {"Pa", 1.0, {1, -1, -2, 0, 0}, true},
      {"J", 1.0, {1, 2, -2, 0, 0}, true},
      {"W", 1.0, {1, 2, -3, 0, 0}, true},
      {"S", 1.0, {-1, -2, 3, 0, 2}, true},
      {"V", 1.0, {1, 2, -3, 0, -1}, true},
      {"Ohm", 1.0, {1, 2, -3, 0, -2}, true},
      {"\xCE\xA9", 1.0, {1, 2, -3, 0, -2}, true},  // Ω
      {"Hz", 1.0, {0, 0, -1, 0, 0}, true},
      {"bar", 1.0e5, {1, -1, -2, 0, 0}, false},
      {"deg", kPi / 180.0, {0, 0, 0, 0, 0}, false},
      {"rad", 1.0, {0, 0, 0, 0, 0}, false},
      {"%", 0.01, {0, 0, 0, 0, 0}, false},
  };
  return table;
}

struct Prefix {
  const char* text;
  double factor;
};

const std::vector<Prefix>& unitPrefixes() {
  static const std::vector<Prefix> table = {
      {"G", 1.0e9},  {"M", 1.0e6},  {"k", 1.0e3},  {"c", 1.0e-2},
      {"m", 1.0e-3}, {"\xC2\xB5", 1.0e-6},  // µ MICRO SIGN, as FreeCAD's cards write it
      {"\xCE\xBC", 1.0e-6},                // μ GREEK SMALL LETTER MU
      {"u", 1.0e-6}, {"n", 1.0e-9},
  };
  return table;
}

PhysicalDimension scaled(const PhysicalDimension& d, int k) {
  return PhysicalDimension{d.mass * k, d.length * k, d.time * k, d.temperature * k,
                           d.current * k};
}

PhysicalDimension added(const PhysicalDimension& a, const PhysicalDimension& b) {
  return PhysicalDimension{a.mass + b.mass, a.length + b.length, a.time + b.time,
                           a.temperature + b.temperature, a.current + b.current};
}

bool lookupSymbol(const std::string& sym, double& factor, PhysicalDimension& dim) {
  for (const UnitSymbol& u : unitSymbols()) {
    if (sym == u.symbol) {
      factor = u.toSI;
      dim = u.dim;
      return true;
    }
  }
  for (const Prefix& p : unitPrefixes()) {
    const std::size_t n = std::strlen(p.text);
    if (sym.size() <= n || sym.compare(0, n, p.text) != 0) continue;
    const std::string base = sym.substr(n);
    for (const UnitSymbol& u : unitSymbols()) {
      if (u.prefixable && base == u.symbol) {
        factor = p.factor * u.toSI;
        dim = u.dim;
        return true;
      }
    }
  }
  return false;
}

class UnitParser {
 public:
  explicit UnitParser(const std::string& s) : s_(s) {}

  UnitRead run() {
    UnitRead out;
    skip();
    if (at_ >= s_.size()) {
      out.ok = true;  // an empty unit is dimensionless
      return out;
    }
    double f = 1.0;
    PhysicalDimension d{};
    if (!expr(f, d)) {
      out.refusal = error_;
      return out;
    }
    skip();
    if (at_ < s_.size()) {
      out.refusal = "the unit \"" + s_ + "\" has something after its end that is not a unit";
      return out;
    }
    out.ok = true;
    out.toSI = f;
    out.dimension = d;
    return out;
  }

 private:
  const std::string& s_;
  std::size_t at_ = 0;
  std::string error_;

  void skip() {
    while (at_ < s_.size() && s_[at_] == ' ') ++at_;
  }

  bool middleDot() const {
    return at_ + 1 < s_.size() && static_cast<unsigned char>(s_[at_]) == 0xC2 &&
           static_cast<unsigned char>(s_[at_ + 1]) == 0xB7;
  }

  bool expr(double& f, PhysicalDimension& d) {
    if (!term(f, d)) return false;
    for (;;) {
      skip();
      if (at_ >= s_.size() || s_[at_] == ')') return true;
      int sign = 1;
      if (s_[at_] == '/') {
        sign = -1;
        ++at_;
      } else if (s_[at_] == '*') {
        ++at_;
      } else if (middleDot()) {
        at_ += 2;
      } else if (s_[at_ - 1] != ' ') {
        error_ = "the unit \"" + s_ + "\" joins two symbols with no operator between them";
        return false;
      }
      skip();
      double f2 = 1.0;
      PhysicalDimension d2{};
      if (!term(f2, d2)) return false;
      if (sign < 0) {
        f /= f2;
        d = added(d, scaled(d2, -1));
      } else {
        f *= f2;
        d = added(d, d2);
      }
    }
  }

  bool term(double& f, PhysicalDimension& d) {
    skip();
    if (at_ >= s_.size()) {
      error_ = "the unit \"" + s_ + "\" ends where a symbol was expected";
      return false;
    }
    if (s_[at_] == '(') {
      ++at_;
      if (!expr(f, d)) return false;
      skip();
      if (at_ >= s_.size() || s_[at_] != ')') {
        error_ = "the unit \"" + s_ + "\" opens a bracket it does not close";
        return false;
      }
      ++at_;
    } else if (s_[at_] == '1') {
      ++at_;
      f = 1.0;
      d = PhysicalDimension{};
    } else {
      std::size_t e = at_;
      while (e < s_.size()) {
        const unsigned char c = static_cast<unsigned char>(s_[e]);
        const bool dot = c == 0xC2 && e + 1 < s_.size() &&
                         static_cast<unsigned char>(s_[e + 1]) == 0xB7;
        if (dot) break;
        if (std::isalpha(c) != 0 || c == '%' || c >= 0x80) {
          ++e;
          continue;
        }
        break;
      }
      if (e == at_) {
        error_ = "the unit \"" + s_ + "\" has a character that is not part of any unit";
        return false;
      }
      const std::string sym = s_.substr(at_, e - at_);
      if (!lookupSymbol(sym, f, d)) {
        error_ = "\"" + sym + "\" is not a unit this library understands";
        return false;
      }
      at_ = e;
    }
    skip();
    if (at_ < s_.size() && s_[at_] == '^') {
      ++at_;
      skip();
      int sign = 1;
      if (at_ < s_.size() && (s_[at_] == '-' || s_[at_] == '+')) {
        sign = s_[at_] == '-' ? -1 : 1;
        ++at_;
      }
      int exponent = 0;
      std::size_t digits = 0;
      while (at_ < s_.size() && s_[at_] >= '0' && s_[at_] <= '9' && digits < 3) {
        exponent = exponent * 10 + (s_[at_] - '0');
        ++at_;
        ++digits;
      }
      if (digits == 0) {
        error_ = "the unit \"" + s_ + "\" raises a symbol to no power";
        return false;
      }
      exponent *= sign;
      f = std::pow(f, exponent);
      d = scaled(d, exponent);
    }
    return true;
  }
};

// The number at the start of `s`: [+-] digits [. digits] [e [+-] digits]. Returns
// the count of characters it spans, 0 when there is none.
std::size_t scanNumber(const std::string& s) {
  std::size_t i = 0;
  if (i < s.size() && (s[i] == '+' || s[i] == '-')) ++i;
  std::size_t mantissa = 0;
  while (i < s.size() && s[i] >= '0' && s[i] <= '9') {
    ++i;
    ++mantissa;
  }
  if (i < s.size() && s[i] == '.') {
    ++i;
    while (i < s.size() && s[i] >= '0' && s[i] <= '9') {
      ++i;
      ++mantissa;
    }
  }
  if (mantissa == 0) return 0;
  if (i < s.size() && (s[i] == 'e' || s[i] == 'E')) {
    std::size_t j = i + 1;
    if (j < s.size() && (s[j] == '+' || s[j] == '-')) ++j;
    std::size_t exp = 0;
    while (j < s.size() && s[j] >= '0' && s[j] <= '9') {
      ++j;
      ++exp;
    }
    if (exp > 0) i = j;
  }
  return i;
}

// ════════════════════════════════════════════════════════════════════════════
// CARDS AND MODELS
// ════════════════════════════════════════════════════════════════════════════
CardValueType typeOf(const std::string& typeName) {
  if (typeName == "Quantity") return CardValueType::Quantity;
  if (typeName == "Float" || typeName == "Integer" || typeName == "Percentage") {
    return CardValueType::Number;
  }
  if (typeName == "2DArray" || typeName == "3DArray") return CardValueType::Table;
  return CardValueType::Text;
}

const MaterialModel* findModel(const std::vector<MaterialModel>& models, const std::string& uuid) {
  for (const MaterialModel& m : models) {
    if (m.uuid == uuid) return &m;
  }
  return nullptr;
}

// The property `name` as `model` or any model it inherits defines it. Walks the
// inheritance with a visited set, so a cycle in a replaced library ends.
const ModelProperty* findDefinition(const std::vector<MaterialModel>& models,
                                    const MaterialModel& model, const std::string& name,
                                    std::set<std::string>& visited) {
  if (!visited.insert(model.uuid).second) return nullptr;
  for (const ModelProperty& p : model.properties) {
    if (p.name == name) return &p;
  }
  for (const std::string& parent : model.inherits) {
    const MaterialModel* m = findModel(models, parent);
    if (m == nullptr) continue;
    if (const ModelProperty* p = findDefinition(models, *m, name, visited)) return p;
  }
  return nullptr;
}

std::string lowerAscii(std::string s) {
  for (char& c : s) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return s;
}

std::string fileStem(const std::string& path) {
  std::size_t slash = path.rfind('/');
  std::string leaf = slash == std::string::npos ? path : path.substr(slash + 1);
  const std::size_t dot = leaf.rfind('.');
  if (dot != std::string::npos) leaf.erase(dot);
  return leaf;
}

std::string categoryOf(const std::string& path) {
  static const std::string root = "Resources/Materials/";
  std::string rest = path.rfind(root, 0) == 0 ? path.substr(root.size()) : path;
  const std::size_t slash = rest.rfind('/');
  rest = slash == std::string::npos ? std::string() : rest.substr(0, slash);
  if (rest.rfind("Standard/", 0) == 0) rest.erase(0, 9);
  if (rest == "Standard") rest.clear();
  std::string out;
  std::size_t at = 0;
  while (at <= rest.size() && !rest.empty()) {
    std::size_t e = rest.find('/', at);
    if (e == std::string::npos) e = rest.size();
    if (!out.empty()) out += " / ";
    out += rest.substr(at, e - at);
    at = e + 1;
    if (e == rest.size()) break;
  }
  return out;
}

Appearance shade(double r, double g, double b, double metallic, double roughness) {
  Appearance a;
  a.red = r;
  a.green = g;
  a.blue = b;
  a.metallic = metallic;
  a.roughness = roughness;
  a.opacity = 1.0;
  return a;
}

// FORGE'S shading for a card, chosen from what the card says it is. The cards
// shipped here carry no appearance of their own -- FreeCAD keeps appearance in
// separate cards, under other licences, which this library does not take -- so
// a steel is shaded as Forge shades steel.
Appearance appearanceFor(const MaterialCard& card) {
  const std::string parent = lowerAscii(card.parentName);
  const std::string kind = lowerAscii(card.text("KindOfMaterial"));
  const std::string cat = lowerAscii(card.category);
  if (kind.find("stainless") != std::string::npos) return shade(0.74, 0.76, 0.78, 1.0, 0.30);
  if (parent == "brass") return shade(0.85, 0.72, 0.35, 1.0, 0.28);
  if (parent == "bronze") return shade(0.72, 0.55, 0.35, 1.0, 0.38);
  if (parent == "gold") return shade(0.83, 0.69, 0.22, 1.0, 0.25);
  if (parent == "silver") return shade(0.80, 0.80, 0.82, 1.0, 0.22);
  if (parent == "copper" || cat.find("copper") != std::string::npos) {
    return shade(0.78, 0.45, 0.30, 1.0, 0.26);
  }
  if (cat.find("aluminum") != std::string::npos || cat.find("aluminium") != std::string::npos) {
    return shade(0.83, 0.85, 0.87, 1.0, 0.35);
  }
  if (kind.find("cast iron") != std::string::npos) return shade(0.36, 0.36, 0.38, 1.0, 0.62);
  if (cat.find("titanium") != std::string::npos) return shade(0.66, 0.64, 0.62, 1.0, 0.40);
  if (cat.find("carbon") != std::string::npos) return shade(0.20, 0.20, 0.22, 0.0, 0.70);
  if (cat.find("steel") != std::string::npos || cat.find("iron") != std::string::npos) {
    return shade(0.55, 0.57, 0.60, 1.0, 0.45);
  }
  return shade(0.62, 0.62, 0.60, 1.0, 0.40);
}

void readProperty(CardProperty& p, const YNode& value, const ModelProperty* def) {
  if (value.kind == YNode::Kind::Seq || value.kind == YNode::Kind::Map) {
    p.type = CardValueType::Table;
    p.state = def == nullptr ? CardPropertyState::NoModel : CardPropertyState::NotRead;
    return;
  }
  p.text = value.scalar;
  if (def == nullptr) {
    p.state = CardPropertyState::NoModel;
    return;
  }
  p.type = def->type;
  p.declaredUnits = def->unitsText;
  switch (def->type) {
    case CardValueType::Table:
      p.state = CardPropertyState::NotRead;
      return;
    case CardValueType::Text:
      p.state = CardPropertyState::Read;
      return;
    case CardValueType::Number:
    case CardValueType::Quantity: {
      if (trim(p.text).empty()) {
        p.state = CardPropertyState::NotRead;
        return;
      }
      QuantityRead q = parsePhysicalQuantity(p.text);
      if (!q.ok) {
        p.state = CardPropertyState::Refused;
        p.refusal = p.name + ": " + q.refusal;
        return;
      }
      if (def->type == CardValueType::Number && !q.quantity.dimension.dimensionless()) {
        p.state = CardPropertyState::Refused;
        p.refusal = p.name + " is a plain number and the card gives it a unit (\"" + p.text + "\")";
        return;
      }
      if (def->type == CardValueType::Quantity) {
        if (!def->unit.ok) {
          p.state = CardPropertyState::Refused;
          p.refusal = p.name + ": its model declares a unit that cannot be read -- " +
                      def->unit.refusal;
          return;
        }
        if (q.quantity.dimension != def->unit.dimension) {
          // ★ FreeCAD keeps the number and relabels it in the model's unit. That
          //   is how a wrong material loads as a right one, so it is refused.
          p.state = CardPropertyState::Refused;
          p.refusal = p.name + " is written as \"" + p.text + "\" (" +
                      describeDimension(q.quantity.dimension) + ") but is declared in " +
                      def->unitsText + " (" + describeDimension(def->unit.dimension) + ")";
          return;
        }
      }
      p.quantity = q.quantity;
      p.state = CardPropertyState::Read;
      return;
    }
  }
}

}  // namespace

// ── dimensions ──────────────────────────────────────────────────────────────
bool operator==(const PhysicalDimension& a, const PhysicalDimension& b) noexcept {
  return a.mass == b.mass && a.length == b.length && a.time == b.time &&
         a.temperature == b.temperature && a.current == b.current;
}
bool operator!=(const PhysicalDimension& a, const PhysicalDimension& b) noexcept {
  return !(a == b);
}

std::string describeDimension(const PhysicalDimension& d) {
  std::string out;
  const auto part = [&out](const char* sym, int e) {
    if (e == 0) return;
    if (!out.empty()) out += " ";
    out += sym;
    if (e != 1) out += "^" + std::to_string(e);
  };
  part("kg", d.mass);
  part("m", d.length);
  part("s", d.time);
  part("K", d.temperature);
  part("A", d.current);
  return out.empty() ? std::string("1") : out;
}

UnitRead parseUnitExpression(const std::string& text) { return UnitParser(trim(text)).run(); }

QuantityRead parsePhysicalQuantity(const std::string& text) {
  QuantityRead out;
  const std::string s = trim(text);
  out.quantity.asWritten = s;
  if (s.empty()) {
    out.refusal = "there is no value";
    return out;
  }
  const std::size_t n = scanNumber(s);
  if (n == 0) {
    out.refusal = "\"" + s + "\" does not start with a number";
    return out;
  }
  if (n < s.size() && s[n] == ',') {
    out.refusal = "\"" + s + "\" uses a comma in its number, which could mean a decimal point "
                  "or a thousands separator, so it is not read as either";
    return out;
  }
  const std::string number = s.substr(0, n);
  char* stop = nullptr;
  const double v = std::strtod(number.c_str(), &stop);
  if (stop == nullptr || *stop != '\0' || !std::isfinite(v)) {
    out.refusal = "\"" + number + "\" is not a finite number";
    return out;
  }
  UnitRead unit = parseUnitExpression(s.substr(n));
  if (!unit.ok) {
    out.refusal = unit.refusal;
    return out;
  }
  out.ok = true;
  out.quantity.valueSI = v * unit.toSI;
  out.quantity.dimension = unit.dimension;
  return out;
}

// ── models ──────────────────────────────────────────────────────────────────
ModelRead parseMaterialModel(const std::string& bundlePath, const std::string& text) {
  ModelRead out;
  YamlReader reader(text);
  YNode root;
  if (!reader.read(root)) {
    out.refusal = bundlePath + ": " + reader.error();
    return out;
  }
  const YNode* model = root.get("Model");
  if (model == nullptr || model->kind != YNode::Kind::Map) {
    out.refusal = bundlePath + " has no Model section";
    return out;
  }
  out.model.bundlePath = bundlePath;
  out.model.uuid = model->text("UUID");
  out.model.name = model->text("Name");
  if (out.model.uuid.empty()) {
    out.refusal = bundlePath + " names no UUID for its model";
    return out;
  }
  static const std::set<std::string> kHeader = {"Name", "UUID", "URL", "Description", "DOI",
                                                "Inherits"};
  if (const YNode* inh = model->get("Inherits")) {
    if (inh->kind == YNode::Kind::Seq) {
      for (const YNode& item : inh->seq) {
        const std::string uuid = item.text("UUID");
        if (!uuid.empty()) out.model.inherits.push_back(uuid);
      }
    }
  }
  for (const auto& kv : model->map) {
    if (kHeader.count(kv.first) != 0) continue;
    if (kv.second.kind != YNode::Kind::Map) continue;
    ModelProperty p;
    p.name = kv.first;
    p.typeName = kv.second.text("Type");
    p.type = typeOf(p.typeName);
    p.unitsText = kv.second.text("Units");
    p.unit = parseUnitExpression(p.unitsText);
    out.model.properties.push_back(std::move(p));
  }
  out.ok = true;
  return out;
}

// ── cards ───────────────────────────────────────────────────────────────────
const CardProperty* MaterialCard::property(const std::string& name) const noexcept {
  for (const CardProperty& p : properties) {
    if (p.name == name) return &p;
  }
  return nullptr;
}

const PhysicalQuantity* MaterialCard::quantity(const std::string& name) const noexcept {
  const CardProperty* p = property(name);
  if (p == nullptr || p->state != CardPropertyState::Read) return nullptr;
  if (p->type != CardValueType::Quantity && p->type != CardValueType::Number) return nullptr;
  return &p->quantity;
}

std::string MaterialCard::text(const std::string& name) const {
  const CardProperty* p = property(name);
  return p == nullptr ? std::string() : p->text;
}

CardRead parseMaterialCard(const std::string& bundlePath, const std::string& text,
                           const std::vector<MaterialModel>& models) {
  CardRead out;
  YamlReader reader(text);
  YNode root;
  if (!reader.read(root)) {
    out.refusal = reader.error();
    return out;
  }
  const YNode* general = root.get("General");
  if (general == nullptr || general->kind != YNode::Kind::Map) {
    out.refusal = "the card has no General section";
    return out;
  }
  MaterialCard& c = out.card;
  c.bundlePath = bundlePath;
  c.id = lowerAscii(fileStem(bundlePath));
  c.category = categoryOf(bundlePath);
  c.uuid = general->text("UUID");
  c.name = general->text("Name");
  if (c.name.empty()) c.name = fileStem(bundlePath);
  c.author = general->text("Author");
  c.license = general->text("License");
  c.description = general->text("Description");
  c.sourceUrl = general->text("SourceURL");
  c.referenceSource = general->text("ReferenceSource");
  if (c.uuid.empty()) {
    out.refusal = "the card names no UUID";
    return out;
  }
  if (const YNode* tags = general->get("Tags")) {
    if (tags->kind == YNode::Kind::Seq) {
      for (const YNode& t : tags->seq) {
        if (t.kind == YNode::Kind::Scalar) c.tags.push_back(t.scalar);
      }
    }
  }
  if (const YNode* inh = root.get("Inherits")) {
    if (inh->kind == YNode::Kind::Map && !inh->map.empty()) {
      c.parentName = inh->map.front().first;
      c.parentUuid = inh->map.front().second.text("UUID");
    }
  }
  const YNode* sections = root.get("Models");
  if (sections != nullptr && sections->kind == YNode::Kind::Map) {
    for (const auto& section : sections->map) {
      if (section.second.kind != YNode::Kind::Map) continue;
      const std::string modelUuid = section.second.text("UUID");
      const MaterialModel* model = findModel(models, modelUuid);
      for (const auto& kv : section.second.map) {
        if (kv.first == "UUID") continue;
        CardProperty p;
        p.model = section.first;
        p.name = kv.first;
        const ModelProperty* def = nullptr;
        if (model != nullptr) {
          std::set<std::string> visited;
          def = findDefinition(models, *model, kv.first, visited);
        }
        readProperty(p, kv.second, def);
        if (model == nullptr && kv.second.kind == YNode::Kind::Scalar) {
          p.state = CardPropertyState::Refused;
          p.refusal = p.name + " belongs to a model this library does not carry (" +
                      (modelUuid.empty() ? std::string("no UUID") : modelUuid) + ")";
        }
        c.properties.push_back(std::move(p));
      }
    }
  }
  out.ok = true;
  return out;
}

// ── the catalogue ───────────────────────────────────────────────────────────
std::shared_ptr<const MaterialCatalogue> MaterialCatalogue::build(
    const std::vector<MaterialLibraryFile>& files, std::string upstreamCommit) {
  auto cat = std::make_shared<MaterialCatalogue>();
  cat->upstreamCommit_ = std::move(upstreamCommit);
  static const std::string kModels = "Resources/Models/";
  static const std::string kCards = "Resources/Materials/";
  const auto endsWith = [](const std::string& s, const char* tail) {
    const std::size_t n = std::strlen(tail);
    return s.size() >= n && s.compare(s.size() - n, n, tail) == 0;
  };

  for (const MaterialLibraryFile& f : files) {
    if (f.path.rfind(kModels, 0) != 0) continue;
    if (!endsWith(f.path, ".yml")) {
      cat->refusals_.push_back({f.path, "is in the model folder but is not a model definition"});
      continue;
    }
    ModelRead m = parseMaterialModel(f.path, f.bytes);
    if (!m.ok) {
      cat->refusals_.push_back({f.path, m.refusal});
      continue;
    }
    if (findModel(cat->models_, m.model.uuid) != nullptr) {
      cat->refusals_.push_back({f.path, "defines a model UUID another file already defines"});
      continue;
    }
    cat->models_.push_back(std::move(m.model));
  }

  std::vector<MaterialCard> read;
  for (const MaterialLibraryFile& f : files) {
    if (f.path.rfind(kModels, 0) == 0) continue;
    if (f.path.rfind(kCards, 0) != 0 || !endsWith(f.path, ".FCMat")) {
      cat->refusals_.push_back({f.path, "is neither a material card nor a model definition"});
      continue;
    }
    CardRead c = parseMaterialCard(f.path, f.bytes, cat->models_);
    if (!c.ok) {
      cat->refusals_.push_back({f.path, c.refusal});
      continue;
    }
    read.push_back(std::move(c.card));
  }

  // ── inheritance inside the library ──────────────────────────────────────
  // A card that refines another card IN THIS LIBRARY takes every property the
  // parent has read and it does not state itself. A parent outside the library
  // (FreeCAD's appearance cards) contributes nothing, and the card says so.
  std::map<std::string, std::size_t> byUuid;
  for (std::size_t i = 0; i < read.size(); ++i) byUuid.emplace(read[i].uuid, i);
  for (MaterialCard& card : read) {
    std::set<std::string> seen{card.uuid};
    std::string parent = card.parentUuid;
    while (!parent.empty() && seen.insert(parent).second) {
      const auto it = byUuid.find(parent);
      if (it == byUuid.end()) break;
      card.parentInLibrary = true;
      const MaterialCard& p = read[it->second];
      for (const CardProperty& prop : p.properties) {
        if (prop.state != CardPropertyState::Read) continue;
        if (card.property(prop.name) == nullptr) card.properties.push_back(prop);
      }
      parent = p.parentUuid;
    }
  }

  std::sort(read.begin(), read.end(),
            [](const MaterialCard& a, const MaterialCard& b) { return a.id < b.id; });
  std::set<std::string> ids;
  std::set<std::string> uuids;
  for (MaterialCard& card : read) {
    const CardProperty* density = card.property("Density");
    const PhysicalQuantity* q = card.quantity("Density");
    if (q == nullptr) {
      cat->refusals_.push_back(
          {card.bundlePath, density != nullptr && density->state == CardPropertyState::Refused
                                ? "its density cannot be used: " + density->refusal
                                : "it states no density, so nothing made of it can be weighed"});
      continue;
    }
    if (!(q->valueSI > 0.0)) {
      cat->refusals_.push_back({card.bundlePath, "its density is not greater than zero"});
      continue;
    }
    // forge::ui::findMaterial is the HANDBOOK table. A card may not take a name
    // the handbook already answers to, or the two would disagree about a part.
    if (forge::ui::findMaterial(card.id) != nullptr || !ids.insert(card.id).second) {
      cat->refusals_.push_back(
          {card.bundlePath, "its name \"" + card.id + "\" is already taken by another material"});
      continue;
    }
    if (!uuids.insert(card.uuid).second) {
      cat->refusals_.push_back({card.bundlePath, "its UUID is already used by another card"});
      continue;
    }
    Material m;
    m.id = card.id;
    m.name = card.name;
    m.densityKgPerM3 = q->valueSI;
    m.appearance = appearanceFor(card);
    cat->materials_.push_back(std::move(m));
    cat->cards_.push_back(std::move(card));
  }
  return cat;
}

const MaterialCard* MaterialCatalogue::findCard(const std::string& id) const noexcept {
  const auto it = std::lower_bound(cards_.begin(), cards_.end(), id,
                                   [](const MaterialCard& c, const std::string& k) { return c.id < k; });
  return (it != cards_.end() && it->id == id) ? &*it : nullptr;
}

const Material* MaterialCatalogue::findMaterial(const std::string& id) const noexcept {
  const MaterialCard* card = findCard(id);
  if (card == nullptr) return nullptr;
  return &materials_[static_cast<std::size_t>(card - cards_.data())];
}

const Material* resolveMaterial(const std::string& id, const MaterialCatalogue* cards) {
  if (const Material* m = forge::ui::findMaterial(id)) return m;
  return cards == nullptr ? nullptr : cards->findMaterial(id);
}

}  // namespace forge::ui
