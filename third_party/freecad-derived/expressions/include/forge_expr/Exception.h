// SPDX-License-Identifier: LGPL-2.1-or-later

/***************************************************************************
 *   Copyright (c) 2002 Jürgen Riegel <juergen.riegel@web.de>              *
 *                                                                         *
 *   This file is part of the FreeCAD CAx development system.              *
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU Library General Public License (LGPL)   *
 *   as published by the Free Software Foundation; either version 2 of     *
 *   the License, or (at your option) any later version.                   *
 *   for detail see the LICENCE text file.                                 *
 *                                                                         *
 *   FreeCAD is distributed in the hope that it will be useful,            *
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of        *
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the         *
 *   GNU Library General Public License for more details.                  *
 *                                                                         *
 *   You should have received a copy of the GNU Library General Public     *
 *   License along with FreeCAD; if not, write to the Free Software        *
 *   Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  *
 *   USA                                                                   *
 *                                                                         *
 ***************************************************************************/

// MODIFIED for libforge_expr (2026-09-15) from FreeCAD src/Base/Exception.h at
// commit 0a45a0a008d4af7a85601016c5ab31bd26c25b22. See MODIFICATIONS.md.
//
// Only the exception kinds the expression and unit code actually throws are kept.
// FreeCAD's Exception derived from Base::BaseClass (its run-time type system,
// Python bindings, file/line/function bookkeeping and the console reporter);
// here they derive from std::runtime_error and carry a message only. Nothing in
// this library lets one of these escape its public API: forge_expr/Evaluator.h
// catches them at the boundary and returns a refusal with the message.

#pragma once

#include <stdexcept>
#include <string>

#include "forge_expr/Export.h"

namespace forge::expr
{

class FORGE_EXPR_EXPORT Exception: public std::runtime_error
{
public:
    explicit Exception(const std::string& message = "Expression library exception")
        : std::runtime_error(message)
    {}
};

class FORGE_EXPR_EXPORT TypeError: public Exception
{
public:
    explicit TypeError(const std::string& message = "Type error")
        : Exception(message)
    {}
};

class FORGE_EXPR_EXPORT NameError: public Exception
{
public:
    explicit NameError(const std::string& message = "Name error")
        : Exception(message)
    {}
};

class FORGE_EXPR_EXPORT RuntimeError: public Exception
{
public:
    explicit RuntimeError(const std::string& message = "Runtime error")
        : Exception(message)
    {}
};

class FORGE_EXPR_EXPORT ExpressionError: public Exception
{
public:
    explicit ExpressionError(const std::string& message = "Expression error")
        : Exception(message)
    {}
};

class FORGE_EXPR_EXPORT ParserError: public Exception
{
public:
    explicit ParserError(const std::string& message = "Parser error")
        : Exception(message)
    {}
};

class FORGE_EXPR_EXPORT OverflowError: public Exception
{
public:
    explicit OverflowError(const std::string& message = "Overflow error")
        : Exception(message)
    {}
};

class FORGE_EXPR_EXPORT UnderflowError: public Exception
{
public:
    explicit UnderflowError(const std::string& message = "Underflow error")
        : Exception(message)
    {}
};

class FORGE_EXPR_EXPORT UnitsMismatchError: public Exception
{
public:
    explicit UnitsMismatchError(const std::string& message = "Units mismatch error")
        : Exception(message)
    {}
};

class FORGE_EXPR_EXPORT ZeroDivisionError: public Exception
{
public:
    explicit ZeroDivisionError(const std::string& message = "Division by zero")
        : Exception(message)
    {}
};

}  // namespace forge::expr
