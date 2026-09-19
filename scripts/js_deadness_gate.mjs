#!/usr/bin/env node
/**
 * T-168 — JS deletion gate.
 *
 * Refuses to certify a file as deletable unless EVERY check below passes.
 * A gate that has only ever said yes is not a gate, so this one is designed
 * to be pointed at known-live files and REFUSE them. See --selftest.
 *
 *   node scripts/js_deadness_gate.mjs --set <listfile> [paths...]
 *   node scripts/js_deadness_gate.mjs --selftest
 *
 * --set <listfile>  the proposed deletion set. A file whose ONLY importers are
 *                   themselves inside the set is still dead (a dead cluster
 *                   dies together); an importer OUTSIDE the set is a refusal.
 *                   Without --set, every importer counts and the gate is at
 *                   its strictest.
 *
 * CHECKS
 *   C1 NOT_IMPORTED    no file outside the set names it with a module
 *                      specifier (relative, Vite-root `/src/...`, or `/@fs/...`).
 *   C2 NOT_IN_BUNDLE   absent from the Rollup module census of the shipped
 *                      bundle (regenerate with vite.config.census.mjs).
 *   C3 NOT_TEST        not under a test/fixture path. Tests are entered by a
 *                      runner, never by an import: "nothing imports it" is
 *                      NOT evidence of death for a test.
 *   C4 NOT_TOOL_ENTRY  not a config/tool entry (*.config.js, public/,
 *                      electron/, or a path named by any CI/config/shell file).
 *   C5 NOT_MENTIONED   its basename/stem appears in no non-markdown file
 *                      outside the set — catches string-keyed dispatch.
 *   C6 NOT_RESEARCH    not under a research/corpus/benchmark asset path.
 *
 * THE MIRROR TEST, which --selftest and --audit both miss. Every automated
 * check here asserts the gate says NO. A gate that refused EVERY file would
 * pass all of them and be equally useless. It cannot be a committed test
 * without committing a dead file to a repository whose point is deleting them,
 * so it is a recipe -- run it if you change C1-C6:
 *
 *   printf 'export const p = () => 42;\\n' > frontend/src/__probe.js
 *   git add -f frontend/src/__probe.js
 *   node scripts/js_deadness_gate.mjs frontend/src/__probe.js   # must CERTIFY, rc=0
 *   git rm -q -f --cached frontend/src/__probe.js && rm frontend/src/__probe.js
 *
 * Measured 2026-09-18: 1 certified, 0 refused, rc=0, while all 12 live
 * controls were refused. The gate discriminates in both directions.
 *
 * STILL OPEN: --audit proves each check fires and abstains across the twelve
 * controls, but those controls were chosen as positives. A check with a subtly
 * wrong predicate could still fire and abstain in the right proportions. That
 * wants negative controls chosen adversarially per check, which this file does
 * not have.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const EXTS = ['.js', '.jsx', '.mjs', '.cjs']
const argv = process.argv.slice(2)

const TEST_RE = /(^e2e\/|\/test\/|\/tests\/|\/__tests__\/|\.test\.|\.spec\.|\/fixtures?\/|^forge-kernel\/test\/)/
const RESEARCH_RE = /(^projects\/|^data\/|^retrieval\/|^cadgenbench|^implementation\/|corpus|benchmark|\/golden\/|\.jsonl$)/
const TOOL_ENTRY_RE = /(\.config\.(js|mjs|cjs)$|^frontend\/public\/|^electron\/|^playwright\.config\.js$)/

const tracked = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n').filter(Boolean)
const JS = tracked.filter(f => EXTS.some(e => f.endsWith(e)))
const JSSET = new Set(JS)

// ---- the deletion set under consideration ----
let SET = new Set()
const si = argv.indexOf('--set')
if (si !== -1) {
  SET = new Set(fs.readFileSync(argv[si + 1], 'utf8').split('\n').filter(Boolean))
}

// ---- the Rollup census of the shipped bundle (C2) ----
const CENSUS = path.join(ROOT, 'scripts', 'js_live_bundle.txt')
let bundle = new Set()
if (fs.existsSync(CENSUS)) {
  bundle = new Set(fs.readFileSync(CENSUS, 'utf8').split('\n').filter(Boolean))
} else {
  console.error(`gate: FATAL — missing bundle census ${path.relative(ROOT, CENSUS)}`)
  console.error('gate: refusing to run blind; regenerate it before using this gate.')
  process.exit(3)
}

// ---- read every text file once ----
const SKIP_BIN = /\.(png|jpe?g|gif|pdf|docx|zip|step|stp|stl|node|ico|woff2?|mp4|bin|wasm)$/i
// A file cannot be kept alive by the instrument that judges it. This gate's own
// source lists every control path, and the census lists every bundled module,
// so leaving them in the corpus lets C5 "find a mention" that is nothing but
// this gate reading itself: e2e/push-116-bom-aggregator.spec.js was named in
// exactly one non-markdown file, and that file was js_deadness_gate.mjs.
const SELF_REFS = new Set(['scripts/js_deadness_gate.mjs', 'scripts/js_live_bundle.txt'])
const texts = new Map()
for (const f of tracked) {
  if (SKIP_BIN.test(f) || SELF_REFS.has(f)) continue
  const abs = path.join(ROOT, f)
  try {
    if (!fs.statSync(abs).isFile()) continue
    texts.set(f, fs.readFileSync(abs, 'utf8'))
  } catch { /* unreadable -> skip */ }
}

