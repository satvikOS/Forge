// SPDX-License-Identifier: LGPL-2.1-or-later

// MODIFIED for libforge_expr (2026-09-15). The cases in sections A-D are ported
// from FreeCAD's own tests at commit 0a45a0a008d4af7a85601016c5ab31bd26c25b22 --
// tests/src/App/Expression.cpp, tests/src/App/ExpressionParser.cpp,
// tests/src/Base/Quantity.cpp and tests/src/Base/Unit.cpp -- rewritten without
// GoogleTest, the App document fixture, Qt (ExpressionTokenizer) or Python.
// Sections E-G are NEW: they pin the behaviours this library changed on purpose
// (see MODIFICATIONS.md), so a later re-sync from upstream that silently restores
// the old behaviour turns this test red.
//
// Runs against the SHARED library: it is linked with -lforge_expr, never with the
// library's object files, so what it proves is what a program linking the dylib gets.

#include <cmath>
#include <cstdio>
#include <map>
#include <string>
#include <vector>

#include "forge_expr/Evaluator.h"
#include "forge_expr/Expression.h"
#include "forge_expr/ExpressionParser.h"
#include "forge_expr/Quantity.h"
#include "forge_expr/Unit.h"

using namespace forge::expr;

namespace
{

int g_checks = 0;
int g_failed = 0;

void check(bool ok, const std::string& what)
{
    ++g_checks;
    if (!ok) {
        ++g_failed;
        std::printf("  FAIL  %s\n", what.c_str());
    }
}

class MapSymbols final: public SymbolTable
{
public:
    std::map<std::string, Value> values;
    bool lookup(const std::string& path, Value& out, std::string& why) const override
    {
        auto it = values.find(path);
        if (it == values.end()) {
            why = "no parameter named '" + path + "'";
            return false;
        }
        out = it->second;
        return true;
    }
};

Evaluation run(const std::string& text, const SymbolTable& symbols = EmptySymbolTable())
{
    return CompiledExpression::compile(text).evaluate(symbols);
}

bool near(double a, double b, double tol = 1e-9)
{
    return std::fabs(a - b) <= tol * std::max(1.0, std::fabs(b));
}

bool isQuantity(const Evaluation& e, double value, const Unit& unit)
{
    return e.ok && e.value.isNumber() && near(e.value.quantity().getValue(), value)
        && e.value.quantity().getUnit() == unit;
}

bool refusedMentioning(const Evaluation& e, const std::string& fragment)
{
    return !e.ok && e.error.find(fragment) != std::string::npos;
}

}  // namespace

