// SPDX-License-Identifier: LGPL-2.1-or-later

/***************************************************************************
 *   Copyright (c) 2015 Eivind Kvedalen <eivind@kvedalen.name>             *
 *                                                                         *
 *   This file is part of the FreeCAD CAx development system.              *
 *                                                                         *
 *   This library is free software; you can redistribute it and/or         *
 *   modify it under the terms of the GNU Library General Public           *
 *   License as published by the Free Software Foundation; either          *
 *   version 2 of the License, or (at your option) any later version.      *
 *                                                                         *
 *   This library  is distributed in the hope that it will be useful,      *
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of        *
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the         *
 *   GNU Library General Public License for more details.                  *
 *                                                                         *
 *   You should have received a copy of the GNU Library General Public     *
 *   License along with this library; see the file COPYING.LIB. If not,    *
 *   write to the Free Software Foundation, Inc., 59 Temple Place,         *
 *   Suite 330, Boston, MA  02111-1307, USA                                *
 *                                                                         *
 ***************************************************************************/

// MODIFIED for libforge_expr (2026-09-15) from FreeCAD src/App/Expression.cpp at
// commit 0a45a0a008d4af7a85601016c5ab31bd26c25b22. See MODIFICATIONS.md.
//
// The structure follows upstream function for function: the helpers, the
// Component, the Expression base class, each concrete class in upstream order,
// then the parser glue that includes Expression.tab.c and Expression.lex.c.
//
// WHAT IS DIFFERENT, AND WHY
//   * Evaluation. Upstream `_getPyValue()` produced a Python object and the
//     arithmetic ran in Python's number protocol through Base::QuantityPy. That
//     is replaced by `_getValue(const SymbolTable&)` returning forge::expr::Value
//     and by calc() below, which applies the same Quantity operators QuantityPy
//     applied -- unit mismatch in + and - still throws, and still says so.
//   * Where upstream was WRONG FOR A CAD USER, Forge refuses instead of producing
//     a number (each marked `Forge:` at the site):
//       - division and modulo by zero, which returned inf / raised a Python error;
//       - a result that is not a finite number (sqrt(-1), log(0), acos(2));
//       - `%` between different units, which upstream silently took the left unit;
//       - a non-integral power of a dimensioned quantity, which upstream truncated
//         to a dimensionless result (see Quantity.cpp);
//       - an unrecognised character, which upstream's lexer ECHOED and SKIPPED.
//   * Names are resolved through the caller's SymbolTable, not a document.
//   * Kinds Forge has no representation for -- vector, matrix, placement,
//     rotation, list, tuple, create, hiddenref/href, spreadsheet ranges and
//     indexing -- are not registered as functions (so they are a parse error
//     naming the function) or refuse to evaluate, naming the construct.
//   * The parser is guarded by a mutex: its state is file-static, as upstream's is.

#include <cerrno>
#include <cinttypes>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <numbers>
#include <sstream>
#include <stack>
#include <string>
#include <utility>
#include <vector>

#include "forge_expr/Expression.h"
#include "forge_expr/ExpressionParser.h"

using namespace forge::expr;

#define __EXPR_THROW(_e, _msg, _expr) \
    do { \
        std::ostringstream ss; \
        ss << _msg << (_expr); \
        throw _e(ss.str()); \
    } while (0)

#define _EXPR_THROW(_msg, _expr) __EXPR_THROW(ExpressionError, _msg, _expr)

#define EXPR_THROW(_msg) _EXPR_THROW(_msg, this)

#define ARGUMENT_MESSAGE(_msg) "Invalid number of arguments: " _msg

namespace
{

// Forge: upstream appended "\nin expression: <text>" to every message. The text
// is kept, on the same line, so a refusal shown in a panel still names what it
// refused.
struct ExpressionSuffix
{
    const Expression* expr;
};

inline std::ostream& operator<<(std::ostream& os, const ExpressionSuffix& suffix)
{
    if (suffix.expr) {
        os << " (in '";
        suffix.expr->toString(os);
        os << "')";
    }
    return os;
}

inline ExpressionSuffix in(const Expression* e)
{
    return ExpressionSuffix {e};
}

// Base::Precision::Confusion(), the tolerance upstream's asBool() used.
constexpr double kConfusion = 1e-7;

inline bool asBool(double value)
{
    return std::fabs(value) >= kConfusion;
}

// Forge: nesting deeper than this refuses instead of risking the stack. The
// parser's own stack is bounded by YYMAXDEPTH below; this bounds evaluation of a
// left-deep chain such as 1+1+1+...
constexpr int kMaxEvaluationDepth = 512;
thread_local int evaluationDepth = 0;

struct DepthGuard
{
    DepthGuard()
    {
        if (++evaluationDepth > kMaxEvaluationDepth) {
            --evaluationDepth;
            throw ExpressionError("Expression is nested too deeply to evaluate");
        }
    }
    ~DepthGuard()
    {
        --evaluationDepth;
    }
    DepthGuard(const DepthGuard&) = delete;
    DepthGuard& operator=(const DepthGuard&) = delete;
};

template<class T>
void copy_vector(T& dst, const T& src)
{
    dst.clear();
    dst.reserve(src.size());
    for (auto& s : src) {
        if (s) {
            dst.push_back(s->copy());
        }
        else {
            dst.emplace_back();
        }
    }
}

}  // namespace

std::string unquote(const std::string& input)
{
    if (input.size() < 4) {
        return std::string();
    }

    std::string output;
    std::string::const_iterator cur = input.begin() + 2;
    std::string::const_iterator end = input.end() - 2;

    output.reserve(input.size());

    bool escaped = false;
    while (cur != end) {
        if (escaped) {
            switch (*cur) {
                case 't':
                    output += '\t';
                    break;
                case 'n':
                    output += '\n';
                    break;
                case 'r':
                    output += '\r';
                    break;
                case '\\':
                    output += '\\';
                    break;
                case '\'':
                    output += '\'';
                    break;
                case '"':
                    output += '"';
                    break;
            }
            escaped = false;
        }
        else {
            if (*cur == '\\') {
                escaped = true;
            }
            else {
                output += *cur;
            }
        }
        ++cur;
    }

    return output;
}

// From FreeCAD src/App/ObjectIdentifier.cpp, App::quote() (toPython = false).
static std::string quote(const std::string& input)
{
    std::stringstream output;

    output << "<<";
    for (char c : input) {
        switch (c) {
            case '\t':
                output << "\\t";
                break;
            case '\n':
                output << "\\n";
                break;
            case '\r':
                output << "\\r";
                break;
            case '\\':
                output << "\\\\";
                break;
            case '\'':
                output << "\\'";
                break;
            case '"':
                output << "\\\"";
                break;
            case '>':
                output << "\\>";
                break;
            default:
                output << c;
        }
    }
    output << ">>";

    return output.str();
}

// A quoted element of a dotted path, spelled the way it was typed.
static std::string quotePathString(const std::string& text)
{
    return quote(text);
}

/////////////////////////////////////////////////////////////////////////////////////
// Helper functions

/* The following definitions are from The art of computer programming by Knuth
 * (copied from http://stackoverflow.com/questions/17333/most-effective-way-for-float-and-double-comparison)
 */

template<class T>
static inline bool essentiallyEqual(T a, T b)
{
    static const T _epsilon = std::numeric_limits<T>::epsilon();
    return std::fabs(a - b) <= ((std::fabs(a) > std::fabs(b) ? std::fabs(b) : std::fabs(a)) * _epsilon);
}

static inline bool essentiallyInteger(double a, long& l)
{
    double intpart;
    if (std::modf(a, &intpart) == 0.0) {
        if (intpart < 0.0) {
            if (intpart >= static_cast<double>(std::numeric_limits<long>::min())) {
                l = static_cast<long>(intpart);
                return true;
            }
        }
        else if (intpart <= static_cast<double>(std::numeric_limits<long>::max())) {
            l = static_cast<long>(intpart);
            return true;
        }
    }
    return false;
}