// paths named by any CI / config / shell / json file (C4)
const CONFIGISH = /\.(ya?ml|json|sh|cmake|toml|html|webmanifest)$|^\.github\//
const namedByConfig = new Set()
for (const [f, t] of texts) {
  if (!CONFIGISH.test(f)) continue
  for (const m of t.matchAll(/[A-Za-z0-9_./-]+\.(?:js|jsx|mjs|cjs)/g)) {
    namedByConfig.add(m[0].replace(/^\.\//, ''))
  }
}

const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g
const FS_RE = /['"](?:\/@fs)?(\/[A-Za-z0-9_./@-]+\.(?:js|jsx|mjs|cjs))['"]/g

function resolveSpec(spec, importer) {
  let base
  if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), spec))
  else if (spec.startsWith('/src/')) base = 'frontend' + spec
  else if (spec.includes('/frontend/src/')) base = 'frontend/src/' + spec.split('/frontend/src/')[1]
  else return null
  const cands = [base]
  const ext = path.extname(base)
  if (EXTS.includes(ext)) cands.push(...EXTS.map(e => base.slice(0, -ext.length) + e))
  else cands.push(...EXTS.map(e => base + e))
  cands.push(...EXTS.map(e => path.posix.join(base, 'index' + e)))
  for (const c of cands) if (JSSET.has(c)) return c
  return null
}

// importer graph: target -> [importers]
const importers = new Map()
for (const [f, t] of texts) {
  if (!EXTS.some(e => f.endsWith(e))) continue
  const seen = new Set()
  for (const m of t.matchAll(SPEC_RE)) seen.add(m[1])
  for (const m of t.matchAll(FS_RE)) seen.add(m[1])
  for (const spec of seen) {
    const r = resolveSpec(spec, f)
    if (r && r !== f) {
      if (!importers.has(r)) importers.set(r, new Set())
      importers.get(r).add(f)
    }
  }
}

const ALL_CHECKS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']

