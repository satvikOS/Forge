// ============================================================================
// forge::ft — parser (text -> FeatureTree) + compiler (FeatureTree -> native
// forge-kernel calls -> real 3D solid -> STEP).
//
// See include/forge/ft/FeatureTree.hpp for the IR + grammar. This TU is the
// only place the op vocabulary is bound to concrete kernel calls:
//
//   RECT/RRECT/CIRCLE/SLOT/POLY/REGPOLY  -> forge::createSketch + addPoint/
//                                           addLine/addCircle/addArc
//   BOX/CYL/CONE/SPHERE/TORUS/PRISM/TUBE -> forge::makeBox/makeCylinder/...
//   EXTRUDE/REVOLVE/LOFT                 -> forge::part::extrudeProfile/
//                                           revolveProfile/loft
//   FUSE/CUT/COMMON                      -> forge::fuse/cut/common
//   TRANSLATE/ROTATE                     -> forge::translate/rotate
//   HOLE/CBORE                           -> forge::makeCylinder cutter + forge::cut
//   FILLET/CHAMFER                       -> forge::direct::edgeSegments (select) +
//                                           forge::part::filletEdges/chamferEdges
//   SHELL                                -> forge::direct::inferFeature (pick open
//                                           face) + forge::part::shell (inward)
//   HEAL                                 -> forge::heal (repair/simplify)
//   export                              -> forge::io::exportStep
//
// The compiler forces the OCCT analytic backend (setForgeNativeBrepEnabled(false))
// for the duration of a build — exactly the clean-B-rep path native_compile.mjs
// relies on (analytic 3-face cylinders, clean booleans, working fillet/shell) —
// and restores the prior gate state afterwards.
// ============================================================================

#include "forge/ft/FeatureTree.hpp"

#include "forge/Primitives.hpp"
#include "forge/Booleans.hpp"
#include "forge/Transform.hpp"
#include "forge/Features.hpp"
#include "forge/Sketcher.hpp"
#include "forge/IoExchange.hpp"
#include "forge/MassProps.hpp"
#include "forge/Healing.hpp"
#include "forge/DirectModeling.hpp"
#include "forge/Tessellate.hpp"

#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"
#endif

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

