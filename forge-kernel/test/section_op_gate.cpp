// forge-kernel/test/section_op_gate.cpp — the headless gate for SECTION, the
// fourth OCCT boolean.
//
// WHY THIS FILE EXISTS AT ALL
//   OCCT's BRepAlgoAPI ships four operators — Fuse, Cut, Common, Section — and
//   this IR had three. Adding the fourth is easy; adding it with the WRONG VALUE
//   KIND is worse than not adding it, and nothing in the tree would have said so.
//   A section of two solids is the CURVE where their faces cross: a wire with no
//   faces, no shells and zero volume. Typed SOLID it would still "build", and
//   every downstream measurement — massProperties, faceCount, checkValidity —
//   would report a perfectly good section as an empty invalid body.
//
//   So this gate does not assert that SECTION "works". It asserts the two things
//   that are wrong by default:
//     * WHAT COMES BACK IS NOT A BODY. Zero faces, zero shells, zero volume, and
//       a positive LENGTH — a vector of observables, because volume alone cannot
//       tell a correct section from an empty solid: both measure 0.
//     * THE OP ROUND-TRIPS THROUGH THE IR TEXT FORM. `%3 = SECTION(%1, %2)`
//       parses to OpCode::Section, re-emits to the same text, and re-parses to
//       the same tree. An op in the enum that the parser cannot read is present
//       and unreachable.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   It never calls forge::ft::compile(). The geometry half calls forge::section
//   directly and the IR half calls forge::ft::parse() only, so the numbers below
//   are the OPERATOR's, not a whole pipeline's. See build_section_op_gate.sh for
//   the link policy that makes that honest.
//
// FALSIFIABILITY (SR-3: a gate whose failure path cannot produce a non-zero exit
// is not a gate). `--mutate N` injects one defect per N and the build script
// requires each to turn this program RED. The mutations are the real failure
// modes, not typos: mistyping the result as a solid, welding two distinct loops
// into one wire, and accepting an empty section.

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pnt.hxx>

#include "forge/Booleans.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/ft/FeatureTree.hpp"
#include "forge/ft/GraphAudit.hpp"