// `enabled` exists so each check can be run IN ISOLATION. A positive control
// that refuses because some OTHER check happened to fire is not exercising the
// check it is named for -- see --audit.
function check(file, enabled = new Set(ALL_CHECKS)) {
  const fails = []
  const warns = []
  if (!JSSET.has(file)) return { file, fails: ['NOT_TRACKED: not a tracked js-family file'], warns }

  // C1 nothing outside the deletion set imports it
  const imps = enabled.has('C1') ? [...(importers.get(file) || [])].filter(i => !SET.has(i)) : []
  if (imps.length) fails.push(`C1 NOT_IMPORTED: imported by ${imps.length} live file(s): ${imps.slice(0, 4).join(', ')}`)

  // C2 not in the shipped Rollup bundle
  if (enabled.has('C2') && bundle.has(file)) fails.push('C2 NOT_IN_BUNDLE: present in the shipped Rollup bundle census')

  // C3 not a test/fixture
  if (enabled.has('C3') && TEST_RE.test(file)) fails.push('C3 NOT_TEST: lives under a test/fixture path (entered by a runner, not an import)')

  // C4 not a config/tool entry
  if (enabled.has('C4') && TOOL_ENTRY_RE.test(file)) fails.push('C4 NOT_TOOL_ENTRY: a config/tool entry point')
  const base = path.basename(file)
  if (enabled.has('C4') && (namedByConfig.has(file) || namedByConfig.has(base))) {
    fails.push(`C4 NOT_TOOL_ENTRY: named by a CI/config/shell file`)
  }

  // C5 basename/stem not mentioned outside the set.
  // A NON-DISTINCTIVE basename ("index.js" occurs in 25 unrelated files) would
  // refuse every barrel file and pin its whole cluster alive. For those, match
  // on the last two path segments instead, and skip the bare-stem test.
  const stem = base.replace(/\.(js|jsx|mjs|cjs)$/, '')
  const GENERIC = /^(index|main|utils?|types?|constants|helpers)$/i.test(stem)
  const token = GENERIC ? `${path.basename(path.dirname(file))}/${base}` : base
  const mentions = []
  for (const [f, t] of (enabled.has('C5') ? texts : [])) {
    if (f === file || SET.has(f)) continue
    if (t.includes(token)) { mentions.push(f); continue }
    if (!GENERIC && (t.includes(`'${stem}'`) || t.includes(`"${stem}"`))) mentions.push(f)
  }
  const code = mentions.filter(m => !m.endsWith('.md'))
  const docs = mentions.filter(m => m.endsWith('.md'))
  if (code.length) fails.push(`C5 NOT_MENTIONED: named in ${code.length} non-markdown file(s): ${code.slice(0, 4).join(', ')}`)
  if (docs.length) warns.push(`C5 doc-only mention in ${docs.length} markdown file(s) (not a refusal)`)

  // C6 not a research asset
  if (enabled.has('C6') && RESEARCH_RE.test(file)) fails.push('C6 NOT_RESEARCH: lives under a research/corpus/benchmark path')

  return { file, fails, warns }
}

