/**
 * ArchDisc Certification Matrix Generator (M79).
 *
 * Inputs:
 *   - SessionMemory snapshot (or anything with stepResults[])
 *   - Rule database (defaults to CSE_RULES)
 *
 * For each rule:
 *   1. Find the plan step(s) whose tool name appears in
 *      rule.verifiedBy.
 *   2. Run rule.acceptance(state, toolName) against the step's
 *      recorded state.
 *   3. Mark the rule covered (if any verifying step exists) and
 *      pass/fail based on acceptance.
 *
 * Produces:
 *   - Per-rule report object
 *   - Aggregate counters (covered, passed, failed, uncovered)
 *   - Markdown formatter for human review
 *
 * This is the design-stage screen. Production cert programs still
 * need test evidence (bird-strike rig, endurance test cell, etc.)
 * — those are intentionally listed as uncovered here so the user
 * knows what's left.
 */

import { CSE_RULES, RULE_BY_ID } from './StandardsLibrary.js';

/**
 * Generate the compliance report.
 *
 * @param {{stepResults: Array}} session  SessionMemory or .toJSON()
 * @param {Array=} rules                  defaults to CSE_RULES
 * @returns {{summary, ruleReports}}
 */
export function generateCertificationMatrix(session, rules = CSE_RULES) {
  const ruleReports = rules.map(rule => {
    const matches = (session.stepResults ?? []).filter(s => rule.verifiedBy.includes(s.tool));
    if (matches.length === 0) {
      return {
        rule, status: 'UNCOVERED', covered: false, satisfied: null,
        verifyingSteps: [], notes: rule.verifiedBy.length
          ? `No plan step used: ${rule.verifiedBy.join(' / ')}`
          : 'No ArchDisc tool covers this rule yet (test evidence required)',
      };
    }
    // Apply acceptance to each matching step. Rule passes iff at
    // least one matching step satisfies it.
    const accepts = matches.map(s => {
      try {
        return { stepIndex: s.stepIndex, tool: s.tool, ...rule.acceptance(s.state, s.tool) };
      } catch (err) {
        return { stepIndex: s.stepIndex, tool: s.tool, satisfied: false, notes: `Error: ${err.message}` };
      }
    });
    const anyPass = accepts.some(a => a.satisfied);
    return {
      rule,
      status: anyPass ? 'PASS' : 'FAIL',
      covered: true, satisfied: anyPass,
      verifyingSteps: accepts,
      notes: accepts.map(a => `step #${a.stepIndex} (${a.tool}): ${a.notes}`).join(' | '),
    };
  });

  const summary = {
    total: ruleReports.length,
    covered: ruleReports.filter(r => r.covered).length,
    uncovered: ruleReports.filter(r => !r.covered).length,
    passed: ruleReports.filter(r => r.status === 'PASS').length,
    failed: ruleReports.filter(r => r.status === 'FAIL').length,
    coveragePct: ruleReports.length
      ? (ruleReports.filter(r => r.covered).length / ruleReports.length) * 100
      : 0,
  };
  return { summary, ruleReports };
}

/**
 * Render the certification matrix as Markdown.
 * Sections by category, status badge per rule, notes columns.
 */
export function renderMatrixMarkdown(report) {
  const { summary, ruleReports } = report;
  const lines = [];
  lines.push('# ArchDisc Certification Matrix');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total rules:** ${summary.total}`);
  lines.push(`- **Covered:** ${summary.covered} (${summary.coveragePct.toFixed(1)} %)`);
  lines.push(`- **Passed:** ${summary.passed}`);
  lines.push(`- **Failed:** ${summary.failed}`);
  lines.push(`- **Uncovered:** ${summary.uncovered}`);
  lines.push('');

  // Group by category
  const byCat = {};
  for (const r of ruleReports) (byCat[r.rule.category] ??= []).push(r);

  for (const cat of Object.keys(byCat).sort()) {
    lines.push(`## ${cat}`);
    lines.push('');
    lines.push('| ID | Title | Status | Notes |');
    lines.push('|----|-------|--------|-------|');
    for (const r of byCat[cat]) {
      const badge = badgeFor(r.status);
      const id = r.rule.id;
      const title = r.rule.shortTitle;
      const notes = r.notes.replace(/\|/g, '\\|');
      lines.push(`| ${id} | ${title} | ${badge} | ${notes} |`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('*This report is generated automatically from a single design session.*');
  lines.push('*Uncovered rules typically require physical-test evidence (bird-strike rig, endurance cell, FW-H acoustic, fuel-system rig).*');
  return lines.join('\n');
}

function badgeFor(status) {
  if (status === 'PASS') return ':white_check_mark: PASS';
  if (status === 'FAIL') return ':x: FAIL';
  return ':warning: UNCOVERED';
}

/**
 * Find rules that *could* be covered but require additional tools
 * (returns rule.id strings). Useful for the AI orchestrator to
 * suggest which extra modules to bolt on.
 */
export function suggestNextModules(report) {
  return report.ruleReports
    .filter(r => !r.covered && r.rule.verifiedBy.length > 0)
    .map(r => ({ id: r.rule.id, missingTools: r.rule.verifiedBy }));
}
