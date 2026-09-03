#!/usr/bin/env python3
"""Evaluate a GitHub Actions `if:` expression of the shape this workflow uses.

Deliberately NOT a general evaluator. It handles exactly `A == 'lit'`,
`A != 'lit'` and `&&`, and it REFUSES anything else rather than guessing --
a permissive evaluator that silently mis-reads an operator would report the
opposite of the truth about which steps run, which is the whole question.

  eval_if.py "<expr>" ctx.json     -> prints true/false, exit 0
"""
import json, re, sys

expr, ctxf = sys.argv[1], sys.argv[2]
ctx = json.load(open(ctxf))
if not expr.strip():
    print("true"); sys.exit(0)

parts = [p.strip() for p in expr.split("&&")]
result = True
for p in parts:
    m = re.match(r"^([A-Za-z_][\w.]*)\s*(==|!=)\s*'([^']*)'$", p)
    if not m:
        sys.stderr.write("eval_if.py: unsupported clause %r -- refusing to guess\n" % p)
        sys.exit(3)
    name, op, lit = m.groups()
    if name not in ctx:
        sys.stderr.write("eval_if.py: no value for %r in the context -- refusing to guess\n" % name)
        sys.exit(3)
    v = ctx[name]
    result = result and ((v == lit) if op == "==" else (v != lit))
print("true" if result else "false")
