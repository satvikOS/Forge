# A jetsam report is not a kill record, and the fix I wrote for that was wrong

**2026-08-29 16:49.** The health monitor emitted its highest severity:

    OOM-KILL/JETSAM 16:49:13 (system) JetsamEvent-2026-08-29-164904.ips

**Nothing of ours died.** The 30 GB training job (`lora_eager_rope`, pid 29213) was
alive at iteration 1700 with its log written 2.5 minutes earlier.

## What the report actually contains

`bug_type 298` is a **memory-pressure snapshot of the entire process table**, not a
record of a kill. Measured on this one:

    processes listed          525
    states values             []  343    ['active'] 137    ['suspended'] 45
    a "killed" flag           NONE -- no such field exists in any entry
    largestProcess            "Python"   <- our training job, i.e. what drove the snapshot

The names that look like victims -- `StocksWidget`, `WeatherWidget`,
`CalendarWidgetExtension`, ~16 MB each -- are `suspended`, which is a **normal state
for an idle widget extension**, not evidence of a kill.

## The fix I wrote, tested, and reverted

I set out to de-escalate the alert when only disposable extensions were reclaimed:
extract every `"name"` from the report, filter out widget/extension-like names, and
emit amber if nothing substantial remained. It was implemented and then tested against
two inputs -- the real report, and a synthetic copy naming `python3.12`:

    REAL report (widgets only)      -> RED   KILLED: AccessibilityUIServer accountsd ...
    SYNTHETIC (python3.12 killed)   -> RED   KILLED: AccessibilityUIServer accountsd ...

**Both red, and for the same reason: the filter was reading the whole 525-entry process
table.** It could not distinguish the two cases at all, and shipped as written it would
have fired red on every jetsam event forever -- strictly worse than the alert it
replaced, while looking more sophisticated. Reverted, per the standing rule that a fix
proven inadequate is reverted rather than shipped as false assurance.

Note that the synthetic control is what caught it. The real report alone produced a red
alert, which is what I expected to see anyway; only the case that was supposed to differ
proved that nothing differed.

## What shipped instead

The one field the report carries reliably: `largestProcess`. The alert now reads

    OOM-KILL/JETSAM <ts> (system) largestProcess=Python [<file>] -- verify your long jobs are alive

Severity stays RED. **Absence of a kill flag is not proof that nothing was killed** --
it only means this report cannot tell me, and the honest response to "cannot tell" is to
keep the alarm and say what is known, not to invent a verdict.

## The general point

This is the third alarm this session that was severe, legitimate at the instant it
fired, and not actionable: a MACHINE-RESTARTED on 50 ms of clock drift, a MEMORY-LOW
that did not sustain, and now an OOM-KILL naming no victim. Each was worth the minutes
spent -- the correct response to a red alarm is to find out what it means, and two of
the three produced a real monitor improvement. The failure mode to avoid is not
"investigating a false alarm"; it is *silencing* one without understanding it.
