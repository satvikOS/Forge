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
  CHECKING     OCCT INSPECTS AN ANSWER SOMEONE ELSE COMPUTED -- BRepCheck_*,
               BRepClass3d_*, BRepClass_*, BRepExtrema_*, ShapeAnalysis_*,
               BRepGProp. A validator is not an implementation.
  ADAPTER      OCCT CARRIES an answer already computed -- BRepBuilderAPI_Make*,
               BRep_Builder, Sewing, BRepLib, BRepTools.
  REPRESENT    OCCT SPELLS a value -- gp_*, TopoDS_*, TopExp*, Geom_*, TopLoc_*,
               GeomAbs_*, Poly_*, Bnd_*, and friends.

FALSIFIABILITY. `--audit` prints every OCCT-looking identifier that matched no
bucket. The conclusion is only as good as that list being empty of producers, so
the list is printed rather than described. When this was written it contained
macros (FK_DEFER, FORGE_*), enum constants (GeomAbs_*) and TopLoc_Location --
no producer.

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
    ("CHECKING", re.compile(
        r"^(BRepCheck_|BRepClass3d_|BRepClass_|BRepExtrema_|ShapeAnalysis_|BRepGProp)")),
    ("ADAPTER", re.compile(
        r"^(BRepBuilderAPI_|BRep_Builder|BRepLib|BRepTools)")),
    ("REPRESENT", re.compile(
        r"^(gp_|TopoDS|TopExp|TopAbs_|TopTools_|TopLoc_|BRep_Tool|Geom_|Geom2d_|GeomAbs_|"
        r"GeomAdaptor|BRepAdaptor_|Poly_|Precision|Standard_|Bnd_|BndLib|GProp_|GC_|GCE2d_|"
        r"GCPnts_|ElCLib|ElSLib|Adaptor3d_|Approx_|AppDef_|Extrema_|IntAna_|IntCurve|"
        r"IntTools_|math_|NCollection_|TColgp_|TColStd_|TColGeom|Message_|OSD_|Interface_|"
        r"XSControl_|STEPControl_|StlAPI|RWStl)")),
]

# Anything that looks like an OCCT identifier at all: CamelCase_with_underscore,
# plus the handful of OCCT names that carry no underscore.
OCCTISH = re.compile(
    r"\b([A-Z][A-Za-z0-9]*_[A-Za-z0-9_]+|TopoDS|BRepTools|BRepLib|BRep_Tool|"
    r"BRep_Builder|Precision)\b")

# A native engine that cannot handle an input returns null rather than guessing.
# In the two engines that label their declines this is an FK_DEFER site, and the
# count is a far better predictor of what an engine contributes than composition.
DECLINE = re.compile(r"\bFK_DEFER(?:_F)?\b")


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
          % ("engine", "PRODUCES", "checks", "adapts", "spells", "declines",
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
