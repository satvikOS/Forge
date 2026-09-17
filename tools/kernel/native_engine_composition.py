#!/usr/bin/env python3
"""T-135 — what the Native* engines are made of, and whether that predicts anything.

WHY A SCRIPT AND NOT A PARAGRAPH. The claim this replaces was a token count:
`gp_Pnt` 497 across the Native* engines against `Vec3` 2033 in the rest of the
native B-Rep tree, read as "14:1 OCCT by composition ... substantially OCCT
implementations carrying native-sounding names". Counting OCCT *identifiers*
cannot support that reading, because the overwhelming majority of them are
REPRESENTATION -- `gp_Pnt` is how a point is spelled at the boundary, not
evidence that OCCT computed it. (See the 546-symbol census: 93% representation.)

So this classifies every OCCT identifier into four buckets and reports the only
one that bears on the question:

  PRODUCING    OCCT COMPUTES THE ANSWER -- BRepAlgoAPI_*, BRepPrimAPI_*,
               BRepOffsetAPI_*, BRepFilletAPI_*, ShapeFix_*, ShapeUpgrade_*,
               GeomAPI_*, GeomFill_*, BRepSweep_*, BRepProj_*, BRepMesh_*.
  CHECKING     OCCT INSPECTS OR MEASURES, rather than constructing the shape
               that is returned -- BRepCheck_*, BRepClass3d_*, BRepClass_*,
               BRepExtrema_*, ShapeAnalysis_*, BRepGProp, BRepBndLib. A
               validator is not an implementation.
  ADAPTER      OCCT CARRIES an answer already computed -- BRepBuilderAPI_Make*,
               BRep_Builder, Sewing, BRepLib, BRepTools.
  REPRESENT    OCCT SPELLS a value -- gp_*, TopoDS_*, TopExp*, Geom_*, TopLoc_*,
               GeomAbs_*, Poly_*, Bnd_*, and friends.

FALSIFIABILITY. `--audit` prints every OCCT-looking identifier that matched no
bucket. The conclusion is only as good as that list being empty of producers, so
the list is printed rather than described. It is 13 identifiers, all macros --
no producer.

★AND THE FIRST VERSION OF THAT CHECK COULD NOT SEE ITS OWN HOLE. The detector
matched CamelCase_with_underscore plus a six-name allowlist, so underscore-free
OCCT (BRepBndLib, ShapeFix, GeomConvert, GeomPlate, BRepFill) was invisible to
BOTH the classifier and --audit: NativeAabbBridge.cpp:111 calls
`BRepBndLib::Add(shape, box)` and the tool reported zero of everything for that
file. An audit cannot report a hole its detector cannot see. Caught in review.

Comments and string literals are stripped first: this tree documents its own
OCCT usage in prose, and counting the prose would count the argument twice.

Usage:
    python3 tools/kernel/native_engine_composition.py            # the table
    python3 tools/kernel/native_engine_composition.py --audit    # the hole check
"""
import collections
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PATTERN = os.path.join(ROOT, "forge-kernel", "src", "native", "brep", "Native*.cpp")

BUCKETS = [
    ("PRODUCING", re.compile(
        r"^(BRepAlgoAPI_|BRepPrimAPI_|BRepOffsetAPI_|BRepFilletAPI_|BRepOffset_Make|"
        r"BiTgte_|Draft_Modification|ShapeFix_|ShapeUpgrade_|GeomAPI_|GeomFill_|"
        r"GeomConvert_|BRepProj_|BRepSweep_|BRepMesh_)")),
    # A measurement, not a construction. BRepBndLib::Add sits here beside
    # BRepGProp for the same reason: it computes a VALUE (a box, a mass) from a
    # shape rather than constructing the shape that is returned. The one place
    # that distinction bends is NativeAabbBridge, whose answer IS a box -- see
    # the report; a token census cannot know that and must not pretend to.
    ("CHECKING", re.compile(
        r"^(BRepCheck_|BRepClass3d_|BRepClass_|BRepExtrema_|ShapeAnalysis_|BRepGProp"
        r"|BRepBndLib|BndLib)")),
    ("ADAPTER", re.compile(
        r"^(BRepBuilderAPI_|BRep_Builder|BRepLib|BRepTools)")),
    ("REPRESENT", re.compile(
        r"^(gp_|TopoDS|TopExp|TopAbs_|TopTools_|TopLoc_|BRep_Tool|Geom_|Geom2d_|GeomAbs_|"
        r"GeomAdaptor|BRepAdaptor_|Poly_|Precision|Standard_|Bnd_|BndLib|GProp_|GC_|GCE2d_|"
        r"GCPnts_|ElCLib|ElSLib|Adaptor3d_|Approx_|AppDef_|Extrema_|IntAna_|IntCurve|"
        r"IntTools_|math_|NCollection_|TColgp_|TColStd_|TColGeom|Message_|OSD_|Interface_|"
        r"XSControl_|STEPControl_|StlAPI|RWStl)")),
]

