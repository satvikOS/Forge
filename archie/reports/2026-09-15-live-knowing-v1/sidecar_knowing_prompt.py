#!/usr/bin/env python3
"""Evidence only: serve.py UNCHANGED, with its DEFAULT_SYSTEM swapped at runtime for
the system prompt knowing-v1 was actually trained on (read verbatim from the
corpus's first training row). Nothing in archdisc-Models is modified.
"""
import json, sys
sys.path.insert(0, "/Users/account_clawteam1/archdisc-Models/tools/archie_sidecar")
import serve  # noqa: E402

with open("/Users/account_clawteam1/archdisc-Models/data/forge/knowing_v1/train.jsonl") as fh:
    row = json.loads(fh.readline())
system = next(m["content"] for m in row["messages"] if m["role"] == "system")
serve.DEFAULT_SYSTEM = system
print("[evidence] DEFAULT_SYSTEM replaced with knowing_v1's training system prompt "
      f"({len(system)} chars)", flush=True)
sys.exit(serve.main())
