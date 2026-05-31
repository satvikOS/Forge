// SPDX-License-Identifier: LGPL-2.1-or-later
//
// SketcherGlobal.h — Forge-local replacement for FreeCAD's DLL-export shim.
//
// The vendored planegcs sources include "../../SketcherGlobal.h" expecting
// the FreeCAD source layout. In the Forge vendoring we point that include
// at this header (via -I) so the SketcherExport macro is a no-op (we link
// planegcs statically into forge_kernel; no symbols need DLL-export marks
// on Darwin/Linux).
//
// We also short-circuit the FreeCAD `Base::Console` / `Base::TimeElapsed`
// dependency by funnelling them into trivial stand-ins. The planegcs code
// uses these only for verbose timing logs that the Forge product does not
// need.

#pragma once

#ifndef SketcherExport
#  define SketcherExport
#endif
#ifndef SketcherGuiExport
#  define SketcherGuiExport
#endif