// Forge: every numeric result leaves evaluation through here. A NaN or an infinity
// is not a dimension; it is the absence of one, and reporting it as a value is the
// wrong-result-reported-as-success this library exists to prevent.
static Value finiteQuantity(const Quantity& q, const Expression* expr)
{
    if (!std::isfinite(q.getValue())) {
        _EXPR_THROW("The result is not a finite number", in(expr));
    }
    return Value(q);
}

static const Quantity& numberOf(const Value& value, const Expression* expr, const char* what)
{
    if (!value.isNumber()) {
        _EXPR_THROW(what << ": expected a number, got the text " << quote(value.text()), in(expr));
    }
    return value.quantity();
}

////////////////////////////////////////////////////////////////////////////////////
//
// Value and SymbolTable (NEW, Forge)
//

Value::Value()
    : _kind(Kind::Number)
{}

Value::Value(const Quantity& quantity)
    : _kind(Kind::Number)
    , _quantity(quantity)
{}

Value::Value(std::string text)
    : _kind(Kind::Text)
    , _text(std::move(text))
{}

const Quantity& Value::quantity() const
{
    if (_kind != Kind::Number) {
        throw TypeError("Value is a text, not a number");
    }
    return _quantity;
}

const std::string& Value::text() const
{
    if (_kind != Kind::Text) {
        throw TypeError("Value is a number, not a text");
    }
    return _text;
}

std::string Value::toString() const
{
    return _kind == Kind::Text ? _text : _quantity.toString();
}

SymbolTable::~SymbolTable() = default;

bool EmptySymbolTable::lookup(const std::string& path, Value& out, std::string& why) const
{
    (void)out;
    why = "Unknown name '" + path + "'";
    return false;
}

////////////////////////////////////////////////////////////////////////////////////
//
// Expression::Component
//

Expression::Component::Component(const std::string& n)
    : name(n)
{}

Expression::Component::Component(Expression* _e1, Expression* _e2, Expression* _e3, bool _isRange)
    : e1(_e1)
    , e2(_e2)
    , e3(_e3)
    , isRange(_isRange)
{}

Expression::Component::Component(const Component& other)
    : name(other.name)
    , e1(other.e1 ? other.e1->copy() : nullptr)
    , e2(other.e2 ? other.e2->copy() : nullptr)
    , e3(other.e3 ? other.e3->copy() : nullptr)
    , isRange(other.isRange)
{}

Expression::Component::~Component() = default;

Expression::Component* Expression::Component::copy() const
{
    return new Component(*this);
}

void Expression::Component::visit(ExpressionVisitor& v)
{
    if (e1) {
        e1->visit(v);
    }
    if (e2) {
        e2->visit(v);
    }
    if (e3) {
        e3->visit(v);
    }
}

void Expression::Component::toString(std::ostream& ss, bool persistent) const
{
    if (!e1 && !e2 && !e3) {
        ss << '.' << name;
        return;
    }
    ss << '[';
    if (e1) {
        e1->toString(ss, persistent);
    }
    if (e2 || isRange) {
        ss << ':';
    }
    if (e2) {
        e2->toString(ss, persistent);
    }
    if (e3) {
        ss << ':';
        e3->toString(ss, persistent);
    }
    ss << ']';
}

//
// Expression base-class
//

Expression::Expression() = default;

Expression::~Expression()
{
    for (auto c : components) {
        delete c;
    }
}

Expression::Component* Expression::createComponent(const std::string& n)
{
    return new Component(n);
}

Expression::Component* Expression::createComponent(Expression* e1, Expression* e2, Expression* e3, bool isRange)
{
    return new Component(e1, e2, e3, isRange);
}

int Expression::priority() const
{
    return 20;
}

ExpressionPtr Expression::parse(const std::string& buffer)
{
    return ExpressionParser::parse(buffer.c_str());
}

namespace
{
class GetIdentifiersExpressionVisitor: public ExpressionVisitor
{
public:
    explicit GetIdentifiersExpressionVisitor(std::set<std::string>& deps, void (*collect)(Expression&, std::set<std::string>&))
        : deps(deps)
        , collect(collect)
    {}

    void visit(Expression& e) override
    {
        collect(e, deps);
    }

    std::set<std::string>& deps;
    void (*collect)(Expression&, std::set<std::string>&);
};
}  // namespace

namespace forge::expr
{
// Upstream ExpressionVisitor::getIdentifiers(), a friend's access to the protected hook.
class IdentifierCollector
{
public:
    static void collect(Expression& e, std::set<std::string>& ids)
    {
        e._getIdentifiers(ids);
    }
};
}  // namespace forge::expr

void Expression::getIdentifiers(std::set<std::string>& deps) const
{
    GetIdentifiersExpressionVisitor v(deps, &IdentifierCollector::collect);
    const_cast<Expression*>(this)->visit(v);
}

std::set<std::string> Expression::getIdentifiers() const
{
    std::set<std::string> deps;
    getIdentifiers(deps);
    return deps;
}

Value Expression::getValue(const SymbolTable& symbols) const
{
    DepthGuard guard;
    if (!components.empty()) {
        // Forge: upstream applied each component to the Python value (a[0], a.x).
        // No Forge value has elements or members, so this is refused, named.
        _EXPR_THROW("Indexing and member access are not supported", in(this));
    }
    return _getValue(symbols);
}

void Expression::addComponent(Component* component)
{
    components.push_back(component);
}

void Expression::visit(ExpressionVisitor& v)
{
    _visit(v);
    for (auto& c : components) {
        c->visit(v);
    }
    v.visit(*this);
}

ExpressionPtr Expression::eval(const SymbolTable& symbols) const
{
    const Value value = getValue(symbols);
    if (value.isText()) {
        return std::make_unique<StringExpression>(value.text());
    }
    return std::make_unique<NumberExpression>(value.quantity());
}

bool Expression::isSame(const Expression& other, bool checkComment) const
{
    if (&other == this) {
        return true;
    }
    if (typeid(*this) != typeid(other)) {
        return false;
    }
    return (!checkComment || comment == other.comment) && toString(true, true) == other.toString(true, true);
}

std::string Expression::toString(bool persistent, bool checkPriority, int indent) const
{
    std::ostringstream ss;
    toString(ss, persistent, checkPriority, indent);
    return ss.str();
}

void Expression::toString(std::ostream& ss, bool persistent, bool checkPriority, int indent) const
{
    if (components.empty()) {
        bool needsParens = checkPriority && priority() < 20;
        if (needsParens) {
            ss << '(';
        }
        _toString(ss, persistent, indent);
        if (needsParens) {
            ss << ')';
        }
        return;
    }
    if (!_isIndexable()) {
        ss << '(';
        _toString(ss, persistent, indent);
        ss << ')';
    }
    else {
        _toString(ss, persistent, indent);
    }
    for (auto& c : components) {
        c->toString(ss, persistent);
    }
}

ExpressionPtr Expression::copy() const
{
    auto expr = std::unique_ptr<Expression>(_copy());
    copy_vector(expr->components, components);
    expr->comment = comment;
    return expr;
}


//
// UnitExpression class
//

UnitExpression::UnitExpression(const Quantity& _quantity, const std::string& _unitStr)
    : quantity(_quantity)
    , unitStr(_unitStr)
{}

UnitExpression::~UnitExpression() = default;

void UnitExpression::setQuantity(const Quantity& _quantity)
{
    quantity = _quantity;
}

void UnitExpression::setUnit(const Quantity& _quantity)
{
    quantity = _quantity;
}

ExpressionPtr UnitExpression::simplify() const
{
    return std::make_unique<NumberExpression>(quantity);
}

void UnitExpression::_toString(std::ostream& ss, bool, int) const
{
    ss << unitStr;
}

Expression* UnitExpression::_copy() const
{
    return new UnitExpression(quantity, unitStr);
}

Value UnitExpression::_getValue(const SymbolTable&) const
{
    return finiteQuantity(quantity, this);
}

//
// NumberExpression class
//

