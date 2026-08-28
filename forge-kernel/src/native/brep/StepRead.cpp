// forge/native/brep/StepRead.cpp
//
// Implementation of the FOREIGN STEP reader (StepRead.hpp). Pure C++20, standard
// library + forge native headers only. No OCCT, no WASM.
//
// PIPELINE
//   1. Lex the ISO-10303-21 envelope + DATA section into an id->Instance table
//      (StepPart21.hpp). Complex/combined instances "#id=(A(..)B(..))" are stored
//      with empty type and the whole "(...)" string as params; this reader DECODES
//      them (the rational-B-spline + unit complex records that every commercial
//      exporter emits) by splitting the top-level sub-records.
//   2. Resolve the length unit from the GEOMETRIC_REPRESENTATION_CONTEXT so every
//      CARTESIAN_POINT is scaled to millimetres.
//   3. Walk every shell-bearing root (MANIFOLD_SOLID_BREP / BREP_WITH_VOIDS /
//      SHELL_BASED_SURFACE_MODEL / MANIFOLD_SURFACE_SHAPE_REPRESENTATION) -> its
//      CLOSED_SHELL/OPEN_SHELL -> ADVANCED_FACEs.
//   4. Per ADVANCED_FACE: reconstruct the surface; build the outer + inner loops
//      as an INDEPENDENT native face (private vertices/edges). Quadric faces are
//      native analytic Surfaces (EXACT mass props); B-spline faces become a
//      TrimmedFace + a native Nurbs Surface so the solid integrates and the patch
//      area round-trips. Unsupported surfaces are RECORDED (never faked/dropped).
//   5. SEW (Sew.hpp) all faces into a connected shell; diagnose closure + the
//      V/E/F topology signature.

#include "forge/native/brep/StepRead.hpp"

#include "forge/native/brep/StepPart21.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsSurface.hpp"
#include "forge/native/brep/Curve.hpp"
#include "forge/native/brep/Sew.hpp"
#include "forge/native/brep/StepWatertight.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

using p21::Instance;
using p21::splitTopLevel;
using p21::parseRef;
using p21::parseList;
using p21::stepNum;

constexpr double PI = 3.14159265358979323846;

inline Vec3 PV(const Point3& p) { return Vec3{p.x, p.y, p.z}; }
inline Point3 P3(const Vec3& v) { return Point3{v.x, v.y, v.z}; }

ForeignReadResult fail(const std::string& why) {
    ForeignReadResult r; r.ok = false; r.reason = why; return r;
}

// ---------------------------------------------------------------------------
// COMPLEX / SIMPLE instance access. A complex instance "#id=(A(..)B(..))" is
// stored by the lexer with type "" and params == "(A(..)B(..))" (note the outer
// parens are part of params because the lexer captured them as the balanced
// group). We expose the sub-records keyed by their type keyword.
// ---------------------------------------------------------------------------
struct SubRecord { std::string type; std::string params; };

// Split a complex-instance param string "(A(..)B(..)C(..))" — or the bare inner
// "A(..)B(..)C(..)" — into its typed sub-records. Returns empty for a simple one.
std::vector<SubRecord> splitComplex(const std::string& rawParams) {
    std::string s = rawParams;
    // Strip one layer of outer parens if present.
    {
        std::size_t b = 0, e = s.size();
        while (b < e && (s[b] == ' ' || s[b] == '\n' || s[b] == '\t' || s[b] == '\r')) ++b;
        while (e > b && (s[e-1] == ' ' || s[e-1] == '\n' || s[e-1] == '\t' || s[e-1] == '\r')) --e;
        s = s.substr(b, e - b);
        if (!s.empty() && s.front() == '(' && s.back() == ')') s = s.substr(1, s.size() - 2);
    }
    std::vector<SubRecord> out;
    std::size_t i = 0, n = s.size();
    while (i < n) {
        while (i < n && (s[i] == ' ' || s[i] == '\n' || s[i] == '\t' || s[i] == '\r')) ++i;
        if (i >= n) break;
        // a type keyword [A-Z0-9_]+
        std::size_t tb = i;
        while (i < n && (s[i] == '_' || (s[i] >= 'A' && s[i] <= 'Z') ||
                         (s[i] >= '0' && s[i] <= '9'))) ++i;
        if (i == tb) break;                 // not a complex record
        std::string type = s.substr(tb, i - tb);
        while (i < n && (s[i] == ' ' || s[i] == '\n')) ++i;
        if (i >= n || s[i] != '(') break;   // malformed
        // balanced parens
        int depth = 0; bool inStr = false; std::size_t j = i;
        for (; j < n; ++j) {
            char c = s[j];
            if (inStr) { if (c == '\'') { if (j+1 < n && s[j+1]=='\'') ++j; else inStr=false; } continue; }
            if (c == '\'') inStr = true;
            else if (c == '(') ++depth;
            else if (c == ')') { --depth; if (depth == 0) break; }
        }
        if (j >= n) break;
        std::string params = s.substr(i + 1, j - (i + 1));
        out.push_back({std::move(type), std::move(params)});
        i = j + 1;
    }
    return out;
}

// Resolve the EFFECTIVE type + params of an instance id, transparently looking
// inside a complex record for the sub-record matching `wantedTypes` (any of). For
// a simple instance, just returns its type/params. Returns false if not found.
struct Resolver {
    const std::unordered_map<std::uint64_t, Instance>& tab;

    bool get(std::uint64_t id, Instance& out) const {
        auto it = tab.find(id);
        if (it == tab.end()) return false;
        out = it->second;
        return true;
    }

    // Return the simple type (or "" for a complex record).
    std::string typeOf(std::uint64_t id) const {
        auto it = tab.find(id);
        if (it == tab.end()) return "";
        return it->second.type;
    }
};

// Resolve a CARTESIAN_POINT id -> Vec3 (unscaled, raw file units).
bool getPoint(const Resolver& R, std::uint64_t id, Vec3& out) {
    Instance ins; if (!R.get(id, ins)) return false;
    if (ins.type != "CARTESIAN_POINT") return false;
    auto p = splitTopLevel(ins.params);
    std::vector<std::string> c;
    if (p.size() < 2 || !parseList(p[1], c) || c.size() < 3) return false;
    return stepNum(c[0], out.x) && stepNum(c[1], out.y) && stepNum(c[2], out.z);
}

// Resolve a DIRECTION id -> Vec3.
bool getDir(const Resolver& R, std::uint64_t id, Vec3& out) {
    Instance ins; if (!R.get(id, ins)) return false;
    if (ins.type != "DIRECTION") return false;
    auto p = splitTopLevel(ins.params);
    std::vector<std::string> c;
    if (p.size() < 2 || !parseList(p[1], c) || c.size() < 3) return false;
    return stepNum(c[0], out.x) && stepNum(c[1], out.y) && stepNum(c[2], out.z);
}

