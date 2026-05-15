import { useEffect, useRef, useState } from 'react';
import { pickClarificationKit, applyAnswers } from '../ai/Clarifier.js';
import { planFor } from '../ai/Planner.js';
import { loadProviderConfig } from '../ai/PlannerProviders.js';
import { SessionMemory } from '../ai/SessionMemory.js';
import { executePlan } from '../ai/PlanExecutor.js';
import { findTool, TOOL_REGISTRY } from '../ai/ToolRegistry.js';
import { generateCertificationMatrix, suggestNextModules, renderMatrixMarkdown } from '../ai/CertificationMatrix.js';
import { checkManifoldDFM } from '../foundation/DFMCheck.js';
import { rollupAssemblyCost } from '../foundation/AssemblyCost.js';
import { getBodyRegistry } from '../foundation/BodyRegistry.js';
import { buildVendorPackage } from '../foundation/VendorPackage.js';
import { VENDOR_PROFILES, findVendorProfile, profileToCostOpts, quoteAllVendors } from '../foundation/VendorProfiles.js';
import { buildVendorRFQEmail } from '../foundation/VendorRFQEmail.js';
import * as ProjectStore from '../foundation/ProjectStore.js';
import * as PlanTemplates from '../foundation/PlanTemplates.js';

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
  const [costReport, setCostReport] = useState(null);
  const [costExpanded, setCostExpanded] = useState(false);
  const [vendorPackage, setVendorPackage] = useState(null);
  const [vendorProfileId, setVendorProfileId] = useState(VENDOR_PROFILES[0].id);
  const [quotes, setQuotes] = useState(null);
  const [quotesSortKey, setQuotesSortKey] = useState('totalCost');
  const [quotesDir, setQuotesDir] = useState(1);     // 1 asc, -1 desc
  const [rfqEmail, setRfqEmail] = useState(null);    // {subject, body, mailtoUrl}
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [addPickerFilter, setAddPickerFilter] = useState('');
  const memRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectIdState] = useState(null);
  const [renamingProject, setRenamingProject] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, plan, stepStatuses]);

  // ── Persist session into the active project on every change ──
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    if (phase === 'idle' && messages.length <= 1) return;  // nothing to save yet
    try {
      const snapshot = {
        v: 1,
        savedAt: new Date().toISOString(),
        messages, phase, draft,
        domain, qIdx, answers,
        plan, planSource, stepStatuses,
        certMatrix: certMatrix ? {
          summary: certMatrix.summary,
          ruleReports: certMatrix.ruleReports.map(r => ({
            rule: { id: r.rule.id, category: r.rule.category, shortTitle: r.rule.shortTitle,
                    requirementText: r.rule.requirementText, verifiedBy: r.rule.verifiedBy },
            status: r.status, covered: r.covered, satisfied: r.satisfied,
            notes: r.notes, verifyingSteps: r.verifyingSteps,
          })),
        } : null,
        dfmReport, costReport,
        vendorProfileId,
        memJSON: memRef.current?.toJSON?.() ?? null,
      };
      // First write of a session that has no active project → create
      // an "Untitled project" so subsequent saves have somewhere to go.
      if (!ProjectStore.getActiveProjectId()) {
        const p = ProjectStore.createProject('Untitled project');
        setActiveProjectIdState(p.id);
        setProjects(ProjectStore.listProjects());
      }
      ProjectStore.saveSnapshot(snapshot);
      setProjects(ProjectStore.listProjects());
    } catch (err) {
      console.warn('session persist failed', err);
    }
  }, [messages, phase, draft, domain, qIdx, answers, plan, planSource, stepStatuses,
      certMatrix, dfmReport, costReport, vendorProfileId]);

  // ── Restore session on mount (from the active project) ──────────
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    const all = ProjectStore.listProjects();
    setProjects(all);
    setTemplates(PlanTemplates.listTemplates());
    const active = ProjectStore.getActiveProject();
    setActiveProjectIdState(active?.id ?? null);
    if (!active?.snapshot) return;
    try {
      const s = active.snapshot;
      if (s.v !== 1) return;
      applySnapshot(s);
      setRestoredFromStorage(true);
    } catch (err) {
      console.warn('session restore failed', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Apply a persisted snapshot to React state. */
  const applySnapshot = (s) => {
    setMessages(s.messages ?? [{ role: 'system', text: 'Tell me what you want to design.' }]);
    setPhase(s.phase ?? 'idle');
    setDraft(s.draft ?? '');
    setDomain(s.domain ?? null);
    setQIdx(s.qIdx ?? 0);
    setAnswers(s.answers ?? {});
    setPlan(s.plan ?? null);
    setPlanSource(s.planSource ?? null);
    setStepStatuses(s.stepStatuses ?? []);
    setCertMatrix(s.certMatrix ?? null);
    setDfmReport(s.dfmReport ?? null);
    setCostReport(s.costReport ?? null);
    setVendorProfileId(s.vendorProfileId ?? VENDOR_PROFILES[0].id);
    memRef.current = s.memJSON ? SessionMemory.fromJSON(s.memJSON) : null;
    if (s.domain) {
      const userPrompt = s.memJSON?.userPrompt ?? '';
      const { kit: restoredKit } = pickClarificationKit(userPrompt || s.domain);
      setKit(restoredKit);
    } else {
      setKit(null);
    }
  };

  /** Reset all in-memory React state to a blank chat. Does NOT touch
   * the active project's snapshot — callers that want the persisted
   * snapshot wiped (Reset button) call wipeActiveSnapshot() after. */
  const clearReactState = () => {
    setMessages([{ role: 'system', text: 'Tell me what you want to design.' }]);
    setPhase('idle');
    setDraft('');
    setKit(null); setDomain(null); setQIdx(0); setAnswers({});
    setPlan(null); setPlanSource(null); setStepStatuses([]);
    setCertMatrix(null); setCertExpanded(false);
    setDfmReport(null); setDfmExpanded(false);
    setCostReport(null); setCostExpanded(false);
    setVendorPackage(null); setQuotes(null);
    setQuotesSortKey('totalCost'); setQuotesDir(1);
    setRfqEmail(null);
    memRef.current = null;
    setRestoredFromStorage(false);
  };

  const wipeActiveSnapshot = () => {
    try { ProjectStore.saveSnapshot(null); }
    catch (err) { console.warn('snapshot clear failed', err); }
  };

  // ── Project actions ─────────────────────────────────────────────
  const handleNewProject = () => {
    clearReactState();
    const p = ProjectStore.createProject('Untitled project');
    setActiveProjectIdState(p.id);
    setProjects(ProjectStore.listProjects());
  };

  const handleSwitchProject = (id) => {
    if (id === activeProjectId) return;
    ProjectStore.setActiveProjectId(id);
    const proj = ProjectStore.listProjects().find(p => p.id === id);
    setActiveProjectIdState(id);
    setProjects(ProjectStore.listProjects());
    if (proj?.snapshot) {
      applySnapshot(proj.snapshot);
      setRestoredFromStorage(true);
    } else {
      clearReactState();
    }
  };

  const handleDeleteProject = (id) => {
    if (!window.confirm('Delete this project? This cannot be undone.')) return;
    const remaining = ProjectStore.deleteProject(id);
    setProjects(remaining);
    const nextActive = ProjectStore.getActiveProject();
    setActiveProjectIdState(nextActive?.id ?? null);
    if (nextActive?.snapshot) applySnapshot(nextActive.snapshot);
    else                       clearReactState();
  };

  // ── Plan templates ──────────────────────────────────────────────
  const handleLoadTemplate = (id) => {
    const tpl = PlanTemplates.findTemplate(id);
    if (!tpl) return;
    clearReactState();
    const mem = new SessionMemory();
    mem.setPrompt(tpl.prompt);
    mem.setDomain(tpl.domain, 1);
    mem.setPlan(tpl.plan, `template:${tpl.name}`);
    memRef.current = mem;
    setDomain(tpl.domain);
    setPlan(tpl.plan);
    setPlanSource(`template:${tpl.name}`);
    setStepStatuses(tpl.plan.map(() => 'pending'));
    setMessages([
      { role: 'system', text: 'Tell me what you want to design.' },
      { role: 'user', text: tpl.prompt },
      { role: 'assistant', text: `Loaded template "${tpl.name}" — ${tpl.plan.length} steps. Review/edit below and hit Run.` },
    ]);
    setPhase('ready');
  };

  const handleSaveTemplate = () => {
    if (!plan || plan.length === 0) return;
    const name = window.prompt('Save current plan as template — name:',
      `${domain ?? 'design'} plan`);
    if (!name) return;
    PlanTemplates.saveTemplate({
      name,
      domain: domain ?? 'generic',
      prompt: memRef.current?.userPrompt ?? '',
      plan,
    });
    setTemplates(PlanTemplates.listTemplates());
    append('assistant', `Saved current ${plan.length}-step plan as template "${name}".`);
  };

  const commitProjectRename = () => {
    if (!activeProjectId || !projectNameDraft.trim()) {
      setRenamingProject(false);
      return;
    }
    ProjectStore.renameProject(activeProjectId, projectNameDraft);
    setProjects(ProjectStore.listProjects());
    setRenamingProject(false);
  };

  const handleExportProject = () => {
    if (!activeProjectId) return;
    const blob = ProjectStore.serializeProject(activeProjectId);
    if (!blob) return;
    const proj = projects.find(p => p.id === activeProjectId);
    const slug = (proj?.name ?? 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
    const blobObj = new Blob([JSON.stringify(blob, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blobObj);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.archdisc.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleImportProject = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const blob = JSON.parse(text);
      const proj = ProjectStore.importProject(blob);
      if (!proj) {
        append('assistant', 'Import failed: file is not a valid .archdisc.json project.');
        return;
      }
      setProjects(ProjectStore.listProjects());
      setActiveProjectIdState(proj.id);
      if (proj.snapshot) {
        applySnapshot(proj.snapshot);
        setRestoredFromStorage(true);
      } else {
        clearReactState();
      }
      append('assistant', `Imported project "${proj.name}".`);
    } catch (err) {
      append('assistant', `Import failed: ${err.message}`);
    }
  };

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
        // ── Cost auto-rollup across BodyRegistry ───────────────
        try {
          const bodies = getBodyRegistry().list();
          if (bodies.length > 0) {
            const cost = rollupAssemblyCost(bodies);
            setCostReport(cost);
            const t = cost.totals;
            append('assistant',
              `Cost rollup: ${t.partCount} parts, ${(t.mass_kg * 1000).toFixed(0)} g — $${t.totalCost.toFixed(2)} total (sell @${t.marginPct.toFixed(0)}% = $${t.sellPrice.toFixed(2)}).`);
          }
        } catch (err) {
          console.warn('cost rollup failed', err);
        }
        // ── Vendor Package ZIP bundle ──────────────────────────
        try {
          const bodies = getBodyRegistry().list();
          if (bodies.length > 0) {
            const lastCAM = typeof window !== 'undefined' ? window.__lastCAMProgram : null;
            const certMd = (() => {
              try {
                const matrix = generateCertificationMatrix(memRef.current);
                return renderMatrixMarkdown(matrix);
              } catch { return undefined; }
            })();
            const profile = findVendorProfile(vendorProfileId);
            const pkg = buildVendorPackage({
              bodies, profile,
              gcode: lastCAM?.gcode,
              gcodeSource: lastCAM?.source,
              certMarkdown: certMd,
            });
            setVendorPackage(pkg);
            append('assistant',
              `Vendor Package (${profile.name}): ${pkg.fileNames.length} files, ${(pkg.zipBytes.length / 1024).toFixed(1)} KB ZIP — total $${pkg.manifest.totals.totalCost.toFixed(2)}, sell $${pkg.manifest.totals.sellPrice.toFixed(2)}.`);

            // Quote every catalogued profile so the user can compare
            // shops side-by-side without stepping through the dropdown.
            try {
              const allQuotes = quoteAllVendors(rollupAssemblyCost, bodies);
              setQuotes(allQuotes);
              const spread = allQuotes.map(q => q.totals.totalCost);
              const lo = Math.min(...spread), hi = Math.max(...spread);
              append('assistant',
                `${allQuotes.length} vendor quotes computed — spread $${lo.toFixed(2)} … $${hi.toFixed(2)} (${(((hi / lo) - 1) * 100).toFixed(0)} % range).`);
            } catch (err) {
              console.warn('multi-vendor quote failed', err);
            }
          }
        } catch (err) {
          console.warn('vendor package failed', err);
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

  const composeRFQEmail = () => {
    if (!vendorPackage) return;
    const bodies = getBodyRegistry().list();
    const profile = findVendorProfile(vendorProfileId);
    const draft = buildVendorRFQEmail({ vendorPackage, profile, bodies });
    setRfqEmail(draft);
  };

  // Re-bundle the vendor ZIP whenever the user swaps profiles after Run.
  const reSwitchVendorProfile = (newId) => {
    setVendorProfileId(newId);
    if (phase !== 'done' || !vendorPackage) return;
    try {
      const bodies = getBodyRegistry().list();
      if (bodies.length === 0) return;
      const lastCAM = typeof window !== 'undefined' ? window.__lastCAMProgram : null;
      const certMd = (() => {
        try {
          const matrix = generateCertificationMatrix(memRef.current);
          return renderMatrixMarkdown(matrix);
        } catch { return undefined; }
      })();
      const profile = findVendorProfile(newId);
      const pkg = buildVendorPackage({
        bodies, profile,
        gcode: lastCAM?.gcode,
        gcodeSource: lastCAM?.source,
        certMarkdown: certMd,
      });
      setVendorPackage(pkg);
      append('assistant',
        `Rebuilt for ${profile.name}: ${pkg.fileNames.length} files, ${(pkg.zipBytes.length / 1024).toFixed(1)} KB — total $${pkg.manifest.totals.totalCost.toFixed(2)}, sell $${pkg.manifest.totals.sellPrice.toFixed(2)}, lead ${profile.leadTimeDays} d.`);
    } catch (err) {
      console.warn('vendor profile switch failed', err);
    }
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

  // Reset clears the current chat AND the active project's snapshot
  // so the next reload is genuinely fresh. The project shell stays so
  // the user keeps the same project name to start over under.
  const handleReset = () => {
    clearReactState();
    wipeActiveSnapshot();
  };

  return (
    <div className="chat-panel-overlay" onClick={onClose}>
      <div className="chat-panel" onClick={(e) => e.stopPropagation()}>
        <div className="chat-header">
          <span className="chat-title">ArchDisc AI</span>
          {restoredFromStorage && phase === 'done' && (
            <span className="chat-restored" data-restored
                  title="Chat restored from a previous session. Bodies + ZIP not preserved across reload — click Reset to start fresh.">
              restored
            </span>
          )}
          <span className={`chat-phase chat-phase-${phase}`}>{phase}</span>
          <button className="chat-close" onClick={onClose}>×</button>
        </div>
        <div className="chat-project-bar" data-project-bar>
          <span className="chat-project-label">Project</span>
          {renamingProject ? (
            <input className="chat-project-name-input"
                   value={projectNameDraft}
                   autoFocus
                   onChange={(e) => setProjectNameDraft(e.target.value)}
                   onBlur={commitProjectRename}
                   onKeyDown={(e) => {
                     if (e.key === 'Enter') commitProjectRename();
                     if (e.key === 'Escape') setRenamingProject(false);
                   }}
                   data-field="project-name" />
          ) : (
            <span className="chat-project-name"
                  data-project-name
                  onDoubleClick={() => {
                    const cur = projects.find(p => p.id === activeProjectId);
                    if (!cur) return;
                    setProjectNameDraft(cur.name);
                    setRenamingProject(true);
                  }}
                  title="Double-click to rename">
              {projects.find(p => p.id === activeProjectId)?.name ?? '— no project —'}
            </span>
          )}
          <select className="chat-project-select"
                  value={activeProjectId ?? ''}
                  onChange={(e) => handleSwitchProject(e.target.value)}
                  data-field="project-switch">
            <option value="" disabled>Switch…</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button className="chat-project-action"
                  onClick={handleNewProject}
                  data-action="new-project"
                  title="New project">+</button>
          <button className="chat-project-action"
                  onClick={handleExportProject}
                  disabled={!activeProjectId}
                  data-action="export-project"
                  title="Download this project as a .archdisc.json file">⤓</button>
          <label className="chat-project-action chat-project-action-import"
                 data-action="import-project-label"
                 title="Import a .archdisc.json file">
            ⤒
            <input type="file"
                   accept="application/json,.json"
                   style={{ display: 'none' }}
                   data-action="import-project"
                   onChange={(e) => {
                     const f = e.target.files?.[0];
                     handleImportProject(f);
                     e.target.value = '';
                   }} />
          </label>
          <button className="chat-project-action chat-project-action-danger"
                  onClick={() => activeProjectId && handleDeleteProject(activeProjectId)}
                  disabled={!activeProjectId}
                  data-action="delete-project"
                  title="Delete this project">×</button>
        </div>
        <div className="chat-template-bar" data-template-bar>
          <span className="chat-project-label">Template</span>
          <select className="chat-project-select chat-template-select"
                  value=""
                  onChange={(e) => { if (e.target.value) handleLoadTemplate(e.target.value); }}
                  data-field="template-load">
            <option value="">Load a starter plan…</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>
                {t.builtin ? '★ ' : ''}{t.name} ({t.plan.length})
              </option>
            ))}
          </select>
          {(phase === 'ready' || phase === 'done') && plan && plan.length > 0 && (
            <button className="chat-project-action chat-save-template-btn"
                    onClick={handleSaveTemplate}
                    data-action="save-template"
                    title="Save the current plan as a reusable template">Save as template</button>
          )}
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
          {costReport && (
            <div className="chat-cost" data-cost-summary>
              <div className="chat-cost-head" onClick={() => setCostExpanded((v) => !v)}>
                <span className="chat-cost-pill">$</span>
                <span>Cost rollup</span>
                <span className="chat-cost-stats">
                  {costReport.totals.partCount} parts · ${costReport.totals.totalCost.toFixed(2)} total · sell ${costReport.totals.sellPrice.toFixed(2)}
                </span>
                <span className="chat-dfm-toggle">{costExpanded ? '▴' : '▾'}</span>
              </div>
              {costExpanded && (
                <ul className="chat-cost-list">
                  {costReport.lineItems.map((l) => (
                    <li key={l.bodyId} className="chat-cost-row">
                      <span className="chat-cost-name">{l.name}</span>
                      <span className="chat-cost-mass">{(l.mass_kg * 1000).toFixed(1)} g</span>
                      <span className="chat-cost-subtotal">${l.subtotal.toFixed(2)}</span>
                    </li>
                  ))}
                  <li className="chat-cost-row chat-cost-total-row">
                    <span className="chat-cost-name">TOTAL</span>
                    <span className="chat-cost-mass">{(costReport.totals.mass_kg * 1000).toFixed(1)} g</span>
                    <span className="chat-cost-subtotal">${costReport.totals.totalCost.toFixed(2)}</span>
                  </li>
                </ul>
              )}
            </div>
          )}
          {vendorPackage && (
            <div className="chat-vendor" data-vendor-summary>
              <div className="chat-vendor-head">
                <span className="chat-vendor-pill">📦</span>
                <span>Vendor Package</span>
                <select className="chat-vendor-profile"
                        value={vendorProfileId}
                        onChange={(e) => reSwitchVendorProfile(e.target.value)}
                        data-field="vendor-profile">
                  {VENDOR_PROFILES.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <span className="chat-vendor-stats">
                  {vendorPackage.fileNames.length} files · {(vendorPackage.zipBytes.length / 1024).toFixed(1)} KB · ${vendorPackage.manifest.totals.totalCost.toFixed(2)}
                </span>
                <button className="chat-vendor-btn"
                        onClick={() => downloadVendorZip(vendorPackage)}
                        data-action="download-vendor-zip">Download ZIP</button>
                <button className="chat-vendor-btn chat-vendor-btn-secondary"
                        onClick={composeRFQEmail}
                        data-action="compose-rfq-email">Email RFQ</button>
              </div>
              <div className="chat-vendor-meta" data-vendor-meta>
                <span>{vendorPackage.manifest.vendor?.name ?? '—'}</span>
                <span>{vendorPackage.manifest.vendor?.location ?? ''}</span>
                <span>Lead {vendorPackage.manifest.vendor?.leadTimeDays ?? '?'} d</span>
                <span>Sell ${vendorPackage.manifest.totals.sellPrice.toFixed(2)}</span>
              </div>
              <div className="chat-vendor-files">
                {vendorPackage.fileNames.map(n => (
                  <span key={n} className="chat-vendor-file">{n}</span>
                ))}
              </div>
            </div>
          )}
          {rfqEmail && (
            <div className="chat-rfq" data-rfq-email>
              <div className="chat-rfq-head">
                <span>RFQ draft</span>
                <span className="chat-rfq-subject" data-rfq-subject>{rfqEmail.subject}</span>
                <button className="chat-vendor-btn"
                        onClick={() => {
                          navigator.clipboard?.writeText(rfqEmail.body);
                        }}
                        data-action="rfq-copy">Copy body</button>
                <a className="chat-vendor-btn chat-vendor-btn-secondary"
                   href={rfqEmail.mailtoUrl}
                   data-action="rfq-mailto">Open in mail client</a>
                <button className="chat-rfq-close"
                        onClick={() => setRfqEmail(null)}
                        data-action="rfq-close">×</button>
              </div>
              <pre className="chat-rfq-body" data-rfq-body>{rfqEmail.body}</pre>
            </div>
          )}
          {quotes && quotes.length > 0 && (
            <div className="chat-quotes" data-quotes-table>
              <div className="chat-quotes-head">
                <span>Quote comparison</span>
                <span className="chat-quotes-hint">
                  click a column header to sort
                </span>
              </div>
              <table className="chat-quotes-grid">
                <thead>
                  <tr>
                    {[
                      { key: 'name',         label: 'Vendor' },
                      { key: 'location',     label: 'Location' },
                      { key: 'leadTimeDays', label: 'Lead' },
                      { key: 'totalCost',    label: 'Total' },
                      { key: 'sellPrice',    label: 'Sell' },
                    ].map(col => (
                      <th key={col.key}
                          data-quotes-col={col.key}
                          className={quotesSortKey === col.key ? 'chat-quotes-active' : ''}
                          onClick={() => {
                            if (quotesSortKey === col.key) setQuotesDir(d => -d);
                            else { setQuotesSortKey(col.key); setQuotesDir(1); }
                          }}>
                        {col.label}{quotesSortKey === col.key ? (quotesDir > 0 ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortQuotes(quotes, quotesSortKey, quotesDir).map(q => (
                    <tr key={q.profile.id}
                        className={q.profile.id === vendorProfileId ? 'chat-quotes-selected' : ''}
                        onClick={() => reSwitchVendorProfile(q.profile.id)}
                        data-quotes-row={q.profile.id}>
                      <td>{q.profile.name}</td>
                      <td className="chat-quotes-loc">{q.profile.location}</td>
                      <td className="chat-quotes-num">{q.leadTimeDays} d</td>
                      <td className="chat-quotes-num chat-quotes-total">${q.totals.totalCost.toFixed(2)}</td>
                      <td className="chat-quotes-num">${q.totals.sellPrice.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

/** Sort the quote rows by one of name / location / leadTimeDays /
 * totalCost / sellPrice. dir is +1 ascending, -1 descending. */
function sortQuotes(quotes, key, dir) {
  const get = (q) => {
    if (key === 'name')         return q.profile.name;
    if (key === 'location')     return q.profile.location;
    if (key === 'leadTimeDays') return q.leadTimeDays;
    if (key === 'totalCost')    return q.totals.totalCost;
    if (key === 'sellPrice')    return q.totals.sellPrice;
    return 0;
  };
  return [...quotes].sort((a, b) => {
    const va = get(a), vb = get(b);
    if (typeof va === 'string') return dir * va.localeCompare(vb);
    return dir * (va - vb);
  });
}

/** Trigger a browser download of the vendor ZIP. */
function downloadVendorZip(pkg) {
  const blob = new Blob([pkg.zipBytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `archdisc-vendor-${stamp}.zip`;
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
