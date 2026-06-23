// forge/native/brep/StepPart21.hpp
//
// Shared, header-only ISO-10303-21 (STEP Part 21) LEXER / INSTANCE PARSER for the
// Forge native kernel. Pure C++20, standard library ONLY — no OCCT, no WASM, no
// filesystem. This is the type-agnostic substrate that BOTH the faceted codec
// (StepFaceted) and the analytic codec (StepAnalytic) build on:
//
//   * Instance            — one parsed "#id = TYPE ( params ) ;" record.
//   * splitTopLevel()     — split a parameter string at TOP-LEVEL commas only,
//                           respecting nested parens and single-quoted strings
//                           (where '' is an escaped quote).
//   * parseRef()          — "#n" -> numeric id.
//   * parseList()         — "(a,b,c)" -> its top-level fields.
//   * locateSections()    — validate the ISO/HEADER/DATA/ENDSEC envelope and
//                           return the DATA body span.
//   * parseInstances()    — build an id -> Instance table from the DATA body.
//   * stepFmt()/stepNum() — locale-independent shortest-round-trip REAL <-> double
//                           (std::to_chars / std::from_chars), bit-identical.
//
// ============================ HONESTY (Bible §0/§9) ========================
// This file ADDS NO geometry semantics — it is the lexer only. It does NOT decide
// what a CARTESIAN_POINT or a CYLINDRICAL_SURFACE means; the codecs do. Every
// parser entry returns a bool / sets a `why` string and NEVER fabricates a
// partial result. Header-only (inline) so it can be #included into more than one
// translation unit with no ODR clash and no extra link target.
//
// The grammar handled is the ASCII Part-21 instance form actually emitted by the
// Forge writers AND by OCCT/typical AP242 exporters for the entities the codecs
// consume: simple instances "#id=TYPE(...);". (Complex/combined ABS instances of
// the "#id=(TYPEA(...)TYPEB(...));" form are NOT decoded here — a codec that
// needs one detects it and falls back honestly.)

#ifndef FORGE_NATIVE_BREP_STEPPART21_HPP
#define FORGE_NATIVE_BREP_STEPPART21_HPP

