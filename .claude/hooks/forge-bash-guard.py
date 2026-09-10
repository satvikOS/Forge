#!/usr/bin/env python3
"""
forge-bash-guard — PreToolUse hook. Mechanical enforcement of the invariants that
must never be violated in this repository.

The operating manual's sharpest distinction is guidance versus enforcement:

    "'Never delete X' in CLAUDE.md is a behavioral instruction. A deny rule,
     pre-tool hook, filesystem permission, protected branch, or CI gate is a
     mechanical control. The latter is appropriate when violation is unacceptable."

Every rule below exists because the corresponding failure has ALREADY happened in
this program and cost real time. None of them are hypothetical.

Design constraint, also from the manual: "low friction for safe actions and high
friction for dangerous ones." Read-only inspection is never touched. Only the
narrow, named, irreversible shapes are blocked.
"""
import json, re, sys, os, subprocess

def out(decision, reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
        "permissionDecisionReason": reason}}))
    sys.exit(0)

try:
    ev = json.load(sys.stdin)
except Exception:
    sys.exit(0)                      # never break the session on a parse failure

if ev.get("tool_name") != "Bash":
    sys.exit(0)
cmd = (ev.get("tool_input") or {}).get("command", "")
if not cmd.strip():
    sys.exit(0)

SHARED = "/Users/account_clawteam1/archdisc-Mech"
cwd = ev.get("cwd") or ""
in_worktree = "/.claude/worktrees/" in cwd

# Strip quoted strings so a rule never fires on a command that merely MENTIONS a
# pattern (writing this file would otherwise trip half of its own rules).
scan = re.sub(r'<<\s*[\'"]?(\w+)[\'"]?.*?^\1', ' ', cmd, flags=re.S | re.M)
scan = re.sub(r'"[^"]*"|\'[^\']*\'', ' ', scan)

def hit(pat):
    """Substring match — for patterns that are unambiguous wherever they appear."""
    return re.search(pat, scan)

# Commands are matched in COMMAND POSITION: start of line, or after ; && || | ( etc.
# Substring matching alone denied `grep -rn pkill scripts/` — a read-only search that
# merely MENTIONS the word. That is the exact false positive the manual warns about:
# friction belongs on dangerous ACTIONS, not on reading about them.
CMD_POS = r'(?:^|[;&|(]|\|\||&&|\bthen\b|\bdo\b|\belse\b)\s*(?:sudo\s+|env\s+\S+=\S+\s+)*'

def cmd_is(*names):
    return re.search(CMD_POS + r'(?:' + '|'.join(names) + r')\b', scan)

# ---------------------------------------------------------------- 1. blast radius
# A machine-wide pattern kill takes out EVERY parallel agent's work, not just the
# caller's. Measured 2026-08-21: `pkill -f next-server` killed three live agents'
# servers at once. Kill by PID, which you must first have identified.
if cmd_is('pkill', 'killall') and not hit(r'\bpkill\s+-F\b'):
    out("deny",
        "BLOCKED: machine-wide pattern kill. pkill/killall match every agent's "
        "processes, not only yours — this took out three parallel agents' servers "
        "on 2026-08-21. Identify the PID first (ps/lsof, and verify the args are "
        "what you think), then `kill <pid>`.")

# `kill -9` on a pid you have not shown yourself is the same failure one step down.
if cmd_is(r'kill\s+-9\s+\$\(') or cmd_is(r'kill\s+[^;&|]*\$\(pgrep'):
    out("ask",
        "kill on a pid from an unverified substitution. pgrep -f also matches the "
        "shell wrapper running your own check — that killed healthy autopilots "
        "twice. Print the pid and its full args first, then kill it by number.")

# ------------------------------------------------------- 2. shared-checkout safety
# Moving HEAD in the shared tree moves it out from under every other agent AND
# every read-only auditor attached to it.
if not in_worktree and cwd.startswith(SHARED):
    if cmd_is(r'git\s+(?:checkout|switch)') and not hit(r'\bgit\s+checkout\s+--\s'):
        out("deny",
            f"BLOCKED: `git checkout/switch` in the SHARED checkout ({SHARED}). "
            "This moves HEAD out from under every other agent and every read-only "
            "auditor reading the tree — it corrupted 5 of 8 auditors mid-run and "
            "sent two agents' commits to the wrong branch. Use a worktree: "
            "`git worktree add -b work/<task> .claude/worktrees/<task> HEAD`.")
    if cmd_is(r'git\s+reset\s+--hard'):
        out("deny",
            "BLOCKED: `git reset --hard` in the SHARED checkout. If your cd landed "
            "somewhere other than you think, this destroys another agent's working "
            "tree. Do it inside your own worktree.")

