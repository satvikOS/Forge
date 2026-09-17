// T-131 — file intent for Archie tool calls. T-124's shape, in JavaScript.
//
// THE DEFECT. Thirteen verbs in ForgeToolBridge.js take a `filepath` STRAIGHT
// FROM A TOOL CALL and hand it to a writer — forge.io.exportStep,
// forge.io.writeTextFile, forge.dialog.writeBlob, or require('fs').writeFileSync
// — with no refusal of any kind. The path is chosen by the model. Nothing
// checked that the verb was entitled to write at all, and nothing checked that
// what it wrote was the kind of file it claimed to be exporting. `io.export-stl`
// with filepath `/Users/<u>/Library/LaunchAgents/x.plist` wrote a plist.
//
// THE FIX IS THE ONE T-124 TOOK, NOT A CALL AT EACH SITE. T-124's note is
// explicit about why: "ForgeShell::writeTarget() is the ONLY thing in the shell
// that reads params().text('path') for a writing command, and the intent is
// DECLARED on CommandDescriptor so a command that declares nothing cannot write
// -- runSave sat twenty lines above T-123's guard calling nothing, which is
// precisely how this round's defect existed." The ticket for this task named
// five sites. A derived sweep finds THIRTEEN. Patching the five named ones would
// have left eight, which is the whole argument for a chokepoint.
//
// SO: intent is declared on the tool spec, the declaration is swept for at
// module load (a new file-touching verb that declares nothing throws on import,
// rather than shipping unguarded), and dispatchToolCall refuses before `run` is
// ever entered.
//
// WHAT THIS DELIBERATELY DOES NOT DO — see T-130. That task measured the same
// family in C++ and drew the line where the implementer disclosed it: "THAT
// REASONING HOLDS FOR EXPORTS AND NOT FOR SAVE AS -- a Save As onto someone's
// thesis has no idempotent-re-export story. Fix the SAVE half; leave the export
// half as designed." Every verb guarded here is an EXPORT, so re-exporting over
// your own last export stays legal and there is no occupancy check. What the
// model loses is the ability to choose a path that is not the kind of file the
// verb exports.

/** A parameter whose NAME is path-shaped. Necessary, not sufficient — see below. */
export const PATH_PARAM_RE = /^(filepath|.*(?:P|p)ath)$/;

/**
 * Every FILESYSTEM-path parameter of a spec.
 *
 * ★THE NAME IS NOT ENOUGH, and taking it for enough would have put a lie in four
 * declarations. A sweep on the name alone returns SEVENTEEN verbs; four of them
 * -- part.pipe, part.sweep, manufacture.gcode, cam.material-removal -- carry a
 * `path`/`toolpath` that is a GEOMETRIC spine or a cutting path, `P('array', …)`
 * and `P('object', …)`, nothing to do with the disk. Declaring `files` for those
 * would have documented four filesystem writers that do not exist, and the guard
 * would then have refused legal geometry for having the wrong "extension".
 *
 * Every real filesystem path in this file is `P('string', …)`. Requiring the
 * declared TYPE as well as the name makes the sweep exact: thirteen verbs.
 * (The ticket for this task named five.)
 */
export function pathParams(spec) {
  const params = (spec && spec.parameters) || {};
  return Object.keys(params).filter(
    (k) => PATH_PARAM_RE.test(k) && params[k] && params[k].type === 'string');
}

/**
 * The extension of a path, lowercased and including the dot, or '' when the
 * basename carries none. A dotfile (`.zshrc`, `.npmrc`) has NO extension by this
 * definition -- the dot is at index 0 of the basename, it does not separate a
 * name from a type -- which is what makes `/Users/<u>/.zshrc` unwritable by
 * every verb here rather than "a file of type zshrc".
 */
export function extensionOf(p) {
  const base = String(p).split(/[/\\]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

/** Absolute in the POSIX sense or the Windows sense. Both apps ship. */
export function isAbsolutePath(p) {
  const s = String(p);
  return s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\');
}

/** A `..` that is a whole path SEGMENT, not the substring in `a..b.step`. */
export function hasTraversal(p) {
  return String(p).split(/[/\\]/).some((seg) => seg === '..');
}

/**
 * Check one path argument against what its verb declared.
 * Returns null when the path is allowed, or a refusal string.
 */
export function checkPathArg(spec, key, raw) {
  const decl = (spec && spec.files && spec.files[key]) || null;
  if (!decl) {
    return `${spec.name}: parameter '${key}' is a filesystem path and this verb `
         + 'declares no file intent, so it may not touch the disk. A verb that '
         + 'reads or writes files must declare `files` (see frontend/src/ai/fileIntent.js).';
  }
  if (raw === undefined || raw === null || raw === '') return null;   // optional, absent
  if (typeof raw !== 'string') {
    return `${spec.name}: '${key}' must be a string path, got ${typeof raw}`;
  }
  const p = raw.trim();
  if (!p) return null;                                               // blank == absent
  if (p.includes('\0')) return `${spec.name}: '${key}' contains a NUL byte`;
  if (!isAbsolutePath(p)) {
    return `${spec.name}: '${key}' must be an ABSOLUTE path; got '${p}'. A relative `
         + 'path resolves against whatever directory the app happens to be running in.';
  }
  if (hasTraversal(p)) {
    return `${spec.name}: '${key}' contains a '..' segment, which is refused rather `
         + `than normalised: '${p}'`;
  }
  const ext = extensionOf(p);
  const allowed = decl.ext || [];
  if (allowed.length && !allowed.includes(ext)) {
    return `${spec.name}: this verb ${decl.mode === 'read' ? 'reads' : 'writes'} `
         + `${allowed.join(' | ')} and '${key}' names ${ext ? `a ${ext} file` : 'a file with no extension'}`
         + ` -- '${p}' is NOT APPLIED. The path a tool call chooses may not change `
         + 'what kind of file the verb produces.';
  }
  return null;
}

/**
 * Guard every path argument of one dispatched call.
 * `{ ok: true }` or `{ ok: false, error }`, the shape dispatchToolCall returns.
 */
export function guardFileArgs(spec, args = {}) {
  for (const key of pathParams(spec)) {
    const bad = checkPathArg(spec, key, args ? args[key] : undefined);
    if (bad) return { ok: false, error: bad };
  }
  return { ok: true };
}

/**
 * THE SWEEP, and the reason this is a chokepoint rather than thirteen edits.
 * Every verb carrying a path-shaped parameter must declare its intent for that
 * parameter. Called at module load, so a verb added later with a `filepath` and
 * no `files` block fails the import -- it cannot reach a user unguarded.
 */
export function assertFileIntentDeclared(tools) {
  const undeclared = [];
  for (const spec of tools) {
    for (const key of pathParams(spec)) {
      const d = spec.files && spec.files[key];
      if (!d || (d.mode !== 'read' && d.mode !== 'write') || !Array.isArray(d.ext)) {
        undeclared.push(`${spec.name}.${key}`);
      }
    }
  }
  if (undeclared.length) {
    throw new Error(
      'ForgeToolBridge: these verbs take a filesystem path and declare no file '
      + `intent: ${undeclared.join(', ')}. Add `
      + "`files: { <param>: { mode: 'read'|'write', ext: ['.step', ...] } }` to the "
      + 'spec. A verb that declares nothing cannot touch the disk (T-131/T-124).');
  }
  return tools.length;
}
