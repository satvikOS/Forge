#!/usr/bin/env python3
# ============================================================================
# gen_archie_op_vocabulary.py -- DERIVE Archie's legal emission vocabulary from
# the Forge sources, and gate the committed JSON against drift.
#
# WHY THIS EXISTS
#   Archie may only emit feature-tree IR that a HUMAN USER of the Forge app can
#   also produce. The app's user-facing surface is the forge::ui command
#   registry (menus, ribbon, palette, radial menu and the Archie tools panel all
#   render from it -- forge-desktop/src/ForgeFrame.cpp), so "what a user can do"
#   is exactly "what a registered command emits". The kernel accepts far more
#   ops than any command emits; training on the kernel's table would teach
#   Archie an API the product does not expose.
#
# HOW IT STAYS TRUE
#   Nothing below is transcribed by hand. Every op name, argument name, default,
#   arity, parameter schema, selection signature and enabled predicate is READ
#   OUT OF THE SOURCE FILES listed in SOURCES. The parser is deliberately
#   BRITTLE: an unrecognised construct raises instead of being skipped, because
#   a vocabulary that silently drops an op is worse than one that fails to
#   build. Content hashes of every source file are recorded in the JSON, so
#   --check fails the moment a source moves and the JSON does not.
#
# USAGE
#   python3 implementation/sacrosanct/tools/gen_archie_op_vocabulary.py --write
#   python3 implementation/sacrosanct/tools/gen_archie_op_vocabulary.py --check
#
# The two curated layers -- UNIT_RULES and OP_ARG_OVERRIDES -- are the ONLY
# judgement in this file. Both are validated against the parsed source (an
# override naming an argument the source does not have is a hard error), and any
# argument they fail to classify lands in the JSON's "uncertain" list rather
# than being guessed.
# ============================================================================
import argparse
import difflib
import hashlib
import json
import os
import re
import sys

VERSION = "1.0.0"
SCHEMA = "forge.archie.op_vocabulary/1"

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
OUT_REL = "implementation/sacrosanct/archie_op_vocabulary.json"
GEN_REL = "implementation/sacrosanct/tools/gen_archie_op_vocabulary.py"

SOURCES = {
    "kernel_header": "forge-kernel/include/forge/ft/FeatureTree.hpp",
    "kernel_compiler": "forge-kernel/src/ft/FeatureTreeCompiler.cpp",
    "kernel_cmake": "forge-kernel/CMakeLists.txt",
    "ui_ir_table": "ui/src/FeatureIr.cpp",
    "ui_part_commands": "ui/src/PartCommands.cpp",
    "ui_shell_commands": "ui/src/ForgeShell.cpp",
    "desktop_frame": "forge-desktop/src/ForgeFrame.cpp",
    "ir_doc": "forge-kernel/docs/feature_tree_ir.md",
}


class DeriveError(RuntimeError):
    """A construct the parser does not understand. Never swallowed."""


def read(rel):
    with open(os.path.join(REPO, rel), "rb") as fh:
        return fh.read().decode("utf-8")


def hash_of(rel):
    with open(os.path.join(REPO, rel), "rb") as fh:
        raw = fh.read()
    return {"path": rel, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
            "lines": raw.decode("utf-8").count("\n")}


def block_after(text, start_pat, start_at=0):
    """Text inside the brace-balanced block that follows the first match of start_pat."""
    m = re.search(start_pat, text[start_at:])
    if not m:
        raise DeriveError("pattern not found: %s" % start_pat)
    i = text.index("{", start_at + m.start())
    depth = 0
    j = i
    in_str = False
    while j < len(text):
        c = text[j]
        if in_str:
            if c == "\\":
                j += 2
                continue
            if c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[i + 1:j], i + 1, j
        j += 1
    raise DeriveError("unbalanced block after %s" % start_pat)


def balanced(text, i, open_ch="(", close_ch=")"):
    """text[i] must be open_ch; return (inner_text, index_of_close)."""
    if text[i] != open_ch:
        raise DeriveError("expected %r at %d, saw %r" % (open_ch, i, text[i:i + 20]))
    depth = 0
    j = i
    in_str = False
    while j < len(text):
        c = text[j]
        if in_str:
            if c == "\\":
                j += 2
                continue
            if c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return text[i + 1:j], j
        j += 1
    raise DeriveError("unbalanced %s from %d" % (open_ch, i))


def squash(s):
    return re.sub(r"\s+", " ", s).strip()


def strip_comments(text):
    """Remove // comments (no /* */ appears in the blocks this parser reads)."""
    out = []
    for line in text.split("\n"):
        k = line.find("//")
        while k != -1 and line[:k].count('"') % 2 == 1:
            k = line.find("//", k + 1)
        out.append(line if k == -1 else line[:k])
    return "\n".join(out)


# ---------------------------------------------------------------------------
# 1. the kernel op set: enum OpCode (signatures) + opFromName (spellings)
# ---------------------------------------------------------------------------
SECTION_RE = re.compile(r"^-{2,}\s*(.*?)\s*-{2,}$")


def parse_kernel_opcodes(hpp):
    body, _, _ = block_after(hpp, r"enum class OpCode\s*")
    ops = []
    gated = 0
    section = None
    section_kind = None
    trailing = []          # comment lines seen since the last enumerator

    def flush():
        # Comment lines that FOLLOW an enumerator are its continuation notes.
        if ops:
            ops[-1]["notes"].extend(trailing)
        del trailing[:]

    for line in body.split("\n"):
        s = line.strip()
        sec = SECTION_RE.match(s[2:].strip()) if s.startswith("//") else None
        if sec:
            flush()
            section = sec.group(1)
            k = re.search(r"produce an? ([A-Z]+)", section)
            section_kind = k.group(1) if k else None
            continue
        if s.startswith("#ifdef FORGE_FT_ARCHELIX"):
            gated += 1
            continue
        if s.startswith("#endif"):
            gated = max(0, gated - 1)
            continue
        if s.startswith("#"):
            raise DeriveError("unhandled preprocessor line in OpCode: %s" % s)
        m = re.match(r"^([A-Za-z]\w*)\s*,\s*//\s*(.*)$", s)
        if m:
            flush()
            ops.append({"enum": m.group(1), "forms": [m.group(2).rstrip()],
                        "notes": [], "archelix_gated": gated > 0,
                        "section": section, "produces_kind": section_kind})
            continue
        m = re.match(r"^([A-Za-z]\w*)\s*,\s*$", s)
        if m:
            # Second documented style: the signature sits in the comment BLOCK
            # ABOVE the enumerator rather than on its line (the ARC/HELIX family
            # writes it that way). Take the last call form in that block; if the
            # pick is wrong, the enum-vs-opFromName cross-check in build() says so
            # by name rather than letting a wrong signature through.
            forms = [n for n in trailing if re.match(r"^[A-Z][A-Z0-9]*\s*\(", n)]
            if not forms:
                raise DeriveError("OpCode enumerator without a signature comment: %s" % s)
            ops.append({"enum": m.group(1), "forms": [forms[-1]],
                        "notes": [n for n in trailing if n not in forms],
                        "archelix_gated": gated > 0,
                        "section": section, "produces_kind": section_kind})
            trailing = []
            continue
        m = re.match(r"^//\s*(.*)$", s)
        if m:
            trailing.append(m.group(1).rstrip())
            continue
        if s == "":
            continue
        raise DeriveError("unparsed line in OpCode block: %r" % s)
    flush()
    # A continuation comment opening with `NAME(`, NAME == this op's own IR name,
    # is an ALTERNATE CALL FORM rather than prose (MIRROR, PATTERN, SWEEP).
    for op in ops:
        head = re.match(r"^([A-Z][A-Z0-9]*)\s*\(", op["forms"][0])
        if not head:
            raise DeriveError("no call form for enumerator %s: %r" % (op["enum"], op["forms"][0]))
        op["name"] = head.group(1)
        keep = []
        for note in op["notes"]:
            if re.match(r"^%s\s*\(" % re.escape(op["name"]), note):
                op["forms"].append(note)
            else:
                keep.append(note)
        op["notes"] = keep
    return ops


