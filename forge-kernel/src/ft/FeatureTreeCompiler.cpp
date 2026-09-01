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
//   SECTION                              -> forge::section  (a WIRE, not a solid)
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
#include "forge/ft/GraphAudit.hpp"

#include "forge/Primitives.hpp"
#include "forge/Booleans.hpp"
#include "forge/Transform.hpp"
#include "forge/Features.hpp"
#include "forge/Sketcher.hpp"
#include "forge/IoExchange.hpp"
#include "forge/MassProps.hpp"
#include "forge/Healing.hpp"
#include "forge/DirectModeling.hpp"
#include "forge/DirectEdit.hpp"   // edit ops: faceInventory/defeature/pushPullFace/resizeBore
#include "forge/Tessellate.hpp"
#include "forge/Topology.hpp"   // VERIFY "genus=" / "shells=" — topology is 0.2 of the metric
#include "forge/LoftGuide.hpp"   // loftguide::loft (real 3D loft over profileWire sections)
#include "forge/VarFillet.hpp"   // varfillet::fillet (variable-radius BLEND)
#include "forge/Sewing.hpp"      // sewing::sew (SEW over >1 sheet)
#include "forge/SurfaceValue.hpp"  // surf::facesOf / statsOf — the SURFACE value kind

#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"
#endif

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
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

// Split on `delim` at the TOP level — never inside [ ... ] and never inside a
// quoted string. A face selector legitimately contains the delimiter
// ("hole:at=21.75,0"), so quote-awareness is required, not cosmetic.
std::vector<std::string> splitTop(const std::string& s, char delim) {
    std::vector<std::string> out;
    int depth = 0;
    char quote = 0;
    std::string cur;
    for (char c : s) {
        if (quote) {
            cur.push_back(c);
            if (c == quote) quote = 0;
            continue;
        }
        if (c == '"' || c == '\'') { quote = c; cur.push_back(c); continue; }
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
        {"RING", OpCode::Ring}, {"WIRE", OpCode::Wire},
        // 2D sketch + constraints — the planegcs solver, reachable from a tree
        {"SKETCH", OpCode::Sketch}, {"SPT", OpCode::SPt}, {"SLINE", OpCode::SLine},
        {"SCIRC", OpCode::SCirc}, {"SARC", OpCode::SArc},
        {"CON", OpCode::Con}, {"SOLVE", OpCode::Solve},
        {"BOX", OpCode::Box}, {"CYL", OpCode::Cyl}, {"CONE", OpCode::Cone},
        {"SPHERE", OpCode::Sphere}, {"TORUS", OpCode::Torus}, {"PRISM", OpCode::Prism},
        {"TUBE", OpCode::Tube},
        {"EXTRUDE", OpCode::Extrude}, {"REVOLVE", OpCode::Revolve}, {"LOFT", OpCode::Loft},
        {"SWEEP", OpCode::Sweep},
        {"FUSE", OpCode::Fuse}, {"CUT", OpCode::Cut}, {"COMMON", OpCode::Common},
        {"SECTION", OpCode::Section},
        {"TRANSLATE", OpCode::Translate}, {"ROTATE", OpCode::Rotate},
        {"MIRROR", OpCode::Mirror}, {"PATTERN", OpCode::Pattern},
        {"HOLE", OpCode::Hole}, {"CBORE", OpCode::Cbore}, {"FILLET", OpCode::Fillet},
        {"CHAMFER", OpCode::Chamfer}, {"BLEND", OpCode::Blend},
        {"SHELL", OpCode::Shell}, {"FOLD", OpCode::Fold}, {"HEAL", OpCode::Heal},
        // surface sheets — the SURFACE value kind
        {"SKIN", OpCode::Skin}, {"FACES", OpCode::Faces}, {"SEW", OpCode::Sew},
        {"THICKEN", OpCode::Thicken}, {"CAP", OpCode::Cap},
        {"SURFCHECK", OpCode::SurfCheck},
        // edit ops — the same grammar, dispatched to DirectEdit
        {"TAG", OpCode::Tag},
        {"INPUT", OpCode::Input}, {"PUSHFACE", OpCode::PushFace},
        {"RESIZEBORE", OpCode::ResizeBore}, {"DEFEATURE", OpCode::Defeature},
        {"VERIFY", OpCode::Verify},
    };
    auto it = tbl.find(nameUpper);
    known = (it != tbl.end());
    // A MISS RETURNS THE SENTINEL, NOT A BOX. This line used to read
    // `: OpCode::Box`, which made the vocabulary open in the worst possible
    // direction: a name the table did not contain resolved to a real, buildable
    // primitive that then consumed that statement's own arguments as dx,dy,dz.
    // `known` is an out-parameter every caller must honour; returning a sentinel
    // means a caller that forgets to still cannot build anything.
    return known ? it->second : OpCode::Unknown;
}

// The rotational symmetry ORDER of a set of angles: the largest N for which
// rotating every angle by 2*pi/N maps the set onto itself.
//
// Binning was the wrong tool twice over. Scoring bins by evenness*N returned 14 for
// a 7-blade hub (a harmonic — each blade's faces straddle two bins), and taking the
// smallest bin-balanced N returned 2 (a coincidence of the face distribution).
// Either answer removes the wrong amount of material. Symmetry is not a histogram
// property; it is whether the part maps onto itself under rotation, so that is what
// is tested.
inline int rotationalOrder(std::vector<double> angs) {
    if (angs.size() < 2) return 0;
    std::sort(angs.begin(), angs.end());
    const double twoPi = 2.0 * 3.14159265358979323846;
    int best = 0;
    for (int N = 16; N >= 2; --N) {
        const double step = twoPi / N;
        const double tol = std::min(0.05, step * 0.20);
        bool ok = true;
        for (double a : angs) {
            double t = a + step;
            if (t >= twoPi) t -= twoPi;
            // nearest angle to t, circularly
            double best_d = 1e300;
            for (double b : angs) {
                double d = std::fabs(b - t);
                if (d > twoPi / 2) d = twoPi - d;
                best_d = std::min(best_d, d);
            }
            if (best_d > tol) { ok = false; break; }
        }
        if (ok) { best = N; break; }        // largest N wins: the true fold count
    }
    return best;
}

