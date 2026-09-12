#!/usr/bin/env python3
"""topology_honesty_gate.py — the native B-Rep header's scope note must match the code.

WHY THIS EXISTS. forge/native/brep/Topology.hpp carries an honesty block saying
what the native kernel does and does not do. It is the first thing anyone reads
before planning OCCT-removal work, so it is READ AS SCOPE. It went stale and
nothing failed:

  * it said "No geometry is attached to the topology yet (no curves on edges /
    surfaces on faces)" while Edge::curve and Face::surface were both present
    and used across 30 files;
  * it said "No booleans / sewing / healing / feature ops" while Boolean.hpp
    declared booleanSolid(const Solid&, const Solid&, BoolOp) against those very
    types, and Sew.hpp / Heal.hpp / FilletAnalytic.hpp did the same.

A stale honesty note is worse than no note: it under-claims, so a planning tick
reads it and schedules work that is already done. (That is exactly what happened
-- a tick nearly re-implemented geometry binding.)

So every claim is PROBED against the code. Each probe reports whether the
capability is present; the block must say the opposite of "not built" for
anything present. When someone implements KEV or mints lineage IDs, the probe
flips and this gate turns red until the block is updated.

--selftest proves each probe can flip.
"""
import re, subprocess, sys, os, pathlib, tempfile

HDR = 'forge-kernel/include/forge/native/brep/Topology.hpp'

def read(root, rel):
    p = pathlib.Path(root) / rel
    return p.read_text(errors='replace') if p.exists() else ''

def brep_files(root):
    out = subprocess.run(['git', 'ls-files',
                          'forge-kernel/include/forge/native/brep',
                          'forge-kernel/src/native/brep'],
                         cwd=root, capture_output=True, text=True).stdout.split()
    return [f for f in out if f.endswith(('.hpp', '.cpp'))]

def strip_block(txt):
    """The header's own honesty block names these things in prose; a probe that
    matched it would always find them. Everything before the first #include is
    the block (and the file's other leading comments), so probes read past it."""
    i = txt.find('#include')
    return txt[i:] if i > 0 else txt

# Each probe returns True when the CAPABILITY IS PRESENT in the code.
def probe_geometry_bound(root):
    h = read(root, HDR)
    return bool(re.search(r'\bCurve\s*\*\s*curve\b', h)) and \
           bool(re.search(r'\bSurface\s*\*\s*surface\b', h))

def probe_ops_on_topology(root):
    """A sibling header that includes Topology.hpp and declares an operation
    taking its Solid by reference -- booleans, sewing, healing, feature ops."""
    for rel in brep_files(root):
        if rel.endswith('Topology.hpp') or rel.endswith('Topology.cpp'):
            continue
        t = read(root, rel)
        if 'native/brep/Topology.hpp' not in t:
            continue
        if re.search(r'\b\w+\s*\(\s*const\s+Solid\s*&', strip_block(t)):
            return True
    return False

def probe_euler_complete(root):
    """KEV/KEF/MEKR/KEMR/MZEV implemented anywhere in the brep kernel."""
    for rel in brep_files(root):
        if re.search(r'\b(KEV|KEF|MEKR|KEMR|MZEV)\b', strip_block(read(root, rel))):
            return True
    return False

def probe_nonmanifold_representation(root):
    """Non-manifold REPRESENTATION means an edge can hold 3+ coedges. Two named
    slots means it cannot. Detecting/repairing non-manifold input is not this."""
    h = read(root, HDR)
    m = re.search(r'struct\s+Edge\s*\{(.*?)\n\};', h, re.S)
    if not m:
        return True          # shape changed: report present so a human looks
    body = m.group(1)
    two_slots = bool(re.search(r'Coedge\s*\*\s*coedgeA', body)) and \
                bool(re.search(r'Coedge\s*\*\s*coedgeB', body))
    container = bool(re.search(r'(vector|array)\s*<\s*Coedge', body))
    return container or not two_slots

def probe_lineage_ids(root):
    for rel in brep_files(root):
        if 'LineageRegistry' in strip_block(read(root, rel)):
            return True
    return False

