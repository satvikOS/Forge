#!/usr/bin/env python3
# ============================================================================
# gen_calculator_schema.py -- DERIVE the app's engineering-calculator form
# schema from the KERNEL'S OWN C++ DECLARATIONS, and gate the committed
# artefacts against drift.
#
# WHY THIS EXISTS
#   forge-kernel declares engineering calculators as a pair of plain structs
#   plus one entry point:
#
#       namespace forge::circpipe {
#         struct Input  { double pipeDiameterM; /* ... */ };
#         struct Result { double dischargeM3S;  /* ... */ };
#         Result analyse(const Input& in);
#       }
#
#   That declaration ALREADY names every number the calculation consumes and
#   every number it produces, in order. A form surface that asks for those
#   numbers therefore has no business holding a SECOND list of them: this
#   program has already shipped four divergent copies of one vocabulary
#   because a generated table and a hand-written one were allowed to coexist.
#
#   So the field set, the field ORDER, the C++ types and the doc comments are
#   READ OUT OF THE HEADERS listed in CALCULATORS. Nothing below transcribes a
#   field name. The parser is deliberately BRITTLE: a struct member it does not
#   understand raises instead of being skipped, because a form that silently
#   drops an input asks for a calculation nobody requested.
#
# THE ONE CURATED LAYER, AND WHY IT CANNOT DRIFT
#   A C++ declaration cannot say what a person should READ beside a box.
#   `double pipeDiameterM;` carries the quantity and the unit, but "Pipe
#   diameter" and "m" are a product decision, and the standing order is that
#   the application contains no developer-facing strings -- an app that draws
#   `pipeDiameterM` beside an input box is showing an identifier where a name
#   belongs.
#
#   PRESENTATION below is therefore the ONLY judgement in this file, and it is
#   TOTAL IN BOTH DIRECTIONS against the parsed source:
#     * a parsed field with no PRESENTATION entry is a hard error (a new kernel
#       input cannot reach a user unlabelled), and
#     * a PRESENTATION entry naming a field the source does not have is a hard
#       error (a renamed or deleted kernel field cannot leave a stale label).
#   Neither is guessed and neither is skipped. The label text itself is then
#   judged by the APPLICATION'S OWN prose scanner in
#   ui/test/engineering_calculator_test.cpp -- scanUserFacingProse() is C++ and
#   cannot run here, so this file produces the strings and that gate rules on
#   them.
#
# HOW IT STAYS TRUE
#   Every source header's SHA-256 is recorded in the JSON. --check re-derives
#   from the headers and fails the moment a header moves and the committed
#   artefacts do not.
#
# USAGE
#   python3 implementation/sacrosanct/tools/gen_calculator_schema.py --write
#   python3 implementation/sacrosanct/tools/gen_calculator_schema.py --check
# ============================================================================
import argparse
import difflib
import hashlib
import json
import os
import re
import sys

VERSION = "1.0.0"
SCHEMA = "forge.ui.calculator_schema/1"

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
GEN_REL = "implementation/sacrosanct/tools/gen_calculator_schema.py"
JSON_REL = "implementation/sacrosanct/forge_calculator_schema.json"
HPP_REL = "ui/include/forge/ui/CalculatorSchema.hpp"
BRIDGE_REL = "forge-desktop/src/CalculatorKernelBridge.hpp"

