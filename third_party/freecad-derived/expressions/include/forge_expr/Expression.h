// SPDX-License-Identifier: LGPL-2.1-or-later

/****************************************************************************
 *   Copyright (c) 2015 Eivind Kvedalen <eivind@kvedalen.name>              *
 *   Copyright (c) 2019 Zheng Lei (realthunder) <realthunder.dev@gmail.com> *
 *                                                                          *
 *   This file is part of the FreeCAD CAx development system.               *
 *                                                                          *
 *   This library is free software; you can redistribute it and/or          *
 *   modify it under the terms of the GNU Library General Public            *
 *   License as published by the Free Software Foundation; either           *
 *   version 2 of the License, or (at your option) any later version.       *
 *                                                                          *
 *   This library  is distributed in the hope that it will be useful,       *
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of         *
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the          *
 *   GNU Library General Public License for more details.                   *
 *                                                                          *
 *   You should have received a copy of the GNU Library General Public      *
 *   License along with this library; see the file COPYING.LIB. If not,     *
 *   write to the Free Software Foundation, Inc., 59 Temple Place,          *
 *   Suite 330, Boston, MA  02111-1307, USA                                 *
 *                                                                          *
 ****************************************************************************/

// MODIFIED for libforge_expr (2026-09-15). Merged from FreeCAD src/App/Expression.h
// (the Expression base class) and src/App/ExpressionParser.h (the concrete
// expression classes) at commit 0a45a0a008d4af7a85601016c5ab31bd26c25b22.
// See MODIFICATIONS.md. In short:
//
//   * NO FreeCAD object model. Upstream every expression had an
//     App::DocumentObject owner, names were App::ObjectIdentifier paths resolved
//     against the owner's document, and values were Python objects. Here a name
//     is a string, a value is forge::expr::Value (a Quantity or a text), and
//     names are resolved through a SymbolTable the caller passes to evaluation.
//   * NO Python, Qt, boost::any or Base::BaseClass type system. The evaluation
//     rules FreeCAD delegated to Python's number protocol (via QuantityPy) are
//     implemented directly on Quantity, and the kinds Forge cannot represent
//     (vectors, matrices, placements, rotations, Python lists and tuples,
//     spreadsheet cell ranges, object creation) are REFUSED rather than imitated.
//   * Everything that edited a document -- link adjustment, relabelling, sub-name
//     import, cell moves, the PropertyExpressionEngine modifier -- is removed; it
//     belongs to the host application's document model, not to the language.
//   * The operator precedence, printing (toString), simplification and the unit
//     rules of every retained function are upstream's.

#pragma once

#include <cstddef>
#include <iosfwd>
#include <memory>
#include <set>
#include <string>
#include <vector>

#include "forge_expr/Exception.h"
#include "forge_expr/Export.h"
#include "forge_expr/Quantity.h"
#include "forge_expr/Unit.h"

namespace forge::expr
{

class Expression;
class IdentifierCollector;

using ExpressionPtr = std::unique_ptr<Expression>;

/**
 * @brief The value an expression evaluates to.
 *
 * Replaces the Py::Object FreeCAD's evaluator passed around. Forge has two kinds:
 * a Quantity (a number with a unit, possibly dimensionless) and a text.
 */
class FORGE_EXPR_EXPORT Value
{
public:
    enum class Kind
    {
        Number,
        Text
    };

    Value();
    explicit Value(const Quantity& quantity);
    explicit Value(std::string text);

    Kind kind() const
    {
        return _kind;
    }
    bool isNumber() const
    {
        return _kind == Kind::Number;
    }
    bool isText() const
    {
        return _kind == Kind::Text;
    }

    /// The number. Throws TypeError when the value is a text.
    const Quantity& quantity() const;
    /// The text. Throws TypeError when the value is a number.
    const std::string& text() const;