def parse_op_from_name(cpp):
    body, _, _ = block_after(cpp, r"OpCode\s+opFromName\s*\([^)]*\)\s*")
    tbl, _, _ = block_after(body, r"static const std::unordered_map<std::string, OpCode> tbl\s*=")
    out = {}
    gated = 0
    for line in tbl.split("\n"):
        s = line.strip()
        if s.startswith("#ifdef FORGE_FT_ARCHELIX"):
            gated += 1
            continue
        if s.startswith("#endif"):
            gated = max(0, gated - 1)
            continue
        if s.startswith("#"):
            raise DeriveError("unhandled preprocessor line in opFromName: %s" % s)
        for m in re.finditer(r'\{"([A-Z0-9_]+)"\s*,\s*OpCode::(\w+)\}', s):
            out[m.group(1)] = {"enum": m.group(2), "archelix_gated": gated > 0}
        leftover = re.sub(r'\{"[A-Z0-9_]+"\s*,\s*OpCode::\w+\}\s*,?', "", s).strip()
        if leftover and not leftover.startswith("//"):
            raise DeriveError("unparsed line in opFromName table: %r" % s)
    return out


# ---------------------------------------------------------------------------
# 2. the kernel signature grammar: one call form -> typed parameters
# ---------------------------------------------------------------------------
POINTS_RE = re.compile(r"\[\s*x\s+y(?:\s+z)?\s*;[^\]]*\]")


def parse_form(form):
    """'HOLE(%body, dia, cx [, axx=0])' -> (NAME, [param, ...], trailing_prose)."""
    head = re.match(r"^([A-Z][A-Z0-9]*)\s*\(", form)
    if not head:
        raise DeriveError("not a call form: %r" % form)
    name = head.group(1)
    inner, close = balanced(form, form.index("("))
    trailing = form[close + 1:].strip()

    holes = []

    def stash(m):
        holes.append(m.group(0))
        return "@PTS%d@" % (len(holes) - 1)

    inner = POINTS_RE.sub(stash, inner)

    # Optionality is the bracket depth at the argument's FIRST character, not at
    # the comma that ends it: in `RECT(w, h [, cx=0, cy=0])` the comma after `h`
    # sits inside the bracket while `h` itself does not.
    parts = []
    depth = 0
    cur = ""
    tok_depth = None
    for ch in inner:
        if ch == "[":
            depth += 1
            continue
        if ch == "]":
            depth -= 1
            if depth < 0:
                raise DeriveError("unbalanced ] in %r" % form)
            continue
        if ch == ",":
            parts.append((cur, 0 if tok_depth is None else tok_depth))
            cur = ""
            tok_depth = None
            continue
        if cur == "" and ch.isspace():
            continue
        if tok_depth is None:
            tok_depth = depth
        cur += ch
    parts.append((cur, 0 if tok_depth is None else tok_depth))
    if depth != 0:
        raise DeriveError("unbalanced [ in %r" % form)

    params = []
    for raw, d in parts:
        tok = raw.strip()
        if tok == "":
            continue
        for k, h in enumerate(holes):
            tok = tok.replace("@PTS%d@" % k, h)
        optional = d > 0
        variadic = tok.endswith("...")
        if variadic:
            tok = tok[:-3].strip()
            if tok == "":
                params[-1]["variadic"] = True
                continue
        p = {"optional": optional, "variadic": variadic}
        if tok.startswith("%"):
            p.update(token="ref", name=tok[1:])
        elif tok.startswith('"') and tok.endswith('"'):
            p.update(token="text", name=tok.strip('"'))
        elif POINTS_RE.match(tok):
            p.update(token="points", name="points",
                     dim=3 if len(tok.split(";")[0].split()) == 3 else 2)
        elif re.match(r"^[A-Z][A-Z0-9_]*$", tok):
            p.update(token="keyword", name=tok.lower(), keyword=tok)
        else:
            m = re.match(r"^(\w+)\s*=\s*(.+)$", tok)
            m2 = re.match(r"^(\w+)\s*(<=|>=|<|>)\s*([^=]+?)\s*=>\s*(.+)$", tok)
            if m2:
                p.update(token="number", name=m2.group(1),
                         note="%s %s %s => %s" % m2.groups())
            elif m:
                default = m.group(2).strip()
                if re.match(r"^[+-][XYZ]$", default):
                    # `axz=+Z` states the default of the whole AXIS TRIPLE, not of
                    # this one argument. Recorded verbatim and flagged rather than
                    # resolved into a number the header does not actually give.
                    p.update(token="number", name=m.group(1), default=default,
                             uncertain=True,
                             uncertain_reason="the header writes this default as the compound "
                                              "axis '%s', not as a per-argument number" % default)
                elif re.match(r"^[A-Z][A-Za-z0-9_]*$", default):
                    p.update(token="keyword", name=m.group(1), keyword_default=default)
                else:
                    p.update(token="number", name=m.group(1), default=default)
            elif re.match(r"^\w+$", tok):
                p.update(token="number", name=tok)
            else:
                raise DeriveError("unparsed argument %r in form %r" % (tok, form))
        params.append(p)
    return name, params, trailing


# ---------------------------------------------------------------------------
# 3. the forge::ui validator table (arity the UI enforces before emitting)
# ---------------------------------------------------------------------------
def parse_ui_op_table(cpp):
    body, _, _ = block_after(cpp, r"const std::vector<IrOpSpec>& irOpTable\(\)\s*")
    tbl, _, _ = block_after(body, r"static const std::vector<IrOpSpec> table\s*=")
    out = {}
    order = []
    for m in re.finditer(r'\{"([A-Z0-9_]+)"\s*,\s*(\w+)\s*,\s*([A-Za-z0-9_]+)\s*,\s*(true|false)\}', tbl):
        name, lo, hi, ref = m.groups()
        out[name] = {
            "min_args": int(lo),
            "max_args": None if hi == "kIrArgsUnbounded" else int(hi),
            "first_arg_is_value_ref": ref == "true",
        }
        order.append(name)
    if len(order) != len(set(order)):
        raise DeriveError("duplicate op in forge::ui irOpTable")
    return out


# ---------------------------------------------------------------------------
# 4. the forge::ui command registry (what a user can actually invoke)
# ---------------------------------------------------------------------------
ENTITY_RE = r"EntityKind::(\w+)"


def parse_signature_call(expr):
    m = re.match(r"SelectionSignature::none\(\)", expr)
    if m:
        return {"kind": "None", "min": 0, "max": None}
    m = re.match(r"SelectionSignature::exactly\(\s*" + ENTITY_RE + r"\s*,\s*(\d+)\s*\)", expr)
    if m:
        return {"kind": m.group(1), "min": int(m.group(2)), "max": int(m.group(2))}
    m = re.match(r"SelectionSignature::atLeast\(\s*" + ENTITY_RE + r"\s*,\s*(\d+)\s*\)", expr)
    if m:
        return {"kind": m.group(1), "min": int(m.group(2)), "max": None}
    m = re.match(r"SelectionSignature::range\(\s*" + ENTITY_RE + r"\s*,\s*(\d+)\s*,\s*(\d+)\s*\)", expr)
    if m:
        return {"kind": m.group(1), "min": int(m.group(2)), "max": int(m.group(3))}
    raise DeriveError("unparsed selection signature: %r" % expr)


