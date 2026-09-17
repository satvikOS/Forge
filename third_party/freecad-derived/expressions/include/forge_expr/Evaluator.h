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

// NEW FILE (2026-09-15). See MODIFICATIONS.md.
//
// THE LIBRARY BOUNDARY. FreeCAD reports every failure -- a parse error, an
// unknown name, a unit mismatch -- by throwing. A host that lets one of those
// cross into a UI frame loop crashes the application on a typo. Everything here
// is noexcept: a failure comes back as `ok == false` with a sentence saying why,
// and a success carries the value. This is the only API Forge's adapter uses.

#pragma once

#include <cstddef>
#include <memory>
#include <set>
#include <string>

#include "forge_expr/Expression.h"
#include "forge_expr/Export.h"

namespace forge::expr
{

/// Longer input is refused before it reaches the parser. Bounds both the parser
/// stack and the depth of the tree evaluation walks.
inline constexpr std::size_t kMaxExpressionLength = 2048;

struct FORGE_EXPR_EXPORT Evaluation
{
    bool ok = false;
    std::string error;  ///< why there is no value; empty when ok
    Value value;
};

/**
 * @brief An expression parsed once and evaluated as many times as its names change.
 */
class FORGE_EXPR_EXPORT CompiledExpression
{
public:
    CompiledExpression();

    /// Parse `text`. Never throws; check ok().
    static CompiledExpression compile(const std::string& text) noexcept;

    bool ok() const noexcept
    {
        return _expression != nullptr;
    }
    /// Why compile() refused; empty when ok().
    const std::string& error() const noexcept
    {
        return _error;
    }
    /// Every name the expression refers to, as written (`wall`, `Hole3.dia`).
    const std::set<std::string>& names() const noexcept
    {
        return _names;
    }
    /// The expression printed back in canonical form ("wall * 0.5 + 2 mm").
    const std::string& canonical() const noexcept
    {
        return _canonical;
    }

    /// Evaluate against `symbols`. Never throws.
    Evaluation evaluate(const SymbolTable& symbols) const noexcept;

private:
    std::shared_ptr<const Expression> _expression;
    std::string _error;
    std::set<std::string> _names;
    std::string _canonical;
};

/// True when `name` can be used as a parameter name: a single identifier token
/// that is not a unit (`mm`, `h`, `N`), not a constant (`pi`, `e`), not a function
/// name (`sqrt`) and contains no `@`. Never throws.
FORGE_EXPR_EXPORT bool isValidName(const std::string& name) noexcept;

/// Parse a unit spelling such as "mm" or "N/mm^2" into its quantity. Never throws.
FORGE_EXPR_EXPORT bool parseUnitSpelling(const std::string& text, Quantity& out, std::string& error) noexcept;

/// "libforge_expr 1.0.0 (FreeCAD 0a45a0a008d4af7a85601016c5ab31bd26c25b22, LGPL-2.1-or-later)"
FORGE_EXPR_EXPORT const char* libraryIdentity() noexcept;

}  // namespace forge::expr