    std::string toString() const;

private:
    Kind _kind;
    Quantity _quantity;
    std::string _text;
};

/**
 * @brief How evaluation looks up a name.
 *
 * NEW (Forge). Upstream resolved a name against the owning DocumentObject and its
 * document; here the host application decides what a name means. `path` is the
 * name exactly as written -- `wall`, or a dotted path such as `Hole3.dia`.
 * Return false to refuse, with `why` naming the reason; evaluation then fails
 * with that reason and produces no value.
 */
class FORGE_EXPR_EXPORT SymbolTable
{
public:
    virtual ~SymbolTable();
    virtual bool lookup(const std::string& path, Value& out, std::string& why) const = 0;
};

/// A SymbolTable that knows no names. Constant expressions evaluate against it.
class FORGE_EXPR_EXPORT EmptySymbolTable final: public SymbolTable
{
public:
    bool lookup(const std::string& path, Value& out, std::string& why) const override;
};

/**
 * @brief %Base class for expression visitors.
 */
class FORGE_EXPR_EXPORT ExpressionVisitor
{
public:
    virtual ~ExpressionVisitor() = default;
    virtual void visit(Expression& e) = 0;
};

/**
 * @brief %Base class for expressions.
 */
class FORGE_EXPR_EXPORT Expression
{
public:
    Expression();

    virtual ~Expression();

    Expression(const Expression&) = delete;
    Expression& operator=(const Expression&) = delete;

    /**
     * @brief Evaluate the expression to another expression representing its value
     * (a NumberExpression or a StringExpression).
     */
    ExpressionPtr eval(const SymbolTable& symbols) const;

    /**
     * @brief Evaluate the expression to a value.
     *
     * Throws a forge::expr::Exception subclass naming the reason when the
     * expression has no value: an unknown name, a unit mismatch, a division by
     * zero, a result that is not a finite number, or a construct Forge does not
     * support.
     */
    Value getValue(const SymbolTable& symbols) const;

    std::string toString(bool persistent = false, bool checkPriority = false, int indent = 0) const;

    void toString(std::ostream& os, bool persistent = false, bool checkPriority = false, int indent = 0) const;

    static ExpressionPtr parse(const std::string& buffer);

    ExpressionPtr copy() const;

    virtual int priority() const;

    /// Every name the expression refers to, as written.
    void getIdentifiers(std::set<std::string>& deps) const;
    std::set<std::string> getIdentifiers() const;

    virtual ExpressionPtr simplify() const = 0;

    void visit(ExpressionVisitor& v);

    /// Exception class for expression errors.
    class FORGE_EXPR_EXPORT Exception: public ExpressionError
    {
    public:
        explicit Exception(const std::string& sMessage)
            : ExpressionError(sMessage)
        {}
    };

    struct Component;

    virtual void addComponent(Component* component);

    using ComponentList = std::vector<Component*>;

    static Component* createComponent(const std::string& n);

    static Component* createComponent(
        Expression* e1,
        Expression* e2 = nullptr,
        Expression* e3 = nullptr,
        bool isRange = false
    );

    bool hasComponent() const
    {
        return !components.empty();
    }

    bool isSame(const Expression& other, bool checkComment = true) const;

    friend class ExpressionVisitor;
    friend class IdentifierCollector;

protected:
    virtual bool _isIndexable() const
    {
        return false;
    }
    virtual Expression* _copy() const = 0;
    virtual void _toString(std::ostream& ss, bool persistent, int indent = 0) const = 0;
    virtual void _getIdentifiers(std::set<std::string>&) const {}
    virtual Value _getValue(const SymbolTable& symbols) const = 0;
    virtual void _visit(ExpressionVisitor&) {}

    ComponentList components;

public:
    std::string comment;
};

/**
 * @brief Part of an expression that represents an index, a range or a member.
 *
 * Kept so the grammar parses exactly what FreeCAD's does. Forge has no indexable
 * values, so an expression carrying a component refuses to evaluate.
 */
struct FORGE_EXPR_EXPORT Expression::Component
{
    std::string name;  ///< a member access `.name`; empty for an index or range
    ExpressionPtr e1;
    ExpressionPtr e2;
    ExpressionPtr e3;
    bool isRange = false;

    explicit Component(const std::string& n);
    Component(Expression* e1, Expression* e2, Expression* e3, bool isRange = false);
    Component(const Component& other);
    ~Component();
    Component& operator=(const Component&) = delete;

    void visit(ExpressionVisitor& v);
    void toString(std::ostream& ss, bool persistent) const;
    Component* copy() const;
};

/**
 * Part of an expressions that contains a unit.
 */
class FORGE_EXPR_EXPORT UnitExpression: public Expression
{
public:
    explicit UnitExpression(const Quantity& _quantity = Quantity(), const std::string& _unitStr = std::string());