def parse_param_specs(block):
    """Both ParamSpec spellings used in the tree: braced-positional and designated."""
    out = []
    for m in re.finditer(r"ParamSpec\s*\{", block):
        inner, _ = balanced(block, m.end() - 1, "{", "}")
        inner = squash(inner)
        spec = {"name": None, "type": None, "required": False, "default_number": 0.0,
                "default_text": "", "has_default": False}
        if inner.lstrip().startswith("."):
            for f in re.finditer(r"\.(\w+)\s*=\s*([^,]+?)(?:,|$)", inner):
                key, val = f.group(1), f.group(2).strip()
                if key == "name":
                    spec["name"] = val.strip('"')
                elif key == "type":
                    spec["type"] = val.split("::")[-1]
                elif key == "required":
                    spec["required"] = val == "true"
                elif key == "defaultNumber":
                    spec["default_number"] = float(val)
                elif key == "defaultText":
                    spec["default_text"] = val.strip('"')
                elif key == "hasDefault":
                    spec["has_default"] = val == "true"
                else:
                    raise DeriveError("unknown ParamSpec field %r" % key)
        else:
            fields = [f.strip() for f in inner.split(",")]
            if len(fields) != 5:
                raise DeriveError("positional ParamSpec with %d fields: %r" % (len(fields), inner))
            spec["name"] = fields[0].strip('"')
            spec["type"] = fields[1].split("::")[-1]
            spec["required"] = fields[2] == "true"
            spec["default_number"] = float(fields[3])
            spec["default_text"] = fields[4].strip('"')
            spec["has_default"] = False  # positional form stops before hasDefault
        if spec["name"] is None or spec["type"] is None:
            raise DeriveError("ParamSpec without a name or type: %r" % inner)
        out.append(spec)
    return out


IRARG_RE = re.compile(r"IrArg::(num|valueRef|keyword|text)\s*\(")


def split_statements(text):
    """Split a lambda body into statements at top-level ';'."""
    stmts = []
    depth_p = depth_b = 0
    cur = ""
    in_str = False
    i = 0
    while i < len(text):
        c = text[i]
        cur += c
        if in_str:
            if c == "\\":
                cur += text[i + 1]
                i += 2
                continue
            if c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c in "([":
            depth_p += 1
        elif c in ")]":
            depth_p -= 1
        elif c == "{":
            depth_b += 1
        elif c == "}":
            depth_b -= 1
            if depth_p == 0 and depth_b == 0:
                stmts.append(cur)
                cur = ""
        elif c == ";" and depth_p == 0 and depth_b == 0:
            stmts.append(cur)
            cur = ""
        i += 1
    if cur.strip():
        stmts.append(cur)
    return [s for s in stmts if s.strip()]


REF_ROLES = {
    "t.value": "target_solid",
    "profile": "profile",
    "id": "profile",
    "ids[0]": "target_solid",
    "ids[1]": "tool_solid",
}


def scan_emission(body, guard=""):
    """Ordered IR argument slots emitted by one command handler."""
    slots = []
    for stmt in split_statements(body):
        s = squash(strip_comments(stmt))
        cond = guard
        # a guarded scope: `if (c) { ... }`, `if (c) stmt;` or `for (x : y) { ... }`
        m = re.match(r"^(if|for)\s*\(", s)
        repeat = False
        if m:
            inner, close = balanced(s, s.index("("))
            cond_text = squash(inner)
            rest = s[close + 1:].strip()
            repeat = m.group(1) == "for"
            if not IRARG_RE.search(rest):
                if IRARG_RE.search(s):
                    raise DeriveError("IrArg inside a %s condition: %r" % (m.group(1), s))
                continue
            cond = ("%s and %s" % (guard, cond_text)) if guard else cond_text
            if rest.startswith("{"):
                rest, _ = balanced(rest, 0, "{", "}")
            for slot in scan_emission(rest, cond):
                slot["repeat"] = slot.get("repeat", False) or repeat
                slots.append(slot)
            continue
        if not IRARG_RE.search(s):
            continue
        calls = []
        for m in IRARG_RE.finditer(s):
            arg, close = balanced(s, m.end() - 1)
            calls.append({"kind": m.group(1), "expr": squash(arg), "at": m.start()})
        # `cond ? IrArg::keyword(x) : IrArg::text(x)` is ONE slot with two forms
        qmark = s.find("?")
        if qmark != -1 and len(calls) == 2 and calls[0]["at"] > qmark:
            ternary_cond = squash(s[s.index("push_back(") + len("push_back("):qmark]) if "push_back(" in s else squash(s[:qmark])
            slots.append({"alternatives": [slot_of(c) for c in calls],
                          "selects_on": ternary_cond, "condition": cond or "always",
                          "repeat": repeat})
            continue
        if qmark != -1 and len(calls) > 0 and any(c["at"] > qmark for c in calls):
            raise DeriveError("unhandled conditional expression around IrArg: %r" % s)
        for c in calls:
            slot = slot_of(c)
            slot["condition"] = cond or "always"
            slot["repeat"] = repeat
            slots.append(slot)
    return slots


def slot_of(call):
    kind, expr = call["kind"], call["expr"]
    if kind == "valueRef":
        role = REF_ROLES.get(expr)
        if role is None:
            raise DeriveError("unmapped value-ref expression %r" % expr)
        return {"token": "ref", "role": role}
    if kind == "num":
        m = re.match(r'^num\(ctx, "(\w+)", ([-\d.]+)\)$', expr)
        if m:
            return {"token": "number", "from_parameter": m.group(1),
                    "fallback": float(m.group(2))}
        if re.match(r"^-?[\d.]+$", expr):
            return {"token": "number", "literal": float(expr)}
        raise DeriveError("unparsed numeric argument %r" % expr)
    if kind == "keyword":
        m = re.match(r'^"([A-Z0-9_]+)"$', expr)
        if m:
            return {"token": "keyword", "literal": m.group(1)}
        m = re.match(r'^txt\(ctx, "(\w+)", "([^"]*)"\)$', expr)
        if m:
            return {"token": "keyword", "from_parameter": m.group(1), "fallback": m.group(2)}
        if re.match(r"^\w+$", expr):
            return {"token": "keyword", "from_local": expr}
        raise DeriveError("unparsed keyword argument %r" % expr)
    if kind == "text":
        if re.match(r"^\w+$", expr):
            return {"token": "text", "from_local": expr}
        raise DeriveError("unparsed text argument %r" % expr)
    raise DeriveError("unknown IrArg factory %r" % kind)


def parse_part_commands(cpp):
    src = strip_comments(cpp)
    fn, base_off, _ = block_after(src, r"std::size_t registerPartCommands\s*\([^)]*\)\s*")
    # the boolean family: one descriptor template driven by a small table
    bool_specs = []
    mb = re.search(r"const BoolSpec booleans\[\]\s*=", fn)
    if mb:
        tbl, _, _ = block_after(fn, r"const BoolSpec booleans\[\]\s*=")
        for m in re.finditer(r'\{"([\w.]+)"\s*,\s*"([^"]+)"\s*,\s*"([A-Z]+)"\}', tbl):
            bool_specs.append({"id": m.group(1), "label": m.group(2), "op": m.group(3)})

    cmds = []
    for m in re.finditer(r"CommandDescriptor c = base\(", fn):
        args, close = balanced(fn, m.end() - 1)
        end = fn.index("add(std::move(c));", close)
        block = fn[close + 1:end]
        parts = [p.strip() for p in split_top(args)]
        if len(parts) != 4:
            raise DeriveError("base() with %d arguments: %r" % (len(parts), args))
        ids = [parts[0].strip('"')]
        labels = [parts[1].strip('"')]
        ops = [parts[2].strip('"')]
        if parts[0] == "b.id":
            if not bool_specs:
                raise DeriveError("templated base() with no BoolSpec table")
            ids = [b["id"] for b in bool_specs]
            labels = [b["label"] for b in bool_specs]
            ops = [b["op"] for b in bool_specs]
        sig = parse_signature_call(squash(parts[3]))
        schema = parse_param_specs(block)
        preview = re.search(r"c\.preview\s*=\s*PreviewPolicy::(\w+)", block)
        undo = re.search(r"c\.undo\s*=\s*UndoContract::(\w+)", block)
        enabled = None
        me = re.search(r"c\.enabled\s*=\s*\[[^\]]*\]\s*\([^)]*\)\s*", block)
        if me:
            eb, _, _ = block_after(block, r"c\.enabled\s*=\s*\[[^\]]*\]\s*\([^)]*\)\s*")
            enabled = squash(eb).replace("return ", "").rstrip(";").strip()
        ex, _, _ = block_after(block, r"c\.execute\s*=\s*\[[^\]]*\]\s*\([^)]*\)\s*")
        slots = scan_emission(ex)
        produces = re.search(r"IrValueKind::(\w+)", ex.split("emit(")[-1]) if "emit(" in ex else \
            re.search(r"rec\.produces\s*=\s*IrValueKind::(\w+)", ex)
        for k, cid in enumerate(ids):
            cmds.append({
                "id": cid,
                "label": labels[k],
                "category": "Part",
                "feature_ir_op": ops[k],
                "selection": sig,
                "parameters": schema,
                "preview": preview.group(1) if preview else "None",
                "undo": undo.group(1) if undo else "SingleStep",
                "enabled_predicate_source": enabled,
                "emits_ir": bool(slots),
                "emitted_args": slots,
                "produces_value_kind": produces.group(1) if produces else None,
                "source": SOURCES["ui_part_commands"],
            })
    declared, _, _ = block_after(src, r"const std::vector<std::string>& partCommandIds\(\)\s*")
    listed = sorted(re.findall(r'"([\w.]+)"', declared))
    if sorted(c["id"] for c in cmds) != listed:
        raise DeriveError("registerPartCommands and partCommandIds disagree: %r vs %r"
                          % (sorted(c["id"] for c in cmds), listed))
    return cmds