#include <charconv>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace brep {
namespace p21 {

// ---------------------------------------------------------------------------
// Locale-independent REAL formatting / parsing. Bit-identical round trip.
// ---------------------------------------------------------------------------
inline std::string stepFmt(double v) {
    char buf[64];
    auto res = std::to_chars(buf, buf + sizeof(buf), v);
    if (res.ec != std::errc()) return std::string("0.");
    std::string s(buf, res.ptr);
    bool hasDotOrExp = false;
    for (char c : s) {
        if (c == '.' || c == 'e' || c == 'E') { hasDotOrExp = true; break; }
    }
    if (!hasDotOrExp) s += '.';
    return s;
}

inline bool stepNum(const std::string& token, double& out) {
    if (token.empty()) return false;
    const char* first = token.data();
    const char* last  = token.data() + token.size();
    double value = 0.0;
    auto res = std::from_chars(first, last, value);
    if (res.ec != std::errc()) return false;
    if (res.ptr != last) return false;
    if (!std::isfinite(value)) return false;
    out = value;
    return true;
}

// ---------------------------------------------------------------------------
// A parsed Part-21 instance: its type keyword and the RAW parameter string
// inside the outermost parentheses.
// ---------------------------------------------------------------------------
struct Instance {
    std::string type;    // e.g. "CARTESIAN_POINT"
    std::string params;  // raw text between the outermost ( )
};

inline bool isSpace_(char c) {
    return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f' ||
           c == '\v';
}

inline void trim_(const std::string& s, std::size_t& b, std::size_t& e) {
    while (b < e && isSpace_(s[b])) ++b;
    while (e > b && isSpace_(s[e - 1])) --e;
}

inline bool parseU64_(const char* first, const char* last, std::uint64_t& out) {
    if (first == last) return false;
    std::uint64_t value = 0;
    auto res = std::from_chars(first, last, value);
    if (res.ec != std::errc()) return false;
    if (res.ptr != last) return false;
    out = value;
    return true;
}

// Split a parameter string at TOP-LEVEL commas only (respecting nested parens and
// single-quoted strings, where '' is an escaped quote). Returns trimmed fields.
inline std::vector<std::string> splitTopLevel(const std::string& s) {
    std::vector<std::string> out;
    int depth = 0;
    bool inStr = false;
    std::size_t fieldStart = 0;
    const std::size_t n = s.size();
    for (std::size_t i = 0; i < n; ++i) {
        const char c = s[i];
        if (inStr) {
            if (c == '\'') {
                if (i + 1 < n && s[i + 1] == '\'') { ++i; }
                else inStr = false;
            }
            continue;
        }
        if (c == '\'') { inStr = true; }
        else if (c == '(') { ++depth; }
        else if (c == ')') { --depth; }
        else if (c == ',' && depth == 0) {
            std::size_t b = fieldStart, e = i;
            trim_(s, b, e);
            out.emplace_back(s.substr(b, e - b));
            fieldStart = i + 1;
        }
    }
    std::size_t b = fieldStart, e = n;
    trim_(s, b, e);
    if (!(out.empty() && b == e)) {
        out.emplace_back(s.substr(b, e - b));
    }
    return out;
}

// Parse a "#<n>" reference token to its numeric id. False otherwise.
inline bool parseRef(const std::string& tok, std::uint64_t& id) {
    if (tok.size() < 2 || tok[0] != '#') return false;
    return parseU64_(tok.data() + 1, tok.data() + tok.size(), id);
}

// Parse the contents of a parenthesized LIST "(a,b,c)" into its top-level fields.
inline bool parseList(const std::string& tok, std::vector<std::string>& fields) {
    std::size_t b = 0, e = tok.size();
    if (b >= e || tok[b] != '(' || tok[e - 1] != ')') return false;
    std::string inner = tok.substr(b + 1, e - b - 2);
    fields = splitTopLevel(inner);
    return true;
}

// Find the DATA ... ENDSEC body span. Validates the ISO/HEADER/DATA envelope.
inline bool locateSections(const std::string& t, std::size_t& dataBegin,
                           std::size_t& dataEnd, std::string& why) {
    const std::string ISO_BEGIN = "ISO-10303-21;";
    const std::string ISO_END   = "END-ISO-10303-21;";
    std::size_t isoB = t.find(ISO_BEGIN);
    if (isoB == std::string::npos) { why = "missing ISO-10303-21; marker"; return false; }
    std::size_t isoE = t.find(ISO_END);
    if (isoE == std::string::npos) { why = "missing END-ISO-10303-21; marker"; return false; }
    if (isoE < isoB) { why = "END-ISO before ISO marker"; return false; }

    std::size_t hdr = t.find("HEADER;", isoB);
    if (hdr == std::string::npos || hdr > isoE) { why = "missing HEADER; section"; return false; }
    std::size_t hdrEnd = t.find("ENDSEC;", hdr);
    if (hdrEnd == std::string::npos || hdrEnd > isoE) { why = "missing HEADER ENDSEC;"; return false; }

    std::size_t dat = t.find("DATA;", hdrEnd);
    if (dat == std::string::npos || dat > isoE) { why = "missing DATA; section"; return false; }
    std::size_t datBody = dat + 5;  // past "DATA;"
    std::size_t datEnd = t.find("ENDSEC;", datBody);
    if (datEnd == std::string::npos || datEnd > isoE) { why = "missing DATA ENDSEC;"; return false; }

    dataBegin = datBody;
    dataEnd = datEnd;
    return true;
}

// Tokenize the DATA body into id -> Instance.
//   #<id> = <TYPE> ( <params> ) ;
// SKIPS /* ... */ comments. Returns false on a structurally broken instance.
// A COMPLEX instance "#id=(TYPEA(...)TYPEB(...));" (params begins with '(' after
// the '=') is stored with type "" and the whole "(...)" as params, so a codec can
// detect+reject it rather than mis-parse it.
inline bool parseInstances(const std::string& t, std::size_t begin, std::size_t end,
                           std::unordered_map<std::uint64_t, Instance>& table,
                           std::string& why) {
    std::size_t i = begin;
    auto skipWsAndComments = [&]() {
        for (;;) {
            while (i < end && isSpace_(t[i])) ++i;
            if (i + 1 < end && t[i] == '/' && t[i + 1] == '*') {
                std::size_t close = t.find("*/", i + 2);
                if (close == std::string::npos || close >= end) { i = end; return; }
                i = close + 2;
                continue;
            }
            break;
        }
    };
    while (true) {
        skipWsAndComments();
        if (i >= end) break;
        if (t[i] != '#') { why = "expected '#' starting an instance"; return false; }
        ++i;  // past '#'
        std::size_t numB = i;
        while (i < end && t[i] >= '0' && t[i] <= '9') ++i;
        if (i == numB) { why = "instance id is not numeric"; return false; }
        std::uint64_t id = 0;
        if (!parseU64_(t.data() + numB, t.data() + i, id)) { why = "instance id overflow"; return false; }
        skipWsAndComments();
        if (i >= end || t[i] != '=') { why = "expected '=' after instance id"; return false; }
        ++i;  // past '='
        skipWsAndComments();

        std::string type;
        if (i < end && t[i] == '(') {
            // COMPLEX instance: type left empty, params == the full "(...)".
            type.clear();
        } else {
            std::size_t typeB = i;
            while (i < end && (t[i] == '_' || (t[i] >= 'A' && t[i] <= 'Z') ||
                               (t[i] >= '0' && t[i] <= '9'))) ++i;
            if (i == typeB) { why = "missing entity type keyword"; return false; }
            type = t.substr(typeB, i - typeB);
            skipWsAndComments();
            if (i >= end || t[i] != '(') { why = "expected '(' after entity type"; return false; }
        }
        // Capture the balanced parameter string (excluding the outer parens).
        std::size_t paramB = i + 1;
        int depth = 0;
        bool inStr = false;
        std::size_t j = i;
        for (; j < end; ++j) {
            const char c = t[j];
            if (inStr) {
                if (c == '\'') {
                    if (j + 1 < end && t[j + 1] == '\'') { ++j; }
                    else inStr = false;
                }
                continue;
            }
            if (c == '\'') inStr = true;
            else if (c == '(') ++depth;
            else if (c == ')') { --depth; if (depth == 0) break; }
        }
        if (j >= end || depth != 0) { why = "unbalanced parentheses in instance"; return false; }
        std::string params = t.substr(paramB, j - paramB);
        i = j + 1;  // past matching ')'
        skipWsAndComments();
        if (i >= end || t[i] != ';') { why = "expected ';' terminating instance"; return false; }
        ++i;  // past ';'

        if (!table.emplace(id, Instance{std::move(type), std::move(params)}).second) {
            why = "duplicate instance id #" + std::to_string(id);
            return false;
        }
    }
    return true;
}

} // namespace p21
} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_STEPPART21_HPP