# ---------------------------------------------------------------------------
# THE FAMILY. One coherent engineering family: how fast and how much fluid is
# moving in a run of pipe, and whether the pump feeding it has enough suction
# pressure to keep doing it. Each entry names a kernel header
# whose single entry point is `Result analyse(const Input&)` and whose Input is
# plain scalars -- the shape a form can render. The command id follows the
# registry's own convention (<prefix>.<snake_case>); "sim" is one of the four
# prefixes the app census found EMPTY, and "Simulation" is a command category
# the Simulation workspace already claims and no command yet fills.
# ---------------------------------------------------------------------------
CALCULATORS = [
    {
        "id": "flow_circular_pipe",
        "header": "forge-kernel/include/forge/CircularPipeFlow.hpp",
        "source": "forge-kernel/src/CircularPipeFlow.cpp",
        "namespace": "circpipe",
        "command": "sim.flow_circular_pipe",
        "label": "Partly Full Pipe Flow",
        "summary": "How much water a round pipe carries when it is not running full, from its "
                   "bore, its slope and how deep the water is.",
    },
    {
        "id": "flow_pitot_tube",
        "header": "forge-kernel/include/forge/PitotTube.hpp",
        "source": "forge-kernel/src/PitotTube.cpp",
        "namespace": "pitot",
        "command": "sim.flow_pitot_tube",
        "label": "Pitot Tube Velocity",
        "summary": "How fast a stream is moving, from the pressure a Pitot tube reads in it, "
                   "and the flow that carries through a duct of known area.",
    },
    {
        "id": "pump_suction_margin",
        "header": "forge-kernel/include/forge/PumpNpsh.hpp",
        "source": "forge-kernel/src/PumpNpsh.cpp",
        "namespace": "pumpnpsh",
        "command": "sim.pump_suction_margin",
        "label": "Pump Suction Margin",
        "summary": "Whether a pump has enough suction pressure to run without the liquid "
                   "boiling at its inlet.",
    },
]

# ---------------------------------------------------------------------------
# THE ONLY JUDGEMENT IN THIS FILE. Keyed "<namespace>.<struct>.<field>", total
# in both directions against the parsed headers (see derive()).
#   label : what a person reads beside the box or the number. Never an
#           identifier, never a symbol, never a file path.
#   unit  : the unit that quantity is in, "" when it is dimensionless. Drawn
#           beside the label, so it is a unit a person writes, not a suffix a
#           compiler sees ("m/s", not "Ms").
# ---------------------------------------------------------------------------
PRESENTATION = {
    # ---- partly full circular pipe, Manning ---------------------------------
    "circpipe.Input.pipeDiameterM":      ("Pipe bore", "m"),
    "circpipe.Input.waterDepthM":        ("Water depth", "m"),
    "circpipe.Input.manningN":           ("Manning roughness coefficient", ""),
    "circpipe.Input.slope":              ("Slope of the pipe", "m/m"),
    "circpipe.Result.depthRatio":        ("Depth against the bore", ""),
    "circpipe.Result.centralAngleRad":   ("Angle the water surface subtends", "rad"),
    "circpipe.Result.flowAreaM2":        ("Area carrying water", "m2"),
    "circpipe.Result.wettedPerimeterM":  ("Wetted perimeter", "m"),
    "circpipe.Result.hydraulicRadiusM":  ("Hydraulic radius", "m"),
    "circpipe.Result.velocityMs":        ("Velocity", "m/s"),
    "circpipe.Result.dischargeM3S":      ("Volume flow", "m3/s"),
    "circpipe.Result.dischargeLs":       ("Volume flow", "L/s"),
    "circpipe.Result.areaRatio":         ("Area against a full pipe", ""),
    "circpipe.Result.velocityRatio":     ("Velocity against a full pipe", ""),
    "circpipe.Result.dischargeRatio":    ("Flow against a full pipe", ""),
    # ---- Pitot tube ---------------------------------------------------------
    "pitot.Input.dynamicPressurePa":  ("Pressure the probe reads", "Pa"),
    "pitot.Input.densityKgM3":        ("Density of the fluid", "kg/m3"),
    "pitot.Input.pitotCoefficient":   ("Probe coefficient", ""),
    "pitot.Input.flowAreaM2":         ("Area of the duct", "m2"),
    "pitot.Result.velocityMs":        ("Velocity", "m/s"),
    "pitot.Result.velocityHeadM":     ("Velocity head", "m"),
    "pitot.Result.volumeFlowM3S":     ("Volume flow", "m3/s"),
    "pitot.Result.massFlowKgS":       ("Mass flow", "kg/s"),
    # ---- pump suction margin, Hydraulic Institute ---------------------------
    "pumpnpsh.Input.atmosphericPressurePa": ("Pressure above the liquid", "Pa"),
    "pumpnpsh.Input.vapourPressurePa":      ("Pressure at which it boils", "Pa"),
    "pumpnpsh.Input.densityKgM3":           ("Density of the liquid", "kg/m3"),
    "pumpnpsh.Input.staticSuctionHeadM":    ("Height of the liquid above the pump", "m"),
    "pumpnpsh.Input.frictionHeadM":         ("Head lost in the suction pipe", "m"),
    "pumpnpsh.Input.requiredNpshM":         ("Suction head the pump needs", "m"),
    "pumpnpsh.Result.pressureHeadM":        ("Head from the pressure above the liquid", "m"),
    "pumpnpsh.Result.availableNpshM":       ("Suction head available", "m"),
    "pumpnpsh.Result.marginM":              ("Margin over what the pump needs", "m"),
    "pumpnpsh.Result.marginPct":            ("Margin over what the pump needs", "%"),
    "pumpnpsh.Result.cavitating":           ("The liquid would boil at the inlet", ""),
    "pumpnpsh.Result.marginalPerHi":        ("The margin is under the recommended minimum", ""),
}

