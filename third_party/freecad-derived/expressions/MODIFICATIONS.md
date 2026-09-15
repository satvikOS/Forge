# libforge_expr — modifications to FreeCAD's expression code

This directory is a **modified copy** of part of FreeCAD, distributed under the GNU
Lesser General Public License, version 2.1 or (at your option) any later version.
The full licence text is in `COPYING.LGPL` beside this file.

LGPL-2.1 **section 2(a)–(c)**: a modified library must itself be a library, must
carry prominent notices stating that the files were changed and the date of any
change, and must be licensed as a whole under the LGPL.
This file is that notice. Every modified source file also carries its own
`MODIFIED for libforge_expr (<date>)` line under its original copyright header, and
every new file says `NEW FILE (<date>)`. No original copyright or licence header has
been removed from any file.

| | |
|---|---|
| Upstream project | FreeCAD — <https://github.com/FreeCAD/FreeCAD> |
| Upstream commit | `0a45a0a008d4af7a85601016c5ab31bd26c25b22` (branch `main`) |
| Upstream licence | `LGPL-2.1-or-later` (SPDX header in every file taken) |
| This library | `libforge_expr` 1.0.0, a **shared** library (`libforge_expr.dylib`) |
| Linked by | Forge (`forge_desktop`), **dynamically** — never compiled into a Forge binary |
| Modified by | ArchDisc |

## Change log

### 2026-09-15 — initial adaptation (ArchDisc)

**Files taken from upstream and modified**

| This tree | Upstream path |
|---|---|
| `include/forge_expr/Unit.h`, `src/Unit.cpp` | `src/Base/Unit.h`, `src/Base/Unit.cpp` |
| `include/forge_expr/Quantity.h`, `src/Quantity.cpp` | `src/Base/Quantity.h`, `src/Base/Quantity.cpp` |
| `src/UnitsConvData.h` | `src/Base/UnitsConvData.h` |
| `include/forge_expr/Exception.h` | `src/Base/Exception.h` (subset) |
| `include/forge_expr/Expression.h` | `src/App/Expression.h` + the class declarations of `src/App/ExpressionParser.h` |
| `include/forge_expr/ExpressionParser.h` | the `App::ExpressionParser` namespace of `src/App/ExpressionParser.h` |
| `src/ExpressionParserInternal.h` | the `semantic_type` of `src/App/ExpressionParser.h` |
| `src/Expression.cpp` | `src/App/Expression.cpp` (plus `App::quote` from `src/App/ObjectIdentifier.cpp`) |
| `src/Expression.y` | `src/App/Expression.y` |
| `src/Expression.l` | `src/App/Expression.l` |
| `src/Expression.tab.c`, `src/Expression.tab.h`, `src/Expression.lex.c` | regenerated from the two above (see *Generated files*) |
| `src/ExpressionParser.sh` | `src/App/ExpressionParser.sh` |
| `test/expr_library_test.cpp` | cases ported from `tests/src/App/Expression.cpp`, `tests/src/App/ExpressionParser.cpp`, `tests/src/Base/Quantity.cpp`, `tests/src/Base/Unit.cpp` |

**New files (part of the library, same licence)**: `include/forge_expr/Export.h`,
`include/forge_expr/Evaluator.h`, `src/Evaluator.cpp`, `CMakeLists.txt`,
`build_forge_expr.sh`, this file.

**Removed dependencies.** The library depends on the C++20 standard library only.
Removed: the FreeCAD `App` document/object model (`DocumentObject`, `Document`,
`ObjectIdentifier`, `Property*`, `PropertyExpressionEngine`, links), the Python
interpreter and PyCXX (`Py::Object`, `QuantityPy`, `VectorPy`, `MatrixPy`,
`PlacementPy`, `RotationPy`), `Base::BaseClass` and its type system, `boost::any`,
`boost::io`, `boost::math`, `{fmt}`, Qt (`ExpressionTokenizer` is not included),
`UnitsApi` / `UnitsSchema` user-string formatting, and the separate `Quantity.y` /
`Quantity.l` parser. It includes no OpenCASCADE header, no Qt header, no Coin3D
header and no Python header.

**Behaviour changed**