    ~UnitExpression() override;

    ExpressionPtr simplify() const override;

    void setUnit(const Quantity& _quantity);

    void setQuantity(const Quantity& _quantity);

    double getValue() const
    {
        return quantity.getValue();
    }

    const Unit& getUnit() const
    {
        return quantity.getUnit();
    }

    const Quantity& getQuantity() const
    {
        return quantity;
    }

    const std::string getUnitString() const
    {
        return unitStr;
    }

    double getScaler() const
    {
        return quantity.getValue();
    }

    using Expression::getValue;

protected:
    Expression* _copy() const override;
    void _toString(std::ostream& ss, bool persistent, int indent) const override;
    Value _getValue(const SymbolTable& symbols) const override;

private:
    Quantity quantity;
    std::string unitStr; /**< The unit string from the original parsed string */
};

/**
 * Class implementing a number with an optional unit
 */
class FORGE_EXPR_EXPORT NumberExpression: public UnitExpression
{
public:
    explicit NumberExpression(const Quantity& quantity = Quantity());

    ExpressionPtr simplify() const override;

    /**
     * @brief Negate the stored value.
     */
    void negate();

    bool isInteger(long* v = nullptr) const;

protected:
    Expression* _copy() const override;
    void _toString(std::ostream& ss, bool persistent, int indent) const override;
};

class FORGE_EXPR_EXPORT ConstantExpression: public NumberExpression
{
public:
    explicit ConstantExpression(const char* _name = "", const Quantity& _quantity = Quantity());

    std::string getName() const
    {
        return name;
    }

    bool isNumber() const;

protected:
    Value _getValue(const SymbolTable& symbols) const override;
    void _toString(std::ostream& ss, bool persistent, int indent) const override;
    Expression* _copy() const override;

protected:
    const char* name;
};

/**
 * Class implementing an infix expression.
 */
class FORGE_EXPR_EXPORT OperatorExpression: public UnitExpression
{
public:
    enum Operator
    {
        NONE,
        ADD,
        SUB,
        MUL,
        DIV,
        MOD,
        POW,
        EQ,
        NEQ,
        LT,
        GT,
        LTE,
        GTE,
        UNIT,
        NEG,
        POS
    };
    explicit OperatorExpression(Expression* _left = nullptr, Operator _op = NONE, Expression* _right = nullptr);

    ~OperatorExpression() override;

    ExpressionPtr simplify() const override;

    int priority() const override;

    Operator getOperator() const
    {
        return op;
    }

    Expression* getLeft() const
    {
        return left;
    }

    Expression* getRight() const
    {
        return right;
    }

protected:
    Expression* _copy() const override;

    Value _getValue(const SymbolTable& symbols) const override;

    void _toString(std::ostream& ss, bool persistent, int indent) const override;

    void _visit(ExpressionVisitor& v) override;


    virtual bool isCommutative() const;

    virtual bool isLeftAssociative() const;

    virtual bool isRightAssociative() const;

    Operator op;       /**< Operator working on left and right */
    Expression* left;  /**< Left operand */
    Expression* right; /**< Right operand */
};

class FORGE_EXPR_EXPORT ConditionalExpression: public Expression
{
public:
    explicit ConditionalExpression(
        Expression* _condition = nullptr,
        Expression* _trueExpr = nullptr,
        Expression* _falseExpr = nullptr
    );

    ~ConditionalExpression() override;

    ExpressionPtr simplify() const override;

    int priority() const override;

protected:
    Expression* _copy() const override;
    void _visit(ExpressionVisitor& v) override;
    void _toString(std::ostream& ss, bool persistent, int indent) const override;
    Value _getValue(const SymbolTable& symbols) const override;

protected:
    Expression* condition; /**< Condition */
    Expression* trueExpr;  /**< Expression if abs(condition) is > 0.5 */
    Expression* falseExpr; /**< Expression if abs(condition) is < 0.5 */
};

/**
 * Class implementing various functions, e.g sin, cos, etc.
 */
class FORGE_EXPR_EXPORT FunctionExpression: public UnitExpression
{
public:
    enum Function
    {
        NONE,