namespace forge {
namespace ft {

namespace {

constexpr double kPi = 3.14159265358979323846;

// ------------------------------------------------------------------ string utils
std::string trim(const std::string& s) {
    std::size_t a = 0, b = s.size();
    while (a < b && std::isspace(static_cast<unsigned char>(s[a]))) ++a;
    while (b > a && std::isspace(static_cast<unsigned char>(s[b - 1]))) --b;
    return s.substr(a, b - a);
}

std::string upper(std::string s) {
    for (char& c : s) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return s;
}

// Split on `delim` at the TOP level (never inside [ ... ]).
std::vector<std::string> splitTop(const std::string& s, char delim) {
    std::vector<std::string> out;
    int depth = 0;
    std::string cur;
    for (char c : s) {
        if (c == '[') ++depth;
        else if (c == ']') --depth;
        if (c == delim && depth == 0) { out.push_back(cur); cur.clear(); }
        else cur.push_back(c);
    }
    out.push_back(cur);
    return out;
}

bool parseDouble(const std::string& s, double& out) {
    if (s.empty()) return false;
    const char* p = s.c_str();
    char* end = nullptr;
    out = std::strtod(p, &end);
    if (end == p) return false;
    while (*end && std::isspace(static_cast<unsigned char>(*end))) ++end;
    return *end == '\0';
}

// ------------------------------------------------------------------ op table
OpCode opFromName(const std::string& nameUpper, bool& known) {
    static const std::unordered_map<std::string, OpCode> tbl = {
        {"RECT", OpCode::Rect}, {"RRECT", OpCode::RRect}, {"CIRCLE", OpCode::Circle},
        {"SLOT", OpCode::Slot}, {"POLY", OpCode::Poly}, {"REGPOLY", OpCode::RegPoly},
        {"BOX", OpCode::Box}, {"CYL", OpCode::Cyl}, {"CONE", OpCode::Cone},
        {"SPHERE", OpCode::Sphere}, {"TORUS", OpCode::Torus}, {"PRISM", OpCode::Prism},
        {"TUBE", OpCode::Tube},
        {"EXTRUDE", OpCode::Extrude}, {"REVOLVE", OpCode::Revolve}, {"LOFT", OpCode::Loft},
        {"FUSE", OpCode::Fuse}, {"CUT", OpCode::Cut}, {"COMMON", OpCode::Common},
        {"TRANSLATE", OpCode::Translate}, {"ROTATE", OpCode::Rotate},
        {"HOLE", OpCode::Hole}, {"CBORE", OpCode::Cbore}, {"FILLET", OpCode::Fillet},
        {"CHAMFER", OpCode::Chamfer}, {"SHELL", OpCode::Shell}, {"HEAL", OpCode::Heal},
    };
    auto it = tbl.find(nameUpper);
    known = (it != tbl.end());
    return known ? it->second : OpCode::Box;
}

}  // namespace

// ============================================================================
// PARSER
// ============================================================================
FeatureTree parse(const std::string& text) {
    FeatureTree ft;
    std::istringstream in(text);
    std::string raw;
    int lineNo = 0;

    auto fail = [&](const std::string& why) {
        throw std::runtime_error("ft parse line " + std::to_string(lineNo) + ": " + why);
    };

    while (std::getline(in, raw)) {
        ++lineNo;
        // strip inline comment
        std::size_t hash = raw.find('#');
        std::string line = trim(hash == std::string::npos ? raw : raw.substr(0, hash));
        if (line.empty()) continue;

        // RESULT(%id)
        if (upper(line).rfind("RESULT", 0) == 0) {
            std::size_t lp = line.find('('), rp = line.rfind(')');
            if (lp == std::string::npos || rp == std::string::npos || rp < lp)
                fail("malformed RESULT(...)");
            std::string inner = trim(line.substr(lp + 1, rp - lp - 1));
            if (inner.empty() || inner[0] != '%') fail("RESULT expects %id");
            double v;
            if (!parseDouble(inner.substr(1), v)) fail("RESULT expects %id");
            ft.resultId = static_cast<int>(v);
            continue;
        }

        // %id = OP(args)
        std::size_t eq = line.find('=');
        if (eq == std::string::npos) fail("expected `%id = OP(...)` or `RESULT(%id)`");
        std::string lhs = trim(line.substr(0, eq));
        std::string rhs = trim(line.substr(eq + 1));
        if (lhs.empty() || lhs[0] != '%') fail("left side must be %id");
        double idv;
        if (!parseDouble(lhs.substr(1), idv)) fail("bad %id on left side");

        std::size_t lp = rhs.find('('), rp = rhs.rfind(')');
        if (lp == std::string::npos || rp == std::string::npos || rp < lp)
            fail("expected OP( ... )");
        std::string name = trim(rhs.substr(0, lp));
        std::string inner = trim(rhs.substr(lp + 1, rp - lp - 1));

        Op op;
        op.id = static_cast<int>(idv);
        op.name = name;
        op.srcLine = lineNo;
        bool known = false;
        op.code = opFromName(upper(name), known);
        if (!known) fail("unknown op `" + name + "`");

        if (op.code == OpCode::Poly) {
            // POLY([x y; x y; ...])
            std::size_t b0 = inner.find('['), b1 = inner.rfind(']');
            if (b0 == std::string::npos || b1 == std::string::npos || b1 < b0)
                fail("POLY expects [x y; x y; ...]");
            std::string body = inner.substr(b0 + 1, b1 - b0 - 1);
            for (auto& ptStr : splitTop(body, ';')) {
                std::string t = trim(ptStr);
                if (t.empty()) continue;
                std::istringstream ps(t);
                double x, y;
                if (!(ps >> x >> y)) fail("POLY point must be `x y`");
                op.poly.push_back(Point2{x, y});
            }
            if (op.poly.size() < 3) fail("POLY needs >= 3 points");
        } else if (!inner.empty()) {
            for (auto& argStr : splitTop(inner, ',')) {
                std::string t = trim(argStr);
                if (t.empty()) continue;
                Token tok;
                if (t[0] == '%') {
                    double v;
                    if (!parseDouble(t.substr(1), v)) fail("bad %ref `" + t + "`");
                    tok.kind = TokKind::Ref;
                    tok.ref = static_cast<int>(v);
                } else {
                    double v;
                    if (parseDouble(t, v)) { tok.kind = TokKind::Number; tok.num = v; }
                    else { tok.kind = TokKind::Keyword; tok.kw = upper(t); }
                }
                op.args.push_back(tok);
            }
        }
        ft.ops.push_back(std::move(op));
    }
    return ft;
}

// ============================================================================
// COMPILER
// ============================================================================
namespace {

struct Val {
    enum Kind { Profile, Solid } kind = Solid;
    Handle h = 0;
};

// A local exception carrying the offending op id for loud, precise failure.
struct OpError : std::runtime_error {
    int opId;
    OpError(int id, const std::string& msg) : std::runtime_error(msg), opId(id) {}
};

class Builder {
public:
    Handle build(const Op& op, std::unordered_map<int, Val>& env) {
        switch (op.code) {
            // ---- 2D profiles ----
            case OpCode::Rect:    return profRect(op);
            case OpCode::RRect:   return profRRect(op);
            case OpCode::Circle:  return profCircle(op);
            case OpCode::Slot:    return profSlot(op);
            case OpCode::Poly:    return profPoly(op);
            case OpCode::RegPoly: return profRegPoly(op);
            // ---- 3D primitives ----
            case OpCode::Box:     return primBox(op);
            case OpCode::Cyl:     return primCyl(op);
            case OpCode::Cone:    return primCone(op);
            case OpCode::Sphere:  return primSphere(op);
            case OpCode::Torus:   return primTorus(op);
            case OpCode::Prism:   return primPrism(op);
            case OpCode::Tube:    return primTube(op);
            // ---- sketch -> solid ----
            case OpCode::Extrude: return opExtrude(op, env);
            case OpCode::Revolve: return opRevolve(op, env);
            case OpCode::Loft:    return opLoft(op, env);
            // ---- booleans ----
            case OpCode::Fuse:    return opBool(op, env, 0);
            case OpCode::Cut:     return opBool(op, env, 1);
            case OpCode::Common:  return opBool(op, env, 2);
            // ---- transforms ----
            case OpCode::Translate: return opTranslate(op, env);
            case OpCode::Rotate:    return opRotate(op, env);
            // ---- features ----
            case OpCode::Hole:    return opHole(op, env);
            case OpCode::Cbore:   return opCbore(op, env);
            case OpCode::Fillet:  return opFillet(op, env);
            case OpCode::Chamfer: return opChamfer(op, env);
            case OpCode::Shell:   return opShell(op, env);
            case OpCode::Heal:    return opHeal(op, env);
        }
        throw OpError(op.id, "unhandled op");
    }