def split_top(args):
    """Split a C++ argument list at top-level commas."""
    out = []
    depth = 0
    cur = ""
    in_str = False
    i = 0
    while i < len(args):
        c = args[i]
        if in_str:
            cur += c
            if c == "\\":
                cur += args[i + 1]
                i += 2
                continue
            if c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            cur += c
        elif c in "([{":
            depth += 1
            cur += c
        elif c in ")]}":
            depth -= 1
            cur += c
        elif c == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += c
        i += 1
    out.append(cur)
    return out


def parse_shell_commands(cpp):
    src = strip_comments(cpp)
    fn, _, _ = block_after(src, r"void ForgeShell::registerCommands\s*\(\s*\)\s*")
    cmds = []
    for m in re.finditer(r"CommandDescriptor c;", fn):
        end = fn.index("registry_.add(std::move(c));", m.end())
        block = fn[m.end():end]
        cid = re.search(r'c\.id\s*=\s*"([\w.]+)"', block)
        label = re.search(r'c\.label\s*=\s*"([^"]*)"', block)
        cat = re.search(r'c\.category\s*=\s*"([^"]*)"', block)
        irop = re.search(r'c\.featureIrOp\s*=\s*"([A-Z]*)"', block)
        sig = re.search(r"c\.signature\s*=\s*(SelectionSignature::\w+\([^;]*\));", block)
        undo = re.search(r"c\.undo\s*=\s*UndoContract::(\w+)", block)
        preview = re.search(r"c\.preview\s*=\s*PreviewPolicy::(\w+)", block)
        if not cid:
            raise DeriveError("ForgeShell descriptor without an id: %r" % squash(block)[:120])
        ex, _, _ = block_after(block, r"c\.execute\s*=\s*\[[^\]]*\]\s*\([^)]*\)\s*")
        emits = bool(IRARG_RE.search(ex)) or "emit(" in ex or "IrLine" in ex
        signature = parse_signature_call(squash(sig.group(1))) if sig else {"kind": "None", "min": 0, "max": None}
        if "requireHomogeneous = false" in block:
            signature["require_homogeneous"] = False
        cmds.append({
            "id": cid.group(1),
            "label": label.group(1) if label else "",
            "category": cat.group(1) if cat else "",
            "feature_ir_op": irop.group(1) if irop else "",
            "selection": signature,
            "parameters": parse_param_specs(block),
            "preview": preview.group(1) if preview else "None",
            "undo": undo.group(1) if undo else "SingleStep",
            "enabled_predicate_source": None,
            "emits_ir": emits,
            "emitted_args": [],
            "produces_value_kind": None,
            "source": SOURCES["ui_shell_commands"],
        })
    return cmds


def parse_desktop_seeds(cpp):
    """The app's pre-seeded IR values. A seed naming a non-op binds nothing."""
    seeds = []
    for m in re.finditer(r"partDoc_\.seed\(", cpp):
        args, _ = balanced(cpp, m.end() - 1)
        parts = [squash(p) for p in split_top(args)]
        seeds.append({
            "value_kind": parts[0].split("::")[-1],
            "node_id": parts[1].strip('"'),
            "op": parts[2].strip('"'),
            "source": SOURCES["desktop_frame"],
        })
    return seeds


# ---------------------------------------------------------------------------
# 5. the ONLY curated layer: units + semantics for kernel argument names
# ---------------------------------------------------------------------------
# Basis, quoted from forge-kernel/docs/feature_tree_ir.md: "Angles are degrees.
# Positions/axes are world-space." and the worked example reports "volume =
# 56 116.8 mm3, bbox 100.00 x 139.20 x 25.00 mm" -- so the length unit is mm.
UNIT_RULES = [
    (r"Deg$",                              "deg",           "angle"),
    (r"^(n|nx|ny|nSides|seg)$",            "count",         "instance_count"),
    (r"^p$",                               "dimensionless", "superellipse_exponent"),
    (r"^(ax[xyz]|dir[xyz]|openAx[xyz])$",  "dimensionless", "direction_vector_component"),
    (r"^(dia|cboreDia)$",                  "mm",            "diameter"),
    (r"^(r|r1|r2|radius|rx|ry|rOuter|rInner|major|minor|circumR|rStart|rEnd)$",
                                           "mm",            "radius"),
    (r"^(cx|cy|cz|ox|oy|oz|px|py|pz|z)$",  "mm",            "position"),
    (r"^(dx|dy|dz)$",                      "mm",            "step_offset"),
    (r"^(amount|depth|dist|wall|len|flangeH|thk|cboreDepth|h)$",
                                           "mm",            "linear_size"),
]

# Name collisions the generic rules cannot settle, each with the source line that
# settles it. Every key is validated against the parsed signature: an override
# for an argument the source does not have is a hard error.
OP_ARG_OVERRIDES = {
    ("MIRROR", "nx"): ("dimensionless", "plane_normal_component",
                       "MIRROR(%a, px,py,pz, nx,ny,nz) -- arbitrary plane; reflect + FUSE"),
    ("MIRROR", "ny"): ("dimensionless", "plane_normal_component",
                       "MIRROR(%a, px,py,pz, nx,ny,nz) -- arbitrary plane; reflect + FUSE"),
    ("MIRROR", "nz"): ("dimensionless", "plane_normal_component",
                       "MIRROR(%a, px,py,pz, nx,ny,nz) -- arbitrary plane; reflect + FUSE"),
}


def classify(op_name, param):
    if param["token"] != "number":
        return None, None, None
    key = (op_name, param["name"])
    if key in OP_ARG_OVERRIDES:
        unit, sem, why = OP_ARG_OVERRIDES[key]
        return unit, sem, "override: " + why
    for pat, unit, sem in UNIT_RULES:
        if re.search(pat, param["name"]):
            return unit, sem, "rule: /%s/" % pat
    return None, None, None


# ---------------------------------------------------------------------------
# 6. what each op CONSUMES, read out of the compiler's own type checks
# ---------------------------------------------------------------------------
REF_ACCESSOR_KIND = {"refSolid": "SOLID", "refProfile": "PROFILE", "refWire": "WIRE"}


