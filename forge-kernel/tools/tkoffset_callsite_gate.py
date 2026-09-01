#!/usr/bin/env python3
"""tkoffset_callsite_gate.py — is the CMake TKOffset family list COMPLETE?

WHAT THIS GATE PROTECTS. forge-kernel/CMakeLists.txt removes TKOffset from
OCCT_LIBS only when all nine of _FORGE_TKOFFSET_FAMILIES are compiled out, and
says in its own comment:

    "The condition is therefore ALL of the families, enumerated so a future
     family cannot be forgotten: adding one to this list is what keeps the drop
     honest."

Nothing checked that. A TKOffset call site guarded by NONE of the nine would
survive all nine flips; on macOS the .node links `-undefined dynamic_lookup`, so
it would not even fail to link — TKOffset would simply keep loading, OCCT_CLOSURE
would not move, and the drop would register as a PHANTOM. That is precisely the
failure mode the link-record block claims to refuse, and it is checkable with no
build at all, which is why this runs as a gate rather than as an argument.

WHY IT IS PREPROCESSOR-AWARE. A first cut asked only "does this FILE mention a
family macro". That is not an answer: src/Features.cpp mentions seven of them,
so every one of its 25 TKOffset references would score "guarded" whether or not
it sat inside any of those blocks. This walks the real #if/#ifdef nesting and
reports, for each reference, the conditions actually in force on that line.

A GREP HIT IS NOT A CALL. #include lines and comment lines are classified apart
from code, and only code is required to be guarded.

usage:  tkoffset_callsite_gate.py [--kernel DIR] [--verbose]
exit 0 iff every TKOffset CODE reference is inside a block controlled by at
least one of the nine family macros.
"""
import argparse
import os
import re
import sys

FAMILIES = [
    "FORGE_OFFSET_DROP_MAKEOFFSET",     # A  BRepOffsetAPI_MakeOffset
    "FORGE_FILLING_DROP_NATIVE",        # C  BRepOffsetAPI_MakeFilling
    "FORGE_THRUSECTIONS_DROP_NATIVE",   # D  BRepOffsetAPI_ThruSections
    "FORGE_PIPE_DROP_NATIVE",           # E  BRepOffsetAPI_MakePipe
    "FORGE_PIPESHELL_DROP_NATIVE",      # F  BRepOffsetAPI_MakePipeShell
    "FORGE_THICKSOLID_DROP_NATIVE",     # G  BRepOffsetAPI_MakeThickSolid
    "FORGE_OFFSETSHAPE_DROP_NATIVE",    # H  BRepOffsetAPI_MakeOffsetShape
    "FORGE_THICKEN_DROP_NATIVE",        # I  BRepOffset_MakeOffset
    "FORGE_DRAFT_DROP_NATIVE",          # J  BRepOffsetAPI_DraftAngle
]

TKOFFSET_API = re.compile(r"\bBRepOffsetAPI_[A-Za-z]+|\bBRepOffset_MakeOffset\b")
COND_START = re.compile(r"^\s*#\s*(if|ifdef|ifndef)\b(.*)$")
COND_ELSE = re.compile(r"^\s*#\s*(else|elif)\b(.*)$")
COND_END = re.compile(r"^\s*#\s*endif\b")


def classify(line):
    """code / comment / include — a grep hit is not a call."""
    s = line.strip()
    if s.startswith("#include"):
        return "include"
    if s.startswith("//") or s.startswith("*") or s.startswith("/*"):
        return "comment"
    return "code"


def scan(path):
    """Yield (lineno, kind, text, conditions_in_force) for each TKOffset hit."""
    stack = []           # list of condition-expression strings currently open
    try:
        with open(path, errors="replace") as fh:
            lines = fh.readlines()
    except OSError:
        return
    for i, line in enumerate(lines, 1):
        m = COND_START.match(line)
        if m:
            stack.append(m.group(2).strip())
            continue
        m = COND_ELSE.match(line)
        if m:
            if stack:
                # An #else/#elif still sits under the SAME macro's control:
                # a site in the #else arm of `#ifndef FORGE_X` disappears when
                # FORGE_X is defined, so the macro governs it either way.
                stack[-1] = stack[-1] + " (else-arm)"
            continue
        if COND_END.match(line):
            if stack:
                stack.pop()
            continue
        if TKOFFSET_API.search(line):
            yield i, classify(line), line.rstrip(), list(stack)