    // Which value kind each op produces.
    static Val::Kind kindOf(OpCode c) {
        switch (c) {
            case OpCode::Rect: case OpCode::RRect: case OpCode::Circle:
            case OpCode::Slot: case OpCode::Poly:  case OpCode::RegPoly:
                return Val::Profile;
            default:
                return Val::Solid;
        }
    }

private:
    // ---- typed arg access ----------------------------------------------------
    static double num(const Op& op, std::size_t i) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Number)
            throw OpError(op.id, op.name + ": missing/!number arg #" + std::to_string(i));
        return op.args[i].num;
    }
    static double numOpt(const Op& op, std::size_t i, double def) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Number) return def;
        return op.args[i].num;
    }
    static std::string kwOpt(const Op& op, std::size_t i, const std::string& def) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Keyword) return def;
        return op.args[i].kw;
    }
    Handle refSolid(const Op& op, std::size_t i, std::unordered_map<int, Val>& env) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Ref)
            throw OpError(op.id, op.name + ": arg #" + std::to_string(i) + " must be a %ref");
        auto it = env.find(op.args[i].ref);
        if (it == env.end())
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) + " is undefined");
        if (it->second.kind != Val::Solid)
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) + " is a PROFILE, expected a SOLID");
        return it->second.h;
    }
    Handle refProfile(const Op& op, std::size_t i, std::unordered_map<int, Val>& env) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Ref)
            throw OpError(op.id, op.name + ": arg #" + std::to_string(i) + " must be a %ref");
        auto it = env.find(op.args[i].ref);
        if (it == env.end())
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) + " is undefined");
        if (it->second.kind != Val::Profile)
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) + " is a SOLID, expected a PROFILE");
        return it->second.h;  // a SketchHandle
    }

    // ---- placement: re-aim a +Z-based primitive to `axis`, base at (cx,cy,cz) --
    Handle place(Handle h, double cx, double cy, double cz,
                 double ax, double ay, double az) {
        double L = std::sqrt(ax * ax + ay * ay + az * az);
        if (L < 1e-12) { ax = 0; ay = 0; az = 1; L = 1; }
        ax /= L; ay /= L; az /= L;
        Handle cur = h;
        if (az < 0.9999999) {
            if (az < -0.9999999) {
                cur = forge::rotate(cur, 1, 0, 0, kPi);       // +Z -> -Z
            } else {
                double rx = -ay, ry = ax, rz = 0;              // zhat x a
                double rl = std::sqrt(rx * rx + ry * ry);
                rx /= rl; ry /= rl;
                double ang = std::acos(std::max(-1.0, std::min(1.0, az)));
                cur = forge::rotate(cur, rx, ry, rz, ang);
            }
        }
        if (cx != 0 || cy != 0 || cz != 0) cur = forge::translate(cur, cx, cy, cz);
        return cur;
    }

    std::array<double, 6> bboxOf(Handle h) {
        Mesh m = forge::tessellate(h, 0.5, 0.8);
        std::array<double, 6> bb = {1e300, 1e300, 1e300, -1e300, -1e300, -1e300};
        for (std::size_t i = 0; i + 2 < m.positions.size(); i += 3)
            for (int k = 0; k < 3; ++k) {
                double v = m.positions[i + k];
                if (v < bb[k]) bb[k] = v;
                if (v > bb[3 + k]) bb[3 + k] = v;
            }
        return bb;
    }

    // ---- profile builders (return a SketchHandle) ---------------------------
    Handle profRect(const Op& op) {
        double w = num(op, 0), h = num(op, 1);
        double cx = numOpt(op, 2, 0), cy = numOpt(op, 3, 0);
        double hw = w / 2, hh = h / 2;
        SketchHandle s = forge::createSketch();
        auto a = forge::addPoint(s, cx - hw, cy - hh);
        auto b = forge::addPoint(s, cx + hw, cy - hh);
        auto c = forge::addPoint(s, cx + hw, cy + hh);
        auto d = forge::addPoint(s, cx - hw, cy + hh);
        forge::addLine(s, a, b); forge::addLine(s, b, c);
        forge::addLine(s, c, d); forge::addLine(s, d, a);
        return s;
    }
    Handle profRRect(const Op& op) {
        double w = num(op, 0), h = num(op, 1), r = num(op, 2);
        double cx = numOpt(op, 3, 0), cy = numOpt(op, 4, 0);
        double hw = w / 2, hh = h / 2;
        double rr = std::max(0.1, std::min(r, std::min(hw, hh) - 0.1));
        SketchHandle s = forge::createSketch();
        auto P = [&](double x, double y) { return forge::addPoint(s, cx + x, cy + y); };
        auto a1 = P(-hw + rr, -hh), a2 = P(hw - rr, -hh);
        auto b1 = P(hw, -hh + rr), b2 = P(hw, hh - rr);
        auto c1 = P(hw - rr, hh), c2 = P(-hw + rr, hh);
        auto d1 = P(-hw, hh - rr), d2 = P(-hw, -hh + rr);
        auto cBR = P(hw - rr, -hh + rr), cTR = P(hw - rr, hh - rr);
        auto cTL = P(-hw + rr, hh - rr), cBL = P(-hw + rr, -hh + rr);
        forge::addLine(s, a1, a2); forge::addArc(s, cBR, a2, b1);
        forge::addLine(s, b1, b2); forge::addArc(s, cTR, b2, c1);
        forge::addLine(s, c1, c2); forge::addArc(s, cTL, c2, d1);
        forge::addLine(s, d1, d2); forge::addArc(s, cBL, d2, a1);
        return s;
    }
    Handle profCircle(const Op& op) {
        double r = num(op, 0);
        double cx = numOpt(op, 1, 0), cy = numOpt(op, 2, 0);
        SketchHandle s = forge::createSketch();
        auto c = forge::addPoint(s, cx, cy);
        forge::addCircle(s, c, r);
        return s;
    }
    Handle profSlot(const Op& op) {
        double len = num(op, 0), wid = num(op, 1);
        double cx = numOpt(op, 2, 0), cy = numOpt(op, 3, 0);
        double angDeg = numOpt(op, 4, 0);
        double r = wid / 2;
        double l = len - wid;
        if (l < 0) throw OpError(op.id, "SLOT: len must be >= wid");
        double ca = std::cos(angDeg * kPi / 180.0), sa = std::sin(angDeg * kPi / 180.0);
        auto tf = [&](double x, double y) -> std::array<double, 2> {
            return {cx + x * ca - y * sa, cy + x * sa + y * ca};
        };
        SketchHandle s = forge::createSketch();
        auto AP = [&](double x, double y) { auto p = tf(x, y); return forge::addPoint(s, p[0], p[1]); };
        auto tl = AP(-l / 2, r), tr = AP(l / 2, r);
        auto br = AP(l / 2, -r), bl = AP(-l / 2, -r);
        auto cR = AP(l / 2, 0), cL = AP(-l / 2, 0);
        forge::addLine(s, tl, tr);       // top
        forge::addArc(s, cR, tr, br);    // right cap
        forge::addLine(s, br, bl);       // bottom
        forge::addArc(s, cL, bl, tl);    // left cap
        return s;
    }
    Handle profPoly(const Op& op) {
        SketchHandle s = forge::createSketch();
        std::vector<SketchParamId> ids;
        ids.reserve(op.poly.size());
        for (auto& p : op.poly) ids.push_back(forge::addPoint(s, p.x, p.y));
        for (std::size_t i = 0; i < ids.size(); ++i)
            forge::addLine(s, ids[i], ids[(i + 1) % ids.size()]);
        return s;
    }
    Handle profRegPoly(const Op& op) {
        double r = num(op, 0);
        int n = static_cast<int>(num(op, 1));
        double cx = numOpt(op, 2, 0), cy = numOpt(op, 3, 0);
        double rot = numOpt(op, 4, 0) * kPi / 180.0;
        if (n < 3) throw OpError(op.id, "REGPOLY: n must be >= 3");
        SketchHandle s = forge::createSketch();
        std::vector<SketchParamId> ids;
        for (int i = 0; i < n; ++i) {
            double a = rot + 2 * kPi * i / n;
            ids.push_back(forge::addPoint(s, cx + r * std::cos(a), cy + r * std::sin(a)));
        }
        for (int i = 0; i < n; ++i) forge::addLine(s, ids[i], ids[(i + 1) % n]);
        return s;
    }

    // ---- primitive builders (return a ShapeHandle) --------------------------
    Handle primBox(const Op& op) {
        double dx = num(op, 0), dy = num(op, 1), dz = num(op, 2);
        double cx = numOpt(op, 3, 0), cy = numOpt(op, 4, 0), cz = numOpt(op, 5, 0);
        Handle b = forge::makeBox(dx, dy, dz);
        return forge::translate(b, cx - dx / 2, cy - dy / 2, cz);
    }
    Handle primCyl(const Op& op) {
        double r = num(op, 0), h = num(op, 1);
        double cx = numOpt(op, 2, 0), cy = numOpt(op, 3, 0), cz = numOpt(op, 4, 0);
        double ax = numOpt(op, 5, 0), ay = numOpt(op, 6, 0), az = numOpt(op, 7, 1);
        return place(forge::makeCylinder(r, h), cx, cy, cz, ax, ay, az);
    }
    Handle primCone(const Op& op) {
        double r1 = num(op, 0), r2 = num(op, 1), h = num(op, 2);
        double cx = numOpt(op, 3, 0), cy = numOpt(op, 4, 0), cz = numOpt(op, 5, 0);
        double ax = numOpt(op, 6, 0), ay = numOpt(op, 7, 0), az = numOpt(op, 8, 1);
        return place(forge::makeCone(r1, r2, h), cx, cy, cz, ax, ay, az);
    }
    Handle primSphere(const Op& op) {
        double r = num(op, 0);
        double cx = numOpt(op, 1, 0), cy = numOpt(op, 2, 0), cz = numOpt(op, 3, 0);
        Handle s = forge::makeSphere(r);
        return (cx || cy || cz) ? forge::translate(s, cx, cy, cz) : s;
    }
    Handle primTorus(const Op& op) {
        double major = num(op, 0), minor = num(op, 1);
        double cx = numOpt(op, 2, 0), cy = numOpt(op, 3, 0), cz = numOpt(op, 4, 0);
        double ax = numOpt(op, 5, 0), ay = numOpt(op, 6, 0), az = numOpt(op, 7, 1);
        return place(forge::makeTorus(major, minor), cx, cy, cz, ax, ay, az);
    }
    Handle primPrism(const Op& op) {
        int n = static_cast<int>(num(op, 0));
        double r = num(op, 1), h = num(op, 2);
        double cx = numOpt(op, 3, 0), cy = numOpt(op, 4, 0), cz = numOpt(op, 5, 0);
        Handle p = forge::makePrism(n, r, h);
        return (cx || cy || cz) ? forge::translate(p, cx, cy, cz) : p;
    }
    Handle primTube(const Op& op) {
        double ro = num(op, 0), ri = num(op, 1), h = num(op, 2);
        double cx = numOpt(op, 3, 0), cy = numOpt(op, 4, 0), cz = numOpt(op, 5, 0);
        Handle t = forge::makeTube(ro, ri, h);
        return (cx || cy || cz) ? forge::translate(t, cx, cy, cz) : t;
    }

    // ---- sketch -> solid ----------------------------------------------------
    Handle opExtrude(const Op& op, std::unordered_map<int, Val>& env) {
        SketchHandle sk = refProfile(op, 0, env);
        double amount = num(op, 1);
        double dx = numOpt(op, 2, 0), dy = numOpt(op, 3, 0), dz = numOpt(op, 4, 1);
        return forge::part::extrudeProfile(sk, amount, dx, dy, dz);
    }
    Handle opRevolve(const Op& op, std::unordered_map<int, Val>& env) {
        SketchHandle sk = refProfile(op, 0, env);
        double angDeg = num(op, 1);
        double ox = numOpt(op, 2, 0), oy = numOpt(op, 3, 0), oz = numOpt(op, 4, 0);
        double ax = numOpt(op, 5, 0), ay = numOpt(op, 6, 1), az = numOpt(op, 7, 0);
        return forge::part::revolveProfile(sk, ox, oy, oz, ax, ay, az, angDeg * kPi / 180.0);
    }
    Handle opLoft(const Op& op, std::unordered_map<int, Val>& env) {
        std::vector<SketchHandle> secs;
        for (std::size_t i = 0; i < op.args.size(); ++i)
            secs.push_back(refProfile(op, i, env));
        if (secs.size() < 2) throw OpError(op.id, "LOFT needs >= 2 profiles");
        return forge::part::loft(secs, {}, false, false);
    }

    // ---- booleans -----------------------------------------------------------
    Handle opBool(const Op& op, std::unordered_map<int, Val>& env, int which) {
        Handle a = refSolid(op, 0, env);
        Handle b = refSolid(op, 1, env);
        if (which == 0) return forge::fuse(a, b);
        if (which == 1) return forge::cut(a, b);
        return forge::common(a, b);
    }

    // ---- transforms ---------------------------------------------------------
    Handle opTranslate(const Op& op, std::unordered_map<int, Val>& env) {
        Handle a = refSolid(op, 0, env);
        return forge::translate(a, num(op, 1), num(op, 2), num(op, 3));
    }
    Handle opRotate(const Op& op, std::unordered_map<int, Val>& env) {
        Handle a = refSolid(op, 0, env);
        double angDeg = num(op, 1);
        double ax = num(op, 2), ay = num(op, 3), az = num(op, 4);
        double ox = numOpt(op, 5, 0), oy = numOpt(op, 6, 0), oz = numOpt(op, 7, 0);
        double ang = angDeg * kPi / 180.0;
        Handle cur = a;
        if (ox || oy || oz) cur = forge::translate(cur, -ox, -oy, -oz);
        cur = forge::rotate(cur, ax, ay, az, ang);
        if (ox || oy || oz) cur = forge::translate(cur, ox, oy, oz);
        return cur;
    }

    // ---- features -----------------------------------------------------------
    Handle cylCutter(double dia, double cx, double cy, double cz,
                     double ax, double ay, double az, double h) {
        return place(forge::makeCylinder(dia / 2.0, h), cx, cy, cz, ax, ay, az);
    }

    Handle opHole(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        double dia = num(op, 1);
        double cx = num(op, 2), cy = num(op, 3), cz = num(op, 4);
        double ax = numOpt(op, 5, 0), ay = numOpt(op, 6, 0), az = numOpt(op, 7, 1);
        double depth = numOpt(op, 8, -1);   // <=0 => through
        if (depth > 0)
            return forge::cut(body, cylCutter(dia, cx, cy, cz, ax, ay, az, depth));
        // through: length from bbox diagonal, cutter centred on `at`
        auto bb = bboxOf(body);
        double dx = bb[3] - bb[0], dy = bb[4] - bb[1], dz = bb[5] - bb[2];
        double diag = std::sqrt(dx * dx + dy * dy + dz * dz) + 2.0;
        double L = std::sqrt(ax * ax + ay * ay + az * az);
        if (L < 1e-12) { ax = 0; ay = 0; az = 1; L = 1; }
        ax /= L; ay /= L; az /= L;
        double sx = cx - ax * diag / 2, sy = cy - ay * diag / 2, sz = cz - az * diag / 2;
        return forge::cut(body, cylCutter(dia, sx, sy, sz, ax, ay, az, diag));
    }

    Handle opCbore(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        double dia = num(op, 1), cbd = num(op, 2), cbdep = num(op, 3);
        double cx = num(op, 4), cy = num(op, 5), cz = num(op, 6);
        double ax = numOpt(op, 7, 0), ay = numOpt(op, 8, 0), az = numOpt(op, 9, 1);
        // 1) through pilot hole
        auto bb = bboxOf(body);
        double dx = bb[3] - bb[0], dy = bb[4] - bb[1], dz = bb[5] - bb[2];
        double diag = std::sqrt(dx * dx + dy * dy + dz * dz) + 2.0;
        double L = std::sqrt(ax * ax + ay * ay + az * az);
        if (L < 1e-12) { ax = 0; ay = 0; az = 1; L = 1; }
        ax /= L; ay /= L; az /= L;
        double sx = cx - ax * diag / 2, sy = cy - ay * diag / 2, sz = cz - az * diag / 2;
        Handle r = forge::cut(body, cylCutter(dia, sx, sy, sz, ax, ay, az, diag));
        // 2) counterbore recess: from (at - axis*cbdep) toward the face at `at`
        double bx = cx - ax * cbdep, by = cy - ay * cbdep, bz = cz - az * cbdep;
        return forge::cut(r, cylCutter(cbd, bx, by, bz, ax, ay, az, cbdep));
    }

    // Classify + select edges by a keyword filter, then fillet/chamfer.
    std::vector<std::uint32_t> selectEdges(Handle body, const std::string& sel, int opId) {
        auto segs = forge::direct::edgeSegments(body, 0.25);
        std::vector<std::uint32_t> ids;
        for (auto& e : segs) {
            const auto& p = e.points;
            if (p.size() < 6) { if (sel == "ALL") ids.push_back(e.id); continue; }
            double ax = p[0], ay = p[1], az = p[2];
            double bx = p[p.size() - 3], by = p[p.size() - 2], bz = p[p.size() - 1];
            double dx = bx - ax, dy = by - ay, dz = bz - az;
            double len = std::sqrt(dx * dx + dy * dy + dz * dz);
            bool vertical = (len > 1e-9) && (std::fabs(std::fabs(dz) / len - 1.0) < 1e-2);
            bool horizontal = (len < 1e-9) || (std::fabs(dz) / len < 1e-2);
            if (sel == "ALL") ids.push_back(e.id);
            else if (sel == "VERTICAL" && vertical) ids.push_back(e.id);
            else if ((sel == "RIM" || sel == "HORIZONTAL") && horizontal) ids.push_back(e.id);
        }
        if (ids.empty()) throw OpError(opId, "no edges match selector `" + sel + "`");
        return ids;
    }

    Handle opFillet(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        double r = num(op, 1);
        std::string sel = kwOpt(op, 2, "ALL");
        auto ids = selectEdges(body, sel, op.id);
        // retry with a shrinking radius (native fillet declines on thin/large radii)
        for (double rr : {r, r * 0.75, r * 0.5, r * 0.35, r * 0.2}) {
            if (rr <= 0) break;
            try { return forge::part::filletEdges(body, ids, rr); }
            catch (...) { /* try smaller */ }
        }
        throw OpError(op.id, "FILLET: kernel declined at every radius (r=" + std::to_string(r) + ")");
    }

    Handle opChamfer(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        double d = num(op, 1);
        std::string sel = kwOpt(op, 2, "ALL");
        auto ids = selectEdges(body, sel, op.id);
        for (double dd : {d, d * 0.75, d * 0.5, d * 0.35, d * 0.2}) {
            if (dd <= 0) break;
            try { return forge::part::chamferEdges(body, ids, dd, -1); }
            catch (...) { /* try smaller */ }
        }
        throw OpError(op.id, "CHAMFER: kernel declined at every distance");
    }

    Handle opShell(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        double wall = num(op, 1);
        double ax = numOpt(op, 2, 0), ay = numOpt(op, 3, 0), az = numOpt(op, 4, -1);
        double L = std::sqrt(ax * ax + ay * ay + az * az);
        if (L < 1e-12) { ax = 0; ay = 0; az = -1; L = 1; }
        ax /= L; ay /= L; az /= L;
        // pick the largest face whose outward normal aligns with the open axis
        std::size_t n = forge::direct::faceCount(body);
        std::uint32_t best = 0; double bestScore = -1;
        for (std::uint32_t fid = 1; fid <= n; ++fid) {
            auto fi = forge::direct::inferFeature(body, fid);
            double dot = fi.normal[0] * ax + fi.normal[1] * ay + fi.normal[2] * az;
            if (dot > 0.9 && fi.area > bestScore) { bestScore = fi.area; best = fid; }
        }
        if (best == 0) throw OpError(op.id, "SHELL: no face faces the open axis");
        return forge::part::shell(body, {best}, -std::fabs(wall), {});
    }

    Handle opHeal(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        auto r = forge::heal::simplifyShape(body, {});
        return r.handle != forge::kInvalidHandle ? r.handle : body;
    }
};

}  // namespace

