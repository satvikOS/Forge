// forge/native/brep/MeshExchange.cpp
//
// Implementation of the in-house mesh interchange codec (MeshExchange.hpp).
// Pure C++20, standard library only. See header for scope / honesty posture.
//
// Design notes:
//   * Float formatting uses std::to_chars (general, shortest round-trip) and
//     parsing uses std::from_chars — both locale-independent — so a written
//     coordinate parses back to the bit-identical double. That is the whole
//     reason a closed mesh's enclosed volume survives a write/read round trip.
//   * Readers are strict: any header/count mismatch, non-finite or unparseable
//     number, non-triangular or out-of-range face, or a truncated stream yields
//     ok=false with a diagnostic, never a partial/fabricated mesh (0 FAKES).

#include "forge/native/brep/MeshExchange.hpp"

// Standard headers actually used in THIS TU (header already lists the full set;
// repeated here so the .cpp is self-sufficient on libstdc++ as well).
#include <algorithm>
#include <array>
#include <charconv>
#include <cstdlib>
#include <cerrno>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace forge {
namespace native {
namespace brep {

// ===========================================================================
// Locale-independent float formatting / parsing
// ===========================================================================
std::string formatDouble(double v) {
    // Shortest representation that round-trips to the identical double.
    char buf[64];
    auto res = std::to_chars(buf, buf + sizeof(buf), v);
    if (res.ec != std::errc()) {
        // Should not happen for a finite double; fall back to a fixed-width
        // hex-precision-equivalent. (Non-finite is rejected upstream.)
        return std::string("0");
    }
    return std::string(buf, res.ptr);
}

bool parseDouble(const std::string& token, double& out) {
    // libc++ (Apple) deletes std::from_chars for floating-point; strtod is the
    // portable equivalent. Same strictness: no leading whitespace, the WHOLE
    // token must parse, and the value must be finite.
    if (token.empty()) return false;
    if (std::isspace(static_cast<unsigned char>(token.front()))) return false;
    errno = 0;
    char* end = nullptr;
    const double value = std::strtod(token.c_str(), &end);
    if (end != token.c_str() + token.size()) return false;  // trailing garbage => reject
    if (errno == ERANGE) return false;                      // over/underflow
    if (!std::isfinite(value)) return false;                // NaN / inf are not valid coords
    out = value;
    return true;
}

namespace {

// Parse an unsigned integer token fully (no trailing garbage). Returns false on
// any non-digit content or overflow.
bool parseU64(const std::string& token, std::uint64_t& out) {
    if (token.empty()) return false;
    const char* first = token.data();
    const char* last  = token.data() + token.size();
    std::uint64_t value = 0;
    auto res = std::from_chars(first, last, value);
    if (res.ec != std::errc()) return false;
    if (res.ptr != last) return false;
    out = value;
    return true;
}

// Parse a (possibly negative) signed integer token fully.
bool parseI64(const std::string& token, std::int64_t& out) {
    if (token.empty()) return false;
    const char* first = token.data();
    const char* last  = token.data() + token.size();
    std::int64_t value = 0;
    auto res = std::from_chars(first, last, value);
    if (res.ec != std::errc()) return false;
    if (res.ptr != last) return false;
    out = value;
    return true;
}

inline bool isSpace(char c) {
    return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f' ||
           c == '\v';
}

// Split a line into whitespace-separated tokens.
std::vector<std::string> tokenize(const std::string& line) {
    std::vector<std::string> out;
    std::size_t i = 0;
    const std::size_t n = line.size();
    while (i < n) {
        while (i < n && isSpace(line[i])) ++i;
        if (i >= n) break;
        std::size_t j = i;
        while (j < n && !isSpace(line[j])) ++j;
        out.emplace_back(line.substr(i, j - i));
        i = j;
    }
    return out;
}

// Iterate over the lines of a text buffer. Returns the next line (without the
// terminator) starting at position `pos`, advancing `pos` past the newline.
// Returns false when `pos` is at end. Handles \n and \r\n.
bool nextLine(const std::string& text, std::size_t& pos, std::string& line) {
    const std::size_t n = text.size();
    if (pos >= n) return false;
    std::size_t start = pos;
    std::size_t i = pos;
    while (i < n && text[i] != '\n') ++i;
    std::size_t end = i;
    // strip a trailing '\r'
    if (end > start && text[end - 1] == '\r') --end;
    line.assign(text, start, end - start);
    pos = (i < n) ? i + 1 : n;
    return true;
}

// Append "v.x v.y v.z" (round-trip floats) to `out`, separated by single
// spaces, with no trailing space.
void appendXYZ(std::string& out, double x, double y, double z) {
    out += formatDouble(x);
    out += ' ';
    out += formatDouble(y);
    out += ' ';
    out += formatDouble(z);
}

ReadResult fail(const std::string& reason) {
    ReadResult r;
    r.ok = false;
    r.reason = reason;
    return r;
}

// Final structural validation shared by every reader: lengths multiples of 3,
// every index in range, at least one triangle. Returns "" on success or a
// diagnostic string.
std::string finalizeCheck(const TriMesh& m) {
    if (m.indices.empty()) return "no triangles";
    if (m.positions.size() % 3 != 0) return "position array not a multiple of 3";
    if (m.indices.size() % 3 != 0) return "index array not a multiple of 3";
    const std::uint32_t vcount =
        static_cast<std::uint32_t>(m.positions.size() / 3);
    for (std::uint32_t idx : m.indices) {
        if (idx >= vcount) return "face index out of range";
    }
    return "";
}

} // namespace

// ===========================================================================
// TriMesh members
// ===========================================================================
bool TriMesh::wellFormed() const {
    if (positions.size() % 3 != 0) return false;
    if (indices.size() % 3 != 0) return false;
    const std::uint32_t vcount = static_cast<std::uint32_t>(positions.size() / 3);
    for (std::uint32_t idx : indices) {
        if (idx >= vcount) return false;
    }
    return true;
}

double TriMesh::signedVolume() const {
    double vol = 0.0;
    const std::size_t tris = indices.size() / 3;
    for (std::size_t t = 0; t < tris; ++t) {
        const std::uint32_t ia = indices[3 * t + 0];
        const std::uint32_t ib = indices[3 * t + 1];
        const std::uint32_t ic = indices[3 * t + 2];
        const double ax = positions[3 * ia + 0];
        const double ay = positions[3 * ia + 1];
        const double az = positions[3 * ia + 2];
        const double bx = positions[3 * ib + 0];
        const double by = positions[3 * ib + 1];
        const double bz = positions[3 * ib + 2];
        const double cx = positions[3 * ic + 0];
        const double cy = positions[3 * ic + 1];
        const double cz = positions[3 * ic + 2];
        // (a x b) . c / 6
        const double cross_x = ay * bz - az * by;
        const double cross_y = az * bx - ax * bz;
        const double cross_z = ax * by - ay * bx;
        vol += (cross_x * cx + cross_y * cy + cross_z * cz);
    }
    return vol / 6.0;
}

// ===========================================================================
// weldVertices — fuse bit-identical triangle-soup corners into a shared table
// ===========================================================================
namespace {
// Hash/key a vertex by the exact 64-bit pattern of its three coordinates, so
// identical doubles weld and no tolerance is introduced.
struct VKey {
    std::uint64_t x, y, z;
    bool operator==(const VKey& o) const {
        return x == o.x && y == o.y && z == o.z;
    }
};
struct VKeyHash {
    std::size_t operator()(const VKey& k) const {
        // 64-bit mix (splitmix-style combine of the three lanes).
        std::uint64_t h = k.x * 0x9E3779B97F4A7C15ull;
        h ^= (k.y + 0x9E3779B97F4A7C15ull + (h << 6) + (h >> 2));
        h ^= (k.z + 0x9E3779B97F4A7C15ull + (h << 6) + (h >> 2));
        return static_cast<std::size_t>(h);
    }
};
std::uint64_t bits(double d) {
    std::uint64_t u;
    std::memcpy(&u, &d, sizeof(u));
    // Normalize -0.0 to +0.0 so the two welded as identical (they are the same
    // geometric point and compare equal under ==).
    if (u == 0x8000000000000000ull) u = 0;
    return u;
}
} // namespace

TriMesh weldVertices(const std::vector<double>& soupXYZ) {
    TriMesh out;
    const std::size_t corners = soupXYZ.size() / 3;
    std::unordered_map<VKey, std::uint32_t, VKeyHash> table;
    table.reserve(corners);
    out.indices.reserve(corners);
    for (std::size_t c = 0; c < corners; ++c) {
        const double x = soupXYZ[3 * c + 0];
        const double y = soupXYZ[3 * c + 1];
        const double z = soupXYZ[3 * c + 2];
        VKey key{bits(x), bits(y), bits(z)};
        auto it = table.find(key);
        std::uint32_t vi;
        if (it == table.end()) {
            vi = static_cast<std::uint32_t>(out.positions.size() / 3);
            out.positions.push_back(x);
            out.positions.push_back(y);
            out.positions.push_back(z);
            table.emplace(key, vi);
        } else {
            vi = it->second;
        }
        out.indices.push_back(vi);
    }
    return out;
}

// ===========================================================================
// STL (ASCII)
// ===========================================================================
std::string MeshExchange::writeSTL(const TriMesh& mesh,
                                   const std::string& solidName) {
    std::string out;
    out.reserve(mesh.triangleCount() * 180 + 64);
    out += "solid ";
    out += solidName;
    out += '\n';
    const std::size_t tris = mesh.indices.size() / 3;
    for (std::size_t t = 0; t < tris; ++t) {
        const std::uint32_t ia = mesh.indices[3 * t + 0];
        const std::uint32_t ib = mesh.indices[3 * t + 1];
        const std::uint32_t ic = mesh.indices[3 * t + 2];
        const double ax = mesh.positions[3 * ia + 0];
        const double ay = mesh.positions[3 * ia + 1];
        const double az = mesh.positions[3 * ia + 2];
        const double bx = mesh.positions[3 * ib + 0];
        const double by = mesh.positions[3 * ib + 1];
        const double bz = mesh.positions[3 * ib + 2];
        const double cx = mesh.positions[3 * ic + 0];
        const double cy = mesh.positions[3 * ic + 1];
        const double cz = mesh.positions[3 * ic + 2];
        // Face normal (best-effort; not load-bearing — reader ignores it).
        double ux = bx - ax, uy = by - ay, uz = bz - az;
        double vx = cx - ax, vy = cy - ay, vz = cz - az;
        double nx = uy * vz - uz * vy;
        double ny = uz * vx - ux * vz;
        double nz = ux * vy - uy * vx;
        const double len = std::sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0.0) { nx /= len; ny /= len; nz /= len; }
        out += "  facet normal ";
        appendXYZ(out, nx, ny, nz);
        out += "\n    outer loop\n";
        out += "      vertex ";
        appendXYZ(out, ax, ay, az);
        out += "\n      vertex ";
        appendXYZ(out, bx, by, bz);
        out += "\n      vertex ";
        appendXYZ(out, cx, cy, cz);
        out += "\n    endloop\n  endfacet\n";
    }
    out += "endsolid ";
    out += solidName;
    out += '\n';
    return out;
}

ReadResult MeshExchange::readSTL(const std::string& text) {
    // Binary STL starts with an 80-byte header and is NOT ascii — reject so a
    // binary blob is never misread as text.
    {
        // Heuristic: an ascii STL's first non-space token must be "solid".
        std::size_t p = 0;
        while (p < text.size() && isSpace(text[p])) ++p;
        if (text.compare(p, 5, "solid") != 0) {
            return fail("STL: missing 'solid' keyword (not ASCII STL)");
        }
    }
    std::vector<double> soup;  // triangle-soup corners (3 per vertex)
    std::size_t pos = 0;
    std::string line;
    bool sawSolid = false;
    bool sawEndsolid = false;
    int loopVerts = -1;        // -1 = not inside an outer loop
    std::size_t facetVerts = 0;
    bool inFacet = false;

    while (nextLine(text, pos, line)) {
        std::vector<std::string> tk = tokenize(line);
        if (tk.empty()) continue;
        const std::string& kw = tk[0];
        if (kw == "solid") {
            sawSolid = true;
        } else if (kw == "facet") {
            inFacet = true;
            facetVerts = 0;
            // "facet normal nx ny nz" — normal is optional content, ignored.
        } else if (kw == "outer") {
            if (tk.size() < 2 || tk[1] != "loop")
                return fail("STL: malformed 'outer loop'");
            loopVerts = 0;
        } else if (kw == "vertex") {
            if (loopVerts < 0) return fail("STL: 'vertex' outside an outer loop");
            if (tk.size() != 4) return fail("STL: vertex needs 3 coordinates");
            double x, y, z;
            if (!parseDouble(tk[1], x) || !parseDouble(tk[2], y) ||
                !parseDouble(tk[3], z))
                return fail("STL: unparseable vertex coordinate");
            soup.push_back(x);
            soup.push_back(y);
            soup.push_back(z);
            ++loopVerts;
            ++facetVerts;
        } else if (kw == "endloop") {
            if (loopVerts != 3)
                return fail("STL: outer loop did not contain exactly 3 vertices");
            loopVerts = -1;
        } else if (kw == "endfacet") {
            if (!inFacet || facetVerts != 3)
                return fail("STL: facet did not contain exactly 3 vertices");
            inFacet = false;
        } else if (kw == "endsolid") {
            sawEndsolid = true;
        } else {
            return fail("STL: unexpected keyword '" + kw + "'");
        }
    }
    if (!sawSolid) return fail("STL: no solid block");
    if (!sawEndsolid) return fail("STL: missing endsolid (truncated)");
    if (inFacet) return fail("STL: truncated facet");
    if (soup.empty()) return fail("STL: no facets");

    ReadResult r;
    r.mesh = weldVertices(soup);
    const std::string err = finalizeCheck(r.mesh);
    if (!err.empty()) return fail("STL: " + err);
    r.ok = true;
    return r;
}

// ===========================================================================
// OBJ (v / f)
// ===========================================================================
std::string MeshExchange::writeOBJ(const TriMesh& mesh) {
    std::string out;
    out.reserve(mesh.vertexCount() * 32 + mesh.triangleCount() * 16 + 64);
    out += "# forge::native::brep::MeshExchange OBJ\n";
    const std::size_t vc = mesh.positions.size() / 3;
    for (std::size_t v = 0; v < vc; ++v) {
        out += "v ";
        appendXYZ(out, mesh.positions[3 * v + 0], mesh.positions[3 * v + 1],
                  mesh.positions[3 * v + 2]);
        out += '\n';
    }
    const std::size_t tc = mesh.indices.size() / 3;
    for (std::size_t t = 0; t < tc; ++t) {
        // OBJ indices are 1-based.
        out += "f ";
        out += std::to_string(mesh.indices[3 * t + 0] + 1);
        out += ' ';
        out += std::to_string(mesh.indices[3 * t + 1] + 1);
        out += ' ';
        out += std::to_string(mesh.indices[3 * t + 2] + 1);
        out += '\n';
    }
    return out;
}

namespace {
// Extract the leading position index from an OBJ face token, which may be
// "i", "i/t", "i//n", or "i/t/n". 1-based; we convert to 0-based. Negative
// (relative) indices are supported (counted from the current vertex count).
bool parseObjFaceIndex(const std::string& tok, std::int64_t vcountSoFar,
                       std::uint32_t& out) {
    // take substring up to first '/'
    std::size_t slash = tok.find('/');
    std::string head = (slash == std::string::npos) ? tok : tok.substr(0, slash);
    std::int64_t idx;
    if (!parseI64(head, idx)) return false;
    if (idx == 0) return false;  // OBJ indices are never 0
    std::int64_t zeroBased;
    if (idx > 0) {
        zeroBased = idx - 1;
    } else {
        // relative-from-end
        zeroBased = vcountSoFar + idx;
    }
    if (zeroBased < 0 || zeroBased >= vcountSoFar) return false;
    out = static_cast<std::uint32_t>(zeroBased);
    return true;
}
} // namespace

ReadResult MeshExchange::readOBJ(const std::string& text) {
    TriMesh m;
    std::size_t pos = 0;
    std::string line;
    while (nextLine(text, pos, line)) {
        // strip a trailing comment after '#'
        std::size_t hash = line.find('#');
        std::string body = (hash == std::string::npos) ? line : line.substr(0, hash);
        std::vector<std::string> tk = tokenize(body);
        if (tk.empty()) continue;
        const std::string& kw = tk[0];
        if (kw == "v") {
            if (tk.size() < 4) return fail("OBJ: 'v' needs 3 coordinates");
            double x, y, z;
            if (!parseDouble(tk[1], x) || !parseDouble(tk[2], y) ||
                !parseDouble(tk[3], z))
                return fail("OBJ: unparseable vertex coordinate");
            m.positions.push_back(x);
            m.positions.push_back(y);
            m.positions.push_back(z);
        } else if (kw == "f") {
            if (tk.size() != 4)
                return fail("OBJ: only triangular faces supported (face had " +
                            std::to_string(tk.size() - 1) + " vertices)");
            const std::int64_t vc =
                static_cast<std::int64_t>(m.positions.size() / 3);
            std::uint32_t a, b, c;
            if (!parseObjFaceIndex(tk[1], vc, a) ||
                !parseObjFaceIndex(tk[2], vc, b) ||
                !parseObjFaceIndex(tk[3], vc, c))
                return fail("OBJ: bad/out-of-range face index");
            m.indices.push_back(a);
            m.indices.push_back(b);
            m.indices.push_back(c);
        } else if (kw == "vt" || kw == "vn" || kw == "vp" || kw == "g" ||
                   kw == "o" || kw == "s" || kw == "mtllib" || kw == "usemtl" ||
                   kw == "l") {
            // Recognized-but-ignored OBJ statements (we keep only v/f geometry).
            continue;
        } else {
            return fail("OBJ: unexpected statement '" + kw + "'");
        }
    }
    const std::string err = finalizeCheck(m);
    if (!err.empty()) return fail("OBJ: " + err);
    ReadResult r;
    r.ok = true;
    r.mesh = std::move(m);
    return r;
}

// ===========================================================================
// OFF
// ===========================================================================
std::string MeshExchange::writeOFF(const TriMesh& mesh) {
    std::string out;
    const std::size_t vc = mesh.positions.size() / 3;
    const std::size_t fc = mesh.indices.size() / 3;
    out.reserve(vc * 32 + fc * 16 + 64);
    out += "OFF\n";
    out += std::to_string(vc);
    out += ' ';
    out += std::to_string(fc);
    out += " 0\n";  // edge count is conventionally 0 (unused)
    for (std::size_t v = 0; v < vc; ++v) {
        appendXYZ(out, mesh.positions[3 * v + 0], mesh.positions[3 * v + 1],
                  mesh.positions[3 * v + 2]);
        out += '\n';
    }
    for (std::size_t t = 0; t < fc; ++t) {
        out += "3 ";
        out += std::to_string(mesh.indices[3 * t + 0]);
        out += ' ';
        out += std::to_string(mesh.indices[3 * t + 1]);
        out += ' ';
        out += std::to_string(mesh.indices[3 * t + 2]);
        out += '\n';
    }
    return out;
}

namespace {
// Read the next NON-EMPTY, non-comment line into tokens. OFF comments begin
// with '#'. Returns false at end of stream.
bool nextOffTokens(const std::string& text, std::size_t& pos,
                   std::vector<std::string>& tk) {
    std::string line;
    while (nextLine(text, pos, line)) {
        std::size_t hash = line.find('#');
        std::string body = (hash == std::string::npos) ? line : line.substr(0, hash);
        tk = tokenize(body);
        if (!tk.empty()) return true;
    }
    return false;
}
} // namespace

ReadResult MeshExchange::readOFF(const std::string& text) {
    std::size_t pos = 0;
    std::vector<std::string> tk;
    // Magic line: "OFF" (possibly with COFF/NOFF variants — we accept a token
    // that ends with "OFF"; counts may follow on the same line in some files).
    if (!nextOffTokens(text, pos, tk)) return fail("OFF: empty stream");
    std::size_t magicLen = tk[0].size();
    bool magicOk = magicLen >= 3 && tk[0].compare(magicLen - 3, 3, "OFF") == 0;
    if (!magicOk) return fail("OFF: missing 'OFF' magic");

    // Counts may be the remainder of the magic line or the next token line.
    std::vector<std::string> counts;
    if (tk.size() >= 4) {
        counts.assign(tk.begin() + 1, tk.end());
    } else {
        if (!nextOffTokens(text, pos, counts))
            return fail("OFF: missing count line");
    }
    if (counts.size() < 3) return fail("OFF: count line needs nV nF nE");
    std::uint64_t nV, nF, nE;
    if (!parseU64(counts[0], nV) || !parseU64(counts[1], nF) ||
        !parseU64(counts[2], nE))
        return fail("OFF: unparseable counts");
    (void)nE;  // edge count is informational only

    TriMesh m;
    m.positions.reserve(nV * 3);
    for (std::uint64_t v = 0; v < nV; ++v) {
        if (!nextOffTokens(text, pos, tk))
            return fail("OFF: vertex block truncated");
        if (tk.size() < 3) return fail("OFF: vertex needs 3 coordinates");
        double x, y, z;
        if (!parseDouble(tk[0], x) || !parseDouble(tk[1], y) ||
            !parseDouble(tk[2], z))
            return fail("OFF: unparseable vertex coordinate");
        m.positions.push_back(x);
        m.positions.push_back(y);
        m.positions.push_back(z);
    }
    m.indices.reserve(nF * 3);
    for (std::uint64_t f = 0; f < nF; ++f) {
        if (!nextOffTokens(text, pos, tk))
            return fail("OFF: face block truncated");
        std::uint64_t k;
        if (!parseU64(tk[0], k)) return fail("OFF: bad face vertex count");
        if (k != 3) return fail("OFF: only triangular faces supported");
        if (tk.size() < 4) return fail("OFF: face line truncated");
        std::uint64_t ia, ib, ic;
        if (!parseU64(tk[1], ia) || !parseU64(tk[2], ib) || !parseU64(tk[3], ic))
            return fail("OFF: unparseable face index");
        if (ia >= nV || ib >= nV || ic >= nV)
            return fail("OFF: face index out of range");
        m.indices.push_back(static_cast<std::uint32_t>(ia));
        m.indices.push_back(static_cast<std::uint32_t>(ib));
        m.indices.push_back(static_cast<std::uint32_t>(ic));
    }
    const std::string err = finalizeCheck(m);
    if (!err.empty()) return fail("OFF: " + err);
    ReadResult r;
    r.ok = true;
    r.mesh = std::move(m);
    return r;
}

// ===========================================================================
// PLY (ASCII)
// ===========================================================================
std::string MeshExchange::writePLY(const TriMesh& mesh) {
    std::string out;
    const std::size_t vc = mesh.positions.size() / 3;
    const std::size_t fc = mesh.indices.size() / 3;
    out.reserve(vc * 32 + fc * 16 + 256);
    out += "ply\n";
    out += "format ascii 1.0\n";
    out += "comment forge::native::brep::MeshExchange\n";
    out += "element vertex ";
    out += std::to_string(vc);
    out += '\n';
    out += "property float x\nproperty float y\nproperty float z\n";
    out += "element face ";
    out += std::to_string(fc);
    out += '\n';
    out += "property list uchar int vertex_indices\n";
    out += "end_header\n";
    for (std::size_t v = 0; v < vc; ++v) {
        appendXYZ(out, mesh.positions[3 * v + 0], mesh.positions[3 * v + 1],
                  mesh.positions[3 * v + 2]);
        out += '\n';
    }
    for (std::size_t t = 0; t < fc; ++t) {
        out += "3 ";
        out += std::to_string(mesh.indices[3 * t + 0]);
        out += ' ';
        out += std::to_string(mesh.indices[3 * t + 1]);
        out += ' ';
        out += std::to_string(mesh.indices[3 * t + 2]);
        out += '\n';
    }
    return out;
}

ReadResult MeshExchange::readPLY(const std::string& text) {
    std::size_t pos = 0;
    std::string line;
    // --- header ---
    if (!nextLine(text, pos, line)) return fail("PLY: empty stream");
    {
        std::vector<std::string> tk = tokenize(line);
        if (tk.empty() || tk[0] != "ply") return fail("PLY: missing 'ply' magic");
    }
    bool formatOk = false;
    std::uint64_t nV = 0, nF = 0;
    bool haveV = false, haveF = false;
    bool endHeader = false;
    // Track which element we are currently describing, to count its properties.
    enum class Elem { None, Vertex, Face };
    Elem cur = Elem::None;
    int vertexProps = 0;  // number of scalar vertex properties (need >= 3)

    while (nextLine(text, pos, line)) {
        std::vector<std::string> tk = tokenize(line);
        if (tk.empty()) continue;
        const std::string& kw = tk[0];
        if (kw == "comment" || kw == "obj_info") {
            continue;
        } else if (kw == "format") {
            if (tk.size() < 3 || tk[1] != "ascii")
                return fail("PLY: only 'format ascii 1.0' supported");
            formatOk = true;
        } else if (kw == "element") {
            if (tk.size() < 3) return fail("PLY: malformed element line");
            std::uint64_t count;
            if (!parseU64(tk[2], count)) return fail("PLY: bad element count");
            if (tk[1] == "vertex") {
                nV = count; haveV = true; cur = Elem::Vertex; vertexProps = 0;
            } else if (tk[1] == "face") {
                nF = count; haveF = true; cur = Elem::Face;
            } else {
                // Unknown element type — we cannot know its body size, reject
                // honestly rather than mis-parse.
                return fail("PLY: unsupported element '" + tk[1] + "'");
            }
        } else if (kw == "property") {
            if (cur == Elem::Vertex) {
                // "property <type> <name>" — count scalar props.
                if (tk.size() >= 2 && tk[1] == "list")
                    return fail("PLY: unexpected list property on vertex");
                ++vertexProps;
            } else if (cur == Elem::Face) {
                // Expect "property list <countType> <indexType> <name>".
                if (tk.size() < 2 || tk[1] != "list")
                    return fail("PLY: face property must be a list");
            } else {
                return fail("PLY: property outside an element");
            }
        } else if (kw == "end_header") {
            endHeader = true;
            break;
        } else {
            return fail("PLY: unexpected header keyword '" + kw + "'");
        }
    }
    if (!formatOk) return fail("PLY: missing format line");
    if (!endHeader) return fail("PLY: missing end_header");
    if (!haveV || !haveF) return fail("PLY: missing vertex/face element");
    if (vertexProps < 3) return fail("PLY: vertex needs >= 3 properties (x,y,z)");

    // --- vertex body --- (read first 3 scalars of each line as x,y,z)
    TriMesh m;
    m.positions.reserve(nV * 3);
    for (std::uint64_t v = 0; v < nV; ++v) {
        if (!nextLine(text, pos, line)) return fail("PLY: vertex body truncated");
        std::vector<std::string> tk = tokenize(line);
        if (static_cast<int>(tk.size()) < vertexProps)
            return fail("PLY: vertex line has too few values");
        double x, y, z;
        if (!parseDouble(tk[0], x) || !parseDouble(tk[1], y) ||
            !parseDouble(tk[2], z))
            return fail("PLY: unparseable vertex coordinate");
        m.positions.push_back(x);
        m.positions.push_back(y);
        m.positions.push_back(z);
    }
    // --- face body ---
    m.indices.reserve(nF * 3);
    for (std::uint64_t f = 0; f < nF; ++f) {
        if (!nextLine(text, pos, line)) return fail("PLY: face body truncated");
        std::vector<std::string> tk = tokenize(line);
        if (tk.empty()) return fail("PLY: empty face line");
        std::uint64_t k;
        if (!parseU64(tk[0], k)) return fail("PLY: bad face vertex count");
        if (k != 3) return fail("PLY: only triangular faces supported");
        if (tk.size() < 4) return fail("PLY: face line truncated");
        std::uint64_t ia, ib, ic;
        if (!parseU64(tk[1], ia) || !parseU64(tk[2], ib) || !parseU64(tk[3], ic))
            return fail("PLY: unparseable face index");
        if (ia >= nV || ib >= nV || ic >= nV)
            return fail("PLY: face index out of range");
        m.indices.push_back(static_cast<std::uint32_t>(ia));
        m.indices.push_back(static_cast<std::uint32_t>(ib));
        m.indices.push_back(static_cast<std::uint32_t>(ic));
    }
    const std::string err = finalizeCheck(m);
    if (!err.empty()) return fail("PLY: " + err);
    ReadResult r;
    r.ok = true;
    r.mesh = std::move(m);
    return r;
}

// ===========================================================================
// Closure census + tolerance weld (T-350)
// ===========================================================================
namespace {

std::uint64_t edgeKey(std::uint32_t a, std::uint32_t b) {
    return (static_cast<std::uint64_t>(a) << 32) | static_cast<std::uint64_t>(b);
}

bool allFinite(const std::vector<double>& v) {
    for (const double d : v) {
        if (!std::isfinite(d)) return false;
    }
    return true;
}

} // namespace

MeshClosureReport closureReport(const TriMesh& mesh) {
    MeshClosureReport r;
    r.triangles = mesh.indices.size() / 3;
    if (!mesh.wellFormed()) {
        r.wellFormed = false;
        return r;
    }
    std::unordered_map<std::uint64_t, std::uint32_t> uses;
    uses.reserve(mesh.indices.size() + 1);
    for (std::size_t t = 0; t < r.triangles; ++t) {
        const std::uint32_t a = mesh.indices[3 * t + 0];
        const std::uint32_t b = mesh.indices[3 * t + 1];
        const std::uint32_t c = mesh.indices[3 * t + 2];
        if (a == b || b == c || c == a) {
            ++r.degenerateTriangles;
            continue;
        }
        ++uses[edgeKey(a, b)];
        ++uses[edgeKey(b, c)];
        ++uses[edgeKey(c, a)];
    }
    for (const auto& entry : uses) {
        if (entry.second > 1) ++r.overusedEdges;
        const std::uint64_t reverse = (entry.first << 32) | (entry.first >> 32);
        if (uses.find(reverse) == uses.end()) ++r.boundaryEdges;
    }
    return r;
}

namespace {

struct CellKey {
    std::int64_t x, y, z;
    bool operator==(const CellKey& o) const { return x == o.x && y == o.y && z == o.z; }
};
struct CellKeyHash {
    std::size_t operator()(const CellKey& k) const {
        std::uint64_t h = static_cast<std::uint64_t>(k.x) * 0x9E3779B97F4A7C15ull;
        h ^= static_cast<std::uint64_t>(k.y) + 0x9E3779B97F4A7C15ull + (h << 6) + (h >> 2);
        h ^= static_cast<std::uint64_t>(k.z) + 0x9E3779B97F4A7C15ull + (h << 6) + (h >> 2);
        return static_cast<std::size_t>(h);
    }
};

} // namespace

TriMesh weldWithinTolerance(const TriMesh& mesh, double tolerance,
                            std::size_t* droppedTriangles) {
    if (droppedTriangles != nullptr) *droppedTriangles = 0;
    TriMesh out;
    if (!mesh.wellFormed() || !allFinite(mesh.positions)) return out;
    if (!std::isfinite(tolerance) || tolerance < 0.0) return out;

    const std::size_t nv = mesh.vertexCount();
    std::vector<std::uint32_t> remap(nv, 0);
    if (tolerance == 0.0) {
        // Exact: the bit-pattern weld the STL reader already uses.
        std::unordered_map<VKey, std::uint32_t, VKeyHash> table;
        table.reserve(nv + 1);
        for (std::size_t v = 0; v < nv; ++v) {
            const double x = mesh.positions[3 * v + 0];
            const double y = mesh.positions[3 * v + 1];
            const double z = mesh.positions[3 * v + 2];
            const VKey key{bits(x), bits(y), bits(z)};
            const auto it = table.find(key);
            if (it != table.end()) {
                remap[v] = it->second;
                continue;
            }
            const std::uint32_t id = static_cast<std::uint32_t>(out.positions.size() / 3);
            out.positions.push_back(x);
            out.positions.push_back(y);
            out.positions.push_back(z);
            table.emplace(key, id);
            remap[v] = id;
        }
    } else {
        // A uniform grid whose cell is at least `tolerance`, so any vertex
        // within tolerance of a representative lies in that representative's
        // cell or one of its 26 neighbours. The cell is widened (never
        // narrowed) when the coordinates are so large that coord/cell would
        // not fit an int64 -- a wider cell is still correct, only slower.
        double maxAbs = 0.0;
        for (const double d : mesh.positions) maxAbs = std::max(maxAbs, std::fabs(d));
        const double cell = std::max(tolerance, maxAbs / 1e15);
        std::unordered_map<CellKey, std::vector<std::uint32_t>, CellKeyHash> grid;
        grid.reserve(nv + 1);
        for (std::size_t v = 0; v < nv; ++v) {
            const double p[3] = {mesh.positions[3 * v + 0], mesh.positions[3 * v + 1],
                                 mesh.positions[3 * v + 2]};
            const CellKey home{static_cast<std::int64_t>(std::floor(p[0] / cell)),
                               static_cast<std::int64_t>(std::floor(p[1] / cell)),
                               static_cast<std::int64_t>(std::floor(p[2] / cell))};
            std::uint32_t best = std::numeric_limits<std::uint32_t>::max();
            for (std::int64_t dx = -1; dx <= 1; ++dx) {
                for (std::int64_t dy = -1; dy <= 1; ++dy) {
                    for (std::int64_t dz = -1; dz <= 1; ++dz) {
                        const auto it = grid.find(CellKey{home.x + dx, home.y + dy, home.z + dz});
                        if (it == grid.end()) continue;
                        for (const std::uint32_t rep : it->second) {
                            if (rep >= best) continue;
                            const double* q = &out.positions[3 * static_cast<std::size_t>(rep)];
                            if (std::fabs(q[0] - p[0]) <= tolerance &&
                                std::fabs(q[1] - p[1]) <= tolerance &&
                                std::fabs(q[2] - p[2]) <= tolerance) {
                                best = rep;  // the FIRST representative within reach
                            }
                        }
                    }
                }
            }
            if (best != std::numeric_limits<std::uint32_t>::max()) {
                remap[v] = best;
                continue;
            }
            const std::uint32_t id = static_cast<std::uint32_t>(out.positions.size() / 3);
            out.positions.push_back(p[0]);
            out.positions.push_back(p[1]);
            out.positions.push_back(p[2]);
            grid[home].push_back(id);
            remap[v] = id;
        }
    }

    std::size_t dropped = 0;
    out.indices.reserve(mesh.indices.size());
    for (std::size_t t = 0; t < mesh.triangleCount(); ++t) {
        const std::uint32_t a = remap[mesh.indices[3 * t + 0]];
        const std::uint32_t b = remap[mesh.indices[3 * t + 1]];
        const std::uint32_t c = remap[mesh.indices[3 * t + 2]];
        if (a == b || b == c || c == a) {
            ++dropped;
            continue;
        }
        out.indices.push_back(a);
        out.indices.push_back(b);
        out.indices.push_back(c);
    }
    if (droppedTriangles != nullptr) *droppedTriangles = dropped;
    return out;
}

// ===========================================================================
// OBJ with a header comment
// ===========================================================================
std::string MeshExchange::writeOBJ(const TriMesh& mesh, const std::string& headerComment) {
    const std::string base = writeOBJ(mesh);
    const std::size_t firstLineEnd = base.find('\n');
    std::string comment;
    std::size_t start = 0;
    while (start <= headerComment.size()) {
        std::size_t end = headerComment.find('\n', start);
        if (end == std::string::npos) end = headerComment.size();
        std::string line = headerComment.substr(start, end - start);
        while (!line.empty() && line.back() == '\r') line.pop_back();
        comment += "# ";
        comment += line;
        comment += '\n';
        start = end + 1;
        if (end == headerComment.size()) break;
    }
    if (headerComment.empty()) comment.clear();
    if (firstLineEnd == std::string::npos) return base + comment;
    return base.substr(0, firstLineEnd + 1) + comment + base.substr(firstLineEnd + 1);
}

// ===========================================================================
// Little-endian byte helpers, CRC-32 and a STORED zip (for 3MF)
// ===========================================================================
namespace {

void putU16(std::string& out, std::uint32_t v) {
    out.push_back(static_cast<char>(v & 0xFFu));
    out.push_back(static_cast<char>((v >> 8) & 0xFFu));
}
void putU32(std::string& out, std::uint32_t v) {
    out.push_back(static_cast<char>(v & 0xFFu));
    out.push_back(static_cast<char>((v >> 8) & 0xFFu));
    out.push_back(static_cast<char>((v >> 16) & 0xFFu));
    out.push_back(static_cast<char>((v >> 24) & 0xFFu));
}
std::uint32_t getU16(const std::string& s, std::size_t off) {
    return static_cast<std::uint32_t>(static_cast<unsigned char>(s[off])) |
           (static_cast<std::uint32_t>(static_cast<unsigned char>(s[off + 1])) << 8);
}
std::uint32_t getU32(const std::string& s, std::size_t off) {
    return static_cast<std::uint32_t>(static_cast<unsigned char>(s[off])) |
           (static_cast<std::uint32_t>(static_cast<unsigned char>(s[off + 1])) << 8) |
           (static_cast<std::uint32_t>(static_cast<unsigned char>(s[off + 2])) << 16) |
           (static_cast<std::uint32_t>(static_cast<unsigned char>(s[off + 3])) << 24);
}

// CRC-32, the IEEE 802.3 polynomial (reflected 0xEDB88320) that ZIP names.
std::uint32_t crc32Of(const std::string& data) {
    static const std::array<std::uint32_t, 256> table = [] {
        std::array<std::uint32_t, 256> t{};
        for (std::uint32_t n = 0; n < 256; ++n) {
            std::uint32_t c = n;
            for (int k = 0; k < 8; ++k) c = (c & 1u) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
            t[n] = c;
        }
        return t;
    }();
    std::uint32_t crc = 0xFFFFFFFFu;
    for (const char ch : data) {
        crc = table[(crc ^ static_cast<unsigned char>(ch)) & 0xFFu] ^ (crc >> 8);
    }
    return crc ^ 0xFFFFFFFFu;
}

constexpr std::uint32_t kZipLocalSig = 0x04034b50u;
constexpr std::uint32_t kZipCentralSig = 0x02014b50u;
constexpr std::uint32_t kZipEndSig = 0x06054b50u;
constexpr std::uint32_t kZipVersion = 20;     // 2.0: the version every reader accepts
constexpr std::uint32_t kZipDosTime = 0;      // 00:00:00 -- deterministic output
constexpr std::uint32_t kZipDosDate = 0x21;   // 1980-01-01, the DOS epoch

struct ZipPart {
    std::string name;
    std::string data;
};

bool buildStoredZip(const std::vector<ZipPart>& parts, std::string& out, std::string& why) {
    out.clear();
    if (parts.size() >= 0xFFFFu) { why = "too many parts for a ZIP without ZIP64"; return false; }
    std::size_t total = 22;
    for (const ZipPart& p : parts) {
        if (p.name.empty() || p.name.size() >= 0xFFFFu) { why = "a part name is empty or too long"; return false; }
        total += 30 + 46 + 2 * p.name.size() + p.data.size();
    }
    if (total >= 0xFFFFFFFFull) { why = "the package would need ZIP64 (over 4 GiB)"; return false; }
    out.reserve(total);
    std::string central;
    for (const ZipPart& p : parts) {
        const std::uint32_t crc = crc32Of(p.data);
        const std::uint32_t size = static_cast<std::uint32_t>(p.data.size());
        const std::uint32_t offset = static_cast<std::uint32_t>(out.size());
        putU32(out, kZipLocalSig);
        putU16(out, kZipVersion);
        putU16(out, 0);              // flags: none (no data descriptor, no encryption)
        putU16(out, 0);              // method 0: STORED
        putU16(out, kZipDosTime);
        putU16(out, kZipDosDate);
        putU32(out, crc);
        putU32(out, size);           // compressed size == uncompressed when stored
        putU32(out, size);
        putU16(out, static_cast<std::uint32_t>(p.name.size()));
        putU16(out, 0);              // extra field length
        out += p.name;
        out += p.data;

        putU32(central, kZipCentralSig);
        putU16(central, kZipVersion);  // version made by (MS-DOS / FAT attribute model)
        putU16(central, kZipVersion);  // version needed
        putU16(central, 0);
        putU16(central, 0);
        putU16(central, kZipDosTime);
        putU16(central, kZipDosDate);
        putU32(central, crc);
        putU32(central, size);
        putU32(central, size);
        putU16(central, static_cast<std::uint32_t>(p.name.size()));
        putU16(central, 0);            // extra
        putU16(central, 0);            // comment
        putU16(central, 0);            // disk number start
        putU16(central, 0);            // internal attributes
        putU32(central, 0);            // external attributes
        putU32(central, offset);
        central += p.name;
    }
    const std::uint32_t centralOffset = static_cast<std::uint32_t>(out.size());
    out += central;
    putU32(out, kZipEndSig);
    putU16(out, 0);
    putU16(out, 0);
    putU16(out, static_cast<std::uint32_t>(parts.size()));
    putU16(out, static_cast<std::uint32_t>(parts.size()));
    putU32(out, static_cast<std::uint32_t>(central.size()));
    putU32(out, centralOffset);
    putU16(out, 0);                    // comment length
    return true;
}

std::string lowerAscii(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

// Reads every entry of a STORED zip, verifying each CRC-32 and that the local
// and central records agree. Refuses -- with a reason -- anything it cannot
// read COMPLETELY: compression other than STORED, encryption, ZIP64, multi-disk
// archives, overlapping or out-of-range records, duplicate names.
bool readStoredZip(const std::string& bytes, std::vector<ZipPart>& parts, std::string& why) {
    parts.clear();
    if (bytes.size() < 22) { why = "too short to be a ZIP package"; return false; }
    // The end record is the last 22 bytes plus a comment of at most 65535.
    std::size_t eocd = std::string::npos;
    const std::size_t lowest = bytes.size() > 22 + 0xFFFFu ? bytes.size() - 22 - 0xFFFFu : 0;
    for (std::size_t at = bytes.size() - 22 + 1; at-- > lowest;) {
        if (getU32(bytes, at) == kZipEndSig && at + 22 + getU16(bytes, at + 20) == bytes.size()) {
            eocd = at;
            break;
        }
    }
    if (eocd == std::string::npos) { why = "no ZIP end-of-central-directory record (truncated?)"; return false; }
    const std::uint32_t disk = getU16(bytes, eocd + 4);
    const std::uint32_t cdDisk = getU16(bytes, eocd + 6);
    const std::uint32_t onDisk = getU16(bytes, eocd + 8);
    const std::uint32_t count = getU16(bytes, eocd + 10);
    const std::uint32_t cdSize = getU32(bytes, eocd + 12);
    const std::uint32_t cdOffset = getU32(bytes, eocd + 16);
    if (disk != 0 || cdDisk != 0 || onDisk != count) { why = "multi-disk ZIP archives are not supported"; return false; }
    if (count == 0xFFFFu || cdSize == 0xFFFFFFFFu || cdOffset == 0xFFFFFFFFu) { why = "ZIP64 archives are not supported"; return false; }
    if (static_cast<std::uint64_t>(cdOffset) + cdSize != eocd) { why = "the ZIP central directory does not end where the end record starts"; return false; }

    std::set<std::string> seen;
    std::size_t at = cdOffset;
    for (std::uint32_t i = 0; i < count; ++i) {
        if (at + 46 > eocd || getU32(bytes, at) != kZipCentralSig) { why = "a ZIP central directory record is damaged"; return false; }
        const std::uint32_t flags = getU16(bytes, at + 8);
        const std::uint32_t method = getU16(bytes, at + 10);
        const std::uint32_t crc = getU32(bytes, at + 16);
        const std::uint32_t csize = getU32(bytes, at + 20);
        const std::uint32_t usize = getU32(bytes, at + 24);
        const std::uint32_t nameLen = getU16(bytes, at + 28);
        const std::uint32_t extraLen = getU16(bytes, at + 30);
        const std::uint32_t commentLen = getU16(bytes, at + 32);
        const std::uint32_t local = getU32(bytes, at + 42);
        if (at + 46 + nameLen + extraLen + commentLen > eocd) { why = "a ZIP central directory record overruns the directory"; return false; }
        const std::string name = bytes.substr(at + 46, nameLen);
        at += 46 + nameLen + extraLen + commentLen;
        if ((flags & 0x1u) != 0) { why = "the ZIP entry \"" + name + "\" is encrypted"; return false; }
        if (method != 0) {
            why = "the ZIP entry \"" + name + "\" is compressed (method " + std::to_string(method) +
                  "); this reader accepts STORED entries only";
            return false;
        }
        if (csize != usize) { why = "a STORED ZIP entry's two sizes disagree"; return false; }
        if (static_cast<std::uint64_t>(local) + 30 > cdOffset || getU32(bytes, local) != kZipLocalSig) {
            why = "the ZIP local header for \"" + name + "\" is missing"; return false;
        }
        const std::uint32_t localNameLen = getU16(bytes, local + 26);
        const std::uint32_t localExtraLen = getU16(bytes, local + 28);
        const std::uint64_t dataStart = static_cast<std::uint64_t>(local) + 30 + localNameLen + localExtraLen;
        if (dataStart + csize > cdOffset) { why = "the ZIP entry \"" + name + "\" runs past the central directory"; return false; }
        if (bytes.compare(local + 30, localNameLen, name) != 0) { why = "a ZIP local header names a different part than its central record"; return false; }
        if ((getU16(bytes, local + 6) & 0x8u) == 0) {
            // No data descriptor: the local sizes and CRC are authoritative too.
            if (getU32(bytes, local + 14) != crc || getU32(bytes, local + 18) != csize ||
                getU32(bytes, local + 22) != usize) {
                why = "the ZIP local and central records disagree about \"" + name + "\""; return false;
            }
        }
        std::string data = bytes.substr(static_cast<std::size_t>(dataStart), csize);
        if (crc32Of(data) != crc) { why = "the ZIP entry \"" + name + "\" fails its CRC-32 check"; return false; }
        if (!seen.insert(lowerAscii(name)).second) { why = "the package names the part \"" + name + "\" twice"; return false; }
        parts.push_back(ZipPart{name, std::move(data)});
    }
    if (at != eocd) { why = "the ZIP central directory has trailing bytes"; return false; }
    return true;
}

// ===========================================================================
// A small, strict XML reader -- enough for OPC parts and the 3MF core model.
// No DTDs (refused, so no entity expansion), no external anything.
// ===========================================================================
struct XmlAttr {
    std::string name;
    std::string value;
};
struct XmlTag {
    bool end = false;          // </name>
    bool selfClosing = false;  // <name ... />
    std::string name;
    std::vector<XmlAttr> attrs;
    const std::string* attr(const char* key) const {
        for (const XmlAttr& a : attrs) {
            if (a.name == key) return &a.value;
        }
        return nullptr;
    }
};

void appendUtf8(std::string& out, std::uint32_t cp) {
    if (cp < 0x80) {
        out.push_back(static_cast<char>(cp));
    } else if (cp < 0x800) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp < 0x10000) {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
}

bool xmlDecode(const std::string& raw, std::string& out) {
    out.clear();
    for (std::size_t i = 0; i < raw.size(); ++i) {
        if (raw[i] != '&') {
            out.push_back(raw[i]);
            continue;
        }
        const std::size_t semi = raw.find(';', i);
        if (semi == std::string::npos || semi - i > 12) return false;
        const std::string ent = raw.substr(i + 1, semi - i - 1);
        if (ent == "lt") out.push_back('<');
        else if (ent == "gt") out.push_back('>');
        else if (ent == "amp") out.push_back('&');
        else if (ent == "quot") out.push_back('"');
        else if (ent == "apos") out.push_back('\'');
        else if (ent.size() > 1 && ent[0] == '#') {
            std::uint64_t cp = 0;
            const bool hex = ent[1] == 'x' || ent[1] == 'X';
            const std::size_t from = hex ? 2 : 1;
            if (from >= ent.size()) return false;
            for (std::size_t k = from; k < ent.size(); ++k) {
                const char c = ent[k];
                int d = -1;
                if (c >= '0' && c <= '9') d = c - '0';
                else if (hex && c >= 'a' && c <= 'f') d = c - 'a' + 10;
                else if (hex && c >= 'A' && c <= 'F') d = c - 'A' + 10;
                if (d < 0) return false;
                cp = cp * (hex ? 16u : 10u) + static_cast<std::uint64_t>(d);
                if (cp > 0x10FFFF) return false;
            }
            if (cp == 0) return false;
            appendUtf8(out, static_cast<std::uint32_t>(cp));
        } else {
            return false;  // an undeclared entity; there is no DTD to declare one
        }
        i = semi;
    }
    return true;
}

bool isXmlSpace(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }
bool isXmlNameChar(char c) {
    return !isXmlSpace(c) && c != '/' && c != '>' && c != '=' && c != '<' && c != '"' &&
           c != '\'' && c != '\0';
}

class XmlCursor {
public:
    explicit XmlCursor(const std::string& text) : s_(text) {}
    // Next tag, skipping text, comments, processing instructions and CDATA.
    // false at the end (`error()` empty) or on malformed input (`error()` set).
    bool next(XmlTag& tag) {
        tag = XmlTag{};
        for (;;) {
            const std::size_t lt = s_.find('<', pos_);
            if (lt == std::string::npos) { pos_ = s_.size(); return false; }
            pos_ = lt;
            if (s_.compare(pos_, 4, "<!--") == 0) {
                const std::size_t e = s_.find("-->", pos_ + 4);
                if (e == std::string::npos) return bad("an unterminated XML comment");
                pos_ = e + 3;
                continue;
            }
            if (s_.compare(pos_, 9, "<![CDATA[") == 0) {
                const std::size_t e = s_.find("]]>", pos_ + 9);
                if (e == std::string::npos) return bad("an unterminated CDATA section");
                pos_ = e + 3;
                continue;
            }
            if (s_.compare(pos_, 2, "<?") == 0) {
                const std::size_t e = s_.find("?>", pos_ + 2);
                if (e == std::string::npos) return bad("an unterminated XML declaration");
                pos_ = e + 2;
                continue;
            }
            if (s_.compare(pos_, 2, "<!") == 0) return bad("a DTD, which this reader refuses");
            break;
        }
        ++pos_;  // past '<'
        if (pos_ < s_.size() && s_[pos_] == '/') {
            tag.end = true;
            ++pos_;
        }
        const std::size_t nameStart = pos_;
        while (pos_ < s_.size() && isXmlNameChar(s_[pos_])) ++pos_;
        tag.name = s_.substr(nameStart, pos_ - nameStart);
        if (tag.name.empty()) return bad("an XML tag with no name");
        for (;;) {
            while (pos_ < s_.size() && isXmlSpace(s_[pos_])) ++pos_;
            if (pos_ >= s_.size()) return bad("an unterminated XML tag");
            if (s_[pos_] == '>') { ++pos_; return true; }
            if (s_[pos_] == '/') {
                if (tag.end || pos_ + 1 >= s_.size() || s_[pos_ + 1] != '>') return bad("a malformed XML tag end");
                tag.selfClosing = true;
                pos_ += 2;
                return true;
            }
            if (tag.end) return bad("attributes on an XML end tag");
            const std::size_t an = pos_;
            while (pos_ < s_.size() && isXmlNameChar(s_[pos_])) ++pos_;
            XmlAttr a;
            a.name = s_.substr(an, pos_ - an);
            if (a.name.empty()) return bad("a malformed XML attribute");
            while (pos_ < s_.size() && isXmlSpace(s_[pos_])) ++pos_;
            if (pos_ >= s_.size() || s_[pos_] != '=') return bad("an XML attribute with no value");
            ++pos_;
            while (pos_ < s_.size() && isXmlSpace(s_[pos_])) ++pos_;
            if (pos_ >= s_.size() || (s_[pos_] != '"' && s_[pos_] != '\'')) return bad("an unquoted XML attribute");
            const char q = s_[pos_++];
            const std::size_t close = s_.find(q, pos_);
            if (close == std::string::npos) return bad("an unterminated XML attribute value");
            const std::string raw = s_.substr(pos_, close - pos_);
            if (raw.find('<') != std::string::npos) return bad("a '<' inside an XML attribute value");
            if (!xmlDecode(raw, a.value)) return bad("an unknown XML entity");
            pos_ = close + 1;
            if (tag.attr(a.name.c_str()) != nullptr) return bad("a repeated XML attribute");
            tag.attrs.push_back(std::move(a));
        }
    }
    const std::string& error() const { return err_; }

private:
    bool bad(const char* why) {
        err_ = why;
        return false;
    }
    const std::string& s_;
    std::size_t pos_ = 0;
    std::string err_;
};

std::string xmlEscape(const std::string& in) {
    std::string out;
    out.reserve(in.size());
    for (const char c : in) {
        switch (c) {
            case '&': out += "&amp;"; break;
            case '<': out += "&lt;"; break;
            case '>': out += "&gt;"; break;
            case '"': out += "&quot;"; break;
            case '\'': out += "&apos;"; break;
            default: out.push_back(c); break;
        }
    }
    return out;
}

// 3MF ST_Number: ((\-|\+)?(([0-9]+(\.[0-9]+)?)|(\.[0-9]+))((e|E)(\-|\+)?[0-9]+)?)
bool isStNumber(const std::string& t) {
    std::size_t i = 0;
    const std::size_t n = t.size();
    if (i < n && (t[i] == '-' || t[i] == '+')) ++i;
    std::size_t intDigits = 0;
    while (i < n && t[i] >= '0' && t[i] <= '9') { ++i; ++intDigits; }
    if (i < n && t[i] == '.') {
        ++i;
        std::size_t frac = 0;
        while (i < n && t[i] >= '0' && t[i] <= '9') { ++i; ++frac; }
        if (frac == 0) return false;
    } else if (intDigits == 0) {
        return false;
    }
    if (i < n && (t[i] == 'e' || t[i] == 'E')) {
        ++i;
        if (i < n && (t[i] == '-' || t[i] == '+')) ++i;
        std::size_t exp = 0;
        while (i < n && t[i] >= '0' && t[i] <= '9') { ++i; ++exp; }
        if (exp == 0) return false;
    }
    return i == n;
}

bool parseStNumber(const std::string& t, double& out) {
    return isStNumber(t) && parseDouble(t, out);
}

bool parseXmlIndex(const std::string& t, std::uint64_t& out) {
    if (t.empty() || t.size() > 19) return false;
    std::uint64_t v = 0;
    for (const char c : t) {
        if (c < '0' || c > '9') return false;
        v = v * 10 + static_cast<std::uint64_t>(c - '0');
    }
    out = v;
    return true;
}

const char* const k3mfCoreNamespace = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
const char* const k3mfModelRelType = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
const char* const k3mfModelContentType = "application/vnd.ms-package.3dmanufacturing-3dmodel+xml";
const char* const kOpcRelsContentType = "application/vnd.openxmlformats-package.relationships+xml";
const char* const kOpcContentTypesNs = "http://schemas.openxmlformats.org/package/2006/content-types";
const char* const kOpcRelationshipsNs = "http://schemas.openxmlformats.org/package/2006/relationships";

// Size of one ST_Unit in millimetres; 0 for anything the core spec does not name.
double unitInMillimetres(const std::string& unit) {
    if (unit == "micron") return 0.001;
    if (unit == "millimeter") return 1.0;
    if (unit == "centimeter") return 10.0;
    if (unit == "inch") return 25.4;
    if (unit == "foot") return 304.8;
    if (unit == "meter") return 1000.0;
    return 0.0;
}

} // namespace

// ===========================================================================
// 3MF
// ===========================================================================
std::string MeshExchange::write3MF(const TriMesh& mesh, const ThreeMfWriteOptions& options,
                                   std::string* refusal) {
    auto refuse = [&](const std::string& why) {
        if (refusal != nullptr) *refusal = "3MF: " + why;
        return std::string();
    };
    if (refusal != nullptr) refusal->clear();
    if (mesh.empty() || !mesh.wellFormed()) return refuse("the mesh is empty or not well formed");
    if (!allFinite(mesh.positions)) return refuse("a vertex coordinate is not finite");
    const double unitSize = unitInMillimetres(options.unit);
    if (unitSize <= 0.0) return refuse("\"" + options.unit + "\" is not a 3MF unit");
    const MeshClosureReport closure = closureReport(mesh);
    if (!closure.closedAndOriented()) {
        return refuse("the mesh is not a closed, consistently oriented surface (" +
                      std::to_string(closure.boundaryEdges) + " boundary edges, " +
                      std::to_string(closure.overusedEdges) + " over-used edges, " +
                      std::to_string(closure.degenerateTriangles) +
                      " degenerate triangles); the 3MF core specification requires one");
    }
    // Closed and consistently wound is not yet OUTWARD: a mesh wound inside
    // out passes the census above. The spec requires outward normals, and a
    // slicer fed an inverted solid prints its complement.
    if (!(mesh.signedVolume() > 0.0)) {
        return refuse("the mesh is wound inside out (its signed volume is not positive)");
    }

    std::string model;
    model.reserve(64 * mesh.vertexCount() + 48 * mesh.triangleCount() + 1024);
    model += "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    model += "<model unit=\"" + options.unit + "\" xml:lang=\"en-US\" xmlns=\"";
    model += k3mfCoreNamespace;
    model += "\">\n";
    model += " <metadata name=\"Application\">" + xmlEscape(options.application) + "</metadata>\n";
    model += " <resources>\n";
    model += "  <object id=\"1\" type=\"model\" name=\"" + xmlEscape(options.objectName) + "\">\n";
    model += "   <mesh>\n    <vertices>\n";
    for (std::size_t v = 0; v < mesh.vertexCount(); ++v) {
        model += "     <vertex x=\"";
        model += formatDouble(mesh.positions[3 * v + 0] / unitSize);
        model += "\" y=\"";
        model += formatDouble(mesh.positions[3 * v + 1] / unitSize);
        model += "\" z=\"";
        model += formatDouble(mesh.positions[3 * v + 2] / unitSize);
        model += "\"/>\n";
    }
    model += "    </vertices>\n    <triangles>\n";
    for (std::size_t t = 0; t < mesh.triangleCount(); ++t) {
        model += "     <triangle v1=\"";
        model += std::to_string(mesh.indices[3 * t + 0]);
        model += "\" v2=\"";
        model += std::to_string(mesh.indices[3 * t + 1]);
        model += "\" v3=\"";
        model += std::to_string(mesh.indices[3 * t + 2]);
        model += "\"/>\n";
    }
    model += "    </triangles>\n   </mesh>\n  </object>\n </resources>\n";
    model += " <build>\n  <item objectid=\"1\"/>\n </build>\n</model>\n";

    std::string contentTypes = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Types xmlns=\"";
    contentTypes += kOpcContentTypesNs;
    contentTypes += "\">\n <Default Extension=\"rels\" ContentType=\"";
    contentTypes += kOpcRelsContentType;
    contentTypes += "\"/>\n <Default Extension=\"model\" ContentType=\"";
    contentTypes += k3mfModelContentType;
    contentTypes += "\"/>\n</Types>\n";

    std::string rels = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Relationships xmlns=\"";
    rels += kOpcRelationshipsNs;
    rels += "\">\n <Relationship Target=\"/3D/3dmodel.model\" Id=\"rel0\" Type=\"";
    rels += k3mfModelRelType;
    rels += "\"/>\n</Relationships>\n";

    std::string zip;
    std::string why;
    if (!buildStoredZip({ZipPart{"[Content_Types].xml", contentTypes},
                         ZipPart{"_rels/.rels", rels},
                         ZipPart{"3D/3dmodel.model", model}},
                        zip, why)) {
        return refuse(why);
    }
    return zip;
}

ReadResult MeshExchange::read3MF(const std::string& bytes, std::string* declaredUnit) {
    if (declaredUnit != nullptr) declaredUnit->clear();
    std::vector<ZipPart> parts;
    std::string why;
    if (!readStoredZip(bytes, parts, why)) return fail("3MF: " + why);
    auto findPart = [&](const std::string& name) -> const ZipPart* {
        const std::string want = lowerAscii(name);
        for (const ZipPart& p : parts) {
            if (lowerAscii(p.name) == want) return &p;
        }
        return nullptr;
    };

    // ── [Content_Types].xml ────────────────────────────────────────────────
    const ZipPart* types = findPart("[Content_Types].xml");
    if (types == nullptr) return fail("3MF: the package has no [Content_Types].xml");
    std::map<std::string, std::string> defaults;   // lower-case extension -> type
    std::map<std::string, std::string> overrides;  // lower-case "/part" -> type
    {
        XmlCursor cur(types->data);
        XmlTag tag;
        bool rootSeen = false;
        while (cur.next(tag)) {
            if (!rootSeen) {
                if (tag.end || tag.name != "Types") return fail("3MF: [Content_Types].xml has no <Types> root");
                const std::string* ns = tag.attr("xmlns");
                if (ns == nullptr || *ns != kOpcContentTypesNs) return fail("3MF: [Content_Types].xml is in the wrong namespace");
                rootSeen = true;
                continue;
            }
            if (tag.end) continue;
            const std::string* ct = tag.attr("ContentType");
            if (tag.name == "Default") {
                const std::string* ext = tag.attr("Extension");
                if (ext == nullptr || ct == nullptr) return fail("3MF: a malformed <Default> content type");
                defaults[lowerAscii(*ext)] = *ct;
            } else if (tag.name == "Override") {
                const std::string* part = tag.attr("PartName");
                if (part == nullptr || ct == nullptr) return fail("3MF: a malformed <Override> content type");
                overrides[lowerAscii(*part)] = *ct;
            }
        }
        if (!cur.error().empty()) return fail("3MF: [Content_Types].xml: " + cur.error());
        if (!rootSeen) return fail("3MF: [Content_Types].xml is empty");
    }

    // ── _rels/.rels: the ONE 3D model part ─────────────────────────────────
    const ZipPart* relsPart = findPart("_rels/.rels");
    if (relsPart == nullptr) return fail("3MF: the package has no _rels/.rels");
    std::vector<std::string> modelTargets;
    {
        XmlCursor cur(relsPart->data);
        XmlTag tag;
        bool rootSeen = false;
        while (cur.next(tag)) {
            if (!rootSeen) {
                if (tag.end || tag.name != "Relationships") return fail("3MF: _rels/.rels has no <Relationships> root");
                const std::string* ns = tag.attr("xmlns");
                if (ns == nullptr || *ns != kOpcRelationshipsNs) return fail("3MF: _rels/.rels is in the wrong namespace");
                rootSeen = true;
                continue;
            }
            if (tag.end || tag.name != "Relationship") continue;
            const std::string* type = tag.attr("Type");
            const std::string* target = tag.attr("Target");
            if (type == nullptr || target == nullptr) return fail("3MF: a malformed package relationship");
            if (*type == k3mfModelRelType) modelTargets.push_back(*target);
        }
        if (!cur.error().empty()) return fail("3MF: _rels/.rels: " + cur.error());
    }
    if (modelTargets.size() != 1) {
        return fail("3MF: the package names " + std::to_string(modelTargets.size()) +
                    " 3D model parts; it must name exactly one");
    }
    std::string modelName = modelTargets.front();
    if (!modelName.empty() && modelName.front() == '/') modelName.erase(0, 1);
    const ZipPart* modelPart = findPart(modelName);
    if (modelPart == nullptr) return fail("3MF: the 3D model part \"" + modelName + "\" is missing");
    {
        std::string type;
        const auto ov = overrides.find("/" + lowerAscii(modelName));
        if (ov != overrides.end()) {
            type = ov->second;
        } else {
            const std::size_t dot = modelName.find_last_of('.');
            const auto df = dot == std::string::npos ? defaults.end()
                                                     : defaults.find(lowerAscii(modelName.substr(dot + 1)));
            if (df != defaults.end()) type = df->second;
        }
        if (type != k3mfModelContentType) return fail("3MF: the 3D model part has the wrong content type");
    }

    // ── the model ──────────────────────────────────────────────────────────
    struct Object {
        bool hasMesh = false;
        std::string type = "model";
        std::vector<double> positions;
        std::vector<std::uint32_t> indices;
    };
    struct Item {
        std::uint64_t objectId = 0;
        bool hasTransform = false;
        double m[12] = {1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0};
    };
    std::map<std::uint64_t, Object> objects;
    std::vector<Item> items;
    double unitSize = 1.0;
    {
        XmlCursor cur(modelPart->data);
        XmlTag tag;
        std::vector<std::string> stack;
        Object* current = nullptr;
        bool rootSeen = false;
        while (cur.next(tag)) {
            if (tag.end) {
                if (stack.empty() || stack.back() != tag.name) return fail("3MF: the model XML is not well nested");
                if (tag.name == "object") current = nullptr;
                stack.pop_back();
                continue;
            }
            const std::string parent = stack.empty() ? std::string() : stack.back();
            if (!rootSeen) {
                if (tag.name != "model") return fail("3MF: the model part has no <model> root");
                const std::string* ns = tag.attr("xmlns");
                if (ns == nullptr || *ns != k3mfCoreNamespace) return fail("3MF: the model is not in the 3MF core namespace");
                const std::string* req = tag.attr("requiredextensions");
                if (req != nullptr && req->find_first_not_of(" \t\r\n") != std::string::npos) {
                    return fail("3MF: the model requires extensions this reader does not implement (" + *req + ")");
                }
                const std::string* unit = tag.attr("unit");
                const std::string unitName = unit == nullptr ? std::string("millimeter") : *unit;
                unitSize = unitInMillimetres(unitName);
                if (unitSize <= 0.0) return fail("3MF: \"" + unitName + "\" is not a 3MF unit");
                if (declaredUnit != nullptr) *declaredUnit = unitName;
                rootSeen = true;
            } else if (tag.name == "object" && parent == "resources") {
                const std::string* id = tag.attr("id");
                std::uint64_t oid = 0;
                if (id == nullptr || !parseXmlIndex(*id, oid) || oid == 0) return fail("3MF: an object has no valid id");
                if (objects.count(oid) != 0) return fail("3MF: two objects share an id");
                current = &objects[oid];
                const std::string* type = tag.attr("type");
                if (type != nullptr) current->type = *type;
                if (current->type != "model" && current->type != "solidsupport" &&
                    current->type != "support" && current->type != "surface" && current->type != "other") {
                    return fail("3MF: an object has an unknown type \"" + current->type + "\"");
                }
                // <object .../> holds nothing, so nothing after it may land in it.
                if (tag.selfClosing) current = nullptr;
            } else if (tag.name == "components" && parent == "object") {
                return fail("3MF: component objects are not supported by this reader");
            } else if (tag.name == "mesh" && parent == "object" && current != nullptr) {
                if (current->hasMesh) return fail("3MF: an object holds two meshes");
                current->hasMesh = true;
            } else if (tag.name == "vertex" && parent == "vertices" && current != nullptr) {
                const std::string* xs = tag.attr("x");
                const std::string* ys = tag.attr("y");
                const std::string* zs = tag.attr("z");
                double x = 0, y = 0, z = 0;
                if (xs == nullptr || ys == nullptr || zs == nullptr || !parseStNumber(*xs, x) ||
                    !parseStNumber(*ys, y) || !parseStNumber(*zs, z)) {
                    return fail("3MF: a vertex coordinate is missing or not a number");
                }
                current->positions.push_back(x);
                current->positions.push_back(y);
                current->positions.push_back(z);
            } else if (tag.name == "triangle" && parent == "triangles" && current != nullptr) {
                const std::string* a = tag.attr("v1");
                const std::string* b = tag.attr("v2");
                const std::string* c = tag.attr("v3");
                std::uint64_t ia = 0, ib = 0, ic = 0;
                if (a == nullptr || b == nullptr || c == nullptr || !parseXmlIndex(*a, ia) ||
                    !parseXmlIndex(*b, ib) || !parseXmlIndex(*c, ic)) {
                    return fail("3MF: a triangle index is missing or not an integer");
                }
                const std::uint64_t nv = current->positions.size() / 3;
                if (ia >= nv || ib >= nv || ic >= nv) return fail("3MF: a triangle index is out of range");
                if (ia == ib || ib == ic || ic == ia) return fail("3MF: a triangle repeats a vertex (v1, v2, v3 must be distinct)");
                current->indices.push_back(static_cast<std::uint32_t>(ia));
                current->indices.push_back(static_cast<std::uint32_t>(ib));
                current->indices.push_back(static_cast<std::uint32_t>(ic));
            } else if (tag.name == "item" && parent == "build") {
                Item item;
                const std::string* oid = tag.attr("objectid");
                if (oid == nullptr || !parseXmlIndex(*oid, item.objectId)) return fail("3MF: a build item names no object");
                const std::string* tr = tag.attr("transform");
                if (tr != nullptr) {
                    std::size_t p = 0;
                    for (int k = 0; k < 12; ++k) {
                        while (p < tr->size() && isXmlSpace((*tr)[p])) ++p;
                        std::size_t e = p;
                        while (e < tr->size() && !isXmlSpace((*tr)[e])) ++e;
                        if (!parseStNumber(tr->substr(p, e - p), item.m[k])) return fail("3MF: a build item transform is malformed");
                        p = e;
                    }
                    while (p < tr->size() && isXmlSpace((*tr)[p])) ++p;
                    if (p != tr->size()) return fail("3MF: a build item transform has more than 12 numbers");
                    item.hasTransform = true;
                }
                items.push_back(item);
            }
            if (!tag.selfClosing) stack.push_back(tag.name);
            if (stack.size() > 64) return fail("3MF: the model XML is nested too deeply");
        }
        if (!cur.error().empty()) return fail("3MF: the model XML: " + cur.error());
        if (!rootSeen) return fail("3MF: the model part is empty");
        if (!stack.empty()) return fail("3MF: the model XML ends inside <" + stack.back() + ">");
    }
    if (items.empty()) return fail("3MF: the build names no item");

    TriMesh m;
    for (const Item& item : items) {
        const auto it = objects.find(item.objectId);
        if (it == objects.end()) return fail("3MF: a build item names an object that does not exist");
        const Object& obj = it->second;
        if (obj.type == "other") return fail("3MF: a build item names an object of type other");
        if (!obj.hasMesh || obj.indices.empty()) return fail("3MF: a build item names an object with no triangles");
        const double* t = item.m;
        // Row-vector convention of the core spec: [x y z 1] * M.
        const double det = t[0] * (t[4] * t[8] - t[5] * t[7]) - t[1] * (t[3] * t[8] - t[5] * t[6]) +
                           t[2] * (t[3] * t[7] - t[4] * t[6]);
        if (!std::isfinite(det) || det == 0.0) return fail("3MF: a build item transform is singular");
        const std::uint32_t base = static_cast<std::uint32_t>(m.positions.size() / 3);
        for (std::size_t v = 0; v + 2 < obj.positions.size(); v += 3) {
            const double x = obj.positions[v], y = obj.positions[v + 1], z = obj.positions[v + 2];
            const double X = x * t[0] + y * t[3] + z * t[6] + t[9];
            const double Y = x * t[1] + y * t[4] + z * t[7] + t[10];
            const double Z = x * t[2] + y * t[5] + z * t[8] + t[11];
            m.positions.push_back(X * unitSize);
            m.positions.push_back(Y * unitSize);
            m.positions.push_back(Z * unitSize);
        }
        for (std::size_t k = 0; k + 2 < obj.indices.size(); k += 3) {
            // A mirroring transform turns the solid inside out; reversing the
            // corner order keeps every normal pointing out of the material.
            m.indices.push_back(base + obj.indices[k]);
            m.indices.push_back(base + obj.indices[det < 0.0 ? k + 2 : k + 1]);
            m.indices.push_back(base + obj.indices[det < 0.0 ? k + 1 : k + 2]);
        }
    }
    if (!allFinite(m.positions)) return fail("3MF: a coordinate overflowed when converted to millimetres");
    const std::string err = finalizeCheck(m);
    if (!err.empty()) return fail("3MF: " + err);
    ReadResult r;
    r.ok = true;
    r.mesh = std::move(m);
    return r;
}

// ===========================================================================
// glTF 2.0 binary (.glb)
// ===========================================================================
namespace {

constexpr std::uint32_t kGlbMagic = 0x46546C67u;      // "glTF"
constexpr std::uint32_t kGlbJsonChunk = 0x4E4F534Au;  // "JSON"
constexpr std::uint32_t kGlbBinChunk = 0x004E4942u;   // "BIN\0"
constexpr std::uint32_t kGlFloat = 5126;
constexpr std::uint32_t kGlUnsignedByte = 5121;
constexpr std::uint32_t kGlUnsignedShort = 5123;
constexpr std::uint32_t kGlUnsignedInt = 5125;
constexpr std::uint32_t kGlArrayBuffer = 34962;
constexpr std::uint32_t kGlElementArrayBuffer = 34963;

void putF32(std::string& out, float f) {
    std::uint32_t u = 0;
    std::memcpy(&u, &f, sizeof(u));
    putU32(out, u);
}
float getF32(const std::string& s, std::size_t off) {
    const std::uint32_t u = getU32(s, off);
    float f = 0.0f;
    std::memcpy(&f, &u, sizeof(f));
    return f;
}

std::string jsonEscape(const std::string& in) {
    std::string out;
    for (const char ch : in) {
        const unsigned char c = static_cast<unsigned char>(ch);
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    static const char* hex = "0123456789abcdef";
                    out += "\\u00";
                    out.push_back(hex[c >> 4]);
                    out.push_back(hex[c & 0xF]);
                } else {
                    out.push_back(ch);
                }
        }
    }
    return out;
}

// The number a float IS, written so that parsing it as a double gives that
// float's exact value. glTF validators compare accessor.min/max against the
// stored components, and a %.6g rendering of a float is not equal to it.
std::string floatExact(float f) { return formatDouble(static_cast<double>(f)); }

// ── a small strict JSON DOM ────────────────────────────────────────────────
struct JValue {
    enum Kind { Null, Bool, Num, Str, Arr, Obj } kind = Null;
    bool b = false;
    double n = 0.0;
    std::string s;
    std::vector<JValue> a;
    std::vector<std::pair<std::string, JValue>> o;
    const JValue* get(const char* key) const {
        if (kind != Obj) return nullptr;
        for (const auto& kv : o) {
            if (kv.first == key) return &kv.second;
        }
        return nullptr;
    }
};

class JsonParser {
public:
    explicit JsonParser(const std::string& text) : s_(text) {}
    bool parse(JValue& out) {
        if (!value(out, 0)) return false;
        ws();
        if (p_ != s_.size()) return bad("trailing characters after the JSON document");
        return true;
    }
    const std::string& error() const { return err_; }

private:
    bool bad(const char* why) {
        if (err_.empty()) err_ = why;
        return false;
    }
    void ws() {
        while (p_ < s_.size() && (s_[p_] == ' ' || s_[p_] == '\t' || s_[p_] == '\n' || s_[p_] == '\r')) ++p_;
    }
    bool literal(const char* word) {
        const std::size_t n = std::strlen(word);
        if (s_.compare(p_, n, word) != 0) return bad("an unknown JSON literal");
        p_ += n;
        return true;
    }
    bool hex4(std::uint32_t& cp) {
        if (p_ + 4 > s_.size()) return bad("a truncated JSON \\u escape");
        cp = 0;
        for (int k = 0; k < 4; ++k) {
            const char c = s_[p_++];
            int d = -1;
            if (c >= '0' && c <= '9') d = c - '0';
            else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
            else if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
            if (d < 0) return bad("a malformed JSON \\u escape");
            cp = cp * 16 + static_cast<std::uint32_t>(d);
        }
        return true;
    }
    bool string(std::string& out) {
        if (p_ >= s_.size() || s_[p_] != '"') return bad("expected a JSON string");
        ++p_;
        out.clear();
        while (p_ < s_.size()) {
            const char c = s_[p_++];
            if (c == '"') return true;
            if (static_cast<unsigned char>(c) < 0x20) return bad("a control character inside a JSON string");
            if (c != '\\') { out.push_back(c); continue; }
            if (p_ >= s_.size()) break;
            const char e = s_[p_++];
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
                    if (cp >= 0xD800 && cp <= 0xDBFF) {
                        std::uint32_t lo = 0;
                        if (p_ + 2 > s_.size() || s_[p_] != '\\' || s_[p_ + 1] != 'u') return bad("an unpaired JSON surrogate");
                        p_ += 2;
                        if (!hex4(lo) || lo < 0xDC00 || lo > 0xDFFF) return bad("an unpaired JSON surrogate");
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                    } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
                        return bad("an unpaired JSON surrogate");
                    }
                    appendUtf8(out, cp);
                    break;
                }
                default: return bad("an unknown JSON escape");
            }
        }
        return bad("an unterminated JSON string");
    }
    bool number(double& out) {
        const std::size_t start = p_;
        if (p_ < s_.size() && s_[p_] == '-') ++p_;
        if (p_ >= s_.size()) return bad("a truncated JSON number");
        if (s_[p_] == '0') {
            ++p_;
        } else if (s_[p_] >= '1' && s_[p_] <= '9') {
            while (p_ < s_.size() && s_[p_] >= '0' && s_[p_] <= '9') ++p_;
        } else {
            return bad("a malformed JSON number");
        }
        if (p_ < s_.size() && s_[p_] == '.') {
            ++p_;
            const std::size_t f = p_;
            while (p_ < s_.size() && s_[p_] >= '0' && s_[p_] <= '9') ++p_;
            if (p_ == f) return bad("a malformed JSON number");
        }
        if (p_ < s_.size() && (s_[p_] == 'e' || s_[p_] == 'E')) {
            ++p_;
            if (p_ < s_.size() && (s_[p_] == '+' || s_[p_] == '-')) ++p_;
            const std::size_t e = p_;
            while (p_ < s_.size() && s_[p_] >= '0' && s_[p_] <= '9') ++p_;
            if (p_ == e) return bad("a malformed JSON number");
        }
        if (!parseDouble(s_.substr(start, p_ - start), out)) return bad("a JSON number out of range");
        return true;
    }
    bool value(JValue& v, int depth) {
        if (depth > 64) return bad("JSON nested too deeply");
        ws();
        if (p_ >= s_.size()) return bad("a truncated JSON document");
        const char c = s_[p_];
        if (c == '{') {
            v.kind = JValue::Obj;
            ++p_;
            ws();
            if (p_ < s_.size() && s_[p_] == '}') { ++p_; return true; }
            for (;;) {
                ws();
                std::string key;
                if (!string(key)) return false;
                ws();
                if (p_ >= s_.size() || s_[p_] != ':') return bad("a JSON object member without ':'");
                ++p_;
                JValue child;
                if (!value(child, depth + 1)) return false;
                for (const auto& kv : v.o) {
                    if (kv.first == key) return bad("a JSON object repeats a key");
                }
                v.o.emplace_back(std::move(key), std::move(child));
                ws();
                if (p_ < s_.size() && s_[p_] == ',') { ++p_; continue; }
                if (p_ < s_.size() && s_[p_] == '}') { ++p_; return true; }
                return bad("a malformed JSON object");
            }
        }
        if (c == '[') {
            v.kind = JValue::Arr;
            ++p_;
            ws();
            if (p_ < s_.size() && s_[p_] == ']') { ++p_; return true; }
            for (;;) {
                JValue child;
                if (!value(child, depth + 1)) return false;
                v.a.push_back(std::move(child));
                ws();
                if (p_ < s_.size() && s_[p_] == ',') { ++p_; continue; }
                if (p_ < s_.size() && s_[p_] == ']') { ++p_; return true; }
                return bad("a malformed JSON array");
            }
        }
        if (c == '"') { v.kind = JValue::Str; return string(v.s); }
        if (c == 't') { v.kind = JValue::Bool; v.b = true; return literal("true"); }
        if (c == 'f') { v.kind = JValue::Bool; v.b = false; return literal("false"); }
        if (c == 'n') { v.kind = JValue::Null; return literal("null"); }
        v.kind = JValue::Num;
        return number(v.n);
    }

    const std::string& s_;
    std::size_t p_ = 0;
    std::string err_;
};