// ------------------------------------------------------------------ selftest
if (argv.includes('--selftest')) {
  // Files that MUST be refused. If any is certified deletable the gate is broken.
  // Each control names the ONE check it exists to exercise. --audit proves that
  // check refuses it IN ISOLATION, with all five others switched off.
  const CONTROLS = [
    { f: 'frontend/src/main.jsx',                  c: 'C2', why: 'the HTML entry; in the bundle' },
    { f: 'frontend/src/App.jsx',                   c: 'C2', why: 'bundled root component' },
    { f: 'frontend/src/kernel/forge/index.js',     c: 'C1', why: 'imported by 17 live files' },
    { f: 'frontend/src/forge-v4/ForgeShellV4.jsx', c: 'C2', why: 'bundled UI shell' },
    { f: 'frontend/vite.config.js',                c: 'C4', why: 'the build config itself' },
    { f: 'frontend/public/sw.js',                  c: 'C4', why: 'public/, reached by a string in index.html' },
    { f: 'electron/main.js',                       c: 'C4', why: 'package.json "main"' },
    { f: 'playwright.config.js',                   c: 'C4', why: 'the test-runner config' },
    { f: 'e2e/push-116-bom-aggregator.spec.js',    c: 'C3', why: 'a test, entered by a runner' },
    { f: 'forge-kernel/test/smoke.js',             c: 'C3', why: 'OCCT-ratchet kernel test' },
    { f: 'projects/ge9x/lib/simulate.mjs',         c: 'C6', why: 'research asset' },
    // C5 had NO control until the audit measured it: deleting the C5 body left
    // both --selftest and --audit green, and C5 is the check that produced 81
    // of the 82 real refusals. MoldFlow.js is unreachable by import graph yet
    // named by two live UI files (WorkbenchRail.jsx, i18n.js) -- string-keyed
    // dispatch, which is the only thing C5 exists to catch.
    { f: 'frontend/src/kernel/manufacturing/MoldFlow.js', c: 'C5', why: 'named by live UI (string dispatch)' },
  ]
  const mustRefuse = CONTROLS.map(x => x.f)
  if (argv.includes('--audit')) {
    // For each control: does its INTENDED check refuse it with every other
    // check disabled? A control carried by some other check is not testing
    // what its name claims. Also reports whether the intended check is the
    // SOLE reason, i.e. whether removing it flips the case to accept.
    let broken = 0
    console.log('AUDIT — does each control exercise the check it is named for?\n')
    console.log('  control                                      intended  alone?  sole?  also-fires')
    for (const { f, c, why } of CONTROLS) {
      const alone = check(f, new Set([c]))
      const without = check(f, new Set(ALL_CHECKS.filter(x => x !== c)))
      const aloneRefuses = alone.fails.some(x => x.startsWith(c))
      const untracked = alone.fails.some(x => x.startsWith('NOT_TRACKED'))
      const sole = without.fails.length === 0
      const also = [...new Set(without.fails.map(x => x.slice(0, 2)))].join(',') || '-'
      if (!aloneRefuses || untracked) broken++
      console.log(`  ${f.padEnd(44)} ${c}        ${aloneRefuses && !untracked ? 'YES   ' : '**NO**'}  ${sole ? 'yes  ' : 'no   '}  ${also}`)
    }
    console.log(`\naudit: ${CONTROLS.length - broken}/${CONTROLS.length} controls verified to exercise their intended check in isolation`)
    if (broken) console.log('audit: RED — a control does not exercise the check it is named for')

    // DISCRIMINATION. The test above proves each check FIRES. It cannot tell a
    // real check from one that refuses everything, and "refuses everything" is
    // the failure mode that silently makes a deletion gate useless. So every
    // check must also ABSTAIN on at least one control. C5 failed this at first
    // (12/12) for a circular reason: the gate's own source lists every control
    // path, so C5 was reading this file and calling it a mention. Excluding the
    // instrument from its own corpus dropped it to 11/12.
    let flat = 0
    console.log('\nDISCRIMINATION — a check that never abstains cannot be told from "always refuse"')
    console.log('  check  fires on  abstains on  verdict')
    for (const c of ALL_CHECKS) {
      const fires = CONTROLS.filter(({ f }) => check(f, new Set([c])).fails.some(x => x.startsWith(c)))
      const n = fires.length, total = CONTROLS.length
      const ok = n > 0 && n < total
      if (!ok) flat++
      console.log(`  ${c}     ${String(n).padStart(2)}/${total}     ${String(total - n).padStart(2)}/${total}       ` +
                  (ok ? 'discriminates' : n === 0 ? '** NEVER FIRES **' : '** FIRES ON EVERYTHING **'))
    }
    console.log(`\ndiscrimination: ${ALL_CHECKS.length - flat}/${ALL_CHECKS.length} checks both fire and abstain`)
    if (flat) console.log('discrimination: RED — a check that never abstains proves nothing by refusing')
    process.exit(broken === 0 && flat === 0 ? 0 : 1)
  }

  let bad = 0
  console.log('SELFTEST — every file below MUST be refused\n')
  for (const f of mustRefuse) {
    const r = check(f)
    // A path that is not tracked is refused by NOT_TRACKED before any live-file
    // reasoning happens, so it would "pass" this selftest while proving
    // nothing. That is a guard arming on input it never examined: the original
    // list carried frontend/src/forge-v4/RibbonBar.jsx, a file that does not
    // exist, and it counted as one of eleven passes. A missing entry is now a
    // HARD FAILURE, so a typo or a renamed file can never again be scored as
    // evidence that the gate refuses live code.
    const untracked = r.fails.some(x => x.startsWith('NOT_TRACKED'))
    const real = r.fails.filter(x => !x.startsWith('NOT_TRACKED'))
    let verdict
    if (untracked) { verdict = '*** BROKEN SELFTEST (path not tracked) ***'; bad++ }
    else if (!real.length) { verdict = '*** CERTIFIED (GATE IS BROKEN) ***'; bad++ }
    else verdict = 'REFUSED '
    console.log(`${verdict} ${f}`)
    for (const x of r.fails) console.log(`          ${x}`)
  }
  console.log(`\nselftest: ${mustRefuse.length - bad}/${mustRefuse.length} correctly refused` +
              ` (each for a reason other than "the path does not exist")`)
  process.exit(bad === 0 ? 0 : 1)
}

// ------------------------------------------------------------------ normal
const targets = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--set')
const list = targets.length ? targets : [...SET]
let refused = 0
const certified = []
for (const f of list) {
  const r = check(f)
  if (r.fails.length) {
    refused++
    console.log(`REFUSED  ${f}`)
    for (const x of r.fails) console.log(`         ${x}`)
  } else {
    certified.push(f)
    if (process.env.GATE_VERBOSE) console.log(`certified ${f}`)
  }
}
console.log(`\ngate: ${list.length} examined  |  ${certified.length} certified deletable  |  ${refused} REFUSED`)
if (process.env.GATE_OUT) fs.writeFileSync(process.env.GATE_OUT, certified.join('\n') + '\n')
process.exit(refused ? 1 : 0)