CompileResult compile(const FeatureTree& ft) {
    CompileResult out;

#ifdef FORGE_NATIVE_BREP
    // Force the clean OCCT analytic backend for the whole build, then restore.
    bool prevGate = forge::native::brep::forgeNativeBrepEnabled();
    forge::native::brep::setForgeNativeBrepEnabled(false);
    struct GateGuard {
        bool prev;
        ~GateGuard() { forge::native::brep::setForgeNativeBrepEnabled(prev); }
    } guard{prevGate};
#endif

    if (ft.ops.empty()) { out.error = "empty feature tree"; return out; }

    std::unordered_map<int, Val> env;
    Builder builder;
    Handle lastSolid = 0;

    for (const auto& op : ft.ops) {
        if (env.count(op.id)) {
            out.error = "duplicate id %" + std::to_string(op.id) +
                        " (line " + std::to_string(op.srcLine) + ")";
            out.failedOpId = op.id;
            return out;
        }
        Handle h;
        try {
            h = builder.build(op, env);
        } catch (const OpError& e) {
            out.error = std::string("op %") + std::to_string(op.id) +
                        " (line " + std::to_string(op.srcLine) + "): " + e.what();
            out.failedOpId = e.opId;
            return out;
        } catch (const std::exception& e) {
            out.error = std::string("op %") + std::to_string(op.id) + " " + op.name +
                        " (line " + std::to_string(op.srcLine) + "): " + e.what();
            out.failedOpId = op.id;
            return out;
        }
        Val v;
        v.kind = Builder::kindOf(op.code);
        v.h = h;
        env[op.id] = v;
        if (v.kind == Val::Solid) lastSolid = h;
    }

    // choose result
    Handle result = 0;
    if (ft.resultId >= 0) {
        auto it = env.find(ft.resultId);
        if (it == env.end() || it->second.kind != Val::Solid) {
            out.error = "RESULT %" + std::to_string(ft.resultId) + " is not a defined SOLID";
            return out;
        }
        result = it->second.h;
    } else {
        result = lastSolid;
    }
    if (result == 0) { out.error = "no SOLID produced (tree yields only profiles?)"; return out; }

    out.handle = result;

    // measure
    try {
        auto rep = forge::heal::checkValidity(result);
        out.valid = rep.isClosed && rep.isManifold && rep.isOriented &&
                    !rep.hasSelfIntersect && rep.badFaces.empty() && rep.badEdges.empty();
    } catch (...) { out.valid = false; }
    try { out.faceCount = static_cast<long>(forge::direct::faceCount(result)); } catch (...) {}
    try { out.edgeCount = static_cast<long>(forge::direct::edgeCount(result)); } catch (...) {}
    try { out.volume = forge::massProperties(result).volume; } catch (...) {}
    try {
        Mesh m = forge::tessellate(result, 0.3, 0.6);
        double mn[3] = {1e300, 1e300, 1e300}, mx[3] = {-1e300, -1e300, -1e300};
        for (std::size_t i = 0; i + 2 < m.positions.size(); i += 3)
            for (int k = 0; k < 3; ++k) {
                double val = m.positions[i + k];
                if (val < mn[k]) mn[k] = val;
                if (val > mx[k]) mx[k] = val;
            }
        for (int k = 0; k < 3; ++k) { out.bboxMin[k] = mn[k]; out.bboxMax[k] = mx[k]; }
    } catch (...) {}

    out.ok = true;
    return out;
}

CompileResult compileText(const std::string& text, const std::string& exportStepPath) {
    CompileResult out;
    FeatureTree ft;
    try {
        ft = parse(text);
    } catch (const std::exception& e) {
        out.error = e.what();
        return out;
    }
    out = compile(ft);
    if (out.ok && !exportStepPath.empty()) {
        try { out.exported = forge::io::exportStep(out.handle, exportStepPath); }
        catch (const std::exception& e) { out.error = std::string("STEP export failed: ") + e.what(); }
    }
    return out;
}

}  // namespace ft
}  // namespace forge