        // Normal functions taking one or two arguments
        ABS,
        ACOS,
        ASIN,
        ATAN,
        ATAN2,
        CATH,
        CBRT,
        CEIL,
        COS,
        COSH,
        EXP,
        FLOOR,
        HYPOT,
        LOG,
        LOG10,
        MOD,
        POW,
        ROUND,
        SIN,
        SINH,
        SQRT,
        TAN,
        TANH,
        TRUNC,

        // Text
        STR,         // stringify
        PARSEQUANT,  // parse string quantity

        // Non aggregated logical
        NOT,  // logical NOT

        // Aggregates
        AGGREGATES,

        AVERAGE,
        COUNT,
        MAX,
        MIN,
        STDDEV,
        SUM,

        // Logical aggregates, evaluates to {0,1}
        AND,  // logical AND
        OR,   // logical OR

        // Last one
        LAST,
    };

    explicit FunctionExpression(
        Function _f = NONE,
        std::string&& name = std::string(),
        std::vector<Expression*> _args = std::vector<Expression*>()
    );

    ~FunctionExpression() override;

    ExpressionPtr simplify() const override;

    static Value evaluate(
        const Expression* owner,
        int type,
        const std::vector<Expression*>& args,
        const SymbolTable& symbols
    );

    Function getFunction() const
    {
        return f;
    }
    const std::vector<Expression*>& getArgs() const
    {
        return args;
    }

    /// Non-empty when the call names an unknown function or has the wrong number
    /// of arguments. The parser turns it into a parse error.
    const std::string& constructionError() const
    {
        return _constructionError;
    }

protected:
    static Value evalAggregate(
        const Expression* owner,
        int type,
        const std::vector<Expression*>& args,
        const SymbolTable& symbols
    );
    Value _getValue(const SymbolTable& symbols) const override;
    Expression* _copy() const override;
    void _visit(ExpressionVisitor& v) override;
    void _toString(std::ostream& ss, bool persistent, int indent) const override;

    Function f; /**< Function to execute */
    std::string fname;
    std::vector<Expression*> args; /** Arguments to function*/
    std::string _constructionError;
};

/**
 * Class implementing a reference to a named value. The name is resolved by the
 * SymbolTable passed to evaluation.
 */
class FORGE_EXPR_EXPORT VariableExpression: public UnitExpression
{
public:
    explicit VariableExpression(const std::string& _var = std::string());

    ~VariableExpression() override;

    ExpressionPtr simplify() const override;

    std::string name() const
    {
        return var;
    }

    std::string getPath() const
    {
        return var;
    }

    void setPath(const std::string& path);

    void addComponent(Component* component) override;

protected:
    Expression* _copy() const override;
    Value _getValue(const SymbolTable& symbols) const override;
    void _toString(std::ostream& ss, bool persistent, int indent) const override;
    bool _isIndexable() const override;
    void _getIdentifiers(std::set<std::string>&) const override;

protected:
    std::string var; /**< Variable name  */
};

/**
 * Class implementing a string.
 */
class FORGE_EXPR_EXPORT StringExpression: public Expression
{
public:
    explicit StringExpression(const std::string& _text = std::string());
    ~StringExpression() override;

    ExpressionPtr simplify() const override;

    virtual std::string getText() const
    {
        return text;
    }

protected:
    Expression* _copy() const override;
    void _toString(std::ostream& ss, bool persistent, int indent) const override;
    Value _getValue(const SymbolTable& symbols) const override;
    bool _isIndexable() const override
    {
        return true;
    }

private:
    std::string text; /**< Text string */
};

/**
 * A spreadsheet cell range `A1:B3`. It parses, because the grammar accepts it in a
 * function argument list; Forge has no spreadsheet cells, so it refuses to evaluate.
 */
class FORGE_EXPR_EXPORT RangeExpression: public Expression
{
public:
    explicit RangeExpression(const std::string& begin = std::string(), const std::string& end = std::string());

    ~RangeExpression() override = default;

    ExpressionPtr simplify() const override;

protected:
    Expression* _copy() const override;
    void _toString(std::ostream& ss, bool persistent, int indent) const override;
    Value _getValue(const SymbolTable& symbols) const override;
    void _getIdentifiers(std::set<std::string>&) const override;

protected:
    std::string begin;
    std::string end;
};

}  // namespace forge::expr