NumberExpression::NumberExpression(const Quantity& _quantity)
    : UnitExpression(_quantity)
{}

ExpressionPtr NumberExpression::simplify() const
{
    return copy();
}

Expression* NumberExpression::_copy() const
{
    return new NumberExpression(getQuantity());
}

void NumberExpression::negate()
{
    setQuantity(-getQuantity());
}

void NumberExpression::_toString(std::ostream& ss, bool, int) const
{
    // Restore the old implementation because using digits10 + 2 causes
    // undesired side-effects:
    // https://forum.freecad.org/viewtopic.php?f=3&t=44057&p=375882#p375882
    // See also:
    // https://en.cppreference.com/w/cpp/types/numeric_limits/digits10
    // https://en.cppreference.com/w/cpp/types/numeric_limits/max_digits10
    // https://www.boost.org/doc/libs/1_63_0/libs/multiprecision/doc/html/boost_multiprecision/tut/limits/constants.html
    //
    // Forge: boost::io::ios_flags_saver replaced by saving the precision by hand.
    const auto savedPrecision = ss.precision();
    ss << std::setprecision(std::numeric_limits<double>::digits10) << getValue();
    ss.precision(savedPrecision);
}

bool NumberExpression::isInteger(long* l) const
{
    long _l;
    if (!l) {
        l = &_l;
    }
    return essentiallyInteger(getValue(), *l);
}

//
// OperatorExpression class
//

OperatorExpression::OperatorExpression(Expression* _left, Operator _op, Expression* _right)
    : op(_op)
    , left(_left)
    , right(_right)
{}

OperatorExpression::~OperatorExpression()
{
    delete left;
    delete right;
}

// Forge: replaces upstream's calc(), which dispatched to Python's number protocol.
// The rules below are the Base::QuantityPy handlers those Python calls reached,
// applied to Quantity directly, with the refusals marked `Forge:`.
static Value calc(const Expression* expr, int op, const Expression* left, const Expression* right, const SymbolTable& symbols)
{
    const Value l = left->getValue(symbols);

    // check possible unary operation first
    switch (op) {
        case OperatorExpression::POS:
            return Value(numberOf(l, expr, "Unary +"));
        case OperatorExpression::NEG:
            return Value(-numberOf(l, expr, "Unary -"));
        default:
            break;
    }

    const Value r = right->getValue(symbols);

    // Text: upstream allowed + (concatenation) and == / != between two texts.
    if (l.isText() || r.isText()) {
        if (l.isText() && r.isText()) {
            switch (op) {
                case OperatorExpression::ADD:
                    return Value(l.text() + r.text());
                case OperatorExpression::EQ:
                    return Value(Quantity(l.text() == r.text() ? 1.0 : 0.0));
                case OperatorExpression::NEQ:
                    return Value(Quantity(l.text() != r.text() ? 1.0 : 0.0));
                default:
                    break;
            }
        }
        _EXPR_THROW("Unsupported operator for text", in(expr));
    }

    const Quantity& a = l.quantity();
    const Quantity& b = r.quantity();

    switch (op) {
        // Base::QuantityPy::richCompare: == and != compare value AND unit and never
        // throw; the orderings throw UnitsMismatchError when the units differ.
        case OperatorExpression::LT:
            return Value(Quantity(a < b ? 1.0 : 0.0));
        case OperatorExpression::LTE:
            return Value(Quantity((a < b) || (a == b) ? 1.0 : 0.0));
        case OperatorExpression::GT:
            return Value(Quantity(!(a < b) && !(a == b) ? 1.0 : 0.0));
        case OperatorExpression::GTE:
            return Value(Quantity(!(a < b) ? 1.0 : 0.0));
        case OperatorExpression::EQ:
            return Value(Quantity(a == b ? 1.0 : 0.0));
        case OperatorExpression::NEQ:
            return Value(Quantity(a != b ? 1.0 : 0.0));

        case OperatorExpression::ADD:
            return finiteQuantity(a + b, expr);
        case OperatorExpression::SUB:
            return finiteQuantity(a - b, expr);
        case OperatorExpression::MUL:
        case OperatorExpression::UNIT:
            return finiteQuantity(a * b, expr);
        case OperatorExpression::DIV:
            // Forge: upstream's C++ division produced inf for a zero divisor.
            if (b.getValue() == 0.0) {
                __EXPR_THROW(ZeroDivisionError, "Division by zero", in(expr));
            }
            return finiteQuantity(a / b, expr);
        case OperatorExpression::POW:
            // QuantityPy::number_power_handler -> Quantity::pow(const Quantity&),
            // which requires a dimensionless exponent.
            return finiteQuantity(a.pow(b), expr);
        case OperatorExpression::MOD: {
            // QuantityPy::number_remainder_handler took the left operand's unit and
            // IGNORED the right one's, so "10 mm % 3 kg" was 1 mm. Forge: the
            // divisor must be dimensionless or share the dividend's unit.
            if (!b.isDimensionless() && a.getUnit() != b.getUnit()) {
                __EXPR_THROW(
                    UnitsMismatchError,
                    "Units must be equal or the divisor dimensionless in a remainder",
                    in(expr)
                );
            }
            if (b.getValue() == 0.0) {
                __EXPR_THROW(ZeroDivisionError, "Remainder of a division by zero", in(expr));
            }
            // Python's float remainder: the sign of the result follows the divisor.
            double q = std::fmod(a.getValue(), b.getValue());
            if (q != 0.0 && ((q < 0.0) != (b.getValue() < 0.0))) {
                q += b.getValue();
            }
            return finiteQuantity(Quantity(q, a.getUnit()), expr);
        }
        default:
            __EXPR_THROW(RuntimeError, "Unsupported operator", in(expr));
    }
}

Value OperatorExpression::_getValue(const SymbolTable& symbols) const
{
    return calc(this, op, left, right, symbols);
}

ExpressionPtr OperatorExpression::simplify() const
{
    ExpressionPtr v1 = left->simplify();
    ExpressionPtr v2 = right->simplify();

    // Both arguments reduced to numerics? Then evaluate and return answer
    if (dynamic_cast<NumberExpression*>(v1.get()) && dynamic_cast<NumberExpression*>(v2.get())) {
        return eval(EmptySymbolTable());
    }
    else {
        return std::make_unique<OperatorExpression>(v1.release(), op, v2.release());
    }
}

void OperatorExpression::_toString(std::ostream& s, bool persistent, int) const
{
    bool needsParens;
    Operator leftOperator(NONE), rightOperator(NONE);

    needsParens = false;
    if (dynamic_cast<OperatorExpression*>(left)) {
        leftOperator = static_cast<OperatorExpression*>(left)->op;
    }
    if (left->priority() < priority()) {  // Check on operator priority first
        needsParens = true;
    }
    else if (leftOperator == op) {  // Same operator ?
        if (!isLeftAssociative()) {
            needsParens = true;
        }
        // else if (!isCommutative())
        //    needsParens = true;
    }

    switch (op) {
        case NEG:
            s << "-" << (needsParens ? "(" : "") << left->toString(persistent) << (needsParens ? ")" : "");
            return;
        case POS:
            s << "+" << (needsParens ? "(" : "") << left->toString(persistent) << (needsParens ? ")" : "");
            return;
        default:
            break;
    }

    if (needsParens) {
        s << "(" << left->toString(persistent) << ")";
    }
    else {
        s << left->toString(persistent);
    }

    switch (op) {
        case ADD:
            s << " + ";
            break;
        case SUB:
            s << " - ";
            break;
        case MUL:
            s << " * ";
            break;
        case DIV:
            s << " / ";
            break;
        case MOD:
            s << " % ";
            break;
        case POW:
            s << " ^ ";
            break;
        case EQ:
            s << " == ";
            break;
        case NEQ:
            s << " != ";
            break;
        case LT:
            s << " < ";
            break;
        case GT:
            s << " > ";
            break;
        case LTE:
            s << " <= ";
            break;
        case GTE:
            s << " >= ";
            break;
        case UNIT:
            s << " ";
            break;
        default:
            // Forge: upstream asserted; an unprintable operator is printed as a gap
            // rather than aborting the process in a release build.
            s << " ? ";
            break;
    }

    needsParens = false;
    if (dynamic_cast<OperatorExpression*>(right)) {
        rightOperator = static_cast<OperatorExpression*>(right)->op;
    }
    if (right->priority() < priority()) {  // Check on operator priority first
        needsParens = true;
    }
    else if (rightOperator == op) {  // Same operator ?
        if (!isRightAssociative()) {
            needsParens = true;
        }
        else if (!isCommutative()) {
            needsParens = true;
        }
    }
    else if (right->priority() == priority()) {  // Same priority ?
        if (!isRightAssociative() || rightOperator == MOD) {
            needsParens = true;
        }
    }

    if (needsParens) {
        s << "(";
        right->toString(s, persistent);
        s << ")";
    }
    else {
        right->toString(s, persistent);
    }
}

