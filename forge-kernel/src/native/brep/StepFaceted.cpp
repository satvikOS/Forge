// forge/native/brep/StepFaceted.cpp
//
// Implementation of the in-house FACETED STEP codec (StepFaceted.hpp).
// Pure C++20, standard library only. See header for scope / honesty posture.
//
// EMITTED GRAMMAR (the exact subset this module writes AND reads):
//
//   ISO-10303-21;
//   HEADER;
//   FILE_DESCRIPTION(('forge faceted tessellated solid'),'2;1');
//   FILE_NAME('<name>','<ts>',(''),(''),'forge::native','forge','');
//   FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 442 3 1 4 }'));
//   ENDSEC;
//   DATA;
//   #1=CARTESIAN_POINT('',(x,y,z));            -- one per vertex
//   ...
//   #v=VERTEX_POINT('',#p);                     -- one per vertex (wraps a point)
//   ...
//   #e=EDGE_CURVE('',#vA,#vB,*,.T.);            -- one per undirected edge
//   ...
//   #o=ORIENTED_EDGE('',*,*,#e,.T.);            -- directed use of an edge
//   ...
//   #l=EDGE_LOOP('',(#o1,#o2,#o3));             -- one per triangle (3 edges)
//   #b=FACE_OUTER_BOUND('',#l,.T.);             -- one per triangle
//   #pl=PLANE('',#ax);  (+ AXIS2_PLACEMENT_3D + DIRECTIONs)  -- face support plane
//   #f=ADVANCED_FACE('',(#b),#pl,.T.);          -- one per triangle
//   ...
//   #s=CLOSED_SHELL('',(#f1,...,#fN));
//   #m=MANIFOLD_SOLID_BREP('forge_solid',#s);
//   ENDSEC;
//   END-ISO-10303-21;
//
// PARSING POSTURE: a small generic Part-21 instance reader builds an
//   id -> (typeKeyword, raw-parameter-string) table from the DATA section, then
//   resolves the triangle set by walking the MANIFOLD_SOLID_BREP's CLOSED_SHELL.
//   Any dangling reference, type mismatch, non-triangular loop, malformed number
//   or missing structural marker is reported as ok=false (never a partial mesh).

#include "forge/native/brep/StepFaceted.hpp"

// Standard headers actually used in THIS TU (the header already lists the full
// set; repeated here so the .cpp is self-sufficient on libstdc++ as well).
#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <map>
#include <string>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace brep {

// ===========================================================================
// Locale-independent float formatting / parsing
// ===========================================================================
std::string stepFormatDouble(double v) {
    // Shortest representation that round-trips to the identical double. We force
    // a decimal point or exponent so the value is unambiguously a REAL in STEP
    // (a bare integer-looking token like "3" is still a valid REAL, but emitting
    // "3." keeps us aligned with Part-21 REAL lexing and our own parser).
    char buf[64];
    auto res = std::to_chars(buf, buf + sizeof(buf), v);
    if (res.ec != std::errc()) {
        return std::string("0.");  // non-finite is rejected upstream
    }
    std::string s(buf, res.ptr);
    // Ensure it reads as a REAL (contains '.' or 'e'/'E'). std::to_chars may emit
    // e.g. "3" for 3.0; append ".".
    bool hasDotOrExp = false;
    for (char c : s) {
        if (c == '.' || c == 'e' || c == 'E') { hasDotOrExp = true; break; }
    }
    if (!hasDotOrExp) s += '.';
    return s;
}

bool stepParseDouble(const std::string& token, double& out) {
    if (token.empty()) return false;
    const char* first = token.data();
    const char* last  = token.data() + token.size();
    double value = 0.0;
    auto res = std::from_chars(first, last, value);
    if (res.ec != std::errc()) return false;
    if (res.ptr != last) return false;        // trailing garbage => reject
    if (!std::isfinite(value)) return false;  // NaN / inf are not valid coords
    out = value;
    return true;
}

// ===========================================================================
// StepMesh members
// ===========================================================================
bool StepMesh::wellFormed() const {
    if (indices.empty()) return false;
    if (positions.empty()) return false;
    if (positions.size() % 3 != 0) return false;
    if (indices.size() % 3 != 0) return false;
    const std::uint32_t vcount = static_cast<std::uint32_t>(positions.size() / 3);
    for (std::uint32_t idx : indices) {
        if (idx >= vcount) return false;
    }
    for (double c : positions) {
        if (!std::isfinite(c)) return false;
    }
    return true;
}

