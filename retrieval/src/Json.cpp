#include "forge/retrieval/Json.hpp"

#include <charconv>
#include <cstdint>

namespace forge::retrieval::json {
namespace {

const Value& nullValue() {
  static const Value kNull;
  return kNull;
}

struct Parser {
  const std::string& s;
  std::size_t i = 0;
  std::string err;

  explicit Parser(const std::string& text) : s(text) {}

  bool fail(const char* what) {
    if (err.empty()) err = std::string(what) + " at offset " + std::to_string(i);
    return false;
  }

  void skipWs() {
    while (i < s.size()) {
      const char c = s[i];
      if (c == ' ' || c == '\t' || c == '\n' || c == '\r') ++i;
      else break;
    }
  }

  bool literal(const char* lit) {
    const std::size_t n = std::char_traits<char>::length(lit);
    if (s.compare(i, n, lit) != 0) return fail("bad literal");
    i += n;
    return true;
  }

  bool hex4(std::uint32_t& out) {
    if (i + 4 > s.size()) return fail("truncated unicode escape");
    std::uint32_t v = 0;
    for (int k = 0; k < 4; ++k) {
      const char c = s[i + k];
      v <<= 4;
      if (c >= '0' && c <= '9') v |= static_cast<std::uint32_t>(c - '0');
      else if (c >= 'a' && c <= 'f') v |= static_cast<std::uint32_t>(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F') v |= static_cast<std::uint32_t>(c - 'A' + 10);
      else return fail("bad hex digit in unicode escape");
    }
    i += 4;
    out = v;
    return true;
  }

  static void appendUtf8(std::string& dst, std::uint32_t cp) {
    if (cp <= 0x7F) {
      dst.push_back(static_cast<char>(cp));
    } else if (cp <= 0x7FF) {
      dst.push_back(static_cast<char>(0xC0 | (cp >> 6)));
      dst.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp <= 0xFFFF) {
      dst.push_back(static_cast<char>(0xE0 | (cp >> 12)));
      dst.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
      dst.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
      dst.push_back(static_cast<char>(0xF0 | (cp >> 18)));
      dst.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
      dst.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
      dst.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
  }

  bool parseString(std::string& out) {
    if (i >= s.size() || s[i] != '"') return fail("expected string");
    ++i;
    out.clear();
    while (true) {
      if (i >= s.size()) return fail("unterminated string");
      const unsigned char c = static_cast<unsigned char>(s[i]);
      if (c == '"') { ++i; return true; }
      if (c < 0x20) return fail("raw control character in string");
      if (c != '\\') { out.push_back(static_cast<char>(c)); ++i; continue; }
      ++i;
      if (i >= s.size()) return fail("trailing backslash");
      const char e = s[i++];
      switch (e) {
        case '"': out.push_back('"'); break;
        case '\\': out.push_back('\\'); break;
        case '/': out.push_back('/'); break;
        case 'b': out.push_back('\b'); break;
        case 'f': out.push_back('\f'); break;
        case 'n': out.push_back('\n'); break;
        case 'r': out.push_back('\r'); break;
        case 't': out.push_back('\t'); break;
        case 'u': {
          std::uint32_t cp = 0;
          if (!hex4(cp)) return false;
          if (cp >= 0xD800 && cp <= 0xDBFF) {  // high surrogate
            if (i + 1 < s.size() && s[i] == '\\' && s[i + 1] == 'u') {
              i += 2;
              std::uint32_t lo = 0;
              if (!hex4(lo)) return false;
              if (lo >= 0xDC00 && lo <= 0xDFFF) {
                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
              } else {
                cp = 0xFFFD;  // unpaired: substitute, never propagate raw
              }
            } else {
              cp = 0xFFFD;
            }
          } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
            cp = 0xFFFD;  // lone low surrogate
          }
          appendUtf8(out, cp);
          break;
        }
        default: return fail("unknown escape");
      }
    }
  }

  bool parseNumber(double& out) {
    const std::size_t start = i;
    if (i < s.size() && s[i] == '-') ++i;
    // JSON forbids leading '+', a leading '.', and leading zeros such as 01.
    if (i >= s.size() || s[i] < '0' || s[i] > '9') return fail("expected digit");
    if (s[i] == '0') {
      ++i;
    } else {
      while (i < s.size() && s[i] >= '0' && s[i] <= '9') ++i;
    }
    if (i < s.size() && s[i] == '.') {
      ++i;
      if (i >= s.size() || s[i] < '0' || s[i] > '9') return fail("expected fraction digit");
      while (i < s.size() && s[i] >= '0' && s[i] <= '9') ++i;
    }
    if (i < s.size() && (s[i] == 'e' || s[i] == 'E')) {
      ++i;
      if (i < s.size() && (s[i] == '+' || s[i] == '-')) ++i;
      if (i >= s.size() || s[i] < '0' || s[i] > '9') return fail("expected exponent digit");
      while (i < s.size() && s[i] >= '0' && s[i] <= '9') ++i;
    }
    const char* first = s.data() + start;
    const char* last = s.data() + i;
    auto res = std::from_chars(first, last, out);
    if (res.ec != std::errc() || res.ptr != last) return fail("unrepresentable number");
    return true;
  }

  bool parseValue(Value& out, int depth) {
    if (depth > kMaxDepth) return fail("nesting deeper than kMaxDepth");
    skipWs();
    if (i >= s.size()) return fail("unexpected end of input");
    switch (s[i]) {
      case 'n': if (!literal("null")) return false; out = Value::makeNull(); return true;
      case 't': if (!literal("true")) return false; out = Value::makeBool(true); return true;
      case 'f': if (!literal("false")) return false; out = Value::makeBool(false); return true;
      case '"': {
        std::string str;
        if (!parseString(str)) return false;
        out = Value::makeString(std::move(str));
        return true;
      }
      case '[': {
        ++i;
        std::vector<Value> arr;
        skipWs();
        if (i < s.size() && s[i] == ']') { ++i; out = Value::makeArray(std::move(arr)); return true; }
        while (true) {
          Value elem;
          if (!parseValue(elem, depth + 1)) return false;
          arr.push_back(std::move(elem));
          skipWs();
          if (i >= s.size()) return fail("unterminated array");
          if (s[i] == ',') { ++i; continue; }
          if (s[i] == ']') { ++i; break; }
          return fail("expected ',' or ']'");
        }
        out = Value::makeArray(std::move(arr));
        return true;
      }
      case '{': {
        ++i;
        std::map<std::string, Value> obj;
        skipWs();
        if (i < s.size() && s[i] == '}') { ++i; out = Value::makeObject(std::move(obj)); return true; }
        while (true) {
          skipWs();
          std::string key;
          if (!parseString(key)) return false;
          skipWs();
          if (i >= s.size() || s[i] != ':') return fail("expected ':'");
          ++i;
          Value val;
          if (!parseValue(val, depth + 1)) return false;
          // Reject duplicate keys outright rather than silently picking one:
          // a duplicated key is a classic response-smuggling shape.
          if (!obj.emplace(std::move(key), std::move(val)).second) return fail("duplicate object key");
          skipWs();
          if (i >= s.size()) return fail("unterminated object");
          if (s[i] == ',') { ++i; continue; }
          if (s[i] == '}') { ++i; break; }
          return fail("expected ',' or '}'");
        }
        out = Value::makeObject(std::move(obj));
        return true;
      }
      default: {
        double d = 0.0;
        if (!parseNumber(d)) return false;
        out = Value::makeNumber(d);
        return true;
      }
    }
  }
};

}  // namespace

Value Value::makeBool(bool b) { Value v; v.kind_ = Kind::Bool; v.bool_ = b; return v; }
Value Value::makeNumber(double d) { Value v; v.kind_ = Kind::Number; v.num_ = d; return v; }
Value Value::makeString(std::string s) { Value v; v.kind_ = Kind::String; v.str_ = std::move(s); return v; }
Value Value::makeArray(std::vector<Value> a) { Value v; v.kind_ = Kind::Array; v.arr_ = std::move(a); return v; }
Value Value::makeObject(std::map<std::string, Value> o) { Value v; v.kind_ = Kind::Object; v.obj_ = std::move(o); return v; }

const Value& Value::at(const std::string& key) const {
  if (kind_ != Kind::Object) return nullValue();
  auto it = obj_.find(key);
  return it == obj_.end() ? nullValue() : it->second;
}

bool Value::has(const std::string& key) const {
  return kind_ == Kind::Object && obj_.find(key) != obj_.end();
}

std::string Value::stringField(const std::string& key, const std::string& fallback) const {
  const Value& v = at(key);
  return v.isString() ? v.str() : fallback;
}

double Value::numberField(const std::string& key, double fallback) const {
  const Value& v = at(key);
  return v.isNumber() ? v.number() : fallback;
}

std::string escape(const std::string& raw) {
  std::string out;
  out.reserve(raw.size() + 2);
  out.push_back('"');
  for (const unsigned char c : raw) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          static const char* kHex = "0123456789abcdef";
          out += "\\u00";
          out.push_back(kHex[(c >> 4) & 0xF]);
          out.push_back(kHex[c & 0xF]);
        } else {
          out.push_back(static_cast<char>(c));
        }
    }
  }
  out.push_back('"');
  return out;
}