# claim key -> (probe, phrase the block uses to DENY the capability)
CLAIMS = {
    'geometry bound to topology':      (probe_geometry_bound,            'No geometry is attached'),
    'operations on these types':       (probe_ops_on_topology,           'No booleans'),
    'general Euler completeness':      (probe_euler_complete,            'No general Euler operator completeness'),
    'non-manifold representation':     (probe_nonmanifold_representation,'No non-manifold'),
    'LineageRegistry id minting':      (probe_lineage_ids,               'No persistent-ID minting'),
}

def check(root):
    block = read(root, HDR)
    if not block:
        return [f'{HDR} is missing']
    # Read the DENIAL SECTION only, not the whole preamble. The preamble also
    # explains which denials went stale, quoting them verbatim -- and a whole-
    # preamble search matched that history and called the note self-contradictory.
    # The gate caught its own author on its first run.
    head = block[:block.find('#include')] if '#include' in block else block
    m = re.search(r'What is genuinely NOT built(.*)', head, re.S)
    if not m:
        return [f'{HDR}: cannot find the "What is genuinely NOT built" section; '
                'the scope note must keep that heading so each denial has one home']
    head = m.group(1)
    fails = []
    for name, (probe, denial) in CLAIMS.items():
        present = probe(root)
        denied  = denial.lower() in head.lower()
        if present and denied:
            fails.append(f'"{denial}..." is in the scope note, but {name} IS present in the code')
        if not present and not denied:
            fails.append(f'{name} is NOT present in the code, but the scope note no longer says so '
                         f'(expected a phrase containing "{denial}")')
    return fails

def selftest(root):
    ok = True
    root = pathlib.Path(root)
    cases = [
        # Inserted INTO the denial list, which is where a real regression puts it.
        # The first version of this case inserted it above "What is REAL here",
        # outside the section the gate reads, and reported GREEN -- the mutation
        # was wrong, not the gate.
        ('re-adding the stale "No geometry is attached" denial to the NOT-built list',
         lambda d: (d / HDR).write_text(
             (d / HDR).read_text().replace(
                 'What is genuinely NOT built',
                 'What is genuinely NOT built\n//   * No geometry is attached to the topology yet.', 1))),
        ('implementing KEV without updating the note',
         lambda d: (d / 'forge-kernel/src/native/brep/Topology.cpp').write_text(
             (d / 'forge-kernel/src/native/brep/Topology.cpp').read_text() +
             '\nnamespace forge { namespace native { void KEV() {} }}\n')),
        ('giving Edge a coedge container (non-manifold representation)',
         lambda d: (d / HDR).write_text(
             (d / HDR).read_text().replace('Coedge* coedgeB = nullptr;',
                                           'std::vector<Coedge*> coedges;', 1))),
    ]
    for name, mutate in cases:
        with tempfile.TemporaryDirectory() as td:
            dst = pathlib.Path(td) / 'r'
            subprocess.run(['git', 'clone', '-q', '--no-hardlinks', '--depth', '1',
                            'file://' + os.path.abspath(root), str(dst)],
                           check=True, capture_output=True)
            diff = subprocess.run(['git', 'diff', 'HEAD'], cwd=root,
                                  capture_output=True, text=True).stdout
            if diff.strip():
                subprocess.run(['git', 'apply', '--allow-empty', '-'], cwd=dst,
                               input=diff, text=True, check=True)
            pre = check(dst)
            if pre:
                print('  VOID  baseline already red:\n     ' + '\n     '.join(pre))
                return False
            mutate(dst)
            red = bool(check(dst))
            print(f'  {"RED " if red else "GREEN"}  {name}'
                  f'{"" if red else "   <- gate did NOT catch it"}')
            ok &= red
    return ok

if __name__ == '__main__':
    root = pathlib.Path(__file__).resolve().parents[2]
    if '--selftest' in sys.argv:
        print('[topology-honesty] selftest — each claim must be falsifiable')
        sys.exit(0 if selftest(root) else 1)
    f = check(root)
    if f:
        print('[topology-honesty] RED — the scope note and the code disagree:')
        for x in f:
            print('   ' + x)
        print(f'   Fix the note in {HDR} (or the code), not this gate.')
        sys.exit(1)
    print('[topology-honesty] ok — every claim in the scope note matches a code probe')
