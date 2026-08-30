# The health monitor cried MACHINE-RESTARTED because microseconds drifted

**2026-08-29 14:39.** The armed health monitor emitted its most severe alert:

    MACHINE-RESTARTED 14:39:12 boot changed:
      '{ sec = 1787891513, usec = 539520 } Fri Aug 28 00:31:53 2026'
      -> '{ sec = 1787891513, usec = 589535 } Fri Aug 28 00:31:53 2026'

**The machine did not restart.** The seconds are identical (`1787891513`) and so is
the rendered date; only the microseconds moved, by 50 ms. macOS derives
`kern.boottime` as (now - uptime), so its `usec` field drifts on its own as the clock
is disciplined. The check compared the WHOLE string.

Three independent confirmations, because one is not enough for an alert this severe:

* `uptime` reported **up 1 day, 14:08** -- continuous since Aug 28 00:31.
* A process started **Fri Aug 28 03:13:10** was still alive; it could not have
  survived a reboot at 14:39 today.
* Three consecutive `sysctl -n kern.boottime` reads were byte-identical, so the value
  was not oscillating at read time either.

## The trap inside the fix

The obvious repair -- extract the seconds -- has a trap of its own:

    sed -n 's/.*sec = \([0-9]*\).*/\1/p'    ->  589535   WRONG, that is the usec

`"usec = "` CONTAINS `"sec = "`, and `.*` is greedy, so the pattern matches the
second occurrence. The extraction has to be anchored:

    sed -n 's/^{ sec = \([0-9][0-9]*\).*/\1/p'  ->  1787891513

## What is shipped

`bootsec()` in `~/.forge-health/healthmon.sh`, comparing seconds with a **60 second**
threshold, because NTP can nudge the seconds by one or two with no reboot, and
refusing to fire on an EMPTY reading -- a failed `sysctl` must not look like a
restart. Proved in both directions before re-arming:

    identical (the usec-drift case)  -> silent
    NTP nudge 5s                     -> silent
    45s drift                        -> silent
    REAL restart 1h later            -> FIRES (delta 3600s)
    REAL restart 1d later            -> FIRES (delta 86400s)
    empty sysctl reading             -> silent

The script was STOPPED before editing and re-armed after. zsh reads a script by byte
offset as it executes, so editing a running one can make it resume mid-token.

## Why this one matters more than a nuisance

A monitor exists to be believed. This programme's standing rule is to shed load only
on corroborated evidence, and the same rule applies to its own alarms: the correct
response to MACHINE-RESTARTED would have been drastic, and it was wrong. An alert
that fires on a 50 ms clock wobble trains its reader to discount the alert that
matters. The fix is not "raise the threshold" but **compare the quantity you actually
mean** -- and every severe alert should carry a corroborating observable, which this
one now does (it prints `uptime` alongside the delta).