std::string Value::dump() const {
  switch (kind_) {
    case Kind::Null: return "null";
    case Kind::Bool: return bool_ ? "true" : "false";
    case Kind::Number: {
      char buf[40];
      auto res = std::to_chars(buf, buf + sizeof(buf), num_);
      return std::string(buf, res.ptr);
    }
    case Kind::String: return escape(str_);
    case Kind::Array: {
      std::string out = "[";
      for (std::size_t k = 0; k < arr_.size(); ++k) {
        if (k) out.push_back(',');
        out += arr_[k].dump();
      }
      out.push_back(']');
      return out;
    }
    case Kind::Object: {
      std::string out = "{";
      bool first = true;
      for (const auto& [k, v] : obj_) {
        if (!first) out.push_back(',');
        first = false;
        out += escape(k);
        out.push_back(':');
        out += v.dump();
      }
      out.push_back('}');
      return out;
    }
  }
  return "null";
}

bool parse(const std::string& text, Value& out, std::string& error) {
  error.clear();
  Parser p(text);
  Value v;
  if (!p.parseValue(v, 0)) { error = p.err; return false; }
  p.skipWs();
  if (p.i != text.size()) { error = "trailing garbage at offset " + std::to_string(p.i); return false; }
  out = std::move(v);
  return true;
}

}  // namespace forge::retrieval::json
