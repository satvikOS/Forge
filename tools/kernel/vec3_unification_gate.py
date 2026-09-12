#!/usr/bin/env python3
"""vec3_unification_gate.py — the Vec3 vocabulary stays unified, and stays safe.

WHY THIS EXISTS. `Vec3` had TEN layout-identical definitions in forge-kernel, in
ten namespaces, none of them the canonical forge/math/Vec3.hpp -- which existed,
carried a superset of every copy, and was included by no file under native/ at
all. Ten types that cannot interoperate need a conversion at every module seam,
and leave no single type to migrate the OCCT gp_Pnt/gp_Vec/gp_Dir uses ONTO.
They are now one type, reached by alias.

Two things can silently undo that, and this gate makes both loud:

  (1) A new module declares its own `struct Vec3` again. Nothing would fail --
      it compiles, it passes every test -- and the count goes back up.

  (2) Someone "tidies up" by deleting the modules' free dot/cross/length/
      normalize and routing them to the canonical ones. That is NOT equivalent.
      MEASURED: the zero-length guards use different epsilons (materials
      DBL_MIN, composites 1e-300, canonical 1e-15), so a vector of length 1e-20
      normalizes to {1,0,0} under the modules and to {0,0,0} under the canonical
      member. Numerics in nine subsystems would shift with nothing going red.

  The converse -- free dot/cross/length/normalize at namespace scope IN the
  canonical header -- is also barred: those wrappers are found by ADL alongside
  each module's own, and MEASURED, they broke exactly 28 translation units on
  exactly those four names. Outside their own unit test, which called
  them unqualified through ADL, no production file called them at all.

Run with --selftest to prove each check can actually go RED.
"""
import re, subprocess, sys, tempfile, pathlib, shutil, os

CANON = 'forge-kernel/include/forge/math/Vec3.hpp'
GUARDED_EPS = {  # module free-normalize functions whose epsilon must not be "unified"
    'forge-kernel/src/native/materials/Materials.cpp':   'normalizeV',
    'forge-kernel/src/native/composites/Composites.cpp': 'normalize3',
}

def tracked(root):
    out = subprocess.run(['git', 'ls-files', 'forge-kernel'], cwd=root,
                         capture_output=True, text=True, check=True).stdout
    return [l for l in out.splitlines() if l.endswith(('.hpp', '.cpp', '.h', '.cc'))]

def check(root):
    fails = []
    root = pathlib.Path(root)

    # (1) exactly one struct Vec3, and it is the canonical one
    defs = []
    for rel in tracked(root):
        p = root / rel
        if not p.exists():
            continue
        for i, line in enumerate(p.read_text(errors='replace').splitlines(), 1):
            # `\{?\s*$` would MISS a single-line `struct Vec3 { double x, y, z; };`
            # -- the cheapest way to re-fragment and the one this gate exists to stop.
            if re.match(r'\s*struct\s+Vec3\s*(\{|$)', line):
                defs.append(f'{rel}:{i}')
    if defs != [f'{CANON}:29'] and [d.split(':')[0] for d in defs] != [CANON]:
        fails.append(f'Vec3 is declared in {len(defs)} place(s), expected only {CANON}:\n'
                     + '\n'.join('      ' + d for d in defs))

    # (2) the canonical header declares no namespace-scope dot/cross/length/normalize
    canon = (root / CANON).read_text(errors='replace')
    # Strip the struct body first: `a.dot(b)` as a MEMBER is fine and is what the
    # modules now call; only a namespace-scope overload is ADL-ambiguous.
    outside, depth, in_struct = [], 0, False
    for line in canon.splitlines():
        if re.match(r'\s*struct\s+Vec3\s*\{', line):
            in_struct, depth = True, line.count('{') - line.count('}')
            continue
        if in_struct:
            depth += line.count('{') - line.count('}')
            if depth <= 0:
                in_struct = False
            continue
        outside.append(line)
    outside = '\n'.join(outside)
    bad = [n for n in ('dot', 'cross', 'length', 'normalize')
           if re.search(rf'^\s*(constexpr\s+)?(inline\s+)?\w[\w:<>]*\s+{n}\s*\(', outside, re.M)]
    if bad:
        fails.append(f'{CANON} declares free {", ".join(bad)} at namespace scope; '
                     'ADL finds these alongside each module\'s own and 28 TUs stop compiling')

    # (3) the modules keep their own epsilon-guarded normalize
    for rel, fn in GUARDED_EPS.items():
        p = root / rel
        if not p.exists():
            fails.append(f'{rel} is gone; its {fn} epsilon guard cannot be checked')
        elif not re.search(rf'\b{fn}\s*\(', p.read_text(errors='replace')):
            fails.append(f'{rel} no longer defines {fn}; if its callers now reach the '
                         'canonical normalized() the zero-length epsilon changed silently')
    return fails