int main()
{
    std::printf("[forge_expr] %s\n", libraryIdentity());

    // ── A. tokenizer (tests/src/App/Expression.cpp) ─────────────────────────
    {
        using namespace ExpressionParser;
        auto q = tokenize("0.00000 deg");
        check(q.size() == 2, "tokenize '0.00000 deg' gives two tokens");
        check(q.size() == 2 && q[0].kind == TokenKind::Number && q[0].column == 0 && q[0].text == "0.00000",
              "first token is the number at column 0");
        check(q.size() == 2 && q[1].kind == TokenKind::Unit && q[1].column == 8 && q[1].text == "deg",
              "second token is the unit at column 8");
        auto f = tokenize("sin(0.00000)");
        check(f.size() == 3 && f[0].kind == TokenKind::Function && f[0].text == "sin(", "function token");
        check(f.size() == 3 && f[2].column == 11 && f[2].text == ")", "closing paren column");
        check(tokenize("1").size() == 1 && tokenize("1")[0].kind == TokenKind::One, "tokenize ONE");
        check(tokenize("Something")[0].kind == TokenKind::Identifier, "tokenize identifier");
        check(tokenize("km")[0].kind == TokenKind::Unit, "tokenize unit");
        check(tokenize("\"")[0].kind == TokenKind::USUnit, "tokenize US unit");
        check(tokenize("123456")[0].kind == TokenKind::Integer, "tokenize integer");
        check(tokenize("pi")[0].kind == TokenKind::Constant, "tokenize pi");
        check(tokenize("e")[0].kind == TokenKind::Constant, "tokenize e");
        check(tokenize("True False true false None").size() == 5, "tokenize five constants");
        check(tokenize("==")[0].kind == TokenKind::Equal, "tokenize ==");
        check(tokenize("!=")[0].kind == TokenKind::NotEqual, "tokenize !=");
        check(tokenize("<=")[0].kind == TokenKind::LessEqual, "tokenize <=");
        check(tokenize(">=")[0].kind == TokenKind::GreaterEqual, "tokenize >=");
        auto m = tokenize("1-1");
        check(m.size() == 3 && m[1].kind == TokenKind::Minus && m[1].column == 1, "tokenize minus");
        check(tokenize("$A$12")[0].kind == TokenKind::CellAddress, "tokenize $A$12");
        check(tokenize("<<Test>>")[0].kind == TokenKind::String, "tokenize string");
    }

    // ── B. constants and identifiers (tests/src/App/ExpressionParser.cpp) ────
    {
        using namespace ExpressionParser;
        for (const char* c : {"pi", "e", "True", "False", "true", "false", "None"}) {
            check(isTokenAConstant(c), std::string(c) + " is a constant");
        }
        for (const char* c : {"PI", "E", "TRUE", "FALSE", "NONE", "none"}) {
            check(!isTokenAConstant(c), std::string(c) + " is not a constant");
        }
        check(isTokenAUnit("mm") && isTokenAUnit("kg") && isTokenAUnit("deg"), "units are units");
        check(isTokenAnIndentifier("wall") && isTokenAnIndentifier("hole_d"), "names are identifiers");
        check(!isTokenAnIndentifier("mm") && !isTokenAnIndentifier("pi"), "a unit or constant is not an identifier");
    }

    // ── C. Quantity and Unit arithmetic (tests/src/Base/Quantity.cpp, Unit.cpp) ─
    {
        const Quantity q1(1.0, Unit::Length);
        const Quantity q2(1.0, Unit::Area);
        bool threw = false;
        try {
            (void)(q1 + q2);
        }
        catch (const UnitsMismatchError&) {
            threw = true;
        }
        check(threw, "Quantity + with different units throws UnitsMismatchError");
        check(q1 + q1 == Quantity(2, Unit::Length), "1 mm + 1 mm = 2 mm");
        check(q1 * Quantity(1.0, Unit::Area) == Quantity(1.0, Unit::Volume), "mm * mm^2 = mm^3");
        check(q1 / Quantity(1.0, Unit::Area) == Quantity(1.0, Unit::InverseLength), "mm / mm^2 = 1/mm");
        check(-q1 == Quantity(-1.0, Unit::Length), "negation");
        check(Quantity(2.0, Unit::Length).pow(2.0) == Quantity(4.0, Unit::Area), "(2 mm)^2 = 4 mm^2");
        threw = false;
        try {
            (void)Unit::Length.pow(1.5);
        }
        catch (const UnitsMismatchError&) {
            threw = true;
        }
        check(threw, "mm^1.5 is refused");
        check(Unit::Force.getTypeString() == "Force", "Force is named");
        check(Unit::Area.getString() == "mm^2", "Area spells mm^2");
        check(Unit::Stress.getString() == "kg/(mm*s^2)", "Stress spells kg/(mm*s^2)");
    }

    // ── D. parse, print and evaluate (tests/src/App/Expression.cpp, Evaluate) ─
    {
        auto e = Expression::parse("1 + 2");
        check(e->toString() == "1 + 2", "prints 1 + 2");
        check(e->eval(EmptySymbolTable())->toString() == "3", "evaluates to 3");
        check(e->simplify()->toString() == "3", "simplifies to 3");
        auto s = Expression::parse("sqrt(4)");
        check(s->eval(EmptySymbolTable())->toString() == "2", "sqrt(4) evaluates to 2");
        MapSymbols vars;
        vars.values["Var"] = Value(Quantity(2.0));
        auto v = Expression::parse("sqrt(2 + Var)");
        check(v->eval(vars)->toString() == "2", "sqrt(2 + Var) with Var = 2 is 2");
        check(v->simplify()->toString() == "sqrt(2 + Var)", "a variable does not simplify away");
        auto pr = Expression::parse("pi rad");
        check(pr->toString() == "pi rad", "prints pi rad");
        check(isQuantity(run("1 m + 2 mm"), 1002.0, Unit::Length), "1 m + 2 mm = 1002 mm");
        check(isQuantity(run("parsequant(<<3 m>>)"), 3000.0, Unit::Length), "parsequant of a text");
        check(isQuantity(run("parsequant(str(1 m + 2 mm))"), 1002.0, Unit::Length), "parsequant of str()");
        check(isQuantity(run("10 kg + 20010 g"), 30.01, Unit::Mass), "10 kg + 20010 g = 30.01 kg");
        check(isQuantity(run("1 in"), 25.4, Unit::Length), "1 in = 25.4 mm");
        check(isQuantity(run("5' 3\""), 5 * 304.8 + 3 * 25.4, Unit::Length), "5' 3\" is US building length");
        check(isQuantity(run("90 deg + 1 rad"), 90.0 + 180.0 / 3.141592653589793, Unit::Angle), "degrees and radians add");
        // Upstream precedence, kept: a unit binds tighter than '/', so this is pi / (2 rad).
        check(!run("30 deg + pi/2 rad").ok, "pi/2 rad is pi / (2 rad), an inverse angle, and does not add to degrees");
        check(isQuantity(run("2 N / mm^2"), 2000.0, Unit::Pressure), "N/mm^2 is a pressure");
        check(isQuantity(run("1 == 1 ? 7 mm : 9 mm"), 7.0, Unit::Length), "conditional");
        check(isQuantity(run("max(2 mm; 5 mm; 3 mm)"), 5.0, Unit::Length), "max aggregate");
        check(isQuantity(run("sum(1 mm, 2 mm)"), 3.0, Unit::Length), "sum aggregate");
        check(isQuantity(run("atan2(1 mm; 1 mm)"), 45.0, Unit::Angle), "atan2 is an angle");
        check(isQuantity(run("hypot(3 mm; 4 mm)"), 5.0, Unit::Length), "hypot keeps the unit");
        check(isQuantity(run("sqrt(16 mm^2)"), 4.0, Unit::Length), "sqrt of an area is a length");
        check(isQuantity(run("mod(7 mm; 3 mm)"), 1.0, Unit::Length), "mod with equal units");
        auto text = run("str(2 mm)");
        check(text.ok && text.value.isText() && text.value.text() == "2 mm", "str() is a text");
    }

    // ── E. THE ACCEPTANCE BEHAVIOUR THIS LIBRARY EXISTS FOR ──────────────────
    {
        MapSymbols p;
        p.values["wall"] = Value(Quantity(6.0, Unit::Length));
        auto hole = CompiledExpression::compile("wall * 0.5 + 2 mm");
        check(hole.ok(), "hole_d = wall * 0.5 + 2 mm compiles");
        check(hole.names() == std::set<std::string> {"wall"}, "and names exactly wall");
        check(isQuantity(hole.evaluate(p), 5.0, Unit::Length), "and is 5 mm when wall = 6 mm");
        p.values["wall"] = Value(Quantity(10.0, Unit::Length));
        check(isQuantity(hole.evaluate(p), 7.0, Unit::Length), "and 7 mm when wall = 10 mm");

        const Evaluation mismatch = run("3 mm + 2 kg");
        check(!mismatch.ok, "mm + kg is REFUSED");
        check(mismatch.error.find("Unit mismatch") != std::string::npos, "and the refusal says unit mismatch: " + mismatch.error);

        MapSymbols bad;
        bad.values["mass"] = Value(Quantity(2.0, Unit::Mass));
        bad.values["len"] = Value(Quantity(2.0, Unit::Length));
        check(refusedMentioning(CompiledExpression::compile("len + mass").evaluate(bad), "Unit mismatch"),
              "a mismatch through names is refused too");
        check(refusedMentioning(run("nope * 2"), "nope"), "an unknown name is refused, naming it");
    }

    // ── F. refusals Forge ADDED (upstream produced a number) ─────────────────
    {
        check(refusedMentioning(run("1 mm / 0"), "Division by zero"), "division by zero refuses");
        check(refusedMentioning(run("7 mm % 0 mm"), "zero"), "remainder by zero refuses");
        check(refusedMentioning(run("sqrt(-1)"), "finite"), "sqrt(-1) refuses: not a finite number");
        check(refusedMentioning(run("log(0)"), "finite"), "log(0) refuses: not a finite number");
        check(!run("10 mm % 3 kg").ok, "remainder between different units refuses (upstream: 1 mm)");
        check(isQuantity(run("(4 mm^2) ^ 0.5"), 2.0, Unit::Length), "the square root of an area is a length (upstream: dimensionless 2)");
        check(!run("(4 mm) ^ 0.5").ok, "a power that leaves a fractional unit exponent refuses");
        check(!run("pow(4 mm; 2.5)").ok, "pow(4 mm; 2.5) refuses (upstream: mm^2)");
        auto garbage = CompiledExpression::compile("2~");
        check(!garbage.ok() && garbage.error().find("unexpected character") != std::string::npos,
              "an unknown character is a parse error (upstream: echoed and skipped, parsed as 2): " + garbage.error());
        check(!CompiledExpression::compile("vector(1; 2; 3)").ok(), "a function Forge has no value kind for does not parse");
        check(!CompiledExpression::compile("href(a)").ok(), "hiddenref/href, which hid a dependency from cycle checks, does not parse");
        check(!CompiledExpression::compile("sin(1; 2)").ok(), "a wrong argument count is a parse error, not a crash");
        check(!CompiledExpression::compile("").ok(), "empty text refuses");
        check(!CompiledExpression::compile(std::string(3000, '1')).ok(), "over-long text refuses");
        check(!run("a[0]").ok, "indexing refuses");
        check(refusedMentioning(run("sum(A1:B2)"), "Cell ranges"), "cell ranges refuse");
        check(!run("None + 1").ok, "None refuses");
        std::string deep;
        for (int i = 0; i < 1500; ++i) deep += "(";
        deep += "1";
        for (int i = 0; i < 1500; ++i) deep += ")";
        check(!CompiledExpression::compile(deep).ok(), "absurdly deep nesting refuses rather than crashing");
    }

    // ── G. names ─────────────────────────────────────────────────────────────
    {
        check(isValidName("wall") && isValidName("hole_d") && isValidName("Width2"), "ordinary names are valid");
        check(!isValidName("mm") && !isValidName("h") && !isValidName("N"), "unit spellings are not names");
        check(!isValidName("pi") && !isValidName("True"), "constants are not names");
        check(!isValidName("sqrt"), "function names are not names");
        check(!isValidName("2x") && !isValidName("a b") && !isValidName("") && !isValidName("a@b"), "malformed names are not names");
        auto path = CompiledExpression::compile("Hole3.dia * 2");
        check(path.ok() && path.names() == std::set<std::string> {"Hole3.dia"}, "a dotted path is one name");
        Quantity unit;
        std::string why;
        check(parseUnitSpelling("N/mm^2", unit, why) && unit.getUnit() == Unit::Pressure, "unit spelling parses");
    }

    std::printf("[forge_expr] %d checks, %d failed\n", g_checks, g_failed);
    return g_failed == 0 ? 0 : 1;
}