1. *Evaluation without Python.* Upstream evaluated through Python objects and
   Python's number protocol. Here `Expression::getValue(const SymbolTable&)`
   returns `forge::expr::Value` (a `Quantity` or a text) and the operators apply
   the same `Quantity` rules `QuantityPy` applied: `+`/`-` between different units
   still throw *Unit mismatch*, `<`/`>` between different units still throw, and
   `==`/`!=` compare value and unit.
2. *Names are resolved by the host.* A variable is a dotted string (`wall`,
   `Hole3.dia`); its value comes from the `SymbolTable` passed to evaluation. There
   is no owner object.
3. *Refusals added where upstream produced a wrong or meaningless number:*
   division or remainder by zero; any result that is not a finite number
   (`sqrt(-1)`, `log(0)`); `%` and `mod()` between different units (upstream kept
   the left unit and ignored the right); `pow()` with a non-integral exponent just
   below an integer (upstream's test `exponent - round(exponent) < 1e-9` accepted
   `pow(4 mm; 2.5)`).
4. *Unit of a fractional power corrected.* `Quantity::pow(const Quantity&)` cast the
   exponent to `signed char` before applying it to the unit, so `(4 mm^2) ^ 0.5` was
   the dimensionless number 2. It is now 2 mm, and a power that would leave a
   fractional unit exponent is refused by `Unit::pow`.
5. *Lexer.* An unrecognised character was echoed to standard output and skipped by
   flex's default rule (`2~` parsed as `2`); it is now a parse error naming the
   character. A number too large or with too many digits is a parse error instead
   of an exception thrown through the parser (upstream leaked the partial tree), or,
   for over-long digit strings, instead of silently becoming 0. Carriage return is
   whitespace.
6. *Parser.* The grammar, tokens and precedence are upstream's, with one added token
   (`LEXERROR`) that no rule accepts. Semantic actions build Forge types. A call to an
   unknown function or with the wrong argument count raises `YYERROR` from the
   action rather than throwing from a constructor inside the parser, so bison's own
   `%destructor` cleanup runs. `YYMAXDEPTH` is 1000. Parser entry points hold a mutex
   (the parser state is file-static, as upstream).
7. *Functions not supported.* `vector`, `matrix`, `placement`, `rotation*`,
   `create`, `list`, `tuple`, `translationm`, every `v*` vector and `m*` matrix
   function, and `hiddenref`/`href` are not registered, so they are parse errors
   naming the function. Upstream's `hiddenref` existed to hide a dependency from the
   document's cycle check. Indexing (`a[0]`, `a.x`), spreadsheet cell ranges
   (`A1:B3`) and `None` parse and refuse to evaluate, naming what was refused.
   `parsequant()` parses its text with the expression grammar.
8. *Evaluation depth.* Nesting deeper than 512 evaluation frames refuses; input
   longer than 2048 characters refuses before parsing.
9. *Boundary.* `forge_expr/Evaluator.h` (new) is a `noexcept` API: every failure is
   returned as a sentence, never thrown. Messages no longer lead with the C++ member
   that threw.
10. *Names.* `forge::expr::isValidName` (new) accepts a single identifier token that
    is not a unit, constant or function name and contains no `@`.
11. *Namespaces and export.* `Base::` and `App::` became `forge::expr::`;
    `BaseExport`/`AppExport` became `FORGE_EXPR_EXPORT`, and the library is built with
    hidden visibility so only the declared API is exported.

**Generated files.** `Expression.tab.c` / `Expression.tab.h` were produced by GNU
Bison 3.8.2 and `Expression.lex.c` by flex 2.6.4 (Apple build), both with line
directives disabled, by `src/ExpressionParser.sh`. As a check on the toolchain, the
same bison run on the *unmodified* upstream `Expression.y` reproduced upstream's
committed `Expression.tab.c` byte-for-byte apart from its leading comment line.

## Obtaining the source

This directory is the complete corresponding source of `libforge_expr`, including
the scripts used to build it (`CMakeLists.txt`, `build_forge_expr.sh`) and to
regenerate the parser (`src/ExpressionParser.sh`). To relink Forge against a
modified build, build the library with either script and replace
`Forge.app/Contents/Frameworks/libforge_expr.dylib`; Forge loads it through
`@rpath/libforge_expr.dylib` and uses only the API declared in `include/forge_expr/`.
