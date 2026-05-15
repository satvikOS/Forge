import { useEffect, useRef, useState } from 'react';
import { pickClarificationKit, applyAnswers } from '../ai/Clarifier.js';
import { planFor } from '../ai/Planner.js';
import { loadProviderConfig } from '../ai/PlannerProviders.js';
import { SessionMemory } from '../ai/SessionMemory.js';
import { executePlan } from '../ai/PlanExecutor.js';
import { findTool, TOOL_REGISTRY } from '../ai/ToolRegistry.js';
import { generateCertificationMatrix, suggestNextModules, renderMatrixMarkdown } from '../ai/CertificationMatrix.js';
import { checkManifoldDFM } from '../foundation/DFMCheck.js';

/**
 * Front-door AI chat. Ties the existing Clarifier + Planner +
 * Executor + SessionMemory into a single conversational surface.
 *
 * State machine:
 *   idle → clarifying → planning → ready → running → done
 *
 * Without an LLM configured, Planner returns the canonical fallback
 * for the detected domain. With an LLM configured (via AISettingsPanel),
 * the same call routes through the user's chosen provider.
 *
 * The whole transcript is also captured in a SessionMemory so the
 * Certification Matrix generator can later produce a compliance
 * report from this one design session.
 */
export default function AIChatPanel({ open, onClose }) {
  const [messages, setMessages] = useState([
    { role: 'system', text: 'Tell me what you want to design. I will ask a few questions, then propose a plan you can run.' },
  ]);
  const [phase, setPhase] = useState('idle');             // idle | clarifying | planning | ready | running | done
  const [draft, setDraft]   = useState('');               // current input value
  const [kit, setKit]       = useState(null);
  const [domain, setDomain] = useState(null);
  const [qIdx, setQIdx]     = useState(0);
  const [answers, setAnswers] = useState({});
  const [plan, setPlan]     = useState(null);
  const [planSource, setPlanSource] = useState(null);
  const [stepStatuses, setStepStatuses] = useState([]);   // per-plan-step: 'pending' | 'running' | 'done' | 'error'
  const [certMatrix, setCertMatrix] = useState(null);     // generated after Run
  const [certExpanded, setCertExpanded] = useState(false);
  const [dfmReport, setDfmReport] = useState(null);
  const [dfmExpanded, setDfmExpanded] = useState(false);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [addPickerFilter, setAddPickerFilter] = useState('');
  const memRef = useRef(null);
  const transcriptEndRef = useRef(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, plan, stepStatuses]);

  if (!open) return null;

  const append = (role, text) => setMessages((m) => [...m, { role, text }]);

  // ── Step 1: user submits the initial goal ──────────────────────
  const handleInitialPrompt = () => {
    const prompt = draft.trim();
    if (!prompt) return;
    append('user', prompt);
    setDraft('');

    const mem = new SessionMemory();
    mem.setPrompt(prompt);
    memRef.current = mem;

    const { domain, confidence, kit } = pickClarificationKit(prompt);
    setDomain(domain);
    setKit(kit);
    mem.setDomain(domain, confidence);
    append('assistant',
      `Detected domain: ${domain} (${(confidence * 100).toFixed(0)} %). I'll ask ${kit.questions.length} questions.`);
    setQIdx(0);
    askQuestion(kit, 0);
    setPhase('clarifying');
  };

  const askQuestion = (k, i) => {
    const q = k.questions[i];
    if (!q) return;
    let line = `Q${i + 1}/${k.questions.length}: ${q.q}`;
    if (q.default !== undefined) line += ` (default: ${q.default})`;
    if (q.options) line += ` [${q.options.join(' | ')}]`;
    append('assistant', line);
  };

  // ── Step 2: user answers each question ─────────────────────────
  const handleAnswer = () => {
    const raw = draft.trim();
    const q = kit.questions[qIdx];
    const value = raw === '' ? q.default : (q.type === 'number' ? parseFloat(raw) : raw);
    append('user', String(raw === '' ? `(default: ${q.default})` : raw));
    setDraft('');

    const nextAnswers = { ...answers, [q.id]: value };
    setAnswers(nextAnswers);
    memRef.current?.setClarification(q.id, value);

    const nextIdx = qIdx + 1;
    if (nextIdx < kit.questions.length) {
      setQIdx(nextIdx);
      askQuestion(kit, nextIdx);
    } else {
      // Done clarifying — call Planner
      runPlanner(nextAnswers);
    }
  };

  const runPlanner = async (finalAnswers) => {
    setPhase('planning');
    append('assistant', 'Building plan…');
    const merged = applyAnswers(kit, finalAnswers);
    const providerCfg = loadProviderConfig();
    const userPrompt = memRef.current?.userPrompt ?? '';
    const result = await planFor({
      userPrompt,
      clarifications: merged,
      domain,
      providerCfg,
    });
    setPlan(result.plan);
    setPlanSource(result.source);
    setStepStatuses(result.plan.map(() => 'pending'));
    memRef.current?.setPlan(result.plan, result.source);
    append('assistant',
      `Plan ready (${result.plan.length} steps, source: ${result.source}). Review below and hit Run when ready.`);
    if (result.errors?.length) {
      append('assistant', `Planner notes: ${result.errors.join(' · ')}`);
    }
    setPhase('ready');
  };

  // ── Step 3: user runs the plan ─────────────────────────────────
  const handleRun = async () => {
    setPhase('running');
    append('assistant', 'Running plan through the ribbon…');
    try {
      const res = await executePlanInApp(plan, (i, status, state) => {
        setStepStatuses((arr) => {
          const next = [...arr];
          next[i] = status;
          return next;
        });
        if (status === 'done') {
          const meta = findTool(plan[i].tool);
          memRef.current?.recordStep({
            stepIndex: i, tool: plan[i].tool,
            stateKey: meta?.produces ?? 'unknown',
            state, comment: plan[i].comment,
          });
        }
      });
      if (res.ok) {
        append('assistant', `Plan complete — ${res.steps.length} steps executed.`);
        // ── Cert matrix ────────────────────────────────────────
        try {
          const matrix = generateCertificationMatrix(memRef.current);
          setCertMatrix(matrix);
          const s = matrix.summary;
          append('assistant',
            `Certification coverage: ${s.covered}/${s.total} rules covered (${s.coveragePct.toFixed(0)} %), ${s.passed} PASS, ${s.failed} FAIL, ${s.uncovered} uncovered.`);
          const next = suggestNextModules(matrix);
          if (next.length > 0) {
            append('assistant',
              `Uncovered rules that more tooling could address: ${next.slice(0, 4).map(n => n.id).join(', ')}${next.length > 4 ? ' …' : ''}`);
          }
        } catch (err) {
          console.warn('cert matrix failed', err);
        }
        // ── DFM auto-check ─────────────────────────────────────
        try {
          const m = typeof window !== 'undefined' ? window.__lastFoundationManifold : null;
          if (m) {
            const dfm = checkManifoldDFM(m);
            setDfmReport(dfm);
            const s = dfm.summary;
            const banner = s.errors > 0
              ? `Manufacturability: FAIL — ${s.errors} errors, ${s.warnings} warnings, ${s.infos} infos`
              : s.warnings > 0
              ? `Manufacturability: WARN — ${s.warnings} warnings, ${s.infos} infos`
              : s.infos > 0
              ? `Manufacturability: PASS — ${s.infos} infos worth a glance`
              : `Manufacturability: PASS — no DFM issues`;
            append('assistant', banner);
          }
        } catch (err) {
          console.warn('dfm check failed', err);
        }
        setPhase('done');
      } else {
        append('assistant', `Plan aborted: ${res.errors.map(e => e.error).join(' · ')}`);
        setPhase('done');
      }
    } catch (err) {
      append('assistant', `Run failed: ${err.message}`);
      setPhase('done');
    }
  };

  const handleSubmit = () => {
    if (phase === 'idle' || phase === 'done') handleInitialPrompt();
    else if (phase === 'clarifying') handleAnswer();
  };

  // ── Plan editing ops (only when phase === 'ready') ───────────
  const editable = phase === 'ready';
  const moveStep = (i, dir) => {
    if (!editable) return;
    const j = i + dir;
    if (j < 0 || j >= plan.length) return;
    const next = [...plan];
    [next[i], next[j]] = [next[j], next[i]];
    setPlan(next);
    setStepStatuses(next.map(() => 'pending'));
    memRef.current?.setPlan(next, 'user-edited');
  };
  const deleteStep = (i) => {
    if (!editable) return;
    const next = plan.filter((_, idx) => idx !== i);
    setPlan(next);
    setStepStatuses(next.map(() => 'pending'));
    memRef.current?.setPlan(next, 'user-edited');
  };
  const addStep = (toolName) => {
    if (!editable) return;
    const next = [...plan, { tool: toolName, comment: 'Added by user' }];
    setPlan(next);
    setStepStatuses(next.map(() => 'pending'));
    setAddPickerOpen(false);
    setAddPickerFilter('');
    memRef.current?.setPlan(next, 'user-edited');
  };

  const handleReset = () => {
    setMessages([{ role: 'system', text: 'Tell me what you want to design.' }]);
    setPhase('idle');
    setDraft('');
    setKit(null); setDomain(null); setQIdx(0); setAnswers({});
    setPlan(null); setPlanSource(null); setStepStatuses([]);
    setCertMatrix(null); setCertExpanded(false);
    setDfmReport(null); setDfmExpanded(false);
    memRef.current = null;
  };

  return (
    <div className="chat-panel-overlay" onClick={onClose}>
      <div className="chat-panel" onClick={(e) => e.stopPropagation()}>
        <div className="chat-header">
          <span className="chat-title">ArchDisc AI</span>
          <span className={`chat-phase chat-phase-${phase}`}>{phase}</span>
          <button className="chat-close" onClick={onClose}>×</button>
        </div>
        <div className="chat-transcript">
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg chat-msg-${m.role}`}>
              {m.role !== 'system' && <span className="chat-msg-role">{m.role === 'user' ? 'You' : 'AI'}</span>}
              <span className="chat-msg-text">{m.text}</span>
            </div>
          ))}
          {plan && (
            <div className="chat-plan" data-plan>
              <div className="chat-plan-head">
                Plan ({plan.length} steps · source: {planSource})
                {editable && (
                  <button className="chat-add-btn"
                          onClick={() => setAddPickerOpen((v) => !v)}
                          data-action="open-add-step"
                          title="Add a step">+</button>
                )}
                {phase === 'ready' && (
                  <button className="chat-run-btn" onClick={handleRun} data-action="run-plan">Run</button>
                )}
              </div>
              {addPickerOpen && editable && (
                <div className="chat-add-picker">
                  <input className="chat-add-filter" placeholder="Filter tools…"
                         value={addPickerFilter}
                         onChange={(e) => setAddPickerFilter(e.target.value)}
                         autoFocus />
                  <ul className="chat-add-list">
                    {TOOL_REGISTRY
                      .filter(t => !addPickerFilter ||
                        t.name.toLowerCase().includes(addPickerFilter.toLowerCase()))
                      .slice(0, 40)
                      .map(t => (
                        <li key={t.name}>
                          <button className="chat-add-tool"
                                  onClick={() => addStep(t.name)}
                                  data-add-tool={t.name}>
                            <span>{t.name}</span>
                            <span className="chat-add-tab">{t.tab}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              <ol className="chat-plan-list">
                {plan.map((s, i) => {
                  const meta = findTool(s.tool);
                  const status = stepStatuses[i] ?? 'pending';
                  return (
                    <li key={i} className={`chat-plan-step status-${status}`} data-step-index={i}>
                      <span className="chat-step-icon">{statusGlyph(status)}</span>
                      <span className="chat-step-tool">{s.tool}</span>
                      {meta?.tab && <span className="chat-step-tab">{meta.tab}</span>}
                      {editable && (
                        <span className="chat-step-edits">
                          <button onClick={() => moveStep(i, -1)}
                                  disabled={i === 0}
                                  data-action="step-up"
                                  title="Move up">↑</button>
                          <button onClick={() => moveStep(i, +1)}
                                  disabled={i === plan.length - 1}
                                  data-action="step-down"
                                  title="Move down">↓</button>
                          <button onClick={() => deleteStep(i)}
                                  data-action="step-delete"
                                  title="Delete">×</button>
                        </span>
                      )}
                      {s.comment && <div className="chat-step-comment">{s.comment}</div>}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          {dfmReport && (
            <div className={`chat-dfm chat-dfm-${dfmReport.summary.overall}`} data-dfm-summary>
              <div className="chat-dfm-head" onClick={() => setDfmExpanded((v) => !v)}>
                <span className={`chat-dfm-light chat-dfm-light-${dfmReport.summary.overall}`}>
                  {dfmReport.summary.overall.toUpperCase()}
                </span>
                <span>Manufacturability</span>
                <span className="chat-dfm-stats">
                  {dfmReport.summary.errors} err · {dfmReport.summary.warnings} warn · {dfmReport.summary.infos} info
                </span>
                <span className="chat-dfm-toggle">{dfmExpanded ? '▴' : '▾'}</span>
              </div>
              {dfmExpanded && (
                <ul className="chat-dfm-list">
                  {dfmReport.issues.length === 0 && (
                    <li className="chat-dfm-row chat-dfm-row-pass">
                      <span className="chat-dfm-pill chat-dfm-pill-pass">OK</span>
                      <span>No DFM findings — geometry passes all heuristics.</span>
                    </li>
                  )}
                  {dfmReport.issues.map((i, idx) => (
                    <li key={idx} className={`chat-dfm-row chat-dfm-row-${i.severity}`}>
                      <span className={`chat-dfm-pill chat-dfm-pill-${i.severity}`}>
                        {i.severity.toUpperCase()}
                      </span>
                      <div className="chat-dfm-issue">
                        <div className="chat-dfm-issue-title">{i.title}</div>
                        <div className="chat-dfm-issue-fix">{i.recommendation}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {certMatrix && (
            <div className="chat-cert" data-cert-summary>
              <div className="chat-cert-head" onClick={() => setCertExpanded((v) => !v)}>
                <span>Certification matrix</span>
                <span className="chat-cert-stats">
                  {certMatrix.summary.passed}/{certMatrix.summary.total} pass · {certMatrix.summary.uncovered} uncovered
                </span>
                <button className="chat-cert-dl"
                        onClick={(e) => { e.stopPropagation(); downloadMatrix(certMatrix, 'md'); }}
                        title="Download as Markdown"
                        data-action="download-cert-md">MD</button>
                <button className="chat-cert-dl"
                        onClick={(e) => { e.stopPropagation(); downloadMatrix(certMatrix, 'json'); }}
                        title="Download as JSON"
                        data-action="download-cert-json">JSON</button>
                <span className="chat-cert-toggle">{certExpanded ? '▴' : '▾'}</span>
              </div>
              {certExpanded && (
                <ul className="chat-cert-list">
                  {certMatrix.ruleReports.map((r) => (
                    <li key={r.rule.id} className={`chat-cert-row cert-${r.status.toLowerCase()}`}>
                      <span className="chat-cert-id">{r.rule.id}</span>
                      <span className="chat-cert-title">{r.rule.shortTitle}</span>
                      <span className="chat-cert-status">{r.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div ref={transcriptEndRef} />
        </div>
        <div className="chat-input-row">
          <input
            className="chat-input"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder={inputPlaceholder(phase, kit, qIdx)}
            disabled={phase === 'planning' || phase === 'running'}
            data-field="chat-input"
          />
          <button className="chat-send-btn"
                  disabled={phase === 'planning' || phase === 'running'}
                  onClick={handleSubmit}
                  data-action="send">
            Send
          </button>
          <button className="chat-reset-btn" onClick={handleReset} title="Reset">↺</button>
        </div>
      </div>
    </div>
  );
}

function inputPlaceholder(phase, kit, qIdx) {
  if (phase === 'idle' || phase === 'done') return 'Describe what you want to design…';
  if (phase === 'clarifying') {
    const q = kit?.questions?.[qIdx];
    if (!q) return '';
    return `Press Enter to accept default (${q.default}), or type your answer`;
  }
  if (phase === 'planning') return 'Building plan…';
  if (phase === 'running')  return 'Running plan…';
  return '';
}

/**
 * Build a downloadable Blob from the cert matrix and trigger a
 * browser download. format: 'md' → ArchDisc-cert.md (human-friendly
 * Markdown report); 'json' → ArchDisc-cert.json (machine-readable
 * for vendor-portal ingestion).
 */
function downloadMatrix(matrix, format) {
  const stamp = new Date().toISOString().slice(0, 10);
  let body, name, type;
  if (format === 'json') {
    const payload = {
      generatedAt: new Date().toISOString(),
      summary: matrix.summary,
      ruleReports: matrix.ruleReports.map((r) => ({
        ruleId: r.rule.id, category: r.rule.category,
        shortTitle: r.rule.shortTitle, requirementText: r.rule.requirementText,
        status: r.status, covered: r.covered, satisfied: r.satisfied,
        notes: r.notes, verifyingSteps: r.verifyingSteps,
      })),
    };
    body = JSON.stringify(payload, null, 2);
    name = `archdisc-cert-${stamp}.json`;
    type = 'application/json';
  } else {
    body = renderMatrixMarkdown(matrix);
    name = `archdisc-cert-${stamp}.md`;
    type = 'text/markdown';
  }
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function statusGlyph(s) {
  if (s === 'running') return '⟳';
  if (s === 'done') return '✓';
  if (s === 'error') return '✗';
  return '·';
}

/**
 * Execute a plan from inside the running React app — same logic
 * as PlanExecutor but using DOM-level clicks rather than a
 * Playwright Page handle.
 */
async function executePlanInApp(plan, onStep) {
  const errors = [];
  const steps = [];
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const meta = findTool(step.tool);
    if (!meta) { errors.push({ stepIndex: i, error: `Unknown tool: ${step.tool}` }); break; }
    onStep?.(i, 'running');

    // Click the tab + tool via direct DOM
    const tab = [...document.querySelectorAll('.ribbon-tab')]
      .find(el => el.textContent?.includes(meta.tab));
    if (!tab) { errors.push({ stepIndex: i, error: `Tab not found: ${meta.tab}` }); onStep?.(i, 'error'); break; }
    tab.click();
    await new Promise(r => setTimeout(r, 400));

    // Stash params so requestToolParams consumes them instead of opening the dialog
    if (step.params && Object.keys(step.params).length) {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams[step.tool] = step.params;
    }

    const tool = [...document.querySelectorAll('.ribbon-tool-label')]
      .find(el => el.textContent?.trim() === step.tool);
    if (!tool) { errors.push({ stepIndex: i, error: `Tool not found: ${step.tool}` }); onStep?.(i, 'error'); break; }
    tool.click();

    // Wait for the produces slot to populate (max 30 s)
    const slot = meta.produces;
    const start = Date.now();
    while (Date.now() - start < 30000) {
      if (window[slot]) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (!window[slot]) {
      errors.push({ stepIndex: i, error: `Timeout waiting for ${slot}` });
      onStep?.(i, 'error');
      break;
    }
    const state = window[slot];
    steps.push({ stepIndex: i, tool: step.tool, stateKey: slot, state });
    onStep?.(i, 'done', state);
    await new Promise(r => setTimeout(r, 400));
  }
  return { ok: errors.length === 0, errors, steps };
}
