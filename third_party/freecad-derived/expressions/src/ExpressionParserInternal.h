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

// MODIFIED for libforge_expr (2026-09-15): the parser's semantic_type, taken
// from the bottom of FreeCAD src/App/ExpressionParser.h at commit
// 0a45a0a008d4af7a85601016c5ab31bd26c25b22. ObjectIdentifier paths and
// ObjectIdentifier::String became std::string; the component deque, which the
// grammar never used, is removed. PRIVATE to the library: only Expression.cpp
// includes it, inside namespace forge::expr::ExpressionParser.

#pragma once

// Included from inside `namespace forge::expr::ExpressionParser`.

class semantic_type
{
public:
    struct
    {
        Quantity scaler;
        std::string unitStr;
    } quantity;
    Expression::Component* component {nullptr};
    Expression* expr {nullptr};
    std::string path;
    long long int ivalue {0};
    double fvalue {0};
    struct
    {
        const char* name = "";
        double fvalue = 0;
    } constant;
    std::vector<Expression*> arguments;
    std::vector<Expression*> list;
    std::string string;
    std::pair<FunctionExpression::Function, std::string> func;
    std::string string_or_identifier;
    semantic_type()
        : func({FunctionExpression::NONE, std::string()})
    {}
};
