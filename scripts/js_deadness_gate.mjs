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
const texts = new Map()
for (const f of tracked) {
  if (SKIP_BIN.test(f)) continue
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

function check(file) {
  const fails = []
  const warns = []
  if (!JSSET.has(file)) return { file, fails: ['NOT_TRACKED: not a tracked js-family file'], warns }

  // C1 nothing outside the deletion set imports it
  const imps = [...(importers.get(file) || [])].filter(i => !SET.has(i))
  if (imps.length) fails.push(`C1 NOT_IMPORTED: imported by ${imps.length} live file(s): ${imps.slice(0, 4).join(', ')}`)

  // C2 not in the shipped Rollup bundle
  if (bundle.has(file)) fails.push('C2 NOT_IN_BUNDLE: present in the shipped Rollup bundle census')

  // C3 not a test/fixture
  if (TEST_RE.test(file)) fails.push('C3 NOT_TEST: lives under a test/fixture path (entered by a runner, not an import)')

  // C4 not a config/tool entry
  if (TOOL_ENTRY_RE.test(file)) fails.push('C4 NOT_TOOL_ENTRY: a config/tool entry point')
  const base = path.basename(file)
  if (namedByConfig.has(file) || namedByConfig.has(base)) {
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
  for (const [f, t] of texts) {
    if (f === file || SET.has(f)) continue
    if (t.includes(token)) { mentions.push(f); continue }
    if (!GENERIC && (t.includes(`'${stem}'`) || t.includes(`"${stem}"`))) mentions.push(f)
  }
  const code = mentions.filter(m => !m.endsWith('.md'))
  const docs = mentions.filter(m => m.endsWith('.md'))
  if (code.length) fails.push(`C5 NOT_MENTIONED: named in ${code.length} non-markdown file(s): ${code.slice(0, 4).join(', ')}`)
  if (docs.length) warns.push(`C5 doc-only mention in ${docs.length} markdown file(s) (not a refusal)`)

  // C6 not a research asset
  if (RESEARCH_RE.test(file)) fails.push('C6 NOT_RESEARCH: lives under a research/corpus/benchmark path')

  return { file, fails, warns }
}

// ------------------------------------------------------------------ selftest
if (argv.includes('--selftest')) {
  // Files that MUST be refused. If any is certified deletable the gate is broken.
  const mustRefuse = [
    'frontend/src/main.jsx',                       // the HTML entry
    'frontend/src/App.jsx',                        // bundled
    'frontend/src/kernel/forge/index.js',          // bundled
    'frontend/src/forge-v4/RibbonBar.jsx',         // bundled UI
    'frontend/vite.config.js',                     // the build config itself
    'frontend/public/sw.js',                       // referenced by a string in index.html
    'electron/main.js',                            // package.json "main"
    'playwright.config.js',                        // the test runner config
    'e2e/push-116-bom-aggregator.spec.js',         // a test
    'forge-kernel/test/smoke.js',                  // OCCT ratchet anchor test
    'projects/ge9x/lib/simulate.mjs',              // research asset
  ]
  let bad = 0
  console.log('SELFTEST — every file below MUST be refused\n')
  for (const f of mustRefuse) {
    const r = check(f)
    const verdict = r.fails.length ? 'REFUSED ' : '*** CERTIFIED (GATE IS BROKEN) ***'
    if (!r.fails.length) bad++
    console.log(`${verdict} ${f}`)
    for (const x of r.fails) console.log(`          ${x}`)
  }
  console.log(`\nselftest: ${mustRefuse.length - bad}/${mustRefuse.length} correctly refused`)
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