def parse_compiler_ref_kinds(cpp):
    """{OpCode enum: {handler, consumes}} read from the compiler dispatch switch."""
    src = strip_comments(cpp)
    handlers = dict(re.findall(r"case OpCode::(\w+):\s*return (\w+)\(", src))
    if not handlers:
        raise DeriveError("compiler dispatch switch not found")
    bodies = {}
    for fn in sorted(set(handlers.values())):
        pat = r"\b\w[\w:<>,& ]*\s%s\s*\(const Op& op" % re.escape(fn)
        if not re.search(pat, src):
            raise DeriveError("compiler handler %s has no definition" % fn)
        body, _, _ = block_after(src, pat)
        bodies[fn] = body
    out = {}
    for enum, fn in handlers.items():
        kinds = sorted({REF_ACCESSOR_KIND[a] for a in REF_ACCESSOR_KIND
                        if re.search(r"\b%s\s*\(" % a, bodies[fn])})
        out[enum] = {"handler": fn, "consumes": kinds}
    return out


def archelix_config(cmake, hpp, compiler):
    """Is the arc/helix op family compiled in by default at this revision?"""
    gated_here = "FORGE_FT_ARCHELIX" in hpp or "FORGE_FT_ARCHELIX" in compiler
    m = re.search(r'option\(\s*FORGE_FT_ARCHELIX\s+"[^"]*"\s+(ON|OFF)\s*\)', cmake)
    if m:
        return {"declared": True, "default": m.group(1), "ops_gated_by_it": gated_here}
    if gated_here:
        raise DeriveError("FORGE_FT_ARCHELIX gates ops but is not an option in the kernel "
                          "CMakeLists -- the vocabulary cannot tell whether they compile in")
    return {"declared": False, "default": None, "ops_gated_by_it": False,
            "note": "no op is gated by FORGE_FT_ARCHELIX at this revision"}


# ---------------------------------------------------------------------------
# 7. constraints, read out of each command's enabled predicate
# ---------------------------------------------------------------------------
def parse_constraints(pred, schema):
    """Structured constraints PLUS every term the extractor could not read."""
    if not pred:
        return {"source": None, "derived": [], "unparsed_terms": []}
    alias = {}
    for m in re.finditer(r'const double (\w+) = num\(ctx, "(\w+)", [-\d.]+\);', pred):
        alias[m.group(1)] = m.group(2)
    for m in re.finditer(r'const std::string (\w+) = txt\(ctx, "(\w+)"', pred):
        alias[m.group(1)] = m.group(2)
    body = re.sub(r'const (?:double|std::string) \w+ = \w+\(ctx, "\w+", [^;]*\);', "", pred)

    def param_of(tok):
        tok = tok.strip()
        m = re.match(r'^num\(ctx, "(\w+)", [-\d.]+\)$', tok)
        if m:
            return m.group(1)
        return alias.get(tok)

    names = {p["name"] for p in schema}
    derived, unparsed = [], []
    for term in re.split(r"&&", body):
        # Strip only a BALANCED wrapping pair. `.strip("()")` ate the closing
        # paren of `wholeCount(n)` and of a num(...) > num(...) comparison, which
        # turned two real constraints into unreadable text.
        t = term.strip()
        while t.startswith("(") and balanced(t, 0)[1] == len(t) - 1:
            t = t[1:-1].strip()
        if not t:
            continue
        handled = False
        m = re.match(r"^(.+?)\s*(<=|>=|==|!=|<|>)\s*(.+)$", t)
        if m and "||" not in t:
            lhs, cmp_, rhs = m.group(1), m.group(2), m.group(3).strip()
            lp, rp = param_of(lhs), param_of(rhs)
            if lp in names and rp in names:
                derived.append({"parameter": lp, "comparison": cmp_, "parameter_rhs": rp})
                handled = True
            elif lp in names and re.match(r"^-?[\d.]+$", rhs):
                derived.append({"parameter": lp, "comparison": cmp_, "value": float(rhs)})
                handled = True
            elif lhs.strip() == "nx * ny" and re.match(r"^-?[\d.]+$", rhs):
                derived.append({"expression": "nx * ny", "comparison": cmp_, "value": float(rhs)})
                handled = True
            elif "resolveValues" in lhs and re.match(r"^-?\d+$", rhs):
                derived.append({"selection_values_of_kind":
                                re.search(r"IrValueKind::(\w+)", lhs).group(1),
                                "comparison": cmp_, "value": int(rhs)})
                handled = True
        if not handled and "||" in t:
            eq = re.findall(r'(\w+) == "([^"]+)"', t)
            if eq and len({e[0] for e in eq}) == 1 and alias.get(eq[0][0]) in names:
                derived.append({"parameter": alias[eq[0][0]], "comparison": "one_of",
                                "values": sorted({e[1] for e in eq})})
                handled = True
        if not handled:
            m = re.match(r"^wholeCount\((\w+)\)$", t)
            if m:
                derived.append({"parameter": alias.get(m.group(1), m.group(1)),
                                "comparison": "is_whole_number"})
                handled = True
        if not handled and t == "solidTarget(*d, ctx.selection()).ok":
            derived.append({"selection": "must resolve to exactly one SOLID value on one body"})
            handled = True
        if not handled:
            unparsed.append(t)
    return {"source": squash(pred), "derived": derived, "unparsed_terms": unparsed}


def keyword_domain(pred, param_name):
    """The keyword spellings a Text parameter may take, read off the predicate."""
    if not pred:
        return None
    m = re.search(r'const std::string (\w+) = txt\(ctx, "%s"' % re.escape(param_name), pred)
    if not m:
        return None
    vals = re.findall(r'%s == "([^"]+)"' % re.escape(m.group(1)), pred)
    return sorted(set(vals)) or None


def ternary_domain(selects_on):
    return sorted({v for _, v in re.findall(r'(\w+) == "([^"]+)"', selects_on)})


# ---------------------------------------------------------------------------
# 8. emitted forms: expand one command's argument slots into concrete IR forms
# ---------------------------------------------------------------------------
REF_PLACEHOLDER = {"target_solid": "%body", "tool_solid": "%tool", "profile": "%profile"}
EXAMPLE_TEXT_SELECTOR = "face:top"


def fmt_num(v):
    """Same rendering forge::ui::formatIrNumber uses ("%.10g")."""
    return "%.10g" % v


def slot_token(slot, cmd):
    if "alternatives" in slot:
        kws = ternary_domain(slot["selects_on"])
        return "|".join(kws + ['"<face selector>"'])
    if slot["token"] == "ref":
        base = REF_PLACEHOLDER[slot["role"]]
        return base + "..." if slot.get("repeat") else base
    if slot["token"] == "number":
        return slot["from_parameter"] if "from_parameter" in slot else fmt_num(slot["literal"])
    if slot["token"] == "keyword":
        if "literal" in slot:
            return slot["literal"]
        dom = keyword_domain(cmd["enabled_predicate_source"], slot["from_parameter"])
        return "|".join(dom) if dom else slot["from_parameter"]
    raise DeriveError("cannot render slot %r" % slot)


def example_params(cmd, active, slots):
    """A legal parameter set for ONE form. Only the parameters that form actually
    emits appear: a parameter supplied but not emitted would take a DIFFERENT
    branch of the handler, so the example would not reproduce the form."""
    by_name = {p["name"]: p for p in cmd["parameters"]}
    out = {}
    for i, s in enumerate(slots):
        if not slot_active(s, active):
            continue
        for sub in ([s] if "alternatives" not in s else []):
            name = sub.get("from_parameter")
            if name is None:
                continue
            spec = by_name.get(name)
            if spec is None:
                raise DeriveError("%s emits parameter %r that is not in its schema"
                                  % (cmd["id"], name))
            if spec["required"]:
                out[name] = spec["default_number"] if spec["type"] == "Number" \
                    else spec["default_text"]
            else:
                # A DISTINCT value, so the example proves the parameter is read
                # rather than the fallback being echoed back.
                out[name] = sub["fallback"] + i + 1 if spec["type"] == "Number" \
                    else spec["default_text"]
    # sorted(): `active` is a set, and iterating it unsorted made the emitted JSON
    # depend on PYTHONHASHSEED -- a generator whose output moves between runs
    # cannot gate anything.
    for cond in sorted(active):
        m = re.match(r'^flagOn\(ctx, "(\w+)"\)$', cond)
        if m:
            out[m.group(1)] = True
    return out


