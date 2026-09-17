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

// MODIFIED for libforge_expr (2026-09-15) from the `App::ExpressionParser`
// namespace declared in FreeCAD src/App/ExpressionParser.h at commit
// 0a45a0a008d4af7a85601016c5ab31bd26c25b22. See MODIFICATIONS.md:
//   * no owner argument; parsePath, ExpressionImporter and isModuleImported removed
//   * tokenize() reports a named TokenKind rather than the parser's private
//     bison token numbers, so the public header does not expose Expression.tab.h
//   * the parser's semantic_type moved to src/ExpressionParserInternal.h

#pragma once

#include <memory>
#include <string>
#include <vector>

#include "forge_expr/Expression.h"
#include "forge_expr/Export.h"

namespace forge::expr::ExpressionParser
{

/// Parse `buffer`. Throws ParserError (naming the column) or Expression::Exception.
FORGE_EXPR_EXPORT ExpressionPtr parse(const char* buffer);

/// Parse a unit expression such as `mm`, `N/mm^2` or `1/s`.
FORGE_EXPR_EXPORT std::unique_ptr<UnitExpression> parseUnit(const char* buffer);

/// True when `str` is exactly one identifier token (not a unit, not a constant).
FORGE_EXPR_EXPORT bool isTokenAnIndentifier(const std::string& str);
FORGE_EXPR_EXPORT bool isTokenAConstant(const std::string& str);
/// NEW (Forge): true when `str` names a registered function, e.g. "sqrt".
FORGE_EXPR_EXPORT bool isFunctionName(const std::string& str);
FORGE_EXPR_EXPORT bool isTokenAUnit(const std::string& str);

enum class TokenKind
{
    Function,
    One,
    Number,
    Identifier,
    Unit,
    USUnit,
    Integer,
    Constant,
    CellAddress,
    Equal,
    NotEqual,
    Less,
    Greater,
    GreaterEqual,
    LessEqual,
    String,
    Minus,
    Punctuation,
    Invalid,
};

struct FORGE_EXPR_EXPORT Token
{
    TokenKind kind = TokenKind::Invalid;
    int column = 0;
    std::string text;
};

/// The token stream of `str`. Stops at the first character that is not a token.
FORGE_EXPR_EXPORT std::vector<Token> tokenize(const std::string& str);

}  // namespace forge::expr::ExpressionParser
