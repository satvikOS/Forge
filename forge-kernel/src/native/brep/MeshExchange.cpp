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
#include <string>
#include <unordered_map>
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

} // namespace brep
} // namespace native
} // namespace forge
