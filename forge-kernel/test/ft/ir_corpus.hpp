// forge-kernel/test/ft/ir_corpus.hpp
//
// T-132 test helper: read IR PROGRAMS out of JSON / JSONL corpora without a JSON
// library. Every JSON string literal in the file is decoded; the ones holding at
// least one `%N = OP(` statement line are programs. That takes the `ir` value of a
// {"id","ir"} row, an IR string nested anywhere in a larger record, and every
// example in a one-object JSON file alike -- and it takes them VERBATIM, so a
// round-trip gate over them compares against exactly the bytes that were stored.
//
// Header-only and kernel-free: both the op-record gate and the parse-parity
// fingerprint (which is compiled against the PRE-change parser too) include it,
// so it may use nothing from forge::ft.
#pragma once

#include <cctype>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <sstream>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

namespace ir_corpus {

inline void appendUtf8(std::string& out, std::uint32_t cp) {
    if (cp < 0x80) {
        out += static_cast<char>(cp);
    } else if (cp < 0x800) {
        out += static_cast<char>(0xC0 | (cp >> 6));
        out += static_cast<char>(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
        out += static_cast<char>(0xE0 | (cp >> 12));
        out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (cp & 0x3F));
    } else {
        out += static_cast<char>(0xF0 | (cp >> 18));
        out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
        out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (cp & 0x3F));
    }
}

inline bool hex4(const std::string& s, std::size_t at, std::uint32_t& v) {
    if (at + 4 > s.size()) return false;
    v = 0;
    for (std::size_t i = at; i < at + 4; ++i) {
        const char c = s[i];
        v <<= 4;
        if (c >= '0' && c <= '9') v |= static_cast<std::uint32_t>(c - '0');
        else if (c >= 'a' && c <= 'f') v |= static_cast<std::uint32_t>(c - 'a' + 10);
        else if (c >= 'A' && c <= 'F') v |= static_cast<std::uint32_t>(c - 'A' + 10);
        else return false;
    }
    return true;
}

// Every string literal in a JSON text, decoded. Returns false (with the offset)
// on a literal it cannot decode -- a corpus the reader misreads must fail the
// gate, not shrink it.
inline bool jsonStrings(const std::string& t, std::vector<std::string>& out, std::size_t& badAt) {
    std::size_t i = 0;
    const std::size_t n = t.size();
    while (i < n) {
        if (t[i] != '"') { ++i; continue; }
        ++i;
        std::string s;
        bool closed = false;
        while (i < n) {
            const char c = t[i];
            if (c == '"') { closed = true; ++i; break; }
            if (c != '\\') { s += c; ++i; continue; }
            if (i + 1 >= n) { badAt = i; return false; }
            const char e = t[i + 1];
            i += 2;
            switch (e) {
                case '"': s += '"'; break;
                case '\\': s += '\\'; break;
                case '/': s += '/'; break;
                case 'b': s += '\b'; break;
                case 'f': s += '\f'; break;
                case 'n': s += '\n'; break;
                case 'r': s += '\r'; break;
                case 't': s += '\t'; break;
                case 'u': {
                    std::uint32_t cp = 0;
                    if (!hex4(t, i, cp)) { badAt = i; return false; }
                    i += 4;
                    if (cp >= 0xD800 && cp <= 0xDBFF && i + 6 <= n && t[i] == '\\' &&
                        t[i + 1] == 'u') {
                        std::uint32_t lo = 0;
                        if (hex4(t, i + 2, lo) && lo >= 0xDC00 && lo <= 0xDFFF) {
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                            i += 6;
                        }
                    }
                    appendUtf8(s, cp);
                    break;
                }
                default: badAt = i - 2; return false;
            }
        }
        if (!closed) { badAt = n; return false; }
        out.push_back(std::move(s));
    }
    return true;
}

// `%N = OP(` at the start of some line (leading whitespace allowed).
inline bool holdsStatement(const std::string& s) {
    std::size_t i = 0;
    const std::size_t n = s.size();
    while (i < n) {
        std::size_t k = i;
        while (k < n && (s[k] == ' ' || s[k] == '\t')) ++k;
        bool ok = k < n && s[k] == '%';
        if (ok) {
            ++k;
            if (k < n && s[k] == '-') ++k;
            const std::size_t d0 = k;
            while (k < n && std::isdigit(static_cast<unsigned char>(s[k]))) ++k;
            ok = k > d0;
        }
        if (ok) {
            while (k < n && (s[k] == ' ' || s[k] == '\t')) ++k;
            ok = k < n && s[k] == '=';
            ++k;
        }
        if (ok) {
            while (k < n && (s[k] == ' ' || s[k] == '\t')) ++k;
            ok = k < n && (std::isalpha(static_cast<unsigned char>(s[k])) || s[k] == '_');
            while (k < n && (std::isalnum(static_cast<unsigned char>(s[k])) || s[k] == '_')) ++k;
            while (ok && k < n && (s[k] == ' ' || s[k] == '\t')) ++k;
            ok = ok && k < n && s[k] == '(';
        }
        if (ok) return true;
        const std::size_t nl = s.find('\n', i);
        if (nl == std::string::npos) break;
        i = nl + 1;
    }
    return false;
}

struct Program {
    std::string origin;   // "<file>#<n>": the n-th program read from that file
    std::string text;
};

// Read every program from each file, in file order, deduplicated by exact text
// across all files. A file named *.ir is ONE raw program; any other file is JSON
// or JSONL. `err` names the first file that could not be read or decoded.
inline bool readCorpus(const std::vector<std::string>& files, std::vector<Program>& out,
                       std::string& err) {
    std::unordered_set<std::string> seen;
    for (const std::string& f : files) {
        std::ifstream in(f, std::ios::binary);
        if (!in.good()) { err = "cannot open " + f; return false; }
        std::ostringstream ss;
        ss << in.rdbuf();
        std::vector<std::string> strs;
        std::size_t badAt = 0;
        const bool rawIr = f.size() > 3 && f.compare(f.size() - 3, 3, ".ir") == 0;
        if (rawIr) {
            strs.push_back(ss.str());   // a *.ir file IS one program, verbatim
        } else if (!jsonStrings(ss.str(), strs, badAt)) {
            err = "cannot decode a JSON string in " + f + " at byte " + std::to_string(badAt);
            return false;
        }
        std::size_t k = 0;
        for (std::string& s : strs) {
            if (!holdsStatement(s) || !seen.insert(s).second) continue;
            out.push_back(Program{f + "#" + std::to_string(k++), std::move(s)});
        }
    }
    return true;
}

// 64-bit FNV-1a: a stable, dependency-free digest for fingerprints.
inline std::uint64_t fnv1a(const std::string& s) {
    std::uint64_t h = 1469598103934665603ULL;
    for (unsigned char c : s) {
        h ^= c;
        h *= 1099511628211ULL;
    }
    return h;
}

}  // namespace ir_corpus
