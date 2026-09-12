#!/usr/bin/env python3
# ft_swallow_scan.py -- find a catch block that answers with what it was HANDED.
#
# THE DEFECT. An op handler wraps its kernel call in `try { ... } catch (...) {
# return body; }`. The kernel failed, the handler returned its own input, and the
# compiler recorded a COMPILED feature. Volume cannot see it: the no-op's volume
# IS its input's.
#
# WHY THIS FILE EXISTS AT ALL. The first instrument was three lines of awk:
#
#     /catch[[:space:]]*\([[:space:]]*\.\.\.[[:space:]]*\)/ { armed = 3; next }
#     armed > 0 { if ($0 ~ /return[[:space:]]+(body|surf|shape|target|input)[[:space:]]*;/) ... }
#
# MEASURED against five re-injections of the SAME defect, it caught ONE:
#
#   A  catch (...) {\n return surf;\n }            CAUGHT
#   B  catch (...) { return surf; }   (one line)   EVADED -- `next` skips the
#                                                  catch line, body is ON it
#   C  two comment lines, then return surf;        EVADED -- past the 3-line window
#   D  catch (const std::exception&)               EVADED -- only `...` was armed
#   E  Handle out = surf; return out;              EVADED -- name not in the list
#
# A check that fires on a `git revert` and on nothing else certifies the hole it
# leaves. This scanner is brace-balanced instead: it finds EVERY catch clause of
# every kind, takes its whole block however long, and flags any `return` whose
# expression is a value ALREADY IN HAND -- a bare name, a member access, a deref
# -- as opposed to a fresh kernel call or a throw. Shapes A..E all land.
#
# It is still a SOURCE check and still weaker than executing the op. It is here
# because four of the sites it covers have no IR fixture in this tree that makes
# their kernel call raise, so execution cannot reach them at all.
#
# A deliberate exception is marked in the source with `SWALLOW-OK: <reason>` on
# the return line or the line above it, and is reported as an allowance rather
# than silently skipped.
import re
import sys

MARKER = "SWALLOW-OK"

# A value already in hand: a name, a member/arrow chain, an optional deref or
# address-of, optional parens. NOT a call -- `return forge::cut(a,b);` is a fresh
# kernel result, which is the whole point of the distinction.
IN_HAND = re.compile(r"^[*&(\s]*[A-Za-z_]\w*(\s*(\.|->|::)\s*[A-Za-z_]\w*)*[)\s]*$")


def blank_noncode(text):
    """Replace comments and literals with spaces, preserving every offset so line
    numbers and brace balance stay true."""
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                out[i] = " "
                i += 1
        elif c == "/" and i + 1 < n and text[i + 1] == "*":
            out[i] = out[i + 1] = " "
            i += 2
            while i < n and not (text[i] == "*" and i + 1 < n and text[i + 1] == "/"):
                if text[i] != "\n":
                    out[i] = " "
                i += 1
            if i < n:
                out[i] = " "
                if i + 1 < n:
                    out[i + 1] = " "
                i += 2
        elif c in "\"'":
            quote = c
            out[i] = " "
            i += 1
            while i < n and text[i] != quote:
                if text[i] == "\\":
                    out[i] = " "
                    i += 1
                if i < n and text[i] != "\n":
                    out[i] = " "
                i += 1
            if i < n:
                out[i] = " "
                i += 1
        else:
            i += 1
    return "".join(out)


def balanced(code, i, open_ch, close_ch):
    """Index just past the block that opens at code[i] == open_ch."""
    depth = 0
    while i < len(code):
        if code[i] == open_ch:
            depth += 1
        elif code[i] == close_ch:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise SystemExit("unbalanced %s at offset %d" % (open_ch, i))


def scan(path):
    raw = open(path, encoding="utf-8").read()
    code = blank_noncode(raw)
    raw_lines = raw.splitlines()
    hits, allowed = [], []
    for m in re.finditer(r"\bcatch\s*\(", code):
        close = balanced(code, m.end() - 1, "(", ")")
        brace = code.find("{", close)
        if brace == -1 or code[close:brace].strip():
            continue                       # `catch (...) ;` or a declaration
        end = balanced(code, brace, "{", "}")
        block = code[brace:end]
        for r in re.finditer(r"\breturn\b([^;]*);", block):
            expr = r.group(1).strip()
            if not expr or not IN_HAND.match(expr):
                continue                   # `return;`, a call, an expression
            line = code.count("\n", 0, brace + r.start()) + 1
            ctx = "\n".join(raw_lines[max(0, line - 2):line])
            rec = (line, raw_lines[line - 1].strip(), expr)
            (allowed if MARKER in ctx else hits).append(rec)
    return hits, allowed


def main(argv):
    if len(argv) != 2:
        print("usage: ft_swallow_scan.py <file.cpp>", file=sys.stderr)
        return 2
    hits, allowed = scan(argv[1])
    for line, text, expr in allowed:
        print("  allow %s:%d returns `%s` (%s)" % (argv[1], line, expr, MARKER))
    for line, text, expr in hits:
        print("  %s:%d  %s" % (argv[1], line, text))
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
