// SPDX-License-Identifier: LGPL-2.1-or-later

/***************************************************************************
 *   Copyright (c) 2026 ArchDisc                                           *
 *                                                                         *
 *   This file is part of libforge_expr, a library derived from the        *
 *   FreeCAD CAx development system (https://www.freecad.org).             *
 *                                                                         *
 *   This library is free software; you can redistribute it and/or        *
 *   modify it under the terms of the GNU Lesser General Public            *
 *   License as published by the Free Software Foundation; either          *
 *   version 2.1 of the License, or (at your option) any later version.    *
 *                                                                         *
 *   This library is distributed in the hope that it will be useful,       *
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of        *
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU     *
 *   Lesser General Public License for more details.                       *
 *                                                                         *
 *   You should have received a copy of the GNU Lesser General Public      *
 *   License along with this library (COPYING.LGPL beside this tree).      *
 *                                                                         *
 ***************************************************************************/

// NEW FILE (2026-09-15). See forge_expr/Evaluator.h and MODIFICATIONS.md.

#include <cctype>
#include <cmath>
#include <exception>
#include <memory>
#include <string>

#include "forge_expr/Evaluator.h"
#include "forge_expr/ExpressionParser.h"

namespace forge::expr
{

namespace
{

// Upstream messages lead with the C++ member that threw ("Quantity::operator +():
// Unit mismatch in plus operation"). The host shows these to a person, so the
// function name is dropped and the sentence kept.
std::string humanMessage(const std::string& raw)
{
    const std::string marker = "(): ";
    const auto at = raw.find(marker);
    if (at != std::string::npos && raw.rfind("::", at) != std::string::npos
        && raw.find(' ') > raw.rfind("::", at)) {
        std::string rest = raw.substr(at + marker.size());
        if (!rest.empty()) {
            rest[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(rest[0])));
        }
        return rest;
    }
    return raw;
}

}  // namespace

CompiledExpression::CompiledExpression() = default;

CompiledExpression CompiledExpression::compile(const std::string& text) noexcept
{
    CompiledExpression out;
    try {
        if (text.size() > kMaxExpressionLength) {
            out._error = "The expression is longer than " + std::to_string(kMaxExpressionLength)
                + " characters";
            return out;
        }
        bool blank = true;
        for (char c : text) {
            if (c != ' ' && c != '\t' && c != '\r' && c != '\n') {
                blank = false;
                break;
            }
        }
        if (blank) {
            out._error = "The expression is empty";
            return out;
        }
        ExpressionPtr parsed = ExpressionParser::parse(text.c_str());
        std::set<std::string> names = parsed->getIdentifiers();
        std::string canonical = parsed->toString();
        out._names = std::move(names);
        out._canonical = std::move(canonical);
        out._expression = std::shared_ptr<const Expression>(parsed.release());
    }
    catch (const std::exception& e) {
        out._expression.reset();
        out._names.clear();
        out._canonical.clear();
        out._error = humanMessage(e.what());
    }
    catch (...) {
        out._expression.reset();
        out._names.clear();
        out._canonical.clear();
        out._error = "The expression could not be read";
    }
    return out;
}

Evaluation CompiledExpression::evaluate(const SymbolTable& symbols) const noexcept
{
    Evaluation result;
    if (!_expression) {
        result.error = _error.empty() ? "The expression could not be read" : _error;
        return result;
    }
    try {
        Value value = _expression->getValue(symbols);
        if (value.isNumber() && !std::isfinite(value.quantity().getValue())) {
            result.error = "The result is not a finite number";
            return result;
        }
        result.value = std::move(value);
        result.ok = true;
    }
    catch (const std::exception& e) {
        result.ok = false;
        result.error = humanMessage(e.what());
    }
    catch (...) {
        result.ok = false;
        result.error = "The expression could not be evaluated";
    }
    return result;
}

bool isValidName(const std::string& name) noexcept
{
    try {
        if (name.empty() || name.size() > 128 || name.find('@') != std::string::npos) {
            return false;
        }
        return ExpressionParser::isTokenAnIndentifier(name) && !ExpressionParser::isFunctionName(name);
    }
    catch (...) {
        return false;
    }
}

bool parseUnitSpelling(const std::string& text, Quantity& out, std::string& error) noexcept
{
    try {
        auto unit = ExpressionParser::parseUnit(text.c_str());
        out = unit->getQuantity();
        return true;
    }
    catch (const std::exception& e) {
        error = humanMessage(e.what());
    }
    catch (...) {
        error = "Not a unit";
    }
    return false;
}

const char* libraryIdentity() noexcept
{
    return "libforge_expr 1.0.0 (FreeCAD 0a45a0a008d4af7a85601016c5ab31bd26c25b22, "
           "LGPL-2.1-or-later)";
}

}  // namespace forge::expr