// A JSON number that must be a non-negative integer that fits `limit`.
bool jsonIndex(const JValue* v, std::uint64_t limit, std::uint64_t& out) {
    if (v == nullptr || v->kind != JValue::Num) return false;
    if (!(v->n >= 0.0) || v->n != std::floor(v->n) || v->n > static_cast<double>(limit)) return false;
    out = static_cast<std::uint64_t>(v->n);
    return true;
}

// 4x4 column-major, as glTF stores node.matrix.
using Mat4 = std::array<double, 16>;
Mat4 mat4Identity() { return Mat4{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}; }
Mat4 mat4Mul(const Mat4& a, const Mat4& b) {
    Mat4 r{};
    for (std::size_t c = 0; c < 4; ++c) {
        for (std::size_t row = 0; row < 4; ++row) {
            double s = 0.0;
            for (std::size_t k = 0; k < 4; ++k) s += a[k * 4 + row] * b[c * 4 + k];
            r[c * 4 + row] = s;
        }
    }
    return r;
}

bool readNumberArray(const JValue* v, std::size_t n, double* out) {
    if (v == nullptr || v->kind != JValue::Arr || v->a.size() != n) return false;
    for (std::size_t i = 0; i < n; ++i) {
        if (v->a[i].kind != JValue::Num || !std::isfinite(v->a[i].n)) return false;
        out[i] = v->a[i].n;
    }
    return true;
}