Expression* OperatorExpression::_copy() const
{
    return new OperatorExpression(left->copy().release(), op, right->copy().release());
}

int OperatorExpression::priority() const
{
    switch (op) {
        case EQ:
        case NEQ:
        case LT:
        case GT:
        case LTE:
        case GTE:
            return 1;
        case ADD:
        case SUB:
            return 3;
        case MUL:
        case DIV:
        case MOD:
            return 4;
        case POW:
            return 5;
        case UNIT:
        case NEG:
        case POS:
            return 6;
        default:
            return 0;
    }
}

void OperatorExpression::_visit(ExpressionVisitor& v)
{
    if (left) {
        left->visit(v);
    }
    if (right) {
        right->visit(v);
    }
}

bool OperatorExpression::isCommutative() const
{
    switch (op) {
        case EQ:
        case NEQ:
        case ADD:
        case MUL:
            return true;
        default:
            return false;
    }
}

bool OperatorExpression::isLeftAssociative() const
{
    return true;
}

bool OperatorExpression::isRightAssociative() const
{
    switch (op) {
        case ADD:
        case MUL:
            return true;
        default:
            return false;
    }
}

//
// FunctionExpression class. This class handles functions with one or two parameters.
//

FunctionExpression::FunctionExpression(Function _f, std::string&& name, std::vector<Expression*> _args)
    : f(_f)
    , fname(std::move(name))
    , args(std::move(_args))
{
    // Forge: upstream THREW from this constructor, i.e. from inside the running
    // parser, which leaked the partial parse tree. The reason is recorded instead
    // and the grammar action turns it into YYERROR.
    switch (f) {
        case ABS:
        case ACOS:
        case ASIN:
        case ATAN:
        case CBRT:
        case CEIL:
        case COS:
        case COSH:
        case EXP:
        case FLOOR:
        case LOG:
        case LOG10:
        case ROUND:
        case SIN:
        case SINH:
        case SQRT:
        case STR:
        case PARSEQUANT:
        case TAN:
        case TANH:
        case TRUNC:
        case NOT:
            if (args.size() != 1) {
                _constructionError = ARGUMENT_MESSAGE("exactly one required.");
            }
            break;
        case ATAN2:
        case MOD:
        case POW:
            if (args.size() != 2) {
                _constructionError = ARGUMENT_MESSAGE("exactly two required.");
            }
            break;
        case CATH:
        case HYPOT:
            if (args.size() < 2 || args.size() > 3) {
                _constructionError = ARGUMENT_MESSAGE("exactly two, or three required.");
            }
            break;
        case AVERAGE:
        case COUNT:
        case MAX:
        case MIN:
        case STDDEV:
        case SUM:
        case AND:
        case OR:
            if (args.empty()) {
                _constructionError = ARGUMENT_MESSAGE("at least one required.");
            }
            break;
        case AGGREGATES:
        case LAST:
        case NONE:
        default:
            _constructionError = "Unknown function '" + fname + "'";
            break;
    }
}

FunctionExpression::~FunctionExpression()
{
    std::vector<Expression*>::iterator i = args.begin();

    while (i != args.end()) {
        delete *i;
        ++i;
    }
}

/* Various collectors for aggregate functions */

namespace
{

class Collector
{
public:
    Collector() = default;
    virtual ~Collector() = default;
    virtual void collect(Quantity value)
    {
        if (first) {
            q.setUnit(value.getUnit());
        }
    }
    virtual Quantity getQuantity() const
    {
        return q;
    }

protected:
    bool first {true};
    Quantity q;
};

class SumCollector: public Collector
{
public:
    SumCollector()
        : Collector()
    {}

    void collect(Quantity value) override
    {
        Collector::collect(value);
        q += value;
        first = false;
    }
};

class AverageCollector: public Collector
{
public:
    AverageCollector()
        : Collector()
    {}

    void collect(Quantity value) override
    {
        Collector::collect(value);
        q += value;
        ++n;
        first = false;
    }

    Quantity getQuantity() const override
    {
        return q / (double)n;
    }

private:
    unsigned int n {0};
};

class StdDevCollector: public Collector
{
public:
    StdDevCollector()
        : Collector()
    {}

    void collect(Quantity value) override
    {
        Collector::collect(value);
        if (first) {
            M2 = Quantity(0, value.getUnit() * value.getUnit());
            mean = Quantity(0, value.getUnit());
            n = 0;
        }

        const Quantity delta = value - mean;
        ++n;
        mean = mean + delta / n;
        M2 = M2 + delta * (value - mean);
        first = false;
    }

    Quantity getQuantity() const override
    {
        if (n < 2) {
            throw ExpressionError("Invalid number of entries: at least two required.");
        }
        else {
            return Quantity((M2 / (n - 1.0)).pow(Quantity(0.5)).getValue(), mean.getUnit());
        }
    }

private:
    unsigned int n {0};
    Quantity mean;
    Quantity M2;
};

class CountCollector: public Collector
{
public:
    CountCollector()
        : Collector()
    {}

    void collect(Quantity value) override
    {
        Collector::collect(value);
        ++n;
        first = false;
    }

    Quantity getQuantity() const override
    {
        return Quantity(n);
    }

private:
    unsigned int n {0};
};

class MinCollector: public Collector
{
public:
    MinCollector()
        : Collector()
    {}

    void collect(Quantity value) override
    {
        Collector::collect(value);
        if (first || value < q) {
            q = value;
        }
        first = false;
    }
};

class MaxCollector: public Collector
{
public:
    MaxCollector()
        : Collector()
    {}

    void collect(Quantity value) override
    {
        Collector::collect(value);
        if (first || value > q) {
            q = value;
        }
        first = false;
    }
};

class AndCollector: public Collector
{
public:
    void collect(Quantity value) override
    {
        if (first) {
            q = Quantity(asBool(value.getValue()) ? 1 : 0);
            first = false;
            return;
        }
        if (!asBool(value.getValue())) {
            q = Quantity(0);
        }
    }
};

class OrCollector: public Collector
{
public:
    void collect(Quantity value) override
    {
        if (first) {
            q = Quantity(asBool(value.getValue()) ? 1 : 0);
            first = false;
            return;
        }
        if (asBool(value.getValue())) {
            q = Quantity(1);
        }
    }
};

}  // namespace

Value FunctionExpression::evalAggregate(
    const Expression* owner,
    int f,
    const std::vector<Expression*>& args,
    const SymbolTable& symbols
)
{
    std::unique_ptr<Collector> c;

    switch (f) {
        case SUM:
            c = std::make_unique<SumCollector>();
            break;
        case AVERAGE:
            c = std::make_unique<AverageCollector>();
            break;
        case STDDEV:
            c = std::make_unique<StdDevCollector>();
            break;
        case COUNT:
            c = std::make_unique<CountCollector>();
            break;
        case MIN:
            c = std::make_unique<MinCollector>();
            break;
        case MAX:
            c = std::make_unique<MaxCollector>();
            break;
        case AND:
            c = std::make_unique<AndCollector>();
            break;
        case OR:
            c = std::make_unique<OrCollector>();
            break;
        default:
            _EXPR_THROW("Unknown aggregate function", in(owner));
    }

    for (auto& arg : args) {
        // Forge: upstream expanded a RangeExpression over spreadsheet cells here.
        // A range refuses to evaluate (RangeExpression::_getValue), naming itself.
        const Value v = arg->getValue(symbols);
        c->collect(numberOf(v, owner, "Aggregate argument"));
    }

    return finiteQuantity(c->getQuantity(), owner);
}