// Count angular CLUSTERS of off-axis faces — i.e. how many repeated protrusions the
// part has RIGHT NOW.
//
// This is a different question from rotationalOrder() and conflating them was a bug.
// Symmetry order answers "is this N-fold symmetric"; after removing 2 of 7 blades the
// remaining 5 are NOT symmetric, so symmetry order is 0 — while the part plainly
// still has 5 blades. GT 203 asks to "verify blade count = 5", which is the count,
// not the symmetry. Clusters are separated by angular gaps much larger than the
// within-cluster spread, so a gap threshold recovers them without assuming any fold.
inline int angularClusterCount(std::vector<double> angs) {
    if (angs.empty()) return 0;
    if (angs.size() == 1) return 1;
    std::sort(angs.begin(), angs.end());
    const double twoPi = 2.0 * 3.14159265358979323846;
    std::vector<double> gaps;
    gaps.reserve(angs.size());
    for (std::size_t i = 0; i < angs.size(); ++i) {
        const double a = angs[i];
        const double b = (i + 1 < angs.size()) ? angs[i + 1] : angs[0] + twoPi;
        gaps.push_back(b - a);
    }
    std::vector<double> sorted = gaps;
    std::sort(sorted.begin(), sorted.end());
    const double median = sorted[sorted.size() / 2];
    // a separator is a gap several times the typical within-cluster gap
    const double cut = std::max(median * 3.0, 0.15);
    int clusters = 0;
    for (double g : gaps) if (g > cut) ++clusters;
    return clusters > 0 ? clusters : 1;
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

    // A generation cut off at the token ceiling ends mid-statement. That is
    // RESOURCE-EXHAUSTION, and SACROSANCT law 5 fixes both halves of what must
    // happen: never claim success, and never discard the generated work. The old
    // behaviour DROPPED the final malformed line and returned a tree — a success
    // claim over a truncated graph, which is the silent truncation the
    // constitution forbids outright. Now the same situation throws
    // ParseError{Incomplete} carrying every op parsed so far as
    // ParseError::checkpoint, so a caller that wants the salvage still gets it
    // (measured: five long emissions of 99/126/79/227/299 ops each died on their
    // own final line — that work is still recoverable, just no longer mistakable
    // for a complete parse). Count the lines so the LAST one is identifiable.
    int totalLines = 0;
    {
        std::istringstream count(text);
        std::string tmp;
        while (std::getline(count, tmp)) ++totalLines;
    }

    // The most recent `%id` defined, so a VERIFY written without an explicit body
    // can be bound to the thing it plainly means. Synthetic ids run NEGATIVE, a
    // space no emitted tree uses, so they can never collide with a model's own.
    int lastDefinedId = -1;
    int syntheticId = -1;
    std::string line;                    // current statement, comment stripped
    auto checkpoint = [&]() {
        FeatureTree cp = ft;
        cp.counts.parsed = cp.ops.size();
        return cp;
    };
    auto fail = [&](const std::string& why) {
        if (lineNo >= totalLines)
            throw ParseError(
                ParseFailure::Incomplete, lineNo, line,
                "ft parse line " + std::to_string(lineNo) +
                    ": PAUSED_INCOMPLETE — the emission stopped mid-statement (" + why +
                    "). " + std::to_string(ft.ops.size()) +
                    " ops are attached as the last valid checkpoint; a truncated graph "
                    "is never reported as a successful parse.",
                checkpoint());
        throw ParseError(ParseFailure::Syntax, lineNo, line,
                         "ft parse line " + std::to_string(lineNo) + ": " + why);
    };

    while (std::getline(in, raw)) {
        ++lineNo;
        ++ft.counts.sourceLines;
        // Strip an inline comment — '#' OR '//' — but never one inside a quoted
        // selector. splitTop() is quote-aware; this was not, so any selector
        // containing '#' was silently truncated into a parse error.
        //
        // '//' was missing here entirely, and the omission was not cosmetic: the
        // argument scan takes the LAST ')' on the line, so a trailing comment that
        // merely contains a parenthesis stole it. `FUSE(%0, %1)  // fuse (boss) on`
        // parsed its final argument as `%1)  // fuse (boss` and the whole tree was
        // rejected. Ground-truth trees annotate constantly — `// O10 (clearance)`,
        // `// (through)` — so a model trained on GT framing emits exactly the form
        // that broke. Measured on the honest holdout: 2 of 26 non-compiling rounds.
        std::size_t cut = std::string::npos;
        {
            char q = 0;
            for (std::size_t i = 0; i < raw.size(); ++i) {
                const char c = raw[i];
                if (q) { if (c == q) q = 0; continue; }
                if (c == '"' || c == '\'') { q = c; continue; }
                if (c == '#') { cut = i; break; }
                if (c == '/' && i + 1 < raw.size() && raw[i + 1] == '/') { cut = i; break; }
            }
        }
        line = trim(cut == std::string::npos ? raw : raw.substr(0, cut));
        if (line.empty()) {
            // A line that is EMPTY once its comment is stripped is commentary or
            // whitespace: non-executable by construction, and the only legal form
            // of prose in this IR. Counted, never silently discarded.
            if (cut == std::string::npos) ++ft.counts.blank;
            else                          ++ft.counts.comments;
            continue;
        }

        // The FORMAT SPEC echoed back as though it were a statement. Every system
        // prompt says `One statement per line as %id = OP(args)`, and the model
        // frequently opens its answer by copying that literal — which then fails as
        // "bad %id on left side, line 1" and takes the ENTIRE tree with it. Measured
        // on the honest holdout: a complete 77-op emission discarded for this alone.
        //
        // Matched EXACTLY, not by "the left side isn't a number". A general rule
        // would silently swallow `%plate = BOX(...)`, dropping a real statement and
        // yielding a tree that compiles to the wrong solid — trading a loud failure
        // for a quiet wrong answer, which is the worse of the two by far.
        {
            std::string flat;
            for (char c : line)
                if (!std::isspace(static_cast<unsigned char>(c))) flat += c;
            if (flat == "%id=OP(args)" || flat == "%id=OP(...)") {
                ++ft.counts.templates;   // counted, not silently dropped: the
                                         // literal template names no op, no
                                         // parameter and no count, so it cannot
                                         // carry design intent.
                continue;
            }
        }

        // ------------------------------------------------- s0.5 FAIL CLOSED
        // Every remaining line is an EXECUTABLE STATEMENT. Previously anything
        // that was not `%id = ...`, RESULT or VERIFY was silently skipped by a
        // "tolerate prose" branch, which accepted all six statements SACROSANCT
        // 3.1 s0.5 forbids verbatim ("place six mounting tabs", "finish the
        // remaining holes", ...) and dropped them from the graph. The part then
        // built without the tabs and was reported as fully parsed — a wrong part
        // reported green, which is strictly worse than a rejected one.
        //
        // Prose is still expressible, and that is the whole distinction: mark it
        // as a COMMENT ('#' or '//') and it is counted as commentary above. An
        // UNMARKED line is a statement, and a statement that is not a recognised
        // typed op is rejected here, quoting the offending text and its line.
        {
            const std::string U = upper(line);
            const bool isAssign = (line[0] == '%');
            const bool isResult = (U.rfind("RESULT", 0) == 0);
            const bool isVerify = (U.rfind("VERIFY", 0) == 0);
            // SURFCHECK gets the same standing as VERIFY, for the same reason and
            // by the same rule. s0.5 forbids an OPAQUE placeholder — a line that
            // omits identity, parameters, reference selection or exact count. A
            // bare `SURFCHECK "freeEdges=0"` omits none of those: it names a typed
            // op, carries its assertion verbatim, and is rewritten below into the
            // explicit `%id = SURFCHECK(%body, ...)` form against the newest value.
            // Rejecting it would discard a whole tree over punctuation on the one
            // op whose entire job is to let a degenerate surface be DESCRIBED.
            const bool isSurfCheck = (U.rfind("SURFCHECK", 0) == 0);
            if (!isAssign && !isResult && !isVerify && !isSurfCheck) {
                throw ParseError(
                    ParseFailure::OpaquePlaceholder, lineNo, line,
                    "ft parse line " + std::to_string(lineNo) +
                        ": rejected executable statement `" + line +
                        "` — it is not a recognised typed op. SACROSANCT 3.1 s0.5: an "
                        "executable placeholder omits identity, parameters, reference "
                        "selection, failure behavior or exact count and is forbidden; "
                        "s0.4 requires zero opaque placeholders and zero dropped "
                        "statements. Write it as `%id = OP(args)`, or, if it is "
                        "commentary rather than a step, mark it with '#' or '//'.",
                    checkpoint());
            }
            if (isResult) ++ft.counts.terminators;
            else          ++ft.counts.declared;
        }

        // A BARE `VERIFY "holes=4"` — the form ground-truth trees actually use, with
        // no `%id =` in front of it. The prose filter above swallowed it whole, so
        // the assertion did NOTHING: measured, `VERIFY "holes=99"` on a one-hole
        // part compiled and reported PASS. A checker that silently ignores what it
        // was asked to check is far worse than no checker, because it turns a wrong
        // part into a green one — and since GT framing is exactly this bare form,
        // every VERIFY the model learns to emit would have been a no-op scored as
        // verified. Rewrite it to the explicit form against the newest solid.
        if (line[0] != '%' && upper(line).rfind("VERIFY", 0) == 0) {
            if (lastDefinedId < 0) {
                fail("VERIFY before any solid is defined");
            }
            std::string rest = trim(line.substr(6));
            if (rest.size() >= 2 && rest.front() == '(' && rest.back() == ')')
                rest = trim(rest.substr(1, rest.size() - 2));
            line = "%" + std::to_string(syntheticId--) + " = VERIFY(%" +
                   std::to_string(lastDefinedId) + (rest.empty() ? "" : ", " + rest) + ")";
        }

        // The same repair for SURFCHECK, for the same reason and by the same rule.
        // SURFCHECK is a pass-through predicate exactly like VERIFY, so an emitter
        // that writes the bare form is expressing the same intent; rejecting it
        // would be a refusal over punctuation, on the ONE op whose whole job is to
        // let a degenerate surface be described rather than thrown away.
        if (line[0] != '%' && upper(line).rfind("SURFCHECK", 0) == 0) {
            if (lastDefinedId < 0) {
                fail("SURFCHECK before any value is defined");
            }
            std::string rest = trim(line.substr(9));
            if (rest.size() >= 2 && rest.front() == '(' && rest.back() == ')')
                rest = trim(rest.substr(1, rest.size() - 2));
            line = "%" + std::to_string(syntheticId--) + " = SURFCHECK(%" +
                   std::to_string(lastDefinedId) + (rest.empty() ? "" : ", " + rest) + ")";
        }

        // RESULT(%id)
        if (upper(line).rfind("RESULT", 0) == 0) {
            std::size_t lp = line.find('('), rp = line.rfind(')');
            if (lp == std::string::npos || rp == std::string::npos || rp < lp) {
                fail("malformed RESULT(...)");
            }
            std::string inner = trim(line.substr(lp + 1, rp - lp - 1));
            if (inner.empty() || inner[0] != '%') fail("RESULT expects %id");
            double v;
            if (!parseDouble(inner.substr(1), v)) fail("RESULT expects %id");
            ft.resultId = static_cast<int>(v);
            continue;
        }

        // `%406 = RESULT(%405)` — RESULT written in ASSIGNMENT form. RESULT is a
        // terminator, not an operation, so the branch above only catches it at the
        // start of a line; written this way it fell through to generic op handling
        // and died as an unknown/misapplied op. That failure lands on the LAST line
        // of the tree, so it discards everything: measured on the honest holdout, a
        // complete 406-op emission lost at line 406. Bind the result and move on.
        if (line[0] == '%' && upper(line).find("=") != std::string::npos) {
            std::size_t e = line.find('=');
            std::string r = trim(line.substr(e + 1));
            if (upper(r).rfind("RESULT", 0) == 0) {
                std::size_t lp2 = r.find('('), rp2 = r.rfind(')');
                if (lp2 != std::string::npos && rp2 != std::string::npos && rp2 > lp2) {
                    std::string in2 = trim(r.substr(lp2 + 1, rp2 - lp2 - 1));
                    double rv;
                    if (!in2.empty() && in2[0] == '%' && parseDouble(in2.substr(1), rv)) {
                        ft.resultId = static_cast<int>(rv);
                        --ft.counts.declared;      // it binds a result, it is not
                        ++ft.counts.terminators;   // a semantic feature
                        continue;
                    }
                }
            }
        }

        // %id = OP(args)
        std::size_t eq = line.find('=');
        if (eq == std::string::npos) {
            fail("expected `%id = OP(...)` or `RESULT(%id)`");
        }
        std::string lhs = trim(line.substr(0, eq));
        std::string rhs = trim(line.substr(eq + 1));
        if (lhs.empty() || lhs[0] != '%') fail("left side must be %id");
        double idv;
        if (!parseDouble(lhs.substr(1), idv)) fail("bad %id on left side");

        std::size_t lp = rhs.find('('), rp = rhs.rfind(')');
        if (lp == std::string::npos || rp == std::string::npos || rp < lp) {
            fail("expected OP( ... )");
        }
        std::string name = trim(rhs.substr(0, lp));
        std::string inner = trim(rhs.substr(lp + 1, rp - lp - 1));

        Op op;
        op.id = static_cast<int>(idv);
        op.name = name;
        op.srcLine = lineNo;
        bool known = false;
        op.code = opFromName(upper(name), known);
        if (!known) {
            // Say what the tree COULD have said. An invented op is usually a
            // COMPOSITE of real ones — measured on the edit benchmark, the planner
            // emitted `HOLEPATTERN`, which the IR already expresses as PATTERN of
            // HOLE. This message is handed back as the repair instruction, so
            // naming the constituents converts a dead end into a fixable one.
            const std::string U = upper(name);
            std::string hint;
            for (const char* k : {"RECT","RRECT","CIRCLE","SLOT","POLY","REGPOLY","RING",
                                  "WIRE","BOX","CYL","CONE","SPHERE","TORUS","PRISM","TUBE",
                                  "EXTRUDE","REVOLVE","LOFT","SWEEP","FUSE","CUT","COMMON",
                                  "SECTION",
                                  "TRANSLATE","ROTATE","MIRROR","PATTERN","HOLE","CBORE",
                                  "FILLET","CHAMFER","BLEND","SHELL","FOLD","HEAL","TAG",
                                  "INPUT","PUSHFACE","RESIZEBORE","DEFEATURE","VERIFY"}) {
                if (U.find(k) != std::string::npos) {
                    if (!hint.empty()) hint += ", ";
                    hint += k;
                }
            }
            // HARD, and NOT routed through fail(). fail() classifies anything on
            // the LAST line as ParseFailure::Incomplete — "the emission stopped
            // mid-statement" — and hands back a salvage checkpoint. That
            // classification is FALSE here and it is what made the defect
            // survivable: this statement is not truncated, it is structurally
            // complete. We only reach this point having already matched
            // `%id = NAME( ... )` with both parentheses present, so the decoder
            // plainly did not stop mid-token; the author simply named an op that
            // does not exist. A genuine token-ceiling cutoff lands one of the
            // earlier checks (`expected OP( ... )`, an unterminated string) and
            // still gets Incomplete, so truncation tolerance is untouched.
            //
            // SACROSANCT s0.5 and s9.1 require a CLOSED executable vocabulary
            // whose unknown kinds are REJECTED. A rejection that depends on where
            // the statement sits in the file is not a closed vocabulary.
            throw ParseError(ParseFailure::Syntax, lineNo, line,
                             "ft parse line " + std::to_string(lineNo) +
                                 ": unknown op `" + name + "`" +
                                 (hint.empty()
                                      ? ""
                                      : " — the IR spells this with " + hint +
                                            " (compose them; there is no combined op)"));
        }

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
                if (t[0] == '[') {
                    // a 2D/3D point ring:  [x y; x y; ...]  or  [x y z; x y z; ...]
                    std::size_t b0 = t.find('['), b1 = t.rfind(']');
                    if (b0 == std::string::npos || b1 == std::string::npos || b1 < b0)
                        fail("malformed point list `" + t + "`");
                    std::string body = t.substr(b0 + 1, b1 - b0 - 1);
                    tok.kind = TokKind::Points;
                    for (auto& ptStr : splitTop(body, ';')) {
                        std::string ps = trim(ptStr);
                        if (ps.empty()) continue;
                        std::istringstream ss(ps);
                        double x = 0, y = 0, z = 0;
                        int got = 0;
                        if (ss >> x) ++got; if (ss >> y) ++got; if (ss >> z) ++got;
                        if (got < 2) fail("point needs `x y` or `x y z`");
                        if (tok.dim == 0) tok.dim = (got >= 3) ? 3 : 2;
                        tok.pts.push_back(Point3{x, y, z});
                    }
                    if (tok.pts.empty()) fail("empty point list");
                } else if (t[0] == '"' || t[0] == '\'') {
                    // a quoted literal — a face SELECTOR or a VERIFY assertion.
                    // Case and punctuation are preserved ("bore:r=47.5"), unlike
                    // bare keywords which are upper-cased.
                    char q = t[0];
                    std::size_t close = t.rfind(q);
                    if (close == 0) fail("unterminated string " + t);
                    tok.kind = TokKind::Str;
                    tok.str = t.substr(1, close - 1);
                } else if (t[0] == '%') {
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
        // `%8 = VERIFY("holes=4")` — assignment form, body left implicit. Same
        // intent as the bare form, so it gets the same binding rather than the
        // "arg #0 must be a %ref" rejection that failed 3 of 26 holdout rounds.
        if ((op.code == OpCode::Verify || op.code == OpCode::SurfCheck) &&
            (op.args.empty() || op.args[0].kind != TokKind::Ref) && lastDefinedId >= 0) {
            Token body;
            body.kind = TokKind::Ref;
            body.ref = lastDefinedId;
            op.args.insert(op.args.begin(), body);
        }
        if (op.id >= 0) lastDefinedId = op.id;
        ft.ops.push_back(std::move(op));
    }

    // ------------------------------------------- s0.4 CARDINALITY RECONCILE
    // "N_declared_semantic_features == N_parsed_semantic_features". Every
    // executable statement was counted as declared above and every op that
    // survived is counted here. They can only differ if a statement was dropped
    // between the two — which is precisely the failure this whole pass exists to
    // make impossible, so it is a hard failure rather than a warning.
    ft.counts.parsed = ft.ops.size();
    if (!ft.counts.reconciles())
        throw ParseError(
            ParseFailure::Cardinality, lineNo, std::string(),
            "ft parse: s0.4 cardinality mismatch — declared=" +
                std::to_string(ft.counts.declared) + " parsed=" +
                std::to_string(ft.counts.parsed) + " (comments=" +
                std::to_string(ft.counts.comments) + " blank=" +
                std::to_string(ft.counts.blank) + " templates=" +
                std::to_string(ft.counts.templates) + " terminators=" +
                std::to_string(ft.counts.terminators) + " lines=" +
                std::to_string(ft.counts.sourceLines) +
                "). N_declared_semantic_features must equal "
                "N_parsed_semantic_features; a difference is a dropped statement.",
            checkpoint());
    return ft;
}

// ============================================================================
// COMPILER
// ============================================================================
namespace {

struct Val {
    // Sketch     -- a SketchHandle still under construction: mutable,
    //              constrainable, NOT yet solved. `h` is the SketchHandle.
    // SketchRef  -- a point or curve INSIDE a sketch. A constraint has to name
    //              two entities, and the IR addresses every value by its %N
    //              creation id, so an entity needs to BE a value. `h` is the
    //              OWNING SketchHandle (so CON can recover the sketch from
    //              either operand) and `entity` is the point/entity id within
    //              it. Two fields, zero grammar change.
    // Profile    -- the SAME SketchHandle after a solve: immutable, Z=0, ready
    //              for EXTRUDE. refProfile() already returns a SketchHandle,
    //              which is why the exit from this family costs nothing.
    // Surface    -- a sheet body. New kinds are APPENDED and never reordered:
    //              every comparison in this file is `kind != Val::Solid` /
    //              `== Val::Profile`, never an ordering or a cast, so adding
    //              one cannot change what any of the others mean.
    enum Kind { Profile, Wire, Solid, Sketch, SketchRef, Surface } kind = Solid;
    Handle h = 0;
    std::uint32_t entity = 0;   // kind == SketchRef only

    // A SURFACE carries its own DIAGNOSIS alongside the handle, because the whole
    // point of the kind is that a degenerate sheet is a legal value. These are
    // filled by the op that produced it and read by SURFCHECK; nothing here can
    // refuse a value, it only records what the value is.
    //
    // `faces == 0` is a real, representable surface: `FACES(%body, "sel")` whose
    // selector matched nothing returns one rather than aborting a 200-op tree.
    int         faces = -1;      // -1 = not measured
    std::string note;            // provenance / what went wrong, empty when clean
};

// The kind's own name, for a diagnostic that has to say WHAT it got. The old
// messages hard-coded "is a PROFILE, expected a SOLID" on every mismatch, which
// became a lie the moment a fourth kind existed.
const char* kindName(Val::Kind k) {
    switch (k) {
        case Val::Profile: return "PROFILE";
        case Val::Wire:    return "WIRE";
        case Val::Solid:   return "SOLID";
        case Val::Sketch:  return "SKETCH";
        case Val::SketchRef: return "SKETCH ENTITY";
        case Val::Surface: return "SURFACE";
    }
    return "?";
}

// A local exception carrying the offending op id for loud, precise failure.
struct OpError : std::runtime_error {
    int opId;
    OpError(int id, const std::string& msg) : std::runtime_error(msg), opId(id) {}
};

class Builder {
public:
    // ---- L4: persistent feature identity -----------------------------------
    // A face index is not an identity: DEFEATURE of one bolt hole permutes the
    // indices of the holes it did not touch (measured 6->8, 10->9, 9->10), and
    // %id addresses a whole body SNAPSHOT, not a feature. A NAME binds to a
    // measurable SIGNATURE and is re-found by that signature after any op, so
    // "the mounting bore" still means the same bore once the tree has moved.
    struct FaceSig {
        std::string kind;
        double radius = 0, minorRadius = 0, area = 0;
        double at[3] = {0, 0, 0};      // axis location (curved) or centroid (planar)
        double dir[3] = {0, 0, 0};     // axis or outward normal
        bool concave = false;
        bool valid = false;
    };
    std::unordered_map<std::string, FaceSig> names;

    Handle build(const Op& op, std::unordered_map<int, Val>& env) {
        switch (op.code) {
            // ---- 2D profiles ----
            case OpCode::Rect:    return profRect(op);
            case OpCode::RRect:   return profRRect(op);
            case OpCode::Circle:  return profCircle(op);
            case OpCode::Slot:    return profSlot(op);
            case OpCode::Poly:    return profPoly(op);
            case OpCode::RegPoly: return profRegPoly(op);
            // ---- 2D sketch + constraints ----
            case OpCode::Sketch:  return skNew(op);
            case OpCode::SPt:     return skPoint(op, env);
            case OpCode::SLine:   return skLine(op, env);
            case OpCode::SCirc:   return skCircle(op, env);
            case OpCode::SArc:    return skArc(op, env);
            case OpCode::Con:     return skConstrain(op, env);
            case OpCode::Solve:   return skSolve(op, env);
            // ---- 3D section rings (WIRE) ----
            case OpCode::Ring:    return wireRing(op);
            case OpCode::Wire:    return wireExplicit(op);
            // ---- 3D primitives ----
            case OpCode::Box:     return primBox(op);
            case OpCode::Cyl:     return primCyl(op);
            case OpCode::Cone:    return primCone(op);
            case OpCode::Sphere:  return primSphere(op);
            case OpCode::Torus:   return primTorus(op);
            case OpCode::Prism:   return primPrism(op);
            case OpCode::Tube:    return primTube(op);
            // ---- sketch/wire -> solid ----
            case OpCode::Extrude: return opExtrude(op, env);
            case OpCode::Revolve: return opRevolve(op, env);
            case OpCode::Loft:    return opLoft(op, env);
            case OpCode::Sweep:   return opSweep(op, env);
            // ---- booleans ----
            case OpCode::Fuse:    return opBool(op, env, 0);
            case OpCode::Cut:     return opBool(op, env, 1);
            case OpCode::Common:  return opBool(op, env, 2);
            // ---- the fourth boolean, and the only one that yields a WIRE ----
            case OpCode::Section: return opSection(op, env);
            // ---- transforms / replication ----
            case OpCode::Translate: return opTranslate(op, env);
            case OpCode::Rotate:    return opRotate(op, env);
            case OpCode::Mirror:    return opMirror(op, env);
            case OpCode::Pattern:   return opPattern(op, env);
            // ---- features ----
            case OpCode::Hole:    return opHole(op, env);
            case OpCode::Cbore:   return opCbore(op, env);
            case OpCode::Fillet:  return opFillet(op, env);
            case OpCode::Chamfer: return opChamfer(op, env);
            case OpCode::Blend:   return opBlend(op, env);
            case OpCode::Shell:   return opShell(op, env);
            case OpCode::Fold:    return opFold(op, env);
            case OpCode::Heal:    return opHeal(op, env);
            // ---- surface sheets (the SURFACE value kind) ----
            case OpCode::Skin:      return opSkin(op, env);
            case OpCode::Faces:     return opFaces(op, env);
            case OpCode::Sew:       return opSew(op, env);
            case OpCode::Thicken:   return opThicken(op, env);
            case OpCode::Cap:       return opCap(op, env);
            case OpCode::SurfCheck: return opSurfCheck(op, env);
            // ---- edit ops (same walker, DirectEdit backend) ----
            case OpCode::Tag:        return opTag(op, env);
            case OpCode::Input:      return opInput(op);
            case OpCode::PushFace:   return opPushFace(op, env);
            case OpCode::ResizeBore: return opResizeBore(op, env);
            case OpCode::Defeature:  return opDefeature(op, env);
            case OpCode::Verify:     return opVerify(op, env);
            // The closed-vocabulary sentinel. Unreachable via parse() — an
            // unknown name throws in the parser — but enumerated so that
            // -Wswitch -Werror makes any future op added to OpCode without a
            // builder a COMPILE error, and so that an Op reaching the builder by
            // any other route (default-constructed, deserialized, synthesized)
            // fails loudly instead of building a box.
            case OpCode::Unknown:
                throw OpError(op.id, "op `" + op.name +
                                         "` is not in the executable vocabulary "
                                         "(OpCode::Unknown reached the builder)");
        }
        throw OpError(op.id, "unhandled op");
    }

    // Which value kind each op produces.
    //
    // The `default:` arm is why SECTION is named EXPLICITLY here rather than left to
    // fall through. This switch does not enumerate OpCode, so a newly added op is
    // silently typed SOLID — and for SECTION that default is precisely the wrong
    // answer: its result has no faces, no shells and zero volume, so every consumer
    // that took it for a body would measure an empty invalid solid instead of
    // refusing a wire. Getting this wrong is worse than not having the op at all.
    static Val::Kind kindOf(OpCode c) {
        switch (c) {
            case OpCode::Rect: case OpCode::RRect: case OpCode::Circle:
            case OpCode::Slot: case OpCode::Poly:  case OpCode::RegPoly:
                return Val::Profile;
            case OpCode::Ring: case OpCode::Wire:
            case OpCode::Section:                  // intersection CURVES, never a body
                return Val::Wire;
            // A sketch under construction. CON is PASS-THROUGH: it hands back
            // the same SKETCH it was given, so it lands here too.
            case OpCode::Sketch: case OpCode::Con:
                return Val::Sketch;
            case OpCode::SPt: case OpCode::SLine: case OpCode::SCirc: case OpCode::SArc:
                return Val::SketchRef;
            // THE EXIT. A solved sketch IS a profile — refProfile() already
            // returns a SketchHandle, so nothing downstream changes.
            case OpCode::Solve:
                return Val::Profile;
            // A sheet body. SEW stays a SURFACE even when the stitch closes it:
            // making the value kind depend on the measured geometry would mean the
            // emitter cannot tell what `%N` IS without building it first, and every
            // downstream arity/kind check would become unpredictable. CAP is the
            // explicit promotion verb.
            case OpCode::Skin: case OpCode::Faces: case OpCode::Sew:
            case OpCode::SurfCheck:
                return Val::Surface;
            default:
                return Val::Solid;
        }
    }

    // Set by the SKETCHREF producers (SPT/SLINE/SCIRC/SARC) and consumed by the
    // compile loop on the very next line. build() is called once per op, in
    // order, so a single slot is sufficient; it is reset on every build.
    std::uint32_t lastEntity = 0;

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
        if (it->second.kind != Val::Solid) {
            // The message used to say "is a PROFILE" for every mismatch, which was
            // already only accidentally true and became false the moment a fourth
            // kind existed. It NAMES the kind it got and, for a SURFACE, names the
            // op that converts one — a repair loop cannot act on "wrong kind".
            std::string fix;
            if (it->second.kind == Val::Surface)
                fix = " — a sheet is not a body: use THICKEN(%" +
                      std::to_string(op.args[i].ref) + ", wall) or CAP(%" +
                      std::to_string(op.args[i].ref) + ") to close it into a SOLID";
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) +
                                     " is a " + kindName(it->second.kind) +
                                     ", expected a SOLID" + fix);
        }
        return it->second.h;
    }
    Handle refProfile(const Op& op, std::size_t i, std::unordered_map<int, Val>& env) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Ref)
            throw OpError(op.id, op.name + ": arg #" + std::to_string(i) + " must be a %ref");
        auto it = env.find(op.args[i].ref);
        if (it == env.end())
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) + " is undefined");
        if (it->second.kind != Val::Profile)
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) +
                                     " is a " + kindName(it->second.kind) +
                                     ", expected a PROFILE");
        return it->second.h;  // a SketchHandle
    }
    Handle refWire(const Op& op, std::size_t i, std::unordered_map<int, Val>& env) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Ref)
            throw OpError(op.id, op.name + ": arg #" + std::to_string(i) + " must be a %ref");
        auto it = env.find(op.args[i].ref);
        if (it == env.end())
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) + " is undefined");
        if (it->second.kind != Val::Wire)
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) +
                          " is a " + kindName(it->second.kind) +
                          ", not a WIRE section (use RING(...) or WIRE([...]))");
        return it->second.h;  // a TopoDS_Wire ShapeHandle
    }

    // ---- SURFACE ------------------------------------------------------------
    // The one ref accessor that COERCES rather than refusing, because one of the
    // two coercions is total and lossless: a SOLID's boundary IS a sheet, so
    // SURFCHECK(%solid, ...) / SEW(%solid) / THICKEN(%solid, w) all have exactly
    // one meaning and refusing them would only force the emitter to write
    // FACES(%solid, "all") by hand. The promotion is RECORDED in the returned
    // value's note, so nothing about it is silent.
    //
    // A PROFILE and a WIRE are NOT coerced: turning a Z=0 sketch or a 3D ring into
    // a sheet requires FILLING it, which invents geometry the emitter did not ask
    // for. Those two refuse — and the refusal names the op that does the job, which
    // is the only form of refusal this design permits.
    Val refSurface(const Op& op, std::size_t i, std::unordered_map<int, Val>& env) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Ref)
            throw OpError(op.id, op.name + ": arg #" + std::to_string(i) + " must be a %ref");
        auto it = env.find(op.args[i].ref);
        if (it == env.end())
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) + " is undefined");
        const Val& v = it->second;
        if (v.kind == Val::Surface) return v;
        if (v.kind == Val::Solid) {
            Val promoted;
            promoted.kind = Val::Surface;
            promoted.h = forge::surf::boundaryOf(v.h);
            promoted.faces = static_cast<int>(forge::surf::faceCountOf(v.h));
            promoted.note = "promoted SOLID %" + std::to_string(op.args[i].ref) +
                            " to its boundary sheet (" + std::to_string(promoted.faces) +
                            " faces)";
            return promoted;
        }
        throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) + " is a " +
                                 kindName(v.kind) +
                                 ", expected a SURFACE — a PROFILE becomes a solid via "
                                 "EXTRUDE/REVOLVE and a WIRE becomes a sheet via "
                                 "SKIN(%w0, %w1); neither is filled implicitly, because "
                                 "that would invent a face the tree never asked for");
    }
    // A mandatory bracketed point list at arg i.
    const std::vector<Point3>& pointsArg(const Op& op, std::size_t i) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Points)
            throw OpError(op.id, op.name + ": arg #" + std::to_string(i) + " must be a [x y; ...] point list");
        return op.args[i].pts;
    }
    // A mandatory keyword (mode/selector) at arg i.
    std::string kwReq(const Op& op, std::size_t i) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Keyword)
            throw OpError(op.id, op.name + ": arg #" + std::to_string(i) + " must be a keyword");
        return op.args[i].kw;
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
    // ======================================================================
    // 2D SKETCH + CONSTRAINTS — the planegcs solver, reachable from a tree.
    //
    // Everything below is REACHABILITY, not numerics: the solver, the rank
    // diagnosis, the residual vector and the repair contract already exist in
    // forge::Sketcher. These arms only let a feature-tree statement address
    // them.
    // ======================================================================

    // A %ref that must be a SKETCH (or a SKETCHREF, from which the owning
    // sketch is recovered — that is the whole point of the second kind).
    Handle refSketch(const Op& op, std::size_t i, std::unordered_map<int, Val>& env) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Ref)
            throw OpError(op.id, op.name + ": arg #" + std::to_string(i) + " must be a %ref");
        auto it = env.find(op.args[i].ref);
        if (it == env.end())
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) + " is undefined");
        if (it->second.kind == Val::Sketch || it->second.kind == Val::SketchRef)
            return it->second.h;
        throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) +
                      " is not a SKETCH (use SKETCH(XY) and its entities)");
    }
    // A %ref that must be a SKETCHREF; yields the entity id AND its owner.
    std::uint32_t refEntity(const Op& op, std::size_t i, std::unordered_map<int, Val>& env,
                            Handle& ownerOut) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Ref)
            throw OpError(op.id, op.name + ": arg #" + std::to_string(i) + " must be a %ref");
        auto it = env.find(op.args[i].ref);
        if (it == env.end())
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) + " is undefined");
        if (it->second.kind != Val::SketchRef)
            throw OpError(op.id, op.name + ": %" + std::to_string(op.args[i].ref) +
                          " is not a sketch entity (use SPT/SLINE/SCIRC/SARC)");
        ownerOut = it->second.h;
        return it->second.entity;
    }

    Handle skNew(const Op& op) {
        const std::string plane = kwOpt(op, 0, "XY");
        const SketchHandle s = forge::createSketch();
        // forge::Sketcher states the Z=0 plane as a CONTRACT every native
        // consumer relies on (Sketcher.hpp), and re-planting a solved profile
        // is a transform of the BUILT SOLID, not of the sketch. That transform
        // is not implemented here. Rather than refuse a plane keyword — which
        // would cost a whole tree over one token — YZ/XZ solve on XY and SAY SO
        // on the verify channel. A reported approximation beats both a refusal
        // and a silent lie.
        if (plane != "XY" && res)
            res->verify.push_back("SKETCH %" + std::to_string(op.id) + " plane=" + plane +
                                  " NOT APPLIED — solved on XY (sketch planes are not implemented)");
        return s;
    }

    Handle skPoint(const Op& op, std::unordered_map<int, Val>& env) {
        const Handle s = refSketch(op, 0, env);
        lastEntity = forge::addPoint(s, num(op, 1), num(op, 2));
        return s;
    }
    Handle skLine(const Op& op, std::unordered_map<int, Val>& env) {
        Handle o0 = 0, o1 = 0;
        const std::uint32_t a = refEntity(op, 0, env, o0);
        const std::uint32_t b = refEntity(op, 1, env, o1);
        if (o0 != o1) throw OpError(op.id, "SLINE: both points must belong to the same SKETCH");
        lastEntity = forge::addLine(o0, a, b);
        return o0;
    }
    Handle skCircle(const Op& op, std::unordered_map<int, Val>& env) {
        Handle o = 0;
        const std::uint32_t c = refEntity(op, 0, env, o);
        lastEntity = forge::addCircle(o, c, num(op, 1));
        return o;
    }
    Handle skArc(const Op& op, std::unordered_map<int, Val>& env) {
        Handle o0 = 0, o1 = 0, o2 = 0;
        const std::uint32_t c = refEntity(op, 0, env, o0);
        const std::uint32_t a = refEntity(op, 1, env, o1);
        const std::uint32_t b = refEntity(op, 2, env, o2);
        if (o0 != o1 || o0 != o2)
            throw OpError(op.id, "SARC: centre and endpoints must belong to the same SKETCH");
        lastEntity = forge::addArc(o0, c, a, b);
        return o0;
    }

    // CON(%a, KIND [, %b, value]) — the kind is ALWAYS arg 1; operands follow
    // and are read BY TOKEN TYPE, so one op covers unary, binary and
    // dimensional constraints without four op names (the same dispatch-on-a-
    // keyword shape PATTERN already uses for LINEAR|POLAR|GRID).
    Handle skConstrain(const Op& op, std::unordered_map<int, Val>& env) {
        Handle owner = 0;
        const std::uint32_t a = refEntity(op, 0, env, owner);
        const std::string kind = kwReq(op, 1);

        std::vector<std::uint32_t> refs{a};
        double value = 0.0;
        // ── a bad TRAILING operand is TOLERATED, not fatal ───────────────────
        // CON is PASS-THROUGH: it hands back the SKETCH it was given, unchanged.
        // That is precisely what makes a bad trailing operand recoverable where
        // the same mistake on SLINE is not — SLINE must PRODUCE an entity and
        // has no defensible answer, while a skipped CON has exactly one: the
        // sketch as it already stood. So these two arms join the unknown-keyword
        // and wrong-operand-type arms below, for the reason all four exist: one
        // statement's mistake must not cost the other 199 of a long tree, and a
        // mis-typed %ref is the single likeliest mistake a generating model
        // makes. This was the LAST hole of that shape in the family — the arms
        // below were written to honour never-refuse while the operand
        // resolution feeding them could still kill the tree outright.
        //
        // The FIRST operand and the keyword keep REFUSING (case 5's negative
        // controls): with neither an owning sketch nor a constraint kind
        // resolved there is nothing to pass through, and inventing one would
        // fabricate geometry rather than tolerate a mistake.
        for (std::size_t i = 2; i < op.args.size(); ++i) {
            if (op.args[i].kind == TokKind::Ref) {
                Handle o2 = 0;
                std::uint32_t e2 = 0;
                try {
                    e2 = refEntity(op, i, env, o2);
                } catch (const OpError& e) {
                    if (res)
                        res->verify.push_back("CON %" + std::to_string(op.id) +
                                              " SKIPPED — " + e.what());
                    return owner;
                }
                if (o2 != owner) {
                    if (res)
                        res->verify.push_back("CON %" + std::to_string(op.id) +
                                              " SKIPPED — operands belong to different SKETCHes");
                    return owner;
                }
                refs.push_back(e2);
            } else if (op.args[i].kind == TokKind::Number) {
                value = op.args[i].num;
            }
        }

        static const std::unordered_map<std::string, forge::SketchConstraintKind> kKinds = {
            {"COINC", forge::SketchConstraintKind::Coincident},
            {"PARA",  forge::SketchConstraintKind::Parallel},
            {"PERP",  forge::SketchConstraintKind::Perpendicular},
            {"DIST",  forge::SketchConstraintKind::Distance},
            {"HORIZ", forge::SketchConstraintKind::Horizontal},
            {"VERT",  forge::SketchConstraintKind::Vertical},
            {"PTON",  forge::SketchConstraintKind::PointOnLine},
            {"EQUAL", forge::SketchConstraintKind::Equal},
            {"TANG",  forge::SketchConstraintKind::Tangent},
        };
        auto it = kKinds.find(kind);
        if (it == kKinds.end()) {
            // NOT a throw. An unrecognised constraint keyword is one statement's
            // worth of information, and refusing it would cost the whole tree —
            // the exact failure mode the owner's constraint forbids. Skip it,
            // NAME it on the verify channel, and keep building.
            if (res)
                res->verify.push_back("CON %" + std::to_string(op.id) + " SKIPPED — unknown kind '" +
                                      kind + "' (known: COINC PARA PERP DIST HORIZ VERT PTON EQUAL TANG)");
            return owner;
        }
        // The facade THROWS on a type-mismatched operand — TANG wants
        // {line, circle}, PTON wants {point, line}, and handing it two points
        // raises. A known keyword applied to the wrong entities is still ONE
        // statement's mistake, and letting it escape would cost the whole tree
        // for the same reason an unknown keyword would. Same treatment: skip it,
        // NAME it, keep building. (The unknown-keyword arm above is the other
        // half of this; both must behave identically or the contract has a hole
        // exactly where a model is most likely to fall in.)
        try {
            forge::addConstraint(owner, it->second, refs, value);
        } catch (const std::exception& e) {
            if (res)
                res->verify.push_back("CON %" + std::to_string(op.id) + " SKIPPED — " + kind +
                                      " rejected these operands: " + e.what());
        }
        return owner;   // PASS-THROUGH: CON returns the SKETCH unchanged.
    }

    // SOLVE(%sketch) -> PROFILE. The one op in this family that must NEVER
    // refuse: it always yields a profile, and it REPORTS what it had to demote.
    Handle skSolve(const Op& op, std::unordered_map<int, Val>& env) {
        const Handle s = refSketch(op, 0, env);
        // "SOLVE always produces a PROFILE" is the guarantee this whole family
        // rests on, so it is made TOTAL rather than nearly-total. solveOrRepair
        // has no throw path of its own, but it drives ~370 KB of vendored
        // numerics; if anything under there raises, the answer is still the
        // as-drawn sketch -- which is the documented floor -- and NOT a dead
        // tree. A guarantee with one uncovered path is not a guarantee, and the
        // passing cases are exactly what would hide it.
        forge::SketchSolveReport r{};
        r.classification = "unsolved";
        r.dof = -1;
        try {
            r = forge::solveOrRepair(s);
        } catch (const std::exception& e) {
            if (res)
                res->verify.push_back("SOLVE %" + std::to_string(op.id) +
                                      " SOLVER RAISED — kept the as-drawn coordinates: " + e.what());
            return s;
        }
        if (res) {
            std::string line = "SOLVE %" + std::to_string(op.id) + " " + r.classification +
                               " dof=" + std::to_string(r.dof) +
                               " passes=" + std::to_string(r.passes);
            for (const auto& d : r.demoted)
                line += " DEMOTED tag=" + std::to_string(d.tag) +
                        (d.reason == forge::SketchDemotionReason::Conflicting ? "/CONFLICT" : "/RESIDUAL");
            if (r.status != forge::SketchSolveStatus::Success)
                line += " UNCONVERGED — kept the as-drawn coordinates";
            res->verify.push_back(line);
        }
        return s;   // the same handle, now a PROFILE
    }

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

    // ---- 3D section rings (return a TopoDS_Wire ShapeHandle) -----------------
    // A superellipse ring |x/rx|^p + |y/ry|^p = 1 sampled to `seg` points at
    // height z. p=2 => circle/ellipse; p=4..6 => rounded-rect (impeller hub,
    // nozzle, transition-duct sections). Mirrors native_compile.mjs sectionRing.
    Handle wireRing(const Op& op) {
        double rx = num(op, 0), ry = num(op, 1), z = num(op, 2);
        double cx = numOpt(op, 3, 0), cy = numOpt(op, 4, 0);
        double p = numOpt(op, 5, 2.0);
        int seg = static_cast<int>(numOpt(op, 6, 48));
        if (rx <= 0 || ry <= 0) throw OpError(op.id, "RING: rx, ry must be > 0");
        if (p < 2.0) p = 2.0;
        if (seg < 8) seg = 8;
        std::vector<double> pts;
        pts.reserve(static_cast<std::size_t>(seg) * 3);
        for (int i = 0; i < seg; ++i) {
            double t = 2.0 * kPi * i / seg;
            double ct = std::cos(t), st = std::sin(t);
            double sgnc = (ct > 0) - (ct < 0), sgns = (st > 0) - (st < 0);
            double x = cx + rx * sgnc * std::pow(std::fabs(ct), 2.0 / p);
            double y = cy + ry * sgns * std::pow(std::fabs(st), 2.0 / p);
            pts.push_back(x); pts.push_back(y); pts.push_back(z);
        }
        return forge::part::profileWire(pts, /*closed*/ true);
    }
    // An explicit closed 3D ring — airfoil / organic / sharp-cornered section.
    Handle wireExplicit(const Op& op) {
        const auto& P = pointsArg(op, 0);
        if (P.size() < 3) throw OpError(op.id, "WIRE needs >= 3 points");
        std::vector<double> pts;
        pts.reserve(P.size() * 3);
        for (const auto& q : P) { pts.push_back(q.x); pts.push_back(q.y); pts.push_back(q.z); }
        return forge::part::profileWire(pts, /*closed*/ true);
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
    // REVOLVE — partial angle (0<a<=360) about an ARBITRARY axis line. The
    // native revolveProfile already takes (origin, dir, angleRad); this only
    // validates the range + a non-degenerate axis so a bad emission fails loud.
    Handle opRevolve(const Op& op, std::unordered_map<int, Val>& env) {
        SketchHandle sk = refProfile(op, 0, env);
        double angDeg = num(op, 1);
        if (angDeg <= 0.0 || angDeg > 360.0)
            throw OpError(op.id, "REVOLVE: angleDeg must be in (0, 360]");
        double ox = numOpt(op, 2, 0), oy = numOpt(op, 3, 0), oz = numOpt(op, 4, 0);
        double ax = numOpt(op, 5, 0), ay = numOpt(op, 6, 1), az = numOpt(op, 7, 0);
        if (ax * ax + ay * ay + az * az < 1e-18)
            throw OpError(op.id, "REVOLVE: axis direction is zero");
        return forge::part::revolveProfile(sk, ox, oy, oz, ax, ay, az, angDeg * kPi / 180.0);
    }
    // LOFT — skin >= 2 WIRE sections (each placed in 3D via profileWire) with
    // loftguide::loft (BSpline-smoothed lateral faces + planar caps). Trailing
    // flags: RULED (straight rulings, no smoothing), OPEN (shell, uncapped).
    Handle opLoft(const Op& op, std::unordered_map<int, Val>& env) {
        std::vector<Handle> wires;
        bool ruled = false, solid = true;
        for (std::size_t i = 0; i < op.args.size(); ++i) {
            if (op.args[i].kind == TokKind::Ref) {
                wires.push_back(refWire(op, i, env));
            } else if (op.args[i].kind == TokKind::Keyword) {
                const std::string& kw = op.args[i].kw;
                if (kw == "RULED") ruled = true;
                else if (kw == "OPEN") solid = false;
                else throw OpError(op.id, "LOFT: unknown flag `" + kw + "` (want RULED|OPEN)");
            } else {
                throw OpError(op.id, "LOFT: arg #" + std::to_string(i) +
                              " must be a %wire ref or a flag (RULED|OPEN)");
            }
        }
        if (wires.size() < 2)
            throw OpError(op.id, "LOFT needs >= 2 WIRE sections (RING/WIRE)");
        return forge::loftguide::loft(wires, {}, solid, ruled);
    }
    // SWEEP — circular pipe (radius arg) or arbitrary-profile sweep along a 3D
    // polyline path. Routes to pipeFromPolyline / sweepPolyline, the robust
    // native verbs (part::sweep collapses when profile+path are coplanar).
    Handle opSweep(const Op& op, std::unordered_map<int, Val>& env) {
        (void)env;
        const std::vector<Point3>& path = pointsArg(op, 1);
        if (path.size() < 2) throw OpError(op.id, "SWEEP: path needs >= 2 points");
        std::vector<double> pathFlat;
        pathFlat.reserve(path.size() * 3);
        for (const auto& q : path) { pathFlat.push_back(q.x); pathFlat.push_back(q.y); pathFlat.push_back(q.z); }

        if (!op.args.empty() && op.args[0].kind == TokKind::Number) {
            double r = num(op, 0);
            if (r <= 0) throw OpError(op.id, "SWEEP: pipe radius must be > 0");
            return forge::part::pipeFromPolyline(pathFlat, r);
        }
        if (!op.args.empty() && op.args[0].kind == TokKind::Points) {
            const std::vector<Point3>& prof = op.args[0].pts;
            if (prof.size() < 3) throw OpError(op.id, "SWEEP: profile ring needs >= 3 points");
            std::vector<double> profFlat;
            profFlat.reserve(prof.size() * 2);
            for (const auto& q : prof) { profFlat.push_back(q.x); profFlat.push_back(q.y); }
            return forge::part::sweepPolyline(profFlat, pathFlat);
        }
        throw OpError(op.id, "SWEEP: arg #0 must be a pipe radius or a [x y; ...] profile ring");
    }

    // ---- booleans -----------------------------------------------------------
    Handle opBool(const Op& op, std::unordered_map<int, Val>& env, int which) {
        Handle a = refSolid(op, 0, env);
        Handle b = refSolid(op, 1, env);
        if (which == 0) return forge::fuse(a, b);
        if (which == 1) return forge::cut(a, b);
        return forge::common(a, b);
    }

    // SECTION — the fourth OCCT boolean. Two SOLIDs in (refSolid twice, so a %ref to
    // a PROFILE or a WIRE is refused by kind before any geometry runs), a WIRE out.
    //
    // It has its own handler rather than a fourth `which` value in opBool because the
    // RESULT KIND differs, and because that is what the vocabulary generator reads:
    // parse_compiler_ref_kinds() derives each op's consumed value kinds from the
    // refSolid/refProfile/refWire calls in ITS OWN handler body. Folding SECTION into
    // opBool would have made the vocabulary describe FUSE and SECTION as one thing.
    Handle opSection(const Op& op, std::unordered_map<int, Val>& env) {
        Handle a = refSolid(op, 0, env);
        Handle b = refSolid(op, 1, env);
        return forge::section(a, b);
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

    // MIRROR — reflect the body across a plane and FUSE with the original
    // (symmetrize). Plane by keyword XY|YZ|XZ (through origin) or explicit
    // (point + normal). Maps to native part::mirrorPattern.
    Handle opMirror(const Op& op, std::unordered_map<int, Val>& env) {
        Handle a = refSolid(op, 0, env);
        double ox = 0, oy = 0, oz = 0, nx = 0, ny = 0, nz = 1;
        if (op.args.size() > 1 && op.args[1].kind == TokKind::Keyword) {
            const std::string& pl = op.args[1].kw;
            if (pl == "YZ")      { nx = 1; ny = 0; nz = 0; }   // reflect across X=0
            else if (pl == "XZ") { nx = 0; ny = 1; nz = 0; }   // reflect across Y=0
            else if (pl == "XY") { nx = 0; ny = 0; nz = 1; }   // reflect across Z=0
            else throw OpError(op.id, "MIRROR: plane must be XY|YZ|XZ or 6 numbers");
        } else {
            ox = num(op, 1); oy = num(op, 2); oz = num(op, 3);
            nx = num(op, 4); ny = num(op, 5); nz = num(op, 6);
            if (nx * nx + ny * ny + nz * nz < 1e-18)
                throw OpError(op.id, "MIRROR: plane normal is zero");
        }
        return forge::part::mirrorPattern(a, ox, oy, oz, nx, ny, nz);
    }

    // PATTERN — LINEAR / POLAR / GRID replication of a solid, fused into one
    // body. Maps to native part::linearPattern / circularPattern (GRID = two
    // orthogonal linear passes). `n`/`nx`/`ny` are TOTAL instance counts (incl.
    // the original). POLAR step = totalAngle / n (use 360 for a full ring).
    Handle opPattern(const Op& op, std::unordered_map<int, Val>& env) {
        Handle a = refSolid(op, 0, env);
        std::string mode = kwReq(op, 1);
        if (mode == "LINEAR") {
            int n = static_cast<int>(num(op, 2));
            if (n < 1) throw OpError(op.id, "PATTERN LINEAR: n must be >= 1");
            double dx = num(op, 3), dy = numOpt(op, 4, 0), dz = numOpt(op, 5, 0);
            return forge::part::linearPattern(a, static_cast<std::uint32_t>(n), dx, dy, dz);
        }
        if (mode == "POLAR") {
            int n = static_cast<int>(num(op, 2));
            if (n < 1) throw OpError(op.id, "PATTERN POLAR: n must be >= 1");
            double angDeg = num(op, 3);
            double ox = numOpt(op, 4, 0), oy = numOpt(op, 5, 0), oz = numOpt(op, 6, 0);
            double ax = numOpt(op, 7, 0), ay = numOpt(op, 8, 0), az = numOpt(op, 9, 1);
            if (ax * ax + ay * ay + az * az < 1e-18)
                throw OpError(op.id, "PATTERN POLAR: axis is zero");
            return forge::part::circularPattern(a, static_cast<std::uint32_t>(n),
                                                ox, oy, oz, ax, ay, az, angDeg * kPi / 180.0);
        }
        if (mode == "GRID") {
            int nx = static_cast<int>(num(op, 2)), ny = static_cast<int>(num(op, 3));
            if (nx < 1 || ny < 1) throw OpError(op.id, "PATTERN GRID: nx, ny must be >= 1");
            double dx = num(op, 4), dy = num(op, 5);
            Handle row = forge::part::linearPattern(a, static_cast<std::uint32_t>(nx), dx, 0, 0);
            return forge::part::linearPattern(row, static_cast<std::uint32_t>(ny), 0, dy, 0);
        }
        throw OpError(op.id, "PATTERN: mode must be LINEAR|POLAR|GRID");
    }

    // ---- features -----------------------------------------------------------
    Handle cylCutter(double dia, double cx, double cy, double cz,
                     double ax, double ay, double az, double h) {
        return place(forge::makeCylinder(dia / 2.0, h), cx, cy, cz, ax, ay, az);
    }

    // A cutter guaranteed to pass CLEAN THROUGH `body` along `a`, whatever the
    // part's proportions.
    //
    // The previous rule — centre a cutter of length (bbox diagonal + 2) on the
    // op's own (cx,cy,cz) — only reaches diag/2 beyond that point. Since the IR
    // states a hole's position on the face it enters (z=0 for a part sitting on
    // the origin plane), a part TALLER than diag/2 got a BLIND hole and no
    // error: CYL(9.633, 104.100) + HOLE(dia 17.045) cut just 54.8 mm of 104.1.
    // Projecting the bounding box onto the axis is exact for any proportion and
    // any axis direction.
    struct ThroughCutter { double sx, sy, sz, ax, ay, az, len; };
    ThroughCutter throughAxis(Handle body, double cx, double cy, double cz,
                              double ax, double ay, double az) {
        double L = std::sqrt(ax * ax + ay * ay + az * az);
        if (L < 1e-12) { ax = 0; ay = 0; az = 1; L = 1; }
        ax /= L; ay /= L; az /= L;
        auto bb = bboxOf(body);
        double tMin = 1e300, tMax = -1e300;
        for (int i = 0; i < 8; ++i) {
            const double c[3] = {(i & 1) ? bb[3] : bb[0],
                                 (i & 2) ? bb[4] : bb[1],
                                 (i & 4) ? bb[5] : bb[2]};
            const double t = (c[0] - cx) * ax + (c[1] - cy) * ay + (c[2] - cz) * az;
            tMin = std::min(tMin, t);
            tMax = std::max(tMax, t);
        }
        const double pad = 1.0;
        tMin -= pad; tMax += pad;
        return ThroughCutter{cx + ax * tMin, cy + ay * tMin, cz + az * tMin,
                             ax, ay, az, tMax - tMin};
    }

    Handle opHole(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        double dia = num(op, 1);
        double cx = num(op, 2), cy = num(op, 3), cz = num(op, 4);
        double ax = numOpt(op, 5, 0), ay = numOpt(op, 6, 0), az = numOpt(op, 7, 1);
        double depth = numOpt(op, 8, -1);   // <=0 => through
        if (depth > 0)
            return forge::cut(body, cylCutter(dia, cx, cy, cz, ax, ay, az, depth));
        auto c = throughAxis(body, cx, cy, cz, ax, ay, az);
        return forge::cut(body, cylCutter(dia, c.sx, c.sy, c.sz, c.ax, c.ay, c.az, c.len));
    }

    Handle opCbore(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        double dia = num(op, 1), cbd = num(op, 2), cbdep = num(op, 3);
        double cx = num(op, 4), cy = num(op, 5), cz = num(op, 6);
        double ax = numOpt(op, 7, 0), ay = numOpt(op, 8, 0), az = numOpt(op, 9, 1);
        // 1) through pilot hole — same full-extent rule as opHole (a counterbore
        //    on a tall boss got a blind pilot under the old bbox-diagonal rule)
        auto c = throughAxis(body, cx, cy, cz, ax, ay, az);
        ax = c.ax; ay = c.ay; az = c.az;
        Handle r = forge::cut(body, cylCutter(dia, c.sx, c.sy, c.sz, ax, ay, az, c.len));
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

    // BLEND — variable-radius fillet: radius sweeps rStart -> rEnd along each
    // selected edge (linear law, or S-law with SMOOTH). Maps to native
    // varfillet::fillet. Same shrinking-radius retry as FILLET.
    Handle opBlend(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        double r0 = num(op, 1), r1 = num(op, 2);
        std::string sel = "ALL";
        bool smooth = false;
        for (std::size_t i = 3; i < op.args.size(); ++i) {
            if (op.args[i].kind != TokKind::Keyword) continue;
            const std::string& kw = op.args[i].kw;
            if (kw == "SMOOTH") smooth = true;
            else sel = kw;
        }
        auto ids = selectEdges(body, sel, op.id);
        for (double scale : {1.0, 0.75, 0.5, 0.35, 0.2}) {
            std::vector<forge::varfillet::EdgeSpec> specs;
            specs.reserve(ids.size());
            for (auto id : ids) {
                forge::varfillet::EdgeSpec s;
                s.edgeIndex   = id;
                s.radiusStart = r0 * scale;
                s.radiusEnd   = r1 * scale;
                specs.push_back(s);
            }
            try { return forge::varfillet::fillet(body, specs, smooth); }
            catch (...) { /* try smaller radii */ }
        }
        throw OpError(op.id, "BLEND: kernel declined at every radius (r=" +
                      std::to_string(r0) + "->" + std::to_string(r1) + ")");
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
        // OFF-BY-ONE, MEASURED. Two face-id conventions meet on this line and
        // they are NOT the same one:
        //   forge::direct::inferFeature  takes a 1-BASED FaceId (DirectModeling.cpp
        //     lookupFace indexes a TopTools_IndexedMapOfShape from 1; Tessellate.hpp
        //     documents the same 1-based ordering for every direct.* id), and
        //   forge::part::shell           takes 0-BASED indices (Features.cpp
        //     faceById: "Resolve a 0-based face index ...", and forge-desktop/
        //     feature_probe.cpp removes the first face by passing {0}).
        // Passing the 1-based `best` straight through therefore opened the face
        // BEFORE the intended one. It was silent: the result is still a valid,
        // watertight, plausible-looking shell — just hollowed on the wrong side.
        // MEASURED on SHELL(BOX(60,40,30), 3): 24048 mm^3 (a 60x30 side face
        // removed => 72000 - 54*37*24) where the closed form for the -Z face is
        // 22428 (72000 - 54*34*27). 7.2% of the part's mass, and the opening on
        // the wrong axis. forge-desktop/ui_ir_probe.cpp asserts the closed form.
        return forge::part::shell(body, {best - 1}, -std::fabs(wall), {});
    }

    // FOLD — sheet-metal flange macro (EXTRUDE + ROTATE-about-hinge + FUSE),
    // composed entirely from verified native ops (makeBox/rotate/translate/fuse).
    // The hinge (fold line) starts at (hx,hy,hz) and runs `len` along the XY
    // direction runDeg (deg from +X): u = (cos, sin, 0). A flange box of
    // len x flangeH x thk sits flush in-plane from the hinge, extending along
    // the in-plane perpendicular w = zhat x u, then rotates up about the hinge
    // axis by angleDeg (90 => vertical wall). Place the hinge on a plate edge
    // with w pointing off the plate so the wall folds up cleanly.
    Handle opFold(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        double hx = num(op, 1), hy = num(op, 2), hz = num(op, 3);
        double len = num(op, 4), fh = num(op, 5), t = num(op, 6);
        double angDeg = num(op, 7);
        double runDeg = numOpt(op, 8, 0);
        if (len <= 0 || fh <= 0 || t <= 0)
            throw OpError(op.id, "FOLD: len, flangeH, thk must be > 0");
        double runRad = runDeg * kPi / 180.0;
        // flange box: local x in [0,len], y in [0,flangeH], z in [0,thk]
        Handle flange = forge::makeBox(len, fh, t);
        // orient local x->u, y->w by rotating about +Z (box corner is at origin)
        if (runDeg != 0.0) flange = forge::rotate(flange, 0, 0, 1, runRad);
        flange = forge::translate(flange, hx, hy, hz);   // hinge corner -> hinge point
        // fold about the hinge axis line (through (hx,hy,hz), dir u)
        double ux = std::cos(runRad), uy = std::sin(runRad), uz = 0;
        double ang = angDeg * kPi / 180.0;
        flange = forge::translate(flange, -hx, -hy, -hz);
        flange = forge::rotate(flange, ux, uy, uz, ang);
        flange = forge::translate(flange, hx, hy, hz);
        return forge::fuse(body, flange);
    }

    Handle opHeal(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        auto r = forge::heal::simplifyShape(body, {});
        return r.handle != forge::kInvalidHandle ? r.handle : body;
    }

    // ======================================================================
    // SURFACE SHEETS — the fourth value kind.
    //
    // Every builder below is TOLERANT BY CONSTRUCTION, and the constraint that
    // made it so is worth stating once: a validator that refuses input is a
    // capability gate wearing a safety hat, and it fires hardest on the longest,
    // densest, most curved trees — exactly the valuable ones. So:
    //
    //   * a selector that matches NOTHING yields an EMPTY sheet, not an abort;
    //   * an unsewn face set is a legal value, and THICKEN/CAP SEW IT FOR YOU
    //     rather than declining it;
    //   * an unknown trailing flag is recorded in the sheet's note, not thrown;
    //   * the only refusals left are the ones with no alternative (the kernel
    //     itself declined the offset), and each names the op id, the face count
    //     and the free-edge count so a repair loop has something to act on.
    //
    // `pendingNote` / `pendingFaces` are how a builder hands its DIAGNOSIS back to
    // the walker, which stores it on the Val. A degenerate surface is only
    // representable if it is also answerable.
    // ======================================================================

    // The sheet a surface op is about to work on, sewn if it needs sewing.
    //
    // Sewing here is a REPAIR, not a precondition: FACES() deliberately returns an
    // unsewn compound (so the caller can see whether the faces it asked for
    // actually meet), and THICKEN/CAP need a shell. Doing it silently would hide
    // the repair, so it is recorded in `pendingNote` instead of being refused.
    Handle sewIfLoose(const Val& sheet, double tol, std::string& note) {
        forge::surf::SheetStats st;
        try { st = forge::surf::statsOf(sheet.h); } catch (...) { return sheet.h; }
        if (st.faces <= 1) return sheet.h;
        try {
            auto r = forge::heal::sewShape(sheet.h, tol);
            if (r.handle == forge::kInvalidHandle) return sheet.h;
            note += (note.empty() ? "" : "; ") + std::string("auto-sewed ") +
                    std::to_string(st.faces) + " faces (open edges " +
                    std::to_string(r.report.openEdgesBefore) + " -> " +
                    std::to_string(r.report.openEdgesAfter) + ")";
            return r.handle;
        } catch (const std::exception& e) {
            // The sew declined. That is a fact about the sheet, not a reason to
            // end the tree: the unsewn sheet is still a legal SURFACE and the
            // caller may still be able to use it.
            note += (note.empty() ? "" : "; ") + std::string("sew declined: ") + e.what();
            return sheet.h;
        }
    }

    // A one-line description of a sheet, for a message a repair loop reads.
    static std::string describe(const forge::surf::SheetStats& st) {
        return std::to_string(st.faces) + " faces, " + std::to_string(st.freeEdges) +
               " free edges, " + std::to_string(st.nonManifoldEdges) +
               " non-manifold edges, " + std::to_string(st.edgesWithoutPCurve) +
               " edges without p-curves, " + std::to_string(st.freeformFaces) +
               " free-form faces";
    }

    // SKIN — the lateral skin of a loft, typed as the sheet it actually is.
    // Same kernel call as LOFT with the OPEN flag (loftguide::loft(..., false,
    // ruled)); the difference is the VALUE KIND, which is the whole point.
    Handle opSkin(const Op& op, std::unordered_map<int, Val>& env) {
        std::vector<Handle> wires;
        bool ruled = false;
        std::string note;
        for (std::size_t i = 0; i < op.args.size(); ++i) {
            if (op.args[i].kind == TokKind::Ref) {
                wires.push_back(refWire(op, i, env));
            } else if (op.args[i].kind == TokKind::Keyword) {
                const std::string& kw = op.args[i].kw;
                if (kw == "RULED") ruled = true;
                else if (kw == "OPEN") { /* implied by SKIN; accepted, not an error */ }
                else {
                    // NOT a throw. Losing a whole tree over one mistyped flag is
                    // the failure mode this design exists to avoid; the token is
                    // named in the sheet's diagnosis instead, where SURFCHECK and
                    // the repair loop can see it.
                    note += (note.empty() ? "" : "; ") + std::string("ignored unknown flag `") +
                            kw + "` (want RULED)";
                }
            } else {
                throw OpError(op.id, "SKIN: arg #" + std::to_string(i) +
                              " must be a %wire ref or a flag (RULED)");
            }
        }
        if (wires.size() < 2)
            throw OpError(op.id, "SKIN needs >= 2 WIRE sections (RING/WIRE); got " +
                                 std::to_string(wires.size()));
        const Handle h = forge::loftguide::loft(wires, {}, /*solid=*/false, ruled);
        pendingNote = note;
        try { pendingFaces = static_cast<int>(forge::surf::statsOf(h).faces); } catch (...) {}
        return h;
    }

    // FACES — SOLID -> SURFACE. The direction without which the kind is a dead
    // end: an edit task hands you a 430-face body and asks about 67 of its faces.
    //
    // The selector is resolved TOLERANTLY. resolveSelector() throws when a
    // predicate matches nothing, which is right for DEFEATURE (deleting nothing is
    // a wrong edit reported as success) and wrong here: an empty sheet is a
    // perfectly good answer to "which faces match this", and it is the answer that
    // lets the rest of the tree run and be measured.
    Handle opFaces(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        const std::string sel = strArg(op, 1);
        std::vector<int> idx;
        std::string note;
        try {
            idx = resolveSelector(op.id, body, sel);
        } catch (const OpError& e) {
            note = std::string("selector `") + sel + "` matched nothing: " + e.what();
        } catch (const std::exception& e) {
            note = std::string("selector `") + sel + "` failed: " + e.what();
        }
        std::vector<int> skipped;
        const Handle h = forge::surf::facesOf(body, idx, &skipped);
        if (!skipped.empty()) {
            note += (note.empty() ? "" : "; ") + std::string("skipped ") +
                    std::to_string(skipped.size()) + " unusable face index/indices";
        }
        forge::surf::SheetStats st;
        try { st = forge::surf::statsOf(h); } catch (...) {}
        pendingFaces = static_cast<int>(st.faces);
        pendingNote = note.empty() ? ("FACES `" + sel + "` -> " + describe(st)) : note;
        return h;
    }

    // SEW — stitch sheets into one sheet. Stays a SURFACE even when the stitch
    // closes it: making the value kind depend on measured geometry would mean the
    // emitter cannot know what `%N` is without building it. CAP promotes.
    Handle opSew(const Op& op, std::unordered_map<int, Val>& env) {
        std::vector<Handle> sheets;
        double tol = 1e-3;
        std::string note;
        for (std::size_t i = 0; i < op.args.size(); ++i) {
            if (op.args[i].kind == TokKind::Ref) {
                const Val v = refSurface(op, i, env);
                sheets.push_back(v.h);
                if (!v.note.empty()) note += (note.empty() ? "" : "; ") + v.note;
            } else if (op.args[i].kind == TokKind::Number) {
                tol = op.args[i].num;
            } else if (op.args[i].kind == TokKind::Keyword) {
                note += (note.empty() ? "" : "; ") + std::string("ignored unknown flag `") +
                        op.args[i].kw + "`";
            } else {
                throw OpError(op.id, "SEW: arg #" + std::to_string(i) +
                              " must be a %surface ref or a tolerance");
            }
        }
        if (sheets.empty())
            throw OpError(op.id, "SEW needs at least one %surface reference");
        if (tol <= 0.0) {
            note += (note.empty() ? "" : "; ") +
                    std::string("tolerance <= 0 replaced by the 0.001 mm default");
            tol = 1e-3;
        }
        Handle h = forge::kInvalidHandle;
        if (sheets.size() == 1) {
            auto r = forge::heal::sewShape(sheets.front(), tol);
            h = (r.handle != forge::kInvalidHandle) ? r.handle : sheets.front();
        } else {
            auto r = forge::sewing::sew(sheets, tol);
            if (r.handle == forge::kInvalidHandle)
                throw OpError(op.id, "SEW: the kernel returned no shape for " +
                                     std::to_string(sheets.size()) + " sheets at tol " +
                                     std::to_string(tol));
            h = r.handle;
            note += (note.empty() ? "" : "; ") + std::string("free edges after sew: ") +
                    std::to_string(r.report.freeEdges);
        }
        forge::surf::SheetStats st;
        try { st = forge::surf::statsOf(h); } catch (...) {}
        pendingFaces = static_cast<int>(st.faces);
        pendingNote = note.empty() ? describe(st) : note;
        return h;
    }

    // THICKEN — SURFACE -> SOLID. side = IN | OUT | MID (default MID).
    Handle opThicken(const Op& op, std::unordered_map<int, Val>& env) {
        const Val sheet = refSurface(op, 0, env);
        const double wall = num(op, 1);
        if (wall <= 0.0) throw OpError(op.id, "THICKEN: wall must be > 0");
        const std::string sideKw = kwOpt(op, 2, "MID");
        int side = 0;
        if (sideKw == "IN" || sideKw == "INWARD") side = -1;
        else if (sideKw == "OUT" || sideKw == "OUTWARD") side = 1;
        else if (sideKw == "MID" || sideKw == "SYMMETRIC") side = 0;
        else throw OpError(op.id, "THICKEN: side `" + sideKw + "` is not IN | OUT | MID");

        std::string note = sheet.note;
        const Handle sewn = sewIfLoose(sheet, 1e-3, note);
        forge::surf::SheetStats st;
        try { st = forge::surf::statsOf(sewn); } catch (...) {}
        if (st.faces == 0)
            throw OpError(op.id, "THICKEN: %" + std::to_string(op.args[0].ref) +
                                 " is an EMPTY sheet (0 faces) — nothing to offset" +
                                 (note.empty() ? "" : "; " + note));
        try {
            const Handle h = forge::part::thickenSurface(sewn, wall, side);
            pendingNote = note;
            return h;
        } catch (const std::exception& e) {
            // The kernel declined. This is the one place a refusal is unavoidable,
            // so it carries everything a repair loop needs: the op, the sheet's
            // measured state and the kernel's own words.
            throw OpError(op.id, std::string("THICKEN declined by the kernel (") + e.what() +
                                 ") on a sheet of " + describe(st) +
                                 (note.empty() ? "" : "; " + note));
        }
    }

    // CAP — SURFACE -> SOLID by sewing the sheet and filling every free boundary.
    //
    // A cap that does not fully close is NOT an error here: the result is still
    // returned, compile()'s own validity pass names it as the first invalid solid,
    // and the note says how many boundaries were left. Refusing would throw away a
    // body that is one HEAL away from correct.
    Handle opCap(const Op& op, std::unordered_map<int, Val>& env) {
        const Val sheet = refSurface(op, 0, env);
        double tol = numOpt(op, 1, 1e-3);
        std::string note = sheet.note;
        if (tol <= 0.0) {
            note += (note.empty() ? "" : "; ") +
                    std::string("tolerance <= 0 replaced by the 0.001 mm default");
            tol = 1e-3;
        }
        const Handle sewn = sewIfLoose(sheet, tol, note);
        forge::surf::SheetStats st;
        try { st = forge::surf::statsOf(sewn); } catch (...) {}
        if (st.faces == 0)
            throw OpError(op.id, "CAP: %" + std::to_string(op.args[0].ref) +
                                 " is an EMPTY sheet (0 faces) — nothing to close" +
                                 (note.empty() ? "" : "; " + note));
        auto r = forge::heal::autoFillMissingFaces(sewn, tol);
        if (r.handle == forge::kInvalidHandle)
            throw OpError(op.id, "CAP: the kernel returned no shape for a sheet of " +
                                 describe(st) + (note.empty() ? "" : "; " + note));
        note += (note.empty() ? "" : "; ") + std::string("capped ") +
                std::to_string(r.report.facesAdded) + " boundaries, open edges " +
                std::to_string(r.report.openEdgesBefore) + " -> " +
                std::to_string(r.report.openEdgesAfter);
        pendingNote = note;
        return r.handle;
    }

    // SURFCHECK — measure a sheet and record the answer. Pass-through, exactly
    // like VERIFY and TAG: it returns %surface unchanged.
    //
    // THIS IS THE HALF OF THE TOLERANCE CONTRACT THAT MAKES THE OTHER HALF HONEST.
    // Representing an unsewn / p-curve-less / self-intersecting sheet is only
    // useful if the tree can ASK about it, and a check that aborted the walk would
    // be a refusal by another name. So a failed assertion is recorded, fails the
    // compile at the end (via firstVerifyFail, the same mechanism VERIFY uses) and
    // never stops the geometry from being built and measured.
    Handle opSurfCheck(const Op& op, std::unordered_map<int, Val>& env) {
        const Val sheet = refSurface(op, 0, env);
        forge::surf::SheetStats st;
        std::string statsErr;
        try { st = forge::surf::statsOf(sheet.h); }
        catch (const std::exception& e) { statsErr = e.what(); }

        bool selfIntersect = false;
        bool validityKnown = false;
        try {
            const auto rep = forge::heal::checkValidity(sheet.h);
            selfIntersect = rep.hasSelfIntersect;
            validityKnown = true;
        } catch (...) { /* an unmeasurable sheet is still a legal sheet */ }

        if (res != nullptr) {
            std::ostringstream head;
            head << "SURFCHECK %" << op.args[0].ref << " " << describe(st);
            if (!sheet.note.empty()) head << " [" << sheet.note << "]";
            if (!statsErr.empty()) head << " [stats unavailable: " << statsErr << "]";
            res->verify.push_back(head.str());
        }

        for (std::size_t i = 1; i < op.args.size(); ++i) {
            if (op.args[i].kind != TokKind::Str) continue;
            const std::string expr = op.args[i].str;
            std::string key, cmp, valStr;
            for (const char* c : {"<=", ">=", "=", "<", ">"}) {
                const std::size_t p = expr.find(c);
                if (p != std::string::npos) {
                    key = lower(trim(expr.substr(0, p)));
                    cmp = c;
                    valStr = trim(expr.substr(p + std::string(c).size()));
                    break;
                }
            }
            double want = 0;
            if (key.empty() || !parseDouble(valStr, want))
                throw OpError(op.id, "SURFCHECK: cannot parse assertion `" + expr + "`");

            double got = 0;
            if (key == "faces" || key == "facecount")        got = static_cast<double>(st.faces);
            else if (key == "edges" || key == "edgecount")   got = static_cast<double>(st.edges);
            else if (key == "freeedges" || key == "free_edges" || key == "openedges")
                got = static_cast<double>(st.freeEdges);
            else if (key == "nonmanifold" || key == "nonmanifoldedges")
                got = static_cast<double>(st.nonManifoldEdges);
            else if (key == "pcurves" || key == "missingpcurves" || key == "nopcurves")
                got = static_cast<double>(st.edgesWithoutPCurve);
            else if (key == "freeform" || key == "freeformfaces" || key == "bspline")
                got = static_cast<double>(st.freeformFaces);
            else if (key == "shells")                        got = static_cast<double>(st.shells);
            else if (key == "closed")                        got = st.closed ? 1.0 : 0.0;
            else if (key == "area")                          got = st.area;
            else if (key == "selfintersect" || key == "self_intersect") {
                if (!validityKnown)
                    throw OpError(op.id, "SURFCHECK: `" + expr +
                                         "` cannot be answered — the validity check "
                                         "declined this sheet (" + describe(st) + ")");
                got = selfIntersect ? 1.0 : 0.0;
            } else {
                // Name the vocabulary: this string is the repair instruction.
                throw OpError(op.id, "SURFCHECK: unknown quantity `" + key + "` in `" + expr +
                                     "` — known: faces, edges, freeEdges, nonManifold, "
                                     "pcurves, freeform, shells, closed, area, selfIntersect");
            }

            const double tol = std::max(1e-6, 1e-3 * std::fabs(want));
            bool pass = false;
            if (cmp == "=")       pass = std::fabs(got - want) <= tol;
            else if (cmp == "<=") pass = got <= want + tol;
            else if (cmp == ">=") pass = got >= want - tol;
            else if (cmp == "<")  pass = got < want;
            else if (cmp == ">")  pass = got > want;

            std::ostringstream note;
            note << (pass ? "PASS " : "FAIL ") << expr << " (got " << got << ")";
            if (res != nullptr) res->verify.push_back(note.str());
            if (!pass && firstVerifyFail.empty())
                firstVerifyFail = "op %" + std::to_string(op.id) + " (line " +
                                  std::to_string(op.srcLine) + "): SURFCHECK failed: " +
                                  expr + " (got " + std::to_string(got) + ")";
        }
        pendingFaces = static_cast<int>(st.faces);
        pendingNote = sheet.note;
        return sheet.h;   // pass-through: SURFCHECK measures, it does not modify
    }

    // ======================================================================

    // EDIT OPS — the second half of the Unified IR, executed by the SAME
    // walker. Selectors are resolved against the live faceInventory, so an
    // edit tree never carries a face index the model had to guess.
    // ======================================================================

    static std::string strArg(const Op& op, std::size_t i) {
        if (i >= op.args.size() || op.args[i].kind != TokKind::Str)
            throw OpError(op.id, op.name + ": arg #" + std::to_string(i) +
                                     " must be a quoted string (a face selector)");
        return op.args[i].str;
    }

    static std::string lower(std::string s) {
        for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        return s;
    }

    // Resolve a face SELECTOR predicate against `body`'s live face inventory.
    // Returns 1-based face indices, ordered most-relevant-first. Throws (loudly)
    // when the predicate matches nothing — a silent empty selection would let a
    // wrong edit report success.
    static FaceSig sigOf(const forge::FaceInfo& f) {
        FaceSig s;
        s.kind = f.kind;
        s.radius = f.radius;
        s.minorRadius = f.minorRadius;
        s.area = f.area;
        const bool curved = (f.kind != "plane");
        for (int k = 0; k < 3; ++k) {
            s.at[k] = curved ? f.axisLocation[k] : f.centroid[k];
            s.dir[k] = f.direction[k];
        }
        s.concave = f.concave;
        s.valid = true;
        return s;
    }

    // How far a candidate is from a remembered feature. Kind and concavity must
    // match exactly — a bore never becomes a boss — and the rest is a distance so
    // a feature that was merely RESIZED or MOVED is still recognisably itself.
    static double sigDistance(const FaceSig& want, const forge::FaceInfo& f) {
        if (f.kind != want.kind || f.concave != want.concave) return 1e300;
        double d = 0;
        const bool curved = (f.kind != "plane");
        for (int k = 0; k < 3; ++k) {
            const double p = curved ? f.axisLocation[k] : f.centroid[k];
            d += (p - want.at[k]) * (p - want.at[k]);
            const double dd = f.direction[k] - want.dir[k];
            d += 4.0 * dd * dd;                       // orientation weighted higher
        }
        d = std::sqrt(d);
        d += 0.25 * std::fabs(f.radius - want.radius);
        return d;
    }

    // Split "@name|legacy-sel" -> {"@name", "legacy-sel"}; "" when absent.
    static void splitWitness(const std::string& sel, std::string& nameRef,
                             std::string& witness) {
        const std::size_t bar = sel.find('|');
        if (bar == std::string::npos) { nameRef = sel; witness.clear(); return; }
        nameRef = trim(sel.substr(0, bar));
        witness = trim(sel.substr(bar + 1));
    }

    std::vector<int> resolveSelector(int opId, Handle body, const std::string& selRaw) {
        std::vector<forge::FaceInfo> inv;
        try {
            inv = forge::faceInventory(body);
        } catch (const std::exception& e) {
            throw OpError(opId, std::string("faceInventory failed: ") + e.what());
        }
        if (inv.empty()) throw OpError(opId, "faceInventory returned no faces");

        const std::string sel = lower(trim(selRaw));
        std::vector<int> out;

        // ---- @name / @name|witness: resolve a PERSISTENT feature ------------
        if (!sel.empty() && sel[0] == '@') {
            std::string nameRef, witness;
            splitWitness(sel, nameRef, witness);
            const std::string key = nameRef.substr(1);
            auto it = names.find(key);
            if (it == names.end())
                throw OpError(opId, "selector `" + selRaw + "` names @" + key +
                                        ", which was never declared by a TAG");
            const FaceSig& want = it->second;

            int best = 0;
            double bestD = 1e300, secondD = 1e300, bestPos = 1e300;
            for (const auto& f : inv) {
                const double d = sigDistance(want, f);
                if (d < bestD) {
                    secondD = bestD; bestD = d; best = f.index;
                    bestPos = 0;
                    const bool curved = (f.kind != "plane");
                    for (int k = 0; k < 3; ++k) {
                        const double p = curved ? f.axisLocation[k] : f.centroid[k];
                        bestPos += (p - want.at[k]) * (p - want.at[k]);
                    }
                    bestPos = std::sqrt(bestPos);
                } else if (d < secondD) { secondD = d; }
            }
            // NEAREST IS NOT ENOUGH. Deleting a named corner hole left its name
            // resolving happily to a DIFFERENT corner hole 60 mm away — a silent
            // retarget, the exact failure a name exists to prevent. A feature may
            // be resized or nudged and still be itself; one that has moved further
            // than its own diameter is a different feature, and the name is dead.
            const double posTol = std::max(1.0, 2.0 * want.radius);
            if (!best || bestD > 1e299 || bestPos > posTol)
                throw OpError(opId, "@" + key + " no longer matches any face — the "
                                    "feature it named is gone (deleted, or merged by a "
                                    "boolean); nearest candidate is " +
                                    std::to_string(bestPos) + " mm away, tolerance " +
                                    std::to_string(posTol));
            // Two candidates equally close means the name is no longer a name.
            if (secondD < 1e299 && std::fabs(secondD - bestD) < 1e-6)
                throw OpError(opId, "@" + key + " is ambiguous: two faces match it "
                                    "equally well (a PATTERN duplicated the feature?)");

            // Law 6 — identity is CHECKED, not asserted. When a witness predicate
            // is carried alongside the name, the two independent derivations must
            // agree, or the name has silently retargeted and we say so.
            if (!witness.empty()) {
                const std::vector<int> byPredicate = resolveSelector(opId, body, witness);
                if (std::find(byPredicate.begin(), byPredicate.end(), best) ==
                    byPredicate.end())
                    throw OpError(opId, "@" + key + " and its witness `" + witness +
                                            "` disagree: the name resolves to face " +
                                            std::to_string(best) +
                                            ", the predicate does not include it — the "
                                            "name has retargeted");
            }
            out.push_back(best);
            return out;
        }

        auto axisPick = [&](int axis, double sign) {
            // The planar face whose outward normal is most aligned with the axis
            // and which lies furthest along it — "the +Z face".
            int best = 0;
            double bestPos = -1e300;
            for (const auto& f : inv) {
                if (f.kind != "plane") continue;
                if (f.direction[axis] * sign < 0.7) continue;   // must face that way
                double pos = f.centroid[axis] * sign;
                if (pos > bestPos) { bestPos = pos; best = f.index; }
            }
            if (best) out.push_back(best);
        };

        // ---- axis-extreme planes: "+Z" "-X" ... ----
        if (sel.size() == 2 && (sel[0] == '+' || sel[0] == '-') &&
            (sel[1] == 'x' || sel[1] == 'y' || sel[1] == 'z')) {
            axisPick(sel[1] - 'x', sel[0] == '+' ? 1.0 : -1.0);
        }
        // ---- "plane:max-area" ----
        else if (sel == "plane:max-area" || sel == "plane:largest") {
            int best = 0; double bestA = -1.0;
            for (const auto& f : inv)
                if (f.kind == "plane" && f.area > bestA) { bestA = f.area; best = f.index; }
            if (best) out.push_back(best);
        }
        // ---- explicit index: "face:12" ----
        else if (sel.rfind("face:", 0) == 0) {
            double v;
            if (!parseDouble(sel.substr(5), v)) throw OpError(opId, "bad selector `" + selRaw + "`");
            int idx = static_cast<int>(v);
            if (idx < 1 || idx > static_cast<int>(inv.size()))
                throw OpError(opId, "face:" + std::to_string(idx) + " out of range (1.." +
                                        std::to_string(inv.size()) + ")");
            out.push_back(idx);
        }
        // ---- REPEATED RADIAL FEATURES: "radial:k" / "radial:all" ------------
        // Ground truth 203 asks to "locate 7 radial blade solids about the hub
        // axis; select 2 (symmetric)". No selector could say that: bores, planes
        // and bosses name ONE face, and a blade is a GROUP of faces repeated about
        // an axis. This is the family every impeller, spoke, lug and rib edit
        // needs, and without it that whole class of benchmark task is inexpressible.
        //
        // A radial group is found from the face inventory alone: take every face
        // whose centroid lies off the Z axis, bin it by angle, and test candidate
        // fold counts for how evenly the mass distributes. The fold count with the
        // most even occupancy IS the repeat count — an impeller with 7 blades has 7
        // populated bins and 7-fold symmetry, and nothing else does.
        else if (sel.rfind("radial", 0) == 0 || sel.rfind("blade", 0) == 0 ||
                 sel.rfind("lug", 0) == 0 || sel.rfind("spoke", 0) == 0) {
            // radius of the on-axis core: faces closer than this are hub, not feature
            double maxR = 0.0;
            for (const auto& f : inv) {
                const double r = std::hypot(f.centroid[0], f.centroid[1]);
                maxR = std::max(maxR, r);
            }
            if (maxR < 1e-9)
                throw OpError(opId, "selector `" + selRaw +
                                        "` needs an off-axis feature; every face is on the axis");
            const double coreR = 0.35 * maxR;

            struct Item { int index; double ang; };
            std::vector<Item> items;
            for (const auto& f : inv) {
                const double r = std::hypot(f.centroid[0], f.centroid[1]);
                if (r < coreR) continue;
                double a = std::atan2(f.centroid[1], f.centroid[0]);
                if (a < 0) a += 2.0 * kPi;
                items.push_back(Item{f.index, a});
            }
            if (items.size() < 2)
                throw OpError(opId, "selector `" + selRaw + "` found no off-axis features");

            // pick the fold count whose bins are most evenly occupied
            std::vector<double> allAng;
            allAng.reserve(items.size());
            for (const auto& it : items) allAng.push_back(it.ang);
            const int bestN = rotationalOrder(allAng);
            if (bestN < 2)
                throw OpError(opId, "selector `" + selRaw +
                                        "` found no rotationally repeated feature group");

            // how many members to take
            std::size_t want = 1;
            const std::size_t colon = sel.rfind(':');
            if (colon != std::string::npos) {
                const std::string tail = sel.substr(colon + 1);
                if (tail == "all") want = static_cast<std::size_t>(bestN);
                else {
                    double v = 0;
                    if (!parseDouble(tail, v) || v < 1)
                        throw OpError(opId, "bad count in `" + selRaw + "` (want radial:<k> or radial:all)");
                    want = static_cast<std::size_t>(v);
                }
            }
            if (want > static_cast<std::size_t>(bestN))
                throw OpError(opId, "selector `" + selRaw + "` asks for " +
                                        std::to_string(want) + " of a " +
                                        std::to_string(bestN) + "-fold group");

            // MEMBERSHIP IS BY NEAREST GROUP CENTRE, NOT BY ANGULAR SECTOR.
            //
            // Sector membership was wrong and silently removed the wrong count: on a
            // 7-blade hub, "blade:2" removed THREE blades (volume delta was exactly
            // 3 x one blade). A blade is not a sector — the blade centred on 51.43
            // degrees has a side face at ~45.6 degrees, which falls in sector 0 and
            // was selected along with blade 0; defeature then took that face and the
            // healer ate the neighbouring blade. The volume-changed guard passed it
            // because the volume DID change, which is why that guard is necessary and
            // nowhere near sufficient.
            //
            // The group centres are recovered by folding every angle into one period
            // and taking the CIRCULAR MEAN — that gives the phase; centres are then
            // phase + k*2pi/N. Each face joins the centre it is actually nearest to.
            const double period = 2.0 * kPi / bestN;
            double sx = 0.0, sy = 0.0;
            for (const auto& it : items) {
                const double folded = std::fmod(it.ang, period) * static_cast<double>(bestN);
                sx += std::cos(folded);
                sy += std::sin(folded);
            }
            double phase = std::atan2(sy, sx) / static_cast<double>(bestN);
            if (phase < 0) phase += period;

            auto memberOf = [&](double a) {
                int best = 0;
                double bestD = 1e300;
                for (int k = 0; k < bestN; ++k) {
                    const double c = phase + k * period;
                    double d = std::fabs(a - c);
                    while (d > kPi) d = std::fabs(d - 2.0 * kPi);
                    if (d < bestD) { bestD = d; best = k; }
                }
                return best;
            };

            // take members SYMMETRICALLY — evenly spaced around the group, which is
            // what "select 2 (symmetric)" means and what keeps the part balanced
            const double step = static_cast<double>(bestN) / static_cast<double>(want);
            std::vector<int> chosen;
            for (std::size_t i = 0; i < want; ++i)
                chosen.push_back(static_cast<int>(i * step) % bestN);
            for (const auto& it : items)
                if (std::find(chosen.begin(), chosen.end(), memberOf(it.ang)) != chosen.end())
                    out.push_back(it.index);

            if (out.empty())
                throw OpError(opId, "selector `" + selRaw + "` resolved to no face");
            return out;
        }
        // ---- bores / holes / bosses / fillets ----
        else {
            // gather the candidate cylindrical set for this predicate family
            std::string sel_tail;   // filter text after a position clause, if any
            const bool wantConcave = (sel.rfind("bore", 0) == 0 || sel.rfind("hole", 0) == 0);
            const bool wantConvex  = (sel.rfind("boss", 0) == 0 || sel.rfind("shaft", 0) == 0);
            const bool wantFillet  = (sel.rfind("fillet", 0) == 0 || sel.rfind("blend", 0) == 0);

            std::vector<const forge::FaceInfo*> cand;
            for (const auto& f : inv) {
                if (wantFillet) {
                    // A rolling-ball blend is a torus (rounded edge) or, on a
                    // straight edge, a cylinder. Both are collected; an explicit
                    // radius bound may narrow it.
                    if (f.kind == "torus" || f.kind == "cylinder") cand.push_back(&f);
                } else if (f.kind == "cylinder") {
                    if (wantConcave && !f.concave) continue;
                    if (wantConvex && f.concave) continue;
                    cand.push_back(&f);
                }
            }
            if (cand.empty())
                throw OpError(opId, "selector `" + selRaw + "` matched no candidate face");

            // POSITION filter: "hole:at=21.75,0" — narrow to the bore(s) whose axis
            // sits at (x,y). This is what a bolt-pattern edit needs: with N
            // equal-radius holes, WHICH ones are removed is the whole content of
            // the edit, and no rank-based selector can say it.
            //
            // It is a FILTER, not a terminal branch. It previously returned
            // immediately, so "the O4.02 bore at (21.75, 0)" was inexpressible —
            // position and radius could never be combined, which is exactly how a
            // human disambiguates a hole on a drawing.
            std::size_t ap = sel.find("at=");
            if (ap != std::string::npos) {
                std::string coords = sel.substr(ap + 3);
                for (char& c : coords)
                    if (c == '(' || c == ')' || c == ';') c = ' ';
                // stop the coordinate pair at the next filter, so
                // "hole:at=21.75,0:r=4.02" parses as position THEN radius
                std::size_t cut = coords.find(':');
                std::string pair = (cut == std::string::npos) ? coords : coords.substr(0, cut);
                double wx = 0, wy = 0;
                std::size_t comma = pair.find(',');
                if (comma == std::string::npos ||
                    !parseDouble(trim(pair.substr(0, comma)), wx) ||
                    !parseDouble(trim(pair.substr(comma + 1)), wy))
                    throw OpError(opId, "bad position in `" + selRaw + "` (want at=x,y)");
                const double tol = 1e-2;
                std::vector<const forge::FaceInfo*> at;
                for (const auto* f : cand) {
                    // a bore's axis position: prefer the axis location, fall back
                    // to the centroid for a full cylindrical face
                    double fx = f->axisLocation[0], fy = f->axisLocation[1];
                    if (fx == 0.0 && fy == 0.0 && f->kind == "cylinder") {
                        fx = f->centroid[0]; fy = f->centroid[1];
                    }
                    if (std::fabs(fx - wx) <= tol && std::fabs(fy - wy) <= tol)
                        at.push_back(f);
                }
                if (at.empty())
                    throw OpError(opId, "no bore at (" + std::to_string(wx) + ", " +
                                            std::to_string(wy) + ") for `" + selRaw + "`");
                cand.swap(at);
                // a bare position selects what it matched; a further r=/rank
                // filter below narrows it
                if (cut == std::string::npos) {
                    for (const auto* f : cand) out.push_back(f->index);
                    return out;
                }
                sel_tail = sel.substr(ap + 3 + cut + 1);
            }

            // optional exact radius: "bore:r=47.5", "fillet:r<=3"
            const std::string& fsel = sel_tail.empty() ? sel : sel_tail;
            std::size_t rp = fsel.find("r=");
            std::size_t rle = fsel.find("r<=");
            if (rle != std::string::npos) {
                double bound;
                if (!parseDouble(fsel.substr(rle + 3), bound))
                    throw OpError(opId, "bad radius bound in `" + selRaw + "`");
                for (const auto* f : cand)
                    if (f->radius <= bound + 1e-6) out.push_back(f->index);
            } else if (rp != std::string::npos) {
                double want;
                if (!parseDouble(fsel.substr(rp + 2), want))
                    throw OpError(opId, "bad radius in `" + selRaw + "`");
                // match on radius (accept a diameter-shaped value too: the model
                // sometimes writes the Ø it read off the drawing)
                for (const auto* f : cand) {
                    const double tol = std::max(1e-3, 1e-3 * want);
                    if (std::fabs(f->radius - want) <= tol ||
                        std::fabs(2.0 * f->radius - want) <= tol)
                        out.push_back(f->index);
                }
                if (out.empty())
                    throw OpError(opId, "no face with radius " + fsel.substr(rp + 2) +
                                            " for selector `" + selRaw + "`");
            } else {
                // rank-based: sort by radius then take max / min / smallest:N / largest:N / all
                std::vector<const forge::FaceInfo*> byR = cand;
                std::sort(byR.begin(), byR.end(),
                          [](const forge::FaceInfo* a, const forge::FaceInfo* b) {
                              return a->radius < b->radius;
                          });
                auto takeN = [&](bool smallest, std::size_t n) {
                    n = std::min(n, byR.size());
                    for (std::size_t k = 0; k < n; ++k)
                        out.push_back(smallest ? byR[k]->index : byR[byR.size() - 1 - k]->index);
                };
                std::size_t colon = fsel.rfind(':');
                double nv = 0;
                const bool hasN = colon != std::string::npos &&
                                  parseDouble(fsel.substr(colon + 1), nv) && nv >= 1;
                if (fsel.find("max") != std::string::npos || fsel.find("largest") != std::string::npos)
                    takeN(false, hasN ? static_cast<std::size_t>(nv) : 1);
                else if (fsel.find("min") != std::string::npos ||
                         fsel.find("smallest") != std::string::npos)
                    takeN(true, hasN ? static_cast<std::size_t>(nv) : 1);
                else if (fsel.find("all") != std::string::npos)
                    for (const auto* f : byR) out.push_back(f->index);
                else
                    throw OpError(opId, "unsupported selector `" + selRaw + "`");
            }
        }

        if (out.empty())
            throw OpError(opId, "selector `" + selRaw + "` resolved to no face");
        return out;
    }

    // TAG(%body, "@name", "declaring-sel") — pass-through, binds a name.
    Handle opTag(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        std::string nameArg = strArg(op, 1);
        std::string decl = strArg(op, 2);
        std::string key = lower(trim(nameArg));
        if (key.empty() || key[0] != '@')
            throw OpError(op.id, "TAG: the name must start with '@' (got `" + nameArg + "`)");
        key = key.substr(1);
        if (key.empty())
            throw OpError(op.id, "TAG: empty name");
        for (char c : key)
            if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '_'))
                throw OpError(op.id, "TAG: name `@" + key +
                                         "` must be [a-z0-9_] so it survives lowercasing");

        const std::vector<int> idx = resolveSelector(op.id, body, decl);
        if (idx.size() != 1)
            throw OpError(op.id, "TAG: `" + decl + "` matches " +
                                     std::to_string(idx.size()) +
                                     " faces; a name must denote exactly ONE feature");
        const auto inv = forge::faceInventory(body);
        for (const auto& f : inv) {
            if (f.index != idx[0]) continue;
            names[key] = sigOf(f);
            if (res)
                res->verify.push_back("TAG @" + key + " -> " + f.kind + " face " +
                                      std::to_string(f.index));
            return body;                       // pass-through: never alters geometry
        }
        throw OpError(op.id, "TAG: resolved face " + std::to_string(idx[0]) +
                                 " vanished from the inventory");
    }

    Handle opInput(const Op& op) {
        if (inputStep.empty())
            throw OpError(op.id, "INPUT() used but no input STEP was supplied to the compiler");
        // Dispatch on CONTENT, not on the extension. INPUT() was STEP-only, which
        // forced every non-STEP artefact through a node bridge just to reach the
        // verifier — a Law 3 (everything C++) compromise living outside the kernel
        // for want of ten lines inside it. A scanned mesh is how a real part comes
        // back from the shop floor; it must enter through the same door.
        enum class Fmt { Step, Brep, Stl, Unknown };
        Fmt fmt = Fmt::Unknown;
        {
            std::ifstream probe(inputStep, std::ios::binary);
            if (!probe)
                throw OpError(op.id, "INPUT(): cannot open " + inputStep);
            char head[512] = {0};
            probe.read(head, sizeof head - 1);
            const std::string h0(head, static_cast<std::size_t>(probe.gcount()));
            if (h0.find("ISO-10303") != std::string::npos) fmt = Fmt::Step;
            else if (h0.rfind("DBRep_DrawableShape", 0) == 0 ||
                     h0.find("CASCADE Topology") != std::string::npos) fmt = Fmt::Brep;
            else if (h0.rfind("solid", 0) == 0 || h0.find("facet normal") != std::string::npos)
                fmt = Fmt::Stl;
            else {
                // binary STL: 80-byte header then a uint32 triangle count that must
                // account for exactly the remaining bytes
                probe.clear();
                probe.seekg(0, std::ios::end);
                const std::streamoff sz = probe.tellg();
                if (sz > 84) {
                    probe.seekg(80, std::ios::beg);
                    std::uint32_t nTri = 0;
                    probe.read(reinterpret_cast<char*>(&nTri), 4);
                    if (static_cast<std::streamoff>(84 + 50ull * nTri) == sz) fmt = Fmt::Stl;
                }
            }
        }
        if (fmt == Fmt::Unknown)
            throw OpError(op.id, "INPUT(): " + inputStep +
                                     " is not a STEP, BREP or STL file (content sniffed, "
                                     "not guessed from the extension)");

        Handle h = 0;
        try {
            h = (fmt == Fmt::Step) ? forge::io::importStep(inputStep)
              : (fmt == Fmt::Brep) ? forge::io::importBrep(inputStep)
                                   : forge::io::importStl(inputStep);
        } catch (const std::exception& e) {
            throw OpError(op.id, std::string("INPUT(): cannot import ") + inputStep + ": " + e.what());
        }
        if (h == 0 || h == forge::kInvalidHandle)
            throw OpError(op.id, "INPUT(): import produced no solid from " + inputStep);
        // Face identity is meaningless on a strip-faceted body — unify first so
        // "the bore" is one face, exactly as DirectEdit.hpp requires.
        try { h = forge::unifyFaces(h); } catch (...) {}
        return h;
    }

    Handle opPushFace(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        std::string sel = strArg(op, 1);
        double dist = num(op, 2);
        auto idx = resolveSelector(op.id, body, sel);
        if (idx.size() > 1)
            throw OpError(op.id, "PUSHFACE: selector `" + sel + "` matches " +
                                     std::to_string(idx.size()) +
                                     " faces; PUSHFACE moves ONE — name it precisely");
        const auto inv = forge::faceInventory(body);
        const forge::FaceInfo* f = nullptr;
        for (const auto& fi : inv) if (fi.index == idx[0]) { f = &fi; break; }
        if (!f) throw OpError(op.id, "PUSHFACE: selector resolved to an unknown face");
        if (f->kind != "plane")
            throw OpError(op.id, "PUSHFACE: selector `" + sel + "` is a " + f->kind +
                                     " face, not planar");
        try {
            return forge::pushPullFace(body, f->index, f->direction, dist);
        } catch (const std::exception& e) {
            throw OpError(op.id, std::string("PUSHFACE failed: ") + e.what());
        }
    }

    Handle opResizeBore(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        std::string sel = strArg(op, 1);
        double r = num(op, 2);
        if (r <= 0) throw OpError(op.id, "RESIZEBORE: newRadius must be > 0");
        auto idx = resolveSelector(op.id, body, sel);
        // RESIZEBORE edits ONE face. Taking idx[0] from an ambiguous match
        // silently resized 1 of 4 identical bolt holes and reported success — the
        // part was wrong and every do-no-harm assertion still passed. An ambiguous
        // selector is a question the IR failed to answer, not a licence to guess.
        if (idx.size() > 1)
            throw OpError(op.id, "RESIZEBORE: selector `" + sel + "` matches " +
                                     std::to_string(idx.size()) +
                                     " faces; name ONE (add at=x,y or r=<value>)");
        // Resizing is defined in bore semantics; on a convex boss it completes and
        // changes nothing, which is the silent no-op this refuses to perform.
        {
            const auto inv = forge::faceInventory(body);
            for (const auto& f : inv) {
                if (f.index != idx[0]) continue;
                if (f.kind != "cylinder")
                    throw OpError(op.id, "RESIZEBORE: selector `" + sel + "` is a " +
                                             f.kind + " face, not cylindrical");
                if (!f.concave)
                    throw OpError(op.id, "RESIZEBORE: selector `" + sel +
                                             "` is a CONVEX cylinder (a boss, not a bore); "
                                             "resizing is defined in bore semantics and "
                                             "would change nothing");
                break;
            }
        }
        try {
            return forge::resizeBore(body, idx[0], r);
        } catch (const std::exception& e) {
            throw OpError(op.id, std::string("RESIZEBORE failed: ") + e.what());
        }
    }

    // DEFEATURE(%body, "sel" [, "sel2", ...]) — the union of every selector's
    // resolution is removed in ONE healing pass. A bolt-pattern edit names the
    // holes it removes individually; healing them one at a time would invalidate
    // the face indices of the ones not yet removed.
    Handle opDefeature(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        std::vector<int> idx;
        for (std::size_t i = 1; i < op.args.size(); ++i) {
            if (op.args[i].kind != TokKind::Str) continue;
            for (int f : resolveSelector(op.id, body, op.args[i].str))
                if (std::find(idx.begin(), idx.end(), f) == idx.end()) idx.push_back(f);
        }
        if (idx.empty())
            throw OpError(op.id, "DEFEATURE: no face selector given");
        double volBefore = 0.0;
        bool haveBefore = false;
        try { volBefore = forge::massProperties(body).volume; haveBefore = true; } catch (...) {}
        Handle result = 0;
        try {
            result = forge::defeature(body, idx);
        } catch (const std::exception& e) {
            throw OpError(op.id, std::string("DEFEATURE failed: ") + e.what());
        }
        // A DEFEATURE that changes NOTHING and reports success is the worst
        // outcome available: asked to remove 2 of 7 blades it returned the input
        // untouched, volume identical to the last digit, and a following
        // VERIFY "blades=7" then PASSED — a wrong part with every assertion green.
        // Removing a face group only deletes a feature the healer can close over;
        // a whole solid protrusion is not that, and the op must say so.
        if (haveBefore) {
            double volAfter = volBefore;
            try { volAfter = forge::massProperties(result).volume; } catch (...) {}
            if (std::fabs(volAfter - volBefore) <= 1e-9 * std::max(1.0, std::fabs(volBefore)))
                throw OpError(op.id,
                              "DEFEATURE removed the selected faces but the solid is "
                              "UNCHANGED (volume identical). The selection is not a "
                              "removable feature — a whole solid protrusion (blade, "
                              "boss, rib) cannot be deleted by face removal; it has to "
                              "be CUT.");
        }
        return result;
    }

    // VERIFY(%body, "faces=8", "volume<=12345", "holes=2", "bbox.z=5.61", ...)
    // Assertions are measured on the LIVE body — this is the in-IR do-no-harm
    // gate. A failed assertion is a compile failure, never a warning.
    Handle opVerify(const Op& op, std::unordered_map<int, Val>& env) {
        Handle body = refSolid(op, 0, env);
        for (std::size_t i = 1; i < op.args.size(); ++i) {
            if (op.args[i].kind != TokKind::Str) continue;
            const std::string expr = op.args[i].str;
            std::string key, cmp, valStr;
            for (const char* c : {"<=", ">=", "=", "<", ">"}) {
                std::size_t p = expr.find(c);
                if (p != std::string::npos) {
                    key = lower(trim(expr.substr(0, p)));
                    cmp = c;
                    valStr = trim(expr.substr(p + std::string(c).size()));
                    break;
                }
            }
            double want = 0;
            if (key.empty() || !parseDouble(valStr, want))
                throw OpError(op.id, "VERIFY: cannot parse assertion `" + expr + "`");

            double got = 0;
            // Accept the names a planner naturally writes. Rejecting "faceCount"
            // while accepting "faces" fails a tree for spelling, not for being
            // wrong about the geometry — and the emitted trees do write faceCount.
            if (key == "faces" || key == "facecount" || key == "nfaces")
                got = static_cast<double>(forge::direct::faceCount(body));
            else if (key == "edges" || key == "edgecount")
                got = static_cast<double>(forge::direct::edgeCount(body));
            else if (key == "volume" || key == "vol")
                got = forge::massProperties(body).volume;
            else if (key == "holes" || key == "bores") {
                // Count on the UNIFIED body. Face identity is only meaningful
                // after unification (DirectEdit.hpp) — an edit that produces a
                // new body via booleans can leave one bore split across several
                // cylindrical faces, so counting raw faces answers a different
                // question than "how many holes does this part have".
                Handle probe = body;
                try { probe = forge::unifyFaces(body); } catch (...) { probe = body; }
                const auto inv = forge::faceInventory(probe);
                long n = 0;
                // ONE HOLE == ONE AXIS, and an axis is a LINE, not a point in
                // the XY plane. The key used to be {axisLocation.x,
                // axisLocation.y, radius} — it dropped axisLocation.z AND the
                // axis DIRECTION, so it was only ever right for Z-parallel
                // bores through distinct (x,y). A cross-drilled part (vertical
                // through bore + a side port drilled in along X to meet it)
                // reports two walls that share x, y and radius and counted as
                // ONE hole; src/tools/forge_verify.cpp measures the same part
                // as two, and the two measurements of "how many holes" have to
                // agree. The key is now the axis LINE, spelled the way
                // forge_verify spells it: a canonical direction (largest
                // component made positive, so d and -d are one line) plus the
                // FOOT — the axis' closest point to the origin, which is
                // independent of WHICH point on the axis the surface reports,
                // so coaxial strips still collapse to one hole.
                struct BoreKey {
                    std::array<double, 3> dir;
                    std::array<double, 3> foot;
                    double radius;
                };
                std::vector<BoreKey> seen;
                for (const auto& f : inv) {
                    if (f.kind != "cylinder" || !f.concave) continue;

                    std::array<double, 3> d{{f.direction[0], f.direction[1], f.direction[2]}};
                    const double dl = std::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
                    if (dl < 1e-12) continue;          // no axis => not a bore
                    for (auto& c : d) c /= dl;
                    // canonical sense: the largest-magnitude component positive
                    std::size_t big = 0;
                    for (std::size_t k = 1; k < 3; ++k)
                        if (std::fabs(d[k]) > std::fabs(d[big])) big = k;
                    if (d[big] < 0) for (auto& c : d) c = -c;

                    // foot = L - (L.d) d  — the point of the axis nearest the origin
                    const std::array<double, 3> L{{f.axisLocation[0], f.axisLocation[1],
                                                   f.axisLocation[2]}};
                    const double t = L[0] * d[0] + L[1] * d[1] + L[2] * d[2];
                    const std::array<double, 3> foot{{L[0] - t * d[0], L[1] - t * d[1],
                                                      L[2] - t * d[2]}};

                    bool dup = false;
                    for (const auto& s : seen) {
                        if (std::fabs(s.radius - f.radius) >= 1e-6) continue;
                        if (std::fabs(s.dir[0] - d[0]) >= 1e-6 ||
                            std::fabs(s.dir[1] - d[1]) >= 1e-6 ||
                            std::fabs(s.dir[2] - d[2]) >= 1e-6) continue;
                        if (std::fabs(s.foot[0] - foot[0]) >= 1e-6 ||
                            std::fabs(s.foot[1] - foot[1]) >= 1e-6 ||
                            std::fabs(s.foot[2] - foot[2]) >= 1e-6) continue;
                        dup = true;
                        break;
                    }
                    if (dup) continue;
                    seen.push_back(BoreKey{d, foot, f.radius});
                    ++n;
                }
                got = static_cast<double>(n);
            } else if (key == "radial" || key == "blades" || key == "lugs" ||
                       key == "spokes") {
                // the fold count of the dominant radial group — how GT 203 says
                // "verify blade count = 5"
                Handle probe = body;
                try { probe = forge::unifyFaces(body); } catch (...) { probe = body; }
                const auto inv2 = forge::faceInventory(probe);
                double maxR = 0.0;
                for (const auto& f : inv2)
                    maxR = std::max(maxR, std::hypot(f.centroid[0], f.centroid[1]));
                const double coreR = 0.35 * maxR;
                std::vector<double> angs;
                for (const auto& f : inv2) {
                    const double r = std::hypot(f.centroid[0], f.centroid[1]);
                    if (r < coreR) continue;
                    double a = std::atan2(f.centroid[1], f.centroid[0]);
                    if (a < 0) a += 2.0 * 3.14159265358979323846;
                    angs.push_back(a);
                }
                // COUNT the repeated features, do not ask whether they are
                // symmetric — an asymmetric survivor set still has members.
                const int bestN = angularClusterCount(angs);
                got = static_cast<double>(bestN);
            } else if (key == "genus" || key == "shells" || key == "shellcount") {
                // Topology is 0.2 of the CADGenBench metric, and the failure it
                // catches is the one volume cannot: v18/205 measured 0.7% volume
                // error with genus 24 collapsed to 1. A tree that cannot ASSERT
                // its own genus cannot be trusted to have preserved it.
                forge::TopoSignature sig;
                if (!forge::topologySignature(body, sig))
                    throw OpError(op.id, "VERIFY: cannot measure topology of this body");
                got = static_cast<double>(key == "genus" ? sig.genus : sig.shellCount);
            } else if ((key.rfind("bbox.", 0) == 0 && (key.size() == 6 || key.size() == 9)) ||
                       (key.size() == 2 && (key[0] == '+' || key[0] == '-') &&
                        key[1] >= 'x' && key[1] <= 'z')) {
                // EXTENT *or* POSITION. An edit says "move this face to z = 40"; the
                // vocabulary only had extents, so the whole class was inexpressible
                // and the planner improvised — measured on the edit benchmark, 4 of
                // 16 non-compiling emissions asked for a position (`+Z=56851.058`,
                // `bbox.z @ -33100.0`). That is the IR missing a concept the task
                // requires, not the planner being wrong.
                //
                //   bbox.z                    the EXTENT along z   (unchanged)
                //   bbox.zmin / bbox.zmax     the extreme COORDINATE
                //   -z / +z                   aliases for zmin / zmax
                int ax;
                enum { Extent, Min, Max } want_ = Extent;
                if (key[0] == '+' || key[0] == '-') {
                    ax = key[1] - 'x';
                    want_ = (key[0] == '+') ? Max : Min;
                } else {
                    ax = key[5] - 'x';
                    if (key.size() == 9) {
                        const std::string suf = key.substr(6);
                        if (suf == "min") want_ = Min;
                        else if (suf == "max") want_ = Max;
                        else throw OpError(op.id, "VERIFY: bad bbox suffix in `" + expr +
                                                  "` (use bbox.zmin / bbox.zmax)");
                    }
                }
                if (ax < 0 || ax > 2) throw OpError(op.id, "VERIFY: bad bbox axis in `" + expr + "`");
                Mesh m = forge::tessellate(body, 0.3, 0.6);
                double mn = 1e300, mx = -1e300;
                for (std::size_t k = 0; k + 2 < m.positions.size(); k += 3) {
                    double v = m.positions[k + ax];
                    mn = std::min(mn, v); mx = std::max(mx, v);
                }
                got = (want_ == Extent) ? (mx - mn) : (want_ == Min ? mn : mx);
            } else {
                // Name the vocabulary. This string is handed back to the planner as
                // its repair instruction, and "unknown quantity" alone tells it that
                // it failed without telling it what it may say instead.
                throw OpError(op.id, "VERIFY: unknown quantity `" + key + "` in `" + expr +
                                     "` — known: volume, faces/faceCount, edges/edgeCount, "
                                     "holes/bores, genus, shells, blades, bbox.x|y|z (extent), "
                                     "bbox.xmin|xmax|... and +x|-x|+y|-y|+z|-z (position)");
            }

            const double tol = std::max(1e-6, 1e-3 * std::fabs(want));
            bool pass = false;
            if (cmp == "=")       pass = std::fabs(got - want) <= tol;
            else if (cmp == "<=") pass = got <= want + tol;
            else if (cmp == ">=") pass = got >= want - tol;
            else if (cmp == "<")  pass = got < want;
            else if (cmp == ">")  pass = got > want;

            std::ostringstream note;
            note << (pass ? "PASS " : "FAIL ") << expr << " (got " << got << ")";
            if (res) res->verify.push_back(note.str());
            if (!pass) {
                // A false self-assertion is still a HARD FAILURE — ok=false is set at
                // the end of compilation, and nothing that fails here can pass a gate
                // or reach the self-distillation corpus.
                //
                // But it no longer ABORTS. Throwing here abandoned the rest of the
                // tree, so the final solid was never built and never measured, and
                // the result was indistinguishable from a tree that would not parse.
                // Those are completely different failures: measured on the holdout,
                // ho61 built 77 ops and then mis-claimed its own faceCount by one
                // face — its geometry may have been entirely correct, and there was
                // no way to find out. VERIFY is pass-through, so continuing costs
                // nothing and buys the geometry.
                if (firstVerifyFail.empty())
                    firstVerifyFail = "op %" + std::to_string(op.id) + " (line " +
                                      std::to_string(op.srcLine) + "): VERIFY failed: " +
                                      expr + " (got " + std::to_string(got) + ")";
            }
        }
        return body;   // pass-through: VERIFY asserts, it does not modify
    }

public:
    std::string    inputStep;        // backs INPUT()
    CompileResult* res = nullptr;    // VERIFY writes its per-assertion log here
    // How a surface builder hands its DIAGNOSIS back to the walker, which stores
    // it on the Val. A degenerate sheet is only representable if it is also
    // answerable; these two fields are that answer travelling one step.
    // Reset by compile() before every build() call.
    std::string    pendingNote;
    int            pendingFaces = -1;
    // The FIRST failed assertion, kept so compilation can finish and still fail
    // loudly at the end. Empty means every assertion the tree made was true.
    std::string firstVerifyFail;


private:
};

}  // namespace