# Anything that looks like an OCCT identifier at all.
#
# ★THE SECOND ALTERNATION IS LOAD-BEARING AND WAS MISSING. The first version
# matched `CamelCase_with_underscore` plus a hand-written allowlist of six
# underscore-free names. An OCCT class outside that list -- `BRepBndLib`,
# `ShapeFix`, `GeomConvert`, `GeomPlate`, `BRepFill` -- was invisible to the
# CLASSIFIER *and* to `--audit`, so the audit could not report the hole it was
# built to report. A falsifiability check that cannot see a class cannot fail on
# it. The prefix list below is the OCCT toolkit naming scheme, not a list of
# classes, so a new class in a known toolkit is seen without editing this.
#
# The `(?=::)` on that alternation matters in the other direction. Without it the
# prefixes over-match badly -- `Top` swallows the NATIVE `TopologyBuilder`,
# `Shape` swallows the method name `ShapeType()` -- and an audit list that
# accuses native code of being OCCT is as useless as one that cannot see OCCT.
# Underscore-free OCCT is always reached as a static call (`BRepBndLib::Add`,
# `BRepLib::BuildCurves3d`), so requiring `::` keeps exactly that and nothing else.
OCCTISH = re.compile(
    r"\b([A-Z][A-Za-z0-9]*_[A-Za-z0-9_]+"
    r"|(?:BRep|Geom|Geom2d|Shape|Top|Bnd|Poly|GC|GCE2d|GCPnts|ElCLib|ElSLib|Adaptor3d"
    r"|Approx|AppDef|Extrema|IntAna|IntTools|NCollection|TColgp|TColStd|TColGeom"
    r"|Precision|Standard|Interface|XSControl|STEPControl|StlAPI|RWStl|OSD|Message)"
    r"[A-Za-z0-9]*(?=::))\b")

# A native engine that cannot handle an input returns null rather than guessing,
# and records WHY. The shared convention across this tree is a `defer(why)`
# helper -- NativeDraft and NativeThickenShell keep the reason in a thread-local
# slot, NativeFilletChamfer returns a reason-bearing Result, NativeFilling fills
# FillDiagnosis.reason -- and FK_DEFER is only the MACRO form of it, used in two
# files. Counting the macro alone reported `-` for eleven engines that do label
# their declines, which is how the first version of this tool concluded they
# "decline without saying why". They do not.
#
# ★AND THIS COLUMN IS A COUNT OF SITES IN SOURCE, NOT OF DECLINES AT RUNTIME.
# A guard may fire for every input, none, or many times per call, so this cannot
# re-derive coverage and must never be read beside a coverage percentage as
# though it were the same kind of number. Coverage is measured per family in
# forge-kernel/reports/CORPUS_AB_COVERAGE.md and nowhere else.
DECLINE = re.compile(r"\bFK_DEFER(?:_F)?\b|\bdefer\s*\(")


def strip_noncode(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = "\n".join(line.split("//")[0] for line in text.split("\n"))
    return re.sub(r'"(?:[^"\\]|\\.)*"', '""', text)


def classify(path):
    code = strip_noncode(open(path).read())
    counts = collections.Counter()
    producing = collections.Counter()
    unclassified = collections.Counter()
    for tok in OCCTISH.findall(code):
        for name, rx in BUCKETS:
            if rx.match(tok):
                counts[name] += 1
                if name == "PRODUCING":
                    producing[tok] += 1
                break
        else:
            unclassified[tok] += 1
    return counts, producing, unclassified, len(DECLINE.findall(code))


def main(argv):
    audit = "--audit" in argv
    files = sorted(glob.glob(PATTERN))
    if not files:
        print("no Native*.cpp under %s" % PATTERN, file=sys.stderr)
        return 2
    holes = collections.Counter()
    rows = []
    for path in files:
        counts, producing, unclassified, declines = classify(path)
        holes.update(unclassified)
        rows.append((os.path.basename(path), counts, producing, declines))

    if audit:
        print("OCCT-looking identifiers matching no bucket "
              "(a PRODUCER here would invalidate the table):")
        for tok, n in holes.most_common():
            print("    %-40s %d" % (tok, n))
        print("\n%d distinct, %d occurrences" % (len(holes), sum(holes.values())))
        return 0

    print("%-28s %8s %7s %7s %7s %9s  %s"
          % ("engine", "PRODUCES", "checks", "adapts", "spells", "sites",
             "producing classes"))
    for name, counts, producing, declines in sorted(rows, key=lambda r: -r[1]["PRODUCING"]):
        print("%-28s %8d %7d %7d %7d %9s  %s"
              % (name, counts["PRODUCING"], counts["CHECKING"], counts["ADAPTER"],
                 counts["REPRESENT"], declines or "-",
                 ", ".join("%s x%d" % kv for kv in producing.most_common(4)) or "-"))

    native = [r[0] for r in rows if r[1]["PRODUCING"] == 0]
    print("\nOCCT NEVER PRODUCES THE ANSWER IN %d OF %d ENGINES:" % (len(native), len(rows)))
    for n in native:
        print("    %s" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