bool nodeLocal(const JValue& node, Mat4& out, std::string& why) {
    out = mat4Identity();
    const JValue* matrix = node.get("matrix");
    if (matrix != nullptr) {
        if (!readNumberArray(matrix, 16, out.data())) { why = "a node matrix is malformed"; return false; }
        return true;
    }
    double t[3] = {0, 0, 0}, q[4] = {0, 0, 0, 1}, s[3] = {1, 1, 1};
    if (node.get("translation") != nullptr && !readNumberArray(node.get("translation"), 3, t)) { why = "a node translation is malformed"; return false; }
    if (node.get("rotation") != nullptr && !readNumberArray(node.get("rotation"), 4, q)) { why = "a node rotation is malformed"; return false; }
    if (node.get("scale") != nullptr && !readNumberArray(node.get("scale"), 3, s)) { why = "a node scale is malformed"; return false; }
    const double x = q[0], y = q[1], z = q[2], w = q[3];
    const double r[9] = {1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
                         2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
                         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)};
    // column c of R*S is column c of R scaled by s[c]
    for (std::size_t c = 0; c < 3; ++c) {
        for (std::size_t row = 0; row < 3; ++row) out[c * 4 + row] = r[c * 3 + row] * s[c];
        out[c * 4 + 3] = 0.0;
    }
    out[12] = t[0];
    out[13] = t[1];
    out[14] = t[2];
    out[15] = 1.0;
    return true;
}

} // namespace

