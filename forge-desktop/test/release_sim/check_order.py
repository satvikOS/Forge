#!/usr/bin/env python3
"""Did the publish step make the release visible only AFTER every asset was up?

Read from the calls the step actually made, not from the YAML: an ordering that
is right in the file and wrong at run time is exactly the class of defect a
static reading cannot see.
"""
import sys
lines = [l.rstrip("\n") for l in open(sys.argv[1])]
verbs = [l.split()[0] for l in lines if l.strip()]
publish = [i for i, l in enumerate(lines) if l.startswith("edit") and "--draft=false" in l]
upload  = [i for i, v in enumerate(verbs) if v == "upload"]
if not publish:
    sys.stderr.write("nothing ever takes the release out of draft: %r\n" % lines); sys.exit(1)
if not upload:
    sys.stderr.write("nothing ever uploads an asset: %r\n" % lines); sys.exit(1)
if min(publish) < max(upload):
    sys.stderr.write("made visible at call %d, last upload at call %d\n" % (min(publish), max(upload)))
    sys.exit(1)
