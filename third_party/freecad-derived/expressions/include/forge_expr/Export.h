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

// NEW FILE (2026-09-15). Replaces FreeCAD's FCGlobal.h AppExport/BaseExport
// macros for this shared library. See MODIFICATIONS.md.
//
// libforge_expr is built with -fvisibility=hidden so the only symbols a program
// linking it can reach are the ones marked here. That is what keeps the
// library boundary a real boundary: Forge's adapter uses the declared API and
// nothing else, which is also what lets a user relink Forge against a modified
// build of this library (LGPL-2.1 section 6).

#pragma once

#if defined(_WIN32)
# if defined(FORGE_EXPR_BUILDING)
#  define FORGE_EXPR_EXPORT __declspec(dllexport)
# else
#  define FORGE_EXPR_EXPORT __declspec(dllimport)
# endif
#else
# define FORGE_EXPR_EXPORT __attribute__((visibility("default")))
#endif