double StepMesh::signedVolume() const {
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
        const double cross_x = ay * bz - az * by;
        const double cross_y = az * bx - ax * bz;
        const double cross_z = ax * by - ay * bx;
        vol += (cross_x * cx + cross_y * cy + cross_z * cz);
    }
    return vol / 6.0;
}

namespace {

// ---------------------------------------------------------------------------
// small string utilities
// ---------------------------------------------------------------------------
inline bool isSpace(char c) {
    return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f' ||
           c == '\v';
}

WriteResult writeFail(const std::string& reason) {
    WriteResult r;
    r.ok = false;
    r.reason = reason;
    return r;
}

ReadStepResult readFail(const std::string& reason) {
    ReadStepResult r;
    r.ok = false;
    r.reason = reason;
    return r;
}

// Parse a full unsigned integer token (no trailing garbage).
bool parseU64(const char* first, const char* last, std::uint64_t& out) {
    if (first == last) return false;
    std::uint64_t value = 0;
    auto res = std::from_chars(first, last, value);
    if (res.ec != std::errc()) return false;
    if (res.ptr != last) return false;
    out = value;
    return true;
}

// Trim leading/trailing ASCII whitespace from [b,e).
void trim(const std::string& s, std::size_t& b, std::size_t& e) {
    while (b < e && isSpace(s[b])) ++b;
    while (e > b && isSpace(s[e - 1])) --e;
}

} // namespace