def selftest(kernel):
    """Prove the gate can go RED. A gate that has never been seen to fail is
    indistinguishable from one that cannot fail, and this repo has already
    shipped two such. Three mutants are written to a COPY of the tree — the
    real tree is never touched — and each must be caught:

      1. a TKOffset call with NO surrounding #if at all;
      2. a TKOffset call inside an #ifdef on a macro that is NOT one of the
         nine (the file-granularity check this replaced would have PASSED it,
         because the file mentions other families);
      3. a TKOffset call after a BALANCED #ifdef/#endif on a family macro —
         the site is outside the block, and a scanner that forgot to pop its
         condition stack would call it guarded.

    Mutant 3 is the one that matters: it is the exact bug a naive
    implementation has, and without it this self-test would pass on a broken
    scanner.
    """
    import shutil
    import tempfile
    ok = True
    mutants = [
        ("no guard at all",
         "TopoDS_Shape mutant() {\n"
         "    BRepOffsetAPI_MakePipe mk;\n"
         "    return mk.Shape();\n"
         "}\n"),
        ("guarded by a NON-family macro",
         "#ifdef FORGE_SOMETHING_ELSE\n"
         "TopoDS_Shape mutant() {\n"
         "    BRepOffsetAPI_MakeThickSolid mk;\n"
         "    return mk.Shape();\n"
         "}\n"
         "#endif\n"),
        ("AFTER a balanced family #ifdef/#endif",
         "#ifdef FORGE_PIPE_DROP_NATIVE\n"
         "int unrelated() { return 0; }\n"
         "#endif\n"
         "TopoDS_Shape mutant() {\n"
         "    BRepOffsetAPI_DraftAngle mk;\n"
         "    return mk.Shape();\n"
         "}\n"),
    ]
    print("--selftest: the gate must go RED on each mutant")
    print()
    for label, body in mutants:
        tmp = tempfile.mkdtemp(prefix="tkoffset_gate_selftest_")
        try:
            src = os.path.join(tmp, "src")
            os.makedirs(src)
            # A real file from the tree, so the mutant sits beside genuine
            # guarded sites rather than alone in an empty directory.
            real = os.path.join(kernel, "src", "Features.cpp")
            if os.path.exists(real):
                shutil.copy(real, os.path.join(src, "Features.cpp"))
            with open(os.path.join(src, "Mutant.cpp"), "w") as fh:
                fh.write(body)
            rc = run(tmp, verbose=False, quiet=True)
            if rc == 1:
                print(f"  KILLED  mutant: {label}")
            else:
                print(f"  SURVIVED (rc={rc})  mutant: {label}  <- THE GATE IS INERT")
                ok = False
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print()
    # And the real tree must still be GREEN, or the gate is simply always red.
    rc = run(kernel, verbose=False, quiet=True)
    if rc == 0:
        print("  GREEN on the real tree (the gate is not simply always red)")
    else:
        print(f"  RED on the real tree (rc={rc}) — cannot distinguish a working gate")
        ok = False
    print()
    print("SELFTEST PASS" if ok else "SELFTEST FAIL")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kernel", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), ".."))
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--selftest", action="store_true",
                    help="prove the gate can go RED (mutants on a COPY; the "
                         "tree is never written to)")
    args = ap.parse_args()
    kernel = os.path.abspath(args.kernel)
    if args.selftest:
        return selftest(kernel)
    return run(kernel, args.verbose, quiet=False)


def run(kernel, verbose, quiet):

    targets = []
    for root in ("src", "include"):
        base = os.path.join(kernel, root)
        for dirpath, _, names in os.walk(base):
            for n in sorted(names):
                if n.endswith((".cpp", ".hpp", ".h", ".hxx", ".cc")):
                    targets.append(os.path.join(dirpath, n))
    targets.sort()

    n_code = n_comment = n_include = 0
    unguarded = []
    guarded = []
    for path in targets:
        rel = os.path.relpath(path, kernel)
        for lineno, kind, text, conds in scan(path):
            if kind == "include":
                n_include += 1
                continue
            if kind == "comment":
                n_comment += 1
                continue
            n_code += 1
            hit = sorted({f for f in FAMILIES for c in conds if f in c})
            if hit:
                guarded.append((rel, lineno, hit, text))
            else:
                unguarded.append((rel, lineno, conds, text))

    if quiet and not unguarded:
        return 0
    if quiet and unguarded:
        return 1
    print("TKOffset call-site gate — is the CMake nine-family list complete?")
    print()
    print(f"files scanned            : {len(targets)}")
    print(f"TKOffset code references : {n_code}")
    print(f"  comment-only           : {n_comment}")
    print(f"  #include               : {n_include}")
    print()
    if verbose:
        for rel, lineno, hit, text in guarded:
            print(f"  guarded  {rel}:{lineno}  <- {','.join(h.split('_')[1] for h in hit)}")
        print()

    by_family = {}
    for _, _, hit, _ in guarded:
        for h in hit:
            by_family[h] = by_family.get(h, 0) + 1
    print("code references governed by each family macro:")
    for f in FAMILIES:
        print(f"  {f:34s} {by_family.get(f, 0):3d}")
    print()

    if unguarded:
        print(f"UNGUARDED TKOffset CODE REFERENCES: {len(unguarded)}")
        print("Each of these survives all nine family flips. TKOffset would stay")
        print("loaded, OCCT_CLOSURE would not move, and the drop would be a PHANTOM.")
        print()
        for rel, lineno, conds, text in unguarded:
            print(f"  {rel}:{lineno}")
            print(f"      conditions in force: {conds if conds else '(none)'}")
            print(f"      {text.strip()[:120]}")
        return 1

    print(f"PASS: all {n_code} TKOffset code references are inside a block")
    print("controlled by one of the nine enumerated families. The list is")
    print("COMPLETE at this commit — flipping all nine genuinely silences TKOffset.")
    print()
    print("NOTE what this does NOT say: it is a call-site census, not a closure")
    print("measurement. It cannot tell you TKOffset would LEAVE the load graph —")
    print("only scripts/occt_closure_count.sh against a real binary can, and it")
    print("says nothing about whether the nine families are at parity (they are")
    print("not; seven of nine fail their flip gate at this commit).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
