#!/usr/bin/env node
/**
 * T-171 — NEGATIVE CONTROLS for scripts/js_deadness_gate.mjs.
 *
 *   node scripts/js_deadness_controls.mjs            # isolation table
 *   node scripts/js_deadness_controls.mjs --mutate   # + source-level mutants
 *
 * WHAT WAS WRONG WITH THE OLD CONTROLS. js_deadness_gate.mjs --selftest carries
 * twelve POSITIVE controls: real live files that must be refused. Eleven of the
 * twelve are refused by three or four checks at once, so each one proves only
 * that SOMETHING refused it. That is how all six checks could be deleted with
 * --selftest still green: one broad check (C5, which fired on 11 of 12) carried
 * every control, and C5 itself had no control at all until the audit found it.
 *
 * WHAT A NEGATIVE CONTROL IS HERE. For each check, an input that THAT CHECK AND
 * ONLY THAT CHECK refuses -- every other check abstains on it. Then the check is
 * switched off and the verdict must flip to not-refused. Isolation says "no
 * neighbour is carrying this"; the flip says "this check is what refused it".
 * A check with no such input is indistinguishable from `return true` on the
 * inputs we own, and that is reported rather than papered over.
 *
 * WHY THE PROBE NAMES ARE RANDOM. The gate previously kept files alive by
 * reading its own source: its control list names paths, and C5 counted those
 * names as live references. A blocklist of "files the gate must not read" fixes
 * that case and not the next one. So every probe basename here carries a random
 * per-run token, which means NO tracked file -- this harness included -- can
 * contain it as a literal. The self-reference is impossible by construction
 * rather than excluded by a list, and the harness ASSERTS it below.
 *
 * WHY THE FIXTURE IS NOT A SYNTHETIC REPO. An earlier attempt built a fake tree
 * with the gate's real inventory hardcoded into it, so adding a real gate turned
 * its own green control red. These probes are added to the REAL repository,
 * declare nothing about its contents, and are removed again.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const GATE = path.join(ROOT, 'scripts', 'js_deadness_gate.mjs')
const MUTATE = process.argv.includes('--mutate')

const R = crypto.randomBytes(5).toString('hex')
const DIR = `frontend/src/__gatectl_${R}`
const P = `zz${R}_`

// ---------------------------------------------------------------- the fixture
// `file` is the probe the gate is pointed at. `aux` are supporting files that
// exist only to make exactly one predicate true. `check` is the ONE check that
// must refuse it.
const FIXTURES = [
  {
    check: 'C1', label: 'C1 NOT_IMPORTED',
    file: `${DIR}/${P}c1.js`,
    body: 'export const c1 = () => 1\n',
    // The importer must reach the probe WITHOUT naming its basename, or C5 fires
    // too and C1 is unisolable. An extension-less specifier does exactly that:
    // resolveSpec appends the extension, so the import graph sees it and the
    // substring search does not.
    aux: [{ p: `${DIR}/${P}c1imp.js`, b: `import './${P}c1'\nexport const imp = 1\n` }],
    why: 'imported by a live file through an extension-less specifier',
  },
  {
    check: 'C2', label: 'C2 NOT_IN_BUNDLE',
    file: `${DIR}/${P}c2.js`,
    body: 'export const c2 = () => 2\n',
    aux: [], census: true,
    why: 'listed in the Rollup census and nothing else',
  },
  {
    check: 'C3', label: 'C3 NOT_TEST',
    file: `${DIR}/${P}c3.test.js`,
    body: 'export const c3 = () => 3\n',
    aux: [],
    why: 'a test path; nothing imports it, which is the point',
  },
  {
    check: 'C4a', only: 'C4', label: 'C4 NOT_TOOL_ENTRY (pattern)',
    file: `${DIR}/${P}c4a.config.js`,
    body: 'export default { c4a: true }\n',
    aux: [],
    why: 'matches the *.config.js tool-entry pattern',
  },
  {
    check: 'C4b', only: 'C4', label: 'C4 NOT_TOOL_ENTRY (named by config)',
    // C4's second clause matches a BARE BASENAME against every path any config
    // names. For a distinctive basename that clause is a strict subset of C5 --
    // a file named in a config is by definition mentioned in a non-markdown
    // file -- so it is isolable ONLY through a basename C5 treats as generic,
    // where C5 switches to <parent>/<base> and skips the bare-stem test.
    // Isolating this clause is therefore also the measurement that shows how
    // over-broad it is: one config saying "main.js" pins EVERY main.js alive.
    file: `${DIR}/main.js`,
    body: 'export const c4b = () => 4\n',
    aux: [{ p: `${DIR}/${P}c4b.json`, b: '{\n  "main": "main.js"\n}\n' }],
    why: 'a config names its bare basename',
  },
  {
    check: 'C5', label: 'C5 NOT_MENTIONED',
    file: `${DIR}/${P}c5.js`,
    body: 'export const c5 = () => 5\n',
    // A quoted mention that is NOT a module specifier: no `from`, no `import(`,
    // no `require(`, no leading slash. Invisible to both import graphs, visible
    // to a substring search. This is the string-keyed dispatch C5 exists for.
    aux: [{ p: `${DIR}/${P}c5men.js`, b: `export const REGISTRY = { probe: '${P}c5.js' }\n` }],
    why: 'named by a live file as a bare string, never imported',
  },
  {
    check: 'C6', label: 'C6 NOT_RESEARCH',
    file: `${DIR}/${P}c6corpus.js`,
    body: 'export const c6 = () => 6\n',
    aux: [],
    why: 'its path matches the research/corpus predicate',
  },
]

const ALL_FILES = FIXTURES.flatMap(f => [{ p: f.file, b: f.body }, ...f.aux])

// ------------------------------------------------------------------ scaffold
function write() {
  fs.mkdirSync(path.join(ROOT, DIR), { recursive: true })
  for (const { p, b } of ALL_FILES) fs.writeFileSync(path.join(ROOT, p), b)
  execFileSync('git', ['-C', ROOT, 'add', '-f', ...ALL_FILES.map(x => x.p)])
}
function clean() {
  try { execFileSync('git', ['-C', ROOT, 'rm', '-q', '-f', '--cached', ...ALL_FILES.map(x => x.p)]) } catch {}
  fs.rmSync(path.join(ROOT, DIR), { recursive: true, force: true })
}

// A census that is the real one PLUS the C2 probe. The shipped census is never
// written to. Every other probe is absent from it, so substituting it can only
// change the C2 probe's verdict -- which the run below measures rather than
// assumes, by scoring every probe against both censuses.
function censusCopy() {
  const real = fs.readFileSync(path.join(ROOT, 'scripts', 'js_live_bundle.txt'), 'utf8')
  const c2 = FIXTURES.find(f => f.census).file
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gatectl-')), 'census.txt')
  fs.writeFileSync(out, real.replace(/\n*$/, '\n') + c2 + '\n')
  return out
}

// ------------------------------------------------------------------- running
function runGate(file, { without, only, census, gate = GATE } = {}) {
  const args = [gate]
  if (without) args.push(`--without=${without}`)
  if (only) args.push(`--only=${only}`)
  args.push(file)
  const env = { ...process.env }
  if (census) env.GATE_CENSUS = census; else delete env.GATE_CENSUS
  delete env.GATE_OUT
  const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', env })
  const out = (r.stdout || '') + (r.stderr || '')
  const codes = [...new Set([...out.matchAll(/^\s+(C\d|NOT_TRACKED)/gm)].map(m => m[1]))]
  return { rc: r.status, out, codes, refused: /^REFUSED\s/m.test(out) }
}

// -------------------------------------------------------------- the analysis
let exitCode = 0
write()
try {
  const CENSUS = censusCopy()

  // ---- 0. THE INSTRUMENT MUST NOT BE IN THE CORPUS IT MEASURES -------------
  // The old defect was C5 reading the gate's own source. A blocklist fixed that
  // instance; randomised probe names make the whole class impossible. Prove it
  // rather than assert it: no tracked file may contain a probe basename except
  // the aux file written to make it so.
  console.log('SELF-REFERENCE — can any tracked file name a probe? (the old C5 defect)\n')
  console.log('  probe basename                     tracked files naming it')
  let selfref = 0
  const trackedNow = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n').filter(Boolean)
  for (const fx of FIXTURES) {
    const base = path.basename(fx.file)
    if (/^(index|main|utils?|types?|constants|helpers)\.(js|jsx|mjs|cjs)$/i.test(base)) {
      console.log(`  ${base.padEnd(34)} (generic basename — C5 matches <parent>/${base}, not scanned here)`)
      continue
    }
    const hits = []
    for (const f of trackedNow) {
      if (f === fx.file) continue
      let t; try { t = fs.readFileSync(path.join(ROOT, f), 'utf8') } catch { continue }
      if (t.includes(base)) hits.push(f)
    }
    const expected = fx.aux.map(a => a.p)
    const unexpected = hits.filter(h => !expected.includes(h))
    // The gate and this harness are the two files that must NEVER appear.
    const instrument = unexpected.filter(h => h.startsWith('scripts/js_deadness'))
    if (instrument.length) selfref++
    console.log(`  ${base.padEnd(34)} ${hits.length ? hits.join(', ') : '(none)'}` +
                (instrument.length ? `   *** INSTRUMENT READS ITSELF: ${instrument.join(',')} ***` : ''))
  }
  console.log(`\nself-reference: ${selfref === 0 ? 'clean — no probe is named by the gate or this harness' : `RED — ${selfref} probe(s) named by the instrument`}`)
  if (selfref) exitCode = 1

  // ---- 1. ISOLATION --------------------------------------------------------
  console.log('\n\nISOLATION — is each probe refused by its own check and NOTHING else?\n')
  console.log('  check  probe                                        refused-by      sole?  flips-when-disabled?')
  const rows = []
  for (const fx of FIXTURES) {
    const target = fx.only || fx.check
    const full = runGate(fx.file, { census: CENSUS })
    const off = runGate(fx.file, { without: target, census: CENSUS })
    const sole = full.refused && full.codes.length === 1 && full.codes[0] === target
    const flips = full.refused && !off.refused
    rows.push({ fx, target, full, off, sole, flips })
    if (!sole || !flips) exitCode = 1
    console.log(`  ${fx.check.padEnd(6)} ${path.basename(fx.file).padEnd(44)} ${(full.codes.join(',') || '(none)').padEnd(15)} ` +
                `${sole ? 'yes  ' : '**no**'}  ${flips ? 'yes' : '**no**'}`)
  }
  const nIso = rows.filter(r => r.sole && r.flips).length
  console.log(`\nisolation: ${nIso}/${rows.length} controls are refused by their own check ALONE and flip when it is disabled`)

  // ---- 2. THE CENSUS SUBSTITUTION IS SURGICAL ------------------------------
  // C2's control needs a census the shipped one does not have. If substituting
  // it moved any OTHER probe, C2's isolation would be an artefact of the fixture
  // rather than a property of the check.
  console.log('\n\nCENSUS SUBSTITUTION — does adding one census line move anything but the C2 probe?\n')
  console.log('  probe                                        real census   +C2 probe')
  let moved = []
  for (const fx of FIXTURES) {
    const a = runGate(fx.file, {})
    const b = runGate(fx.file, { census: CENSUS })
    const same = a.codes.join(',') === b.codes.join(',')
    if (!same) moved.push(fx.check)
    console.log(`  ${path.basename(fx.file).padEnd(44)} ${(a.codes.join(',') || '(none)').padEnd(13)} ${(b.codes.join(',') || '(none)')}${same ? '' : '   <- moved'}`)
  }
  const surgical = moved.length === 1 && moved[0] === 'C2'
  console.log(`\ncensus: ${surgical ? 'surgical — only the C2 probe moved' : `RED — moved: ${moved.join(',') || 'nothing (C2 control is inert)'}`}`)
  if (!surgical) exitCode = 1

  // ---- 3. MUTATION ---------------------------------------------------------
  // Isolation and the flip are both computed INSIDE one process by the same
  // `enabled` set. If that set were mishandled, both would agree and both would
  // be wrong. So: physically remove each check from a COPY of the gate's source
  // and re-run. A mutant that produced no substitution ran the unmutated source
  // and would have "passed" while measuring nothing, so the substitution count
  // is asserted before the mutant is trusted.
  if (MUTATE) {
    console.log('\n\nMUTATION — delete each check from the gate source; does exactly its own control survive?\n')
    const MUTANTS = [
      { id: 'C1',  needle: /fails\.push\((.)C1 NOT_IMPORTED/g,                     kills: ['C1'] },
      { id: 'C2',  needle: /fails\.push\((.)C2 NOT_IN_BUNDLE/g,                    kills: ['C2'] },
      { id: 'C3',  needle: /fails\.push\((.)C3 NOT_TEST/g,                         kills: ['C3'] },
      { id: 'C4a', needle: /fails\.push\((.)C4 NOT_TOOL_ENTRY: a config/g,         kills: ['C4a'] },
      { id: 'C4b', needle: /fails\.push\((.)C4 NOT_TOOL_ENTRY: named by a CI/g,    kills: ['C4b'] },
      { id: 'C5',  needle: /fails\.push\((.)C5 NOT_MENTIONED/g,                    kills: ['C5'] },
      { id: 'C6',  needle: /fails\.push\((.)C6 NOT_RESEARCH/g,                     kills: ['C6'] },
    ]
    const src = fs.readFileSync(GATE, 'utf8')
    const mdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatemut-'))
    console.log('  mutant  substitutions  survivors (probes still refused)                     verdict')
    for (const m of MUTANTS) {
      const n = (src.match(m.needle) || []).length
      const mutated = src.replace(m.needle, (s, q) => s.replace('fails.push(', 'NOOP('))
        .replace('const fails = []', 'const fails = []; const NOOP = () => {}')
      if (n === 0 || mutated === src) {
        console.log(`  ${m.id.padEnd(7)} ${String(n).padStart(2)}             *** NO SUBSTITUTION — this mutant ran the unmutated gate ***`)
        exitCode = 1
        continue
      }
      const mf = path.join(mdir, `gate_no_${m.id}.mjs`)
      fs.writeFileSync(mf, mutated)
      const survivors = []
      for (const fx of FIXTURES) {
        const r = runGate(fx.file, { census: CENSUS, gate: mf })
        if (r.refused) survivors.push(fx.check)
      }
      const expect = FIXTURES.map(f => f.check).filter(c => !m.kills.includes(c))
      const ok = survivors.join(',') === expect.join(',')
      if (!ok) exitCode = 1
      console.log(`  ${m.id.padEnd(7)} ${String(n).padStart(2)}             ${survivors.join(',').padEnd(40)} ` +
                  (ok ? `killed ${m.kills.join(',')} only` : `*** expected ${expect.join(',')} ***`))
    }
    fs.rmSync(mdir, { recursive: true, force: true })
  }

  console.log(`\n\ncontrols: ${exitCode === 0 ? 'GREEN' : 'RED'}`)
} finally {
  clean()
  const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' })
    .split('\n').filter(l => l.includes(`__gatectl_${R}`))
  if (dirty.length) {
    console.log(`controls: *** CLEANUP INCOMPLETE *** remove ${DIR} by hand`)
    exitCode = 1
  }
}
process.exit(exitCode)
