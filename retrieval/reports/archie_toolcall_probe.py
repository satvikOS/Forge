"""Can Archie emit a parseable tool call? — the probe D-0xx said must precede any wiring.

Deliberately generous to the model: an explicit schema, an explicit instruction to
call the tool, and THREE prompt styles. A failure here under these conditions is a
real capability finding; a pass tells us the plumbing is the only blocker.
"""
import json, os, re, sys
sys.path.insert(0, "scripts")
ROOT = os.getcwd()

TOOL = {
  "name": "web_search",
  "description": "Search the web for engineering standards, material properties or thread tables.",
  "parameters": {"type": "object",
                 "properties": {"query": {"type": "string", "description": "the search query"}},
                 "required": ["query"]},
}

SYS_JSON = ("You are Archie, a CAD engineering assistant. You have one tool:\n"
            + json.dumps(TOOL, indent=2)
            + "\n\nWhen you need information you do not have, respond with ONLY a JSON object:\n"
              '{"tool":"web_search","arguments":{"query":"..."}}\n'
              "Do not emit anything else. Do not emit CAD IR.")
SYS_XML = ("You are Archie, a CAD assistant with a web_search tool.\n"
           "To use it, emit exactly:\n<tool_call>web_search(query=\"...\")</tool_call>\n"
           "Emit nothing else.")
SYS_MIN = ("You have a tool called web_search that takes a query string. "
           "Use it by writing: CALL web_search(\"your query\")")

ASK = "What is the standard tapping drill diameter for an M12 x 1.75 threaded hole?"

CASES = [("json-schema", SYS_JSON), ("xml-tag", SYS_XML), ("minimal", SYS_MIN)]

def parseable(text):
    """Did it emit something a dispatcher could actually execute?"""
    hits = []
    try:
        m = re.search(r'\{[^{}]*"tool"\s*:\s*"web_search"[^{}]*\{[^{}]*\}[^{}]*\}', text, re.S)
        if m: json.loads(m.group(0)); hits.append("json")
    except Exception: pass
    if re.search(r'<tool_call>\s*web_search\s*\(', text): hits.append("xml")
    if re.search(r'CALL\s+web_search\s*\(\s*["\']', text): hits.append("minimal")
    if re.search(r'\bweb_search\b', text): hits.append("mentions-name")
    return hits

def main():
    adapter = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != "none" else None
    import archie_loop
    p = archie_loop.Planner(os.path.join(ROOT, "models", "qwen3-vl-30b-a3b-4bit"),
                            adapter, 300)
    print(f"\n{'='*70}\nADAPTER: {adapter or 'NONE (base model)'}\n{'='*70}")
    for name, sysmsg in CASES:
        out = p.plan([{"role": "system", "content": sysmsg},
                      {"role": "user", "content": ASK}])
        hits = parseable(out)
        print(f"\n--- {name} ---")
        print(f"  parseable: {hits or 'NO'}")
        print(f"  emitted  : {out[:300]!r}")
    print("\nDONE")

main()
