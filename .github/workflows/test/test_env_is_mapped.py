#!/usr/bin/env python3
"""Every FORGE_* variable a `run:` block READS must actually reach the shell.

A GitHub repository variable is reachable ONLY through the `vars` context. It is
not exported into a step's environment. So a shell that reads
`${FORGE_FIRST_RELEASE_APPROVED:-}` without a matching `env:` entry does not read
the variable the owner set -- it reads the empty string, and `:-` supplies a
plausible default with no error anywhere. That turns an owner-controlled switch
into a valve nobody can open, whose log blames the owner for not opening it.

MEASURED 2026-09-11: exactly that shipped in desktop-release.yml, in a gate whose
purpose was to keep an irreversible publish behind an owner decision.
"""
import re, sys, os

WF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

def steps_of(text):
    """(start,end) spans of every `run: |` block, with the env mapped for each."""
    out = []
    for m in re.finditer(r"^(\s*)run: \|\s*$", text, re.M):
        indent = len(m.group(1))
        start = m.end()
        end = len(text)
        for line in re.finditer(r"^(\s*)\S", text[start:], re.M):
            if len(line.group(1)) <= indent:
                end = start + line.start(); break
        out.append((start, end, indent))
    return out

def mapped_names(text):
    """every NAME: appearing under any env: block, anywhere in the file"""
    names = set()
    for m in re.finditer(r"^(\s*)env:\s*$", text, re.M):
        indent = len(m.group(1))
        for line in text[m.end():].splitlines():
            if not line.strip() or line.strip().startswith("#"):
                continue
            ind = len(line) - len(line.lstrip())
            if ind <= indent:
                break
            k = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\s*:", line.strip())
            if k:
                names.add(k.group(1))
    return names

def main():
    fails = 0
    checked = 0
    for fn in sorted(os.listdir(WF)):
        if not fn.endswith((".yml", ".yaml")):
            continue
        path = os.path.join(WF, fn)
        text = open(path).read()
        env = mapped_names(text)
        for start, end, _ in steps_of(text):
            body = text[start:end]
            # names ASSIGNED inside the block are fine
            assigned = set(re.findall(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=", body, re.M))
            assigned |= set(re.findall(r"([A-Za-z_][A-Za-z0-9_]*)=\$\(", body))
            for m in re.finditer(r"\$\{?(FORGE_[A-Z0-9_]+)", body):
                name = m.group(1)
                checked += 1
                if name in env or name in assigned:
                    continue
                line_no = text[:start + m.start()].count("\n") + 1
                print(f"  FAIL {fn}:{line_no} reads ${name} but nothing maps it into the shell")
                print(f"       a repo variable needs an env entry: {name}: ${{{{ vars.{name} }}}}")
                fails += 1
    print(f"\n  {checked} FORGE_* reads checked, {fails} unmapped")
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main())
