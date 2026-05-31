/**
 * Command palette — a Cmd+K-style fuzzy search over every action the
 * user can invoke, regardless of which workbench / panel owns it.
 *
 * Producers (ToolRegistry, ribbon, AI, settings, file menu, etc.)
 * register Commands. Consumers ask `query(text)` and get a ranked list
 * back. The renderer presents that list inside a modal; this module is
 * UI-agnostic and reusable in unit tests.
 *
 * Ranking matches what VS Code and Sublime use: subsequence match with
 * exponential bonus for consecutive characters, prefix-match bonus,
 * word-start bonus, frequency boost (`bumpUsage(id)`), recency boost.
 */

let nextId = 1;

export class Command {
  constructor({ id, title, category = 'General', subtitle = '',
                shortcut = '', keywords = [], run, when = () => true }) {
    if (!title) throw new Error('[forge.cmd] Command requires title');
    if (typeof run !== 'function') throw new Error('[forge.cmd] Command requires run()');
    this.id = id || `cmd-${nextId++}`;
    this.title = title;
    this.category = category;
    this.subtitle = subtitle;
    this.shortcut = shortcut;
    this.keywords = keywords;
    this.run = run;
    this.when = when;
  }
}

export class CommandRegistry {
  constructor() {
    this.commands = new Map();      // id → Command
    this._usage = new Map();        // id → count
    this._lastInvoked = new Map();  // id → timestamp
  }
  register(cmd) {
    if (!(cmd instanceof Command)) cmd = new Command(cmd);
    this.commands.set(cmd.id, cmd);
    return cmd;
  }
  unregister(id) { return this.commands.delete(id); }
  byId(id) { return this.commands.get(id); }
  size() { return this.commands.size; }

  /**
   * Run a command by id. Returns whatever the command's run() returns.
   * Tracks frequency + recency for future ranking.
   */
  invoke(id, context = {}) {
    const cmd = this.commands.get(id);
    if (!cmd) throw new Error(`[forge.cmd] unknown command: ${id}`);
    if (!cmd.when(context)) throw new Error(`[forge.cmd] ${id} not available in this context`);
    this._usage.set(id, (this._usage.get(id) || 0) + 1);
    this._lastInvoked.set(id, Date.now());
    return cmd.run(context);
  }

  /**
   * Fuzzy search. Returns sorted matches (descending score). `query` is
   * the user's typed string. `context` filters out commands whose
   * `when()` returns false.
   */
  query(text, context = {}, { limit = 25 } = {}) {
    const q = (text || '').trim().toLowerCase();
    const hits = [];
    for (const cmd of this.commands.values()) {
      if (!cmd.when(context)) continue;
      const haystack = [cmd.title, cmd.category, cmd.subtitle, ...cmd.keywords]
        .filter(Boolean).join(' • ').toLowerCase();
      const score = q ? fuzzyScore(q, haystack, cmd.title.toLowerCase())
                      : this._usage.get(cmd.id) || 0;
      if (q && score <= 0) continue;
      const boost = (this._usage.get(cmd.id) || 0) * 0.5;
      const recency = recencyBoost(this._lastInvoked.get(cmd.id));
      hits.push({ cmd, score: score + boost + recency });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit).map(({ cmd, score }) => ({ command: cmd, score }));
  }
}

// ===================================================================
//                          Fuzzy scoring
// ===================================================================

/**
 * Score a subsequence match of `q` inside `haystack`, with a
 * prefix-on-title bonus computed separately. Returns 0 if `q` is not a
 * subsequence of `haystack`.
 */
export function fuzzyScore(q, haystack, title) {
  if (!q) return 0;
  // Quick contains-check on the title for a strong boost.
  let prefixBoost = 0;
  if (title && title.startsWith(q)) prefixBoost = 50;
  else if (title && title.includes(q)) prefixBoost = 20;

  // Subsequence match in the haystack.
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let lastMatchAt = -1;
  for (let i = 0; i < haystack.length && qi < q.length; i++) {
    if (haystack[i] === q[qi]) {
      // Word-start bonus.
      const isWordStart = i === 0 || /[\s•_\-]/.test(haystack[i - 1]);
      score += 2;
      if (isWordStart) score += 5;
      if (i === lastMatchAt + 1) {
        consecutive++;
        score += consecutive * 2; // exponential-ish reward for streaks
      } else {
        consecutive = 1;
      }
      lastMatchAt = i;
      qi++;
    }
  }
  if (qi < q.length) return 0; // not a subsequence
  return score + prefixBoost;
}

function recencyBoost(t) {
  if (!t) return 0;
  const ageMs = Date.now() - t;
  if (ageMs < 5000) return 5;
  if (ageMs < 60_000) return 3;
  if (ageMs < 600_000) return 1;
  return 0;
}