def _baseline(root, td):
    """A clone of HEAD **plus the working-tree diff**, asserted GREEN.

    A bare clone of HEAD is NOT a valid control here: before this gate landed the
    tree had ten Vec3 declarations, so check (1) fails on it no matter what the
    mutation does, and every RED would be unattributable. The baseline must be
    green or the selftest reports nothing.
    """
    dst = pathlib.Path(td) / 'r'
    subprocess.run(['git', 'clone', '-q', '--no-hardlinks', '--depth', '1',
                    'file://' + os.path.abspath(root), str(dst)],
                   check=True, capture_output=True)
    diff = subprocess.run(['git', 'diff', 'HEAD'], cwd=root,
                          capture_output=True, text=True, check=True).stdout
    if diff.strip():
        subprocess.run(['git', 'apply', '--allow-empty', '-'], cwd=dst,
                       input=diff, text=True, check=True)
    # untracked-but-staged-later files (this gate itself) do not affect check()
    pre = check(dst)
    if pre:
        raise SystemExit('[vec3-gate] selftest VOID — baseline is already red:\n   '
                         + '\n   '.join(pre))
    return dst


def selftest(root):
    """Each check must go RED when its invariant is broken, or it proves nothing."""
    ok = True
    for name, mutate in [
        ('a second struct Vec3 reappears',
         lambda d: (d / 'forge-kernel/include/forge/native/mesh/HalfEdgeMesh.hpp')
                   .write_text('struct Vec3 {\n    double x, y, z;\n};\n')),
        ('a second struct Vec3 reappears ON ONE LINE',
         lambda d: (d / 'forge-kernel/include/forge/native/mesh/HalfEdgeMesh.hpp')
                   .write_text('struct Vec3 { double x, y, z; };\n')),
        ('canonical header regains a free dot()',
         lambda d: (d / CANON).write_text((d / CANON).read_text() +
                   '\nnamespace forge { namespace math {\n'
                   'constexpr inline double dot(const Vec3& a, const Vec3& b) { return a.dot(b); }\n'
                   '}}\n')),
        ("a module's guarded normalize is deleted",
         lambda d: (d / 'forge-kernel/src/native/composites/Composites.cpp').write_text(
                   (d / 'forge-kernel/src/native/composites/Composites.cpp')
                   .read_text().replace('normalize3', 'REMOVED_normalize3'))),
    ]:
        with tempfile.TemporaryDirectory() as td:
            dst = _baseline(root, td)      # green before the mutation, or VOID
            mutate(dst)
            red = bool(check(dst))
            print(f'  {"RED " if red else "GREEN"}  {name}'
                  f'{"" if red else "   <- gate did NOT catch it"}')
            ok &= red
    return ok

if __name__ == '__main__':
    root = pathlib.Path(__file__).resolve().parents[2]
    if '--selftest' in sys.argv:
        print('[vec3-gate] selftest — each invariant must be falsifiable')
        sys.exit(0 if selftest(root) else 1)
    f = check(root)
    if f:
        print('[vec3-gate] RED')
        for x in f:
            print('   ' + x)
        sys.exit(1)
    print('[vec3-gate] ok — Vec3 is one type; the canonical header adds no ADL-ambiguous '
          'free functions; module epsilon guards intact')
