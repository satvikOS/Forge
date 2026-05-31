/**
 * AppState — single source of truth for the Forge React shell (Forge-26).
 *
 * Deliberately tiny: a React Context wrapper around plain JS instances we
 * already own (CommandRegistry, SelectionFilter, PropertyManager, a list
 * of ForgeProject). No redux/zustand. Components read with `useAppState()`
 * and write with the dispatch-style methods exposed on the context value.
 *
 * The Context value is mutable in two ways:
 *   - Imperative mutations on the underlying instances (FeatureTree.add,
 *     SelectionFilter.enable, …). Consumers subscribe to those instances
 *     directly via `useEffect` + `onChange` returns.
 *   - Reducer-style state for things that are only stored in React land
 *     (theme, active project id, active ribbon tab, workspace role, open
 *     modals). These live in `useReducer` and re-render via context.
 *
 * Why a context provider and not a hook-only store? Because the
 * non-React JS instances need to outlive any one component but be
 * shared across the entire tree (e.g. the CommandPalette modal lives at
 * the root, but ribbon buttons in arbitrarily deep panels also invoke
 * commands on the same registry). A context lets us hand all of them
 * down with a single Provider.
 */

import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { CommandRegistry } from '../../kernel/forge/CommandPalette.js';
import { SelectionFilter } from '../../kernel/forge/SelectionFilter.js';
import { PropertyManager } from '../../kernel/forge/PropertyManager.js';
import { ForgeProject } from '../../kernel/forge/ForgeProject.js';

const STORAGE_KEY = 'forge.app.v1';

const initialState = {
  activeProjectId: null,
  activeRibbonTab: 'Part',
  theme: 'dark',         // 'dark' | 'light'
  workspaceRole: 'Engineer', // 'Engineer' | 'Designer' | 'Reviewer'
  settingsOpen: false,
  paletteOpen: false,
  status: {
    mouse: { x: 0, y: 0, z: 0 },
    units: 'mm',
    selectionCount: 0,
    kernelReady: false,
    kernelError: null,
  },
  // Per-role customisable toolbar config. Each workspace pins a set of
  // command-ids to show in the ribbon (and order). The toolbar config
  // persists in localStorage so the user's tweaks survive reloads.
  workspaceConfigs: {
    Engineer:  { pinned: ['part.extrude', 'part.fillet', 'sketch.new', 'assembly.mate'] },
    Designer:  { pinned: ['sketch.new', 'part.extrude', 'part.shell', 'view.render'] },
    Reviewer:  { pinned: ['view.section', 'drawing.new', 'sim.run', 'doc.print'] },
  },
};

function reducer(state, action) {
  switch (action.type) {
    case 'OPEN_PROJECT': {
      const projects = state.projects ? [...state.projects] : [];
      projects.push(action.project);
      return { ...state, activeProjectId: action.project._uid, projects };
    }
    case 'CLOSE_PROJECT': {
      const projects = (state.projects || []).filter((p) => p._uid !== action.id);
      const activeId = state.activeProjectId === action.id
        ? (projects[0]?._uid || null)
        : state.activeProjectId;
      return { ...state, projects, activeProjectId: activeId };
    }
    case 'SET_ACTIVE_PROJECT':
      return { ...state, activeProjectId: action.id };
    case 'SET_RIBBON_TAB':
      return { ...state, activeRibbonTab: action.tab };
    case 'SET_THEME':
      return { ...state, theme: action.theme };
    case 'SET_WORKSPACE_ROLE':
      return { ...state, workspaceRole: action.role };
    case 'UPDATE_WORKSPACE_CONFIG': {
      const next = {
        ...state.workspaceConfigs,
        [action.role]: { ...(state.workspaceConfigs[action.role] || {}), ...action.config },
      };
      return { ...state, workspaceConfigs: next };
    }
    case 'OPEN_SETTINGS':  return { ...state, settingsOpen: true };
    case 'CLOSE_SETTINGS': return { ...state, settingsOpen: false };
    case 'OPEN_PALETTE':   return { ...state, paletteOpen: true };
    case 'CLOSE_PALETTE':  return { ...state, paletteOpen: false };
    case 'SET_STATUS':     return { ...state, status: { ...state.status, ...action.patch } };
    case 'HYDRATE': {
      const hydrate = action.payload || {};
      return {
        ...state,
        theme: hydrate.theme || state.theme,
        workspaceRole: hydrate.workspaceRole || state.workspaceRole,
        workspaceConfigs: hydrate.workspaceConfigs || state.workspaceConfigs,
      };
    }
    default:
      return state;
  }
}

function loadFromStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToStorage(state) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: state.theme,
      workspaceRole: state.workspaceRole,
      workspaceConfigs: state.workspaceConfigs,
    }));
  } catch {
    /* swallow — quota / private mode */
  }
}

let nextProjectUid = 1;
function tagProject(project) {
  if (!project._uid) project._uid = `proj-${nextProjectUid++}`;
  return project;
}

const AppStateContext = createContext(null);

export function AppStateProvider({ children, initialProjects = null }) {
  const [state, dispatch] = useReducer(reducer, initialState, (s) => {
    // Inject any caller-supplied projects up front (tests + storybook).
    const projects = (initialProjects || []).map(tagProject);
    return { ...s, projects, activeProjectId: projects[0]?._uid || null };
  });

  // Instances live across re-renders — they own their own listeners.
  const commandRegistryRef = useRef(null);
  const selectionFilterRef = useRef(null);
  const propertyManagerRef = useRef(null);

  if (!commandRegistryRef.current) commandRegistryRef.current = new CommandRegistry();
  if (!selectionFilterRef.current) selectionFilterRef.current = new SelectionFilter();
  if (!propertyManagerRef.current) propertyManagerRef.current = new PropertyManager();

  // Hydrate persisted UI prefs once.
  useEffect(() => {
    const persisted = loadFromStorage();
    if (persisted) dispatch({ type: 'HYDRATE', payload: persisted });
  }, []);

  // Persist whenever the relevant slice changes.
  useEffect(() => {
    saveToStorage(state);
  }, [state.theme, state.workspaceRole, state.workspaceConfigs]);

  // Apply theme as a `data-theme` attribute on the document root so the
  // CSS variables in `styles.css` flip.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-forge-theme', state.theme);
    }
  }, [state.theme]);

  // Selection-count tracking — kept on AppState so the StatusBar can
  // render without subscribing to the selection filter itself.
  useEffect(() => {
    const f = selectionFilterRef.current;
    const off = f.onChange(() => {
      dispatch({ type: 'SET_STATUS', patch: { selectionCount: f.enabledKinds().length } });
    });
    return off;
  }, []);

  // Kernel readiness — try to memoise once. If the bridge throws we just
  // keep `kernelReady: false`; the panels degrade gracefully.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('../../kernel/forge/index.js');
        const ready = mod.isForgeReady ? mod.isForgeReady() : false;
        if (!cancelled) {
          dispatch({ type: 'SET_STATUS', patch: { kernelReady: ready, kernelError: null } });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: 'SET_STATUS',
            patch: { kernelReady: false, kernelError: String(err && err.message || err) },
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const value = useMemo(() => ({
    state,
    dispatch,
    commandRegistry: commandRegistryRef.current,
    selectionFilter: selectionFilterRef.current,
    propertyManager: propertyManagerRef.current,
    // helpers ------------------------------------------------------------
    openProject(spec = {}) {
      const project = tagProject(spec instanceof ForgeProject ? spec : new ForgeProject(spec));
      dispatch({ type: 'OPEN_PROJECT', project });
      return project;
    },
    closeProject(id) { dispatch({ type: 'CLOSE_PROJECT', id }); },
    setActiveProject(id) { dispatch({ type: 'SET_ACTIVE_PROJECT', id }); },
    setRibbonTab(tab) { dispatch({ type: 'SET_RIBBON_TAB', tab }); },
    setTheme(theme) { dispatch({ type: 'SET_THEME', theme }); },
    setWorkspaceRole(role) { dispatch({ type: 'SET_WORKSPACE_ROLE', role }); },
    updateWorkspaceConfig(role, config) {
      dispatch({ type: 'UPDATE_WORKSPACE_CONFIG', role, config });
    },
    openSettings()  { dispatch({ type: 'OPEN_SETTINGS' }); },
    closeSettings() { dispatch({ type: 'CLOSE_SETTINGS' }); },
    openPalette()   { dispatch({ type: 'OPEN_PALETTE' }); },
    closePalette()  { dispatch({ type: 'CLOSE_PALETTE' }); },
    setStatus(patch) { dispatch({ type: 'SET_STATUS', patch }); },
    activeProject() {
      const id = state.activeProjectId;
      return id ? (state.projects || []).find((p) => p._uid === id) || null : null;
    },
  }), [state]);

  return React.createElement(AppStateContext.Provider, { value }, children);
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('[forge-app] useAppState used outside <AppStateProvider>');
  return ctx;
}

// Exported for tests so they can build a value without a Provider.
export { reducer, initialState, AppStateContext };
