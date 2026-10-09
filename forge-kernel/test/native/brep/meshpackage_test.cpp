// forge-kernel/test/native/brep/meshpackage_test.cpp
//
// T-350 -- the 3MF and glTF-binary codecs of forge::native::brep::MeshExchange,
// plus the closure census and the tolerance weld they depend on.
//
// Pure C++20, standard library only, the same hand-rolled harness as
// meshexchange_test.cpp. Run by forge-kernel/test/native/run_native.sh, which
// discovers it by directory (ONLY=brep/meshpackage_test for this one alone).
//
// ── WHAT MAKES IT A CONFORMANCE TEST AND NOT A ROUND TRIP ───────────────────
// A codec that writes garbage and reads its own garbage back passes every
// round trip. So the bytes are ALSO checked by code in THIS file that shares
// nothing with the codec: its own ZIP walker and its own bit-at-a-time CRC-32
// (the codec uses a table), its own JSON parser, std::regex for the 3MF number
// grammar, and its own GLB chunk walker. The spec facts it asserts are the ones
// a slicer or a glTF viewer relies on:
//
//   3MF  local headers, central directory and end record agree; every entry is
//        STORED with a correct CRC-32; [Content_Types].xml, _rels/.rels and
//        3D/3dmodel.model exist with the OPC content types and the 3D-model
//        relationship; the model is in the core 2015/02 namespace with a unit;
//        every coordinate matches ST_Number; triangle indices are distinct and
//        in range; the mesh is closed, consistently and OUTWARD wound.
//   GLB  magic, version 2 and a total length equal to the file; JSON chunk
//        first, padded with spaces, BIN chunk next, padded with zeros, both
//        4-byte aligned; asset.version 2.0; every bufferView and accessor in
//        bounds; POSITION min/max EQUAL to the stored floats; indices in range;
//        metres and +Y up (the bounding box maps back to the millimetre one);
//        winding preserved (signed volume positive).
//
// Then the readers are fed broken files and must REFUSE each one.
//
// Set FORGE_MESHPKG_DUMP_DIR to also write the produced files there, so an
// independent tool (e.g. Python's zipfile/json) can be pointed at them.

#include "forge/native/brep/MeshExchange.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <limits>
#include <map>
#include <regex>
#include <set>
#include <string>
#include <utility>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) {
        ++g_pass;
        std::printf("  [PASS] %s\n", name.c_str());
    } else {
        std::printf("  [FAIL] %s\n", name.c_str());
    }
}

// ───────────────────────────── fixtures ─────────────────────────────────────

// An axis-aligned box, 8 shared vertices, 12 triangles wound outward.
static TriMesh box(double x0, double y0, double z0, double x1, double y1, double z1) {
    TriMesh m;
    const double p[8][3] = {{x0, y0, z0}, {x1, y0, z0}, {x1, y1, z0}, {x0, y1, z0},
                            {x0, y0, z1}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1}};
    for (const auto& v : p) m.positions.insert(m.positions.end(), {v[0], v[1], v[2]});
    const std::uint32_t t[12][3] = {{0, 2, 1}, {0, 3, 2}, {4, 5, 6}, {4, 6, 7},
                                    {0, 1, 5}, {0, 5, 4}, {1, 2, 6}, {1, 6, 5},
                                    {2, 3, 7}, {2, 7, 6}, {3, 0, 4}, {3, 4, 7}};
    for (const auto& f : t) m.indices.insert(m.indices.end(), {f[0], f[1], f[2]});
    return m;
}

// A subdivided octahedron projected to a sphere: closed, 2-manifold, outward.
static TriMesh sphere(double r, double cx, double cy, double cz, int levels) {
    std::vector<std::array<double, 3>> v = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0},
                                            {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};
    std::vector<std::array<std::uint32_t, 3>> f = {{0, 2, 4}, {2, 1, 4}, {1, 3, 4}, {3, 0, 4},
                                                   {2, 0, 5}, {1, 2, 5}, {3, 1, 5}, {0, 3, 5}};
    for (int l = 0; l < levels; ++l) {
        std::map<std::pair<std::uint32_t, std::uint32_t>, std::uint32_t> mid;
        auto midpoint = [&](std::uint32_t a, std::uint32_t b) {
            const auto key = std::make_pair(std::min(a, b), std::max(a, b));
            const auto it = mid.find(key);
            if (it != mid.end()) return it->second;
            std::array<double, 3> m{(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2,
                                    (v[a][2] + v[b][2]) / 2};
            const double len = std::sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
            for (double& c : m) c /= len;
            v.push_back(m);
            const auto id = static_cast<std::uint32_t>(v.size() - 1);
            mid[key] = id;
            return id;
        };
        std::vector<std::array<std::uint32_t, 3>> next;
        for (const auto& t : f) {
            const std::uint32_t ab = midpoint(t[0], t[1]);
            const std::uint32_t bc = midpoint(t[1], t[2]);
            const std::uint32_t ca = midpoint(t[2], t[0]);
            next.push_back({t[0], ab, ca});
            next.push_back({ab, t[1], bc});
            next.push_back({ca, bc, t[2]});
            next.push_back({ab, bc, ca});
        }
        f = next;
    }
    TriMesh m;
    for (const auto& p : v) {
        m.positions.insert(m.positions.end(), {cx + r * p[0], cy + r * p[1], cz + r * p[2]});
    }
    for (const auto& t : f) m.indices.insert(m.indices.end(), {t[0], t[1], t[2]});
    return m;
}

static double signedVolumeOf(const std::vector<double>& pos, const std::vector<std::uint32_t>& idx) {
    double s = 0.0;
    for (std::size_t t = 0; t + 2 < idx.size(); t += 3) {
        const double* a = &pos[3 * idx[t]];
        const double* b = &pos[3 * idx[t + 1]];
        const double* c = &pos[3 * idx[t + 2]];
        s += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) +
             a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
    return s / 6.0;
}

static void dump(const std::string& name, const std::string& bytes) {
    const char* dir = std::getenv("FORGE_MESHPKG_DUMP_DIR");
    if (dir == nullptr || dir[0] == 0) return;
    std::ofstream out(std::string(dir) + "/" + name, std::ios::binary | std::ios::trunc);
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
}

// ─────────────────── an INDEPENDENT ZIP walker + CRC-32 ─────────────────────