Value FunctionExpression::evaluate(const Expression* expr, int f, const std::vector<Expression*>& args, const SymbolTable& symbols)
{
    using std::numbers::pi;

    // Handle aggregate functions
    if (f > AGGREGATES) {
        return evalAggregate(expr, f, args, symbols);
    }

    if (args.empty()) {
        _EXPR_THROW("Function requires at least one argument.", in(expr));
    }

    switch (f) {
        case STR:
            return Value(args[0]->getValue(symbols).toString());
        case PARSEQUANT: {
            // Upstream parsed the text with the separate Quantity grammar
            // (Quantity.y), which is not part of this library. Forge parses it with
            // this expression grammar and evaluates it with no names in scope: every
            // "<number> <unit>" spelling reads the same, but a parenthesised value
            // before a unit -- "(1 + 2) m" -- does not parse here and is refused.
            const Value text = args[0]->getValue(symbols);
            if (!text.isText()) {
                return finiteQuantity(text.quantity(), expr);
            }
            ExpressionPtr parsed = ExpressionParser::parse(text.text().c_str());
            return Value(numberOf(parsed->getValue(EmptySymbolTable()), expr, "parsequant()"));
        }
        default:
            break;
    }

    const Value e1 = args[0]->getValue(symbols);
    Quantity v1 = numberOf(e1, expr, "Invalid first argument.");
    Quantity v2;
    bool haveV2 = false;
    if (args.size() > 1) {
        v2 = numberOf(args[1]->getValue(symbols), expr, "Invalid second argument.");
        haveV2 = true;
    }
    Quantity v3;
    bool haveV3 = false;
    if (args.size() > 2) {
        v3 = numberOf(args[2]->getValue(symbols), expr, "Invalid third argument.");
        haveV3 = true;
    }

    double output;
    Unit unit;
    double scaler = 1;

    double value = v1.getValue();

    /* Check units and arguments */
    switch (f) {
        case COS:
        case SIN:
        case TAN:
            if (!(v1.isDimensionlessOrUnit(Unit::Angle))) {
                _EXPR_THROW("Unit must be either empty or an angle.", in(expr));
            }

            // Convert value to radians
            value = value * pi / 180.0;
            unit = Unit();
            break;
        case ACOS:
        case ASIN:
        case ATAN:
            if (!v1.isDimensionless()) {
                _EXPR_THROW("Unit must be empty.", in(expr));
            }
            unit = Unit::Angle;
            scaler = 180.0 / pi;
            break;
        case EXP:
        case LOG:
        case LOG10:
        case SINH:
        case TANH:
        case COSH:
            if (!v1.isDimensionless()) {
                _EXPR_THROW("Unit must be empty.", in(expr));
            }
            unit = Unit();
            break;
        case ROUND:
        case TRUNC:
        case CEIL:
        case FLOOR:
        case ABS:
            unit = v1.getUnit();
            break;
        case SQRT:
            unit = v1.getUnit().sqrt();
            break;
        case CBRT:
            unit = v1.getUnit().cbrt();
            break;
        case ATAN2:
            if (!haveV2) {
                _EXPR_THROW("Invalid second argument.", in(expr));
            }

            if (v1.getUnit() != v2.getUnit()) {
                _EXPR_THROW("Units must be equal.", in(expr));
            }
            unit = Unit::Angle;
            scaler = 180.0 / pi;
            break;
        case MOD:
            if (!haveV2) {
                _EXPR_THROW("Invalid second argument.", in(expr));
            }
            // Forge: upstream also accepted a dimensioned divisor under a
            // dimensionless dividend and returned a dimensionless result.
            if (!v2.isDimensionless() && v1.getUnit() != v2.getUnit()) {
                _EXPR_THROW("Units must be equal or dimensionless.", in(expr));
            }
            if (v2.getValue() == 0.0) {
                __EXPR_THROW(ZeroDivisionError, "Remainder of a division by zero", in(expr));
            }
            unit = v1.getUnit();
            break;
        case POW: {
            if (!haveV2) {
                _EXPR_THROW("Invalid second argument.", in(expr));
            }

            if (!v2.isDimensionless()) {
                _EXPR_THROW("Exponent is not allowed to have a unit.", in(expr));
            }

            // Compute new unit for exponentiation
            double exponent = v2.getValue();
            if (!v1.isDimensionless()) {
                // Forge: upstream tested `exponent - round(exponent) < 1e-9`, which
                // is true for every exponent BELOW an integer (2.5 - 3 < 1e-9), so
                // pow(4 mm; 2.5) was accepted and given the unit mm^2.
                if (std::fabs(exponent - std::round(exponent)) < 1e-9) {
                    unit = v1.getUnit().pow(std::round(exponent));
                }
                else {
                    _EXPR_THROW("Exponent must be an integer when used with a unit.", in(expr));
                }
            }
            break;
        }
        case HYPOT:
        case CATH:
            if (!haveV2) {
                _EXPR_THROW("Invalid second argument.", in(expr));
            }
            if (v1.getUnit() != v2.getUnit()) {
                _EXPR_THROW("Units must be equal.", in(expr));
            }

            if (args.size() > 2) {
                if (!haveV3) {
                    _EXPR_THROW("Invalid second argument.", in(expr));
                }
                if (v2.getUnit() != v3.getUnit()) {
                    _EXPR_THROW("Units must be equal.", in(expr));
                }
            }
            unit = v1.getUnit();
            break;
        case NOT:
            unit = Unit();
            break;
        default:
            _EXPR_THROW("Unknown function: " << f, in(nullptr));
    }

    /* Compute result */
    switch (f) {
        case ACOS:
            output = std::acos(value);
            break;
        case ASIN:
            output = std::asin(value);
            break;
        case ATAN:
            output = std::atan(value);
            break;
        case ABS:
            output = std::fabs(value);
            break;
        case EXP:
            output = std::exp(value);
            break;
        case LOG:
            output = std::log(value);
            break;
        case LOG10:
            output = std::log(value) / std::log(10.0);
            break;
        case SIN:
            output = std::sin(value);
            break;
        case SINH:
            output = std::sinh(value);
            break;
        case TAN:
            output = std::tan(value);
            break;
        case TANH:
            output = std::tanh(value);
            break;
        case SQRT:
            output = std::sqrt(value);
            break;
        case CBRT:
            output = std::cbrt(value);
            break;
        case COS:
            output = std::cos(value);
            break;
        case COSH:
            output = std::cosh(value);
            break;
        case MOD: {
            output = std::fmod(value, v2.getValue());
            break;
        }
        case ATAN2: {
            output = std::atan2(value, v2.getValue());
            break;
        }
        case POW: {
            output = std::pow(value, v2.getValue());
            break;
        }
        case HYPOT: {
            output = std::sqrt(std::pow(v1.getValue(), 2) + std::pow(v2.getValue(), 2) + (haveV3 ? std::pow(v3.getValue(), 2) : 0));
            break;
        }
        case CATH: {
            output = std::sqrt(std::pow(v1.getValue(), 2) - std::pow(v2.getValue(), 2) - (haveV3 ? std::pow(v3.getValue(), 2) : 0));
            break;
        }
        case ROUND:
            output = std::round(value);
            break;
        case TRUNC:
            output = std::trunc(value);
            break;
        case CEIL:
            output = std::ceil(value);
            break;
        case FLOOR:
            output = std::floor(value);
            break;
        case NOT:
            output = asBool(value) ? 0 : 1;
            break;
        default:
            _EXPR_THROW("Unknown function: " << f, in(nullptr));
    }

    return finiteQuantity(Quantity(scaler * output, unit), expr);
}