// The op progress hook. thread_local so a batch tool compiling on several
// threads gets one hook per thread instead of a race; nullptr by default, which
// is the whole cost of it for every caller that does not install one.
namespace {
thread_local CompileProgressHook g_progressHook = nullptr;
thread_local void*               g_progressUser = nullptr;
}  // namespace

void setCompileProgressHook(CompileProgressHook hook, void* user) {
    g_progressHook = hook;
    g_progressUser = user;
}

CompileResult compile(const FeatureTree& ft, const std::string& inputStepPath) {
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

    // s0.4 count table, carried through the compile half. declared/parsed come
    // from the parser's census; compiled is counted below, op by op.
    out.nDeclared = ft.counts.declared;
    out.nParsed   = ft.ops.size();
    out.nCompiled = 0;

    // Each tree is an independent body and gets its own boolean hang-guard
    // budget. Without this, a batch run shares one process-global window and
    // healthy trees start failing once earlier trees have spent it.
    forge::resetBooleanBudget();

    std::unordered_map<int, Val> env;
    Builder builder;
    builder.inputStep = inputStepPath;   // backs INPUT() for edit trees
    builder.res = &out;                  // VERIFY records each assertion here
    Handle lastSolid = 0;
    int    lastSolidId = -1;   // the op id behind lastSolid: the root the s0.4
                               // gate must measure reachability from when the
                               // tree has no explicit RESULT(%id).

    for (const auto& op : ft.ops) {
        // ANNOUNCE BEFORE BUILDING. The order is the entire point: an op that
        // kills the process must already have been named, because after the
        // signal there is nothing left to ask.
        if (g_progressHook != nullptr) {
            g_progressHook(op.id, op.name.c_str(), op.srcLine, g_progressUser);
        }
        if (env.count(op.id)) {
            out.error = "duplicate id %" + std::to_string(op.id) +
                        " (line " + std::to_string(op.srcLine) + ")";
            out.failedOpId = op.id;
            return out;
        }
        Handle h;
        builder.lastEntity = 0;   // reset before every build; see Builder::lastEntity
        builder.pendingNote.clear();
        builder.pendingFaces = -1;
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
        v.entity = builder.lastEntity;   // meaningful only for kind == SketchRef
        v.note = builder.pendingNote;
        v.faces = builder.pendingFaces;
        env[op.id] = v;
        if (v.kind == Val::Solid) { lastSolid = h; lastSolidId = op.id; }
        ++out.nCompiled;
    }

    // ------------------------------------------- s0.4 CARDINALITY RECONCILE
    // "N_parsed_semantic_features == N_compiled_semantic_features". Every op is
    // walked above and an op that fails returns early, so a mismatch here means
    // the walk itself lost one. It is checked rather than assumed because the
    // failure mode it guards — a declared feature that never reached the solid —
    // is invisible in the geometry: the part just comes out missing a feature.
    // nDeclared is 0 for a tree built in memory rather than parsed from text;
    // only compare it when the parser actually filled the census.
    if (out.nCompiled != out.nParsed ||
        (ft.counts.parsed != 0 && out.nDeclared != out.nParsed)) {
        out.error = "s0.4 cardinality mismatch: declared=" + std::to_string(out.nDeclared) +
                    " parsed=" + std::to_string(out.nParsed) +
                    " compiled=" + std::to_string(out.nCompiled);
        return out;
    }

    // choose result
    Handle result = 0;
    if (ft.resultId >= 0) {
        auto it = env.find(ft.resultId);
        if (it == env.end() || it->second.kind != Val::Solid) {
            // Name what it IS and, for a sheet, name the op that closes it. The
            // old message said only "is not a defined SOLID", which is the same
            // string for an undefined id and for a surface that needs one more op.
            out.error = "RESULT %" + std::to_string(ft.resultId) + " is not a defined SOLID";
            if (it != env.end()) {
                out.error += " (it is a " + std::string(kindName(it->second.kind)) + ")";
                if (it->second.kind == Val::Surface)
                    out.error += " — close it with THICKEN(%" + std::to_string(ft.resultId) +
                                 ", wall) or CAP(%" + std::to_string(ft.resultId) + ")";
            }
            out.failedOpId = ft.resultId;
            return out;
        }
        result = it->second.h;
    } else {
        result = lastSolid;
    }
    if (result == 0) {
        // Say which kinds the tree DID produce. "yields only profiles?" was a guess
        // and it is now wrong more often than right: a surfacing tree that forgot
        // its THICKEN/CAP produces SURFACEs, and being told about profiles sends a
        // repair loop after the wrong thing.
        bool anyProfile = false, anyWire = false, anySurface = false;
        for (const auto& kv : env) {
            if (kv.second.kind == Val::Profile) anyProfile = true;
            else if (kv.second.kind == Val::Wire) anyWire = true;
            else if (kv.second.kind == Val::Surface) anySurface = true;
        }
        out.error = "no SOLID produced";
        if (anySurface)
            out.error += " — the tree ends in a SURFACE; close it with THICKEN(%N, wall) or CAP(%N)";
        else if (anyWire)
            out.error += " — the tree produced only WIRE sections; skin them with LOFT/SKIN";
        else if (anyProfile)
            out.error += " — the tree produced only PROFILEs; build them with EXTRUDE/REVOLVE";
        return out;
    }

    // -------------------------------------------- s0.4 GRAPH-QUALITY GATE
    // "The required values for unresolved references, unexplained orphans,
    // opaque placeholders, and unapproved failed nodes are zero." Opaque
    // placeholders are refused by the parser; the reachability half is refused
    // here, at the last point where the delivered root is known and before any
    // measurement is reported. An op that contributes nothing to the result is
    // either padding (Appendix B NOOP-PADDING) or a feature the author believed
    // was in the part and is not — and the second is why this cannot be a
    // warning: the geometry looks fine, it is just missing something.
    //
    // Nothing is stripped or rewritten: the graph is REJECTED with the exact
    // offending ids named, which is "without hiding required intent".
    {
        const int rootId = (ft.resultId >= 0) ? ft.resultId : lastSolidId;
        const GraphAudit ga = auditGraph(ft, rootId);
        if (!ga.clean()) {
            out.error = ga.report();
            if (!ga.unexplainedOrphans.empty())      out.failedOpId = ga.unexplainedOrphans.front();
            else if (!ga.duplicateIds.empty())       out.failedOpId = ga.duplicateIds.front();
            return out;
        }
    }

    out.handle = result;

    // measure
    try {
        auto rep = forge::heal::checkValidity(result);
        out.valid = rep.isClosed && rep.isManifold && rep.isOriented &&
                    !rep.hasSelfIntersect && rep.badFaces.empty() && rep.badEdges.empty();
    } catch (...) { out.valid = false; }

    // An invalid tree used to report only "not a valid watertight solid" — the
    // TERMINAL symptom, with no indication of which op caused it. That complaint is
    // fed straight back to the planner, so a whole repair round was spent guessing.
    //
    // The op that REPORTS the damage is routinely not the op that DID it: a tangent
    // FUSE emits a pinched, non-manifold body and a later MIRROR merely reflects it,
    // so the failure surfaces one op downstream of its cause. Every op's output is
    // still live in the registry, so the first bad one can be named without
    // rebuilding anything. Runs only on the failure path.
    if (!out.valid) {
        for (const auto& op : ft.ops) {
            auto it = env.find(op.id);
            if (it == env.end() || it->second.kind != Val::Solid || it->second.h == 0) continue;
            bool bad = false;
            std::string why;
            try {
                auto r = forge::heal::checkValidity(it->second.h);
                if (!r.isManifold)          { bad = true; why = "not manifold (surfaces meet at a point or line, not over an area)"; }
                else if (!r.isClosed)       { bad = true; why = "not closed"; }
                else if (!r.isOriented)     { bad = true; why = "not consistently oriented"; }
                else if (r.hasSelfIntersect){ bad = true; why = "self-intersecting"; }
                else if (!r.badEdges.empty()) { bad = true; why = "has " + std::to_string(r.badEdges.size()) + " bad edge(s)"; }
                else if (!r.badFaces.empty()) { bad = true; why = "has " + std::to_string(r.badFaces.size()) + " bad face(s)"; }
            } catch (...) { bad = true; why = "validity check threw"; }
            if (bad) {
                out.error = "first invalid solid is produced by op %" +
                            std::to_string(op.id) + " " + op.name + " (line " +
                            std::to_string(op.srcLine) + "): " + why;
                break;
            }
        }
    }
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

    // A tree that asserted something false about itself FAILS — but only after every
    // geometry field above has been filled in, so the caller can see BOTH that the
    // claim was wrong AND what was actually built. Those are separate facts and
    // collapsing them into one throw threw the more useful one away.
    if (!builder.firstVerifyFail.empty()) {
        out.ok = false;
        out.error = builder.firstVerifyFail;
        return out;
    }

    out.ok = true;
    return out;
}