std::string MeshExchange::writeGLB(const TriMesh& mesh, const GlbWriteOptions& options,
                                   std::string* refusal) {
    auto refuse = [&](const std::string& why) {
        if (refusal != nullptr) *refusal = "GLB: " + why;
        return std::string();
    };
    if (refusal != nullptr) refusal->clear();
    if (mesh.empty() || !mesh.wellFormed()) return refuse("the mesh is empty or not well formed");
    if (!allFinite(mesh.positions)) return refuse("a vertex coordinate is not finite");
    const std::size_t nv = mesh.vertexCount();
    const std::size_t ni = mesh.indices.size();
    const bool withNormals = options.normals != nullptr;
    if (withNormals && options.normals->size() != mesh.positions.size()) {
        return refuse("the normal array does not have one normal per vertex");
    }
    const std::uint64_t posBytes = 12ull * nv;
    const std::uint64_t idxBytes = 4ull * ni;
    const std::uint64_t nrmBytes = withNormals ? 12ull * nv : 0ull;
    const std::uint64_t binBytes = posBytes + idxBytes + nrmBytes;  // each a multiple of 4
    if (binBytes + 4096 >= 0xFFFFFFFFull) return refuse("the file would exceed the 4 GiB a GLB can describe");

    // Millimetres, +Z up  ->  metres, +Y up:  (x, y, z) -> (x, z, -y) / 1000.
    std::string bin;
    bin.reserve(static_cast<std::size_t>(binBytes));
    float lo[3] = {0, 0, 0}, hi[3] = {0, 0, 0};
    for (std::size_t v = 0; v < nv; ++v) {
        const double x = mesh.positions[3 * v + 0];
        const double y = mesh.positions[3 * v + 1];
        const double z = mesh.positions[3 * v + 2];
        const float g[3] = {static_cast<float>(x * 0.001), static_cast<float>(z * 0.001),
                            static_cast<float>(-y * 0.001)};
        for (int k = 0; k < 3; ++k) {
            if (!std::isfinite(g[k])) return refuse("a coordinate does not fit a 32-bit float");
            if (v == 0 || g[k] < lo[k]) lo[k] = g[k];
            if (v == 0 || g[k] > hi[k]) hi[k] = g[k];
            putF32(bin, g[k]);
        }
    }
    for (const std::uint32_t idx : mesh.indices) putU32(bin, idx);
    if (withNormals) {
        for (std::size_t v = 0; v < nv; ++v) {
            const double nx = (*options.normals)[3 * v + 0];
            const double ny = (*options.normals)[3 * v + 1];
            const double nz = (*options.normals)[3 * v + 2];
            const double len = std::sqrt(nx * nx + ny * ny + nz * nz);
            if (!std::isfinite(len) || len < 1e-12) return refuse("a vertex normal is zero or not finite");
            putF32(bin, static_cast<float>(nx / len));
            putF32(bin, static_cast<float>(nz / len));
            putF32(bin, static_cast<float>(-ny / len));
        }
    }

    std::string json;
    json.reserve(2048);
    json += "{\"asset\":{\"version\":\"2.0\",\"generator\":\"" + jsonEscape(options.generator) + "\"}";
    json += ",\"scene\":0,\"scenes\":[{\"nodes\":[0]}]";
    json += ",\"nodes\":[{\"mesh\":0,\"name\":\"" + jsonEscape(options.meshName) + "\"}]";
    json += ",\"meshes\":[{\"name\":\"" + jsonEscape(options.meshName) +
            "\",\"primitives\":[{\"attributes\":{\"POSITION\":0";
    if (withNormals) json += ",\"NORMAL\":2";
    json += "},\"indices\":1,\"mode\":4,\"material\":0}]}]";
    json += ",\"materials\":[{\"name\":\"forge\",\"pbrMetallicRoughness\":{\"baseColorFactor\":"
            "[0.8,0.8,0.8,1],\"metallicFactor\":0,\"roughnessFactor\":0.5}}]";
    json += ",\"accessors\":[{\"bufferView\":0,\"componentType\":" + std::to_string(kGlFloat) +
            ",\"count\":" + std::to_string(nv) + ",\"type\":\"VEC3\",\"min\":[" + floatExact(lo[0]) +
            "," + floatExact(lo[1]) + "," + floatExact(lo[2]) + "],\"max\":[" + floatExact(hi[0]) +
            "," + floatExact(hi[1]) + "," + floatExact(hi[2]) + "]}";
    json += ",{\"bufferView\":1,\"componentType\":" + std::to_string(kGlUnsignedInt) +
            ",\"count\":" + std::to_string(ni) + ",\"type\":\"SCALAR\"}";
    if (withNormals) {
        json += ",{\"bufferView\":2,\"componentType\":" + std::to_string(kGlFloat) +
                ",\"count\":" + std::to_string(nv) + ",\"type\":\"VEC3\"}";
    }
    json += "]";
    json += ",\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":" + std::to_string(posBytes) +
            ",\"target\":" + std::to_string(kGlArrayBuffer) + "}";
    json += ",{\"buffer\":0,\"byteOffset\":" + std::to_string(posBytes) +
            ",\"byteLength\":" + std::to_string(idxBytes) + ",\"target\":" +
            std::to_string(kGlElementArrayBuffer) + "}";
    if (withNormals) {
        json += ",{\"buffer\":0,\"byteOffset\":" + std::to_string(posBytes + idxBytes) +
                ",\"byteLength\":" + std::to_string(nrmBytes) + ",\"target\":" +
                std::to_string(kGlArrayBuffer) + "}";
    }
    json += "]";
    json += ",\"buffers\":[{\"byteLength\":" + std::to_string(binBytes) + "}]}";
    while (json.size() % 4 != 0) json.push_back(' ');   // JSON chunk pads with spaces
    while (bin.size() % 4 != 0) bin.push_back('\0');    // BIN chunk pads with zeros

    const std::uint64_t total = 12ull + 8ull + json.size() + 8ull + bin.size();
    if (total >= 0xFFFFFFFFull) return refuse("the file would exceed the 4 GiB a GLB can describe");
    std::string out;
    out.reserve(static_cast<std::size_t>(total));
    putU32(out, kGlbMagic);
    putU32(out, 2);
    putU32(out, static_cast<std::uint32_t>(total));
    putU32(out, static_cast<std::uint32_t>(json.size()));
    putU32(out, kGlbJsonChunk);
    out += json;
    putU32(out, static_cast<std::uint32_t>(bin.size()));
    putU32(out, kGlbBinChunk);
    out += bin;
    return out;
}