// ===========================================================================
// WRITE
// ===========================================================================
WriteResult StepFaceted::write(const StepMesh& mesh, const std::string& name) {
    if (!mesh.wellFormed()) {
        return writeFail("StepFaceted.write: mesh is not well-formed "
                         "(empty / ragged arrays / out-of-range index / "
                         "non-finite coordinate)");
    }

    const std::size_t vc  = mesh.vertexCount();
    const std::size_t tc  = mesh.triangleCount();

    // ----- ID allocation plan (stable, contiguous) -------------------------
    // The DATA section is built bottom-up; ids must be assigned before bodies
    // are emitted because EDGE_LOOP references ORIENTED_EDGE ids etc. We assign:
    //   points:        1 .. vc
    //   vertex_points: vc+1 .. 2*vc
    // then, walking triangles, we allocate edge/oriented-edge/loop/bound/
    // geometry/face ids on demand. CLOSED_SHELL + MANIFOLD_SOLID_BREP last.
    std::uint64_t nextId = 1;
    auto alloc = [&]() -> std::uint64_t { return nextId++; };

    std::vector<std::uint64_t> pointId(vc);
    std::vector<std::uint64_t> vertexId(vc);
    for (std::size_t i = 0; i < vc; ++i) pointId[i] = alloc();
    for (std::size_t i = 0; i < vc; ++i) vertexId[i] = alloc();

    // Undirected-edge cache: key (min,max) vertex -> EDGE_CURVE id. The
    // EDGE_CURVE stores its endpoints in (min->max) order; an ORIENTED_EDGE then
    // records orientation .T./.F. relative to that. We dedupe undirected edges
    // so a closed mesh emits ~3*tc/2 EDGE_CURVEs, not 3*tc.
    std::map<std::pair<std::uint32_t, std::uint32_t>, std::uint64_t> edgeCurveId;

    // Bodies are accumulated into separate buffers then concatenated in id
    // order is NOT required for validity, but we emit in a readable bottom-up
    // grouping. We keep one growing buffer and append as we allocate.
    std::string data;
    data.reserve(vc * 48 + tc * 320 + 256);

    auto emitPoint = [&](std::uint64_t id, double x, double y, double z) {
        data += '#';
        data += std::to_string(id);
        data += "=CARTESIAN_POINT('',(";
        data += stepFormatDouble(x);
        data += ',';
        data += stepFormatDouble(y);
        data += ',';
        data += stepFormatDouble(z);
        data += "));\n";
    };

    // CARTESIAN_POINTs
    for (std::size_t i = 0; i < vc; ++i) {
        emitPoint(pointId[i], mesh.positions[3 * i + 0],
                  mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]);
    }
    // VERTEX_POINTs
    for (std::size_t i = 0; i < vc; ++i) {
        data += '#';
        data += std::to_string(vertexId[i]);
        data += "=VERTEX_POINT('',#";
        data += std::to_string(pointId[i]);
        data += ");\n";
    }

    // Resolve (or create) the EDGE_CURVE id for the undirected edge {a,b}.
    auto edgeCurveFor = [&](std::uint32_t a, std::uint32_t b) -> std::uint64_t {
        const std::uint32_t lo = std::min(a, b);
        const std::uint32_t hi = std::max(a, b);
        auto key = std::make_pair(lo, hi);
        auto it = edgeCurveId.find(key);
        if (it != edgeCurveId.end()) return it->second;
        const std::uint64_t id = alloc();
        edgeCurveId.emplace(key, id);
        // EDGE_CURVE('',#vlo,#vhi,*,.T.) — the underlying curve geometry is left
        // as '*' (a faceted edge is a straight segment between its vertices; we
        // do not emit a separate LINE entity for this minimal subset, and our
        // reader does not require one).
        data += '#';
        data += std::to_string(id);
        data += "=EDGE_CURVE('',#";
        data += std::to_string(vertexId[lo]);
        data += ",#";
        data += std::to_string(vertexId[hi]);
        data += ",*,.T.);\n";
        return id;
    };

    std::vector<std::uint64_t> faceIds;
    faceIds.reserve(tc);

    auto emitDir = [&](double x, double y, double z) -> std::uint64_t {
        const std::uint64_t id = alloc();
        data += '#';
        data += std::to_string(id);
        data += "=DIRECTION('',(";
        data += stepFormatDouble(x);
        data += ',';
        data += stepFormatDouble(y);
        data += ',';
        data += stepFormatDouble(z);
        data += "));\n";
        return id;
    };

    for (std::size_t t = 0; t < tc; ++t) {
        const std::uint32_t i0 = mesh.indices[3 * t + 0];
        const std::uint32_t i1 = mesh.indices[3 * t + 1];
        const std::uint32_t i2 = mesh.indices[3 * t + 2];

        const std::uint32_t corner[3] = {i0, i1, i2};

        // Three ORIENTED_EDGEs around the triangle, in winding order.
        std::uint64_t orientedIds[3];
        for (int k = 0; k < 3; ++k) {
            const std::uint32_t a = corner[k];
            const std::uint32_t b = corner[(k + 1) % 3];
            const std::uint64_t ec = edgeCurveFor(a, b);
            // Orientation .T. iff the directed (a->b) matches the EDGE_CURVE's
            // stored (lo->hi) order.
            const bool sameDir = (a < b);
            const std::uint64_t oid = alloc();
            data += '#';
            data += std::to_string(oid);
            data += "=ORIENTED_EDGE('',*,*,#";
            data += std::to_string(ec);
            data += sameDir ? ",.T.);\n" : ",.F.);\n";
            orientedIds[k] = oid;
        }

        // EDGE_LOOP of the three oriented edges.
        const std::uint64_t loopId = alloc();
        data += '#';
        data += std::to_string(loopId);
        data += "=EDGE_LOOP('',(#";
        data += std::to_string(orientedIds[0]);
        data += ",#";
        data += std::to_string(orientedIds[1]);
        data += ",#";
        data += std::to_string(orientedIds[2]);
        data += "));\n";

        // FACE_OUTER_BOUND wrapping the loop.
        const std::uint64_t boundId = alloc();
        data += '#';
        data += std::to_string(boundId);
        data += "=FACE_OUTER_BOUND('',#";
        data += std::to_string(loopId);
        data += ",.T.);\n";

        // Support PLANE: AXIS2_PLACEMENT_3D at vertex i0, with the triangle
        // normal as its axis (Z) and an in-plane reference (the i0->i1 edge) as
        // its ref direction (X). This is geometrically faithful to the facet.
        const double ax = mesh.positions[3 * i0 + 0];
        const double ay = mesh.positions[3 * i0 + 1];
        const double az = mesh.positions[3 * i0 + 2];
        const double bx = mesh.positions[3 * i1 + 0];
        const double by = mesh.positions[3 * i1 + 1];
        const double bz = mesh.positions[3 * i1 + 2];
        const double cx = mesh.positions[3 * i2 + 0];
        const double cy = mesh.positions[3 * i2 + 1];
        const double cz = mesh.positions[3 * i2 + 2];
        double ux = bx - ax, uy = by - ay, uz = bz - az;
        double vx = cx - ax, vy = cy - ay, vz = cz - az;
        double nx = uy * vz - uz * vy;
        double ny = uz * vx - ux * vz;
        double nz = ux * vy - uy * vx;
        double nlen = std::sqrt(nx * nx + ny * ny + nz * nz);
        if (nlen > 0.0) { nx /= nlen; ny /= nlen; nz /= nlen; }
        else { nx = 0.0; ny = 0.0; nz = 1.0; }  // degenerate facet fallback dir
        double ulen = std::sqrt(ux * ux + uy * uy + uz * uz);
        if (ulen > 0.0) { ux /= ulen; uy /= ulen; uz /= ulen; }
        else { ux = 1.0; uy = 0.0; uz = 0.0; }

        const std::uint64_t originPtId = alloc();
        emitPoint(originPtId, ax, ay, az);
        const std::uint64_t axisDirId = emitDir(nx, ny, nz);
        const std::uint64_t refDirId  = emitDir(ux, uy, uz);

        const std::uint64_t placementId = alloc();
        data += '#';
        data += std::to_string(placementId);
        data += "=AXIS2_PLACEMENT_3D('',#";
        data += std::to_string(originPtId);
        data += ",#";
        data += std::to_string(axisDirId);
        data += ",#";
        data += std::to_string(refDirId);
        data += ");\n";

        const std::uint64_t planeId = alloc();
        data += '#';
        data += std::to_string(planeId);
        data += "=PLANE('',#";
        data += std::to_string(placementId);
        data += ");\n";

        const std::uint64_t faceId = alloc();
        data += '#';
        data += std::to_string(faceId);
        data += "=ADVANCED_FACE('',(#";
        data += std::to_string(boundId);
        data += "),#";
        data += std::to_string(planeId);
        data += ",.T.);\n";
        faceIds.push_back(faceId);
    }

    // CLOSED_SHELL of all faces.
    const std::uint64_t shellId = alloc();
    {
        data += '#';
        data += std::to_string(shellId);
        data += "=CLOSED_SHELL('',(";
        for (std::size_t f = 0; f < faceIds.size(); ++f) {
            if (f) data += ',';
            data += '#';
            data += std::to_string(faceIds[f]);
        }
        data += "));\n";
    }

    // MANIFOLD_SOLID_BREP.
    const std::uint64_t solidId = alloc();
    data += '#';
    data += std::to_string(solidId);
    data += "=MANIFOLD_SOLID_BREP('forge_solid',#";
    data += std::to_string(shellId);
    data += ");\n";

    // ----- envelope + header -----------------------------------------------
    std::string out;
    out.reserve(data.size() + 512);
    out += "ISO-10303-21;\n";
    out += "HEADER;\n";
    out += "FILE_DESCRIPTION(('forge faceted tessellated solid "
           "(NOT analytic B-rep surfaces)'),'2;1');\n";
    out += "FILE_NAME('";
    // Escape any apostrophe in the user name per Part 21 ('' is a literal ').
    for (char ch : name) {
        if (ch == '\'') out += "''";
        else out += ch;
    }
    out += "','2026-01-01T00:00:00',(''),(''),"
           "'forge::native::brep::StepFaceted','forge','');\n";
    out += "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 442 3 1 4 }'));\n";
    out += "ENDSEC;\n";
    out += "DATA;\n";
    out += data;
    out += "ENDSEC;\n";
    out += "END-ISO-10303-21;\n";

    WriteResult r;
    r.ok = true;
    r.text = std::move(out);
    return r;
}