CompileResult compileText(const std::string& text, const std::string& exportStepPath,
                          const std::string& inputStepPath) {
    CompileResult out;
    FeatureTree ft;
    try {
        ft = parse(text);
    } catch (const ParseError& e) {
        // The taxonomy is preserved in the reported error so a caller can tell a
        // rejected placeholder (s0.5) from a truncated emission (law 5) without
        // string-matching. Neither is ever reported as ok.
        const char* tag = "PARSE";
        switch (e.kind) {
            case ParseFailure::OpaquePlaceholder: tag = "REJECTED_PLACEHOLDER"; break;
            case ParseFailure::Cardinality:       tag = "CARDINALITY_MISMATCH"; break;
            case ParseFailure::Incomplete:        tag = "PAUSED_INCOMPLETE";    break;
            case ParseFailure::Syntax:            tag = "PARSE";                break;
        }
        out.error = std::string(tag) + ": " + e.what();
        out.nParsed = e.checkpoint.ops.size();
        out.nDeclared = e.checkpoint.counts.declared;
        return out;
    } catch (const std::exception& e) {
        out.error = e.what();
        return out;
    }
    out = compile(ft, inputStepPath);
    if (out.ok && !exportStepPath.empty()) {
        // A REQUESTED EXPORT THAT FAILS FAILS THE COMPILE. This used to leave
        // ok == true with a non-empty error and exported == false: a green
        // signal for a run that produced no file, and every caller that asks
        // for a STEP and reads `ok` was then told the artefact exists. The
        // solid itself is still reported (handle + measurement survive) so a
        // caller can tell "wrote no file" from "built no part" — that is the
        // same rule src/tools/forge_verify.cpp already prints by.
        bool wrote = false;
        try {
            wrote = forge::io::exportStep(out.handle, exportStepPath);
            if (!wrote) {
                out.error = "STEP export failed: forge::io::exportStep declined to write " +
                            exportStepPath;
            }
        } catch (const std::exception& e) {
            out.error = std::string("STEP export failed: ") + e.what();
        }
        out.exported = wrote;
        if (!wrote) out.ok = false;
    }
    return out;
}

}  // namespace ft
}  // namespace forge
