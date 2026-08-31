#include "update/Manifest.hpp"

#include <cctype>
#include <cstdlib>

namespace forge::update {
namespace {

struct Reader {
  const std::string& s;
  std::size_t i = 0;
  std::string err;

  explicit Reader(const std::string& in) : s(in) {}

  bool eof() const { return i >= s.size(); }
  char peek() const { return i < s.size() ? s[i] : '\0'; }

  void skipWs() {
    while (i < s.size()) {
      const char c = s[i];
      if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
        ++i;
      } else {
        break;
      }
    }
  }

  bool expect(char c) {
    skipWs();
    if (i < s.size() && s[i] == c) {
      ++i;
      return true;
    }
    err = std::string("expected '") + c + "' at byte " + std::to_string(i);
    return false;
  }

  // A JSON string with the standard escapes. \u is accepted only for the ASCII
  // range: the manifest carries versions, hex digests and URLs, none of which
  // need a code point above 0x7f, and a partial UTF-16 surrogate decoder is more
  // attack surface than this document is worth.
  bool readString(std::string& out) {
    skipWs();
    if (!expect('"')) return false;
    out.clear();
    while (true) {
      if (i >= s.size()) {
        err = "unterminated string";
        return false;
      }
      const char c = s[i++];
      if (c == '"') return true;
      if (c == '\\') {
        if (i >= s.size()) {
          err = "unterminated escape";
          return false;
        }
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
            if (i + 4 > s.size()) {
              err = "truncated \\u escape";
              return false;
            }
            unsigned code = 0;
            for (int k = 0; k < 4; ++k) {
              const char h = s[i + k];
              unsigned d = 0;
              if (h >= '0' && h <= '9') d = static_cast<unsigned>(h - '0');
              else if (h >= 'a' && h <= 'f') d = static_cast<unsigned>(h - 'a' + 10);
              else if (h >= 'A' && h <= 'F') d = static_cast<unsigned>(h - 'A' + 10);
              else {
                err = "bad \\u escape";
                return false;
              }
              code = (code << 4) | d;
            }
            i += 4;
            if (code > 0x7f) {
              err = "non-ASCII \\u escape is not accepted in an appcast";
              return false;
            }
            out.push_back(static_cast<char>(code));
            break;
          }
          default:
            err = "unknown escape";
            return false;
        }
        continue;
      }
      // A raw control character inside a string is invalid JSON; refusing it
      // stops a manifest smuggling a newline into a field that gets logged.
      if (static_cast<unsigned char>(c) < 0x20) {
        err = "raw control character in string";
        return false;
      }
      out.push_back(c);
    }
  }

  // Numbers, true, false and null are read as their SOURCE TEXT. The only
  // numeric field the schema has is `size`, converted by the caller; keeping the
  // text means an unknown numeric field survives into `raw` for diagnostics.
  bool readScalar(std::string& out) {
    skipWs();
    if (peek() == '"') return readString(out);
    const std::size_t start = i;
    while (i < s.size()) {
      const char c = s[i];
      if (c == ',' || c == '}' || c == ' ' || c == '\t' || c == '\r' || c == '\n') break;
      if (c == '{' || c == '[') {
        err = "nested values are not accepted in an appcast";
        return false;
      }
      ++i;
    }
    if (i == start) {
      err = "empty value at byte " + std::to_string(start);
      return false;
    }
    out = s.substr(start, i - start);
    return true;
  }
};

bool isHex64(const std::string& s) {
  if (s.size() != 64) return false;
  for (char c : s) {
    const bool ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    if (!ok) return false;
  }
  return true;
}

// Splits "https://host/path" -> scheme, host, path. Returns false on anything
// that is not that shape. Rejects userinfo ("user@host"), which is the classic
// way to make a URL LOOK like it points at github.com.
bool splitUrl(const std::string& url, std::string& scheme, std::string& host, std::string& path) {
  const std::size_t sep = url.find("://");
  if (sep == std::string::npos) return false;
  scheme = url.substr(0, sep);
  for (char& c : scheme) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  std::string rest = url.substr(sep + 3);
  const std::size_t slash = rest.find('/');
  host = slash == std::string::npos ? rest : rest.substr(0, slash);
  path = slash == std::string::npos ? std::string("/") : rest.substr(slash);
  if (host.empty()) return false;
  if (host.find('@') != std::string::npos) return false;  // userinfo
  // Strip an explicit port, then require the host to look like a hostname.
  const std::size_t colon = host.find(':');
  if (colon != std::string::npos) host = host.substr(0, colon);
  if (host.empty()) return false;
  for (char& c : host) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  for (char c : host) {
    const bool ok = std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '-';
    if (!ok) return false;
  }
  return true;
}

}  // namespace