def render_example(cmd, slots, active, params, selector_choice=None):
    args = []
    for s in slots:
        if not slot_active(s, active):
            continue
        if "alternatives" in s:
            args.append(selector_choice)
            continue
        if s["token"] == "ref":
            if s.get("repeat"):
                args.extend("%s%d" % (REF_PLACEHOLDER[s["role"]], k + 1)
                            for k in range(cmd["selection"]["min"]))
            else:
                args.append(REF_PLACEHOLDER[s["role"]])
            continue
        if s["token"] == "number":
            args.append(fmt_num(params[s["from_parameter"]]) if "from_parameter" in s
                        else fmt_num(s["literal"]))
            continue
        if s["token"] == "keyword":
            args.append(s["literal"] if "literal" in s else params[s["from_parameter"]])
            continue
        raise DeriveError("cannot render slot %r" % s)
    return args


CMP = {"<": lambda a, b: a < b, "<=": lambda a, b: a <= b, ">": lambda a, b: a > b,
       ">=": lambda a, b: a >= b, "==": lambda a, b: a == b, "!=": lambda a, b: a != b}


def violations(params, constraints):
    """Which derived constraints this parameter set breaks. An EXAMPLE that the
    app would refuse is not an example of anything, so this is enforced."""
    bad = []
    for c in constraints["derived"]:
        p = c.get("parameter")
        if p is None or p not in params:
            if "expression" in c and c["expression"] == "nx * ny" and \
               "nx" in params and "ny" in params:
                if not CMP[c["comparison"]](params["nx"] * params["ny"], c["value"]):
                    bad.append("nx")
            continue
        if c["comparison"] == "is_whole_number":
            if float(params[p]) != int(params[p]):
                bad.append(p)
        elif c["comparison"] == "one_of":
            if params[p] not in c["values"]:
                bad.append(p)
        elif "parameter_rhs" in c:
            if c["parameter_rhs"] in params and \
               not CMP[c["comparison"]](params[p], params[c["parameter_rhs"]]):
                bad.append(p)
        elif "value" in c:
            if not CMP[c["comparison"]](params[p], c["value"]):
                bad.append(p)
    return bad


def human_condition(active, cmd):
    """Plain-language reading of the handler's own guard expressions."""
    if not active:
        return "always -- this is the form the command emits with only its required parameters"
    parts = []
    for cond in sorted(active):
        flags = re.findall(r'flagOn\(ctx, "(\w+)"\)', cond)
        nums = re.findall(r'hasNumber\(ctx, "(\w+)"\)', cond)
        if flags:
            parts.append("the %s flag is set" % "/".join(flags))
        elif nums:
            parts.append("any of %s is supplied" % ", ".join(nums))
        else:
            parts.append(cond)
    return " and ".join(parts)


def slot_active(slot, active):
    if slot.get("repeat"):
        return True
    return slot["condition"] == "always" or slot["condition"] in active


def enumerate_forms(cmd, kernel_arity):
    slots = cmd["emitted_args"]
    conds = []
    for s in slots:
        c = s["condition"]
        if c != "always" and not s.get("repeat") and c not in conds:
            conds.append(c)
    variadic = any(s.get("repeat") for s in slots)
    forms = []
    for mask in range(2 ** len(conds)):
        active = {conds[i] for i in range(len(conds)) if mask & (1 << i)}
        tokens = []
        for s in slots:
            if not slot_active(s, active):
                continue
            tokens.append(slot_token(s, cmd))
        n_fixed = len([t for t in tokens if not t.endswith("...")])
        arity_min = n_fixed + (cmd["selection"]["min"] if variadic else 0)
        params = example_params(cmd, active, slots)
        # The distinct value chosen for an OPTIONAL parameter can break the
        # command's own predicate (total_angle fallback+k gave 364, and the app
        # refuses anything over 360). Fall back to the schema default, which the
        # predicate accepts by construction, and fail loudly if even that breaks.
        constraints = parse_constraints(cmd["enabled_predicate_source"], cmd["parameters"])
        by_name = {p["name"]: p for p in cmd["parameters"]}
        for _ in range(len(params) + 1):
            bad = violations(params, constraints)
            if not bad:
                break
            for name in bad:
                spec = by_name.get(name)
                if spec is None or spec["type"] != "Number" or params[name] == spec["default_number"]:
                    raise DeriveError("%s: no legal example value for %r (constraints: %s)"
                                      % (cmd["id"], name, constraints["derived"]))
                params[name] = spec["default_number"]
        if violations(params, constraints):
            raise DeriveError("%s: example parameters violate its own predicate" % cmd["id"])
        has_alt = any("alternatives" in s for s in slots)
        examples = []
        choices = [None]
        if has_alt:
            alt = [s for s in slots if "alternatives" in s][0]
            choices = [ternary_domain(alt["selects_on"])[0], '"%s"' % EXAMPLE_TEXT_SELECTOR]
        text_params = [p["name"] for p in cmd["parameters"] if p["type"] == "Text"]
        for ch in choices:
            ex_params = dict(params)
            if ch is not None:
                if len(text_params) != 1:
                    raise DeriveError("%s has a keyword/text slot but %d Text parameters"
                                      % (cmd["id"], len(text_params)))
                ex_params[text_params[0]] = ch.strip('"')
            args = render_example(cmd, slots, active, ex_params, ch)
            examples.append({
                "parameters": ex_params,
                "ir_arguments": args,
                "ir_text": "%%<id> = %s(%s)" % (cmd["feature_ir_op"], ", ".join(args)),
            })
        form = {
            "when": "always" if not active else " and ".join(sorted(active)),
            "when_human": human_condition(active, cmd),
            "arguments": tokens,
            "argument_count": {"min": arity_min, "max": None if variadic else arity_min},
            "examples": examples,
        }
        if variadic:
            form["variadic"] = ("one %%ref per selected value, in selection order; the selection "
                                "signature requires at least %d" % cmd["selection"]["min"])
        lo, hi = kernel_arity["min_args"], kernel_arity["max_args"]
        if arity_min < lo or (hi is not None and arity_min > hi):
            raise DeriveError("%s emits %d arguments for %s, outside the kernel arity %s..%s"
                              % (cmd["id"], arity_min, cmd["feature_ir_op"], lo, hi))
        forms.append(form)
    forms.sort(key=lambda f: (f["argument_count"]["min"], f["when"]))
    return forms


# ---------------------------------------------------------------------------
# 9. assemble the vocabulary document
# ---------------------------------------------------------------------------
UNIT_BASIS = ("forge-kernel/docs/feature_tree_ir.md: \"Angles are degrees. Positions/axes are "
              "world-space.\" and its worked example reports volume in mm3 and bbox in mm, so "
              "the length unit is the millimetre.")


