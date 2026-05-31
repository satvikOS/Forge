import { useState, useRef, useEffect, useCallback } from 'react';
import './Topbar.css';

/**
 * Topbar - Application menu bar with smart viewport-aware positioning
 * All dropdowns and submenus use fixed positioning to prevent overflow.
 * Renders as an inline nav element to embed within the workbench header.
 */
export default function Topbar() {
  const [openMenu, setOpenMenu] = useState(null);
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const [submenuStyle, setSubmenuStyle] = useState({});
  const [activeSubmenuItems, setActiveSubmenuItems] = useState([]);
  const [actionFeedback, setActionFeedback] = useState(null);
  const menuRef = useRef(null);
  const submenuTimerRef = useRef(null);
  const triggerRefs = useRef({});

  // Show visual feedback for any menu action
  const showFeedback = useCallback((label) => {
      setActionFeedback(label);
      setTimeout(() => setActionFeedback(null), 2000);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenMenu(null);
        setOpenSubmenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup timer
  useEffect(() => {
    return () => clearTimeout(submenuTimerRef.current);
  }, []);

  // ─── Menu Definitions ─────────────────────────────────────────────────────────
  // Application-level menus only. Tool creation (Insert, Sketch, etc.) lives in
  // the left sidebar to avoid duplication.
  //
  // WF-17 — File menu wired to real dispatchers. Each action either:
  //   - Dispatches an `archdisc:run-tool` event (groupKey routes through
  //     ToolExecutionEngine.GROUP_ALIASES, then the registered handler);
  //   - Calls a workbench-level handler directly (clearScene, undo, redo);
  //   - Re-opens the WF-09 Welcome modal (New Project → templates);
  //   - Fires the WF-09 recent-projects array for the Recent submenu.
  const runTool = (tab, tool) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab, tool } }));
  };
  const clearScene = () => {
    if (typeof window === 'undefined') return;
    const reg = window.__archdiscBodies;
    if (!reg) return;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
    const h = window.__archdiscHistory;
    if (h && typeof h.clear === 'function') h.clear();
  };
  const recentProjects = (() => {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
      const raw = window.localStorage.getItem('archdisc:recent-projects:v1');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
    } catch { return []; }
  })();
  const recentSubmenu = recentProjects.length > 0
    ? recentProjects.map((r, i) => ({
        label: r.filename ? `${i + 1}. ${r.filename}` : `${i + 1}. (unnamed)`,
        action: () => {
          showFeedback(`Reopen ${r.filename || 'project'}…`);
          // Re-loading a snapshot from localStorage metadata needs the
          // user to re-select the file (the snapshot body isn't stored
          // in localStorage, only the filename + timestamps). Dispatch
          // Load Snapshot which opens the file picker.
          runTool('documentation', 'Load Snapshot');
        },
      }))
    : [{ label: '(no recent projects)', disabled: true }];

  const menus = {
    file: {
      label: 'File',
      items: [
        { label: 'New Project', shortcut: 'Ctrl+N', action: () => {
          showFeedback('New Project');
          clearScene();
          if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('archdisc:open-welcome'));
        }},
        { type: 'separator' },
        { label: 'Open Snapshot…', shortcut: 'Ctrl+O', action: () => {
          showFeedback('Open Snapshot');
          runTool('documentation', 'Load Snapshot');
        }},
        { label: 'Recent', submenu: recentSubmenu },
        { type: 'separator' },
        { label: 'Save Snapshot', shortcut: 'Ctrl+S', action: () => {
          showFeedback('Save Snapshot');
          runTool('documentation', 'Save Snapshot');
        }},
        { type: 'separator' },
        { label: 'Export', submenu: [
          { label: 'STEP (.step)', action: () => { showFeedback('Export STEP'); runTool('documentation', 'Export STEP'); }},
          { label: 'STL (.stl)',   action: () => { showFeedback('Export STL');  runTool('manufacturing', 'Export STL'); }},
          { label: '3MF (.3mf)',   action: () => { showFeedback('Export 3MF');  runTool('documentation', 'Export 3MF'); }},
          { label: 'glTF / GLB',   action: () => { showFeedback('Export glTF'); runTool('documentation', 'Export glTF'); }},
          { label: 'OBJ (.obj)',   action: () => { showFeedback('Export OBJ');  runTool('documentation', 'Export OBJ'); }},
          { type: 'separator' },
          { label: 'Project Bundle (.zip)', action: () => { showFeedback('Export Bundle'); runTool('documentation', 'Export Project Bundle'); }},
          { label: 'BOM (.csv)',            action: () => { showFeedback('Export BOM');    runTool('documentation', 'Export BOM (CSV)'); }},
          { label: 'PDF Drawing',           action: () => { showFeedback('Export PDF');    runTool('documentation', 'Export PDF'); }},
        ]},
        { type: 'separator' },
        { label: 'Welcome…', action: () => {
          showFeedback('Welcome');
          if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('archdisc:open-welcome'));
        }},
        { type: 'separator' },
        { label: 'Exit', shortcut: 'Alt+F4', action: () => {
          showFeedback('Exit');
          if (typeof window !== 'undefined' && window.electronAPI?.quit) window.electronAPI.quit();
          else if (typeof window !== 'undefined') window.close();
        }},
      ],
    },
    edit: {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: () => console.log('Undo') },
        { label: 'Redo', shortcut: 'Ctrl+Y', action: () => console.log('Redo') },
        { type: 'separator' },
        { label: 'Cut', shortcut: 'Ctrl+X', action: () => console.log('Cut') },
        { label: 'Copy', shortcut: 'Ctrl+C', action: () => console.log('Copy') },
        { label: 'Paste', shortcut: 'Ctrl+V', action: () => console.log('Paste') },
        { label: 'Paste Special', action: () => console.log('Paste Special') },
        { label: 'Delete', shortcut: 'Del', action: () => console.log('Delete') },
        { type: 'separator' },
        { label: 'Select All', shortcut: 'Ctrl+A', action: () => console.log('Select All') },
        { label: 'Deselect All', shortcut: 'Ctrl+D', action: () => console.log('Deselect All') },
        { label: 'Invert Selection', action: () => console.log('Invert Selection') },
        { type: 'separator' },
        { label: 'Suppress Feature', action: () => console.log('Suppress') },
        { label: 'Unsuppress Feature', action: () => console.log('Unsuppress') },
        { type: 'separator' },
        { label: 'Preferences...', action: () => console.log('Preferences') },
      ],
    },
    view: {
      label: 'View',
      items: [
        { label: 'Standard Views', submenu: [
          { label: 'Front', shortcut: 'Num 1', action: () => console.log('Front') },
          { label: 'Back', shortcut: 'Ctrl+1', action: () => console.log('Back') },
          { label: 'Top', shortcut: 'Num 7', action: () => console.log('Top') },
          { label: 'Bottom', shortcut: 'Ctrl+7', action: () => console.log('Bottom') },
          { label: 'Left', shortcut: 'Ctrl+3', action: () => console.log('Left') },
          { label: 'Right', shortcut: 'Num 3', action: () => console.log('Right') },
          { label: 'Isometric', shortcut: 'Num 0', action: () => console.log('Isometric') },
          { label: 'Dimetric', action: () => console.log('Dimetric') },
          { label: 'Trimetric', action: () => console.log('Trimetric') },
        ]},
        { label: 'Display Style', submenu: [
          { label: 'Wireframe', shortcut: 'Z', action: () => console.log('Wireframe') },
          { label: 'Hidden Lines Visible', action: () => console.log('HLV') },
          { label: 'Hidden Lines Removed', action: () => console.log('HLR') },
          { label: 'Shaded', shortcut: 'Shift+Z', action: () => console.log('Shaded') },
          { label: 'Shaded with Edges', action: () => console.log('Shaded Edges') },
          { label: 'Draft Quality', action: () => console.log('Draft Quality') },
        ]},
        { type: 'separator' },
        { label: 'Zoom to Fit', shortcut: 'Home', action: () => console.log('Zoom Fit') },
        { label: 'Zoom to Selection', shortcut: 'F', action: () => console.log('Zoom Selection') },
        { type: 'separator' },
        { label: 'Section View', action: () => console.log('Section View') },
        { label: 'Perspective', action: () => console.log('Perspective'), checked: true },
        { type: 'separator' },
        { label: 'Show / Hide', submenu: [
          { label: 'Grid', shortcut: 'G', action: () => console.log('Grid'), checked: true },
          { label: 'Axes', action: () => console.log('Axes'), checked: true },
          { label: 'Origin', action: () => console.log('Origin') },
          { label: 'Sketches', action: () => console.log('Sketches'), checked: true },
          { label: 'Planes', action: () => console.log('Planes') },
          { label: 'Reference Geometry', action: () => console.log('Ref Geom') },
          { label: 'Feature Tree', action: () => console.log('Feature Tree') },
        ]},
        { type: 'separator' },
        { label: 'Toggle Sidebar', shortcut: 'Tab', action: () => console.log('Toggle Sidebar') },
        { label: 'Full Screen', shortcut: 'F11', action: () => console.log('Full Screen') },
      ],
    },
    tools: {
      label: 'Tools',
      items: [
        { label: 'Measure', submenu: [
          { label: 'Distance', shortcut: 'Ctrl+M', action: () => console.log('Distance') },
          { label: 'Angle', action: () => console.log('Angle') },
          { label: 'Radius', action: () => console.log('Radius') },
          { label: 'Area', action: () => console.log('Area') },
          { label: 'Volume', action: () => console.log('Volume') },
        ]},
        { label: 'Mass Properties', action: () => console.log('Mass Properties') },
        { label: 'Check Geometry', action: () => console.log('Check Geometry') },
        { type: 'separator' },
        { label: 'Equations', action: () => console.log('Equations') },
        { label: 'Design Table', action: () => console.log('Design Table') },
        { type: 'separator' },
        { label: 'Interference Detection', action: () => console.log('Interference') },
        { label: 'Clearance Verification', action: () => console.log('Clearance') },
        { label: 'Draft Analysis', action: () => console.log('Draft Analysis') },
        { label: 'Undercut Analysis', action: () => console.log('Undercut') },
        { label: 'Wall Thickness', action: () => console.log('Wall Thickness') },
        { type: 'separator' },
        { label: 'Compare', submenu: [
          { label: 'Compare Part', action: () => console.log('Compare Part') },
          { label: 'Compare Drawing', action: () => console.log('Compare Drawing') },
          { label: 'Compare BOM', action: () => console.log('Compare BOM') },
        ]},
        { type: 'separator' },
        { label: 'Exploded View', shortcut: 'X', action: () => console.log('Explode') },
        { label: 'Appearance', action: () => console.log('Appearance') },
      ],
    },
    help: {
      label: 'Help',
      items: [
        { label: 'Documentation', shortcut: 'F1', action: () => console.log('Documentation') },
        { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+/', action: () => console.log('Shortcuts') },
        { label: 'Video Tutorials', action: () => console.log('Tutorials') },
        { type: 'separator' },
        { label: 'Report Bug', action: () => console.log('Report Bug') },
        { label: 'Feature Request', action: () => console.log('Feature Request') },
        { type: 'separator' },
        { label: 'About ArchDisc', action: () => console.log('About') },
        { label: 'Check for Updates', action: () => console.log('Updates') },
      ],
    },
  };

  // ─── Smart Positioning ─────────────────────────────────────────────────────────

  const calcDropdownPos = useCallback((triggerEl) => {
    if (!triggerEl) return {};
    const rect = triggerEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dropW = 260;

    const style = { position: 'fixed', zIndex: 1000 };

    // Horizontal: align left with trigger, clamp to viewport
    style.left = Math.min(rect.left, vw - dropW - 8);

    // Vertical: directly below trigger
    style.top = rect.bottom;

    // Limit height so it doesn't go off screen
    const maxH = vh - rect.bottom - 8;
    if (maxH < 200) {
      // If too little space below, show above
      style.top = 'auto';
      style.bottom = vh - rect.top;
      style.maxHeight = rect.top - 8;
    } else {
      style.maxHeight = maxH;
    }

    return style;
  }, []);

  const calcSubmenuPos = useCallback((parentItemEl) => {
    if (!parentItemEl) return {};
    const rect = parentItemEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const subW = 240;

    // Find the dropdown panel that contains this item
    const dropPanel = parentItemEl.closest('.topbar-dropdown');
    const dropRect = dropPanel ? dropPanel.getBoundingClientRect() : rect;

    const style = { position: 'fixed', zIndex: 1001 };

    // Horizontal: prefer right of dropdown, fall back to left
    if (dropRect.right + subW + 4 < vw) {
      style.left = dropRect.right + 2;
    } else if (dropRect.left - subW - 2 > 0) {
      style.left = dropRect.left - subW - 2;
    } else {
      style.left = Math.max(4, vw - subW - 4);
    }

    // Vertical: align with parent item, clamp to viewport
    const estimateH = 300;
    if (rect.top + estimateH < vh) {
      style.top = rect.top - 4;
    } else {
      style.top = Math.max(4, vh - estimateH - 4);
    }

    return style;
  }, []);

  // ─── Event Handlers ────────────────────────────────────────────────────────────

  const handleMenuClick = (menuKey) => {
    if (openMenu === menuKey) {
      setOpenMenu(null);
      setOpenSubmenu(null);
    } else {
      setOpenMenu(menuKey);
      setOpenSubmenu(null);
      setDropdownStyle(calcDropdownPos(triggerRefs.current[menuKey]));
    }
  };

  const handleMenuHover = (menuKey) => {
    if (openMenu && openMenu !== menuKey) {
      setOpenMenu(menuKey);
      setOpenSubmenu(null);
      setDropdownStyle(calcDropdownPos(triggerRefs.current[menuKey]));
    }
  };

  const handleItemClick = (item) => {
    if (!item.disabled && item.action) {
      item.action();
      showFeedback(item.label);
      setOpenMenu(null);
      setOpenSubmenu(null);
    }
  };

  const handleSubmenuEnter = (key, items, e) => {
    clearTimeout(submenuTimerRef.current);
    setOpenSubmenu(key);
    setActiveSubmenuItems(items);
    setSubmenuStyle(calcSubmenuPos(e.currentTarget));
  };

  const handleSubmenuLeave = () => {
    submenuTimerRef.current = setTimeout(() => {
      setOpenSubmenu(null);
    }, 120);
  };

  const handleSubmenuPanelEnter = () => {
    clearTimeout(submenuTimerRef.current);
  };

  const handleSubmenuPanelLeave = () => {
    setOpenSubmenu(null);
  };

  // ─── Renderers ─────────────────────────────────────────────────────────────────

  const renderMenuItem = (item, index, parentKey) => {
    if (item.type === 'separator') {
      return <div key={index} className="topbar-separator" />;
    }

    // Item with submenu → arrow indicator, hover to open
    if (item.submenu) {
      const subKey = `${parentKey}-${index}`;
      return (
        <div
          key={index}
          className={`topbar-item has-submenu ${openSubmenu === subKey ? 'submenu-active' : ''}`}
          data-topbar-item={item.label}
          data-topbar-has-submenu="true"
          onMouseEnter={(e) => handleSubmenuEnter(subKey, item.submenu, e)}
          onMouseLeave={handleSubmenuLeave}
        >
          <div className="topbar-item-left">
            <span>{item.label}</span>
          </div>
          <span className="topbar-submenu-arrow">&#9656;</span>
        </div>
      );
    }

    // Regular item
    return (
      <div
        key={index}
        className={`topbar-item ${item.disabled ? 'disabled' : ''}`}
        data-topbar-item={item.label}
        data-topbar-disabled={item.disabled ? 'true' : 'false'}
        onClick={() => handleItemClick(item)}
      >
        <div className="topbar-item-left">
          {item.checked && <span className="topbar-check">&#10003;</span>}
          <span>{item.label}</span>
        </div>
        {item.shortcut && (
          <span className="topbar-shortcut">{item.shortcut}</span>
        )}
      </div>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────────

  return (
    <nav ref={menuRef} className="topbar-menus">
      {/* Menu triggers */}
      {Object.entries(menus).map(([key, menu]) => (
        <button
          key={key}
          ref={(el) => (triggerRefs.current[key] = el)}
          className={`topbar-menu-trigger ${openMenu === key ? 'active' : ''}`}
          data-topbar-menu={key}
          onClick={() => handleMenuClick(key)}
          onMouseEnter={() => handleMenuHover(key)}
        >
          {menu.label}
        </button>
      ))}

      {/* Dropdown panel - fixed positioned overlay */}
      {openMenu && menus[openMenu] && (
        <div className="topbar-dropdown" style={dropdownStyle}>
          {menus[openMenu].items.map((item, i) => renderMenuItem(item, i, openMenu))}
        </div>
      )}

      {/* Submenu panel - fixed positioned overlay */}
      {openSubmenu && activeSubmenuItems.length > 0 && (
        <div
          className="topbar-submenu"
          style={submenuStyle}
          onMouseEnter={handleSubmenuPanelEnter}
          onMouseLeave={handleSubmenuPanelLeave}
        >
          {activeSubmenuItems.map((subItem, si) => {
            if (subItem.type === 'separator') {
              return <div key={si} className="topbar-separator" />;
            }
            return (
              <div
                key={si}
                className={`topbar-item ${subItem.disabled ? 'disabled' : ''}`}
                data-topbar-item={subItem.label}
                data-topbar-disabled={subItem.disabled ? 'true' : 'false'}
                onClick={(e) => {
                  e.stopPropagation();
                  handleItemClick(subItem);
                }}
              >
                <div className="topbar-item-left">
                  {subItem.checked && <span className="topbar-check">&#10003;</span>}
                  <span>{subItem.label}</span>
                </div>
                {subItem.shortcut && (
                  <span className="topbar-shortcut">{subItem.shortcut}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Action feedback toast */}
      {actionFeedback && (
        <div className="topbar-feedback">{actionFeedback}</div>
      )}
    </nav>
  );
}