// Resolve AXIS2_PLACEMENT_3D -> (origin, axis(+Z), ref(+X)). Ref defaults to a
// perpendicular of axis when absent ('$'). Origin is left in raw file units.
bool getAxis2(const Resolver& R, std::uint64_t id, Vec3& origin, Vec3& axis, Vec3& ref) {
    Instance ins; if (!R.get(id, ins)) return false;
    if (ins.type != "AXIS2_PLACEMENT_3D") return false;
    auto p = splitTopLevel(ins.params);
    if (p.size() < 4) return false;
    std::uint64_t oId = 0, aId = 0, rId = 0;
    if (!parseRef(p[1], oId) || !getPoint(R, oId, origin)) return false;
    if (parseRef(p[2], aId)) { if (!getDir(R, aId, axis)) return false; }
    else axis = Vec3{0, 0, 1};
    if (parseRef(p[3], rId)) { if (!getDir(R, rId, ref)) return false; }
    else {
        Vec3 a = vnorm(axis);
        Vec3 t = (std::fabs(a.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
        ref = vnorm(vsub(t, vscale(a, vdot(t, a))));
    }
    axis = vnorm(axis);
    ref = vnorm(vsub(ref, vscale(axis, vdot(ref, axis))));
    return true;
}

// Resolve AXIS1_PLACEMENT -> (location, axis dir). Location left in raw file units.
bool getAxis1(const Resolver& R, std::uint64_t id, Vec3& loc, Vec3& axis) {
    Instance ins; if (!R.get(id, ins)) return false;
    if (ins.type != "AXIS1_PLACEMENT") return false;
    auto p = splitTopLevel(ins.params);
    if (p.size() < 2) return false;
    std::uint64_t oId = 0, aId = 0;
    if (!parseRef(p[1], oId) || !getPoint(R, oId, loc)) return false;
    if (p.size() >= 3 && parseRef(p[2], aId)) { if (!getDir(R, aId, axis)) return false; }
    else axis = Vec3{0, 0, 1};
    axis = vnorm(axis);
    return true;
}

// ---------------------------------------------------------------------------
// UNIT context — find the length scale to millimetres.
// ---------------------------------------------------------------------------
double resolveLengthScaleMm(const std::unordered_map<std::uint64_t, Instance>& tab,
                            std::string& unitNameOut) {
    // Look for a (LENGTH_UNIT()...SI_UNIT(prefix,.METRE.)) or a
    // CONVERSION_BASED_UNIT('inch'/'foot',...). Default mm (scale 1).
    auto siMetreScale = [](const std::string& prefix) -> double {
        // SI metre prefixes -> scale-to-mm.
        if (prefix.find("MILLI") != std::string::npos) return 1.0;
        if (prefix.find("CENTI") != std::string::npos) return 10.0;
        if (prefix.find("DECI")  != std::string::npos) return 100.0;
        if (prefix.find("KILO")  != std::string::npos) return 1.0e6;
        if (prefix.find("MICRO") != std::string::npos) return 1.0e-3;
        if (prefix.find("$") != std::string::npos || prefix.empty()) return 1000.0; // bare metre
        return 1000.0; // unknown prefix -> treat as metre
    };
    // A resolved candidate: the scale to mm, the display name, and the ENTITY ID it
    // was read from.
    //
    // `tab` is an unordered_map, so ITERATION ORDER IS A PROPERTY OF THE STDLIB
    // BUILD, NOT OF THE FILE (libc++ on macOS vs libstdc++ on Linux CI, and it can
    // shift between runs). Every pass below therefore collects ALL candidates and
    // then picks by LOWEST ENTITY ID — the file's own declaration order — instead
    // of returning whichever one iteration happened to yield first.
    //
    // This is the same nondeterminism the imperial pass already documented fixing
    // by ordering the passes, one level up: a file may declare SEVERAL geometric
    // representation contexts (an assembly with several SHAPE_REPRESENTATIONs has
    // one each), and the old code returned on the FIRST context that resolved. When
    // two contexts name different units that was a coin flip that mis-scales the
    // WHOLE model — the worst class of import bug, because the geometry still looks
    // plausible and every dimension is wrong. In the overwhelmingly common case the
    // contexts agree and this changes nothing; when they disagree the answer is now
    // at least the same on every platform and every run, and is the unit the file
    // declares FIRST.
    struct UnitCand {
        std::uint64_t id = 0;
        double        scale = 1.0;
        std::string   name;
    };
    auto pickLowestId = [](const std::vector<UnitCand>& c) -> const UnitCand* {
        const UnitCand* best = nullptr;
        for (const auto& u : c)
            if (best == nullptr || u.id < best->id) best = &u;
        return best;
    };

    // PASS 1 — imperial CONVERSION_BASED_UNIT (inch/foot) takes PRIORITY. An inch
    // file ALSO contains the SI base unit (millimetre/metre) the inch is defined in
    // terms of, so scanning both kinds in ONE pass let iteration ORDER decide which
    // matched first. Scanning imperial FIRST, and resolving ALL of them by lowest
    // id, makes the result deterministic on every platform.
    std::vector<UnitCand> imperial;
    for (const auto& kv : tab) {
        const Instance& ins = kv.second;
        if (ins.type != "CONVERSION_BASED_UNIT") continue;
        auto p = splitTopLevel(ins.params);
        if (p.empty()) continue;
        std::string nm = p[0];
        std::transform(nm.begin(), nm.end(), nm.begin(),
                       [](unsigned char c){ return (char)std::tolower(c); });
        if (nm.find("inch") != std::string::npos)
            imperial.push_back(UnitCand{kv.first, 25.4, "INCH"});
        else if (nm.find("foot") != std::string::npos)
            imperial.push_back(UnitCand{kv.first, 304.8, "FOOT"});
    }
    if (const UnitCand* u = pickLowestId(imperial)) {
        unitNameOut = u->name;
        return u->scale;
    }

    // PASS 1.5 — THE UNIT THE GEOMETRY IS ACTUALLY IN. A file may declare several
    // LENGTH_UNITs and use only one; the geometric context names which:
    //
    //   #248=(GEOMETRIC_REPRESENTATION_CONTEXT(3)
    //         GLOBAL_UNIT_ASSIGNED_CONTEXT((#250,#252,#253)) ...)
    //   #250=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.CENTI.,.METRE.))   <- referenced
    //   #251=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.))         <- NOT referenced
    //
    // A bare scan of every LENGTH_UNIT in the file is a coin flip between scale 10
    // and scale 1000 on the file above — a 100x error. Measured on the
    // neuralCAD-Edit corpus: a 76.3 mm part read as 7630 mm. The file banner has
    // always claimed the unit is resolved from the GEOMETRIC_REPRESENTATION_CONTEXT
    // — now it actually is, across ALL such contexts.
    std::vector<UnitCand> ctxCands;
    for (const auto& kv : tab) {
        const Instance& ins = kv.second;
        if (!ins.type.empty()) continue;                 // contexts are complex records
        auto subs = splitComplex(ins.params);
        bool isGeoCtx = false;
        std::vector<std::uint64_t> unitIds;
        for (const auto& s : subs) {
            if (s.type == "GEOMETRIC_REPRESENTATION_CONTEXT") isGeoCtx = true;
            if (s.type == "GLOBAL_UNIT_ASSIGNED_CONTEXT") {
                // params are a single list argument, `(#250,#252,#253)`. Read the
                // entity refs straight out of the text — nesting depth here is fixed
                // by the schema, so there is nothing a split would buy.
                for (std::size_t i = 0; i + 1 < s.params.size(); ++i) {
                    if (s.params[i] != '#') continue;
                    std::uint64_t uid = 0;
                    std::size_t j = i + 1;
                    while (j < s.params.size() && std::isdigit(static_cast<unsigned char>(s.params[j])))
                        uid = uid * 10 + static_cast<std::uint64_t>(s.params[j++] - '0');
                    if (j > i + 1) unitIds.push_back(uid);
                    i = j - 1;
                }
            }
        }
        if (!isGeoCtx || unitIds.empty()) continue;
        // The referenced unit list is in FILE order, so the first LENGTH_UNIT this
        // context names is this context's length unit; the context is then a single
        // candidate keyed by its OWN id.
        for (std::uint64_t uid : unitIds) {
            auto it = tab.find(uid);
            if (it == tab.end() || !it->second.type.empty()) continue;
            auto usubs = splitComplex(it->second.params);
            bool isLength = false;
            std::string prefix;
            for (const auto& s : usubs) {
                if (s.type == "LENGTH_UNIT") isLength = true;
                if (s.type == "SI_UNIT") {
                    auto f = splitTopLevel(s.params);
                    if (f.size() >= 2 && f[1].find("METRE") != std::string::npos) prefix = f[0];
                }
            }
            if (isLength && !prefix.empty()) {
                std::string nm = (prefix.find("MILLI") != std::string::npos) ? "MILLIMETRE"
                               : (prefix.find("CENTI") != std::string::npos) ? "CENTIMETRE"
                                                                            : "METRE";
                ctxCands.push_back(UnitCand{kv.first, siMetreScale(prefix), nm});
                break;
            }
        }
    }
    if (const UnitCand* u = pickLowestId(ctxCands)) {
        unitNameOut = u->name;
        return u->scale;
    }

    // PASS 2 — SI length unit (only when no imperial conversion is present, and no
    // geometric context named one). The SIMPLE SI length unit appears as a COMPLEX
    // record: (LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))
    std::vector<UnitCand> siCands;
    for (const auto& kv : tab) {
        const Instance& ins = kv.second;
        if (!ins.type.empty()) continue;
        auto subs = splitComplex(ins.params);
        bool isLength = false; std::string prefix;
        for (const auto& s : subs) {
            if (s.type == "LENGTH_UNIT") isLength = true;
            if (s.type == "SI_UNIT") {
                auto f = splitTopLevel(s.params);
                if (f.size() >= 2 && f[1].find("METRE") != std::string::npos) {
                    prefix = f[0];
                }
            }
        }
        if (isLength && !prefix.empty()) {
            std::string nm = (prefix.find("MILLI") != std::string::npos) ? "MILLIMETRE" : "METRE";
            siCands.push_back(UnitCand{kv.first, siMetreScale(prefix), nm});
        }
    }
    if (const UnitCand* u = pickLowestId(siCands)) {
        unitNameOut = u->name;
        return u->scale;
    }

    unitNameOut = "MILLIMETRE";
    return 1.0;
}

// ---------------------------------------------------------------------------
// SURFACE reconstruction.
//   * The 5 quadrics -> native analytic Surface (EXACT mass props path).
//   * B_SPLINE_SURFACE_WITH_KNOTS (+ rational complex form) -> NurbsSurface.
// ---------------------------------------------------------------------------

// Expand a (mult,distinct-knot) pair into the full flat knot vector.
std::vector<double> expandKnots(const std::vector<int>& mult,
                                const std::vector<double>& vals) {
    std::vector<double> out;
    for (std::size_t i = 0; i < vals.size() && i < mult.size(); ++i)
        for (int k = 0; k < mult[i]; ++k) out.push_back(vals[i]);
    return out;
}

// Parse a list of ints "(1,2,3)".
bool parseIntList(const std::string& tok, std::vector<int>& out) {
    std::vector<std::string> f;
    if (!parseList(tok, f)) return false;
    out.clear();
    for (const auto& s : f) { double d; if (!stepNum(s, d)) return false; out.push_back((int)std::llround(d)); }
    return true;
}
bool parseRealList(const std::string& tok, std::vector<double>& out) {
    std::vector<std::string> f;
    if (!parseList(tok, f)) return false;
    out.clear();
    for (const auto& s : f) { double d; if (!stepNum(s, d)) return false; out.push_back(d); }
    return true;
}

// Reconstruct a B-spline surface from a B_SPLINE_SURFACE_WITH_KNOTS field set
// (degreeU, degreeV, control-grid-of-#refs, ..., uMult, vMult, uKnots, vKnots).
// `fields` are the surface's parameters AFTER the leading "''" name field has been
// dropped (so fields[0] = degreeU). `rationalWeights` (optional, nU x nV) applies
// the rational variant. Points are scaled to mm by `scale`.
bool buildBSplineSurface(const Resolver& R, const std::vector<std::string>& fields,
                         const std::vector<std::vector<double>>* rationalWeights,
                         double scale, NurbsSurface& out, std::string& why) {
    // fields layout for B_SPLINE_SURFACE_WITH_KNOTS (post-name):
    //   0:uDeg 1:vDeg 2:ctrlGrid 3:surfForm 4:uClosed 5:vClosed 6:selfInt
    //   7:uMult 8:vMult 9:uKnots 10:vKnots [11:knotSpec]
    if (fields.size() < 11) { why = "B_SPLINE_SURFACE_WITH_KNOTS arity"; return false; }
    double du = 0, dv = 0;
    if (!stepNum(fields[0], du) || !stepNum(fields[1], dv)) { why = "bspline degree"; return false; }
    out.degreeU = (std::size_t)std::llround(du);
    out.degreeV = (std::size_t)std::llround(dv);

    // control grid: a list of rows, each row a list of #refs.
    std::vector<std::string> rows;
    if (!parseList(fields[2], rows) || rows.empty()) { why = "bspline control grid"; return false; }
    out.control.clear(); out.weights.clear();
    out.control.resize(rows.size());
    out.weights.resize(rows.size());
    for (std::size_t iu = 0; iu < rows.size(); ++iu) {
        std::vector<std::string> rowRefs;
        if (!parseList(rows[iu], rowRefs) || rowRefs.empty()) { why = "bspline row"; return false; }
        out.control[iu].resize(rowRefs.size());
        out.weights[iu].assign(rowRefs.size(), 1.0);
        for (std::size_t iv = 0; iv < rowRefs.size(); ++iv) {
            std::uint64_t pid = 0;
            Vec3 cp;
            if (!parseRef(rowRefs[iv], pid) || !getPoint(R, pid, cp)) { why = "bspline ctrl pt"; return false; }
            out.control[iu][iv] = vscale(cp, scale);
            if (rationalWeights && iu < rationalWeights->size() &&
                iv < (*rationalWeights)[iu].size())
                out.weights[iu][iv] = (*rationalWeights)[iu][iv];
        }
    }
    std::vector<int> uMult, vMult; std::vector<double> uK, vK;
    if (!parseIntList(fields[7], uMult) || !parseIntList(fields[8], vMult) ||
        !parseRealList(fields[9], uK) || !parseRealList(fields[10], vK)) {
        why = "bspline knot data"; return false;
    }
    out.knotsU = expandKnots(uMult, uK);
    out.knotsV = expandKnots(vMult, vK);
    return true;
}

// Read the optional rational weight grid from a complex B-spline-surface record's
// RATIONAL_B_SPLINE_SURFACE sub-record (its single field is the weight grid).
bool readRationalWeights(const std::string& weightGridField,
                         std::vector<std::vector<double>>& out) {
    std::vector<std::string> rows;
    if (!parseList(weightGridField, rows)) return false;
    out.clear();
    for (const auto& r : rows) {
        std::vector<double> w;
        if (!parseRealList(r, w)) return false;
        out.push_back(std::move(w));
    }
    return true;
}

// ---------------------------------------------------------------------------
// QUADRIC face parameterisation. Given the reconstructed quadric Surface and the
// ordered ring of 3D vertices (already scaled to mm), fill the face trim window
// (u0..v1) + vertexUV so the EXACT mass integrator runs on it. Mirrors the
// StepAnalytic::attachTrim logic (anchored theta-unwrap, cone height recovery,
// disk/annular-sector caps) but local to this TU. Returns false on failure.
// `ringCircleCentres`/`ringCircleRadii`/`ringHasCircle` describe the boundary
// CIRCLE of the edge LEAVING ring[i] (for the disk-cap detection on planes).
bool parameteriseQuadric(Face* f, Surface* surf,
                         const std::vector<Vertex*>& ring,
                         const std::vector<bool>& ringHasCircle,
                         const std::vector<Vec3>& ringCircleCentre,
                         const std::vector<Vec3>& ringCircleNormal,
                         const std::vector<double>& ringCircleRadius) {
    f->vertexUV.clear();
    f->vertexUV.reserve(ring.size());
    const Vec3 axis = vnorm(surf->axis);
    const Vec3 rdir = vnorm(surf->refDir);
    const Vec3 bdir = surf->binormal();

    // EllipseExtrusion belongs here: its u IS a periodic ellipse angle, so it needs
    // the same seam unwrap as the circular quadrics (Surface.hpp says so in as many
    // words). It was omitted, and because the switch below then had no case for it
    // the surface fell through with pu=pv=0 — EVERY point of an elliptical-cylinder
    // face collapsed onto the parametric origin, degenerating its region polygon.
    // -Wswitch is what surfaced it; the analytic convention is the one
    // buildRegionPolygon already uses (cos u = x/a, sin u = y/b, v = z along axis).
    const bool angular = (surf->kind == SurfaceKind::Cylinder ||
                          surf->kind == SurfaceKind::Cone ||
                          surf->kind == SurfaceKind::Sphere ||
                          surf->kind == SurfaceKind::Torus ||
                          surf->kind == SurfaceKind::EllipseExtrusion);

    std::vector<double> us(ring.size()), vs(ring.size());
    double anchorTheta = 0.0; bool haveAnchor = false;
    for (std::size_t i = 0; i < ring.size(); ++i) {
        Vec3 rel = vsub(PV(ring[i]->point), surf->origin);
        double x = vdot(rel, rdir), y = vdot(rel, bdir), z = vdot(rel, axis);
        double pu = 0, pv = 0;
        switch (surf->kind) {
        case SurfaceKind::Plane:    pu = x; pv = y; break;
        case SurfaceKind::Cylinder: pu = std::atan2(y, x); pv = z; break;
        case SurfaceKind::Cone:     pu = std::atan2(y, x); pv = z; break;
        case SurfaceKind::Sphere: {
            pu = std::atan2(y, x);
            double rr = vlen(rel);
            pv = (rr > 1e-12) ? std::acos(std::max(-1.0, std::min(1.0, z / rr))) : 0.0;
            break;
        }
        case SurfaceKind::Torus: {
            pu = std::atan2(y, x);
            double ringR = std::sqrt(x * x + y * y) - surf->r1;
            pv = std::atan2(z, ringR);
            break;
        }
        case SurfaceKind::EllipseExtrusion:
            // u = ellipse angle (cos u = x/a, sin u = y/b); v = distance along axis
            // — identical to buildRegionPolygon's convention.
            pu = std::atan2(y / (surf->r2 > 1e-12 ? surf->r2 : 1.0),
                            x / (surf->r1 > 1e-12 ? surf->r1 : 1.0));
            pv = z;
            break;
        case SurfaceKind::Nurbs: pu = 0; pv = 0; break;
        }
        if (angular) {
            bool radialDefined = (std::sqrt(x * x + y * y) > 1e-9);
            if (!haveAnchor && radialDefined) { anchorTheta = pu; haveAnchor = true; }
            if (haveAnchor) {
                while (pu - anchorTheta >  PI) pu -= 2.0 * PI;
                while (pu - anchorTheta < -PI) pu += 2.0 * PI;
            }
        }
        us[i] = pu; vs[i] = pv;
    }
    if (surf->kind == SurfaceKind::Torus) {
        double anchorPhi = vs[0];
        for (std::size_t i = 0; i < ring.size(); ++i) {
            while (vs[i] - anchorPhi >  PI) vs[i] -= 2.0 * PI;
            while (vs[i] - anchorPhi < -PI) vs[i] += 2.0 * PI;
        }
    }
    // POLE u-collapse.
    if (angular) {
        double sumU = 0; int cntU = 0;
        for (std::size_t i = 0; i < ring.size(); ++i) {
            Vec3 rel = vsub(PV(ring[i]->point), surf->origin);
            double rad = std::sqrt(vdot(rel, rdir) * vdot(rel, rdir) +
                                   vdot(rel, bdir) * vdot(rel, bdir));
            if (rad > 1e-9) { sumU += us[i]; ++cntU; }
        }
        if (cntU > 0 && cntU < (int)ring.size()) {
            double meanU = sumU / cntU;
            for (std::size_t i = 0; i < ring.size(); ++i) {
                Vec3 rel = vsub(PV(ring[i]->point), surf->origin);
                double rad = std::sqrt(vdot(rel, rdir) * vdot(rel, rdir) +
                                       vdot(rel, bdir) * vdot(rel, bdir));
                if (rad <= 1e-9) us[i] = meanU;
            }
        }
    }
    // CONE height recovery.
    if (surf->kind == SurfaceKind::Cone) {
        double vmin = vs[0], vmax = vs[0];
        for (double v : vs) { vmin = std::min(vmin, v); vmax = std::max(vmax, v); }
        double H = vmax - vmin;
        if (H < 1e-12) return false;
        const double refRadius = surf->r1;
        const double slope = surf->param;
        surf->origin = vadd(surf->origin, vscale(axis, vmin));
        surf->r1 = refRadius + slope * vmin;
        surf->r2 = refRadius + slope * vmax;
        surf->param = H;
        for (double& v : vs) v = (v - vmin) / H;
    }

    double u0 = us[0], u1 = us[0], v0 = vs[0], v1 = vs[0];
    for (std::size_t i = 0; i < ring.size(); ++i) {
        f->vertexUV.push_back({us[i], vs[i]});
        u0 = std::min(u0, us[i]); u1 = std::max(u1, us[i]);
        v0 = std::min(v0, vs[i]); v1 = std::max(v1, vs[i]);
    }
    f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;

    // PLANE-as-DISK / ANNULAR-SECTOR (curved-primitive cap bounded by circles).
    if (surf->kind == SurfaceKind::Plane) {
        Vec3 centre{0, 0, 0}; bool haveCentre = false;
        double rInner = 0.0, rOuter = 0.0; int nCircles = 0; bool consistent = true;
        const Vec3 nAxis = vnorm(surf->axis);
        for (std::size_t i = 0; i < ring.size(); ++i) {
            if (!ringHasCircle[i]) continue;
            if (std::fabs(std::fabs(vdot(vnorm(ringCircleNormal[i]), nAxis)) - 1.0) > 1e-6) continue;
            if (!haveCentre) { centre = ringCircleCentre[i]; haveCentre = true; }
            else if (vlen(vsub(ringCircleCentre[i], centre)) > 1e-6 * std::max(1.0, vlen(centre))) {
                consistent = false; break;
            }
            ++nCircles;
            if (ringCircleRadius[i] > rOuter) rOuter = ringCircleRadius[i];
            if (rInner == 0.0 || ringCircleRadius[i] < rInner) rInner = ringCircleRadius[i];
        }
        bool diskShaped = haveCentre && consistent && nCircles >= 1 && rOuter > 1e-9;
        if (diskShaped) {
            const std::size_t n = ring.size();
            for (std::size_t i = 0; i < n && diskShaped; ++i) {
                if (ringHasCircle[i]) continue;
                Vec3 a = vsub(PV(ring[i]->point), centre);
                Vec3 b = vsub(PV(ring[(i + 1) % n]->point), centre);
                double ax = vdot(a, rdir), ay = vdot(a, bdir);
                double bx = vdot(b, rdir), by = vdot(b, bdir);
                double cross = ax * by - ay * bx;
                double sc = std::max(1.0, rOuter * rOuter);
                if (std::fabs(cross) > 1e-6 * sc) diskShaped = false;
            }
        }
        if (diskShaped) {
            if (rInner >= rOuter - 1e-9) rInner = 0.0;
            const double TWO_PI = 2.0 * PI;
            bool allArcs = true;
            for (bool h : ringHasCircle) if (!h) { allArcs = false; break; }
            double aMin, aMax;
            if (allArcs) { aMin = 0.0; aMax = TWO_PI; }
            else {
                const std::size_t n = ring.size();
                Vec3 rel0 = vsub(PV(ring[0]->point), centre);
                double a0 = std::atan2(vdot(rel0, bdir), vdot(rel0, rdir));
                double lo = 0, hi = 0;
                for (std::size_t i = 0; i < n; ++i) {
                    Vec3 rel = vsub(PV(ring[i]->point), centre);
                    if (std::sqrt(vdot(rel, rdir) * vdot(rel, rdir) +
                                  vdot(rel, bdir) * vdot(rel, bdir)) < 1e-9) continue;
                    double a = std::atan2(vdot(rel, bdir), vdot(rel, rdir)) - a0;
                    while (a >  PI) a -= TWO_PI;
                    while (a < -PI) a += TWO_PI;
                    lo = std::min(lo, a); hi = std::max(hi, a);
                }
                aMin = a0 + lo; aMax = a0 + hi;
            }
            surf->isDisk = true;
            surf->diskInner = rInner;
            surf->diskOuter = rOuter;
            surf->origin = centre;
            f->u0 = aMin; f->u1 = aMax;
            f->v0 = rInner; f->v1 = rOuter;
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// buildRegionPolygon — the (u,v) BOUNDARY POLYGON of a densified 3D ring on an
// analytic quadric surface, in the surface's OWN parameter space (matching
// Surface::evaluateDeriv exactly), for the trimmed-region mass integral
// (MassProps::integrateParametricRegion). Angles are SEQUENTIALLY unwrapped
// (each sample within +/-pi of its predecessor); a torus phi is unwrapped too.
// The surface MUST already be fully configured (cone origin shifted / param=H)
// so v matches evaluateDeriv. `thetaAnchor` (NaN = anchor to the ring's own first
// angle; else force the first angle into that 2*pi branch) lets a hole ring share
// the outer ring's branch. One (u,v) per densified 3D point; the caller uses it
// only when it has >= 3 points, else keeps the rectangle path.
// ---------------------------------------------------------------------------
std::vector<std::array<double, 2>> buildRegionPolygon(
        const std::vector<Vec3>& pts, const Surface* sf, double thetaAnchor) {
    std::vector<std::array<double, 2>> poly;
    poly.reserve(pts.size());
    const Vec3 ax = vnorm(sf->axis), rd = vnorm(sf->refDir), bd = vcross(ax, rd);
    bool haveTh = false;  double thPrev = 0.0;
    bool havePhi = false; double phiPrev = 0.0;
    for (const Vec3& P : pts) {
        const Vec3 rel = vsub(P, sf->origin);
        const double x = vdot(rel, rd), y = vdot(rel, bd), z = vdot(rel, ax);
        double u = 0.0, v = 0.0;
        switch (sf->kind) {
        case SurfaceKind::Cylinder: u = std::atan2(y, x); v = z; break;
        case SurfaceKind::EllipseExtrusion:
            // u = ellipse angle (cos u = x/a, sin u = y/b); v = distance along axis.
            u = std::atan2(y / (sf->r2 > 1e-12 ? sf->r2 : 1.0),
                           x / (sf->r1 > 1e-12 ? sf->r1 : 1.0));
            v = z; break;
        case SurfaceKind::Cone:
            u = std::atan2(y, x);
            v = (std::fabs(sf->param) > 1e-12) ? z / sf->param : z;
            break;
        case SurfaceKind::Sphere: {
            u = std::atan2(y, x);
            const double rr = vlen(rel);
            v = (rr > 1e-12) ? std::acos(std::max(-1.0, std::min(1.0, z / rr))) : 0.0;
            break;
        }
        case SurfaceKind::Torus: {
            u = std::atan2(y, x);
            const double ringR = std::sqrt(x * x + y * y) - sf->r1;
            v = std::atan2(z, ringR);
            break;
        }
        default: u = x; v = y; break;
        }
        const bool radial = (x * x + y * y > 1e-18);
        if (radial) {
            if (!haveTh) {
                if (std::isnan(thetaAnchor)) { thPrev = u; }
                else {
                    while (u - thetaAnchor >  PI) u -= 2.0 * PI;
                    while (u - thetaAnchor < -PI) u += 2.0 * PI;
                    thPrev = u;
                }
                haveTh = true;
            } else {
                while (u - thPrev >  PI) u -= 2.0 * PI;
                while (u - thPrev < -PI) u += 2.0 * PI;
                thPrev = u;
            }
        } else if (haveTh) {
            u = thPrev;   // pole / on-axis degeneracy: hold the previous angle
        }
        if (sf->kind == SurfaceKind::Torus) {
            if (!havePhi) { phiPrev = v; havePhi = true; }
            else {
                while (v - phiPrev >  PI) v -= 2.0 * PI;
                while (v - phiPrev < -PI) v += 2.0 * PI;
                phiPrev = v;
            }
        }
        poly.push_back({u, v});
    }
    return poly;
}

// ---------------------------------------------------------------------------
// EDGE_CURVE circle geometry (for the disk-cap detection on planar faces).
// ---------------------------------------------------------------------------
struct EdgeCircle { bool ok = false; Vec3 centre{}; Vec3 normal{}; double radius = 0; };

EdgeCircle circleOfEdgeCurve(const Resolver& R, std::uint64_t ecId, double scale) {
    EdgeCircle out;
    Instance ec; if (!R.get(ecId, ec) || ec.type != "EDGE_CURVE") return out;
    auto ep = splitTopLevel(ec.params);
    if (ep.size() < 5) return out;
    std::uint64_t curveId = 0;
    if (!parseRef(ep[3], curveId)) return out;
    Instance ci; if (!R.get(curveId, ci) || ci.type != "CIRCLE") return out;
    auto cp = splitTopLevel(ci.params);
    if (cp.size() < 3) return out;
    std::uint64_t ax = 0;
    if (!parseRef(cp[1], ax)) return out;
    Vec3 o, a, rdir;
    if (!getAxis2(R, ax, o, a, rdir)) return out;
    double rad;
    if (!stepNum(cp[2], rad)) return out;
    out.centre = vscale(o, scale); out.normal = vnorm(a);
    out.radius = rad * scale; out.ok = true;
    return out;
}

// ---------------------------------------------------------------------------
// SURFACE POINT-INVERSION. Map a 3D model-space point P (already scaled to mm)
// back to the surface (u,v) parameter so a foreign edge can be expressed as a
// real PCurve in the surface's parameter plane (the trim-loop geometry the
// kernel actually consumes). REAL inversion — no synthesis:
//   * Plane:    analytic — (u,v) = ((P-origin)·refDir, (P-origin)·binormal).
//   * NURBS:    Gauss-Newton minimisation of |S(u,v) - P|^2 using the analytic
//               partials (evaluateWithDerivatives), seeded from the best point
//               of a coarse parameter grid, clamped to the clamped knot domain.
// Returns false honestly if the inversion does not converge to the point.
// ---------------------------------------------------------------------------
bool invertPlane(const Surface& s, const Vec3& P, UVCoord& uv) {
    const Vec3 rel = vsub(P, s.origin);
    const Vec3 bdir = s.binormal();
    uv.u = vdot(rel, vnorm(s.refDir));
    uv.v = vdot(rel, vnorm(bdir));
    return true;
}

bool invertNurbs(const NurbsSurface& surf, const Vec3& P, UVCoord& uv,
                 double tol3d) {
    if (surf.knotsU.empty() || surf.knotsV.empty()) return false;
    const double u0 = surf.knotsU.front(), u1 = surf.knotsU.back();
    const double v0 = surf.knotsV.front(), v1 = surf.knotsV.back();
    // Coarse grid seed: nearest sample to P.
    double bu = 0.5 * (u0 + u1), bv = 0.5 * (v0 + v1), bestD2 = 1e300;
    const int N = 16;
    for (int i = 0; i <= N; ++i) {
        for (int j = 0; j <= N; ++j) {
            const double u = u0 + (u1 - u0) * (double(i) / N);
            const double v = v0 + (v1 - v0) * (double(j) / N);
            SurfaceSample s = evaluatePoint(surf, u, v);
            if (!s.ok) continue;
            const Vec3 d = vsub(s.point, P);
            const double d2 = vdot(d, d);
            if (d2 < bestD2) { bestD2 = d2; bu = u; bv = v; }
        }
    }
    // Gauss-Newton refine: solve [Su·Su Su·Sv; Sv·Su Sv·Sv] [du;dv] = [Su·r; Sv·r]
    // with r = P - S, to minimise |S-P|^2.
    double u = bu, v = bv;
    for (int it = 0; it < 64; ++it) {
        SurfaceSample s = evaluateWithDerivatives(surf, u, v);
        if (!s.ok) { SurfaceSample sp = evaluatePoint(surf, u, v); if (!sp.ok) return false;
                     s.point = sp.point; s.du = Vec3{0,0,0}; s.dv = Vec3{0,0,0}; }
        const Vec3 r = vsub(P, s.point);
        const double a11 = vdot(s.du, s.du), a12 = vdot(s.du, s.dv), a22 = vdot(s.dv, s.dv);
        const double b1 = vdot(s.du, r), b2 = vdot(s.dv, r);
        const double det = a11 * a22 - a12 * a12;
        if (std::fabs(det) < 1e-30) break;            // singular -> stop, accept current
        const double du = (b1 * a22 - b2 * a12) / det;
        const double dv = (a11 * b2 - a12 * b1) / det;
        u += du; v += dv;
        u = std::max(u0, std::min(u1, u));
        v = std::max(v0, std::min(v1, v));
        if (std::fabs(du) + std::fabs(dv) < 1e-14) break;
    }
    SurfaceSample fin = evaluatePoint(surf, u, v);
    if (!fin.ok) return false;
    // Always publish the NEAREST (u,v) found (clamped to the knot domain) — even
    // when it did not converge to `tol3d`. Strict callers gate on the return bool
    // (unchanged behaviour); the BEST-EFFORT region fallback uses this nearest
    // projection to trace a bounded trim polygon instead of the full knot
    // rectangle. Writing uv on the reject path cannot affect a strict caller
    // (they only read uv when the call returned true).
    uv.u = u; uv.v = v;
    const Vec3 d = vsub(fin.point, P);
    if (vlen(d) > tol3d) return false;                 // did not converge to the point
    return true;
}

// Best-effort (u,v) region polygon of a densified 3D ring on a NURBS surface:
// invert each true-boundary point onto the patch (NEAREST projection — never
// fails), so a B-spline face whose STRICT trim did not fully invert is still
// integrated over a BOUNDED trim polygon (the projection of its real 3D
// boundary) instead of the gross full knot RECTANGLE (the catastrophic
// over-count on exporter patches whose knot domain overruns the face). This is
// the direct NURBS analogue of buildRegionPolygon (quadrics). `uvbb`, if given,
// accumulates the (u,v) bbox of the projected ring.
std::vector<std::array<double, 2>> buildRegionPolygonNurbs(
        const std::vector<Vec3>& pts, const NurbsSurface& nsurf,
        double invTol, double* uvbb = nullptr) {
    std::vector<std::array<double, 2>> poly;
    poly.reserve(pts.size());
    for (const Vec3& P : pts) {
        UVCoord uv{};
        invertNurbs(nsurf, P, uv, invTol);   // best-effort: uv is the nearest point
        poly.push_back({uv.u, uv.v});
        if (uvbb) {
            uvbb[0] = std::min(uvbb[0], uv.u); uvbb[1] = std::max(uvbb[1], uv.u);
            uvbb[2] = std::min(uvbb[2], uv.v); uvbb[3] = std::max(uvbb[3], uv.v);
        }
    }
    return poly;
}

// ---------------------------------------------------------------------------
// EDGE_CURVE 3D GEOMETRY. Resolve the underlying 3D curve of an EDGE_CURVE into a
// tagged record (LINE / CIRCLE / ELLIPSE / B_SPLINE_CURVE_WITH_KNOTS), with all
// geometry scaled to mm. The endpoints are taken from the edge's two VERTEX_POINTs
// (the file's literal vertices), the orientation flag is applied by the caller.
// ---------------------------------------------------------------------------
enum class EdgeGeomKind { Line, Circle, Ellipse, BSpline };
struct EdgeGeom {
    bool ok = false;
    EdgeGeomKind kind = EdgeGeomKind::Line;
    bool sameSense = true;            // EDGE_CURVE.same_sense: does the 3D curve run
                                      // v0->v1 (t increasing) or v1->v0? Needed so a
                                      // CIRCLE/ELLIPSE arc is sampled on the CORRECT
                                      // side (CCW vs CW about its axis), not always
                                      // the <=pi short arc.
    Vec3 v0{}, v1{};                  // the two VERTEX_POINTs (scaled, file sense start->end)
    // CIRCLE / ELLIPSE
    Vec3 centre{}, axis{}, refDir{};  // placement frame (axis = plane normal, refDir = +X)
    double radius = 0.0;              // CIRCLE radius / ELLIPSE semi-major
    double radius2 = 0.0;             // ELLIPSE semi-minor
    // B_SPLINE_CURVE_WITH_KNOTS
    NurbsCurve nurbs;
    std::string typeKeyword;          // for the honest unsupported report
};

// Parse a B_SPLINE_CURVE_WITH_KNOTS field set (post-name) into a NurbsCurve.
// fields: 0:degree 1:ctrlPts 2:form 3:closed 4:selfInt 5:mult 6:knots [7:knotSpec].
bool buildBSplineCurve(const Resolver& R, const std::vector<std::string>& fields,
                       const std::vector<double>* rationalWeights,
                       double scale, NurbsCurve& out) {
    if (fields.size() < 7) return false;
    double deg = 0;
    if (!stepNum(fields[0], deg)) return false;
    out.degree = (std::size_t)std::llround(deg);
    std::vector<std::string> cpRefs;
    if (!parseList(fields[1], cpRefs) || cpRefs.empty()) return false;
    out.controlPoints.clear(); out.weights.clear();
    out.controlPoints.reserve(cpRefs.size());
    for (std::size_t i = 0; i < cpRefs.size(); ++i) {
        std::uint64_t pid = 0; Vec3 cp;
        if (!parseRef(cpRefs[i], pid) || !getPoint(R, pid, cp)) return false;
        out.controlPoints.push_back(vscale(cp, scale));
        out.weights.push_back((rationalWeights && i < rationalWeights->size())
                                  ? (*rationalWeights)[i] : 1.0);
    }
    std::vector<int> mult; std::vector<double> kv;
    if (!parseIntList(fields[5], mult) || !parseRealList(fields[6], kv)) return false;
    out.knots = expandKnots(mult, kv);
    return out.knots.size() == out.controlPoints.size() + out.degree + 1;
}

// Unwrap a curve reference through the ISO-10303 "curve on surface" wrappers that
// every commercial exporter emits: SURFACE_CURVE / SEAM_CURVE / INTERSECTION_CURVE
// all carry the REAL 3D geometry as their FIRST field (curve_3d), followed by the
// pcurve/surface associations. The native reader wants the literal 3D curve, so we
// peel these wrappers (transitively) down to the underlying LINE/CIRCLE/ELLIPSE/
// B_SPLINE. A non-wrapper id is returned unchanged.
std::uint64_t resolve3dCurve(const Resolver& R, std::uint64_t curveId) {
    for (int guard = 0; guard < 8; ++guard) {
        Instance ci;
        if (!R.get(curveId, ci)) return curveId;
        if (ci.type != "SURFACE_CURVE" && ci.type != "SEAM_CURVE" &&
            ci.type != "INTERSECTION_CURVE" && ci.type != "BOUNDED_SURFACE_CURVE")
            return curveId;
        auto cp = splitTopLevel(ci.params);
        std::uint64_t inner = 0;
        if (cp.size() < 2 || !parseRef(cp[1], inner)) return curveId;
        curveId = inner;
    }
    return curveId;
}

EdgeGeom readEdgeGeom(const Resolver& R, std::uint64_t ecId, double scale) {
    EdgeGeom g;
    Instance ec; if (!R.get(ecId, ec) || ec.type != "EDGE_CURVE") { g.typeKeyword = "EDGE_CURVE"; return g; }
    auto ep = splitTopLevel(ec.params);
    if (ep.size() < 5) return g;
    std::uint64_t vS = 0, vE = 0, curveId = 0;
    if (!parseRef(ep[1], vS) || !parseRef(ep[2], vE)) return g;
    g.sameSense = (ep.size() > 4) ? (ep[4] == ".T.") : true;   // EDGE_CURVE same_sense
    // endpoint vertices (file sense start->end, before ORIENTED_EDGE flip).
    auto vertexPos = [&](std::uint64_t vp, Vec3& out) -> bool {
        Instance vpi;
        if (!R.get(vp, vpi) || vpi.type != "VERTEX_POINT") return false;
        auto vpp = splitTopLevel(vpi.params);
        std::uint64_t cp = 0;
        if (vpp.size() < 2 || !parseRef(vpp[1], cp)) return false;
        Vec3 pos; if (!getPoint(R, cp, pos)) return false;
        out = vscale(pos, scale); return true;
    };
    if (!vertexPos(vS, g.v0) || !vertexPos(vE, g.v1)) return g;
    // The 3D curve geometry may be absent ('*') for a purely topological edge.
    if (ep[3] == "*" || ep[3] == "$") { g.kind = EdgeGeomKind::Line; g.ok = true; return g; }
    if (!parseRef(ep[3], curveId)) return g;
    curveId = resolve3dCurve(R, curveId);   // peel SURFACE_CURVE / SEAM_CURVE wrappers
    Instance ci; if (!R.get(curveId, ci)) return g;

    if (ci.type == "LINE") {
        g.kind = EdgeGeomKind::Line; g.ok = true; return g;
    }
    if (ci.type == "CIRCLE") {
        auto cp = splitTopLevel(ci.params);
        if (cp.size() < 3) { g.typeKeyword = "CIRCLE"; return g; }
        std::uint64_t ax = 0; double rad = 0;
        if (!parseRef(cp[1], ax) || !stepNum(cp[2], rad)) { g.typeKeyword = "CIRCLE"; return g; }
        Vec3 o, a, rd;
        if (!getAxis2(R, ax, o, a, rd)) { g.typeKeyword = "CIRCLE"; return g; }
        g.kind = EdgeGeomKind::Circle;
        g.centre = vscale(o, scale); g.axis = vnorm(a); g.refDir = vnorm(rd);
        g.radius = rad * scale; g.ok = true; return g;
    }
    if (ci.type == "ELLIPSE") {
        auto cp = splitTopLevel(ci.params);
        if (cp.size() < 4) { g.typeKeyword = "ELLIPSE"; return g; }
        std::uint64_t ax = 0; double r1 = 0, r2 = 0;
        if (!parseRef(cp[1], ax) || !stepNum(cp[2], r1) || !stepNum(cp[3], r2)) { g.typeKeyword = "ELLIPSE"; return g; }
        Vec3 o, a, rd;
        if (!getAxis2(R, ax, o, a, rd)) { g.typeKeyword = "ELLIPSE"; return g; }
        g.kind = EdgeGeomKind::Ellipse;
        g.centre = vscale(o, scale); g.axis = vnorm(a); g.refDir = vnorm(rd);
        g.radius = r1 * scale; g.radius2 = r2 * scale; g.ok = true; return g;
    }
    if (ci.type == "B_SPLINE_CURVE_WITH_KNOTS") {
        std::vector<std::string> fields;
        auto p = splitTopLevel(ci.params);
        if (p.size() < 2) { g.typeKeyword = "B_SPLINE_CURVE_WITH_KNOTS"; return g; }
        fields.assign(p.begin() + 1, p.end());     // drop the leading name field
        if (!buildBSplineCurve(R, fields, nullptr, scale, g.nurbs)) { g.typeKeyword = "B_SPLINE_CURVE_WITH_KNOTS"; return g; }
        g.kind = EdgeGeomKind::BSpline; g.ok = true; return g;
    }
    if (ci.type.empty()) {
        // COMPLEX curve record: (BOUNDED_CURVE()B_SPLINE_CURVE(...)
        //   B_SPLINE_CURVE_WITH_KNOTS(...)(RATIONAL_B_SPLINE_CURVE(...))...)
        auto subs = splitComplex(ci.params);
        const SubRecord* base = nullptr; const SubRecord* knots = nullptr; const SubRecord* rational = nullptr;
        for (const auto& sr : subs) {
            if (sr.type == "B_SPLINE_CURVE") base = &sr;
            else if (sr.type == "B_SPLINE_CURVE_WITH_KNOTS") knots = &sr;
            else if (sr.type == "RATIONAL_B_SPLINE_CURVE") rational = &sr;
        }
        if (base && knots) {
            auto bf = splitTopLevel(base->params);   // degree, ctrlPts, form, closed, selfInt
            auto kf = splitTopLevel(knots->params);  // mult, knots, knotSpec
            if (bf.size() >= 5 && kf.size() >= 2) {
                std::vector<std::string> fields;
                fields.push_back(bf[0]); fields.push_back(bf[1]); fields.push_back(bf[2]);
                fields.push_back(bf[3]); fields.push_back(bf[4]);
                fields.push_back(kf[0]); fields.push_back(kf[1]);
                std::vector<double> w; const std::vector<double>* wp = nullptr;
                if (rational) {
                    auto rf = splitTopLevel(rational->params);
                    if (!rf.empty() && parseRealList(rf[0], w)) wp = &w;
                }
                if (buildBSplineCurve(R, fields, wp, scale, g.nurbs)) {
                    g.kind = EdgeGeomKind::BSpline; g.ok = true; return g;
                }
            }
        }
        g.typeKeyword = "COMPLEX_CURVE"; return g;
    }
    g.typeKeyword = ci.type;        // honest unsupported edge-curve geometry
    return g;
}

// Build the EXACT rational quadratic NURBS for a full ellipse (or circle when
// a==b) in the placement frame (centre O, in-plane axes refDir=+X, bdir=+Y):
// the classic 9-control-point / degree-2 representation (Piegl & Tiller A7.1),
// where each unit-circle corner (cx,cy) maps to O + a*cx*refDir + b*cy*bdir and
// the corner weights are cos(45deg)=sqrt(2)/2. This is geometrically EXACT (the
// rational quadratic reproduces the conic), so an ellipse/circle-profile
// extrusion sweeps to the true surface. Centre/radii are already scaled to mm.
void buildEllipseNurbs(const Vec3& O, const Vec3& refDir, const Vec3& bdir,
                       double a, double b, NurbsCurve& out) {
    static const double cx[9] = { 1,  1,  0, -1, -1, -1,  0,  1,  1};
    static const double cy[9] = { 0,  1,  1,  1,  0, -1, -1, -1,  0};
    const double s = std::sqrt(2.0) / 2.0;
    static const double wq[9] = { 1,  0,  1,  0,  1,  0,  1,  0,  1};   // 0 -> corner
    out.degree = 2;
    out.controlPoints.clear(); out.weights.clear();
    out.controlPoints.reserve(9); out.weights.reserve(9);
    for (int i = 0; i < 9; ++i) {
        out.controlPoints.push_back(
            vadd(O, vadd(vscale(refDir, a * cx[i]), vscale(bdir, b * cy[i]))));
        out.weights.push_back(wq[i] == 1 ? 1.0 : s);
    }
    out.knots = {0,0,0, 0.25,0.25, 0.5,0.5, 0.75,0.75, 1,1,1};
}

// Build the EXACT NURBS SURFACE OF REVOLUTION: revolve a generatrix NurbsCurve
// (control points Pj, weights wj, degree q, knots V — already scaled to mm) a
// FULL 2*pi about the axis (aLoc, aDir). The revolved surface is the tensor product
// of a rational-quadratic full circle in U (9 control points, the Piegl & Tiller
// A8.1 construction) with the generatrix in V: each generatrix control point sweeps
// a circle of radius = its distance to the axis, so the surface reproduces the
// revolved geometry EXACTLY (a spindle torus, barrel, ogive, etc.). A generatrix
// point ON the axis collapses its circle to a pole. Returns false if the generatrix
// is invalid.
bool revolveCurveToNurbs(const NurbsCurve& gen, const Vec3& aLoc, const Vec3& aDir,
                         NurbsSurface& out) {
    if (!gen.valid()) return false;
    const Vec3 A = vnorm(aDir);
    const double s = std::sqrt(2.0) / 2.0;
    const std::size_t m = gen.controlPoints.size();
    out = NurbsSurface{};
    out.degreeU = 2;
    out.knotsU  = {0,0,0, 0.25,0.25, 0.5,0.5, 0.75,0.75, 1,1,1};
    out.degreeV = gen.degree;
    out.knotsV  = gen.knots;
    out.control.assign(9, std::vector<Vec3>(m));
    out.weights.assign(9, std::vector<double>(m));
    // circle-control multipliers (relative to O_j, in the (X,Y) axis frame) and
    // their rational weights.
    static const double cx[9] = { 1,  1,  0, -1, -1, -1,  0,  1,  1};
    static const double cy[9] = { 0,  1,  1,  1,  0, -1, -1, -1,  0};
    for (std::size_t j = 0; j < m; ++j) {
        const Vec3 Pj = gen.controlPoints[j];
        const double wj = (j < gen.weights.size()) ? gen.weights[j] : 1.0;
        const double along = vdot(vsub(Pj, aLoc), A);
        const Vec3 Oj = vadd(aLoc, vscale(A, along));       // foot on axis
        const Vec3 Xv = vsub(Pj, Oj);
        const double rj = vlen(Xv);
        for (int i = 0; i < 9; ++i) {
            const double cw = (i % 2 == 1) ? s : 1.0;       // corner weight
            out.weights[i][j] = cw * wj;
            if (rj < 1e-12) { out.control[i][j] = Pj; continue; }  // pole
            const Vec3 X = vscale(Xv, 1.0 / rj);
            const Vec3 Y = vcross(A, X);                    // unit (A ⟂ X)
            out.control[i][j] = vadd(Oj, vadd(vscale(X, rj * cx[i]), vscale(Y, rj * cy[i])));
        }
    }
    return out.valid();
}

// Resolve a RAW curve id (the generatrix / profile of a SURFACE_OF_LINEAR_EXTRUSION
// — NOT wrapped in an EDGE_CURVE) into a NurbsCurve, scaled to mm. Handles the plain
// B_SPLINE_CURVE_WITH_KNOTS and its COMPLEX (rational) record, plus the analytic
// ELLIPSE / CIRCLE conics (represented as the exact rational quadratic NURBS above),
// which are common extrusion profiles. Returns false (no fabrication) for anything
// else, so the face is honestly recorded unsupported rather than mis-built.
bool buildProfileCurve(const Resolver& R, std::uint64_t curveId, double scale, NurbsCurve& out) {
    curveId = resolve3dCurve(R, curveId);
    Instance ci; if (!R.get(curveId, ci)) return false;
    if (ci.type == "ELLIPSE") {
        auto p = splitTopLevel(ci.params);
        std::uint64_t ax = 0; double r1 = 0, r2 = 0;
        if (p.size() < 4 || !parseRef(p[1], ax) || !stepNum(p[2], r1) || !stepNum(p[3], r2)) return false;
        Vec3 o, a, rd;
        if (!getAxis2(R, ax, o, a, rd)) return false;
        const Vec3 bd = vcross(vnorm(a), vnorm(rd));
        buildEllipseNurbs(vscale(o, scale), vnorm(rd), bd, r1 * scale, r2 * scale, out);
        return out.valid();
    }
    if (ci.type == "CIRCLE") {
        auto p = splitTopLevel(ci.params);
        std::uint64_t ax = 0; double rad = 0;
        if (p.size() < 3 || !parseRef(p[1], ax) || !stepNum(p[2], rad)) return false;
        Vec3 o, a, rd;
        if (!getAxis2(R, ax, o, a, rd)) return false;
        const Vec3 bd = vcross(vnorm(a), vnorm(rd));
        buildEllipseNurbs(vscale(o, scale), vnorm(rd), bd, rad * scale, rad * scale, out);
        return out.valid();
    }
    if (ci.type == "B_SPLINE_CURVE_WITH_KNOTS") {
        auto p = splitTopLevel(ci.params);
        if (p.size() < 2) return false;
        std::vector<std::string> fields(p.begin() + 1, p.end());   // drop name
        return buildBSplineCurve(R, fields, nullptr, scale, out) && out.valid();
    }
    if (ci.type.empty()) {   // COMPLEX rational b-spline curve record
        auto subs = splitComplex(ci.params);
        const SubRecord* base = nullptr; const SubRecord* knots = nullptr; const SubRecord* rational = nullptr;
        for (const auto& sr : subs) {
            if (sr.type == "B_SPLINE_CURVE") base = &sr;
            else if (sr.type == "B_SPLINE_CURVE_WITH_KNOTS") knots = &sr;
            else if (sr.type == "RATIONAL_B_SPLINE_CURVE") rational = &sr;
        }
        if (base && knots) {
            auto bf = splitTopLevel(base->params);
            auto kf = splitTopLevel(knots->params);
            if (bf.size() >= 5 && kf.size() >= 2) {
                std::vector<std::string> fields;
                fields.push_back(bf[0]); fields.push_back(bf[1]); fields.push_back(bf[2]);
                fields.push_back(bf[3]); fields.push_back(bf[4]);
                fields.push_back(kf[0]); fields.push_back(kf[1]);
                std::vector<double> w; const std::vector<double>* wp = nullptr;
                if (rational) { auto rf = splitTopLevel(rational->params); if (!rf.empty() && parseRealList(rf[0], w)) wp = &w; }
                return buildBSplineCurve(R, fields, wp, scale, out) && out.valid();
            }
        }
    }
    return false;
}

} // namespace

// ===========================================================================
// readForeignStep
// ===========================================================================
ForeignReadResult readForeignStep(const std::string& text, double sewTol) {
    std::size_t dB = 0, dE = 0; std::string why;
    if (!p21::locateSections(text, dB, dE, why))
        return fail("readForeignStep: " + why);

    std::unordered_map<std::uint64_t, Instance> tab;
    if (!p21::parseInstances(text, dB, dE, tab, why))
        return fail("readForeignStep: " + why);
    if (tab.empty()) return fail("readForeignStep: empty DATA section");

    Resolver R{tab};

    ForeignReadResult result;
    result.lengthScaleToMm = resolveLengthScaleMm(tab, result.unitName);
    const double scale = result.lengthScaleToMm;

    // --- collect every ADVANCED_FACE reachable from a shell root --------------
    // Roots: MANIFOLD_SOLID_BREP, BREP_WITH_VOIDS, SHELL_BASED_SURFACE_MODEL,
    // MANIFOLD_SURFACE_SHAPE_REPRESENTATION (its items), and bare CLOSED_SHELL/
    // OPEN_SHELL if no solid root references them. We gather distinct shell ids,
    // then the union of their faces.
    std::vector<std::uint64_t> shellIds;
    std::set<std::uint64_t> shellSet;
    auto addShellRef = [&](std::uint64_t sid) {
        Instance si;
        if (R.get(sid, si) && (si.type == "CLOSED_SHELL" || si.type == "OPEN_SHELL")) {
            if (shellSet.insert(sid).second) shellIds.push_back(sid);
        }
    };
    auto addShellsFromList = [&](const std::string& listField) {
        std::vector<std::string> refs;
        if (parseList(listField, refs))
            for (const auto& r : refs) { std::uint64_t id; if (parseRef(r, id)) addShellRef(id); }
    };

    bool anyRoot = false;
    for (const auto& kv : tab) {
        const Instance& ins = kv.second;
        if (ins.type == "MANIFOLD_SOLID_BREP") {
            auto p = splitTopLevel(ins.params);
            if (p.size() >= 2) { std::uint64_t s; if (parseRef(p[1], s)) addShellRef(s); anyRoot = true; }
        } else if (ins.type == "BREP_WITH_VOIDS") {
            auto p = splitTopLevel(ins.params);
            if (p.size() >= 2) { std::uint64_t s; if (parseRef(p[1], s)) addShellRef(s); }
            if (p.size() >= 3) addShellsFromList(p[2]);   // the void shells
            anyRoot = true;
        } else if (ins.type == "SHELL_BASED_SURFACE_MODEL") {
            auto p = splitTopLevel(ins.params);
            if (p.size() >= 2) addShellsFromList(p[1]);
            anyRoot = true;
        }
    }
    // Fallback: if no solid/surface-model root, take every CLOSED_SHELL directly.
    if (!anyRoot) {
        for (const auto& kv : tab)
            if (kv.second.type == "CLOSED_SHELL" || kv.second.type == "OPEN_SHELL")
                addShellRef(kv.first);
    }
    if (shellIds.empty()) return fail("readForeignStep: no shell (CLOSED_SHELL/OPEN_SHELL) found");

    // gather the ADVANCED_FACE ids (preserve order, dedup).
    std::vector<std::uint64_t> faceIds;
    std::set<std::uint64_t> faceSet;
    for (std::uint64_t sid : shellIds) {
        Instance si; R.get(sid, si);
        auto sp = splitTopLevel(si.params);
        if (sp.size() < 2) continue;
        std::vector<std::string> frefs;
        if (!parseList(sp[1], frefs)) continue;
        for (const auto& fr : frefs) {
            std::uint64_t fid;
            if (parseRef(fr, fid) && faceSet.insert(fid).second) faceIds.push_back(fid);
        }
    }
    if (faceIds.empty()) return fail("readForeignStep: shells contain no faces");

    // --- build the independent native faces -----------------------------------
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

    // Build a native quadric Surface from an ADVANCED_FACE surface id. Returns the
    // simple STEP keyword via `surfType`; sets `isBSpline` and (if so) `nurbsOut`.
    // For unsupported surfaces returns false with the type recorded by the caller.
    auto buildSurface = [&](std::uint64_t surfId, bool sameSense, Surface& s,
                            std::string& surfType, bool& isBSpline,
                            NurbsSurface& nurbsOut, std::string& localWhy,
                            bool& isExtrusion, NurbsCurve& extrProfile, Vec3& extrDir) -> bool {
        Instance ins;
        if (!R.get(surfId, ins)) { localWhy = "dangling surface ref"; return false; }
        isBSpline = false;
        isExtrusion = false;
        // COMPLEX surface record: (BOUNDED_SURFACE()B_SPLINE_SURFACE(...)
        //   B_SPLINE_SURFACE_WITH_KNOTS(...)(RATIONAL_B_SPLINE_SURFACE(...))...)
        if (ins.type.empty()) {
            auto subs = splitComplex(ins.params);
            const SubRecord* base = nullptr;     // B_SPLINE_SURFACE (deg + ctrl + form)
            const SubRecord* knots = nullptr;    // B_SPLINE_SURFACE_WITH_KNOTS (mult+knots)
            const SubRecord* rational = nullptr; // RATIONAL_B_SPLINE_SURFACE (weights)
            for (const auto& sr : subs) {
                if (sr.type == "B_SPLINE_SURFACE") base = &sr;
                else if (sr.type == "B_SPLINE_SURFACE_WITH_KNOTS") knots = &sr;
                else if (sr.type == "RATIONAL_B_SPLINE_SURFACE") rational = &sr;
            }
            if (base && knots) {
                // Assemble the post-name field list expected by buildBSplineSurface:
                //  B_SPLINE_SURFACE: uDeg,vDeg,ctrlGrid,form,uClosed,vClosed,selfInt
                //  B_SPLINE_SURFACE_WITH_KNOTS: uMult,vMult,uKnots,vKnots,knotSpec
                auto bf = splitTopLevel(base->params);
                auto kf = splitTopLevel(knots->params);
                if (bf.size() < 7 || kf.size() < 4) { localWhy = "complex bspline arity"; return false; }
                std::vector<std::string> fields;
                fields.push_back(bf[0]); fields.push_back(bf[1]); fields.push_back(bf[2]);
                fields.push_back(bf[3]); fields.push_back(bf[4]); fields.push_back(bf[5]); fields.push_back(bf[6]);
                fields.push_back(kf[0]); fields.push_back(kf[1]); fields.push_back(kf[2]); fields.push_back(kf[3]);
                std::vector<std::vector<double>> w;
                const std::vector<std::vector<double>>* wp = nullptr;
                if (rational) {
                    auto rf = splitTopLevel(rational->params);
                    if (!rf.empty() && readRationalWeights(rf[0], w)) wp = &w;
                }
                if (!buildBSplineSurface(R, fields, wp, scale, nurbsOut, localWhy)) return false;
                isBSpline = true; surfType = "B_SPLINE_SURFACE_WITH_KNOTS";
                return true;
            }
            localWhy = "unsupported complex surface record"; surfType = "COMPLEX_SURFACE";
            return false;
        }

        surfType = ins.type;
        auto p = splitTopLevel(ins.params);
        auto frame = [&](std::size_t f) -> bool {
            std::uint64_t ax = 0;
            if (p.size() <= f || !parseRef(p[f], ax)) { localWhy = surfType + " placement"; return false; }
            if (!getAxis2(R, ax, s.origin, s.axis, s.refDir)) { localWhy = surfType + " axis2"; return false; }
            s.origin = vscale(s.origin, scale);     // scale the placement origin
            return true;
        };
        if (ins.type == "PLANE") {
            s.kind = SurfaceKind::Plane; if (!frame(1)) return false;
        } else if (ins.type == "CYLINDRICAL_SURFACE") {
            s.kind = SurfaceKind::Cylinder; if (!frame(1)) return false;
            if (p.size() < 3 || !stepNum(p[2], s.r1)) { localWhy = "cyl radius"; return false; }
            s.r1 *= scale;
        } else if (ins.type == "CONICAL_SURFACE") {
            s.kind = SurfaceKind::Cone; if (!frame(1)) return false;
            double refR = 0, half = 0;
            if (p.size() < 4 || !stepNum(p[2], refR) || !stepNum(p[3], half)) { localWhy = "cone"; return false; }
            s.r1 = refR * scale; s.param = std::tan(half); s.r2 = refR * scale;
        } else if (ins.type == "SPHERICAL_SURFACE") {
            s.kind = SurfaceKind::Sphere; if (!frame(1)) return false;
            if (p.size() < 3 || !stepNum(p[2], s.r1)) { localWhy = "sphere radius"; return false; }
            s.r1 *= scale;
        } else if (ins.type == "TOROIDAL_SURFACE") {
            s.kind = SurfaceKind::Torus; if (!frame(1)) return false;
            if (p.size() < 4 || !stepNum(p[2], s.r1) || !stepNum(p[3], s.r2)) { localWhy = "torus"; return false; }
            s.r1 *= scale; s.r2 *= scale;
        } else if (ins.type == "B_SPLINE_SURFACE_WITH_KNOTS") {
            // simple (non-rational) form: drop the leading name field.
            std::vector<std::string> fields(p.begin() + 1, p.end());
            if (!buildBSplineSurface(R, fields, nullptr, scale, nurbsOut, localWhy)) return false;
            isBSpline = true; return true;
        } else if (ins.type == "SURFACE_OF_REVOLUTION") {
            // Revolve a generating CURVE about AXIS1. The common mechanical case is a
            // CIRCLE generator (fillet/round face): revolving a circle about a coplanar
            // axis gives a TORUS (major R = axis->centre distance, minor r = circle r),
            // or a SPHERE when the axis passes through the circle centre. Build it as
            // the native analytic quadric so the exact mass path integrates it.
            std::uint64_t curveId = 0, axId = 0;
            if (p.size() < 3 || !parseRef(p[1], curveId) || !parseRef(p[2], axId)) {
                localWhy = "revolution refs"; return false;
            }
            Vec3 aLoc, aDir;
            if (!getAxis1(R, axId, aLoc, aDir)) { localWhy = "revolution axis1"; return false; }
            aLoc = vscale(aLoc, scale);
            surfType = "SURFACE_OF_REVOLUTION";

            // Analytic TORUS fast path: a CIRCLE generatrix in a plane CONTAINING the
            // axis and well CLEAR of it (majR >= 1.5*minor) is an exact torus (major R
            // = centre->axis distance, minor r = circle radius) — the exact quadric
            // mass path. A near-axis / spindle circle and any non-circle generatrix are
            // handled by the general NURBS-of-revolution below instead.
            bool builtTorus = false;
            Instance ci;
            if (R.get(curveId, ci) && ci.type == "CIRCLE") {
                auto cp = splitTopLevel(ci.params);
                std::uint64_t cax = 0; double crad = 0;
                if (cp.size() >= 3 && parseRef(cp[1], cax) && stepNum(cp[2], crad)) {
                    Vec3 cc, cca, ccref;
                    if (getAxis2(R, cax, cc, cca, ccref)) {
                        cc = vscale(cc, scale); crad *= scale;
                        const Vec3 rel = vsub(cc, aLoc);
                        const double along = vdot(rel, aDir);
                        const Vec3 foot = vadd(aLoc, vscale(aDir, along));
                        const Vec3 radial = vsub(cc, foot);
                        const double majR = vlen(radial);
                        const bool planeContainsAxis = std::fabs(vdot(vnorm(cca), aDir)) < 1e-3;
                        if (majR >= 1.5 * crad && planeContainsAxis) {
                            s.kind = SurfaceKind::Torus; s.origin = foot; s.axis = aDir;
                            s.refDir = vscale(radial, 1.0 / majR);
                            s.r1 = majR; s.r2 = crad;
                            builtTorus = true;
                        }
                    }
                }
            }
            if (!builtTorus) {
                // GENERAL surface of revolution: revolve the generatrix curve (a
                // B-spline, or a spindle/near-axis circle the analytic quadric cannot
                // represent) a full 2*pi about the axis as an EXACT rational NURBS,
                // then route it through the same B-spline face path (trim + region /
                // full-domain mass integral). This recovers the revolved faces the
                // reader previously DROPPED (e.g. 101/147/140/211).
                NurbsCurve gen;
                if (!buildProfileCurve(R, curveId, scale, gen) ||
                    !revolveCurveToNurbs(gen, aLoc, aDir, nurbsOut)) {
                    localWhy = "revolution generatrix"; return false;
                }
                isBSpline = true;
                return true;
            }
        } else if (ins.type == "SURFACE_OF_LINEAR_EXTRUSION") {
            // S(u,v) = C(u) + v*V : a profile CURVE C swept along the VECTOR V.
            // Parse the profile + direction here; the tensor NURBS (degree-1 in v)
            // is assembled in the face loop once the trim's v-extent is known.
            std::uint64_t curveId = 0, vecId = 0;
            if (p.size() < 3 || !parseRef(p[1], curveId) || !parseRef(p[2], vecId)) {
                localWhy = "extrusion refs"; surfType = "SURFACE_OF_LINEAR_EXTRUSION"; return false;
            }
            Instance vi;
            if (!R.get(vecId, vi) || vi.type != "VECTOR") { localWhy = "extrusion vector"; surfType = "SURFACE_OF_LINEAR_EXTRUSION"; return false; }
            auto vparams = splitTopLevel(vi.params);
            std::uint64_t dirId = 0; double mag = 0;
            Vec3 dvec;
            if (vparams.size() < 3 || !parseRef(vparams[1], dirId) || !stepNum(vparams[2], mag) ||
                !getDir(R, dirId, dvec)) {
                localWhy = "extrusion vector fields"; surfType = "SURFACE_OF_LINEAR_EXTRUSION"; return false;
            }
            extrDir = vscale(vnorm(dvec), mag * scale);        // V in mm
            surfType = "SURFACE_OF_LINEAR_EXTRUSION";
            if (vlen(extrDir) < 1e-12) { localWhy = "extrusion vector"; return false; }

            // ANALYTIC fast path: a CIRCLE / ELLIPSE profile extruded PERPENDICULAR
            // to its own plane is an EXACT (elliptical) cylinder. Build the analytic
            // surface so its periodic seam integrates through the robust angular-
            // unwrap region path (the tensor-NURBS form's point inversion cannot
            // close the seam — it wraps u inconsistently and corrupts the region
            // polygon). Oblique or spline profiles fall through to the general NURBS
            // extrusion path below.
            {
                const std::uint64_t rawId = resolve3dCurve(R, curveId);
                Instance pc;
                if (R.get(rawId, pc) && (pc.type == "CIRCLE" || pc.type == "ELLIPSE")) {
                    auto cpf = splitTopLevel(pc.params);
                    std::uint64_t cax = 0; double aMaj = 0, bMin = 0;
                    bool okc = (cpf.size() >= 3) && parseRef(cpf[1], cax) && stepNum(cpf[2], aMaj);
                    if (pc.type == "ELLIPSE") okc = okc && cpf.size() >= 4 && stepNum(cpf[3], bMin);
                    else bMin = aMaj;
                    Vec3 co, cAxis, cRef;
                    if (okc && getAxis2(R, cax, co, cAxis, cRef)) {
                        const Vec3 vN = vnorm(extrDir);
                        if (std::fabs(vdot(vN, vnorm(cAxis))) > 1.0 - 1e-6) {   // V ⊥ profile plane
                            s.origin = vscale(co, scale);
                            s.axis   = vN;
                            s.refDir = vnorm(vsub(vnorm(cRef), vscale(vN, vdot(vnorm(cRef), vN))));
                            if (pc.type == "CIRCLE") {
                                s.kind = SurfaceKind::Cylinder; s.r1 = aMaj * scale;
                            } else {
                                s.kind = SurfaceKind::EllipseExtrusion;
                                s.r1 = aMaj * scale;   // semi-major along refDir
                                s.r2 = bMin * scale;   // semi-minor along binormal
                            }
                            s.reversed = !sameSense;
                            return true;
                        }
                    }
                }
            }

            if (!buildProfileCurve(R, curveId, scale, extrProfile)) {
                localWhy = "extrusion profile"; return false;
            }
            isExtrusion = true;
            return true;
        } else {
            localWhy = "unsupported surface entity '" + ins.type + "'";
            return false;
        }
        s.reversed = !sameSense;
        return true;
    };

    // Resolve a FACE_(OUTER_)BOUND's EDGE_LOOP -> a DENSELY SAMPLED ordered 3D ring
    // that follows each edge's real curve geometry (lines contribute their start
    // vertex; circular / elliptic / spline edges are sampled along the arc). This
    // gives an accurate boundary polygon for a planar face (Green's theorem) and a
    // faithful (u,v)-window sample set for a curved analytic face — and it is robust
    // to the loop patterns commercial exporters emit that the vertex-only ring could
    // not survive: single closed-circle loops (a flat round cap), seam edges (an
    // EDGE_CURVE used twice on a full cylinder / cone), and degenerate collapses.
    struct LoopRing {
        std::vector<Vec3> pts;      // densified 3D ring, loop-traversal sense, deduped
        std::uint64_t loopId = 0;   // EDGE_LOOP id (so a B-spline face can rebuild
                                    // the REAL (u,v) trim loop from its edges)
        bool ok = false;
        bool isSeam = false;        // an EDGE_CURVE is used >=2x (cylinder/cone seam)
        bool hasFullCircle = false; // a closed full-circle edge (start vertex==end)
        int  edgeCount = 0;
    };
    auto readEdgeLoop = [&](std::uint64_t loopId) -> LoopRing {
        LoopRing ring;
        ring.loopId = loopId;
        Instance li;
        if (!R.get(loopId, li) || li.type != "EDGE_LOOP") return ring;
        auto lp = splitTopLevel(li.params);
        std::vector<std::string> oeRefs;
        if (lp.size() < 2 || !parseList(lp[1], oeRefs) || oeRefs.empty()) return ring;
        ring.edgeCount = (int)oeRefs.size();
        std::map<std::uint64_t, int> ecCount;
        std::vector<Vec3> pts;
        for (const auto& oref : oeRefs) {
            std::uint64_t oeId = 0;
            if (!parseRef(oref, oeId)) return LoopRing{};
            Instance oi;
            if (!R.get(oeId, oi) || oi.type != "ORIENTED_EDGE") return LoopRing{};
            auto op = splitTopLevel(oi.params);
            if (op.size() < 5) return LoopRing{};
            std::uint64_t ecId = 0;
            if (!parseRef(op[3], ecId)) return LoopRing{};
            const bool sense = (op[4] == ".T.");
            if (++ecCount[ecId] >= 2) ring.isSeam = true;      // shared seam edge
            EdgeGeom eg = readEdgeGeom(R, ecId, scale);
            if (!eg.ok) return LoopRing{};                     // unreadable edge geometry
            const Vec3 pStart = sense ? eg.v0 : eg.v1;
            const Vec3 pEnd   = sense ? eg.v1 : eg.v0;
            const bool closedEdge = (vlen(vsub(eg.v0, eg.v1)) < 1e-9);
            switch (eg.kind) {
            case EdgeGeomKind::Line:
                pts.push_back(pStart);
                break;
            case EdgeGeomKind::Circle:
            case EdgeGeomKind::Ellipse: {
                if (closedEdge) ring.hasFullCircle = true;
                const Vec3 bdir = vcross(eg.axis, eg.refDir);
                auto ang = [&](const Vec3& P) {
                    const Vec3 r = vsub(P, eg.centre);
                    return std::atan2(vdot(r, bdir), vdot(r, eg.refDir));
                };
                // Traverse the arc on the CORRECT side. STEP parameterises the curve
                // CCW about eg.axis; the loop runs pStart->pEnd CCW iff the EDGE_CURVE
                // same_sense agrees with the ORIENTED_EDGE orientation. Picking the
                // signed span (which can EXCEED pi) fixes reflex arcs that the old
                // "unwrap to +/-pi" always mis-sampled as the short complementary arc.
                const bool ccw = (eg.sameSense == sense);
                const double a0 = ang(pStart), a1 = ang(pEnd);
                double span = a1 - a0;
                if (ccw) { while (span <= 1e-9) span += 2.0 * PI; while (span > 2.0 * PI + 1e-6) span -= 2.0 * PI; }
                else     { while (span >= -1e-9) span -= 2.0 * PI; while (span < -2.0 * PI - 1e-6) span += 2.0 * PI; }
                if (closedEdge) span = ccw ? 2.0 * PI : -2.0 * PI;   // full circle/ellipse
                // 96 samples/2*pi (was 48): a cylinder cut by an INCLINED plane bounds
                // its wall with the intersection ELLIPSE, which maps to a SINUSOID
                // z(theta) in the surface (theta,z) region plane. buildRegionPolygon
                // projects these densified 3D samples to (theta,z) and CHORDS between
                // them; a coarse chord cuts inside/outside the true sinusoid arc, so the
                // scan-line region integral over/under-reads the trimmed wall by the
                // trapezoidal chord error (measured: 240 -2.0% under). Halving Δtheta
                // cuts that O(Δtheta^2) error ~4x and flips 240 (0.0203->0.0192) while
                // 140/141 (fuller arcs, already near-exact by periodic cancellation)
                // stay put (140 0.00085->0.00111).
                int M = (int)std::llround(96.0 * std::fabs(span) / (2.0 * PI));
                if (M < 6) M = 6;
                for (int i = 0; i < M; ++i) {                       // start + interiors (excl. end)
                    const double t = a0 + span * (double(i) / M);
                    Vec3 P;
                    if (eg.kind == EdgeGeomKind::Circle)
                        P = vadd(eg.centre, vadd(vscale(eg.refDir, eg.radius * std::cos(t)),
                                                 vscale(bdir, eg.radius * std::sin(t))));
                    else
                        P = vadd(eg.centre, vadd(vscale(eg.refDir, eg.radius * std::cos(t)),
                                                 vscale(bdir, eg.radius2 * std::sin(t))));
                    pts.push_back(P);
                }
                break;
            }
            case EdgeGeomKind::BSpline: {
                if (closedEdge) ring.hasFullCircle = true;
                if (eg.nurbs.knots.empty()) { pts.push_back(pStart); break; }
                const double t0 = eg.nurbs.knots.front(), t1 = eg.nurbs.knots.back();
                const Vec3 c0 = eg.nurbs.evaluate(t0);
                const bool fwd = (vlen(vsub(c0, pStart)) <= vlen(vsub(c0, pEnd)));
                const int M = 16;
                for (int i = 0; i < M; ++i) {                       // start + interiors (excl. end)
                    const double a = double(i) / M;
                    const double t = fwd ? (t0 + (t1 - t0) * a) : (t1 + (t0 - t1) * a);
                    pts.push_back(eg.nurbs.evaluate(t));
                }
                break;
            }
            }
        }
        // Consecutive-dedup (incl. wrap): folds out seam-collapse zero-length steps
        // so the ring is a clean simple-ish polygon with no repeated adjacent vertex.
        std::vector<Vec3> clean;
        for (const Vec3& p : pts)
            if (clean.empty() || vlen(vsub(clean.back(), p)) > 1e-9) clean.push_back(p);
        while (clean.size() >= 2 && vlen(vsub(clean.front(), clean.back())) < 1e-9)
            clean.pop_back();
        ring.pts = std::move(clean);
        ring.ok = ring.pts.size() >= 1;
        return ring;
    };

    // Build a REAL (u,v) TrimLoop for a NURBS face from an EDGE_LOOP: for every
    // ORIENTED_EDGE -> EDGE_CURVE, read the literal 3D curve + its two file
    // vertices, INVERT them onto the surface (u,v) (Plane analytic / NURBS
    // Gauss-Newton), honour the ORIENTED_EDGE .T./.F. orientation, and emit the
    // matching PCurve (3D LINE -> Line2; 3D CIRCLE/ELLIPSE/B_SPLINE -> a sampled
    // BSpline2 in the surface parameter plane). Segments are appended in ring
    // order so the end of each meets the start of the next. Returns false (with
    // `unsupportedKw` set) on genuinely unsupported edge geometry — NO fabrication.
    // `uvbb` (optional, [uMin,uMax,vMin,vMax]) accumulates the (u,v) bounding box of
    // every inverted trim point so the caller can integrate the B-spline face over
    // the TRIMMED (u,v) window instead of the full knot rectangle (the dominant
    // over/under-count on exporter patches whose knot domain overruns the face).
    // `regionPoly` (optional): the ORDERED (u,v) boundary polygon of this loop in
    // the surface's OWN parameter space — one vertex per densified boundary point,
    // in ring-traversal order, so MassProps::integrateParametricRegion can scan-line
    // integrate the B-spline face over its TRUE trimmed region instead of the knot
    // rectangle (the direct extension of the quadric region path to NURBS patches).
    auto buildTrimLoopNurbs = [&](std::uint64_t loopId, const NurbsSurface& nsurf,
                                  bool isOuter, TrimLoop& out,
                                  std::string& unsupportedKw,
                                  double* uvbb = nullptr,
                                  std::vector<std::array<double, 2>>* regionPoly = nullptr) -> bool {
        auto grow = [&](const UVCoord& uv) {
            if (!uvbb) return;
            uvbb[0] = std::min(uvbb[0], uv.u); uvbb[1] = std::max(uvbb[1], uv.u);
            uvbb[2] = std::min(uvbb[2], uv.v); uvbb[3] = std::max(uvbb[3], uv.v);
        };
        Instance li;
        if (!R.get(loopId, li) || li.type != "EDGE_LOOP") { unsupportedKw = "EDGE_LOOP"; return false; }
        auto lp = splitTopLevel(li.params);
        std::vector<std::string> oeRefs;
        if (lp.size() < 2 || !parseList(lp[1], oeRefs) || oeRefs.empty()) { unsupportedKw = "EDGE_LOOP"; return false; }

        const double bspTol3d = 1e-6 * std::max(1.0,
            std::max({std::fabs(nsurf.knotsU.back()), std::fabs(nsurf.knotsV.back()), 1.0}));
        // 3D convergence tolerance for inversion, scaled to the model bbox diagonal
        // accumulated so far (fall back to a generous absolute if the box is empty).
        double diag = 0.0;
        for (int k = 0; k < 3; ++k) { double d = bboxMax[k]-bboxMin[k]; if (d > 0) diag += d*d; }
        // 3D convergence tolerance for the Gauss-Newton point inversion, RELATIVE to
        // the model size. The prior 1e-7*diag was ultra-tight: measured, the "failing"
        // boundary edges of exporter B-spline patches invert to a genuine on-patch
        // point whose residual is ~1e-5..1e-3 mm on 70..430 mm parts (10 ppm of the
        // part), i.e. they ARE on the patch and the strict tol merely REJECTED them —
        // dooming the whole face to the full knot-RECTANGLE fallback (a gross
        // over/under-count). 1e-5*diag (10 ppm) accepts these true inversions so the
        // face's real trim loop is built and it is region-integrated; a genuinely
        // off-patch point (shared edge on a different patch) still has an mm-scale
        // residual and is honestly rejected.
        const double invTol = (diag > 0) ? 1e-5 * std::sqrt(diag) : 1e-4;
        (void)bspTol3d;

        out.segments.clear();
        out.isOuter = isOuter;
        for (const auto& oref : oeRefs) {
            std::uint64_t oeId = 0;
            if (!parseRef(oref, oeId)) { unsupportedKw = "ORIENTED_EDGE"; return false; }
            Instance oi;
            if (!R.get(oeId, oi) || oi.type != "ORIENTED_EDGE") { unsupportedKw = "ORIENTED_EDGE"; return false; }
            auto op = splitTopLevel(oi.params);
            if (op.size() < 5) { unsupportedKw = "ORIENTED_EDGE"; return false; }
            std::uint64_t ecId = 0;
            if (!parseRef(op[3], ecId)) { unsupportedKw = "ORIENTED_EDGE"; return false; }
            const bool sense = (op[4] == ".T.");      // false -> edge is reversed

            EdgeGeom eg = readEdgeGeom(R, ecId, scale);
            if (!eg.ok) { unsupportedKw = eg.typeKeyword.empty() ? "EDGE_CURVE" : eg.typeKeyword; return false; }

            // Apply ORIENTED_EDGE orientation: the directed edge runs from `pStart`
            // to `pEnd` in 3D (the loop traversal sense).
            Vec3 pStart = sense ? eg.v0 : eg.v1;
            Vec3 pEnd   = sense ? eg.v1 : eg.v0;

            // Invert the endpoints to (u,v).
            UVCoord uvStart{}, uvEnd{};
            if (!invertNurbs(nsurf, pStart, uvStart, invTol) ||
                !invertNurbs(nsurf, pEnd, uvEnd, invTol)) {
                unsupportedKw = "EDGE_CURVE(uninvertible)"; return false;
            }
            grow(uvStart); grow(uvEnd);

            switch (eg.kind) {
            case EdgeGeomKind::Line:
                out.segments.push_back(PCurve::makeLine2(uvStart, uvEnd));
                // Ring vertex: the directed START (the segment's END == the next
                // segment's START, so pushing only the start avoids a duplicate; the
                // loop closes back to poly[0] in integrateParametricRegion).
                if (regionPoly) regionPoly->push_back({uvStart.u, uvStart.v});
                break;
            case EdgeGeomKind::Circle:
            case EdgeGeomKind::Ellipse:
            case EdgeGeomKind::BSpline: {
                // Sample the literal 3D curve from pStart->pEnd and invert each
                // sample onto (u,v), then carry the (u,v) polyline as an open
                // BSpline2 (degree-1 interpolating curve through the inverted
                // samples). This honours the file's actual curved-edge geometry on
                // an arbitrary (curved or planar) NURBS surface — no synthesis.
                const int M = (eg.kind == EdgeGeomKind::BSpline) ? 24 : 16;
                std::vector<Vec3> samples3d;
                samples3d.reserve(M + 1);
                if (eg.kind == EdgeGeomKind::BSpline) {
                    // Find the curve parameters at pStart/pEnd by matching the
                    // clamped end knots to the directed endpoints.
                    const double t0 = eg.nurbs.knots.front(), t1 = eg.nurbs.knots.back();
                    const Vec3 c0 = eg.nurbs.evaluate(t0);
                    const bool fwd = (vlen(vsub(c0, pStart)) <= vlen(vsub(c0, pEnd)));
                    for (int i = 0; i <= M; ++i) {
                        const double a = double(i) / M;
                        const double t = fwd ? (t0 + (t1 - t0) * a) : (t1 + (t0 - t1) * a);
                        samples3d.push_back(eg.nurbs.evaluate(t));
                    }
                } else {
                    // CIRCLE / ELLIPSE: parameterise by angle in the placement frame
                    // from the directed start to the directed end (short or long arc
                    // resolved by the in-plane winding of the endpoints).
                    const Vec3 bdir = vcross(eg.axis, eg.refDir);
                    auto angleOf = [&](const Vec3& P) {
                        const Vec3 rel = vsub(P, eg.centre);
                        return std::atan2(vdot(rel, bdir), vdot(rel, eg.refDir));
                    };
                    const bool closedArc = (vlen(vsub(eg.v0, eg.v1)) < 1e-9);
                    const bool ccw = (eg.sameSense == sense);
                    const double a0 = angleOf(pStart), a1 = angleOf(pEnd);
                    double aspan = a1 - a0;
                    if (ccw) { while (aspan <= 1e-9) aspan += 2.0 * PI; while (aspan > 2.0 * PI + 1e-6) aspan -= 2.0 * PI; }
                    else     { while (aspan >= -1e-9) aspan -= 2.0 * PI; while (aspan < -2.0 * PI - 1e-6) aspan += 2.0 * PI; }
                    if (closedArc) aspan = ccw ? 2.0 * PI : -2.0 * PI;
                    for (int i = 0; i <= M; ++i) {
                        const double t = a0 + aspan * (double(i) / M);
                        Vec3 P;
                        if (eg.kind == EdgeGeomKind::Circle)
                            P = vadd(eg.centre, vadd(vscale(eg.refDir, eg.radius * std::cos(t)),
                                                     vscale(bdir, eg.radius * std::sin(t))));
                        else
                            P = vadd(eg.centre, vadd(vscale(eg.refDir, eg.radius * std::cos(t)),
                                                     vscale(bdir, eg.radius2 * std::sin(t))));
                        samples3d.push_back(P);
                    }
                }
                // Invert every sample onto (u,v).
                NurbsCurve pc; pc.degree = 1;
                pc.controlPoints.reserve(samples3d.size());
                for (const Vec3& P : samples3d) {
                    UVCoord uv{};
                    if (!invertNurbs(nsurf, P, uv, invTol)) { unsupportedKw = "EDGE_CURVE(uninvertible)"; return false; }
                    pc.controlPoints.push_back(Vec3{uv.u, uv.v, 0.0});
                    grow(uv);
                }
                // force the exact directed endpoints (the inversion of a vertex is
                // exact; clamp interior to avoid drift at the seam).
                pc.controlPoints.front() = Vec3{uvStart.u, uvStart.v, 0.0};
                pc.controlPoints.back()  = Vec3{uvEnd.u,   uvEnd.v,   0.0};
                // clamped degree-1 knot vector over [0,1]: (0,0, 1/(M), ..., 1,1) is
                // just the chordal parameter; a degree-1 B-spline is the polyline.
                const std::size_t np = pc.controlPoints.size();
                pc.weights.assign(np, 1.0);
                pc.knots.clear(); pc.knots.reserve(np + 2);
                pc.knots.push_back(0.0);
                for (std::size_t i = 0; i < np; ++i) pc.knots.push_back(double(i) / double(np - 1));
                pc.knots.push_back(1.0);
                // Ring vertices: every densified (u,v) sample of this curved edge
                // EXCEPT the last (== next segment's start), so the region polygon
                // traces the true curved trim boundary in parameter space.
                if (regionPoly)
                    for (std::size_t i = 0; i + 1 < pc.controlPoints.size(); ++i)
                        regionPoly->push_back({pc.controlPoints[i].x, pc.controlPoints[i].y});
                out.segments.push_back(PCurve::makeBSpline2(pc));
                break;
            }
            }
        }
        return !out.segments.empty();
    };

    // process each ADVANCED_FACE. A face the reader cannot reconstruct is RECORDED
    // (result.unsupported) and SKIPPED — never a hard failure of the whole part, so
    // the reader still produces a solid from every face it CAN build (the divergence
    // mass integral then runs over each face independently of shell closure).
    for (std::uint64_t fid : faceIds) {
        Instance fi;
        // ADVANCED_FACE is the AP203/214/242 subtype of FACE_SURFACE restricted to
        // elementary/swept/b-spline geometry; both carry the IDENTICAL field layout
        // (name, (#bound..), #face_geometry, same_sense) so a bare FACE_SURFACE (some
        // exporters emit it directly) parses through the identical path — accept it.
        // Anything else is RECORDED and skipped (not a hard failure): the strict
        // acceptance test lives in importStep, which demands `unsupported.empty()`.
        if (!R.get(fid, fi) || (fi.type != "ADVANCED_FACE" && fi.type != "FACE_SURFACE")) {
            result.unsupported["NON_ADVANCED_FACE"]++; continue;
        }
        auto fp = splitTopLevel(fi.params);
        if (fp.size() < 4) { result.unsupported["FACE_ARITY"]++; continue; }
        std::vector<std::string> boundRefs;
        if (!parseList(fp[1], boundRefs) || boundRefs.empty()) { result.unsupported["NO_BOUND"]++; continue; }
        std::uint64_t surfRef = 0;
        if (!parseRef(fp[2], surfRef)) { result.unsupported["NO_SURFACE"]++; continue; }
        bool sameSense = (fp[3] == ".T.");

        ForeignFaceInfo info;

        // Reconstruct the surface FIRST (so we know quadric vs B-spline).
        Surface protoSurf;
        bool isBSpline = false;
        NurbsSurface nurbs;
        std::string surfType, localWhy;
        bool isExtrusion = false;
        NurbsCurve extrProfile;
        Vec3 extrDir{};
        bool surfOk = buildSurface(surfRef, sameSense, protoSurf, surfType, isBSpline, nurbs, localWhy,
                                   isExtrusion, extrProfile, extrDir);
        info.surfaceType = surfType;
        if (!surfOk) {
            // HONEST: record the unsupported surface, do NOT fabricate or drop.
            info.supported = false;
            result.unsupported[surfType.empty() ? "COMPLEX_SURFACE" : surfType]++;
            result.faceInfos.push_back(info);
            continue;
        }

        // Read every bound: the FACE_OUTER_BOUND (or first FACE_BOUND) is outer; any
        // additional FACE_BOUNDs are holes.
        std::vector<LoopRing> outerRings;     // 0 or 1
        std::vector<LoopRing> innerRings;
        bool loopFail = false;
        for (const auto& bref : boundRefs) {
            std::uint64_t bId = 0;
            if (!parseRef(bref, bId)) continue;
            Instance bi;
            if (!R.get(bId, bi)) continue;
            if (bi.type != "FACE_OUTER_BOUND" && bi.type != "FACE_BOUND") continue;
            auto bp = splitTopLevel(bi.params);
            if (bp.size() < 3) continue;
            std::uint64_t lId = 0;
            if (!parseRef(bp[1], lId)) continue;
            LoopRing ring = readEdgeLoop(lId);
            if (!ring.ok) { loopFail = true; break; }
            if (bi.type == "FACE_OUTER_BOUND" && outerRings.empty())
                outerRings.push_back(std::move(ring));
            else
                innerRings.push_back(std::move(ring));
        }
        if (loopFail) {
            info.supported = false;
            result.unsupported["EDGE_LOOP(unreadable)"]++;
            result.faceInfos.push_back(info);
            continue;
        }
        if (outerRings.empty()) {
            // No explicit FACE_OUTER_BOUND: promote the first inner ring to outer.
            if (innerRings.empty()) {
                info.supported = false;
                result.unsupported["NO_USABLE_BOUND"]++;
                result.faceInfos.push_back(info);
                continue;
            }
            outerRings.push_back(std::move(innerRings.front()));
            innerRings.erase(innerRings.begin());
        }

        // ROBUST OUTER-LOOP SELECTION (PLANAR faces, imported-only). Some exporters
        // mis-tag a small feature loop as FACE_OUTER_BOUND (or tag every bound as a
        // plain FACE_BOUND), so the reader can pick a tiny inner loop as "outer" and
        // leave the REAL boundary as a "hole". integratePlanarExact then SUBTRACTS a
        // hole LARGER than the face — driving that face's area (and, far worse, its
        // signed volume flux ∮ x n_x dA) strongly negative and corrupting the whole
        // shell's divergence volume (measured: part 108 lost ~43% of its volume to
        // exactly two such faces). A hole is ALWAYS strictly interior to its face,
        // hence has SMALLER planar area than the outer boundary — so the true outer
        // loop is simply the one with the LARGEST area. If any inner ring's planar
        // (Newell) area exceeds the current outer's, swap the largest one in. This
        // is confined to PLANAR foreign faces (the swap is skipped for curved
        // quadric/NURBS faces, whose periodic seam rings are the same size and are
        // handled by the region/rectangle path), and it is a NO-OP for every
        // correctly-tagged face — so the currently-passing parts are unchanged.
        if (protoSurf.kind == SurfaceKind::Plane && !innerRings.empty()) {
            auto ringArea = [](const std::vector<Vec3>& p) -> double {
                Vec3 nw{0, 0, 0};
                const std::size_t n = p.size();
                if (n < 3) return 0.0;
                for (std::size_t k = 0; k < n; ++k) {
                    const Vec3& a = p[k];
                    const Vec3& b = p[(k + 1) % n];
                    nw.x += (a.y - b.y) * (a.z + b.z);
                    nw.y += (a.z - b.z) * (a.x + b.x);
                    nw.z += (a.x - b.x) * (a.y + b.y);
                }
                return 0.5 * vlen(nw);
            };
            double outerArea = ringArea(outerRings[0].pts);
            int bestInner = -1;
            double bestArea = outerArea;
            for (std::size_t i = 0; i < innerRings.size(); ++i) {
                const double a = ringArea(innerRings[i].pts);
                if (a > bestArea) { bestArea = a; bestInner = (int)i; }
            }
            if (bestInner >= 0) std::swap(outerRings[0], innerRings[(std::size_t)bestInner]);
        }

        // SURFACE_OF_LINEAR_EXTRUSION -> exact tensor NURBS. A linear extrusion
        // S(u,v)=C(u)+v*V is a RULED surface: degree-1 in v with two control rows
        // (the profile at v=vLo and at v=vHi), so it is represented EXACTLY as a
        // NURBS with the profile's own (u-degree,u-knots) and vKnots={vLo,vLo,vHi,vHi}.
        // The v-extent [vLo,vHi] is recovered from the face's own boundary ring: for
        // any boundary point P, v=(P-C(u))·V/|V|^2, and C(u)·V lies in the profile
        // control points' [cMin,cMax] hull, so [ (pMin-cMax), (pMax-cMin) ]/|V|^2
        // is a tight superset of the true v-range. Building it (vs. dropping the
        // face) CLOSES the shell; it then flows through the identical NURBS trim +
        // region mass path. Genuinely off-hull margin is trimmed by the region loop.
        if (isExtrusion) {
            const std::vector<Vec3>& rp = outerRings[0].pts;
            const double VdotV = vdot(extrDir, extrDir);
            if (rp.size() >= 3 && VdotV > 1e-24 && extrProfile.valid()) {
                double cMin = 1e300, cMax = -1e300;
                for (const Vec3& c : extrProfile.controlPoints) {
                    const double d = vdot(c, extrDir);
                    cMin = std::min(cMin, d); cMax = std::max(cMax, d);
                }
                double pMin = 1e300, pMax = -1e300;
                for (const Vec3& P : rp) {
                    const double d = vdot(P, extrDir);
                    pMin = std::min(pMin, d); pMax = std::max(pMax, d);
                }
                double vLo = (pMin - cMax) / VdotV, vHi = (pMax - cMin) / VdotV;
                if (vHi > vLo + 1e-12) {
                    const double margin = 0.02 * (vHi - vLo);
                    vLo -= margin; vHi += margin;
                    const std::size_t nU = extrProfile.controlPoints.size();
                    nurbs = NurbsSurface{};
                    nurbs.degreeU = extrProfile.degree;
                    nurbs.knotsU  = extrProfile.knots;
                    nurbs.degreeV = 1;
                    nurbs.knotsV  = {vLo, vLo, vHi, vHi};
                    nurbs.control.assign(nU, {});
                    nurbs.weights.assign(nU, {});
                    for (std::size_t i = 0; i < nU; ++i) {
                        const Vec3 c = extrProfile.controlPoints[i];
                        const double w = (i < extrProfile.weights.size()) ? extrProfile.weights[i] : 1.0;
                        nurbs.control[i] = { vadd(c, vscale(extrDir, vLo)), vadd(c, vscale(extrDir, vHi)) };
                        nurbs.weights[i] = { w, w };
                    }
                    if (nurbs.valid()) isBSpline = true;
                }
            }
            if (!isBSpline) {   // could not assemble a valid extrusion patch — honest skip
                info.supported = false;
                result.unsupported["SURFACE_OF_LINEAR_EXTRUSION"]++;
                result.faceInfos.push_back(info);
                continue;
            }
        }

        // Build the native face with its outer ring (INDEPENDENT vertices/edges).
        auto makeRingVertices = [&](const LoopRing& ring) {
            std::vector<Vertex*> vs;
            vs.reserve(ring.pts.size());
            for (const Vec3& p : ring.pts) { growBox(p); vs.push_back(tb.makeVertex(P3(p))); }
            return vs;
        };
        std::vector<Vertex*> outerVerts = makeRingVertices(outerRings[0]);
        // A face whose densified boundary collapses to < 3 distinct vertices carries
        // no integrable area (a sliver / degenerate loop) — record & skip.
        if (outerVerts.size() < 3) {
            info.supported = false;
            result.unsupported["DEGENERATE_LOOP"]++;
            result.faceInfos.push_back(info);
            continue;
        }

        // For a PLANAR face the exact divergence integral (integratePlanarExact) fans
        // the boundary polygon with the SIGNED area about the outward normal, so the
        // ring MUST wind counter-clockwise about that outward normal. Commercial
        // exporters do not guarantee a consistent sense here, so NORMALISE it: compute
        // the polygon's own normal (Newell) and reverse the ring if it opposes the
        // face's outward normal (= plane axis, flipped by !same_sense).
        if (protoSurf.kind == SurfaceKind::Plane) {
            Vec3 nw{0, 0, 0};
            const std::size_t np = outerVerts.size();
            for (std::size_t k = 0; k < np; ++k) {
                const Vec3 a = PV(outerVerts[k]->point);
                const Vec3 b = PV(outerVerts[(k + 1) % np]->point);
                nw.x += (a.y - b.y) * (a.z + b.z);
                nw.y += (a.z - b.z) * (a.x + b.x);
                nw.z += (a.x - b.x) * (a.y + b.y);
            }
            const Vec3 outward = protoSurf.reversed ? vscale(protoSurf.axis, -1.0) : protoSurf.axis;
            if (vdot(nw, outward) < 0.0) std::reverse(outerVerts.begin(), outerVerts.end());
        }

        Face* f = tb.makeFace();
        tb.addOuterLoopToFace(f, outerVerts);
        // NOTE: faces are NOT added to a shell here — sewFaces() builds the
        // connected shells from the independent face list below and attaches each
        // face to its shell. Pre-attaching would double-register the face.

        // hole loops
        for (const LoopRing& hr : innerRings) {
            std::vector<Vertex*> hv = makeRingVertices(hr);
            if (hv.size() >= 3) tb.addInnerLoopToFace(f, hv);
        }
        info.innerLoopCount = innerRings.size();

        Surface* surf = tb.makeSurface();
        if (isBSpline) {
            // native Nurbs Surface carrying the reconstructed B-spline (so the
            // solid integrates via the same divergence path).
            surf->kind = SurfaceKind::Nurbs;
            surf->nurbs = nurbs;
            surf->reversed = !sameSense;
            // Build a TrimmedFace whose loops are the FILE's REAL boundary loops:
            // the outer FACE_OUTER_BOUND and every inner FACE_BOUND (hole), each
            // reconstructed by inverting the literal 3D edges onto the surface
            // (u,v). The hole therefore has the file's actual shape — NO synthetic
            // round hole. If any loop carries genuinely unsupported edge geometry,
            // the face is recorded as unsupported (honest), not fabricated.
            TrimmedFace tf;
            tf.surface = nurbs;
            const double u0 = nurbs.knotsU.front(), u1 = nurbs.knotsU.back();
            const double v0 = nurbs.knotsV.front(), v1 = nurbs.knotsV.back();
            bool trimOk = true;
            std::string unsupKw;
            TrimLoop outer;
            double obb[4] = {1e300, -1e300, 1e300, -1e300};   // outer-loop (u,v) bbox
            std::vector<std::array<double, 2>> outerRegionPoly;               // real trim (u,v) outer
            std::vector<std::vector<std::array<double, 2>>> innerRegionPolys; // real trim (u,v) holes
            if (!buildTrimLoopNurbs(outerRings[0].loopId, nurbs, /*isOuter=*/true,
                                    outer, unsupKw, obb, &outerRegionPoly)) {
                trimOk = false;
            } else {
                tf.loops.push_back(std::move(outer));
                for (const LoopRing& hr : innerRings) {
                    TrimLoop hole;
                    std::string hk;
                    std::vector<std::array<double, 2>> holePoly;
                    if (!buildTrimLoopNurbs(hr.loopId, nurbs, /*isOuter=*/false, hole, hk,
                                            nullptr, &holePoly)) {
                        trimOk = false; unsupKw = hk; break;
                    }
                    tf.loops.push_back(std::move(hole));
                    if (holePoly.size() >= 3) innerRegionPolys.push_back(std::move(holePoly));
                }
            }
            // The mass integral for a NURBS face runs over the FULL knot rectangle
            // (integrateParametric), so the (u,v) TRIM loop is NOT needed for volume —
            // it only feeds tessellation. When the trim inversion fails (a boundary
            // edge that will not invert onto this patch) we therefore KEEP the face
            // with its full-domain window rather than DROP it: a dropped face leaves a
            // hole in the shell and corrupts the divergence volume far more than a
            // patch that is (at worst) the exporter's untrimmed fit region. Only the
            // tessellation trim is recorded when it succeeded.
            f->surface = surf;
            if (trimOk) {
                info.trimmedIndex = (long)result.trimmedFaces.size();
                result.trimmedFaces.push_back(std::move(tf));
                // Integrate over the TRIMMED (u,v) window (clamped into the knot
                // domain), not the full knot rectangle: exporter B-spline patches
                // routinely carry a knot domain wider than the actual face, so the
                // full-rectangle divergence integral over/under-counts the patch.
                // A well-fit patch (knot domain == face) leaves the window ~unchanged.
                if (obb[0] <= obb[1] && obb[2] <= obb[3]) {
                    f->u0 = std::max(u0, obb[0]); f->u1 = std::min(u1, obb[1]);
                    f->v0 = std::max(v0, obb[2]); f->v1 = std::min(v1, obb[3]);
                } else {
                    f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;
                }
                // Route the trimmed B-spline face through the SCAN-LINE region
                // integrator over its REAL (u,v) trim polygon (outer minus holes),
                // exactly like the quadric region path — this replaces the knot/bbox
                // RECTANGLE (which over-counts when the true trim is not a rectangle)
                // with the actual trimmed region. Clamp the polygon into the clamped
                // knot domain so an inversion that drifted slightly outside cannot
                // sample the surface off its defined parameter range.
                if (outerRegionPoly.size() >= 3) {
                    for (auto& p : outerRegionPoly) {
                        p[0] = std::max(u0, std::min(u1, p[0]));
                        p[1] = std::max(v0, std::min(v1, p[1]));
                    }
                    for (auto& hp : innerRegionPolys)
                        for (auto& p : hp) {
                            p[0] = std::max(u0, std::min(u1, p[0]));
                            p[1] = std::max(v0, std::min(v1, p[1]));
                        }
                    f->regionOuterUV = std::move(outerRegionPoly);
                    f->regionInnerUV = std::move(innerRegionPolys);
                    f->regionUV = true;
                }
            } else {
                // STRICT trim inversion did not fully converge on some edge — but
                // the FULL knot RECTANGLE fallback catastrophically over-counts
                // (measured: model 211 = +3600% because ~137 patches integrate
                // their whole fit domain instead of the small trimmed face). Recover
                // a BOUNDED trim region by projecting the face's REAL densified 3D
                // boundary rings onto the patch (nearest-point inversion, never
                // fails) and integrating that region via the scan-line path — the
                // NURBS analogue of the quadric region path. Worst case this is the
                // projection of the true boundary (a tight over/under-estimate),
                // never the gross full-domain rectangle.
                result.unsupported[unsupKw.empty() ? "EDGE_CURVE" : unsupKw]++;
                double invTolF = 0.0;
                { double dg = 0.0; for (int k = 0; k < 3; ++k) { double d = bboxMax[k]-bboxMin[k]; if (d > 0) dg += d*d; }
                  invTolF = (dg > 0) ? 1e-5*std::sqrt(dg) : 1e-4; }
                double rbb[4] = {1e300, -1e300, 1e300, -1e300};   // projected (u,v) bbox
                std::vector<std::array<double, 2>> reg =
                    buildRegionPolygonNurbs(outerRings[0].pts, nurbs, invTolF, rbb);
                std::vector<std::vector<std::array<double, 2>>> regHoles;
                for (const LoopRing& hr : innerRings) {
                    std::vector<std::array<double, 2>> hp =
                        buildRegionPolygonNurbs(hr.pts, nurbs, invTolF, nullptr);
                    if (hp.size() >= 3) regHoles.push_back(std::move(hp));
                }
                // Integrate over the projected region (clamped into the knot domain).
                // For a WELL-FIT patch the projection is the full rectangle, so the
                // scan-line converges to the same integral; for an over-running
                // exporter patch it is the bounded true trim — never the gross
                // full-domain rectangle. (Measured on this corpus: strictly better
                // than the old full-rectangle fallback — vol-match 56 -> 57 with
                // model 211 dropping +3600% -> ~4%.)
                bool regOk = false;
                if (reg.size() >= 3 && rbb[0] <= rbb[1] && rbb[2] <= rbb[3]) {
                    for (auto& p : reg) { p[0]=std::max(u0,std::min(u1,p[0])); p[1]=std::max(v0,std::min(v1,p[1])); }
                    for (auto& hp : regHoles) for (auto& p : hp) { p[0]=std::max(u0,std::min(u1,p[0])); p[1]=std::max(v0,std::min(v1,p[1])); }
                    f->u0 = std::max(u0, rbb[0]); f->u1 = std::min(u1, rbb[1]);
                    f->v0 = std::max(v0, rbb[2]); f->v1 = std::min(v1, rbb[3]);
                    f->regionOuterUV = std::move(reg);
                    f->regionInnerUV = std::move(regHoles);
                    f->regionUV = true;
                    regOk = true;
                }
                if (!regOk) { f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1; }
            }
        } else if (protoSurf.kind == SurfaceKind::Plane) {
            // PLANAR face — integrated EXACTLY by the divergence surface integral over
            // its boundary polygon (Green's theorem via integratePlanarExact). The
            // densified outer ring follows the true boundary (straight + circular +
            // spline edges), so a disk / annulus / rounded plate all round-trip; inner
            // FACE_BOUNDs are the holes, SUBTRACTED with the same plane normal.
            *surf = protoSurf;
            f->surface = surf;
            if (!innerRings.empty()) f->boolHoled = true;
        } else if (protoSurf.kind == SurfaceKind::Cylinder ||
                   protoSurf.kind == SurfaceKind::Cone ||
                   protoSurf.kind == SurfaceKind::EllipseExtrusion) {
            // CYLINDER / CONE / ELLIPSE-EXTRUSION: the mass integral runs over the
            // (u,v) trim rectangle (integrateParametric) or its region. Derive u =
            // angular span, v = axial span DIRECTLY from the densified boundary
            // samples with SEQUENTIAL theta-unwrapping (each sample within +/-pi of
            // its predecessor along the loop) — robust for arcs of ANY span. A seam /
            // closed full-circle rim ⇒ full 2*pi. For the elliptical cylinder u is the
            // ELLIPSE angle (cos u = x/a, sin u = y/b), v the axial distance.
            *surf = protoSurf;
            f->surface = surf;
            const std::vector<Vec3>& rp = outerRings[0].pts;
            const Vec3 ax = vnorm(surf->axis), rd = vnorm(surf->refDir), bd = vcross(ax, rd);
            const bool ellExt = (protoSurf.kind == SurfaceKind::EllipseExtrusion);
            double thPrev = 0.0, uMin = 0, uMax = 0, zMin = 0, zMax = 0;
            for (std::size_t i = 0; i < rp.size(); ++i) {
                const Vec3 rel = vsub(rp[i], surf->origin);
                double th = ellExt
                    ? std::atan2(vdot(rel, bd) / (surf->r2 > 1e-12 ? surf->r2 : 1.0),
                                 vdot(rel, rd) / (surf->r1 > 1e-12 ? surf->r1 : 1.0))
                    : std::atan2(vdot(rel, bd), vdot(rel, rd));
                const double z = vdot(rel, ax);
                if (i == 0) { thPrev = th; uMin = uMax = th; zMin = zMax = z; }
                else {
                    while (th - thPrev >  PI) th -= 2.0 * PI;
                    while (th - thPrev < -PI) th += 2.0 * PI;
                    thPrev = th;
                    uMin = std::min(uMin, th); uMax = std::max(uMax, th);
                    zMin = std::min(zMin, z);  zMax = std::max(zMax, z);
                }
            }
            // Close to a full periodic wrap ONLY when the (now correctly-sampled)
            // boundary GENUINELY spans ~2*pi. With sense-aware arc sampling the
            // sequential theta-unwrap yields the true angular extent, so a seam /
            // closed-circle edge no longer needs to force 2*pi (that mis-read a
            // partial/half cylinder that merely reuses a seam curve — e.g. 122/136).
            const double uSpan = uMax - uMin;
            if (uSpan >= 1.9 * PI) { uMin = 0.0; uMax = 2.0 * PI; }
            f->u0 = uMin; f->u1 = uMax;
            if (protoSurf.kind == SurfaceKind::Cylinder || ellExt) {
                f->v0 = zMin; f->v1 = zMax;      // axial z is absolute along the axis
            } else {
                // CONE height recovery: v is normalised [0,1] over height `param`, with
                // radius r1 at v=0 and r2 at v=1. buildSurface left r1=r2=refRadius and
                // param=tan(halfAngle); rebuild them for the actual axial [zMin,zMax].
                const double H = zMax - zMin;
                if (H < 1e-12) { info.supported = false; result.unsupported["QUADRIC_PARAM"]++; result.faceInfos.push_back(info); continue; }
                const double refR = surf->r1, slope = surf->param;
                surf->origin = vadd(surf->origin, vscale(ax, zMin));
                surf->r1 = refR + slope * zMin;
                surf->r2 = refR + slope * zMax;
                surf->param = H;
                f->v0 = 0.0; f->v1 = 1.0;
            }
        } else {
            // SPHERE / TORUS: keep the vertex-based parameterisation (pole/phi handling).
            *surf = protoSurf;
            f->surface = surf;
            const std::vector<bool>   hc(outerVerts.size(), false);
            const std::vector<Vec3>   cz(outerVerts.size(), Vec3{0, 0, 0});
            const std::vector<double> rz(outerVerts.size(), 0.0);
            if (!parameteriseQuadric(f, surf, outerVerts, hc, cz, cz, rz)) {
                info.supported = false;
                result.unsupported["QUADRIC_PARAM"]++;
                result.faceInfos.push_back(info);
                continue;
            }
            if (outerRings[0].isSeam || outerRings[0].hasFullCircle) {
                f->u0 = 0.0; f->u1 = 2.0 * PI;
            }
        }

        // TRIMMED-REGION (u,v) polygon for the SCAN-LINE mass integral. For a
        // curved analytic quadric (cylinder/cone/sphere/torus) the reader's
        // [u0,u1]x[v0,v1] rectangle over-counts whenever the real trim is not a
        // full rectangle (inner holes, closed-inner-circle edges, non-rectangular
        // trims, or an OCCT-split-vs-native-merged periodic face wrongly forced to
        // 2*pi). Two cases, distinguished by whether the OUTER boundary is a SIMPLE
        // (u,v) loop:
        //   * NO closed full-circle RIM edge on the outer loop: the densified
        //     boundary (arcs + lines + seams) inverts to a PROPER simple (u,v)
        //     loop — build it and integrate the REAL region (this recovers both the
        //     genuinely-partial faces AND the periodic faces the reader wrongly
        //     forced to 2*pi).
        //   * A closed full-circle RIM edge on the outer loop (genuinely full 2*pi
        //     periodic): the raw boundary is disconnected full circles, which do
        //     NOT form a simple (u,v) loop (scan-line would mis-read it), so KEEP
        //     the byte-identical rectangle path when there are no holes, and only
        //     when the face DOES carry holes synthesize a CLEAN rectangle outer
        //     [u0,u1]x[v0,v1] so the holes are cut out.
        // Native primitives never take this path (regionUV stays false), so the
        // core mass gate is byte-identical.
        if (f->surface &&
            (f->surface->kind == SurfaceKind::Cylinder ||
             f->surface->kind == SurfaceKind::Cone ||
             f->surface->kind == SurfaceKind::Sphere ||
             f->surface->kind == SurfaceKind::Torus ||
             f->surface->kind == SurfaceKind::EllipseExtrusion)) {
            const double thA = 0.5 * (f->u0 + f->u1);
            std::vector<std::array<double, 2>> outerPoly =
                buildRegionPolygon(outerRings[0].pts, f->surface, std::nan(""));
            if (outerPoly.size() >= 3) {
                f->regionOuterUV = std::move(outerPoly);
                for (const LoopRing& hr : innerRings) {
                    std::vector<std::array<double, 2>> hp =
                        buildRegionPolygon(hr.pts, f->surface, thA);
                    if (hp.size() >= 3) f->regionInnerUV.push_back(std::move(hp));
                }
                f->regionUV = true;
            }
        }

        info.nativeFace = f;
        info.supported = true;
        result.faceInfos.push_back(info);
        builtFaces.push_back(f);
    }

    if (builtFaces.empty())
        return fail("readForeignStep: no supported faces were built (all unsupported)");

    // --- NATIVE SEW the independent faces into a shell (K1.4) ------------------
    double tol = sewTol;
    if (tol <= 0.0) {
        double diag = 0.0;
        for (int k = 0; k < 3; ++k) {
            double d = bboxMax[k] - bboxMin[k];
            diag += d * d;
        }
        diag = std::sqrt(std::max(diag, 1.0));
        tol = 1e-7 * diag;
        if (tol < 1e-9) tol = 1e-9;
    } else {
        tol *= scale;   // sewTol given in file units
    }
    SewOptions sopt; sopt.tol = tol; sopt.weldVertices = true;
    SewResult sr = sewFaces(tb, builtFaces, sopt);
    if (!sr.ok)
        return fail(std::string("readForeignStep: sew failed — ") + (sr.reason ? sr.reason : ""));

    // attach the sewn shells to the solid.
    for (Shell* sh : sr.shells) {
        if (sh) { tb.addShellToSolid(solid, sh); result.shells.push_back(sh); }
    }
    // ensure every built face is owned by some shell (sewFaces builds the shells).

    // --- WATERTIGHT-SOUP keystone (StepWatertight.hpp), both OFF by default -----
    // GWN face REORIENTATION: with the welded shell as an orientation-independent
    // oracle, align each face's analytic outward normal to the material exterior so
    // the divergence mass integral is over a consistently-outward boundary. NO-OP
    // unless FORGE_WT_REORIENT is set AND the welded soup is watertight enough to
    // trust — so the default build is byte-identical (native primitives never reach
    // here; the foreign A/B parity is unchanged when the flag is unset).
    if (solid && std::getenv("FORGE_WT_REORIENT")) {
        ReorientResult ro = reorientByGWN(*solid);
        if (std::getenv("FORGE_WT_PROBE"))
            std::fprintf(stderr, "[wt-reorient] faces=%d flipped=%d wnSign=%+.0f reliable=%d\n",
                         ro.faces, ro.flipped, ro.wnSign, (int)ro.reliable);
    }
    // WATERTIGHTNESS SELF-TEST: prove the welded boundary-fan soup is watertight
    // (freeEdges->0, |wn(centroid)|->1) versus the naive per-face param-grid soup
    // (the cracked "before": high freeEdges, wn->0). Read-only; stderr only.
    if (solid && std::getenv("FORGE_WT_PROBE")) {
        const WatertightReport w = probeWatertightWelded(*solid);
        const WatertightReport n = probeWatertightNaive(*solid);
        std::fprintf(stderr,
            "[wt-probe] WELDED  faces=%zu tris=%zu free=%zu nonManif=%zu conflicts=%d "
            "wnCentroid=%+.4f wnInterior=%+.4f near1=%d watertight=%d\n",
            w.faces, w.triangles, w.freeEdges, w.nonManifoldEdges, w.orientationConflicts,
            w.wnCentroid, w.wnBestInterior, w.interiorNearOne, (int)w.watertight);
        std::fprintf(stderr,
            "[wt-probe] NAIVE   faces=%zu tris=%zu free=%zu nonManif=%zu conflicts=%d "
            "wnCentroid=%+.4f wnInterior=%+.4f near1=%d watertight=%d\n",
            n.faces, n.triangles, n.freeEdges, n.nonManifoldEdges, n.orientationConflicts,
            n.wnCentroid, n.wnBestInterior, n.interiorNearOne, (int)n.watertight);
    }

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
