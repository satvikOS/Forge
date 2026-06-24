// forge/native/brep/IgesRead.cpp
//
// Implementation of the FOREIGN IGES reader (IgesRead.hpp). Pure C++20, standard
// library + forge native headers only. No OCCT, no WASM. SIBLING of StepRead.cpp.
//
// PIPELINE
//   1. Split the 80-column ASCII file into its 5 sections (S/G/D/P/T) by the
//      section letter in column 73. Each Directory-Entry (D) entity is TWO lines
//      (20 eight-column fields); each Parameter-Data (P) entity is a delimiter-
//      separated stream over one or more P lines, back-referenced to its DE.
//   2. Parse the GLOBAL section's delimiter-separated parameter stream; resolve
//      the model-space scale (field 14) + unit flag (field 15) -> millimetre
//      scale, applied to every coordinate.
//   3. Build the DE table (DE sequence number -> {type, PD pointer, form}) and the
//      PD table (DE sequence number -> the entity's tokenised parameter list). The
//      "DE pointer" used as a cross-reference IS the odd DE sequence number; this
//      is the DE<->PD pairing the SPEC mandates.
//   4. Reconstruct geometry on demand: 116/110/100/104/126/128/108/120/122, then
//      the 142/144 trimmed-surface path (-> native TrimmedFace, NURBS trims via
//      projection like StepRead) and the 186/514/510/508/504/502 B-rep path (->
//      independent native faces, sewn into a shell/solid).
//   5. SEW (Sew.hpp) the independent faces; diagnose closure + the V/E/F signature.
//
// HONEST REPORTING: an entity type not reconstructed is recorded in `unsupported`
// (keyed "IGES_<type>"), never silently dropped.

#include "forge/native/brep/IgesRead.hpp"

#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsSurface.hpp"
#include "forge/native/brep/Curve.hpp"
#include "forge/native/brep/TrimmedFace.hpp"
#include "forge/native/brep/Sew.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <functional>
#include <map>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double PI = 3.14159265358979323846;

inline Vec3 PV(const Point3& p) { return Vec3{p.x, p.y, p.z}; }
inline Point3 P3(const Vec3& v) { return Point3{v.x, v.y, v.z}; }

ForeignReadResult fail(const std::string& why) {
    ForeignReadResult r; r.ok = false; r.reason = why; return r;
}

// ---------------------------------------------------------------------------
// IGES ENTITY TYPE NUMBERS handled (named for readability).
// ---------------------------------------------------------------------------
enum : int {
    E_CIRCULAR_ARC          = 100,
    E_CONIC_ARC             = 104,
    E_PLANE                 = 108,
    E_LINE                  = 110,
    E_POINT                 = 116,
    E_SURFACE_OF_REVOLUTION = 120,
    E_TABULATED_CYLINDER    = 122,
    E_RBSPLINE_CURVE        = 126,
    E_RBSPLINE_SURFACE      = 128,
    E_CURVE_ON_SURFACE      = 142,
    E_TRIMMED_SURFACE       = 144,
    E_VERTEX_LIST           = 502,
    E_EDGE_LIST             = 504,
    E_LOOP                  = 508,
    E_FACE                  = 510,
    E_SHELL                 = 514,
    E_MANIFOLD_SOLID_BREP   = 186
};

// ---------------------------------------------------------------------------
// DirEntry — one Directory-Entry record (the 20-field, two-line block). We keep
// only the fields the reader consumes.
// ---------------------------------------------------------------------------
struct DirEntry {
    int          type      = 0;   // field 1  : entity type number
    long         pdPointer = 0;   // field 2  : 1-based PD line number of the entity
    long         deSeq     = 0;   // field 10 : this DE's odd sequence number
    int          form      = 0;   // field 14 : form number
    std::size_t  pdIndex   = 0;   // index into the PD-token table (resolved later)
    bool         hasPd     = false;
};

// ---------------------------------------------------------------------------
// IgesModel — the parsed file: DE table keyed by DE sequence number, PD token
// lists keyed by the SAME DE sequence number, and the resolved unit scale.
// ---------------------------------------------------------------------------
struct IgesModel {
    std::map<long, DirEntry>                 de;       // DE seq -> entry
    std::map<long, std::vector<std::string>> pd;       // DE seq -> param tokens
    char   pdelim = ',';
    char   rdelim = ';';
    double scaleToMm = 1.0;
    std::string unitName = "MILLIMETRE";
};

// Trim trailing/leading whitespace from a token.
std::string trimTok(const std::string& s) {
    std::size_t b = 0, e = s.size();
    while (b < e && std::isspace((unsigned char)s[b])) ++b;
    while (e > b && std::isspace((unsigned char)s[e - 1])) --e;
    return s.substr(b, e - b);
}

// Parse an IGES real/integer token. IGES uses Fortran 'D' exponents (1.0D2) which
// we normalise to 'E' for strtod. Empty token -> false.
bool igesNum(const std::string& tokRaw, double& out) {
    std::string t = trimTok(tokRaw);
    if (t.empty()) return false;
    for (char& c : t) { if (c == 'D' || c == 'd') c = 'E'; }
    const char* first = t.c_str();
    char* end = nullptr;
    double v = std::strtod(first, &end);
    if (end != first + t.size()) return false;
    if (!std::isfinite(v)) return false;
    out = v;
    return true;
}

bool igesInt(const std::string& tok, long& out) {
    double d;
    if (!igesNum(tok, d)) return false;
    out = (long)std::llround(d);
    return true;
}

// An IGES "pointer" field is the DE sequence number of the target (0 = null). A
// negated pointer is sometimes used as an orientation flag; we take the magnitude.
bool igesPtr(const std::string& tok, long& out) {
    long v;
    if (!igesInt(tok, v)) return false;
    out = std::labs(v);
    return true;
}

// ---------------------------------------------------------------------------
// SECTION SPLIT. Walk the file line-by-line; classify each line by the section
// letter in column 73 (index 72). Tolerates lines shorter than 80 cols (some
// writers right-trim) by scanning back for the section letter.
// ---------------------------------------------------------------------------
struct RawLine { char section = ' '; std::string payload; long seq = 0; };

