import { useEffect, useRef, useState } from 'react';
import { pickClarificationKit, applyAnswers } from '../ai/Clarifier.js';
import { planFor } from '../ai/Planner.js';
import { loadProviderConfig } from '../ai/PlannerProviders.js';
import { SessionMemory } from '../ai/SessionMemory.js';
import { executePlan } from '../ai/PlanExecutor.js';
import { findTool } from '../ai/ToolRegistry.js';

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
  const memRef = useRef(null);
  const transcriptEndRef = useRef(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    const page = null; // We're inside the running app, not Playwright; use direct ribbon clicks
    try {
      const res = await executePlanInApp(plan, (i, status) => {
        setStepStatuses((arr) => {
          const next = [...arr];
          next[i] = status;
          return next;
        });
      });
      if (res.ok) {
        append('assistant', `Plan complete — ${res.steps.length} steps executed.`);
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

  const handleReset = () => {
    setMessages([{ role: 'system', text: 'Tell me what you want to design.' }]);
    setPhase('idle');
    setDraft('');
    setKit(null); setDomain(null); setQIdx(0); setAnswers({});
    setPlan(null); setPlanSource(null); setStepStatuses([]);
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
            <div className="chat-plan">
              <div className="chat-plan-head">
                Plan ({plan.length} steps · source: {planSource})
                {phase === 'ready' && (
                  <button className="chat-run-btn" onClick={handleRun} data-action="run-plan">Run</button>
                )}
              </div>
              <ol className="chat-plan-list">
                {plan.map((s, i) => {
                  const meta = findTool(s.tool);
                  const status = stepStatuses[i] ?? 'pending';
                  return (
                    <li key={i} className={`chat-plan-step status-${status}`}>
                      <span className="chat-step-icon">{statusGlyph(status)}</span>
                      <span className="chat-step-tool">{s.tool}</span>
                      {meta?.tab && <span className="chat-step-tab">{meta.tab}</span>}
                      {s.comment && <div className="chat-step-comment">{s.comment}</div>}
                    </li>
                  );
                })}
              </ol>
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
    steps.push({ stepIndex: i, tool: step.tool, stateKey: slot, state: window[slot] });
    onStep?.(i, 'done');
    await new Promise(r => setTimeout(r, 400));
  }
  return { ok: errors.length === 0, errors, steps };
}