namespace {

int g_mutation = 0;
int g_checks = 0;
int g_failures = 0;

void ok(bool cond, const std::string& what) {
    ++g_checks;
    if (cond) return;
    ++g_failures;
    std::printf("  FAIL  %s\n", what.c_str());
}

void eqInt(long got, long want, const std::string& what) {
    ++g_checks;
    if (got == want) return;
    ++g_failures;
    std::printf("  FAIL  %s\n        got %ld, want %ld\n", what.c_str(), got, want);
}

void near(double got, double want, double tol, const std::string& what) {
    ++g_checks;
    if (std::fabs(got - want) <= tol) return;
    ++g_failures;
    std::printf("  FAIL  %s\n        got %.9g, want %.9g (tol %.3g)\n", what.c_str(), got, want,
                tol);
}

// ---------------------------------------------------------------- observables
// A VECTOR of observables, on purpose. Volume alone reads 0 for a correct
// section AND for an empty solid, so a gate that measured only volume would pass
// on the exact defect this file exists to catch.
struct Topo {
    long   shapeType = -1;   // TopAbs_ShapeEnum of the returned shape
    long   wires     = 0;
    long   edges     = 0;
    long   faces     = 0;
    long   shells    = 0;
    long   solids    = 0;
    long   closedWires = 0;
    double length    = 0.0;
    double volume    = 0.0;
};

long countOf(const TopoDS_Shape& s, TopAbs_ShapeEnum k) {
    long n = 0;
    for (TopExp_Explorer ex(s, k); ex.More(); ex.Next()) ++n;
    return n;
}

Topo measure(const TopoDS_Shape& s) {
    Topo t;
    t.shapeType = static_cast<long>(s.ShapeType());
    t.wires  = countOf(s, TopAbs_WIRE);
    t.edges  = countOf(s, TopAbs_EDGE);
    t.faces  = countOf(s, TopAbs_FACE);
    t.shells = countOf(s, TopAbs_SHELL);
    t.solids = countOf(s, TopAbs_SOLID);
    for (TopExp_Explorer ex(s, TopAbs_WIRE); ex.More(); ex.Next()) {
        TopoDS_Vertex v0, v1;
        TopExp::Vertices(TopoDS::Wire(ex.Current()), v0, v1);
        // A closed wire has no free ends: TopExp::Vertices returns null vertices,
        // or the same vertex twice. Both spellings occur in OCCT, so accept both
        // rather than asserting one and calling a closed loop open.
        if ((v0.IsNull() && v1.IsNull()) || (!v0.IsNull() && v0.IsSame(v1))) ++t.closedWires;
    }
    GProp_GProps lp;
    BRepGProp::LinearProperties(s, lp);
    t.length = lp.Mass();
    GProp_GProps vp;
    BRepGProp::VolumeProperties(s, vp);
    t.volume = vp.Mass();
    return t;
}

void report(const char* name, const Topo& t) {
    std::printf("  %-34s type=%ld wires=%ld edges=%ld faces=%ld shells=%ld solids=%ld"
                " closed=%ld len=%.6f vol=%.6f\n",
                name, t.shapeType, t.wires, t.edges, t.faces, t.shells, t.solids, t.closedWires,
                t.length, t.volume);
}

forge::ShapeHandle reg(const TopoDS_Shape& s) {
    return forge::ShapeRegistry::instance().add(s);
}

TopoDS_Shape sectionShape(forge::ShapeHandle a, forge::ShapeHandle b) {
    const forge::ShapeHandle h = forge::section(a, b);
    return forge::ShapeRegistry::instance().get(h);
}

// ------------------------------------------------------------------ geometry
// Every expected number below was MEASURED from this same program before it was
// written down (run it with no arguments: it prints the full observable vector
// for each case). None of them is a round number picked because it looked right.
void geometry() {
    std::printf("[section] geometry — forge::section on OCCT solids\n");

    // The plate every case cuts against: 40 x 40 x 20, base on z=0, centred in XY.
    const TopoDS_Shape plate =
        BRepPrimAPI_MakeBox(gp_Pnt(-20, -20, 0), 40, 40, 20).Shape();

    // ---- A) a sphere centred ON the top face -> ONE exact circle -------------
    // The sharpest case available: the answer is a closed form. A section that
    // came back as a chord polygon (unapproximated intersection edges) would have
    // a length strictly BELOW 2*pi*r, so this number also proves Approximation
    // was applied before the build and not after it.
    {
        const TopoDS_Shape ball = BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 20), 10).Shape();
        const TopoDS_Shape sec = sectionShape(reg(plate), reg(ball));
        const Topo t = measure(sec);
        report("A box n sphere-on-top-face", t);