Value FunctionExpression::_getValue(const SymbolTable& symbols) const
{
    return evaluate(this, f, args, symbols);
}

ExpressionPtr FunctionExpression::simplify() const
{
    size_t numerics = 0;
    std::vector<Expression*> simplifiedArgs;

    // Try to simplify each argument to function
    for (auto it : args) {
        ExpressionPtr v = it->simplify();

        if (dynamic_cast<NumberExpression*>(v.get())) {
            ++numerics;
        }
        simplifiedArgs.push_back(v.release());
    }

    if (numerics == args.size()) {
        // All constants, then evaluation must also be constant

        // Clean-up the simplified arguments
        for (auto it : simplifiedArgs) {
            delete it;
        }

        return eval(EmptySymbolTable());
    }
    else {
        return std::make_unique<FunctionExpression>(f, std::string(fname), std::move(simplifiedArgs));
    }
}

void FunctionExpression::_toString(std::ostream& ss, bool persistent, int) const
{
    switch (f) {
        case ABS:
            ss << "abs(";
            break;
        case ACOS:
            ss << "acos(";
            break;
        case ASIN:
            ss << "asin(";
            break;
        case ATAN:
            ss << "atan(";
            break;
        case ATAN2:
            ss << "atan2(";
            break;
        case CATH:
            ss << "cath(";
            break;
        case CBRT:
            ss << "cbrt(";
            break;
        case CEIL:
            ss << "ceil(";
            break;
        case COS:
            ss << "cos(";
            break;
        case COSH:
            ss << "cosh(";
            break;
        case EXP:
            ss << "exp(";
            break;
        case FLOOR:
            ss << "floor(";
            break;
        case HYPOT:
            ss << "hypot(";
            break;
        case LOG:
            ss << "log(";
            break;
        case LOG10:
            ss << "log10(";
            break;
        case MOD:
            ss << "mod(";
            break;
        case POW:
            ss << "pow(";
            break;
        case ROUND:
            ss << "round(";
            break;
        case SIN:
            ss << "sin(";
            break;
        case SINH:
            ss << "sinh(";
            break;
        case SQRT:
            ss << "sqrt(";
            break;
        case TAN:
            ss << "tan(";
            break;
        case TANH:
            ss << "tanh(";
            break;
        case TRUNC:
            ss << "trunc(";
            break;
        case STR:
            ss << "str(";
            break;
        case PARSEQUANT:
            ss << "parsequant(";
            break;
        case AVERAGE:
            ss << "average(";
            break;
        case COUNT:
            ss << "count(";
            break;
        case MAX:
            ss << "max(";
            break;
        case MIN:
            ss << "min(";
            break;
        case STDDEV:
            ss << "stddev(";
            break;
        case SUM:
            ss << "sum(";
            break;
        case AND:
            ss << "and(";
            break;
        case OR:
            ss << "or(";
            break;
        case NOT:
            ss << "not(";
            break;
        default:
            ss << fname << "(";
            break;
    }
    for (size_t i = 0; i < args.size(); ++i) {
        ss << args[i]->toString(persistent);
        if (i != args.size() - 1) {
            ss << "; ";
        }
    }
    ss << ')';
}

Expression* FunctionExpression::_copy() const
{
    std::vector<Expression*>::const_iterator i = args.begin();
    std::vector<Expression*> a;

    while (i != args.end()) {
        a.push_back((*i)->copy().release());
        ++i;
    }
    return new FunctionExpression(f, std::string(fname), std::move(a));
}

void FunctionExpression::_visit(ExpressionVisitor& v)
{
    std::vector<Expression*>::const_iterator i = args.begin();

    while (i != args.end()) {
        (*i)->visit(v);
        ++i;
    }
}

//
// VariableExpression class
//

VariableExpression::VariableExpression(const std::string& _var)
    : var(_var)
{}

VariableExpression::~VariableExpression() = default;

void VariableExpression::addComponent(Component* c)
{
    // Forge: upstream folded simple member, index and range components into the
    // ObjectIdentifier path. A Forge name has no components, so every one is kept
    // as a component, which evaluation refuses (Expression::getValue).
    Expression::addComponent(c);
}

bool VariableExpression::_isIndexable() const
{
    return true;
}

Value VariableExpression::_getValue(const SymbolTable& symbols) const
{
    Value out;
    std::string why;
    if (!symbols.lookup(var, out, why)) {
        throw NameError(why.empty() ? "Unknown name '" + var + "'" : why);
    }
    if (out.isNumber() && !std::isfinite(out.quantity().getValue())) {
        throw ExpressionError("'" + var + "' has no finite value");
    }
    return out;
}

void VariableExpression::_toString(std::ostream& ss, bool, int) const
{
    ss << var;
}

ExpressionPtr VariableExpression::simplify() const
{
    return copy();
}

Expression* VariableExpression::_copy() const
{
    return new VariableExpression(var);
}

void VariableExpression::_getIdentifiers(std::set<std::string>& deps) const
{
    deps.insert(var);
}

void VariableExpression::setPath(const std::string& path)
{
    var = path;
}

//
// StringExpression class
//

StringExpression::StringExpression(const std::string& _text)
    : text(_text)
{}

StringExpression::~StringExpression() = default;

ExpressionPtr StringExpression::simplify() const
{
    return copy();
}

void StringExpression::_toString(std::ostream& ss, bool, int) const
{
    ss << quote(text);
}

Expression* StringExpression::_copy() const
{
    return new StringExpression(text);
}

Value StringExpression::_getValue(const SymbolTable&) const
{
    return Value(text);
}

//
// ConditionalExpression class
//

ConditionalExpression::ConditionalExpression(Expression* _condition, Expression* _trueExpr, Expression* _falseExpr)
    : condition(_condition)
    , trueExpr(_trueExpr)
    , falseExpr(_falseExpr)
{}

ConditionalExpression::~ConditionalExpression()
{
    delete condition;
    delete trueExpr;
    delete falseExpr;
}

Value ConditionalExpression::_getValue(const SymbolTable& symbols) const
{
    const Value c = condition->getValue(symbols);
    if (asBool(numberOf(c, this, "Condition").getValue())) {
        return trueExpr->getValue(symbols);
    }
    else {
        return falseExpr->getValue(symbols);
    }
}

ExpressionPtr ConditionalExpression::simplify() const
{
    ExpressionPtr e = condition->simplify();
    NumberExpression* v = dynamic_cast<NumberExpression*>(e.get());

    if (!v) {
        return std::make_unique<ConditionalExpression>(
            condition->simplify().release(),
            trueExpr->simplify().release(),
            falseExpr->simplify().release()
        );
    }
    else {
        if (std::fabs(v->getValue()) >= kConfusion) {
            return trueExpr->simplify();
        }
        else {
            return falseExpr->simplify();
        }
    }
}

void ConditionalExpression::_toString(std::ostream& ss, bool persistent, int) const
{
    condition->toString(ss, persistent);
    ss << " ? ";
    if (trueExpr->priority() <= priority()) {
        ss << '(';
        trueExpr->toString(ss, persistent);
        ss << ')';
    }
    else {
        trueExpr->toString(ss, persistent);
    }

    ss << " : ";

    if (falseExpr->priority() <= priority()) {
        ss << '(';
        falseExpr->toString(ss, persistent);
        ss << ')';
    }
    else {
        falseExpr->toString(ss, persistent);
    }
}

Expression* ConditionalExpression::_copy() const
{
    return new ConditionalExpression(condition->copy().release(), trueExpr->copy().release(), falseExpr->copy().release());
}

int ConditionalExpression::priority() const
{
    return 2;
}

void ConditionalExpression::_visit(ExpressionVisitor& v)
{
    condition->visit(v);
    trueExpr->visit(v);
    falseExpr->visit(v);
}

//
// ConstantExpression class
//

