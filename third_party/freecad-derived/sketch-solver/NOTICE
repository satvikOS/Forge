# libforge_gcs

Forge's 2D geometric constraint solver library.

libforge_gcs is a modified version of **planegcs**, the constraint solver of the
FreeCAD Sketcher (<https://github.com/FreeCAD/FreeCAD>, commit
`0a45a0a008d4af7a85601016c5ab31bd26c25b22`, `src/Mod/Sketcher/App/planegcs/`).

- Copyright © 2011 Konstantinos Poulios
- Copyright © 2014 Victor Titov (DeepSOIC)
- and the FreeCAD contributors
- Modifications for Forge © 2026 ArchDisc

This library is free software; you can redistribute it and/or modify it under the
terms of the GNU Lesser General Public License as published by the Free Software
Foundation; either version 2.1 of the License, or (at your option) any later version.
It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
PURPOSE. See `COPYING.LGPL` for the full licence text and `MODIFICATIONS.md` for
every change made to the upstream sources and when.

Forge uses this library as a separate shared library (`libforge_gcs.dylib`,
installed in `Forge.app/Contents/Frameworks`) through the C interface in
`include/forge_gcs/forge_gcs.h`. You may rebuild the library from this source
(`cmake -S . -B build && cmake --build build`, with Eigen 3.3+ and Boost headers
installed) and replace the installed copy; Forge checks `forge_gcs_abi_version()`
and refuses a library whose interface version it does not understand.

libforge_gcs compiles against these header-only libraries, which are not part of it:
Eigen (MPL-2.0, <https://eigen.tuxfamily.org>) and Boost.Graph / Boost.Math
(Boost Software License 1.0, <https://www.boost.org>).