static std::uint32_t le16(const std::string& s, std::size_t o) {
    return static_cast<std::uint32_t>(static_cast<unsigned char>(s[o])) |
           (static_cast<std::uint32_t>(static_cast<unsigned char>(s[o + 1])) << 8);
}
static std::uint32_t le32(const std::string& s, std::size_t o) {
    return le16(s, o) | (le16(s, o + 2) << 16);
}
static void put16(std::string& s, std::uint32_t v) {
    s.push_back(static_cast<char>(v & 0xFF));
    s.push_back(static_cast<char>((v >> 8) & 0xFF));
}
static void put32(std::string& s, std::uint32_t v) {
    put16(s, v & 0xFFFF);
    put16(s, v >> 16);
}
// Bit at a time, no table: deliberately NOT the codec's implementation.
static std::uint32_t slowCrc32(const std::string& data) {
    std::uint32_t crc = 0xFFFFFFFFu;
    for (const char ch : data) {
        crc ^= static_cast<unsigned char>(ch);
        for (int k = 0; k < 8; ++k) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
    return ~crc;
}

struct ZipWalk {
    bool ok = false;
    std::string why;
    std::map<std::string, std::string> parts;  // name -> data
    std::vector<std::string> order;
    bool allStored = true;
    bool allCrcGood = true;
    bool recordsAgree = true;
};

static ZipWalk walkZip(const std::string& z) {
    ZipWalk w;
    if (z.size() < 22) { w.why = "short"; return w; }
    const std::size_t e = z.size() - 22;  // the codec writes no archive comment
    if (le32(z, e) != 0x06054b50u) { w.why = "no end record at size-22"; return w; }
    const std::uint32_t n = le16(z, e + 10);
    const std::uint32_t cdSize = le32(z, e + 12);
    const std::uint32_t cdOff = le32(z, e + 16);
    if (cdOff + cdSize != e) { w.why = "central directory does not abut the end record"; return w; }
    std::size_t at = cdOff;
    for (std::uint32_t i = 0; i < n; ++i) {
        if (le32(z, at) != 0x02014b50u) { w.why = "bad central signature"; return w; }
        const std::uint32_t method = le16(z, at + 10);
        const std::uint32_t crc = le32(z, at + 16);
        const std::uint32_t cs = le32(z, at + 20);
        const std::uint32_t us = le32(z, at + 24);
        const std::uint32_t nl = le16(z, at + 28);
        const std::uint32_t xl = le16(z, at + 30);
        const std::uint32_t cl = le16(z, at + 32);
        const std::uint32_t lo = le32(z, at + 42);
        const std::string name = z.substr(at + 46, nl);
        at += 46 + nl + xl + cl;
        if (le32(z, lo) != 0x04034b50u) { w.why = "bad local signature"; return w; }
        if (method != 0 || le16(z, lo + 8) != 0) w.allStored = false;
        if (le32(z, lo + 14) != crc || le32(z, lo + 18) != cs || le32(z, lo + 22) != us ||
            z.compare(lo + 30, le16(z, lo + 26), name) != 0) {
            w.recordsAgree = false;
        }
        const std::string data = z.substr(lo + 30 + le16(z, lo + 26) + le16(z, lo + 28), cs);
        if (slowCrc32(data) != crc || cs != us) w.allCrcGood = false;
        w.parts[name] = data;
        w.order.push_back(name);
    }
    if (at != e) { w.why = "trailing central bytes"; return w; }
    w.ok = true;
    return w;
}

// A STORED zip built by the TEST, for feeding the reader packages the codec
// would never write. `method` lets one entry claim DEFLATE.
static std::string makeZip(const std::vector<std::pair<std::string, std::string>>& entries,
                           std::uint32_t method = 0) {
    std::string out, cd;
    for (const auto& [name, data] : entries) {
        const std::uint32_t off = static_cast<std::uint32_t>(out.size());
        const std::uint32_t crc = slowCrc32(data);
        put32(out, 0x04034b50u); put16(out, 20); put16(out, 0); put16(out, method);
        put16(out, 0); put16(out, 0x21); put32(out, crc);
        put32(out, static_cast<std::uint32_t>(data.size())); put32(out, static_cast<std::uint32_t>(data.size()));
        put16(out, static_cast<std::uint32_t>(name.size())); put16(out, 0);
        out += name; out += data;
        put32(cd, 0x02014b50u); put16(cd, 20); put16(cd, 20); put16(cd, 0); put16(cd, method);
        put16(cd, 0); put16(cd, 0x21); put32(cd, crc);
        put32(cd, static_cast<std::uint32_t>(data.size())); put32(cd, static_cast<std::uint32_t>(data.size()));
        put16(cd, static_cast<std::uint32_t>(name.size())); put16(cd, 0); put16(cd, 0); put16(cd, 0);
        put16(cd, 0); put32(cd, 0); put32(cd, off);
        cd += name;
    }
    const std::uint32_t cdOff = static_cast<std::uint32_t>(out.size());
    out += cd;
    put32(out, 0x06054b50u); put16(out, 0); put16(out, 0);
    put16(out, static_cast<std::uint32_t>(entries.size())); put16(out, static_cast<std::uint32_t>(entries.size()));
    put32(out, static_cast<std::uint32_t>(cd.size())); put32(out, cdOff); put16(out, 0);
    return out;
}

static const char* kTypes =
    "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
    "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
    "<Default Extension=\"model\" ContentType=\"application/vnd.ms-package.3dmanufacturing-3dmodel+xml\"/></Types>";
static std::string relsTo(const std::string& target) {
    return "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
           "<Relationship Target=\"" + target + "\" Id=\"r1\" Type=\"http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel\"/></Relationships>";
}
// A tetrahedron model with a few knobs, for hand-built packages.
static std::string tetraModel(const std::string& rootAttrs, const std::string& tri3 = "<triangle v1=\"1\" v2=\"2\" v3=\"3\"/>",
                              const std::string& itemAttrs = "", const std::string& extra = "") {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" + extra + "<model " + rootAttrs +
           "><resources><object id=\"7\" type=\"model\"><mesh><vertices>"
           "<vertex x=\"0\" y=\"0\" z=\"0\"/><vertex x=\"10\" y=\"0\" z=\"0\"/>"
           "<vertex x=\"0\" y=\"10\" z=\"0\"/><vertex x=\"0\" y=\"0\" z=\"10\"/></vertices><triangles>"
           "<triangle v1=\"0\" v2=\"2\" v3=\"1\"/><triangle v1=\"0\" v2=\"1\" v3=\"3\"/>"
           "<triangle v1=\"0\" v2=\"3\" v3=\"2\"/>" + tri3 +
           "</triangles></mesh></object></resources><build><item objectid=\"7\"" + itemAttrs +
           "/></build></model>";
}
static const std::string kCoreNs = "xmlns=\"http://schemas.microsoft.com/3dmanufacturing/core/2015/02\"";

// ─────────────────── an INDEPENDENT JSON parser (for GLB) ───────────────────
struct J {
    enum K { Null, Bool, Num, Str, Arr, Obj } k = Null;
    double n = 0;
    bool b = false;
    std::string s;
    std::vector<J> a;
    std::map<std::string, J> o;
    const J& operator[](const std::string& key) const {
        static const J none;
        const auto it = o.find(key);
        return it == o.end() ? none : it->second;
    }
    const J& operator[](std::size_t i) const {
        static const J none;
        return i < a.size() ? a[i] : none;
    }
};
struct JReader {
    const std::string& s;
    std::size_t p = 0;
    bool ok = true;
    void ws() { while (p < s.size() && std::strchr(" \t\r\n", s[p]) != nullptr && s[p] != 0) ++p; }
    J value() {
        J v;
        ws();
        if (p >= s.size()) { ok = false; return v; }
        if (s[p] == '{') {
            v.k = J::Obj; ++p; ws();
            if (s[p] == '}') { ++p; return v; }
            while (ok) {
                ws(); J key = value(); ws();
                if (key.k != J::Str || s[p] != ':') { ok = false; break; }
                ++p; v.o[key.s] = value(); ws();
                if (s[p] == ',') { ++p; continue; }
                if (s[p] == '}') { ++p; break; }
                ok = false;
            }
        } else if (s[p] == '[') {
            v.k = J::Arr; ++p; ws();
            if (s[p] == ']') { ++p; return v; }
            while (ok) {
                v.a.push_back(value()); ws();
                if (s[p] == ',') { ++p; continue; }
                if (s[p] == ']') { ++p; break; }
                ok = false;
            }
        } else if (s[p] == '"') {
            v.k = J::Str; ++p;
            while (p < s.size() && s[p] != '"') {
                if (s[p] == '\\') { ++p; }
                v.s.push_back(s[p++]);
            }
            ++p;
        } else if (s.compare(p, 4, "true") == 0) { v.k = J::Bool; v.b = true; p += 4; }
        else if (s.compare(p, 5, "false") == 0) { v.k = J::Bool; p += 5; }
        else if (s.compare(p, 4, "null") == 0) { p += 4; }
        else {
            v.k = J::Num;
            char* end = nullptr;
            v.n = std::strtod(s.c_str() + p, &end);
            if (end == s.c_str() + p) ok = false;
            p = static_cast<std::size_t>(end - s.c_str());
        }
        return v;
    }
};

static float f32At(const std::string& s, std::size_t o) {
    const std::uint32_t u = le32(s, o);
    float f;
    std::memcpy(&f, &u, 4);
    return f;
}

struct GlbWalk {
    bool ok = false;
    std::string why;
    J doc;
    std::string json, bin;
    bool jsonPaddedWithSpaces = true, binPaddedWithZeros = true;
};
static GlbWalk walkGlb(const std::string& g) {
    GlbWalk w;
    if (g.size() < 28) { w.why = "short"; return w; }
    if (g.compare(0, 4, "glTF") != 0) { w.why = "magic"; return w; }
    if (le32(g, 4) != 2) { w.why = "version"; return w; }
    if (le32(g, 8) != g.size()) { w.why = "length"; return w; }
    const std::uint32_t jl = le32(g, 12);
    if (g.compare(16, 4, "JSON") != 0 || jl % 4 != 0) { w.why = "json chunk"; return w; }
    w.json = g.substr(20, jl);
    const std::size_t b = 20 + jl;
    const std::uint32_t bl = le32(g, b);
    if (g.compare(b + 4, 4, std::string("BIN\0", 4)) != 0 || bl % 4 != 0 || b + 8 + bl != g.size()) { w.why = "bin chunk"; return w; }
    w.bin = g.substr(b + 8, bl);
    JReader r{w.json};
    w.doc = r.value();
    if (!r.ok || w.doc.k != J::Obj) { w.why = "json parse"; return w; }
    // Trailing JSON padding must be spaces, trailing BIN padding zeros.
    std::size_t end = w.json.find_last_of('}');
    for (std::size_t i = end + 1; i < w.json.size(); ++i) if (w.json[i] != ' ') w.jsonPaddedWithSpaces = false;
    const std::size_t bufLen = static_cast<std::size_t>(w.doc["buffers"][0]["byteLength"].n);
    for (std::size_t i = bufLen; i < w.bin.size(); ++i) if (w.bin[i] != 0) w.binPaddedWithZeros = false;
    w.ok = true;
    return w;
}

static std::string makeGlb(std::string json, std::string bin) {
    while (json.size() % 4) json.push_back(' ');
    while (bin.size() % 4) bin.push_back('\0');
    std::string g = "glTF";
    put32(g, 2);
    put32(g, static_cast<std::uint32_t>(12 + 8 + json.size() + (bin.empty() ? 0 : 8 + bin.size())));
    put32(g, static_cast<std::uint32_t>(json.size()));
    g += "JSON";
    g += json;
    if (!bin.empty()) {
        put32(g, static_cast<std::uint32_t>(bin.size()));
        g += std::string("BIN\0", 4);
        g += bin;
    }
    return g;
}
static void putF(std::string& s, float f) {
    std::uint32_t u;
    std::memcpy(&u, &f, 4);
    put32(s, u);
}
// One triangle, (0,0,0) (1,0,0) (0,1,0) metres, with indices -- and a JSON
// body the caller edits to break one thing at a time.
static std::string triangleBin() {
    std::string bin;
    for (float f : {0.f, 0.f, 0.f, 1.f, 0.f, 0.f, 0.f, 1.f, 0.f}) putF(bin, f);
    for (std::uint32_t i : {0u, 1u, 2u}) put32(bin, i);
    return bin;
}
static std::string triangleJson(const std::string& primExtra = "", const std::string& nodeExtra = "",
                                const std::string& accessor1 = "\"count\":3",
                                const std::string& bufferExtra = "", const std::string& topExtra = "") {
    return "{\"asset\":{\"version\":\"2.0\"}" + topExtra + ",\"scene\":0,\"scenes\":[{\"nodes\":[0]}],"
           "\"nodes\":[{\"mesh\":0" + nodeExtra + "}],\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},"
           "\"indices\":1" + primExtra + "}]}],\"accessors\":[{\"bufferView\":0,\"componentType\":5126,\"count\":3,"
           "\"type\":\"VEC3\",\"min\":[0,0,0],\"max\":[1,1,0]},{\"bufferView\":1,\"componentType\":5125," + accessor1 +
           ",\"type\":\"SCALAR\"}],\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":36},"
           "{\"buffer\":0,\"byteOffset\":36,\"byteLength\":12}],\"buffers\":[{\"byteLength\":48" + bufferExtra + "}]}";
}