ReadResult MeshExchange::readGLB(const std::string& bytes) {
    if (bytes.size() < 20) return fail("GLB: too short to be a GLB file");
    if (getU32(bytes, 0) != kGlbMagic) return fail("GLB: the file does not start with the glTF magic");
    if (getU32(bytes, 4) != 2) return fail("GLB: only container version 2 is supported");
    if (getU32(bytes, 8) != bytes.size()) return fail("GLB: the header length is not the file length (truncated?)");
    std::size_t at = 12;
    const std::uint32_t jsonLen = getU32(bytes, at);
    if (getU32(bytes, at + 4) != kGlbJsonChunk) return fail("GLB: the first chunk is not JSON");
    if (jsonLen % 4 != 0 || at + 8 + static_cast<std::uint64_t>(jsonLen) > bytes.size()) return fail("GLB: the JSON chunk is misaligned or overruns the file");
    const std::string jsonText = bytes.substr(at + 8, jsonLen);
    at += 8 + jsonLen;
    std::string bin;
    bool haveBin = false;
    while (at < bytes.size()) {
        if (at + 8 > bytes.size()) return fail("GLB: trailing bytes after the last chunk");
        const std::uint32_t len = getU32(bytes, at);
        const std::uint32_t type = getU32(bytes, at + 4);
        if (len % 4 != 0 || at + 8 + static_cast<std::uint64_t>(len) > bytes.size()) return fail("GLB: a chunk is misaligned or overruns the file");
        if (type == kGlbBinChunk) {
            if (haveBin) return fail("GLB: two BIN chunks");
            bin = bytes.substr(at + 8, len);
            haveBin = true;
        } else if (type == kGlbJsonChunk) {
            return fail("GLB: two JSON chunks");
        }  // any other chunk type is ignored, as the spec requires
        at += 8 + len;
    }

    JValue doc;
    JsonParser parser(jsonText);
    if (!parser.parse(doc)) return fail("GLB: the JSON chunk is not valid JSON (" + parser.error() + ")");
    if (doc.kind != JValue::Obj) return fail("GLB: the JSON chunk is not an object");
    const JValue* asset = doc.get("asset");
    const JValue* version = asset != nullptr ? asset->get("version") : nullptr;
    if (version == nullptr || version->kind != JValue::Str || version->s.rfind("2.", 0) != 0) {
        return fail("GLB: asset.version is not 2.x");
    }
    const JValue* required = doc.get("extensionsRequired");
    if (required != nullptr && required->kind == JValue::Arr && !required->a.empty()) {
        return fail("GLB: the asset requires extensions this reader does not implement");
    }

    const JValue* buffers = doc.get("buffers");
    const JValue* views = doc.get("bufferViews");
    const JValue* accessors = doc.get("accessors");
    const JValue* meshes = doc.get("meshes");
    const JValue* nodes = doc.get("nodes");
    const JValue* scenes = doc.get("scenes");
    auto arraySize = [](const JValue* v) -> std::size_t {
        return (v != nullptr && v->kind == JValue::Arr) ? v->a.size() : 0;
    };

    // The bytes of one buffer. Only the GLB-stored buffer (buffers[0], no uri).
    auto bufferBytes = [&](std::uint64_t index, const std::string*& out, std::string& why) {
        if (index >= arraySize(buffers)) { why = "a buffer index is out of range"; return false; }
        const JValue& b = buffers->a[static_cast<std::size_t>(index)];
        if (b.get("uri") != nullptr || index != 0) { why = "external or data: buffers are not supported"; return false; }
        std::uint64_t len = 0;
        if (!jsonIndex(b.get("byteLength"), 0xFFFFFFFFull, len) || len == 0) { why = "a buffer has no byteLength"; return false; }
        if (!haveBin || len > bin.size() || bin.size() - len > 3) { why = "the BIN chunk does not hold the buffer"; return false; }
        out = &bin;
        return true;
    };

    struct View {
        const std::string* data = nullptr;
        std::uint64_t offset = 0;   // absolute, within *data
        std::uint64_t length = 0;
        std::uint64_t stride = 0;   // 0 when tightly packed
    };
    auto view = [&](std::uint64_t index, View& out, std::string& why) {
        if (index >= arraySize(views)) { why = "a bufferView index is out of range"; return false; }
        const JValue& v = views->a[static_cast<std::size_t>(index)];
        std::uint64_t buf = 0;
        if (!jsonIndex(v.get("buffer"), 0xFFFFFFFFull, buf)) { why = "a bufferView names no buffer"; return false; }
        if (!bufferBytes(buf, out.data, why)) return false;
        std::uint64_t buffLen = 0;
        jsonIndex(buffers->a[static_cast<std::size_t>(buf)].get("byteLength"), 0xFFFFFFFFull, buffLen);
        if (v.get("byteOffset") != nullptr && !jsonIndex(v.get("byteOffset"), 0xFFFFFFFFull, out.offset)) { why = "a bufferView byteOffset is malformed"; return false; }
        if (!jsonIndex(v.get("byteLength"), 0xFFFFFFFFull, out.length) || out.length == 0) { why = "a bufferView has no byteLength"; return false; }
        if (v.get("byteStride") != nullptr) {
            if (!jsonIndex(v.get("byteStride"), 252, out.stride) || out.stride < 4 || out.stride % 4 != 0) { why = "a bufferView byteStride is malformed"; return false; }
        }
        if (out.offset + out.length > buffLen) { why = "a bufferView runs past its buffer"; return false; }
        return true;
    };

    // An accessor's components as doubles (floats) or as integers (indices).
    auto accessor = [&](std::uint64_t index, bool wantVec3Float, std::vector<double>& floats,
                        std::vector<std::uint32_t>& ints, std::string& why) {
        if (index >= arraySize(accessors)) { why = "an accessor index is out of range"; return false; }
        const JValue& a = accessors->a[static_cast<std::size_t>(index)];
        if (a.get("sparse") != nullptr) { why = "sparse accessors are not supported"; return false; }
        std::uint64_t bv = 0, off = 0, count = 0, comp = 0;
        if (!jsonIndex(a.get("bufferView"), 0xFFFFFFFFull, bv)) { why = "an accessor has no bufferView"; return false; }
        if (a.get("byteOffset") != nullptr && !jsonIndex(a.get("byteOffset"), 0xFFFFFFFFull, off)) { why = "an accessor byteOffset is malformed"; return false; }
        if (!jsonIndex(a.get("count"), 0xFFFFFFFFull, count) || count == 0) { why = "an accessor has no count"; return false; }
        if (!jsonIndex(a.get("componentType"), 0xFFFFFFFFull, comp)) { why = "an accessor has no componentType"; return false; }
        const JValue* type = a.get("type");
        if (type == nullptr || type->kind != JValue::Str) { why = "an accessor has no type"; return false; }
        const JValue* norm = a.get("normalized");
        if (norm != nullptr && norm->kind == JValue::Bool && norm->b) { why = "normalized accessors are not supported here"; return false; }
        std::uint64_t compSize = 0, comps = 0;
        if (wantVec3Float) {
            if (comp != kGlFloat || type->s != "VEC3") { why = "POSITION is not a float VEC3 accessor"; return false; }
            compSize = 4;
            comps = 3;
        } else {
            if (type->s != "SCALAR") { why = "indices are not a SCALAR accessor"; return false; }
            if (comp == kGlUnsignedByte) compSize = 1;
            else if (comp == kGlUnsignedShort) compSize = 2;
            else if (comp == kGlUnsignedInt) compSize = 4;
            else { why = "indices are not an unsigned integer type"; return false; }
            comps = 1;
        }
        View vw;
        if (!view(bv, vw, why)) return false;
        const std::uint64_t elem = compSize * comps;
        const std::uint64_t stride = vw.stride != 0 ? vw.stride : elem;
        if (stride < elem) { why = "a bufferView byteStride is smaller than its element"; return false; }
        if ((vw.offset + off) % compSize != 0) { why = "an accessor is not aligned to its component size"; return false; }
        if (off + stride * (count - 1) + elem > vw.length) { why = "an accessor runs past its bufferView"; return false; }
        const std::uint64_t base = vw.offset + off;
        if (wantVec3Float) {
            floats.resize(static_cast<std::size_t>(3 * count));
            for (std::uint64_t i = 0; i < count; ++i) {
                for (std::uint64_t k = 0; k < 3; ++k) {
                    const float f = getF32(*vw.data, static_cast<std::size_t>(base + i * stride + 4 * k));
                    if (!std::isfinite(f)) { why = "a POSITION component is not finite"; return false; }
                    floats[static_cast<std::size_t>(3 * i + k)] = static_cast<double>(f);
                }
            }
        } else {
            ints.resize(static_cast<std::size_t>(count));
            for (std::uint64_t i = 0; i < count; ++i) {
                const std::size_t p = static_cast<std::size_t>(base + i * stride);
                std::uint32_t value = 0;
                if (compSize == 1) value = static_cast<unsigned char>((*vw.data)[p]);
                else if (compSize == 2) value = getU16(*vw.data, p);
                else value = getU32(*vw.data, p);
                ints[static_cast<std::size_t>(i)] = value;
            }
        }
        return true;
    };

    // ── the scene graph ─────────────────────────────────────────────────────
    std::uint64_t sceneIndex = 0;
    if (doc.get("scene") != nullptr && !jsonIndex(doc.get("scene"), 0xFFFFFFFFull, sceneIndex)) return fail("GLB: the scene index is malformed");
    if (sceneIndex >= arraySize(scenes)) return fail("GLB: the file names no scene to read");
    const JValue* roots = scenes->a[static_cast<std::size_t>(sceneIndex)].get("nodes");
    if (roots == nullptr || roots->kind != JValue::Arr || roots->a.empty()) return fail("GLB: the scene holds no nodes");

    TriMesh m;
    std::string why;
    std::vector<std::pair<std::uint64_t, Mat4>> work;
    for (auto it = roots->a.rbegin(); it != roots->a.rend(); ++it) {
        std::uint64_t n = 0;
        if (!jsonIndex(&*it, 0xFFFFFFFFull, n)) return fail("GLB: a scene node index is malformed");
        work.emplace_back(n, mat4Identity());
    }
    std::size_t visits = 0;
    while (!work.empty()) {
        const auto [nodeIndex, parent] = work.back();
        work.pop_back();
        if (++visits > 100000 || nodeIndex >= arraySize(nodes)) return fail("GLB: the node graph is out of range or cyclic");
        const JValue& node = nodes->a[static_cast<std::size_t>(nodeIndex)];
        Mat4 local;
        if (!nodeLocal(node, local, why)) return fail("GLB: " + why);
        const Mat4 world = mat4Mul(parent, local);
        const JValue* children = node.get("children");
        if (children != nullptr && children->kind == JValue::Arr) {
            for (auto it = children->a.rbegin(); it != children->a.rend(); ++it) {
                std::uint64_t c = 0;
                if (!jsonIndex(&*it, 0xFFFFFFFFull, c)) return fail("GLB: a child node index is malformed");
                work.emplace_back(c, world);
            }
        }
        if (node.get("mesh") == nullptr) continue;
        std::uint64_t meshIndex = 0;
        if (!jsonIndex(node.get("mesh"), 0xFFFFFFFFull, meshIndex) || meshIndex >= arraySize(meshes)) return fail("GLB: a node names a mesh that does not exist");
        const JValue* prims = meshes->a[static_cast<std::size_t>(meshIndex)].get("primitives");
        if (prims == nullptr || prims->kind != JValue::Arr || prims->a.empty()) return fail("GLB: a mesh has no primitives");
        const double det =
            world[0] * (world[5] * world[10] - world[9] * world[6]) -
            world[4] * (world[1] * world[10] - world[9] * world[2]) +
            world[8] * (world[1] * world[6] - world[5] * world[2]);
        if (!std::isfinite(det) || det == 0.0) return fail("GLB: a node transform is singular");
        for (const JValue& prim : prims->a) {
            if (prim.get("mode") != nullptr) {
                std::uint64_t mode = 0;
                if (!jsonIndex(prim.get("mode"), 6, mode) || mode != 4) return fail("GLB: only TRIANGLES primitives are supported");
            }
            const JValue* attrs = prim.get("attributes");
            std::uint64_t posAcc = 0;
            if (attrs == nullptr || !jsonIndex(attrs->get("POSITION"), 0xFFFFFFFFull, posAcc)) return fail("GLB: a primitive has no POSITION");
            std::vector<double> pos;
            std::vector<std::uint32_t> unused;
            if (!accessor(posAcc, true, pos, unused, why)) return fail("GLB: " + why);
            const std::size_t count = pos.size() / 3;
            std::vector<std::uint32_t> idx;
            if (prim.get("indices") != nullptr) {
                std::uint64_t ia = 0;
                if (!jsonIndex(prim.get("indices"), 0xFFFFFFFFull, ia)) return fail("GLB: a primitive's indices are malformed");
                std::vector<double> unusedF;
                if (!accessor(ia, false, unusedF, idx, why)) return fail("GLB: " + why);
            } else {
                idx.resize(count);
                for (std::size_t i = 0; i < count; ++i) idx[i] = static_cast<std::uint32_t>(i);
            }
            if (idx.size() % 3 != 0) return fail("GLB: a TRIANGLES primitive's index count is not a multiple of 3");
            const std::uint64_t base = m.positions.size() / 3;
            if (base + count > 0xFFFFFFFFull) return fail("GLB: too many vertices");
            for (std::size_t v = 0; v < count; ++v) {
                const double x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
                const double X = world[0] * x + world[4] * y + world[8] * z + world[12];
                const double Y = world[1] * x + world[5] * y + world[9] * z + world[13];
                const double Z = world[2] * x + world[6] * y + world[10] * z + world[14];
                // metres, +Y up  ->  millimetres, +Z up: the inverse of writeGLB's map.
                m.positions.push_back(X * 1000.0);
                m.positions.push_back(-Z * 1000.0);
                m.positions.push_back(Y * 1000.0);
            }
            for (std::size_t t = 0; t + 2 < idx.size(); t += 3) {
                for (int k = 0; k < 3; ++k) {
                    if (idx[t + static_cast<std::size_t>(k)] >= count) return fail("GLB: an index is out of range");
                }
                const std::uint32_t b = static_cast<std::uint32_t>(base);
                m.indices.push_back(b + idx[t]);
                m.indices.push_back(b + idx[det < 0.0 ? t + 2 : t + 1]);
                m.indices.push_back(b + idx[det < 0.0 ? t + 1 : t + 2]);
            }
        }
    }
    if (!allFinite(m.positions)) return fail("GLB: a transformed coordinate is not finite");
    const std::string err = finalizeCheck(m);
    if (!err.empty()) return fail("GLB: " + err);
    ReadResult r;
    r.ok = true;
    r.mesh = std::move(m);
    return r;
}

} // namespace brep
} // namespace native
} // namespace forge