# C++ member types this form surface can carry. A member of any other type is a
# hard error rather than a skipped box: the kernel would then be reading a
# number the form never asked for.
KIND_OF_TYPE = {"double": "Number", "bool": "Flag"}


class DeriveError(RuntimeError):
    """A construct the parser does not understand. Never swallowed."""


def read(rel):
    with open(os.path.join(REPO, rel), "rb") as fh:
        return fh.read().decode("utf-8")


def hash_of(rel):
    with open(os.path.join(REPO, rel), "rb") as fh:
        raw = fh.read()
    return {"path": rel, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}


_STRUCT = r"\bstruct\s+%s\s*\{"
# `double pipeDiameterM;   // D`  /  `bool compressible;  // true -> use e`
_MEMBER = re.compile(
    r"^\s*(?P<type>[A-Za-z_][A-Za-z0-9_:]*)\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*;"
    r"\s*(?://\s*(?P<doc>.*?))?\s*$")


def struct_body(text, name, rel):
    """The brace-balanced body of `struct <name> { ... }`, comments intact."""
    m = re.search(_STRUCT % re.escape(name), text)
    if not m:
        raise DeriveError("%s: no `struct %s {`" % (rel, name))
    i = text.index("{", m.start())
    depth, j = 0, i
    while j < len(text):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[i + 1:j]
        j += 1
    raise DeriveError("%s: unbalanced braces in struct %s" % (rel, name))


def members(body, rel, struct):
    """Every data member, IN DECLARATION ORDER. A line that is neither blank,
    nor a comment, nor a member this file understands raises."""
    out = []
    for raw in body.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        m = _MEMBER.match(line)
        if not m:
            raise DeriveError(
                "%s: struct %s has a member this parser does not understand: %r"
                % (rel, struct, stripped))
        ctype = m.group("type")
        if ctype not in KIND_OF_TYPE:
            raise DeriveError(
                "%s: struct %s member %s has type %r, which no form box can carry. "
                "Teach KIND_OF_TYPE or narrow the family -- do not skip it."
                % (rel, struct, m.group("name"), ctype))
        out.append({"name": m.group("name"), "cppType": ctype,
                    "kind": KIND_OF_TYPE[ctype],
                    "doc": (m.group("doc") or "").strip()})
    if not out:
        raise DeriveError("%s: struct %s parsed to zero members" % (rel, struct))
    return out


def entry_point(text, ns, rel):
    """Confirm the header really declares the canonical entry point. A header
    that only DECLARES structs computes nothing; the whole point of this ticket
    is that a form must reach a calculation, so the absence is an error."""
    if not re.search(r"\bResult\s+analyse\s*\(\s*const\s+Input\s*&", text):
        raise DeriveError("%s: no `Result analyse(const Input&)` entry point" % rel)
    if not re.search(r"namespace\s+forge::%s\b" % re.escape(ns), text) and \
       not re.search(r"namespace\s+forge\s*\{\s*namespace\s+%s\b" % re.escape(ns), text):
        raise DeriveError("%s: header does not open namespace forge::%s" % (rel, ns))
    return "forge::%s::analyse" % ns