Manifest parseManifest(const std::string& json, std::string& err) {
  Manifest m;
  err.clear();
  if (json.size() > kMaxManifestBytes) {
    err = "manifest is " + std::to_string(json.size()) + " bytes, over the " +
          std::to_string(kMaxManifestBytes) + " byte cap";
    return m;
  }

  Reader r(json);
  if (!r.expect('{')) {
    err = r.err;
    return m;
  }
  r.skipWs();
  if (r.peek() == '}') {
    err = "manifest is an empty object";
    return m;
  }
  while (true) {
    std::string key;
    if (!r.readString(key)) {
      err = r.err;
      return m;
    }
    if (!r.expect(':')) {
      err = r.err;
      return m;
    }
    std::string value;
    if (!r.readScalar(value)) {
      err = r.err;
      return m;
    }
    if (m.raw.count(key) != 0) {
      // A duplicate key means two parsers can legitimately disagree about the
      // document's meaning. Refuse rather than pick one.
      err = "duplicate key '" + key + "'";
      return m;
    }
    m.raw[key] = value;
    r.skipWs();
    if (r.peek() == ',') {
      ++r.i;
      continue;
    }
    if (r.peek() == '}') {
      ++r.i;
      break;
    }
    err = "expected ',' or '}' at byte " + std::to_string(r.i);
    return m;
  }
  r.skipWs();
  if (!r.eof()) {
    err = "trailing bytes after the object";
    return m;
  }

  auto get = [&](const char* k) -> std::string {
    const auto it = m.raw.find(k);
    return it == m.raw.end() ? std::string() : it->second;
  };
  m.schema = get("schema");
  m.channel = get("channel");
  m.version = get("version");
  m.arch = get("arch");
  m.min_macos = get("min_macos");
  m.url = get("url");
  m.sha256 = get("sha256");
  m.notes_url = get("notes_url");
  m.pub_date = get("pub_date");

  const std::string size_text = get("size");
  if (!size_text.empty()) {
    bool digits = true;
    for (char c : size_text) {
      if (!std::isdigit(static_cast<unsigned char>(c))) digits = false;
    }
    if (!digits) {
      err = "size is not a non-negative integer: '" + size_text + "'";
      return m;
    }
    m.size = std::strtoull(size_text.c_str(), nullptr, 10);
  }

  m.valid = true;
  return m;
}

bool validateManifest(const Manifest& m, std::string& err) {
  err.clear();
  if (!m.valid) {
    err = "manifest did not parse";
    return false;
  }
  if (m.schema != kManifestSchema) {
    err = "unknown schema '" + m.schema + "', this build understands '" +
          std::string(kManifestSchema) + "'";
    return false;
  }
  if (m.version.empty()) {
    err = "no version";
    return false;
  }
  if (m.url.empty()) {
    err = "no url";
    return false;
  }
  if (!isHex64(m.sha256)) {
    err = "sha256 is not 64 hex characters: '" + m.sha256 + "'";
    return false;
  }
  if (m.size == 0) {
    err = "size is zero or missing";
    return false;
  }
  return true;
}

bool isAllowedDownloadUrl(const std::string& url, const std::vector<std::string>& allowed_hosts) {
  std::string scheme, host, path;
  if (!splitUrl(url, scheme, host, path)) return false;
  if (scheme != "https") return false;
  for (const std::string& allowed : allowed_hosts) {
    std::string a = allowed;
    for (char& c : a) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (a.empty()) continue;
    if (host == a) return true;
    // Dot-suffix, NOT substring: "objects.github.com" matches "github.com",
    // "github.com.evil.tld" does not.
    if (host.size() > a.size() + 1) {
      const std::size_t at = host.size() - a.size();
      if (host.compare(at, a.size(), a) == 0 && host[at - 1] == '.') return true;
    }
  }
  return false;
}

bool isPayloadUrlPinned(const std::string& url) {
  std::string scheme, host, path;
  if (!splitUrl(url, scheme, host, path)) return false;
  if (scheme != "https") return false;
  // A floating link is exactly the shape the app uses for the MANIFEST, and
  // exactly the shape the payload must never have.
  if (path.find("/releases/latest/") != std::string::npos) return false;
  return path.find("/releases/download/") != std::string::npos;
}

}  // namespace forge::update