        // MUTATION 1: read the result as a body. This is the defect the whole op
        // was at risk of: kindOf()'s `default: return Val::Solid`.
        const long faces = (g_mutation == 1) ? 1 : t.faces;
        ok(t.shapeType == static_cast<long>(TopAbs_WIRE), "A: the section IS a wire, not a compound/solid");
        eqInt(t.wires, 1, "A: exactly one loop");
        eqInt(t.closedWires, 1, "A: the loop is CLOSED");
        eqInt(faces, 0, "A: a section has NO faces");
        eqInt(t.shells, 0, "A: a section has NO shells");
        eqInt(t.solids, 0, "A: a section has NO solids");
        near(t.volume, 0.0, 1e-9, "A: a section has ZERO volume");
        // 2*pi*10 to 1e-6 mm. The tolerance is tight on purpose: a polyline
        // approximation of this circle is short by ~1e-2, not by 1e-6.
        near(t.length, 2.0 * M_PI * 10.0, 1e-6, "A: length == 2*pi*r (the EXACT circle)");
    }

    // ---- B) two boxes overlapping at a corner -> one rectangular loop --------
    {
        const TopoDS_Shape other = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 10), 40, 40, 20).Shape();
        const TopoDS_Shape sec = sectionShape(reg(plate), reg(other));
        const Topo t = measure(sec);
        report("B box n box (corner overlap)", t);
        ok(t.shapeType == static_cast<long>(TopAbs_WIRE), "B: the section IS a wire");
        eqInt(t.wires, 1, "B: one loop");
        eqInt(t.closedWires, 1, "B: the loop is CLOSED");
        eqInt(t.faces, 0, "B: no faces");
        near(t.volume, 0.0, 1e-9, "B: zero volume");
        // The loop runs the rectangle 20 x 20 twice over: 2*(20+20)+2*(20+20)/... see
        // the printed length; asserted exactly, from the measurement.
        near(t.length, 100.0, 1e-6, "B: length is the measured closed-form perimeter");
    }

    // ---- C) a cylinder passing clean through -> TWO separate circles ---------
    // This is the case that proves the chaining does not WELD. Two loops that
    // never touch must stay two loops: merging them would be a wrong answer, not
    // a missing one, and a single-wire result would still measure the same total
    // length.
    {
        const TopoDS_Shape bar =
            BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, -20), gp_Dir(0, 0, 1)), 10, 60).Shape();
        const TopoDS_Shape sec = sectionShape(reg(plate), reg(bar));
        const Topo t = measure(sec);
        report("C box n cylinder through", t);

        // MUTATION 2: pretend the two loops came back as one. A gate that only
        // summed length would not notice.
        const long wires = (g_mutation == 2) ? 1 : t.wires;
        ok(t.shapeType == static_cast<long>(TopAbs_COMPOUND),
           "C: several loops come back as a COMPOUND of wires, never one welded wire");
        eqInt(wires, 2, "C: TWO loops — the entry circle and the exit circle");
        eqInt(t.closedWires, 2, "C: both loops closed");
        eqInt(t.faces, 0, "C: no faces");
        near(t.volume, 0.0, 1e-9, "C: zero volume");
        near(t.length, 4.0 * M_PI * 10.0, 1e-6, "C: length == two circles of r=10");
    }

    // ---- D) operands that do not intersect -> REFUSED, not an empty value ----
    // An empty compound would look like a healthy value to every consumer and
    // fail somewhere else entirely. forge::section throws instead.
    {
        const TopoDS_Shape far = BRepPrimAPI_MakeBox(gp_Pnt(200, 200, 200), 10, 10, 10).Shape();
        bool threw = false;
        std::string msg;
        try {
            (void)sectionShape(reg(plate), reg(far));
        } catch (const std::exception& e) {
            threw = true;
            msg = e.what();
        }
        // MUTATION 3: accept the empty section.
        if (g_mutation == 3) threw = false;
        ok(threw, "D: a section of disjoint operands is REFUSED, not returned empty");
        ok(msg.find("EMPTY") != std::string::npos || msg.find("empty") != std::string::npos,
           "D: and the refusal says WHY (the operands do not intersect)");
    }
}

// ------------------------------------------------------------------ IR layer
// The round trip: text -> tree -> text -> tree. An op that is in the enum and in
// the dispatch switch but that the parser cannot read is present and unreachable,
// and the count tables would still say 41.
std::string emitToken(const forge::ft::Token& t) {
    char buf[64];
    switch (t.kind) {
        case forge::ft::TokKind::Number:
            std::snprintf(buf, sizeof(buf), "%.10g", t.num);
            return std::string(buf);
        case forge::ft::TokKind::Ref:
            return "%" + std::to_string(t.ref);
        case forge::ft::TokKind::Keyword:
            return t.kw;
        case forge::ft::TokKind::Str:
            return "\"" + t.str + "\"";
        case forge::ft::TokKind::Points:
            break;
    }
    std::string s = "[";
    for (std::size_t i = 0; i < t.pts.size(); ++i) {
        if (i) s += "; ";
        std::snprintf(buf, sizeof(buf), "%.10g %.10g", t.pts[i].x, t.pts[i].y);
        s += buf;
        if (t.dim == 3) {
            std::snprintf(buf, sizeof(buf), " %.10g", t.pts[i].z);
            s += buf;
        }
    }
    return s + "]";
}

std::string emit(const forge::ft::FeatureTree& ft) {
    std::string out;
    for (const forge::ft::Op& op : ft.ops) {
        out += "%" + std::to_string(op.id) + " = " + op.name + "(";
        for (std::size_t i = 0; i < op.args.size(); ++i) {
            if (i) out += ", ";
            out += emitToken(op.args[i]);
        }
        out += ")\n";
    }
    if (ft.resultId >= 0) out += "RESULT(%" + std::to_string(ft.resultId) + ")\n";
    return out;
}