// ===========================================================================
// READ
// ===========================================================================
namespace {

// A parsed Part-21 instance: its type keyword and the RAW parameter string
// inside the outermost parentheses (e.g. for "#5=PLANE('',#4)" the params are
// "'',#4"). Nested parens / quotes are preserved verbatim for later splitting.
struct Instance {
    std::string type;    // e.g. "CARTESIAN_POINT"
    std::string params;  // raw text between the outermost ( )
};

// Split a parameter string at TOP-LEVEL commas only (respecting nested parens
// and single-quoted strings, where '' is an escaped quote). Returns the trimmed
// top-level fields.
std::vector<std::string> splitTopLevel(const std::string& s) {
    std::vector<std::string> out;
    int depth = 0;
    bool inStr = false;
    std::size_t fieldStart = 0;
    const std::size_t n = s.size();
    for (std::size_t i = 0; i < n; ++i) {
        const char c = s[i];
        if (inStr) {
            if (c == '\'') {
                // '' is an escaped quote inside a string.
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
            trim(s, b, e);
            out.emplace_back(s.substr(b, e - b));
            fieldStart = i + 1;
        }
    }
    std::size_t b = fieldStart, e = n;
    trim(s, b, e);
    // Only push a trailing field if the parameter string was non-empty OR there
    // were prior commas; for an empty params string we return {}.
    if (!(out.empty() && b == e)) {
        out.emplace_back(s.substr(b, e - b));
    }
    return out;
}

// Parse a "#<n>" reference token to its numeric id. Returns false otherwise.
bool parseRef(const std::string& tok, std::uint64_t& id) {
    if (tok.size() < 2 || tok[0] != '#') return false;
    return parseU64(tok.data() + 1, tok.data() + tok.size(), id);
}

// Parse the contents of a parenthesized LIST field "(a,b,c)" into its top-level
// fields. Returns false if the token is not a parenthesized list.
bool parseList(const std::string& tok, std::vector<std::string>& fields) {
    std::size_t b = 0, e = tok.size();
    if (b >= e || tok[b] != '(' || tok[e - 1] != ')') return false;
    std::string inner = tok.substr(b + 1, e - b - 2);
    fields = splitTopLevel(inner);
    return true;
}

// Extract the leading section keyword token (ISO-10303-21 / HEADER / DATA /
// ENDSEC / END-ISO-10303-21) at/after pos, used to validate the envelope.
// Returns the next significant non-space run.

// Find the DATA ... ENDSEC body span. Returns false if the structural markers
// are absent / out of order. On success [dataBegin,dataEnd) is the body between
// "DATA;" and its matching "ENDSEC;".
bool locateSections(const std::string& t, std::size_t& dataBegin,
                    std::size_t& dataEnd, std::string& why) {
    // Require the ISO envelope.
    const std::string ISO_BEGIN = "ISO-10303-21;";
    const std::string ISO_END   = "END-ISO-10303-21;";
    std::size_t isoB = t.find(ISO_BEGIN);
    if (isoB == std::string::npos) { why = "missing ISO-10303-21; marker"; return false; }
    std::size_t isoE = t.find(ISO_END);
    if (isoE == std::string::npos) { why = "missing END-ISO-10303-21; marker"; return false; }
    if (isoE < isoB) { why = "END-ISO before ISO marker"; return false; }

    std::size_t hdr = t.find("HEADER;", isoB);
    if (hdr == std::string::npos || hdr > isoE) { why = "missing HEADER; section"; return false; }
    // The first ENDSEC; closes HEADER.
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

// Tokenize the DATA body into id -> Instance. Each instance is
//   #<id> = <TYPE> ( <params> ) ;
// We scan respecting quotes / nested parens. Returns false on a structurally
// broken instance.
bool parseInstances(const std::string& t, std::size_t begin, std::size_t end,
                    std::unordered_map<std::uint64_t, Instance>& table,
                    std::string& why) {
    std::size_t i = begin;
    auto skipWs = [&]() { while (i < end && isSpace(t[i])) ++i; };
    while (true) {
        skipWs();
        if (i >= end) break;
        if (t[i] != '#') {
            why = "expected '#' starting an instance";
            return false;
        }
        ++i;  // past '#'
        std::size_t numB = i;
        while (i < end && t[i] >= '0' && t[i] <= '9') ++i;
        if (i == numB) { why = "instance id is not numeric"; return false; }
        std::uint64_t id = 0;
        if (!parseU64(t.data() + numB, t.data() + i, id)) {
            why = "instance id overflow";
            return false;
        }
        skipWs();
        if (i >= end || t[i] != '=') { why = "expected '=' after instance id"; return false; }
        ++i;  // past '='
        skipWs();
        // Type keyword: [A-Z0-9_]+
        std::size_t typeB = i;
        while (i < end && (t[i] == '_' || (t[i] >= 'A' && t[i] <= 'Z') ||
                           (t[i] >= '0' && t[i] <= '9'))) ++i;
        if (i == typeB) { why = "missing entity type keyword"; return false; }
        std::string type = t.substr(typeB, i - typeB);
        skipWs();
        if (i >= end || t[i] != '(') { why = "expected '(' after entity type"; return false; }
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
        skipWs();
        if (i >= end || t[i] != ';') { why = "expected ';' terminating instance"; return false; }
        ++i;  // past ';'

        if (!table.emplace(id, Instance{std::move(type), std::move(params)}).second) {
            why = "duplicate instance id #" + std::to_string(id);
            return false;
        }
    }
    return true;
}

// Resolve a CARTESIAN_POINT id to xyz. Strict on type + arity + finiteness.
bool resolvePoint(const std::unordered_map<std::uint64_t, Instance>& table,
                  std::uint64_t id, double& x, double& y, double& z,
                  std::string& why) {
    auto it = table.find(id);
    if (it == table.end()) { why = "dangling CARTESIAN_POINT ref #" + std::to_string(id); return false; }
    if (it->second.type != "CARTESIAN_POINT") {
        why = "#" + std::to_string(id) + " is not a CARTESIAN_POINT";
        return false;
    }
    std::vector<std::string> p = splitTopLevel(it->second.params);
    if (p.size() != 2) { why = "CARTESIAN_POINT arity != 2"; return false; }
    std::vector<std::string> coords;
    if (!parseList(p[1], coords) || coords.size() != 3) {
        why = "CARTESIAN_POINT coordinate list is not 3 reals";
        return false;
    }
    if (!stepParseDouble(coords[0], x) || !stepParseDouble(coords[1], y) ||
        !stepParseDouble(coords[2], z)) {
        why = "CARTESIAN_POINT has an unparseable/non-finite coordinate";
        return false;
    }
    return true;
}

// Resolve VERTEX_POINT -> CARTESIAN_POINT id.
bool resolveVertexPoint(const std::unordered_map<std::uint64_t, Instance>& table,
                        std::uint64_t id, std::uint64_t& pointId,
                        std::string& why) {
    auto it = table.find(id);
    if (it == table.end()) { why = "dangling VERTEX_POINT ref #" + std::to_string(id); return false; }
    if (it->second.type != "VERTEX_POINT") {
        why = "#" + std::to_string(id) + " is not a VERTEX_POINT";
        return false;
    }
    std::vector<std::string> p = splitTopLevel(it->second.params);
    if (p.size() != 2) { why = "VERTEX_POINT arity != 2"; return false; }
    if (!parseRef(p[1], pointId)) { why = "VERTEX_POINT geometry is not a ref"; return false; }
    return true;
}

// Resolve EDGE_CURVE -> (startVertexId, endVertexId).
bool resolveEdgeCurve(const std::unordered_map<std::uint64_t, Instance>& table,
                      std::uint64_t id, std::uint64_t& vStart,
                      std::uint64_t& vEnd, std::string& why) {
    auto it = table.find(id);
    if (it == table.end()) { why = "dangling EDGE_CURVE ref #" + std::to_string(id); return false; }
    if (it->second.type != "EDGE_CURVE") {
        why = "#" + std::to_string(id) + " is not an EDGE_CURVE";
        return false;
    }
    std::vector<std::string> p = splitTopLevel(it->second.params);
    // EDGE_CURVE('',#start,#end,curve,bool) -> 5 fields.
    if (p.size() != 5) { why = "EDGE_CURVE arity != 5"; return false; }
    if (!parseRef(p[1], vStart) || !parseRef(p[2], vEnd)) {
        why = "EDGE_CURVE endpoints are not vertex refs";
        return false;
    }
    return true;
}

} // namespace

ReadStepResult StepFaceted::read(const std::string& text) {
    std::size_t dataBegin = 0, dataEnd = 0;
    std::string why;
    if (!locateSections(text, dataBegin, dataEnd, why)) {
        return readFail("StepFaceted.read: " + why);
    }

    std::unordered_map<std::uint64_t, Instance> table;
    if (!parseInstances(text, dataBegin, dataEnd, table, why)) {
        return readFail("StepFaceted.read: " + why);
    }
    if (table.empty()) {
        return readFail("StepFaceted.read: DATA section has no instances");
    }

    // Find the single MANIFOLD_SOLID_BREP and its CLOSED_SHELL.
    std::uint64_t solidId = 0;
    bool foundSolid = false;
    for (const auto& kv : table) {
        if (kv.second.type == "MANIFOLD_SOLID_BREP") {
            if (foundSolid) {
                return readFail("StepFaceted.read: more than one "
                                "MANIFOLD_SOLID_BREP");
            }
            solidId = kv.first;
            foundSolid = true;
        }
    }
    if (!foundSolid) {
        return readFail("StepFaceted.read: no MANIFOLD_SOLID_BREP");
    }
    std::uint64_t shellId = 0;
    {
        std::vector<std::string> p = splitTopLevel(table.at(solidId).params);
        if (p.size() != 2 || !parseRef(p[1], shellId)) {
            return readFail("StepFaceted.read: MANIFOLD_SOLID_BREP shell ref bad");
        }
    }
    auto shellIt = table.find(shellId);
    if (shellIt == table.end() || shellIt->second.type != "CLOSED_SHELL") {
        return readFail("StepFaceted.read: shell is not a CLOSED_SHELL");
    }
    std::vector<std::string> shellFields = splitTopLevel(shellIt->second.params);
    if (shellFields.size() != 2) {
        return readFail("StepFaceted.read: CLOSED_SHELL arity != 2");
    }
    std::vector<std::string> faceRefs;
    if (!parseList(shellFields[1], faceRefs) || faceRefs.empty()) {
        return readFail("StepFaceted.read: CLOSED_SHELL face list empty/bad");
    }

    // Build the mesh: collect a deduplicated vertex table keyed by the
    // CARTESIAN_POINT id (each point id maps to one output vertex), and emit one
    // triangle per ADVANCED_FACE.
    StepMesh mesh;
    std::unordered_map<std::uint64_t, std::uint32_t> pointIdToVertex;
    pointIdToVertex.reserve(faceRefs.size() * 2);

    auto vertexForPoint = [&](std::uint64_t cpId) -> std::int64_t {
        auto pit = pointIdToVertex.find(cpId);
        if (pit != pointIdToVertex.end()) return pit->second;
        double x, y, z;
        std::string w;
        if (!resolvePoint(table, cpId, x, y, z, w)) {
            return -1;  // caller reports
        }
        const std::uint32_t vi =
            static_cast<std::uint32_t>(mesh.positions.size() / 3);
        mesh.positions.push_back(x);
        mesh.positions.push_back(y);
        mesh.positions.push_back(z);
        pointIdToVertex.emplace(cpId, vi);
        return vi;
    };

    // Given a VERTEX_POINT id, return the output vertex index (resolving its
    // CARTESIAN_POINT). -1 on any failure.
    auto vertexForVertexPoint = [&](std::uint64_t vpId) -> std::int64_t {
        std::uint64_t cpId = 0;
        std::string w;
        if (!resolveVertexPoint(table, vpId, cpId, w)) return -1;
        return vertexForPoint(cpId);
    };

    for (const std::string& fref : faceRefs) {
        std::uint64_t faceId = 0;
        if (!parseRef(fref, faceId)) {
            return readFail("StepFaceted.read: CLOSED_SHELL holds a non-ref");
        }
        auto fit = table.find(faceId);
        if (fit == table.end() || fit->second.type != "ADVANCED_FACE") {
            return readFail("StepFaceted.read: shell member #" +
                            std::to_string(faceId) + " is not an ADVANCED_FACE");
        }
        // ADVANCED_FACE('',(#bound,...),#surface,bool) -> 4 fields.
        std::vector<std::string> fp = splitTopLevel(fit->second.params);
        if (fp.size() != 4) {
            return readFail("StepFaceted.read: ADVANCED_FACE arity != 4");
        }
        std::vector<std::string> boundRefs;
        if (!parseList(fp[1], boundRefs) || boundRefs.size() != 1) {
            return readFail("StepFaceted.read: faceted ADVANCED_FACE must have "
                            "exactly one outer bound");
        }
        std::uint64_t boundId = 0;
        if (!parseRef(boundRefs[0], boundId)) {
            return readFail("StepFaceted.read: bound is not a ref");
        }
        auto bit = table.find(boundId);
        if (bit == table.end() ||
            (bit->second.type != "FACE_OUTER_BOUND" &&
             bit->second.type != "FACE_BOUND")) {
            return readFail("StepFaceted.read: bound is not a FACE_(OUTER_)BOUND");
        }
        std::vector<std::string> bp = splitTopLevel(bit->second.params);
        if (bp.size() != 3) {
            return readFail("StepFaceted.read: FACE_BOUND arity != 3");
        }
        std::uint64_t loopId = 0;
        if (!parseRef(bp[1], loopId)) {
            return readFail("StepFaceted.read: bound loop is not a ref");
        }
        auto lit = table.find(loopId);
        if (lit == table.end() || lit->second.type != "EDGE_LOOP") {
            return readFail("StepFaceted.read: bound is not backed by EDGE_LOOP");
        }
        std::vector<std::string> lp = splitTopLevel(lit->second.params);
        if (lp.size() != 2) {
            return readFail("StepFaceted.read: EDGE_LOOP arity != 2");
        }
        std::vector<std::string> orientedRefs;
        if (!parseList(lp[1], orientedRefs) || orientedRefs.size() != 3) {
            return readFail("StepFaceted.read: faceted EDGE_LOOP must have "
                            "exactly 3 oriented edges (non-triangular)");
        }

        // Walk the 3 ORIENTED_EDGEs; the ordered start vertices of the directed
        // edges are the triangle's corners in winding order.
        std::uint32_t tri[3];
        for (int k = 0; k < 3; ++k) {
            std::uint64_t oeId = 0;
            if (!parseRef(orientedRefs[k], oeId)) {
                return readFail("StepFaceted.read: EDGE_LOOP holds a non-ref");
            }
            auto oit = table.find(oeId);
            if (oit == table.end() || oit->second.type != "ORIENTED_EDGE") {
                return readFail("StepFaceted.read: loop member is not "
                                "an ORIENTED_EDGE");
            }
            // ORIENTED_EDGE('',*,*,#edge,bool) -> 5 fields.
            std::vector<std::string> op = splitTopLevel(oit->second.params);
            if (op.size() != 5) {
                return readFail("StepFaceted.read: ORIENTED_EDGE arity != 5");
            }
            std::uint64_t ecId = 0;
            if (!parseRef(op[3], ecId)) {
                return readFail("StepFaceted.read: ORIENTED_EDGE edge is not a ref");
            }
            const std::string& orient = op[4];
            bool sameDir;
            if (orient == ".T.") sameDir = true;
            else if (orient == ".F.") sameDir = false;
            else return readFail("StepFaceted.read: ORIENTED_EDGE orientation "
                                 "is not .T./.F.");

            std::uint64_t vS = 0, vE = 0;
            std::string w;
            if (!resolveEdgeCurve(table, ecId, vS, vE, w)) {
                return readFail("StepFaceted.read: " + w);
            }
            // The directed start vertex of this oriented edge:
            const std::uint64_t startVp = sameDir ? vS : vE;
            const std::int64_t vi = vertexForVertexPoint(startVp);
            if (vi < 0) {
                return readFail("StepFaceted.read: could not resolve oriented-"
                                "edge start vertex / its point");
            }
            tri[k] = static_cast<std::uint32_t>(vi);
        }

        // Reject a degenerate (collapsed) triangle — that would be a fake solid.
        if (tri[0] == tri[1] || tri[1] == tri[2] || tri[0] == tri[2]) {
            return readFail("StepFaceted.read: degenerate triangle "
                            "(repeated vertex)");
        }
        mesh.indices.push_back(tri[0]);
        mesh.indices.push_back(tri[1]);
        mesh.indices.push_back(tri[2]);
    }

    if (!mesh.wellFormed()) {
        return readFail("StepFaceted.read: reconstructed mesh is not well-formed");
    }

    ReadStepResult r;
    r.ok = true;
    r.mesh = std::move(mesh);
    return r;
}

} // namespace brep
} // namespace native
} // namespace forge