ConstantExpression::ConstantExpression(const char* _name, const Quantity& _quantity)
    : NumberExpression(_quantity)
    , name(_name)
{}

Expression* ConstantExpression::_copy() const
{
    return new ConstantExpression(name, getQuantity());
}

void ConstantExpression::_toString(std::ostream& ss, bool, int) const
{
    ss << name;
}

Value ConstantExpression::_getValue(const SymbolTable& symbols) const
{
    // Upstream returned Python None / True / False. True and False are the
    // numbers 1 and 0 here, as FreeCAD's comparisons already produce; None has no
    // Forge value and is refused.
    if (std::strcmp(name, "None") == 0) {
        _EXPR_THROW("'None' has no value", in(this));
    }
    return NumberExpression::_getValue(symbols);
}

bool ConstantExpression::isNumber() const
{
    return std::strcmp(name, "None") && std::strcmp(name, "True") && std::strcmp(name, "False");
}

//
// RangeExpression class
//

RangeExpression::RangeExpression(const std::string& begin, const std::string& end)
    : begin(begin)
    , end(end)
{}

Value RangeExpression::_getValue(const SymbolTable&) const
{
    _EXPR_THROW("Cell ranges are not supported", in(this));
}

void RangeExpression::_toString(std::ostream& ss, bool, int) const
{
    ss << begin << ":" << end;
}

Expression* RangeExpression::_copy() const
{
    return new RangeExpression(begin, end);
}

ExpressionPtr RangeExpression::simplify() const
{
    return copy();
}

void RangeExpression::_getIdentifiers(std::set<std::string>& deps) const
{
    // Upstream expanded the range into one identifier per cell. A range cannot
    // evaluate here, so its two corners are what it names.
    deps.insert(begin);
    deps.insert(end);
}


////////////////////////////////////////////////////////////////////////////////////

namespace forge::expr
{

namespace ExpressionParser
{

/**
 * @brief Error function for parser.
 */
void ExpressionParser_yyerror(const char* errorinfo)
{
    (void)errorinfo;
}

/// Why the lexer returned LEXERROR, or why a grammar action raised YYERROR. Forge.
static std::string lexFailure;
static std::string parseFailure;

/* helper function for tuning number strings with groups in a locale agnostic way... */
double num_change(char* yytext, char dez_delim, char grp_delim)
{
    double ret_val;
    char temp[40];
    int i = 0;
    for (char* c = yytext; *c != '\0'; c++) {
        // skip group delimiter
        if (*c == grp_delim) {
            continue;
        }
        // check for a dez delimiter other then dot
        if (*c == dez_delim && dez_delim != '.') {
            temp[i++] = '.';
        }
        else {
            temp[i++] = *c;
        }
        // check buffer overflow
        if (i > 39) {
            // Forge: upstream returned 0.0, silently turning a long number into zero.
            lexFailure = std::string("the number ") + yytext + " has too many digits";
            return 0.0;
        }
    }
    temp[i] = '\0';

    errno = 0;
    ret_val = strtod(temp, nullptr);
    // Forge: upstream threw from inside the lexer; the failure is recorded instead.
    if (ret_val == 0 && errno == ERANGE) {
        lexFailure = std::string("the number ") + yytext + " is too small";
    }
    if (ret_val == HUGE_VAL || ret_val == -HUGE_VAL) {
        lexFailure = std::string("the number ") + yytext + " is too large";
    }

    return ret_val;
}

/// The resulting expression after a successful parsing.
static ExpressionPtr ScanResult = ExpressionPtr {};

/// Whether the parsed string is a unit only.
static bool unitExpression = false;

/// Whether the parsed string is a full expression.
static bool valueExpression = false;

/// Registered functions during parsing.
static std::map<std::string, FunctionExpression::Function> registered_functions;

static int last_column;
static int column;

/// Forge: the parser's state above is file-static, exactly as upstream's is, so
/// every entry point that runs the lexer or the parser holds this.
static std::recursive_mutex parserMutex;

// show the parser the lexer method
#define yylex ExpressionParserlex
int ExpressionParserlex();

#include "ExpressionParserInternal.h"

// Forge: bound the parser stack, and so the nesting of parentheses, well below
// what evaluation can recurse through.
#define YYMAXDEPTH 1000

#if defined(__clang__)
# pragma clang diagnostic push
# pragma clang diagnostic ignored "-Wsign-compare"
# pragma clang diagnostic ignored "-Wunneeded-internal-declaration"
# pragma clang diagnostic ignored "-Wunused-function"
# pragma clang diagnostic ignored "-Wshorten-64-to-32"
# pragma clang diagnostic ignored "-Wunused-parameter"
# pragma clang diagnostic ignored "-Wunused-but-set-variable"
#elif defined(__GNUC__)
# pragma GCC diagnostic push
# pragma GCC diagnostic ignored "-Wsign-compare"
# pragma GCC diagnostic ignored "-Wfree-nonheap-object"
# pragma GCC diagnostic ignored "-Wunused-function"
# pragma GCC diagnostic ignored "-Wunused-parameter"
#endif

// Parser, defined in Expression.y. (Upstream defined YYTOKENTYPE first because
// its ExpressionParser.h had already included Expression.tab.h; here the token
// enum is defined by Expression.tab.c itself.)
#include "Expression.tab.c"

#ifndef DOXYGEN_SHOULD_SKIP_THIS
// Scanner, defined in Expression.l
# include "Expression.lex.c"
#endif  // DOXYGEN_SHOULD_SKIP_THIS

class StringBufferCleaner
{
public:
    explicit StringBufferCleaner(YY_BUFFER_STATE buffer)
        : my_string_buffer {buffer}
    {}
    ~StringBufferCleaner()
    {
        // free the scan buffer
        yy_delete_buffer(my_string_buffer);
    }