void irRoundTrip() {
    std::printf("[section] IR — parse, re-emit, re-parse\n");

    // A tree where the section is CONSUMED, because that is the shape of a real
    // use: the wire feeds LOFT exactly as RING and WIRE do.
    const std::string src =
        "%1 = BOX(40, 40, 20)\n"
        "%2 = SPHERE(10, 0, 0, 20)\n"
        "%3 = SECTION(%1, %2)\n"
        "%4 = RING(10, 10, 40)\n"
        "%5 = LOFT(%3, %4)\n"
        "RESULT(%5)\n";

    forge::ft::FeatureTree t1 = forge::ft::parse(src);
    eqInt(static_cast<long>(t1.ops.size()), 5, "IR: five ops parsed");
    ok(t1.counts.reconciles(), "IR: the s0.4 census reconciles (declared == parsed)");
    if (t1.ops.size() >= 3) {
        const forge::ft::Op& s = t1.ops[2];
        ok(s.code == forge::ft::OpCode::Section, "IR: SECTION resolves to OpCode::Section");
        ok(s.code != forge::ft::OpCode::Unknown,
           "IR: and NOT to the closed-vocabulary sentinel (which is what an op missing "
           "from opFromName would give)");
        eqInt(static_cast<long>(s.args.size()), 2, "IR: SECTION takes exactly two arguments");
        if (s.args.size() == 2) {
            ok(s.args[0].kind == forge::ft::TokKind::Ref && s.args[0].ref == 1,
               "IR: first argument is %1");
            ok(s.args[1].kind == forge::ft::TokKind::Ref && s.args[1].ref == 2,
               "IR: second argument is %2");
        }
    }

    // ROUND TRIP. Re-emitting and re-parsing must give the same tree; then
    // emitting THAT must give byte-identical text, which is the fixed point.
    const std::string once = emit(t1);
    forge::ft::FeatureTree t2 = forge::ft::parse(once);
    const std::string twice = emit(t2);
    ok(once == twice, "IR: emit(parse(emit(parse(src)))) is a fixed point");
    eqInt(static_cast<long>(t2.ops.size()), static_cast<long>(t1.ops.size()),
          "IR: the round trip keeps every op");
    if (t2.ops.size() >= 3) {
        ok(t2.ops[2].code == forge::ft::OpCode::Section, "IR: SECTION survives the round trip");
        ok(t2.ops[2].name == "SECTION", "IR: spelled SECTION, not lower-cased or renamed");
    }
    ok(t2.resultId == t1.resultId, "IR: RESULT survives the round trip");

    // The graph audit is the site an op is EASY to forget: GraphAudit::isPredicate
    // names VERIFY and TAG, and an op wrongly added there would make an
    // unconsumed statement invisible. SECTION produces a value, so it is not a
    // predicate — and an unconsumed SECTION must therefore be reported as the
    // orphan it is.
    {
        const forge::ft::GraphAudit clean = forge::ft::auditGraph(t1, 5);
        ok(clean.clean(), "AUDIT: a consumed SECTION is not an orphan");

        const std::string dangling =
            "%1 = BOX(40, 40, 20)\n"
            "%2 = SPHERE(10, 0, 0, 20)\n"
            "%3 = SECTION(%1, %2)\n"
            "%4 = FUSE(%1, %2)\n"
            "RESULT(%4)\n";
        forge::ft::FeatureTree t3 = forge::ft::parse(dangling);
        const forge::ft::GraphAudit a3 = forge::ft::auditGraph(t3, 4);
        ok(!a3.clean(), "AUDIT: an UNCONSUMED section is an unexplained orphan, not a predicate");
        eqInt(static_cast<long>(a3.unexplainedOrphans.size()), 1, "AUDIT: exactly one orphan");
        if (a3.unexplainedOrphans.size() == 1)
            eqInt(a3.unexplainedOrphans[0], 3, "AUDIT: and it is the SECTION statement");
    }

    // A near-miss must NAME the op. The repair hint is fed straight back to the
    // planner, so "unknown op" without a suggestion costs a whole repair round.
    {
        bool threw = false;
        std::string msg;
        try {
            (void)forge::ft::parse("%1 = BOX(10, 10, 10)\n%2 = CROSSSECTION(%1, %1)\n");
        } catch (const forge::ft::ParseError& e) {
            threw = true;
            msg = e.what();
        }
        ok(threw, "IR: an op outside the closed vocabulary is REFUSED");
        ok(msg.find("SECTION") != std::string::npos,
           "IR: and the repair hint names SECTION");
    }
}

}  // namespace

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc)
            g_mutation = std::atoi(argv[++i]);
    }
    if (g_mutation != 0) std::printf("[section] MUTATION %d ACTIVE\n", g_mutation);

    geometry();
    irRoundTrip();

    std::printf("\n[section] checks=%d failures=%d\n", g_checks, g_failures);
    std::printf("%s\n", g_failures == 0 ? "[section] PASS" : "[section] FAIL");
    return g_failures == 0 ? 0 : 1;
}