def present(ns, struct, field, used):
    key = "%s.%s.%s" % (ns, struct, field["name"])
    if key not in PRESENTATION:
        raise DeriveError(
            "no PRESENTATION entry for %s. A kernel field cannot reach a user "
            "unlabelled -- add a label and a unit, or drop the calculator." % key)
    used.add(key)
    label, unit = PRESENTATION[key]
    if not label.strip():
        raise DeriveError("PRESENTATION[%s] has an empty label" % key)
    out = dict(field)
    out["label"] = label
    out["unit"] = unit
    return out


def derive():
    used = set()
    calcs = []
    for spec in CALCULATORS:
        rel = spec["header"]
        text = read(rel)
        ns = spec["namespace"]
        symbol = entry_point(text, ns, rel)
        ins = [present(ns, "Input", f, used)
               for f in members(struct_body(text, "Input", rel), rel, "Input")]
        outs = [present(ns, "Result", f, used)
                for f in members(struct_body(text, "Result", rel), rel, "Result")]
        # A readout that prints one label twice for two different numbers is a
        # readout nobody can use. Units distinguish the honest duplicate (the
        # same quantity offered in two units); anything else is a naming bug.
        for group, name in ((ins, "inputs"), (outs, "outputs")):
            seen = set()
            for f in group:
                pair = (f["label"], f["unit"])
                if pair in seen:
                    raise DeriveError("%s %s: two fields read %r %r"
                                      % (spec["id"], name, f["label"], f["unit"]))
                seen.add(pair)
        calcs.append({
            "id": spec["id"],
            "commandId": spec["command"],
            "label": spec["label"],
            "summary": spec["summary"],
            "namespace": "forge::" + ns,
            "kernelEntryPoint": symbol,
            "header": rel,
            "implementation": spec["source"],
            "inputs": ins,
            "outputs": outs,
        })

    stale = sorted(set(PRESENTATION) - used)
    if stale:
        raise DeriveError(
            "PRESENTATION names %d field(s) no parsed header has: %s. A renamed or "
            "deleted kernel field must not leave a label behind."
            % (len(stale), ", ".join(stale)))

    sources = [hash_of(GEN_REL)]
    for spec in CALCULATORS:
        sources.append(hash_of(spec["header"]))
        sources.append(hash_of(spec["source"]))
    return {
        "schema": SCHEMA,
        "version": VERSION,
        "counts": {
            "calculators": len(calcs),
            "inputs": sum(len(c["inputs"]) for c in calcs),
            "outputs": sum(len(c["outputs"]) for c in calcs),
            "presentation_entries": len(PRESENTATION),
        },
        "calculators": calcs,
        "provenance": {"generator": GEN_REL, "sources": sources},
    }