    StringBufferCleaner(const StringBufferCleaner&) = delete;
    StringBufferCleaner(StringBufferCleaner&&) = delete;
    StringBufferCleaner& operator=(const StringBufferCleaner&) = delete;
    StringBufferCleaner& operator=(StringBufferCleaner&&) = delete;

private:
    YY_BUFFER_STATE my_string_buffer;
};

#if defined(__clang__)
# pragma clang diagnostic pop
#elif defined(__GNUC__)
# pragma GCC diagnostic pop
#endif

static void initParser()
{
    static bool has_registered_functions = false;

    ScanResult.reset();
    column = 0;
    last_column = 0;
    unitExpression = valueExpression = false;
    lexFailure.clear();
    parseFailure.clear();

    if (!has_registered_functions) {
        registered_functions["abs"] = FunctionExpression::ABS;
        registered_functions["acos"] = FunctionExpression::ACOS;
        registered_functions["asin"] = FunctionExpression::ASIN;
        registered_functions["atan"] = FunctionExpression::ATAN;
        registered_functions["atan2"] = FunctionExpression::ATAN2;
        registered_functions["cath"] = FunctionExpression::CATH;
        registered_functions["cbrt"] = FunctionExpression::CBRT;
        registered_functions["ceil"] = FunctionExpression::CEIL;
        registered_functions["cos"] = FunctionExpression::COS;
        registered_functions["cosh"] = FunctionExpression::COSH;
        registered_functions["exp"] = FunctionExpression::EXP;
        registered_functions["floor"] = FunctionExpression::FLOOR;
        registered_functions["hypot"] = FunctionExpression::HYPOT;
        registered_functions["log"] = FunctionExpression::LOG;
        registered_functions["log10"] = FunctionExpression::LOG10;
        registered_functions["mod"] = FunctionExpression::MOD;
        registered_functions["pow"] = FunctionExpression::POW;
        registered_functions["round"] = FunctionExpression::ROUND;
        registered_functions["sin"] = FunctionExpression::SIN;
        registered_functions["sinh"] = FunctionExpression::SINH;
        registered_functions["sqrt"] = FunctionExpression::SQRT;
        registered_functions["tan"] = FunctionExpression::TAN;
        registered_functions["tanh"] = FunctionExpression::TANH;
        registered_functions["trunc"] = FunctionExpression::TRUNC;

        // Forge: the vector, matrix, placement, rotation, create, list, tuple and
        // hiddenref/href functions are NOT registered. Each produced or consumed a
        // Python object Forge has no value for, and hiddenref existed to hide a
        // dependency from FreeCAD's cycle check -- the check Forge relies on.
        registered_functions["str"] = FunctionExpression::STR;
        registered_functions["parsequant"] = FunctionExpression::PARSEQUANT;

        registered_functions["not"] = FunctionExpression::NOT;

        // Aggregates
        registered_functions["average"] = FunctionExpression::AVERAGE;
        registered_functions["count"] = FunctionExpression::COUNT;
        registered_functions["max"] = FunctionExpression::MAX;
        registered_functions["min"] = FunctionExpression::MIN;
        registered_functions["stddev"] = FunctionExpression::STDDEV;
        registered_functions["sum"] = FunctionExpression::SUM;
        registered_functions["and"] = FunctionExpression::AND;
        registered_functions["or"] = FunctionExpression::OR;

        has_registered_functions = true;
    }
}

static TokenKind tokenKindOf(int token)
{
    switch (token) {
        case FUNC:
            return TokenKind::Function;
        case ONE:
            return TokenKind::One;
        case NUM:
            return TokenKind::Number;
        case IDENTIFIER:
            return TokenKind::Identifier;
        case UNIT:
            return TokenKind::Unit;
        case USUNIT:
            return TokenKind::USUnit;
        case INTEGER:
            return TokenKind::Integer;
        case CONSTANT:
            return TokenKind::Constant;
        case CELLADDRESS:
            return TokenKind::CellAddress;
        case EQ:
            return TokenKind::Equal;
        case NEQ:
            return TokenKind::NotEqual;
        case LT:
            return TokenKind::Less;
        case GT:
            return TokenKind::Greater;
        case GTE:
            return TokenKind::GreaterEqual;
        case LTE:
            return TokenKind::LessEqual;
        case STRING:
            return TokenKind::String;
        case MINUSSIGN:
            return TokenKind::Minus;
        case LEXERROR:
            return TokenKind::Invalid;
        default:
            return token > 0 && token < 256 ? TokenKind::Punctuation : TokenKind::Invalid;
    }
}

std::vector<Token> tokenize(const std::string& str)
{
    std::lock_guard<std::recursive_mutex> lock(parserMutex);
    YY_BUFFER_STATE buf = ExpressionParser_scan_string(str.c_str());
    StringBufferCleaner cleaner(buf);
    std::vector<Token> result;
    int token;

    column = 0;
    last_column = 0;
    lexFailure.clear();
    initParser();
    while ((token = ExpressionParserlex()) != 0) {
        Token t;
        t.kind = tokenKindOf(token);
        t.column = last_column;
        t.text = yytext;
        result.push_back(std::move(t));
        if (token == LEXERROR) {
            break;
        }
    }

    return result;
}

}  // namespace ExpressionParser

}  // namespace forge::expr

/**
 * Parse the expression given by \a buffer. If the parser fails for some reason,
 * an exception is thrown.
 *
 * @param buffer The string buffer to parse.
 *
 * @returns A pointer to an expression.
 */
ExpressionPtr forge::expr::ExpressionParser::parse(const char* buffer)
{
    std::lock_guard<std::recursive_mutex> lock(parserMutex);
    // parse from buffer
    YY_BUFFER_STATE my_string_buffer = ExpressionParser_scan_string(buffer);
    StringBufferCleaner cleaner(my_string_buffer);

    initParser();

    // run the parser
    int result = ExpressionParser_yyparse();

    if (result != 0) {
        ScanResult.reset();
        // Forge: say WHY and WHERE, not only that it failed, in words a person
        // reading a refusal in a CAD panel can act on (upstream: "Failed to parse
        // expression '...'").
        std::string why = !lexFailure.empty() ? lexFailure
            : !parseFailure.empty()           ? parseFailure
                                              : std::string("it stops making sense");
        throw ParserError(
            "'" + std::string(buffer) + "' is not a formula: " + why + " at character "
            + std::to_string(last_column + 1)
        );
    }

    if (!ScanResult) {
        throw ParserError("Unknown error in expression '" + std::string(buffer) + "'");
    }

    if (!valueExpression) {
        ScanResult.reset();
        throw Expression::Exception("Expression can not evaluate to a value.");
    }
    return std::exchange(ScanResult, nullptr);
}

std::unique_ptr<UnitExpression> forge::expr::ExpressionParser::parseUnit(const char* buffer)
{
    std::lock_guard<std::recursive_mutex> lock(parserMutex);
    // parse from buffer
    YY_BUFFER_STATE my_string_buffer = ExpressionParser_scan_string(buffer);
    StringBufferCleaner cleaner(my_string_buffer);

    initParser();

    // run the parser
    int result = ExpressionParser_yyparse();

    if (result != 0) {
        ScanResult.reset();
        throw ParserError("Failed to parse expression.");
    }

    if (!ScanResult) {
        throw ParserError("Unknown error in expression");
    }

    // Simplify expression
    ExpressionPtr simplified = ScanResult->simplify();

    if (!unitExpression) {
        auto* fraction = dynamic_cast<OperatorExpression*>(ScanResult.get());

        if (fraction && fraction->getOperator() == OperatorExpression::DIV) {
            NumberExpression* nom = dynamic_cast<NumberExpression*>(fraction->getLeft());
            UnitExpression* denom = dynamic_cast<UnitExpression*>(fraction->getRight());

            // If not initially a unit expression, but value is equal to 1, it means the expression is something like 1/unit
            if (denom && nom && essentiallyEqual(nom->getValue(), 1.0)) {
                unitExpression = true;
            }
        }
    }
    ScanResult.reset();

    if (!unitExpression) {
        throw Expression::Exception("Expression is not a unit.");
    }

    if (auto num = dynamic_cast<NumberExpression*>(simplified.get()); num) {
        return std::make_unique<UnitExpression>(num->getQuantity());
    }
    auto* unit = dynamic_cast<UnitExpression*>(simplified.get());
    if (!unit) {
        throw Expression::Exception("Expression is not a unit.");
    }
    simplified.release();
    return std::unique_ptr<UnitExpression>(unit);
}

namespace
{
std::tuple<int, int> getTokenAndStatus(const std::string& str)
{
    using namespace forge::expr::ExpressionParser;
    YY_BUFFER_STATE buf = ExpressionParser_scan_string(str.c_str());
    StringBufferCleaner cleaner(buf);
    column = 0;
    last_column = 0;
    lexFailure.clear();
    int token = ExpressionParserlex();
    int status = token == 0 ? 0 : ExpressionParserlex();

    return std::make_tuple(token, status);
}
}  // namespace

bool forge::expr::ExpressionParser::isTokenAnIndentifier(const std::string& str)
{
    std::lock_guard<std::recursive_mutex> lock(parserMutex);
    initParser();
    int token {}, status {};
    std::tie(token, status) = getTokenAndStatus(str);
    return (status == 0 && (token == IDENTIFIER || token == CELLADDRESS));
}

bool forge::expr::ExpressionParser::isFunctionName(const std::string& str)
{
    std::lock_guard<std::recursive_mutex> lock(parserMutex);
    initParser();
    return registered_functions.count(str) != 0;
}

bool forge::expr::ExpressionParser::isTokenAConstant(const std::string& str)
{
    std::lock_guard<std::recursive_mutex> lock(parserMutex);
    initParser();
    int token {}, status {};
    std::tie(token, status) = getTokenAndStatus(str);
    return (status == 0 && token == CONSTANT);
}

bool forge::expr::ExpressionParser::isTokenAUnit(const std::string& str)
{
    std::lock_guard<std::recursive_mutex> lock(parserMutex);
    initParser();
    int token {}, status {};
    std::tie(token, status) = getTokenAndStatus(str);
    return (status == 0 && token == UNIT);
}