def build():
    src = {k: read(v) for k, v in SOURCES.items()}
    kops = parse_kernel_opcodes(src["kernel_header"])
    spellings = parse_op_from_name(src["kernel_compiler"])
    ui_table = parse_ui_op_table(src["ui_ir_table"])
    ref_kinds = parse_compiler_ref_kinds(src["kernel_compiler"])
    part = parse_part_commands(src["ui_part_commands"])
    shell = parse_shell_commands(src["ui_shell_commands"])
    seeds = parse_desktop_seeds(src["desktop_frame"])
    archelix = archelix_config(src["kernel_cmake"], src["kernel_header"], src["kernel_compiler"])

    by_name = {}
    for op in kops:
        if op["name"] in by_name:
            raise DeriveError("two OpCode enumerators spell %s" % op["name"])
        by_name[op["name"]] = op
    # the three kernel tables must agree with each other, or nothing below means anything
    for name, info in spellings.items():
        if name not in by_name:
            raise DeriveError("opFromName accepts %r with no OpCode signature" % name)
        if by_name[name]["enum"] != info["enum"]:
            raise DeriveError("%s maps to OpCode::%s but its signature is on OpCode::%s"
                              % (name, info["enum"], by_name[name]["enum"]))
    # An op behind a build option that defaults to OFF is not in a default build's
    # op set, so forge::ui is not expected to know it. Everything else must line up.
    archelix_on = archelix.get("default") == "ON"

    def compiled_in(op):
        return archelix_on or not op["archelix_gated"]

    for op in kops:
        if op["name"] not in spellings:
            raise DeriveError("OpCode::%s has a signature no spelling reaches" % op["enum"])
        if compiled_in(op) and op["name"] not in ui_table:
            raise DeriveError("kernel op %s is absent from forge::ui::irOpTable()" % op["name"])
    for name in ui_table:
        if name not in by_name:
            raise DeriveError("forge::ui knows op %s the kernel does not" % name)

    # per-op parsed signature + the arity it implies, cross-checked against forge::ui
    for op in kops:
        forms = []
        mins, maxs, unbounded = [], [], False
        for f in op["forms"]:
            name, params, trailing = parse_form(f)
            if name != op["name"]:
                raise DeriveError("form %r does not belong to %s" % (f, op["name"]))
            for idx, p in enumerate(params):
                p["index"] = idx
                unit, sem, basis = classify(op["name"], p)
                if unit:
                    p["unit"], p["semantic"], p["classified_by"] = unit, sem, basis
                elif p["token"] == "number":
                    p["unit"] = None
                    p["uncertain"] = True
                    p.setdefault("uncertain_reason",
                                 "no unit rule matched the argument name %r" % p["name"])
            close = balanced(f, f.index("("))[1]
            forms.append({"form": squash(f[:close + 1]),
                          "parameters": params,
                          "prose": trailing or None})
            mins.append(len([p for p in params if not p["optional"]]))
            maxs.append(len(params))
            unbounded = unbounded or any(p["variadic"] for p in params)
        op["parsed_forms"] = forms
        derived_arity = {"min_args": min(mins), "max_args": None if unbounded else max(maxs)}
        op["derived_arity"] = derived_arity
        if not compiled_in(op):
            continue
        ui = ui_table[op["name"]]
        if derived_arity["min_args"] != ui["min_args"] or derived_arity["max_args"] != ui["max_args"]:
            raise DeriveError("arity drift for %s: the kernel header implies %s..%s, "
                              "forge::ui::irOpTable() enforces %s..%s"
                              % (op["name"], derived_arity["min_args"], derived_arity["max_args"],
                                 ui["min_args"], ui["max_args"]))

    commands = sorted(part + shell, key=lambda c: c["id"])
    emitting = [c for c in commands if c["emits_ir"]]
    allowed = sorted({c["feature_ir_op"] for c in emitting})

    uncertain = []
    ops_out = []
    for name in allowed:
        op = by_name.get(name)
        if op is None:
            raise DeriveError("a command emits %r, which the kernel has no signature for" % name)
        if not compiled_in(op):
            raise DeriveError("a command emits %s, which is gated behind FORGE_FT_ARCHELIX "
                              "(default %s) and is not in a default build" % (name, archelix))
        cmds = [c for c in emitting if c["feature_ir_op"] == name]
        produces = sorted({c["produces_value_kind"].upper() for c in cmds
                           if c["produces_value_kind"]})
        consumes = ref_kinds[op["enum"]]["consumes"]
        entry = {
            "op": name,
            "kernel_enum": op["enum"],
            "produces": produces[0] if len(produces) == 1 else produces,
            "consumes_value_kinds": consumes,
            "arity": {"min_args": ui_table[name]["min_args"],
                      "max_args": ui_table[name]["max_args"],
                      "first_argument_is_value_ref": ui_table[name]["first_arg_is_value_ref"]},
            "kernel_signature": op["parsed_forms"],
            "kernel_notes": op["notes"],
            "user_commands": [c["id"] for c in cmds],
            "emitted_forms": [],
        }
        for c in cmds:
            for form in enumerate_forms(c, ui_table[name]):
                form["command"] = c["id"]
                entry["emitted_forms"].append(form)
        for f in op["parsed_forms"]:
            for p in f["parameters"]:
                if p.get("uncertain"):
                    uncertain.append({"op": name, "argument": p["name"],
                                      "reason": p.get("uncertain_reason")})
        ops_out.append(entry)

    forbidden = []
    for op in kops:
        if op["name"] in allowed:
            continue
        reason = "no command in the forge::ui registry emits it, so no user can produce it"
        if not compiled_in(op):
            reason += ("; it is also gated behind FORGE_FT_ARCHELIX, which the kernel "
                       "CMakeLists defaults to OFF, so it is not in a default build")
        forbidden.append({
            "op": op["name"],
            "kernel_enum": op["enum"],
            "compiled_into_a_default_build": compiled_in(op),
            "signature": [f["form"] for f in op["parsed_forms"]],
            "reason": reason,
        })
    forbidden.sort(key=lambda f: f["op"])

    # value-kind closure: what the allowed set consumes but cannot produce
    produced = {e["produces"] for e in ops_out if isinstance(e["produces"], str)}
    gaps = []
    for kind in sorted({k for e in ops_out for k in e["consumes_value_kinds"]}):
        if kind in produced:
            continue
        producers = sorted(o["name"] for o in kops
                           if o["name"] not in allowed and kind_produced_by(o) == kind)
        gaps.append({
            "value_kind": kind,
            "needed_by": sorted(e["op"] for e in ops_out if kind in e["consumes_value_kinds"]),
            "producers_in_the_allowed_set": [],
            "producers_in_the_kernel": producers,
            "consequence": "a user-invocable op consumes %s, and no user-invocable op produces "
                           "one: the value must already exist in the document (a seeded sketch "
                           "or imported solid) or the statement cannot be built" % kind,
        })

    defects = derive_defects(commands, spellings, seeds, ops_out, ref_kinds, by_name, part)

    doc = {
        "schema": SCHEMA,
        "generator": {
            "path": GEN_REL,
            "version": VERSION,
            "regenerate": "python3 %s --write" % GEN_REL,
            "check": "python3 %s --check" % GEN_REL,
            "gate": "ui/test/archie_op_vocabulary_test.cpp (runs under ui/test/run_ui.sh)",
        },
        "summary": ("The feature-tree IR ops a USER of the Forge app can actually invoke, derived "
                    "from the forge::ui command registry rather than from the kernel op table. "
                    "Archie may emit ops in `ops` and nothing else."),
        "provenance": {
            "sources": [hash_of(SOURCES[k]) for k in sorted(SOURCES)],
            "build_configuration": archelix,
            "note": ("Every field below is parsed out of the files above. No git sha is recorded "
                     "on purpose: the content hashes change exactly when the contract changes, "
                     "so --check stays quiet across unrelated commits and fails on real drift."),
        },
        "conventions": {
            "grammar": "%<id> = OP(arg, arg, ...); args are positional; refs are %N of a PRIOR id",
            "length_unit": "mm",
            "angle_unit": "deg",
            "unit_basis": UNIT_BASIS,
            "number_format": "forge::ui::formatIrNumber -- printf %.10g (12.0 prints as `12`)",
            "value_model": "every op produces exactly one value: PROFILE, WIRE or SOLID",
        },
        "counts": {
            "kernel_ops": len(kops),
            "ui_validator_ops": len(ui_table),
            "registry_commands": len(commands),
            "commands_emitting_ir": len(emitting),
            "user_invocable_ops": len(allowed),
            "forbidden_ops": len(forbidden),
            "uncertain_entries": len(uncertain),
            "derived_defects": len(defects),
        },
        "emission_policy": {
            "allowed_ops": allowed,
            "rules": [
                "Emit ONLY an op listed in `ops`. Any other op name is out of vocabulary, "
                "including every op in `forbidden_ops` and the RESULT terminal, which no "
                "forge::ui command can produce.",
                "Emit only an argument count listed in that op's `emitted_forms`. The kernel "
                "would accept more, but no user can reach it through the app.",
                "Keyword arguments are bare and UPPERCASE; a face/edge selector that is not one "
                "of the listed keywords is a QUOTED string.",
                "Every %N must refer to a STRICTLY EARLIER statement id.",
                "Respect each command's constraints (see `commands[].constraints`): the app "
                "refuses the emission otherwise, so a training target that violates one is a "
                "target no user could have produced.",
            ],
        },
        "ops": ops_out,
        "forbidden_ops": forbidden,
        "forbidden_statement_forms": [{
            "form": "RESULT(%<id>)",
            "reason": ("forge::ui has no way to emit it: every UI emission goes through "
                       "PartDocument::appendFeature -> validateIr, and validateIr answers "
                       "unknown_op for any name absent from irOpTable(), where RESULT is absent. "
                       "The kernel treats the LAST solid produced as the result instead."),
            "evidence": "RESULT is not among the %d names in forge::ui::irOpTable()" % len(ui_table),
        }],
        "commands": [command_record(c) for c in commands],
        "value_kind_closure": {
            "produced_by_allowed_ops": sorted(produced),
            "gaps": gaps,
        },
        "uncertain": uncertain,
        "derived_defects": defects,
    }
    return doc


