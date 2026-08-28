// ─────────────────────────────────────────────────────────────────────────────
// Json.hpp — a strict, bounded JSON reader/writer for the SearXNG client.
//
// SACROSANCT 12.3 ("retrieval is not execution"): every byte parsed here comes
// off a socket and is UNTRUSTED. The parser is therefore deliberately hostile:
//   • hard depth limit (kMaxDepth) — no stack exhaustion from nested arrays;
//   • hard input size limit enforced by the caller before parse();
//   • no duplicate-key merging, no comments, no trailing commas, no NaN/Inf;
//   • numbers are parsed with std::from_chars into double — never eval'd;
//   • parse() NEVER throws: it returns false and fills an error string.
// The result is inert data. Nothing here can name a tool, a workflow node, or
// a feature-IR symbol; the caller must lift values out by explicit key lookup.
//
// Pure C++20 + the standard library. No third-party dependency.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <cstddef>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace forge::retrieval::json {

enum class Kind { Null, Bool, Number, String, Array, Object };

class Value {
public:
  Value() = default;
  static Value makeNull() { return Value(); }
  static Value makeBool(bool b);
  static Value makeNumber(double d);
  static Value makeString(std::string s);
  static Value makeArray(std::vector<Value> a);
  static Value makeObject(std::map<std::string, Value> o);

  Kind kind() const { return kind_; }
  bool isNull() const { return kind_ == Kind::Null; }
  bool isObject() const { return kind_ == Kind::Object; }
  bool isArray() const { return kind_ == Kind::Array; }
  bool isString() const { return kind_ == Kind::String; }
  bool isNumber() const { return kind_ == Kind::Number; }

  bool boolean(bool fallback = false) const { return kind_ == Kind::Bool ? bool_ : fallback; }
  double number(double fallback = 0.0) const { return kind_ == Kind::Number ? num_ : fallback; }
  const std::string& str() const { return str_; }

  const std::vector<Value>& items() const { return arr_; }
  const std::map<std::string, Value>& fields() const { return obj_; }

  // Explicit key lookup. Returns a static null Value when absent or when this
  // is not an object — retrieval code must never assume a shape it did not see.
  const Value& at(const std::string& key) const;
  bool has(const std::string& key) const;

  // Convenience readers that never throw and never coerce across kinds.
  std::string stringField(const std::string& key, const std::string& fallback = {}) const;
  double numberField(const std::string& key, double fallback = 0.0) const;

  // Serialize. Escapes to strict RFC-8259; used only for the POST body we send.
  std::string dump() const;

private:
  Kind kind_ = Kind::Null;
  bool bool_ = false;
  double num_ = 0.0;
  std::string str_;
  std::vector<Value> arr_;
  std::map<std::string, Value> obj_;
};

// Maximum container nesting accepted from the wire.
inline constexpr int kMaxDepth = 32;

// Parses `text` into `out`. Returns false (with `error` filled) on any
// malformed, over-deep, or trailing-garbage input. Never throws.
bool parse(const std::string& text, Value& out, std::string& error);

// Escapes a string as a JSON string literal, quotes included.
std::string escape(const std::string& raw);

}  // namespace forge::retrieval::json
