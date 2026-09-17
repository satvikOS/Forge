#!/usr/bin/env sh
# SPDX-License-Identifier: LGPL-2.1-or-later
#
# MODIFIED for libforge_expr (2026-09-15) from FreeCAD src/App/ExpressionParser.sh
# at commit 0a45a0a008d4af7a85601016c5ab31bd26c25b22. See MODIFICATIONS.md.
#
# Regenerates Expression.tab.c / Expression.tab.h (GNU Bison 3.8.2) and
# Expression.lex.c (flex 2.6.4) from Expression.y / Expression.l.
#
# The generated files are COMMITTED, as they are upstream, so building the library
# needs neither tool. Changes from upstream's script:
#   * -l / -L: no #line directives, so the output does not embed a machine path
#   * the tool versions are CHECKED, not assumed: the committed output was produced
#     by exactly these versions, and running an older bison (macOS ships 2.3, which
#     cannot read %precedence) must fail loudly rather than write something else
#   * BISON / FLEX may name the tools explicitly
#   * the SPDX line is prepended to each generated file, as upstream's are
#
# PROOF THE TOOLCHAIN IS FAITHFUL (recorded 2026-09-15): running this bison with
# -l on FreeCAD's UNMODIFIED Expression.y reproduces upstream's committed
# Expression.tab.c byte-for-byte apart from its leading clang-format comment.
set -eu

BISON="${BISON:-bison}"
FLEX="${FLEX:-flex}"

cd "$(dirname "$0")"

bver="$("$BISON" --version | head -1)"
case "$bver" in
  *"3.8.2"*) ;;
  *) echo "ExpressionParser.sh: need GNU Bison 3.8.2, found: $bver" >&2; exit 2 ;;
esac
fver="$("$FLEX" --version | head -1)"
case "$fver" in
  *"2.6.4"*) ;;
  *) echo "ExpressionParser.sh: need flex 2.6.4, found: $fver" >&2; exit 2 ;;
esac

"$FLEX" -L -oExpression.lex.c Expression.l
"$BISON" -l -d -Wall -oExpression.tab.c Expression.y

for f in Expression.lex.c Expression.tab.c Expression.tab.h; do
  { printf '%s\n\n%s\n' '// SPDX-License-Identifier: LGPL-2.1-or-later' '// clang-format off'; cat "$f"; } > "$f.tmp"
  mv "$f.tmp" "$f"
done
echo "regenerated Expression.lex.c Expression.tab.c Expression.tab.h"