# `git worktree add` onto a path that already exists fails, and the following `cd`
# then lands in a PRE-EXISTING worktree on ANOTHER branch.
m = re.search(r'git\s+worktree\s+add\s+(?:-b\s+\S+\s+)?(\S+)', cmd)
if m:
    p = m.group(1)
    if not p.startswith("-") and os.path.exists(os.path.expanduser(p)):
        out("deny",
            f"BLOCKED: worktree path already exists: {p}. `worktree add` will fail, "
            "and your `cd` then lands in a PRE-EXISTING worktree on another branch "
            "where a reset destroys someone else's work. Pick a fresh path, or "
            "remove the old worktree explicitly after proving it is not load-bearing.")

# The stash stack is shared across every worktree and every concurrent session.
if cmd_is(r'git\s+stash\s*(?:$|\||;|&)') or cmd_is(r'git\s+stash\s+pop'):
    out("deny",
        "BLOCKED: bare `git stash` / `git stash pop`. The stash stack is SHARED "
        "with the main checkout and every other worktree and session — you can pop "
        "another agent's work. Use a temporary WIP commit, or "
        "`git stash push -u -m '<unique-tag>'` and `apply` a captured SHA.")

# ------------------------------------------------------------- 3. build governor
# hw.ncpu-wide builds are how the workstation dies under a parallel agent fleet.
if cmd_is('cmake', 'ninja', 'make', 'xcodebuild') and hit(r'-j\s*\d+'):
    out("ask",
        "Hardcoded -j. forge-nproc is the only sanctioned source of build "
        "parallelism: it returns fewer jobs as Guardian escalates and 1 at RED, and "
        "2 when Guardian is absent. Use `-j \"$(forge-nproc)\"`, ideally wrapped in "
        "`forge-job --name <x> --peak-gb <n> -- ...` so Guardian can shed it.")

# ------------------------------------------------------------- 4. deletion safety
# "never delete because an agent thinks something is unused" — deterministic and
# evidence-based only.
if cmd_is(r'rm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR])'):
    DERIVED = (r'/(build|Build|node_modules|\.venv|__pycache__|dist|target|'
               r'CMakeFiles|\.cache|scratchpad|tmp|Temp)(/|\s|$)')
    if not re.search(DERIVED, scan):
        out("ask",
            "Recursive force delete outside a provably-derived path. Required "
            "sequence is DISCOVER -> CLASSIFY -> VERIFY RECOVERABILITY -> VERIFY "
            "NOT ACTIVE -> DRY RUN -> DELETE -> AUDIT. Two traps already sprung "
            "here: a clean, unlocked, witnessed worktree was still load-bearing "
            "because another repo ran a binary built inside it (check lsof, not "
            "git); and 'git tracked' is not 'backed up' — confirm the commit is on "
            "the correct remote first.")

# ----------------------------------------------------- 5. vendor/generated as source
if hit(r'\b(vim|nano|sed\s+-i|tee|>)\s*\S*(node_modules|third_party|3rdParty)/'):
    out("deny",
        "BLOCKED: editing vendored/generated code as source. Patch it through the "
        "build system or a tracked patch file, or the change vanishes on the next "
        "dependency refresh and nothing records why it existed.")

# ------------------------------------------------------ 6. the no-JavaScript doctrine
# Forge's production runtime is C++20/23 native. This catches the introduction, not
# the legacy dirs that already exist.
if cmd_is(r'npm\s+(?:i|install|add)', r'yarn\s+add', r'pnpm\s+add'):
    if re.search(r'forge-desktop|forge-kernel', cwd) or hit(r'forge-desktop|forge-kernel'):
        out("deny",
            "BLOCKED: adding a JavaScript dependency inside the native product core. "
            "Forge's production runtime is C++20/23 + Metal with no JavaScript "
            "application core (doctrine rule 3). Tooling that is not shipped belongs "
            "in tools/ or scripts/, not in forge-desktop/ or forge-kernel/.")

sys.exit(0)
