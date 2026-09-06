#!/usr/bin/env python3
"""Extract ONE step's `if:` or `run:` body out of desktop-release.yml.

The point of extracting rather than retyping: a selftest that restates the shell
it is guarding proves only that someone typed it twice. Everything this harness
executes is the workflow's OWN text, dedented and with the `${{ }}` expressions
replaced from a table that must cover every expression present -- an unknown one
is a hard error, so a workflow edit cannot be silently rehearsed with stale
substitutions.

  extract_step.py <workflow.yml> <step-id> run|if [--subst NAME=SHELLVAR]...
"""
import re, sys

# `${{ x }}` -> shell text. Anything not listed is a hard error.
DEFAULT_SUBST = {
    "github.sha":                  "${GITHUB_SHA}",
    "github.repository":           "${GITHUB_REPOSITORY}",
    "github.token":                "${GH_TOKEN}",
    "steps.ver.outputs.version":   "${SIM_VERSION}",
    "steps.ver.outputs.tag":       "${SIM_TAG}",
    "steps.ver.outputs.mode":      "${SIM_MODE}",
    "steps.notes.outputs.notes":   "${SIM_NOTES}",
    "steps.publish.outputs.state": "${SIM_PUBLISH_STATE}",
    "steps.kgate.outputs.gate":    "${SIM_KGATE}",
}

def steps(path):
    lines = open(path, encoding="utf-8").read().split("\n")
    out, i = [], 0
    while i < len(lines):
        if re.match(r"^      - (name|uses|id):", lines[i]):
            block = [lines[i]]
            j = i + 1
            while j < len(lines) and not re.match(r"^      - ", lines[j]) and not re.match(r"^  \S", lines[j]):
                block.append(lines[j]); j += 1
            out.append(block); i = j; continue
        i += 1
    return out

def step_id(block):
    for ln in block:
        m = re.match(r"^        id:\s*(\S+)\s*$", ln)
        if m: return m.group(1)
    return None

def key_block(block, key):
    """Return the text of `key:` -- either a `|`/`>-` block scalar or a folded
    multi-line plain scalar (which is how `if: >-` is written here)."""
    for n, ln in enumerate(block):
        m = re.match(r"^        %s:\s*(\|-?|>-?|)\s*$" % key, ln)
        if m:
            body, indent = [], None
            for ln2 in block[n + 1:]:
                if ln2.strip() == "":
                    body.append(""); continue
                cur = len(ln2) - len(ln2.lstrip())
                if cur <= 8: break
                if indent is None: indent = cur
                body.append(ln2[indent:] if len(ln2) >= indent else ln2.lstrip())
            while body and body[-1] == "": body.pop()
            style = m.group(1)
            if style.startswith(">"):
                return " ".join(x.strip() for x in body if x.strip())
            return "\n".join(body)
        m = re.match(r"^        %s:\s+(\S.*)$" % key, ln)
        if m:
            return m.group(1).strip()
    return None

def substitute(text, extra):
    table = dict(DEFAULT_SUBST); table.update(extra)
    unknown = []
    def repl(m):
        k = m.group(1).strip()
        if k not in table:
            unknown.append(k); return m.group(0)
        return table[k]
    out = re.sub(r"\$\{\{\s*([^}]*?)\s*\}\}", repl, text)
    if unknown:
        sys.stderr.write(
            "extract_step.py: the workflow uses expression(s) this harness has no\n"
            "substitution for, so it cannot honestly rehearse the step:\n  "
            + "\n  ".join(sorted(set(unknown))) + "\n"
            "Add them to DEFAULT_SUBST (or pass --subst) rather than deleting this check.\n")
        sys.exit(3)
    return out

def main():
    wf, want, key = sys.argv[1], sys.argv[2], sys.argv[3]
    extra = {}
    for a in sys.argv[4:]:
        if a.startswith("--subst="):
            k, v = a[len("--subst="):].split("=", 1); extra[k] = v
    for b in steps(wf):
        if step_id(b) == want:
            t = key_block(b, key)
            if t is None:
                sys.stderr.write("extract_step.py: step '%s' has no '%s:'\n" % (want, key)); sys.exit(2)
            sys.stdout.write(substitute(t, extra))
            if key == "run": sys.stdout.write("\n")
            return
    sys.stderr.write("extract_step.py: no step with id '%s' in %s\n" % (want, wf)); sys.exit(2)

main()