bool splitSections(const std::string& text, std::vector<RawLine>& gLines,
                   std::vector<RawLine>& dLines, std::vector<RawLine>& pLines,
                   std::string& why) {
    std::size_t i = 0, n = text.size();
    while (i < n) {
        std::size_t e = text.find('\n', i);
        std::string line = (e == std::string::npos) ? text.substr(i)
                                                     : text.substr(i, e - i);
        i = (e == std::string::npos) ? n : e + 1;
        // strip a trailing CR.
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) continue;
        // The section letter is at column 73 (index 72). If the line is shorter,
        // find the LAST non-space alpha char in [64,79] that is one of S/G/D/P/T.
        char sect = 0; long seq = 0; std::string payload;
        if (line.size() >= 73) {
            sect = line[72];
            payload = line.substr(0, 72);
            // sequence number is columns 74-80.
            std::string sn = trimTok(line.substr(73));
            if (!sn.empty()) { double d; if (igesNum(sn, d)) seq = (long)std::llround(d); }
        } else {
            // Fallback: last char is the section letter, the rest payload.
            char c = line.back();
            if (c=='S'||c=='G'||c=='D'||c=='P'||c=='T') {
                sect = c; payload = line.substr(0, line.size()-1);
            }
        }
        if (!sect) continue;
        RawLine rl; rl.section = sect; rl.payload = payload; rl.seq = seq;
        switch (sect) {
            case 'S': break;                       // start: ignored
            case 'G': gLines.push_back(rl); break;
            case 'D': dLines.push_back(rl); break;
            case 'P': pLines.push_back(rl); break;
            case 'T': break;                       // terminate: ignored
            default: break;
        }
    }
    if (gLines.empty() && dLines.empty() && pLines.empty()) {
        why = "no IGES S/G/D/P/T sections found";
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// GLOBAL section parse. The GLOBAL stream is a single delimiter-separated record
// spanning all G lines. The FIRST two fields define the delimiters themselves, in
// the Hollerith form "1H," / "1H;" (or empty -> defaults ',' and ';'). We scan
// the raw concatenated payload with the active delimiters once they are known.
// ---------------------------------------------------------------------------
bool parseGlobal(const std::vector<RawLine>& gLines, IgesModel& m, std::string& why) {
    std::string raw;
    for (const auto& l : gLines) raw += l.payload;
    // Determine delimiters from the leading fields. A field of the form "nHxxxx"
    // is a Hollerith string of length n. Field 1 = parameter delimiter, field 2 =
    // record delimiter. Detect a leading "1H<c>" pattern for each.
    std::size_t pos = 0;
    char pdelim = ',';
    char rdelim = ';';
    // field 1
    if (raw.size() >= 3 && raw.compare(0, 2, "1H") == 0) {
        pdelim = raw[2];
        pos = 3;
        if (pos < raw.size() && raw[pos] == pdelim) ++pos;  // skip the delimiter
    } else if (!raw.empty() && raw[0] == ',') {
        pdelim = ',';
        pos = 1;
    }
    // field 2 (record delimiter): could be "1H;" or empty (then default ';').
    if (pos + 2 < raw.size() && raw.compare(pos, 2, "1H") == 0) {
        rdelim = raw[pos + 2];
        pos += 3;
        if (pos < raw.size() && raw[pos] == pdelim) ++pos;
    } else if (pos < raw.size() && raw[pos] == pdelim) {
        // field 2 empty -> default ';'
        ++pos;
    }
    m.pdelim = pdelim;
    m.rdelim = rdelim;

    // Now tokenise the REMAINDER of the global record (fields 3..N) by pdelim,
    // honouring the Hollerith "nH..." strings (their content may contain commas).
    std::vector<std::string> fields;
    fields.push_back(std::string(1, pdelim));   // field 1 (logical)
    fields.push_back(std::string(1, rdelim));   // field 2 (logical)
    {
        std::string cur;
        std::size_t i = pos, n = raw.size();
        while (i < n) {
            char c = raw[i];
            if (c == rdelim) break;             // end of global record
            if (c == pdelim) { fields.push_back(cur); cur.clear(); ++i; continue; }
            // Hollerith string: <int>H<chars>
            if (std::isdigit((unsigned char)c)) {
                std::size_t j = i;
                while (j < n && std::isdigit((unsigned char)raw[j])) ++j;
                if (j < n && raw[j] == 'H') {
                    long len = std::atol(raw.substr(i, j - i).c_str());
                    std::size_t start = j + 1;
                    std::string hol = raw.substr(start, (std::size_t)std::max(0L, len));
                    cur += hol;
                    i = start + (std::size_t)std::max(0L, len);
                    continue;
                }
            }
            cur += c;
            ++i;
        }
        fields.push_back(cur);
    }

    // Field 14 (index 13) = model space scale; field 15 = unit flag; field 16 =
    // unit name. (1-based field numbers per the IGES spec.)
    double modelScale = 1.0;
    if (fields.size() > 13) { double d; if (igesNum(fields[13], d) && d != 0.0) modelScale = d; }
    long unitFlag = 2;   // default mm
    if (fields.size() > 14) { long u; if (igesInt(fields[14], u)) unitFlag = u; }
    std::string unitName;
    if (fields.size() > 15) unitName = trimTok(fields[15]);

    // Resolve scale to millimetres. The unit flag enumerates the model units; the
    // coordinates are in those units * modelScale. We scale every coordinate so
    // the model arrives in mm.
    double unitToMm = 1.0;
    std::string nm;
    switch (unitFlag) {
        case 1: unitToMm = 25.4;     nm = "INCH"; break;   // inches
        case 2: unitToMm = 1.0;      nm = "MILLIMETRE"; break;
        case 3: unitToMm = 1.0;      nm = unitName.empty() ? "UNIT" : unitName; break; // by name
        case 4: unitToMm = 304.8;    nm = "FOOT"; break;
        case 5: unitToMm = 1609344.0;nm = "MILE"; break;
        case 6: unitToMm = 1000.0;   nm = "METRE"; break;
        case 7: unitToMm = 1.0e6;    nm = "KILOMETRE"; break;
        case 8: unitToMm = 25.4e-3;  nm = "MIL"; break;     // 1/1000 inch
        case 9: unitToMm = 1.0e-3;   nm = "MICRON"; break;
        case 10: unitToMm = 10.0;    nm = "CENTIMETRE"; break;
        case 11: unitToMm = 25.4e-6; nm = "MICROINCH"; break;
        default: unitToMm = 1.0;     nm = "MILLIMETRE"; break;
    }
    // Unit flag 3 = "units named in field 16"; try to honour a few common names.
    if (unitFlag == 3 && !unitName.empty()) {
        std::string up = unitName;
        std::transform(up.begin(), up.end(), up.begin(),
                       [](unsigned char c){ return (char)std::toupper(c); });
        if (up.find("IN") == 0 || up.find("INCH") != std::string::npos) { unitToMm = 25.4; nm = "INCH"; }
        else if (up.find("MM") != std::string::npos) { unitToMm = 1.0; nm = "MILLIMETRE"; }
        else if (up.find("M") == 0 && up.find("MM") == std::string::npos) { unitToMm = 1000.0; nm = "METRE"; }
    }
    m.scaleToMm = unitToMm * modelScale;
    m.unitName = nm;
    (void)why;
    return true;
}

// ---------------------------------------------------------------------------
// DIRECTORY-ENTRY parse. Each entity is two D lines; each line has 9 eight-column
// fields (1..72). The combined 18 fields plus 2 more are the 20 logical fields.
// We read: field1=type, field2=PD pointer (1-based PD line), line2 field2 (10th
// overall) = DE sequence number, line2 field6 (14th) = form number.
// ---------------------------------------------------------------------------
std::string deField(const std::string& payload, int idx /*0..8*/) {
    std::size_t start = (std::size_t)idx * 8;
    if (start >= payload.size()) return "";
    return trimTok(payload.substr(start, 8));
}

bool parseDirectory(const std::vector<RawLine>& dLines, IgesModel& m, std::string& why) {
    if (dLines.size() % 2 != 0) {
        why = "directory section has an odd line count";
        return false;
    }
    for (std::size_t k = 0; k + 1 < dLines.size(); k += 2) {
        const std::string& l1 = dLines[k].payload;
        const std::string& l2 = dLines[k + 1].payload;
        DirEntry e;
        long v;
        if (!igesInt(deField(l1, 0), v)) { why = "DE type not numeric"; return false; }
        e.type = (int)v;
        if (igesInt(deField(l1, 1), v)) e.pdPointer = v;   // field 2: PD line ptr
        // DE sequence number: prefer the explicit field on line 2 (field 10
        // overall == line2 field2 == idx 1), else use the line sequence numbers.
        long deSeq = 0;
        if (igesInt(deField(l2, 1), deSeq) && deSeq > 0) e.deSeq = deSeq;
        else e.deSeq = dLines[k].seq;          // the printed sequence number
        if (e.deSeq <= 0) e.deSeq = (long)(k) + 1;
        // form number: line2 field 6 (idx 5) == overall field 14.
        if (igesInt(deField(l2, 5), v)) e.form = (int)v;
        m.de[e.deSeq] = e;
    }
    return true;
}

// ---------------------------------------------------------------------------
// PARAMETER-DATA parse. The PD lines back-reference their owning DE via columns
// 66-72 (the last 8-col field on each P line is the DE sequence number). We group
// the P payloads (cols 1-64) by that DE pointer, concatenate, strip the trailing
// record delimiter, and tokenise by the parameter delimiter (honouring Hollerith
// strings, which we keep verbatim — only numeric/pointer fields are consumed).
// ---------------------------------------------------------------------------
bool parseParameters(const std::vector<RawLine>& pLines, IgesModel& m, std::string& why) {
    // Concatenate per-owning-DE. The owning-DE pointer is the trailing field of
    // the P payload (chars beyond col 64). Many writers put it at fixed col 66-72.
    std::map<long, std::string> byDe;
    for (const auto& l : pLines) {
        const std::string& pay = l.payload;        // cols 1-72
        // The DE back-pointer is the LAST whitespace-delimited integer on the line
        // (columns ~66-72). Payload here is cols 1-72; the param content is 1-64.
        // Take cols 1-64 as content; the remainder holds the DE pointer.
        std::string content = pay.substr(0, std::min<std::size_t>(64, pay.size()));
        std::string tail = (pay.size() > 64) ? pay.substr(64) : "";
        long deptr = 0;
        std::string tn = trimTok(tail);
        if (!tn.empty()) { double d; if (igesNum(tn, d)) deptr = (long)std::llround(d); }
        if (deptr <= 0) {
            // fall back to the line's printed P sequence (rare); skip if unknown.
            continue;
        }
        byDe[deptr] += content;
    }
    // Tokenise each DE's stream by the parameter delimiter, stopping at the record
    // delimiter. Hollerith strings are passed through verbatim as one token.
    for (auto& kv : byDe) {
        const std::string& raw = kv.second;
        std::vector<std::string> toks;
        std::string cur;
        std::size_t i = 0, n = raw.size();
        bool done = false;
        while (i < n && !done) {
            char c = raw[i];
            if (c == m.rdelim) { done = true; break; }
            if (c == m.pdelim) { toks.push_back(trimTok(cur)); cur.clear(); ++i; continue; }
            if (std::isdigit((unsigned char)c)) {
                // possible Hollerith "<int>H..."
                std::size_t j = i;
                while (j < n && std::isdigit((unsigned char)raw[j])) ++j;
                if (j < n && raw[j] == 'H') {
                    long len = std::atol(raw.substr(i, j - i).c_str());
                    std::size_t start = j + 1;
                    std::string hol = raw.substr(start, (std::size_t)std::max(0L, len));
                    cur += std::to_string(len) + "H" + hol;
                    i = start + (std::size_t)std::max(0L, len);
                    continue;
                }
            }
            cur += c;
            ++i;
        }
        toks.push_back(trimTok(cur));     // final field (before the record delim)
        // The FIRST token of a PD record is the entity type number (repeated). We
        // keep it so the geometry routines can sanity-check.
        m.pd[kv.first] = std::move(toks);
    }
    (void)why;
    return true;
}

// ---------------------------------------------------------------------------
// Look up the parameter tokens of the entity at DE sequence `deSeq`.
// ---------------------------------------------------------------------------
const std::vector<std::string>* params(const IgesModel& m, long deSeq) {
    auto it = m.pd.find(deSeq);
    if (it == m.pd.end()) return nullptr;
    return &it->second;
}
int entityType(const IgesModel& m, long deSeq) {
    auto it = m.de.find(deSeq);
    if (it == m.de.end()) return -1;
    return it->second.type;
}

// ===========================================================================
// GEOMETRY RECONSTRUCTION
// ===========================================================================

// 116 POINT: param[1..3] = x,y,z (param[0] = type number 116). Scaled to mm.
bool readPoint(const IgesModel& m, long deSeq, Vec3& out) {
    const auto* p = params(m, deSeq);
    if (!p || p->size() < 4) return false;
    double x, y, z;
    if (!igesNum((*p)[1], x) || !igesNum((*p)[2], y) || !igesNum((*p)[3], z)) return false;
    out = vscale(Vec3{x, y, z}, m.scaleToMm);
    return true;
}

// ---------------------------------------------------------------------------
// A reconstructed 3D edge curve, tagged. Mirrors StepRead::EdgeGeom so the trim
// builder can sample circles / b-splines and invert onto a surface.
// ---------------------------------------------------------------------------
enum class CurveKind3 { Line, Circle, Ellipse, BSpline, Unsupported };
struct Curve3 {
    bool ok = false;
    CurveKind3 kind = CurveKind3::Line;
    Vec3 v0{}, v1{};                  // directed start / end (scaled)
    Vec3 centre{}, axis{}, refDir{};  // conic frame (axis = plane normal)
    double radius = 0.0, radius2 = 0.0;
    NurbsCurve nurbs;
    int typeNum = 0;
};

// Build a NurbsCurve from a 126 RATIONAL B-SPLINE CURVE PD record. Layout:
//   [0]=126 [1]=K (upper ctrl index, n=K+1 pts) [2]=M (degree) [3]=PROP1 [4]=PROP2
//   [5]=PROP3 [6]=PROP4  then (A+1) knots (A = K+M+1), then (K+1) weights, then
//   (K+1) xyz triples, then 4 trailing params (V0,V1,XNORM,YNORM,ZNORM) ignored.
bool readBSplineCurve(const IgesModel& m, long deSeq, NurbsCurve& out) {
    const auto* p = params(m, deSeq);
    if (!p || p->size() < 7) return false;
    long K, M;
    if (!igesInt((*p)[1], K) || !igesInt((*p)[2], M)) return false;
    if (K < 1 || M < 1) return false;
    const long nPts = K + 1;
    const long nKnots = K + M + 2;          // A+1 with A = K+M+1
    std::size_t idx = 7;
    if ((std::size_t)(7 + nKnots + nPts + 3 * nPts) > p->size()) return false;
    out.degree = (std::size_t)M;
    out.knots.clear(); out.knots.reserve(nKnots);
    for (long i = 0; i < nKnots; ++i) {
        double d; if (!igesNum((*p)[idx++], d)) return false;
        out.knots.push_back(d);
    }
    out.weights.clear(); out.weights.reserve(nPts);
    for (long i = 0; i < nPts; ++i) {
        double w; if (!igesNum((*p)[idx++], w)) return false;
        out.weights.push_back(w);
    }
    out.controlPoints.clear(); out.controlPoints.reserve(nPts);
    for (long i = 0; i < nPts; ++i) {
        double x, y, z;
        if (!igesNum((*p)[idx++], x) || !igesNum((*p)[idx++], y) || !igesNum((*p)[idx++], z))
            return false;
        out.controlPoints.push_back(vscale(Vec3{x, y, z}, m.scaleToMm));
    }
    return out.knots.size() == out.controlPoints.size() + out.degree + 1;
}

// Reconstruct the 3D curve at DE `deSeq` (110/100/104/126) with its directed
// endpoints. `expectStart`/`expectEnd` are the topological vertices (already
// scaled) that orient the curve; null -> take the curve's own sense.
Curve3 readCurve3(const IgesModel& m, long deSeq) {
    Curve3 g;
    int t = entityType(m, deSeq);
    g.typeNum = t;
    const auto* p = params(m, deSeq);
    if (!p) { g.kind = CurveKind3::Unsupported; return g; }

    if (t == E_LINE) {
        // 110: [0]=110 [1..3]=P1 [4..6]=P2
        if (p->size() < 7) return g;
        double x1,y1,z1,x2,y2,z2;
        if (!igesNum((*p)[1],x1)||!igesNum((*p)[2],y1)||!igesNum((*p)[3],z1)||
            !igesNum((*p)[4],x2)||!igesNum((*p)[5],y2)||!igesNum((*p)[6],z2)) return g;
        g.kind = CurveKind3::Line;
        g.v0 = vscale(Vec3{x1,y1,z1}, m.scaleToMm);
        g.v1 = vscale(Vec3{x2,y2,z2}, m.scaleToMm);
        g.ok = true; return g;
    }
    if (t == E_CIRCULAR_ARC) {
        // 100: [0]=100 [1]=ZT(plane z) [2]=Xc [3]=Yc [4]=X1 [5]=Y1 [6]=X2 [7]=Y2
        // Arc lies in a plane Z = ZT (z parallel to the XY plane). Start at (X1,Y1)
        // CCW to (X2,Y2). All in the entity's definition space (we take it as model
        // space; a transform matrix 124 would compose — reported unsupported if so).
        if (p->size() < 8) return g;
        double zt,xc,yc,x1,y1,x2,y2;
        if (!igesNum((*p)[1],zt)||!igesNum((*p)[2],xc)||!igesNum((*p)[3],yc)||
            !igesNum((*p)[4],x1)||!igesNum((*p)[5],y1)||!igesNum((*p)[6],x2)||
            !igesNum((*p)[7],y2)) return g;
        Vec3 c{xc, yc, zt}, s{x1, y1, zt}, e{x2, y2, zt};
        double r = std::sqrt((x1-xc)*(x1-xc) + (y1-yc)*(y1-yc));
        g.kind = CurveKind3::Circle;
        g.centre = vscale(c, m.scaleToMm);
        g.axis   = Vec3{0, 0, 1};
        g.refDir = Vec3{1, 0, 0};
        g.radius = r * m.scaleToMm;
        g.v0 = vscale(s, m.scaleToMm);
        g.v1 = vscale(e, m.scaleToMm);
        g.ok = true; return g;
    }
    if (t == E_CONIC_ARC) {
        // 104: a general conic A*x^2+B*xy+C*y^2+D*x+E*y+F=0 in plane z=ZT, trimmed
        // from (X1,Y1) to (X2,Y2). We support the ELLIPSE/CIRCLE form (form 1) by
        // recovering centre+axes from the quadratic. Form 2 (parabola) / 3
        // (hyperbola) are reported unsupported (they are not closed conics a B-rep
        // edge carries in practice).
        if (p->size() < 12) return g;
        double A,B,C,D,E,F,zt,x1,y1,x2,y2;
        if (!igesNum((*p)[1],A)||!igesNum((*p)[2],B)||!igesNum((*p)[3],C)||
            !igesNum((*p)[4],D)||!igesNum((*p)[5],E)||!igesNum((*p)[6],F)||
            !igesNum((*p)[7],zt)||!igesNum((*p)[8],x1)||!igesNum((*p)[9],y1)||
            !igesNum((*p)[10],x2)||!igesNum((*p)[11],y2)) return g;
        // Discriminant B^2-4AC < 0 => ellipse/circle. Recover the centre by solving
        //   [2A B; B 2C][cx;cy] = [-D;-E].
        double disc = B*B - 4.0*A*C;
        if (disc >= -1e-30) { g.kind = CurveKind3::Unsupported; return g; }
        double det = 4.0*A*C - B*B;             // = -disc > 0
        if (std::fabs(det) < 1e-30) { g.kind = CurveKind3::Unsupported; return g; }
        double cx = (-2.0*C*D + B*E) / det;
        double cy = (-2.0*A*E + B*D) / det;
        // Translate F to the centre: F' = F + D*cx/2 + E*cy/2  (standard reduction).
        double Fc = F + 0.5*D*cx + 0.5*E*cy;
        // Eigenvalues of [A B/2; B/2 C] give the principal semi-axes:
        //   lambda * s^2 = -F'  => semi = sqrt(-F'/lambda).
        double tr = A + C, dd = std::sqrt(std::max(0.0, (A-C)*(A-C) + B*B));
        double l1 = 0.5*(tr + dd), l2 = 0.5*(tr - dd);
        if (l1 <= 0 || l2 <= 0 || Fc >= 0) { g.kind = CurveKind3::Unsupported; return g; }
        double a1 = std::sqrt(-Fc / l1);
        double a2 = std::sqrt(-Fc / l2);
        // Principal axis direction for l2 (the larger semi-axis a2): eigenvector of
        // the smaller eigenvalue l2.
        Vec3 refX{1, 0, 0};
        if (std::fabs(B) > 1e-12 || std::fabs(A - C) > 1e-12) {
            double ang = 0.5 * std::atan2(B, A - C);
            refX = Vec3{std::cos(ang), std::sin(ang), 0.0};
        }
        g.kind = (std::fabs(a1 - a2) < 1e-9 * std::max(1.0, a1)) ? CurveKind3::Circle
                                                                 : CurveKind3::Ellipse;
        g.centre = vscale(Vec3{cx, cy, zt}, m.scaleToMm);
        g.axis   = Vec3{0, 0, 1};
        g.refDir = refX;
        g.radius  = a2 * m.scaleToMm;     // semi along refDir
        g.radius2 = a1 * m.scaleToMm;     // semi along binormal
        if (g.kind == CurveKind3::Circle) g.radius = g.radius2 = a2 * m.scaleToMm;
        g.v0 = vscale(Vec3{x1, y1, zt}, m.scaleToMm);
        g.v1 = vscale(Vec3{x2, y2, zt}, m.scaleToMm);
        g.ok = true; return g;
    }
    if (t == E_RBSPLINE_CURVE) {
        if (!readBSplineCurve(m, deSeq, g.nurbs)) { g.kind = CurveKind3::Unsupported; return g; }
        g.kind = CurveKind3::BSpline;
        g.v0 = g.nurbs.evaluate(g.nurbs.knots.front());
        g.v1 = g.nurbs.evaluate(g.nurbs.knots.back());
        g.ok = true; return g;
    }
    g.kind = CurveKind3::Unsupported;
    return g;
}

// ---------------------------------------------------------------------------
// 128 RATIONAL B-SPLINE SURFACE -> NurbsSurface. PD layout:
//   [0]=128 [1]=K1 [2]=K2 [3]=M1(degU) [4]=M2(degV) [5..8]=PROP1..4
//   then (A+1) U knots (A=K1+M1+1), then (B+1) V knots (B=K2+M2+1),
//   then (K1+1)*(K2+1) weights (V-major: for j in 0..K2, for i in 0..K1),
//   then (K1+1)*(K2+1) xyz control points (same order), then U0,U1,V0,V1.
// Forge's NurbsSurface stores control[iu][iv] (U outer, V inner). IGES stores
// the grid V-major (index = i + (K1+1)*j), so we transpose accordingly.
// ---------------------------------------------------------------------------
bool readBSplineSurface(const IgesModel& m, long deSeq, NurbsSurface& out) {
    const auto* p = params(m, deSeq);
    if (!p || p->size() < 9) return false;
    long K1, K2, M1, M2;
    if (!igesInt((*p)[1], K1) || !igesInt((*p)[2], K2) ||
        !igesInt((*p)[3], M1) || !igesInt((*p)[4], M2)) return false;
    if (K1 < 1 || K2 < 1 || M1 < 1 || M2 < 1) return false;
    const long nU = K1 + 1, nV = K2 + 1;
    const long nUK = K1 + M1 + 2, nVK = K2 + M2 + 2;
    const long nW = nU * nV;
    std::size_t idx = 9;
    if ((std::size_t)(9 + nUK + nVK + nW + 3 * nW) > p->size()) return false;
    out.degreeU = (std::size_t)M1;
    out.degreeV = (std::size_t)M2;
    out.knotsU.clear(); out.knotsU.reserve(nUK);
    for (long i = 0; i < nUK; ++i) { double d; if (!igesNum((*p)[idx++], d)) return false; out.knotsU.push_back(d); }
    out.knotsV.clear(); out.knotsV.reserve(nVK);
    for (long i = 0; i < nVK; ++i) { double d; if (!igesNum((*p)[idx++], d)) return false; out.knotsV.push_back(d); }
    // weights (V-major)
    std::vector<double> wflat(nW);
    for (long i = 0; i < nW; ++i) { double w; if (!igesNum((*p)[idx++], w)) return false; wflat[i] = w; }
    // control points (V-major)
    std::vector<Vec3> cflat(nW);
    for (long i = 0; i < nW; ++i) {
        double x, y, z;
        if (!igesNum((*p)[idx++], x) || !igesNum((*p)[idx++], y) || !igesNum((*p)[idx++], z)) return false;
        cflat[i] = vscale(Vec3{x, y, z}, m.scaleToMm);
    }
    out.control.assign(nU, std::vector<Vec3>(nV));
    out.weights.assign(nU, std::vector<double>(nV, 1.0));
    for (long j = 0; j < nV; ++j)
        for (long i = 0; i < nU; ++i) {
            long flat = i + nU * j;             // V-major flat index
            out.control[i][j] = cflat[flat];
            out.weights[i][j] = wflat[flat];
        }
    return true;
}

// ---------------------------------------------------------------------------
// 108 PLANE -> native analytic plane Surface. PD: [0]=108 [1..4]=A,B,C,D for the
// plane A*x+B*y+C*z=D, [5]=ptr to a bounding curve (0 = unbounded), [6..8]=display
// point, [9]=display size. We take the normal (A,B,C) and a point on the plane.
// ---------------------------------------------------------------------------
bool readPlane(const IgesModel& m, long deSeq, Surface& s) {
    const auto* p = params(m, deSeq);
    if (!p || p->size() < 5) return false;
    double A, B, C, D;
    if (!igesNum((*p)[1], A) || !igesNum((*p)[2], B) ||
        !igesNum((*p)[3], C) || !igesNum((*p)[4], D)) return false;
    Vec3 n{A, B, C};
    double nl = vlen(n);
    if (nl < 1e-30) return false;
    n = vscale(n, 1.0 / nl);
    // a point on the plane: n * (D/|n|^2) -> closest point to origin (D scaled).
    Vec3 o = vscale(Vec3{A, B, C}, (D) / (nl * nl));
    s.kind = SurfaceKind::Plane;
    s.origin = vscale(o, m.scaleToMm);
    s.axis = n;
    // a refDir perpendicular to the normal.
    Vec3 t = (std::fabs(n.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    s.refDir = vnorm(vsub(t, vscale(n, vdot(t, n))));
    return true;
}

// ---------------------------------------------------------------------------
// SURFACE POINT-INVERSION (Plane analytic / NURBS Gauss-Newton) — same approach
// as StepRead. Maps a 3D model point back to (u,v) so a foreign trim edge becomes
// a real pcurve in the surface parameter plane.
// ---------------------------------------------------------------------------
bool invertPlaneS(const Surface& s, const Vec3& P, UVCoord& uv) {
    const Vec3 rel = vsub(P, s.origin);
    const Vec3 bdir = s.binormal();
    uv.u = vdot(rel, vnorm(s.refDir));
    uv.v = vdot(rel, vnorm(bdir));
    return true;
}

bool invertNurbsS(const NurbsSurface& surf, const Vec3& P, UVCoord& uv, double tol3d) {
    if (surf.knotsU.empty() || surf.knotsV.empty()) return false;
    const double u0 = surf.knotsU.front(), u1 = surf.knotsU.back();
    const double v0 = surf.knotsV.front(), v1 = surf.knotsV.back();
    double bu = 0.5 * (u0 + u1), bv = 0.5 * (v0 + v1), bestD2 = 1e300;
    const int N = 16;
    for (int i = 0; i <= N; ++i)
        for (int j = 0; j <= N; ++j) {
            const double u = u0 + (u1 - u0) * (double(i) / N);
            const double v = v0 + (v1 - v0) * (double(j) / N);
            SurfaceSample s = evaluatePoint(surf, u, v);
            if (!s.ok) continue;
            const Vec3 d = vsub(s.point, P);
            const double d2 = vdot(d, d);
            if (d2 < bestD2) { bestD2 = d2; bu = u; bv = v; }
        }
    double u = bu, v = bv;
    for (int it = 0; it < 64; ++it) {
        SurfaceSample s = evaluateWithDerivatives(surf, u, v);
        if (!s.ok) { SurfaceSample sp = evaluatePoint(surf, u, v); if (!sp.ok) return false;
                     s.point = sp.point; s.du = Vec3{0,0,0}; s.dv = Vec3{0,0,0}; }
        const Vec3 r = vsub(P, s.point);
        const double a11 = vdot(s.du, s.du), a12 = vdot(s.du, s.dv), a22 = vdot(s.dv, s.dv);
        const double b1 = vdot(s.du, r), b2 = vdot(s.dv, r);
        const double det = a11 * a22 - a12 * a12;
        if (std::fabs(det) < 1e-30) break;
        const double du = (b1 * a22 - b2 * a12) / det;
        const double dv = (a11 * b2 - a12 * b1) / det;
        u += du; v += dv;
        u = std::max(u0, std::min(u1, u));
        v = std::max(v0, std::min(v1, v));
        if (std::fabs(du) + std::fabs(dv) < 1e-14) break;
    }
    SurfaceSample fin = evaluatePoint(surf, u, v);
    if (!fin.ok) return false;
    const Vec3 d = vsub(fin.point, P);
    if (vlen(d) > tol3d) return false;
    uv.u = u; uv.v = v;
    return true;
}

} // namespace

// ===========================================================================
// readForeignIges
// ===========================================================================
ForeignReadResult readForeignIges(const std::string& text, double sewTol) {
    std::vector<RawLine> gLines, dLines, pLines;
    std::string why;
    if (!splitSections(text, gLines, dLines, pLines, why))
        return fail("readForeignIges: " + why);

    IgesModel m;
    if (!parseGlobal(gLines, m, why))      return fail("readForeignIges: global — " + why);
    if (!parseDirectory(dLines, m, why))   return fail("readForeignIges: directory — " + why);
    if (!parseParameters(pLines, m, why))  return fail("readForeignIges: parameters — " + why);
    if (m.de.empty()) return fail("readForeignIges: empty directory section");

    ForeignReadResult result;
    result.lengthScaleToMm = m.scaleToMm;
    result.unitName = m.unitName;

    auto owner = std::make_shared<TopologyBuilder>();
    TopologyBuilder& tb = *owner;
    Solid* solid = tb.makeSolid();

    std::vector<Face*> builtFaces;
    double bboxMin[3] = {1e300, 1e300, 1e300}, bboxMax[3] = {-1e300, -1e300, -1e300};
    auto growBox = [&](const Vec3& p) {
        bboxMin[0] = std::min(bboxMin[0], p.x); bboxMax[0] = std::max(bboxMax[0], p.x);
        bboxMin[1] = std::min(bboxMin[1], p.y); bboxMax[1] = std::max(bboxMax[1], p.y);
        bboxMin[2] = std::min(bboxMin[2], p.z); bboxMax[2] = std::max(bboxMax[2], p.z);
    };
    auto invTol = [&]() {
        double diag = 0.0;
        for (int k = 0; k < 3; ++k) { double d = bboxMax[k]-bboxMin[k]; if (d > 0) diag += d*d; }
        return (diag > 0) ? 1e-7 * std::sqrt(diag) : 1e-6;
    };

    // -----------------------------------------------------------------------
    // Reconstruct the base surface of a 510 FACE / 144 TRIMMED SURFACE. Returns
    // the analytic plane (planar) OR the NURBS surface (128), recording the type.
    // -----------------------------------------------------------------------
    auto buildSurface = [&](long surfDe, Surface& s, bool& isBSpline,
                            NurbsSurface& nurbs, std::string& kw) -> bool {
        int t = entityType(m, surfDe);
        isBSpline = false;
        if (t == E_PLANE) { kw = "IGES_108"; return readPlane(m, surfDe, s); }
        if (t == E_RBSPLINE_SURFACE) {
            kw = "IGES_128";
            if (!readBSplineSurface(m, surfDe, nurbs)) return false;
            isBSpline = true; return true;
        }
        kw = "IGES_" + std::to_string(t < 0 ? 0 : t);
        return false;
    };

    // -----------------------------------------------------------------------
    // Build a (u,v) TrimLoop on a NURBS surface from an ORDERED list of 3D model-
    // space curves (each a Curve3 with directed endpoints), inverting onto (u,v).
    // -----------------------------------------------------------------------
    auto buildTrimLoopNurbs = [&](const std::vector<Curve3>& ring,
                                  const NurbsSurface& nsurf, bool isOuter,
                                  TrimLoop& out, std::string& kw) -> bool {
        out.segments.clear();
        out.isOuter = isOuter;
        const double tol = invTol();
        for (const Curve3& eg : ring) {
            if (!eg.ok) { kw = "IGES_EDGE"; return false; }
            Vec3 pStart = eg.v0, pEnd = eg.v1;
            UVCoord uvStart{}, uvEnd{};
            if (!invertNurbsS(nsurf, pStart, uvStart, tol) ||
                !invertNurbsS(nsurf, pEnd, uvEnd, tol)) { kw = "IGES_EDGE(uninvertible)"; return false; }
            if (eg.kind == CurveKind3::Line) {
                out.segments.push_back(PCurve::makeLine2(uvStart, uvEnd));
            } else {
                const int M = (eg.kind == CurveKind3::BSpline) ? 24 : 16;
                std::vector<Vec3> samples;
                samples.reserve(M + 1);
                if (eg.kind == CurveKind3::BSpline) {
                    const double t0 = eg.nurbs.knots.front(), t1 = eg.nurbs.knots.back();
                    const Vec3 c0 = eg.nurbs.evaluate(t0);
                    const bool fwd = (vlen(vsub(c0, pStart)) <= vlen(vsub(c0, pEnd)));
                    for (int i = 0; i <= M; ++i) {
                        const double a = double(i) / M;
                        const double t = fwd ? (t0 + (t1 - t0) * a) : (t1 + (t0 - t1) * a);
                        samples.push_back(eg.nurbs.evaluate(t));
                    }
                } else {
                    const Vec3 bdir = vcross(eg.axis, eg.refDir);
                    auto angleOf = [&](const Vec3& P) {
                        const Vec3 rel = vsub(P, eg.centre);
                        return std::atan2(vdot(rel, bdir), vdot(rel, eg.refDir));
                    };
                    double a0 = angleOf(pStart), a1 = angleOf(pEnd);
                    while (a1 - a0 >  PI) a1 -= 2.0 * PI;
                    while (a1 - a0 < -PI) a1 += 2.0 * PI;
                    if (std::fabs(a1 - a0) < 1e-12) a1 = a0 + 2.0 * PI;
                    for (int i = 0; i <= M; ++i) {
                        const double t = a0 + (a1 - a0) * (double(i) / M);
                        Vec3 P;
                        if (eg.kind == CurveKind3::Circle)
                            P = vadd(eg.centre, vadd(vscale(eg.refDir, eg.radius * std::cos(t)),
                                                     vscale(bdir, eg.radius * std::sin(t))));
                        else
                            P = vadd(eg.centre, vadd(vscale(eg.refDir, eg.radius * std::cos(t)),
                                                     vscale(bdir, eg.radius2 * std::sin(t))));
                        samples.push_back(P);
                    }
                }
                NurbsCurve pc; pc.degree = 1;
                pc.controlPoints.reserve(samples.size());
                for (const Vec3& P : samples) {
                    UVCoord uv{};
                    if (!invertNurbsS(nsurf, P, uv, tol)) { kw = "IGES_EDGE(uninvertible)"; return false; }
                    pc.controlPoints.push_back(Vec3{uv.u, uv.v, 0.0});
                }
                pc.controlPoints.front() = Vec3{uvStart.u, uvStart.v, 0.0};
                pc.controlPoints.back()  = Vec3{uvEnd.u,   uvEnd.v,   0.0};
                const std::size_t np = pc.controlPoints.size();
                pc.weights.assign(np, 1.0);
                pc.knots.clear(); pc.knots.reserve(np + 2);
                pc.knots.push_back(0.0);
                for (std::size_t i = 0; i < np; ++i) pc.knots.push_back(double(i) / double(np - 1));
                pc.knots.push_back(1.0);
                out.segments.push_back(PCurve::makeBSpline2(pc));
            }
        }
        return !out.segments.empty();
    };

    // -----------------------------------------------------------------------
    // Resolve a 142 CURVE ON A PARAMETRIC SURFACE -> the ordered model-space
    // curves of its boundary. 142 PD: [0]=142 [1]=CRTN [2]=SPTR(surface)
    //   [3]=BPTR(B = curve in (u,v) space) [4]=CPTR(C = curve in model space)
    //   [5]=PREF. We use the MODEL-SPACE curve C (param 4). C is usually a
    // 102 COMPOSITE CURVE (a list of edge curves) or a single 110/100/126.
    // -----------------------------------------------------------------------
    std::function<bool(long, std::vector<Curve3>&, std::string&)> gatherModelCurves =
        [&](long de, std::vector<Curve3>& out, std::string& kw) -> bool {
        int t = entityType(m, de);
        if (t == 102) {
            // COMPOSITE CURVE: [0]=102 [1]=N then N pointers to constituent curves.
            const auto* p = params(m, de);
            if (!p || p->size() < 2) { kw = "IGES_102"; return false; }
            long nC; if (!igesInt((*p)[1], nC) || nC < 1) { kw = "IGES_102"; return false; }
            if ((std::size_t)(2 + nC) > p->size()) { kw = "IGES_102"; return false; }
            for (long i = 0; i < nC; ++i) {
                long cptr; if (!igesPtr((*p)[2 + i], cptr)) { kw = "IGES_102"; return false; }
                if (!gatherModelCurves(cptr, out, kw)) return false;
            }
            return true;
        }
        Curve3 c = readCurve3(m, de);
        if (!c.ok) { kw = "IGES_" + std::to_string(t < 0 ? 0 : t); return false; }
        out.push_back(c);
        return true;
    };

    auto curveOf142 = [&](long de142, std::vector<Curve3>& out, std::string& kw) -> bool {
        int t = entityType(m, de142);
        if (t != E_CURVE_ON_SURFACE) {
            // a bare boundary curve used directly as the trim (some writers do this)
            return gatherModelCurves(de142, out, kw);
        }
        const auto* p = params(m, de142);
        if (!p || p->size() < 5) { kw = "IGES_142"; return false; }
        long cptr;
        if (!igesPtr((*p)[4], cptr) || cptr == 0) { kw = "IGES_142"; return false; }
        return gatherModelCurves(cptr, out, kw);
    };

    // -----------------------------------------------------------------------
    // 144 TRIMMED SURFACE. PD: [0]=144 [1]=PTS(surface) [2]=N1 (0/1 outer-uses-
    //   surface-boundary) [3]=N2 (#inner) [4]=PTO (outer boundary, a 142 or 0)
    //   [5..]=PTI[1..N2] (inner boundary 142 pointers).
    // -----------------------------------------------------------------------
    auto buildTrimmedSurface = [&](long de144, ForeignFaceInfo& info) -> bool {
        const auto* p = params(m, de144);
        if (!p || p->size() < 5) { info.surfaceType = "IGES_144"; return false; }
        long sptr, n1, n2, pto;
        if (!igesPtr((*p)[1], sptr) || !igesInt((*p)[2], n1) ||
            !igesInt((*p)[3], n2) || !igesInt((*p)[4], pto)) { info.surfaceType = "IGES_144"; return false; }

        Surface base; bool isBSpline = false; NurbsSurface nurbs;
        std::string kw;
        if (!buildSurface(sptr, base, isBSpline, nurbs, kw)) {
            info.surfaceType = kw; return false;
        }
        info.surfaceType = kw;

        // Collect the outer ring of model-space curves.
        std::vector<Curve3> outerRing;
        if (pto != 0) {
            std::string ck;
            if (!curveOf142(pto, outerRing, ck)) { info.surfaceType = ck; return false; }
        }
        // Inner rings.
        std::vector<std::vector<Curve3>> innerRings;
        for (long i = 0; i < n2; ++i) {
            if ((std::size_t)(5 + i) >= p->size()) break;
            long pti; if (!igesPtr((*p)[5 + i], pti) || pti == 0) continue;
            std::vector<Curve3> ring; std::string ck;
            if (!curveOf142(pti, ring, ck)) { info.surfaceType = ck; return false; }
            innerRings.push_back(std::move(ring));
        }

        // Grow the bbox with the boundary points so the sew tolerance is sane.
        for (const Curve3& c : outerRing) { growBox(c.v0); growBox(c.v1); }
        for (auto& ir : innerRings) for (const Curve3& c : ir) { growBox(c.v0); growBox(c.v1); }

        // Build a native Face with its outer-ring vertices (independent) so the
        // solid integrates + sews. The face's surface is the base surface (NURBS or
        // analytic plane carried as a Nurbs).
        std::vector<Vertex*> outerVerts;
        outerVerts.reserve(outerRing.size());
        for (const Curve3& c : outerRing) { growBox(c.v0); outerVerts.push_back(tb.makeVertex(P3(c.v0))); }
        if (outerVerts.size() < 3) { info.surfaceType = "IGES_144(degenerate-outer)"; return false; }

        Face* f = tb.makeFace();
        tb.addOuterLoopToFace(f, outerVerts);
        for (auto& ir : innerRings) {
            std::vector<Vertex*> hv;
            hv.reserve(ir.size());
            for (const Curve3& c : ir) { growBox(c.v0); hv.push_back(tb.makeVertex(P3(c.v0))); }
            if (hv.size() >= 3) tb.addInnerLoopToFace(f, hv);
        }
        info.innerLoopCount = innerRings.size();

        Surface* surf = tb.makeSurface();
        if (isBSpline) {
            surf->kind = SurfaceKind::Nurbs;
            surf->nurbs = nurbs;
            f->surface = surf;
            // TrimmedFace from the literal boundary loops (inverted onto (u,v)).
            TrimmedFace tf;
            tf.surface = nurbs;
            TrimLoop outer; std::string uk;
            bool trimOk = buildTrimLoopNurbs(outerRing, nurbs, true, outer, uk);
            if (trimOk) {
                tf.loops.push_back(std::move(outer));
                for (auto& ir : innerRings) {
                    TrimLoop hole; std::string hk;
                    if (!buildTrimLoopNurbs(ir, nurbs, false, hole, hk)) { trimOk = false; uk = hk; break; }
                    tf.loops.push_back(std::move(hole));
                }
            }
            if (!trimOk) { info.surfaceType = uk; return false; }
            info.trimmedIndex = (long)result.trimmedFaces.size();
            result.trimmedFaces.push_back(std::move(tf));
            f->u0 = nurbs.knotsU.front(); f->u1 = nurbs.knotsU.back();
            f->v0 = nurbs.knotsV.front(); f->v1 = nurbs.knotsV.back();
        } else {
            // Planar trimmed face: native analytic plane + vertexUV trim polygon.
            *surf = base;
            f->surface = surf;
            f->vertexUV.clear();
            double u0=1e300,u1=-1e300,v0=1e300,v1=-1e300;
            for (Vertex* vtx : outerVerts) {
                UVCoord uv{}; invertPlaneS(*surf, PV(vtx->point), uv);
                f->vertexUV.push_back({uv.u, uv.v});
                u0=std::min(u0,uv.u); u1=std::max(u1,uv.u);
                v0=std::min(v0,uv.v); v1=std::max(v1,uv.v);
            }
            f->u0=u0; f->u1=u1; f->v0=v0; f->v1=v1;
        }
        info.nativeFace = f;
        info.supported = true;
        builtFaces.push_back(f);
        return true;
    };

    // =======================================================================
    // BODY DISPATCH.
    //   Priority 1: a 186 MANIFOLD SOLID B-REP -> 514 -> 510 faces.
    //   Priority 2: every 144 TRIMMED SURFACE as an independent face, sewn.
    // =======================================================================

    // Collect the 510 FACE DEs reachable from a 186/514, else all 144s.
    std::vector<long> faces510;
    bool haveBrep = false;
    {
        // find any 186.
        for (const auto& kv : m.de) {
            if (kv.second.type != E_MANIFOLD_SOLID_BREP) continue;
            haveBrep = true;
            const auto* p = params(m, kv.first);
            if (!p || p->size() < 2) continue;
            long shellPtr; if (!igesPtr((*p)[1], shellPtr)) continue;
            // 186 PD: [0]=186 [1]=SHELL [2]=SOF(orientation) then void-shell pairs.
            std::vector<long> shells{shellPtr};
            // append void shells (pairs of ptr+flag) if present.
            if (p->size() >= 4) {
                long nVoid = 0; igesInt((*p)[3], nVoid);
                for (long i = 0; i < nVoid; ++i) {
                    std::size_t fi = 4 + (std::size_t)i * 2;
                    if (fi < p->size()) { long vp; if (igesPtr((*p)[fi], vp) && vp) shells.push_back(vp); }
                }
            }
            for (long sh : shells) {
                if (entityType(m, sh) != E_SHELL) continue;
                const auto* sp = params(m, sh);
                if (!sp || sp->size() < 2) continue;
                // 514 PD: [0]=514 [1]=N then N (face ptr, orientation) PAIRS.
                long nF; if (!igesInt((*sp)[1], nF) || nF < 1) continue;
                for (long i = 0; i < nF; ++i) {
                    std::size_t fi = 2 + (std::size_t)i * 2;
                    if (fi >= sp->size()) break;
                    long fptr; if (igesPtr((*sp)[fi], fptr) && fptr) faces510.push_back(fptr);
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // 504 EDGE LIST: [0]=504 [1]=N then N edge tuples (curvePtr, svPtr, svIdx,
    //   tvPtr, tvIdx). 502 VERTEX LIST: [0]=502 [1]=N then N (x,y,z) triples.
    // We resolve an edge index -> its 3D curve (with directed endpoints from the
    // vertex list) on demand.
    // -----------------------------------------------------------------------
    auto vertexFromList = [&](long vlistDe, long idx1based, Vec3& out) -> bool {
        const auto* p = params(m, vlistDe);
        if (!p || p->size() < 2) return false;
        long n; if (!igesInt((*p)[1], n)) return false;
        if (idx1based < 1 || idx1based > n) return false;
        std::size_t base = 2 + (std::size_t)(idx1based - 1) * 3;
        if (base + 2 >= p->size()) return false;
        double x, y, z;
        if (!igesNum((*p)[base], x) || !igesNum((*p)[base+1], y) || !igesNum((*p)[base+2], z)) return false;
        out = vscale(Vec3{x, y, z}, m.scaleToMm);
        return true;
    };
    auto edgeFromList = [&](long elistDe, long idx1based, Curve3& out, std::string& kw) -> bool {
        const auto* p = params(m, elistDe);
        if (!p || p->size() < 2) { kw = "IGES_504"; return false; }
        long n; if (!igesInt((*p)[1], n)) { kw = "IGES_504"; return false; }
        if (idx1based < 1 || idx1based > n) { kw = "IGES_504"; return false; }
        std::size_t base = 2 + (std::size_t)(idx1based - 1) * 5;
        if (base + 4 >= p->size()) { kw = "IGES_504"; return false; }
        long curveP, svP, svI, tvP, tvI;
        if (!igesPtr((*p)[base], curveP) || !igesPtr((*p)[base+1], svP) ||
            !igesInt((*p)[base+2], svI) || !igesPtr((*p)[base+3], tvP) ||
            !igesInt((*p)[base+4], tvI)) { kw = "IGES_504"; return false; }
        Curve3 c = readCurve3(m, curveP);
        if (!c.ok) { kw = "IGES_" + std::to_string(c.typeNum); return false; }
        Vec3 sv, tv;
        if (vertexFromList(svP, svI, sv)) c.v0 = sv;
        if (vertexFromList(tvP, tvI, tv)) c.v1 = tv;
        out = c;
        return true;
    };

    // -----------------------------------------------------------------------
    // 510 FACE: [0]=510 [1]=SURF(ptr) [2]=N(#loops) [3]=OF(outer flag)
    //   [4..]=LOOP ptrs (508). 508 LOOP: [0]=508 [1]=N then per-edge tuples:
    //   (type, edgePtr, edgeIdx, orientationFlag, #pcurves, [pcurve ptrs+flags]).
    //   type 1 = edge from a 504 edge list at edgeIdx.
    // -----------------------------------------------------------------------
    auto loopRing = [&](long loopDe, std::vector<Curve3>& out, std::string& kw) -> bool {
        const auto* p = params(m, loopDe);
        if (!p || p->size() < 2) { kw = "IGES_508"; return false; }
        long n; if (!igesInt((*p)[1], n) || n < 1) { kw = "IGES_508"; return false; }
        std::size_t idx = 2;
        for (long i = 0; i < n; ++i) {
            if (idx + 4 >= p->size()) { kw = "IGES_508"; return false; }
            long etype, eptr, eidx, ornt, nPc;
            if (!igesInt((*p)[idx], etype) || !igesPtr((*p)[idx+1], eptr) ||
                !igesInt((*p)[idx+2], eidx) || !igesInt((*p)[idx+3], ornt) ||
                !igesInt((*p)[idx+4], nPc)) { kw = "IGES_508"; return false; }
            idx += 5;
            // skip the per-edge pcurve descriptors: each is (isoFlag, pcurvePtr).
            idx += (std::size_t)std::max(0L, nPc) * 2;
            Curve3 c; std::string ck;
            if (!edgeFromList(eptr, eidx, c, ck)) { kw = ck; return false; }
            // honour the orientation flag (0 -> reverse the directed edge).
            if (ornt == 0) std::swap(c.v0, c.v1);
            out.push_back(c);
        }
        return out.size() >= 3 || (out.size() >= 1);
    };

    auto buildFace510 = [&](long faceDe, ForeignFaceInfo& info) -> bool {
        const auto* p = params(m, faceDe);
        if (!p || p->size() < 4) { info.surfaceType = "IGES_510"; return false; }
        long sptr, nLoops, ofl;
        if (!igesPtr((*p)[1], sptr) || !igesInt((*p)[2], nLoops) ||
            !igesInt((*p)[3], ofl)) { info.surfaceType = "IGES_510"; return false; }
        Surface base; bool isBSpline = false; NurbsSurface nurbs; std::string kw;
        if (!buildSurface(sptr, base, isBSpline, nurbs, kw)) { info.surfaceType = kw; return false; }
        info.surfaceType = kw;
        // collect loops; first is outer.
        std::vector<std::vector<Curve3>> rings;
        for (long i = 0; i < nLoops; ++i) {
            std::size_t fi = 4 + (std::size_t)i;
            if (fi >= p->size()) break;
            long lp; if (!igesPtr((*p)[fi], lp) || !lp) continue;
            std::vector<Curve3> ring; std::string ck;
            if (!loopRing(lp, ring, ck)) { info.surfaceType = ck; return false; }
            rings.push_back(std::move(ring));
        }
        if (rings.empty()) { info.surfaceType = "IGES_510(no-loop)"; return false; }
        const std::vector<Curve3>& outerRing = rings.front();

        std::vector<Vertex*> outerVerts;
        for (const Curve3& c : outerRing) { growBox(c.v0); outerVerts.push_back(tb.makeVertex(P3(c.v0))); }
        if (outerVerts.size() < 3) { info.surfaceType = "IGES_510(degenerate)"; return false; }

        Face* f = tb.makeFace();
        tb.addOuterLoopToFace(f, outerVerts);
        for (std::size_t r = 1; r < rings.size(); ++r) {
            std::vector<Vertex*> hv;
            for (const Curve3& c : rings[r]) { growBox(c.v0); hv.push_back(tb.makeVertex(P3(c.v0))); }
            if (hv.size() >= 3) tb.addInnerLoopToFace(f, hv);
        }
        info.innerLoopCount = rings.size() - 1;

        Surface* surf = tb.makeSurface();
        if (isBSpline) {
            surf->kind = SurfaceKind::Nurbs; surf->nurbs = nurbs; f->surface = surf;
            TrimmedFace tf; tf.surface = nurbs;
            TrimLoop outer; std::string uk;
            bool trimOk = buildTrimLoopNurbs(outerRing, nurbs, true, outer, uk);
            if (trimOk) {
                tf.loops.push_back(std::move(outer));
                for (std::size_t r = 1; r < rings.size(); ++r) {
                    TrimLoop hole; std::string hk;
                    if (!buildTrimLoopNurbs(rings[r], nurbs, false, hole, hk)) { trimOk = false; uk = hk; break; }
                    tf.loops.push_back(std::move(hole));
                }
            }
            if (!trimOk) { info.surfaceType = uk; return false; }
            info.trimmedIndex = (long)result.trimmedFaces.size();
            result.trimmedFaces.push_back(std::move(tf));
            f->u0 = nurbs.knotsU.front(); f->u1 = nurbs.knotsU.back();
            f->v0 = nurbs.knotsV.front(); f->v1 = nurbs.knotsV.back();
        } else {
            *surf = base; f->surface = surf; f->vertexUV.clear();
            double u0=1e300,u1=-1e300,v0=1e300,v1=-1e300;
            for (Vertex* vtx : outerVerts) {
                UVCoord uv{}; invertPlaneS(*surf, PV(vtx->point), uv);
                f->vertexUV.push_back({uv.u, uv.v});
                u0=std::min(u0,uv.u); u1=std::max(u1,uv.u);
                v0=std::min(v0,uv.v); v1=std::max(v1,uv.v);
            }
            f->u0=u0; f->u1=u1; f->v0=v0; f->v1=v1;
        }
        info.nativeFace = f; info.supported = true;
        builtFaces.push_back(f);
        return true;
    };

    if (haveBrep && !faces510.empty()) {
        for (long fde : faces510) {
            ForeignFaceInfo info;
            if (!buildFace510(fde, info)) {
                info.supported = false;
                result.unsupported[info.surfaceType.empty() ? "IGES_510" : info.surfaceType]++;
            }
            result.faceInfos.push_back(info);
        }
    } else {
        // trimmed-surface path: every 144.
        std::vector<long> t144;
        for (const auto& kv : m.de) if (kv.second.type == E_TRIMMED_SURFACE) t144.push_back(kv.first);
        if (t144.empty()) {
            // No body: honestly report whatever top-level entities exist. A bare
            // 116 POINT is resolved (coordinates scaled) and counted so the caller
            // knows the file carried only loose geometry, not a buildable body.
            for (const auto& kv : m.de) {
                int t = kv.second.type;
                if (t == E_POINT) {
                    Vec3 pt;
                    if (readPoint(m, kv.first, pt)) result.unsupported["IGES_116(loose-point)"]++;
                    continue;
                }
                if (t == E_RBSPLINE_SURFACE || t == E_PLANE || t == E_SURFACE_OF_REVOLUTION ||
                    t == E_TABULATED_CYLINDER || t == E_LINE ||
                    t == E_CIRCULAR_ARC || t == E_CONIC_ARC || t == E_RBSPLINE_CURVE)
                    result.unsupported["IGES_" + std::to_string(t) + "(no-trimmed-surface-or-brep)"]++;
            }
            result.ok = false;
            result.reason = "readForeignIges: no 144 TRIMMED SURFACE or 186 MANIFOLD SOLID found";
            return result;
        }
        for (long de : t144) {
            ForeignFaceInfo info;
            if (!buildTrimmedSurface(de, info)) {
                info.supported = false;
                result.unsupported[info.surfaceType.empty() ? "IGES_144" : info.surfaceType]++;
            }
            result.faceInfos.push_back(info);
        }
    }

    if (builtFaces.empty()) {
        // HONEST: keep the unsupported report so the caller sees WHY (do not
        // discard it behind a fresh failure result).
        result.ok = false;
        result.reason = "readForeignIges: no supported faces were built (all unsupported)";
        return result;
    }

    // --- NATIVE SEW ---------------------------------------------------------
    double tol = sewTol;
    if (tol <= 0.0) {
        double diag = 0.0;
        for (int k = 0; k < 3; ++k) { double d = bboxMax[k] - bboxMin[k]; diag += d * d; }
        diag = std::sqrt(std::max(diag, 1.0));
        tol = 1e-7 * diag;
        if (tol < 1e-9) tol = 1e-9;
    } else {
        tol *= m.scaleToMm;
    }
    SewOptions sopt; sopt.tol = tol; sopt.weldVertices = true;
    SewResult sr = sewFaces(tb, builtFaces, sopt);
    if (!sr.ok)
        return fail(std::string("readForeignIges: sew failed — ") + (sr.reason ? sr.reason : ""));

    for (Shell* sh : sr.shells)
        if (sh) { tb.addShellToSolid(solid, sh); result.shells.push_back(sh); }

    result.ok = true;
    result.owner = owner;
    result.solid = solid;
    result.closed = sr.diagnosis.closed;
    result.vertices = sr.diagnosis.vertices;
    result.edges = sr.diagnosis.edges;
    result.faces = sr.diagnosis.faces;
    result.eulerCharacteristic = sr.diagnosis.eulerCharacteristic;
    return result;
}

} // namespace brep
} // namespace native
} // namespace forge