# ---------------------------------------------------------------------------
# the C++ the application actually compiles
# ---------------------------------------------------------------------------
def cstr(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def emit_hpp(doc):
    L = []
    a = L.append
    a("// ui/include/forge/ui/CalculatorSchema.hpp")
    a("//")
    a("// GENERATED FILE -- DO NOT EDIT BY HAND.")
    a("//   written by %s" % GEN_REL)
    a("//   from       %s" % JSON_REL)
    a("//")
    a("// Every field below is READ OUT OF THE KERNEL'S OWN HEADER: the names, the")
    a("// C++ types and the order are the declaration's, not a second list kept")
    a("// beside it. Regenerate with --write; CI runs --check, so a kernel header")
    a("// that moves and leaves this file behind is red rather than quietly wrong.")
    a("#ifndef FORGE_UI_CALCULATORSCHEMA_HPP")
    a("#define FORGE_UI_CALCULATORSCHEMA_HPP")
    a("")
    a("#include <cstddef>")
    a("#include <cstdint>")
    a("")
    a("namespace forge::ui {")
    a("")
    a("// What kind of box a field gets, and what kind of number comes back.")
    a("enum class CalculatorValueKind : std::uint8_t { Number, Flag };")
    a("")
    a("// One number the calculation consumes or produces.")
    a("struct CalculatorFieldSchema {")
    a("  // The kernel's own member name. It is a MACHINE key -- it addresses the")
    a("  // parameter in a CommandParams and is what a macro stores. It is never")
    a("  // drawn; `label` is what a person reads.")
    a("  const char* name;")
    a("  const char* label;")
    a("  // The unit as a person writes it, or \"\" when the quantity has none.")
    a("  const char* unit;")
    a("  CalculatorValueKind kind;")
    a("};")
    a("")
    a("// One calculator: a command id, what it is called, and the two field lists.")
    a("struct CalculatorSchema {")
    a("  const char* id;")
    a("  const char* commandId;")
    a("  const char* label;")
    a("  const char* summary;")
    a("  // ── A MACHINE FIELD. NEVER DRAWN. ─────────────────────────────────")
    a("  // The kernel header this calculator was derived FROM, so a gate can open")
    a("  // it and re-derive the field list in C++ -- a SECOND derivation of the")
    a("  // same fact, which is the only way a generator's output is evidence")
    a("  // rather than a promise. It is a file path: scanUserFacingProse() reports")
    a("  // it as one, and ui/test/engineering_calculator_test.cpp asserts that it")
    a("  // does, so drawing this string anywhere is a red gate.")
    a("  const char* kernelHeaderPath;")
    a("  const CalculatorFieldSchema* inputs;")
    a("  std::size_t inputCount;")
    a("  const CalculatorFieldSchema* outputs;")
    a("  std::size_t outputCount;")
    a("};")
    a("")
    for c in doc["calculators"]:
        for which in ("inputs", "outputs"):
            a("inline constexpr CalculatorFieldSchema k%s_%s[] = {"
              % (c["id"].title().replace("_", ""), which.title()))
            for f in c[which]:
                a("    {%s, %s, %s, CalculatorValueKind::%s},"
                  % (cstr(f["name"]), cstr(f["label"]), cstr(f["unit"]), f["kind"]))
            a("};")
        a("")
    a("inline constexpr CalculatorSchema kCalculatorSchemas[] = {")
    for c in doc["calculators"]:
        stem = c["id"].title().replace("_", "")
        a("    {%s," % cstr(c["id"]))
        a("     %s," % cstr(c["commandId"]))
        a("     %s," % cstr(c["label"]))
        a("     %s," % cstr(c["summary"]))
        a("     %s," % cstr(c["header"]))
        a("     k%s_Inputs, %d, k%s_Outputs, %d},"
          % (stem, len(c["inputs"]), stem, len(c["outputs"])))
    a("};")
    a("")
    a("inline constexpr std::size_t kCalculatorSchemaCount =")
    a("    sizeof(kCalculatorSchemas) / sizeof(kCalculatorSchemas[0]);")

    a("")
    a("}  // namespace forge::ui")
    a("")
    a("#endif  // FORGE_UI_CALCULATORSCHEMA_HPP")
    return "\n".join(L) + "\n"


def emit_bridge(doc):
    """The ONE piece of C++ that names a kernel struct member.

    A hand-written `in.pipeDiameterM = p.number("pipeDiameterM")` is a SECOND
    copy of the field list -- the same defect class the schema header exists to
    remove, one layer lower and harder to see, because it would compile happily
    with two members swapped. It is derived from the same parse instead."""
    L = []
    a = L.append
    a("// forge-desktop/src/CalculatorKernelBridge.hpp")
    a("//")
    a("// GENERATED FILE -- DO NOT EDIT BY HAND.")
    a("//   written by %s" % GEN_REL)
    a("//")
    a("// The one place a kernel calculator's struct members are named in the")
    a("// application, and it is DERIVED: every assignment below is read out of the")
    a("// kernel header that declares it, in declaration order, so a member that is")
    a("// renamed or reordered cannot be silently paired with the wrong number. CI")
    a("// runs the generator's --check, so a header that moves and leaves this file")
    a("// behind is red.")
    a("//")
    a("// evaluate() THROWS whatever the kernel throws. The kernel reports a bad")
    a("// input in its own notation, which is not something a user can act on, so")
    a("// the caller catches it and answers with a sentence instead.")
    a("#ifndef FORGE_DESKTOP_CALCULATORKERNELBRIDGE_HPP")
    a("#define FORGE_DESKTOP_CALCULATORKERNELBRIDGE_HPP")
    a("")
    a("#include <optional>")
    a("#include <string>")
    a("#include <vector>")
    a("")
    a('#include "forge/ui/CommandRegistry.hpp"')
    for c in doc["calculators"]:
        a('#include "%s"' % c["header"].replace("forge-kernel/include/", ""))
    a("")
    a("namespace forge::desktop::calcbridge {")
    a("")
    a("// Fills `out` with one value per declared output, in declaration order, and")
    a("// returns true. False means this build carries no calculator by that id, or")
    a("// a declared input was absent from `params`.")
    a("inline bool evaluate(const std::string& calculatorId,")
    a("                     const forge::ui::CommandParams& params,")
    a("                     std::vector<double>& out) {")
    a("  bool complete = true;")
    a("  const auto num = [&](const char* field) -> double {")
    a("    const std::optional<double> v = params.number(field);")
    a("    if (!v.has_value()) { complete = false; return 0.0; }")
    a("    return *v;")
    a("  };")
    a("  const auto flag = [&](const char* field) -> bool {")
    a("    const std::optional<bool> v = params.flag(field);")
    a("    if (!v.has_value()) { complete = false; return false; }")
    a("    return *v;")
    a("  };")
    a("  (void)num;")
    a("  (void)flag;")
    a("  out.clear();")
    for c in doc["calculators"]:
        ns = c["namespace"]
        a("")
        a("  if (calculatorId == %s) {" % cstr(c["id"]))
        a("    %s::Input in{};" % ns)
        for f in c["inputs"]:
            getter = "flag" if f["kind"] == "Flag" else "num"
            a("    in.%s = %s(%s);" % (f["name"], getter, cstr(f["name"])))
        a("    if (!complete) return false;")
        a("    const %s::Result r = %s::analyse(in);" % (ns, ns))
        a("    out.reserve(%d);" % len(c["outputs"]))
        for f in c["outputs"]:
            if f["kind"] == "Flag":
                a("    out.push_back(r.%s ? 1.0 : 0.0);" % f["name"])
            else:
                a("    out.push_back(r.%s);" % f["name"])
        a("    return true;")
        a("  }")
    a("")
    a("  return false;")
    a("}")
    a("")
    a("}  // namespace forge::desktop::calcbridge")
    a("")
    a("#endif  // FORGE_DESKTOP_CALCULATORKERNELBRIDGE_HPP")
    return "\n".join(L) + "\n"


def write_if(path, text, check, label, failures):
    full = os.path.join(REPO, path)
    old = None
    if os.path.exists(full):
        with open(full, "r", encoding="utf-8") as fh:
            old = fh.read()
    if check:
        if old is None:
            print("[calcschema] MISSING %s" % path)
            failures.append(path)
            return
        if old != text:
            print("[calcschema] DRIFT in %s:" % path)
            for line in list(difflib.unified_diff(
                    old.splitlines(), text.splitlines(),
                    fromfile="committed", tofile="derived", lineterm=""))[:40]:
                print("   " + line)
            failures.append(path)
        else:
            print("[calcschema] ok  %s" % label)
        return
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("[calcschema] wrote %s" % path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.write == args.check:
        ap.error("pass exactly one of --write / --check")

    try:
        doc = derive()
    except DeriveError as e:
        print("[calcschema] DERIVE FAILED: %s" % e)
        return 2

    js = json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=False) + "\n"

    failures = []
    write_if(JSON_REL, js, args.check, "the derived record", failures)
    write_if(HPP_REL, emit_hpp(doc), args.check, "the compiled schema", failures)
    write_if(BRIDGE_REL, emit_bridge(doc), args.check, "the kernel bridge", failures)

    c = doc["counts"]
    print("[calcschema] %d calculators, %d inputs, %d outputs, %d presentation entries"
          % (c["calculators"], c["inputs"], c["outputs"], c["presentation_entries"]))
    if failures:
        print("[calcschema] FAIL -- %d artefact(s) drifted. Re-run with --write."
              % len(failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