def kind_produced_by(op):
    """PROFILE / WIRE / SOLID for a kernel op, from its OpCode section header."""
    return op.get("produces_kind")


def command_record(c):
    rec = {
        "id": c["id"],
        "label": c["label"],
        "category": c["category"],
        "feature_ir_op": c["feature_ir_op"] or None,
        "emits_feature_ir": c["emits_ir"],
        "selection": c["selection"],
        "parameters": c["parameters"],
        "preview": c["preview"],
        "undo": c["undo"],
        "source": c["source"],
    }
    if c["emits_ir"]:
        rec["constraints"] = parse_constraints(c["enabled_predicate_source"], c["parameters"])
        rec["produces_value_kind"] = c["produces_value_kind"]
    return rec


def derive_defects(commands, spellings, seeds, ops_out, ref_kinds, by_name, part):
    out = []
    for c in commands:
        if c["feature_ir_op"] and not c["emits_ir"]:
            out.append({
                "kind": "declares_an_op_it_never_emits",
                "command": c["id"],
                "feature_ir_op": c["feature_ir_op"],
                "evidence": "the handler in %s contains no IrArg/emit call" % c["source"],
                "consequence": "the command reports success and the document gains no statement",
            })
        if c["feature_ir_op"] and c["feature_ir_op"] not in spellings:
            out.append({
                "kind": "declares_an_op_the_kernel_does_not_have",
                "command": c["id"],
                "feature_ir_op": c["feature_ir_op"],
                "evidence": "%r is absent from forge::ft::opFromName" % c["feature_ir_op"],
                "consequence": "nothing can compile this statement; the op name is a dead label",
            })
    for s in seeds:
        if s["op"] not in spellings:
            out.append({
                "kind": "app_seed_names_a_non_op",
                "node": s["node_id"],
                "op": s["op"],
                "evidence": "%s seeds %s with op %r, which forge::ft::opFromName does not accept"
                            % (s["source"], s["node_id"], s["op"]),
                "consequence": "validateIr answers unknown_op, the seed binds no value, and every "
                               "command consuming a %s is unreachable in the shipped app"
                               % s["value_kind"].upper(),
            })
    missing_defaults = [p["name"] + " (" + c["id"] + ")" for c in part
                        for p in c["parameters"] if p["required"] and not p["has_default"]]
    if missing_defaults:
        out.append({
            "kind": "required_parameters_without_hasDefault",
            "count": len(missing_defaults),
            "parameters": missing_defaults,
            "evidence": "ParamSpec braced-positional initialisation stops before hasDefault",
            "consequence": "applyDefaults cannot fill them, so an interactive caller must prompt "
                           "before these commands can run",
        })
    for e in ops_out:
        for c in part:
            if c["feature_ir_op"] != e["op"] or not c["emits_ir"]:
                continue
            resolved = re.findall(r"IrValueKind::(\w+)", c["enabled_predicate_source"] or "")
            for r in sorted({x.upper() for x in resolved}):
                if e["consumes_value_kinds"] and r not in e["consumes_value_kinds"]:
                    out.append({
                        "kind": "command_feeds_the_wrong_value_kind",
                        "command": c["id"],
                        "feature_ir_op": e["op"],
                        "evidence": "the command resolves %s values, and the kernel's %s handler "
                                    "requires %s" % (r, ref_kinds[by_name[e["op"]]["enum"]]["handler"],
                                                     "/".join(e["consumes_value_kinds"])),
                        "consequence": "the emitted statement is well-formed for forge::ui and "
                                       "throws in forge::ft::compile",
                    })
    return out


# ---------------------------------------------------------------------------
# 10. write / check
# ---------------------------------------------------------------------------
# The committed file is PURE ASCII: the C++ gate reads it with a minimal JSON
# reader, and \uXXXX escapes would make that reader a second place to get Unicode
# wrong. Prose copied out of the sources carries a handful of typographic
# characters, each transliterated here; anything else raises rather than being
# silently mangled.
ASCII_FOLD = {
    "—": "--", "–": "-", "‘": "'", "’": "'",
    "“": '"', "”": '"', "→": "->", "≥": ">=", "≤": "<=",
    "×": "x", "³": "3", "²": "2", "°": " deg", "±": "+/-",
    " ": " ", "…": "...",
}


def to_ascii(node):
    if isinstance(node, str):
        out = "".join(ASCII_FOLD.get(ch, ch) for ch in node)
        bad = [ch for ch in out if ord(ch) > 127]
        if bad:
            raise DeriveError("non-ASCII character %r in %r has no transliteration"
                              % (bad[0], out[:80]))
        return out
    if isinstance(node, list):
        return [to_ascii(x) for x in node]
    if isinstance(node, dict):
        return {to_ascii(k): to_ascii(v) for k, v in node.items()}
    return node


def render(doc):
    text = json.dumps(to_ascii(doc), indent=2, ensure_ascii=True) + "\n"
    if "\\u" in text:
        raise DeriveError("the rendered vocabulary still carries a \\u escape")
    return text


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--write", action="store_true", help="regenerate the committed JSON")
    g.add_argument("--check", action="store_true",
                   help="fail if the committed JSON differs from what the source implies")
    g.add_argument("--print", action="store_true", help="write the JSON to stdout")
    args = ap.parse_args(argv)

    try:
        text = render(build())
    except DeriveError as exc:
        sys.stderr.write("[op-vocabulary] CANNOT DERIVE: %s\n" % exc)
        return 2

    out = os.path.join(REPO, OUT_REL)
    if args.print:
        sys.stdout.write(text)
        return 0
    if args.write:
        with open(out, "w") as fh:
            fh.write(text)
        doc = json.loads(text)
        print("[op-vocabulary] wrote %s -- %d user-invocable ops, %d forbidden, %d commands"
              % (OUT_REL, doc["counts"]["user_invocable_ops"], doc["counts"]["forbidden_ops"],
                 doc["counts"]["registry_commands"]))
        return 0

    if not os.path.exists(out):
        sys.stderr.write("[op-vocabulary] MISSING %s -- run --write\n" % OUT_REL)
        return 1
    with open(out) as fh:
        have = fh.read()
    if have == text:
        doc = json.loads(text)
        print("[op-vocabulary] OK -- %s matches the source (%d ops, %d commands, %d sources)"
              % (OUT_REL, doc["counts"]["user_invocable_ops"],
                 doc["counts"]["registry_commands"], len(doc["provenance"]["sources"])))
        return 0
    diff = list(difflib.unified_diff(have.splitlines(True), text.splitlines(True),
                                     fromfile=OUT_REL + " (committed)",
                                     tofile=OUT_REL + " (implied by the source)", n=2))
    sys.stderr.write("[op-vocabulary] DRIFT -- the committed vocabulary is not what the source "
                     "implies (%d differing lines shown, up to 80)\n" % len(diff))
    sys.stderr.writelines(diff[:80])
    sys.stderr.write("[op-vocabulary] regenerate with: python3 %s --write\n" % GEN_REL)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