// ──────────────────────────────── main ───────────────────────────────────────
int main() {
    std::printf("=== T-350 MeshExchange 3MF + GLB + closure/weld ===\n");
    const TriMesh cube = box(-5.5, 2.25, 0.0, 40.0, 32.125, 20.0);
    const TriMesh ball = sphere(12.5, 3.0, -4.0, 7.0, 3);  // 512 triangles

    // ── 1. closure census ───────────────────────────────────────────────────
    std::printf("-- closure census\n");
    {
        const MeshClosureReport c = closureReport(cube);
        check(c.closedAndOriented() && c.triangles == 12, "box: closed and oriented, 12 triangles");
        check(closureReport(ball).closedAndOriented(), "sphere: closed and oriented");
        TriMesh open = cube;
        open.indices.resize(open.indices.size() - 3);
        const MeshClosureReport o = closureReport(open);
        check(!o.closedAndOriented() && o.boundaryEdges == 3, "box minus one triangle: 3 boundary edges");
        TriMesh flipped = cube;
        std::swap(flipped.indices[1], flipped.indices[2]);
        const MeshClosureReport f = closureReport(flipped);
        check(!f.closedAndOriented() && f.overusedEdges > 0, "one flipped triangle: over-used directed edges");
        TriMesh degenerate = cube;
        degenerate.indices.insert(degenerate.indices.end(), {0u, 0u, 1u});
        check(closureReport(degenerate).degenerateTriangles == 1, "a repeated corner is counted as degenerate");
        TriMesh bad = cube;
        bad.indices.push_back(99);
        bad.indices.push_back(0);
        bad.indices.push_back(1);
        check(!closureReport(bad).wellFormed && !closureReport(bad).closedAndOriented(),
              "an out-of-range index is not well formed");
    }

    // ── 2. tolerance weld ───────────────────────────────────────────────────
    std::printf("-- tolerance weld (seam copies a tessellator leaves behind)\n");
    {
        // The box as a TRIANGLE SOUP, every corner its own vertex, with a
        // 1e-15 wobble on some copies -- what a face-by-face tessellation of a
        // B-rep looks like (measured: 1e-15 mm on the app's own bracket).
        TriMesh soup;
        for (std::size_t t = 0; t < cube.indices.size(); ++t) {
            const std::uint32_t v = cube.indices[t];
            const double wobble = (t % 4 == 1) ? 1e-15 : 0.0;
            soup.positions.push_back(cube.positions[3 * v] + wobble);
            soup.positions.push_back(cube.positions[3 * v + 1]);
            soup.positions.push_back(cube.positions[3 * v + 2] - wobble);
            soup.indices.push_back(static_cast<std::uint32_t>(t));
        }
        // A sliver whose corners collapse together under the weld.
        soup.positions.insert(soup.positions.end(), {0.0, 0.0, 50.0, 1e-12, 0.0, 50.0, 0.0, 1e-12, 50.0});
        const std::uint32_t s0 = static_cast<std::uint32_t>(soup.vertexCount() - 3);
        soup.indices.insert(soup.indices.end(), {s0, s0 + 1, s0 + 2});
        std::size_t dropped = 99;
        const TriMesh exact = weldWithinTolerance(soup, 0.0, &dropped);
        check(!closureReport(exact).closedAndOriented(), "an EXACT weld leaves the wobbled seams open");
        const TriMesh welded = weldWithinTolerance(soup, 1e-9, &dropped);
        const MeshClosureReport wc = closureReport(welded);
        check(dropped == 1, "the collapsed sliver is dropped and counted (" + std::to_string(dropped) + ")");
        check(wc.closedAndOriented() && wc.triangles == 12, "a 1e-9 weld closes the box");
        check(welded.vertexCount() == 8 + 1, "8 box corners + 1 surviving sliver corner");
        bool subset = true;
        for (std::size_t v = 0; v < welded.vertexCount(); ++v) {
            bool found = false;
            for (std::size_t u = 0; u < soup.vertexCount() && !found; ++u) {
                found = welded.positions[3 * v] == soup.positions[3 * u] &&
                        welded.positions[3 * v + 1] == soup.positions[3 * u + 1] &&
                        welded.positions[3 * v + 2] == soup.positions[3 * u + 2];
            }
            subset = subset && found;
        }
        check(subset, "every welded coordinate is one of the input's own, never an average");
        check(std::fabs(welded.signedVolume() - cube.signedVolume()) < 1e-9, "the weld keeps the volume");
        TriMesh nan = cube;
        nan.positions[4] = std::nan("");
        check(weldWithinTolerance(nan, 1e-9).empty(), "a NaN coordinate yields an empty mesh, not a guess");
        check(weldWithinTolerance(cube, -1.0).empty(), "a negative tolerance yields an empty mesh");
        // Huge coordinates must not overflow the grid and must still weld.
        TriMesh far = cube;
        for (double& d : far.positions) d += 1e14;
        check(closureReport(weldWithinTolerance(far, 1e-3)).closedAndOriented(),
              "coordinates near 1e14 still weld (cell widened, not overflowed)");
    }

    // ── 3. OBJ with a header comment ────────────────────────────────────────
    std::printf("-- OBJ header comment\n");
    {
        const std::string obj = MeshExchange::writeOBJ(cube, "units: millimetres\nup: +Z");
        check(obj.find("\n# units: millimetres\n# up: +Z\nv ") != std::string::npos,
              "the header lines are comments placed before the first vertex");
        const ReadResult r = MeshExchange::readOBJ(obj);
        check(r.ok && r.mesh.positions == cube.positions && r.mesh.indices == cube.indices,
              "the commented OBJ reads back bit-identical");
        check(MeshExchange::writeOBJ(cube, "") == MeshExchange::writeOBJ(cube),
              "an empty header changes nothing");
        dump("box.obj", obj);
    }

    // ── 4. 3MF: the bytes, checked by code that is not the codec ────────────
    std::printf("-- 3MF conformance (independent ZIP walk, bit-wise CRC-32, std::regex)\n");
    {
        std::string refusal = "unset";
        const std::string pkg = MeshExchange::write3MF(cube, ThreeMfWriteOptions{}, &refusal);
        check(!pkg.empty() && refusal.empty(), "write3MF produced a package (" + refusal + ")");
        dump("box.3mf", pkg);
        check(MeshExchange::write3MF(cube) == pkg, "the package is deterministic, byte for byte");
        ZipWalk z = walkZip(pkg);
        check(z.ok, "the ZIP records are consistent (" + z.why + ")");
        check(z.allStored && z.allCrcGood && z.recordsAgree,
              "every entry STORED, CRC-32 correct, local == central");
        const std::set<std::string> names(z.order.begin(), z.order.end());
        check(names == std::set<std::string>{"[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"},
              "exactly the three OPC parts");
        check(!z.order.empty() && z.order.front() == "[Content_Types].xml",
              "[Content_Types].xml is the first entry");
        const std::string& types = z.parts["[Content_Types].xml"];
        check(types.find("Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"") != std::string::npos &&
                  types.find("Extension=\"model\" ContentType=\"application/vnd.ms-package.3dmanufacturing-3dmodel+xml\"") != std::string::npos,
              "content types name the rels and model parts");
        const std::string& rels = z.parts["_rels/.rels"];
        check(rels.find("Target=\"/3D/3dmodel.model\"") != std::string::npos &&
                  rels.find("Type=\"http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel\"") != std::string::npos,
              "the package relationship points at the model with the 3dmodel type");
        const std::string& model = z.parts["3D/3dmodel.model"];
        check(model.find(kCoreNs) != std::string::npos, "the model is in the core 2015/02 namespace");
        check(model.find("unit=\"millimeter\"") != std::string::npos, "the model states unit=millimeter");
        std::size_t vtx = 0, tri = 0;
        for (std::size_t p = model.find("<vertex "); p != std::string::npos; p = model.find("<vertex ", p + 1)) ++vtx;
        for (std::size_t p = model.find("<triangle "); p != std::string::npos; p = model.find("<triangle ", p + 1)) ++tri;
        check(vtx == 8 && tri == 12, "8 vertices and 12 triangles in the XML");
        const std::regex number("^((\\-|\\+)?(([0-9]+(\\.[0-9]+)?)|(\\.[0-9]+))((e|E)(\\-|\\+)?[0-9]+)?)$");
        const std::regex attr(" (x|y|z)=\"([^\"]*)\"");
        bool allNumbers = true;
        for (auto it = std::sregex_iterator(model.begin(), model.end(), attr); it != std::sregex_iterator(); ++it) {
            allNumbers = allNumbers && std::regex_match((*it)[2].str(), number);
        }
        check(allNumbers, "every coordinate matches the ST_Number grammar");
        const std::regex triRe("<triangle v1=\"([0-9]+)\" v2=\"([0-9]+)\" v3=\"([0-9]+)\"/>");
        bool distinctInRange = true;
        TriMesh fromXml;
        fromXml.positions = cube.positions;
        for (auto it = std::sregex_iterator(model.begin(), model.end(), triRe); it != std::sregex_iterator(); ++it) {
            const unsigned a = static_cast<unsigned>(std::stoul((*it)[1].str()));
            const unsigned b = static_cast<unsigned>(std::stoul((*it)[2].str()));
            const unsigned c = static_cast<unsigned>(std::stoul((*it)[3].str()));
            distinctInRange = distinctInRange && a != b && b != c && a != c && a < 8 && b < 8 && c < 8;
            fromXml.indices.insert(fromXml.indices.end(), {a, b, c});
        }
        check(distinctInRange, "triangle indices are distinct and in range");
        check(signedVolumeOf(fromXml.positions, fromXml.indices) > 0.0, "the XML's own winding is outward");
    }

    // ── 5. 3MF round trip and units ─────────────────────────────────────────
    std::printf("-- 3MF round trip and units\n");
    {
        for (const auto& [name, mesh] : {std::make_pair("box", cube), std::make_pair("sphere", ball)}) {
            std::string unit;
            const ReadResult r = MeshExchange::read3MF(MeshExchange::write3MF(mesh), &unit);
            check(r.ok && unit == "millimeter", std::string(name) + ": read3MF accepts it, unit millimeter (" + r.reason + ")");
            check(r.mesh.positions == mesh.positions && r.mesh.indices == mesh.indices,
                  std::string(name) + ": positions BIT-identical, indices identical");
        }
        ThreeMfWriteOptions inch;
        inch.unit = "inch";
        const std::string pkg = MeshExchange::write3MF(ball, inch);
        dump("sphere_inch.3mf", pkg);
        ZipWalk z = walkZip(pkg);
        check(z.parts["3D/3dmodel.model"].find("unit=\"inch\"") != std::string::npos, "unit=inch is written");
        std::string unit;
        const ReadResult r = MeshExchange::read3MF(pkg, &unit);
        double worst = 0.0;
        for (std::size_t i = 0; r.ok && i < ball.positions.size(); ++i) {
            worst = std::max(worst, std::fabs(r.mesh.positions[i] - ball.positions[i]) /
                                        std::max(1.0, std::fabs(ball.positions[i])));
        }
        check(r.ok && unit == "inch" && worst < 1e-12,
              "an inch package reads back in millimetres (worst rel " + std::to_string(worst) + ")");
        // The XML holds INCHES: the first vertex is the millimetre value / 25.4.
        const std::string& model = z.parts["3D/3dmodel.model"];
        const std::size_t xAt = model.find("<vertex x=\"") + 11;
        const double x0 = std::strtod(model.c_str() + xAt, nullptr);
        check(std::fabs(x0 * 25.4 - ball.positions[0]) < 1e-9, "the stored number IS inches");
    }

    // ── 6. 3MF writer refusals ──────────────────────────────────────────────
    std::printf("-- 3MF writer refuses what it cannot write conformantly\n");
    {
        auto refused = [](const TriMesh& m, ThreeMfWriteOptions o, const char* needle) {
            std::string why;
            const std::string out = MeshExchange::write3MF(m, o, &why);
            return out.empty() && why.find(needle) != std::string::npos;
        };
        TriMesh open = cube;
        open.indices.resize(open.indices.size() - 3);
        check(refused(open, {}, "closed"), "an open mesh is refused");
        TriMesh inverted = cube;
        for (std::size_t t = 0; t + 2 < inverted.indices.size(); t += 3) std::swap(inverted.indices[t + 1], inverted.indices[t + 2]);
        check(refused(inverted, {}, "inside out"), "an inside-out mesh is refused");
        TriMesh nan = cube;
        nan.positions[0] = std::numeric_limits<double>::infinity();
        check(refused(nan, {}, "finite"), "an infinite coordinate is refused");
        ThreeMfWriteOptions parsec;
        parsec.unit = "parsec";
        check(refused(cube, parsec, "not a 3MF unit"), "an unknown unit is refused");
        check(refused(TriMesh{}, {}, "empty"), "an empty mesh is refused");
        ThreeMfWriteOptions named;
        named.objectName = "a<b & \"c\"";
        ZipWalk z = walkZip(MeshExchange::write3MF(cube, named));
        check(z.parts["3D/3dmodel.model"].find("name=\"a&lt;b &amp; &quot;c&quot;\"") != std::string::npos,
              "an object name is XML-escaped");
    }

    // ── 7. 3MF reader refusals (and two foreign-but-valid packages) ─────────
    std::printf("-- 3MF reader refuses broken packages\n");
    {
        const std::string good = MeshExchange::write3MF(cube);
        auto refusedWith = [](const std::string& bytes, const char* needle) {
            const ReadResult r = MeshExchange::read3MF(bytes);
            if (r.ok) return false;
            if (std::strstr(r.reason.c_str(), needle) == nullptr) {
                std::printf("      (reason was: %s)\n", r.reason.c_str());
                return false;
            }
            return r.mesh.empty();
        };
        std::string flipped = good;
        flipped[good.find("<triangle") + 3] ^= 0x20;
        check(refusedWith(flipped, "CRC-32"), "one flipped byte in the model fails its CRC");
        check(refusedWith(good.substr(0, good.size() - 10), "end-of-central-directory"), "a truncated package is refused");
        check(refusedWith(std::string("PK\x03\x04", 4) + std::string(40, 'x'), "end-of-central-directory"), "junk is refused");
        auto pkg = [](const std::string& model, const std::string& target = "/3D/3dmodel.model",
                      const std::string& name = "3D/3dmodel.model") {
            return makeZip({{"[Content_Types].xml", kTypes}, {"_rels/.rels", relsTo(target)}, {name, model}});
        };
        const ReadResult tetra = MeshExchange::read3MF(pkg(tetraModel(kCoreNs)));
        check(tetra.ok && tetra.mesh.triangleCount() == 4 && tetra.mesh.signedVolume() > 0.0,
              "a hand-built, valid package reads (" + tetra.reason + ")");
        check(refusedWith(makeZip({{"[Content_Types].xml", kTypes}, {"_rels/.rels", relsTo("/3D/3dmodel.model")}}), "is missing"),
              "a package with no model part is refused");
        check(refusedWith(makeZip({{"_rels/.rels", relsTo("/3D/3dmodel.model")}, {"3D/3dmodel.model", tetraModel(kCoreNs)}}), "Content_Types"),
              "a package with no content types is refused");
        check(refusedWith(pkg(tetraModel("xmlns=\"http://example.com/not-3mf\"")), "core namespace"), "a foreign namespace is refused");
        check(refusedWith(pkg(tetraModel(kCoreNs + " unit=\"parsec\"")), "not a 3MF unit"), "an unknown unit is refused");
        check(refusedWith(pkg(tetraModel(kCoreNs, "<triangle v1=\"1\" v2=\"2\" v3=\"9\"/>")), "out of range"), "an out-of-range index is refused");
        check(refusedWith(pkg(tetraModel(kCoreNs, "<triangle v1=\"1\" v2=\"2\" v3=\"2\"/>")), "distinct"), "a repeated corner is refused");
        check(refusedWith(pkg(tetraModel(kCoreNs + " requiredextensions=\"p\"")), "requires extensions"), "a required extension is refused");
        check(refusedWith(pkg(tetraModel(kCoreNs, "<triangle v1=\"1\" v2=\"2\" v3=\"3\"/>", "",
                                         "<!DOCTYPE model [<!ENTITY a \"b\">]>")), "DTD"), "a DTD is refused (no entity expansion)");
        check(refusedWith(pkg(tetraModel(kCoreNs, "<triangle v1=\"1\" v2=\"2\" v3=\"3\"/>", " transform=\"1 0 0 0 1 0 0 0\"")), "transform"),
              "a short transform is refused");
        check(refusedWith(makeZip({{"[Content_Types].xml", kTypes}, {"_rels/.rels", relsTo("/3D/3dmodel.model")},
                                   {"3D/3dmodel.model", tetraModel(kCoreNs)}}, 8), "STORED"),
              "a DEFLATE entry is refused by name, not misread");
        {
            std::string two = relsTo("/3D/3dmodel.model");
            two.insert(two.find("</Relationships>"),
                       "<Relationship Target=\"/3D/b.model\" Id=\"r2\" Type=\"http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel\"/>");
            check(refusedWith(makeZip({{"[Content_Types].xml", kTypes}, {"_rels/.rels", two}, {"3D/3dmodel.model", tetraModel(kCoreNs)}}), "exactly one"),
                  "two model relationships are refused");
        }
        {
            std::string comp = tetraModel(kCoreNs);
            comp.insert(comp.find("</resources>"), "<object id=\"8\"><components><component objectid=\"7\"/></components></object>");
            check(refusedWith(pkg(comp), "component"), "component objects are refused, not silently dropped");
        }
        // A mirror transform: the reader must keep the solid OUTWARD.
        const ReadResult mirrored = MeshExchange::read3MF(
            pkg(tetraModel(kCoreNs, "<triangle v1=\"1\" v2=\"2\" v3=\"3\"/>", " transform=\"-1 0 0 0 1 0 0 0 1 100 0 0\"")));
        check(mirrored.ok && mirrored.mesh.signedVolume() > 0.0 && std::fabs(mirrored.mesh.positions[0] - 100.0) < 1e-12,
              "a mirroring build transform is applied and the winding kept outward");
        // A model part somewhere else, named by an Override content type.
        const std::string types2 = std::string(kTypes).replace(std::string(kTypes).find("</Types>"), 8,
            "<Override PartName=\"/Geometry/part.xml\" ContentType=\"application/vnd.ms-package.3dmanufacturing-3dmodel+xml\"/></Types>");
        const ReadResult moved = MeshExchange::read3MF(makeZip({{"[Content_Types].xml", types2},
            {"_rels/.rels", relsTo("/Geometry/part.xml")}, {"Geometry/part.xml", tetraModel(kCoreNs)}}));
        check(moved.ok && moved.mesh.triangleCount() == 4, "a model part found through an Override reads (" + moved.reason + ")");
    }

    // ── 8. GLB: the bytes, checked by code that is not the codec ────────────
    std::printf("-- GLB conformance (independent chunk walk + JSON parser)\n");
    {
        for (const auto& [name, mesh] : {std::make_pair("box", cube), std::make_pair("sphere", ball)}) {
            std::string refusal = "unset";
            const std::string glb = MeshExchange::writeGLB(mesh, GlbWriteOptions{}, &refusal);
            check(!glb.empty() && refusal.empty(), std::string(name) + ": writeGLB produced a file");
            dump(std::string(name) + ".glb", glb);
            const GlbWalk w = walkGlb(glb);
            check(w.ok, std::string(name) + ": header, chunk order, alignment and lengths (" + w.why + ")");
            if (!w.ok) continue;
            check(w.jsonPaddedWithSpaces && w.binPaddedWithZeros, std::string(name) + ": JSON pads with spaces, BIN with zeros");
            const J& d = w.doc;
            check(d["asset"]["version"].s == "2.0", std::string(name) + ": asset.version is 2.0");
            const J& prim = d["meshes"][0]["primitives"][0];
            check(d["scene"].n == 0 && d["scenes"][0]["nodes"][0].n == 0 && d["nodes"][0]["mesh"].n == 0,
                  std::string(name) + ": scene -> node -> mesh");
            check(prim["mode"].n == 4 && prim["attributes"]["POSITION"].n == 0 && prim["indices"].n == 1,
                  std::string(name) + ": one TRIANGLES primitive, POSITION 0, indices 1");
            check(d["nodes"][0].o.count("matrix") == 0 && d["nodes"][0].o.count("scale") == 0,
                  std::string(name) + ": no node transform (the units are in the data)");
            const double bufLen = d["buffers"][0]["byteLength"].n;
            check(d["buffers"][0].o.count("uri") == 0 && bufLen <= static_cast<double>(w.bin.size()) &&
                      static_cast<double>(w.bin.size()) - bufLen < 4,
                  std::string(name) + ": the buffer is the GLB BIN chunk");
            bool viewsInBounds = true;
            for (const J& v : d["bufferViews"].a) {
                viewsInBounds = viewsInBounds && v["byteOffset"].n + v["byteLength"].n <= bufLen &&
                                std::fmod(v["byteOffset"].n, 4.0) == 0.0;
            }
            check(viewsInBounds, std::string(name) + ": every bufferView in bounds and 4-aligned");
            const J& pa = d["accessors"][0];
            const J& ia = d["accessors"][1];
            check(pa["componentType"].n == 5126 && pa["type"].s == "VEC3" && pa["count"].n == static_cast<double>(mesh.vertexCount()),
                  std::string(name) + ": POSITION is float VEC3 x vertexCount");
            check(ia["componentType"].n == 5125 && ia["type"].s == "SCALAR" && ia["count"].n == static_cast<double>(mesh.indices.size()),
                  std::string(name) + ": indices are uint32 SCALAR x indexCount");
            const std::size_t po = static_cast<std::size_t>(d["bufferViews"][static_cast<std::size_t>(pa["bufferView"].n)]["byteOffset"].n);
            const std::size_t io = static_cast<std::size_t>(d["bufferViews"][static_cast<std::size_t>(ia["bufferView"].n)]["byteOffset"].n);
            std::vector<double> pos;
            float lo[3] = {1e30f, 1e30f, 1e30f}, hi[3] = {-1e30f, -1e30f, -1e30f};
            for (std::size_t v = 0; v < mesh.vertexCount(); ++v) {
                for (int k = 0; k < 3; ++k) {
                    const float f = f32At(w.bin, po + 12 * v + 4 * static_cast<std::size_t>(k));
                    lo[k] = std::min(lo[k], f);
                    hi[k] = std::max(hi[k], f);
                    pos.push_back(static_cast<double>(f));
                }
            }
            bool minMaxExact = true;
            for (std::size_t k = 0; k < 3; ++k) {
                minMaxExact = minMaxExact && pa["min"][k].n == static_cast<double>(lo[k]) &&
                              pa["max"][k].n == static_cast<double>(hi[k]);
            }
            check(minMaxExact, std::string(name) + ": accessor min/max EQUAL the stored floats");
            std::vector<std::uint32_t> idx;
            bool inRange = true;
            for (std::size_t i = 0; i < mesh.indices.size(); ++i) {
                idx.push_back(le32(w.bin, io + 4 * i));
                inRange = inRange && idx.back() < mesh.vertexCount();
            }
            check(inRange && idx == mesh.indices, std::string(name) + ": indices in range and as written");
            // UNITS AND AXES: metres, +Y up. The millimetre box maps to
            // X = x/1000, Y = z/1000, Z = -y/1000.
            double mlo[3] = {1e300, 1e300, 1e300}, mhi[3] = {-1e300, -1e300, -1e300};
            for (std::size_t v = 0; v < mesh.vertexCount(); ++v) {
                for (int k = 0; k < 3; ++k) {
                    mlo[k] = std::min(mlo[k], mesh.positions[3 * v + static_cast<std::size_t>(k)]);
                    mhi[k] = std::max(mhi[k], mesh.positions[3 * v + static_cast<std::size_t>(k)]);
                }
            }
            auto near = [](double a, double b) { return std::fabs(a - b) <= 1e-7 * std::max(1e-3, std::fabs(b)); };
            check(near(lo[0], mlo[0] / 1000) && near(hi[0], mhi[0] / 1000) && near(lo[1], mlo[2] / 1000) &&
                      near(hi[1], mhi[2] / 1000) && near(lo[2], -mhi[1] / 1000) && near(hi[2], -mlo[1] / 1000),
                  std::string(name) + ": metres with +Y up (the millimetre box, rotated and scaled)");
            const double svM = signedVolumeOf(pos, idx);
            check(svM > 0.0 && std::fabs(svM * 1e9 - mesh.signedVolume()) < 1e-5 * mesh.signedVolume(),
                  std::string(name) + ": winding kept outward; volume m^3 x 1e9 == mm^3");
            // And the codec's own reader inverts the map.
            const ReadResult r = MeshExchange::readGLB(glb);
            double worst = 0.0;
            for (std::size_t i = 0; r.ok && i < mesh.positions.size(); ++i) {
                worst = std::max(worst, std::fabs(r.mesh.positions[i] - mesh.positions[i]));
            }
            check(r.ok && r.mesh.indices == mesh.indices && worst < 1e-4,
                  std::string(name) + ": readGLB returns millimetres, +Z up (worst " + std::to_string(worst) + " mm)");
        }
        // Normals: unit length, rotated with the positions.
        std::vector<double> normals;
        for (std::size_t v = 0; v < ball.vertexCount(); ++v) {
            normals.push_back((ball.positions[3 * v] - 3.0) * 7.0);   // not unit on purpose
            normals.push_back((ball.positions[3 * v + 1] + 4.0) * 7.0);
            normals.push_back((ball.positions[3 * v + 2] - 7.0) * 7.0);
        }
        GlbWriteOptions withN;
        withN.normals = &normals;
        const std::string glbN = MeshExchange::writeGLB(ball, withN);
        dump("sphere_normals.glb", glbN);
        const GlbWalk wn = walkGlb(glbN);
        const J& na = wn.doc["accessors"][2];
        check(wn.ok && wn.doc["meshes"][0]["primitives"][0]["attributes"]["NORMAL"].n == 2 && na["count"].n == static_cast<double>(ball.vertexCount()),
              "NORMAL is accessor 2, one per vertex");
        const std::size_t no = static_cast<std::size_t>(wn.doc["bufferViews"][2]["byteOffset"].n);
        double worstLen = 0.0, worstDir = 0.0;
        for (std::size_t v = 0; v < ball.vertexCount(); ++v) {
            const double nx = f32At(wn.bin, no + 12 * v), ny = f32At(wn.bin, no + 12 * v + 4), nz = f32At(wn.bin, no + 12 * v + 8);
            worstLen = std::max(worstLen, std::fabs(std::sqrt(nx * nx + ny * ny + nz * nz) - 1.0));
            // the sphere's outward normal in glTF axes is (dx, dz, -dy)/r
            const double dx = (ball.positions[3 * v] - 3.0) / 12.5, dy = (ball.positions[3 * v + 1] + 4.0) / 12.5,
                         dz = (ball.positions[3 * v + 2] - 7.0) / 12.5;
            worstDir = std::max(worstDir, std::fabs(nx - dx) + std::fabs(ny - dz) + std::fabs(nz + dy));
        }
        check(worstLen < 1e-6 && worstDir < 1e-5, "normals are unit length and rotated with the positions");
        std::vector<double> zero(ball.positions.size(), 0.0);
        GlbWriteOptions bad;
        bad.normals = &zero;
        std::string why;
        check(MeshExchange::writeGLB(ball, bad, &why).empty() && why.find("normal") != std::string::npos,
              "a zero normal is refused, not written");
        GlbWriteOptions esc;
        esc.meshName = "quote\" back\\slash";
        const GlbWalk we = walkGlb(MeshExchange::writeGLB(cube, esc));
        check(we.ok && we.doc["nodes"][0]["name"].s == "quote\" back\\slash", "names are JSON-escaped");
        check(MeshExchange::writeGLB(TriMesh{}).empty(), "an empty mesh writes nothing");
    }

    // ── 9. GLB reader: broken files refused, scene graph honoured ───────────
    std::printf("-- GLB reader\n");
    {
        auto refusedWith = [](const std::string& bytes, const char* needle) {
            const ReadResult r = MeshExchange::readGLB(bytes);
            if (r.ok) return false;
            if (std::strstr(r.reason.c_str(), needle) == nullptr) {
                std::printf("      (reason was: %s)\n", r.reason.c_str());
                return false;
            }
            return true;
        };
        const std::string bin = triangleBin();
        const ReadResult base = MeshExchange::readGLB(makeGlb(triangleJson(), bin));
        check(base.ok && base.mesh.triangleCount() == 1, "a hand-built triangle reads (" + base.reason + ")");
        // (1,0,0) m, +Y up -> (1000, 0, 0) mm; (0,1,0) m -> (0, 0, 1000) mm
        check(base.ok && base.mesh.positions[3] == 1000.0 && base.mesh.positions[8] == 1000.0,
              "metres +Y up come back as millimetres +Z up");
        std::string bad = makeGlb(triangleJson(), bin);
        bad[0] = 'X';
        check(refusedWith(bad, "magic"), "a bad magic is refused");
        const std::string good = makeGlb(triangleJson(), bin);
        check(refusedWith(good.substr(0, good.size() - 4), "length"), "a truncated file is refused");
        std::string misaligned = good;
        misaligned[12] = static_cast<char>(misaligned[12] + 1);
        check(refusedWith(misaligned, "misaligned"), "a JSON chunk length that is not a multiple of 4 is refused");
        std::string oob = bin;
        oob[44] = 9;  // the third index -> 9, with 3 vertices
        check(refusedWith(makeGlb(triangleJson(), oob), "out of range"), "an index out of range is refused");
        check(refusedWith(makeGlb(triangleJson(",\"mode\":1"), bin), "TRIANGLES"), "a LINES primitive is refused");
        check(refusedWith(makeGlb(triangleJson("", "", "\"count\":3", "", ",\"extensionsRequired\":[\"KHR_draco_mesh_compression\"]"), bin), "requires extensions"),
              "a required extension is refused");
        check(refusedWith(makeGlb(triangleJson("", "", "\"count\":3", ",\"uri\":\"x.bin\""), bin), "external"), "an external buffer is refused");
        check(refusedWith(makeGlb(triangleJson("", "", "\"count\":30"), bin), "past its bufferView"), "an accessor that overruns its view is refused");
        check(refusedWith(makeGlb(triangleJson("", "", "\"count\":3,\"sparse\":{}"), bin), "sparse"), "a sparse accessor is refused");
        check(refusedWith(makeGlb("{\"asset\":{\"version\":\"1.0\"}}", bin), "2.x"), "a glTF 1.0 asset is refused");
        check(refusedWith(makeGlb("{\"asset\":{\"version\":\"2.0\"},", bin), "not valid JSON"), "broken JSON is refused");
        // A TRS node with a child: translation (1,2,3) m, 90 deg about +Y,
        // scale 2; the child adds translation (0,0,1).
        // 17 significant digits: glTF requires a UNIT quaternion, and
        // std::to_string's six decimals are not one (|q|^2 = 1.0000006, which
        // moved this vertex by 2.5 micrometres -- measured, the first time).
        char sq[32];
        std::snprintf(sq, sizeof(sq), "%.17g", std::sqrt(0.5));
        const std::string s = sq;
        const std::string trsJson = triangleJson("", ",\"children\":[1]") ;
        std::string twoNodes = trsJson;
        twoNodes.replace(twoNodes.find("\"nodes\":[{\"mesh\":0,\"children\":[1]}]"),
                         std::string("\"nodes\":[{\"mesh\":0,\"children\":[1]}]").size(),
                         "\"nodes\":[{\"translation\":[1,2,3],\"rotation\":[0," + s + ",0," + s +
                             "],\"scale\":[2,2,2],\"children\":[1]},{\"translation\":[0,0,1],\"mesh\":0}]");
        const ReadResult trs = MeshExchange::readGLB(makeGlb(twoNodes, bin));
        // vertex (1,0,0): child -> (1,0,1); scale -> (2,0,2); rotate +90 about Y
        // maps (x,y,z) -> (z, y, -x) = (2, 0, -2); translate -> (3, 2, 1) m;
        // to mm +Z up: (3000, -1000, 2000).
        if (trs.ok) {
            std::printf("      vertex 1 -> (%.6f, %.6f, %.6f) mm\n", trs.mesh.positions[3],
                        trs.mesh.positions[4], trs.mesh.positions[5]);
        }
        check(trs.ok && std::fabs(trs.mesh.positions[3] - 3000.0) < 1e-3 &&
                  std::fabs(trs.mesh.positions[4] + 1000.0) < 1e-3 && std::fabs(trs.mesh.positions[5] - 2000.0) < 1e-3,
              "node TRS and children compose down the scene graph (" + trs.reason + ")");
        const std::string mirrorJson = triangleJson("", ",\"scale\":[-1,1,1]");
        const ReadResult mir = MeshExchange::readGLB(makeGlb(mirrorJson, bin));
        // the same triangle mirrored keeps its outward side: its normal in mm
        // space must be the mirror image of the unmirrored one, not reversed.
        auto normalZ = [](const TriMesh& m) {  // z of (b-a) x (c-a), mm frame
            const double* a = &m.positions[3 * m.indices[0]];
            const double* b = &m.positions[3 * m.indices[1]];
            const double* c = &m.positions[3 * m.indices[2]];
            return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        };
        auto normalY = [](const TriMesh& m) {
            const double* a = &m.positions[3 * m.indices[0]];
            const double* b = &m.positions[3 * m.indices[1]];
            const double* c = &m.positions[3 * m.indices[2]];
            return (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        };
        check(mir.ok && base.ok && std::fabs(normalY(mir.mesh) - normalY(base.mesh)) < 1e-9 && normalZ(mir.mesh) == normalZ(base.mesh),
              "a mirroring node keeps the triangle facing the same (mirrored) side");
    }

    std::printf("RESULT: %d / %d passed\n", g_pass, g_total);
    return g_pass == g_total ? 0 : 1;
}
