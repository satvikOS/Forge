// SPDX-License-Identifier: LGPL-2.1-or-later
//
// Part of libforge_gcs, a modified version of FreeCAD's planegcs solver.
// Written for Forge on 2026-09-15 to stand in for FreeCAD's
// src/Mod/Sketcher/App/SketcherGlobal.h, which the planegcs headers include and
// which is not part of the planegcs subtree. See ../MODIFICATIONS.md.
//
// FreeCAD uses SketcherExport to export the solver classes from its Sketcher
// module. libforge_gcs deliberately exports NONE of them: the library is built
// with hidden symbol visibility and its only public surface is the C ABI in
// include/forge_gcs/forge_gcs.h. That keeps Eigen and Boost template instances
// private to the library, and it is what allows a rebuilt or modified
// libforge_gcs to be dropped into an installed Forge without recompiling Forge.
#pragma once

#ifndef SketcherExport
#  define SketcherExport
#endif
#ifndef SketcherGuiExport
#  define SketcherGuiExport
#endif
